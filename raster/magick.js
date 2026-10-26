// raster/magick.js - the operations of ops.js and resample.js as ImageMagick 7 command-line arguments, each with a
// fidelity verdict that raster/test.js checks against the real `magick` (the strings are descriptions for the user,
// nothing runs them in the browser).
//
// Every builder returns a step, an array of steps, or null (nothing to do):
//   { id, args, fidelity, note?, sized? }
//   args      option groups, e.g. [['-crop', '100x60+30+20', '+repage']]; a group stays on one command line
//   fidelity  'exact'   the same algorithm: pixels differ by rounding only (at most 2 levels per channel)
//             'approx'  a similar operation: the result looks alike but pixels or sizes may differ
//             'none'    no ImageMagick equivalent (args are empty)
//   note      key of an explanation (approximation, version, speed), localized by the application
//   sized     the args contain pixel numbers of one image size; builders called without a size (null) return a
//             size-independent form for batch loops (fx percent escapes, aspect crops) instead
//
// Steps follow the order of the image processor's pipeline: auto-orient, rotate, flip, straighten, crop, resize,
// colour (temperature, brightness / contrast, gamma, colour matrix, invert), blur, sharpen, vignette.

//
// Why describe instead of run: the browser app does the work itself; these strings let a user reproduce the same
// edit in a batch script on a server. The fidelity verdict is a promise that raster/test.js enforces against real
// ImageMagick, so it cannot silently rot when either side changes. Each builder imports the JS geometry helpers
// (resolveCrop, resizeTarget, straightenScale) rather than re-deriving the math: one formula, two back ends.
import { blurIsExact, resolveCrop, resizeTarget, straightenScale } from './ops.js';

export const EXACT = 'exact', APPROX = 'approx', NONE = 'none';

/** Shortest decimal text of v with at most `digits` decimals ('-0' becomes '0'). */
// Double unary plus: toFixed returns a string with trailing zeros; converting back to a number and to text again
// strips them ("1.5000" -> "1.5") while keeping the rounding.
export function num(v, digits = 4) {
  const s = String(+(+v).toFixed(digits));
  return s === '-0' ? '0' : s;
}

// --- geometry -----------------------------------------------------------------------------------------------

export const orientStep = (auto) => (auto ? { id: 'autoOrient', args: [['-auto-orient']], fidelity: EXACT } : null);

export function rotateStep(deg) {
  const d = ((Math.round(deg) % 360) + 360) % 360;
  return d ? { id: 'rotate', args: [['-rotate', String(d)]], fidelity: EXACT } : null;
}

export function flipStep(horizontal, vertical) {
  if (!horizontal && !vertical) return null;
  return { id: 'flip', args: [horizontal ? ['-flop'] : null, vertical ? ['-flip'] : null].filter(Boolean), fidelity: EXACT };
}

/**
 * Straightening (ops.straighten: bilinear rotation about the centre, cropped to the inscribed rectangle of the same
 * aspect). With a size: an SRT distortion mapping the centres exactly into a viewport of the output size. Without:
 * a rotation and a centred fx crop (half-pixel centring may differ).
 */
// -filter point with -interpolate bilinear makes -distort sample exactly like ops.straighten (one bilinear lookup
// per output pixel); the default EWA resampling would blur slightly and break the 'exact' verdict.
export function straightenStep(deg, size) {
  if (!deg) return null;
  const sampling = ['-interpolate', 'bilinear', '-filter', 'point'];
  if (size) {
    const { w, h } = size;
    const k = straightenScale(w, h, deg);
    const ow = Math.max(1, Math.floor(w * k)), oh = Math.max(1, Math.floor(h * k));
    return {
      id: 'straighten', fidelity: EXACT, sized: true,
      args: [sampling, ['-define', `distort:viewport=${ow}x${oh}+0+0`], ['-distort', 'SRT', `${num(w / 2)},${num(h / 2)} 1 ${num(deg)} ${num(ow / 2)},${num(oh / 2)}`], ['+filter', '+repage']],
    };
  }
  const t = (Math.abs(deg) * Math.PI) / 180, c = num(Math.cos(t), 6), s = num(Math.sin(t), 6);
  const k = `min(w/(w*${c}+h*${s}),h/(w*${s}+h*${c}))`;
  return {
    id: 'straighten', fidelity: APPROX, note: 'straightenBatch',
    args: [sampling, ['-distort', 'SRT', num(deg), '+filter'], ['-gravity', 'center', '-crop', `%[fx:max(1,floor(w*${k}))]x%[fx:max(1,floor(h*${k}))]+0+0`, '+repage', '+gravity']],
  };
}

