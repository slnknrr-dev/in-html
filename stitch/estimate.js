// stitch/estimate.js - what a scheme needs: thread length and skeins per colour (by fabric count, strands and stitch
// kind), the shopping list (blends split into their threads), finished and fabric size with margins, the legend
// rows, statistics (coverage, confetti, colour changes, difficulty, time).
//
//   threadLength(kind, { count, strands }) -> cm of thread for one stitch (all its strands)
//   legend(scheme, opts) -> [{ index, entry, symbol, label, name, hex, strands, full, half, quarter, three, petite,
//                              back, straight, knots, beads, stitches, lengthCm, skeins }]
//   shoppingList(scheme, opts) -> [{ catalog, brand, code, name, hex, lengthCm, skeins, stitches }]
//   fabricSize(scheme, { count, margin (cm) }) -> { stitchesW, stitchesH, finishedCm: [w, h], finishedIn: [w, h],
//                                                  fabricCm: [w, h], fabricIn: [w, h] }
//   stats(scheme) -> { stitches, full, parts, backLength, knots, beads, colors, blends, coverage, confetti,
//                      changesPerRow, difficulty (1..5), hours: [min, max] }
//   SKEIN = { meters, strands } defaults; opts: { count, strands (cross stitch strands, default the entry's),
//   waste (fraction, default 0.2), skeinMeters (default by brand) }
//
// Lengths: a cross is two diagonals on the front (2·√2·s) and about two cell sides on the back (2·s), s = 2.54 cm /
// count, for every strand; a half is half of it, a quarter about a quarter, a three-quarter three quarters, a petite
// a quarter at double density. Backstitch uses about 2.5 × its length (front + back travel), straight stitches 2×,
// a French knot about 3 cm, a bead 2 cell sides of thread. `waste` covers starting and ending tails and travel.

// Design rules:
// - Every length is in centimetres of single strand ("strand-cm"): a stitch with 2 strands costs twice the thread.
//   A skein is skeinMeters x 100 x strands strand-cm, so strands cancel out and skein counts need no per-entry case.
// - Estimates err on the generous side (waste, ceil, minimum 1 skein for any used colour): running out of a dye lot
//   mid-project is worse than one spare skein.
// - Inputs are the flattened visible layers (model.flatten): what will actually be stitched, hidden layers excluded.
import { flatten, usage, entryLabel } from './model.js';
import { BRANDS } from './threads.js';

// Per-stitch thread in units of the cell side s. full = 2 diagonals on the front (2 x sqrt2) + ~2 sides travelling
// on the back. Fractional values are empirical approximations of the same model. petite is used with s / 2 in
// entryLength (a small cross in a quarter cell), which makes it a quarter of a full cross.
const SQ2 = Math.SQRT2;
export const PER_STITCH = { full: 2 * SQ2 + 2, half: SQ2 + 1, quarter: SQ2 / 2 + 0.6, three: SQ2 * 1.5 + 1.6, petite: SQ2 + 1 };

export function threadLength(kind, { count = 14, strands = 2 } = {}) {
  const s = 2.54 / count;
  return (PER_STITCH[kind] || PER_STITCH.full) * s * strands;
}

// Explicit option wins, then the brand's skein length, then 8 m (the most common stranded-cotton skein).
const skeinOf = (catalogId, o) => {
  if (o.skeinMeters) return o.skeinMeters;
  const b = BRANDS.find((x) => x.id === catalogId);
  return b ? b.skeinMeters : 8;
};

