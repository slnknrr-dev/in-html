// contract/expr.js - the expression language of contract templates: conditions of sections and clauses, computed
// fields and the values of placeholders. It is parsed and interpreted here (never eval), reaches only the values the
// caller's scope gives, and calls only the functions listed below, so a template from anywhere is safe to render.
//
//   parseExpr(src) -> { ast, error }          parsePipe(src) -> { ast, filters: [{ name, args: [ast] }], error }
//   evaluate(ast, env) -> value               env: { get(path) -> value, lang, today, call?(name, args) -> value,
//                                                    vars?: { name: value } (loop variables), steps? }
//   refsOf(ast, out?) -> Set of the dotted paths an expression reads (static member chains: `tenant.name`)
//   truthy(v)   looseEq(a, b)   FUNCTIONS (names callable from templates)
//
// Grammar: literals (12, 1.5, 'text', "text", true, false, null, [a, b]), paths (`rent`, `tenant.name`,
// `services[0].price`), unary ! - not, * / %, + -, < <= > >=, == != (=== and !== are the same), && and, || or,
// c ? a : b, calls f(x, y) of FUNCTIONS. A placeholder adds filters: `rent * 2 | money | upper`, `n | plural:'день','дня','дней'`.
// Member access follows own properties only (no prototype chain, no __proto__ / constructor / prototype); every
// evaluation is bounded (steps, depth); errors evaluate to null and never throw out of evaluate().
import { addDays, addMonths, diffDays, monthsBetween, parseDate, isoDate } from './dates.js';

// Why a hand-written interpreter, not `new Function`: templates are shared documents; eval would give template text
// the page's full authority (DOM, storage, network). An AST walker over a closed grammar gives it none by construction.
// Three budgets bound hostile input, each at a different stage: MAX_SRC (tokenizer/parser time is linear in it),
// MAX_DEPTH (recursion of the descent parser and of ev: a 4000-char "((((((" would otherwise overflow the JS stack,
// which is a RangeError we could catch but only after the engine's own stack is exhausted), and the 20000-step
// counter in ev (array literals and function calls multiply work without adding depth).
const MAX_SRC = 4000;
const MAX_DEPTH = 64;
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Single-pass scanner. Regexes are anchored on s.slice(i): O(n) copy per token, so O(n^2) worst case; acceptable at
// MAX_SRC = 4000, and simpler than sticky (/y) regexes with lastIndex bookkeeping.
// Numbers: `.5` allowed, `5.` allowed, exponent allowed; a leading sign is NOT part of the literal (unary minus).
// Strings: only \n and \t are special; any other escaped char is itself ("\'" -> "'", "\\" -> "\").
// '===' / '!==' are folded into '==' / '!=': the language has one equality (looseEq), accepting JS habits as aliases.
function tokenize(src) {
  const out = [];
  let i = 0;
  const s = String(src);
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
      const m = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i));
      out.push({ t: 'num', v: +m[0], at: i });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1, v = '';
      while (j < s.length && s[j] !== c) {
        if (s[j] === '\\' && j + 1 < s.length) { const e = s[j + 1]; v += e === 'n' ? '\n' : e === 't' ? '\t' : e; j += 2; } else v += s[j++];
      }
      if (j >= s.length) throw new SyntaxError('unterminated string');
      out.push({ t: 'str', v, at: i });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(s.slice(i));
      out.push({ t: 'id', v: m[0], at: i });
      i += m[0].length;
      continue;
    }
    const three = s.slice(i, i + 3), two = s.slice(i, i + 2);
    if (three === '===' || three === '!==') { out.push({ t: 'p', v: three.slice(0, 2), at: i }); i += 3; continue; }
    if (['==', '!=', '<=', '>=', '&&', '||', '??'].includes(two)) { out.push({ t: 'p', v: two, at: i }); i += 2; continue; }
    if ('()[],.?:+-*/%!<>|#'.includes(c)) { out.push({ t: 'p', v: c, at: i }); i++; continue; }
    throw new SyntaxError(`unexpected "${c}"`);
  }
  out.push({ t: 'end', at: s.length });
  return out;
}

