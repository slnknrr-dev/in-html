// garment/costume.js - national, historical and outerwear templates drafted from the same blocks as the rest of the
// catalogue (garments.js imports them):
//
//   long coats   chokha (Georgian men's coat: fitted bodice with a deep V, a flared skirt open at the centre front,
//                wide sleeves, cartridge pockets - details: gazyri), arkhaluk (the inner coat under the chokha: a stand
//                collar and a row of small buttons to the waist), kartuli (Georgian women's dress: fitted bodice, a V
//                opening, a floor-length flared skirt, long or hanging sleeves), kaftan (Slavic coat with an overlap)
//   Slavic       kosovorotka (men's shirt with the opening to one side of the centre, a stand collar, dropped shoulders),
//                rubakha (women's long shirt), sarafan (strap dress with a flared floor-length skirt)
//   outerwear    bomber, parka, puffer (quilted, with a loft that the pattern makes room for), trucker (denim jacket)
//   accessories  belt (a band round the waist, over everything else)
//
// Every draft keeps the frames and piece ids of the blocks (back / front / sleeve, skirtBack / skirtFront), so the
// details (collars, cuffs, bands, pockets, buttons, linings), the seams checks, grading, flats and the 3D arrangement
// work on them unchanged.

import { edgeChain, edgeLength, makePiece, unfoldPiece } from './piece.js';
import { skirtBlock, sleeveBlock, torsoBlock } from './blocks.js';
import { curve } from './geom.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const get = (d, id) => d.pieces.find((p) => p.id === id) || null;
const put = (d, p) => { const i = d.pieces.findIndex((q) => q.id === p.id); if (i >= 0) d.pieces[i] = p; else d.pieces.push(p); return p; };
const seam = (d, id, a, b, o = {}) => { d.seams = d.seams.filter((s) => s.id !== id); d.seams.push({ id, a, b, ease: 0, kind: 'seam', sides: 'pair', notches: [0.5], ...o }); };
const chainLen = (d, path) => path.reduce((s, [pid, base]) => { const p = get(d, pid); return s + edgeChain(p, base).reduce((t, id) => t + edgeLength(p, id), 0); }, 0);
//
// Traditional and outerwear garments (Georgian chokha/arkhaluk, Slavic shirts and sarafan, coats, belts) and
// imported pieces, drafted with the same blocks and piece operations as garments.js, so they share seam checks,
// nesting, export and grading.
function darts(d) {
  for (const p of d.pieces) for (const e of p.edges) {
    if (e.kind !== 'dart' || !e.id.endsWith('.a')) continue;
    const base = e.id.slice(0, -2);
    seam(d, `${p.id}.${base}`, [[p.id, base + '.a']], [[p.id, base + '.b', true]], { kind: 'dart', notches: [] });
  }
}

// Wearing ease (bust, waist, hip) of these classes by fit.
const EASE = {
  coat: { slim: [7, 6, 6], regular: [10, 9, 8], relaxed: [14, 14, 12], oversized: [20, 20, 18] },
  tunic: { slim: [12, 18, 12], regular: [18, 26, 18], relaxed: [24, 32, 24], oversized: [32, 40, 30] },
  bodice: { slim: [5, 3, 3], regular: [7, 4, 5], relaxed: [10, 8, 8], oversized: [16, 14, 12] },
  outer: { slim: [12, 14, 12], regular: [16, 18, 16], relaxed: [22, 24, 20], oversized: [30, 32, 28] },
};
const easeOf = (cls, fit) => { const e = EASE[cls][fit] || EASE[cls].regular; return { bust: e[0], waist: e[1], hip: e[2] }; };

const FIT = { key: 'fit', type: 'seg', values: ['slim', 'regular', 'relaxed', 'oversized'], def: 'regular' };
const range = (key, min, max, def, unit = 'cm', step = 1) => ({ key, type: 'range', min, max, step, def, unit });
const segOpt = (key, values, def) => ({ key, type: 'seg', values, def: def ?? values[0] });

// V neckline from the side neck point to a point `depth` below the front neck point on the centre front line.
function vNeck(front, depth) {
  const neck = front.edges.find((e) => e.id === 'neck');
  const cf = front.edges.find((e) => e.id === 'cf');
  const a = neck.pts[0], top = cf.pts[0];
  const end = cf.pts[cf.pts.length - 1];
  const v = [top[0], Math.min(top[1] + depth, end[1] - 1)];
  const p = JSON.parse(JSON.stringify(front));
  p.edges = p.edges.map((e) => (e.id === 'neck' ? { ...e, pts: curve(a, [0.3, 1], v, [0.45, 1], 0.35, 0.3) } : e.id === 'cf' ? { ...e, pts: [v, end] } : e));
  return makePiece(p);
}

