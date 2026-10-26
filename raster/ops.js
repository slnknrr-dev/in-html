// raster/ops.js - pixel operations on RGBA images { width, height, data: Uint8ClampedArray }:
// geometry (EXIF orientation, 90° rotations, flips, straightening with auto-crop, crop rectangles), tone and colour
// adjustments folded into per-channel lookup tables + one affine colour matrix, filters (gaussian blur with
// ImageMagick's kernel, box approximation for wide kernels, unsharp mask, vignette) and "over" compositing of a
// watermark layer. Pure (no DOM), usable in workers and Node. raster/magick.js describes these operations as
// ImageMagick arguments.

//
// Conventions: operations either return a new image or mutate in place, as each doc comment states; no-op settings
// return the input object itself (callers must not assume a copy). Uint32Array views move whole RGBA pixels in one
// store for rotations and flips; they require data.byteOffset to be a multiple of 4 (true for canvas ImageData and
// for every image made here).
const make = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });

// --- geometry ---------------------------------------------------------------------------------------------

/** Clockwise rotation by 0 / 90 / 180 / 270 degrees. */
export function rotate90(img, deg) {
  const d = ((deg % 360) + 360) % 360;
  if (!d) return img;
  const { width: w, height: h, data: s } = img;
  const out = d === 180 ? make(w, h) : make(h, w);
  const o32 = new Uint32Array(out.data.buffer), s32 = new Uint32Array(s.buffer, s.byteOffset, w * h);
  if (d === 180) { for (let i = 0, n = w * h; i < n; i++) o32[n - 1 - i] = s32[i]; return out; }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // 90: (x, y) -> (h - 1 - y, x); 270: (x, y) -> (y, w - 1 - x)
      const nx = d === 90 ? h - 1 - y : y, ny = d === 90 ? x : w - 1 - x;
      o32[ny * h + nx] = s32[y * w + x];
    }
  }
  return out;
}

export function flip(img, horizontal, vertical) {
  if (!horizontal && !vertical) return img;
  const { width: w, height: h, data: s } = img;
  const out = make(w, h);
  const o32 = new Uint32Array(out.data.buffer), s32 = new Uint32Array(s.buffer, s.byteOffset, w * h);
  for (let y = 0; y < h; y++) {
    const sy = vertical ? h - 1 - y : y;
    for (let x = 0; x < w; x++) o32[y * w + x] = s32[sy * w + (horizontal ? w - 1 - x : x)];
  }
  return out;
}

// EXIF orientation 1..8 -> upright pixels (rotate clockwise, then mirror; see jpg/exif.js ORIENTATIONS).
const ORIENT = { 2: [0, true], 3: [180, false], 4: [180, true], 5: [90, true], 6: [90, false], 7: [270, true], 8: [270, false] };
export function orient(img, o) {
  const t = ORIENT[o];
  return t ? flip(rotate90(img, t[0]), t[1], false) : img;
}

/** Scale (<= 1) of the largest centered rectangle with the image's aspect that fits inside it rotated by `deg`. */
// The rotated image's bounding box is (w cos + h sin) x (w sin + h cos); scaling by the smaller ratio leaves no
// transparent corners while keeping the aspect ratio (what photo editors' "straighten" does).
export function straightenScale(w, h, deg) {
  const t = (Math.abs(deg) * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return Math.min(w / (w * c + h * s), h / (w * s + h * c));
}

/** Rotation by a small angle (degrees, clockwise) with bilinear sampling, cropped to the inscribed rectangle. */
export function straighten(img, deg) {
  if (!deg) return img;
  const { width: w, height: h, data: s } = img;
  const k = straightenScale(w, h, deg);
  const ow = Math.max(1, Math.floor(w * k)), oh = Math.max(1, Math.floor(h * k));
  const out = make(ow, oh);
  const t = (deg * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t);
  const cx = w / 2, cy = h / 2, ocx = ow / 2, ocy = oh / 2;
  const d = out.data;
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      // inverse rotation of the output pixel centre into the source
      const dx = x + 0.5 - ocx, dy = y + 0.5 - ocy;
      const sx = c * dx + sn * dy + cx - 0.5, sy = -sn * dx + c * dy + cy - 0.5;
      const x0 = Math.max(0, Math.min(w - 1, Math.floor(sx))), y0 = Math.max(0, Math.min(h - 1, Math.floor(sy)));
      const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
      const fx = Math.max(0, Math.min(1, sx - x0)), fy = Math.max(0, Math.min(1, sy - y0));
      const p00 = (y0 * w + x0) * 4, p10 = (y0 * w + x1) * 4, p01 = (y1 * w + x0) * 4, p11 = (y1 * w + x1) * 4;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      const o = (y * ow + x) * 4;
      for (let ch = 0; ch < 4; ch++) d[o + ch] = s[p00 + ch] * w00 + s[p10 + ch] * w10 + s[p01 + ch] * w01 + s[p11 + ch] * w11;
    }
  }
  return out;
}

