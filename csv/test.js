// csv/test.js - unit tests of the CSV library: `node csv/test.js` (importing the module runs nothing).
// Parse / serialize round trips (fuzzed), newline styles, BOM, chunked and sliced parsing, sniffing, header detection,
// encodings, type inference, column mapping and loose coercions.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSVParser, hasHeader, parseCSV, parseCSVAsync, serializeCSV, sniffCSV } from './csv.js';
import { decodeBytes, detectEncoding, encodeText } from './encoding.js';
import { convertColumn, detectColumn, inferValue, parseDate, parseNumber } from './infer.js';
import { coerceField, normHeader, parseFlag, parseLooseDate, parseLooseNumber, suggestMapping } from './mapping.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };

  // --- parsing ------------------------------------------------------------------------------
  eq('simple', parseCSV('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
  eq('crlf + trailing newline', parseCSV('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
  eq('cr only', parseCSV('a,b\r1,2'), [['a', 'b'], ['1', '2']]);
  eq('quotes', parseCSV('"a,1","b ""q""","c\r\nd"\n'), [['a,1', 'b "q"', 'c\r\nd']]);
  eq('empty fields', parseCSV(',,\n,'), [['', '', ''], ['', '']]);
  eq('empty line kept', parseCSV('a\n\nb'), [['a'], [''], ['b']]);
  eq('bom', parseCSV('﻿x,y'), [['x', 'y']]);
  eq('lenient after quote', parseCSV('"ab"c,d'), [['abc', 'd']]);
  eq('unterminated quote', parseCSV('"abc\ndef'), [['abc\ndef']]);
  eq('semicolon', parseCSV('a;"b;c"', { delimiter: ';' }), [['a', 'b;c']]);
  eq('tab', parseCSV('a\t"b\tc"', { delimiter: '\t' }), [['a', 'b\tc']]);
  eq('no quote char', parseCSV('"a",b', { quote: '' }), [['"a"', 'b']]);
  eq('maxRows', parseCSV('1\n2\n3', { maxRows: 2 }), [['1'], ['2']]);
  eq('serialize', serializeCSV([['a', 'b,c', 'd"e', ' sp', 'x\ny'], [1, true, null, false]]), 'a,"b,c","d""e"," sp","x\ny"\r\n1,TRUE,,FALSE\r\n');
  eq('serialize guard', serializeCSV([['=1+2', '-5', '@x', '+7']], { guard: true }), "'=1+2,-5,'@x,+7\r\n");
  eq('serialize ;', serializeCSV([['a;b', '1,5']], { delimiter: ';', newline: '\n' }), '"a;b";1,5\n');

  // fuzz: random tables survive serialize -> parse with every delimiter, and chunked parsing agrees
  let seed = 42;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const alphabet = ['a', 'b', ' ', ',', ';', '\t', '|', '"', '\n', '\r\n', 'é', '日', "'", 'x'];
  for (let k = 0; k < 60; k++) {
    const rows = Array.from({ length: 1 + rnd(8) }, () => Array.from({ length: 1 + rnd(5) }, () => Array.from({ length: rnd(7) }, () => alphabet[rnd(alphabet.length)]).join('')));
    // a lone empty field serializes to an empty line; give such rows two fields
    for (const r of rows) if (r.length === 1 && r[0] === '') r.push('z');
    for (const d of [',', ';', '\t', '|']) {
      const text = serializeCSV(rows, { delimiter: d });
      const back = parseCSV(text, { delimiter: d });
      if (JSON.stringify(back) !== JSON.stringify(rows)) { eq(`fuzz ${k} ${JSON.stringify(d)}`, back, rows); break; }
      const p = new CSVParser({ delimiter: d });
      const got = [];
      for (let i = 0; i < text.length;) { const n = 1 + rnd(9); got.push(...p.push(text.slice(i, i + n))); i += n; }
      got.push(...p.end());
      if (JSON.stringify(got) !== JSON.stringify(rows)) { eq(`chunked ${k} ${JSON.stringify(d)}`, got, rows); break; }
    }
    pass++;
  }
  const many = Array.from({ length: 50000 }, (_, i) => [String(i), 'name "' + i + '"', 'line\n' + (i % 3)]);
  const manyText = serializeCSV(many);
  let progress = 0;
  const asyncRows = await parseCSVAsync(manyText, { sliceRows: 7000, onProgress: (p) => { progress = p; } });
  eq('async slices', asyncRows.length === many.length && JSON.stringify(asyncRows[49999]) === JSON.stringify(many[49999]) && progress === 1, true);

  // --- sniffing & header ------------------------------------------------------------------------
  eq('sniff ,', sniffCSV('a,b,c\n1,2,3\n4,5,6\n').delimiter, ',');
  eq('sniff ; with decimal commas', sniffCSV('name;price\nx;1,5\ny;2,25\nz;3\n').delimiter, ';');
  eq('sniff tab', sniffCSV('a\tb\n1\t2\n').delimiter, '\t');
  eq('sniff |', sniffCSV('a|b|c\n1|2|3\n').delimiter, '|');
  eq('sniff quoted commas', sniffCSV('"a,b";c\n"d,e";f\n"g,h";i\n').delimiter, ';');
  eq('sniff newline', [sniffCSV('a\r\nb\r\n').newline, sniffCSV('a\nb\n').newline], ['\r\n', '\n']);
  eq('sniff single quotes', sniffCSV("'a,b',c\n'd,e',f\n").quote, "'");
  eq('header yes', [hasHeader([['Name', 'Age'], ['Bob', '3'], ['Al', '41']]), sniffCSV('id,date\n1,2024-01-02\n2,2024-02-03\n').header], [true, true]);
  eq('header no', [hasHeader([['1', '2'], ['3', '4']]), hasHeader([['x', 'y'], ['a', 'b'], ['c', 'd']]), hasHeader([['1', 'x'], ['2', 'y'], ['3', 'z']])], [false, false, false]);

  // --- encodings ----------------------------------------------------------------------------------
  const cp1251 = Uint8Array.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x2c, 0x20, 0xec, 0xe8, 0xf0, 0x3b, 0x31]);
  eq('windows-1251', decodeBytes(cp1251), { text: 'Привет, мир;1', encoding: 'windows-1251' });
  const cp1252 = Uint8Array.from([0x63, 0x61, 0x66, 0xe9, 0x2c, 0x20, 0x6e, 0x61, 0xef, 0x76, 0x65, 0x2c, 0x20, 0x47, 0x72, 0xfc, 0xdf, 0x65]);
  eq('windows-1252', decodeBytes(cp1252), { text: 'café, naïve, Grüße', encoding: 'windows-1252' });
  for (const enc of ['utf-16le', 'utf-16be']) {
    eq(enc + ' bom', decodeBytes(encodeText('a;é;日', { encoding: enc, bom: true })), { text: 'a;é;日', encoding: enc });
    eq(enc + ' no bom', decodeBytes(encodeText('name,value\nfoo,1\n', { encoding: enc })), { text: 'name,value\nfoo,1\n', encoding: enc });
  }
  eq('utf-8 bom', [detectEncoding(encodeText('x', { bom: true })), decodeBytes(encodeText('ж', { bom: true })).text], [{ encoding: 'utf-8', bom: 3 }, 'ж']);
  eq('utf-8 plain', decodeBytes(new TextEncoder().encode('Ünïcödé ✓')).encoding, 'utf-8');

  // --- type inference -------------------------------------------------------------------------------
  const n = (s, d) => { const p = parseNumber(s, d); return p ? p.v : null; };
  eq('numbers .', [n('1,234.5'), n('-12'), n('.5'), n('1e3'), n('(42)'), n('12%'), n('$1,200.50'), n('1 234 567.8'), n('abc'), n('1.2.3')], [1234.5, -12, 0.5, 1000, -42, 0.12, 1200.5, 1234567.8, null, null]);
  eq('numbers ,', [n('1.234,5', ','), n('1,5', ','), n('12 345,67 €', ','), n("1'000", ',')], [1234.5, 1.5, 12345.67, 1000]);
  eq('long ids stay text', n('1234567890123456789'), null);
  const d = (s, o) => { const p = parseDate(s, o); return p ? [p.y, p.m, p.d, p.hh, p.mm, p.ss] : null; };
  eq('dates', [d('2024-03-05'), d('2024-03-05T14:30:15Z'), d('05.03.2024'), d('03/05/2024', 'mdy'), d('03/05/2024', 'dmy'), d('5 Mar 2024'), d('March 5, 2024 2:30 PM'), d('2024-02-30'), d('12:30')],
    [[2024, 3, 5, 0, 0, 0], [2024, 3, 5, 14, 30, 15], [2024, 3, 5, 0, 0, 0], [2024, 3, 5, 0, 0, 0], [2024, 5, 3, 0, 0, 0], [2024, 3, 5, 0, 0, 0], [2024, 3, 5, 14, 30, 0], null, [0, 0, 0, 12, 30, 0]]);
  eq('detect number ,', detectColumn(['1,5', '2,25', '3']), { type: 'number', decimal: ',', fmt: 'General' });
  eq('detect ambiguous uses hint', detectColumn(['1,234', '5,678'], { decimal: ',' }).decimal, ',');
  eq('detect grouped', detectColumn(['1,234.5', '12']).fmt, '#,##0.0');
  eq('detect percent', detectColumn(['12%', '5.5%']).fmt, '0.0%');
  eq('detect currency', detectColumn(['€1,200.00', '€5']).fmt, '"€"#,##0.00');
  eq('detect dates dmy', detectColumn(['13/01/2024', '02/03/2024']), { type: 'date', order: 'dmy', fmt: 'dd/mm/yyyy' });
  eq('detect leading zeros', detectColumn(['007', '012']).type, 'text');
  eq('detect bool', detectColumn(['true', 'FALSE', 'ИСТИНА']).type, 'bool');
  eq('detect mostly numbers', detectColumn([...Array.from({ length: 40 }, (_, i) => String(i)), 'n/a']).type, 'number');
  eq('detect mixed', detectColumn(['1', 'a', '2', 'b']).type, 'text');
  eq('convert', convertColumn(['13/01/2024', '', 'x'], { type: 'date', order: 'dmy' }), [45304, null, 'x']);
  eq('inferValue', [inferValue('12.5%'), inferValue('2024-03-01 12:00'), inferValue('1,234.5'), inferValue('TRUE'), inferValue('hello')],
    [{ v: 0.125, fmt: '0.0%' }, { v: 45352.5, fmt: 'yyyy-mm-dd hh:mm' }, { v: 1234.5, fmt: '#,##0.0' }, { v: true }, { v: 'hello' }]);

  // --- column mapping and loose coercions ---------------------------------------------------
  eq('normHeader', normHeader('  Кол-во, шт. (Ёмкость) '), 'кол во шт емкость');
  const ru = suggestMapping(['Наименование', 'Артикул', 'Кол-во', 'Цена, ₾', 'Дата продажи', 'თარიღი', 'Комментарий', 'xyz'], ['name', 'code', 'quantity', 'price', 'date', 'note']);
  eq('mapping ru / ka', ru.columns, { 'Наименование': 'name', 'Артикул': 'code', 'Кол-во': 'quantity', 'Цена, ₾': 'price', 'Дата продажи': '', 'თარიღი': 'date', 'Комментарий': 'note', xyz: '' });
  eq('mapping scores', ru.scores.map((s) => s.how), ['exact', 'exact', 'exact', 'exact', 'exact', 'exact']);
  const en = suggestMapping(['Product Name', 'Qty', 'Unit price', 'Barcode (EAN)', 'Wrehouse', 'Размер'], ['name', 'quantity', 'price', 'barcode', { key: 'place' }, { key: 'size', label: 'Размер' }]);
  eq('mapping en, fuzzy, labels', en.columns, { 'Product Name': 'name', Qty: 'quantity', 'Unit price': 'price', 'Barcode (EAN)': 'barcode', Wrehouse: 'place', 'Размер': 'size' });
  eq('mapping how', en.scores.find((s) => s.header === 'Wrehouse').how, 'fuzzy');
  eq('mapping no fuzzy', suggestMapping(['Wrehouse'], ['place'], undefined, { fuzzy: false }).columns, { Wrehouse: '' });
  eq('mapping one-to-one', suggestMapping(['Цена', 'Цена закупки'], ['price']).columns, { 'Цена': 'price', 'Цена закупки': '' });
  eq('mapping multi', suggestMapping(['Метка 1', 'Метка 2'], [{ key: 'tag', synonyms: ['метка'], multi: true }]).columns, { 'Метка 1': 'tag', 'Метка 2': 'tag' });
  eq('mapping own dictionary', suggestMapping(['ИНН'], ['taxId'], { taxId: ['инн', 'tin', 'სსკ'] }).columns, { 'ИНН': 'taxId' });
  eq('flags', ['კი', 'არა', 'Да', 'нет', 'так', 'ні', 'Yes', '0', '✓', 'maybe', ''].map(parseFlag), [true, false, true, false, true, false, true, false, true, null, null]);
  eq('loose numbers', ['1 234,56', '1.234,56', '1,234.56', '42,5', '1,234,567', '-3', '12%', 'abc', ''].map(parseLooseNumber), [1234.56, 1234.56, 1234.56, 42.5, 1234567, -3, 0.12, null, null]);
  eq('loose dates', ['2024-03-05', '05.03.2024', '05/03/2024', '45356', '12', 'x'].map((s) => parseLooseDate(s)), [45356, 45356, 45356, 45356, null, null]);
  eq('loose dates mdy, no serials', [parseLooseDate('03/05/2024', { order: 'mdy' }), parseLooseDate('45356', { serials: false })], [45356, null]);
  eq('coerceField', [coerceField({ type: 'number' }, '1 234,5'), coerceField({ type: 'bool' }, 'კი'), coerceField({ type: 'multiselect' }, 'a; b,c'),
    coerceField({ type: 'select', options: ['Red'] }, 'red'), coerceField({ type: 'date' }, '31.12.2024'), coerceField({}, ' text ')],
  [1234.5, true, ['a', 'b', 'c'], 'Red', 45657, 'text']);

  console.log(`csv: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
