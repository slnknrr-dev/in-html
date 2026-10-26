// prosody/test.js - unit tests of the prosody library: `node prosody/test.js` (importing the module runs nothing).
// Stress and phonemes of the three languages, known rhymes and non-rhymes, the order of rhyme distances, the meter
// and the rhyme scheme of every example stanza (quotes.js), the catch of a poem, scheme expansion and suggestions.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeRu, stressRu } from './phon-ru.js';
import { analyzeEn } from './phon-en.js';
import { analyzeKa } from './phon-ka.js';
import { analyzeWord, tokenize, detectLang } from './words.js';
import { rhymeUnit, compareRhyme } from './rhyme.js';
import { detectMeter, scanLine, template } from './meter.js';
import { expandScheme, partners, detectScheme } from './scheme.js';
import { analyzePoem, completeScheme } from './poem.js';
import { modifiers, rhymeWords, needOf, endings } from './suggest.js';
import { splitEnding } from './morph.js';
import { segDistance } from './phonemes.js';
import { QUOTES } from './quotes.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const ok = (name, cond, info) => { if (cond) pass++; else { fail++; console.log(`FAIL ${name}` + (info !== undefined ? `: ${JSON.stringify(info)}` : '')); } };
  const score = (a, b, lang) => compareRhyme(rhymeUnit(analyzeWord(a, lang)), rhymeUnit(analyzeWord(b, lang)));
  const sylText = (W) => W.syl.map((s) => (s.st === 1 ? s.t.toUpperCase() : s.t)).join('-');

  // --- Russian: stress from the dictionary, ё, analogy; phonetics -------------------------------------------------
  eq('ru молоко', sylText(analyzeRu('молоко')), 'мо-ло-КО');
  eq('ru ё', [stressRu('ещё').src, sylText(analyzeRu('ещё'))], ['yo', 'е-ЩЁ']);
  eq('ru е read as ё', [analyzeRu('звезды').stress, analyzeRu('звезды').syl[0].ph.includes('o')], [0, true]);
  ok('ru variants замок', analyzeRu('замок').alt.length >= 1);
  eq('ru one syllable', analyzeRu('лес').src, 'mono');
  eq('ru clitic', [analyzeRu('на').fn, analyzeRu('на').stress], [true, -1]);
  eq('ru final devoicing', analyzeRu('лёд').syl[0].ph.join(''), 'lʲot');
  eq('ru akanye', analyzeRu('вода').syl[0].ph.join(''), 'vɐ');
  eq('ru -тся', analyzeRu('учится').syl.map((s) => s.ph.join('')).join('.'), 'u.tɕɪ.tsə');
  eq('ru -ого', analyzeRu('белого').syl[2].ph.join(''), 'və');
  eq('ru silent т', analyzeRu('честный').syl.map((s) => s.ph.join('')).join(''), 'tɕesnɨj');
  ok('ru guess by analogy', ['guess', 'dict'].includes(analyzeRu('перезвонивший').src));
  eq('ru override', sylText(analyzeRu('замок', { overrides: new Map([['замок', 1]]) })), 'за-МОК');
  eq('ru hyphen', analyzeRu('чуть-чуть').syl.length, 2);

  // --- English: CMUdict, archaic forms, elision ----------------------------------------------------------------------
  eq('en temperate', [analyzeEn('temperate').syl.length, analyzeEn('temperate').stress, analyzeEn('temperate').elide], [3, 0, [1]]);
  eq('en every elidable', analyzeEn('every').elide, [1]);
  eq('en dimm\'d', [analyzeEn('dimm\'d').syl.length, analyzeEn('dimm\'d').src], [1, 'suffix']);
  eq('en owest', analyzeEn('owest').syl.length, 2);
  eq('en doth', analyzeEn('doth').syl.length, 1);
  eq('en compare stress', analyzeEn('compare').stress, 1);
  ok('en rules for an unknown word', analyzeEn('blorpitude').src === 'rule' && analyzeEn('blorpitude').syl.length === 3);
  eq('en function word', analyzeEn('the').fn, true);

  // --- Georgian: syllables by vowels, weak stress -------------------------------------------------------------------
  eq('ka syllables', analyzeKa('ძლიერითა').syl.map((s) => s.t), ['ძლი', 'ე', 'რი', 'თა']);
  eq('ka ejective', analyzeKa('კაცი').syl[0].ph, ['kʼ', 'a']);
  eq('ka stress first', analyzeKa('ქვეყანა').stress, 0);
  eq('ka lang detect', [detectLang('ქართული'), detectLang('русский'), detectLang('English')], ['ka', 'ru', 'en']);
  eq('tokenize en', tokenize('My mistress\' eyes, \'tis so', 'en').map((t) => t.text), ['My', 'mistress\'', 'eyes', '\'tis', 'so']);
  eq('tokenize ru', tokenize('Чуть-дышущий, в лес!', 'ru').map((t) => t.text), ['Чуть-дышущий', 'в', 'лес']);
  eq('segment distance', [segDistance('a', 'a'), segDistance('t', 'd') < 0.2, segDistance('a', 't')], [0, true, 1]);

  // --- known rhymes and non-rhymes ----------------------------------------------------------------------------------
  const RHYMES = [
    ['ru', 'красою', 'полосою', 'rich'], ['ru', 'днем', 'лепестком', 'exact'], ['ru', 'вступил', 'был', 'exact'], ['ru', 'любовь', 'кровь', 'exact'], ['ru', 'кровь', 'бровь', 'rich'],
    ['ru', 'лютый', 'смуты', 'slant'], ['ru', 'похожа', 'схожа', 'rich'], ['ru', 'несу', 'произнесу', 'rich'],
    ['en', 'day', 'May', 'exact'], ['en', 'night', 'light', 'exact'], ['en', 'sun', 'dun', 'exact'], ['en', 'cloud', 'loud', 'rich'], ['en', 'owest', 'growest', 'exact'],
    ['ka', 'ტანისა', 'სატანისა', 'rich'], ['ka', 'ფერითა', 'მიერითა', 'rich'], ['ka', 'ძლიერითა', 'მონაბერითა', 'rich'],
  ];
  for (const [lang, a, b, kind] of RHYMES) {
    const r = score(a, b, lang);
    ok(`rhyme ${a} / ${b}`, r.score >= (kind === 'slant' ? 0.72 : 0.8) && r.kind === kind, [r.kind, +r.score.toFixed(2)]);
  }
  const NOT = [['ru', 'дом', 'лес'], ['ru', 'половины', 'лесу'], ['ru', 'строго', 'похожа'], ['en', 'sun', 'red'], ['en', 'day', 'days'], ['ka', 'ტანისა', 'ფერითა'], ['ru', 'красою', 'полосой']];
  for (const [lang, a, b] of NOT) { const r = score(a, b, lang); ok(`no rhyme ${a} / ${b}`, r.score < 0.7, [r.kind, +r.score.toFixed(2)]); }
  eq('identical word', score('лес', 'лес', 'ru').kind, 'identical');
  eq('poor open masculine', score('твоя', 'земля', 'ru').kind, 'poor');
  eq('clausula', [rhymeUnit(analyzeRu('днем')).clausula, rhymeUnit(analyzeRu('красою')).clausula, rhymeUnit(analyzeRu('ласковый')).clausula], [0, 1, 2]);
  // the order of distances: rich < exact < slant < assonance < none
  const target = rhymeUnit(analyzeRu('красою'));
  const order = ['полосою', 'водою', 'покоя', 'дорога', 'лес'].map((w) => compareRhyme(rhymeUnit(analyzeRu(w)), target).score);
  ok('distance order ru', order.every((s, k) => k === 0 || s <= order[k - 1]) && order[0] > order[4] + 0.5, order.map((s) => +s.toFixed(2)));
  const tEn = rhymeUnit(analyzeEn('night'));
  const ordEn = ['light', 'bite', 'nice', 'net', 'sun'].map((w) => compareRhyme(rhymeUnit(analyzeEn(w)), tEn).score);
  ok('distance order en', ordEn.every((s, k) => k === 0 || s <= ordEn[k - 1] + 1e-9), ordEn.map((s) => +s.toFixed(2)));

  // --- meter and scheme of the example stanzas ----------------------------------------------------------------------
  // letters seen once are unrhymed; the rest renumbered in order of appearance
  const norm = (s) => { const c = {}, m = {}; let k = 0; for (const x of s) c[x] = (c[x] || 0) + 1; return [...s].map((x) => (x === '-' || c[x] < 2 ? '-' : (m[x] ||= 'ABCDEFGHIJKLMNOP'[k++]))).join(''); };
  for (const q of QUOTES) {
    const lines = q.lines.map((l) => tokenize(l, q.lang).map((t) => analyzeWord(t.text, q.lang)));
    const d = detectMeter(lines, q.lang);
    eq(`meter ${q.id}`, d.meter, q.meter);
    if (q.meter === 'iamb') eq(`feet ${q.id}`, d.feet, q.id.endsWith('gerbel') ? 6 : 5);
    if (q.meter === 'trochee') eq(`feet ${q.id}`, d.feet, 8);
    if (q.lang === 'ka') ok(`16 syllables ${q.id}`, d.scans.every((s) => s.L === 16));
    const P = analyzePoem(q.lines.join('\n'), { lang: q.lang });
    const got = (P.scheme.detected || P.lines.map((L, i) => [i, L.letter])).map(([, l]) => l).join('');
    // Shakespeare's temperate / date is a rhyme on a promoted (unstressed) syllable: it is found as weak only
    const want = q.id === 'shakespeare-18' ? 'A-A-BCBCDEDEFF' : norm(q.scheme);
    eq(`scheme ${q.id}`, P.meter === 'prose' ? P.lines.map(() => '-').join('') : norm(got), want);
  }
  // the example stanzas catch their rhymes
  const sonnet = analyzePoem(QUOTES.find((q) => q.id === 'shakespeare-130').lines.join('\n'), { lang: 'en' });
  ok('sonnet 130 lines caught', sonnet.lines.filter((L) => L.verdict === 'good').length >= 10, sonnet.lines.map((L) => L.verdict));
  eq('sonnet 130 scheme', sonnet.scheme.id, 'sonnet');
  const rust = analyzePoem(QUOTES.find((q) => q.id === 'rustaveli').lines.join('\n'), { lang: 'ka' });
  eq('rustaveli all caught', rust.lines.every((L) => L.verdict === 'good'), true);

  // a line that meter alone fixes: ле́су / лесу́
  const loz = analyzePoem('Земную жизнь пройдя до половины,\nЯ очутился в сумрачном лесу', { lang: 'ru', meter: 'iamb' });
  eq('stress chosen by the meter', loz.lines[1].words[4].W.src === 'meter' || loz.lines[1].words[4].W.stress === 1, true);

  // --- scheme expansion, partners, completion -----------------------------------------------------------------------
  eq('expand cross', expandScheme('cross', 8).join(''), 'ABABCDCD');
  eq('expand terza', expandScheme('terza', 9).join(''), 'ABABCBCDC');
  eq('expand pattern', expandScheme('AA-A', 4).join(''), 'AA-A');
  eq('partners', partners(['A', 'B', 'A', 'B', '-']), [2, 3, 0, 1, -1]);
  eq('complete scheme', [completeScheme(['A', '-', 'A', '-']), completeScheme(['-', '-']), completeScheme(['-', '-', '-', '-'])], ['cross', 'couplet', 'free']);
  eq('detect couplets', detectScheme(['night', 'light', 'sun', 'done'].map((w) => rhymeUnit(analyzeEn(w))), compareRhyme).join(''), 'AABB');
  eq('template iamb 5', template('iamb', 5, 1).map((s) => (s.strong ? 'S' : 'w')).join(''), 'wSwSwSwSwSw');
  eq('template shairi', template('shairi-low', 0).length, 16);
  eq('scan trochee', scanLine(tokenize('Буря мглою небо кроет', 'ru').map((t) => analyzeWord(t.text, 'ru')), 'ru').meter, 'trochee');
  eq('scan amphibrach', scanLine(tokenize('Однажды в студёную зимнюю пору', 'ru').map((t) => analyzeWord(t.text, 'ru')), 'ru').meter, 'amphibrach');
  eq('scan anapest', scanLine(tokenize('Я пришёл к тебе с приветом рассказать', 'ru').map((t) => analyzeWord(t.text, 'ru')), 'ru', 'anapest').meter, 'anapest');
  eq('scan dactyl', scanLine(tokenize('Тучки небесные, вечные странники', 'ru').map((t) => analyzeWord(t.text, 'ru')), 'ru').meter, 'dactyl');

  // --- morphemes and suggestions ------------------------------------------------------------------------------------
  eq('split полосой', [splitEnding('полосой', 'ru').stem, splitEnding('полосой', 'ru').ending], ['полос', 'ой']);
  eq('split სახლებში', splitEnding('სახლებში', 'ka').post, 'ში');
  const poem = analyzePoem('Нет, ты милее длительной красою:\nВесна проходит краткой полосой', { lang: 'ru' });
  const L = poem.lines[1];
  eq('two lines are a couplet', [poem.scheme.id, L.target], ['couplet', 0]);
  ok('a missed rhyme is not good', L.verdict !== 'good', L.catch);
  const need = needOf(L);
  eq('need', need, { syllables: 4, stressFromEnd: 1 });
  const mods = modifiers('полосой', 'ru', { target: poem.lines[0].unit, need });
  eq('modifier ending', mods[0] && mods[0].word, 'полосою');
  const E = endings('полосой', 'ru', { target: poem.lines[0].unit, need });
  eq('ending squares', [E.stem, E.ending, E.options[0] && E.options[0].ending], ['полос', 'ой', 'ою']);
  const fixed = analyzePoem('Нет, ты милее длительной красою:\nВесна проходит краткой полосою', { lang: 'ru' });
  eq('applied ending catches', [fixed.lines[1].verdict, fixed.lines[1].marks[fixed.lines[1].endIndex]], ['good', 'good']);
  const words = rhymeWords(rhymeUnit(analyzeEn('cloud')), 'en', { limit: 30 }).map((s) => s.word);
  ok('rhyme words cloud', words.includes('loud') && words.includes('proud'), words.slice(0, 10));
  const ruWords = rhymeWords(rhymeUnit(analyzeRu('красою')), 'ru', { limit: 30 }).map((s) => s.word);
  ok('rhyme words красою', ruWords.includes('водою') && ruWords.includes('полосою'), ruWords.slice(0, 10));
  const kaMods = modifiers('მიერის', 'ka', { target: rhymeUnit(analyzeKa('ფერითა')) }).map((s) => s.word);
  ok('ka modifiers', kaMods[0] === 'მიერითა', kaMods.slice(0, 5));
  const enMods = modifiers('walk', 'en', {}).map((s) => s.word);
  ok('en modifiers', enMods.includes('walking') && enMods.includes('walked'), enMods);

  // --- the quotes data --------------------------------------------------------------------------------------------
  const year = new Date().getFullYear();
  for (const q of QUOTES) {
    ok(`quote ${q.id} public domain`, q.translator === null || (q.translatorDied && year - q.translatorDied > 70), q.translatorDied);
    ok(`quote ${q.id} fields`, q.group && q.work.en && q.author && q.source && q.lines.length >= 4 && q.lines.length <= 14);
  }
  ok('no Italian Dante', !QUOTES.some((q) => q.author.includes('Dante') && q.lang === 'it'));

  console.log(`prosody: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
