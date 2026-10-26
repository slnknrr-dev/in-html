// sheets-processor/io.js - files in and out: CSV / TSV / text (encoding, delimiter, header and column types detected;
// large files parsed in slices), XLSX, ODS, JSON (array of objects or arrays), HTML tables from the clipboard; exports to
// CSV, TSV, XLSX, JSON, HTML table and Markdown. Everything stays in the page.
// 
// Detection is heuristic by design (csv/infer.js, csv/csv.js sniffers) with locale hints as tie-breakers: "03/04/2024"
// and "1,5" are ambiguous without knowing the user's conventions.

import { decodeBytes, encodeText } from '../csv/encoding.js';
import { parseCSVAsync, serializeCSV, sniffCSV, hasHeader } from '../csv/csv.js';
import { convertValue, detectColumn } from '../csv/infer.js';
import { readXLSX } from '../xlsx/read.js';
import { readODS } from '../xlsx/ods.js';
import { writeXLSX } from '../xlsx/write.js';
import { readZip } from '../zip/zip.js';
import { CellError, cellValue, colName, isRich, serialParts } from '../xlsx/cells.js';
import { formatValue, isDateFormat } from '../xlsx/numfmt.js';
import { numToText } from '../formula/values.js';
import { pxToChars } from './model.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const extOf = (name) => (/\.([a-z0-9]+)$/i.exec(name || '') || ['', ''])[1].toLowerCase();
const baseName = (name) => String(name || 'Sheet').replace(/\.[a-z0-9]+$/i, '').slice(0, 31) || 'Sheet';

// Locale hints for ambiguous dates (03/04/2024) and decimal marks.
// navigator.language decides ambiguous dates (US-style m/d only for en-US/PH/CA) and the decimal mark.
export function localeHints(lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US') {
  const l = String(lang);
  return { dateOrder: /^en-(US|PH|CA)$|^en$/i.test(l) ? 'mdy' : 'dmy', decimal: /^(ru|uk|de|fr|es|it|pt|nl|pl|cs|sv|fi|da|nb|tr|ka|be|bg|ro|hu|sk|sl|hr|sr|lt|lv|et|el)/i.test(l) ? ',' : '.' };
}

// Rows of strings -> typed sheet: header detection, per-column type detection and conversion.
// Per-column type detection over the data rows, then in-place conversion. Yields to the event loop every 16384 rows
// so the progress bar can paint on large files.
export async function rowsToSheet(rows, name, { header = 'auto', types = true, delimiter, onProgress } = {}) {
  while (rows.length && rows[rows.length - 1].every((v) => v == null || v === '')) rows.pop();
  const hasHead = header === 'auto' ? hasHeader(rows) : !!header;
  const start = hasHead ? 1 : 0;
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  const hints = localeHints();
  const cols = [];
  for (let c = 0; c < width; c++) {
    let info = { type: 'text' };
    if (types) {
      const sample = [];
      for (let r = start; r < rows.length; r++) sample.push(rows[r][c]);
      // A ";" delimited file almost always uses a decimal comma (that is why ";" is used); "," as delimiter rules out a decimal comma.
      info = detectColumn(sample, { decimal: delimiter === ';' ? ',' : hints.decimal === ',' && delimiter !== ',' ? ',' : '.', dateOrder: hints.dateOrder });
    }
    cols[c] = { type: info.type === 'empty' ? undefined : info.type };
    if (info.fmt && info.fmt !== 'General') cols[c].fmt = info.fmt;
    for (let r = start; r < rows.length; r++) {
      const row = rows[r];
      if (c >= row.length) continue;
      row[c] = types ? convertValue(row[c], info) : (row[c] === '' ? null : row[c]);
      if ((r & 16383) === 0 && onProgress) { onProgress((c + r / rows.length) / width); await tick(); }
    }
  }
  if (hasHead) rows[0] = rows[0].map((v) => (v === '' ? null : v));
  return { name, rows, cols, header: hasHead, freeze: hasHead ? { rows: 1, cols: 0 } : null };
}

