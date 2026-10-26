// templates-dance.js - template "dance": Georgian folk dance ensemble and portfolio (ka, en, ru).
//
// Contract of a template module: each exported template object carries an id, localized names and build(V, ...) ->
// a fresh document; templates.js adds catalogue metadata (group, mode, modules) where the module does not declare it,
// and studio/gallery.js shows the catalogue.
// The viewer API arrives as the argument V instead of an import, so templates are pure document builders that tests
// (test.js renders every template) and the gallery can run without the editor. Generated artwork and sample data are
// derived from seeds (tplHash / tplRand where used), so a template builds the same document on every run.
// Data file: names, texts, figures and art specs dominate; comments mark sections, not individual values.
import { tplHash, tplRand } from '../sample/bytes.js';
import { b64encode } from '../codec/base64.js';
import { tplKit } from './templates-kit.js';
// ===== Template: dance — Georgian folk dance ensemble "Napertskali" (ნაპერწკალი, "the spark"); ka · en · ru =====
// Portfolio of choreographies set to music by the ensemble's artistic director. Theme preset: supra.
// Everything here is FICTIONAL: the ensemble, people, venues, outlets, awards, addresses, phone numbers (all zeros)
// and e-mails (.example). Artwork is procedural SVG (deterministic), music sketches are synthesized WAV files.

// ===== SVG helpers =====

/** Compact number for SVG markup (one decimal). */
function tplDanceF(v) { return String(Math.round(v * 10) / 10); }
/** Two decimals (scales). */
function tplDanceF2(v) { return String(Math.round(v * 100) / 100); }

function tplDanceSvg(w, h, body) {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '">' + body + '</svg>';
}

function tplDanceStops(stops) {
  return stops.map((s) => '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"' +
    (s[2] != null && s[2] !== 1 ? ' stop-opacity="' + s[2] + '"' : '') + '/>').join('');
}

/** Linear gradient (vertical by default). */
function tplDanceLin(id, stops, x2 = 0, y2 = 1, extra = '') {
  return '<linearGradient id="' + id + '" x1="0" y1="0" x2="' + x2 + '" y2="' + y2 + '"' + extra + '>' + tplDanceStops(stops) + '</linearGradient>';
}

function tplDanceRad(id, stops, cx = 0.5, cy = 0.5, r = 0.5) {
  return '<radialGradient id="' + id + '" cx="' + cx + '" cy="' + cy + '" r="' + r + '">' + tplDanceStops(stops) + '</radialGradient>';
}

/** Borjgali-like whirl: n flame-shaped arms turning clockwise around a hub. Returns path data. */
function tplDanceWhirl(cx, cy, R, n = 7, rot = 0) {
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = rot + (i * 2 * Math.PI) / n, c = Math.cos(a), s = Math.sin(a);
    const P = (x, y) => tplDanceF(cx + (x * c - y * s) * R) + ' ' + tplDanceF(cy + (x * s + y * c) * R);
    d += 'M' + P(0, -0.15) + 'C' + P(0.36, -0.3) + ' ' + P(0.5, -0.76) + ' ' + P(0.12, -1) +
      'C' + P(0.16, -0.74) + ' ' + P(0, -0.5) + ' ' + P(-0.16, -0.32) + 'Z';
  }
  return d;
}

/** n-pointed star polygon (path data). */
function tplDanceStar(cx, cy, r, n = 8, k = 0.45, rot = 0) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i * Math.PI) / n - Math.PI / 2, rr = i % 2 ? r * k : r;
    pts.push(tplDanceF(cx + Math.cos(a) * rr) + ' ' + tplDanceF(cy + Math.sin(a) * rr));
  }
  return 'M' + pts.join('L') + 'Z';
}

/** Ornamental medallion: rings, an 8-point star and a whirl in the centre. */
function tplDanceRosette(cx, cy, r, color, op = 1, sw = 1.5) {
  return '<g fill="none" stroke="' + color + '" stroke-width="' + sw + '" opacity="' + op + '">' +
    '<circle cx="' + tplDanceF(cx) + '" cy="' + tplDanceF(cy) + '" r="' + tplDanceF(r) + '"/>' +
    '<circle cx="' + tplDanceF(cx) + '" cy="' + tplDanceF(cy) + '" r="' + tplDanceF(r * 0.9) + '" stroke-dasharray="' + tplDanceF(r * 0.05) + ' ' + tplDanceF(r * 0.07) + '"/>' +
    '<path d="' + tplDanceStar(cx, cy, r * 0.8, 8, 0.62) + '"/>' +
    '<path d="' + tplDanceStar(cx, cy, r * 0.8, 8, 0.62, Math.PI / 8) + '" opacity=".6"/>' +
    '<path d="' + tplDanceWhirl(cx, cy, r * 0.46, 7) + '" fill="' + color + '" stroke="none"/></g>';
}

/** Kilim pattern tile (stepped diamond with a hollow centre and corner crosses). */
function tplDanceKilimPat(id, color, op, scale = 1) {
  return '<pattern id="' + id + '" width="40" height="40" patternUnits="userSpaceOnUse"' +
    (scale !== 1 ? ' patternTransform="scale(' + scale + ')"' : '') + '><g fill="' + color + '" opacity="' + op + '" fill-rule="evenodd">' +
    '<path d="M20 4l5 5h-2l5 5h-2l5 6-5 6h2l-5 5h2l-5 5-5-5h2l-5-5h2l-5-6 5-6h-2l5-5h-2zM20 12l8 8-8 8-8-8zM20 17l3 3-3 3-3-3z"/>' +
    '<path d="M0 18h3v4H0zM37 18h3v4h-3zM18 0h4v3h-4zM18 37h4v3h-4zM1 1h3v3H1zM36 1h3v3h-3zM1 36h3v3H1zM36 36h3v3h-3z"/></g></pattern>';
}

/** Interlaced band (two out-of-phase strands with dots in the eyes), like carved stone friezes. */
function tplDanceBraid(x0, x1, y, amp, per, color, sw, op) {
  const hp = per / 2;
  let a = 'M' + tplDanceF(x0) + ' ' + tplDanceF(y) + 'q' + tplDanceF(per / 4) + ' ' + tplDanceF(-amp) + ' ' + tplDanceF(hp) + ' 0';
  let b = 'M' + tplDanceF(x0) + ' ' + tplDanceF(y) + 'q' + tplDanceF(per / 4) + ' ' + tplDanceF(amp) + ' ' + tplDanceF(hp) + ' 0';
  let dots = '';
  for (let x = x0 + hp; x < x1 - 0.1; x += hp) { a += 't' + tplDanceF(hp) + ' 0'; b += 't' + tplDanceF(hp) + ' 0'; }
  for (let x = x0 + per / 4; x < x1; x += hp) dots += 'M' + tplDanceF(x - 1.6) + ' ' + tplDanceF(y) + 'a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0';
  return '<g opacity="' + op + '"><path d="' + a + b + '" fill="none" stroke="' + color + '" stroke-width="' + sw + '"/>' +
    '<path d="' + dots + '" fill="' + color + '"/></g>';
}

/** Gold double frame with diamond corners (cover art). */
function tplDanceFrame(w, h, inset, color, op = 0.7) {
  const i2 = inset + 9;
  let s = '<g fill="none" stroke="' + color + '" opacity="' + op + '"><rect x="' + inset + '" y="' + inset + '" width="' + (w - 2 * inset) + '" height="' + (h - 2 * inset) + '" stroke-width="1.6"/>' +
    '<rect x="' + i2 + '" y="' + i2 + '" width="' + (w - 2 * i2) + '" height="' + (h - 2 * i2) + '" stroke-width=".8" opacity=".55"/></g><g fill="' + color + '" opacity="' + op + '">';
  for (const [x, y] of [[inset, inset], [w - inset, inset], [inset, h - inset], [w - inset, h - inset]]) {
    s += '<path d="M' + x + ' ' + (y - 9) + 'l9 9-9 9-9-9z"/>';
  }
  return s + '<path d="' + tplDanceStar(w / 2, inset, 7, 4, 0.35) + tplDanceStar(w / 2, h - inset, 7, 4, 0.35) + '"/></g>';
}

/** Jagged mountain ridge (path element). */
function tplDanceRidge(rnd, w, h, base, amp, n, fill, snow) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const x = (w * i) / n + (i && i < n ? (rnd() - 0.5) * (w / n) * 0.6 : 0);
    const y = base - (i % 2 ? amp * (0.55 + rnd() * 0.45) : amp * rnd() * 0.35);
    pts.push(tplDanceF(x) + ' ' + tplDanceF(y));
  }
  let s = '<path d="M0 ' + h + 'L' + pts.join('L') + 'L' + w + ' ' + h + 'Z" fill="' + fill + '"/>';
  if (snow) s += '<path d="M' + pts.join('L') + '" fill="none" stroke="' + snow + '" stroke-width="2" opacity=".45"/>';
  return s;
}

// ===== Dancer figures =====
// Local units: feet at (0,0), about 185 tall. Limb segments are [length, angle°]: 0° = down, 90° = sideways out,
// 180° = up; negative angles point inwards. Arms: [upper, fore] for the viewer's left and right side.

const TPL_DANCE_POSES = {
  up: { arms: [[155, 172], [155, 172]], legs: [[4, -2], [4, -2]], flare: 2 },
  side: { arms: [[96, 104], [96, 104]], legs: [[5, -1], [5, -1]], flare: 3 },
  kartuli: { arms: [[92, 99], [40, -95]], legs: [[3, 0], [9, -7]], flare: 3 },
  leap: { arms: [[132, 150], [132, 150]], legs: [[80, -40], [80, -40]], flare: 13 },
  kneel: { arms: [[104, 128], [104, 128]], kneel: true, flare: 7 },
  torch: { arms: [[168, 178], [58, 18]], legs: [[7, 0], [7, 0]], flare: 3 },
  link: { arms: [[36, 34], [36, 34]], legs: [[2, 0], [2, 0]], flare: 1 },
  glide: { arms: [[118, 152], [74, 98]], flare: 6 },
  raise: { arms: [[148, 166], [148, 166]], flare: 5 },
  offer: { arms: [[70, 92], [100, 136]], flare: 8 },
};

function tplDanceLimb(x, y, segs, side) {
  const pts = [[x, y]];
  for (const [len, deg] of segs) {
    const a = (deg * Math.PI) / 180;
    x += side * Math.sin(a) * len;
    y += Math.cos(a) * len;
    pts.push([x, y]);
  }
  return pts;
}

function tplDancePath(pts) {
  return 'M' + pts.map((p) => tplDanceF(p[0]) + ' ' + tplDanceF(p[1])).join('L');
}

