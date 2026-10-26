// color/space.js - colour space conversions after CSS Color 4 (sRGB, linear sRGB, display-p3, XYZ D65 / D50, CIELAB,
// LCh, OKLab, OKLCH, HSL, HSV, HWB), gamut checks and the CSS Color 4 gamut mapping (OKLCH chroma reduction).
//
// A colour is { space, coords: [a, b, c], alpha } with CSS conventions for the coordinates:
//   srgb, srgb-linear, display-p3  0..1 per channel (may exceed the range when out of gamut)
//   xyz-d65, xyz-d50               Y of the reference white = 1
//   lab [L 0..100, a, b]   lch [L, C, H°]   oklab [L 0..1, a, b]   oklch [L, C, H°]
//   hsl [H°, S 0..100, L 0..100]   hwb [H°, W 0..100, B 0..100]   hsv [H°, S 0..100, V 0..100]
// Hues are normalized to [0, 360); an achromatic colour gets hue 0.
//
// Design: one source of truth per formula, taken from the CSS Color 4 sample code, so results match browsers to
// ~1e-12. Coordinates are plain arrays (no classes): cheap to create in tight loops (palette search, gamut mapping)
// and trivially serialisable. Out-of-gamut values are kept, never clipped during conversion - clipping is a
// separate, explicit decision (clip / gamutMapCoords), otherwise a round trip through sRGB would destroy P3 colours.

// --- matrices (CSS Color 4, "Sample code for colour conversions") --------------------------------

// Linear sRGB <-> XYZ D65 (exact rational forms of the sRGB primaries and the D65 white).
// Rationals rather than rounded decimals: the forward and inverse matrices are then exact inverses, so
// srgb -> xyz -> srgb returns the input to the last bit instead of drifting by 1e-5 (which shows up as off-by-one
// 8-bit values after a few conversions).
const SRGB_TO_XYZ = [
  [506752 / 1228815, 87881 / 245763, 12673 / 70218],
  [87098 / 409605, 175762 / 245763, 12673 / 175545],
  [7918 / 409605, 87881 / 737289, 1001167 / 1053270],
];
const XYZ_TO_SRGB = [
  [12831 / 3959, -329 / 214, -1974 / 3959],
  [-851781 / 878810, 1648619 / 878810, 36519 / 878810],
  [705 / 12673, -2585 / 12673, 705 / 667],
];
// Linear display-p3 <-> XYZ D65.
const P3_TO_XYZ = [
  [608311 / 1250200, 189793 / 714400, 198249 / 1000160],
  [35783 / 156275, 247089 / 357200, 198249 / 2500400],
  [0, 32229 / 714400, 5220557 / 5000800],
];
const XYZ_TO_P3 = [
  [446124 / 178915, -333277 / 357830, -72051 / 178915],
  [-14852 / 17905, 63121 / 35810, 423 / 17905],
  [11844 / 330415, -50337 / 660830, 316169 / 330415],
];
// Bradford chromatic adaptation D65 <-> D50.
// Needed because CSS lab()/lch() are defined relative to D50 (print heritage) while sRGB/P3/OKLab use D65; a plain
// XYZ copy between whites would shift every colour toward blue or yellow.
const D65_TO_D50 = [
  [1.0479297925449969, 0.022946870601609652, -0.05019226628920524],
  [0.02962780877005599, 0.9904344267538799, -0.017073799063418826],
  [-0.009243040646204504, 0.015055191490298152, 0.7518742814281371],
];
const D50_TO_D65 = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
];
// OKLab (Björn Ottosson, matrices re-derived for the CSS Color 4 D65 white).
const XYZ_TO_LMS = [
  [0.8190224379967030, 0.3619062600528904, -0.1288737815209879],
  [0.0329836539323885, 0.9292868615863434, 0.0361446663506424],
  [0.0481771893596242, 0.2642395317527308, 0.6335478284694309],
];
const LMS_TO_OKLAB = [
  [0.2104542683093140, 0.7936177747023054, -0.0040720430116193],
  [1.9779985324311684, -2.4285922420485799, 0.4505937096174110],
  [0.0259040424655478, 0.7827717124575296, -0.8086757549230774],
];
const LMS_TO_XYZ = [
  [1.2268798758459243, -0.5578149944602171, 0.2813910456659647],
  [-0.0405757452148008, 1.1122868032803170, -0.0717110580655164],
  [-0.0763729366746601, -0.4214933324022432, 1.5869240198367816],
];
const OKLAB_TO_LMS = [
  [1.0000000000000000, 0.3963377773761749, 0.2158037573099136],
  [1.0000000000000000, -0.1055613458156586, -0.0638541728258133],
  [1.0000000000000000, -0.0894841775298119, -1.2914855480194092],
];

