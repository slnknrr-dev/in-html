// prosody/build-dict.js - builds the compact pronunciation dictionaries dict-en.js and dict-ru.js (Node; importing
// the module runs nothing). The sources are downloaded by hand into any folder:
//
//   CMUdict (BSD-2-Clause)      https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict
//   Russian MFA dictionary v2.0.0a (CC BY 4.0, M. McAuliffe, M. Sonderegger)
//                               https://raw.githubusercontent.com/MontrealCorpusTools/mfa-models/main/dictionary/russian/mfa/russian_mfa.dict
//   Tatoeba sentences (CC BY 2.0 FR), used only to rank words by frequency
//                               https://downloads.tatoeba.org/exports/per_language/{eng,rus}/{eng,rus}_sentences.tsv.bz2
//
//   node prosody/build-dict.js --cmu cmudict.dict --mfa russian_mfa.dict --en eng_sentences.tsv --ru rus_sentences.tsv
//        [--en-size 25000] [--ru-size 30000]
//
// English: the most frequent words of the Tatoeba English sentences that CMUdict has, with the pronunciation of the
// most syllables (the first of them).
// Russian: the most frequent word forms of more than one vowel (and without ё, whose stress is known) that the MFA
// dictionary has with an unambiguous stress. MFA writes no stress marks, but it writes vowel reduction: the stressed
// vowel is the one full vowel (a æ e ɛ i o ɵ u) among the reduced ones (ɐ ə ɪ ʊ); ɨ and ʉ are both, so they count only
// when nothing else is a candidate, and a word-final e is not taken (MFA does not reduce it). Variants with another stress (за́мок / замо́к) keep both.
// Every word of the example stanzas (quotes.js) is added when the source has it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUOTES } from './quotes.js';
import { ARPA_CODE } from './dict-codes.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const RU_VOWELS = 'аеёиоуыэюя';
const FULL = new Set(['a', 'æ', 'e', 'ɛ', 'i', 'o', 'ɵ', 'u']);
const REDUCED = new Set(['ɐ', 'ə', 'ɪ', 'ʊ']);
// е-forms that are words of their own as often as spellings of the ё-form
const YO_NOT = new Set(['все', 'тем', 'чем', 'сел', 'вед']);

function frequencies(file, re) {
  const m = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.split('\t')[2];
    if (!t) continue;
    for (const w of t.toLowerCase().match(re) || []) m.set(w, (m.get(w) || 0) + 1);
  }
  const words = [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([w]) => w);
  words.count = m;
  return words;
}

// Front coding: each entry starts with one character for the length of the prefix shared with the previous word.
function frontCode(entries) {
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  let prev = '';
  const out = [];
  for (const [w, data] of entries) {
    let k = 0;
    while (k < prev.length && k < w.length && prev[k] === w[k] && k < 60) k++;
    out.push(String.fromCharCode(48 + k) + w.slice(k) + data);
    prev = w;
  }
  return out.join(',');
}