// Thread (cm, all strands counted) of one palette entry from its usage.
// Lines use bsStrands, crosses use strands: backstitch is typically worked with fewer strands. Knots: ~3 cm per
// wrap, clamped to 1..3 wraps by strand count. A count from opts overrides the fabric (estimating for another fabric).
function entryLength(u, e, count, waste, strandsOverride) {
  const st = strandsOverride || e.strands || 2;
  const s = 2.54 / count;
  let cm = 0;
  cm += u.full * PER_STITCH.full * s * st;
  cm += u.half * PER_STITCH.half * s * st;
  cm += u.quarter * PER_STITCH.quarter * s * st;
  cm += u.three * PER_STITCH.three * s * st;
  cm += u.petite * PER_STITCH.petite * (s / 2) * st;
  const bs = e.bsStrands || 1;
  cm += u.back * s * 2.5 * bs + u.straight * s * 2 * bs;
  cm += u.knots * 3 * Math.max(1, Math.min(st, 3));
  cm += u.beads * s * 2;
  return cm * (1 + waste);
}

// Rows parallel to scheme.palette (index i = entry i), so callers can join by index. skeins: beads need none; any
// used colour gets at least 1; the -1e-9 guards against 2.0000000001 rounding up to 3 after float accumulation.
export function legend(scheme, opts = {}) {
  const count = opts.count || scheme.fabric.count || 14;
  const waste = opts.waste ?? 0.2;
  const u = usage(scheme, opts.layer || flatten(scheme));
  return scheme.palette.map((e, i) => {
    const x = u[i];
    const lengthCm = entryLength(x, e, count, waste, opts.strands);
    // A blend uses one strand of each thread: the skeins of its threads come from the shopping list.
    const per = e.blend ? lengthCm / e.blend.length : lengthCm;
    const skeinCm = skeinOf(e.catalog, opts) * 100 * 6;
    return {
      index: i, entry: e, symbol: e.symbol, label: entryLabel(e), name: e.name, hex: e.hex, strands: opts.strands || e.strands, kind: e.kind,
      full: x.full, half: x.half, quarter: x.quarter, three: x.three, petite: x.petite, back: x.back, straight: x.straight, knots: x.knots, beads: x.beads,
      stitches: x.total, lengthCm, skeins: e.kind === 'bead' ? 0 : Math.max(x.total + x.back + x.straight + x.knots > 0 ? 1 : 0, Math.ceil(per / skeinCm - 1e-9)),
    };
  });
}

// What to buy: blends are split into their threads (share = 1 / n of the blend's thread) and merged with single
// uses of the same thread, so a colour used alone and in a blend appears once. Skeins are recomputed from the merged
// length, not summed from legend rows (summing ceilings would overbuy).
export function shoppingList(scheme, opts = {}) {
  const rows = legend(scheme, opts);
  const map = new Map();
  for (const r of rows) {
    const e = r.entry;
    const parts = e.blend && e.blend.length ? e.blend.map((b) => ({ ...b, share: 1 / e.blend.length })) : [{ catalog: e.catalog, brand: e.brand, code: e.code, name: e.name, hex: e.hex, share: 1 }];
    for (const p of parts) {
      const key = (p.catalog || p.brand) + ':' + (p.code || p.hex);
      const cur = map.get(key) || { catalog: p.catalog, brand: p.brand, code: p.code, name: p.name, hex: p.hex, lengthCm: 0, stitches: 0, bead: e.kind === 'bead', beads: 0 };
      cur.lengthCm += r.lengthCm * p.share;
      cur.stitches += r.stitches * p.share;
      cur.beads += r.beads;
      map.set(key, cur);
    }
  }
  const list = [...map.values()].map((x) => ({ ...x, skeins: x.bead ? 0 : Math.max(1, Math.ceil(x.lengthCm / (skeinOf(x.catalog, opts) * 100 * 6) - 1e-9)) }));
  const key = (c) => (/^\d+/.test(c) ? parseInt(c, 10) : -1);
  return list.sort((a, b) => (a.brand || '').localeCompare(b.brand || '') || key(a.code) - key(b.code) || String(a.code).localeCompare(String(b.code)));
}

