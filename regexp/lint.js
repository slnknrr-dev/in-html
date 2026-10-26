// regexp/lint.js - static warnings for a parsed pattern: backtracking risks, needless or misleading escapes, empty
// alternatives, unused flags and more. Each warning is { code, severity: 'danger' | 'warn' | 'info', start, end, params }.
//
// Approach: approximate set arithmetic over code point ranges. Each check must be cheap (runs per keystroke) and must
// prefer silence over a false alarm: whenever a set is unknown (null) the comparison yields null and no warning fires.
// ReDoS detection is heuristic (nested / overlapping unbounded repetition), not a full ambiguity analysis of the NFA;
// that would be exponential in the worst case, which is exactly what we warn about.
// Warnings are codes (localised by the app) sorted danger > warn > info, then by position.
import { childrenOf } from './parse.js';

// --- character sets: sorted, disjoint [lo, hi] code point ranges; null = unknown -------------------------------

const MAX = 0x10ffff;
const DIGIT = [[48, 57]];
const WORD = [[48, 57], [65, 90], [95, 95], [97, 122]];
// JS \s = WhiteSpace + LineTerminator: TAB..CR, SP, NBSP, U+1680, U+2000-200A, LS, PS, U+202F, U+205F, U+3000, BOM.
const SPACE = [[9, 13], [32, 32], [160, 160], [5760, 5760], [8192, 8202], [8232, 8233], [8239, 8239], [8287, 8287], [12288, 12288], [65279, 65279]];
const LINE_END = [[10, 10], [13, 13], [8232, 8233]];
// Rough sets of property escapes (enough to tell letters from spaces and punctuation).
const ALNUM_PLUS = [[48, 57], [65, 90], [97, 122], [170, 170], [181, 181], [186, 186], [192, MAX]];
const PUNCT_PLUS = [[33, 47], [58, 64], [91, 96], [123, 126], [161, 191], [0x2010, 0x2027], [0x2030, 0x205e], [0x3000, 0x303f]];

// Canonical form: drop empty ranges, sort, merge overlapping and adjacent ([1,3]+[4,5] = [1,5]). Every set operation
// below assumes this form (intersects() is a linear merge walk).
function norm(rs) {
  const s = rs.filter((r) => r[0] <= r[1]).map((r) => [r[0], r[1]]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const r of s) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else out.push(r);
  }
  return out;
}
const union = (a, b) => (a && b ? norm([...a, ...b]) : null);
function complement(a) {
  if (!a) return null;
  const out = [];
  let lo = 0;
  for (const [x, y] of a) { if (x > lo) out.push([lo, x - 1]); lo = y + 1; }
  if (lo <= MAX) out.push([lo, MAX]);
  return out;
}
function intersects(a, b) {
  if (!a || !b) return null;
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i][1] < b[j][0]) i++;
    else if (b[j][1] < a[i][0]) j++;
    else return true;
  }
  return false;
}
// Case variants of ASCII letters (the i flag). Non-ASCII folding (e.g. K / KELVIN SIGN) is ignored: it can only make
// sets larger, so the checks may miss an overlap but never invent one. classOverlap deliberately ignores
// case on purpose (see klass()).
function fold(a) {
  if (!a) return null;
  const extra = [];
  for (const [x, y] of a) {
    const lo = Math.max(x, 65), hi = Math.min(y, 90);
    if (lo <= hi) extra.push([lo + 32, hi + 32]);
    const lo2 = Math.max(x, 97), hi2 = Math.min(y, 122);
    if (lo2 <= hi2) extra.push([lo2 - 32, hi2 - 32]);
  }
  return norm([...a, ...extra]);
}

// Over-approximation by name: good enough to tell \p{L} from \p{P} or \s. Unknown or catch-all properties
// return null (no claims), so a wrong guess can at most hide a warning.
function propertySet(e) {
  const v = e.value || '';
  let set;
  if (/^(Z|Zs|Zl|Zp|Separator|Space_Separator|White_Space|space)$/.test(v)) set = SPACE;
  else if (/^(P|S|Punctuation|Symbol|P[cdefios]|S[ckmo])$/.test(v) || /_(Punctuation|Symbol)$/.test(v)) set = PUNCT_PLUS;
  else if (/^(C|Cc|Cf|Cn|Co|Cs|Control|Other|Format|Any|Assigned|ASCII)$/.test(v) || e.strings) return null;
  else set = ALNUM_PLUS;
  return e.negate ? complement(set) : set;
}

