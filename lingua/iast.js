// lingua/iast.js - Sanskrit in IAST (the scholarly Latin transcription) and in Devanagari, with Vedic accents.
//
//   tokens(iast) -> [{ k: 'v'|'c'|'m'|'sp', s: IAST letter, acc: ''|'u'|'s' }]   (vowel, consonant, mark ṃ ḥ m̐, other)
//   toDeva(iast, { accents: true }) -> Devanagari      fromDeva(deva) -> IAST
//   syllables(iast) -> [{ text, v (vowel), acc, heavy, why }]   (see meter.js for the weight rules)
//
// Accents in IAST: an acute (á) marks the udātta (raised) syllable, a grave (à) an independent svarita. In Devanagari
// the Rigveda's system is used: the udātta itself stays unmarked, the syllable before it gets the anudātta stroke
// below (U+0952) and the first unaccented syllable after it the svarita stroke above (U+0951); an independent
// svarita gets the stroke above, its preceding syllable the stroke below.
// Vedic ḷ / ḷh between vowels (agním īḷe) is the consonant ळ / ळ्ह; elsewhere ḷ is the vowel ऌ.
//
// Key decisions:
// - Tokenise first, render second: IAST digraphs (kh, ai, au) and combining diacritics make char-by-char mapping
//   wrong; a token stream { k, s, acc } is the shared input of toDeva, syllables and meter.js.
// - Accents are stripped from letters in NFD and kept as a token property, so "á" is the vowel a + udātta, never a
//   separate letter. Ambiguity a+i vs ai: a diphthong unless the i/u carries its own accent (pra-üga style hiatus
//   must be written with an accent or a separator).
// - Devanagari is an abugida: consonant + following vowel fuse into one akṣara (vowel sign), the inherent a is
//   silent in writing, and a consonant not followed by a vowel gets a virāma. toDeva therefore looks one token ahead.

// Inventories in the traditional varṇamālā order. LONG drives syllable weight (e/o/ai/au are always long in Sanskrit).

export const VOWELS = ['a', 'ā', 'i', 'ī', 'u', 'ū', 'ṛ', 'ṝ', 'ḷ', 'ḹ', 'e', 'ai', 'o', 'au'];
export const LONG = new Set(['ā', 'ī', 'ū', 'ṝ', 'ḹ', 'e', 'ai', 'o', 'au']);
export const CONSONANTS = ['k', 'kh', 'g', 'gh', 'ṅ', 'c', 'ch', 'j', 'jh', 'ñ', 'ṭ', 'ṭh', 'ḍ', 'ḍh', 'ṇ', 't', 'th', 'd', 'dh', 'n',
  'p', 'ph', 'b', 'bh', 'm', 'y', 'r', 'l', 'v', 'ś', 'ṣ', 's', 'h', 'ḻ', 'ḻh'];

const V_IND = { a: 'अ', 'ā': 'आ', i: 'इ', 'ī': 'ई', u: 'उ', 'ū': 'ऊ', 'ṛ': 'ऋ', 'ṝ': 'ॠ', 'ḷ': 'ऌ', 'ḹ': 'ॡ', e: 'ए', ai: 'ऐ', o: 'ओ', au: 'औ' };
const V_SIGN = { a: '', 'ā': 'ा', i: 'ि', 'ī': 'ी', u: 'ु', 'ū': 'ू', 'ṛ': 'ृ', 'ṝ': 'ॄ', 'ḷ': 'ॢ', 'ḹ': 'ॣ', e: 'े', ai: 'ै', o: 'ो', au: 'ौ' };
const C_DEVA = {
  k: 'क', kh: 'ख', g: 'ग', gh: 'घ', 'ṅ': 'ङ', c: 'च', ch: 'छ', j: 'ज', jh: 'झ', 'ñ': 'ञ', 'ṭ': 'ट', 'ṭh': 'ठ', 'ḍ': 'ड', 'ḍh': 'ढ', 'ṇ': 'ण',
  t: 'त', th: 'थ', d: 'द', dh: 'ध', n: 'न', p: 'प', ph: 'फ', b: 'ब', bh: 'भ', m: 'म', y: 'य', r: 'र', l: 'ल', v: 'व', 'ś': 'श', 'ṣ': 'ष', s: 'स', h: 'ह',
  'ḻ': 'ळ', 'ḻh': 'ळ्ह',
};
const MARK = { 'ṃ': 'ं', 'ḥ': 'ः', 'm̐': 'ँ', "'": 'ऽ' };
// Naming follows Unicode, not function: U+0951 is named "STRESS SIGN UDATTA" but in the Rigvedic system it is the
// vertical svarita stroke, which is how it is used below ('S' -> UDATTA). U+0952 is the anudātta stroke below.
const VIRAMA = '्', UDATTA = '॑', ANUDATTA = '॒';
const DIGITS = '०१२३४५६७८९';
const DANDA = { '|': '।', '||': '॥' };

const ACUTE = '́', GRAVE = '̀';

