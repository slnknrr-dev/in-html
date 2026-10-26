// lingua/kartuli-grammar.js - Georgian grammar over the lexicon (kartuli-lexicon.js): full noun paradigms (seven cases,
// the -ებ- plural and the old -ნი / -თა plural, postpositions with the case they attach to), adjective agreement,
// pronouns, the verb in all three series (present / future, aorist / optative / imperative, perfect / pluperfect)
// with person prefixes and suffixes, versions, inversion, suppletive verbs, the case frame of each verb class in
// each series, and a word-form analyser (reverse lookup through generated forms).
//
//   declineNoun(lex | word) -> { kind, stem, red, sg: [{ id, form, parts }], pl, old, post: [{ id, form, parts, num }] }
//   adjAgree(adj, caseId) -> form of an attributive adjective      PRONOUNS, pronounForm(p, caseId)
//   conjugate(lex, screeve, s, o?) -> { form, parts, derived } | null        s, o: '1sg' … '3pl'
//   verbTable(lex, screeve, o?) -> [{ s, form, parts } | { s, form: null }]
//   caseFrame(lex, screeve) -> { series, subj, obj, io, inverted, note }
//   analyzeWord(word) -> [{ lemma, lex, pos, tags, parts, gloss, score }]      formIndex() -> Map(form -> [hit])
//   SCREEVES_ALL, SERIES, CASE_IDS, POSTS: ids with { ka, ru, en }
//
// Forms come from stored principal parts (present, future, aorist, optative, perfect, pluperfect 3sg); a form not
// stored is derived by rule from the present stem and flagged `derived` so the interface can say so. Verbs whose
// series cannot be derived reliably simply have no forms there.
//
// Key decisions:
// - Principal parts + rules, the way Georgian is taught and lexicographed: the 3sg of each screeve group is stored
//   (lexicon flags p, f, a, o, pf, pp, ...) and the other persons are generated. Pure rule derivation of all series
//   from the present fails for a large share of verbs (preverb choice, aorist stem alternations, thematic suffix loss).
// - "Fail closed": a form that cannot be built returns null and is shown as missing; a wrong form taught to a learner
//   is worse than a gap. Derived (non-stored) forms carry `derived` so the UI can mark them.
// - Analysis = reverse lookup in an index of every generated form (formIndex), storing compact recipes and rebuilding
//   parts lazily (hitOf). Memory: one Map over all forms, built once on first analysis; parts are not stored.
// - Lexicon objects are memoised in place (lex._pp) to avoid recomputing principal parts during index building.

import { lexicon, lexByWord } from './kartuli-lexicon.js';

export const PERSONS = ['1sg', '2sg', '3sg', '1pl', '2pl', '3pl'];
const PI = (p) => PERSONS.indexOf(p);
const P = (s, role, tag) => (tag ? { s, role, tag } : { s, role });
const join = (parts) => parts.map((p) => p.s).join('');
const VOW = 'აეიოუ';
const isV = (c) => VOW.includes(c);

// --- nouns -------------------------------------------------------------------------------------------------------
export const CASE_IDS = ['nom', 'erg', 'dat', 'gen', 'ins', 'adv', 'voc'];

// Postpositions written together with the noun: s, the case the noun takes, and how that case is cut before it.
export const POSTS = [
  { id: 'shi', s: 'ში', base: 'dat', ru: 'в', en: 'in, into' },
  { id: 'ze', s: 'ზე', base: 'dat', ru: 'на; о', en: 'on; about' },
  { id: 'tan', s: 'თან', base: 'dat', ru: 'у, рядом, вместе с', en: 'at, near, with' },
  { id: 'tvis', s: 'თვის', base: 'gen', ru: 'для', en: 'for' },
  { id: 'gan', s: 'გან', base: 'gen', ru: 'от, из (источник, материал)', en: 'from (source), made of' },
  { id: 'ken', s: 'კენ', base: 'gen', ru: 'к, в сторону', en: 'towards' },
  { id: 'vit', s: 'ვით', base: 'dat', ru: 'как, подобно', en: 'like' },
  { id: 'dan', s: 'დან', base: 'ins', ru: 'из, от (откуда), с (какого времени)', en: 'from (where, since when)' },
  { id: 'mde', s: 'მდე', base: 'adv', ru: 'до', en: 'up to, until' },
  { id: 'mebr', s: 'მებრ', base: 'gen', ru: 'согласно (книжное: ბრძანებისამებრ «согласно приказу»)', en: 'according to (bookish)' },
];

// Separate postpositions (words after the noun) and the case they govern.
export const POST_WORDS = {
  'შესახებ': 'gen', 'გამო': 'gen', 'მიერ': 'gen', 'შემდეგ': 'gen', 'წინ': 'gen', 'უკან': 'gen', 'გარეშე': 'gen', 'ნაცვლად': 'gen', 'მაგივრად': 'gen',
  'გარდა': 'gen', 'შორის': 'gen', 'ირგვლივ': 'gen', 'მიუხედავად': 'gen', 'თანახმად': 'gen', 'დროს': 'gen', 'წინააღმდეგ': 'gen', 'მიმართ': 'gen',
  'ქვეშ': 'gen', 'გვერდით': 'gen', 'შიგნით': 'gen', 'გარეთ': 'gen', 'მახლობლად': 'gen', 'ახლოს': 'gen', 'ზემოთ': 'gen', 'ქვემოთ': 'gen', 'მერე': 'gen', 'მსგავსად': 'gen', 'მიხედვით': 'gen',
  'გაყოლებით': 'gen', 'მაგიერ': 'gen', 'თანავე': 'dat', 'მიღმა': 'gen',
};

// Reduced stem by syncope: the last a / e / o before the final consonant drops (მეგობარ -> მეგობრ, ფანჯარ -> ფანჯრ).
export function syncope(stem) {
  const m = /^(.*[^აეიოუ])([აეო])([^აეიოუ])$/.exec(stem);
  return m ? m[1] + m[3] : stem;
}

