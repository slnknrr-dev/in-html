// math/tex.js - TeX / LaTeX math to MathML Core, which browsers lay out natively (no fonts or scripts to ship).
// A recursive-descent parser over the source text writes MathML directly: identifiers, numbers and operators,
// sub / superscripts and primes, limits of large operators and lim-like functions (under / over in display style,
// beside the operator inline; \limits / \nolimits), fractions and binomials, roots, accents, braces over and under,
// \left \middle \right and \big… delimiters, font switches as Unicode mathematical alphanumerics (MathML Core keeps
// only mathvariant="normal"), text with inner $math$, spacing, colours (names and hex only), \not, \tag, and the
// environments matrix / pmatrix / bmatrix / Bmatrix / vmatrix / Vmatrix / smallmatrix, cases / dcases / rcases,
// aligned / align / align* / split / alignat, gather / gathered, equation, array / subarray (column alignment,
// vertical rules, \hline) and \substack. Rows separated by \\ at the top level become an aligned table.
// Every character of the input is escaped; nothing executes. Pure: no DOM.
//
//   texToMathML(tex, { display = false }) -> { mathml, error }   never throws. error is null or the first problem;
//       unknown commands render in place as an <merror>, structural errors (unbalanced braces, a missing \right or
//       \end) give the whole source in <merror><mtext>…</mtext></merror>
//   MATH_CSS     styles the output needs (display blocks, table alignment classes tex-*, rules, errors)
//
// Design decisions:
// - Target MathML Core: the browser does layout and font selection, so there is no font, metric table or layout
//   engine to ship (unlike KaTeX / MathJax). Output quality is the browser's.
// - Recursive descent straight to MathML strings: no AST stage, because each TeX construct maps locally to one
//   MathML element. The exception is scripts, kept as a node until the base's limit behaviour is known.
// - Safety: every character is escaped on output, \href-like commands do not exist, colours are allowlisted
//   (SAFE_COLOR), input length (MAX_LEN) and nesting (MAX_DEPTH) are capped, so hostile input cannot inject markup
//   or overflow the stack.
// - Error policy: unknown commands degrade locally to <merror> and parsing continues (useful partial output while
//   typing); structural errors abort to a whole-formula <merror> since no correct tree can be guessed.

import { ACCENTS, DELIMS, NEGATED, SYMBOLS, styled } from './symbols.js';

const NS = 'http://www.w3.org/1998/Math/MathML';
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);
const MAX_LEN = 20000;
const MAX_DEPTH = 120;

class TexError extends Error {}

// A node: { m: MathML of one element, k: class, lim: 'display' | 'always' | 'never' (scripts as limits), post: MathML
// after the element (function application) } or a scripted node { k: 'script', base, sub, sup, primes, display }.
const N = (m, k = 'ord', extra) => ({ m, k, ...extra });
const render = (n) => (n.k === 'script' ? renderScript(n) : n.m);
const postOf = (n) => (n.k === 'script' ? n.base.post || '' : n.post || '');
// A function name (sin, operatorname) is followed by a thin space unless an opening bracket follows, as in TeX.
const fnOf = (n) => (n.k === 'script' ? n.base : n).fn;
// U+2061 FUNCTION APPLICATION (post) after function names tells assistive technology "sin applied to x"; the thin
// space mirrors TeX's \mathop spacing before an argument that is not bracketed.
const flat = (nodes) => nodes.map((n, i) => render(n) + postOf(n) + (fnOf(n) && nodes[i + 1] && nodes[i + 1].k !== 'open' && nodes[i + 1].k !== 'space' ? '<mspace width="0.1667em"/>' : '')).join('');
const row = (nodes) => (nodes.length === 1 && !postOf(nodes[0]) ? render(nodes[0]) : `<mrow>${flat(nodes)}</mrow>`);

// Limits placement: munder / mover for large operators in display style (or \limits), msub / msup otherwise. Primes
// force side placement (TeX does the same: f'_n never stacks).
function renderScript(n) {
  const b = n.base;
  let sup = n.sup ? row(n.sup) : '';
  if (n.primes) {
    const p = `<mo>${['', '′', '″', '‴'][n.primes] || '′'.repeat(n.primes)}</mo>`;
    sup = sup ? `<mrow>${p}${sup}</mrow>` : p;
  }
  const sub = n.sub ? row(n.sub) : '';
  const limits = !n.primes && (b.lim === 'always' || (b.lim === 'display' && n.display));
  const B = render(b);
  if (limits) {
    if (sub && sup) return `<munderover>${B}${sub}${sup}</munderover>`;
    return sub ? `<munder>${B}${sub}</munder>` : `<mover>${B}${sup}</mover>`;
  }
  if (sub && sup) return `<msubsup>${B}${sub}${sup}</msubsup>`;
  return sub ? `<msub>${B}${sub}</msub>` : `<msup>${B}${sup}</msup>`;
}

