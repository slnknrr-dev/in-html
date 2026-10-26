// ascii/convert.js - image → character grid: area-average resampling, tone curve, Sobel edges, dithering, ramps,
// braille / half-block glyphs and per-cell colours. Pure: works on { data: RGBA, width, height } in Node or a page.
//
// Pipeline: area-average resample to the sample grid (cells x sub-cell dots) -> luminance -> tone LUT -> optional
// Sobel edges -> coverage T (how much ink) -> quantise / dither to ramp levels -> code points -> per-cell colours.
// Everything works on Float32 planes in buffers reused between calls (createConverter), so live camera conversion
// does not allocate per frame.
import { BRAILLE_BASE, BRAILLE_BITS, FULL_BLOCK, HALF_LOWER, HALF_UPPER, rampCodes } from './ramps.js';
import { quantizeColors } from './palette.js';

export const COLOR_MODES = Object.freeze(['mono', 'ansi16', 'ansi256', 'truecolor', 'html']);
export const DITHERS = Object.freeze(['none', 'fs', 'bayer4', 'bayer8']);
export const MAX_COLS = 1000;
export const MAX_ROWS = 1000;

/**
 * Options of convert() (every field optional):
 *   columns        grid width in characters
 *   aspect         character cell height ÷ width (≈ 2 for most monospace fonts at line-height 1.2)
 *   ramp           'classic' | 'detailed' | 'short' | 'blocks' | 'braille' | 'half' | 'custom'
 *   chars, order   custom characters and their order: 'auto' (sorted by density) | 'sparse' | 'dense' (first)
 *   brightness     -1..1 (offset of ±0.5)    contrast  -1..1    gamma  0.05..20 (> 1 brightens mid-tones)
 *   invert         swap sparse and dense      autoLevels  stretch the 0.5 %..99.5 % luminance range
 *   edges          0..1 Sobel magnitude added as ink    edgeGlyphs  draw | / - \ along strong edges (linear ramps)
 *   edgeThreshold  0..1 edge strength needed for an edge glyph
 *   dither         'none' | 'fs' (Floyd–Steinberg, serpentine) | 'bayer4' | 'bayer8'
 *   color          'mono' | 'ansi16' | 'ansi256' | 'truecolor' | 'html' (12-bit #rgb)
 *   target         'fg' (glyph colour) | 'bg' (cell background, glyphs in a contrasting shade)
 *   vivid          0..1 glyph colours toward a readable value (fg target): full value for light ink, deeper for dark ink
 *   ink            'light' (light glyphs on a dark background) | 'dark' (dark glyphs on paper)
 *   matte          [r, g, b] behind transparent pixels (default: the background implied by `ink`)
 */
export const DEFAULTS = Object.freeze({
  columns: 100, aspect: 2, ramp: 'classic', chars: '', order: 'auto',
  brightness: 0, contrast: 0, gamma: 1, invert: false, autoLevels: false,
  edges: 0, edgeGlyphs: false, edgeThreshold: 0.3, vivid: 0,
  dither: 'none', color: 'mono', target: 'fg', ink: 'light', matte: null,
});

const SUB = { braille: [2, 4], half: [1, 2] };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : d);

function normalize(opts) {
  const o = { ...DEFAULTS, ...(opts || {}) };
  o.columns = clamp(Math.round(num(o.columns, 100)), 1, MAX_COLS);
  o.aspect = clamp(num(o.aspect, 2), 0.25, 8);
  o.brightness = clamp(num(o.brightness, 0), -1, 1);
  o.contrast = clamp(num(o.contrast, 0), -1, 1);
  o.gamma = clamp(num(o.gamma, 1), 0.05, 20);
  o.edges = clamp(num(o.edges, 0), 0, 1);
  o.edgeThreshold = clamp(num(o.edgeThreshold, 0.3), 0, 1);
  o.vivid = clamp(num(o.vivid, 0), 0, 1);
  if (!COLOR_MODES.includes(o.color)) o.color = 'mono';
  if (!DITHERS.includes(o.dither)) o.dither = 'none';
  return o;
}

// Grid geometry for an image: cols × rows cells, each made of sx × sy samples (braille 2×4, half blocks 1×2).
export function gridSize(width, height, opts) {
  const o = normalize(opts);
  const w = Math.max(1, +width || 1), h = Math.max(1, +height || 1);
  const cols = o.columns;
  const rows = clamp(Math.round((cols * h) / w / o.aspect), 1, MAX_ROWS);
  const [sx, sy] = SUB[o.ramp] || [1, 1];
  return { cols, rows, sx, sy, sw: cols * sx, sh: rows * sy };
}

