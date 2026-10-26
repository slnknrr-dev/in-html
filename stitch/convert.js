// stitch/convert.js - image -> cross-stitch scheme: target size by stitch count or by finished size and fabric count,
// area resampling in linear light, tone adjustments, background removal, quantisation to N threads of a catalogue
// in CIELAB (nearest threads by ΔE2000, then a greedy reduction that merges the colours whose loss costs least and a
// k-means-like refinement that snaps cluster centres back to catalogue threads), optional blends (two strands of
// different threads in one needle), dithering (none, Floyd–Steinberg in Lab, ordered / pattern dithering between the
// two nearest threads), confetti clean-up (isolated stitches, small regions, specks and holes) and backstitch outlines
// along strong colour edges.
//
//   convertImage(image, opts) -> { scheme, stats }     image: { width, height, data: RGBA bytes }
//   targetSize(imageW, imageH, opts) -> { width, height }
//   CONVERT_DEFAULTS
//
// opts: sizeBy 'stitches' | 'size'; width / height (stitches; 0 = from the aspect ratio); finishedWidth /
// finishedHeight (cm) with count (stitches per inch); crop { x, y, w, h } (image pixels); brand ('dmc', …);
// maxColors; threads (only these thread keys); blends; dither 'none' | 'fs' | 'ordered', ditherStrength 0..1;
// cleanup 0..3; minRegion (cells); background 'none' | 'auto' | 'transparent' | 'color', bgColor, bgTolerance (ΔE);
// brightness / contrast / saturation (-100..100), gamma (0.2..5); outline (bool), outlineThreshold (ΔE),
// outlineThread ('auto' or a thread key); symbols 'symbols' | 'letters'; blankFirst; title; strands; fabric.

// Pipeline principles:
// - Averaging happens in linear light (physically correct mixing of light), comparison happens in CIELAB with
//   ΔE2000 (perceptually uniform distance). Averaging gamma-encoded sRGB darkens edges; comparing in RGB picks
//   visibly wrong threads in blues and greens.
// - The palette is restricted to real threads at every step: k-means centres are snapped back to catalogue threads,
//   because a colour nobody sells is useless on a chart.
// - Cost control: the grid is at most 2000 x 2000 cells but has few distinct colours, so every expensive colour
//   function is cached by quantised colour, and ΔE2000 (trigonometry, several pow and atan2 calls) is only evaluated on a short list
//   pre-selected with cheap squared ΔE76.
// - Pure function of (image, opts): deterministic output, no randomness (k-means here starts from the greedy result,
//   not random seeds), so the same image and settings always give the same chart.
import { catalog, threadByKey, rgbToLab, labToRgb, mixColors, darkest } from './threads.js';
import { deltaE2000 } from '../color/metrics.js';
import { createScheme, threadEntry, blendEntry, emptyLayer } from './model.js';
import { assignSymbols } from './symbols.js';

export const CONVERT_DEFAULTS = {
  sizeBy: 'stitches', width: 100, height: 0, finishedWidth: 0, finishedHeight: 0, count: 14, crop: null,
  brand: 'dmc', maxColors: 24, threads: null, blends: false,
  dither: 'none', ditherStrength: 0.8, cleanup: 1, minRegion: 0,
  background: 'none', bgColor: '#ffffff', bgTolerance: 10,
  brightness: 0, contrast: 0, saturation: 0, gamma: 1,
  outline: false, outlineThreshold: 30, outlineThread: 'auto',
  symbols: 'symbols', blankFirst: false, title: '', strands: 2, fabric: null,
};

// The missing side follows the aspect ratio, assuming square cells; both sides are clamped to 1..2000 (model
// MAX_SIDE). 'size' mode converts cm at the given count: stitches = cm x count / 2.54.
export function targetSize(iw, ih, o = {}) {
  const opts = { ...CONVERT_DEFAULTS, ...o };
  const aspect = ih / iw;
  let W, H;
  if (opts.sizeBy === 'size' && (opts.finishedWidth > 0 || opts.finishedHeight > 0)) {
    const spc = opts.count / 2.54; // stitches per cm
    W = opts.finishedWidth > 0 ? opts.finishedWidth * spc : (opts.finishedHeight * spc) / aspect;
    H = opts.finishedHeight > 0 ? opts.finishedHeight * spc : W * aspect;
  } else {
    W = opts.width > 0 ? opts.width : opts.height > 0 ? opts.height / aspect : 100;
    H = opts.height > 0 ? opts.height : W * aspect;
  }
  return { width: Math.max(1, Math.min(2000, Math.round(W))), height: Math.max(1, Math.min(2000, Math.round(H))) };
}

