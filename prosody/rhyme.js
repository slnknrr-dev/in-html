// prosody/rhyme.js - the rhyming part of a word and how far two of them are from a rhyme.
//
//   rhymeUnit(W, { from }) -> U | null      compareRhyme(U1, U2) -> R      rhymeDistance(w1, w2, lang) -> 0 … 1
//   CLAUSULA = ['masculine', 'feminine', 'dactylic', 'hyperdactylic']      KINDS (best first)
//
// U = { lang, norm, from, support: [onset segments], vowel, post: [segments after the stressed vowel], syl (count from
//       the stressed vowel), clausula, open, deep: { onset, vowel } | null, text (letters from the stressed syllable) }
// The part starts at the stressed vowel (Russian, English; `from` may move it to the ictus the meter gives the line, as
// in Shakespeare's temperate / date) or at the vowel of the penultimate syllable (Georgian, whose rhyme is of two
// syllables, deeper when the third from the end matches too).
// R = { score 0…1, kind, clausula: [c1, c2], segs: [{ p, m: 'eq' | 'near' | 'off', role: 'support' | 'vowel' | 'post' }] }
// kinds: identical (the same word), rich (exact + the consonant before the vowel, or a third syllable in Georgian),
// exact, poor (Russian: an open masculine rhyme without that consonant), slant (small differences after the vowel),
// assonance (the vowels agree, the consonants do not), consonance (the consonants agree, the stressed vowel does not),
// none.
import { features, segDistance, isVowel } from './phonemes.js';

export const CLAUSULA = ['masculine', 'feminine', 'dactylic', 'hyperdactylic'];
export const KINDS = ['rich', 'exact', 'identical', 'poor', 'slant', 'assonance', 'consonance', 'none'];

const REDUCED = new Set(['ə', 'ɪ', 'ɐ', 'ʊ', 'ɨ', 'ɚ']);

export function rhymeUnit(W, { from = null } = {}) {
  const syls = W.syl.filter((s) => s.v >= 0);
  if (!syls.length) return null;
  const n = syls.length;
  let k;
  if (W.lang === 'ka') k = n >= 2 ? n - 2 : 0;
  else {
    const map = W.syl.map((s, j) => j).filter((j) => W.syl[j].v >= 0);
    const want = from !== null && from >= 0 ? from : W.stress >= 0 ? W.stress : map[map.length - 1];
    k = Math.max(0, map.indexOf(want));
    if (map.indexOf(want) < 0) k = n - 1;
  }
  const first = syls[k];
  const support = first.ph.slice(0, first.v);
  const vowel = first.ph[first.v];
  const post = first.ph.slice(first.v + 1).concat(...syls.slice(k + 1).map((s) => s.ph));
  const deep = W.lang === 'ka' && k > 0 ? { onset: syls[k - 1].ph.slice(0, syls[k - 1].v), vowel: syls[k - 1].ph[syls[k - 1].v], coda: syls[k - 1].ph.slice(syls[k - 1].v + 1) } : null;
  return {
    lang: W.lang, norm: W.norm, from: W.syl.indexOf(first), support, vowel, post, syl: n - k, clausula: Math.min(3, n - k - 1),
    open: !post.length, deep, text: syls.slice(k).map((s) => s.t).join(''),
  };
}

const isRed = (s) => REDUCED.has(String(s).replace(/[ʲː]/g, ''));

// Edit distance between two segment strings with feature costs; returns the normalised distance and the alignment.
// Weighted Levenshtein (Wagner-Fischer DP, O(n m) - rhyme units are a few segments): substitution = feature distance,
// insertion/deletion cheaper for consonants than vowels (a dropped consonant is a classic inexact rhyme, a dropped
// vowel changes the syllable count). The backtrace records each segment's partner cost for per-segment marking.
// Normalised by the longer length so short and long rhymes are comparable.
function align(a, b, lang) {
  const n = a.length, m = b.length;
  // a final й is cheap (лютый — смуты, грозящий — слаще: the truncated rhyme)
  const indel = (s) => (isVowel(s) ? 0.9 : /^j/.test(s) ? 0.2 : 0.6);
  const sub = (x, y) => {
    const d = segDistance(x, y);
    // post-tonic reduced vowels of Russian and English are close to each other
    if (isVowel(x) && isVowel(y) && isRed(x) && isRed(y)) return d * 0.4;
    return d;
  };
  const D = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  for (let i = 1; i <= n; i++) D[i][0] = D[i - 1][0] + indel(a[i - 1]);
  for (let j = 1; j <= m; j++) D[0][j] = D[0][j - 1] + indel(b[j - 1]);
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) D[i][j] = Math.min(D[i - 1][j - 1] + sub(a[i - 1], b[j - 1]), D[i - 1][j] + indel(a[i - 1]), D[i][j - 1] + indel(b[j - 1]));
  // the alignment of a's segments: the distance of each to its partner (1 when unpaired)
  const ma = new Array(n).fill(1);
  let i = n, j = m;
  while (i > 0 && j > 0) {
    const s = sub(a[i - 1], b[j - 1]);
    if (Math.abs(D[i][j] - (D[i - 1][j - 1] + s)) < 1e-9) { ma[i - 1] = s; i--; j--; }
    else if (Math.abs(D[i][j] - (D[i - 1][j] + indel(a[i - 1]))) < 1e-9) { ma[i - 1] = 1; i--; }
    else j--;
  }
  const len = Math.max(n, m);
  return { d: len ? Math.min(1, D[n][m] / len) : 0, ma, raw: D[n][m] };
}

