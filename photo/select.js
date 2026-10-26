// photo/select.js - selections of the photo editor as pure data: an 8-bit coverage mask over a bounding box,
// { x, y, w, h, data: Uint8Array(w * h) } (0 = outside, 255 = inside, between = feathered / anti-aliased), or null
// for "no selection". Immutable: every operation returns a new selection, so history keeps old ones by reference.
// Shapes (rectangle, ellipse, polygon / lasso) rasterize with 4×4 coverage; magic wand / bucket fill flood RGBA
// pixels by tolerance; combining (replace / add / subtract / intersect), invert, feather; contours trace the outline
// (marching squares) for the marching ants. Pure: pages, workers, Node.

//
// Design rules:
// - Coverage (0..255), not a boolean mask or a vector path: it represents anti-aliased edges, feathering and wand
//   softness uniformly, and every combine operation becomes per-pixel arithmetic on probabilities (fuzzy set algebra).
// - Bounding box + trim: a small selection on a 50 MP document costs its box, not the document. Every constructor ends
//   with trim() so boxes stay tight and empty results are null (callers test `if (sel)`, never scan data).
import { wandMask } from '../raster/wand.js';

// Sub-samples per axis for anti-aliased shapes: 16 samples give 17 coverage levels, visually smooth for edges; 8x8
// would cost 4x for no visible gain at 8-bit output. polygonSelection divides by it with `>> 2`, so SUB must stay 4.
const SUB = 4;

const clampRect = (r, W, H) => {
  const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(W, Math.ceil(r.x + r.w)), y1 = Math.min(H, Math.ceil(r.y + r.h));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
};

/** Selection of everything in a W × H document. */
export function selectAll(W, H) { return { x: 0, y: 0, w: W, h: H, data: new Uint8Array(W * H).fill(255) }; }

/** Rectangle (pixel-aligned edges are hard; fractional edges get partial coverage). */
export function rectSelection(r, W, H) {
  const b = clampRect(r, W, H);
  if (!b) return null;
  const data = new Uint8Array(b.w * b.h);
  // Exact area coverage, no sampling: a rectangle is separable, so pixel coverage = (overlap in x) * (overlap in y),
  // each the length of [p, p + 1] intersected with the edge interval.
  const cov = (p, lo, hi) => Math.max(0, Math.min(p + 1, hi) - Math.max(p, lo));
  for (let y = 0; y < b.h; y++) {
    const cy = cov(b.y + y, r.y, r.y + r.h);
    for (let x = 0; x < b.w; x++) data[y * b.w + x] = Math.round(255 * cy * cov(b.x + x, r.x, r.x + r.w));
  }
  return trim({ ...b, data });
}

/** Polygon (lasso, polygonal lasso) of points [[x, y], …], non-zero winding, anti-aliased. */
export function polygonSelection(points, W, H) {
  if (!points || points.length < 3) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
  const b = clampRect({ x: minX, y: minY, w: maxX - minX, h: maxY - minY }, W, H);
  if (!b) return null;
  // Scanline rasterisation at SUB rows per pixel: for each sub-row, intersect every edge (half-open rule y0 <= y < y1
  // so a vertex shared by two edges is counted once), sort crossings, and fill spans where the winding number is
  // non-zero. Non-zero rather than even-odd: a self-crossing lasso loop stays selected instead of punching a hole,
  // which is what users drawing a sloppy loop intend.
  const acc = new Uint16Array(b.w * b.h);
  const n = points.length, xs = [];
  for (let sy = 0; sy < b.h * SUB; sy++) {
    const y = b.y + (sy + 0.5) / SUB;
    xs.length = 0;
    for (let i = 0; i < n; i++) {
      const [x0, y0] = points[i], [x1, y1] = points[(i + 1) % n];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) xs.push([x0 + ((y - y0) / (y1 - y0)) * (x1 - x0), y1 > y0 ? 1 : -1]);
    }
    if (!xs.length) continue;
    xs.sort((a, c) => a[0] - c[0]);
    const row = Math.floor(sy / SUB) * b.w;
    let wind = 0;
    for (let k = 0; k < xs.length - 1; k++) {
      wind += xs[k][1];
      if (!wind) continue;
      // sub-pixel columns whose centres fall inside [xs[k], xs[k + 1])
      const a = Math.max(0, Math.ceil((xs[k][0] - b.x) * SUB - 0.5)), e = Math.min(b.w * SUB, Math.ceil((xs[k + 1][0] - b.x) * SUB - 0.5));
      for (let sx = a; sx < e; sx++) acc[row + (sx >> 2)]++;
    }
  }
  const data = new Uint8Array(b.w * b.h), full = SUB * SUB;
  for (let i = 0; i < data.length; i++) data[i] = Math.round((acc[i] * 255) / full);
  return trim({ ...b, data });
}