const ASPECTS = { '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4, '3:2': 3 / 2, '2:3': 2 / 3, '16:9': 16 / 9, '9:16': 9 / 16, '4:5': 4 / 5, '5:4': 5 / 4, '21:9': 21 / 9 };
export const ASPECT_KEYS = ['free', 'original', ...Object.keys(ASPECTS)];
export const aspectRatio = (key, w, h) => (key === 'original' ? w / h : ASPECTS[key] || null);

/**
 * Crop rectangle in pixels { x, y, w, h } for an image of w x h: `rect` is normalized (0..1); a fixed aspect keeps the
 * rectangle's centre and area; without a rectangle a fixed aspect takes the largest centered box.
 */
// Normalised crop coordinates survive a resize or a different preview size; pixels are resolved only at render time.
export function resolveCrop(W, H, crop) {
  const a = crop ? aspectRatio(crop.aspect, W, H) : null;
  let x = 0, y = 0, w = W, h = H;
  const r = crop && crop.rect;
  if (r) { x = r.x * W; y = r.y * H; w = r.w * W; h = r.h * H; }
  if (a) {
    if (r) {
      const area = w * h, cx = x + w / 2, cy = y + h / 2;
      w = Math.sqrt(area * a); h = w / a;
      const k = Math.min(1, W / w, H / h);
      w *= k; h *= k;
      x = cx - w / 2; y = cy - h / 2;
    } else {
      if (W / H > a) { h = H; w = H * a; } else { w = W; h = W / a; }
      x = (W - w) / 2; y = (H - h) / 2;
    }
  }
  w = Math.max(1, Math.min(W, Math.round(w))); h = Math.max(1, Math.min(H, Math.round(h)));
  x = Math.max(0, Math.min(W - w, Math.round(x))); y = Math.max(0, Math.min(H - h, Math.round(y)));
  return { x, y, w, h };
}

export function cropImage(img, { x, y, w, h }) {
  if (x === 0 && y === 0 && w === img.width && h === img.height) return img;
  const out = make(w, h);
  for (let r = 0; r < h; r++) out.data.set(img.data.subarray(((y + r) * img.width + x) * 4, ((y + r) * img.width + x + w) * 4), r * w * 4);
  return out;
}

/** Target size for a resize setting { mode, width, height, percent, enlarge } of a w x h image (null: no resize). */
export function resizeTarget(w, h, rs) {
  if (!rs || rs.mode === 'none') return null;
  const W = Math.max(0, Math.round(+rs.width || 0)), H = Math.max(0, Math.round(+rs.height || 0));
  let kx, ky, cropTo = null;
  if (rs.mode === 'percent') kx = ky = Math.max(1, +rs.percent || 100) / 100;
  else if (rs.mode === 'fit') {
    if (!W && !H) return null;
    kx = ky = Math.min(W ? W / w : Infinity, H ? H / h : Infinity);
  } else if (rs.mode === 'fill') {
    if (!W || !H) return null;
    kx = ky = Math.max(W / w, H / h);
    cropTo = { w: W, h: H };
  } else if (rs.mode === 'exact') { kx = W ? W / w : 1; ky = H ? H / h : 1; }
  else return null;
  // Without enlarging, the scale is capped at 1; "fill" then crops the largest box of the target aspect.
  if (!rs.enlarge && rs.mode !== 'exact' && kx > 1) {
    kx = ky = 1;
    if (cropTo) { const f = Math.min(1, w / W, h / H); cropTo = { w: Math.max(1, Math.round(W * f)), h: Math.max(1, Math.round(H * f)) }; }
  }
  const tw = Math.max(1, Math.round(w * kx)), th = Math.max(1, Math.round(h * ky));
  if (cropTo) cropTo = { w: Math.min(tw, cropTo.w), h: Math.min(th, cropTo.h) };
  if (tw === w && th === h && !cropTo) return null;
  return { width: tw, height: th, cropTo };
}

// --- tone and colour ------------------------------------------------------------------------------------

// Colour pipeline: per-channel LUTs (brightness, contrast, gamma, temperature: functions of one channel) then one
// 3x4 matrix (saturation, hue, grayscale, sepia, invert: mixes channels). Composing all matrices first means one
// matrix multiply per pixel whatever the number of settings; LUTs make the non-linear part O(1) per channel.
const ID = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]; // 3x4 affine colour matrix (row-major, last column = offset)
const mul = (A, B) => { // A * B (affine 3x4)
  const r = new Array(12);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 4; j++) {
      r[i * 4 + j] = A[i * 4] * B[j] + A[i * 4 + 1] * B[4 + j] + A[i * 4 + 2] * B[8 + j] + (j === 3 ? A[i * 4 + 3] : 0);
    }
  }
  return r;
};
const LR = 0.2126, LG = 0.7152, LB = 0.0722;