// IAST letters of a string, accents taken apart: [{ s, acc }]
// NFD splits precomposed letters (ā = a + macron, á = a + acute). Acute/grave become accents; every other combining
// mark (macron, dots below, candrabindu) is re-attached to its base and recomposed with NFC, so letters compare
// equal to the NFC keys of the tables. A combining mark with no base (string start) is dropped.
function letters(text) {
  const d = String(text).normalize('NFD');
  const out = [];
  for (let i = 0; i < d.length; i++) {
    const ch = d[i];
    if (/[̀-ͯ]/.test(ch)) {
      const last = out[out.length - 1];
      if (!last) continue;
      if (ch === ACUTE) last.acc = 'u';
      else if (ch === GRAVE) last.acc = 's';
      else last.s = (last.s + ch).normalize('NFC');
      continue;
    }
    out.push({ s: ch.toLowerCase(), acc: '' });
  }
  for (const l of out) l.s = l.s.normalize('NFC');
  return out;
}

// Greedy two-letter lookahead: '||' double daṇḍa, ai/au diphthongs (accent may sit on either letter in the input;
// an accent on the second letter alone still yields one accented diphthong), aspirates C+h. ṁ is normalised to ṃ
// (both anusvāra spellings occur); ’ and ' are avagraha. Anything else is 'sp' (spaces, punctuation, digits).
export function tokens(text) {
  const L = letters(text);
  const out = [];
  for (let i = 0; i < L.length; i++) {
    const a = L[i].s, b = L[i + 1] ? L[i + 1].s : '';
    let acc = L[i].acc;
    if (a === '|' && b === '|') { out.push({ k: 'sp', s: '||', acc: '' }); i++; continue; }
    if ((a === 'a' && (b === 'i' || b === 'u')) && !L[i + 1].acc) { out.push({ k: 'v', s: a + b, acc }); i++; continue; }
    if ((a === 'a' && (b === 'i' || b === 'u')) && L[i + 1].acc && !acc) { out.push({ k: 'v', s: a + b, acc: L[i + 1].acc }); i++; continue; }
    if (['k', 'g', 'c', 'j', 'ṭ', 'ḍ', 't', 'd', 'p', 'b'].includes(a) && b === 'h') { out.push({ k: 'c', s: a + 'h', acc: '' }); i++; continue; }
    if (a === 'ḷ') {
      // Vedic intervocalic ḷ(h): a consonant when a vowel follows (and the previous token is a vowel)
      const prevV = out.length && out[out.length - 1].k === 'v';
      const hNext = b === 'h';
      const nextS = hNext ? (L[i + 2] ? L[i + 2].s : '') : b;
      if (prevV && /^[aāiīuūṛeo]/.test(nextS)) { out.push({ k: 'c', s: hNext ? 'ḻh' : 'ḻ', acc: '' }); if (hNext) i++; continue; }
      out.push({ k: 'v', s: 'ḷ', acc }); continue;
    }
    if (a === 'm' && b === '̐') { out.push({ k: 'm', s: 'm̐', acc: '' }); i++; continue; }
    if (a === 'm̐') { out.push({ k: 'm', s: 'm̐', acc: '' }); continue; }
    if (V_IND[a]) { out.push({ k: 'v', s: a, acc }); continue; }
    if (C_DEVA[a]) { out.push({ k: 'c', s: a, acc: '' }); continue; }
    if (a === 'ṃ' || a === 'ṁ') { out.push({ k: 'm', s: 'ṃ', acc: '' }); continue; }
    if (a === 'ḥ') { out.push({ k: 'm', s: 'ḥ', acc: '' }); continue; }
    if (a === "'" || a === '’') { out.push({ k: 'm', s: "'", acc: '' }); continue; }
    out.push({ k: 'sp', s: a, acc: '' });
  }
  return out;
}

// Rigvedic marks for each vowel token: 'U' (udātta, unmarked), 'A' (anudātta stroke), 'S' (svarita stroke), ''.
// Two passes: first fix every udātta, then mark neighbours, so a neighbour that is itself udātta is never overwritten
// (consecutive udāttas stay unmarked). The svarita after an udātta is dependent (svarita-of-udātta); only the first
// following unaccented syllable gets it. The later pracaya run (unmarked unaccented syllables) needs no mark.
// Operates over vowels of the whole text, so accents flow across word boundaries, as in Saṃhitā text.
function vedicMarks(vowels) {
  const n = vowels.length;
  const m = new Array(n).fill('');
  for (let i = 0; i < n; i++) if (vowels[i].acc === 'u') m[i] = 'U';
  for (let i = 0; i < n; i++) {
    if (vowels[i].acc === 'u') {
      if (i > 0 && !m[i - 1]) m[i - 1] = 'A';
      if (i + 1 < n && !vowels[i + 1].acc && m[i + 1] !== 'U') m[i + 1] = 'S';
    } else if (vowels[i].acc === 's') {
      m[i] = 'S';
      if (i > 0 && !m[i - 1]) m[i - 1] = 'A';
    }
  }
  return m;
}