/** One dancer: {g: markup without colours (inherits from <use>), veil: markup|'' , hands: [[x,y],[x,y]]}. */
function tplDanceFigure(kind, poseKey) {
  const P = TPL_DANCE_POSES[poseKey] || TPL_DANCE_POSES.up;
  const f = P.flare || 0;
  const g = [];
  const hands = [];
  if (kind === 'm') {
    const dy = P.kneel ? 52 : 0;
    for (const side of [-1, 1]) {
      const L = P.legs ? P.legs[side < 0 ? 0 : 1] : [3, 0];
      const segs = P.kneel ? [[46, 4]] : [[46, L[0]], [50, L[1]]];
      g.push('<path d="' + tplDancePath(tplDanceLimb(side * 6, -100 + dy, segs, side)) + '" fill="none" stroke-width="9.5"/>');
    }
    const sk = 24 + f;
    g.push('<path d="M-3.5 ' + (-152 + dy) + 'L3.5 ' + (-152 + dy) + ' 3.5 ' + (-147 + dy) + ' 17 ' + (-145 + dy) + ' 10.5 ' + (-108 + dy) + ' ' + sk + ' ' + (-60 + dy) +
      'Q0 ' + (-53 + dy) + ' ' + -sk + ' ' + (-60 + dy) + 'L-10.5 ' + (-108 + dy) + ' -17 ' + (-145 + dy) + ' -3.5 ' + (-147 + dy) + 'Z"/>');
    for (const side of [-1, 1]) {
      const A = P.arms[side < 0 ? 0 : 1];
      const pts = tplDanceLimb(side * 16, -144 + dy, [[30, A[0]], [28, A[1]]], side);
      g.push('<path d="' + tplDancePath(pts) + '" fill="none" stroke-width="8"/>');
      hands.push(pts[2]);
    }
    g.push('<circle cy="' + (-161 + dy) + '" r="9"/>');
    g.push('<path d="M-9.8 ' + (-164 + dy) + 'L-11 ' + (-179 + dy) + 'Q0 ' + (-184 + dy) + ' 11 ' + (-179 + dy) + 'L9.8 ' + (-164 + dy) + 'Q0 ' + (-167 + dy) + ' -9.8 ' + (-164 + dy) + 'Z"/>');
    // Gazyri (cartridge pockets), belt and khanjali dagger catch the light in gold.
    let gz = '';
    for (let i = 0; i < 4; i++) { const y = -139 + i * 3.6 + dy; gz += 'M-14 ' + tplDanceF(y) + 'h7M7 ' + tplDanceF(y) + 'h7'; }
    g.push('<path d="' + gz + 'M-10.6 ' + (-108.5 + dy) + 'h21.2M0 ' + (-107 + dy) + 'v15" fill="none" stroke="#caa257" stroke-width="1.6"/>');
    return { g: g.join(''), veil: '', hands };
  }
  // Woman: long kartuli dress with hanging sleeves, small cap and a lechaki veil.
  g.push('<path d="M-3 -147L3 -147 3 -144 13 -141 7.5 -110C12 -78 ' + tplDanceF(22 + f * 0.4) + ' -32 ' + (30 + f) + ' -1Q0 4 ' + -(30 + f) +
    ' -1C' + tplDanceF(-22 - f * 0.4) + ' -32 -12 -78 -7.5 -110L-13 -141 -3 -144Z"/>');
  for (const side of [-1, 1]) {
    const A = P.arms[side < 0 ? 0 : 1];
    const pts = tplDanceLimb(side * 12.5, -140, [[26, A[0]], [25, A[1]]], side);
    g.push('<path d="' + tplDancePath(pts) + '" fill="none" stroke-width="5.5"/>');
    const [e, wr] = [pts[1], pts[2]];
    g.push('<path d="M' + tplDanceF(e[0]) + ' ' + tplDanceF(e[1]) + 'L' + tplDanceF(wr[0]) + ' ' + tplDanceF(wr[1]) + 'L' + tplDanceF(wr[0] + side * 3) + ' ' + tplDanceF(wr[1] + 30) +
      'L' + tplDanceF(e[0] + side * 2) + ' ' + tplDanceF(e[1] + 16) + 'Z"/>');
    hands.push(wr);
  }
  g.push('<circle cy="-154" r="8.5"/><rect x="-8.5" y="-165" width="17" height="4" rx="1.5"/>');
  g.push('<path d="M-1 -110h2l2 9h-6z" fill="#caa257" stroke="none"/>');
  const veil = '<path d="M-7 -163C-15 -150-21 -126-25 -98-19 -104-14 -112-10 -122-8 -135-6 -146-4 -152ZM7 -163C16 -148 24 -118 31 -84 24 -92 17 -103 12 -116 8 -132 6 -146 4 -152Z"/>';
  return { g: g.join(''), veil, hands };
}

/** Defs for a list of figure keys like 'm:up' → {defs, info: {key: {hands}}}. */
function tplDanceFigDefs(keys) {
  let defs = '';
  const info = {};
  for (const key of keys) {
    if (info[key]) continue;
    const [kind, pose] = key.split(':');
    const fig = tplDanceFigure(kind, pose);
    const id = 'f' + Object.keys(info).length;
    info[key] = { id, hands: fig.hands, veil: !!fig.veil };
    defs += '<g id="' + id + '" stroke-linecap="round" stroke-linejoin="round">' + fig.g + '</g>';
    if (fig.veil) defs += '<g id="' + id + 'v">' + fig.veil + '</g>';
  }
  return { defs, info };
}

/**
 * Place a figure with rim light: gold from the upper left, wine red from the right, dark silhouette on top.
 * o = {flip, ink, rim, rim2, op, veil}. Returns {svg, hands (scene coords)}.
 */
function tplDanceUse(info, key, x, y, s, o = {}) {
  const I = info[key];
  const sg = o.flip ? -1 : 1;
  const k = (o.k || 1.7) / s;
  const ink = o.ink || '#0a0506';
  const rim = o.rim || '#f0c470';
  const rim2 = o.rim2 || '#b02a43';
  let g = '<g transform="translate(' + tplDanceF(x) + ' ' + tplDanceF(y) + ') scale(' + tplDanceF2(sg * s) + ' ' + tplDanceF2(s) + ')"' + (o.op ? ' opacity="' + o.op + '"' : '') + '>';
  if (I.veil) g += '<use href="#' + I.id + 'v" fill="' + (o.veil || '#f3e6cb') + '" opacity=".55"/>';
  if (rim !== 'none') {
    g += '<use href="#' + I.id + '" fill="' + rim + '" stroke="' + rim + '" transform="translate(' + tplDanceF(-k * sg) + ' ' + tplDanceF(-k * 0.8) + ')"/>';
    g += '<use href="#' + I.id + '" fill="' + rim2 + '" stroke="' + rim2 + '" opacity=".75" transform="translate(' + tplDanceF(k * 0.9 * sg) + ' ' + tplDanceF(-k * 0.3) + ')"/>';
  }
  g += '<use href="#' + I.id + '" fill="' + ink + '" stroke="' + ink + '"/></g>';
  const hands = I.hands.map((p) => [x + sg * s * p[0], y + s * p[1]]);
  return { svg: g, hands };
}

/** Flame (base at x,y) with a glow halo; needs gradients fla + gl in defs. */
function tplDanceFlame(x, y, s, glow = 1) {
  let out = '';
  if (glow) out += '<circle cx="' + tplDanceF(x) + '" cy="' + tplDanceF(y - 10 * s) + '" r="' + tplDanceF(44 * s * glow) + '" fill="url(#gl)"/>';
  return out + '<path transform="translate(' + tplDanceF(x) + ' ' + tplDanceF(y) + ') scale(' + tplDanceF2(s) + ')" d="M0 0C-7 -6-6 -16 0 -27 2 -20 7 -14 4 -6 3 -2 2 -1 0 0Z" fill="url(#fla)"/>';
}

/** Candle standing at (x, y). */
function tplDanceCandle(x, y, s, glow = 1) {
  return '<rect x="' + tplDanceF(x - 3 * s) + '" y="' + tplDanceF(y - 22 * s) + '" width="' + tplDanceF(6 * s) + '" height="' + tplDanceF(22 * s) + '" rx="' + tplDanceF(s) + '" fill="#efe1c2"/>' +
    tplDanceFlame(x, y - 23 * s, s * 0.55, glow * 1.3);
}

function tplDanceSparks(rnd, n, x0, y0, w, h, color = '#ffd27a', big = 0) {
  let s = '<g fill="' + color + '">';
  for (let i = 0; i < n; i++) {
    const x = x0 + w / 2 + (rnd() - 0.5) * w * (0.35 + rnd() * 0.65);
    const y = y0 + rnd() * h;
    s += '<circle cx="' + tplDanceF(x) + '" cy="' + tplDanceF(y) + '" r="' + tplDanceF(0.7 + rnd() * 2.2) + '" opacity="' + tplDanceF2(0.25 + rnd() * 0.6) + '"/>';
  }
  s += '</g>';
  for (let i = 0; i < big; i++) {
    s += '<circle cx="' + tplDanceF(x0 + rnd() * w) + '" cy="' + tplDanceF(y0 + rnd() * h) + '" r="' + tplDanceF(5 + rnd() * 12) + '" fill="url(#gl)" opacity="' + tplDanceF2(0.3 + rnd() * 0.4) + '"/>';
  }
  return s;
}

/**
 * Theatre stage scene. o = {w, h, seed, sky: stops, spot, spots: [{x, t, b}], floor, floorTop, back (markup behind),
 * figures: [{k:'m:up', x, y, s, flip, ink, torch}], curtain, valance, band, foot (footlights), candles: [[x,y,s]],
 * sparks, big, cone, pool, front (markup in front)}
 */
function tplDanceStage(o) {
  const { w, h } = o;
  const rnd = tplRand(tplHash(o.seed || 'stage'));
  const fy = o.floor || Math.round(h * 0.8);
  const spot = o.spot || '#f3c46b';
  const figs = (o.figures || []).slice().sort((a, b) => a.y - b.y);
  const F = tplDanceFigDefs(figs.map((f) => f.k));
  const needFlame = figs.some((f) => f.torch) || (o.candles && o.candles.length) || o.foot;
  const defs = [
    tplDanceLin('sk', o.sky || [[0, '#120708'], [0.55, '#2b0b13'], [1, '#0a0405']]),
    tplDanceLin('fl', [[0, o.floorTop || '#2b1114'], [1, '#060203']]),
    tplDanceRad('gl', [[0, '#ffe2a0', 0.85], [0.3, '#ffb347', 0.35], [1, '#ff8a2a', 0]]),
    tplDanceRad('vg', [[0.6, '#000', 0], [1, '#000', 0.72]], 0.5, 0.45, 0.78),
    F.defs,
  ];
  if (needFlame) defs.push(tplDanceLin('fla', [[0, '#ff4d1a', 0.1], [0.4, '#ff9a2e'], [1, '#fff0c0']]));
  if (o.curtain || o.valance) {
    defs.push('<linearGradient id="cu" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="56" y2="0" spreadMethod="repeat">' +
      tplDanceStops([[0, '#2e060e'], [0.5, '#7c1629'], [1, '#2e060e']]) + '</linearGradient>');
  }
  if (o.band || o.valance) defs.push(tplDanceKilimPat('kp', '#d9ae5a', 0.55, 0.55));
  const b = ['<rect width="' + w + '" height="' + h + '" fill="url(#sk)"/>'];
  if (o.back) b.push(o.back);
  if (o.band) b.push('<rect y="' + o.band + '" width="' + w + '" height="22" fill="url(#kp)" opacity=".5"/>');
  const spots = o.spots || [{ x: w / 2, t: w * 0.06, b: w * 0.46 }];
  spots.forEach((sp, i) => {
    const c = sp.c || spot;
    defs.push(tplDanceLin('cn' + i, [[0, c, 0.03], [1, c, sp.cone ?? o.cone ?? 0.28]]), tplDanceRad('pl' + i, [[0, c, sp.pool ?? o.pool ?? 0.5], [1, c, 0]]));
    b.push('<path d="M' + tplDanceF(sp.x - sp.t / 2) + ' -10L' + tplDanceF(sp.x + sp.t / 2) + ' -10 ' + tplDanceF(sp.x + sp.b / 2) + ' ' + (fy + 30) + ' ' + tplDanceF(sp.x - sp.b / 2) + ' ' + (fy + 30) + 'Z" fill="url(#cn' + i + ')"/>');
  });
  b.push('<rect y="' + fy + '" width="' + w + '" height="' + (h - fy) + '" fill="url(#fl)"/>');
  spots.forEach((sp, i) => {
    b.push('<ellipse cx="' + tplDanceF(sp.x) + '" cy="' + tplDanceF(fy + (h - fy) * 0.4) + '" rx="' + tplDanceF(sp.b * 0.62) + '" ry="' + tplDanceF((h - fy) * 0.34) + '" fill="url(#pl' + i + ')"/>');
  });
  for (const f of figs) {
    // Floor reflection / shadow under each dancer.
    b.push('<ellipse cx="' + tplDanceF(f.x) + '" cy="' + tplDanceF(f.y + 2) + '" rx="' + tplDanceF(34 * f.s) + '" ry="' + tplDanceF(5 * f.s) + '" fill="#000" opacity=".55"/>');
    const u = tplDanceUse(F.info, f.k, f.x, f.y - (f.lift || 0), f.s, f);
    b.push(u.svg);
    if (f.torch) {
      const hd = u.hands[f.flip ? 1 : 0];
      b.push('<path d="M' + tplDanceF(hd[0]) + ' ' + tplDanceF(hd[1] + 10 * f.s) + 'V' + tplDanceF(hd[1] - 14 * f.s) + '" stroke="#2a1408" stroke-width="' + tplDanceF(3.2 * f.s) + '" stroke-linecap="round"/>');
      b.push(tplDanceFlame(hd[0], hd[1] - 14 * f.s, f.s * 1.25, 1.4));
    }
  }
  for (const c of o.candles || []) b.push(tplDanceCandle(c[0], c[1], c[2], c[3] ?? 1));
  if (o.front) b.push(o.front);
  if (o.curtain) {
    const cw = w * 0.11;
    const cd = 'M0 0H' + tplDanceF(cw) + 'C' + tplDanceF(cw * 0.6) + ' ' + tplDanceF(h * 0.32) + ' ' + tplDanceF(cw * 1.1) + ' ' + tplDanceF(h * 0.72) + ' ' + tplDanceF(cw * 0.5) + ' ' + h + 'H0Z';
    b.push('<path d="' + cd + '" fill="url(#cu)"/><path d="' + cd + '" fill="url(#cu)" transform="matrix(-1 0 0 1 ' + w + ' 0)"/>');
  }
  if (o.valance) {
    const n = Math.round(w / 160), vh = Math.round(h * 0.07);
    let d = 'M0 0H' + w + 'V' + vh;
    for (let i = n - 1; i >= 0; i--) d += 'Q' + tplDanceF((i + 0.5) * (w / n)) + ' ' + (vh + 34) + ' ' + tplDanceF(i * (w / n)) + ' ' + vh;
    b.push('<path d="' + d + 'Z" fill="url(#cu)"/>');
    b.push('<rect y="' + (vh - 30) + '" width="' + w + '" height="22" fill="url(#kp)"/>');
    let fr = 'M' + w + ' ' + vh;
    for (let i = n - 1; i >= 0; i--) fr += 'Q' + tplDanceF((i + 0.5) * (w / n)) + ' ' + (vh + 34) + ' ' + tplDanceF(i * (w / n)) + ' ' + vh;
    b.push('<path d="' + fr + '" fill="none" stroke="#d9ae5a" stroke-width="3" stroke-dasharray="1.5 3" opacity=".9"/>');
  }
  if (o.foot) {
    for (let i = 0; i < o.foot; i++) {
      const x = (w * (i + 0.5)) / o.foot;
      b.push('<ellipse cx="' + tplDanceF(x) + '" cy="' + (h - 6) + '" rx="34" ry="12" fill="url(#gl)"/><ellipse cx="' + tplDanceF(x) + '" cy="' + (h - 5) + '" rx="5" ry="2.2" fill="#fff1cf"/>');
    }
  }
  if (o.sparks) b.push(tplDanceSparks(rnd, o.sparks, w * 0.1, h * 0.08, w * 0.8, fy - h * 0.1, o.sparkColor, o.big || 0));
  b.push('<rect width="' + w + '" height="' + h + '" fill="url(#vg)"/>');
  return tplDanceSvg(w, h, '<defs>' + defs.join('') + '</defs>' + b.join(''));
}

