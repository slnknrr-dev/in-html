// plan/test.js - unit tests of the plan library: `node plan/test.js` (importing the module runs nothing). Polygon
// measures, snapping and rotation, rotated boxes and hit tests, corner / handle resizes keeping the opposite corner,
// fit-to-view and zoom, the model (clamps, polygon rooms, layers, the old seating chart, retail plans both ways,
// editing operations), seat / area / sleeping summaries and room places (ported from the portal's tests), overlaps,
// aisles, out-of-page items, the undo history and the SVG output.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bounds, center, centroid, corners, edgeLengths, fitView, handleAngle, hitShape, inRect, insertVertex, perimeter, pick, pointInPolygon, polygonArea,
  rectOutline, removeVertex, resizeCorner, resizeHandle, rotatePoint, screenToPlan, shapeBox, snap, snapAngle, toLocal, toPlan, zoomAt,
} from './geom.js';
import { STENCILS, color, esc, palette, shapeArea, stencil } from './stencils.js';
import { duplicateShape, fromRetailPlan, fromSeating, makeShape, moveShapes, normalizePlan, normalizeShape, reorder, toRetailPlan, visibleShapes, isLocked } from './model.js';
import { areaSummary, narrowAisles, outsidePage, overlaps, polygonGap, roomPlaces, seatSummary, shapesInRoom, sleepSummary } from './summary.js';
import { createHistory } from './history.js';
import { niceLength, pageSVG, planCss } from './svg.js';

