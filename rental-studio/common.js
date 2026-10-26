// rental-studio/common.js - shared parts of the calendar, prices, payouts and leads pages: the shell (pages resolved
// from the hidden anchors of the page HTML, so the build can rewrite them), app icons, the project store (one JSON
// document in localStorage, seeded with the demo on first use, exported and imported as a file), money and day
// formatting in the UI language (integer minor units in, text out), labels of the library codes in the 7 UI
// languages, and small widgets (labelled groups, key-value lists, tables, month navigation, money / day inputs).
//
// Design rules of this module:
// - Money is integer minor units (cents) everywhere; floats appear only at the formatting edge (fromMinor) and are
//   never summed. 0.1 + 0.2 errors in a payout statement are not acceptable.
// - Days are ISO strings 'YYYY-MM-DD' and formatted in UTC: a day is a calendar label, not an instant; formatting it
//   in the local zone would shift it by one for users west of UTC.
// - One project document (P) is the whole state; pages render from it and call save() after mutations.
import './strings.js';
import { startApp, t, toast, download } from '../ui/app.js';
import { h, lsGet, lsSet, debounce } from '../ui/dom.js';
import { addIcons, iconEl } from '../ui/icons.js';
import { UI_STATE } from '../ui/i18n.js';
import { pickFiles } from '../ui/files.js';
import { formatYearMonth } from '../i18n/dates.js';
import { decimalText, fromMinor, minorUnits, toMinor } from '../ledger/minor.js';
import { convertMinor } from '../ledger/rates.js';
import { isLedgerArticle } from '../ledger/parties.js';
import { dayNum, isDay, monthAdd } from '../booking/days.js';
import { normalizeProject, ratesTable, CURRENCIES } from './calc.js';
import { makeDemo } from './demo.js';

export const LOGO = 'M3 11.5 12 4l9 7.5M5.5 10v10h13V10M10 20v-5.5h4V20';

addIcons({
  home: LOGO,
  bed: 'M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5M7 12.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  coins: 'M9 8a6 3 0 1 0 0 .01M3 8v4c0 1.7 2.7 3 6 3s6-1.3 6-3V8M15 11c3.3 0 6 1.3 6 3s-2.7 3-6 3-6-1.3-6-3M9 15v2c0 1.7 2.7 3 6 3s6-1.3 6-3v-3',
  funnel: 'M3 4h18l-7 8.5V19l-4 2v-8.5z',
  web: 'M5 6a2 2 0 1 0 0-.01M5 18a2 2 0 1 0 0-.01M19 12a2 2 0 1 0 0-.01M7 6.5l10 4.5M7 17.5l10-4.5',
  prices: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01',
  ical: 'M4 5h16v15H4zM4 9h16M8 3v4M16 3v4M8 13h3v3H8z',
  left: 'M15 18l-6-6 6-6',
  right: 'M9 18l6-6-6-6',
});

// --- clock: the one place where the app reads the date (libraries take `today` as an input) -----------------------

// Local calendar date (getFullYear/Month/Date), not toISOString(), which is UTC and gives yesterday/tomorrow near
// midnight in non-UTC zones.
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// KNOWN DEFECT: TODAY is fixed at module load; a page left open past midnight keeps treating yesterday as today
// (past-day hatching, "this month"). Fix: call todayIso() where the value is used, or refresh on visibilitychange.
export const TODAY = todayIso();
export const thisMonth = () => TODAY.slice(0, 7);

// --- project store ---------------------------------------------------------------------------------------------------

