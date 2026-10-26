// receipt-studio/main.js - the POS page: a catalogue of items (editable; seeded demo items with EAN-13 codes, VAT
// rates including 0 % and "without VAT", weighed goods with PLU), adding by click or by typing / scanning an EAN, a
// PLU, an in-store weight code or "qty*code" (keyboard-wedge scanners type into the scan field from anywhere on the
// page), quantities and weights, line and whole-check discounts, promotions (receipt/price.js bestPrice), a loyalty
// card with points, payment by cash / card / mixed with points, change and cash rounding, the VAT breakdown by rate
// and the receipt preview at 58 / 80 mm (the text of receipt/format.js on paper, or the printable HTML receipt with a
// Code 128 and a QR of the receipt number). Also settings, the catalogue, promotion and card editors and the shift.
//
// Data flow: D.cart (lines, discount, card, pay inputs) is the only editable state of a sale. Every edit calls
// update(), which rebuilds R.draft = saleDoc(...) from scratch: pricing, discount allocation, VAT, loyalty and
// payment are pure functions in receipt/ and run on the whole cart each time. Why recompute instead of patching:
// a check discount is spread over lines proportionally and VAT is rounded per line or per rate, so one change
// moves several numbers; recomputing guarantees the screen, the receipt and the saved document always agree.
// On Pay the same function runs once more with a real receipt number and the result is frozen into the journal.
// Repaint levels: render() = skeleton (language switch, after pay, editors saved); update(keepPay) = derived boxes.
// keepPay = true while typing in payment/discount fields, so those inputs are not recreated under the caret.
import {
  CATEGORIES, D, SYMBOLS, addDoc, amtText, barcodeMarkup, cardOf, catName, closeShiftDialog, demoCards, demoCatalog, demoPromos,
  digitsOf, docMeta, emptyCart, errText, fmt, fmtCur, fmtQty, itemOf, movePoints, nextNumber, openShiftDialog,
  paperSeg, paperView, parseAmt, printReceipt, qrMarkup, qrPayload, rateText, receiptCode, receiptHTML, receiptText, save,
  shiftBadge, shiftDocs, shiftIsExpired, showReport, startShell, symbol, todayISO, xReport,
} from './common.js';
import { button, card, copyText, download, field, seg, select, t, textInput, toast } from '../ui/app.js';
import { $, $$, debounce, h, lsGet, lsSet } from '../ui/dom.js';
import { icon, iconEl } from '../ui/icons.js';
import { confirmDialog, openDialog } from '../ui/overlays.js';
import { addItem, removeLine, setLineDiscount, setQty } from '../receipt/cart.js';
import { saleDoc } from '../receipt/doc.js';
import { bestPrice } from '../receipt/price.js';
import { cardNumber, maxSpend } from '../receipt/loyalty.js';
import { encode } from '../barcode/linear.js';
import { barcodeSVG } from '../barcode/svg.js';
import { hasValidCheck, parseScaleCode } from '../barcode/gtin.js';
import { COMMON_CURRENCIES } from '../payments/money.js';

const main = $('#main');
main.classList.add('rs-pos');
// R.final: the receipt just paid (shown until the next item is added); R.draft: the check being built.
// The receipt view (text / HTML) is a per-device preference, kept outside D (not part of the sale data).
const R = { final: null, draft: null, filter: '', cat: 'all', view: lsGet('rs-pos-view', 'text') === 'html' ? 'html' : 'text' };
const els = {};
// Debounced cart persistence: a scanner can add lines faster than localStorage writes are worth doing.
const saveCart = debounce(() => save.cart(), 200);

// ---------------------------------------------------------------------------------------------------------------
// Prices, cart operations

// Promotions are evaluated for today; the category is passed as the single ancestor (a flat catalogue).
const priceOf = (it) => bestPrice({ item: it.item, itemPrice: it.price, ancestors: it.cat ? [it.cat] : [], promotions: D.promos, at: todayISO() });

// addItem merges a repeated product into its line (qty + 1) instead of adding a duplicate row; the flash shows which
// line grew. R.final = null: adding an item after a payment starts a new check and hides the paid receipt.
function addToCart(it, qty = 1, code = null) {
  if (!(qty > 0)) { toast(t('rs.err.qty'), 'warn'); return; }
  const p = priceOf(it);
  const r = addItem(D.cart.lines, { item: it.item, name: it.name, code: it.code || null, price: p.price, vatRate: it.vatRate }, { qty, code });
  if (r.error) { toast(errText(r.error), 'warn'); return; }
  D.cart.lines = r.cart;
  if (p.promo) D.cart.lines[r.line] = { ...D.cart.lines[r.line], promo: p.promo.name, base: p.base };
  R.final = null;
  cartChanged();
  flashLine(r.line);
}

// Restart a CSS animation: remove the class, force a reflow (reading offsetWidth), add it again. Without the
// reflow the browser coalesces remove+add and the animation does not replay.
function flashLine(i) {
  const row = $$('.rs-line')[i];
  if (!row) return;
  row.classList.remove('rs-flash'); void row.offsetWidth; row.classList.add('rs-flash');
  row.scrollIntoView({ block: 'nearest' });
}

async function weightDialog(it) {
  let val = '';
  const inp = textInput('', (v) => { val = v; }, { inputmode: 'decimal', class: 'ed-input rs-num', id: 'rs-weight', placeholder: '0.000' });
  const body = h('div', { class: 'ed-fields' }, h('div', {}, h('b', {}, it.name), ' · ', `${fmtCur(priceOf(it).price)} / ${t('rs.unit.kg')}`),
    field('rs.pos.weight', inp, 'rs.pos.weightHint'));
  const v = await openDialog({ title: t('rs.pos.weigh'), body, buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('rs.pos.add'), value: 'ok', primary: true }] });
  if (v !== 'ok') return;
  // Weight is entered manually (no scale integration in a browser); 3 decimals = gram precision, 999 kg sanity cap.
  const q = Number(String(val).replace(',', '.'));
  if (!(q > 0) || q > 999) { toast(t('rs.err.qty'), 'warn'); return; }
  addToCart(it, Math.round(q * 1000) / 1000);
}

const pick = (it) => (it.unit === 'kg' ? weightDialog(it) : addToCart(it, 1));