const mo = (ch, attrs = '') => `<mo${attrs}>${esc(ch)}</mo>`;
const fence = (ch, form) => (ch ? `<mo fence="true" form="${form}" stretchy="true" symmetric="true">${esc(ch)}</mo>` : '');
const SPACES = { ',': 0.1667, ':': 0.2222, '>': 0.2222, ';': 0.2778, '!': -0.1667, quad: 1, qquad: 2, enspace: 0.5,
  thinspace: 0.1667, medspace: 0.2222, thickspace: 0.2778, negthinspace: -0.1667, negmedspace: -0.2222, negthickspace: -0.2778, enskip: 0.5, quad_: 1 };
const space = (em) => `<mspace width="${em}em"/>`;
const BIG = { big: 1.2, Big: 1.8, bigg: 2.4, Bigg: 3 };
// Lengths converted to em for <mspace>, assuming a 10 pt font (1 pt = 0.1 em); mu is 1/18 em by definition.
const UNITS = { em: 1, ex: 0.43, pt: 0.1, px: 0.0625, mu: 1 / 18, cm: 2.85, mm: 0.285, in: 7.23, pc: 1.2, bp: 0.1 };
const FONTS = { mathbb: 'bb', Bbb: 'bb', mathbf: 'bf', bold: 'bf', mathit: 'it', mathrm: 'rm', mathup: 'rm', mathnormal: '',
  mathsf: 'sf', mathtt: 'tt', mathcal: 'cal', mathscr: 'scr', mathfrak: 'frak', frak: 'frak', boldsymbol: 'bsym', bm: 'bsym', pmb: 'bsym',
  mathbfit: 'bsym', mathsfit: 'sfit', mathbffrak: 'bffrak' };
const OLD_FONTS = { rm: 'rm', bf: 'bf', it: 'it', sf: 'sf', tt: 'tt', cal: 'cal', mit: '' };
const TEXT_FONTS = { text: '', textrm: '', textnormal: '', mbox: '', hbox: '', textup: '', textbf: 'bf', textit: 'it', emph: 'it', textsf: 'sf', texttt: 'tt', textmd: '' };
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i;
const MATRIX = { matrix: ['', ''], pmatrix: ['(', ')'], bmatrix: ['[', ']'], Bmatrix: ['{', '}'], vmatrix: ['|', '|'], Vmatrix: ['‖', '‖'], smallmatrix: ['', ''] };
const ALIGNED = new Set(['aligned', 'align', 'align*', 'split', 'alignat', 'alignat*', 'alignedat', 'flalign', 'flalign*', 'eqnarray', 'eqnarray*']);
const GATHER = new Set(['gather', 'gather*', 'gathered', 'multline', 'multline*']);

class Parser {
  constructor(src, display) {
    this.s = src;
    this.i = 0;
    this.display = display;
    this.font = '';
    this.errors = [];
    this.depth = 0;
    this.tag = null;
    this.hlTop = false;
    this.hlEnd = false;
  }

  fail(msg) { throw new TexError(msg); }
  err(msg) { this.errors.push(msg); }
  get end() { return this.i >= this.s.length; }