// Stem class from the citation form + lexicon flags: C (consonant stem, nom -ი), A (-ა), E (-ე), O (-ო/-უ, or -ი with
// flag v: a vowel stem ending in ი like ტაქსი). trunc: A/E stems that lose their vowel before -ის/-ით (unless flag n,
// non-truncating, typical for proper names and loans). red: syncopated stem, flag s = true (apply the rule) or an
// explicit string (irregular reduction).
function nounInfo(x) {
  const lex = typeof x === 'string' ? lexByWord(x).find((l) => ['n', 'np', 'a', 'v'].includes(l.pos)) || { w: x, flags: {} } : x;
  const w = lex.w;
  const f = lex.flags || {};
  const last = w.slice(-1);
  let kind, stem;
  if (last === 'ი' && w.length > 2 && !f.v) { kind = 'C'; stem = w.slice(0, -1); }
  else if (last === 'ა') { kind = 'A'; stem = w.slice(0, -1); }
  else if (last === 'ე') { kind = 'E'; stem = w.slice(0, -1); }
  else if (last === 'ო' || last === 'უ' || (last === 'ი' && f.v)) { kind = 'O'; stem = w; }
  else { kind = 'C'; stem = w; }
  const trunc = (kind === 'A' || kind === 'E') && !f.n;
  const red = f.s ? (f.s === true ? syncope(kind === 'C' || kind === 'A' ? stem : w) : f.s) : null;
  return { lex, w, kind, stem, trunc, red, flags: f };
}

// Singular case forms: { id: parts }.
function sgParts({ w, kind, stem, trunc, red }) {
  const R = red || stem;
  const full = kind === 'C' ? stem : w; // the stem with its final vowel
  const C = {};
  if (kind === 'C') {
    C.nom = [P(stem, 'stem'), P('ი', 'case', 'nom')];
    C.erg = [P(stem, 'stem'), P('მა', 'case', 'erg')];
    C.dat = [P(stem, 'stem'), P('ს', 'case', 'dat')];
    C.gen = [P(R, 'stem'), P('ის', 'case', 'gen')];
    C.ins = [P(R, 'stem'), P('ით', 'case', 'ins')];
    C.adv = [P(R, 'stem'), P('ად', 'case', 'adv')];
    C.voc = [P(stem, 'stem'), P('ო', 'case', 'voc')];
  } else {
    const tr = trunc ? (red || stem) : full;
    C.nom = [P(full, 'stem')];
    C.erg = [P(full, 'stem'), P('მ', 'case', 'erg')];
    C.dat = [P(full, 'stem'), P('ს', 'case', 'dat')];
    C.gen = trunc ? [P(tr, 'stem'), P('ის', 'case', 'gen')] : [P(full, 'stem'), P('ს', 'case', 'gen')];
    C.ins = trunc ? [P(tr, 'stem'), P('ით', 'case', 'ins')] : [P(full, 'stem'), P(full.endsWith('ი') ? 'თ' : 'თი', 'case', 'ins')];
    C.adv = [P(full, 'stem'), P('დ', 'case', 'adv')];
    C.voc = kind === 'O' ? [P(full, 'stem')] : [P(full, 'stem'), P('ვ', 'case', 'voc')];
  }
  return C;
}

// Postposition forms over the case parts of a number (sg or pl).
// The host case ending is truncated, not appended to: dat -ს drops before -ში/-ზე (სახლში), and before -თან only for
// consonant-like stems (დედასთან keeps -ს); -ვით takes -ი- after consonants and a linking -ა- after vowels; ins -ით
// -> -ი (სახლიდან), adv -ად -> -ა (სახლამდე). Plural forms behave like consonant stems (they end in -ებ).
function postParts(C, kind, plural) {
  const consonantLike = plural || kind === 'C';
  return POSTS.map((pp) => {
    let parts = C[pp.base].map((p) => ({ ...p }));
    const last = parts[parts.length - 1];
    const isCase = last.role === 'case';
    if (pp.base === 'dat' && isCase) {
      if (pp.id === 'vit') { if (consonantLike) last.s = 'ი'; else parts.push(P('ა', 'link')); }
      else if (pp.id !== 'tan' || consonantLike) parts.pop();
    }
    if (pp.base === 'ins' && isCase) { last.s = last.s === 'თი' || last.s === 'თ' ? '' : 'ი'; }
    if (pp.base === 'adv' && isCase) { last.s = last.s === 'ად' ? 'ა' : ''; }
    if (pp.id === 'mebr') parts.push(P('ა', 'link'));
    parts = parts.filter((p) => p.s);
    parts.push(P(pp.s, 'post', pp.id));
    return { id: pp.id, form: join(parts), parts, num: plural ? 'pl' : 'sg' };
  });
}

export function declineNoun(x) {
  const info = nounInfo(x);
  const { kind, stem, red, w, flags } = info;
  const C = sgParts(info);
  const sg = CASE_IDS.map((id) => ({ id, form: join(C[id]), parts: C[id] }));
  // -ებ- plural: the stem without -ი / -ა (with syncope), -ე / -ო / -უ stems keep their vowel
  const plStem = flags.pl || (kind === 'C' || kind === 'A' ? red || stem : w);
  const PE = {};
  for (const [id, e] of [['nom', 'ი'], ['erg', 'მა'], ['dat', 'ს'], ['gen', 'ის'], ['ins', 'ით'], ['adv', 'ად'], ['voc', 'ო']]) PE[id] = [P(plStem, 'stem'), P('ებ', 'plural'), P(e, 'case', id)];
  const pl = CASE_IDS.map((id) => ({ id, form: join(PE[id]), parts: PE[id] }));
  // old plural (bookish, poetry, set phrases): -ნი in the nominative, -თა in the oblique cases, -ნო in the vocative
  const oStem = kind === 'C' ? stem : w;
  const old = [['nom', 'ნი'], ['erg', 'თა'], ['dat', 'თა'], ['gen', 'თა'], ['voc', 'ნო']].map(([id, e]) => { const parts = [P(oStem, 'stem'), P(e, 'case', id)]; return { id, form: join(parts), parts }; });
  const post = [...postParts(C, kind, false), ...postParts(PE, kind, true)];
  return { kind, stem, red, w, sg, pl, old, post, noPlural: !!flags.np };
}

// Attributive adjective before a noun: consonant stems -ი / -მა / ø / -ი / -ი / ø / -ო, vowel stems unchanged.
const ADJ_END = { nom: 'ი', erg: 'მა', dat: '', gen: 'ი', ins: 'ი', adv: '', voc: 'ო' };
export function adjAgree(adj, caseId) {
  const w = typeof adj === 'string' ? adj : adj.w;
  if (!w.endsWith('ი')) return w;
  return w.slice(0, -1) + ADJ_END[caseId];
}
// the case an attribute takes before a postposition: the base case of the postposition
export const postBase = (id) => (POSTS.find((p) => p.id === id) || {}).base || 'dat';

