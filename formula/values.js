// formula/values.js - value model of the formula engine: references, coercion (number / text / boolean), comparison
// in spreadsheet order, criteria of COUNTIF-like functions and wildcard patterns.
//
// Values: number, string, boolean, null (blank), CellError (xlsx/cells.js), matrices (arrays of row arrays) and
// Ref (a rectangle of cells on a sheet, dereferenced by the engine).

import { CellError, ERR } from '../xlsx/cells.js';
import { parseDate, parseNumber, dateSerial } from '../csv/infer.js';

// A Ref is a lazy rectangle, not its values: functions like ROW, COLUMNS, OFFSET, INDEX and ISREF need the
// reference itself, and SUM over A:A must not materialize a million blanks before it knows it only needs the used
// part. The engine dereferences on demand. Coordinates are 0-based and inclusive.
export class Ref {
  constructor(s, r1, c1, r2, c2) {
    this.s = s; this.r1 = r1; this.c1 = c1; this.r2 = r2; this.c2 = c2;
  }
  get h() { return this.r2 - this.r1 + 1; }
  get w() { return this.c2 - this.c1 + 1; }
  get single() { return this.r1 === this.r2 && this.c1 === this.c2; }
}

export const isRef = (v) => v instanceof Ref;
export const isErr = (v) => v instanceof CellError;
export const isMatrix = (v) => Array.isArray(v);

// Text of a number as formulas produce it (15 significant digits, E notation outside 1e-9 .. 1e20).
// Spreadsheet number -> text rules: integers below 1e15 print exactly; others are rounded to 15 significant digits
// (the precision spreadsheets display and the limit of what a double reliably round-trips), then E notation with a
// two-digit signed exponent like "1.5E-10" outside the plain range. JS String() would print 0.1+0.2 as
// 0.30000000000000004 and switch to e-notation at different thresholds.
export function numToText(n) {
  if (!Number.isFinite(n)) return '#NUM!';
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const p = Number(n.toPrecision(15));
  const a = Math.abs(p);
  if (a !== 0 && (a < 1e-9 || a >= 1e21)) {
    const [m, e] = p.toExponential().split('e');
    return m + 'E' + (+e < 0 ? '-' : '+') + String(Math.abs(+e)).padStart(2, '0');
  }
  let s = String(p);
  if (/e/.test(s)) s = p.toFixed(Math.min(20, 15 - Math.floor(Math.log10(a)))).replace(/\.?0+$/, '');
  return s;
}

// Equality of numbers to 15 significant digits (0.1 + 0.2 = 0.3).
// All numeric equality and ordering goes through round15, so binary float noise below the 15th digit never makes
// =0.1+0.2=0.3 FALSE, as users expect from spreadsheets.
export const round15 = (n) => (n === 0 || !Number.isFinite(n) ? n : Number(n.toPrecision(15)));

// Text that looks like a number or a date coerces (spreadsheets treat "5" + 1 as 6 and "2024-01-31" as a date
// serial). Dates parse as month-day-year when ambiguous: the canonical formula language is en-US.
export function textToNumber(s) {
  const t = String(s).trim();
  if (!t) return null;
  const n = parseNumber(t, '.');
  if (n) return n.v;
  const d = parseDate(t, 'mdy');
  return d ? dateSerial(d) : null;
}

// Scalars only (callers dereference first).
// Coercions return a CellError instead of throwing: errors are values that propagate through formulas, and callers
// check isErr() at the point where an error must win.
export function toNumber(v) {
  if (typeof v === 'number') return v;
  if (v == null) return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof CellError) return v;
  if (typeof v === 'string') { const n = textToNumber(v); return n === null ? ERR.VALUE : n; }
  return ERR.VALUE;
}

export function toText(v) {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  if (typeof v === 'number') return numToText(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof CellError) return v;
  return String(v);
}

export function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (v == null) return false;
  if (typeof v === 'number') return v !== 0;
  if (v instanceof CellError) return v;
  const s = String(v).trim().toUpperCase();
  if (s === 'TRUE') return true;
  if (s === 'FALSE') return false;
  return ERR.VALUE;
}

// Type rank gives the cross-type order of sorting and comparison: numbers < text < booleans (< errors). Text compares
// case-insensitively with locale collation (accent-sensitive, so "é" != "e" while "A" == "a").
const RANK = (v) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : 3);
const collator = typeof Intl !== 'undefined' ? new Intl.Collator(undefined, { sensitivity: 'accent', numeric: false }) : null;
export const compareText = (a, b) => {
  const x = a.toLowerCase(), y = b.toLowerCase();
  if (x === y) return 0;
  return collator ? Math.sign(collator.compare(x, y)) || (x < y ? -1 : 1) : x < y ? -1 : 1;
};

