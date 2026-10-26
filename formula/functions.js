// formula/functions.js - spreadsheet functions: math, aggregates, conditional aggregates (…IF / …IFS), statistics,
// logic, information, text and date / time. Lookup and dynamic-array functions are in formula/lookup.js.
// Importing the module registers the functions (formula/evaluate.js defineFunction).

import { CellError, ERR, localDateToSerial, serialParts, ymdToSerial } from '../xlsx/cells.js';
import { formatValue } from '../xlsx/numfmt.js';
import { parseDate, dateSerial, parseNumber } from '../csv/infer.js';
import { Ref, isErr, isMatrix, makeCriteria, round15, textToNumber, toBool, toNumber, toText, wildcardRe } from './values.js';
import { FUNCTIONS, VOLATILE, broadcast, defineFunction, deref, eachValue, first, lift, numbers, numbersA, toMatrix } from './evaluate.js';

// def: scalar functions through lift() (coercion + array lifting for free); raw: functions that need Refs, ranges or
// custom argument handling. alias: one implementation under a legacy and a modern name (STDEV / STDEV.S).
const def = (name, sig, impl, extra = {}) => defineFunction(name, { fn: lift(sig, impl), ...extra });
const raw = (name, fn, extra = {}) => defineFunction(name, { fn, ...extra });
const alias = (name, to) => FUNCTIONS.set(name, FUNCTIONS.get(to));
const num = (r) => (Number.isFinite(r) ? r : ERR.NUM);

// --- rounding ----------------------------------------------------------------------------

// Decimal shifting through the exponent avoids binary artefacts (ROUND(2.675, 2) = 2.68 as in spreadsheets).
function shift(x, d) {
  const s = String(x);
  if (/e/i.test(s) || d > 300 || d < -300) return x * 10 ** d;
  return Number(s + 'e' + d);
}
// Rounds the magnitude and restores the sign (half away from zero, Excel's ROUND), with round15 before and after
// the shift so that 2.675 (binary 2.67499999...) is treated as the decimal the user typed.
function roundWith(n, d, mode) {
  d = Math.trunc(d);
  const a = round15(Math.abs(n));
  const sh = round15(shift(a, d));
  const r = mode === 'up' ? Math.ceil(sh) : mode === 'down' ? Math.floor(sh) : Math.round(sh);
  const back = shift(r, -d);
  return Math.sign(n) * (Number.isFinite(back) ? back : r / 10 ** d);
}

// --- aggregates --------------------------------------------------------------------------

const sum = (a) => { let s = 0; for (const x of a) s += x; return s; };
const mean = (a) => sum(a) / a.length;
function variance(a, sample) {
  const n = a.length;
  if (n < (sample ? 2 : 1)) return ERR.DIV0;
  const m = mean(a);
  let s = 0;
  for (const x of a) s += (x - m) * (x - m);
  return s / (sample ? n - 1 : n);
}
// Float64Array.sort is numeric (Array.prototype.sort would compare as strings: 10 < 9).
// percentileInc: linear interpolation at rank (n-1)k (PERCENTILE.INC); percentileExc at (n+1)k-1, undefined at the
// extremes (#NUM!), matching Excel.
const sorted = (a) => Float64Array.from(a).sort();
function percentileInc(a, k) {
  if (!a.length || k < 0 || k > 1) return ERR.NUM;
  const s = sorted(a);
  const h = (s.length - 1) * k;
  const lo = Math.floor(h);
  return lo + 1 < s.length ? s[lo] + (h - lo) * (s[lo + 1] - s[lo]) : s[lo];
}
function percentileExc(a, k) {
  const n = a.length;
  if (!n || k <= 0 || k >= 1) return ERR.NUM;
  const h = (n + 1) * k - 1;
  if (h < 0 || h > n - 1) return ERR.NUM;
  const s = sorted(a);
  const lo = Math.floor(h);
  return lo + 1 < n ? s[lo] + (h - lo) * (s[lo + 1] - s[lo]) : s[lo];
}

const agg = (name, fn, opts) => raw(name, (args, ctx) => {
  const a = numbers(args, ctx, opts);
  return a instanceof CellError ? a : fn(a);
}, { min: 1 });
const aggA = (name, fn) => raw(name, (args, ctx) => {
  const a = numbersA(args, ctx);
  return a instanceof CellError ? a : fn(a);
}, { min: 1 });

