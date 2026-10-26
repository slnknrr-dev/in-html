// ledger/minor.js - money as integer minor units: the one place where a decimal amount becomes an integer and back,
// integer multiply-divide with an explicit rounding mode (exact through BigInt), and the largest-remainder allocation
// that splits a total by weights without losing a single minor unit. Exponents come from ISO 4217
// (../payments/money.js): GEL / USD / EUR have 2, JPY 0, KWD 3.
//
//   MONEY_MAX                               1e12 minor units: a typo with six extra zeros stops here, far below 2^53
//   ROUNDING                                'half-up' (half away from zero), 'half-even', 'floor', 'ceil', 'trunc'
//   cleanCurrency(v) -> 'GEL' | ''          three Latin letters, upper case
//   toMinor(v, cur?) -> integer             12.345 / '12,345' / ' 1 234.5 ' -> minor units; junk -> 0 (never NaN)
//   fromMinor(m, cur?) -> number            for display and for the decimal world only
//   moneyText(m, cur?, lang?) -> '1,234.56 GEL'
//   decimalText(m, cur?) -> '1234.56'       plain fixed notation (CSV)
//   mulDiv(a, b, d, mode?) -> integer       round(a * b / d) of integers, exact for any size
//   roundNumber(x, mode?) -> integer        rounding of a float (rates) with the same modes
//   allocate(total, weights) -> integers    largest remainder: the parts always sum to the total

//
// Why integers: binary floats cannot represent 0.1, so summing a month of 0.10 fees drifts and two reports of the
// same data disagree by a tetri. Integers add exactly up to 2^53; MONEY_MAX keeps every sum of a realistic journal
// far below that, so plain Number addition stays exact and BigInt is needed only inside multiplications (mulDiv).
// Junk input becomes 0, never NaN: one NaN would propagate through every total and blank a whole report.

import { fromMinor as isoFromMinor, minorUnits, toMinor as isoToMinor } from '../payments/money.js';

export { minorUnits };

export const MONEY_MAX = 1e12;
export const ROUNDING = ['half-up', 'half-even', 'floor', 'ceil', 'trunc'];

export const cleanCurrency = (v) => String(v ?? '').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);

const clamp = (m) => Math.max(-MONEY_MAX, Math.min(MONEY_MAX, m));