  skipWs() {
    const s = this.s;
    while (this.i < s.length) {
      const c = s[this.i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') this.i++;
      else if (c === '%') { while (this.i < s.length && s[this.i] !== '\n') this.i++; }
      else break;
    }
  }

  // At a backslash: the control word (letters) or control symbol (one character) after it.
  readCmd() {
    this.i++;
    if (this.end) this.fail('Trailing \\');
    const m = /^[a-zA-Z]+/.exec(this.s.slice(this.i, this.i + 60));
    if (!m) return this.s[this.i++];
    this.i += m[0].length;
    return m[0];
  }
  star() { if (this.s[this.i] === '*') { this.i++; return true; } return false; }

  // Raw text of a {group} (nested braces kept) or of one character.
  // Brace matching skips escaped characters (\{ \}), so literal braces inside a group do not unbalance it.
  readRaw() {
    this.skipWs();
    if (this.end) this.fail('Missing argument');
    if (this.s[this.i] !== '{') {
      if (this.s[this.i] === '\\') { const st = this.i; this.readCmd(); return this.s.slice(st, this.i); }
      return this.s[this.i++];
    }
    let d = 0;
    const st = this.i;
    for (; this.i < this.s.length; this.i++) {
      const c = this.s[this.i];
      if (c === '\\') { this.i++; continue; }
      if (c === '{') d++;
      else if (c === '}' && --d === 0) { this.i++; return this.s.slice(st + 1, this.i - 1); }
    }
    this.fail('Missing }');
  }
  // [optional] argument: raw text or null.
  readOpt() {
    this.skipWs();
    if (this.s[this.i] !== '[') return null;
    let d = 0;
    const st = this.i;
    for (; this.i < this.s.length; this.i++) {
      const c = this.s[this.i];
      if (c === '\\') { this.i++; continue; }
      if (c === '{') d++;
      else if (c === '}') d--;
      else if (c === ']' && d === 0) { this.i++; return this.s.slice(st + 1, this.i - 1); }
    }
    this.fail('Missing ]');
  }

  // A sub-expression parsed by a fresh parser that shares the state (optional arguments, inner $math$).
  // Nested parser for raw text pieces (optional arguments, $...$ inside \text); depth is inherited so the global
  // recursion cap still applies across parsers.
  sub(text, font = this.font) {
    const p = new Parser(text, this.display);
    p.font = font;
    p.depth = this.depth + 1;
    if (p.depth > MAX_DEPTH) this.fail('Too deeply nested');
    const r = p.parseList({});
    this.errors.push(...p.errors);
    return r.nodes;
  }

  // One argument: a {group} or a single token, as a node list.
  arg() {
    this.skipWs();
    if (this.end) this.fail('Missing argument');
    const c = this.s[this.i];
    if (c === '{') { this.i++; return this.parseList({ brace: true }).nodes; }
    if (c === '}' || c === '&') this.fail('Missing argument');
    if (c === '\\') { const name = this.readCmd(); return [this.command(name, {})].filter(Boolean); }
    return [this.atom(true)];
  }

  // The workhorse: parses until a terminator dictated by `mode` (closing brace, &, \\, \right, \end) and returns
  // why it stopped, so callers (groups, tables, \left...\right) can react. Infix \over / \choose consume the rest
  // of the current list as the denominator, the way TeX's generalised fractions work.
  parseList(mode) {
    if (++this.depth > MAX_DEPTH) this.fail('Too deeply nested');
    const out = [];
    const done = (stop, extra) => { this.depth--; return { nodes: out, stop, ...extra }; };
    for (;;) {
      this.skipWs();
      if (this.end) {
        if (mode.brace) this.fail('Missing }');
        if (mode.left) this.fail('Missing \\right');
        if (mode.env) this.fail('Missing \\end{' + mode.env + '}');
        return done(null);
      }
      const c = this.s[this.i];
      if (c === '}') { this.i++; if (mode.brace) return done('}'); this.fail('Unexpected }'); }
      if (c === '&') {
        this.i++;
        if (mode.cells) return done('&');
        this.fail('Unexpected &');
      }
      if (c === '^' || c === '_' || c === "'") { this.scripts(out); continue; }
      if (c === '\\') {
        const name = this.readCmd();
        if (name === '\\' || name === 'newline' || name === 'cr') {
          this.readOpt();
          if (mode.cells) return done('\\');
          continue;
        }
        if (name === 'end') {
          const env = this.readRaw().trim();
          if (mode.env) return done('end', { env });
          this.fail('Unexpected \\end{' + env + '}');
        }
        if (name === 'right') { if (mode.left) return done('right'); this.fail('Unexpected \\right'); }
        if (name === 'middle') {
          if (!mode.left) this.fail('Unexpected \\middle');
          out.push(N(`<mo fence="true" stretchy="true" symmetric="true">${esc(this.delim())}</mo>`, 'rel'));
          continue;
        }
        if (name === 'hline' || name === 'hdashline') { if (mode.cells) { if (out.length) this.hlEnd = true; else this.hlTop = true; } continue; }
        if (name === 'limits' || name === 'nolimits' || name === 'displaylimits') {
          const last = out[out.length - 1];
          if (last && last.k !== 'script') { last.lim = name === 'limits' ? 'always' : name === 'nolimits' ? 'never' : 'display'; if (name === 'limits') last.m = last.m.replace(/^<mo /, '<mo movablelimits="false" '); }
          continue;
        }
        // Switches that take the rest of the group.
        if (/^(display|text|script|scriptscript)style$/.test(name)) {
          const prev = this.display;
          this.display = name === 'displaystyle';
          const rest = this.parseList(mode);
          this.display = prev;
          const lvl = { displaystyle: 0, textstyle: 0, scriptstyle: 1, scriptscriptstyle: 2 }[name];
          out.push(N(`<mstyle displaystyle="${name === 'displaystyle'}" scriptlevel="${lvl}">${flat(rest.nodes)}</mstyle>`));
          this.depth--;
          return { ...rest, nodes: out };
        }
        if (name === 'color') {
          const col = this.readRaw().trim();
          const rest = this.parseList(mode);
          out.push(N(SAFE_COLOR.test(col) ? `<mstyle mathcolor="${esc(col)}">${flat(rest.nodes)}</mstyle>` : `<mrow>${flat(rest.nodes)}</mrow>`));
          this.depth--;
          return { ...rest, nodes: out };
        }
        if (Object.prototype.hasOwnProperty.call(OLD_FONTS, name)) {
          const prev = this.font;
          this.font = OLD_FONTS[name];
          const rest = this.parseList(mode);
          this.font = prev;
          out.push(...rest.nodes);
          this.depth--;
          return { ...rest, nodes: out };
        }
        if (name === 'over' || name === 'choose' || name === 'atop') {
          const num = out.splice(0);
          const rest = this.parseList(mode);
          const frac = `<mfrac${name === 'over' ? '' : ' linethickness="0"'}>${row(num)}${row(rest.nodes)}</mfrac>`;
          out.push(N(name === 'choose' ? `<mrow>${mo('(', ' stretchy="true"')}${frac}${mo(')', ' stretchy="true"')}</mrow>` : frac));
          this.depth--;
          return { ...rest, nodes: out };
        }
        const node = this.command(name, mode);
        if (node) out.push(node);
        continue;
      }
      out.push(this.atom(false));
    }
  }

  // ^ _ ' after the last node.
  // Attaches to the last node; a script with nothing before it gets an empty <mrow> base, as TeX allows.
  // Double scripts are an error in TeX too ('x^a^b' is ambiguous).
  scripts(out) {
    let last = out.pop();
    if (!last) last = N('<mrow></mrow>');
    if (last.k !== 'script') last = { k: 'script', base: last, sub: null, sup: null, primes: 0, display: this.display };
    const c = this.s[this.i];
    if (c === "'") {
      while (this.s[this.i] === "'") { last.primes++; this.i++; }
    } else {
      this.i++;
      const a = this.arg();
      if (c === '^') { if (last.sup) this.fail('Double superscript'); last.sup = a; }
      else { if (last.sub) this.fail('Double subscript'); last.sub = a; }
    }
    out.push(last);
  }

  // A character of the source (not a command).
  // single = true inside arguments: '12' after ^ binds only '1' (TeX takes one token), whereas in running text a whole
  // number becomes one <mn>. ASCII '-' is output as U+2212 MINUS, the correct mathematical glyph.
  atom(single) {
    const s = this.s;
    const c = s[this.i];
    if (c === '{') { this.i++; return N(row(this.parseList({ brace: true }).nodes)); }
    if (/[0-9.]/.test(c)) {
      const m = single ? [c] : /^(?:\d+(?:\.\d+)?|\.\d+|\.)/.exec(s.slice(this.i));
      this.i += m[0].length;
      if (m[0] === '.') return N(mo('.'), 'punct');
      return N(`<mn>${esc([...m[0]].map((x) => styled(x, this.font)).join(''))}</mn>`);
    }
    if (/[a-zA-Z]/.test(c)) {
      if (this.font && !single) {
        const m = /^[a-zA-Z]+/.exec(s.slice(this.i));
        this.i += m[0].length;
        const t = [...m[0]].map((x) => styled(x, this.font)).join('');
        return N(this.font === 'rm' && t.length === 1 ? `<mi mathvariant="normal">${t}</mi>` : `<mi>${t}</mi>`);
      }
      this.i++;
      const t = styled(c, this.font);
      return N(this.font === 'rm' ? `<mi mathvariant="normal">${t}</mi>` : `<mi>${t}</mi>`);
    }
    const cp = s.codePointAt(this.i);
    const ch = String.fromCodePoint(cp);
    this.i += ch.length;
    switch (ch) {
      case '+': return N(mo('+'), 'bin');
      case '-': return N(mo('−'), 'bin');
      case '*': return N(mo('∗'), 'bin');
      case '=': case '<': case '>': case ':': return N(mo(ch), 'rel');
      case ',': case ';': return N(mo(ch), 'punct');
      case '(': case '[': return N(mo(ch, ' stretchy="false"'), 'open');
      case ')': case ']': return N(mo(ch, ' stretchy="false"'), 'close');
      case '|': return N(mo('|', ' stretchy="false" lspace="0" rspace="0"'));
      case '~': return N('<mtext> </mtext>');
      case '$': return N('<mrow></mrow>');
      default:
        if (/\p{L}/u.test(ch)) return N(`<mi>${esc(styled(ch, this.font))}</mi>`);
        if (/\p{N}/u.test(ch)) return N(`<mn>${esc(ch)}</mn>`);
        return N(mo(ch));
    }
  }

  // Delimiter after \left \right \middle \big…: the character ('' for '.').
  delim() {
    this.skipWs();
    if (this.end) this.fail('Missing delimiter');
    let k = this.s[this.i];
    if (k === '\\') { k = this.readCmd(); if (k === '|') k = '\\|'; } else this.i++;
    const d = DELIMS[k];
    if (d == null) this.fail('Bad delimiter ' + k);
    return d;
  }

  // Text of \text{…}: escapes resolved, commands dropped, inner $math$ parsed. -> MathML elements.
  text(raw, font) {
    const parts = [];
    let t = '';
    const flushText = () => {
      if (!t) return;
      const s = [...t].map((x) => styled(x, font)).join('').replace(/^ | $/g, ' ');
      parts.push(`<mtext>${esc(s)}</mtext>`);
      t = '';
    };
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (c === '$') {
        const e = raw.indexOf('$', i + 1);
        if (e < 0) { t += c; continue; }
        flushText();
        parts.push(row(this.sub(raw.slice(i + 1, e), '')));
        i = e;
      } else if (c === '\\') {
        const m = /^[a-zA-Z]+/.exec(raw.slice(i + 1));
        if (m) {
          i += m[0].length;
          if (/^q?quad$/.test(m[0])) t += m[0] === 'quad' ? ' ' : '  ';
          else if (m[0] === 'textbackslash') t += '\\';
          else if (raw[i + 1] === ' ') i++;
        } else if (i + 1 < raw.length) { i++; t += raw[i] === ' ' || raw[i] === ',' ? ' ' : raw[i]; }
      } else if (c === '{' || c === '}') continue;
      else if (c === '~') t += ' ';
      else t += c;
    }
    flushText();
    return parts;
  }