// An explicit count without countY means square cells on that fabric; otherwise the scheme's own countY applies.
// margin (cm, per side) is the unstitched border for framing / hoop; 5 cm is a common minimum.
export function fabricSize(scheme, { count, countY, margin = 5 } = {}) {
  const cx = count || scheme.fabric.count || 14, cy = countY || (count ? count : scheme.fabric.countY || cx);
  const fw = scheme.width / cx, fh = scheme.height / cy;
  const r1 = (v) => Math.round(v * 10) / 10;
  return {
    stitchesW: scheme.width, stitchesH: scheme.height,
    finishedIn: [r1(fw), r1(fh)], finishedCm: [r1(fw * 2.54), r1(fh * 2.54)],
    fabricCm: [r1(fw * 2.54 + 2 * margin), r1(fh * 2.54 + 2 * margin)], fabricIn: [r1(fw + (2 * margin) / 2.54), r1(fh + (2 * margin) / 2.54)],
  };
}

// Statistics of a scheme (the flattened visible layers).
// One O(W x H x 8) pass. confetti = full crosses with no same-colour 8-neighbour (each is a thread start and end, the
// main source of tedium). changes counts colour switches along a row; empty cells do not reset prev, because a
// stitcher still switches needles across a gap. The difficulty weights and hour rates are heuristics calibrated by
// eye, not measured data; treat them as relative.
export function stats(scheme, layer = flatten(scheme)) {
  const u = usage(scheme, layer);
  const W = scheme.width, H = scheme.height;
  const c = layer.cells;
  let full = 0, confetti = 0, changes = 0, rows = 0;
  for (let y = 0; y < H; y++) {
    let prev = 0, any = false;
    for (let x = 0; x < W; x++) {
      const v = c[y * W + x];
      if (!v) continue;
      full++;
      any = true;
      if (prev && v !== prev) changes++;
      prev = v;
      let same = 0;
      for (let dy = -1; dy <= 1 && !same; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && c[yy * W + xx] === v) { same = 1; break; }
      }
      if (!same) confetti++;
    }
    if (any) rows++;
  }
  const parts = layer.parts.length;
  const backLength = u.reduce((a, x) => a + x.back + x.straight, 0);
  const colors = scheme.palette.filter((_, i) => u[i].total + u[i].back + u[i].straight + u[i].knots + u[i].beads > 0).length;
  const blends = scheme.palette.filter((e, i) => e.blend && u[i].total > 0).length;
  const stitches = full + parts;
  const coverage = stitches / (W * H);
  const confettiShare = full ? confetti / full : 0;
  const changesPerRow = rows ? changes / rows : 0;
  // Difficulty 1..5 from colours, confetti, fractional stitches, colour changes and size.
  let score = 0;
  score += colors > 60 ? 2 : colors > 30 ? 1.4 : colors > 15 ? 0.8 : colors > 8 ? 0.4 : 0;
  score += confettiShare > 0.15 ? 1.2 : confettiShare > 0.05 ? 0.7 : confettiShare > 0.01 ? 0.3 : 0;
  score += parts / Math.max(1, stitches) > 0.05 ? 0.6 : parts ? 0.3 : 0;
  score += changesPerRow / Math.max(1, W) > 0.3 ? 0.6 : changesPerRow / Math.max(1, W) > 0.1 ? 0.3 : 0;
  score += stitches > 60000 ? 0.8 : stitches > 15000 ? 0.5 : stitches > 3000 ? 0.2 : 0;
  score += blends ? 0.3 : 0;
  score += backLength > 0 ? 0.2 : 0;
  const difficulty = Math.max(1, Math.min(5, Math.round(1 + score)));
  // About 60 to 120 crosses an hour, slower with confetti and many colours.
  const slow = 1 + confettiShare * 2 + colors / 100;
  const units = stitches + backLength * 0.5 + u.reduce((a, x) => a + x.knots * 2 + x.beads, 0);
  return {
    stitches, full, parts, backLength, knots: u.reduce((a, x) => a + x.knots, 0), beads: u.reduce((a, x) => a + x.beads, 0),
    colors, blends, coverage, confetti: confettiShare, changesPerRow, difficulty,
    hours: [Math.round((units * slow) / 120), Math.round((units * slow) / 60)],
  };
}
