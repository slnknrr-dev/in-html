// price-tags/tag.js - one shelf tag as SVG in millimetres (viewBox = the tag size, so a sheet prints at true size):
// five templates (classic, promo yellow, minimal, wobbler, shelf-edge strip), names wrapped and shrunk to their box
// (canvas text metrics), the price with small decimals and the currency symbol, the struck old price, the "−20 %"
// badge, the unit price, origin, date / print code, and an EAN-13 / Code 128 (barcode/linear.js laid out by
// barcode/svg.js) or GS1 DataMatrix (barcode/datamatrix.js) code. Words printed on the tag follow the tag language
// (ka / ru / en), not the interface language.
//
// Design rules:
// - Output is an SVG string, not DOM: the same function feeds the live preview (innerHTML), thumbnails, the A4 sheet
//   and file export, and a string is trivially serialisable. Every interpolated text goes through esc(); numbers go
//   through r3() (3 decimals = 1 micrometre, far below printer resolution, and keeps markup short and diff-stable).
// - Units are millimetres in user space (viewBox = W x H). Font sizes are given in typographic points by the user and
//   converted with PT (1 pt = 0.3528 mm), so "34 pt price" means the same physical size on any tag.
// - Layout is measured, not guessed: canvas measureText at a 100px reference size, scaled linearly. Text shrinks to fit
//   its box rather than overflowing paper that cannot scroll. Fallback without a document (Node tests): 0.56 em per
//   character, a typical average advance for sans fonts.
// - Colours are raw hex: the tag is paper, independent of the UI theme (see app.css CONTRACT).
import { encode } from '../barcode/linear.js';
import { barcodeLayout } from '../barcode/svg.js';
import { dataMatrix } from '../barcode/datamatrix.js';
import { toGtin14 } from '../barcode/gtin.js';
import { dayText, money, moneyCur, unitText } from './common.js';

const PT = 0.3528;    // mm per typographic point
// Font stacks with Georgian coverage in each (Noto * Georgian, BPG Arial, Sylfaen): system-ui alone has no Mkhedruli
// glyphs on many Windows/Linux setups and the name would fall back to a mismatched font mid-line. No web fonts: the
// app must print offline from file://.
export const FAMILIES = {
  sans: "system-ui, 'Segoe UI', 'Noto Sans Georgian', 'BPG Arial', Roboto, Arial, sans-serif",
  condensed: "'Arial Narrow', 'Roboto Condensed', 'Noto Sans Georgian', 'Segoe UI', sans-serif",
  serif: "Georgia, 'Noto Serif Georgian', 'Sylfaen', 'Times New Roman', serif",
};
const MONO = "ui-monospace, Consolas, 'DejaVu Sans Mono', monospace";

// Words on the tag, by tag language. Kept here rather than in strings.js: those follow the UI language, while a tag
// printed for a Georgian shelf must say აქცია even when the operator's UI is English. '{d}' is a date placeholder;
// word order differs per language ('{d}-მდე' vs 'until {d}'), hence a template rather than concatenation.
export const WORDS = {
  ka: { sale: 'აქცია', markdown: 'ფასდაკლება', best: 'ვარგისია', until: '{d}-მდე', kg: 'კგ', l: 'ლ' },
  ru: { sale: 'АКЦИЯ', markdown: 'УЦЕНКА', best: 'Годен до', until: 'до {d}', kg: 'кг', l: 'л' },
  en: { sale: 'SALE', markdown: 'REDUCED', best: 'Best before', until: 'until {d}', kg: 'kg', l: 'l' },
};
const word = (lang, k, d) => (WORDS[lang] || WORDS.en)[k].replace('{d}', d ?? '');

// XML escape for text and double-quoted attributes. "'" is not escaped because every attribute here is double-quoted.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const r3 = (n) => Math.round(n * 1000) / 1000;
// U+2212 MINUS SIGN, not hyphen-minus: same width as '+' and digits, typographically correct for "-20 %".
const MINUS = '−';
export const badgeText = (pct) => `${MINUS}${pct} %`;

// --- text metrics -------------------------------------------------------------------------------------------------

// One lazily created 2D context reused for all measurements (creating a canvas per call is costly; wrap() calls this
// hundreds of times per tag). Measures at 100px and scales: avoids sub-pixel font sizes (a 3 mm font is ~11px), where
// engines round metrics and widths become inaccurate. Caveat: measureText uses whatever font the browser resolved;
// if a font in the stack is still loading, widths come from a fallback.
let ctx = null;
export function measure(text, size, weight = 400, family = FAMILIES.sans) {
  if (!ctx && typeof document !== 'undefined') ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return [...String(text)].length * size * 0.56;
  ctx.font = `${weight} 100px ${family}`;
  return ctx.measureText(String(text)).width * size / 100;
}

