// prosody/phonemes.js - the IPA segments of English, Russian and Georgian with articulatory features, and the distance
// between two segments that rhyme comparison is built on.
//
//   features(seg) -> { v: true, h, b, r, d } (vowel: height 0 open … 3 close, backness 0 front … 2 back, rounded,
//                    diphthong) | { v: false, place, manner, voice, soft, lar } | null
//   isVowel(seg)   segDistance(a, b) -> 0 (same) … 1 (unlike)   simple(seg) -> the segment without softness / length
//
// Places: 0 bilabial, 1 labiodental, 2 dental, 3 alveolar, 4 postalveolar, 5 palatal, 6 velar, 7 uvular, 8 glottal.
// Manners: stop, affricate, fricative, nasal, lateral, trill, approximant. lar: '' plain, 'ej' ejective, 'asp' aspirated.

const V = (h, b, r, d = 0) => ({ v: true, h, b, r, d });
const C = (place, manner, voice, extra = {}) => ({ v: false, place, manner, voice, soft: false, lar: '', ...extra });

const TABLE = {
  // vowels (Russian, English, Georgian)
  i: V(3, 0, 0), ɪ: V(2.6, 0.3, 0), e: V(2, 0, 0), ɛ: V(1.5, 0, 0), æ: V(0.6, 0, 0), a: V(0, 1, 0), ɐ: V(0.6, 1, 0),
  ə: V(1.4, 1, 0), ʌ: V(1, 1.4, 0), ɑ: V(0, 2, 0), ɔ: V(1.2, 2, 1), o: V(2, 2, 1), ʊ: V(2.6, 1.7, 1), u: V(3, 2, 1),
  ɨ: V(3, 1, 0), ʉ: V(3, 1, 1), ɵ: V(2, 1, 1), ɝ: V(1.5, 1, 0), ɚ: V(1.4, 1, 0),
  eɪ: V(2.2, 0, 0, 1), aɪ: V(0.4, 0.6, 0, 1), ɔɪ: V(1.4, 1.6, 1, 1), aʊ: V(0.4, 1.4, 0, 1), oʊ: V(2, 2, 1, 1),
  // consonants
  p: C(0, 'stop', 0), b: C(0, 'stop', 1), m: C(0, 'nasal', 1), f: C(1, 'fricative', 0), v: C(1, 'fricative', 1),
  t: C(3, 'stop', 0), d: C(3, 'stop', 1), n: C(3, 'nasal', 1), s: C(3, 'fricative', 0), z: C(3, 'fricative', 1),
  θ: C(2, 'fricative', 0), ð: C(2, 'fricative', 1), l: C(3, 'lateral', 1), ɫ: C(3, 'lateral', 1), r: C(3, 'trill', 1), ɹ: C(3, 'approximant', 1),
  ts: C(3, 'affricate', 0), dz: C(3, 'affricate', 1), ʃ: C(4, 'fricative', 0), ʒ: C(4, 'fricative', 1),
  ʂ: C(4, 'fricative', 0), ʐ: C(4, 'fricative', 1), ɕ: C(5, 'fricative', 0, { soft: true }), tʃ: C(4, 'affricate', 0), dʒ: C(4, 'affricate', 1),
  tɕ: C(5, 'affricate', 0, { soft: true }), j: C(5, 'approximant', 1, { soft: true }), w: C(0, 'approximant', 1),
  k: C(6, 'stop', 0), ɡ: C(6, 'stop', 1), ŋ: C(6, 'nasal', 1), x: C(6, 'fricative', 0), ɣ: C(6, 'fricative', 1),
  q: C(7, 'stop', 0), χ: C(7, 'fricative', 0), ʁ: C(7, 'fricative', 1), h: C(8, 'fricative', 0), ʔ: C(8, 'stop', 0),
};

const cache = new Map();
export function features(seg) {
  if (!seg) return null;
  if (cache.has(seg)) return cache.get(seg);
  let f = TABLE[seg] || null;
  if (!f) {
    // modifiers: ʲ soft, ː long, ʼ ejective, ʰ aspirated
    const base = seg.replace(/[ʲːʼʰ]/g, '');
    const b = TABLE[base];
    if (b) f = { ...b, soft: b.soft || seg.includes('ʲ'), lar: seg.includes('ʼ') ? 'ej' : seg.includes('ʰ') ? 'asp' : b.lar || '', long: seg.includes('ː') };
  }
  cache.set(seg, f);
  return f;
}

export const isVowel = (seg) => { const f = features(seg); return !!(f && f.v); };
export const simple = (seg) => String(seg || '').replace(/[ʲːʼʰ]/g, '');

const MANNER_GROUP = { stop: 0, affricate: 0.5, fricative: 1, nasal: 2, lateral: 3, trill: 3.3, approximant: 3.6 };

// 0 … 1. Vowels: height, backness and rounding; consonants: place, manner, voice, softness, laryngeal series.
// A vowel against a consonant is 1 (j / w against i / u is a little less).
// Why features and not symbol equality: rhyme is graded - "тень / день" (t/d differ only in voice) rhymes far better
// than "тень / сень" or "тень / лень". A weighted feature distance gives the aligner (rhyme.js) that gradient.
// Weights encode what ears forgive: for vowels height > backness > rounding; for consonants place > manner >
// voice > softness > laryngeal series. Glides j/w are partly vowel-like (i/u), hence 0.6, not 1.
export function segDistance(a, b) {
  if (a === b) return 0;
  const A = features(a), B = features(b);
  if (!A || !B) return 1;
  if (A.v !== B.v) {
    const glide = (x, y) => (x.v ? null : (x.place === 5 && x.manner === 'approximant' && y.b < 0.7 && y.h > 2) || (x.place === 0 && x.manner === 'approximant' && y.r && y.h > 2));
    return glide(A, B) || glide(B, A) ? 0.6 : 1;
  }
  if (A.v) {
    const d = Math.abs(A.h - B.h) / 3 * 0.5 + Math.abs(A.b - B.b) / 2 * 0.35 + (A.r !== B.r ? 0.15 : 0) + (A.d !== B.d ? 0.1 : 0);
    return Math.min(1, d);
  }
  let d = Math.min(1, Math.abs(A.place - B.place) / 4) * 0.4 + Math.min(1, Math.abs(MANNER_GROUP[A.manner] - MANNER_GROUP[B.manner]) / 2) * 0.35 + (A.voice !== B.voice ? 0.12 : 0) + (!!A.soft !== !!B.soft ? 0.1 : 0) + (A.lar !== B.lar ? 0.08 : 0);
  return Math.min(1, d);
}
