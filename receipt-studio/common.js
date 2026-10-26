// receipt-studio/common.js - shared parts of the POS, returns and shift pages: the shell (pages resolved from the
// hidden anchors of the page HTML, so the build can rewrite them), app icons, the persisted data (settings, the
// catalogue with seeded demo items, promotions, loyalty cards, the current cart, the open shift, the journal of
// receipts, Z reports and counters, all in localStorage), money formatting on integer minor units, receipt views
// (the monospace text of receipt/format.js on a "paper", a printable HTML receipt with a Code 128 barcode and a QR of
// the receipt number), printing at 58 / 80 mm and the open / close shift dialogs shared by the POS and shift pages.
//
// Design rules:
// - Money is integer minor units (tetri, cents) everywhere: 0.1 + 0.2 !== 0.3 in floating point, and a receipt
//   that is off by one tetri is a legal defect. Parsing (parseAmt) and formatting (fmt) are the only conversions,
//   at the UI boundary. Quantities of weighed goods are kg with 3 decimals, rounded at display only.
// - One shared mutable store D, loaded once per page by startShell(). Each slice has its own localStorage key and
//   its own save.x() so a cart edit rewrites only the cart, not a 3000-document journal.
// - Persisted data is untrusted: loadData() filters every collection by shape and copies settings field by field
//   (pickKnown) against the defaults, so a corrupt or old entry degrades to defaults instead of crashing a page.
// - Documents (sales, returns) are immutable once in the journal: they snapshot seller, cashier and shift at issue
//   time (docMeta), so later settings changes never rewrite history; returns reference the original by number.
// - This is a training/demo POS: there is no fiscal device; numbering and Z reports imitate the workflow.
import './strings.js';
import { button, field, seg, startApp, t, textInput, toast } from '../ui/app.js';
import { $, h, lsGet, lsSet } from '../ui/dom.js';
import { addIcons, iconEl } from '../ui/icons.js';
import { openDialog } from '../ui/overlays.js';
import { formatMoney, parseMoney } from '../receipt/money.js';
import { LABELS, columnsFor, formatReceipt, formatShift } from '../receipt/format.js';
import { LOYALTY_DEFAULTS, cardNumber, ean13 } from '../receipt/loyalty.js';
import { shiftExpired, shiftReport, zReport } from '../receipt/shift.js';
import { encode } from '../barcode/linear.js';
import { barcodeSVG } from '../barcode/svg.js';
import { qrSVG } from '../qr/qr.js';
import { minorUnits } from '../payments/money.js';

export const LOGO = 'M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21zM9 8h6M9 12h6M9 16h3';

addIcons({
  receipt: LOGO,
  back: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  cash: 'M2 6h20v12H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9h.01M18 15h.01',
  creditCard: 'M2 5h20v14H2zM2 10h20M6 15h4',
  percent: 'M19 5L5 19M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  scale: 'M12 3v3M5 6h14l-3 7a3 3 0 0 1-8 0zM4 21h16M12 6v15',
  barcode: 'M3 5v14M6 5v14M9.5 5v10M12 5v10M15 5v10M18 5v14M21 5v14',
  points: 'M12 2l3 6.5 7 .9-5 4.8 1.3 7L12 17.8 5.7 21.2 7 14.2 2 9.4l7-.9z',
  lockClosed: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
});

// getAttribute, not a.href: .href returns an absolute URL (file:///...), breaking relative links after publishing.
// '#' fallback: a missing anchor degrades to a dead link instead of a crash on startup.
// Resolved hrefs of the pages (hidden anchors in the page HTML; the build rewrites their href).
export function pageHref(id) {
  const a = document.getElementById(id);
  return a ? a.getAttribute('href') : '#';
}