// A finished front edge (faced, not sewn to anything): the centre front of an open garment.
function openEdge(p) {
  for (const e of p.edges) if (e.id === 'cf') { e.kind = 'hem'; e.sa = Math.max(1, e.sa); }
  return p;
}

// Set-in sleeve of a coat or shirt; returns the sleeve info. o: { length, hemWidth, capEase, bicepEase, turnback }.
function setSleeve(d, m, I, o) {
  const sb = sleeveBlock(m, {
    ahFront: I.armholeFront, ahBack: I.armholeBack, capEase: o.capEase ?? 1.5, bicepEase: o.bicepEase ?? 9, length: o.length,
    shoulderExtend: o.shoulderExtend || 0, hemWidth: o.hemWidth, sa: { cap: 1, under: 1.5, hem: o.turnback ? 1 : 3 },
  });
  const sl = sb.sleeve;
  if (o.turnback) {
    // A turned-back cuff: the hem is cut `turnback` longer and folds back onto the sleeve.
    const hem = sl.edges.find((e) => e.id === 'hem');
    sl.marks.push({ type: 'line', id: 'turnback', pts: hem.pts.map(([x, y]) => [x, y - o.turnback]), role: 'fold' });
  }
  if (o.slit) {
    // Hanging sleeve: the front underarm seam stays open over `slit` cm above the hem (a mark; the seam is shortened).
    sl.meta.slit = o.slit;
  }
  put(d, sl);
  seam(d, 'armhole', [['back', 'armhole'], ['front', 'armhole']], [['sleeve', 'capBack'], ['sleeve', 'capFront']], { ease: sb.info.capFront + sb.info.capBack - I.armholeFront - I.armholeBack, notches: [0.25, 0.5, 0.75] });
  const under = edgeLength(sl, 'underBack');
  seam(d, 'underarm', [['sleeve', 'underBack', false, 0, o.slit ? Math.max(5, under - o.slit) : under]], [['sleeve', 'underFront', true, 0, o.slit ? Math.max(5, under - o.slit) : under]]);
  d.info.sleeve = sb.info;
  return sb.info;
}

// --- long coats: chokha, arkhaluk, kartuli, kaftan -------------------------------------------------------------------

// Defaults per coat: open front, neckline, front overlap (cm beyond the centre front), sleeve extra length and hem.
const COATS = {
  chokha: { open: true, neck: 'v', ext: 0, cls: 'coat', closeAtWaist: true },
  arkhaluk: { open: true, neck: 'crew', ext: 1.5, cls: 'coat' },
  kartuli: { open: false, neck: 'v', ext: 0, cls: 'bodice' },
  kaftan: { open: true, neck: 'crew', ext: 5, cls: 'coat' },
};

export const COAT_GARMENTS = {
  chokha: { group: 'national', cls: 'coat', options: [FIT, range('length', 40, 110, 70), range('flare', 0, 40, 18), range('opening', 14, 40, 30), segOpt('sleeve', ['turnback', 'long', 'hanging']), range('pleats', 0, 8, 4, '')], draft: longCoat },
  arkhaluk: { group: 'national', cls: 'coat', options: [FIT, range('length', 30, 100, 55), range('flare', 0, 30, 8), segOpt('sleeve', ['long', 'turnback'])], draft: longCoat },
  kartuli: { group: 'national', cls: 'dress', options: [FIT, range('length', 50, 120, 95), range('flare', 0, 60, 30), range('opening', 10, 34, 22), segOpt('sleeve', ['hanging', 'long']), { key: 'gulispiri', type: 'toggle', def: true }], draft: longCoat },
  kaftan: { group: 'national', cls: 'coat', options: [FIT, range('length', 30, 110, 60), range('flare', 0, 40, 14), segOpt('sleeve', ['long', 'turnback'])], draft: longCoat },
};