/** Whether the adjust / filter settings change pixels at all. */
export function isNeutral(adj = {}, fl = {}) {
  return !adj.brightness && !adj.contrast && !adj.saturation && !adj.hue && (adj.gamma == null || adj.gamma === 1) && !adj.temperature &&
    !fl.grayscale && !fl.sepia && !fl.invert && !fl.blur && !fl.sharpen && !fl.vignette;
}

/**
 * Applies tone / colour adjustments and colour filters in place:
 *   adj { brightness, contrast, saturation, temperature: -100..100, hue: -180..180, gamma: 0.1..5 }
 *   fl  { grayscale, sepia, invert }
 */
// Contrast uses the common correction factor f = 259 (C + 255) / (255 (259 - C)), pivoting on mid-grey 128, with c
// clamped to +-0.99 so f stays finite. Saturation / hue use the luminance-preserving matrices of the CSS filter
// spec (Rec. 709 weights), so results match the browser preview of the same filter.
export function adjustColors(img, adj = {}, fl = {}) {
  const b = (adj.brightness || 0) / 100, c = Math.max(-0.99, Math.min(0.99, (adj.contrast || 0) / 100));
  const g = adj.gamma > 0 ? adj.gamma : 1, t = (adj.temperature || 0) / 100;
  const C = c * 255, cf = (259 * (C + 255)) / (255 * (259 - C));
  const mults = [1 + 0.18 * t, 1 + 0.03 * t, 1 - 0.18 * t];
  const luts = mults.map((m) => {
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      let x = v * m + b * 128;
      x = (x - 128) * cf + 128;
      x = x <= 0 ? 0 : 255 * Math.pow(Math.min(1, x / 255), 1 / g) + Math.max(0, x - 255);
      lut[v] = x;
    }
    return lut;
  });
  // Colour matrix: saturation, hue rotation (CSS filter matrices), grayscale, sepia, invert.
  let M = ID;
  const s = 1 + (adj.saturation || 0) / 100;
  if (s !== 1) M = mul([LR + (1 - LR) * s, LG - LG * s, LB - LB * s, 0, LR - LR * s, LG + (1 - LG) * s, LB - LB * s, 0, LR - LR * s, LG - LG * s, LB + (1 - LB) * s, 0], M);
  if (adj.hue) {
    const a = (adj.hue * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
    M = mul([
      0.213 + co * 0.787 - si * 0.213, 0.715 - co * 0.715 - si * 0.715, 0.072 - co * 0.072 + si * 0.928, 0,
      0.213 - co * 0.213 + si * 0.143, 0.715 + co * 0.285 + si * 0.14, 0.072 - co * 0.072 - si * 0.283, 0,
      0.213 - co * 0.213 - si * 0.787, 0.715 - co * 0.715 + si * 0.715, 0.072 + co * 0.928 + si * 0.072, 0,
    ], M);
  }
  if (fl.grayscale) M = mul([LR, LG, LB, 0, LR, LG, LB, 0, LR, LG, LB, 0], M);
  if (fl.sepia) M = mul([0.393, 0.769, 0.189, 0, 0.349, 0.686, 0.168, 0, 0.272, 0.534, 0.131, 0], M);
  if (fl.invert) M = mul([-1, 0, 0, 255, 0, -1, 0, 255, 0, 0, -1, 255], M);
  const identityM = M.every((v, i) => Math.abs(v - ID[i]) < 1e-9);
  const identityL = luts.every((l) => l.every((v, i) => v === i));
  if (identityM && identityL) return img;
  const d = img.data, [lr, lg, lb] = luts;
  for (let p = 0; p < d.length; p += 4) {
    const r = lr[d[p]], gg = lg[d[p + 1]], bb = lb[d[p + 2]];
    if (identityM) { d[p] = r; d[p + 1] = gg; d[p + 2] = bb; continue; }
    d[p] = M[0] * r + M[1] * gg + M[2] * bb + M[3];
    d[p + 1] = M[4] * r + M[5] * gg + M[6] * bb + M[7];
    d[p + 2] = M[8] * r + M[9] * gg + M[10] * bb + M[11];
  }
  return img;
}