agg('SUM', (a) => sum(a));
agg('PRODUCT', (a) => (a.length ? a.reduce((p, x) => p * x, 1) : 0));
agg('AVERAGE', (a) => (a.length ? mean(a) : ERR.DIV0));
aggA('AVERAGEA', (a) => (a.length ? mean(a) : ERR.DIV0));
agg('MIN', (a) => (a.length ? Math.min(...a) : 0));
agg('MAX', (a) => (a.length ? Math.max(...a) : 0));
aggA('MINA', (a) => (a.length ? Math.min(...a) : 0));
aggA('MAXA', (a) => (a.length ? Math.max(...a) : 0));
agg('SUMSQ', (a) => sum(a.map((x) => x * x)));
agg('MEDIAN', (a) => {
  if (!a.length) return ERR.NUM;
  const s = sorted(a), h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
});
agg('MODE', (a) => {
  const f = new Map();
  let max = 1;
  for (const x of a) { const c = (f.get(x) || 0) + 1; f.set(x, c); if (c > max) max = c; }
  if (max < 2) return ERR.NA;
  return a.find((x) => f.get(x) === max);
});
alias('MODE.SNGL', 'MODE');
agg('VAR', (a) => variance(a, true));
agg('VARP', (a) => variance(a, false));
agg('STDEV', (a) => { const v = variance(a, true); return isErr(v) ? v : Math.sqrt(v); });
agg('STDEVP', (a) => { const v = variance(a, false); return isErr(v) ? v : Math.sqrt(v); });
alias('VAR.S', 'VAR'); alias('VAR.P', 'VARP'); alias('STDEV.S', 'STDEV'); alias('STDEV.P', 'STDEVP');
agg('AVEDEV', (a) => { if (!a.length) return ERR.NUM; const m = mean(a); return mean(a.map((x) => Math.abs(x - m))); });
agg('GEOMEAN', (a) => (!a.length || a.some((x) => x <= 0) ? ERR.NUM : Math.exp(mean(a.map(Math.log)))));
agg('HARMEAN', (a) => (!a.length || a.some((x) => x <= 0) ? ERR.NUM : a.length / sum(a.map((x) => 1 / x))));
agg('DEVSQ', (a) => { const m = a.length ? mean(a) : 0; return sum(a.map((x) => (x - m) ** 2)); });

raw('COUNT', (args, ctx) => {
  let n = 0;
  eachValue(args, ctx, (v, fromRange) => {
    if (typeof v === 'number') n++;
    else if (!fromRange && (typeof v === 'boolean' || (typeof v === 'string' && textToNumber(v) !== null))) n++;
  });
  return n;
}, { min: 1 });
raw('COUNTA', (args, ctx) => {
  let n = 0;
  eachValue(args, ctx, (v, fromRange) => { if (v != null || !fromRange) n++; });
  return n;
}, { min: 1 });
raw('COUNTBLANK', (args, ctx) => {
  let n = 0;
  eachValue(args, ctx, (v) => { if (v == null || v === '') n++; });
  return n;
}, { min: 1, max: 1 });

// k-th largest / smallest
const kth = (largest) => (args, ctx) => {
  const a = numbers([args[0]], ctx);
  if (a instanceof CellError) return a;
  const kv = deref(args[1], ctx);
  const one = (k) => {
    const n = toNumber(k);
    if (n instanceof CellError) return n;
    const i = Math.ceil(n);
    if (i < 1 || i > a.length) return ERR.NUM;
    const s = sorted(a);
    return largest ? s[s.length - i] : s[i - 1];
  };
  return isMatrix(kv) ? broadcast([kv], (xs) => one(xs[0])) : one(kv);
};
raw('LARGE', kth(true), { min: 2, max: 2 });
raw('SMALL', kth(false), { min: 2, max: 2 });

const pct = (fn) => (args, ctx) => {
  const a = numbers([args[0]], ctx);
  if (a instanceof CellError) return a;
  const k = toNumber(first(deref(args[1], ctx), ctx));
  return k instanceof CellError ? k : fn(a, k);
};
raw('PERCENTILE', pct(percentileInc), { min: 2, max: 2 });
alias('PERCENTILE.INC', 'PERCENTILE');
raw('PERCENTILE.EXC', pct(percentileExc), { min: 2, max: 2 });
raw('QUARTILE', pct((a, q) => (q < 0 || q > 4 ? ERR.NUM : percentileInc(a, Math.trunc(q) / 4))), { min: 2, max: 2 });
alias('QUARTILE.INC', 'QUARTILE');
raw('RANK', (args, ctx) => {
  const x = toNumber(first(deref(args[0], ctx), ctx));
  if (x instanceof CellError) return x;
  const a = numbers([args[1]], ctx);
  if (a instanceof CellError) return a;
  const asc = args[2] != null && toNumber(first(deref(args[2], ctx), ctx)) !== 0;
  if (!a.some((v) => round15(v) === round15(x))) return ERR.NA;
  return 1 + a.filter((v) => (asc ? v < x : v > x)).length;
}, { min: 2, max: 3 });
alias('RANK.EQ', 'RANK');
raw('CORREL', (args, ctx) => {
  const A = toMatrix(args[0], ctx).flat(), B = toMatrix(args[1], ctx).flat();
  if (A.length !== B.length) return ERR.NA;
  const xs = [], ys = [];
  for (let i = 0; i < A.length; i++) {
    if (isErr(A[i])) return A[i];
    if (isErr(B[i])) return B[i];
    if (typeof A[i] === 'number' && typeof B[i] === 'number') { xs.push(A[i]); ys.push(B[i]); }
  }
  if (xs.length < 2) return ERR.DIV0;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : ERR.DIV0;
}, { min: 2, max: 2 });

