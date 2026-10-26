// stock-analyzer/main.js - the analysis page: sales data from a dropped / picked / pasted CSV or XLSX file (columns
// mapped automatically, adjustable) or the built-in demo, ABC / XYZ settings (basis, cut-offs, XYZ limits, minimum
// history), filters by store and category, KPI tiles, the Pareto chart with adjustable A / B cut-offs, the 3×3
// matrix with counts, value shares and advice per cell (a click filters the table), and the sortable item table
// with classes, CV and weekly sparklines; exports of the classes as CSV / XLSX.
//
// Flow: table (file / paste / demo) -> mapping (suggested, user-correctable) -> buildSales() -> dataset D (stored)
// -> analyze(D, settings, filter) -> R.A (rows, matrix, totals) -> KPI / chart / matrix / table painters.
// Settings changes recompute R.A and repaint (80ms debounce for slider drags); only a new dataset re-renders the
// whole page. R holds transient state: the current analysis, the raw table while its mapping card is open, the
// table row limit.
import {
  CURRENCIES, cellBadge, dataSummary, demoData, exportCSV, exportXLSX, fmtNum, fmtPct, freshExpiry, freshPlan, getData, kpi,
  loadSettings, major, mappingCard, money, readFileTable, saveExpiry, savePlan, saveSettings, setData, sortTable, sparkline, startShell, storeLabel,
} from './common.js';
import { paretoSVG } from './charts.js';
import { SALES_FIELDS, SALES_REQUIRED, analyze, buildSales, categories, suggestColumns, tableFromText, withCurrency } from './data.js';
import { demoTable } from './demo.js';
import { button, card, download, dropZone, field, range, seg, select, t, textInput, toast } from '../ui/app.js';
import { $, debounce, h } from '../ui/dom.js';
import { openDialog } from '../ui/overlays.js';
import { CELLS } from '../stock/abc.js';
import { serializeCSV } from '../csv/csv.js';

const S = loadSettings();
const save = debounce(() => saveSettings(S), 250);
// Rendering the item table is capped at 200 rows until the user asks for all (DOM size, not computation, is the cost).
const R = { A: null, table: null, map: null, fileName: '', limit: 200 };
const main = $('#main');
main.classList.add('sa-page', 'sa-analysis');
const els = {};

// --- data ---------------------------------------------------------------------------------------------------------

function useData(D, msg) {
  const stored = setData(D);
  // A new dataset starts fresh plan and expiry states (suppliers, stock and batches belong to the data).
  // Dataset-bound states are reset in the same step, so the reorder / expiry pages never combine old stock or batches
  // with new sales.
  savePlan(freshPlan(D));
  saveExpiry(freshExpiry(D));
  if (!D.stores.includes(S.store)) S.store = '*';
  if (S.cat !== '*' && !D.items.some((i) => i.cat === S.cat)) S.cat = '*';
  S.cell = '';
  save();
  // setData returns false when localStorage refused the dataset (quota): the warning says it lives for this visit only.
  if (msg) toast(msg + (stored ? '' : ' ' + t('sa.err.storage')), stored ? 'ok' : 'warn');
  render();
}

function loadDemo() {
  R.table = null;
  useData(demoData(S.currency), t('sa.d.demoLoaded'));
}

function takeTable(table, name) {
  if (!table) return;
  R.table = table;
  R.fileName = name;
  R.map = suggestColumns(table.headers, SALES_FIELDS);
  applyMapping(true);
}

function applyMapping(first) {
  const miss = SALES_REQUIRED.filter((f) => R.map[f] < 0);
  // Item identity needs a SKU or a name column; date and quantity are required.
  if (R.map.sku < 0 && R.map.name < 0) miss.push('sku');
  if (miss.length) {
    if (first) render();
    paintMapStatus(t('sa.map.missing', { f: miss.map((f) => t('sa.f.' + f)).join(', ') }), 'warn');
    return;
  }
  const D = buildSales(R.table, R.map, { currency: S.currency, name: R.fileName });
  if (D.error) {
    if (first) render();
    paintMapStatus(t('sa.map.noLines', { n: D.skipped }), 'warn');
    return;
  }
  // Toast only on the first apply; later mapping corrections just update the status line.
  useData(D, first ? t('sa.d.loaded', { n: D.items.length }) : '');
  paintMapStatus(t('sa.map.ok', { n: D.lines }) + (D.skipped ? ' ' + t('sa.map.skipped', { n: D.skipped }) : ''), D.skipped ? 'warn' : 'ok');
}
function paintMapStatus(text, kind) {
  const st = els.map?.status;
  if (!st) return;
  st.textContent = text;
  st.className = 'sa-map-status sa-st-' + kind;
}