/** Crop ({ aspect, rect } as raster resolveCrop) of an image of `size`, or size-independent without a size. */
export function cropStep(crop, size) {
  if (!crop || (!crop.rect && (!crop.aspect || crop.aspect === 'free' || crop.aspect === 'original'))) return null;
  if (size) {
    const c = resolveCrop(size.w, size.h, crop);
    if (c.x === 0 && c.y === 0 && c.w === size.w && c.h === size.h) return null;
    return { id: 'crop', args: [['-crop', `${c.w}x${c.h}+${c.x}+${c.y}`, '+repage']], fidelity: EXACT, sized: true };
  }
  const r = crop.rect;
  if (!r) return { id: 'crop', args: [['-gravity', 'center', '-crop', crop.aspect, '+repage', '+gravity']], fidelity: EXACT };
  const W = `round(w*${num(r.w, 6)})`, H = `round(h*${num(r.h, 6)})`;
  const cw = `max(1,min(w,${W}))`, ch = `max(1,min(h,${H}))`;
  const fixed = crop.aspect && crop.aspect !== 'free';
  return {
    id: 'crop', fidelity: fixed ? APPROX : EXACT, note: fixed ? 'cropAspectBatch' : undefined,
    args: [['-crop', `%[fx:${cw}]x%[fx:${ch}]+%[fx:max(0,min(w-${cw},round(w*${num(r.x, 6)})))]+%[fx:max(0,min(h-${ch},round(h*${num(r.y, 6)})))]`, '+repage']],
  };
}

// --- resize ---------------------------------------------------------------------------------------------------

const FILTER = { lanczos3: 'Lanczos', bilinear: 'Triangle' };

// Resampling options of a filter for one geometry; `down`: true (shrinking), false (enlarging), null (unknown).
// Area averaging is exact box coverage: ImageMagick's -scale when shrinking; when enlarging it is a tent, -filter
// Triangle.
function resampling(filter, geometry, down) {
  if (filter === 'area') {
    if (down === true) return { args: [['-scale', geometry]], fidelity: EXACT };
    if (down === false) return { args: [['-filter', 'Triangle', '-resize', geometry]], fidelity: EXACT };
    return { args: [['-scale', geometry]], fidelity: APPROX, note: 'areaEnlarge' };
  }
  return { args: [['-filter', FILTER[filter] || 'Lanczos', '-resize', geometry]], fidelity: EXACT };
}

/**
 * Resize settings ({ mode: none | fit | fill | exact | percent, width, height, percent, filter, enlarge } as raster
 * resizeTarget) for an image of `size` (null: batch form). Geometry flags do the size logic: '>' shrinks only, '^'
 * covers, '!' forces both sides; %w / %h keep a side.
 */
