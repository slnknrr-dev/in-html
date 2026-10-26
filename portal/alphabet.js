// portal/alphabet.js - alphabet indexes per script and language (pure): the letters of the Georgian (Mkhedruli),
// Russian, Ukrainian and Latin alphabets in dictionary order, the index letter of a word, and A–Z groups of entries
// for glossaries and directories. A glossary written in one language may contain words of another script (Latin
// abbreviations in a Georgian glossary): their letters follow the primary alphabet, digits and symbols come last.
//
//   alphabetOf(lang) -> ['ა', 'ბ', …]      script of the language's alphabet: scriptOf(letter)
//   letterOf(word, lang) -> { key, script } key: an index letter, '0–9' or '#'
//   alphaIndex(entries, { lang, text: (e) => string, full: true }) ->
//     { letters: [{ key, id, script, n }], groups: [{ key, id, script, items }] }
//     letters: the whole primary alphabet (n = 0 for letters without entries when `full`), then the letters of other
//     scripts that have entries, then '0–9' and '#'; groups: only non-empty groups in the same order, entries sorted
//     with Intl.Collator(lang). ids are ASCII ('ka-1', 'cyrl-12', 'latn-a', 'num', 'other') for anchors.
import { fold } from './text.js';

// Dictionary order is not code-point order (Ukrainian Ґ sits after Г, Spanish Ñ after N), so the letter lists are
// explicit data; [...s] splits by code point, safe because every letter here is a single code point.
export const ALPHABETS = {
  ka: [...'აბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰ'],
  ru: [...'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЭЮЯ'],
  uk: [...'АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЮЯ'],
  latn: [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
  es: [...'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ'],
};

const SCRIPT_OF_LANG = { ka: 'ka', ru: 'cyrl', uk: 'cyrl', be: 'cyrl', bg: 'cyrl', sr: 'cyrl', mk: 'cyrl', kk: 'cyrl' };

const primaryOf = (lang) => String(lang || 'en').toLowerCase().split('-')[0];

export function alphabetOf(lang) {
  const p = primaryOf(lang);
  if (p === 'ka') return ALPHABETS.ka;
  if (p === 'uk') return ALPHABETS.uk;
  if (SCRIPT_OF_LANG[p] === 'cyrl') return ALPHABETS.ru;
  if (p === 'es') return ALPHABETS.es;
  return ALPHABETS.latn;
}

// Unicode script properties (\p{Script=...}) instead of code ranges: no table to maintain, and Mtavruli / extended blocks are covered.
export function scriptOf(ch) {
  if (!ch) return 'other';
  if (/[Ⴀ-ჿᲐ-Ჿⴀ-⴯]/.test(ch)) return 'ka';
  if (/\p{Script=Cyrillic}/u.test(ch)) return 'cyrl';
  if (/\p{Script=Latin}/u.test(ch)) return 'latn';
  if (/\p{N}/u.test(ch)) return 'num';
  return 'other';
}

const SCRIPT_ORDER = ['ka', 'cyrl', 'latn'];

// The alphabet used for letters of a script when the language's own alphabet is of another script.
function defaultAlphabet(script, lang) {
  const p = primaryOf(lang);
  if (script === 'ka') return ALPHABETS.ka;
  if (script === 'cyrl') return p === 'uk' ? ALPHABETS.uk : ALPHABETS.ru;
  return p === 'es' ? ALPHABETS.es : ALPHABETS.latn;
}

// Mtavruli capitals (U+1C90..) are the Mkhedruli letters (U+10D0..) in upper case.
// Mtavruli and Mkhedruli are parallel blocks with identical letter order, so a constant offset converts between them.
const mkhedruli = (ch) => {
  const c = ch.codePointAt(0);
  return c >= 0x1C90 && c <= 0x1CBF ? String.fromCodePoint(c - 0x1C90 + 0x10D0) : ch;
};

// First letter / digit decides the bucket. Ё files under Е (Russian dictionary convention). Diacritics fold to the
// base letter only when the accented form is not a letter of its own in this alphabet (Ukrainian Ї / Й, Spanish Ñ
// are found by the exact lookup first, so fold() never reaches them).
export function letterOf(word, lang) {
  const s = String(word || '').trim();
  const m = /[\p{L}\p{N}]/u.exec(s);
  if (!m) return { key: '#', script: 'other' };
  const ch = mkhedruli(m[0]);
  const script = scriptOf(ch);
  if (script === 'num') return { key: '0–9', script: 'num' };
  if (script === 'other') return { key: '#', script: 'other' };
  const alpha = SCRIPT_OF(lang) === script ? alphabetOf(lang) : defaultAlphabet(script, lang);
  if (script === 'ka') return alpha.includes(ch) ? { key: ch, script } : { key: '#', script: 'other' };
  let up = ch.toLocaleUpperCase(primaryOf(lang));
  if (up === 'Ё') up = 'Е';
  if (alpha.includes(up)) return { key: up, script };
  // Letters with diacritics file under their base letter (Ä → A, É → E; Ukrainian Ї / Й are letters of their own).
  const base = fold(ch).toLocaleUpperCase(primaryOf(lang));
  if (alpha.includes(base[0])) return { key: base[0], script };
  return { key: '#', script: 'other' };
}
function SCRIPT_OF(lang) {
  const p = primaryOf(lang);
  return SCRIPT_OF_LANG[p] || 'latn';
}

// Anchor ids must be ASCII (copy / paste and every host): Latin letters keep their name, other scripts use the 1-based position.
function letterId(key, script, alpha) {
  if (key === '0–9') return 'num';
  if (key === '#') return 'other';
  const i = alpha.indexOf(key);
  return script === 'latn' ? 'latn-' + (key === 'Ñ' ? 'n2' : key.toLowerCase()) : script + '-' + (i + 1);
}

// numeric: "Article 2" < "Article 10"; sensitivity base: case and accents do not split equal words. Fallback for engines without Intl.
export function collator(lang) {
  try { return new Intl.Collator(lang || 'en', { sensitivity: 'base', numeric: true }).compare; } catch { return (a, b) => (a < b ? -1 : a > b ? 1 : 0); }
}

// Buckets keyed script + NUL + letter (NUL cannot occur in either part). Order: full primary alphabet (empty letters
// shown disabled so the bar has a stable shape), then other scripts' letters that occur, then digits, then other.
export function alphaIndex(entries, { lang = 'en', text = (e) => String(e), full = true } = {}) {
  const primary = SCRIPT_OF(lang);
  const cmp = collator(lang);
  const buckets = new Map();
  for (const e of entries || []) {
    const t = String(text(e) || '');
    const { key, script } = letterOf(t, lang);
    const k = script + '\u0000' + key;
    if (!buckets.has(k)) buckets.set(k, { key, script, items: [] });
    buckets.get(k).items.push(e);
  }
  const letters = [];
  const seen = new Set();
  const push = (key, script, alpha) => {
    const k = script + '\u0000' + key;
    if (seen.has(k)) return;
    seen.add(k);
    const b = buckets.get(k);
    letters.push({ key, script, id: letterId(key, script, alpha), n: b ? b.items.length : 0 });
  };
  const pa = alphabetOf(lang);
  if (full) for (const ch of pa) push(ch, primary, pa);
  for (const script of [primary, ...SCRIPT_ORDER.filter((x) => x !== primary)]) {
    const alpha = script === primary ? pa : defaultAlphabet(script, lang);
    for (const ch of alpha) if (buckets.has(script + '\u0000' + ch)) push(ch, script, alpha);
  }
  if (buckets.has('num\u00000–9')) push('0–9', 'num', []);
  if (buckets.has('other\u0000#')) push('#', 'other', []);
  const groups = letters.filter((l) => l.n).map((l) => {
    const b = buckets.get(l.script + '\u0000' + l.key);
    return { key: l.key, id: l.id, script: l.script, items: b.items.slice().sort((x, y) => cmp(String(text(x) || ''), String(text(y) || ''))) };
  });
  return { letters, groups };
}
