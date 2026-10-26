// stock-analyzer/common.js - shared parts of the analysis, reorder and expiry pages: the shell (pages resolved from
// the hidden anchors of the page HTML, so the build can rewrite them), app icons, the dataset and the per-page state
// kept in localStorage (the demo is loaded when nothing is stored), money / number / date formatting with Intl, the
// column mapping card of imports, file reading, CSV / XLSX exports and small widgets (KPI tiles, class badges,
// sparklines).
//
// State design: four localStorage records. sa-data = the dataset (sales aggregated by data.js), sa-settings =
// analysis options, sa-plan / sa-expiry = page state of the reorder and expiry pages. Plan and expiry records carry
// the `key` of the dataset they were made for (dataKey): importing a new dataset silently invalidates them, because
// stock levels and batches of another dataset would be meaningless, while settings survive.
// Money: integer minor units of the dataset currency (D.digits decimals); converted to a float only for display or
// spreadsheet export.
//
// Side-effect import first: strings.js registers the app's i18n keys before any t() call.
import './strings.js';
import { button, card, download, startApp, t, toast } from '../ui/app.js';
import { h, lsGet, lsSet } from '../ui/dom.js';
import { addIcons } from '../ui/icons.js';
import { UI_STATE } from '../ui/i18n.js';
import { serializeCSV } from '../csv/csv.js';
import { writeXLSX } from '../xlsx/write.js';
import { COMMON_CURRENCIES, fromMinor, isCurrency } from '../payments/money.js';
import { ANALYSIS_DEFAULTS, PLAN_DEFAULTS, MARKDOWN_RULES, SALES_FIELDS, addDays, analyze, buildSales, readTable } from './data.js';
import { DEMO_CAT_SUPPLIER, DEMO_SUPPLIERS, demoBatches, demoStock, demoTable } from './demo.js';

export const LOGO = 'M4 20V10M9.5 20V4M15 20v-7M20.5 20v-4M3 20h18M4 7l5.5-3 5.5 6 5.5-4';

addIcons({
  pareto: LOGO,
  truck: 'M2 6h11v10H2zM13 9h4l4 4v3h-8zM6.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  hourglass: 'M6 2h12M6 22h12M7 2c0 5 10 6 10 10S7 17 7 22M17 2c0 5-10 6-10 10s10 5 10 10',
  demo: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  box: 'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  matrix3: 'M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18',
});

// --- shell ----------------------------------------------------------------------------------------------------------

// getAttribute, not a.href: .href is absolute (file:///...), breaking relative links once published.
export function pageHref(id) {
  const a = document.getElementById(id);
  return a ? a.getAttribute('href') : '#';
}

export function startShell(current, onLang) {
  startApp({
    key: 'sa', name: 'sa.name', logo: LOGO, offline: true, onLang,
    pages: [
      { href: pageHref('pg-analysis'), label: 'sa.page.analysis', current: current === 'analysis' },
      { href: pageHref('pg-plan'), label: 'sa.page.plan', current: current === 'plan' },
      { href: pageHref('pg-expiry'), label: 'sa.page.expiry', current: current === 'expiry' },
    ],
  });
}

// --- state ----------------------------------------------------------------------------------------------------------

const DKEY = 'sa-data', SKEY = 'sa-settings', PKEY = 'sa-plan', EKEY = 'sa-expiry';
// GEL first: the app's home market (Georgia); then the common ISO codes.
export const CURRENCIES = [...new Set(['GEL', ...COMMON_CURRENCIES])];

// Shape check of a stored dataset; anything else (old version, corrupted) falls back to the demo.
const validData = (D) => D && D.v === 1 && Array.isArray(D.items) && Array.isArray(D.stores) && D.q && D.r && typeof D.today === 'string';

// The demo goes through buildSales like a user file, so the demo exercises exactly the import code path.
/** The demo dataset (built through the same import path as a file). */
export function demoData(currency = 'GEL') {
  const table = demoTable();
  const map = Object.fromEntries(SALES_FIELDS.map((f) => [f, table.headers.findIndex((x) => x.toLowerCase() === f.toLowerCase())]));
  return buildSales(table, map, { currency, source: 'demo', name: 'demo' });
}