// ===== Scenes =====

/** Hero: the ensemble on a curtained stage — soloist mid-leap, kneeling men, gliding women, a back line, sparks. */
function tplDanceHeroSVG() {
  const figures = [];
  for (let i = 0; i < 6; i++) figures.push({ k: 'm:up', x: 360 + i * 176, y: 712, s: 0.6, flip: i % 2 === 1, op: 0.9 });
  figures.push({ k: 'w:glide', x: 462, y: 764, s: 0.82 }, { k: 'w:glide', x: 1138, y: 764, s: 0.82, flip: true });
  figures.push({ k: 'm:kneel', x: 632, y: 816, s: 0.94 }, { k: 'm:kneel', x: 968, y: 816, s: 0.94, flip: true });
  figures.push({ k: 'm:leap', x: 800, y: 850, s: 1.1, lift: 78 });
  const back = tplDanceRosette(800, 330, 230, '#d9ae5a', 0.1, 2) + tplDanceRosette(300, 400, 120, '#d9ae5a', 0.07) + tplDanceRosette(1300, 400, 120, '#d9ae5a', 0.07);
  return tplDanceStage({
    w: 1600, h: 900, seed: 'hero', floor: 700, valance: true, curtain: true, foot: 12, sparks: 80, big: 7, band: 600, back, figures,
    spots: [{ x: 800, t: 90, b: 780 }, { x: 300, t: 40, b: 440, c: '#d0405c', cone: 0.22, pool: 0.35 }, { x: 1300, t: 40, b: 440, c: '#d0405c', cone: 0.22, pool: 0.35 }],
  });
}

/** Mountain range backdrop (layers of ridges, far → near) for open-air scenes. */
function tplDanceRange(seed, w, h, base, colors, snow) {
  const rnd = tplRand(tplHash('range:' + seed));
  let s = '';
  colors.forEach((c, i) => {
    s += tplDanceRidge(rnd, w, h, base + i * h * 0.06, h * (0.26 - i * 0.06), 9 + i * 4, c, i === 0 ? snow : '');
  });
  return s;
}

/** Ellipse of figures (a round dance seen from the stalls): n dancers, back row smaller. */
function tplDanceRound(n, cx, cy, rx, ry, s0, keys) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / 2;
    const depth = (Math.sin(a) + 1) / 2; // 0 back … 1 front
    out.push({ k: keys[i % keys.length], x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry, s: s0 * (0.78 + 0.32 * depth), flip: Math.cos(a) > 0 });
  }
  return out;
}

// Repertoire covers (800×600): one staged scene per choreography.
const TPL_DANCE_COVERS = {
  spark: () => tplDanceStage({
    w: 800, h: 600, seed: 'spark', floor: 440, band: 372, sparks: 80, big: 6,
    back: tplDanceRosette(400, 220, 170, '#d9ae5a', 0.1, 2),
    figures: [0, 1, 2, 3, 4, 5].map((i) => ({ k: 'm:torch', x: 135 + i * 106, y: 488 + (i % 2) * 22, s: 0.74, torch: true })),
    spots: [{ x: 400, t: 60, b: 640, c: '#e2563c', cone: 0.24, pool: 0.45 }, { x: 140, t: 30, b: 260, c: '#f0b45a', cone: 0.16 }, { x: 660, t: 30, b: 260, c: '#f0b45a', cone: 0.16 }],
    front: tplDanceFrame(800, 600, 18, '#d9ae5a', 0.55),
  }),
  candles: () => tplDanceStage({
    w: 800, h: 600, seed: 'candles', floor: 430, sparks: 26,
    sky: [[0, '#140709'], [0.6, '#2c0d14'], [1, '#0a0405']],
    back: tplDanceRosette(400, 230, 150, '#d9ae5a', 0.08, 2),
    figures: [{ k: 'm:kartuli', x: 350, y: 486, s: 0.96 }, { k: 'w:glide', x: 462, y: 486, s: 0.95, flip: true }],
    candles: [[92, 530, 1.25], [168, 548, 1], [244, 562, 0.85], [556, 562, 0.85], [632, 548, 1], [708, 530, 1.25]],
    spots: [{ x: 405, t: 50, b: 400 }],
    front: tplDanceFrame(800, 600, 18, '#d9ae5a', 0.55),
  }),
  clouds: () => tplDanceStage({
    w: 800, h: 600, seed: 'clouds', floor: 470, sparks: 70, sparkColor: '#f4f1ff',
    sky: [[0, '#090b1c'], [0.55, '#1e1838'], [1, '#3a2240']], floorTop: '#20162a',
    back: tplDanceRange('clouds', 800, 600, 300, ['#2c2a4a', '#221d3a', '#18142a'], '#e9e6ff'),
    figures: [{ k: 'm:side', x: 220, y: 520, s: 0.82 }, { k: 'm:leap', x: 400, y: 545, s: 0.98, lift: 56 }, { k: 'm:side', x: 580, y: 520, s: 0.82, flip: true }],
    spots: [{ x: 400, t: 40, b: 520, c: '#c9d4ff', cone: 0.2, pool: 0.38 }],
    front: tplDanceFrame(800, 600, 18, '#d9ae5a', 0.5),
  }),
  garden: () => tplDanceStage({
    w: 800, h: 600, seed: 'garden', floor: 430,
    back: tplDanceBraid(40, 760, 92, 14, 56, '#d9ae5a', 2.2, 0.45) + tplDanceRosette(400, 240, 120, '#d9ae5a', 0.12, 2),
    figures: [{ k: 'w:raise', x: 290, y: 478, s: 0.92 }, { k: 'w:offer', x: 400, y: 494, s: 1 }, { k: 'w:raise', x: 510, y: 478, s: 0.92, flip: true }],
    candles: [[150, 520, 1], [650, 520, 1]],
    spots: [{ x: 400, t: 60, b: 470, c: '#f3c46b' }], sparks: 24,
    front: tplDanceFrame(800, 600, 18, '#d9ae5a', 0.55),
  }),
  sea: () => {
    const sea = '<rect y="300" width="800" height="140" fill="#1a2433" opacity=".9"/><ellipse cx="560" cy="300" rx="260" ry="10" fill="#f6d8a0" opacity=".22"/>' +
      '<path d="M380 316h360M430 334h260M480 352h170M520 370h90" stroke="#f6d8a0" stroke-width="3" opacity=".35"/><circle cx="560" cy="200" r="34" fill="#f8e3b0" opacity=".9"/>';
    return tplDanceStage({
      w: 800, h: 600, seed: 'sea', floor: 440, sparks: 30,
      sky: [[0, '#0d1424'], [0.55, '#2a2134'], [1, '#4a2a2e']], floorTop: '#2a1612',
      back: sea, band: 402,
      figures: [{ k: 'm:side', x: 200, y: 500, s: 0.82 }, { k: 'w:glide', x: 290, y: 500, s: 0.8, flip: true }, { k: 'm:side', x: 510, y: 500, s: 0.82 }, { k: 'w:glide', x: 600, y: 500, s: 0.8, flip: true }],
      spots: [{ x: 250, t: 40, b: 300, c: '#f0b45a', cone: 0.2 }, { x: 555, t: 40, b: 300, c: '#f0b45a', cone: 0.2 }],
      front: tplDanceFrame(800, 600, 18, '#d9ae5a', 0.55),
    });
  },
};

// Gallery scenes (several aspect ratios for the masonry layout).
const TPL_DANCE_GALLERY = {
  ensemble: () => {
    const figures = [];
    for (let i = 0; i < 9; i++) figures.push({ k: i % 2 ? 'w:raise' : 'm:up', x: 140 + i * 115, y: 560 + (i % 2) * 8, s: 0.62, flip: i % 4 === 3 });
    figures.push({ k: 'm:kneel', x: 470, y: 620, s: 0.78 }, { k: 'm:kneel', x: 730, y: 620, s: 0.78, flip: true }, { k: 'm:leap', x: 600, y: 640, s: 0.86, lift: 60 });
    return tplDanceStage({
      w: 1200, h: 700, seed: 'ensemble', floor: 540, valance: true, curtain: true, foot: 9, sparks: 50, big: 4, band: 470,
      back: tplDanceRosette(600, 250, 190, '#d9ae5a', 0.09, 2), figures,
      spots: [{ x: 600, t: 80, b: 760 }, { x: 230, t: 30, b: 330, c: '#d0405c', cone: 0.2, pool: 0.3 }, { x: 970, t: 30, b: 330, c: '#d0405c', cone: 0.2, pool: 0.3 }],
    });
  },
  torch: () => tplDanceStage({
    w: 700, h: 900, seed: 'torch', floor: 720, sparks: 110, big: 7,
    figures: [{ k: 'm:torch', x: 350, y: 800, s: 1.6, torch: true }],
    spots: [{ x: 350, t: 50, b: 520, c: '#e2563c', cone: 0.26, pool: 0.5 }],
  }),
  ornament: () => {
    const w = 800, h = 800;
    const defs = tplDanceKilimPat('kp', '#d9ae5a', 0.32, 1) + tplDanceRad('bg', [[0, '#4a1220'], [0.65, '#24070e'], [1, '#100306']], 0.5, 0.48, 0.72) +
      tplDanceRad('gl', [[0, '#ffe2a0', 0.5], [1, '#ffb347', 0]]);
    let b = '<rect width="800" height="800" fill="url(#bg)"/><rect width="800" height="800" fill="url(#kp)" opacity=".55"/>';
    b += '<circle cx="400" cy="400" r="330" fill="url(#gl)" opacity=".35"/><circle cx="400" cy="400" r="292" fill="#1a0509" opacity=".85"/>';
    b += tplDanceRosette(400, 400, 270, '#e3b866', 0.95, 3) + tplDanceRosette(400, 400, 130, '#e3b866', 0.6, 2);
    b += tplDanceBraid(30, 770, 46, 12, 52, '#d9ae5a', 2.4, 0.7) + tplDanceBraid(30, 770, 754, 12, 52, '#d9ae5a', 2.4, 0.7);
    for (const [x, y] of [[90, 140], [710, 140], [90, 660], [710, 660]]) b += '<path d="' + tplDanceStar(x, y, 40, 8, 0.5) + '" fill="#d9ae5a" opacity=".55"/>';
    return tplDanceSvg(w, h, '<defs>' + defs + '</defs>' + b);
  },
  festival: () => {
    const figures = [];
    for (let i = 0; i < 10; i++) figures.push({ k: i % 2 ? 'w:glide' : 'm:side', x: 170 + i * 96, y: 640 + (i % 3) * 6, s: 0.5, flip: i % 2 === 1 });
    return tplDanceStage({
      w: 1200, h: 800, seed: 'festival', floor: 610, sparks: 90, sparkColor: '#fff4dc',
      sky: [[0, '#0b0f24'], [0.5, '#2c1d3c'], [0.85, '#7a3644'], [1, '#c26a48']], floorTop: '#3a1d1a',
      back: tplDanceRange('festival', 1200, 800, 430, ['#3b2a46', '#2a1d34', '#1a1224'], '#f1d9e0'), figures,
      spots: [{ x: 600, t: 120, b: 1000, c: '#f3c46b', cone: 0.16, pool: 0.4 }],
    });
  },
  circle: () => tplDanceStage({
    w: 800, h: 800, seed: 'circle', floor: 560, sparks: 30,
    figures: tplDanceRound(7, 400, 650, 250, 60, 0.82, ['w:glide', 'w:raise']),
    candles: [[400, 660, 1.4], [330, 690, 1], [470, 690, 1], [260, 720, 0.9], [540, 720, 0.9]],
    spots: [{ x: 400, t: 60, b: 640 }],
    back: tplDanceRosette(400, 300, 220, '#d9ae5a', 0.08, 2),
  }),
  line: () => tplDanceStage({
    w: 1200, h: 700, seed: 'line', floor: 520, band: 450, sparks: 40,
    sky: [[0, '#0e0607'], [0.6, '#351019'], [1, '#0b0405']],
    figures: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ k: 'm:link', x: 160 + i * 110, y: 640, s: 1.02 })),
    spots: [{ x: 600, t: 300, b: 1300, c: '#f3d38b', cone: 0.18, pool: 0.4 }],
  }),
};