async function onFiles(files) {
  const f = files[0];
  if (!f) return;
  takeTable(await readFileTable(f), f.name);
}

function pasteDialog() {
  const ta = h('textarea', { class: 'ed-input ed-textarea sa-paste', rows: 10, spellcheck: 'false', 'aria-label': t('sa.d.pasteLabel'), placeholder: 'date;sku;name;category;store;qty;revenue;cost\n2026-10-18;DAI-01;Matsoni 0.5 l;Dairy;Vake;41;98.40;72.80' });
  openDialog({ title: t('sa.d.paste'), body: h('div', { class: 'ed-fields' }, h('div', { class: 'ed-hint' }, t('sa.d.pasteHint')), ta), wide: true, buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('sa.d.read'), value: 'go', primary: true }], onMount: () => ta.focus() })
    .then((v) => {
      if (v !== 'go') return;
      const table = tableFromText(ta.value);
      if (!table.rows.length) { toast(t('sa.err.emptyFile'), 'warn'); return; }
      takeTable(table, t('sa.d.pasted'));
    });
}

function demoCSV() {
  const tb = demoTable();
  // The demo as a CSV file: users can open it to see the expected format, edit it and import it back.
  download('﻿' + serializeCSV([tb.headers, ...tb.rows]), 'stock-analyzer-demo-sales.csv', 'text/csv');
}

// --- layout -------------------------------------------------------------------------------------------------------