// --- blur / sharpen / vignette --------------------------------------------------------------------------

/**
 * Normalized 1-D gaussian kernel of sigma with ImageMagick's width rule (GetOptimalKernelWidth1D, Q16: the widest odd
 * width whose edge weight still exceeds 1/65535). rank 1 samples the curve at the pixel centres (`-gaussian-blur`);
 * rank 3 integrates three sub-samples per tap, as ImageMagick's "blur" kernel (`-blur`, `-unsharp`).
 */
export function gaussianKernel(sigma, rank = 1) {
  const s = Math.abs(+sigma || 0);
  if (s < 1e-6) return Float32Array.of(1);
  let alpha = 1 / (2 * s * s);
  const beta = 1 / (Math.sqrt(2 * Math.PI) * s);
  let width = 5;
  for (; width < 4097; width += 2) {
    const j = (width - 1) / 2;
    let norm = 0;
    for (let i = -j; i <= j; i++) norm += Math.exp(-i * i * alpha) * beta;
    if ((Math.exp(-j * j * alpha) * beta) / norm < 1 / 65535) break;
  }
  width -= 2;
  const k = new Float32Array(width);
  const v = (width * rank - 1) >> 1;
  alpha = 1 / (2 * (s * rank) ** 2);
  for (let u = -v; u <= v; u++) k[Math.floor((u + v) / rank)] += Math.exp(-u * u * alpha);
  let sum = 0;
  for (let i = 0; i < width; i++) sum += k[i];
  for (let i = 0; i < width; i++) k[i] /= sum;
  return k;
}

// Up to this many taps blur() convolves with the true kernel; wider kernels use three box passes (fast, approximate).
// 31 taps = sigma about 3.7: beyond that a true separable convolution costs 2 * taps per pixel, while three box
// passes cost a constant 6 (running sums), with a visually negligible difference at large radii.
export const GAUSS_MAX_TAPS = 31;
/** Whether blur(img, sigma) is the true gaussian (pixel-identical to ImageMagick's -blur up to rounding). */
export const blurIsExact = (sigma) => !(sigma > 0.2) || gaussianKernel(sigma).length <= GAUSS_MAX_TAPS;

// One separable pass of a symmetric kernel over premultiplied float planes (edge pixels repeat, as ImageMagick's
// default virtual pixels), along rows (horizontal) or columns.
// Each line is copied into a padded buffer first: edge clamping then costs nothing inside the tap loop, and the
// kernel's symmetry halves the multiplies (buf[a] + buf[b]) * k.
function convolvePass(src, dst, w, h, k, horizontal) {
  const r = (k.length - 1) >> 1, len = horizontal ? w : h, lines = horizontal ? h : w;
  const step = horizontal ? 4 : w * 4, lineStep = horizontal ? w * 4 : 4;
  const buf = new Float32Array((len + 2 * r) * 4);
  for (let l = 0; l < lines; l++) {
    const base = l * lineStep;
    for (let i = -r; i < len + r; i++) {
      const s = base + Math.max(0, Math.min(len - 1, i)) * step, q = (i + r) * 4;
      buf[q] = src[s]; buf[q + 1] = src[s + 1]; buf[q + 2] = src[s + 2]; buf[q + 3] = src[s + 3];
    }
    for (let i = 0; i < len; i++) {
      const c = (i + r) * 4;
      const k0 = k[r];
      let R = buf[c] * k0, G = buf[c + 1] * k0, B = buf[c + 2] * k0, A = buf[c + 3] * k0;
      for (let t = 1; t <= r; t++) {
        const kt = k[r + t], a = c - t * 4, b = c + t * 4;
        R += (buf[a] + buf[b]) * kt; G += (buf[a + 1] + buf[b + 1]) * kt; B += (buf[a + 2] + buf[b + 2]) * kt; A += (buf[a + 3] + buf[b + 3]) * kt;
      }
      const o = base + i * step;
      dst[o] = R; dst[o + 1] = G; dst[o + 2] = B; dst[o + 3] = A;
    }
  }
}

