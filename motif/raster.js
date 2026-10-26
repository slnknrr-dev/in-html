// motif/raster.js - a small pure-JS rasterizer over RGBA buffers (no DOM, so prints and piece textures render the same
// in Node and in the browser): anti-aliased polygon fills (non-zero rule, 4x vertical subsamples with exact horizontal
// coverage), affine transforms, image drawing with bilinear sampling, source-over alpha, optional wrap-around so that
// shapes crossing the edge of a repeat tile continue on the other side.
//
//   canvas(w, h, bg?) -> { width, height, data }       fillPolys(cv, polys, color, { m, alpha, wrap })
//   drawImage(cv, img, m (unit square -> canvas), { alpha, wrap })       hexToRgb, mulM, applyM
//
// Why not OffscreenCanvas / node-canvas: identical pixels in Node tests and every browser (canvas anti-aliasing differs
// per engine and GPU), no native dependency, and wrap-around tiling that the canvas API lacks. Speed is adequate
// because repeat units are small (a few hundred pixels per side).
// Colour model: straight (non-premultiplied) RGBA in a Uint8ClampedArray, the ImageData layout, so a result can be
// put on a real canvas with putImageData without conversion. The clamped array rounds and saturates on store.

export const hexToRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); const v = m ? m[1] : '000000'; return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)); };
// Affine maps [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f.
export const applyM = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
export const mulM = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
// Singular matrices fall back to det 1e-12 instead of producing NaN; a degenerate placement then maps to a huge
// coordinate and draws nothing visible rather than poisoning the buffer.
export const invM = (m) => { const d = m[0] * m[3] - m[1] * m[2] || 1e-12; return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]; };
// translate * rotate * scale(s, sy) in one matrix, the order every placement in this library uses.
export const trsM = (x, y, s, rotDeg = 0, sy = s) => { const r = (rotDeg * Math.PI) / 180, c = Math.cos(r), n = Math.sin(r); return [c * s, n * s, -n * sy, c * sy, x, y]; };

export function canvas(w, h, bg) {
  const data = new Uint8ClampedArray(w * h * 4);
  if (bg) { const [r, g, b] = hexToRgb(bg); for (let i = 0; i < data.length; i += 4) { data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; } }
  return { width: w, height: h, data };
}

// Porter-Duff source-over for straight alpha: out_a = a + da(1 - a), out_c = (c a + dc da (1 - a)) / out_a.
// The division un-premultiplies; skipping it would darken edges drawn over transparent pixels.
function blend(cv, x, y, r, g, b, a) {
  if (a <= 0) return;
  const i = (y * cv.width + x) * 4, d = cv.data;
  const da = d[i + 3] / 255, oa = a + da * (1 - a);
  if (oa <= 0) return;
  d[i] = (r * a + d[i] * da * (1 - a)) / oa;
  d[i + 1] = (g * a + d[i + 1] * da * (1 - a)) / oa;
  d[i + 2] = (b * a + d[i + 2] * da * (1 - a)) / oa;
  d[i + 3] = oa * 255;
}

// Coverage of polygons (canvas coordinates) on a per-pixel buffer; non-zero winding.
// Scanline coverage: 4 sub-scanlines per row; on each, crossings with every edge are sorted and spans with non-zero
// winding are accumulated with exact fractional coverage at the span's end pixels. Result: anti-aliasing equivalent
// to 4 vertical samples x infinite horizontal resolution, at O(rows * edges) instead of 16x supersampling.
// Rows live in a Map so only rows the shape touches allocate a Float32Array (motifs are sparse in a unit).
// Edge list is not sorted per row (no active edge table): fine for motif sizes, quadratic for huge polygons.
function coverage(cv, polys) {
  const W = cv.width, H = cv.height, S = 4;
  let y0 = Infinity, y1 = -Infinity;
  for (const p of polys) for (const q of p) { if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
  const cov = new Map(); // row -> Float32Array
  const r0 = Math.max(0, Math.floor(y0)), r1 = Math.min(H - 1, Math.ceil(y1));
  const edges = [];
  for (const p of polys) for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    if (a[1] === b[1]) continue;
    edges.push(a[1] < b[1] ? [a[0], a[1], b[0], b[1], 1] : [b[0], b[1], a[0], a[1], -1]);
  }
  for (let row = r0; row <= r1; row++) {
    let acc = null;
    for (let s = 0; s < S; s++) {
      const y = row + (s + 0.5) / S;
      const xs = [];
      // Half-open [y0, y1) interval: a vertex shared by two edges is counted exactly once, so no spurious crossings.
      for (const e of edges) if (y >= e[1] && y < e[3]) xs.push([e[0] + ((y - e[1]) / (e[3] - e[1])) * (e[2] - e[0]), e[4]]);
      if (!xs.length) continue;
      xs.sort((p, q) => p[0] - q[0]);
      let wind = 0;
      for (let k = 0; k < xs.length - 1; k++) {
        wind += xs[k][1];
        if (!wind) continue;
        const xa = Math.max(0, xs[k][0]), xb = Math.min(W, xs[k + 1][0]);
        if (xb <= xa) continue;
        if (!acc) acc = new Float32Array(W);
        const ia = Math.floor(xa), ib = Math.floor(xb);
        if (ia === ib) { acc[ia] += (xb - xa) / S; continue; }
        acc[ia] += (ia + 1 - xa) / S;
        for (let x = ia + 1; x < ib; x++) acc[x] += 1 / S;
        if (ib < W) acc[ib] += (xb - ib) / S;
      }
    }
    if (acc) cov.set(row, acc);
  }
  return cov;
}