  // A control word or symbol (already read). Returns a node or null (nothing to draw).
  // Order of lookup: spacing, escaped specials, sizing / fonts / structures, then the symbol tables. hasOwnProperty
  // on every table, so a command named \constructor cannot hit Object.prototype.
  command(name, mode) {
    if (Object.prototype.hasOwnProperty.call(SPACES, name)) return N(space(SPACES[name]), 'space');
    if (name === ' ' || name === 'space' || name === 'nobreakspace') return N('<mtext> </mtext>', 'space');
    if ('#$%&_'.includes(name) && name.length === 1) return N(`<mi>${esc(name)}</mi>`);
    if (name === 'hspace' || name === 'kern' || name === 'mkern' || name === 'hskip' || name === 'mskip') {
      this.star();
      let raw;
      if (name === 'hspace') raw = this.readRaw().trim();
      else { const d = /^\s*\{?\s*(-?[\d.]+\s*[a-z]{2})\s*\}?/.exec(this.s.slice(this.i)); raw = d ? d[1] : ''; this.i += d ? d[0].length : 0; }
      const m = /^(-?[\d.]+)\s*([a-z]{2})$/.exec(raw);
      return m ? N(space(Math.round(parseFloat(m[1]) * (UNITS[m[2]] || 1) * 1000) / 1000), 'space') : null;
    }
    const sym = Object.prototype.hasOwnProperty.call(SYMBOLS, name) ? SYMBOLS[name] : null;
    if (sym) return this.symbol(sym[0], sym[1]);
    if (Object.prototype.hasOwnProperty.call(FONTS, name)) {
      const prev = this.font;
      this.font = FONTS[name];
      const a = this.arg();
      this.font = prev;
      return N(row(a));
    }
    if (Object.prototype.hasOwnProperty.call(TEXT_FONTS, name)) {
      const parts = this.text(this.readRaw(), TEXT_FONTS[name]);
      return N(parts.length === 1 ? parts[0] : `<mrow>${parts.join('')}</mrow>`);
    }
    if (Object.prototype.hasOwnProperty.call(ACCENTS, name)) {
      const [ch, stretchy, under] = ACCENTS[name];
      const base = row(this.arg());
      const m = `<mo stretchy="${stretchy}">${esc(ch)}</mo>`;
      return N(under ? `<munder accentunder="true">${base}${m}</munder>` : `<mover accent="true">${base}${m}</mover>`);
    }
    switch (name) {
      case 'frac': case 'dfrac': case 'tfrac': case 'cfrac': case 'dbinom': case 'tbinom': case 'binom': {
        const a = row(this.arg()), b = row(this.arg());
        const binom = /binom/.test(name);
        let m = `<mfrac${binom ? ' linethickness="0"' : ''}>${a}${b}</mfrac>`;
        if (binom) m = `<mrow>${mo('(', ' stretchy="true"')}${m}${mo(')', ' stretchy="true"')}</mrow>`;
        if (name[0] === 'd' || name === 'cfrac') m = `<mstyle displaystyle="true" scriptlevel="0">${m}</mstyle>`;
        if (name[0] === 't') m = `<mstyle displaystyle="false" scriptlevel="0">${m}</mstyle>`;
        return N(m);
      }
      case 'sqrt': {
        const idx = this.readOpt();
        const base = row(this.arg());
        return N(idx != null ? `<mroot>${base}${row(this.sub(idx))}</mroot>` : `<msqrt>${base}</msqrt>`);
      }
      case 'left': {
        const l = this.delim();
        const inner = this.parseList({ left: true });
        const r = this.delim();
        return N(`<mrow>${fence(l, 'prefix')}${flat(inner.nodes)}${fence(r, 'postfix')}</mrow>`, 'inner');
      }
      case 'overbrace': case 'underbrace': {
        const base = row(this.arg());
        return N(name === 'overbrace' ? `<mover>${base}<mo stretchy="true">⏞</mo></mover>` : `<munder>${base}<mo stretchy="true">⏟</mo></munder>`, 'ord', { lim: 'always' });
      }
      case 'overset': case 'underset': case 'stackrel': {
        const top = row(this.arg()), base = row(this.arg());
        return N(name === 'underset' ? `<munder>${base}${top}</munder>` : `<mover>${base}${top}</mover>`, name === 'stackrel' ? 'rel' : 'ord');
      }
      case 'xrightarrow': case 'xleftarrow': case 'xRightarrow': case 'xLeftarrow': case 'xleftrightarrow': case 'xmapsto': {
        const below = this.readOpt();
        const above = row(this.arg());
        const ch = { xrightarrow: '→', xleftarrow: '←', xRightarrow: '⇒', xLeftarrow: '⇐', xleftrightarrow: '↔', xmapsto: '↦' }[name];
        const arrow = `<mo stretchy="true" minsize="1.8em">${ch}</mo>`;
        const pad = (x) => `<mpadded lspace="0.3em" width="+0.6em">${x}</mpadded>`;
        return N(below != null ? `<munderover>${arrow}${pad(row(this.sub(below)))}${pad(above)}</munderover>` : `<mover>${arrow}${pad(above)}</mover>`, 'rel');
      }
      case 'operatorname': case 'operatornamewithlimits': {
        const lim = this.star() || name === 'operatornamewithlimits';
        const t = esc(this.readRaw().replace(/\\[,;:!]|\\ /g, ' ').replace(/[\\{}]/g, '').trim());
        return lim ? N(`<mo lspace="0.1667em" rspace="0.1667em" movablelimits="true">${t}</mo>`, 'op', { lim: 'display' })
          : N(`<mi>${t}</mi>`, 'op', { post: '<mo>⁡</mo>', fn: true });
      }
      case 'mathop': return N(row(this.arg()), 'op', { lim: 'display' });
      case 'mathrel': case 'mathbin': case 'mathord': case 'mathopen': case 'mathclose': case 'mathpunct': case 'mathinner': case 'ensuremath':
        return N(row(this.arg()));
      case 'textcolor': {
        const col = this.readRaw().trim();
        const a = row(this.arg());
        return N(SAFE_COLOR.test(col) ? `<mstyle mathcolor="${esc(col)}">${a}</mstyle>` : a);
      }
      case 'boxed': case 'fbox': return N(`<mrow class="tex-boxed">${name === 'fbox' ? this.text(this.readRaw(), '').join('') : row(this.arg())}</mrow>`);
      case 'phantom': case 'hphantom': case 'vphantom': return N(`<mphantom>${row(this.arg())}</mphantom>`);
      case 'not': {
        this.skipWs();
        let key, ch;
        if (this.s[this.i] === '\\') { key = this.readCmd(); ch = SYMBOLS[key] ? SYMBOLS[key][0] : ''; }
        else { key = this.s[this.i++]; ch = key; }
        const neg = NEGATED[key] || (ch ? ch + '̸' : '');
        if (!neg) { this.err('Cannot negate \\' + key); return null; }
        return N(mo(neg), 'rel');
      }
      case 'pmod': return N(`<mrow>${space(1)}${mo('(', ' stretchy="false"')}<mi>mod</mi>${space(0.3333)}${row(this.arg())}${mo(')', ' stretchy="false"')}</mrow>`);
      case 'bmod': return N('<mo lspace="0.2222em" rspace="0.2222em">mod</mo>', 'bin');
      case 'mod': return N(`<mrow>${space(1)}<mi>mod</mi>${space(0.3333)}</mrow>`);
      case 'tag': {
        const st = this.star();
        const t = this.readRaw();
        this.tag = st ? t : '(' + t + ')';
        return null;
      }
      case 'label': this.readRaw(); return null;
      case 'nonumber': case 'notag': case 'nobreak': case 'allowbreak': case 'strut': case 'mathstrut': case 'relax': case 'displaybreak': case 'centering': return null;
      case 'substack': {
        this.skipWs();
        if (this.s[this.i] !== '{') this.fail('Missing argument');
        this.i++;
        return N(this.table(this.rows({ brace: true }), { align: () => 'c', cls: 'tex-tab tex-stack', display: false }));
      }
      case 'begin': return this.environment(this.readRaw().trim());
      case 'iff': case 'implies': case 'impliedby': return N(`<mo lspace="0.2778em" rspace="0.2778em">${SYMBOLS[name][0]}</mo>`, 'rel');
      default:
        if (/^[bB]igg?[lrm]?$/.test(name)) {
          const em = BIG[name.replace(/[lrm]$/, '')];
          const d = this.delim();
          const form = name.endsWith('l') ? ' form="prefix"' : name.endsWith('r') ? ' form="postfix"' : '';
          return N(`<mo fence="true" stretchy="true" symmetric="true"${form} minsize="${em}em" maxsize="${em}em">${esc(d)}</mo>`);
        }
        this.err('Unknown command \\' + name);
        return N(`<merror><mtext>\\${esc(name)}</mtext></merror>`);
    }
  }

