// garment/details.js - details as layered components. Each component belongs to a layer of the explicit stacking
// order (inside to outside), changes the draft (new pieces, reshaped pieces, marks, seams) and may add 3D overlays
// (pieces lying on a parent piece: a lapel folded over the chest, a pocket flap, a satin stripe) and buttons.
//
//   STACK                         layer order, inside -> outside (the 3D offsets and the drawing order follow it)
//   DETAILS                       { type: { category: 'inner' | 'outer', layer, garments, variants, options } }
//   defaultDetails(garment, opts) the components a template starts with
//   detailChoices(garment)        component types that apply to a garment (for the "add detail" menu)
//   applyDetails(draft, list)     applies components in stacking order (structural ones first)
//   stackIndex(layer)

import { addEdgeDart, edgeChain, edgeLength, makePiece, outline, splitPiece, transformPiece } from './piece.js';
import { apply, bbox, curve, dist, inside, line, plLength, pointAt, reflectLine, rotation, spline, translate, compose } from './geom.js';

//
// Details are optional components applied after the base draft. STACK orders layers from body outward for drawing
// and simulation; ORDER below fixes application order, because details depend on each other (a lapel reshapes the
// front that a collar, a facing and a lining then copy).
export const STACK = ['pocketing', 'lining', 'canvas', 'interfacing', 'facing', 'shell', 'band', 'placket', 'lapel', 'collar', 'pocket', 'flap', 'trim', 'button'];
export const stackIndex = (layer) => { const i = STACK.indexOf(layer); return i < 0 ? STACK.indexOf('shell') : i; };

const ALL_TOPS = ['tshirt', 'longsleeve', 'tank', 'sweatshirt', 'hoodie'];
export const DETAILS = {
  lining: { category: 'inner', layer: 'lining', garments: ['jacket', 'waistcoat', 'dress', 'skirt', 'chokha', 'arkhaluk', 'kartuli', 'kaftan', 'sarafan', 'bomber', 'parka', 'puffer'], options: [{ key: 'material', type: 'seg', values: ['lining', 'satin'], def: 'lining' }] },
  interfacing: { category: 'inner', layer: 'interfacing', garments: ['shirt', 'jacket', 'waistcoat', 'dress', 'skirt', 'trousers', 'chokha', 'arkhaluk', 'kartuli', 'kaftan', 'kosovorotka', 'rubakha', 'bomber', 'parka', 'puffer', 'trucker'] },
  canvas: { category: 'inner', layer: 'canvas', garments: ['jacket'] },
  pocketing: { category: 'inner', layer: 'pocketing', garments: ['jacket', 'waistcoat', 'trousers', 'skirt', 'chokha', 'kaftan', 'bomber', 'parka', 'puffer', 'trucker'] },
  facing: { category: 'inner', layer: 'facing', garments: ['jacket', 'waistcoat', 'dress', 'chokha', 'arkhaluk', 'kartuli', 'kaftan', 'sarafan'], options: [{ key: 'material', type: 'seg', values: ['shell', 'satin', 'contrast'], def: 'shell' }] },
  label: { category: 'inner', layer: 'trim', garments: ['tshirt', 'longsleeve', 'tank', 'sweatshirt', 'hoodie', 'shirt', 'jacket', 'tote', 'kosovorotka', 'rubakha', 'bomber', 'parka', 'puffer', 'trucker', 'chokha', 'arkhaluk', 'kartuli', 'kaftan'] },
  collar: { category: 'outer', layer: 'collar', garments: [...ALL_TOPS, 'shirt', 'dress', 'arkhaluk', 'kaftan', 'kosovorotka', 'rubakha', ...['bomber', 'parka', 'puffer', 'trucker']], variants: ['band', 'shirt', 'stand', 'hood', 'none'] },
  lapel: { category: 'outer', layer: 'lapel', garments: ['jacket'], variants: ['notch', 'peak', 'shawl'], options: [{ key: 'width', type: 'range', min: 4, max: 12, step: 0.5, def: 8, unit: 'cm' }, { key: 'facing', type: 'seg', values: ['shell', 'satin', 'contrast'], def: 'shell' }] },
  pocket: { category: 'outer', layer: 'pocket', garments: ['shirt', 'jacket', 'waistcoat', 'trousers', 'skirt', 'hoodie', 'sweatshirt', 'tshirt', 'dress', 'tote', 'bomber', 'parka', 'puffer', 'trucker'], variants: ['patch', 'flap', 'jetted', 'welt', 'kangaroo', 'sideSeam'], options: [{ key: 'position', type: 'seg', values: ['hip', 'chest', 'back'], def: 'hip' }, { key: 'material', type: 'seg', values: ['shell', 'satin', 'contrast'], def: 'shell' }] },
  buttons: { category: 'outer', layer: 'button', garments: ['shirt', 'jacket', 'waistcoat', 'dress', 'arkhaluk', 'kaftan', 'trucker'], options: [{ key: 'count', type: 'range', min: 1, max: 16, step: 1, def: 2 }, { key: 'size', type: 'range', min: 0.6, max: 3, step: 0.1, def: 2, unit: 'cm' }] },
  placket: { category: 'outer', layer: 'placket', garments: ['shirt'] },
  cuffs: { category: 'outer', layer: 'band', garments: ['shirt', 'sweatshirt', 'hoodie', 'longsleeve', 'trousers', 'jacket', 'kosovorotka', 'rubakha', 'bomber', 'parka', 'puffer', 'trucker'], variants: ['barrel', 'french', 'rib', 'turnup', 'none'] },
  hemBand: { category: 'outer', layer: 'band', garments: ['sweatshirt', 'hoodie', 'tshirt', 'longsleeve', 'bomber', 'puffer', 'trucker'], options: [{ key: 'material', type: 'seg', values: ['rib', 'shell'], def: 'rib' }] },
  waistband: { category: 'outer', layer: 'band', garments: ['trousers', 'skirt'], options: [{ key: 'depth', type: 'range', min: 2.5, max: 8, step: 0.5, def: 4, unit: 'cm' }] },
  beltLoops: { category: 'outer', layer: 'trim', garments: ['trousers'] },
  trim: { category: 'outer', layer: 'trim', garments: ['trousers', 'jacket', 'tshirt', 'hoodie'], variants: ['satinStripe', 'piping'], options: [{ key: 'material', type: 'seg', values: ['satin', 'contrast'], def: 'satin' }] },
  vent: { category: 'outer', layer: 'shell', garments: ['jacket', 'skirt', 'chokha', 'kaftan'], variants: ['center', 'side'] },
  pleats: { category: 'outer', layer: 'shell', garments: ['cummerbund'], options: [{ key: 'count', type: 'range', min: 2, max: 6, step: 1, def: 4 }] },
  drawcord: { category: 'outer', layer: 'trim', garments: ['hoodie', 'parka'] },
  zip: { category: 'outer', layer: 'trim', garments: ['dress', 'skirt', 'trousers'] },
  gazyri: { category: 'outer', layer: 'pocket', garments: ['chokha'], options: [{ key: 'count', type: 'range', min: 4, max: 12, step: 1, def: 8 }, { key: 'material', type: 'seg', values: ['shell', 'contrast', 'satin'], def: 'shell' }] },
  quilting: { category: 'inner', layer: 'canvas', garments: ['puffer', 'parka', 'chokha', 'kaftan'], variants: ['channels', 'diamond'], options: [{ key: 'spacing', type: 'range', min: 4, max: 24, step: 1, def: 10, unit: 'cm' }] },
};

export function detailChoices(garment) { return Object.keys(DETAILS).filter((k) => DETAILS[k].garments.includes(garment)); }

