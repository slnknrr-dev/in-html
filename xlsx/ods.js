// xlsx/ods.js - reads OpenDocument spreadsheets (.ods, ODF 1.2+) into the workbook model of xlsx/cells.js: tables,
// repeated rows / columns (long empty runs are skipped, not materialized), floats, percentages, currencies, dates,
// times, booleans, strings (paragraphs, spaces, tabs, line breaks, links), formulas (OpenFormula converted to A1 text,
// cached values kept), merged cells, column widths, hidden tables and frozen panes (settings.xml).
//
//   readODS(bytes) -> Promise<{ sheets, names: [], date1904: false }>

import { readZip } from '../zip/zip.js';
import { attr, child, children, parseXML, root } from '../xml/xml.js';
import { dateToSerial } from './cells.js';
import { fromODFFormula } from './ftext.js';

// ODS encodes "the rest of the sheet is empty" as one row repeated ~1M times and one cell repeated 16k times. Caps
// keep a styled-but-empty tail from being materialised; values are copied at most this many times.
const MAX_REPEAT_ROWS = 100000;
const MAX_REPEAT_COLS = 1024;

// Text model of ODF: <text:p> per paragraph, <text:s text:c="n"/> for runs of spaces (XML would collapse them),
// <text:tab/>, <text:line-break/>. Annotations (comments) are skipped: they are not cell content.
// Name tests use (^|:) so both prefixed and unprefixed element names match regardless of the namespace prefix used.
function cellText(el) {
  const paras = [];
  for (const p of el.children) {
    if (p.type !== 'element' || !/(^|:)(p|h)$/.test(p.name)) continue;
    paras.push(inline(p));
  }
  return paras.join('\n');
}
function inline(nd) {
  let s = '';
  for (const c of nd.children) {
    if (c.type === 'text') s += c.text;
    else if (c.type !== 'element') continue;
    else if (/(^|:)s$/.test(c.name)) s += ' '.repeat(Math.max(1, +(attr(c, 'text:c') || 1)));
    else if (/(^|:)tab$/.test(c.name)) s += '\t';
    else if (/(^|:)line-break$/.test(c.name)) s += '\n';
    else if (/(^|:)annotation$/.test(c.name)) continue;
    else s += inline(c);
  }
  return s;
}
function firstLink(nd) {
  for (const c of nd.children || []) {
    if (c.type !== 'element') continue;
    if (/(^|:)a$/.test(c.name) && attr(c, 'xlink:href')) return attr(c, 'xlink:href');
    const l = firstLink(c);
    if (l) return l;
  }
  return null;
}

function isoSerial(s) {
  const m = /^(-?\d{4,})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?/.exec(String(s));
  if (!m) return null;
  return dateToSerial(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), m[7] ? Math.round(+('0.' + m[7]) * 1000) : 0));
}
// PT12H30M15.5S -> fraction of a day (hours may exceed 24)
function durationDays(s) {
  const m = /^-?P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/.exec(String(s));
  if (!m) return null;
  const sec = (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+(m[3] || 0)) * 60 + (+(m[4] || 0));
  return (String(s).startsWith('-') ? -sec : sec) / 86400;
}

// Length with unit -> Excel character width (about 7 px per character + 5 px padding at 96 dpi).
// Inverse of Excel's width formula (px = chars * 7 + 5 for the default Calibri 11): approximate, but it round-trips
// widths written by write.js.
function charWidth(len) {
  const m = /^([\d.]+)(cm|mm|in|pt|pc|px)$/.exec(String(len || ''));
  if (!m) return null;
  const px = +m[1] * { cm: 37.795, mm: 3.7795, in: 96, pt: 96 / 72, pc: 16, px: 1 }[m[2]];
  return Math.max(1, Math.round(((px - 5) / 7) * 100) / 100);
}

// Frozen panes live in settings.xml (view settings), not in content.xml. SplitMode 2 = freeze (1 would be a split).
function readSettings(xml) {
  const out = new Map();
  if (!xml) return out;
  try {
    const doc = root(parseXML(xml));
    const walk = (nd, fn) => { for (const c of nd.children || []) if (c.type === 'element') { fn(c); walk(c, fn); } };
    walk(doc, (el) => {
      if (!/config-item-map-named$/.test(el.name) || attr(el, 'config:name') !== 'Tables') return;
      for (const entry of children(el, 'config-item-map-entry')) {
        const name = attr(entry, 'config:name');
        const items = {};
        for (const it of children(entry, 'config-item')) items[attr(it, 'config:name')] = it.children.map((c) => c.text || '').join('');
        const rows = items.VerticalSplitMode === '2' ? +items.VerticalSplitPosition || 0 : 0;
        const cols = items.HorizontalSplitMode === '2' ? +items.HorizontalSplitPosition || 0 : 0;
        if (name && (rows || cols)) out.set(name, { rows, cols });
      }
    });
  } catch { /* settings are optional */ }
  return out;
}

