// motif/repeat.js - print designs: a base cell (w x h cm) with motif layers, a repeat type that arranges copies of
// the cell into the repeat unit, colourways (the layers name colour indexes, a colourway maps them to colours),
// rendering of the seamless unit to RGBA (shapes crossing the unit edge wrap round), colour separations with their
// coverage, an SVG of the unit, and placement prints (artwork positioned on a pattern piece in centimetres).
//
//   REPEATS = ['block', 'halfDrop', 'brick', 'mirror', 'rotate']
//   normalizeDesign(raw) -> design      repeatUnit(design) -> { w, h, cells: [{ m (cell cm -> unit cm), flip }] }
//   renderUnit(design, { pxPerCm, colorway, images, size }) -> { width, height, data, cm: [w, h] }
//   renderInto(cv, design, m (unit cm -> canvas px), opts)  (tiles the unit over a target canvas: piece textures)
//   separations(design, { pxPerCm }) -> [{ index, color, coverage, mask: Uint8Array }]
//   designSVG(design, { colorway }) -> SVG of one unit       seamlessCheck(design) -> { worst, ok }
//   normalizePlacement(raw) -> { id, piece, side, x, y, w, h, rot, art }
//
// Units: the design lives in centimetres (fabric is specified physically); pixels appear only at render time through
// pxPerCm, so one design renders at preview density and print density from the same data.
// Every entry point re-normalizes its input, so callers may pass raw JSON (saved files, imports) without validating.

import { MOTIFS, motifPolys, motifPath } from './motifs.js';
import { canvas, drawImage, fillPolys, mulM, trsM, hexToRgb } from './raster.js';

export const REPEATS = ['block', 'halfDrop', 'brick', 'mirror', 'rotate'];
const hexRe = /^#[0-9a-f]{6}$/i;
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const DEFAULT_DESIGN = {
  w: 10, h: 10, repeat: 'halfDrop', background: 0,
  layers: [
    { motif: 'flower', x: 0.3, y: 0.3, size: 4, rot: 0, color: 1 },
    { motif: 'leaf', x: 0.75, y: 0.7, size: 3, rot: 35, color: 2 },
    { motif: 'dot', x: 0.8, y: 0.2, size: 0.8, rot: 0, color: 3 },
  ],
  colorways: [
    { name: 'Garden', colors: ['#f6f1e7', '#d0425b', '#3f7a4a', '#e7a93b'] },
    { name: 'Night', colors: ['#1d2333', '#e6b3c3', '#7fb59a', '#f2d27c'] },
    { name: 'Mono', colors: ['#ffffff', '#222222', '#555555', '#999999'] },
  ],
  colorway: 0,
};

// Clamps every numeric field and caps list lengths (12 colourways, 16 colours, 200 layers): a hostile or corrupt file
// cannot allocate gigapixel canvases or hang the renderer. Invalid colours are dropped, not repaired.
// KNOWN DEFECT: `MOTIFS[l?.motif]` reads the prototype chain, so motif 'constructor' or 'toString' passes validation
// and motifPolys() then returns undefined and throws. Fix: Object.hasOwn(MOTIFS, l?.motif).
export function normalizeDesign(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = JSON.parse(JSON.stringify(DEFAULT_DESIGN));
  d.w = clamp(num(r.w, d.w), 0.5, 200); d.h = clamp(num(r.h, d.h), 0.5, 200);
  d.repeat = REPEATS.includes(r.repeat) ? r.repeat : d.repeat;
  if (Array.isArray(r.colorways) && r.colorways.length) {
    d.colorways = r.colorways.slice(0, 12).map((c, i) => ({ name: String(c?.name || `Colourway ${i + 1}`).slice(0, 40), colors: (Array.isArray(c?.colors) ? c.colors : []).filter((x) => hexRe.test(x)).slice(0, 16) })).filter((c) => c.colors.length);
    if (!d.colorways.length) d.colorways = DEFAULT_DESIGN.colorways;
  }
  d.colorway = clamp(Math.round(num(r.colorway, 0)), 0, d.colorways.length - 1);
  d.background = Math.max(0, Math.round(num(r.background, 0)));
  if (Array.isArray(r.layers)) {
    d.layers = r.layers.slice(0, 200).map((l) => ({
      motif: MOTIFS[l?.motif] || l?.motif === 'image' ? l.motif : 'dot', image: typeof l?.image === 'string' ? l.image : null,
      x: num(l?.x, 0.5), y: num(l?.y, 0.5), size: clamp(num(l?.size, 2), 0.05, 200), aspect: clamp(num(l?.aspect, 1), 0.05, 20),
      rot: num(l?.rot, 0), color: Math.max(0, Math.round(num(l?.color, 1))), opacity: clamp(num(l?.opacity, 1), 0, 1),
    }));
  }
  return d;
}