// Spreadsheet order: numbers < text < booleans; blank compares as 0, '' or FALSE against the other side.
// A blank takes the type of the other operand (0, '' or FALSE), so =A1=0 and =A1="" are both TRUE for an empty A1.
export function compare(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b == null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  const ra = RANK(a), rb = RANK(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  if (ra === 0) { const x = round15(a), y = round15(b); return x < y ? -1 : x > y ? 1 : 0; }
  if (ra === 1) return compareText(a, b);
  if (ra === 2) return a === b ? 0 : a ? 1 : -1;
  return 0;
}

export function equals(a, b) {
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  return compare(a, b) === 0;
}

// '*' any run, '?' one character, '~' escapes; case-insensitive and anchored.
const wcCache = new Map();
// Translates spreadsheet wildcards to an anchored, case-insensitive RegExp; every other character is regex-escaped,
// so a criterion can never inject regex syntax. '~' escapes the next character (~* is a literal star). Compiled
// patterns are cached (bounded, cleared at 200) because COUNTIF evaluates one pattern against every cell.
export function wildcardRe(pattern) {
  let re = wcCache.get(pattern);
  if (re) return re;
  let s = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '~' && i + 1 < pattern.length) { s += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
    s += ch === '*' ? '[\\s\\S]*' : ch === '?' ? '[\\s\\S]' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  re = new RegExp('^' + s + '$', 'i');
  if (wcCache.size > 200) wcCache.clear();
  wcCache.set(pattern, re);
  return re;
}
export const hasWildcard = (s) => /[*?~]/.test(s);

const cmpOp = (op, c) => (op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0);

// Criteria of COUNTIF / SUMIF / ...: 5, ">5", "<>x", "a*", "", "<>", ">=2024-01-01" -> predicate(value).
// Compiles a COUNTIF-family criterion ONCE into a predicate applied to every cell. Semantics follow spreadsheets:
// an operator prefix (=, <>, <, >, <=, >=) on a number or date compares numerically and ignores text cells, except
// that "<>5" also matches text and blanks (anything that is not 5); "=" with a numeric criterion also matches
// numeric text; "" matches blanks; wildcards apply only to = and <> on text; ordering operators on text compare
// with collation.
export function makeCriteria(crit) {
  if (crit instanceof CellError) return (v) => v === crit;
  if (typeof crit === 'number') {
    const c = round15(crit);
    return (v) => (typeof v === 'number' ? round15(v) === c : typeof v === 'string' && textToNumber(v) === crit);
  }
  if (typeof crit === 'boolean') return (v) => v === crit;
  if (crit == null) return (v) => v == null || v === '';
  const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(String(crit));
  const op = m[1] || '=';
  const rest = m[2];
  let num = null;
  const pn = parseNumber(rest, '.');
  if (pn) num = pn.v;
  else { const d = parseDate(rest, 'mdy'); if (d) num = dateSerial(d); }
  const upper = rest.toUpperCase();
  const bool = upper === 'TRUE' ? true : upper === 'FALSE' ? false : null;
  if (num !== null) {
    const c = round15(num);
    const test = { '=': (x) => x === c, '<>': (x) => x !== c, '<': (x) => x < c, '>': (x) => x > c, '<=': (x) => x <= c, '>=': (x) => x >= c }[op];
    return (v) => {
      if (typeof v === 'number') return test(round15(v));
      if (op === '=' && typeof v === 'string') return textToNumber(v) === num;
      return op === '<>';
    };
  }
  if (bool !== null) {
    if (op === '=') return (v) => v === bool;
    if (op === '<>') return (v) => v !== bool;
    return (v) => typeof v === 'boolean' && cmpOp(op, compare(v, bool));
  }
  if (op === '=' || op === '<>') {
    let test;
    if (rest === '') test = (v) => v == null || v === '';
    else if (hasWildcard(rest)) { const re = wildcardRe(rest); test = (v) => typeof v === 'string' && re.test(v); }
    else { const lo = rest.toLowerCase(); test = (v) => typeof v === 'string' && v.toLowerCase() === lo; }
    return op === '=' ? test : (v) => !test(v);
  }
  return (v) => {
    if (typeof v !== 'string') return false;
    return cmpOp(op, compareText(v, rest));
  };
}