function longCoat(d, m, o, id) {
  const C = COATS[id] || COATS.chokha;
  const tb = torsoBlock(m, {
    ease: easeOf(C.cls, o.fit), length: 0, waistDarts: true, suppression: 0.95, cbSeam: true, armholeDrop: C.cls === 'bodice' ? 1.5 : 2.5,
    shoulderEase: C.cls === 'bodice' ? 0.6 : 1, cfExtension: C.ext, cfSeam: C.open, neckWiden: C.neck === 'v' ? 1.2 : 0.4, frontNeckDrop: C.neck === 'crew' ? 0.3 : 0,
    sa: { neck: 1, shoulder: 1.5, armhole: 1, side: 2, hem: 1, cf: 1, cb: 2 },
  });
  const I = tb.info;
  const back = put(d, tb.back);
  let front = tb.front;
  if (C.neck === 'v') front = vNeck(front, clamp(o.opening ?? 26, 8, I.yW - I.points.FNP[1] - 3));
  if (C.open) front = openEdge(front);
  front = put(d, front);
  d.info.torso = I;
  d.info.openFront = C.open;
  const waistB = chainLen(d, [['back', 'hem']]), waistF = chainLen(d, [['front', 'hem']]);
  const sk = skirtBlock(m, { length: o.length, shape: 'a-line', flare: o.flare ?? 12, cbSeam: true, cfOpen: C.open, cfExtension: C.ext, ease: { hip: C.cls === 'bodice' ? 4 : 8 }, waistTarget: { back: waistB, front: waistF } });
  let skBack = sk.back;
  const pleats = id === 'chokha' ? Math.round(o.pleats ?? 4) : 0;
  let pleatIntake = 0;
  if (pleats > 0) {
    // deep pleats at the back waist of a chokha: every pleat takes 2 x 3 cm, half of them on each back half
    pleatIntake = pleats * 3;
    skBack = widenAtCB(skBack, pleatIntake, sk.info.wB);
    for (let k = 0; k < pleats; k++) {
      const x = -pleatIntake + (k + 0.5) * (pleatIntake / pleats) * 1.6;
      skBack.marks.push({ type: 'line', id: 'pleat' + k, pts: [[x, 1], [x, Math.min(25, (o.length || 60) * 0.35)]], role: 'pleat' });
    }
    skBack.meta.pleats = pleats;
  }
  put(d, skBack);
  put(d, C.open ? openEdge(sk.front) : sk.front);
  d.info.skirt = { ...sk.info, pleats, pleatIntake };
  seam(d, 'shoulder', [['back', 'shoulder']], [['front', 'shoulder', true]], { ease: edgeLength(front, 'shoulder') - edgeLength(back, 'shoulder') });
  seam(d, 'side', [['back', 'side']], [['front', 'side', true]]);
  seam(d, 'cb', [['back', 'cb']], [['back', 'cb']], { sides: 'center' });
  seam(d, 'skirtCb', [['skirtBack', 'cb']], [['skirtBack', 'cb']], { sides: 'center' });
  seam(d, 'skirtSide', [['skirtBack', 'side']], [['skirtFront', 'side', true]]);
  seam(d, 'waistBack', [['back', 'hem']], [['skirtBack', 'waist', true]], { ease: pleatIntake ? chainLen(d, [['skirtBack', 'waist']]) - waistB : 0 });
  seam(d, 'waistFront', [['front', 'hem']], [['skirtFront', 'waist', true]]);
  darts(d);
  const sleeve = o.sleeve || 'long';
  const hanging = sleeve === 'hanging';
  setSleeve(d, m, I, {
    length: m.armLength + (sleeve === 'turnback' ? 8 : hanging ? 14 : 2), hemWidth: hanging ? m.upperArm + 22 : id === 'chokha' ? m.upperArm + 8 : id === 'arkhaluk' ? m.wrist + 7 : m.wrist + 12,
    capEase: C.cls === 'bodice' ? 1.2 : 2, bicepEase: id === 'chokha' ? 12 : id === 'arkhaluk' ? 7 : 9, turnback: sleeve === 'turnback' ? 9 : 0,
    // hanging sleeves open over 30 cm; a chokha's turned-back sleeve has a 10 cm slit at the cuff
    slit: hanging ? 30 : id === 'chokha' && sleeve === 'turnback' ? 10 : 0,
  });
  // Closures: the chokha hooks at the waist only (the V shows the arkhaluk); the others button down the bodice.
  const FNP = I.points.FNP;
  if (C.closeAtWaist) {
    for (const y of [I.yW - 6, I.yW - 1.5]) d.closures.push({ piece: 'front', p: [I.W, y] });
    // the skirt fronts hang from the hooks: held together just below the waist
    d.closures.push({ piece: 'skirtFront', p: [sk.info.W, 2] });
    front.marks.push({ type: 'line', id: 'hooks', pts: [[I.W - 0.5, I.yW - 7], [I.W - 0.5, I.yW - 0.5]], role: 'closure' });
  }
  if (id === 'kartuli' && o.gulispiri !== false) gulispiri(d, I, front);
  d.info.buttonLine = { x: I.W, y0: FNP[1] + 1.5, y1: I.yW - 1 };
  d.info.coat = { id, open: C.open, neck: C.neck };
}

// The skirt back widened at its centre back by w cm (pleats), fading to nothing a third of the way to the side.
function widenAtCB(p, w, wB) {
  const q = JSON.parse(JSON.stringify(p));
  const reach = wB * 0.22;
  for (const e of q.edges) {
    for (const pt of e.pts) {
      if (e.id === 'cb') pt[0] -= w;
      else if (pt[0] < reach) pt[0] -= w * (1 - pt[0] / reach);
    }
  }
  return makePiece(q);
}