// Colour indexes wrap modulo the palette size: a layer referring to colour 5 of a 4-colour colourway stays visible
// instead of disappearing, which matters when switching between colourways of different lengths.
const colorOf = (d, i, cw = d.colorway) => { const c = d.colorways[cw] || d.colorways[0]; return c.colors[i % c.colors.length]; };

// The repeat unit: copies of the base cell (cell cm -> unit cm transforms).
// Each repeat type = the smallest rectangle that tiles the plane by pure translation, plus the cell copies inside it.
// halfDrop / brick: 2 cells offset by half a cell; mirror: 4 reflections; rotate: 4 quarter turns (a square of the
// larger side so the rotated cells fit). Translation-only units are what fabric printers (rotary screens) need.
export function repeatUnit(d) {
  const { w, h } = d;
  const T = (x, y) => [1, 0, 0, 1, x, y];
  switch (d.repeat) {
    case 'halfDrop': return { w: 2 * w, h, cells: [T(0, 0), T(w, h / 2)] };
    case 'brick': return { w, h: 2 * h, cells: [T(0, 0), T(w / 2, h)] };
    case 'mirror': return { w: 2 * w, h: 2 * h, cells: [T(0, 0), [-1, 0, 0, 1, 2 * w, 0], [1, 0, 0, -1, 0, 2 * h], [-1, 0, 0, -1, 2 * w, 2 * h]] };
    case 'rotate': {
      const s = Math.max(w, h);
      return { w: 2 * s, h: 2 * s, cells: [T(0, 0), [0, 1, -1, 0, 2 * s, 0], [-1, 0, 0, -1, 2 * s, 2 * s], [0, -1, 1, 0, 0, 2 * s]] };
    }
    default: return { w, h, cells: [T(0, 0)] };
  }
}

// Draws every layer of every cell of the unit into a canvas whose pixel grid is the unit (wrapping at the edges).
function drawUnit(cv, d, u, pxPerCm, o) {
  const S = [pxPerCm, 0, 0, pxPerCm, 0, 0];
  for (const cell of u.cells) {
    for (const l of d.layers) {
      const lm = trsM(l.x * d.w, l.y * d.h, l.size / 2, l.rot, (l.size / 2) * (l.aspect || 1));
      const m = mulM(S, mulM(cell, lm));
      if (l.motif === 'image') {
        const img = o.images?.[l.image];
        if (img) drawImage(cv, img, mulM(m, [2, 0, 0, 2, -1, -1]), { alpha: l.opacity, wrap: true });
      } else {
        fillPolys(cv, motifPolys(l.motif), colorOf(d, l.color, o.colorway), { m, alpha: l.opacity, wrap: true });
      }
    }
  }
}

export function renderUnit(raw, o = {}) {
  const d = normalizeDesign(raw);
  const u = repeatUnit(d);
  // The unit is rounded to whole pixels, then the actual scale W / u.w is used for drawing; using ppc directly would
  // leave a fractional pixel at the edge and a visible seam when the unit is tiled.
  const ppc = o.pxPerCm || (o.size ? o.size / Math.max(u.w, u.h) : 12);
  const W = Math.max(1, Math.round(u.w * ppc)), H = Math.max(1, Math.round(u.h * ppc));
  // Exact unit size in pixels: the scale is fitted per axis.
  const cv = canvas(W, H, colorOf(d, d.background, o.colorway));
  drawUnit(cv, d, u, W / u.w, { ...o, colorway: o.colorway ?? d.colorway });
  return { ...cv, cm: [u.w, u.h] };
}

/**
 * Tiles a design over a target canvas: m maps design centimetres (unit origin) to canvas pixels; the unit is
 * rendered once at the target density and copied with wrap-around (piece textures, mockups).
 */