  // movablelimits="true" lets the browser place limits under / over in display and beside inline, matching TeX's
  // behaviour for \sum and \lim without a second rendering path.
  symbol(ch, cls) {
    switch (cls) {
      case 'mi': return N(`<mi>${esc(styled(ch, this.font === 'rm' ? '' : this.font))}</mi>`);
      case 'mu': return N(`<mi mathvariant="normal">${esc(styled(ch, this.font))}</mi>`);
      case 'big': return N(`<mo largeop="true" movablelimits="true">${ch}</mo>`, 'op', { lim: 'display' });
      case 'int': return N(`<mo largeop="true">${ch}</mo>`, 'op', { lim: 'never' });
      case 'fn': return N(`<mi>${esc(ch)}</mi>`, 'op', { post: '<mo>⁡</mo>', fn: true });
      case 'fnl': return N(`<mo lspace="0.1667em" rspace="0.1667em" movablelimits="true">${esc(ch)}</mo>`, 'op', { lim: 'display' });
      case 'fence': return N(mo(ch, ' stretchy="false" lspace="0" rspace="0"'));
      case 'open': case 'close': return N(mo(ch, ' stretchy="false"'), cls);
      default: return N(mo(ch), cls);
    }
  }

  // Rows and cells until the end of an environment (mode.env) or a brace group: [{ cells: [[node]], top }] + flags.
  rows(mode) {
    const rows = [];
    let cur = { cells: [] };
    for (;;) {
      this.hlTop = this.hlEnd = false;
      const r = this.parseList({ ...mode, cells: true });
      if (this.hlTop && !cur.cells.length) cur.top = true;
      if (this.hlEnd) cur.bottom = true;
      cur.cells.push(r.nodes);
      if (r.stop === '&') continue;
      rows.push(cur);
      if (r.stop === '\\') { cur = { cells: [] }; continue; }
      if (mode.env && r.env !== mode.env) this.fail(`\\begin{${mode.env}} ended by \\end{${r.env}}`);
      break;
    }
    // A trailing \\ leaves an empty last row (its \hline is the bottom rule of the row before).
    const last = rows[rows.length - 1];
    if (rows.length > 1 && last.cells.length === 1 && !last.cells[0].length) { rows.pop(); if (last.top) rows[rows.length - 1].bottom = true; }
    return rows;
  }

