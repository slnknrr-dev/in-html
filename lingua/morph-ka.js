// lingua/morph-ka.js - Georgian words taken apart before (and beside) the dictionary: preverbs, derivational
// prefixes and circumfixes (მე-…-ე trades, სა-…-ე / სა-…-ო places and purposes, უ-…-ო "without", სი-…-ე
// qualities, ნა-…-ი results, მ-…-ელი / -არი doers, უ-…-ესი superlatives), suffixes (-ობა, -ური / -ული, -ელი,
// -იანი, -ოვანი, -ეთი, diminutives, participles, masdar endings), the plural, cases and postpositions; roots from the
// dictionary (kartuli-lexicon.js) and the word families (roots-ka.js). Every reading names its probable rule.
// Search by preverb, prefix, root or suffix over the attested words, with register labels, and the possible words
// of a root built by the rules — attested or not, with what the rule makes them mean.
//
//   parseKa(word, { max }) -> [reading]                         (morph.js readings)
//   PREVERBS_KA, PREFIXES_KA, SUFFIXES_KA: inventories with { s, gloss, tag }
//   rootsKa() -> [{ s, alt, pos, gloss, words: [{ w, mean, labels }] }]
//   attestedKa(word) -> labels | null       (the word itself, its lemma in the dictionary, or a family word)
//   wordsKa() -> [{ w, mean, labels, root, parts, rule }]   every attested word with its best reading
//   searchKa({ preverb, prefix, root, suffix, text, filter }) -> [word]
//   possibleKa(root) -> [{ w, rule, mean, attested, labels }]   the words the rules can build from a root

import { createMorph, labelsFromTier, parseFlags } from './morph.js';
import { lexicon, lexByWord } from './kartuli-lexicon.js';
import { analyzeWord } from './kartuli-grammar.js';
import { KA_FAMILIES } from './roots-ka.js';

// Design: Georgian is agglutinative with circumfixes, so the slot order is preverb, prefix, root (1..2: compounds),
// suffix (0..2), plural, case ending, postposition. Circumfixes are not single items: the prefix and the suffix are
// separate pieces and the RULES pair them (sa- + -e), which keeps the inventories small and lets a half circumfix
// still parse. Inventory tables below: header comments only.

const G = (ru, en) => ({ ru, en });

export const PREVERBS_KA = [
  ['ა', 'вверх; совершённость', 'up; perfective'], ['ჩა', 'вниз, внутрь', 'down, into'], ['გა', 'наружу, сквозь', 'out, through'], ['შე', 'внутрь', 'in'],
  ['წა', 'прочь, отсюда', 'away'], ['მი', 'туда, к (от говорящего)', 'thither'], ['მო', 'сюда, к говорящему', 'hither'], ['და', 'вниз, на; совершённость', 'down onto; perfective'],
  ['გადა', 'через, пере-', 'over, across'], ['ამო', 'вверх изнутри', 'up out of'], ['ჩამო', 'вниз сюда', 'down hither'], ['გამო', 'наружу сюда', 'out hither'],
  ['შემო', 'внутрь сюда', 'in hither'], ['წამო', 'отсюда вместе (сюда)', 'away hither'], ['გადმო', 'через сюда', 'over hither'], ['მიმო', 'туда-сюда', 'to and fro'],
  ['აღ', 'вверх (книжн.)', 'up (bookish)'], ['წარ', 'вперёд (книжн.)', 'forth (bookish)'], ['გან', 'от- (книжн.)', 'away (bookish)'], ['აღმო', 'вверх изнутри (книжн.)', 'up out (bookish)'],
].map(([s, ru, en]) => ({ s, tag: 'pv', gloss: G(ru, en), w: s.length > 2 ? 0.3 : 0 }));