/** Ellipse inscribed in the rectangle r. */
export function ellipseSelection(r, W, H) {
  if (!(r.w > 0 && r.h > 0)) return null;
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rx = r.w / 2, ry = r.h / 2;
  // Ellipse as a polygon through polygonSelection (one rasteriser to maintain). Vertex count grows with size so the
  // chord error (sagitta about r * pi^2 / (2 n^2)) stays well below a pixel; capped at 720 for huge ellipses.
  const n = Math.max(24, Math.min(720, Math.round((rx + ry) * 1.5)));
  const pts = [];
  for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 2; pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); }
  return polygonSelection(pts, W, H);
}

/** Coverage at a document pixel (0..255). */
export function coverage(sel, x, y) {
  if (!sel) return 255;
  x = Math.floor(x - sel.x); y = Math.floor(y - sel.y);
  return x >= 0 && y >= 0 && x < sel.w && y < sel.h ? sel.data[y * sel.w + x] : 0;
}

/** Bounding box shrunk to the covered pixels (null when nothing is covered). */
export function trim(sel) {
  if (!sel) return null;
  const { w, h, data } = sel;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) if (data[row + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  }
  if (x1 < 0) return null;
  if (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1) return sel;
  const nw = x1 - x0 + 1, nh = y1 - y0 + 1, out = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) out.set(data.subarray((y0 + y) * w + x0, (y0 + y) * w + x0 + nw), y * nw);
  return { x: sel.x + x0, y: sel.y + y0, w: nw, h: nh, data: out };
}

/**
 * Combines a current selection with a new shape: mode 'replace' | 'add' | 'subtract' | 'intersect'
 * (coverages: add = a + b - ab, subtract = a (1 - b), intersect = ab).
 */
// The formulas are the probabilistic sum, difference and product: they reduce to boolean OR / AND NOT / AND for 0/255
// coverage and stay continuous for soft edges (min/max would also work but creates creases where edges cross).
// The result box is the union (add), a's box (subtract: can only shrink a) or the intersection (intersect).
export function combine(a, b, mode = 'replace') {
  if (mode === 'replace' || !a) return mode === 'subtract' || mode === 'intersect' ? (mode === 'intersect' ? null : a) : b;
  if (!b) return mode === 'intersect' ? null : a;
  let x0, y0, x1, y1;
  if (mode === 'add') { x0 = Math.min(a.x, b.x); y0 = Math.min(a.y, b.y); x1 = Math.max(a.x + a.w, b.x + b.w); y1 = Math.max(a.y + a.h, b.y + b.h); }
  else if (mode === 'subtract') { x0 = a.x; y0 = a.y; x1 = a.x + a.w; y1 = a.y + a.h; }
  else { x0 = Math.max(a.x, b.x); y0 = Math.max(a.y, b.y); x1 = Math.min(a.x + a.w, b.x + b.w); y1 = Math.min(a.y + a.h, b.y + b.h); if (x1 <= x0 || y1 <= y0) return null; }
  const w = x1 - x0, h = y1 - y0, data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ca = coverage(a, x0 + x, y0 + y) / 255, cb = coverage(b, x0 + x, y0 + y) / 255;
      const v = mode === 'add' ? ca + cb - ca * cb : mode === 'subtract' ? ca * (1 - cb) : ca * cb;
      data[y * w + x] = Math.round(v * 255);
    }
  }
  return trim({ x: x0, y: y0, w, h, data });
}

/** Everything that was not selected, in a W × H document (null selection: nothing). */
export function invert(sel, W, H) {
  if (!sel) return null;
  const data = new Uint8Array(W * H).fill(255);
  for (let y = 0; y < sel.h; y++) {
    const ty = sel.y + y;
    if (ty < 0 || ty >= H) continue;
    for (let x = 0; x < sel.w; x++) { const tx = sel.x + x; if (tx >= 0 && tx < W) data[ty * W + tx] = 255 - sel.data[y * sel.w + x]; }
  }
  return trim({ x: 0, y: 0, w: W, h: H, data });
}