// Scanner / typed input: "qty*code", a loyalty card, an EAN, a PLU, an in-store weight code; text filters the tiles.
// Order of interpretation matters, cheapest and most specific first:
//   1. "qty*code" prefix (x, X, × accepted) sets the quantity for whatever follows.
//   2. Non-digit text: a name search; exactly one match adds it, otherwise it only filters the tiles.
//   3. A loyalty card number (cards are 13 digits too, so they are checked before products).
//   4. Catalogue EAN, then PLU.
//   5. Unknown 8/12/13/14-digit code with a bad GS1 check digit: report a misread instead of "not found".
//   6. In-store weight code (prefix 2, 13 digits): PLU + weight embedded by the shop scale (barcode/gtin.js).
// Returns true when the input was consumed, so the scan field clears only on success.
function handleScan(text) {
  let s = String(text || '').trim();
  if (!s) return false;
  let qty = null;
  const m = /^(\d+(?:[.,]\d{1,3})?)\s*[*xX×]\s*(.+)$/.exec(s);
  if (m) { qty = Number(m[1].replace(',', '.')); s = m[2].trim(); }
  const digits = s.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(digits)) {
    const list = filtered();
    if (list.length === 1) { qty == null ? pick(list[0]) : addToCart(list[0], qty); return true; }
    toast(t('rs.pos.notFound', { s }), 'warn');
    return false;
  }
  const c = cardOf(digits);
  if (c) { attachCard(c); return true; }
  let it = D.catalog.find((x) => x.code && x.code === digits) || D.catalog.find((x) => x.plu && x.plu === digits);
  if (it) {
    if (it.unit === 'kg' && qty == null) weightDialog(it);
    else addToCart(it, qty ?? 1, null);
    return true;
  }
  if (/^\d{8}$|^\d{12,14}$/.test(digits) && !hasValidCheck(digits)) { toast(t('rs.pos.badCheck', { s: digits }), 'warn'); return false; }
  if (/^2\d{12}$/.test(digits)) {
    const w = parseScaleCode(digits, 'weight');
    it = w.ok ? D.catalog.find((x) => x.plu && x.plu === w.item) : null;
    if (it && w.value > 0) { addToCart(it, w.value); return true; }
  }
  toast(t('rs.pos.notFound', { s: digits }), 'warn');
  return false;
}

// Attaching a card resets spent points: the allowed maximum depends on the card's balance.
function attachCard(c) {
  D.cart.card = c.number;
  D.cart.pay.points = 0;
  R.final = null;
  toast(c.blocked ? t('rs.loy.blockedToast', { name: c.name }) : t('rs.loy.attached', { name: c.name, n: c.balance }), c.blocked ? 'warn' : 'ok');
  paintLoyalty();
  update();
}

const cartChanged = () => { saveCart(); paintCart(); update(); };

// ---------------------------------------------------------------------------------------------------------------
// Check building

// Payment intent from the raw inputs: 'rest' means the card pays whatever remains after points; empty cash means
// "exact amount". Points are integers and only count when a card is attached.
function payInput() {
  const p = D.cart.pay;
  const cash = String(p.cash).trim() ? parseAmt(p.cash) : null;
  const points = D.cart.card ? Math.max(0, Math.floor(Number(p.points) || 0)) : 0;
  if (p.method === 'card') return { points, card: 'rest', cash: null };
  if (p.method === 'mixed') return { points, card: parseAmt(p.card) ?? 0, cash };
  return { points, card: 0, cash };
}
function loyaltyOf() {
  const c = D.cart.card && cardOf(D.cart.card);
  return c ? { balance: c.balance, blocked: c.blocked, ...D.cfg.loyalty } : null;
}
function makeDoc(meta) {
  const doc = saleDoc(meta, D.cart.lines, { discount: D.cart.discount, pay: payInput(), loyalty: loyaltyOf(), cashStep: D.cfg.cashStep, mode: D.cfg.mode, vatMethod: D.cfg.vatMethod });
  doc.card = D.cart.card || null;
  return doc;
}

// Validation runs on a draft first (no number consumed), then the shift is checked: numbering must never skip, so
// nextNumber() is called only after every check passed. Points move by earned minus spent in one step.
async function pay() {
  if (!D.cart.lines.length) { toast(t('rs.pos.empty'), 'warn'); return; }
  const draft = makeDoc(docMeta(null));
  if (draft.errors.length) { toast(draft.errors.map(errText).join(' '), 'warn'); return; }
  if (D.cart.pay.method === 'mixed' && !(parseAmt(D.cart.pay.card) > 0)) { toast(t('rs.err.mixedCard'), 'warn'); return; }
  if (!D.shift && !(await openShiftDialog())) return;
  if (shiftIsExpired()) { toast(t('rs.sh.expired'), 'error'); return; }
  const doc = makeDoc(docMeta(nextNumber()));
  addDoc(doc);
  if (doc.card && doc.points) movePoints(doc.card, doc.points.earned - doc.points.spent);
  D.cart = emptyCart();
  save.cart();
  R.final = doc;
  toast(doc.payment.change ? t('rs.pos.paidChange', { n: doc.number, c: fmtCur(doc.payment.change) }) : t('rs.pos.paid', { n: doc.number }), 'ok');
  render();
}

async function clearCheck() {
  if (!D.cart.lines.length && !D.cart.card) return;
  if (!(await confirmDialog(t('rs.pos.clear'), t('rs.pos.clearAsk'), t('rs.pos.clear'), true))) return;
  D.cart = emptyCart();
  save.cart();
  render();
}

// ---------------------------------------------------------------------------------------------------------------
// Layout

// Full rebuild. The scan field keeps its text (R.filter) across rebuilds so a language switch does not lose it.
function render() {
  main.textContent = '';
  for (const k of Object.keys(els)) delete els[k];
  els.tiles = h('div', { class: 'rs-tiles', id: 'rs-tiles' });
  els.cats = h('div', { class: 'rs-cats', role: 'group', 'aria-label': t('rs.pos.cats') });
  els.cart = h('div', { class: 'rs-cart', id: 'rs-cart' });
  els.totals = h('div', { class: 'rs-totals' });
  els.loyalty = h('div', { class: 'rs-loyalty' });
  els.payBox = h('div', { class: 'rs-pay' });
  els.payOut = h('div', { class: 'rs-pay-out' });
  els.receipt = h('div', { class: 'rs-receipt-box' });
  els.shift = h('div', { class: 'rs-shift-mini' });

  // The scan field is a plain text input: keyboard-wedge barcode scanners "type" the code and press Enter.
  const scan = h('input', { id: 'rs-scan', class: 'ed-input rs-scan', type: 'text', autocomplete: 'off', spellcheck: 'false', inputmode: 'text', placeholder: t('rs.pos.scanPh'), 'aria-label': t('rs.pos.scan'), value: R.filter });
  scan.addEventListener('input', () => { R.filter = scan.value; paintTiles(); });
  scan.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (handleScan(scan.value)) { scan.value = ''; R.filter = ''; paintTiles(); }
  });
  els.scan = scan;
  const tools = h('div', { class: 'ap-row rs-tools' },
    small(button('rs.cat.edit', 'edit', catalogDialog)), small(button('rs.promo.edit', 'tag', promoDialog)), small(button('rs.set.title', 'settings', settingsDialog)));
  const catCard = card('rs.pos.catalog', h('div', { class: 'rs-scan-row' }, iconEl('barcode'), scan), h('div', { class: 'ed-hint' }, t('rs.pos.scanHint')), els.cats, els.tiles, tools);
  catCard.classList.add('rs-a');

  const clear = small(button('rs.pos.clear', 'trash', clearCheck));
  const cartCard = h('section', { class: 'ap-card rs-b' }, h('div', { class: 'rs-card-h' }, h('h2', { class: 'ap-card-h' }, t('rs.pos.check')), h('span', { class: 'ed-spacer' }), clear), els.cart, els.totals);
  const payCard = card('rs.pay.title', els.loyalty, els.payBox, els.payOut);
  payCard.classList.add('rs-c');
  const rcCard = card('rs.r.title', els.receipt);
  const shCard = card('rs.sh.title', els.shift);
  const right = h('div', { class: 'rs-col rs-d' }, rcCard, shCard);
  main.append(h('div', { class: 'rs-work' }, catCard, h('div', { class: 'rs-col rs-bc' }, cartCard, payCard), right));
  paintCats(); paintTiles(); paintCart(); paintLoyalty(); paintPayBox(); paintShift();
  update();
}