function render() {
  const D = getData();
  main.textContent = '';
  const cur = select(CURRENCIES.map((c) => ({ v: c, l: '=' + c })), D.currency, (v) => {
    S.currency = v; save();
    // Relabelling the currency rescales minor units (withCurrency): values are not converted between currencies.
    setData(withCurrency(getData(), v));
    render();
  });
  const drop = dropZone({ onFiles, accept: '.csv,.tsv,.txt,.xlsx,.xlsm,text/csv', label: 'sa.d.drop' });
  const b = (l, ic, fn, k) => { const x = button(l, ic, fn, k); x.classList.add('ed-sm'); return x; };
  const dataCard = card('sa.d.title', dataSummary(D), drop,
    h('div', { class: 'ap-actions' }, b('sa.d.paste', 'paste', pasteDialog), b('sa.d.loadDemo', 'demo', loadDemo, D.source === 'demo' ? '' : 'primary'), b('sa.d.demoCsv', 'download', demoCSV)),
    h('div', { class: 'ed-fields sa-mt' }, field('sa.d.currency', cur, 'sa.d.currencyHint')),
    h('div', { class: 'ed-hint' }, t('sa.d.format')));
  dataCard.id = 'sa-data';

  els.map = null;
  if (R.table) {
    els.map = mappingCard({ table: R.table, fields: SALES_FIELDS, required: [...SALES_REQUIRED, 'sku'], map: R.map, fileName: R.fileName, onChange: () => applyMapping(false), onClose: () => { R.table = null; render(); } });
  }

  const basis = seg([{ v: 'revenue', l: 'sa.b.revenue' }, { v: 'profit', l: 'sa.b.profit' }, { v: 'qty', l: 'sa.b.qty' }], S.basis, (v) => {
    // Profit basis needs cost data; the segment snaps back instead of silently analysing revenue.
    if (v === 'profit' && !D.hasCost) { toast(t('sa.b.noCost'), 'warn'); basis.set(S.basis); return; }
    S.basis = v; changed();
  }, 'sa.s.basis');
  const xyz = h('div', { class: 'ed-fields' },
    // XYZ limits stay ordered: Y must exceed X by at least 0.05, so the slider pair can never cross.
    field('sa.s.xMax', range({ min: 0.05, max: 1, step: 0.05, value: S.xMax, onInput: (v) => { S.xMax = v; if (S.yMax <= v) { S.yMax = Math.min(2, +(v + 0.05).toFixed(2)); els.yr.set(S.yMax); } changed(); } }), 'sa.s.xHint'),
    field('sa.s.yMax', (els.yr = range({ min: 0.1, max: 2, step: 0.05, value: S.yMax, onInput: (v) => { S.yMax = Math.max(v, S.xMax + 0.05); changed(); } })), 'sa.s.yHint'),
    field('sa.s.minWeeks', range({ min: 2, max: Math.min(26, D.weeks), step: 1, value: Math.min(S.minWeeks, D.weeks), onInput: (v) => { S.minWeeks = v; changed(); } }), 'sa.s.minWeeksHint'));
  const settingsCard = card('sa.s.title', h('div', { class: 'ed-field' }, h('span', { class: 'ed-label', id: 'sa-basis-l' }, t('sa.s.basis')), basis), xyz);
  basis.setAttribute('aria-labelledby', 'sa-basis-l');

  const stores = select([{ v: '*', l: 'sa.f.allStores' }, ...D.stores.map((s) => ({ v: s, l: '=' + storeLabel(s) }))], S.store, (v) => { S.store = v; S.cell = ''; changed(); });
  const cats = select([{ v: '*', l: 'sa.f.allCats' }, ...categories(D).map((c) => ({ v: c, l: '=' + (c || '—') }))], S.cat, (v) => { S.cat = v; S.cell = ''; changed(); });
  const filterCard = card('sa.f.title', h('div', { class: 'ed-fields' }, field('sa.f.store', stores), field('sa.f.category', cats)));

  els.kpis = h('div', { class: 'sa-kpis', role: 'group', 'aria-label': t('sa.k.title') });
  els.chart = h('div', { class: 'sa-chart' });
  els.chartNote = h('div', { class: 'sa-chart-note', 'aria-live': 'polite' });
  const cuts = h('div', { class: 'sa-cuts' },
    // A / B cut-offs stay ordered the same way (B at least one point above A).
    field('sa.s.aCut', (els.ar = range({ min: 50, max: 95, step: 1, value: Math.round(S.aCut * 100), unit: ' %', onInput: (v) => { S.aCut = v / 100; if (S.bCut <= S.aCut) { S.bCut = Math.min(0.995, +(S.aCut + 0.01).toFixed(3)); els.br.set(+(S.bCut * 100).toFixed(1)); } changed(); } }))),
    field('sa.s.bCut', (els.br = range({ min: 60, max: 99.5, step: 0.5, value: +(S.bCut * 100).toFixed(1), unit: ' %', onInput: (v) => { S.bCut = Math.max(v / 100, S.aCut + 0.01); changed(); } }))));
  const legend = h('div', { class: 'sa-legend' }, ['A', 'B', 'C'].map((k) => h('span', { class: 'sa-leg' }, h('i', { class: 'sa-sw sa-b-' + k }), t('sa.cls.' + k))),
    h('span', { class: 'sa-leg' }, h('i', { class: 'sa-sw sa-sw-line' }), t('sa.ch.cum')));
  const paretoCard = card('sa.ch.title', legend, els.chart, els.chartNote, cuts);
  paretoCard.id = 'sa-pareto-card';

  els.matrix = h('div', { class: 'sa-matrix-wrap' });
  els.advice = h('div', { class: 'sa-advice', 'aria-live': 'polite' });
  const matrixCard = card('sa.m.title', els.matrix, els.advice);
  matrixCard.id = 'sa-matrix-card';

  const search = textInput(S.q, (v) => { S.q = v; save(); paintTable(); }, { type: 'search', placeholder: t('sa.t.search'), 'aria-label': t('sa.t.search') });
  els.tinfo = h('div', { class: 'sa-tinfo', role: 'status', 'aria-live': 'polite' });
  els.table = h('div', { class: 'sa-tbox' });
  const tableCard = card('sa.t.title',
    h('div', { class: 'sa-tbar' }, search, h('span', { class: 'ed-spacer' }), b('sa.x.csv', 'table', () => exportClasses('csv')), b('sa.x.xlsx', 'sheet', () => exportClasses('xlsx'))),
    els.tinfo, els.table);
  tableCard.id = 'sa-table-card';

  const side = h('div', { class: 'ap-side sa-side' }, dataCard, els.map, settingsCard, filterCard);
  const stage = h('div', { class: 'ap-stage' }, els.kpis, paretoCard, matrixCard, tableCard);
  main.append(h('div', { class: 'ap-work sa-work' }, side, stage));
  update();
}

const changed = () => { save(); updateSoon(); };
const updateSoon = debounce(() => update(), 80);

function update() {
  const D = getData();
  R.A = analyze(D, S, { store: S.store, cat: S.cat });
  paintKpis(D);
  paintChart();
  paintMatrix();
  paintTable();
}