export const PREFIXES_KA = [
  ['მე', 'agent', 'ремесло, занятие (с -ე)', 'trade (with -e)'], ['სა', 'sa', 'место, назначение (с -ე / -ო / -ელი)', 'place, purpose'],
  ['უ', 'u', 'без (с -ო); самый (с -ესი)', 'without (with -o); most (with -esi)'], ['სი', 'si', 'качество (с -ე)', 'quality (with -e)'],
  ['ნა', 'na', 'результат, бывшее (с -ი / -არი)', 'result, former'], ['მ', 'm', 'деятель, причастие (с -ელი / -არი)', 'doer, participle'],
  ['მა', 'm', 'деятель, причастие', 'doer, participle'], ['მო', 'mo', 'причастие, деятель (с -ე)', 'participle (with -e)'],
  ['თანა', 'co', 'со-, вместе', 'co-, together'], ['წინა', 'pre', 'перед-, пред-', 'fore-'], ['არა', 'neg', 'не-', 'non-'], ['ურთიერთ', 'mutual', 'взаимо-', 'mutual'],
].map(([s, tag, ru, en]) => ({ s, tag, gloss: G(ru, en) }));

export const SUFFIXES_KA = [
  ['ე', 'e', 'суффикс -е (с მე- / სა- / სი- / მო-)', 'suffix -e'], ['ო', 'o', 'суффикс -о (с უ- / სა-)', 'suffix -o'],
  ['ობა', 'oba', 'состояние, занятие, совокупность', 'state, activity'], ['ებ', 'eb', 'тематический суффикс', 'thematic suffix'],
  ['ება', 'eba', 'масдар (действие)', 'masdar (action)'], ['ვა', 'va', 'масдар (действие)', 'masdar (action)'], ['ა', 'a', 'масдар / основа на -а', 'masdar / stem -a'],
  ['ურ', 'uri', 'относящийся к', 'relating to'], ['ულ', 'uri', 'относящийся к (после р)', 'relating to (after r)'], ['ელ', 'eli', 'житель, деятель', 'inhabitant, doer'],
  ['ალ', 'ari', 'деятель', 'doer'], ['არ', 'ari', 'деятель, результат', 'doer, result'], ['იან', 'iani', 'имеющий, с', 'having'], ['ოვან', 'iani', 'имеющий, полный', 'full of'],
  ['ეთ', 'eti', 'страна, край', 'land'], ['ეს', 'esi', 'превосходная степень', 'superlative'], ['ებულ', 'part', 'причастие: претерпевший', 'passive participle'],
  ['ილ', 'part', 'причастие, результат', 'participle'], ['ავ', 'av', 'тематический / для -', 'thematic; for'], ['ამ', 'am', 'тематический суффикс', 'thematic suffix'],
  ['უნა', 'dim', 'уменьшительное', 'diminutive'], ['იკო', 'dim', 'уменьшительное', 'diminutive'], ['ილა', 'dim', 'уменьшительное', 'diminutive'], ['ჩა', 'dim', 'уменьшительное', 'diminutive'],
  ['ებელ', 'ebel', 'деятель; то, что предстоит', 'doer; what is to be'], ['ველ', 'eli', 'этноним, житель', 'ethnonym'], ['ელობა', 'oba', 'занятие, ремесло', 'occupation'], ['ეულ', 'uri', 'относящийся к', 'relating to'],
].map(([s, tag, ru, en]) => ({ s, tag, gloss: G(ru, en) }));

const ENDINGS = [['ი', 'nom', 'им. п.', 'nominative'], ['მა', 'erg', 'эргатив', 'ergative'], ['მ', 'erg', 'эргатив', 'ergative'], ['ს', 'dat', 'дат. п.', 'dative'],
  ['ის', 'gen', 'род. п.', 'genitive'], ['ით', 'ins', 'твор. п.', 'instrumental'], ['ად', 'adv', 'обстоят. п.', 'adverbial'], ['ო', 'voc', 'зват. п.', 'vocative'], ['ს', 'dat', 'дат. п.', 'dative']]
  .map(([s, tag, ru, en]) => ({ s, tag, gloss: G(ru, en), w: -0.1 }));
const POSTS = [['ში', 'в', 'in'], ['ზე', 'на, о', 'on, about'], ['თან', 'у, с', 'at, with'], ['დან', 'из, от', 'from'], ['ით', 'с помощью', 'with'], ['ვით', 'как', 'like'],
  ['თვის', 'для', 'for'], ['მდე', 'до', 'until'], ['კენ', 'к', 'towards'], ['გან', 'от, из', 'from, of'], ['ებრ', 'как (книжн.)', 'like (bookish)']]
  .map(([s, ru, en]) => ({ s, tag: 'post', gloss: G(ru, en) }));
