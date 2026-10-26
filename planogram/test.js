// planogram/test.js - unit tests of the planogram library: `node planogram/test.js` (importing the module runs
// nothing). Rotations and turns, normalisers, the fit check (ported from the retail platform's tests) with squeeze
// and pegboards, fixture checks, auto depth / stack / facings, space shares, capacity and days of supply, shelf
// metrics, macro space, version diff and the front-view SVG.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultShelves, effectiveDims, effectiveStatus, normalizeFixture, normalizePlanogram, normalizePosition, normalizeProduct } from './model.js';
import { autoDepth, autoDepthShelf, checkFixture, checkShelves, maxFacings, maxStack, warningText } from './fit.js';
import { capacity, daysOfSupply, macroSpace, productCapacity, shelfMetrics, spaceBy, supplyReport } from './space.js';
import { diffPlanogram, isEmptyDiff } from './diff.js';
import { frontLayout, frontSVG, keyColor } from './svg.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const P = (productId, fx = 1, fy = 1, fz = 1, rot = 0, turn = 0) => ({ productId, fx, fy, fz, rot, turn });

  // --- dimensions and normalisers ----------------------------------------------------------------------------------
  const d = { width: 10, height: 20, depth: 5 };
  eq('dims 0', effectiveDims(d, 0, 0), { width: 10, height: 20, depth: 5 });
  eq('dims rot 90', effectiveDims(d, 90, 0), { width: 20, height: 10, depth: 5 });
  eq('dims rot 180', effectiveDims(d, 180, 0), d);
  eq('dims turn', effectiveDims(d, 0, 90), { width: 5, height: 20, depth: 10 });
  eq('dims turn + rot', effectiveDims(d, 90, 90), { width: 20, height: 5, depth: 10 });
  eq('position clamp', normalizePosition({ modelId: 'a', fx: 500, fy: 0, fz: '3', rot: 45, turn: 90 }), { productId: 'a', fx: 100, fy: 1, fz: 3, rot: 0, turn: 90 });
  const np = normalizeProduct({ id: 'x', name: 'Milk', width: '7.25', height: -1, depth: 7, squeeze: { x: 80, y: 10 } });
  eq('product', [np.width, np.height, np.depth, np.squeeze], [7.3, null, 7, { x: 50, y: 10, z: 0 }]);
  eq('product legacy squeeze', normalizeProduct({ squeeze_z: 12 }).squeeze.z, 12);
  eq('default shelves', defaultShelves({ width: 120, depth: 50, height: 210 }, 4).map((s) => [s.width, s.depth, s.height]), Array(4).fill([120, 50, 50]));
  const nf = normalizeFixture({ width: 90, height: 180, shelfCount: 3 });
  eq('fixture default shelves', [nf.shelves.length, nf.shelves[0].height], [3, 57]);
  eq('peg shelf', normalizeFixture({ shelves: [{ kind: 'peg', width: 100 }] }).shelves[0].pitch, 2.5);
  eq('status expiry', [effectiveStatus({ status: 'active', expiresAt: 100 }, 200), effectiveStatus({ status: 'active', expires_at: 300 }, 200), effectiveStatus({ status: 'archived', expiresAt: 100 }, 200)], ['expired', 'active', 'archived']);
  const tmp = normalizePlanogram({ type: 'temporary' }, 1000);
  eq('temporary default expiry', tmp.expiresAt, 1000 + 3 * 86400000);
  eq('expiry date string', normalizePlanogram({ expiresAt: '2027-01-31' }).expiresAt, Date.parse('2027-01-31T23:59:59.999Z'));

  // --- fit check (ported) ------------------------------------------------------------------------------------------
  const dims = { a: { width: 10, height: 20, depth: 5 }, b: { width: 30, height: 10, depth: 10 }, c: { width: null, height: 1, depth: 1 } };
  const shelves = [
    { width: 100, height: 40, depth: 40, positions: [P('a', 4, 2, 8), P('b', 2, 1, 4)] },
    { width: 50, height: 30, depth: 30, positions: [P('a', 3, 2, 7), P('b')] },
    { width: 50, height: 30, depth: 30, positions: [P('c')] },
  ];
  const r = checkShelves(shelves, (id) => dims[id]);
  eq('shelf 0', [r.shelves[0].usedWidth, r.shelves[0].freeWidth, r.shelves[0].fill], [100, 0, 100]);
  eq('shelf 1 used', [r.shelves[1].usedWidth, r.shelves[1].overflow], [60, 10]);
  eq('ok false', r.ok, false);
  eq('warnings', r.warnings, [
    { code: 'too_tall', shelf: 1, pos: 0, productId: 'a', value: 40, limit: 30 },
    { code: 'too_deep', shelf: 1, pos: 0, productId: 'a', value: 35, limit: 30 },
    { code: 'too_wide', shelf: 1, value: 60, limit: 50 },
    { code: 'no_dimensions', shelf: 2, pos: 0, productId: 'c' },
  ]);
  eq('ok one shelf', checkShelves([shelves[0]], dims).ok, true);
  eq('lookup kinds', [checkShelves([shelves[0]], new Map(Object.entries(dims))).ok, checkShelves([shelves[0]], [{ id: 'a', ...dims.a }, { id: 'b', ...dims.b }]).ok], [true, true]);
  // squeeze: 11 packs of 10 cm on 100 cm fit when the pack squeezes 10 %
  const soft = { s: { width: 10, height: 10, depth: 10, squeeze: { x: 10, y: 0, z: 0 } } };
  const sq = checkShelves([{ width: 100, height: 20, depth: 20, positions: [P('s', 11)] }], soft);
  eq('squeezed', [sq.ok, sq.shelves[0].squeezed, sq.shelves[0].usedWidth, sq.shelves[0].minWidth], [true, true, 110, 99]);
  eq('squeeze not enough', checkShelves([{ width: 100, height: 20, depth: 20, positions: [P('s', 12)] }], soft).ok, false);
  // squeeze turns with the pack: sideways the width squeeze becomes depth squeeze
  eq('squeeze turns', checkShelves([{ width: 100, height: 20, depth: 10, positions: [P('s', 1, 1, 1, 0, 90)] }], { s: { width: 11, height: 10, depth: 10, squeeze: { x: 10 } } }).ok, true);
  // pegboard: 3 cm wide packs on a 5 cm pitch take 5 cm per column
  const peg = checkShelves([{ kind: 'peg', pitch: 5, width: 20, height: 30, depth: 30, positions: [P('h', 4)] }], { h: { width: 3, height: 10, depth: 5 } });
  eq('peg pitch', [peg.shelves[0].usedWidth, peg.ok], [20, true]);
  eq('warning text', warningText(r.warnings[0], (id) => ({ a: 'Socks' })[id]), 'Shelf 2, position 1 "Socks": height 40 cm exceeds the clearance 30 cm');

  const fx = { width: 100, height: 100, depth: 40, base: 10, shelves: [{ width: 100, height: 40, depth: 40, thickness: 3, positions: [] }, { width: 110, height: 50, depth: 45, thickness: 3, positions: [] }] };
  const cf = checkFixture(fx, {});
  eq('fixture codes', cf.warnings.map((w) => w.code), ['fixture_too_tall', 'shelf_too_wide', 'shelf_too_deep']);
  eq('fixture totals', cf.totals, { shelfWidth: 210, usedWidth: 0, fill: 0, stackHeight: 106 });

  // --- auto facings ------------------------------------------------------------------------------------------------
  const sh = { width: 100, height: 35, depth: 40, positions: [P('a'), P('b', 2)] };
  eq('auto depth', [autoDepth(dims.a, sh), autoDepth(dims.b, sh), autoDepth(dims.a, sh, 0, 90), autoDepth(dims.c, sh)], [8, 4, 4, null]);
  eq('max stack', [maxStack(dims.a, sh), maxStack(dims.a, sh, 90)], [1, 3]);
  eq('auto depth shelf', autoDepthShelf(sh, dims, { stack: true }).positions.map((p) => [p.fy, p.fz]), [[1, 8], [3, 4]]);
  eq('max facings', [maxFacings(sh, dims, 0), maxFacings(sh, dims, 1)], [4, 3]);

  // --- space, capacity, supply -------------------------------------------------------------------------------------
  const products = [
    { id: 'a', name: 'A', category: 'dairy', brand: 'X', width: 10, height: 20, depth: 5, dailySales: 16, cost: 1, stock: 10 },
    { id: 'b', name: 'B', category: 'dairy', brand: 'Y', width: 30, height: 10, depth: 10, dailySales: 0.1, stock: 0 },
    { id: 'd', name: 'D', category: 'bread', brand: 'X', width: 20, height: 10, depth: 10, caseUnits: 12 },
  ];
  const fixture = { shelves: [{ width: 100, height: 40, depth: 40, positions: [P('a', 4, 2, 8), P('b', 2, 1, 4)] }, { width: 100, height: 40, depth: 40, positions: [P('d', 2, 1, 4), P('a', 1, 1, 8)] }] };
  eq('capacity', capacity(P('a', 4, 2, 8)), 64);
  const byCat = spaceBy(fixture, products, 'category');
  eq('space by category', byCat.rows.map((x) => [x.key, x.width, x.metres, x.share, x.skus]), [['dairy', 110, 1.1, 0.7333, 2], ['bread', 40, 0.4, 0.2667, 1]]);
  eq('space total', byCat.total, { shelfMetres: 2, usedMetres: 1.5, fill: 75, unknown: 0 });
  eq('space by brand', spaceBy([fixture], products, 'brand').rows.map((x) => [x.key, x.width]), [['X', 90], ['Y', 60]]);
  eq('space by fn', spaceBy(fixture, products, (pr) => (pr.width > 15 ? 'big' : 'small')).rows.map((x) => x.key), ['big', 'small']);
  eq('product capacity', [...productCapacity(fixture)], [['a', { units: 72, facings: 5, positions: 2 }], ['b', { units: 8, facings: 2, positions: 1 }], ['d', { units: 8, facings: 2, positions: 1 }]]);
  eq('days of supply', [daysOfSupply(72, 16), daysOfSupply(5, 0)], [4.5, null]);
  eq('supply report', supplyReport(fixture, products, { maxDays: 30 }).map((x) => [x.productId, x.days, x.status]), [['a', 4.5, 'ok'], ['b', 80, 'high'], ['d', null, 'no_sales']]);
  eq('supply low / case', supplyReport(fixture, products, { sales: { a: 40, d: 2 } }).map((x) => [x.productId, x.status]), [['a', 'low'], ['d', 'below_case'], ['b', 'high']]);
  const met = shelfMetrics(fixture, products, { a: { qty: 10, revenue: 50 }, b: { qty: 1, revenue: 20 } });
  eq('metrics', [met.metres, met.revenue, met.grossProfit, met.profitPartial, met.revenuePerMetre, met.noStock], [2, 70, 40, true, 35, ['b']]);
  const macro = macroSpace(byCat, { dairy: { revenue: 50, profit: 10 }, bread: { revenue: 50, profit: 10 } });
  eq('macro', macro.map((x) => [x.key, x.spaceShare, x.salesShare, x.recommendedMetres, x.verdict]), [['dairy', 0.7333, 0.5, 0.75, 'over'], ['bread', 0.2667, 0.5, 0.75, 'under']]);
  eq('macro sales without space', macroSpace(byCat, { dairy: { revenue: 70 }, bread: { revenue: 30 }, fish: { revenue: 0 } }).map((x) => x.verdict), ['ok', 'ok', 'ok']);

  // --- diff --------------------------------------------------------------------------------------------------------
  const v1 = { shelves: [{ width: 100, height: 40, depth: 40, positions: [P('a', 2), P('b')] }, { width: 100, height: 40, depth: 40, positions: [P('c')] }] };
  const v2 = { shelves: [{ width: 100, height: 40, depth: 40, positions: [P('a', 3), P('d')] }, { width: 100, height: 35, depth: 40, positions: [P('b')] }, { width: 100, height: 30, depth: 40, positions: [] }] };
  const df = diffPlanogram(v1, v2, (id) => id.toUpperCase());
  eq('diff added', df.added, [{ productId: 'd', name: 'D', shelves: [1], facings: 1, units: 1 }]);
  eq('diff removed', df.removed.map((x) => x.productId), ['c']);
  eq('diff changed', df.changed.map((x) => [x.productId, x.fields]), [['a', ['facings', 'units']], ['b', ['shelves']]]);
  eq('diff shelves', df.shelves.map((x) => [x.shelf, x.change]), [[2, 'resized'], [3, 'added']]);
  eq('diff empty', isEmptyDiff(diffPlanogram(v1, JSON.parse(JSON.stringify(v1)))), true);
  eq('diff legacy fields', diffPlanogram([{ positions: [{ modelId: 'm', facings: 2 }] }], [{ positions: [{ modelId: 'm', fx: 3 }] }]).changed[0].from.facings, 2);

  // --- front view --------------------------------------------------------------------------------------------------
  const f2 = { name: 'Rack 1', width: 100, height: 120, depth: 40, base: 10, shelves: [
    { width: 100, height: 40, depth: 40, thickness: 3, positions: [P('a', 4, 2, 8), P('b', 3, 1, 4)] },
    { kind: 'peg', pitch: 5, width: 100, height: 30, depth: 30, thickness: 3, positions: [P('d', 2), P('zz')] },
  ] };
  const L = frontLayout(f2, products);
  eq('layout size', [L.width, L.height, L.inner], [138, 89, 100]);
  eq('layout overflow', L.overflow.map((o) => [o.shelf, o.w, o.squeezed]), [[0, 30, false]]);
  eq('layout blocks', L.blocks.map((b) => [b.productId, b.x, b.y, b.w, b.h, b.cells.length, b.known]), [['a', 4, 3, 40, 40, 8, true], ['b', 44, 33, 90, 10, 3, true], ['d', 4, 47.5, 40, 10, 2, true], ['zz', 44, 47.5, 10, 10, 1, false]]);
  eq('layout flags', [L.blocks[1].bad, L.blocks[1].noStock, L.blocks[0].bad], [false, true, false]);
  eq('legend', L.legend.map((x) => x.key), ['dairy', 'bread', null]);
  eq('key colour stable', [keyColor('dairy') === keyColor('dairy'), keyColor('dairy') !== keyColor('bread'), keyColor(null)], [true, true, 'hsl(220 10% 80%)']);
  const svg = frontSVG(f2, products, { legend: true, title: 'Rack <1>' });
  eq('svg root', /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="[\d.]+" height="[\d.]+" viewBox="-2 /.test(svg), true);
  eq('svg parts', ['class="pg-over"', 'url(#pg-peg-5)', '×8', 'data-pos="1:1"', 'Rack &lt;1&gt;', '>dairy<', '>other<'].map((s) => svg.includes(s)), Array(7).fill(true));
  eq('svg mm', /width="14.2mm"/.test(frontSVG(f2, products, { unit: 'mm', ratio: 100 })), true);
  eq('svg balanced', (svg.match(/<g /g) || []).length, (svg.match(/<\/g>/g) || []).length);

  console.log(`planogram: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
