// receipt-studio/returns.js - the returns page: pick a past sale receipt (search by number), return its lines fully or
// partially (what is left after earlier returns, receipt/returns.js), see the return at the prices actually paid with
// its VAT and the refund split (cash in the share cash had in a mixed sale, the rest to the card, spent points refunded
// and earned points reversed), make the return document (receipt/doc.js returnDoc) and print its receipt.
//
// Rules a return must obey (enforced by receipt/returns.js + receipt/doc.js, surfaced here):
// - Never more than was sold minus what earlier returns already took back (returnable(lines, earlier)).
// - Refund at the prices actually paid, i.e. after line, check and promotion discounts, so a customer cannot buy
//   with a discount and return at full price. VAT is recomputed on those amounts.
// - Refund split mirrors the sale: cash share of a mixed payment back in cash, the rest to the card; points spent
//   come back, points earned are reversed.
// The page keeps only selection and typed quantities (R); the return document is recomputed for every keystroke
// and frozen only on confirmation, exactly like the POS draft.
import {
  D, addDoc, docMeta, fmt, fmtCur, fmtQty, fmtTime, itemOf, methodName, movePoints, nextNumber, openShiftDialog,
  paperSeg, paperView, printReceipt, rateText, receiptText, returnsOf, shiftBadge, shiftIsExpired, startShell, errText,
} from './common.js';
import { button, card, t, toast } from '../ui/app.js';
import { $, debounce, h, lsGet, lsSet } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { returnDoc } from '../receipt/doc.js';
import { returnable } from '../receipt/returns.js';

const main = $('#main');
main.classList.add('rs-returns');
// R.sel persists across reloads (the cashier returns to the same receipt); quantities do not, on purpose.
const R = { sel: lsGet('rs-ret-sel', null), q: '', qty: {}, done: null };
const els = {};

// Newest first; slice() before reverse() because reverse() mutates and D.journal is shared state.
const sales = () => D.journal.filter((d) => d.kind === 'sale').slice().reverse();
const selected = () => D.journal.find((d) => d.kind === 'sale' && d.number === R.sel) || null;

function render() {
  main.textContent = '';
  // KNOWN DEFECT (accessibility): role=listbox/option promises arrow-key navigation and a single tab stop, but the
  // options are ordinary buttons with no key handling. Fix: drop the roles (a plain list of buttons is accessible),
  // or implement roving tabindex with ArrowUp/ArrowDown.
  els.list = h('div', { class: 'rs-salelist', role: 'listbox', 'aria-label': t('rs.ret.pick') });
  els.detail = h('div', { class: 'rs-col' });
  const search = h('input', { class: 'ed-input', type: 'search', id: 'rs-ret-search', placeholder: t('rs.ret.searchPh'), 'aria-label': t('rs.ret.search'), value: R.q, inputmode: 'numeric' });
  search.addEventListener('input', debounce(() => { R.q = search.value.trim(); paintList(); }, 120));
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    // Enter with a scanned receipt barcode: the code is shift (4) + number (6) digits, so the last 6 digits are the
    // receipt number (see common.js receiptCode).
    const n = parseInt(search.value.replace(/\D/g, '').slice(-6), 10);
    const s = sales().find((d) => d.number === n);
    if (s) choose(s.number);
  });
  const left = card('rs.ret.pick', h('div', {}, shiftBadge()), search, els.list);
  main.append(h('div', { class: 'rs-ret-work' }, left, els.detail));
  paintList();
  paintDetail();
}