// Render once, sample many: the unit is rasterized at the target density (clamped 2-64 px/cm to bound memory) and the
// target is filled by nearest-neighbour lookup with modular wrap. Re-rasterizing motifs per target pixel would be
// orders of magnitude slower. The double modulo ((v % 1) + 1) % 1 handles negative coordinates.
// Note: output alpha is forced to 255; the target is treated as an opaque piece texture.
export function renderInto(cv, raw, m, o = {}) {
  const d = normalizeDesign(raw);
  const scale = Math.hypot(m[0], m[1]);
  const unit = renderUnit(d, { ...o, pxPerCm: Math.min(64, Math.max(2, scale)) });
  const [uw, uh] = unit.cm;
  // Canvas pixel -> design cm -> unit pixel.
  const inv = invert(m);
  for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
    const cx = inv[0] * (x + 0.5) + inv[2] * (y + 0.5) + inv[4], cy = inv[1] * (x + 0.5) + inv[3] * (y + 0.5) + inv[5];
    const ux = Math.floor((((cx / uw) % 1) + 1) % 1 * unit.width) % unit.width, uy = Math.floor((((cy / uh) % 1) + 1) % 1 * unit.height) % unit.height;
    const s = (uy * unit.width + ux) * 4, t = (y * cv.width + x) * 4;
    const a = (o.alpha ?? 1) * (unit.data[s + 3] / 255);
    for (let k = 0; k < 3; k++) cv.data[t + k] = unit.data[s + k] * a + cv.data[t + k] * (1 - a);
    cv.data[t + 3] = 255;
  }
  return cv;
}
// Duplicate of raster.js invM (same formula), kept local; a candidate for importing invM instead.
const invert = (m) => { const det = m[0] * m[3] - m[1] * m[2] || 1e-12; return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det]; };

/**
 * Colour separations (screen printing): every colour index used by a layer gets a mask of the pixels where it is the
 * top colour, and its coverage of the unit. The background is index d.background.
 */
// Approach: render with a false-colour palette (one key colour per index, black elsewhere), then classify each pixel
// to the nearest key within distance 60 per channel. This yields top-colour masks with occlusion handled by the
// renderer itself, so overlaps need no geometry. Anti-aliased edge pixels between two keys fall to the nearer one
// or to none (background), which is the 50 % threshold a screen printer wants.
export function separations(raw, o = {}) {
  const d = normalizeDesign(raw);
  const u = repeatUnit(d);
  const ppc = o.pxPerCm || 8;
  const W = Math.round(u.w * ppc), H = Math.round(u.h * ppc);
  const idx = [...new Set(d.layers.filter((l) => l.motif !== 'image').map((l) => l.color))];
  // Render with a false-colour colourway: index i -> a unique colour, no anti-aliasing ambiguity (threshold 50 %).
  const keyColors = idx.map((_, i) => '#' + (((i + 1) * 0x3b7d1) & 0xffffff).toString(16).padStart(6, '0'));
  const fake = { ...d, colorways: [{ name: 'k', colors: Array.from({ length: Math.max(...idx, d.background) + 1 }, (_, i) => (idx.includes(i) ? keyColors[idx.indexOf(i)] : '#000000')) }], colorway: 0 };
  const cv = canvas(W, H, '#000000');
  drawUnit(cv, fake, u, ppc, { colorway: 0 });
  const keys = keyColors.map(hexToRgb);
  const out = idx.map((i, k) => ({ index: i, color: colorOf(d, i), mask: new Uint8Array(W * H), coverage: 0, key: keys[k] }));
  for (let p = 0; p < W * H; p++) {
    const r = cv.data[p * 4], g = cv.data[p * 4 + 1], b = cv.data[p * 4 + 2];
    let best = -1, bd = 60 * 60 * 3;
    for (let k = 0; k < keys.length; k++) { const dd = (r - keys[k][0]) ** 2 + (g - keys[k][1]) ** 2 + (b - keys[k][2]) ** 2; if (dd < bd) { bd = dd; best = k; } }
    if (best >= 0) { out[best].mask[p] = 255; out[best].coverage++; }
  }
  for (const s of out) { s.coverage /= W * H; delete s.key; }
  return { width: W, height: H, layers: out };
}

