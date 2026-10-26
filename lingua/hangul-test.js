// lingua/hangul-test.js - tests of the Korean modules (hangul.js, korean.js, korean-lexicon.js).
//   runHangul() -> number of failures   (also runnable alone: `node lingua/hangul-test.js`)
//
// Design: no test framework, so the file runs both in Node and inside the browser self-test page with zero deps.
// Each case is a linguistic fact checked against a known reference form (Standard Pronunciation, RR tables,
// Kontsevich); a failing case prints its expected/actual JSON. eq compares via JSON.stringify: adequate for the
// plain records here (key order is stable because the code builds objects in a fixed order), wrong for Maps/Sets.
// Cases are grouped by module layer, bottom-up, so the first failure points at the lowest broken layer.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemble, compose, decompose, fromRoman, kontsevich, parts, pronounce, romanize, toJamo, translit, JAMO, SOUND_RULES } from './hangul.js';
import { conjugate, parse, parseWord, score, RULES } from './korean.js';
import { KO_LEXICON } from './korean-lexicon.js';

// "Run as script" detection for ESM (no require.main): compare argv[1] with this module's path. The typeof guard
// keeps the import harmless in browsers, where `process` does not exist.
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export function runHangul() {
  let pass = 0, fail = 0;
  const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('x hangul: ' + msg); } };
  const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);

  // blocks and jamo
  eq(decompose('한'), { L: 'ㅎ', V: 'ㅏ', T: 'ㄴ' }, 'decompose 한');
  eq(compose('ㄷ', 'ㅏ', 'ㄺ'), '닭', 'compose with a cluster final');
  eq(compose('ㅇ', 'ㅘ'), '와', 'compose a compound vowel');
  eq(parts('ㄲ'), ['ㄱ', 'ㄱ'], 'double consonant');
  eq(parts('ㅘ'), ['ㅗ', 'ㅏ'], 'compound vowel');
  eq(parts('ㄳ'), ['ㄱ', 'ㅅ'], 'cluster final');
  eq(toJamo('한글'), 'ㅎㅏㄴㄱㅡㄹ', 'to jamo');
  eq(assemble('ㅎㅏㄴㄱㅡㄹ'), '한글', 'keyboard: 한글');
  eq(assemble('ㄷㅏㄹㄱㅇㅣ'), '닭이', 'keyboard: cluster final');
  eq(assemble('ㅇㅣㄹㄱㅓ'), '일거', 'keyboard: the second part of a cluster moves on');
  eq(assemble('ㄱㅗㅏㅇ'), '광', 'keyboard: ㅗ + ㅏ');
  ok(JAMO.length === 40 && JAMO.every((j) => j.rr && j.ipa && j.name), 'jamo table: 19 consonants, 21 vowels');

  // pronunciation
  const P = (w) => pronounce(w).text;
  const rules = (w) => pronounce(w).changes.map((c) => c.rule);
  eq(P('한국어'), '한구거', 'liaison');
  eq(P('읽어요'), '일거요', 'liaison of a cluster');
  eq(P('감사합니다'), '감사함니다', 'nasalisation ㅂ+ㄴ');
  eq(P('먹는'), '멍는', 'nasalisation ㄱ+ㄴ');
  eq(P('있는'), '인는', 'neutralisation then nasalisation');
  eq(P('신라'), '실라', 'lateralisation ㄴ+ㄹ');
  eq(P('설날'), '설랄', 'lateralisation ㄹ+ㄴ');
  eq(P('종로'), '종노', 'ㄹ → ㄴ after ㅇ');
  eq(P('국립'), '궁닙', 'ㄹ → ㄴ after ㄱ, then nasalisation');
  eq(P('좋고'), '조코', 'aspiration ㅎ+ㄱ');
  eq(P('축하'), '추카', 'aspiration ㄱ+ㅎ');
  eq(P('좋아요'), '조아요', 'silent ㅎ before a vowel');
  eq(P('많아요'), '마나요', 'ㄶ before a vowel');
  eq(P('놓는'), '논는', 'ㅎ before ㄴ');
  eq(P('좋습니다'), '조씀니다', 'ㅎ+ㅅ → ㅆ');
  eq(P('같이'), '가치', 'palatalisation');
  eq(P('굳이'), '구지', 'palatalisation ㄷ');
  eq(P('닫히다'), '다치다', 'aspiration and palatalisation');
  eq(P('학교'), '학꾜', 'tensing');
  eq(P('읽고'), '일꼬', 'ㄺ before ㄱ keeps ㄹ, tensing');
  eq(P('앉다'), '안따', 'cluster simplification and tensing');
  eq(P('닭'), '닥', 'final cluster');
  eq(P('값'), '갑', 'final cluster ㅄ');
  eq(P('옷'), '옫', 'final neutralisation');
  eq(P('밖에'), '바께', 'double final moves whole');
  eq(P('없어요'), '업써요', 'ㅄ before a vowel: ㅅ moves and tenses');
  eq(pronounce('학교', { tense: false }).text, '학교', 'tensing can be switched off');
  ok(rules('국립').join() === 'l-n,nasal', 'the order of the changes is reported');
  ok(Object.keys(SOUND_RULES).every((k) => SOUND_RULES[k].ru && SOUND_RULES[k].en), 'every sound rule is explained');
  ok(pronounce('같이').changes[0].from === '같이' && pronounce('같이').changes[0].to === '가치', 'a change shows before and after');

  // romanization and transcription
  eq(romanize('안녕하세요'), 'annyeonghaseyo', 'RR: annyeonghaseyo');
  eq(romanize('감사합니다'), 'gamsahamnida', 'RR follows nasalisation');
  eq(romanize('한국어'), 'hangugeo', 'RR follows liaison');
  eq(romanize('학교'), 'hakgyo', 'RR does not mark tensing');
  eq(romanize('신라'), 'silla', 'RR: ㄹㄹ = ll');
  eq(romanize('같이'), 'gachi', 'RR: palatalisation');
  eq(romanize('좋고'), 'joko', 'RR: aspiration');
  eq(romanize('서울'), 'seoul', 'RR: final ㄹ = l');
  eq(romanize('김치 주세요'), 'gimchi juseyo', 'RR keeps spaces');
  eq(translit('읽어요'), 'ilg-eoyo', 'letter by letter');
  eq(kontsevich('안녕하세요'), 'аннёнхасеё', 'Kontsevich: аннёнхасеё');
  eq(kontsevich('감사합니다'), 'камсахамнида', 'Kontsevich: voiced between vowels, nasalisation');
  eq(kontsevich('한국어'), 'хангуго', 'Kontsevich: ㄱ voiced after ㄴ');
  eq(kontsevich('서울'), 'соуль', 'Kontsevich: final ㄹ = ль');
  eq(kontsevich('학교'), 'хаккё', 'Kontsevich: tensing');
  eq(kontsevich('김치'), 'кимчхи', 'Kontsevich: ㅊ = чх');

  // Latin input: passes the parser's score() so lexicon knowledge breaks ties (joayo -> 좋아요 needs it: the silent
  // ㅎ is invisible in the Latin and only a dictionary can restore it).
  const H = (r) => fromRoman(r, { score }).text;
  eq(H('annyeonghaseyo'), '안녕하세요', 'input: annyeonghaseyo');
  eq(H('gamsahamnida'), '감사합니다', 'input: nasalised spelling back to 합니다');
  eq(H('gamsahabnida'), '감사합니다', 'input: letter-by-letter spelling');
  eq(H('hangugeo'), '한국어', 'input: liaison undone');
  eq(H('isseoyo'), '있어요', 'input: 있어요');
  eq(H('joayo'), '좋아요', 'input: the silent ㅎ is found with the parser');
  eq(H('jeo-neun haksaeng-ieyo'), '저는 학생이에요', 'input: hyphens and spaces');
  eq(H('kimchi'), '김치', 'input: loose k for ㄱ');
  ok(fromRoman('hanguk').alts[0].options.includes('항욱'), 'input: alternatives are offered');

  // conjugation
  const F = (stem, o) => conjugate(stem, o).form;
  eq(F('먹', { end: 'ayo' }), '먹어요', 'harmony 어');
  eq(F('살', { end: 'ayo' }), '살아요', 'harmony 아');
  eq(F('가', { past: true, end: 'ayo' }), '갔어요', 'contraction with the past');
  eq(F('오', { end: 'ayo' }), '와요', 'ㅗ + ㅏ');
  eq(F('마시', { end: 'ayo' }), '마셔요', 'ㅣ + ㅓ');
  eq(F('되', { end: 'ayo' }), '돼요', 'ㅚ + ㅓ');
  eq(F('하', { end: 'ayo' }), '해요', '하다');
  eq(F('가', { end: 'seumnida' }), '갑니다', 'fused ㅂ니다');
  eq(F('먹', { end: 'seumnida' }), '먹습니다', '습니다');
  eq(F('살', { end: 'seumnida' }), '삽니다', 'ㄹ drops before ㅂ');
  eq(F('살', { end: 'neun' }), '사는', 'ㄹ drops before ㄴ');
  eq(F('만들', { end: 'n' }), '만든', 'ㄹ drops before fused ㄴ');
  eq(F('읽', { end: 'myeon' }), '읽으면', '으 after a consonant');
  eq(F('가', { hon: true, end: 'ayo' }), '가세요', 'honorific + 어요 = 세요');
  eq(F('읽', { hon: true, past: true, end: 'seumnida' }), '읽으셨습니다', 'honorific past formal');
  eq(F('덥', { cls: 'b', end: 'ayo' }), '더워요', 'ㅂ-irregular');
  eq(F('돕', { cls: 'b-o', end: 'ayo' }), '도와요', 'ㅂ-irregular 와');
  eq(F('춥', { cls: 'b', end: 'n' }), '추운', 'ㅂ-irregular adnominal');
  eq(F('듣', { cls: 'd', end: 'ayo' }), '들어요', 'ㄷ-irregular');
  eq(F('듣', { cls: 'd', end: 'myeon' }), '들으면', 'ㄷ-irregular with 으');
  eq(F('낫', { cls: 's', end: 'ayo' }), '나아요', 'ㅅ-irregular');
  eq(F('모르', { end: 'ayo' }), '몰라요', '르-irregular');
  eq(F('부르', { past: true, end: 'ayo' }), '불렀어요', '르-irregular past');
  eq(F('그렇', { cls: 'h', end: 'ayo' }), '그래요', 'ㅎ-irregular');
  eq(F('파랗', { cls: 'h', end: 'n' }), '파란', 'ㅎ-irregular adnominal');
  eq(F('바쁘', { end: 'ayo' }), '바빠요', '으 drops, 아 after ㅏ');
  eq(F('쓰', { past: true, end: 'ayo' }), '썼어요', '으 drops in one syllable');
  eq(F('가', { fut: true, end: 'seumnida' }), '가겠습니다', '-겠-');
  eq(F('가', { past: true, end: 'neunda' }), '갔다', 'plain past is -았다, not -았는다');

  // the parser
  const top = (w) => parseWord(w)[0] || {};
  eq(top('먹었어요').lemma, '먹다', 'parse 먹었어요');
  eq(top('갔습니다').lemma, '가다', 'parse 갔습니다');
  eq(top('몰라요').rule.id, 'reu-irr', 'the rule applied: 르');
  eq(top('더워요').rule.id, 'b-irr', 'the rule applied: ㅂ');
  eq(top('그래요').rule.id, 'h-irr', 'the rule applied: ㅎ');
  eq(top('나아요').lemma, '낫다', 'ㅅ-irregular parsed');
  ok(parseWord('들었어요').some((r) => r.lemma === '듣다') && parseWord('들었어요').some((r) => r.lemma === '들다'), 'ambiguity: 듣다 and 들다');
  ok(parseWord('사는').some((r) => r.lemma === '살다' && r.rule.id === 'l-drop'), '사는 from 살다');
  eq(top('학교에서는').parts.map((p) => p.s), ['학교', '에서', '는'], 'noun + two particles');
  eq(top('집으로').parts.map((p) => p.s), ['집', '으로'], '으로 after a consonant');
  eq(top('학생이에요').kind, 'copula', 'copula after a consonant');
  eq(top('의사예요').kind, 'copula', 'copula after a vowel');
  eq(top('제가').parts.map((p) => p.s), ['저', '가'], 'exception 제가');
  eq(top('계세요').lemma, '계시다', 'honorific verb 계시다');
  eq(top('계세요').reg, 'hon', 'register label');
  eq(top('감사합니다').level, 'formal', 'speech level 합니다체');
  eq(top('먹어요').level, 'polite', 'speech level 해요체');
  eq(top('먹어').level, 'intimate', 'speech level 반말');
  ok(top('공부했어요').lemma === '공부하다', '하다 verb');
  const g = top('운동했어요');
  ok(g.lemma === '운동하다' && g.conf > 0.6, 'noun + 하다 not in the dictionary as a verb');
  const u = parseWord('뛰었어요')[0];
  ok(u && u.lemma === '뛰다' && u.rules.includes('guess') && u.conf < 0.5, 'unknown stem guessed by shape, low confidence');
  ok(Object.values(RULES).every((r) => r.ru && r.en), 'every parser rule is explained');
  const s = parse('저는 김치를 안 먹어요');
  ok(s.length === 4 && s[2].notes.includes('neg-an'), 'negation 안');
  ok(parse('먹지 않아요')[0].notes.includes('neg-ji'), 'negation -지 않다');
  ok(parse('가고 싶어요')[0].notes.includes('want'), '-고 싶다');
  ok(KO_LEXICON().length >= 400, 'seed lexicon: several hundred entries');

  if (isMain) console.log(`hangul: ${pass} passed, ${fail} failed`);
  return fail;
}

// Non-zero exit on any failure so CI / npm scripts fail fast.
if (isMain) process.exit(runHangul() ? 1 : 0);
