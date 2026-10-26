// parse.js - ECMAScript 2024 parser producing an ESTree AST. Zero dependencies, Node and Bun.
//
//   import { parse } from './parse.js';
//   const ast = parse(source, { sourceType: 'module', file: 'a.js', tokens: true });
//   ast.comments -> [{ type: 'Line'|'Block', value, start, end }]
//   ast.tokens   -> [{ type, value, start, end, nl }]   (only with `tokens: true`)
//
// Node shapes and ranges follow ESTree exactly as acorn emits them (no ParenthesizedExpression,
// ChainExpression wraps optional chains, Property / MethodDefinition / PropertyDefinition, ...),
// so a parse can be checked node by node against a reference parser. Token types:
// 'name' (identifiers and keywords), 'num', 'string', 'template' (one chunk: `...${, }...${ or }...`),
// 'regexp', 'private' (#name), 'punct', 'eof'. `nl` is true when a line break precedes the token.
// Out of scope: JSX, TypeScript, decorators, early-error validation beyond what parsing needs.
//
// Role in the build: the single front end of bundle.js (module graph, scope analysis), singlefile.js finishJS
// (token stream for the minifier, and a syntax check of every generated bundle) and check.js. One parser for all
// three guarantees they agree on what the code means.
// Architecture: a hand-written recursive-descent parser with an on-demand lexer (one token of lookahead plus
// snapshot/restore for the few places that need more). Why not a generated parser: JavaScript's grammar is not
// context-free at the token level. '/' is division or a regex, '}' ends a block or continues a template, `async`,
// `let`, `yield`, `of`, `get` are keywords only in context. A recursive-descent parser knows the syntactic context
// at every point, so the lexer is driven by it (rescanRegex, rescanTemplate) instead of guessing.
// Cover grammar: `(a, b)` and `{a, b}` are parsed as expressions first and converted to patterns (toAssignable)
// when a following '=>' or '=' reveals they were parameters/targets: the standard technique that avoids unbounded
// backtracking. Token positions are kept exactly (start/end, nl) because downstream tools splice source text.
// Strictness: errors are raised only where needed to parse unambiguously; early errors (duplicate params, mixing
// ?? with || unparenthesised, etc.) are accepted. Input is code the repository already runs in browsers.

const KEYWORDS = new Set(['break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete',
  'do', 'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'new',
  'return', 'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'null', 'true',
  'false', 'enum']);
const STRICT_RESERVED = new Set(['implements', 'interface', 'let', 'package', 'private', 'protected', 'public',
  'static', 'yield']);

// Punctuators, longest first.
// Longest-match lexing requires trying longer punctuators first ('>>>=' before '>>>' before '>>' before '>'),
// otherwise `a >>>= b` would lex as '>>' '>='. Bucketing by first char keeps the scan to a handful of candidates.
const PUNCT = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '=>', '==', '!=',
  '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<',
  '>>', '{', '}', '(', ')', '[', ']', ';', ',', '<', '>', '+', '-', '*', '/', '%', '&', '|', '^', '!', '~', '?',
  ':', '=', '.', '@'];
const PUNCT_BY_CHAR = new Map();
for (const p of PUNCT) {
  const list = PUNCT_BY_CHAR.get(p[0]) || [];
  list.push(p);
  PUNCT_BY_CHAR.set(p[0], list);
}

// Precedence climbing table (higher binds tighter). '**' is absent: it is right-associative and binds tighter than
// unary operators' operands, so parseMaybeUnary handles it. '??' shares level 1 with '||' for climbing; the
// spec's ban on mixing them without parentheses is not enforced.
const BINARY_PREC = {
  '??': 1, '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '===': 6, '!==': 6,
  '<': 7, '>': 7, '<=': 7, '>=': 7, 'instanceof': 7, 'in': 7, '<<': 8, '>>': 8, '>>>': 8,
  '+': 9, '-': 9, '*': 10, '/': 10, '%': 10,
};
const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '|=', '^=',
  '&&=', '||=', '??=']);
const UNARY_KW = new Set(['typeof', 'void', 'delete']);
// Keywords that can start an expression.
const EXPR_KW = new Set(['this', 'super', 'null', 'true', 'false', 'function', 'class', 'new', 'typeof', 'void',
  'delete', 'import']);
const EXPR_PUNCT = new Set(['(', '[', '{', '+', '-', '!', '~', '++', '--', '/', '/=', '#']);

// Unicode property escapes give the exact spec identifier classes; the ASCII fast path in isIdStart/isIdChar avoids
// a regex call for 99% of characters. U+200C/U+200D (ZWNJ/ZWJ) are allowed inside identifiers by the spec.
const ID_START_RE = /[\p{ID_Start}$_]/u;
const ID_CONT_RE = /[\p{ID_Continue}$\u200c\u200d]/u;

function isIdStart(cp) {
  if (cp < 128) return (cp >= 97 && cp <= 122) || (cp >= 65 && cp <= 90) || cp === 36 || cp === 95;
  return ID_START_RE.test(String.fromCodePoint(cp));
}
function isIdChar(cp) {
  if (cp < 128) {
    return (cp >= 97 && cp <= 122) || (cp >= 65 && cp <= 90) || (cp >= 48 && cp <= 57) || cp === 36 || cp === 95;
  }
  return ID_CONT_RE.test(String.fromCodePoint(cp));
}
function isNewline(c) {
  return c === 10 || c === 13 || c === 0x2028 || c === 0x2029;
}
function isSpace(c) {
  return c === 32 || c === 9 || c === 11 || c === 12 || c === 160 || c === 0xfeff ||
    (c > 255 && /[\u1680\u2000-\u200a\u202f\u205f\u3000]/.test(String.fromCharCode(c)));
}

export class Parser {
  constructor(input, options = {}) {
    this.input = String(input);
    this.file = options.file || '<input>';
    this.module = (options.sourceType || 'module') === 'module';
    this.comments = [];
    this.tokens = options.tokens ? [] : null;
    this.pos = 0;
    // Current token.
    this.type = 'eof';
    this.value = null;
    this.start = 0;
    this.end = 0;
    this.nl = false;
    this.escaped = false;
    this.lastEnd = 0;          // end of the previous token
    // Function context.
    this.inFunction = false;
    this.inAsync = false;
    this.inGenerator = false;
    this.labels = [];
    if (this.input.startsWith('#!')) {
      let e = 2;
      while (e < this.input.length && !isNewline(this.input.charCodeAt(e))) e++;
      this.comments.push({ type: 'Hashbang', value: this.input.slice(2, e), start: 0, end: e });
      this.pos = e;
    }
    this.next();
  }

  // ---------------------------------------------------------------------------------------------
  // Errors and positions

  // Computed lazily (only when raising): tracking line/column per token would tax every successful parse. CRLF
  // counts once: a CR followed by LF is skipped and the LF counts the line.
  lineCol(pos) {
    let line = 1, col = 0;
    for (let i = 0; i < pos && i < this.input.length; i++) {
      const c = this.input.charCodeAt(i);
      if (c === 10 || (c === 13 && this.input.charCodeAt(i + 1) !== 10) || c === 0x2028 || c === 0x2029) {
        line++;
        col = 0;
      } else col++;
    }
    return { line, col };
  }

  raise(pos, msg) {
    const { line, col } = this.lineCol(pos);
    const err = new SyntaxError(`${msg} (${this.file}:${line}:${col + 1})`);
    err.pos = pos;
    err.loc = { line, column: col };
    throw err;
  }

  unexpected(pos = this.start) {
    const what = this.type === 'eof' ? 'end of input' : JSON.stringify(this.input.slice(this.start, this.end));
    this.raise(pos, 'Unexpected token ' + what);
  }

  // ---------------------------------------------------------------------------------------------
  // Lexer

