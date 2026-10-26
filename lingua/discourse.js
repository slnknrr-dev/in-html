// lingua/discourse.js - what happens in a text: sentences and clauses, the predicate and its arguments in each clause
// (who does what to whom), entities and their mentions across the text (coreference by lemma and pronouns, simple),
// the topic chain (continued / shifted / returned / new), events in order, dialogue lines with speakers and the
// author's words, complex constructions; and the graphs of all this in the neutral graph model of diagram/graph.js
// ({ direction, nodes, edges, groups }) with a Mermaid flowchart export. Georgian goes through kartuli-syntax.js;
// Russian and English get simple rules (word endings and word lists) - enough to follow a plain narrative.
//
//   detectLang(text) -> 'ka' | 'ru' | 'en'
//   segments(text) -> [{ line, kind: 'narration' | 'speech' | 'author', text, who? }]
//   analyzeText(text, { lang }) -> { lang, sentences, entities, events, dialogue, issues }
//       sentence: { i, text, kind, line, speaker, addressee, clauses, topic, transition, spans }
//       clause: { id, type, conj, pred: { t, lemma, gloss, tense }, args: [{ role, t, ent }], adjuncts, constructions, issues, reported }
//   clauseGraph(a) / entityGraph(a) / topicGraph(a) -> graph       toMermaid(graph) -> flowchart text
//
// Key decisions:
// - One common clause shape for all languages ({ type, conj, pred, args, adjuncts }), produced by two very
//   different front ends: a real morphological parser for Georgian, word lists + suffix heuristics for ru/en. Every
//   later stage (coreference, topics, events, graphs) is language-neutral and only reads that shape.
// - Heuristics are tuned for plain narrative prose (fairy tales, textbook dialogues), the app's material. They are
//   precision-leaning: an unknown role becomes 'other', an unresolved pronoun stays without an entity; downstream
//   graphs then omit it rather than draw a wrong edge.
// - Coreference is deliberately simple (Centering-theory flavoured): a 3rd-person pronoun picks among entities
//   mentioned in the last 2 sentences, preferring the previous topic, then recency, then humans; gender/number filter
//   first. No machine learning, fully explainable to a learner.
// - Graphs are emitted in the neutral model of diagram/graph.js, so the same analysis can be drawn natively or
//   exported to Mermaid without the analyzer knowing about either renderer.

import { analyzeKa, CLAUSE_TYPES } from './kartuli-syntax.js';
import { SERIES, analyzeWord } from './kartuli-grammar.js';

// Majority script vote; ties favour ka then ru (a Georgian text quoting an English name is still Georgian).
// Latin counts only a-z: other Latin-script languages fall to 'en', the only Latin language analysed.
export function detectLang(text) {
  const s = String(text);
  const ka = (s.match(/[ა-ჿ]/g) || []).length, ru = (s.match(/[а-яё]/gi) || []).length, en = (s.match(/[a-z]/gi) || []).length;
  return ka >= ru && ka >= en && ka > 0 ? 'ka' : ru >= en && ru > 0 ? 'ru' : 'en';
}

// --- dialogue and the author's words ------------------------------------------------------------------------------
// Line-based segmentation into speech / author / narration, recognising three conventions in priority order:
// 1. Russian/Georgian dialogue dash at line start: alternating speech and author words split at " — ";
// 2. play format "NAME: text" (name up to 24 chars and 3 words, so "Note: ..." in prose rarely matches... but can);
// 3. inline quotes: quoted spans are speech. Quote pairs per typography: „...“ (Georgian, German), «...», “...”, "...".
//    „ also accepts ” as closer because both styles occur in Georgian texts. An unclosed quote is plain text.
const OPEN_Q = '„«“"', CLOSE_Q = { '„': '“', '«': '»', '“': '”', '"': '"' };
export function segments(text) {
  const out = [];
  String(text).replace(/\r\n?/g, '\n').split('\n').forEach((raw, line) => {
    const l = raw.trim();
    if (!l) return;
    const dash = /^[—–-]\s*(.*)$/.exec(l);
    if (dash) {
      // — speech, — author. — speech …
      const parts = splitDashes(dash[1]);
      parts.forEach((p, k) => { if (p.trim()) out.push({ line, kind: k % 2 ? 'author' : 'speech', text: p.trim() }); });
      return;
    }
    const play = /^([^\s:：„«"][^:：„«"]{0,23})[:：]\s+(.+)$/.exec(l);
    if (play && play[1].split(/\s+/).length <= 3) { out.push({ line, kind: 'speech', text: play[2].trim(), who: play[1].trim() }); return; }
    // quotes inside a line: quoted spans are speech, the rest the author's words
    let i = 0, buf = '';
    const pushAuthor = (kind) => { if (buf.trim()) out.push({ line, kind, text: buf.trim() }); buf = ''; };
    let hasQuote = false;
    while (i < l.length) {
      const c = l[i];
      if (OPEN_Q.includes(c)) {
        const close = CLOSE_Q[c];
        const j = l.indexOf(close, i + 1);
        const j2 = c === '„' && j < 0 ? l.indexOf('”', i + 1) : j;
        if (j2 > i) { pushAuthor('author'); out.push({ line, kind: 'speech', text: l.slice(i + 1, j2).trim() }); hasQuote = true; i = j2 + 1; continue; }
      }
      buf += c; i++;
    }
    pushAuthor(hasQuote ? 'author' : 'narration');
  });
  return out;
}
function splitDashes(s) {
  // the author's words are set off by " — " (after a comma, a stop or an exclamation in the speech)
  const out = [];
  let cur = '';
  const parts = s.split(/(\s[—–]\s)/);
  for (const p of parts) { if (/^\s[—–]\s$/.test(p)) { out.push(cur); cur = ''; } else cur += p; }
  out.push(cur);
  return out.map((x) => x.replace(/^[,\s]+|[,\s]+$/g, '').trim());
}
// Simpler than align.js sentencesOf (no abbreviation list): segments are short dialogue lines here, and the
// analysis tolerates an occasional over-split, while alignment does not.
const sentencesOf = (t) => String(t).split(/(?<=[.!?…])\s+(?=\S)/).map((x) => x.trim()).filter(Boolean);