// Module-level cache: the dataset can be several MB; parsing localStorage on every getData() call would be slow.
let DATA = null;
export function getData() {
  if (DATA) return DATA;
  const saved = lsGet(DKEY, null);
  DATA = validData(saved) ? saved : demoData(loadSettings().currency);
  return DATA;
}
// Stores the dataset; returns false when the browser refused it (too big): the page keeps it for this visit.
// localStorage quota (about 5 MB) can be exceeded by a large sales history: the data stays in memory for this visit
// and the caller warns the user, instead of failing the import.
export function setData(D) {
  DATA = D;
  try { localStorage.setItem(DKEY, JSON.stringify(D)); return true; } catch { return false; }
}

export function loadSettings() {
  // Settings restored field by field with type checks; unknown or invalid values keep their defaults.
  const v = lsGet(SKEY, null) || {};
  const s = { ...ANALYSIS_DEFAULTS, store: '*', cat: '*', currency: 'GEL', sort: { k: 'rank', d: 1 }, cell: '', q: '' };
  for (const k of ['aCut', 'bCut', 'xMax', 'yMax', 'minWeeks']) if (typeof v[k] === 'number' && Number.isFinite(v[k])) s[k] = v[k];
  if (['revenue', 'profit', 'qty'].includes(v.basis)) s.basis = v.basis;
  for (const k of ['store', 'cat', 'cell', 'q']) if (typeof v[k] === 'string') s[k] = v[k];
  if (isCurrency(v.currency)) s.currency = v.currency;
  if (v.sort && typeof v.sort.k === 'string') s.sort = { k: v.sort.k, d: v.sort.d === -1 ? -1 : 1 };
  return s;
}
export const saveSettings = (s) => lsSet(SKEY, s);

/** The network-wide ABC / XYZ of the stored settings (the plan and expiry pages use it without filters). */
export function networkAnalysis(D = getData()) {
  const s = loadSettings();
  return analyze(D, s, {});
}

// Plan state: { key (dataset it belongs to), today, window, cover, service, suppliers, catSupplier, stock, stockSource }
// Identity of a dataset: source, name, last day and item count. Cheap, and changes whenever a different file is
// imported (a full hash of the data would be exact but costly on every page load).
const dataKey = (D) => `${D.source}|${D.name}|${D.today}|${D.items.length}`;
export function loadPlan(D = getData()) {
  const v = lsGet(PKEY, null);
  if (v && v.key === dataKey(D) && Array.isArray(v.suppliers)) {
    // Nested service levels merged over defaults so a newly added class still gets a value.
    return { ...PLAN_DEFAULTS, ...v, service: { ...PLAN_DEFAULTS.service, ...(v.service || {}) } };
  }
  return freshPlan(D);
}
export function freshPlan(D) {
  const demo = D.source === 'demo';
  const cats = [...new Set(D.items.map((i) => i.cat))];
  const suppliers = demo ? structuredClone(DEMO_SUPPLIERS) : [{ id: 'sup1', name: t('sa.p.mainSupplier'), leadDays: 2, orderDays: [], minQty: 0, multiple: 1, holidays: [] }];
  const catSupplier = demo ? { ...DEMO_CAT_SUPPLIER } : Object.fromEntries(cats.map((c) => [c, 'sup1']));
  return {
    // Planning starts the day after the last sales day (the first day without data).
    key: dataKey(D), today: addDays(D.today, 1), window: PLAN_DEFAULTS.window, cover: PLAN_DEFAULTS.cover, service: { ...PLAN_DEFAULTS.service },
    suppliers, catSupplier, stock: demo ? demoStock(D) : {}, stockSource: demo ? 'demo' : '', onlyOrders: true, q: '', store: '*',
  };
}
export const savePlan = (P) => { try { localStorage.setItem(PKEY, JSON.stringify(P)); } catch { toast(t('sa.err.storage'), 'warn'); } };