export async function textToSheet(text, name, { delimiter, header = 'auto', types = true, onProgress } = {}) {
  const sn = sniffCSV(text);
  const d = delimiter || sn.delimiter;
  const rows = await parseCSVAsync(text, { delimiter: d, quote: sn.quote, onProgress: onProgress ? (p) => onProgress(p * 0.6) : null });
  const sheet = await rowsToSheet(rows, name, { header: header === 'auto' ? (rows.length > 1 ? 'auto' : false) : header, types, delimiter: d, onProgress: onProgress ? (p) => onProgress(0.6 + p * 0.4) : null });
  return { sheet, info: { delimiter: d, quote: sn.quote, header: sheet.header } };
}

// JSON: an array of objects (keys become columns), an array of arrays, or an object holding such an array.
// Strings go through the normal type detection; numbers and booleans already typed in the JSON are restored afterwards, so detection never downgrades them.
export async function jsonToSheet(text, name) {
  let data = JSON.parse(text);
  if (!Array.isArray(data) && data && typeof data === 'object') {
    const arr = Object.values(data).find(Array.isArray);
    data = arr || [data];
  }
  if (!Array.isArray(data)) data = [data];
  const cell = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v);
  let rows;
  if (data.every((x) => Array.isArray(x))) rows = data.map((r) => r.map(cell));
  else if (data.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
    const keys = [];
    const seen = new Set();
    for (const o of data) for (const k of Object.keys(o)) if (!seen.has(k)) { seen.add(k); keys.push(k); }
    rows = [keys, ...data.map((o) => keys.map((k) => cell(o[k])))];
  } else rows = [['value'], ...data.map((v) => [cell(v)])];
  // strings go through the usual detection; numbers and booleans typed in the JSON are put back afterwards
  const typed = rows;
  const strings = typed.map((r) => r.map((v) => (typeof v === 'string' ? v : v == null ? '' : String(v))));
  const header = !data.every((x) => Array.isArray(x));
  const sheet = await rowsToSheet(strings, name, { header: header ? true : 'auto' });
  // restore booleans / numbers that were typed in the JSON itself
  for (let r = sheet.header ? 1 : 0; r < typed.length; r++) {
    for (let c = 0; c < typed[r].length; c++) if (typeof typed[r][c] === 'number' || typeof typed[r][c] === 'boolean') sheet.rows[r][c] = typed[r][c];
  }
  return sheet;
}