/** Silhouette portrait for the troupe (600×600): one dancer in a pose under a spotlight, a medallion behind. */
function tplDancePortrait(o) {
  return tplDanceStage({
    w: 600, h: 600, seed: 'p:' + o.seed, floor: 452, sparks: 26,
    sky: [[0, o.bg[0]], [1, o.bg[1]]], floorTop: o.bg[1],
    back: tplDanceRosette(300, 250, 200, '#d9ae5a', 0.14, 2.5),
    figures: [{ k: o.pose, x: o.x || 300, y: 572, s: o.s || 2.5, flip: !!o.flip, torch: !!o.torch }],
    spots: [{ x: 300, t: 60, b: 380, c: o.spot || '#f3c46b' }],
  });
}

const TPL_DANCE_PORTRAITS = {
  director: { seed: 'director', pose: 'm:kartuli', bg: ['#2a0b12', '#0d0406'], x: 280 },
  choreo: { seed: 'choreo', pose: 'w:raise', bg: ['#25101f', '#0b050a'], spot: '#f0c2a0' },
  soloist: { seed: 'soloist', pose: 'm:side', bg: ['#141228', '#06050c'], spot: '#c9d4ff', s: 2.3 },
  prima: { seed: 'prima', pose: 'w:offer', bg: ['#2b170b', '#0c0603'], x: 290 },
};

/** Logo mark: a gold whirl rosette (works on the dark nav and as a favicon). */
function tplDanceLogoSVG() {
  return tplDanceSvg(240, 240, '<circle cx="120" cy="120" r="116" fill="#1b0b0e"/>' + tplDanceRosette(120, 120, 104, '#e1b45c', 1, 5));
}

/** Dark ornamental texture behind the booking call to action (1600×700). */
function tplDanceTextureSVG() {
  const rnd = tplRand(tplHash('texture'));
  const defs = tplDanceKilimPat('kp', '#d9ae5a', 0.5, 1.2) + tplDanceRad('bg', [[0, '#3a0c18'], [0.7, '#160509'], [1, '#090203']], 0.5, 0.3, 0.9) +
    tplDanceRad('gl', [[0, '#ffe2a0', 0.85], [0.3, '#ffb347', 0.35], [1, '#ff8a2a', 0]]);
  let b = '<rect width="1600" height="700" fill="url(#bg)"/><rect width="1600" height="700" fill="url(#kp)" opacity=".18"/>';
  b += tplDanceRosette(220, 350, 300, '#d9ae5a', 0.12, 3) + tplDanceRosette(1380, 350, 300, '#d9ae5a', 0.12, 3);
  b += tplDanceBraid(0, 1600, 40, 12, 60, '#d9ae5a', 2, 0.35) + tplDanceBraid(0, 1600, 660, 12, 60, '#d9ae5a', 2, 0.35);
  b += tplDanceSparks(rnd, 70, 0, 80, 1600, 540, '#ffd27a', 5);
  return tplDanceSvg(1600, 700, '<defs>' + defs + '</defs>' + b);
}

// ===== Music sketches: a tiny deterministic WAV synthesizer (mono, 22 050 Hz, 16-bit PCM) =====
// Instruments: panduri (Karplus–Strong pluck), salamuri (breathy flute with vibrato), voices (additive "ah" choir),
// chiboni (reedy bagpipe chanter), doli (frame drum: low "dum" and slap "tek") and hand claps. A light Schroeder
// reverb glues the mix; the result is normalized and faded in and out.

const TPL_DANCE_SR = 22050;

/** Frequency of scale degree `deg` (0 = root; ≥7 next octaves; negative below) over `root` Hz in `mode` (semitones). */
function tplDanceHz(root, mode, deg) {
  const n = mode.length;
  const o = Math.floor(deg / n);
  const i = ((deg % n) + n) % n;
  return root * Math.pow(2, (mode[i] + 12 * o) / 12);
}

/** Envelope: linear attack, exponential-ish release at the end. */
function tplDanceEnv(i, len, att, rel) {
  if (i < att) return i / att;
  if (i > len - rel) return Math.max(0, (len - i) / rel);
  return 1;
}

const TPL_DANCE_VOICES = {
  pluck(out, at, f, dur, amp, rnd) {
    const N = Math.max(2, Math.round(TPL_DANCE_SR / f));
    const buf = new Float32Array(N);
    let last = 0;
    for (let i = 0; i < N; i++) { const r = rnd() * 2 - 1; last = last * 0.4 + r * 0.6; buf[i] = last; }
    const len = Math.min(out.length - at, Math.round((dur + 0.6) * TPL_DANCE_SR));
    let k = 0;
    for (let i = 0; i < len; i++) {
      const a = buf[k], b = buf[(k + 1) % N];
      buf[k] = (a + b) * 0.4975;
      out[at + i] += a * amp * tplDanceEnv(i, len, 8, 900);
      k = (k + 1) % N;
    }
  },
  flute(out, at, f, dur, amp, rnd) {
    const len = Math.min(out.length - at, Math.round(dur * TPL_DANCE_SR));
    let ph = 0, nz = 0;
    for (let i = 0; i < len; i++) {
      const t = i / TPL_DANCE_SR;
      const vib = 1 + 0.006 * Math.sin(2 * Math.PI * 5.4 * t) * Math.min(1, t * 4);
      ph += (2 * Math.PI * f * vib) / TPL_DANCE_SR;
      nz = nz * 0.85 + (rnd() * 2 - 1) * 0.15;
      const e = tplDanceEnv(i, len, 700, 1400);
      out[at + i] += (Math.sin(ph) + 0.22 * Math.sin(2 * ph) + 0.08 * Math.sin(3 * ph) + nz * 0.35) * amp * e;
    }
  },
  voice(out, at, f, dur, amp) {
    const len = Math.min(out.length - at, Math.round(dur * TPL_DANCE_SR));
    const H = [1, 0.62, 0.48, 0.3, 0.22, 0.14, 0.09, 0.05];
    const ph = [0, 0];
    for (let i = 0; i < len; i++) {
      const t = i / TPL_DANCE_SR;
      const vib = 1 + 0.004 * Math.sin(2 * Math.PI * 4.6 * t + f);
      ph[0] += (2 * Math.PI * f * vib) / TPL_DANCE_SR;
      ph[1] += (2 * Math.PI * f * 1.004 * vib) / TPL_DANCE_SR; // a second singer, slightly sharp: chorus
      let s = 0;
      for (let h = 0; h < H.length; h++) s += H[h] * (Math.sin((h + 1) * ph[0]) + Math.sin((h + 1) * ph[1])) * 0.5;
      out[at + i] += s * amp * 0.45 * tplDanceEnv(i, len, 2600, 3200);
    }
  },
  reed(out, at, f, dur, amp) {
    const len = Math.min(out.length - at, Math.round(dur * TPL_DANCE_SR));
    let ph = 0;
    for (let i = 0; i < len; i++) {
      ph += (2 * Math.PI * f) / TPL_DANCE_SR;
      let s = 0;
      for (let h = 1; h <= 9; h += 2) s += Math.sin(h * ph) / h;
      s += 0.3 * Math.sin(2 * ph);
      out[at + i] += s * amp * 0.7 * tplDanceEnv(i, len, 160, 500);
    }
  },
  dum(out, at, f, dur, amp, rnd) {
    const len = Math.min(out.length - at, Math.round(0.42 * TPL_DANCE_SR));
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const t = i / TPL_DANCE_SR;
      ph += (2 * Math.PI * (52 + 110 * Math.exp(-t * 28))) / TPL_DANCE_SR;
      out[at + i] += (Math.sin(ph) * Math.exp(-t * 9) + (rnd() * 2 - 1) * Math.exp(-t * 90) * 0.35) * amp;
    }
  },
  tek(out, at, f, dur, amp, rnd) {
    const len = Math.min(out.length - at, Math.round(0.12 * TPL_DANCE_SR));
    let lp = 0, ph = 0;
    for (let i = 0; i < len; i++) {
      const t = i / TPL_DANCE_SR;
      const n = rnd() * 2 - 1;
      lp += (n - lp) * 0.55;
      ph += (2 * Math.PI * 340) / TPL_DANCE_SR;
      out[at + i] += ((n - lp) * 0.9 + Math.sin(ph) * 0.5) * Math.exp(-t * 48) * amp;
    }
  },
  clap(out, at, f, dur, amp, rnd) {
    const len = Math.min(out.length - at, Math.round(0.16 * TPL_DANCE_SR));
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / TPL_DANCE_SR;
      const burst = t < 0.03 ? (Math.floor(t / 0.01) % 2 ? 0.4 : 1) : 1;
      const n = rnd() * 2 - 1;
      lp += (n - lp) * 0.3;
      out[at + i] += (n - lp) * burst * Math.exp(-(t < 0.03 ? t % 0.01 : t - 0.02) * 60) * amp;
    }
  },
};

/** Light Schroeder reverb in place (4 combs + 2 all-passes), `wet` 0..1. */
function tplDanceReverb(x, wet) {
  const k = TPL_DANCE_SR / 44100;
  const combs = [1116, 1188, 1277, 1356].map((d) => ({ b: new Float32Array(Math.round(d * k)), i: 0, f: 0 }));
  const aps = [556, 441].map((d) => ({ b: new Float32Array(Math.round(d * k)), i: 0 }));
  for (let n = 0; n < x.length; n++) {
    const inp = x[n] * 0.25;
    let s = 0;
    for (const c of combs) {
      const y = c.b[c.i];
      c.f = y * 0.75 + c.f * 0.25; // damping
      c.b[c.i] = inp + c.f * 0.8;
      c.i = (c.i + 1) % c.b.length;
      s += y;
    }
    for (const a of aps) {
      const y = a.b[a.i];
      const v = s + y * 0.5;
      a.b[a.i] = v;
      a.i = (a.i + 1) % a.b.length;
      s = y - v * 0.5;
    }
    x[n] = x[n] * (1 - wet * 0.5) + s * wet;
  }
}

/** 16-bit mono PCM WAV (base64) from float samples. */
function tplDanceWavB64(x) {
  const n = x.length;
  const bytes = new Uint8Array(44 + n * 2);
  const v = new DataView(bytes.buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, TPL_DANCE_SR, true);
  v.setUint32(28, TPL_DANCE_SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-32767, Math.min(32767, Math.round(x[i] * 32767))), true);
  return b64encode(bytes);
}

/**
 * Render a sketch → WAV base64. spec = {seed, sec, bpm (beats per minute), root (Hz), mode (semitones), wet,
 * notes: [[beat, instrument, degree (or Hz when `hz`), beats, amp], …]}.
 */
function tplDanceWav(spec) {
  const sec = spec.sec || 4;
  const x = new Float32Array(Math.round(sec * TPL_DANCE_SR));
  const rnd = tplRand(tplHash('wav:' + spec.seed));
  const beat = 60 / spec.bpm;
  for (const [b, inst, deg, len, amp] of spec.notes) {
    const at = Math.round(b * beat * TPL_DANCE_SR);
    if (at >= x.length) continue;
    const f = typeof deg === 'number' ? tplDanceHz(spec.root, spec.mode, deg) : 0;
    TPL_DANCE_VOICES[inst](x, at, f, len * beat, amp ?? 0.5, rnd);
  }
  tplDanceReverb(x, spec.wet ?? 0.22);
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const g = peak > 0 ? 0.88 / peak : 1;
  const fi = Math.round(0.02 * TPL_DANCE_SR), fo = Math.round(0.7 * TPL_DANCE_SR);
  for (let i = 0; i < x.length; i++) {
    let e = 1;
    if (i < fi) e = i / fi;
    else if (i > x.length - fo) e = (x.length - i) / fo;
    x[i] *= g * e;
  }
  return tplDanceWavB64(x);
}

/** Repeat a rhythm over `bars`: pattern string per bar ('D' dum, 'd' soft dum, 'T' tek, 't' soft tek, 'C' clap, '.'), `step` beats. */
function tplDanceBeat(pattern, bars, step, from = 0) {
  const out = [];
  const amp = { D: 0.9, d: 0.55, T: 0.6, t: 0.32, C: 0.5 };
  const inst = { D: 'dum', d: 'dum', T: 'tek', t: 'tek', C: 'clap' };
  for (let bar = 0; bar < bars; bar++) {
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      if (inst[c]) out.push([from + (bar * pattern.length + i) * step, inst[c], null, 0.2, amp[c]]);
    }
  }
  return out;
}