export function defaultDetails(garment, opts = {}) {
  const male = opts.sex === 'male';
  void male;
  const D = {
    tshirt: [{ type: 'collar', variant: 'band' }, { type: 'label' }],
    longsleeve: [{ type: 'collar', variant: 'band' }, { type: 'label' }],
    tank: [{ type: 'collar', variant: 'band' }],
    sweatshirt: [{ type: 'collar', variant: 'band' }, { type: 'cuffs', variant: 'rib' }, { type: 'hemBand' }, { type: 'label' }],
    hoodie: [{ type: 'collar', variant: 'hood' }, { type: 'cuffs', variant: 'rib' }, { type: 'hemBand' }, { type: 'pocket', variant: 'kangaroo' }, { type: 'drawcord' }, { type: 'label' }],
    shirt: [{ type: 'collar', variant: 'shirt' }, { type: 'placket' }, { type: 'cuffs', variant: 'barrel' }, { type: 'buttons', count: 7, size: 1.1 }, { type: 'pocket', variant: 'patch', position: 'chest' }, { type: 'interfacing' }],
    dress: [{ type: 'facing' }, { type: 'zip' }, { type: 'lining' }],
    skirt: [{ type: 'waistband' }, { type: 'zip' }, { type: 'vent', variant: 'center' }, { type: 'lining' }],
    trousers: [{ type: 'waistband' }, { type: 'zip' }, { type: 'pocket', variant: 'sideSeam' }, { type: 'pocket', variant: 'jetted', position: 'back' }, { type: 'beltLoops' }, { type: 'pocketing' }, { type: 'interfacing' }],
    waistcoat: [{ type: 'buttons', count: 5, size: 1.5 }, { type: 'pocket', variant: 'welt' }, { type: 'facing' }, { type: 'lining' }, { type: 'interfacing' }, { type: 'pocketing' }],
    jacket: [{ type: 'lapel', variant: 'notch' }, { type: 'buttons', count: 2 }, { type: 'pocket', variant: 'flap' }, { type: 'pocket', variant: 'welt', position: 'chest' }, { type: 'cuffs', variant: 'none' }, { type: 'vent', variant: 'center' }, { type: 'facing' }, { type: 'lining' }, { type: 'canvas' }, { type: 'interfacing' }, { type: 'pocketing' }],
    cummerbund: [{ type: 'pleats', count: 4 }],
    tote: [{ type: 'label' }],
    chokha: [{ type: 'gazyri', count: 8 }, { type: 'vent', variant: 'center' }, { type: 'facing' }, { type: 'lining' }, { type: 'interfacing' }],
    arkhaluk: [{ type: 'collar', variant: 'stand' }, { type: 'buttons', count: 12, size: 0.9 }, { type: 'facing' }, { type: 'lining' }],
    kartuli: [{ type: 'facing' }, { type: 'lining' }],
    kaftan: [{ type: 'collar', variant: 'stand' }, { type: 'buttons', count: 7, size: 2 }, { type: 'facing' }, { type: 'lining' }, { type: 'interfacing' }],
    kosovorotka: [{ type: 'collar', variant: 'stand' }, { type: 'cuffs', variant: 'barrel' }, { type: 'label' }],
    rubakha: [{ type: 'collar', variant: 'stand' }, { type: 'cuffs', variant: 'barrel' }],
    sarafan: [{ type: 'facing' }, { type: 'lining' }],
    bomber: [{ type: 'collar', variant: 'band' }, { type: 'cuffs', variant: 'rib' }, { type: 'hemBand', material: 'rib' }, { type: 'pocket', variant: 'welt' }, { type: 'lining' }, { type: 'label' }],
    parka: [{ type: 'collar', variant: 'hood' }, { type: 'drawcord' }, { type: 'pocket', variant: 'flap' }, { type: 'quilting', variant: 'channels', spacing: 14 }, { type: 'lining' }, { type: 'label' }],
    puffer: [{ type: 'collar', variant: 'stand' }, { type: 'cuffs', variant: 'rib' }, { type: 'quilting', variant: 'channels', spacing: 10 }, { type: 'lining' }, { type: 'label' }],
    trucker: [{ type: 'collar', variant: 'shirt' }, { type: 'buttons', count: 6, size: 1.5 }, { type: 'pocket', variant: 'flap', position: 'chest' }, { type: 'cuffs', variant: 'barrel' }, { type: 'hemBand', material: 'shell' }, { type: 'label' }],
    belt: [],
  };
  return (D[garment] || []).map((c) => ({ ...c }));
}

// Structural components first (they reshape pieces), then the ones that read the final shapes.
const ORDER = ['lapel', 'vent', 'gazyri', 'quilting', 'collar', 'placket', 'cuffs', 'hemBand', 'waistband', 'trim', 'pocket', 'buttons', 'beltLoops', 'pleats', 'drawcord', 'zip', 'label', 'facing', 'lining', 'canvas', 'interfacing', 'pocketing'];

// Each detail runs isolated in try/catch: a detail that cannot fit this garment/size is skipped with a note instead
// of failing the whole draft.
export function applyDetails(d, list) {
  d.detailsList = list;
  d.notes = d.notes || [];
  const sorted = list.slice().sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
  for (const c of sorted) {
    const def = DETAILS[c.type];
    if (!def || !def.garments.includes(d.garment)) continue;
    const fn = APPLY[c.type];
    if (!fn) continue;
    try {
      fn(d, { ...defaultsOf(c.type), ...c });
      d.components.push({ ...c, layer: def.layer, category: def.category });
    } catch (e) {
      d.notes.push(`${c.type}: ${e.message}`);
    }
  }
  // Every piece knows its stack index; pieces drawn / simulated in this order.
  for (const p of d.pieces) p.stack = stackIndex(p.layer);
  for (const o of d.overlays) o.stack = stackIndex(o.layer);
}

function defaultsOf(type) {
  const o = {};
  for (const opt of DETAILS[type].options || []) o[opt.key] = opt.def;
  if (DETAILS[type].variants) o.variant = DETAILS[type].variants[0];
  return o;
}

// --- shared helpers --------------------------------------------------------------------------------------------------

const get = (d, id) => d.pieces.find((p) => p.id === id) || null;
const put = (d, p) => { const i = d.pieces.findIndex((q) => q.id === p.id); if (i >= 0) d.pieces[i] = p; else d.pieces.push(p); return p; };
const seam = (d, id, a, b, o = {}) => { d.seams = d.seams.filter((s) => s.id !== id); d.seams.push({ id, a, b, ease: 0, kind: 'seam', sides: 'pair', notches: [0.5], ...o }); };
const chainLen = (p, base) => edgeChain(p, base).reduce((s, id) => s + edgeLength(p, id), 0);
const pathLength = (d, path) => path.reduce((s, [pid, base]) => s + chainLen(get(d, pid), base), 0);

function rect(id, w, h, o = {}) {
  const sa = o.sa ?? 1;
  return makePiece({
    id, name: o.name || id, material: o.material || 'shell', layer: o.layer || 'shell', cut: o.cut || { n: 1 },
    edges: [
      { id: o.top || 'top', pts: [[0, 0], [w, 0]], sa, kind: o.topKind || 'seam' },
      { id: o.right || 'right', pts: [[w, 0], [w, h]], sa, kind: o.rightKind || 'seam' },
      { id: o.bottom || 'bottom', pts: [[w, h], [0, h]], sa, kind: o.bottomKind || 'seam' },
      { id: o.left || 'left', pts: [[0, h], [0, 0]], sa: o.saLeft ?? sa, kind: o.leftKind || 'seam' },
    ],
    grain: [[w / 2, h * 0.15], [w / 2, h * 0.85]], arrange: o.arrange || null, sim: o.sim, meta: o.meta || {}, marks: o.marks || [],
  });
}

// An overlay: a 3D layer lying on `on`, drafted in its own coordinates and placed by M (into the parent's frame).
function overlay(d, id, piece, on, M, o = {}) {
  const placed = M ? transformPiece(piece, M) : piece;
  d.overlays = d.overlays.filter((x) => x.id !== id);
  d.overlays.push({ id, piece: { ...placed, id, layer: o.layer || 'pocket', material: o.material || piece.material }, on, lift: o.lift ?? 0.25, attach: o.attach || null, layer: o.layer || 'pocket', material: o.material || piece.material, side: o.side || 'both' });
}