// Gulispiri: the embroidered bib of a kartuli dress, filling its V opening from the neck down below the V point.
function gulispiri(d, I, front) {
  const neck = front.edges.find((e) => e.id === 'neck');
  const cf = front.edges.find((e) => e.id === 'cf');
  if (!neck || !cf) return;
  const top = neck.pts[0][1], v = cf.pts[0][1];
  const half = Math.max(4, (I.W - neck.pts[0][0]) * 0.95);
  const W = I.W;
  const pts = [[W - half, top + 1], [W + half, top + 1], [W + 4, v + 3], [W - 4, v + 3]];
  const piece = makePiece({
    id: 'gulispiri', name: 'gulispiri', material: 'contrast', layer: 'trim', cut: { n: 1 }, sim: false,
    edges: pts.map((p, i) => ({ id: 'e' + (i + 1), pts: [p, pts[(i + 1) % 4]], sa: 1 })),
  });
  put(d, piece);
  d.overlays = d.overlays.filter((x) => x.id !== 'gulispiri');
  d.overlays.push({ id: 'gulispiri', piece: { ...piece, layer: 'trim', material: 'contrast' }, on: 'front', lift: 0.15, attach: ['e1', 'e2', 'e4'], layer: 'trim', material: 'contrast', side: 'both' });
  d.info.gulispiri = { top, v, half };
}

// --- Slavic: kosovorotka, rubakha, sarafan ---------------------------------------------------------------------------

export const SLAVIC_GARMENTS = {
  kosovorotka: { group: 'national', cls: 'shirt', options: [FIT, range('length', 10, 50, 26), segOpt('placket', ['side', 'center']), { key: 'embroidery', type: 'toggle', def: true }], draft: slavicShirt },
  rubakha: { group: 'national', cls: 'shirt', options: [FIT, range('length', 40, 120, 100), segOpt('placket', ['center', 'side']), { key: 'embroidery', type: 'toggle', def: true }], draft: slavicShirt },
  sarafan: { group: 'national', cls: 'dress', options: [FIT, segOpt('cut', ['gored', 'gathered']), range('length', 50, 120, 98), range('flare', 0, 60, 34), range('gather', 1.2, 2.5, 1.7, '×', 0.1), { key: 'embroidery', type: 'toggle', def: true }], draft: sarafan },
};

// A strip lying on a piece along one of its edges (embroidered bands, trims): overlay + its cut piece.
function bandOverlay(d, host, edgeId, id, w, material = 'contrast') {
  const p = get(d, host);
  const e = p && p.edges.find((x) => x.id === edgeId);
  if (!e) return;
  const pts = e.pts;
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y = Math.max(...ys);
  const L = Math.max(2, x1 - x0);
  const strip = makePiece({
    id, name: 'embroidery', material, layer: 'trim', cut: { n: 1 }, sim: false,
    edges: [{ id: 'top', pts: [[0, 0], [L, 0]], sa: 1 }, { id: 'right', pts: [[L, 0], [L, w]], sa: 1 }, { id: 'bottom', pts: [[L, w], [0, w]], sa: 1 }, { id: 'left', pts: [[0, w], [0, 0]], sa: 1 }],
  });
  put(d, strip);
  const placed = makePiece({ ...strip, edges: strip.edges.map((q) => ({ ...q, pts: q.pts.map(([a, b]) => [x0 + a, y - w - 0.5 + b]) })) });
  d.overlays = d.overlays.filter((x) => x.id !== id);
  d.overlays.push({ id, piece: { ...placed, id, layer: 'trim', material }, on: host, lift: 0.2, attach: ['top', 'right', 'bottom', 'left'], layer: 'trim', material, side: 'both' });
}

