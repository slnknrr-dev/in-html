// lingua/test.js - unit tests of the language primitives: `node lingua/test.js` (importing the module runs nothing).

// Design: no test framework (zero dependencies, runs in plain node and is importable by a page or the build). ok()
// counts and logs only failures; eq() compares by JSON.stringify, which is exact for the plain arrays / objects these
// functions return (key order included). Sub-runners of other test files return their failure counts, summed here,
// so one exit code covers the whole folder. Expected values are hand-checked linguistic facts, not snapshots: a
// change that breaks one is a regression in the language rules, not in formatting.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dueItems, merge, newCard, review, strength } from './srs.js';
import { fromDeva, syllables, toDeva, tokens } from './iast.js';
import { join, joinAll } from './sandhi.js';
import { scan } from './meter.js';
import { GOJUON, toKana, toKatakana, toRomaji } from './kana.js';
import { marked, numbered, parse as parsePinyin, toneSandhi } from './pinyin.js';
import { allForms, analyze, decline, numberWords, paradigm, translit, verbForm } from './kartuli.js';
import { split, translit as ruTranslit } from './russian.js';
import { compareMasks, compareStrokes, distanceField, fit, pathStrokes, resample } from './strokes.js';
import { lexicon, lexByWord, lexStats } from './kartuli-lexicon.js';
import { declineNoun, verbTable, conjugate, caseFrame, analyzeWord } from './kartuli-grammar.js';
import { convert } from './kartuli-input.js';
import { buildSentence, analyzeKa } from './kartuli-syntax.js';
import { analyzeText, entityGraph, topicGraph, toMermaid } from './discourse.js';
import { matchLabels } from './morph.js';
import { parseKa, searchKa, possibleKa } from './morph-ka.js';
import { parseRu, possibleRu } from './morph-ru.js';
import { parseEn, attestedEn } from './morph-en.js';
import { runMegruli } from './megruli-test.js';
import { runHangul } from './hangul-test.js';
import { runTranslit } from './translit-test.js';
import { runXlang } from './xlang-test.js';

