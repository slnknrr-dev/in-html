// lingua/sounds.js - the same sound in another script. Letters of Georgian (Mkhedruli, with the Mingrelian ჷ ჸ ჲ),
// Russian Cyrillic, Korean jamo, Devanagari and the IPA symbols of the English course, each with its sound; sounds
// compared by features (place, manner, voice, the laryngeal series — plain, aspirated, ejective, tense, breathy — and
// for vowels height, backness, rounding, length), so a letter finds its exact or nearest counterpart in any other
// script together with what differs: Georgian ქ /kʰ/ = Korean ㅋ = Devanagari ख, while Russian к /k/ lacks the puff.
//
//   SCRIPT_LETTERS: { Geor | Cyrl | Kore | Deva | Ipa: [[letter, ipa]] }
//   soundOf(script, letter) -> ipa          features(ipa) -> { c|v, … } | null
//   distance(ipaA, ipaB) -> { d, diff: ['aspiration', 'voice', …] }
//   counterparts(script, letter, toScript, { max }) -> [{ ch, ipa, d, diff, exact }]   nearest first

// Data table: [letter, IPA] per script. IPA is a broad phonemic value chosen for learner comparison (e.g. English
// p as pʰ, Russian л as velarised ɫ). Only base letters: diacritics and positional variants are out of scope.
export const SCRIPT_LETTERS = {
  Geor: [['ა', 'ɑ'], ['ბ', 'b'], ['გ', 'ɡ'], ['დ', 'd'], ['ე', 'ɛ'], ['ვ', 'v'], ['ზ', 'z'], ['თ', 'tʰ'], ['ი', 'i'], ['კ', 'kʼ'], ['ლ', 'l'], ['მ', 'm'], ['ნ', 'n'], ['ო', 'ɔ'],
    ['პ', 'pʼ'], ['ჟ', 'ʒ'], ['რ', 'r'], ['ს', 's'], ['ტ', 'tʼ'], ['უ', 'u'], ['ფ', 'pʰ'], ['ქ', 'kʰ'], ['ღ', 'ɣ'], ['ყ', 'qʼ'], ['შ', 'ʃ'], ['ჩ', 'tʃʰ'], ['ც', 'tsʰ'], ['ძ', 'dz'],
    ['წ', 'tsʼ'], ['ჭ', 'tʃʼ'], ['ხ', 'χ'], ['ჯ', 'dʒ'], ['ჰ', 'h'], ['ჷ', 'ə'], ['ჸ', 'ʔ'], ['ჲ', 'j']],
  Cyrl: [['а', 'a'], ['б', 'b'], ['в', 'v'], ['г', 'ɡ'], ['д', 'd'], ['ж', 'ʐ'], ['з', 'z'], ['и', 'i'], ['й', 'j'], ['к', 'k'], ['л', 'ɫ'], ['м', 'm'], ['н', 'n'], ['о', 'o'],
    ['п', 'p'], ['р', 'r'], ['с', 's'], ['т', 't'], ['у', 'u'], ['ф', 'f'], ['х', 'x'], ['ц', 'ts'], ['ч', 'tɕ'], ['ш', 'ʂ'], ['щ', 'ɕː'], ['ы', 'ɨ'], ['э', 'e']],
  Kore: [['ㄱ', 'k'], ['ㄲ', 'k͈'], ['ㅋ', 'kʰ'], ['ㄷ', 't'], ['ㄸ', 't͈'], ['ㅌ', 'tʰ'], ['ㅂ', 'p'], ['ㅃ', 'p͈'], ['ㅍ', 'pʰ'], ['ㅈ', 'tɕ'], ['ㅉ', 'tɕ͈'], ['ㅊ', 'tɕʰ'],
    ['ㅅ', 's'], ['ㅆ', 's͈'], ['ㅎ', 'h'], ['ㄴ', 'n'], ['ㅁ', 'm'], ['ㅇ', 'ŋ'], ['ㄹ', 'l'], ['ㅏ', 'a'], ['ㅓ', 'ʌ'], ['ㅗ', 'o'], ['ㅜ', 'u'], ['ㅡ', 'ɯ'], ['ㅣ', 'i'], ['ㅐ', 'ɛ'], ['ㅔ', 'e']],
  Deva: [['अ', 'ɐ'], ['आ', 'aː'], ['इ', 'i'], ['ई', 'iː'], ['उ', 'u'], ['ऊ', 'uː'], ['ए', 'eː'], ['ओ', 'oː'], ['क', 'k'], ['ख', 'kʰ'], ['ग', 'ɡ'], ['घ', 'ɡʱ'], ['ङ', 'ŋ'],
    ['च', 'tɕ'], ['छ', 'tɕʰ'], ['ज', 'dʑ'], ['झ', 'dʑʱ'], ['ञ', 'ɲ'], ['ट', 'ʈ'], ['ठ', 'ʈʰ'], ['ड', 'ɖ'], ['ढ', 'ɖʱ'], ['ण', 'ɳ'], ['त', 't̪'], ['थ', 't̪ʰ'], ['द', 'd̪'], ['ध', 'd̪ʱ'],
    ['न', 'n'], ['प', 'p'], ['फ', 'pʰ'], ['ब', 'b'], ['भ', 'bʱ'], ['म', 'm'], ['य', 'j'], ['र', 'r'], ['ल', 'l'], ['व', 'ʋ'], ['श', 'ɕ'], ['ष', 'ʂ'], ['स', 's'], ['ह', 'ɦ']],
  Ipa: [['iː', 'iː'], ['ɪ', 'ɪ'], ['e', 'e'], ['æ', 'æ'], ['ɑː', 'ɑː'], ['ɒ', 'ɒ'], ['ɔː', 'ɔː'], ['ʊ', 'ʊ'], ['uː', 'uː'], ['ʌ', 'ʌ'], ['ɜː', 'ɜː'], ['ə', 'ə'],
    ['p', 'pʰ'], ['b', 'b'], ['t', 'tʰ'], ['d', 'd'], ['k', 'kʰ'], ['g', 'ɡ'], ['f', 'f'], ['v', 'v'], ['θ', 'θ'], ['ð', 'ð'], ['s', 's'], ['z', 'z'], ['ʃ', 'ʃ'], ['ʒ', 'ʒ'],
    ['h', 'h'], ['tʃ', 'tʃ'], ['dʒ', 'dʒ'], ['m', 'm'], ['n', 'n'], ['ŋ', 'ŋ'], ['l', 'l'], ['r', 'ɹ'], ['j', 'j'], ['w', 'w']],
};