function slavicShirt(d, m, o, id) {
  const female = id === 'rubakha';
  const tb = torsoBlock(m, {
    ease: easeOf('tunic', o.fit), length: o.length, suppression: 0, armholeDrop: 3, shoulderExtend: 3, neckWiden: 0.4, frontNeckDrop: 0.4,
    bustDart: false, sa: { neck: 1, shoulder: 1, armhole: 1, side: 1.5, hem: 2, cf: 1 },
  });
  const I = tb.info;
  const back = put(d, tb.back), front = put(d, tb.front);
  d.info.torso = I;
  seam(d, 'shoulder', [['back', 'shoulder']], [['front', 'shoulder', true]], { ease: edgeLength(front, 'shoulder') - edgeLength(back, 'shoulder') });
  seam(d, 'side', [['back', 'side']], [['front', 'side', true]]);
  setSleeve(d, m, I, { length: m.armLength + 3, hemWidth: m.wrist + 16, capEase: 0.5, bicepEase: 14, shoulderExtend: 3 });
  // The neck opening: a slit with three small buttons, to the wearer's left of the centre (kosovorotka) or at the centre.
  const FNP = I.points.FNP;
  const side = o.placket === 'side';
  const x = I.W - (side ? Math.min(6, I.nw * 0.8) : 0);
  const y0 = FNP[1] + (side ? -0.8 : 0), y1 = FNP[1] + 15;
  front.marks.push({ type: 'line', id: 'slit', pts: [[x, y0], [x, y1]], role: 'opening' });
  for (let k = 0; k < 3; k++) {
    const y = y0 + 2.5 + k * 4.5;
    d.buttons.push({ piece: 'front', p: [x, y], d: 1.1, side: 'L' });
    front.marks.push({ type: 'button', id: 'sb' + k, p: [x, y], d: 1.1, side: 'L' });
    front.marks.push({ type: 'buttonhole', id: 'sbh' + k, p: [x + 0.4, y], w: 1.4, side: 'L' });
  }
  d.info.placket = { side, x };
  // the traditional cut's small pieces: square gussets under the arms, poliki (shoulder pieces) over the shoulders
  const gs = Math.round(Math.max(7, Math.min(12, m.upperArm * 0.32)));
  put(d, makePiece({ id: 'gusset', name: 'gusset', material: 'shell', cut: { n: 2 }, sim: false, edges: [{ id: 'e1', pts: [[0, 0], [gs, 0]], sa: 1 }, { id: 'e2', pts: [[gs, 0], [gs, gs]], sa: 1 }, { id: 'e3', pts: [[gs, gs], [0, gs]], sa: 1 }, { id: 'e4', pts: [[0, gs], [0, 0]], sa: 1 }] }));
  const sl = edgeLength(front, 'shoulder');
  put(d, makePiece({ id: 'polik', name: 'polik', material: 'contrast', cut: { n: 2 }, sim: false, edges: [{ id: 'e1', pts: [[0, 0], [sl, 0]], sa: 1 }, { id: 'e2', pts: [[sl, 0], [sl, 9]], sa: 1 }, { id: 'e3', pts: [[sl, 9], [0, 9]], sa: 1 }, { id: 'e4', pts: [[0, 9], [0, 0]], sa: 1 }] }));
  for (const pc of [front, back]) {
    const sh = pc.edges.find((e) => e.id === 'shoulder');
    if (sh) pc.marks.push({ type: 'line', id: 'polik', pts: sh.pts.map(([a, b]) => [a, b + 4.5]), role: 'trim' });
  }
  d.info.gussets = gs;
  if (o.embroidery !== false) {
    bandOverlay(d, 'front', 'hem', 'embroideryFront', female ? 8 : 5);
    bandOverlay(d, 'back', 'hem', 'embroideryBack', female ? 8 : 5);
    bandOverlay(d, 'sleeve', 'hem', 'embroiderySleeve', 4);
  }
}

function sarafan(d, m, o) {
  const tb = torsoBlock(m, {
    ease: easeOf('bodice', o.fit), length: 0, waistDarts: true, suppression: 1, cbSeam: true, armholeDrop: 4, shoulderExtend: -Math.max(2, m.shoulderLength - 4),
    neckWiden: 3.5, frontNeckDrop: 9, backNeckDrop: 5, sa: { neck: 1, shoulder: 1, armhole: 1, side: 1.5, hem: 1, cb: 1.5 },
  });
  const I = tb.info;
  const back = put(d, tb.back), front = put(d, tb.front);
  d.info.torso = I;
  const waistB = chainLen(d, [['back', 'hem']]), waistF = chainLen(d, [['front', 'hem']]);
  const gathered = o.cut === 'gathered';
  let sk;
  if (gathered) {
    // straight panels, gather times the hip wide, gathered into the bodice waist
    const g = clamp(o.gather ?? 1.7, 1.2, 2.5);
    const base = skirtBlock(m, { length: o.length, shape: 'straight', flare: 0, cbSeam: true, darts: false, ease: { hip: 6 } });
    const scale = (p) => { const q = JSON.parse(JSON.stringify(p)); for (const e of q.edges) for (const pt of e.pts) pt[0] *= g; if (q.arrange) q.arrange.W *= g; return makePiece(q); };
    sk = { back: scale(base.back), front: scale(base.front), info: { ...base.info, W: base.info.W * g, wB: base.info.wB * g, wF: base.info.wF * g, gather: g } };
  } else sk = skirtBlock(m, { length: o.length, shape: 'a-line', flare: o.flare ?? 30, cbSeam: true, ease: { hip: 10 }, waistTarget: { back: waistB, front: waistF } });
  put(d, sk.back);
  put(d, sk.front);
  d.info.skirt = sk.info;
  seam(d, 'shoulder', [['back', 'shoulder']], [['front', 'shoulder', true]], { ease: edgeLength(front, 'shoulder') - edgeLength(back, 'shoulder') });
  seam(d, 'side', [['back', 'side']], [['front', 'side', true]]);
  seam(d, 'cb', [['back', 'cb']], [['back', 'cb']], { sides: 'center' });
  seam(d, 'skirtCb', [['skirtBack', 'cb']], [['skirtBack', 'cb']], { sides: 'center' });
  seam(d, 'skirtSide', [['skirtBack', 'side']], [['skirtFront', 'side', true]]);
  seam(d, 'waistBack', [['back', 'hem']], [['skirtBack', 'waist', true]], { ease: gathered ? chainLen(d, [['skirtBack', 'waist']]) - waistB : 0 });
  seam(d, 'waistFront', [['front', 'hem']], [['skirtFront', 'waist', true]], { ease: gathered ? chainLen(d, [['skirtFront', 'waist']]) - waistF : 0 });
  darts(d);
  if (o.embroidery !== false) {
    bandOverlay(d, 'skirtFront', 'hem', 'embroideryHemFront', 9);
    bandOverlay(d, 'skirtBack', 'hem', 'embroideryHemBack', 9);
  }
  // The decorative buttons down the centre front of the bodice.
  for (let k = 0; k < 4; k++) {
    const y = I.points.FNP[1] + 3 + k * ((I.yW - I.points.FNP[1] - 4) / 3);
    d.buttons.push({ piece: 'front', p: [I.W, y], d: 1.4, side: 'both' });
    front.marks.push({ type: 'button', id: 'db' + k, p: [I.W, y], d: 1.4, side: 'both' });
  }
}