  // <mtable> of rows; o = { align(k) -> 'l' | 'c' | 'r', cls, display, cell(k, nodes) -> MathML, lines: { left: Set, right } }
  table(rows, o) {
    const n = Math.max(1, ...rows.map((r) => r.cells.length));
    const trs = rows.map((r) => {
      const cls = [r.top ? 'tex-ht' : '', r.bottom ? 'tex-hb' : ''].filter(Boolean);
      const tds = [];
      for (let k = 0; k < n; k++) {
        const a = o.align(k);
        const c = [a === 'l' ? 'tex-l' : a === 'r' ? 'tex-r' : '', o.gap && o.gap(k) ? 'tex-g' : '', o.lines && o.lines.left.has(k) ? 'tex-vl' : '', o.lines && o.lines.right && k === n - 1 ? 'tex-vr' : ''].filter(Boolean);
        const nodes = r.cells[k] || [];
        const body = o.cell ? o.cell(k, nodes) : flat(nodes);
        tds.push(`<mtd${a !== 'c' ? ` columnalign="${a === 'l' ? 'left' : 'right'}"` : ''}${c.length ? ` class="${c.join(' ')}"` : ''}>${body}</mtd>`);
      }
      return `<mtr${cls.length ? ` class="${cls.join(' ')}"` : ''}>${tds.join('')}</mtr>`;
    });
    return `<mtable class="${o.cls}" displaystyle="${!!o.display}">${trs.join('')}</mtable>`;
  }