const SKEY = 'rs-project';
// A missing or flat-less project is replaced by the demo (and saved), so the first visit shows a working example.
// normalizeProject (calc.js) repairs and migrates whatever is stored: storage is user-editable and may be old.
function loadProject() {
  const saved = lsGet(SKEY, null);
  if (saved && typeof saved === 'object' && Array.isArray(saved.units) && saved.units.length) return normalizeProject(saved);
  const demo = makeDemo(TODAY);
  lsSet(SKEY, demo);
  return demo;
}
export let P = loadProject();
// Debounced save (250 ms) for typing; save(true) flushes immediately before navigation/print. beforeunload flushes a
// pending write so the last keystrokes are never lost.
const saveNow = () => { lsSet(SKEY, P); };
const saveSoon = debounce(saveNow, 250);
// Saves the project (debounced; `now` for actions after which the page may be left).
export function save(now = false) { if (now) { saveSoon.cancel(); saveNow(); } else saveSoon(); }
window.addEventListener('beforeunload', () => { if (saveSoon.pending()) saveNow(); });
// Another tab changed the project: take it over and re-render.
// Cross-tab sync: the storage event fires in other tabs of the same origin when one tab writes; the page takes over
// the newer project and re-renders. Last writer wins - acceptable for a single-user tool.
let onExternal = null;
window.addEventListener('storage', (e) => { if (e.key === SKEY && e.newValue) { try { P = normalizeProject(JSON.parse(e.newValue)); onExternal?.(); } catch { /* ignore */ } } });

export function replaceProject(next) { P = normalizeProject(next); save(true); }

// Export tags the file with app: 'rental-studio' so a wrong JSON can be recognised; import validates through
// normalizeProject and refuses a project without flats.
export function exportProject() {
  download(JSON.stringify({ app: 'rental-studio', ...P }, null, 1), `rental-studio-${TODAY}.json`, 'application/json');
}
export async function importProject() {
  const [file] = await pickFiles({ accept: '.json,application/json' });
  if (!file) return false;
  try {
    const raw = JSON.parse(await file.text());
    const next = normalizeProject(raw);
    if (!next.units.length) throw new Error(t('rs.proj.empty'));
    replaceProject(next);
    toast(t('rs.proj.imported', { n: next.bookings.length }), 'ok');
    return true;
  } catch (e) {
    toast(t('ap.fileErr', { name: file.name, msg: e.message }), 'error');
    return false;
  }
}
export function resetDemo() { replaceProject(makeDemo(TODAY)); }

// --- shell -----------------------------------------------------------------------------------------------------------

export function pageHref(id) {
  const a = document.getElementById(id);
  return a ? a.getAttribute('href') : '#';
}

export function startShell(current, render) {
  onExternal = render;
  startApp({
    key: 'rs', name: 'rs.name', logo: LOGO, offline: true, onLang: () => render(),
    pages: [
      { href: pageHref('pg-calendar'), label: 'rs.page.calendar', current: current === 'calendar' },
      { href: pageHref('pg-prices'), label: 'rs.page.prices', current: current === 'prices' },
      { href: pageHref('pg-payouts'), label: 'rs.page.payouts', current: current === 'payouts' },
      { href: pageHref('pg-leads'), label: 'rs.page.leads', current: current === 'leads' },
    ],
  });
}

// --- formatting ------------------------------------------------------------------------------------------------------

export const lang = () => UI_STATE.lang || 'en';
// Intl formatters are expensive to construct; cached per (language, digits). A failing locale caches null and falls
// back to toFixed.
const nf = new Map();
function numFmt(digits) {
  const k = lang() + digits;
  if (!nf.has(k)) { try { nf.set(k, new Intl.NumberFormat(lang(), { minimumFractionDigits: digits, maximumFractionDigits: digits })); } catch { nf.set(k, null); } }
  return nf.get(k);
}
// Fraction digits come from the currency (minorUnits: 2 for EUR, 0 for JPY...), the currency code is appended rather
// than using style:currency, so every language shows the same unambiguous ISO code.
export function money(m, cur = P.currency) {
  const d = minorUnits(cur);
  const f = numFmt(d), v = fromMinor(m, cur);
  return (f ? f.format(v) : v.toFixed(d)) + ' ' + cur;
}
export const moneyIn = (m, cur = P.currency) => decimalText(m, cur);
// Negative amounts are clamped to 0: prices and fees are never negative here; refunds are modelled as operations.
export const parseMoney = (s, cur = P.currency) => Math.max(0, toMinor(s, cur));
export const fmtNum = (n, d = 0) => { const f = numFmt(d); return f ? f.format(n) : Number(n).toFixed(d); };
export const pct = (x, d = 1) => fmtNum(x * 100, d) + ' %';
export const permille = (x) => (x >= 0 ? fmtNum(x / 10, 1) + ' %' : '—');