// --- simple Russian and English clauses -------------------------------------------------------------------------
// Word-list "grammars". pron: form -> [person, case, gender?]; conj: subordinator -> clause type; verbEnd: Russian
// verb suffixes (inflection and infinitive); notVerb: the nouns/adverbs those suffixes would misclassify (мать, село,
// пять) - an exception list is cheaper and more predictable than a POS model at this scale. English verbs are a
// closed list plus the regular -ed past. human: nouns that may speak or be addressed (speaker detection, isHuman).
const RU = {
  pron: { 'я': ['1sg', 'nom'], 'ты': ['2sg', 'nom'], 'он': ['3sg', 'nom', 'm'], 'она': ['3sg', 'nom', 'f'], 'оно': ['3sg', 'nom', 'n'], 'мы': ['1pl', 'nom'], 'вы': ['2pl', 'nom'], 'они': ['3pl', 'nom'],
    'меня': ['1sg', 'acc'], 'тебя': ['2sg', 'acc'], 'его': ['3sg', 'acc', 'm'], 'её': ['3sg', 'acc', 'f'], 'ее': ['3sg', 'acc', 'f'], 'нас': ['1pl', 'acc'], 'вас': ['2pl', 'acc'], 'их': ['3pl', 'acc'],
    'мне': ['1sg', 'dat'], 'тебе': ['2sg', 'dat'], 'ему': ['3sg', 'dat', 'm'], 'ей': ['3sg', 'dat', 'f'], 'нам': ['1pl', 'dat'], 'вам': ['2pl', 'dat'], 'им': ['3pl', 'dat'], 'него': ['3sg', 'acc', 'm'], 'неё': ['3sg', 'acc', 'f'], 'ней': ['3sg', 'obl', 'f'], 'нему': ['3sg', 'dat', 'm'], 'них': ['3pl', 'obl'] },
  conj: { 'и': 'coord', 'а': 'coord', 'но': 'coord', 'или': 'coord', 'однако': 'coord', 'что': 'complement', 'чтобы': 'complement', 'когда': 'temporal', 'пока': 'temporal', 'если': 'conditional', 'потому': 'causal', 'так': 'causal', 'хотя': 'concessive', 'где': 'relative', 'куда': 'relative', 'откуда': 'relative' },
  rel: /^котор(ый|ая|ое|ые|ого|ой|ому|ую|ым|ом|ых|ыми)$/,
  prep: new Set(['в', 'во', 'на', 'из', 'с', 'со', 'к', 'ко', 'у', 'от', 'до', 'по', 'о', 'об', 'обо', 'за', 'под', 'над', 'перед', 'через', 'для', 'без', 'после', 'при', 'про', 'между', 'около', 'возле']),
  stop: new Set(['не', 'ни', 'же', 'ли', 'бы', 'уже', 'ещё', 'еще', 'очень', 'тоже', 'там', 'тут', 'здесь', 'потом', 'тогда', 'сейчас', 'вот', 'это', 'этот', 'эта', 'эти', 'тот', 'та', 'те', 'весь', 'вся', 'все', 'всё', 'мой', 'моя', 'моё', 'мои', 'твой', 'твоя', 'свой', 'своя', 'свои', 'наш', 'ваш', 'как', 'так', 'да', 'нет', 'ну', 'даже', 'только', 'снова', 'опять', 'вдруг', 'домой', 'дома', 'завтра', 'сегодня', 'вчера', 'утром', 'вечером', 'тихо', 'громко', 'быстро', 'медленно', 'хорошо', 'плохо', 'вместе', 'один', 'одна', 'чем']),
  say: /^(сказал|сказала|сказали|говорит|говорил|говорила|ответил|ответила|спросил|спросила|крикнул|крикнула|прошептал|прошептала|воскликнул|воскликнула|подумал|подумала|позвал|позвала|предложил|предложила|улыбнулась|улыбнулся)$/,
  verbEnd: /(ться|тся|ть|ти|ешь|ишь|ете|ите|ет|ит|ут|ют|ат|ят|ем|им|лся|лась|лось|лись|ла|ло|ли|л|ал|ял|ил|ел|айте|йте)$/,
  notVerb: new Set(['мать', 'путь', 'дверь', 'тетрадь', 'день', 'стол', 'пол', 'зал', 'вокзал', 'посол', 'дятел', 'козёл', 'котел', 'угол', 'орел', 'орёл', 'пепел', 'сокол', 'было', 'село', 'тело', 'дело', 'стекло', 'число', 'весло', 'мыло', 'крыло', 'шило', 'сила', 'пила', 'игла', 'мгла', 'скала', 'школа', 'пчела', 'стрела', 'дела', 'тела', 'зеркала', 'дали', 'поли', 'сейчас', 'опять', 'пять', 'десять', 'девять', 'шесть', 'семь', 'восемь', 'кровать', 'тетя', 'глаза', 'мили', 'числа', 'тепло', 'светло', 'много', 'мало', 'зло', 'около', 'земли', 'были', 'стали', 'дали', 'воды', 'мести', 'вести', 'нити', 'дети', 'сети', 'свет', 'ответ', 'совет', 'обед', 'пират', 'брат', 'сад', 'взгляд', 'отец', 'кот', 'рот', 'лёд', 'мёд', 'год', 'город', 'народ', 'завод', 'поход', 'вход', 'выход', 'кит', 'гость', 'кость', 'новость', 'радость', 'область', 'часть', 'власть', 'жизнь', 'осень', 'тень', 'лень', 'конь', 'огонь', 'камень', 'ремень', 'олень', 'ночь', 'дочь', 'речь', 'печь', 'бабушка', 'дедушка']),
  human: new Set(['мама', 'папа', 'мать', 'отец', 'брат', 'сестра', 'друг', 'подруга', 'девочка', 'мальчик', 'мужчина', 'женщина', 'бабушка', 'дедушка', 'учитель', 'учительница', 'человек', 'сын', 'дочь', 'гость', 'хозяин', 'хозяйка', 'старик', 'старуха', 'ребёнок', 'ребенок', 'дети', 'люди', 'сосед', 'соседка', 'врач', 'водитель', 'король', 'царь', 'царица', 'девушка', 'парень', 'официант']),
};
const EN = {
  pron: { 'i': ['1sg', 'nom'], 'you': ['2sg', 'nom'], 'he': ['3sg', 'nom', 'm'], 'she': ['3sg', 'nom', 'f'], 'it': ['3sg', 'nom', 'n'], 'we': ['1pl', 'nom'], 'they': ['3pl', 'nom'], 'me': ['1sg', 'acc'], 'him': ['3sg', 'acc', 'm'], 'her': ['3sg', 'acc', 'f'], 'us': ['1pl', 'acc'], 'them': ['3pl', 'acc'] },
  conj: { 'and': 'coord', 'but': 'coord', 'or': 'coord', 'so': 'coord', 'that': 'complement', 'when': 'temporal', 'while': 'temporal', 'before': 'temporal', 'after': 'temporal', 'until': 'temporal', 'if': 'conditional', 'because': 'causal', 'since': 'causal', 'although': 'concessive', 'though': 'concessive', 'who': 'relative', 'which': 'relative', 'whom': 'relative', 'whose': 'relative', 'where': 'relative' },
  prep: new Set(['in', 'on', 'at', 'to', 'from', 'with', 'by', 'for', 'of', 'into', 'onto', 'over', 'under', 'about', 'after', 'before', 'through', 'near', 'behind', 'across', 'towards', 'toward', 'without', 'around']),
  stop: new Set(['the', 'a', 'an', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'its', 'our', 'their', 'not', "n't", 'no', 'very', 'too', 'also', 'then', 'there', 'here', 'now', 'again', 'just', 'only', 'even', 'still', 'already', 'home', 'today', 'tomorrow', 'yesterday', 'yes', 'well', 'oh', 'so', 'quickly', 'slowly', 'together', 'away', 'back', 'up', 'down', 'out', 'off', 'all', 'some', 'every', 'each', 'any', 'one', 'two', 'three', 'what', 'how', 'why']),
  say: /^(said|says|say|asked|asks|answered|answers|replied|replies|shouted|shouts|whispered|whispers|told|tells|cried|called|thought|thinks|smiled|laughed)$/,
  verbs: new Set('be am is are was were been being have has had do does did go goes went gone come comes came see sees saw seen look looks looked take takes took give gives gave make makes made say says said tell tells told ask asks asked answer answered reply replied know knows knew think thinks thought want wants wanted like likes liked love loves loved get gets got find finds found leave leaves left bring brings brought buy buys bought eat eats ate drink drinks drank write writes wrote read reads open opens opened close closes closed run runs ran walk walks walked sit sits sat stand stands stood live lives lived work works worked play plays played sing sings sang dance dances danced cry cries cried laugh laughs laughed wait waits waited help helps helped meet meets met call calls called return returns returned begin begins began start starts started stop stops stopped become becomes became stay stays stayed sleep sleeps slept wake woke can could will would shall should may might must put puts send sends sent show shows showed hear hears heard feel feels felt lose loses lost win wins won build builds built draw draws drew cook cooks cooked wash washes washed fall falls fell keep keeps kept hold holds held turn turns turned smile smiles smiled kiss kisses kissed learn learns learned teach teaches taught grow grows grew die dies died'.split(' ')),
  human: new Set(['mother', 'father', 'mum', 'mom', 'dad', 'brother', 'sister', 'friend', 'girl', 'boy', 'man', 'woman', 'grandmother', 'grandfather', 'teacher', 'child', 'children', 'people', 'son', 'daughter', 'guest', 'host', 'neighbour', 'neighbor', 'doctor', 'driver', 'king', 'queen', 'waiter']),
};