const PLURAL = [{ s: 'ებ', tag: 'pl', gloss: G('мн. ч.', 'plural') }];

const RULES = [
  { id: 'ka.agent', need: { prefix: ['agent'], suffix: ['e'] }, pos: 'n', name: G('ме-…-е: ремесло', 'me-…-e: trade'), mean: G('тот, кто занимается: {root}', 'one whose trade is: {root}') },
  { id: 'ka.placeE', need: { prefix: ['sa'], suffix: ['e'] }, pos: 'n', name: G('са-…-е: предназначение', 'sa-…-e: purpose'), mean: G('предназначенное для: {root}', 'meant for: {root}') },
  { id: 'ka.placeO', need: { prefix: ['sa'], suffix: ['o'] }, pos: 'n', name: G('са-…-о: место', 'sa-…-o: place'), mean: G('место или вещь для: {root}', 'place or thing for: {root}') },
  { id: 'ka.country', need: { prefix: ['sa'], suffix: ['eti'] }, pos: 'n', name: G('са-…-ети: страна', 'sa-…-eti: land'), mean: G('страна, край: {root}', 'land of: {root}') },
  { id: 'ka.future', need: { prefix: ['sa'], suffix: ['ebel', 'av'] }, pos: 'n', name: G('са-…-ели / -ави: то, что предстоит', 'sa-…-eli: what is to be'), mean: G('то, что предстоит / для того, чтобы: {root}', 'what is to be: {root}') },
  { id: 'ka.without', need: { prefix: ['u'], suffix: ['o'] }, pos: 'a', name: G('у-…-о: лишённость', 'u-…-o: privative'), mean: G('без: {root}', 'without: {root}') },
  { id: 'ka.superl', need: { prefix: ['u'], suffix: ['esi'] }, pos: 'a', name: G('у-…-еси: превосходная степень', 'u-…-esi: superlative'), mean: G('самый: {root}', 'most: {root}') },
  { id: 'ka.quality', need: { prefix: ['si'], suffix: ['e'] }, pos: 'n', name: G('си-…-е: качество', 'si-…-e: quality'), mean: G('качество: {root}', 'quality: {root}') },
  { id: 'ka.result', need: { prefix: ['na'] }, pos: 'n', name: G('на-…-и: результат', 'na-…-i: result'), mean: G('результат, то, что было: {root}', 'result of: {root}') },
  { id: 'ka.doer', need: { prefix: ['m'], suffix: ['eli', 'ari', 'ebel'] }, pos: 'n', name: G('м-…-ели / -ари: деятель', 'm-…-eli: doer'), mean: G('тот, кто: {root}', 'one who: {root}') },
  { id: 'ka.mo', need: { prefix: ['mo'], suffix: ['e'] }, pos: 'n', name: G('мо-…-е: деятель', 'mo-…-e: doer'), mean: G('тот, кто (постоянно): {root}', 'one who: {root}') },
  { id: 'ka.trade', need: { prefix: ['agent'], suffix: ['oba'] }, prio: 1, pos: 'n', name: G('ме-…-е-оба: ремесло', 'me-…-e-oba: craft'), mean: G('ремесло, занятие: {root}', 'craft of: {root}') },
  { id: 'ka.oba', need: { suffix: ['oba'] }, pos: 'n', name: G('-оба: состояние', '-oba: state'), mean: G('состояние, занятие: {root}', 'state, activity: {root}') },
  { id: 'ka.adj', need: { suffix: ['uri'] }, pos: 'a', name: G('-ури / -ули: относящийся', '-uri: relating'), mean: G('относящийся к: {root}', 'relating to: {root}') },
  { id: 'ka.origin', need: { suffix: ['eli'] }, not: { prefix: true }, pos: 'n', name: G('-ели: житель', '-eli: inhabitant'), mean: G('житель, родом из: {root}', 'from: {root}') },
  { id: 'ka.having', need: { suffix: ['iani'] }, pos: 'a', name: G('-иани: обладание', '-iani: having'), mean: G('имеющий, с: {root}', 'having: {root}') },
  { id: 'ka.dim', need: { suffix: ['dim'] }, pos: 'n', name: G('уменьшительное', 'diminutive'), mean: G('маленький, милый: {root}', 'little: {root}') },
  { id: 'ka.part', need: { suffix: ['part'] }, pos: 'a', name: G('причастие', 'participle'), mean: G('тот, с кем сделано: {root}', 'that has been: {root}') },
  { id: 'ka.masdarPv', need: { preverb: true, suffix: ['eba', 'va', 'a'] }, pos: 'v', name: G('преверб + масдар', 'preverb + masdar'), mean: G('действие ({pv}): {root}', 'action ({pv}): {root}') },
  { id: 'ka.masdar', need: { suffix: ['eba', 'va'] }, pos: 'v', name: G('масдар', 'masdar'), mean: G('действие: {root}', 'action: {root}') },
  { id: 'ka.pvForm', need: { preverb: true }, pos: 'v', name: G('преверб', 'preverb'), mean: G('{pv}: {root}', '{pv}: {root}') },
  { id: 'ka.post', need: { post: true }, pos: 'form', name: G('послелог', 'postposition'), mean: G('{post}: {root}', '{post}: {root}') },
  { id: 'ka.case', need: { ending: true }, pos: 'form', name: G('падежная форма', 'case form'), mean: G('{root} ({ending})', '{root} ({ending})') },
];

