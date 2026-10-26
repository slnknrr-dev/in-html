// regexp/explain.js - a structured, localizable explanation tree of a parsed pattern (node kinds + parameters, no prose).
//
// explain(parsed) → { kind: 'pattern', start, end, params, children } where every node is
//   { kind, start, end, params, children }. Applications render each kind through their own dictionaries.
//
// Why a tree of codes instead of sentences: word order, plural forms and case endings differ per language, so prose
// assembled here would be untranslatable. The tree keeps source ranges so the UI can link each line of the
// explanation to the span it describes. The name tables below are shared with codegen.js and diagram.js.
import { FLAG_NAMES } from './parse.js';

// General_Category values: short alias → long name (lone values may use either).
export const GENERAL_CATEGORY = {
  C: 'Other', Cc: 'Control', Cf: 'Format', Cn: 'Unassigned', Co: 'Private_Use', Cs: 'Surrogate',
  L: 'Letter', LC: 'Cased_Letter', Ll: 'Lowercase_Letter', Lm: 'Modifier_Letter', Lo: 'Other_Letter', Lt: 'Titlecase_Letter', Lu: 'Uppercase_Letter',
  M: 'Mark', Mc: 'Spacing_Mark', Me: 'Enclosing_Mark', Mn: 'Nonspacing_Mark',
  N: 'Number', Nd: 'Decimal_Number', Nl: 'Letter_Number', No: 'Other_Number',
  P: 'Punctuation', Pc: 'Connector_Punctuation', Pd: 'Dash_Punctuation', Pe: 'Close_Punctuation', Pf: 'Final_Punctuation', Pi: 'Initial_Punctuation', Po: 'Other_Punctuation', Ps: 'Open_Punctuation',
  S: 'Symbol', Sc: 'Currency_Symbol', Sk: 'Modifier_Symbol', Sm: 'Math_Symbol', So: 'Other_Symbol',
  Z: 'Separator', Zl: 'Line_Separator', Zp: 'Paragraph_Separator', Zs: 'Space_Separator',
};
// Aliases accepted by engines that are neither the short nor the long GC name.
const GC_EXTRA = { Combining_Mark: 'Mark', cntrl: 'Control', digit: 'Decimal_Number', punct: 'Punctuation' };

// Script values: ISO 15924 code → long name (the common ones; others are shown as written).
export const SCRIPTS = {
  Adlm: 'Adlam', Arab: 'Arabic', Armn: 'Armenian', Beng: 'Bengali', Bopo: 'Bopomofo', Brai: 'Braille', Cher: 'Cherokee', Copt: 'Coptic', Cyrl: 'Cyrillic',
  Deva: 'Devanagari', Ethi: 'Ethiopic', Geor: 'Georgian', Glag: 'Glagolitic', Goth: 'Gothic', Grek: 'Greek', Gujr: 'Gujarati', Guru: 'Gurmukhi', Hang: 'Hangul',
  Hani: 'Han', Hebr: 'Hebrew', Hira: 'Hiragana', Kana: 'Katakana', Khmr: 'Khmer', Knda: 'Kannada', Laoo: 'Lao', Latn: 'Latin', Mlym: 'Malayalam', Mong: 'Mongolian',
  Mymr: 'Myanmar', Ogam: 'Ogham', Orya: 'Oriya', Runr: 'Runic', Sinh: 'Sinhala', Syrc: 'Syriac', Taml: 'Tamil', Telu: 'Telugu', Thaa: 'Thaana', Thai: 'Thai',
  Tibt: 'Tibetan', Tfng: 'Tifinagh', Vaii: 'Vai', Yiii: 'Yi', Zinh: 'Inherited', Zyyy: 'Common', Zzzz: 'Unknown',
};
const SCRIPT_KEYS = { sc: 'Script', Script: 'Script', scx: 'Script_Extensions', Script_Extensions: 'Script_Extensions', gc: 'General_Category', General_Category: 'General_Category' };

// Well-known invisible or confusable characters: code point → name key.
const CHAR_NAMES = {
  0: 'nul', 8: 'backspace', 9: 'tab', 10: 'lf', 11: 'vt', 12: 'ff', 13: 'cr', 27: 'esc', 32: 'space', 0xa0: 'nbsp', 0xad: 'shy',
  0x200b: 'zwsp', 0x200c: 'zwnj', 0x200d: 'zwj', 0x2028: 'ls', 0x2029: 'ps', 0xfeff: 'bom',
};