  // Whitespace and comments are consumed between tokens, and `nl` records whether a line terminator was crossed:
  // automatic semicolon insertion and restricted productions (return\nx, x\n++, async\nfunction, a\n=>) depend on it.
  // A block comment containing a newline counts as a newline (spec). HTML-like comments (<!-- and a line-leading -->)
  // are legacy Annex B syntax, honoured only in classic scripts, never in modules.
  skipSpace() {
    const s = this.input;
    const n = s.length;
    while (this.pos < n) {
      const c = s.charCodeAt(this.pos);
      if (isNewline(c)) {
        this.nl = true;
        this.pos++;
      } else if (isSpace(c)) {
        this.pos++;
      } else if (c === 47) { // '/'
        const d = s.charCodeAt(this.pos + 1);
        if (d === 47) {
          const st = this.pos;
          this.pos += 2;
          while (this.pos < n && !isNewline(s.charCodeAt(this.pos))) this.pos++;
          this.comments.push({ type: 'Line', value: s.slice(st + 2, this.pos), start: st, end: this.pos });
        } else if (d === 42) {
          const st = this.pos;
          const e = s.indexOf('*/', st + 2);
          if (e < 0) this.raise(st, 'Unterminated comment');
          const body = s.slice(st + 2, e);
          if (/[\n\r\u2028\u2029]/.test(body)) this.nl = true;
          this.pos = e + 2;
          this.comments.push({ type: 'Block', value: body, start: st, end: this.pos });
        } else break;
      } else if (!this.module && c === 60 && s.startsWith('<!--', this.pos)) {
        while (this.pos < n && !isNewline(s.charCodeAt(this.pos))) this.pos++;
      } else if (!this.module && c === 45 && this.nl && s.startsWith('-->', this.pos)) {
        while (this.pos < n && !isNewline(s.charCodeAt(this.pos))) this.pos++;
      } else break;
    }
  }

  finishToken(type, value, end = this.pos) {
    this.type = type;
    this.value = value;
    this.end = end;
    this.pos = end;
    if (this.tokens) this.recordToken();
  }

  // The token array is built as a side effect of lexing so callers get tokens and AST from one pass. A rescan
  // re-lexes at the same start, so it replaces the previous token instead of appending.
  recordToken() {
    const t = { type: this.type, value: this.value, start: this.start, end: this.end, nl: this.nl };
    const last = this.tokens[this.tokens.length - 1];
    // Re-scans (regexp, template continuation) replace the token read at the same position.
    if (last && last.start === t.start) this.tokens[this.tokens.length - 1] = t;
    else this.tokens.push(t);
  }

  next() {
    this.lastEnd = this.end;
    this.nl = false;
    this.escaped = false;
    this.skipSpace();
    this.start = this.pos;
    if (this.pos >= this.input.length) return this.finishToken('eof', null);
    const c = this.input.codePointAt(this.pos);
    if (isIdStart(c) || c === 92) return this.readWord();
    if (c >= 48 && c <= 57) return this.readNumber();
    // '.5' is a number; '.' followed by anything else is the member operator or the start of '...'.
    if (c === 46 && /[0-9]/.test(this.input[this.pos + 1] || '')) return this.readNumber();
    if (c === 34 || c === 39) return this.readString(c);
    if (c === 96) return this.readTemplate(this.pos + 1);
    if (c === 35) {
      this.pos++;
      const name = this.readWordRaw();
      if (!name) this.raise(this.start, 'Unexpected character "#"');
      return this.finishToken('private', name);
    }
    const list = PUNCT_BY_CHAR.get(this.input[this.pos]);
    if (list) {
      for (const p of list) {
        if (this.input.startsWith(p, this.pos)) {
          // `a?.5:b` is a conditional, not optional chaining.
          if (p === '?.' && /[0-9]/.test(this.input[this.pos + 2] || '')) continue;
          return this.finishToken('punct', p, this.pos + p.length);
        }
      }
    }
    this.raise(this.pos, 'Unexpected character ' + JSON.stringify(String.fromCodePoint(c)));
  }

  readWordRaw() {
    let word = '';
    let chunk = this.pos;
    let first = true;
    const s = this.input;
    while (this.pos < s.length) {
      const c = s.codePointAt(this.pos);
      if (first ? isIdStart(c) : isIdChar(c)) {
        this.pos += c > 0xffff ? 2 : 1;
      } else if (c === 92) {
        word += s.slice(chunk, this.pos);
        if (s[this.pos + 1] !== 'u') this.raise(this.pos, 'Bad escape in identifier');
        this.pos += 2;
        const cp = this.readCodePoint();
        if (!(first ? isIdStart(cp) : isIdChar(cp))) this.raise(this.pos, 'Invalid identifier escape');
        word += String.fromCodePoint(cp);
        this.escaped = true;
        chunk = this.pos;
      } else break;
      first = false;
    }
    return word + s.slice(chunk, this.pos);
  }

  readWord() {
    const word = this.readWordRaw();
    return this.finishToken('name', word);
  }

  readHex(len) {
    const h = this.input.slice(this.pos, this.pos + len);
    if (h.length !== len || !/^[0-9a-fA-F]+$/.test(h)) this.raise(this.pos, 'Bad hexadecimal escape');
    this.pos += len;
    return parseInt(h, 16);
  }

  // After `\u`: XXXX or {X...}.
  readCodePoint() {
    if (this.input[this.pos] === '{') {
      const e = this.input.indexOf('}', this.pos);
      const h = this.input.slice(this.pos + 1, e);
      if (e < 0 || !/^[0-9a-fA-F]+$/.test(h) || parseInt(h, 16) > 0x10ffff) this.raise(this.pos, 'Bad unicode escape');
      this.pos = e + 1;
      return parseInt(h, 16);
    }
    return this.readHex(4);
  }

  // Values are computed for Literal.value, but downstream tools re-emit the raw source slice, so spelling (0x1F,
  // 1_000, 1e3) survives. BigInt literals keep the digit string (this.bigint) since a Number would lose precision.
  // KNOWN DEFECT: the 0x/0o/0b branch scans [0-9a-fA-F_] for every radix, so `0b12` or `0o9` is accepted and
  // parseInt silently stops at the first invalid digit (0b12 -> 1). Fix: choose the digit class by radix and raise.
  readNumber() {
    const s = this.input;
    const st = this.pos;
    let bigint = false;
    let value;
    const c1 = s[st + 1];
    if (s[st] === '0' && c1 && /[xXoObB]/.test(c1)) {
      const radix = /[xX]/.test(c1) ? 16 : /[oO]/.test(c1) ? 8 : 2;
      this.pos += 2;
      const ds = this.pos;
      while (this.pos < s.length && /[0-9a-fA-F_]/.test(s[this.pos])) this.pos++;
      const digits = s.slice(ds, this.pos).replace(/_/g, '');
      if (!digits) this.raise(st, 'Expected number');
      if (s[this.pos] === 'n') { bigint = true; this.pos++; }
      value = bigint ? null : parseInt(digits, radix);
    } else if (s[st] === '0' && /[0-9]/.test(c1 || '') && !this.module) {
      // Legacy octal / leading-zero decimal (sloppy scripts only).
      while (/[0-9]/.test(s[this.pos] || '')) this.pos++;
      const digits = s.slice(st, this.pos);
      value = /[89]/.test(digits) ? parseFloat(digits) : parseInt(digits, 8);
    } else {
      while (/[0-9_]/.test(s[this.pos] || '')) this.pos++;
      let isInt = true;
      if (s[this.pos] === '.') {
        isInt = false;
        this.pos++;
        while (/[0-9_]/.test(s[this.pos] || '')) this.pos++;
      }
      if (/[eE]/.test(s[this.pos] || '')) {
        const save = this.pos;
        this.pos++;
        if (/[+-]/.test(s[this.pos] || '')) this.pos++;
        if (!/[0-9]/.test(s[this.pos] || '')) this.pos = save;
        else {
          isInt = false;
          while (/[0-9_]/.test(s[this.pos] || '')) this.pos++;
        }
      }
      if (isInt && s[this.pos] === 'n') { bigint = true; this.pos++; }
      value = bigint ? null : parseFloat(s.slice(st, this.pos).replace(/_/g, ''));
    }
    if (isIdStart(s.codePointAt(this.pos) || 0)) this.raise(this.pos, 'Identifier directly after number');
    this.finishToken('num', value);
    if (bigint) this.bigint = s.slice(st, this.pos - 1).replace(/_/g, '');
    else this.bigint = null;
  }

