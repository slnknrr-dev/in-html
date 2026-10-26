// site-studio/templates-agro.js - template "agro": wholesale agricultural products, seasonality, farmers (ru, en, uk).
//
// Contract of a template module: each exported template object carries an id, localized names and build(V, ...) ->
// a fresh document; templates.js adds catalogue metadata (group, mode, modules) where the module does not declare it,
// and studio/gallery.js shows the catalogue.
// The viewer API arrives as the argument V instead of an import, so templates are pure document builders that tests
// (test.js renders every template) and the gallery can run without the editor. Generated artwork and sample data are
// derived from seeds (tplHash / tplRand where used), so a template builds the same document on every run.
// Data file: names, texts, figures and art specs dominate; comments mark sections, not individual values.
import { tplHash, tplRand } from '../sample/bytes.js';
import { escapeHTML } from '../html/escape.js';
import { tplKit } from './templates-kit.js';
// ===== Template: agro — fictional agricultural holding "Shiroky Lan" (ru / en / uk, theme preset 'harvest') =====
// Grain & oilseed farming, elevators, a sunflower oil plant, logistics and a cooperative program for small farmers.
// All companies, people, places, phone numbers, prices and certificates below are FICTIONAL.
// Artwork: deterministic procedural SVG (seeded by tplHash/tplRand), no fonts except monogram initials in partner marks.

const TPL_AGRO_INK = '#2a3a26';

/** Number → compact string with one decimal. */
function tplAgroN(n) {
  return String(Math.round(n * 10) / 10);
}

/** Catmull-Rom spline through points → cubic Bézier path data (open). */
function tplAgroSmooth(pts, closed = false) {
  const n = tplAgroN;
  const P = (i) => (closed ? pts[(i + pts.length) % pts.length] : pts[Math.max(0, Math.min(pts.length - 1, i))]);
  let d = 'M' + n(pts[0][0]) + ' ' + n(pts[0][1]);
  const last = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < last; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    d += 'C' + n(p1[0] + (p2[0] - p0[0]) / 6) + ' ' + n(p1[1] + (p2[1] - p0[1]) / 6) + ' ' +
      n(p2[0] - (p3[0] - p1[0]) / 6) + ' ' + n(p2[1] - (p3[1] - p1[1]) / 6) + ' ' + n(p2[0]) + ' ' + n(p2[1]);
  }
  return d + (closed ? 'Z' : '');
}

function tplAgroStops(stops) {
  return stops.map((s) => '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"' + (s[2] != null ? ' stop-opacity="' + s[2] + '"' : '') + '/>').join('');
}

/** Linear gradient (objectBoundingBox; vertical by default). */
function tplAgroLg(id, stops, x2 = 0, y2 = 1, x1 = 0, y1 = 0) {
  return '<linearGradient id="' + id + '" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '">' + tplAgroStops(stops) + '</linearGradient>';
}

/** Radial gradient (objectBoundingBox). */
function tplAgroRg(id, stops, cx = 0.5, cy = 0.5, r = 0.5) {
  return '<radialGradient id="' + id + '" cx="' + cx + '" cy="' + cy + '" r="' + r + '">' + tplAgroStops(stops) + '</radialGradient>';
}

/** Stripe pattern (user space) used for crop rows. */
function tplAgroStripes(id, size, angle, op = 0.1, color = '#000') {
  return '<pattern id="' + id + '" width="' + size + '" height="' + size + '" patternUnits="userSpaceOnUse" patternTransform="rotate(' + angle + ')">' +
    '<rect width="' + size + '" height="' + tplAgroN(size * 0.42) + '" fill="' + color + '" opacity="' + op + '"/></pattern>';
}

function tplAgroSvg(w, h, defs, body) {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '">' +
    (defs ? '<defs>' + defs + '</defs>' : '') + body + '</svg>';
}

function tplAgroUse(id, tr, extra = '') {
  return '<use href="#' + id + '" transform="' + tr + '"' + extra + '/>';
}

/** Rolling ridge: {pts, y(x), path(bottom)} from x = -20 to w + 20. */
function tplAgroRidge(rnd, w, base, amp, seg = 9) {
  const p1 = rnd() * 6.283, p2 = rnd() * 6.283, f1 = 1.1 + rnd() * 1.3, f2 = 2.6 + rnd() * 2.2;
  const y = (x) => {
    const t = (x + 20) / (w + 40);
    return base + amp * (0.68 * Math.sin(t * f1 * Math.PI + p1) + 0.32 * Math.sin(t * f2 * Math.PI + p2));
  };
  const pts = [];
  for (let i = 0; i <= seg; i++) {
    const x = -20 + (w + 40) * i / seg;
    pts.push([x, y(x)]);
  }
  const top = tplAgroSmooth(pts);
  return { pts, y, top, path: (bottom) => top + 'L' + (w + 20) + ' ' + bottom + 'L-20 ' + bottom + 'Z' };
}

/** Patchwork band of fields clipped to a hill shape. */
function tplAgroBand(rnd, id, ridge, w, bottom, colors, stripeIds) {
  const n = tplAgroN;
  const yTop = Math.min(...ridge.pts.map((p) => p[1])) - 12;
  let s = '<clipPath id="' + id + '"><path d="' + ridge.path(bottom) + '"/></clipPath><g clip-path="url(#' + id + ')">';
  const bounds = [];
  let x = -40;
  while (x < w + 60) {
    bounds.push([x, x + (rnd() - 0.5) * 220]);
    x += 150 + rnd() * 260;
  }
  bounds.push([x, x]);
  let prev = -1;
  for (let i = 0; i < bounds.length - 1; i++) {
    let c = Math.floor(rnd() * colors.length);
    if (c === prev) c = (c + 1) % colors.length;
    prev = c;
    const pts = n(bounds[i][0]) + ' ' + n(yTop) + ' ' + n(bounds[i + 1][0]) + ' ' + n(yTop) + ' ' +
      n(bounds[i + 1][1]) + ' ' + bottom + ' ' + n(bounds[i][1]) + ' ' + bottom;
    s += '<polygon points="' + pts + '" fill="' + colors[c] + '"/>';
    if (stripeIds.length && rnd() > 0.2) s += '<polygon points="' + pts + '" fill="url(#' + stripeIds[Math.floor(rnd() * stripeIds.length)] + ')"/>';
  }
  s += '<rect x="-20" y="' + n(yTop) + '" width="' + (w + 40) + '" height="' + n(bottom - yTop) + '" fill="url(#bandShade)"/>';
  s += '</g><path d="' + ridge.top + '" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="2"/>';
  return s;
}

/** Row of round trees along a ridge (shelter belts). */
function tplAgroTrees(rnd, ridge, x1, x2, size, fill) {
  let s = '<g fill="' + fill + '">';
  for (let x = x1; x < x2; x += size * (1.05 + rnd() * 0.5)) {
    const r = size * (0.75 + rnd() * 0.45);
    s += '<circle cx="' + tplAgroN(x) + '" cy="' + tplAgroN(ridge.y(x) - r * 0.55) + '" r="' + tplAgroN(r) + '"/>';
  }
  return s + '</g>';
}

/** One lonely tree, ground at (x, y). */
function tplAgroTree(x, y, s) {
  const n = tplAgroN;
  return '<g transform="translate(' + n(x) + ' ' + n(y) + ') scale(' + s + ')">' +
    '<path d="M-5 0L-3-46L3-46L5 0Z" fill="#5a3d24"/>' +
    '<circle cx="0" cy="-70" r="34" fill="url(#tree)"/><circle cx="-26" cy="-52" r="22" fill="url(#tree)"/>' +
    '<circle cx="26" cy="-54" r="24" fill="url(#tree)"/><circle cx="6" cy="-96" r="22" fill="url(#tree)"/></g>';
}

/** Soft cartoon cloud. */
function tplAgroCloud(x, y, s, op = 0.85) {
  return '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')" fill="#fff" opacity="' + op + '">' +
    '<circle cx="0" cy="0" r="36"/><circle cx="44" cy="-20" r="48"/><circle cx="98" cy="-6" r="38"/><circle cx="140" cy="8" r="26"/>' +
    '<rect x="-30" y="0" width="196" height="34" rx="17"/></g>';
}

/** Wheat (short awns) or barley (long awns) ear symbol: grows up from (0,0), ~150 high. Fill/color from the <use>. */
function tplAgroEarDef(id, awn = 22) {
  let s = '<path id="' + id + 'k" d="M0 0C-5.5-3.5-6.5-12.5 0-19C6.5-12.5 5.5-3.5 0 0Z"/>';
  s += '<g id="' + id + '"><path d="M0 0Q5-60 1-128" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>';
  let aw = '';
  for (let i = 0; i < 9; i++) {
    const y = -62 - i * 8.2, sc = (1 - i * 0.045).toFixed(2);
    s += tplAgroUse(id + 'k', 'translate(-1.5 ' + tplAgroN(y) + ') rotate(-24) scale(' + sc + ')');
    s += tplAgroUse(id + 'k', 'translate(1.5 ' + tplAgroN(y) + ') rotate(24) scale(' + sc + ')');
    if (awn) {
      const ty = y - 16 * Number(sc);
      aw += 'M' + tplAgroN(-8 * Number(sc)) + ' ' + tplAgroN(ty) + 'l' + tplAgroN(-awn * 0.22) + ' ' + tplAgroN(-awn) +
        'M' + tplAgroN(8 * Number(sc)) + ' ' + tplAgroN(ty) + 'l' + tplAgroN(awn * 0.22) + ' ' + tplAgroN(-awn);
    }
  }
  s += tplAgroUse(id + 'k', 'translate(0 -134) scale(.9)');
  if (awn) s += '<path d="' + aw + 'M0 -150l0 ' + tplAgroN(-awn) + '" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity=".85"/>';
  return s + '</g>';
}

/** Sunflower head symbol at unit radius 100 (petals + seed disk). */
function tplAgroSunDef(id, seeds = 0) {
  const pet = 'M0 -38C11 -52 13 -80 0 -100C-13 -80 -11 -52 0 -38Z';
  let s = '<path id="' + id + 'p" d="' + pet + '"/><g id="' + id + '"><g fill="#e79b06">';
  for (let i = 0; i < 18; i++) s += tplAgroUse(id + 'p', 'rotate(' + (i * 20 + 10) + ')');
  s += '</g><g fill="#fbbf16">';
  for (let i = 0; i < 18; i++) s += tplAgroUse(id + 'p', 'rotate(' + (i * 20) + ') scale(.92)');
  s += '</g><circle r="44" fill="url(#' + id + 'd)"/>';
  if (seeds) {
    s += '<g fill="#2b1a0e" opacity=".75">';
    for (let k = 1; k <= seeds; k++) {
      const r = 40 * Math.sqrt(k / seeds), a = k * 2.39996;
      s += '<circle cx="' + tplAgroN(r * Math.cos(a)) + '" cy="' + tplAgroN(r * Math.sin(a)) + '" r="' + tplAgroN(1.4 + 1.6 * (r / 40)) + '"/>';
    }
    s += '</g>';
  } else {
    s += '<g fill="none" stroke="#2b1a0e" stroke-opacity=".55" stroke-linecap="round" stroke-width="3" stroke-dasharray="1 6">' +
      '<circle r="36"/><circle r="27"/><circle r="18"/><circle r="9"/></g>';
  }
  s += '<circle r="44" fill="none" stroke="#6a3d12" stroke-width="3" opacity=".6"/></g>';
  s += tplAgroRg(id + 'd', [[0, '#8a5a24'], [0.6, '#5a3414'], [1, '#3a210c']], 0.42, 0.38, 0.62);
  return s;
}

/** Combine harvester symbol (ground at y = 0, facing left, ~360 long). */
function tplAgroCombineDef(id) {
  return '<g id="' + id + '">' +
    '<path d="M-188 -16L-110 -16L-104 -46L-184 -46Z" fill="#e3a514"/><path d="M-188 -16L-110 -16L-112 -8L-186 -8Z" fill="#8f6a10"/>' +
    '<circle cx="-150" cy="-62" r="27" fill="none" stroke="#c98a12" stroke-width="5"/>' +
    '<path d="M-150 -89V-35M-177 -62H-123M-169 -81L-131 -43M-169 -43L-131 -81" stroke="#c98a12" stroke-width="3"/>' +
    '<path d="M-112 -44L-50 -86L-40 -50L-108 -14Z" fill="#256b2f"/>' +
    '<rect x="-52" y="-120" width="210" height="90" rx="12" fill="#2e7d3a"/>' +
    '<rect x="-52" y="-74" width="210" height="9" fill="#f2b523"/>' +
    '<rect x="18" y="-152" width="110" height="38" rx="8" fill="#286f33"/>' +
    '<rect x="96" y="-168" width="7" height="22" fill="#3b3b3b"/>' +
    '<rect x="118" y="-158" width="128" height="9" rx="4" fill="#256b2f" transform="rotate(-9 118 -154)"/>' +
    '<path d="M158 -110L186 -98L186 -52L158 -46Z" fill="#256b2f"/>' +
    '<rect x="-60" y="-186" width="66" height="70" rx="9" fill="#2e7d3a"/>' +
    '<rect x="-53" y="-179" width="52" height="40" rx="6" fill="#cdeaf4"/><path d="M-50 -142L-22 -176L-12 -176L-40 -142Z" fill="#fff" opacity=".55"/>' +
    '<rect x="-64" y="-190" width="74" height="9" rx="4" fill="#f2b523"/>' +
    '<circle cx="-16" cy="-36" r="38" fill="#262a24"/><circle cx="-16" cy="-36" r="17" fill="#f2b523"/><circle cx="-16" cy="-36" r="6" fill="#262a24"/>' +
    '<circle cx="130" cy="-25" r="26" fill="#262a24"/><circle cx="130" cy="-25" r="11" fill="#f2b523"/>' +
    '</g>';
}

/** Grain elevator complex (ground at y = 0); silos to the right of the head house. */
function tplAgroElevator(x, y, s, o = {}) {
  const n = o.silos || 4, body = o.body || 'url(#silo)', roof = o.roof || '#c8bda8', win = o.win || '#7fa9bf';
  let g = '<g transform="translate(' + tplAgroN(x) + ' ' + tplAgroN(y) + ') scale(' + s + ')">';
  g += '<rect x="-24" y="-8" width="' + (60 + n * 46) + '" height="10" fill="' + roof + '"/>';
  for (let i = 0; i < n; i++) {
    const sx = 30 + i * 46;
    g += '<rect x="' + sx + '" y="-160" width="42" height="160" fill="' + body + '"/>' +
      '<ellipse cx="' + (sx + 21) + '" cy="-160" rx="21" ry="6" fill="' + roof + '"/>';
  }
  g += '<rect x="22" y="-196" width="' + (n * 46 + 10) + '" height="14" fill="' + roof + '"/>';
  g += '<path d="M' + (30 + n * 23) + ' -182v-14" stroke="' + roof + '" stroke-width="4"/>';
  g += '<rect x="-14" y="-262" width="40" height="262" fill="' + body + '"/><rect x="-20" y="-282" width="52" height="24" rx="3" fill="' + roof + '"/>';
  g += '<rect x="-6" y="-300" width="24" height="20" fill="' + roof + '"/>';
  g += '<g fill="' + win + '">';
  for (let i = 0; i < 6; i++) g += '<rect x="0" y="' + (-246 + i * 34) + '" width="12" height="14" rx="2"/>';
  g += '</g>';
  if (o.flag) g += '<path d="M6 -300v-34" stroke="#555" stroke-width="2"/><path d="M6 -334h22l-6 7 6 7h-22Z" fill="' + o.flag + '"/>';
  return g + '</g>';
}

/** Hopper rail car (left end at x, rails at y). */
function tplAgroHopper(x, y, s, body = '#2e7d3a', stripe = '#f2b523') {
  return '<g transform="translate(' + tplAgroN(x) + ' ' + tplAgroN(y) + ') scale(' + s + ')">' +
    '<path d="M6 -96H170L160 -34H16Z" fill="' + body + '"/><path d="M8 -84H168L166 -72H10Z" fill="' + stripe + '"/>' +
    '<path d="M30 -34L50 -14H70L90 -34ZM96 -34L116 -14H136L156 -34Z" fill="#2c3a2a"/>' +
    '<rect x="0" y="-36" width="176" height="6" fill="#2c3a2a"/>' +
    '<g fill="#262a24"><circle cx="28" cy="-10" r="10"/><circle cx="50" cy="-10" r="10"/><circle cx="128" cy="-10" r="10"/><circle cx="150" cy="-10" r="10"/></g></g>';
}

/** Grain truck (ground at y = 0, facing left). */
function tplAgroTruck(x, y, s, body = '#f2b523') {
  return '<g transform="translate(' + tplAgroN(x) + ' ' + tplAgroN(y) + ') scale(' + s + ')">' +
    '<path d="M-10 -110H180L172 -40H-2Z" fill="' + body + '"/><path d="M-10 -110H180V-100H-10Z" fill="#000" opacity=".15"/>' +
    '<path d="M-74 -40V-92Q-74 -100 -66 -100H-26L-10 -70V-40Z" fill="#2e7d3a"/><path d="M-66 -94H-32L-20 -72H-66Z" fill="#cdeaf4"/>' +
    '<rect x="-80" y="-44" width="262" height="12" fill="#3a3a36"/>' +
    '<g fill="#262a24"><circle cx="-48" cy="-22" r="20"/><circle cx="110" cy="-22" r="20"/><circle cx="152" cy="-22" r="20"/></g>' +
    '<g fill="#bbb"><circle cx="-48" cy="-22" r="7"/><circle cx="110" cy="-22" r="7"/><circle cx="152" cy="-22" r="7"/></g></g>';
}

/** Common defs for landscapes. */
function tplAgroLandDefs() {
  return tplAgroRg('tree', [[0, '#7fb35f'], [0.7, '#3f7a3a'], [1, '#2f5f2f']], 0.35, 0.3, 0.75) +
    tplAgroLg('silo', [[0, '#cfc3ad'], [0.32, '#f7f2e7'], [0.7, '#e2d9c6'], [1, '#b3a48a']], 1, 0) +
    tplAgroLg('bandShade', [[0, '#fff', 0.1], [0.5, '#fff', 0], [1, '#000', 0.14]]) +
    tplAgroStripes('s1', 12, -8, 0.09) + tplAgroStripes('s2', 14, 18, 0.1) + tplAgroStripes('s3', 18, -22, 0.1) +
    tplAgroStripes('s4', 24, 4, 0.12);
}

/** Sky rays from the sun. */
function tplAgroRays(cx, cy, n, len, rnd, op = 0.07) {
  let s = '<g fill="#fff" opacity="' + op + '">';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.2, b = a + 0.06 + rnd() * 0.05;
    s += '<path d="M' + cx + ' ' + cy + 'L' + tplAgroN(cx + Math.cos(a) * len) + ' ' + tplAgroN(cy + Math.sin(a) * len) +
      'L' + tplAgroN(cx + Math.cos(b) * len) + ' ' + tplAgroN(cy + Math.sin(b) * len) + 'Z"/>';
  }
  return s + '</g>';
}

