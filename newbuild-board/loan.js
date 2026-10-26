// newbuild-board/loan.js - the mortgage page: a unit of the board (or any price) -> down payment, loan, term, nominal
// rate, annuity or differentiated schedule (estate/mortgage.js: integer minor units, the principal parts sum to the
// loan exactly, a zero rate is a developer's interest-free instalment plan), both kinds compared, affordability from a
// monthly income (the largest loan and price a share of the income carries), the schedule by month or by year with
// totals, a CSV and a printable schedule.
//
// All arithmetic lives in estate/mortgage.js (integer minor units, rounding residue folded into the last payment so
// principal parts sum to the loan exactly). This page is a view: S holds the form (persisted under 'nb-mortgage'),
// plan() recomputes the whole schedule on each change (360 rows at most, trivially cheap).
import {
  areaText, buildingOf, complexTitle, fileSlug, group, hasGel, kvRows, loadProject, money, numOf, onProjectChange, pctText,
  printElement, roomsText, startShell, statusText, tile, toGel, num, natural,
} from './common.js';
import { button, card, download, field, range, seg, select, t, textInput } from '../ui/app.js';
import { $, debounce, h, lsGet, lsSet } from '../ui/dom.js';
import { affordablePrincipal, mortgagePlan } from '../estate/mortgage.js';
import { decimalText, toMinor } from '../ledger/minor.js';
import { serializeCSV } from '../csv/csv.js';

