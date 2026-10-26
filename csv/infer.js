// csv/infer.js - typed values from text: numbers (decimal point or comma, digit grouping, percent, currency,
// accounting negatives), booleans (also in the UI languages of the repository), dates and times (ISO, d.m.y,
// m/d/y or d/m/y, month names) and per-column type detection that picks one interpretation for a whole column.
//
//   parseNumber(text, decimal = '.') -> { v, pct, cur, curAfter, dec, grouped } | null
//   parseBool(text) -> boolean | null
//   parseDate(text, order = 'mdy') -> { y, m, d, hh, mm, ss, ms, time, dateless, style } | null
//   detectColumn(values, { decimal, dateOrder }) -> { type: 'empty'|'number'|'bool'|'date'|'text', decimal, order, fmt }
//   convertValue(text, info) / convertColumn(values, info) -> number | boolean | string | null (dates as serials)
//   inferValue(text, opts) -> { v, fmt } (one cell typed in by a user: '12%', '2024-05-01', '=…' is not handled here)
//
// Column-level typing: a column becomes 'number' / 'date' / 'bool' only when at least 95 % of a sample parses that
// way, and then one interpretation (decimal mark, day order) is applied to the whole column. Per-cell guessing would
// read '01/02/2024' as January in one row and February in the next.

import { dateToSerial } from '../xlsx/cells.js';

const CURRENCY = '$€£¥₽₴₾₹₩₺₪₫฿';
const reCache = new Map();

// Alternatives: plain digits with optional fraction, bare fraction ('.5'), grouped thousands with one consistent
// separator (backreference \5 forbids mixing '1,234 567'), or exponent form. The group separator set excludes the
// decimal mark, so '1.234,5' and '1,234.5' are unambiguous given the mark.
function numRe(decimal) {
  let re = reCache.get(decimal);
  if (re) return re;
  const D = decimal === ',' ? ',' : '\\.';
  const G = decimal === ',' ? "[. \\u00a0\\u202f']" : "[, \\u00a0\\u202f']";
  re = new RegExp(`^(?:(\\d+)(?:${D}(\\d*))?|${D}(\\d+)|(\\d{1,3}(?:(${G})\\d{3})(?:\\5\\d{3})*)(?:${D}(\\d*))?|(\\d+(?:${D}\\d*)?|${D}\\d+)[eE]([-+]?\\d+))$`);
  reCache.set(decimal, re);
  return re;
}

export function parseNumber(text, decimal = '.') {
  let s = String(text).trim();
  if (!s || s.length > 40) return null;
  let neg = false, pct = false, cur = '', curAfter = false;
  if (s[0] === '(' && s[s.length - 1] === ')') { neg = true; s = s.slice(1, -1).trim(); }
  if (s[0] === '-' || s[0] === '+' || s[0] === '−') { neg = neg !== (s[0] !== '+'); s = s.slice(1).trim(); }
  if (s && CURRENCY.includes(s[0])) { cur = s[0]; s = s.slice(1).trim(); }
  else if (s && CURRENCY.includes(s[s.length - 1])) { cur = s[s.length - 1]; curAfter = true; s = s.slice(0, -1).trim(); }
  if (s[0] === '-' && cur && !neg) { neg = true; s = s.slice(1).trim(); }
  if (s[s.length - 1] === '%') { pct = true; s = s.slice(0, -1).trim(); }
  if (!s || (pct && cur)) return null;
  const m = numRe(decimal).exec(s);
  if (!m) return null;
  let core, dec = 0, grouped = false;
  if (m[1] != null) { core = m[1] + (m[2] ? '.' + m[2] : ''); dec = m[2] ? m[2].length : 0; }
  else if (m[3] != null) { core = '0.' + m[3]; dec = m[3].length; }
  else if (m[4] != null) { core = m[4].split(m[5]).join('') + (m[6] ? '.' + m[6] : ''); dec = m[6] ? m[6].length : 0; grouped = true; }
  else { core = m[7].replace(',', '.') + 'e' + m[8]; dec = 0; }
  const digits = core.replace(/[^\d]/g, '').replace(/^0+/, '');
  // Doubles hold 15-17 significant digits; converting a 16+ digit code would silently change it.
  if (digits.length > 15 && !/e/.test(core)) return null; // identifiers, card numbers: keep the text
  let v = Number(core);
  if (!Number.isFinite(v)) return null;
  if (neg) v = -v;
  if (pct) v /= 100;
  return { v, pct, cur, curAfter, dec, grouped, lead0: /^0\d/.test(m[1] || '') };
}