// Expiry state: { key, today, warnDays, rules, batches, batchSource, store }
export function loadExpiry(D = getData()) {
  const v = lsGet(EKEY, null);
  if (v && v.key === dataKey(D) && Array.isArray(v.batches)) return { warnDays: 3, rules: MARKDOWN_RULES, store: '*', ...v };
  return freshExpiry(D);
}
export function freshExpiry(D) {
  const demo = D.source === 'demo';
  const today = addDays(D.today, 1);
  return { key: dataKey(D), today, warnDays: 3, rules: structuredClone(MARKDOWN_RULES), batches: demo ? demoBatches(D, loadPlan(D).stock, today) : [], batchSource: demo ? 'demo' : '', store: '*' };
}
export const saveExpiry = (E) => { try { localStorage.setItem(EKEY, JSON.stringify(E)); } catch { toast(t('sa.err.storage'), 'warn'); } };

// --- formatting -----------------------------------------------------------------------------------------------------

const lang = () => UI_STATE.lang || document.documentElement.lang || 'en';
const nf = new Map();
// Intl.NumberFormat cache keyed by language + a caller-supplied key that must encode the options (the options
// object itself is not part of the key). An unsupported locale falls back to English formatting.
function fmt(key, opts) {
  const k = lang() + '|' + key;
  let f = nf.get(k);
  if (!f) {
    try { f = new Intl.NumberFormat(lang(), opts); } catch { f = new Intl.NumberFormat('en', opts); }
    nf.set(k, f);
  }
  return f;
}