// --- pronouns ----------------------------------------------------------------------------------------------------
// Data table. Missing cases fall back to the nominative (pronounForm); 1st/2nd person pronouns are indeed invariant.
export const PRONOUNS = [
  { w: 'მე', person: '1sg', forms: { nom: 'მე', erg: 'მე', dat: 'მე', gen: 'ჩემი' }, ru: 'я', en: 'I' },
  { w: 'შენ', person: '2sg', forms: { nom: 'შენ', erg: 'შენ', dat: 'შენ', gen: 'შენი' }, ru: 'ты', en: 'you' },
  { w: 'ის', person: '3sg', forms: { nom: 'ის', erg: 'მან', dat: 'მას', gen: 'მისი', ins: 'მით' }, ru: 'он, она, оно; тот', en: 'he, she, it; that' },
  { w: 'იგი', person: '3sg', forms: { nom: 'იგი', erg: 'მან', dat: 'მას', gen: 'მისი' }, ru: 'он, она (книжн.)', en: 'he, she (bookish)' },
  { w: 'ეს', person: '3sg', forms: { nom: 'ეს', erg: 'ამან', dat: 'ამას', gen: 'ამის', ins: 'ამით' }, ru: 'этот, это', en: 'this' },
  { w: 'ეგ', person: '3sg', forms: { nom: 'ეგ', erg: 'მაგან', dat: 'მაგას', gen: 'მაგის' }, ru: 'тот (у тебя)', en: 'that (by you)' },
  { w: 'ჩვენ', person: '1pl', forms: { nom: 'ჩვენ', erg: 'ჩვენ', dat: 'ჩვენ', gen: 'ჩვენი' }, ru: 'мы', en: 'we' },
  { w: 'თქვენ', person: '2pl', forms: { nom: 'თქვენ', erg: 'თქვენ', dat: 'თქვენ', gen: 'თქვენი' }, ru: 'вы', en: 'you (pl.)' },
  { w: 'ისინი', person: '3pl', forms: { nom: 'ისინი', erg: 'მათ', dat: 'მათ', gen: 'მათი' }, ru: 'они', en: 'they' },
  { w: 'ესენი', person: '3pl', forms: { nom: 'ესენი', erg: 'ამათ', dat: 'ამათ', gen: 'ამათი' }, ru: 'эти', en: 'these' },
  { w: 'ვინ', person: '3sg', q: true, forms: { nom: 'ვინ', erg: 'ვინ', dat: 'ვის', gen: 'ვისი' }, ru: 'кто', en: 'who' },
  { w: 'რა', person: '3sg', q: true, forms: { nom: 'რა', erg: 'რამ', dat: 'რას', gen: 'რისი', ins: 'რით' }, ru: 'что', en: 'what' },
];
export const pronounForm = (p, caseId) => (p.forms[caseId] || p.forms.nom);
export const PERSON_PRONOUN = { '1sg': 'მე', '2sg': 'შენ', '3sg': 'ის', '1pl': 'ჩვენ', '2pl': 'თქვენ', '3pl': 'ისინი' };

// --- verbs -------------------------------------------------------------------------------------------------------
// Screeves (მწკრივები) by series. Series I: present and future subseries; series II: aorist, optative (and the
// imperative = aorist 2nd person); series III: perfect and pluperfect.
export const SCREEVES_ALL = [
  { id: 'present', series: 1, ka: 'აწმყო', ru: 'настоящее', en: 'present' },
  { id: 'imperfect', series: 1, ka: 'უწყვეტელი', ru: 'имперфект (длилось)', en: 'imperfect' },
  { id: 'presSubj', series: 1, ka: 'აწმყოს კავშირებითი', ru: 'сослагательное настоящего', en: 'present subjunctive' },
  { id: 'future', series: 1, ka: 'მყოფადი', ru: 'будущее', en: 'future' },
  { id: 'conditional', series: 1, ka: 'ხოლმეობითი / პირობითი', ru: 'условное («сделал бы»)', en: 'conditional' },
  { id: 'futSubj', series: 1, ka: 'მყოფადის კავშირებითი', ru: 'сослагательное будущего', en: 'future subjunctive' },
  { id: 'aorist', series: 2, ka: 'წყვეტილი', ru: 'аорист (сделал)', en: 'aorist' },
  { id: 'optative', series: 2, ka: 'II კავშირებითი', ru: 'оптатив («пусть сделает», «должен сделать»)', en: 'optative' },
  { id: 'imperative', series: 2, ka: 'ბრძანებითი', ru: 'повелительное', en: 'imperative' },
  { id: 'perfect', series: 3, ka: 'I თურმეობითი', ru: 'перфект («оказывается, сделал»)', en: 'perfect (evidential)' },
  { id: 'pluperfect', series: 3, ka: 'II თურმეობითი', ru: 'плюсквамперфект («сделал бы, должен был»)', en: 'pluperfect' },
];
export const SERIES = Object.fromEntries(SCREEVES_ALL.map((s) => [s.id, s.series]));

// Stored forms mark the preverb boundary with '-' (და-წერს): split -> [preverb, body]. The hyphen never reaches output.
// AOR_T types: e = class I weak aorist (-ე, 3sg -ა), i = strong aorist in -ი (3sg -ო/-ა), ii / ie = class II aorists.
const split = (f) => { const i = f.indexOf('-'); return i < 0 ? ['', f] : [f.slice(0, i), f.slice(i + 1)]; };
const TSUF = ['ებ', 'ობ', 'ავ', 'ამ', 'ევ'];
// aorist endings by type: [1/2 sg, 1/2 pl, 3pl, optative vowel]
const AOR_T = { e: ['ე', 'ეთ', 'ეს', 'ო'], i: ['ი', 'ით', 'ეს', 'ა'], ii: ['ი', 'ით', 'ნენ', 'ე'], ie: ['ე', 'ეთ', 'ნენ', 'ო'] };
const OPT3PL = { 'ო': 'ონ', 'ა': 'ან', 'ე': 'ენ' };

// cells: one per person { pv, stem, mark, end }; mark is the screeve marker (-დ-, -ოდ-) shown as its own part
const cells6 = (pv, stem, mark, ends) => PERSONS.map((p, i) => ({ pv, stem, mark, end: ends[i] }));

// The present-type paradigm of a 3sg form: class I endings (-ს, -ენ / -ან) or class II endings (-ა, -იან).
function presentCells(f3) {
  const [pv, b] = split(f3);
  if (b.endsWith('ს')) { const st = b.slice(0, -1); return { pv, stem: st, type: 1, cells: cells6(pv, st, '', ['', '', 'ს', 'თ', 'თ', st.endsWith('ი') ? 'ან' : 'ენ']) }; }
  if (b.endsWith('ა')) { const st = b.slice(0, -1); return { pv, stem: st, type: 2, cells: cells6(pv, st, '', ['ი', 'ი', 'ა', 'ით', 'ით', 'იან']) }; }
  return null;
}
// Imperfect-type paradigm (imperfect / conditional) and its subjunctive, from the present cells or a stored 3sg.
function pastCells(pres, stored3) {
  let pv, st, mark;
  if (stored3) {
    const [p, b] = split(stored3);
    pv = p;
    const s = b.replace(/ა$/, '');
    const m = /(ოდ|დ)$/.exec(s);
    st = m ? s.slice(0, -m[1].length) : s; mark = m ? m[1] : '';
  } else if (pres) { pv = pres.pv; st = pres.stem; mark = pres.type === 1 ? 'დ' : 'ოდ'; } else return null;
  return { impf: cells6(pv, st, mark, ['ი', 'ი', 'ა', 'ით', 'ით', 'ნენ']), subj: cells6(pv, st, mark, ['ე', 'ე', 'ეს', 'ეთ', 'ეთ', 'ნენ']) };
}

