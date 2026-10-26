// regexp-app/describe.js - turns the structured output of the regexp/ library (errors, warnings, explanation nodes,
// flavour notes, diagram captions) into text of the current UI language.
// 
// Why a separate layer: regexp/ is UI-free and language-free (codes + params), so it can run in a Worker, in tests and
// in other apps. All i18n key construction lives here; renaming a key means touching one module. Every function reads
// the language at call time through t(), so a language switch only needs a re-render.
import { t } from '../ui/app.js';

// Unicode property names use underscores (Decimal_Number); shown with spaces for reading.
const human = (s) => String(s || '').replace(/_/g, ' ');

export function errorText(err) {
  if (!err) return '';
  const p = err.params || {};
  return t('rx.err.' + err.code, { flag: p.flag ?? '', name: p.name ?? '', n: p.n ?? '' });
}

// unknownEscape has a variant key with a hint ("did you mean …") when the linter found a likely intended escape.
export function lintText(w) {
  const p = w.params || {};
  return t('rx.lint.' + w.code + (w.code === 'unknownEscape' && p.hint ? 'Hint' : ''), p);
}

export function noteText(n) { return t('rx.note.' + n.code, n.params || {}); }

export function flagName(c) { return t('rx.flag.' + c); }

// General_Category values are shown bare (Letter (L)); other properties as "Script = Greek". The short alias is appended only when it differs.
function propText(p) {
  const value = human(p.valueLong);
  if (!p.keyLong || p.keyLong === 'General_Category') return value + (p.value !== p.valueLong ? ' (' + p.value + ')' : '');
  return human(p.keyLong) + ' = ' + value;
}

/** One line describing an explanation node (regexp/explain.js). */
// One switch over every explanation node kind. Key names are built from params (negate, multiline, greedy) instead
// of separate node kinds, which keeps regexp/explain.js small. Unknown kinds fall to 'rx.ex.empty' rather than throw.
export function explainText(node) {
  const p = node.params || {};
  switch (node.kind) {
    case 'alternation': return t('rx.ex.alternation', { n: p.count });
    case 'alternative': return t(p.empty ? 'rx.ex.alternativeEmpty' : 'rx.ex.alternative', { n: p.index });
    case 'literal': return t('rx.ex.literal', { text: p.text });
    case 'char':
      if (p.name) return t('rx.ex.charNamed', { name: t('rx.ch.' + p.name), code: p.code });
      if (p.char.startsWith('\\') && p.char.length > 1) return t('rx.ex.charCode', { code: p.code });
      return t('rx.ex.char', { char: p.char, code: p.code });
    case 'any': return t(p.dotAll ? 'rx.ex.anyAll' : 'rx.ex.any');
    // Negated sets build a camel-cased key: d -> notD style ('not' + capitalised set name).
    case 'set': return t('rx.ex.set.' + (p.negate ? 'not' + p.set[0].toUpperCase() + p.set.slice(1) : p.set));
    case 'property': return t(p.strings ? 'rx.ex.propertyStrings' : p.negate ? 'rx.ex.notProperty' : 'rx.ex.property', { prop: propText(p) });
    case 'class':
      if (p.empty) return t(p.negate ? 'rx.ex.classAny' : 'rx.ex.classEmpty');
      if (p.op === 'intersection') return t(p.negate ? 'rx.ex.classNotAnd' : 'rx.ex.classAnd');
      if (p.op === 'subtraction') return t(p.negate ? 'rx.ex.classNotMinus' : 'rx.ex.classMinus');
      return t(p.negate ? 'rx.ex.classNeg' : 'rx.ex.class');
    case 'range': return t('rx.ex.range', { from: p.from, to: p.to });
    case 'strings': return t('rx.ex.strings', { n: p.count });
    case 'string': return p.empty ? t('rx.ex.stringEmpty') : t('rx.ex.string', { text: p.text });
    case 'group': return p.name ? t('rx.ex.groupNamed', { n: p.index, name: p.name }) : t('rx.ex.group', { n: p.index });
    case 'noncapture': return t('rx.ex.noncapture');
    case 'modifiers': {
      const parts = [];
      if (p.add) parts.push(t('rx.ex.modOn', { flags: [...p.add].map((c) => c + ' (' + flagName(c) + ')').join(', ') }));
      if (p.remove) parts.push(t('rx.ex.modOff', { flags: [...p.remove].map((c) => c + ' (' + flagName(c) + ')').join(', ') }));
      return t('rx.ex.modifiers', { list: parts.join('; ') });
    }
    case 'lookahead': return t(p.negate ? 'rx.ex.negLookahead' : 'rx.ex.lookahead');
    case 'lookbehind': return t(p.negate ? 'rx.ex.negLookbehind' : 'rx.ex.lookbehind');
    case 'start': return t(p.multiline ? 'rx.ex.startLine' : 'rx.ex.start');
    case 'end': return t(p.multiline ? 'rx.ex.endLine' : 'rx.ex.end');
    case 'boundary': return t(p.negate ? 'rx.ex.notBoundary' : 'rx.ex.boundary');
    case 'quantifier': return t('rx.ex.q.' + p.form, { min: p.min, max: p.max, n: p.min }) + ' · ' + t(p.greedy ? 'rx.ex.greedy' : 'rx.ex.lazy');
    case 'backref': return p.named ? t('rx.ex.backrefNamed', { name: p.ref }) : t('rx.ex.backref', { n: p.ref });
    default: return t('rx.ex.empty');
  }
}

// Captions of the railroad diagram (regexp/diagram.js label keys).
// Whitelist of diagram caption keys: diagramLabel returns null for anything else, and the diagram falls back to its own text instead of showing a raw missing-key string.
const DIAGRAM_KEYS = new Set(['title', 'start', 'end', 'any', 'anyNl', 'digit', 'notDigit', 'word', 'notWord', 'space', 'notSpace', 'property', 'notProperty',
  'oneOf', 'noneOf', 'intersection', 'subtraction', 'group', 'namedGroup', 'modifiers', 'lookahead', 'negLookahead', 'lookbehind', 'negLookbehind',
  'lineStart', 'inputStart', 'lineEnd', 'inputEnd', 'wordBoundary', 'notWordBoundary', 'backref', 'lazy', 'empty', 'strings']);
export function diagramLabel(key, params) {
  if (!DIAGRAM_KEYS.has(key)) return null;
  return t('rx.dg.' + key, params);
}
