// lingua/kartuli.js - Georgian morphology: transliteration, noun cases and postpositions, a verb form generator with
// the slots of the Georgian verb (preverb, person prefix, version vowel, root, thematic suffix, screeve marker,
// person suffix) and a splitter that takes a word apart into those slots with an explanation of each.
//
//   translit(text, 'lat' | 'ru') -> Latin (national system) or a Russian-reader transcription
//   decline(noun) -> { stem, kind, cases: [{ id, form, parts }], plural: […], post: [{ id, form, parts }] }
//   verbForm(verb, { screeve, s, o, version }) -> { form, parts } | null       s, o: '1sg' '2sg' '3sg' '1pl' '2pl' '3pl'
//   paradigm(verb, screeve, version, o?) -> [{ s, form, parts }]
//   analyze(word, { verbs, nouns }) -> [{ parts: [{ s, role, tag? }], score, source }]
//   ROLES: { role: { ru, en } }   SCREEVES, VERSIONS, CASES, POSTPOSITIONS: ids with { ka, ru, en }
//
// The generator covers class I (transitive) verbs in the present series (present, imperfect, present subjunctive)
// and the future series (future, conditional, future subjunctive), with the neutral, subjective (for oneself) and
// objective (for someone: the indirect object) versions. The aorist and the perfect series are explained in the
// grammar lessons but not generated: their stems change too irregularly for a short table.
// (The fuller engine for all series lives in kartuli-grammar.js; this module is the small, explainable teaching
// generator used by the slot diagrams.)
//
// Key decisions:
// - Every generated form is a list of parts { s, role, tag }: the form is ALWAYS parts.join(''), so the UI can colour
//   slots and the analyzer can return the same structure. No form is built as a bare string.
// - Analysis prefers exact matches against generated paradigms of known words (analysis by synthesis) and falls back
//   to affix stripping only for unknown words, scored lower and labelled as guesses.
// - Transliteration: LAT is the Georgian national system (2002) with apostrophes for ejectives; RU follows the
//   Russian-reader tradition, ejectives marked with ’ and ჰ with Cyrillic һ (no Russian letter for it).

const LAT = { 'ა': 'a', 'ბ': 'b', 'გ': 'g', 'დ': 'd', 'ე': 'e', 'ვ': 'v', 'ზ': 'z', 'თ': 't', 'ი': 'i', 'კ': "k'", 'ლ': 'l', 'მ': 'm', 'ნ': 'n', 'ო': 'o', 'პ': "p'", 'ჟ': 'zh', 'რ': 'r', 'ს': 's', 'ტ': "t'", 'უ': 'u', 'ფ': 'p', 'ქ': 'k', 'ღ': 'gh', 'ყ': "q'", 'შ': 'sh', 'ჩ': 'ch', 'ც': 'ts', 'ძ': 'dz', 'წ': "ts'", 'ჭ': "ch'", 'ხ': 'kh', 'ჯ': 'j', 'ჰ': 'h' };
const RU = { 'ა': 'а', 'ბ': 'б', 'გ': 'г', 'დ': 'д', 'ე': 'э', 'ვ': 'в', 'ზ': 'з', 'თ': 'т', 'ი': 'и', 'კ': 'к’', 'ლ': 'л', 'მ': 'м', 'ნ': 'н', 'ო': 'о', 'პ': 'п’', 'ჟ': 'ж', 'რ': 'р', 'ს': 'с', 'ტ': 'т’', 'უ': 'у', 'ფ': 'п', 'ქ': 'к', 'ღ': 'гъ', 'ყ': 'къ', 'შ': 'ш', 'ჩ': 'ч', 'ც': 'ц', 'ძ': 'дз', 'წ': 'ц’', 'ჭ': 'ч’', 'ხ': 'х', 'ჯ': 'дж', 'ჰ': 'һ' };

export function translit(text, to = 'lat') {
  const map = to === 'ru' ? RU : LAT;
  return String(text).replace(/[ა-ჰ]/g, (c) => map[c] ?? c);
}