  // Reads one escape after the backslash; returns the cooked text or null when invalid (templates).
  // Templates allow invalid escapes when tagged (cooked becomes null, raw is kept: ES2018 template revision), so
  // errors are reported as null there and raised only for strings. Legacy octal escapes are accepted for strings
  // (sloppy-mode compatibility); a line continuation (backslash + newline) contributes nothing.
  readEscape(inTemplate) {
    const s = this.input;
    const c = s[this.pos++];
    switch (c) {
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case 'b': return '\b';
      case 'v': return '\u000b';
      case 'f': return '\f';
      case '\r': if (s[this.pos] === '\n') this.pos++; return '';
      case '\n': case '\u2028': case '\u2029': return '';
      case 'x': {
        const h = s.slice(this.pos, this.pos + 2);
        if (!/^[0-9a-fA-F]{2}$/.test(h)) {
          if (inTemplate) return null;
          this.raise(this.pos, 'Bad hexadecimal escape');
        }
        this.pos += 2;
        return String.fromCharCode(parseInt(h, 16));
      }
      case 'u': {
        if (inTemplate) {
          const save = this.pos;
          try {
            return String.fromCodePoint(this.readCodePoint());
          } catch {
            this.pos = save;
            return null;
          }
        }
        return String.fromCodePoint(this.readCodePoint());
      }
      default:
        if (c >= '0' && c <= '7') {
          if (c === '0' && !/[0-9]/.test(s[this.pos] || '')) return '\0';
          if (inTemplate) return null;
          let oct = c;
          while (oct.length < 3 && /[0-7]/.test(s[this.pos] || '') && parseInt(oct + s[this.pos], 8) <= 255) {
            oct += s[this.pos++];
          }
          return String.fromCharCode(parseInt(oct, 8));
        }
        if (c === '8' || c === '9') {
          if (inTemplate) return null;
          return c;
        }
        if (c === undefined) this.raise(this.pos, 'Unterminated string');
        return c;
    }
  }

  readString(quote) {
    const s = this.input;
    this.pos++;
    let out = '';
    let chunk = this.pos;
    for (;;) {
      if (this.pos >= s.length) this.raise(this.start, 'Unterminated string constant');
      const c = s.charCodeAt(this.pos);
      if (c === quote) break;
      if (c === 92) {
        out += s.slice(chunk, this.pos);
        this.pos++;
        out += this.readEscape(false);
        chunk = this.pos;
      } else if (c === 10 || c === 13) {
        this.raise(this.start, 'Unterminated string constant');
      } else this.pos++;
    }
    out += s.slice(chunk, this.pos);
    this.pos++;
    this.finishToken('string', out);
  }

  // Reads a template chunk starting at `from` (just after "`" or "}") up to "${" or the closing "`".
  readTemplate(from) {
    const s = this.input;
    this.pos = from;
    let cooked = '';
    let chunk = from;
    let invalid = false;
    for (;;) {
      if (this.pos >= s.length) this.raise(this.start, 'Unterminated template');
      const c = s.charCodeAt(this.pos);
      if (c === 96 || (c === 36 && s.charCodeAt(this.pos + 1) === 123)) {
        const rawEnd = this.pos;
        if (!invalid) cooked += s.slice(chunk, rawEnd);
        const raw = s.slice(from, rawEnd).replace(/\r\n?/g, '\n');
        const tail = c === 96;
        this.pos += tail ? 1 : 2;
        this.finishToken('template', { raw, cooked: invalid ? null : cooked.replace(/\r\n?/g, '\n'), tail,
          rawStart: from, rawEnd });
        return;
      }
      if (c === 92) {
        if (!invalid) cooked += s.slice(chunk, this.pos);
        this.pos++;
        const e = this.readEscape(true);
        if (e === null) invalid = true;
        else if (!invalid) cooked += e;
        chunk = this.pos;
      } else this.pos++;
    }
  }

  // The parser saw "/" or "/=" where an expression starts: re-read it as a regular expression.
  // Called only by the parser, at a point where an expression may start: this is how the '/' ambiguity is solved
  // without lexer heuristics. Inside a character class '/' does not terminate (/[/]/). Flags are scanned as identifier
  // characters and validated lazily by new RegExp in parseLiteral (a value of null marks an unsupported regex).
  rescanRegex() {
    const s = this.input;
    this.pos = this.start + 1;
    let inClass = false;
    for (;;) {
      if (this.pos >= s.length || isNewline(s.charCodeAt(this.pos))) this.raise(this.start, 'Unterminated regexp');
      const c = s[this.pos];
      if (c === '\\') this.pos += 2;
      else {
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
        this.pos++;
      }
    }
    const pattern = s.slice(this.start + 1, this.pos);
    this.pos++;
    const fs = this.pos;
    while (this.pos < s.length && isIdChar(s.codePointAt(this.pos))) this.pos++;
    const flags = s.slice(fs, this.pos);
    this.finishToken('regexp', { pattern, flags });
  }

  // The parser closed a "${...}" substitution: the current "}" token continues the template.
  rescanTemplate() {
    if (!this.isP('}')) this.unexpected();
    this.readTemplate(this.start + 1);
  }

  // Bounded backtracking: snapshot/restore save the full lexer state and truncate comments/tokens recorded since.
  // Used for peek() and for the few ambiguous prefixes (async arrow, directives); never for whole subtrees.
  snapshot() {
    return {
      pos: this.pos, type: this.type, value: this.value, start: this.start, end: this.end, nl: this.nl,
      escaped: this.escaped, lastEnd: this.lastEnd, comments: this.comments.length,
      tokens: this.tokens ? this.tokens.length : 0, bigint: this.bigint,
    };
  }

  restore(st) {
    Object.assign(this, {
      pos: st.pos, type: st.type, value: st.value, start: st.start, end: st.end, nl: st.nl,
      escaped: st.escaped, lastEnd: st.lastEnd, bigint: st.bigint,
    });
    this.comments.length = st.comments;
    if (this.tokens) this.tokens.length = st.tokens;
  }

  peek() {
    const st = this.snapshot();
    this.next();
    const t = { type: this.type, value: this.value, start: this.start, end: this.end, nl: this.nl };
    this.restore(st);
    return t;
  }

  // ---------------------------------------------------------------------------------------------
  // Token helpers

  isP(v) { return this.type === 'punct' && this.value === v; }
  isName(v) { return this.type === 'name' && this.value === v && !this.escaped; }
  isKw(v) { return this.isName(v); }
  eatP(v) {
    if (this.isP(v)) { this.next(); return true; }
    return false;
  }
  eatName(v) {
    if (this.isName(v)) { this.next(); return true; }
    return false;
  }
  expectP(v) {
    if (!this.eatP(v)) this.unexpected();
  }
  expectName(v) {
    if (!this.eatName(v)) this.unexpected();
  }
  canInsertSemicolon() {
    return this.type === 'eof' || this.isP('}') || this.nl;
  }
  semicolon() {
    if (!this.eatP(';') && !this.canInsertSemicolon()) this.unexpected();
  }
  isIdentToken() {
    return this.type === 'name' && (!KEYWORDS.has(this.value) || this.escaped);
  }
  startsExpr() {
    if (this.type === 'punct') return EXPR_PUNCT.has(this.value);
    if (this.type === 'name') return !KEYWORDS.has(this.value) || EXPR_KW.has(this.value);
    return this.type !== 'eof';
  }

  node(start) {
    return { type: '', start, end: 0 };
  }
  finish(node, type, end = this.lastEnd) {
    node.type = type;
    node.end = end;
    return node;
  }

  // ---------------------------------------------------------------------------------------------
  // Program and statements

  parseTopLevel() {
    const node = this.node(0);
    node.body = [];
    this.parseDirectives(node.body);
    while (this.type !== 'eof') node.body.push(this.parseStatement(true));
    node.sourceType = this.module ? 'module' : 'script';
    this.finish(node, 'Program', this.input.length);
    node.comments = this.comments;
    if (this.tokens) node.tokens = this.tokens.filter((t) => t.type !== 'eof');
    return node;
  }

  // A directive is a string-literal statement at the start of a body ('use strict'). It is parsed as an expression
  // and accepted only if it turns out to be exactly one string literal ('a' + b is an ordinary statement, restored).
  parseDirectives(body) {
    while (this.type === 'string') {
      const st = this.snapshot();
      const raw = this.input.slice(this.start + 1, this.end - 1);
      const expr = this.parseExpression();
      if (expr.type !== 'Literal' || typeof expr.value !== 'string' || expr.start !== st.start) {
        this.restore(st);
        return;
      }
      const stmt = this.node(expr.start);
      stmt.expression = expr;
      stmt.directive = raw;
      this.semicolon();
      body.push(this.finish(stmt, 'ExpressionStatement'));
    }
  }

