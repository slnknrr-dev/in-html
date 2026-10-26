// sheets-processor/main.js - the Sheets processor page: empty state (drop / pick / paste, blank sheet, sample data), the
// workbook view (toolbar, formula bar, virtualized grid, sheet tabs, status bar, statistics panel), cell editing with
// formulas, clipboard (TSV + HTML tables), keyboard shortcuts, file loading with progress and the glue between the model
// (model.js), the grid (grid.js) and the dialogs (dialogs.js).
// 
// Coordinates: the grid works in view rows (i); the model in physical rows (r). With a filter, view row i is
// sheet.view[i]; without one they are equal. phys() / viewIndex() convert; every grid callback converts at the boundary.
// Data flow: user action -> book mutation -> book.onChange(kind) -> grid render + bars. Nothing else repaints.
import './strings.js';
import { button, dropZone, startApp, t, toast } from '../ui/app.js';
import { $, h, lsGet, lsSet } from '../ui/dom.js';
import { pickFiles } from '../ui/files.js';
import { iconEl } from '../ui/icons.js';
import { openMenu, promptDialog, confirmDialog } from '../ui/overlays.js';
import { UI_STATE } from '../ui/i18n.js';
import { CellError, cellValue, colName, isRich, parseA1, parseRange } from '../xlsx/cells.js';
import { formatGeneral, formatValue, isDateFormat } from '../xlsx/numfmt.js';
import { inferValue } from '../csv/infer.js';
import { parseFormula, printFormula, translateFormula } from '../formula/parser.js';
import { numToText } from '../formula/values.js';
import { Book, DEFAULT_COL_PX, newSheet } from './model.js';
import { Grid } from './grid.js';
import { htmlTableRows, isoOf, localeHints, readFile, rowsToSheet, textToSheet } from './io.js';
import { senseType } from './ops.js';
import { ICONS, openChart, openDedupe, openExport, openFilter, openGroupBy, openMergeCols, openSort, openSplit, setupFind, statsPanel, columnMenuItems, rowMenuItems, cellMenuItems, formatMenuItems, fillMenu, sheetMenuItems } from './dialogs.js';

const LOGO = 'M4 4h16v16H4zM4 9.5h16M4 15h16M9.5 4v16M15 4v16';
const ACCEPT = '.csv,.tsv,.tab,.txt,.xlsx,.xlsm,.ods,.json,text/csv,text/tab-separated-values,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.oasis.opendocument.spreadsheet';

const book = new Book();
const app = { book, grid: null, hints: localeHints(), clip: null };
const S = () => book.sheet;
app.S = S;

// --- display -------------------------------------------------------------------------------

let dark = false;
const styleCache = new WeakMap();
// Month/day names for number formats (mmmm, ddd) from Intl in the UI language; 2021-08-01 is a Sunday, so day 0 = Sunday as Excel expects.
const monthNames = () => {
  const lang = UI_STATE.lang;
  try {
    const mk = (o) => Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(lang, { ...o, timeZone: 'UTC' }).format(new Date(Date.UTC(2021, i, 15))));
    const dk = (o) => Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(lang, { ...o, timeZone: 'UTC' }).format(new Date(Date.UTC(2021, 7, 1 + i))));
    return { months: mk({ month: 'long' }), monthsShort: mk({ month: 'short' }), days: dk({ weekday: 'long' }), daysShort: dk({ weekday: 'short' }) };
  } catch { return {}; }
};
let NAMES = {};

// WCAG relative luminance (sRGB linearisation): decides ink colour on fills.
function lum(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

// Inline CSS of a cell style; colours stay readable in the dark scheme (text on fills gets a contrasting ink).
// Cell style -> inline CSS, cached per style object and scheme (WeakMap: entries die with the style). Contrast guard:
// text on a fill gets the cell colour only when it differs enough in luminance, else dark or light ink; a near-black or
// near-white text colour without fill is dropped when it would vanish on the current scheme.
function styleCSS(st) {
  if (!st) return '';
  let e = styleCache.get(st);
  if (!e) { e = {}; styleCache.set(st, e); }
  const key = dark ? 'd' : 'l';
  if (e[key] != null) return e[key];
  let css = '';
  if (st.bold) css += 'font-weight:650;';
  if (st.italic) css += 'font-style:italic;';
  if (st.underline || st.strike) css += `text-decoration:${st.underline ? 'underline' : ''} ${st.strike ? 'line-through' : ''};`;
  const fl = lum(st.fill);
  if (fl !== null) {
    css += `background:${st.fill};`;
    const cl = lum(st.color);
    const ink = cl !== null && Math.abs(cl - fl) > 0.3 ? st.color : fl > 0.35 ? '#1d2330' : '#f3f5f8';
    css += `color:${ink};`;
  } else if (st.color) {
    const cl = lum(st.color);
    if (cl !== null && !((dark && cl < 0.08) || (!dark && cl > 0.8))) css += `color:${st.color};`;
  }
  if (st.align) css += `text-align:${st.align};justify-content:${st.align === 'left' ? 'flex-start' : st.align === 'right' ? 'flex-end' : 'center'};`;
  e[key] = css;
  return css;
}

// Display text of a cell (formatted with the cell's or the column's number format).
function textOf(sh, r, c) {
  const row = sh.rows[r];
  const cell = row ? row[c] : undefined;
  const v = cellValue(cell);
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') {
    const fmt = (isRich(cell) && cell.s && cell.s.fmt) || (sh.cols[c] && sh.cols[c].fmt);
    return fmt ? formatValue(v, fmt, NAMES) : formatGeneral(v);
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof CellError) return v.code;
  return String(v);
}
app.text = textOf;
book.viewText = textOf;

// Display text capped at 400 characters; newlines shown as ⏎ unless the cell wraps (rows have a fixed height).
function cellView(sh, r, c) {
  const row = sh.rows[r];
  const cell = row ? row[c] : undefined;
  if (cell == null) return { t: '', k: r === 0 && sh.header ? 'sp-hd' : '', css: '' };
  const v = cellValue(cell);
  const cls = [typeof v === 'number' ? 'sp-n' : typeof v === 'boolean' ? 'sp-b' : v instanceof CellError ? 'sp-e' : ''];
  if (r === 0 && sh.header) cls.push('sp-hd');
  if (isRich(cell)) {
    if (cell.sp) cls.push('sp-ghost');
    if (cell.link) cls.push('sp-link');
  }
  const k = cls.filter(Boolean).join(' ');
  let text = textOf(sh, r, c);
  if (text.length > 400) text = text.slice(0, 400);
  if (text.indexOf('\n') >= 0 && !(isRich(cell) && cell.s && cell.s.wrap)) text = text.replace(/\r?\n/g, ' ⏎ ');
  return { t: text, k, css: isRich(cell) && cell.s ? styleCSS(cell.s) : '' };
}