// Placement mark on a parent piece (pocket positions, button lines) - drawn on the pattern.
const mark = (p, m) => { p.marks.push(m); return m; };

// Front torso piece of the draft and its frame data.
const torso = (d) => d.info.torso;

// --- lapels and the jacket collar -------------------------------------------------------------------------------------

APPLY_lapel.doc = 'Reshapes the jacket front: the lapel drawn as it lies on the chest is mirrored across the roll line into the cut front; adds the collar (notch / peak) or the shawl band, the facing material for the folded part.';
function APPLY_lapel(d, c) {
  const front = get(d, 'front');
  if (!front) return;
  const I = torso(d);
  const neck = front.edges.find((e) => e.id === 'neck');
  const cf = front.edges.find((e) => e.id === 'cf');
  const sh = front.edges.find((e) => e.id === 'shoulder');
  const SNP = neck.pts[0], SP = sh.pts[0];
  const xEdge = cf.pts[0][0];
  const nButtons = (d.detailsList || []).find((x) => x.type === 'buttons')?.count ?? 2;
  const yBreak = I.yW - (nButtons >= 3 ? 8 : nButtons === 2 ? 1 : 0);
  const Bp = [xEdge, yBreak];
  const shDir = [(SNP[0] - SP[0]) / dist(SNP, SP), (SNP[1] - SP[1]) / dist(SNP, SP)];
  const R = [SNP[0] + shDir[0] * 2.2, SNP[1] + shDir[1] * 2.2];
  // Roll-line frame: u along the roll line from the break point up, v towards the chest (the look side, -x).
  const Lr = dist(Bp, R);
  const U = [(R[0] - Bp[0]) / Lr, (R[1] - Bp[1]) / Lr];
  let V = [U[1], -U[0]];
  if (V[0] > 0) V = [-V[0], -V[1]];
  const at = (u, v) => [Bp[0] + U[0] * u + V[0] * v, Bp[1] + U[1] * u + V[1] * v];
  const w = c.width ?? (c.variant === 'peak' ? 9 : c.variant === 'shawl' ? 6.5 : 8);
  const gu = Math.min(Lr * 0.75, 7 + w * 0.4); // the lapel point lies this far below R along the roll line
  let look; // the visible lapel: break point -> outer edge -> ... -> back on the roll line
  let gorgeOnRoll = null;
  if (c.variant === 'shawl') {
    look = spline([at(0, 0), at(Lr * 0.35, w * 0.72), at(Lr * 0.7, w), at(Lr - 2.5, w * 0.75), at(Lr, 0.6)], 0.5);
  } else {
    const LP = c.variant === 'peak' ? at(Lr - gu + 3.6, w + 0.8) : at(Lr - gu, w);
    const NP = c.variant === 'peak' ? at(Lr - gu - 0.2, w - 3.4) : at(Lr - gu + 1.4, w - 3.4);
    gorgeOnRoll = at(Lr - gu + 3.2, 0);
    const edge = spline([at(0, 0), at((Lr - gu) * 0.45, w * 0.86), c.variant === 'peak' ? at(Lr - gu, w + 0.2) : LP], 0.5);
    look = [...edge, ...(c.variant === 'peak' ? [LP] : []), NP, gorgeOnRoll];
  }
  // The cut front: the region of the front beyond the roll line is replaced by the mirrored look.
  const Mr = reflectLine(Bp, R);
  const cutLapel = look.map((p) => apply(Mr, p));
  const end = cutLapel[cutLapel.length - 1];
  // New front outline: hem ... cf up to the break point, the mirrored lapel, the remaining neckline to the SNP.
  const edges = front.edges.map((e) => ({ ...e, pts: e.pts.map((p) => p.slice()) }));
  const iCf = edges.findIndex((e) => e.id === 'cf'), iNeck = edges.findIndex((e) => e.id === 'neck');
  edges[iCf] = { ...edges[iCf], pts: [[xEdge, yBreak], edges[iCf].pts[edges[iCf].pts.length - 1]] };
  const lapelPts = cutLapel;
  const dirNE = [end[0] - SNP[0], end[1] - SNP[1]];
  const neckNew = curve(SNP, [dirNE[0] * 0.6, dirNE[1] * 0.6 + 2], end, dirNE, 0.35, 0.35);
  const nGorge = c.variant === 'shawl' ? 0 : 2;
  // Order: neck (SNP -> end of the lapel run), [gorge], lapel (reversed: from the gorge to the break point), cf, ...
  const lapelRun = nGorge ? lapelPts.slice(0, -1) : lapelPts;
  const pieces = [];
  pieces.push({ id: 'neck', pts: neckNew, sa: 1 });
  if (nGorge) pieces.push({ id: 'gorge', pts: [lapelPts[lapelPts.length - 1], lapelPts[lapelPts.length - 2]], sa: 1 });
  pieces.push({ id: 'lapel', pts: lapelRun.slice().reverse(), sa: 1 });
  // The new edges take the place of the neck; the centre front edge now starts at the break point.
  const fNew = makePiece({ ...front, edges: [...edges.slice(0, iNeck), ...pieces, ...edges.slice(iNeck + 1)] });
  fNew.meta = { ...fNew.meta, roll: [Bp, R], lapel: c.variant, lapelWidth: w };
  mark(fNew, { type: 'line', id: 'rollLine', pts: [Bp, apply(Mr, look[look.length - 1])], role: 'fold' });
  put(d, fNew);
  // 3D: the part beyond the roll line folds over the chest - an overlay with the look shape in the facing material.
  const lookPiece = makePiece({ id: 'lapelLook', name: 'lapel', material: c.facing === 'satin' ? 'satin' : c.facing === 'contrast' ? 'contrast' : 'shell', edges: [{ id: 'outer', pts: look, sa: 0 }, { id: 'roll', pts: [look[look.length - 1], look[0]], sa: 0, kind: 'fold' }] });
  overlay(d, 'lapelLook', lookPiece, 'front', null, { layer: 'lapel', lift: 0.35, attach: ['roll'], material: lookPiece.material });
  d.info.lapel = { variant: c.variant, facing: c.facing, Bp, R, look, yBreak };
  // The 3D front ends at the roll line: the folded part is the overlay.
  d.info.rollCut = { piece: 'front', from: Bp, to: apply(Mr, look[look.length - 1]) };
  // Collar: notch / peak lapels have a separate collar sewn to the back neck and the front neck up to the gorge.
  const back = get(d, 'back');
  const neckLen = edgeLength(back, 'neck') + plLength(neckNew);
  if (c.variant !== 'shawl') {
    const stand = 3, fall = 4.2;
    const col = curvedBand('collar', neckLen, stand + fall, 4, { material: 'shell', layer: 'collar', endShape: c.variant === 'peak' ? 2.8 : 3.6 });
    put(d, col);
    seam(d, 'collarNeck', [['back', 'neck'], ['front', 'neck']], [['collar', 'neck']], { ease: edgeLength(col, 'neck') - neckLen });
    d.info.collar = { stand, fall, neckLen };
  } else {
    const band = curvedBand('shawlBand', edgeLength(back, 'neck'), 6.5 + 2.5, 1.5, { material: c.facing === 'satin' ? 'satin' : 'shell', layer: 'collar' });
    put(d, band);
    seam(d, 'shawlNeck', [['back', 'neck']], [['shawlBand', 'neck']]);
  }
}