  parseStatement(topLevel = false) {
    const start = this.start;
    if (this.type === 'punct') {
      switch (this.value) {
        case '{': return this.parseBlock();
        case ';': {
          const node = this.node(start);
          this.next();
          return this.finish(node, 'EmptyStatement');
        }
      }
    }
    if (this.type === 'name' && !this.escaped) {
      switch (this.value) {
        case 'var': case 'const': return this.parseVarStatement(this.value);
          // `let` is an identifier in sloppy scripts (let = 1; let[0]) but a declaration when followed by a binding;
          // in modules (always strict) it is always a declaration.
        case 'let': {
          const p = this.peek();
          if (p.type === 'name' || (p.type === 'punct' && (p.value === '[' || p.value === '{')) || this.module) {
            return this.parseVarStatement('let');
          }
          break;
        }
        case 'function': return this.parseFunction(this.node(start), true, false);
        case 'class': return this.parseClass(this.node(start), true);
        case 'if': return this.parseIf();
        case 'for': return this.parseFor();
        case 'while': return this.parseWhile();
        case 'do': return this.parseDoWhile();
        case 'return': return this.parseReturn();
        case 'break': case 'continue': return this.parseBreakContinue(this.value);
        case 'throw': return this.parseThrow();
        case 'try': return this.parseTry();
        case 'switch': return this.parseSwitch();
        case 'debugger': {
          const node = this.node(start);
          this.next();
          this.semicolon();
          return this.finish(node, 'DebuggerStatement');
        }
        case 'with': return this.parseWith();
          // import( and import. are expressions (dynamic import, import.meta), valid anywhere; only the declaration
          // form is restricted to module top level.
        case 'import': {
          const p = this.peek();
          if (!(p.type === 'punct' && (p.value === '(' || p.value === '.'))) {
            if (!this.module || !topLevel) this.raise(start, "'import' is only allowed at the top level of a module");
            return this.parseImport();
          }
          break;
        }
        case 'export':
          if (!this.module || !topLevel) this.raise(start, "'export' is only allowed at the top level of a module");
          return this.parseExport();
        case 'async': {
          const p = this.peek();
          if (p.type === 'name' && p.value === 'function' && !p.nl) {
            const node = this.node(start);
            this.next();
            return this.parseFunction(node, true, true);
          }
          break;
        }
      }
    }
    // Labeled statement or expression statement.
    if (this.isIdentToken() || this.isName('yield') || this.isName('await') || this.isName('let')) {
      const p = this.peek();
      if (p.type === 'punct' && p.value === ':' && !(this.value === 'await' && (this.module || this.inAsync))) {
        const node = this.node(start);
        const label = this.parseIdent();
        this.expectP(':');
        this.labels.push(label.name);
        node.body = this.parseStatement();
        this.labels.pop();
        node.label = label;
        return this.finish(node, 'LabeledStatement');
      }
    }
    const node = this.node(start);
    node.expression = this.parseExpression();
    this.semicolon();
    return this.finish(node, 'ExpressionStatement');
  }

  parseBlock() {
    const node = this.node(this.start);
    this.expectP('{');
    node.body = [];
    while (!this.eatP('}')) {
      if (this.type === 'eof') this.unexpected();
      node.body.push(this.parseStatement());
    }
    return this.finish(node, 'BlockStatement');
  }

  parseVarStatement(kind) {
    const node = this.node(this.start);
    this.next();
    this.parseVar(node, kind, false);
    this.semicolon();
    return this.finish(node, 'VariableDeclaration');
  }

  parseVar(node, kind, noIn) {
    node.declarations = [];
    node.kind = kind;
    for (;;) {
      const decl = this.node(this.start);
      decl.id = this.parseBindingAtom();
      decl.init = this.eatP('=') ? this.parseMaybeAssign(noIn) : null;
      node.declarations.push(this.finish(decl, 'VariableDeclarator'));
      if (!this.eatP(',')) break;
    }
    return node;
  }

  parseIf() {
    const node = this.node(this.start);
    this.next();
    node.test = this.parseParenExpression();
    node.consequent = this.parseStatement();
    node.alternate = this.eatName('else') ? this.parseStatement() : null;
    return this.finish(node, 'IfStatement');
  }

  parseParenExpression() {
    this.expectP('(');
    const e = this.parseExpression();
    this.expectP(')');
    return e;
  }

  parseWhile() {
    const node = this.node(this.start);
    this.next();
    node.test = this.parseParenExpression();
    node.body = this.parseLoopBody();
    return this.finish(node, 'WhileStatement');
  }

  parseLoopBody() {
    this.labels.push(null);
    const body = this.parseStatement();
    this.labels.pop();
    return body;
  }

  parseDoWhile() {
    const node = this.node(this.start);
    this.next();
    node.body = this.parseLoopBody();
    this.expectName('while');
    node.test = this.parseParenExpression();
    this.eatP(';');
    return this.finish(node, 'DoWhileStatement');
  }

  // for-in/of vs classic for is decided after the head: `noIn = true` while parsing the init stops `in` from being
  // read as the binary operator, so `for (x in o)` is not mistaken for `for ((x in o); ...`.
  parseFor() {
    const node = this.node(this.start);
    this.next();
    let isAwait = false;
    if (this.isName('await')) {
      isAwait = true;
      this.next();
    }
    this.expectP('(');
    if (this.isP(';')) return this.parseForRest(node, null);
    let isLet = false;
    if (this.isName('let')) {
      const p = this.peek();
      isLet = p.type === 'name' || (p.type === 'punct' && (p.value === '[' || p.value === '{'));
    }
    if (this.isName('var') || this.isName('const') || isLet) {
      const init = this.node(this.start);
      const kind = this.value;
      this.next();
      this.parseVar(init, kind, true);
      this.finish(init, 'VariableDeclaration');
      if ((this.isName('of') || this.isName('in')) && init.declarations.length === 1) {
        return this.parseForInOf(node, init, isAwait);
      }
      return this.parseForRest(node, init);
    }
    const startsWithLet = this.isName('let');
    const init = this.parseExpression(true);
    if (this.isName('of') || this.isName('in')) {
      if (startsWithLet && this.isName('of')) this.raise(init.start, 'for-of cannot start with "let"');
      return this.parseForInOf(node, this.toAssignable(init), isAwait);
    }
    return this.parseForRest(node, init);
  }

  parseForRest(node, init) {
    node.init = init;
    this.expectP(';');
    node.test = this.isP(';') ? null : this.parseExpression();
    this.expectP(';');
    node.update = this.isP(')') ? null : this.parseExpression();
    this.expectP(')');
    node.body = this.parseLoopBody();
    return this.finish(node, 'ForStatement');
  }

  parseForInOf(node, left, isAwait) {
    const isOf = this.isName('of');
    this.next();
    node.left = left;
    node.right = isOf ? this.parseMaybeAssign() : this.parseExpression();
    this.expectP(')');
    node.body = this.parseLoopBody();
    if (isOf) node.await = isAwait;
    return this.finish(node, isOf ? 'ForOfStatement' : 'ForInStatement');
  }

  parseReturn() {
    const node = this.node(this.start);
    this.next();
    if (this.eatP(';') || this.canInsertSemicolon()) node.argument = null;
    else {
      node.argument = this.parseExpression();
      this.semicolon();
    }
    return this.finish(node, 'ReturnStatement');
  }

  parseBreakContinue(kw) {
    const node = this.node(this.start);
    this.next();
    if (this.eatP(';') || this.canInsertSemicolon()) node.label = null;
    else if (this.type !== 'name') this.unexpected();
    else {
      node.label = this.parseIdent();
      this.semicolon();
    }
    return this.finish(node, kw === 'break' ? 'BreakStatement' : 'ContinueStatement');
  }

  parseThrow() {
    const node = this.node(this.start);
    this.next();
    if (this.nl) this.raise(this.lastEnd, 'Illegal newline after throw');
    node.argument = this.parseExpression();
    this.semicolon();
    return this.finish(node, 'ThrowStatement');
  }

  parseTry() {
    const node = this.node(this.start);
    this.next();
    node.block = this.parseBlock();
    node.handler = null;
    if (this.isName('catch')) {
      const clause = this.node(this.start);
      this.next();
      if (this.eatP('(')) {
        clause.param = this.parseBindingAtom();
        this.expectP(')');
      } else clause.param = null;
      clause.body = this.parseBlock();
      node.handler = this.finish(clause, 'CatchClause');
    }
    node.finalizer = this.eatName('finally') ? this.parseBlock() : null;
    if (!node.handler && !node.finalizer) this.raise(node.start, 'Missing catch or finally clause');
    return this.finish(node, 'TryStatement');
  }

