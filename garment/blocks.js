// garment/blocks.js - pattern blocks drafted from body measurements (body/measure.js draftMeasurements): the torso
// (back and front with neck, shoulder, armhole, side seam, waist and hip shaping, a bust dart for women's wovens,
// optional waist darts and a centre back seam), the set-in sleeve whose cap height is solved so that the cap is the
// armhole plus the wanted ease, the two-piece tailored sleeve split from it, the skirt and the trousers. Centimetres,
// y down.
//
// Frames: torso pieces share one frame - x from the centre back (0) round the side to the centre front (W = half the
// garment chest girth), y from the nape line down; the back lies in 0..wB, the front in wB..W (drafted mirrored), so
// back and front meet at the side seam exactly as they are sewn and may be joined or re-split freely. Skirts and
// trousers use the same idea from the waist line. The 3D arrangement (cloth/) reads these frames.
//
//   torsoBlock(m, o) -> { back, front, info }      sleeveBlock(m, o) -> { sleeve, info }
//   twoPieceSleeve(sleeve, info) -> { top, under }  skirtBlock(m, o) -> { back, front, info }
//   trouserBlock(m, o) -> { back, front, info }

import { addEdgeDart, edgeLength, joinPieces, makePiece, splitPiece } from './piece.js';
import { bezier, bezierLength, chain, curve, dist, line, plLength, pointAt, polar, spline } from './geom.js';

//
// Basic blocks (slopers) drafted from measurements: torso, sleeve, skirt, trousers. Every garment starts from these,
// so fit logic (ease, dart suppression, armhole and cap shaping) lives in one place. Several quantities are found by
// solving (bisection) rather than closed formulas, e.g. a sleeve cap height whose curve length equals the armhole
// plus the wanted ease: the constraint is a length, and length is not invertible analytically.
const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Bisection on a monotone function.
// 50 halvings shrink the bracket by 2^-50, beyond double precision for cm-scale values. Assumes f is monotone on
// [lo, hi]; otherwise it converges to some crossing, not necessarily the wanted one.
function solve(f, target, lo, hi, it = 50) {
  let flo = f(lo) - target;
  for (let i = 0; i < it; i++) {
    const mid = (lo + hi) / 2, fm = f(mid) - target;
    if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else hi = mid;
  }
  return (lo + hi) / 2;
}

// Control points down to yEnd: those well above it, then the point of the control polygon at yEnd.
function cutAtY(pts, yEnd) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (b[1] < yEnd - 1) { out.push(b); continue; }
    const t = b[1] === a[1] ? 1 : Math.max(0, Math.min(1, (yEnd - a[1]) / (b[1] - a[1])));
    if (out.length > 1 && yEnd - out[out.length - 1][1] < 1) out.pop();
    out.push([a[0] + (b[0] - a[0]) * t, yEnd]);
    break;
  }
  return out;
}

// Splines may overshoot between close points: keep y increasing and never past the last point.
// Side seams must descend monotonically: a spline overshoot that turns upward would make a seam fold back on itself.
function monotoneY(pts, yEnd) {
  let y = -Infinity;
  const out = pts.map(([px, py]) => { y = Math.min(yEnd, Math.max(y, py)); return [px, y]; });
  out[out.length - 1] = pts[pts.length - 1].slice();
  return out.filter((q, i) => i === 0 || i === out.length - 1 || q[1] > out[i - 1][1] + 1e-6 || Math.abs(q[0] - out[i - 1][0]) > 1e-6);
}