const premultiplied = (data) => {
  const a = new Float32Array(data.length);
  for (let p = 0; p < data.length; p += 4) { const al = data[p + 3] / 255; a[p] = data[p] * al; a[p + 1] = data[p + 1] * al; a[p + 2] = data[p + 2] * al; a[p + 3] = data[p + 3]; }
  return a;
};
const unpremultiplied = (a, w, h) => {
  const out = new Uint8ClampedArray(a.length);
  for (let p = 0; p < out.length; p += 4) {
    const al = a[p + 3];
    if (al <= 0.01) continue;
    const k = 255 / al;
    out[p] = a[p] * k; out[p + 1] = a[p + 1] * k; out[p + 2] = a[p + 2] * k; out[p + 3] = al;
  }
  return { width: w, height: h, data: out };
};

/**
 * True gaussian blur (separable, premultiplied alpha, ImageMagick's kernel width); returns a new image. rank 3 (the
 * default) is ImageMagick's -blur kernel, rank 1 its -gaussian-blur kernel.
 */
export function gaussianBlur(img, sigma, rank = 3) {
  const { width: w, height: h, data } = img;
  if (gaussianKernel(sigma, rank).length === 1) return { width: w, height: h, data: new Uint8ClampedArray(data) };
  return unpremultiplied(blurPlanes(img, sigma, rank), w, h);
}

// The gaussian blur as premultiplied float values (not rounded).
function blurPlanes(img, sigma, rank = 3) {
  const { width: w, height: h, data } = img;
  const k = gaussianKernel(sigma, rank);
  const a = premultiplied(data);
  if (k.length === 1) return a;
  const b = new Float32Array(data.length);
  convolvePass(a, b, w, h, k, true);
  convolvePass(b, a, w, h, k, false);
  return a;
}

// Box sizes of three successive box blurs that approximate a gaussian of sigma (Kovesi / Kutskir).
function boxSizes(sigma) {
  const n = 3, wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2, mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  return Array.from({ length: n }, (_, i) => (i < m ? wl : wu));
}

// One box blur pass of radius r along rows (horizontal) or columns, premultiplied channels in Float32 planes.
// Running sum: add the entering pixel, subtract the leaving one, so the cost is independent of r.
function boxPass(src, dst, w, h, r, horizontal) {
  const len = horizontal ? w : h, lines = horizontal ? h : w;
  const step = horizontal ? 4 : w * 4, lineStep = horizontal ? w * 4 : 4;
  const inv = 1 / (r + r + 1);
  for (let l = 0; l < lines; l++) {
    const base = l * lineStep;
    for (let ch = 0; ch < 4; ch++) {
      const at = (i) => src[base + Math.max(0, Math.min(len - 1, i)) * step + ch];
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += at(i);
      for (let i = 0; i < len; i++) {
        dst[base + i * step + ch] = acc * inv;
        acc += at(i + r + 1) - at(i - r);
      }
    }
  }
}

/** Three box passes per axis (fast gaussian approximation, any sigma) on premultiplied alpha; returns a new image. */
export function boxBlur(img, sigma) {
  const { width: w, height: h, data } = img;
  const a = premultiplied(data), b = new Float32Array(data.length);
  for (const size of boxSizes(sigma)) {
    const r = (size - 1) >> 1;
    if (r < 1) continue;
    boxPass(a, b, w, h, r, true);
    boxPass(b, a, w, h, r, false);
  }
  return unpremultiplied(a, w, h);
}

