// floor-planner/templates.js - starting plans: a studio flat, a two-room "Euro" flat (a kitchen-living room and a
// bedroom), a wedding hall for 120 guests (twelve round tables of nine and a head table of twelve, stage, dance floor,
// bar) and a small shop (wall racks, gondolas, fridges, a chest freezer, two checkouts). Built in the UI language
// (room and table labels), in metres, with the default layers; aisles keep the minimum widths of the checks.
//
// Templates are code, not stored JSON: labels are produced with t() at build time (so a template opens in the
// user's language), layers are assigned by the same layerFor() rule as hand-placed items, and the result passes
// through normalizeDoc like any opened file. Coordinates: metres, origin top-left, y down; x/y = top-left of the box.
import { t } from '../ui/app.js';
import { LAYERS, layerFor, normalizeDoc } from './common.js';

let n = 0;
// Ids restart at t1 for every build: unique within a document, which is all the model requires; two documents made
// from one template never meet in one plan (a template replaces the whole document).
// One shape: kind, x, y, w, h and extra fields (rot, label, seats, pts...).
const S = (kind, x, y, w, h, extra = {}) => ({ id: 't' + (++n).toString(36), kind, x, y, w, h, rot: 0, ...extra });

function build(kind, name, page, shapes, extra = {}) {
  n = 0;
  const p = { id: 'p0', name: page.name, w: page.w, h: page.h, outline: page.outline, layers: structuredClone(LAYERS), shapes: [] };
  p.shapes = shapes.map((s) => ({ ...s, layer: layerFor(p, s.kind) }));
  return normalizeDoc({ plan: { v: 1, kind, name, grid: kind === 'shop' ? 0.1 : 0.05, pages: [p] }, ...extra });
}

// Polygon room from absolute points (the model moves them into the room's own coordinates).
const poly = (kind, pts, extra = {}) => S(kind, 0, 0, 1, 1, { pts, ...extra });

function studio() {
  const L = (k) => t('fp.tpl.r.' + k);
  return build('floor', t('fp.tpl.studio'), { name: t('fp.tpl.flat'), w: 6.4, h: 4.6, outline: [[0, 0], [6.4, 0], [6.4, 4.6], [0, 4.6]] }, [
    S('bath', 0, 0, 1.8, 2, { label: L('bath') }),
    S('hallway', 0, 2, 1.8, 2.6, { label: L('hallway') }),
    S('room', 1.8, 0, 4.6, 4.6, { label: L('studio') }),
    S('door', 0.8, 3.7, 0.9, 0.9),
    S('door', 0.85, 2, 0.8, 0.8, { rot: 180 }),
    S('door', 1.8, 2.7, 0.8, 0.8, { rot: 90 }),
    S('window', 2.6, -0.1, 1.4, 0.2), S('window', 4.4, -0.1, 1.4, 0.2),
    S('bathtub', 0.05, 0.15, 0.75, 1.7), S('toilet', 1.3, 0.15, 0.4, 0.7), S('sink', 1.1, 1.4, 0.6, 0.5),
    S('wardrobe', 0.05, 2.2, 0.6, 1.3),
    S('sofa', 2, 0.15, 2, 0.9), S('armchair', 2, 2, 0.9, 0.9), S('tv', 2.4, 4.4, 1.2, 0.15),
    S('table', 3.9, 1.7, 1.2, 0.8), S('chair', 4.05, 2.55, 0.45, 0.45), S('chair', 4.6, 2.55, 0.45, 0.45),
    S('kitchen-set', 5.8, 0.05, 0.6, 2.4), S('stove', 5.8, 2.45, 0.6, 0.6), S('fridge', 5.8, 3.05, 0.6, 0.65),
  ]);
}

function euro() {
  const L = (k) => t('fp.tpl.r.' + k);
  return build('floor', t('fp.tpl.euro'), { name: t('fp.tpl.flat'), w: 8, h: 7.2, outline: [[0, 0], [8, 0], [8, 7.2], [4.4, 7.2], [4.4, 6], [0, 6]] }, [
    S('bath', 0, 0, 2.4, 2.2, { label: L('bath') }),
    poly('hallway', [[0, 2.2], [2.4, 2.2], [2.4, 6], [1.2, 6], [1.2, 4], [0, 4]], { label: L('hallway') }),
    S('storage', 0, 4, 1.2, 2, { label: L('storage') }),
    poly('room', [[2.4, 0], [8, 0], [8, 3], [5, 3], [5, 4], [2.4, 4]], { label: L('kitchenLiving') }),
    poly('bedroom', [[5, 3], [8, 3], [8, 6], [2.4, 6], [2.4, 4], [5, 4]], { label: L('bedroom') }),
    S('balcony', 4.4, 6, 3.6, 1.2, { label: L('balcony') }),
    S('door', 1.35, 5.1, 0.9, 0.9),
    S('door', 1.2, 2.2, 0.8, 0.8, { rot: 180 }),
    S('door', 2.4, 2.8, 0.8, 0.8, { rot: 90 }),
    S('door', 2.4, 4.6, 0.8, 0.8, { rot: 90 }),
    S('door', 0.5, 4.4, 0.7, 0.7, { rot: 270 }),
    S('door', 6.2, 5.2, 0.8, 0.8),
    S('window', 3.2, -0.1, 1.4, 0.2), S('window', 6, -0.1, 1.4, 0.2), S('window', 7.3, 4.4, 1.4, 0.2, { rot: 90 }), S('window', 5.5, 7.1, 1.4, 0.2),
    S('bathtub', 0.05, 0.1, 0.75, 1.7), S('sink', 1.1, 0.05, 0.6, 0.5), S('toilet', 1.9, 0.1, 0.4, 0.7), S('washer', 1.8, 1.05, 0.6, 0.6),
    S('wardrobe', 0.05, 2.3, 0.6, 1.6),
    S('kitchen-set', 2.5, 0.05, 2.4, 0.6), S('stove', 4.9, 0.05, 0.6, 0.6), S('fridge', 5.5, 0.05, 0.6, 0.65),
    S('table', 3, 1.4, 1.2, 0.8), S('chair', 3.1, 2.25, 0.45, 0.45), S('chair', 3.65, 2.25, 0.45, 0.45),
    S('sofa', 5.6, 2, 2, 0.9), S('tv', 6.4, 0.1, 1.2, 0.15),
    S('bed-double', 6.2, 3.3, 1.6, 2), S('wardrobe', 2.6, 5.35, 1.2, 0.6),
    S('plant', 7.2, 6.3, 0.6, 0.6),
  ]);
}