// --- KPIs ---------------------------------------------------------------------------------------------------------

function paintKpis(D) {
  const A = R.A;
  const rev = A.rows.reduce((s, r) => s + r.revenue, 0);
  const prof = D.hasCost ? A.rows.reduce((s, r) => s + (r.profit ?? 0), 0) : null;
  const delist = A.matrix.CZ.count;
  els.kpis.textContent = '';
  els.kpis.append(
    kpi(t('sa.k.items'), fmtNum(A.rows.length), `A ${A.counts.A} · B ${A.counts.B} · C ${A.counts.C}`),
    kpi(t('sa.k.revenue'), money(rev, { whole: true }), t('sa.weeks', { n: D.weeks })),
    kpi(t('sa.k.profit'), prof == null ? '—' : money(prof, { whole: true }), prof == null ? t('sa.k.noCost') : t('sa.k.margin', { p: fmtPct(rev > 0 ? prof / rev : 0) })),
    kpi(t('sa.k.aShare'), fmtPct(A.rows.length ? A.counts.A / A.rows.length : 0, 0), t('sa.k.aShareSub', { p: fmtPct(shareOf('A'), 0) })),
    kpi(t('sa.k.delist'), fmtNum(delist), t('sa.k.delistSub', { p: fmtPct(A.total ? A.matrix.CZ.value / A.total : 0) }), delist ? 'sa-kpi-warn' : ''));
}
const shareOf = (k) => (R.A.total ? R.A.rows.filter((r) => r.abc === k).reduce((s, r) => s + r.value, 0) / R.A.total : 0);

// --- Pareto chart -------------------------------------------------------------------------------------------------

const valueText = (v, compact = false) => (S.basis === 'qty' || R.A?.settings.basis === 'qty' ? fmtNum(v, 0) + ' ' + t('sa.unit.pcs') : money(Math.round(v), compact ? { compact: true } : { whole: true }));
let chartW = 0;
function paintChart() {
  const box = els.chart;
  if (!box) return;
  const A = R.A;
  // Chart drawn at the container's pixel width (no CSS scaling of text); redrawn when the width changes by > 8px.
  const w = box.clientWidth || 800;
  chartW = w;
  const basisL = t('sa.b.' + A.settings.basis).toLowerCase();
  const svg = paretoSVG(A.rows, {
    width: w, height: w < 520 ? 250 : 320, aCut: A.settings.aCut, bCut: A.settings.bCut,
    fmtValue: (v) => valueText(v, true), fmtPct: (x, d = 0) => fmtPct(x, d),
    labels: { items: (n) => t('sa.items', { n }), xAxis: t('sa.ch.xAxis'), title: t('sa.ch.aria', { a: A.counts.A, p: fmtPct(shareOf('A'), 0), basis: basisL }) },
  });
  box.innerHTML = A.rows.length ? svg : '';
  if (!A.rows.length) box.append(h('div', { class: 'ap-empty' }, t('sa.t.none')));
  els.chartNote.textContent = A.rows.length ? t('sa.ch.note', {
    a: t('sa.items', { n: A.counts.A }), pa: fmtPct(A.rows.length ? A.counts.A / A.rows.length : 0, 0), sa: fmtPct(shareOf('A'), 0),
    b: t('sa.items', { n: A.counts.B }), sb: fmtPct(shareOf('B'), 0), c: t('sa.items', { n: A.counts.C }), sc: fmtPct(shareOf('C'), 0), basis: basisL,
  }) : '';
}
// The observer is created once at module load on <main>, which survives re-renders (only its children change).
new ResizeObserver(() => { if (els.chart && R.A && Math.abs((els.chart.clientWidth || 0) - chartW) > 8) paintChart(); }).observe(main);

// --- matrix -------------------------------------------------------------------------------------------------------