// --- view coordinates (filters show a subset of rows) ----------------------------------------

// Beyond the filtered rows, view rows continue after the last visible physical row (spare rows to type into).
const phys = (i) => { const v = S().view; return v ? (i < v.length ? v[i] : v[v.length - 1] + 1 + i - v.length) : i; };
function viewIndex(r) {
  const v = S().view;
  if (!v) return r;
  let lo = 0, hi = v.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (v[m] === r) return m; if (v[m] < r) lo = m + 1; else hi = m - 1; }
  return -1;
}
// Spare rows and columns beyond the data (+50 rows, +6 columns) so the user can type outside the used range.
const viewRows = () => { const sh = S(); return sh.view ? sh.view.length : Math.max(sh.rows.length + 50, 100); };
const viewCols = () => { const sh = S(); return Math.min(16384, Math.max(book.used().cols + 6, sh.cols.length + 1, 26)); };
app.phys = phys;
app.viewIndex = viewIndex;

// Selection in physical terms: { rows: [r...], c1, c2, r1, r2 (view), single }.
// Selection rows beyond the data are cut off (a full-column selection of the spare rows would mean thousands of empty rows).
function selection() {
  const s = app.grid.sel;
  const r1 = Math.min(s.r1, s.r2), r2 = Math.max(s.r1, s.r2), c1 = Math.min(s.c1, s.c2), c2 = Math.max(s.c1, s.c2);
  const sh = S();
  const lastData = Math.max(0, sh.rows.length - 1);
  const rows = [];
  for (let i = r1; i <= r2; i++) { const r = phys(i); if (sh.view || r <= lastData || i === r1) rows.push(r); else break; }
  return { r1, r2, c1, c2, rows, single: r1 === r2 && c1 === c2, ar: phys(s.ar), ac: s.ac };
}
app.selection = selection;

function frozenRows() {
  const sh = S();
  const fr = sh.freeze ? sh.freeze.rows : 0;
  if (!fr) return 0;
  if (!sh.view) return fr;
  let n = 0;
  while (n < sh.view.length && sh.view[n] < fr) n++;
  return n;
}