/** Hero: wide field panorama at morning light, combine at work, elevator on the horizon. 1600×900. */
function tplAgroHero() {
  const W = 1600, H = 900, rnd = tplRand(tplHash('agro:hero'));
  const n = tplAgroN;
  let defs = tplAgroLandDefs() + tplAgroEarDef('ear', 20) + tplAgroCombineDef('cmb') +
    tplAgroLg('sky', [[0, '#2f7cab'], [0.36, '#86c4e0'], [0.58, '#dcefe6'], [0.72, '#fff0c2']]) +
    tplAgroRg('glow', [[0, '#fff8d8', 0.95], [0.3, '#ffe7a3', 0.45], [1, '#ffe7a3', 0]], 0.74, 0.4, 0.5) +
    tplAgroLg('gold', [[0, '#f4cf68'], [0.5, '#e9b546'], [1, '#c9871f']]) +
    tplAgroLg('vig', [[0, '#0d2617', 0.5], [0.46, '#0d2617', 0.06], [0.6, '#0d2617', 0]], 1, 0);
  let s = '<rect width="' + W + '" height="' + H + '" fill="url(#sky)"/>';
  s += tplAgroRays(1190, 360, 14, 1400, rnd, 0.06);
  s += '<rect width="' + W + '" height="' + H + '" fill="url(#glow)"/>';
  s += '<circle cx="1190" cy="360" r="96" fill="#fff6d6" opacity=".35"/><circle cx="1190" cy="360" r="62" fill="#fff4cf"/>';
  s += tplAgroCloud(170, 150, 1.15, 0.8) + tplAgroCloud(700, 92, 0.8, 0.66) + tplAgroCloud(1380, 170, 0.95, 0.75) + tplAgroCloud(980, 236, 0.5, 0.6);
  s += '<path d="M1030 250q9-8 18 0q9-8 18 0M1080 220q7-6 14 0q7-6 14 0M995 286q6-5 12 0q6-5 12 0" fill="none" stroke="#2d4a5a" stroke-opacity=".5" stroke-width="3" stroke-linecap="round"/>';
  const A = tplAgroRidge(rnd, W, 486, 20);
  s += '<path d="' + A.path(H) + '" fill="#a7cfa6"/>';
  s += tplAgroTrees(rnd, A, 120, 560, 8, '#7fae80') + tplAgroElevator(1300, A.y(1330) + 6, 0.42, { silos: 5, flag: '#2e7d3a' });
  const Bq = tplAgroRidge(rnd, W, 548, 26);
  s += tplAgroBand(rnd, 'cb', Bq, W, H, ['#9cc96e', '#e9c766', '#7fb85a', '#c9a06a', '#b6d77f'], ['s1', 's2']);
  s += tplAgroTrees(rnd, Bq, 40, 470, 11, 'url(#tree)') + tplAgroTrees(rnd, Bq, 860, 1180, 11, 'url(#tree)');
  const C = tplAgroRidge(rnd, W, 640, 34);
  s += tplAgroBand(rnd, 'cc', C, W, H, ['#6fae4d', '#f0c75e', '#5f9e45', '#e3ae42', '#a8774a', '#8cc461'], ['s2', 's3']);
  s += tplAgroTree(560, C.y(560) + 4, 1.05) + tplAgroTree(1460, C.y(1460) + 4, 0.8);
  const D = tplAgroRidge(rnd, W, 770, 30, 7);
  s += '<clipPath id="cd"><path d="' + D.path(H) + '"/></clipPath><g clip-path="url(#cd)"><rect y="700" width="' + W + '" height="200" fill="url(#gold)"/>';
  s += '<path d="M1060 700L1700 700L1700 900L1180 900Z" fill="#f6dd96" opacity=".75"/>';
  let rows = '';
  for (let k = 1; k < 9; k++) {
    const off = k * k * 2.6 + k * 6;
    rows += '<path d="' + tplAgroSmooth(D.pts.map((p) => [p[0], p[1] + off])) + '"/>';
  }
  s += '<g fill="none" stroke="#a86e17" stroke-opacity=".35" stroke-width="3">' + rows + '</g></g>';
  s += '<path d="' + D.top + '" fill="none" stroke="#fff3c4" stroke-opacity=".6" stroke-width="3"/>';
  const cy = D.y(1060) + 70;
  s += '<g fill="#f6e2a6" opacity=".55"><ellipse cx="1300" cy="' + n(cy - 60) + '" rx="120" ry="44"/><ellipse cx="1390" cy="' + n(cy - 90) + '" rx="80" ry="30"/></g>';
  s += '<ellipse cx="1070" cy="' + n(cy + 2) + '" rx="210" ry="14" fill="#7a4f15" opacity=".3"/>';
  s += tplAgroUse('cmb', 'translate(1080 ' + n(cy) + ') scale(1.05)');
  let ears = '';
  const earAt = (x, sc, rot, fill) => tplAgroUse('ear', 'translate(' + n(x) + ' ' + (H + 30) + ') rotate(' + n(rot) + ') scale(' + sc.toFixed(2) + ')', ' fill="' + fill + '" color="' + fill + '"');
  for (let i = 0; i < 11; i++) {
    const x = 1400 + i * 19 + rnd() * 14;
    ears += earAt(x, 1.0 + rnd() * 0.75, (rnd() - 0.35) * 24, i % 3 ? '#e2ac3f' : '#c98a22');
  }
  for (let i = 0; i < 6; i++) ears += earAt(8 + i * 26 + rnd() * 12, 0.85 + rnd() * 0.5, (rnd() - 0.6) * 22, i % 2 ? '#d99a2b' : '#ecbd55');
  s += ears;
  s += '<rect width="' + W + '" height="' + H + '" fill="url(#vig)"/>';
  return tplAgroSvg(W, H, defs, s);
}

/** CTA background: wheat ears against a summer dusk. 1600×700. */
function tplAgroDusk() {
  const W = 1600, H = 700, rnd = tplRand(tplHash('agro:dusk'));
  const defs = tplAgroEarDef('ear', 26) +
    tplAgroLg('sky', [[0, '#2a4a70'], [0.45, '#b9705a'], [0.75, '#f3ae5c'], [1, '#ffd98c']]) +
    tplAgroRg('glow', [[0, '#fff1c4', 0.95], [0.35, '#ffd27e', 0.5], [1, '#ffd27e', 0]], 0.72, 0.78, 0.45);
  let s = '<rect width="' + W + '" height="' + H + '" fill="url(#sky)"/><rect width="' + W + '" height="' + H + '" fill="url(#glow)"/>';
  s += '<circle cx="1150" cy="540" r="96" fill="#ffe7a8"/>';
  s += '<g fill="#fff" opacity=".22"><ellipse cx="300" cy="160" rx="210" ry="18"/><ellipse cx="420" cy="196" rx="150" ry="12"/><ellipse cx="1300" cy="250" rx="240" ry="16"/></g>';
  const A = tplAgroRidge(rnd, W, 560, 16);
  s += '<path d="' + A.path(H) + '" fill="#6b4a2c" opacity=".75"/>';
  s += tplAgroTrees(rnd, A, 60, 700, 9, '#4a3420');
  const B = tplAgroRidge(rnd, W, 618, 14);
  s += '<path d="' + B.path(H) + '" fill="#3c2a17"/>';
  let ears = '';
  for (let i = 0; i < 46; i++) {
    const x = i * 36 + rnd() * 24 - 10, sc = 0.9 + rnd() * 1.1, lit = rnd() > 0.72;
    const f = lit ? '#9a6a2a' : '#2c1e10';
    ears += tplAgroUse('ear', 'translate(' + tplAgroN(x) + ' ' + (H + 40) + ') rotate(' + tplAgroN((rnd() - 0.5) * 22) + ') scale(' + sc.toFixed(2) + ')', ' fill="' + f + '" color="' + f + '"');
  }
  s += ears;
  return tplAgroSvg(W, H, defs, s);
}

/** Closed wobbly loop (contour line). */
function tplAgroLoop(cx, cy, r, ph, k = 0.14) {
  const pts = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const rr = r * (1 + k * Math.sin(3 * a + ph) + k * 0.5 * Math.sin(5 * a + ph * 1.7));
    pts.push([cx + Math.cos(a) * rr * 1.35, cy + Math.sin(a) * rr]);
  }
  return tplAgroSmooth(pts, true);
}

/** Dark topographic texture for the key-figures band. 1600×600. */
function tplAgroTopo() {
  const W = 1600, H = 600, rnd = tplRand(tplHash('agro:topo'));
  const defs = tplAgroLg('bg', [[0, '#1d3a24'], [1, '#2e3018']], 1, 1) +
    '<pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse"><path d="M40 34v12M34 40h12" stroke="#d9efc4" stroke-opacity=".12" stroke-width="1.5"/></pattern>';
  let s = '<rect width="' + W + '" height="' + H + '" fill="url(#bg)"/><rect width="' + W + '" height="' + H + '" fill="url(#grid)"/>';
  s += '<g fill="none" stroke="#b9e09a" stroke-opacity=".16" stroke-width="1.6">';
  [[260, 140], [980, 420], [1460, 90]].forEach((c, j) => {
    const ph = rnd() * 6;
    for (let k = 1; k <= 8; k++) s += '<path d="' + tplAgroLoop(c[0], c[1], 26 + k * 34, ph + k * 0.18) + '"/>';
    if (j === 1) s += '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="5" fill="#f2b523" fill-opacity=".5" stroke="none"/>';
  });
  s += '</g><path d="M0 520C220 470 380 560 620 500S1060 380 1280 430S1520 400 1600 380" fill="none" stroke="#f2b523" stroke-opacity=".22" stroke-width="3" stroke-dasharray="2 10" stroke-linecap="round"/>';
  return tplAgroSvg(W, H, defs, s);
}

/** Brand mark: sun over field rows in a rounded square. 120×120. */
function tplAgroBrand() {
  const defs = tplAgroLg('b', [[0, '#3f9a4a'], [1, '#1f6a2c']], 1, 1);
  const s = '<rect width="120" height="120" rx="30" fill="url(#b)"/>' +
    '<circle cx="60" cy="58" r="22" fill="#f6c232"/>' +
    '<path d="M14 74C40 62 80 62 106 74V96Q106 106 96 106H24Q14 106 14 96Z" fill="#2a7a35"/>' +
    '<path d="M14 74C40 62 80 62 106 74" fill="none" stroke="#f6c232" stroke-width="5" stroke-linecap="round"/>' +
    '<path d="M26 88C46 80 74 80 94 88M36 100C52 95 68 95 84 100" fill="none" stroke="#f6c232" stroke-opacity=".75" stroke-width="4" stroke-linecap="round"/>';
  return tplAgroSvg(120, 120, defs, s);
}

// ----- Product shots (800×800 studio compositions) -----

/** Grain pattern tile: three kernels on a darker gap. */
function tplAgroGrainPat(id, c1, c2, c3, rx = 9, ry = 5) {
  const k = (cx, cy, a, f) => '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" transform="rotate(' + a + ' ' + cx + ' ' + cy + ')" fill="' + f + '"/>';
  return '<pattern id="' + id + '" width="40" height="28" patternUnits="userSpaceOnUse"><rect width="40" height="28" fill="' + c3 + '"/>' +
    k(10, 7, -22, c1) + k(30, 7, 28, c2) + k(20, 21, -4, c1) + k(0, 21, 30, c2) + k(40, 21, 30, c2) +
    '<path d="M6 6l8 2M26 8l8-3M16 21h8" stroke="' + c3 + '" stroke-opacity=".5" stroke-width="1.2"/></pattern>';
}

/** Mound path (dome) centered at cx with base y. */
function tplAgroMound(cx, by, w, h) {
  const n = tplAgroN, l = cx - w / 2, r = cx + w / 2;
  return 'M' + n(l) + ' ' + by + 'C' + n(l + w * 0.12) + ' ' + n(by - h * 0.55) + ' ' + n(cx - w * 0.22) + ' ' + n(by - h) + ' ' + n(cx) + ' ' + n(by - h) +
    'C' + n(cx + w * 0.22) + ' ' + n(by - h) + ' ' + n(r - w * 0.12) + ' ' + n(by - h * 0.55) + ' ' + n(r) + ' ' + by +
    'Q' + n(cx) + ' ' + n(by + h * 0.16) + ' ' + n(l) + ' ' + by + 'Z';
}

/** Loose kernels scattered on the table. */
function tplAgroLoose(rnd, n, x1, x2, y1, y2, fill, rx = 9, ry = 5) {
  let s = '<g fill="' + fill + '">';
  for (let i = 0; i < n; i++) {
    const x = x1 + rnd() * (x2 - x1), y = y1 + rnd() * (y2 - y1), a = Math.round(rnd() * 180);
    s += '<ellipse cx="' + tplAgroN(x) + '" cy="' + tplAgroN(y) + '" rx="' + rx + '" ry="' + ry + '" transform="rotate(' + a + ' ' + tplAgroN(x) + ' ' + tplAgroN(y) + ')"/>';
  }
  return s + '</g>';
}

/** Open burlap sack filled with `fill` (pattern url). */
function tplAgroSack(fill, cx = 400) {
  const n = tplAgroN, o = cx - 400;
  const X = (x) => n(x + o);
  return '<path d="M' + X(252) + ' 336C' + X(222) + ' 430 ' + X(206) + ' 540 ' + X(236) + ' 626C' + X(250) + ' 664 ' + X(550) + ' 664 ' + X(564) + ' 626C' + X(594) + ' 540 ' + X(578) + ' 430 ' + X(548) + ' 336Z" fill="#c9a46a"/>' +
    '<path d="M' + X(252) + ' 336C' + X(222) + ' 430 ' + X(206) + ' 540 ' + X(236) + ' 626C' + X(250) + ' 664 ' + X(550) + ' 664 ' + X(564) + ' 626C' + X(594) + ' 540 ' + X(578) + ' 430 ' + X(548) + ' 336Z" fill="url(#jute)"/>' +
    '<path d="M' + X(252) + ' 336C' + X(222) + ' 430 ' + X(206) + ' 540 ' + X(236) + ' 626C' + X(250) + ' 664 ' + X(550) + ' 664 ' + X(564) + ' 626C' + X(594) + ' 540 ' + X(578) + ' 430 ' + X(548) + ' 336Z" fill="url(#sackShade)"/>' +
    '<path d="' + tplAgroMound(400 + o, 338, 300, 74) + '" fill="' + fill + '"/>' +
    '<path d="' + tplAgroMound(400 + o, 338, 300, 74) + '" fill="url(#moundShade)"/>' +
    '<path d="M' + X(236) + ' 332C' + X(300) + ' 310 ' + X(500) + ' 310 ' + X(564) + ' 332L' + X(572) + ' 372C' + X(500) + ' 352 ' + X(300) + ' 352 ' + X(228) + ' 372Z" fill="#b48a4f"/>' +
    '<path d="M' + X(236) + ' 332C' + X(300) + ' 310 ' + X(500) + ' 310 ' + X(564) + ' 332L' + X(572) + ' 372C' + X(500) + ' 352 ' + X(300) + ' 352 ' + X(228) + ' 372Z" fill="url(#jute)"/>' +
    '<path d="M' + X(300) + ' 470C' + X(330) + ' 520 ' + X(318) + ' 590 ' + X(300) + ' 630M' + X(470) + ' 380C' + X(500) + ' 460 ' + X(520) + ' 540 ' + X(508) + ' 640" fill="none" stroke="#8f6a3a" stroke-opacity=".35" stroke-width="5" stroke-linecap="round"/>';
}