  environment(env) {
    const mode = { env };
    if (Object.prototype.hasOwnProperty.call(MATRIX, env)) {
      const [l, r] = MATRIX[env];
      let t = this.table(this.rows(mode), { align: () => 'c', cls: 'tex-tab tex-mat', display: false });
      if (env === 'smallmatrix') t = `<mstyle scriptlevel="1">${t}</mstyle>`;
      return N(l ? `<mrow>${fence(l, 'prefix')}${t}${fence(r, 'postfix')}</mrow>` : t, 'inner');
    }
    if (env === 'cases' || env === 'dcases' || env === 'rcases') {
      const t = this.table(this.rows(mode), { align: () => 'l', cls: 'tex-tab tex-cases', display: env === 'dcases' });
      return N(env === 'rcases' ? `<mrow>${t}${fence('}', 'postfix')}</mrow>` : `<mrow>${fence('{', 'prefix')}${t}</mrow>`, 'inner');
    }
    if (ALIGNED.has(env)) {
      if (/^alignat|^alignedat/.test(env)) this.readRaw();
      return N(this.alignTable(this.rows(mode)));
    }
    if (GATHER.has(env)) return N(this.table(this.rows(mode), { align: () => 'c', cls: 'tex-tab', display: true }));
    if (env === 'equation' || env === 'equation*' || env === 'displaymath' || env === 'math') {
      const r = this.parseList(mode);
      if (r.env !== env) this.fail(`\\begin{${env}} ended by \\end{${r.env}}`);
      return N(row(r.nodes));
    }
    if (env === 'array' || env === 'darray' || env === 'subarray') {
      const spec = this.readRaw();
      const align = [];
      const left = new Set();
      let right = false;
      for (let i = 0; i < spec.length; i++) {
        const c = spec[i];
        if (c === '|') { if (i === spec.length - 1 || !/[lcrpmbX]/.test(spec.slice(i + 1).replace(/[|\s]/g, ''))) right = true; else left.add(align.length); }
        else if ('lcr'.includes(c)) align.push(c);
        else if ('pmbX'.includes(c)) { align.push('l'); if (spec[i + 1] === '{') i = spec.indexOf('}', i); }
        else if (c === '@' || c === '!') { if (spec[i + 1] === '{') i = spec.indexOf('}', i); }
      }
      const t = this.table(this.rows(mode), { align: (k) => align[k] || 'c', cls: 'tex-tab tex-arr', display: env === 'darray', lines: { left, right } });
      return N(env === 'subarray' ? `<mstyle scriptlevel="1">${t}</mstyle>` : t);
    }
    this.fail('Unknown environment ' + env);
  }

