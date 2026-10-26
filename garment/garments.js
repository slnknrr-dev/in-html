// garment/garments.js - the garment catalogue: every template drafts its base pieces and seams from the body's
// measurements (blocks.js), then its details (details.js) are applied in stacking order. A draft is plain data:
//
//   { garment, label, opts, m, pieces: [piece], seams: [seam], overlays: [overlay], buttons: [button], closures,
//     stiffen: { pieceId: factor }, printAreas: { id: { piece, center, w, h } }, info, components: [component] }
//
//   seam    = { id, a: [[pieceId, edgeBase, reversed?], ...], b: [...], ease (b - a, cm), kind: 'seam' | 'dart' |
//              'attach', sides: 'pair' (both halves) | 'center' (right half a to left half b) | 'single', notches }
//   overlay = 3D-only layers lying on a parent piece (folded lapels, pocket flaps, patches): { piece, on, lift, attach }
//   button  = { piece, p: [x, y], d (diameter), side: 'R' | 'L', hole: true | false }
//
//   GARMENTS (catalogue with option schemas), draftGarment(spec, m), normalizeSpec(spec), garmentOptions(id)

import { addEdgeDart, edgeChain, edgeLength, joinPieces, makePiece, splitPiece } from './piece.js';
import { skirtBlock, sleeveBlock, torsoBlock, trouserBlock, twoPieceSleeve } from './blocks.js';
import { applyDetails, defaultDetails } from './details.js';
import { curve, dist, line, plLength, pointAt, spline } from './geom.js';
import { COSTUME_GARMENTS } from './costume.js';
import { REGION, layeredMeasurements } from './layers.js';
import { applyEdits } from './edits.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// --- helpers ---------------------------------------------------------------------------------------------------------

//
// Draft pipeline: normalizeSpec (trust boundary for options from UI/files) -> layered measurements -> the garment's
// draft function on top of the blocks -> details (collars, pockets, linings) in a fixed order -> 2D edits. A draft
// holds pieces, seams (paths with intended ease), overlays for 3D and notes for anything that could not be applied.
export function newDraft(garment, m, opts) {
  return { garment, opts, m, pieces: [], seams: [], overlays: [], buttons: [], closures: [], stiffen: {}, printAreas: {}, info: {}, components: [], notes: [], pins: [] };
}
export const getPiece = (d, id) => d.pieces.find((p) => p.id === id) || null;
export function putPiece(d, p) {
  const i = d.pieces.findIndex((q) => q.id === p.id);
  if (i >= 0) d.pieces[i] = p; else d.pieces.push(p);
  return p;
}
export const dropPiece = (d, id) => { d.pieces = d.pieces.filter((p) => p.id !== id); d.seams = d.seams.filter((s) => ![...s.a, ...s.b].some(([pid]) => pid === id)); };
export function addSeam(d, id, a, b, o = {}) {
  d.seams = d.seams.filter((s) => s.id !== id);
  d.seams.push({ id, a, b, ease: 0, kind: 'seam', sides: 'pair', notches: [0.5], ...o });
}
// Seam ease measured from the drafted pieces: length(b) - length(a).
export function measuredEase(d, s) { return pathLen(d, s.b) - pathLen(d, s.a); }
export function pathLen(d, path) {
  let L = 0;
  for (const [pid, base] of path) {
    const p = getPiece(d, pid);
    if (!p) return NaN;
    for (const id of edgeChain(p, base)) L += edgeLength(p, id);
  }
  return L;
}

// Rectangle piece: edges top (left to right), right, bottom (right to left), left; options for kinds / allowances.
export function rectPiece(id, w, h, o = {}) {
  const sa = o.sa ?? 1;
  return makePiece({
    id, name: o.name || id, material: o.material || 'shell', layer: o.layer || 'shell', cut: o.cut || { n: 1 },
    edges: [
      { id: o.top || 'top', pts: [[0, 0], [w, 0]], sa: o.saTop ?? sa, kind: o.topKind || 'seam' },
      { id: o.right || 'right', pts: [[w, 0], [w, h]], sa: o.saRight ?? sa, kind: o.rightKind || 'seam' },
      { id: o.bottom || 'bottom', pts: [[w, h], [0, h]], sa: o.saBottom ?? sa, kind: o.bottomKind || 'seam' },
      { id: o.left || 'left', pts: [[0, h], [0, 0]], sa: o.saLeft ?? sa, kind: o.leftKind || 'seam' },
    ],
    grain: o.grain || [[w / 2, h * 0.2], [w / 2, h * 0.8]],
    arrange: o.arrange || null, sim: o.sim, meta: o.meta || {}, marks: o.marks || [],
  });
}

// --- fits ------------------------------------------------------------------------------------------------------------

// Wearing and design ease (cm) by garment class and fit.
// Wearing ease per fit, added to body girths: the difference between body and garment that allows movement.
const EASE = {
  tee: { slim: [4, 6, 4], regular: [10, 14, 10], relaxed: [16, 22, 16], oversized: [28, 32, 26] },
  sweat: { slim: [10, 14, 10], regular: [16, 22, 16], relaxed: [22, 28, 22], oversized: [32, 38, 30] },
  shirt: { slim: [8, 10, 8], regular: [14, 16, 12], relaxed: [20, 24, 18], oversized: [28, 32, 26] },
  jacket: { slim: [8, 9, 7], regular: [11, 12, 9], relaxed: [15, 17, 12], oversized: [22, 24, 18] },
  waistcoat: { slim: [4, 4, 4], regular: [6, 6, 6], relaxed: [9, 9, 8], oversized: [14, 14, 12] },
  dress: { slim: [5, 3, 3], regular: [7, 4, 5], relaxed: [10, 8, 8], oversized: [16, 14, 12] },
};
const easeOf = (cls, fit) => { const e = (EASE[cls][fit] || EASE[cls].regular); return { bust: e[0], waist: e[1], hip: e[2] }; };

const SLEEVE_LEN = (m, s) => ({ short: 20, elbow: m.armLength * 0.55, threeQuarter: m.armLength * 0.78, long: m.armLength + 1 }[s] ?? 20);

// --- the catalogue ---------------------------------------------------------------------------------------------------

// Option schemas drive the template step of the application: seg / range / toggle with defaults.
const FIT = { key: 'fit', type: 'seg', values: ['slim', 'regular', 'relaxed', 'oversized'], def: 'regular' };
const LEN = (def, min, max) => ({ key: 'length', type: 'range', min, max, step: 1, def, unit: 'cm' });

