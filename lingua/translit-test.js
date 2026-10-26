// lingua/translit-test.js - tests of the romanisations, slugs and script checks (translit.js, scripts.js).
//   runTranslit() -> number of failures   (also runnable alone: `node lingua/translit-test.js`)
// Same conventions as test.js: ok / eq counters, failures logged, the count returned for the aggregate runner. Cases
// cover each standard's distinctive letters (ejectives, щ, зг, word-initial є) and the security properties of ids
// (mixed scripts, look-alikes of reserved words).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kaFromLatin, romanize, romanizeKa, romanizeRu, romanizeUk, slugify } from './translit.js';
import { checkId, cleanId, confusable, mixesScripts, scriptOf, scriptsOf, skeleton } from './scripts.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export function runTranslit() {
  let pass = 0, fail = 0;
  const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('x translit: ' + msg); } };
  const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);

  // Georgian national romanisation (2002)
  eq(romanizeKa('წყალი ჭაჭა კაკალი'), "ts'q'ali ch'ach'a k'ak'ali", 'Georgian with apostrophes');
  eq(romanizeKa('წყალტუბო', { apostrophes: false }), 'tsqaltubo', 'Georgian as on road signs');
  eq(romanizeKa('ქუთაისი ღვინო ხაჭაპური ჟურნალი ძმა ჯვარი'), "kutaisi ghvino khach'ap'uri zhurnali dzma jvari", 'Georgian digraphs');
  eq(romanizeKa('ᲗᲑᲘᲚᲘᲡᲘ'), 'TBILISI', 'Mtavruli capitals');
  eq(kaFromLatin("ts'q'ali k'ak'ali tbilisi"), 'წყალი კაკალი თბილისი', 'Latin back to Georgian');
  eq(kaFromLatin("t'sa"), 'ტსა', 'an apostrophe splits t + s');
  const ka = 'ჭიათურა წყნეთი ყვარელი ფოთი ზუგდიდი';
  eq(kaFromLatin(romanizeKa(ka)), ka, 'Georgian round trip');

  // Russian ICAO 9303
  eq(romanizeRu('Щукин Юрий Подъячев'), 'Shchukin Iurii Podieiachev', 'ICAO щ ю й ъ я');
  eq(romanizeRu('Ёлкина Эльвира Хрущёв'), 'Elkina Elvira Khrushchev', 'ICAO ё э ь х');
  eq(romanizeRu('ЩУКА Цой'), 'SHCHUKA Tsoi', 'capitals kept');

  // Ukrainian KMU 2010
  eq(romanizeUk('Згорани Розгон'), 'Zghorany Rozghon', 'зг is zgh');
  eq(romanizeUk('Єнакієве Гаївка Юрій Яготин Їжакевич'), 'Yenakiieve Haivka Yurii Yahotyn Yizhakevych', 'initial and medial є ї й ю я');
  eq(romanizeUk("Знам'янка Ґалаґан Короп'є"), 'Znamianka Galagan Koropie', 'apostrophe and ґ');
  eq(romanizeUk('Київ ЗГУРІВКА'), 'Kyiv ZGHURIVKA', 'Kyiv, capitals');
  eq(romanize('Київ Одеса'), 'Kyiv Odesa', 'auto: Ukrainian by і ї є ґ');
  eq(romanize('Тбилиси თბილისი', { apostrophes: false }), 'Tbilisi tbilisi', 'auto: Russian and Georgian');

  // slugs
  eq(slugify('Тбилиси, ул. Руставели 12'), 'tbilisi-ul-rustaveli-12', 'slug Russian');
  eq(slugify('თბილისი — რუსთაველის გამზირი'), 'tbilisi-rustavelis-gamziri', 'slug Georgian');
  eq(slugify('Київ, вул. Хрещатик'), 'kyiv-vul-khreshchatyk', 'slug Ukrainian');
  eq(slugify('Crème brûlée & Straße'), 'creme-brulee-strasse', 'slug accented Latin');
  eq(slugify('Krishna’s flute'), 'krishnas-flute', 'slug apostrophe');
  eq(slugify('Сделано в Грузии', { lang: 'uk' }), 'sdelano-v-hruzyy', 'slug with a forced language');
  eq([slugify('a'.repeat(70) + ' b', { max: 10 }), slugify('abcd efgh', { max: 5 }), slugify('!!!'), slugify('a b', { sep: '_' })], ['aaaaaaaaaa', 'abcd', '', 'a_b'], 'slug limits');

  // scripts and identifiers
  eq([scriptOf('a'), scriptOf('ж'), scriptOf('ა'), scriptOf('1'), scriptOf('-'), scriptOf('語')], ['latin', 'cyrillic', 'georgian', null, null, 'han'], 'scriptOf');
  eq(scriptsOf('chess сhess 12'), ['latin', 'cyrillic'], 'scriptsOf');
  eq([mixesScripts('сhess'), mixesScripts('шахматы-2024'), mixesScripts('日本語のテキスト'), mixesScripts('ქართული-ab')], [true, false, false, true], 'mixed scripts');
  eq(skeleton('сhess'), 'chess', 'skeleton of a Cyrillic с');
  eq([confusable('chess', 'сhess'), confusable('chess', 'chess'), confusable('paypal', 'pаypа1'), confusable('modern', 'modem')], [true, false, true, true], 'confusable');
  eq(cleanId('  Шахматы!! Клуб '), 'шахматы-клуб', 'cleanId');
  eq([checkId('Шахматы').reason, checkId('сhess').reason, checkId('ALL', { reserved: ['all'] }).reason, checkId('a11', { reserved: ['all'] }).reason,
    checkId('a').reason, checkId('!!').reason, checkId('').reason], ['', 'mixed-scripts', 'reserved', 'reserved', 'too-short', 'no-letters', 'empty'], 'checkId reasons');
  eq(checkId('Chess Club'), { id: 'chess-club', reason: '' }, 'checkId accepted');

  if (isMain) console.log(`translit: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exit(runTranslit() ? 1 : 0);