// sRGB transfer function (IEC 61966-2-1). The decode side is a 256-entry table: input is 8-bit and it runs once per
// source pixel, often millions of times; the encode side runs once per cell.
const toLin = new Float32Array(256).map((_, v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
const fromLin = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055);

// Area average (downscale) or centre sampling (upscale) of an RGBA image into W × H cells: Float32Array
// [r, g, b, a] per cell, sRGB 0..255 and alpha 0..1 (colour averaged in linear light, weighted by alpha).
// Downscale: every source pixel adds to exactly one cell (box filter); this is the correct area average for integer
// and non-integer ratios alike and costs one pass over the image. Colour is premultiplied by alpha before summing,
// so transparent pixels (whose RGB is often garbage) do not tint edge cells. acc layout per cell: r, g, b (linear,
// premultiplied), alpha sum, pixel count. Upscale (or mixed): nearest sample at the cell centre, because there is
// nothing to average. A fully transparent cell becomes white with alpha 0 (the background mask catches it).
export function resample(image, W, H, crop = null) {
  const { width: iw, height: ih, data } = image;
  const cx = crop ? Math.max(0, Math.floor(crop.x)) : 0, cy = crop ? Math.max(0, Math.floor(crop.y)) : 0;
  const cw = crop ? Math.max(1, Math.min(iw - cx, Math.floor(crop.w))) : iw, ch = crop ? Math.max(1, Math.min(ih - cy, Math.floor(crop.h))) : ih;
  const acc = new Float64Array(W * H * 5);
  if (cw >= W && ch >= H) {
    for (let y = 0; y < ch; y++) {
      const ty = Math.min(H - 1, Math.floor((y * H) / ch));
      let si = ((cy + y) * iw + cx) * 4;
      for (let x = 0; x < cw; x++, si += 4) {
        const tx = Math.min(W - 1, Math.floor((x * W) / cw));
        const a = data[si + 3] / 255;
        const o = (ty * W + tx) * 5;
        acc[o] += toLin[data[si]] * a; acc[o + 1] += toLin[data[si + 1]] * a; acc[o + 2] += toLin[data[si + 2]] * a; acc[o + 3] += a; acc[o + 4]++;
      }
    }
  } else {
    for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
      const x = cx + Math.min(cw - 1, Math.floor(((tx + 0.5) * cw) / W)), y = cy + Math.min(ch - 1, Math.floor(((ty + 0.5) * ch) / H));
      const si = (y * iw + x) * 4, a = data[si + 3] / 255, o = (ty * W + tx) * 5;
      acc[o] = toLin[data[si]] * a; acc[o + 1] = toLin[data[si + 1]] * a; acc[o + 2] = toLin[data[si + 2]] * a; acc[o + 3] = a; acc[o + 4] = 1;
    }
  }
  const out = new Float32Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const o = i * 5, a = acc[o + 3];
    if (a > 0) for (let k = 0; k < 3; k++) out[i * 4 + k] = fromLin(acc[o + k] / a);
    else out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = 255;
    out[i * 4 + 3] = acc[o + 4] ? a / acc[o + 4] : 0;
  }
  return out;
}

// Brightness / contrast / saturation (-100..100) and gamma, in place on resample() output.
// Classic photo-editor controls on sRGB values (not linear): users tune by eye, and these are the formulas their
// eye was trained on. Order: gamma, contrast around mid-grey 128 plus brightness, saturation around Rec. 709 luma.
// brightness x 1.28 maps -100..100 to about -128..128. Early return keeps the identity case free.
export function adjust(cells, { brightness = 0, contrast = 0, saturation = 0, gamma = 1 } = {}) {
  if (!brightness && !contrast && !saturation && gamma === 1) return cells;
  const b = brightness * 1.28, c = (100 + contrast) / 100, s = (100 + saturation) / 100, g = 1 / Math.max(0.2, Math.min(5, gamma));
  for (let i = 0; i < cells.length; i += 4) {
    let r = cells[i], gg = cells[i + 1], bl = cells[i + 2];
    if (g !== 1) { r = 255 * (r / 255) ** g; gg = 255 * (gg / 255) ** g; bl = 255 * (bl / 255) ** g; }
    r = (r - 128) * c + 128 + b; gg = (gg - 128) * c + 128 + b; bl = (bl - 128) * c + 128 + b;
    const l = 0.2126 * r + 0.7152 * gg + 0.0722 * bl;
    r = l + (r - l) * s; gg = l + (gg - l) * s; bl = l + (bl - l) * s;
    cells[i] = Math.max(0, Math.min(255, r)); cells[i + 1] = Math.max(0, Math.min(255, gg)); cells[i + 2] = Math.max(0, Math.min(255, bl));
  }
  return cells;
}