raw('SUMPRODUCT', (args, ctx) => {
  const ms = args.map((a) => toMatrix(a, ctx));
  const h = ms[0].length, w = ms[0][0] ? ms[0][0].length : 0;
  if (ms.some((m) => m.length !== h || (m[0] ? m[0].length : 0) !== w)) return ERR.VALUE;
  let s = 0;
  for (let i = 0; i < h; i++) {
    for (let j = 0; j < w; j++) {
      let p = 1;
      for (const m of ms) {
        const v = m[i][j];
        if (v instanceof CellError) return v;
        p *= typeof v === 'number' ? v : 0;
      }
      s += p;
    }
  }
  return s;
}, { min: 1 });

// --- conditional aggregates --------------------------------------------------------------

// Range of `like`'s shape anchored at `r`'s top-left (SUMIF's sum_range rule).
// Excel quirk reproduced: SUMIF's sum_range is resized to the criteria range's shape from its top-left cell, so
// SUMIF(A1:A10, ">0", B1) sums B1:B10.
function sameShape(r, like, ctx) {
  if (r instanceof Ref && like instanceof Ref) return toMatrix(new Ref(r.s, r.r1, r.c1, r.r1 + like.h - 1, r.c1 + like.w - 1), ctx);
  return toMatrix(r, ctx);
}

// Indexes [i, j] of cells meeting all (range, criteria) pairs, or a CellError.
// Criteria are compiled once per pair (makeCriteria), then every cell index is tested against all pairs; all ranges
// must have equal shape (…IFS functions return #VALUE! otherwise). Indices are returned as a flat [i, j, ...] list.
function matching(pairs, ctx) {
  const mats = [];
  for (const [rg, crit] of pairs) {
    const m = toMatrix(rg, ctx);
    const c = first(deref(crit, ctx), ctx);
    mats.push([m, makeCriteria(c)]);
  }
  const h = mats[0][0].length, w = mats[0][0][0] ? mats[0][0][0].length : 0;
  if (mats.some(([m]) => m.length !== h || (m[0] ? m[0].length : 0) !== w)) return ERR.VALUE;
  const out = [];
  for (let i = 0; i < h; i++) {
    for (let j = 0; j < w; j++) {
      let ok = true;
      for (const [m, test] of mats) if (!test(m[i][j])) { ok = false; break; }
      if (ok) out.push(i, j);
    }
  }
  return out;
}

const pairsOf = (args, from) => {
  const p = [];
  for (let i = from; i + 1 < args.length; i += 2) p.push([args[i], args[i + 1]]);
  return p;
};

function pickNums(m, idx) {
  const out = [];
  for (let k = 0; k < idx.length; k += 2) {
    const v = m[idx[k]] ? m[idx[k]][idx[k + 1]] : null;
    if (v instanceof CellError) return v;
    if (typeof v === 'number') out.push(v);
  }
  return out;
}

const ifAgg = (fn) => (args, ctx) => {
  const idx = matching([[args[0], args[1]]], ctx);
  if (idx instanceof CellError) return idx;
  const target = args[2] != null && args.length > 2 ? sameShape(args[2], args[0], ctx) : toMatrix(args[0], ctx);
  const a = pickNums(target, idx);
  return a instanceof CellError ? a : fn(a);
};
const ifsAgg = (fn) => (args, ctx) => {
  if (args.length % 2 === 0) return ERR.VALUE;
  const idx = matching(pairsOf(args, 1), ctx);
  if (idx instanceof CellError) return idx;
  const target = toMatrix(args[0], ctx);
  if (target.length !== toMatrix(args[1], ctx).length) return ERR.VALUE;
  const a = pickNums(target, idx);
  return a instanceof CellError ? a : fn(a);
};
raw('COUNTIF', (args, ctx) => { const idx = matching([[args[0], args[1]]], ctx); return idx instanceof CellError ? idx : idx.length / 2; }, { min: 2, max: 2 });
raw('COUNTIFS', (args, ctx) => {
  if (args.length % 2) return ERR.VALUE;
  const idx = matching(pairsOf(args, 0), ctx);
  return idx instanceof CellError ? idx : idx.length / 2;
}, { min: 2 });
raw('SUMIF', ifAgg(sum), { min: 2, max: 3 });
raw('SUMIFS', ifsAgg(sum), { min: 3 });
raw('AVERAGEIF', ifAgg((a) => (a.length ? mean(a) : ERR.DIV0)), { min: 2, max: 3 });
raw('AVERAGEIFS', ifsAgg((a) => (a.length ? mean(a) : ERR.DIV0)), { min: 3 });
raw('MAXIFS', ifsAgg((a) => (a.length ? Math.max(...a) : 0)), { min: 3 });
raw('MINIFS', ifsAgg((a) => (a.length ? Math.min(...a) : 0)), { min: 3 });

// --- math --------------------------------------------------------------------------------