// Consonants: place (ordered front to back), manner, voice; the laryngeal series as a modifier.
const PLACES = ['bilabial', 'labiodental', 'dental', 'alveolar', 'postalveolar', 'retroflex', 'palatal', 'velar', 'uvular', 'glottal'];
const C = {
  p: ['bilabial', 'stop', 0], b: ['bilabial', 'stop', 1], m: ['bilabial', 'nasal', 1], w: ['bilabial', 'approx', 1],
  f: ['labiodental', 'fric', 0], v: ['labiodental', 'fric', 1], ʋ: ['labiodental', 'approx', 1],
  θ: ['dental', 'fric', 0], ð: ['dental', 'fric', 1],
  t: ['alveolar', 'stop', 0], d: ['alveolar', 'stop', 1], n: ['alveolar', 'nasal', 1], s: ['alveolar', 'fric', 0], z: ['alveolar', 'fric', 1],
  ts: ['alveolar', 'affr', 0], dz: ['alveolar', 'affr', 1], l: ['alveolar', 'lateral', 1], ɫ: ['alveolar', 'lateral', 1], r: ['alveolar', 'trill', 1], ɹ: ['alveolar', 'approx', 1],
  ʃ: ['postalveolar', 'fric', 0], ʒ: ['postalveolar', 'fric', 1], tʃ: ['postalveolar', 'affr', 0], dʒ: ['postalveolar', 'affr', 1],
  ʂ: ['retroflex', 'fric', 0], ʐ: ['retroflex', 'fric', 1], ʈ: ['retroflex', 'stop', 0], ɖ: ['retroflex', 'stop', 1], ɳ: ['retroflex', 'nasal', 1],
  ɕ: ['palatal', 'fric', 0], tɕ: ['palatal', 'affr', 0], dʑ: ['palatal', 'affr', 1], ɲ: ['palatal', 'nasal', 1], j: ['palatal', 'approx', 1],
  k: ['velar', 'stop', 0], ɡ: ['velar', 'stop', 1], ŋ: ['velar', 'nasal', 1], x: ['velar', 'fric', 0], ɣ: ['velar', 'fric', 1],
  q: ['uvular', 'stop', 0], χ: ['uvular', 'fric', 0], h: ['glottal', 'fric', 0], ɦ: ['glottal', 'fric', 1], ʔ: ['glottal', 'stop', 0],
};
const MANNERS = { stop: 0, affr: 1, fric: 2, nasal: 3, lateral: 4, trill: 4, approx: 5 };
// Vowels: height 0 (close) … 3 (open), backness 0 (front) … 2 (back), rounded.
const V = { i: [0, 0, 0], ɪ: [0.5, 0.3, 0], e: [1, 0, 0], ɛ: [2, 0, 0], æ: [2.6, 0, 0], a: [3, 0.8, 0], ɐ: [2.5, 1, 0], ɑ: [3, 2, 0], ɒ: [3, 2, 1], ʌ: [2, 1.8, 0],
  ə: [1.5, 1, 0], ɜ: [2, 1, 0], ɨ: [0, 1, 0], ɯ: [0, 2, 0], u: [0, 2, 1], ʊ: [0.5, 1.7, 1], o: [1, 2, 1], ɔ: [2, 2, 1] };