function quoteWords(lang) {
  const re = lang === 'ru' ? /[а-яё]+(?:-[а-яё]+)*/g : /[a-z]+(?:'[a-z]+)?/g;
  return new Set(QUOTES.filter((q) => q.lang === lang).flatMap((q) => q.lines.join(' ').toLowerCase().match(re) || []));
}

export function buildEnglish(cmuFile, tatoebaFile, size = 25000) {
  const cmu = new Map();
  for (const line of fs.readFileSync(cmuFile, 'utf8').split('\n')) {
    const m = /^([^\s(]+)(\(\d+\))?\s+([^#]+)/.exec(line);
    if (!m) continue;
    // the variant with the most syllables (tem-per-ate, ev-er-y): the analyser marks the ones a poet may drop
    const ph = m[3].trim().split(/\s+/);
    const syl = (p) => p.filter((x) => /\d$/.test(x)).length;
    if (!cmu.has(m[1]) || syl(ph) > syl(cmu.get(m[1]))) cmu.set(m[1], ph);
  }
  const encode = (ph) => ph.map((p) => { const base = p.replace(/\d$/, ''); const s = p.slice(base.length); return ARPA_CODE[base] + (s === '1' || s === '2' ? s : ''); }).join('');
  const chosen = new Map();
  for (const w of frequencies(tatoebaFile, /[a-z]+(?:'[a-z]+)?/g)) {
    if (chosen.size >= size) break;
    if (cmu.has(w) && w.length > 1 || w === 'a' || w === 'i') chosen.set(w, encode(cmu.get(w)));
  }
  let extra = 0;
  for (const w of quoteWords('en')) if (!chosen.has(w) && cmu.has(w)) { chosen.set(w, encode(cmu.get(w))); extra++; }
  return { data: frontCode([...chosen].map(([w, p]) => [w, ':' + p])), count: chosen.size, extra };
}

// -> the candidate stressed vowels [{ i (1-based), yo }] of one MFA pronunciation, or null when it does not align
export function ruStress(word, phones) {
  const vowels = phones.filter((p) => FULL.has(p) || REDUCED.has(p) || p === 'ɨ' || p === 'ʉ');
  const letters = [...word].map((c, i) => [c, i]).filter(([c]) => RU_VOWELS.includes(c));
  if (vowels.length !== letters.length) return null;
  const pick = (test) => vowels.map((p, i) => (test(p, i) ? i : -1)).filter((i) => i >= 0);
  // MFA leaves a word-final е unreduced (кофе, после, -те) and writes ʉ / ɨ for stressed and unstressed vowels alike
  const last = vowels.length - 1;
  let cand = pick((p, i) => FULL.has(p) && !(i === last && (p === 'e' || p === 'ɛ') && last > 0));
  if (!cand.length) cand = pick((p) => p === 'ɨ' || p === 'ʉ');
  if (!cand.length && last >= 0 && FULL.has(vowels[last])) cand = [last];
  // е read as ё (the texts often drop the dots): a stressed o-vowel under the letter е
  return cand.map((i) => ({ i: i + 1, yo: letters[i][0] === 'е' && (vowels[i] === 'ɵ' || vowels[i] === 'o') }));
}

export function buildRussian(mfaFile, tatoebaFile, size = 30000) {
  const mfa = new Map();
  for (const line of fs.readFileSync(mfaFile, 'utf8').split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const w = line.slice(0, tab);
    (mfa.get(w) || mfa.set(w, []).get(w)).push(line.slice(tab + 1).trim().split(/\s+/));
  }
  const freq = frequencies(tatoebaFile, /[а-яё]+(?:-[а-яё]+)*/g);
  const count = (w) => freq.count.get(w) || 0;
  // MFA pronounces a form spelt with е as written, also when it is a ё-word without its dots (звезды, ее, черный):
  // when the form with ё exists, the ё stress comes first; the е reading stays as an alternative only when the corpus
  // writes the е form much more often than the ё form (узнаем / узнаём)
  const yoForms = (w) => [...w].map((c, k) => (c === 'е' ? w.slice(0, k) + 'ё' + w.slice(k + 1) : null)).filter((x) => x && mfa.has(x));
  const stressOf = (w) => {
    const own = ownStress(w);
    const yo = yoForms(w);
    if (!yo.length) return own;
    const y = yo[0];
    const at = String.fromCharCode(48 + 1 + [...y.slice(0, y.indexOf('ё'))].filter((c) => RU_VOWELS.includes(c)).length) + '!';
    const keepOwn = own && count(w) > 4 * (count(y) + 1) && !own.startsWith(at[0]);
    return keepOwn ? own.slice(0, 1) + at : at;
  };
  const ownStress = (w) => {
    // variants with dropped vowels (colloquial несколько → неско) do not align and are left out
    const fit = (mfa.get(w) || []).filter((ph) => ph.filter((p) => FULL.has(p) || REDUCED.has(p) || p === 'ɨ' || p === 'ʉ').length === vowelCount(w));
    // a variant with one candidate decides; a variant with several (a colloquial unreduced ending) only confirms
    const all = fit.map((ph) => ruStress(w, ph)).filter((c) => c && c.length);
    const sure = all.filter((c) => c.length === 1).map((c) => c[0]);
    if (!sure.length) return null;
    const set = [...new Set(sure.map((s) => String.fromCharCode(48 + s.i) + (s.yo ? '!' : '')))];
    return set.length > 2 ? null : set.join('');
  };
  const vowelCount = (w) => [...w].filter((c) => RU_VOWELS.includes(c)).length;
  const chosen = new Map();
  let skipped = 0;
  for (const w of freq) {
    if (chosen.size >= size) break;
    if (w.includes('ё') || !mfa.has(w)) continue;
    // a monosyllable needs an entry only when it is a ё-word written with е (днем, лед) and mostly meant so
    if (vowelCount(w) === 1) { const y = yoForms(w)[0]; if (y && 4 * count(y) >= count(w) && !YO_NOT.has(w)) chosen.set(w, '1!'); continue; }
    if (vowelCount(w) < 2) continue;
    const s = stressOf(w);
    if (s) chosen.set(w, s); else skipped++;
  }
  let extra = 0;
  for (const w of quoteWords('ru')) if (!chosen.has(w) && vowelCount(w) > 1 && !w.includes('ё') && mfa.has(w)) { const s = stressOf(w); if (s) { chosen.set(w, s); extra++; } }
  // the stress is the vowel number as a character from '1' (beyond 9: ':' ';' …)
  // the frequent monosyllables (no stress to store): candidates of masculine rhymes
  const mono = [];
  for (const w of freq) { if (mono.length >= 2500) break; if (vowelCount(w) === 1 && !chosen.has(w) && mfa.has(w) && w.length > 1) mono.push([w, '']); }
  return { data: frontCode([...chosen]), mono: frontCode(mono), count: chosen.size, monos: mono.length, skipped, extra };
}

function writeModule(file, header, name, data, more = {}) {
  const body = `${header}\nexport const ${name} = ${JSON.stringify(data)};\n` + Object.entries(more).map(([k, v]) => `export const ${k} = ${JSON.stringify(v)};\n`).join('');
  fs.writeFileSync(file, body);
  return body.length;
}

if (isMain) {
  const argv = process.argv.slice(2);
  const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
  if (opt('cmu') && opt('en')) {
    const r = buildEnglish(opt('cmu'), opt('en'), Number(opt('en-size', 25000)));
    const n = writeModule(path.join(HERE, 'dict-en.js'), `// prosody/dict-en.js - GENERATED by build-dict.js, do not edit. ${r.count} English words with their pronunciation.
// Pronunciations: CMUdict (Copyright (C) 1993-2015 Carnegie Mellon University, BSD-2-Clause, see README.md);
// word choice: frequencies of the Tatoeba English sentences (CC BY 2.0 FR).
// Format: front-coded entries joined by ',': a prefix-length character (48 + n), the rest of the word, ':', the
// phonemes in the one-character codes of dict-codes.js with the stress digit 1 / 2 after a stressed vowel.`, 'EN_DICT', r.data);
    console.log(`dict-en.js: ${r.count} words (+${r.extra} from the quotes), ${n} bytes`);
  }
  if (opt('mfa') && opt('ru')) {
    const r = buildRussian(opt('mfa'), opt('ru'), Number(opt('ru-size', 30000)));
    const n = writeModule(path.join(HERE, 'dict-ru.js'), `// prosody/dict-ru.js - GENERATED by build-dict.js, do not edit. ${r.count} Russian word forms with their stress.
// Stress derived from the Russian MFA dictionary v2.0.0a (M. McAuliffe, M. Sonderegger, CC BY 4.0, see README.md);
// word choice: frequencies of the Tatoeba Russian sentences (CC BY 2.0 FR).
// Format: front-coded entries joined by ',': a prefix-length character (48 + n), the rest of the word, then the
// stressed vowel number(s) as characters (48 + n); '!' after one marks the letter е read as ё. RU_MONO: frequent
// monosyllables (front-coded, no payload), candidates of masculine rhymes.`, 'RU_DICT', r.data, { RU_MONO: r.mono });
    console.log(`dict-ru.js: ${r.count} forms, ${r.monos} monosyllables (+${r.extra} from the quotes, ${r.skipped} skipped as ambiguous), ${n} bytes`);
  }
}
