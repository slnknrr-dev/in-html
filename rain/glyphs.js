// rain/glyphs.js - glyph sets of the digital rain and the resolution of a parameter set into the engine's glyph string.

// Half-width katakana U+FF66..U+FF9D (the film's rain mixes them, mirrored, with digits and a few symbols).
const KATA = Array.from({ length: 0xff9d - 0xff66 + 1 }, (_, i) => String.fromCharCode(0xff66 + i)).join('');

export const GLYPH_SETS = {
  kata: KATA,
  latin: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  binary: '01',
  hex: '0123456789ABCDEF',
  symbols: ':."=*+-<>¦|_╌※∴',
  cyrillic: 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЭЮЯ',
  emoji: '💚🟩⚡🔋💾🧬👾🛸🌌🌀',
  custom: '',
};
export const SET_KEYS = Object.keys(GLYPH_SETS);

// Pictographic characters plus their joiners / variation selectors (stripped unless the emoji set is enabled:
// colour emoji ignore the glyph colour and break the look).
// Colour emoji render from their own bitmap palette, so fillStyle tinting and the glow trail cannot recolour them;
// they are allowed only when the user explicitly enables the emoji set.
const EMOJI_RE = /\p{Extended_Pictographic}|\u200d|\ufe0f|[\u{1f1e6}-\u{1f1ff}]|[\u{1f3fb}-\u{1f3ff}]/gu;
export const stripEmoji = (s) => String(s || '').replace(EMOJI_RE, '');

// Grapheme clusters (emoji sequences stay whole) with a code-point fallback.
// Intl.Segmenter keeps ZWJ sequences and flags as one glyph (a family emoji is one cell, not five); Array.from by
// code point is the fallback for engines without it.
export function graphemes(s) {
  s = String(s || '');
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) return Array.from(new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(s), (x) => x.segment);
  } catch { /* no segmenter */ }
  return Array.from(s);
}

// The glyph string of a parameter set: the union of the enabled sets and the custom text, without whitespace and
// duplicates, emoji only when allowed; never empty.
// Capped at 160 glyphs: the atlas grows with glyphs x tones, and beyond ~160 the variety is no longer perceptible.
export function glyphChars(p = {}) {
  const sets = Array.isArray(p.sets) ? p.sets : String(p.sets || '').split(',');
  const emoji = sets.includes('emoji');
  let s = '';
  for (const k of sets) {
    if (k === 'custom') s += emoji ? String(p.custom || '') : stripEmoji(p.custom);
    else if (GLYPH_SETS[k] != null) s += GLYPH_SETS[k];
  }
  const out = [], seen = new Set();
  for (const g of graphemes(s)) {
    if (!g.trim() || seen.has(g)) continue;
    seen.add(g);
    out.push(g);
    if (out.length >= 160) break;
  }
  return out.length ? out.join('') : GLYPH_SETS.binary;
}