let P = loadProject();
const MKEY = 'nb-mortgage';
// setMonth(m + 1, 1): day 1 first, so January 31 + 1 month never overflows into March.
const nextMonth = () => { const d = new Date(); d.setMonth(d.getMonth() + 1, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const DEF = { unit: '', price: '80000', downPct: 30, years: 10, rate: '11.5', kind: 'annuity', start: '', income: '2500', share: 40, by: 'month' };
const S = (() => {
  const s = structuredClone(DEF), v = lsGet(MKEY, null) || {};
  // Restore by type per field, then clamp to the slider ranges: stale or edited storage cannot produce a 0-year loan.
  for (const k of Object.keys(DEF)) if (typeof v[k] === typeof DEF[k]) s[k] = v[k];
  s.downPct = Math.max(0, Math.min(90, s.downPct));
  s.years = Math.max(1, Math.min(30, Math.trunc(s.years)));
  s.share = Math.max(10, Math.min(70, s.share));
  if (!['annuity', 'differentiated'].includes(s.kind)) s.kind = 'annuity';
  if (!/^\d{4}-\d{2}$/.test(s.start)) s.start = nextMonth();
  return s;
})();
const save = debounce(() => lsSet(MKEY, S), 250);

// #unit=<id> from the board's unit card.
// The hash is consumed and removed (replaceState), so a reload or a shared link does not re-select the unit later.
(() => {
  const id = new URLSearchParams((window.location.hash || '').slice(1)).get('unit');
  if (!id) return;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  if (P.units.some((u) => u.id === id)) { S.unit = id; save(); }
})();

const cur = () => P.complex.currency;
const unit = () => P.units.find((u) => u.id === S.unit) || null;
// A board unit fixes the price; otherwise the typed price is used. Rate clamped to 0..40% (0 = interest-free plan).
const price = () => { const u = unit(); return u ? u.price : toMinor(S.price, cur()); };
const ratePct = () => { const r = numOf(S.rate); return r == null ? 0 : Math.max(0, Math.min(40, r)); };
const plan = (kind = S.kind) => mortgagePlan(price(), { downPct: S.downPct, years: S.years, ratePct: ratePct(), kind, startMonth: S.start });

// ---------------------------------------------------------------------------------------------------------------
// Layout

const main = $('#main');
main.classList.add('nb-loan');
let els = {};

function unitOptions() {
  const opts = [{ v: '', l: 'nb.ln.custom' }];
  for (const b of [...P.buildings].sort((a, c) => natural(a.id, c.id))) {
    // Only units one could still buy (free / reserved with a price), plus the currently selected one even if sold since.
    for (const u of P.units.filter((x) => x.building === b.id && x.price > 0 && (x.status === 'free' || x.status === 'reserved' || x.id === S.unit))) {
      opts.push({ v: u.id, l: `=${b.name} · ${u.flat} · ${roomsText(u.rooms)} · ${areaText(u.area)} · ${money(u.price, cur())}${u.status !== 'free' ? ' · ' + statusText(u.status) : ''}` });
    }
  }
  return opts;
}

function render() {
  main.textContent = '';
  els = {};
  const c = cur();
  const usel = select(unitOptions(), S.unit, (v) => { S.unit = v; save(); render(); });
  usel.id = 'nb-ln-unit';
  const priceIn = textInput(S.price, (v) => { S.price = v; changed(); }, { inputmode: 'decimal', class: 'ed-input nb-num', id: 'nb-ln-price' });
  els.downHint = h('div', { class: 'ed-hint' });
  const loanCard = card('nb.ln.loan', h('div', { class: 'ed-fields' },
    field('nb.ln.unit', usel),
    S.unit ? null : field('=' + t('nb.ln.price', { c }), priceIn),
    h('div', { class: 'ed-field' }, h('label', { class: 'ed-label', for: 'nb-ln-down' }, t('nb.ln.down')),
      rangeWithId('nb-ln-down', { min: 0, max: 90, step: 5, value: S.downPct, unit: ' %', onInput: (v) => { S.downPct = v; changed(); } }), els.downHint),
    h('div', { class: 'ed-field' }, h('label', { class: 'ed-label', for: 'nb-ln-years' }, t('nb.ln.years')),
      rangeWithId('nb-ln-years', { min: 1, max: 30, step: 1, value: S.years, unit: '', onInput: (v) => { S.years = v; changed(); } })),
    field('nb.ln.rate', textInput(S.rate, (v) => { S.rate = v; changed(); }, { inputmode: 'decimal', class: 'ed-input nb-num', id: 'nb-ln-rate' }), 'nb.ln.rateHint'),
    group('nb.ln.kind', seg([{ v: 'annuity', l: 'nb.ln.annuity' }, { v: 'differentiated', l: 'nb.ln.diff' }], S.kind, (v) => { S.kind = v; changed(); }, 'nb.ln.kind'), t('nb.ln.kindHint')),
    field('nb.ln.start', h('input', { type: 'month', class: 'ed-input', value: S.start, oninput: (e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) { S.start = e.target.value; changed(); } } }))));
  els.afford = h('div', { class: 'nb-afford', role: 'status', 'aria-live': 'polite' });
  const affCard = card('nb.ln.afford', h('div', { class: 'ed-fields' },
    field('=' + t('nb.ln.income', { c }), textInput(S.income, (v) => { S.income = v; changed(); }, { inputmode: 'decimal', class: 'ed-input nb-num', id: 'nb-ln-income' })),
    h('div', { class: 'ed-field' }, h('label', { class: 'ed-label', for: 'nb-ln-share' }, t('nb.ln.share')),
      rangeWithId('nb-ln-share', { min: 10, max: 70, step: 5, value: S.share, unit: ' %', onInput: (v) => { S.share = v; changed(); } }), h('div', { class: 'ed-hint' }, t('nb.ln.shareHint')))),
  els.afford);
  els.unitInfo = h('div', { class: 'nb-ln-unit' });
  els.tiles = h('div', { class: 'nb-tiles' });
  els.compare = h('div');
  els.table = h('div', { id: 'nb-schedule' });
  const by = seg([{ v: 'month', l: 'nb.ln.byMonth' }, { v: 'year', l: 'nb.ln.byYear' }], S.by, (v) => { S.by = v; save(); paintTable(); }, 'nb.ln.view');
  const tools = h('div', { class: 'ap-row nb-ln-tools' }, by, h('span', { class: 'ed-spacer' }), button('nb.ln.csv', 'download', exportCSV), button('nb.ln.print', 'print', printSchedule));
  const stage = h('div', { class: 'ap-stage' }, els.unitInfo, els.tiles, card('nb.ln.compare', els.compare), card('nb.ln.schedule', tools, els.table), h('p', { class: 'ed-hint nb-disclaimer' }, t('nb.ln.disclaimer')));
  main.append(h('div', { class: 'ap-work' }, h('div', { class: 'ap-side' }, loanCard, affCard), stage));
  update();
}

// ui/app.js range() with the input's id, so the visible label names it.
// <label for> needs an id on the actual <input>; range() returns a wrapper, so the id is set on its child.
function rangeWithId(id, o) {
  const r = range(o);
  r.querySelector('input').id = id;
  return r;
}

const changed = () => { save(); updateSoon(); };
// 80ms: sliders fire input continuously while dragged; the schedule repaints at most every 80ms.
const updateSoon = debounce(() => update(), 80);

function update() {
  const c = cur(), p = plan();
  els.downHint.textContent = t('nb.ln.downHint', { d: money(p.down, c), l: money(p.body, c) });
  paintUnit();
  paintTiles(p);
  paintCompare();
  paintAfford(p);
  paintTable();
}

function paintUnit() {
  const box = els.unitInfo, u = unit();
  box.textContent = '';
  if (!u) return;
  const b = buildingOf(P, u.building);
  box.append(h('div', { class: 'ap-card nb-ln-unit-card' }, h('b', {}, `${complexTitle(P)} · ${b ? b.name : u.building} · ${t('nb.unit.flat', { n: u.flat })}`),
    h('span', {}, [roomsText(u.rooms), areaText(u.area), u.floor != null ? t('nb.ln.floor', { n: u.floor }) : '', statusText(u.status)].filter(Boolean).join(' · '))));
}

function paintTiles(p) {
  const c = cur(), box = els.tiles, gel = (m) => (hasGel(P) ? money(toGel(P, m), 'GEL') : '');
  box.textContent = '';
  box.append(
    tile('nb.ln.priceT', money(p.price, c), gel(p.price)),
    tile('nb.ln.downT', money(p.down, c), pctText(S.downPct / 100, 0)),
    tile('nb.ln.body', money(p.body, c), t('nb.ln.months', { n: p.months })),
    tile(S.kind === 'annuity' ? 'nb.ln.monthly' : 'nb.ln.first', money(p.first, c, { cents: true }), S.kind === 'annuity' ? gel(p.first) : t('nb.ln.lastV', { v: money(p.last, c, { cents: true }) }), 'nb-tile-acc'),
    tile('nb.ln.interest', money(p.totalInterest, c), t('nb.ln.paidV', { v: money(p.totalPaid, c) })));
  box.dataset.first = String(p.first);
}

function paintCompare() {
  const c = cur(), box = els.compare;
  box.textContent = '';
  const a = plan('annuity'), d = plan('differentiated');
  // Both kinds side by side: annuity = equal payments; differentiated = equal principal parts, falling payments and
  // less total interest, but the first payment is the highest.
  const row = (k, f) => h('tr', {}, h('th', { scope: 'row' }, t(k)), h('td', { class: 'nb-r' }, f(a)), h('td', { class: 'nb-r' }, f(d)));
  box.append(h('div', { class: 'ap-table-wrap nb-twrap' }, h('table', { class: 'ap-table nb-table' },
    h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', { scope: 'col', class: 'nb-r' }, t('nb.ln.annuity')), h('th', { scope: 'col', class: 'nb-r' }, t('nb.ln.diff')))),
    h('tbody', {},
      row('nb.ln.first', (x) => money(x.first, c, { cents: true })), row('nb.ln.last', (x) => money(x.last, c, { cents: true })),
      row('nb.ln.interest', (x) => money(x.totalInterest, c)), row('nb.ln.paid', (x) => money(x.totalPaid, c))))));
  if (a.totalInterest > d.totalInterest) box.append(h('p', { class: 'ed-hint' }, t('nb.ln.saving', { v: money(a.totalInterest - d.totalInterest, c), f: money(d.first - a.first, c) })));
}

function paintAfford(p) {
  const c = cur(), box = els.afford;
  box.textContent = '';
  const income = toMinor(S.income, c);
  if (!(income > 0)) { box.append(h('div', { class: 'ed-hint' }, t('nb.ln.noIncome'))); return; }
  // Payment limit = share of income (integer minor units, floored). affordablePrincipal inverts the annuity formula:
  // the largest loan whose payment fits the limit; the max price adds back the down payment share.
  const limit = Math.floor((income * S.share) / 100);
  const maxLoan = affordablePrincipal(limit, ratePct(), p.months);
  const maxPrice = S.downPct < 100 ? Math.floor((maxLoan * 100) / (100 - S.downPct)) : 0;
  // The verdict compares the FIRST payment: for a differentiated plan that is the most expensive month, the honest test.
  const ok = p.first <= limit;
  box.append(h('div', { class: 'nb-verdict ' + (ok ? 'nb-ok' : 'nb-no') }, t(ok ? 'nb.ln.fits' : 'nb.ln.notFits', { p: pctText(p.first / income, 0) })),
    kvRows([['nb.ln.limit', money(limit, c)], ['nb.ln.maxLoan', money(maxLoan, c)], ['nb.ln.maxPrice', money(maxPrice, c)]]));
  if (S.kind === 'differentiated') box.append(h('div', { class: 'ed-hint' }, t('nb.ln.diffAfford')));
}

// Rows of the table: months, or years with summed payments and the balance at the year end.
// Year buckets follow calendar years of the start month (not 12-payment blocks), as people budget by year.
function tableRows(p) {
  if (S.by === 'month') return p.rows.map((r) => ({ label: r.month || String(r.n), n: r.n, payment: r.payment, interest: r.interest, principal: r.principal, balance: r.balance }));
  const out = [];
  for (const r of p.rows) {
    const y = r.month ? r.month.slice(0, 4) : String(Math.ceil(r.n / 12));
    let last = out.at(-1);
    if (!last || last.label !== y) { last = { label: y, n: out.length + 1, payment: 0, interest: 0, principal: 0, balance: 0 }; out.push(last); }
    last.payment += r.payment; last.interest += r.interest; last.principal += r.principal; last.balance = r.balance;
  }
  return out;
}

function scheduleTable(p, all = false) {
  const c = cur(), m = (v) => money(v, c, { cents: true });
  const rows = all ? p.rows.map((r) => ({ label: r.month || String(r.n), n: r.n, ...r })) : tableRows(p);
  const tbody = h('tbody');
  for (const r of rows) {
    tbody.append(h('tr', {}, h('td', { class: 'nb-r' }, String(r.n)), h('th', { scope: 'row' }, r.label), h('td', { class: 'nb-r' }, m(r.payment)), h('td', { class: 'nb-r' }, m(r.interest)),
      h('td', { class: 'nb-r', dataset: { principal: String(r.principal) } }, m(r.principal)), h('td', { class: 'nb-r' }, m(r.balance))));
  }
  // The principal column total is computed from the rows (data-sum): a test can assert it equals the loan exactly.
  const sumP = p.rows.reduce((s, r) => s + r.principal, 0);
  const foot = h('tr', {}, h('td', {}), h('th', { scope: 'row' }, t('nb.ln.total')), h('td', { class: 'nb-r' }, m(p.totalPaid)), h('td', { class: 'nb-r' }, m(p.totalInterest)),
    h('td', { class: 'nb-r', dataset: { sum: String(sumP) } }, m(sumP)), h('td', {}));
  const th = (k, cls) => h('th', { scope: 'col', class: cls || null }, t(k));
  return h('table', { class: 'ap-table nb-table nb-sched', dataset: { body: String(p.body), kind: p.kind } },
    h('thead', {}, h('tr', {}, th('nb.ln.n', 'nb-r'), th(S.by === 'year' && !all ? 'nb.ln.year' : 'nb.ln.month'), th('nb.ln.payment', 'nb-r'), th('nb.ln.interestCol', 'nb-r'), th('nb.ln.principal', 'nb-r'), th('nb.ln.balance', 'nb-r'))),
    tbody, h('tfoot', {}, foot));
}

function paintTable() {
  const box = els.table, p = plan();
  box.textContent = '';
  if (!p.rows.length) { box.append(h('div', { class: 'ap-empty' }, t('nb.ln.noLoan'))); return; }
  box.append(h('div', { class: 'ap-table-wrap nb-twrap nb-sched-wrap' }, scheduleTable(p)));
}

function exportCSV() {
  const p = plan(), c = cur();
  const rows = [['n', 'month', 'payment', 'interest', 'principal', 'balance', 'currency']];
  for (const r of p.rows) rows.push([r.n, r.month || '', decimalText(r.payment, c), decimalText(r.interest, c), decimalText(r.principal, c), decimalText(r.balance, c), c].map(String));
  // BOM for Excel, formula guard against CSV injection, decimals in the currency's minor-unit precision.
  download('﻿' + serializeCSV(rows, { guard: true }), `schedule-${p.kind}-${fileSlug(S.unit || 'price')}.csv`, 'text/csv');
}

function printSchedule() {
  const p = plan(), c = cur(), u = unit();
  if (!p.rows.length) return;
  const b = u ? buildingOf(P, u.building) : null;
  const head = h('div', { class: 'nb-print-head' },
    h('h1', {}, complexTitle(P)),
    h('div', {}, u ? `${b ? b.name : u.building} · ${t('nb.unit.flat', { n: u.flat })} · ${roomsText(u.rooms)} · ${areaText(u.area)}` : t('nb.ln.custom')),
    h('div', {}, t('nb.ln.printLine', { p: money(p.price, c), d: money(p.down, c), l: money(p.body, c), y: S.years, r: num(ratePct(), 2), k: t(S.kind === 'annuity' ? 'nb.ln.annuity' : 'nb.ln.diff') })),
    h('div', { class: 'nb-print-note' }, t('nb.ln.disclaimer')));
  // Print always shows every month; scheduleTable(p, true) already ignores S.by for rows, so this toggle only affects
  // the column heading.
  const by = S.by;
  S.by = 'month';
  const table = scheduleTable(p, true);
  S.by = by;
  printElement(h('div', { class: 'nb-sheet' }, head, table));
}

onProjectChange((p) => { P = p; render(); });
startShell('mortgage', () => render());
render();