/**
 * Fills polygons (each [[x, y], ...]) in colour. opts.m maps the polygons' coordinates to canvas pixels; opts.wrap
 * repeats the fill shifted by ± the canvas size so that shapes crossing an edge come back on the other side.
 */
// Wrap: the shape is filled again shifted by +-width / +-height, but only for shifts whose bounding box intersects
// the canvas. This is what makes a repeat tile seamless: a motif cut by the right edge reappears on the left.
// Each shift runs coverage separately, so a shape that overlaps its own shifted copy (larger than the tile) is
// blended twice there; acceptable because layer sizes are clamped in practice.
export function fillPolys(cv, polys, color, o = {}) {
  const m = o.m || [1, 0, 0, 1, 0, 0];
  const [r, g, b] = Array.isArray(color) ? color : hexToRgb(color);
  const alpha = o.alpha ?? 1;
  const base = polys.map((p) => p.map((q) => applyM(m, q)));
  const shifts = [[0, 0]];
  if (o.wrap) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of base) for (const q of p) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
    for (const dx of [-cv.width, 0, cv.width]) for (const dy of [-cv.height, 0, cv.height]) {
      if (!dx && !dy) continue;
      if (x1 + dx < 0 || x0 + dx > cv.width || y1 + dy < 0 || y0 + dy > cv.height) continue;
      shifts.push([dx, dy]);
    }
  }
  for (const [dx, dy] of shifts) {
    const cov = coverage(cv, dx || dy ? base.map((p) => p.map((q) => [q[0] + dx, q[1] + dy])) : base);
    for (const [row, acc] of cov) for (let x = 0; x < cv.width; x++) if (acc[x] > 0) blend(cv, x, row, r, g, b, Math.min(1, acc[x]) * alpha);
  }
}

/**
 * Draws an RGBA image: m maps the unit square [0,1]x[0,1] of the image to canvas pixels (so a placement is
 * translate * rotate * scale(w, h)). Bilinear sampling, source-over; wrap repeats across the canvas edges.
 */
// Inverse mapping (destination pixel -> source u, v) over the transformed bounding box, the standard way to avoid
// holes that forward mapping leaves under rotation or magnification. Pixel centres (x + 0.5) keep the sampling
// symmetric. Edges are hard (no coverage anti-aliasing), unlike fillPolys.
export function drawImage(cv, img, m, o = {}) {
  const inv = invM(m);
  const alpha = o.alpha ?? 1;
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map((q) => applyM(m, q));
  const shifts = [[0, 0]];
  if (o.wrap) for (const dx of [-cv.width, 0, cv.width]) for (const dy of [-cv.height, 0, cv.height]) if (dx || dy) shifts.push([dx, dy]);
  const sample = (u, v) => {
    // -0.5 aligns texel centres with u = (i + 0.5) / width, the convention of GPU bilinear filtering; indices are
    // clamped, so the border texel is extended rather than wrapped.
    const fx = u * img.width - 0.5, fy = v * img.height - 0.5;
    const x0 = Math.max(0, Math.min(img.width - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(img.height - 1, Math.floor(fy)));
    const x1 = Math.min(img.width - 1, x0 + 1), y1 = Math.min(img.height - 1, y0 + 1);
    const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0));
    const out = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const a = img.data[(y0 * img.width + x0) * 4 + k], b = img.data[(y0 * img.width + x1) * 4 + k];
      const c = img.data[(y1 * img.width + x0) * 4 + k], d = img.data[(y1 * img.width + x1) * 4 + k];
      out[k] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
    return out;
  };
  for (const [dx, dy] of shifts) {
    const xs = corners.map((q) => q[0] + dx), ys = corners.map((q) => q[1] + dy);
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(cv.width - 1, Math.ceil(Math.max(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(cv.height - 1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const [u, v] = applyM(inv, [x + 0.5 - dx, y + 0.5 - dy]);
      if (u < 0 || v < 0 || u > 1 || v > 1) continue;
      const s = sample(u, v);
      blend(cv, x, y, s[0], s[1], s[2], (s[3] / 255) * alpha);
    }
  }
}