// A band curved so that its outer edge is longer than its neck edge (collars, stands, shawl bands), drafted clockwise from
// the centre back (fold, x = 0): neck (CB -> front end, along the top), end, outer (front end -> CB), cb (fold). Both
// edges are arcs about a centre above the band, so the front end rises like a real collar stand.
function curvedBand(id, neckLen, depth, spread, o = {}) {
  const R0 = Math.max(12, (depth * neckLen) / Math.max(0.5, spread));
  const ang = neckLen / R0;
  const at = (r, a) => [r * Math.sin(a), -R0 + r * Math.cos(a)];
  const arc = (r, a0, a1) => { const n = Math.max(8, Math.ceil((Math.abs(a1 - a0) * r) / 0.5)); return Array.from({ length: n + 1 }, (_, i) => at(r, a0 + (a1 - a0) * (i / n))); };
  const neck = arc(R0, 0, ang);
  const outer = arc(R0 + depth, ang, 0);
  const endShape = o.endShape || 0;
  const tip = outer[0];
  const tipOut = [tip[0] + endShape * Math.cos(ang), tip[1] - endShape * Math.sin(ang)];
  return makePiece({
    id, name: id, material: o.material || 'shell', layer: o.layer || 'collar', cut: { n: 2, fold: 'cb' },
    edges: [
      { id: 'neck', pts: neck, sa: 1 },
      { id: 'end', pts: [neck[neck.length - 1], endShape ? tipOut : tip], sa: 1 },
      { id: 'outer', pts: endShape ? [tipOut, ...outer.slice(1)] : outer, sa: 1 },
      { id: 'cb', pts: [outer[outer.length - 1], neck[0]], sa: 0, kind: 'fold' },
    ],
    arrange: { mode: 'collar', depth, neckLen, stand: o.stand ?? 3 },
    meta: { band: true },
  });
}

// --- collars of tops and shirts ---------------------------------------------------------------------------------------

function neckPath(d) {
  const back = get(d, 'back') || get(d, 'yoke');
  const yoke = get(d, 'yoke');
  if (yoke) return [['yoke', 'neck'], ['front', 'neck']];
  return back ? [['back', 'neck'], ['front', 'neck']] : [];
}

function APPLY_collar(d, c) {
  const path = neckPath(d);
  if (!path.length) return;
  const L = pathLength(d, path);
  const ext = torso(d)?.cfExtension || 0;
  if (c.variant === 'none') return;
  if (c.variant === 'band') {
    // Rib neckband: cut shorter than the neckline (stretched on), folded in half.
    const depth = d.garment === 'tank' ? 1.2 : 2;
    const band = rect('neckband', L * 0.88, depth * 2, { material: 'rib', layer: 'band', cut: { n: 1, fold: 'left' }, left: 'cb', leftKind: 'fold', top: 'neck', bottom: 'outer', right: 'cf', sa: 0.75, arrange: { mode: 'collar', depth, neckLen: L, stand: depth, folded: true }, meta: { band: true, folded: true } });
    put(d, band);
    seam(d, 'neckband', path, [['neckband', 'neck']], { ease: L * 0.88 - L, kind: 'seam' });
    if (!d.info.openFront) seam(d, 'neckbandCf', [['neckband', 'cf']], [['neckband', 'cf']], { sides: 'center' });
    return;
  }
  if (c.variant === 'hood') {
    const m = d.m;
    const H = m.head / 2 + 12, Dp = m.head / 3 + 6; // hood height (neck to crown) and depth (face to back)
    const neckL = L + 1;
    // Clockwise: the neck runs from the face (x = neckL, the centre front end) back to the centre back, the crown
    // goes up the back and over the top, the face edge comes down.
    const hood = makePiece({
      id: 'hood', name: 'hood', cut: { n: 2, mirror: true }, layer: 'collar',
      edges: [
        { id: 'neck', pts: curve([neckL, -2], [-1, 0.3], [0, 0], [-1, -0.05], 0.4, 0.4), sa: 1 },
        { id: 'crown', pts: chain3(curve([0, 0], [-0.15, -1], [Dp * 0.25, -H + 6], [0.6, -0.8], 0.4, 0.45), curve([Dp * 0.25, -H + 6], [0.6, -0.8], [Dp - 2, -H], [1, 0], 0.45, 0.4)), sa: 1 },
        { id: 'face', pts: curve([Dp - 2, -H], [0.3, 1], [neckL, -2], [-0.1, 1], 0.4, 0.4), sa: 2.5, kind: 'hem' },
      ],
      arrange: { mode: 'hood', neckLen: neckL, H, D: Dp },
    });
    put(d, hood);
    seam(d, 'hoodNeck', path, [['hood', 'neck', true]], { ease: edgeLength(hood, 'neck') - L });
    seam(d, 'hoodCrown', [['hood', 'crown']], [['hood', 'crown']], { sides: 'center' });
    return;
  }
  // Shirt collar (stand + collar) or a mandarin stand alone.
  const standH = c.variant === 'stand' ? 3.5 : 3.2;
  const stand = curvedBand('stand', L + ext, standH, 1.0, { material: 'shell', layer: 'collar', stand: standH });
  stand.cut = { n: 2, fold: 'cb' };
  put(d, stand);
  seam(d, 'standNeck', path, [['stand', 'neck']], { ease: edgeLength(stand, 'neck') - L });
  d.stiffen.stand = 2.5;
  if (c.variant === 'shirt') {
    const col = curvedBand('collar', edgeLength(stand, 'outer'), 4.5, 3.2, { material: 'shell', layer: 'collar', endShape: 2.5, stand: 0.8 });
    put(d, col);
    seam(d, 'collarStand', [['stand', 'outer', true]], [['collar', 'neck']], { ease: 0 });
    d.stiffen.collar = 2.5;
  }
}
const chain3 = (a, b) => [...a, ...b.slice(1)];

// --- placket, cuffs, bands ------------------------------------------------------------------------------------------

function APPLY_placket(d) {
  const front = get(d, 'front');
  if (!front) return;
  const cf = front.edges.find((e) => e.id === 'cf');
  const L = plLength(cf.pts);
  put(d, rect('placket', 3.6, L, { material: 'shell', layer: 'placket', cut: { n: 2, mirror: true }, left: 'edge', right: 'fold', sa: 1, sim: false, meta: { facing: true } }));
  mark(front, { type: 'line', id: 'placketFold', pts: cf.pts.map((p) => p.slice()), role: 'fold' });
}

function APPLY_cuffs(d, c) {
  const m = d.m;
  if (c.variant === 'none') return;
  if (d.garment === 'trousers') {
    if (c.variant !== 'turnup') return;
    const front = get(d, 'trouserFront'), back = get(d, 'trouserBack');
    for (const p of [front, back]) { const hem = p.edges.find((e) => e.id === 'hem'); hem.sa = 9; mark(p, { type: 'line', id: 'turnup', pts: hem.pts.map(([x, y]) => [x, y - 4]), role: 'fold' }); }
    d.info.turnup = 4;
    return;
  }
  const sleeve = get(d, 'sleeve') || get(d, 'topSleeve');
  if (!sleeve) return;
  const hemPath = get(d, 'underSleeve') ? [['topSleeve', 'hem'], ['underSleeve', 'hem']] : [['sleeve', 'hem']];
  const hemL = pathLength(d, hemPath);
  if (c.variant === 'rib') {
    const depth = 7;
    const L = Math.max(m.wrist + 3, hemL * 0.72);
    put(d, rect('cuff', L, depth * 2, { material: 'rib', layer: 'band', cut: { n: 2, mirror: true }, top: 'attach', bottom: 'outer', left: 'end', right: 'end2', sa: 0.75, arrange: { mode: 'cuff', depth, folded: true }, meta: { band: true, folded: true } }));
    seam(d, 'cuff', hemPath, [['cuff', 'attach', true]], { ease: L - hemL });
    seam(d, 'cuffEnds', [['cuff', 'end']], [['cuff', 'end2', true]]);
    return;
  }
  // Shirt cuffs: barrel (one button) or French (double, folded back, cufflinks); jacket sleeves have no cuff piece.
  if (d.garment === 'jacket') return;
  const depth = c.variant === 'french' ? 12 : 6;
  const L = m.wrist + 7 + 2;
  put(d, rect('cuff', L, depth, { material: 'shell', layer: 'band', cut: { n: 4 }, top: 'attach', bottom: 'outer', left: 'end', right: 'end2', sa: 1, arrange: { mode: 'cuff', depth: c.variant === 'french' ? 6 : 6, folded: c.variant === 'french' }, meta: { band: true, folded: c.variant === 'french' } }));
  seam(d, 'cuff', hemPath, [['cuff', 'attach', true, 0, L - 2]], { ease: L - 2 - hemL });
  d.stiffen.cuff = 2.5;
  if (c.variant === 'barrel') d.buttons.push({ piece: 'cuff', p: [L - 1.5, depth / 2], d: 1.1, side: 'both' });
}