// Strip a version vowel (ა-/ი- before a consonant) and a thematic suffix to get the bare root; the length guards
// keep at least two root letters (otherwise "ებ" would eat short roots).
function rootOf(stem) {
  const r = stem.replace(/^[აი](?=[^აეიოუ])/, '');
  const ts = TSUF.find((t) => r.endsWith(t) && r.length > t.length + 1);
  if (ts) return { root: r.slice(0, -ts.length), ts };
  return r.endsWith('ი') && r.length > 2 ? { root: r.slice(0, -1), ts: 'ი' } : { root: r, ts: '' };
}

// Principal parts of a verb, stored or derived: { c, present, future, imperfect, conditional, aorist, aorist1,
// aorType, optative, perfect, pluperfect, pvo, derived: Set(screeve) }
// Derivation rules when a part is missing (each marks `derived`):
// - future = preverb + present (class I/III); class III without preverb forms the future as ი-ROOT-ებს (თამაშობს ->
//   ითამაშებს);
// - class I/III aorist = (pv-) [version vowel] root + ა (3sg), class III without preverb ი-root-ა;
// - perfect = (pv-) უ-root + ავს/ამს/ებია/ია by thematic suffix, pluperfect = (pv-) ე-root + ა / ებინა;
// - class II -ება verbs: aorist = pv + stem + ა.
// Flags d / da / dp = false switch derivation off for verbs where these rules are known to fail.
// Result cached on lex._pp (mutates the lexicon entry; safe because lexicon entries are module-owned).
export function principalParts(lex) {
  if (lex._pp) return lex._pp;
  const f = lex.flags || {};
  const c = lex.c || 1;
  const d = new Set();
  const out = { c, present: f.p || null, imperfect: f.i || null, future: f.f || null, conditional: f.fi || null, aorist: f.a || null, aorist1: f.a1 || null, aorType: f.at || null, optative: f.o || null, perfect: f.pf || null, pluperfect: f.pp || null, pvo: f.pvo || null, derived: d };
  const pv = f.pv || '';
  const pres = out.present ? split(out.present)[1] : '';
  if (!out.future && out.present && c !== 4) {
    if (pv) out.future = pv + '-' + pres;
    else if (c === 3 && pres.endsWith('ს')) { out.future = 'ი' + rootOf(pres.slice(0, -1)).root + 'ებს'; d.add('future'); }
  }
  if ((c === 1 || c === 3) && pres.endsWith('ს') && f.d !== false) {
    const stem = pres.slice(0, -1);
    const rt = rootOf(stem);
    const bare = rt.root.replace(/^[ჰს](?=[^აეიოუ])/, '');
    if (!out.aorist && f.da !== false) {
      out.aorist = c === 3 && !pv ? 'ი' + rt.root + 'ა' : (pv ? pv + '-' : '') + (/^[აი][^აეიოუ]/.test(stem) ? stem[0] : '') + rt.root + 'ა';
      d.add('aorist'); d.add('optative');
    }
    if (!out.perfect && f.dp !== false) { out.perfect = (pv ? pv + '-' : '') + 'უ' + bare + (c === 3 ? 'ია' : rt.ts === 'ავ' || rt.ts === 'ამ' ? rt.ts + 'ს' : rt.ts === 'ებ' ? 'ებია' : 'ია'); d.add('perfect'); }
    if (!out.pluperfect && f.dp !== false) { out.pluperfect = (pv ? pv + '-' : '') + 'ე' + bare + (rt.ts === 'ებ' && c === 1 ? 'ებინა' : 'ა'); d.add('pluperfect'); }
  } else if (c === 2 && pres.endsWith('ება') && !out.aorist && pv) {
    out.aorist = pv + '-' + pres.slice(0, -3) + 'ა'; d.add('aorist'); d.add('optative');
  }
  if (!out.aorType && out.aorist) out.aorType = c === 2 ? (split(out.aorist)[1][0] === 'ი' ? 'ie' : 'ii') : 'e';
  lex._pp = out;
  return out;
}

// The shape of a screeve: { cells } (regular agreement), { inv, f3 } (inverted: the subject is shown by the object
// prefixes) or { table } (suppletive), or null when the form does not exist here.
// Class IV (indirect verbs: უყვარს, აქვს) are always inverted: the stored 3sg is reused and only the prefix changes;
// missing subjunctive/conditional forms are made from imperfect/future by ending swaps. Series III of classes I/III
// is likewise inverted. Aorist: 1st/2nd persons may use a different stem (aorist1, e.g. ვწერე vs დაწერა) than 3rd;
// the imperative is the aorist 2nd person, other cells null. Optative 3pl ending follows the optative vowel.
function screeveSpec(lex, screeve) {
  const sup = SUPPLETIVE[lex.w];
  if (sup) return sup[screeve] ? { table: sup[screeve] } : null;
  const pp = principalParts(lex);
  if (pp.c === 4) {
    const f3 = { present: pp.present, imperfect: pp.imperfect, future: pp.future, aorist: pp.aorist, optative: pp.optative, perfect: pp.perfect, pluperfect: pp.pluperfect }[screeve]
      || (screeve === 'presSubj' && pp.imperfect && pp.imperfect.endsWith('და') ? pp.imperfect.replace(/ა$/, 'ეს') : null)
      || (screeve === 'conditional' && pp.future && pp.future.endsWith('ა') ? pp.future.replace(/ა$/, 'ოდა') : null)
      || (screeve === 'futSubj' && pp.future && pp.future.endsWith('ა') ? pp.future.replace(/ა$/, 'ოდეს') : null);
    return f3 ? { inv: true, f3 } : null;
  }
  if (screeve === 'present' || screeve === 'imperfect' || screeve === 'presSubj') {
    const pres = pp.present ? presentCells(pp.present) : null;
    if (screeve === 'present') return pres ? { cells: pres.cells } : null;
    const past = pastCells(pres, pp.imperfect);
    return past ? { cells: screeve === 'imperfect' ? past.impf : past.subj } : null;
  }
  if (screeve === 'future' || screeve === 'conditional' || screeve === 'futSubj') {
    if (!pp.future) return null;
    const fut = presentCells(pp.future);
    const derived = pp.derived.has('future');
    if (screeve === 'future') return fut ? { cells: fut.cells, derived } : null;
    const past = pastCells(fut, pp.conditional);
    return past ? { cells: screeve === 'conditional' ? past.impf : past.subj, derived } : null;
  }
  if (screeve === 'aorist' || screeve === 'optative' || screeve === 'imperative') {
    if (!pp.aorist) return null;
    const T = AOR_T[pp.aorType] || AOR_T.e;
    const [pv, b3] = split(pp.aorist);
    const v3 = b3.slice(-1), st3 = b3.slice(0, -1);
    const st1 = pp.aorist1 ? split(pp.aorist1)[1].replace(/^ვ/, '').replace(/[აეიოუ]$/, '') : st3;
    const derived = pp.derived.has('aorist');
    if (screeve !== 'optative') {
      const cells = PERSONS.map((p, i) => ({ pv, stem: i === 2 || i === 5 ? st3 : st1, mark: '', end: [T[0], T[0], v3, T[1], T[1], T[2]][i] }));
      return { cells: screeve === 'imperative' ? cells.map((c, i) => (i === 1 || i === 4 ? c : null)) : cells, derived };
    }
    let opv = pv, ost = st3, ov = T[3];
    if (pp.optative) { const [p2, ob] = split(pp.optative); opv = p2; ov = ob.slice(-2, -1); ost = ob.slice(0, -2); }
    const pl3 = pp.c === 2 && ov === 'ე' ? 'ნენ' : OPT3PL[ov];
    return { cells: cells6(opv, ost, '', [ov, ov, ov + 'ს', ov + 'თ', ov + 'თ', pl3]), derived: derived && !pp.optative };
  }
  if (screeve === 'perfect' || screeve === 'pluperfect') {
    if (pp.c === 2) return null;
    const f3 = screeve === 'perfect' ? pp.perfect : pp.pluperfect;
    return f3 ? { inv: true, f3, derived: pp.derived.has(screeve) } : null;
  }
  return null;
}

