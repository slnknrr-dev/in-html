// formula/parser.js - spreadsheet formula syntax (A1 style, Excel function names): tokenizer, parser to an AST,
// printer back to text and reference transforms (copy offsets, row / column insertion and deletion, sheet renames).
//
//   parseFormula(text) -> AST (throws FormulaSyntaxError); a leading '=' is optional
//   printFormula(ast) -> text without '='
//   translateFormula(text, dr, dc) -> text (relative references moved, like copy & paste)
//   shiftFormula(text, { sheet, formulaSheet, axis: 'row' | 'col', at, count }) -> text (count > 0 inserts, < 0 deletes)
//   renameSheetInFormula(text, oldName, newName) -> text
//   mapRefs(ast, fn) -> AST with every ref / range node replaced by fn(node)
//   quoteSheet(name) -> name as written before '!'
//
// AST nodes:
//   { type: 'num', v } { type: 'str', v } { type: 'bool', v } { type: 'err', v: '#N/A' } { type: 'missing' }
//   { type: 'ref', sheet, r, c, ar, ac }                       sheet: name or null (the formula's sheet)
//   { type: 'range', sheet, r1, c1, r2, c2, ar1, ac1, ar2, ac2 } whole columns: r1 = r2 = null; whole rows: c1 = c2 = null
//   { type: 'name', name } { type: 'unary', op, a } { type: 'postfix', op: '%', a } { type: 'bin', op, a, b }
//   { type: 'call', name, args } { type: 'paren', a } { type: 'array', rows: [[node]] }
// Precedence (Excel): ':' > unary - + > % > ^ > * / > + - > & > = <> < > <= >=; ^ is left-associative.

import { colIndex, colName, MAX_COLS, MAX_ROWS } from '../xlsx/cells.js';

export class FormulaSyntaxError extends Error {
  constructor(msg, at) { super(msg); this.at = at; }
}