const TRUE_WORDS = new Set(['true', 'истина', 'істина', 'wahr', 'vrai', 'verdadero']);
const FALSE_WORDS = new Set(['false', 'ложь', 'хибність', 'falsch', 'faux', 'falso']);
export function parseBool(text) {
  const s = String(text).trim().toLowerCase();
  return TRUE_WORDS.has(s) ? true : FALSE_WORDS.has(s) ? false : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthOf = (w) => {
  const k = w.toLowerCase().slice(0, 3);
  const i = MONTHS.indexOf(k === 'sept' ? 'sep' : k);
  return i < 0 || (w.length > 3 && !/^(january|february|march|april|may|june|july|august|september|october|november|december|sept)\.?$/i.test(w)) ? -1 : i + 1;
};
const TIME = '(\\d{1,2}):(\\d{2})(?::(\\d{2})(?:[.,](\\d{1,6}))?)?\\s*([AaPp][Mm])?';
const RE_ISO = new RegExp(`^(\\d{4})([-/.])(\\d{1,2})\\2(\\d{1,2})(?:(?:T|\\s+)${TIME})?(?:Z|[+-]\\d{2}:?\\d{2})?$`);
const RE_NUM = new RegExp(`^(\\d{1,2})([-/.])(\\d{1,2})\\2(\\d{4}|\\d{2})(?:,?\\s+${TIME})?$`);
const RE_DMONY = new RegExp(`^(\\d{1,2})[ -]([A-Za-z]{3,9})\\.?[ -](\\d{4}|\\d{2})(?:,?\\s+${TIME})?$`);
const RE_MONDY = new RegExp(`^([A-Za-z]{3,9})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})(?:,?\\s+${TIME})?$`);
const RE_TIME = new RegExp(`^${TIME}$`);

const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
// Two-digit years pivot at 30 (00-29 -> 2000s), the window spreadsheets use.
const year2 = (y) => (y.length === 2 ? (+y < 30 ? 2000 + +y : 1900 + +y) : +y);

function timeParts(g, i) {
  if (g[i] == null) return { hh: 0, mm: 0, ss: 0, ms: 0, time: false, secs: false };
  let hh = +g[i];
  const mm = +g[i + 1], ss = g[i + 2] ? +g[i + 2] : 0;
  const ms = g[i + 3] ? Math.round(+('0.' + g[i + 3]) * 1000) : 0;
  const ap = g[i + 4] ? g[i + 4].toLowerCase() : '';
  if (ap) { if (hh < 1 || hh > 12) return null; hh = (hh % 12) + (ap === 'pm' ? 12 : 0); }
  if (hh > 23 || mm > 59 || ss > 59) return null;
  return { hh, mm, ss, ms, time: true, secs: g[i + 2] != null };
}

// Calendar validation (month length, leap years via Date.UTC day 0 of the next month) rejects 31.02 instead of
// letting Date roll it over to March.
function mk(y, m, d, t, style) {
  if (!t || m < 1 || m > 12 || d < 1 || y < 1000 || y > 9999 || d > daysIn(y, m)) return null;
  return { y, m, d, ...t, dateless: false, style };
}

export function parseDate(text, order = 'mdy') {
  const s = String(text).trim();
  if (s.length < 4 || s.length > 40) return null;
  let g;
  if ((g = RE_ISO.exec(s))) return mk(+g[1], +g[3], +g[4], timeParts(g, 5), g[2] === '-' ? 'iso' : 'ymd' + g[2]);
  if ((g = RE_NUM.exec(s))) {
    const a = +g[1], b = +g[3], y = year2(g[4]);
    const dmy = g[2] === '.' || order === 'dmy';
    return mk(y, dmy ? b : a, dmy ? a : b, timeParts(g, 5), (dmy ? 'dmy' : 'mdy') + g[2]);
  }
  if ((g = RE_DMONY.exec(s))) { const m = monthOf(g[2]); return m < 0 ? null : mk(year2(g[3]), m, +g[1], timeParts(g, 4), 'dmon'); }
  if ((g = RE_MONDY.exec(s))) { const m = monthOf(g[1]); return m < 0 ? null : mk(+g[3], m, +g[2], timeParts(g, 4), 'mond'); }
  if ((g = RE_TIME.exec(s))) {
    const t = timeParts(g, 1);
    return t ? { y: 0, m: 0, d: 0, ...t, dateless: true, style: 'time' } : null;
  }
  return null;
}

export function dateSerial(p) {
  const t = (p.hh * 3600 + p.mm * 60 + p.ss) / 86400 + p.ms / 86400000;
  if (p.dateless) return t;
  return dateToSerial(Date.UTC(p.y, p.m - 1, p.d)) + t;
}

const DATE_FMT = {
  iso: 'yyyy-mm-dd', 'ymd/': 'yyyy/mm/dd', 'ymd.': 'yyyy.mm.dd', 'dmy.': 'dd.mm.yyyy', 'dmy/': 'dd/mm/yyyy', 'dmy-': 'dd-mm-yyyy',
  'mdy/': 'm/d/yyyy', 'mdy-': 'm-d-yyyy', 'mdy.': 'mm.dd.yyyy', dmon: 'd mmm yyyy', mond: 'mmm d, yyyy',
};

function numberFormat(stats) {
  const dec = Math.min(stats.dec, 4);
  const frac = dec ? '.' + '0'.repeat(dec) : '';
  if (stats.pct) return '0' + frac + '%';
  if (stats.cur) return stats.curAfter ? `#,##0${frac}" ${stats.cur}"` : `"${stats.cur}"#,##0${frac}`;
  if (stats.grouped) return '#,##0' + frac;
  return 'General';
}

// Up to `max` values spread evenly over the column.
function spread(vals, max) {
  if (vals.length <= max) return vals;
  const out = [];
  const step = vals.length / max;
  for (let i = 0; i < max; i++) out.push(vals[Math.floor(i * step)]);
  return out;
}

// Booleans first (their words never parse as numbers), then numbers (the decimal mark explaining more values wins),
// then dates. Values with leading zeros ('007') veto the number type: they are codes, and numbers would drop the zeros.
// Day order is decided by the first value whose first or second part exceeds 12; '.' separators imply day-first.
export function detectColumn(values, { decimal, dateOrder = 'mdy', sample = 2000 } = {}) {
  const vals = [];
  for (const v of values) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) vals.push(s);
  }
  if (!vals.length) return { type: 'empty' };
  const S = spread(vals, sample);
  const need = Math.ceil(S.length * 0.95);
  const count = (fn) => { let n = 0; for (const s of S) if (fn(s)) n++; return n; };
  if (count((s) => parseBool(s) !== null) >= need) return { type: 'bool' };
  // Numbers: the decimal mark that explains more values wins; ties go to the hint.
  const dot = S.map((s) => parseNumber(s, '.'));
  const com = S.map((s) => parseNumber(s, ','));
  const nDot = dot.filter(Boolean).length, nCom = com.filter(Boolean).length;
  const dmark = nDot > nCom ? '.' : nCom > nDot ? ',' : decimal || '.';
  const parsed = dmark === '.' ? dot : com;
  const okN = parsed.filter(Boolean);
  if (okN.length >= need && !okN.some((p) => p.lead0)) {
    const stats = { dec: 0, pct: 0, cur: '', curAfter: false, grouped: false };
    let pct = 0;
    for (const p of okN) {
      stats.dec = Math.max(stats.dec, p.dec);
      if (p.pct) pct++;
      if (p.cur && !stats.cur) { stats.cur = p.cur; stats.curAfter = p.curAfter; }
      if (p.grouped) stats.grouped = true;
    }
    stats.pct = pct > okN.length / 2;
    if (!stats.cur && !stats.grouped && !stats.pct) stats.dec = 0;
    return { type: 'number', decimal: dmark, fmt: numberFormat(stats) };
  }
  // Dates: day-first vs month-first from values whose first or second part exceeds 12.
  let order = dateOrder;
  for (const s of S) {
    const g = RE_NUM.exec(s);
    if (!g || g[2] === '.') continue;
    if (+g[1] > 12) { order = 'dmy'; break; }
    if (+g[3] > 12) { order = 'mdy'; break; }
  }
  const dates = S.map((s) => parseDate(s, order));
  const okD = dates.filter(Boolean);
  if (okD.length >= need) {
    const timeOnly = okD.every((p) => p.dateless);
    const hasTime = okD.some((p) => p.time && (p.hh || p.mm || p.ss || p.dateless));
    const secs = okD.some((p) => p.secs && p.ss);
    const tf = secs ? 'hh:mm:ss' : 'hh:mm';
    const first = okD.find((p) => !p.dateless) || okD[0];
    let fmt = timeOnly ? (secs ? 'h:mm:ss' : 'h:mm') : DATE_FMT[first.style] || 'yyyy-mm-dd';
    if (!timeOnly && hasTime) fmt += ' ' + tf;
    return { type: 'date', order, fmt };
  }
  return { type: 'text' };
}