// ---------------------------------------------------------------------------------------------
// Ordered dither matrices (recursive Bayer construction).

// Recursive Bayer construction: each step tiles the previous matrix four times with offsets 0, 2, 3, 1, producing
// an ordered-dither threshold map whose thresholds are maximally spread in space.
function bayer(n) {
  let m = [0, 2, 3, 1], s = 2;
  while (s < n) {
    const t = new Array(4 * s * s);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const v = 4 * m[y * s + x];
        t[y * 2 * s + x] = v;
        t[y * 2 * s + x + s] = v + 2;
        t[(y + s) * 2 * s + x] = v + 3;
        t[(y + s) * 2 * s + x + s] = v + 1;
      }
    }
    m = t;
    s *= 2;
  }
  return Uint8Array.from(m);
}
export const BAYER4 = bayer(4);
export const BAYER8 = bayer(8);

// ---------------------------------------------------------------------------------------------
// The converter keeps its scratch buffers between calls (camera frames reuse them); the returned grids own their
// arrays, so a grid stays valid after the next conversion.

export function createConverter() {
  const bufs = new Map();
  const take = (name, Ctor, n) => {
    let a = bufs.get(name);
    if (!a || a.length < n) { a = new Ctor(Math.ceil(n * 1.25) + 16); bufs.set(name, a); }
    return a;
  };
  return { convert: (img, opts) => convertWith(take, img, opts) };
}

const shared = createConverter();

/**
 * Converts an RGBA image to a character grid:
 *   { cols, rows, codes: Uint32Array (code point per cell, row-major), chars: string[] (one string per row),
 *     fg, bg: Uint8Array RGB triplets per cell or null, fgIdx, bgIdx: palette indices (ANSI modes) or null,
 *     color, palette ('ansi16' | 'ansi256' | null), ramp, ink, aspect }
 */
export function convert(img, opts) {
  return shared.convert(img, opts);
}