// Raw text shown in the editor and the formula bar.
// Text the editor shows: formulas with "=", dates as ISO, percentages as "12%"; text that would be re-read as a number
// or a formula gets a leading apostrophe, so editing and committing does not change its type.
function rawText(sh, r, c) {
  const cell = sh.rows[r] ? sh.rows[r][c] : undefined;
  if (isRich(cell) && cell.f != null && !cell.sp) return '=' + cell.f;
  const v = cellValue(cell);
  if (v == null) return '';
  if (typeof v === 'number') {
    const fmt = (isRich(cell) && cell.s && cell.s.fmt) || (sh.cols[c] && sh.cols[c].fmt);
    if (fmt && isDateFormat(fmt)) return isoOf(v, fmt);
    if (fmt && /%/.test(fmt.replace(/"[^"]*"/g, ''))) return numToText(Number((v * 100).toPrecision(15))) + '%';
    return numToText(v);
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof CellError) return v.code;
  const typed = inferValue(v, app.hints).v;
  return typeof typed === 'string' && v[0] !== '=' && v[0] !== "'" ? v : "'" + v;
}
app.raw = rawText;

// --- editing -------------------------------------------------------------------------------

// Typed text -> cell (formula, number, percent, date, boolean or text), keeping the cell's style and link.
// Typed text -> cell. Formulas are parsed and re-printed (normalised); an unparsable formula is kept as typed with a
// warning (the engine shows the error). A detected format (percent, date) is attached unless the cell or column already
// has a compatible one.
function cellFromText(sh, r, c, text) {
  const old = sh.rows[r] ? sh.rows[r][c] : undefined;
  const st = isRich(old) && !old.sp ? old.s : undefined;
  const link = isRich(old) && !old.sp ? old.link : undefined;
  const wrap = (v, s = st) => (s || link ? { v, ...(s ? { s } : {}), ...(link ? { link } : {}) } : v);
  if (text === '' || text == null) return st ? { v: null, s: st } : null;
  if (text[0] === '=' && text.length > 1) {
    let f = text.slice(1);
    try { f = printFormula(parseFormula(f)); } catch { toast(t('sp.badFormula'), 'warn'); }
    return { v: null, f, ...(st ? { s: st } : {}), ...(link ? { link } : {}) };
  }
  if (text[0] === "'") return wrap(text.slice(1));
  let inf = inferValue(text, { decimal: '.', dateOrder: app.hints.dateOrder });
  if (typeof inf.v === 'string' && /^\s*[-+]?\d[\d\s.]*,\d+\s*%?\s*$/.test(text)) inf = inferValue(text, { decimal: ',', dateOrder: app.hints.dateOrder });
  const colFmt = sh.cols[c] && sh.cols[c].fmt;
  if (inf.fmt && !(st && st.fmt) && !(colFmt && isDateFormat(colFmt) === isDateFormat(inf.fmt))) return wrap(inf.v, { ...(st || {}), fmt: inf.fmt });
  return wrap(inf.v);
}
app.cellFromText = cellFromText;

function commitText(r, c, text) {
  const sh = S();
  const before = rawText(sh, r, c);
  if (before === text) return;
  book.setCells(book.active, [[r, c, cellFromText(sh, r, c, text)]], t('sp.h.edit'));
}

function clearSelection() {
  const sel = selection();
  const sh = S();
  const changes = [];
  for (const r of sel.rows) {
    const row = sh.rows[r];
    if (!row) continue;
    for (let c = sel.c1; c <= Math.min(sel.c2, row.length - 1); c++) {
      const cell = row[c];
      if (cell == null || (isRich(cell) && cell.sp)) continue;
      changes.push([r, c, isRich(cell) && cell.s ? { v: null, s: cell.s } : null]);
    }
  }
  book.setCells(book.active, changes, t('sp.h.clear'));
}
app.clearSelection = clearSelection;

// Applies fn(style) -> style to the selected cells (bold, italic, number formats, fills).
// fn is memoised per distinct old style: 100 000 cells sharing one style produce one new style object (shared again).
function styleSelection(fn, label) {
  const sel = selection();
  const sh = S();
  const changes = [];
  const memo = new Map();
  for (const r of sel.rows) {
    for (let c = sel.c1; c <= sel.c2; c++) {
      const cell = sh.rows[r] ? sh.rows[r][c] : undefined;
      if (isRich(cell) && cell.sp) continue;
      const old = isRich(cell) ? cell.s : undefined;
      let s = memo.get(old);
      if (s === undefined) { s = fn(old ? { ...old } : {}); if (s && !Object.keys(s).length) s = null; memo.set(old, s); }
      const base = isRich(cell) ? { ...cell } : { v: cell ?? null };
      if (s) base.s = s; else delete base.s;
      changes.push([r, c, base.f == null && !base.s && !base.link ? base.v : base]);
    }
  }
  book.setCells(book.active, changes, label);
}
app.styleSelection = styleSelection;

// --- structural helpers for dialogs ----------------------------------------------------------

// After any structural edit every filtered sheet recomputes its visible rows (row positions may have changed).
app.structural = (label, fn) => {
  const r = book.commit(label, fn);
  if (r !== false) { for (const sh of book.sheets) if (sh.filter) book.applyFilter(sh, textOf); }
  return r;
};
app.columnTitle = (c, sh = S()) => {
  const v = sh.header && sh.rows[0] ? cellValue(sh.rows[0][c]) : null;
  return v != null && String(v).trim() ? String(v) : t('sp.column', { c: colName(c) });
};
// Type sensing on a sample of at most 300 evenly spaced rows: O(1) per header regardless of sheet size.
app.columnType = (c, sh = S()) => {
  const vals = [];
  const from = sh.header ? 1 : 0;
  const step = Math.max(1, Math.floor((sh.rows.length - from) / 300));
  for (let r = from; r < sh.rows.length && vals.length < 300; r += step) vals.push(cellValue(sh.rows[r] ? sh.rows[r][c] : null));
  const fmt = (sh.cols[c] && sh.cols[c].fmt) || (sh.rows[from + 1] && isRich(sh.rows[from + 1][c]) && sh.rows[from + 1][c].s && sh.rows[from + 1][c].s.fmt) || null;
  return senseType(vals, fmt);
};
app.dataRows = (sh = S()) => {
  const from = sh.header ? 1 : 0;
  if (sh.view) return sh.view.filter((r) => r >= from);
  const out = [];
  let last = sh.rows.length - 1;
  while (last >= from && !(sh.rows[last] && sh.rows[last].some((x) => x != null && x !== ''))) last--;
  for (let r = from; r <= last; r++) out.push(r);
  return out;
};
app.usedCols = () => Math.max(1, book.used().cols);

// --- grid adapter ----------------------------------------------------------------------------

const TYPE_GLYPH = { number: '#', date: 'D', text: 'T', bool: '✓', mixed: '∗' };
let typeCache = new Map();

// Adapter between grid.js (view coordinates, pixels) and the model (physical rows, cells).
const api = {
  rows: viewRows,
  cols: viewCols,
  cell: (i, c) => cellView(S(), phys(i), c),
  width: (c) => (S().cols[c] && S().cols[c].width) || DEFAULT_COL_PX,
  // During a drag only the live width changes; on release one history entry records the start and end width.
  setWidth: (c, px, done) => {
    const sh = S();
    const prev = (sh.cols[c] && sh.cols[c].width) || DEFAULT_COL_PX;
    if (!done) { app.resizeFrom ??= prev; sh.cols[c] = { ...(sh.cols[c] || {}), width: px }; return; }
    const from = app.resizeFrom ?? prev;
    app.resizeFrom = null;
    const set = (w) => { sh.cols[c] = { ...(sh.cols[c] || {}), width: w }; app.grid.invalidate(); };
    set(px);
    book.push({ label: t('sp.h.width'), undo: () => set(from), redo: () => set(px), kind: 'view' });
    book.emit('view');
  },
  // Auto-fit measures text with a canvas (no layout) on at most ~2000 sampled rows.
  fitWidth: (c) => {
    const sh = S();
    const ctx = (api.ctx ||= document.createElement('canvas').getContext('2d'));
    ctx.font = '13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    let w = ctx.measureText(colName(c)).width + 40;
    const rows = sh.view || sh.rows.map((_, r) => r);
    const step = Math.max(1, Math.floor(rows.length / 2000));
    for (let k = 0; k < rows.length; k += step) {
      const tx = textOf(sh, rows[k], c);
      if (tx) w = Math.max(w, ctx.measureText(tx.length > 200 ? tx.slice(0, 200) : tx).width + 20);
    }
    api.setWidth(c, Math.round(Math.max(40, Math.min(600, w))), true);
  },
  // Column types are cached per book version: one sensing pass per column per change, not per frame.
  head: (c) => {
    const sh = S();
    const key = book.version + ':' + book.active;
    if (typeCache.key !== key) { typeCache = new Map(); typeCache.key = key; }
    let ty = typeCache.get(c);
    if (ty === undefined) { ty = app.columnType(c); typeCache.set(c, ty); }
    const f = sh.filter && sh.filter.some((x) => x.c === c);
    const so = sh.sort && sh.sort.find((x) => x.c === c);
    const html = (TYPE_GLYPH[ty] ? `<span class="sp-ty sp-ty-${ty}" aria-hidden="true">${TYPE_GLYPH[ty]}</span>` : '') +
      (sh.header && sh.rows[0] && cellValue(sh.rows[0][c]) != null ? `<span class="sp-ch-n">${escHTML(String(cellValue(sh.rows[0][c])))}</span>` : '') +
      (f ? `<span class="sp-mark sp-mark-f" aria-hidden="true">${ICONS.funnel}</span>` : '') +
      (so ? `<span class="sp-mark" aria-hidden="true">${so.desc ? '↓' : '↑'}</span>` : '');
    return { html, title: app.columnTitle(c) + (ty !== 'empty' ? ' · ' + t('sp.type.' + ty) : ''), menuLabel: t('sp.colMenu') };
  },
  rowLabel: (i) => String(phys(i) + 1),
  frozen: () => ({ rows: frozenRows(), cols: (S().freeze && S().freeze.cols) || 0 }),
  raw: (i, c) => rawText(S(), phys(i), c),
  commit: (i, c, text) => commitText(phys(i), c, text),
  selected: () => { updateBar(); updateStatus(); app.panel && app.panel.update(); },
  editing: (text) => { const inp = $('#sp-fx'); if (inp && document.activeElement !== inp) inp.value = text ?? rawText(S(), phys(app.grid.sel.ar), app.grid.sel.ac); },
  menu: (kind, i, c, x, y) => {
    const items = kind === 'col' ? columnMenuItems(app, c) : kind === 'row' ? rowMenuItems(app) : cellMenuItems(app);
    openMenu({ x, y }, items);
  },
  colMenu: (c, anchor) => {
    const s = app.grid.sel;
    if (!(c >= Math.min(s.c1, s.c2) && c <= Math.max(s.c1, s.c2))) app.grid.select({ r1: s.ar, c1: c, r2: s.ar, c2: c, ar: s.ar, ac: c }, { scroll: false });
    openMenu(anchor, columnMenuItems(app, c));
  },
  key: (e) => shortcut(e),
  edge: (i, c, di, dc) => edge(i, c, di, dc),
  lastCell: () => { const u = book.used(); return [Math.max(0, (S().view ? S().view.length : u.rows) - 1), Math.max(0, u.cols - 1)]; },
  refText: (i1, c1, i2, c2) => {
    const a = colName(Math.min(c1, c2)) + (phys(Math.min(i1, i2)) + 1);
    const b = colName(Math.max(c1, c2)) + (phys(Math.max(i1, i2)) + 1);
    return a === b ? a : a + ':' + b;
  },
  label: (i, c) => `${colName(c)}${phys(i) + 1}: ${textOf(S(), phys(i), c) || t('sp.emptyCell')}`,
  editable: () => true,
};

const escHTML = (s) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// Ctrl+arrow: to the edge of the current block of filled cells, or to the next filled cell.
// Ctrl+arrow semantics of Excel: inside a block jump to its last filled cell; from a blank, jump to the next filled cell or the sheet edge.
function edge(i, c, di, dc) {
  const n = viewRows(), m = viewCols();
  const filled = (a, b) => { const v = cellValue(S().rows[phys(a)] ? S().rows[phys(a)][b] : null); return v != null && v !== ''; };
  let a = i, b = c;
  const step = () => { a += di; b += dc; return a >= 0 && b >= 0 && a < n && b < m; };
  const here = filled(a, b);
  if (!step()) return [i, c];
  if (here && filled(a, b)) {
    while (filled(a, b)) { if (!step()) return [a - di, b - dc].map((x, k) => Math.max(0, Math.min(k ? m - 1 : n - 1, x))); }
    return [a - di, b - dc];
  }
  while (!filled(a, b)) {
    if (!step()) return [Math.max(0, Math.min(n - 1, a - di)), Math.max(0, Math.min(m - 1, b - dc))];
    if (Math.abs(a - i) > 200000) break;
  }
  return [a, b];
}

// --- shell -----------------------------------------------------------------------------------

let els = {};

function updateBar() {
  if (!app.grid || !els.name) return;
  const s = app.grid.sel;
  const r1 = Math.min(s.r1, s.r2), r2 = Math.max(s.r1, s.r2), c1 = Math.min(s.c1, s.c2), c2 = Math.max(s.c1, s.c2);
  els.name.value = r1 === r2 && c1 === c2 ? colName(s.ac) + (phys(s.ar) + 1) : `${colName(c1)}${phys(r1) + 1}:${colName(c2)}${phys(r2) + 1}`;
  if (!app.grid.editing && document.activeElement !== els.fx) els.fx.value = rawText(S(), phys(s.ar), s.ac);
}

let statusTimer = 0;
// Selection sum/avg/min/max debounced (60 ms) and capped at 3M cells so a full-sheet selection stays responsive.
function updateStatus() {
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    if (!app.grid) return;
    const sel = selection();
    const sh = S();
    const parts = [];
    if (!sel.single) {
      let cells = 0, nums = 0, sum = 0, min = Infinity, max = -Infinity, filled = 0;
      for (const r of sel.rows) {
        const row = sh.rows[r];
        for (let c = sel.c1; c <= sel.c2; c++) {
          cells++;
          const v = row ? cellValue(row[c]) : null;
          if (v == null || v === '') continue;
          filled++;
          if (typeof v === 'number') { nums++; sum += v; if (v < min) min = v; if (v > max) max = v; }
        }
        if (cells > 3e6) break;
      }
      parts.push(t('sp.st.count', { n: filled }));
      if (nums) parts.push(t('sp.st.sum', { v: formatGeneral(sum) }), t('sp.st.avg', { v: formatGeneral(sum / nums) }), t('sp.st.min', { v: formatGeneral(min) }), t('sp.st.max', { v: formatGeneral(max) }));
    }
    if (sh.view) parts.unshift(t('sp.st.filtered', { n: Math.max(0, sh.view.length - (sh.header ? 1 : 0)), total: Math.max(0, book.used().rows - (sh.header ? 1 : 0)) }));
    els.status.textContent = parts.join(' · ');
  }, 60);
}