  // aligned: columns alternate right / left; a cell after & starts with an empty <mi> so a leading relation keeps its
  // spacing; column pairs are separated by a wide gap.
  alignTable(rows) {
    return this.table(rows, {
      align: (k) => (k % 2 ? 'l' : 'r'), gap: (k) => k > 0 && k % 2 === 0, cls: 'tex-tab tex-align', display: true,
      cell: (k, nodes) => (k % 2 ? '<mi></mi>' : '') + flat(nodes),
    });
  }
}

// The original TeX travels in an <annotation>: copy-paste and screen readers can recover the source.
const wrapMath = (body, display, src) => `<math xmlns="${NS}" display="${display ? 'block' : 'inline'}"><semantics>${body}<annotation encoding="application/x-tex">${esc(src)}</annotation></semantics></math>`;

// Never throws: any internal exception becomes an <merror> with the escaped source, so one bad formula cannot break
// the page that renders a document full of them.
export function texToMathML(tex, { display = false } = {}) {
  const src = String(tex == null ? '' : tex);
  try {
    if (src.length > MAX_LEN) throw new TexError('Formula too long');
    const p = new Parser(src, !!display);
    let body;
    // Top level: cells and rows (\\, &) make an aligned table; otherwise one row.
    const rows = p.rows({});
    if (rows.length === 1 && rows[0].cells.length === 1) body = row(rows[0].cells[0]);
    else if (rows.every((r) => r.cells.length === 1)) body = p.table(rows, { align: () => 'c', cls: 'tex-tab', display: true });
    else body = p.alignTable(rows);
    if (p.tag) body = `<mrow>${body}<mspace width="2em"/><mtext>${esc(p.tag)}</mtext></mrow>`;
    if (!/^<mrow>/.test(body)) body = `<mrow>${body}</mrow>`;
    return { mathml: wrapMath(body, display, src), error: p.errors[0] || null };
  } catch (e) {
    const msg = e instanceof TexError ? e.message : 'Cannot read the formula: ' + ((e && e.message) || e);
    return { mathml: wrapMath(`<merror><mtext>${esc(src)}</mtext></merror>`, display, src), error: msg };
  }
}

export const MATH_CSS = `math{font-family:math,"Cambria Math","STIX Two Math","Latin Modern Math","Noto Sans Math",serif}
math[display=block]{display:block math;margin:.6em 0;overflow-x:auto;overflow-y:hidden;padding:.1em 0}
merror{color:#c0362c;background:rgba(192,54,44,.08);outline:1px dashed rgba(192,54,44,.5)}
mtable.tex-tab mtd{padding:.12em .5em}mtable.tex-align mtd,mtable.tex-cases mtd{padding-left:0;padding-right:0}
mtable.tex-cases mtd+mtd{padding-left:1em}mtd.tex-g{padding-left:2em!important}mtd.tex-l{text-align:left}mtd.tex-r{text-align:right}
mtd.tex-vl{border-left:1px solid}mtd.tex-vr{border-right:1px solid}mtr.tex-ht>mtd{border-top:1px solid}mtr.tex-hb>mtd{border-bottom:1px solid}
mtable.tex-stack mtd{padding:0}.tex-boxed{border:1px solid;padding:.15em .3em}`;