// Side seam shape relative to the underarm point: a straight drop of u, then a smooth curve through the waist, hip and
// hem offsets. `extra` inserts a straight run of that length after the drop (the bust dart of the front).
function sidePath({ u, yW, yHip, yHem, sSide, hipOut, flare = 0 }, extra = 0) {
  const pts = [[0, 0], [0, u]];
  const curvePts = [[0, u]];
  if (yW > u + 1) curvePts.push([-sSide, yW]);
  if (yHem > yW + 2) {
    if (yHem >= yHip) {
      curvePts.push([-sSide + hipOut, yHip]);
      if (yHem > yHip + 1) curvePts.push([-sSide + hipOut + flare, yHem]);
    } else {
      const t = (yHem - yW) / (yHip - yW);
      curvePts.push([-sSide + hipOut * t * (2 - t), yHem]);
    }
  } else if (yHem > u + 1 && yHem < yW - 0.5) {
    curvePts.pop();
    const t = (yHem - u) / (yW - u);
    curvePts.push([-sSide * t * t, yHem]);
  }
  const sp = monotoneY(curvePts.length > 2 ? spline(curvePts, 0.5) : line(curvePts[0], curvePts[curvePts.length - 1]), curvePts[curvePts.length - 1][1]);
  const lower = extra ? sp.map(([x, y]) => [x, y + extra]) : sp;
  return chain(pts, extra ? [[0, u], [0, u + extra]] : [], lower);
}

/**
 * Torso block. o: {
 *   ease: { bust, waist, hip }, length (hem below the waist, cm; negative = above), suppression (0..1 of the waist
 *   shaping actually taken), cbSeam (centre back seam takes part of it), waistDarts (open darts at a waist-length hem),
 *   bustDart (women's side dart, default for wovens), knit, armholeDrop, shoulderExtend (dropped shoulder), shoulderEase,
 *   neckWiden, frontNeckDrop, backNeckDrop, cfExtension (button stand beyond the centre front), flare (hem), sa: { ... } }
 */