export const ROLES = {
  preverb: { ru: 'преверб: направление действия, в будущем времени — завершённость', en: 'preverb: the direction of the action; in the future series it makes the verb perfective' },
  subj: { ru: 'префикс субъекта (кто делает)', en: 'subject prefix (who acts)' },
  obj: { ru: 'префикс объекта (кому / кого)', en: 'object prefix (to / for whom)' },
  version: { ru: 'гласная версии: для кого действие (а — нейтр., и — для себя, у/и — для другого)', en: 'version vowel: for whom (a neutral, i for oneself, u / i for someone else)' },
  root: { ru: 'корень: основное значение', en: 'root: the core meaning' },
  ts: { ru: 'тематический суффикс (-ებ, -ავ, -ამ, -ი, -ობ): основа настоящего и будущего', en: 'thematic suffix (-eb, -av, -am, -i, -ob): the stem of the present and the future' },
  screeve: { ru: 'показатель времени-наклонения («скривы»): -დ- прошедшее несовершенное и условное', en: 'screeve marker: -d- for the imperfect and the conditional' },
  ending: { ru: 'окончание лица и числа субъекта', en: 'ending: person and number of the subject' },
  plural: { ru: 'показатель множественного числа -ებ-', en: 'plural marker -eb-' },
  case: { ru: 'падежное окончание', en: 'case ending' },
  post: { ru: 'послелог (как предлог, но в конце слова)', en: 'postposition (like a preposition, at the end of the word)' },
  stem: { ru: 'основа слова', en: 'stem' },
  link: { ru: 'соединительный звук', en: 'linking sound' },
  noun: { ru: 'отглагольное имя (масдар)', en: 'verbal noun (masdar)' },
};

export const CASES = [
  { id: 'nom', ka: 'სახელობითი', ru: 'именительный', en: 'nominative' },
  { id: 'erg', ka: 'მოთხრობითი', ru: 'эргативный (подлежащее переходного глагола в аористе)', en: 'ergative (the subject of a transitive verb in the aorist)' },
  { id: 'dat', ka: 'მიცემითი', ru: 'дательный', en: 'dative' },
  { id: 'gen', ka: 'ნათესაობითი', ru: 'родительный', en: 'genitive' },
  { id: 'ins', ka: 'მოქმედებითი', ru: 'творительный', en: 'instrumental' },
  { id: 'adv', ka: 'ვითარებითი', ru: 'обстоятельственный («в качестве»)', en: 'adverbial ("as")' },
  { id: 'voc', ka: 'წოდებითი', ru: 'звательный', en: 'vocative' },
];

export const POSTPOSITIONS = [
  { id: 'shi', s: 'ში', base: 'dat', ru: 'в', en: 'in' },
  { id: 'ze', s: 'ზე', base: 'dat', ru: 'на, о', en: 'on, about' },
  { id: 'tan', s: 'თან', base: 'dat', ru: 'у, рядом, с', en: 'at, near, with' },
  { id: 'tvis', s: 'თვის', base: 'gen', ru: 'для', en: 'for' },
  { id: 'gan', s: 'გან', base: 'gen', ru: 'от, из (источник)', en: 'from (source), made of' },
  { id: 'ken', s: 'კენ', base: 'gen', ru: 'к, в сторону', en: 'towards' },
  { id: 'vit', s: 'ვით', base: 'gen', ru: 'как, подобно', en: 'like' },
  { id: 'dan', s: 'დან', base: 'ins', ru: 'из, от (откуда)', en: 'from (where)' },
  { id: 'mde', s: 'მდე', base: 'adv', ru: 'до', en: 'until, as far as' },
];