// Reference whites (xy chromaticities of CSS Color 4) as XYZ with Y = 1.
const WHITE_D65 = [0.3127 / 0.3290, 1, (1 - 0.3127 - 0.3290) / 0.3290];
const WHITE_D50 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];

const mul = (M, v) => [
  M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
  M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
  M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2],
];

// Non-finite hue (NaN from atan2 of 0/0 elsewhere, or CSS 'none') -> 0; % keeps the sign in JS, hence the + 360.
const normHue = (h) => {
  if (!Number.isFinite(h)) return 0;
  h %= 360;
  return h < 0 ? h + 360 : h;
};

// --- transfer functions ------------------------------------------------------------------------

// sRGB / display-p3 transfer curve, extended to negative values by symmetry (CSS Color 4).
// The odd extension matters for out-of-gamut colours: P3 green expressed in sRGB has a negative red channel, and
// Math.pow of a negative base would return NaN.
function toLinear(c) {
  const a = Math.abs(c);
  return a <= 0.04045 ? c / 12.92 : Math.sign(c) * Math.pow((a + 0.055) / 1.055, 2.4);
}
function fromLinear(c) {
  const a = Math.abs(c);
  return a > 0.0031308 ? Math.sign(c) * (1.055 * Math.pow(a, 1 / 2.4) - 0.055) : 12.92 * c;
}
const srgbToLinear = (rgb) => rgb.map(toLinear);
const linearToSrgb = (rgb) => rgb.map(fromLinear);

// --- pairwise conversions ----------------------------------------------------------------------

const linSrgbToXyz = (rgb) => mul(SRGB_TO_XYZ, rgb);
const xyzToLinSrgb = (xyz) => mul(XYZ_TO_SRGB, xyz);
const linP3ToXyz = (rgb) => mul(P3_TO_XYZ, rgb);
const xyzToLinP3 = (xyz) => mul(XYZ_TO_P3, xyz);
const xyzD65ToD50 = (xyz) => mul(D65_TO_D50, xyz);
const xyzD50ToD65 = (xyz) => mul(D50_TO_D65, xyz);

// OKLab: linear map to a cone-like LMS, cube root (perceptual compression), linear map to L, a, b. Math.cbrt (not
// ** (1/3)) because it is defined for negative inputs, which out-of-gamut colours produce.
function xyzToOklab(xyz) {
  const lms = mul(XYZ_TO_LMS, xyz);
  return mul(LMS_TO_OKLAB, lms.map(Math.cbrt));
}
function oklabToXyz(lab) {
  const lms = mul(OKLAB_TO_LMS, lab);
  return mul(LMS_TO_XYZ, lms.map((c) => c * c * c));
}

// CIELAB with the D50 white (as CSS lab()).
// ε and κ in their exact rational forms (CIE 15 recommendation): the older 0.008856 / 903.3 roundings make the two
// branches of the piecewise function disagree slightly at the joint, producing a tiny discontinuity in L.
const LAB_E = 216 / 24389; // 6^3 / 29^3
const LAB_K = 24389 / 27; // 29^3 / 3^3
function xyzD50ToLab(xyz) {
  const f = xyz.map((v, i) => {
    const x = v / WHITE_D50[i];
    return x > LAB_E ? Math.cbrt(x) : (LAB_K * x + 16) / 116;
  });
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}
function labToXyzD50(lab) {
  const f1 = (lab[0] + 16) / 116;
  const f0 = lab[1] / 500 + f1;
  const f2 = f1 - lab[2] / 200;
  const x = f0 ** 3 > LAB_E ? f0 ** 3 : (116 * f0 - 16) / LAB_K;
  const y = lab[0] > LAB_K * LAB_E ? f1 ** 3 : lab[0] / LAB_K;
  const z = f2 ** 3 > LAB_E ? f2 ** 3 : (116 * f2 - 16) / LAB_K;
  return [x * WHITE_D50[0], y * WHITE_D50[1], z * WHITE_D50[2]];
}