/** Melody from [degree|null, beats] pairs starting at `from` beat. */
function tplDanceLine(inst, seq, from = 0, amp = 0.5) {
  const out = [];
  let b = from;
  for (const [deg, len] of seq) {
    if (deg != null) out.push([b, inst, deg, len * 0.95, amp]);
    b += len;
  }
  return out;
}

// Georgian-flavoured modes (semitones): dorian, mixolydian, aeolian.
const TPL_DANCE_MODES = { dor: [0, 2, 3, 5, 7, 9, 10], mix: [0, 2, 4, 5, 7, 9, 10], aeo: [0, 2, 3, 5, 7, 8, 10] };

const TPL_DANCE_SKETCHES = {
  // Khorumi-like war dance: heavy doli in fives, a low male drone and a salamuri call.
  spark: () => ({
    seed: 'spark', sec: 4.2, bpm: 168, root: 146.83, mode: TPL_DANCE_MODES.dor, wet: 0.2,
    notes: [
      ...tplDanceBeat('D.dT.', 3, 1), ...tplDanceBeat('DTdTT', 1, 1, 15),
      [0, 'voice', -7, 11, 0.55], [0, 'voice', -3, 11, 0.4],
      ...tplDanceLine('flute', [[4, 1], [5, 0.5], [4, 0.5], [3, 1], [2, 1], [4, 2], [null, 0.5], [7, 0.5], [6, 0.5], [5, 0.5], [4, 2]], 1, 0.36),
    ],
  }),
  // Kartuli: slow 6/8, panduri arpeggios under a long salamuri line.
  candles: () => {
    const arp = [];
    const chords = [[0, 2, 4, 7], [-2, 0, 3, 5], [-1, 1, 4, 6], [0, 2, 4, 7]];
    chords.forEach((c, bar) => [0, 1, 2, 3, 2, 1].forEach((k, i) => arp.push([bar * 3 + i * 0.5, 'pluck', c[k] - 7, 1.2, 0.42])));
    return {
      seed: 'candles', sec: 4.4, bpm: 84, root: 220, mode: TPL_DANCE_MODES.aeo, wet: 0.3,
      notes: [...arp, ...tplDanceBeat('d..t..', 4, 0.5), ...tplDanceLine('flute', [[4, 1.5], [5, 0.5], [4, 0.5], [2, 1.5], [3, 1], [4, 0.5], [2, 1.5], [0, 2.5]], 0.5, 0.42)],
    };
  },
  // Mountain dance: fast doli, claps, a fifth drone and a pentatonic salamuri run.
  clouds: () => ({
    seed: 'clouds', sec: 4, bpm: 152, root: 196, mode: TPL_DANCE_MODES.mix, wet: 0.24,
    notes: [
      ...tplDanceBeat('DttTdttT', 5, 0.5), ...tplDanceBeat('..C...C.', 5, 0.5),
      [0, 'voice', -7, 10, 0.35], [0, 'voice', -3, 10, 0.3],
      ...tplDanceLine('flute', [[4, 0.5], [5, 0.5], [7, 0.5], [8, 0.5], [7, 0.5], [5, 0.5], [4, 1], [2, 0.5], [4, 0.5], [5, 0.5], [4, 0.5], [2, 0.5], [0, 0.5], [2, 1], [4, 2]], 0.5, 0.38),
    ],
  }),
  // Samaia: three-voice choir in parallel fifths and fourths resolving to an open fifth.
  garden: () => {
    const prog = [[0, 4, 7], [-1, 3, 6], [-2, 2, 5], [0, 4, 8], [0, 4, 7]];
    const notes = [];
    prog.forEach((c, i) => c.forEach((d, v) => notes.push([i * 2, 'voice', d - 7, 2.6, [0.5, 0.36, 0.32][v]])));
    [0, 2, 4, 6, 8].forEach((b) => notes.push([b, 'pluck', -7, 1.5, 0.3], [b + 1, 'pluck', -3, 1.5, 0.22]));
    return { seed: 'garden', sec: 4.6, bpm: 120, root: 174.61, mode: TPL_DANCE_MODES.dor, wet: 0.36, notes };
  },
  // Acharuli: a bouncy chiboni tune over its drone, doli and offbeat claps.
  sea: () => ({
    seed: 'sea', sec: 4, bpm: 138, root: 233.08, mode: TPL_DANCE_MODES.mix, wet: 0.18,
    notes: [
      [0, 'reed', -7, 9.2, 0.22],
      ...tplDanceBeat('D.tTd.tT', 4, 0.5), ...tplDanceBeat('.C.C.C.C', 4, 0.5),
      ...tplDanceLine('reed', [[4, 0.5], [4, 0.25], [5, 0.25], [6, 0.5], [7, 0.5], [6, 0.5], [5, 0.5], [4, 1], [2, 0.5], [3, 0.5], [4, 0.5], [3, 0.25], [2, 0.25], [1, 0.5], [0, 1.5]], 0, 0.3),
    ],
  }),
};

// ===== Template =====

/** i18n value in the template's languages (ka · en · ru). */
function tplDanceT(ka, en, ru) {
  return { ka, en, ru };
}

/** Rich text: each argument (string or array of paragraphs) becomes <p> paragraphs. */
function tplDanceP(ka, en, ru) {
  const p = (a) => (Array.isArray(a) ? a : [a]).map((x) => '<p>' + x + '</p>').join('');
  return { ka: p(ka), en: p(en), ru: p(ru) };
}

/** Bullet list in three languages from parallel arrays. */
function tplDanceUl(ka, en, ru) {
  const u = (a) => '<ul>' + a.map((x) => '<li>' + x + '</li>').join('') + '</ul>';
  return { ka: u(ka), en: u(en), ru: u(ru) };
}

// Sample press kit (ASCII PDF): programmes, technical needs and contacts for promoters.
const TPL_DANCE_PRESSKIT = [
  '> Napertskali - Georgian folk dance ensemble - Tbilisi, since 1998 - season 2026/27',
  '',
  '# The ensemble',
  'Forty-eight dancers and seven musicians perform Georgian folk dances from every region of the country. Every',
  'choreography is set to an original score by the artistic director and composer Nikoloz Gvazava, played live on',
  'panduri, salamuri, chiboni and doli, with a male choir.',
  '',
  '# Touring programmes',
  '- The Spark (Khorumi and more): 24-48 dancers, 90 minutes with an interval',
  '- Dances of Georgia: 16-32 dancers, 60 or 90 minutes',
  '- Two Candles, chamber evening: 8 dancers and 3 musicians, 50 minutes',
  '- Festival set: 8-16 dancers, 20-40 minutes, open-air stages welcome',
  '',
  '# Technical rider (main programme)',
  '- Stage at least 12 x 8 m, sprung or wooden floor, no raked stage',
  '- 4 dressing rooms for 50 people, steamer and racks for costumes',
  '- Sound: 6 vocal microphones, 4 instrument microphones, 4 monitors',
  '- Light: warm white washes, 3 follow spots; open flame (torches) needs fire-safety approval',
  '',
  '# Contacts',
  'Booking and tours: booking@napertskali.example - phone +995 000 00 00 00',
  'Press and photos: press@napertskali.example',
  '',
  '> Sample document of a fictional ensemble generated by the landing builder. Replace it with your own press kit.',
];

