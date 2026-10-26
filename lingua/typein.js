// lingua/typein.js - typing every script of the studio from a Latin keyboard: Georgian (national romanisation or
// loose spellings, through kartuli-input.js) and Mingrelian (megruli.js), Russian Cyrillic (scholarly, ICAO and
// "chat" spellings: shch / sch, zh, kh / x, ts / c, ya / ja / ia, ' for ь), Devanagari (IAST, Harvard-Kyoto or
// Velthuis ASCII → IAST → Devanagari), hiragana and katakana (Hepburn or Kunrei), Hangul (Revised Romanization with
// alternatives) and pinyin with tone marks from tone numbers.
//
//   TARGETS: [{ id, script, lang, sample }]
//   typeIn(text, target) -> { text, alts: [[word, options]], iast? }
//   latinToCyrillic(text) -> Cyrillic          asciiToIast(text) -> IAST
import { convert } from './kartuli-input.js';
import { fromLatin as xmfFromLatin } from './megruli.js';
import { toKana } from './kana.js';
import { fromRoman } from './hangul.js';
import { marked } from './pinyin.js';
import { toDeva } from './iast.js';

export const TARGETS = [
  { id: 'ka', script: 'Geor', lang: 'ka', sample: "gamarjoba, rogor khar? kartuli ena" },
  { id: 'xmf', script: 'Geor', lang: 'xmf', sample: 'dida, muma, ch\'q\'oni' },
  { id: 'ru', script: 'Cyrl', lang: 'ru', sample: "zdravstvuyte! shchi, zhizn', yolka, ob\"yom" },
  { id: 'sa', script: 'Deva', lang: 'sa', sample: 'agnim iile purohitam · satyam eva jayate · kRSNa' },
  { id: 'hira', script: 'Jpan', lang: 'ja', sample: 'arigatou, sakura, kyou ha ii tenki' },
  { id: 'kata', script: 'Jpan', lang: 'ja', sample: 'ko-hi-, konpyu-ta-, terebi' },
  { id: 'ko', script: 'Kore', lang: 'ko', sample: 'annyeonghaseyo hangugeo' },
  { id: 'pinyin', script: 'Latn', lang: 'zh', sample: 'ni3 hao3, zhong1 guo2, lü4' },
];