// Greedy word wrap into `maxLines` lines of `width`, shrinking the size down to 70 % before cutting with an ellipsis.
// Why greedy (first-fit) and not optimal (Knuth-Plass): 2-3 short lines, raggedness is invisible, and greedy is O(n)
// per try. Shrink loop: x0.93 per step until it fits or reaches 70 % (below that a product name becomes unreadable at
// shelf distance); only then truncate with '…', trimming characters until the ellipsis fits.
// Over-long single words (Georgian compounds, URLs) are broken by characters: the inner loop finds the longest prefix
// that fits on the current line, or flushes the line first if even a short prefix does not fit after it.
export function wrap(text, width, size, maxLines, weight, family) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { lines: [], size };
  const lay = (s) => {
    const lines = [];
    let cur = '';
    for (let w of words) {
      // A word wider than the line is split by characters.
      while (measure(w, s, weight, family) > width && w.length > 1) {
        let k = w.length - 1;
        while (k > 1 && measure((cur ? cur + ' ' : '') + w.slice(0, k), s, weight, family) > width) k--;
        if (cur && measure(cur + ' ' + w.slice(0, k), s, weight, family) > width) { lines.push(cur); cur = ''; continue; }
        lines.push((cur ? cur + ' ' : '') + w.slice(0, k)); cur = ''; w = w.slice(k);
      }
      const next = cur ? cur + ' ' + w : w;
      if (measure(next, s, weight, family) <= width || !cur) cur = next;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
  };
  let s = size, lines = lay(s);
  while (lines.length > maxLines && s > size * 0.7) { s *= 0.93; lines = lay(s); }
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    let last = lines[maxLines - 1];
    while (last.length > 1 && measure(last + '…', s, weight, family) > width) last = last.slice(0, -1);
    lines[maxLines - 1] = last.replace(/\s+$/, '') + '…';
  }
  return { lines, size: s };
}

function textEl(x, y, s, size, { anchor = 'start', weight = 400, fill = '#111', family, cls = '', style = '' } = {}) {
  return `<text x="${r3(x)}" y="${r3(y)}" font-size="${r3(size)}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${family ? ` font-family="${esc(family)}"` : ''}${cls ? ` class="${cls}"` : ''}${style ? ` font-style="${style}"` : ''}>${esc(s)}</text>`;
}

// Fits one line: shrinks the size until the text fits `width`. Closed form, not a loop: width is linear in font size,
// so size = width / (width at size 1). max(0.01) guards empty text (zero width -> division by zero).
const fitSize = (s, width, size, weight, family) => Math.min(size, width / Math.max(0.01, measure(s, 1, weight, family)));

// --- price parts --------------------------------------------------------------------------------------------------

// The price as tspans: big whole part, small raised decimals (D.cents 'small') and the symbol; an optional per-unit
// suffix ('/kg'). -> { svg (inner of <text>), width (mm at size P) }
// The split is at the LAST decimal mark of the formatted string, so group separators never confuse it. Vertical
// offsets use relative dy: each part's dy = (previous up - this up) * P, so raised decimals go up and the following
// symbol comes back to the baseline without absolute y bookkeeping. The width is summed from per-part measurements,
// because the caller needs it to fit the price before emitting (SVG gives no layout feedback in a string).
function priceParts(minor, D, P, weight, family, suffix = '') {
  const txt = money(minor, D);
  const i = txt.lastIndexOf(D.decimal);
  const whole = i >= 0 ? txt.slice(0, i) : txt, frac = i >= 0 ? txt.slice(i) : '';
  const small = D.cents === 'small' && frac;
  const sym = D.symbol;
  const before = D.symbolPos === 'before';
  // up: raise above the baseline in units of P (the decimals); the parts after them return to the baseline.
  const parts = [];
  if (before && sym) parts.push({ s: sym + ' ', k: 0.5, up: 0, w: weight });
  if (small) parts.push({ s: whole, k: 1, up: 0, w: weight }, { s: frac.slice(1), k: 0.5, up: 0.38, w: weight });
  else parts.push({ s: whole + frac, k: 1, up: 0, w: weight });
  if (!before && sym) parts.push({ s: ' ' + sym, k: 0.42, up: 0, w: weight });
  if (suffix) parts.push({ s: '/' + suffix, k: 0.32, up: 0, w: 400 });
  let cur = 0, width = 0, svg = '';
  for (const p of parts) {
    const size = P * p.k, dy = (cur - p.up) * P;
    cur = p.up;
    width += measure(p.s, size, p.w, family);
    svg += `<tspan font-size="${r3(size)}" font-weight="${p.w}"${dy ? ` dy="${r3(dy)}"` : ''}>${esc(p.s)}</tspan>`;
  }
  return { svg, width };
}