const mark = (d) => (d < 0.08 ? 'eq' : d < 0.35 ? 'near' : 'off');

function lastCons(seq) { for (let i = seq.length - 1; i >= 0; i--) if (!isVowel(seq[i])) return seq[i]; return null; }

export function compareRhyme(A, B) {
  if (!A || !B) return { score: 0, kind: 'none', clausula: [A ? A.clausula : 0, B ? B.clausula : 0], segs: [] };
  const lang = A.lang;
  // Russian и / ы are one phoneme (вступил — был)
  const iy = (x) => String(x).replace(/ɨ/g, 'i');
  const dv = lang === 'ru' && iy(A.vowel) === iy(B.vowel) ? (A.vowel === B.vowel ? 0 : 0.03) : segDistance(A.vowel, B.vowel);
  const post = align(A.post, B.post, lang);
  const sa = lastCons(A.support), sb = lastCons(B.support);
  const dS = sa && sb ? segDistance(sa, sb) : !sa && !sb ? 0.3 : 0.7;
  // similarities fall steeply: a rhyme needs near identity (a vowel distance of 0.25 already counts as none)
  // the material after the vowel counts by its total edit cost: one changed consonant already weakens a rhyme much
  const sv = Math.max(0, 1 - 4 * dv), sp = Math.max(0, 1 - 1.5 * post.raw), ss = Math.max(0, 1 - 2 * dS);
  let score;
  if (lang === 'ka') {
    let deep = 0;
    if (A.deep && B.deep) {
      const dd = segDistance(A.deep.vowel, B.deep.vowel) * 0.6 + align(A.deep.coda.concat(A.support), B.deep.coda.concat(B.support), lang).d * 0.4;
      deep = Math.max(0, 1 - 2 * dd);
    }
    score = 0.3 * sv + 0.5 * sp + 0.1 * ss + 0.1 * deep;
  } else if (A.open && B.open) {
    score = lang === 'ru' ? 0.6 * sv + 0.4 * ss : 0.85 * sv + 0.15 * ss;
  } else {
    score = 0.45 * sv + 0.47 * sp + 0.08 * ss;
  }
  const sameClausula = A.clausula === B.clausula;
  if (!sameClausula) score *= 0.55;
  let kind;
  const consonants = (seq) => seq.filter((s) => !isVowel(s));
  const consAgree = align(consonants(A.post), consonants(B.post), lang).d < 0.2 && consonants(A.post).length > 0;
  if (A.norm === B.norm) { kind = 'identical'; score = Math.min(score, 0.5); }
  else if (dv < 0.08 && post.raw < 0.1 && sameClausula) {
    const deepMatch = lang === 'ka' && A.deep && B.deep && segDistance(A.deep.vowel, B.deep.vowel) < 0.08;
    if (dS < 0.08 || deepMatch) kind = 'rich';
    else if (lang === 'ru' && A.open && B.open) kind = 'poor';
    else kind = 'exact';
  } else if (dv < 0.08 && post.d < 0.35 && sameClausula) kind = 'slant';
  else if (dv < 0.08) kind = 'assonance';
  else if (consAgree && dv < 0.6) kind = 'consonance';
  else kind = 'none';
  if (kind === 'rich') score = Math.max(score, 0.97);
  // the segments of A with how well each is caught by B
  const segs = [];
  A.support.forEach((p, i) => segs.push({ p, m: i === A.support.length - 1 ? mark(dS) : 'off', role: 'support' }));
  segs.push({ p: A.vowel, m: mark(dv), role: 'vowel' });
  A.post.forEach((p, i) => segs.push({ p, m: mark(post.ma[i]), role: 'post' }));
  return { score: Math.max(0, Math.min(1, score)), kind, clausula: [A.clausula, B.clausula], segs };
}

export function rhymeDistance(W1, W2) {
  return 1 - compareRhyme(rhymeUnit(W1), rhymeUnit(W2)).score;
}

// A coarse key of a unit for indexes of candidate rhymes: the stressed vowel without length and the syllable count.
export const rhymeKey = (U) => (U ? String(features(U.vowel) ? U.vowel : '?').replace(/[ːʲ]/g, '') + U.clausula : '');