// Registry: each garment declares its option schema (seg/range/bool) and its draft function. The UI is generated
// from the schema and normalizeSpec validates against it, so a new garment needs no UI code.
export const GARMENTS = {
  tshirt: { group: 'merch', blank: true, cls: 'tee', options: [FIT, LEN(18, -12, 40), { key: 'sleeve', type: 'seg', values: ['short', 'elbow', 'long'], def: 'short' }, { key: 'neckline', type: 'seg', values: ['crew', 'v', 'scoop'], def: 'crew' }], draft: knitTop },
  longsleeve: { group: 'merch', blank: true, cls: 'tee', options: [FIT, LEN(18, -12, 40), { key: 'sleeve', type: 'seg', values: ['long', 'threeQuarter'], def: 'long' }, { key: 'neckline', type: 'seg', values: ['crew', 'v', 'scoop'], def: 'crew' }], draft: knitTop },
  tank: { group: 'merch', blank: true, cls: 'tee', options: [FIT, LEN(18, -10, 40), { key: 'neckline', type: 'seg', values: ['scoop', 'crew', 'v'], def: 'scoop' }], draft: knitTop },
  sweatshirt: { group: 'merch', blank: true, cls: 'sweat', options: [FIT, LEN(14, -8, 36), { key: 'neckline', type: 'seg', values: ['crew', 'v'], def: 'crew' }], draft: knitTop },
  hoodie: { group: 'merch', blank: true, cls: 'sweat', options: [FIT, LEN(16, -8, 36)], draft: knitTop },
  shirt: { group: 'classic', cls: 'shirt', options: [FIT, LEN(24, 4, 40), { key: 'sleeve', type: 'seg', values: ['long', 'short'], def: 'long' }, { key: 'tail', type: 'toggle', def: true }], draft: shirt },
  dress: { group: 'classic', cls: 'dress', options: [FIT, { key: 'skirt', type: 'seg', values: ['straight', 'a-line', 'pencil'], def: 'a-line' }, { key: 'length', type: 'range', min: 35, max: 110, step: 1, def: 58, unit: 'cm' }, { key: 'sleeve', type: 'seg', values: ['none', 'short', 'long'], def: 'short' }, { key: 'neckline', type: 'seg', values: ['crew', 'v', 'scoop', 'boat'], def: 'scoop' }], draft: dress },
  skirt: { group: 'classic', cls: 'dress', options: [{ key: 'shape', type: 'seg', values: ['straight', 'a-line', 'pencil'], def: 'straight' }, { key: 'length', type: 'range', min: 30, max: 110, step: 1, def: 58, unit: 'cm' }], draft: skirt },
  trousers: { group: 'classic', cls: 'jacket', options: [FIT, { key: 'hem', type: 'range', min: 34, max: 60, step: 1, def: 42, unit: 'cm' }, { key: 'length', type: 'range', min: -30, max: 6, step: 1, def: 0, unit: 'cm' }], draft: trousers },
  waistcoat: { group: 'tailoring', cls: 'waistcoat', options: [FIT, LEN(9, 0, 20), { key: 'opening', type: 'range', min: 14, max: 30, step: 1, def: 22, unit: 'cm' }], draft: waistcoat },
  jacket: { group: 'tailoring', cls: 'jacket', options: [FIT, LEN(0, -10, 30), { key: 'closure', type: 'seg', values: ['single', 'double'], def: 'single' }], draft: jacket },
  cummerbund: { group: 'tailoring', cls: 'dress', options: [{ key: 'height', type: 'range', min: 8, max: 16, step: 1, def: 12, unit: 'cm' }], draft: cummerbund },
  tote: { group: 'merch', blank: true, cls: 'tee', options: [{ key: 'width', type: 'range', min: 28, max: 50, step: 1, def: 38, unit: 'cm' }, { key: 'height', type: 'range', min: 30, max: 50, step: 1, def: 42, unit: 'cm' }, { key: 'gusset', type: 'range', min: 0, max: 14, step: 1, def: 8, unit: 'cm' }], draft: tote },
  // national costumes, outerwear and the belt (costume.js)
  ...COSTUME_GARMENTS,
};

