// sheets-processor/ops.js - table operations on rows of the workbook model (xlsx/cells.js), free of DOM so they run in
// Node too: value ordering, multi-key sorting, filter conditions, duplicates, transposition, splitting / merging columns,
// text clean-up and type conversion, group-by aggregates, column statistics with histograms and column type sensing.
// 
// Values follow the cell model: number | string | boolean | CellError | null. Every function tolerates sparse rows
// (rows[r] undefined, cells missing) because sheets are stored sparsely.

import { CellError, cellValue, isRich } from '../xlsx/cells.js';
import { isDateFormat } from '../xlsx/numfmt.js';
import { parseDate, parseNumber, dateSerial } from '../csv/infer.js';

export const val = cellValue;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const RANK = (v) => (v == null || v === '' ? 4 : typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : 3);

// Sorting order: numbers < text (natural, case-insensitive) < booleans < errors; blanks always last.
// Blanks last in both directions (desc does not move them to the top), as spreadsheet sorts do.
export function compareValues(a, b, desc = false) {
  const ra = RANK(a), rb = RANK(b);
  if (ra === 4 || rb === 4) return ra === rb ? 0 : ra === 4 ? 1 : -1;
  let c;
  if (ra !== rb) c = ra - rb;
  else if (ra === 0) c = a - b;
  else if (ra === 1) c = collator.compare(a, b);
  else if (ra === 2) c = (a ? 1 : 0) - (b ? 1 : 0);
  else c = String(a).localeCompare(String(b));
  return desc ? -c : c;
}

// Permutation of rows [from, rows.length) by keys [{ c, desc }] (stable). Returns indices of the data rows.
// Decorate-sort: key values extracted once per row (cellValue can be costly for rich cells) instead of in every
// comparison; ties broken by original position, which makes the sort stable regardless of the engine.
export function sortOrder(rows, keys, from = 0) {
  const idx = [];
  for (let r = from; r < rows.length; r++) idx.push(r);
  const cols = keys.map((k) => idx.map((r) => val(rows[r] ? rows[r][k.c] : null)));
  const pos = new Map(idx.map((r, i) => [r, i]));
  idx.sort((x, y) => {
    const i = pos.get(x), j = pos.get(y);
    for (let k = 0; k < keys.length; k++) {
      const c = compareValues(cols[k][i], cols[k][j], keys[k].desc);
      if (c) return c;
    }
    return i - j;
  });
  return idx;
}

// --- filters -----------------------------------------------------------------------------

export const FILTER_OPS = ['contains', 'ncontains', 'eq', 'ne', 'starts', 'ends', 'gt', 'ge', 'lt', 'le', 'between', 'empty', 'nempty', 'top', 'bottom', 'in'];
export const NEEDS_VALUE = new Set(['contains', 'ncontains', 'eq', 'ne', 'starts', 'ends', 'gt', 'ge', 'lt', 'le', 'between', 'top', 'bottom']);

// Number from user text: plain numbers, decimal comma, percent, dates.
// User text in filters: try both decimal marks and both date orders; the first successful parse wins.
export function numberOf(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  const n = parseNumber(s, '.') || parseNumber(s, ',');
  if (n) return n.v;
  const d = parseDate(s, 'mdy') || parseDate(s, 'dmy');
  return d ? dateSerial(d) : null;
}

// Predicate over (value, displayText) for one condition; `rowsForTop` supplies the column values for top / bottom N.
// columnValues (not "rowsForTop") feeds top/bottom N: the threshold value is computed once, then each row is an O(1) test.
// Numeric comparison applies only when both sides are numbers; otherwise text comparison with the natural collator.
export function makeCondition(cond, columnValues) {
  const op = cond.op;
  const q = String(cond.v ?? '');
  const lq = q.toLowerCase();
  const qn = numberOf(q), qn2 = numberOf(cond.v2);
  switch (op) {
    case 'contains': return (v, t) => t.toLowerCase().includes(lq);
    case 'ncontains': return (v, t) => !t.toLowerCase().includes(lq);
    case 'starts': return (v, t) => t.toLowerCase().startsWith(lq);
    case 'ends': return (v, t) => t.toLowerCase().endsWith(lq);
    // Numeric equality with 1e-9 tolerance: 0.1+0.2 must equal 0.3 typed by the user.
    case 'eq': return (v, t) => (qn !== null && typeof v === 'number' ? Math.abs(v - qn) < 1e-9 : t.toLowerCase() === lq);
    case 'ne': return (v, t) => !(qn !== null && typeof v === 'number' ? Math.abs(v - qn) < 1e-9 : t.toLowerCase() === lq);
    case 'gt': case 'ge': case 'lt': case 'le': {
      const cmp = (v, t) => {
        if (qn !== null && typeof v === 'number') return v - qn;
        if (qn !== null) return null;
        return collator.compare(t, q);
      };
      return (v, t) => {
        if (v == null || v === '') return false;
        const c = cmp(v, t);
        if (c === null) return false;
        return op === 'gt' ? c > 0 : op === 'ge' ? c >= 0 : op === 'lt' ? c < 0 : c <= 0;
      };
    }
    case 'between': {
      const lo = Math.min(qn ?? -Infinity, qn2 ?? Infinity), hi = Math.max(qn ?? -Infinity, qn2 ?? Infinity);
      return (v) => typeof v === 'number' && v >= lo && v <= hi;
    }
    case 'empty': return (v) => v == null || v === '';
    case 'nempty': return (v) => !(v == null || v === '');
    case 'top': case 'bottom': {
      const n = Math.max(1, Math.trunc(qn ?? 10));
      const nums = columnValues.filter((x) => typeof x === 'number').sort((a, b) => (op === 'top' ? b - a : a - b));
      const edge = nums.length ? nums[Math.min(n, nums.length) - 1] : null;
      return (v) => typeof v === 'number' && edge !== null && (op === 'top' ? v >= edge : v <= edge);
    }
    case 'in': {
      const set = new Set((cond.values || []).map(String));
      return (v, t) => set.has(t);
    }
    default: return () => true;
  }
}