// stems whose last vowel drops before a vowel ending (syncope): nominative -> reduced stem
// Syncope is lexical (not predictable from shape), hence a list; null records a checked "no syncope" word.
// nounStem classes: C = consonant stem (nom -ი), A = -ა stem, V = other vowel stems (-ო, -ე, -უ) that do not inflect
// the stem vowel. Words of 2 letters ending in ი are treated as V (e.g. short function words), not C.
const SYNCOPE = { 'წყალი': 'წყლ', 'მეგობარი': 'მეგობრ', 'ფანჯარა': 'ფანჯრ', 'ნიგოზი': 'ნიგვზ', 'ვაშლი': null, 'ძაღლი': null, 'სოფელი': 'სოფლ', 'მინდორი': 'მინდვრ', 'ნათელი': 'ნათლ', 'კედელი': 'კედლ', 'ფოთოლი': 'ფოთლ', 'ღრუბელი': 'ღრუბლ' };

function nounStem(word) {
  const w = String(word).trim();
  if (w.length > 2 && w.endsWith('ი')) return { stem: w.slice(0, -1), kind: 'C', short: SYNCOPE[w] || null };
  if (w.endsWith('ა')) return { stem: w.slice(0, -1), kind: 'A', short: SYNCOPE[w] || null };
  return { stem: w, kind: 'V', short: null };
}

const P = (s, role, tag) => (tag ? { s, role, tag } : { s, role });

// Case endings per stem class (standard grammar tables); the reduced (syncopated) stem appears only before the
// vowel-initial endings -ის -ით -ად. Postposition forms are derived from their host case by the fusion rules below
// (the host case ending is truncated), so a postposition table needs no per-class forms.
export function decline(noun) {
  const { stem, kind, short } = nounStem(noun);
  const red = short || stem; // reduced stem before -ის / -ით / -ად
  const cases = [];
  const add = (id, parts) => cases.push({ id, form: parts.map((p) => p.s).join(''), parts });
  if (kind === 'C') {
    add('nom', [P(stem, 'stem'), P('ი', 'case', 'nom')]);
    add('erg', [P(stem, 'stem'), P('მა', 'case', 'erg')]);
    add('dat', [P(stem, 'stem'), P('ს', 'case', 'dat')]);
    add('gen', [P(red, 'stem'), P('ის', 'case', 'gen')]);
    add('ins', [P(red, 'stem'), P('ით', 'case', 'ins')]);
    add('adv', [P(red, 'stem'), P('ად', 'case', 'adv')]);
    add('voc', [P(stem, 'stem'), P('ო', 'case', 'voc')]);
  } else if (kind === 'A') {
    add('nom', [P(stem + 'ა', 'stem')]);
    add('erg', [P(stem + 'ა', 'stem'), P('მ', 'case', 'erg')]);
    add('dat', [P(stem + 'ა', 'stem'), P('ს', 'case', 'dat')]);
    add('gen', [P(red, 'stem'), P('ის', 'case', 'gen')]);
    add('ins', [P(red, 'stem'), P('ით', 'case', 'ins')]);
    add('adv', [P(stem + 'ა', 'stem'), P('დ', 'case', 'adv')]);
    add('voc', [P(stem + 'ა', 'stem'), P('ვ', 'case', 'voc')]);
  } else {
    add('nom', [P(stem, 'stem')]);
    add('erg', [P(stem, 'stem'), P('მ', 'case', 'erg')]);
    add('dat', [P(stem, 'stem'), P('ს', 'case', 'dat')]);
    add('gen', [P(stem, 'stem'), P('ს', 'case', 'gen')]);
    add('ins', [P(stem, 'stem'), P('თი', 'case', 'ins')]);
    add('adv', [P(stem, 'stem'), P('დ', 'case', 'adv')]);
    add('voc', [P(stem, 'stem'), P('ვ', 'case', 'voc')]);
  }
  // plural: -ებ- on the stem (an -ა drops), then the endings of consonant stems
  const plural = [['nom', 'ი'], ['erg', 'მა'], ['dat', 'ს'], ['gen', 'ის'], ['ins', 'ით'], ['adv', 'ად'], ['voc', 'ო']]
    .map(([id, e]) => { const parts = [P(kind === 'V' ? stem : red, 'stem'), P('ებ', 'plural'), P(e, 'case', id)]; return { id, form: parts.map((p) => p.s).join(''), parts }; });
  const byId = Object.fromEntries(cases.map((c) => [c.id, c]));
  const post = POSTPOSITIONS.map((pp) => {
    const base = byId[pp.base];
    let parts = base.parts.map((p) => ({ ...p }));
    const last = parts[parts.length - 1];
    if (pp.base === 'dat' && last.role === 'case' && (pp.s !== 'თან' || kind === 'C')) parts.pop(); // -ს drops before -ში, -ზე (and -თან after consonant stems)
    if (pp.base === 'ins' && last.role === 'case') last.s = kind === 'V' ? '' : 'ი'; // instrumental -ით loses its -თ
    if (pp.base === 'ins' && kind === 'V' && last.s === '') parts.pop();
    if (pp.base === 'adv' && last.role === 'case') last.s = kind === 'C' ? 'ა' : ''; // adverbial -ად loses its -დ
    if (pp.base === 'adv' && !last.s) parts.pop();
    if (pp.id === 'vit' && kind === 'C') last.s = 'ი'; // სახლივით
    if (pp.id === 'vit' && kind !== 'C') parts = [...byId.dat.parts.map((p) => ({ ...p })), P('ა', 'link')]; // დედასავით
    parts = parts.filter((p) => p.s);
    parts.push(P(pp.s, 'post', pp.id));
    return { id: pp.id, form: parts.map((p) => p.s).join(''), parts };
  });
  return { stem, kind, cases, plural, post };
}

