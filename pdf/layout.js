// pdf/layout.js - simple text layout over pdf/doc.js pages: word wrapping by measured widths (not character counts,
// so Russian and Georgian wrap right in proportional fonts), boxes with alignment (left / center / right / justify),
// line limits with an ellipsis, a font size that fits a width (price tags, labels), and a top-down flow with page
// breaks: paragraphs, headings, rules, images and tables whose rows wrap and whose header repeats on every page.
//
//   wrapText(text, fonts, size, width, { charSpacing, breakWords }) -> [{ text, width, end }]
//   textBox(page, text, { x, y, width, height, font, size, lineHeight, align, valign, maxLines, ellipsis, color, … })
//       -> { lines, height, overflow }        (y is the top of the box)
//   clipText(text, fonts, size, width, ellipsis = '…') -> text that fits one line
//   fitText(text, fonts, width, { max, min, height, step }) -> font size for one line
//   new Flow(doc, { size, landscape, margin, font, fontSize, lineHeight, color, header(page, flow), footer(page, i, n) })
//     .paragraph(text, opts) .heading(text, opts) .rule(opts) .space(h) .image(img, opts) .table(rows, opts)
//     .need(h) .newPage() .finish() -> doc         .page  .y  .x  .width  .left (space remaining on the page)

import { fontList, lineMetrics, measureText } from './font.js';

// Greedy line filling (first fit), not Knuth-Plass: predictable, linear, and good enough for documents without
// hyphenation dictionaries. Widths are measured with the real font stack, so a line never overflows in the PDF.
// `end` marks the last line of a paragraph - justification must leave it ragged. The 1e-6 tolerance stops a word
// that fits exactly from wrapping due to float noise. An over-long word is split greedily by code points
// (re-measuring each prefix: quadratic in the word length, fine for URLs and identifiers), preferring a break after
// '-' or '/'.
export function wrapText(text, fonts, size, width, { charSpacing = 0, breakWords = true } = {}) {
  const m = (s) => measureText(s, fonts, size, { charSpacing });
  const space = m(' ');
  const out = [];
  for (const para of String(text ?? '').split(/\r\n|\r|\n/)) {
    const words = para.split(/[ \t ]+/).filter((w) => w.length);
    if (!words.length) { out.push({ text: '', width: 0, end: true }); continue; }
    let line = '', lw = 0;
    const push = () => { out.push({ text: line, width: lw, end: false }); line = ''; lw = 0; };
    for (let word of words) {
      let ww = m(word);
      if (line && lw + space + ww <= width + 1e-6) { line += ' ' + word; lw += space + ww; continue; }
      if (line) push();
      if (ww > width + 1e-6 && breakWords) {
        // a word wider than the line: break it, preferring the position after a hyphen or slash
        while (ww > width + 1e-6) {
          const cps = [...word];
          let k = 1;
          while (k < cps.length && m(cps.slice(0, k + 1).join('')) <= width) k++;
          for (let j = k - 2; j > 0; j--) if (cps[j] === '-' || cps[j] === '/') { k = j + 1; break; }
          line = cps.slice(0, k).join(''); lw = m(line);
          push();
          word = cps.slice(k).join(''); ww = m(word);
          if (!word) break;
        }
        if (!word) continue;
      }
      line = word; lw = ww;
    }
    if (line) push();
    out[out.length - 1].end = true;
  }
  return out;
}

// Binary search over the number of code points kept (width is monotone in prefix length): O(log n) measurements
// instead of trimming one character at a time. Trailing spaces are removed before the ellipsis is attached.
export function clipText(text, fonts, size, width, ellipsis = '…') {
  const s = String(text ?? '');
  if (measureText(s, fonts, size) <= width) return s;
  const cps = [...s];
  let lo = 0, hi = cps.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (measureText(cps.slice(0, mid).join('').trimEnd() + ellipsis, fonts, size) <= width) lo = mid; else hi = mid - 1; }
  return lo ? cps.slice(0, lo).join('').trimEnd() + ellipsis : '';
}

// Text width is linear in font size, so one measurement at size 1 gives the exact fitting size - no search needed.
// Rounded DOWN to `step` so the result never overflows.
export function fitText(text, fonts, width, { max = 72, min = 4, height = 0, step = 0.5 } = {}) {
  const w1 = measureText(text, fonts, 1);
  let s = w1 > 0 ? width / w1 : max;
  if (height > 0) { const lm = lineMetrics(fonts, 1); s = Math.min(s, height / (lm.ascent - lm.descent)); }
  s = Math.floor(s / step) * step;
  return Math.max(min, Math.min(max, s));
}