// The price as one <text> anchored at x; shrinks to maxW. -> { svg, width, size }
// One proportional rescale suffices (width is linear in P). data-v carries the minor-unit value so tests can read
// the price without parsing locale-formatted text. letter-spacing -0.02em: large digits look loose at display sizes.
function priceEl(x, y, minor, D, P, maxW, { anchor = 'end', fill = '#111', weight = 800, family, suffix = '' } = {}) {
  let p = priceParts(minor, D, P, weight, family, suffix);
  if (p.width > maxW) { P = P * maxW / p.width; p = priceParts(minor, D, P, weight, family, suffix); }
  return { svg: `<text class="pt-price" data-v="${minor}" x="${r3(x)}" y="${r3(y)}" fill="${fill}" text-anchor="${anchor}" font-family="${esc(family)}" letter-spacing="-0.02em">${p.svg}</text>`, width: p.width, size: P };
}

// Old price with a strike line (a line, not text-decoration, so every SVG renderer draws it).
// The line is slightly diagonal (rising +-0.12 size) and overshoots the text by 0.08 size each side: a crossed-out
// price reads at a glance, and a strictly horizontal line at x-height can be mistaken for a minus or underline.
function oldEl(x, y, minor, D, size, { anchor = 'end', fill = '#444', strike = '#d61f26', family } = {}) {
  const s = money(minor, D);
  const w = measure(s, size, 600, family);
  const x1 = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
  const ly = y - size * 0.32;
  return `<g class="pt-old" data-v="${minor}">${textEl(x, y, s, size, { anchor, weight: 600, fill, family })}`
    + `<line x1="${r3(x1 - size * 0.08)}" y1="${r3(ly + size * 0.12)}" x2="${r3(x1 + w + size * 0.08)}" y2="${r3(ly - size * 0.12)}" stroke="${strike}" stroke-width="${r3(Math.max(0.25, size * 0.09))}" stroke-linecap="round"/></g>`;
}

function badgeRect(x, y, pct, size, fill, color, family, anchor = 'end') {
  const s = badgeText(pct);
  const w = measure(s, size, 800, family) + size * 0.7, hgt = size * 1.35;
  const x0 = anchor === 'end' ? x - w : x;
  return { w, h: hgt, svg: `<g class="pt-badge"><rect x="${r3(x0)}" y="${r3(y)}" width="${r3(w)}" height="${r3(hgt)}" rx="${r3(hgt * 0.22)}" fill="${fill}"/>${textEl(x0 + w / 2, y + hgt * 0.74, s, size, { anchor: 'middle', weight: 800, fill: color, family })}</g>` };
}

// --- codes --------------------------------------------------------------------------------------------------------

// Linear barcode choice: EAN-8 / UPC-A / EAN-13 by digit count (13 and 14-digit inputs try EAN-13); if the EAN encoder
// rejects it (bad check digit, wrong length), fall back to Code 128 of the raw value, then of the shop code. A tag
// with a scannable Code 128 beats a tag with no code; null only when nothing encodes.
function linearSymbol(tag, D) {
  const digits = String(tag.ean || '').replace(/\D/g, '');
  if (D.barcode === 'ean' && digits) {
    const types = digits.length === 8 ? ['ean8'] : digits.length === 12 ? ['upca'] : ['ean13'];
    for (const ty of types) { try { return encode(ty, digits); } catch { /* falls back to Code 128 */ } }
  }
  const v = tag.ean || tag.code;
  if (!v) return null;
  try { return encode('code128', v); } catch { return null; }
}

/** Code drawn into the box (x, y, w, h) in mm, bottom-aligned and centred. -> { svg, xdim, kind } | null
 * DataMatrix: GS1 element string (01) GTIN-14 + (17) expiry YYMMDD when the tag is marked down, so a till scanning it
 * can enforce the date; plain data when no GTIN. Module size capped at 0.6 mm; 2-module quiet zone each side (n + 4).
 * Dark modules are merged into horizontal runs, one subpath per run: far fewer path commands than one per module.
 * Linear: laid out once at a reference height to learn the module width k (capped at 0.4 mm; EAN nominal X is 0.33),
 * then re-laid out with bar height filling the box (8..70 modules), and the final scale kk also respects box height.
 * Both kinds paint a white background rect under the code (quiet zone stays white on the yellow promo template) and
 * use shape-rendering=crispEdges so bar edges snap to device pixels instead of anti-aliasing into grey.
 * xdim (mm per module) is returned so the designer can warn when it falls below a scanner's resolution.
 */
