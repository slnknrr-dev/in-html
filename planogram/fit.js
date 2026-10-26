// planogram/fit.js - does the layout fit: per shelf the sum of facing widths against the shelf width, the stack
// height against the clearance and the rows into the depth against the shelf depth, with squeezable packs checked at
// their compressed size (the front view still draws nominal sizes). Fill %, free width, the overflow, warning codes;
// fixture-level checks (shelves taller than the fixture, wider or deeper boards); automatic depth facings, the
// tallest stack and the most facings that still fit.
//
// Two widths per position: nominal (what the front view draws) and minimal (squeezed). Width overflow is a warning
// only when even the squeezed layout does not fit; between the two the shelf is reported as `squeezed` (tight but
// valid). EPS absorbs floating-point noise from sums of decimal centimetres (0.1 + 0.2 > 0.3 must not warn).

import { effectiveDims, effectiveSqueeze, hasDims, productLookup, round } from './model.js';

const EPS = 1e-9;
const pid = (p) => p.productId ?? p.modelId;

// Width of one facing column: a pegboard hangs every column on its own hook, so widths round up to the hole pitch.
const column = (w, shelf) => (shelf.kind === 'peg' && shelf.pitch ? Math.ceil(w / shelf.pitch - 1e-9) * shelf.pitch : w);

// Nominal and minimal (squeezed) box of a position, or null without dimensions.
// Height and depth squeeze apply to the stack as a whole, width squeeze per pack before pegboard rounding (a soft
// pack still occupies a whole hook column).
export function positionBox(p, product, shelf = {}) {
  if (!hasDims(product)) return null;
  const e = effectiveDims(product, p.rot, p.turn);
  const q = effectiveSqueeze(product, p.rot, p.turn);
  const box = { width: round(column(e.width, shelf) * p.fx), height: round(e.height * p.fy), depth: round(e.depth * p.fz) };
  const min = {
    width: column(e.width * (1 - q.width / 100), shelf) * p.fx,
    height: box.height * (1 - q.height / 100),
    depth: box.depth * (1 - q.depth / 100),
  };
  return { ...box, min, unit: e };
}

/**
 * Check shelves. `products`: array / Map / object / function id -> product.
 * -> { ok, warnings: [{ code, shelf, pos?, productId?, value?, limit? }], shelves: [{ usedWidth, minWidth, squeezed,
 *      freeWidth, overflow, fill, unknown, positions: [{ width, height, depth } | null-dims] }] }
 * codes: too_wide (shelf), too_tall, too_deep, no_dimensions (positions); ok ignores no_dimensions.
 */
export function checkShelves(shelves, products) {
  const get = productLookup(products);
  const warnings = [];
  const out = shelves.map((s, si) => {
    let used = 0, usedMin = 0, unknown = false;
    const positions = s.positions.map((p, pi) => {
      const b = positionBox(p, get(pid(p)), s);
      if (!b) {
        unknown = true;
        warnings.push({ code: 'no_dimensions', shelf: si, pos: pi, productId: pid(p) });
        return { width: null, height: null, depth: null };
      }
      used += b.width;
      usedMin += b.min.width;
      if (b.min.height > s.height + EPS) warnings.push({ code: 'too_tall', shelf: si, pos: pi, productId: pid(p), value: b.height, limit: s.height });
      if (b.min.depth > s.depth + EPS) warnings.push({ code: 'too_deep', shelf: si, pos: pi, productId: pid(p), value: b.depth, limit: s.depth });
      return { width: b.width, height: b.height, depth: b.depth };
    });
    used = round(used);
    usedMin = round(usedMin);
    if (usedMin > s.width + EPS) warnings.push({ code: 'too_wide', shelf: si, value: used, limit: s.width });
    return {
      usedWidth: used, minWidth: usedMin,
      squeezed: used > s.width + EPS && usedMin <= s.width + EPS,
      freeWidth: round(s.width - used), overflow: round(Math.max(0, used - s.width)),
      fill: s.width ? round((used / s.width) * 100, 0) : 0, unknown, positions,
    };
  });
  return { ok: !warnings.some((w) => w.code !== 'no_dimensions'), warnings, shelves: out };
}

/**
 * Whole fixture: checkShelves plus fixture codes
 *   fixture_too_tall  plinth + boards + clearances exceed the fixture height (value, limit)
 *   shelf_too_wide / shelf_too_deep  a board larger than the fixture (shelf, value, limit)
 * and totals { shelfWidth, usedWidth, fill, stackHeight }.
 */