// The characters one element can match (single-character matchers only; null = unknown or not a single character).
function charSet(e, f) {
  switch (e.type) {
    case 'Character': return f.ignoreCase ? fold([[e.value, e.value]]) : [[e.value, e.value]];
    case 'CharacterSet': {
      if (e.kind === 'any') return f.dotAll ? [[0, MAX]] : complement(LINE_END);
      if (e.kind === 'property') return propertySet(e);
      const s = e.kind === 'digit' ? DIGIT : e.kind === 'word' ? WORD : SPACE;
      return e.negate ? complement(s) : s;
    }
    case 'ClassRange': return f.ignoreCase ? fold([[e.min.value, e.max.value]]) : [[e.min.value, e.max.value]];
    case 'CharacterClass': {
      if (e.kind !== 'union') return null;
      let s = [];
      for (const x of e.elements) { s = union(s, charSet(x, f)); if (!s) return null; }
      return e.negate ? complement(s) : s;
    }
    default: return null;
  }
}

// Lookarounds and assertions consume nothing, hence [] (empty set), not null.
// Every character a subtree may consume (outside lookarounds); null = unknown.
function allChars(e, f) {
  if (e.type === 'Lookaround' || e.type === 'Assertion') return [];
  if (e.type === 'Backreference') return null;
  const s = charSet(e, f);
  if (s || ['Character', 'CharacterSet', 'CharacterClass', 'ClassRange'].includes(e.type)) return s;
  let acc = [];
  for (const c of childrenOf(e)) { acc = union(acc, allChars(c, f)); if (!acc) return null; }
  return acc;
}

// Minimum length (0 = the element can match the empty string).
function minLen(e) {
  switch (e.type) {
    case 'Character': case 'CharacterSet': case 'ClassRange': return 1;
    case 'CharacterClass': return e.unicodeSets && e.elements.some((x) => x.type === 'ClassStringDisjunction' && x.alternatives.some((a) => !a.elements.length)) ? 0 : 1;
    case 'Quantifier': return e.min === 0 ? 0 : e.min * minLen(e.element);
    case 'Alternative': return e.elements.reduce((a, x) => a + minLen(x), 0);
    case 'Group': case 'CapturingGroup': case 'Pattern': return Math.min(...e.alternatives.map(minLen));
    default: return 0; // assertions, lookarounds, back-references (may be empty)
  }
}

// --- the checks ------------------------------------------------------------------------------------------

const SYNTAX = '^$\\.*+?()[]{}|/';
const ESCAPE_HINTS = { A: '^', z: '$', Z: '$', h: '[ \\t]', H: '[^ \\t]', e: '\\x1B', a: '\\x07', R: '\\r?\\n', K: '', G: '', Q: '', E: '', i: '', l: '', L: '', U: '', N: '', X: '', C: '' };