def('ABS', 'n', Math.abs);
def('SIGN', 'n', Math.sign);
def('INT', 'n', Math.floor);
def('TRUNC', 'nn?', (n, d = 0) => roundWith(n, d, 'down'));
def('ROUND', 'nn', (n, d) => num(roundWith(n, d, 'half')));
def('ROUNDUP', 'nn', (n, d) => num(roundWith(n, d, 'up')));
def('ROUNDDOWN', 'nn', (n, d) => num(roundWith(n, d, 'down')));
def('MROUND', 'nn', (n, m) => (m === 0 ? 0 : n * m < 0 ? ERR.NUM : roundWith(n / m, 0, 'half') * m));
def('CEILING', 'nn?', (n, s = 1) => (s === 0 ? 0 : n > 0 && s < 0 ? ERR.NUM : Math.ceil(round15(n / s)) * s));
def('FLOOR', 'nn?', (n, s = 1) => (s === 0 ? ERR.DIV0 : n > 0 && s < 0 ? ERR.NUM : Math.floor(round15(n / s)) * s));
def('CEILING.MATH', 'nn?n?', (n, s = 1, mode = 0) => {
  s = Math.abs(s) || 1;
  return n < 0 && mode ? -Math.ceil(round15(-n / s)) * s : Math.ceil(round15(n / s)) * s;
});
def('FLOOR.MATH', 'nn?n?', (n, s = 1, mode = 0) => {
  s = Math.abs(s) || 1;
  return n < 0 && mode ? -Math.floor(round15(-n / s)) * s : Math.floor(round15(n / s)) * s;
});
def('MOD', 'nn', (n, d) => (d === 0 ? ERR.DIV0 : round15(n - d * Math.floor(n / d))));
def('QUOTIENT', 'nn', (n, d) => (d === 0 ? ERR.DIV0 : Math.trunc(n / d)));
def('POWER', 'nn', (a, b) => (a === 0 && b === 0 ? ERR.NUM : a === 0 && b < 0 ? ERR.DIV0 : num(a ** b)));
def('SQRT', 'n', (n) => (n < 0 ? ERR.NUM : Math.sqrt(n)));
def('EXP', 'n', (n) => num(Math.exp(n)));
def('LN', 'n', (n) => (n <= 0 ? ERR.NUM : Math.log(n)));
def('LOG10', 'n', (n) => (n <= 0 ? ERR.NUM : Math.log10(n)));
def('LOG', 'nn?', (n, b = 10) => (n <= 0 || b <= 0 ? ERR.NUM : b === 1 ? ERR.DIV0 : Math.log(n) / Math.log(b)));
def('PI', '', () => Math.PI);
def('SIN', 'n', Math.sin); def('COS', 'n', Math.cos); def('TAN', 'n', Math.tan);
def('ASIN', 'n', (n) => (Math.abs(n) > 1 ? ERR.NUM : Math.asin(n)));
def('ACOS', 'n', (n) => (Math.abs(n) > 1 ? ERR.NUM : Math.acos(n)));
def('ATAN', 'n', Math.atan);
def('ATAN2', 'nn', (x, y) => (x === 0 && y === 0 ? ERR.DIV0 : Math.atan2(y, x)));
def('DEGREES', 'n', (n) => (n * 180) / Math.PI);
def('RADIANS', 'n', (n) => (n * Math.PI) / 180);
def('EVEN', 'n', (n) => { const a = Math.ceil(Math.abs(n) / 2) * 2; return n < 0 ? -a : a; });
def('ODD', 'n', (n) => { let a = Math.ceil(Math.abs(n)); if (a % 2 === 0) a += 1; return n < 0 ? -a : a; });
def('FACT', 'n', (n) => { if (n < 0) return ERR.NUM; let f = 1; for (let i = 2; i <= Math.trunc(n); i++) f *= i; return num(f); });
const gcd2 = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
agg('GCD', (a) => (a.some((x) => x < 0) ? ERR.NUM : a.map(Math.trunc).reduce(gcd2, 0)));
agg('LCM', (a) => (a.some((x) => x < 0) ? ERR.NUM : a.map(Math.trunc).reduce((p, x) => (p === 0 || x === 0 ? 0 : (p * x) / gcd2(p, x)), 1)));
raw('RAND', (args, ctx) => ctx.random(), { min: 0, max: 0, volatile: true });
def('RANDBETWEEN', 'nn', (a, b) => (Math.ceil(a) > Math.floor(b) ? ERR.NUM : Math.ceil(a) + Math.floor(Math.random() * (Math.floor(b) - Math.ceil(a) + 1))), { volatile: true });
VOLATILE.add('RAND').add('RANDBETWEEN');

// --- logic -------------------------------------------------------------------------------