function renderTabs() {
  const box = els.tabs;
  box.textContent = '';
  book.sheets.forEach((sh, i) => {
    const b = h('button', {
      type: 'button', role: 'tab', class: 'sp-tab' + (i === book.active ? ' sp-on' : '') + (sh.hidden ? ' sp-hid' : ''), 'aria-selected': String(i === book.active),
      title: sh.name, onclick: () => switchSheet(i),
      ondblclick: () => renameSheet(i),
      oncontextmenu: (e) => { e.preventDefault(); openMenu({ x: e.clientX, y: e.clientY }, sheetMenuItems(app, i)); },
    }, sh.hidden ? iconEl('eyeOff') : null, h('span', {}, sh.name));
    box.append(b);
  });
  box.append(h('button', { type: 'button', class: 'ed-iconbtn sp-tab-add', title: t('sp.addSheet'), 'aria-label': t('sp.addSheet'), onclick: addSheet }, iconEl('plus')));
  const on = box.querySelector('.sp-on');
  if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function switchSheet(i) {
  if (app.grid && app.grid.editing) app.grid.finishEdit(true);
  book.active = i;
  afterSheetChange();
}
app.switchSheet = switchSheet;

function afterSheetChange() {
  renderTabs();
  if (!app.grid) return;
  const s = app.sheetSel?.get(S()) || { r1: 0, c1: 0, r2: 0, c2: 0, ar: 0, ac: 0 };
  app.grid.invalidate();
  app.grid.scroller.scrollTop = 0;
  app.grid.scroller.scrollLeft = 0;
  app.grid.select(s);
  updateTools();
}

async function renameSheet(i) {
  const name = await promptDialog(t('sp.renameSheet'), t('sp.sheetName'), book.sheets[i].name);
  if (!name) return;
  app.structural(t('sp.h.renameSheet'), () => { book.renameSheet(i, name); });
}
app.renameSheet = renameSheet;

function addSheet() {
  app.structural(t('sp.h.addSheet'), () => {
    book.sheets.push(newSheet(book.uniqueName(t('sp.sheetN', { n: book.sheets.length + 1 }))));
    book.active = book.sheets.length - 1;
  });
}
app.addSheet = addSheet;

function updateTools() {
  if (!els.undo) return;
  els.undo.disabled = !book.undoStack.length;
  els.redo.disabled = !book.redoStack.length;
  els.undo.title = book.undoStack.length ? t('sp.undoX', { x: book.undoStack[book.undoStack.length - 1].label }) : t('sp.undo');
  els.redo.title = book.redoStack.length ? t('sp.redoX', { x: book.redoStack[book.redoStack.length - 1].label }) : t('sp.redo');
  els.clearFilter.hidden = !S().filter;
  els.header.classList.toggle('ed-on', !!S().header);
  els.header.setAttribute('aria-pressed', String(!!S().header));
  els.panelBtn.classList.toggle('ed-on', !!app.panelOpen);
  els.panelBtn.setAttribute('aria-pressed', String(!!app.panelOpen));
}

// Single repaint entry point for every model change.
book.onChange = (kind) => {
  if (!app.grid) return;
  if (kind === 'structure') { renderTabs(); app.grid.invalidate(); }
  app.grid.render();
  updateBar();
  updateStatus();
  updateTools();
  if (app.panel) app.panel.update();
};

function tool(icon, label, onclick, extra = {}) {
  return h('button', { type: 'button', class: 'ed-btn ed-sm sp-tool', title: t(label), 'aria-label': t(label), onclick, ...extra }, iconEl(icon), h('span', { class: 'sp-tl' }, t(label + '.s')));
}
const textTool = (glyph, label, onclick, cls) => h('button', { type: 'button', class: 'ed-btn ed-sm sp-tool sp-glyph ' + cls, title: t(label), 'aria-label': t(label), onclick }, glyph);

function buildToolbar() {
  const bar = h('div', { class: 'sp-toolbar', role: 'toolbar', 'aria-label': t('sp.toolbar') });
  els.undo = tool('undo', 'sp.undo', () => doUndo());
  els.redo = tool('redo', 'sp.redo', () => doRedo());
  els.clearFilter = tool('filterOff', 'sp.clearFilters', () => app.structural(t('sp.h.filter'), () => { for (const sh of [S()]) { sh.filter = null; sh.view = null; } }));
  els.header = tool('headerRow', 'sp.headerRow', () => toggleHeader());
  els.panelBtn = tool('sigma', 'sp.stats', () => togglePanel());
  bar.append(
    h('div', { class: 'sp-group' }, tool('folder', 'sp.open', () => openFiles()), tool('download', 'sp.export', () => openExport(app)), tool('filePlus', 'sp.new', () => newWorkbook())),
    h('div', { class: 'sp-group' }, els.undo, els.redo),
    h('div', { class: 'sp-group' },
      textTool('B', 'sp.bold', () => toggleStyle('bold'), 'sp-b'),
      textTool('I', 'sp.italic', () => toggleStyle('italic'), 'sp-i'),
      tool('hash', 'sp.format', (e) => openMenu(e.currentTarget, formatMenuItems(app))),
      tool('palette', 'sp.fill', (e) => fillMenu(app, e.currentTarget))),
    h('div', { class: 'sp-group' },
      tool('sort', 'sp.sort', () => openSort(app)),
      tool('filter', 'sp.filter', () => openFilter(app, app.grid.sel.ac)),
      els.clearFilter,
      tool('search', 'sp.find', () => app.find.open(false))),
    h('div', { class: 'sp-group' },
      tool('dedupe', 'sp.dedupe', () => openDedupe(app)),
      tool('split', 'sp.split', () => openSplit(app, app.grid.sel.ac)),
      tool('merge', 'sp.mergeCols', () => openMergeCols(app)),
      tool('transpose', 'sp.transpose', () => transposeSel()),
      tool('group', 'sp.groupBy', () => openGroupBy(app))),
    h('div', { class: 'sp-group' }, els.header, tool('chart', 'sp.chart', () => openChart(app)), els.panelBtn),
  );
  return bar;
}

function buildFormulaBar() {
  els.name = h('input', { class: 'ed-input sp-name', id: 'sp-name', 'aria-label': t('sp.nameBox'), title: t('sp.nameBox'), spellcheck: 'false', autocomplete: 'off' });
  els.fx = h('input', { class: 'ed-input sp-fx', id: 'sp-fx', 'aria-label': t('sp.formulaBar'), placeholder: t('sp.formulaPh'), spellcheck: 'false', autocomplete: 'off' });
  els.name.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    goTo(els.name.value);
  });
  els.fx.addEventListener('keydown', (e) => {
    const g = app.grid;
    if (e.key === 'Enter') {
      e.preventDefault();
      const { ar, ac } = g.sel;
      const text = els.fx.value;
      if (g.editing) { g.keepEditing = false; g.finishEdit(false); }
      commitText(phys(ar), ac, text);
      g.focus();
      g.moveTo(Math.min(viewRows() - 1, ar + (e.shiftKey ? -1 : 1)), ac);
    } else if (e.key === 'Escape') { e.preventDefault(); if (g.editing) { g.keepEditing = false; g.finishEdit(false); } updateBar(); g.focus(); }
  });
  els.fx.addEventListener('input', () => { if (app.grid.editing) app.grid.setEditorText(els.fx.value); });
  els.fx.addEventListener('focus', () => { if (app.grid.editing) { app.grid.keepEditing = true; } });
  els.fx.addEventListener('blur', () => { if (app.grid.editing) { app.grid.keepEditing = false; app.grid.finishEdit(true); } });
  return h('div', { class: 'sp-fbar' }, els.name, h('span', { class: 'sp-fxl', 'aria-hidden': 'true' }, 'fx'), els.fx);
}