  parseSwitch() {
    const node = this.node(this.start);
    this.next();
    node.discriminant = this.parseParenExpression();
    node.cases = [];
    this.expectP('{');
    this.labels.push(null);
    let cur = null;
    while (!this.isP('}')) {
      if (this.isName('case') || this.isName('default')) {
        if (cur) this.finish(cur, 'SwitchCase');
        cur = this.node(this.start);
        const isCase = this.isName('case');
        this.next();
        cur.consequent = [];
        cur.test = isCase ? this.parseExpression() : null;
        this.expectP(':');
        node.cases.push(cur);
      } else {
        if (!cur) this.unexpected();
        cur.consequent.push(this.parseStatement());
      }
    }
    if (cur) this.finish(cur, 'SwitchCase');
    this.next();
    this.labels.pop();
    return this.finish(node, 'SwitchStatement');
  }

  parseWith() {
    const node = this.node(this.start);
    if (this.module) this.raise(this.start, "'with' in strict mode");
    this.next();
    node.object = this.parseParenExpression();
    node.body = this.parseStatement();
    return this.finish(node, 'WithStatement');
  }

  // ---------------------------------------------------------------------------------------------
  // Modules

  parseModuleSource() {
    if (this.type !== 'string') this.unexpected();
    return this.parseLiteral();
  }

  parseImportAttributes() {
    const attrs = [];
    if ((this.isName('with') || (this.isName('assert') && !this.nl))) {
      this.next();
      this.expectP('{');
      while (!this.eatP('}')) {
        const a = this.node(this.start);
        a.key = this.type === 'string' ? this.parseLiteral() : this.parseIdent(true);
        this.expectP(':');
        if (this.type !== 'string') this.unexpected();
        a.value = this.parseLiteral();
        attrs.push(this.finish(a, 'ImportAttribute'));
        if (!this.isP('}')) this.expectP(',');
      }
    }
    return attrs;
  }

  parseModuleExportName() {
    if (this.type === 'string') return this.parseLiteral();
    return this.parseIdent(true);
  }

  parseImport() {
    const node = this.node(this.start);
    this.next();
    node.specifiers = [];
    if (this.type === 'string') {
      node.source = this.parseModuleSource();
    } else {
      if (this.type === 'name') {
        const s = this.node(this.start);
        s.local = this.parseIdent();
        node.specifiers.push(this.finish(s, 'ImportDefaultSpecifier'));
        this.eatP(',');
      }
      if (this.isP('*')) {
        const s = this.node(this.start);
        this.next();
        this.expectName('as');
        s.local = this.parseIdent();
        node.specifiers.push(this.finish(s, 'ImportNamespaceSpecifier'));
      } else if (this.eatP('{')) {
        while (!this.eatP('}')) {
          const s = this.node(this.start);
          s.imported = this.parseModuleExportName();
          if (this.eatName('as')) s.local = this.parseIdent();
          else {
            if (s.imported.type !== 'Identifier' || KEYWORDS.has(s.imported.name)) this.unexpected();
            s.local = s.imported;
          }
          node.specifiers.push(this.finish(s, 'ImportSpecifier'));
          if (!this.isP('}')) this.expectP(',');
        }
      }
      this.expectName('from');
      node.source = this.parseModuleSource();
    }
    node.attributes = this.parseImportAttributes();
    this.semicolon();
    return this.finish(node, 'ImportDeclaration');
  }

  parseExport() {
    const node = this.node(this.start);
    this.next();
    if (this.isP('*')) {
      this.next();
      node.exported = this.eatName('as') ? this.parseModuleExportName() : null;
      this.expectName('from');
      node.source = this.parseModuleSource();
      node.attributes = this.parseImportAttributes();
      this.semicolon();
      return this.finish(node, 'ExportAllDeclaration');
    }
    if (this.eatName('default')) {
      const start = this.start;
      if (this.isName('function')) {
        node.declaration = this.parseFunction(this.node(start), true, false, true);
      } else if (this.isName('async') && this.peek().value === 'function' && !this.peek().nl) {
        const fn = this.node(start);
        this.next();
        node.declaration = this.parseFunction(fn, true, true, true);
      } else if (this.isName('class')) {
        node.declaration = this.parseClass(this.node(start), true, true);
      } else {
        node.declaration = this.parseMaybeAssign();
        this.semicolon();
      }
      return this.finish(node, 'ExportDefaultDeclaration');
    }
    if (this.isP('{')) {
      this.next();
      node.declaration = null;
      node.specifiers = [];
      while (!this.eatP('}')) {
        const s = this.node(this.start);
        s.local = this.parseModuleExportName();
        s.exported = this.eatName('as') ? this.parseModuleExportName() : s.local;
        node.specifiers.push(this.finish(s, 'ExportSpecifier'));
        if (!this.isP('}')) this.expectP(',');
      }
      if (this.eatName('from')) {
        node.source = this.parseModuleSource();
        node.attributes = this.parseImportAttributes();
      } else {
        node.source = null;
        node.attributes = [];
        for (const s of node.specifiers) if (s.local.type !== 'Identifier') this.unexpected(s.local.start);
      }
      this.semicolon();
      return this.finish(node, 'ExportNamedDeclaration');
    }
    node.specifiers = [];
    node.source = null;
    node.attributes = [];
    node.declaration = this.parseStatement();
    const t = node.declaration.type;
    if (t !== 'VariableDeclaration' && t !== 'FunctionDeclaration' && t !== 'ClassDeclaration') {
      this.raise(node.declaration.start, 'Unexpected export');
    }
    return this.finish(node, 'ExportNamedDeclaration');
  }

  // ---------------------------------------------------------------------------------------------
  // Functions and classes

  withFunctionContext(isAsync, isGenerator, fn) {
    const save = [this.inFunction, this.inAsync, this.inGenerator, this.labels];
    this.inFunction = true;
    this.inAsync = isAsync;
    this.inGenerator = isGenerator;
    this.labels = [];
    try {
      return fn();
    } finally {
      [this.inFunction, this.inAsync, this.inGenerator, this.labels] = save;
    }
  }

  // node starts at `function` (or `async`); the current token is `function`.
  parseFunction(node, isStatement, isAsync, allowAnonymous = false) {
    this.expectName('function');
    node.generator = this.eatP('*');
    node.async = isAsync;
    node.id = null;
    if (this.type === 'name' && !this.isP('(')) {
      if (isStatement || !this.isName('yield') || !node.generator) node.id = this.parseIdent();
    }
    if (isStatement && !node.id && !allowAnonymous) this.unexpected();
    node.expression = false;
    this.withFunctionContext(isAsync, node.generator, () => {
      node.params = this.parseParams();
      node.body = this.parseFunctionBody();
    });
    return this.finish(node, isStatement ? 'FunctionDeclaration' : 'FunctionExpression');
  }

  parseParams() {
    this.expectP('(');
    return this.parseBindingList(')');
  }

  parseFunctionBody() {
    const node = this.node(this.start);
    this.expectP('{');
    node.body = [];
    this.parseDirectives(node.body);
    while (!this.eatP('}')) {
      if (this.type === 'eof') this.unexpected();
      node.body.push(this.parseStatement());
    }
    return this.finish(node, 'BlockStatement');
  }

  // Method value: a FunctionExpression starting at "(".
  parseMethod(isAsync, isGenerator) {
    const node = this.node(this.start);
    node.id = null;
    node.expression = false;
    node.generator = isGenerator;
    node.async = isAsync;
    this.withFunctionContext(isAsync, isGenerator, () => {
      node.params = this.parseParams();
      node.body = this.parseFunctionBody();
    });
    return this.finish(node, 'FunctionExpression');
  }

  parseArrow(start, params, isAsync) {
    const node = this.node(start);
    node.id = null;
    node.generator = false;
    node.async = isAsync;
    node.params = params.map((p) => this.toAssignable(p, true));
    this.withFunctionContext(isAsync, false, () => {
      if (this.isP('{')) {
        node.expression = false;
        node.body = this.parseFunctionBody();
      } else {
        node.expression = true;
        node.body = this.parseMaybeAssign(this.arrowNoIn || false);
      }
    });
    return this.finish(node, 'ArrowFunctionExpression');
  }

  parseClass(node, isStatement, allowAnonymous = false) {
    this.expectName('class');
    node.id = this.isIdentToken() ? this.parseIdent() : null;
    if (isStatement && !node.id && !allowAnonymous) this.unexpected();
    node.superClass = this.eatName('extends') ? this.parseExprSubscripts() : null;
    const body = this.node(this.start);
    this.expectP('{');
    body.body = [];
    while (!this.eatP('}')) {
      if (this.eatP(';')) continue;
      if (this.type === 'eof') this.unexpected();
      body.body.push(this.parseClassMember());
    }
    node.body = this.finish(body, 'ClassBody');
    return this.finish(node, isStatement ? 'ClassDeclaration' : 'ClassExpression');
  }