// Other currencies of the project at the hand-typed rates: ['≈ 100.00 USD', …].
// Hand-typed rates only (no network): the app works offline and the owner controls the conversion.
export function equivalents(m) {
  const table = ratesTable(P);
  return CURRENCIES.filter((c) => c !== P.currency).map((c) => {
    const v = convertMinor(m, P.currency, c, table);
    return v == null ? '' : '≈ ' + money(v, c);
  }).filter(Boolean);
}

const dfCache = new Map();
function dayFmt(opts) {
  const k = lang() + JSON.stringify(opts);
  if (!dfCache.has(k)) { try { dfCache.set(k, new Intl.DateTimeFormat(lang(), { timeZone: 'UTC', ...opts })); } catch { dfCache.set(k, null); } }
  return dfCache.get(k);
}
const utc = (day) => new Date(dayNum(day) * 864e5);
// '12 Oct' (short), with the year when it is not the current one.
export function fmtDay(day, { year = false, weekday = false } = {}) {
  if (!isDay(day)) return '—';
  const y = year || day.slice(0, 4) !== TODAY.slice(0, 4);
  const f = dayFmt({ day: 'numeric', month: 'short', ...(y ? { year: 'numeric' } : {}), ...(weekday ? { weekday: 'short' } : {}) });
  return f ? f.format(utc(day)) : day;
}
export const fmtRange = (a, b) => `${fmtDay(a)} – ${fmtDay(b)}`;
export const monthTitle = (month) => formatYearMonth(+month.slice(0, 4), +month.slice(5, 7), lang(), 'monthLong');
export const wdShort = (i) => t('rs.wd.' + i);

// --- labels of library codes in the UI language ---------------------------------------------------------------------

export const articleText = (a) => (!a ? '—' : isLedgerArticle(a) ? t('rs.art.' + a) : a);
export const kindText = (k) => t('rs.op.' + k);
export const partyKindText = (k) => t('rs.pk.' + k);
export const channelText = (c) => t('rs.ch.' + c);
export const statusText = (s) => t('rs.st.' + s);
export const dealText = (s) => t('rs.deal.' + s);
export function partyName(id) {
  const p = P.parties.find((x) => x.id === String(id));
  return p ? p.name : String(id ?? '—');
}
export const unitName = (id) => (P.units.find((u) => u.id === id) || {}).name || '—';

// --- widgets ---------------------------------------------------------------------------------------------------------

let gid = 0;
// Labelled group for controls that are not a single <input> (segmented buttons, pickers): aria-labelledby ties the
// visible label to the control for screen readers, since <label for> only works with labelable elements.
export function group(label, control, hint) {
  const id = 'rs-g' + (++gid);
  control.setAttribute('aria-labelledby', id);
  return h('div', { class: 'ed-field' }, h('span', { class: 'ed-label', id }, t(label)), control, hint ? h('div', { class: 'ed-hint' }, hint) : null);
}

export function kvRows(rows) {
  const dl = h('dl', { class: 'ap-kv rs-kv' });
  for (const [k, v, extra] of rows) {
    if (v == null || v === '') continue;
    dl.append(h('dt', {}, t(k)), h('dd', {}, v, extra || null));
  }
  return dl;
}

// Table: head = [label keys or '=text'], rows = [[cell, …]] (cells: text or nodes); opts.foot = a totals row.
// Header cells: i18n key, or literal text with a leading "=". Numeric columns (num) get .rs-num on th and td.
// A cell may be a ready <td> (custom attributes) and a row a ready <tr>.
export function table(head, rows, { cls = '', foot = null, num = [] } = {}) {
  const th = (x, i) => h('th', { scope: 'col', class: num.includes(i) ? 'rs-num' : null }, String(x).startsWith('=') ? String(x).slice(1) : t(x));
  const td = (x, i) => (x instanceof HTMLElement && x.tagName === 'TD' ? x : h('td', { class: num.includes(i) ? 'rs-num' : null }, x));
  return h('div', { class: 'ap-table-wrap rs-tw' }, h('table', { class: 'ap-table rs-table ' + cls },
    h('thead', {}, h('tr', {}, head.map(th))),
    h('tbody', {}, rows.map((r) => (r instanceof HTMLElement ? r : h('tr', {}, r.map(td))))),
    foot ? h('tfoot', {}, h('tr', {}, foot.map(td))) : null));
}