// --- verbs -------------------------------------------------------------------------------------------------------
// verb: { id, root, ts: ''|'ებ'|'ავ'|'ამ'|'ი'|'ობ', neutral: ''|'ა', pv: future preverb, gloss }

export const SCREEVES = [
  { id: 'present', ka: 'აწმყო', ru: 'настоящее', en: 'present', pv: false, d: false, set: 'pres' },
  { id: 'imperfect', ka: 'უწყვეტელი', ru: 'прошедшее несовершенное', en: 'imperfect', pv: false, d: true, set: 'impf' },
  { id: 'presSubj', ka: 'აწმყოს კავშირებითი', ru: 'сослагательное настоящего', en: 'present subjunctive', pv: false, d: true, set: 'subj' },
  { id: 'future', ka: 'მყოფადი', ru: 'будущее', en: 'future', pv: true, d: false, set: 'pres' },
  { id: 'conditional', ka: 'ხოლმეობითი / პირობითი', ru: 'условное', en: 'conditional', pv: true, d: true, set: 'impf' },
  { id: 'futSubj', ka: 'მყოფადის კავშირებითი', ru: 'сослагательное будущего', en: 'future subjunctive', pv: true, d: true, set: 'subj' },
];
export const VERSIONS = [
  { id: 'neutral', ru: 'нейтральная', en: 'neutral' },
  { id: 'subjective', ru: 'субъектная (для себя)', en: 'subjective (for oneself)' },
  { id: 'objective', ru: 'объектная (для кого-то)', en: 'objective (for someone)' },
];
export const PERSONS = ['1sg', '2sg', '3sg', '1pl', '2pl', '3pl'];

// Subject person endings by screeve set (class I verbs). presI: verbs with thematic -ი take 3pl -ან, not -ენ
// (წერენ vs ...იან). 1sg/2sg share the empty ending: they differ only by the ვ- prefix.
const ENDINGS = {
  pres: { '1sg': '', '2sg': '', '3sg': 'ს', '1pl': 'თ', '2pl': 'თ', '3pl': 'ენ' },
  presI: { '1sg': '', '2sg': '', '3sg': 'ს', '1pl': 'თ', '2pl': 'თ', '3pl': 'ან' },
  impf: { '1sg': 'ი', '2sg': 'ი', '3sg': 'ა', '1pl': 'ით', '2pl': 'ით', '3pl': 'ნენ' },
  subj: { '1sg': 'ე', '2sg': 'ე', '3sg': 'ეს', '1pl': 'ეთ', '2pl': 'ეთ', '3pl': 'ნენ' },
};

