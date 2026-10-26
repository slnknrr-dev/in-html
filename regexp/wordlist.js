// regexp/wordlist.js - a list of words or strings as one pattern built from a prefix tree: alternatives never start
// with the same character, so the engine never backtracks between them (no `a|ab|abc` scans), single characters
// become classes and endings become optional suffixes.
//
//   alternation(strings, { caseless }) -> pattern source without anchors (a group when it holds alternatives)
//   wordListPattern(words, { caseless, whole: 'word' | 'line' | 'none', name = 'word' }) -> { source, flags }
//   escapeLiteral(text) / escapeClassChar(char): escaping for u-mode patterns
//
// whole: 'word' puts Unicode-aware boundaries around the list (letters, digits, marks and _ of any script),
// 'line' anchors it to whole lines (^…$ with the m flag), 'none' finds it anywhere.

// SyntaxCharacter plus '/': '/' needs no escape in a RegExp source but does in a literal, and u mode allows \/.
const SYNTAX = /[\\^$.*+?()[\]{}|/]/;
// Characters that look like nothing or like a space (soft hyphen, zero-width, bidi marks, line separators): written
// as \u escapes so the generated pattern can be read and reviewed.
const INVISIBLE = /[\s\u00AD\u200B-\u200F\u2028-\u202F\u2060\uFEFF]/u;

function hex(cp) { return cp > 0xffff ? `\\u{${cp.toString(16).toUpperCase()}}` : '\\u' + cp.toString(16).toUpperCase().padStart(4, '0'); }

// One code point outside a class.
export function escapeChar(ch) {
  if (SYNTAX.test(ch)) return '\\' + ch;
  if (ch === '\t') return '\\t';
  if (ch === '\n') return '\\n';
  // Plain space stays literal (checked before INVISIBLE, whose \s would catch it).
  if (ch === ' ') return ' ';
  if (INVISIBLE.test(ch) || /\p{C}/u.test(ch)) return hex(ch.codePointAt(0));
  return ch;
}

// One code point inside a u-mode class. Only \ ] ^ - [ are special there; escaping others would be an error in u
// mode, where identity escapes are restricted to syntax characters.
export function escapeClassChar(ch) {
  if (/[\\\]^-]/.test(ch)) return '\\' + ch;
  if (ch === '[') return '\\[';
  if (ch === ' ') return ' ';
  if (INVISIBLE.test(ch) || /\p{C}/u.test(ch)) return hex(ch.codePointAt(0));
  return ch;
}

export const escapeLiteral = (text) => Array.from(String(text), escapeChar).join('');

// A class (or a single escaped character) for a set of single code points; runs of 3+ consecutive code points become
// ranges.
export function charClass(chars) {
  const cps = [...new Set(Array.from(chars, (c) => c.codePointAt(0)))].sort((a, b) => a - b);
  if (!cps.length) return '[]';
  if (cps.length === 1) return escapeChar(String.fromCodePoint(cps[0]));
  let out = '';
  for (let i = 0; i < cps.length;) {
    let j = i;
    while (j + 1 < cps.length && cps[j + 1] === cps[j] + 1) j++;
    const a = escapeClassChar(String.fromCodePoint(cps[i])), b = escapeClassChar(String.fromCodePoint(cps[j]));
    out += j - i >= 2 ? `${a}-${b}` : j > i ? a + b : a;
    i = j + 1;
  }
  return `[${out}]`;
}

// Prefix tree of code-point arrays: node = { end, kids: Map(char -> node) }.
// Array.from iterates code points, so an astral character is one edge, never two surrogate halves.
function trie(strings) {
  const root = { end: false, kids: new Map() };
  for (const s of strings) {
    let n = root;
    for (const ch of Array.from(s)) {
      if (!n.kids.has(ch)) n.kids.set(ch, { end: false, kids: new Map() });
      n = n.kids.get(ch);
    }
    n.end = true;
  }
  return root;
}

// Does a rendered piece form a single atom (class, one escape, one character)? Then '?' applies to it directly;
// otherwise it must be grouped first, or the '?' would bind only to the last character.
const ONE_ATOM = /^(?:\[(?:\\.|[^\]\\])*\]|\\u\{[0-9A-F]+\}|\\u[0-9A-F]{4}|\\.|.)$/su;

// Source of the strings below a node (empty string when the node ends with no children).
function render(node) {
  const leaves = [], branches = [];
  for (const [ch, kid] of node.kids) (kid.kids.size ? branches : leaves).push([ch, kid]);
  const alts = [];
  if (leaves.length) alts.push(charClass(leaves.map(([ch]) => ch)));
  for (const [ch, kid] of branches) {
    // Chains of single children collapse into one literal run.
    let text = escapeChar(ch), n = kid;
    while (!n.end && n.kids.size === 1) { const [[c, k]] = n.kids; text += escapeChar(c); n = k; }
    const rest = render(n);
    alts.push(text + rest);
  }
  if (!alts.length) return '';
  const body = alts.length === 1 ? alts[0] : `(?:${alts.join('|')})`;
  if (!node.end) return body;
  // An ending here makes the rest optional (one atom takes the ? directly).
  return (ONE_ATOM.test(body) ? body : `(?:${body})`) + '?';
}

export function alternation(strings, { caseless = false } = {}) {
  const list = [...new Set(strings.map((s) => (caseless ? String(s).toLowerCase() : String(s))).filter((s) => s.length))];
  // Empty list: a pattern that never matches, rather than '' (which would match everywhere).
  if (!list.length) return '(?!)';
  const t = trie(list);
  return render(t);
}

export function wordListPattern(words, { caseless = false, whole = 'word', name = 'word' } = {}) {
  const list = (Array.isArray(words) ? words : String(words).split(/\r?\n|,/)).map((w) => w.trim()).filter(Boolean);
  const body = alternation(list, { caseless });
  const group = name ? `(?<${name}>${body})` : `(?:${body})`;
  const flags = 'gu' + (caseless ? 'i' : '') + (whole === 'line' ? 'm' : '');
  // Lookaround boundaries instead of \b: \b is ASCII-only in JS even with u, so it would cut words in Cyrillic or
  // Georgian. \p{M} keeps combining marks inside a word.
  const source = whole === 'line' ? `^${group}$`
    : whole === 'word' ? `(?<![\\p{L}\\p{M}\\p{N}_])${group}(?![\\p{L}\\p{M}\\p{N}_])`
      : group;
  return { source, flags: [...flags].sort().join('') };
}
