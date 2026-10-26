// lingua/scripts.js - writing systems of text and identifiers: the script of each letter, mixed-script detection,
// homoglyph skeletons (Latin a and Cyrillic а look the same) and the admission check of user-chosen ids.
//
//   scriptOf(ch) -> 'latin' | 'cyrillic' | 'georgian' | 'greek' | 'armenian' | 'hebrew' | 'arabic' | 'devanagari' |
//                   'han' | 'kana' | 'hangul' | 'other' | null           null: digits, punctuation, spaces, marks
//   scriptsOf(text) -> ['latin', 'cyrillic', …]                           letter scripts in order of appearance
//   mixesScripts(text) -> boolean          more than one letter script (Han with kana or Hangul counts as one)
//   skeleton(text) -> text                 case-folded, look-alike letters and digits mapped to one Latin shape
//   confusable(a, b) -> boolean            different strings with the same skeleton ('chess' / 'сhess')
//   cleanId(raw, { max = 48 }) -> id       lower case, runs of other characters -> '-', trimmed; Unicode kept
//   checkId(raw, { min = 2, max = 48, reserved = [] }) -> { id, reason }
//       reason: '' (accepted) | 'empty' | 'no-letters' | 'too-short' | 'reserved' | 'mixed-scripts'
//
// Why ids must not mix scripts: two people typing one name must meet, and 'chess' with a Cyrillic с is a different
// string that no screen shows as different. One script per id (digits and '-' belong to none) is the cheap cure; it
// applies to every script alike, because an exception in a protection is a hole. Reserved ids are matched by
// skeleton as well, so a look-alike of a reserved word is reserved too.

// Unicode Script property escapes (ES2018 'u' flag) instead of code point ranges: the property tracks new blocks
// (Georgian Mtavruli, CJK extensions) without code changes. A linear scan of 11 regexes per character is fine for
// ids and short text.
const SCRIPTS = [
  ['latin', /\p{Script=Latin}/u], ['cyrillic', /\p{Script=Cyrillic}/u], ['georgian', /\p{Script=Georgian}/u],
  ['greek', /\p{Script=Greek}/u], ['armenian', /\p{Script=Armenian}/u], ['hebrew', /\p{Script=Hebrew}/u],
  ['arabic', /\p{Script=Arabic}/u], ['devanagari', /\p{Script=Devanagari}/u], ['han', /\p{Script=Han}/u],
  ['kana', /[\p{Script=Hiragana}\p{Script=Katakana}]/u], ['hangul', /\p{Script=Hangul}/u],
];

// Only letters (\p{L}) have a script here: digits, '-', combining marks and Common / Inherited characters return
// null, so they never count as a second script.
export function scriptOf(ch) {
  if (!/\p{L}/u.test(ch)) return null;
  for (const [id, re] of SCRIPTS) if (re.test(ch)) return id;
  return 'other';
}

export function scriptsOf(text) {
  const out = [];
  for (const ch of String(text)) {
    const s = scriptOf(ch);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

// Scripts that are written together in one language.
const GROUP = { han: 'cjk', kana: 'cjk', hangul: 'cjk' };
export const mixesScripts = (text) => new Set(scriptsOf(text).map((s) => GROUP[s] || s)).size > 1;

// Lower-case look-alikes -> the Latin shape (a subset of Unicode UTS #39 confusables that matters for ids).
// Maps to the Latin shape, so a pure-Latin id is its own skeleton. Digits 0 / 1 and '|' fold too: 'p0p' collides
// with 'pop'.
const LOOK = {
  'а': 'a', 'е': 'e', 'ё': 'ë', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'ѕ': 's', 'і': 'i', 'ї': 'ï', 'ј': 'j',
  'ԁ': 'd', 'ӏ': 'l', 'һ': 'h', 'ԛ': 'q', 'ԝ': 'w', 'ү': 'y', 'ɡ': 'g',
  'α': 'a', 'ο': 'o', 'ν': 'v', 'ρ': 'p', 'ι': 'i', 'κ': 'k', 'υ': 'u', 'χ': 'x', 'γ': 'y', 'ϲ': 'c', 'ϳ': 'j',
  '0': 'o', '1': 'l', '|': 'l',
};

// Order matters: NFKC first folds compatibility forms (fullwidth letters, ligatures) to plain letters; lowercasing
// after it catches capitals NFKC produced; 'rn' -> 'm' after the table so mapped look-alikes merge too; a final NFC
// gives a stable form for comparison.
export function skeleton(text) {
  return String(text).normalize('NFKC').toLowerCase().replace(/./gu, (c) => LOOK[c] ?? c).replace(/rn/g, 'm').normalize('NFC');
}

export const confusable = (a, b) => String(a) !== String(b) && skeleton(a) === skeleton(b);

// Trailing '-' is stripped twice: before the cut and after it, because slice(0, max) can end on a separator.
// KNOWN DEFECT: slice / length count UTF-16 code units, so an id with astral characters (CJK Extension B, etc.) can be
// cut inside a surrogate pair, leaving a lone surrogate. Fix: Array.from(id).slice(0, max).join('').
export function cleanId(raw, { max = 48 } = {}) {
  return String(raw ?? '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');
}

// Fail-fast order: the most informative reason first (an id of symbols is 'no-letters', not 'too-short'). Reserved
// words are compared by skeleton on both sides, so look-alikes of reserved words are refused as well.
export function checkId(raw, { min = 2, max = 48, reserved = [] } = {}) {
  const src = String(raw ?? '').trim();
  if (!src) return { id: '', reason: 'empty' };
  const id = cleanId(src, { max });
  if (!id) return { id: '', reason: 'no-letters' };
  if (id.length < min) return { id: '', reason: 'too-short' };
  if (mixesScripts(id)) return { id: '', reason: 'mixed-scripts' };
  const sk = skeleton(id);
  if (reserved.some((r) => r === id || skeleton(r) === sk)) return { id: '', reason: 'reserved' };
  return { id, reason: '' };
}