export function torsoBlock(m, o = {}) {
  const female = m.sex === 'female';
  const ease = { bust: 8, waist: 8, hip: 6, ...(o.ease || {}) };
  const sa = { neck: 1, shoulder: 1.5, armhole: 1, side: 1.5, hem: 3, cf: 1, cb: 1.5, ...(o.sa || {}) };
  const half = (m.B + ease.bust) / 2;
  const wB = half / 2 + 0.5 + (o.sideForward || 0);
  const wF = half - wB;
  const W = wB + wF;
  const nw = m.neckBase / 6 + 0.4 + (o.neckWiden || 0);
  const ySNP = -1.8;
  const frontNeck = nw + 1.2 + (o.frontNeckDrop || 0);
  const ext = o.shoulderExtend || 0;
  const slope = m.shoulderSlope ?? 20;
  const flat = ext ? Math.min(6, ext) : 0; // dropped shoulders slope less
  const aB = (slope - 2 - flat) * DEG, aF = (slope + 2 - flat) * DEG;
  const SL = m.shoulderLength + ext;
  const shEase = o.knit ? 0 : (o.shoulderEase ?? 0.6);
  const yC = m.scyeDepth + 2.5 + (o.armholeDrop || 0);
  const yW = m.napeToWaist;
  const yHip = yW + m.waistToHip;
  const yHem = yW + (o.length ?? m.waistToHip);
  const dart = female && o.bustDart !== false && !o.knit;
  const intake = dart ? clamp(1.25 * (m.bustProminence || 0), 1, 6) : 0;
  // Waist shaping: S per half; a share is taken at the side seams, the centre back seam and waist darts.
  const S = half - (m.W + ease.waist) / 2;
  const Sx = Math.max(-8, S * (o.suppression ?? 0.5));
  const waistLen = yHem <= yW + 1;
  const sh = { cb: o.cbSeam ? 0.15 : 0, bd: o.waistDarts && waistLen ? 0.25 : 0, fd: o.waistDarts && waistLen ? 0.2 : 0 };
  // The side seams take the rest unless the style moves it to panel seams (o.sideShare).
  const sSide = (Sx * (o.sideShare ?? (1 - sh.cb - sh.bd - sh.fd))) / 2;
  const sCB = Sx * sh.cb, dB = Sx * sh.bd, dF = Sx * sh.fd;
  const halfHip = (m.Hp + ease.hip) / 2;
  const cbHip = sCB * 0.5;
  const hipOut = (halfHip - W + 2 * sSide + cbHip) / 2;
  // Bust point (women) and the straight drop of the side seam above the dart, shared by back and front so that the
  // side seams stay congruent.
  const bpX = (m.bustSpan || 18) / 2;
  // The dart mouth is centred at the level of its apex (equal legs); it needs room below the underarm point.
  const bpY = clamp(ySNP + Math.sqrt(Math.max(1, (m.shoulderToBust || 26) ** 2 - (bpX - nw) ** 2)) - 1.5, yC + intake / 2 + 2.5, yC + 6 + intake / 2);
  const u = dart ? bpY - yC - intake / 2 : 0;
  const sideOpts = { u, yW: yW - yC, yHip: yHip - yC, yHem: yHem - yC, sSide, hipOut, flare: o.flare || 0 };

  // --- back (frame = local) ---
  const CBn = [0, o.backNeckDrop || 0];
  const SNPb = [nw, ySNP];
  const SPb = polar(SNPb, aB, SL + shEase);
  const xAB = Math.min(clamp((m.backWidth || m.B * 0.39) / 2, m.shoulderWidth * 0.4, m.shoulderWidth * 0.5) + 0.6 + ease.bust * 0.04 + ext * 0.5, wB - 1.2);
  const AB = [Math.min(xAB, SPb[0] + 0.5), SPb[1] + (yC - SPb[1]) * 0.45];
  const UAb = [wB, yC];
  const backNeck = bezier(CBn, [nw * 0.55, CBn[1]], [nw * 0.95, ySNP * 0.45 + CBn[1] * 0.55], SNPb);
  const backArm = chain(curve(SPb, [-Math.sin(aB), Math.cos(aB)], AB, [0, 1], 0.35, 0.4), curve(AB, [0, 1], UAb, [1, 0], 0.5, 0.55));
  const sideB = sidePath(sideOpts).map(([x, y]) => [UAb[0] + x, UAb[1] + y]);
  const hemB = sideB[sideB.length - 1];
  const cbPts = o.cbSeam
    ? monotoneY(spline(cutAtY([[CBn[0], CBn[1]], [0, yC * 0.55], [sCB, yW], [cbHip, yHip], [cbHip * 0.8, Math.max(yHem, yHip + 2)]], yHem), 0.5), yHem)
    : line([0, yHem], CBn);
  const cbEdge = o.cbSeam ? cbPts.slice().reverse() : cbPts;
  const cbHem = cbEdge[0];
  let back = makePiece({
    id: 'back', name: 'back', cut: o.cbSeam ? { n: 2, mirror: true } : { n: 1, fold: 'cb' },
    edges: [
      { id: 'neck', pts: backNeck, sa: sa.neck },
      { id: 'shoulder', pts: [SNPb, SPb], sa: sa.shoulder },
      { id: 'armhole', pts: backArm, sa: sa.armhole },
      { id: 'side', pts: sideB, sa: sa.side },
      { id: 'hem', pts: [hemB, cbHem], sa: sa.hem, kind: 'hem' },
      { id: 'cb', pts: cbEdge, sa: o.cbSeam ? sa.cb : 0, kind: o.cbSeam ? 'seam' : 'fold' },
    ],
    grain: [[wB * 0.45, yC * 0.6], [wB * 0.45, yHem - 6]],
    arrange: { mode: 'torso', W, ref: 'cervicale' },
    meta: { block: 'torso', side: 'back' },
  });

  // --- front: drafted in local coordinates (x from the centre front), mapped to the frame by x -> W - x ---
  const F = ([x, y]) => [W - x, y];
  const SNPf = [nw, ySNP];
  const FNP = [0, ySNP + frontNeck];
  const SPf = polar(SNPf, aF, SL);
  const xAF = Math.min(clamp((m.chestWidth || m.B * 0.37) / 2, m.shoulderWidth * 0.36, m.shoulderWidth * 0.47) + 0.4 + ease.bust * 0.03 + ext * 0.5, wF - 1.8);
  const AF = [Math.min(xAF, SPf[0] + 0.3), SPf[1] + (yC - SPf[1]) * 0.55];
  const UAf = [wF, yC];
  const frontArmL = chain(curve(SPf, [-Math.sin(aF), Math.cos(aF)], AF, [0, 1], 0.35, 0.4), curve(AF, [0, 1], UAf, [1, 0], 0.55, 0.5));
  const frontNeckL = curve(FNP, [1, 0], SNPf, [0.35, -1], 0.5, 0.45);
  const sideL = sidePath(sideOpts, intake).map(([x, y]) => [UAf[0] - x, UAf[1] + y]);
  const hemFL = sideL[sideL.length - 1];
  const cfExt = o.cfExtension || 0;
  const cfHemL = [-cfExt, hemFL[1]];
  const frontEdges = [
    { id: 'neck', pts: chain(cfExt ? [[-cfExt, FNP[1]], FNP] : [], frontNeckL).map(F).reverse(), sa: sa.neck },
    { id: 'cf', pts: [[-cfExt, FNP[1]], cfHemL].map(F), sa: cfExt ? sa.cf : 0, kind: cfExt || o.cfSeam ? 'seam' : 'fold' },
    { id: 'hem', pts: [cfHemL, hemFL].map(F), sa: sa.hem, kind: 'hem' },
    { id: 'side', pts: sideL.map(F).reverse(), sa: sa.side },
    { id: 'armhole', pts: frontArmL.map(F).reverse(), sa: sa.armhole },
    { id: 'shoulder', pts: [SPf, SNPf].map(F), sa: sa.shoulder },
  ];
  let front = makePiece({
    id: 'front', name: 'front', cut: cfExt || o.cfSeam ? { n: 2, mirror: true } : { n: 1, fold: 'cf' },
    edges: frontEdges,
    grain: [F([wF * 0.45, yC * 0.6]), F([wF * 0.45, yHem - 6])],
    arrange: { mode: 'torso', W, ref: 'cervicale' },
    marks: [{ type: 'line', id: 'cfLine', pts: [F([0, FNP[1]]), F([0, cfHemL[1]])], role: 'cf' }],
    meta: { block: 'torso', side: 'front', bustPoint: F([bpX, bpY]), intake },
  });
  if (dart) {
    const L = edgeLength(front, 'side');
    front = addEdgeDart(front, 'side', L - (u + intake / 2), intake, F([bpX + 2.5, bpY]), 'bustDart');
  }
  // Open waist darts at a waist-length hem.
  if (dB > 0.3) {
    const x = Math.min(wB * 0.5, xAB * 0.85);
    const L = edgeLength(back, 'hem');
    back = addEdgeDart(back, 'hem', L - x, dB, [x, yC + 2.5], 'waistDart');
  }
  if (dF > 0.3) {
    const x = bpX;
    const L = edgeLength(front, 'hem');
    front = addEdgeDart(front, 'hem', cfExt + x, dF, F([x, bpY + 2]), 'waistDart');
    void L;
  }
  const info = {
    W, wB, wF, yC, yW, yHip, yHem, nw, ySNP, intake, ease, half,
    armholeBack: edgeLength(back, 'armhole'), armholeFront: edgeLength(front, 'armhole'),
    neckBack: edgeLength(back, 'neck'), neckFront: plLength(frontNeckL),
    shoulderBack: dist(SNPb, SPb), shoulderFront: dist(SNPf, SPf), cfExtension: cfExt,
    points: { SNPb, SPb, SNPf: F(SNPf), SPf: F(SPf), FNP: F(FNP), CBn, bustPoint: F([bpX, bpY]) },
  };
  return { back, front, info };
}