// Fills the slots left to right: preverb (future series only) | person prefix | version vowel | root | thematic
// suffix | -დ- (imperfect / subjunctive / conditional) | ending. Georgian has one prefix slot for both subject and
// object markers: in the objective version an object marker (მ-, გვ-, გ-) wins the slot and the subject ვ- is
// suppressed, except with a 3rd-person object (which has a zero prefix). Version vowel: objective უ- for a 3rd-person
// object, ი- for 1st/2nd; subjective ი-; neutral is lexical (verb.neutral, often ა- or nothing).
// Returns null for impossible combinations (same 1st/2nd person subject and object), which paradigm shows as '—'.
export function verbForm(verb, { screeve = 'present', s = '3sg', o = '3sg', version = 'neutral' } = {}) {
  const sc = SCREEVES.find((x) => x.id === screeve);
  if (!sc || !PERSONS.includes(s)) return null;
  const objective = version === 'objective';
  if (objective && (s[0] === o[0] && s[0] !== '3')) return null; // "I … for myself" is the subjective version
  const parts = [];
  if (sc.pv && verb.pv) parts.push(P(verb.pv, 'preverb'));
  // person prefix: the indirect object (objective version) takes the slot; S1 ვ- stays only before an O3
  if (objective) {
    if (o === '1sg') parts.push(P('მ', 'obj', '1sg'));
    else if (o === '1pl') parts.push(P('გვ', 'obj', '1pl'));
    else if (o[0] === '2') parts.push(P('გ', 'obj', o));
    else if (s[0] === '1') parts.push(P('ვ', 'subj', s));
  } else if (s[0] === '1') parts.push(P('ვ', 'subj', s));
  const vowel = objective ? (o[0] === '3' ? 'უ' : 'ი') : version === 'subjective' ? 'ი' : verb.neutral;
  if (vowel) parts.push(P(vowel, 'version', objective ? 'objective' : version === 'subjective' ? 'subjective' : 'neutral'));
  parts.push(P(verb.root, 'root'));
  if (verb.ts) parts.push(P(verb.ts, 'ts'));
  if (sc.d) parts.push(P('დ', 'screeve', sc.id));
  const set = sc.set === 'pres' && verb.ts === 'ი' ? 'presI' : sc.set;
  let end = ENDINGS[set][s];
  // a plural 2nd person indirect object shows as -თ unless the subject is 3pl (გიწერთ: I / he write(s) to you all)
  if (objective && o === '2pl' && s !== '3pl' && !end.endsWith('თ')) end = end.replace(/ს$/, '') + 'თ';
  if (end) parts.push(P(end, 'ending', s));
  return { form: parts.map((p) => p.s).join(''), parts };
}

export function paradigm(verb, screeve, version = 'neutral', o = '3sg') {
  return PERSONS.map((s) => ({ s, ...(verbForm(verb, { screeve, s, o, version }) || { form: '—', parts: [] }) }));
}

// Every form a verb has here: [{ form, parts, screeve, s, o, version }]
// 6 screeves x (6 + 6 + 36) person combinations = at most 288 forms per verb, cheap enough to regenerate on every
// analyze() call; no cache needed at the dictionary sizes used here.
export function allForms(verb) {
  const out = [];
  for (const sc of SCREEVES) {
    for (const version of ['neutral', 'subjective', 'objective']) {
      for (const o of version === 'objective' ? PERSONS : ['3sg']) {
        for (const s of PERSONS) {
          const f = verbForm(verb, { screeve: sc.id, s, o, version });
          if (f) out.push({ ...f, screeve: sc.id, s, o: version === 'objective' ? o : null, version });
        }
      }
    }
  }
  return out;
}

// Longest first: Array.find returns the first match, so compound preverbs (გადმო) must precede their parts (გა, მო).
const PREVERBS = ['გადმო', 'გადა', 'შემო', 'ჩამო', 'წამო', 'გამო', 'ამო', 'მი', 'მო', 'და', 'გა', 'ჩა', 'შე', 'წა', 'ა', 'ცა'];
const TS = ['ებ', 'ობ', 'ავ', 'ამ', 'ი'];

