// formula/test.js - unit tests of the formula library: `node formula/test.js` (importing the module runs nothing).
// Parser round trips and reference transforms, localized (ru) formula text, operators and coercion, ~150 functions,
// dependency tracking, incremental recalculation, cycles, spills and a 100 000-formula workload.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from './engine.js';
import { parseFormula, printFormula, renameSheetInFormula, shiftFormula, translateFormula } from './parser.js';
import { FUNCTION_NAMES, canonicalFunctionName, delocalizeFormula, localFunctionName, localizeFormula, parseLocalizedFormula } from './locale.js';
import { FUNCTIONS } from './evaluate.js';
import { ERR, cellValue, ymdToSerial } from '../xlsx/cells.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// Numbers compare with a relative tolerance of 1e-9 (floating results of statistics), everything else by JSON.
// The large workload test guards the engine's complexity (graph edges, range nodes), not just correctness.
export async function run() {
  let pass = 0, fail = 0;
  const same = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)) : JSON.stringify(a) === JSON.stringify(b));
  const eq = (name, got, want) => {
    const g = got && got.code ? got.code : got;
    if (same(g, want)) pass++;
    else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(g)}, want ${JSON.stringify(want)}`); }
  };
  const f = (x) => ({ v: null, f: x });

  // --- parser ---------------------------------------------------------------------------
  for (const [src, out] of [
    ['=sum(a1:b2, $C$3)', 'SUM(A1:B2,$C$3)'],
    ["'My Sheet'!A1+Data!$B$2", "'My Sheet'!A1+Data!$B$2"],
    ['-2^2', '-2^2'], ['(1+2)*3', '(1+2)*3'], ['A:A', 'A:A'], ['$2:$5', '$2:$5'], ['{1,2;3,4}', '{1,2;3,4}'],
    ['IF(A1,,"x")', 'IF(A1,,"x")'], ['_xlfn._xlws.SORT(A1:A9)', 'SORT(A1:A9)'], ['"a""b"&C1', '"a""b"&C1'], ['10%', '10%'],
    ['A1<>B1', 'A1<>B1'], ['#N/A', '#N/A'], ['LOG10(100)', 'LOG10(100)'], ['Sheet1!A1:B2', 'Sheet1!A1:B2'], ['1.5E+3', '1500'],
  ]) eq('print ' + src, printFormula(parseFormula(src)), out);
  for (const bad of ['SUM(', '1+', '"abc', '#FOO!', 'A1 B1 +', ')']) {
    let threw = false;
    try { parseFormula(bad); } catch { threw = true; }
    eq('syntax error ' + bad, threw, true);
  }
  eq('translate', translateFormula('A1+$B$2+C$3+$D4+SUM(E5:F6)', 2, 1), 'B3+$B$2+D$3+$D6+SUM(F7:G8)');
  eq('translate out', translateFormula('A1', -1, 0), '#REF!');
  eq('shift rows del', shiftFormula('SUM(A1:A10)+B5+C12', { sheet: 'S', formulaSheet: 'S', axis: 'row', at: 2, count: -3 }), 'SUM(A1:A7)+#REF!+C9');
  eq('shift cols ins', shiftFormula('A1+C1+Other!C1', { sheet: 'S', formulaSheet: 'S', axis: 'col', at: 1, count: 2 }), 'A1+E1+Other!C1');
  eq('shift other sheet', shiftFormula('S!B2+B2', { sheet: 'S', formulaSheet: 'T', axis: 'row', at: 0, count: 1 }), 'S!B3+B2');
  eq('rename sheet', renameSheetInFormula("Data!A1+'data'!B2", 'Data', 'My data'), "'My data'!A1+'My data'!B2");

  // --- evaluation -------------------------------------------------------------------------
  const book = { sheets: [
    { name: 'Data', rows: [
      ['Name', 'Qty', 'Price', 'Date', 'Flag'],
      ['apple', 3, 1.5, ymdToSerial(2024, 1, 15), true],
      ['pear', 5, 2, ymdToSerial(2024, 2, 29), false],
      ['plum', 2, 4.25, ymdToSerial(2023, 12, 31), true],
      ['Apple pie', 7, null, ymdToSerial(2024, 3, 1), 'x'],
      [null, 'text', 10, ERR.NA, null],
    ] },
    { name: 'Other sheet', rows: [[100, 200], [300, 'abc']] },
  ], names: [{ name: 'Rate', ref: 'Data!$C$3' }] };
  const eng = new Engine(book, { now: () => new Date(2024, 5, 15, 12, 30, 0), random: () => 0.5 });
  eng.rebuild();
  const ev = (x) => {
    const v = eng.evaluate(x, 0, 10, 10);
    return Array.isArray(v) ? v.map((r) => r.map((y) => (y && y.code) || y)) : v;
  };
  const cases = [
    // arithmetic, precedence, coercion
    ['1+2*3', 7], ['(1+2)*3', 9], ['-2^2', 4], ['2^3^2', 64], ['2^-1', 0.5], ['10%', 0.1], ['5/0', '#DIV/0!'], ['0^0', '#NUM!'],
    ['"3"+4', 7], ['"a"+1', '#VALUE!'], ['TRUE+1', 2], ['"a"&1&TRUE', 'a1TRUE'], ['1/3&""', '0.333333333333333'],
    ['0.1+0.2=0.3', true], ['"abc"="ABC"', true], ['"a"<"b"', true], ['1<"a"', true], ['"z"<TRUE', true], ['B2>2', true],
    ['B1:B3*2', [['#VALUE!'], [6], [10]]], ['{1,2}+{10;20}', [[11, 12], [21, 22]]], ['-{1,2}', [[-1, -2]]], ['Rate*2', 4],
    ['Data!B2+\'Other sheet\'!A1', 103], ['NoSheet!A1', '#REF!'], ['UNKNOWNFN(1)', '#NAME?'], ['D6', '#N/A'], ['A6', null], ['E6', null],
    // math & aggregates
    ['SUM(B2:B6)', 17], ['SUM(B2:B6,"5",TRUE)', 23], ['SUM(B:B)', 17], ['PRODUCT(B2:B4)', 30], ['AVERAGE(B2:B5)', 4.25],
    ['AVERAGEA(B1:B6)', 17 / 6], ['MIN(C2:C6)', 1.5], ['MAX(C2:C6)', 10], ['COUNT(B1:C6)', 8], ['COUNTA(A1:A6)', 5],
    ['COUNTBLANK(A1:C6)', 2], ['SUMPRODUCT(B2:B4,C2:C4)', 4.5 + 10 + 8.5], ['SUMSQ(1,2,3)', 14], ['ROUND(2.675,2)', 2.68],
    ['ROUND(-2.5,0)', -3], ['ROUND(1234.5,-2)', 1200], ['ROUNDUP(0.1+0.2,1)', 0.3], ['ROUNDDOWN(-1.99,1)', -1.9], ['MROUND(10,3)', 9],
    ['CEILING(4.1,2)', 6], ['FLOOR(4.9,2)', 4], ['CEILING.MATH(-4.5,2)', -4], ['TRUNC(-4.7)', -4], ['INT(-4.2)', -5], ['ABS(-3)', 3],
    ['SIGN(-0.5)', -1], ['MOD(-7,3)', 2], ['MOD(7,-3)', -2], ['QUOTIENT(7,2)', 3], ['POWER(2,10)', 1024], ['SQRT(16)', 4], ['SQRT(-1)', '#NUM!'],
    ['EXP(0)', 1], ['LN(EXP(2))', 2], ['LOG(8,2)', 3], ['LOG10(1000)', 3], ['PI()', Math.PI], ['FACT(5)', 120], ['GCD(12,18)', 6], ['LCM(4,6)', 12],
    ['EVEN(3)', 4], ['ODD(2)', 3], ['DEGREES(PI())', 180], ['ATAN2(1,1)', Math.PI / 4], ['RAND()', 0.5],
    // statistics
    ['MEDIAN(1,2,3,4)', 2.5], ['MODE(1,2,2,3,3)', 2], ['STDEV(2,4,4,4,5,5,7,9)', 2.138089935299395], ['STDEVP(2,4,4,4,5,5,7,9)', 2],
    ['VAR(1,2,3,4)', 1.6666666666666667], ['VARP(1,2,3,4)', 1.25], ['LARGE(B2:B5,2)', 5], ['SMALL(B2:B5,1)', 2], ['RANK(5,B2:B5)', 2],
    ['RANK(5,B2:B5,1)', 3], ['PERCENTILE({1,2,3,4,5},0.25)', 2], ['QUARTILE({1,2,3,4,5},3)', 4], ['CORREL({1,2,3},{2,4,6})', 1],
    ['GEOMEAN(1,4)', 2], ['AVEDEV(1,2,3)', 2 / 3],
    // conditional aggregates
    ['COUNTIF(B2:B5,">2")', 3], ['COUNTIF(A2:A5,"a*")', 2], ['COUNTIF(A2:A6,"")', 1], ['COUNTIF(A2:A6,"<>")', 4],
    ['SUMIF(B2:B5,">2",C2:C5)', 3.5], ['SUMIF(A2:A5,"p*",B2:B5)', 7], ['SUMIFS(B2:B5,E2:E5,TRUE,C2:C5,">2")', 2],
    ['COUNTIFS(B2:B5,">=3",E2:E5,TRUE)', 1], ['AVERAGEIF(B2:B5,">2")', 5], ['AVERAGEIFS(C2:C5,B2:B5,"<6")', 2.5833333333333335],
    ['MAXIFS(C2:C5,E2:E5,TRUE)', 4.25], ['MINIFS(C2:C5,E2:E5,TRUE)', 1.5], ['COUNTIF(D2:D5,">=2024-02-01")', 2],
    // logic
    ['IF(B2>2,"big","small")', 'big'], ['IF(FALSE,1)', false], ['IF(B2:B3>4,"y","n")', [['n'], ['y']]], ['IFS(B2>5,1,B2>2,2)', 2],
    ['IFS(FALSE,1)', '#N/A'], ['IFERROR(1/0,"err")', 'err'], ['IFNA(D6,"na")', 'na'], ['IFNA(1/0,"na")', '#DIV/0!'],
    ['AND(TRUE,B2>1)', true], ['OR(FALSE,B2>5)', false], ['XOR(TRUE,TRUE,TRUE)', true], ['NOT(TRUE)', false],
    ['SWITCH(2,1,"a",2,"b","c")', 'b'], ['SWITCH(9,1,"a","c")', 'c'], ['CHOOSE(2,"a","b","c")', 'b'], ['AND(A2:A3)', '#VALUE!'],
    // information
    ['ISBLANK(A6)', true], ['ISNUMBER(B3)', true], ['ISTEXT(A2)', true], ['ISLOGICAL(E2)', true], ['ISERROR(D6)', true], ['ISERR(D6)', false],
    ['ISNA(D6)', true], ['ISEVEN(4)', true], ['ISODD(4)', false], ['ISREF(A1)', true], ['ROW(C5)', 5], ['COLUMN(C5)', 3], ['ROWS(A1:B9)', 9],
    ['COLUMNS(A1:B9)', 2], ['N(TRUE)', 1], ['T(5)', ''], ['TYPE("a")', 2], ['ERROR.TYPE(1/0)', 2], ['ISNUMBER(B1:B3)', [[false], [true], [true]]],
    // text
    ['LEN("héllo")', 5], ['LEFT("abc",2)', 'ab'], ['RIGHT("abc")', 'c'], ['MID("abcdef",2,3)', 'bcd'], ['UPPER("ab")', 'AB'], ['LOWER("AB")', 'ab'],
    ['PROPER("hello wORLD-x")', 'Hello World-X'], ['TRIM("  a   b ")', 'a b'], ['CLEAN("a"&CHAR(9)&"b")', 'ab'], ['CONCAT(A2:A3,"!")', 'applepear!'],
    ['CONCATENATE("a",1,TRUE)', 'a1TRUE'], ['TEXTJOIN("-",TRUE,A2:A6)', 'apple-pear-plum-Apple pie'], ['SUBSTITUTE("aaa","a","b",2)', 'aba'],
    ['SUBSTITUTE("aaa","a","b")', 'bbb'], ['REPLACE("abcdef",2,3,"X")', 'aXef'], ['FIND("c","abcabc",4)', 6], ['FIND("C","abc")', '#VALUE!'],
    ['SEARCH("C","abc")', 3], ['SEARCH("b?d","abcd")', 2], ['VALUE("1,234.5")', 1234.5], ['VALUE("12%")', 0.12], ['VALUE("x")', '#VALUE!'],
    ['TEXT(1234.567,"#,##0.00")', '1,234.57'], ['TEXT(D2,"yyyy-mm-dd")', '2024-01-15'], ['TEXT(0.25,"0%")', '25%'], ['TEXT("5","0.0")', '5.0'],
    ['REPT("ab",3)', 'ababab'], ['EXACT("a","A")', false], ['CHAR(65)', 'A'], ['CODE("A")', 65], ['UNICHAR(9731)', '☃'], ['UNICODE("☃")', 9731],
    ['FIXED(1234.567,1)', '1,234.6'], ['NUMBERVALUE("1.234,5",",",".")', 1234.5], ['TEXTBEFORE("a-b-c","-",2)', 'a-b'], ['TEXTAFTER("a-b-c","-")', 'b-c'],
    ['TEXTSPLIT("a,b;c,d",",",";")', [['a', 'b'], ['c', 'd']]],
    // dates
    ['DATE(2024,2,29)', ymdToSerial(2024, 2, 29)], ['DATE(2024,13,1)', ymdToSerial(2025, 1, 1)], ['DATE(1900,2,29)', 60], ['YEAR(D3)', 2024],
    ['MONTH(D3)', 2], ['DAY(D3)', 29], ['TIME(12,30,0)', 0.5208333333333334], ['HOUR(0.75)', 18], ['MINUTE(TIME(1,2,3))', 2], ['SECOND(TIME(1,2,3))', 3],
    ['TODAY()', ymdToSerial(2024, 6, 15)], ['NOW()-TODAY()', 0.5208333333333334], ['WEEKDAY(DATE(2024,6,15))', 7], ['WEEKDAY(DATE(2024,6,15),2)', 6],
    ['WEEKNUM(DATE(2024,1,7))', 2], ['ISOWEEKNUM(DATE(2024,12,30))', 1], ['ISOWEEKNUM(DATE(2021,1,3))', 53], ['ISOWEEKNUM(DATE(2024,6,15))', 24], ['EDATE(DATE(2024,1,31),1)', ymdToSerial(2024, 2, 29)],
    ['EOMONTH(DATE(2024,1,15),1)', ymdToSerial(2024, 2, 29)], ['DATEDIF(DATE(2020,1,15),DATE(2024,3,10),"m")', 49],
    ['DATEDIF(DATE(2020,1,15),DATE(2024,3,10),"y")', 4], ['DATEDIF(DATE(2020,1,15),DATE(2024,3,10),"md")', 24], ['DAYS(DATE(2024,3,1),DATE(2024,2,1))', 29],
    ['NETWORKDAYS(DATE(2024,6,3),DATE(2024,6,14))', 10], ['WORKDAY(DATE(2024,6,14),1)', ymdToSerial(2024, 6, 17)], ['DATEVALUE("2024-03-05")', ymdToSerial(2024, 3, 5)],
    ['TIMEVALUE("18:00")', 0.75], ['YEARFRAC(DATE(2024,1,1),DATE(2024,7,1))', 0.5], ['DAYS360(DATE(2024,1,31),DATE(2024,3,31))', 60],
    // lookup
    ['VLOOKUP("pear",A2:C5,3,FALSE)', 2], ['VLOOKUP("PEAR",A2:C5,2,0)', 5], ['VLOOKUP("zz",A2:C5,2,FALSE)', '#N/A'], ['VLOOKUP(4,{1,"a";3,"b";5,"c"},2)', 'b'],
    ['VLOOKUP("a*",A2:B5,2,FALSE)', 3], ['VLOOKUP("pear",A2:C5,9,FALSE)', '#REF!'], ['HLOOKUP("Price",A1:E3,3,FALSE)', 2],
    ['MATCH("plum",A1:A5,0)', 4], ['MATCH(4,{1,3,5})', 2], ['MATCH(4,{5,3,1},-1)', 1], ['XMATCH("pear",A1:A5)', 3],
    ['XLOOKUP("plum",A2:A5,C2:C5)', 4.25], ['XLOOKUP("zz",A2:A5,C2:C5,"none")', 'none'], ['XLOOKUP(6,B2:B5,A2:A5,,1)', 'Apple pie'],
    ['XLOOKUP(4,B2:B5,A2:A5,,-1)', 'apple'], ['XLOOKUP("p*",A2:A5,B2:B5,,2,-1)', 2], ['SUM(XLOOKUP("pear",A2:A5,B2:C5))', 7],
    ['INDEX(A1:C5,3,2)', 5], ['INDEX(A1:C5,0,2)', [['Qty'], [3], [5], [2], [7]]], ['SUM(INDEX(B2:C5,2,0))', 7], ['INDEX({1,2,3},2)', 2],
    ['LOOKUP(4,{1,3,5},{"a","b","c"})', 'b'], ['SUM(OFFSET(B2,1,0,2,1))', 7], ['INDIRECT("B"&3)', 5], ["INDIRECT(\"'Other sheet'!B1\")", 200],
    ['ADDRESS(2,3)', '$C$2'], ['ADDRESS(2,3,4,TRUE,"My s")', "'My s'!C2"], ['HYPERLINK("http://x","site")', 'site'],
    ['TRANSPOSE({1,2;3,4})', [[1, 3], [2, 4]]], ['UNIQUE({1;2;2;3;1})', [[1], [2], [3]]], ['UNIQUE({1;2;2;3},,TRUE)', [[1], [3]]],
    ['SORT({3;1;2})', [[1], [2], [3]]], ['SORT({3,"b";1,"a"},2,-1)', [[3, 'b'], [1, 'a']]], ['SORTBY({"a";"b";"c"},{3;1;2})', [['b'], ['c'], ['a']]],
    ['FILTER(A2:A5,B2:B5>2)', [['apple'], ['pear'], ['Apple pie']]], ['FILTER(A2:A5,B2:B5>99,"none")', 'none'], ['FILTER(A2:A5,B2:B5>99)', '#CALC!'],
    ['SEQUENCE(2,3,10,5)', [[10, 15, 20], [25, 30, 35]]], ['TAKE({1;2;3},-2)', [[2], [3]]], ['DROP({1;2;3},1)', [[2], [3]]],
    ['CHOOSECOLS({1,2,3},3,1)', [[3, 1]]], ['VSTACK({1,2},{3})', [[1, 2], [3, '#N/A']]], ['HSTACK({1;2},{3;4})', [[1, 3], [2, 4]]],
    ['SUM(FILTER(B2:B5,E2:E5=TRUE))', 5], ['COUNTA(UNIQUE(LOWER(LEFT(A2:A5,1))))', 2], ['SUMPRODUCT((B2:B5>2)*(C2:C5))', 3.5],
  ];
  for (const [x, want] of cases) eq(x, ev(x), want);

  // --- localized formulas (ru) -------------------------------------------------------------
  for (const [canon, local] of [
    ['=SUM(A1:A3,1.5)', '=СУММ(A1:A3;1,5)'], ['IF(A1>0.5, "a,b; c", FALSE)', 'ЕСЛИ(A1>0,5; "a,b; c"; ЛОЖЬ)'],
    ['{1.5,2;3,4}', '{1,5\\2;3\\4}'], ["COUNTIF('Лист 1'!A:A,\">1\")", "СЧЁТЕСЛИ('Лист 1'!A:A;\">1\")"],
    ['IFERROR(1/0,#N/A)+ISERROR(#VALUE!)', 'ЕСЛИОШИБКА(1/0;#Н/Д)+ЕОШИБКА(#ЗНАЧ!)'], ['VLOOKUP(B1,Data!A:C,3,TRUE)', 'ВПР(B1;Data!A:C;3;ИСТИНА)'],
    ['STDEV.S(A1:A9)*1E+3', 'СТАНДОТКЛОН.В(A1:A9)*1E+3'], ['MYNAME*2+UNKNOWNFN(1,2)', 'MYNAME*2+UNKNOWNFN(1;2)'],
  ]) {
    eq('localize ' + canon, localizeFormula(canon), local);
    eq('delocalize ' + local, delocalizeFormula(local), canon);
  }
  eq('localize _xlfn', localizeFormula('_xlfn.XLOOKUP(1,A1:A3,B1:B3)'), 'ПРОСМОТРX(1;A1:A3;B1:B3)');
  eq('delocalize lower case and Е for Ё', delocalizeFormula('=сумм(A1:A3; 1,5)+счетесли(B:B;"x")'), '=SUM(A1:A3, 1.5)+COUNTIF(B:B,"x")');
  eq('parse localized', printFormula(parseLocalizedFormula('ЕСЛИ(A1=ИСТИНА;#Н/Д;{1\\2;3\\4})')), 'IF(A1=TRUE,#N/A,{1,2;3,4})');
  eq('names', [localFunctionName('sumifs'), canonicalFunctionName('СЧЕТЗ'), canonicalFunctionName('FOO'), localFunctionName('SUM', 'xx')], ['СУММЕСЛИМН', 'COUNTA', 'FOO', 'SUM']);
  eq('unknown language unchanged', [localizeFormula('SUM(1.5,2)', 'xx'), delocalizeFormula('СУММ(1,5;2)', 'xx')], ['SUM(1.5,2)', 'СУММ(1,5;2)']);
  const localNames = Object.values(FUNCTION_NAMES.ru).map((x) => x.replace(/Ё/g, 'Е'));
  eq('ru names: every registered function, no duplicates', [[...FUNCTIONS.keys()].filter((k) => !FUNCTION_NAMES.ru[k]), localNames.length - new Set(localNames).size], [[], 0]);
  eq('evaluate localized', ev(delocalizeFormula('СУММ(1,5;2;ЕСЛИ(ИСТИНА;0,5;0))')), 4);

  // --- recalculation: dependencies, edits, cycles, spills ------------------------------------
  const b2 = { sheets: [{ name: 'S', rows: [[1, f('A1*2'), f('B1+A1')], [2, f('SUM(A:A)'), f('C1*10')], [3, null, null]] }] };
  const e2 = new Engine(b2);
  e2.rebuild();
  const v = (r, c) => { const x = cellValue(b2.sheets[0].rows[r][c]); return x && x.code ? x.code : x; };
  eq('chain', [v(0, 1), v(0, 2), v(1, 1), v(1, 2)], [2, 3, 6, 30]);
  b2.sheets[0].rows[0][0] = 10;
  e2.update([[0, 0, 0]]);
  eq('update chain', [v(0, 1), v(0, 2), v(1, 1), v(1, 2)], [20, 30, 15, 300]);
  b2.sheets[0].rows[2][0] = f('B2');
  e2.update([[0, 2, 0]]);
  eq('cycle via column', [v(2, 0), v(1, 1)], ['#CIRC!', '#CIRC!']);
  b2.sheets[0].rows[2][0] = 5;
  e2.update([[0, 2, 0]]);
  eq('cycle resolved', [v(1, 1), v(1, 2)], [17, 300]);
  b2.sheets[0].rows[2][1] = f('SEQUENCE(2,2)');
  e2.update([[0, 2, 1]]);
  eq('spill', [v(2, 1), v(2, 2), v(3, 1), v(3, 2)], [1, 2, 3, 4]);
  b2.sheets[0].rows[3][2] = 'block';
  e2.update([[0, 3, 2]]);
  eq('spill blocked', [v(2, 1), v(2, 2)], ['#SPILL!', null]);
  b2.sheets[0].rows[3][2] = null;
  e2.update([[0, 3, 2]]);
  eq('spill freed', [v(2, 1), v(3, 2)], [1, 4]);
  b2.sheets[0].rows[4] = [f('SUM(B3:C4)')];
  e2.update([[0, 4, 0]]);
  eq('reads spill', v(4, 0), 10);
  b2.sheets[0].rows[2][1] = f('SEQUENCE(3,1)');
  e2.update([[0, 2, 1]]);
  eq('spill shrinks', [v(2, 2), v(4, 1), v(4, 0)], [null, 3, 3]);
  eq('precedents', e2.precedents(0, 1, 1), [[0, 0, 0, 1048575, 0]]);
  eq('dependents', e2.dependents(0, 0, 0).length >= 2, true);

  // --- workload -------------------------------------------------------------------------------
  const rows = [];
  const N = 100000;
  for (let i = 0; i < N; i++) rows.push([i, 'k' + i, i === 0 ? 0 : f(`C${i}+A${i + 1}`), f(`VLOOKUP("k${(i * 7) % N}",$B$1:$C$${N},2,FALSE)`)]);
  const big = { sheets: [{ name: 'S', rows }] };
  const e3 = new Engine(big);
  const t0 = Date.now();
  e3.rebuild();
  const ms = Date.now() - t0;
  eq('workload values', [cellValue(rows[N - 1][2]), cellValue(rows[3][3])], [(N - 1) * N / 2, (21 * 22) / 2]);
  rows[1][0] = 1001;
  const t1 = Date.now();
  e3.update([[0, 1, 0]]);
  eq('workload update', cellValue(rows[N - 1][2]), (N - 1) * N / 2 + 1000);
  console.log(`workload: ${2 * N - 1} formulas rebuilt in ${ms} ms, incremental update in ${Date.now() - t1} ms`);

  console.log(`formula: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
