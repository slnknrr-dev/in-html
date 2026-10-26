// formula/evaluate.js - evaluation of formula ASTs: operators with array broadcasting, references, implicit
// intersection ('@'), the function registry and the helpers function libraries are written with.
//
//   evaluate(ast, ctx) -> value | Ref | matrix
//   ctx (supplied by formula/engine.js): { s, r, c (the formula's cell), deref(ref) -> matrix, value(s, r, c),
//     sheetIndex(name) -> index | -1, name(name) -> AST | null, now() -> Date, random() -> number }
//   defineFunction(name, { fn(args, ctx, ev), min, max, lazy, volatile })   lazy: args are ASTs, ev(ast) evaluates
//   lift(signature, impl) -> fn: coerces scalar parameters and maps over arrays (Excel dynamic-array lifting)
//     signature letters: n number, i integer, s text, b boolean, v value (errors propagate), e any value (errors too),
//     a array (no lifting), r raw (Ref kept); '?' marks the previous parameter optional, a trailing '*' repeats it.

import { CellError, ERR, MAX_COLS, MAX_ROWS, cellError } from '../xlsx/cells.js';
import { Ref, compare, isErr, isMatrix, isRef, toBool, toNumber, toText } from './values.js';

// Registry pattern: function libraries (functions.js, lookup.js) register themselves at import; the evaluator knows
// no function by name. min/max arity is checked before the call so implementations can index args freely.
export const FUNCTIONS = new Map();
export function defineFunction(name, spec) {
  FUNCTIONS.set(name, { lazy: false, volatile: false, ...spec, min: spec.min ?? spec.fn.min ?? 0, max: spec.max ?? spec.fn.max ?? 255 });
}
export const VOLATILE = new Set();

// Ref -> scalar (single cell) or matrix; other values unchanged.
export function deref(v, ctx) {
  if (!(v instanceof Ref)) return v;
  if (v.single) return ctx.value(v.s, v.r1, v.c1);
  return ctx.deref(v);
}
export function toMatrix(v, ctx) {
  if (v instanceof Ref) return v.single ? [[ctx.value(v.s, v.r1, v.c1)]] : ctx.deref(v);
  return isMatrix(v) ? v : [[v]];
}
// Top-left value of a range / array (legacy implicit intersection fallback).
export function first(v, ctx) {
  if (v instanceof Ref) return ctx.value(v.s, v.r1, v.c1);
  if (isMatrix(v)) return v.length && v[0].length ? v[0][0] : null;
  return v;
}

// Element-wise map over matrices and scalars; a 1-wide / 1-high matrix repeats, other gaps give #N/A.
// Dynamic-array broadcasting: the result takes the largest height and width; a 1-row or 1-column operand repeats
// along the other axis (A1:A3*B1:D1 gives 3x3), and positions missing in a larger mismatched operand become #N/A,
// exactly Excel's rule.
export function broadcast(vals, fn) {
  let h = 1, w = 1;
  for (const v of vals) if (isMatrix(v)) { h = Math.max(h, v.length); w = Math.max(w, v[0] ? v[0].length : 0); }
  const out = new Array(h);
  const xs = new Array(vals.length);
  for (let i = 0; i < h; i++) {
    const row = new Array(w);
    for (let j = 0; j < w; j++) {
      for (let k = 0; k < vals.length; k++) {
        const v = vals[k];
        if (!isMatrix(v)) { xs[k] = v; continue; }
        const vr = v.length === 1 ? v[0] : v[i];
        if (!vr) { xs[k] = ERR.NA; continue; }
        xs[k] = vr.length === 1 ? vr[0] : j < vr.length ? vr[j] : ERR.NA;
      }
      row[j] = fn(xs);
    }
    out[i] = row;
  }
  return out;
}

function parseSig(sig) {
  const types = [];
  let rest = false;
  for (const ch of sig) {
    if (ch === '?') types[types.length - 1].opt = true;
    else if (ch === '*') rest = true;
    else types.push({ t: ch, opt: false });
  }
  return { types, rest };
}

function coerce(t, v) {
  switch (t) {
    case 'n': return toNumber(v);
    case 'i': { const n = toNumber(v); return isErr(n) ? n : Math.trunc(n); }
    case 's': return toText(v);
    case 'b': return toBool(v);
    default: return v;
  }
}