const small = (b) => { b.classList.add('ed-sm'); return b; };

// Filter by category chip and by text over name, EAN and PLU (digits match partial codes while scanning).
function filtered() {
  const q = R.filter.trim().toLowerCase();
  return D.catalog.filter((it) => (R.cat === 'all' || it.cat === R.cat) && (!q || it.name.toLowerCase().includes(q) || (it.code || '').includes(q) || (it.plu || '').includes(q)));
}

function paintCats() {
  const used = [...new Set(D.catalog.map((x) => x.cat).filter(Boolean))];
  els.cats.textContent = '';
  for (const c of ['all', ...used]) {
    els.cats.append(h('button', { type: 'button', class: 'rs-chip' + (R.cat === c ? ' rs-on' : ''), 'aria-pressed': String(R.cat === c), dataset: { cat: c },
      onclick: () => { R.cat = c; paintCats(); paintTiles(); } }, c === 'all' ? t('rs.cat.all') : catName(c)));
  }
}

// Rendering an EAN-13 SVG for every tile on every keystroke of the filter would be wasteful; codes are stable.
// A malformed code (catalogue editor) yields an empty drawing instead of breaking the whole tile grid.
// Small EAN-13 drawings of the tiles (cached by code).
const EAN_CACHE = new Map();
function eanSVG(code) {
  if (!EAN_CACHE.has(code)) {
    let svg = '';
    try { svg = barcodeSVG(encode('ean13', code), { unit: 'px', xdim: 1, height: 22, font: 7, title: code }); } catch { svg = ''; }
    EAN_CACHE.set(code, svg);
  }
  return EAN_CACHE.get(code);
}

function paintTiles() {
  const list = filtered();
  els.tiles.textContent = '';
  if (!list.length) { els.tiles.append(h('div', { class: 'ap-empty' }, t('rs.pos.noItems'))); return; }
  for (const it of list) {
    const p = priceOf(it);
    // aria-label sums up the tile (name, price, unit): the visual tile contains a decorative barcode (aria-hidden).
    els.tiles.append(h('button', { type: 'button', class: 'rs-tile' + (p.promo ? ' rs-promo' : ''), dataset: { item: it.item }, onclick: () => pick(it),
      'aria-label': `${it.name}, ${fmtCur(p.price)}${it.unit === 'kg' ? ' / ' + t('rs.unit.kg') : ''}` },
      h('span', { class: 'rs-tile-name' }, it.name),
      h('span', { class: 'rs-tile-price' }, p.promo ? h('s', {}, fmt(p.base)) : null, h('b', {}, fmtCur(p.price)), it.unit === 'kg' ? h('small', {}, ' / ' + t('rs.unit.kg')) : null),
      h('span', { class: 'rs-tile-meta' }, rateText(it.vatRate), p.promo ? h('span', { class: 'rs-badge' }, p.promo.name) : null),
      it.code ? h('span', { class: 'rs-tile-ean', 'aria-hidden': 'true', html: eanSVG(it.code) }) : h('span', { class: 'rs-tile-plu' }, iconEl('scale'), `PLU ${it.plu || '—'}`)));
  }
}

// --- cart ----------------------------------------------------------------------------------------------------------

function paintCart() {
  const box = els.cart;
  box.textContent = '';
  if (!D.cart.lines.length) {
    box.append(h('div', { class: 'ap-empty rs-cart-empty' }, iconEl('cart'), h('p', {}, t('rs.pos.emptyHint'))));
    return;
  }
  // R.draft.lines are the computed lines (totals after discounts), aligned by index with D.cart.lines.
  const lines = R.draft?.lines || [];
  D.cart.lines.forEach((l, i) => {
    const unit = itemOf(l.item)?.unit || 'pcs';
    const step = unit === 'kg' ? 0.1 : 1;
    const qty = h('input', { class: 'ed-input rs-qty rs-num', value: String(l.qty), inputmode: 'decimal', 'aria-label': t('rs.pos.qtyOf', { name: l.name }) });
    // 'change' (commit on blur/Enter), not 'input': a half-typed "1." must not rewrite the line while typing.
    qty.addEventListener('change', () => {
      const q = Number(qty.value.replace(',', '.'));
      if (!(q >= 0)) { qty.value = String(l.qty); toast(t('rs.err.qty'), 'warn'); return; }
      D.cart.lines = setQty(D.cart.lines, i, unit === 'kg' ? Math.round(q * 1000) / 1000 : Math.round(q));
      cartChanged();
    });
    qty.addEventListener('keydown', (e) => { if (e.key === 'Enter') qty.blur(); });
    // Step buttons round to 3 decimals: 0.1 + 0.2 style float drift would otherwise show 0.30000000000000004 kg.
    const dec = h('button', { type: 'button', class: 'ed-iconbtn', 'aria-label': t('rs.pos.less'), html: icon('minus'), onclick: () => { D.cart.lines = setQty(D.cart.lines, i, Math.round((l.qty - step) * 1000) / 1000); cartChanged(); } });
    const inc = h('button', { type: 'button', class: 'ed-iconbtn', 'aria-label': t('rs.pos.more'), html: icon('plus'), onclick: () => { D.cart.lines = setQty(D.cart.lines, i, Math.round((l.qty + step) * 1000) / 1000); cartChanged(); } });
    const c = lines[i];
    const dText = l.discount ? (l.discount.pct != null ? `−${l.discount.pct} %` : `−${fmt(l.discount.amount)}`) : '';
    const disc = h('button', { type: 'button', class: 'ed-btn ed-sm rs-disc-btn' + (l.discount ? ' rs-on' : ''), title: t('rs.disc.line'), 'aria-label': t('rs.disc.lineOf', { name: l.name }), onclick: () => lineDiscountDialog(i) }, iconEl('percent'), dText || null);
    const del = h('button', { type: 'button', class: 'ed-iconbtn', 'aria-label': t('rs.pos.removeOf', { name: l.name }), title: t('rs.pos.remove'), html: icon('trash'), onclick: () => { D.cart.lines = removeLine(D.cart.lines, i); cartChanged(); } });
    box.append(h('div', { class: 'rs-line', dataset: { item: l.item } },
      h('div', { class: 'rs-line-main' },
        h('div', { class: 'rs-line-name' }, l.name, l.promo ? h('span', { class: 'rs-badge' }, l.promo) : null),
        h('div', { class: 'rs-line-sub' }, `${fmt(l.price)}${unit === 'kg' ? ' / ' + t('rs.unit.kg') : ''}`, l.base != null ? h('s', {}, fmt(l.base)) : null, ` · ${t('rs.l.vat')} ${rateText(l.vatRate)}`)),
      h('div', { class: 'rs-line-qty' }, dec, qty, inc, unit === 'kg' ? h('span', { class: 'rs-unit' }, t('rs.unit.kg')) : null),
      disc,
      h('div', { class: 'rs-line-total rs-num', dataset: { k: 'line' } }, c ? fmt(c.total) : '', c && c.total !== c.gross ? h('s', {}, fmt(c.gross)) : null),
      del));
  });
}