// Stack height = plinth + sum of (clearance + board thickness); it must fit the fixture's height. Boards larger than
// the fixture are flagged separately because they are a data error, not a layout choice.
export function checkFixture(fixture, products) {
  const r = checkShelves(fixture.shelves, products);
  const stack = round((fixture.base ?? 0) + fixture.shelves.reduce((x, s) => x + s.height + (s.thickness ?? 0), 0));
  if (fixture.height && stack > fixture.height + EPS) r.warnings.push({ code: 'fixture_too_tall', value: stack, limit: fixture.height });
  fixture.shelves.forEach((s, si) => {
    if (fixture.width && s.width > fixture.width + EPS) r.warnings.push({ code: 'shelf_too_wide', shelf: si, value: s.width, limit: fixture.width });
    if (fixture.depth && s.depth > fixture.depth + EPS) r.warnings.push({ code: 'shelf_too_deep', shelf: si, value: s.depth, limit: fixture.depth });
  });
  r.ok = !r.warnings.some((w) => w.code !== 'no_dimensions');
  const shelfWidth = round(fixture.shelves.reduce((x, s) => x + s.width, 0));
  const usedWidth = round(r.shelves.reduce((x, s) => x + s.usedWidth, 0));
  r.totals = { shelfWidth, usedWidth, fill: shelfWidth ? round((usedWidth / shelfWidth) * 100, 0) : 0, stackHeight: stack };
  return r;
}

// Rows into the depth that fit the shelf (at least 1; null without dimensions).
export function autoDepth(product, shelf, rot = 0, turn = 0) {
  if (!hasDims(product)) return null;
  const d = effectiveDims(product, rot, turn).depth * (1 - effectiveSqueeze(product, rot, turn).depth / 100);
  return Math.max(1, Math.floor(shelf.depth / d + 1e-9));
}

// Packs stacked upwards that fit under the clearance (at least 1).
export function maxStack(product, shelf, rot = 0, turn = 0) {
  if (!hasDims(product)) return null;
  const h = effectiveDims(product, rot, turn).height * (1 - effectiveSqueeze(product, rot, turn).height / 100);
  return Math.max(1, Math.floor(shelf.height / h + 1e-9));
}

// Set fz of every position to the depth that fits (positions without dimensions keep theirs). Returns a new shelf.
export function autoDepthShelf(shelf, products, { stack = false } = {}) {
  const get = productLookup(products);
  return {
    ...shelf,
    positions: shelf.positions.map((p) => {
      const pr = get(pid(p));
      if (!hasDims(pr)) return p;
      const q = { ...p, fz: autoDepth(pr, shelf, p.rot, p.turn) };
      if (stack) q.fy = maxStack(pr, shelf, p.rot, p.turn);
      return q;
    }),
  };
}

// The most width facings position `index` can have while the shelf still fits (squeeze included).
// Uses the other positions' minimal widths, so the answer is the most facings that pass checkShelves.
export function maxFacings(shelf, products, index) {
  const get = productLookup(products);
  const p = shelf.positions[index];
  const pr = p && get(pid(p));
  if (!hasDims(pr)) return null;
  let others = 0;
  shelf.positions.forEach((q, i) => { if (i !== index) { const b = positionBox(q, get(pid(q)), shelf); if (b) others += b.min.width; } });
  const one = positionBox({ ...p, fx: 1 }, pr, shelf).min.width;
  return Math.max(0, Math.floor((shelf.width - others) / one + 1e-9));
}

// Human-readable warning (English); `nameOf(productId)` gives product names.
export function warningText(w, nameOf = () => '') {
  const at = w.shelf == null ? 'Fixture' : `Shelf ${w.shelf + 1}` + (w.pos != null ? `, position ${w.pos + 1}${nameOf(w.productId) ? ` "${nameOf(w.productId)}"` : ''}` : '');
  switch (w.code) {
    case 'too_wide': return `${at}: layout ${w.value} cm is wider than the shelf ${w.limit} cm`;
    case 'too_tall': return `${at}: height ${w.value} cm exceeds the clearance ${w.limit} cm`;
    case 'too_deep': return `${at}: depth ${w.value} cm exceeds the shelf depth ${w.limit} cm`;
    case 'fixture_too_tall': return `${at}: shelves need ${w.value} cm, the fixture is ${w.limit} cm tall`;
    case 'shelf_too_wide': return `${at}: board ${w.value} cm is wider than the fixture ${w.limit} cm`;
    case 'shelf_too_deep': return `${at}: board ${w.value} cm is deeper than the fixture ${w.limit} cm`;
    default: return `${at}: no dimensions - set them on the product`;
  }
}