/** Warnings of a parse result (parseRegExp); [] for an invalid pattern. */
export function lint(parsed) {
  if (!parsed || !parsed.ok) return [];
  const src = parsed.source, f = parsed.flags, ast = parsed.ast;
  const unicode = f.unicode || f.unicodeSets;
  const out = [];
  const warn = (code, severity, start, end, params = {}) => out.push({ code, severity, start, end, params });
  const raw = (n) => src.slice(n.start, n.end);
  const groupsByIndex = new Map(parsed.groups.map((g) => [g.index, g]));
  let usesAnchor = false, usesDot = false, usesCased = false;

  // Duplicate alternatives are compared by source text: cheap and never wrong (equal text = equal language), though
  // it misses semantically equal spellings like a|[a].
  function disjunction(node) {
    const alts = node.alternatives;
    if (alts.length < 2) return;
    alts.forEach((a, i) => {
      if (!a.elements.length) {
        const at = a.start > 0 && src[a.start - 1] === '|' ? a.start - 1 : a.end;
        warn('emptyAlternative', 'warn', at, Math.min(src.length, at + 1));
      } else if (alts.slice(0, i).some((b) => raw(b) === raw(a))) warn('duplicateAlternative', 'warn', a.start, a.end, { text: raw(a) });
    });
  }

  function quantifier(q, parent) {
    const qraw = src.slice(q.qStart, q.end).replace(/\?$/, '');
    if (qraw[0] === '{') {
      if (q.min === 0 && q.max === 0) warn('quantifierZero', 'warn', q.qStart, q.end);
      else if (q.min === 1 && q.max === 1) warn('quantifierOne', 'info', q.qStart, q.end);
      else {
        const short = q.min === 0 && q.max === 1 ? '?' : q.min === 0 && q.max === Infinity ? '*' : q.min === 1 && q.max === Infinity ? '+' : null;
        if (short) warn('quantifierShorthand', 'info', q.qStart, q.end, { short: short + (q.greedy ? '' : '?'), text: src.slice(q.qStart, q.end) });
      }
    }
    if (q.element.type === 'Lookaround') warn('quantifiedAssertion', 'warn', q.start, q.end);
    // Only large or unbounded repetition can blow up backtracking; {2,5} of anything stays polynomial with a tiny base.
    if (q.max === Infinity || q.max >= 100) {
      if (nested(q)) warn('nestedQuantifier', 'danger', q.start, q.end);
      else {
        const body = unwrap(q.element);
        if (body && body.alternatives.length > 1) {
          // (a|ab)* style ambiguity, restricted to single-character alternatives where overlap is decidable here.
          const singles = body.alternatives.map((a) => (a.elements.length === 1 ? charSet(a.elements[0], f) : null));
          let hit = false;
          for (let i = 0; i < singles.length && !hit; i++) for (let j = i + 1; j < singles.length && !hit; j++) hit = !!(singles[i] && singles[j] && intersects(singles[i], singles[j]));
          if (hit) warn('overlappingAlternatives', 'danger', q.start, q.end);
        }
      }
    }
    // A lazy quantifier at the very end of the pattern matches as little as possible: x*? at the end matches nothing.
    if (!q.greedy && q.min === 0 && parent === ast.alternatives[ast.alternatives.length - 1] && parent.elements[parent.elements.length - 1] === q) {
      warn('lazyAtEnd', 'info', q.qStart, q.end);
    }
  }

  // An unbounded repetition whose body contains another repetition, with no mandatory delimiter that the inner
  // repetitions cannot consume: the same text splits into iterations in exponentially many ways.
  function nested(q) {
    const inner = [];
    (function collect(n) {
      for (const c of childrenOf(n)) {
        if (c.type === 'Lookaround') continue;
        // Only variable repetitions ({1,3}, +, *) can split the same text in several ways; {3} cannot.
        if (c.type === 'Quantifier' && c.max >= 2 && c.min < c.max && minLen(c.element) > 0) inner.push(c);
        collect(c);
      }
    })(q);
    if (!inner.length) return false;
    let chars = [];
    for (const c of inner) { chars = union(chars, allChars(c.element, f)); if (!chars) break; }
    // Safe iff every alternative contains a mandatory element whose characters provably cannot be eaten by the inner
    // repetitions (e.g. (\d+,)* is safe: ',' separates iterations). intersects() === false, not falsy: unknown is unsafe.
    const alts = q.element.type === 'Group' || q.element.type === 'CapturingGroup' ? q.element.alternatives : [{ elements: [q.element] }];
    return alts.some((a) => !a.elements.some((e) => minLen(e) > 0 && intersects(allChars(e, f), chars) === false));
  }

  // Peels redundant single-element groups ((?:(a|b))) down to the group that actually holds the alternation.
  function unwrap(e) {
    while (e && (e.type === 'Group' || e.type === 'CapturingGroup') && e.alternatives.length === 1 && e.alternatives[0].elements.length === 1) e = e.alternatives[0].elements[0];
    return e && (e.type === 'Group' || e.type === 'CapturingGroup') ? e : null;
  }

  function sequence(alt) {
    const els = alt.elements;
    for (let i = 0; i + 1 < els.length; i++) {
      const a = els[i], b = els[i + 1];
      // \d+\d+ style: two unbounded neighbours over overlapping sets give O(n^2) splits on a failing match.
      if (a.type === 'Quantifier' && b.type === 'Quantifier' && a.max === Infinity && b.max === Infinity) {
        const sa = charSet(a.element, f), sb = charSet(b.element, f);
        if (sa && sb && intersects(sa, sb)) warn('adjacentQuantifiers', 'warn', a.start, b.end);
      }
    }
    // ^ after something that consumes characters, or $ before it, can never match without the m flag.
    if (!f.multiline) {
      els.forEach((e, i) => {
        if (e.type !== 'Assertion' || e.kind === 'word') return;
        const others = e.kind === 'start' ? els.slice(0, i) : els.slice(i + 1);
        if (others.some((x) => minLen(x) > 0)) warn('impossibleAnchor', 'warn', e.start, e.end, { anchor: e.kind === 'start' ? '^' : '$' });
      });
    }
  }

  function klass(c) {
    if (!c.elements.length) {
      if (c.negate) warn('anyClass', 'info', c.start, c.end, { text: raw(c) });
      else warn('emptyClass', 'warn', c.start, c.end);
      return;
    }
    if (c.kind !== 'union') return;
    // ignoreCase off: [Aa] under /i is redundant only by case, which is a style choice, not an overlap worth noting.
    const sets = c.elements.map((e) => ({ e, s: charSet(e, { ...f, ignoreCase: false }) }));
    if (!c.negate && c.elements.length === 2 && c.elements.every((e) => e.type === 'CharacterSet' && e.kind !== 'any' && e.kind !== 'property')
      && c.elements[0].kind === c.elements[1].kind && c.elements[0].negate !== c.elements[1].negate) {
      warn('anyClass', 'info', c.start, c.end, { text: raw(c) });
      return;
    }
    // Report only the first overlap: one note per class is enough to prompt a review; N^2 notes would be noise.
    outer: for (let i = 0; i < sets.length; i++) {
      for (let j = i + 1; j < sets.length; j++) {
        if (sets[i].s && sets[j].s && intersects(sets[i].s, sets[j].s)) {
          warn('classOverlap', 'info', sets[j].e.start, sets[j].e.end, { a: raw(sets[i].e), b: raw(sets[j].e) });
          break outer;
        }
      }
    }
  }

  // Escape hygiene. Without u, unknown letter escapes silently mean the letter itself (\d is a digit but \e is 'e'),
  // a classic porting bug from PCRE; ESCAPE_HINTS suggests the JS spelling of the PCRE escape.
  function character(ch, inClass, vClass) {
    const c = String.fromCodePoint(ch.value);
    if (/\p{L}/u.test(c) && c.toLowerCase() !== c.toUpperCase()) usesCased = true;
    if (ch.escape === 'identity' && !unicode) {
      const next = src[ch.end];
      if ((c === 'u' || c === 'p' || c === 'P') && next === '{') {
        const close = src.indexOf('}', ch.end);
        const end = close < 0 ? ch.end + 1 : close + 1;
        warn(c === 'u' ? 'braceEscapeNoUnicode' : 'propertyNoUnicode', 'warn', ch.start, end, { text: src.slice(ch.start, end) });
      } else if (/[A-Za-z0-9]/.test(c)) {
        const hint = c === 'x' ? '\\xHH' : c === 'u' ? '\\uHHHH' : c === 'k' ? '\\k<name>' : ESCAPE_HINTS[c] || '';
        warn('unknownEscape', 'warn', ch.start, ch.end, { char: c, hint });
      } else if (inClass ? !'\\]^-'.includes(c) : !SYNTAX.includes(c) && c !== '-') {
        warn('uselessEscape', 'info', ch.start, ch.end, { char: c });
      } else if (!inClass && c === '-') warn('uselessEscape', 'info', ch.start, ch.end, { char: c });
    } else if (ch.escape === 'identity' && unicode && !vClass && inClass && c !== '-' && !'\\]^'.includes(c) && c !== '/') {
      warn('uselessEscape', 'info', ch.start, ch.end, { char: c });
    }
    if (ch.escape === 'octal') warn('octalEscape', 'warn', ch.start, ch.end, { code: 'U+' + ch.value.toString(16).toUpperCase().padStart(4, '0'), text: raw(ch) });
    if (ch.escape === 'backslash') warn('loneControl', 'warn', ch.start, ch.end + 1);
    if (ch.escape === 'backspace' && inClass) warn('classBackspace', 'info', ch.start, ch.end);
    // Without u an astral character is two code units: a quantifier after it repeats only the low surrogate.
    if (!unicode && ch.escape === null && ch.value >= 0xd800 && ch.value <= 0xdbff) {
      const lo = src.charCodeAt(ch.end);
      if (lo >= 0xdc00 && lo <= 0xdfff) warn('astralNoUnicode', 'warn', ch.start, ch.end + 1, { char: src.slice(ch.start, ch.end + 1) });
    }
  }

  function visit(node, parent, inClass, vClass) {
    switch (node.type) {
      case 'Pattern': case 'Group': case 'CapturingGroup': case 'Lookaround':
        disjunction(node);
        if ((node.type === 'Group' || node.type === 'CapturingGroup') && node.alternatives.length === 1 && !node.alternatives[0].elements.length) warn('emptyGroup', 'info', node.start, node.end);
        break;
      case 'Alternative': sequence(node); break;
      case 'Quantifier': quantifier(node, parent); break;
      case 'CharacterClass': klass(node); inClass = true; vClass = vClass || node.unicodeSets; break;
      case 'ClassRange': {
        const a = node.min.value, b = node.max.value;
        // [A-z] also includes [ \ ] ^ _ ` (91-96); [0-z] spans punctuation too. Almost always meant [A-Za-z].
        if ((a >= 65 && a <= 90 && b >= 97 && b <= 122) || (a >= 48 && a <= 57 && b >= 65 && b <= 122)) warn('suspiciousRange', 'warn', node.start, node.end, { text: raw(node) });
        if (/[A-Za-z]/.test(String.fromCodePoint(a)) || /[A-Za-z]/.test(String.fromCodePoint(b))) usesCased = true;
        break;
      }
      case 'Character': character(node, inClass, vClass); break;
      case 'CharacterSet':
        if (node.kind === 'any') usesDot = true;
        if (node.kind === 'property') usesCased = true;
        break;
      case 'Assertion': if (node.kind !== 'word') usesAnchor = true; break;
      case 'Backreference':
        for (const gi of node.groups) {
          const g = groupsByIndex.get(gi);
          // A reference before its group (forward) or inside it (self) always matches the empty string in JS.
          if (g && (g.start > node.start || (g.start < node.start && node.end <= g.end))) {
            warn('backrefEmpty', 'warn', node.start, node.end, { ref: node.named ? node.ref : '\\' + node.ref });
            break;
          }
        }
        break;
      default: break;
    }
    for (const c of childrenOf(node)) visit(c, node, inClass, vClass);
  }
  visit(ast, null, false, false);

  // Greedy wildcards at both ends of an unanchored pattern only widen the match.
  if (ast.alternatives.length === 1 && !f.sticky) {
    const els = ast.alternatives[0].elements;
    // "Wide" = more than the BMP's worth of code points, i.e. . or [^x]-like, not \w+.
    const wild = (e) => e && e.type === 'Quantifier' && e.max === Infinity && e.min <= 1 && e.greedy && (charSet(e.element, f) || []).length > 0
      && charSet(e.element, f).reduce((a, r) => a + r[1] - r[0] + 1, 0) > 0x10000;
    if (els.length >= 2 && wild(els[0]) && wild(els[els.length - 1])) warn('greedyEnds', 'info', els[0].start, els[els.length - 1].end);
    else if (els.length >= 2 && wild(els[0])) warn('leadingWildcard', 'info', els[0].start, els[0].end);
  }
  // Flags with nothing to act on: m needs ^ / $, s needs '.', i needs a cased letter (or a property, conservatively).
  if (f.multiline && !usesAnchor) warn('flagUnused', 'info', 0, 0, { flag: 'm' });
  if (f.dotAll && !usesDot) warn('flagUnused', 'info', 0, 0, { flag: 's' });
  if (f.ignoreCase && !usesCased) warn('flagUnused', 'info', 0, 0, { flag: 'i' });
  const rank = { danger: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.start - b.start);
}

export const LINT_CODES = ['nestedQuantifier', 'overlappingAlternatives', 'adjacentQuantifiers', 'duplicateAlternative', 'emptyAlternative', 'emptyGroup',
  'emptyClass', 'anyClass', 'classOverlap', 'suspiciousRange', 'unknownEscape', 'uselessEscape', 'octalEscape', 'loneControl', 'braceEscapeNoUnicode',
  'propertyNoUnicode', 'astralNoUnicode', 'classBackspace', 'backrefEmpty', 'impossibleAnchor', 'greedyEnds', 'leadingWildcard', 'lazyAtEnd',
  'quantifierOne', 'quantifierZero', 'quantifierShorthand', 'quantifiedAssertion', 'flagUnused'];
