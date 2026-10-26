// diagram/measure.js - text metrics without a DOM: an estimate of the advance width of a string in a proportional
// sans-serif font from character classes (narrow Latin, capitals, digits, Cyrillic, Georgian, Devanagari, full-width
// CJK / kana / Hangul, emoji), so layouts are the same in Node and browsers. A page may pass a real measurer
// (canvas measureText) instead.
//
//   textWidth(text, fontSize = 14, { bold }) -> px
//   labelLines(label) -> [line]          splits on '\n' and <br>
//   labelBox(label, { fontSize, lineHeight = 1.3, measure }) -> { w, h, lines }

//
// Why estimate instead of measuring: layout must be deterministic and DOM-free (Node tests, server pre-render,
// Workers). The factors are advance widths in em, averaged over common UI sans fonts; the error is a few percent,
// absorbed by node padding. Over-estimating is the safe side: a slightly wide box looks fine, text overflowing a
// box does not. A page that wants exact boxes passes measure = canvas measureText.
const NARROW = new Set('iljtfrI!|.,:;\'"`()[]{} ');
const WIDE = new Set('mwMWОДЖЩШЮФЫ@%');

// Order of tests is a cost/precision trade: explicit sets first (most specific), then the ASCII fast path, then
// script ranges. Combining marks (U+0300..036F) are 0 wide because they stack on the previous glyph.
// Full-width range covers Hangul Jamo, CJK radicals..CJK ideographs, Hangul syllables, compatibility ideographs and
// half/full-width forms: all render at ~1 em.
function charWidth(ch) {
  const c = ch.codePointAt(0);
  if (NARROW.has(ch)) return ch === ' ' ? 0.28 : 0.3;
  if (WIDE.has(ch)) return 0.86;
  if (c < 0x80) {
    if (ch >= 'A' && ch <= 'Z') return 0.66;
    if (ch >= '0' && ch <= '9') return 0.56;
    return 0.54;
  }
  if (c >= 0x0400 && c <= 0x04ff) return ch === ch.toUpperCase() ? 0.68 : 0.57; // Cyrillic
  if (c >= 0x10a0 && c <= 0x10ff) return 0.64; // Georgian
  if (c >= 0x0900 && c <= 0x097f) return 0.62; // Devanagari
  if ((c >= 0x1100 && c <= 0x11ff) || (c >= 0x2e80 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xffef)) return 1;
  if (c >= 0x1f000) return 1.15; // emoji and pictographs
  if (c >= 0x0300 && c <= 0x036f) return 0; // combining marks
  return 0.6;
}

// for…of iterates code points, not UTF-16 units: an emoji (surrogate pair) counts once, not twice.
// bold: +6%, a typical sans bold/regular width ratio.
export function textWidth(text, fontSize = 14, { bold = false } = {}) {
  let w = 0;
  for (const ch of String(text)) w += charWidth(ch);
  return w * fontSize * (bold ? 1.06 : 1);
}

export const labelLines = (label) => String(label == null ? '' : label).split(/\r?\n|<br\s*\/?>/i);

// A single empty line is "no label" (0x0), so edge labels that are absent do not reserve space in the layout.
export function labelBox(label, { fontSize = 14, lineHeight = 1.3, measure = textWidth, bold = false } = {}) {
  const lines = labelLines(label);
  const empty = lines.length === 1 && !lines[0];
  return {
    w: empty ? 0 : Math.max(...lines.map((l) => measure(l, fontSize, { bold }))),
    h: empty ? 0 : lines.length * fontSize * lineHeight,
    lines: empty ? [] : lines,
  };
}