// --- sleeves ---------------------------------------------------------------------------------------------------------

/**
 * One-piece set-in sleeve. o: { ahFront, ahBack (armhole lengths), capEase (cm added to the armhole), bicepEase,
 *   length (shoulder point to hem; default arm length), shoulderExtend, cuffDepth, hemWidth, sa }
 * The cap height and the position of its top are solved: front cap = front armhole + its share of the ease, back cap
 * likewise. A bicep too wide for the armhole is narrowed until a cap exists.
 */
export function sleeveBlock(m, o = {}) {
  const sa = { cap: 1, under: 1.5, hem: 3, ...(o.sa || {}) };
  const AHf = o.ahFront, AHb = o.ahBack, AH = AHf + AHb;
  const capEase = o.capEase ?? 2;
  const tf = AHf + (capEase * AHf) / AH, tb = AHb + (capEase * AHb) / AH;
  let bw = m.upperArm + (o.bicepEase ?? 8);
  const L = (o.length ?? m.armLength) - (o.shoulderExtend || 0) - (o.cuffDepth || 0);
  const hemW = Math.min(o.hemWidth ?? (m.wrist + 10), bw);
  const ctlF = (h, tx, half) => [[-half, h], [-half + 0.36 * (tx + half), h], [tx - 0.5 * (tx + half), 0], [tx, 0]];
  const ctlB = (h, tx, half) => [[tx, 0], [tx + 0.5 * (half - tx), 0], [half - 0.3 * (half - tx), h], [half, h]];
  const capF = (h, tx, half) => bezier(...ctlF(h, tx, half), 0.3);
  const capB = (h, tx, half) => bezier(...ctlB(h, tx, half), 0.3);
  const lenF = (h, tx, half) => bezierLength(...ctlF(h, tx, half)), lenB = (h, tx, half) => bezierLength(...ctlB(h, tx, half));
  let h = 0, tx = 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    const half = bw / 2;
    const fitTop = (hh) => solve((x) => lenF(hh, x, half) / Math.max(1e-6, lenB(hh, x, half)), tf / tb, -half * 0.6, half * 0.6, 40);
    const total = (hh) => { const x = fitTop(hh); return lenF(hh, x, half) + lenB(hh, x, half); };
    if (total(0.3) > tf + tb) { bw *= 0.97; continue; }
    h = solve(total, tf + tb, 0.3, 30, 50);
    tx = fitTop(h);
    break;
  }
  const half = bw / 2;
  const Fp = [-half, h], Bp = [half, h], T = [tx, 0];
  const frontHem = [-hemW / 2, h + L], backHem = [hemW / 2, h + L];
  const sleeve = makePiece({
    id: 'sleeve', name: 'sleeve', cut: { n: 2, mirror: true },
    edges: [
      { id: 'capBack', pts: capB(h, tx, half), sa: sa.cap },
      { id: 'underBack', pts: [Bp, backHem], sa: sa.under },
      { id: 'hem', pts: [backHem, frontHem], sa: sa.hem, kind: 'hem' },
      { id: 'underFront', pts: [frontHem, Fp], sa: sa.under },
      { id: 'capFront', pts: capF(h, tx, half), sa: sa.cap },
    ],
    grain: [[tx * 0.5, h + 2], [0, h + L * 0.8]],
    arrange: { mode: 'arm', xTop: tx, width: bw, capHeight: h, length: L },
    marks: [{ type: 'line', id: 'bicep', pts: [Fp, Bp], role: 'bicep' }],
    meta: { block: 'sleeve' },
  });
  return { sleeve, info: { bicep: bw, capHeight: h, top: T, length: L, hemWidth: hemW, capFront: edgeLength(sleeve, 'capFront'), capBack: edgeLength(sleeve, 'capBack'), capEase } };
}

