// stitch/pdfdoc.js - a small PDF 1.5 writer for charts: objects with exact cross-reference offsets, Flate-compressed
// streams (codec/zlib.js), the standard Helvetica fonts with WinAnsi text and their metrics, Type 3 fonts built from
// vector paths (chart symbols stay text that chart readers can parse), RGB images and 1-bit image masks (text in
// scripts the standard fonts lack, rasterized by the caller), transparency states, and a structural inspector.
//
//   const doc = new PDFDoc({ compress, title, author, subject, creator })
//   doc.addPage(width, height, content (operators)) -> page object number (resources are shared by all pages)
//   doc.helvetica(bold) -> resource name ('F1' / 'F2')
//   doc.type3(glyphs: [{ name, d (SVG path, 100 × 100, y down), unicode }]) -> { res: 'F3', code(name) -> byte }
//   doc.image({ width, height, rgb: Uint8Array }) -> 'Im1'      doc.mask({ width, height, bits }) -> 'Im2'
//   doc.alpha(a) -> 'GS1' (fill / stroke opacity)
//   doc.finish() -> Uint8Array
//   winAnsi(text) -> bytes | null (null when a character has no WinAnsi code)
//   textWidth(text, size, bold) -> points (Helvetica metrics)
//   pdfString(bytes) -> '(…)' literal with escapes
//   transliterate(text) -> Latin text (Cyrillic, Georgian, Greek, Armenian) for labels without a raster hook
//   inspectPDF(bytes) -> { version, objects, pages, xrefOk, streams, fonts, type3Glyphs, images, text: [...] }

// Why a hand-written writer: a chart PDF needs only a handful of features, and a general library (pdf-lib, jsPDF)
// would outweigh the whole app and still need workarounds for symbol fonts. Key decisions:
// - Standard 14 fonts (Helvetica) are not embedded: every conforming reader has them, so text costs zero bytes. Their
//   limit is WinAnsi (cp1252); other scripts go through a raster hook (mask) or transliterate().
// - Chart symbols are a Type 3 font, not paths per cell: one glyph procedure per symbol, then each cell is 2 bytes
//   of text. A 100 x 100 chart drops from megabytes of path operators to tens of kilobytes, and text extraction /
//   search in the PDF yields symbol characters (via ToUnicode).
// - One shared /Resources dictionary for all pages: resources are global to the document here, so per-page
//   dictionaries would only repeat the same references. (addPage therefore takes no resource argument, despite the
// - Object bodies are strings; stream dicts are stored OPEN ('<< ...') and finish() appends ' >>' after /Length is
//   known. Offsets are counted in bytes of the latin1 output, which is why every string goes through latin1(), never
//   TextEncoder (UTF-8 would desynchronise the xref table).
import { zlibSync, unzlibSync } from '../codec/zlib.js';
import { pathCommands } from './symbols.js';

const enc = new TextEncoder();
// Strings here are byte strings (char codes 0..255); & 255 is a guard, not a conversion. n2: 2 decimals keep files
// small (0.01 pt is far below printer resolution); -0 is normalised because '-0' is ugly and some parsers reject it.
const latin1 = (s) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; };
const n2 = (v) => { const r = Math.round(v * 100) / 100; return Object.is(r, -0) ? '0' : String(r); };
export const num = n2;

// WinAnsi (cp1252) for the 0x80-0x9f range.
// Unicode code point -> cp1252 byte for the 0x80..0x9f block, where cp1252 differs from Latin-1.
const CP1252 = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f };
// Returns null instead of a lossy result on the first unmappable character: callers decide between a raster hook
// and transliteration, which they cannot do once '?' has been substituted. Exotic spaces become plain spaces.
export function winAnsi(text) {
  const s = String(text ?? '').replace(/[   ]/g, ' ');
  const out = new Uint8Array(s.length);
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c >= 0x20 && c < 0x7f) out[n++] = c;
    else if (c >= 0xa0 && c <= 0xff) out[n++] = c;
    else if (CP1252[c]) out[n++] = CP1252[c];
    else if (c === 0x2212) out[n++] = 0x2d; // minus
    else if (c === 0x00d7) out[n++] = 0xd7;
    else return null;
  }
  return out.slice(0, n);
}

// PDF literal string: parentheses and backslash escaped, non-printables as 3-digit octal. Escaping parens always
// (even when balanced) is simpler and always valid.
export function pdfString(bytes) {
  let s = '(';
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) s += '\\' + String.fromCharCode(b);
    else if (b < 0x20 || b > 0x7e) s += '\\' + b.toString(8).padStart(3, '0');
    else s += String.fromCharCode(b);
  }
  return s + ')';
}

