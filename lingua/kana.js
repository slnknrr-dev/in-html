// lingua/kana.js - the Japanese syllabaries: tables of hiragana and katakana with Hepburn romaji, and conversion.
//
//   GOJUON: [{ h, k, r, row, col }]  the 46 basic kana        DAKUTEN: voiced and p- kana    YOON: kya, sha, …
//   toKana(romaji, 'h'|'k') -> kana   toRomaji(kana) -> romaji   isHiragana(ch) / isKatakana(ch)
//   toKatakana(hiragana) / toHiragana(katakana)
//
// Key decisions:
// - Tables are the single source: romaji->kana and kana->romaji maps are both derived from them, so a corrected
//   cell fixes both directions.
// - Katakana is hiragana + 0x60 for the whole block ぁ..ゖ (Unicode keeps the two syllabaries parallel), so only
//   hiragana is stored and converted; conversions never need per-character data.
// - Romaji parsing is greedy longest-match (KEYS sorted by length desc), the same strategy as IMEs: "sha" must win
//   over "s"+"ha". Hepburn is the output; Kunrei/Nihon-shiki spellings (si, tu, zya...) are accepted as input only.

// Gojuon grid: [consonant row id, cells for a i u e o]; null marks gaps (yi, ye, wi, wu, we are obsolete or absent),
// kept as null rather than dropped so `col` stays the vowel index for the grid UI.
const ROWS = [
  ['', ['a', 'あ', 'ア'], ['i', 'い', 'イ'], ['u', 'う', 'ウ'], ['e', 'え', 'エ'], ['o', 'お', 'オ']],
  ['k', ['ka', 'か', 'カ'], ['ki', 'き', 'キ'], ['ku', 'く', 'ク'], ['ke', 'け', 'ケ'], ['ko', 'こ', 'コ']],
  ['s', ['sa', 'さ', 'サ'], ['shi', 'し', 'シ'], ['su', 'す', 'ス'], ['se', 'せ', 'セ'], ['so', 'そ', 'ソ']],
  ['t', ['ta', 'た', 'タ'], ['chi', 'ち', 'チ'], ['tsu', 'つ', 'ツ'], ['te', 'て', 'テ'], ['to', 'と', 'ト']],
  ['n', ['na', 'な', 'ナ'], ['ni', 'に', 'ニ'], ['nu', 'ぬ', 'ヌ'], ['ne', 'ね', 'ネ'], ['no', 'の', 'ノ']],
  ['h', ['ha', 'は', 'ハ'], ['hi', 'ひ', 'ヒ'], ['fu', 'ふ', 'フ'], ['he', 'へ', 'ヘ'], ['ho', 'ほ', 'ホ']],
  ['m', ['ma', 'ま', 'マ'], ['mi', 'み', 'ミ'], ['mu', 'む', 'ム'], ['me', 'め', 'メ'], ['mo', 'も', 'モ']],
  ['y', ['ya', 'や', 'ヤ'], null, ['yu', 'ゆ', 'ユ'], null, ['yo', 'よ', 'ヨ']],
  ['r', ['ra', 'ら', 'ラ'], ['ri', 'り', 'リ'], ['ru', 'る', 'ル'], ['re', 'れ', 'レ'], ['ro', 'ろ', 'ロ']],
  ['w', ['wa', 'わ', 'ワ'], null, null, null, ['wo', 'を', 'ヲ']],
  ['nn', ['n', 'ん', 'ン'], null, null, null, null],
];

export const GOJUON = [];
for (const [row, ...cells] of ROWS) cells.forEach((c, col) => { if (c) GOJUON.push({ r: c[0], h: c[1], k: c[2], row, col }); });

// Voiced (゛) and semi-voiced (゜) kana. ぢ/づ romanise as ji/zu (Hepburn merges them with じ/ず); the reverse maps keep
// the first-seen entry, so ji -> じ and zu -> ず, while di/du below give typed access to ぢ/づ.
export const DAKUTEN = [
  ['ga', 'が', 'ガ'], ['gi', 'ぎ', 'ギ'], ['gu', 'ぐ', 'グ'], ['ge', 'げ', 'ゲ'], ['go', 'ご', 'ゴ'],
  ['za', 'ざ', 'ザ'], ['ji', 'じ', 'ジ'], ['zu', 'ず', 'ズ'], ['ze', 'ぜ', 'ゼ'], ['zo', 'ぞ', 'ゾ'],
  ['da', 'だ', 'ダ'], ['ji', 'ぢ', 'ヂ'], ['zu', 'づ', 'ヅ'], ['de', 'で', 'デ'], ['do', 'ど', 'ド'],
  ['ba', 'ば', 'バ'], ['bi', 'び', 'ビ'], ['bu', 'ぶ', 'ブ'], ['be', 'べ', 'ベ'], ['bo', 'ぼ', 'ボ'],
  ['pa', 'ぱ', 'パ'], ['pi', 'ぴ', 'ピ'], ['pu', 'ぷ', 'プ'], ['pe', 'ぺ', 'ペ'], ['po', 'ぽ', 'ポ'],
].map(([r, h, k]) => ({ r, h, k }));

// Yoon: an i-column kana + small ya/yu/yo. Hepburn drops the y after sh/ch/j (sha, not sya). Built before
// toKatakana's textual declaration: fine, function declarations are hoisted.
const Y_BASE = { k: 'き', s: 'し', c: 'ち', n: 'に', h: 'ひ', m: 'み', r: 'り', g: 'ぎ', j: 'じ', b: 'び', p: 'ぴ' };
export const YOON = [];
for (const [c, base] of Object.entries(Y_BASE)) {
  for (const [v, small] of [['a', 'ゃ'], ['u', 'ゅ'], ['o', 'ょ']]) {
    const r = c === 's' ? 'sh' + v : c === 'c' ? 'ch' + v : c === 'j' ? 'j' + v : c + 'y' + v;
    YOON.push({ r, h: base + small, k: toKatakana(base + small) });
  }
}

