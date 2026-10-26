// lingua/morph-ru.js - Russian words taken apart before (and beside) the dictionary: prefixes, the root (from the
// word families of roots-ru.js and the inventory of russian.js), derivational and formative suffixes with their
// meaning, the ending and the postfix (-ся / -сь / -те); every reading names its probable rule ("без- + дом + -н-:
// without a house"). Attested words carry register labels (substandard ложить, colloquial домище, bookish
// просвещение …); a well-formed word that no source attests is marked as such with its meaning by rule.
//
//   parseRu(word, { max }) -> [reading]        rootsRu() -> roots with families      attestedRu(word) -> labels | null
//   wordsRu() -> attested words with readings  searchRu({ prefix, root, suffix, text, filter }) -> [word]
//   possibleRu(root) -> [{ w, rule, mean, attested, labels }]
//   PREFIXES_RU, SUFFIXES_RU

import { createMorph, parseFlags } from './morph.js';
import { PREFIXES as P0, ROOTS as R0, ENDINGS as E0 } from './russian.js';
import { RU_FAMILIES } from './roots-ru.js';

// Design: slot order prefix (0..2), root, interfix + second root (compounds), suffix (0..4), ending, postfix. ё is
// folded to е in norm(): dictionaries and inventories are written mostly without ё, and a comparison form must
// not depend on whether the writer used it. Inventories reuse russian.js tables (P0 / R0 / E0) plus additions;
// data tables below: header comments only.

const G = (ru, en) => ({ ru, en });
const norm = (w) => String(w).toLowerCase().replace(/ё/g, 'е').trim();

export const PREFIXES_RU = [
  ...P0.map((p) => ({ s: p.s, tag: p.s, gloss: G(p.ru, p.en) })),
  ...[['пред', 'перед, заранее', 'before'], ['сверх', 'сверх, выше нормы', 'super-'], ['анти', 'против', 'anti-'], ['контр', 'против', 'counter-'], ['ре', 'снова', 're-'],
    ['со', 'вместе', 'co-'], ['все', 'всё-, вездe', 'all-'], ['небез', 'не без', 'not without'], ['при', 'при-, рядом', 'near'], ['междо', 'между', 'inter-'], ['меж', 'между', 'inter-'],
    ['раз', 'в разные стороны', 'apart'], ['разо', 'в разные стороны', 'apart'], ['изо', 'изнутри', 'out of'], ['взо', 'вверх', 'up'], ['подо', 'под', 'under'], ['надо', 'над', 'over'], ['ото', 'от', 'away']]
    .map(([s, ru, en]) => ({ s, tag: s, gloss: G(ru, en) })),
];