raw('IF', (args, ctx, ev) => {
  const c = deref(ev(args[0]), ctx);
  if (isMatrix(c)) {
    const t = deref(args[1] ? ev(args[1]) : 0, ctx);
    const f = deref(args[2] ? ev(args[2]) : false, ctx);
    return broadcast([c, t, f], ([x, y, z]) => { const b = toBool(x); return b instanceof CellError ? b : b ? y : z; });
  }
  const b = toBool(c);
  if (b instanceof CellError) return b;
  return b ? ev(args[1]) : args.length > 2 ? ev(args[2]) : false;
}, { lazy: true, min: 2, max: 3 });
raw('IFS', (args, ctx, ev) => {
  if (args.length % 2) return ERR.VALUE;
  for (let i = 0; i < args.length; i += 2) {
    const b = toBool(first(deref(ev(args[i]), ctx), ctx));
    if (b instanceof CellError) return b;
    if (b) return ev(args[i + 1]);
  }
  return ERR.NA;
}, { lazy: true, min: 2 });
const onError = (test) => (args, ctx, ev) => {
  const v = ev(args[0]);
  const d = deref(v, ctx);
  if (isMatrix(d)) {
    const alt = deref(ev(args[1]), ctx);
    return broadcast([d, alt], ([x, y]) => (test(x) ? (y ?? 0) : x));
  }
  return test(d) ? ev(args[1]) : v;
};
raw('IFERROR', onError((x) => x instanceof CellError), { lazy: true, min: 2, max: 2 });
raw('IFNA', onError((x) => x === ERR.NA), { lazy: true, min: 2, max: 2 });
const logic = (fn) => (args, ctx) => {
  const bs = [];
  let err = null;
  eachValue(args, ctx, (v, fromRange) => {
    if (v instanceof CellError) { err = v; return false; }
    if (v == null || (fromRange && typeof v === 'string')) return undefined;
    const b = toBool(v);
    if (b instanceof CellError) { err = b; return false; }
    bs.push(b);
    return undefined;
  });
  if (err) return err;
  return bs.length ? fn(bs) : ERR.VALUE;
};
raw('AND', logic((b) => b.every(Boolean)), { min: 1 });
raw('OR', logic((b) => b.some(Boolean)), { min: 1 });
raw('XOR', logic((b) => b.filter(Boolean).length % 2 === 1), { min: 1 });
def('NOT', 'b', (b) => !b);
def('TRUE', '', () => true);
def('FALSE', '', () => false);
raw('SWITCH', (args, ctx, ev) => {
  const x = first(deref(ev(args[0]), ctx), ctx);
  if (x instanceof CellError) return x;
  let i = 1;
  for (; i + 1 < args.length; i += 2) {
    const v = first(deref(ev(args[i]), ctx), ctx);
    if (v instanceof CellError) return v;
    if ((typeof x === 'string' && typeof v === 'string') ? x.toLowerCase() === v.toLowerCase() : x === v) return ev(args[i + 1]);
  }
  return i < args.length ? ev(args[i]) : ERR.NA;
}, { lazy: true, min: 3 });
raw('CHOOSE', (args, ctx, ev) => {
  const k = deref(ev(args[0]), ctx);
  const one = (x) => {
    const n = toNumber(x);
    if (n instanceof CellError) return n;
    const i = Math.trunc(n);
    return i < 1 || i >= args.length ? ERR.VALUE : ev(args[i]);
  };
  if (isMatrix(k)) return broadcast([k], ([x]) => { const r = deref(one(x), ctx); return isMatrix(r) ? r[0][0] : r; });
  return one(k);
}, { lazy: true, min: 2 });

// --- information -------------------------------------------------------------------------

def('ISBLANK', 'e', (v) => v == null);
def('ISNUMBER', 'e', (v) => typeof v === 'number');
def('ISTEXT', 'e', (v) => typeof v === 'string');
def('ISNONTEXT', 'e', (v) => typeof v !== 'string');
def('ISLOGICAL', 'e', (v) => typeof v === 'boolean');
def('ISERROR', 'e', (v) => v instanceof CellError);
def('ISERR', 'e', (v) => v instanceof CellError && v !== ERR.NA);
def('ISNA', 'e', (v) => v === ERR.NA);
def('ISEVEN', 'n', (n) => Math.trunc(n) % 2 === 0);
def('ISODD', 'n', (n) => Math.abs(Math.trunc(n)) % 2 === 1);
raw('ISREF', (args) => args[0] instanceof Ref, { min: 1, max: 1 });
def('NA', '', () => ERR.NA);
def('ERROR.TYPE', 'e', (v) => {
  const i = ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A', '#GETTING_DATA', '#SPILL!', '#CALC!'].indexOf(v instanceof CellError ? v.code : '');
  return i < 0 ? ERR.NA : i + 1;
});
def('N', 'e', (v) => (typeof v === 'number' ? v : typeof v === 'boolean' ? +v : v instanceof CellError ? v : 0));
def('T', 'e', (v) => (typeof v === 'string' ? v : v instanceof CellError ? v : ''));
def('TYPE', 'a', (m) => {
  if (m.length > 1 || m[0].length > 1) return 64;
  const v = m[0][0];
  return typeof v === 'number' || v == null ? 1 : typeof v === 'string' ? 2 : typeof v === 'boolean' ? 4 : 16;
});
raw('ROW', (args, ctx) => (args.length ? (args[0] instanceof Ref ? args[0].r1 + 1 : ERR.VALUE) : ctx.r + 1), { min: 0, max: 1 });
raw('COLUMN', (args, ctx) => (args.length ? (args[0] instanceof Ref ? args[0].c1 + 1 : ERR.VALUE) : ctx.c + 1), { min: 0, max: 1 });
raw('ROWS', (args, ctx) => (args[0] instanceof Ref ? args[0].h : isMatrix(args[0]) ? args[0].length : args[0] instanceof CellError ? args[0] : 1), { min: 1, max: 1 });
raw('COLUMNS', (args, ctx) => (args[0] instanceof Ref ? args[0].w : isMatrix(args[0]) ? args[0][0].length : args[0] instanceof CellError ? args[0] : 1), { min: 1, max: 1 });