// `vi` walks the marks array in step with vowel tokens, whether the vowel is written as a sign (after a consonant,
// consumed via i++) or as an independent letter. A consonant before a space also gets a virāma: words are written
// separately here, not with sandhi-joined ligatures across the space.
export function toDeva(text, { accents = true } = {}) {
  const T = tokens(text);
  const vowels = T.filter((x) => x.k === 'v');
  const marks = accents ? vedicMarks(vowels) : vowels.map(() => '');
  let vi = 0, out = '';
  for (let i = 0; i < T.length; i++) {
    const x = T[i], next = T[i + 1];
    if (x.k === 'c') {
      out += C_DEVA[x.s];
      if (next && next.k === 'v') {
        out += V_SIGN[next.s];
        const mk = marks[vi++];
        out += mk === 'A' ? ANUDATTA : mk === 'S' ? UDATTA : '';
        i++;
      } else out += VIRAMA;
    } else if (x.k === 'v') {
      out += V_IND[x.s];
      const mk = marks[vi++];
      out += mk === 'A' ? ANUDATTA : mk === 'S' ? UDATTA : '';
    } else if (x.k === 'm') out += MARK[x.s];
    else if (DANDA[x.s]) out += DANDA[x.s];
    else if (/[0-9]/.test(x.s)) out += DIGITS[+x.s];
    else out += x.s;
  }
  return out;
}

// Reverse maps derived from the forward tables (single source). ḻh is excluded: it is a two-glyph sequence ळ्ह that
// the char loop reads naturally as ḻ + virāma + h.
const REV_C = Object.fromEntries(Object.entries(C_DEVA).filter(([k]) => k !== 'ḻh').map(([k, v]) => [v, k]));
const REV_VI = Object.fromEntries(Object.entries(V_IND).map(([k, v]) => [v, k]));
const REV_VS = Object.fromEntries(Object.entries(V_SIGN).filter(([k]) => k !== 'a').map(([k, v]) => [v, k]));
const REV_M = Object.fromEntries(Object.entries(MARK).map(([k, v]) => [v, k]));

// Devanagari -> IAST (accent strokes are dropped: their position cannot be restored to acutes without the rules above
// run backwards, which is ambiguous for pracaya syllables).
export function fromDeva(text) {
  const s = String(text).replace(/[॒॑]/g, '');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (REV_C[ch]) {
      out += REV_C[ch];
      const n = s[i + 1];
      if (n === VIRAMA) { i++; continue; }
      if (REV_VS[n]) { out += REV_VS[n]; i++; continue; }
      out += 'a';
    } else if (REV_VI[ch]) out += REV_VI[ch];
    else if (REV_M[ch]) out += REV_M[ch];
    else if (ch === '।') out += '|';
    else if (ch === '॥') out += '||';
    else if (DIGITS.includes(ch)) out += String(DIGITS.indexOf(ch));
    else out += ch;
  }
  return out;
}

// Syllables with their weight. A syllable is heavy (guru) when its vowel is long, when ṃ or ḥ follows the vowel, or
// when two or more consonants follow before the next vowel (also across word boundaries within a line).
// Onset-maximising syllabification: consonants accumulate as the onset of the next vowel; trailing consonants of the
// line attach to the last syllable. Aspirates (kh, ḍh) count as ONE consonant (one phoneme), ḻh as two (ḍ + h in
// origin, and it makes position in Vedic meter). Avagraha is not a coda. 'final' flags a light syllable closed by
// one consonant at line end (meter.js treats the line-final syllable as anceps). The no-op branch for 'sp' keeps
// spaces transparent, so weight is computed across word boundaries.
export function syllables(text) {
  const T = tokens(text).filter((x) => x.k !== 'sp' || x.s === ' ');
  const out = [];
  let onset = '';
  for (let i = 0; i < T.length; i++) {
    const x = T[i];
    if (x.k === 'c') { onset += x.s; continue; }
    if (x.k === 'sp') { onset += onset ? '' : ''; continue; }
    if (x.k === 'm') { if (out.length) { out[out.length - 1].text += x.s; out[out.length - 1].coda = true; } continue; }
    // a vowel: look ahead at the consonants before the next vowel
    let j = i + 1, cons = 0, coda = false;
    while (j < T.length && T[j].k !== 'v') {
      if (T[j].k === 'c') cons += T[j].s.length > 1 && T[j].s.endsWith('h') && T[j].s !== 'ḻh' ? 1 : T[j].s === 'ḻh' ? 2 : 1;
      if (T[j].k === 'm' && T[j].s !== "'") coda = true;
      j++;
    }
    const last = j >= T.length;
    const long = LONG.has(x.s);
    const heavy = long || coda || cons >= 2;
    out.push({ text: onset + x.s, v: x.s, acc: x.acc, heavy, why: long ? 'long' : coda ? 'coda' : cons >= 2 ? 'cluster' : last && cons === 1 ? 'final' : 'short', coda });
    onset = '';
  }
  if (onset && out.length) out[out.length - 1].text += onset;
  return out;
}

export const vowelIsLong = (v) => LONG.has(v);
