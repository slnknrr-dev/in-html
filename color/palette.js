// color/palette.js - palette generation in OKLCH: harmonies, design-system tint / shade scales (50-950), seeded random
// palettes with locks, k-means++ image palette extraction in OKLab and hue-family names for tokens.
// Colours are OKLCH triples [L 0..1, C, H°] unless stated; outputs are gamut-mapped to sRGB.
import { gamutMapCoords, maxChroma, normHue, oklabToOklch, oklabToSrgb, oklchToOklab, srgbToOklab, srgbToOklch, toLinear, xyzToOklab, linSrgbToXyz } from './space.js';
import { toHex } from './css.js';
//
// Why OKLCH for generation: equal steps in L look like equal lightness steps and rotating H keeps perceived
// lightness and chroma - in HSL a "yellow" and a "blue" at the same L differ wildly in brightness, so HSL harmonies
// look unbalanced. Every output passes through swatch(), which gamut-maps (never clips), so generated hues survive.
// Determinism: all randomness comes from the seeded rng(), so a palette is reproducible from (seed, options) - needed
// for shareable URLs and for tests.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Displayable result of an OKLCH colour: { oklch (after mapping), rgb (0..1), hex }.
function swatch(lch) {
  const rgb = gamutMapCoords({ space: 'oklch', coords: [clamp(lch[0], 0, 1), Math.max(0, lch[1]), normHue(lch[2])] }, 'srgb');
  return { oklch: srgbToOklch(rgb), rgb, hex: toHex(rgb) };
}

// --- seeded random numbers ----------------------------------------------------------------------

// mulberry32: small, fast, good enough for colour choices; returns floats in [0, 1).
// Not Math.random: that cannot be seeded. Not crypto: overkill and unseeded. Seed 0 is replaced by the golden-ratio
// constant because a zero state starts with low-entropy outputs. Math.imul keeps the products in 32-bit integer
// arithmetic (a plain * would lose the low bits in float).
function rng(seed = 1) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- harmonies ----------------------------------------------------------------------------------

const HARMONIES = ['analogous', 'complementary', 'triadic', 'tetradic', 'split', 'monochrome'];
const HUE_OFFSETS = {
  complementary: [0, 180],
  triadic: [0, 120, 240],
  tetradic: [0, 90, 180, 270],
  split: [0, 150, 210],
};

// Lightness steps for repeated hues: alternately lighter and darker around the base.
// Reflection rule: if the preferred direction leaves [0.22, 0.95] (too dark to read hue, or washed out), the step
// goes the other way instead of piling up at the bound, so repeats stay distinguishable.
function lightVariant(L, round) {
  if (!round) return L;
  const step = 0.14 * Math.ceil(round / 2);
  const up = round % 2 === 1;
  let v = up ? L + step : L - step;
  if (v > 0.95 || v < 0.22) v = up ? L - step : L + step;
  return clamp(v, 0.22, 0.95);
}

/**
 * Harmony of `n` colours around the base OKLCH colour, by hue offsets in OKLCH. mode: one of HARMONIES.
 * analogous spreads hues symmetrically (30° apart, narrower for big palettes) with the base in the middle;
 * monochrome keeps the hue and spreads lightness; the other modes cycle their hues and vary the lightness of
 * repeats. Returns swatch objects ({ oklch, rgb, hex }).
 */
