// ascii/palette.js - terminal palettes (xterm 16 and 256 colours), perceptual nearest-colour search, hex colours.
//
// Colour matching is done in sRGB with a weighted distance rather than in CIELAB: palette lookups run per cell per
// frame (camera input), and redmean is within a few percent of a perceptual metric at a fraction of the cost.

// The standard xterm palette of the 16 system colours (0-7 normal, 8-15 bright).
export const ANSI16 = Object.freeze([
  [0, 0, 0], [205, 0, 0], [0, 205, 0], [205, 205, 0], [0, 0, 238], [205, 0, 205], [0, 205, 205], [229, 229, 229],
  [127, 127, 127], [255, 0, 0], [0, 255, 0], [255, 255, 0], [92, 92, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
]);

// Channel levels of the 6×6×6 colour cube (indices 16..231); 232..255 are grays 8, 18, …, 238.
export const CUBE_LEVELS = Object.freeze([0, 95, 135, 175, 215, 255]);

// "Redmean" weighted distance: a cheap approximation of perceived colour difference (squared, no sqrt).
export function colorDistance(r1, g1, b1, r2, g2, b2) {
  const rm = (r1 + r2) / 2, dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return ((512 + rm) * dr * dr) / 256 + 4 * dg * dg + ((767 - rm) * db * db) / 256;
}

// Index (0..15) of the perceptually nearest xterm system colour.
export function nearest16(r, g, b) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < 16; i++) {
    const p = ANSI16[i];
    const d = colorDistance(r, g, b, p[0], p[1], p[2]);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// Nearest cube level by thresholds at the midpoints between levels (0 | 95 | 135 | ...): the cube is not evenly
// spaced (the first step is 95), so a plain v / 51 would pick wrong neighbours in the dark range.
const cubeIndex = (v) => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, ((v - 35) / 40) | 0));

// Index (16..255) of the nearest colour of the 256-colour cube or gray ramp (the system colours 0..15 vary between
// terminals, so they are never chosen).
// Two candidates only (nearest cube colour, nearest gray) instead of a 240-entry scan: the cube is separable per
// channel, so its nearest point is found per channel; grays win for near-neutral colours.
export function nearest256(r, g, b) {
  const ri = cubeIndex(r), gi = cubeIndex(g), bi = cubeIndex(b);
  const dc = colorDistance(r, g, b, CUBE_LEVELS[ri], CUBE_LEVELS[gi], CUBE_LEVELS[bi]);
  const gIdx = Math.max(0, Math.min(23, Math.round(((r + g + b) / 3 - 8) / 10)));
  const gv = 8 + 10 * gIdx;
  return colorDistance(r, g, b, gv, gv, gv) < dc ? 232 + gIdx : 16 + 36 * ri + 6 * gi + bi;
}

// RGB of a 256-colour palette index.
export function ansi256RGB(i) {
  if (i < 16) return ANSI16[i].slice();
  if (i >= 232) { const v = 8 + 10 * (i - 232); return [v, v, v]; }
  const k = i - 16;
  return [CUBE_LEVELS[(k / 36) | 0], CUBE_LEVELS[((k / 6) | 0) % 6], CUBE_LEVELS[k % 6]];
}

// RGB of all 256 palette entries (system colours first, so ANSI 16 indices share the table).
const PAL256 = (() => {
  const t = new Uint8Array(768);
  for (let i = 0; i < 256; i++) t.set(ansi256RGB(i), i * 3);
  return t;
})();

// '#rrggbb', shortened to '#rgb' when every channel repeats its digit.
export function hex(r, g, b) {
  const s = ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  return s[0] === s[1] && s[2] === s[3] && s[4] === s[5] ? '#' + s[0] + s[2] + s[4] : '#' + s;
}

// [r, g, b] of '#rgb' / '#rrggbb' (null when malformed).
export function parseHex(s) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(s || '').trim());
  if (!m) return null;
  const x = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
  return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
}

// Relative luminance-like brightness 0..1 of sRGB values (Rec. 709 weights on the encoded values).
export const luma = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/**
 * Snaps RGB triplets (Uint8Array, in place) to a colour mode and returns the palette indices (or null).
 *   'ansi16' / 'ansi256'  nearest palette colour (indices returned)
 *   'html'                12-bit colour (#rgb): compact markup, longer runs
 *   'truecolor'           unchanged
 */
// Cache by packed RGB: images have far fewer distinct colours than pixels, so most lookups hit.
// 'html' rounds to multiples of 17 (0x11), the values representable as #rgb shorthand.
export function quantizeColors(rgb, mode) {
  const n = rgb.length / 3;
  if (mode === 'ansi16' || mode === 'ansi256') {
    const idx = new Uint8Array(n);
    const cache = new Map();
    for (let i = 0, p = 0; i < n; i++, p += 3) {
      const key = (rgb[p] << 16) | (rgb[p + 1] << 8) | rgb[p + 2];
      let k = cache.get(key);
      if (k === undefined) { k = mode === 'ansi16' ? nearest16(rgb[p], rgb[p + 1], rgb[p + 2]) : nearest256(rgb[p], rgb[p + 1], rgb[p + 2]); cache.set(key, k); }
      idx[i] = k;
      rgb[p] = PAL256[k * 3]; rgb[p + 1] = PAL256[k * 3 + 1]; rgb[p + 2] = PAL256[k * 3 + 2];
    }
    return idx;
  }
  if (mode === 'html') for (let p = 0; p < rgb.length; p++) rgb[p] = Math.round(rgb[p] / 17) * 17;
  return null;
}