// --- outerwear: bomber, parka, puffer, trucker -----------------------------------------------------------------------

const OUTER = {
  bomber: { length: 2, flare: 0, cfExt: 0, sleeveHem: 10 },
  parka: { length: 34, flare: 3, cfExt: 0, sleeveHem: 14 },
  puffer: { length: 12, flare: 1, cfExt: 0, sleeveHem: 12 },
  trucker: { length: 4, flare: 0, cfExt: 1.8, sleeveHem: 10 },
};

export const OUTER_GARMENTS = {
  bomber: { group: 'outerwear', cls: 'outer', options: [FIT, range('length', -6, 20, OUTER.bomber.length)], draft: outerJacket },
  parka: { group: 'outerwear', cls: 'outer', options: [FIT, range('length', 10, 60, OUTER.parka.length), range('loft', 0, 2, 0.6, 'cm', 0.1)], draft: outerJacket },
  puffer: { group: 'outerwear', cls: 'outer', options: [FIT, range('length', -2, 50, OUTER.puffer.length), range('loft', 0.5, 4, 2, 'cm', 0.1)], draft: outerJacket },
  trucker: { group: 'outerwear', cls: 'outer', options: [FIT, range('length', -6, 16, OUTER.trucker.length)], draft: outerJacket },
};

function outerJacket(d, m, o, id) {
  const C = OUTER[id] || OUTER.bomber;
  const loft = o.loft || 0;
  // Insulation: the inside of the shell moves out by the loft, so every girth gets 2 pi loft (half of it compressed).
  const ease = easeOf('outer', o.fit);
  const room = Math.PI * loft;
  ease.bust += room; ease.waist += room; ease.hip += room;
  const tb = torsoBlock(m, {
    ease, length: o.length ?? C.length, suppression: o.fit === 'slim' ? 0.3 : 0.1, armholeDrop: 3 + loft * 0.6, shoulderExtend: 1.5 + loft * 0.4, shoulderEase: 0.6,
    cfExtension: C.cfExt, cfSeam: true, neckWiden: 0.8 + loft * 0.2, frontNeckDrop: 0.4, bustDart: false, flare: C.flare,
    sa: { neck: 1, shoulder: 1.5, armhole: 1.2, side: 1.5, hem: id === 'bomber' || id === 'trucker' ? 1 : 3, cf: 1.5 },
  });
  const I = tb.info;
  const back = put(d, tb.back);
  const front = put(d, C.cfExt ? tb.front : openEdge(tb.front));
  d.info.torso = I;
  d.info.openFront = true;
  d.info.loft = loft;
  seam(d, 'shoulder', [['back', 'shoulder']], [['front', 'shoulder', true]], { ease: edgeLength(front, 'shoulder') - edgeLength(back, 'shoulder') });
  seam(d, 'side', [['back', 'side']], [['front', 'side', true]]);
  setSleeve(d, m, I, { length: m.armLength + 2 + loft, hemWidth: m.wrist + C.sleeveHem + loft * 4, capEase: 1, bicepEase: 12 + loft * 4, shoulderExtend: 1.5 + loft * 0.4 });
  if (!C.cfExt) {
    // A zip from the hem to the neck: the fronts are pinned edge to edge.
    const hemY = I.yHem;
    for (let y = I.points.FNP[1] + 3; y < hemY - 2; y += 9) d.closures.push({ piece: 'front', p: [I.W, y] });
    front.marks.push({ type: 'line', id: 'zip', pts: [[I.W - 0.3, I.points.FNP[1]], [I.W - 0.3, hemY]], role: 'zip' });
  }
  d.info.buttonLine = { x: I.W, y0: I.points.FNP[1] + 2, y1: I.yHem - 4 };
  d.printAreas.back = { piece: 'back', center: [0, 8 + 20], w: Math.min(30, I.wB * 1.6), h: 36 };
}