// First <table> of an HTML fragment (clipboard from spreadsheets and web pages) -> rows of strings.
// DOMParser builds an inert document (scripts never run), so pasted HTML is safe to parse. colspan/rowspan are expanded
// into empty cells (capped at 50/500 against hostile markup) so columns stay aligned.
export function htmlTableRows(html) {
  if (typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  const table = doc.querySelector('table');
  if (!table) return null;
  const rows = [];
  for (const tr of table.querySelectorAll('tr')) {
    const r = rows.length;
    const row = rows[r] || (rows[r] = []);
    let c = 0;
    for (const td of tr.querySelectorAll('th, td')) {
      while (row[c] !== undefined) c++;
      for (const br of td.querySelectorAll('br')) br.replaceWith('\n');
      const text = td.textContent.replace(/[ \t\r\n]*\n[ \t\r\n]*/g, '\n').replace(/[ \t]+/g, ' ').trim();
      const cs = Math.max(1, Math.min(50, +td.getAttribute('colspan') || 1)), rs = Math.max(1, Math.min(500, +td.getAttribute('rowspan') || 1));
      for (let i = 0; i < rs; i++) {
        const rr = rows[r + i] || (rows[r + i] = []);
        for (let j = 0; j < cs; j++) rr[c + j] = i === 0 && j === 0 ? text : '';
      }
      c += cs;
    }
  }
  return rows.map((r) => Array.from({ length: r.length }, (_, i) => r[i] ?? ''));
}

// A dropped / picked file -> { sheets, names, info }.
// Format by signature first ("PK" = ZIP container), extension second: misnamed files still open. ODS vs XLSX decided by the ZIP member names.
export async function readFile(file, opts = {}) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = extOf(file.name);
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (zip || ['xlsx', 'xlsm', 'ods'].includes(ext)) {
    let kind = ext === 'ods' ? 'ods' : 'xlsx';
    if (zip) {
      const names = readZip(bytes).map((e) => e.name.toLowerCase());
      kind = names.includes('content.xml') && !names.includes('xl/workbook.xml') ? 'ods' : 'xlsx';
    }
    const wb = kind === 'ods' ? await readODS(bytes) : await readXLSX(bytes);
    for (const s of wb.sheets) {
      const strRows = s.rows.slice(0, 50).filter(Boolean).map((r) => Array.from(r, (c) => { const v = cellValue(c); return v == null ? '' : v instanceof CellError ? v.code : String(v); }));
      s.header = strRows.length > 1 && hasHeader(strRows);
      if (s.header && !s.freeze) s.freeze = { rows: 1, cols: 0 };
    }
    return { sheets: wb.sheets, names: wb.names || [], info: { kind } };
  }
  // Legacy binary formats are refused explicitly instead of being misread as text.
  if (/^(xls|xlsb|numbers)$/.test(ext)) throw new Error('unsupported');
  const { text, encoding } = decodeBytes(bytes);
  if (ext === 'json' || (/^\s*[[{]/.test(text) && ext !== 'csv' && ext !== 'tsv' && ext !== 'txt')) {
    try { return { sheets: [await jsonToSheet(text, baseName(file.name))], names: [], info: { kind: 'json', encoding } }; }
    catch (e) { if (ext === 'json') throw e; }
  }
  const { sheet, info } = await textToSheet(text, baseName(file.name), { delimiter: opts.delimiter || (ext === 'tsv' || ext === 'tab' ? '\t' : undefined), header: opts.header ?? 'auto', types: opts.types ?? true, onProgress: opts.onProgress });
  return { sheets: [sheet], names: [], info: { kind: 'csv', encoding, ...info } };
}

// --- export ------------------------------------------------------------------------------

const pad = (n, w = 2) => String(n).padStart(w, '0');
// Serial date -> ISO text (date, or date and time).
// Time-only formats (only h/m/s/AM-PM tokens after removing quoted text) export as a time, others as a date or date-time.
export function isoOf(v, fmt) {
  const p = serialParts(v);
  const date = `${pad(p.y, 4)}-${pad(p.m)}-${pad(p.d)}`;
  const time = `${pad(p.hh)}:${pad(p.mm)}${p.ss ? ':' + pad(p.ss) : ''}`;
  if (/^[hms\[\]:.\s]+(am\/pm)?$/i.test(fmt.replace(/"[^"]*"/g, ''))) return time;
  return v % 1 ? `${date} ${time}` : date;
}

// Plain value of a cell for data exports: numbers (15 digits), ISO dates, booleans, error codes, text.
// toPrecision(15): spreadsheet precision; hides binary artefacts like 0.30000000000000004.
export function plainValue(cell, colFmt) {
  const v = cellValue(cell);
  if (v == null) return null;
  if (v instanceof CellError) return v.code;
  if (typeof v === 'number') {
    const fmt = (isRich(cell) && cell.s && cell.s.fmt) || colFmt;
    if (fmt && isDateFormat(fmt)) return isoOf(v, fmt);
    return Number(v.toPrecision(15));
  }
  return v;
}

// Matrix of a sheet block: rows (physical indices) x [c1..c2]; mode 'plain' or 'display' (text(r, c)).
export function blockMatrix(sheet, rowList, c1, c2, mode, text) {
  return rowList.map((r) => {
    const row = sheet.rows[r] || [];
    const out = [];
    for (let c = c1; c <= c2; c++) {
      if (mode === 'display') out.push(text(r, c));
      else out.push(plainValue(row[c], sheet.cols[c] && sheet.cols[c].fmt));
    }
    return out;
  });
}

// BOM by default: Excel opens BOM-less UTF-8 CSV as the ANSI code page and mangles non-ASCII text.
export function toDelimited(matrix, { delimiter = ',', bom = true, newline = '\r\n' } = {}) {
  const rows = matrix.map((r) => r.map((v) => (v == null ? '' : typeof v === 'number' ? numToText(v) : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v))));
  return encodeText(serializeCSV(rows, { delimiter, newline }), { bom });
}

// JSON keys must be unique and non-empty: blanks become "Column X", repeats get " (2)".
function headNames(head, width) {
  const seen = new Map();
  return Array.from({ length: width }, (_, c) => {
    let n = head && head[c] != null && String(head[c]).trim() ? String(head[c]).trim() : 'Column ' + colName(c);
    const k = n.toLowerCase();
    const i = seen.get(k) || 0;
    seen.set(k, i + 1);
    if (i) n += ' (' + (i + 1) + ')';
    return n;
  });
}

export function toJSON(matrix, header) {
  const width = matrix.reduce((w, r) => Math.max(w, r.length), 0);
  if (!header) return JSON.stringify(matrix, null, 2);
  const names = headNames(matrix[0], width);
  return JSON.stringify(matrix.slice(1).map((r) => Object.fromEntries(names.map((n, c) => [n, r[c] ?? null]))), null, 2);
}

// Escapes the four characters that matter in text and double-quoted attributes.
const escHTML = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// display: matrix of shown texts; numeric: matrix of booleans (right alignment)
export function toHTML(display, numeric, { header, title = 'Table' } = {}) {
  const cell = (tag, v, i, j) => `<${tag}${numeric[i] && numeric[i][j] ? ' class="n"' : ''}>${escHTML(v).replace(/\n/g, '<br>')}</${tag}>`;
  const head = header && display.length ? `<thead><tr>${display[0].map((v, j) => cell('th', v, 0, j)).join('')}</tr></thead>` : '';
  const body = display.slice(header ? 1 : 0).map((r, i) => `<tr>${r.map((v, j) => cell('td', v, i + (header ? 1 : 0), j)).join('')}</tr>`).join('\n');
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escHTML(title)}</title>
<style>body{font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;margin:24px;color:#1d2330}table{border-collapse:collapse}th,td{border:1px solid #d5d9e0;padding:5px 9px;text-align:left;vertical-align:top}th{background:#f3f5f8;font-weight:600}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}@media (prefers-color-scheme:dark){body{background:#14171c;color:#e6e9ef}th,td{border-color:#3a414d}th{background:#20252d}}</style>
</head><body>
<table>
${head}
<tbody>
${body}
</tbody>
</table>
</body></html>
`;
}

// Pipes escaped, newlines as <br> (GFM tables are single-line). Right alignment when every non-empty cell is numeric.
export function toMarkdown(display, numeric, { header } = {}) {
  if (!display.length) return '';
  const width = display.reduce((w, r) => Math.max(w, r.length), 0);
  const md = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  const head = header ? display[0] : headNames(null, width);
  const body = header ? display.slice(1) : display;
  const right = Array.from({ length: width }, (_, c) => body.length > 0 && body.every((r, i) => !String(r[c] ?? '').trim() || (numeric[i + (header ? 1 : 0)] && numeric[i + (header ? 1 : 0)][c])));
  const line = (r) => '| ' + Array.from({ length: width }, (_, c) => md(r[c])).join(' | ') + ' |';
  return [line(head), '| ' + right.map((x) => (x ? '---:' : '---')).join(' | ') + ' |', ...body.map(line)].join('\n') + '\n';
}

// Workbook -> XLSX bytes: pixel widths back to characters, column formats and the header row in bold.
// Header row bolded on export only when it has no style of its own; widths converted back to Excel character units.
export async function toXLSX(book) {
  const sheets = book.sheets.map((sh) => {
    const rows = sh.header && sh.rows[0]
      ? [sh.rows[0].map((cell) => (cell == null ? cell : isRich(cell) ? (cell.s ? cell : { ...cell, s: { bold: true } }) : { v: cell, s: { bold: true } })), ...sh.rows.slice(1)]
      : sh.rows;
    return {
      name: sh.name, rows, hidden: sh.hidden, merges: sh.merges, freeze: sh.freeze,
      cols: sh.cols.map((c) => (c ? { width: c.width ? pxToChars(c.width) : undefined, hidden: c.hidden, fmt: c.fmt } : c)),
    };
  });
  return writeXLSX({ sheets, names: book.names }, { creator: 'Sheets processor' });
}

export { baseName, extOf, formatValue };