const S = (list, tag, ru, en) => list.split(' ').map((s) => ({ s, tag, gloss: G(ru, en) }));
export const SUFFIXES_RU = [
  ...S('тель итель атель тел ител ател', 'agent', 'деятель', 'doer'), ...S('ник щик чик ец лец ист арь ун ок', 'agent', 'лицо, деятель', 'person, doer'),
  ...S('ость есть изн от ств еств', 'quality', 'качество, состояние', 'quality'), ...S('ни ени ани ти', 'action', 'действие', 'action'),
  ...S('к очк ечк оньк еньк ик ушк юшк ец иц', 'dim', 'уменьшительное, ласковое', 'diminutive'), ...S('ищ', 'augm', 'большое, грубоватое', 'augmentative'),
  ...S('ск еск ическ ческ', 'rel', 'относящийся к', 'relating to'), ...S('н ен ан онн енн', 'adj', 'признак, связь', 'adjective'), ...S('ов ев ин', 'poss', 'из чего / чей', 'of, made of'),
  ...S('лив ив чив', 'prone', 'склонный к', 'prone to'), ...S('ова ева ирова', 'vb', 'глагол от имени', 'verb from a noun'), ...S('ыва ива ва', 'iter', 'несовершенный вид, повторность', 'imperfective'),
  ...S('ну', 'semel', 'однократность', 'once'), ...S('а я и е о у', 'theme', 'основа, тематическая гласная', 'stem vowel'), ...S('л', 'past', 'прошедшее время', 'past'),
  ...S('ущ ющ ащ ящ', 'pres', 'действительное причастие наст. вр.', 'present participle'), ...S('вш ш', 'pastp', 'действительное причастие прош. вр.', 'past participle'),
  ...S('ем им', 'passp', 'страдательное причастие наст. вр.', 'passive participle'), ...S('т', 'passp', 'страдательное причастие', 'passive participle'), ...S('ч', 'alt', 'основа с чередованием', 'alternation'),
  ...S('енец', 'agent', 'лицо по действию', 'person'), ...S('ениц ниц', 'fem', 'женский род', 'feminine'), ...S('ниц', 'place', 'место', 'place'),
];
// Endings deduped by Set; infinitive markers (-ть / -ти / -чь) get tag 'inf' so the verb rules can require them.
const ENDINGS = [...new Set([...E0.map((e) => e.s), 'ть', 'ти', 'чь', 'ый', 'ий', 'ой', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'а', 'я', 'о', 'е', 'ы', 'и', 'у', 'ю', 'ом', 'ем', 'ах', 'ях', 'ам', 'ям', 'ешь', 'ет', 'ем', 'ете', 'ут', 'ют', 'ит', 'ат', 'ят', 'ишь', 'им', 'ите'])]
  .map((s) => ({ s, tag: /т[ьи]$|чь$/.test(s) ? 'inf' : 'end', gloss: /т[ьи]$|чь$/.test(s) ? G('инфинитив', 'infinitive') : G('окончание', 'ending'), w: -0.05 }));
const POSTFIX = [{ s: 'ся', tag: 'refl', gloss: G('возвратность', 'reflexive') }, { s: 'сь', tag: 'refl', gloss: G('возвратность', 'reflexive') }, { s: 'те', tag: 'pl', gloss: G('повелит. мн. ч.', 'plural imperative') }];