// Lab of every cell: Float32Array [L, a, b] (cached by 8-bit colour).
// Cache by rounded 8-bit RGB: photos repeat colours heavily after downscaling, and rgbToLab (two pow() calls per
// channel plus a matrix) dominates otherwise.
function labsOf(cells, n) {
  const labs = new Float32Array(n * 3);
  const cache = new Map();
  for (let i = 0; i < n; i++) {
    const r = Math.round(cells[i * 4]), g = Math.round(cells[i * 4 + 1]), b = Math.round(cells[i * 4 + 2]);
    const key = (r << 16) | (g << 8) | b;
    let lab = cache.get(key);
    if (!lab) { lab = rgbToLab([r, g, b]); cache.set(key, lab); }
    labs[i * 3] = lab[0]; labs[i * 3 + 1] = lab[1]; labs[i * 3 + 2] = lab[2];
  }
  return labs;
}

// Background mask (1 = no stitch): transparent pixels, and for 'auto' / 'color' the region of the background
// colour connected to the border (flood fill within the tolerance).
// Transparent cells (alpha < 0.5) are always background, whatever the mode. 'auto' takes the most common border
// colour: in product photos and clip art the background touches the frame. Lab bins of 4 units group JPEG noise.
// Flood fill from the border (4-connected, explicit stack: recursion would overflow on large regions) removes only
// background CONNECTED to the frame, so a white eye inside a white-background portrait stays stitched; a global
// colour key would punch it out. Transparent cells conduct the fill even if their colour is far from the reference.
export function backgroundMask(cells, labs, W, H, { background = 'none', bgColor = '#ffffff', bgTolerance = 10 } = {}) {
  const n = W * H;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (cells[i * 4 + 3] < 0.5) mask[i] = 1;
  if (background !== 'auto' && background !== 'color') return mask;
  let ref;
  if (background === 'color') ref = rgbToLab(hexRgb(bgColor));
  else {
    // The most common colour of the border cells (coarse Lab bins).
    const bins = new Map();
    const add = (i) => { if (mask[i]) return; const k = Math.round(labs[i * 3] / 4) + ',' + Math.round(labs[i * 3 + 1] / 4) + ',' + Math.round(labs[i * 3 + 2] / 4); const e = bins.get(k) || { n: 0, i }; e.n++; bins.set(k, e); };
    for (let x = 0; x < W; x++) { add(x); add((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { add(y * W); add(y * W + W - 1); }
    let best = null;
    for (const e of bins.values()) if (!best || e.n > best.n) best = e;
    if (!best) return mask;
    ref = [labs[best.i * 3], labs[best.i * 3 + 1], labs[best.i * 3 + 2]];
  }
  const near = (i) => deltaE2000(ref, [labs[i * 3], labs[i * 3 + 1], labs[i * 3 + 2]]) <= bgTolerance;
  const stack = [];
  const seen = new Uint8Array(n);
  const push = (i) => { if (!seen[i]) { seen[i] = 1; if (mask[i] || near(i)) stack.push(i); } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (stack.length) {
    const i = stack.pop();
    mask[i] = 1;
    const x = i % W, y = (i / W) | 0;
    if (x > 0) push(i - 1);
    if (x < W - 1) push(i + 1);
    if (y > 0) push(i - W);
    if (y < H - 1) push(i + W);
  }
  return mask;
}

const hexRgb = (h) => { const n = parseInt(String(h).replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

// Nearest candidate by ΔE2000 with a ΔE76 pre-selection and a cache by rounded Lab.
// Two-stage search: squared ΔE76 over all candidates keeps the best 6 in a tiny insertion-sorted buffer, then
// ΔE2000 decides among those 6. ΔE76 and ΔE2000 disagree on ranking mainly among close colours, and the true nearest
// by ΔE2000 is in the ΔE76 top 6 in practice; scanning every thread with ΔE2000 per distinct colour would be many times
// slower. penalty biases specific candidates (blends) without changing the metric.
// Cache key: Lab rounded to 0.5 units (error <= 0.25 ΔE76, invisible), packed into one number (L*2 < 201, a and b
// shifted by 400 stay under 10^4). Capped at 200 000 entries so a noisy photo cannot exhaust memory.
function nearestFinder(cands, penalty = null) {
  const n = cands.length;
  const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
  cands.forEach((c, i) => { L[i] = c.lab[0]; A[i] = c.lab[1]; B[i] = c.lab[2]; });
  const cache = new Map();
  const top = 6;
  const idx = new Int32Array(top), dist = new Float64Array(top);
  return function nearest(l, a, b) {
    const key = Math.round(l * 2) * 1e8 + Math.round(a * 2 + 400) * 1e4 + Math.round(b * 2 + 400);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const d = (L[i] - l) ** 2 + (A[i] - a) ** 2 + (B[i] - b) ** 2;
      if (k < top) { let j = k++; while (j > 0 && dist[j - 1] > d) { dist[j] = dist[j - 1]; idx[j] = idx[j - 1]; j--; } dist[j] = d; idx[j] = i; }
      else if (d < dist[top - 1]) { let j = top - 1; while (j > 0 && dist[j - 1] > d) { dist[j] = dist[j - 1]; idx[j] = idx[j - 1]; j--; } dist[j] = d; idx[j] = i; }
    }
    let best = -1, bd = Infinity;
    const q = [l, a, b];
    for (let j = 0; j < k; j++) {
      const c = idx[j];
      const d = deltaE2000(q, cands[c].lab) + (penalty ? penalty[c] : 0);
      if (d < bd) { bd = d; best = c; }
    }
    if (cache.size < 200000) cache.set(key, best);
    return best;
  };
}

// Candidate colours: the catalogue's threads (or the chosen ones), and blends of close pairs among the threads the
// image uses most.
// Blends multiply the search space quadratically, so only pairs among the 36 most used threads are considered
// (630 pairs at most), and only pairs 3..22 ΔE apart: closer pairs add nothing a single thread lacks, farther ones
// read as speckle rather than a new colour at stitch scale. Mixed in linear light like real strands.
function candidates(opts, labs, mask, n) {
  let threads = opts.threads && opts.threads.length ? opts.threads.map(threadByKey).filter(Boolean) : catalog(opts.brand).threads;
  if (!threads.length) threads = catalog('dmc').threads;
  const cands = threads.map((t) => ({ key: t.key, lab: t.lab, rgb: t.rgb, thread: t }));
  if (!opts.blends) return cands;
  const near = nearestFinder(cands);
  const hist = new Map();
  for (let i = 0; i < n; i += 1) {
    if (mask[i]) continue;
    const c = near(labs[i * 3], labs[i * 3 + 1], labs[i * 3 + 2]);
    hist.set(c, (hist.get(c) || 0) + 1);
  }
  const top = [...hist].sort((a, b) => b[1] - a[1]).slice(0, 36).map(([c]) => cands[c]);
  const out = cands.slice();
  for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
    const d = deltaE2000(top[i].lab, top[j].lab);
    if (d < 3 || d > 22) continue;
    const rgb = mixColors([top[i].rgb, top[j].rgb]);
    out.push({ key: top[i].key + '+' + top[j].key, lab: rgbToLab(rgb), rgb, blend: [top[i].thread, top[j].thread] });
  }
  return out;
}

// Greedy palette reduction: repeatedly remove the colour whose stitches would move the least (count^0.75 × ΔE to
// the nearest remaining colour). Returns the kept candidate indices.
// Greedy agglomeration on the precomputed ΔE2000 matrix (m x m, m = colours actually used, typically < 200).
// Cost of removing colour i = weight^0.75 x ΔE to its nearest survivor. With exponent 1 (total error) large areas
// always win and a small, distinct detail (eyes, highlights) is merged first; 0.75 tilts toward keeping it. Blends
// are 20 % cheaper to drop: each costs two skeins and extra handling. Removed weight moves to the nearest survivor,
// so later decisions see the merged areas. nn[] is refreshed lazily, only when its target died.
function reduce(cands, count, N) {
  let active = [];
  for (let i = 0; i < cands.length; i++) if (count[i] > 0) active.push(i);
  if (active.length <= N) return active;
  const m = active.length;
  const D = new Float32Array(m * m);
  for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) { const d = deltaE2000(cands[active[i]].lab, cands[active[j]].lab); D[i * m + j] = D[j * m + i] = d; }
  const alive = new Uint8Array(m).fill(1);
  const w = active.map((c) => count[c]);
  const nn = new Int32Array(m).fill(-1);
  const nearestAlive = (i) => { let b = -1, bd = Infinity; for (let j = 0; j < m; j++) if (j !== i && alive[j] && D[i * m + j] < bd) { bd = D[i * m + j]; b = j; } return b; };
  for (let i = 0; i < m; i++) nn[i] = nearestAlive(i);
  let left = m;
  while (left > N) {
    let best = -1, bc = Infinity;
    for (let i = 0; i < m; i++) {
      if (!alive[i]) continue;
      if (nn[i] < 0 || !alive[nn[i]]) nn[i] = nearestAlive(i);
      const cost = w[i] ** 0.75 * D[i * m + nn[i]] * (cands[active[i]].blend ? 0.8 : 1);
      if (cost < bc) { bc = cost; best = i; }
    }
    const into = nn[best];
    alive[best] = 0;
    w[into] += w[best];
    left--;
  }
  return active.filter((_, i) => alive[i]);
}

// Recursive Bayer construction: M(2n) = 4 M(n) + M(2) per quadrant, giving an 8 x 8 threshold matrix whose
// thresholds are spread as evenly as possible in space. Normalised to (v + 0.5) / 64 so no cell has threshold 0 or 1.
const BAYER8 = (() => {
  const m = [[0, 2], [3, 1]];
  let cur = m;
  for (let s = 2; s < 8; s *= 2) {
    const next = [];
    for (let y = 0; y < s * 2; y++) { next.push([]); for (let x = 0; x < s * 2; x++) next[y].push(4 * cur[y % s][x % s] + m[(y / s) | 0][(x / s) | 0]); }
    cur = next;
  }
  return cur.map((r) => r.map((v) => (v + 0.5) / 64));
})();

// Maps every cell to one of the palette colours (indices into pal), with dithering.
// Floyd-Steinberg in Lab, serpentine (alternate row direction) to avoid the diagonal "worm" artefacts of raster
// order. Error per channel is clamped to ±30 and scaled by strength: unclamped error from a colour far outside the
// palette smears across whole regions. Error does not flow into background cells (it would be lost anyway and must
// not bleed across the cut-out edge).
// Ordered: project the cell colour onto the segment between its two nearest threads; the position alpha decides,
// through the Bayer threshold, which of the two the cell takes. Gives regular, stitchable patterns that read as an
// intermediate tone, unlike FS noise. Skipped when the two threads are > 30 ΔE apart (the mix would not read as a
// tone). Strength narrows the transition band around alpha = 0.5.
function mapCells(labs, mask, W, H, pal, opts) {
  const n = W * H;
  const out = new Int16Array(n).fill(-1);
  const near = nearestFinder(pal);
  const s = Math.max(0, Math.min(1, opts.ditherStrength));
  if (opts.dither === 'fs' && s > 0) {
    const err = new Float32Array(n * 3);
    for (let y = 0; y < H; y++) {
      const rev = y % 2 === 1;
      for (let k = 0; k < W; k++) {
        const x = rev ? W - 1 - k : k, i = y * W + x;
        if (mask[i]) continue;
        const l = labs[i * 3] + err[i * 3], a = labs[i * 3 + 1] + err[i * 3 + 1], b = labs[i * 3 + 2] + err[i * 3 + 2];
        const c = near(l, a, b);
        out[i] = c;
        const cl = pal[c].lab;
        const e = [l - cl[0], a - cl[1], b - cl[2]].map((v) => Math.max(-30, Math.min(30, v)) * s);
        const spread = (dx, dy, f) => {
          const xx = x + (rev ? -dx : dx), yy = y + dy;
          if (xx < 0 || xx >= W || yy >= H) return;
          const j = yy * W + xx;
          if (mask[j]) return;
          err[j * 3] += e[0] * f; err[j * 3 + 1] += e[1] * f; err[j * 3 + 2] += e[2] * f;
        };
        spread(1, 0, 7 / 16); spread(-1, 1, 3 / 16); spread(0, 1, 5 / 16); spread(1, 1, 1 / 16);
      }
    }
    return out;
  }
  if (opts.dither === 'ordered' && s > 0) {
    // Pattern dithering: between the two nearest colours, by the position of the cell's colour on the segment.
    for (let i = 0; i < n; i++) {
      if (mask[i]) continue;
      const q = [labs[i * 3], labs[i * 3 + 1], labs[i * 3 + 2]];
      let c1 = -1, c2 = -1, d1 = Infinity, d2 = Infinity;
      for (let c = 0; c < pal.length; c++) {
        const d = deltaE2000(q, pal[c].lab);
        if (d < d1) { d2 = d1; c2 = c1; d1 = d; c1 = c; } else if (d < d2) { d2 = d; c2 = c; }
      }
      out[i] = c1;
      if (c2 < 0) continue;
      const p1 = pal[c1].lab, p2 = pal[c2].lab;
      if (deltaE2000(p1, p2) > 30) continue;
      const v = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]];
      const len2 = v[0] ** 2 + v[1] ** 2 + v[2] ** 2 || 1;
      const alpha = Math.max(0, Math.min(1, ((q[0] - p1[0]) * v[0] + (q[1] - p1[1]) * v[1] + (q[2] - p1[2]) * v[2]) / len2));
      const a2 = Math.max(0, Math.min(1, (alpha - 0.5) / s + 0.5));
      const x = i % W, y = (i / W) | 0;
      if (BAYER8[y & 7][x & 7] < a2) out[i] = c2;
    }
    return out;
  }
  for (let i = 0; i < n; i++) if (!mask[i]) out[i] = near(labs[i * 3], labs[i * 3 + 1], labs[i * 3 + 2]);
  return out;
}

// Confetti clean-up on the mapped grid (-1 = empty). level 1: isolated stitches; 2: also stitches with one equal
// neighbour, specks in the background and holes; 3: plus regions smaller than minRegion (default 4).
// Confetti (lone stitches) is the main complaint about converted charts: each one costs a thread start and stop.
// Replacement rule: the most frequent 8-neighbour colour, ties broken toward the colour closest in ΔE (the /1000
// keeps the tie-breaker below one neighbour). A cell changes only with enough support: 2 neighbours for colour to
// colour, 5 when background is involved (cutting into or filling the silhouette needs a clear majority).
// Passes read grid and write next (double buffering), so a change cannot cascade within one pass.
// Small regions (level 3 / minRegion): 4-connected components smaller than minR take the bordering colour with the
// longest shared border, penalised by ΔE / 10 so a region prefers a similar neighbour over a merely longer one.
export function cleanupGrid(grid, W, H, pal, level = 1, minRegion = 0) {
  const n = W * H;
  let removed = 0;
  const neighbours = (i) => {
    const x = i % W, y = (i / W) | 0, out = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H) out.push(grid[yy * W + xx]);
    }
    return out;
  };
  const passes = level >= 2 ? 2 : 1;
  for (let pass = 0; pass < passes && level > 0; pass++) {
    const next = grid.slice();
    for (let i = 0; i < n; i++) {
      const v = grid[i];
      const nb = neighbours(i);
      const same = nb.filter((c) => c === v).length;
      const limit = level >= 2 ? 1 : 0;
      if (same > limit) continue;
      if (v < 0 && level < 2) continue; // holes only from level 2
      const freq = new Map();
      for (const c of nb) freq.set(c, (freq.get(c) || 0) + 1);
      let best = v, bn = -1;
      for (const [c, k] of freq) {
        if (c === v) continue;
        if (c < 0 && level < 2) continue; // stitches turn into background only from level 2
        const tie = v >= 0 && c >= 0 ? -deltaE2000(pal[v].lab, pal[c].lab) / 1000 : 0;
        if (k + tie > bn) { bn = k + tie; best = c; }
      }
      if (best !== v && bn >= (v < 0 || best < 0 ? 5 : 2)) { next[i] = best; removed++; }
    }
    grid.set(next);
  }
  const minR = minRegion || (level >= 3 ? 4 : 0);
  if (minR > 1) {
    const seen = new Int32Array(n).fill(-1);
    let id = 0;
    for (let i = 0; i < n; i++) {
      if (seen[i] >= 0 || grid[i] < 0) continue;
      const v = grid[i], stack = [i], cells = [];
      seen[i] = id;
      while (stack.length) {
        const j = stack.pop();
        cells.push(j);
        const x = j % W, y = (j / W) | 0;
        for (const k of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, y > 0 ? j - W : -1, y < H - 1 ? j + W : -1]) if (k >= 0 && seen[k] < 0 && grid[k] === v) { seen[k] = id; stack.push(k); }
      }
      id++;
      if (cells.length >= minR) continue;
      const border = new Map();
      for (const j of cells) {
        const x = j % W, y = (j / W) | 0;
        for (const k of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, y > 0 ? j - W : -1, y < H - 1 ? j + W : -1]) if (k >= 0 && grid[k] !== v && grid[k] >= 0) border.set(grid[k], (border.get(grid[k]) || 0) + 1);
      }
      let best = -1, bs = -Infinity;
      for (const [c, k] of border) { const sc = k - deltaE2000(pal[v].lab, pal[c].lab) / 10; if (sc > bs) { bs = sc; best = c; } }
      if (best >= 0) { for (const j of cells) grid[j] = best; removed += cells.length; }
    }
  }
  return removed;
}