async function lineDiscountDialog(i) {
  const l = D.cart.lines[i];
  let kind = l.discount?.amount != null ? 'amount' : 'pct';
  let val = l.discount ? (l.discount.pct != null ? String(l.discount.pct) : amtText(l.discount.amount)) : '';
  const inp = textInput(val, (v) => { val = v; }, { inputmode: 'decimal', class: 'ed-input rs-num', id: 'rs-line-disc' });
  const body = h('div', { class: 'ed-fields' }, h('b', {}, l.name),
    seg([{ v: 'pct', l: '=%' }, { v: 'amount', l: '=' + symbol() }], kind, (v) => { kind = v; }, 'rs.disc.kind'),
    field('rs.disc.value', inp, 'rs.disc.lineHint'));
  const v = await openDialog({ title: t('rs.disc.line'), body, buttons: [{ label: t('rs.disc.none'), value: 'clear' }, { label: t('dlg.cancel'), value: null }, { label: t('dlg.apply'), value: 'ok', primary: true }] });
  if (v === 'clear') D.cart.lines = setLineDiscount(D.cart.lines, i, null);
  else if (v === 'ok') {
    const d = discountOf(kind, val);
    if (d === undefined) { toast(t('rs.err.amount'), 'warn'); return; }
    D.cart.lines = setLineDiscount(D.cart.lines, i, d);
  } else return;
  cartChanged();
}

// Tri-state result: null = no discount (empty or zero), undefined = invalid input (caller warns), object = valid.
// Percent kept to 4 decimals; amounts go through parseAmt into minor units.
// Discount from a kind and typed text: { pct } | { amount } | null (empty) | undefined (invalid).
function discountOf(kind, text) {
  const s = String(text).trim();
  if (!s) return null;
  if (kind === 'pct') { const p = Number(s.replace(',', '.')); return p >= 0 && p <= 100 ? (p ? { pct: Math.round(p * 10000) / 10000 } : null) : undefined; }
  const a = parseAmt(s);
  return a != null && a >= 0 ? (a ? { amount: a } : null) : undefined;
}

// --- totals ----------------------------------------------------------------------------------------------------------

// Module-level so the chosen discount kind survives repaints of the totals box.
let discKind = null;
function paintTotals() {
  const d = R.draft, box = els.totals;
  box.textContent = '';
  if (!D.cart.lines.length) return;
  discKind ??= D.cart.discount?.amount != null ? 'amount' : 'pct';
  const cur = D.cart.discount ? (D.cart.discount.pct != null ? String(D.cart.discount.pct) : amtText(D.cart.discount.amount)) : '';
  const inp = h('input', { class: 'ed-input rs-num rs-disc-in', value: cur, inputmode: 'decimal', placeholder: '0', 'aria-label': t('rs.disc.check') });
  const apply = () => {
    const x = discountOf(discKind, inp.value);
    inp.classList.toggle('rs-bad', x === undefined);
    if (x === undefined) return;
    D.cart.discount = x;
    saveCart(); update(true);
  };
  // Debounced live apply: the totals update while typing, without a repaint on each keystroke.
  inp.addEventListener('input', debounce(apply, 250));
  const kinds = seg([{ v: 'pct', l: '=%' }, { v: 'amount', l: '=' + symbol() }], discKind, (v) => { discKind = v; apply(); }, 'rs.disc.kind');
  box.append(h('div', { class: 'rs-disc', id: 'rs-disc' }, h('span', { class: 'ed-label' }, iconEl('percent'), t('rs.disc.check')), inp, kinds));
  els.sums = h('div', { class: 'rs-sums' });
  box.append(els.sums);
  paintSums();
}

function kv(rows) {
  const dl = h('dl', { class: 'ap-kv rs-kv' });
  // [label, value, data-k key, class]; rows with value null are skipped, which lets callers write conditional rows
  // inline as [null, null]. data-k is the e2e hook for reading amounts.
  for (const [k, v, key, cls] of rows) { if (v == null) continue; dl.append(h('dt', { class: cls || null }, k), h('dd', { class: 'rs-num' + (cls ? ' ' + cls : ''), dataset: key ? { k: key } : {} }, v)); }
  return dl;
}

// The VAT breakdown per rate (net / VAT / gross) plus the exempt base; the caption names the rounding method
// (per line or per rate), which explains one-tetri differences between the two methods.
function vatTable(vat) {
  const rows = Object.entries(vat.rates).map(([r, x]) => h('tr', { dataset: { rate: r } }, h('td', {}, r + ' %'), h('td', { class: 'rs-num' }, fmt(x.net)), h('td', { class: 'rs-num', dataset: { k: 'vat-' + r } }, fmt(x.vat)), h('td', { class: 'rs-num' }, fmt(x.gross))));
  if (vat.exempt) rows.push(h('tr', { dataset: { rate: 'none' } }, h('td', {}, t('rs.vat.none')), h('td', { class: 'rs-num' }, fmt(vat.exempt)), h('td', { class: 'rs-num' }, '—'), h('td', { class: 'rs-num', dataset: { k: 'exempt' } }, fmt(vat.exempt))));
  return h('table', { class: 'ap-table rs-vat' }, h('caption', {}, t('rs.vat.title', { m: t('rs.vat.m.' + D.cfg.vatMethod) })),
    h('thead', {}, h('tr', {}, h('th', {}, t('rs.vat.rate')), h('th', {}, t('rs.vat.net')), h('th', {}, t('rs.vat.vat')), h('th', {}, t('rs.vat.gross')))),
    h('tbody', {}, rows), h('tfoot', {}, h('tr', {}, h('th', {}, t('rs.vat.sum')), h('th', {}), h('th', { class: 'rs-num', dataset: { k: 'vat' } }, fmt(vat.vat)), h('th', { class: 'rs-num' }, fmt(vat.gross)))));
}

function paintSums() {
  const d = R.draft;
  if (!els.sums || !d) return;
  els.sums.textContent = '';
  const lineDisc = d.lines.reduce((s, l) => s + l.lineDiscount, 0), checkDisc = d.lines.reduce((s, l) => s + l.checkDiscount, 0);
  els.sums.append(kv([
    [t('rs.l.subtotal'), fmt(d.subtotal), 'subtotal'],
    lineDisc ? [t('rs.disc.lines'), '−' + fmt(lineDisc), 'lineDiscounts'] : [null, null],
    checkDisc ? [t('rs.disc.check'), '−' + fmt(checkDisc), 'checkDiscount'] : [null, null],
    [t('rs.l.total'), fmtCur(d.total), 'total', 'rs-big'],
  ]), vatTable(d.vat));
}