// loadData() runs after startApp because the demo seed uses t(): demo names must be in the UI language.
export function startShell(current, onLang) {
  startApp({
    key: 'rs', name: 'rs.name', logo: LOGO, offline: true, onLang,
    pages: [
      { href: pageHref('pg-pos'), label: 'rs.page.pos', current: current === 'pos' },
      { href: pageHref('pg-returns'), label: 'rs.page.returns', current: current === 'returns' },
      { href: pageHref('pg-shift'), label: 'rs.page.shift', current: current === 'shift' },
    ],
  });
  loadData();
}

// ---------------------------------------------------------------------------------------------------------------
// Data (localStorage 'rs-*')

// JOURNAL_MAX bounds localStorage use (about 5 MB per origin): at roughly 1 KB per document, 3000 documents stay
// well inside the quota; the oldest documents are dropped first.
const K = { cfg: 'rs-config', catalog: 'rs-catalog', promos: 'rs-promos', cards: 'rs-cards', cart: 'rs-cart', shift: 'rs-shift', journal: 'rs-journal', z: 'rs-z', seq: 'rs-seq' };
export const SYMBOLS = { GEL: '₾', EUR: '€', USD: '$', GBP: '£', UAH: '₴', TRY: '₺', AMD: '֏', AZN: '₼', KZT: '₸', PLN: 'zł', CHF: 'CHF', JPY: '¥' };
export const CATEGORIES = ['dairy', 'bakery', 'drinks', 'produce', 'grocery', 'books', 'pharmacy'];
export const JOURNAL_MAX = 3000;

// Defaults are the schema: pickKnown() accepts a saved field only if the default has the same primitive type.
// Seller taxId is a 9-digit Georgian-style placeholder; mode / cashStep drive VAT and cash rounding in receipt/.
export const CFG_DEF = {
  currency: 'GEL', digits: 2, decimal: '.', vatDefault: 18, vatMethod: 'line', mode: 'half-up', cashStep: 1, paper: 58,
  cashier: '', footer: '', openingCash: 10000,
  seller: { name: '', taxId: '404000000', object: '', address: '' },
  loyalty: { earnPct: LOYALTY_DEFAULTS.earnPct, pointValue: LOYALTY_DEFAULTS.pointValue, maxSpendPct: LOYALTY_DEFAULTS.maxSpendPct },
};

// The data of the studio; filled by loadData() once the UI language is known (demo names are seeded in it).
export const D = { cfg: null, catalog: [], promos: [], cards: [], cart: null, shift: null, journal: [], z: [], seq: { receipt: 0, shift: 0 } };

// Copies only keys present in base with the same primitive type; nested objects are skipped (handled explicitly by
// the caller), so a saved string where a number belongs, or an unknown key, is ignored.
function pickKnown(base, obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const k of Object.keys(base)) if (obj[k] != null && typeof obj[k] === typeof base[k] && typeof base[k] !== 'object') out[k] = obj[k];
  return out;
}