  // Is the current contextual word (static/async/get/set) a modifier rather than the member name?
  isModifier(forAsync) {
    const p = this.peek();
    if (p.type === 'eof') return false;
    if (p.type === 'punct' && (p.value === '(' || p.value === '=' || p.value === ';' || p.value === '}' ||
      p.value === ',' || p.value === ':')) return false;
    if (forAsync && p.nl) return false;
    return true;
  }

  parseClassMember() {
    const node = this.node(this.start);
    let isStatic = false, isAsync = false, isGenerator = false, kind = 'method';
    if (this.isName('static') && this.isModifier(false)) {
      this.next();
      isStatic = true;
      if (this.isP('{')) {
        node.body = [];
        this.next();
        this.withFunctionContext(false, false, () => {
          while (!this.eatP('}')) {
            if (this.type === 'eof') this.unexpected();
            node.body.push(this.parseStatement());
          }
        });
        return this.finish(node, 'StaticBlock');
      }
    }
    if (this.isName('async') && this.isModifier(true)) {
      this.next();
      isAsync = true;
    }
    if (this.eatP('*')) isGenerator = true;
    if (!isAsync && !isGenerator && (this.isName('get') || this.isName('set')) && this.isModifier(false)) {
      kind = this.value;
      this.next();
    }
    node.static = isStatic;
    this.parsePropertyName(node);
    if (this.isP('(') || isAsync || isGenerator || kind !== 'method') {
      const isCtor = !isStatic && !node.computed && ((node.key.type === 'Identifier' && node.key.name === 'constructor') ||
        (node.key.type === 'Literal' && node.key.value === 'constructor'));
      node.kind = isCtor && kind === 'method' ? 'constructor' : kind;
      node.value = this.parseMethod(isAsync, isGenerator);
      return this.finish(node, 'MethodDefinition');
    }
    node.value = null;
    if (this.eatP('=')) {
      node.value = this.withFunctionContext(false, false, () => this.parseMaybeAssign());
    }
    this.semicolon();
    return this.finish(node, 'PropertyDefinition');
  }

  // Sets node.key / node.computed from the current token.
  parsePropertyName(node) {
    if (this.isP('[')) {
      this.next();
      node.computed = true;
      node.key = this.parseMaybeAssign();
      this.expectP(']');
      return;
    }
    node.computed = false;
    if (this.type === 'num' || this.type === 'string') node.key = this.parseLiteral();
    else if (this.type === 'private') {
      const k = this.node(this.start);
      k.name = this.value;
      this.next();
      node.key = this.finish(k, 'PrivateIdentifier');
    } else if (this.type === 'name') node.key = this.parseIdent(true);
    else this.unexpected();
  }

  // ---------------------------------------------------------------------------------------------
  // Patterns

  parseBindingAtom() {
    if (this.isP('[')) {
      const node = this.node(this.start);
      this.next();
      node.elements = this.parseBindingList(']', true);
      return this.finish(node, 'ArrayPattern');
    }
    if (this.isP('{')) return this.toAssignable(this.parseObj(), true);
    return this.parseIdent();
  }

  parseBindingList(close, allowHoles = false) {
    const elts = [];
    let first = true;
    while (!this.eatP(close)) {
      if (!first) {
        this.expectP(',');
        if (this.eatP(close)) break;
      }
      first = false;
      if (allowHoles && this.isP(',')) {
        elts.push(null);
        continue;
      }
      if (this.isP('...')) {
        const rest = this.node(this.start);
        this.next();
        rest.argument = this.parseBindingAtom();
        elts.push(this.finish(rest, 'RestElement'));
        this.expectP(close);
        break;
      }
      elts.push(this.parseMaybeDefault(this.start, this.parseBindingAtom()));
    }
    return elts;
  }

  parseMaybeDefault(start, left) {
    if (!this.eatP('=')) return left;
    const node = this.node(start);
    node.left = left;
    node.right = this.parseMaybeAssign();
    return this.finish(node, 'AssignmentPattern', this.lastEnd);
  }

  // Converts an expression (cover grammar) into a pattern in place.
  // Converts in place (node.type rewritten) instead of building new nodes: start/end ranges stay those of the
  // source text, which is what acorn emits and what text-splicing consumers need.
  toAssignable(node, isBinding = false) {
    if (!node) return node;
    switch (node.type) {
      case 'Identifier': case 'ObjectPattern': case 'ArrayPattern': case 'AssignmentPattern': case 'RestElement':
        return node;
      case 'MemberExpression':
        if (isBinding) this.raise(node.start, 'Binding member expression');
        return node;
      case 'ObjectExpression':
        node.type = 'ObjectPattern';
        for (const p of node.properties) {
          if (p.type === 'SpreadElement') {
            p.type = 'RestElement';
            p.argument = this.toAssignable(p.argument, isBinding);
          } else {
            if (p.kind !== 'init' || p.method) this.raise(p.key.start, 'Object pattern cannot contain methods');
            p.value = this.toAssignable(p.value, isBinding);
          }
        }
        return node;
      case 'ArrayExpression':
        node.type = 'ArrayPattern';
        node.elements = node.elements.map((e) => {
          if (e && e.type === 'SpreadElement') {
            e.type = 'RestElement';
            e.argument = this.toAssignable(e.argument, isBinding);
            return e;
          }
          return this.toAssignable(e, isBinding);
        });
        return node;
      case 'SpreadElement':
        node.type = 'RestElement';
        node.argument = this.toAssignable(node.argument, isBinding);
        return node;
      case 'AssignmentExpression':
        if (node.operator !== '=') this.raise(node.left.end, "Only '=' operator can be used for specifying default value.");
        node.type = 'AssignmentPattern';
        delete node.operator;
        node.left = this.toAssignable(node.left, isBinding);
        return node;
      case 'ChainExpression':
        this.raise(node.start, 'Optional chaining cannot appear in left-hand side');
        break;
      default:
        this.raise(node.start, 'Assigning to rvalue');
    }
    return node;
  }

  // ---------------------------------------------------------------------------------------------
  // Expressions

  parseExpression(noIn = false) {
    const start = this.start;
    const expr = this.parseMaybeAssign(noIn);
    if (this.isP(',')) {
      const node = this.node(start);
      node.expressions = [expr];
      while (this.eatP(',')) node.expressions.push(this.parseMaybeAssign(noIn));
      return this.finish(node, 'SequenceExpression');
    }
    return expr;
  }

  // `=` converts the left side to a pattern (destructuring assignment allowed); compound operators (+=, ??=) require
  // a simple target. Right-recursive, so a = b = c groups right.
  parseMaybeAssign(noIn = false) {
    if (this.isName('yield') && this.inGenerator) return this.parseYield(noIn);
    const start = this.start;
    const saveArrowNoIn = this.arrowNoIn;
    this.arrowNoIn = noIn;
    let left;
    try {
      left = this.parseMaybeConditional(noIn);
    } finally {
      this.arrowNoIn = saveArrowNoIn;
    }
    if (this.type === 'punct' && ASSIGN_OPS.has(this.value)) {
      const node = this.node(start);
      node.operator = this.value;
      node.left = this.value === '=' ? this.toAssignable(left) : this.checkSimpleTarget(left);
      this.next();
      node.right = this.parseMaybeAssign(noIn);
      return this.finish(node, 'AssignmentExpression');
    }
    return left;
  }

  checkSimpleTarget(node) {
    if (node.type !== 'Identifier' && node.type !== 'MemberExpression') this.raise(node.start, 'Invalid assignment target');
    return node;
  }

  parseYield(noIn) {
    const node = this.node(this.start);
    this.next();
    if (this.isP(';') || this.canInsertSemicolon() || (!this.isP('*') && !this.startsExpr())) {
      node.delegate = false;
      node.argument = null;
    } else {
      node.delegate = this.eatP('*');
      node.argument = this.parseMaybeAssign(noIn);
    }
    return this.finish(node, 'YieldExpression');
  }

  parseMaybeConditional(noIn) {
    const start = this.start;
    const expr = this.parseExprOps(noIn);
    if (this.eatP('?')) {
      const node = this.node(start);
      node.test = expr;
      node.consequent = this.parseMaybeAssign();
      this.expectP(':');
      node.alternate = this.parseMaybeAssign(noIn);
      return this.finish(node, 'ConditionalExpression');
    }
    return expr;
  }

  parseExprOps(noIn) {
    const start = this.start;
    const expr = this.parseMaybeUnary(false);
    if (expr.type === 'ArrowFunctionExpression' && expr.start === start) return expr;
    return this.parseExprOp(expr, start, -1, noIn);
  }

