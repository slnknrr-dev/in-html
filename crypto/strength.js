// crypto/strength.js - password strength estimation in the manner of zxcvbn (Dropbox's estimator; its C port
// zxcvbn-c gives KeePassXC the "Entropy: N bit" and the password quality of its generator, entry editor and health
// check). The password is decomposed into the sequence of matches that needs the fewest guesses: dictionary words
// (ranked frequency lists, case-insensitive), reversed words, l33t substitutions, words typed in the other keyboard
// layout (Russian <-> Latin), keyboard patterns (QWERTY, QWERTZ, AZERTY, Dvorak, Russian JCUKEN, keypads; turns and
// shifts), repeats, sequences (Latin, digits, Cyrillic, Greek), years, dates, and brute force over the character
// classes of the password (as zxcvbn-c). Entropy = log2(guesses).
//
//   passwordStrength(password, { userInputs = [], maxLength = 128 }) -> {
//     length, pieces (inputs longer than maxLength are analysed in pieces whose bits add up),
//     entropy (bits = log2 guesses), guesses, guessesLog10, score (0..4, zxcvbn),
//     quality ('bad' | 'poor' | 'weak' | 'good' | 'excellent', KeePassXC), charset: { pool, bits, classes },
//     sequence: [match], crackTimes: { onlineThrottled, onlineUnthrottled, offlineSlow, offlineFast } (seconds),
//     feedback: { warning: code | '', suggestions: [code] } }
//   quality(bits)               KeePassXC's PasswordHealth thresholds: <= 0 bad, < 40 poor, < 75 weak, < 100 good
//   charsetEntropy(password)    naive estimate: length x log2(pool of the character classes used)
//   omnimatch(password, opts)   every match found (before choosing the cheapest decomposition)
//   FEEDBACK                    English texts of the feedback codes; SCENARIOS guesses per second of the attacks
//   dictionaryInfo()            { passwords, english, names, surnames, russian } list sizes
//
// A match is { pattern, i, j, token, guesses, log2 } with i..j in characters (code points) plus, per pattern:
//   dictionary  dictionary, word, rank, reversed, l33t, sub ({ l33t char: letter }), layout ('ru': a Russian word
//               typed in the Latin layout, 'en': a Latin word typed in the Russian layout), translit (Cyrillic word
//               of a transliteration), uppercaseVariations, l33tVariations
//   spatial     graph, turns, shifted          repeat    base, baseLog2, count, baseMatches
//   sequence    name, space, ascending         regex     name ('recent_year')
//   date        separator, year, month, day    bruteforce  cardinality
// The dictionaries (crypto/strength-data.js) are decoded on first use.
//
// Not a cryptographic primitive: an attacker model. The estimate is an upper bound on the attacker's work only for
// the patterns modelled here; any pattern it misses (a quote, a phone number) makes it optimistic. All arithmetic
// is in log2 to survive 10^100-guess passwords without Infinity. Long inputs are cut into maxLength pieces
// (see passwordStrength) because the search is super-linear.

import { inflateRawSync } from '../codec/zlib.js';
import { base64ToBytes } from './encoding.js';
import { WORD_LISTS } from './strength-data.js';

const LOG2_10 = Math.log2(10);
const LOG2_1E4 = Math.log2(1e4);
const MIN_GUESSES_BEFORE_GROWING_SEQUENCE = 1e4;
const MIN_SUBMATCH_GUESSES_SINGLE_CHAR = 10;
const MIN_SUBMATCH_GUESSES_MULTI_CHAR = 50;
const MIN_YEAR_SPACE = 20;
// Read at module load: year guesses are scored by distance from "now", so results drift by a few bits per decade.
const REFERENCE_YEAR = new Date().getFullYear();
const DATE_MIN_YEAR = 1000;
const DATE_MAX_YEAR = 2050;
const MIN_WORD = 3; // shorter dictionary words are noise (the lists hold none)

export const DICTIONARIES = ['passwords', 'english', 'names', 'surnames', 'russian', 'user'];

// --- small maths ----------------------------------------------------------------------------------------------

// Binomial coefficient in doubles, multiplying and dividing alternately so intermediates stay near the result
// (exact for the small n here; approximate but finite for large ones - only its log2 is used).
function nCk(n, k) {
  if (k > n) return 0;
  if (k === 0) return 1;
  let r = 1;
  for (let d = 1; d <= k; d++) { r *= n; r /= d; n--; }
  return r;
}
// log2(2^a + 2^b), factoring out the larger term so 2^(small - large) <= 1 never overflows.
const log2add = (a, b) => (a < b ? b + Math.log2(1 + 2 ** (a - b)) : a + Math.log2(1 + 2 ** (b - a)));
const LFACT = [0];
const lfact = (n) => { while (LFACT.length <= n) LFACT.push(LFACT[LFACT.length - 1] + Math.log2(LFACT.length)); return LFACT[n]; };

// --- KeePassXC quality and the naive character-pool estimate ----------------------------------------------------

// KeePassXC (src/core/PasswordHealth.cpp, PasswordHealth::quality) on the zxcvbn entropy in bits.
export const quality = (bits) => (bits <= 0 ? 'bad' : bits < 40 ? 'poor' : bits < 75 ? 'weak' : bits < 100 ? 'good' : 'excellent');
export const QUALITY_THRESHOLDS = { poor: 0, weak: 40, good: 75, excellent: 100 };

