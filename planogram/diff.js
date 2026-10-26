// planogram/diff.js - comparison of two versions of a fixture (or of two shelf lists): products added, removed, or
// changed (moved to other shelves, different width facings or units), and shelves whose board changed (width,
// clearance, depth, kind) or that were added / removed. Shelf numbers are 1-based as people count them.
//
// Products are compared as aggregates per product id (set of shelves, total facings, total units), not position by
// position: reordering positions within a shelf is not a merchandising change, and position indexes shift on every
// insert, which would turn a one-product move into a cascade of false "changed" rows. Shelves, by contrast, are
// compared by index because a fixture's shelf order is physical.

import { capacity, shelvesOf } from './space.js';

const pid = (p) => p.productId ?? p.modelId;

// productId -> { shelves: sorted 1-based numbers, facings: sum of fx, units }
function flat(shelves) {
  const m = new Map();
  shelves.forEach((s, si) => (s.positions ?? []).forEach((p) => {
    if (!pid(p)) return;
    const cur = m.get(pid(p)) ?? { shelves: new Set(), facings: 0, units: 0 };
    cur.shelves.add(si + 1);
    cur.facings += Number(p.fx ?? p.facings ?? 1);
    cur.units += capacity({ fx: p.fx ?? 1, fy: p.fy ?? 1, fz: p.fz ?? 1 });
    m.set(pid(p), cur);
  }));
  for (const v of m.values()) v.shelves = [...v.shelves].sort((a, b) => a - b);
  return m;
}

/**
 * -> { added: [{ productId, name, shelves, facings, units }], removed: [...],
 *      changed: [{ productId, name, from, to, fields: ['shelves' | 'facings' | 'units'] }],
 *      shelves: [{ shelf, change: 'added' | 'removed' | 'resized', from?, to? }] }
 * `from` / `to`: fixtures, arrays of fixtures or shelf arrays; nameOf(productId) fills names.
 */
export function diffPlanogram(from, to, nameOf = () => null) {
  const sa = shelvesOf(from), sb = shelvesOf(to);
  const A = flat(sa), B = flat(sb);
  const added = [], removed = [], changed = [];
  const row = (id, x) => ({ productId: id, name: nameOf(id), shelves: x.shelves, facings: x.facings, units: x.units });
  for (const [id, b] of B) {
    const a = A.get(id);
    if (!a) { added.push(row(id, b)); continue; }
    const fields = [];
    if (a.shelves.join() !== b.shelves.join()) fields.push('shelves');
    if (a.facings !== b.facings) fields.push('facings');
    if (a.units !== b.units) fields.push('units');
    if (fields.length) changed.push({ productId: id, name: nameOf(id), from: { shelves: a.shelves, facings: a.facings, units: a.units }, to: { shelves: b.shelves, facings: b.facings, units: b.units }, fields });
  }
  for (const [id, a] of A) if (!B.has(id)) removed.push(row(id, a));
  const geo = (s) => ({ kind: s.kind ?? 'shelf', width: s.width, height: s.height, depth: s.depth });
  const shelves = [];
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    if (!sa[i]) shelves.push({ shelf: i + 1, change: 'added', to: geo(sb[i]) });
    else if (!sb[i]) shelves.push({ shelf: i + 1, change: 'removed', from: geo(sa[i]) });
    else if (JSON.stringify(geo(sa[i])) !== JSON.stringify(geo(sb[i]))) shelves.push({ shelf: i + 1, change: 'resized', from: geo(sa[i]), to: geo(sb[i]) });
  }
  return { added, removed, changed, shelves };
}

export const isEmptyDiff = (d) => !d.added.length && !d.removed.length && !d.changed.length && !d.shelves.length;