// Backstitch outlines along cell borders where the colours differ by at least `threshold` (ΔE2000); unit segments
// merged into straight runs. Returns [{ x1, y1, x2, y2 }].
// Edges live on the dual grid: vert[y][x] is the left edge of cell x in row y (x = 0..W), hor[y][x] the top edge of
// cell x (y = 0..H). Collinear unit edges are merged into maximal runs, because one long backstitch line is how
// charts draw outlines and it keeps the line count (and the OXS / PDF size) small.
export function outlineSegments(grid, W, H, pal, threshold = 30, withBackground = true) {
  const differs = (a, b) => {
    if (a === b) return false;
    if (a < 0 || b < 0) return withBackground && (a >= 0 || b >= 0);
    return deltaE2000(pal[a].lab, pal[b].lab) >= threshold;
  };
  const vert = new Uint8Array((W + 1) * H), hor = new Uint8Array(W * (H + 1));
  for (let y = 0; y < H; y++) for (let x = 0; x <= W; x++) {
    const a = x > 0 ? grid[y * W + x - 1] : -1, b = x < W ? grid[y * W + x] : -1;
    if (differs(a, b)) vert[y * (W + 1) + x] = 1;
  }
  for (let y = 0; y <= H; y++) for (let x = 0; x < W; x++) {
    const a = y > 0 ? grid[(y - 1) * W + x] : -1, b = y < H ? grid[y * W + x] : -1;
    if (differs(a, b)) hor[y * W + x] = 1;
  }
  const out = [];
  for (let x = 0; x <= W; x++) for (let y = 0; y < H;) {
    if (!vert[y * (W + 1) + x]) { y++; continue; }
    let y2 = y;
    while (y2 < H && vert[y2 * (W + 1) + x]) y2++;
    out.push({ x1: x, y1: y, x2: x, y2 });
    y = y2;
  }
  for (let y = 0; y <= H; y++) for (let x = 0; x < W;) {
    if (!hor[y * W + x]) { x++; continue; }
    let x2 = x;
    while (x2 < W && hor[y * W + x2]) x2++;
    out.push({ x1: x, y1: y, x2, y2: y });
    x = x2;
  }
  return out;
}