// Character classes of the brute-force cardinality (zxcvbn-c counts lower 26, upper 26, digits 10, ASCII symbols
// 33 and 100 for anything else; Latin-1, Cyrillic and Greek get their own sizes here).
const POOLS = [
  ['lower', /[a-z]/, 26], ['upper', /[A-Z]/, 26], ['digits', /[0-9]/, 10], ['symbols', /[\x20-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/, 33],
  ['latin1', /[ -ÿ]/, 96], ['cyrillicLower', /[а-яё]/, 33], ['cyrillicUpper', /[А-ЯЁ]/, 33],
  ['greekLower', /[α-ω]/, 25], ['greekUpper', /[Α-Ω]/, 24],
];
function cardinality(chars) {
  const seen = new Set();
  let other = false;
  for (const c of chars) {
    const p = POOLS.find(([, rx]) => rx.test(c));
    if (p) seen.add(p); else other = true;
  }
  const classes = [...seen].map(([name]) => name);
  let pool = [...seen].reduce((s, p) => s + p[2], 0);
  if (other) { classes.push('other'); pool += 100; }
  return { pool, classes };
}

export function charsetEntropy(password) {
  const chars = Array.from(String(password ?? ''));
  const { pool, classes } = cardinality(chars);
  return { pool, classes, length: chars.length, bits: chars.length ? chars.length * Math.log2(pool) : 0 };
}

// --- dictionaries ---------------------------------------------------------------------------------------------

// Russian transliteration: alternatives per letter, the most usual first.
const TRANSLIT = {
  а: ['a'], б: ['b'], в: ['v'], г: ['g'], д: ['d'], е: ['e'], ё: ['e', 'yo'], ж: ['zh', 'j'], з: ['z'], и: ['i'],
  й: ['y', 'j', 'i'], к: ['k'], л: ['l'], м: ['m'], н: ['n'], о: ['o'], п: ['p'], р: ['r'], с: ['s'], т: ['t'],
  у: ['u'], ф: ['f'], х: ['h', 'kh'], ц: ['c', 'ts'], ч: ['ch'], ш: ['sh'], щ: ['sch', 'shch', 'sh'], ъ: [''], ы: ['y', 'i'],
  ь: [''], э: ['e'], ю: ['yu', 'ju', 'u'], я: ['ya', 'ja', 'ia'],
};
// Latin spellings of a Russian word: the usual one, then up to two other choices (at most 12 spellings). A soft or
// hard sign before a vowel may be written y or i (счастье: schaste, schastye, schastie).
function transliterations(word) {
  const w = [...word];
  const letters = w.map((c, k) => ((c === 'ь' || c === 'ъ') && /[еёиюя]/.test(w[k + 1] || '') ? ['', 'y', 'i'] : TRANSLIT[c] || [c]));
  const out = new Set();
  const walk = (k, acc, alt) => {
    if (out.size >= 12) return;
    if (k === letters.length) { out.add(acc); return; }
    letters[k].forEach((v, n) => { if (n === 0 || alt < 2) walk(k + 1, acc + v, alt + (n ? 1 : 0)); });
  };
  walk(0, '', 0);
  return [...out];
}

let LEX = null;
// words: Map(word -> rank * 16 + translit * 8 + dictionary index); translit: Map(latin spelling -> Russian word).
// One packed integer per entry (not an object) keeps ~22 000 words plus their transliterations small and fast to
// build; the lowest rank across dictionaries wins (`put` refuses a worse rank), matching zxcvbn's frequency logic.
function lexicon() {
  if (LEX) return LEX;
  const words = new Map(), translit = new Map(), sizes = {}, lists = {};
  let maxLen = 0;
  const put = (w, rank, d, flag) => {
    const old = words.get(w);
    if (old !== undefined && Math.floor(old / 16) <= rank) return false;
    words.set(w, rank * 16 + flag * 8 + d);
    if (w.length > maxLen) maxLen = w.length;
    return true;
  };
  const text = new TextDecoder().decode(inflateRawSync(base64ToBytes(WORD_LISTS)));
  for (const section of text.split('\0')) {
    const list = section.split('\n');
    const name = list[0], d = DICTIONARIES.indexOf(name);
    if (d < 0) continue;
    sizes[name] = list.length - 1;
    lists[name] = list.slice(1);
    for (let r = 1; r < list.length; r++) put(list[r], r, d, 0);
    if (name === 'russian') {
      for (let r = 1; r < list.length; r++) {
        const w = list[r];
        if (w.includes('ё')) put(w.replace(/ё/g, 'е'), r, d, 0);
        for (const v of transliterations(w)) if (v.length >= MIN_WORD && put(v, r, d, 1)) translit.set(v, w);
      }
    }
  }
  LEX = { words, translit, sizes, lists, maxLen };
  return LEX;
}

export const dictionaryInfo = () => ({ ...lexicon().sizes });
// The words of a dictionary, most frequent first (a copy).
export const wordList = (name) => (lexicon().lists[name] || []).slice();

// Lower case per character, keeping the length (a few characters change length in toLowerCase).
const lowerChars = (chars) => chars.map((c) => { const l = c.toLowerCase(); return [...l].length === 1 ? l : c; });

// Every substring of length MIN_WORD..maxLen looked up in the Map: O(n * maxLen) lookups, simpler than a trie and
// fast enough for n <= maxLength. User inputs (name, e-mail, site) form a separate, top-ranked dictionary.
function dictionaryMatch(chars, lower, ctx) {
  const { words, maxLen } = lexicon();
  const user = ctx.user;
  const out = [], n = chars.length;
  for (let i = 0; i < n; i++) {
    let w = '';
    for (let j = i; j < n && j - i < maxLen; j++) {
      w += lower[j];
      if (j - i + 1 < MIN_WORD) continue;
      const v = words.get(w);
      const u = user && user.get(w);
      if (v === undefined && !u) continue;
      const rank = v === undefined ? Infinity : Math.floor(v / 16);
      const m = { pattern: 'dictionary', i, j, token: chars.slice(i, j + 1).join(''), word: w, reversed: false, l33t: false };
      if (u && u <= rank) Object.assign(m, { dictionary: 'user', rank: u });
      else {
        Object.assign(m, { dictionary: DICTIONARIES[v & 7], rank });
        if (v & 8) m.translit = LEX.translit.get(w);
      }
      out.push(m);
    }
  }
  return out;
}

function reverseDictionaryMatch(chars, lower, ctx) {
  const n = chars.length;
  return dictionaryMatch([...chars].reverse(), [...lower].reverse(), ctx).map((m) => ({
    ...m, token: [...m.token].reverse().join(''), reversed: true, i: n - 1 - m.j, j: n - 1 - m.i,
  }));
}

// zxcvbn's l33t table.
const L33T = { a: '4@', b: '8', c: '({[<', e: '3', g: '69', i: '1!|', l: '1|7', o: '0', s: '$5', t: '+7', x: '%', z: '2' };
const L33T_CHARS = (() => {
  const m = new Map();
  for (const [letter, subs] of Object.entries(L33T)) for (const c of subs) { if (!m.has(c)) m.set(c, []); m.get(c).push(letter); }
  return m;
})();

// Substitution tables { l33t char: letter } for the l33t characters of the password (one letter per character;
// every combination of the ambiguous ones such as 1 -> i | l).
function l33tSubs(chars) {
  const present = [...new Set(chars)].filter((c) => L33T_CHARS.has(c));
  let subs = [{}];
  for (const c of present) {
    const next = [];
    for (const s of subs) for (const letter of L33T_CHARS.get(c)) next.push({ ...s, [c]: letter });
    subs = next.slice(0, 64); // cap: ambiguous characters multiply the tables combinatorially
  }
  return present.length ? subs : [];
}

function l33tMatch(chars, lower, ctx) {
  const out = [];
  for (const sub of l33tSubs(chars)) {
    const subbed = lower.map((c) => sub[c] || c);
    for (const m of dictionaryMatch(chars, subbed, ctx)) {
      const tokenLower = lower.slice(m.i, m.j + 1);
      if (tokenLower.join('') === m.word) continue; // no substitution in this token
      const used = {};
      for (const c of tokenLower) if (sub[c]) used[c] = sub[c];
      out.push({ ...m, l33t: true, sub: used });
    }
  }
  return out;
}

// Russian JCUKEN and US QWERTY share the keys: a word typed with the other layout active (gfhjkm = пароль).
const LAT_KEYS = '`qwertyuiop[]asdfghjkl;\'zxcvbnm,./~QWERTYUIOP{}ASDFGHJKL:"ZXCVBNM<>?';
const CYR_KEYS = 'ёйцукенгшщзхъфывапролджэячсмитьбю.ЁЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧСМИТЬБЮ,';
const LAT2CYR = new Map([...LAT_KEYS].map((c, k) => [c, CYR_KEYS[k]]));
const CYR2LAT = new Map([...CYR_KEYS].map((c, k) => [c, LAT_KEYS[k]]).filter(([c]) => /[а-яё]/i.test(c)));
const isCyr = (w) => /[а-яё]/.test(w);

function layoutMatch(chars, lower, ctx) {
  const out = [];
  for (const [map, layout] of [[LAT2CYR, 'ru'], [CYR2LAT, 'en']]) {
    const changed = chars.map((c) => map.has(c));
    if (!changed.some(Boolean)) continue;
    const swapped = chars.map((c) => map.get(c) || c);
    for (const m of dictionaryMatch(chars, lowerChars(swapped), { ...ctx, user: null })) {
      if (m.dictionary === 'user' || isCyr(m.word) !== (layout === 'ru')) continue;
      if (!changed.slice(m.i, m.j + 1).every(Boolean)) continue; // every character came through the other layout
      out.push({ ...m, layout });
    }
  }
  return out;
}

// --- keyboard graphs (zxcvbn's adjacency graphs, built from the layouts) ------------------------------------------

// Rows as drawn by zxcvbn: each row of a keyboard is slanted one position to the right of the previous one;
// keypads are aligned. Two-character tokens are the unshifted and the shifted character of a key.
const LAYOUTS = {
  qwerty: [true, ['`~ 1! 2@ 3# 4$ 5% 6^ 7& 8* 9( 0) -_ =+', '    qQ wW eE rR tT yY uU iI oO pP [{ ]} \\|',
    '     aA sS dD fF gG hH jJ kK lL ;: \'"', '      zZ xX cC vV bB nN mM ,< .> /?']],
  dvorak: [true, ['`~ 1! 2@ 3# 4$ 5% 6^ 7& 8* 9( 0) [{ ]}', '    \'" ,< .> pP yY fF gG cC rR lL /? =+ \\|',
    '     aA oO eE uU iI dD hH tT nN sS -_', '      ;: qQ jJ kK xX bB mM wW vV zZ']],
  qwertz: [true, ['^° 1! 2" 3§ 4$ 5% 6& 7/ 8( 9) 0= ß? ´`', '    qQ wW eE rR tT zZ uU iI oO pP üÜ +*',
    '     aA sS dD fF gG hH jJ kK lL öÖ äÄ #\'', '   <> yY xX cC vV bB nN mM ,; .: -_']],
  azerty: [true, ['²³ &1 é2 "3 \'4 (5 -6 è7 _8 ç9 à0 )° =+', '    aA zZ eE rR tT yY uU iI oO pP ^¨ $£',
    '     qQ sS dD fF gG hH jJ kK lL mM ù% *µ', '   <> wW xX cC vV bB nN ,? ;. :/ !§']],
  jcuken: [true, ['ёЁ 1! 2" 3№ 4; 5% 6: 7? 8* 9( 0) -_ =+', '    йЙ цЦ уУ кК еЕ нН гГ шШ щЩ зЗ хХ ъЪ \\/',
    '     фФ ыЫ вВ аА пП рР оО лЛ дД жЖ эЭ', '      яЯ чЧ сС мМ иИ тТ ьЬ бБ юЮ .,']],
  keypad: [false, ['  / * -', '7 8 9 +', '4 5 6', '1 2 3', '  0 .']],
  mac_keypad: [false, ['  = / *', '7 8 9 -', '4 5 6 +', '1 2 3', '  0 .']],
};

// Keys get coordinates from their column in the drawing: (k - slant) / unit, unit 3 characters per key for slanted
// keyboards ("qQ " is 3 wide, each row shifted one character right), 2 for keypads. Neighbours: 6 directions on a
// slanted keyboard (hexagon-like), 8 on keypads. `degree` (average neighbours) and `starts` feed the spatial
// guess formula as in zxcvbn.
function buildGraph(slanted, lines) {
  const pos = new Map(); // "x,y" -> token
  const unit = slanted ? 3 : 2;
  lines.forEach((line, row) => {
    const y = row + 1, slant = slanted ? y - 1 : 0;
    for (let k = 0; k < line.length;) {
      if (line[k] === ' ') { k++; continue; }
      let e = k;
      while (e < line.length && line[e] !== ' ') e++;
      pos.set(`${(k - slant) / unit},${y}`, line.slice(k, e));
      k = e;
    }
  });
  const dirs = slanted ? [[-1, 0], [0, -1], [1, -1], [1, 0], [0, 1], [-1, 1]] : [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];
  const adj = new Map(), shifted = new Map();
  let degree = 0;
  for (const [key, token] of pos) {
    const [x, y] = key.split(',').map(Number);
    const near = dirs.map(([dx, dy]) => pos.get(`${x + dx},${y + dy}`) || null);
    [...token].forEach((c, k) => { adj.set(c, near); shifted.set(c, k === 1); degree += near.filter(Boolean).length; });
  }
  return { adj, shifted, keyboard: slanted, starts: adj.size, degree: degree / adj.size };
}
let GRAPHS = null;
const graphs = () => GRAPHS || (GRAPHS = Object.fromEntries(Object.entries(LAYOUTS).map(([name, [slanted, lines]]) => [name, buildGraph(slanted, lines)])));

function spatialMatch(chars) {
  const out = [];
  for (const [name, graph] of Object.entries(graphs())) {
    let i = 0;
    while (i < chars.length - 1) {
      let j = i + 1, last = null, turns = 0;
      let shifted = graph.keyboard && graph.shifted.get(chars[i]) ? 1 : 0;
      for (;;) {
        const adjacents = graph.adj.get(chars[j - 1]) || [];
        let found = false;
        if (j < chars.length) {
          const cur = chars[j];
          for (let dir = 0; dir < adjacents.length; dir++) {
            const a = adjacents[dir];
            const k = a ? a.indexOf(cur) : -1;
            if (k < 0) continue;
            found = true;
            if (k === 1) shifted++;
            if (last !== dir) { turns++; last = dir; }
            break;
          }
        }
        if (found) { j++; continue; }
        if (j - i > 2) out.push({ pattern: 'spatial', i, j: j - 1, token: chars.slice(i, j).join(''), graph: name, turns, shifted });
        i = j;
        break;
      }
    }
  }
  return out;
}

// --- repeats, sequences, years, dates ---------------------------------------------------------------------------

// Code unit offset -> character index.
function unitIndex(chars) {
  const map = [];
  chars.forEach((c, k) => { for (let u = 0; u < c.length; u++) map.push(k); });
  map.push(chars.length);
  return map;
}

// zxcvbn's trick: try a greedy and a lazy backreference regex at the same position; the longer match wins, and for
// the greedy one the anchored lazy regex recovers the shortest repeating unit ("abab" for "abababab" -> "ab").
// The base is scored recursively (mostGuessable on the unit) so "passwordpassword" costs password + a factor 2.
// Flags: s so '.' spans newlines, u so units are code points; idx maps UTF-16 offsets back to character indices.
function repeatMatch(chars, ctx) {
  const out = [];
  const s = chars.join(''), idx = unitIndex(chars);
  const greedy = /(.+)\1+/gsu, lazy = /(.+?)\1+/gsu, anchored = /^(.+?)\1+$/su;
  let last = 0;
  while (last < s.length) {
    greedy.lastIndex = lazy.lastIndex = last;
    const g = greedy.exec(s), l = lazy.exec(s);
    if (!g) break;
    let m, base;
    if (g[0].length > l[0].length) { m = g; base = anchored.exec(g[0])[1]; } else { m = l; base = l[1]; }
    const i = idx[m.index], j = idx[m.index + m[0].length] - 1;
    const baseChars = Array.from(base);
    const analysis = mostGuessable(baseChars, omnimatchChars(baseChars, { ...ctx, card: cardinality(baseChars).pool }), { ...ctx, card: cardinality(baseChars).pool });
    out.push({
      pattern: 'repeat', i, j, token: chars.slice(i, j + 1).join(''), base, baseLog2: analysis.log2, baseMatches: analysis.sequence,
      count: (j - i + 1) / baseChars.length,
    });
    last = m.index + m[0].length;
  }
  return out;
}

const MAX_DELTA = 5;
function sequenceName(token) {
  if (/^[a-z]+$/.test(token)) return ['lower', 26];
  if (/^[A-Z]+$/.test(token)) return ['upper', 26];
  if (/^\d+$/.test(token)) return ['digits', 10];
  if (/^[а-яё]+$/.test(token)) return ['cyrillic', 33];
  if (/^[А-ЯЁ]+$/.test(token)) return ['cyrillic-upper', 33];
  if (/^[α-ω]+$/.test(token)) return ['greek', 24];
  if (/^[Α-Ω]+$/.test(token)) return ['greek-upper', 24];
  return ['unicode', 26];
}
// Runs of constant code-point delta (|delta| 1..5): "abc", "1357", "zyx". Single steps count from 2 characters,
// larger deltas need 3 (two chars with delta 3 are not evidence of a sequence).
function sequenceMatch(chars) {
  const out = [];
  if (chars.length < 2) return out;
  const cp = chars.map((c) => c.codePointAt(0));
  const update = (i, j, delta) => {
    if (!(j - i > 1 || Math.abs(delta) === 1)) return;
    if (!(Math.abs(delta) > 0 && Math.abs(delta) <= MAX_DELTA)) return;
    const token = chars.slice(i, j + 1).join('');
    const [name, space] = sequenceName(token);
    out.push({ pattern: 'sequence', i, j, token, name, space, ascending: delta > 0 });
  };
  let i = 0, last = null;
  for (let k = 1; k < chars.length; k++) {
    const delta = cp[k] - cp[k - 1];
    if (last === null) last = delta;
    if (delta === last) continue;
    update(i, k - 1, last);
    i = k - 1;
    last = delta;
  }
  update(i, chars.length - 1, last);
  return out;
}

function yearMatch(chars) {
  const out = [];
  const s = chars.join(''), idx = unitIndex(chars), rx = /19\d\d|20[0-4]\d/g;
  let m;
  while ((m = rx.exec(s))) out.push({ pattern: 'regex', name: 'recent_year', i: idx[m.index], j: idx[m.index] + 3, token: m[0], year: +m[0] });
  return out;
}

// Separator-free dates: for each digit-string length, the (k, l) cut points into three numbers tried (zxcvbn's
// DATE_SPLITS); the reading whose year is closest to REFERENCE_YEAR wins. Two-digit years map 51..99 -> 19xx,
// 00..50 -> 20xx.
const DATE_SPLITS = { 4: [[1, 2], [2, 3]], 5: [[1, 3], [2, 3]], 6: [[1, 2], [2, 4], [4, 5]], 7: [[1, 3], [2, 3], [4, 5], [4, 6]], 8: [[2, 4], [4, 6]] };
const twoToFour = (y) => (y > 99 ? y : y > 50 ? y + 1900 : y + 2000);
function intsToDM([a, b]) {
  for (const [d, m] of [[a, b], [b, a]]) if (d >= 1 && d <= 31 && m >= 1 && m <= 12) return { day: d, month: m };
  return null;
}
function intsToDMY(ints) {
  if (ints[1] > 31 || ints[1] <= 0) return null;
  let over12 = 0, over31 = 0, under1 = 0;
  for (const n of ints) {
    if ((n > 99 && n < DATE_MIN_YEAR) || n > DATE_MAX_YEAR) return null;
    if (n > 31) over31++;
    if (n > 12) over12++;
    if (n <= 0) under1++;
  }
  if (over31 >= 2 || over12 === 3 || under1 >= 2) return null;
  const splits = [[ints[2], ints.slice(0, 2)], [ints[0], ints.slice(1, 3)]];
  for (const [y, rest] of splits) {
    if (y >= DATE_MIN_YEAR && y <= DATE_MAX_YEAR) {
      const dm = intsToDM(rest);
      return dm ? { year: y, ...dm } : null;
    }
  }
  for (const [y, rest] of splits) {
    const dm = intsToDM(rest);
    if (dm) return { year: twoToFour(y), ...dm };
  }
  return null;
}
function dateMatch(chars) {
  const all = [], n = chars.length;
  for (let i = 0; i + 4 <= n; i++) {
    for (let j = i + 3; j <= i + 7 && j < n; j++) {
      const token = chars.slice(i, j + 1).join('');
      if (!/^\d{4,8}$/.test(token)) continue;
      let best = null, dist = Infinity;
      for (const [k, l] of DATE_SPLITS[token.length]) {
        const dmy = intsToDMY([+token.slice(0, k), +token.slice(k, l), +token.slice(l)]);
        if (dmy && Math.abs(dmy.year - REFERENCE_YEAR) < dist) { best = dmy; dist = Math.abs(dmy.year - REFERENCE_YEAR); }
      }
      if (best) all.push({ pattern: 'date', i, j, token, separator: '', ...best });
    }
  }
  const rx = /^(\d{1,4})([\s/\\_.-])(\d{1,2})\2(\d{1,4})$/;
  for (let i = 0; i + 6 <= n; i++) {
    for (let j = i + 5; j <= i + 9 && j < n; j++) {
      const token = chars.slice(i, j + 1).join('');
      const m = rx.exec(token);
      if (!m) continue;
      const dmy = intsToDMY([+m[1], +m[3], +m[4]]);
      if (dmy) all.push({ pattern: 'date', i, j, token, separator: m[2], ...dmy });
    }
  }
  // Dates inside longer dates are noise.
  return all.filter((m) => !all.some((o) => o !== m && o.i <= m.i && o.j >= m.j));
}

// --- matching -----------------------------------------------------------------------------------------------------

function omnimatchChars(chars, ctx) {
  const lower = lowerChars(chars);
  const out = [
    ...dictionaryMatch(chars, lower, ctx), ...reverseDictionaryMatch(chars, lower, ctx), ...l33tMatch(chars, lower, ctx),
    ...layoutMatch(chars, lower, ctx), ...spatialMatch(chars), ...repeatMatch(chars, ctx), ...sequenceMatch(chars),
    ...yearMatch(chars), ...dateMatch(chars),
  ];
  return out.sort((a, b) => a.i - b.i || a.j - b.j);
}

function context(password, { userInputs = [] } = {}) {
  const user = new Map();
  let r = 1;
  for (const v of userInputs) {
    const w = String(v ?? '').toLowerCase().trim();
    if ([...w].length >= MIN_WORD && !user.has(w)) user.set(w, r++);
  }
  return { user: user.size ? user : null, card: cardinality(Array.from(password)).pool };
}

export function omnimatch(password, opts = {}) {
  const s = String(password ?? '');
  const ctx = context(s, opts);
  return omnimatchChars(Array.from(s), ctx).map((m) => { estimate(m, Array.from(s).length, ctx); return m; });
}

// --- guesses ---------------------------------------------------------------------------------------------------

const START_UPPER = /^\p{Lu}[^\p{Lu}]+$/u, END_UPPER = /^[^\p{Lu}]+\p{Lu}$/u, ALL_UPPER = /^[^\p{Ll}]+$/u, ALL_LOWER = /^[^\p{Lu}]+$/u;
function uppercaseVariations(token) {
  if (ALL_LOWER.test(token) || token.toLowerCase() === token) return 1;
  if (START_UPPER.test(token) || END_UPPER.test(token) || ALL_UPPER.test(token)) return 2;
  let U = 0, L = 0;
  for (const c of token) { if (/\p{Lu}/u.test(c)) U++; else if (/\p{Ll}/u.test(c)) L++; }
  let v = 0;
  for (let k = 1; k <= Math.min(U, L); k++) v += nCk(U + L, k);
  return v;
}
function l33tVariations(m) {
  if (!m.l33t) return 1;
  let v = 1;
  const chrs = Array.from(m.token.toLowerCase());
  for (const [subbed, letter] of Object.entries(m.sub)) {
    const S = chrs.filter((c) => c === subbed).length, U = chrs.filter((c) => c === letter).length;
    if (S === 0 || U === 0) v *= 2;
    else { let p = 0; for (let k = 1; k <= Math.min(U, S); k++) p += nCk(U + S, k); v *= p; }
  }
  return v;
}

// log2 of the guesses of a match (cached on the match).
// Per pattern as in zxcvbn's scoring.js: dictionary = rank x case variants x l33t variants (x2 reversed, x2 other
// layout); spatial = sum over lengths and turn counts of starts x degree^turns, x shift variants; sequence = start
// choices x length; dates / years = distance to the reference year (min 20 years) x 365 days (x4 separators).
// Sub-matches shorter than the password get a floor (10 / 50 guesses) so trivial fragments cannot drive the total
// to near zero.
// The result is cached on the match object (m.log2), so a match belongs to one context: bruteforce cost depends on
// ctx.card (repeat bases are scored with their own card on purpose). Matches are created fresh per search.
function estimate(m, n, ctx) {
  if (m.log2 !== undefined) return m.log2;
  const len = m.j - m.i + 1;
  let min = 1;
  if (len < n) min = len === 1 ? MIN_SUBMATCH_GUESSES_SINGLE_CHAR : MIN_SUBMATCH_GUESSES_MULTI_CHAR;
  let g;
  switch (m.pattern) {
    case 'bruteforce': {
      m.cardinality = ctx.card;
      g = Math.max(len * Math.log2(ctx.card), Math.log2((len === 1 ? MIN_SUBMATCH_GUESSES_SINGLE_CHAR : MIN_SUBMATCH_GUESSES_MULTI_CHAR) + 1));
      break;
    }
    case 'dictionary': {
      m.uppercaseVariations = uppercaseVariations(m.token);
      m.l33tVariations = l33tVariations(m);
      g = Math.log2(m.rank * m.uppercaseVariations * m.l33tVariations * (m.reversed ? 2 : 1) * (m.layout ? 2 : 1));
      break;
    }
    case 'spatial': {
      const graph = graphs()[m.graph];
      const s = graph.starts, d = graph.degree, L = len, t = m.turns;
      let guesses = 0;
      for (let i = 2; i <= L; i++) {
        const turns = Math.min(t, i - 1);
        for (let j = 1; j <= turns; j++) guesses += nCk(i - 1, j - 1) * s * d ** j;
      }
      if (m.shifted) {
        const S = m.shifted, U = L - S;
        if (S === 0 || U === 0) guesses *= 2;
        else { let v = 0; for (let k = 1; k <= Math.min(S, U); k++) v += nCk(S + U, k); guesses *= v; }
      }
      g = Math.log2(guesses);
      break;
    }
    case 'repeat': g = m.baseLog2 + Math.log2(m.count); break;
    case 'sequence': {
      const first = [...m.token][0];
      let base = 'aAzZ019аАяЯαΑωΩ'.includes(first) ? 4 : /\d/.test(first) ? 10 : m.space;
      if (!m.ascending) base *= 2;
      g = Math.log2(base * len);
      break;
    }
    case 'regex': g = Math.log2(Math.max(Math.abs(m.year - REFERENCE_YEAR), MIN_YEAR_SPACE)); break;
    case 'date': g = Math.log2(Math.max(Math.abs(m.year - REFERENCE_YEAR), MIN_YEAR_SPACE) * 365 * (m.separator ? 4 : 1)); break;
    default: g = len * Math.log2(ctx.card);
  }
  m.log2 = Math.max(g, Math.log2(min));
  m.guesses = 2 ** m.log2;
  return m.log2;
}

// zxcvbn's search for the decomposition with the fewest guesses: for a sequence of l matches the attacker needs
// l! * prod(guesses) + 10000^(l-1) guesses (the order of the matches is unknown; short sequences come first). In log2.
// Dynamic programming over end positions k and part counts l: optG[k][l] = best total for a decomposition of the
// prefix ending at k into l parts, optM / optPi the last match and the running product. Bruteforce spans fill the
// gaps between matches; two bruteforce spans are never adjacent (they would merge into one). Backtracking from the
// best l at n - 1 recovers the sequence.
function mostGuessable(chars, matches, ctx, excludeAdditive = false) {
  const n = chars.length;
  if (!n) return { log2: 0, sequence: [] };
  const byJ = Array.from({ length: n }, () => []);
  for (const m of matches) byJ[m.j].push(m);
  for (const l of byJ) l.sort((a, b) => a.i - b.i);
  const optM = Array.from({ length: n }, () => new Map());
  const optPi = Array.from({ length: n }, () => new Map());
  const optG = Array.from({ length: n }, () => new Map());
  const update = (m, l) => {
    const k = m.j;
    let pi = estimate(m, n, ctx);
    if (l > 1) pi += optPi[m.i - 1].get(l - 1);
    const mult = lfact(l) + pi;
    const g = excludeAdditive ? mult : log2add(mult, (l - 1) * LOG2_1E4);
    for (const [cl, cg] of optG[k]) if (cl <= l && cg <= g) return;
    // A state with more parts and a product term l! * prod that is not smaller can never lead to a better sequence
    // (every extension costs it at least as much, the additive term too): drop it. zxcvbn keeps such states, which
    // makes long repetitive inputs slow; the result is the same.
    for (const [cl] of optG[k]) {
      if (cl > l && lfact(cl) + optPi[k].get(cl) >= mult) { optG[k].delete(cl); optM[k].delete(cl); optPi[k].delete(cl); }
    }
    optG[k].set(l, g);
    optM[k].set(l, m);
    optPi[k].set(l, pi);
  };
  // Brute-force spans get their token only if they end up in the result (building every one is cubic).
  const bf = (i, j) => ({ pattern: 'bruteforce', token: null, i, j });
  for (let k = 0; k < n; k++) {
    for (const m of byJ[k]) {
      if (m.i > 0) for (const l of optM[m.i - 1].keys()) update(m, l + 1);
      else update(m, 1);
    }
    update(bf(0, k), 1);
    for (let i = 1; i <= k; i++) {
      let m = null;
      for (const [l, last] of optM[i - 1]) if (last.pattern !== 'bruteforce') update(m || (m = bf(i, k)), l + 1);
    }
  }
  let k = n - 1, l, g = Infinity;
  for (const [cl, cg] of optG[k]) if (cg < g) { l = cl; g = cg; }
  const sequence = [];
  while (k >= 0) {
    const m = optM[k].get(l);
    if (m.token === null) m.token = chars.slice(m.i, m.j + 1).join('');
    sequence.unshift(m);
    k = m.i - 1;
    l--;
  }
  return { log2: g, sequence };
}

// --- attack times and feedback ------------------------------------------------------------------------------------

// Guesses per second (zxcvbn's scenarios): throttled online service, unthrottled online service, offline attack on
// a slow salted hash (bcrypt, scrypt, Argon2, PBKDF2), offline attack on a fast hash with many GPUs.
export const SCENARIOS = { onlineThrottled: 100 / 3600, onlineUnthrottled: 10, offlineSlow: 1e4, offlineFast: 1e10 };

// zxcvbn's score buckets on guesses (10^3, 10^6, 10^8, 10^10, each + 5 as in its delta).
const scoreOf = (bits) => { const g = 2 ** bits; return g < 1e3 + 5 ? 0 : g < 1e6 + 5 ? 1 : g < 1e8 + 5 ? 2 : g < 1e10 + 5 ? 3 : 4; };

export const FEEDBACK = {
  top10: 'This is a top-10 common password', top100: 'This is a top-100 common password', common: 'This is a very common password',
  similar: 'This is similar to a commonly used password', word: 'A word by itself is easy to guess',
  nameAlone: 'Names and surnames by themselves are easy to guess', names: 'Common names and surnames are easy to guess',
  userInput: 'Words related to you or the service are easy to guess', layout: 'A word typed in the other keyboard layout is still the same word',
  straightRow: 'Straight rows of keys are easy to guess', keyPattern: 'Short keyboard patterns are easy to guess',
  repeatChar: 'Repeats like "aaa" are easy to guess', repeatPattern: 'Repeats like "abcabcabc" are only slightly harder to guess than "abc"',
  sequence: 'Sequences like abc or 6543 are easy to guess', recentYear: 'Recent years are easy to guess', date: 'Dates are often easy to guess',
  fewWords: 'Use a few words, avoid common phrases', noNeed: 'No need for symbols, digits, or uppercase letters',
  addWord: 'Add another word or two. Uncommon words are better.', capitalization: "Capitalization doesn't help very much",
  allUpper: 'All-uppercase is almost as easy to guess as all-lowercase', reversed: "Reversed words aren't much harder to guess",
  l33t: "Predictable substitutions like '@' instead of 'a' don't help very much", otherLayout: 'Switching the keyboard layout is a known trick: attackers try it',
  longerKeyboard: 'Use a longer keyboard pattern with more turns', avoidRepeats: 'Avoid repeated words and characters',
  avoidSequences: 'Avoid sequences', avoidYears: 'Avoid recent years', avoidYearsYou: 'Avoid years that are associated with you',
  avoidDates: 'Avoid dates and years that are associated with you',
};

function dictionaryFeedback(m, sole) {
  let warning = '';
  if (m.dictionary === 'passwords') {
    if (sole && !m.l33t && !m.reversed && !m.layout) warning = m.rank <= 10 ? 'top10' : m.rank <= 100 ? 'top100' : 'common';
    else if (m.log2 <= 4 * LOG2_10) warning = 'similar';
  } else if (m.dictionary === 'english' || m.dictionary === 'russian') {
    if (sole) warning = 'word';
  } else if (m.dictionary === 'names' || m.dictionary === 'surnames') {
    warning = sole ? 'nameAlone' : 'names';
  } else if (m.dictionary === 'user') warning = 'userInput';
  if (!warning && m.layout) warning = 'layout';
  const suggestions = [];
  if (START_UPPER.test(m.token)) suggestions.push('capitalization');
  else if (ALL_UPPER.test(m.token) && m.token.toLowerCase() !== m.token) suggestions.push('allUpper');
  if (m.reversed && [...m.token].length >= 4) suggestions.push('reversed');
  if (m.l33t) suggestions.push('l33t');
  if (m.layout) suggestions.push('otherLayout');
  return { warning, suggestions };
}

function matchFeedback(m, sole) {
  switch (m.pattern) {
    case 'dictionary': return dictionaryFeedback(m, sole);
    case 'spatial': return { warning: m.turns === 1 ? 'straightRow' : 'keyPattern', suggestions: ['longerKeyboard'] };
    case 'repeat': return { warning: [...m.base].length === 1 ? 'repeatChar' : 'repeatPattern', suggestions: ['avoidRepeats'] };
    case 'sequence': return { warning: 'sequence', suggestions: ['avoidSequences'] };
    case 'regex': return { warning: 'recentYear', suggestions: ['avoidYears', 'avoidYearsYou'] };
    case 'date': return { warning: 'date', suggestions: ['avoidDates'] };
    default: return null;
  }
}

// Feedback codes, not sentences: the UI translates them (FEEDBACK holds the English defaults). Only weak results
// (score <= 2) get advice, based on the longest match - the one that contributes most to the weakness.
function feedback(score, sequence) {
  if (!sequence.length) return { warning: '', suggestions: ['fewWords', 'noNeed'] };
  if (score > 2) return { warning: '', suggestions: [] };
  let longest = sequence[0];
  for (const m of sequence.slice(1)) if ([...m.token].length > [...longest.token].length) longest = m;
  const f = matchFeedback(longest, sequence.length === 1) || { warning: '', suggestions: [] };
  return { warning: f.warning || '', suggestions: ['addWord', ...f.suggestions] };
}

// --- entry point --------------------------------------------------------------------------------------------------

export function passwordStrength(password, opts = {}) {
  const { maxLength = 128 } = opts;
  const all = Array.from(String(password ?? ''));
  const ctx = context(all.join(''), opts);
  // Long inputs are analysed in pieces of maxLength characters (the search grows with the cube of the length on
  // repetitive input; zxcvbn advises truncating at 100); the bits of the pieces add up.
  let bits = 0;
  const sequence = [];
  for (let s = 0; s < all.length || s === 0; s += maxLength) {
    const chars = all.slice(s, s + maxLength);
    const r = mostGuessable(chars, omnimatchChars(chars, ctx), ctx);
    bits += r.log2;
    for (const m of r.sequence) sequence.push(s ? { ...m, i: m.i + s, j: m.j + s } : m);
  }
  const score = scoreOf(bits);
  return {
    length: all.length, pieces: Math.max(1, Math.ceil(all.length / maxLength)), entropy: bits, guesses: 2 ** bits, guessesLog10: bits / LOG2_10,
    score, quality: all.length ? quality(bits) : 'bad', charset: charsetEntropy(all.join('')), sequence,
    crackTimes: Object.fromEntries(Object.entries(SCENARIOS).map(([k, rate]) => [k, 2 ** bits / rate])),
    feedback: feedback(score, all.length ? sequence : []),
  };
}