export function resizeStep(rs, size) {
  if (!rs || rs.mode === 'none') return null;
  const W = Math.max(0, Math.round(+rs.width || 0)), H = Math.max(0, Math.round(+rs.height || 0));
  const f = rs.filter || 'lanczos3';
  let t = null;
  if (size) { t = resizeTarget(size.w, size.h, rs); if (!t) return null; }
  // direction of the scaling: known with a size, or implied by "never enlarge"
  const down = t ? (t.width < size.w && t.height < size.h ? true : t.width >= size.w && t.height >= size.h ? false : null) : null;
  const step = (geometry, more = [], dir = down) => {
    const r = resampling(f, geometry, dir);
    return { id: 'resize', args: [...r.args, ...more], fidelity: r.fidelity, note: r.note };
  };
  if (rs.mode === 'percent') {
    const p = Math.max(1, +rs.percent || 100);
    if (p === 100 || (p > 100 && !rs.enlarge)) return null;
    return step(`${num(p, 3)}%`, [], down ?? p < 100);
  }
  if (rs.mode === 'fit') {
    if (!W && !H) return null;
    return step(`${W || ''}${H ? 'x' + H : ''}${rs.enlarge ? '' : '>'}`, [], rs.enlarge ? down : true);
  }
  if (rs.mode === 'fill') {
    if (!W || !H) return null;
    // ^ covers the box; without enlarging, '>' leaves smaller images alone and the aspect crop takes the largest box
    // (a centred crop, not -extent, which would flatten transparency onto the background colour)
    if (rs.enlarge) return step(`${W}x${H}^`, [['-gravity', 'center', '-crop', `${W}x${H}+0+0`, '+repage', '+gravity']]);
    return step(`${W}x${H}^>`, [['-gravity', 'center', '-crop', `${W}:${H}`, '+repage', '+gravity']], down ?? true);
  }
  if (rs.mode === 'exact') {
    if (!W && !H) return null;
    return step(`${W || '%w'}x${H || '%h'}!`);
  }
  return null;
}

// --- tone and colour --------------------------------------------------------------------------------------------