// Sticky regexes (/y) probed at the current index: a cell reference is "letters then digits NOT followed by an
// identifier character, '(' '.' or '!'". The negative lookahead is what separates A1 from A1B (a name), LOG10( (a
// function) and a sheet called A1 (A1!B2). The upper bounds {1,3} letters / {1,7} digits match the grid limits.
const ERRORS = ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A', '#SPILL!', '#CALC!', '#GETTING_DATA', '#CIRC!', '#ERROR!'];
const RE_CELL = /(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![\w.(!À-￿])/y;
const RE_COLS = /(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})(?![\w.(!À-￿])/y;
const RE_ROWS = /(\$?)(\d{1,7}):(\$?)(\d{1,7})(?![\w.(À-￿])/y;
const RE_NUM = /(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
const RE_IDENT = /[A-Za-z_\\À-￿][\w.\\À-￿]*/y;
const OPS2 = ['<=', '>=', '<>'];
const OPS1 = '+-*/^&=<>%(),;:{}@';

function at(re, s, i) { re.lastIndex = i; return re.exec(s); }

// Character dispatch keeps failing regex probes to the token kinds that can start with the character.
// Dispatch on the first character code: only the token kinds that can start with it are tried, so most characters
// cost one or two regex probes instead of trying every pattern.
const isDigit = (c) => c >= 48 && c <= 57;
const isIdStart = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 92 || c >= 0xc0;
const isSpace = (c) => c === 32 || c === 9 || c === 10 || c === 13 || c === 0xa0;

function refToken(m, i) {
  const c = colIndex(m[2]);
  const r = +m[4] - 1;
  return c >= 0 && r >= 0 && r < MAX_ROWS ? { t: 'ref', r, c, ac: !!m[1], ar: !!m[3], at: i } : null;
}
function colsToken(m, i) {
  const c1 = colIndex(m[2]), c2 = colIndex(m[4]);
  return c1 >= 0 && c2 >= 0 ? { t: 'cols', c1, c2, ac1: !!m[1], ac2: !!m[3], at: i } : null;
}
function rowsToken(m, i) {
  const r1 = +m[2] - 1, r2 = +m[4] - 1;
  return r1 >= 0 && r2 >= 0 && r1 < MAX_ROWS && r2 < MAX_ROWS ? { t: 'rows', r1, r2, ar1: !!m[1], ar2: !!m[3], at: i } : null;
}

// Ambiguities resolved here, not in the parser: "1:3" is a row range (tried before a number), "A:C" a column range
// only when followed by ':', an identifier is a function only if '(' follows (spaces allowed), TRUE/FALSE are
// booleans, anything else is a defined name. Quoted strings and quoted sheet names use doubled quotes as escapes.
// Every token keeps `at` (source offset) for error messages and for position-based rewriting in locale.js.
export function tokenize(src) {
  const s = String(src);
  const toks = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const code = s.charCodeAt(i);
    const ch = s[i];
    if (isSpace(code)) { i++; continue; }
    if (ch === '"' || ch === "'") {
      let j = i + 1, v = '';
      for (;;) {
        const k = s.indexOf(ch, j);
        if (k < 0) throw new FormulaSyntaxError(ch === '"' ? 'unterminated string' : 'unterminated sheet name', i);
        if (s[k + 1] === ch) { v += s.slice(j, k + 1); j = k + 2; continue; }
        v += s.slice(j, k);
        j = k + 1;
        break;
      }
      if (ch === '"') toks.push({ t: 'str', v, at: i });
      else {
        if (s[j] !== '!') throw new FormulaSyntaxError('"!" expected after a sheet name', j);
        j++;
        toks.push({ t: 'sheet', v, at: i });
      }
      i = j;
      continue;
    }
    if (ch === '#') {
      const up = s.slice(i, i + 14).toUpperCase();
      const e = ERRORS.find((x) => up.startsWith(x));
      if (!e) throw new FormulaSyntaxError('unknown error literal', i);
      toks.push({ t: 'err', v: e, at: i });
      i += e.length;
      continue;
    }
    let m, tok = null;
    if (ch === '$') {
      if ((m = at(RE_CELL, s, i)) && (tok = refToken(m, i))) { toks.push(tok); i += m[0].length; continue; }
      if ((m = at(RE_COLS, s, i)) && (tok = colsToken(m, i))) { toks.push(tok); i += m[0].length; continue; }
      if ((m = at(RE_ROWS, s, i)) && (tok = rowsToken(m, i))) { toks.push(tok); i += m[0].length; continue; }
      throw new FormulaSyntaxError('reference expected after "$"', i);
    }
    if (isDigit(code) || ch === '.') {
      if (isDigit(code) && (m = at(RE_ROWS, s, i)) && (tok = rowsToken(m, i))) { toks.push(tok); i += m[0].length; continue; }
      if ((m = at(RE_NUM, s, i))) { toks.push({ t: 'num', v: Number(m[0]), at: i }); i += m[0].length; continue; }
      throw new FormulaSyntaxError('number expected', i);
    }
    if (isIdStart(code)) {
      m = at(RE_IDENT, s, i);
      const id = m[0];
      const end = i + id.length;
      if (s[end] === '!') { toks.push({ t: 'sheet', v: id, at: i }); i = end + 1; continue; }
      if (id.length <= 10 && (code < 0xc0)) {
        if ((m = at(RE_CELL, s, i)) && (tok = refToken(m, i))) { toks.push(tok); i += m[0].length; continue; }
        if (s[end] === ':' && (m = at(RE_COLS, s, i)) && (tok = colsToken(m, i))) { toks.push(tok); i += m[0].length; continue; }
      }
      let j = end;
      while (j < n && isSpace(s.charCodeAt(j))) j++;
      if (s[j] === '(') toks.push({ t: 'func', v: id, at: i });
      else if (/^(TRUE|FALSE)$/i.test(id)) toks.push({ t: 'bool', v: id.toUpperCase() === 'TRUE', at: i });
      else toks.push({ t: 'name', v: id, at: i });
      i = end;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (OPS2.includes(two)) { toks.push({ t: 'op', v: two, at: i }); i += 2; continue; }
    if (OPS1.includes(ch)) { toks.push({ t: 'op', v: ch, at: i }); i++; continue; }
    throw new FormulaSyntaxError(`unexpected "${ch}"`, i);
  }
  return toks;
}

// Binding powers of the binary operators (precedence climbing). binary(min) parses a left operand, then consumes
// operators with power >= min, parsing the right side at power + 1: that +1 makes every level LEFT-associative,
// including '^' (Excel evaluates 2^3^2 as 64, unlike mathematics). Unary minus is parsed below '^', so -2^2 = 4 as
// in Excel.
const BIN = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 };

// Function names as stored in files carry prefixes for newer functions (_xlfn.XLOOKUP, _xlfn._xlws.SORT).
// File formats store newer functions with future-function prefixes; normalizing to the bare name lets the engine
// register each function once. Printing does not restore prefixes (that is the xlsx writer's job).
export const normFuncName = (name) => String(name).toUpperCase().replace(/^(_XLFN\.)?(_XLWS\.)?/, '').replace(/^_XLFN\./, '');

export function parseFormula(text) {
  let src = String(text);
  if (src[0] === '=') src = src.slice(1);
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v) => toks[p] && toks[p].t === 'op' && toks[p].v === v;
  const fail = (msg) => { throw new FormulaSyntaxError(msg, toks[p] ? toks[p].at : src.length); };
  const expectOp = (v) => { if (!isOp(v)) fail(`"${v}" expected`); p++; };

  function binary(min) {
    let a = unary();
    for (;;) {
      const t = peek();
      if (!t || t.t !== 'op' || !(t.v in BIN) || BIN[t.v] < min) return a;
      p++;
      const b = binary(BIN[t.v] + 1);
      a = { type: 'bin', op: t.v, a, b };
    }
  }
  function unary() {
    if (isOp('-') || isOp('+') || isOp('@')) { const op = toks[p++].v; return { type: 'unary', op, a: unary() }; }
    let a = range();
    while (isOp('%')) { p++; a = { type: 'postfix', op: '%', a }; }
    return a;
  }
  // ':' binds tightest. A1:B5 with plain cell operands becomes one 'range' node with normalized corners (B5:A1 ==
  // A1:B5, each corner keeping its own $ flags); other operand combinations (A1:INDEX(...), name:name) stay a
  // binary ':' resolved at evaluation time.
  function range() {
    let a = primary();
    while (isOp(':')) {
      p++;
      const b = primary();
      if (a.type === 'ref' && b.type === 'ref' && (b.sheet == null || (a.sheet && b.sheet.toLowerCase() === a.sheet.toLowerCase()))) {
        a = {
          type: 'range', sheet: a.sheet, r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c),
          ar1: a.r <= b.r ? a.ar : b.ar, ac1: a.c <= b.c ? a.ac : b.ac, ar2: a.r <= b.r ? b.ar : a.ar, ac2: a.c <= b.c ? b.ac : a.ac,
        };
      } else a = { type: 'bin', op: ':', a, b };
    }
    return a;
  }
  function refTok(t, sheet) {
    if (t.t === 'ref') return { type: 'ref', sheet, r: t.r, c: t.c, ar: t.ar, ac: t.ac };
    if (t.t === 'cols') return { type: 'range', sheet, r1: null, r2: null, c1: Math.min(t.c1, t.c2), c2: Math.max(t.c1, t.c2), ar1: false, ar2: false, ac1: t.ac1, ac2: t.ac2 };
    return { type: 'range', sheet, r1: Math.min(t.r1, t.r2), r2: Math.max(t.r1, t.r2), c1: null, c2: null, ar1: t.ar1, ar2: t.ar2, ac1: false, ac2: false };
  }
  function constant() {
    let neg = false;
    if (isOp('-')) { p++; neg = true; }
    const t = toks[p++];
    if (!t) fail('constant expected');
    if (t.t === 'num') return { type: 'num', v: neg ? -t.v : t.v };
    if (neg) fail('number expected');
    if (t.t === 'str') return { type: 'str', v: t.v };
    if (t.t === 'bool') return { type: 'bool', v: t.v };
    if (t.t === 'err') return { type: 'err', v: t.v };
    p--;
    return fail('constant expected');
  }
  function primary() {
    const t = toks[p];
    if (!t) fail('unexpected end of formula');
    p++;
    switch (t.t) {
      case 'num': return { type: 'num', v: t.v };
      case 'str': return { type: 'str', v: t.v };
      case 'bool': return { type: 'bool', v: t.v };
      case 'err': return { type: 'err', v: t.v };
      case 'ref': case 'cols': case 'rows': return refTok(t, null);
      case 'sheet': {
        const u = toks[p++];
        if (u && (u.t === 'ref' || u.t === 'cols' || u.t === 'rows')) return refTok(u, t.v);
        if (u && u.t === 'err' && u.v === '#REF!') return { type: 'err', v: '#REF!' };
        if (u && u.t === 'name') return { type: 'name', name: u.v, sheet: t.v };
        p--;
        return fail('reference expected after the sheet name');
      }
      case 'name': return { type: 'name', name: t.v };
        // Empty arguments (IF(A1,,2)) become 'missing' nodes: functions distinguish an omitted argument from 0.
        // ';' is accepted as an argument separator too, for formulas pasted from semicolon locales.
      case 'func': {
        const name = normFuncName(t.v);
        expectOp('(');
        const args = [];
        if (isOp(')')) { p++; return { type: 'call', name, args }; }
        for (;;) {
          if (isOp(',') || isOp(';') || isOp(')')) args.push({ type: 'missing' });
          else args.push(binary(1));
          if (isOp(',') || isOp(';')) { p++; continue; }
          expectOp(')');
          return { type: 'call', name, args };
        }
      }
      case 'op':
        if (t.v === '(') { const a = binary(1); expectOp(')'); return { type: 'paren', a }; }
        if (t.v === '{') {
          const rows = [[]];
          for (;;) {
            rows[rows.length - 1].push(constant());
            if (isOp(',')) { p++; continue; }
            if (isOp(';')) { p++; rows.push([]); continue; }
            expectOp('}');
            break;
          }
          if (rows.some((r) => r.length !== rows[0].length)) fail('array rows differ in length');
          return { type: 'array', rows };
        }
        p--;
        return fail(`unexpected "${t.v}"`);
      default:
        p--;
        return fail('unexpected token');
    }
  }
  if (!toks.length) throw new FormulaSyntaxError('empty formula', 0);
  const ast = binary(1);
  if (p < toks.length) fail('unexpected ' + (toks[p].v ?? toks[p].t));
  return ast;
}