// Decimal text typed by a person: spaces and apostrophes group digits; with both '.' and ',' the last one is the
// decimal mark, a lone ',' is a decimal comma ('1234,56').
// Ambiguity accepted: '1,234' (one comma, three digits) reads as 1.234, not 1234 - the decimal-comma reading is the
// one that cannot silently multiply an amount by 1000 in ru/ka input. The strict final regex rejects anything else
// ('1.2.3', '12abc') rather than letting Number() or parseFloat() guess.
function decimalOf(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim().replace(/[\s  '’_]/g, '');
  if (!s) return NaN;
  const c = s.lastIndexOf(','), d = s.lastIndexOf('.');
  if (c >= 0 && d >= 0) s = c > d ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (c >= 0) s = s.replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  return Number(s);
}

// Decimal amount -> integer minor units, rounded half away from zero on the decimal digits (1.005 -> 101, not 100).
export function toMinor(v, cur = '') {
  const n = decimalOf(v);
  if (!Number.isFinite(n)) return 0;
  if (Math.abs(n) >= MONEY_MAX) return clamp(Math.sign(n) * MONEY_MAX);
  return clamp(isoToMinor(n, cur || 'XXX'));
}

export const fromMinor = (m, cur = '') => isoFromMinor(Math.trunc(Number(m)) || 0, cur || 'XXX');

// Intl.NumberFormat construction is expensive (locale data lookup), so formatters are memoised per locale and digit
// count; the cache is capped so arbitrary lang strings cannot grow it. A failed construction (unknown locale tag) is
// cached as null and falls back to toFixed.
const LOCALES = { en: 'en-US', ru: 'ru-RU', ka: 'ka-GE', he: 'he-IL', ar: 'ar', de: 'de-DE', fr: 'fr-FR', uk: 'uk-UA' };
const nfCache = new Map();

// '1,234.56 GEL' (en), '1 234,56 GEL' (ru, no-break space). The currency is its own argument: amounts of different
// currencies are never added up, and a function taking only a number would hide that mistake.
export function moneyText(m, cur = '', lang = 'en') {
  const c = cleanCurrency(cur);
  const digits = minorUnits(c || 'XXX');
  const l = String(lang || 'en');
  const loc = l.includes('-') ? l : LOCALES[l.slice(0, 2).toLowerCase()] || 'en-US';
  const key = loc + '|' + digits;
  let f = nfCache.get(key);
  if (f === undefined) {
    try { f = new Intl.NumberFormat(loc, { minimumFractionDigits: digits, maximumFractionDigits: digits }); } catch { f = null; }
    if (nfCache.size < 100) nfCache.set(key, f);
  }
  const v = fromMinor(m, c);
  const s = f ? f.format(v) : v.toFixed(digits);
  return c ? `${s} ${c}` : s;
}

// Plain fixed notation from the integer itself (no float formatting): -123456 GEL -> '-1234.56'.
export function decimalText(m, cur = '') {
  const d = minorUnits(cleanCurrency(cur) || 'XXX');
  const i = Math.trunc(Number(m)) || 0;
  const neg = i < 0;
  const s = String(Math.abs(i)).padStart(d + 1, '0');
  const out = d ? s.slice(0, -d) + '.' + s.slice(-d) : s;
  return (neg ? '-' : '') + out;
}

// Rounds a truncated magnitude quotient q (remainder r, divisor dd) given the sign of the true result. Because q is
// the magnitude, "floor" of a negative result means q + 1 (more negative), "ceil" of a negative means q. Half cases
// compare 2r with dd in integers - no 0.5 float ever appears.
function roundQ(q, r, dd, neg, mode) {
  if (!r) return q;
  switch (mode) {
    case 'floor': return neg ? q + 1n : q;
    case 'ceil': return neg ? q : q + 1n;
    case 'trunc': return q;
    case 'half-even': return 2n * r > dd || (2n * r === dd && q % 2n === 1n) ? q + 1n : q;
    default: return 2n * r >= dd ? q + 1n : q;
  }
}

// round(a * b / d) for integers with the given mode; exact (BigInt), so base * basis points never loses precision.
export function mulDiv(a, b, d, mode = 'half-up') {
  const D = BigInt(Math.trunc(Number(d)) || 0);
  if (D === 0n) throw new RangeError('mulDiv: division by zero');
  let p = BigInt(Math.trunc(Number(a)) || 0) * BigInt(Math.trunc(Number(b)) || 0);
  const neg = (p < 0n) !== (D < 0n) && p !== 0n;
  if (p < 0n) p = -p;
  const dd = D < 0n ? -D : D;
  const q = roundQ(p / dd, p % dd, dd, neg, mode);
  return Number(neg ? -q : q);
}

// A float (a converted amount) to an integer with the same modes. Six decimals are kept first, so 0.4999999999 from
// binary noise counts as 0.5.
export function roundNumber(x, mode = 'half-up') {
  const v = Number(x);
  if (!Number.isFinite(v)) return 0;
  const neg = v < 0;
  const a = Number(Math.abs(v).toFixed(6));
  const q = Math.floor(a), r = a - q;
  let out;
  switch (mode) {
    case 'floor': out = neg && r ? q + 1 : q; break;
    case 'ceil': out = !neg && r ? q + 1 : q; break;
    case 'trunc': out = q; break;
    case 'half-even': out = r > 0.5 || (r === 0.5 && q % 2 === 1) ? q + 1 : q; break;
    default: out = r >= 0.5 ? q + 1 : q;
  }
  return neg ? -out : out;
}

/**
 * Splits an integer total by weights with the largest-remainder method: every part is the floor of its exact share,
 * the units left over go to the largest fractional remainders (ties: the earlier weight). The parts always sum to the
 * total: 100.00 over three flats is 33.34 + 33.33 + 33.33, not 99.99. Weights <= 0 or junk count as 0; when all are 0
 * the total is split equally. A negative total is split as its absolute value and negated.
 */
// Implementation notes: shares are computed in floats (t * x / sum) - exact enough because only the floor and the
// ordering of remainders matter, and +1e-9 stops 33.999999999 from flooring to 33. That epsilon can push the floors'
// sum ABOVE the total, which the second loop repairs by taking units back from the smallest remainders (skipping
// parts already at 0). The stable tie-break by index makes the result deterministic across engines.
export function allocate(total, weights) {
  const t = Math.trunc(Number(total)) || 0;
  const n = (weights || []).length;
  if (!n) return [];
  if (t < 0) return allocate(-t, weights).map((x) => (x ? -x : 0));
  let w = weights.map((x) => (Number.isFinite(+x) && +x > 0 ? +x : 0));
  if (!w.some((x) => x > 0)) w = w.map(() => 1);
  const sum = w.reduce((a, b) => a + b, 0);
  const raw = w.map((x) => (t * x) / sum);
  const base = raw.map((x) => Math.floor(x + 1e-9));
  let left = t - base.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => ({ i, f: x - base[i] })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length, left--) base[order[k].i]++;
  for (let k = order.length - 1; left < 0; k = (k - 1 + order.length) % order.length) {
    if (base[order[k].i] > 0) { base[order[k].i]--; left++; }
  }
  return base;
}