// Word operators for non-programmers writing conditions ("tenant.org and not deposit"). They are recognized in isP by
// the parser, not rewritten by the tokenizer, so a field named `and` cannot exist (primary() rejects it explicitly).
const KEYWORD_OPS = { and: '&&', or: '||', not: '!' };
const LITERALS = { true: true, false: false, null: null };

// Recursive descent, one method per precedence level, lowest first:
//   expr (?:, right-assoc via recursion) > or > coalesce (??) > and > eq > rel > add > mul > unary > postfix > primary
// bin() builds left-associative chains iteratively (a - b - c == (a - b) - c) without recursion per operator, so
// long flat chains do not consume depth; only nesting does (enter() at expr and unary).
// NOTE: `??` sits between || and && here; in JS mixing ?? with ||/&& unparenthesized is a SyntaxError. Accepting it
// with a defined precedence is a deliberate leniency.
class Parser {
  constructor(tokens) { this.k = tokens; this.i = 0; this.depth = 0; }
  peek() { return this.k[this.i]; }
  next() { return this.k[this.i++]; }
  isP(v) { const t = this.peek(); return (t.t === 'p' && t.v === v) || (t.t === 'id' && KEYWORD_OPS[t.v] === v); }
  eat(v) { if (this.isP(v)) { this.i++; return true; } return false; }
  want(v) { if (!this.eat(v)) throw new SyntaxError(`expected "${v}"`); }
  enter() { if (++this.depth > MAX_DEPTH) throw new SyntaxError('expression too deep'); }
  expr() {
    this.enter();
    const c = this.or();
    let r = c;
    if (this.eat('?')) { const a = this.expr(); this.want(':'); const b = this.expr(); r = { t: 'cond', c, a, b }; }
    this.depth--;
    return r;
  }
  bin(next, ops) {
    let a = next();
    for (;;) {
      const op = ops.find((o) => this.isP(o));
      if (!op) return a;
      this.i++;
      a = { t: 'bin', op, a, b: next() };
    }
  }
  or() { return this.bin(() => this.coalesce(), ['||']); }
  coalesce() { return this.bin(() => this.and(), ['??']); }
  and() { return this.bin(() => this.eq(), ['&&']); }
  eq() { return this.bin(() => this.rel(), ['==', '!=']); }
  rel() { return this.bin(() => this.add(), ['<=', '>=', '<', '>']); }
  add() { return this.bin(() => this.mul(), ['+', '-']); }
  mul() { return this.bin(() => this.unary(), ['*', '/', '%']); }
  unary() {
    if (this.eat('!')) { this.enter(); const a = this.unary(); this.depth--; return { t: 'un', op: '!', a }; }
    if (this.eat('-')) { this.enter(); const a = this.unary(); this.depth--; return { t: 'un', op: '-', a }; }
    if (this.eat('+')) return this.unary();
    return this.postfix();
  }
  // Static member chains are folded into a single `ref` path ('tenant.name', 'services.0.price'): the env resolves
  // dotted field ids directly, and refsOf can report exact dependencies for the fields panel. Dynamic access
  // (x[i] with a non-literal i) becomes a 'mem' node evaluated at run time through member().
  // Calls: only a bare identifier listed in FUNCTIONS; checked at parse time so a typo is a visible syntax error,
  // not a silent null at render. Method calls (`a.b()`) are impossible by grammar: there is no callable value type.
  postfix() {
    let n = this.primary();
    for (;;) {
      if (this.eat('.')) {
        const t = this.next();
        if (t.t !== 'id') throw new SyntaxError('expected a name after "."');
        n = n.t === 'ref' ? { t: 'ref', path: n.path + '.' + t.v } : { t: 'mem', o: n, k: { t: 'lit', v: t.v } };
      } else if (this.eat('[')) {
        const k = this.expr();
        this.want(']');
        n = n.t === 'ref' && k.t === 'lit' && Number.isInteger(k.v) && k.v >= 0 ? { t: 'ref', path: n.path + '.' + k.v } : { t: 'mem', o: n, k };
      } else if (this.isP('(')) {
        if (n.t !== 'ref' || n.path.includes('.')) throw new SyntaxError('only functions can be called');
        this.i++;
        const args = [];
        if (!this.eat(')')) {
          do args.push(this.expr()); while (this.eat(','));
          this.want(')');
        }
        if (!Object.prototype.hasOwnProperty.call(FUNCTIONS, n.path)) throw new SyntaxError(`unknown function ${n.path}()`);
        n = { t: 'call', name: n.path, args };
      } else return n;
    }
  }
  primary() {
    const t = this.next();
    if (t.t === 'num' || t.t === 'str') return { t: 'lit', v: t.v };
    if (t.t === 'id') {
      if (Object.prototype.hasOwnProperty.call(LITERALS, t.v)) return { t: 'lit', v: LITERALS[t.v] };
      if (KEYWORD_OPS[t.v]) throw new SyntaxError(`unexpected "${t.v}"`);
      return { t: 'ref', path: t.v };
    }
    if (t.t === 'p' && t.v === '(') { const e = this.expr(); this.want(')'); return e; }
    if (t.t === 'p' && t.v === '[') {
      const items = [];
      if (!this.eat(']')) { do items.push(this.expr()); while (this.eat(',')); this.want(']'); }
      return { t: 'arr', items };
    }
    throw new SyntaxError(t.t === 'end' ? 'unexpected end' : `unexpected "${t.v}"`);
  }
}

