// portal/text.js - text primitives of the portal library (pure, Node and browsers): folding for search and matching
// (the runtime's R.pt.fold is the same algorithm, checked by test.js), words, query terms, inflection-tolerant word
// comparison (Georgian, Cyrillic and Latin endings), highlighted snippets, excerpts and stable ids.
//
//   fold(s)                       NFKD, combining marks removed, lower case, ё → е, ß → ss, whitespace collapsed
//   words(s) -> [folded word]     letters / digits of any script (apostrophes and hyphens inside words kept)
//   terms(q) -> [unique folded word]
//   stemEq(a, b)                  two folded words are forms of one word (heuristic, see README)
//   highlight(text, terms, { max }) -> safe HTML: an excerpt around the first match with <mark> around matches
//   excerpt(text, n) -> plain text cut at a word boundary with '…'
//   slugId(s, fallback) -> ASCII id ('a12-1', 'vat'); Georgian / Cyrillic are transliterated
//   splitList(s) -> ['a', 'b']   comma / semicolon / line separated values, trimmed, unique
import { escapeHTML } from '../html/escape.js';

// Combining mark blocks (diacritics, extended, supplement, symbols, half marks). After NFKD, removing them turns "é" into
// "e" and "й" into "и"; that loss is intended for search (accent-insensitive). The runtime copies this class verbatim
// (runtime.js ptBase / ptFind), and a test compares both foldings.
const MARKS = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/g;

// NFKD (compatibility) also folds ligatures and full-width forms ("ﬁ" -> "fi"). try/catch: engines without normalize still fold case.
export function fold(s) {
  let t = String(s == null ? '' : s);
  try { t = t.normalize('NFKD'); } catch { /* old engines */ }
  return t.replace(MARKS, '').toLowerCase().replace(/ё/g, 'е').replace(/ß/g, 'ss').replace(/\s+/g, ' ').trim();
}