// Outfits: several garments drafted for one body, stacked inside out. Each entry may carry fabrics per material slot
// ({ preset, color } of fabric/fabric.js) that an application starts the garment with. OUTFIT_INFO tells the body the
// outfit is cut for (any body can wear any outfit; the drafts follow the body) and its group.
const F = (preset, color) => (color ? { preset, color } : { preset });
const TUX_JACKET = { shell: F('barathea'), satin: F('satin'), lining: F('lining', '#1c1c22') };
const SHIRT_WHITE = { shell: F('poplin', '#fafafa') };
const SUIT = (color) => ({ shell: F('suiting', color), lining: F('lining', '#3d3550') });
export const OUTFITS = {
  tuxedo: [
    { garment: 'shirt', opts: { fit: 'slim', tail: true }, details: [{ type: 'collar', variant: 'shirt' }, { type: 'cuffs', variant: 'french' }, { type: 'buttons', count: 7 }, { type: 'interfacing' }], fabrics: SHIRT_WHITE },
    { garment: 'trousers', opts: { fit: 'slim', hem: 40 }, details: [{ type: 'waistband' }, { type: 'trim', variant: 'satinStripe', material: 'satin' }, { type: 'pocket', variant: 'sideSeam' }, { type: 'pocketing' }], fabrics: TUX_JACKET },
    { garment: 'cummerbund', opts: {}, details: [{ type: 'pleats', count: 4 }], fabrics: { shell: F('satin') } },
    { garment: 'jacket', opts: { fit: 'slim', length: 0 }, details: [{ type: 'lapel', variant: 'shawl', facing: 'satin' }, { type: 'buttons', count: 1 }, { type: 'pocket', variant: 'jetted', material: 'satin' }, { type: 'pocket', variant: 'welt', position: 'chest' }, { type: 'facing' }, { type: 'lining' }, { type: 'canvas' }, { type: 'interfacing' }, { type: 'pocketing' }], fabrics: TUX_JACKET },
  ],
  tuxedoWomen: [
    { garment: 'shirt', opts: { fit: 'slim', tail: false }, details: [{ type: 'collar', variant: 'stand' }, { type: 'placket' }, { type: 'cuffs', variant: 'french' }, { type: 'buttons', count: 6, size: 1 }, { type: 'interfacing' }], fabrics: { shell: F('charmeuse', '#f4efe8') } },
    { garment: 'trousers', opts: { fit: 'slim', hem: 38 }, details: [{ type: 'waistband' }, { type: 'trim', variant: 'satinStripe', material: 'satin' }, { type: 'zip' }, { type: 'pocketing' }], fabrics: TUX_JACKET },
    { garment: 'jacket', opts: { fit: 'slim', length: -2 }, details: [{ type: 'lapel', variant: 'shawl', facing: 'satin', width: 7 }, { type: 'buttons', count: 1 }, { type: 'pocket', variant: 'jetted', material: 'satin' }, { type: 'facing' }, { type: 'lining' }, { type: 'canvas' }, { type: 'interfacing' }, { type: 'pocketing' }], fabrics: TUX_JACKET },
  ],
  suit: [
    { garment: 'shirt', opts: { fit: 'regular', tail: true }, details: [{ type: 'collar', variant: 'shirt' }, { type: 'placket' }, { type: 'cuffs', variant: 'barrel' }, { type: 'buttons', count: 7, size: 1.1 }, { type: 'interfacing' }], fabrics: { shell: F('oxford') } },
    { garment: 'trousers', opts: { fit: 'regular', hem: 42 }, details: [{ type: 'waistband' }, { type: 'zip' }, { type: 'pocket', variant: 'sideSeam' }, { type: 'pocket', variant: 'jetted', position: 'back' }, { type: 'beltLoops' }, { type: 'cuffs', variant: 'turnup' }, { type: 'pocketing' }], fabrics: SUIT('#2f3b52') },
    { garment: 'waistcoat', opts: { fit: 'slim' }, details: [{ type: 'buttons', count: 5, size: 1.5 }, { type: 'pocket', variant: 'welt' }, { type: 'facing' }, { type: 'lining' }, { type: 'interfacing' }], fabrics: SUIT('#2f3b52') },
    { garment: 'jacket', opts: { fit: 'regular', length: 0, closure: 'single' }, details: [{ type: 'lapel', variant: 'notch' }, { type: 'buttons', count: 2 }, { type: 'pocket', variant: 'flap' }, { type: 'pocket', variant: 'welt', position: 'chest' }, { type: 'vent', variant: 'center' }, { type: 'facing' }, { type: 'lining' }, { type: 'canvas' }, { type: 'interfacing' }, { type: 'pocketing' }], fabrics: SUIT('#2f3b52') },
  ],
  suitWomen: [
    { garment: 'shirt', opts: { fit: 'slim', tail: false }, details: [{ type: 'collar', variant: 'shirt' }, { type: 'placket' }, { type: 'cuffs', variant: 'barrel' }, { type: 'buttons', count: 6, size: 1 }, { type: 'interfacing' }], fabrics: SHIRT_WHITE },
    { garment: 'skirt', opts: { shape: 'pencil', length: 60 }, details: [{ type: 'waistband' }, { type: 'zip' }, { type: 'vent', variant: 'center' }, { type: 'lining' }], fabrics: SUIT('#3a3f55') },
    { garment: 'jacket', opts: { fit: 'slim', length: -3 }, details: [{ type: 'lapel', variant: 'notch', width: 7 }, { type: 'buttons', count: 2 }, { type: 'pocket', variant: 'flap' }, { type: 'facing' }, { type: 'lining' }, { type: 'canvas' }, { type: 'interfacing' }, { type: 'pocketing' }], fabrics: SUIT('#3a3f55') },
  ],
  classic: [
    { garment: 'shirt', opts: { fit: 'regular', tail: true }, details: [{ type: 'collar', variant: 'shirt' }, { type: 'placket' }, { type: 'cuffs', variant: 'barrel' }, { type: 'buttons', count: 7, size: 1.1 }, { type: 'pocket', variant: 'patch', position: 'chest' }, { type: 'interfacing' }], fabrics: { shell: F('oxford') } },
    { garment: 'trousers', opts: { fit: 'regular', hem: 42 }, details: [{ type: 'waistband' }, { type: 'zip' }, { type: 'pocket', variant: 'sideSeam' }, { type: 'pocket', variant: 'jetted', position: 'back' }, { type: 'beltLoops' }, { type: 'pocketing' }], fabrics: { shell: F('gabardine', '#6b5e4a') } },
    { garment: 'jacket', opts: { fit: 'regular' }, details: [{ type: 'lapel', variant: 'notch' }, { type: 'buttons', count: 2 }, { type: 'pocket', variant: 'patch' }, { type: 'pocket', variant: 'welt', position: 'chest' }, { type: 'vent', variant: 'center' }, { type: 'facing' }, { type: 'lining' }, { type: 'canvas' }, { type: 'interfacing' }], fabrics: { shell: F('tweed'), lining: F('lining', '#7a2f2f') } },
  ],
  classicWomen: [
    { garment: 'shirt', opts: { fit: 'regular', tail: false, sleeve: 'long' }, details: [{ type: 'collar', variant: 'shirt' }, { type: 'placket' }, { type: 'cuffs', variant: 'barrel' }, { type: 'buttons', count: 6, size: 1 }, { type: 'interfacing' }], fabrics: { shell: F('poplin', '#dfe8f2') } },
    { garment: 'skirt', opts: { shape: 'a-line', length: 64 }, details: [{ type: 'waistband' }, { type: 'zip' }, { type: 'pocket', variant: 'sideSeam' }, { type: 'lining' }], fabrics: { shell: F('flannel', '#5d5a66') } },
    { garment: 'jacket', opts: { fit: 'regular', length: 0 }, details: [{ type: 'lapel', variant: 'notch', width: 7 }, { type: 'buttons', count: 3 }, { type: 'pocket', variant: 'flap' }, { type: 'facing' }, { type: 'lining' }, { type: 'interfacing' }], fabrics: { shell: F('tweed'), lining: F('lining', '#5a4a6a') } },
  ],
  // Georgian: the chokha over the arkhaluk, trousers and the belt; the women's chokha over a long skirt; the kartuli
  // dress with its belt.
  chokha: [
    { garment: 'arkhaluk', opts: { fit: 'slim', length: 48 }, fabrics: { shell: F('satin', '#16171b'), lining: F('lining', '#202024') } },
    { garment: 'trousers', opts: { fit: 'slim', hem: 36 }, details: [{ type: 'waistband' }, { type: 'zip' }, { type: 'pocketing' }], fabrics: { shell: F('broadcloth', '#16171b') } },
    { garment: 'chokha', opts: { fit: 'slim', length: 70, flare: 18, opening: 30, sleeve: 'turnback' }, fabrics: { shell: F('broadcloth', '#1b1c20'), lining: F('lining', '#5a1820'), contrast: F('satin', '#c9a227') } },
    { garment: 'belt', opts: { width: 4 }, fabrics: { shell: F('satin', '#1a1a1a') } },
  ],
  chokhaWhite: [
    { garment: 'arkhaluk', opts: { fit: 'slim', length: 50 }, details: [{ type: 'collar', variant: 'stand' }, { type: 'buttons', count: 14, size: 0.8 }, { type: 'facing' }, { type: 'lining' }], fabrics: { shell: F('satin', '#121212') } },
    { garment: 'trousers', opts: { fit: 'slim', hem: 36 }, details: [{ type: 'waistband' }, { type: 'zip' }], fabrics: { shell: F('broadcloth', '#121212') } },
    { garment: 'chokha', opts: { fit: 'slim', length: 80, flare: 22, opening: 32, sleeve: 'turnback' }, details: [{ type: 'gazyri', count: 10, material: 'contrast' }, { type: 'vent', variant: 'center' }, { type: 'facing' }, { type: 'lining' }, { type: 'interfacing' }], fabrics: { shell: F('broadcloth', '#f1ede4'), contrast: F('broadcloth', '#cfc6b6'), lining: F('lining', '#e6dcc8') } },
    { garment: 'belt', opts: { width: 3 }, fabrics: { shell: F('satin', '#121212') } },
  ],
  chokhaMountain: [
    { garment: 'arkhaluk', opts: { fit: 'regular', length: 36, sleeve: 'long' }, fabrics: { shell: F('linen', '#3a3226') } },
    { garment: 'trousers', opts: { fit: 'regular', hem: 40 }, details: [{ type: 'waistband' }, { type: 'zip' }], fabrics: { shell: F('flannel', '#4a4136') } },
    { garment: 'chokha', opts: { fit: 'regular', length: 50, flare: 10, opening: 26, sleeve: 'long' }, details: [{ type: 'gazyri', count: 6 }, { type: 'quilting', variant: 'channels', spacing: 12 }, { type: 'lining' }], fabrics: { shell: F('broadcloth', '#5b5145'), wadding: F('wadding') } },
    { garment: 'belt', opts: { width: 5 }, fabrics: { shell: F('cottonCanvas', '#2b241c') } },
  ],
  chokhaWomen: [
    { garment: 'arkhaluk', opts: { fit: 'slim', length: 40 }, fabrics: { shell: F('charmeuse', '#efe6d6') } },
    { garment: 'skirt', opts: { shape: 'a-line', length: 100 }, details: [{ type: 'waistband' }, { type: 'zip' }, { type: 'lining' }], fabrics: { shell: F('satin', '#151517') } },
    { garment: 'chokha', opts: { fit: 'slim', length: 85, flare: 26, opening: 24, sleeve: 'turnback' }, details: [{ type: 'gazyri', count: 8, material: 'contrast' }, { type: 'facing' }, { type: 'lining' }, { type: 'interfacing' }], fabrics: { shell: F('broadcloth', '#7a1e2b'), contrast: F('satin', '#c9a227'), lining: F('lining', '#2a0d12') } },
    { garment: 'belt', opts: { width: 3 }, fabrics: { shell: F('satin', '#c9a227') } },
  ],
  kartuli: [
    { garment: 'kartuli', opts: { fit: 'slim', length: 100, flare: 34, opening: 22, sleeve: 'hanging' }, fabrics: { shell: F('velvet', '#3a1426'), lining: F('habotai', '#e8d9c8'), contrast: F('satin', '#c9a227') } },
    { garment: 'belt', opts: { width: 5, ease: 6 }, fabrics: { shell: F('satin', '#c9a227') } },
  ],
  kartuliWedding: [
    { garment: 'kartuli', opts: { fit: 'slim', length: 104, flare: 44, opening: 20, sleeve: 'hanging' }, fabrics: { shell: F('charmeuse', '#f6f1e7'), lining: F('habotai', '#fbf8f2'), contrast: F('satin', '#d8c48c') } },
    { garment: 'belt', opts: { width: 6, ease: 6 }, fabrics: { shell: F('satin', '#d8c48c') } },
  ],
  // Slavic: the kosovorotka over trousers with a belt, the kaftan over them; the women's rubakha with a sarafan, or
  // with a long skirt and a belt (the poneva way).
  slavic: [
    { garment: 'kosovorotka', opts: { fit: 'relaxed', length: 26, placket: 'side' }, fabrics: { shell: F('linen', '#f3ecdc'), contrast: F('linen', '#a3202a') } },
    { garment: 'trousers', opts: { fit: 'relaxed', hem: 44 }, details: [{ type: 'waistband' }], fabrics: { shell: F('linen', '#3d3a36') } },
    { garment: 'belt', opts: { width: 3, ease: 18 }, fabrics: { shell: F('linen', '#a3202a') } },
  ],
  slavicKaftan: [
    { garment: 'kosovorotka', opts: { fit: 'relaxed', length: 24, placket: 'side' }, fabrics: { shell: F('linen', '#f3ecdc'), contrast: F('linen', '#a3202a') } },
    { garment: 'trousers', opts: { fit: 'relaxed', hem: 42 }, details: [{ type: 'waistband' }], fabrics: { shell: F('flannel', '#3a332c') } },
    { garment: 'kaftan', opts: { fit: 'regular', length: 62, flare: 14, sleeve: 'long' }, fabrics: { shell: F('broadcloth', '#24405e'), lining: F('lining', '#a3202a') } },
    { garment: 'belt', opts: { width: 5, ease: 14 }, fabrics: { shell: F('satin', '#a3202a') } },
  ],
  slavicWomen: [
    { garment: 'rubakha', opts: { fit: 'relaxed', length: 100, placket: 'center' }, fabrics: { shell: F('linen', '#f6f0e2'), contrast: F('linen', '#b3202a') } },
    { garment: 'sarafan', opts: { fit: 'regular', length: 98, flare: 34 }, fabrics: { shell: F('linen', '#9d1c26'), contrast: F('satin', '#d7b45a'), lining: F('habotai') } },
  ],
  slavicPoneva: [
    { garment: 'rubakha', opts: { fit: 'relaxed', length: 70, placket: 'center' }, fabrics: { shell: F('linen', '#f6f0e2'), contrast: F('linen', '#b3202a') } },
    { garment: 'skirt', opts: { shape: 'a-line', length: 96 }, details: [{ type: 'waistband', depth: 3 }], fabrics: { shell: F('tartan') } },
    { garment: 'belt', opts: { width: 4, ease: 20 }, fabrics: { shell: F('linen', '#b3202a') } },
  ],
  // Outerwear over a shirt and trousers.
  winter: [
    { garment: 'longsleeve', opts: { fit: 'regular' }, fabrics: { shell: F('jersey', '#e9e4da') } },
    { garment: 'trousers', opts: { fit: 'regular', hem: 40 }, details: [{ type: 'waistband' }, { type: 'zip' }, { type: 'pocket', variant: 'sideSeam' }, { type: 'beltLoops' }], fabrics: { shell: F('denim') } },
    { garment: 'puffer', opts: { fit: 'regular', length: 12, loft: 2 }, fabrics: { shell: F('nylon', '#20304a'), lining: F('nylon', '#6b2a2a'), wadding: F('wadding') } },
  ],
};
export const OUTFIT_INFO = {
  tuxedo: { sex: 'male', group: 'tailoring' }, tuxedoWomen: { sex: 'female', group: 'tailoring' },
  suit: { sex: 'male', group: 'tailoring' }, suitWomen: { sex: 'female', group: 'tailoring' },
  classic: { sex: 'male', group: 'classic' }, classicWomen: { sex: 'female', group: 'classic' },
  chokha: { sex: 'male', group: 'georgian' }, chokhaWhite: { sex: 'male', group: 'georgian' }, chokhaMountain: { sex: 'male', group: 'georgian' },
  chokhaWomen: { sex: 'female', group: 'georgian' }, kartuli: { sex: 'female', group: 'georgian' }, kartuliWedding: { sex: 'female', group: 'georgian' },
  slavic: { sex: 'male', group: 'slavic' }, slavicKaftan: { sex: 'male', group: 'slavic' }, slavicWomen: { sex: 'female', group: 'slavic' }, slavicPoneva: { sex: 'female', group: 'slavic' },
  winter: { sex: 'any', group: 'outerwear' },
};