/** Product shot by kind: wheat, barley, corn, sunseed, oil-crude, oil-refined, soymeal, pellets. */
function tplAgroProduct(kind) {
  const rnd = tplRand(tplHash('agro:product:' + kind));
  const n = tplAgroN;
  const tints = { wheat: '#f6d98a', barley: '#efe2a8', corn: '#f8d27a', sunseed: '#cfe3a8', 'oil-crude': '#f4c27a', 'oil-refined': '#f9e49a', soymeal: '#e6dcb0', pellets: '#e2cfa4' };
  let defs = tplAgroLg('bg', [[0, '#fdf9ee'], [1, '#f2e7cc']]) +
    tplAgroRg('halo', [[0, tints[kind] || '#f6d98a', 0.95], [0.7, tints[kind] || '#f6d98a', 0.35], [1, tints[kind] || '#f6d98a', 0]]) +
    tplAgroLg('table', [[0, '#e9d6a8'], [1, '#d9bf86']]) +
    tplAgroRg('moundShade', [[0, '#fff', 0.28], [0.55, '#fff', 0], [1, '#000', 0.22]], 0.36, 0.2, 0.75) +
    tplAgroLg('sackShade', [[0, '#000', 0.26], [0.3, '#000', 0], [0.6, '#fff', 0.06], [1, '#000', 0.3]], 1, 0) +
    '<pattern id="jute" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 2h8M0 6h8" stroke="#7a5a2c" stroke-opacity=".22" stroke-width="1.4"/><path d="M2 0v8M6 0v8" stroke="#fff" stroke-opacity=".12" stroke-width="1.2"/></pattern>';
  let s = '<rect width="800" height="800" fill="url(#bg)"/>' +
    '<circle cx="400" cy="360" r="300" fill="url(#halo)"/>' +
    '<g fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2"><circle cx="400" cy="360" r="238"/><circle cx="400" cy="360" r="286" stroke-dasharray="3 9"/></g>' +
    '<path d="M0 600C200 580 600 580 800 600V800H0Z" fill="url(#table)"/>' +
    '<path d="M0 600C200 580 600 580 800 600" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="2"/>' +
    '<ellipse cx="400" cy="650" rx="250" ry="30" fill="#5a3d1a" opacity=".16"/>';
  if (kind === 'wheat' || kind === 'barley') {
    const isB = kind === 'barley';
    const c = isB ? ['#ecd38c', '#e1c274', '#b8974c'] : ['#e2aa48', '#d39a36', '#9d6a1e'];
    defs += tplAgroGrainPat('gp', c[0], c[1], c[2], isB ? 10 : 9, isB ? 4.4 : 5.2) + tplAgroEarDef('ear', isB ? 70 : 22);
    const ef = isB ? '#e6c878' : '#dca844', ec = isB ? '#b89a50' : '#a8781e';
    const ear = (tr) => tplAgroUse('ear', tr, ' fill="' + ef + '" color="' + ec + '"');
    s += ear('translate(500 360) rotate(16) scale(1.75)') + ear('translate(470 350) rotate(4) scale(1.95)') + ear('translate(330 352) rotate(-14) scale(1.7)');
    s += tplAgroSack('url(#gp)');
    s += '<path d="' + tplAgroMound(560, 668, 220, 46) + '" fill="url(#gp)"/><path d="' + tplAgroMound(560, 668, 220, 46) + '" fill="url(#moundShade)"/>';
    s += tplAgroLoose(rnd, 16, 200, 700, 668, 720, c[1], isB ? 10 : 9, isB ? 4.4 : 5.2);
    s += ear('translate(372 712) rotate(-84) scale(1.45)');
  } else if (kind === 'corn') {
    defs += '<pattern id="ck" width="16" height="13" patternUnits="userSpaceOnUse"><rect width="16" height="13" fill="#c98112"/><rect x="1" y="1" width="14" height="11" rx="5" fill="#f5b52e"/><rect x="3" y="2.5" width="6" height="3" rx="1.5" fill="#fff" opacity=".35"/></pattern>' +
      tplAgroLg('cobShade', [[0, '#000', 0.32], [0.35, '#000', 0], [0.6, '#fff', 0.15], [1, '#000', 0.35]], 1, 0) +
      tplAgroGrainPat('gp', '#f3b02a', '#e89d18', '#b8720c', 8, 6);
    const cob = (tr) => '<g transform="' + tr + '">' +
      '<path d="M-14 40C-70 20 -96 -40 -60 -60C-40 -20 -20 10 0 20Z" fill="#9bbf62"/><path d="M14 40C70 20 96 -40 60 -60C40 -20 20 10 0 20Z" fill="#b5cf7a"/>' +
      '<path d="M0 30C-44 30 -50 -60 -40 -170C-34 -240 -14 -280 0 -284C14 -280 34 -240 40 -170C50 -60 44 30 0 30Z" fill="url(#ck)"/>' +
      '<path d="M0 30C-44 30 -50 -60 -40 -170C-34 -240 -14 -280 0 -284C14 -280 34 -240 40 -170C50 -60 44 30 0 30Z" fill="url(#cobShade)"/>' +
      '<path d="M-16 50C-60 0 -70 -90 -46 -150C-30 -80 -14 -10 0 30Z" fill="#d9d08a"/><path d="M16 50C64 10 76 -80 52 -140C34 -70 18 -10 0 30Z" fill="#c8c27a"/>' +
      '<path d="M-4 -280c-10-20-6-40 4-56M2 -282c6-20 18-32 30-38" fill="none" stroke="#9a6a2a" stroke-width="3" stroke-linecap="round"/></g>';
    s += cob('translate(330 600) rotate(-24) scale(1.12)') + cob('translate(470 610) rotate(20) scale(1.02)');
    s += '<path d="' + tplAgroMound(400, 676, 330, 60) + '" fill="url(#gp)"/><path d="' + tplAgroMound(400, 676, 330, 60) + '" fill="url(#moundShade)"/>';
    s += tplAgroLoose(rnd, 18, 170, 640, 676, 724, '#eea820', 8, 6);
  } else if (kind === 'sunseed') {
    defs += tplAgroSunDef('sf', 120) +
      '<pattern id="sd" width="36" height="30" patternUnits="userSpaceOnUse"><rect width="36" height="30" fill="#1f1b18"/>' +
      '<g fill="#3b3631"><ellipse cx="9" cy="8" rx="9" ry="5" transform="rotate(-30 9 8)"/><ellipse cx="27" cy="8" rx="9" ry="5" transform="rotate(35 27 8)"/><ellipse cx="18" cy="22" rx="9" ry="5" transform="rotate(-8 18 22)"/></g>' +
      '<path d="M3 11l12-6M21 4l12 8M10 22h16" stroke="#d8d0bf" stroke-opacity=".7" stroke-width="1.3"/></pattern>';
    s += '<path d="M410 330C430 420 420 520 400 640" fill="none" stroke="#5f8f3a" stroke-width="16" stroke-linecap="round"/>' +
      '<path d="M412 470C470 430 560 440 600 480C540 500 470 500 412 470Z" fill="#6aa33f"/><path d="M406 520C350 480 260 490 220 530C280 548 350 548 406 520Z" fill="#5a9334"/>';
    s += tplAgroUse('sf', 'translate(400 300) rotate(-8) scale(1.85 1.7)');
    s += '<path d="' + tplAgroMound(420, 680, 400, 70) + '" fill="url(#sd)"/><path d="' + tplAgroMound(420, 680, 400, 70) + '" fill="url(#moundShade)"/>';
    s += '<g>' + tplAgroLoose(rnd, 14, 160, 680, 680, 728, '#2a2622', 10, 5.5) + '</g>';
  } else if (kind === 'oil-crude' || kind === 'oil-refined') {
    const crude = kind === 'oil-crude';
    defs += tplAgroLg('oil', crude ? [[0, '#e9a53a'], [1, '#b8661a']] : [[0, '#fbe68e'], [1, '#efc23c']]) +
      tplAgroLg('glass', [[0, '#fff', 0.5], [0.25, '#fff', 0.08], [0.8, '#fff', 0.02], [1, '#fff', 0.35]], 1, 0) +
      tplAgroSunDef('sf', 0) + '<clipPath id="bt"><path id="btp" d="M377 170L377 232C377 270 306 290 306 342L306 612Q306 642 336 642L464 642Q494 642 494 612L494 342C494 290 423 270 423 232L423 170Z"/></clipPath>';
    if (crude) {
      s += tplAgroUse('sf', 'translate(590 270) rotate(14) scale(1.05)') + tplAgroUse('sf', 'translate(210 330) rotate(-20) scale(.7)');
    } else {
      s += tplAgroUse('sf', 'translate(250 250) rotate(-12) scale(1.35)');
    }
    s += '<g clip-path="url(#bt)"><rect x="300" y="160" width="200" height="500" fill="#fff" opacity=".35"/>' +
      '<rect x="300" y="' + (crude ? 300 : 280) + '" width="200" height="380" fill="url(#oil)"/>' +
      '<ellipse cx="400" cy="' + (crude ? 300 : 280) + '" rx="60" ry="6" fill="#fff" opacity=".4"/></g>' +
      '<use href="#btp" fill="url(#glass)" stroke="#fff" stroke-opacity=".8" stroke-width="3"/>' +
      '<rect x="326" y="352" width="12" height="250" rx="6" fill="#fff" opacity=".55"/>' +
      '<rect x="370" y="134" width="60" height="44" rx="8" fill="#2e7d3a"/><rect x="366" y="168" width="68" height="10" rx="4" fill="#256b2f"/>' +
      '<rect x="306" y="430" width="188" height="118" fill="' + (crude ? '#f8efda' : '#fffaf0') + '"/>' +
      '<rect x="306" y="430" width="188" height="8" fill="#2e7d3a"/><rect x="306" y="540" width="188" height="8" fill="#2e7d3a"/>' +
      tplAgroUse('sf', 'translate(400 478) scale(.26)') + '<rect x="352" y="516" width="96" height="7" rx="3.5" fill="#2e7d3a" opacity=".55"/>';
    s += '<path d="M600 560C600 590 640 590 640 560C640 540 620 520 620 504C620 520 600 540 600 560Z" fill="url(#oil)"/>';
    if (crude) s += tplAgroLoose(rnd, 12, 180, 640, 660, 716, '#2a2622', 10, 5.5);
    else s += '<path d="M190 640C200 670 230 680 270 676" fill="none" stroke="#efc23c" stroke-width="10" stroke-linecap="round" opacity=".8"/>';
  } else if (kind === 'soymeal') {
    defs += '<pattern id="ml" width="30" height="24" patternUnits="userSpaceOnUse"><rect width="30" height="24" fill="#cdb67c"/>' +
      '<g fill="#e5d39e"><circle cx="5" cy="5" r="4"/><circle cx="17" cy="9" r="5"/><circle cx="26" cy="3" r="3"/><circle cx="9" cy="17" r="5"/><circle cx="23" cy="19" r="4"/></g>' +
      '<g fill="#a88e52"><circle cx="13" cy="2" r="1.6"/><circle cx="3" cy="12" r="1.4"/><circle cx="27" cy="12" r="1.8"/><circle cx="17" cy="22" r="1.4"/></g></pattern>';
    s += tplAgroSack('url(#ml)', 380);
    const pod = (tr) => '<g transform="' + tr + '"><path d="M0 0C20 -14 46 -14 62 0C78 -14 104 -14 124 0C140 -12 166 -10 176 6C156 30 120 34 96 22C74 36 40 36 22 22C10 26 -4 18 0 0Z" fill="#a9ad5c"/>' +
      '<path d="M8 6C40 14 120 16 170 8" fill="none" stroke="#7b8040" stroke-width="3" opacity=".6"/><path d="M176 6l20-6" stroke="#7b8040" stroke-width="4" stroke-linecap="round"/></g>';
    s += pod('translate(500 660) rotate(-12)') + pod('translate(540 700) rotate(6) scale(.9)');
    s += '<g fill="#ead49a" stroke="#c9ad6a" stroke-width="2"><circle cx="210" cy="690" r="13"/><circle cx="240" cy="706" r="12"/><circle cx="186" cy="714" r="12"/><circle cx="660" cy="640" r="12"/></g>';
  } else if (kind === 'pellets') {
    defs += '<pattern id="pl" width="44" height="30" patternUnits="userSpaceOnUse"><rect width="44" height="30" fill="#6b4a26"/>' +
      '<g fill="#a07a46"><rect x="2" y="3" width="20" height="9" rx="4.5" transform="rotate(-18 12 7)"/><rect x="22" y="6" width="20" height="9" rx="4.5" transform="rotate(24 32 10)"/>' +
      '<rect x="10" y="17" width="22" height="9" rx="4.5" transform="rotate(-6 21 21)"/></g>' +
      '<g fill="#c9a26a"><rect x="4" y="4" width="8" height="3" rx="1.5" transform="rotate(-18 12 7)"/><rect x="12" y="18" width="8" height="3" rx="1.5"/></g></pattern>' +
      tplAgroSunDef('sf', 0);
    s += tplAgroUse('sf', 'translate(560 250) rotate(18) scale(.95)');
    s += '<path d="' + tplAgroMound(400, 676, 470, 250) + '" fill="url(#pl)"/><path d="' + tplAgroMound(400, 676, 470, 250) + '" fill="url(#moundShade)"/>';
    let lp = '<g fill="#946c3c">';
    for (let i = 0; i < 12; i++) {
      const x = 150 + rnd() * 520, y = 684 + rnd() * 44, a = Math.round(rnd() * 180);
      lp += '<rect x="' + n(x) + '" y="' + n(y) + '" width="24" height="10" rx="5" transform="rotate(' + a + ' ' + n(x + 12) + ' ' + n(y + 5) + ')"/>';
    }
    s += lp + '</g><path d="M560 712C600 690 640 694 660 706C630 724 596 726 560 712Z" fill="#d9c79a"/><path d="M118 700C160 676 204 678 222 690C194 708 156 712 118 700Z" fill="#cbb784"/>';
  }
  return tplAgroSvg(800, 800, defs, s);
}

// ----- Gallery scenes (1200×900) -----