// Orchestrates the steps listed in README.md. Blends carry a 1.5 ΔE penalty in the first assignment so a single
// thread wins whenever it is nearly as good. Refinement: at most 2 k-means iterations, each centre (mean Lab of its
// cells) snaps to the nearest candidate; a replacement must beat the current thread by 0.5 ΔE (hysteresis against
// oscillation) and may not duplicate a kept colour. Clusters that lost all cells are dropped.
export function convertImage(image, o = {}) {
  const opts = { ...CONVERT_DEFAULTS, ...o };
  const crop = opts.crop;
  const iw = crop ? crop.w : image.width, ih = crop ? crop.h : image.height;
  const { width: W, height: H } = targetSize(iw, ih, opts);
  const n = W * H;
  const cells = adjust(resample(image, W, H, crop), opts);
  const labs = labsOf(cells, n);
  const mask = backgroundMask(cells, labs, W, H, opts);
  const cands = candidates(opts, labs, mask, n);
  const penalty = new Float32Array(cands.length).map((_, i) => (cands[i].blend ? 1.5 : 0));
  // 1. Every cell to its nearest candidate; 2. greedy reduction; 3. refinement (centroid -> nearest thread).
  const near = nearestFinder(cands, penalty);
  const assign = new Int32Array(n).fill(-1);
  const count = new Float64Array(cands.length);
  for (let i = 0; i < n; i++) if (!mask[i]) { const c = near(labs[i * 3], labs[i * 3 + 1], labs[i * 3 + 2]); assign[i] = c; count[c]++; }
  const N = Math.max(1, Math.min(250, Math.round(opts.maxColors) || 24));
  let kept = reduce(cands, count, N);
  for (let iter = 0; iter < 2 && kept.length; iter++) {
    const sub = kept.map((c) => cands[c]);
    const nf = nearestFinder(sub);
    const sums = kept.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) if (!mask[i]) { const k = nf(labs[i * 3], labs[i * 3 + 1], labs[i * 3 + 2]); const s = sums[k]; s[0] += labs[i * 3]; s[1] += labs[i * 3 + 1]; s[2] += labs[i * 3 + 2]; s[3]++; }
    const used = new Set(kept);
    let changed = false;
    const next = kept.map((c, k) => {
      const s = sums[k];
      if (!s[3]) return c;
      const centre = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
      const best = near(...centre);
      if (best !== c && !used.has(best) && deltaE2000(centre, cands[best].lab) + 0.5 < deltaE2000(centre, cands[c].lab)) { used.delete(c); used.add(best); changed = true; return best; }
      return c;
    }).filter((c, k) => sums[k][3] > 0);
    kept = next;
    if (!changed) break;
  }
  const pal = kept.map((c) => cands[c]);
  const grid = mapCells(labs, mask, W, H, pal, opts);
  const cleaned = cleanupGrid(grid, W, H, pal, Math.round(opts.cleanup) || 0, Math.round(opts.minRegion) || 0);
  // Colour error of the result.
  let sumDE = 0, maxDE = 0, stitched = 0;
  for (let i = 0; i < n; i++) {
    if (grid[i] < 0) continue;
    stitched++;
    const d = deltaE2000([labs[i * 3], labs[i * 3 + 1], labs[i * 3 + 2]], pal[grid[i]].lab);
    sumDE += d;
    if (d > maxDE) maxDE = d;
  }
  // Palette entries in order of use.
  const counts = new Float64Array(pal.length);
  for (let i = 0; i < n; i++) if (grid[i] >= 0) counts[grid[i]]++;
  // Palette by frequency so assignSymbols gives the simplest symbols to the most stitched colours; colours emptied by
  // clean-up are dropped here.
  const order = pal.map((_, i) => i).filter((i) => counts[i] > 0).sort((a, b) => counts[b] - counts[a]);
  const remap = new Int32Array(pal.length).fill(-1);
  order.forEach((old, k) => { remap[old] = k; });
  const strands = opts.strands || 2;
  const palette = order.map((i) => {
    const c = pal[i];
    return c.blend ? blendEntry(c.blend, { strands: 2 }) : threadEntry(c.thread, { strands });
  });
  const scheme = createScheme({ width: W, height: H, title: opts.title, palette, fabric: { count: opts.count || 14, ...(opts.fabric || {}) } });
  const layer = scheme.layers[0];
  layer.name = 'Cross stitch';
  for (let i = 0; i < n; i++) if (grid[i] >= 0) layer.cells[i] = remap[grid[i]] + 1;
  let outlines = 0;
  if (opts.outline) {
    const segs = outlineSegments(grid, W, H, pal, opts.outlineThreshold, opts.background !== 'none');
    const t = opts.outlineThread && opts.outlineThread !== 'auto' ? threadByKey(opts.outlineThread) : darkest(opts.brand || 'dmc');
    if (segs.length && t) {
      let p = palette.findIndex((e) => !e.blend && e.catalog === t.catalog && e.code === t.code);
      if (p < 0) { palette.push(threadEntry(t, { strands, bsStrands: 1 })); p = palette.length - 1; }
      const bl = emptyLayer(W, H, 'Backstitch');
      bl.lines = segs.map((s) => ({ ...s, p, k: 'back' }));
      scheme.layers.push(bl);
      outlines = segs.length;
    }
  }
  scheme.palette = palette;
  const syms = assignSymbols(palette, { mode: opts.symbols, counts: [...order.map((i) => counts[i]), 0], labs: palette.map((e) => rgbToLab(hexRgb(e.hex))), blankFirst: !!opts.blankFirst });
  palette.forEach((e, i) => { e.symbol = syms[i]; });
  return {
    scheme,
    stats: {
      width: W, height: H, colors: palette.length, stitched, empty: n - stitched, cleaned, outlines,
      meanDE: stitched ? sumDE / stitched : 0, maxDE, blends: palette.filter((e) => e.blend).length, candidates: cands.length,
    },
  };
}

// The colour of every cell after conversion as RGBA bytes (previews without a renderer).
// Full crosses only (parts, lines and beads are ignored); visible layers painted bottom to top.
export function schemeColors(scheme) {
  const out = new Uint8ClampedArray(scheme.width * scheme.height * 4);
  const rgb = scheme.palette.map((e) => hexRgb(e.hex));
  for (const l of scheme.layers) {
    if (!l.visible) continue;
    for (let i = 0; i < l.cells.length; i++) if (l.cells[i]) { const c = rgb[l.cells[i] - 1]; out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = 255; }
  }
  return out;
}

export { labToRgb };