export const garmentOptions = (id) => (GARMENTS[id] || GARMENTS.tshirt).options;

// Fills defaults; unknown option values fall back to the default.
// Unknown garments fall back to a t-shirt, unknown option values to defaults, ranges clamped: a spec from a shared
// link can never make the drafter run with values it was not designed for.
export function normalizeSpec(spec) {
  const id = GARMENTS[spec?.garment] ? spec.garment : 'tshirt';
  const opts = {};
  for (const o of GARMENTS[id].options) {
    const v = spec?.opts?.[o.key];
    if (o.type === 'seg') opts[o.key] = o.values.includes(v) ? v : o.def;
    else if (o.type === 'range') opts[o.key] = typeof v === 'number' && Number.isFinite(v) ? clamp(v, o.min, o.max) : o.def;
    else opts[o.key] = typeof v === 'boolean' ? v : o.def;
  }
  opts.sa = clamp(Number(spec?.opts?.sa ?? 1), 0, 3);
  const details = Array.isArray(spec?.details) ? spec.details.filter((c) => c && typeof c.type === 'string') : defaultDetails(id, opts);
  return { garment: id, opts, details: details.map((c, i) => ({ id: c.id || `${c.type}-${i + 1}`, ...c })) };
}

// Drafts a garment for measurements m (body/measure.js draftMeasurements). spec.under: the layers worn under it
// (garment/layers.js outfitLayers) - the girths get the room for their thickness. spec.edits: pattern edits made in 2D
// (garment/edits.js: piece materials, layers laid onto pieces), applied last.
export function draftGarment(spec, m) {
  const s = normalizeSpec(spec);
  if (spec?.under?.length) m = layeredMeasurements(m, spec.under, REGION[s.garment] || 'top');
  const d = newDraft(s.garment, m, s.opts);
  GARMENTS[s.garment].draft(d, m, s.opts, s.garment, spec);
  applyDetails(d, s.details);
  if (spec?.edits) applyEdits(d, spec.edits);
  for (const p of d.pieces) p.garment = s.garment;
  return d;
}

// --- knit tops: t-shirt, long sleeve, tank, sweatshirt, hoodie --------------------------------------------------------