// --- loyalty and payment ---------------------------------------------------------------------------------------------

function paintLoyalty() {
  const box = els.loyalty;
  box.textContent = '';
  const c = D.cart.card && cardOf(D.cart.card);
  if (!c) {
    const inp = h('input', { class: 'ed-input rs-num', id: 'rs-card', placeholder: t('rs.loy.ph'), inputmode: 'numeric', list: 'rs-card-list', autocomplete: 'off', 'aria-label': t('rs.loy.card') });
    const go = () => { const x = cardOf(inp.value.replace(/\D/g, '')); if (x) attachCard(x); else toast(t('rs.loy.unknown'), 'warn'); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    inp.addEventListener('change', () => { if (cardOf(inp.value.replace(/\D/g, ''))) go(); });
    box.append(h('datalist', { id: 'rs-card-list' }, D.cards.map((x) => h('option', { value: x.number }, x.name))),
      field('rs.loy.card', h('div', { class: 'ed-row' }, inp, small(button('rs.loy.attach', 'points', go)))));
    return;
  }
  // maxSpend caps points by balance and by maxSpendPct of the total (receipt/loyalty.js).
  const max = R.draft ? maxSpend(R.draft.total, { balance: c.balance, ...D.cfg.loyalty }) : 0;
  const pts = h('input', { class: 'ed-input rs-num rs-points', id: 'rs-points', value: String(D.cart.pay.points || ''), inputmode: 'numeric', placeholder: '0', disabled: c.blocked, 'aria-label': t('rs.loy.spend') });
  pts.addEventListener('input', () => { D.cart.pay.points = Math.max(0, parseInt(pts.value, 10) || 0); saveCart(); update(true); });
  const maxBtn = small(button('rs.loy.max', null, () => { D.cart.pay.points = max; pts.value = String(max || ''); saveCart(); update(true); }));
  maxBtn.disabled = c.blocked || !max;
  const detach = h('button', { type: 'button', class: 'ed-iconbtn', title: t('rs.loy.detach'), 'aria-label': t('rs.loy.detach'), html: icon('close'), onclick: () => { D.cart.card = null; D.cart.pay.points = 0; saveCart(); paintLoyalty(); update(); } });
  box.append(h('div', { class: 'rs-loy-card' + (c.blocked ? ' rs-blocked' : '') }, iconEl('points'),
    h('div', { class: 'rs-loy-who' }, h('b', {}, c.name), h('span', { class: 'rs-num' }, c.number)),
    h('div', { class: 'rs-loy-bal' }, c.blocked ? t('rs.loy.blocked') : t('rs.loy.balance', { n: c.balance, v: fmtCur(c.balance * D.cfg.loyalty.pointValue) })), detach),
  c.blocked ? null : field('rs.loy.spend', h('div', { class: 'ed-row' }, pts, maxBtn), '=' + t('rs.loy.spendHint', { max, pct: D.cfg.loyalty.maxSpendPct, v: fmtCur(D.cfg.loyalty.pointValue) })));
}

function paintPayBox() {
  const box = els.payBox, p = D.cart.pay;
  box.textContent = '';
  const methods = seg([{ v: 'cash', l: 'rs.m.cash', icon: 'cash' }, { v: 'card', l: 'rs.m.card', icon: 'creditCard' }, { v: 'mixed', l: 'rs.m.mixed', icon: 'layers' }], p.method,
    (v) => { p.method = v; saveCart(); paintPayBox(); update(true); }, 'rs.pay.method');
  methods.id = 'rs-method';
  box.append(methods);
  if (p.method === 'mixed') {
    const cardIn = textInput(p.card, (v) => { p.card = v; saveCart(); update(true); }, { id: 'rs-cardpay', inputmode: 'decimal', class: 'ed-input rs-num', placeholder: '0.00' });
    box.append(field('rs.pay.cardPart', cardIn, 'rs.pay.cardHint'));
  }
  if (p.method !== 'card') {
    const cash = textInput(p.cash, (v) => { p.cash = v; saveCart(); update(true); }, { id: 'rs-tendered', inputmode: 'decimal', class: 'ed-input rs-num rs-tendered', placeholder: t('rs.pay.exact') });
    els.tendered = cash;
    els.quick = h('div', { class: 'rs-quick', role: 'group', 'aria-label': t('rs.pay.quick') });
    box.append(field('rs.pay.tendered', cash), els.quick);
  } else { els.tendered = null; els.quick = null; }
}

// Banknote suggestions above the cash due: exact, then the next multiples of 1, 5, 10, 20, 50, 100, 200 units.
// Candidate amounts: exact due first, then due rounded up to each banknote size; at most 5 buttons. Computed in
// minor units (unit = 10^digits), so ceil() works on integers.
function paintQuick(due) {
  const q = els.quick;
  if (!q) return;
  q.textContent = '';
  if (!(due > 0)) return;
  const unit = 10 ** D.cfg.digits;
  const out = [due];
  for (const n of [1, 5, 10, 20, 50, 100, 200]) { const v = Math.ceil(due / (n * unit)) * n * unit; if (!out.includes(v)) out.push(v); if (out.length >= 5) break; }
  for (const v of out) q.append(h('button', { type: 'button', class: 'ed-btn ed-sm rs-num', onclick: () => { D.cart.pay.cash = amtText(v); els.tendered.value = D.cart.pay.cash; saveCart(); update(true); } }, fmt(v)));
}

function paintPayOut() {
  const d = R.draft, box = els.payOut;
  box.textContent = '';
  if (!d || !D.cart.lines.length) return;
  const p = d.payment;
  box.append(kv([
    p.pointsValue ? [t('rs.pay.pointsPart', { n: p.points }), '−' + fmt(p.pointsValue), 'points'] : [null, null],
    [t('rs.pay.payable'), fmt(p.payable), 'payable'],
    p.card ? [t('rs.l.card'), fmt(p.card), 'card'] : [null, null],
    p.cashDue || D.cart.pay.method !== 'card' ? [t('rs.pay.cashDue'), fmt(p.cashDue), 'cashDue'] : [null, null],
    p.rounding ? [t('rs.l.rounding'), fmt(p.rounding), 'rounding'] : [null, null],
    p.tendered != null ? [t('rs.l.tendered'), fmt(p.tendered), 'tendered'] : [null, null],
    p.tendered != null ? [t('rs.l.change'), fmtCur(p.change), 'change', 'rs-big rs-change'] : [null, null],
    d.points ? [t('rs.l.earned'), '+' + d.points.earned, 'earned'] : [null, null],
  ]));
  // role=alert: the reason the Pay button is disabled is announced, not only shown.
  if (d.errors.length) box.append(h('div', { class: 'rs-errors', role: 'alert' }, d.errors.map((e) => h('div', { class: 'ed-hint ed-hint-warn' }, iconEl('warn'), errText(e)))));
  const btn = h('button', { type: 'button', id: 'rs-pay', class: 'ed-btn ed-primary rs-pay-btn', onclick: pay, disabled: !!d.errors.length },
    iconEl(D.cart.pay.method === 'card' ? 'creditCard' : 'cash'), t('rs.pay.go', { v: fmtCur(d.total) }));
  box.append(btn, h('div', { class: 'ed-hint' }, t('rs.pay.keys')));
  paintQuick(p.cashDue);
}

// --- receipt preview -----------------------------------------------------------------------------------------------

function paintReceipt() {
  const box = els.receipt;
  box.textContent = '';
  // Shows the paid receipt until the next item is added; otherwise the live draft (unnumbered, "draft" time).
  const doc = R.final || (D.cart.lines.length ? R.draft : null);
  const views = seg([{ v: 'text', l: 'rs.r.viewText' }, { v: 'html', l: 'rs.r.viewHtml' }], R.view, (v) => { R.view = v; lsSet('rs-pos-view', v); paintReceipt(); }, 'rs.r.view');
  box.append(h('div', { class: 'ap-row rs-r-ctl' }, paperSeg(() => paintReceipt()), views));
  if (!doc) { box.append(h('div', { class: 'ap-empty' }, iconEl('receipt'), h('p', {}, t('rs.r.empty')))); return; }
  box.append(h('div', { class: 'rs-r-state' + (R.final ? ' rs-final' : '') }, R.final ? t('rs.r.final', { n: R.final.number }) : t('rs.r.draft')));
  const paper = D.cfg.paper;
  if (R.view === 'html') box.append(h('div', { class: 'rs-html-wrap' }, receiptHTML(doc, paper)));
  else {
    const codes = doc.number != null ? h('div', { class: 'rs-paper-codes' }, h('div', { class: 'rs-r-bar', html: barcodeMarkupSafe(doc) }), h('div', { class: 'rs-r-qr', html: qrSafe(doc) })) : null;
    box.append(paperView(receiptText(doc, paper), paper, codes));
  }
  const acts = h('div', { class: 'ap-actions rs-r-acts' });
  if (R.final) {
    acts.append(button('rs.print', 'print', () => printReceipt(R.final, paper), 'primary'),
      button('rs.r.copy', 'copy', () => copyText(receiptText(R.final, paper))),
      button('rs.r.txt', 'download', () => download(receiptText(R.final, paper) + '\n', `receipt-${receiptCode(R.final)}.txt`, 'text/plain')),
      button('rs.pos.newSale', 'plus', () => { R.final = null; render(); els.scan?.focus(); }));
  } else acts.append(button('rs.r.printDraft', 'print', () => printReceipt(R.draft, paper)));
  box.append(acts);
  if (R.final) box.append(h('div', { class: 'ed-hint rs-qr-payload' }, t('rs.r.qrIs'), ' ', h('code', {}, qrPayload(R.final))));
}
// try/catch: barcode or QR encoding failing (e.g. an unexpected character in a setting) must not hide the receipt.
// Barcode / QR markup; a failure must not break the receipt.
const barcodeMarkupSafe = (doc) => { try { return barcodeMarkup(doc); } catch { return ''; } };
const qrSafe = (doc) => { try { return qrMarkup(doc); } catch { return ''; } };

// --- shift ---------------------------------------------------------------------------------------------------------

function paintShift() {
  const box = els.shift;
  box.textContent = '';
  box.append(h('div', {}, shiftBadge()));
  if (!D.shift) {
    box.append(h('p', { class: 'ed-hint' }, t('rs.sh.closedHint')),
      h('div', { class: 'ap-actions' }, Object.assign(button('rs.sh.open', 'clock', async () => { if (await openShiftDialog()) paintShift(); }, 'primary'), { id: 'rs-open-shift' })));
    return;
  }
  const x = xReport();
  if (shiftIsExpired()) box.append(h('div', { class: 'ed-hint ed-hint-warn', role: 'alert' }, t('rs.sh.expired')));
  box.append(kv([
    [t('rs.sh.receipts'), String(shiftDocs().length), 'receipts'],
    [t('rs.l.sales'), fmt(x.sales.total), 'sales'],
    [t('rs.l.returns'), fmt(x.returns.total), 'returns'],
    [t('rs.l.expected'), fmtCur(x.expectedCash), 'expected'],
  ]), h('div', { class: 'ap-actions' },
    small(button('rs.sh.x', 'sheet', () => showReport(xReport()))),
    Object.assign(small(button('rs.sh.close', 'lockClosed', async () => { if (await closeShiftDialog()) paintShift(); })), { id: 'rs-close-shift' })));
}

// ---------------------------------------------------------------------------------------------------------------
// Update

function update(keepPay = false) {
  // The cart rows are patched in place (line totals only) instead of repainting the cart: the quantity inputs keep
  // focus while discounts redistribute.
  R.draft = D.cart.lines.length ? makeDoc(docMeta(null)) : null;
  // Line totals of the cart rows (discount shares change with every edit).
  const rows = $$('.rs-line-total', els.cart);
  rows.forEach((el, i) => { const l = R.draft?.lines[i]; if (!l) return; el.textContent = fmt(l.total); if (l.total !== l.gross) el.append(h('s', {}, fmt(l.gross))); });
  if (!keepPay || !els.sums) paintTotals(); else paintSums();
  if (!keepPay) paintLoyalty();
  paintPayOut();
  paintReceipt();
}

// ---------------------------------------------------------------------------------------------------------------
// Editors: catalogue, promotions, settings

// Editors work on a structuredClone: Cancel discards everything, Save validates row by row. Price text is kept in
// r._price until Save so a half-typed value is never parsed into minor units mid-edit.
async function catalogDialog() {
  const rows = structuredClone(D.catalog);
  const table = h('tbody');
  const vatOpts = () => [...new Set([D.cfg.vatDefault, 18, 0])].map((r) => ({ v: String(r), l: `=${r} %` })).concat([{ v: 'none', l: 'rs.vat.none' }]);
  const paint = () => {
    table.textContent = '';
    rows.forEach((r, i) => {
      const inp = (k, attrs = {}) => { const x = h('input', { class: 'ed-input', value: r[k] ?? '', ...attrs }); x.addEventListener('input', () => { r[k] = x.value; }); return x; };
      const price = h('input', { class: 'ed-input rs-num', value: amtText(r.price), inputmode: 'decimal', 'aria-label': t('rs.cat.price') });
      price.addEventListener('input', () => { r._price = price.value; });
      const vat = select(vatOpts(), r.vatRate == null ? 'none' : String(r.vatRate), (v) => { r.vatRate = v === 'none' ? null : Number(v); });
      vat.setAttribute('aria-label', t('rs.cat.vat'));
      const unit = select([{ v: 'pcs', l: 'rs.unit.pcs' }, { v: 'kg', l: 'rs.unit.kg' }], r.unit, (v) => { r.unit = v; });
      unit.setAttribute('aria-label', t('rs.cat.unit'));
      table.append(h('tr', {},
        h('td', {}, inp('name', { 'aria-label': t('rs.cat.name') })),
        h('td', {}, inp('code', { class: 'ed-input rs-num', inputmode: 'numeric', 'aria-label': 'EAN', placeholder: 'EAN-13' })),
        h('td', {}, inp('plu', { class: 'ed-input rs-num rs-w5', inputmode: 'numeric', 'aria-label': 'PLU', maxlength: 5 })),
        h('td', {}, price), h('td', {}, vat), h('td', {}, unit),
        h('td', {}, inp('cat', { list: 'rs-cat-list', 'aria-label': t('rs.cat.cat') })),
        h('td', {}, h('button', { type: 'button', class: 'ed-iconbtn', 'aria-label': t('rs.pos.remove'), html: icon('trash'), onclick: () => { rows.splice(i, 1); paint(); } }))));
    });
  };
  paint();
  // KNOWN DEFECT: a row holds five <input>s (name, EAN, PLU, price, category; VAT and unit are <select>s), so
  // .at(-8) focuses the PLU field of the previous row, not the new row's name. Fix: .at(-5).
  const add = small(button('rs.cat.add', 'plus', () => { rows.push({ item: 'i' + Date.now().toString(36), name: '', code: '', plu: '', price: 0, vatRate: D.cfg.vatDefault, unit: 'pcs', cat: '' }); paint(); $$('input', table).at(-8)?.focus(); }));
  const reset = small(button('rs.cat.demo', 'undo', () => { rows.splice(0, rows.length, ...demoCatalog()); paint(); }));
  const body = h('div', { class: 'ed-fields' },
    h('datalist', { id: 'rs-cat-list' }, CATEGORIES.map((c) => h('option', { value: c }, catName(c)))),
    h('div', { class: 'ap-table-wrap rs-edit-wrap' }, h('table', { class: 'ap-table rs-edit' },
      h('thead', {}, h('tr', {}, ['rs.cat.name', '=EAN', '=PLU', 'rs.cat.price', 'rs.cat.vat', 'rs.cat.unit', 'rs.cat.cat', '='].map((k) => h('th', {}, k.startsWith('=') ? k.slice(1) : t(k))))), table)),
    h('div', { class: 'ap-row' }, add, reset), h('div', { class: 'ed-hint' }, t('rs.cat.hint')));
  const v = await openDialog({ title: t('rs.cat.edit'), body, wide: true, className: 'rs-dlg-wide', buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('ap.save'), value: 'ok', primary: true }] });
  if (v !== 'ok') return;
  const out = [], bad = [];
  for (const r of rows) {
    const price = r._price != null ? parseAmt(r._price) : r.price;
    const code = String(r.code || '').replace(/\D/g, '');
    if (!String(r.name).trim() || price == null || price < 0) { bad.push(r.name || '?'); continue; }
    // EAN validated by length and GS1 check digit: a typo would otherwise make the product unscannable.
    if (code && !(/^\d{8}$|^\d{12,14}$/.test(code) && hasValidCheck(code))) { bad.push(`${r.name}: EAN ${code}`); continue; }
    const { _price, ...rest } = r;
    out.push({ ...rest, name: String(r.name).trim(), price, code, plu: String(r.plu || '').replace(/\D/g, '').slice(0, 5), cat: String(r.cat || '').trim() });
  }
  if (bad.length) toast(t('rs.cat.bad', { list: bad.join(', ') }), 'warn');
  D.catalog = out;
  save.catalog();
  render();
}