/** U+0041 style code. */
export const codeLabel = (cp) => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');

/** A printable form of a character for explanations and diagrams: the character itself or an escape. */
// Invisible and confusable code points (controls, C1, surrogates, U+2000-200F spaces / joiners / marks, line
// separators, BOM, soft hyphen) are shown as escapes: rendering them raw would look like nothing or like a space.
export function charDisplay(cp) {
  const esc = { 0: '\\0', 8: '\\b', 9: '\\t', 10: '\\n', 11: '\\v', 12: '\\f', 13: '\\r' }[cp];
  if (esc) return esc;
  if (cp < 0x20 || cp === 0x7f) return '\\x' + cp.toString(16).toUpperCase().padStart(2, '0');
  if ((cp >= 0xd800 && cp <= 0xdfff) || (cp >= 0x80 && cp <= 0x9f) || (cp >= 0x2000 && cp <= 0x200f) || cp === 0x2028 || cp === 0x2029 || cp === 0xfeff || cp === 0xad) {
    return cp > 0xffff ? '\\u{' + cp.toString(16).toUpperCase() + '}' : '\\u' + cp.toString(16).toUpperCase().padStart(4, '0');
  }
  if (cp === 0x20) return '␠';
  return String.fromCodePoint(cp);
}

/** Quantifier shape: 'opt' (?), 'star' (*), 'plus' (+), 'exact' ({n}), 'atLeast' ({n,}), 'between' ({n,m}). */
export function quantifierForm(min, max) {
  if (min === 0 && max === 1) return 'opt';
  if (min === 0 && max === Infinity) return 'star';
  if (min === 1 && max === Infinity) return 'plus';
  if (min === max) return 'exact';
  if (max === Infinity) return 'atLeast';
  return 'between';
}

/** Long names of a property escape: { keyLong, valueLong }. */
// A lone \p{X} is either a General_Category value or a binary property (spec: LoneUnicodePropertyNameOrValue);
// it is GC only when X is a known GC alias, otherwise binary. binary is consumed by codegen to pick the syntax.
export function propertyNames(key, value) {
  if (!key) {
    const gc = GENERAL_CATEGORY[value] || GC_EXTRA[value] || (Object.values(GENERAL_CATEGORY).includes(value) ? value : null);
    if (gc) return { keyLong: 'General_Category', valueLong: gc, binary: false };
    return { keyLong: null, valueLong: value, binary: true };
  }
  const keyLong = SCRIPT_KEYS[key] || key;
  if (keyLong === 'General_Category') return { keyLong, valueLong: GENERAL_CATEGORY[value] || GC_EXTRA[value] || value, binary: false };
  return { keyLong, valueLong: SCRIPTS[value] || value, binary: false };
}

/** Flags as a list: [{ flag: 'g', name: 'global' }]. */
export function flagList(flags) {
  return [...String(flags?.raw ?? flags ?? '')].filter((c) => FLAG_NAMES[c]).map((c) => ({ flag: c, name: FLAG_NAMES[c] }));
}

const node = (kind, n, params = {}, children = []) => ({ kind, start: n.start, end: n.end, params, children });

function charParams(c) {
  return { char: charDisplay(c.value), cp: c.value, code: codeLabel(c.value), escape: c.escape, name: CHAR_NAMES[c.value] || null };
}

/**
 * Explanation tree of a parse result (parseRegExp). Node kinds and params:
 *   pattern { flags }            alternation { count }        alternative { index, empty }
 *   literal { text, length }     char { char, cp, code, escape, name }
 *   any { dotAll }               set { set: 'digit' | 'space' | 'word', negate }
 *   property { key, value, negate, keyLong, valueLong, binary, strings }
 *   class { negate, op: 'union' | 'intersection' | 'subtraction', empty }
 *   range { from, to, fromCode, toCode }    strings { count }     string { text, empty }
 *   group { index, name }        noncapture {}                modifiers { add, remove }
 *   lookahead { negate }         lookbehind { negate }
 *   start { multiline }          end { multiline }            boundary { negate }
 *   quantifier { min, max, greedy, form }  backref { ref, named, groups }   empty {}
 */