export function codeBox(tag, D, x, y, w, h) {
  if (D.barcode === 'none' || w < 6 || h < 4) return null;
  if (D.barcode === 'datamatrix') {
    let dm = null;
    const gtin = tag.ean ? toGtin14(tag.ean) : null;
    try {
      if (gtin) {
        const els = [{ ai: '01', value: gtin }];
        if (tag.expires) els.push({ ai: '17', value: tag.expires.slice(2, 4) + tag.expires.slice(5, 7) + tag.expires.slice(8, 10) });
        dm = dataMatrix(els, { gs1: true });
      } else if (tag.ean || tag.code) dm = dataMatrix(tag.ean || tag.code);
    } catch { dm = null; }
    if (!dm) return null;
    const n = dm.cols + 4, m = dm.rows + 4;
    const k = Math.min(w / n, h / m, 0.6);
    const ox = x + (w - n * k) / 2, oy = y + h - m * k;
    let d = '';
    dm.matrix.forEach((row, r) => { let c = 0; while (c < row.length) { if (!row[c]) { c++; continue; } const s = c; while (c < row.length && row[c]) c++; d += `M${s + 2} ${r + 2}h${c - s}v1h${s - c}z`; } });
    return { kind: 'datamatrix', xdim: k, svg: `<g class="pt-code" transform="translate(${r3(ox)} ${r3(oy)}) scale(${r3(k)})"><rect width="${n}" height="${m}" fill="#fff"/><path fill="#000" shape-rendering="crispEdges" d="${d}"/></g>` };
  }
  const sym = linearSymbol(tag, D);
  if (!sym) return null;
  const ean = sym.text === 'ean';
  const font = ean ? 8 : 7;
  const L0 = barcodeLayout(sym, { height: 30, font, quiet: true });
  const k = Math.min(w / L0.width, 0.4);
  const extra = L0.height - 30;
  const barH = Math.max(8, Math.min(h / k - extra, 70));
  const L = barcodeLayout(sym, { height: barH, font, quiet: true });
  const kk = Math.min(k, h / L.height);
  const ox = x + (w - L.width * kk) / 2, oy = y + h - L.height * kk;
  let d = '';
  for (const r of L.rects) d += `M${r3(r.x)} ${r3(r.y)}h${r3(r.w)}v${r3(r.h)}h${r3(-r.w)}z`;
  const texts = L.texts.map((tx) => `<text x="${r3(tx.x)}" y="${r3(tx.y)}" font-size="${r3(tx.size)}" text-anchor="${tx.anchor}">${esc(tx.text)}</text>`).join('');
  return {
    kind: sym.type, xdim: kk,
    svg: `<g class="pt-code" transform="translate(${r3(ox)} ${r3(oy)}) scale(${r3(kk)})"><rect width="${r3(L.width)}" height="${r3(L.height)}" fill="#fff"/><path fill="#000" shape-rendering="crispEdges" d="${d}"/>${texts ? `<g fill="#000" font-family="${esc(MONO)}">${texts}</g>` : ''}</g>`,
  };
}

// --- text lines of a tag ------------------------------------------------------------------------------------------

// Secondary texts of a tag, in the tag language: info (pack size or "1 kg", origin), unit price line, meta (date,
// print code, shop code), note (best-before for markdown, "until <date>" for a promo with a real end - the
// '9999-12-31' open-ended sentinel compares >= '9999' and is hidden), and the '/kg' price suffix for weighed goods.
function lines(tag, D) {
  const lang = D.lang;
  const info = [];
  if (tag.sold === 'kg' || tag.sold === 'l') info.push(`1 ${word(lang, tag.sold)}`);
  else if (tag.size) info.push(tag.size);
  if (D.origin && tag.origin) info.push(tag.origin);
  const unit = D.unitPrice && tag.unit ? `${tag.unit.amount} ${unitText(tag.unit.per, lang)} = ${moneyCur(tag.unit.price, D)}` : '';
  const meta = [D.date ? dayText(tag.day) : '', D.printCode, tag.code].filter(Boolean).join(' · ');
  const note = tag.kind === 'markdown' ? `${word(lang, 'best')} ${dayText(tag.expires)}` : tag.kind === 'promo' && tag.until && tag.until < '9999' ? word(lang, 'until', dayText(tag.until, true)) : '';
  const suffix = tag.sold === 'kg' || tag.sold === 'l' ? word(lang, tag.sold) : '';
  return { info: info.join(' · '), unit, meta, note, suffix };
}

// --- templates ----------------------------------------------------------------------------------------------------

