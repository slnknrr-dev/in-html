// minify/js.js - JavaScript whitespace/comment minifier. Never renames, never reorders, ASI-safe.
//
//   minifyJS(src)        fail-safe: returns the input unchanged when it cannot be tokenized
//   minifyJSStrict(src)  throws on untokenizable input
//   emitJS(tokens)       joins a token list produced elsewhere (e.g. by an exact parser)
//
// Token format: { t, v, nl, prop? }
//   t: 'name' | 'num' | 'str' | 're' | 'p' (punctuator) | 'tpl' (whole template literal, verbatim)
//      | 'tplh' (template head chunk "`...${") | 'tplm' (middle chunk "}...${") | 'tplt' (tail chunk "}...`")
//      | 'hb' (hashbang line)
//   v: source text of the token; nl: a line break preceded it; prop: a name used as a property (`a.return`).
// The built-in tokenizer decides regex vs. division from the previous token and a brace stack (blocks vs.
// object literals); `emitJS` with exact tokens from a real parser is always correct.
//
// Correctness strategy: removing whitespace is safe except in two cases, both handled explicitly. (1) Token fusion:
// two tokens written together could lex differently (`a in b`, `a + +b`, `/re/ in`, `1 .x`) -> needSpace. (2) ASI:
// a line break can be a statement terminator (`return` followed by a newline, a line starting with `(` or `[`) ->
// keepNL keeps a newline wherever removing it could change how automatic semicolon insertion parses the code.
// When either rule is unsure it keeps the whitespace: a few bytes lost, never a semantic change.

const PUNCT = [
  '>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=',
  '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>',
  '{', '}', '(', ')', '[', ']', ';', ',', '<', '>', '+', '-', '*', '/', '%', '&', '|',
  '^', '!', '~', '?', ':', '=', '.', '@',
];
// Keywords after which a `/` starts a regular expression.
const RE_AFTER_KW = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await', 'extends', 'default']);
// Restricted productions: a line break after these is significant.
const RESTRICTED = new Set(['return', 'throw', 'break', 'continue', 'yield', 'async']);
// Keywords that can never end a statement (a following line break is insignificant).
const NO_END = new Set(['in', 'instanceof', 'typeof', 'new', 'delete', 'void', 'else', 'do', 'case',
  'extends', 'var', 'const', 'function', 'class', 'if', 'while', 'for', 'switch', 'with', 'try',
  'catch', 'finally', 'import', 'export', 'default']);
// Keywords that continue a statement after a closing `}` (a line break between them is insignificant).
// Not 'else': in `if (a) x = {} <newline> else ...` the break supplies the ASI semicolon.
const NO_START = new Set(['catch', 'finally']);
// Punctuators that may start a statement / expression after a line break.
const START_P = new Set(['{', '(', '[', '!', '~', '+', '-', '*', '++', '--', '@', '...', '/', '/=']);
// Previous punctuators after which `{` opens a block rather than an object literal.
const BLOCK_AFTER_P = new Set([';', '{', '}', ')', '=>', ':']);
const BLOCK_AFTER_KW = new Set(['else', 'do', 'try', 'finally', 'static']);

const isWS = (c) => /\s/.test(c);
const isNL = (c) => c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029';
const isIdStart = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '$' || c === '_' || c === '\\' ||
  (c > '\x7f' && !isWS(c));
const isIdPart = (c) => isIdStart(c) || (c >= '0' && c <= '9');
const isDigit = (c) => c >= '0' && c <= '9';