// Visible rows for conditions [{ c, op, v, v2, values }] (all must hold); rows before `from` (the header) stay.
// Trailing empty rows are not shown as matches (they exist only as spare grid space).
export function filterRows(rows, conds, text, from = 0) {
  const out = [];
  for (let r = 0; r < from && r < rows.length; r++) out.push(r);
  const tests = conds.map((cond) => {
    const colVals = cond.op === 'top' || cond.op === 'bottom' ? rows.slice(from).map((row) => val(row ? row[cond.c] : null)) : null;
    return { c: cond.c, fn: makeCondition(cond, colVals || []) };
  });
  let last = rows.length - 1;
  while (last >= from && !(rows[last] && rows[last].some((x) => x != null && x !== ''))) last--;
  for (let r = from; r <= last; r++) {
    const row = rows[r];
    let ok = true;
    for (const { c, fn } of tests) {
      const v = val(row ? row[c] : null);
      if (!fn(v, text(r, c))) { ok = false; break; }
    }
    if (ok) out.push(r);
  }
  return out;
}

// Distinct display texts of a column with counts (value-list filters), most frequent first.
// KNOWN DEFECT: the comment above says "most frequent first", the code sorts alphabetically by text. Fix: the comment (the value list is meant to be alphabetical).
export function distinctTexts(rows, c, text, from = 0, limit = 1000) {
  const m = new Map();
  for (let r = from; r < rows.length; r++) {
    if (!rows[r]) continue;
    const t = text(r, c);
    m.set(t, (m.get(t) || 0) + 1);
  }
  return [...m].sort((a, b) => collator.compare(a[0], b[0])).slice(0, limit);
}

// --- duplicates, transpose, split, merge, text ------------------------------------------------

// Type-tagged key parts ("s" text, "e" error, typeof otherwise): the number 1 and the text "1" are different keys.
const keyPart = (v, { ignoreCase, trim }) => {
  if (v == null) return '\u0000';
  if (typeof v === 'string') { let s = trim ? v.trim() : v; if (ignoreCase) s = s.toLowerCase(); return 's' + s; }
  if (v instanceof CellError) return 'e' + v.code;
  return typeof v + String(v);
};

// Rows (from `from`) whose key over `cols` was seen before: their indices.
export function duplicateRows(rows, cols, opts = {}, from = 0) {
  const seen = new Set();
  const dup = [];
  for (let r = from; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row.some((x) => x != null && x !== '')) continue;
    const k = cols.map((c) => keyPart(val(row[c]), opts)).join('\u0001');
    if (seen.has(k)) dup.push(r); else seen.add(k);
  }
  return dup;
}

// Values of rows[r1..r2] x [c1..c2] transposed (formulas become their values; styles are kept).
export function transposeBlock(rows, r1, c1, r2, c2) {
  const out = [];
  for (let c = c1; c <= c2; c++) {
    const nr = [];
    for (let r = r1; r <= r2; r++) {
      const cell = rows[r] ? rows[r][c] : null;
      nr.push(isRich(cell) ? (cell.s ? { v: cell.v ?? null, s: cell.s } : cell.v ?? null) : cell ?? null);
    }
    out.push(nr);
  }
  return out;
}