// Helvetica / Helvetica-Bold advance widths (Adobe AFM) for 32..126; other characters use the width of 'n'.
// Tables indexed by code - 32. Needed for layout only (centering, right-aligned numbers, truncation): the reader
// renders with its own Helvetica, so metrics must match Adobe's AFM or text would overflow its box.
const HW = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HBW = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
// Accented Latin-1 letters (0xc0..0xff) take the width of their base letter via the lookup string (x for the
// multiplication sign, / for division, s for sharp s, P / p for thorn): close enough for layout, no extra table.
export function charWidth(code, bold) {
  const t = bold ? HBW : HW;
  if (code >= 32 && code <= 126) return t[code - 32];
  if (code === 0x95) return 350;
  if (code === 0x96) return 556;
  if (code === 0x97) return 1000;
  if (code >= 0xc0) { const base = 'AAAAAAACEEEEIIIIDNOOOOOxOUUUUYPsaaaaaaaceeeeiiiidnooooo/ouuuuypy'.charCodeAt(code - 0xc0); return t[base - 32] || 556; }
  return bold ? 611 : 556;
}
// Measures what will actually be written: WinAnsi bytes, else the transliteration. Units: AFM 1/1000 em times size.
export function textWidth(text, size, bold = false) {
  const b = typeof text === 'string' ? winAnsi(text) || latin1(transliterate(text)) : text;
  let w = 0;
  for (const c of b) w += charWidth(c, bold);
  return (w * size) / 1000;
}

// Latin transliteration of labels (when no raster hook is given).
// Practical transliteration (BGN-like for Cyrillic, national romanisation for Georgian), aimed at legibility of
// thread names, not reversibility. Lowercase is derived from uppercase keys; Georgian has no case, so it is lowercase.
const TR = {
  А: 'A', Б: 'B', В: 'V', Г: 'G', Ґ: 'G', Д: 'D', Е: 'E', Є: 'Ye', Ё: 'Yo', Ж: 'Zh', З: 'Z', И: 'I', І: 'I', Ї: 'Yi', Й: 'Y', К: 'K', Л: 'L', М: 'M', Н: 'N', О: 'O', П: 'P', Р: 'R', С: 'S', Т: 'T', У: 'U', Ф: 'F', Х: 'Kh', Ц: 'Ts', Ч: 'Ch', Ш: 'Sh', Щ: 'Shch', Ъ: '', Ы: 'Y', Ь: '', Э: 'E', Ю: 'Yu', Я: 'Ya',
  ა: 'a', ბ: 'b', გ: 'g', დ: 'd', ე: 'e', ვ: 'v', ზ: 'z', თ: 't', ი: 'i', კ: "k'", ლ: 'l', მ: 'm', ნ: 'n', ო: 'o', პ: "p'", ჟ: 'zh', რ: 'r', ს: 's', ტ: "t'", უ: 'u', ფ: 'p', ქ: 'k', ღ: 'gh', ყ: "q'", შ: 'sh', ჩ: 'ch', ც: 'ts', ძ: 'dz', წ: "ts'", ჭ: "ch'", ხ: 'kh', ჯ: 'j', ჰ: 'h',
  Α: 'A', Β: 'B', Γ: 'G', Δ: 'D', Ε: 'E', Ζ: 'Z', Η: 'I', Θ: 'Th', Ι: 'I', Κ: 'K', Λ: 'L', Μ: 'M', Ν: 'N', Ξ: 'X', Ο: 'O', Π: 'P', Ρ: 'R', Σ: 'S', Τ: 'T', Υ: 'Y', Φ: 'F', Χ: 'Ch', Ψ: 'Ps', Ω: 'O',
};
export function transliterate(text) {
  let out = '';
  for (const ch of String(text ?? '')) {
    if (winAnsi(ch)) { out += ch; continue; }
    const up = ch.toUpperCase();
    if (TR[ch] != null) out += TR[ch];
    else if (TR[up] != null) out += TR[up].toLowerCase();
    else {
      const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
      out += winAnsi(base) ? base : '?';
    }
  }
  return out;
}

// Type 3 glyph procedure of a symbol path (100 × 100 box, y down) in glyph space (y up).
// Symbol paths are y-down (SVG); PDF glyph space is y-up, hence box - y. Ends with f (non-zero fill), matching the
// symbols' non-zero winding, so holes drawn with reversed subpaths survive.
export function glyphOps(d, box = 100) {
  const ops = [];
  for (const [c, ...v] of pathCommands(d)) {
    if (c === 'M') ops.push(`${n2(v[0])} ${n2(box - v[1])} m`);
    else if (c === 'L') ops.push(`${n2(v[0])} ${n2(box - v[1])} l`);
    else if (c === 'C') ops.push(`${n2(v[0])} ${n2(box - v[1])} ${n2(v[2])} ${n2(box - v[3])} ${n2(v[4])} ${n2(box - v[5])} c`);
    else if (c === 'Z') ops.push('h');
  }
  return ops.join(' ') + ' f';
}

