// lingua/morph-en.js - English words taken apart before (and beside) the dictionary: prefixes (un-, re-, dis-,
// pre-, trans- …), Latin, Greek and Germanic roots with their families, suffixes with the rule they make (-er the
// doer, -ness the quality, -less without, -able able to be, -ize to make …) and inflections (-s, -ed, -ing); register
// labels for attested words (substandard irregardless, colloquial gonna, bookish ameliorate …).
//
//   parseEn(word, { max }) -> [reading]     rootsEn()     attestedEn(word) -> labels | null
//   wordsEn()   searchEn({ prefix, root, suffix, text, filter })   possibleEn(root)   addAttestedEn(words)

import { createMorph, parseFlags } from './morph.js';

// Inventory spec for createMorph (morph.js): slots prefix (0..2) + root (exactly 1) + suffix (0..3) + ending (0..1).
// Data tables below: header comments only. Everything derived (roots, attested set, word list) is built lazily on
// first use and memoised in module variables, so importing the module costs nothing until a parse is requested.

const G = (ru, en) => ({ ru, en });
const norm = (w) => String(w).toLowerCase().trim().replace(/[^a-z'-]/g, '');

export const PREFIXES_EN = [['un', 'не-; обратное действие', 'not; reverse'], ['re', 'снова, назад', 'again, back'], ['dis', 'не-, раз-', 'not, apart'], ['mis', 'неправильно', 'wrongly'],
  ['pre', 'до, перед', 'before'], ['post', 'после', 'after'], ['anti', 'против', 'against'], ['de', 'от-, вниз, лишение', 'down, remove'], ['ex', 'из, бывший', 'out, former'],
  ['in', 'не-; в', 'not; in'], ['im', 'не-; в', 'not; in'], ['il', 'не-', 'not'], ['ir', 'не-', 'not'], ['inter', 'между', 'between'], ['trans', 'через, пере-', 'across'],
  ['sub', 'под', 'under'], ['super', 'сверх', 'above'], ['over', 'пере-, сверх', 'too much, over'], ['under', 'недо-, под', 'too little, under'], ['co', 'со-', 'together'],
  ['con', 'со-, вместе', 'with'], ['com', 'со-, вместе', 'with'], ['pro', 'вперёд, за', 'forward, for'], ['auto', 'само-', 'self'], ['bi', 'дву-', 'two'], ['tri', 'трёх-', 'three'],
  ['multi', 'много-', 'many'], ['micro', 'микро-', 'small'], ['tele', 'теле-, далеко', 'far'], ['non', 'не-', 'not'], ['semi', 'полу-', 'half'], ['out', 'пере-, сверх', 'beyond'],
  ['fore', 'перед, заранее', 'before'], ['ad', 'к', 'to'], ['ab', 'от', 'away'], ['en', 'в-, делать', 'make, in'], ['em', 'в-, делать', 'make, in'], ['a', 'без; на', 'without; on']]
  .map(([s, ru, en]) => ({ s, tag: s, gloss: G(ru, en) }));

// Suffix table: one call per semantic class; the tag is what RULES match on, so many surface forms share one rule.
const S = (list, tag, ru, en) => list.split(' ').map((s) => ({ s, tag, gloss: G(ru, en) }));
export const SUFFIXES_EN = [
  ...S('er or ar ist ant ent ee eer ian', 'agent', 'деятель, лицо', 'doer, person'), ...S('ness ity ty ism hood ship dom ance ence cy', 'quality', 'качество, состояние', 'quality, state'),
  ...S('tion sion ation ition ion ment al ure age', 'action', 'действие, результат', 'action, result'), ...S('less', 'without', 'без', 'without'), ...S('ful ous ious y', 'full', 'полный, обладающий', 'full of'),
  ...S('able ible', 'able', 'который можно', 'able to be'), ...S('ive ative ic ical al ary ory', 'adj', 'относящийся к, свойственный', 'relating to'), ...S('ish', 'ish', 'как бы, -оватый', 'somewhat, like'),
  ...S('ize ise ify ate en', 'verb', 'делать, превращать в', 'make'), ...S('ly', 'adv', 'наречие: образом', 'in a … manner'), ...S('ward wards wise', 'adv', 'направление, образ', 'direction, manner'),
  ...S('let ling ette ie', 'dim', 'уменьшительное', 'diminutive'), ...S('ess', 'fem', 'женский род', 'feminine'), ...S('logy ology', 'science', 'наука о', 'study of'), ...S('graph gram', 'write', 'запись', 'writing'),
];
// Inflections get w: -0.1 so that an ambiguous ending ('er' agent vs comparative) prefers the derivational reading.
const INFL = [['s', 'pl', 'мн. ч. / 3 л.', 'plural / 3rd person'], ['es', 'pl', 'мн. ч. / 3 л.', 'plural / 3rd person'], ['ed', 'past', 'прош. вр. / причастие', 'past'], ['d', 'past', 'прош. вр.', 'past'],
  ['ing', 'ing', 'длительность, герундий', 'progressive, gerund'], ['er', 'comp', 'сравнительная степень', 'comparative'], ['est', 'sup', 'превосходная степень', 'superlative'], ["'s", 'poss', 'притяжательное', 'possessive']]
  .map(([s, tag, ru, en]) => ({ s, tag, gloss: G(ru, en), w: -0.1 }));

// root | alternants | pos | Russian | English | words with flags
// Data table, one family per line. Flags are morph.js parseFlags codes; '!x' marks a word that only looks related
// (destroy under struct, delight under light): it is attested but not listed as a member of the family.
export const EN_FAMILIES = `
dict|dic|v|говорить|say|dictate,dictation,dictionary,predict,prediction,contradict,verdict,diction!book,indicate!x,edict!book,dictator
spect|spic,spec|v|смотреть|look|inspect,inspector,respect,respectful,spectator,spectacle,prospect,suspect,perspective,specimen,conspicuous!book,introspection!book
port||v|нести|carry|port,portable,export,import,transport,support,report,reporter,deport,porter,passport,opportunity!x
scrib|script|v|писать|write|scribe,describe,description,prescribe,prescription,subscribe,subscription,manuscript,script,inscription,transcribe,scribble!col
duc|duct|v|вести|lead|produce,product,production,reduce,reduction,introduce,conduct,conductor,educate,education,induce!book,deduct,abduct
mit|miss|v|посылать|send|transmit,admit,permit,emit,submit,mission,missile,dismiss,permission,commit,omit,intermittent!book
ject||v|бросать|throw|reject,inject,project,object,subject,eject,projector,dejected!book,interject!book
form||n|форма|shape|form,formal,inform,information,reform,transform,uniform,platform,deform,formula,formation
struct|stru|v|строить|build|structure,construct,construction,destroy!x,instruct,instruction,infrastructure,obstruct
vid|vis|v|видеть|see|video,vision,visible,invisible,visit,revise,supervise,evident,provide,television,visual,vista!book
aud|audi|v|слышать|hear|audio,audience,audible,inaudible,audition,auditorium,auditor!spec
graph|gram|n|писать, черта|write|graph,graphic,photograph,paragraph,biography,autograph,geography,telegram,diagram,grammar,calligraphy!book
phon||n|звук|sound|phone,telephone,microphone,symphony,phonetics,headphones,saxophone,euphony!book
log|logy|n|слово, наука|word, study|logic,biology,dialogue,catalogue,apology,technology,psychology,monologue,prologue,analogy
bio||n|жизнь|life|biology,biography,biome!spec,antibiotic,biochemistry,symbiosis!book
geo||n|земля|earth|geography,geology,geometry,geopolitics!book
chron||n|время|time|chronic,chronology,synchronize,chronicle,anachronism!book
cred||v|верить|believe|credit,credible,incredible,creditor,credentials,creed!book,credulous!book
fac|fact,fic,fect|v|делать|do, make|factory,fact,manufacture,effect,affect,perfect,defect,efficient,sufficient,facility,artifact
cap|capt,cept,ceiv|v|брать|take|capture,captive,accept,except,concept,receive,deceive,perceive,capable,reception,intercept
tract||v|тянуть|pull|tractor,attract,attraction,subtract,extract,contract,distract,abstract,traction
vert|vers|v|поворачивать|turn|convert,reverse,version,diverse,advertise,universe,vertical,introvert,controversy!book
mov|mot,mob|v|двигать|move|move,movement,remove,motion,motor,mobile,emotion,promote,remote,automobile,locomotive
pon|pos,pound|v|класть|put|position,compose,composer,component,propose,deposit,expose,oppose,postpone,compound,impose
press||v|давить|press|press,pressure,express,impress,impression,depress,depression,suppress,compress,oppress!book
rupt||v|рвать|break|rupture,erupt,interrupt,corrupt,bankrupt,disrupt,abrupt
sent|sens|v|чувствовать|feel|sense,sensitive,sensation,sentiment,consent,resent,nonsense,sentence!x
spir||v|дышать|breathe|inspire,inspiration,expire,respiration,conspire,aspire,spirit,perspire!book
tend|tens,tent|v|тянуть, стремиться|stretch|extend,extension,intend,intention,attend,attention,pretend,tension,tense,tendency,content!x
vol|volu,volv|v|хотеть; катить|wish; roll|volunteer,voluntary,benevolent!book,revolve,evolve,evolution,involve,revolution,volume
work||v|работать|work|work,worker,workshop,homework,network,framework,overwork,rework,workable,workaholic!col
friend||n|друг|friend|friend,friendly,friendship,unfriendly,friendless,befriend,unfriend!col
child||n|ребёнок|child|child,childhood,childish,childless,childcare,children,grandchild
hand||n|рука|hand|hand,handy,handful,handle,handbag,handwriting,beforehand,secondhand,handicraft,handsome!x
heart||n|сердце|heart|heart,hearty,heartless,heartbeat,heartbreak,sweetheart,wholehearted,hearten!book
kind||a|добрый|kind|kind,kindness,unkind,kindly,kindhearted,kindliness!book
happ||a|удача; случаться|luck; happen|happy,happiness,unhappy,happen,perhaps,mishap,haphazard,happily,hapless!book
light||n|свет; лёгкий|light|light,lighten,lighter,lightning,daylight,highlight,flashlight,delight!x,enlighten!book
know|knowl,acknowl|v|знать|know|know,knowledge,acknowledge,unknown,knowing,knowledgeable,knowhow!col
think|thought|v|думать|think|think,thinker,rethink,thoughtful,thoughtless,afterthought,unthinkable
say|said|v|сказать|say|say,saying,unsaid,hearsay!col,gainsay!arch
go|went,gone|v|идти|go|go,going,undergo,outgo!rare,forgo,ongoing,gonna!col,goer!rare
regard||v|считать, касаться|regard|regard,regardless,irregardless!sub,disregard,regards,regarding
ain't|aint|v|не быть (просторечие)|is not (substandard)|ain't!sub
`;

let ROOTS = null, ATT = null, WORDS = null;
// Parses EN_FAMILIES once and fills ATT (word -> labels). First occurrence wins in ATT, so a word listed under two
// roots keeps the labels of the first. A substandard word defaults to lit 'unattested'.
export function rootsEn() {
  if (ROOTS) return ROOTS;
  ROOTS = [];
  ATT = new Map();
  for (const line of EN_FAMILIES.split('\n')) {
    if (!line.trim()) continue;
    const [s, alt, pos, ru, en, words] = line.split('|');
    const r = { s, alt: alt ? alt.split(',').filter(Boolean) : [], pos, gloss: G(ru, en), words: [] };
    for (const item of (words || '').split(',').filter(Boolean)) {
      const [w, fl = ''] = item.trim().split('!');
      const f = parseFlags(fl);
      const labels = { use: f.use || 'common', norm: f.norm || 'norm', lit: f.lit || (f.norm === 'substandard' ? 'unattested' : 'neutral'), own: false };
      if (fl !== 'x') r.words.push({ w: norm(w), labels });
      if (!ATT.has(norm(w))) ATT.set(norm(w), { labels: fl === 'x' ? { use: 'common', norm: 'norm', lit: 'neutral', own: false } : labels });
    }
    ROOTS.push(r);
  }
  return ROOTS;
}
// A word or its inflected form (workers → worker, tried → try, making → make). Candidate stems are tried in order,
// first hit wins; no stem rule is conditional, so false stems ('bus' -> 'bu') are possible but harmless because
// they must exist in ATT and be at least 3 letters long.
export function attestedEn(w) {
  rootsEn();
  const x = norm(w);
  for (const c of [x, x.replace(/'s$/, ''), x.replace(/s$/, ''), x.replace(/es$/, ''), x.replace(/ies$/, 'y'), x.replace(/ed$/, ''), x.replace(/d$/, ''), x.replace(/ied$/, 'y'), x.replace(/ing$/, ''), x.replace(/ing$/, 'e')]) {
    const a = ATT.get(c);
    if (a && c.length >= 3) return a.labels;
  }
  return null;
}
// Merge words from an external list (a dictionary) without overriding curated labels; invalidates the word cache.
export function addAttestedEn(words, labels = { use: 'common', norm: 'norm', lit: 'neutral', own: false }) {
  rootsEn();
  let n = 0;
  for (const w of words) if (w && /^[a-z'-]+$/i.test(w) && !ATT.has(norm(w))) { ATT.set(norm(w), { labels }); n++; }
  if (n) WORDS = null;
  return n;
}

// Rules match suffix / prefix tags; prio 1 lifts the specific ones (-less, -logy, negation, re-) over the generic
// 'prefix' / 'inflected form' fallbacks.
const RULES = [
  { id: 'en.agent', need: { suffix: ['agent'] }, pos: 'n', name: G('лицо, деятель', 'agent'), mean: G('тот, кто: {root}', 'one who: {root}') },
  { id: 'en.quality', need: { suffix: ['quality'] }, pos: 'n', name: G('качество', 'quality'), mean: G('качество, состояние: {root}', 'quality of: {root}') },
  { id: 'en.action', need: { suffix: ['action'] }, pos: 'n', name: G('действие, результат', 'action noun'), mean: G('действие, результат: {root}', 'act of: {root}') },
  { id: 'en.without', need: { suffix: ['without'] }, prio: 1, pos: 'a', name: G('-less: лишённость', '-less'), mean: G('без: {root}', 'without: {root}') },
  { id: 'en.full', need: { suffix: ['full'] }, pos: 'a', name: G('-ful / -ous: обладание', '-ful'), mean: G('полный, с: {root}', 'full of: {root}') },
  { id: 'en.able', need: { suffix: ['able'] }, pos: 'a', name: G('-able: возможность', '-able'), mean: G('который можно: {root}', 'that can be: {root}') },
  { id: 'en.adj', need: { suffix: ['adj'] }, pos: 'a', name: G('прилагательное', 'adjective'), mean: G('относящийся к: {root}', 'relating to: {root}') },
  { id: 'en.verb', need: { suffix: ['verb'] }, pos: 'v', name: G('глагол: делать', 'verb: make'), mean: G('делать, превращать: {root}', 'make: {root}') },
  { id: 'en.adv', need: { suffix: ['adv'] }, pos: 'adv', name: G('наречие', 'adverb'), mean: G('образом: {root}', 'in a way: {root}') },
  { id: 'en.dim', need: { suffix: ['dim'] }, pos: 'n', name: G('уменьшительное', 'diminutive'), mean: G('маленький: {root}', 'little: {root}') },
  { id: 'en.science', need: { suffix: ['science'] }, prio: 1, pos: 'n', name: G('наука о', 'study'), mean: G('наука о: {root}', 'study of: {root}') },
  { id: 'en.neg', need: { prefix: ['un', 'il', 'ir', 'non', 'dis'] }, prio: 1, pos: 'a', name: G('отрицание', 'negation'), mean: G('не, обратное: {root}', 'not: {root}') },
  { id: 'en.again', need: { prefix: ['re'] }, prio: 1, pos: 'v', name: G('re-: снова', 're-'), mean: G('снова: {root}', 'again: {root}') },
  { id: 'en.pref', need: { prefix: true }, pos: 'form', name: G('приставка', 'prefix'), mean: G('{prefix}: {root}', '{prefix}: {root}') },
  { id: 'en.form', need: { ending: true }, pos: 'form', name: G('словоформа', 'inflected form'), mean: G('{root} ({ending})', '{root} ({ending})') },
];

let M = null;
const morph = () => M || (M = createMorph({
  lang: 'en', norm,
  slots: [{ role: 'prefix', items: PREFIXES_EN, max: 2 }, { role: 'root', items: rootsEn().map((r) => ({ s: r.s, alt: r.alt, pos: r.pos, gloss: r.gloss, w: 0.3 })), min: 1, max: 1 },
    { role: 'suffix', items: SUFFIXES_EN, max: 3 }, { role: 'ending', items: INFL, max: 1 }],
  rules: RULES, attested: attestedEn, unknownRoot: { min: 3, penalty: 2.5 },
}));
export const parseEn = (w, o) => morph().parse(w, o);

// Every attested word with its best reading. Expensive (one parse per word), hence the cache cleared by
// addAttestedEn.
export function wordsEn() {
  if (WORDS) return WORDS;
  rootsEn();
  WORDS = [...ATT].map(([w, a]) => ({ w, labels: a.labels, mean: null, reading: parseEn(w, { max: 1 })[0] || null }));
  return WORDS;
}
const partOf = (r, role) => (r ? r.parts.filter((p) => p.role === role).map((p) => p.s) : []);
// Linear filter over wordsEn(). A root query matches the parsed root forms or explicit family membership (the
// latter catches words whose parse found a different root). The label filter duplicates morph.js matchLabels.
export function searchEn({ prefix = '', root = '', suffix = '', text = '', filter = null, limit = 300 } = {}) {
  const out = [];
  for (const x of wordsEn()) {
    const r = x.reading;
    if (prefix && !partOf(r, 'prefix').includes(prefix)) continue;
    if (suffix && !partOf(r, 'suffix').includes(suffix)) continue;
    if (root) { const R = rootsEn().find((y) => y.s === root); const forms = R ? [R.s, ...R.alt] : [root]; if (!partOf(r, 'root').some((s) => forms.includes(s)) && !(R && R.words.some((y) => y.w === x.w))) continue; }
    if (text && !x.w.includes(norm(text))) continue;
    if (filter && !['use', 'norm', 'lit'].every((k) => !filter[k] || !filter[k].length || filter[k].includes(x.labels[k]))) continue;
    out.push(x);
    if (out.length >= limit) break;
  }
  return out;
}
// Attested family members plus derivations the rules allow for the root's part of speech, generated from the first
// listed word as base. Plain concatenation, no spelling rules (happy + ness, not happiness): a learning aid, so
// unattested forms are labelled 'unattested' with own meaning rather than hidden.
export function possibleEn(rootS) {
  const r = rootsEn().find((x) => x.s === rootS || x.alt.includes(rootS));
  if (!r) return [];
  const out = [];
  const add = (w, ruleId) => {
    w = norm(w);
    if (out.some((x) => x.w === w)) return;
    const att = attestedEn(w);
    const rule = RULES.find((x) => x.id === ruleId);
    out.push({ w, attested: !!att, rule: rule ? rule.name : null, mean: rule ? { ru: rule.mean.ru.replace('{root}', r.gloss.ru).replace(/\{\w+\}/g, '').trim(), en: rule.mean.en.replace('{root}', r.gloss.en).replace(/\{\w+\}/g, '').trim() } : null,
      labels: att || { use: 'rare', norm: 'norm', lit: 'unattested', own: true } });
  };
  for (const x of r.words) add(x.w, null);
  const base = r.words[0] ? r.words[0].w : r.s;
  if (r.pos === 'n') { add(base + 'less', 'en.without'); add(base + 'ful', 'en.full'); add(base + 'hood', 'en.quality'); add(base + 'let', 'en.dim'); }
  if (r.pos === 'a') { add(base + 'ness', 'en.quality'); add('un' + base, 'en.neg'); add(base + 'ly', 'en.adv'); }
  if (r.pos === 'v') { add('re' + base, 'en.again'); add(base + 'er', 'en.agent'); add(base + 'able', 'en.able'); add('mis' + base, 'en.pref'); }
  return out;
}