function tplBuildDance(V) {
  const K = tplKit(V, ['ka', 'en', 'ru']);
  const { B, L } = K;
  const T = tplDanceT;
  const P = tplDanceP;
  const art = (name, svg, title) => K.svg(name + '.svg', svg, { title });

  // ----- artwork & files -----
  const aHero = art('napertskali-stage', tplDanceHeroSVG(), T('ანსამბლი სცენაზე: სოლისტის ნახტომი', 'The ensemble on stage: a soloist mid-leap', 'Ансамбль на сцене: прыжок солиста'));
  const aLogo = art('napertskali-rosette', tplDanceLogoSVG(), T('ნაპერწკალის ემბლემა', 'Napertskali emblem', 'Эмблема «Напертскали»'));
  const aTexture = art('ornament-texture', tplDanceTextureSVG(), T('ქართული ორნამენტი', 'Georgian ornament', 'Грузинский орнамент'));
  const gal = {};
  const galTitles = {
    ensemble: T('მთელი დასი სცენაზე', 'The whole troupe on stage', 'Вся труппа на сцене'),
    torch: T('ჩირაღდნით სოლო', 'A solo with a torch', 'Соло с факелом'),
    ornament: T('ორნამენტი ჩვენი დეკორაციიდან', 'An ornament from our set design', 'Орнамент из нашей сценографии'),
    festival: T('ფესტივალი მთებში', 'A festival in the mountains', 'Фестиваль в горах'),
    circle: T('სანთლების წრე', 'A circle of candles', 'Круг свечей'),
    line: T('ხელიხელჩაკიდებული ვაჟები', 'Men dancing arm in arm', 'Юноши, взявшиеся за руки'),
  };
  for (const k of Object.keys(TPL_DANCE_GALLERY)) gal[k] = art('gallery-' + k, TPL_DANCE_GALLERY[k](), galTitles[k]);
  const face = {};
  for (const k of Object.keys(TPL_DANCE_PORTRAITS)) face[k] = art('troupe-' + k, tplDancePortrait(TPL_DANCE_PORTRAITS[k]), T('პორტრეტი', 'Portrait', 'Портрет'));
  const pdf = K.addAtt({
    name: 'napertskali-press-kit-2026.pdf', mime: 'application/pdf',
    data: K.files.makePDF('Napertskali - Press Kit 2026/27', TPL_DANCE_PRESSKIT, { accent: '#8c1c2e', band: 'NAPERTSKALI - GEORGIAN FOLK DANCE ENSEMBLE' }),
    title: T('პრეს-კიტი და ტექნიკური რაიდერი', 'Press kit and technical rider', 'Пресс-кит и технический райдер'),
    desc: T('პროგრამები, სცენის მოთხოვნები, კონტაქტები · PDF', 'Programmes, stage requirements, contacts · PDF', 'Программы, требования к сцене, контакты · PDF'),
  });

  // Repertoire (collection items): cover art, attributes music / year / duration and a synthesized music sketch.
  const attr = (label, value) => ({ label: L(label), value: L(value) });
  const W = (key, title, genre, music, year, duration, html, tags) => {
    const cover = art('cover-' + key, TPL_DANCE_COVERS[key](), title);
    const media = K.addAtt({
      name: 'napertskali-' + key + '-sketch.wav', mime: 'audio/wav', data: tplDanceWav(TPL_DANCE_SKETCHES[key]()),
      title: T(title.ka + ' — მუსიკალური ესკიზი', title.en + ' — music sketch', title.ru + ' — музыкальный эскиз'),
      desc: T('სინთეზირებული ნიმუში · 4 წამი', 'Synthesized sample · 4 seconds', 'Синтезированный образец · 4 секунды'),
    });
    return K.item({
      title: L(title), subtitle: L(genre), cover, badge: L(''), html: L(html), tags: L(tags),
      attrs: [attr(T('მუსიკა', 'Music', 'Музыка'), music), attr(T('წელი', 'Year', 'Год'), year), attr(T('ხანგრძლივობა', 'Duration', 'Длительность'), duration)],
      files: [{ att: media, label: L(T('მუსიკალური ესკიზი', 'Music sketch', 'Музыкальный эскиз')), kind: 'audio' }],
      date: '', href: '', price: null, old: null, unit: L(''), sku: '',
    });
  };
  const by = (ka, en, ru) => T('ნიკოლოზ გვაზავა · ' + ka, 'Nikoloz Gvazava · ' + en, 'Николоз Гвазава · ' + ru);

  // ----- requests (browser-local endpoints) -----
  const rqOrder = { id: K.id(), name: 'Ticket order', method: 'POST', url: 'local:orders', headers: [], credentials: 'omit', timeout: 10000, retries: 2, itemsPath: 'items' };
  const rqInbox = { id: K.id(), name: 'Contact form', method: 'POST', url: 'local:inbox', headers: [], credentials: 'omit', timeout: 10000, retries: 2, itemsPath: 'items' };
  const field = (key, type, label, o = {}) => K.item({ key, type, label: L(label), ph: L(o.ph || ''), options: L(o.options || ''), required: !!o.required, half: !!o.half });

  const d = K.doc({
    name: 'Napertskali — Georgian folk dance ensemble',
    preset: 'supra',
    author: 'Napertskali ensemble',
    keywords: 'Georgian dance, folk dance ensemble, Khorumi, Kartuli, Samaia, Tbilisi, tickets, tour, dance school',
    title: T('ნაპერწკალი — ქართული ხალხური ცეკვის ანსამბლი', 'Napertskali — Georgian folk dance ensemble', 'Напертскали — ансамбль грузинского народного танца'),
    description: T(
      'ქართული ხალხური ცეკვის ანსამბლი თბილისიდან: ქორეოგრაფიები ნიკოლოზ გვაზავას მუსიკაზე, გასტროლები, ბილეთები და ცეკვის სტუდია.',
      'Georgian folk dance ensemble from Tbilisi: choreographies set to music by Nikoloz Gvazava, tour dates, tickets and a dance studio.',
      'Ансамбль грузинского народного танца из Тбилиси: постановки на музыку Николоза Гвазавы, гастроли, билеты и студия танца.'),
    output: { autodetect: true, switcher: 'buttons', langLabels: 'code', themeToggle: false, toolbarPos: 'nav', uiFallback: 'en', motion: 'rise', backToTop: true },
    shop: {
      currency: 'GEL', mode: 'cart', cartButton: 'auto', sync: 'local', policy: 'newest', ttlDays: 14,
      checkout: {
        method: 'request', req: rqOrder.id, fallback: 'mailto', email: 'tickets@napertskali.example', phone: '+995 000 00 00 00', minTotal: 0,
        note: T('ელექტრონულ ბილეთებსა და გადახდის ბმულს ელფოსტით გამოგიგზავნით ერთი სამუშაო დღის განმავლობაში.',
          'We e-mail your e-tickets and a payment link within one working day.',
          'Электронные билеты и ссылку на оплату пришлём на e-mail в течение рабочего дня.'),
        success: T('გმადლობთ! შეკვეთა მიღებულია — ბილეთები და გადახდის ბმული ელფოსტით მოგივათ.',
          'Thank you! Your order is in — e-tickets and a payment link are on their way to your inbox.',
          'Спасибо! Заказ принят — билеты и ссылка на оплату придут на вашу почту.'),
        fields: [
          field('name', 'text', T('სახელი და გვარი', 'Full name', 'Имя и фамилия'), { required: true, half: true }),
          field('email', 'email', T('ელფოსტა ბილეთებისთვის', 'E-mail for the tickets', 'E-mail для билетов'), { required: true, half: true }),
          field('phone', 'tel', T('ტელეფონი', 'Phone', 'Телефон'), { half: true, ph: '+995 …' }),
          field('note', 'textarea', T('კომენტარი', 'Comment', 'Комментарий')),
        ],
      },
    },
    requests: [rqOrder, rqInbox],
  });
  d.meta.ogImage = aHero;
  d.meta.favicon = aLogo;

  // ----- header -----
  d.regions.header = [B('nav', {
    brand: T('ნაპერწკალი', 'Napertskali', 'Напертскали'), logo: aLogo, logoH: 40,
    items: [
      K.item({ label: L(T('რეპერტუარი', 'Repertoire', 'Репертуар')), href: '#repertoire' }),
      K.item({ label: L(T('გასტროლები', 'Tour', 'Гастроли')), href: '#tour' }),
      K.item({ label: L(T('სტუდია', 'Studio', 'Студия')), href: '#studio' }),
      K.item({ label: L(T('კონტაქტი', 'Contact', 'Контакты')), href: '#contact' }),
    ],
    ctaLabel: T('ბილეთები', 'Tickets', 'Билеты'), ctaHref: '#tour',
    sticky: true, overlay: true, variant: 'bar',
  })];

  // ----- main -----
  const hero = B('hero', {
    eyebrow: T('ქართული ხალხური ცეკვის ანსამბლი · თბილისი', 'Georgian folk dance ensemble · Tbilisi', 'Ансамбль грузинского народного танца · Тбилиси'),
    title: T('ნაპერწკალი', 'Napertskali', 'Напертскали'),
    text: P('48 მოცეკვავე, ცოცხალი მუსიკა და ქორეოგრაფიები ნიკოლოზ გვაზავას მუსიკაზე. ხორუმიდან სამაიამდე — ქართული ცეკვა ისე, როგორც ის სცენაზე ცოცხლობს.',
      'Forty-eight dancers, live music and choreographies set to scores by Nikoloz Gvazava. From Khorumi to Samaia — Georgian dance as it lives on stage.',
      'Сорок восемь танцоров, живая музыка и постановки на музыку Николоза Гвазавы. От хоруми до самаи — грузинский танец таким, каким он живёт на сцене.'),
    items: [
      K.btn(T('ბილეთები', 'Get tickets', 'Купить билеты'), '#tour', 'primary', 'ticket'),
      K.btn(T('მოუსმინეთ რეპერტუარს', 'Listen to the repertoire', 'Слушать репертуар'), '#repertoire', 'secondary', 'play'),
    ],
    layout: 'center', bg: aHero, overlay: 38, height: 'screen', tone: 'dark',
  });

  const about = K.sec({
    anchor: 'about', eyebrow: T('ანსამბლის შესახებ', 'About the ensemble', 'Об ансамбле'),
    title: T('ცეკვა, რომელსაც საკუთარი მუსიკა აქვს', 'Dance with a score of its own', 'Танец со своей музыкой'), pad: 'l',
  }, [
    B('columns', {
      gap: 64, valign: 'center',
      cols: [
        { id: K.id(), w: 56, blocks: [
          K.text(P(
            ['„ნაპერწკალი“ 1998 წელს თბილისში რამდენიმე ახალგაზრდა მოცეკვავემ დააარსა. დღეს ანსამბლში 48 მოცეკვავე და შვიდი მუსიკოსია, რეპერტუარში კი საქართველოს ყველა კუთხის ცეკვაა — ქართლ-კახეთიდან აჭარამდე, ხევსურეთიდან სამეგრელომდე.',
              'ჩვენს ანსამბლს მუსიკა გამოარჩევს. სამხატვრო ხელმძღვანელი ნიკოლოზ გვაზავა ყოველი ქორეოგრაფიისთვის ახალ პარტიტურას წერს — ხალხურ მელოდიებზე დაყრდნობით, ფანდურისთვის, სალამურისთვის, დოლისა და მამაკაცთა გუნდისთვის.'],
            ['Napertskali was founded in Tbilisi in 1998 by a handful of young dancers. Today the ensemble has 48 dancers and seven musicians, and its repertoire spans every corner of Georgia — from Kartli and Kakheti to Adjara, from Khevsureti to Samegrelo.',
              'What sets us apart is the music. Our artistic director Nikoloz Gvazava writes a new score for every choreography, built on folk melodies for panduri, salamuri, doli and a male choir.'],
            ['«Напертскали» основали в Тбилиси в 1998 году несколько молодых танцоров. Сегодня в ансамбле 48 танцоров и семь музыкантов, а в репертуаре — танцы всех уголков Грузии: от Картли и Кахетии до Аджарии, от Хевсурети до Самегрело.',
              'Нас отличает музыка. Художественный руководитель Николоз Гвазава пишет новую партитуру для каждой постановки — на основе народных мелодий, для пандури, саламури, доли и мужского хора.']), { size: 'l' }),
          B('quote', {
            variant: 'pull', tone: 'accent',
            html: P('ქართული ცეკვა ნაბიჯების ნაკრები არ არის. ეს საუბარია — მოცეკვავესა და მუსიკას, ვაჟსა და ქალს, ჩვენსა და ჩვენს წინაპრებს შორის.',
              'Georgian dance is not a set of steps. It is a conversation — between dancer and music, between a man and a woman, between us and those who danced before us.',
              'Грузинский танец — не набор движений. Это разговор: танцора с музыкой, мужчины с женщиной, нас — с теми, кто танцевал до нас.'),
            author: T('ნიკოლოზ გვაზავა, სამხატვრო ხელმძღვანელი', 'Nikoloz Gvazava, artistic director', 'Николоз Гвазава, художественный руководитель'),
          }),
        ] },
        { id: K.id(), w: 44, blocks: [B('image', { att: gal.circle, ratio: '1/1', fit: 'cover', shape: 'rounded', zoom: true,
          caption: L(T('„წლის წრე“: ფერხული სანთლების შუქზე', '“Circle of the Year”: a round dance by candlelight', '«Круг года»: хоровод при свечах')) })] },
      ],
    }),
    B('spacer', { h: 32 }),
    B('stats', {
      variant: 'band', columns: 4,
      items: [
        K.item({ value: '48', suffix: L(''), label: L(T('მოცეკვავე', 'dancers', 'танцоров')) }),
        K.item({ value: '7', suffix: L(''), label: L(T('მუსიკოსი', 'musicians', 'музыкантов')) }),
        K.item({ value: '32', suffix: L(''), label: L(T('ქორეოგრაფია', 'choreographies', 'постановки')) }),
        K.item({ value: '27', suffix: L(''), label: L(T('ქვეყანა გასტროლებზე', 'countries on tour', 'стран на гастролях')) }),
      ],
    }),
  ]);

  const repertoire = K.sec({
    anchor: 'repertoire', tone: 'dark', shape: 'ornament',
    eyebrow: T('რეპერტუარი', 'Repertoire', 'Репертуар'),
    title: T('ქორეოგრაფიები ნიკოლოზ გვაზავას მუსიკაზე', 'Choreographies set to music by Nikoloz Gvazava', 'Постановки на музыку Николоза Гвазавы'),
    lead: P('დააჭირეთ ყდას და მოუსმინეთ მუსიკალურ ესკიზს — მოკლე ფრაგმენტს თითოეული ქორეოგრაფიის პარტიტურიდან.',
      'Press a cover to hear a music sketch — a short fragment from the score of each choreography.',
      'Нажмите на обложку, чтобы послушать музыкальный эскиз — короткий фрагмент партитуры каждой постановки.'),
    pad: 'l',
  }, [B('collection', {
    variant: 'feature', columns: 2, ratio: '4/3', cardAttrs: 3, details: 'none', media: 'reader',
    items: [
      W('spark', T('ნაპერწკალი', 'The Spark', 'Искра'), T('ხორუმი · მეომართა ცეკვა', 'Khorumi · warriors’ dance', 'Хоруми · танец воинов'),
        by('დოლი, სალამური, მამაკაცთა გუნდი', 'doli, salamuri, male choir', 'доли, саламури, мужской хор'), '2025', '11:40',
        P('ოცდაოთხი მოცეკვავე ჩირაღდნებით: აჭარული ხორუმის რიტმი ახალ, თანამედროვე დრამატურგიაში. სეზონის მთავარი პრემიერა.',
          'Twenty-four dancers with torches: the rhythm of the Adjarian Khorumi in a new, modern dramaturgy. The main premiere of the season.',
          'Двадцать четыре танцора с факелами: ритм аджарского хоруми в новой, современной драматургии. Главная премьера сезона.'),
        T('ჩირაღდნები, მამაკაცთა ანსამბლი, პრემიერა', 'torches, men’s ensemble, premiere', 'факелы, мужской ансамбль, премьера')),
      W('candles', T('ორი სანთელი', 'Two Candles', 'Две свечи'), T('ქართული · წყვილის ცეკვა', 'Kartuli · couple dance', 'Картули · парный танец'),
        by('ფანდური, სალამური', 'panduri, salamuri', 'пандури, саламури'), '2016', '7:15',
        P('ყველაზე ნაზი ქართული ცეკვა: ვაჟი ქალს არ ეხება და მხოლოდ მზერითა და ნაბიჯით ესაუბრება.',
          'The most tender of Georgian dances: the man never touches the woman and speaks to her only with his gaze and his steps.',
          'Самый нежный грузинский танец: мужчина не касается женщины и говорит с ней только взглядом и шагом.'),
        T('დუეტი, სანთლები, კლასიკა', 'duet, candles, classic', 'дуэт, свечи, классика')),
      W('clouds', T('ღრუბლებს ზემოთ', 'Above the Clouds', 'Над облаками'), T('ხევსურული · მთის ცეკვა', 'Khevsuruli · mountain dance', 'Хевсурули · горский танец'),
        by('სალამური, დოლი, ტაში', 'salamuri, doli, hand claps', 'саламури, доли, хлопки'), '2021', '9:20',
        P('ხევსურეთის მთებში დაბადებული ცეკვა: ნახტომები, ხმლების წკრიალი და ტაშის რიტმი.',
          'A dance born in the mountains of Khevsureti: leaps, the ring of swords and the beat of hand claps.',
          'Танец, рождённый в горах Хевсурети: прыжки, звон мечей и ритм хлопков.'),
        T('მთები, ნახტომები, ხმლები', 'mountains, leaps, swords', 'горы, прыжки, мечи')),
      W('garden', T('დედოფლის ბაღი', 'The Queen’s Garden', 'Сад царицы'), T('სამაია · ქალთა ცეკვა', 'Samaia · women’s dance', 'Самая · женский танец'),
        by('სამხმიანი გუნდი, ფანდური', 'three-part choir, panduri', 'трёхголосный хор, пандури'), '2018', '6:05',
        P('სამი მოცეკვავე, ერთი სუნთქვა: სამაიას ტრადიციულად თამარ მეფის ეპოქას უკავშირებენ.',
          'Three dancers breathing as one: Samaia is traditionally linked to the age of Queen Tamar.',
          'Три танцовщицы, одно дыхание: самаю традиционно связывают с эпохой царицы Тамар.'),
        T('ტრიო, მრავალხმიანობა, ქალები', 'trio, polyphony, women', 'трио, многоголосие, женщины')),
      W('sea', T('ქორწილი ზღვისპირას', 'Wedding by the Sea', 'Свадьба у моря'), T('აჭარული · წყვილების ცეკვა', 'Acharuli · couples’ dance', 'Аджарули · танец пар'),
        by('ჭიბონი, დოლი', 'chiboni bagpipe, doli', 'чибони, доли'), '2022', '8:30',
        P('მხიარული აჭარული ქორწილი: ფლირტი, ხუმრობა და ჭიბონის მელოდია.',
          'A cheerful Adjarian wedding: flirting, jokes and the tune of the chiboni bagpipe.',
          'Весёлая аджарская свадьба: флирт, шутки и мелодия чибони.'),
        T('წყვილები, იუმორი, შავი ზღვა', 'couples, humour, Black Sea', 'пары, юмор, Чёрное море')),
    ],
  })]);

  const ev = (date, time, title, venue, city, price, sku, status = 'on', href = '') => K.item({ date, time, title: L(title), venue: L(venue), city: L(city), price, sku, status, href });
  const vake = T('ვაკის საკონცერტო დარბაზი', 'Vake Concert Hall', 'Концертный зал Ваке');
  const tbilisi = T('თბილისი', 'Tbilisi', 'Тбилиси');
  const tour = K.sec({
    anchor: 'tour', eyebrow: T('გასტროლები', 'On tour', 'Гастроли'), title: T('სეზონი 2026/27', 'Season 2026/27', 'Сезон 2026/27'),
    lead: P('ბილეთი პირდაპირ აქ შეიძინეთ: დაამატეთ კალათაში და ელექტრონულ ბილეთებს ელფოსტით მიიღებთ.',
      'Buy tickets right here: add them to the cart and receive your e-tickets by e-mail.',
      'Покупайте билеты прямо здесь: добавьте их в корзину, и электронные билеты придут на e-mail.'),
    width: 'normal',
  }, [B('events', {
    variant: 'list', hidePast: false,
    items: [
      ev('2026-10-30', '19:00', T('„ნაპერწკალი“ — სეზონის გახსნა', 'The Spark — season opening', '«Искра» — открытие сезона'), vake, tbilisi, 60, 'tix-2610-tbilisi', 'few'),
      ev('2026-11-07', '19:00', T('საქართველოს ცეკვები', 'Dances of Georgia', 'Танцы Грузии'), T('რიონის თეატრი', 'Rioni Theatre', 'Театр «Риони»'), T('ქუთაისი', 'Kutaisi', 'Кутаиси'), 40, 'tix-2611-kutaisi'),
      ev('2026-11-21', '19:00', T('„ნაპერწკალი“', 'The Spark', '«Искра»'), T('ზღვისპირა თეატრი', 'Seaside Theatre', 'Приморский театр'), T('ბათუმი', 'Batumi', 'Батуми'), 45, 'tix-2611-batumi'),
      ev('2026-12-12', '20:00', T('საქართველოს ცეკვები', 'Dances of Georgia', 'Танцы Грузии'), T('დუნაის საკონცერტო დარბაზი', 'Danube Concert Hall', 'Концертный зал «Дунай»'), T('ვენა', 'Vienna', 'Вена'), null, '', 'on', 'https://tickets.example/napertskali-vienna'),
      ev('2027-01-14', '19:00', T('„ორი სანთელი“ — კამერული საღამო', 'Two Candles — a chamber evening', '«Две свечи» — камерный вечер'), T('კახეთის დრამატული თეატრი', 'Kakheti Drama Theatre', 'Кахетинский драматический театр'), T('თელავი', 'Telavi', 'Телави'), 35, 'tix-2701-telavi', 'soldout'),
      ev('2027-03-08', '18:00', T('„დედოფლის ბაღი“ — საგაზაფხულო გალა', 'The Queen’s Garden — spring gala', '«Сад царицы» — весенний гала-концерт'), vake, tbilisi, 55, 'tix-2703-tbilisi'),
    ],
  })]);

  const plan = (name, price, period, featured, sku, label, html) => K.item({ name: L(name), price, period: L(period), featured, label: L(label), href: '', sku, html: L(html) });
  const signUp = T('ჩაწერა', 'Sign up', 'Записаться');
  const month = T('თვეში', 'per month', 'в месяц');
  const studio = K.sec({
    anchor: 'studio', tone: 'muted', align: 'center', eyebrow: T('ცეკვის სტუდია', 'Dance studio', 'Студия танца'),
    title: T('იცეკვეთ ჩვენთან ერთად', 'Dance with us', 'Танцуйте с нами'),
    lead: P('ანსამბლის მოცეკვავეები ასწავლიან ბავშვებსა და მოზრდილებს — პირველი ნაბიჯიდან სცენამდე.',
      'Dancers of the ensemble teach children and adults — from the very first step to the stage.',
      'Танцоры ансамбля учат детей и взрослых — от первого шага до сцены.'),
  }, [B('pricing', {
    columns: 3,
    items: [
      plan(T('საცდელი გაკვეთილი', 'Trial lesson', 'Пробное занятие'), 20, T('ერთჯერადი', 'one lesson', 'разовое'), false, 'cls-trial', signUp,
        tplDanceUl(['60 წუთი', 'ნებისმიერი ასაკი და დონე', 'სპეციალური ფორმა არ გჭირდებათ'], ['60 minutes', 'Any age and level', 'No special outfit needed'], ['60 минут', 'Любой возраст и уровень', 'Специальная форма не нужна'])),
      plan(T('ბავშვები 6–12', 'Children 6–12', 'Дети 6–12'), 120, month, true, 'cls-kids', signUp,
        tplDanceUl(['კვირაში სამჯერ', 'ხალხური ცეკვის საფუძვლები და რიტმი', 'წლის ბოლოს — კონცერტი დიდ სცენაზე'], ['Three times a week', 'Folk dance basics and rhythm', 'An end-of-year concert on the big stage'], ['Три раза в неделю', 'Основы народного танца и ритм', 'В конце года — концерт на большой сцене'])),
      plan(T('მოზრდილები', 'Adults', 'Взрослые'), 140, month, false, 'cls-adults', signUp,
        tplDanceUl(['კვირაში ორჯერ, საღამოს', 'დამწყებთა და გამოცდილთა ჯგუფები', 'ქართული და კავკასიური ცეკვები'], ['Twice a week, in the evening', 'Beginner and advanced groups', 'Georgian and Caucasian dances'], ['Два раза в неделю, по вечерам', 'Группы для начинающих и продолжающих', 'Грузинские и кавказские танцы'])),
    ],
  })]);

  const gallery = K.sec({
    anchor: 'gallery', eyebrow: T('გალერეა', 'Gallery', 'Галерея'), title: T('სცენიდან და კულისებიდან', 'From the stage and the wings', 'Со сцены и из-за кулис'), width: 'wide',
  }, [B('gallery', {
    variant: 'masonry', columns: 3, ratio: '4/3', zoom: true, gap: 14,
    items: ['ensemble', 'torch', 'ornament', 'festival', 'circle', 'line'].map((k) => K.item({ att: gal[k], caption: L(galTitles[k]) })),
  })]);

  const member = (photo, name, role, html) => K.item({ photo, name: L(name), role: L(role), html: L(html), href: '' });
  const troupe = K.sec({
    anchor: 'troupe', tone: 'dark', align: 'center', eyebrow: T('დასი', 'The troupe', 'Труппа'),
    title: T('ადამიანები სცენაზე და მის მიღმა', 'The people on stage and behind it', 'Люди на сцене и за ней'),
  }, [B('team', {
    variant: 'round', columns: 4,
    items: [
      member(face.director, T('ნიკოლოზ გვაზავა', 'Nikoloz Gvazava', 'Николоз Гвазава'), T('სამხატვრო ხელმძღვანელი და კომპოზიტორი', 'Artistic director & composer', 'Художественный руководитель и композитор'),
        P('ანსამბლის ყველა ქორეოგრაფიის მუსიკის ავტორი. თავადაც უკრავს ფანდურზე.', 'Writes the music for every choreography of the ensemble and plays the panduri himself.', 'Автор музыки ко всем постановкам ансамбля; сам играет на пандури.')),
      member(face.choreo, T('ქეთევან მამულაშვილი', 'Ketevan Mamulashvili', 'Кетеван Мамулашвили'), T('მთავარი ქორეოგრაფი', 'Chief choreographer', 'Главный хореограф'),
        P('დადგმები „დედოფლის ბაღი“ და „წლის წრე“. ხელმძღვანელობს სტუდიის ბავშვთა ჯგუფებს.', 'Staged The Queen’s Garden and Circle of the Year; leads the studio’s children’s groups.', 'Поставила «Сад царицы» и «Круг года»; ведёт детские группы студии.')),
      member(face.soloist, T('სანდრო კაპანაძე', 'Sandro Kapanadze', 'Сандро Капанадзе'), T('სოლისტი', 'Principal dancer', 'Солист'),
        P('„ნაპერწკალის“ ცენტრალური სოლო და ხევსურული ნახტომები.', 'The central solo of The Spark and the leaps of Khevsuruli.', 'Центральное соло «Искры» и прыжки хевсурули.')),
      member(face.prima, T('ნინი გოგოლაძე', 'Nini Gogoladze', 'Нини Гоголадзе'), T('სოლისტი', 'Principal dancer', 'Солистка'),
        P('„ორი სანთლის“ და სამაიას სოლისტი, სტუდიის პედაგოგი.', 'Soloist in Two Candles and Samaia; teaches at the studio.', 'Солистка «Двух свечей» и самаи, педагог студии.')),
    ],
  })]);

  const press = K.sec({
    eyebrow: T('პრესა და მაყურებელი', 'Press and audience', 'Пресса и зрители'), title: T('რას ამბობენ ჩვენზე', 'What they say about us', 'Что о нас говорят'),
  }, [B('testimonials', {
    variant: 'cards', columns: 3,
    items: [
      K.item({ rating: 5, photo: null, name: L(T('ლია ხურციძე', 'Lia Khurtsidze', 'Лия Хурцидзе')), role: L('Tbilisi Evening Review'),
        html: L(P('„ნაპერწკალი“ წლის ყველაზე ენერგიული პრემიერაა. დარბაზი ფინალამდე ადგა ფეხზე.', '“The Spark” is the most electric premiere of the year. The hall was on its feet before the finale.', '«Искра» — самая энергичная премьера года. Зал встал ещё до финала.')) }),
      K.item({ rating: 5, photo: null, name: L(T('მარტინ კელერი', 'Martin Keller', 'Мартин Келлер')), role: L('Dance Notes Europe'),
        html: L(P('გვაზავას მუსიკა ცეკვას კი არ ამშვენებს — წინ მიუძღვის. იშვიათი შემთხვევაა, როცა ხალხურ ანსამბლს საკუთარი კომპოზიტორი ჰყავს.',
          'Gvazava’s scores do not decorate the dance — they drive it. A rare case of a folk ensemble with a composer of its own.',
          'Музыка Гвазавы не украшает танец, а ведёт его. Редкий случай, когда у народного ансамбля есть собственный композитор.')) }),
      K.item({ rating: 5, photo: null, name: L(T('ნანა და გიორგი', 'Nana & Giorgi', 'Нана и Георгий')), role: L(T('მაყურებლები, ქუთაისი', 'Audience, Kutaisi', 'Зрители, Кутаиси')),
        html: L(P('ბავშვები „ორ სანთელზე“ წავიყვანეთ და მთელი კვირა მხოლოდ მასზე ლაპარაკობდნენ. მადლობა ამ ჯადოსნური საღამოსთვის!',
          'We took our children to “Two Candles” and they talked about nothing else for a week. Thank you for the magic!',
          'Сводили детей на «Две свечи» — потом целую неделю они только о них и говорили. Спасибо за волшебство!')) }),
    ],
  })]);

  const faq = K.sec({
    tone: 'muted', width: 'narrow', eyebrow: T('კითხვები', 'Questions', 'Вопросы'), title: T('ხშირად დასმული კითხვები', 'Frequently asked questions', 'Частые вопросы'),
  }, [B('faq', {
    variant: 'details', openFirst: true,
    items: [
      K.item({ q: L(T('რამდენ ხანს გრძელდება კონცერტი?', 'How long is a performance?', 'Сколько длится концерт?')), html: L(P(
        'მთავარი პროგრამა დაახლოებით ორ საათს გრძელდება, 20-წუთიანი შესვენებით. კამერული საღამოები — 50 წუთი.',
        'The main programme runs for about two hours with a 20-minute interval. Chamber evenings last 50 minutes.',
        'Основная программа идёт около двух часов с антрактом 20 минут. Камерные вечера — 50 минут.')) }),
      K.item({ q: L(T('როგორ მივიღებ ბილეთებს?', 'How do I get my tickets?', 'Как я получу билеты?')), html: L(P(
        'შეკვეთიდან ერთი სამუშაო დღის განმავლობაში ელფოსტით მიიღებთ ელექტრონულ ბილეთებს QR-კოდით — შესასვლელთან უბრალოდ აჩვენეთ ტელეფონში.',
        'Within one working day of your order we e-mail e-tickets with a QR code — just show it on your phone at the entrance.',
        'В течение рабочего дня после заказа пришлём электронные билеты с QR-кодом — просто покажите его на входе с телефона.')) }),
      K.item({ q: L(T('შეიძლება ბავშვებთან ერთად მოსვლა?', 'Can I bring children?', 'Можно прийти с детьми?')), html: L(P(
        'რა თქმა უნდა, 6 წლიდან. თითოეულ ბავშვს საკუთარი ბილეთი სჭირდება.',
        'Of course — from the age of six. Every child needs their own ticket.',
        'Конечно, с шести лет. Каждому ребёнку нужен собственный билет.')) }),
      K.item({ q: L(T('შეგიძლიათ ჩვენს ფესტივალზე ან ღონისძიებაზე გამოსვლა?', 'Can you perform at our festival or event?', 'Можете выступить на нашем фестивале или мероприятии?')), html: L(P(
        'დიახ: გვაქვს პროგრამები 20-დან 120 წუთამდე, 8-დან 48 მოცეკვავემდე. მოგვწერეთ და გამოგიგზავნით ტექნიკურ რაიდერს.',
        'Yes: we tour programmes from 20 to 120 minutes with 8 to 48 dancers. Write to us and we will send the technical rider.',
        'Да: у нас есть программы от 20 до 120 минут и от 8 до 48 танцоров. Напишите нам — пришлём технический райдер.')) }),
      K.item({ q: L(T('შეიძლება ფოტოს გადაღება?', 'May I take photos?', 'Можно фотографировать?')), html: L(P(
        'ფოტო — დიახ, ოღონდ ფლეშის გარეშე. ვიდეოგადაღება მხოლოდ ანსამბლის ნებართვით შეიძლება.',
        'Photos — yes, but without flash. Video recording only with the ensemble’s permission.',
        'Фото — да, но без вспышки. Видеосъёмка только с разрешения ансамбля.')) }),
    ],
  })]);

  const cta = B('cta', {
    variant: 'banner', tone: 'dark', bg: aTexture, overlay: 20,
    title: T('მოიწვიეთ „ნაპერწკალი“ თქვენს ფესტივალზე', 'Bring Napertskali to your festival', 'Пригласите «Напертскали» на ваш фестиваль'),
    html: P('პროგრამები 20-დან 120 წუთამდე, 8-დან 48 მოცეკვავემდე — ყოველთვის ცოცხალი მუსიკით.',
      'Programmes from 20 to 120 minutes, from 8 to 48 dancers — always with live music.',
      'Программы от 20 до 120 минут, от 8 до 48 танцоров — всегда с живой музыкой.'),
    items: [
      K.btn(T('პრეს-კიტი', 'Press kit', 'Пресс-кит'), '#att-' + pdf, 'primary', 'download'),
      K.btn(T('მოგვწერეთ', 'Write to us', 'Написать нам'), '#contact', 'secondary', 'chat'),
    ],
  });

  const contact = K.sec({
    anchor: 'contact', eyebrow: T('კონტაქტი', 'Contact', 'Контакты'), title: T('დაგვიკავშირდით', 'Get in touch', 'Свяжитесь с нами'),
    lead: P('ჯგუფური ბილეთები, მოწვევები, სტუდიაში ჩაწერა თუ პრესა — მოგვწერეთ და ერთ სამუშაო დღეში გიპასუხებთ.',
      'Group tickets, invitations, studio sign-ups or press — write to us and we will answer within one working day.',
      'Групповые билеты, приглашения, запись в студию или пресса — напишите, и мы ответим в течение рабочего дня.'),
  }, [B('columns', {
    gap: 48, valign: 'top',
    cols: [
      { id: K.id(), w: 42, blocks: [
        B('contact', {
          variant: 'list', labels: true, map: null, mapHref: '',
          items: [
            K.item({ kind: 'email', value: 'booking@napertskali.example', label: L(T('გასტროლები და მოწვევები', 'Booking and tours', 'Гастроли и приглашения')), href: '' }),
            K.item({ kind: 'email', value: 'studio@napertskali.example', label: L(T('ცეკვის სტუდია', 'Dance studio', 'Студия танца')), href: '' }),
            K.item({ kind: 'phone', value: '+995 000 00 00 00', label: L(T('ტელეფონი', 'Phone', 'Телефон')), href: '' }),
            K.item({ kind: 'address', value: '7 Chonguri St, Tbilisi, Georgia', label: L(T('სტუდია და რეპეტიციები', 'Studio and rehearsals', 'Студия и репетиции')), href: '' }),
            K.item({ kind: 'hours', value: '10:00 – 19:00', label: L(T('ოფისი, ორშაბათი–პარასკევი', 'Office, Monday to Friday', 'Офис, понедельник–пятница')), href: '' }),
          ],
        }),
        B('spacer', { h: 16 }),
        B('embed', { att: pdf, display: 'card', player: 'object', dl: true, op: true, caption: L(T('პრეს-კიტი და ტექნიკური რაიდერი 2026/27', 'Press kit and technical rider 2026/27', 'Пресс-кит и технический райдер 2026/27')) }),
      ] },
      { id: K.id(), w: 58, blocks: [B('form', {
        variant: 'card',
        title: L(T('მოგვწერეთ', 'Write to us', 'Напишите нам')), submit: L(T('გაგზავნა', 'Send', 'Отправить')),
        req: rqInbox.id, fallback: 'mailto', to: 'booking@napertskali.example',
        success: L(T('გმადლობთ! მალე გიპასუხებთ.', 'Thank you! We will get back to you soon.', 'Спасибо! Скоро ответим.')),
        consent: L(T('ვეთანხმები, რომ ჩემი მონაცემები მხოლოდ ამ შეტყობინებაზე პასუხისთვის გამოიყენება.', 'I agree that my details are used only to answer this message.', 'Согласен(на), что мои данные используются только для ответа на это сообщение.')),
        items: [
          field('name', 'text', T('სახელი', 'Name', 'Имя'), { required: true, half: true }),
          field('email', 'email', T('ელფოსტა', 'E-mail', 'E-mail'), { required: true, half: true }),
          field('topic', 'select', T('თემა', 'Topic', 'Тема'), {
            options: T('ჯგუფური ბილეთები\nმოწვევა ფესტივალზე ან ღონისძიებაზე\nცეკვის სტუდია\nპრესა\nსხვა',
              'Group tickets\nInvitation to a festival or event\nDance studio\nPress\nSomething else',
              'Групповые билеты\nПриглашение на фестиваль или мероприятие\nСтудия танца\nПресса\nДругое'),
          }),
          field('message', 'textarea', T('შეტყობინება', 'Message', 'Сообщение'), { required: true }),
        ],
      })] },
    ],
  })]);

  d.regions.main = [hero, about, repertoire, tour, studio, gallery, troupe, press, faq, cta, contact];

  // ----- footer -----
  d.regions.footer = [B('footer', {
    variant: 'columns', logo: aLogo, logoH: 52,
    brand: T('ნაპერწკალი', 'Napertskali', 'Напертскали'),
    text: P('ქართული ხალხური ცეკვის ანსამბლი. თბილისი, 1998 წლიდან.', 'Georgian folk dance ensemble. Tbilisi, since 1998.', 'Ансамбль грузинского народного танца. Тбилиси, с 1998 года.'),
    items: [
      K.item({ title: L(T('ანსამბლი', 'Ensemble', 'Ансамбль')), html: L({
        ka: '<p><a href="#about">ჩვენ შესახებ</a><br><a href="#repertoire">რეპერტუარი</a><br><a href="#troupe">დასი</a></p>',
        en: '<p><a href="#about">About us</a><br><a href="#repertoire">Repertoire</a><br><a href="#troupe">The troupe</a></p>',
        ru: '<p><a href="#about">Об ансамбле</a><br><a href="#repertoire">Репертуар</a><br><a href="#troupe">Труппа</a></p>',
      }) }),
      K.item({ title: L(T('ბილეთები', 'Tickets', 'Билеты')), html: L({
        ka: '<p><a href="#tour">გასტროლები</a><br><a href="#studio">ცეკვის სტუდია</a><br><a href="#cart">კალათა</a></p>',
        en: '<p><a href="#tour">Tour dates</a><br><a href="#studio">Dance studio</a><br><a href="#cart">Cart</a></p>',
        ru: '<p><a href="#tour">Гастроли</a><br><a href="#studio">Студия танца</a><br><a href="#cart">Корзина</a></p>',
      }) }),
      K.item({ title: L(T('კონტაქტი', 'Contact', 'Контакты')), html: L({
        ka: '<p><a href="mailto:booking@napertskali.example">მოგვწერეთ</a><br><a href="tel:+995000000000">+995 000 00 00 00</a></p>',
        en: '<p><a href="mailto:booking@napertskali.example">Write to us</a><br><a href="tel:+995000000000">+995 000 00 00 00</a></p>',
        ru: '<p><a href="mailto:booking@napertskali.example">Написать нам</a><br><a href="tel:+995000000000">+995 000 00 00 00</a></p>',
      }) }),
    ],
    copy: T('© 2026 ანსამბლი „ნაპერწკალი“ · ყველა უფლება დაცულია', '© 2026 Napertskali ensemble · All rights reserved', '© 2026 Ансамбль «Напертскали» · Все права защищены'),
  })];
  return V.normalizeDoc(d);
}