const OBJ_PRE = { '1sg': 'მ', '2sg': 'გ', '1pl': 'გვ', '2pl': 'გ' };

// stem parts: the version vowel (a- i- u- e- before a consonant), the root, the thematic suffix
// The masdar test avoids mis-segmenting a root that genuinely starts with that vowel (ანთებს from ანთება: the ა is
// part of the root, visible because the masdar starts with it too). Display-only: forms do not depend on it.
function stemParts(stem, masdar = '') {
  const out = [];
  let s = stem;
  if (/^[აიუე][^აეიოუ]/.test(s) && s.length > 2 && masdar[0] !== s[0]) { out.push(P(s[0], 'version')); s = s.slice(1); }
  const ts = TSUF.find((t) => s.endsWith(t) && s.length > t.length + 1);
  if (ts) out.push(P(s.slice(0, -ts.length), 'root'), P(ts, 'ts'));
  else out.push(P(s, 'root'));
  return out;
}

// One regular cell -> parts. Prefix slot competition as in kartuli.js verbForm: a 1st/2nd person object marker wins
// over subject ვ-; flag m3 verbs have a 3rd-person object prefix ჰ-/ს- (სთხოვს) that is peeled off the stem and
// re-added only when no other prefix takes the slot. With a 1st/2nd object the objective უ- becomes ი-, and some
// verbs change preverb (pvo: მი- -> მო- "towards me/you").
function regular(cell, s, o, lex, pvo, version) {
  if (!cell) return null;
  let { pv, stem } = cell;
  let end = cell.end;
  let m3 = '';
  if (lex.flags && lex.flags.m3 && /^[ჰს][^აეიოუ]/.test(stem)) { m3 = stem[0]; stem = stem.slice(1); }
  // versions: objective (for someone: უ- / ი- with a 1st or 2nd person), subjective (for oneself: ი-)
  if (version === 'objective' || version === 'subjective') {
    const v = version === 'subjective' || (o && o[0] !== '3') ? 'ი' : 'უ';
    stem = /^[აიუ][^აეიოუ]/.test(stem) ? v + stem.slice(1) : v + stem;
  }
  const parts = [];
  let pre = null;
  if (o && o[0] !== '3') {
    if (o[0] === s[0]) return null; // "I … me" is the reflexive (თავს), not a prefix
    pre = P(OBJ_PRE[o], 'obj', o);
    if (stem[0] === 'უ') stem = 'ი' + stem.slice(1);
    if (pvo && pv) pv = pvo;
    if (o === '2pl' && s !== '3pl' && !end.endsWith('თ')) end = end.replace(/ს$/, '') + 'თ';
  } else if (s[0] === '1') pre = P('ვ', 'subj', s);
  else if (m3) pre = P(m3, 'obj', '3');
  if (pv) parts.push(P(pv, 'preverb'));
  if (pre) parts.push(pre);
  parts.push(...stemParts(stem, lex.w));
  if (cell.mark) parts.push(P(cell.mark, 'screeve'));
  if (end) parts.push(P(end, 'ending', s));
  return parts;
}

// Inversion: the logical subject is expressed by the OBJECT prefix set (მ- გ- გვ-, zero/ჰ-/ს- for 3rd) and the
// version vowel უ- (3rd) / ი- (1st, 2nd); plural of the logical subject is -თ replacing the 3sg -ს (გვიყვარს ->
// გიყვართ). Only the 3sg form is stored; all six persons come from it.
function inverted(f3, s) {
  const [pv, b] = split(f3);
  const parts = pv ? [P(pv, 'preverb')] : [];
  let rest = b, pre3 = '', vowel = '';
  if (b[0] === 'უ') { rest = b.slice(1); vowel = 'უ'; }
  else if (/^[ჰს][^აეიოუ]/.test(b)) { rest = b.slice(1); pre3 = b[0]; }
  if (s[0] === '3') { if (pre3) parts.push(P(pre3, 'obj', '3')); if (vowel) parts.push(P('უ', 'version')); }
  else { parts.push(P(OBJ_PRE[s], 'obj', s)); if (vowel) parts.push(P('ი', 'version')); }
  const plural = s === '2pl' || s === '3pl';
  const body = plural && rest.endsWith('ს') ? rest.slice(0, -1) : rest;
  if (/^[აეი][^აეიოუ]/.test(body) && body.length > 2) parts.push(P(body[0], 'version'), P(body.slice(1), 'root'));
  else parts.push(P(body, 'root'));
  if (plural) parts.push(P('თ', 'ending', s));
  return parts;
}

const tableParts = (f) => { const [pv, b] = split(f); return pv ? [P(pv, 'preverb'), P(b, 'root')] : [P(b, 'root')]; };

