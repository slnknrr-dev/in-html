// prosody/words.js - one entry point for the three languages: words of a line and their analysis.
//
//   LANGS = ['en', 'ru', 'ka']          detectLang(text) -> 'en' | 'ru' | 'ka'
//   tokenize(line, lang) -> [{ text, start, end }]      analyzeWord(word, lang, { overrides }) -> W (see phon-ru.js)
//   normWord(word, lang)      vowelCount(W)      stressedSyllable(W) -> index or -1
import { analyzeEn, normEn } from './phon-en.js';
import { analyzeRu, normRu } from './phon-ru.js';
import { analyzeKa, normKa } from './phon-ka.js';

export const LANGS = ['en', 'ru', 'ka'];
const WORD_RE = {
  en: /[A-Za-z]+(?:['’][A-Za-z]+)*(?:(?<=s)['’](?![A-Za-z]))?|['’](?:tis|twas|gainst|neath)\b/gi,
  ru: /[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*/g,
  ka: /[ა-ჿ]+(?:-[ა-ჿ]+)*/g,
};

export function detectLang(text) {
  const s = String(text || '');
  const n = { ka: (s.match(/[ა-ჿ]/g) || []).length, ru: (s.match(/[а-яё]/gi) || []).length, en: (s.match(/[a-z]/gi) || []).length };
  return Object.entries(n).sort((a, b) => b[1] - a[1])[0][1] ? Object.entries(n).sort((a, b) => b[1] - a[1])[0][0] : 'en';
}

export function tokenize(line, lang) {
  const re = new RegExp(WORD_RE[lang] || WORD_RE.en);
  const out = [];
  let m;
  while ((m = re.exec(line))) out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

export const normWord = (w, lang) => (lang === 'ru' ? normRu(w) : lang === 'ka' ? normKa(w) : normEn(w));

export function analyzeWord(word, lang, opts = {}) {
  if (lang === 'ru') return analyzeRu(word, opts);
  if (lang === 'ka') return analyzeKa(word, opts);
  return analyzeEn(word, opts);
}

export const vowelCount = (W) => W.syl.filter((s) => s.v >= 0).length;
export const stressedSyllable = (W) => W.stress;