// --- belt ------------------------------------------------------------------------------------------------------------

export const ACCESSORY_GARMENTS = {
  belt: { group: 'national', cls: 'dress', options: [range('width', 2, 14, 4), range('ease', 0, 30, 12)], draft: belt },
};

// A band round the waist, worn over everything: half its girth from the centre front (fold) to the centre back.
function belt(d, m, o) {
  const w = o.width || 4;
  const girth = m.waist + (o.ease ?? 12);
  const half = girth / 2;
  const p = makePiece({
    id: 'belt', name: 'belt', material: 'shell', layer: 'band', cut: { n: 1, fold: 'cf' },
    edges: [
      { id: 'top', pts: [[0, 0], [half, 0]], sa: 1 },
      { id: 'end', pts: [[half, 0], [half, w]], sa: 1 },
      { id: 'bottom', pts: [[half, w], [0, w]], sa: 1 },
      { id: 'cf', pts: [[0, w], [0, 0]], sa: 0, kind: 'fold' },
    ],
    grain: [[half * 0.2, w / 2], [half * 0.8, w / 2]],
    arrange: { mode: 'band', ref: 'waist', girth, from: 90, span: 180, centerY: w / 2, dy: 0 },
    meta: { band: true },
  });
  put(d, p);
  seam(d, 'beltCb', [['belt', 'end']], [['belt', 'end']], { sides: 'center' });
  d.stiffen.belt = 3;
  d.info.belt = { w, girth };
}

// Every template of this file, merged into GARMENTS by garments.js.
export const COSTUME_GARMENTS = { ...COAT_GARMENTS, ...SLAVIC_GARMENTS, ...OUTER_GARMENTS, ...ACCESSORY_GARMENTS, imported: { group: 'custom', cls: 'dress', options: [], draft: (...a) => imported(...a) } };


// --- imported patterns -----------------------------------------------------------------------------------------------

// A pattern read from a file (garment/dxf.js readPatternDXF): spec.imported = { name, pieces: [{ name, cut, sew, grain,
// n, material }] }. The sewing line is the piece (the cutting line gives the allowance); without it the cutting line is
// the piece with no allowance. Edges split at corners. These pieces are 2D only: layouts, usage, prints, PDF / SVG /
// DXF, 2D edits; the 3D view does not know where on the body they go.
// Places on the body of imported pieces (the 3D view wraps them there), guessed from the piece names in several
// languages; 'none' leaves a piece flat (2D only).
// Imported (DXF) pieces carry no semantics; a place on the body is guessed from the piece name so the 3D view can
// position them, and the user can correct it.
export const PLACES = ['none', 'torsoFront', 'torsoBack', 'torsoSide', 'sleeve', 'collar', 'skirtFront', 'skirtBack', 'legFront', 'legBack'];
export function guessPlace(name) {
  const s = String(name || '').toLowerCase();
  if (/sleeve|рукав|ärmel|manche|manga|სახელო/.test(s)) return 'sleeve';
  if (/collar|stand|ворот|стойк|kragen|col\b|cuello/.test(s)) return 'collar';
  if (/(skirt|юбк|rock|jupe|falda).*(back|зад|спин|rück|dos|espalda)|(back|зад).*(skirt|юбк)/.test(s)) return 'skirtBack';
  if (/skirt|юбк|rock|jupe|falda/.test(s)) return 'skirtFront';
  if (/(trouser|pant|брюк|штан|hose|pantalon).*(back|зад|rück|dos|trasero)|trouserback/.test(s)) return 'legBack';
  if (/trouser|pant|брюк|штан|hose|pantalon/.test(s)) return 'legFront';
  if (/side ?panel|sidepanel|бочок|бок|seiten/.test(s)) return 'torsoSide';
  if (/back|спин|зад|rück|dos|espalda|yoke|кокет/.test(s)) return 'torsoBack';
  if (/front|перед|полоч|vorder|devant|delant/.test(s)) return 'torsoFront';
  return 'none';
}

function corners(pts) {
  const n = pts.length, out = [0];
  for (let i = 1; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
    const u = [b[0] - a[0], b[1] - a[1]], v = [c[0] - b[0], c[1] - b[1]];
    const lu = Math.hypot(...u) || 1, lv = Math.hypot(...v) || 1;
    const cos = (u[0] * v[0] + u[1] * v[1]) / (lu * lv);
    if (cos < Math.cos((28 * Math.PI) / 180)) out.push(i);
  }
  return out;
}