// A word starts with a letter or digit and may contain marks, apostrophes and hyphens inside ("don't", "მე-12").
export const WORD_RE = /[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu;

export function words(s) {
  return (fold(s).match(WORD_RE) || []).map((w) => w.replace(/['’-]+$/g, '')).filter(Boolean);
}

export function terms(q) {
  return [...new Set(words(q))];
}

// Inflectional endings dropped from the shorter word before comparing: Cyrillic and Georgian vowels (and й / ь) up to
// two letters, a final Latin 'e' or plural 's'.
const CYR_KA_END = /[аеёиоуыэюяіїєйьიაეოუ]{1,2}$/;
const PLURAL_TAIL = new Set(['', 's', 'es']);

// Stem used for comparisons: words of five letters or more lose their inflectional ending.
// Light stemming, deliberately crude: drop a 1-2 vowel ending (Cyrillic / Georgian case endings) or an English
// plural / final e, but never below a 4-letter stem. A real morphological analyser would be language-specific and
// heavy; for linking glossary terms a false positive costs one wrong link, a false negative one missing link.
export function stemOf(w) {
  const s = String(w || '');
  if (s.length < 5) return s;
  if (CYR_KA_END.test(s)) return s.replace(CYR_KA_END, '').length >= 4 ? s.replace(CYR_KA_END, '') : s.slice(0, -1);
  return s.replace(/(?:es|s|e)$/, '');
}

// Folded words a and b are forms of the same word: equal, or the stem of the shorter one is a prefix of the longer
// one and the longer one only adds an ending of at most five letters (seven after a long stem). Words of three or four
// letters must be a whole prefix, three-letter words only take English plural endings.
export function stemEq(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const short = a.length <= b.length ? a : b;
  const l = short === a ? b : a;
  if (short.length < 3) return false;
  if (short.length < 4) return l.startsWith(short) && PLURAL_TAIL.has(l.slice(short.length));
  const s = stemOf(short);
  if (!l.startsWith(s)) return false;
  return l.length - s.length <= (s.length >= 6 ? 7 : 5);
}

// Folded text with a map back to offsets of the original string (snippets mark the original characters).
// Per code point fold with an index map back to the original string, so marks can be placed on the ORIGINAL text
// even when folding changes lengths (ß -> ss, NFKD expansions).
export function foldMap(s) {
  const src = String(s == null ? '' : s);
  let out = '';
  const map = [];
  for (let i = 0; i < src.length;) {
    const cp = src.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    let f = ch;
    try { f = ch.normalize('NFKD'); } catch { /* old engines */ }
    f = f.replace(MARKS, '').toLowerCase().replace(/ё/g, 'е').replace(/ß/g, 'ss');
    for (let k = 0; k < f.length; k++) map.push(i);
    out += f;
    i += ch.length;
  }
  map.push(src.length);
  return { text: out, map };
}

// Safe HTML of an excerpt of `text` (max characters) around the first match, every match of `ts` (folded terms) in
// <mark>. A term matches the start of a word or, for scripts without spaces, anywhere.
// Excerpt window: start ~50 folded chars before the first match, snapped to a word boundary; marks are collected on
// the excerpt (max 60) and overlapping marks skipped. All text goes through escapeHTML; only <mark> is emitted.
export function highlight(text, ts, { max = 220 } = {}) {
  const s = String(text == null ? '' : s0(text));
  if (!s) return '';
  const list = (ts || []).filter(Boolean);
  const full = foldMap(s);
  let first = -1;
  for (const t of list) {
    const i = full.text.indexOf(t);
    if (i >= 0 && (first < 0 || i < first)) first = i;
  }
  let start = 0;
  if (first > 60 && s.length > max) start = full.map[first - 50] || 0;
  let end = Math.min(s.length, start + max);
  if (start > 0) { const sp = s.indexOf(' ', start); if (sp > 0 && sp - start < 20) start = sp + 1; }
  if (end < s.length) { const sp = s.lastIndexOf(' ', end); if (sp > start + max / 2) end = sp; }
  const part = s.slice(start, end);
  const pf = foldMap(part);
  const marks = [];
  for (const t of list) {
    let i = pf.text.indexOf(t);
    while (i >= 0 && marks.length < 60) {
      marks.push([pf.map[i], pf.map[i + t.length]]);
      i = pf.text.indexOf(t, i + t.length);
    }
  }
  marks.sort((x, y) => x[0] - y[0]);
  let html = '';
  let pos = 0;
  for (const [x, y] of marks) {
    if (x < pos) continue;
    html += escapeHTML(part.slice(pos, x)) + '<mark>' + escapeHTML(part.slice(x, y)) + '</mark>';
    pos = y;
  }
  html += escapeHTML(part.slice(pos));
  return (start > 0 ? '… ' : '') + html + (end < s.length ? ' …' : '');
}
const s0 = (v) => (typeof v === 'string' ? v : String(v));

export function excerpt(text, n = 160) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:.\s]+$/, '') + '…';
}

// Transliteration for ids (anchors stay ASCII so links survive every host and copy / paste).
// Transliteration table for anchor ids only (not a linguistic romanization standard): stable and readable is enough.
const TR = {
  а: 'a', б: 'b', в: 'v', г: 'g', ґ: 'g', д: 'd', е: 'e', є: 'ye', ж: 'zh', з: 'z', и: 'i', і: 'i', ї: 'yi', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ა: 'a', ბ: 'b', გ: 'g', დ: 'd', ე: 'e', ვ: 'v', ზ: 'z', თ: 't', ი: 'i', კ: 'k', ლ: 'l', მ: 'm', ნ: 'n', ო: 'o', პ: 'p', ჟ: 'zh', რ: 'r', ს: 's',
  ტ: 't', უ: 'u', ფ: 'p', ქ: 'k', ღ: 'gh', ყ: 'q', შ: 'sh', ჩ: 'ch', ც: 'ts', ძ: 'dz', წ: 'ts', ჭ: 'ch', ხ: 'kh', ჯ: 'j', ჰ: 'h',
};

// Capped at 48 chars and trimmed of dashes again after the cut, so ids never end in "-".
export function slugId(s, fallback = 'x') {
  const f = fold(s);
  let out = '';
  for (const ch of f) out += Object.prototype.hasOwnProperty.call(TR, ch) ? TR[ch] : ch;
  out = out.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/g, '');
  return out || fallback;
}

export function splitList(s) {
  const out = [];
  const seen = new Set();
  for (const x of String(s == null ? '' : s).split(/[,;\n]+/)) {
    const v = x.trim();
    const k = fold(v);
    if (v && !seen.has(k)) { seen.add(k); out.push(v); }
  }
  return out;
}