function harmony(base, mode = 'analogous', n = 5) {
  const [L, C, H] = base;
  n = clamp(Math.round(n) || 1, 1, 24);
  const out = [];
  if (mode === 'monochrome') {
    // Lightness from 0.95 to 0.25; the step nearest the base takes the base itself.
    const Ls = Array.from({ length: n }, (_, i) => (n === 1 ? L : 0.95 - (0.7 * i) / (n - 1)));
    let near = 0;
    Ls.forEach((v, i) => { if (Math.abs(v - L) < Math.abs(Ls[near] - L)) near = i; });
    Ls[near] = L;
    for (const l of Ls) {
      // Chroma fades toward very light and very dark steps.
      const t = 1 - Math.min(1, Math.abs(l - L) / 0.8) * 0.55;
      out.push(swatch([l, C * t, H]));
    }
    return out;
  }
  if (mode === 'analogous') {
    const step = n <= 5 ? 30 : Math.max(12, 150 / (n - 1));
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * step;
      // Slight lightness drift along the hue arc gives the strip a gentle gradient.
      out.push(swatch([clamp(L + off / 900, 0.2, 0.97), C, H + off]));
    }
    return out;
  }
  const offs = HUE_OFFSETS[mode] || HUE_OFFSETS.complementary;
  for (let i = 0; i < n; i++) {
    const round = Math.floor(i / offs.length);
    const off = offs[i % offs.length];
    const l = lightVariant(L, round);
    out.push(swatch([l, round ? C * (1 - 0.15 * Math.min(2, round)) : C, H + off]));
  }
  return out;
}

// --- tint / shade scales --------------------------------------------------------------------------

const SCALE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
// Reference lightness curve (close to modern design-system ramps) and the relative chroma taper.
const SCALE_L = [0.971, 0.936, 0.885, 0.808, 0.716, 0.637, 0.565, 0.497, 0.432, 0.378, 0.27];
const SCALE_C = [0.10, 0.22, 0.42, 0.66, 0.88, 1.0, 1.0, 0.92, 0.78, 0.64, 0.45];

/**
 * 11-step scale 50..950 of an OKLCH colour. The base lands exactly on the step whose reference lightness is
 * nearest; the other steps keep the reference end points (≈0.97 and ≈0.27) and are re-spaced proportionally on each
 * side of the base. Chroma follows the taper relative to the base step (at most 4× the base chroma), the hue is
 * kept, every step is gamut-mapped. Returns { steps: [{ step, oklch, rgb, hex, base }], baseStep }.
 */
// Two piecewise-linear remaps of the reference curve, one above and one below the base step, so the base colour is
// reproduced EXACTLY (designers expect "my brand colour is the 500/600") while the ends stay at the reference
// extremes. If the base is lighter than the 50 reference (or darker than 950), that end moves to the base.
// `|| 1` guards the division when the base step is itself an end step. Chroma is scaled relative to the base step's
// taper value, capped at 4x so a near-grey base does not explode into neon at the middle steps.
function scale(base) {
  const [L0, C0, H] = base;
  const L = clamp(L0, 0, 1);
  let k = 0;
  SCALE_L.forEach((v, i) => { if (Math.abs(v - L) < Math.abs(SCALE_L[k] - L)) k = i; });
  const top = Math.max(SCALE_L[0], L);
  const bottom = Math.min(SCALE_L[10], L);
  const steps = SCALE_STEPS.map((step, i) => {
    let l;
    if (i === k) l = L;
    else if (i < k) l = top + ((SCALE_L[i] - SCALE_L[0]) / (SCALE_L[k] - SCALE_L[0] || 1)) * (L - top);
    else l = L + ((SCALE_L[i] - SCALE_L[k]) / (SCALE_L[10] - SCALE_L[k] || 1)) * (bottom - L);
    const c = i === k ? C0 : C0 * Math.min(4, SCALE_C[i] / SCALE_C[k]);
    const sw = i === k ? swatch([L, C0, H]) : swatch([l, c, H]);
    return { step, ...sw, base: i === k };
  });
  return { steps, baseStep: SCALE_STEPS[k] };
}

// --- random palettes ----------------------------------------------------------------------------------

const SCHEMES = ['harmony', 'spread', 'accent'];

/**
 * Pleasing random palette of `n` colours. locked: array of length n with OKLCH colours (or null) that stay at
 * their index; the first locked colour anchors the hue and chroma of the rest. seed: integer (same seed, same
 * palette). scheme: 'harmony' (hues of a random harmony, spread lightness), 'spread' (one hue drifting from light
 * to dark), 'accent' (tinted neutrals plus accents); random when omitted. Returns { colors: swatch[], scheme, mode }.
 */