/**
 * Gaussian blur of sigma on premultiplied alpha; returns a new image. Kernels up to GAUSS_MAX_TAPS wide (sigma up to
 * about 3.7) are convolved exactly, wider ones are approximated with three box passes (blurIsExact tells which).
 */
export function blur(img, sigma) {
  if (!(sigma > 0.2)) return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  return blurIsExact(sigma) ? gaussianBlur(img, sigma) : boxBlur(img, sigma);
}

/**
 * Unsharp mask in place: amount 0..5 (1 = 100 %), radius = blur sigma in pixels, threshold 0..1 (a channel changes
 * only where twice its difference from the blur reaches threshold * 255, as ImageMagick's -unsharp).
 */
export function sharpen(img, amount, radius = 1, threshold = 0) {
  if (!(amount > 0)) return img;
  const sigma = Math.max(0.3, radius);
  const d = img.data, th = Math.max(0, +threshold || 0) * 255;
  // the blur stays in floats (premultiplied) so the threshold test and the difference are not rounded twice
  const bl = blurIsExact(sigma) ? blurPlanes(img, sigma) : premultiplied(boxBlur(img, sigma).data);
  for (let p = 0; p < d.length; p += 4) {
    const al = bl[p + 3];
    if (al <= 0.01) continue;
    const k = 255 / al;
    for (let c = 0; c < 3; c++) {
      const diff = d[p + c] - bl[p + c] * k;
      if (th && Math.abs(2 * diff) < th) continue;
      d[p + c] = d[p + c] + diff * amount;
    }
  }
  return img;
}

/** Darkens the edges in place: amount 0..1. */
// Radius normalised per axis (an ellipse matching the frame), smoothstep falloff from 35 % of the half-diagonal
// to the corners: no visible ring, and the centre is untouched.
export function vignette(img, amount) {
  if (!(amount > 0)) return img;
  const { width: w, height: h, data: d } = img;
  const cx = w / 2, cy = h / 2;
  for (let y = 0; y < h; y++) {
    const ny = (y + 0.5 - cy) / cy;
    for (let x = 0; x < w; x++) {
      const nx = (x + 0.5 - cx) / cx;
      const r = Math.sqrt(nx * nx + ny * ny) / Math.SQRT2; // 0 centre .. 1 corners
      const t = Math.max(0, Math.min(1, (r - 0.35) / 0.65));
      const f = 1 - amount * t * t * (3 - 2 * t);
      if (f >= 1) continue;
      const p = (y * w + x) * 4;
      d[p] *= f; d[p + 1] *= f; d[p + 2] *= f;
    }
  }
  return img;
}

/** "Over" compositing of an RGBA layer (straight alpha) at (x, y), in place. */
// Porter-Duff "over" on straight alpha: out_a = a + da (1 - a), colour normalised by out_a. Clipped per pixel, so a
// watermark partly outside the image is fine.
export function composite(img, layer, x, y, opacity = 1) {
  const { width: W, height: H, data: d } = img;
  for (let r = 0; r < layer.height; r++) {
    const ty = y + r;
    if (ty < 0 || ty >= H) continue;
    for (let c = 0; c < layer.width; c++) {
      const tx = x + c;
      if (tx < 0 || tx >= W) continue;
      const s = (r * layer.width + c) * 4;
      const a = (layer.data[s + 3] / 255) * opacity;
      if (a <= 0) continue;
      const p = (ty * W + tx) * 4;
      const da = d[p + 3] / 255, oa = a + da * (1 - a);
      for (let ch = 0; ch < 3; ch++) d[p + ch] = (layer.data[s + ch] * a + d[p + ch] * da * (1 - a)) / oa;
      d[p + 3] = oa * 255;
    }
  }
  return img;
}

/** Copy of the image flattened onto an opaque background colour [r, g, b]. */
export function flatten(img, bg) {
  const d = new Uint8ClampedArray(img.data);
  for (let p = 0; p < d.length; p += 4) {
    const a = d[p + 3];
    if (a === 255) continue;
    const f = a / 255, e = 1 - f;
    d[p] = d[p] * f + bg[0] * e; d[p + 1] = d[p + 1] * f + bg[1] * e; d[p + 2] = d[p + 2] * f + bg[2] * e; d[p + 3] = 255;
  }
  return { width: img.width, height: img.height, data: d };
}