// Tokenizes `src` from `i`. With `inTpl`, stops after the `}` that closes a `${`.
function tokenize(src, i, inTpl) {
  const toks = [];
  const n = src.length;
  let nl = false;
  const parens = [];      // per '(' : is it a control-statement head (if/while/for/with)?
  const braces = [];      // per '{' : 'block' | 'expr'
  let prev = null, prev2 = null;
  let lastClosedBrace = null; // kind of the brace closed by the previous '}' token
  const push = (tk) => { tk.nl = nl; nl = false; toks.push(tk); prev2 = prev; prev = tk; };
  const reAllowed = () => {
    if (!prev) return true;
    if (prev.t === 'name') return !prev.prop && RE_AFTER_KW.has(prev.v);
    if (prev.t !== 'p') return false;
    const v = prev.v;
    if (v === ')') return !!prev.ctl;
    if (v === ']' || v === '++' || v === '--') return false;
    if (v === '}') return lastClosedBrace !== 'expr';
    return true;
  };
  const braceKind = () => {
    if (!prev) return 'block';
    if (prev.t === 'p') {
      if (prev.v === ':') {
        // `case x: {` / `label: {` in a block versus `{ key: {` in an object literal.
        return braces.length && braces[braces.length - 1] === 'expr' ? 'expr' : 'block';
      }
      return BLOCK_AFTER_P.has(prev.v) ? 'block' : 'expr';
    }
    if (prev.t === 'name' && !prev.prop) {
      if (BLOCK_AFTER_KW.has(prev.v)) return 'block';
      if (RE_AFTER_KW.has(prev.v)) return 'expr';
      return 'block'; // class X {, extends Y {, a newline-separated statement
    }
    return 'block';
  };
  while (i < n) {
    const c = src[i];
    if (isWS(c)) {
      if (isNL(c)) nl = true;
      i++;
      continue;
    }
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && !isNL(src[i])) i++;
      continue;
    }
    if (c === '/' && c2 === '*') {
      const e = src.indexOf('*/', i + 2);
      if (e < 0) throw new Error('Unterminated comment');
      if (/[\n\r\u2028\u2029]/.test(src.slice(i + 2, e))) nl = true; // counts as a line break for ASI
      i = e + 2;
      continue;
    }
    if (c === '#' && c2 === '!' && i === 0 && !inTpl) {
      let e = i;
      while (e < n && !isNL(src[e])) e++;
      push({ t: 'hb', v: src.slice(i, e) });
      i = e;
      continue;
    }
    if (c === '\'' || c === '"') {
      let j = i + 1;
      for (;;) {
        if (j >= n) throw new Error('Unterminated string');
        const d = src[j];
        if (d === '\\') { j += (src[j + 1] === '\r' && src[j + 2] === '\n') ? 3 : 2; continue; }
        if (d === c) { j++; break; }
        if (d === '\n' || d === '\r') throw new Error('Unterminated string');
        j++;
      }
      push({ t: 'str', v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '`') {
      // Template literal: raw chunks are kept verbatim, ${...} code is minified recursively.
      let v = '`';
      let j = i + 1, start = j;
      for (;;) {
        if (j >= n) throw new Error('Unterminated template');
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '`') { v += src.slice(start, j) + '`'; j++; break; }
        if (d === '$' && src[j + 1] === '{') {
          v += src.slice(start, j) + '${';
          const sub = tokenize(src, j + 2, true);
          v += emitJS(sub.toks) + '}';
          j = sub.i;
          start = j;
          continue;
        }
        j++;
      }
      push({ t: 'tpl', v });
      i = j;
      continue;
    }
    if (isDigit(c) || (c === '.' && isDigit(c2))) {
      let j = i;
      if (c === '0' && /[xXoObB]/.test(c2 || '')) {
        j += 2;
        while (j < n && /[0-9a-fA-F_]/.test(src[j])) j++;
      } else {
        while (j < n && (isDigit(src[j]) || src[j] === '_')) j++;
        if (src[j] === '.') { j++; while (j < n && (isDigit(src[j]) || src[j] === '_')) j++; }
        if ((src[j] === 'e' || src[j] === 'E') &&
          (isDigit(src[j + 1]) || ((src[j + 1] === '+' || src[j + 1] === '-') && isDigit(src[j + 2])))) {
          j += 2;
          while (j < n && (isDigit(src[j]) || src[j] === '_')) j++;
        }
      }
      if (src[j] === 'n') j++;
      push({ t: 'num', v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (isIdStart(c) || (c === '#' && c2 !== undefined && isIdStart(c2))) {
      let j = i + (c === '#' ? 1 : 0);
      while (j < n) {
        const d = src[j];
        if (d === '\\') { // unicode escape \uXXXX or \u{...}
          if (src[j + 2] === '{') { const e = src.indexOf('}', j); j = e < 0 ? n : e + 1; } else j += 6;
          continue;
        }
        if (!isIdPart(d)) break;
        j++;
      }
      const v = src.slice(i, j);
      const isProp = !!(prev && prev.t === 'p' && (prev.v === '.' || prev.v === '?.'));
      push({ t: 'name', v, prop: isProp || c === '#' });
      i = j;
      continue;
    }
    if (c === '/' && reAllowed()) {
      let j = i + 1, cls = false;
      for (;;) {
        if (j >= n || isNL(src[j])) throw new Error('Unterminated regex');
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '[') cls = true;
        else if (d === ']') cls = false;
        else if (d === '/' && !cls) { j++; break; }
        j++;
      }
      while (j < n && isIdPart(src[j])) j++; // flags
      push({ t: 're', v: src.slice(i, j) });
      i = j;
      continue;
    }
    let v = null;
    for (const p of PUNCT) {
      if (src.startsWith(p, i)) { v = p; break; }
    }
    if (v === '?.' && isDigit(src[i + 2])) v = '?'; // `a?.5:b` is a conditional
    if (v === null) throw new Error('Unexpected character ' + JSON.stringify(c) + ' at ' + i);
    const tk = { t: 'p', v };
    if (v === '{') {
      braces.push(braceKind());
    } else if (v === '}') {
      if (!braces.length) {
        if (inTpl) return { toks, i: i + 1 };
        throw new Error('Unbalanced }');
      }
      lastClosedBrace = braces.pop();
    } else if (v === '(') {
      const ctl = !!(prev && prev.t === 'name' && !prev.prop &&
        (/^(if|while|for|with)$/.test(prev.v) ||
          (prev.v === 'await' && prev2 && prev2.t === 'name' && prev2.v === 'for')));
      parens.push(ctl);
    } else if (v === ')') {
      tk.ctl = parens.length ? parens.pop() : false;
    }
    push(tk);
    i += v.length;
  }
  if (inTpl) throw new Error('Unterminated template expression');
  return { toks, i };
}

// Does a line break between `a` and `b` need to be preserved (ASI / restricted productions)?
// A newline is needed when the previous token can end a statement AND the next can start one (or continue an
// expression ambiguously), plus the restricted productions (return / throw / break / continue / yield / async
// followed by a newline) and prefix ++ / -- on the next line.
function keepNL(a, b) {
  if (a.t === 'hb') return true;
  if (a.t === 'tplh' || a.t === 'tplm' || b.t === 'tplm' || b.t === 'tplt') return false;
  if (a.t === 'name' && !a.prop && RESTRICTED.has(a.v)) return true;
  if (b.t === 'p' && (b.v === '++' || b.v === '--')) return true;
  let ends;
  if (a.t === 'name') ends = a.prop || !NO_END.has(a.v);
  else if (a.t === 'p') ends = a.v === ')' || a.v === ']' || a.v === '}' || a.v === '++' || a.v === '--';
  else ends = true; // num, str, re, tpl, tplt
  if (!ends) return false;
  if (b.t === 'name') {
    if (b.prop) return true;
    if (b.v === 'in' || b.v === 'instanceof') return false;
    // `try {} <nl> catch` / `} <nl> finally` never need the break.
    return !(NO_START.has(b.v) && a.t === 'p' && a.v === '}');
  }
  if (b.t === 'p') return START_P.has(b.v);
  return true; // num, str, re, tpl, tplh
}

const isWordCh = (c) => c !== undefined && (isIdPart(c) || c === '#');

// Would writing `at` immediately followed by `bt` change tokenization?
// '<!' and '</' are separated because the output may be inlined in a <script> element, where '</script' would end
// the element and '<!--' changes HTML tokenisation.
function needSpace(a, at, b, bt) {
  const x = at[at.length - 1], y = bt[0];
  if (isWordCh(x) && isWordCh(y)) return true;
  if (a.t === 're' && isWordCh(y)) return true;                   // /re/ in x  (flags!)
  if ((x === '+' && y === '+') || (x === '-' && y === '-')) return true; // a + +b, a - -b
  if (x === '/' && (y === '/' || y === '*')) return true;          // comment openers, a / /re/
  if (x === '<' && (y === '!' || y === '/')) return true;          // <!-- and </script in HTML
  if (x === '-' && y === '>' && at.endsWith('--')) return true;    // -->
  if (a.t === 'num' && y === '.' && /^[0-9][0-9_]*$/.test(at)) return true; // 1 .toString()
  return false;
}

export function emitJS(toks) {
  let out = '';
  let a = null, at = '';
  for (const b of toks) {
    const bt = b.v;
    if (a) {
      if (b.nl && keepNL(a, b)) out += '\n';
      else if (needSpace(a, at, b, bt)) out += ' ';
    }
    out += bt;
    a = b;
    at = bt;
  }
  return out;
}

export function minifyJSStrict(src) {
  return emitJS(tokenize(String(src), 0, false).toks);
}

// Fail-safe: syntax the tokenizer does not understand is shipped as written.
export function minifyJS(src) {
  try {
    return minifyJSStrict(src);
  } catch {
    return String(src); // unknown syntax: ship unminified rather than broken
  }
}