// Box height = first line's ascent-to-descent + (n - 1) leadings, i.e. the ink extent, not n * leading - so a
// one-line box is exactly as tall as its text and vertical centring looks centred.
// KNOWN DEFECT: on overflow the last line is clipped as clipText(text + '…', ..., o.ellipsis || '…'); when that
// fits, the result ends in '…' even if a custom o.ellipsis (e.g. '...') was requested. Fix: append
// (o.ellipsis || '…') instead of the literal '…'.
export function textBox(page, text, o = {}) {
  const fonts = page.doc._fonts(o.font);
  const size = o.size ?? 12, width = o.width ?? page.width - (o.x || 0);
  const lm = lineMetrics(fonts, size);
  const leading = size * (o.lineHeight ?? 1.25);
  let lines = wrapText(text, fonts, size, width, o);
  let maxLines = o.maxLines ?? Infinity;
  if (o.height > 0) maxLines = Math.min(maxLines, Math.max(1, Math.floor((o.height - (lm.ascent - lm.descent)) / leading) + 1));
  let overflow = false;
  if (lines.length > maxLines) {
    overflow = true;
    lines = lines.slice(0, maxLines);
    const last = lines[lines.length - 1];
    if (o.ellipsis !== false) { last.text = clipText(last.text + '…', fonts, size, width, o.ellipsis || '…'); last.width = measureText(last.text, fonts, size); }
    last.end = true;
  }
  const height = lines.length ? lm.ascent - lm.descent + (lines.length - 1) * leading : 0;
  let y0 = o.y || 0;
  if (o.height > 0 && o.valign === 'middle') y0 += (o.height - height) / 2;
  else if (o.height > 0 && o.valign === 'bottom') y0 += o.height - height;
  const x = o.x || 0, align = o.align || 'left';
  const style = { font: fonts, size, color: o.color, charSpacing: o.charSpacing, opacity: o.opacity, underline: o.underline };
  lines.forEach((l, i) => {
    const by = y0 + lm.ascent + i * leading;
    if (align === 'justify' && !l.end) {
      const gaps = (l.text.match(/ /g) || []).length;
      page.text(l.text, x, by, { ...style, wordSpacing: gaps ? (width - l.width) / gaps : 0 });
    } else {
      const ax = align === 'right' ? x + width : align === 'center' ? x + width / 2 : x;
      page.text(l.text, ax, by, { ...style, align: align === 'justify' ? 'left' : align });
    }
  });
  return { lines: lines.map((l) => l.text), height, overflow };
}

const margins = (m) => {
  const a = Array.isArray(m) ? m : [m ?? 40];
  return a.length === 1 ? [a[0], a[0], a[0], a[0]] : a.length === 2 ? [a[0], a[1], a[0], a[1]] : [a[0], a[1], a[2] ?? a[0], a[3] ?? a[1]];
};

// A cursor (page, y) that moves down and breaks pages on demand: every block calls need(h) before drawing. need()
// never breaks at the very top of a page (y at the top margin), so a block taller than a page is drawn and overflows
// instead of looping on empty pages. Footers run in finish() because "page i of n" needs the final n.
export class Flow {
  constructor(doc, o = {}) {
    this.doc = doc;
    this.o = { fontSize: 11, lineHeight: 1.3, color: '#000', ...o };
    [this.mt, this.mr, this.mb, this.ml] = margins(o.margin);
    this.page = null;
    this.newPage();
  }
  get x() { return this.ml; }
  get width() { return this.page.width - this.ml - this.mr; }
  get bottom() { return this.page.height - this.mb; }
  get left() { return this.bottom - this.y; }

  newPage() {
    this.page = this.doc.addPage(this.o.size || 'A4', { landscape: !!this.o.landscape });
    this.y = this.mt;
    if (this.o.header) this.o.header(this.page, this);
    return this;
  }
  need(h) { if (this.left < h - 1e-6 && this.y > this.mt + 1e-6) { this.newPage(); return true; } return false; }
  space(h) { this.y += h; if (this.y > this.bottom) this.newPage(); return this; }

  paragraph(text, o = {}) {
    const fonts = this.doc._fonts(o.font || this.o.font);
    const size = o.size ?? this.o.fontSize;
    const indent = o.indent || 0, width = (o.width ?? this.width) - indent;
    const lm = lineMetrics(fonts, size), leading = size * (o.lineHeight ?? this.o.lineHeight);
    const lines = wrapText(text, fonts, size, width, o);
    const align = o.align || 'left';
    if (o.spaceBefore) this.y += o.spaceBefore;
    for (const l of lines) {
      this.need(leading);
      const by = this.y + lm.ascent + (leading - (lm.ascent - lm.descent)) / 2;
      const st = { font: fonts, size, color: o.color ?? this.o.color, link: o.link };
      if (align === 'justify' && !l.end) {
        const gaps = (l.text.match(/ /g) || []).length;
        this.page.text(l.text, this.x + indent, by, { ...st, wordSpacing: gaps ? (width - l.width) / gaps : 0 });
      } else {
        const ax = align === 'right' ? this.x + indent + width : align === 'center' ? this.x + indent + width / 2 : this.x + indent;
        this.page.text(l.text, ax, by, { ...st, align: align === 'justify' ? 'left' : align });
      }
      this.y += leading;
    }
    this.y += o.spaceAfter ?? size * 0.4;
    return this;
  }