const TPL_DANCE = {
  id: 'dance',
  name: { en: 'Dance ensemble', ru: 'Ансамбль танца', uk: 'Ансамбль танцю', de: 'Tanzensemble', fr: 'Ensemble de danse', es: 'Conjunto de danza', ka: 'ცეკვის ანსამბლი' },
  desc: {
    en: 'Georgian folk dance ensemble: repertoire with music sketches, tour dates with tickets, dance studio, gallery and booking form.',
    ru: 'Ансамбль грузинского танца: репертуар с музыкальными эскизами, гастроли с билетами, студия, галерея и форма заявки.',
    uk: 'Ансамбль грузинського танцю: репертуар з музичними ескізами, гастролі з квитками, студія, галерея та форма заявки.',
    de: 'Georgisches Volkstanzensemble: Repertoire mit Musikskizzen, Tourdaten mit Tickets, Tanzstudio, Galerie und Anfrageformular.',
    fr: 'Ensemble de danse géorgienne : répertoire avec esquisses musicales, tournée avec billets, studio, galerie et formulaire.',
    es: 'Conjunto de danza georgiana: repertorio con bocetos musicales, gira con entradas, estudio, galería y formulario de contacto.',
    ka: 'ქართული ხალხური ცეკვის ანსამბლი: რეპერტუარი მუსიკალური ესკიზებით, გასტროლები ბილეთებით, სტუდია, გალერეა და განაცხადის ფორმა.',
  },
  langs: ['ka', 'en', 'ru'],
  build: tplBuildDance,
};