function knitTop(d, m, o, id) {
  const sweat = id === 'sweatshirt' || id === 'hoodie';
  const tank = id === 'tank';
  const ease = easeOf(sweat ? 'sweat' : 'tee', o.fit);
  const drop = sweat ? 5 : o.fit === 'oversized' ? 7 : o.fit === 'relaxed' ? 2 : 0;
  const neck = o.neckline || 'crew';
  const tb = torsoBlock(m, {
    knit: true, ease, length: o.length, suppression: o.fit === 'slim' ? 0.35 : 0, shoulderExtend: tank ? -3 : drop,
    armholeDrop: 1 + drop * 0.6 + (tank ? 3 : 0), neckWiden: tank ? 2.5 : neck === 'scoop' ? 1.5 : sweat ? 0.6 : 0.3,
    frontNeckDrop: neck === 'v' ? 9 : neck === 'scoop' ? (tank ? 7 : 5) : sweat ? 0.6 : 0,
    sa: { neck: 0.75, shoulder: 1, armhole: 1, side: 1, hem: sweat ? 1 : 2.5 },
  });
  const back = putPiece(d, tb.back), front = putPiece(d, tb.front);
  if (neck === 'v') putPiece(d, vNeck(front, tb.info, 9));
  addSeam(d, 'shoulder', [['back', 'shoulder']], [['front', 'shoulder', true]], { ease: edgeLength(front, 'shoulder') - edgeLength(back, 'shoulder') });
  addSeam(d, 'side', [['back', 'side']], [['front', 'side', true]]);
  d.info.torso = tb.info;
  if (!tank) {
    const sl = id === 'longsleeve' ? (o.sleeve || 'long') : sweat ? 'long' : (o.sleeve || 'short');
    const cuff = sweat ? 7 : 0;
    const L = SLEEVE_LEN(m, sl) + (sweat ? 2 : 0);
    const hemW = sl === 'short' ? m.upperArm + 8 + drop : sweat ? m.wrist + 12 : m.wrist + 8;
    const sb = sleeveBlock(m, { ahFront: tb.info.armholeFront, ahBack: tb.info.armholeBack, capEase: 0, bicepEase: sweat ? 12 : o.fit === 'slim' ? 5 : 9, length: L, shoulderExtend: drop, cuffDepth: cuff, hemWidth: hemW, sa: { cap: 1, under: 1, hem: sweat ? 1 : 2.5 } });
    putPiece(d, sb.sleeve);
    addSeam(d, 'armhole', [['back', 'armhole'], ['front', 'armhole']], [['sleeve', 'capBack'], ['sleeve', 'capFront']], { ease: sb.info.capFront + sb.info.capBack - tb.info.armholeFront - tb.info.armholeBack, notches: [0.25, 0.5, 0.75] });
    addSeam(d, 'underarm', [['sleeve', 'underBack']], [['sleeve', 'underFront', true]]);
    d.info.sleeve = sb.info;
  }
  // Print areas (merch): centred on the front and back below the neck.
  const W = tb.info.W;
  const frontNeckY = tb.info.points.FNP[1];
  d.printAreas.front = { piece: 'front', center: [W, frontNeckY + 8 + 20], w: Math.min(30, tb.info.wF * 1.6), h: 38 };
  d.printAreas.chest = { piece: 'front', center: [W + tb.info.wF * 0.45, frontNeckY + 10], w: 10, h: 10 };
  d.printAreas.back = { piece: 'back', center: [0, 8 + 20], w: Math.min(30, tb.info.wB * 1.6), h: 40 };
  if (!tank) d.printAreas.sleeve = { piece: 'sleeve', center: [d.info.sleeve.top[0], d.info.sleeve.capHeight + 6], w: 8, h: 10 };
}

// V neckline: the front neck becomes a straight-ish line from the side neck point to the centre front, `depth` below the
// front neck point.
function vNeck(front, info, depth) {
  const neck = front.edges.find((e) => e.id === 'neck');
  const cf = front.edges.find((e) => e.id === 'cf');
  const a = neck.pts[0], top = cf.pts[0];
  const v = [top[0], top[1] + depth];
  const p = JSON.parse(JSON.stringify(front));
  p.edges = p.edges.map((e) => (e.id === 'neck' ? { ...e, pts: curve(a, [0.3, 1], v, [0.5, 1], 0.35, 0.3) } : e.id === 'cf' ? { ...e, pts: [v, e.pts[e.pts.length - 1]] } : e));
  return makePiece(p);
}

// --- shirt -----------------------------------------------------------------------------------------------------------

function shirt(d, m, o) {
  const female = m.sex === 'female';
  const tb = torsoBlock(m, {
    ease: easeOf('shirt', o.fit), length: o.length, suppression: o.fit === 'slim' ? 0.6 : 0.25, armholeDrop: 2, cfExtension: 1.8,
    shoulderEase: 0, bustDart: female, sa: { neck: 1, shoulder: 1, armhole: 1, side: 1.5, hem: 1, cf: 1 },
  });
  let back = tb.back, front = tb.front;
  const yYoke = 7.5;
  // Back yoke: a horizontal cut across the back; the front shoulder strip joins it.
  const arm = back.edges.find((e) => e.id === 'armhole');
  const sY = distToY(arm.pts, yYoke);
  const cb = back.edges.find((e) => e.id === 'cb');
  const cbY = plLength(cb.pts) - (yYoke - cb.pts[cb.pts.length - 1][1]);
  const [lower, yoke] = splitPiece(back, {
    from: { edge: 'armhole', at: sY }, to: { edge: 'cb', at: cbY },
    ids: ['yokeSeam', 'yokeSeam'], pieces: [{ id: 'back' }, { id: 'yoke', name: 'yoke', cut: { n: 2, fold: 'cb' } }],
  });
  const farm = front.edges.find((e) => e.id === 'armhole');
  const fneck = front.edges.find((e) => e.id === 'neck');
  const [strip, frontRest] = splitPiece(front, {
    from: { edge: 'armhole', at: plLength(farm.pts) - 3.2 }, to: { edge: 'neck', at: 2.6 },
    ids: ['yokeFront', 'yokeFront'], pieces: [{ id: 'strip' }, { id: 'front' }],
  });
  void fneck;
  const yokeFull = joinPieces(yoke, 'shoulder', strip, 'shoulder', { piece: { id: 'yoke', name: 'yoke' }, mergeSame: ['neck'] });
  back = putPiece(d, lower);
  front = putPiece(d, frontRest);
  putPiece(d, yokeFull);
  d.info.torso = tb.info;
  addSeam(d, 'yokeBack', [['yoke', 'yokeSeam']], [['back', 'yokeSeam', true]]);
  addSeam(d, 'yokeFront', [['yoke', 'yokeFront']], [['front', 'yokeFront', true]]);
  addSeam(d, 'side', [['back', 'side']], [['front', 'side', true]]);
  if (female) addSeam(d, 'bustDart', [['front', 'bustDart.a']], [['front', 'bustDart.b', true]], { kind: 'dart', notches: [] });
  // Sleeve with a low cap; the cuff takes the end.
  const long = o.sleeve !== 'short';
  const cuffDepth = long ? 6 : 0;
  const ahF = pathLen(d, [['front', 'armhole']]) + edgeLength(yokeFull, 'armhole.1');
  const ahB = pathLen(d, [['back', 'armhole']]) + edgeLength(yokeFull, 'armhole.2');
  const sb = sleeveBlock(m, {
    ahFront: ahF, ahBack: ahB, capEase: 0.6, bicepEase: o.fit === 'slim' ? 8 : 11, length: long ? m.armLength + 3 : 24, cuffDepth,
    hemWidth: long ? m.wrist + 12 : m.upperArm + 9, sa: { cap: 1, under: 1.5, hem: long ? 1 : 2.5 },
  });
  putPiece(d, sb.sleeve);
  d.info.sleeve = sb.info;
  addSeam(d, 'armhole', [['yoke', 'armhole.2'], ['back', 'armhole'], ['front', 'armhole'], ['yoke', 'armhole.1']], [['sleeve', 'capBack'], ['sleeve', 'capFront']], { ease: sb.info.capFront + sb.info.capBack - ahF - ahB, notches: [0.25, 0.5, 0.75] });
  addSeam(d, 'underarm', [['sleeve', 'underBack']], [['sleeve', 'underFront', true]]);
  if (o.tail !== false) {
    for (const id of ['back', 'front']) putPiece(d, shirtTail(getPiece(d, id), 7));
  }
  d.printAreas.chest = { piece: 'front', center: [tb.info.W - tb.info.wF * 0.45, tb.info.yC + 2], w: 10, h: 10 };
}

