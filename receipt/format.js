// receipt/format.js - plain-text receipts for thermal printers: 58 mm paper has 32 columns, 80 mm has 48 (font A).
// Width is counted in characters (code points; combining marks take no column), so Georgian, Cyrillic and Latin
// align alike. Helpers: word wrap, centring, rules, a left / right row that wraps the left part, and aligned columns
// with one flexible column. formatReceipt prints a sale or return document of doc.js; formatShift an X / Z report of
// shift.js. Labels are English by default and can be replaced (any language).

import { formatMoney } from './money.js';

export const COLUMNS = { 58: 32, 80: 48 };
export const columnsFor = (paperMm) => COLUMNS[paperMm] ?? null;

// Visible width: one column per code point, none for combining marks.
// One column per code point is right for Latin, Cyrillic and Georgian on thermal printers. Limitation: CJK and emoji
// are double-width on most printers, so lines containing them come out too long.
export const textWidth = (s) => Array.from(String(s)).filter((c) => !/\p{M}/u.test(c)).length;

// Cuts to `width` columns, keeping combining marks with their base character.
function cut(s, width) {
  let out = '', w = 0;
  for (const c of Array.from(String(s))) {
    const cw = /\p{M}/u.test(c) ? 0 : 1;
    if (w + cw > width) break;
    out += c; w += cw;
  }
  return out;
}

export const padRight = (s, width) => String(s) + ' '.repeat(Math.max(0, width - textWidth(s)));
export const padLeft = (s, width) => ' '.repeat(Math.max(0, width - textWidth(s))) + String(s);
export const center = (s, width) => { const t = cut(s, width); const l = Math.floor((width - textWidth(t)) / 2); return ' '.repeat(l) + t; };
export const rule = (width, ch = '-') => ch.repeat(width);