/**
 * SVG of one tag. D: design settings (common.js DESIGN_DEF). opts.unit: 'mm' (print, export) | 'px' (with
 * opts.scale px per mm) | '' (fills its box). -> { svg, xdim (mm per module of the code, or 0), code }
 *
 * Layout model per template: top-down for the name block (returns the y it reached), bottom-up for price/code/meta
 * (anchored to H - pad), and the price takes whatever height is left between them (P = min(design size, available /
 * height ratio)). So a long name shrinks the price instead of overlapping it. pad scales with the tag (6 % of the
 * short side, clamped 1.5..5 mm). promoLike requires both a discount kind and an old price: a tag never shows a
 * "SALE" band without the struck price that proves it.
 * Templates: classic (white, coloured note band), promo (yellow, red band), minimal (hairline divider), wobbler
 * (round shelf-talker with a hanging tab, no border), strip (shelf-edge, badge as a full-height block on the left).
 * role=img + aria-label + <title>: the inline SVG is one image to assistive tech, labelled with name and price.
 */
export function tagSVG(tag, D, { unit = 'mm', scale = 4, title = '' } = {}) {
  const W = D.w, H = D.h;
  const fam = FAMILIES[D.font] || FAMILIES.sans;
  const nameS = D.fonts.name * PT, priceS = D.fonts.price * PT, smallS = D.fonts.small * PT;
  const pad = Math.max(1.5, Math.min(5, Math.min(W, H) * 0.06));
  const nameW = D.bold ? 700 : 500;
  const accent = D.accent || '#d61f26';
  const L = lines(tag, D);
  const parts = [];
  let code = null;
  const add = (s) => { if (s) parts.push(s); };
  const tpl = D.template;
  const promoLike = tag.kind && tag.old != null;

  // Name lines from y downward. The first line advances by 0.86 x line height (cap height, so the text top sits at y),
  // later lines by the full 1.13 line height. Optional second-language name: one italic line, smaller, greyer.
  const nameBlock = (x, y, width, maxLines, color = '#111', anchor = 'start') => {
    const wr = wrap(tag.name, width, nameS, maxLines, nameW, fam);
    const lh = wr.size * 1.13;
    let yy = y;
    for (const ln of wr.lines) { yy += lh * (yy === y ? 0.86 : 1); add(textEl(anchor === 'middle' ? x + width / 2 : x, yy, ln, wr.size, { weight: nameW, fill: color, family: fam, anchor, cls: 'pt-name' })); }
    if (tag.name2) {
      const s2 = smallS * 1.08;
      const w2 = wrap(tag.name2, width, s2, 1, 400, fam);
      yy += s2 * 1.25;
      add(textEl(anchor === 'middle' ? x + width / 2 : x, yy, w2.lines[0] || '', w2.size, { fill: color === '#111' ? '#444' : color, family: fam, anchor, style: 'italic', cls: 'pt-name2' }));
    }
    return yy;
  };

  // Bottom block shared by classic / promo / minimal: code at the left above the meta line, price at the right.
  // The code gets codeShare (42 %) of the inner width and at most 30 % of H / 16 mm; if no code could be encoded its
  // width is returned to the price. The price's available height accounts for the old price stacked above it
  // (0.74 = digit height ratio, + 0.36 x 1.15 when an old price is present).
  const bottom = (top, { priceFill = '#111', oldFill = '#444', strike = accent, codeShare = 0.42 } = {}) => {
    const metaY = H - pad;
    if (L.meta) add(textEl(pad, metaY, L.meta, fitSize(L.meta, (W - 2 * pad) * codeShare + 4, smallS * 0.9, 400, fam), { fill: '#555', family: fam, cls: 'pt-meta' }));
    let codeW = 0;
    if (D.barcode !== 'none') {
      const ch = Math.min(H * 0.3, 16, metaY - smallS * 1.2 - top - 0.5);
      codeW = (W - 2 * pad) * codeShare;
      code = codeBox(tag, D, pad, metaY - smallS * 1.15 - ch, codeW, ch);
      if (code) add(code.svg); else codeW = 0;
    }
    const right = W - pad;
    let base = H - pad;
    if (L.unit) {
      add(textEl(right, base, L.unit, fitSize(L.unit, W - 2 * pad - codeW - 1, smallS, 500, fam), { anchor: 'end', fill: '#333', family: fam, cls: 'pt-unit' }));
      base -= smallS * 1.35;
    }
    const maxW = W - 2 * pad - codeW - 1.5;
    const oldK = 0.36;
    const avail = base - top - 0.6;
    let P = Math.min(priceS, avail / (0.74 + (promoLike ? oldK * 1.15 : 0)));
    const pe = priceEl(right, base, tag.price ?? 0, D, P, maxW, { fill: priceFill, family: fam, suffix: L.suffix });
    P = pe.size;
    add(pe.svg);
    if (promoLike) add(oldEl(right, base - P * 0.78, tag.old, D, P * oldK, { fill: oldFill, strike, family: fam }));
  };

  if (tpl === 'promo') {
    add(`<rect width="${W}" height="${H}" fill="#ffe14d"/>`);
    // The red band with "SALE" / "REDUCED" only on tags that really carry a lower price.
    const bandH = promoLike ? smallS * 2.1 : 0;
    if (promoLike) {
      add(`<rect width="${W}" height="${r3(bandH)}" fill="${accent}"/>`);
      add(textEl(pad, bandH * 0.72, word(D.lang, tag.kind === 'markdown' ? 'markdown' : 'sale'), smallS * 1.25, { weight: 800, fill: '#fff', family: fam }));
    }
    if (L.note && promoLike) add(textEl(W - pad, bandH * 0.7, L.note, fitSize(L.note, W * 0.5, smallS, 600, fam), { anchor: 'end', weight: 600, fill: '#fff', family: fam, cls: 'pt-note' }));
    let nameWdt = W - 2 * pad;
    if (tag.pct) {
      const r = Math.min(smallS * 2.6, H * 0.18);
      const cx = W - pad - r, cy = bandH + 1 + r;
      add(`<g class="pt-badge"><circle cx="${r3(cx)}" cy="${r3(cy)}" r="${r3(r)}" fill="${accent}"/>${textEl(cx, cy + r * 0.26, badgeText(tag.pct), fitSize(badgeText(tag.pct), r * 1.75, r * 0.78, 800, fam), { anchor: 'middle', weight: 800, fill: '#fff', family: fam })}</g>`);
      nameWdt -= 2 * r + 1;
    }
    let y = nameBlock(pad, bandH + (promoLike ? 1.2 : pad), nameWdt, H < 45 ? 2 : 3);
    if (L.info) { y += smallS * 1.3; add(textEl(pad, y, L.info, fitSize(L.info, nameWdt, smallS, 400, fam), { fill: '#333', family: fam, cls: 'pt-info' })); }
    bottom(y + 0.4, { priceFill: promoLike ? accent : '#111', oldFill: '#222', strike: '#111' });
  } else if (tpl === 'minimal') {
    add(`<rect width="${W}" height="${H}" fill="#fff"/>`);
    let right = W - pad, nameWdt = W - 2 * pad;
    if (tag.pct) {
      const s = smallS * 1.3, bw = measure(badgeText(tag.pct), s, 800, fam);
      add(`<g class="pt-badge">${textEl(right, pad + s * 0.86, badgeText(tag.pct), s, { anchor: 'end', weight: 800, fill: accent, family: fam })}</g>`);
      nameWdt -= bw + 1.5;
    }
    let y = nameBlock(pad, pad, nameWdt, H < 45 ? 2 : 3);
    y += smallS * 0.6;
    add(`<line x1="${pad}" y1="${r3(y)}" x2="${r3(W - pad)}" y2="${r3(y)}" stroke="#bbb" stroke-width="0.2"/>`);
    if (L.info || L.note) { y += smallS * 1.25; add(textEl(pad, y, [L.info, L.note].filter(Boolean).join(' · '), fitSize([L.info, L.note].filter(Boolean).join(' · '), W - 2 * pad, smallS, 400, fam), { fill: tag.kind === 'markdown' ? accent : '#555', family: fam, cls: 'pt-info' })); }
    bottom(y + 0.4, { oldFill: '#888', strike: '#888' });
  } else if (tpl === 'wobbler') {
    // Circle of radius R below a tab of height tabH (the tab is what clips onto the shelf; its small circle marks the
    // punch hole). Content is centred in the circle and sized from R, not from the design font sizes, so it fits any
    // aspect ratio. inner = 1.55 R approximates the usable chord width near the centre.
    const tabH = Math.max(5, H * 0.16), tabW = Math.max(10, W * 0.34);
    const R = Math.min(W / 2, (H - tabH) / 2) - 0.3, cx = W / 2, cy = tabH + R + 0.15;
    add(`<rect x="${r3(cx - tabW / 2)}" y="0.15" width="${r3(tabW)}" height="${r3(tabH + R * 0.4)}" rx="1.5" fill="#fff" stroke="#999" stroke-width="0.25"/>`);
    add(`<circle cx="${r3(cx)}" cy="${r3(tabH * 0.45)}" r="${r3(Math.min(2.2, tabH * 0.22))}" fill="none" stroke="#999" stroke-width="0.25"/>`);
    add(`<circle cx="${r3(cx)}" cy="${r3(cy)}" r="${r3(R)}" fill="${promoLike ? '#ffe14d' : '#fff'}" stroke="${accent}" stroke-width="${r3(Math.max(0.6, R * 0.04))}"/>`);
    const inner = R * 1.55;
    if (tag.pct) {
      const s = fitSize(badgeText(tag.pct), inner * 0.7, R * 0.26, 800, fam);
      add(`<g class="pt-badge">${textEl(cx, cy - R * 0.5, badgeText(tag.pct), s, { anchor: 'middle', weight: 800, fill: accent, family: fam })}</g>`);
    } else add(textEl(cx, cy - R * 0.45, tag.kind === 'markdown' ? word(D.lang, 'markdown') : '', R * 0.18, { anchor: 'middle', weight: 800, fill: accent, family: fam }));
    const pe = priceEl(cx, cy + R * 0.28, tag.price ?? 0, D, Math.min(priceS * 1.3, R * 0.6), inner, { anchor: 'middle', fill: promoLike ? accent : '#111', family: fam, suffix: L.suffix });
    add(pe.svg);
    if (promoLike) add(oldEl(cx, cy + R * 0.28 - pe.size * 0.8, tag.old, D, pe.size * 0.3, { anchor: 'middle', fill: '#222', strike: '#111', family: fam }));
    const wr = wrap(tag.name, R * 1.35, Math.min(nameS, R * 0.15), 2, nameW, fam);
    wr.lines.forEach((ln, i) => add(textEl(cx, cy + R * 0.48 + i * wr.size * 1.12, ln, wr.size, { anchor: 'middle', weight: nameW, fill: '#111', family: fam, cls: 'pt-name' })));
    const foot = L.note || L.unit;
    if (foot) add(textEl(cx, cy + R * 0.82, foot, fitSize(foot, R * 1.1, smallS * 0.95, 500, fam), { anchor: 'middle', fill: '#333', family: fam, cls: L.note ? 'pt-note' : 'pt-unit' }));
  } else if (tpl === 'strip') {
    add(`<rect width="${W}" height="${H}" fill="#fff"/>`);
    let x0 = pad;
    if (tag.pct) {
      const bw = Math.min(H * 0.95, W * 0.2);
      add(`<g class="pt-badge"><rect width="${r3(bw)}" height="${H}" fill="${accent}"/>${textEl(bw / 2, H * 0.58, badgeText(tag.pct), fitSize(badgeText(tag.pct), bw * 0.86, H * 0.3, 800, fam), { anchor: 'middle', weight: 800, fill: '#fff', family: fam })}</g>`);
      x0 = bw + pad;
    } else add(`<rect width="1.6" height="${H}" fill="${accent}"/>`);
    const leftW = (W - x0 - pad) * 0.52;
    let y = nameBlock(x0, pad * 0.7, leftW, 2);
    const infoTxt = [L.info, L.note].filter(Boolean).join(' · ');
    if (infoTxt) { y += smallS * 1.25; add(textEl(x0, y, infoTxt, fitSize(infoTxt, leftW, smallS, 400, fam), { fill: tag.kind === 'markdown' ? accent : '#444', family: fam, cls: 'pt-info' })); }
    if (L.meta) add(textEl(x0, H - pad * 0.7, L.meta, fitSize(L.meta, leftW, smallS * 0.85, 400, fam), { fill: '#666', family: fam, cls: 'pt-meta' }));
    const codeTop = y + 0.8, codeBot = H - pad * 0.7 - (L.meta ? smallS * 1.1 : 0);
    if (codeBot - codeTop > 4) { code = codeBox(tag, D, x0, codeTop, Math.min(leftW, 34), codeBot - codeTop); if (code) add(code.svg); }
    const right = W - pad, rx0 = x0 + leftW + 2;
    let base = H - pad * 0.8;
    if (L.unit) { add(textEl(right, base, L.unit, fitSize(L.unit, right - rx0, smallS, 500, fam), { anchor: 'end', fill: '#333', family: fam, cls: 'pt-unit' })); base -= smallS * 1.3; }
    const P = Math.min(priceS, (base - pad * 0.6) / (0.74 + (promoLike ? 0.42 : 0)));
    const pe = priceEl(right, base, tag.price ?? 0, D, P, right - rx0, { fill: promoLike ? accent : '#111', family: fam, suffix: L.suffix });
    add(pe.svg);
    if (promoLike) add(oldEl(right, base - pe.size * 0.78, tag.old, D, pe.size * 0.36, { strike: accent, family: fam }));
  } else {
    // classic
    add(`<rect width="${W}" height="${H}" fill="#fff"/>`);
    let top = pad;
    if (L.note) {
      const bh = smallS * 1.7;
      add(`<rect width="${W}" height="${r3(bh)}" fill="${tag.kind === 'markdown' ? '#f97316' : accent}"/>`);
      const note = tag.kind === 'promo' ? word(D.lang, 'sale') + ' ' + L.note : L.note;
      add(textEl(pad, bh * 0.72, note, fitSize(note, W - 2 * pad, smallS, 700, fam), { weight: 700, fill: '#fff', family: fam, cls: 'pt-note' }));
      top = bh + pad * 0.6;
    }
    let nameWdt = W - 2 * pad;
    if (tag.pct) {
      const b = badgeRect(W - pad, top, tag.pct, smallS * 1.35, accent, '#fff', fam);
      add(b.svg);
      nameWdt -= b.w + 1;
    }
    let y = nameBlock(pad, top, nameWdt, H < 45 ? 2 : 3);
    if (L.info) { y += smallS * 1.3; add(textEl(pad, y, L.info, fitSize(L.info, W - 2 * pad, smallS, 400, fam), { fill: '#444', family: fam, cls: 'pt-info' })); }
    bottom(y + 0.4, { priceFill: promoLike ? accent : '#111' });
  }
  // Thin grey cut guide inset by half its stroke (0.1 mm), so the full stroke stays inside the viewBox and is not clipped.
  if (D.border && tpl !== 'wobbler') add(`<rect x="0.1" y="0.1" width="${r3(W - 0.2)}" height="${r3(H - 0.2)}" fill="none" stroke="#9ca3af" stroke-width="0.2"/>`);

  const size = unit === 'mm' ? `width="${W}mm" height="${H}mm"` : unit === 'px' ? `width="${r3(W * scale)}" height="${r3(H * scale)}"` : '';
  const label = title || `${tag.name}: ${tag.text?.price ?? ''}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="pt-tag" data-id="${esc(tag.id)}" ${size} viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" font-family="${esc(fam)}"><title>${esc(label)}</title>${parts.join('')}</svg>`;
  return { svg, xdim: code ? code.xdim : 0, code: code ? code.kind : null };
}

