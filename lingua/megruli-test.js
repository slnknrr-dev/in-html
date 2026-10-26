// lingua/megruli-test.js - tests of the Mingrelian module: `node lingua/megruli-test.js`, or `runMegruli()` from
// lingua/test.js (returns the number of failures; importing the module runs nothing).
//
// Same harness as hangul-test.js (zero deps, Node + browser). Besides fixed examples it runs data-wide invariants:
// Latin/Russian round trips over the whole lexicon, unique headwords, "parts add up to the form" for every
// generated form, and every sound rule's own examples must be explained by explainPair. These catch data entry
// errors that example tests never would. The round trips skip words whose letter sequences are inherently
// ambiguous in the transcription (თ+ს vs ც-like digraphs), a known limitation of digraph romanisations.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALPHABET, LEXICON, RULES, EPENTHESIS, EXCEPTIONS, VERBS, CASES, lexByWord, lexStats, translit, fromLatin, fromRussian, toScript,
  decline, present, imperfect, aorist, parse, toMegruli, toGeorgian, explainPair, ruleById,
} from './megruli.js';

// ESM "main module" check; the typeof guard keeps the import safe in browsers.
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export function runMegruli() {
  let pass = 0, fail = 0;
  const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('x megruli: ' + msg); } };
  const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  const top = (w) => parse(w)[0] || null;

  // --- alphabet and transliteration
  eq(ALPHABET.length, 36, '33 Georgian letters + ჷ ჸ ჲ');
  eq(ALPHABET.filter((a) => a.extra).map((a) => a.ch).join(''), 'ჷჸჲ', 'the Mingrelian additions');
  ok(ALPHABET.every((a) => a.lat && a.ru && a.ipa), 'every letter has Latin, Russian and IPA');
  eq(translit('ჸუჯი', 'lat'), 'ʔuji', 'glottal stop in Latin');
  eq(translit('ჭარუა', 'ru'), 'ч’аруа', 'ejective in Russian');
  eq(translit('ბჟა', 'ipa'), 'bʒɑ', 'IPA');
  eq(fromLatin("ch'arua"), 'ჭარუა', 'Latin with an ejective mark');
  eq(fromLatin('ʔuji'), 'ჸუჯი', 'Latin ʔ');
  eq(fromLatin("q'velebi"), 'ყველები', "q' is ყ");
  eq(fromRussian('джогъори'), 'ჯოღორი', 'Russian transcription');
  eq(toScript('margali'), 'მარგალი', 'any input to the script');
  eq(toScript('მარგალი'), 'მარგალი', 'Georgian script is kept');
  // a round trip through Latin for every word whose letters cannot merge into a digraph (თს, დზ, ქჰ…)
  const amb = /თს|დზ|ზჰ|სჰ|ქჰ|ღჰ|ცჰ|ჩჰ|ტს|ფჰ|ჰ/;
  const bad = LEXICON.filter((e) => !amb.test(e.w) && fromLatin(translit(e.w, 'lat')) !== e.w).map((e) => e.w);
  eq(bad, [], 'Latin round trip of the lexicon');
  const badRu = LEXICON.filter((e) => !/დჟ|დზ|ღჰ/.test(e.w) && fromRussian(translit(e.w, 'ru')) !== e.w).map((e) => e.w);
  eq(badRu, [], 'Russian round trip of the lexicon');

  // --- lexicon integrity
  const st = lexStats();
  ok(st.total >= 140 && st.verified >= 100 && st.cognates >= 80, `lexicon size ${JSON.stringify(st)}`);
  eq(new Set(LEXICON.map((e) => e.w)).size, LEXICON.length, 'unique headwords');
  ok(LEXICON.every((e) => e.ru && e.en && e.pos && e.group && /^[ა-ჰჷჸჲ ]+$/.test(e.w)), 'every entry: glosses, part of speech, theme, Georgian script');
  ok(LEXICON.every((e) => !e.ka || /^[ა-ჰ ]+$/.test(e.ka)), 'cognates are in the Georgian alphabet (no ჷ ჸ ჲ)');
  eq(lexByWord('ოში').en, 'hundred', 'lookup');
  ok(lexByWord('ნანა').unverified && !lexByWord('დიდა').unverified, 'unverified flags are read');
  eq(['არტი', 'ჟირი', 'სუმი', 'ოთხი', 'ხუთი', 'ამშვი', 'შქვითი', 'რუო', 'ჩხორო', 'ვითი'].map((w) => !!lexByWord(w)), Array(10).fill(true), 'numbers 1-10');

  // --- nouns
  const koch = decline('კოჩი');
  eq(koch.sg.map((f) => f.form), ['კოჩი', 'კოჩქ', 'კოჩს', 'კოჩიში', 'კოჩით', 'კოჩო', 'კოჩიშა', 'კოჩიშე', 'კოჩიშენ'], 'cases of a consonant stem');
  eq(koch.pl.slice(0, 4).map((f) => f.form), ['კოჩეფი', 'კოჩეფქ', 'კოჩეფს', 'კოჩეფიში'], 'plural -ეფ-');
  ok(koch.sg.find((f) => f.id === 'erg').unverified && !koch.sg.find((f) => f.id === 'dat').unverified, 'the ergative of a consonant stem is flagged');
  const dida = decline('დიდა');
  eq(dida.sg.map((f) => f.form).slice(0, 4), ['დიდა', 'დიდაქ', 'დიდას', 'დიდაში'], 'cases of a vowel stem');
  ok(dida.pl.every((f) => f.unverified), 'the plural of a vowel stem is flagged');
  ok(koch.sg.every((f) => f.parts.map((p) => p.s).join('') === f.form), 'parts add up to the form');
  eq(CASES.length, 9, 'nine cases');

  // --- verbs
  const write = VERBS.find((v) => v.id === 'write');
  eq(present(write).map((f) => f.form), ['ვჭარუნქ', 'ჭარუნქ', 'ჭარუნს', 'ვჭარუნთ', 'ჭარუნთ', 'ჭარუნა'], 'present of "write"');
  ok(present(write).every((f) => !f.unverified) && imperfect(write).every((f) => f.unverified) && aorist(write).every((f) => f.unverified), 'only the present is verified');
  eq(aorist(write)[2].form, 'დოჭარუ', 'aorist 3sg');
  ok([...present(write), ...imperfect(write), ...aorist(write)].every((f) => f.parts.map((p) => p.s).join('') === f.form), 'verb parts add up');
  ok(EXCEPTIONS.every((e) => e.parts.map((p) => p.s).join('') === e.w), 'exception parts add up');

  // --- parser
  let r = top('ვჭარუნქ');
  ok(r && r.lemma === 'ჭარუა' && r.tags.s === '1sg' && r.tags.screeve === 'present' && r.rule.id === 'verb-present', 'parse a present 1sg');
  r = top('ჭარუნს');
  ok(r && r.tags.s === '3sg' && r.ka === 'წერ', 'parse a present 3sg with its Georgian root');
  r = top('დოჭარუ');
  ok(r && r.tags.screeve === 'aorist' && r.tags.preverb === 'დო' && r.unverified, 'parse an aorist (flagged)');
  r = top('კოჩიშა');
  ok(r && r.lemma === 'კოჩი' && r.tags.case === 'all' && r.parts.map((p) => p.s).join('+') === 'კოჩ+იშა', 'parse the allative');
  r = top('ჯოღორეფიშე');
  ok(r && r.lemma === 'ჯოღორი' && r.tags.number === 'pl' && r.tags.case === 'abl', 'parse plural + ablative');
  r = top('დიდაქ');
  ok(r && r.lemma === 'დიდა' && r.tags.case === 'erg' && !r.unverified, 'parse the ergative of a vowel stem');
  r = top('კოჩიშჷ');
  ok(r && r.lemma === 'კოჩი' && r.tags.case === 'gen', 'final ჷ read as ი');
  r = top('მიჩქუ');
  ok(r && r.rule.id === 'exception' && r.tags.inverted, 'inverted "I know" from the exceptions');
  r = top('ვორექ');
  ok(r && r.lemma === 'რე' && r.tags.s === '1sg', 'copula');
  r = top('margalepi');
  ok(r && r.lemma === 'მარგალი' && r.tags.number === 'pl', 'Latin input is parsed');
  r = top('ვქიმინუნქ');
  ok(r && r.rule.id === 'verb-guess' && r.score < 0.5 && r.unverified, 'an unknown root gives a guess');
  ok(parse('ოში').some((x) => x.rule.id === 'lexicon'), 'dictionary word');
  ok(parse('').length === 0 && parse('!!!').length === 0, 'empty input');
  ok(parse('კოჩიშა').every((x) => x.parts.map((p) => p.s).join('') === 'კოჩიშა'), 'readings add up to the word');

  // --- sound correspondences
  for (const rule of [...RULES, EPENTHESIS]) {
    for (const [ka, xmf] of rule.ex) {
      const ex = explainPair(xmf, ka);
      ok(ex.rules.includes(rule.id), `rule ${rule.id}: ${ka} → ${xmf} (${JSON.stringify(ex)})`);
    }
  }
  ok(['ძაღლი', 'მზე', 'ცხრა', 'კბილი', 'რვა', 'ყველი', 'თვალი', 'ყური', 'ქათამი'].every((ka) => explainPair(lexByWord(LEXICON.find((e) => e.ka === ka).w).w, ka).reached), 'textbook pairs are reached completely');
  eq(explainPair('ჯოღორი', 'ძაღლი').rules.sort(), ['a-o', 'dz-j', 'epenthesis', 'l-r'], 'dog: four changes');
  const ar = explainPair('არტი', 'ერთი');
  ok(!ar.reached && ar.rest === 1 && ar.rules.includes('e-a'), 'one: e → a, the ejective t is irregular');
  eq(toMegruli('კაცი')[0].form, 'კოჩი', 'Georgian → Mingrelian: attested first');
  ok(toMegruli('კაცი')[0].attested && toMegruli('კაცი')[0].rules.join() === 'a-o,c-ch', 'with the rules');
  eq(toMegruli('ცხენი')[0].form, 'ცხენი', 'an unchanged loan is attested');
  eq(toGeorgian('ჯოღორი')[0].form, 'ძაღლი', 'Mingrelian → Georgian');
  const kaKnown = new Set(['ქათამი']);
  ok(toGeorgian('ქოთომი', { known: (w) => kaKnown.has(w) })[0].form === 'ქათამი', 'reverse with a Georgian word list');
  ok(toMegruli('თხილი').some((c) => c.form === 'თხირი' && c.known), 'a proposal the lexicon knows');
  ok(ruleById('l-r').ka === 'ლ' && ruleById('epenthesis') === EPENTHESIS, 'rules by id');
  // the lexicon's cognates: how many the rules reach
  // A coverage threshold, not an exact count: adding words must not break the test, regressing the rules must.
  const pairs = LEXICON.filter((e) => e.ka && e.kaSure);
  const reached = pairs.filter((e) => explainPair(e.w, e.ka).reached).length;
  ok(reached >= pairs.length * 0.5, `the rules explain at least half of the cognate pairs (${reached} / ${pairs.length})`);

  if (isMain) console.log(`megruli: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exit(runMegruli() ? 1 : 0);