// --- roots and attested words ---
// A meaning containing '(другой корень)' marks a word listed under a root it does not belong to (shown for contrast):
// attested, but not a family member. A meaning of '?' marks a doubtful form: a family member, not attested.
const OTHER = /\(другой корень\)/;
let ROOTS = null, ATT = null;
// The root of a dictionary word: the ending and the masdar suffix off, and for verbs the preverb too. The longest
// preverb wins, but only if at least 4 letters remain (protects short verbs whose first letters merely look like a
// preverb). One regex pass strips one suffix: a heuristic stem, good enough as an inventory seed.
function stemOf(w, pos) {
  let s = w;
  if (pos === 'v') {
    const pv = PREVERBS_KA.filter((p) => s.startsWith(p.s) && s.length - p.s.length >= 4).sort((x, y) => y.s.length - x.s.length)[0];
    if (pv) s = s.slice(pv.s.length);
  }
  return s.replace(/(ება|ობა|ვა|ა|ი|ე|ო|უ)$/, '') || s;
}
export function rootsKa() {
  if (ROOTS) return ROOTS;
  ROOTS = [];
  ATT = new Map();
  const byS = new Map();
  for (const line of KA_FAMILIES.split('\n')) {
    if (!line.trim()) continue;
    const [s, alt, pos, ru, en, words] = line.split('|');
    const r = { s, alt: alt ? alt.split(',') : [], pos, gloss: G(ru, en), words: [] };
    for (const item of (words || '').split(';').filter(Boolean)) {
      const m = /^([^=]+)=([^!]*)(.*)$/.exec(item);
      if (!m) continue;
      const w = m[1].trim(), mean = m[2].trim(), flags = parseFlags(m[3]);
      const labels = { use: flags.use || 'common', norm: flags.norm || (mean === '?' ? 'questionable' : 'norm'), lit: flags.lit || 'neutral', own: false };
      if (labels.norm === 'questionable') labels.lit = 'unattested';
      if (!OTHER.test(mean)) r.words.push({ w, mean: G(mean.replace(/^\?$/, ''), ''), labels });
      if (labels.norm !== 'questionable') ATT.set(w, { labels, mean: G(mean.replace(OTHER, '').trim(), '') });
    }
    ROOTS.push(r);
    byS.set(s, r);
  }
  // Two sources of roots: curated families (weight 0.4 in morph()) and stems cut from dictionary headwords (fromLex,
  // weighted by length). A headword stem that contains a family root is not added, otherwise every derived word would
  // become its own root and the parser would always prefer the one-piece reading.
  const familyRoots = ROOTS.flatMap((r) => [r.s, ...r.alt]);
  // The dictionary: its headwords are attested, their stems are roots.
  for (const e of lexicon()) {
    const labels = labelsFromTier(e.tier);
    if (!ATT.has(e.w)) ATT.set(e.w, { labels, mean: G(e.ru, e.en) });
    if (e.pos === 'n' || e.pos === 'a' || e.pos === 'v' || e.pos === 'np') {
      const s = stemOf(e.w.split(/[\s-]/)[0], e.pos);
      // A dictionary word built on a family root (საჭმელი on ჭამ / ჭმ) is analysed, not taken as a root itself.
      const built = s.length > 4 && familyRoots.some((f) => f.length >= 3 && f !== s && s.includes(f));
      if (s.length >= 2 && !byS.has(s) && !built) { const r = { s, alt: [], pos: e.pos === 'np' ? 'p' : e.pos, gloss: G(e.ru.split(';')[0], e.en.split(';')[0]), words: [{ w: e.w, mean: G(e.ru, e.en), labels }], fromLex: true }; ROOTS.push(r); byS.set(s, r); }
    }
  }
  return ROOTS;
}
// Exact word first, then any lemma the grammar analyser recognises (inflected forms inherit the lemma's labels).
export function attestedKa(word) {
  rootsKa();
  const w = String(word).trim();
  if (ATT.has(w)) return ATT.get(w).labels;
  const lemma = analyzeWord(w).find((h) => h.lex && ATT.has(h.lex.w));
  return lemma ? ATT.get(lemma.lex.w).labels : null;
}