// --- text --------------------------------------------------------------------------------

// 32767 characters is the spreadsheet cell text limit; text results beyond it are #VALUE! instead of silently
// producing cells other applications cannot open.
const MAXLEN = 32767;
const cap = (s) => (s.length > MAXLEN ? ERR.VALUE : s);
def('LEN', 's', (s) => s.length);
def('LEFT', 'sn?', (s, n = 1) => (n < 0 ? ERR.VALUE : s.slice(0, Math.trunc(n))));
def('RIGHT', 'sn?', (s, n = 1) => (n < 0 ? ERR.VALUE : Math.trunc(n) === 0 ? '' : s.slice(-Math.trunc(n))));
def('MID', 'snn', (s, a, n) => (a < 1 || n < 0 ? ERR.VALUE : s.substr(Math.trunc(a) - 1, Math.trunc(n))));
def('UPPER', 's', (s) => s.toUpperCase());
def('LOWER', 's', (s) => s.toLowerCase());
def('PROPER', 's', (s) => s.toLowerCase().replace(/(^|[^\p{L}\p{N}'])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()));
def('TRIM', 's', (s) => s.replace(/^ +| +$/g, '').replace(/ {2,}/g, ' '));
def('CLEAN', 's', (s) => s.replace(/[\u0000-\u001f]/g, ''));
raw('CONCAT', (args, ctx) => {
  let out = '';
  let err = null;
  eachValue(args, ctx, (v) => { if (v instanceof CellError) { err = v; return false; } out += toText(v); return undefined; });
  return err || cap(out);
}, { min: 1 });
def('CONCATENATE', 's*', (...a) => cap(a.join('')));
raw('TEXTJOIN', (args, ctx) => {
  const d = toText(first(deref(args[0], ctx), ctx));
  if (d instanceof CellError) return d;
  const ign = toBool(first(deref(args[1], ctx), ctx));
  if (ign instanceof CellError) return ign;
  const parts = [];
  let err = null;
  eachValue(args.slice(2), ctx, (v) => {
    if (v instanceof CellError) { err = v; return false; }
    const s = toText(v);
    if (!(ign && s === '')) parts.push(s);
    return undefined;
  });
  return err || cap(parts.join(d));
}, { min: 3 });
def('SUBSTITUTE', 'sssn?', (s, a, b, k) => {
  if (!a) return s;
  if (k === undefined) return cap(s.split(a).join(b));
  if (k < 1) return ERR.VALUE;
  let at = -1;
  for (let i = 0; i < Math.trunc(k); i++) { at = s.indexOf(a, at + 1); if (at < 0) return s; }
  return cap(s.slice(0, at) + b + s.slice(at + a.length));
});
def('REPLACE', 'snns', (s, a, n, t) => (a < 1 || n < 0 ? ERR.VALUE : cap(s.slice(0, Math.trunc(a) - 1) + t + s.slice(Math.trunc(a) - 1 + Math.trunc(n)))));
def('FIND', 'ssn?', (f, s, a = 1) => {
  if (a < 1 || a > s.length + 1) return ERR.VALUE;
  const i = s.indexOf(f, Math.trunc(a) - 1);
  return i < 0 ? ERR.VALUE : i + 1;
});
def('SEARCH', 'ssn?', (f, s, a = 1) => {
  if (a < 1 || a > s.length + 1) return ERR.VALUE;
  const src = wildcardRe(f).source.slice(1, -1);
  const m = new RegExp(src, 'i').exec(s.slice(Math.trunc(a) - 1));
  return m ? m.index + Math.trunc(a) : ERR.VALUE;
});
def('VALUE', 'v', (v) => (typeof v === 'number' ? v : typeof v === 'boolean' ? ERR.VALUE : (textToNumber(toText(v)) ?? ERR.VALUE)));
def('NUMBERVALUE', 'ss?s?', (s, dec = '.', grp = ',') => {
  let t = s.replace(/\s/g, '');
  if (grp) t = t.split(grp[0]).join('');
  if (dec && dec[0] !== '.') t = t.replace(dec[0], '.');
  const p = parseNumber(t, '.');
  return p ? p.v : ERR.VALUE;
});
def('TEXT', 'vs', (v, f) => {
  const x = typeof v === 'string' ? (textToNumber(v) ?? v) : v;
  return formatValue(x, f);
});
def('FIXED', 'nn?b?', (n, d = 2, noCommas = false) => {
  const r = roundWith(n, d, 'half');
  const code = (noCommas ? '0' : '#,##0') + (d > 0 ? '.' + '0'.repeat(Math.min(Math.trunc(d), 127)) : '');
  return formatValue(r, code);
});
def('REPT', 'sn', (s, n) => (n < 0 || s.length * Math.trunc(n) > MAXLEN ? ERR.VALUE : s.repeat(Math.trunc(n))));
def('EXACT', 'ss', (a, b) => a === b);
def('CHAR', 'n', (n) => (n < 1 || n > 255 ? ERR.VALUE : String.fromCharCode(Math.trunc(n))));
def('CODE', 's', (s) => (s ? s.charCodeAt(0) : ERR.VALUE));
def('UNICHAR', 'n', (n) => (n < 1 || n > 0x10ffff ? ERR.VALUE : String.fromCodePoint(Math.trunc(n))));
def('UNICODE', 's', (s) => (s ? s.codePointAt(0) : ERR.VALUE));
const nth = (s, d, k, after) => {
  if (!d) return ERR.VALUE;
  if (k === 0) return ERR.VALUE;
  let at = -1;
  if (k > 0) {
    for (let i = 0; i < k; i++) { at = s.indexOf(d, at < 0 ? 0 : at + d.length); if (at < 0) return ERR.NA; }
  } else {
    at = s.length;
    for (let i = 0; i < -k; i++) { at = s.lastIndexOf(d, at - 1); if (at < 0) return ERR.NA; }
  }
  return after ? s.slice(at + d.length) : s.slice(0, at);
};
def('TEXTBEFORE', 'ssn?', (s, d, k = 1) => nth(s, d, Math.trunc(k), false));
def('TEXTAFTER', 'ssn?', (s, d, k = 1) => nth(s, d, Math.trunc(k), true));
raw('TEXTSPLIT', (args, ctx) => {
  const s = toText(first(deref(args[0], ctx), ctx));
  const cd = args[1] != null ? toText(first(deref(args[1], ctx), ctx)) : '';
  const rd = args[2] != null ? toText(first(deref(args[2], ctx), ctx)) : '';
  for (const x of [s, cd, rd]) if (x instanceof CellError) return x;
  const rows = (rd ? s.split(rd) : [s]).map((r) => (cd ? r.split(cd) : [r]));
  const w = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => Array.from({ length: w }, (_, i) => (i < r.length ? r[i] : ERR.NA)));
}, { min: 2, max: 3 });

// --- dates and times ---------------------------------------------------------------------

const P = (n) => serialParts(n);
// Date serials: day numbers since 1899-12-30 (the 1900 system with the Lotus leap-year bug handled in xlsx/cells.js),
// fractional part = time of day. 2958465 is 9999-12-31, the last valid date.
const dateArg = (n) => (n < 0 || n > 2958465.99999 ? ERR.NUM : null);
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

def('DATE', 'nnn', (y, m, d) => {
  if (y < 0 || y >= 10000) return ERR.NUM;
  const s = ymdToSerial(y, m, d);
  return s < 0 ? ERR.NUM : s;
});
def('TIME', 'nnn', (h, m, s) => {
  const t = Math.trunc(h) * 3600 + Math.trunc(m) * 60 + Math.trunc(s);
  return t < 0 ? ERR.NUM : (t % 86400) / 86400;
});
raw('TODAY', (args, ctx) => Math.floor(localDateToSerial(ctx.now())), { min: 0, max: 0, volatile: true });
raw('NOW', (args, ctx) => localDateToSerial(ctx.now()), { min: 0, max: 0, volatile: true });
VOLATILE.add('TODAY').add('NOW');
const part = (k) => (n) => dateArg(n) || P(n)[k];
def('YEAR', 'n', part('y'));
def('MONTH', 'n', part('m'));
def('DAY', 'n', part('d'));
def('HOUR', 'n', part('hh'));
def('MINUTE', 'n', part('mm'));
def('SECOND', 'n', (n) => dateArg(n) || P(n).ss + (P(n).ms >= 500 ? 1 : 0));
def('WEEKDAY', 'nn?', (n, type = 1) => {
  if (dateArg(n)) return ERR.NUM;
  const wd = P(Math.floor(n)).wd; // 0 = Sunday
  if (type === 1) return wd + 1;
  if (type === 2) return ((wd + 6) % 7) + 1;
  if (type === 3) return (wd + 6) % 7;
  if (type >= 11 && type <= 17) return ((wd - (type - 10) + 7) % 7) + 1;
  return ERR.NUM;
});
// ISO 8601 week: the week (Monday first) whose Thursday falls in the year.
function isoWeek(n) {
  const { y, m, d } = P(Math.floor(n));
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3);
  return 1 + Math.floor((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 / 7);
}
def('ISOWEEKNUM', 'n', (n) => dateArg(n) || isoWeek(n));
def('WEEKNUM', 'nn?', (n, type = 1) => {
  if (dateArg(n)) return ERR.NUM;
  if (type === 21) return isoWeek(n);
  const start = type === 1 || type === 17 ? 0 : type === 2 || type === 11 ? 1 : type >= 12 && type <= 16 ? type - 10 : -1;
  if (start < 0) return ERR.NUM;
  const { y } = P(n);
  const jan1 = ymdToSerial(y, 1, 1);
  const wd1 = P(jan1).wd;
  const off = (wd1 - start + 7) % 7;
  return Math.floor((Math.floor(n) - jan1 + off) / 7) + 1;
});
function addMonths(n, k, end) {
  if (dateArg(n)) return ERR.NUM;
  const { y, m, d } = P(Math.floor(n));
  const mm = m + Math.trunc(k);
  const yy = y + Math.floor((mm - 1) / 12);
  const m2 = ((mm - 1) % 12 + 12) % 12 + 1;
  const last = daysInMonth(yy, m2);
  const r = ymdToSerial(yy, m2, end ? last : Math.min(d, last));
  return r < 0 ? ERR.NUM : r;
}
def('EDATE', 'nn', (n, k) => addMonths(n, k, false));
def('EOMONTH', 'nn', (n, k) => addMonths(n, k, true));
def('DAYS', 'nn', (a, b) => Math.floor(a) - Math.floor(b));
def('DATEDIF', 'nns', (a, b, u) => {
  a = Math.floor(a); b = Math.floor(b);
  if (a > b || a < 0) return ERR.NUM;
  const A = P(a), B = P(b);
  let months = (B.y - A.y) * 12 + (B.m - A.m);
  if (B.d < A.d) months--;
  switch (u.toUpperCase()) {
    case 'Y': return Math.floor(months / 12);
    case 'M': return months;
    case 'D': return b - a;
    case 'YM': return months % 12;
    case 'MD': return B.d >= A.d ? B.d - A.d : B.d + daysInMonth(B.m === 1 ? B.y - 1 : B.y, B.m === 1 ? 12 : B.m - 1) - A.d;
    case 'YD': {
      let s = ymdToSerial(B.y, A.m, Math.min(A.d, daysInMonth(B.y, A.m)));
      if (s > b) s = ymdToSerial(B.y - 1, A.m, Math.min(A.d, daysInMonth(B.y - 1, A.m)));
      return b - s;
    }
    default: return ERR.NUM;
  }
});
def('DAYS360', 'nnb?', (a, b, eu = false) => {
  const A = P(Math.floor(a)), B = P(Math.floor(b));
  let d1 = A.d, d2 = B.d;
  if (eu) { if (d1 === 31) d1 = 30; if (d2 === 31) d2 = 30; }
  else {
    const lastFeb = (p) => p.m === 2 && p.d === daysInMonth(p.y, 2);
    if (lastFeb(A)) d1 = 30;
    if (d1 === 31) d1 = 30;
    if (d2 === 31 && d1 >= 30) d2 = 30;
  }
  return (B.y - A.y) * 360 + (B.m - A.m) * 30 + (d2 - d1);
});
const holidaySet = (arg, ctx) => {
  const s = new Set();
  if (arg == null) return s;
  eachValue([arg], ctx, (v) => { if (typeof v === 'number') s.add(Math.floor(v)); });
  return s;
};
const workday = (d, hol) => { const wd = P(d).wd; return wd !== 0 && wd !== 6 && !hol.has(d); };
raw('NETWORKDAYS', (args, ctx) => {
  let a = toNumber(first(deref(args[0], ctx), ctx)), b = toNumber(first(deref(args[1], ctx), ctx));
  if (a instanceof CellError) return a;
  if (b instanceof CellError) return b;
  a = Math.floor(a); b = Math.floor(b);
  const hol = holidaySet(args[2], ctx);
  const sign = a <= b ? 1 : -1;
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  if (hi - lo > 1e6) return ERR.NUM;
  let n = 0;
  for (let d = lo; d <= hi; d++) if (workday(d, hol)) n++;
  return n * sign;
}, { min: 2, max: 3 });
raw('WORKDAY', (args, ctx) => {
  let d = toNumber(first(deref(args[0], ctx), ctx));
  const k = toNumber(first(deref(args[1], ctx), ctx));
  if (d instanceof CellError) return d;
  if (k instanceof CellError) return k;
  const hol = holidaySet(args[2], ctx);
  d = Math.floor(d);
  let left = Math.abs(Math.trunc(k));
  const step = k < 0 ? -1 : 1;
  if (left > 1e6) return ERR.NUM;
  while (left > 0) { d += step; if (workday(d, hol)) left--; }
  return d;
}, { min: 2, max: 3 });
def('DATEVALUE', 's', (s) => { const p = parseDate(s, 'mdy'); return p && !p.dateless ? Math.floor(dateSerial(p)) : ERR.VALUE; });
def('TIMEVALUE', 's', (s) => { const p = parseDate(s, 'mdy'); return p ? dateSerial(p) % 1 : ERR.VALUE; });
def('YEARFRAC', 'nnn?', (a, b, basis = 0) => {
  if (a > b) [a, b] = [b, a];
  const A = P(Math.floor(a)), B = P(Math.floor(b));
  switch (Math.trunc(basis)) {
    case 0: {
      let d1 = A.d, d2 = B.d;
      if (d1 === 31) d1 = 30;
      if (d2 === 31 && d1 >= 30) d2 = 30;
      return ((B.y - A.y) * 360 + (B.m - A.m) * 30 + (d2 - d1)) / 360;
    }
    case 1: return (Math.floor(b) - Math.floor(a)) / (A.y === B.y ? (A.y % 4 === 0 && (A.y % 100 !== 0 || A.y % 400 === 0) ? 366 : 365) : 365.25);
    case 2: return (Math.floor(b) - Math.floor(a)) / 360;
    case 3: return (Math.floor(b) - Math.floor(a)) / 365;
    case 4: return ((B.y - A.y) * 360 + (B.m - A.m) * 30 + (Math.min(B.d, 30) - Math.min(A.d, 30))) / 360;
    default: return ERR.NUM;
  }
});