// Advice per matrix cell: AX / BX steady sellers can be reordered automatically; AZ (valuable but erratic) need
// watching; CZ (little value, erratic) are delisting candidates; CY / BZ deserve a review. Others: plain.
const ADVICE_KIND = { AX: 'auto', BX: 'auto', AZ: 'watch', CZ: 'delist', CY: 'review', BZ: 'review' };
function paintMatrix() {
  const A = R.A, M = A.matrix, box = els.matrix;
  box.textContent = '';
  const total = A.total || 1;
  const cell = (k) => {
    const c = M[k];
    const share = c.value / total;
    const on = S.cell === k;
    return h('td', { class: 'sa-mcell-td' }, h('button', {
      type: 'button', class: `sa-mcell sa-k-${ADVICE_KIND[k] || 'plain'}${on ? ' sa-on' : ''}${c.count ? '' : ' sa-empty'}`, 'aria-pressed': String(on),
      // --sh amplifies the share x2.2 so mid-sized cells are visibly tinted; capped at 1 (45%+ of value = full tint).
      dataset: { cell: k, count: String(c.count) }, style: { '--sh': Math.min(1, share * 2.2).toFixed(3) },
      // The aria-label carries everything the visual cell shows, plus the advice text.
      'aria-label': `${k}: ${t('sa.items', { n: c.count })}, ${fmtPct(share)} — ${t('sa.adv.' + (k.endsWith('-') ? 'new' : k))}`,
      onclick: () => { S.cell = on ? '' : k; save(); paintMatrix(); paintTable(); },
    }, h('span', { class: 'sa-mcode' }, k.endsWith('-') ? k[0] + ' ·' : k), h('span', { class: 'sa-mcount' }, fmtNum(c.count)),
      h('span', { class: 'sa-mshare' }, fmtPct(share)), h('span', { class: 'sa-madv' }, t('sa.advs.' + (k.endsWith('-') ? 'new' : k)))));
  };
  const s = A.settings;
  const head = h('tr', {}, h('th', { scope: 'col', class: 'sa-mcorner' }, h('span', { class: 'sa-sr' }, t('sa.m.class'))),
    h('th', { scope: 'col' }, 'X', h('small', {}, `CV ≤ ${fmtNum(s.xMax, 2)}`)),
    h('th', { scope: 'col' }, 'Y', h('small', {}, `≤ ${fmtNum(s.yMax, 2)}`)),
    h('th', { scope: 'col' }, 'Z', h('small', {}, `> ${fmtNum(s.yMax, 2)}`)),
    // Fourth column: items with too short a history for XYZ ("A-", "B-", "C-" cells).
    h('th', { scope: 'col', class: 'sa-mnew' }, '·', h('small', {}, t('sa.m.newCol'))));
  const rows = ['A', 'B', 'C'].map((a) => h('tr', {},
    h('th', { scope: 'row' }, a, h('small', {}, fmtPct(shareOf(a), 0))),
    ...['X', 'Y', 'Z'].map((x) => cell(a + x)), cell(a + '-')));
  box.append(h('table', { class: 'sa-matrix', id: 'sa-matrix' }, h('caption', { class: 'sa-sr' }, t('sa.m.title')), h('thead', {}, head), h('tbody', {}, rows)));
  els.advice.textContent = '';
  const k = S.cell;
  if (k) {
    const code = k.endsWith('-') ? 'new' : k;
    els.advice.append(h('b', {}, k.endsWith('-') ? k[0] + ' · ' + t('sa.m.newCol') : k), ' — ', t('sa.adv.' + code), ' ',
      h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => { S.cell = ''; save(); paintMatrix(); paintTable(); } }, t('sa.m.clear')));
  } else els.advice.append(h('span', { class: 'ed-hint' }, t('sa.m.hint')));
}

// --- table --------------------------------------------------------------------------------------------------------