// Name box: an A1 reference or range, or a sheet name.
function goTo(text) {
  const s = String(text).trim().toUpperCase();
  const g = parseRange(s) || (parseA1(s) && parseRange(s));
  const sh = S();
  if (!g) {
    const k = book.sheets.findIndex((x) => x.name.toLowerCase() === s.toLowerCase());
    if (k >= 0) { switchSheet(k); return; }
    toast(t('sp.badRef'), 'warn');
    return;
  }
  let i1 = viewIndex(g.r1), i2 = viewIndex(g.r2);
  if (i1 < 0 || i2 < 0) { if (sh.view) { toast(t('sp.hiddenByFilter'), 'warn'); return; } }
  app.grid.select({ r1: i1, c1: g.c1, r2: i2, c2: g.c2, ar: i1, ac: g.c1 });
  app.grid.focus();
}

// --- actions ---------------------------------------------------------------------------------

function doUndo() { const l = book.undo(); if (l) toast(t('sp.undone', { x: l }), 'info'); }
function doRedo() { const l = book.redo(); if (l) toast(t('sp.redone', { x: l }), 'info'); }

function toggleStyle(k) {
  const s = app.grid.sel;
  const cell = S().rows[phys(s.ar)] ? S().rows[phys(s.ar)][s.ac] : null;
  const on = !(isRich(cell) && cell.s && cell.s[k]);
  styleSelection((st) => { if (on) st[k] = true; else delete st[k]; return st; }, t(k === 'bold' ? 'sp.bold' : 'sp.italic'));
}
app.toggleStyle = toggleStyle;