// IPA string -> feature record. Diacritics are read off and stripped (ː length, ʰ ʼ ͈ ʱ laryngeal, ̪ dental) so the
// base symbol can be looked up in V / C. The laryngeal chain picks the first match: one series per sound by design.
// Unknown symbols give null, which distance() turns into a large cost instead of throwing.
export function features(ipa) {
  let s = String(ipa || '');
  const long = /ː/.test(s);
  s = s.replace(/ː/g, '');
  const lar = /ʰ/.test(s) ? 'aspirated' : /ʼ/.test(s) ? 'ejective' : /͈/.test(s) ? 'tense' : /ʱ/.test(s) ? 'breathy' : 'plain';
  const base = s.replace(/[ʰʼʱ͈̪]/g, '');
  if (V[base]) { const [ht, bk, rd] = V[base]; return { kind: 'v', ht, bk, rd, long }; }
  if (C[base]) { const [place, manner, voice] = C[base]; return { kind: 'c', place, manner, voice, lar, long, dental: /̪/.test(s) }; }
  return null;
}

// Hushing sounds (postalveolar, retroflex, palatal) are heard as one by most learners: Russian ш /ʂ/ ≈ Georgian შ /ʃ/.
const HUSH = new Set(['postalveolar', 'retroflex', 'palatal']);
function placeCost(a, b, steps) {
  if (!steps) return 0;
  if (HUSH.has(a) && HUSH.has(b)) return 0.3;
  if ([a, b].sort().join() === 'alveolar,dental') return 0.3;
  return Math.min(steps, 3) * 0.8;
}
// Laryngeal series: an ejective sounds closest to a tense (Korean) or plain stop, farthest from an aspirated one.
const LAR = { 'aspirated,plain': 0.6, 'ejective,plain': 0.5, 'plain,tense': 0.4, 'ejective,tense': 0.3, 'aspirated,ejective': 0.8, 'aspirated,tense': 0.8, 'breathy,plain': 0.6, 'aspirated,breathy': 0.5, 'breathy,ejective': 0.9, 'breathy,tense': 0.8 };
const larCost = (a, b) => (a === b ? 0 : LAR[[a, b].sort().join()] ?? 0.7);

// Weighted feature distance (hand-tuned, not learned). Vowels: L1 over height + backness, plus rounding
// and length penalties. Consonants: place steps (capped, with cheap perceptual merges), manner change 1 + 0.4 per
// rank step, voice 1, laryngeal from LAR, length 0.3, dental flag 0.1. Vowel vs consonant = 9, unknown = 99: both far
// above any real pair, so they sort last. `diff` names what differs for the UI.
export function distance(a, b) {
  const A = features(a), Bf = features(b);
  if (!A || !Bf) return { d: 99, diff: ['unknown'] };
  if (A.kind !== Bf.kind) return { d: 9, diff: ['kind'] };
  const diff = [];
  let d = 0;
  if (A.kind === 'v') {
    const dh = Math.abs(A.ht - Bf.ht), db = Math.abs(A.bk - Bf.bk);
    if (dh >= 0.5) diff.push('height');
    if (db >= 0.5) diff.push('backness');
    if (A.rd !== Bf.rd) diff.push('rounding');
    if (A.long !== Bf.long) diff.push('length');
    d = dh + db + (A.rd !== Bf.rd ? 0.7 : 0) + (A.long !== Bf.long ? 0.3 : 0);
  } else {
    const dp = Math.abs(PLACES.indexOf(A.place) - PLACES.indexOf(Bf.place));
    const dm = Math.abs(MANNERS[A.manner] - MANNERS[Bf.manner]);
    if (dp) diff.push('place');
    if (dm || A.manner !== Bf.manner) diff.push('manner');
    if (A.voice !== Bf.voice) diff.push('voice');
    if (A.lar !== Bf.lar) diff.push('lar:' + A.lar + '>' + Bf.lar);
    if (A.long !== Bf.long) diff.push('length');
    d = placeCost(A.place, Bf.place, dp) + (A.manner !== Bf.manner ? 1 + dm * 0.4 : 0) + (A.voice !== Bf.voice ? 1 : 0) + larCost(A.lar, Bf.lar) + (A.long !== Bf.long ? 0.3 : 0) + (A.dental !== Bf.dental ? 0.1 : 0);
  }
  return { d: Math.round(d * 100) / 100, diff };
}

export const soundOf = (script, ch) => ((SCRIPT_LETTERS[script] || []).find((x) => x[0] === ch) || [])[1] || null;

// Brute force over the target alphabet (at most ~45 letters): cheaper than any index. 'exact' threshold 0.15 lets
// only the dental flag differ (0.1), so t̪ and t count as the same sound.
export function counterparts(script, ch, toScript, { max = 4 } = {}) {
  const ipa = soundOf(script, ch);
  if (!ipa) return [];
  return (SCRIPT_LETTERS[toScript] || []).map(([c2, i2]) => { const r = distance(ipa, i2); return { ch: c2, ipa: i2, d: r.d, diff: r.diff, exact: r.d < 0.15 }; })
    .sort((a, b) => a.d - b.d).slice(0, max);
}