// Distance along a polyline to the first point at height y.
function distToY(pts, y) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = dist(a, b);
    if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1]) return s + L * ((y - a[1]) / (b[1] - a[1]));
    s += L;
  }
  return s;
}

// Curved shirt tail: the side seam is cut `rise` cm short and the hem curves down to the centre.
function shirtTail(p, rise) {
  const sideIds = edgeChain(p, 'side');
  const hem = p.edges.find((e) => e.id === 'hem');
  const isBack = p.meta.side === 'back';
  // Back: side runs down, hem runs from the side to the CB. Front: hem runs from the CF to the side, side runs up.
  const sideLast = isBack ? sideIds[sideIds.length - 1] : sideIds[0];
  const sideEdge = p.edges.find((e) => e.id === sideLast);
  const L = plLength(sideEdge.pts);
  const hemL = plLength(hem.pts);
  const from = isBack ? { edge: sideLast, at: Math.max(0.5, L - rise) } : { edge: 'hem', at: Math.max(1, hemL - hemL * 0.55) };
  const to = isBack ? { edge: 'hem', at: Math.min(hemL - 1, hemL * 0.55) } : { edge: sideLast, at: Math.min(L - 0.5, rise) };
  const P = pointAt(p.edges.find((e) => e.id === from.edge).pts, from.at).p, Q = pointAt(p.edges.find((e) => e.id === to.edge).pts, to.at).p;
  const cut = isBack ? curve(P, [0.05, 1], Q, [-1, 0], 0.5, 0.5) : curve(P, [-1, 0], Q, [0.05, -1], 0.5, 0.5);
  const [main] = splitPiece(p, { from, to, pts: isBack ? cut : cut, ids: ['hemTail', 'hemTail'], pieces: [{}, {}] });
  // The piece that contains the armhole is the shirt; its cut edge is the new hem.
  const keep = main.edges.some((e) => e.id === 'armhole' || e.id.startsWith('armhole')) ? main : null;
  const res = keep || splitPiece(p, { from, to, pts: cut, ids: ['hemTail', 'hemTail'] })[1];
  for (const e of res.edges) if (e.id === 'hemTail') { e.kind = 'hem'; e.sa = hem.sa; }
  return res;
}

// --- dress, skirt ----------------------------------------------------------------------------------------------------

function dress(d, m, o) {
  const neck = o.neckline || 'scoop';
  const tb = torsoBlock(m, {
    ease: easeOf('dress', o.fit), length: 0, waistDarts: true, suppression: 1, cbSeam: true, armholeDrop: o.sleeve === 'none' ? 0.5 : 1.5,
    neckWiden: neck === 'boat' ? 4 : neck === 'scoop' ? 2 : 0.5, frontNeckDrop: neck === 'v' ? 10 : neck === 'scoop' ? 6 : neck === 'boat' ? -2 : 0.5,
    sa: { neck: 1, shoulder: 1.5, armhole: 1, side: 1.5, hem: 1, cb: 1.5 },
  });
  const back = putPiece(d, tb.back);
  let front = putPiece(d, tb.front);
  if (neck === 'v') front = putPiece(d, vNeck(front, tb.info, 10));
  d.info.torso = tb.info;
  const waistB = pathLen(d, [['back', 'hem']]), waistF = pathLen(d, [['front', 'hem']]);
  const sk = skirtBlock(m, { length: o.length, shape: o.skirt || 'a-line', cbSeam: true, waistTarget: { back: waistB, front: waistF } });
  putPiece(d, sk.back);
  putPiece(d, sk.front);
  d.info.skirt = sk.info;
  addSeam(d, 'shoulder', [['back', 'shoulder']], [['front', 'shoulder', true]], { ease: edgeLength(front, 'shoulder') - edgeLength(back, 'shoulder') });
  addSeam(d, 'side', [['back', 'side']], [['front', 'side', true]]);
  addSeam(d, 'cb', [['back', 'cb']], [['back', 'cb']], { sides: 'center' });
  addSeam(d, 'skirtCb', [['skirtBack', 'cb']], [['skirtBack', 'cb']], { sides: 'center' });
  addSeam(d, 'skirtSide', [['skirtBack', 'side']], [['skirtFront', 'side', true]]);
  addSeam(d, 'waistBack', [['back', 'hem']], [['skirtBack', 'waist', true]]);
  addSeam(d, 'waistFront', [['front', 'hem']], [['skirtFront', 'waist', true]]);
  dartSeams(d);
  if (o.sleeve && o.sleeve !== 'none') {
    const sb = sleeveBlock(m, { ahFront: tb.info.armholeFront, ahBack: tb.info.armholeBack, capEase: 1.5, bicepEase: 6, length: o.sleeve === 'long' ? m.armLength + 1 : 18, hemWidth: o.sleeve === 'long' ? m.wrist + 7 : m.upperArm + 5 });
    putPiece(d, sb.sleeve);
    d.info.sleeve = sb.info;
    addSeam(d, 'armhole', [['back', 'armhole'], ['front', 'armhole']], [['sleeve', 'capBack'], ['sleeve', 'capFront']], { ease: sb.info.capFront + sb.info.capBack - tb.info.armholeFront - tb.info.armholeBack, notches: [0.25, 0.5, 0.75] });
    addSeam(d, 'underarm', [['sleeve', 'underBack']], [['sleeve', 'underFront', true]]);
  }
}

// Every dart of every piece becomes a dart seam (legs sewn together).
// Each dart gets a seam between its two legs with zero ease, so checkSeams verifies the legs are equal.
export function dartSeams(d) {
  for (const p of d.pieces) {
    for (const e of p.edges) {
      if (e.kind !== 'dart' || !e.id.endsWith('.a')) continue;
      const base = e.id.slice(0, -2);
      addSeam(d, `${p.id}.${base}`, [[p.id, base + '.a']], [[p.id, base + '.b', true]], { kind: 'dart', notches: [] });
    }
  }
}

function skirt(d, m, o) {
  const sk = skirtBlock(m, { length: o.length, shape: o.shape, cbSeam: true });
  putPiece(d, sk.back);
  putPiece(d, sk.front);
  d.info.skirt = sk.info;
  addSeam(d, 'skirtCb', [['skirtBack', 'cb']], [['skirtBack', 'cb']], { sides: 'center' });
  addSeam(d, 'skirtSide', [['skirtBack', 'side']], [['skirtFront', 'side', true]]);
  dartSeams(d);
  d.printAreas.front = { piece: 'skirtFront', center: [sk.info.W, 22], w: 24, h: 24 };
}

// --- trousers --------------------------------------------------------------------------------------------------------