function paintList() {
  const box = els.list;
  box.textContent = '';
  const q = R.q.replace(/^#/, '');
  // Match on the typed digits or on the receipt number decoded from a full scanned code. Capped at 200 rendered rows.
  const list = sales().filter((d) => !q || String(d.number).includes(q) || String(d.number) === String(parseInt(q.slice(-6), 10)));
  if (!list.length) { box.append(h('div', { class: 'ap-empty' }, t(D.journal.length ? 'rs.ret.noMatch' : 'rs.ret.none'))); return; }
  for (const d of list.slice(0, 200)) {
    const back = returnsOf(d).reduce((s, r) => s + r.total, 0);
    box.append(h('button', { type: 'button', role: 'option', class: 'rs-sale' + (d.number === R.sel ? ' rs-on' : ''), 'aria-selected': String(d.number === R.sel), dataset: { n: String(d.number) }, onclick: () => choose(d.number) },
      h('b', {}, '#' + d.number), h('span', { class: 'rs-sale-t' }, fmtTime(d.ts)), h('span', { class: 'rs-num rs-sale-sum' }, fmtCur(d.total)),
      h('span', { class: 'rs-sale-m' }, methodName(d.payment?.method), back ? h('span', { class: 'rs-badge' }, back >= d.total ? t('rs.ret.full') : t('rs.ret.partial', { v: fmt(back) })) : null)));
  }
}

function choose(n) {
  R.sel = n; R.qty = {}; R.done = null;
  lsSet('rs-ret-sel', n);
  paintList(); paintDetail();
}

// Quantities keyed by item id: returnable() aggregates a sale per item, so the same product sold on two lines is
// returned as one quantity.
const request = () => Object.entries(R.qty).filter(([, q]) => q > 0).map(([item, qty]) => ({ item, qty }));
const opts = () => ({ mode: D.cfg.mode, vatMethod: D.cfg.vatMethod });

function paintDetail() {
  const box = els.detail;
  box.textContent = '';
  if (R.done) { box.append(doneCard(R.done)); }
  const sale = selected();
  if (!sale) { if (!R.done) box.append(card('rs.ret.title', h('div', { class: 'ap-empty' }, iconEl('back'), h('p', {}, t('rs.ret.choose'))))); return; }
  const earlier = returnsOf(sale);
  const left = returnable(sale.lines, earlier), sold = returnable(sale.lines, []);
  const tbody = h('tbody');
  for (const [item, x] of Object.entries(left)) {
    // Unit fallback for items deleted from the catalogue since the sale: integer sold quantity = pieces, else kg.
    const unit = itemOf(item)?.unit || (Number.isInteger(sold[item].qty) ? 'pcs' : 'kg');
    const inp = h('input', { class: 'ed-input rs-num rs-qty', value: R.qty[item] ? String(R.qty[item]) : '', inputmode: 'decimal', placeholder: '0', disabled: !(x.qty > 0), 'aria-label': t('rs.ret.qtyOf', { name: x.name }), dataset: { item } });
    inp.addEventListener('input', () => { const q = Number(inp.value.replace(',', '.')); R.qty[item] = q > 0 ? Math.round(q * 1000) / 1000 : 0; paintPreview(); });
    const all = h('button', { type: 'button', class: 'ed-btn ed-sm', disabled: !(x.qty > 0), onclick: () => { R.qty[item] = x.qty; inp.value = String(x.qty); paintPreview(); } }, t('rs.ret.all'));
    tbody.append(h('tr', { dataset: { item } },
      h('td', {}, x.name, h('div', { class: 'ed-hint' }, rateText(x.vatRate))),
      h('td', { class: 'rs-num' }, fmtQty(sold[item].qty, unit)), h('td', { class: 'rs-num' }, fmt(sold[item].amount)),
      h('td', { class: 'rs-num' }, fmtQty(x.qty, unit)), h('td', {}, h('div', { class: 'ed-row' }, inp, all))));
  }
  const allBtn = button('rs.ret.allLines', 'back', () => { for (const [item, x] of Object.entries(left)) if (x.qty > 0) R.qty[item] = x.qty; paintDetail(); });
  allBtn.classList.add('ed-sm');
  const p = sale.payment || {};
  const info = h('dl', { class: 'ap-kv rs-kv' },
    h('dt', {}, t('rs.ret.sale')), h('dd', {}, `#${sale.number} · ${fmtTime(sale.ts)}`),
    h('dt', {}, t('rs.vat.sum')), h('dd', { class: 'rs-num' }, fmtCur(sale.total)),
    h('dt', {}, t('rs.pay.method')), h('dd', {}, methodName(p.method) + (p.method === 'mixed' ? ` (${t('rs.l.cash')} ${fmt(p.cash)} · ${t('rs.l.card')} ${fmt(p.card)})` : '')),
    p.pointsValue ? [h('dt', {}, t('rs.l.points')), h('dd', {}, `${p.points} · ${fmt(p.pointsValue)}`)] : null,
    earlier.length ? [h('dt', {}, t('rs.ret.earlier')), h('dd', {}, earlier.map((r) => `#${r.number} ${fmt(r.total)}`).join(', '))] : null);
  els.preview = h('div', { class: 'rs-ret-prev' });
  const linesCard = card(null, h('div', { class: 'rs-card-h' }, h('h2', { class: 'ap-card-h' }, t('rs.ret.title')), h('span', { class: 'ed-spacer' }), allBtn), info,
    h('div', { class: 'ap-table-wrap' }, h('table', { class: 'ap-table rs-ret-table' },
      h('thead', {}, h('tr', {}, ['rs.ret.item', 'rs.ret.sold', 'rs.ret.paid', 'rs.ret.left', 'rs.ret.qty'].map((k) => h('th', {}, t(k))))), tbody)),
    els.preview);
  box.append(linesCard);
  const orig = h('details', { class: 'rs-details' }, h('summary', {}, iconEl('chevRight'), t('rs.ret.original')), paperView(receiptText(sale, D.cfg.paper), D.cfg.paper));
  box.append(card(null, orig));
  paintPreview();
}

function paintPreview() {
  const sale = selected(), box = els.preview;
  if (!sale || !box) return;
  box.textContent = '';
  const req = request();
  if (!req.length) { box.append(h('div', { class: 'ed-hint' }, t('rs.ret.enterQty'))); return; }
  const doc = returnDoc(docMeta(null), sale, req, returnsOf(sale), opts());
  const pay = doc.payment;
  const rows = [
    [t('rs.ret.total'), fmtCur(doc.total), 'total', 'rs-big'],
    ...Object.entries(doc.vat.rates).map(([r, x]) => [`${t('rs.l.vat')} ${r} %`, fmt(x.vat), 'vat-' + r]),
    doc.vat.exempt ? [t('rs.l.exempt'), fmt(doc.vat.exempt), 'exempt'] : null,
    pay.cash ? [t('rs.ret.cash'), fmt(pay.cash), 'cash'] : null,
    pay.card ? [t('rs.ret.card'), fmt(pay.card), 'card'] : null,
    doc.points.refund ? [t('rs.ret.pointsBack'), `+${doc.points.refund} (${fmt(pay.pointsValue)})`, 'refund'] : null,
    doc.points.reverse ? [t('rs.ret.reverse'), `−${doc.points.reverse}`, 'reverse'] : null,
  ].filter(Boolean);
  const dl = h('dl', { class: 'ap-kv rs-kv' });
  for (const [k, v, key, cls] of rows) dl.append(h('dt', { class: cls || null }, k), h('dd', { class: 'rs-num' + (cls ? ' ' + cls : ''), dataset: { k: key } }, v));
  box.append(h('h3', {}, t('rs.ret.refund')), dl);
  if (doc.errors.length) box.append(h('div', { class: 'rs-errors', role: 'alert' }, doc.errors.map((e) => h('div', { class: 'ed-hint ed-hint-warn' }, iconEl('warn'), errText(e.code) + (e.available != null ? ` (${e.available})` : '')))));
  const go = button('rs.ret.go', 'back', make, 'primary');
  go.id = 'rs-ret-go';
  go.disabled = !doc.lines.length || !!doc.errors.length;
  box.append(h('div', { class: 'ap-actions' }, go));
}

async function make() {
  const sale = selected();
  if (!sale) return;
  const req = request();
  if (!req.length) return;
  if (!D.shift && !(await openShiftDialog())) return;
  if (shiftIsExpired()) { toast(t('rs.sh.expired'), 'error'); return; }
  // Same two-phase pattern as the POS pay(): validate on an unnumbered draft, then consume a number. The return is
  // recomputed against the journal at this moment, so a return made in another tab meanwhile is respected.
  const test = returnDoc(docMeta(null), sale, req, returnsOf(sale), opts());
  if (test.errors.length || !test.lines.length) { toast(test.errors.map((e) => errText(e.code)).join(' '), 'warn'); return; }
  const doc = returnDoc(docMeta(nextNumber()), sale, req, returnsOf(sale), opts());
  doc.card = sale.card || null;
  addDoc(doc);
  // Points: refunded spent points minus reversed earned points, applied to the card in one movement.
  if (doc.card) movePoints(doc.card, doc.points.refund - doc.points.reverse);
  R.qty = {}; R.done = doc;
  toast(t('rs.ret.made', { n: doc.number, v: fmtCur(doc.total) }), 'ok');
  render();
}

function doneCard(doc) {
  const box = h('div', { class: 'rs-receipt-box' });
  const paint = () => {
    box.textContent = '';
    box.append(h('div', { class: 'ap-row rs-r-ctl' }, paperSeg(paint)), h('div', { class: 'rs-r-state rs-final' }, t('rs.ret.doneT', { n: doc.number })),
      paperView(receiptText(doc, D.cfg.paper), D.cfg.paper),
      h('div', { class: 'ap-actions' }, button('rs.print', 'print', () => printReceipt(doc, D.cfg.paper), 'primary'), button('dlg.close', 'close', () => { R.done = null; paintDetail(); })));
  };
  paint();
  return card('rs.ret.receipt', box);
}

startShell('returns', () => render());
render();