function tableRows() {
  const q = S.q.trim().toLowerCase();
  return R.A.rows.filter((r) => {
    // Items without XYZ use the cell code abc + '-', matching the matrix's fourth column.
    if (S.cell && (r.cell ?? r.abc + '-') !== S.cell) return false;
    if (q && !(`${r.id} ${r.name} ${r.cat}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

function paintTable() {
  const A = R.A;
  if (!A || !els.table) return;
  const rows = tableRows();
  const basis = A.settings.basis;
  const cols = [
    { k: 'rank', l: 'sa.c.rank', num: true, sort: (r) => r.rank, cell: (r) => r.rank },
    { k: 'id', l: 'sa.c.sku', sort: (r) => r.id, cell: (r) => h('span', { class: 'sa-mono' }, r.id), cls: 'sa-hide-s' },
    { k: 'name', l: 'sa.c.name', sort: (r) => r.name.toLowerCase(), cell: (r) => h('span', { class: 'sa-name' }, r.name, h('small', {}, r.cat)) },
    // Sort key '~' sorts classless items after Z within their ABC class.
    { k: 'cell', l: 'sa.c.class', sort: (r) => (r.cell ?? r.abc + '~'), cell: (r) => cellBadge(r.abc, r.xyz) },
    { k: 'value', l: 'sa.b.' + basis, num: true, sort: (r) => r.value, cell: (r) => valueText(r.value) },
    { k: 'share', l: 'sa.c.share', num: true, sort: (r) => r.share, cell: (r) => fmtPct(r.share, 2), cls: 'sa-hide-s' },
    { k: 'cum', l: 'sa.c.cum', num: true, sort: (r) => r.cumShare, cell: (r) => fmtPct(r.cumShare) },
    { k: 'qty', l: 'sa.c.qty', num: true, sort: (r) => r.qty, cell: (r) => fmtNum(r.qty, 1), cls: 'sa-hide-s' },
    { k: 'margin', l: 'sa.c.margin', num: true, sort: (r) => r.marginPct, cell: (r) => (r.marginPct == null ? '—' : fmtPct(r.marginPct / 100)), cls: 'sa-hide-s' },
    { k: 'cv', l: 'sa.c.cv', num: true, sort: (r) => r.cv, cell: (r) => (r.cv == null ? '—' : fmtNum(r.cv, 2)) },
    { k: 'trend', l: 'sa.c.trend', cell: (r) => h('span', { class: 'sa-trend sa-c-' + r.abc, html: sparkline(r.weekly), title: t('sa.c.trendHint', { n: r.weekly.length }) }), cls: 'sa-hide-s' },
  ];
  els.table.textContent = '';
  els.tinfo.textContent = rows.length === A.rows.length ? t('sa.t.all', { n: rows.length }) : t('sa.t.some', { n: rows.length, all: A.rows.length });
  if (!rows.length) { els.table.append(h('div', { class: 'ap-empty' }, t('sa.t.none'))); return; }
  els.table.append(sortTable(cols, rows, S.sort, (s) => { S.sort = s; save(); paintTable(); }, { limit: R.limit, caption: t('sa.t.title') }));
  if (rows.length > R.limit) {
    const more = button('=' + t('sa.t.more', { n: rows.length - R.limit }), 'down', () => { R.limit = Infinity; paintTable(); });
    more.classList.add('ed-sm', 'sa-more');
    els.table.append(more);
  }
}

// --- export -------------------------------------------------------------------------------------------------------

async function exportClasses(kind) {
  const A = R.A, D = getData();
  // Export with machine-friendly English headers and raw numbers (major units, shares as fractions): the file is for
  // further analysis in a spreadsheet, not a translated report.
  const head = ['rank', 'sku', 'name', 'category', 'abc', 'xyz', 'class', 'basis', 'value', 'share', 'cumulative share', 'qty', `revenue (${D.currency})`, `profit (${D.currency})`, 'margin %', 'cv', 'avg weekly qty', 'sd weekly qty', 'weeks', 'advice'];
  const rows = [head, ...tableRows().map((r) => [r.rank, r.id, r.name, r.cat, r.abc, r.xyz ?? '', r.cell ?? '', A.settings.basis,
    A.settings.basis === 'qty' ? r.value : major(r.value), +r.share.toFixed(6), +r.cumShare.toFixed(6), r.qty, major(r.revenue), r.profit == null ? '' : major(r.profit),
    r.marginPct ?? '', r.cv ?? '', r.avgWeekly, r.sdWeekly, r.weeks, t('sa.adv.' + (r.cell ?? 'new'))])];
  const name = `abc-xyz-${D.today}`;
  if (kind === 'csv') exportCSV(rows, name);
  else {
    const mrows = [['class', 'items', 'value', 'share', 'advice'], ...[...CELLS, 'A-', 'B-', 'C-'].map((k) => [k, A.matrix[k].count, A.settings.basis === 'qty' ? A.matrix[k].value : major(A.matrix[k].value), A.total ? +(A.matrix[k].value / A.total).toFixed(6) : 0, t('sa.adv.' + (k.endsWith('-') ? 'new' : k))])];
    await exportXLSX([{ name: 'ABC-XYZ', rows, widths: [6, 12, 30, 18, 5, 5, 6, 8, 12, 9, 9, 9, 12, 12, 9, 7, 9, 9, 6, 40] }, { name: 'Matrix', rows: mrows, widths: [8, 8, 14, 9, 50] }], name);
  }
}

startShell('analysis', () => render());
render();