export {
  TPL_DANCE,
  TPL_DANCE_PRESSKIT,
  tplBuildDance,
  tplDanceP,
  tplDanceT,
  tplDanceUl,
  TPL_DANCE_COVERS, TPL_DANCE_GALLERY, TPL_DANCE_PORTRAITS, TPL_DANCE_SKETCHES, TPL_DANCE_MODES, TPL_DANCE_SR, TPL_DANCE_VOICES,
  tplDanceBeat, tplDanceEnv, tplDanceHz, tplDanceLine, tplDanceLogoSVG, tplDancePortrait, tplDanceRange, tplDanceReverb, tplDanceRound,
  tplDanceTextureSVG, tplDanceWav, tplDanceWavB64,
  TPL_DANCE_POSES,
  tplDanceBraid,
  tplDanceCandle,
  tplDanceF,
  tplDanceF2,
  tplDanceFigDefs,
  tplDanceFigure,
  tplDanceFlame,
  tplDanceFrame,
  tplDanceHeroSVG,
  tplDanceKilimPat,
  tplDanceLimb,
  tplDanceLin,
  tplDancePath,
  tplDanceRad,
  tplDanceRidge,
  tplDanceRosette,
  tplDanceSparks,
  tplDanceStage,
  tplDanceStar,
  tplDanceStops,
  tplDanceSvg,
  tplDanceUse,
  tplDanceWhirl
};