export function convertValue(text, info) {
  if (text == null) return null;
  const s = String(text);
  if (!s.trim()) return null;
  switch (info && info.type) {
    case 'number': { const p = parseNumber(s, info.decimal); return p ? p.v : s; }
    case 'bool': { const b = parseBool(s); return b === null ? s : b; }
    case 'date': { const p = parseDate(s, info.order); return p ? dateSerial(p) : s; }
    default: return s;
  }
}

export const convertColumn = (values, info) => values.map((v) => convertValue(v, info));

// One value typed by a user (Excel-like): numbers with the given decimal mark, percent, currency, dates, booleans.
export function inferValue(text, { decimal = '.', dateOrder = 'mdy' } = {}) {
  const s = String(text);
  const tr = s.trim();
  if (!tr) return { v: null };
  const n = parseNumber(tr, decimal);
  if (n) return { v: n.v, fmt: n.pct || n.cur || n.grouped ? numberFormat({ ...n, dec: n.dec }) : null };
  const b = parseBool(tr);
  if (b !== null && /^(true|false)$/i.test(tr)) return { v: b };
  const d = parseDate(tr, dateOrder);
  if (d) {
    const base = d.dateless ? (d.secs ? 'h:mm:ss' : 'h:mm') : DATE_FMT[d.style] || 'yyyy-mm-dd';
    return { v: dateSerial(d), fmt: !d.dateless && d.time ? base + (d.secs ? ' hh:mm:ss' : ' hh:mm') : base };
  }
  return { v: s };
}