// Imported outlines are taken as given (no re-drafting for the body): grading and fit adjustments do not apply.
function imported(d, m, o, id, spec) {
  const src = spec?.imported?.pieces || [];
  const used = new Set();
  src.forEach((p, k) => {
    let pts = (p.sew && p.sew.length >= 3 ? p.sew : p.cut).map((q) => q.slice());
    if (pts.length < 3) return;
    if (Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6) pts = pts.slice(0, -1);
    // clockwise on paper (y down)
    let a = 0;
    for (let i = 0; i < pts.length; i++) { const P = pts[i], Q = pts[(i + 1) % pts.length]; a += P[0] * Q[1] - Q[0] * P[1]; }
    if (a < 0) pts.reverse();
    const sa = p.sew && p.cut ? Math.max(0, Math.min(3, Math.round(allowance(p.cut, p.sew) * 10) / 10)) : 0;
    const cs = corners(pts);
    const edges = cs.map((c0, j) => {
      const c1 = cs[(j + 1) % cs.length];
      const seg = [];
      for (let i = c0; ; i = (i + 1) % pts.length) { seg.push(pts[i]); if (i === c1 && seg.length > 1) break; if (seg.length > pts.length + 1) break; }
      return { id: 'e' + (j + 1), pts: seg, sa };
    }).filter((e) => e.pts.length >= 2);
    let pid = String(p.name || 'piece').replace(/[^\w-]/g, '_').slice(0, 30) || 'piece';
    while (used.has(pid)) pid += '_' + (k + 1);
    used.add(pid);
    const place = PLACES.includes(p.place) ? p.place : guessPlace(p.name);
    // a piece cut on the fold: its longest straight edge is the fold
    let foldId = null;
    if (p.fold) {
      let best = 0;
      for (const e of edges) if (e.pts.length === 2) { const L = Math.hypot(e.pts[1][0] - e.pts[0][0], e.pts[1][1] - e.pts[0][1]); if (L > best) { best = L; foldId = e.id; } }
      for (const e of edges) if (e.id === foldId) { e.kind = 'fold'; e.sa = 0; }
    }
    // the bottom edge of a placed piece is its hem (patterns from files do not say which edges are hems)
    if (place !== 'none' && place !== 'collar') {
      const yMax = Math.max(...pts.map((q) => q[1]));
      for (const e of edges) {
        if (e.kind === 'fold') continue;
        const a = e.pts[0], b = e.pts[e.pts.length - 1];
        if (Math.abs(a[1] - yMax) < 1.5 && Math.abs(b[1] - yMax) < 1.5 && Math.abs(b[0] - a[0]) > 3) e.kind = 'hem';
      }
    }
    const pair = !foldId && (p.n || 1) >= 2;
    let piece = makePiece({
      id: pid, name: p.name || pid, material: p.material || 'shell', cut: foldId ? { n: 1, fold: foldId } : pair ? { n: p.n, mirror: true } : { n: p.n || 1 }, edges, grain: p.grain || null,
      sim: place !== 'none', meta: { imported: true, place },
    });
    const opened = foldId ? unfoldPiece(piece) : piece;
    const all = opened.edges.flatMap((e) => e.pts);
    const box = [Math.min(...all.map((q) => q[0])), Math.min(...all.map((q) => q[1])), Math.max(...all.map((q) => q[0])), Math.max(...all.map((q) => q[1]))];
    piece = { ...piece, arrange: place !== 'none' ? { mode: 'wrap', place, box, pair, flip: !!p.flip, drop: p.drop ?? null } : null };
    put(d, piece);
  });
  // A yoke sits at the top of its place: the other pieces there start below it (unless a drop is set by hand).
  for (const y of d.pieces.filter((q) => q.arrange && /yoke|кокет/i.test(q.name))) {
    const hY = y.arrange.box[3] - y.arrange.box[1];
    for (const q of d.pieces) if (q !== y && q.arrange && q.arrange.place === y.arrange.place && q.arrange.drop == null) q.arrange.drop = Math.min(hY, 15);
  }
  d.info.imported = { name: spec?.imported?.name || '', pieces: d.pieces.length };
  d.info.autoSew = true;
}

// Mean distance between the cutting and the sewing line (the seam allowance of an imported piece).
function allowance(cut, sew) {
  let s = 0, n = 0;
  for (let i = 0; i < sew.length; i += Math.max(1, Math.floor(sew.length / 24))) {
    let best = Infinity;
    for (const q of cut) best = Math.min(best, Math.hypot(q[0] - sew[i][0], q[1] - sew[i][1]));
    s += best; n++;
  }
  return n ? s / n : 0;
}