// Tokenise (words with inner apostrophes/hyphens, and clause punctuation) and tag each token. Russian verb test is a
// conjunction of vetoes: not a pronoun/stop word/preposition/known noun/conjunction, longer than 2 letters, verb
// suffix, not capitalised mid-sentence (a name), and not a deverbal noun suffix (-ость, -ание, -тель).
function simpleWords(sentence, lang) {
  const L = lang === 'ru' ? RU : EN;
  const toks = String(sentence).match(/[\p{L}]+(?:['’-][\p{L}]+)*|[,;:]/gu) || [];
  return toks.map((t, k) => {
    const lw = t.toLowerCase();
    if (/^[,;:]$/.test(t)) return { t, punct: true };
    const pr = L.pron[lw];
    const isVerb = lang === 'ru' ? !pr && !L.stop.has(lw) && !RU.prep.has(lw) && !RU.notVerb.has(lw) && !L.conj[lw] && !RU.rel.test(lw) && lw.length > 2 && (RU.say.test(lw) || RU.verbEnd.test(lw)) && !(k > 0 && /^\p{Lu}/u.test(t)) && !/(ость|ание|ение|ель|тель)$/.test(lw)
      : EN.verbs.has(lw) || (/^[a-z]{3,}ed$/.test(lw) && !EN.stop.has(lw));
    return { t, lw, pron: pr || null, verb: isVerb, prep: L.prep.has(lw), conj: L.conj[lw] || (lang === 'ru' && RU.rel.test(lw) ? 'relative' : null), stop: L.stop.has(lw), cap: k > 0 && /^\p{Lu}/u.test(t) };
  });
}
// Pseudo-lemma: a stem by stripping the longest case ending (list ordered long to short; first hit wins) while keeping
// at least 3 letters. Only a coreference key: "маму"/"мама" -> "мам" must collide, the result need not be a word.
// English: strip possessive 's and a plural s (not after s: "glass" survives).
const RU_END = ['ами', 'ями', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ой', 'ей', 'ом', 'ем', 'ах', 'ях', 'ам', 'ям', 'ов', 'ев', 'ью', 'а', 'я', 'у', 'ю', 'е', 'ы', 'и', 'о', 'ь'];
function lemmaSimple(w, lang) {
  const lw = w.toLowerCase();
  if (lang === 'en') return lw.replace(/['’]s$/, '').replace(/(?<=[^s])s$/, '');
  for (const e of RU_END) if (lw.endsWith(e) && lw.length - e.length >= 3) return lw.slice(0, -e.length);
  return lw;
}
// Clause chunking: a comma/semicolon closes a clause only if it already has a verb (so "Мама, папа и я ..." stays
// one clause); a subordinator opens a new clause of its type; a coordinator before any verb is just noun
// coordination and is kept as a stop word. Role assignment, per clause:
// - pronoun case decides directly (nom -> subj, dat -> io, else obj);
// - else position relative to the verb: before = subj, after = obj (SVO default for both ru and en);
// - one subj and one obj per clause; extras become obj or 'other'; a noun after a preposition is an adjunct.
// Then the inversion fix for author's words ("— сказал он", "said Tom"): with no subject, a post-verbal noun is
// promoted to subject, always after a verb of saying, otherwise only if it is a nominative pronoun.
function simpleClauses(sentence, lang) {
  const ws = simpleWords(sentence, lang);
  const segs = [];
  let cur = { type: 'main', conj: null, words: [] };
  for (const w of ws) {
    if (w.punct) { if (cur.words.some((x) => x.verb)) { segs.push(cur); cur = { type: 'coord', conj: null, words: [] }; } continue; }
    if (w.conj) {
      if (w.conj === 'coord' && !cur.words.some((x) => x.verb)) { cur.words.push({ ...w, conj: null, stop: true }); continue; }
      if (cur.words.length) segs.push(cur);
      cur = { type: w.conj, conj: w.t, words: w.conj === 'relative' ? [w] : [] };
      continue;
    }
    cur.words.push(w);
  }
  if (cur.words.length) segs.push(cur);
  return segs.map((sg) => {
    const ws2 = sg.words;
    const vi = ws2.findIndex((w) => w.verb);
    const pred = vi >= 0 ? ws2[vi] : null;
    const args = [], adjuncts = [];
    let prepNext = false;
    ws2.forEach((w, k) => {
      if (w === pred) return;
      if (w.prep) { prepNext = w.t; return; }
      if (w.verb || w.stop) return;
      const nounish = w.pron || w.cap || w.lw.length > 2 || w.conj === 'relative';
      if (!nounish) return;
      if (prepNext) { adjuncts.push({ t: w.t, lw: w.lw, role: 'adv', prep: prepNext, cap: w.cap }); prepNext = false; return; }
      let role;
      if (w.pron) role = w.pron[1] === 'nom' ? 'subj' : w.pron[1] === 'dat' ? 'io' : 'obj';
      else if (w.conj === 'relative') role = 'subj';
      else role = pred && k < vi ? 'subj' : 'obj';
      if (role === 'subj' && args.some((a) => a.role === 'subj')) role = pred && k > vi ? 'obj' : 'other';
      if (role === 'obj' && args.some((a) => a.role === 'obj')) role = 'other';
      args.push({ t: w.t, lw: w.lw, role, pron: w.pron, cap: w.cap });
    });
    // "сказал он", "said Tom": a subject after a verb of saying
    // (author's words invert: after a verb of saying the first noun is the speaker, whatever it is)
    if (pred && !args.some((a) => a.role === 'subj')) {
      const Lx = lang === 'ru' ? RU : EN, saying = Lx.say.test(pred.lw);
      const after = args.find((a) => a.role === 'obj' && (saying ? !(a.pron && a.pron[1] !== 'nom') : a.cap || (a.pron && a.pron[1] === 'nom') || Lx.human.has(a.lw)));
      if (after && (saying || after.pron)) after.role = 'subj';
    }
    return { type: sg.type, conj: sg.conj, pred: pred ? { t: pred.t, lemma: pred.lw, gloss: null, tense: null, saying: (lang === 'ru' ? RU : EN).say.test(pred.lw) } : null, args, adjuncts, constructions: [], issues: [] };
  });
}

// Georgian clauses in the common shape. kartuli-syntax already resolved roles from case + verb agreement (the only
// reliable cue in free-word-order Georgian); here we only flatten its records: lemma as the coreference key (Georgian
// nouns inflect heavily, surface forms would never match), pronoun person/case, gloss for graph labels.
function kaClauses(sentence) {
  const r = analyzeKa(sentence);
  return r.clauses.map((c) => {
    const pr = c.reading;
    const conv = (x, role) => ({ t: x.w.t, lw: x.w.noun ? x.w.noun.lemma : x.w.t, role, pron: x.w.noun && x.w.noun.tags.pronoun ? [x.w.noun.tags.person, x.w.noun.tags.case] : null, human: x.w.human, np: x.w.noun && x.w.noun.pos === 'np', gloss: x.w.noun && x.w.noun.lex ? { ru: x.w.noun.lex.ru, en: x.w.noun.lex.en } : null, case: x.case || (x.w.noun && x.w.noun.tags.case), post: x.post || null, relative: !!x.w.relative, num: x.w.noun && x.w.noun.tags.num });
    return {
      type: c.type, conj: c.conj, antecedent: c.antecedent ? c.antecedent.t : null,
      pred: pr ? { t: c.pred.t, lemma: pr.lemma, gloss: { ru: pr.lex.ru, en: pr.lex.en }, tense: pr.tags.screeve, series: SERIES[pr.tags.screeve], person: pr.tags.s, saying: !!c.saying, parts: pr.parts } : null,
      args: c.args.map((x) => conv(x, x.role)), adjuncts: c.adjuncts.map((x) => conv(x, x.role)),
      constructions: c.constructions, issues: c.issues, reported: c.reported || null,
    };
  });
}

// --- the text ----------------------------------------------------------------------------------------------------
// Georgian function words that never stand for a participant in a narrative.
const KA_FUNCTION = new Set(['და', 'თუ', 'რომ', 'მაგრამ', 'ან', 'ანუ', 'კი', 'ხომ', 'ვინც', 'რაც', 'სადაც', 'როცა', 'როდესაც', 'რადგან', 'ვიდრე', 'თან', 'ისე', 'აქ', 'იქ', 'ახლა', 'მერე', 'შემდეგ', 'ძალიან', 'უკვე', 'კიდევ', 'მხოლოდ']);
const PRON3 = { ka: new Set(['ის', 'იგი', 'მან', 'მას', 'მისი', 'ისინი', 'მათ', 'მათი', 'ეს', 'ამან', 'ამას']), ru: new Set(['он', 'она', 'оно', 'они', 'его', 'её', 'ее', 'ему', 'ей', 'их', 'им', 'него', 'неё', 'ней', 'нему', 'них']), en: new Set(['he', 'she', 'it', 'they', 'him', 'her', 'them']) };
const SPEAKER_PRON = { ka: { 'მე': 'self', 'შენ': 'addr', 'ჩვენ': 'self', 'თქვენ': 'addr' }, ru: { 'я': 'self', 'меня': 'self', 'мне': 'self', 'ты': 'addr', 'тебя': 'addr', 'тебе': 'addr' }, en: { 'i': 'self', 'me': 'self', 'you': 'addr' } };

// Two passes over the segments:
// 1. dialogue: attribute each speech line to a speaker/addressee (author words on the same line, vocatives, and
//    turn alternation: with no cue, the speaker is the one before the last, i.e. A-B-A-B; marked `guessed`);
// 2. sentences: clauses, entity resolution, implicit subjects, topic and its transition.
// Entities are keyed by lemma (`byKey`), created lazily on first mention; ids e1, e2... in order of appearance, so
// graph colours (id % palette) are stable across re-analysis of the same text.
export function analyzeText(text, { lang = null } = {}) {
  lang = lang || detectLang(text);
  const segs = segments(text);
  const sentences = [];
  const entities = [];
  const byKey = new Map();
  const issues = [];
  const entity = (key, label, props = {}) => {
    let e = byKey.get(key);
    if (!e) { e = { id: 'e' + (entities.length + 1), key, label, human: false, mentions: [], gender: null, ...props }; entities.push(e); byKey.set(key, e); }
    if (props.human) e.human = true;
    if (props.gender && !e.gender) e.gender = props.gender;
    return e;
  };
  const genderOf = (t) => (lang === 'ru' ? (/[ая]$/.test(t.toLowerCase()) ? 'f' : 'm') : null);
  const isHuman = (a) => a.human || a.np || a.cap || (lang === 'ru' ? RU.human.has(a.lw) || RU.human.has(lemmaSimple(a.t, lang)) : lang === 'en' ? EN.human.has(a.lw) : false);
  // dialogue: who speaks each line
  const dialogue = [];
  let lastSpeakers = [];
  for (let k = 0; k < segs.length; k++) {
    const sg = segs[k];
    if (sg.kind !== 'speech') continue;
    let who = sg.who || null, addressee = null, guessed = false;
    const author = [segs[k + 1], segs[k - 1]].find((x) => x && x.line === sg.line && x.kind === 'author');
    if (!who && author) {
      // `(c.pred.saying || true)` is always true: any clause with a predicate qualifies; the saying test is vestigial.
      const cl = (lang === 'ka' ? kaClauses(author.text) : simpleClauses(author.text, lang)).find((c) => c.pred && (c.pred.saying || true));
      const s = cl && cl.args.find((a) => a.role === 'subj' && !(a.pron && a.pron[0][0] !== '3'));
      // Georgian names come in the ergative or dative after verbs of saying: the speaker is the lemma.
      if (s) who = s.pron && PRON3[lang].has(s.t.toLowerCase()) ? null : lang === 'ka' ? s.lw : s.t;
      if (s && !who && s.pron) who = '#pron:' + s.t;
      const io = cl && cl.args.find((a) => a.role === 'io');
      if (io) addressee = lang === 'ka' ? io.lw : io.t;
    }
    // Words in the vocative inside the line ("გამარჯობა, ნინო!", "შვილო"): a name is the one spoken to; a common
    // noun (შვილო "child") only when the dialogue does not tell otherwise.
    // KNOWN DEFECT: the split class below has a literal "s" where "\s" was meant, so tokens are not split on spaces;
    // a multi-word stretch ("მოდი აქ ნინო") reaches analyzeWord as one string and its vocative is missed (only
    // punctuation-delimited vocatives work). Fix: use [\s,!?.;:—–]+ in the split regex.
    let vocName = null, vocWord = null;
    if (lang === 'ka') {
      for (const tok of sg.text.split(/[s,!?.;:—–]+/)) {
        const v = tok && analyzeWord(tok).find((x) => x.tags && x.tags.case === 'voc' && (x.pos === 'np' || (x.lex && x.lex.flags && x.lex.flags.h)));
        if (!v) continue;
        if (v.pos === 'np' && !vocName) vocName = v.lemma;
        else if (!vocWord) vocWord = v.lemma;
      }
    }
    // '#pron:...' marks "a pronoun spoke" (он сказал): known speaker exists but unnamed; it blocks the alternation
    // guess yet is never exposed as a speaker name. lastSpeakers collapses repeats so alternation sees turns.
    if (!who && lastSpeakers.length >= 2) { who = lastSpeakers[lastSpeakers.length - 2]; guessed = true; }
    if (who && !who.startsWith('#')) { if (lastSpeakers[lastSpeakers.length - 1] !== who) lastSpeakers.push(who); }
    sg.speaker = who && who.startsWith('#') ? null : who;
    sg.guessed = guessed;
    sg.addressee = addressee || vocName || (lastSpeakers.length >= 2 && who ? lastSpeakers.filter((x) => x !== who).slice(-1)[0] : null) || vocWord;
    dialogue.push({ line: sg.line, speaker: sg.speaker, addressee: sg.addressee, text: sg.text, author: author ? author.text : null, guessed });
  }
  let prevTopic = null;
  const topicHistory = [];
  const mentionedIn = new Map(); // entity id -> last sentence index
  let si = 0;
  for (const sg of segs) {
    for (const st of sentencesOf(sg.text)) {
      const i = si++;
      const clauses = (lang === 'ka' ? kaClauses(st) : simpleClauses(st, lang)).map((c, k) => ({ ...c, id: `s${i + 1}c${k + 1}` }));
      const keyOf = (a) => (lang === 'ka' ? a.lw : lemmaSimple(a.t, lang));
      const recent = () => entities.filter((e) => mentionedIn.has(e.id) && i - mentionedIn.get(e.id) <= 2);
      // Argument -> entity. 1st/2nd person inside speech resolve to the line's speaker / addressee (deixis); 3rd
      // person to the best recent candidate; other pronouns (e.g. 1st person in narration) stay unresolved; nouns
      // create or reuse their lemma entity. The sort comparator chains with ||: booleans/numbers subtract to
      // 0 on a tie, so the next criterion decides.
      const resolve = (a) => {
        const lw = a.t.toLowerCase();
        const sp = SPEAKER_PRON[lang][lw];
        if (sp && sg.kind === 'speech') { const name = sp === 'self' ? sg.speaker : sg.addressee; if (name) return entity(lang === 'ka' ? name : lemmaSimple(name, lang), name, { human: true }); }
        if (a.relative) return null;
        // Conjunctions and particles that the word analysis may take for nouns (და "and" / "sister").
        if (lang === 'ka' && KA_FUNCTION.has(a.t)) return null;
        // A vocative names the one spoken to, not a participant of the event.
        if (a.case === 'voc') return null;
        if (PRON3[lang].has(lw) || (a.pron && a.pron[0][0] === '3')) {
          const g = a.pron && a.pron[2];
          const plural = a.pron && a.pron[0] === '3pl';
          const cands = recent().filter((e) => (!g || g === 'n' || !e.gender || e.gender === g) && (plural ? true : !e.plural));
          cands.sort((x, y) => (y === prevTopic) - (x === prevTopic) || mentionedIn.get(y.id) - mentionedIn.get(x.id) || (y.human - x.human));
          return cands[0] || null;
        }
        if (a.pron) return null;
        return entity(keyOf(a), lang === 'ka' ? a.lw : a.t, { human: isHuman(a), gender: genderOf(a.t), plural: a.num === 'pl', gloss: a.gloss || null });
      };
      for (const c of clauses) {
        // Greetings and exclamations in speech ("გამარჯობა!") have no event and no participants.
        if (!c.pred && sg.kind === 'speech') continue;
        for (const a of [...c.args, ...c.adjuncts]) {
          const e = resolve(a);
          if (e) { a.ent = e.id; e.mentions.push({ s: i, t: a.t, role: a.role, clause: c.id }); mentionedIn.set(e.id, i); }
        }
        // relative clause: its relative word stands for the antecedent
        if (c.type === 'relative') {
          const prev = clauses[clauses.indexOf(c) - 1];
          const ante = prev && [...prev.args].reverse().find((x) => x.ent && (!c.antecedent || x.t === c.antecedent));
          const rel = c.args.find((x) => x.relative || x.role === 'subj' && !x.ent);
          if (ante && rel) { rel.ent = ante.ent; rel.antecedent = ante.t; }
        }
        // a dropped subject (Georgian and Russian drop pronouns): the topic goes on
        if (c.pred && !c.args.some((a) => a.role === 'subj') && prevTopic && (!c.pred.person || c.pred.person === '3sg')) c.args.unshift({ t: '∅', role: 'subj', ent: prevTopic.id, implicit: true });
      }
      // the topic: the subject of the main clause, else its first entity
      // Transitions (Centering-like): continue = same topic as before; shift = topic was mentioned in the previous
      // sentence but not as topic; return = mentioned earlier; new = first mention; none = no entity at all.
      // Note `transition` is computed after this sentence's mentions were pushed, so m.s === i is excluded by design.
      const main = clauses.find((c) => c.type === 'main' || c.type === 'coord') || clauses[0];
      const subj = main && main.args.find((a) => a.role === 'subj' && a.ent);
      const any = main && [...main.args, ...main.adjuncts].find((a) => a.ent);
      const topicId = subj ? subj.ent : any ? any.ent : null;
      const topic = topicId ? entities.find((e) => e.id === topicId) : null;
      let transition = 'new';
      if (topic && prevTopic && topic === prevTopic) transition = 'continue';
      else if (topic && topic.mentions.some((m) => m.s === i - 1)) transition = 'shift';
      else if (topic && topic.mentions.some((m) => m.s < i - 1)) transition = 'return';
      else if (!topic) transition = 'none';
      if (topic) { prevTopic = topic; topicHistory.push(topic.id); }
      for (const c of clauses) for (const x of c.issues || []) issues.push({ s: i, ...x });
      sentences.push({ i, text: st, kind: sg.kind, line: sg.line, speaker: sg.speaker || null, addressee: sg.addressee || null, clauses, topic: topic ? topic.id : null, transition });
    }
  }
  // events: every clause with a predicate, in text order
  const events = [];
  for (const s of sentences) for (const c of s.clauses) {
    if (!c.pred) continue;
    const role = (r) => { const a = c.args.find((x) => x.role === r && x.ent); return a ? a.ent : null; };
    events.push({ s: s.i, clause: c.id, verb: c.pred.t, lemma: c.pred.lemma, gloss: c.pred.gloss, tense: c.pred.tense, agent: role('subj'), patient: role('obj'), recipient: role('io'), type: c.type, speech: s.kind === 'speech', speaker: s.speaker });
  }
  return { lang, sentences, entities, events, dialogue, issues, segments: segs };
}

// --- graphs ------------------------------------------------------------------------------------------------------
// accent: a palette index the renderer maps to a theme colour; entity accents derive from the numeric id so the
// same entity has the same colour in all three graphs. `max` caps the clause graph: beyond ~10 sentences the
// layered layout becomes unreadable, the UI pages through instead.
const short = (s, n = 28) => { const t = String(s || ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const ROLE_LABEL = { subj: 'S', obj: 'O', io: 'IO', other: '·', in: 'in', on: 'on', with: 'with', for: 'for', from: 'from', towards: '→', like: '≈', until: 'until', poss: 'of', by: 'by', as: 'as', adv: 'adv' };

// sentences -> clauses -> predicate and arguments; subordinate clauses point to their main clause
export function clauseGraph(a, { max = 10, gloss = 'ru' } = {}) {
  const g = { kind: 'graph', direction: 'TB', nodes: [], edges: [], groups: [], classes: {} };
  for (const s of a.sentences.slice(0, max)) {
    const gid = 'S' + (s.i + 1);
    g.groups.push({ id: gid, label: `${gid}${s.speaker ? ' · ' + s.speaker : ''}${s.kind === 'speech' ? ' «»' : ''}` });
    let mainId = null;
    for (const c of s.clauses) {
      const pid = c.id;
      const gl = c.pred && c.pred.gloss ? c.pred.gloss[gloss] || c.pred.gloss.en : '';
      g.nodes.push({ id: pid, label: c.pred ? `${c.pred.t}${gl ? '\n' + short(gl, 22) : ''}` : '(—)', shape: 'stadium', group: gid, accent: c.type === 'main' ? 0 : c.type === 'relative' ? 3 : c.type === 'coord' ? 1 : 2, tooltip: c.type });
      for (const [k, x] of [...c.args, ...c.adjuncts].entries()) {
        if (x.implicit) continue;
        const id = `${pid}a${k}`;
        g.nodes.push({ id, label: x.t, shape: 'rect', group: gid, accent: x.ent ? 4 + (parseInt(x.ent.slice(1), 10) % 4) : null });
        g.edges.push({ from: pid, to: id, label: ROLE_LABEL[x.role] || x.role, line: x.role === 'subj' || x.role === 'obj' || x.role === 'io' ? 'solid' : 'dotted' });
      }
      // The first clause (normally the main one) becomes the anchor; every later non-main clause links to it.
      // A second 'main' clause takes this branch too and gets no edge, which is the intent for juxtaposed mains.
      if (c.type === 'main' || !mainId) { if (!mainId) mainId = pid; }
      else g.edges.push({ from: pid, to: mainId, label: c.conj || c.type, line: 'dotted' });
    }
  }
  return g;
}

// entities and what they do to each other
// Edges deduplicated by from>to>label (a repeated action draws once). Intransitive events hang off their agent as a
// text node. Entities are listed only if connected or mentioned twice: one-off mentions are noise in this view.
// unshift puts entity nodes before event nodes, which most layered layouts use as a placement hint.
export function entityGraph(a, { gloss = 'ru' } = {}) {
  const g = { kind: 'graph', direction: 'LR', nodes: [], edges: [], groups: [], classes: {} };
  const used = new Set();
  const seen = new Map();
  for (const ev of a.events) {
    const lab = ev.verb + (ev.gloss && ev.gloss[gloss] ? ` (${short(ev.gloss[gloss], 16)})` : '');
    const add = (from, to, label, line = 'solid') => {
      const k = from + '>' + to + '>' + label;
      if (seen.has(k)) return;
      seen.set(k, 1);
      used.add(from); used.add(to);
      g.edges.push({ from, to, label, line });
    };
    if (ev.agent && ev.patient && ev.agent !== ev.patient) add(ev.agent, ev.patient, lab);
    if (ev.agent && ev.recipient && ev.agent !== ev.recipient) add(ev.agent, ev.recipient, '→ ' + lab, 'dotted');
    if (ev.agent && !ev.patient && !ev.recipient) { const id = 'v_' + ev.clause; g.nodes.push({ id, label: lab, shape: 'text' }); add(ev.agent, id, '', 'dotted'); }
  }
  for (const d of a.dialogue) {
    const sp = d.speaker && a.entities.find((e) => e.label === d.speaker || e.key === d.speaker);
    const ad = d.addressee && a.entities.find((e) => e.label === d.addressee || e.key === d.addressee);
    if (sp && ad && sp !== ad) { const k = sp.id + '~' + ad.id; if (!seen.has(k)) { seen.set(k, 1); used.add(sp.id); used.add(ad.id); g.edges.push({ from: sp.id, to: ad.id, label: '💬', line: 'dotted', head: 'open' }); } }
  }
  for (const e of a.entities) {
    if (!used.has(e.id) && e.mentions.length < 2) continue;
    g.nodes.unshift({ id: e.id, label: `${e.label}${e.mentions.length > 1 ? ' ×' + e.mentions.length : ''}`, shape: e.human ? 'stadium' : 'rect', accent: parseInt(e.id.slice(1), 10) % 8 });
  }
  return g;
}

// the topic of each sentence and how it changes
export function topicGraph(a) {
  const g = { kind: 'graph', direction: 'LR', nodes: [], edges: [], groups: [], classes: {} };
  const ent = (id) => a.entities.find((e) => e.id === id);
  let prev = null;
  const lastAsTopic = new Map();
  for (const s of a.sentences) {
    const t = s.topic ? ent(s.topic) : null;
    const id = 't' + (s.i + 1);
    g.nodes.push({ id, label: `S${s.i + 1}\n${t ? t.label : '—'}`, shape: s.transition === 'new' ? 'hexagon' : 'round', accent: t ? parseInt(t.id.slice(1), 10) % 8 : null, tooltip: s.text });
    if (prev) g.edges.push({ from: prev, to: id, label: s.transition, line: s.transition === 'continue' ? 'thick' : 'solid' });
    if (s.transition === 'return' && t && lastAsTopic.has(t.id)) g.edges.push({ from: id, to: lastAsTopic.get(t.id), label: 'return', line: 'dotted', head: 'open', minLen: 1 });
    if (t) lastAsTopic.set(t.id, id);
    prev = id;
  }
  return g;
}

// A graph as Mermaid flowchart text (parsed by diagram/flowchart.js and by Mermaid itself).
// Every label is quoted, with " escaped as the Mermaid entity #quot; and newlines as <br>: unquoted labels break on
// brackets/parentheses that are common in glosses. Nodes are declared inside their subgraph before any edge, since
// Mermaid assigns a node to the subgraph where it first appears.
export function toMermaid(g) {
  const q = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '#quot;').replace(/\n/g, '<br>') + '"';
  const shape = (n) => {
    const l = q(n.label);
    switch (n.shape) {
      case 'round': return `(${l})`;
      case 'stadium': return `([${l}])`;
      case 'diamond': return `{${l}}`;
      case 'hexagon': return `{{${l}}}`;
      case 'circle': return `((${l}))`;
      case 'text': return `[${l}]`;
      default: return `[${l}]`;
    }
  };
  const lines = [`flowchart ${g.direction || 'TB'}`];
  const inGroup = new Map();
  for (const n of g.nodes) if (n.group) { if (!inGroup.has(n.group)) inGroup.set(n.group, []); inGroup.get(n.group).push(n); }
  for (const gr of g.groups || []) {
    lines.push(`  subgraph ${gr.id}[${q(gr.label)}]`);
    for (const n of inGroup.get(gr.id) || []) lines.push(`    ${n.id}${shape(n)}`);
    lines.push('  end');
  }
  for (const n of g.nodes) if (!n.group) lines.push(`  ${n.id}${shape(n)}`);
  for (const e of g.edges) {
    const arrow = e.line === 'dotted' ? '-.->' : e.line === 'thick' ? '==>' : '-->';
    const label = e.label ? `|${q(e.label)}|` : '';
    lines.push(`  ${e.from} ${arrow}${label} ${e.to}`);
  }
  return lines.join('\n') + '\n';
}

export { CLAUSE_TYPES };