function tplAgroScene(kind) {
  const W = 1200, H = 900, rnd = tplRand(tplHash('agro:scene:' + kind));
  const n = tplAgroN;
  let defs = tplAgroLandDefs();
  let s = '';
  if (kind === 'rows') {
    defs += tplAgroLg('sky', [[0, '#79b5dc'], [0.55, '#f6e2b2'], [1, '#ffc671']]) +
      tplAgroRg('glow', [[0, '#fff6d0', 1], [0.25, '#ffe29a', 0.6], [1, '#ffe29a', 0]], 0.5, 0.48, 0.55) +
      tplAgroLg('soil', [[0, '#c99a6a'], [1, '#6e4426']]) + tplAgroLg('crop', [[0, '#a9cf8c'], [1, '#3b8a36']]) +
      tplAgroLg('haze', [[0, '#fff3cf', 0.9], [1, '#fff3cf', 0]]);
    const hz = 430;
    s += '<rect width="' + W + '" height="' + hz + '" fill="url(#sky)"/><rect width="' + W + '" height="' + H + '" fill="url(#glow)"/>';
    s += tplAgroRays(600, hz, 18, 900, rnd, 0.08);
    s += '<circle cx="600" cy="' + hz + '" r="74" fill="#fff4cc"/>';
    s += tplAgroCloud(140, 120, 0.9, 0.7) + tplAgroCloud(860, 90, 1.1, 0.75);
    const A = tplAgroRidge(rnd, W, hz - 6, 6);
    s += tplAgroTrees(rnd, A, -10, 470, 12, '#6f9a62') + tplAgroTrees(rnd, A, 740, 1220, 12, '#6f9a62');
    s += '<rect y="' + hz + '" width="' + W + '" height="' + (H - hz) + '" fill="url(#soil)"/>';
    let rows = '';
    for (let i = -12; i <= 12; i++) {
      const xb = 600 + i * 120 - 34, xe = xb + 68;
      rows += '<polygon points="' + n(600 + (xb - 600) * 0.01) + ' ' + hz + ' ' + n(600 + (xe - 600) * 0.01) + ' ' + hz + ' ' + n(xe) + ' ' + H + ' ' + n(xb) + ' ' + H + '"/>';
    }
    s += '<g fill="url(#crop)">' + rows + '</g>';
    let sp = '<g fill="#58a644">';
    for (let i = -3; i <= 3; i++) {
      for (let j = 0; j < 4; j++) {
        const t = 0.7 + j * 0.1, x = 600 + i * 120 * t, y = hz + (H - hz) * t, sc = t * 1.4;
        sp += '<path d="M' + n(x) + ' ' + n(y) + 'c' + n(-14 * sc) + ' ' + n(-4 * sc) + ' ' + n(-22 * sc) + ' ' + n(-16 * sc) + ' ' + n(-22 * sc) + ' ' + n(-26 * sc) +
          'c' + n(12 * sc) + ' 0 ' + n(20 * sc) + ' ' + n(10 * sc) + ' ' + n(22 * sc) + ' ' + n(26 * sc) + 'c' + n(2 * sc) + ' ' + n(-16 * sc) + ' ' + n(10 * sc) + ' ' + n(-26 * sc) + ' ' + n(22 * sc) + ' ' + n(-26 * sc) +
          'c0 ' + n(10 * sc) + ' ' + n(-8 * sc) + ' ' + n(22 * sc) + ' ' + n(-22 * sc) + ' ' + n(26 * sc) + 'Z"/>';
      }
    }
    s += sp + '</g><rect y="' + hz + '" width="' + W + '" height="120" fill="url(#haze)"/>';
  } else if (kind === 'harvest') {
    defs += tplAgroCombineDef('cmb') + tplAgroLg('sky', [[0, '#4a98c8'], [0.7, '#cfe8ef'], [1, '#fff1c8']]) +
      tplAgroLg('gold', [[0, '#f2cb62'], [1, '#cf8f22']]);
    s += '<rect width="' + W + '" height="' + H + '" fill="url(#sky)"/>';
    s += tplAgroCloud(120, 140, 1.2, 0.85) + tplAgroCloud(760, 110, 0.9, 0.8) + tplAgroCloud(1000, 230, 0.6, 0.7);
    const A = tplAgroRidge(rnd, W, 430, 18);
    s += '<path d="' + A.path(H) + '" fill="#9ec79c"/>' + tplAgroTrees(rnd, A, 300, 900, 10, '#6f9f6a');
    const Bq = tplAgroRidge(rnd, W, 480, 20);
    s += tplAgroBand(rnd, 'hb', Bq, W, H, ['#8cc461', '#e9c766', '#6fae4d', '#c9a06a'], ['s1', 's2']);
    const C = tplAgroRidge(rnd, W, 560, 16, 6);
    s += '<clipPath id="hc"><path d="' + C.path(H) + '"/></clipPath><g clip-path="url(#hc)"><rect y="480" width="' + W + '" height="420" fill="url(#gold)"/>' +
      '<path d="M700 480H1260V900H930Z" fill="#f4dc98" opacity=".8"/>';
    let st = '<g stroke="#b9862e" stroke-opacity=".35" stroke-width="3">';
    for (let k = 0; k < 9; k++) {
      const y0 = 590 + k * k * 4 + k * 12;
      st += '<path d="M760 ' + n(y0) + 'L1220 ' + n(y0 + 10) + '" stroke-dasharray="' + (2 + k) + ' ' + (8 + k * 2) + '"/>';
    }
    s += st + '</g></g>';
    s += '<g fill="#f5e3a8" opacity=".6"><ellipse cx="900" cy="560" rx="170" ry="60"/><ellipse cx="1020" cy="520" rx="110" ry="40"/></g>';
    s += '<ellipse cx="610" cy="702" rx="340" ry="22" fill="#6a4410" opacity=".28"/>';
    s += tplAgroUse('cmb', 'translate(610 700) scale(1.6)');
    s += tplAgroTruck(1000, 726, 1.05);
    let gr = '<g fill="#e3a42e">';
    for (let i = 0; i < 26; i++) {
      const t = i / 26, x = 1000 + rnd() * 30 + t * 30, y = 470 + t * 120 + rnd() * 10;
      gr += '<circle cx="' + n(x) + '" cy="' + n(y) + '" r="' + n(3 + rnd() * 3) + '"/>';
    }
    s += gr + '</g>';
  } else if (kind === 'elevator') {
    defs += tplAgroLg('sky', [[0, '#4f6aa6'], [0.5, '#d98a6a'], [0.8, '#f6b866'], [1, '#ffd98a']]) +
      tplAgroLg('siloW', [[0, '#c9926a'], [0.35, '#f7e3c4'], [0.7, '#e7c7a0'], [1, '#a9744e']], 1, 0) +
      tplAgroLg('gold', [[0, '#e7b04e'], [1, '#a8661e']]);
    s += '<rect width="' + W + '" height="' + H + '" fill="url(#sky)"/>';
    s += '<circle cx="930" cy="520" r="120" fill="#ffe1a0" opacity=".5"/><circle cx="930" cy="520" r="78" fill="#ffe8b0"/>';
    s += '<g fill="#fff" opacity=".18"><ellipse cx="260" cy="190" rx="240" ry="16"/><ellipse cx="900" cy="250" rx="200" ry="12"/><ellipse cx="420" cy="300" rx="160" ry="10"/></g>';
    const A = tplAgroRidge(rnd, W, 610, 10);
    s += '<path d="' + A.path(H) + '" fill="#8a6a46"/>' + tplAgroTrees(rnd, A, 760, 1220, 11, '#5c4a32');
    s += tplAgroElevator(150, 640, 1.65, { silos: 6, body: 'url(#siloW)', roof: '#b07c55', win: '#ffd36a', flag: '#2e7d3a' });
    s += '<rect y="640" width="' + W + '" height="260" fill="url(#gold)"/>';
    s += '<rect y="664" width="' + W + '" height="5" fill="#4a3826"/><rect y="682" width="' + W + '" height="5" fill="#4a3826"/>';
    let sl = '<g fill="#5a4630">';
    for (let x = 0; x < W; x += 22) sl += '<rect x="' + x + '" y="660" width="8" height="32"/>';
    s += sl + '</g>';
    for (let i = 0; i < 6; i++) s += tplAgroHopper(40 + i * 196, 668, 1.08, i % 2 ? '#2e7d3a' : '#327f3d');
    let st = '<g stroke="#8f5a1a" stroke-opacity=".4" stroke-width="3">';
    for (let k = 0; k < 8; k++) st += '<path d="M0 ' + (740 + k * k * 3 + k * 10) + 'H1200"/>';
    s += st + '</g>';
  } else if (kind === 'sunflowers') {
    defs += tplAgroSunDef('sf', 0) + tplAgroLg('sky', [[0, '#5ea7d6'], [0.75, '#cfe9f2'], [1, '#f2f6dc']]) +
      tplAgroLg('fld', [[0, '#7aa63d'], [1, '#3e6e26']]);
    s += '<rect width="' + W + '" height="' + H + '" fill="url(#sky)"/>';
    s += tplAgroCloud(90, 130, 1, 0.85) + tplAgroCloud(620, 80, 0.8, 0.8) + tplAgroCloud(980, 160, 1.1, 0.85);
    const A = tplAgroRidge(rnd, W, 380, 14);
    s += '<path d="' + A.path(H) + '" fill="#9fc58f"/>' + tplAgroTrees(rnd, A, -10, 1220, 10, '#77a267');
    s += '<path d="M-20 420C300 400 900 410 1220 424V900H-20Z" fill="url(#fld)"/>';
    let heads = '';
    for (let r = 0; r < 7; r++) {
      const y = 430 + r * r * 9 + r * 14, sc = 0.08 + r * r * 0.012 + r * 0.02, step = 36 + r * r * 8 + r * 10;
      heads += '<g>';
      for (let x = -20 + rnd() * step; x < W + 20; x += step * (0.85 + rnd() * 0.3)) {
        heads += tplAgroUse('sf', 'translate(' + n(x) + ' ' + n(y + rnd() * 8) + ') rotate(' + n((rnd() - 0.5) * 30) + ') scale(' + sc.toFixed(3) + ')');
      }
      heads += '</g>';
    }
    s += heads;
    const big = (x, y, sc, rot) => '<path d="M' + x + ' ' + y + 'C' + (x + 10) + ' ' + (y + 160) + ' ' + (x - 6) + ' ' + (y + 300) + ' ' + x + ' ' + (H + 20) + '" fill="none" stroke="#4f7f2c" stroke-width="' + n(sc * 22) + '"/>' +
      '<path d="M' + x + ' ' + (y + 190) + 'c60-50 150-50 190-10c-60 30-130 40-190 10Z" fill="#5c9a35" transform="scale(1)"/>' +
      tplAgroUse('sf', 'translate(' + x + ' ' + y + ') rotate(' + rot + ') scale(' + sc + ')');
    s += big(210, 640, 1.5, -12) + big(980, 610, 1.75, 10) + big(640, 760, 1.2, 4);
  } else if (kind === 'rail') {
    defs += tplAgroLg('sky', [[0, '#69aede'], [0.8, '#d9eef2'], [1, '#f7f3d8']]) + tplAgroLg('gold', [[0, '#ecc35a'], [1, '#c98a26']]);
    s += '<rect width="' + W + '" height="' + H + '" fill="url(#sky)"/>';
    s += tplAgroCloud(300, 140, 1, 0.85) + tplAgroCloud(880, 110, 1.2, 0.8);
    const A = tplAgroRidge(rnd, W, 470, 18);
    s += '<path d="' + A.path(H) + '" fill="#a6cfa0"/>' + tplAgroElevator(60, A.y(100) + 4, 0.7, { silos: 3 });
    const Bq = tplAgroRidge(rnd, W, 540, 18);
    s += tplAgroBand(rnd, 'rb', Bq, W, H, ['#8cc461', '#f0c75e', '#6fae4d', '#e3ae42', '#b6d77f'], ['s1', 's2', 's3']);
    s += tplAgroTrees(rnd, Bq, 380, 1220, 13, 'url(#tree)');
    s += '<path d="M-20 650C300 636 900 636 1220 650V900H-20Z" fill="url(#gold)"/>';
    s += '<rect y="690" width="' + W + '" height="26" fill="#9a8a72"/><rect y="690" width="' + W + '" height="5" fill="#57493a"/><rect y="704" width="' + W + '" height="5" fill="#57493a"/>';
    s += '<g transform="translate(40 690)"><path d="M0 -40V-118Q0 -126 8 -126H150L176 -96V-40Z" fill="#f2b523"/><rect x="18" y="-116" width="40" height="30" rx="4" fill="#cdeaf4"/>' +
      '<rect x="0" y="-74" width="176" height="10" fill="#2e7d3a"/><rect x="60" y="-140" width="16" height="16" fill="#3a3a36"/><rect x="-4" y="-40" width="184" height="10" fill="#2c3a2a"/>' +
      '<g fill="#262a24"><circle cx="30" cy="-14" r="14"/><circle cx="66" cy="-14" r="14"/><circle cx="114" cy="-14" r="14"/><circle cx="150" cy="-14" r="14"/></g></g>';
    for (let i = 0; i < 6; i++) s += tplAgroHopper(226 + i * 184, 690, 1, i % 2 ? '#2e7d3a' : '#357f3f');
    let st = '<g stroke="#a46e1e" stroke-opacity=".35" stroke-width="3">';
    for (let k = 0; k < 7; k++) st += '<path d="M0 ' + (740 + k * k * 4 + k * 12) + 'C400 ' + (730 + k * k * 4 + k * 12) + ' 800 ' + (750 + k * k * 4 + k * 12) + ' 1200 ' + (738 + k * k * 4 + k * 12) + '" fill="none"/>';
    s += st + '</g>';
  } else if (kind === 'port') {
    defs += tplAgroLg('sky', [[0, '#3d8fc4'], [0.7, '#bfe2ee'], [1, '#fdf0cc']]) + tplAgroLg('sea', [[0, '#3f8fb4'], [1, '#1f5a7c']]) +
      tplAgroLg('siloW', [[0, '#c9c2b4'], [0.35, '#f7f4ec'], [0.7, '#e3ddd0'], [1, '#aea594']], 1, 0);
    s += '<rect width="' + W + '" height="' + H + '" fill="url(#sky)"/>';
    s += '<circle cx="980" cy="200" r="60" fill="#fff4cc"/><circle cx="980" cy="200" r="100" fill="#fff4cc" opacity=".3"/>';
    s += tplAgroCloud(120, 160, 1, 0.8) + tplAgroCloud(600, 110, 0.7, 0.7);
    s += '<path d="M780 140q8-7 16 0q8-7 16 0M840 110q6-5 12 0q6-5 12 0M700 180q7-6 14 0q7-6 14 0" fill="none" stroke="#2d4a5a" stroke-opacity=".6" stroke-width="3" stroke-linecap="round"/>';
    s += '<rect y="560" width="' + W + '" height="340" fill="url(#sea)"/>';
    let wv = '<g stroke="#fff" stroke-opacity=".28" stroke-width="3" stroke-linecap="round">';
    for (let i = 0; i < 26; i++) {
      const x = rnd() * W, y = 600 + rnd() * 280;
      wv += '<path d="M' + n(x) + ' ' + n(y) + 'h' + n(20 + rnd() * 50) + '"/>';
    }
    s += wv + '</g><path d="M940 570h80M920 600h120M950 630h60" stroke="#fff4cc" stroke-opacity=".6" stroke-width="5" stroke-linecap="round"/>';
    s += '<path d="M-20 560H560L600 600H-20Z" fill="#8f8a80"/><rect x="-20" y="540" width="580" height="22" fill="#b0a998"/>';
    s += tplAgroElevator(40, 540, 1.25, { silos: 6, body: 'url(#siloW)', roof: '#a49c8c', win: '#6f97ad', flag: '#2e7d3a' });
    s += '<path d="M380 286L700 380" stroke="#6f6a60" stroke-width="16"/><path d="M700 380L712 470" stroke="#6f6a60" stroke-width="8"/><path d="M560 360v190M640 380v170" stroke="#8f8a80" stroke-width="7"/>';
    s += '<g transform="translate(560 640)"><path d="M0 -60H600L560 20H40Z" fill="#1f4d3a"/><path d="M28 0H572L566 12H34Z" fill="#b84a2e"/>' +
      '<rect x="80" y="-84" width="90" height="26" rx="3" fill="#2e7d3a"/><rect x="200" y="-84" width="90" height="26" rx="3" fill="#2e7d3a"/><rect x="320" y="-84" width="90" height="26" rx="3" fill="#2e7d3a"/>' +
      '<rect x="470" y="-170" width="90" height="112" fill="#f4f1e8"/><rect x="452" y="-182" width="126" height="16" fill="#e2ddd0"/>' +
      '<g fill="#5f8fa8"><rect x="484" y="-154" width="18" height="12"/><rect x="510" y="-154" width="18" height="12"/><rect x="536" y="-154" width="14" height="12"/><rect x="484" y="-124" width="18" height="12"/><rect x="510" y="-124" width="18" height="12"/></g>' +
      '<rect x="500" y="-226" width="28" height="46" fill="#f2b523"/><rect x="500" y="-226" width="28" height="10" fill="#2a2a2a"/>' +
      '<path d="M190 -84V-176L130 -110M310 -84V-176L370 -110" fill="none" stroke="#f2b523" stroke-width="7"/></g>';
    s += '<path d="M600 660C800 676 1000 672 1160 662" stroke="#fff" stroke-opacity=".35" stroke-width="4" fill="none"/>';
  }
  return tplAgroSvg(W, H, defs, s);
}

/** Soil cross-section with crops, shelter belt, roots and moisture — sustainability. 1000×1000. */
function tplAgroSoil() {
  const W = 1000, H = 1000, rnd = tplRand(tplHash('agro:soil'));
  const n = tplAgroN;
  const defs = tplAgroLandDefs() + tplAgroLg('sky', [[0, '#8fcbe6'], [1, '#eef7e8']]) +
    tplAgroLg('top', [[0, '#5b3b20'], [1, '#6e4a2a']]) + tplAgroLg('sub', [[0, '#8a5d36'], [1, '#a77a4c']]) + tplAgroLg('deep', [[0, '#b98c5c'], [1, '#c9a274']]);
  const g = 470;
  let s = '<rect width="' + W + '" height="' + g + '" fill="url(#sky)"/>';
  s += '<circle cx="810" cy="140" r="70" fill="#ffe08a"/><circle cx="810" cy="140" r="110" fill="#ffe08a" opacity=".25"/>';
  s += tplAgroCloud(110, 120, 0.9, 0.85) + tplAgroCloud(440, 80, 0.7, 0.8);
  for (let x = 640; x < 1000; x += 68) s += '<rect x="' + (x - 5) + '" y="' + (g - 60) + '" width="10" height="60" fill="#5a3d24"/>';
  s += tplAgroTrees(rnd, { y: () => g - 58 }, 600, 1010, 34, 'url(#tree)');
  s += '<rect y="' + g + '" width="' + W + '" height="150" fill="url(#top)"/><rect y="' + (g + 150) + '" width="' + W + '" height="200" fill="url(#sub)"/><rect y="' + (g + 350) + '" width="' + W + '" height="' + (H - g - 350) + '" fill="url(#deep)"/>';
  s += '<path d="M0 ' + (g + 150) + 'C200 ' + (g + 140) + ' 400 ' + (g + 165) + ' 600 ' + (g + 150) + 'S900 ' + (g + 140) + ' 1000 ' + (g + 152) + '" fill="none" stroke="#3e2814" stroke-opacity=".35" stroke-width="4"/>';
  let specks = '<g fill="#3a2410" opacity=".55">';
  for (let i = 0; i < 70; i++) specks += '<circle cx="' + n(rnd() * W) + '" cy="' + n(g + 10 + rnd() * 140) + '" r="' + n(1.5 + rnd() * 3) + '"/>';
  specks += '</g><g fill="#d9b98a" opacity=".55">';
  for (let i = 0; i < 18; i++) specks += '<ellipse cx="' + n(rnd() * W) + '" cy="' + n(g + 380 + rnd() * 140) + '" rx="' + n(10 + rnd() * 22) + '" ry="' + n(6 + rnd() * 10) + '"/>';
  s += specks + '</g>';
  let roots = '<g fill="none" stroke="#efd9ad" stroke-linecap="round">';
  let crops = '<g fill="#5aa845">';
  for (let i = 0; i < 9; i++) {
    const x = 50 + i * 62, h = 70 + rnd() * 40;
    crops += '<path d="M' + x + ' ' + g + 'C' + (x - 4) + ' ' + n(g - h * 0.5) + ' ' + (x + 6) + ' ' + n(g - h * 0.8) + ' ' + x + ' ' + n(g - h) + '" stroke="#4a8f3a" stroke-width="5" fill="none"/>' +
      '<path d="M' + x + ' ' + n(g - h * 0.45) + 'c-30-6-44-26-46-42c22 0 40 16 46 42Z"/><path d="M' + x + ' ' + n(g - h * 0.7) + 'c30-6 42-28 42-44c-22 2-38 18-42 44Z"/>' +
      tplAgroUse('ear', 'translate(' + x + ' ' + n(g - h + 4) + ') scale(.42)', ' fill="#e2b44a" color="#4a8f3a"');
    const depth = 160 + rnd() * 200;
    roots += '<path d="M' + x + ' ' + g + 'C' + n(x - 10 + rnd() * 20) + ' ' + n(g + depth * 0.4) + ' ' + n(x - 30 + rnd() * 60) + ' ' + n(g + depth * 0.7) + ' ' + n(x - 20 + rnd() * 40) + ' ' + n(g + depth) + '" stroke-width="4"/>';
    for (let j = 0; j < 4; j++) {
      const yy = g + 20 + j * depth * 0.2, dir = j % 2 ? 1 : -1;
      roots += '<path d="M' + x + ' ' + n(yy) + 'q' + n(dir * (20 + rnd() * 20)) + ' ' + n(10 + rnd() * 20) + ' ' + n(dir * (30 + rnd() * 30)) + ' ' + n(40 + rnd() * 40) + '" stroke-width="2" opacity=".85"/>';
    }
  }
  for (let x = 640; x < 1000; x += 68) {
    roots += '<path d="M' + x + ' ' + g + 'C' + (x - 30) + ' ' + (g + 120) + ' ' + (x + 20) + ' ' + (g + 260) + ' ' + (x - 10) + ' ' + (g + 420) + 'M' + x + ' ' + (g + 60) + 'q50 40 70 140M' + x + ' ' + (g + 90) + 'q-50 30 -60 120" stroke-width="5" opacity=".8"/>';
  }
  s += crops + '</g>' + roots + '</g>';
  s += '<path d="M150 ' + (g + 260) + 'c30-30 60 30 90 0s60 30 90 0" fill="none" stroke="#d98a7a" stroke-width="10" stroke-linecap="round"/>';
  let drops = '<g fill="#7cc4e8" opacity=".9">';
  for (let i = 0; i < 9; i++) {
    const x = 80 + rnd() * 840, y = g + 200 + rnd() * 280;
    drops += '<path d="M' + n(x) + ' ' + n(y) + 'c-8 10-10 16-10 20a10 10 0 0 0 20 0c0-4-2-10-10-20Z"/>';
  }
  s += drops + '</g>';
  s += '<g stroke="#fff" stroke-opacity=".7" stroke-width="2"><path d="M972 ' + (g + 10) + 'V' + (H - 20) + '"/>';
  for (let i = 0; i <= 10; i++) s += '<path d="M' + (i % 5 ? 962 : 952) + ' ' + (g + 10 + i * 50) + 'H972"/>';
  s += '</g>';
  return tplAgroSvg(W, H, defs + tplAgroEarDef('ear', 20), s);
}