// Ink polarity: with light ink (dark background) bright pixels need dense glyphs; with dark ink the mapping flips.
// `flip` combines that with the user's invert switch so the rest of the pipeline only thinks in "coverage".
function convertWith(take, img, opts) {
  const o = normalize(opts);
  const W = img && img.width | 0, H = img && img.height | 0, data = img && img.data;
  if (!data || W < 1 || H < 1 || data.length < W * H * 4) throw new TypeError('convert(): expected { data: RGBA bytes, width, height }');
  const { cols, rows, sx, sy, sw, sh } = gridSize(W, H, o);
  const n = sw * sh;
  const dark = o.ink === 'dark';
  const matte = Array.isArray(o.matte) && o.matte.length >= 3 ? o.matte : dark ? [255, 255, 255] : [0, 0, 0];

  const R = take('R', Float32Array, n), G = take('G', Float32Array, n), B = take('B', Float32Array, n);
  resample(take, data, W, H, sw, sh, matte, R, G, B);

  // Luminance → tone curve (levels, brightness, contrast, gamma) through a 1024-entry table.
  const L = take('L', Float32Array, n);
  for (let i = 0; i < n; i++) L[i] = (0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i]) / 255;
  const [lo, hi] = o.autoLevels ? levels(take, L, n) : [0, 1];
  const lut = toneLUT(take, o, lo, hi);
  const V = take('V', Float32Array, n);
  for (let i = 0; i < n; i++) V[i] = lut[lutIndex(L[i])];

  // Edges on the adjusted tone (magnitude 1 = a full black/white step).
  const glyphEdges = o.edgeGlyphs && sx === 1 && sy === 1;
  let M = null, GX = null, GY = null;
  if (o.edges > 0 || glyphEdges) {
    M = take('M', Float32Array, n);
    if (glyphEdges) { GX = take('GX', Float32Array, n); GY = take('GY', Float32Array, n); }
    sobel(V, sw, sh, M, GX, GY);
  }

  // Coverage: how much ink a sample wants (0 = nothing, 1 = densest glyph).
  const T = take('T', Float32Array, n);
  const flip = dark !== !!o.invert;
  const a = o.edges;
  for (let i = 0; i < n; i++) {
    let t = flip ? 1 - V[i] : V[i];
    // Edges are added as ink with a screen blend (1 - (1 - t)(1 - e)): coverage only grows and never exceeds 1.
    if (a > 0) { const m = M[i] * 2; t = 1 - (1 - t) * (1 - a * (m > 1 ? 1 : m)); }
    T[i] = t;
  }

  const ncell = cols * rows;
  const codes = new Uint32Array(ncell);
  const colour = o.color !== 'mono';
  const halfColour = o.ramp === 'half' && colour;
  let ramp = null, Q = null;
  if (!halfColour) {
    ramp = sx * sy > 1 ? null : rampCodes(o);
    Q = take('Q', Uint16Array, n);
    dither(take, T, sw, sh, ramp ? ramp.length : 2, o.dither, Q);
    if (ramp) {
      for (let i = 0; i < n; i++) codes[i] = ramp[Q[i]];
      if (glyphEdges) edgeGlyphs(codes, M, GX, GY, n, o.edgeThreshold, o.aspect);
    } else if (o.ramp === 'braille') {
      for (let cy = 0, i = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++, i++) {
          let bits = 0;
          for (let dy = 0; dy < 4; dy++) {
            const row = (cy * 4 + dy) * sw + cx * 2;
            if (Q[row]) bits |= BRAILLE_BITS[dy * 2];
            if (Q[row + 1]) bits |= BRAILLE_BITS[dy * 2 + 1];
          }
          codes[i] = BRAILLE_BASE + bits;
        }
      }
    } else {
      for (let cy = 0, i = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++, i++) {
          const top = Q[cy * 2 * sw + cx], bot = Q[(cy * 2 + 1) * sw + cx];
          codes[i] = top ? (bot ? FULL_BLOCK : HALF_UPPER) : bot ? HALF_LOWER : 32;
        }
      }
    }
  } else codes.fill(HALF_UPPER);

  let fg = null, bg = null, fgIdx = null, bgIdx = null;
  if (colour) {
    const toByte = (v) => Math.round(lut[lutIndex(v / 255)] * 255);
    if (o.ramp === 'half') {
      fg = new Uint8Array(ncell * 3);
      bg = new Uint8Array(ncell * 3);
      for (let cy = 0, i = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++, i++) {
          const t = cy * 2 * sw + cx, b = t + sw, p = i * 3;
          fg[p] = toByte(R[t]); fg[p + 1] = toByte(G[t]); fg[p + 2] = toByte(B[t]);
          bg[p] = toByte(R[b]); bg[p + 1] = toByte(G[b]); bg[p + 2] = toByte(B[b]);
        }
      }
    } else {
      const cell = new Uint8Array(ncell * 3);
      if (o.ramp === 'braille') {
        // Colour of the raised dots (they carry the picture), or of the whole cell when none is raised.
        for (let cy = 0, i = 0; cy < rows; cy++) {
          for (let cx = 0; cx < cols; cx++, i++) {
            let r = 0, g = 0, b = 0, k = 0, ra = 0, ga = 0, ba = 0;
            for (let dy = 0; dy < 4; dy++) {
              for (let dx = 0; dx < 2; dx++) {
                const s = (cy * 4 + dy) * sw + cx * 2 + dx;
                ra += R[s]; ga += G[s]; ba += B[s];
                if (Q[s]) { r += R[s]; g += G[s]; b += B[s]; k++; }
              }
            }
            const p = i * 3;
            if (k) { cell[p] = toByte(r / k); cell[p + 1] = toByte(g / k); cell[p + 2] = toByte(b / k); }
            else { cell[p] = toByte(ra / 8); cell[p + 1] = toByte(ga / 8); cell[p + 2] = toByte(ba / 8); }
          }
        }
      } else {
        for (let i = 0, p = 0; i < ncell; i++, p += 3) { cell[p] = toByte(R[i]); cell[p + 1] = toByte(G[i]); cell[p + 2] = toByte(B[i]); }
      }
      if (o.target === 'bg') {
        bg = cell;
        fg = new Uint8Array(ncell * 3);
        // Glyphs in a shade of the cell colour: texture without fighting the background.
        for (let p = 0; p < cell.length; p += 3) {
          const light = 0.2126 * cell[p] + 0.7152 * cell[p + 1] + 0.0722 * cell[p + 2] > 140;
          for (let c = 0; c < 3; c++) fg[p + c] = light ? Math.round(cell[p + c] * 0.42) : Math.round(cell[p + c] + (255 - cell[p + c]) * 0.55);
        }
      } else {
        fg = cell;
        if (o.vivid > 0) {
          // Glyph density already carries the brightness, so the colour may carry the hue at a value that reads
          // well: light ink is lifted to full value, dark ink on paper is deepened (never lightened).
          const target = dark ? 150 : 255;
          for (let p = 0; p < cell.length; p += 3) {
            const m = Math.max(cell[p], cell[p + 1], cell[p + 2]);
            if (!m || (dark && m <= target)) continue;
            const k = 1 + o.vivid * (target / m - 1);
            cell[p] = Math.min(255, Math.round(cell[p] * k));
            cell[p + 1] = Math.min(255, Math.round(cell[p + 1] * k));
            cell[p + 2] = Math.min(255, Math.round(cell[p + 2] * k));
          }
        }
      }
    }
    fgIdx = fg ? quantizeColors(fg, o.color) : null;
    bgIdx = bg ? quantizeColors(bg, o.color) : null;
  }

  return {
    cols, rows, codes, chars: rowStrings(codes, cols, rows), fg, bg, fgIdx, bgIdx,
    color: o.color, palette: o.color === 'ansi16' || o.color === 'ansi256' ? o.color : null,
    ramp: o.ramp, ink: dark ? 'dark' : 'light', aspect: o.aspect,
  };
}