// Demo catalogue: [id, category, price (minor), VAT rate (null = without VAT), unit, PLU of weighed goods].
const DEMO = [
  ['milk', 'dairy', 345, 18, 'pcs'], ['matsoni', 'dairy', 290, 18, 'pcs'], ['shoti', 'bakery', 120, 18, 'pcs'],
  ['khachapuri', 'bakery', 650, 18, 'pcs'], ['borjomi', 'drinks', 240, 18, 'pcs'], ['saperavi', 'drinks', 2400, 18, 'pcs'],
  ['coffee', 'grocery', 1490, 18, 'pcs'], ['churchkhela', 'grocery', 300, 18, 'pcs'],
  ['tomatoes', 'produce', 480, 18, 'kg', '00101'], ['apples', 'produce', 320, 18, 'kg', '00102'], ['sulguni', 'dairy', 1890, 18, 'kg', '00103'],
  ['book', 'books', 1900, 0, 'pcs'], ['paracetamol', 'pharmacy', 280, null, 'pcs'],
];
export function demoCatalog() {
  // Barcodes are real EAN-13s (ean13() appends the check digit) under the 486 GS1 prefix (Georgia), so the scan field
  // and any phone scanner read them. Weighed goods carry a PLU instead (price per kg, quantity from the scale).
  return DEMO.map(([item, cat, price, vatRate, unit, plu], i) => ({
    item, name: t('rs.demo.' + item), cat, price, vatRate, unit, plu: plu || '',
    code: unit === 'kg' ? '' : ean13('4860001234' + String(i + 1).padStart(2, '0')),
  }));
}
export const demoPromos = () => [
  { id: 'p1', name: t('rs.demo.promoDairy'), kind: 'percent', value: 10, items: [], categories: ['dairy'], from: '2020-01-01', to: '2099-12-31' },
  { id: 'p2', name: t('rs.demo.promoCoffee'), kind: 'fixed', value: 1290, items: ['coffee'], categories: [], from: '2020-01-01', to: '2099-12-31' },
];
export const demoCards = () => [
  // Card numbers carry their own check digit (cardNumber); one card is blocked to demonstrate the refusal path.
  { number: cardNumber('29', 1), name: 'Nino Beridze', balance: 120, blocked: false },
  { number: cardNumber('29', 2), name: 'Giorgi Kapanadze', balance: 8, blocked: false },
  { number: cardNumber('29', 3), name: 'Ana Lomidze', balance: 40, blocked: true },
];
export const emptyCart = () => ({ lines: [], discount: null, card: null, pay: { method: 'cash', cash: '', card: '', points: 0 } });

// Shape check for catalogue entries: price must be an integer (minor units), VAT rate a number or null (exempt).
const isItem = (x) => x && typeof x.item === 'string' && typeof x.name === 'string' && Number.isInteger(x.price) && (x.vatRate === null || typeof x.vatRate === 'number');

export function loadData() {
  const c = lsGet(K.cfg, null) || {};
  const cfg = structuredClone(CFG_DEF);
  Object.assign(cfg, pickKnown(CFG_DEF, c));
  Object.assign(cfg.seller, pickKnown(CFG_DEF.seller, c.seller));
  Object.assign(cfg.loyalty, pickKnown(CFG_DEF.loyalty, c.loyalty));
  // First run (no saved seller): seed demo seller data so the receipt preview is complete. saveAll() at the end
  // persists the seed once, so the demo names do not change when the user later switches language.
  if (!c.seller) { cfg.seller.name = t('rs.demo.seller'); cfg.seller.object = t('rs.demo.object'); cfg.seller.address = t('rs.demo.address'); }
  if (!c.cashier && !lsGet(K.cfg, null)) cfg.cashier = t('rs.demo.cashier');
  if (![58, 80].includes(cfg.paper)) cfg.paper = 58;
  D.cfg = cfg;
  const cat = lsGet(K.catalog, null);
  D.catalog = Array.isArray(cat) ? cat.filter(isItem) : demoCatalog();
  const pr = lsGet(K.promos, null);
  D.promos = Array.isArray(pr) ? pr.filter((p) => p && typeof p.id === 'string' && (p.kind === 'percent' || p.kind === 'fixed')) : demoPromos();
  const cards = lsGet(K.cards, null);
  D.cards = Array.isArray(cards) ? cards.filter((x) => x && /^\d{13}$/.test(x.number)) : demoCards();
  const cart = lsGet(K.cart, null);
  D.cart = emptyCart();
  if (cart && Array.isArray(cart.lines)) {
    D.cart.lines = cart.lines.filter((l) => l && typeof l.item === 'string' && Number.isInteger(l.price) && l.qty > 0);
    D.cart.discount = cart.discount && (cart.discount.pct != null || cart.discount.amount != null) ? cart.discount : null;
    D.cart.card = typeof cart.card === 'string' ? cart.card : null;
    Object.assign(D.cart.pay, pickKnown(D.cart.pay, cart.pay));
  }
  const sh = lsGet(K.shift, null);
  // { ops: [], ...sh }: older saves without the cash-operations list still load.
  D.shift = sh && Number.isInteger(sh.number) && Number.isFinite(sh.openedAt) ? { ops: [], ...sh } : null;
  const j = lsGet(K.journal, []);
  D.journal = Array.isArray(j) ? j.filter((d) => d && (d.kind === 'sale' || d.kind === 'return') && Array.isArray(d.lines)) : [];
  const z = lsGet(K.z, []);
  D.z = Array.isArray(z) ? z.filter((r) => r && r.type === 'Z') : [];
  const seq = lsGet(K.seq, null) || {};
  D.seq = { receipt: Number.isInteger(seq.receipt) ? seq.receipt : 0, shift: Number.isInteger(seq.shift) ? seq.shift : 0 };
  if (!lsGet(K.cfg, null)) saveAll();
}