// A word taken apart. Known verbs and nouns are matched exactly; otherwise affixes are stripped heuristically and
// the remainder is shown as the root (marked as a guess).
export function analyze(word, { verbs = [], nouns = [] } = {}) {
  const w = String(word).trim();
  const out = [];
  for (const v of verbs) {
    for (const f of allForms(v)) if (f.form === w) out.push({ parts: f.parts, score: 1, source: 'verb', verb: v.id, screeve: f.screeve, s: f.s, o: f.o, version: f.version });
  }
  for (const n of nouns) {
    const d = decline(n.word || n);
    for (const group of [d.cases, d.plural, d.post]) for (const c of group) if (c.form === w) out.push({ parts: c.parts, score: 1, source: 'noun', noun: n.word || n, form: c.id });
  }
  if (out.length) {
    // the same split can come from several readings (persons that look alike): keep each reading
    return out;
  }
  // heuristic noun reading: postposition, case, plural
  // Strip from the outside in (postposition, case, plural: the reverse of affixation order). Each strip requires a
  // remainder of 2+ letters so tiny words are not reduced to nothing. Score grows with the number of recognised
  // affixes.
  // KNOWN DEFECT: 'ებს' is listed with a null tag, so for a plural dative (სახლებს) find() stops there, no case is
  // stripped, the plural step then fails too (the word still ends in -ს), and no noun reading is produced at all.
  // Fix: give the entry the tag 'dat' and strip only 'ს' for it, leaving -ებ to the plural step.
  const nounParts = [];
  let rest = w;
  const pp = POSTPOSITIONS.find((p) => rest.endsWith(p.s) && rest.length > p.s.length + 1);
  if (pp) { nounParts.unshift(P(pp.s, 'post', pp.id)); rest = rest.slice(0, -pp.s.length); }
  const caseEnd = [['ებს', null], ['ის', 'gen'], ['ით', 'ins'], ['ად', 'adv'], ['მა', 'erg'], ['ი', 'nom'], ['ს', 'dat'], ['ო', 'voc'], ['მ', 'erg']]
    .find(([e]) => e && rest.endsWith(e) && rest.length > e.length + 1);
  if (caseEnd && caseEnd[1]) { nounParts.unshift(P(caseEnd[0], 'case', caseEnd[1])); rest = rest.slice(0, -caseEnd[0].length); }
  if (rest.endsWith('ებ') && rest.length > 3) { nounParts.unshift(P('ებ', 'plural')); rest = rest.slice(0, -2); }
  nounParts.unshift(P(rest, 'stem'));
  if (nounParts.length > 1) out.push({ parts: nounParts, score: 0.4 + 0.1 * (nounParts.length - 1), source: 'guess-noun' });
  // heuristic verb reading
  // Prefixes left to right (preverb, person, version), suffixes right to left (ending, -დ-, thematic); the middle is
  // the root. Length guards keep at least a plausible root. Accepted only if 2+ slots besides the root were found.
  const vp = [];
  rest = w;
  const pv = PREVERBS.find((p) => rest.startsWith(p) && rest.length > p.length + 2);
  if (pv) { vp.push(P(pv, 'preverb')); rest = rest.slice(pv.length); }
  if (rest.startsWith('გვ')) { vp.push(P('გვ', 'obj', '1pl')); rest = rest.slice(2); }
  else if (/^[ვმგ]/.test(rest) && rest.length > 3) { vp.push(P(rest[0], rest[0] === 'ვ' ? 'subj' : 'obj', rest[0] === 'ვ' ? '1sg' : rest[0] === 'მ' ? '1sg' : '2sg')); rest = rest.slice(1); }
  if (/^[აიუე]/.test(rest) && rest.length > 3) { vp.push(P(rest[0], 'version')); rest = rest.slice(1); }
  const tail = [];
  const endM = /(ნენ|ენ|ან|ით|ეთ|ეს|ს|თ|ი|ა|ე)$/.exec(rest);
  if (endM && rest.length > endM[1].length + 1) { tail.unshift(P(endM[1], 'ending')); rest = rest.slice(0, -endM[1].length); }
  if (rest.endsWith('დ') && rest.length > 2) { tail.unshift(P('დ', 'screeve')); rest = rest.slice(0, -1); }
  const ts = TS.find((x) => rest.endsWith(x) && rest.length > x.length + 1);
  if (ts) { tail.unshift(P(ts, 'ts')); rest = rest.slice(0, -ts.length); }
  if (rest) vp.push(P(rest, 'root'));
  vp.push(...tail);
  if (vp.length > 2) out.push({ parts: vp, score: 0.3 + 0.08 * vp.length, source: 'guess-verb' });
  out.sort((a, b) => b.score - a.score);
  return out.length ? out : [{ parts: [P(w, 'stem')], score: 0, source: 'unknown' }];
}