  currentBinaryOp(noIn) {
    if (this.type === 'punct' && Object.prototype.hasOwnProperty.call(BINARY_PREC, this.value)) return this.value;
    if (this.type === 'name' && !this.escaped && (this.value === 'instanceof' || (this.value === 'in' && !noIn))) {
      return this.value;
    }
    return null;
  }

  // Operator-precedence climbing: consume operators binding tighter than minPrec, recurse for the right operand with
  // the operator's own precedence (left-associative). The '**' branch below is unreachable since BINARY_PREC has
  // no '**' entry; exponentiation is parsed in parseMaybeUnary.
  parseExprOp(left, leftStart, minPrec, noIn) {
    const op = this.currentBinaryOp(noIn);
    if (op === null) return left;
    const prec = BINARY_PREC[op];
    if (prec > minPrec) {
      this.next();
      const rightStart = this.start;
      // `**` is right-associative.
      const right = this.parseExprOp(this.parseMaybeUnary(false), rightStart, op === '**' ? prec - 1 : prec, noIn);
      const node = this.node(leftStart);
      node.left = left;
      node.operator = op;
      node.right = right;
      this.finish(node, op === '||' || op === '&&' || op === '??' ? 'LogicalExpression' : 'BinaryExpression');
      return this.parseExprOp(node, leftStart, minPrec, noIn);
    }
    return left;
  }

  // `incDec`: parsing the operand of a prefix ++/-- (a following `**` belongs to the outer expression).
  // `-a ** b` is a SyntaxError in JS (ambiguous sign); sawUnary enforces it. `await` is a keyword in async functions
  // and at module top level (top-level await), an identifier elsewhere.
  parseMaybeUnary(sawUnary, incDec = false) {
    const start = this.start;
    let expr;
    if (this.isName('await') && (this.inAsync || (this.module && !this.inFunction))) {
      const node = this.node(start);
      this.next();
      node.argument = this.parseMaybeUnary(true);
      expr = this.finish(node, 'AwaitExpression');
      sawUnary = true;
    } else if ((this.type === 'punct' && (this.value === '!' || this.value === '~' || this.value === '+' ||
      this.value === '-' || this.value === '++' || this.value === '--')) ||
      (this.type === 'name' && !this.escaped && UNARY_KW.has(this.value))) {
      const node = this.node(start);
      const op = this.value;
      const update = op === '++' || op === '--';
      node.operator = op;
      node.prefix = true;
      this.next();
      node.argument = this.parseMaybeUnary(true, update);
      if (update) this.checkSimpleTarget(node.argument);
      else sawUnary = true;
      expr = this.finish(node, update ? 'UpdateExpression' : 'UnaryExpression');
    } else if (this.type === 'private') {
      // `#x in obj`
      const k = this.node(start);
      k.name = this.value;
      this.next();
      if (!this.isName('in')) this.unexpected();
      return this.finish(k, 'PrivateIdentifier');
    } else {
      expr = this.parseExprSubscripts();
      while ((this.isP('++') || this.isP('--')) && !this.nl) {
        const node = this.node(start);
        node.operator = this.value;
        node.prefix = false;
        node.argument = this.checkSimpleTarget(expr);
        this.next();
        expr = this.finish(node, 'UpdateExpression');
      }
    }
    if (!incDec && this.isP('**')) {
      if (sawUnary) this.unexpected();
      this.next();
      const node = this.node(start);
      node.left = expr;
      node.operator = '**';
      node.right = this.parseMaybeUnary(false);
      return this.finish(node, 'BinaryExpression');
    }
    return expr;
  }

  parseExprSubscripts(noCalls = false) {
    const start = this.start;
    const expr = this.parseExprAtom();
    // An arrow function only takes subscripts when it is parenthesized: `(() => {})()`.
    if (expr.type === 'ArrowFunctionExpression' && expr.start === start) return expr;
    return this.parseSubscripts(expr, start, noCalls);
  }

  // Member/call/optional-chain loop. ESTree wraps a whole chain containing '?.' in one ChainExpression (so the
  // short-circuit boundary is explicit). `async(...)` is remembered as a potential async arrow head; noCalls is set
  // for `new` callees so `new a.b()` binds the arguments to `new`, not to a call of a.b.
  parseSubscripts(base, start, noCalls) {
    const maybeAsyncArrow = base.type === 'Identifier' && base.name === 'async' && this.lastEnd === base.end &&
      !this.canInsertSemicolon() && base.end - base.start === 5;
    let chained = false;
    for (;;) {
      const optional = this.isP('?.');
      if (optional) {
        if (noCalls) this.raise(this.start, 'Optional chaining cannot appear in the callee of new expressions');
        this.next();
        chained = true;
      }
      const computed = this.isP('[');
      if (computed || (optional && !this.isP('(') && !(this.type === 'template')) || this.isP('.')) {
        const node = this.node(start);
        node.object = base;
        if (computed) {
          this.next();
          node.property = this.parseExpression();
          this.expectP(']');
        } else {
          if (!optional) this.next(); // '.'
          if (this.type === 'private') {
            const k = this.node(this.start);
            k.name = this.value;
            this.next();
            node.property = this.finish(k, 'PrivateIdentifier');
          } else node.property = this.parseIdent(true);
        }
        node.computed = computed;
        node.optional = optional;
        base = this.finish(node, 'MemberExpression');
      } else if (!noCalls && this.isP('(')) {
        this.next();
        const args = this.parseExprList(')', true);
        if (maybeAsyncArrow && !optional && !chained && this.isP('=>') && !this.nl) {
          this.next();
          return this.parseArrow(start, args, true);
        }
        const node = this.node(start);
        node.callee = base;
        node.arguments = args;
        node.optional = optional;
        base = this.finish(node, 'CallExpression');
      } else if (this.type === 'template') {
        if (optional || chained) this.raise(this.start, 'Optional chaining cannot appear in the tag of tagged template expressions');
        const node = this.node(start);
        node.tag = base;
        node.quasi = this.parseTemplate(true);
        base = this.finish(node, 'TaggedTemplateExpression');
      } else {
        if (optional) this.unexpected();
        break;
      }
    }
    if (chained) {
      const node = this.node(start);
      node.expression = base;
      return this.finish(node, 'ChainExpression', base.end);
    }
    return base;
  }

  parseExprList(close, allowSpread, allowHoles = false) {
    const elts = [];
    let first = true;
    while (!this.eatP(close)) {
      if (!first) {
        this.expectP(',');
        if (this.eatP(close)) break;
      }
      first = false;
      if (allowHoles && this.isP(',')) elts.push(null);
      else if (allowSpread && this.isP('...')) elts.push(this.parseSpread());
      else elts.push(this.parseMaybeAssign());
    }
    return elts;
  }

  parseSpread() {
    const node = this.node(this.start);
    this.next();
    node.argument = this.parseMaybeAssign();
    return this.finish(node, 'SpreadElement');
  }

  parseExprAtom() {
    const start = this.start;
    if (this.type === 'punct') {
      switch (this.value) {
        case '(': return this.parseParenAndDistinguish();
        case '[': {
          const node = this.node(start);
          this.next();
          node.elements = this.parseExprList(']', true, true);
          return this.finish(node, 'ArrayExpression');
        }
        case '{': return this.parseObj();
        case '/': case '/=':
          this.rescanRegex();
          return this.parseLiteral();
      }
      this.unexpected();
    }
    if (this.type === 'num' || this.type === 'string' || this.type === 'regexp') return this.parseLiteral();
    if (this.type === 'template') return this.parseTemplate(false);
    if (this.type !== 'name') this.unexpected();
    if (!this.escaped) {
      switch (this.value) {
        case 'this': case 'super': {
          const node = this.node(start);
          const t = this.value === 'this' ? 'ThisExpression' : 'Super';
          this.next();
          return this.finish(node, t);
        }
        case 'null': case 'true': case 'false': return this.parseLiteral();
        case 'function': return this.parseFunction(this.node(start), false, false);
        case 'class': return this.parseClass(this.node(start), false);
        case 'new': return this.parseNew();
        case 'import': return this.parseImportExpr();
        case 'async': {
          const p = this.peek();
          if (p.type === 'name' && p.value === 'function' && !p.nl) {
            const node = this.node(start);
            this.next();
            return this.parseFunction(node, false, true);
          }
          if (p.type === 'name' && !p.nl && !KEYWORDS.has(p.value)) {
            // async x => ...
            const st = this.snapshot();
            this.next();
            const param = this.parseIdent();
            if (this.isP('=>') && !this.nl) {
              this.next();
              return this.parseArrow(start, [param], true);
            }
            this.restore(st);
          }
          break;
        }
      }
      if (KEYWORDS.has(this.value)) this.unexpected();
    }
    const id = this.parseIdent();
    if (this.isP('=>') && !this.nl) {
      this.next();
      return this.parseArrow(start, [id], false);
    }
    return id;
  }