// 12 round tables of 9 + a head table of 12 = 120 seats (the e2e test asserts this). The 4 x 3 grid keeps 3.6 m
// between table centres: 1.8 m tables plus chairs leave aisles above the hall minimum of the checks.
function wedding() {
  const shapes = [
    S('stage', 8, 0.3, 6, 1.8, { label: t('fp.st.stage') }),
    S('table-rect', 8.3, 3.4, 5.4, 0.9, { seats: 12, label: t('fp.tpl.head') }),
    S('dancefloor', 8.5, 6.2, 5, 4.5, { label: t('fp.st.dancefloor') }),
    S('bar', 17.5, 0.6, 3.5, 0.8, { label: t('fp.st.bar') }),
    S('entrance', 10.4, 15.7, 1.2, 0.3, { label: t('fp.st.entrance') }),
    S('plant', 0.3, 0.3, 0.8, 0.8), S('plant', 0.3, 14.9, 0.8, 0.8), S('plant', 20.9, 14.9, 0.8, 0.8),
  ];
  let k = 0;
  for (const x of [2.4, 6, 16, 19.6]) for (const y of [6, 9.6, 13.2]) shapes.push(S('table-round', x - 0.9, y - 0.9, 1.8, 1.8, { seats: 9, label: String(++k) }));
  return build('hall', t('fp.tpl.wedding'), { name: t('fp.tpl.hall'), w: 22, h: 16 }, shapes);
}

function shop() {
  const sh = [
    S('door', 0.8, 7.8, 1.2, 1.2),
    S('wall-rack', 0.2, 0.1, 3, 0.4, { label: t('fp.tpl.s.grocery') }), S('wall-rack', 3.2, 0.1, 3, 0.4, { label: t('fp.tpl.s.grocery') }), S('wall-rack', 6.2, 0.1, 3, 0.4, { label: t('fp.tpl.s.drinks') }),
    S('fridge-upright', 9.2, 0.1, 1.25, 0.8, { label: t('fp.tpl.s.dairy') }), S('fridge-upright', 10.45, 0.1, 1.25, 0.8, { label: t('fp.tpl.s.dairy') }),
    S('gondola', 1.5, 1.9, 4, 1, { label: 'A1' }), S('gondola', 1.5, 4.1, 4, 1, { label: 'A2' }),
    S('gondola', 6.5, 1.9, 4, 1, { label: 'B1' }), S('gondola', 6.5, 4.1, 4, 1, { label: 'B2' }),
    S('column', 5.8, 3.3, 0.4, 0.4),
    S('freezer-chest', 9.8, 6.3, 2, 0.85, { label: t('fp.tpl.s.frozen') }),
    S('promo-table', 0.3, 6.3, 1.2, 0.8),
    S('checkout', 3, 7.8, 1.8, 0.9, { label: '1' }), S('checkout', 5.6, 7.8, 1.8, 0.9, { label: '2' }),
    S('basket-stand', 2.2, 8.4, 0.5, 0.4),
  ];
  return build('shop', t('fp.tpl.shop'), { name: t('fp.tpl.salesFloor'), w: 12, h: 9, outline: [[0, 0], [12, 0], [12, 9], [0, 9]] }, sh);
}

// An empty plan of a kind: one page of a typical size.
// Sizes typical for each kind; the user resizes the page in the plan card.
export function emptyDoc(kind) {
  const size = { floor: [10, 8], hall: [20, 14], shop: [12, 9] }[kind] || [10, 8];
  const name = kind === 'floor' ? t('fp.tpl.flat') : kind === 'shop' ? t('fp.tpl.salesFloor') : t('fp.tpl.hall');
  return build(kind, t('fp.tpl.untitled'), { name, w: size[0], h: size[1] }, []);
}

// Order matters: main.js opens TEMPLATES[1] (euro flat) and seating.js TEMPLATES[2] (wedding hall) on first visit.
export const TEMPLATES = [
  { id: 'studio', kind: 'floor', build: studio },
  { id: 'euro', kind: 'floor', build: euro },
  { id: 'wedding', kind: 'hall', build: wedding },
  { id: 'shop', kind: 'shop', build: shop },
];