const lutIndex = (v) => { const k = (v * 1023 + 0.5) | 0; return k < 0 ? 0 : k > 1023 ? 1023 : k; };

function rowStrings(codes, cols, rows) {
  const out = new Array(rows);
  let astral = false;
  for (let i = 0; i < codes.length && !astral; i++) astral = codes[i] > 0xffff;
  for (let r = 0; r < rows; r++) {
    const row = codes.subarray(r * cols, (r + 1) * cols);
    // Native conversion of a whole row; code points beyond the BMP (custom emoji) need fromCodePoint.
    out[r] = astral ? String.fromCodePoint(...row) : String.fromCharCode.apply(null, row);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Area-average (box filter) resampling, separable with fractional pixel coverage at the span ends.

// For each destination index: source indices and normalised weights (CSR layout).
function spans(take, key, src, dst) {
  const scale = src / dst;
  const start = take(key + 's', Int32Array, dst + 1);
  const idx = take(key + 'i', Int32Array, src + 2 * dst + 2);
  const wt = take(key + 'w', Float32Array, src + 2 * dst + 2);
  let k = 0;
  for (let j = 0; j < dst; j++) {
    const a = j * scale, b = Math.min(src, (j + 1) * scale);
    start[j] = k;
    for (let i = Math.floor(a), e = Math.min(src, Math.ceil(b)); i < e; i++) {
      const w = Math.min(b, i + 1) - Math.max(a, i);
      if (w > 1e-9) { idx[k] = i; wt[k] = w / scale; k++; }
    }
  }
  start[dst] = k;
  return { start, idx, wt };
}

// Span ends of each destination index for the fast path: first / last source index, their weights; the
// pixels in between all weigh 1 / scale.
function ends(take, key, src, dst) {
  const scale = src / dst;
  const first = take(key + 'f', Int32Array, dst), last = take(key + 'l', Int32Array, dst);
  const wf = take(key + 'a', Float32Array, dst), wl = take(key + 'b', Float32Array, dst);
  for (let j = 0; j < dst; j++) {
    const a = j * scale, b = Math.min(src, (j + 1) * scale);
    const f = Math.min(src - 1, Math.floor(a)), l = Math.max(f, Math.min(src - 1, Math.ceil(b) - 1));
    first[j] = f; last[j] = l;
    wf[j] = f === l ? 1 : (f + 1 - a) / scale;
    wl[j] = f === l ? 0 : (b - l) / scale;
  }
  return { first, last, wf, wl, wm: 1 / scale };
}

// Pixels as little-endian 32-bit words (one load per pixel) when the platform and the buffer alignment allow it.
const LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

function resample(take, d, W, H, sw, sh, matte, R, G, B) {
  const tmp = take('tmp', Float32Array, H * sw * 4);
  let C = 3, opaque = false;
  if (LE && d.buffer && (d.byteOffset & 3) === 0) {
    // Fast path: assumes an opaque image and checks that on the way (AND of all words keeps alpha 255 only then).
    const u = new Uint32Array(d.buffer, d.byteOffset, W * H);
    const { first, last, wf, wl, wm } = ends(take, 'x', W, sw);
    let all = 0xffffffff;
    for (let y = 0, o = 0; y < H; y++) {
      const row = y * W;
      for (let j = 0; j < sw; j++) {
        const f = row + first[j], l = row + last[j];
        let v = u[f];
        all &= v;
        let r, g, b;
        if (f === l) { r = v & 255; g = (v >>> 8) & 255; b = (v >>> 16) & 255; }
        else {
          const w0 = wf[j];
          r = (v & 255) * w0; g = ((v >>> 8) & 255) * w0; b = ((v >>> 16) & 255) * w0;
          let sr = 0, gg = 0, sb = 0;
          if (l - f <= 129) {
            // Red and blue summed in two 16-bit lanes of one small integer (≤ 128 pixels cannot overflow them).
            let rb = 0;
            for (let i = f + 1; i < l; i++) {
              v = u[i];
              all &= v;
              rb += v & 0xff00ff;
              gg += (v >>> 8) & 255;
            }
            sr = rb & 0xffff; sb = rb >>> 16;
          } else {
            for (let i = f + 1; i < l; i++) {
              v = u[i];
              all &= v;
              sr += v & 255; gg += (v >>> 8) & 255; sb += (v >>> 16) & 255;
            }
          }
          v = u[l];
          all &= v;
          const w1 = wl[j];
          r += sr * wm + (v & 255) * w1; g += gg * wm + ((v >>> 8) & 255) * w1; b += sb * wm + ((v >>> 16) & 255) * w1;
        }
        tmp[o++] = r; tmp[o++] = g; tmp[o++] = b;
      }
    }
    opaque = all >>> 24 === 255;
  }
  if (!opaque) {
    // Transparency (or no aligned word view): premultiplied byte path.
    C = 4;
    const { start: xS, idx: xI, wt: xW } = spans(take, 'x', W, sw);
    for (let y = 0, o = 0; y < H; y++) {
      const row = y * W * 4;
      for (let j = 0; j < sw; j++) {
        let r = 0, g = 0, b = 0, al = 0;
        for (let k = xS[j], e = xS[j + 1]; k < e; k++) {
          const p = row + xI[k] * 4, w = xW[k], aw = d[p + 3] * w;
          r += d[p] * aw; g += d[p + 1] * aw; b += d[p + 2] * aw; al += aw;
        }
        tmp[o++] = r / 255; tmp[o++] = g / 255; tmp[o++] = b / 255; tmp[o++] = al / 255;
      }
    }
  }
  const ys = spans(take, 'y', H, sh);
  // Vertical pass: weighted rows into the sample grid.
  const n = sw * sh;
  R.fill(0, 0, n); G.fill(0, 0, n); B.fill(0, 0, n);
  const A = opaque ? null : take('A', Float32Array, n);
  if (A) A.fill(0, 0, n);
  const { start: yS, idx: yI, wt: yW } = ys;
  for (let oy = 0; oy < sh; oy++) {
    const out = oy * sw;
    for (let k = yS[oy], e = yS[oy + 1]; k < e; k++) {
      const w = yW[k];
      let t = yI[k] * sw * C;
      for (let x = 0; x < sw; x++, t += C) {
        R[out + x] += tmp[t] * w; G[out + x] += tmp[t + 1] * w; B[out + x] += tmp[t + 2] * w;
        if (A) A[out + x] += tmp[t + 3] * w;
      }
    }
  }
  if (A) {
    // Premultiplied averages composited over the matte: exact for any mix of transparent pixels in a cell.
    for (let i = 0; i < n; i++) {
      const rest = 1 - A[i];
      R[i] += matte[0] * rest; G[i] += matte[1] * rest; B[i] += matte[2] * rest;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Tone

// Luminance range kept by auto levels: 0.5 % of the samples clipped at each end.
function levels(take, L, n) {
  const hist = take('hist', Uint32Array, 256);
  hist.fill(0, 0, 256);
  for (let i = 0; i < n; i++) hist[Math.min(255, (L[i] * 255) | 0)]++;
  const cut = n * 0.005;
  let lo = 0, hi = 255, acc = 0;
  while (lo < 255 && (acc += hist[lo]) <= cut) lo++;
  acc = 0;
  while (hi > 0 && (acc += hist[hi]) <= cut) hi--;
  return hi - lo < 8 ? [0, 1] : [lo / 255, (hi + 1) / 255];
}

function toneLUT(take, o, lo, hi) {
  const lut = take('lut', Float32Array, 1024);
  const br = o.brightness * 0.5;
  const c = o.contrast * 0.98;
  const f = c >= 0 ? 1 / (1 - c) : 1 + c;
  const ig = 1 / o.gamma;
  for (let i = 0; i < 1024; i++) {
    let v = i / 1023;
    v = (v - lo) / (hi - lo);
    v = (clamp(v, 0, 1) + br - 0.5) * f + 0.5;
    lut[i] = clamp(v, 0, 1) ** ig;
  }
  return lut;
}

// Sobel gradient magnitude (normalised: 1 for a full step), optional gx / gy (replicated borders).
function sobel(V, w, h, M, GX, GY) {
  for (let y = 0; y < h; y++) {
    const r0 = Math.max(0, y - 1) * w, r1 = y * w, r2 = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x++) {
      const x0 = x > 0 ? x - 1 : 0, x2 = x < w - 1 ? x + 1 : w - 1;
      const a = V[r0 + x0], b = V[r0 + x], c = V[r0 + x2];
      const d = V[r1 + x0], f = V[r1 + x2];
      const g = V[r2 + x0], k = V[r2 + x], l = V[r2 + x2];
      const gx = c + 2 * f + l - (a + 2 * d + g);
      const gy = g + 2 * k + l - (a + 2 * b + c);
      const i = r1 + x;
      M[i] = Math.sqrt(gx * gx + gy * gy) / 4;
      if (GX) { GX[i] = gx; GY[i] = gy; }
    }
  }
}

// Strong edges become | / - \ by the direction of the edge as it appears on screen (cells are `aspect` times
// taller than wide, so the vertical gradient is spread over a longer distance; '/' itself leans at atan(aspect)).
function edgeGlyphs(codes, M, GX, GY, n, threshold, aspect) {
  const g = (Math.atan(aspect) * 180) / Math.PI;
  const b1 = g / 2, b2 = 45 + g / 2, b3 = 135 - g / 2, b4 = 180 - g / 2;
  const thr = Math.max(0.02, threshold);
  for (let i = 0; i < n; i++) {
    if (M[i] < thr) continue;
    // Gradient in y-up screen units; the edge runs perpendicular to it.
    let e = (Math.atan2(-GY[i] / aspect, GX[i]) * 180) / Math.PI + 90;
    e = ((e % 180) + 180) % 180;
    codes[i] = e < b1 ? 45 : e < b2 ? 47 : e < b3 ? 124 : e < b4 ? 92 : 45; // - / | \ -
  }
}

// ---------------------------------------------------------------------------------------------
// Quantisation of the coverage T (0..1) to `levels` steps, with optional dithering. Q receives level indices.

// Floyd-Steinberg with serpentine scanning (direction alternates per row), which avoids the diagonal "worm"
// artefacts of left-to-right only. Ordered dither (Bayer) adds a position-dependent offset of up to one level
// before rounding: no error propagation, so it is stable between video frames (no shimmering).
function dither(take, T, w, h, levels, mode, Q) {
  const k = levels - 1, n = w * h;
  if (mode === 'fs') {
    const E = take('E', Float32Array, n);
    for (let i = 0; i < n; i++) E[i] = T[i];
    for (let y = 0; y < h; y++) {
      const ltr = (y & 1) === 0, dx = ltr ? 1 : -1, row = y * w;
      for (let s = 0; s < w; s++) {
        const x = ltr ? s : w - 1 - s, i = row + x;
        const v = E[i];
        let q = Math.round(v * k);
        q = q < 0 ? 0 : q > k ? k : q;
        Q[i] = q;
        const err = v - q / k;
        if (err === 0) continue;
        const fwd = x + dx >= 0 && x + dx < w, back = x - dx >= 0 && x - dx < w;
        if (fwd) E[i + dx] += (err * 7) / 16;
        if (y + 1 < h) {
          const j = i + w;
          if (back) E[j - dx] += (err * 3) / 16;
          E[j] += (err * 5) / 16;
          if (fwd) E[j + dx] += err / 16;
        }
      }
    }
  } else if (mode === 'bayer4' || mode === 'bayer8') {
    const N = mode === 'bayer4' ? 4 : 8, mat = N === 4 ? BAYER4 : BAYER8, s = 1 / (N * N);
    for (let y = 0; y < h; y++) {
      const mrow = (y % N) * N;
      for (let x = 0, i = y * w; x < w; x++, i++) {
        const v = T[i] + ((mat[mrow + (x % N)] + 0.5) * s - 0.5) / k;
        const q = Math.round(v * k);
        Q[i] = q < 0 ? 0 : q > k ? k : q;
      }
    }
  } else {
    for (let i = 0; i < n; i++) {
      const q = Math.round(T[i] * k);
      Q[i] = q < 0 ? 0 : q > k ? k : q;
    }
  }
}