// Distance along an edge where the x coordinate first reaches x (scanning from the start).
function atX(pts, x) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = dist(a, b);
    if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) return s + d * ((x - a[0]) / (b[0] - a[0]));
    s += d;
  }
  return s / 2;
}

// Two-piece tailored sleeve split from a one-piece sleeve: the under sleeve is the two outer strips joined along the
// underarm seam, the top sleeve the middle. Seams: 'frontSeam' and 'backSeam' on both, caps 'capFront' / 'capBack'.
export function twoPieceSleeve(sleeve, info, o = {}) {
  const bw = info.bicep, hw = info.hemWidth;
  const capF = sleeve.edges.find((e) => e.id === 'capFront'), capB = sleeve.edges.find((e) => e.id === 'capBack');
  const hem = sleeve.edges.find((e) => e.id === 'hem');
  const fx = -bw / 2 + bw * (o.front ?? 0.13), bx = bw / 2 - bw * (o.back ?? 0.22);
  const hemFront = hw / 2 - (-hw / 2 + hw * (o.front ?? 0.13)); // distance from the back hem corner
  const hemBack = hw * (o.back ?? 0.22);
  const [rest, frontStrip] = splitPiece(sleeve, {
    from: { edge: 'capFront', at: atX(capF.pts, fx) }, to: { edge: 'hem', at: hw - (hw * (o.front ?? 0.13)) },
    ids: ['frontSeam', 'frontSeam'], pieces: [{ id: 'rest' }, { id: 'frontStrip' }],
  });
  void hemFront;
  const [backStrip, top] = splitPiece(rest, {
    from: { edge: 'capBack', at: atX(capB.pts, bx) }, to: { edge: 'hem', at: hemBack },
    ids: ['backSeam', 'backSeam'], pieces: [{ id: 'backStrip' }, { id: 'topSleeve', name: 'topSleeve' }],
  });
  void hem;
  const under = joinPieces(backStrip, 'underBack', frontStrip, 'underFront', { piece: { id: 'underSleeve', name: 'underSleeve' } });
  return { top, under };
}

