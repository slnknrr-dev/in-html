// prosody/phon-ka.js - Georgian words: phonemes, syllables and the weak stress.
//
//   analyzeKa(word, { overrides }) -> W (lang 'ka')      KA_IPA      KA_FUNCTION
//
// The Mkhedruli spelling is phonemic: one letter, one phoneme (ejectives ʼ, aspirates ʰ, uvulars). Every vowel is a
// syllable; the consonants between two vowels open the next syllable (Georgian onsets may be long: მწვრთნელი),
// consonants at the end of the word close the last one. Stress is weak and its description varies; the analyser puts
// it on the first syllable and, in words of five and more syllables, a secondary one on the antepenultimate
// (src 'rule'). Georgian verse is syllabic (shairi: 16 syllables), so meter.js counts syllables and word boundaries
// rather than stresses, and rhyme is counted from the vowel of the penultimate syllable (two-syllable rhymes are the
// norm since Rustaveli).

export const KA_IPA = {
  ა: 'a', ბ: 'b', გ: 'ɡ', დ: 'd', ე: 'ɛ', ვ: 'v', ზ: 'z', თ: 'tʰ', ი: 'i', კ: 'kʼ', ლ: 'l', მ: 'm', ნ: 'n', ო: 'ɔ', პ: 'pʼ',
  ჟ: 'ʒ', რ: 'r', ს: 's', ტ: 'tʼ', უ: 'u', ფ: 'pʰ', ქ: 'kʰ', ღ: 'ʁ', ყ: 'qʼ', შ: 'ʃ', ჩ: 'tʃʰ', ც: 'tsʰ', ძ: 'dz', წ: 'tsʼ', ჭ: 'tʃʼ',
  ხ: 'χ', ჯ: 'dʒ', ჰ: 'h',
  // letters of the old orthography (Rustaveli's manuscripts in modern editions keep ჱ ჲ ჳ ჴ ჵ only rarely)
  ჱ: 'ɛj', ჲ: 'j', ჳ: 'wi', ჴ: 'q', ჵ: 'ɔ', ჶ: 'f', ჷ: 'ə', ჸ: 'ʔ',
};
const VOWELS = 'აეიოუჷ';
export const KA_FUNCTION = new Set('და რომ თუ ან არ ვერ ნუ კი ხომ მით ის ეს ვინ რა მე შენ მან მას მის მუნ ვით ვით ოდენ ესე ჰე'.split(' '));

export const normKa = (w) => String(w || '').replace(/[^ა-ჿ-]/g, '').replace(/^-+|-+$/g, '');

function analyzePart(norm) {
  const L = [...norm];
  const vIdx = L.map((c, i) => (VOWELS.includes(c) ? i : -1)).filter((i) => i >= 0);
  if (!vIdx.length) return [{ t: norm, ph: L.map((c) => KA_IPA[c] || '').filter(Boolean), v: -1, st: 0 }];
  const cuts = [0];
  // between two vowels: all consonants open the next syllable; two vowels in a row are two syllables
  for (let k = 0; k + 1 < vIdx.length; k++) cuts.push(vIdx[k] + 1 + (vIdx[k + 1] - vIdx[k] - 1 > 3 ? 1 : 0));
  cuts.push(L.length);
  return cuts.slice(0, -1).map((c, k) => {
    const t = L.slice(c, cuts[k + 1]);
    const ph = t.flatMap((x) => (KA_IPA[x] || '').split(/(?<=ɛ)(?=j)|(?<=w)(?=i)/).filter(Boolean));
    const v = ph.findIndex((s) => /^[aɛiɔuə]$/.test(s));
    return { t: t.join(''), ph, v, st: 0 };
  });
}

export function analyzeKa(word, { overrides = null } = {}) {
  const text = String(word || '');
  const norm = normKa(text);
  const W = { text, norm, lang: 'ka', syl: [], stress: -1, src: 'rule', alt: [], fn: KA_FUNCTION.has(norm), elide: [] };
  if (!norm) { W.src = 'none'; return W; }
  W.syl = norm.split('-').filter(Boolean).flatMap(analyzePart);
  const n = W.syl.filter((s) => s.v >= 0).length;
  if (!n) { W.src = 'none'; return W; }
  if (overrides && overrides.has(norm)) { W.stress = Math.min(n - 1, overrides.get(norm)); W.src = 'user'; }
  else W.stress = 0;
  if (n === 1 && !overrides?.has(norm)) W.src = 'mono';
  if (!W.fn || W.src === 'user') W.syl[W.stress].st = 1;
  if (n >= 5 && W.src !== 'user' && n - 3 !== W.stress) W.syl[n - 3].st = 2;
  if (W.fn && W.src !== 'user') W.stress = -1;
  return W;
}
