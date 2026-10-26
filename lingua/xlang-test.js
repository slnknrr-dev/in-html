// lingua/xlang-test.js - tests of the cross-language modules: word links (xlinks.js), the dictionary across
// languages (bilex.js), Latin typing of every script (typein.js), decks between any two languages (decks.js), the
// contrastive sentence structure (contrast.js), parallel-text alignment (align.js) and sound counterparts (sounds.js).
//   runXlang() -> number of failures   (also runnable alone: `node lingua/xlang-test.js`)
// Same conventions as test.js. The parallel KA / RU / EN texts below are fixtures for alignment and entity matching;
// data integrity checks (every link set has two languages, every Kartvelian pair exists in the Mingrelian lexicon)
// guard the curated tables against typos.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINKS, KINDS, linksFor, searchLinks } from './xlinks.js';
import { createIndex, equivalents, glossKeys, lookup } from './bilex.js';
import { asciiToIast, latinToCyrillic, typeIn, TARGETS } from './typein.js';
import { deckLanguages, deckPairs } from './decks.js';
import { contrastSentence } from './contrast.js';
import { alignTexts, matchEntities, nameKey, sentencesOf } from './align.js';
import { counterparts, distance, features } from './sounds.js';
import { lexicon, lexById } from './kartuli-lexicon.js';
import { LEXICON as XMF } from './megruli.js';
import { buildSentence } from './kartuli-syntax.js';
import { analyzeText } from './discourse.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const KA = 'ლეგენდა გვიამბობს, რომ მეფე ვახტანგ გორგასალი ერთხელ ამ ადგილას ნადირობდა. მის შევარდენს ხოხობი დაუჭერია, და ორივენი ცხელ წყაროში ჩავარდნილან. ხოხობი თურმე იქვე მოხარშულა.\nმეფეს ეს ადგილი ძალიან მოსწონებია და აქ ქალაქის აშენება უბრძანებია. ქალაქს თბილისი ეწოდა, რადგან „ტფილი“ ძველ ქართულში თბილს ნიშნავს.';
const RU = 'Легенда рассказывает, что царь Вахтанг Горгасали однажды охотился в этих местах. Его сокол, говорят, поймал фазана, и оба упали в горячий источник. Фазан, оказывается, тут же сварился.\nЦарю это место очень понравилось, и он велел построить здесь город. Город назвали Тбилиси, потому что «тпили» на древнегрузинском значит «тёплый».';
const EN = 'Legend has it that King Vakhtang Gorgasali was once hunting in these parts. His falcon, the story goes, caught a pheasant, and both fell into a hot spring. The pheasant was apparently boiled on the spot.\nThe king liked the place so much that he ordered a city to be built here. The city was named Tbilisi, because "tpili" means "warm" in Old Georgian.';