// SVG of one unit at 1 user unit = 1 cm, motifs repeated across the unit edges.
// Every motif is emitted at the 9 positions (unit shifted by -1, 0, +1 on both axes) and clipped to the unit, the
// vector analogue of fillPolys' wrap. Shapes fully outside are still emitted; simpler than bounds tests, and the
// clip discards them. Coordinates are rounded to 0.001 cm (10 um), far below print resolution, to keep files small.
export function designSVG(raw, o = {}) {
  const d = normalizeDesign(raw);
  const u = repeatUnit(d);
  const cw = o.colorway ?? d.colorway;
  const f = (v) => (Math.round(v * 1000) / 1000).toString();
  const shapes = [];
  for (const cell of u.cells) for (const l of d.layers) {
    if (l.motif === 'image') continue;
    const m = mulM(cell, trsM(l.x * d.w, l.y * d.h, l.size / 2, l.rot, (l.size / 2) * (l.aspect || 1)));
    for (const dx of [-u.w, 0, u.w]) for (const dy of [-u.h, 0, u.h]) {
      shapes.push(`<path transform="matrix(${m.map((v, i) => f(i === 4 ? v + dx : i === 5 ? v + dy : v)).join(' ')})" d="${motifPath(l.motif)}" fill="${colorOf(d, l.color, cw)}"${l.opacity < 1 ? ` fill-opacity="${f(l.opacity)}"` : ''}/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${f(u.w)}cm" height="${f(u.h)}cm" viewBox="0 0 ${f(u.w)} ${f(u.h)}"><defs><clipPath id="u"><rect width="${f(u.w)}" height="${f(u.h)}"/></clipPath></defs><g clip-path="url(#u)"><rect width="${f(u.w)}" height="${f(u.h)}" fill="${colorOf(d, d.background, cw)}"/>${shapes.join('')}</g></svg>`;
}

/**
 * Seamless check: a 2x2 block rendered directly (motifs placed over the larger area) must equal the unit rendered
 * once and copied 2x2 - then the unit continues across its own edges.
 */
// The check compares a window offset by half a unit, so the seams of the unit fall in the middle of the window where
// any discontinuity would show. Tolerance 2 / 255 absorbs anti-aliasing rounding differences between the two paths.
export function seamlessCheck(raw, o = {}) {
  const d = normalizeDesign(raw);
  const ppc = o.pxPerCm || 6;
  const u = repeatUnit(d);
  const one = renderUnit(d, { pxPerCm: ppc });
  const big = canvas(one.width * 2, one.height * 2, colorOf(d, d.background));
  const S = [one.width / u.w, 0, 0, one.height / u.h, 0, 0];
  for (const ox of [0, u.w]) for (const oy of [0, u.h]) for (const cell of u.cells) for (const l of d.layers) {
    if (l.motif === 'image') continue;
    const m = mulM(S, mulM([1, 0, 0, 1, ox, oy], mulM(cell, trsM(l.x * d.w, l.y * d.h, l.size / 2, l.rot, (l.size / 2) * (l.aspect || 1)))));
    fillPolys(big, motifPolys(l.motif), colorOf(d, l.color), { m, alpha: l.opacity, wrap: true });
  }
  let worst = 0;
  // Compare the inner window (one unit offset by half a unit) with the copied unit at the same phase.
  const hx = Math.floor(one.width / 2), hy = Math.floor(one.height / 2);
  for (let y = 0; y < one.height; y++) for (let x = 0; x < one.width; x++) {
    const a = ((y + hy) * big.width + x + hx) * 4, b = (((y + hy) % one.height) * one.width + ((x + hx) % one.width)) * 4;
    for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(big.data[a + k] - one.data[b + k]));
  }
  return { worst, ok: worst <= 2 };
}

// A placement print on a pattern piece: centre (x, y) and width in the piece's centimetres, height from the artwork's
// aspect unless given, rotation in degrees; art = { kind: 'image', id } | { kind: 'motif', motif, color } | { kind: 'text', text, color }.
export function normalizePlacement(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const art = r.art && typeof r.art === 'object' ? r.art : { kind: 'motif', motif: 'star', color: '#d0425b' };
  return {
    // area: a print area of the draft (front, back, chest, sleeve): the piece and the centre come from it, x / y
    // are then offsets from that centre.
    area: typeof r.area === 'string' ? r.area : null,
    id: String(r.id || 'print-' + Math.round(num(r.x, 0) * 10)), piece: String(r.piece || 'front'), side: ['R', 'L', 'C'].includes(r.side) ? r.side : 'C',
    x: num(r.x, 0), y: num(r.y, 0), w: r.w == null && r.area ? null : clamp(num(r.w, 20), 0.5, 200), opacity: clamp(num(r.opacity, 1), 0, 1), h: r.h != null ? clamp(num(r.h, 20), 0.5, 200) : null, rot: num(r.rot, 0),
    art: { kind: ['image', 'motif', 'text'].includes(art.kind) ? art.kind : 'motif', id: art.id || null, motif: MOTIFS[art.motif] ? art.motif : 'star', color: hexRe.test(art.color) ? art.color : '#d0425b', text: String(art.text || '').slice(0, 80) },
  };
}