  heading(text, o = {}) {
    const size = o.size ?? this.o.fontSize * 1.6;
    this.need(size * 3); // keep a heading with at least a line of what follows
    return this.paragraph(text, { lineHeight: 1.2, spaceBefore: this.y > this.mt + 1 ? size * 0.5 : 0, spaceAfter: size * 0.35, ...o, size, font: o.font || this.o.headingFont || this.o.font });
  }

  rule({ color = '#bbb', width = 0.5, space = 6 } = {}) {
    this.need(space * 2);
    this.y += space;
    this.page.line(this.x, this.y, this.x + this.width, this.y, { stroke: color, width });
    this.y += space;
    return this;
  }

  image(img, { width, height, align = 'left', spaceAfter = 6 } = {}) {
    let w = width ?? Math.min(this.width, img.width), h = height ?? (w * img.height) / img.width;
    if (h > this.bottom - this.mt) { h = this.bottom - this.mt; w = (h * img.width) / img.height; }
    this.need(h);
    const x = align === 'right' ? this.x + this.width - w : align === 'center' ? this.x + (this.width - w) / 2 : this.x;
    this.page.image(img, x, this.y, w, h);
    this.y += h + spaceAfter;
    return this;
  }

  // Rows are laid out (wrapped, measured) before drawing, so need(h) knows the full row height and a row is never
  // split across pages; when a break happens the header row is redrawn first. Limitation: a single row taller than a
  // page overflows the bottom margin (rows are atomic). Header rows are measured with the body font's line metrics.
  table(rows, o = {}) {
    const fonts = this.doc._fonts(o.font || this.o.font);
    const headFonts = o.headerFont ? fontList(o.headerFont) : fonts;
    const size = o.size ?? this.o.fontSize * 0.9, pad = o.padding ?? 4;
    const cols = Math.max(1, ...rows.map((r) => r.length));
    const ws = o.widths && o.widths.length === cols ? o.widths : new Array(cols).fill(1);
    const total = o.width ?? this.width;
    const sum = ws.reduce((a, b) => a + b, 0) || 1;
    const widths = ws.map((w) => (w / sum) * total);
    const lm = lineMetrics(fonts, size), leading = size * (o.lineHeight ?? 1.25);
    const header = o.header !== false && rows.length > 0;
    const border = o.border === undefined ? '#999' : o.border;
    const layoutRow = (cells, f) => {
      const wrapped = widths.map((w, c) => {
        const t = cells[c] == null ? '' : String(cells[c]);
        return o.wrap === false ? [{ text: clipText(t, f, size, w - pad * 2), width: 0 }] : wrapText(t, f, size, w - pad * 2);
      });
      const n = Math.max(1, ...wrapped.map((l) => l.length));
      return { wrapped, h: lm.ascent - lm.descent + (n - 1) * leading + pad * 2 };
    };
    const draw = (cells, isHead, zebra) => {
      const f = isHead ? headFonts : fonts;
      const { wrapped, h } = layoutRow(cells, f);
      if (this.need(h) && header && !isHead && o.repeatHeader !== false) { draw(rows[0], true, false); }
      const top = this.y;
      const fill = isHead ? o.headerFill ?? '#eee' : zebra ? o.zebraFill ?? '#f6f6f6' : null;
      if (fill) this.page.rect(this.x, top, total, h, { fill });
      let x = this.x;
      widths.forEach((w, c) => {
        const align = (o.align && o.align[c]) || 'left';
        wrapped[c].forEach((l, i) => {
          const by = top + pad + lm.ascent + i * leading;
          const ax = align === 'right' ? x + w - pad : align === 'center' ? x + w / 2 : x + pad;
          this.page.text(l.text, ax, by, { font: f, size, align, color: isHead ? o.headerColor ?? this.o.color : o.color ?? this.o.color });
        });
        x += w;
      });
      if (border) {
        const st = { stroke: border, width: o.borderWidth ?? 0.5 };
        this.page.rect(this.x, top, total, h, { ...st, fill: null });
        let gx = this.x;
        for (let c = 0; c < cols - 1; c++) { gx += widths[c]; this.page.line(gx, top, gx, top + h, st); }
      }
      this.y = top + h;
    };
    rows.forEach((r, i) => draw(r, header && i === 0, o.zebra && i % 2 === 0 && !(header && i === 0)));
    this.y += o.spaceAfter ?? 8;
    return this;
  }

  finish() {
    if (this.o.footer) this.doc.pages.forEach((p, i, all) => this.o.footer(p, i, all.length));
    return this.doc;
  }
}
