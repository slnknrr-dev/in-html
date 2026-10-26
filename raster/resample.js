// raster/resample.js - high-quality image resizing in plain JS: separable Lanczos-3, area averaging
// (exact box coverage) or bilinear (tent) filters, widened for downscaling, on premultiplied alpha so transparent
// edges do not darken. Horizontal passes stream through a small cache of source rows, so memory stays near the
// output size. Pure (no DOM): runs in workers and Node.
//
//   resize({ width, height, data: RGBA }, width2, height2, filter = 'lanczos3' | 'area' | 'bilinear') -> image

// Why separable 1D passes: a w x h resize with a k-tap kernel costs O(k) per pixel per axis instead of O(k^2).
// Why premultiplied alpha: averaging straight RGB with a transparent neighbour (often stored as black) bleeds dark
// fringes into edges; weighting colour by alpha removes that. Opaque images skip the alpha math entirely.
const sinc = (x) => { if (x === 0) return 1; const p = Math.PI * x; return Math.sin(p) / p; };
const KERNELS = {
  lanczos3: { support: 3, fn: (x) => (x <= -3 || x >= 3 ? 0 : sinc(x) * sinc(x / 3)) },
  bilinear: { support: 1, fn: (x) => { x = Math.abs(x); return x < 1 ? 1 - x : 0; } },
};

// Per destination pixel: first source index, tap count and normalized weights (Float32Array, all taps in a row).
// Weights are precomputed once per axis (they depend only on positions, not pixel values) and flattened into one
// Float32Array with offsets: the inner loops then read contiguous memory. Pixel centres are at +0.5 (the convention
// ImageMagick and browsers use), so no half-pixel shift appears. Normalising by the tap sum keeps flat areas flat at
// the borders where taps are clipped. Downscaling widens the kernel by the scale factor, otherwise it aliases.
function weights(srcLen, dstLen, filter) {
  const scale = srcLen / dstLen;
  const start = new Int32Array(dstLen), count = new Int32Array(dstLen);
  const list = [];
  if (filter === 'area') {
    // Exact coverage of [x0, x1) in source pixels (falls back to a 1-px box when enlarging).
    const s = Math.max(scale, 1);
    for (let d = 0; d < dstLen; d++) {
      const c = (d + 0.5) * scale;
      const x0 = Math.max(0, c - s / 2), x1 = Math.min(srcLen, c + s / 2);
      const i0 = Math.floor(x0), i1 = Math.min(srcLen - 1, Math.ceil(x1) - 1);
      const w = [];
      let sum = 0;
      for (let i = i0; i <= i1; i++) { const v = Math.max(0, Math.min(i + 1, x1) - Math.max(i, x0)); w.push(v); sum += v; }
      start[d] = i0; count[d] = w.length;
      for (const v of w) list.push(sum ? v / sum : 1 / w.length);
    }
  } else {
    const k = KERNELS[filter] || KERNELS.lanczos3;
    const f = Math.max(scale, 1); // filter widening for downscaling
    const support = k.support * f;
    for (let d = 0; d < dstLen; d++) {
      const c = (d + 0.5) * scale;
      let i0 = Math.floor(c - support), i1 = Math.ceil(c + support);
      i0 = Math.max(0, i0); i1 = Math.min(srcLen - 1, i1);
      const w = [];
      let sum = 0;
      for (let i = i0; i <= i1; i++) { const v = k.fn((i + 0.5 - c) / f); w.push(v); sum += v; }
      // trim zero taps at both ends
      let a = 0, b = w.length - 1;
      while (a < b && w[a] === 0) a++;
      while (b > a && w[b] === 0) b--;
      start[d] = i0 + a; count[d] = b - a + 1;
      for (let i = a; i <= b; i++) list.push(sum ? w[i] / sum : 0);
    }
  }
  const offs = new Int32Array(dstLen);
  for (let d = 1; d < dstLen; d++) offs[d] = offs[d - 1] + count[d - 1];
  return { start, count, offs, w: Float32Array.from(list) };
}

function isOpaque(data) {
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return false;
  return true;
}

/** Resized copy of an RGBA image. Same size returns a copy. */
export function resize(img, dw, dh, filter = 'lanczos3') {
  const { width: sw, height: sh, data } = img;
  dw = Math.max(1, Math.round(dw)); dh = Math.max(1, Math.round(dh));
  if (dw === sw && dh === sh) return { width: sw, height: sh, data: new Uint8ClampedArray(data) };
  const opaque = isOpaque(data);
  const H = weights(sw, dw, filter), V = weights(sh, dh, filter);
  // Horizontal pass of one source row -> premultiplied floats (dw * 4), cached while vertical taps need it.
  // Lazy row cache: each source row is filtered horizontally once, then reused by every output row whose vertical
  // window covers it; rows above the window are evicted, so memory is O(taps * dw), not O(sh * dw).
  const cache = new Map();
  const hrow = (y) => {
    let r = cache.get(y);
    if (r) return r;
    r = new Float32Array(dw * 4);
    const base = y * sw * 4;
    for (let x = 0; x < dw; x++) {
      const s = H.start[x], n = H.count[x], o = H.offs[x];
      let R = 0, G = 0, B = 0, A = 0;
      for (let k = 0; k < n; k++) {
        const p = base + (s + k) * 4, w = H.w[o + k];
        if (opaque) { R += data[p] * w; G += data[p + 1] * w; B += data[p + 2] * w; }
        else { const a = data[p + 3] * w; R += data[p] * a; G += data[p + 1] * a; B += data[p + 2] * a; A += a; }
      }
      const q = x * 4;
      r[q] = R; r[q + 1] = G; r[q + 2] = B; r[q + 3] = opaque ? 255 : A;
    }
    cache.set(y, r);
    return r;
  };
  const out = new Uint8ClampedArray(dw * dh * 4);
  const acc = new Float32Array(dw * 4);
  for (let y = 0; y < dh; y++) {
    const s = V.start[y], n = V.count[y], o = V.offs[y];
    // rows above the window are no longer needed (windows only move down)
    for (const k of cache.keys()) if (k < s) cache.delete(k);
    acc.fill(0);
    for (let k = 0; k < n; k++) {
      const r = hrow(s + k), w = V.w[o + k];
      for (let i = 0; i < acc.length; i++) acc[i] += r[i] * w;
    }
    const base = y * dw * 4;
    for (let x = 0, q = 0; x < dw; x++, q += 4) {
      const A = acc[q + 3];
      if (opaque) { out[base + q] = acc[q]; out[base + q + 1] = acc[q + 1]; out[base + q + 2] = acc[q + 2]; out[base + q + 3] = 255; continue; }
      // Near-zero alpha: dividing by it would amplify noise into random colours; the pixel becomes fully transparent.
      // Lanczos lobes can push values below 0 / above 255: Uint8ClampedArray clamps (and rounds) on store.
      if (A <= 0.5) { out[base + q + 3] = 0; continue; }
      out[base + q] = acc[q] / A; out[base + q + 1] = acc[q + 1] / A; out[base + q + 2] = acc[q + 2] / A; out[base + q + 3] = A;
    }
  }
  return { width: dw, height: dh, data: out };
}