// Month title is aria-live so screen readers hear the new month after prev/next. The native month picker is a
// shortcut for far jumps; its value is validated because some browsers fall back to a text input.
export function monthNav(month, onChange) {
  const go = (k) => onChange(monthAdd(month + '-01', k).slice(0, 7));
  const prev = h('button', { type: 'button', class: 'ed-iconbtn', 'aria-label': t('rs.m.prev'), title: t('rs.m.prev'), onclick: () => go(-1) }, iconEl('left'));
  const next = h('button', { type: 'button', class: 'ed-iconbtn', 'aria-label': t('rs.m.next'), title: t('rs.m.next'), onclick: () => go(1) }, iconEl('right'));
  const now = h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => onChange(thisMonth()) }, t('rs.m.today'));
  const inp = h('input', { type: 'month', class: 'ed-input rs-month-in', value: month, 'aria-label': t('rs.m.pick') });
  inp.addEventListener('change', () => { if (/^\d{4}-\d{2}$/.test(inp.value)) onChange(inp.value); });
  return h('div', { class: 'rs-mnav' }, prev, h('strong', { class: 'rs-mtitle', 'aria-live': 'polite' }, monthTitle(month)), next, inp, month !== thisMonth() ? now : null);
}

// A money input: shows decimals, calls back with minor units.
// Empty field reports null (no value), distinct from 0 (explicit zero).
export function moneyInput(value, onInput, attrs = {}) {
  const i = h('input', { class: 'ed-input rs-money', inputmode: 'decimal', autocomplete: 'off', value: value == null ? '' : moneyIn(value), ...attrs });
  i.addEventListener('input', () => onInput(i.value.trim() === '' ? null : parseMoney(i.value)));
  return i;
}
// Both input and change: some browsers fire only change when a date is picked from the calendar popup.
export function dayInput(value, onInput, attrs = {}) {
  const i = h('input', { type: 'date', class: 'ed-input rs-day', value: value || '', ...attrs });
  i.addEventListener('input', () => onInput(i.value));
  i.addEventListener('change', () => onInput(i.value));
  return i;
}
export function numInput(value, onInput, attrs = {}) {
  const i = h('input', { type: 'number', class: 'ed-input rs-numin', value: value ?? '', ...attrs });
  i.addEventListener('input', () => onInput(i.value === '' ? null : Number(i.value)));
  return i;
}

export function note(kind, msg, attrs = {}) {
  return h('div', { class: 'rs-w rs-w-' + kind, role: kind === 'error' ? 'alert' : null, ...attrs }, iconEl(kind === 'info' ? 'info' : kind === 'ok' ? 'check' : 'warn'), h('span', {}, msg));
}

export function statBox(label, value, sub, attrs = {}) {
  return h('div', { class: 'rs-stat', ...attrs }, h('div', { class: 'rs-stat-l' }, t(label)), h('div', { class: 'rs-stat-v' }, value), sub ? h('div', { class: 'rs-stat-s' }, sub) : null);
}

export const dot = (color) => h('span', { class: 'rs-dot', style: { background: color }, 'aria-hidden': 'true' });

// Plain dark / light of the page (for drawings that cannot use CSS variables).
// For canvas/SVG drawings that need concrete colours (CSS variables are not readable inside a data URL or canvas).
export function isDark() {
  const th = document.documentElement.getAttribute('data-theme');
  return th ? th === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}
export function onSchemeChange(fn) {
  new MutationObserver(fn).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', fn);
}

// Printing one element: the page hides everything else while the print dialog is open.
// Print one element: it is placed in #rs-print and body.rs-printing hides everything else (see app.css @media print).
// Cleanup on afterprint, with a 1 s timer fallback because some browsers (mobile Safari) do not fire afterprint
// reliably; print() is deferred 50 ms so the DOM change is rendered before the print snapshot.
export function printNode(node) {
  let sheet = document.getElementById('rs-print');
  if (sheet) sheet.remove();
  sheet = h('div', { id: 'rs-print', class: 'rs-print' }, node);
  document.body.append(sheet);
  document.body.classList.add('rs-printing');
  const done = () => { document.body.classList.remove('rs-printing'); sheet.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(done, 1000); }, 50);
}