// One form: { form, parts, derived, inverted } or null.
export function conjugate(lex, screeve, s, o = null, { version = null } = {}) {
  const spec = screeveSpec(lex, screeve);
  if (!spec) return null;
  if (spec.table) {
    if (o && o[0] !== '3') return null;
    const f = spec.table[PI(s)];
    return f ? { form: f.replace(/-/g, ''), parts: tableParts(f), derived: false, inverted: false } : null;
  }
  if (spec.inv) {
    if (o && o[0] !== '3') return null;
    const parts = inverted(spec.f3, s);
    return { form: join(parts), parts, derived: !!spec.derived, inverted: true };
  }
  if (version === 'subjective' && o && o[0] !== '3') return null;
  const parts = regular(spec.cells[PI(s)], s, o, lex, principalParts(lex).pvo, version);
  return parts ? { form: join(parts), parts, derived: !!spec.derived, inverted: false } : null;
}

export function verbTable(lex, screeve, o = null, opts = {}) {
  return PERSONS.map((s) => ({ s, ...(conjugate(lex, screeve, s, o, opts) || { form: null, parts: [] }) }));
}

// --- suppletive verbs: whole tables (a '-' after the preverb) -----------------------------------------------------
// Verbs whose stems change between series (to be, to go, to sit/stand/lie: also number-suppletive, ზის/სხედან) cannot
// be generated; full tables are the honest representation. Motion verbs share one template over 13 preverbs.
// Data tables below: not commented per row.
function motion(pv) {
  const pres = pv === 'წა' ? 'მი' : pv; // წასვლა "to leave" has the present of მისვლა
  const X = (p, list) => list.map((x) => (x == null ? null : p + '-' + x));
  const imp = pv === 'მო' ? ['მო-დი', 'მო-დით'] : pv === 'წა' ? ['წა-დი', 'წა-დით'] : [pv + '-დი', pv + '-დით'];
  return {
    present: X(pres, ['ვდივარ', 'დიხარ', 'დის', 'ვდივართ', 'დიხართ', 'დიან']),
    imperfect: X(pres, ['ვდიოდი', 'დიოდი', 'დიოდა', 'ვდიოდით', 'დიოდით', 'დიოდნენ']),
    presSubj: X(pres, ['ვდიოდე', 'დიოდე', 'დიოდეს', 'ვდიოდეთ', 'დიოდეთ', 'დიოდნენ']),
    future: X(pv, ['ვალ', 'ხვალ', 'ვა', 'ვალთ', 'ხვალთ', 'ვლენ']),
    conditional: X(pv, ['ვიდოდი', 'ხვიდოდი', 'ვიდოდა', 'ვიდოდით', 'ხვიდოდით', 'ვიდოდნენ']),
    futSubj: X(pv, ['ვიდოდე', 'ხვიდოდე', 'ვიდოდეს', 'ვიდოდეთ', 'ხვიდოდეთ', 'ვიდოდნენ']),
    aorist: X(pv, ['ვედი', 'ხვედი', 'ვიდა', 'ვედით', 'ხვედით', 'ვიდნენ']),
    optative: X(pv, ['ვიდე', 'ხვიდე', 'ვიდეს', 'ვიდეთ', 'ხვიდეთ', 'ვიდნენ']),
    imperative: [null, imp[0], null, null, imp[1], null],
    perfect: X(pv, ['ვსულვარ', 'სულხარ', 'სულა', 'ვსულვართ', 'სულხართ', 'სულან']),
    pluperfect: X(pv, ['ვსულიყავი', 'სულიყავი', 'სულიყო', 'ვსულიყავით', 'სულიყავით', 'სულიყვნენ']),
  };
}
export const SUPPLETIVE = {
  'ყოფნა': {
    present: ['ვარ', 'ხარ', 'არის', 'ვართ', 'ხართ', 'არიან'],
    imperfect: ['ვიყავი', 'იყავი', 'იყო', 'ვიყავით', 'იყავით', 'იყვნენ'],
    presSubj: ['ვიყო', 'იყო', 'იყოს', 'ვიყოთ', 'იყოთ', 'იყონ'],
    future: ['ვიქნები', 'იქნები', 'იქნება', 'ვიქნებით', 'იქნებით', 'იქნებიან'],
    conditional: ['ვიქნებოდი', 'იქნებოდი', 'იქნებოდა', 'ვიქნებოდით', 'იქნებოდით', 'იქნებოდნენ'],
    futSubj: ['ვიქნებოდე', 'იქნებოდე', 'იქნებოდეს', 'ვიქნებოდეთ', 'იქნებოდეთ', 'იქნებოდნენ'],
    aorist: ['ვიყავი', 'იყავი', 'იყო', 'ვიყავით', 'იყავით', 'იყვნენ'],
    optative: ['ვიყო', 'იყო', 'იყოს', 'ვიყოთ', 'იყოთ', 'იყონ'],
    imperative: [null, 'იყავი', null, null, 'იყავით', null],
    perfect: ['ვყოფილვარ', 'ყოფილხარ', 'ყოფილა', 'ვყოფილვართ', 'ყოფილხართ', 'ყოფილან'],
    pluperfect: ['ვყოფილიყავი', 'ყოფილიყავი', 'ყოფილიყო', 'ვყოფილიყავით', 'ყოფილიყავით', 'ყოფილიყვნენ'],
  },
  'დგომა': {
    present: ['ვდგავარ', 'დგახარ', 'დგას', 'ვდგავართ', 'დგახართ', 'დგანან'],
    imperfect: ['ვიდექი', 'იდექი', 'იდგა', 'ვიდექით', 'იდექით', 'იდგნენ'],
    future: ['ვიდგები', 'იდგები', 'იდგება', 'ვიდგებით', 'იდგებით', 'იდგებიან'],
    aorist: ['ვიდექი', 'იდექი', 'იდგა', 'ვიდექით', 'იდექით', 'იდგნენ'],
    imperative: [null, 'იდექი', null, null, 'იდექით', null],
  },
  'ჯდომა': {
    present: ['ვზივარ', 'ზიხარ', 'ზის', 'ვსხედვართ', 'სხედხართ', 'სხედან'],
    imperfect: ['ვიჯექი', 'იჯექი', 'იჯდა', 'ვისხედით', 'ისხედით', 'ისხდნენ'],
  },
  'დაჯდომა': {
    future: ['და-ვჯდები', 'და-ჯდები', 'და-ჯდება', 'და-ვსხდებით', 'და-სხდებით', 'და-სხდებიან'],
    aorist: ['და-ვჯექი', 'და-ჯექი', 'და-ჯდა', 'და-ვსხედით', 'და-სხედით', 'და-სხდნენ'],
    optative: ['და-ვჯდე', 'და-ჯდე', 'და-ჯდეს', 'და-ვსხდეთ', 'და-სხდეთ', 'და-სხდნენ'],
    imperative: [null, 'და-ჯექი', null, null, 'და-სხედით', null],
  },
  'სიარული': {
    present: ['და-ვდივარ', 'და-დიხარ', 'და-დის', 'და-ვდივართ', 'და-დიხართ', 'და-დიან'],
    imperfect: ['და-ვდიოდი', 'და-დიოდი', 'და-დიოდა', 'და-ვდიოდით', 'და-დიოდით', 'და-დიოდნენ'],
    future: ['ვივლი', 'ივლი', 'ივლის', 'ვივლით', 'ივლით', 'ივლიან'],
    aorist: ['ვიარე', 'იარე', 'იარა', 'ვიარეთ', 'იარეთ', 'იარეს'],
    optative: ['ვიარო', 'იარო', 'იაროს', 'ვიაროთ', 'იაროთ', 'იარონ'],
    imperative: [null, 'იარე', null, null, 'იარეთ', null],
  },
  'წოლა': {
    present: ['ვწევარ', 'წევხარ', 'წევს', 'ვწევართ', 'წევხართ', 'წვანან'],
    imperfect: ['ვიწექი', 'იწექი', 'იწვა', 'ვიწექით', 'იწექით', 'იწვნენ'],
  },
};
for (const pv of ['მი', 'მო', 'წა', 'შე', 'გა', 'ა', 'ჩა', 'გადა', 'შემო', 'გამო', 'ამო', 'ჩამო', 'გადმო']) SUPPLETIVE[pv + 'სვლა'] = motion(pv);