// Word wrap; words longer than the width are split.
export function wrap(text, width) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = '';
    for (let word of para.split(/\s+/).filter(Boolean)) {
      while (textWidth(word) > width) {
        if (line) { out.push(line); line = ''; }
        const head = cut(word, width);
        out.push(head);
        word = word.slice(head.length);
      }
      if (!line) line = word;
      else if (textWidth(line) + 1 + textWidth(word) <= width) line += ' ' + word;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

// Left text and right text on one line; a long left part wraps (keeping its leading indent on every line) and the
// right part ends its last line.
// The amount must stay on the same printed line as the end of its description, which is why only the last line of
// the wrapped text is re-wrapped to the room left of the amount.
export function row(left, right, width) {
  const r = String(right ?? '');
  const indent = /^ */.exec(String(left))[0].slice(0, Math.max(0, width - 2));
  const text = String(left).slice(indent.length);
  const w = width - indent.length;
  const room = w - textWidth(r) - 1;
  if (room < 1) return [indent + cut(text, w), padLeft(r, width)];
  const lines = wrap(text, w);
  const last = lines.pop() ?? '';
  // The last line is wrapped again to the room left of the right part, so the amount stays on the text's last line.
  const tail = textWidth(last) <= room ? [last] : wrap(last, room);
  const end = tail.pop();
  return [...lines, ...tail].map((l) => indent + l).concat(indent + padRight(end, w - textWidth(r)) + r);
}

/**
 * Aligned columns: rows of cells, specs [{ width?, align: 'left' | 'right' }]; the one spec without a width takes
 * what is left (cut to it), columns are separated by one space. -> lines
 */
export function columns(rows, specs, width) {
  const fixed = specs.reduce((t, s) => t + (s.width ?? 0), 0) + specs.length - 1;
  const flex = Math.max(1, width - fixed);
  return rows.map((cells) => specs.map((s, i) => {
    const w = s.width ?? flex;
    const c = cut(cells[i] ?? '', w);
    return s.align === 'right' ? padLeft(c, w) : padRight(c, w);
  }).join(' ').replace(/\s+$/, ''));
}

export const LABELS = {
  sale: 'SALE', return: 'RETURN', receipt: 'Receipt', cashier: 'Cashier', taxId: 'Tax ID', discount: 'Discount',
  subtotal: 'Subtotal', total: 'TOTAL', vat: 'VAT', exempt: 'Without VAT', cash: 'Cash', card: 'Card', points: 'Points',
  tendered: 'Tendered', change: 'Change', rounding: 'Rounding', original: 'Return of receipt', fiscal: 'Fiscal No',
  earned: 'Points earned', balance: 'Points balance', thanks: 'Thank you!',
  shiftX: 'X REPORT', shiftZ: 'Z REPORT', shift: 'Shift', opened: 'Opened', sales: 'Sales', returns: 'Returns',
  net: 'Net', cashIn: 'Cash in', cashOut: 'Cash out', opening: 'Opening cash', expected: 'Expected cash',
  counted: 'Counted cash', difference: 'Difference', notFiscal: 'Not fiscalised', mixed: 'Mixed', receipts: 'Receipts',
};

const qtyText = (q) => (Number.isInteger(q) ? String(q) : String(Math.round(q * 1000) / 1000));

/**
 * A receipt as text. doc: saleDoc / returnDoc; opts: { width (32), digits (2), decimal ('.'), currency (''),
 * labels, footer, time (preformatted date-time text; the document's ts is not formatted here) }.
 */
export function formatReceipt(doc, { width = 32, digits = 2, decimal = '.', currency = '', labels = {}, footer = null, time = null } = {}) {
  const L = { ...LABELS, ...labels };
  const m = (v) => formatMoney(v, { digits, decimal });
  const out = [];
  const s = doc.seller ?? {};
  for (const x of [s.name, s.object, s.address]) if (x) out.push(...wrap(x, width).map((l) => center(l, width)));
  if (s.taxId) out.push(center(`${L.taxId} ${s.taxId}`, width));
  out.push(rule(width));
  out.push(...row(`${doc.kind === 'return' ? L.return : L.sale} ${doc.number != null ? `#${doc.number}` : ''}`.trim(), time ?? '', width));
  if (doc.cashier) out.push(...row(L.cashier, doc.cashier, width));
  if (doc.kind === 'return' && doc.original?.number != null) out.push(...row(L.original, `#${doc.original.number}`, width));
  if (doc.kind === 'return' && doc.original?.fiscalNumber) out.push(...row(L.fiscal, doc.original.fiscalNumber, width));
  out.push(rule(width));
  for (const l of doc.lines ?? []) {
    out.push(...wrap(l.name || l.item, width));
    const price = l.price != null ? `${qtyText(l.qty)} x ${m(l.price)}` : `${qtyText(l.qty)}`;
    out.push(...row('  ' + price, m(l.gross ?? l.total), width));
    const disc = (l.lineDiscount ?? 0) + (l.checkDiscount ?? 0);
    if (disc) out.push(...row('  ' + L.discount, '-' + m(disc), width));
  }
  out.push(rule(width));
  if (doc.discount) {
    out.push(...row(L.subtotal, m(doc.subtotal), width));
    out.push(...row(L.discount, '-' + m(doc.discount), width));
  }
  out.push(...row(L.total, m(doc.total) + (currency ? ' ' + currency : ''), width));
  for (const [rate, x] of Object.entries(doc.vat?.rates ?? {})) out.push(...row(`  ${L.vat} ${rate}%`, m(x.vat), width));
  if (doc.vat?.exempt) out.push(...row(`  ${L.exempt}`, m(doc.vat.exempt), width));
  const p = doc.payment ?? {};
  if (p.pointsValue) out.push(...row(L.points + (p.points ? ` (${p.points})` : ''), m(p.pointsValue), width));
  if (p.card) out.push(...row(L.card, m(p.card), width));
  if (p.rounding) out.push(...row(L.rounding, m(p.rounding), width));
  if (p.tendered != null && p.cash != null) {
    out.push(...row(L.cash, m(p.tendered), width));
    if (p.change) out.push(...row(L.change, m(p.change), width));
  } else if (p.cash) out.push(...row(L.cash, m(p.cash), width));
  if (doc.points?.earned) out.push(...row(L.earned, `+${doc.points.earned}`, width));
  if (doc.points?.balance != null) out.push(...row(L.balance, String(doc.points.balance), width));
  if (doc.fiscalNumber) out.push(...row(L.fiscal, doc.fiscalNumber, width));
  out.push(rule(width));
  for (const l of footer == null ? [L.thanks] : [].concat(footer)) out.push(...wrap(l, width).map((x) => center(x, width)));
  return out.map((l) => l.replace(/\s+$/, '')).join('\n');
}

/** An X / Z report of shift.js as text; opts like formatReceipt (time: preformatted). */
export function formatShift(report, { width = 32, digits = 2, decimal = '.', labels = {}, time = null } = {}) {
  const L = { ...LABELS, ...labels };
  const m = (v) => formatMoney(v, { digits, decimal });
  const out = [center(report.type === 'Z' ? L.shiftZ : L.shiftX, width)];
  out.push(...row(`${L.shift} #${report.shiftNumber ?? ''}`, time ?? '', width), rule(width));
  const block = (title, b) => {
    out.push(...row(`${title} (${b.count})`, m(b.total), width));
    if (b.cash) out.push(...row('  ' + L.cash, m(b.cash), width));
    if (b.card) out.push(...row('  ' + L.card, m(b.card), width));
    if (b.mixed) out.push(...row('  ' + L.mixed, m(b.mixed), width));
    if (b.points) out.push(...row('  ' + L.points, m(b.points), width));
  };
  block(L.sales, report.sales);
  block(L.returns, report.returns);
  out.push(...row(L.net, m(report.net), width), rule(width));
  for (const [rate, x] of Object.entries(report.vat?.rates ?? {})) out.push(...row(`${L.vat} ${rate}%`, m(x.vat), width));
  out.push(...row(L.opening, m(report.openingCash), width));
  out.push(...row(L.cashIn, m(report.cashIn), width));
  out.push(...row(L.cashOut, m(report.cashOut), width));
  out.push(...row(L.expected, m(report.expectedCash), width));
  if (report.type === 'Z' && report.countedCash != null) {
    out.push(...row(L.counted, m(report.countedCash), width));
    out.push(...row(L.difference, formatMoney(report.difference, { digits, decimal, plus: true }), width));
  }
  if (report.firstReceipt != null) out.push(...row(L.receipts, `#${report.firstReceipt}-#${report.lastReceipt}`, width));
  if (report.notFiscal) out.push(...row(L.notFiscal, String(report.notFiscal), width));
  return out.map((l) => l.replace(/\s+$/, '')).join('\n');
}