const RULES = [
  { id: 'ru.compound', need: { interfix: true }, prio: 2, pos: 'n', name: G('сложное слово', 'compound'), mean: G('сложение основ: {root}', 'compound: {root}') },
  { id: 'ru.agent', need: { suffix: ['agent'] }, pos: 'n', name: G('лицо по действию', 'agent noun'), mean: G('тот, кто: {root}', 'one who: {root}') },
  { id: 'ru.quality', need: { suffix: ['quality'] }, pos: 'n', name: G('отвлечённое качество', 'abstract quality'), mean: G('качество, состояние: {root}', 'quality: {root}') },
  { id: 'ru.action', need: { suffix: ['action'] }, pos: 'n', name: G('название действия', 'action noun'), mean: G('действие: {root}', 'act of: {root}') },
  { id: 'ru.dim', need: { suffix: ['dim'] }, pos: 'n', name: G('уменьшительное', 'diminutive'), mean: G('маленькое, ласковое: {root}', 'little: {root}') },
  { id: 'ru.augm', need: { suffix: ['augm'] }, prio: 1, pos: 'n', name: G('увеличительное', 'augmentative'), mean: G('большое, грубоватое: {root}', 'big: {root}') },
  { id: 'ru.rel', need: { suffix: ['rel'] }, pos: 'a', name: G('относительное прилагательное', 'relational adjective'), mean: G('относящийся к: {root}', 'relating to: {root}') },
  { id: 'ru.without', need: { prefix: ['без', 'бес'], suffix: ['adj'] }, prio: 1, pos: 'a', name: G('без- … -н-: лишённость', 'without'), mean: G('без: {root}', 'without: {root}') },
  { id: 'ru.adj', need: { suffix: ['adj'] }, pos: 'a', name: G('прилагательное', 'adjective'), mean: G('связанный с: {root}', 'of: {root}') },
  { id: 'ru.poss', need: { suffix: ['poss'] }, pos: 'a', name: G('притяжательное / вещественное', 'possessive / material'), mean: G('из чего / чей: {root}', 'of, made of: {root}') },
  { id: 'ru.prone', need: { suffix: ['prone'] }, pos: 'a', name: G('склонность', 'propensity'), mean: G('склонный к: {root}', 'prone to: {root}') },
  { id: 'ru.iter', need: { suffix: ['iter'] }, pos: 'v', name: G('несовершенный вид', 'imperfective'), mean: G('делать многократно, длительно: {root}', 'keep doing: {root}') },
  { id: 'ru.semel', need: { suffix: ['semel'] }, pos: 'v', name: G('однократность', 'semelfactive'), mean: G('сделать один раз: {root}', 'do once: {root}') },
  { id: 'ru.pres', need: { suffix: ['pres'] }, pos: 'a', name: G('причастие', 'participle'), mean: G('тот, кто сейчас: {root}', 'who is: {root}') },
  { id: 'ru.pastp', need: { suffix: ['pastp'] }, pos: 'a', name: G('причастие прош. вр.', 'past participle'), mean: G('тот, кто: {root} (прош.)', 'who did: {root}') },
  { id: 'ru.passp', need: { suffix: ['passp'] }, pos: 'a', name: G('страдательное причастие', 'passive participle'), mean: G('тот, с кем это делают: {root}', 'being: {root}') },
  { id: 'ru.vb', need: { suffix: ['vb'] }, pos: 'v', name: G('глагол от имени', 'verb from a noun'), mean: G('делать, заниматься: {root}', 'do: {root}') },
  { id: 'ru.neg', need: { prefix: ['не'] }, prio: 1, pos: 'a', name: G('отрицание не-', 'negation'), mean: G('не: {root}', 'not: {root}') },
  { id: 'ru.prefVerb', need: { prefix: true, ending: ['inf'] }, pos: 'v', name: G('приставочный глагол', 'prefixed verb'), mean: G('{prefix}: {root}', '{prefix}: {root}') },
  { id: 'ru.refl', need: { postfix: ['refl'] }, pos: 'v', name: G('возвратный глагол', 'reflexive verb'), mean: G('{root} (себя, друг друга, само)', '{root} (oneself)') },
  { id: 'ru.verb', need: { ending: ['inf'] }, pos: 'v', name: G('инфинитив', 'infinitive'), mean: G('действие: {root}', 'to: {root}') },
  { id: 'ru.pref', need: { prefix: true }, pos: 'form', name: G('приставка', 'prefix'), mean: G('{prefix}: {root}', '{prefix}: {root}') },
  { id: 'ru.form', need: { ending: true }, pos: 'form', name: G('форма слова', 'word form'), mean: G('{root}', '{root}') },
];