// Turns a scalar implementation into a spreadsheet function: coerces each parameter per its signature letter and,
// when a scalar parameter receives an array, calls impl once per element (LEN(A1:A3) returns 3 lengths). A 1x1
// matrix is unwrapped instead of lifted. Coercion errors short-circuit before impl runs (errors propagate).
export function lift(sig, impl) {
  const { types, rest } = parseSig(sig);
  const typeAt = (i) => types[Math.min(i, types.length - 1)] || { t: 'v' };
  const apply = (vals) => {
    const out = new Array(vals.length);
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      const t = typeAt(i).t;
      if (v === undefined || t === 'e' || t === 'a' || t === 'r') { out[i] = v; continue; }
      const x = coerce(t, v);
      if (x instanceof CellError) return x;
      out[i] = x;
    }
    return impl(...out);
  };
  const fn = (args, ctx) => {
    if (!rest && args.length > types.length) return ERR.VALUE;
    const vals = new Array(args.length);
    const lifted = [];
    for (let i = 0; i < args.length; i++) {
      const t = typeAt(i).t;
      if (t === 'r') { vals[i] = args[i]; continue; }
      const d = deref(args[i], ctx);
      if (t === 'a') { vals[i] = isMatrix(d) ? d : [[d]]; continue; }
      if (isMatrix(d)) {
        if (d.length === 1 && d[0].length === 1) { vals[i] = d[0][0]; continue; }
        lifted.push(i);
      }
      vals[i] = d;
    }
    if (!lifted.length) return apply(vals);
    return broadcast(lifted.map((i) => vals[i]), (xs) => {
      const call = vals.slice();
      lifted.forEach((i, k) => { call[i] = xs[k]; });
      const r = apply(call);
      return isMatrix(r) ? first(r, ctx) : r instanceof Ref ? ctx.value(r.s, r.r1, r.c1) : r;
    });
  };
  fn.min = types.filter((t) => !t.opt).length;
  fn.max = rest ? 255 : types.length;
  return fn;
}

// --- operators ---------------------------------------------------------------------------

// Spreadsheet arithmetic: x/0 -> #DIV/0!, 0^0 -> #NUM!, 0^negative -> #DIV/0!, and any non-finite result (overflow,
// negative base with fractional exponent giving NaN) -> #NUM!, so Infinity/NaN never reach a cell.
function arith(op, x, y) {
  const a = toNumber(x);
  if (a instanceof CellError) return a;
  const b = toNumber(y);
  if (b instanceof CellError) return b;
  let r;
  switch (op) {
    case '+': r = a + b; break;
    case '-': r = a - b; break;
    case '*': r = a * b; break;
    case '/': if (b === 0) return ERR.DIV0; r = a / b; break;
    default:
      if (a === 0 && b === 0) return ERR.NUM;
      if (a === 0 && b < 0) return ERR.DIV0;
      r = a ** b;
  }
  return Number.isFinite(r) ? r : ERR.NUM;
}

// The left error wins when both sides are errors (Excel order). Text equality is case-insensitive.
export function binop(op, x, y) {
  if (x instanceof CellError) return x;
  if (y instanceof CellError) return y;
  switch (op) {
    case '&': return toText(x) + toText(y);
    case '=': return compare(x, y) === 0 && (typeof x !== 'string' || typeof y !== 'string' || x.toLowerCase() === y.toLowerCase());
    case '<>': return compare(x, y) !== 0;
    case '<': return compare(x, y) < 0;
    case '>': return compare(x, y) > 0;
    case '<=': return compare(x, y) <= 0;
    case '>=': return compare(x, y) >= 0;
    default: return arith(op, x, y);
  }
}

function unop(op, v) {
  if (v instanceof CellError) return v;
  const n = toNumber(v);
  if (n instanceof CellError) return n;
  return op === '-' ? -n : op === '%' ? n / 100 : n;
}

// Implicit intersection ('@', and legacy single-value contexts): a vertical range yields the cell in the formula's
// row, a horizontal range the cell in the formula's column; otherwise #VALUE!.
function intersect(v, ctx) {
  if (v instanceof Ref) {
    if (v.single) return ctx.value(v.s, v.r1, v.c1);
    if (v.c1 === v.c2 && ctx.r >= v.r1 && ctx.r <= v.r2) return ctx.value(v.s, ctx.r, v.c1);
    if (v.r1 === v.r2 && ctx.c >= v.c1 && ctx.c <= v.c2) return ctx.value(v.s, v.r1, ctx.c);
    return ERR.VALUE;
  }
  return first(v, ctx);
}

function sheetOf(name, ctx) {
  if (name == null) return ctx.s;
  return ctx.sheetIndex(name);
}