// The rng is consumed in a fixed order for a given scheme, so locking a colour does not reshuffle the others' random
// draws except through the anchor (hue/chroma) - users can lock one swatch and regenerate the rest predictably.
// Fisher-Yates shuffle on lightness levels: uniform permutation, unlike sort(() => r() - 0.5).
function randomPalette({ n = 5, seed = 1, locked = [], scheme } = {}) {
  const r = rng(seed);
  n = clamp(Math.round(n) || 5, 1, 24);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const anchor = locked.find(Boolean);
  const sch = SCHEMES.includes(scheme) ? scheme : pick(['harmony', 'harmony', 'spread', 'accent']);
  const H0 = anchor ? anchor[2] : r() * 360;
  const C0 = anchor ? Math.max(0.04, anchor[1]) : 0.09 + r() * 0.11;
  let mode = '';
  let list = [];
  if (sch === 'harmony') {
    mode = pick(['analogous', 'complementary', 'triadic', 'split', 'tetradic']);
    const offs = mode === 'analogous' ? [0, 28, -28, 56, -56, 84] : HUE_OFFSETS[mode];
    // Lightness levels spread over the range, then shuffled so hues and lightness mix.
    const lo = 0.32 + r() * 0.1;
    const hi = 0.86 + r() * 0.1;
    const Ls = Array.from({ length: n }, (_, i) => (n === 1 ? (lo + hi) / 2 : lo + ((hi - lo) * i) / (n - 1)));
    for (let i = Ls.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [Ls[i], Ls[j]] = [Ls[j], Ls[i]]; }
    list = Ls.map((l, i) => {
      const h = H0 + offs[i % offs.length] + (r() - 0.5) * 16;
      // Very light and very dark colours look better with less chroma.
      const c = C0 * (0.55 + r() * 0.6) * (1 - Math.abs(l - 0.62) * 0.9);
      return [l, c, h];
    });
  } else if (sch === 'spread') {
    mode = 'spread';
    const drift = (r() - 0.5) * 70;
    const dark = 0.24 + r() * 0.08;
    const light = 0.93 + r() * 0.04;
    list = Array.from({ length: n }, (_, i) => {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const l = light + (dark - light) * t;
      return [l, C0 * (0.5 + Math.sin(Math.PI * t) * 0.8), H0 + drift * t];
    });
    if (r() < 0.5) list.reverse();
  } else {
    mode = 'accent';
    const tint = 0.008 + r() * 0.018;
    const accents = Math.max(1, Math.round(n / 3));
    const neutralLs = [0.97, 0.26, 0.88, 0.4, 0.78, 0.55];
    const accentHues = [H0, H0 + pick([150, 180, 200, 30]), H0 + 90];
    let ni = 0;
    let ai = 0;
    list = Array.from({ length: n }, (_, i) => {
      const isAccent = i % 3 === 1 && ai < accents;
      if (isAccent) {
        const h = accentHues[ai++ % accentHues.length];
        return [0.58 + r() * 0.14, Math.max(0.12, C0 * 1.3), h];
      }
      return [neutralLs[ni++ % neutralLs.length], tint, H0 + (r() - 0.5) * 20];
    });
  }
  const colors = list.map((c, i) => (locked[i] ? swatch(locked[i]) : swatch(c)));
  return { colors, scheme: sch, mode };
}

// --- image palettes (k-means++ in OKLab) ----------------------------------------------------------

/**
 * Dominant colours of an RGBA byte buffer (ImageData.data). opts: { width, k (2..12), stride (pixels between
 * samples; default keeps about 20000 samples), seed, maxIter, minAlpha }. Pixels are compared in OKLab; k-means++
 * seeding is deterministic for a seed. Returns [{ rgb, hex, oklab, oklch, count, pct, x, y }] sorted by population;
 * x / y locate the sampled pixel nearest to the centroid (needs opts.width).
 */