// Rectangular <-> polar form (Lab -> LCh, OKLab -> OKLCH).
// Exact zero chroma -> hue 0 (CSS treats it as 'none'); negative chroma on the way back is clamped to 0 rather than
// flipping the hue, matching CSS parsing of lch()/oklch().
function toPolar([l, a, b]) {
  const c = Math.sqrt(a * a + b * b);
  return [l, c, c === 0 ? 0 : normHue(Math.atan2(b, a) * 180 / Math.PI)];
}
function fromPolar([l, c, h]) {
  const r = normHue(h) * Math.PI / 180;
  const cc = Math.max(0, c);
  return [l, cc * Math.cos(r), cc * Math.sin(r)];
}
const labToLch = toPolar;
const lchToLab = fromPolar;
const oklabToOklch = toPolar;
const oklchToOklab = fromPolar;

// HSL / HWB / HSV of gamma-encoded sRGB (CSS Color 4 definitions; S, L, W, B, V in 0..100).
function rgbHue(r, g, b, max, d) {
  if (d === 0) return 0;
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return normHue(h * 60);
}
function srgbToHsl([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  let h = rgbHue(r, g, b, max, d);
  let s = d === 0 || l <= 0 || l >= 1 ? 0 : (max - l) / Math.min(l, 1 - l);
  // Far out-of-gamut input can give a negative saturation: flip the hue instead.
  if (s < 0) { h = normHue(h + 180); s = -s; }
  return [h, s * 100, l * 100];
}
// Branch-free CSS Color 4 formula: each channel is a clamped triangle wave of the hue offset n (0 red, 8 green,
// 4 blue, in units of 30 degrees). Same idea for HSV below with a 60-degree unit.
function hslToSrgb([h, s, l]) {
  h = normHue(h);
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}
function srgbToHwb(rgb) {
  const h = srgbToHsl(rgb)[0];
  return [h, Math.min(...rgb) * 100, (1 - Math.max(...rgb)) * 100];
}
// CSS rule: when whiteness + blackness >= 100 % the result is a grey normalised by their sum (hue ignored).
function hwbToSrgb([h, w, b]) {
  w /= 100;
  b /= 100;
  if (w + b >= 1) {
    const g = w / (w + b);
    return [g, g, g];
  }
  return hslToSrgb([h, 100, 50]).map((c) => c * (1 - w - b) + w);
}
function srgbToHsv([r, g, b]) {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  return [rgbHue(r, g, b, max, d), max === 0 ? 0 : (d / max) * 100, max * 100];
}
function hsvToSrgb([h, s, v]) {
  h = normHue(h);
  s /= 100;
  v /= 100;
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

// --- the space graph ---------------------------------------------------------------------------
// Each space converts to and from its base; XYZ D65 is the root. convert() walks up to the closest common
// ancestor and back down, so srgb -> hsl never leaves sRGB and oklab -> oklch never visits XYZ.

const SPACES = {
  'xyz-d65': { base: null },
  'xyz-d50': { base: 'xyz-d65', to: xyzD50ToD65, from: xyzD65ToD50 },
  'srgb-linear': { base: 'xyz-d65', to: linSrgbToXyz, from: xyzToLinSrgb, rgb: true },
  srgb: { base: 'srgb-linear', to: srgbToLinear, from: linearToSrgb, rgb: true },
  'display-p3-linear': { base: 'xyz-d65', to: linP3ToXyz, from: xyzToLinP3, rgb: true },
  'display-p3': { base: 'display-p3-linear', to: srgbToLinear, from: linearToSrgb, rgb: true },
  lab: { base: 'xyz-d50', to: labToXyzD50, from: xyzD50ToLab },
  lch: { base: 'lab', to: lchToLab, from: labToLch, hue: 2 },
  oklab: { base: 'xyz-d65', to: oklabToXyz, from: xyzToOklab },
  oklch: { base: 'oklab', to: oklchToOklab, from: oklabToOklch, hue: 2 },
  hsl: { base: 'srgb', to: hslToSrgb, from: srgbToHsl, hue: 0 },
  hwb: { base: 'srgb', to: hwbToSrgb, from: srgbToHwb, hue: 0 },
  hsv: { base: 'srgb', to: hsvToSrgb, from: srgbToHsv, hue: 0 },
};
const ALIASES = { xyz: 'xyz-d65', rgb: 'srgb', p3: 'display-p3' };
const spaceId = (s) => {
  const k = String(s || '').toLowerCase();
  return SPACES[k] ? k : ALIASES[k] || null;
};

function chain(id) {
  const out = [];
  for (let s = id; s; s = SPACES[s].base) out.push(s);
  return out;
}

// Coordinates of `coords` (in space `from`) converted to space `to`.
// Non-finite coordinates become 0 (CSS 'none' semantics) so one NaN cannot poison every later step. A 13-space
// graph with N pairwise functions instead of N^2 direct converters; the cost is a few extra matrix products.
function convertCoords(coords, from, to) {
  const a = spaceId(from);
  const b = spaceId(to);
  if (!a || !b) throw new Error('unknown colour space: ' + (a ? to : from));
  let v = coords.slice(0, 3).map((x) => (Number.isFinite(x) ? x : 0));
  if (a === b) return v;
  const up = chain(a);
  const down = chain(b);
  const common = up.find((s) => down.includes(s));
  for (const s of up) {
    if (s === common) break;
    v = SPACES[s].to(v);
  }
  for (const s of down.slice(0, down.indexOf(common)).reverse()) v = SPACES[s].from(v);
  return v;
}

// A colour object converted to another space (alpha kept).
function convert(color, to) {
  return { space: spaceId(to), coords: convertCoords(color.coords, color.space, to), alpha: color.alpha ?? 1 };
}

const color = (space, coords, alpha = 1) => ({ space: spaceId(space), coords: coords.slice(0, 3), alpha });

// --- gamut ---------------------------------------------------------------------------------------

// Tolerance of the gamut checks (rounding noise of the matrices, as in color.js).
const GAMUT_EPS = 0.000075;

// True when the colour (object, or coords with a space id) fits the RGB gamut of `gamut` ('srgb', 'display-p3').
function inGamut(c, gamut = 'srgb', eps = GAMUT_EPS) {
  const g = spaceId(gamut);
  const rgb = Array.isArray(c) ? c : convertCoords(c.coords, c.space, g);
  return rgb.every((v) => v >= -eps && v <= 1 + eps);
}
const clip = (rgb) => rgb.map((v) => Math.min(1, Math.max(0, v)));

const deltaEOKLab = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

// CSS Color 4 gamut mapping: binary search on OKLCH chroma (hue and lightness kept); a clipped candidate within
// the just-noticeable difference (ΔEOK 0.02) of the current one ends the search. Returns RGB coords of `gamut`.
// Why not plain clipping: clipping each channel shifts hue (a vivid out-of-gamut blue clips toward purple). Why not
// pure chroma reduction to the exact boundary: it over-desaturates; the JND test accepts a clipped colour as soon as
// clipping is no longer visible, keeping more chroma. minInGamut tracks whether the lower bound is still in gamut
// (fast path: in-gamut midpoints simply raise min). L outside (0, 1) maps straight to white/black, as specified.
// The result is always clipped, so the last tiny overshoot never escapes.
function gamutMapCoords(c, gamut = 'srgb') {
  const g = spaceId(gamut);
  const dest = convertCoords(c.coords, c.space, g);
  if (inGamut(dest, g)) return clip(dest);
  const lch = convertCoords(c.coords, c.space, 'oklch');
  if (lch[0] >= 1) return [1, 1, 1];
  if (lch[0] <= 0) return [0, 0, 0];
  const JND = 0.02;
  const EPS = 0.0001;
  const cur = lch.slice();
  const okOf = (rgb) => convertCoords(rgb, g, 'oklab');
  const curLab = () => oklchToOklab(cur);
  let clipped = clip(convertCoords(cur, 'oklch', g));
  let E = deltaEOKLab(okOf(clipped), curLab());
  if (E < JND) return clipped;
  let min = 0;
  let max = lch[1];
  let minInGamut = true;
  while (max - min > EPS) {
    const chroma = (min + max) / 2;
    cur[1] = chroma;
    const rgb = convertCoords(cur, 'oklch', g);
    if (minInGamut && inGamut(rgb, g)) { min = chroma; continue; }
    clipped = clip(rgb);
    E = deltaEOKLab(okOf(clipped), curLab());
    if (E < JND) {
      if (JND - E < EPS) break;
      minInGamut = false;
      min = chroma;
    } else max = chroma;
  }
  return clipped;
}

// Gamut-mapped colour object in the RGB space `gamut`.
function toGamut(c, gamut = 'srgb') {
  return { space: spaceId(gamut), coords: gamutMapCoords(c, gamut), alpha: c.alpha ?? 1 };
}

// Largest OKLCH chroma that stays inside `gamut` for lightness L and hue H (binary search).
// Upper bound 0.5 exceeds the largest chroma of sRGB and P3 (~0.33 / ~0.37); 24 halvings give a resolution of
// 0.5 / 2^24 ≈ 3e-8. eps = 0 here: the boundary should be strict, not padded by matrix noise tolerance.
function maxChroma(L, H, gamut = 'srgb') {
  if (L <= 0 || L >= 1) return 0;
  let lo = 0;
  let hi = 0.5;
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    if (inGamut(convertCoords([L, m, H], 'oklch', gamut), gamut, 0)) lo = m; else hi = m;
  }
  return lo;
}

// --- shortcuts on plain sRGB triples (0..1) --------------------------------------------------------

const srgbToXyz = (rgb) => linSrgbToXyz(srgbToLinear(rgb));
const xyzToSrgb = (xyz) => linearToSrgb(xyzToLinSrgb(xyz));
const srgbToOklab = (rgb) => xyzToOklab(srgbToXyz(rgb));
const oklabToSrgb = (lab) => xyzToSrgb(oklabToXyz(lab));
const srgbToOklch = (rgb) => oklabToOklch(srgbToOklab(rgb));
const oklchToSrgb = (lch) => oklabToSrgb(oklchToOklab(lch));
const srgbToLab = (rgb) => xyzD50ToLab(xyzD65ToD50(srgbToXyz(rgb)));
const labToSrgb = (lab) => xyzToSrgb(xyzD50ToD65(labToXyzD50(lab)));
// OKLCH -> sRGB through the CSS gamut mapping (always displayable).
const oklchToSrgbMapped = (lch) => gamutMapCoords({ space: 'oklch', coords: lch }, 'srgb');

// 8-bit helpers: [0..1] <-> [0..255].
const to255 = (rgb) => rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
const from255 = (rgb) => rgb.map((v) => v / 255);

export {
  D50_TO_D65,
  D65_TO_D50,
  GAMUT_EPS,
  P3_TO_XYZ,
  SPACES,
  SRGB_TO_XYZ,
  WHITE_D50,
  WHITE_D65,
  XYZ_TO_P3,
  XYZ_TO_SRGB,
  clip,
  color,
  convert,
  convertCoords,
  deltaEOKLab,
  from255,
  fromLinear,
  gamutMapCoords,
  hslToSrgb,
  hsvToSrgb,
  hwbToSrgb,
  inGamut,
  labToLch,
  labToSrgb,
  labToXyzD50,
  lchToLab,
  linP3ToXyz,
  linSrgbToXyz,
  linearToSrgb,
  maxChroma,
  mul,
  normHue,
  oklabToOklch,
  oklabToSrgb,
  oklabToXyz,
  oklchToOklab,
  oklchToSrgb,
  oklchToSrgbMapped,
  spaceId,
  srgbToHsl,
  srgbToHsv,
  srgbToHwb,
  srgbToLab,
  srgbToLinear,
  srgbToOklab,
  srgbToOklch,
  srgbToXyz,
  to255,
  toGamut,
  toLinear,
  xyzD50ToD65,
  xyzD50ToLab,
  xyzD65ToD50,
  xyzToLinP3,
  xyzToLinSrgb,
  xyzToOklab,
  xyzToSrgb
};
