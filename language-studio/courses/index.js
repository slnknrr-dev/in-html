// language-studio/courses/index.js - the courses (eight in COURSES: Sanskrit, Georgian, Mingrelian, Japanese, Chinese,
// Korean, Russian, English) and helpers over their data (texts in the explanation language, item ids for spaced
// repetition, the dictionary of a course).
// Order of COURSES = order of the cards on the home page.
import en from './en.js';
import ja from './ja.js';
import ka from './ka.js';
import ru from './ru.js';
import sa from './sa.js';
import zh from './zh.js';
import xmf from './xmf.js';
import ko from './ko.js';
import { lexicon } from '../../lingua/kartuli-lexicon.js';
import { translit } from '../../lingua/kartuli.js';
import { SECTIONS_EN } from './adv-en.js';
import { SECTIONS_RU } from './adv-ru.js';
import { SECTIONS_KA } from './adv-ka.js';
import { SECTIONS_JA, SECTIONS_KO, SECTIONS_SA, SECTIONS_ZH } from './adv-asia.js';

export const COURSES = [sa, ka, xmf, ja, zh, ko, ru, en];
export const courseById = (id) => COURSES.find((c) => c.id === id) || null;

// C1 / C2 lessons (adv-*.js) and the cross-language tool and letter game (xl-tools.js, xl-games.js) join every course.
const ADVANCED = { en: SECTIONS_EN, ru: SECTIONS_RU, ka: SECTIONS_KA, sa: SECTIONS_SA, ja: SECTIONS_JA, zh: SECTIONS_ZH, ko: SECTIONS_KO };
const CROSS_SCRIPT = ['ka', 'xmf', 'ru', 'ko', 'sa', 'en'];
// Mutates the course objects once at import (ES modules evaluate once, so this runs once per page). The includes()
// guards keep it idempotent anyway, e.g. if a course file already lists 'xl'. Copies (spread) rather than push, so
// arrays shared between course definitions are not modified behind their backs.
for (const c of COURSES) {
  if (ADVANCED[c.id]) c.sections = [...c.sections, ...ADVANCED[c.id]];
  if (!c.tools.includes('xl')) c.tools = [...c.tools, 'xl'];
  if (CROSS_SCRIPT.includes(c.id) && !(c.games || []).includes('x-letters')) c.games = [...(c.games || []), 'x-letters'];
}

// Text of { ru, en, zh, ja } in the explanation language (falls back to the course's first one, then any).
export function pick(obj, lang, course) {
  if (obj == null) return '';
  if (typeof obj === 'string') return obj;
  return obj[lang] ?? (course ? obj[course.explain[0]] : undefined) ?? Object.values(obj)[0] ?? '';
}

// SRS item ids embed course, section and the word itself (not an index): reordering lessons keeps progress; editing
// a word's spelling or moving it to another section starts it fresh (test.js checks ids are unique).
export const wordId = (course, section, w) => `${course.id}:${section.id}:${w.w}`;
export const letterId = (course, script, l) => `${course.id}:${script.id}:${l.ch}`;

// Every word of the course: [{ id, w, tr, m, note, section }]; a course with `lexicon` adds the big Georgian
// dictionary (lingua/kartuli-lexicon.js) after its lesson words.
const LEX_SECTION = { id: 'lex' };
// Lesson words win over lexicon entries of the same spelling (`seen`): the lesson version carries the curated
// translation and notes. Computed on demand, not cached: the lexicon is large and most visits never open the dictionary.
export function dictionary(course) {
  const out = [];
  const seen = new Set();
  for (const s of course.sections) {
    for (const w of s.words || []) out.push({ ...w, id: wordId(course, s, w), section: s });
    for (const b of s.blocks || []) for (const w of b.ex || []) out.push({ ...w, id: wordId(course, s, w), section: s });
  }
  if (course.lexicon) {
    for (const w of out) seen.add(w.w);
    for (const e of lexicon()) if (!seen.has(e.w)) out.push({ w: e.w, tr: translit(e.w, 'lat'), m: { ru: e.ru, en: e.en }, id: wordId(course, LEX_SECTION, e), section: LEX_SECTION, lex: e.id });
  }
  return out;
}

// Items for spaced repetition: words of 'words' sections and the letters of every script.
export function srsItems(course) {
  const items = [];
  for (const s of course.sections) if (s.kind === 'words') for (const w of s.words) items.push({ id: wordId(course, s, w), kind: 'word', w, section: s });
  for (const sc of course.scripts) for (const l of sc.letters) items.push({ id: letterId(course, sc, l), kind: 'letter', l, script: sc });
  return items;
}
