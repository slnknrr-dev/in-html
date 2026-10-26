// pdf/font.js - font handles of a PDF document and text shaping over a fallback stack: every code point goes to the
// first font that has a glyph for it (so a stack [NotoSans, NotoSansGeorgian] sets mixed Latin / Cyrillic / Georgian
// text), runs of one font are measured in 1/1000 em, and the glyphs that were drawn are remembered for subsetting,
// the /W widths and the ToUnicode map. No complex shaping (ligatures, contextual forms, bidi): fine for Latin,
// Cyrillic, Greek, Armenian, Georgian; Arabic or Indic scripts need a shaping engine this module does not have.
//
//   new TrueTypeFont(parsedTTF, res)   new StandardFont(name, res)     (created by PDFDocument.addFont / addStandardFont)
//   font.has(cp)  font.glyph(cp) -> id  font.advance(id) -> 1/1000 em   font.ascent / descent / lineGap / capHeight
//   shapeText(text, fonts) -> [{ font, glyphs, cps, width }]   (width in 1/1000 em, unscaled)
//   measureText(text, fonts, size) -> points                     lineMetrics(fonts, size) -> { ascent, descent, gap, height }
//   cleanText(text) -> NFC text without control / zero-width characters (tabs become spaces)
//   fontList(f) -> array of handles (a handle or an array)

import { standardMetrics, standardWidth, winAnsiCode } from './standard.js';

// Both font classes expose the same small interface (has / glyph / advance / mark / encode), so shaping and layout
// never branch on font kind. `used` records glyph -> source text: it is both the subset list and the data for the
// ToUnicode CMap, which is what makes the PDF's text searchable and copyable.
// Identity-H + 2-byte glyph ids: no encoding table is needed for any script, at the cost of 4 hex digits per glyph.
export class TrueTypeFont {
  constructor(ttf, res) {
    this.kind = 'truetype';
    this.ttf = ttf;
    this.res = res;
    this.name = ttf.postscriptName;
    this.ascent = ttf.ascent; this.descent = ttf.descent; this.lineGap = ttf.lineGap;
    this.capHeight = ttf.capHeight; this.xHeight = ttf.xHeight;
    this.used = new Map(); // glyph id -> text it stands for (ToUnicode)
  }
  has(cp) { return this.ttf.gidFor(cp) > 0; }
  glyph(cp) { return this.ttf.gidFor(cp); }
  advance(g) { return this.ttf.widthOf(g); }
  mark(g, cp) { if (!this.used.has(g)) this.used.set(g, String.fromCodePoint(cp)); }
  // The bytes of a text-showing string: 2-byte glyph ids (Identity-H).
  encode(glyphs) { let h = '<'; for (const g of glyphs) h += g.toString(16).padStart(4, '0'); return h + '>'; }
}

export class StandardFont {
  constructor(name, res) {
    this.kind = 'standard';
    this.name = name;
    this.res = res;
    const m = standardMetrics(name);
    this.ascent = m.ascent; this.descent = m.descent; this.lineGap = 0; this.capHeight = m.capHeight; this.xHeight = m.xHeight; this.bbox = m.bbox;
    this.used = new Map();
  }
  has(cp) { return winAnsiCode(cp) > 0; }
  glyph(cp) { return winAnsiCode(cp) || 63; } // '?' for what WinAnsi cannot encode
  advance(code) { return standardWidth(this.name, code); }
  mark(code, cp) { if (!this.used.has(code)) this.used.set(code, String.fromCodePoint(cp)); }
  // PDF literal string: '(' ')' '\' must be escaped, non-printable bytes as 3-digit octal - keeps the content stream
  // pure ASCII (safe to inspect and diff) at no cost to readers.
  encode(codes) {
    let s = '(';
    for (const b of codes) {
      if (b === 0x28 || b === 0x29 || b === 0x5c) s += '\\' + String.fromCharCode(b);
      else if (b < 0x20 || b > 0x7e) s += '\\' + b.toString(8).padStart(3, '0');
      else s += String.fromCharCode(b);
    }
    return s + ')';
  }
}

export const fontList = (f) => (Array.isArray(f) ? f.filter(Boolean) : f ? [f] : []);

// Control characters (tab excepted, it becomes a space), soft hyphen, zero-width space/joiners, word joiner and BOM:
// they have no glyph, would render as .notdef boxes, and break measurement. NFC first so "e + combining acute"
// uses the precomposed glyph that fonts actually have.
const INVISIBLE = /[\u0000-\u0008\u000a-\u001f\u007f­​-‍⁠﻿]/g;
export const cleanText = (text) => String(text ?? '').normalize('NFC').replace(/\t/g, ' ').replace(INVISIBLE, '');

// Per-code-point font selection (first font that has the glyph), with adjacent code points of the same font merged
// into runs - one Tf/Tj pair per run in the content stream. Iterating `for..of` walks code points, so astral
// characters (emoji, historic scripts) are looked up whole.
export function shapeText(text, fonts) {
  const list = fontList(fonts);
  if (!list.length) throw new Error('PDF: no font to set text with');
  const runs = [];
  for (const ch of cleanText(text)) {
    const cp = ch.codePointAt(0);
    let font = list.find((f) => f.has(cp)) || list[0];
    const g = font.glyph(cp);
    const prev = runs[runs.length - 1];
    const w = font.advance(g);
    // A missing glyph stays visible (.notdef box or '?'): silently dropping it would change the text.
    if (prev && prev.font === font) { prev.glyphs.push(g); prev.cps.push(cp); prev.width += w; }
    else runs.push({ font, glyphs: [g], cps: [cp], width: w });
  }
  return runs;
}

export function measureText(text, fonts, size = 12, { charSpacing = 0 } = {}) {
  let w = 0, n = 0;
  for (const r of shapeText(text, fonts)) { w += r.width; n += r.glyphs.length; }
  return (w * size) / 1000 + charSpacing * n;
}

// Extremes over the whole stack, not the first font: a line that might contain Georgian must reserve Georgian's
// taller ascent, otherwise lines overlap when a fallback glyph appears.
export function lineMetrics(fonts, size = 12) {
  const list = fontList(fonts);
  const ascent = Math.max(...list.map((f) => f.ascent)), descent = Math.min(...list.map((f) => f.descent));
  const gap = Math.max(...list.map((f) => f.lineGap || 0));
  return { ascent: (ascent * size) / 1000, descent: (descent * size) / 1000, gap: (gap * size) / 1000, height: ((ascent - descent + gap) * size) / 1000 };
}