// Object numbers are allocated eagerly; catalog and pages tree are reserved first so their numbers are known while
// pages are added, and filled in by finish().
export class PDFDoc {
  constructor({ compress = true, title = '', author = '', subject = '', creator = 'in-html stitch' } = {}) {
    this.compress = compress;
    this.objects = [null]; // 1-based: strings or { dict, data }
    this.pages = [];
    this.fonts = {};
    this.info = { title, author, subject, creator };
    this.catalog = this.reserve();
    this.pagesObj = this.reserve();
    this.res = { font: 0, image: 0, gs: 0 };
    this.gsCache = new Map();
  }

  reserve() { this.objects.push(null); return this.objects.length - 1; }
  set(n, body) { this.objects[n] = body; return n; }
  add(body) { this.objects.push(body); return this.objects.length - 1; }

  // Streams under 64 bytes are stored raw: Flate's header and checksum would make them bigger.
  stream(dict, data, { compress = this.compress } = {}) {
    let bytes = typeof data === 'string' ? latin1(data) : data;
    let d = dict;
    if (compress && bytes.length > 64) { bytes = zlibSync(bytes, { level: 6 }); d += ' /Filter /FlateDecode'; }
    return this.add({ dict: d + ' /Length ' + bytes.length, data: bytes });
  }

  helvetica(bold = false) {
    const key = bold ? 'HB' : 'H';
    if (!this.fonts[key]) {
      const n = this.add(`<< /Type /Font /Subtype /Type1 /BaseFont /${bold ? 'Helvetica-Bold' : 'Helvetica'} /Encoding /WinAnsiEncoding >>`);
      this.fonts[key] = { res: 'F' + ++this.res.font, obj: n };
    }
    return this.fonts[key].res;
  }