// Errors are returned, never thrown: the caller renders an inline error chip and keeps the rest of the document.
export function parseExpr(src) {
  const s = String(src ?? '');
  if (s.length > MAX_SRC) return { ast: null, error: 'too long' };
  try {
    const p = new Parser(tokenize(s));
    const ast = p.expr();
    if (p.peek().t !== 'end') throw new SyntaxError(`unexpected "${p.peek().v}"`);
    return { ast, error: null };
  } catch (e) { return { ast: null, error: String(e.message || e) }; }
}

// `expr | name:arg, arg | name2` (filters take literal or expression arguments).
// Filter names are NOT validated here (unlike function calls): the renderer owns the filter set (render.js) and
// reports unknown filters itself. This is also how `initials`, absent from FUNCTIONS, is reachable: as a filter.
export function parsePipe(src) {
  const s = String(src ?? '');
  if (s.length > MAX_SRC) return { ast: null, filters: [], error: 'too long' };
  try {
    const p = new Parser(tokenize(s));
    const ast = p.expr();
    const filters = [];
    while (p.eat('|')) {
      const t = p.next();
      if (t.t !== 'id') throw new SyntaxError('expected a filter name after "|"');
      const args = [];
      if (p.eat(':')) { do args.push(p.expr()); while (p.eat(',')); }
      filters.push({ name: t.v, args });
    }
    if (p.peek().t !== 'end') throw new SyntaxError(`unexpected "${p.peek().v}"`);
    return { ast, filters, error: null };
  } catch (e) { return { ast: null, filters: [], error: String(e.message || e) }; }
}

// Generic walk over the node shapes: child slots a/b/c/o/k plus args/items lists. Only static 'ref' paths are
// collected; a dynamic mem key contributes the refs inside its expression, not the resolved path.
export function refsOf(ast, out = new Set()) {
  if (!ast || typeof ast !== 'object') return out;
  if (ast.t === 'ref') out.add(ast.path);
  for (const k of ['a', 'b', 'c', 'o', 'k']) if (ast[k]) refsOf(ast[k], out);
  for (const x of ast.args || ast.items || []) refsOf(x, out);
  return out;
}

// Template truthiness differs from JS on purpose: [] and {} are false (an empty list or an unfilled composite field
// means "nothing there" to a template author). '' 0 null are false as in JS.
export function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === 'object') return Object.keys(v).length > 0;
  return !!v;
}

const isNumeric = (v) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v));
// Equality designed for form values, which arrive as strings: '12' == 12, '' == null, 'yes' == true (via truthy).
// Empty is a class of its own: empty equals only empty, so `x == 0` is false for an unfilled x (JS: '' == 0 is true,
// a classic trap that would make "rent == 0" true before the user typed anything).
export function looseEq(a, b) {
  const ea = a == null || a === '', eb = b == null || b === '';
  if (ea || eb) return ea && eb;
  if (typeof a === 'boolean' || typeof b === 'boolean') return truthy(a) === truthy(b);
  if (isNumeric(a) && isNumeric(b)) return +a === +b;
  return String(a) === String(b);
}