export function explain(parsed) {
  if (!parsed || !parsed.ok) return null;
  const ctx = { flags: parsed.flags };
  const root = node('pattern', parsed.ast, { flags: parsed.flags.raw });
  root.children = alternatives(parsed.ast, ctx);
  if (!root.children.length) root.children = [{ kind: 'empty', start: 0, end: 0, params: {}, children: [] }];
  return root;
}

function alternatives(n, ctx) {
  const alts = n.alternatives;
  if (alts.length === 1) return sequence(alts[0].elements, ctx);
  const start = alts[0].start, end = alts[alts.length - 1].end;
  return [{
    kind: 'alternation', start, end, params: { count: alts.length },
    children: alts.map((a, i) => node('alternative', a, { index: i + 1, empty: !a.elements.length }, sequence(a.elements, ctx))),
  }];
}

// Runs of plain characters become one 'literal' node: "matches the text 'abc'" instead of three char lines. Only
// unescaped / identity-escaped printable characters qualify; \n, \x41 and friends stay separate so their escape is
// explained. A single plain character stays a 'char' node (it carries code point and name).
const plain = (e) => e.type === 'Character' && (e.escape === null || e.escape === 'identity') && e.value >= 0x20 && !(e.value >= 0xd800 && e.value <= 0xdfff);

function sequence(els, ctx) {
  const out = [];
  for (let i = 0; i < els.length; i++) {
    const e = els[i];
    if (plain(e) && i + 1 < els.length && plain(els[i + 1])) {
      let j = i, text = '';
      while (j < els.length && plain(els[j])) text += String.fromCodePoint(els[j++].value);
      out.push({ kind: 'literal', start: e.start, end: els[j - 1].end, params: { text, length: j - i }, children: [] });
      i = j - 1;
    } else out.push(element(e, ctx));
  }
  return out;
}

function element(e, ctx) {
  const f = ctx.flags;
  switch (e.type) {
    case 'Character': return node('char', e, charParams(e));
    case 'CharacterSet':
      if (e.kind === 'any') return node('any', e, { dotAll: !!f.dotAll });
      if (e.kind === 'property') return node('property', e, { key: e.key, value: e.value, negate: e.negate, strings: !!e.strings, ...propertyNames(e.key, e.value) });
      return node('set', e, { set: e.kind, negate: e.negate });
    case 'CharacterClass':
      return node('class', e, { negate: e.negate, op: e.kind, empty: !e.elements.length }, e.elements.map((x) => element(x, ctx)));
    case 'ClassRange':
      return node('range', e, { from: charDisplay(e.min.value), to: charDisplay(e.max.value), fromCode: codeLabel(e.min.value), toCode: codeLabel(e.max.value) });
    case 'ClassStringDisjunction':
      return node('strings', e, { count: e.alternatives.length }, e.alternatives.map((a) => node('string', a, {
        text: a.elements.map((c) => charDisplay(c.value)).join(''), empty: !a.elements.length,
      })));
    case 'CapturingGroup': return node('group', e, { index: e.index, name: e.name }, alternatives(e, ctx));
    case 'Group':
      if (e.modifiers) return node('modifiers', e, { add: e.modifiers.add, remove: e.modifiers.remove }, alternatives(e, ctx));
      return node('noncapture', e, {}, alternatives(e, ctx));
    case 'Lookaround': return node(e.kind, e, { negate: e.negate }, alternatives(e, ctx));
    case 'Assertion':
      if (e.kind === 'word') return node('boundary', e, { negate: e.negate });
      return node(e.kind, e, { multiline: !!f.multiline });
    case 'Quantifier':
      return node('quantifier', e, { min: e.min, max: e.max, greedy: e.greedy, form: quantifierForm(e.min, e.max) }, [element(e.element, ctx)]);
    case 'Backreference': return node('backref', e, { ref: e.ref, named: e.named, groups: e.groups.slice() });
    default: return node('empty', e);
  }
}

/** The deepest explanation nodes containing an offset (outermost first). */
// Half-open [start, end): an offset at a node's end belongs to the next node, matching caret semantics.
export function explainPath(tree, offset) {
  const out = [];
  let cur = tree;
  while (cur) {
    out.push(cur);
    cur = cur.children.find((c) => c.start <= offset && offset < c.end) || null;
  }
  return out;
}