  parseIdent(liberal = false) {
    if (this.type !== 'name') this.unexpected();
    if (!liberal && KEYWORDS.has(this.value) && !this.escaped) this.unexpected();
    const node = this.node(this.start);
    node.name = this.value;
    this.next();
    return this.finish(node, 'Identifier');
  }

  parseLiteral() {
    const node = this.node(this.start);
    node.raw = this.input.slice(this.start, this.end);
    if (this.type === 'regexp') {
      const { pattern, flags } = this.value;
      try { node.value = new RegExp(pattern, flags); } catch { node.value = null; }
      node.regex = { pattern, flags };
    } else if (this.type === 'num') {
      if (this.bigint !== null && this.bigint !== undefined) {
        node.bigint = this.bigint;
        try { node.value = BigInt(this.bigint); } catch { node.value = null; }
      } else node.value = this.value;
    } else if (this.type === 'name') {
      node.value = this.value === 'null' ? null : this.value === 'true';
    } else node.value = this.value;
    this.next();
    return this.finish(node, 'Literal');
  }

  // Lexer and parser alternate: each chunk token ends at '${' or '`'; after the substitution expression the parser
  // asks the lexer to re-read the closing '}' as the next template chunk (rescanTemplate).
  parseTemplate(tagged) {
    const node = this.node(this.start);
    node.expressions = [];
    node.quasis = [];
    for (;;) {
      if (this.type !== 'template') this.unexpected();
      const v = this.value;
      if (v.cooked === null && !tagged) this.raise(this.start, 'Bad escape sequence in untagged template literal');
      const q = this.node(v.rawStart);
      q.value = { raw: v.raw, cooked: v.cooked };
      q.tail = v.tail;
      node.quasis.push(this.finish(q, 'TemplateElement', v.rawEnd));
      this.next();
      if (v.tail) break;
      node.expressions.push(this.parseExpression());
      this.rescanTemplate();
    }
    return this.finish(node, 'TemplateLiteral');
  }

  parseNew() {
    const node = this.node(this.start);
    const meta = this.parseIdent(true);
    if (this.eatP('.')) {
      node.meta = meta;
      node.property = this.parseIdent(true);
      if (node.property.name !== 'target') this.raise(node.property.start, "The only valid meta property for new is 'new.target'");
      return this.finish(node, 'MetaProperty');
    }
    const calleeStart = this.start;
    if (this.isName('import')) this.raise(calleeStart, 'Cannot use new with import()');
    node.callee = this.parseSubscripts(this.parseExprAtom(), calleeStart, true);
    node.arguments = this.eatP('(') ? this.parseExprList(')', true) : [];
    return this.finish(node, 'NewExpression');
  }

  parseImportExpr() {
    const node = this.node(this.start);
    const meta = this.parseIdent(true);
    if (this.eatP('.')) {
      node.meta = meta;
      node.property = this.parseIdent(true);
      if (node.property.name !== 'meta') this.raise(node.property.start, "The only valid meta property for import is 'import.meta'");
      if (!this.module) this.raise(node.start, "Cannot use 'import.meta' outside a module");
      return this.finish(node, 'MetaProperty');
    }
    this.expectP('(');
    node.source = this.parseMaybeAssign();
    node.options = null;
    if (this.eatP(',') && !this.isP(')')) {
      node.options = this.parseMaybeAssign();
      this.eatP(',');
    }
    this.expectP(')');
    return this.finish(node, 'ImportExpression');
  }

  // '(' starts either a parenthesised expression or arrow parameters; which one is known only at ')' + '=>'.
  // Items are parsed as expressions (cover grammar) and become params in parseArrow. ESTree has no
  // ParenthesizedExpression: a single item is returned as is, which is why ranges of such nodes exclude the parens.
  parseParenAndDistinguish() {
    const start = this.start;
    this.next();
    const items = [];
    let first = true, trailingComma = false, spread = null;
    while (!this.isP(')')) {
      if (!first) {
        this.expectP(',');
        if (this.isP(')')) { trailingComma = true; break; }
      }
      first = false;
      if (this.isP('...')) {
        const rest = this.node(this.start);
        this.next();
        rest.argument = this.parseBindingAtom();
        spread = this.finish(rest, 'RestElement');
        items.push(spread);
        if (this.isP(',')) this.raise(this.start, 'Comma is not permitted after the rest element');
        break;
      }
      items.push(this.parseMaybeAssign());
    }
    const innerEnd = this.lastEnd;
    this.expectP(')');
    if (this.isP('=>') && !this.nl) {
      this.next();
      return this.parseArrow(start, items, false);
    }
    if (!items.length || trailingComma || spread) this.unexpected(this.lastEnd);
    if (items.length === 1) return items[0];
    const seq = this.node(items[0].start);
    seq.expressions = items;
    return this.finish(seq, 'SequenceExpression', innerEnd);
  }

  parseObj() {
    const node = this.node(this.start);
    this.expectP('{');
    node.properties = [];
    let first = true;
    while (!this.eatP('}')) {
      if (!first) {
        this.expectP(',');
        if (this.eatP('}')) break;
      }
      first = false;
      if (this.isP('...')) {
        node.properties.push(this.parseSpread());
        continue;
      }
      node.properties.push(this.parseProperty());
    }
    return this.finish(node, 'ObjectExpression');
  }

  // `get`/`set`/`async` are modifiers only when followed by a property name (isModifier); `{ get: 1 }` and
  // `{ get }` use them as plain keys. A shorthand with default (`{ a = 1 }`) is only valid as a pattern; it is
  // accepted here and becomes legal once toAssignable converts the object.
  parseProperty() {
    const prop = this.node(this.start);
    let isAsync = false, isGenerator = false, kind = 'init';
    if (this.isName('async') && this.isModifier(true)) {
      this.next();
      isAsync = true;
    }
    if (this.eatP('*')) isGenerator = true;
    if (!isAsync && !isGenerator && (this.isName('get') || this.isName('set')) && this.isModifier(false)) {
      kind = this.value;
      this.next();
    }
    this.parsePropertyName(prop);
    prop.kind = kind;
    if (kind !== 'init' || isAsync || isGenerator || this.isP('(')) {
      prop.method = kind === 'init';
      prop.shorthand = false;
      prop.value = this.parseMethod(isAsync, isGenerator);
      return this.finish(prop, 'Property');
    }
    prop.method = false;
    if (this.eatP(':')) {
      prop.shorthand = false;
      prop.value = this.parseMaybeAssign();
      return this.finish(prop, 'Property');
    }
    if (prop.computed || prop.key.type !== 'Identifier') this.unexpected();
    if (KEYWORDS.has(prop.key.name)) this.raise(prop.key.start, 'Unexpected keyword ' + prop.key.name);
    prop.shorthand = true;
    const value = { type: 'Identifier', start: prop.key.start, end: prop.key.end, name: prop.key.name };
    prop.value = this.isP('=') ? this.parseMaybeDefault(prop.key.start, value) : value;
    return this.finish(prop, 'Property');
  }
}

export function parse(input, options = {}) {
  return new Parser(input, options).parseTopLevel();
}

// Calls fn(node, parent, key) for every node of an ESTree tree, parents first; returning false skips
// the children. Keys starting with '$' hold annotations of other tools and are not traversed.
// Generic, schema-free traversal: any property holding an object with a string `type` is a child. Annotation keys
// ('$...') are skipped, so tools can hang parent pointers and bindings on nodes without creating cycles here;
// Literal.value is skipped because a RegExp value object is not a node.
export function walk(node, fn, parent = null, key = null) {
  if (!node || typeof node.type !== 'string') return;
  if (fn(node, parent, key) === false) return;
  for (const k in node) {
    if (k[0] === '$' || k === 'type' || k === 'start' || k === 'end' || k === 'comments' || k === 'tokens' ||
      (k === 'value' && node.type === 'Literal')) continue;
    const v = node[k];
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c.type === 'string') walk(c, fn, node, k);
    } else if (v && typeof v.type === 'string') walk(v, fn, node, k);
  }
}
