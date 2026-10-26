// image-processor/pipeline.js - the processing pipeline of one image: settings model, geometry (EXIF
// auto-orient, 90° rotation, flips, straighten, crop), resize, colour adjustments, filters, watermark, and output
// encoding (own PNG / JPEG / ICO encoders, WebP through the browser canvas). Background removal (cutout) is the
// magic wand of raster/wand.js run from the image's corners or edges. Canvas-dependent steps come from `env`
// (canvas.js), so the module itself has no DOM dependency.

import { encodeJPEG } from '../jpg/encode.js';
import { trimExif } from '../jpg/exif.js';
import { encodePNG } from '../png/encode.js';
import { ICO_MIME, encodeICO } from '../ico/ico.js';
import { adjustColors, blur, composite, cropImage, flip, isNeutral, orient, resizeTarget, resolveCrop, rotate90, sharpen, straighten, straightenScale, vignette } from '../raster/ops.js';
import { resize } from '../raster/resample.js';
import { removeBackground } from '../raster/wand.js';

// Defaults are conservative: no visible change until the user asks (format "original", strip metadata ON for privacy,
// keep the ICC profile so colours do not shift, JPEG quality 85 / 4:2:0 = the usual web trade-off).
export const DEFAULTS = {
  orient: { auto: true, rotate: 0, flipH: false, flipV: false, angle: 0 },
  crop: { aspect: 'free', rect: null },
  resize: { mode: 'none', width: 1920, height: 1080, percent: 50, filter: 'lanczos3', enlarge: false },
  cutout: { enabled: false, tolerance: 40, seeds: 'corners', metric: 'perceptual', soft: 50, grow: 0, feather: 0, decontaminate: true },
  adjust: { brightness: 0, contrast: 0, saturation: 0, hue: 0, gamma: 1, temperature: 0 },
  filters: { grayscale: false, sepia: false, invert: false, blur: 0, sharpen: 0, sharpenRadius: 1, vignette: 0 },
  watermark: { text: '', position: 'br', size: 5, opacity: 70, color: '#ffffff', shadow: true },
  output: { format: 'original', quality: 85, subsampling: '4:2:0', progressive: false, pngColors: 0, dither: true, effort: 'balanced', background: '#ffffff', strip: true, keepIcc: true, suffix: '', icoSizes: [16, 32, 48, 256] },
};