// References evaluate to Ref objects, not values: dereferencing is deferred to the consumer (operators deref,
// functions decide). Whole columns/rows become full-grid Refs; the engine's deref clips them to the used area.
// Lazy functions (IF, IFERROR, CHOOSE...) get ASTs plus an evaluator so untaken branches are never computed.
// NOTE: names are evaluated recursively with no cycle guard here; a self-referencing defined name relies on the
// engine's guards.
export function evaluate(n, ctx) {
  switch (n.type) {
    case 'num': case 'str': case 'bool': return n.v;
    case 'err': return cellError(n.v);
    case 'missing': return null;
    case 'ref': {
      const s = sheetOf(n.sheet, ctx);
      return s < 0 ? ERR.REF : new Ref(s, n.r, n.c, n.r, n.c);
    }
    case 'range': {
      const s = sheetOf(n.sheet, ctx);
      if (s < 0) return ERR.REF;
      return n.r1 == null ? new Ref(s, 0, n.c1, MAX_ROWS - 1, n.c2)
        : n.c1 == null ? new Ref(s, n.r1, 0, n.r2, MAX_COLS - 1) : new Ref(s, n.r1, n.c1, n.r2, n.c2);
    }
    case 'name': {
      const ast = ctx.name(n.name, n.sheet);
      return ast ? evaluate(ast, ctx) : ERR.NAME;
    }
    case 'paren': return evaluate(n.a, ctx);
    case 'unary': {
      if (n.op === '@') return intersect(evaluate(n.a, ctx), ctx);
      const v = deref(evaluate(n.a, ctx), ctx);
      return isMatrix(v) ? broadcast([v], (xs) => unop(n.op, xs[0])) : unop(n.op, v);
    }
    case 'postfix': {
      const v = deref(evaluate(n.a, ctx), ctx);
      return isMatrix(v) ? broadcast([v], (xs) => unop('%', xs[0])) : unop('%', v);
    }
    case 'bin': {
      if (n.op === ':') {
        const a = evaluate(n.a, ctx), b = evaluate(n.b, ctx);
        if (!(a instanceof Ref) || !(b instanceof Ref) || a.s !== b.s) return a instanceof CellError ? a : b instanceof CellError ? b : ERR.VALUE;
        return new Ref(a.s, Math.min(a.r1, b.r1), Math.min(a.c1, b.c1), Math.max(a.r2, b.r2), Math.max(a.c2, b.c2));
      }
      const a = deref(evaluate(n.a, ctx), ctx);
      const b = deref(evaluate(n.b, ctx), ctx);
      if (isMatrix(a) || isMatrix(b)) return broadcast([a, b], (xs) => binop(n.op, xs[0], xs[1]));
      return binop(n.op, a, b);
    }
    case 'call': {
      const def = FUNCTIONS.get(n.name);
      if (!def) return ERR.NAME;
      if (n.args.length < def.min || n.args.length > def.max) return ERR.VALUE;
      if (def.lazy) return def.fn(n.args, ctx, (a) => evaluate(a, ctx));
      const args = new Array(n.args.length);
      for (let i = 0; i < n.args.length; i++) args[i] = evaluate(n.args[i], ctx);
      return def.fn(args, ctx);
    }
    case 'array': {
      return n.rows.map((row) => row.map((c) => evaluate(c, ctx)));
    }
    default: return ERR.VALUE;
  }
}

// --- helpers for function libraries -------------------------------------------------------

// Every value of the arguments: fn(value, fromRange); returning false stops early.
export function eachValue(args, ctx, fn) {
  for (const a of args) {
    if (a instanceof Ref || isMatrix(a)) {
      const m = toMatrix(a, ctx);
      for (const row of m) for (const v of row) if (fn(v, true) === false) return;
    } else if (fn(a, false) === false) return;
  }
}

// Numbers of SUM-like functions: ranges give their numbers (text, booleans, blanks skipped); direct arguments are
// coerced. Errors propagate. Returns number[] or CellError.
// SUM-family semantics differ by source: values from ranges count only if numeric (text/booleans ignored), while
// direct arguments are coerced (SUM("2", TRUE) = 3). The first error aborts and is returned.
export function numbers(args, ctx, { directText = true } = {}) {
  const out = [];
  let err = null;
  eachValue(args, ctx, (v, fromRange) => {
    if (typeof v === 'number') out.push(v);
    else if (v instanceof CellError) { err = v; return false; }
    else if (!fromRange && v != null) {
      if (typeof v === 'string' && !directText) return undefined;
      const n = toNumber(v);
      if (n instanceof CellError) { err = n; return false; }
      out.push(n);
    }
    return undefined;
  });
  return err || out;
}

// Values of the A-variants (AVERAGEA, MAXA): range text = 0, booleans = 1 / 0, blanks skipped.
export function numbersA(args, ctx) {
  const out = [];
  let err = null;
  eachValue(args, ctx, (v, fromRange) => {
    if (v instanceof CellError) { err = v; return false; }
    if (v == null) return undefined;
    if (typeof v === 'number') out.push(v);
    else if (typeof v === 'boolean') out.push(v ? 1 : 0);
    else if (fromRange) out.push(0);
    else { const n = toNumber(v); if (n instanceof CellError) { err = n; return false; } out.push(n); }
    return undefined;
  });
  return err || out;
}

export { isRef };
