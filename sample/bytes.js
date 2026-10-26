// sample/bytes.js - helpers of the sample generators: UTF-8 / latin1 bytes, base64 size, seeded randomness, HSL.
//
// Determinism is the contract of this folder: sample artwork is derived from seeds hashed from labels, never from
// Math.random or the clock, so templates regenerate byte-identical files (stable diffs, cacheable builds).

/** UTF-8 bytes of a string. */
function tplUtf8(str) {
  return new TextEncoder().encode(String(str));
}


/** Decoded byte length of a base64 string. */
// Exact decoded length from the base64 length and its padding, without decoding (attachment sizes in templates).
function tplB64Size(b64) {
  const s = String(b64 || '').replace(/\s+/g, '');
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return Math.floor(s.length / 4) * 3 - pad;
}

/** Bytes of a latin1 string (every char code < 256). */
function tplLatin1(str) {
  const b = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) b[i] = str.charCodeAt(i) & 255;
  return b;
}


/** FNV-1a 32-bit hash (deterministic seeds for artwork). */
function tplHash(str) {
  let h = 0x811c9dc5;
  for (const ch of String(str)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Small deterministic PRNG (mulberry32). */
// mulberry32: 32-bit state, one Math.imul-based mix per output; tiny and fast with good enough statistics for
// layout jitter. Not cryptographic, and its period (2^32) is irrelevant at artwork scale.
function tplRand(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** '#rrggbb' → [h (0..360), s (0..100), l (0..100)]. Invalid input → teal. */
function tplHexToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  const n = m ? parseInt(m[1], 16) : 0x0f766e;
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s * 100, l * 100];
}

/** HSL (deg, %, %) → [r, g, b] 0..255. */
function tplHslToRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360; s /= 100; l /= 100;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}

/** CSS hsl() string with the hue wrapped into 0..360. */
function tplHsl(h, s, l) {
  return 'hsl(' + Math.round((((h % 360) + 360) % 360)) + ' ' + Math.round(s) + '% ' + Math.round(l) + '%)';
}

export {
  tplB64Size,
  tplHash,
  tplHexToHsl,
  tplHsl,
  tplHslToRgb,
  tplLatin1,
  tplRand,
  tplUtf8
};