// --- numbers: the vigesimal system (counting in twenties) ----------------------------------------------------------
const UNITS = ['', 'ერთი', 'ორი', 'სამი', 'ოთხი', 'ხუთი', 'ექვსი', 'შვიდი', 'რვა', 'ცხრა', 'ათი', 'თერთმეტი', 'თორმეტი', 'ცამეტი', 'თოთხმეტი', 'თხუთმეტი', 'თექვსმეტი', 'ჩვიდმეტი', 'თვრამეტი', 'ცხრამეტი'];
const TWENTIES = ['', 'ოც', 'ორმოც', 'სამოც', 'ოთხმოც'];
const HUNDREDS = ['', 'ას', 'ორას', 'სამას', 'ოთხას', 'ხუთას', 'ექვსას', 'შვიდას', 'რვაას', 'ცხრაას'];

// n (0 … 999 999) -> { text, parts: [{ s, value, note }] } where the parts show the arithmetic (2 × 20 + 15 …)
// Below 100 Georgian counts in twenties: 55 = ორმოცდათხუთმეტი "two-twenty-and-fifteen". The tens stem takes -ი only
// when it ends the number (ორმოცი, ასი, ათასი) and is bare before და or a following group: the `final` flag carries
// that. Input is clamped (abs, floor, max 999 999) rather than rejected: a teaching widget should always show words.
export function numberWords(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n === 0) return { text: 'ნული', parts: [{ s: 'ნული', value: 0, note: 'zero' }] };
  if (n > 999999) n = 999999;
  const parts = [];
  const under100 = (x, final) => {
    const t = Math.floor(x / 20), r = x % 20;
    if (t && r) { parts.push({ s: TWENTIES[t], value: t * 20, note: t === 1 ? '20' : t + '×20' }, { s: 'და', value: 0, note: '+' }, { s: UNITS[r], value: r, note: String(r) }); }
    else if (t) parts.push({ s: TWENTIES[t] + (final ? 'ი' : ''), value: t * 20, note: t === 1 ? '20' : t + '×20' });
    else if (r) parts.push({ s: UNITS[r], value: r, note: String(r) });
  };
  const under1000 = (x, final) => {
    const h = Math.floor(x / 100), r = x % 100;
    if (h) parts.push({ s: HUNDREDS[h] + (r || !final ? '' : 'ი'), value: h * 100, note: h === 1 ? '100' : h + '×100' });
    if (h && r) parts.push({ s: ' ', value: 0, note: '' });
    if (r) under100(r, final);
  };
  const th = Math.floor(n / 1000), rest = n % 1000;
  if (th) {
    if (th > 1) { under1000(th, false); parts.push({ s: ' ', value: 0, note: '×' }); }
    parts.push({ s: 'ათას' + (rest ? '' : 'ი'), value: 1000, note: '1000' });
    if (rest) parts.push({ s: ' ', value: 0, note: '+' });
  }
  if (rest) under1000(rest, true);
  return { text: parts.map((p) => p.s).join('').replace(/\s+/g, ' ').trim(), parts: parts.filter((p) => p.s.trim()) };
}