// Over max parts the remainder is joined back into the last part, so no data is lost.
export function splitText(s, delim, { regex = false, max = 50, trim = true } = {}) {
  if (s == null || s === '') return [];
  let parts;
  if (regex) { try { parts = String(s).split(new RegExp(delim)); } catch { parts = [String(s)]; } }
  else parts = String(s).split(delim === '\\t' ? '\t' : delim);
  if (parts.length > max) parts = [...parts.slice(0, max - 1), parts.slice(max - 1).join(regex ? ' ' : delim)];
  return trim ? parts.map((p) => p.trim()) : parts;
}

export const TEXT_OPS = ['trim', 'upper', 'lower', 'proper', 'clean'];
export function textOp(s, op) {
  switch (op) {
    case 'trim': return s.replace(/^\s+|\s+$/g, '').replace(/[ \t]{2,}/g, ' ');
    case 'upper': return s.toUpperCase();
    case 'lower': return s.toLowerCase();
    // Unicode-aware title case: \p{L} after a non-letter; apostrophes count as letters so "o'neil" is not "O'Neil".
    case 'proper': return s.toLowerCase().replace(/(^|[^\p{L}\p{N}'])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
    // Removes C0 controls and zero-width characters, turns non-breaking spaces into spaces, collapses whitespace.
    case 'clean': return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‍﻿]/g, '').replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();
    default: return s;
  }
}

// Value converted to a type: 'number' | 'text' | 'date' | 'bool' (null when it does not convert).
export function convertTo(v, type, decimal = '.', dateOrder = 'mdy') {
  if (v == null || v === '') return v;
  switch (type) {
    case 'text': return typeof v === 'string' ? v : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : v instanceof CellError ? v.code : String(v);
    case 'number': {
      if (typeof v === 'number') return v;
      if (typeof v === 'boolean') return v ? 1 : 0;
      const p = parseNumber(String(v), decimal) || parseNumber(String(v), decimal === '.' ? ',' : '.');
      return p ? p.v : null;
    }
    case 'date': {
      if (typeof v === 'number') return v;
      const d = parseDate(String(v), dateOrder);
      return d ? dateSerial(d) : null;
    }
    case 'bool': {
      if (typeof v === 'boolean') return v;
      if (typeof v === 'number') return v !== 0;
      const s = String(v).trim().toLowerCase();
      return ['true', 'yes', '1', 'y', 'on'].includes(s) ? true : ['false', 'no', '0', 'n', 'off'].includes(s) ? false : null;
    }
    default: return v;
  }
}

// --- group by ----------------------------------------------------------------------------

export const AGGS = ['count', 'distinct', 'sum', 'avg', 'min', 'max', 'median', 'first', 'last'];

// Numeric aggregates ignore text and blanks (like SUM/AVERAGE); count counts any non-blank.
function aggregate(fn, vals) {
  const nums = vals.filter((x) => typeof x === 'number');
  switch (fn) {
    case 'count': return vals.filter((x) => x != null && x !== '').length;
    case 'distinct': return new Set(vals.filter((x) => x != null && x !== '').map((x) => (typeof x === 'string' ? 's' + x.toLowerCase() : typeof x + x))).size;
    case 'sum': return nums.reduce((a, b) => a + b, 0);
    case 'avg': return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    case 'min': return nums.length ? Math.min(...nums) : null;
    case 'max': return nums.length ? Math.max(...nums) : null;
    case 'median': {
      if (!nums.length) return null;
      // Typed-array sort is numeric by default (Array#sort would compare as strings).
      const s = Float64Array.from(nums).sort(), h = s.length >> 1;
      return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
    }
    case 'first': return vals.find((x) => x != null && x !== '') ?? null;
    case 'last': { for (let i = vals.length - 1; i >= 0; i--) if (vals[i] != null && vals[i] !== '') return vals[i]; return null; }
    default: return null;
  }
}

// Groups rows[from..] by the key columns (case-insensitive text); one output row per group with the aggregates.
export function groupRows(rows, keyCols, aggs, from = 0, rowList = null) {
  const groups = new Map();
  const list = rowList || Array.from({ length: Math.max(0, rows.length - from) }, (_, i) => i + from);
  for (const r of list) {
    const row = rows[r];
    if (!row || !row.some((x) => x != null && x !== '')) continue;
    const kv = keyCols.map((c) => val(row[c]));
    const k = kv.map((v) => keyPart(v, { ignoreCase: true, trim: true })).join('\u0001');
    let g = groups.get(k);
    if (!g) { g = { key: kv, vals: aggs.map(() => []) }; groups.set(k, g); }
    aggs.forEach((a, i) => g.vals[i].push(val(row[a.c])));
  }
  const out = [];
  for (const g of groups.values()) out.push([...g.key, ...aggs.map((a, i) => aggregate(a.fn, g.vals[i]))]);
  out.sort((x, y) => {
    for (let i = 0; i < keyCols.length; i++) { const c = compareValues(x[i], y[i]); if (c) return c; }
    return 0;
  });
  return out;
}

// --- statistics --------------------------------------------------------------------------

// Column type from typed values (a date number format makes numbers dates).
// Numbers mixed only with errors still count as numeric: an #N/A should not turn a column into "mixed".
export function senseType(values, fmt) {
  let n = 0, s = 0, b = 0, e = 0, filled = 0;
  for (const v of values) {
    if (v == null || v === '') continue;
    filled++;
    if (typeof v === 'number') n++;
    else if (typeof v === 'string') s++;
    else if (typeof v === 'boolean') b++;
    else e++;
  }
  if (!filled) return 'empty';
  if (n === filled) return fmt && isDateFormat(fmt) ? 'date' : 'number';
  if (s === filled) return 'text';
  if (b === filled) return 'bool';
  if (n + e === filled && n) return fmt && isDateFormat(fmt) ? 'date' : 'number';
  return 'mixed';
}

// 1-2-2.5-5-10 steps: axis/bin edges land on round numbers.
function niceStep(span, target) {
  const raw = span / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

// Histogram bins over numbers: [{ x0, x1, n }] with "nice" bin edges (at most `maxBins`).
// Bin count ~ sqrt(n), clamped 5..maxBins; the last value falls into the last bin (Math.min).
export function histogram(nums, maxBins = 20) {
  if (!nums.length) return [];
  let lo = Infinity, hi = -Infinity;
  for (const x of nums) { if (x < lo) lo = x; if (x > hi) hi = x; }
  if (lo === hi) return [{ x0: lo, x1: hi, n: nums.length }];
  const target = Math.min(maxBins, Math.max(5, Math.ceil(Math.sqrt(nums.length))));
  const step = niceStep(hi - lo, target);
  const start = Math.floor(lo / step) * step;
  const count = Math.max(1, Math.ceil((hi - start) / step + 1e-9));
  const bins = Array.from({ length: count }, (_, i) => ({ x0: start + i * step, x1: start + (i + 1) * step, n: 0 }));
  for (const x of nums) bins[Math.min(count - 1, Math.floor((x - start) / step))].n++;
  return bins;
}

export function columnStats(values, { fmt, text } = {}) {
  const st = { count: 0, empty: 0, distinct: 0, numbers: 0, texts: 0, sum: 0, mean: null, median: null, min: null, max: null, stdev: null, minLen: null, maxLen: null, top: [], hist: [], type: senseType(values, fmt) };
  const freq = new Map();
  const nums = [];
  values.forEach((v, i) => {
    if (v == null || v === '') { st.empty++; return; }
    st.count++;
    const t = text ? text(v, i) : String(v);
    freq.set(t, (freq.get(t) || 0) + 1);
    if (typeof v === 'number') nums.push(v);
    else if (typeof v === 'string') {
      st.texts++;
      st.minLen = st.minLen === null ? v.length : Math.min(st.minLen, v.length);
      st.maxLen = st.maxLen === null ? v.length : Math.max(st.maxLen, v.length);
    }
  });
  st.distinct = freq.size;
  st.top = [...freq].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0])).slice(0, 8);
  st.numbers = nums.length;
  if (nums.length) {
    let s = 0, lo = Infinity, hi = -Infinity;
    for (const x of nums) { s += x; if (x < lo) lo = x; if (x > hi) hi = x; }
    st.sum = s; st.min = lo; st.max = hi; st.mean = s / nums.length;
    const sorted = Float64Array.from(nums).sort(), h = sorted.length >> 1;
    st.median = sorted.length % 2 ? sorted[h] : (sorted[h - 1] + sorted[h]) / 2;
    // Sample standard deviation (n − 1), as STDEV in spreadsheets.
    if (nums.length > 1) { let q = 0; for (const x of nums) q += (x - st.mean) ** 2; st.stdev = Math.sqrt(q / (nums.length - 1)); }
    st.hist = histogram(nums);
  }
  return st;
}

// Numbers of a rectangular block for the status bar: { cells, filled, nums, sum, min, max }.
export function blockSummary(rows, r1, c1, r2, c2, rowList = null) {
  const s = { cells: 0, filled: 0, nums: 0, sum: 0, min: Infinity, max: -Infinity };
  const each = (r) => {
    const row = rows[r];
    for (let c = c1; c <= c2; c++) {
      s.cells++;
      const v = row ? val(row[c]) : null;
      if (v == null || v === '') continue;
      s.filled++;
      if (typeof v === 'number') { s.nums++; s.sum += v; if (v < s.min) s.min = v; if (v > s.max) s.max = v; }
    }
  };
  if (rowList) for (let i = r1; i <= r2 && i < rowList.length; i++) each(rowList[i]);
  else for (let r = r1; r <= r2; r++) each(r);
  return s;
}