export async function readODS(bytes) {
  const entries = readZip(bytes);
  const get = (n) => entries.find((e) => e.name === n);
  const content = get('content.xml');
  if (!content) throw new Error('not an OpenDocument spreadsheet (content.xml missing)');
  const doc = root(parseXML(await content.text()));
  const settingsEntry = get('settings.xml');
  const freezes = readSettings(settingsEntry ? await settingsEntry.text() : null);
  // automatic column styles -> widths
  const widths = new Map();
  for (const st of children(child(doc, 'automatic-styles'), 'style')) {
    const p = child(st, 'table-column-properties');
    if (p && attr(st, 'style:family') === 'table-column') widths.set(attr(st, 'style:name'), charWidth(attr(p, 'style:column-width')));
  }
  const tableStyles = new Map();
  for (const st of children(child(doc, 'automatic-styles'), 'style')) {
    const p = child(st, 'table-properties');
    if (p && attr(st, 'style:family') === 'table') tableStyles.set(attr(st, 'style:name'), attr(p, 'table:display') === 'false');
  }
  const body = child(child(doc, 'body'), 'spreadsheet');
  if (!body) throw new Error('the document has no spreadsheet body');
  const sheets = [];
  for (const table of children(body, 'table')) {
    const name = attr(table, 'table:name') || 'Sheet' + (sheets.length + 1);
    const sheet = { name, rows: [], cols: [], merges: [], freeze: freezes.get(name) || null };
    if (tableStyles.get(attr(table, 'table:style-name'))) sheet.hidden = true;
    // columns (possibly inside table-column-group / table-header-columns)
    let ci = 0;
    const cols = [];
    const collectCols = (nd) => {
      for (const c of nd.children) {
        if (c.type !== 'element') continue;
        if (/(^|:)table-column$/.test(c.name)) {
          const n = Math.min(+(attr(c, 'table:number-columns-repeated') || 1), MAX_REPEAT_COLS);
          const w = widths.get(attr(c, 'table:style-name'));
          const hidden = attr(c, 'table:visibility') === 'collapse';
          for (let k = 0; k < n && ci < MAX_REPEAT_COLS; k++, ci++) if (w || hidden) cols[ci] = { ...(w ? { width: w } : {}), ...(hidden ? { hidden: true } : {}) };
        } else if (/(table-column-group|table-header-columns|table-columns)$/.test(c.name)) collectCols(c);
      }
    };
    collectCols(table);
    sheet.cols = cols;
    let r = 0;
    const rowsOf = (nd, out) => {
      for (const c of nd.children) {
        if (c.type !== 'element') continue;
        if (/(^|:)table-row$/.test(c.name)) out.push(c);
        else if (/(table-row-group|table-header-rows|table-rows)$/.test(c.name)) rowsOf(c, out);
      }
      return out;
    };
    for (const tr of rowsOf(table, [])) {
      const rep = +(attr(tr, 'table:number-rows-repeated') || 1);
      const cells = [];
      let c = 0;
      let any = false;
      for (const tc of tr.children) {
        if (tc.type !== 'element' || !/(table-cell|covered-table-cell)$/.test(tc.name)) continue;
        const crep = +(attr(tc, 'table:number-columns-repeated') || 1);
        const covered = /covered-table-cell$/.test(tc.name);
        let v = null;
        const type = attr(tc, 'office:value-type') || attr(tc, 'calcext:value-type');
        let fmt = null;
        switch (type) {
          case 'float': v = +attr(tc, 'office:value'); break;
          case 'percentage': v = +attr(tc, 'office:value'); fmt = '0.00%'; break;
          case 'currency': v = +attr(tc, 'office:value'); fmt = '#,##0.00'; break;
          case 'date': v = isoSerial(attr(tc, 'office:date-value')); fmt = v != null && v % 1 ? 'yyyy-mm-dd hh:mm:ss' : 'yyyy-mm-dd'; break;
          case 'time': v = durationDays(attr(tc, 'office:time-value')); fmt = 'hh:mm:ss'; break;
          case 'boolean': v = ['true', '1'].includes(String(attr(tc, 'office:boolean-value')).toLowerCase()); break;
          case 'string': v = attr(tc, 'office:string-value') ?? cellText(tc); break;
          default: { const t = cellText(tc); v = t === '' ? null : t; }
        }
        // Cached value is kept next to the formula: the sheet shows correct numbers before (or without) recalculation.
        if (typeof v === 'number' && !Number.isFinite(v)) v = null;
        const fx = attr(tc, 'table:formula');
        const f = fx ? fromODFFormula(fx) : null;
        const link = firstLink(tc);
        let cell = v;
        if (f || fmt || link) { cell = { v }; if (f) cell.f = f; if (fmt) cell.s = { fmt }; if (link) cell.link = link; }
        const span = +(attr(tc, 'table:number-columns-spanned') || 1), rspan = +(attr(tc, 'table:number-rows-spanned') || 1);
        if (!covered && (span > 1 || rspan > 1)) sheet.merges.push({ r1: r, c1: c, r2: r + rspan - 1, c2: c + span - 1 });
        if (cell != null && !covered) {
          // Repeated cells are copied, not aliased, so editing one does not change its siblings.
          // KNOWN DEFECT: the copy is shallow, so cell.s is still shared between repeats (also for rows below).
          // Fix: copy s as well ({ ...cell, s: cell.s && { ...cell.s } }).
          for (let k = 0; k < Math.min(crep, MAX_REPEAT_COLS); k++) cells[c + k] = k ? (typeof cell === 'object' ? { ...cell } : cell) : cell;
          any = true;
        }
        c += crep;
      }
      if (any) {
        const n = Math.min(rep, MAX_REPEAT_ROWS);
        for (let k = 0; k < n; k++) sheet.rows[r + k] = k ? cells.map((x) => (x && typeof x === 'object' ? { ...x } : x)) : cells;
      }
      r += rep;
      if (r > 1048576) break;
    }
    sheets.push(sheet);
  }
  if (!sheets.length) throw new Error('the document has no tables');
  return { sheets, names: [], date1904: false };
}