  // A Type 3 font from vector glyphs: codes from 33 ('!') upward; ToUnicode maps them to look-alike characters.
  // Codes 33..252 (at most 220 glyphs, one byte each, skipping space and control codes). Glyphs past 220 are dropped
  // and code() returns undefined for them; callers keep palettes well below that.
  // d1 (not d0): the glyph declares a bounding box and is uncoloured, so the current fill colour paints it, which is
  // how one symbol font serves every thread colour.
  // Copy / search works through ToUnicode, 100 entries per bfchar block (the spec limit). KNOWN DEFECT: only the first
  // UTF-16 unit is written (slice(0, 4)), so a non-BMP look-alike becomes a lone high surrogate. Fix: emit the full
  // surrogate pair (bfchar allows up to 512 bytes of destination).
  // KNOWN DEFECT: FontMatrix goes through n2 (2 decimals), so 1 / box rounds to 0 for box > 200 and the font
  // collapses to nothing. Fix: format the matrix with more precision (e.g. String(1 / box)). Default box 100 is fine.
  type3(glyphs, { box = 100, name = 'StitchSymbols' } = {}) {
    const procs = [];
    const codes = new Map();
    glyphs.slice(0, 220).forEach((g, i) => {
      const code = 33 + i;
      codes.set(g.name, code);
      const n = this.stream('<<', `${box} 0 0 0 ${box} ${box} d1\n${glyphOps(g.d, box)}`);
      procs.push([g.name, n, code, g.unicode]);
    });
    const first = 33, last = 32 + procs.length;
    const widths = procs.map(() => box).join(' ');
    const diffs = procs.map(([nm]) => '/' + pdfName(nm)).join(' ');
    const cmapLines = procs.map(([, , code, u]) => `<${code.toString(16).padStart(2, '0')}> <${[...(u || '?')].map((c) => c.codePointAt(0).toString(16).padStart(4, '0')).join('').slice(0, 4).padStart(4, '0')}>`);
    const chunks = [];
    for (let i = 0; i < cmapLines.length; i += 100) chunks.push(`${Math.min(100, cmapLines.length - i)} beginbfchar\n${cmapLines.slice(i, i + 100).join('\n')}\nendbfchar`);
    const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /${name}-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<00> <ff>\nendcodespacerange\n${chunks.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
    const tu = this.stream('<<', cmap);
    const n = this.add(`<< /Type /Font /Subtype /Type3 /Name /${name} /FontBBox [0 0 ${box} ${box}] /FontMatrix [${n2(1 / box)} 0 0 ${n2(1 / box)} 0 0] ` +
      `/CharProcs << ${procs.map(([nm, o]) => '/' + pdfName(nm) + ' ' + o + ' 0 R').join(' ')} >> /Encoding << /Type /Encoding /Differences [${first} ${diffs}] >> ` +
      `/FirstChar ${first} /LastChar ${last} /Widths [${widths}] /Resources << >> /ToUnicode ${tu} 0 R >>`);
    const res = 'F' + ++this.res.font;
    this.fonts[name] = { res, obj: n };
    return { res, code: (nm) => codes.get(nm) };
  }

  // Always compressed (even tiny ones): raw RGB is the largest kind of data in the file.
  image({ width, height, rgb, interpolate = false }) {
    const n = this.stream(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Interpolate ${interpolate}`, rgb, { compress: true });
    const res = 'Im' + ++this.res.image;
    (this.images ||= {})[res] = n;
    return res;
  }

  // 1-bit stencil mask (1 = paint with the fill colour): bits are packed rows, MSB first.
  // /Decode [1 0] inverts the default sense, so a 1 bit paints (the natural meaning of "stitch here").
  mask({ width, height, bits }) {
    const n = this.stream(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ImageMask true /BitsPerComponent 1 /Decode [1 0]`, bits, { compress: true });
    const res = 'Im' + ++this.res.image;
    (this.images ||= {})[res] = n;
    return res;
  }

  // One ExtGState per distinct opacity (rounded to 2 decimals), shared across pages; ca = fill, CA = stroke.
  alpha(a) {
    const k = n2(a);
    if (!this.gsCache.has(k)) {
      const n = this.add(`<< /Type /ExtGState /ca ${k} /CA ${k} >>`);
      this.gsCache.set(k, { res: 'GS' + ++this.res.gs, obj: n });
    }
    return this.gsCache.get(k).res;
  }

  addPage(width, height, content) {
    const contents = this.stream('<<', content);
    const page = this.add({ page: true, width, height, contents });
    this.pages.push(page);
    return page;
  }

  // Order matters: shared resources first, then rewrite page placeholders into real page dicts, then fill the reserved
  // pages tree and catalog, then serialise with byte offsets. Dates in UTC with Z; strings outside WinAnsi go to the
  // Info dictionary as UTF-16BE with BOM (PDF text strings allow either encoding).
  // The second header line holds 4 bytes >= 128: the spec's hint to transfer tools that the file is binary.
  // xref entries are exactly 20 bytes ('nnnnnnnnnn ggggg n' + space + LF); inspectPDF relies on that fixed width.
  finish() {
    const fonts = Object.values(this.fonts).map((f) => `/${f.res} ${f.obj} 0 R`).join(' ');
    const images = Object.entries(this.images || {}).map(([r, n]) => `/${r} ${n} 0 R`).join(' ');
    const gs = [...this.gsCache.values()].map((g) => `/${g.res} ${g.obj} 0 R`).join(' ');
    const resources = `<< /ProcSet [/PDF /Text /ImageB /ImageC /ImageI]${fonts ? ' /Font << ' + fonts + ' >>' : ''}${images ? ' /XObject << ' + images + ' >>' : ''}${gs ? ' /ExtGState << ' + gs + ' >>' : ''} >>`;
    const resObj = this.add(resources);
    for (const p of this.pages) {
      const o = this.objects[p];
      this.objects[p] = `<< /Type /Page /Parent ${this.pagesObj} 0 R /MediaBox [0 0 ${n2(o.width)} ${n2(o.height)}] /Resources ${resObj} 0 R /Contents ${o.contents} 0 R >>`;
    }
    this.set(this.pagesObj, `<< /Type /Pages /Kids [${this.pages.map((p) => p + ' 0 R').join(' ')}] /Count ${this.pages.length} >>`);
    this.set(this.catalog, `<< /Type /Catalog /Pages ${this.pagesObj} 0 R /ViewerPreferences << /DisplayDocTitle true >> >>`);
    const d = new Date();
    const pad = (v) => String(v).padStart(2, '0');
    const date = `D:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
    const infoStr = (s) => { const w = winAnsi(s); return w ? pdfString(w) : utf16(s); };
    const info = this.add(`<< /Title ${infoStr(this.info.title)} /Author ${infoStr(this.info.author)} /Subject ${infoStr(this.info.subject)} /Creator ${infoStr(this.info.creator)} /Producer (in-html stitch PDF) /CreationDate (${date}) >>`);
    const parts = [];
    let len = 0;
    const push = (b) => { parts.push(b); len += b.length; };
    push(latin1('%PDF-1.5\n%\xe2\xe3\xcf\xd3\n'));
    const offsets = [];
    for (let i = 1; i < this.objects.length; i++) {
      offsets[i] = len;
      const o = this.objects[i];
      if (o && typeof o === 'object' && o.data) {
        push(latin1(`${i} 0 obj\n${o.dict} >>\nstream\n`));
        push(o.data);
        push(latin1('\nendstream\nendobj\n'));
      } else push(latin1(`${i} 0 obj\n${o == null ? 'null' : o}\nendobj\n`));
    }
    const xref = len;
    let x = `xref\n0 ${this.objects.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < this.objects.length; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    x += `trailer\n<< /Size ${this.objects.length} /Root ${this.catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    push(latin1(x));
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
}

// Name objects: anything outside a safe set is #xx-escaped (PDF 1.2+), so symbol ids cannot break the syntax.
const pdfName = (s) => String(s).replace(/[^A-Za-z0-9_.-]/g, (c) => '#' + c.charCodeAt(0).toString(16).padStart(2, '0'));
function utf16(s) {
  let h = 'feff';
  for (const ch of String(s ?? '')) {
    const c = ch.codePointAt(0);
    if (c > 0xffff) { const v = c - 0x10000; h += (0xd800 + (v >> 10)).toString(16) + (0xdc00 + (v & 1023)).toString(16); } else h += c.toString(16).padStart(4, '0');
  }
  return '<' + h + '>';
}

// --- inspection (tests, checks) ------------------------------------------------------------------------------------

const dec = (b) => { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; };

// A structural checker for tests, not a parser: it validates only files shaped like ours (one classic xref table,
// 20-byte entries, generation 0), checks that each xref offset really points at 'n 0 obj', decompresses streams and
// collects literal strings shown with Tj. It would misread incremental updates or xref streams, which we never write.
export function inspectPDF(bytes) {
  const text = dec(bytes);
  const version = (/^%PDF-(\d\.\d)/.exec(text) || [])[1] || null;
  const sx = text.lastIndexOf('startxref');
  const xrefAt = sx >= 0 ? parseInt(text.slice(sx + 9).trim(), 10) : -1;
  let xrefOk = text.slice(xrefAt, xrefAt + 4) === 'xref';
  const objs = new Map();
  if (xrefOk) {
    const m = /xref\s+0\s+(\d+)\s+/.exec(text.slice(xrefAt));
    const count = m ? +m[1] : 0;
    let p = xrefAt + m[0].length;
    for (let i = 0; i < count; i++) {
      const line = text.slice(p, p + 20);
      p += 20;
      const off = parseInt(line.slice(0, 10), 10);
      if (line[17] === 'n') {
        if (!text.startsWith(`${i} 0 obj`, off)) xrefOk = false;
        objs.set(i, off);
      }
    }
  }
  const body = (i) => { const off = objs.get(i); const end = text.indexOf('endobj', off); return text.slice(off, end); };
  let pages = 0, streams = 0, images = 0, type3Glyphs = 0, badStreams = 0;
  const fonts = new Set();
  const texts = [];
  for (const i of objs.keys()) {
    const b = body(i);
    if (/\/Type\s*\/Page\b/.test(b)) pages++;
    if (/\/Subtype\s*\/Image/.test(b)) images++;
    const bf = /\/BaseFont\s*\/([\w-]+)/.exec(b);
    if (bf) fonts.add(bf[1]);
    if (/\/Subtype\s*\/Type3/.test(b)) { fonts.add('Type3'); type3Glyphs += (b.match(/\/CharProcs\s*<<([^>]*)>>/) || ['', ''])[1].split(' R').length - 1; }
    const si = b.indexOf('stream\n');
    if (si >= 0) {
      streams++;
      const len = +((/\/Length (\d+)/.exec(b) || [])[1] || 0);
      const start = objs.get(i) + si + 7;
      let data = bytes.subarray(start, start + len);
      if (/\/FlateDecode/.test(b)) { try { data = unzlibSync(data); } catch { badStreams++; continue; } }
      if (!/\/Subtype\s*\/Image/.test(b)) {
        const s = dec(data);
        for (const m of s.matchAll(/\((?:\\.|[^\\)])*\)\s*Tj/g)) if (texts.length < 4000) texts.push(m[0].slice(1, m[0].lastIndexOf(')')));
      }
    }
  }
  return { version, objects: objs.size, xrefOk, pages, streams, badStreams, images, fonts: [...fonts], type3Glyphs, text: texts };
}

export { enc as utf8Encoder };