function toggleHeader() {
  app.structural(t('sp.h.header'), () => {
    const sh = S();
    sh.header = !sh.header;
    if (sh.header && !sh.freeze) sh.freeze = { rows: 1, cols: 0 };
    if (!sh.header && sh.freeze && sh.freeze.rows === 1 && !sh.freeze.cols) sh.freeze = null;
    sh.filter = null;
    sh.view = null;
  });
}

function togglePanel() {
  app.panelOpen = !app.panelOpen;
  lsSet('sp-panel', app.panelOpen);
  els.panel.hidden = !app.panelOpen;
  els.book.classList.toggle('sp-with-panel', app.panelOpen);
  if (app.panelOpen) app.panel.update(true);
  updateTools();
  app.grid.render();
}
app.togglePanel = togglePanel;

// Transpose writes values (not formulas) to a new sheet: transposed relative references would point to wrong cells.
function transposeSel() {
  const sel = selection();
  const sh = S();
  const u = book.used();
  const whole = sel.single;
  const rows = whole ? Array.from({ length: u.rows }, (_, r) => r) : sel.rows;
  const c1 = whole ? 0 : sel.c1, c2 = whole ? Math.max(0, u.cols - 1) : sel.c2;
  if (!rows.length) return;
  const out = [];
  for (let c = c1; c <= c2; c++) {
    out.push(rows.map((r) => {
      const cell = sh.rows[r] ? sh.rows[r][c] : null;
      return isRich(cell) ? (cell.s ? { v: cell.v ?? null, s: cell.s } : cell.v ?? null) : cell ?? null;
    }));
  }
  app.structural(t('sp.transpose'), () => {
    const ns = newSheet(book.uniqueName(sh.name + ' (T)'), out, { header: false });
    book.sheets.splice(book.active + 1, 0, ns);
    book.active += 1;
  });
  toast(t('sp.transposed', { name: S().name }), 'ok');
}

async function newWorkbook() {
  if (book.dirty && !(await confirmDialog(t('sp.new'), t('sp.confirmNew'), t('sp.new'), true))) return;
  book.addSheets([{ name: t('sp.sheetN', { n: 1 }), rows: [] }], { replace: true });
  showBook();
}

// --- clipboard -------------------------------------------------------------------------------

const gridFocused = () => app.grid && !app.grid.editing && document.activeElement === app.grid.scroller;

function selectionMatrix(mode) {
  const sel = selection();
  const sh = S();
  return sel.rows.map((r) => {
    const out = [];
    for (let c = sel.c1; c <= sel.c2; c++) out.push(mode === 'raw' ? (sh.rows[r] ? sh.rows[r][c] : null) : textOf(sh, r, c));
    return out;
  });
}