/** Stylized portrait (600×600). */
function tplAgroPortrait(o) {
  const rnd = tplRand(tplHash('agro:pt:' + o.seed));
  const sk = o.skin, hr = o.hair, n = tplAgroN;
  const defs = tplAgroLg('bg', [[0, o.bg[0]], [1, o.bg[1]]], 1, 1) +
    tplAgroLg('shirt', [[0, o.shirt], [1, o.shirt2 || o.shirt]]);
  let s = '<rect width="600" height="600" fill="url(#bg)"/>';
  s += '<circle cx="470" cy="130" r="56" fill="#fff6d6" opacity=".55"/>';
  const A = tplAgroRidge(rnd, 600, 470, 18, 6), B = tplAgroRidge(rnd, 600, 520, 14, 6);
  s += '<path d="' + A.path(600) + '" fill="#fff" opacity=".22"/><path d="' + B.path(600) + '" fill="#fff" opacity=".2"/>';
  if (o.style === 'long') s += '<path d="M200 270C190 160 250 120 300 120C350 120 410 160 400 270C410 360 420 430 380 470H220C180 430 190 360 200 270Z" fill="' + hr + '"/>';
  if (o.style === 'bun') s += '<circle cx="300" cy="150" r="40" fill="' + hr + '"/>';
  s += '<path d="M80 620C88 500 180 446 300 446C420 446 512 500 520 620Z" fill="url(#shirt)"/>';
  if (o.vest) s += '<path d="M80 620C88 520 150 470 214 456L262 620ZM520 620C512 520 450 470 386 456L338 620Z" fill="' + o.vest + '"/>';
  s += '<path d="M262 360H338V452C320 472 280 472 262 452Z" fill="' + o.skin2 + '"/>';
  s += '<path d="M252 444L300 506L348 444L338 438L300 476L262 438Z" fill="' + (o.collar || '#fff') + '"/>';
  if (o.pocket) s += '<rect x="372" y="520" width="58" height="50" rx="6" fill="#000" opacity=".12"/>' + tplAgroUse('ear', 'translate(396 528) rotate(8) scale(.62)', ' fill="#e2b44a" color="#a8781e"');
  s += '<ellipse cx="210" cy="290" rx="15" ry="24" fill="' + o.skin2 + '"/><ellipse cx="390" cy="290" rx="15" ry="24" fill="' + o.skin2 + '"/>';
  s += '<ellipse cx="300" cy="278" rx="90" ry="108" fill="' + sk + '"/>';
  if (o.style === 'short') s += '<path d="M212 272C200 176 254 148 302 148C356 148 404 178 390 272C384 226 352 206 302 208C258 210 226 226 212 272Z" fill="' + hr + '"/>';
  else if (o.style === 'buzz') s += '<path d="M214 250C214 186 256 168 300 168C346 168 388 186 386 250C372 214 340 200 300 200C260 200 228 214 214 250Z" fill="' + hr + '"/>';
  else if (o.style === 'long' || o.style === 'bun') s += '<path d="M210 280C200 180 252 156 300 156C352 156 402 182 392 280C380 214 340 196 306 198C280 200 300 226 250 232C226 236 214 258 210 280Z" fill="' + hr + '"/>';
  else if (o.style === 'curly') {
    s += '<g fill="' + hr + '">';
    for (let i = 0; i < 11; i++) {
      const a = Math.PI * (1.05 + i * 0.09);
      s += '<circle cx="' + n(300 + Math.cos(a) * 92) + '" cy="' + n(262 + Math.sin(a) * 104) + '" r="' + n(26 + rnd() * 8) + '"/>';
    }
    s += '</g>';
  }
  if (o.beard) s += '<path d="M212 300C214 380 256 392 300 392C344 392 386 380 388 300C376 340 350 352 300 352C250 352 224 340 212 300Z" fill="' + hr + '"/><path d="M276 344Q300 336 324 344Q300 350 276 344Z" fill="' + hr + '"/>';
  s += '<path d="M248 248Q264 238 280 246M320 246Q336 238 352 248" fill="none" stroke="' + (o.brow || hr) + '" stroke-width="6" stroke-linecap="round"/>';
  s += '<g fill="#2b2220"><ellipse cx="264" cy="274" rx="7" ry="8.5"/><ellipse cx="336" cy="274" rx="7" ry="8.5"/></g><g fill="#fff"><circle cx="267" cy="271" r="2.4"/><circle cx="339" cy="271" r="2.4"/></g>';
  s += '<path d="M300 284Q290 318 304 322" fill="none" stroke="' + o.skin2 + '" stroke-width="5" stroke-linecap="round"/>';
  s += '<path d="M270 342Q300 366 330 342" fill="none" stroke="#9c4a3a" stroke-width="5" stroke-linecap="round"/>';
  s += '<g fill="#e8847a" opacity=".22"><circle cx="246" cy="318" r="17"/><circle cx="354" cy="318" r="17"/></g>';
  if (o.glasses) s += '<g fill="#fff" fill-opacity=".14" stroke="#2b2b2b" stroke-width="4"><rect x="236" y="254" width="56" height="42" rx="14"/><rect x="308" y="254" width="56" height="42" rx="14"/></g><path d="M292 270Q300 264 308 270" fill="none" stroke="#2b2b2b" stroke-width="4"/>';
  if (o.cap) s += '<path d="M206 236C206 160 254 138 300 138C346 138 394 160 394 236Z" fill="' + o.cap + '"/><path d="M206 236C260 222 340 222 394 236C420 240 440 250 446 262C400 250 340 246 300 248C260 246 230 248 206 250Z" fill="' + (o.cap2 || o.cap) + '"/>' +
    '<rect x="270" y="170" width="60" height="26" rx="6" fill="#f2b523"/>';
  if (o.scarf) s += '<path d="M240 452C270 480 330 480 360 452L372 480C330 512 270 512 228 480Z" fill="' + o.scarf + '"/>';
  return tplAgroSvg(600, 600, defs + (o.pocket ? tplAgroEarDef('ear', 20) : ''), s);
}

/** Partner mark (360×120): geometric emblem + monogram initials. */
function tplAgroLogo(kind, initials, color) {
  let m = '';
  const c = color;
  if (kind === 'port') {
    m = '<circle cx="60" cy="60" r="46" fill="' + c + '"/><path d="M60 26v52M44 38h32M30 66q30 30 60 0" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/><path d="M26 92q17-10 34 0t34 0" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="5" stroke-linecap="round"/>';
  } else if (kind === 'rail') {
    m = '<rect x="14" y="14" width="92" height="92" rx="22" fill="' + c + '"/><path d="M46 96L56 28M74 96L64 28" stroke="#fff" stroke-width="6" stroke-linecap="round"/><path d="M42 84h36M45 66h30M48 48h24" stroke="#f2b523" stroke-width="6" stroke-linecap="round"/>';
  } else if (kind === 'lab') {
    m = '<circle cx="60" cy="60" r="46" fill="' + c + '"/><path d="M50 28h20M54 28v22L36 86q-2 6 4 6h40q6 0 4-6L66 50V28" fill="#fff" stroke="#fff" stroke-width="4" stroke-linejoin="round"/><path d="M44 76h32L84 90H36Z" fill="#2e7d3a"/><ellipse cx="60" cy="66" rx="5" ry="8" fill="' + c + '"/>';
  } else if (kind === 'cert') {
    m = '<path d="M60 12L100 26V58C100 84 82 100 60 108C38 100 20 84 20 58V26Z" fill="' + c + '"/><path d="M40 60l14 14 28-30" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>';
  } else if (kind === 'lease') {
    let sp = '';
    for (let i = 0; i < 8; i++) sp += '<path d="M60 60L' + tplAgroN(60 + Math.cos(i * Math.PI / 4) * 30) + ' ' + tplAgroN(60 + Math.sin(i * Math.PI / 4) * 30) + '"/>';
    m = '<circle cx="60" cy="60" r="46" fill="' + c + '"/><circle cx="60" cy="60" r="30" fill="none" stroke="#fff" stroke-width="7"/><g stroke="#fff" stroke-width="5">' + sp + '</g><circle cx="60" cy="60" r="10" fill="#f2b523"/>';
  } else {
    m = '<circle cx="60" cy="60" r="46" fill="' + c + '"/><path d="M26 58Q60 18 94 58Q77 50 60 58Q43 50 26 58Z" fill="#fff"/><path d="M60 58V92M60 80q-14-2-18-14q14 0 18 14M60 74q12-2 16-14q-12 0-16 14" fill="none" stroke="#f2b523" stroke-width="5" stroke-linecap="round"/>';
  }
  const t = '<text x="124" y="78" font-family="system-ui,-apple-system,\'Segoe UI\',Roboto,Arial,sans-serif" font-size="46" font-weight="800" letter-spacing="2" fill="' + c + '">' + escapeHTML(initials) + '</text>';
  return tplAgroSvg(360, 120, '', m + t);
}

/** Stylized region map: field patchwork, river, rail, sea, site pins. 1200×900. */
function tplAgroMap() {
  const W = 1200, H = 900, rnd = tplRand(tplHash('agro:map'));
  const n = tplAgroN;
  const defs = tplAgroLg('sea', [[0, '#a9d8ea'], [1, '#6fb4d6']], 1, 1);
  const cols = ['#cfe3a8', '#b9d98a', '#f1d98a', '#e9c770', '#d9c29a', '#c6dd9a', '#f4e3a8'];
  let s = '<rect width="' + W + '" height="' + H + '" fill="#efe7cf"/>';
  const cw = 120, ch = 100;
  const J = [];
  for (let r = 0; r <= 9; r++) {
    J[r] = [];
    for (let c = 0; c <= 10; c++) J[r][c] = [c * cw + (c && c < 10 ? (rnd() - 0.5) * 50 : 0), r * ch + (r && r < 9 ? (rnd() - 0.5) * 40 : 0)];
  }
  s += '<g stroke="#efe7cf" stroke-width="6" stroke-linejoin="round">';
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 10; c++) {
      const p = [J[r][c], J[r][c + 1], J[r + 1][c + 1], J[r + 1][c]];
      s += '<polygon points="' + p.map((q) => n(q[0]) + ' ' + n(q[1])).join(' ') + '" fill="' + cols[Math.floor(rnd() * cols.length)] + '"/>';
    }
  }
  s += '</g>';
  s += '<path d="M760 900C820 760 900 700 1010 640C1080 600 1140 540 1200 520V900Z" fill="url(#sea)"/>';
  s += '<path d="M760 900C820 760 900 700 1010 640C1080 600 1140 540 1200 520" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="5"/>';
  s += '<g stroke="#fff" stroke-opacity=".5" stroke-width="3" stroke-linecap="round"><path d="M980 780h40M1060 720h50M1100 820h40M940 860h30"/></g>';
  const river = 'M-10 120C140 160 220 260 300 330S470 420 560 500S700 640 820 760';
  s += '<path d="' + river + '" fill="none" stroke="#7cc4e8" stroke-width="20" stroke-linecap="round"/><path d="' + river + '" fill="none" stroke="#bfe6f5" stroke-width="7" stroke-linecap="round"/>';
  s += '<g fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"><path d="M0 560C200 520 380 560 560 500S860 380 1200 360"/><path d="M430 0C440 200 380 360 420 560S470 820 450 900"/></g>';
  const rail = 'M0 700C200 660 360 640 520 600S800 560 1000 640';
  s += '<path d="' + rail + '" fill="none" stroke="#5a4a3a" stroke-width="7"/><path d="' + rail + '" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="12 12"/>';
  s += '<g fill="#5f9a52" opacity=".75"><path d="M120 260h240v14H120ZM620 220h20v220h-20ZM820 420h240v14H820ZM180 780h200v14H180Z"/></g>';
  const pin = (x, y, c, r = 1) => '<g transform="translate(' + x + ' ' + y + ') scale(' + r + ')"><ellipse cy="2" rx="12" ry="4" fill="#000" opacity=".2"/>' +
    '<path d="M0 0C-14-18-24-30-24-44a24 24 0 1 1 48 0C24-30 14-18 0 0Z" fill="' + c + '" stroke="#fff" stroke-width="4"/><circle cy="-44" r="9" fill="#fff"/></g>';
  s += pin(420, 470, '#2e7d3a', 1.35);
  [[220, 250], [640, 330], [180, 640], [860, 300]].forEach((p) => { s += pin(p[0], p[1], '#e8a20c'); });
  s += pin(520, 560, '#8a5a32', 1.1) + pin(1010, 650, '#2f7cab', 1.2);
  s += '<g transform="translate(1110 90)"><circle r="44" fill="#fff" opacity=".85"/><path d="M0-34L10 0L0 34L-10 0Z" fill="#2a3a26"/><path d="M0-34L10 0H-10Z" fill="#c0392b"/></g>';
  s += '<g transform="translate(40 850)"><rect width="200" height="10" fill="#fff"/><rect width="50" height="10" fill="#2a3a26"/><rect x="100" width="50" height="10" fill="#2a3a26"/></g>';
  return tplAgroSvg(W, H, defs, s);
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

/** Seasonality table cell colours (translucent: readable on the light and the derived dark palette alike). */
const TPL_AGRO_SEASON = {
  sow: 'rgba(46,125,58,.36)', grow: 'rgba(46,125,58,.14)', harvest: 'rgba(233,169,34,.55)', sale: 'rgba(233,169,34,.2)', make: 'rgba(150,96,44,.28)',
};

