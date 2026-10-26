// receipt-studio/shift.js - the shift page: open a shift with the opening cash, cash in / out operations (a cash out
// above the expected drawer is refused, receipt/shift.js checkCashOp), the live X report (sales and returns with their
// cash / card / mixed / points split, VAT by rate, expected cash) as figures and as printer text, the receipts of the
// shift, closing with the counted cash and the Z report, earlier Z reports, the journal exported as CSV or JSON and a
// training reset.
//
// Model: a shift is { number, openedAt, openedBy, openingCash, ops[] }; its documents are found in the journal by
// shift number. The X report is never stored: xReport() derives it from journal + ops on every render, so it
// cannot drift from the documents. The Z report is the one stored snapshot (closeShiftDialog in common.js), taken
// with the counted cash, after which the shift is gone and a new one gets the next number.
// The page is rebuilt with render() after every action: it is small, and this keeps X figures and lists in sync.
import {
  D, amtText, closeShiftDialog, fmt, fmtCur, fmtTime, methodName, openShiftDialog, paperSeg, paperView, parseAmt,
  printReceipt, printText, receiptCode, receiptText, resetTraining, save, shiftDocs, shiftIsExpired, shiftText, showReport,
  startShell, xReport,
} from './common.js';
import { button, card, download, field, seg, t, textInput, toast } from '../ui/app.js';
import { $, h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { confirmDialog, openDialog } from '../ui/overlays.js';
import { checkCashOp } from '../receipt/shift.js';
import { serializeCSV } from '../csv/csv.js';

const main = $('#main');
main.classList.add('rs-shift');
// Module-level form state: survives the full re-render after each operation (e.g. a refused cash-out keeps its text).
const op = { kind: 'in', amount: '', note: '' };

function render() {
  main.textContent = '';
  if (!D.shift) {
    const openBtn = button('rs.sh.open', 'clock', async () => { if (await openShiftDialog()) render(); }, 'primary');
    openBtn.id = 'rs-open-shift';
    const openCard = card('rs.sh.title', h('div', { class: 'rs-shift-badge rs-closed' }, iconEl('lockClosed'), t('rs.sh.closed')), h('p', { class: 'ed-hint' }, t('rs.sh.closedHint')), h('div', { class: 'ap-actions' }, openBtn));
    main.append(h('div', { class: 'rs-sh-work' }, h('div', { class: 'rs-col' }, openCard, zCard()), h('div', { class: 'rs-col' }, journalCard())));
    return;
  }
  const x = xReport();
  const head = h('div', { class: 'rs-sh-head' }, h('div', { class: 'rs-shift-badge' + (shiftIsExpired() ? ' rs-expired' : '') }, iconEl('clock'), t('rs.sh.badge', { n: D.shift.number, t: fmtTime(D.shift.openedAt) })),
    D.shift.openedBy ? h('span', { class: 'ed-hint' }, `${t('rs.l.cashier')}: ${D.shift.openedBy}`) : null);
  const closeBtn = button('rs.sh.close', 'lockClosed', async () => { if (await closeShiftDialog()) render(); }, 'danger');
  closeBtn.id = 'rs-close-shift';
  const xCard = card('rs.sh.x', head, shiftIsExpired() ? h('div', { class: 'ed-hint ed-hint-warn', role: 'alert' }, t('rs.sh.expired')) : null, reportKV(x),
    h('div', { class: 'ap-actions' }, button('rs.sh.xText', 'sheet', () => showReport(xReport())), closeBtn));
  const left = h('div', { class: 'rs-col' }, xCard, cashCard(x));
  const right = h('div', { class: 'rs-col' }, receiptsCard(), zCard(), journalCard());
  main.append(h('div', { class: 'rs-sh-work' }, left, right));
}

/** Figures of an X / Z report. */
// One renderer for X and Z: Z adds counted cash and the difference. Rows with v == null are skipped.
function reportKV(r) {
  const dl = h('dl', { class: 'ap-kv rs-kv rs-report' });
  const add = (k, v, key, cls) => { if (v == null) return; dl.append(h('dt', { class: cls || null }, k), h('dd', { class: 'rs-num' + (cls ? ' ' + cls : ''), dataset: { k: key } }, v)); };
  const block = (title, b, key) => {
    add(`${title} (${b.count})`, fmt(b.total), key, 'rs-strong');
    if (b.cash) add('· ' + t('rs.l.cash'), fmt(b.cash), key + '-cash');
    if (b.card) add('· ' + t('rs.l.card'), fmt(b.card), key + '-card');
    if (b.mixed) add('· ' + t('rs.l.mixed'), fmt(b.mixed), key + '-mixed');
    if (b.points) add('· ' + t('rs.l.points'), fmt(b.points), key + '-points');
  };
  block(t('rs.l.sales'), r.sales, 'sales');
  block(t('rs.l.returns'), r.returns, 'returns');
  add(t('rs.l.net'), fmtCur(r.net), 'net', 'rs-strong');
  for (const [rate, v] of Object.entries(r.vat?.rates || {})) add(`${t('rs.l.vat')} ${rate} %`, fmt(v.vat), 'vat-' + rate);
  if (r.vat?.exempt) add(t('rs.l.exempt'), fmt(r.vat.exempt), 'exempt');
  add(t('rs.l.opening'), fmt(r.openingCash), 'opening');
  add(t('rs.l.cashIn'), fmt(r.cashIn), 'cashIn');
  add(t('rs.l.cashOut'), fmt(r.cashOut), 'cashOut');
  add(t('rs.l.expected'), fmtCur(r.expectedCash), 'expected', 'rs-big');
  // The difference sign is explicit (+ surplus, - shortage via fmt's minus) and highlighted when non-zero.
  if (r.type === 'Z' && r.countedCash != null) {
    add(t('rs.l.counted'), fmt(r.countedCash), 'counted');
    add(t('rs.l.difference'), (r.difference > 0 ? '+' : '') + fmt(r.difference), 'difference', r.difference ? 'rs-warn' : null);
  }
  return dl;
}

function cashCard(x) {
  const amount = textInput(op.amount, (v) => { op.amount = v; }, { inputmode: 'decimal', class: 'ed-input rs-num', id: 'rs-op-amount', placeholder: '0.00' });
  const note = textInput(op.note, (v) => { op.note = v; }, { placeholder: t('rs.op.notePh') });
  const kind = seg([{ v: 'in', l: 'rs.l.cashIn', icon: 'plus' }, { v: 'out', l: 'rs.l.cashOut', icon: 'minus' }], op.kind, (v) => { op.kind = v; }, 'rs.op.kind');
  const go = button('rs.op.go', 'cash', () => {
    // checkCashOp refuses a cash-out larger than the expected drawer (you cannot remove money that is not there) and
    // invalid amounts; the error key selects the message, with the expected cash for context.
    const a = parseAmt(op.amount);
    const err = checkCashOp(xReport(), op.kind, a);
    if (err) { toast(t('rs.err.' + err, { v: fmtCur(xReport().expectedCash) }), 'warn'); return; }
    D.shift.ops.push({ kind: op.kind, amount: a, at: Date.now(), note: op.note.trim() });
    save.shift();
    toast(t(op.kind === 'in' ? 'rs.op.doneIn' : 'rs.op.doneOut', { v: fmtCur(a) }), 'ok');
    op.amount = ''; op.note = '';
    render();
  }, 'primary');
  go.id = 'rs-op-go';
  const ops = D.shift.ops || [];
  return card('rs.op.title', kind, h('div', { class: 'ed-grid2' }, field('rs.op.amount', amount), field('rs.op.note', note)), h('div', { class: 'ap-actions' }, go),
    h('div', { class: 'ed-hint' }, t('rs.op.hint', { v: fmtCur(x.expectedCash) })),
    ops.length ? h('ul', { class: 'rs-ops' }, ops.slice().reverse().map((o) => h('li', {}, h('span', { class: 'rs-op-' + o.kind }, (o.kind === 'in' ? '+' : '−') + fmt(o.amount)), h('span', { class: 'ed-hint' }, fmtTime(o.at)), o.note ? h('span', {}, o.note) : null))) : null);
}

function receiptsCard() {
  const docs = shiftDocs().slice().reverse();
  if (!docs.length) return card('rs.sh.receipts', h('div', { class: 'ap-empty' }, t('rs.sh.noReceipts')));
  return card('rs.sh.receipts', h('div', { class: 'ap-table-wrap rs-rc-wrap' }, h('table', { class: 'ap-table rs-rc-table' },
    h('thead', {}, h('tr', {}, ['rs.j.number', 'rs.j.time', 'rs.j.kind', 'rs.pay.method', 'rs.vat.sum'].map((k) => h('th', {}, t(k))))),
    h('tbody', {}, docs.map((d) => h('tr', { dataset: { n: String(d.number) } },
      h('td', {}, h('button', { type: 'button', class: 'rs-link', onclick: () => viewDoc(d) }, '#' + d.number)),
      // Time only (HH:MM): the date is the shift's, shown in the header.
      h('td', {}, fmtTime(d.ts).slice(11)), h('td', {}, t(d.kind === 'return' ? 'rs.j.return' : 'rs.j.sale')),
      h('td', {}, methodName(d.payment?.method)), h('td', { class: 'rs-num' + (d.kind === 'return' ? ' rs-neg' : '') }, (d.kind === 'return' ? '−' : '') + fmt(d.total))))))));
}

function viewDoc(d) {
  let paper = D.cfg.paper;
  const box = h('div');
  const paint = () => { box.textContent = ''; box.append(paperView(receiptText(d, paper), paper)); };
  paint();
  const s = seg([{ v: 58, l: '=58 mm' }, { v: 80, l: '=80 mm' }], paper, (v) => { paper = +v; paint(); }, 'rs.paper');
  openDialog({ title: `${t(d.kind === 'return' ? 'rs.j.return' : 'rs.j.sale')} #${d.number}`, className: 'rs-dlg-report',
    body: h('div', { class: 'ed-fields' }, h('div', { class: 'ap-row' }, s, h('span', { class: 'ed-spacer' }), button('rs.print', 'print', () => printReceipt(d, paper))), box) });
}

function zCard() {
  const list = D.z.slice().reverse();
  return card('rs.z.title', list.length ? h('ul', { class: 'rs-zlist' }, list.slice(0, 30).map((z) => h('li', {},
    h('button', { type: 'button', class: 'rs-link', onclick: () => showReport(z) }, t('rs.z.item', { n: z.shiftNumber })),
    h('span', { class: 'ed-hint' }, fmtTime(z.at)), h('span', { class: 'rs-num' }, fmtCur(z.net)),
    z.difference ? h('span', { class: 'rs-badge rs-badge-bad' }, (z.difference > 0 ? '+' : '') + fmt(z.difference)) : null))) : h('div', { class: 'ap-empty' }, t('rs.z.none')));
}

// --- journal export and reset ------------------------------------------------------------------------------------------

// Flat CSV for accountants: one row per document, money as decimal text in major units, returns negative, one VAT
// column per rate that occurs in the journal (sorted high to low), lines folded into one text column.
function journalRows() {
  const rates = [...new Set(D.journal.flatMap((d) => Object.keys(d.vat?.rates || {})))].sort((a, b) => b - a);
  const head = ['number', 'code', 'shift', 'kind', 'time', 'cashier', 'method', 'total', 'cash', 'card', 'points', 'tendered', 'change', ...rates.map((r) => `vat_${r}`), 'without_vat', 'original', 'lines'];
  const m = (v) => (v == null ? '' : amtText(v));
  const rows = D.journal.map((d) => {
    const p = d.payment || {};
    return [d.number, receiptCode(d), d.shift, d.kind, fmtTime(d.ts), d.cashier || '', p.method || '', m(d.kind === 'return' ? -d.total : d.total), m(p.cash), m(p.card), m(p.pointsValue),
      m(p.tendered), m(p.change), ...rates.map((r) => m(d.vat?.rates?.[r]?.vat ?? 0)), m(d.vat?.exempt ?? 0), d.original?.number ?? '',
      d.lines.map((l) => `${l.name} x${l.qty}=${amtText(l.total)}`).join('; ')];
  });
  return [head, ...rows];
}

function journalCard() {
  const n = D.journal.length;
  // '﻿' BOM: Excel opens UTF-8 CSV as the ANSI code page without it (Georgian and Cyrillic names would garble).
  // guard: true prefixes cells starting with = + - @ so a product name cannot run as a spreadsheet formula (CSV
  // injection). JSON export is the lossless backup (whole documents and Z reports).
  const csv = button('rs.j.csv', 'table', () => download('﻿' + serializeCSV(journalRows(), { guard: true }), `journal-${stamp()}.csv`, 'text/csv'));
  const json = button('rs.j.json', 'download', () => download(JSON.stringify({ app: 'receipt-studio', currency: D.cfg.currency, digits: D.cfg.digits, exported: new Date().toISOString(), journal: D.journal, z: D.z }, null, 1), `journal-${stamp()}.json`, 'application/json'));
  const xt = D.shift ? button('rs.sh.printX', 'print', () => printText(shiftText(xReport(), D.cfg.paper), D.cfg.paper)) : null;
  csv.disabled = json.disabled = !n;
  // Training reset keeps catalogue, cards and settings; a confirmation guards it because the journal is lost.
  const reset = button('rs.j.reset', 'trash', async () => {
    if (!(await confirmDialog(t('rs.j.reset'), t('rs.j.resetAsk'), t('rs.j.resetGo'), true))) return;
    resetTraining();
    toast(t('rs.j.resetDone'), 'ok');
    render();
  }, 'danger');
  return card('rs.j.title', h('p', { class: 'ed-hint' }, t('rs.j.count', { n })), h('div', { class: 'ap-row' }, paperSeg(() => render())),
    h('div', { class: 'ap-actions rs-wrap' }, csv, json, xt), h('div', { class: 'ap-actions' }, reset), h('div', { class: 'ed-hint' }, t('rs.j.hint')),
    D.shift ? h('details', { class: 'rs-details' }, h('summary', {}, iconEl('chevRight'), t('rs.sh.xText')), paperView(shiftText(xReport(), D.cfg.paper), D.cfg.paper)) : null);
}
// YYYYMMDDHHMM for file names: sortable, no characters that are illegal in Windows file names.
const stamp = () => fmtTime(Date.now()).replace(/\D/g, '').slice(0, 12);

startShell('shift', () => render());
render();