let M = null;
function morph() {
  if (M) return M;
  // Family roots weigh more than stems cut from dictionary words; short dictionary stems weigh little.
  const roots = rootsKa().map((r) => ({ s: r.s, alt: r.alt, pos: r.pos, gloss: r.gloss, w: r.fromLex ? (r.s.length <= 2 ? -2.5 : r.s.length === 3 ? -0.6 : 0) : 0.4 }));
  M = createMorph({
    // Normalisation keeps only Mkhedruli and the Georgian extension block (U+10D0..U+10FF): spaces, hyphens and Latin
    // are dropped, so a parse never sees a character the inventories cannot contain.
    lang: 'ka', norm: (w) => String(w).trim().replace(/[^ა-ჿ]/g, ''),
    slots: [
      { role: 'preverb', items: PREVERBS_KA, max: 1 },
      { role: 'prefix', items: PREFIXES_KA, max: 1 },
      { role: 'root', items: roots, min: 1, max: 2 },
      { role: 'suffix', items: SUFFIXES_KA, max: 2 },
      { role: 'plural', items: PLURAL, max: 1 },
      { role: 'ending', items: ENDINGS, max: 1 },
      { role: 'post', items: POSTS, max: 1 },
    ],
    rules: RULES, attested: attestedKa, unknownRoot: { min: 2, penalty: 3.2 },
  });
  return M;
}
export const parseKa = (word, opts) => morph().parse(word, opts);

// --- search and possible words ---
let WORDS = null;
export function wordsKa() {
  if (WORDS) return WORDS;
  rootsKa();
  WORDS = [];
  for (const [w, a] of ATT) {
    if (/\s/.test(w)) continue;
    const r = parseKa(w, { max: 1 })[0];
    WORDS.push({ w, mean: a.mean, labels: a.labels, reading: r || null });
  }
  return WORDS;
}
const partOf = (r, role) => (r ? r.parts.filter((p) => p.role === role).map((p) => p.s) : []);
// Linear filter over wordsKa(). A root query also matches by substring of the word, so words whose best parse picked
// another root are still found. The label filter duplicates morph.js matchLabels.
export function searchKa({ preverb = '', prefix = '', root = '', suffix = '', text = '', filter = null, limit = 300 } = {}) {
  const out = [];
  for (const x of wordsKa()) {
    const r = x.reading;
    if (preverb && !partOf(r, 'preverb').includes(preverb)) continue;
    if (prefix && !partOf(r, 'prefix').includes(prefix)) continue;
    if (suffix && !partOf(r, 'suffix').includes(suffix)) continue;
    if (root && !(partOf(r, 'root').includes(root) || x.w.includes(root))) continue;
    if (text && !(x.w.includes(text) || (x.mean ? x.mean.ru + ' ' + x.mean.en : '').toLowerCase().includes(text.toLowerCase()))) continue;
    if (filter && !['use', 'norm', 'lit'].every((k) => !filter[k] || !filter[k].length || filter[k].includes(x.labels[k]))) continue;
    out.push(x);
    if (out.length >= limit) break;
  }
  return out;
}