// --- skirt -----------------------------------------------------------------------------------------------------------

/**
 * Skirt block from the waist (y = 0): back 0..wB, front wB..W like the torso. o: { ease: { waist, hip }, length (waist
 * to hem), shape: 'straight' | 'pencil' | 'a-line', flare (hem widening at each side seam, cm; overrides the shape's),
 * cbSeam, darts, cfOpen (the front is cut in two halves with a finished front edge: coats open at the centre front),
 * cfExtension (with cfOpen: the overlap beyond the centre front) }.
 */
export function skirtBlock(m, o = {}) {
  const ease = { waist: 1.5, hip: 4, ...(o.ease || {}) };
  const sa = { waist: 1, side: 1.5, hem: 4, cb: 1.5, ...(o.sa || {}) };
  const halfHip = (m.Hp + ease.hip) / 2;
  const wB = halfHip / 2 + 0.5, wF = halfHip - wB, W = halfHip;
  const yHip = m.waistToHip, L = o.length ?? 60;
  const shape = o.shape || 'straight';
  const hemOut = o.flare != null ? o.flare : shape === 'a-line' ? Math.min(12, L * 0.12) : shape === 'pencil' ? -2 : 0;
  const S = halfHip - (m.W + ease.waist) / 2;
  // Side suppression; a dress skirt that must reach a wide bodice waist releases some of it (o.sideRelease).
  const side = S * 0.4 / 2 - (o.sideRelease || 0);
  let dB = o.darts === false ? 0 : S * 0.35, dF = o.darts === false ? 0 : S * 0.25;
  const lift = 1.2;
  // Back (s = 1) and front (s = -1) side seams are mirror images about x = wB: each piece is suppressed at its own side
  // of the seam line and flares outwards at the hem.
  const sidePts = (s) => spline([[wB - s * side, -lift], [wB - s * side * 0.15, yHip * 0.55], [wB, yHip], [wB + s * hemOut, L]], 0.5);
  // Back: CB lowered 1 cm at the waist.
  const sideB = sidePts(1);
  const cbTop = [0, 1], cbHem = [0, L];
  let back = makePiece({
    id: 'skirtBack', name: 'skirtBack', cut: o.cbSeam !== false ? { n: 2, mirror: true } : { n: 1, fold: 'cb' },
    edges: [
      { id: 'waist', pts: curve(cbTop, [1, 0], sideB[0], [1, -0.08], 0.4, 0.4), sa: sa.waist },
      { id: 'side', pts: sideB, sa: sa.side },
      { id: 'hem', pts: [sideB[sideB.length - 1], cbHem], sa: sa.hem, kind: 'hem' },
      { id: 'cb', pts: [cbHem, cbTop], sa: o.cbSeam !== false ? sa.cb : 0, kind: o.cbSeam !== false ? 'seam' : 'fold' },
    ],
    arrange: { mode: 'hip', W, ref: 'waist' },
    meta: { block: 'skirt', side: 'back' },
  });
  const sideF = sidePts(-1).reverse();
  // an open front may overlap: the skirt front continues the bodice's extension beyond the centre front
  const ext = o.cfOpen ? o.cfExtension || 0 : 0;
  const cfTop = [W + ext, 0], cfHem = [W + ext, L];
  let front = makePiece({
    id: 'skirtFront', name: 'skirtFront', cut: o.cfOpen ? { n: 2, mirror: true } : { n: 1, fold: 'cf' },
    edges: [
      { id: 'waist', pts: curve(sideF[sideF.length - 1], [1, 0.08], cfTop, [1, 0], 0.4, 0.4), sa: sa.waist },
      { id: 'cf', pts: [cfTop, cfHem], sa: o.cfOpen ? 1 : 0, kind: o.cfOpen ? 'hem' : 'fold' },
      { id: 'hem', pts: [cfHem, sideF[0]], sa: sa.hem, kind: 'hem' },
      { id: 'side', pts: sideF, sa: sa.side },
    ],
    arrange: { mode: 'hip', W, ref: 'waist' },
    meta: { block: 'skirt', side: 'front' },
  });
  // A dress skirt matches its bodice: the darts take exactly what the waist edges have beyond the bodice's waist.
  if (o.waistTarget) {
    dB = edgeLength(back, 'waist') - o.waistTarget.back; dF = edgeLength(front, 'waist') - o.waistTarget.front;
    // A waist too short for the bodice even without darts: release side suppression (same for back and front, so the
    // side seams stay congruent) and draft again; the darts take the rest.
    const short = 0.6 - Math.min(dB, dF);
    if (short > 0.01 && (o.releaseIter || 0) < 4) return skirtBlock(m, { ...o, sideRelease: (o.sideRelease || 0) + short, releaseIter: (o.releaseIter || 0) + 1 });
  }
  if (dB > 0.3) back = addEdgeDart(back, 'waist', edgeLength(back, 'waist') * 0.45, dB, [wB * 0.45, Math.min(14, yHip - 3)], 'waistDart');
  if (dF > 0.3) front = addEdgeDart(front, 'waist', (edgeLength(front, 'waist') - ext) * 0.62, dF, [W - wF * 0.4, Math.min(9, yHip - 6)], 'waistDart');
  return { back, front, info: { W, wB, wF, yHip, length: L, waistBack: waistLen(back), waistFront: waistLen(front) } };
}

