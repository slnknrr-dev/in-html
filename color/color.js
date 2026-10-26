// color/color.js - colour helpers of the document products: safeColor (allowlist for user CSS colours), parseColor
// (#hex / rgb() → [r, g, b]), relative luminance and WCAG contrastRatio, onAccent / darkAccent (text and dark-scheme
// accents), DARK_BG. Full colour science (spaces, CSS parsing, ΔE, APCA, CVD, palettes) is in space.js, css.js,
// metrics.js, cvd.js, palette.js and swatches.js.
import { str } from '../util/value.js';

//
// Two layers on purpose: this file is the small dependency-free subset the document editors import (bundle size
// matters there), the other files are the full colour tool. Duplicated formulas (relative luminance, contrast) are
// the price of that split; both follow WCAG 2.x, so results agree to rounding.

// CSS color allowlist for user styles (prevents CSS injection).
// Allowlist, not escaping: the value is interpolated into a style attribute / stylesheet, where ';', '}', quotes,
// 'url(' or 'expression(' could open a new declaration or fetch. Accepted shapes contain none of those: #hex, a
// bare word (named colours, currentColor, transparent - invalid words are harmless, the browser drops them), and
// rgb()/hsl() whose body is restricted to digits, separators and angle units. Anything else -> '' (caller's default).
// color(), lab(), oklch() are refused by this filter even though they are safe - extend the regex, not the policy.
function safeColor(c) {
  c = str(c).trim();
  if (!c) return '';
  if (/^#[0-9a-f]{3,8}$/i.test(c) || /^[a-z]{3,24}$/i.test(c)) return c;
  if (/^(rgb|hsl)a?\((?:[\d\s.,%/+-]|deg|turn|g?rad)+\)$/i.test(c)) return c;
  return '';
}

/* ---------- colour contrast (WCAG 2.x) ----------
   Used to derive the dark-mode accent and the text colour drawn on accent backgrounds. Only #hex and rgb() are
   parsed (what the editor's colour inputs produce); anything else yields null and callers keep their fallbacks. */
// Hex: 3/4-digit forms expand per digit; 5/7-digit strings are rejected (no CSS meaning); alpha of 4/8-digit forms is
// dropped - contrast against an opaque page is computed as if the colour were opaque (an approximation).
// rgb(): percentages scale by 2.55, values clamp to 0..255; both comma and space syntax match via [\s,]+.
function parseColor(c) {
  c = str(c).trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(c);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  m = /^rgba?\(\s*([\d.]+)(%?)[\s,]+([\d.]+)(%?)[\s,]+([\d.]+)(%?)/.exec(c);
  if (m) return [[m[1], m[2]], [m[3], m[4]], [m[5], m[6]]].map(([v, p]) => Math.max(0, Math.min(255, Math.round(p ? +v * 2.55 : +v))));
  if (c === 'white') return [255, 255, 255];
  if (c === 'black') return [0, 0, 0];
  return null;
}

// WCAG 2.x relative luminance. 0.03928 is the threshold printed in WCAG 2.0 (the sRGB standard says 0.04045); the
// difference changes no 8-bit value's result, and matching WCAG keeps ratios identical to checker tools.
function relLum(rgb) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

// Contrast ratio (1..21) of two colours; NaN when either cannot be parsed.
function contrastRatio(a, b) {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return NaN;
  const l1 = relLum(x);
  const l2 = relLum(y);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const toHex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const DARK_BG = '#16191e';

// Text colour for an accent background: white or near-black, whichever contrasts more; '' when unparseable.
// #111827 rather than pure black: softer on screens, at a small contrast cost (ratio vs white 17.7 instead of 21). Ties -> white.
// DARK_BG is the dark-scheme page background the darkAccent search measures against.
function onAccent(c) {
  if (!parseColor(c)) return '';
  return contrastRatio('#ffffff', c) >= contrastRatio('#111827', c) ? '#fff' : '#111827';
}

// Dark-mode accent: the accent mixed toward white (sRGB) by the smallest t in .35, .40 … that reaches 4.5:1 on the
// dark page background; '' when the colour cannot be parsed.
// Why mix toward white instead of raising OKLCH lightness: keeps the hue family recognisable with trivial maths, and
// the starting point .35 makes even already-light accents a bit lighter, so dark mode looks consistently tinted.
// If no step reaches 4.5:1 the loop ends at t = 1 (pure white) - always passing, hue lost.
function darkAccent(c) {
  const rgb = parseColor(c);
  if (!rgb) return '';
  let out = '';
  for (let k = 7; k <= 20; k++) {
    const t = k / 20;
    out = toHex(rgb.map((v) => v + (255 - v) * t));
    if (contrastRatio(out, DARK_BG) >= 4.5) break;
  }
  return out;
}

export {
  DARK_BG,
  contrastRatio,
  darkAccent,
  onAccent,
  parseColor,
  safeColor
};