// isMain: true only when this file is the node entry point; importing it from the aggregate runner runs nothing.
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function run() {
  let pass = 0, fail = 0;
  const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('x lingua: ' + msg); } };
  const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);

  // --- srs
  const t0 = Date.UTC(2026, 0, 1);
  let c = review(null, 2, t0);
  ok(c.n === 1 && c.i === 1 && c.d === t0 + 864e5, 'first good review: one day');
  c = review(c, 2, t0 + 864e5);
  ok(c.i === 4, 'second good review: four days');
  c = review(c, 3, t0 + 5 * 864e5);
  ok(c.i > 4 * 2.5 && c.e > 2.5, 'easy grows the interval and the ease');
  const lapsed = review(c, 0, t0 + 20 * 864e5);
  ok(lapsed.n === 0 && lapsed.l === 1 && lapsed.e < c.e && lapsed.d - (t0 + 20 * 864e5) === 6e5, 'lapse: ten minutes, ease drops');
  ok(strength(c, c.t) > 0.99 && strength(c, c.t + 365 * 864e5) < 0.1, 'strength decays');
  eq(dueItems({ a: { ...newCard(0), d: 5 }, b: { ...newCard(0), d: 1 }, c: { ...newCard(0), d: 9e15 } }, ['a', 'b', 'c', 'd'], 10, 10), ['b', 'a', 'd'], 'due first (most overdue first), then new');
  ok(merge({ t: 1 }, { t: 2 }).t === 2 && merge(null, { t: 1 }).t === 1, 'merge keeps the newer card');

  // --- IAST / Devanagari
  eq(toDeva('agnim īḷe purohitam', { accents: false }), 'अग्निम् ईळे पुरोहितम्', 'IAST -> Devanagari, Vedic ḷ between vowels');
  eq(toDeva('agním īḷe'), 'अ॒ग्निमी॑ळे'.replace('मी', 'म् ई'), 'Rigvedic accents: anudātta before, svarita after the udātta');
  ok(toDeva('agním').includes('॒') && !toDeva('agním', { accents: false }).includes('॒'), 'anudātta stroke on the syllable before the udātta');
  eq(toDeva('kṛṣṇaḥ'), 'कृष्णः', 'vocalic ṛ, cluster, visarga');
  eq(toDeva('saṃskṛtam'), 'संस्कृतम्', 'anusvāra');
  eq(toDeva('jñānam ai au'), 'ज्ञानम् ऐ औ', 'jñ ligature by virāma, diphthongs');
  eq(fromDeva('संस्कृतम्'), 'saṃskṛtam', 'Devanagari -> IAST');
  eq(fromDeva('सत्यमेव जयते'), 'satyameva jayate', 'Devanagari -> IAST with words');
  eq(tokens('kh').map((x) => x.s), ['kh'], 'aspirates are one consonant');
  const syl = syllables('agnim īḷe purohitam');
  eq(syl.map((s) => s.heavy ? '–' : '⏑').join(''), '–⏑––⏑–⏑⏑', 'syllable weights (heavy by position and length)');
  ok(syl[0].heavy && syl[0].why === 'cluster' && syl[2].why === 'long', 'reasons of weight');

  // --- sandhi
  const J = (a, b) => join(a, b).text;
  eq(J('deva', 'indra'), 'devendra', 'guṇa a + i');
  eq(J('mahā', 'ṛṣi'), 'maharṣi', 'guṇa ā + ṛ');
  eq(J('su', 'ukta'), 'sūkta', 'savarṇa u + u');
  eq(J('iti', 'api'), 'ityapi', 'yaṇ i + a');
  eq(J('tava', 'eva'), 'tavaiva', 'vṛddhi a + e');
  eq(J('rāmaḥ', 'gacchati'), 'rāmo gacchati', 'aḥ before a voiced consonant');
  eq(J('naraḥ', 'asti'), "naro 'sti", 'aḥ + a with avagraha');
  eq(J('guruḥ', 'vadati'), 'gurur vadati', 'other vowel + ḥ before voiced → r');
  eq(J('punaḥ', 'ramate'), 'punā ramate', 'r before r: drop and lengthen');
  eq(J('rāmaḥ', 'ca'), 'rāmaś ca', 'ḥ before c → ś');
  eq(J('tat', 'ca'), 'tac ca', 't before c');
  eq(J('sat', 'ānanda'), 'sadānanda', 't voiced before a vowel');
  eq(J('vāk', 'mayī'), 'vāṅ mayī', 'stop before a nasal');
  eq(J('tam', 'gacchati'), 'taṃ gacchati', 'm before a consonant');
  eq(J('deve', 'atra'), "deve 'tra", 'e + a avagraha');
  eq(joinAll(['deva', 'indra', 'iti']).text, 'devendreti', 'join a chain');

  // --- meter
  const g = scan('tát savitúr váreṇyam\nbhárgo devásya dhīmahi\ndhíyo yó naḥ pracodáyāt');
  eq(g.counts, [7, 8, 8], 'Gāyatrī: the first pāda is one syllable short (váreṇiyam)');
  ok(g.meter && g.meter.id === 'gayatri' && g.meter.missing === 1, 'meter found with the restored syllable');
  const tr = scan('ékaṃ sád víprā bahudhā́ vadanti | ékaṃ sád víprā bahudhā́ vadanti | ékaṃ sád víprā bahudhā́ vadanti | ékaṃ sád víprā bahudhā́ vadanti');
  ok(tr.counts.every((n) => n === 11) && tr.meter.id === 'trishtubh', 'triṣṭubh of 11-syllable pādas');
  ok(tr.cadence.every((x) => x.ok), 'triṣṭubh cadence – ⏑ – ×');

  // --- kana
  ok(GOJUON.length === 46, '46 basic kana');
  eq(toKana('arigatou'), 'ありがとう', 'romaji -> hiragana');
  eq(toKana('kitte'), 'きって', 'double consonant -> small tsu');
  eq(toKana('shinbun'), 'しんぶん', 'n before a consonant');
  eq(toKana('kyouto', 'k'), 'キョウト', 'yōon in katakana');
  eq(toRomaji('こんにちは'), 'konnichiha', 'hiragana -> romaji (は read as written)');
  eq(toRomaji('きって'), 'kitte', 'small tsu -> doubled');
  eq(toRomaji('コーヒー'), 'koohii', 'long vowel mark');
  eq(toKatakana('すし'), 'スシ', 'hiragana -> katakana');

  // --- pinyin
  eq(marked('ni3 hao3'), 'nǐ hǎo', 'tone numbers -> marks');
  eq(marked('zhong1 guo2 lv4 xue2 sheng5'), 'zhōng guó lǜ xué sheng', 'ü and the neutral tone');
  eq(marked('gui4 liu2'), 'guì liú', 'mark on the last of iu / ui');
  eq(numbered('nǐ hǎo'), 'ni3 hao3', 'marks -> numbers');
  const p = parsePinyin('zhōng');
  ok(p.initial === 'zh' && p.final === 'ong' && p.tone === 1, 'syllable split');
  ok(parsePinyin('qu4').sound === 'üu'.slice(0, 1) + '' || parsePinyin('qu4').sound === 'ü', 'qu is qü');
  eq(toneSandhi([3, 3]), [2, 3], 'third-tone sandhi');

  // --- Georgian
  const write = { root: 'წერ', ts: '', neutral: '', pv: 'და' };
  const doV = { root: 'კეთ', ts: 'ებ', neutral: 'ა', pv: 'გა' };
  eq(paradigm(write, 'present').map((x) => x.form), ['ვწერ', 'წერ', 'წერს', 'ვწერთ', 'წერთ', 'წერენ'], 'present of წერა');
  eq(paradigm(doV, 'future').map((x) => x.form), ['გავაკეთებ', 'გააკეთებ', 'გააკეთებს', 'გავაკეთებთ', 'გააკეთებთ', 'გააკეთებენ'], 'future with preverb');
  eq(paradigm(write, 'imperfect').map((x) => x.form), ['ვწერდი', 'წერდი', 'წერდა', 'ვწერდით', 'წერდით', 'წერდნენ'], 'imperfect');
  eq(verbForm(write, { screeve: 'future', s: '1sg', o: '3sg', version: 'objective' }).form, 'დავუწერ', 'objective version: I will write to him');
  eq(verbForm(doV, { screeve: 'future', s: '3sg', o: '1sg', version: 'objective' }).form, 'გამიკეთებს', 'objective version: he will do for me');
  eq(verbForm(write, { screeve: 'present', s: '3sg', version: 'subjective' }).form, 'იწერს', 'subjective version');
  eq(verbForm(write, { screeve: 'present', s: '1sg', o: '2pl', version: 'objective' }).form, 'გიწერთ', 'plural 2nd person object');
  ok(verbForm(write, { screeve: 'present', s: '1sg', o: '1sg', version: 'objective' }) === null, 'no form for "I … for me" (that is the subjective version)');
  ok(allForms(write).length > 100, 'all forms of a verb');
  eq(decline('სახლი').cases.map((x) => x.form), ['სახლი', 'სახლმა', 'სახლს', 'სახლის', 'სახლით', 'სახლად', 'სახლო'], 'consonant stem cases');
  eq(decline('დედა').cases.map((x) => x.form), ['დედა', 'დედამ', 'დედას', 'დედის', 'დედით', 'დედად', 'დედავ'], 'a-stem cases');
  eq(decline('სახლი').post.map((x) => x.form), ['სახლში', 'სახლზე', 'სახლთან', 'სახლისთვის', 'სახლისგან', 'სახლისკენ', 'სახლივით', 'სახლიდან', 'სახლამდე'], 'postpositions');
  eq(decline('მეგობარი').cases[3].form, 'მეგობრის', 'syncope in the genitive');
  eq(decline('მეგობარი').plural[0].form, 'მეგობრები', 'syncope in the plural');
  eq(analyze('დავუწერ', { verbs: [write] })[0].parts.map((x) => x.role), ['preverb', 'subj', 'version', 'root'], 'split a known verb form');
  eq(analyze('ქალაქში')[0].parts.map((x) => x.s), ['ქალაქ', 'ში'], 'heuristic noun split');
  eq(translit('გამარჯობა'), 'gamarjoba', 'Georgian -> Latin');
  eq(translit('წყალი', 'ru'), 'ц’къали', 'Georgian -> Russian reader');
  eq([20, 30, 40, 55, 99, 101, 2024].map((n) => numberWords(n).text), ['ოცი', 'ოცდაათი', 'ორმოცი', 'ორმოცდათხუთმეტი', 'ოთხმოცდაცხრამეტი', 'ას ერთი', 'ორი ათას ოცდაოთხი'], 'vigesimal numbers');

  // --- Russian
  const best = (w) => split(w)[0].parts.map((x) => x.s + '/' + x.role[0]).join(' ');
  eq(best('сочувствую').split(' ').slice(0, 2), ['со/p', 'чувств/r'], 'со-чувств-');
  eq(best('благодарить'), 'благ/r о/i дар/r и/s ть/s', 'compound with an interfix');
  eq(best('переживать'), 'пере/p жив/r а/s ть/s', 'prefix, root, suffixes');
  eq(best('здравствуйте'), 'здрав/r ств/s уй/s те/p', 'imperative and -те');
  eq(ruTranslit('Щука'), 'Shchuka', 'Russian transliteration');

  // --- strokes
  ok(resample([[0, 0], [10, 0]], 11).every((q, i) => Math.abs(q[0] - i) < 1e-9), 'resample evenly');
  const box = fit([[[0, 0], [2, 1]]], { x0: 0, y0: 0, w: 1, h: 1 });
  ok(Math.abs(box[0][1][0] - 1) < 1e-9 && Math.abs(box[0][0][1] - 0.25) < 1e-9, 'fit keeps the aspect, centred');
  eq(pathStrokes('M10 10L90 10 M50 0L50 100 90 100'), [[[10, 10], [90, 10]], [[50, 0], [50, 100], [90, 100]]], 'path to strokes');
  const shi = pathStrokes('M10 45L90 45 M50 10L50 92');
  const good = compareStrokes(shi.map((s) => s.map(([x, y]) => [x * 2 + 3, y * 2 + 5])), shi);
  ok(good.score >= 95 && good.order && !good.missing, 'the same strokes at another size score high');
  const swapped = compareStrokes([shi[1], shi[0]], shi);
  ok(!swapped.order && swapped.verdicts.includes('order'), 'wrong stroke order found');
  const back = compareStrokes([[...shi[0]].reverse(), shi[1]], shi);
  ok(back.reversed === 1 && back.verdicts.includes('direction'), 'reversed stroke found');
  ok(compareStrokes([shi[0]], shi).missing === 1, 'missing stroke found');
  const N = 20, a = new Uint8Array(N * N), b = new Uint8Array(N * N);
  for (let x = 2; x < 18; x++) for (let k = 0; k < 3; k++) { a[(9 + k) * N + x] = 1; b[(10 + k) * N + x] = 1; }
  const df = distanceField(a, N, N);
  ok(df[10 * N + 5] === 0 && Math.abs(df[14 * N + 5] - 3) < 1e-6, 'distance field');
  const cm = compareMasks(b, a, N, N);
  ok(cm.score > 70 && cm.precision < 0.06, 'a line one pixel off scores well');
  const far = new Uint8Array(N * N);
  for (let y = 2; y < 18; y++) far[y * N + 3] = 1;
  ok(compareMasks(far, a, N, N).score < cm.score, 'a different shape scores lower');

  // The Georgian lexicon and grammar.
  const lex = lexicon();
  ok(lex.length > 1500 && lexStats().v > 150 && lexStats().n > 500, 'a large lexicon');
  const winD = declineNoun('ფანჯარა');
  eq(winD.sg.map((c) => c.form).slice(0, 5), ['ფანჯარა', 'ფანჯარამ', 'ფანჯარას', 'ფანჯრის', 'ფანჯრით'], 'noun cases with syncope');
  eq(winD.pl[0].form, 'ფანჯრები', 'plural');
  const wr = lexByWord('წერა')[0], give = lexByWord('მიცემა')[0];
  eq(verbTable(wr, 'aorist').map((r) => r.form), ['დავწერე', 'დაწერე', 'დაწერა', 'დავწერეთ', 'დაწერეთ', 'დაწერეს'], 'aorist of წერა');
  eq(verbTable(wr, 'present').map((r) => r.form).slice(0, 3), ['ვწერ', 'წერ', 'წერს'], 'present of წერა');
  eq(conjugate(give, 'aorist', '3sg', '1sg').form, 'მომცა', 'მიცემა with a 1sg object: მომცა');
  const fr = caseFrame(wr, 'aorist');
  ok(fr.subj === 'erg' && fr.obj === 'nom', 'series II: ergative subject, nominative object');
  ok(caseFrame(wr, 'perfect').subj === 'dat' && caseFrame(wr, 'perfect').inverted, 'series III: inversion');
  ok(analyzeWord('დავწერე').some((h) => h.lemma === 'წერა' && h.tags.screeve === 'aorist' && h.tags.s === '1sg'), 'analyse a verb form');
  ok(analyzeWord('სახლში').some((h) => h.lemma === 'სახლი' && h.tags.post === 'shi'), 'analyse a noun with a postposition');
  eq(analyzeWord('გამყიდველმა')[0].lemma, 'გამყიდველი', 'a participle that is a noun reads as the noun');
  // Transcription input.
  eq(convert('kartuli').georgian, 'ქართული', 'loose Latin');
  eq(convert('картули').georgian, 'ქართული', 'Russian letters');
  ok(convert("k'artuli").words[0].notes.some((n) => n.level === 'fix' && n.ch === 'ქ'), 'a wrong ejective mark is flagged');
  eq(convert('gamarjoba').georgian, 'გამარჯობა', 'j is ჯ');
  // Sentences.
  eq(buildSentence({ verb: give, screeve: 'aorist', subj: { noun: 'დედა' }, obj: { noun: 'წიგნი' }, io: { pron: '1sg' } }).text, 'დედამ მე წიგნი მომცა.', 'a ditransitive in the aorist');
  eq(buildSentence({ verb: wr, screeve: 'present', subj: { noun: 'კაცი' }, obj: { noun: 'წერილი' } }).text, 'კაცი წერილს წერს.', 'series I cases');
  const ka2 = analyzeKa('კაცმა წერილი დაწერა, რომელიც დედამ წაიკითხა.');
  ok(ka2.clauses.length === 2 && ka2.clauses[1].type === 'relative', 'a relative clause');
  // Text: dialogue, speakers and addressees, coreference, topics.
  const txt = analyzeText('ნინო სახლში შევიდა.\n— გამარჯობა, დედა! — თქვა ნინომ.\n— გამარჯობა, შვილო, — უპასუხა დედამ.\nდედამ ჩაი მოამზადა. მან ნინოს ჩაი მისცა.');
  eq(txt.dialogue.map((d) => d.speaker), ['ნინო', 'დედა'], 'speakers');
  eq(txt.dialogue[1].addressee, 'ნინო', 'the addressee is the other speaker');
  eq(analyzeText('— გამარჯობა, ნინო! — დაუძახა გამყიდველმა.').dialogue[0].addressee, 'ნინო', 'a name in the vocative is the addressee');
  ok(txt.entities.some((e) => e.label === 'ნინო' && e.mentions.length >= 3), 'mentions of a name across the text');
  ok(txt.events.some((e) => e.lemma === 'მიცემა' && txt.entities.find((x) => x.id === e.recipient)?.label === 'ნინო'), 'who gave to whom');
  ok(/^flowchart/.test(toMermaid(entityGraph(txt))) && topicGraph(txt).nodes.length >= 3, 'graphs and their Mermaid text');
  // Morphemes before the dictionary: pieces, the probable rule, labels; search and possible words.
  const top = (f, w) => { const r = f(w)[0]; return r ? r.parts.map((p) => p.s).join('+') + '|' + (r.rule ? r.rule.id : '') : ''; };
  eq(top(parseKa, 'უსახლო'), 'უ+სახლ+ო|ka.without', 'Georgian privative');
  eq(top(parseKa, 'მეთევზე'), 'მე+თევზ+ე|ka.agent', 'Georgian trade');
  eq(top(parseKa, 'გადაწერა'), 'გადა+წერ+ა|ka.masdarPv', 'Georgian preverb and masdar');
  eq(top(parseKa, 'მეღვინეობა'), 'მე+ღვინ+ე+ობა|ka.trade', 'Georgian craft');
  eq(top(parseKa, 'ქართველი'), 'ქართ+ველ+ი|ka.origin', 'Georgian ethnonym');
  ok(parseKa('უწიგნო')[0].labels.lit === 'unattested' && parseKa('უწიგნო')[0].labels.own, 'an unattested word with its own meaning by rule');
  ok(searchKa({ preverb: 'გადა' }).length >= 10 && searchKa({ preverb: 'გადა' }).every((x) => x.w.startsWith('გადა')), 'search by preverb');
  const pk = possibleKa('წერ');
  ok(pk.some((x) => x.w === 'გადაწერა' && x.attested) && pk.some((x) => x.w === 'გაწერა' && !x.attested && x.labels.norm === 'questionable'), 'possible preverbed words, attested or not');
  eq(top(parseRu, 'бездомный'), 'без+дом+н+ый|ru.without', 'Russian without-');
  eq(top(parseRu, 'учитель'), 'учи+тель|ru.agent', 'Russian agent noun');
  eq(top(parseRu, 'домами'), 'дом+ами|ru.form', 'Russian word form');
  ok(parseRu('ложить')[0].labels.norm === 'substandard' && parseRu('домище')[0].labels.norm === 'colloquial', 'Russian register labels');
  ok(!possibleRu('чит').some((x) => x.w === 'разчитать') && possibleRu('чит').some((x) => x.w === 'расчитать' && !x.attested) && possibleRu('чит').some((x) => x.w === 'перечитать' && x.attested), 'Russian prefixed verbs with assimilation');
  eq(top(parseEn, 'friendless'), 'friend+less|en.without', 'English -less');
  eq(top(parseEn, 'biology'), 'bio+logy|en.science', 'English -logy');
  ok(parseEn('irregardless')[0].labels.norm === 'substandard' && attestedEn('workers'), 'English labels and inflected forms');
  ok(matchLabels({ use: 'rare', norm: 'norm', lit: 'unattested' }, { lit: ['unattested'] }) && !matchLabels({ use: 'rare', norm: 'norm', lit: 'neutral' }, { lit: ['unattested'] }), 'label filters');
  const ru = analyzeText('Анна пошла на рынок. Там она купила хлеб.\n— Доброе утро! — сказал продавец.');
  ok(ru.lang === 'ru' && ru.dialogue[0].speaker && /продав/.test(ru.dialogue[0].speaker), 'Russian dialogue');

  // Mingrelian (its own runner: megruli-test.js).
  fail += runMegruli();
  fail += runHangul();
  fail += runTranslit();
  fail += runXlang();
  if (isMain) console.log(`lingua: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) run().then((f) => process.exit(f ? 1 : 0));