// --- printing ----------------------------------------------------------------------------

// A sheet name must be quoted when it is not a plain identifier, or when it would read as something else: a cell
// reference (A1), an R1C1 reference or a boolean.
const PLAIN_SHEET = /^[A-Za-z_À-￿][\w.À-￿]*$/;
export function quoteSheet(name) {
  const s = String(name);
  if (PLAIN_SHEET.test(s) && !/^[A-Za-z]{1,3}\d+$/.test(s) && !/^(R\d*C\d*|TRUE|FALSE)$/i.test(s)) return s;
  return "'" + s.replace(/'/g, "''") + "'";
}

export function numText(v) {
  if (Number.isInteger(v) && Math.abs(v) < 1e21) return String(v);
  return String(v).toUpperCase();
}

const refText = (r, c, ar, ac) => (ac ? '$' : '') + colName(c) + (ar ? '$' : '') + (r + 1);

export function printFormula(n) {
  switch (n.type) {
    case 'num': return numText(n.v);
    case 'str': return '"' + n.v.replace(/"/g, '""') + '"';
    case 'bool': return n.v ? 'TRUE' : 'FALSE';
    case 'err': return n.v;
    case 'missing': return '';
    case 'ref': return (n.sheet != null ? quoteSheet(n.sheet) + '!' : '') + refText(n.r, n.c, n.ar, n.ac);
    case 'range': {
      const pre = n.sheet != null ? quoteSheet(n.sheet) + '!' : '';
      if (n.r1 == null) return pre + (n.ac1 ? '$' : '') + colName(n.c1) + ':' + (n.ac2 ? '$' : '') + colName(n.c2);
      if (n.c1 == null) return pre + (n.ar1 ? '$' : '') + (n.r1 + 1) + ':' + (n.ar2 ? '$' : '') + (n.r2 + 1);
      return pre + refText(n.r1, n.c1, n.ar1, n.ac1) + ':' + refText(n.r2, n.c2, n.ar2, n.ac2);
    }
    case 'name': return (n.sheet != null ? quoteSheet(n.sheet) + '!' : '') + n.name;
    case 'unary': return n.op + printFormula(n.a);
    case 'postfix': return printFormula(n.a) + '%';
    case 'bin': return printFormula(n.a) + n.op + printFormula(n.b);
    case 'call': return n.name + '(' + n.args.map(printFormula).join(',') + ')';
    case 'paren': return '(' + printFormula(n.a) + ')';
    case 'array': return '{' + n.rows.map((r) => r.map(printFormula).join(',')).join(';') + '}';
    default: return '';
  }
}

// --- transforms --------------------------------------------------------------------------

// Generic reference rewriter: all reference transforms (copy offset, insert/delete, rename, drop) are a function
// applied to ref/range nodes, then re-printed. Working on the AST, never on text, avoids rewriting look-alikes inside
// strings.
// KNOWN LIMIT: 'name' nodes are not visited, so a sheet-scoped name (Sheet1!Total) keeps the old sheet name after
// renameSheetInFormula and is not turned into #REF! by dropSheetInFormula.
export function mapRefs(n, fn) {
  switch (n.type) {
    case 'ref': case 'range': return fn(n);
    case 'unary': case 'postfix': case 'paren': return { ...n, a: mapRefs(n.a, fn) };
    case 'bin': return { ...n, a: mapRefs(n.a, fn), b: mapRefs(n.b, fn) };
    case 'call': return { ...n, args: n.args.map((a) => mapRefs(a, fn)) };
    default: return n;
  }
}

const REF_ERR = { type: 'err', v: '#REF!' };
const inRows = (r) => r >= 0 && r < MAX_ROWS;
const inCols = (c) => c >= 0 && c < MAX_COLS;

// Copy/paste semantics: relative parts move by the offset, $-absolute parts stay. A reference pushed off the grid
// becomes #REF!, exactly what spreadsheets show.
export function translateAST(ast, dr, dc) {
  return mapRefs(ast, (n) => {
    if (n.type === 'ref') {
      const r = n.ar ? n.r : n.r + dr, c = n.ac ? n.c : n.c + dc;
      return inRows(r) && inCols(c) ? { ...n, r, c } : REF_ERR;
    }
    const m = { ...n };
    if (n.r1 != null) { m.r1 = n.ar1 ? n.r1 : n.r1 + dr; m.r2 = n.ar2 ? n.r2 : n.r2 + dr; }
    if (n.c1 != null) { m.c1 = n.ac1 ? n.c1 : n.c1 + dc; m.c2 = n.ac2 ? n.c2 : n.c2 + dc; }
    if ((m.r1 != null && (!inRows(m.r1) || !inRows(m.r2))) || (m.c1 != null && (!inCols(m.c1) || !inCols(m.c2)))) return REF_ERR;
    return m;
  });
}

// Transforms never throw: an unparsable formula is returned unchanged (minus '='), so a sheet operation cannot fail
// because one cell holds a broken formula.
export function translateFormula(text, dr, dc) {
  try { return printFormula(translateAST(parseFormula(text), dr, dc)); } catch { return String(text).replace(/^=/, ''); }
}

// Position p after inserting (count > 0) or deleting (count < 0) at `at`; null when the position was deleted.
function shiftPos(p, at, count) {
  if (p < at) return p;
  if (count > 0) return p + count;
  return p < at - count ? null : p + count;
}

// Range ends [a, b] after the change; null when nothing remains.
// Range ends under insertion/deletion: an insertion inside a range grows it; a deletion clips it and only a range
// entirely inside the deleted band disappears (null -> #REF!). Single references die when their row/column dies.
function shiftSpan(a, b, at, count) {
  if (count > 0) return [a >= at ? a + count : a, b >= at ? b + count : b];
  const end = at - count; // deleted [at, end)
  const na = a < at ? a : a >= end ? a + count : at;
  const nb = b < at ? b : b >= end ? b + count : at - 1;
  return nb < na ? null : [na, nb];
}

// A reference without a sheet means the formula's own sheet, so it is affected only when that is the edited sheet.
// Whole-column ranges are unaffected by row edits and vice versa. Sheet names compare case-insensitively.
export function shiftAST(ast, { sheet, formulaSheet, axis, at, count }) {
  const target = String(sheet).toLowerCase();
  const own = String(formulaSheet ?? '').toLowerCase();
  return mapRefs(ast, (n) => {
    if (String(n.sheet ?? own).toLowerCase() !== target) return n;
    if (n.type === 'ref') {
      if (axis === 'row') { const r = shiftPos(n.r, at, count); return r == null || !inRows(r) ? REF_ERR : { ...n, r }; }
      const c = shiftPos(n.c, at, count);
      return c == null || !inCols(c) ? REF_ERR : { ...n, c };
    }
    if (axis === 'row') {
      if (n.r1 == null) return n;
      const s = shiftSpan(n.r1, n.r2, at, count);
      return !s || !inRows(s[1]) ? REF_ERR : { ...n, r1: s[0], r2: s[1] };
    }
    if (n.c1 == null) return n;
    const s = shiftSpan(n.c1, n.c2, at, count);
    return !s || !inCols(s[1]) ? REF_ERR : { ...n, c1: s[0], c2: s[1] };
  });
}

export function shiftFormula(text, opts) {
  try { return printFormula(shiftAST(parseFormula(text), opts)); } catch { return String(text).replace(/^=/, ''); }
}

export function renameSheetInFormula(text, oldName, newName) {
  const o = String(oldName).toLowerCase();
  try {
    const ast = mapRefs(parseFormula(text), (n) => (n.sheet != null && n.sheet.toLowerCase() === o ? { ...n, sheet: newName } : n));
    return printFormula(ast);
  } catch { return String(text).replace(/^=/, ''); }
}

// Formulas that mention a sheet (deleting it turns them into #REF!).
export function dropSheetInFormula(text, name) {
  const o = String(name).toLowerCase();
  try {
    return printFormula(mapRefs(parseFormula(text), (n) => (n.sheet != null && n.sheet.toLowerCase() === o ? REF_ERR : n)));
  } catch { return String(text).replace(/^=/, ''); }
}