// Copy puts TSV (Excel-compatible quoting) and an HTML table on the clipboard; app.clip remembers the raw cells, so a
// paste of the same TSV inside the app restores formulas (translated) and styles instead of plain text.
function onCopy(e, cut) {
  if (!gridFocused()) return;
  const texts = selectionMatrix('text');
  const tsv = texts.map((r) => r.map((v) => (/[\t\n"]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v)).join('\t')).join('\r\n');
  const html = '<table>' + texts.map((r) => '<tr>' + r.map((v) => `<td>${escHTML(v).replace(/\n/g, '<br>')}</td>`).join('') + '</tr>').join('') + '</table>';
  e.clipboardData.setData('text/plain', tsv);
  e.clipboardData.setData('text/html', html);
  e.preventDefault();
  const sel = selection();
  app.clip = { tsv, cells: selectionMatrix('raw'), r: sel.rows[0], c: sel.c1 };
  if (cut) clearSelection();
  toast(t(cut ? 'sp.cutDone' : 'sp.copied', { n: texts.length * (texts[0] ? texts[0].length : 0) }), 'ok');
}

// Internal paste translates relative references by the offset between source and target, like Excel.
function pasteMatrix(cells, from) {
  const sh = S();
  const { ar, ac } = app.grid.sel;
  const r0 = phys(ar);
  const changes = [];
  cells.forEach((row, i) => {
    const r = sh.view ? phys(ar + i) : r0 + i;
    row.forEach((cell, j) => {
      const c = ac + j;
      if (from && isRich(cell) && cell.f != null && !cell.sp) changes.push([r, c, { ...cell, f: translateFormula(cell.f, r - (from.r + i), c - (from.c + j)), v: null }]);
      else if (from) changes.push([r, c, isRich(cell) && cell.sp ? cell.v : cell ?? null]);
      else changes.push([r, c, cellFromText(sh, r, c, cell == null ? '' : String(cell))]);
    });
  });
  book.setCells(book.active, changes, t('sp.h.paste'));
  const h2 = cells.length, w2 = cells[0] ? cells[0].length : 1;
  app.grid.select({ r1: ar, c1: ac, r2: ar + h2 - 1, c2: ac + w2 - 1, ar, ac }, { scroll: false });
}

// Paste on the empty screen imports the clipboard as a new workbook; on the grid it pastes into the cells. HTML tables are preferred over text (keep cell boundaries).
async function onPaste(e) {
  const files = [...(e.clipboardData?.files || [])];
  if (!app.grid || !book.sheets.length) {
    if (e.target.closest && e.target.closest('input, textarea, [contenteditable]')) return;
    if (files.length) return; // the drop zone takes pasted files
    const text = e.clipboardData.getData('text/plain');
    const html = e.clipboardData.getData('text/html');
    if (!text && !html) return;
    e.preventDefault();
    await loadText(text, html);
    return;
  }
  if (!gridFocused()) return;
  e.preventDefault();
  if (files.length) { loadFiles(files); return; }
  const text = e.clipboardData.getData('text/plain');
  const html = e.clipboardData.getData('text/html');
  if (app.clip && text === app.clip.tsv) { pasteMatrix(app.clip.cells, app.clip); return; }
  let rows = html ? htmlTableRows(html) : null;
  if (!rows) {
    if (!text) return;
    const { sheet } = await textToSheet(text, 'paste', { delimiter: text.includes('\t') ? '\t' : undefined, header: false, types: false });
    rows = sheet.rows.map((r) => r.map((v) => (v == null ? '' : String(v))));
  }
  if (rows.length * (rows[0] ? rows[0].length : 0) > 2e6) { toast(t('sp.tooBig'), 'warn'); return; }
  pasteMatrix(rows, null);
}

async function loadText(text, html) {
  let rows = html ? htmlTableRows(html) : null;
  let sheet;
  if (rows) sheet = await rowsToSheet(rows, t('sp.pasted'));
  else ({ sheet } = await textToSheet(text, t('sp.pasted'), { delimiter: text.includes('\t') ? '\t' : undefined }));
  book.addSheets([sheet], { replace: !book.sheets.length, label: t('sp.h.import') });
  showBook();
  toast(t('sp.pastedRows', { n: sheet.rows.length }), 'ok');
}

// --- keyboard --------------------------------------------------------------------------------

// App shortcuts shared by the grid (api.key) and the document handler below.
function shortcut(e) {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && !e.altKey) {
    if (k === 'z' && !e.shiftKey) { doUndo(); return true; }
    if (k === 'y' || (k === 'z' && e.shiftKey)) { doRedo(); return true; }
    if (k === 'f') { app.find.open(false); return true; }
    if (k === 'h') { app.find.open(true); return true; }
    if (k === 'b') { toggleStyle('bold'); return true; }
    if (k === 'i') { toggleStyle('italic'); return true; }
    if (k === 'o') { openFiles(); return true; }
    if (k === 's') { openExport(app); return true; }
  }
  if (!mod && (e.key === 'Delete' || e.key === 'Backspace') && app.grid && !app.grid.editing) { clearSelection(); return true; }
  if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
    const g = app.grid;
    const x = g.colX(g.sel.ac) + 20, y = g.rowY(g.sel.ar) + 20;
    const r = g.layer.getBoundingClientRect();
    openMenu({ x: r.left + x, y: r.top + y }, cellMenuItems(app));
    return true;
  }
  return false;
}

// Document-level shortcuts only when focus is not in an input, a dialog or the grid (which handles its own keys).
document.addEventListener('keydown', (e) => {
  if (!app.grid || els.book.hidden) return;
  const tg = e.target;
  if (tg.closest && tg.closest('input, textarea, select, [contenteditable], .ed-dialog, .ed-popover')) return;
  if (tg === app.grid.scroller) return; // the grid handles its own keys
  if ((e.ctrlKey || e.metaKey) && ['z', 'y', 'f', 'h', 'o', 's'].includes(e.key.toLowerCase())) { if (shortcut(e)) e.preventDefault(); }
});
document.addEventListener('copy', (e) => onCopy(e, false));
document.addEventListener('cut', (e) => onCopy(e, true));
document.addEventListener('paste', (e) => { onPaste(e).catch((err) => toast(t('err.generic', { msg: err.message }), 'error')); });
// Warns before closing with unsaved edits; export resets dirty.
window.addEventListener('beforeunload', (e) => { if (book.dirty && book.sheets.some((s) => s.rows.length)) { e.preventDefault(); e.returnValue = ''; } });

// --- files -----------------------------------------------------------------------------------

function busy(on, label = '') {
  let el = $('#sp-busy');
  if (!on) { if (el) el.remove(); return () => {}; }
  if (!el) {
    el = h('div', { id: 'sp-busy', class: 'sp-busy', role: 'status', 'aria-live': 'polite' },
      h('div', { class: 'sp-busy-box' }, h('div', { class: 'ed-spinner' }), h('div', { class: 'sp-busy-t' }), h('div', { class: 'ap-progress' }, h('i'))));
    document.body.append(el);
  }
  el.querySelector('.sp-busy-t').textContent = label;
  return (p) => { el.querySelector('.ap-progress > i').style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%'; };
}

// Files are read one by one (memory); a failed file is reported and skipped. An untouched blank workbook is replaced instead of appended to.
async function loadFiles(files) {
  if (!files.length) return;
  const all = [];
  const names = [];
  let info = null;
  for (const f of files) {
    const progress = busy(true, t('sp.reading', { name: f.name }));
    try {
      await new Promise((r) => setTimeout(r, 30));
      const res = await readFile(f, { onProgress: progress });
      progress(1);
      all.push(...res.sheets);
      names.push(...res.names);
      info = res.info;
    } catch (e) {
      busy(false);
      const msg = e && e.message === 'unsupported' ? t('sp.unsupported') : (e && e.message) || String(e);
      toast(t('ap.fileErr', { name: f.name, msg }), 'error');
      continue;
    }
  }
  busy(false);
  if (!all.length) return;
  const replace = !book.sheets.length || (!book.dirty && book.sheets.every((s) => !s.rows.length));
  const t0 = performance.now();
  book.addSheets(all, { names, replace, label: t('sp.h.import') });
  showBook();
  const rows = all.reduce((n, s) => n + s.rows.length, 0);
  const msg = info && info.kind === 'csv' && files.length === 1
    ? t('sp.loadedCsv', { n: rows - (all[0].header ? 1 : 0), d: info.delimiter === '\t' ? 'Tab' : info.delimiter, enc: info.encoding })
    : t('sp.loaded', { n: rows, s: all.length });
  toast(msg, 'ok');
  if (book.engine.size) toast(t('sp.recalc', { n: book.engine.size, ms: Math.round(performance.now() - t0) }), 'info');
}
app.loadFiles = loadFiles;

async function openFiles() { loadFiles(await pickFiles({ accept: ACCEPT, multiple: true })); }

// Deterministic sample: a Lehmer (Park–Miller) generator with a fixed seed gives the same data on every run (stable e2e checks).
function sampleBook() {
  const regions = ['North', 'South', 'East', 'West'];
  const products = ['Apples', 'Pears', 'Plums', 'Cherries', 'Grapes'];
  const rows = [['Date', 'Region', 'Product', 'Units', 'Price', 'Revenue']];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 120; i++) {
    const r = i + 2;
    rows.push([45292 + Math.floor(i * 2.9), regions[Math.floor(rnd() * 4)], products[Math.floor(rnd() * 5)], 5 + Math.floor(rnd() * 60), Math.round((1 + rnd() * 4) * 100) / 100, { v: null, f: `D${r}*E${r}` }]);
  }
  const sheet = { name: t('sp.sample'), rows, header: true, freeze: { rows: 1, cols: 0 }, cols: [{ fmt: 'yyyy-mm-dd', width: 15 }, {}, {}, {}, { fmt: '#,##0.00' }, { fmt: '#,##0.00' }] };
  const summary = { name: t('sp.summary'), header: true, freeze: { rows: 1, cols: 0 }, cols: [{ width: 14 }, { width: 14 }, { width: 14 }], rows: [['Region', 'Revenue', 'Share'], ...regions.map((g, i) => [g, { v: null, f: `SUMIF('${t('sp.sample')}'!B:B,A${i + 2},'${t('sp.sample')}'!F:F)` }, { v: null, f: `B${i + 2}/SUM($B$2:$B$5)`, s: { fmt: '0.0%' } }]), ['Total', { v: null, f: 'SUM(B2:B5)', s: { bold: true } }, null]] };
  book.addSheets([sheet, summary], { replace: true });
  book.dirty = false;
  showBook();
}

// --- layout --------------------------------------------------------------------------------

// api.selected is wrapped to remember the selection per sheet (WeakMap keyed by sheet object).
// KNOWN DEFECT: after a language switch render() destroys the grid and the next showBook wraps api.selected again, so
// wrappers stack up (harmless duplicate WeakMap writes). Fix: wrap once at module level.
function showBook() {
  els.empty.hidden = true;
  els.book.hidden = false;
  document.body.classList.add('sp-full');
  if (!app.grid) {
    app.grid = new Grid(els.gridHost, api, { label: t('sp.gridLabel') });
    app.sheetSel = new WeakMap();
    const sel0 = api.selected;
    api.selected = (sel) => { app.sheetSel.set(S(), { ...sel }); sel0(sel); };
  }
  afterSheetChange();
  app.grid.focus();
}

function buildEmpty() {
  const zone = dropZone({ onFiles: loadFiles, accept: ACCEPT, multiple: true, label: 'sp.drop' });
  return h('section', { class: 'sp-empty', id: 'sp-empty' },
    h('div', { class: 'sp-hero' },
      h('h2', { class: 'sp-h' }, t('sp.hero')),
      h('p', { class: 'ap-lead' }, t('sp.lead')),
      zone,
      h('div', { class: 'sp-start' },
        button('sp.blank', 'filePlus', () => { book.addSheets([{ name: t('sp.sheetN', { n: 1 }), rows: [] }], { replace: true }); book.dirty = false; showBook(); }),
        button('sp.trySample', 'table', () => sampleBook())),
      h('p', { class: 'ed-hint sp-formats' }, t('sp.formats')),
      h('ul', { class: 'sp-feats' }, ['sp.f1', 'sp.f2', 'sp.f3', 'sp.f4'].map((k) => h('li', {}, iconEl('check'), t(k))))));
}

// Full rebuild on start and on language change; the workbook (book) survives, the grid is recreated.
function render() {
  NAMES = monthNames();
  const main = $('#sp-main');
  const keepBook = book.sheets.length > 0;
  main.textContent = '';
  els = { empty: buildEmpty() };
  els.tabs = h('div', { class: 'sp-tabs', role: 'tablist', 'aria-label': t('sp.sheets') });
  els.status = h('div', { class: 'sp-status', 'aria-live': 'polite' });
  els.gridHost = h('div', { class: 'sp-gridhost' });
  els.panel = h('aside', { class: 'sp-panel', 'aria-label': t('sp.stats'), hidden: true });
  els.findHost = h('div', { class: 'sp-findhost' });
  els.book = h('section', { class: 'sp-book', id: 'sp-book', hidden: true },
    buildToolbar(), els.findHost, buildFormulaBar(),
    h('div', { class: 'sp-body' }, els.gridHost, els.panel),
    h('div', { class: 'sp-foot' }, els.tabs, els.status));
  main.append(els.empty, els.book);
  app.find = setupFind(app, els.findHost);
  app.panel = statsPanel(app, els.panel, () => togglePanel());
  if (app.grid) { app.grid.destroy(); app.grid = null; }
  app.panelOpen = lsGet('sp-panel', false) && window.innerWidth > 900;
  els.panel.hidden = !app.panelOpen;
  els.book.classList.toggle('sp-with-panel', !!app.panelOpen);
  // the whole workbook view accepts dropped files
  els.book.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); els.book.classList.add('sp-drop'); } });
  els.book.addEventListener('dragleave', (e) => { if (e.target === els.book || !els.book.contains(e.relatedTarget)) els.book.classList.remove('sp-drop'); });
  els.book.addEventListener('drop', (e) => { e.preventDefault(); els.book.classList.remove('sp-drop'); loadFiles([...(e.dataTransfer.files || [])]); });
  if (keepBook) showBook();
}

// Inline cell styles depend on the scheme (contrast guard), so a scheme change invalidates the grid. Watches both the OS preference and the data-theme attribute.
function watchTheme() {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const update = () => {
    const th = document.documentElement.getAttribute('data-theme');
    const d = th === 'dark' || (th !== 'light' && mq.matches);
    if (d !== dark) { dark = d; if (app.grid) app.grid.invalidate(); }
  };
  mq.addEventListener('change', update);
  new MutationObserver(update).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  update();
}

startApp({ key: 'sheets', name: 'app.name', logo: LOGO, offline: true, onLang: () => render() });
watchTheme();
render();

// Debug / test hook: the workbook and a few actions (used by the e2e scenario).
window.sheetsApp = { book, app, loadFiles, sampleBook, selection, textOf: (r, c) => textOf(S(), r, c) };