const clone = (o) => JSON.parse(JSON.stringify(o));
const num = (v, lo, hi, d) => { const n = +v; return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const pick = (v, list, d) => (list.includes(v) ? v : d);

/** Complete, clamped settings (unknown keys dropped; missing ones from DEFAULTS). */
// Every field clamped or whitelisted: settings come from localStorage and from per-image overrides, and the pipeline
// must never receive NaN sizes or an unknown enum. The suffix loses characters illegal in file names on Windows.
export function normalizeSettings(s = {}) {
  const d = clone(DEFAULTS);
  const o = s.orient || {}, c = s.crop || {}, cu = s.cutout || {}, r = s.resize || {}, a = s.adjust || {}, f = s.filters || {}, w = s.watermark || {}, out = s.output || {};
  d.orient = { auto: o.auto !== false, rotate: [0, 90, 180, 270].includes(((o.rotate % 360) + 360) % 360) ? ((o.rotate % 360) + 360) % 360 : 0, flipH: !!o.flipH, flipV: !!o.flipV, angle: num(o.angle, -45, 45, 0) };
  const rect = c.rect && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(+c.rect[k])) ? { x: num(c.rect.x, 0, 1, 0), y: num(c.rect.y, 0, 1, 0), w: num(c.rect.w, 0.001, 1, 1), h: num(c.rect.h, 0.001, 1, 1) } : null;
  d.crop = { aspect: typeof c.aspect === 'string' ? c.aspect : 'free', rect };
  d.resize = { mode: pick(r.mode, ['none', 'fit', 'fill', 'exact', 'percent'], 'none'), width: num(r.width, 0, 30000, 1920) | 0, height: num(r.height, 0, 30000, 1080) | 0, percent: num(r.percent, 1, 400, 50), filter: pick(r.filter, ['lanczos3', 'area', 'bilinear'], 'lanczos3'), enlarge: !!r.enlarge };
  d.cutout = { enabled: !!cu.enabled, tolerance: num(cu.tolerance, 0, 255, 40) | 0, seeds: pick(cu.seeds, ['corners', 'edges'], 'corners'), metric: pick(cu.metric, ['max', 'rgba', 'perceptual'], 'perceptual'), soft: num(cu.soft, 0, 100, 50), grow: num(cu.grow, -20, 20, 0) | 0, feather: num(cu.feather, 0, 20, 0) | 0, decontaminate: cu.decontaminate !== false };
  d.adjust = { brightness: num(a.brightness, -100, 100, 0), contrast: num(a.contrast, -100, 100, 0), saturation: num(a.saturation, -100, 100, 0), hue: num(a.hue, -180, 180, 0), gamma: num(a.gamma, 0.1, 5, 1), temperature: num(a.temperature, -100, 100, 0) };
  d.filters = { grayscale: !!f.grayscale, sepia: !!f.sepia, invert: !!f.invert, blur: num(f.blur, 0, 50, 0), sharpen: num(f.sharpen, 0, 500, 0), sharpenRadius: num(f.sharpenRadius, 0.3, 10, 1), vignette: num(f.vignette, 0, 100, 0) };
  d.watermark = { text: String(w.text || '').slice(0, 200), position: pick(w.position, ['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br', 'tile'], 'br'), size: num(w.size, 1, 40, 5), opacity: num(w.opacity, 0, 100, 70), color: /^#[0-9a-f]{6}$/i.test(w.color) ? w.color : '#ffffff', shadow: w.shadow !== false };
  d.output = {
    format: pick(out.format, ['original', 'jpeg', 'png', 'webp', 'ico'], 'original'), quality: num(out.quality, 1, 100, 85) | 0,
    subsampling: pick(out.subsampling, ['4:2:0', '4:2:2', '4:4:4'], '4:2:0'), progressive: !!out.progressive, pngColors: [0, 2, 4, 8, 16, 32, 64, 128, 256].includes(+out.pngColors) ? +out.pngColors : 0,
    dither: out.dither !== false, effort: pick(out.effort, ['fast', 'balanced', 'max'], 'balanced'), background: /^#[0-9a-f]{6}$/i.test(out.background) ? out.background : '#ffffff',
    strip: out.strip !== false, keepIcc: out.keepIcc !== false, suffix: String(out.suffix || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').slice(0, 40),
    icoSizes: Array.isArray(out.icoSizes) && out.icoSizes.some((n) => ICO_SIZES.includes(+n)) ? [...new Set(out.icoSizes.map(Number).filter((n) => ICO_SIZES.includes(n)))].sort((a, b) => a - b) : [16, 32, 48, 256],
  };
  return d;
}

export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

export const hexRGB = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** Geometry before the crop: EXIF orientation (when `auto`), 90° rotation, flips, straightening. */
// Order matters: EXIF orientation first (makes the image upright as the camera saw it), then the user's rotation
// and flips (relative to upright), then straightening, which crops to the largest inner rectangle.
export function geometry(img, s, orientation = 1) {
  let g = s.orient.auto ? orient(img, orientation) : img;
  g = rotate90(g, s.orient.rotate);
  g = flip(g, s.orient.flipH, s.orient.flipV);
  return straighten(g, s.orient.angle);
}

/** Output pixel size for a source of w x h (cheap: no pixel work), for the stats line. */
// Mirrors processImage arithmetically (no pixels) for the live "W x H" stats; EXIF orientations 5..8 transpose.
export function outputSize(w, h, s, orientation = 1) {
  if (s.orient.auto && orientation >= 5) [w, h] = [h, w];
  if (s.orient.rotate % 180) [w, h] = [h, w];
  if (s.orient.angle) { const k = straightenScale(w, h, s.orient.angle); w = Math.max(1, Math.floor(w * k)); h = Math.max(1, Math.floor(h * k)); }
  const c = resolveCrop(w, h, s.crop);
  const t = resizeTarget(c.w, c.h, s.resize);
  if (!t) return { width: c.w, height: c.h };
  return t.cropTo ? { width: t.cropTo.w, height: t.cropTo.h } : { width: t.width, height: t.height };
}

/**
 * Runs the pixel pipeline. Returns { image, before, base, crop } where `base` is the geometry stage before the crop
 * (when opts.base) and `before` the cropped / resized pixels before colour work (when opts.before), both passed
 * through opts.preview (e.g. a downscaler) when given. opts.step(name) is called between stages.
 */
// Stage order: geometry -> crop -> resize -> cutout -> colour/filters -> watermark. Resizing before colour work makes
// every later stage cheaper on downscales; the watermark comes last so it is never blurred, recoloured or cut out.
// Stages may return their input unchanged, so the decoded source is copied before the first in-place stage: the
// cached source must stay pristine for the next preview.
export async function processImage(src, s, { orientation = 1, before = false, base = false, preview = (x) => x, env = {}, step = async () => {} } = {}) {
  const out = {};
  let img = geometry(src, s, orientation);
  const copy = (x) => ({ width: x.width, height: x.height, data: new Uint8ClampedArray(x.data) });
  const snap = (x) => { const p = preview(x); return p === x ? copy(x) : p; };
  if (base) out.base = snap(img);
  out.geometry = { width: img.width, height: img.height };
  out.crop = resolveCrop(img.width, img.height, s.crop);
  img = cropImage(img, out.crop);
  await step('resize');
  const t = resizeTarget(img.width, img.height, s.resize);
  if (t) {
    img = resize(img, t.width, t.height, s.resize.filter);
    if (t.cropTo && (t.cropTo.w < img.width || t.cropTo.h < img.height)) {
      img = cropImage(img, { x: Math.floor((img.width - t.cropTo.w) / 2), y: Math.floor((img.height - t.cropTo.h) / 2), w: t.cropTo.w, h: t.cropTo.h });
    }
  }
  if (before) out.before = snap(img);
  // Work on a private copy from here on (earlier stages may return the decoded source itself).
  if (img === src) img = copy(src);
  if (s.cutout.enabled) {
    await step('cutout');
    const cu = s.cutout;
    removeBackground(img, { tolerance: cu.tolerance, seeds: cu.seeds, metric: cu.metric, soft: cu.soft / 100, grow: cu.grow, feather: cu.feather, decontaminate: cu.decontaminate });
  }
  await step('adjust');
  if (!isNeutral(s.adjust, s.filters)) {
    adjustColors(img, s.adjust, s.filters);
    if (s.filters.blur > 0) { await step('blur'); img = blur(img, s.filters.blur); }
    if (s.filters.sharpen > 0) { await step('sharpen'); sharpen(img, s.filters.sharpen / 100, s.filters.sharpenRadius); }
    if (s.filters.vignette > 0) vignette(img, s.filters.vignette / 100);
  }
  const wm = s.watermark;
  if (wm.text.trim()) {
    if (env.watermarkLayer) {
      const L = env.watermarkLayer(img.width, img.height, wm);
      if (L) composite(img, L.layer, L.x, L.y, wm.opacity / 100);
    } else out.warning = 'noWatermark';
  }
  out.image = img;
  return out;
}

const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp', ico: 'ico' };
export const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', ico: ICO_MIME };

/** Output format for a source kind ('original' keeps PNG / JPEG / WebP / ICO, everything else becomes PNG). */
// "original" keeps formats this app can write; GIF/BMP/TIFF/AVIF/HEIC inputs become PNG (lossless, keeps alpha).
export function outputFormat(s, kind) {
  const f = s.output.format;
  if (f !== 'original') return f;
  return kind === 'jpeg' || kind === 'webp' || kind === 'ico' ? kind : 'png';
}

/**
 * Encodes the processed pixels. meta: { kind, exif (TIFF bytes), icc, text: [{ keyword, text }], orientation }.
 * Returns { bytes, format, mime, ext, warning? }.
 */
// Metadata policy: strip removes EXIF and text chunks (GPS!); ICC is controlled separately because dropping it changes
// colours on wide-gamut images. When pixels were turned upright, EXIF Orientation is reset to 1, otherwise viewers
// would rotate the already-rotated pixels again. WebP falls back to PNG with a warning where the browser cannot
// encode it.
export async function encodeImage(img, s, meta = {}, env = {}) {
  let format = outputFormat(s, meta.kind);
  const o = s.output;
  const keepMeta = !o.strip;
  // EXIF travels with "keep metadata"; the orientation is reset when the pixels were turned upright.
  let exif = null;
  if (keepMeta && meta.exif) exif = trimExif(meta.exif, { orientation: s.orient.auto || meta.orientation === 1 ? 1 : null });
  const icc = o.keepIcc && meta.icc && meta.icc.length ? meta.icc : null;
  let warning;
  if (format === 'webp') {
    const bytes = env.encodeWebP ? await env.encodeWebP(img, o.quality / 100) : null;
    if (bytes) return { bytes, format, mime: MIME.webp, ext: EXT.webp };
    warning = 'noWebP';
    format = 'png';
  }
  if (format === 'ico') return { bytes: encodeICO(icoImages(img, o.icoSizes)), format, mime: MIME.ico, ext: EXT.ico, warning };
  if (format === 'jpeg') {
    const bytes = encodeJPEG(img, {
      quality: o.quality, subsampling: o.subsampling, progressive: o.progressive, background: hexRGB(o.background),
      exif: exif || undefined, icc: icc || undefined,
    });
    return { bytes, format, mime: MIME.jpeg, ext: EXT.jpeg, warning };
  }
  // Deflate level by effort (2 / 6 / 9): 6 is zlib's default balance; 9 gains a few percent at several times the time.
  const level = o.effort === 'fast' ? 2 : o.effort === 'max' ? 9 : 6;
  const text = keepMeta && Array.isArray(meta.text) ? meta.text.map((e) => ({ keyword: e.keyword, text: e.text, compress: e.text.length > 1024 })) : [];
  const chunks = exif ? [{ type: 'eXIf', data: exif, after: 'PLTE' }] : [];
  const bytes = encodePNG(img, {
    level, colors: o.pngColors, dither: o.dither ? 0.85 : 0, text, chunks,
    iccp: icc ? { name: 'ICC profile', profile: icc } : undefined,
  });
  return { bytes, format: 'png', mime: MIME.png, ext: EXT.png, warning };
}

/**
 * The icon sizes of an image: each one the image fitted into a transparent square (Lanczos when shrinking, nearest
 * neighbour when enlarging by a whole factor, so pixel art stays crisp), centred.
 */
export function icoImages(img, sizes = [16, 32, 48, 256]) {
  return sizes.map((n) => {
    const k = Math.min(n / img.width, n / img.height);
    const w = Math.max(1, Math.round(img.width * k)), hh = Math.max(1, Math.round(img.height * k));
    const r = w === img.width && hh === img.height ? img : k >= 1 && Number.isInteger(k) ? nearest(img, w, hh) : resize(img, w, hh, 'lanczos3');
    const out = { width: n, height: n, data: new Uint8ClampedArray(n * n * 4) };
    const ox = (n - w) >> 1, oy = (n - hh) >> 1;
    for (let y = 0; y < hh; y++) out.data.set(r.data.subarray(y * w * 4, (y + 1) * w * 4), ((oy + y) * n + ox) * 4);
    return out;
  });
}

function nearest(img, w, h) {
  const out = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (Math.floor((y * img.height) / h) * img.width + Math.floor((x * img.width) / w)) * 4;
      out.data.set(img.data.subarray(s, s + 4), (y * w + x) * 4);
    }
  }
  return out;
}

/** Output file name: base name + suffix + extension. */
// Strips one extension (1-5 alphanumerics) and appends suffix + new extension; "photo.jpeg" -> "photo-web.webp".
export function outputName(name, s, ext) {
  const base = String(name || 'image').replace(/\.[a-z0-9]{1,5}$/i, '') || 'image';
  return `${base}${s.output.suffix || ''}.${ext}`;
}