const waistLen = (p) => p.edges.filter((e) => /^waist(\.\d+)?$/.test(e.id)).reduce((s, e) => s + plLength(e.pts), 0);

// --- trousers --------------------------------------------------------------------------------------------------------

/**
 * Trouser block (each leg a front and a back piece, y = 0 at the waist, x = 0 on the crease of the front / back).
 * o: { ease: { waist, hip }, hemWidth (circumference), kneeEase, length (waist to hem at the side), rise (crotch depth
 * ease) }. The back inseam and outseam are walked against the front: the back fork drops and the back side waist rises
 * until both seams have the front's lengths.
 */
export function trouserBlock(m, o = {}) {
  const ease = { waist: 1.5, hip: 6, ...(o.ease || {}) };
  const sa = { waist: 1, side: 1.5, inseam: 1.5, crotch: 1, hem: 4, ...(o.sa || {}) };
  const Hq = (m.Hp + ease.hip) / 4;
  const yHip = m.waistToHip, yCr = m.crotchDepth + (o.rise ?? 1.5);
  const L = o.length ?? (m.outsideLeg - 2);
  const yKnee = yCr + (L - yCr) * 0.45;
  const hemC = o.hemWidth ?? Math.max(m.ankle + 16, 40);
  const kneeC = Math.max(m.knee + (o.kneeEase ?? 14), hemC + 2);
  // Front: CF at the fork side (negative x is the crotch), side seam at the positive side.
  const ff = m.Hp / 16 + 0.5;
  const fw = Hq - 1;
  const xc = (fw - ff) / 2; // crease
  const kf = kneeC / 4 - 1, hf = hemC / 4 - 1;
  const wq = (m.W + ease.waist) / 4 - 1;
  const frontWaistOut = Math.max(0, fw - 1.2 - wq);
  const fCF = [0.6, 0], fHipCF = [0, yHip], fFork = [-ff, yCr];
  const fSideW = [fw - frontWaistOut - 0.6 + 0.6, 0];
  void fSideW;
  const fWaistSide = [0.6 + wq + frontWaistOut, 0];
  const fCrotch = chain(line(fCF, fHipCF), curve(fHipCF, [0, 1], fFork, [-1, 0.05], 0.55, 0.45));
  const fIn = spline([fFork, [xc - kf, yKnee], [xc - hf, L]], 0.5);
  const fOut = spline([[xc + hf, L], [xc + kf, yKnee], [fw + 0.3, yCr], [fw, yHip], fWaistSide], 0.5);
  const front = makePiece({
    id: 'trouserFront', name: 'trouserFront', cut: { n: 2, mirror: true },
    edges: [
      // Clockwise like every draft: waist (CF -> side), side (down), hem, inseam (up to the fork), crotch (to the CF).
      { id: 'waist', pts: [fCF, fWaistSide], sa: sa.waist },
      { id: 'side', pts: fOut.slice().reverse(), sa: sa.side },
      { id: 'hem', pts: [[xc + hf, L], [xc - hf, L]], sa: sa.hem, kind: 'hem' },
      { id: 'inseam', pts: fIn.slice().reverse(), sa: sa.inseam },
      { id: 'crotch', pts: fCrotch.slice().reverse(), sa: sa.crotch },
    ],
    grain: [[xc, yCr + 4], [xc, L - 8]],
    arrange: { mode: 'leg', side: 'front', crease: xc, ref: 'waist', hipW: fw + ff },
    marks: [{ type: 'line', id: 'crease', pts: [[xc, yHip], [xc, L]], role: 'crease' }],
    meta: { block: 'trousers', side: 'front' },
  });
  const lenF = { inseam: edgeLength(front, 'inseam'), side: edgeLength(front, 'side') };
  // Back: wider, CB slanted, deeper fork; drop and lift walked to the front lengths.
  const bw = Hq + 1, bf = m.Hp / 8 + 1;
  const xcb = (bw - bf) / 2 + 1;
  const kb = kneeC / 4 + 1, hb = hemC / 4 + 1;
  const wqb = (m.W + ease.waist) / 4 + 1;
  const dart = Math.max(0, bw - wqb - 1.5);
  const build = (drop, lift) => {
    const bFork = [-bf, yCr + drop];
    const bCBw = [3.5, -2.2], bHipCB = [0.4, yHip];
    const bWaistSide = [bCBw[0] + wqb + dart, -lift];
    const crotch = chain(line(bCBw, bHipCB), curve(bHipCB, [-0.1, 1], bFork, [-1, 0.12], 0.5, 0.5));
    const inseam = spline([bFork, [xcb - kb, yKnee], [xcb - hb, L]], 0.5);
    const side = spline([[xcb + hb, L], [xcb + kb, yKnee], [bw + 0.3, yCr], [bw, yHip], bWaistSide], 0.5);
    return { bFork, bCBw, bWaistSide, crotch, inseam, side };
  };
  const drop = solve((d) => plLength(build(d, 0).inseam), lenF.inseam, -3, 6, 40);
  const lift = solve((l) => plLength(build(drop, l).side), lenF.side, -4, 6, 40);
  const g = build(drop, lift);
  let back = makePiece({
    id: 'trouserBack', name: 'trouserBack', cut: { n: 2, mirror: true },
    edges: [
      { id: 'waist', pts: [g.bCBw, g.bWaistSide], sa: sa.waist },
      { id: 'side', pts: g.side.slice().reverse(), sa: sa.side },
      { id: 'hem', pts: [[xcb + hb, L], [xcb - hb, L]], sa: sa.hem, kind: 'hem' },
      { id: 'inseam', pts: g.inseam.slice().reverse(), sa: sa.inseam },
      { id: 'crotch', pts: g.crotch.slice().reverse(), sa: sa.crotch },
    ],
    grain: [[xcb, yCr + 4], [xcb, L - 8]],
    arrange: { mode: 'leg', side: 'back', crease: xcb, ref: 'waist', hipW: bw + bf },
    marks: [{ type: 'line', id: 'crease', pts: [[xcb, yHip], [xcb, L]], role: 'crease' }],
    meta: { block: 'trousers', side: 'back' },
  });
  if (dart > 0.4) back = addEdgeDart(back, 'waist', dist(g.bCBw, g.bWaistSide) * 0.5, dart, [(g.bCBw[0] + g.bWaistSide[0]) / 2, 12], 'waistDart');
  return { front, back, info: { yHip, yCr, yKnee, length: L, hemWidth: hemC, drop, lift, frontWaist: plLength([fWaistSide, fCF]) } };
}

export { pointAt };