// Why OKLab and k-means: Euclidean distance in OKLab approximates perceived difference, so clusters match what the
// eye groups; in RGB, dark colours get over-merged. k-means++ seeding avoids the classic failure of random seeds
// (two centres in one cluster, a visible colour missed). Performance: ~20 000 samples by stride, a per-colour OKLab
// cache (bounded at 50 000 keys so a noisy photo cannot grow it without limit), flat Float arrays for points.
// Pixels with alpha < minAlpha are ignored (transparent backgrounds would otherwise dominate as black).
function extractPalette(data, opts = {}) {
  const k = clamp(Math.round(opts.k || 6), 2, 12);
  const total = Math.floor(data.length / 4);
  const stride = Math.max(1, Math.round(opts.stride || Math.max(1, Math.floor(total / 20000))));
  const minAlpha = opts.minAlpha ?? 128;
  const width = opts.width || 0;
  const lut = new Float64Array(256);
  for (let i = 0; i < 256; i++) lut[i] = toLinear(i / 255);
  // Samples as packed OKLab triples plus their pixel index.
  const pts = [];
  const idx = [];
  const cache = new Map();
  for (let p = 0; p < total; p += stride) {
    const o = p * 4;
    if (data[o + 3] < minAlpha) continue;
    const key = (data[o] << 16) | (data[o + 1] << 8) | data[o + 2];
    let lab = cache.get(key);
    if (!lab) {
      lab = xyzToOklab(linSrgbToXyz([lut[data[o]], lut[data[o + 1]], lut[data[o + 2]]]));
      if (cache.size < 50000) cache.set(key, lab);
    }
    pts.push(lab[0], lab[1], lab[2]);
    idx.push(p);
  }
  const m = idx.length;
  if (!m) return [];
  const r = rng(opts.seed || 1);
  const d2 = (i, c) => (pts[i * 3] - c[0]) ** 2 + (pts[i * 3 + 1] - c[1]) ** 2 + (pts[i * 3 + 2] - c[2]) ** 2;
  // k-means++ seeding: each next centre is drawn with probability proportional to the squared distance.
  const cents = [];
  const first = Math.floor(r() * m);
  cents.push([pts[first * 3], pts[first * 3 + 1], pts[first * 3 + 2]]);
  const dist = new Float64Array(m);
  for (let i = 0; i < m; i++) dist[i] = d2(i, cents[0]);
  while (cents.length < k) {
    let sum = 0;
    for (let i = 0; i < m; i++) sum += dist[i];
    if (sum <= 1e-12) break; // fewer distinct colours than k
    let target = r() * sum;
    let pick = m - 1;
    for (let i = 0; i < m; i++) { target -= dist[i]; if (target <= 0) { pick = i; break; } }
    const c = [pts[pick * 3], pts[pick * 3 + 1], pts[pick * 3 + 2]];
    cents.push(c);
    for (let i = 0; i < m; i++) dist[i] = Math.min(dist[i], d2(i, c));
  }
  // Lloyd iterations. An empty cluster keeps its previous centre (no re-seeding) and is filtered out at the end.
  // Convergence test: largest L1 move of any centre below 1e-5 (far under a visible difference).
  const assign = new Int32Array(m);
  const maxIter = opts.maxIter || 24;
  for (let it = 0; it < maxIter; it++) {
    for (let i = 0; i < m; i++) {
      let best = 0;
      let bd = Infinity;
      for (let j = 0; j < cents.length; j++) { const d = d2(i, cents[j]); if (d < bd) { bd = d; best = j; } }
      assign[i] = best;
    }
    const acc = cents.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < m; i++) {
      const a = acc[assign[i]];
      a[0] += pts[i * 3]; a[1] += pts[i * 3 + 1]; a[2] += pts[i * 3 + 2]; a[3]++;
    }
    let move = 0;
    acc.forEach((a, j) => {
      if (!a[3]) return;
      const c = [a[0] / a[3], a[1] / a[3], a[2] / a[3]];
      move = Math.max(move, Math.abs(c[0] - cents[j][0]) + Math.abs(c[1] - cents[j][1]) + Math.abs(c[2] - cents[j][2]));
      cents[j] = c;
    });
    if (move < 1e-5) break;
  }
  const count = new Array(cents.length).fill(0);
  const near = new Array(cents.length).fill(-1);
  const nearD = new Array(cents.length).fill(Infinity);
  for (let i = 0; i < m; i++) {
    const j = assign[i];
    count[j]++;
    const d = d2(i, cents[j]);
    if (d < nearD[j]) { nearD[j] = d; near[j] = i; }
  }
  return cents.map((c, j) => {
    const rgb = gamutMapCoords({ space: 'oklab', coords: c }, 'srgb');
    const p = near[j] >= 0 ? idx[near[j]] : 0;
    return {
      rgb, hex: toHex(rgb), oklab: c, oklch: oklabToOklch(c), count: count[j], pct: (count[j] / m) * 100,
      x: width ? p % width : 0, y: width ? Math.floor(p / width) : 0,
    };
  }).filter((c) => c.count > 0).sort((a, b) => b.count - a.count);
}