function APPLY_hemBand(d, c = {}) {
  const back = get(d, 'back'), front = get(d, 'front');
  if (!back || !front) return;
  const path = [['back', 'hem'], ['front', 'hem', true]];
  const L = pathLength(d, path);
  const depth = 7;
  const rib = c.material !== 'shell';
  put(d, rect('hemband', L * (rib ? 0.9 : 1), (rib ? depth : 4) * 2, { material: rib ? 'rib' : 'shell', layer: 'band', cut: { n: 1, fold: 'left' }, left: 'cb', leftKind: 'fold', top: 'attach', bottom: 'outer', right: 'cf', sa: 0.75, arrange: { mode: 'hemband', depth, folded: true }, meta: { band: true, folded: true } }));
  seam(d, 'hemband', [['back', 'hem', true], ['front', 'hem', true]], [['hemband', 'attach']], { ease: L * (rib ? 0.9 : 1) - L });
  if (!d.info.openFront) seam(d, 'hembandCf', [['hemband', 'cf']], [['hemband', 'cf']], { sides: 'center' });
  else if (!rib) d.buttons.push({ piece: 'hemband', p: [L - 1.5, 2], d: 1.5, side: 'R' });
  for (const p of [back, front]) { const h = p.edges.find((e) => e.id === 'hem'); h.sa = 0.75; h.kind = 'seam'; }
}

function APPLY_waistband(d, c) {
  const depth = c.depth ?? 4;
  // Centre back -> side -> centre front: the back waist runs CB to side, the front waist side to CF.
  const path = d.garment === 'trousers' ? [['trouserBack', 'waist'], ['trouserFront', 'waist', true]] : [['skirtBack', 'waist'], ['skirtFront', 'waist']];
  const L = pathLength(d, path);
  const ext = d.garment === 'trousers' ? 4 : 3;
  put(d, rect('waistband', L + ext, depth * 2, { material: 'shell', layer: 'band', cut: { n: 2, mirror: true }, left: 'cb', top: 'attach', bottom: 'outer', right: 'end', sa: 1, arrange: { mode: 'waistband', depth, folded: true }, meta: { band: true, folded: true } }));
  seam(d, 'waistband', path, [['waistband', 'attach', false, 0, L]], { ease: 0 });
  seam(d, 'waistbandCb', [['waistband', 'cb']], [['waistband', 'cb']], { sides: 'center' });
  d.stiffen.waistband = 3;
  d.buttons.push({ piece: 'waistband', p: [L + ext - 1.6, depth / 2], d: 1.5, side: 'R' });
}

function APPLY_trim(d, c) {
  if (c.variant === 'satinStripe' && d.garment === 'trousers') {
    const f = get(d, 'trouserFront');
    const side = f.edges.find((e) => e.id === 'side');
    // A stripe 2 cm wide centred on the outseam, lying on the front piece in 3D.
    const pts = side.pts;
    const inner = offsetToward(pts, 1.6, f);
    const stripe = makePiece({ id: 'stripe', name: 'stripe', material: c.material || 'satin', layer: 'trim', edges: [{ id: 'a', pts, sa: 0 }, { id: 'b', pts: [pts[pts.length - 1], inner[inner.length - 1]], sa: 0 }, { id: 'c', pts: inner.slice().reverse(), sa: 0 }, { id: 'd', pts: [inner[0], pts[0]], sa: 0 }] });
    overlay(d, 'stripe', stripe, 'trouserFront', null, { layer: 'trim', lift: 0.2, attach: ['a', 'c'], material: c.material || 'satin' });
    const strip = rect('stripeStrip', 2.2, plLength(pts), { material: c.material || 'satin', layer: 'trim', cut: { n: 2, mirror: true }, sim: false });
    put(d, strip);
    return;
  }
  if (c.variant === 'piping') {
    const f = get(d, 'front');
    if (!f) return;
    mark(f, { type: 'line', id: 'piping', pts: (f.edges.find((e) => e.id === 'lapel') || f.edges.find((e) => e.id === 'cf')).pts.map((p) => p.slice()), role: 'trim' });
  }
}

// Points of an edge moved `d` cm into the piece (towards its inside).
function offsetToward(pts, dd, piece) {
  const poly = outline(piece);
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const t = [(b[0] - a[0]) / (dist(a, b) || 1), (b[1] - a[1]) / (dist(a, b) || 1)];
    let n = [-t[1], t[0]];
    const probe = [pts[i][0] + n[0] * 0.3, pts[i][1] + n[1] * 0.3];
    if (!inside(poly, probe)) n = [-n[0], -n[1]];
    out.push([pts[i][0] + n[0] * dd, pts[i][1] + n[1] * dd]);
  }
  return out;
}

function APPLY_vent(d, c) {
  const back = get(d, d.garment === 'skirt' || d.info.coat ? 'skirtBack' : 'back');
  if (!back) return;
  const cb = back.edges.find((e) => e.id === 'cb');
  const hemY = Math.max(...cb.pts.map((p) => p[1]));
  const h = d.garment === 'skirt' ? 18 : d.info.coat ? Math.min(40, (d.info.skirt?.length || 60) * 0.45) : 22;
  if (c.variant === 'center' || d.garment === 'skirt' || d.info.coat) {
    mark(back, { type: 'line', id: 'vent', pts: [[cb.pts[0][0] - 4, hemY - h], [cb.pts[0][0] - 4, hemY]], role: 'vent' });
    back.meta.vent = { h, w: 4 };
    // The vent opens the centre back seam above the hem: the CB seam is shortened in 3D.
    // the centre back edge runs up from the hem; a long coat's vent is in its skirt only (its bodice stays closed)
    for (const s of d.seams) if ((s.id === 'cb' && !d.info.coat) || s.id === 'skirtCb') s.openStart = h;
  } else {
    const side = get(d, 'side');
    if (side) mark(side, { type: 'line', id: 'vent', pts: [[0, hemY - h], [0, hemY]], role: 'vent' });
    for (const s of d.seams) if (s.id === 'backPanel') s.openEnd = h;
  }
}

// Gazyri: the rows of cartridge pockets sewn on both chest fronts of a chokha, one tube per cartridge.
function APPLY_gazyri(d, c) {
  const front = get(d, 'front');
  const I = torso(d);
  if (!front || !I) return;
  const n = Math.max(2, Math.round(c.count ?? 8));
  const mat = c.material || 'shell';
  const tube = 1.8;
  const w = Math.min(I.wF * 0.62, n * tube + 1.2), h = 12.5;
  const cy = I.yC - 3;
  let cx = I.W - I.wF * 0.48;
  const sp = spanAt(front, cy + h / 2);
  if (sp) cx = Math.min(Math.max(cx, sp[0] + w / 2 + 2), sp[1] - w / 2 - 2.5);
  const piece = rect('gazyri', w, h, { material: mat, layer: 'pocket', cut: { n: 2, mirror: true }, top: 'mouth', sa: 1 });
  for (let k = 1; k < n; k++) piece.marks.push({ type: 'line', id: 'tube' + k, pts: [[0.6 + k * ((w - 1.2) / n), 0], [0.6 + k * ((w - 1.2) / n), h]], role: 'stitch' });
  put(d, piece);
  overlay(d, 'gazyri', rect('gazyri', w, h, { material: mat }), 'front', translate(cx - w / 2, cy), { layer: 'pocket', attach: ['right', 'bottom', 'left'], lift: 0.35, material: mat });
  front.marks.push({ type: 'line', id: 'gazyriTop', pts: [[cx - w / 2, cy], [cx + w / 2, cy]], role: 'pocket' });
  // the cartridges (gazyri proper) are the buttons of the row: small caps standing out of every tube
  for (let k = 0; k < n; k++) d.buttons.push({ piece: 'front', p: [cx - w / 2 + 0.6 + (k + 0.5) * ((w - 1.2) / n), cy - 0.6], d: 1.1, side: 'both', kind: 'cartridge' });
  d.info.gazyri = { n, w, h, cx, cy };
}