// --- case frames -------------------------------------------------------------------------------------------------
// Who stands in which case: class I (transitive) and III (medial) follow the series (nominative / ergative / dative
// subject), class II (intransitive) keeps a nominative subject, class IV (indirect) always has a dative subject.
//   -> { series, cls, subj, obj, io, inverted, note }   io 'tvis': the indirect object becomes X-ის-თვის
export function caseFrame(lex, screeve) {
  const series = SERIES[screeve] || 1;
  const c = lex.c || 1;
  const io = !!(lex.flags && lex.flags.io);
  if (c === 2) return { series, cls: 2, subj: 'nom', obj: null, io: 'dat', inverted: false, note: 'c2', objIsIO: io };
  if (c === 4) return { series, cls: 4, subj: 'dat', obj: 'nom', io: null, inverted: true, note: 'c4' };
  if (series === 1) return { series, cls: c, subj: 'nom', obj: 'dat', io: 'dat', inverted: false, note: 's1', objIsIO: io };
  if (series === 2) return { series, cls: c, subj: 'erg', obj: io ? 'dat' : 'nom', io: 'dat', inverted: false, note: 's2', objIsIO: io };
  return { series, cls: c, subj: 'dat', obj: io ? 'tvis' : 'nom', io: 'tvis', inverted: true, note: 's3', objIsIO: io };
}

// --- word-form analysis ------------------------------------------------------------------------------------------
// The index maps every generated form to compact recipes; parts are rebuilt only for the forms asked about.
//   recipe: [lexIndex, kind, a, b, c, d]   kind: 'n' noun case (a group, b case id), 'p' postposition (a num, b id),
//           'a' attributive adjective (b case), 'v' verb (a screeve, b s, c o, d version), 'm' masdar (b case),
//           'r' pronoun (b case), 'x' as written, 't' participle (b case)
let INDEX = null;
const OBJ_SET = [null, '1sg', '2sg', '1pl', '2pl'];

// Enumerates every lexicon entry by part of speech: nouns (sg, -ებ pl, old pl, postpositions), adjectives (attributive
// forms and substantivised noun forms), numerals, pronouns, verbs (all screeves x versions x objects x subjects, plus
// masdar, masdar with future preverb, participles), others as written. Recipes are deduplicated per form. Versions
// are enumerated only for class I in the screeves where they are productive, to bound the index size.
export function formIndex() {
  if (INDEX) return INDEX;
  INDEX = new Map();
  const lex = lexicon();
  const add = (form, rec) => {
    if (!form) return;
    const a = INDEX.get(form);
    if (!a) INDEX.set(form, [rec]);
    else if (!a.some((r) => r[0] === rec[0] && r[1] === rec[1] && r[2] === rec[2] && r[3] === rec[3] && r[4] === rec[4] && r[5] === rec[5])) a.push(rec);
  };
  const nounForms = (i, w, flags, kind, withPl) => {
    const d = declineNoun({ w, flags: flags || {} });
    for (const c of d.sg) add(c.form, [i, kind, 'sg', c.id, w]);
    if (withPl) { for (const c of d.pl) add(c.form, [i, kind, 'pl', c.id, w]); for (const c of d.old) add(c.form, [i, kind, 'old', c.id, w]); }
    for (const p of d.post) if (withPl || p.num === 'sg') add(p.form, [i, 'p', p.num, p.id, kind, w]);
  };
  lex.forEach((e, i) => {
    if (e.w.includes(' ')) { add(e.w, [i, 'x']); return; }
    if (e.pos === 'n' || e.pos === 'np') nounForms(i, e.w, e.flags, 'n', e.pos === 'n' && !e.flags.np);
    else if (e.pos === 'a') {
      for (const c of CASE_IDS) add(adjAgree(e.w, c), [i, 'a', '', c, e.w]);
      if (e.w.endsWith('ი')) nounForms(i, e.w, e.flags, 'n', true);
    } else if (e.pos === 'num') {
      add(e.w, [i, 'x']);
      if (e.w.endsWith('ი')) { for (const c of CASE_IDS) add(adjAgree(e.w, c), [i, 'a', '', c, e.w]); nounForms(i, e.w, e.flags, 'n', false); }
      else if (/[აე]$/.test(e.w)) nounForms(i, e.w, e.flags, 'n', false);
    } else if (e.pos === 'pr') {
      const p = PRONOUNS.find((x) => x.w === e.w);
      if (p) for (const [c, f] of Object.entries(p.forms)) add(f, [i, 'r', '', c]);
      else { add(e.w, [i, 'x']); if (e.w.endsWith('ი') && e.w.length > 3) nounForms(i, e.w, {}, 'n', false); }
    } else if (e.pos === 'v') {
      for (const sc of SCREEVES_ALL) {
        const versions = e.c === 1 && !e.flags.io && ['present', 'future', 'aorist', 'optative'].includes(sc.id) ? [null, 'objective', 'subjective'] : [null];
        for (const ver of versions) {
          for (const o of OBJ_SET) {
            if (ver === 'subjective' && o) continue;
            for (const s of PERSONS) {
              const f = conjugate(e, sc.id, s, o, { version: ver });
              if (f) add(f.form, [i, 'v', sc.id, s, o, ver]);
            }
          }
        }
      }
      nounForms(i, e.w, {}, 'm', false);
      // the masdar with the preverb of the future (წერა -> დაწერა, კითხვა -> წაკითხვა)
      const pv = e.flags.pv || ((e.flags.f || e.flags.a || '').split('-')[1] !== undefined ? (e.flags.f || e.flags.a).split('-')[0] : '');
      if (pv && !e.w.startsWith(pv) && !SUPPLETIVE[e.w]) nounForms(i, pv + e.w, {}, 'm', false);
      for (const pt of e.flags.pt || []) { if (pt.endsWith('ი')) { for (const c of CASE_IDS) add(adjAgree(pt, c), [i, 't', '', c, pt]); nounForms(i, pt, {}, 't', true); } }
    } else add(e.w.replace(/^-/, ''), [i, 'x']);
  });
  return INDEX;
}