async function promoDialog() {
  const rows = structuredClone(D.promos);
  const list = h('div', { class: 'rs-promos' });
  const targets = () => [{ v: '', l: 'rs.promo.choose' }, ...CATEGORIES.map((c) => ({ v: 'c:' + c, l: '=' + t('rs.promo.catT', { c: catName(c) }) })), ...D.catalog.map((it) => ({ v: 'i:' + it.item, l: '=' + it.name }))];
  const paint = () => {
    list.textContent = '';
    rows.forEach((p, i) => {
      const name = textInput(p.name, (v) => { p.name = v; }, { 'aria-label': t('rs.promo.name'), placeholder: t('rs.promo.name') });
      // Switching percent/fixed keeps the typed value text (p._value) so the user does not lose it.
      const kind = select([{ v: 'percent', l: 'rs.promo.percent' }, { v: 'fixed', l: 'rs.promo.fixed' }], p.kind, (v) => { p.kind = v; p._value = valIn.value; });
      kind.setAttribute('aria-label', t('rs.promo.kind'));
      const valIn = textInput(p._value ?? (p.kind === 'percent' ? String(p.value) : amtText(p.value)), (v) => { p._value = v; }, { inputmode: 'decimal', class: 'ed-input rs-num', 'aria-label': t('rs.promo.value') });
      const tv = p.categories?.length ? 'c:' + p.categories[0] : p.items?.length ? 'i:' + p.items[0] : '';
      const target = select(targets(), tv, (v) => { p.items = v.startsWith('i:') ? [v.slice(2)] : []; p.categories = v.startsWith('c:') ? [v.slice(2)] : []; });
      target.setAttribute('aria-label', t('rs.promo.target'));
      const from = textInput(p.from, (v) => { p.from = v; }, { type: 'date', 'aria-label': t('rs.promo.from') });
      const to = textInput(p.to, (v) => { p.to = v; }, { type: 'date', 'aria-label': t('rs.promo.to') });
      list.append(h('div', { class: 'rs-promo-row' }, name, kind, valIn, target, from, to,
        h('button', { type: 'button', class: 'ed-iconbtn', 'aria-label': t('rs.pos.remove'), html: icon('trash'), onclick: () => { rows.splice(i, 1); paint(); } })));
    });
    if (!rows.length) list.append(h('div', { class: 'ap-empty' }, t('rs.promo.none')));
  };
  paint();
  const today = todayISO();
  const add = small(button('rs.promo.add', 'plus', () => { rows.push({ id: 'p' + Date.now().toString(36), name: '', kind: 'percent', value: 10, items: [], categories: [], from: today, to: today.slice(0, 4) + '-12-31' }); paint(); }));
  const reset = small(button('rs.cat.demo', 'undo', () => { rows.splice(0, rows.length, ...demoPromos()); paint(); }));
  const body = h('div', { class: 'ed-fields' }, list, h('div', { class: 'ap-row' }, add, reset), h('div', { class: 'ed-hint' }, t('rs.promo.hint')));
  const v = await openDialog({ title: t('rs.promo.edit'), body, wide: true, className: 'rs-dlg-wide', buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('ap.save'), value: 'ok', primary: true }] });
  if (v !== 'ok') return;
  // Promotions without a name or a target are dropped silently on save; values are clamped (0..100 %, >= 0 amount).
  D.promos = rows.filter((p) => p.name.trim() && (p.items?.length || p.categories?.length)).map(({ _value, ...p }) => {
    const raw = _value ?? (p.kind === 'percent' ? String(p.value) : amtText(p.value));
    const value = p.kind === 'percent' ? Math.min(100, Math.max(0, Number(String(raw).replace(',', '.')) || 0)) : Math.max(0, parseAmt(raw) ?? 0);
    return { ...p, name: p.name.trim(), value, from: p.from || '2000-01-01', to: p.to || '2099-12-31' };
  });
  save.promos();
  render();
}