export function runXlang() {
  let pass = 0, fail = 0;
  const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('x xlang: ' + msg); } };
  const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);

  // --- word links
  ok(LINKS.length >= 80 && LINKS.every((L) => KINDS[L.kind] && Object.keys(L.words).length >= 2 && L.note.ru && L.note.en), 'links: kinds, two languages at least, notes in ru and en');
  ok(linksFor('ru', 'брата').some((L) => L.words.en && L.words.en[0].w === 'brother'), 'an inflected Russian form finds its cognates');
  ok(linksFor('ru', 'независимый', { root: 'вис' }).some((L) => L.words.ka && L.words.ka[0].w === 'დამოუკიდებლობა'), 'a root finds the calque in Georgian');
  ok(linksFor('ka', 'თამადა').some((L) => L.kind === 'loan' && L.words.ru[0].w === 'тамада'), 'a Georgian loan in Russian');
  ok(linksFor('ka', 'მამა').some((L) => L.kind === 'false') && linksFor('ka', 'მამა').some((L) => L.kind === 'kartvelian'), 'მამა: a false friend of мама and a Mingrelian cognate');
  ok(searchLinks('', { kind: 'sino' }).length >= 10 && searchLinks('Meiji').length >= 2, 'search by kind and by note');
  for (const L of LINKS.filter((x) => x.kind === 'kartvelian')) ok(XMF.some((e) => e.w === L.words.xmf[0].w && e.ka === L.words.ka[0].w), `Kartvelian link ${L.words.ka[0].w} is in the Mingrelian lexicon`);

  // --- the dictionary across languages
  eq(glossKeys('to give; hand over (a thing)', 'en'), ['give', 'hand over'], 'gloss keys: "to", parentheses, several senses');
  const idx = createIndex([
    ...lexicon().map((e) => ({ lang: 'ka', w: e.w, gloss: { ru: e.ru, en: e.en }, tier: e.tier })),
    ...XMF.map((e) => ({ lang: 'xmf', w: e.w, gloss: { ru: e.ru, en: e.en }, ka: e.ka })),
    { lang: 'ru', w: 'вода', gloss: { en: 'water' } }, { lang: 'en', w: 'water', gloss: { ru: 'вода' } },
  ]);
  const back = lookup(idx, 'вода');
  ok(back.some((x) => x.e.lang === 'ka' && x.e.w === 'წყალი' && x.by === 'gloss') && back[0].by === 'head', 'back-lookup: Russian → Georgian (the Russian headword first)');
  ok(lookup(idx, 'water').some((x) => x.e.w === 'წყალი'), 'back-lookup from English');
  const eqv = equivalents(idx, idx.all.find((e) => e.lang === 'ka' && e.w === 'წყალი'));
  ok(eqv.xmf && eqv.xmf.some((x) => x.e.w === 'წყარი'), 'Georgian → Mingrelian through the shared gloss');
  ok(eqv.ru && eqv.ru[0].e.w === 'вода' && eqv.en && eqv.en[0].e.w === 'water', 'Georgian → Russian and English headwords');

  // --- typing every script
  eq(latinToCyrillic("Zdravstvuyte, shchi, zhizn', yolka, ob\"yom, eto, novyy"), 'Здравствуйте, щи, жизнь, ёлка, объём, это, новый', 'Latin → Cyrillic');
  eq(asciiToIast('kRSNa saMskRtam'), 'kṛṣṇa saṃskṛtam', 'Harvard-Kyoto → IAST');
  eq(asciiToIast('k.r.s.na aatmaa'), 'kṛṣṇa ātmā', 'Velthuis → IAST');
  eq(typeIn('satyam eva jayate', 'sa').text, 'सत्यम् एव जयते', 'Devanagari from Latin');
  eq(typeIn('gamarjoba', 'ka').text, 'გამარჯობა', 'Georgian from Latin');
  eq(typeIn('annyeonghaseyo', 'ko').text, '안녕하세요', 'Hangul from Latin');
  eq(typeIn('ni3 hao3 lv4', 'pinyin').text, 'nǐ hǎo lǜ', 'pinyin tone marks');
  eq(typeIn('sakura', 'hira').text + typeIn('terebi', 'kata').text, 'さくらテレビ', 'kana');
  ok(TARGETS.every((x) => typeIn(x.sample, x.id).text && typeIn(x.sample, x.id).text !== x.sample), 'every target converts its sample');

  // --- decks between any two languages
  const entries = [
    ...lexicon().slice(0, 400).map((e) => ({ lang: 'ka', w: e.w, m: { ru: e.ru, en: e.en } })),
    { lang: 'ko', w: '물', tr: 'mul', m: { ru: 'вода', en: 'water' } }, { lang: 'ko', w: '집', tr: 'jip', m: { ru: 'дом', en: 'house' } },
    { lang: 'ru', w: 'дом', m: { en: 'house' } },
  ];
  ok(deckLanguages(entries).sort().join() === 'en,ka,ko,ru', 'deck languages');
  const ruKa = deckPairs(entries, 'ru', 'ka');
  ok(ruKa.length > 300 && ruKa.every((p) => p.front.lang === 'ru' && p.back.lang === 'ka' && p.id.startsWith('x:ru>ka:')), 'ru → ka from the glosses');
  const kaKo = deckPairs(entries, 'ka', 'ko');
  ok(kaKo.some((p) => p.front.w === 'წყალი' && p.back.w === '물' && p.via === 'ru'), 'ka → ko through the Russian gloss');
  ok(deckPairs(entries, 'ko', 'ka').some((p) => p.front.w === '집' && p.back.w === 'სახლი'), 'ko → ka the other way');
  ok(deckPairs(entries, 'ru', 'ru').length === 0 && new Set(ruKa.map((p) => p.id)).size === ruKa.length, 'no deck into the same language; unique card ids');

  // --- contrastive structure
  const give = lexicon().find((e) => e.w === 'მიცემა');
  const aor = buildSentence({ verb: give, screeve: 'aorist', subj: { noun: lexById('n:დედა') }, obj: { noun: lexById('n:წიგნი') }, io: { pron: '1sg' } });
  const cr = contrastSentence(aor, 'ru');
  ok(cr.rows.find((x) => x.role === 'subj').kaCase === 'erg' && /им/.test(cr.rows.find((x) => x.role === 'subj').form) && cr.notes.some((n) => /эргатив/i.test(n.ru)), 'aorist: ergative subject, Russian nominative, a note');
  ok(cr.rows.find((x) => x.role === 'io').form === 'мне' && /вин/.test(cr.rows.find((x) => x.role === 'obj').form), 'pronoun in the dative, object in the accusative');
  const pf = contrastSentence(buildSentence({ verb: give, screeve: 'perfect', subj: { noun: lexById('n:დედა') }, obj: { noun: lexById('n:წიგნი') }, io: { pron: '1sg' } }), 'en');
  ok(/Present Perfect/.test(pf.verb.label.en) && pf.notes.some((n) => /inversion/i.test(n.en)) && pf.notes.some((n) => /-თვის/.test(n.en)) && pf.notes.some((n) => /articles/.test(n.en)), 'perfect: evidential, inversion, -თვის, articles');

  // --- parallel texts
  eq(sentencesOf('— Здравствуйте, — ответила она. Он ушёл. Т.е. всё.').length, 3, 'sentences: the author\'s words stay with the line');
  eq([nameKey('ვახტანგ'), nameKey('Вахтанг'), nameKey('Vakhtang')], ['vahtang', 'vahtang', 'vahtang'], 'one name key in three scripts');
  const al = alignTexts(KA, RU);
  ok(al.beads.length === 5 && al.beads.every((b) => b.a.length === 1 && b.b.length === 1), 'Georgian ↔ Russian: five 1-1 beads ' + JSON.stringify(al.beads.map((b) => b.a.length + '-' + b.b.length)));
  ok(al.beads[0].anchors.includes('vahtang') && al.beads[4].anchors.some((x) => x.startsWith('tbilis')), 'names anchor the beads');
  const enMerged = EN.replace('spring. The pheasant', 'spring; the pheasant');
  const al2 = alignTexts(KA, enMerged);
  ok(al2.beads.some((b) => b.a.length === 2 && b.b.length === 1), 'two Georgian sentences ↔ one English sentence (2-1)');
  const ea = analyzeText(KA).entities, eb = analyzeText(RU).entities;
  const ms = matchEntities(al.beads, ea, eb);
  ok(ms.some((m) => m.by === 'name' && ea.find((e) => e.id === m.a).label === 'ლეგენდა' && eb.find((e) => e.id === m.b).label === 'Легенда'), 'entities matched by name across scripts');

  // --- sound counterparts
  ok(features('kʼ').lar === 'ejective' && features('k͈').lar === 'tense' && features('aː').long, 'features: ejective, tense, length');
  eq(counterparts('Geor', 'ქ', 'Kore', { max: 1 })[0].ch, 'ㅋ', 'Georgian ქ = Korean ㅋ (both aspirated)');
  eq(counterparts('Geor', 'ქ', 'Deva', { max: 1 })[0].ch, 'ख', 'Georgian ქ = Devanagari ख');
  eq(counterparts('Geor', 'კ', 'Kore', { max: 1 })[0].ch, 'ㄲ', 'the ejective is nearest to the Korean tense stop');
  const kRu = counterparts('Geor', 'ქ', 'Cyrl', { max: 1 })[0];
  ok(kRu.ch === 'к' && !kRu.exact && kRu.diff.includes('lar:aspirated>plain'), 'Russian к lacks the aspiration of ქ');
  eq(counterparts('Cyrl', 'ш', 'Geor', { max: 1 })[0].ch, 'შ', 'ш ≈ შ');
  ok(distance('a', 'k').d === 9 && distance('i', 'iː').diff.includes('length'), 'vowel vs consonant; length');

  if (isMain) console.log(`xlang: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exit(runXlang() ? 1 : 0);