// --- hue families -------------------------------------------------------------------------------

// OKLCH hues of the families (close to the 500 step of the Tailwind CSS v4 palette).
const FAMILIES = [
  ['red', 25.3], ['orange', 47.6], ['amber', 70.1], ['yellow', 86], ['lime', 131.7], ['green', 149.6],
  ['emerald', 162.5], ['teal', 182.5], ['cyan', 215.2], ['sky', 237.3], ['blue', 259.8], ['indigo', 277.1],
  ['violet', 292.7], ['purple', 303.9], ['fuchsia', 322.1], ['pink', 354.3], ['rose', 16.4],
];

/**
 * Hue family of an OKLCH colour: red, orange, amber, yellow, lime, green, emerald, teal, cyan, sky, blue, indigo,
 * violet, purple, fuchsia, pink, rose, or 'gray' / 'neutral' for low chroma (the threshold shrinks near white and
 * black, where even strong hues have little chroma).
 */
// room = 4L(1 - L) is a parabola peaking at L = 0.5: the available chroma of the sRGB gamut shrinks toward black and
// white, so a fixed chroma threshold would call every light pastel 'gray'. Hue distance is circular
// (((d + 540) % 360) - 180 maps any difference to [-180, 180)).
function hueFamily([L, C, H]) {
  const room = Math.min(1, 4 * L * (1 - L) * 1.2);
  const grayMax = 0.05 * room;
  if (C < grayMax * 0.3 || L >= 0.995 || L <= 0.03) return 'neutral';
  if (C < grayMax) return 'gray';
  let best = FAMILIES[0][0];
  let bd = 360;
  for (const [name, h] of FAMILIES) {
    const d = Math.abs(((H - h + 540) % 360) - 180);
    if (d < bd) { bd = d; best = name; }
  }
  return best;
}

// Unique token names for a list of OKLCH colours: 'blue', 'blue-2', 'gray', …
function tokenNames(list) {
  const seen = new Map();
  return list.map((c) => {
    const f = hueFamily(c);
    const n = (seen.get(f) || 0) + 1;
    seen.set(f, n);
    return n === 1 ? f : `${f}-${n}`;
  });
}

// Convenience: OKLCH of a hex-free sRGB triple and back (re-exported for apps that only import this module).
const rgbToOklch = srgbToOklch;
const oklchToRgb = (lch) => oklabToSrgb(oklchToOklab(lch));
const rgbToOklab = srgbToOklab;

export {
  FAMILIES,
  HARMONIES,
  SCALE_C,
  SCALE_L,
  SCALE_STEPS,
  SCHEMES,
  extractPalette,
  harmony,
  hueFamily,
  maxChroma,
  oklchToRgb,
  randomPalette,
  rgbToOklab,
  rgbToOklch,
  rng,
  scale,
  swatch,
  tokenNames
};