// Quilting: the stitching that holds the insulation (wadding) between the shell and the lining - channels across the
// body or a diamond grid; the wadding is cut like the shell pieces.
function APPLY_quilting(d, c) {
  const spacing = Math.max(3, c.spacing ?? 10);
  const ids = d.pieces.filter((p) => p.layer === 'shell' && p.material === 'shell' && !p.meta.band && /^(back|front|sleeve|skirtBack|skirtFront)$/.test(p.id)).map((p) => p.id);
  for (const id of ids) {
    const p = get(d, id);
    const poly = outline(p);
    const b = bbox(poly);
    let k = 0;
    // stitching lines clipped to the piece (runs of sample points inside the outline)
    const addLine = (a, z) => {
      const n = Math.max(2, Math.ceil(dist(a, z) / 0.5));
      let run = [];
      const flush = () => { if (run.length > 1 && dist(run[0], run[run.length - 1]) > 1.5) p.marks.push({ type: 'line', id: 'quilt' + k++, pts: [run[0], run[run.length - 1]], role: 'stitch' }); run = []; };
      for (let i = 0; i <= n; i++) {
        const q = [a[0] + ((z[0] - a[0]) * i) / n, a[1] + ((z[1] - a[1]) * i) / n];
        if (inside(poly, q)) run.push(q); else flush();
      }
      flush();
    };
    if (c.variant === 'diamond') {
      for (let t = -b.h; t < b.w + b.h; t += spacing) { addLine([b.x0 + t, b.y0], [b.x0 + t + b.h, b.y1]); addLine([b.x0 + t + b.h, b.y0], [b.x0 + t, b.y1]); }
    } else {
      for (let y = b.y0 + spacing; y < b.y1 - 1; y += spacing) addLine([b.x0 - 1, y], [b.x1 + 1, y]);
    }
    const q = JSON.parse(JSON.stringify(p));
    q.id = id + 'Wadding';
    q.name = (p.name || id) + 'Wadding';
    q.material = 'wadding';
    q.layer = 'canvas';
    q.sim = false;
    q.marks = [];
    for (const e of q.edges) e.sa = 0.5;
    put(d, makePiece(q));
    d.stiffen[id] = (d.stiffen[id] || 1) * 1.5;
  }
  d.info.quilting = { spacing, variant: c.variant || 'channels', loft: d.opts.loft || 1 };
}

function APPLY_pleats(d, c) {
  const p = get(d, 'cummerbund');
  if (!p) return;
  const b = bbox(outline(p));
  const n = c.count ?? 4;
  for (let i = 1; i <= n; i++) {
    const y = b.y0 + (b.h * i) / (n + 1);
    mark(p, { type: 'line', id: 'pleat' + i, pts: [[0, y], [b.x1 - 1, y + (y - b.h / 2) * 0.1]], role: 'pleat' });
  }
  p.meta.pleats = n;
}

function APPLY_drawcord(d) {
  const hood = get(d, 'hood');
  if (!hood) return;
  const face = hood.edges.find((e) => e.id === 'face');
  mark(hood, { type: 'drill', id: 'eyelet', p: pointAt(face.pts, 4).p, d: 0.8 });
  hood.meta.drawcord = true;
  d.info.drawcord = true;
}

function APPLY_zip(d) {
  // Dress and skirt: the centre back from the top down; trousers: the fly on the front crotch from the waist down.
  const targets = d.garment === 'trousers' ? [['trouserFront', 'crotch', 18]] : d.garment === 'dress' ? [['back', 'cb', 99], ['skirtBack', 'cb', 18]] : [['skirtBack', 'cb', 20]];
  for (const [pid, eid, len] of targets) {
    const p = get(d, pid);
    const e = p && p.edges.find((x) => x.id === eid);
    if (!e) continue;
    const L = plLength(e.pts);
    // cb edges run upwards (hem -> top), the front crotch downwards (waist -> fork).
    // Both run towards the waist: the fly is the top stretch of the front crotch, the zip the top of the centre back.
    const pts = eid === 'crotch' ? [pointAt(e.pts, Math.max(0, L - Math.min(L * 0.7, len))).p, e.pts[e.pts.length - 1]] : [pointAt(e.pts, Math.max(0, L - len)).p, e.pts[e.pts.length - 1]];
    mark(p, { type: 'line', id: 'zip', pts, role: 'zip' });
  }
}

function APPLY_label(d) {
  const p = get(d, 'back') || get(d, 'yoke') || get(d, 'panel');
  if (!p) return;
  const b = bbox(outline(p));
  mark(p, { type: 'label', id: 'label', p: [d.garment === 'tote' ? b.x0 + 3 : 0.5, b.y0 + 3], w: 5, h: 2.5 });
}

function APPLY_beltLoops(d) {
  const band = get(d, 'waistband');
  put(d, rect('beltLoop', 1.2, 7 * 5 + 4, { material: 'shell', layer: 'trim', cut: { n: 1 }, sim: false }));
  if (!band) return;
  // Loops lie on the folded waistband at the centre back side, the back and the front, measured from the centre back.
  const backW = pathLength(d, [['trouserBack', 'waist']]), frontW = pathLength(d, [['trouserFront', 'waist']]);
  const depth = band.arrange?.depth || 4;
  for (const x of [backW * 0.2, backW * 0.8, backW + frontW * 0.75]) {
    overlay(d, 'loop-' + Math.round(x), rect('loop', 1.2, depth - 0.4, { material: 'shell' }), 'waistband', translate(x - 0.6, 0.2), { layer: 'trim', lift: 0.3, attach: ['top', 'bottom'] });
  }
}

// --- pockets ---------------------------------------------------------------------------------------------------------

// x-range of a piece's outline at height y (the widest crossing pair).
function spanAt(p, y) {
  const poly = outline(p);
  const xs = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1]) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
  }
  return xs.length >= 2 ? [Math.min(...xs), Math.max(...xs)] : null;
}

