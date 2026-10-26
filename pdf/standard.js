// pdf/standard.js - the non-embedded standard fonts every PDF reader has (Helvetica, Helvetica-Bold, Courier,
// Courier-Bold) with WinAnsi (cp1252) encoding and Adobe AFM advance widths. They cover Latin-1 only: Cyrillic or
// Georgian text needs an embedded TrueType font (font.js), with a standard font as the last fallback at most.
//
//   STANDARD_FONTS                    names accepted by doc.addStandardFont(name)
//   winAnsiCode(cp) -> byte | 0       (0: not encodable)
//   standardWidth(name, code) -> advance in 1/1000 em
//   standardMetrics(name) -> { ascent, descent, capHeight, xHeight, bbox }

export const STANDARD_FONTS = ['Helvetica', 'Helvetica-Bold', 'Courier', 'Courier-Bold'];

// cp1252 codes of the 0x80-0x9f range.
const CP1252 = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f };

// cp1252 equals Latin-1 for 0x20..0x7e and 0xa0..0xff; only 0x80..0x9f differ (Latin-1 has C1 controls there,
// cp1252 typographic characters). A few typographic spaces and the minus sign are folded to their nearest WinAnsi
// glyph instead of becoming '?'. 0 means "not encodable" (0x00 is never a valid text code here).
export function winAnsiCode(cp) {
  if (cp >= 0x20 && cp < 0x7f) return cp;
  if (cp >= 0xa0 && cp <= 0xff) return cp;
  if (CP1252[cp]) return CP1252[cp];
  if (cp === 0x2212) return 0x2d; // minus sign -> hyphen-minus
  if (cp === 0x202f || cp === 0x2009 || cp === 0x2007) return 0x20;
  return 0;
}

// Helvetica / Helvetica-Bold widths for 32..126 (Adobe AFM).
const HW = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HBW = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
// Base letters of 0xc0..0xff (accented letters take the width of their base letter).
const LATIN1_BASE = 'AAAAAAACEEEEIIIIDNOOOOOxOUUUUYPsaaaaaaaceeeeiiiidnooooo/ouuuuypy';

// Exact AFM widths for ASCII, approximations above it (accented letters = width of their base letter, which is how
// Helvetica's AFM actually defines most of them). The reader draws with ITS OWN font metrics regardless; these
// numbers only drive line breaking here, so a small error shifts a wrap point, never misplaces glyphs - except that
// the /Widths array written from them is what readers use to position glyphs, so keep them close to the AFM.
export function standardWidth(name, code) {
  if (/^Courier/.test(name)) return 600;
  const t = name === 'Helvetica-Bold' ? HBW : HW;
  if (code >= 32 && code <= 126) return t[code - 32];
  if (code === 0x95) return 350;
  if (code === 0x96) return 556;
  if (code === 0x97 || code === 0x89) return 1000;
  if (code === 0x80) return 556;
  if (code === 0x85) return 1000;
  if (code >= 0x91 && code <= 0x94) return code < 0x93 ? 222 : 333;
  if (code === 0xa0) return 278;
  if (code >= 0xc0) { const base = LATIN1_BASE.charCodeAt(code - 0xc0); return t[base - 32] || 556; }
  return name === 'Helvetica-Bold' ? 611 : 556;
}

export function standardMetrics(name) {
  if (/^Courier/.test(name)) return { ascent: 629, descent: -157, capHeight: 562, xHeight: 426, bbox: [-23, -250, 715, 805] };
  return { ascent: 718, descent: -207, capHeight: 718, xHeight: 523, bbox: name === 'Helvetica-Bold' ? [-170, -228, 1003, 962] : [-166, -225, 1000, 931] };
}