function hitOf(rec) {
  const lex = lexicon()[rec[0]];
  const [, kind, a, b, c, d] = rec;
  const e = kind === 'p' ? d : c; // the word the noun-like forms were made from
  const out = { lex, lemma: lex.w, pos: lex.pos, kind, tags: {}, parts: null, derived: false };
  if (kind === 'v') {
    const f = conjugate(lex, a, b, c, { version: d });
    Object.assign(out, { parts: f.parts, derived: f.derived, tags: { screeve: a, series: SERIES[a], s: b, o: c, version: d || null, inverted: f.inverted } });
  } else if ((kind === 'n' || kind === 'm' || kind === 't') && a) {
    const d0 = declineNoun(kind === 'n' && e === lex.w ? lex : { w: e, flags: kind === 'n' ? lex.flags : {} });
    const group = a === 'pl' ? d0.pl : a === 'old' ? d0.old : d0.sg;
    const c0 = group.find((x) => x.id === b);
    Object.assign(out, { parts: c0 ? c0.parts : [P(e, 'stem')], tags: { case: b, num: a === 'old' ? 'pl' : a, old: a === 'old', masdar: kind === 'm', participle: kind === 't' ? e : null } });
  } else if (kind === 'p') {
    const d0 = declineNoun(c === 'n' && e === lex.w ? lex : { w: e, flags: c === 'n' ? lex.flags : {} });
    const p0 = d0.post.find((x) => x.num === a && x.id === b);
    const pp = POSTS.find((x) => x.id === b);
    Object.assign(out, { parts: p0 ? p0.parts : [], tags: { case: pp.base, num: a, post: b, masdar: c === 'm', participle: c === 't' ? e : null } });
  } else if (kind === 'a' || kind === 't') {
    Object.assign(out, { parts: [P(adjAgree(e, b), 'stem')], tags: { case: b, attr: true, participle: kind === 't' ? e : null } });
  } else if (kind === 'r') {
    const p = PRONOUNS.find((x) => x.w === lex.w);
    Object.assign(out, { parts: [P(p.forms[b], 'stem')], tags: { case: b, person: p.person, pronoun: true } });
  } else Object.assign(out, { parts: [P(lex.w.replace(/^-/, ''), 'stem')] });
  return out;
}

// Enclitics glued to words, longest first: quotative particles (-მეთქი "I said", -თქო "say that", -ო "he/she said"),
// -ც "also", -ვე "the same", -ღა "only/still", -ა the short copula. strip() keeps only Georgian letters and hyphens.
const CLITICS = [['მეთქი', 'quoteSelf'], ['თქო', 'quoteRelay'], ['ო', 'quote'], ['ც', 'also'], ['ვე', 'same'], ['ღა', 'only'], ['ა', 'copula']];
const strip = (w) => String(w).toLowerCase().replace(/[^Ⴀ-ჿⴀ-⴯-]/g, '').replace(/^-+|-+$/g, '');

// Every reading of a word form: [{ lemma, lex, pos, kind, tags, parts, clitic?, score }], best first; [] if unknown.
// Score = word frequency tier (dominant) + small priors: finite verbs up, masdar/participle down, old plural down,
// marked versions / object persons down (rarer), clitic readings strongly down (-1.5: a plain reading of the whole
// word is far likelier than word + clitic), derived forms slightly down. The copula -ა is tried only if nothing else
// matched, because word-final ა is mostly part of the stem.
export function analyzeWord(word) {
  const w = strip(word);
  if (!w) return [];
  const idx = formIndex();
  const read = (form, clitic) => (idx.get(form) || []).map((rec) => {
    const h = hitOf(rec);
    if (clitic) { h.clitic = clitic; h.parts = [...h.parts, P(w.slice(form.length).replace(/^-/, ''), 'clitic', clitic)]; }
    h.score = (4 - (h.lex.tier || 2)) + (h.kind === 'v' ? 0.5 : 0) + (h.kind === 'm' || h.kind === 't' ? -0.5 : 0) + (h.tags.old ? -1 : 0) + (h.tags.version ? -0.3 : 0) + (h.tags.o ? -0.4 : 0) + (clitic ? -1.5 : 0) + (h.derived ? -0.2 : 0);
    return h;
  });
  let out = read(w, null);
  for (const [c, id] of CLITICS) {
    if (!w.endsWith(c) || w.length <= c.length + 1) continue;
    const base = w.slice(0, -c.length).replace(/-$/, '');
    const more = read(base, id);
    // the quotative -ო goes on verbs (and on the last word of a quoted phrase); -ც / -ვე on anything
    // the copula -ა (= არის "is") sits on a nominative: მეგობარია, იდეაა
    if (id === 'copula') { if (!out.length) out = more.filter((h) => h.tags.case === 'nom' && !h.tags.post); continue; }
    out = out.concat(id === 'quote' ?more.filter((h) => h.kind === 'v' || !out.length) : more);
  }
  // A participle that is also a noun of the dictionary (გამყიდველი "seller") reads as that noun; equal readings once.
  const nouns = new Set(out.filter((h) => h.pos === 'n' || h.pos === 'np').map((h) => h.lemma));
  const seen = new Set();
  out = out.filter((h) => {
    if (h.tags.participle && nouns.has(h.tags.participle)) return false;
    const k = h.lemma + '|' + JSON.stringify(h.tags) + '|' + (h.clitic || '');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  out.sort((a, b) => b.score - a.score);
  return out;
}

// One-line gloss of a reading in ru / en.
export function glossOf(h, lang = 'ru') {
  return (h.lex && (lang === 'ru' ? h.lex.ru : h.lex.en)) || '';
}