async function settingsDialog() {
  const c = structuredClone(D.cfg);
  const L = c.loyalty;
  let pv = amtText(L.pointValue), open = amtText(c.openingCash);
  const curIn = textInput(c.currency, (v) => { c.currency = v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3); }, { list: 'rs-cur-list', class: 'ed-input rs-w5', maxlength: 3, 'aria-label': t('rs.set.currency') });
  const num = (v, fn, attrs = {}) => textInput(String(v), fn, { inputmode: 'decimal', class: 'ed-input rs-num', ...attrs });
  const cards = h('div', { class: 'rs-cards' });
  const paintCards = () => {
    cards.textContent = '';
    for (const x of D.cards) cards.append(h('div', { class: 'rs-card-row' }, h('span', {}, x.name), h('code', {}, x.number), h('span', { class: 'rs-num' }, String(x.balance)), x.blocked ? h('span', { class: 'rs-badge rs-badge-bad' }, t('rs.loy.blocked')) : null));
  };
  paintCards();
  const addCard = small(button('rs.loy.add', 'plus', () => {
    const n = D.cards.length + 1;
    // Random component in the sequence argument: card numbers stay unique even after cards were removed and re-added.
    D.cards.push({ number: cardNumber('29', n + Math.floor(Math.random() * 9000) * 10), name: t('rs.loy.newName', { n }), balance: 0, blocked: false });
    save.cards(); paintCards();
  }));
  const resetCards = small(button('rs.cat.demo', 'undo', () => { D.cards = demoCards(); save.cards(); paintCards(); }));
  const body = h('div', { class: 'ed-fields rs-settings' },
    h('datalist', { id: 'rs-cur-list' }, COMMON_CURRENCIES.map((x) => h('option', { value: x }, SYMBOLS[x] || x))),
    h('h3', {}, t('rs.set.money')),
    h('div', { class: 'ed-grid2' }, field('rs.set.currency', curIn, 'rs.set.currencyHint'),
      field('rs.set.decimal', seg([{ v: '.', l: '=1.50' }, { v: ',', l: '=1,50' }], c.decimal, (v) => { c.decimal = v; }, 'rs.set.decimal'))),
    h('div', { class: 'ed-grid2' }, field('rs.set.vat', num(c.vatDefault, (v) => { c.vatDefault = Math.max(0, Math.min(100, Number(v.replace(',', '.')) || 0)); })),
      field('rs.set.cashStep', select([1, 5, 10, 50, 100].map((v) => ({ v, l: '=' + amtText(v) })), c.cashStep, (v) => { c.cashStep = +v; }), 'rs.set.cashStepHint')),
    field('rs.set.vatMethod', seg([{ v: 'line', l: 'rs.vat.m.line' }, { v: 'rate', l: 'rs.vat.m.rate' }], c.vatMethod, (v) => { c.vatMethod = v; }, 'rs.set.vatMethod'), 'rs.set.vatMethodHint'),
    field('rs.set.mode', select(['half-up', 'half-even', 'down', 'up'].map((v) => ({ v, l: 'rs.mode.' + v })), c.mode, (v) => { c.mode = v; }), 'rs.set.modeHint'),
    h('h3', {}, t('rs.set.seller')),
    h('div', { class: 'ed-grid2' }, field('rs.set.name', textInput(c.seller.name, (v) => { c.seller.name = v; })), field('rs.l.taxId', textInput(c.seller.taxId, (v) => { c.seller.taxId = v; }, { inputmode: 'numeric' }))),
    h('div', { class: 'ed-grid2' }, field('rs.set.object', textInput(c.seller.object, (v) => { c.seller.object = v; })), field('rs.set.address', textInput(c.seller.address, (v) => { c.seller.address = v; }))),
    h('div', { class: 'ed-grid2' }, field('rs.l.cashier', textInput(c.cashier, (v) => { c.cashier = v; })), field('rs.sh.opening', num(open, (v) => { open = v; }))),
    field('rs.set.footer', textInput(c.footer, (v) => { c.footer = v; }, { multiline: true, rows: 2, placeholder: t('rs.l.thanks') })),
    h('h3', {}, t('rs.set.loyalty')),
    h('div', { class: 'ed-grid2' }, field('rs.set.earn', num(L.earnPct, (v) => { L.earnPct = Math.max(0, Number(v.replace(',', '.')) || 0); })), field('rs.set.pointValue', num(pv, (v) => { pv = v; }))),
    field('rs.set.maxSpend', num(L.maxSpendPct, (v) => { L.maxSpendPct = Math.max(0, Math.min(100, Number(v.replace(',', '.')) || 0)); })),
    cards, h('div', { class: 'ap-row' }, addCard, resetCards));
  const v = await openDialog({ title: t('rs.set.title'), body, wide: true, buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('ap.save'), value: 'ok', primary: true }] });
  if (v !== 'ok') return;
  if (!/^[A-Z]{3}$/.test(c.currency)) c.currency = D.cfg.currency;
  // Minor-unit digits follow the currency (JPY 0, most 2). Stored prices are integers in the old unit and are NOT
  // rescaled; the toast warns that the catalogue may need re-entering.
  c.digits = digitsOf(c.currency);
  if (c.digits !== D.cfg.digits) toast(t('rs.set.digitsChanged', { d: c.digits }), 'warn');
  const pvx = parseAmt(pv), ox = parseAmt(open);
  if (pvx > 0) L.pointValue = pvx;
  if (ox != null && ox >= 0) c.openingCash = ox;
  D.cfg = c;
  save.cfg();
  render();
}