// Three box passes over a Uint8 plane (gaussian-like), clamped edges.
// By the central limit theorem repeated box filters converge to a gaussian; three passes are visually
// indistinguishable. Box widths per pass follow the "ideal averaging filter width" method (Kovesi): m passes of width
// wl and the rest wl + 2, chosen so the summed variance equals sigma^2. Each pass is a running sum, O(1) per pixel
// regardless of radius, unlike a direct gaussian kernel at O(radius).
function blurPlane(src, w, h, sigma) {
  const n = 3, wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  let a = Float32Array.from(src), b = new Float32Array(src.length);
  for (let pass = 0; pass < n; pass++) {
    const r = ((pass < m ? wl : wl + 2) - 1) >> 1;
    if (r < 1) continue;
    for (const horizontal of [true, false]) {
      const len = horizontal ? w : h, lines = horizontal ? h : w, step = horizontal ? 1 : w, ls = horizontal ? w : 1, inv = 1 / (2 * r + 1);
      for (let l = 0; l < lines; l++) {
        const base = l * ls, at = (i) => a[base + Math.max(0, Math.min(len - 1, i)) * step];
        let acc = 0;
        for (let i = -r; i <= r; i++) acc += at(i);
        for (let i = 0; i < len; i++) { b[base + i * step] = acc * inv; acc += at(i + r + 1) - at(i - r); }
      }
      [a, b] = [b, a];
    }
  }
  return a;
}

/** Feathered selection (gaussian-like edge of `radius` px), grown by the blur's reach and clipped to W × H. */
export function feather(sel, radius, W, H) {
  if (!sel || !(radius > 0.3)) return sel;
  // Grow the box by 3 sigma: beyond that the gaussian tail is under 0.3% and rounds to 0 in 8 bits.
  const pad = Math.ceil(radius * 3);
  const b = clampRect({ x: sel.x - pad, y: sel.y - pad, w: sel.w + 2 * pad, h: sel.h + 2 * pad }, W, H);
  if (!b) return null;
  const plane = new Uint8Array(b.w * b.h);
  for (let y = 0; y < sel.h; y++) {
    const ty = sel.y + y - b.y;
    if (ty < 0 || ty >= b.h) continue;
    for (let x = 0; x < sel.w; x++) { const tx = sel.x + x - b.x; if (tx >= 0 && tx < b.w) plane[ty * b.w + tx] = sel.data[y * sel.w + x]; }
  }
  const out = blurPlane(plane, b.w, b.h, radius);
  const data = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) data[i] = Math.round(out[i]);
  return trim({ ...b, data });
}

/** Selection moved by (dx, dy), clipped to W × H. */
export function translate(sel, dx, dy, W, H) {
  if (!sel) return null;
  const moved = { ...sel, x: sel.x + Math.round(dx), y: sel.y + Math.round(dy) };
  return crop(moved, 0, 0, W, H);
}

/** Selection clipped to the rectangle (x, y, w, h) and re-based to its origin (document crop). */
export function crop(sel, cx, cy, cw, ch) {
  if (!sel) return null;
  const b = clampRect({ x: sel.x - cx, y: sel.y - cy, w: sel.w, h: sel.h }, cw, ch);
  if (!b) return null;
  const data = new Uint8Array(b.w * b.h);
  for (let y = 0; y < b.h; y++) {
    const sy = b.y + cy - sel.y, sx = b.x + cx - sel.x;
    data.set(sel.data.subarray((sy + y) * sel.w + sx, (sy + y) * sel.w + sx + b.w), y * b.w);
  }
  return trim({ ...b, data });
}

/**
 * Flood selection of RGBA pixels (raster/wand.js): from (x, y), pixels within `tolerance` (0..255) of the seed colour
 * by `metric` ('max': every channel, alpha included; 'rgba'; 'perceptual'); contiguous (scanline fill, 4- or
 * 8-connected with `diagonal`) or every matching pixel; `soft` (0..1) fades coverage near the tolerance; `antialias`
 * adds a 1-px rim at partial coverage.
 */