function APPLY_pocket(d, c) {
  const v = c.variant;
  const mat = c.material || 'shell';
  if (v === 'kangaroo') return kangaroo(d, mat);
  if (v === 'sideSeam') return sideSeamPocket(d);
  const I = torso(d);
  let host, cx, cy, w, h, side = 'both';
  if (d.garment === 'trousers') {
    host = get(d, c.position === 'back' ? 'trouserBack' : 'trouserFront');
    cy = 9; w = 13; h = 16;
    const sp = host && spanAt(host, cy);
    cx = sp ? sp[0] + (sp[1] - sp[0]) * (c.position === 'back' ? 0.45 : 0.62) : 6;
  } else if (d.garment === 'tote') {
    host = get(d, 'panel'); cx = d.info.tote.W / 2; cy = d.info.tote.H * 0.3; w = 16; h = 14; side = 'R';
  } else if (d.garment === 'skirt') {
    host = get(d, 'skirtFront'); const W = d.info.skirt.W; cx = W - d.info.skirt.wF * 0.55; cy = 8; w = 13; h = 15;
  } else if (I) {
    host = get(d, 'front');
    if (c.position === 'chest') { side = 'L'; cy = I.yC - (d.garment === 'shirt' ? -1.5 : 1.5); w = d.garment === 'shirt' ? 12 : 10.5; h = d.garment === 'shirt' ? 14 : 2.4; cx = I.W - I.wF * (d.garment === 'shirt' ? 0.5 : 0.55); }
    else { cy = I.yW + Math.min(9, (I.yHem - I.yW) * 0.45); w = d.garment === 'waistcoat' ? 11 : 15; h = 17; cx = I.W - I.wF * 0.55; }
  }
  if (!host) return;
  // Keep the mouth inside the host at its height.
  const sp = spanAt(host, cy);
  if (sp) {
    const lo = sp[0] + 2, hi = sp[1] - (d.garment === 'tote' ? 2 : 3);
    w = Math.min(w, hi - lo);
    cx = Math.min(Math.max(cx, lo + w / 2), hi - w / 2);
  }
  const id = 'pocket-' + host.id + '-' + (c.position || 'hip') + '-' + v;
  host.marks.push({ type: 'line', id: id + '-mouth', pts: [[cx - w / 2, cy], [cx + w / 2, cy]], role: 'pocket', side });
  if (v === 'patch') {
    const p = rect(id, w, h, { material: mat, layer: 'pocket', cut: { n: side === 'both' ? 2 : 1 }, sa: 1, top: 'mouth' });
    p.edges[0].sa = 3; p.edges[0].kind = 'hem';
    put(d, p);
    overlay(d, id, rect(id, w, h, { material: mat }), host.id, translate(cx - w / 2, cy), { layer: 'pocket', attach: ['right', 'bottom', 'left'], material: mat, side });
  } else {
    const jetH = v === 'welt' ? 2.4 : 0.6;
    put(d, rect(id + '-jets', w + 4, v === 'welt' ? jetH * 2 + 2 : 8, { material: mat, layer: 'pocket', cut: { n: side === 'both' ? 2 : 1 }, sim: false }));
    overlay(d, id + '-jet', rect(id + '-jet', w, v === 'welt' ? jetH : jetH * 2, { material: mat }), host.id, translate(cx - w / 2, cy - jetH), { layer: 'pocket', attach: ['top', 'right', 'bottom', 'left'], material: mat, side });
    if (v === 'flap') {
      const flapH = 5.5;
      put(d, rect(id + '-flap', w + 0.4, flapH, { material: mat, layer: 'flap', cut: { n: side === 'both' ? 4 : 2 }, sa: 1 }));
      overlay(d, id + '-flap', rect(id + '-flap', w + 0.4, flapH, { material: mat }), host.id, translate(cx - w / 2 - 0.2, cy - 0.4), { layer: 'flap', attach: ['top'], lift: 0.45, material: mat, side });
    }
  }
  d.pockets = (d.pockets || []).concat([{ id, host: host.id, w, h: v === 'welt' ? 14 : v === 'patch' ? h : 18, cx, cy, kind: v, side }]);
}

function kangaroo(d, mat) {
  const front = get(d, 'front');
  if (!front) return;
  const I = torso(d);
  const W = I.W, top = I.yW - 4, bottom = I.yHem - 2, half = Math.min(I.wF * 0.78, 20);
  // Drafted as the right half from the centre front (fold): top, slanted opening, side, bottom.
  const p = makePiece({
    id: 'kangaroo', name: 'kangaroo', material: mat, layer: 'pocket', cut: { n: 1, fold: 'cf' },
    edges: [
      { id: 'top', pts: [[W - half * 0.62, top], [W, top]], sa: 1 },
      { id: 'cf', pts: [[W, top], [W, bottom]], sa: 0, kind: 'fold' },
      { id: 'bottom', pts: [[W, bottom], [W - half, bottom]], sa: 1 },
      { id: 'side', pts: [[W - half, bottom], [W - half, top + 9]], sa: 1 },
      { id: 'opening', pts: curve([W - half, top + 9], [0.25, -1], [W - half * 0.62, top], [0.6, -0.6], 0.4, 0.4), sa: 2, kind: 'hem' },
    ],
  });
  put(d, p);
  overlay(d, 'kangaroo', p, 'front', null, { layer: 'pocket', attach: ['top', 'bottom', 'side'], material: mat, lift: 0.4 });
}

function sideSeamPocket(d) {
  const f = get(d, 'trouserFront') || get(d, 'skirtFront');
  if (!f) return;
  const side = f.edges.find((e) => e.id === 'side');
  const L = plLength(side.pts);
  // Trouser sides run down from the waist, skirt sides too (front side seams of skirts run upwards: from the end).
  const fromTop = f.id === 'trouserFront';
  f.marks.push({ type: 'line', id: 'pocketOpening', pts: fromTop ? [pointAt(side.pts, 3).p, pointAt(side.pts, 19).p] : [pointAt(side.pts, L - 3).p, pointAt(side.pts, L - 19).p], role: 'pocket' });
  d.pockets = (d.pockets || []).concat([{ id: 'sideSeam', host: f.id, w: 16, h: 30, kind: 'sideSeam' }]);
}

// --- buttons and closures --------------------------------------------------------------------------------------------

function APPLY_buttons(d, c) {
  const n = Math.max(1, Math.round(c.count ?? 2));
  const size = c.size ?? (d.garment === 'shirt' ? 1.1 : 2);
  const I = torso(d);
  const front = get(d, 'front');
  if (!front || !I) return;
  let y0, y1;
  if (d.garment === 'shirt') { y0 = I.points.FNP[1] + 6; y1 = I.yHem - 10; }
  else if (d.info.buttonLine) { y0 = d.info.lapel ? d.info.lapel.yBreak : d.info.buttonLine.y0; y1 = d.info.buttonLine.y1; }
  else { y0 = I.yC; y1 = I.yHem - 8; }
  const step = d.garment === 'jacket' ? 10 : n > 1 ? (y1 - y0) / (n - 1) : 0;
  const x = I.W;
  const double = d.info.double;
  for (let i = 0; i < n; i++) {
    const y = y0 + i * step;
    if (y > I.yHem - 3) break;
    // Men button left over right: the holes are on the left front; women the other way.
    const holeSide = d.m.sex === 'male' ? 'L' : 'R';
    const buttonSide = holeSide === 'L' ? 'R' : 'L';
    d.buttons.push({ piece: 'front', p: [x, y], d: size, side: buttonSide });
    if (double) d.buttons.push({ piece: 'front', p: [x - 11, y], d: size, side: holeSide });
    front.marks.push({ type: 'buttonhole', id: 'bh' + i, p: [x + 0.4, y], w: size + 0.3, side: holeSide });
    front.marks.push({ type: 'button', id: 'b' + i, p: [x, y], d: size, side: buttonSide });
    d.closures.push({ piece: 'front', p: [x, y] });
  }
  if (d.garment === 'shirt' && get(d, 'stand')) d.buttons.push({ piece: 'stand', p: [edgeLength(get(d, 'stand'), 'neck') - 1.5, 1.6], d: size, side: 'R' });
  if (d.garment === 'jacket') {
    // Four buttons at the sleeve vent.
    const top = get(d, 'topSleeve');
    if (top) {
      const bs = top.edges.find((e) => e.id === 'backSeam');
      const end = bs.pts[bs.pts.length - 1];
      for (let k = 0; k < 4; k++) d.buttons.push({ piece: 'topSleeve', p: [end[0] - 2.2, end[1] - 3.5 - k * 2], d: 1.5, side: 'both' });
    }
  }
}

// --- inner layers ----------------------------------------------------------------------------------------------------