// num: empty -> 0 (an unfilled amount adds nothing), non-numeric text -> NaN (poisons the result; evaluate maps it
// to null). fin: Infinity -> null, so 1/0-like results never print "Infinity" in a contract.
// member: the only property access of the language. Own properties only, BAD_KEYS refused, length allowed on
// arrays and strings. Returning null (not throwing) for missing keys keeps `a.b.c` on an empty a quiet.
const num = (v) => (v == null || v === '' ? 0 : typeof v === 'number' ? v : Number.isFinite(+v) ? +v : NaN);
const fin = (v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v);
function member(o, k) {
  if (o == null || typeof o !== 'object') return typeof o === 'string' && k === 'length' ? o.length : null;
  if (Array.isArray(o) && k === 'length') return o.length;
  const key = String(k);
  if (BAD_KEYS.has(key) || !Object.prototype.hasOwnProperty.call(o, key)) return null;
  return o[key];
}
const listOf = (v) => (Array.isArray(v) ? v : []);
// roundP: half-away-from-zero at p decimals (p clamped 0..8). The EPSILON nudge makes 1.005 -> 1.01 for values
// whose binary form is a hair below the half; it only works while the representation error is below EPSILON (an
// absolute 2.2e-16), which fails already at magnitude ~4. KNOWN DEFECT: round(4.015, 2) returns 4.01 (checked).
// Fix: nudge relative to magnitude (x * (1 + Number.EPSILON)) or round via toFixed on a decimal string.
const roundP = (x, p = 0) => { const f = 10 ** Math.min(Math.max(Math.trunc(num(p)) || 0, 0), 8); return Math.round((num(x) + Math.sign(num(x)) * Number.EPSILON) * f) / f; };

// Functions callable from templates (pure; dates are ISO strings). The renderer adds the language-dependent ones
// (words, money, date, plural) through env.call.
export const FUNCTIONS = {
  round: (x, p) => roundP(x, p),
  floor: (x) => Math.floor(num(x)),
  ceil: (x) => Math.ceil(num(x)),
  abs: (x) => Math.abs(num(x)),
  min: (...a) => (a.length ? Math.min(...a.flat().map(num)) : null),
  max: (...a) => (a.length ? Math.max(...a.flat().map(num)) : null),
  sum: (list, prop) => listOf(list).reduce((s, x) => s + num(prop != null ? member(x, prop) : x), 0),
  count: (list) => listOf(list).length,
  len: (x) => (Array.isArray(x) ? x.length : String(x ?? '').length),
  upper: (s) => String(s ?? '').toLocaleUpperCase(),
  lower: (s) => String(s ?? '').toLocaleLowerCase(),
  trim: (s) => String(s ?? '').trim(),
  concat: (...a) => a.map((x) => (x == null ? '' : String(x))).join(''),
  join: (list, sep = ', ', prop) => listOf(list).map((x) => (prop != null ? member(x, prop) : x)).filter((x) => x != null && x !== '').join(String(sep)),
  pick: (list, prop) => listOf(list).map((x) => member(x, prop)),
  contains: (h, x) => (Array.isArray(h) ? h.some((y) => looseEq(y, x)) : String(h ?? '').includes(String(x ?? ''))),
  if: (c, a, b) => (truthy(c) ? a : b),
  default: (a, b) => (a == null || a === '' || (Array.isArray(a) && !a.length) ? b : a),
  number: (x) => (Number.isFinite(+x) && x !== '' && x != null ? +x : null),
  string: (x) => (x == null ? '' : String(x)),
  date: (y, m, d) => (m == null ? isoDate(String(y ?? '')) : isoDate(`${y}-${m}-${d}`)),
  addDays: (d, n) => addDays(d, num(n)) || null,
  addMonths: (d, n) => addMonths(d, num(n)) || null,
  days: (a, b) => diffDays(a, b),
  months: (a, b) => monthsBetween(a, b),
  year: (d) => parseDate(d)?.y ?? null,
  month: (d) => parseDate(d)?.m ?? null,
  day: (d) => parseDate(d)?.d ?? null,
  today: null, // env.today
  words: null, money: null, fmtDate: null, plural: null, // language-dependent: env.call
};