function tplBuildAgro(V) {
  const K = tplKit(V, ['ru', 'en', 'uk']);
  const { B, L } = K;
  const t = (ru, en, uk) => ({ ru, en, uk });
  const p = (ru, en, uk) => t('<p>' + ru + '</p>', '<p>' + en + '</p>', '<p>' + uk + '</p>');
  const img = (name, svg, title) => K.svg(name, svg, { title });
  const pdf = (name, title, lines, band, ttl, desc) => K.addAtt({
    name, mime: 'application/pdf', data: K.files.makePDF(title, lines, { accent: '#2e7d3a', band }), title: ttl, desc,
  });
  const col = (w, blocks) => ({ id: K.id(), w, blocks });
  const field = (key, type, label, ph, o = {}) => K.item({ key, type, label: L(label), ph: L(ph || ''), options: L(o.options || ''), required: !!o.required, half: !!o.half });

  // ----- artwork -----
  const brand = img('shiroky-lan-mark.svg', tplAgroBrand(), t('Знак «Широкий Лан»', 'Shiroky Lan mark', 'Знак «Широкий Лан»'));
  const hero = img('fields-at-dawn.svg', tplAgroHero(), t('Поля холдинга на рассвете: уборка пшеницы', 'Our fields at dawn: wheat harvest', 'Поля холдингу на світанку: збирання пшениці'));
  const topo = img('topo-texture.svg', tplAgroTopo(), '');
  const dusk = img('wheat-at-dusk.svg', tplAgroDusk(), '');
  const soil = img('living-soil.svg', tplAgroSoil(), t('Почва под защитой лесополос: корни, влага, микрофлора', 'Soil protected by shelter belts: roots, moisture, life', 'Ґрунт під захистом лісосмуг: коріння, волога, мікрофлора'));
  const map = img('logistics-map.svg', tplAgroMap(), t('Схема: поля, элеваторы, железная дорога и порт', 'Map: fields, elevators, railway and port', 'Схема: поля, елеватори, залізниця і порт'));
  const shot = {};
  for (const k of ['wheat', 'barley', 'corn', 'sunseed', 'oil-crude', 'oil-refined', 'soymeal', 'pellets']) shot[k] = img('product-' + k + '.svg', tplAgroProduct(k), '');
  const scene = {};
  for (const k of ['harvest', 'sunflowers', 'elevator', 'rail', 'port', 'rows']) scene[k] = img('scene-' + k + '.svg', tplAgroScene(k), '');
  const people = [
    img('team-kramarenko.svg', tplAgroPortrait({ seed: 'kramarenko', bg: ['#f6e3a6', '#e2b95a'], skin: '#f1cdb3', skin2: '#e0b090', hair: '#7a4a2a', style: 'long', shirt: '#2e7d3a', shirt2: '#256b2f', collar: '#fdfbf4' }), ''),
    img('team-bondar.svg', tplAgroPortrait({ seed: 'bondar', bg: ['#cfe6c0', '#93c27e'], skin: '#e6b993', skin2: '#d39f78', hair: '#4a3a2c', style: 'short', beard: true, shirt: '#5b7d3a', shirt2: '#4a6a2e', cap: '#2e7d3a', cap2: '#256b2f', pocket: true }), ''),
    img('team-akhmetova.svg', tplAgroPortrait({ seed: 'akhmetova', bg: ['#f3d9c4', '#d9a77f'], skin: '#d9a77f', skin2: '#c48f68', hair: '#1f1a17', style: 'bun', shirt: '#33506b', shirt2: '#283f55', scarf: '#e9a922', glasses: true }), ''),
    img('team-hnatiuk.svg', tplAgroPortrait({ seed: 'hnatiuk', bg: ['#d8ecee', '#9fcbd0'], skin: '#efc6a8', skin2: '#dcab88', hair: '#8f8a84', style: 'buzz', shirt: '#f4f6f2', shirt2: '#dfe5dc', collar: '#c9d6c4', glasses: true }), ''),
  ];
  const partners = [
    ['port', 'LMP', '#4f7a8c', t('Морской порт Лиманск', 'Limansk Sea Port', 'Морський порт Лиманськ')],
    ['rail', 'SRT', '#5e6b7a', t('Степная железная дорога', 'Steppe Rail Transport', 'Степова залізниця')],
    ['lab', 'AGL', '#5a7f63', t('Агролаб — независимая экспертиза', 'Agrolab independent inspection', 'Агролаб — незалежна експертиза')],
    ['cert', 'QCS', '#6f7a4f', t('Сертификационный центр QCS', 'QCS certification centre', 'Сертифікаційний центр QCS')],
    ['lease', 'LZG', '#7c6a4a', t('Агролизинг «Нива»', 'Niva Agro Leasing', 'Агролізинг «Нива»')],
    ['mill', 'BZH', '#6b6457', t('Мелькомбинат «Белый Жёрнов»', 'White Millstone flour mill', 'Млинкомбінат «Білий Жорен»')],
  ].map(([k, ini, c, name]) => ({ id: img('partner-' + ini.toLowerCase() + '.svg', tplAgroLogo(k, ini, c), name), name }));

  // ----- documents (sample PDFs) -----
  const priceList = pdf('shiroky-lan-price-list-w41-2026.pdf', 'Shiroky Lan - Wholesale price list, week 41/2026', [
    '> Prices in USD per tonne, FCA our elevators, VAT excluded. Valid until Sunday of week 41/2026.',
    '',
    '# Grain and oilseeds (2026 crop)',
    '- Milling wheat, class 3 ............ USD 228 / t ..... min. 25 t',
    '- Feed barley ...................... USD 196 / t ..... min. 25 t',
    '- Corn, grade 3 (new crop, October) . USD 204 / t ..... min. 25 t',
    '- Sunflower seeds, oil content 48 %+ USD 462 / t ..... min. 20 t',
    '# Processed products',
    '- Crude sunflower oil (flexitank) .... USD 1,045 / t ... min. 20 t',
    '- Refined sunflower oil, 15 x 1 L .... USD 26.40 / case  min. 60 cases (1 pallet)',
    '- Soybean meal, protein 46 % ......... USD 418 / t ..... min. 25 t',
    '- Sunflower husk pellets, 6-8 mm ..... USD 118 / t ..... min. 22 t',
    '',
    '# Delivery terms',
    '- FCA elevator (Lanohrad-1, Lanohrad-2, Kovylne, Stepove, Pryozerne, Limansk port)',
    '- CPT destination railway station - quoted per order',
    '- FOB Limansk port - lots from 3,000 t',
    '',
    '# Payment',
    'New customers: 100 % prepayment. Regular customers: deferred payment up to 14 days.',
    '',
    'Orders: trade@shirokylan.example - +7 000 000-19-94',
    '',
    '> Sample document generated by the landing template. All names, prices and data are fictional.',
  ], 'WHOLESALE PRICE LIST', t('Прайс-лист, 41-я неделя 2026', 'Price list, week 41/2026', 'Прайс-лист, 41-й тиждень 2026'),
  t('Все позиции, минимальные партии и базисы поставки', 'All products, minimum lots and delivery terms', 'Усі позиції, мінімальні партії та базиси поставки'));
  const protocol = pdf('test-report-wheat-class-3.pdf', 'Test report No. LL-2026-10482 - Milling wheat, class 3', [
    '> Shiroky Lan quality laboratory, Lanohrad-2 elevator - accredited testing laboratory (sample)',
    '',
    '# Sample',
    '- Product: milling wheat, class 3, crop 2026',
    '- Lot: 25.4 t, truck AA 0000 00, silo 7',
    '- Sampling: 2026-10-08, automatic probe, 12 points',
    '# Results',
    '- Protein (dry basis): 13.1 % (contract: min. 12.5 %)',
    '- Wet gluten: 25.4 % (min. 23 %), gluten index 78',
    '- Moisture: 12.6 % (max. 14 %)',
    '- Test weight: 781 g/l (min. 750 g/l)',
    '- Falling number: 312 s (min. 250 s)',
    '- Foreign matter: 0.8 % (max. 2 %), grain impurities: 2.1 % (max. 5 %)',
    '- Pests: not detected',
    '',
    'Conclusion: the lot complies with the contract specification for milling wheat, class 3.',
    'Arbitration sample kept for 3 months.',
    '',
    '> Sample document. All data are illustrative and fictional.',
  ], 'LABORATORY TEST REPORT', t('Образец протокола испытаний: пшеница 3 класса', 'Sample test report: wheat, class 3', 'Зразок протоколу випробувань: пшениця 3 класу'),
  t('Что вы получаете с каждой партией', 'What comes with every lot', 'Що ви отримуєте з кожною партією'));
  const terms = pdf('farmer-partner-programme-2026-27.pdf', 'Partner programme for farmers - season 2026/27', [
    '# Who can join',
    'Farms from 100 ha within 60 km of our elevators: grain, oilseeds, legumes.',
    '# What you get',
    '- Forward price fixing before sowing, advance payment up to 30 % of the expected crop',
    '- Intake at the nearest elevator, drying and cleaning at cost, storage up to 6 months',
    '- Payment within 3 banking days after intake and laboratory analysis',
    '- Seeds, fertilisers and crop protection at holding prices, payment after harvest',
    '- Agronomist visits, soil analysis and variable-rate fertiliser maps',
    '- Machinery hire in peak season',
    '# How to join',
    '1. Send a request: farm@shirokylan.example or the form on our website.',
    '2. Agronomist visit and assessment of fields and storage.',
    '3. Framework agreement for the season.',
    '4. First delivery to the elevator.',
    '',
    '> Sample document generated by the landing template. All names and data are fictional.',
  ], 'PARTNER PROGRAMME', t('Условия фермерской программы 2026/27', 'Farmer programme terms 2026/27', 'Умови фермерської програми 2026/27'),
  t('Кто может вступить, что входит, как начать', 'Who can join, what is included, how to start', 'Хто може долучитися, що входить, як почати'));

  // ----- requests (browser-local endpoints; mailto is the human fallback) -----
  const reqLoad = K.id();
  const reqSave = K.id();
  const reqOrder = K.id();
  const reqInbox = K.id();
  const R = (id, name, method, url) => ({ id, name, method, url, headers: [], credentials: 'omit', timeout: 8000, retries: 0, itemsPath: 'items' });
  const requests = [
    R(reqLoad, 'Load cart (browser storage)', 'GET', 'local:cart/{cartId}'),
    R(reqSave, 'Save cart (browser storage)', 'PUT', 'local:cart/{cartId}'),
    R(reqOrder, 'Place order (browser storage)', 'POST', 'local:orders'),
    R(reqInbox, 'Contact form (browser storage)', 'POST', 'local:inbox'),
  ];

  const d = K.doc({
    name: 'Shiroky Lan — agricultural holding', preset: 'harvest', defaultLang: 'ru',
    author: 'Shiroky Lan', keywords: 'wheat, barley, corn, sunflower seeds, sunflower oil, soybean meal, wholesale, elevator, farmers programme',
    title: t('«Широкий Лан» — зерно и подсолнечное масло оптом', 'Shiroky Lan — grain and sunflower oil wholesale', '«Широкий Лан» — зерно та соняшникова олія оптом'),
    description: t(
      'Агрохолдинг «Широкий Лан»: пшеница, ячмень, кукуруза, семечка, подсолнечное масло и шрот оптом от одной машины. Свои элеваторы, лаборатория и логистика до порта.',
      'Shiroky Lan agricultural holding: wheat, barley, corn, sunflower seeds, sunflower oil and meal wholesale from one truckload. Own elevators, laboratory and logistics to the port.',
      'Агрохолдинг «Широкий Лан»: пшениця, ячмінь, кукурудза, насіння, соняшникова олія та шрот оптом від однієї машини. Власні елеватори, лабораторія і логістика до порту.'),
    meta: { favicon: brand },
    theme: { scheme: 'auto' },
    output: { autodetect: true, switcher: 'buttons', langLabels: 'code', themeToggle: true, toolbarPos: 'nav', motion: 'rise', backToTop: true },
    shop: {
      currency: 'USD', mode: 'cart', cartButton: 'auto', sync: 'remote', loadReq: reqLoad, saveReq: reqSave, policy: 'newest', ttlDays: 30,
      checkout: {
        method: 'request', req: reqOrder, fallback: 'mailto', email: 'trade@shirokylan.example', phone: '+7 000 000-19-94', minTotal: 0,
        note: L(t('Цены — FCA элеватор, USD за тонну без НДС. Менеджер подтвердит наличие, базис и итоговую цену в течение двух часов в рабочее время.',
          'Prices are FCA elevator, USD per tonne excluding VAT. A manager will confirm availability, terms and the final price within two working hours.',
          'Ціни — FCA елеватор, USD за тонну без ПДВ. Менеджер підтвердить наявність, базис і підсумкову ціну протягом двох годин у робочий час.')),
        success: L(t('Спасибо! Заказ принят. Менеджер свяжется с вами для подтверждения.',
          'Thank you! Your order has been received. A manager will contact you to confirm it.',
          'Дякуємо! Замовлення прийнято. Менеджер зв’яжеться з вами для підтвердження.')),
        fields: [
          field('company', 'text', t('Компания', 'Company', 'Компанія'), '', { required: true, half: true }),
          field('name', 'text', t('Контактное лицо', 'Contact person', 'Контактна особа'), '', { required: true, half: true }),
          field('email', 'email', t('E-mail', 'E-mail', 'E-mail'), 'name@company.example', { required: true, half: true }),
          field('phone', 'tel', t('Телефон', 'Phone', 'Телефон'), '+7 000 000-00-00', { required: true, half: true }),
          field('basis', 'select', t('Базис поставки', 'Delivery terms', 'Базис поставки'), '', {
            half: true,
            options: t('FCA элеватор (самовывоз)\nCPT станция назначения\nFOB порт Лиманск', 'FCA elevator (pick-up)\nCPT destination station\nFOB Limansk port', 'FCA елеватор (самовивіз)\nCPT станція призначення\nFOB порт Лиманськ'),
          }),
          field('date', 'date', t('Желаемая дата отгрузки', 'Preferred loading date', 'Бажана дата відвантаження'), '', { half: true }),
          field('comment', 'textarea', t('Комментарий', 'Comment', 'Коментар'),
            t('Объём, график поставок, требования к качеству…', 'Volumes, delivery schedule, quality requirements…', 'Обсяг, графік поставок, вимоги до якості…')),
        ],
      },
    },
    requests,
  });

  // ----- header -----
  d.regions.header = [
    B('nav', {
      brand: L(t('Широкий Лан', 'Shiroky Lan', 'Широкий Лан')), logo: brand, logoH: 40, sticky: true, overlay: true, variant: 'bar',
      items: [
        K.item({ label: L(t('Продукция', 'Products', 'Продукція')), href: '#products' }),
        K.item({ label: L(t('Сезоны', 'Seasons', 'Сезони')), href: '#season' }),
        K.item({ label: L(t('Фермерам', 'Farmers', 'Фермерам')), href: '#farmers' }),
        K.item({ label: L(t('Логистика', 'Logistics', 'Логістика')), href: '#logistics' }),
        K.item({ label: L(t('Контакты', 'Contact', 'Контакти')), href: '#contact' }),
      ],
      ctaLabel: L(''), ctaHref: '',
    }),
  ];

  // ----- products -----
  const unitT = t('т', 't', 'т');
  const products = [
    ['wheat', 'SL-WHT-3', t('Пшеница 3 класса', 'Milling wheat, class 3', 'Пшениця 3 класу'), 228, unitT, 25, 25, 'in', t('Урожай 2026', '2026 crop', 'Урожай 2026'),
      t('Протеин: от 12,5 %\nКлейковина: от 23 %\nВлажность: до 14 %\nНатура: от 750 г/л', 'Protein: min. 12.5 %\nWet gluten: min. 23 %\nMoisture: max. 14 %\nTest weight: min. 750 g/l', 'Протеїн: від 12,5 %\nКлейковина: від 23 %\nВологість: до 14 %\nНатура: від 750 г/л')],
    ['barley', 'SL-BRL-F', t('Ячмень фуражный', 'Feed barley', 'Ячмінь фуражний'), 196, unitT, 25, 25, 'in', null,
      t('Натура: от 600 г/л\nВлажность: до 14 %\nСорная примесь: до 2 %', 'Test weight: min. 600 g/l\nMoisture: max. 14 %\nForeign matter: max. 2 %', 'Натура: від 600 г/л\nВологість: до 14 %\nСмітна домішка: до 2 %')],
    ['corn', 'SL-CRN-3', t('Кукуруза 3 класса', 'Corn, grade 3', 'Кукурудза 3 класу'), 204, unitT, 25, 25, 'pre', t('Новый урожай — октябрь', 'New crop — October', 'Новий урожай — жовтень'),
      t('Влажность: до 14 %\nБитые зёрна: до 5 %\nЗерновая примесь: до 10 %', 'Moisture: max. 14 %\nBroken kernels: max. 5 %\nGrain impurities: max. 10 %', 'Вологість: до 14 %\nБиті зерна: до 5 %\nЗернова домішка: до 10 %')],
    ['sunseed', 'SL-SUN-S', t('Семечка подсолнечника', 'Sunflower seeds', 'Насіння соняшнику'), 462, unitT, 20, 20, 'low', null,
      t('Масличность: от 48 %\nВлажность: до 8 %\nСорная примесь: до 3 %', 'Oil content: min. 48 %\nMoisture: max. 8 %\nForeign matter: max. 3 %', 'Олійність: від 48 %\nВологість: до 8 %\nСмітна домішка: до 3 %')],
    ['oil-crude', 'SL-OIL-CR', t('Масло подсолнечное нерафинированное', 'Crude sunflower oil', 'Олія соняшникова нерафінована'), 1045, unitT, 20, 20, 'in', t('Хит экспорта', 'Export bestseller', 'Хіт експорту'),
      t('Кислотное число: до 2,5 мг KOH/г\nОтгрузка: флекситанк, ж/д цистерна', 'Acid value: max. 2.5 mg KOH/g\nShipping: flexitank, rail tank car', 'Кислотне число: до 2,5 мг KOH/г\nВідвантаження: флекситанк, залізнична цистерна')],
    ['oil-refined', 'SL-OIL-R1', t('Масло рафинированное, 1 л', 'Refined sunflower oil, 1 L', 'Олія рафінована, 1 л'), 26.4, t('кор. 15 × 1 л', 'case of 15 × 1 L', 'кор. 15 × 1 л'), 60, 60, 'in', t('Под вашей маркой', 'Private label', 'Під вашою маркою'),
      t('Бутылка: ПЭТ 1 л\nНа паллете: 60 коробок\nСрок годности: 18 месяцев', 'Bottle: PET 1 L\nPer pallet: 60 cases\nShelf life: 18 months', 'Пляшка: ПЕТ 1 л\nНа палеті: 60 коробок\nТермін придатності: 18 місяців')],
    ['soymeal', 'SL-SBM-46', t('Шрот соевый 46 %', 'Soybean meal 46 %', 'Шрот соєвий 46 %'), 418, unitT, 25, 25, 'in', null,
      t('Протеин: от 46 %\nКлетчатка: до 6,5 %\nВлажность: до 12 %', 'Protein: min. 46 %\nFibre: max. 6.5 %\nMoisture: max. 12 %', 'Протеїн: від 46 %\nКлітковина: до 6,5 %\nВологість: до 12 %')],
    ['pellets', 'SL-HSK-P', t('Гранулы лузги подсолнечника', 'Sunflower husk pellets', 'Гранули лушпиння соняшнику'), 118, unitT, 22, 22, 'in', null,
      t('Диаметр: 6–8 мм\nТеплотворность: 4,9 кВт·ч/кг\nЗольность: до 3 %', 'Diameter: 6–8 mm\nCalorific value: 4.9 kWh/kg\nAsh: max. 3 %', 'Діаметр: 6–8 мм\nТеплотворність: 4,9 кВт·год/кг\nЗольність: до 3 %')],
  ].map(([k, sku, name, price, unit, min, step, stock, badge, specs]) => K.item({
    sku, name: L(name), html: L(''), price, old: null, unit: L(unit), image: shot[k], badge: L(badge || ''), specs: L(specs), min, step, stock,
  }));

  // ----- seasonality table (crop × month, colspans with the activity name) -----
  const S = TPL_AGRO_SEASON;
  const M = { ru: ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'], en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], uk: ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру'] };
  const A = {
    sow: t('посев', 'sowing', 'сівба'), grow: t('вегетация', 'growing', 'вегетація'), harvest: t('уборка', 'harvest', 'збирання'),
    sale: t('продажа со склада', 'sales from storage', 'продаж зі складу'), make: t('производство', 'production', 'виробництво'), peak: t('пик выпуска', 'peak output', 'пік випуску'),
  };
  const span = (kind, n, label = kind) => {
    const out = [K.cell(label ? A[label] : '', { cs: n, bg: S[kind], align: 'center', va: 'middle' })];
    for (let i = 1; i < n; i++) out.push(K.mcell());
    return out;
  };
  const row = (name, ...spans) => [K.cell(name, { th: true }), ...spans.flat()];
  const seasonRows = [
    [K.cell(t('Культура', 'Crop', 'Культура'), { th: true }), ...M.ru.map((m, i) => K.cell(t(m, M.en[i], M.uk[i]), { th: true, align: 'center' }))],
    row(t('Пшеница озимая', 'Winter wheat', 'Пшениця озима'), span('sale', 6), span('harvest', 2), span('sow', 2), span('sale', 2)),
    row(t('Ячмень', 'Barley', 'Ячмінь'), span('sale', 2), span('sow', 2), span('grow', 2), span('harvest', 1), span('sale', 5)),
    row(t('Кукуруза', 'Corn', 'Кукурудза'), span('sale', 3), span('sow', 2), span('grow', 3), span('harvest', 3), span('sale', 1, '')),
    row(t('Подсолнечник', 'Sunflower', 'Соняшник'), span('sale', 3), span('sow', 2), span('grow', 3), span('harvest', 2), span('sale', 2)),
    row(t('Масло и шрот', 'Oil and meal', 'Олія та шрот'), span('make', 3, 'peak'), span('make', 6), span('make', 3, 'peak')),
  ];

  const sec = (o, blocks) => K.sec(o, blocks);
  d.regions.main = [
    B('hero', {
      layout: 'left', height: 'tall', bg: hero, overlay: 72, tone: 'dark',
      badge: L(t('Урожай-2026: приём заявок открыт', '2026 crop: orders are open', 'Урожай-2026: приймаємо замовлення')),
      eyebrow: L(t('Агрохолдинг «Широкий Лан» · с 1994 года', 'Shiroky Lan agricultural holding · since 1994', 'Агрохолдинг «Широкий Лан» · з 1994 року')),
      title: L(t('Зерно и подсолнечное масло оптом от производителя', 'Grain and sunflower oil wholesale, straight from the farm', 'Зерно та соняшникова олія оптом від виробника')),
      text: L(p('86 тысяч гектаров собственных полей, шесть элеваторов, маслозавод и своя логистика до порта. Фиксируем цену и качество в контракте, отгружаем от одной машины.',
        '86,000 hectares of our own fields, six elevators, an oil plant and our own logistics to the port. Price and quality are fixed in the contract; we ship from one truckload.',
        '86 тисяч гектарів власних полів, шість елеваторів, олійний завод і власна логістика до порту. Фіксуємо ціну та якість у контракті, відвантажуємо від однієї машини.')),
      items: [
        K.btn(t('Прайс и заказ', 'Prices and ordering', 'Прайс і замовлення'), '#products', 'primary', K.icon('wheat')),
        K.btn(t('Программа для фермеров', 'Farmer programme', 'Програма для фермерів'), '#farmers', 'secondary'),
      ],
    }),
    sec({ tone: 'dark', bgImage: topo, overlay: 10, pad: 's' }, [
      B('stats', {
        variant: 'plain', columns: 5, count: true, items: [
          K.item({ value: '86', suffix: L(t('тыс. га', 'k ha', 'тис. га')), label: L(t('пашни в обработке', 'of arable land farmed', 'ріллі в обробці')) }),
          K.item({ value: '420', suffix: L(t('тыс. т', 'k t', 'тис. т')), label: L(t('единовременного хранения', 'of storage capacity', 'одночасного зберігання')) }),
          K.item({ value: '1 200', suffix: L(t('т', 't', 'т')), label: L(t('семечки перерабатываем в сутки', 'of seeds crushed per day', 'насіння переробляємо за добу')) }),
          K.item({ value: '14', suffix: L(t('стран', 'countries', 'країн')), label: L(t('получают нашу продукцию', 'buy our products', 'отримують нашу продукцію')) }),
          K.item({ value: '320', suffix: L(''), label: L(t('фермерских хозяйств в кооперативе', 'partner farms in our co-op', 'фермерських господарств у кооперативі')) }),
        ],
      }),
    ]),
    sec({
      anchor: 'products', pad: 'm',
      eyebrow: t('Каталог · FCA элеватор, USD/т', 'Catalogue · FCA elevator, USD/t', 'Каталог · FCA елеватор, USD/т'),
      title: t('Оптовые поставки', 'Wholesale supply', 'Оптові поставки'),
      lead: p('Цены обновляются каждый понедельник. Минимальная партия — одна машина или один флекситанк; нужен другой объём или базис — укажите это в комментарии к заказу.',
        'Prices are updated every Monday. The minimum lot is one truck or one flexitank; for other volumes or delivery terms, add a note to your order.',
        'Ціни оновлюються щопонеділка. Мінімальна партія — одна машина або один флекситанк; потрібен інший обсяг чи базис — вкажіть це в коментарі до замовлення.'),
    }, [
      B('products', { variant: 'cards', columns: 4, ratio: '1/1', qty: true, items: products }),
      B('spacer', { h: 16 }),
      B('columns', {
        gap: 24, valign: 'center', cols: [
          col(50, [B('embed', { att: priceList, display: 'card', player: 'object', height: 520, ratio: 'auto', caption: L(''), dl: true, op: true })]),
          col(50, [B('quote', {
            variant: 'callout', tone: 'success', icon: K.icon('truck'), author: L(''),
            html: L(p('Самовывоз с любого из шести элеваторов (FCA), доставка по железной дороге до станции назначения (CPT) или отгрузка на судно в порту Лиманск (FOB) — логистику рассчитаем в подтверждении заказа.',
              'Pick-up at any of our six elevators (FCA), rail delivery to your station (CPT) or loading onto a vessel at Limansk port (FOB) — logistics are quoted in the order confirmation.',
              'Самовивіз із будь-якого з шести елеваторів (FCA), доставка залізницею до станції призначення (CPT) або відвантаження на судно в порту Лиманськ (FOB) — логістику розрахуємо в підтвердженні замовлення.')),
          })]),
        ],
      }),
    ]),
    sec({
      anchor: 'order', tone: 'muted', pad: 'm',
      eyebrow: t('Заказ', 'Order', 'Замовлення'),
      title: t('Ваша корзина', 'Your cart', 'Ваш кошик'),
      lead: p('Корзина сохраняется в этом браузере и синхронизируется между вкладками. Отправьте заказ — менеджер подтвердит наличие и цену в течение двух часов.',
        'Your cart is kept in this browser and synced between tabs. Send the order and a manager will confirm availability and price within two hours.',
        'Кошик зберігається в цьому браузері й синхронізується між вкладками. Надішліть замовлення — менеджер підтвердить наявність і ціну протягом двох годин.'),
    }, [
      B('cart', { title: L(''), text: L(''), form: true }),
    ]),
    sec({
      anchor: 'season', pad: 'm',
      eyebrow: t('Сезонность', 'Seasonality', 'Сезонність'),
      title: t('Календарь урожая и отгрузок', 'Crop and shipment calendar', 'Календар урожаю та відвантажень'),
      lead: p('Планируйте закупки по сезону: в первые недели уборки свежий урожай дешевле, а масло и шрот мы выпускаем круглый год.',
        'Plan your purchases by season: fresh crop is cheapest in the first weeks of harvest, while oil and meal are produced all year round.',
        'Плануйте закупівлі за сезоном: у перші тижні збирання свіжий урожай дешевший, а олію та шрот ми виробляємо цілий рік.'),
    }, [
      K.table(seasonRows, [16, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7], { header: 'both', variant: 'grid', compact: true, width: 100,
        caption: L(t('Сроки ориентировочные и зависят от погоды; продажа со склада — по наличию на элеваторах.',
          'Dates are indicative and depend on the weather; sales from storage subject to elevator stocks.',
          'Терміни орієнтовні й залежать від погоди; продаж зі складу — за наявності на елеваторах.')) }),
      B('spacer', { h: 24 }),
      K.head(t('Ближайшие события', 'Upcoming events', 'Найближчі події'), 3),
      B('events', {
        variant: 'list', columns: 3, hidePast: false, items: [
          K.item({ date: '2026-11-18', time: '10:00', title: L(t('Зерновой форум «Причерноморье-2026»', 'Black Sea Grain Forum 2026', 'Зерновий форум «Причорномор’я-2026»')), city: L(t('Лиманск', 'Limansk', 'Лиманськ')), venue: L(t('Морской вокзал, павильон B', 'Sea terminal, hall B', 'Морський вокзал, павільйон B')), status: 'on', price: null, sku: '', href: '' }),
          K.item({ date: '2026-12-03', time: '11:00', title: L(t('День открытых дверей на элеваторе «Ланоград-2»', 'Open day at the Lanohrad-2 elevator', 'День відкритих дверей на елеваторі «Ланоград-2»')), city: L(t('Ланоград', 'Lanohrad', 'Ланоград')), venue: L(t('Элеватор «Ланоград-2»', 'Lanohrad-2 elevator', 'Елеватор «Ланоград-2»')), status: 'on', price: null, sku: '', href: '' }),
          K.item({ date: '2027-02-12', time: '09:30', title: L(t('Семинар для фермеров: подготовка к посевной', 'Farmers seminar: getting ready for sowing', 'Семінар для фермерів: підготовка до сівби')), city: L(t('Ланоград', 'Lanohrad', 'Ланоград')), venue: L(t('Агроцентр «Широкий Лан»', 'Shiroky Lan agro centre', 'Агроцентр «Широкий Лан»')), status: 'on', price: null, sku: '', href: '' }),
          K.item({ date: '2027-06-17', time: '10:00', title: L(t('День поля: озимая пшеница', 'Field day: winter wheat', 'День поля: озима пшениця')), city: L(t('с. Ковыльное', 'Kovylne', 'с. Ковильне')), venue: L(t('Опытное поле № 4', 'Trial field No. 4', 'Дослідне поле № 4')), status: 'on', price: null, sku: '', href: '' }),
          K.item({ date: '2027-07-05', time: '', title: L(t('Старт уборки ранних зерновых', 'Start of the early grain harvest', 'Старт збирання ранніх зернових')), city: L(t('все отделения', 'all farm units', 'усі відділення')), venue: L(''), status: 'on', price: null, sku: '', href: '' }),
        ],
      }),
    ]),
    sec({
      anchor: 'farmers', tone: 'muted', pad: 'm',
      eyebrow: t('Фермерам', 'For farmers', 'Фермерам'),
      title: t('Партнёрская программа для фермеров', 'Partner programme for farmers', 'Партнерська програма для фермерів'),
      lead: p('320 хозяйств уже продают урожай через наши элеваторы и получают семена, удобрения и поддержку агрономов на условиях холдинга.',
        '320 farms already sell their crop through our elevators and get seeds, fertilisers and agronomy support on the holding’s terms.',
        '320 господарств уже продають урожай через наші елеватори й отримують насіння, добрива та підтримку агрономів на умовах холдингу.'),
    }, [
      B('features', {
        variant: 'split', columns: 2, items: [
          K.item({ icon: K.icon('wheat'), image: scene.rows,
            title: L(t('Форвардные контракты и закупка урожая', 'Forward contracts and crop purchase', 'Форвардні контракти та закупівля врожаю')),
            html: L(t(
              '<p>Фиксируем цену до посевной и принимаем зерно на ближайшем элеваторе. Сушка, очистка и хранение — по себестоимости, оплата — в течение трёх банковских дней после приёмки.</p><ul><li>Аванс до 30 % под будущий урожай</li><li>Лабораторный протокол на каждую машину</li><li>Личный кабинет с остатками на складе</li></ul>',
              '<p>We fix the price before sowing and take your grain in at the nearest elevator. Drying, cleaning and storage at cost; payment within three banking days of intake.</p><ul><li>Advance of up to 30 % on the coming crop</li><li>A laboratory report for every truck</li><li>Online account with your stock balance</li></ul>',
              '<p>Фіксуємо ціну до сівби й приймаємо зерно на найближчому елеваторі. Сушіння, очищення та зберігання — за собівартістю, оплата — протягом трьох банківських днів після приймання.</p><ul><li>Аванс до 30 % під майбутній урожай</li><li>Лабораторний протокол на кожну машину</li><li>Особистий кабінет із залишками на складі</li></ul>')) }),
          K.item({ icon: K.icon('sprout'), image: soil,
            title: L(t('Агросопровождение и ресурсы', 'Agronomy support and inputs', 'Агросупровід і ресурси')),
            html: L(t(
              '<p>Агрономы холдинга помогут с севооборотом, анализом почвы и защитой посевов, а семена, удобрения и СЗР вы получаете по ценам холдинга с оплатой после уборки.</p><ul><li>Анализ почвы и карта внесения удобрений</li><li>Совместные закупки со скидкой до 18 %</li><li>Аренда техники в пиковый сезон</li></ul>',
              '<p>Our agronomists help with crop rotation, soil analysis and crop protection, and you buy seeds, fertilisers and crop protection at holding prices with payment after harvest.</p><ul><li>Soil analysis and a fertiliser application map</li><li>Joint purchasing with up to 18 % off</li><li>Machinery hire in the peak season</li></ul>',
              '<p>Агрономи холдингу допоможуть із сівозміною, аналізом ґрунту та захистом посівів, а насіння, добрива й ЗЗР ви отримуєте за цінами холдингу з оплатою після збирання.</p><ul><li>Аналіз ґрунту та карта внесення добрив</li><li>Спільні закупівлі зі знижкою до 18 %</li><li>Оренда техніки в піковий сезон</li></ul>')) }),
        ],
      }),
      B('spacer', { h: 24 }),
      K.head(t('Как присоединиться', 'How to join', 'Як долучитися'), 3, { align: 'left' }),
      B('steps', {
        variant: 'cards', items: [
          K.item({ title: L(t('Заявка', 'Request', 'Заявка')), html: L(p('Оставьте заявку на сайте или позвоните агроному программы.', 'Send a request on the website or call the programme agronomist.', 'Залиште заявку на сайті або зателефонуйте агроному програми.')) }),
          K.item({ title: L(t('Выезд агронома', 'Agronomist visit', 'Виїзд агронома')), html: L(p('Осмотрим поля и склады, оценим урожай и потребность в ресурсах.', 'We inspect your fields and storage and assess the crop and input needs.', 'Оглянемо поля та склади, оцінимо врожай і потребу в ресурсах.')) }),
          K.item({ title: L(t('Договор на сезон', 'Season agreement', 'Договір на сезон')), html: L(p('Подписываем рамочный договор: цена, объём, график сдачи.', 'We sign a framework agreement: price, volume and delivery schedule.', 'Підписуємо рамковий договір: ціна, обсяг, графік здачі.')) }),
          K.item({ title: L(t('Первая поставка', 'First delivery', 'Перша поставка')), html: L(p('Сдаёте урожай на элеватор и получаете оплату за три дня.', 'You deliver to the elevator and get paid within three days.', 'Здаєте врожай на елеватор і отримуєте оплату за три дні.')) }),
        ],
      }),
      B('columns', {
        gap: 20, valign: 'center', cols: [
          col(60, [B('buttons', { align: 'left', items: [
            K.btn(t('Стать партнёром', 'Become a partner', 'Стати партнером'), '#contact', 'primary', K.icon('tractor')),
            K.btn(t('Условия программы (PDF)', 'Programme terms (PDF)', 'Умови програми (PDF)'), '#att-' + terms, 'ghost', K.icon('download')),
          ] })]),
          col(40, [B('embed', { att: terms, display: 'card', player: 'object', height: 520, ratio: 'auto', caption: L(''), dl: true, op: true })]),
        ],
      }),
    ]),
    sec({
      anchor: 'logistics', pad: 'm',
      eyebrow: t('Логистика', 'Logistics', 'Логістика'),
      title: t('От поля до причала — своими силами', 'From field to quay — all in-house', 'Від поля до причалу — власними силами'),
    }, [
      B('features', {
        variant: 'split', columns: 2, items: [
          K.item({ icon: K.icon('truck'), image: map,
            title: L(t('Шесть элеваторов, своя ветка и терминал в порту', 'Six elevators, our own rail siding and a port terminal', 'Шість елеваторів, своя гілка й термінал у порту')),
            html: L(t(
              '<p>Все элеваторы стоят на железной дороге не дальше 60 км от полей. Зерно уходит в порт собственными хопперами, а масло — в флекситанках и цистернах.</p><ul><li>420 тыс. т единовременного хранения</li><li>380 вагонов-хопперов и 140 зерновозов</li><li>Портовый терминал: 12 тыс. т в сутки</li></ul>',
              '<p>Every elevator sits on the railway within 60 km of our fields. Grain travels to the port in our own hopper cars, oil in flexitanks and tank cars.</p><ul><li>420,000 t of storage capacity</li><li>380 hopper cars and 140 grain trucks</li><li>Port terminal: 12,000 t per day</li></ul>',
              '<p>Усі елеватори стоять на залізниці не далі ніж 60 км від полів. Зерно йде в порт власними хоперами, а олія — у флекситанках і цистернах.</p><ul><li>420 тис. т одночасного зберігання</li><li>380 вагонів-хоперів і 140 зерновозів</li><li>Портовий термінал: 12 тис. т на добу</li></ul>')) }),
        ],
      }),
      B('spacer', { h: 20 }),
      B('gallery', {
        variant: 'slider', columns: 3, ratio: '4/3', gap: 16, zoom: true, items: [
          K.item({ att: scene.harvest, caption: L(t('Уборка пшеницы, отделение «Ковыльное»', 'Wheat harvest, Kovylne unit', 'Збирання пшениці, відділення «Ковильне»')) }),
          K.item({ att: scene.sunflowers, caption: L(t('Подсолнечник перед уборкой', 'Sunflowers before harvest', 'Соняшник перед збиранням')) }),
          K.item({ att: scene.elevator, caption: L(t('Элеватор «Ланоград-2» на закате', 'Lanohrad-2 elevator at sunset', 'Елеватор «Ланоград-2» на заході сонця')) }),
          K.item({ att: scene.rail, caption: L(t('Маршрутный поезд из 54 хопперов', 'Block train of 54 hopper cars', 'Маршрутний поїзд із 54 хоперів')) }),
          K.item({ att: scene.port, caption: L(t('Погрузка судна в порту Лиманск', 'Vessel loading at Limansk port', 'Навантаження судна в порту Лиманськ')) }),
          K.item({ att: scene.rows, caption: L(t('Всходы озимых в октябре', 'Winter crop seedlings in October', 'Сходи озимих у жовтні')) }),
        ],
      }),
    ]),
    sec({
      anchor: 'quality', tone: 'dark', pad: 'm',
      eyebrow: t('Качество', 'Quality', 'Якість'),
      title: t('Качество, которое можно проверить', 'Quality you can verify', 'Якість, яку можна перевірити'),
      lead: p('Лаборатория на каждом элеваторе: пробу отбирают при приёмке и при отгрузке, а протокол прикладывается к документам на партию.',
        'A laboratory at every elevator: samples are taken at intake and at loading, and the report travels with the lot documents.',
        'Лабораторія на кожному елеваторі: пробу відбирають під час приймання та відвантаження, а протокол додається до документів на партію.'),
    }, [
      B('features', {
        variant: 'icons', columns: 4, items: [
          K.item({ icon: K.icon('target'), title: L(t('Своя лаборатория', 'In-house laboratory', 'Власна лабораторія')), html: L(p('Протеин, клейковина, влажность и натура — за 40 минут.', 'Protein, gluten, moisture and test weight in 40 minutes.', 'Протеїн, клейковина, вологість і натура — за 40 хвилин.')) }),
          K.item({ icon: K.icon('file'), title: L(t('Протокол на партию', 'A report per lot', 'Протокол на партію')), html: L(p('Арбитражная проба хранится три месяца после отгрузки.', 'An arbitration sample is kept for three months after loading.', 'Арбітражна проба зберігається три місяці після відвантаження.')) }),
          K.item({ icon: K.icon('shield'), title: L(t('Экспортные документы', 'Export documents', 'Експортні документи')), html: L(p('Фитосанитарный сертификат и сертификат происхождения.', 'Phytosanitary certificate and certificate of origin.', 'Фітосанітарний сертифікат і сертифікат походження.')) }),
          K.item({ icon: K.icon('leaf'), title: L(t('Прослеживаемость', 'Traceability', 'Простежуваність')), html: L(p('Каждая партия прослеживается до поля и даты уборки.', 'Every lot can be traced back to its field and harvest date.', 'Кожну партію можна простежити до поля й дати збирання.')) }),
        ],
      }),
      B('spacer', { h: 16 }),
      B('columns', {
        gap: 32, valign: 'top', cols: [
          col(58, [
            K.head(t('Пшеница 3 класса: урожай 2026', 'Wheat, class 3: 2026 crop', 'Пшениця 3 класу: урожай 2026'), 4),
            K.table([
              [K.cell(t('Показатель', 'Parameter', 'Показник'), { th: true }), K.cell(t('Норма контракта', 'Contract spec', 'Норма контракту'), { th: true, align: 'right' }), K.cell(t('Среднее 2026', '2026 average', 'Середнє 2026'), { th: true, align: 'right' })],
              [K.cell(t('Протеин', 'Protein', 'Протеїн')), K.cell(t('≥ 12,5 %', '≥ 12.5 %', '≥ 12,5 %'), { align: 'right' }), K.cell(t('<strong>13,1 %</strong>', '<strong>13.1 %</strong>', '<strong>13,1 %</strong>'), { align: 'right' })],
              [K.cell(t('Клейковина', 'Wet gluten', 'Клейковина')), K.cell('≥ 23 %', { align: 'right' }), K.cell(t('<strong>25,4 %</strong>', '<strong>25.4 %</strong>', '<strong>25,4 %</strong>'), { align: 'right' })],
              [K.cell(t('Влажность', 'Moisture', 'Вологість')), K.cell('≤ 14 %', { align: 'right' }), K.cell(t('<strong>12,6 %</strong>', '<strong>12.6 %</strong>', '<strong>12,6 %</strong>'), { align: 'right' })],
              [K.cell(t('Натура', 'Test weight', 'Натура')), K.cell(t('≥ 750 г/л', '≥ 750 g/l', '≥ 750 г/л'), { align: 'right' }), K.cell(t('<strong>781 г/л</strong>', '<strong>781 g/l</strong>', '<strong>781 г/л</strong>'), { align: 'right' })],
              [K.cell(t('Число падения', 'Falling number', 'Число падіння')), K.cell(t('≥ 250 с', '≥ 250 s', '≥ 250 с'), { align: 'right' }), K.cell(t('<strong>312 с</strong>', '<strong>312 s</strong>', '<strong>312 с</strong>'), { align: 'right' })],
              [K.cell(t('Сорная примесь', 'Foreign matter', 'Смітна домішка')), K.cell('≤ 2 %', { align: 'right' }), K.cell(t('<strong>0,8 %</strong>', '<strong>0.8 %</strong>', '<strong>0,8 %</strong>'), { align: 'right' })],
            ], [40, 30, 30], { header: 'row', variant: 'lines', compact: false, width: 100 }),
          ]),
          col(42, [
            B('embed', { att: protocol, display: 'card', player: 'object', height: 520, ratio: 'auto', caption: L(''), dl: true, op: true }),
            B('quote', {
              variant: 'pull', tone: 'accent', icon: '',
              html: L(p('Если показатели партии не совпадут с контрактом, мы пересчитаем цену или заменим партию — без споров.',
                'If a lot does not match the contract, we re-price or replace it — no arguments.',
                'Якщо показники партії не збігуться з контрактом, ми перерахуємо ціну або замінимо партію — без суперечок.')),
              author: L(t('Василий Гнатюк, руководитель лаборатории', 'Vasyl Hnatiuk, head of the laboratory', 'Василь Гнатюк, керівник лабораторії')),
            }),
          ]),
        ],
      }),
    ]),
    sec({
      anchor: 'team', pad: 'm', align: 'center',
      eyebrow: t('Команда', 'Team', 'Команда'),
      title: t('Люди, которые отвечают за урожай', 'The people behind the harvest', 'Люди, які відповідають за врожай'),
    }, [
      B('team', {
        variant: 'round', columns: 4, items: [
          K.item({ photo: people[0], name: L(t('Ольга Крамаренко', 'Olha Kramarenko', 'Ольга Крамаренко')), role: L(t('Генеральный директор', 'Chief executive', 'Генеральна директорка')),
            html: L(p('Агроном по образованию, 25 лет в компании — от отделения в Ковыльном до руководства холдингом.', 'An agronomist by training, 25 years with the company — from the Kovylne unit to the head of the holding.', 'Агрономка за освітою, 25 років у компанії — від відділення в Ковильному до керівництва холдингом.')), href: '' }),
          K.item({ photo: people[1], name: L(t('Сергей Бондарь', 'Serhii Bondar', 'Сергій Бондар')), role: L(t('Главный агроном', 'Chief agronomist', 'Головний агроном')),
            html: L(p('Отвечает за 86 тысяч гектаров и сопровождение фермеров-партнёров.', 'Responsible for 86,000 hectares and the partner farmers’ support.', 'Відповідає за 86 тисяч гектарів і супровід фермерів-партнерів.')), href: '' }),
          K.item({ photo: people[2], name: L(t('Дина Ахметова', 'Dina Akhmetova', 'Діна Ахметова')), role: L(t('Директор по экспорту', 'Export director', 'Директорка з експорту')),
            html: L(p('Ведёт контракты с покупателями в 14 странах, говорит на английском и турецком.', 'Handles contracts with buyers in 14 countries; speaks English and Turkish.', 'Веде контракти з покупцями в 14 країнах, говорить англійською та турецькою.')), href: '' }),
          K.item({ photo: people[3], name: L(t('Василий Гнатюк', 'Vasyl Hnatiuk', 'Василь Гнатюк')), role: L(t('Руководитель лаборатории', 'Head of the laboratory', 'Керівник лабораторії')),
            html: L(p('Кандидат сельскохозяйственных наук, автор методики ускоренного анализа клейковины.', 'PhD in agriculture; developed our rapid gluten analysis method.', 'Кандидат сільськогосподарських наук, автор методики прискореного аналізу клейковини.')), href: '' }),
        ],
      }),
    ]),
    sec({
      tone: 'muted', pad: 'm', align: 'center',
      eyebrow: t('Отзывы', 'Testimonials', 'Відгуки'),
      title: t('Нам доверяют мельницы, трейдеры и фермеры', 'Trusted by mills, traders and farmers', 'Нам довіряють млини, трейдери та фермери'),
    }, [
      B('testimonials', {
        variant: 'cards', columns: 3, items: [
          K.item({ rating: 5, photo: null,
            html: L(p('Берём пшеницу третьего класса уже пятый сезон. Протокол лаборатории всегда совпадает с нашим входным контролем — это экономит дни на приёмке.',
              'This is our fifth season buying class 3 wheat. Their lab report always matches our intake control, which saves us days at reception.',
              'Беремо пшеницю третього класу вже п’ятий сезон. Протокол лабораторії завжди збігається з нашим вхідним контролем — це економить дні на прийманні.')),
            name: L(t('Арсений Лукин', 'Arsenii Lukin', 'Арсеній Лукін')), role: L(t('Технолог, мелькомбинат «Белый Жёрнов»', 'Technologist, White Millstone flour mill', 'Технолог, млинкомбінат «Білий Жорен»')) }),
          K.item({ rating: 5, photo: null,
            html: L(p('В кооперативе с 2019 года. Цену фиксирую весной, а осенью сдаю зерно на элеватор в 12 км от хозяйства — без перекупщиков и споров о влажности.',
              'I joined the co-op in 2019. I fix my price in spring and deliver grain in autumn to an elevator 12 km from the farm — no middlemen, no arguing about moisture.',
              'У кооперативі з 2019 року. Ціну фіксую навесні, а восени здаю зерно на елеватор за 12 км від господарства — без перекупників і суперечок про вологість.')),
            name: L(t('Николай Ступак', 'Mykola Stupak', 'Микола Ступак')), role: L(t('Фермер, 640 га, с. Ковыльное', 'Farmer, 640 ha, Kovylne', 'Фермер, 640 га, с. Ковильне')) }),
          K.item({ rating: 5, photo: null,
            html: L(p('Масло во флекситанках приходит в срок и в спецификации, а документы готовы ещё до погрузки судна.',
              'Crude oil in flexitanks arrives on time and on spec, and the documents are ready before the vessel is loaded.',
              'Олія у флекситанках приходить вчасно й у специфікації, а документи готові ще до навантаження судна.')),
            name: L(t('Мехмет Йылдыз', 'Mehmet Yıldız', 'Мехмет Йилдиз')), role: L(t('Трейдер растительных масел, Karadeniz Yağ Ticaret', 'Vegetable oil trader, Karadeniz Yağ Ticaret', 'Трейдер рослинних олій, Karadeniz Yağ Ticaret')) }),
        ],
      }),
      B('spacer', { h: 20 }),
      B('logos', { variant: 'marquee', speed: 40, mono: true, items: partners.map((x) => K.item({ att: x.id, name: L(x.name), href: '' })) }),
    ]),
    sec({
      anchor: 'faq', pad: 'm',
      eyebrow: t('Вопросы и ответы', 'FAQ', 'Питання та відповіді'),
      title: t('Частые вопросы покупателей', 'Buyers’ frequent questions', 'Часті питання покупців'),
    }, [
      B('faq', {
        variant: 'cards', openFirst: false, items: [
          K.item({ q: L(t('Какая минимальная партия?', 'What is the minimum order?', 'Яка мінімальна партія?')),
            html: L(p('Одна машина: 25 т зерна или шрота, 20 т семечки, один флекситанк масла или паллета фасованного масла (60 коробок). Минимум указан в карточке каждого товара.',
              'One truckload: 25 t of grain or meal, 20 t of seeds, one flexitank of oil or one pallet of bottled oil (60 cases). The minimum is shown on every product card.',
              'Одна машина: 25 т зерна або шроту, 20 т насіння, один флекситанк олії або палета фасованої олії (60 коробок). Мінімум указано в картці кожного товару.')) }),
          K.item({ q: L(t('Как формируется цена?', 'How are prices set?', 'Як формується ціна?')),
            html: L(p('Цены в прайсе — FCA элеватор, в долларах США за тонну без НДС. Мы обновляем их каждый понедельник; цена фиксируется в момент подтверждения заказа.',
              'List prices are FCA elevator, in US dollars per tonne excluding VAT. We update them every Monday; the price is fixed when your order is confirmed.',
              'Ціни в прайсі — FCA елеватор, у доларах США за тонну без ПДВ. Ми оновлюємо їх щопонеділка; ціна фіксується в момент підтвердження замовлення.')) }),
          K.item({ q: L(t('Какие условия оплаты?', 'What are the payment terms?', 'Які умови оплати?')),
            html: L(p('Для новых покупателей — предоплата 100 %, для постоянных — отсрочка до 14 дней. Работаем по договору поставки, расчёт в USD, EUR или национальной валюте.',
              'New customers pay 100 % in advance; regular customers get up to 14 days’ credit. We work under a supply contract and settle in USD, EUR or local currency.',
              'Для нових покупців — передоплата 100 %, для постійних — відстрочка до 14 днів. Працюємо за договором поставки, розрахунок у USD, EUR або національній валюті.')) }),
          K.item({ q: L(t('Какие документы прилагаются к партии?', 'Which documents come with a lot?', 'Які документи додаються до партії?')),
            html: L(p('Удостоверение качества, протокол лаборатории и фитосанитарный сертификат; для экспорта — ещё сертификат происхождения. Образец протокола есть в разделе «Качество».',
              'A quality certificate, the laboratory report and a phytosanitary certificate; for export also a certificate of origin. A sample report is in the Quality section.',
              'Посвідчення якості, протокол лабораторії та фітосанітарний сертифікат; для експорту — ще сертифікат походження. Зразок протоколу є в розділі «Якість».')) }),
          K.item({ q: L(t('Что если качество не совпадёт?', 'What if the quality does not match?', 'Що робити, якщо якість не збіжиться?')),
            html: L(p('Арбитражная проба хранится три месяца. При расхождении проводим независимую экспертизу — и если правы вы, пересчитываем цену или заменяем партию.',
              'An arbitration sample is kept for three months. In case of a dispute we order an independent inspection — and if you are right, we re-price or replace the lot.',
              'Арбітражна проба зберігається три місяці. У разі розбіжності проводимо незалежну експертизу — і якщо праві ви, перераховуємо ціну або замінюємо партію.')) }),
          K.item({ q: L(t('Как вступить в фермерскую программу?', 'How do I join the farmer programme?', 'Як долучитися до фермерської програми?')),
            html: L(p('Отправьте заявку через форму ниже с темой «Фермерская программа». Агроном свяжется с вами в течение недели и договорится о выезде в хозяйство.',
              'Send a request through the form below with the topic “Farmer programme”. An agronomist will contact you within a week to arrange a farm visit.',
              'Надішліть заявку через форму нижче з темою «Фермерська програма». Агроном зв’яжеться з вами протягом тижня й домовиться про виїзд у господарство.')) }),
        ],
      }),
    ]),
    B('cta', {
      variant: 'banner', tone: 'dark', bg: dusk, overlay: 30,
      title: L(t('Урожай-2026 уже на элеваторах', 'The 2026 crop is in our elevators', 'Урожай-2026 уже на елеваторах')),
      html: L(p('Зафиксируйте цену на ближайшие поставки — менеджер подготовит контракт за один рабочий день.',
        'Lock in the price for your next deliveries — a manager will prepare the contract within one working day.',
        'Зафіксуйте ціну на найближчі поставки — менеджер підготує контракт за один робочий день.')),
      items: [
        K.btn(t('Перейти к заказу', 'Go to ordering', 'Перейти до замовлення'), '#products', 'primary', K.icon('cart')),
        K.btn('+7 000 000-19-94', 'tel:+70000001994', 'secondary', K.icon('phone')),
      ],
    }),
    sec({
      anchor: 'contact', tone: 'muted', pad: 'm',
      eyebrow: t('Контакты', 'Contact', 'Контакти'),
      title: t('Свяжитесь с нами', 'Get in touch', 'Зв’яжіться з нами'),
    }, [
      B('columns', {
        gap: 40, valign: 'top', cols: [
          col(40, [
            ...[['ru', 'ул. Элеваторная, 1\nЛаноград, 000000', 'Пн–Пт, 8:00–18:00\nв сезон уборки — без выходных', ['Главный офис', 'Отдел продаж', 'Продажи', 'Фермерская программа', 'Часы работы']],
              ['en', '1 Elevatorna St\nLanohrad 000000', 'Mon–Fri, 8:00–18:00\ndaily during harvest', ['Head office', 'Sales desk', 'Sales', 'Farmer programme', 'Opening hours']],
              ['uk', 'вул. Елеваторна, 1\nЛаноград, 000000', 'Пн–Пт, 8:00–18:00\nу сезон збирання — без вихідних', ['Головний офіс', 'Відділ продажів', 'Продажі', 'Фермерська програма', 'Години роботи']]].map(([l, addr, hours, lab]) => B('contact', {
              variant: 'list', labels: true, map: null, mapHref: '', langs: [l], items: [
                K.item({ kind: 'address', value: addr, label: L(lab[0]), href: '' }),
                K.item({ kind: 'phone', value: '+7 000 000-19-94', label: L(lab[1]), href: '' }),
                K.item({ kind: 'email', value: 'trade@shirokylan.example', label: L(lab[2]), href: '' }),
                K.item({ kind: 'email', value: 'farm@shirokylan.example', label: L(lab[3]), href: '' }),
                K.item({ kind: 'hours', value: hours, label: L(lab[4]), href: '' }),
              ],
            })),
          ]),
          col(60, [
            B('form', {
              variant: 'card', req: reqInbox, fallback: 'mailto', to: 'hello@shirokylan.example',
              title: L(t('Напишите нам', 'Write to us', 'Напишіть нам')),
              submit: L(t('Отправить', 'Send', 'Надіслати')),
              success: L(t('Спасибо! Мы ответим в течение рабочего дня.', 'Thank you! We will reply within one working day.', 'Дякуємо! Ми відповімо протягом робочого дня.')),
              consent: L(p('Отправляя форму, вы соглашаетесь на обработку контактных данных для ответа на обращение.',
                'By sending the form you agree that we process your contact details to answer your message.',
                'Надсилаючи форму, ви погоджуєтеся на обробку контактних даних для відповіді на звернення.')),
              items: [
                field('name', 'text', t('Имя', 'Name', 'Ім’я'), '', { required: true, half: true }),
                field('farm', 'text', t('Компания или хозяйство', 'Company or farm', 'Компанія або господарство'), '', { half: true }),
                field('email', 'email', t('E-mail', 'E-mail', 'E-mail'), 'name@company.example', { required: true, half: true }),
                field('phone', 'tel', t('Телефон', 'Phone', 'Телефон'), '+7 000 000-00-00', { half: true }),
                field('topic', 'select', t('Тема', 'Topic', 'Тема'), '', {
                  options: t('Закупка продукции\nФермерская программа\nЛогистика и хранение\nДругое', 'Buying products\nFarmer programme\nLogistics and storage\nOther', 'Закупівля продукції\nФермерська програма\nЛогістика та зберігання\nІнше'),
                }),
                field('message', 'textarea', t('Сообщение', 'Message', 'Повідомлення'), '', { required: true }),
              ],
            }),
          ]),
        ],
      }),
    ]),
  ];

  // ----- footer -----
  const ul = (rows) => '<ul>' + rows.map(([h, x]) => '<li><a href="' + h + '">' + x + '</a></li>').join('') + '</ul>';
  const contacts = '<p><a href="tel:+70000001994">+7 000 000-19-94</a><br><a href="mailto:trade@shirokylan.example">trade@shirokylan.example</a></p>';
  d.regions.footer = [
    B('footer', {
      variant: 'columns', tone: 'dark', logo: brand, logoH: 48,
      brand: L(t('Широкий Лан', 'Shiroky Lan', 'Широкий Лан')),
      text: L(t(
        '<p>Агрохолдинг полного цикла: поле, элеватор, маслозавод и порт.</p>' + contacts,
        '<p>A full-cycle agricultural holding: field, elevator, oil plant and port.</p>' + contacts,
        '<p>Агрохолдинг повного циклу: поле, елеватор, олійний завод і порт.</p>' + contacts)),
      items: [
        K.item({ title: L(t('Продукция', 'Products', 'Продукція')), html: L(t(
          ul([['#products', 'Зерно и семечка'], ['#products', 'Подсолнечное масло'], ['#products', 'Шрот и гранулы'], ['#order', 'Корзина и заказ']]),
          ul([['#products', 'Grain and seeds'], ['#products', 'Sunflower oil'], ['#products', 'Meal and pellets'], ['#order', 'Cart and ordering']]),
          ul([['#products', 'Зерно та насіння'], ['#products', 'Соняшникова олія'], ['#products', 'Шрот і гранули'], ['#order', 'Кошик і замовлення']]))) }),
        K.item({ title: L(t('Компания', 'Company', 'Компанія')), html: L(t(
          ul([['#farmers', 'Фермерам'], ['#logistics', 'Логистика'], ['#quality', 'Качество'], ['#team', 'Команда']]),
          ul([['#farmers', 'For farmers'], ['#logistics', 'Logistics'], ['#quality', 'Quality'], ['#team', 'Team']]),
          ul([['#farmers', 'Фермерам'], ['#logistics', 'Логістика'], ['#quality', 'Якість'], ['#team', 'Команда']]))) }),
        K.item({ title: L(t('Документы', 'Documents', 'Документи')), html: L(t(
          ul([['#att-' + priceList, 'Прайс-лист (PDF)'], ['#att-' + protocol, 'Образец протокола'], ['#att-' + terms, 'Условия программы']]),
          ul([['#att-' + priceList, 'Price list (PDF)'], ['#att-' + protocol, 'Sample test report'], ['#att-' + terms, 'Programme terms']]),
          ul([['#att-' + priceList, 'Прайс-лист (PDF)'], ['#att-' + protocol, 'Зразок протоколу'], ['#att-' + terms, 'Умови програми']]))) }),
      ],
      copy: L(t('© 1994–2026 Агрохолдинг «Широкий Лан», Ланоград', '© 1994–2026 Shiroky Lan agricultural holding, Lanohrad', '© 1994–2026 Агрохолдинг «Широкий Лан», Ланоград')),
    }),
  ];
  return V.normalizeDoc(d);
}