// ---------------------------------------------------------------------------------------------------------------
// Keyboard: a scanner typing outside a field lands in the scan field; F2 scan, F4 tendered, F9 / Ctrl+Enter pay.

// Ignored while a dialog is open (.ed-backdrop). A digit typed with focus outside any field is redirected into the
// scan field: a keyboard-wedge scanner then works without the cashier clicking the field first.
// KNOWN DEFECT: the first redirected digit updates R.filter but does not call paintTiles(), so the tile filter lags
// one keystroke behind (later digits arrive as native input events). Fix: call paintTiles() after setting R.filter.
document.addEventListener('keydown', (e) => {
  if (document.querySelector('.ed-backdrop')) return;
  const tgt = e.target;
  const editable = tgt && (tgt.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName));
  if (e.key === 'F2') { e.preventDefault(); els.scan?.focus(); return; }
  if (e.key === 'F4') { e.preventDefault(); els.tendered?.focus(); return; }
  if (e.key === 'F9' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); pay(); return; }
  if (!editable && !e.ctrlKey && !e.metaKey && !e.altKey && /^[0-9]$/.test(e.key) && els.scan) {
    e.preventDefault();
    els.scan.focus();
    els.scan.value += e.key;
    R.filter = els.scan.value;
  }
});

startShell('pos', () => render());
render();