/** Minor units -> currency text of the dataset currency; whole: no decimals (big totals), compact: 12.3K. */
export function money(minor, { whole = false, compact = false, D = getData() } = {}) {
  if (minor == null || !Number.isFinite(minor)) return '—';
  // narrowSymbol: "₾" / "$" instead of "GEL" / "US$"; compact for KPI tiles, whole units for large totals.
  const v = fromMinor(minor, D.currency, D.digits);
  const cur = isCurrency(D.currency) ? D.currency : 'GEL';
  const o = { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol' };
  if (compact) Object.assign(o, { notation: 'compact', maximumFractionDigits: 1 });
  else if (whole) Object.assign(o, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  try { return fmt(`m|${cur}|${whole}|${compact}`, o).format(v); } catch { return v.toFixed(whole ? 0 : 2) + ' ' + cur; }
}
export const fmtNum = (n, d = 0) => (n == null || !Number.isFinite(n) ? '—' : fmt('n' + d, { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(n));
export const fmtPct = (x, d = 1) => (x == null || !Number.isFinite(x) ? '—' : fmt('p' + d, { style: 'percent', maximumFractionDigits: d, minimumFractionDigits: 0 }).format(x));
export function fmtDay(day, opts = { day: 'numeric', month: 'short' }) {
  if (!day) return '—';
  // Day strings are formatted in UTC: new Date('YYYY-MM-DD') at local midnight could show the previous day in
  // negative-offset time zones.
  try { return new Intl.DateTimeFormat(lang(), { ...opts, timeZone: 'UTC' }).format(new Date(day + 'T00:00:00Z')); } catch { return day; }
}
// Short weekday names, Monday first (ISO 1..7).
export function weekdayNames(style = 'short') {
  // 2024-01-01 was a Monday, so day i = ISO weekday i + 1; localised by Intl, single letters as the last resort.
  return Array.from({ length: 7 }, (_, i) => {
    try { return new Intl.DateTimeFormat(lang(), { weekday: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + i))); } catch { return 'MTWTFSS'[i]; }
  });
}
export const storeLabel = (s) => s || t('sa.store.one');

// --- widgets --------------------------------------------------------------------------------------------------------

export function kpi(label, value, sub, cls = '') {
  return h('div', { class: 'sa-kpi' + (cls ? ' ' + cls : '') }, h('div', { class: 'sa-kpi-l' }, label), h('div', { class: 'sa-kpi-v' }, value), sub ? h('div', { class: 'sa-kpi-s' }, sub) : null);
}

// Class badge (AX … CZ, A- for items without XYZ yet).
export function cellBadge(abc, xyz) {
  const cell = xyz ? abc + xyz : abc;
  // Items with too short a history have no XYZ class yet: shown as "A·" with a tooltip instead of a fake class.
  return h('span', { class: `sa-badge sa-c-${abc}`, title: xyz ? null : t('sa.adv.new') }, cell, xyz ? null : h('span', { class: 'sa-badge-new' }, '·'));
}

// Weekly series sparkline (SVG markup): oldest week left, the last week marked.
export function sparkline(values, { w = 84, h = 22 } = {}) {
  const n = values.length;
  if (!n) return '';
  // Scaled to the series maximum (|| 1 avoids division by zero for all-zero series); 2px padding keeps the stroke
  // inside the box. aria-hidden: the numbers are in the table; the sparkline is a visual summary only.
  const max = Math.max(...values, 0) || 1;
  const pts = values.map((v, i) => `${((i / Math.max(1, n - 1)) * (w - 4) + 2).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`);
  const last = pts[n - 1].split(',');
  return `<svg class="sa-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="${last[0]}" cy="${last[1]}" r="1.8" fill="currentColor"/></svg>`;
}

// Sortable table: cols [{ k, l (key), num?, sort?: (row) => value, cell: (row) => Node | text, cls? }].
export function sortTable(cols, rows, sort, onSort, { limit = 0, caption = '' } = {}) {
  const sorted = [...rows];
  const col = cols.find((c) => c.k === sort.k && c.sort);
  // Nulls sort last in both directions: (x == null) - (y == null) decides before the value comparison is reversed.
  if (col) sorted.sort((a, b) => { const x = col.sort(a), y = col.sort(b); return (x == null) - (y == null) || (x < y ? -1 : x > y ? 1 : 0) * sort.d; });
  const shown = limit ? sorted.slice(0, limit) : sorted;
  const head = h('tr', {}, cols.map((c) => {
    const on = c.k === sort.k;
    // aria-sort on the active header; header buttons toggle direction. Numeric columns start descending (largest first),
    // text columns ascending.
    const th = h('th', { scope: 'col', class: (c.num ? 'sa-num ' : '') + (c.cls || ''), 'aria-sort': on ? (sort.d === 1 ? 'ascending' : 'descending') : null });
    if (!c.sort) { th.textContent = t(c.l); return th; }
    th.append(h('button', { type: 'button', class: 'sa-sort' + (on ? ' sa-on' : ''), onclick: () => onSort({ k: c.k, d: on ? -sort.d : c.num ? -1 : 1 }) },
      t(c.l), h('span', { class: 'sa-sort-i', 'aria-hidden': 'true' }, on ? (sort.d === 1 ? '▲' : '▼') : '')));
    return th;
  }));
  const body = h('tbody', {}, shown.map((r) => h('tr', {}, cols.map((c) => {
    const v = c.cell(r);
    return h('td', { class: (c.num ? 'sa-num ' : '') + (c.cls || '') }, v instanceof Node ? v : v == null ? '' : String(v));
  }))));
  // A visually hidden caption names the table for screen readers.
  return h('div', { class: 'ap-table-wrap sa-table-wrap' }, h('table', { class: 'ap-table sa-table' }, caption ? h('caption', { class: 'sa-sr' }, caption) : null, h('thead', {}, head), body));
}

// --- import ---------------------------------------------------------------------------------------------------------

/** Reads a dropped / picked / pasted file into { headers, rows } (toast on errors). */
export async function readFileTable(file) {
  try {
    const table = await readTable(new Uint8Array(await file.arrayBuffer()), file.name);
    if (!table.headers.length || !table.rows.length) { toast(t('sa.err.emptyFile'), 'warn'); return null; }
    return table;
  } catch (e) {
    toast(e && e.message === 'unsupported' ? t('sa.err.unsupported') : t('ap.fileErr', { name: file.name, msg: e?.message || e }), 'error');
    return null;
  }
}

/**
 * Column mapping card: one select per field (labels 'sa.f.<field>'), required fields marked, a preview of the first
 * rows. onChange(map) runs after every change; `status` (an element) is filled by the caller with the result.
 */
export function mappingCard({ title = 'sa.map.title', table, fields, required = [], map, onChange, fileName = '', onClose }) {
  const preview = h('div', { class: 'sa-map-prev' });
  const paintPreview = () => {
    preview.textContent = '';
    const used = fields.filter((f) => map[f] >= 0);
    if (!used.length) return;
    preview.append(h('div', { class: 'ap-table-wrap' }, h('table', { class: 'ap-table sa-table sa-mini' },
      h('thead', {}, h('tr', {}, used.map((f) => h('th', { scope: 'col' }, t('sa.f.' + f))))),
      h('tbody', {}, table.rows.slice(0, 3).map((r) => h('tr', {}, used.map((f) => h('td', {}, String(r[map[f]] ?? '')))))))));
  };
  const grid = h('div', { class: 'sa-map-grid' });
  for (const f of fields) {
    const id = 'sa-map-' + f;
    const sel = h('select', { class: 'ed-input ed-select', id },
      h('option', { value: '-1' }, '—'),
      // Options list the file's headers by index; -1 = not mapped. The preview shows the first 3 rows of mapped columns.
      table.headers.map((x, i) => h('option', { value: String(i), selected: map[f] === i }, String(x))));
    sel.value = String(map[f] ?? -1);
    sel.addEventListener('change', () => { map[f] = +sel.value; paintPreview(); onChange(map); });
    grid.append(h('label', { class: 'ed-label sa-map-l', for: id }, t('sa.f.' + f), required.includes(f) ? h('span', { class: 'sa-req', 'aria-label': t('sa.map.required') }, ' *') : null), sel);
  }
  paintPreview();
  const status = h('div', { class: 'sa-map-status', role: 'status', 'aria-live': 'polite' });
  const close = onClose ? button('dlg.close', 'close', onClose) : null;
  if (close) close.classList.add('ed-sm');
  const c = card(title,
    h('div', { class: 'sa-map-file' }, h('b', {}, fileName || '—'), ' · ', t('sa.rows', { n: table.rows.length })),
    h('div', { class: 'ed-hint' }, t('sa.map.hint')),
    grid, preview, status, close ? h('div', { class: 'ap-actions' }, close) : null);
  c.classList.add('sa-map');
  c.status = status;
  return c;
}

// --- export ---------------------------------------------------------------------------------------------------------

export function exportCSV(rows, name) {
  // BOM for Excel UTF-8 detection; guard:true neutralises formula injection (= + - @ at cell start).
  download('﻿' + serializeCSV(rows, { guard: true }), name + '.csv', 'text/csv');
}
// sheets: [{ name, rows, widths? }] (first row bold and frozen).
export async function exportXLSX(sheets, name) {
  const book = {
    sheets: sheets.map((s) => ({
      name: s.name,
      // Header row bold and frozen: the usual spreadsheet convention for data exports.
      rows: s.rows.map((r, i) => (i === 0 ? r.map((v) => ({ v, s: { bold: true } })) : r)),
      cols: (s.widths || []).map((w) => ({ width: w })),
      freeze: { rows: 1, cols: 0 },
    })),
  };
  download(await writeXLSX(book, { creator: t('sa.name'), title: name }), name + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
// Minor units -> a plain number for spreadsheets.
export const major = (minor, D = getData()) => (minor == null ? '' : fromMinor(minor, D.currency, D.digits));

/** One-line summary of the dataset (source, items, stores, period). */
export function dataSummary(D = getData()) {
  const src = D.source === 'demo' ? t('sa.d.demo') : D.name || t('sa.d.file');
  return h('div', { class: 'sa-dsum' },
    h('div', { class: 'sa-dsum-src' }, h('b', {}, src)),
    h('div', { class: 'sa-dsum-meta' }, [t('sa.items', { n: D.items.length }), t('sa.stores', { n: D.stores.length }), t('sa.weeks', { n: D.weeks }),
      `${fmtDay(D.from)} – ${fmtDay(D.today, { day: 'numeric', month: 'short', year: 'numeric' })}`].join(' · ')));
}
