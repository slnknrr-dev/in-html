// util/test.js - unit tests of the utilities: `node util/test.js` (importing the module runs nothing).
// Value helpers, edit distances with cut-offs and closest matches, identifier normal forms (MAC, IPv4, IPv6 per
// RFC 5952, codes) and the light stemmer with prefix scoring.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPath, num, own, str } from './value.js';
import { uid } from './id.js';
import { bestMatch, closest, damerau, fold, levenshtein, similarity, typoBudget } from './fuzzy.js';
import { compactIdent, normalizeCode, normalizeIPv4, normalizeIPv6, normalizeIdent, normalizeIp, normalizeMac } from './ident.js';
import { matchScore, searchKeys, stem, words } from './stem.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };

  // --- value / id -------------------------------------------------------------------------------------------------
  eq('num', [num('12', 0), num('x', 5), num(50, 0, 0, 10)], [12, 5, 10]);
  eq('own skips the prototype', [own({ a: 1 }, 'a'), own({}, 'constructor')], [1, undefined]);
  eq('str', [str(1), str(null, '-'), str({}, '-')], ['1', '-', '-']);
  eq('getPath', [getPath({ a: { b: [1, 2] } }, 'a.b.1'), getPath({}, '__proto__.x')], [2, undefined]);
  eq('uid', /^[a-z][a-z0-9]{7}$/.test(uid()), true);

  // --- fuzzy ------------------------------------------------------------------------------------------------------
  eq('swap is one edit', [damerau('ca', 'ac'), levenshtein('ca', 'ac')], [1, 2]);
  eq('kitten', [damerau('kitten', 'sitting'), damerau('kitten', 'sitting', 1), levenshtein('flaw', 'lawn')], [3, 2, 2]);
  eq('empty and equal', [damerau('', 'abc'), damerau('abc', ''), damerau('same', 'same'), damerau('', '', 0)], [3, 3, 0, 0]);
  eq('cut-off by length', damerau('a', 'abcdef', 2), 3);
  eq('Cyrillic swap', damerau('магазин', 'магазни'), 1);
  eq('code points', damerau('a😀b', 'ab'), 1);
  eq('similarity', [similarity('abcd', 'abce'), similarity('', '')], [0.75, 1]);
  eq('typo budget', [typoBudget('ab'), typoBudget('склад'), typoBudget('warehouse')], [0, 1, 2]);
  eq('fold', fold('Ёлка Café'), 'елка cafe');
  eq('closest', closest('Тбилси', ['Батуми', 'Тбилиси', 'Кутаиси']), [{ item: 'Тбилиси', text: 'тбилиси', d: 1 }]);
  eq('closest order', closest('cat', ['cart', 'cut', 'act', 'dog'], { max: 2 }).map((x) => x.item), ['cut', 'act', 'cart']);
  eq('bestMatch', [bestMatch('wrehouse', ['warehouse', 'store']), bestMatch('zzz', ['warehouse']), bestMatch('cafe', ['Café', 'cake'])], ['warehouse', null, 'Café']);
  eq('bestMatch key', bestMatch('tbilisi', [{ id: 1, n: 'Batumi' }, { id: 2, n: 'Tbilissi' }], { key: (x) => x.n }), { id: 2, n: 'Tbilissi' });
  let seed = 11;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 8) % n; };
  const word = () => Array.from({ length: 1 + rnd(8) }, () => 'abc'[rnd(3)]).join('');
  let symmetric = true, cutOk = true, triangle = true;
  for (let k = 0; k < 300; k++) {
    const a = word(), b = word(), c = word();
    const d = damerau(a, b);
    if (d !== damerau(b, a)) symmetric = false;
    if (damerau(a, b, 2) !== Math.min(d, 3)) cutOk = false;
    if (levenshtein(a, c) > levenshtein(a, b) + levenshtein(b, c)) triangle = false;
  }
  eq('fuzz: symmetric, cut-off, triangle', [symmetric, cutOk, triangle], [true, true, true]);

  // --- ident ------------------------------------------------------------------------------------------------------
  eq('mac', [normalizeMac('aa-bb-cc-dd-ee-ff'), normalizeMac('AABB.CCDD.EEFF'), normalizeMac('aabbccddeeff', { sep: '-', lower: true }), normalizeMac('aa:bb'), normalizeMac('gg:bb:cc:dd:ee:ff')],
    ['AA:BB:CC:DD:EE:FF', 'AA:BB:CC:DD:EE:FF', 'aa-bb-cc-dd-ee-ff', null, null]);
  eq('ipv4', [normalizeIPv4('192.168.010.001'), normalizeIPv4(' 10.0.0.1 '), normalizeIPv4('256.1.1.1'), normalizeIPv4('1.2.3'), normalizeIPv4('1.2.3.4.5')], ['192.168.10.1', '10.0.0.1', null, null, null]);
  for (const [src, want] of [
    ['2001:0DB8:0000:0000:0000:0000:0000:0001', '2001:db8::1'], ['2001:db8:0:0:1:0:0:1', '2001:db8::1:0:0:1'], ['1:0:0:2:0:0:0:3', '1:0:0:2::3'],
    ['2001:db8:0:1:1:1:1:1', '2001:db8:0:1:1:1:1:1'], ['::', '::'], ['::1', '::1'], ['1::', '1::'], ['::ffff:192.0.2.1', '::ffff:192.0.2.1'],
    ['::ffff:c000:0201', '::ffff:192.0.2.1'], ['[fe80::1%eth0]', 'fe80::1%eth0'], ['64:ff9b::1.2.3.4', '64:ff9b::102:304'],
    ['1::2::3', null], ['1:2:3:4:5:6:7', null], ['12345::', null], ['1:2:3:4:5:6:7:8:9', null], ['::1.2.3', null], ['hello', null],
  ]) eq('ipv6 ' + src, normalizeIPv6(src), want);
  eq('ip either', [normalizeIp('010.1.1.1'), normalizeIp('FE80::0001'), normalizeIp('x')], ['10.1.1.1', 'fe80::1', null]);
  eq('code', [normalizeCode('  SN  123/45 '), normalizeCode('INV-7#2'), normalizeCode('a<b'), normalizeCode(''), normalizeCode('x'.repeat(65))], ['SN 123/45', 'INV-7#2', null, null, null]);
  eq('ident by type', [normalizeIdent('bssid', 'aabbccddeeff'), normalizeIdent('ip', '::0'), normalizeIdent('serial', ' A 1 ')], ['AA:BB:CC:DD:EE:FF', '::', 'A 1']);
  eq('compact', [compactIdent('aa-bb:cc'), compactIdent('Инв. № 12')], ['AABBCC', 'ИНВ12']);

  // --- stem -------------------------------------------------------------------------------------------------------
  eq('ru stems', ['перемещения', 'перемещение', 'перемещать'].map(stem), ['перемещ', 'перемещ', 'перемещ']);
  eq('ru short and ё', [stem('дом'), stem('Ёлками')], ['дом', 'елк']);
  eq('en stems', ['suppliers', 'supplier', 'categories', 'loading', 'moved', 'boxes', 'is'].map(stem), ['supplier', 'supplier', 'category', 'load', 'mov', 'box', 'is']);
  eq('words / keys', [words('Ёлки, и 2 поставщика!'), searchKeys('Поставщики товаров')], [['елки', 'и', '2', 'поставщика'], ['поставщик', 'товар']]);
  eq('score', [matchScore('поставщики', { title: 'Поставщик', body: 'список поставщиков' }), matchScore('склад касса', { title: 'Склад' }), matchScore('', { title: 'x' })], [6, 0, 0]);
  eq('score body only', matchScore('suppliers', { body: 'Supplier list of suppliers' }), 2);

  console.log(`util: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