let ROOTS = null, ATT = null;
// Parses RU_FAMILIES once. '!x' (a word of another root, listed for contrast) is detected only as the exact flag
// string 'x', so 'x' combined with other flags would be read as a family member. Roots of russian.js not in the
// families join as 'old' roots with weight 0 (no pos, no family).
export function rootsRu() {
  if (ROOTS) return ROOTS;
  ROOTS = [];
  ATT = new Map();
  const seen = new Set();
  for (const line of RU_FAMILIES.split('\n')) {
    if (!line.trim()) continue;
    const [s, alt, pos, ru, en, words] = line.split('|');
    const r = { s, alt: alt ? alt.split(',').filter((x) => x && x !== s) : [], pos, gloss: G(ru, en), words: [] };
    for (const item of (words || '').split(',').filter(Boolean)) {
      const [w, fl = ''] = item.trim().split('!');
      const f = parseFlags(fl);
      const other = fl === 'x';
      const labels = { use: f.use || 'common', norm: f.norm || 'norm', lit: f.lit || (f.norm === 'substandard' ? 'unattested' : 'neutral'), own: false };
      if (!other) r.words.push({ w: norm(w), mean: null, labels });
      if (!ATT.has(norm(w))) ATT.set(norm(w), { labels: other ? { use: 'common', norm: 'norm', lit: 'neutral', own: false } : labels });
    }
    ROOTS.push(r);
    seen.add(s);
  }
  for (const r of R0) if (!seen.has(r.s)) { ROOTS.push({ s: r.s, alt: r.alt || [], pos: '', gloss: G(r.ru, r.en), words: [], old: true }); seen.add(r.s); }
  return ROOTS;
}
// A word or another form of it: the stems (the word without its ending) are compared. ENDS is sorted longest first,
// so stemRu strips the longest ending that leaves at least 3 letters. The stem index is built lazily and reset by
// addAttestedRu. Over-matching is possible (two different words with one stem share labels); accepted for labels.
const ENDS = [...new Set([...E0.map((e) => e.s), 'ть', 'ти', 'ый', 'ий', 'ой', 'ая', 'ое', 'ые', 'ие', 'а', 'я', 'о', 'е', 'ы', 'и', 'у', 'ю', 'ь', 'ом', 'ем', 'ах', 'ях', 'ам', 'ям', 'ов', 'ев', 'ей', 'ет', 'ит', 'ут', 'ют', 'ат', 'ят', 'ла', 'ли', 'ло', 'л'])].sort((a, b) => b.length - a.length);
const stemRu = (w) => { for (const e of ENDS) if (w.endsWith(e) && w.length - e.length >= 3) return w.slice(0, -e.length); return w; };
let STEMS = null;
export function attestedRu(word) {
  rootsRu();
  const w = norm(word);
  const a = ATT.get(w);
  if (a) return a.labels;
  if (!STEMS) { STEMS = new Map(); for (const [x, v] of ATT) if (!STEMS.has(stemRu(x))) STEMS.set(stemRu(x), v); }
  const b = STEMS.get(stemRu(w));
  return b ? b.labels : null;
}
// More attested words (a course dictionary): standard and neutral unless labels are given.
export function addAttestedRu(words, labels = { use: 'common', norm: 'norm', lit: 'neutral', own: false }) {
  rootsRu();
  let n = 0;
  for (const w of words) if (w && !ATT.has(norm(w))) { ATT.set(norm(w), { labels }); n++; }
  if (n) { WORDS = null; STEMS = null; }
  return n;
}

let M = null;
// Called twice (first and second root slot): two independent item arrays, so a trie is built for each.
const ROOT_ITEMS = () => rootsRu().map((r) => ({ s: norm(r.s), alt: r.alt.map(norm), pos: r.pos, gloss: r.gloss, w: r.old ? 0 : 0.3 }));
const morph = () => M || (M = createMorph({
  lang: 'ru', norm,
  slots: [
    { role: 'prefix', items: PREFIXES_RU, max: 2 },
    { role: 'root', items: ROOT_ITEMS(), min: 1, max: 1 },
    // Compounds: a linking vowel and a second root (снег-о-пад, пар-о-ход).
    { role: 'interfix', items: [{ s: 'о', tag: 'link', gloss: G('соединительная гласная', 'linking vowel') }, { s: 'е', tag: 'link', gloss: G('соединительная гласная', 'linking vowel') }], max: 1, after: 'root' },
    { role: 'root', items: ROOT_ITEMS(), max: 1, after: 'interfix', gain: 2 },
    { role: 'suffix', items: SUFFIXES_RU, max: 4 },
    { role: 'ending', items: ENDINGS, max: 1 },
    { role: 'postfix', items: POSTFIX, max: 1 },
  ],
  rules: RULES, attested: attestedRu, unknownRoot: { min: 2, penalty: 3.5 },
}));
export const parseRu = (w, o) => morph().parse(w, o);