function trousers(d, m, o) {
  const e = easeOf('jacket', o.fit);
  const tr = trouserBlock(m, { ease: { waist: 1.5, hip: Math.max(3, e.hip - 3) }, hemWidth: o.hem, length: m.outsideLeg - 2 + (o.length || 0) });
  putPiece(d, tr.front);
  putPiece(d, tr.back);
  d.info.trousers = tr.info;
  addSeam(d, 'outseam', [['trouserFront', 'side']], [['trouserBack', 'side']]);
  addSeam(d, 'inseam', [['trouserFront', 'inseam']], [['trouserBack', 'inseam']]);
  addSeam(d, 'frontCrotch', [['trouserFront', 'crotch']], [['trouserFront', 'crotch']], { sides: 'center' });
  addSeam(d, 'backCrotch', [['trouserBack', 'crotch']], [['trouserBack', 'crotch']], { sides: 'center' });
  dartSeams(d);
}

// --- waistcoat ---------------------------------------------------------------------------------------------------------

function waistcoat(d, m, o) {
  const tb = torsoBlock(m, {
    ease: easeOf('waistcoat', o.fit), length: o.length, cbSeam: true, suppression: 0.85, armholeDrop: 3, cfExtension: 1.8, neckWiden: 0.6,
    sa: { neck: 1, shoulder: 1.5, armhole: 1, side: 2, hem: 1, cf: 1, cb: 2 },
  });
  const back = putPiece(d, { ...tb.back, material: 'lining' });
  // Front: V opening from the side neck point down to the top button, pointed hem.
  const f = tb.front;
  const neck = f.edges.find((e) => e.id === 'neck'), cfE = f.edges.find((e) => e.id === 'cf'), hem = f.edges.find((e) => e.id === 'hem');
  const snp = neck.pts[0];
  const xEdge = cfE.pts[0][0];
  // the V ends below the front neck point even on short backs (children)
  const vy = Math.max(tb.info.points.FNP[1] + 4, tb.info.yW - o.opening);
  const pointY = hem.pts[0][1] + 6;
  const hemSide = hem.pts[hem.pts.length - 1];
  const edges = f.edges.filter((e) => !['neck', 'cf', 'hem'].includes(e.id)).map((e) => ({ ...e }));
  const newEdges = [
    { id: 'neck', pts: curve(snp, [0.12, 1], [xEdge, vy], [0.2, 1], 0.4, 0.3), sa: 1 },
    { id: 'cf', pts: [[xEdge, vy], [xEdge, hem.pts[0][1] + 1.5]], sa: 1 },
    { id: 'hem', pts: chain2([[xEdge, hem.pts[0][1] + 1.5], [xEdge - 2.5, pointY]], curve([xEdge - 2.5, pointY], [-1, -0.25], hemSide, [-1, -0.1], 0.4, 0.4)), sa: 1, kind: 'hem' },
  ];
  // Outline order of the drafted front: neck, cf, hem, side..., armhole, shoulder.
  const i = f.edges.findIndex((e) => e.id === 'neck');
  void i;
  let front = makePiece({ ...f, edges: [...newEdges, ...edges] });
  front = addEdgeDart(front, 'hem', plLength(front.edges.find((e) => e.id === 'hem').pts) * 0.55, 1.8, [tb.info.W - (m.bustSpan || 18) / 2, tb.info.yC + 6], 'frontDart');
  putPiece(d, front);
  d.info.torso = tb.info;
  addSeam(d, 'shoulder', [['back', 'shoulder']], [['front', 'shoulder', true]], { ease: edgeLength(front, 'shoulder') - edgeLength(back, 'shoulder') });
  addSeam(d, 'side', [['back', 'side']], [['front', 'side', true]]);
  addSeam(d, 'cb', [['back', 'cb']], [['back', 'cb']], { sides: 'center' });
  dartSeams(d);
  d.info.buttonLine = { x: tb.info.W, y0: vy + 1.5, y1: hem.pts[0][1] - 1 };
}
const chain2 = (a, b) => [...a, ...b.slice(1)];

// --- jacket -------------------------------------------------------------------------------------------------------------

function jacket(d, m, o) {
  const female = m.sex === 'female';
  const ease = easeOf('jacket', o.fit);
  if (!female) { ease.bust += 1; ease.waist += 1; }
  const double = o.closure === 'double';
  const len = m.waistToHip + (female ? 6 : 10) + (o.length || 0);
  const tb = torsoBlock(m, {
    ease, length: len, cbSeam: true, suppression: female ? 0.75 : 0.75, sideShare: female ? null : 0, armholeDrop: 1.5, shoulderEase: 1,
    cfExtension: double ? 7 : 2.5, bustDart: female, sa: { neck: 1, shoulder: 1.5, armhole: 1, side: 2, hem: 4, cf: 1, cb: 2 },
  });
  d.info.torso = tb.info;
  const I = tb.info;
  if (female) {
    putPiece(d, tb.back);
    putPiece(d, tb.front);
    addSeam(d, 'side', [['back', 'side']], [['front', 'side', true]]);
  } else {
    // Men: back + front joined at the side, then cut into back, side panel and front with suppression wedges.
    const whole = joinPieces(tb.back, 'side', tb.front, 'side', { transform: false, piece: { id: 'body' } });
    const S = I.half - (m.W + ease.waist) / 2;
    const wedge = (x0, yTop, x1, w) => {
      const mk = (sgn) => {
        const pts = [];
        const n = 24;
        for (let k = 0; k <= n; k++) {
          const y = yTop + (I.yHem - yTop) * (k / n);
          const x = x0 + (x1 - x0) * (k / n);
          // Bump: 0 at the top, full at the waist, a quarter at the hip, 0 at the hem.
          const b = y <= I.yW ? Math.sin(((y - yTop) / (I.yW - yTop)) * Math.PI / 2) ** 2 : y <= I.yHip ? 1 - 0.75 * ((y - I.yW) / (I.yHip - I.yW)) : 0.25 * Math.max(0, 1 - (y - I.yHip) / Math.max(1, I.yHem - I.yHip));
          pts.push([x + sgn * (w / 2) * b, y]);
        }
        return pts;
      };
      return [mk(-1), mk(1)];
    };
    const arm = whole.edges.find((e) => e.id === 'armhole');
    const AL = plLength(arm.pts);
    const pBack = pointAt(arm.pts, I.armholeBack * 0.78).p, pFront = pointAt(arm.pts, I.armholeBack + I.armholeFront * 0.3).p;
    const hem = whole.edges.find((e) => e.id === 'hem');
    const hemStart = hem.pts[0];
    const xBackHem = I.wB * 0.62, xFrontHem = I.wB + I.wF * 0.28;
    const [wbA, wbB] = wedge(pBack[0], pBack[1], xBackHem, Math.max(0, S * 0.45));
    // splitPiece: A runs from `from` forward; from = the armhole point, forward goes round the front to the hem point.
    const [frontPart, backPanel] = splitPiece(whole, {
      from: { edge: 'armhole', at: I.armholeBack * 0.78 }, to: { edge: 'hem', at: hemStart[0] - xBackHem },
      pts: wbB, ptsB: wbA, ids: ['backPanel', 'backPanel'], pieces: [{ id: 'rest' }, { id: 'back', name: 'back' }],
    });
    const arm2 = frontPart.edges.find((e) => e.id === 'armhole');
    const hem2 = frontPart.edges.find((e) => e.id === 'hem');
    const [wfA, wfB] = wedge(pFront[0], pFront[1], xFrontHem, Math.max(0, S * 0.35));
    const [front, side] = splitPiece(frontPart, {
      from: { edge: 'armhole', at: plLength(arm2.pts) - (AL - (I.armholeBack + I.armholeFront * 0.3)) }, to: { edge: 'hem', at: hem2.pts[0][0] - xFrontHem },
      pts: wfB, ptsB: wfA, ids: ['frontPanel', 'frontPanel'], pieces: [{ id: 'front', name: 'front' }, { id: 'side', name: 'sidePanel' }],
    });
    // The side panel's cut edge from the back split runs the other way round: keep ids as they are.
    putPiece(d, backPanel);
    putPiece(d, side);
    putPiece(d, front);
    for (const p of [backPanel, side, front]) p.cut = { n: 2, mirror: true };
    addSeam(d, 'backPanel', [['back', 'backPanel']], [['side', 'backPanel', true]]);
    addSeam(d, 'frontPanel', [['side', 'frontPanel']], [['front', 'frontPanel', true]]);
  }
  addSeam(d, 'shoulder', [['back', 'shoulder']], [['front', 'shoulder', true]], { ease: edgeLength(getPiece(d, 'front'), 'shoulder') - edgeLength(getPiece(d, 'back'), 'shoulder') });
  addSeam(d, 'cb', [['back', 'cb']], [['back', 'cb']], { sides: 'center' });
  dartSeams(d);
  // Two-piece sleeve with a full cap ease.
  const armPath = female ? [['back', 'armhole'], ['front', 'armhole']] : [['back', 'armhole'], ['side', 'armhole'], ['front', 'armhole']];
  const AH = pathLen(d, armPath);
  const sb = sleeveBlock(m, { ahFront: I.armholeFront, ahBack: AH - I.armholeFront, capEase: 3.2, bicepEase: o.fit === 'slim' ? 7 : 9, length: m.armLength + 1.5, hemWidth: Math.max(m.wrist + 12, 27), sa: { cap: 1, under: 1.5, hem: 4 } });
  const tp = twoPieceSleeve(sb.sleeve, sb.info);
  putPiece(d, { ...tp.top, cut: { n: 2, mirror: true } });
  putPiece(d, { ...tp.under, cut: { n: 2, mirror: true } });
  d.info.sleeve = sb.info;
  addSeam(d, 'armhole', armPath, [['topSleeve', 'capBack'], ['underSleeve', 'capBack'], ['underSleeve', 'capFront'], ['topSleeve', 'capFront']], { ease: sb.info.capFront + sb.info.capBack - AH, notches: [0.25, 0.5, 0.75] });
  addSeam(d, 'sleeveFront', [['topSleeve', 'frontSeam']], [['underSleeve', 'frontSeam', true]]);
  addSeam(d, 'sleeveBack', [['topSleeve', 'backSeam']], [['underSleeve', 'backSeam', true]]);
  d.info.buttonLine = { x: I.W, y0: I.yW - 12, y1: I.yHem - 6 };
  d.info.double = double;
}