const LR = 0.2126, LG = 0.7152, LB = 0.0722;
const mul3 = (A, B) => { const r = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r.push(A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]); return r; };
const ID3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const saturationMatrix = (s) => [LR + (1 - LR) * s, LG - LG * s, LB - LB * s, LR - LR * s, LG + (1 - LG) * s, LB - LB * s, LR - LR * s, LG - LG * s, LB + (1 - LB) * s];
function hueMatrix(deg) {
  const a = (deg * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
  return [
    0.213 + co * 0.787 - si * 0.213, 0.715 - co * 0.715 - si * 0.715, 0.072 - co * 0.072 + si * 0.928,
    0.213 - co * 0.213 + si * 0.143, 0.715 + co * 0.285 + si * 0.14, 0.072 - co * 0.072 - si * 0.283,
    0.213 - co * 0.213 - si * 0.787, 0.715 - co * 0.715 + si * 0.715, 0.072 + co * 0.928 + si * 0.072,
  ];
}
const GRAY = [LR, LG, LB, LR, LG, LB, LR, LG, LB];
const SEPIA = [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131];
export const matrixText = (M) => M.map((v) => num(v, 6)).join(' ');

/**
 * ImageMagick 7.1 -brightness-contrast BxC for a linear map v' = slope * v + offset (values 0..1):
 * v' = k * (v + B/100 - 0.5) + 0.5 with k = 1 / (1 - C/100) for C >= 0, 1 + C/100 below.
 */
// Inverse of the formula above: given the linear map the JS LUT applies, solve for B and C. The two branches of C
// mirror ImageMagick's two branches of k. Note 'im71': older 6.x versions use a different -brightness-contrast.
export function brightnessContrastArg(slope, offset) {
  const C = slope >= 1 ? (1 - 1 / slope) * 100 : (slope - 1) * 100;
  const B = ((offset - 0.5 + 0.5 * slope) / slope) * 100;
  return `${num(B, 3)}x${num(C, 3)}`;
}

/**
 * Colour work of ops.adjustColors: adj { brightness, contrast, saturation, hue, gamma, temperature }, fl { grayscale,
 * sepia, invert } -> steps. The lookup-table part (temperature, brightness / contrast, gamma) maps one to one; the
 * colour matrix (saturation, hue, grayscale, sepia) becomes one -color-matrix; -clamp keeps ImageMagick's HDRI values
 * in range between the two parts, as the lookup tables do. On transparent images wrap the steps in -channel RGB /
 * +channel: -brightness-contrast, -gamma and -negate also change alpha.
 */
export function colorSteps(adj = {}, fl = {}) {
  const steps = [];
  const t = (adj.temperature || 0) / 100;
  if (t) steps.push({ id: 'temperature', args: [['-color-matrix', matrixText([1 + 0.18 * t, 0, 0, 0, 1 + 0.03 * t, 0, 0, 0, 1 - 0.18 * t])]], fidelity: EXACT });
  if (adj.brightness || adj.contrast) {
    // ops: x = v + 128 b, then (x - 128) * cf + 128 (0..255) -> slope cf, offset in 0..1
    const b = (adj.brightness || 0) / 100, c = Math.max(-0.99, Math.min(0.99, (adj.contrast || 0) / 100));
    const C = c * 255, cf = (259 * (C + 255)) / (255 * (259 - C));
    steps.push({ id: 'brightnessContrast', args: [['-brightness-contrast', brightnessContrastArg(cf, (cf * 128 * b + 128 * (1 - cf)) / 255)]], fidelity: EXACT, note: 'im71' });
  }
  const g = adj.gamma > 0 ? adj.gamma : 1;
  if (Math.abs(g - 1) > 1e-9) steps.push({ id: 'gamma', args: [['-gamma', num(g, 4)]], fidelity: EXACT });
  const lut = steps.length > 0;
  const parts = [];
  let M = ID3;
  const s = 1 + (adj.saturation || 0) / 100;
  if (s !== 1) { M = mul3(saturationMatrix(s), M); parts.push('saturation'); }
  if (adj.hue) { M = mul3(hueMatrix(adj.hue), M); parts.push('hue'); }
  if (fl.grayscale) { M = mul3(GRAY, M); parts.push('grayscale'); }
  if (fl.sepia) { M = mul3(SEPIA, M); parts.push('sepia'); }
  let clamped = !lut;
  const clamp = () => { const c = clamped ? [] : [['-clamp']]; clamped = true; return c; };
  // (grayscale as a matrix too: -colorspace Gray would also drop an RGB ICC profile and write a gray file)
  if (parts.length) steps.push({ id: parts.length === 1 ? parts[0] : 'colorMatrix', parts, args: [...clamp(), ['-color-matrix', matrixText(M)]], fidelity: EXACT });
  if (fl.invert) steps.push({ id: 'invert', args: [...clamp(), ['-negate']], fidelity: EXACT });
  return steps;
}

// --- filters ----------------------------------------------------------------------------------------------------

/** Gaussian blur of sigma (ops.blur: ImageMagick's separable -blur kernel; wide kernels are box-approximated). */
export function blurStep(sigma) {
  if (!(sigma > 0.2)) return null;
  const exact = blurIsExact(sigma);
  return { id: 'blur', args: [['-blur', `0x${num(sigma, 3)}`]], fidelity: exact ? EXACT : APPROX, note: exact ? undefined : 'boxBlur' };
}

/** Unsharp mask (ops.sharpen): amount 0..5, radius = sigma, threshold 0..1. */
export function sharpenStep(amount, radius = 1, threshold = 0) {
  if (!(amount > 0)) return null;
  const sigma = Math.max(0.3, radius);
  const exact = blurIsExact(sigma);
  return { id: 'sharpen', args: [['-unsharp', `0x${num(sigma, 3)}+${num(amount, 3)}+${num(threshold, 4)}`]], fidelity: exact ? EXACT : APPROX, note: exact ? undefined : 'boxBlur' };
}

/** Vignette (ops.vignette): the same smoothstep falloff as an -fx expression on the colour channels. */
// -fx is interpreted per pixel (slow, hence note 'fxSlow'), but it is the only way to express the exact same
// smoothstep; ImageMagick's own -vignette uses a different (gaussian-blurred ellipse) profile.
export function vignetteStep(amount) {
  if (!(amount > 0)) return null;
  const fx = `vt=clamp((hypot((i+0.5)/(w/2)-1,(j+0.5)/(h/2)-1)/sqrt(2)-0.35)/0.65);u*(1-${num(amount, 4)}*vt*vt*(3-2*vt))`;
  return { id: 'vignette', args: [['-channel', 'RGB', '-fx', fx, '+channel']], fidelity: EXACT, note: 'fxSlow' };
}