let WORDS = null;
export function wordsRu() {
  if (WORDS) return WORDS;
  rootsRu();
  WORDS = [...ATT].filter(([w]) => !/\s/.test(w)).map(([w, a]) => ({ w, labels: a.labels, mean: null, reading: parseRu(w, { max: 1 })[0] || null }));
  return WORDS;
}
const partOf = (r, role) => (r ? r.parts.filter((p) => p.role === role).map((p) => p.s) : []);
// Same shape as searchEn / searchKa: linear filter over wordsRu() with family membership as a fallback for roots.
export function searchRu({ prefix = '', root = '', suffix = '', text = '', filter = null, limit = 300 } = {}) {
  const out = [];
  for (const x of wordsRu()) {
    const r = x.reading;
    if (prefix && !partOf(r, 'prefix').includes(prefix)) continue;
    if (suffix && !partOf(r, 'suffix').includes(suffix)) continue;
    if (root) { const R = rootsRu().find((y) => y.s === root); const forms = R ? [R.s, ...R.alt] : [root]; if (!partOf(r, 'root').some((s) => forms.includes(s)) && !(R && R.words.some((y) => y.w === x.w))) continue; }
    if (text && !x.w.includes(norm(text))) continue;
    if (filter && !['use', 'norm', 'lit'].every((k) => !filter[k] || !filter[k].length || filter[k].includes(x.labels[k]))) continue;
    out.push(x);
    if (out.length >= limit) break;
  }
  return out;
}

// Prefixes tried on a verb root in possibleRu; the order is the display order.
const VERB_PREFIXES = ['по', 'за', 'вы', 'пере', 'до', 'на', 'от', 'при', 'про', 'раз', 'с', 'у', 'под', 'об', 'в', 'из'];
export function possibleRu(rootS) {
  const r = rootsRu().find((x) => x.s === rootS || x.alt.includes(rootS));
  if (!r) return [];
  const out = [];
  const add = (w, ruleId) => {
    w = norm(w);
    if (out.some((x) => x.w === w)) return;
    const att = attestedRu(w);
    const rule = RULES.find((x) => x.id === ruleId);
    out.push({ w, attested: !!att, rule: rule ? rule.name : null, mean: rule ? { ru: rule.mean.ru.replace('{root}', r.gloss.ru).replace(/\{\w+\}/g, '').trim(), en: rule.mean.en.replace('{root}', r.gloss.en).replace(/\{\w+\}/g, '').trim() } : null,
      labels: att || { use: 'rare', norm: ruleId === 'ru.prefVerb' ? 'questionable' : 'norm', lit: 'unattested', own: true } });
  };
  for (const x of r.words) add(x.w, null);
  const base = r.words.find((x) => /т[ьи]$|чь$/.test(x.w) && !VERB_PREFIXES.some((p) => x.w.startsWith(p) && x.w.length > p.length + 3));
  if (r.pos === 'v' && base) for (const p of VERB_PREFIXES) {
    // разо- / со- / обо- before two consonants; раз- / из- become рас- / ис- before a voiceless consonant.
    let glue = /^[бвгджзйклмнпрстфхцчшщ]{2}/.test(base.w) && /[бвзд]$|^с$/.test(p) ? (p === 'с' ? 'со' : p + 'о') : p;
    if (/з$/.test(glue) && /^[кпстфхцчшщ]/.test(base.w)) glue = glue.slice(0, -1) + 'с';
    add(glue + base.w, 'ru.prefVerb');
  }
  if (r.pos === 'a') { add(r.s + 'ость', 'ru.quality'); add('не' + r.s + 'ый', 'ru.neg'); }
  if (r.pos === 'n') { add(r.s + 'ище', 'ru.augm'); add(r.s + 'ок', 'ru.dim'); add('без' + r.s + 'ный', 'ru.without'); add(r.s + 'ский', 'ru.rel'); add(r.s + 'ник', 'ru.agent'); }
  return out;
}