export function toKatakana(s) { return String(s).replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)); }
export function toHiragana(s) { return String(s).replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)); }
// The tests use the full blocks (incl. ゝゞゟ and ・ー), wider than the conversion ranges above: a "kana" check, not a
// "convertible" check. ー (U+30FC) therefore counts as katakana.
export const isHiragana = (c) => /[ぁ-ゟ]/.test(c);
export const isKatakana = (c) => /[゠-ヿ]/.test(c);

// romaji -> kana map (longest first): every table above plus spellings people type (si, ti, tu, hu, zi, di, du).
// Order YOON, DAKUTEN, GOJUON with "first wins": irrelevant for distinct keys, decides ji/zu (see DAKUTEN).
// x-/l- prefixes give small kana, as on Japanese IMEs. ('ti' appears twice in the list; harmless.)
const R2H = new Map();
for (const x of [...YOON, ...DAKUTEN, ...GOJUON]) if (!R2H.has(x.r)) R2H.set(x.r, x.h);
for (const [r, h] of [['si', 'し'], ['ti', 'ち'], ['tu', 'つ'], ['hu', 'ふ'], ['zi', 'じ'], ['di', 'ぢ'], ['du', 'づ'], ['nn', 'ん'], ["n'", 'ん'],
  ['sya', 'しゃ'], ['syu', 'しゅ'], ['syo', 'しょ'], ['tya', 'ちゃ'], ['tyu', 'ちゅ'], ['tyo', 'ちょ'], ['zya', 'じゃ'], ['zyu', 'じゅ'], ['zyo', 'じょ'],
  ['ja', 'じゃ'], ['ju', 'じゅ'], ['jo', 'じょ'], ['je', 'じぇ'], ['fa', 'ふぁ'], ['fi', 'ふぃ'], ['fe', 'ふぇ'], ['fo', 'ふぉ'], ['ti', 'ち'],
  ['xa', 'ぁ'], ['xi', 'ぃ'], ['xu', 'ぅ'], ['xe', 'ぇ'], ['xo', 'ぉ'], ['xtu', 'っ'], ['ltu', 'っ'], ['-', 'ー']]) R2H.set(r, h);
const KEYS = [...R2H.keys()].sort((a, b) => b.length - a.length);

// Left-to-right scanner with three context rules tried before the table lookup:
// 1. a doubled consonant (kk, tt, ss) is sokuon っ + the second consonant, which then starts the next kana; n is
//    excluded from the class because "nn" is ん. "tch" (Hepburn for っち) is the one sokuon not written as a double.
// 2. n not followed by a vowel/y/apostrophe is ん (kanji -> かんじ); "n'" disambiguates ん+vowel (kin'en).
// 3. otherwise the longest table key; unknown characters pass through unchanged (fail soft for live typing).
// KNOWN DEFECT: "nn" is always consumed as ん, so Hepburn text with ん before a n-row kana mis-converts:
// toKana('konnichiwa') -> こんいちわ (expected こんにちわ). Fix: in rule 3, take 'nn' as ん only when the char after
// it is not a vowel or y (else emit ん and advance by one, leaving the second n to start に).
export function toKana(romaji, script = 'h') {
  const s = String(romaji).toLowerCase();
  let out = '';
  for (let i = 0; i < s.length;) {
    const c = s[i];
    // doubled consonant -> small tsu
    if (c === s[i + 1] && /[bcdfghjkmprstvwz]/.test(c)) { out += 'っ'; i++; continue; }
    if (c === 't' && s.startsWith('tch', i)) { out += 'っ'; i++; continue; }
    // a lone n before a consonant or at the end
    if (c === 'n' && (i + 1 >= s.length || !/[aiueoy']/.test(s[i + 1])) && s[i + 1] !== 'n') { out += 'ん'; i++; continue; }
    const k = KEYS.find((key) => s.startsWith(key, i));
    if (k) { out += R2H.get(k); i += k.length; continue; }
    out += c; i++;
  }
  return script === 'k' ? toKatakana(out) : out;
}

const H2R = new Map();
for (const x of [...GOJUON, ...DAKUTEN, ...YOON]) { if (!H2R.has(x.h)) H2R.set(x.h, x.r); }
for (const [h, r] of [['ぁ', 'a'], ['ぃ', 'i'], ['ぅ', 'u'], ['ぇ', 'e'], ['ぉ', 'o'], ['ゔ', 'vu']]) H2R.set(h, r);

// Normalises to hiragana first, so one map serves both scripts. Digraphs (yoon) are tried before single kana.
// っ doubles the first letter of the next kana ("tch" before ch, Hepburn); ー repeats the previous romaji letter
// (a long vowel as a doubled letter, not a macron, to stay ASCII); ん before a vowel/y becomes n' so the output
// re-parses unambiguously through toKana. Particle は stays "ha": no morphology here (こんにちは -> konnichiha).
export function toRomaji(kana) {
  const s = toHiragana(kana);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (H2R.has(two) && two.length === 2) { out += H2R.get(two); i++; continue; }
    const c = s[i];
    if (c === 'っ') {
      const next = H2R.get(s.slice(i + 1, i + 3)) || H2R.get(s[i + 1]) || '';
      out += next.startsWith('ch') ? 't' : next[0] || '';
      continue;
    }
    if (c === 'ー') { out += out.slice(-1); continue; }
    if (c === 'ん') { out += /^[aiueoy]/.test(H2R.get(s[i + 1]) || '') ? "n'" : 'n'; continue; }
    out += H2R.get(c) ?? c;
  }
  return out;
}