// The facing line of a front: from the shoulder 4 cm from the neck to the hem. Jackets: past the lapel (8 cm inside
// the front edge at the break point) and down; waistcoats: 5.5 cm inside the V neck and the front edge.
function facingSplit(d, front) {
  const sh = front.edges.find((e) => e.id === 'shoulder');
  const hemId = edgeChain(front, 'hem')[0];
  const hem = front.edges.find((e) => e.id === hemId);
  const fromAt = Math.max(0.5, plLength(sh.pts) - 4);
  const P = pointAt(sh.pts, fromAt).p;
  let via;
  const poly = outline(front);
  if (d.garment === 'waistcoat') {
    // Parallel to the V neck (its middle) and the front edge below the V point.
    const neck = front.edges.find((e) => e.id === 'neck').pts, cf = front.edges.find((e) => e.id === 'cf').pts;
    const mid = pointAt(neck, plLength(neck) * 0.5);
    const nIn = [-mid.tangent[1], mid.tangent[0]];
    via = [[mid.p[0] + nIn[0] * 5.5, mid.p[1] + nIn[1] * 5.5], [cf[0][0] - 5.5, cf[0][1] + 3]].filter((q) => inside(poly, q) && q[1] > P[1] + 1);
  } else {
    const cf = front.edges.find((e) => e.id === 'cf');
    via = [[cf.pts[0][0] - 8, cf.pts[0][1]]];
  }
  const toAt = Math.min(plLength(hem.pts) - 0.5, d.garment === 'waistcoat' ? 5.5 : 8);
  return splitPiece(front, { from: { edge: 'shoulder', at: fromAt }, to: { edge: hemId, at: toAt }, via, ids: ['facingEdge', 'facingEdge'] });
}

// Offset of a run of a clockwise outline towards the inside of the piece.
function offsetPolylineInward(pts, w) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const L = dist(a, b) || 1;
    out.push([pts[i][0] - ((b[1] - a[1]) / L) * w, pts[i][1] + ((b[0] - a[0]) / L) * w]);
  }
  return out;
}

function APPLY_facing(d, c) {
  const front = get(d, 'front');
  if (!front) return;
  const mat = c.material === 'satin' ? 'satin' : c.material === 'contrast' ? 'contrast' : 'shell';
  const lapelMat = d.info.lapel?.facing === 'satin' ? 'satin' : mat;
  if (d.garment === 'jacket' || d.garment === 'waistcoat') {
    // Front facing: from the shoulder 4 cm from the neck down to the hem, 8 cm wide at the hem.
    const [facingPart] = facingSplit(d, front);
    const facing = { ...facingPart, id: 'facing', name: 'facing', material: lapelMat, layer: 'facing', sim: false, cut: { n: 2, mirror: true } };
    facing.marks = facing.marks.filter((m) => m.type !== 'buttonhole' && m.type !== 'button');
    put(d, facing);
    d.info.facing = { width: 8, material: lapelMat };
  } else {
    // Neck and armhole facings of a dress: 5 cm strips following the neckline.
    const back = get(d, 'back');
    for (const p of [front, back]) {
      if (!p) continue;
      const nk = p.edges.find((e) => e.id === 'neck');
      const strip = makePiece({ id: p.id + 'NeckFacing', name: 'neckFacing', material: mat, layer: 'facing', sim: false, cut: p.cut, edges: [{ id: 'neck', pts: nk.pts, sa: 1 }, { id: 'end', pts: [nk.pts[nk.pts.length - 1], [nk.pts[nk.pts.length - 1][0], nk.pts[nk.pts.length - 1][1] + 5]], sa: 1 }, { id: 'inner', pts: nk.pts.map(([x, y]) => [x, y + 5]).reverse(), sa: 1 }, { id: 'start', pts: [[nk.pts[0][0], nk.pts[0][1] + 5], nk.pts[0]], sa: 1 }] });
      put(d, strip);
    }
  }
}

function APPLY_lining(d, c) {
  const mat = c.material === 'satin' ? 'satin' : 'lining';
  const shellIds = d.pieces.filter((p) => p.layer === 'shell' && (p.material === 'shell' || p.material === 'lining') && !p.meta.band && !/pocket|loop|jets|flap|strap/.test(p.id)).map((p) => p.id);
  const map = {};
  for (const id of shellIds) {
    let p = get(d, id);
    if (d.info.facing && id === 'front') {
      // The lining front ends at the facing.
      p = facingSplit(d, p)[1];
    }
    const L = JSON.parse(JSON.stringify(p));
    L.id = id + 'Lining';
    L.name = (p.name || id) + 'Lining';
    L.material = mat;
    L.layer = 'lining';
    L.marks = L.marks.filter((m) => m.type === 'line' && m.role === 'cf');
    // Lining hems sit 2 cm higher: a shorter hem allowance does it in the cut; the 3D layer hangs inside.
    for (const e of L.edges) if (e.kind === 'hem') e.sa = 1;
    L.meta = { ...L.meta, liningOf: id };
    put(d, makePiece(L));
    map[id] = L.id;
  }
  // Lining seams mirror the shell seams between lined pieces.
  for (const s of d.seams.slice()) {
    if (s.kind === 'attach') continue;
    const all = [...s.a, ...s.b];
    if (!all.every(([pid]) => map[pid])) continue;
    const re = (path) => path.map(([pid, base, rev, s0, s1]) => [map[pid], base, rev, s0, s1].filter((v) => v !== undefined));
    d.seams.push({ ...s, id: s.id + 'Lining', a: re(s.a), b: re(s.b) });
  }
  d.info.lined = true;
}

function APPLY_canvas(d) {
  const front = get(d, 'front');
  if (!front) return;
  const I = torso(d);
  const sh = front.edges.find((e) => e.id === 'shoulder');
  const SP = sh.pts[0], SNP = sh.pts[sh.pts.length - 1];
  const y1 = I.yW - 2;
  const pts = [SP, SNP, [I.W - 2, I.yC], [I.W - 3, y1], [I.W - I.wF * 0.75, y1 - 4], [SP[0] + 1, I.yC]];
  put(d, makePiece({ id: 'chestCanvas', name: 'chestCanvas', material: 'canvas', layer: 'canvas', sim: false, cut: { n: 2, mirror: true }, edges: pts.map((p, i) => ({ id: 'e' + i, pts: [p, pts[(i + 1) % pts.length]], sa: 0 })) }));
  d.stiffen.front = (d.stiffen.front || 1) * 2.2;
}

function APPLY_interfacing(d) {
  const ids = ['collar', 'stand', 'cuff', 'waistband', 'facing', 'placket', 'shawlBand'];
  for (const id of ids) {
    const p = get(d, id);
    if (!p) continue;
    const q = JSON.parse(JSON.stringify(p));
    q.id = id + 'Interfacing';
    q.name = (p.name || id) + 'Interfacing';
    q.material = 'interfacing';
    q.layer = 'interfacing';
    q.sim = false;
    q.marks = [];
    for (const e of q.edges) e.sa = 0;
    put(d, makePiece(q));
    d.stiffen[id] = (d.stiffen[id] || 1) * 1.8;
  }
  if (d.garment === 'jacket' || d.garment === 'waistcoat') d.stiffen.front = (d.stiffen.front || 1) * 1.4;
}

function APPLY_pocketing(d) {
  for (const pk of d.pockets || []) {
    if (pk.kind === 'patch' || pk.kind === 'kangaroo') continue;
    const w = pk.w + 3, h = pk.kind === 'sideSeam' ? 32 : pk.h + 4;
    put(d, rect(pk.id + '-bag', w, h * 2, { material: 'pocketing', layer: 'pocketing', cut: { n: 2 }, sim: false, top: 'mouth' }));
  }
}

const APPLY = {
  lapel: APPLY_lapel, collar: APPLY_collar, placket: APPLY_placket, cuffs: APPLY_cuffs, hemBand: APPLY_hemBand, waistband: APPLY_waistband,
  trim: APPLY_trim, vent: APPLY_vent, pleats: APPLY_pleats, drawcord: APPLY_drawcord, zip: APPLY_zip, label: APPLY_label, beltLoops: APPLY_beltLoops,
  pocket: APPLY_pocket, buttons: APPLY_buttons, facing: APPLY_facing, lining: APPLY_lining, canvas: APPLY_canvas, interfacing: APPLY_interfacing,
  pocketing: APPLY_pocketing, gazyri: APPLY_gazyri, quilting: APPLY_quilting,
};

export { curvedBand, rotation, line, addEdgeDart };