const TPL_AGRO = {
  id: 'agro',
  name: { en: 'Agro', ru: 'Агро', de: 'Agrar', fr: 'Agro', es: 'Agro', uk: 'Агро', ka: 'აგრო' },
  desc: {
    en: 'Agricultural holding: wholesale grain and oil with units and minimum lots, synced cart and order form, crop calendar and events, farmer programme, logistics, quality lab, team, reviews and price list PDF.',
    ru: 'Агрохолдинг: опт зерна и масла с единицами и минимальными партиями, синхронизируемая корзина и заказ, календарь урожая и события, программа для фермеров, логистика, лаборатория, команда, отзывы и прайс в PDF.',
    de: 'Agrarholding: Getreide und Öl im Großhandel mit Einheiten und Mindestmengen, synchronisierter Warenkorb mit Bestellung, Erntekalender und Termine, Landwirteprogramm, Logistik, Labor, Team, Stimmen und Preisliste als PDF.',
    fr: 'Holding agricole : céréales et huile en gros avec unités et lots minimum, panier synchronisé et commande, calendrier des récoltes et événements, programme agriculteurs, logistique, laboratoire, équipe, avis et tarif PDF.',
    es: 'Holding agrícola: grano y aceite al por mayor con unidades y lotes mínimos, carrito sincronizado y pedido, calendario de cosechas y eventos, programa para agricultores, logística, laboratorio, equipo, opiniones y lista de precios en PDF.',
    uk: 'Агрохолдинг: опт зерна й олії з одиницями та мінімальними партіями, синхронізований кошик і замовлення, календар урожаю та події, програма для фермерів, логістика, лабораторія, команда, відгуки й прайс у PDF.',
    ka: 'აგროჰოლდინგი: მარცვლეულისა და ზეთის საბითუმო გაყიდვა ერთეულებითა და მინიმალური პარტიებით, სინქრონიზებული კალათა და შეკვეთა, მოსავლის კალენდარი და ღონისძიებები, ფერმერთა პროგრამა, ლოგისტიკა, ლაბორატორია, გუნდი, შეფასებები და PDF ფასები.',
  },
  langs: ['ru', 'en', 'uk'],
  build: tplBuildAgro,
};

export {
  TPL_AGRO,
  TPL_AGRO_SEASON,
  tplBuildAgro,
  TPL_AGRO_INK,
  tplAgroBand,
  tplAgroBrand,
  tplAgroCloud,
  tplAgroCombineDef,
  tplAgroDusk,
  tplAgroEarDef,
  tplAgroElevator,
  tplAgroGrainPat,
  tplAgroHero,
  tplAgroHopper,
  tplAgroLandDefs,
  tplAgroLg,
  tplAgroLogo,
  tplAgroLoop,
  tplAgroLoose,
  tplAgroMap,
  tplAgroMound,
  tplAgroN,
  tplAgroPortrait,
  tplAgroProduct,
  tplAgroRays,
  tplAgroRg,
  tplAgroRidge,
  tplAgroSack,
  tplAgroScene,
  tplAgroSmooth,
  tplAgroSoil,
  tplAgroStops,
  tplAgroStripes,
  tplAgroSunDef,
  tplAgroSvg,
  tplAgroTopo,
  tplAgroTree,
  tplAgroTrees,
  tplAgroTruck,
  tplAgroUse
};
