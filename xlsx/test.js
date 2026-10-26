// xlsx/test.js - unit tests of the spreadsheet file library: `node xlsx/test.js` (importing the module runs nothing).
// Number formats, date serials, formula text helpers, XLSX write -> read round trips, reading hand-made parts
// (shared formulas, inline strings, rich text, 1904 dates, styles, hyperlinks) and ODS reading.

//
// A dependency-free harness on purpose: eq() compares JSON forms (CellError serialised by code) and prints a diff
// line per failure, so the library can be tested in plain Node without a framework. Hand-made XML parts test the
// reader against producers other than our own writer (shared formulas, rich text), which a round trip cannot cover.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ERR, colIndex, colName, dateToSerial, parseRange, serialParts, ymdToSerial } from './cells.js';
import { formatValue, isDateFormat } from './numfmt.js';
import { fromFileFormula, fromODFFormula, shiftFormulaText, toFileFormula } from './ftext.js';
import { writeXLSX, sheetName } from './write.js';
import { readXLSX } from './read.js';
import { readODS } from './ods.js';
import { readZip, writeZip } from '../zip/zip.js';

// Run only when executed directly: another script can import run() without side effects.
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    const s = (x) => JSON.stringify(x, (k, v) => (v && v.code ? v.code : v));
    if (s(got) === s(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${s(got)}\n  want ${s(want)}`); }
  };

  // --- cells & dates ------------------------------------------------------------------------
  eq('col names', [colName(0), colName(25), colName(26), colName(16383), colIndex('XFD'), colIndex('aa'), colIndex('XFE')], ['A', 'Z', 'AA', 'XFD', 16383, 26, -1]);
  eq('range', parseRange('C3:A1'), { r1: 0, c1: 0, r2: 2, c2: 2 });
  eq('serials', [ymdToSerial(1900, 1, 1), ymdToSerial(1900, 2, 28), ymdToSerial(1900, 2, 29), ymdToSerial(1900, 3, 1), ymdToSerial(2024, 1, 1), dateToSerial(Date.UTC(2024, 0, 1, 12))], [1, 59, 60, 61, 45292, 45292.5]);
  eq('parts', [serialParts(60), serialParts(45292.75)].map((p) => [p.y, p.m, p.d, p.hh]), [[1900, 2, 29, 0], [2024, 1, 1, 18]]);

  // --- number formats -----------------------------------------------------------------------------
  const F = [[1234.567, '#,##0.00', '1,234.57'], [0.1234, '0.0%', '12.3%'], [-5, '#,##0;(#,##0)', '(5)'], [0, '0;-0;"zero"', 'zero'],
    [1234567, '#,##0,"K"', '1,235K'], [12345, '0.00E+00', '1.23E+04'], [0.000123, '0.00E+00', '1.23E-04'], [1.5, '# ?/?', '1 1/2'],
    [5551234567, '000-000-0000', '555-123-4567'], [45000.75, 'yyyy-mm-dd hh:mm:ss', '2023-03-15 18:00:00'], [45000.75, 'd mmm yyyy h:mm AM/PM', '15 Mar 2023 6:00 PM'],
    [1.5, '[h]:mm', '36:00'], [45000, 'dddd, mmmm d', 'Wednesday, March 15'], ['abc', '0;0;0;"<"@">"', '<abc>'], [150, '[>100]"big";"small"', 'big'],
    [123.456, '"$"#,##0.00', '$123.46'], [1234.5, '[$€-407]#,##0.00', '€1,234.50'], [0.5, 'h:mm AM/PM', '12:00 PM'], [3.14159, 'General', '3.14159'],
    [123456789012, 'General', '1.23457E+11'], [0.1 + 0.2, 'General', '0.3'], [true, 'General', 'TRUE'], [ERR.DIV0, '0.00', '#DIV/0!'], [-0.001, '0.00', '0.00'],
    [45000, 'yyyy\\-mm\\-dd', '2023-03-15'], [0.123456, 'mm:ss.00', '57:46.60']];
  for (const [v, f, want] of F) eq(`format ${f}`, formatValue(v, f), want);
  eq('date formats', [isDateFormat('yyyy-mm-dd'), isDateFormat('0.00'), isDateFormat('[h]:mm'), isDateFormat('"d"0')], [true, false, true, false]);

  // --- formula text ---------------------------------------------------------------------------------
  eq('xlfn out', toFileFormula('XLOOKUP(A1,SORT(B:B),C:C)&"XLOOKUP("'), '_xlfn.XLOOKUP(A1,_xlfn._xlws.SORT(B:B),C:C)&"XLOOKUP("');
  eq('xlfn in', fromFileFormula('=_xlfn.IFS(_xlfn._xlws.FILTER(A:A,B:B>1),1)'), 'IFS(FILTER(A:A,B:B>1),1)');
  eq('shared shift', shiftFormulaText('A1+$B$2+SUM(C1:C3)+LOG10(D4)+Sheet1!E5+\'AB 1\'!F6+1.5E3+"A1"', 2, 1), 'B3+$B$2+SUM(D3:D5)+LOG10(E6)+Sheet1!F7+\'AB 1\'!G8+1.5E3+"A1"');
  eq('odf columns', fromODFFormula("of:=SUMIF([$'Sales data'.B:.B];A2;[.E:.E])+SUM([.2:.3])"), "SUMIF('Sales data'!B:B,A2,E:E)+SUM(2:3)");
  eq('odf', fromODFFormula('of:=SUM([.A1:.B3];[Sheet2.C4];[$\'My Sheet\'.D5])&";"+COM.MICROSOFT.XLOOKUP(1;[.A1:.A2];[.B1:.B2])'), "SUM(A1:B3,Sheet2!C4,'My Sheet'!D5)&\";\"+XLOOKUP(1,A1:A2,B1:B2)");
  eq('sheet names', [sheetName('a[1]:b', new Set()), sheetName('x'.repeat(40)).length, (() => { const s = new Set(); return [sheetName('Data', s), sheetName('data', s)]; })()], ['a 1 b', 31, ['Data', 'data (2)']]);

  // --- write -> read ----------------------------------------------------------------------------------
  const owner = { v: 1, f: 'SEQUENCE(2,2)' };
  const book = { sheets: [
    { name: 'Data', rows: [
      [{ v: 'Name', s: { bold: true, fill: '#ffeeaa' } }, { v: 'Qty', s: { italic: true, underline: true } }, 'Date', 'Note'],
      ['apple', 3, { v: 45000, s: { fmt: 'yyyy-mm-dd' } }, 'line1\nline2'],
      ['pear', 2.5, { v: 45001.5, s: { fmt: 'yyyy-mm-dd hh:mm' } }, ' padded '],
      ['x', true, ERR.NA, { v: 'link', link: 'https://example.org/a?b=1&c=2' }],
      [{ v: 5.5, f: 'SUM(B2:B3)' }, { v: 'ab', f: 'A2&"b"' }, { v: 1, f: 'XLOOKUP(1,B2:B3,B2:B3)' }, 'ctl\u0001_x0041_<&>'],
      [new Date(2024, 0, 15), { v: 0.25, s: { fmt: '0.0%', align: 'center', wrap: true, color: '#ff0000', strike: true } }, { v: 'go', link: '#Other!A1' }, '日本語 ✓'],
      [1e-7, -1234567.891, Number.MAX_SAFE_INTEGER, Infinity],
    ], cols: [{ width: 20 }, { width: 8, fmt: '0.00' }, undefined, { width: 30, hidden: true }], merges: [{ r1: 7, c1: 0, r2: 7, c2: 2 }], freeze: { rows: 1, cols: 1 } },
    { name: 'Other', rows: [[owner, { v: 2, sp: owner }], [{ v: 3, sp: owner }, { v: 4, sp: owner }]], hidden: true },
    { name: "It's [3]", rows: [] },
  ], names: [{ name: 'Rate', ref: 'Data!$B$2' }] };
  const bytes = await writeXLSX(book);
  const parts = readZip(bytes).map((e) => e.name);
  eq('parts', parts.includes('[Content_Types].xml') && parts.includes('xl/workbook.xml') && parts.includes('xl/worksheets/sheet3.xml') && parts.includes('xl/worksheets/_rels/sheet1.xml.rels'), true);
  const back = await readXLSX(bytes);
  const [s1, s2, s3] = back.sheets;
  eq('names', [back.sheets.map((s) => s.name), back.names], [['Data', 'Other', "It's 3"], [{ name: 'Rate', ref: 'Data!$B$2' }]]);
  eq('values', s1.rows.slice(1, 4).map((r) => r.map((c) => (c && typeof c === 'object' && 'v' in c ? c.v : c))), [['apple', 3, 45000, 'line1\nline2'], ['pear', 2.5, 45001.5, ' padded '], ['x', true, ERR.NA, 'link']]);
  eq('styles', [s1.rows[0][0].s, s1.rows[0][1].s, s1.rows[5][1].s, s1.rows[1][1].s], [{ bold: true, fill: '#ffeeaa' }, { italic: true, underline: true }, { fmt: '0.0%', strike: true, color: '#ff0000', align: 'center', wrap: true }, { fmt: '0.00' }]);
  eq('formulas', s1.rows[4].map((c) => c.f || c), ['SUM(B2:B3)', 'A2&"b"', 'XLOOKUP(1,B2:B3,B2:B3)', 'ctl\u0001_x0041_<&>']);
  eq('cached', s1.rows[4].slice(0, 3).map((c) => c.v), [5.5, 'ab', 1]);
  eq('date object', [s1.rows[5][0].v, s1.rows[5][0].s.fmt], [ymdToSerial(2024, 1, 15), 'yyyy-mm-dd']);
  eq('links', [s1.rows[3][3].link, s1.rows[5][2].link], ['https://example.org/a?b=1&c=2', '#Other!A1']);
  eq('numbers', s1.rows[6].map((c) => (c && c.v !== undefined ? c.v : c)), [1e-7, -1234567.891, Number.MAX_SAFE_INTEGER, ERR.NUM]);
  eq('layout', [s1.freeze, s1.merges, s1.cols[0].width, s1.cols[3].hidden, s1.cols[2] === undefined], [{ rows: 1, cols: 1 }, [{ r1: 7, c1: 0, r2: 7, c2: 2 }], 20, true, true]);
  eq('hidden + spill', [s2.hidden, s2.rows[0][0].f, s2.rows[0][1], s2.rows[1]], [true, 'SEQUENCE(2,2)', null, [null, null]]);
  eq('empty sheet', s3.rows, []);
  const sheetXml = await readZip(bytes).find((e) => e.name === 'xl/worksheets/sheet2.xml').text();
  eq('array formula xml', /<f t="array" ref="A1:B2">_xlfn.SEQUENCE\(2,2\)<\/f>/.test(sheetXml), true);
  const wbXml = await readZip(bytes).find((e) => e.name === 'xl/workbook.xml').text();
  eq('workbook xml', /fullCalcOnLoad="1"/.test(wbXml) && /state="hidden"/.test(wbXml) && /<definedName name="Rate">Data!\$B\$2<\/definedName>/.test(wbXml), true);

  // --- hand-made parts: shared formulas, inline / rich strings, 1904, theme colours ---------------------
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const files = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
    { name: '_rels/.rels', data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0"?><workbook ${NS}><workbookPr date1904="1"/><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="sheets/one.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="strings.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/strings.xml', data: `<?xml version="1.0"?><sst ${NS}><si><r><rPr><b/></rPr><t>Rich </t></r><r><t xml:space="preserve">text</t></r><rPh><t>PHON</t></rPh></si><si><t>a&amp;b_x000D_c</t></si></sst>` },
    { name: 'xl/styles.xml', data: `<?xml version="1.0"?><styleSheet ${NS}><numFmts count="1"><numFmt numFmtId="170" formatCode="d/m/yyyy"/></numFmts><fonts count="2"><font><sz val="11"/></font><font><b/><color theme="4"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor indexed="13"/></patternFill></fill></fills><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0"/><xf numFmtId="170" fontId="0" fillId="0"/><xf numFmtId="14" fontId="1" fillId="2"/></cellXfs></styleSheet>` },
    { name: 'xl/sheets/one.xml', data: `<?xml version="1.0"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>
      <x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1" t="s"><x:v>1</x:v></x:c><x:c t="inlineStr"><x:is><x:t>inline</x:t></x:is></x:c></x:row>
      <x:row r="2"><x:c r="A2"><x:v>1</x:v></x:c><x:c r="B2"><x:f t="shared" ref="B2:B4" si="0">A2*2+$A$2</x:f><x:v>3</x:v></x:c><x:c r="C2" s="1"><x:v>0</x:v></x:c></x:row>
      <x:row r="3"><x:c r="A3"><x:v>2</x:v></x:c><x:c r="B3"><x:f t="shared" si="0"/><x:v>5</x:v></x:c><x:c r="C3" s="2" t="d"><x:v>2024-01-02T12:00:00</x:v></x:c></x:row>
      <x:row r="4"><x:c r="A4"><x:v>3</x:v></x:c><x:c r="B4"><x:f t="shared" si="0"/><x:v>7</x:v></x:c><x:c r="C4" t="b"><x:v>1</x:v></x:c><x:c r="D4" t="e"><x:v>#DIV/0!</x:v></x:c></x:row>
    </x:sheetData></x:worksheet>` },
  ];
  const hand = await readXLSX(await writeZip(files));
  const hr = hand.sheets[0].rows;
  eq('rich + phonetic + escapes', [hr[0][0], hr[0][1], hr[0][2]], ['Rich text', 'a&b\rc', 'inline']);
  eq('shared formulas', [hr[1][1].f, hr[2][1].f, hr[3][1].f], ['A2*2+$A$2', 'A3*2+$A$2', 'A4*2+$A$2']);
  eq('1904 dates', [hr[1][2].v, hr[1][2].s.fmt], [1462, 'd/m/yyyy']);
  eq('iso date cell + style', [hr[2][2].v, hr[2][2].s], [ymdToSerial(2024, 1, 2) + 0.5, { fmt: 'm/d/yyyy', bold: true, color: '#4472c4', fill: '#ffff00' }]);
  eq('bool + error', [hr[3][2], hr[3][3]], [true, ERR.DIV0]);

  // --- ODS --------------------------------------------------------------------------------------------
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:xlink="http://www.w3.org/1999/xlink">
<office:automatic-styles><style:style style:name="co1" style:family="table-column"><style:table-column-properties style:column-width="2.5cm"/></style:style></office:automatic-styles>
<office:body><office:spreadsheet><table:table table:name="Sheet A">
<table:table-column table:style-name="co1" table:number-columns-repeated="2"/><table:table-column table:number-columns-repeated="1022"/>
<table:table-row><table:table-cell office:value-type="string"><text:p>Hello<text:s text:c="2"/>world</text:p><text:p>2nd</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="12.5"/><table:table-cell table:number-columns-spanned="2" office:value-type="date" office:date-value="2024-03-05"/><table:covered-table-cell/></table:table-row>
<table:table-row table:number-rows-repeated="2"><table:table-cell table:formula="of:=SUM([.B1:.B1];1)" office:value-type="float" office:value="13.5"/><table:table-cell office:value-type="boolean" office:boolean-value="true"/><table:table-cell office:value-type="percentage" office:value="0.5"/><table:table-cell office:value-type="time" office:time-value="PT12H30M00S"/><table:table-cell><text:p><text:a xlink:href="https://x.org">site</text:a></text:p></table:table-cell></table:table-row>
<table:table-row table:number-rows-repeated="1048570"><table:table-cell table:number-columns-repeated="1024"/></table:table-row>
</table:table><table:table table:name="Empty"/></office:spreadsheet></office:body></office:document-content>`;
  const ods = await readODS(await writeZip([{ name: 'mimetype', data: 'application/vnd.oasis.opendocument.spreadsheet', store: true }, { name: 'content.xml', data: content }]));
  const or = ods.sheets[0].rows;
  eq('ods sheets', ods.sheets.map((s) => [s.name, s.rows.length]), [['Sheet A', 3], ['Empty', 0]]);
  eq('ods row 1', [or[0][0], or[0][1], or[0][2]], ['Hello  world\n2nd', 12.5, { v: ymdToSerial(2024, 3, 5), s: { fmt: 'yyyy-mm-dd' } }]);
  eq('ods row 2', or[1], [{ v: 13.5, f: 'SUM(B1:B1,1)' }, true, { v: 0.5, s: { fmt: '0.00%' } }, { v: 0.5208333333333334, s: { fmt: 'hh:mm:ss' } }, { v: 'site', link: 'https://x.org' }]);
  eq('ods repeat + merges + widths', [JSON.stringify(or[2]) === JSON.stringify(or[1]) && or[2] !== or[1], ods.sheets[0].merges, ods.sheets[0].cols.slice(0, 2)], [true, [{ r1: 0, c1: 2, r2: 0, c2: 3 }], [{ width: 12.78 }, { width: 12.78 }]]);

  console.log(`xlsx: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