export const save = {
  cfg: () => lsSet(K.cfg, D.cfg), catalog: () => lsSet(K.catalog, D.catalog), promos: () => lsSet(K.promos, D.promos),
  cards: () => lsSet(K.cards, D.cards), cart: () => lsSet(K.cart, D.cart), shift: () => lsSet(K.shift, D.shift),
  // Journal and Z list are trimmed at save time as well as at add time: a long-lived store cannot grow unbounded.
  journal: () => lsSet(K.journal, D.journal.slice(-JOURNAL_MAX)), z: () => lsSet(K.z, D.z.slice(-200)), seq: () => lsSet(K.seq, D.seq),
};
export function saveAll() { for (const f of Object.values(save)) f(); }

// Training reset: the shift, the journal, Z reports and counters (catalogue, cards and settings stay).
// Points spent during training are restored from c.start (set by movePoints on the first change).
export function resetTraining() {
  D.shift = null; D.journal = []; D.z = []; D.seq = { receipt: 0, shift: 0 }; D.cart = emptyCart();
  for (const c of D.cards) if (c.start != null) { c.balance = c.start; delete c.start; }
  saveAll();
}

// ---------------------------------------------------------------------------------------------------------------
// Money and numbers

export const symbol = () => SYMBOLS[D.cfg.currency] || D.cfg.currency;
// Group separator: a plain space; the receipt text must be ASCII-friendly for thermal printers.
export const fmt = (v) => formatMoney(v, { digits: D.cfg.digits, decimal: D.cfg.decimal, group: ' ' });
export const fmtCur = (v) => `${fmt(v)} ${symbol()}`;
export const parseAmt = (s) => parseMoney(s, D.cfg.digits);
export const amtText = (v) => formatMoney(v, { digits: D.cfg.digits, decimal: D.cfg.decimal });
export const digitsOf = (cur) => minorUnits(cur);
// Weighed quantities always show 3 decimals (scale precision: grams); pieces show up to 3, without trailing zeros.
export const fmtQty = (q, unit) => (unit === 'kg' ? `${(Math.round(q * 1000) / 1000).toFixed(3)} ${t('rs.unit.kg')}` : String(Math.round(q * 1000) / 1000));
export const rateText = (r) => (r == null ? t('rs.vat.none') : `${r} %`);
export const pad = (n, w) => String(n).padStart(w, '0');
// Hand-built format instead of toLocaleString: a receipt must not change format with the browser's locale.
// Local date and time as 'YYYY-MM-DD HH:MM' (receipts are locale independent).
export function fmtTime(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)} ${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}`;
}
export const todayISO = () => fmtTime(Date.now()).slice(0, 10);
export const itemOf = (id) => D.catalog.find((x) => x.item === id) || null;
export const cardOf = (num) => D.cards.find((c) => c.number === num) || null;
export const catName = (c) => (CATEGORIES.includes(c) ? t('rs.cat.' + c) : c || '—');
export const methodName = (m) => t('rs.m.' + (m || 'cash'));

export function docMeta(number) {
  return { number, ts: Date.now(), cashier: D.cfg.cashier, seller: { ...D.cfg.seller }, shift: D.shift ? D.shift.number : null };
}
export function nextNumber() { D.seq.receipt++; save.seq(); return D.seq.receipt; }
// Splice the oldest documents beyond JOURNAL_MAX; numbering (D.seq) is independent, so numbers never repeat.
export function addDoc(doc) { D.journal.push(doc); if (D.journal.length > JOURNAL_MAX) D.journal.splice(0, D.journal.length - JOURNAL_MAX); save.journal(); }
export const returnsOf = (sale) => D.journal.filter((d) => d.kind === 'return' && d.original?.number === sale.number);

// Loyalty points after a document: the card keeps its balance; the start balance is kept for the training reset.
// Remembering the start balance only on the first change keeps resetTraining exact after many documents.
export function movePoints(num, delta) {
  const c = cardOf(num);
  if (!c || !delta) return;
  if (c.start == null) c.start = c.balance;
  c.balance += delta;
  save.cards();
}

// ---------------------------------------------------------------------------------------------------------------
// Receipt text, barcode and QR

export const receiptLabels = () => Object.fromEntries(Object.keys(LABELS).map((k) => [k, t('rs.l.' + k)]));
export const fmtOpts = (paper) => ({ width: columnsFor(paper) || 32, digits: D.cfg.digits, decimal: D.cfg.decimal, labels: receiptLabels() });

export function receiptText(doc, paper = D.cfg.paper) {
  return formatReceipt(doc, { ...fmtOpts(paper), currency: D.cfg.currency, footer: D.cfg.footer ? D.cfg.footer.split('\n') : null, time: doc.ts ? fmtTime(doc.ts) : t('rs.draftTime') });
}
export const shiftText = (rep, paper = D.cfg.paper) => formatShift(rep, { ...fmtOpts(paper), time: fmtTime(rep.at ?? Date.now()) });

// 10 digits, an even count: Code 128 set C packs two digits per symbol, the densest encoding for numeric data,
// which keeps the barcode short enough for 58 mm paper.
// Receipt code: shift (4 digits) + receipt number (6 digits), Code 128 set C.
export const receiptCode = (doc) => pad(doc.shift ?? 0, 4) + pad(doc.number ?? 0, 6);
export function barcodeMarkup(doc, unit = 'px') {
  // xdim 0.3 mm for print (a common minimum module width for thermal printers and scanners); 2 px on screen.
  const sym = encode('code128', receiptCode(doc));
  return barcodeSVG(sym, { unit, xdim: unit === 'mm' ? 0.3 : 2, height: 34, font: 9, title: t('rs.r.barcode', { n: receiptCode(doc) }) });
}
// Pipe-separated, fixed field order: trivial to split in a back office, no JSON escaping. Time digits only.
// EC level M (15% recovery): enough for a smudged thermal print without growing the symbol much.
// QR payload: a plain line a back office can parse (tax ID, receipt code, time, total, kind).
export const qrPayload = (doc) => ['RCPT', doc.seller?.taxId || '', receiptCode(doc), doc.ts ? fmtTime(doc.ts).replace(/\D/g, '') : '', amtText(doc.total), D.cfg.currency, doc.kind === 'return' ? 'R' : 'S'].join('|');
export const qrMarkup = (doc) => qrSVG(qrPayload(doc), { ec: 'M', margin: 2, title: t('rs.r.qr') });

// The monospace "paper" with the text of format.js (columns: 32 for 58 mm, 48 for 80 mm).
export function paperView(text, paper, extra = null) {
  return h('div', { class: 'rs-paper-wrap' }, h('div', { class: 'rs-paper', style: { '--cols': String(columnsFor(paper) || 32) }, dataset: { paper: String(paper) } },
    h('pre', { class: 'rs-paper-text', 'aria-label': t('rs.r.text') }, text), extra));
}

// The printable HTML receipt.
// Built with h() (text nodes), so names and footer text from settings can never inject markup. The barcode and QR
// are SVG strings generated locally from digits and the payload, which is why html: is safe there.
export function receiptHTML(doc, paper = D.cfg.paper) {
  const s = doc.seller || {}, p = doc.payment || {};
  const ret = doc.kind === 'return';
  const row = (l, r, cls = '') => h('div', { class: 'rs-r-row ' + cls }, h('span', {}, l), h('span', { class: 'rs-r-amt' }, r));
  const lines = (doc.lines || []).map((l) => {
    const unit = itemOf(l.item)?.unit;
    const disc = (l.lineDiscount || 0) + (l.checkDiscount || 0);
    return h('div', { class: 'rs-r-line' },
      h('div', { class: 'rs-r-name' }, l.name || l.item, l.promo ? h('span', { class: 'rs-r-promo' }, ' · ' + l.promo) : null),
      row(l.price != null ? `${fmtQty(l.qty, unit)} × ${fmt(l.price)}` : fmtQty(l.qty, unit), fmt(l.gross ?? l.total), 'rs-r-sub'),
      disc ? row(t('rs.l.discount'), '−' + fmt(disc), 'rs-r-sub') : null,
      l.code ? h('div', { class: 'rs-r-code' }, l.code) : null);
  });
  const vatRows = Object.entries(doc.vat?.rates || {}).map(([r, x]) => h('tr', {}, h('td', {}, r + ' %'), h('td', {}, fmt(x.net)), h('td', {}, fmt(x.vat)), h('td', {}, fmt(x.gross))));
  if (doc.vat?.exempt) vatRows.push(h('tr', {}, h('td', {}, t('rs.l.exempt')), h('td', {}, fmt(doc.vat.exempt)), h('td', {}, '—'), h('td', {}, fmt(doc.vat.exempt))));
  return h('div', { class: 'rs-rcpt', dataset: { paper: String(paper) } },
    h('header', { class: 'rs-r-head' }, s.name ? h('b', {}, s.name) : null, s.object ? h('div', {}, s.object) : null, s.address ? h('div', {}, s.address) : null,
      s.taxId ? h('div', {}, `${t('rs.l.taxId')} ${s.taxId}`) : null),
    h('div', { class: 'rs-r-title' }, h('b', {}, `${ret ? t('rs.l.return') : t('rs.l.sale')} ${doc.number != null ? '#' + doc.number : ''}`), h('span', {}, doc.ts ? fmtTime(doc.ts) : t('rs.draftTime'))),
    doc.cashier ? row(t('rs.l.cashier'), doc.cashier) : null,
    ret && doc.original?.number != null ? row(t('rs.l.original'), '#' + doc.original.number) : null,
    h('div', { class: 'rs-r-lines' }, lines),
    doc.discount ? [row(t('rs.l.subtotal'), fmt(doc.subtotal)), row(t('rs.l.discount'), '−' + fmt(doc.discount))] : null,
    row(t('rs.l.total'), `${fmt(doc.total)} ${D.cfg.currency}`, 'rs-r-total'),
    vatRows.length ? h('table', { class: 'rs-r-vat' }, h('thead', {}, h('tr', {}, h('th', {}, t('rs.l.vat')), h('th', {}, t('rs.vat.net')), h('th', {}, t('rs.vat.vat')), h('th', {}, t('rs.vat.gross')))), h('tbody', {}, vatRows)) : null,
    h('div', { class: 'rs-r-pay' },
      p.pointsValue ? row(t('rs.l.points') + (p.points ? ` (${p.points})` : ''), fmt(p.pointsValue)) : null,
      p.card ? row(t('rs.l.card'), fmt(p.card)) : null,
      p.rounding ? row(t('rs.l.rounding'), fmt(p.rounding)) : null,
      p.tendered != null ? row(t('rs.l.tendered'), fmt(p.tendered)) : p.cash ? row(t('rs.l.cash'), fmt(p.cash)) : null,
      p.change ? row(t('rs.l.change'), fmt(p.change), 'rs-r-total') : null,
      doc.points?.earned ? row(t('rs.l.earned'), '+' + doc.points.earned) : null,
      doc.points?.balance != null ? row(t('rs.l.balance'), String(doc.points.balance)) : null,
      ret && doc.points?.reverse ? row(t('rs.ret.reverse'), '−' + doc.points.reverse) : null,
      ret && doc.points?.refund ? row(t('rs.ret.pointsBack'), '+' + doc.points.refund) : null),
    doc.number != null ? h('div', { class: 'rs-r-codes' }, h('div', { class: 'rs-r-bar', html: barcodeMarkup(doc) }), h('div', { class: 'rs-r-qr', html: qrMarkup(doc) })) : null,
    h('footer', { class: 'rs-r-foot' }, D.cfg.footer || t('rs.l.thanks')));
}

// Printing: a sheet as wide as the paper; the page height follows the content (thermal roll).
// The print sheet is appended to <body>, app.css hides everything else under body.rs-printing. @page size is set
// to the paper width and the measured content height (px to mm at 96 dpi, plus 8 mm feed), so a thermal roll
// printer cuts after the receipt instead of feeding a full A4 length. Minimum 60 mm.
// setTimeout(50): one frame for the injected @page style and the sheet to take effect before the print dialog.
// KNOWN DEFECT: done() also runs 1 s after print() returns; on browsers where print() does not block (some mobile
// browsers) the sheet can be removed before the print preview captures it. Fix: rely on 'afterprint' alone, with
// matchMedia('print') change as the fallback signal.
export function printNode(node, paper = D.cfg.paper) {
  let sheet = $('#rs-print');
  if (sheet) sheet.remove();
  sheet = h('div', { id: 'rs-print', class: 'rs-print', dataset: { paper: String(paper) } }, node);
  document.body.append(sheet);
  document.body.classList.add('rs-printing');
  const hmm = Math.ceil(sheet.getBoundingClientRect().height * 25.4 / 96) + 8;
  const style = h('style', { id: 'rs-page' }, `@page { size: ${paper}mm ${Math.max(60, hmm)}mm; margin: 0; }`);
  document.head.append(style);
  const done = () => { document.body.classList.remove('rs-printing'); sheet.remove(); style.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(done, 1000); }, 50);
}
export const printReceipt = (doc, paper) => printNode(receiptHTML(doc, paper), paper);
export const printText = (text, paper) => printNode(h('pre', { class: 'rs-print-text' }, text), paper);

// Paper width choice (58 / 80 mm), remembered in the settings.
export function paperSeg(onChange) {
  return seg([{ v: 58, l: '=58 mm' }, { v: 80, l: '=80 mm' }], D.cfg.paper, (v) => { D.cfg.paper = +v; save.cfg(); onChange(); }, 'rs.paper');
}

// ---------------------------------------------------------------------------------------------------------------
// Shift

export const shiftDocs = (n = D.shift?.number) => D.journal.filter((d) => d.shift === n);
export const xReport = () => (D.shift ? shiftReport(D.shift, shiftDocs(), D.shift.ops || [], Date.now()) : null);
export const shiftIsExpired = () => !!D.shift && shiftExpired(D.shift.openedAt, Date.now());

// Shift numbers come from their own counter (D.seq.shift), independent of receipt numbers.
export function openShift(openingCash) {
  D.seq.shift++;
  D.shift = { number: D.seq.shift, openedAt: Date.now(), openedBy: D.cfg.cashier, openingCash, ops: [] };
  save.seq(); save.shift();
  toast(t('rs.sh.opened', { n: D.shift.number }), 'ok');
}

/** Opening cash dialog; resolves true when a shift was opened. */
export async function openShiftDialog() {
  let val = amtText(D.cfg.openingCash);
  const inp = textInput(val, (v) => { val = v; }, { inputmode: 'decimal', class: 'ed-input rs-num', id: 'rs-open-cash' });
  const body = h('div', { class: 'ed-fields' }, field('rs.sh.opening', inp, 'rs.sh.openingHint'));
  const v = await openDialog({ title: t('rs.sh.open'), body, buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('rs.sh.open'), value: 'ok', primary: true }] });
  if (v !== 'ok') return false;
  const amount = parseAmt(val);
  if (amount == null || amount < 0) { toast(t('rs.err.amount'), 'warn'); return false; }
  D.cfg.openingCash = amount; save.cfg();
  openShift(amount);
  return true;
}

/** Counted cash and the Z report; resolves the Z report when the shift was closed. */
// Counted vs expected cash: the difference (surplus/shortage) is shown live with an explicit sign and goes into the
// Z report. The X report is recomputed at confirmation time (not reused) so a sale made meanwhile is included.
export async function closeShiftDialog() {
  const x = xReport();
  if (!x) return null;
  let val = amtText(x.expectedCash);
  const diff = h('div', { class: 'rs-diff', role: 'status', 'aria-live': 'polite' });
  const paint = () => {
    const c = parseAmt(val);
    diff.textContent = c == null ? t('rs.err.amount') : t('rs.sh.diff', { v: formatMoney(c - x.expectedCash, { digits: D.cfg.digits, decimal: D.cfg.decimal, plus: true }) });
    diff.className = 'rs-diff' + (c != null && c !== x.expectedCash ? ' rs-warn' : '');
  };
  const inp = textInput(val, (v) => { val = v; paint(); }, { inputmode: 'decimal', class: 'ed-input rs-num', id: 'rs-counted' });
  paint();
  const body = h('div', { class: 'ed-fields' },
    h('dl', { class: 'ap-kv' }, h('dt', {}, t('rs.l.expected')), h('dd', { class: 'rs-num' }, fmtCur(x.expectedCash)),
      h('dt', {}, t('rs.l.sales')), h('dd', {}, `${x.sales.count} · ${fmtCur(x.sales.total)}`), h('dt', {}, t('rs.l.returns')), h('dd', {}, `${x.returns.count} · ${fmtCur(x.returns.total)}`)),
    field('rs.l.counted', inp), diff, h('div', { class: 'ed-hint' }, t('rs.sh.closeHint')));
  const v = await openDialog({ title: t('rs.sh.close'), body, buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('rs.sh.closeGo'), value: 'ok', primary: true, danger: true }] });
  if (v !== 'ok') return null;
  const counted = parseAmt(val);
  if (counted == null || counted < 0) { toast(t('rs.err.amount'), 'warn'); return null; }
  const z = zReport({ ...xReport(), at: Date.now() }, counted, { closedBy: D.cfg.cashier });
  D.z.push(z); D.shift = null;
  save.z(); save.shift();
  showReport(z);
  return z;
}

/** An X / Z report on paper in a dialog, with printing. */
export function showReport(rep) {
  let paper = D.cfg.paper;
  const box = h('div', { class: 'rs-report-dlg' });
  const paint = () => { box.textContent = ''; box.append(paperView(shiftText(rep, paper), paper)); };
  const s = seg([{ v: 58, l: '=58 mm' }, { v: 80, l: '=80 mm' }], paper, (v) => { paper = +v; paint(); }, 'rs.paper');
  paint();
  const pr = button('rs.print', 'print', () => printText(shiftText(rep, paper), paper));
  return openDialog({ title: t(rep.type === 'Z' ? 'rs.sh.z' : 'rs.sh.x'), body: h('div', { class: 'ed-fields' }, h('div', { class: 'ap-row' }, s, h('span', { class: 'ed-spacer' }), pr), box), className: 'rs-dlg-report' });
}

// Small status line of the shift for the POS and returns pages.
// Expired = the shift exceeded its legal length (receipt/shift.js); the badge turns red to force a Z report.
export function shiftBadge() {
  if (!D.shift) return h('span', { class: 'rs-shift-badge rs-closed' }, iconEl('lockClosed'), t('rs.sh.closed'));
  return h('span', { class: 'rs-shift-badge' + (shiftIsExpired() ? ' rs-expired' : '') }, iconEl('clock'), t('rs.sh.badge', { n: D.shift.number, t: fmtTime(D.shift.openedAt) }));
}

export const errText = (code) => t('rs.err.' + code);