// --- sheets -------------------------------------------------------------------------------------------------------

export const A4 = { w: 210, h: 297 };

/** Grid of tags on an A4 page: { cols, rows, perPage, x0, y0 } (the grid is centred inside the margins).
 * n tags with n-1 gaps fit when n*W + (n-1)*gap <= avail, i.e. n <= (avail + gap) / (W + gap) - hence "+ gap".
 * The margin is a minimum: leftover space is split equally, so the grid is centred and cut marks are symmetric.
 */
export function sheetGrid(W, H, { margin = 8, gap = 0 } = {}) {
  const cols = Math.max(0, Math.floor((A4.w - 2 * margin + gap) / (W + gap)));
  const rows = Math.max(0, Math.floor((A4.h - 2 * margin + gap) / (H + gap)));
  const gw = cols * W + Math.max(0, cols - 1) * gap, gh = rows * H + Math.max(0, rows - 1) * gap;
  return { cols, rows, perPage: cols * rows, x0: (A4.w - gw) / 2, y0: (A4.h - gh) / 2, gw, gh };
}

// Cut marks of a page in the margins: short lines continuing every tag edge. -> SVG markup (viewBox = A4).
// Edges are deduplicated in Sets (with gap 0, the right edge of one column is the left edge of the next). Marks stay
// in the margin only, starting 1 mm off the grid (not touching the tags) and up to 6 mm long, shortened to fit the
// margin; with no room they are omitted. Drawn only outside the grid, never across tags.
export function cutMarks(g, W, H, gap) {
  const xs = new Set(), ys = new Set();
  for (let c = 0; c < g.cols; c++) { xs.add(r3(g.x0 + c * (W + gap))); xs.add(r3(g.x0 + c * (W + gap) + W)); }
  for (let r = 0; r < g.rows; r++) { ys.add(r3(g.y0 + r * (H + gap))); ys.add(r3(g.y0 + r * (H + gap) + H)); }
  const len = (m) => Math.max(0, Math.min(6, m - 1));
  let d = '';
  const top = g.y0, bot = g.y0 + g.gh, left = g.x0, right = g.x0 + g.gw;
  for (const x of xs) { if (len(top) > 0) d += `M${x} ${r3(top - 1 - len(top))}V${r3(top - 1)}`; if (len(A4.h - bot) > 0) d += `M${x} ${r3(bot + 1)}V${r3(bot + 1 + len(A4.h - bot))}`; }
  for (const y of ys) { if (len(left) > 0) d += `M${r3(left - 1 - len(left))} ${y}H${r3(left - 1)}`; if (len(A4.w - right) > 0) d += `M${r3(right + 1)} ${y}H${r3(right + 1 + len(A4.w - right))}`; }
  return `<svg class="pt-marks" xmlns="http://www.w3.org/2000/svg" width="${A4.w}mm" height="${A4.h}mm" viewBox="0 0 ${A4.w} ${A4.h}" aria-hidden="true"><path d="${d}" stroke="#000" stroke-width="0.15" fill="none"/></svg>`;
}