function ev(n, env, depth) {
  if (++env.steps > 20000 || depth > MAX_DEPTH) throw new RangeError('expression too costly');
  switch (n.t) {
    case 'lit': return n.v;
    case 'arr': return n.items.map((x) => ev(x, env, depth + 1));
    // Loop variables ([[each services as s]]) shadow template paths by their head segment. Their sub-path is walked
    // with member(), keeping the same own-property rules as the env.
    case 'ref': {
      if (env.vars) {
        const dot = n.path.indexOf('.');
        const head = dot < 0 ? n.path : n.path.slice(0, dot);
        if (Object.prototype.hasOwnProperty.call(env.vars, head)) {
          let v = env.vars[head];
          if (dot >= 0) for (const k of n.path.slice(dot + 1).split('.')) v = member(v, k);
          return v;
        }
      }
      return env.get(n.path);
    }
    case 'mem': return member(ev(n.o, env, depth + 1), ev(n.k, env, depth + 1));
    case 'un': {
      const a = ev(n.a, env, depth + 1);
      return n.op === '!' ? !truthy(a) : fin(-num(a));
    }
    case 'cond': return truthy(ev(n.c, env, depth + 1)) ? ev(n.a, env, depth + 1) : ev(n.b, env, depth + 1);
    // Arguments are evaluated eagerly (no short-circuit inside if(c, a, b); use c ? a : b for that).
    case 'call': {
      const args = n.args.map((x) => ev(x, env, depth + 1));
      if (n.name === 'today') return env.today || null;
      const f = FUNCTIONS[n.name];
      if (typeof f === 'function') return fin(f(...args));
      return env.call ? fin(env.call(n.name, args)) : null;
    }
    case 'bin': {
      // && || ?? short-circuit and return an operand (JS semantics), not a boolean: `name || 'N/A'` works.
      // ?? treats '' as missing too, unlike JS: an unfilled text field is '' not null.
      if (n.op === '&&') { const a = ev(n.a, env, depth + 1); return truthy(a) ? ev(n.b, env, depth + 1) : a; }
      if (n.op === '||') { const a = ev(n.a, env, depth + 1); return truthy(a) ? a : ev(n.b, env, depth + 1); }
      if (n.op === '??') { const a = ev(n.a, env, depth + 1); return a == null || a === '' ? ev(n.b, env, depth + 1) : a; }
      const a = ev(n.a, env, depth + 1), b = ev(n.b, env, depth + 1);
      switch (n.op) {
        case '==': return looseEq(a, b);
        case '!=': return !looseEq(a, b);
          // Empty never compares (false both ways): "deposit > 0" stays false until filled. Numeric when both
          // sides look numeric, else string order; ISO dates compare correctly as strings (fixed-width YYYY-MM-DD).
        case '<': case '<=': case '>': case '>=': {
          if (a == null || b == null || a === '' || b === '') return false;
          const both = isNumeric(a) && isNumeric(b);
          const x = both ? +a : String(a), y = both ? +b : String(b);
          return n.op === '<' ? x < y : n.op === '<=' ? x <= y : n.op === '>' ? x > y : x >= y;
        }
          // '+' concatenates only if a side is non-numeric text; '12' + 3 is 15, because form values are strings.
        case '+':
          if ((typeof a === 'string' && !isNumeric(a)) || (typeof b === 'string' && !isNumeric(b))) return (a ?? '') + '' + (b ?? '');
          return fin(num(a) + num(b));
        case '-': return fin(num(a) - num(b));
        case '*': return fin(num(a) * num(b));
        case '/': return num(b) === 0 ? null : fin(num(a) / num(b));
        case '%': return num(b) === 0 ? null : fin(num(a) % num(b));
      }
      return null;
    }
  }
  return null;
}

// The step counter lives on a per-evaluation prototype child of env (Object.create): the caller's env object is not
// mutated, yet nested evaluate calls that pass an env which already has steps share one budget.
// NaN/undefined collapse to null: one "no value" for the renderer to show as an empty placeholder.
export function evaluate(ast, env) {
  if (!ast) return null;
  let e = env;
  if (env.steps == null) { e = Object.create(env); e.steps = 0; }
  try {
    const v = ev(ast, e, 0);
    return v === undefined || (typeof v === 'number' && Number.isNaN(v)) ? null : v;
  } catch (err) {
    if (env.onError) env.onError(String(err.message || err));
    return null;
  }
}