// Run only when executed directly; importing run() has no side effects.
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const near = (name, got, want, tol = 1e-6) => {
    const flat = (v) => (Array.isArray(v) ? v.flat(Infinity) : typeof v === 'object' ? Object.values(v) : [v]);
    const g = flat(got), w = flat(want);
    if (g.length === w.length && g.every((x, i) => Math.abs(x - w[i]) <= tol)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const floor = (shapes, extra = {}) => normalizePlan({ v: 1, kind: 'floor', pages: [{ id: 'p1', name: 'Floor 1', w: 20, h: 12, shapes, ...extra }] });

  // --- polygons ----------------------------------------------------------------------------------------------------
  const L = [[0, 0], [6, 0], [6, 3], [3, 3], [3, 5], [0, 5]];                  // an L-shaped flat
  eq('area', polygonArea(L), 24);
  eq('area ccw', polygonArea(L.slice().reverse()), 24);
  eq('perimeter', perimeter(L), 22);
  eq('edges', edgeLengths(L), [6, 3, 3, 2, 3, 5]);
  near('centroid rect', centroid(rectOutline(4, 2, 1, 1)), [3, 2]);
  near('centroid L', centroid(L), [2.625, 2.125]);
  eq('inside', [pointInPolygon(L, [1, 4]), pointInPolygon(L, [5, 4]), pointInPolygon(L, [6, 1]), pointInPolygon(L, [3, 4])], [true, false, true, true]);
  eq('insert vertex', insertVertex(rectOutline(4, 2), 0, null, 0.5), [[0, 0], [2, 0], [4, 0], [4, 2], [0, 2]]);
  eq('remove vertex keeps 3', [removeVertex(L, 0).length, removeVertex([[0, 0], [1, 0], [0, 1]], 0).length], [5, 3]);

  // --- snapping, rotation ------------------------------------------------------------------------------------------
  eq('snap', [snap(1.26, 0.5), snap(1.2000000004), snap(-0.26, 0.5)], [1.5, 1.2, -0.5]);
  eq('snap angle', [snapAngle(52), snapAngle(-10), snapAngle(359), snapAngle(37.3, 0)], [45, 345, 0, 37.3]);
  near('rotate', rotatePoint([2, 1], 90, [1, 1]), [1, 2]);
  const sh = { x: 0, y: 0, w: 4, h: 2, rot: 90 };
  near('corners rot 90', corners(sh), [[3, -1], [3, 3], [1, 3], [1, -1]]);
  near('box rot 90', shapeBox(sh), { x: 1, y: -1, w: 2, h: 4 });
  near('box rot 45', shapeBox({ x: 0, y: 0, w: 2, h: 2, rot: 45 }), { x: 1 - Math.SQRT2, y: 1 - Math.SQRT2, w: 2 * Math.SQRT2, h: 2 * Math.SQRT2 });
  near('local / plan', toPlan(sh, toLocal(sh, [2.5, 0.3])), [2.5, 0.3]);
  eq('hit rotated', [hitShape(sh, [2, 2.9]), hitShape(sh, [3.5, 1])], [true, false]);
  eq('hit flat line band', [hitShape({ x: 0, y: 1, w: 3, h: 0, rot: 0 }, [1, 1.08]), hitShape({ x: 0, y: 1, w: 3, h: 0, rot: 0 }, [1, 1.2])], [true, false]);
  eq('pick topmost', pick([{ id: 'a', x: 0, y: 0, w: 4, h: 4 }, { id: 'b', x: 1, y: 1, w: 1, h: 1 }], [1.5, 1.5]).id, 'b');
  eq('in rect', inRect([{ id: 'a', x: 0, y: 0, w: 1, h: 1 }, { id: 'b', x: 3, y: 0, w: 2, h: 1 }], { x: -0.1, y: -0.1, w: 4, h: 2 }).map((s) => s.id), ['a']);
  eq('handle angle', [handleAngle({ x: 0, y: 0, w: 2, h: 2 }, [1, -5]), handleAngle({ x: 0, y: 0, w: 2, h: 2 }, [5, 1.4])], [0, 90]);

  // --- resizes -----------------------------------------------------------------------------------------------------
  const r0 = { x: 0, y: 0, w: 2, h: 1, rot: 0 };
  eq('corner resize', resizeCorner(r0, [3.04, 2.1], { step: 0.1 }), { x: 0, y: 0, w: 3, h: 2.1, rot: 0 });
  const rr = { x: 0, y: 0, w: 2, h: 1, rot: 30 };
  const tl0 = corners(rr)[0];
  const grown = resizeCorner(rr, toPlan(rr, [3, 2]));
  near('corner resize rotated keeps top-left', corners(grown)[0], tl0, 1e-3);
  near('corner resize rotated size', [grown.w, grown.h], [3, 2], 1e-3);
  eq('corner resize min', resizeCorner(r0, [-5, -5], { step: 0.5 }).w, 0.5);
  eq('handle w', resizeHandle(r0, 'w', 0.5, 0), { x: 0.5, y: 0, w: 1.5, h: 1, rot: 0 });
  eq('handle nw', resizeHandle(r0, 'nw', -1, -1), { x: -1, y: -1, w: 3, h: 2, rot: 0 });
  eq('handle keep ratio', resizeHandle({ x: 0, y: 0, w: 2, h: 2 }, 'sw', -1, 0, { keepRatio: true }), { x: -1, y: 0, w: 3, h: 3 });
  eq('handle flat', resizeHandle({ x: 0, y: 0, w: 2, h: 0 }, 'se', 1, 1, { flat: true }), { x: 0, y: 0, w: 3, h: 0 });

  // --- views -------------------------------------------------------------------------------------------------------
  eq('bounds', bounds([{ x: 1, y: 1, w: 2, h: 1 }], [[[0, 5], [1, 6]]]), { x: 0, y: 1, w: 3, h: 5 });
  eq('bounds empty', bounds([]), null);
  const fv = fitView({ x: 0, y: 0, w: 10, h: 5 }, 1000, 1000, { margin: 0, pad: 0 });
  near('fit view', [fv.scale, fv.viewBox.x, fv.viewBox.y, fv.viewBox.w, fv.viewBox.h, fv.tx, fv.ty], [100, 0, -2.5, 10, 10, 0, 250]);
  near('zoom at', zoomAt({ x: 0, y: 0, w: 10, h: 10 }, [5, 5], 0.5), { x: 2.5, y: 2.5, w: 5, h: 5 });
  near('zoom clamp', zoomAt({ x: 0, y: 0, w: 10, h: 10 }, [0, 0], 0.001, { minW: 1 }).w, 1);
  near('screen to plan', screenToPlan({ x: 0, y: 0, w: 10, h: 5 }, 200, 200, 100, 100), [5, 2.5]);

  // --- stencils ----------------------------------------------------------------------------------------------------
  const fl = palette('floor').map((s) => s.key), hall = palette('hall').map((s) => s.key), shop = palette('shop').map((s) => s.key);
  eq('furniture in floor palette only', ['bed-double', 'sofa', 'wardrobe', 'bathtub'].map((k) => [fl.includes(k), hall.includes(k)]), Array(4).fill([true, false]));
  eq('shop palette', ['rack', 'gondola', 'fridge-upright', 'freezer-chest', 'checkout', 'pallet'].every((k) => shop.includes(k)) && !shop.includes('sofa'), true);
  eq('stencil fallback', stencil('nope').key, 'rect');
  eq('every stencil draws', Object.values(STENCILS).every((st) => typeof st.draw.call(st, { label: 'x', seats: 4 }, st.w || 1, st.h || 1) === 'string'), true);
  eq('colour allowlist', [color('#abc'), color('#abcde'), color('rgb(1,2,3)'), color('red;x', 'none'), color('None')], ['#abc', '', 'rgb(1,2,3)', 'none', 'none']);
  eq('escape', esc(`<a href="x">'`), '&lt;a href=&quot;x&quot;&gt;&#39;');
  eq('shape area', [shapeArea({ w: 2, h: 3 }), shapeArea({ w: 6, h: 5, pts: L })], [6, 24]);

  // --- model -------------------------------------------------------------------------------------------------------
  const sofa = normalizeShape({ kind: 'sofa', x: 1, y: 1, places: '3', note: 'unfold the sofa' }, 0);
  eq('sleep places', [sofa.places, sofa.note], [3, 'unfold the sofa']);
  eq('empty places = default', normalizeShape({ kind: 'bed-double', places: '' }, 0).places, undefined);
  eq('zero places', normalizeShape({ kind: 'armchair', places: 0 }, 0).places, 0);
  const wd = normalizeShape({ kind: 'wardrobe', places: 2, note: 'x', seats: 4 }, 0);
  eq('no places / seats on wardrobe', [wd.places, wd.note, wd.seats], [undefined, undefined, undefined]);
  const bad = normalizeShape({ id: 'a"b', kind: 'rect', x: 'NaN', y: 1e9, w: -1, h: 2.00000001, rot: 400, fill: 'url(javascript:1)', label: 'L'.repeat(200) }, 0);
  eq('clamps', [bad.id, bad.x, bad.y, bad.w, bad.h, bad.rot, bad.fill, bad.label.length], ['ab', 0, 500, 0.05, 2, 360, undefined, 80]);
  eq('line is flat', normalizeShape({ kind: 'line', w: 3, h: 2 }).h, 0);
  const poly = normalizeShape({ kind: 'room', x: 10, y: 10, pts: L.map(([x, y]) => [x + 1, y - 2]), roomKey: 'flat 1!' });
  eq('polygon room', [poly.x, poly.y, poly.w, poly.h, poly.pts[1], poly.roomKey, shapeArea(poly)], [11, 8, 6, 5, [6, 0], 'flat1', 24]);
  const pl = normalizePlan({ kind: 'shop', pages: [{ w: 5, h: 5, outline: [[0, 0], [12, 0], [12, 8], [0, 8]], layers: [{ id: 'a' }, { id: 'a' }, { id: 'b', visible: false }], shapes: [{ id: 's1', layer: 'b' }, { id: 's2', layer: 'zz' }, { id: 's3', layer: 'a' }] }] });
  const pg = pl.pages[0];
  eq('page grows to outline', [pg.w, pg.h, pg.layers.length, pl.grid], [12, 8, 2, 0.1]);
  eq('unknown layer dropped', pg.shapes.map((s) => s.layer ?? null), ['b', null, 'a']);
  eq('visible shapes', visibleShapes(pg).map((s) => s.id), ['s2', 's3']);
  eq('locked', isLocked({ layers: [{ id: 'a', locked: true }] }, {}), true);
  eq('empty plan', [normalizePlan(null).pages.length, normalizePlan({ kind: 'floor' }).pages[0].name], [1, 'Floor 1']);
  const seat = fromSeating({ tables: [{ id: 't1', x: 50, y: 50, seats: 10, name: 'No. 1' }, { id: 't2', shape: 'rect', x: 25, y: 10 }] });
  eq('from seating', seat.pages[0].shapes.map((s) => [s.kind, s.x, s.y, s.seats]), [['table-round', 7.2, 4.2, 10], ['table-rect', 2.8, 0.55, 8]]);
  eq('normalize old seating', normalizePlan({ tables: [{ x: 50, y: 50 }] }).pages[0].shapes[0].kind, 'table-round');

  const retail = { id: 'fp1', name: 'Hall', grid: 10, floor: 1, roomKind: 'hall', outline: [[0, 0], [1000, 0], [1000, 800], [0, 800]], layers: [{ id: 'zones', name: 'Zones' }, { id: 'equipment', name: 'Equipment' }, { id: 'labels', name: 'Labels' }],
    items: [{ id: 'i1', kind: 'equipment', equipmentId: 'eq1', x: 100, y: 200, w: 125, d: 50, rotation: 90, layer: 'equipment', label: 'Rack', color: null },
      { id: 'i2', kind: 'zone', x: 0, y: 0, w: 300, d: 200, rotation: 0, layer: 'zones', label: 'Fresh', color: '#4a3fd0' },
      { id: 'i3', kind: 'door', x: 450, y: 788, w: 90, d: 12, rotation: 0, layer: 'labels', label: 'Door' }] };
  const fr = fromRetailPlan(retail);
  const fp = fr.pages[0];
  eq('from retail', [fr.kind, fr.grid, fp.w, fp.h, fp.shapes.map((s) => [s.kind, s.x, s.y, s.w, s.h, s.rot, s.ref ?? null])],
    ['shop', 0.1, 10, 8, [['rack', 1, 2, 1.25, 0.5, 90, 'eq1'], ['zone', 0, 0, 3, 2, 0, null], ['door', 4.5, 7.88, 0.9, 0.9, 0, null]]]);
  const back = toRetailPlan(fp, fr.grid);
  eq('to retail', back.items.map((i) => [i.kind, i.equipmentId, i.x, i.y, i.w, i.d, i.rotation, i.layer]),
    [['equipment', 'eq1', 100, 200, 125, 50, 90, 'equipment'], ['zone', null, 0, 0, 300, 200, 0, 'zones'], ['door', null, 450, 788, 90, 12, 0, 'labels']]);
  eq('to retail outline', [back.outline[2], back.grid], [[1000, 800], 10]);

  const made = makeShape('table-round', 5, 5, { step: 0.5, id: 'n1' });
  eq('make shape centred', [made.id, made.x, made.y, made.seats], ['n1', 4, 4, 8]);
  const ep = { shapes: [{ id: 'a', x: 0, y: 0, w: 1, h: 1 }, { id: 'b', x: 2, y: 0, w: 1, h: 1 }, { id: 'c', x: 4, y: 0, w: 1, h: 1, mine: true }] };
  eq('move snapped', moveShapes(ep, ['a', 'c'], 0.26, 0.74, 0.5).shapes.map((s) => [s.x, s.y]), [[0.5, 0.5], [2, 0], [4.5, 0.5]]);
  eq('duplicate', duplicateShape(ep, 'c', { newIdFn: () => 'd' }).shapes.slice(-1)[0], { id: 'd', x: 4.4, y: 0.4, w: 1, h: 1 });
  eq('reorder', [reorder(ep, 'a', 'front'), reorder(ep, 'c', 'back'), reorder(ep, 'a', 'up'), reorder(ep, 'b', 'down')].map((p) => p.shapes.map((s) => s.id).join('')), ['bca', 'cab', 'bac', 'bac']);

  // --- summaries ---------------------------------------------------------------------------------------------------
  const hp = normalizePlan({ pages: [{ shapes: [{ kind: 'table-round', seats: 10 }, { kind: 'table-rect', seats: 6 }, { kind: 'chair-row', seats: 12 }, { kind: 'wall', seats: 8 }] }] }).pages[0];
  const ss = seatSummary(hp);
  eq('seat summary', [ss.tables, ss.seats, ss.byKind['chair-row']], [3, 28, { count: 1, seats: 12 }]);
  const flat = floor([
    { id: 'r1', kind: 'room', x: 0, y: 0, w: 5, h: 4, roomKey: 'bed1', roomType: 'bedroom' },
    { id: 'r2', kind: 'bath', x: 5, y: 0, w: 2, h: 2 },
    { id: 'r3', kind: 'kitchen', x: 5, y: 2, w: 3, h: 2.5 },
    { id: 'r4', kind: 'room', pts: L, x: 10, y: 0 },
    { id: 'b', kind: 'bed-double', x: 1, y: 1, w: 1.6, h: 2, label: 'Big' },
    { id: 's', kind: 'sofa', x: 12, y: 1, w: 2, h: 0.9 },
    { id: 't', kind: 'table', x: 2, y: 3, w: 1, h: 0.6 },
  ], { outline: rectOutline(20, 12) });
  const as = areaSummary(flat.pages[0]);
  eq('area summary', [as.rooms, as.area, as.living, as.service, as.byType.bath, as.byType.room, as.outline], [4, 55.5, 51.5, 4, { rooms: 1, area: 4 }, { rooms: 1, area: 24 }, { area: 240, perimeter: 64 }]);
  eq('sleep summary', sleepSummary(flat.pages[0]), { places: 4, beds: 2, byType: { double: 2, sofa: 2 } });
  eq('room places', roomPlaces(flat, 'bed1'), [{ type: 'double', label: 'Big', capacity: null, note: null }]);
  eq('shapes in polygon room', shapesInRoom(flat.pages[0], flat.pages[0].shapes[3]).map((s) => s.id), ['s']);
  const rot = floor([
    { id: 'r', kind: 'room', x: 0, y: 0, w: 6, h: 1, rot: 90, roomKey: 'hall' },
    { id: 'b', kind: 'bed-single', x: 2.55, y: 2, w: 0.9, h: 2 },
    { id: 'c', kind: 'bed-single', x: 0, y: 0, w: 0.9, h: 0.2 },
  ]);
  eq('room places rotated', roomPlaces(rot, 'hall').map((x) => x.type), ['single']);
  const nook = floor([
    { id: 'r', kind: 'room', x: 0, y: 0, w: 10, h: 6, roomKey: 'main' },
    { id: 'z', kind: 'room', x: 6, y: 0, w: 4, h: 6, roomKey: 'nook' },
    { id: 'b1', kind: 'sofa', x: 1, y: 1, w: 2, h: 0.9, places: 1, note: 'on request' },
    { id: 'b2', kind: 'bed-double', x: 7, y: 1, w: 1.6, h: 2 },
  ]);
  eq('room places except', roomPlaces(nook, 'main', ['nook']), [{ type: 'sofa', label: '', capacity: 1, note: 'on request' }]);
  eq('room places nook', roomPlaces(nook, 'nook').map((x) => x.type), ['double']);

  const store = normalizePlan({ kind: 'shop', pages: [{ w: 10, h: 8, outline: [[0, 0], [10, 0], [10, 8], [0, 8]], shapes: [
    { id: 'g1', kind: 'gondola', x: 1, y: 1, w: 4, h: 1 },
    { id: 'g2', kind: 'gondola', x: 1, y: 2.6, w: 4, h: 1 },
    { id: 'f1', kind: 'fridge-upright', x: 4.5, y: 0.5, w: 1.25, h: 0.8 },
    { id: 'c1', kind: 'checkout', x: 8.8, y: 6, w: 1.8, h: 0.9, rot: 90 },
    { id: 'z1', kind: 'zone', x: 0, y: 0, w: 6, h: 4 },
    { id: 'd1', kind: 'door', x: 1, y: 7.1, w: 0.9, h: 0.9 },
    { id: 'g3', kind: 'gondola', x: 6.25, y: 1, w: 2, h: 1, rot: 0 },
  ] }] }).pages[0];
  eq('overlaps', overlaps(store), [{ a: 'g1', b: 'f1', depth: 0.3 }]);
  eq('narrow aisles', narrowAisles(store, 0.9), [{ a: 'g1', b: 'g2', gap: 0.6 }, { a: 'f1', b: 'g3', gap: 0.5 }]);
  eq('outside page', outsidePage(store), ['c1']);
  near('polygon gap', polygonGap(rectOutline(1, 1), rectOutline(1, 1, 4, 5)), 5);

  // --- history -----------------------------------------------------------------------------------------------------
  const H = createHistory({ limit: 3 });
  let state = { n: 0 };
  for (let i = 1; i <= 5; i++) { H.push(state); state = { n: i }; }
  eq('history limit', H.size, 3);
  eq('push same is no-op', H.push({ n: 4 }), false);
  state = H.undo(state); eq('undo', state, { n: 4 });
  state = H.undo(state); eq('undo 2', state, { n: 3 });
  state = H.redo(state); eq('redo', state, { n: 4 });
  const live = { list: [1] }; H.push(live); live.list.push(2);
  eq('snapshot isolation', H.undo({ n: 9 }), { list: [1] });
  eq('redo cleared by push', [H.canRedo, (H.push({ n: 7 }), H.canRedo)], [true, false]);
  const mark = H.revision; eq('revision', [H.changedSince(mark), (H.push({ n: 8 }), H.changedSince(mark))], [false, true]);
  eq('undo empty', createHistory().undo({}), null);

  // --- SVG ---------------------------------------------------------------------------------------------------------
  const sp = floor([
    { id: 'r1', kind: 'room', x: 0, y: 0, w: 5, h: 4, roomKey: 'hall' },
    { id: 'w1', kind: 'wall', x: 0, y: 4, w: 5, h: 0.2, roomKey: 'hall' },
    { id: 'b1', kind: 'bed-double', x: 1, y: 1, w: 1.6, h: 2 },
    { id: 's', kind: 'sofa', x: 1, y: 1, w: 2, h: 0.9, note: 'unfold the sofa' },
    { id: 'r2', kind: 'bedroom', x: 5, y: 0, w: 4, h: 3, roomKey: 'bed' },
  ]).pages[0];
  const svg = pageSVG(sp, { has: ['hall', 'bed', 'nope'], hl: ['bed'], sel: ['b1'] });
  eq('data-room only on rooms', (svg.match(/data-room=/g) || []).length, 2);
  eq('room classes', [/<g class="plan-sh kg-has" data-sh="r1" data-room="hall"/.test(svg), /<g class="plan-sh hl kg-has" data-sh="r2" data-room="bed"/.test(svg), /<g class="plan-sh" data-sh="w1" transform=/.test(svg), /<g class="plan-sh on" data-sh="b1"/.test(svg)], [true, true, true, true]);
  eq('sleep note and places', [svg.includes('<title>unfold the sofa</title>'), svg.includes('2 places'), svg.includes('20 m²')], [true, true, true]);
  eq('room key sanitised', pageSVG(floor([{ id: 'r1', kind: 'room', x: 0, y: 0, w: 4, h: 3, roomKey: 'a"b<c' }]).pages[0]).includes('data-room="abc"'), true);
  eq('root class', pageSVG(sp, { cls: 'plan-go' }).includes('class="plan-svg plan-go"'), true);
  eq('css', [planCss().includes('.plan-sh.hl>rect'), planCss().includes('.plan-go .kg-has{cursor:pointer}')], [true, true]);
  const s2 = pageSVG(store, { grid: 0.5, dims: true, ruler: true, scale: true, unit: 'mm', ratio: 100 });
  eq('svg extras', ['url(#plan-g)', 'class="plan-wall"', '>10 m<', '>8 m<', 'class="plan-scale"', '>2 m<', 'width="112mm"', 'data-ref'].map((x) => s2.includes(x)), [true, true, true, true, true, true, true, false]);
  eq('svg retail ref', pageSVG(fp).includes('data-ref="eq1"'), true);
  eq('svg balanced', (s2.match(/<g[ >]/g) || []).length, (s2.match(/<\/g>/g) || []).length);
  eq('svg raw page', /viewBox="-0.6 -0.6 17.2 11.2"/.test(pageSVG({ w: 16, h: 10 })), true);
  eq('nice length', [niceLength(2.6), niceLength(0.7), niceLength(40), niceLength(0)], [2, 0.5, 20, 0]);
  eq('hidden layer not drawn', pageSVG(pg).includes('data-sh="s1"'), false);
  eq('centre', center({ x: 1, y: 1, w: 2, h: 4 }), [2, 3]);

  console.log(`plan: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