// Templates of the productive rules; ური becomes ული after a root with რ (dissimilation).
// [rule, template, parts of speech it applies to (n noun, a adjective, v verb, p place name), productive: a new
// word by it is a correct formation; otherwise it is questionable until attested]
const NOMINAL = [
  ['ka.agent', (r) => 'მე' + r + 'ე', 'n', true], ['ka.placeE', (r) => 'სა' + r + 'ე', 'n', false], ['ka.placeO', (r) => 'სა' + r + 'ო', 'nv', false], ['ka.without', (r) => 'უ' + r + 'ო', 'n', true],
  ['ka.oba', (r) => r + 'ობა', 'na', true], ['ka.having', (r) => r + 'იანი', 'n', true], ['ka.adj', (r) => r + (/რ/.test(r) ? 'ული' : 'ური'), 'n', true], ['ka.origin', (r) => r + 'ელი', 'p', true],
  ['ka.quality', (r) => 'სი' + r + 'ე', 'a', true], ['ka.superl', (r) => 'უ' + r + 'ესი', 'a', true], ['ka.result', (r) => 'ნა' + r + 'ი', 'v', false], ['ka.dim', (r) => r + 'უნა', 'n', false],
];
// Applies the templates allowed for the root's part of speech; a non-productive template's unattested result is
// downgraded to questionable.
// KNOWN DEFECT: `add` silently returns on a duplicate word, yet out[out.length - 1] is then taken as the template's
// result, so the downgrade can hit an unrelated earlier entry (an attested-family word is safe only because
// x.attested / x.labels.own guard it). Fix: have add() return the pushed record (or null) and use that.
function addTemplates(r, out, add) {
  for (const [id, f, pos, productive] of NOMINAL) {
    if (!pos.includes(r.pos)) continue;
    add(f(r.s), id);
    const x = out[out.length - 1];
    if (x && !x.attested && x.labels.own && !productive) x.labels = { ...x.labels, norm: 'questionable' };
  }
}
export function possibleKa(rootS) {
  const r = rootsKa().find((x) => x.s === rootS || x.alt.includes(rootS));
  if (!r) return [];
  const out = [];
  const add = (w, ruleId) => {
    if (out.some((x) => x.w === w)) return;
    const rule = RULES.find((x) => x.id === ruleId);
    const att = attestedKa(w);
    const fam = r.words.find((x) => x.w === w);
    out.push({ w, rule: rule ? rule.name : null, mean: fam && fam.mean ? fam.mean : rule ? { ru: rule.mean.ru.replace('{root}', r.gloss.ru).replace('{pv}', ''), en: rule.mean.en.replace('{root}', r.gloss.en).replace('{pv}', '') } : null,
      attested: !!att, labels: att || (fam ? fam.labels : { use: 'rare', norm: 'norm', lit: 'unattested', own: true }) });
  };
  // Verbs: the base is the family word written without a preverb (else the first word); every preverb up to 4 letters
  // is tried on it, and any unattested result is marked questionable, because preverb + verb combinations are lexical,
  // not predictable. The loop `if (!x.mean && x.rule === null) x.mean = null` is a no-op (it only normalises a falsy
  // mean to null).
  if (r.pos === 'v') {
    const base = (r.words.find((x) => !PREVERBS_KA.some((p) => x.w.startsWith(p.s) && x.w.length > p.s.length + r.s.length - 1) && x.w.startsWith(r.s)) || r.words[0] || {}).w;
    for (const x of r.words) add(x.w, null);
    addTemplates(r, out, add);
    if (base) for (const p of PREVERBS_KA) if (p.s.length <= 4) add(p.s + base, 'ka.masdarPv');
    for (const x of out) if (!x.mean && x.rule === null) x.mean = null;
    for (const x of out) if (!x.attested && x.labels.own) { x.labels = { use: 'rare', norm: 'questionable', lit: 'unattested', own: true }; const pv = PREVERBS_KA.find((p) => x.w.startsWith(p.s)); x.mean = { ru: (pv ? pv.gloss.ru + ': ' : '') + r.gloss.ru, en: (pv ? pv.gloss.en + ': ' : '') + r.gloss.en }; }
  } else {
    for (const x of r.words) add(x.w, null);
    addTemplates(r, out, add);
  }
  return out;
}