// --- Cyrillic ------------------------------------------------------------------------------------------------------
// Longest unit first; y after a vowel (or at a word's end after a vowel) is й, otherwise ы; e at a word's start is э
// (ye / je give е): eto → это, yesli → если.
// Ordered list, not a map: latinToCyrillic takes the first entry that matches, so digraphs must precede their
// letters. Ambiguity is accepted: 'ts' is always ц and 'sch' always щ, so detskiy gives децкий; a lexicon would be
// needed to tell a cluster from a digraph.
const CYR = [
  ['shch', 'щ'], ['sch', 'щ'], ['zh', 'ж'], ['kh', 'х'], ['ts', 'ц'], ['ch', 'ч'], ['sh', 'ш'],
  ['yo', 'ё'], ['jo', 'ё'], ['yu', 'ю'], ['ju', 'ю'], ['ya', 'я'], ['ja', 'я'], ['ye', 'е'], ['je', 'е'],
  ["''", 'ъ'], ['"', 'ъ'], ['#', 'ъ'], ["'", 'ь'], ['`', 'ь'],
  ['a', 'а'], ['b', 'б'], ['v', 'в'], ['w', 'в'], ['g', 'г'], ['d', 'д'], ['e', 'е'], ['z', 'з'], ['i', 'и'], ['j', 'й'], ['k', 'к'], ['l', 'л'],
  ['m', 'м'], ['n', 'н'], ['o', 'о'], ['p', 'п'], ['r', 'р'], ['s', 'с'], ['t', 'т'], ['u', 'у'], ['f', 'ф'], ['h', 'х'], ['x', 'х'], ['c', 'ц'], ['q', 'к'], ['y', 'ы'],
];
const VOWEL_LAT = /[aeiouy]/;
const CYR_VOWEL = /[аеёиоуыэюя]/;
// Greedy longest match over a 4-character window (the longest unit, shch, is 4). Context rules use the output so far
// (prev Cyrillic letter) and the next Latin letter: 'y' after a vowel and not before one is й (moy -> мой). Case
// follows the first source letter of the unit.
export function latinToCyrillic(text) {
  let out = '';
  const s = String(text);
  for (let i = 0; i < s.length;) {
    const low = s.slice(i, i + 4).toLowerCase();
    const prev = out.slice(-1).toLowerCase();
    const wordStart = !/[a-zа-яё'"`#]/i.test(s[i - 1] || '');
    const hit = CYR.find(([l]) => low.startsWith(l));
    if (!hit) { out += s[i]; i++; continue; }
    const l = hit[0];
    let c = hit[1];
    if (l === 'y' && (CYR_VOWEL.test(prev) && !VOWEL_LAT.test((s[i + 1] || '').toLowerCase()))) c = 'й';
    if (l === 'e' && wordStart) c = 'э';
    out += s[i] !== s[i].toLowerCase() ? c.toUpperCase() : c;
    i += l.length;
  }
  return out;
}

// --- Sanskrit ------------------------------------------------------------------------------------------------------
// Velthuis (aa ii uu .r .m .h ~n "n .t .d .n "s .s) and Harvard-Kyoto (A I U R RR lR M H G J T D N z S) to IAST.
const VELTHUIS = [['aa', 'ā'], ['ii', 'ī'], ['uu', 'ū'], ['.rr', 'ṝ'], ['.r', 'ṛ'], ['.l', 'ḷ'], ['.m', 'ṃ'], ['.h', 'ḥ'], ['~n', 'ñ'], ['"n', 'ṅ'], ['.t', 'ṭ'], ['.d', 'ḍ'], ['.n', 'ṇ'], ['"s', 'ś'], ['.s', 'ṣ']];
const HK = [['RR', 'ṝ'], ['lR', 'ḷ'], ['A', 'ā'], ['I', 'ī'], ['U', 'ū'], ['R', 'ṛ'], ['M', 'ṃ'], ['H', 'ḥ'], ['G', 'ṅ'], ['J', 'ñ'], ['T', 'ṭ'], ['D', 'ḍ'], ['N', 'ṇ'], ['z', 'ś'], ['S', 'ṣ']];
// Two passes: Velthuis first (lowercase digraphs with dots / quotes), then Harvard-Kyoto by capital letters; the
// final toLowerCase clears any remaining capitals. Consequence: any capital is read as HK, so a capitalised name
// typed in plain Latin (Agni) becomes āgni. Accepted: IAST input has no case anyway.
export function asciiToIast(text) {
  let s = String(text);
  for (const [a, b] of VELTHUIS) s = s.split(a).join(b);
  let out = '';
  for (let i = 0; i < s.length;) {
    const hit = HK.find(([a]) => s.startsWith(a, i));
    if (hit) { out += hit[1]; i += hit[0].length; } else { out += s[i]; i++; }
  }
  return out.toLowerCase();
}

// Dispatcher: one shape { text, alts } for every target so the UI is target-agnostic. alts lists only ambiguous
// words (more than one candidate), at most 4 options each, to keep the suggestion strip short.
export function typeIn(text, target) {
  const src = String(text || '');
  switch (target) {
    case 'ka': { const r = convert(src); return { text: r.georgian, alts: r.words.filter((w) => w.candidates.length > 1).map((w) => [w.src, w.candidates.slice(0, 4).map((c) => c.ka)]) }; }
    case 'xmf': return { text: xmfFromLatin(src), alts: [] };
    case 'ru': return { text: latinToCyrillic(src), alts: [] };
    case 'sa': { const iast = asciiToIast(src); return { text: toDeva(iast, { accents: false }), iast, alts: [] }; }
    case 'hira': return { text: toKana(src, 'h'), alts: [] };
    case 'kata': return { text: toKana(src, 'k'), alts: [] };
    case 'ko': { const r = fromRoman(src); return { text: r.text, alts: (r.alts || []).filter((a) => a.options.length > 1).map((a) => [a.word, a.options.slice(0, 4)]) }; }
    case 'pinyin': return { text: marked(src.replace(/v/g, 'ü')), alts: [] };
    default: return { text: src, alts: [] };
  }
}