export function floodSelection(img, x, y, tolerance = 32, { contiguous = true, antialias = true, metric = 'max', soft = 0, diagonal = false } = {}) {
  const r = wandMask(img, x, y, { tolerance, contiguous, antialias, metric, soft, diagonal });
  if (!r) return null;
  const W = img.width;
  const b = { x: r.x0, y: r.y0, w: r.x1 - r.x0 + 1, h: r.y1 - r.y0 + 1 };
  const out = new Uint8Array(b.w * b.h);
  for (let yy = 0; yy < b.h; yy++) out.set(r.mask.subarray((b.y + yy) * W + b.x, (b.y + yy) * W + b.x + b.w), yy * b.w);
  return { ...b, data: out };
}

/**
 * Outline of the selection (coverage >= 128) as closed polylines in document coordinates, traced on a grid scaled
 * by `step` (> 1 traces a reduced copy: fewer segments for large selections).
 */
export function contours(sel, step = 1) {
  if (!sel) return [];
  const s = Math.max(1, Math.floor(step));
  const gw = Math.ceil(sel.w / s), gh = Math.ceil(sel.h / s);
  const on = (gx, gy) => {
    if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) return false;
    if (s === 1) return sel.data[gy * sel.w + gx] >= 128;
    // a reduced cell is inside when its centre sample is
    const x = Math.min(sel.w - 1, gx * s + (s >> 1)), y = Math.min(sel.h - 1, gy * s + (s >> 1));
    return sel.data[y * sel.w + x] >= 128;
  };
  // Marching-squares style boundary tracing on cell edges: every inside cell contributes the edges it shares with
  // outside cells, oriented clockwise (inside on the right), so edges chain head to tail into closed loops. Holes come
  // out as separate loops with the opposite orientation. Edge-based tracing avoids the saddle ambiguity of
  // corner-sampled marching squares.
  // boundary edges between inside and outside cells, as directed segments keyed by their start corner
  const next = new Map();
  const key = (x, y) => y * (gw + 2) + x;
  const add = (ax, ay, bx, by) => { const k = key(ax, ay); if (!next.has(k)) next.set(k, []); next.get(k).push([bx, by]); };
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      if (!on(gx, gy)) continue;
      if (!on(gx, gy - 1)) add(gx, gy, gx + 1, gy);
      if (!on(gx + 1, gy)) add(gx + 1, gy, gx + 1, gy + 1);
      if (!on(gx, gy + 1)) add(gx + 1, gy + 1, gx, gy + 1);
      if (!on(gx - 1, gy)) add(gx, gy + 1, gx, gy);
    }
  }
  const loops = [];
  for (const [k0, list] of next) {
    while (list.length) {
      const sx = k0 % (gw + 2), sy = Math.floor(k0 / (gw + 2));
      const pts = [[sx, sy]];
      let [cx, cy] = list.pop();
      // Guard bound = the maximum number of edges, so a bug in chaining can never hang the UI thread.
      for (let guard = 0; guard < 4 * (gw + 1) * (gh + 1); guard++) {
        const last = pts[pts.length - 1], prev = pts.length > 1 ? pts[pts.length - 2] : null;
        // merge collinear points
        if (prev && (prev[0] === last[0]) === (last[0] === cx) && (prev[1] === last[1]) === (last[1] === cy)) pts[pts.length - 1] = [cx, cy]; else pts.push([cx, cy]);
        if (cx === sx && cy === sy) break;
        const l = next.get(key(cx, cy));
        if (!l || !l.length) break;
        [cx, cy] = l.pop();
      }
      loops.push(pts.map(([x, y]) => [sel.x + Math.min(sel.w, x * s), sel.y + Math.min(sel.h, y * s)]));
    }
  }
  return loops;
}

/** Number of selected pixels' worth of coverage (for status lines). */
export function area(sel) {
  if (!sel) return 0;
  let s = 0;
  for (let i = 0; i < sel.data.length; i++) s += sel.data[i];
  return s / 255;
}

/** Whether a selection is a plain (unfeathered) rectangle covering its whole box. */
export function isRect(sel) {
  if (!sel) return false;
  for (let i = 0; i < sel.data.length; i++) if (sel.data[i] !== 255) return false;
  return true;
}