// --- cummerbund, tote -----------------------------------------------------------------------------------------------------

function cummerbund(d, m, o) {
  const w = m.waist * 0.62, hmax = o.height || 12, hEnd = hmax * 0.6;
  // Front panel: the half from the centre front (fold) to the side end; tapered ends.
  const p = makePiece({
    id: 'cummerbund', name: 'cummerbund', material: 'satin', cut: { n: 2, fold: 'cf' },
    edges: [
      { id: 'top', pts: curve([0, 0], [1, 0], [w / 2, (hmax - hEnd) / 2], [1, 0.1], 0.5, 0.3), sa: 1 },
      { id: 'end', pts: [[w / 2, (hmax - hEnd) / 2], [w / 2, (hmax + hEnd) / 2]], sa: 1 },
      { id: 'bottom', pts: curve([w / 2, (hmax + hEnd) / 2], [-1, 0.1], [0, hmax], [-1, 0], 0.3, 0.5), sa: 1 },
      { id: 'cf', pts: [[0, hmax], [0, 0]], sa: 0, kind: 'fold' },
    ],
    arrange: { mode: 'band', ref: 'waist', girth: m.waist + 3, from: 90, span: 180 * 0.62, centerY: hmax / 2, dy: -2 },
    meta: { band: true },
  });
  // The pleats are marks (details: pleats); the strap closes the back.
  putPiece(d, p);
  // The strap closes the back: from the right end round the back to the left end.
  const Ls = m.waist * 0.38 + 8;
  putPiece(d, rectPiece('strap', Ls, 4, { cut: { n: 1 }, material: 'lining', arrange: { mode: 'strap', L: Ls }, meta: { band: true } }));
  addSeam(d, 'strapRight', [['strap', 'left']], [['cummerbund', 'end', true]], { sides: 'single', kind: 'attach', notches: [], ease: hEnd - 4 });
  addSeam(d, 'strapLeft', [['strap', 'right']], [['cummerbund', 'end']], { sides: 'center', kind: 'attach', notches: [], ease: hEnd - 4 });
  d.info.cummerbund = { w, hmax };
}

function tote(d, m, o) {
  const W = o.width, H = o.height, g = o.gusset;
  const c = g / 2;
  const edges = [
    { id: 'top', pts: [[0, 0], [W, 0]], sa: 3, kind: 'hem' },
    { id: 'side', pts: [[W, 0], [W, H - c]], sa: 1 },
    ...(c > 0 ? [{ id: 'cornerR.a', pts: [[W, H - c], [W - c, H - c]], sa: 1, kind: 'dart' }, { id: 'cornerR.b', pts: [[W - c, H - c], [W - c, H]], sa: 1, kind: 'dart' }] : []),
    { id: 'bottom', pts: [[W - c, H], [c, H]], sa: 1 },
    ...(c > 0 ? [{ id: 'cornerL.a', pts: [[c, H], [c, H - c]], sa: 1, kind: 'dart' }, { id: 'cornerL.b', pts: [[c, H - c], [0, H - c]], sa: 1, kind: 'dart' }] : []),
    { id: 'sideL', pts: [[0, H - c], [0, 0]], sa: 1 },
  ];
  const panel = makePiece({ id: 'panel', name: 'panel', material: 'shell', cut: { n: 2, mirror: true }, edges, arrange: { mode: 'bag', W, H, gusset: g } });
  putPiece(d, panel);
  const handleL = 62;
  putPiece(d, rectPiece('handle', 4, handleL, { name: 'handle', cut: { n: 2, mirror: true }, arrange: { mode: 'handle', W, H, gusset: g }, meta: { handle: true } }));
  // Front panel (right instance) and back panel (its mirror): each edge meets the same edge of the other panel.
  addSeam(d, 'sides', [['panel', 'side']], [['panel', 'side']], { sides: 'center' });
  addSeam(d, 'sidesL', [['panel', 'sideL']], [['panel', 'sideL']], { sides: 'center' });
  addSeam(d, 'bottom', [['panel', 'bottom']], [['panel', 'bottom']], { sides: 'center' });
  // Handle ends stitched to the top edge (4 cm stretches), the handles hang from a hook at their middle (3D pins).
  addSeam(d, 'handleFront', [['handle', 'top']], [['panel', 'top', false, W * 0.28 - 2, W * 0.28 + 2]], { kind: 'attach', notches: [] });
  addSeam(d, 'handleBack', [['handle', 'bottom']], [['panel', 'top', true, W * 0.72 - 2, W * 0.72 + 2]], { kind: 'attach', notches: [] });
  d.pins.push({ piece: 'handle', p: [2, handleL / 2] });
  if (c > 0) {
    addSeam(d, 'boxR', [['panel', 'cornerR.a']], [['panel', 'cornerR.b', true]], { kind: 'dart', notches: [] });
    addSeam(d, 'boxL', [['panel', 'cornerL.a']], [['panel', 'cornerL.b', true]], { kind: 'dart', notches: [] });
  }
  d.printAreas.front = { piece: 'panel', center: [W / 2, H * 0.45], w: Math.min(W - 8, 30), h: Math.min(H - 10, 30) };
  d.info.tote = { W, H, g, handleL };
}

export { easeOf, line, spline };
