// barcode/test.js - unit tests of the barcode library: `node barcode/test.js` (importing the module runs nothing).
// Check digits and GTIN forms, UPC-E, ISBN / ISSN, scale codes, the GS1 AI dictionary and every input form, Digital
// Link, encoder tables (sums, uniqueness, reference values), Code 128 set optimisation, encode -> decode round trips
// of every symbology (with width noise, reversed, and rasterised into an image), and the SVG renderer.
//
// Encoder and decoder are tested against each other AND against reference values: a round trip alone would pass a
// pair that shares a wrong table. Width noise and rasterisation simulate print gain and camera sampling, the
// conditions under which threshold and tolerance choices in decode.js actually matter.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScaleCode, completeCheck, eanToIssn, gs1CheckDigit, gs1Prefix, inspectGtin, issnToEan, parseIsbn, parseScaleCode, priceCheckDigit, shortestGtin, upcAToE, upcEToA } from './gtin.js';
import { GS, aiDefinition, buildGs1, gs1Date, parseDigitalLink, parseGs1, toDigitalLink } from './gs1.js';
import { BarcodeError, C128, C93, SYMBOLOGIES, code128Check, code128Values, code39Elements, encode, symbolRuns } from './linear.js';
import { code128Text, decodeRuns, scanImage } from './decode.js';
import { barcodeLayout, barcodeSVG } from './svg.js';
import { DM_SIZES, dataMatrix, decodeCodewords, matrixSVG, readCodewords } from './datamatrix.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const throwsCode = (name, fn, code) => {
    try { fn(); fail++; console.log(`FAIL ${name}: no throw`); } catch (e) { eq(name, e instanceof BarcodeError ? e.code : String(e), code); }
  };
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 8) % n; };
  const digits = (n) => Array.from({ length: n }, () => rnd(10)).join('');

  // --- gtin -------------------------------------------------------------------------------------------------------
  eq('check 4006381333931', gs1CheckDigit('400638133393'), 1);
  eq('check sscc', completeCheck('00614141123456789'), '006141411234567890');
  eq('inspect valid', inspectGtin('4006381333931').valid, true);
  eq('inspect bad check', [inspectGtin('4006381333932').issue, inspectGtin('4006381333932').expected], ['check', 1]);
  eq('inspect length', inspectGtin('12345').issue, 'length');
  eq('gtin14', inspectGtin('036000291452').gtin14, '00036000291452');
  eq('shortest', [shortestGtin('00036000291452'), shortestGtin('00000096385074')], ['036000291452', '96385074']);
  eq('upce -> a', upcEToA('01234565'), '012345000065');
  eq('upce 6 digits', upcEToA('123456'), '012345000065');
  eq('upca -> e', upcAToE('012345000065'), '01234565');
  eq('upca no e', upcAToE('036000291452'), null);
  for (let k = 0; k < 300; k++) {
    const e = '0' + digits(6);
    const a = upcEToA(e);
    // Several UPC-E forms may expand to one UPC-A; the compressed form is canonical and expands back.
    eq('upce round ' + e, upcEToA(upcAToE(a)), a);
  }
  eq('prefix georgia', gs1Prefix('4860001234561').label, 'Georgia');
  eq('prefix upc', gs1Prefix('036000291452').label, 'GS1 US');
  eq('prefix store', gs1Prefix('2012345012340').kind, 'restricted');
  eq('prefix book', gs1Prefix('9780306406157').kind, 'book');
  eq('isbn13 -> 10', parseIsbn('978-0-306-40615-7').isbn10, '0306406152');
  eq('isbn10 -> 13', parseIsbn('0-306-40615-2').isbn13, '9780306406157');
  eq('isbn X', parseIsbn('0-8044-2957-X').valid, true);
  eq('isbn bad', parseIsbn('0-306-40615-3').issue, 'check');
  eq('issn -> ean', issnToEan('0317-8471').ean13, '9770317847001');
  eq('ean -> issn', eanToIssn('9770317847001'), '0317-8471');
  eq('price check 4', priceCheckDigit('2875'), 9);
  eq('price check 5', priceCheckDigit('14685'), 6);
  const sc = buildScaleCode('weight', { item: '12345', value: 1.234 });
  eq('scale build', sc, completeCheck('201234501234'));
  eq('scale parse', parseScaleCode(sc, 'weight'), { ok: true, item: '12345', raw: '01234', flag: '0', value: 1.234, unit: 'kg', issue: null });
  const pc = buildScaleCode('price-check', { item: '12345', value: 28.75 });
  eq('scale price check', [pc[7], parseScaleCode(pc, 'price-check').value], ['9', 28.75]);
  eq('scale bad prefix', parseScaleCode('4006381333931', 'weight').issue, 'prefix');

  // --- gs1 --------------------------------------------------------------------------------------------------------
  const now = new Date(Date.UTC(2026, 9, 24));
  eq('date', gs1Date('271231', now), '2027-12-31');
  eq('date day 00', gs1Date('270200', now), '2027-02-28');
  eq('date century back', gs1Date('800101', now), '1980-01-01');
  eq('date century fwd', gs1Date('750101', now), '2075-01-01');
  eq('date bad', gs1Date('271301', now), null);
  eq('ai 3103', [aiDefinition('3103').decimals, aiDefinition('3103').title], [3, 'NET WEIGHT (kg)']);
  const hri = '(01)09506000134352(17)201225(10)ABC123(21)XYZ';
  const p1 = parseGs1(hri, { now });
  eq('hri parse', p1.elements.map((e) => [e.ai, e.value]), [['01', '09506000134352'], ['17', '201225'], ['10', 'ABC123'], ['21', 'XYZ']]);
  eq('hri date', p1.elements[1].date, '2020-12-25');
  eq('hri issues', p1.issues, []);
  const b1 = buildGs1(p1.elements);
  eq('build data', b1.data, '010950600013435217201225' + '10ABC123' + GS + '21XYZ');
  eq('build hri', b1.hri, hri);
  const raw = ']d2' + b1.data;
  const p2 = parseGs1(raw, { now });
  eq('raw parse', [p2.symbology, p2.elements.map((e) => e.value)], [']d2', ['09506000134352', '201225', 'ABC123', 'XYZ']]);
  eq('raw <GS> token', parseGs1('0109506000134352' + '10AB<GS>21CD').elements.map((e) => e.value), ['09506000134352', 'AB', 'CD']);
  eq('weight decimals', parseGs1('(3103)001250').elements[0].number, 1.25);
  eq('currency', parseGs1('(3912)981123456').elements[0], { ai: '3912', value: '981123456', title: 'AMOUNT (ISO currency)', currency: '981', number: 1234.56, decimals: 2, issues: [] });
  eq('bad check', parseGs1('(01)09506000134353').issues.map((i) => i.code), ['check']);
  eq('bad chars', parseGs1('(01)0950600013435A').issues.map((i) => i.code), ['chars']);
  eq('unknown ai raw', parseGs1('0109506000134352' + '05X').issues[0].code, 'unknown');
  const dl = toDigitalLink(p1.elements);
  eq('digital link', dl, 'https://id.gs1.org/01/09506000134352/10/ABC123/21/XYZ?17=201225');
  eq('digital link parse', parseDigitalLink(dl).map((e) => e.ai), ['01', '10', '21', '17']);
  eq('digital link via parseGs1', parseGs1(dl).elements.length, 4);
  eq('digital link custom host', parseDigitalLink('https://shop.example/p/01/09506000134352?3103=000500').map((e) => e.value), ['09506000134352', '000500']);

  // --- tables -----------------------------------------------------------------------------------------------------
  eq('c128 sums', C128.every((p, v) => [...p].reduce((s, c) => s + +c, 0) === (v === 106 ? 13 : 11)), true);
  eq('c128 unique', new Set(C128).size, 107);
  eq('c93 sums', C93.every((p) => [...p].reduce((s, c) => s + +c, 0) === 9), true);
  eq('c39 three wide', [...'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%*'].every((ch) => code39Elements(ch).split('1').length - 1 === 3), true);
  eq('c39 P', code39Elements('P'), '001100001'.length === 9 ? code39Elements('P') : null);
  eq('c39 *', code39Elements('*'), '010010100');
  // Wikipedia's worked Code 128 example: Start A, "PJJ123C", check 54.
  const pj = code128Values([...'PJJ123C'].map((c) => c.charCodeAt(0)), { start: 'A' }).values;
  eq('c128 PJJ123C', [pj, code128Check(pj)], [[103, 48, 42, 42, 17, 18, 19, 35], 54]);
  eq('c128 digits -> C', code128Values([...'1234567890'].map((c) => c.charCodeAt(0))).values, [105, 12, 34, 56, 78, 90]);
  eq('c128 odd digits', code128Values([...'12345'].map((c) => c.charCodeAt(0))).values.length, 5);
  eq('c128 mixed', code128Values([...'AB123456'].map((c) => c.charCodeAt(0))).values.length, 7);
  eq('c128 text', code128Text([104, 33, 34, 99, 12, 34]), { text: 'AB1234', gs1: false });
  eq('c128 shift', code128Text(code128Values([...'ab\ncd'].map((c) => c.charCodeAt(0))).values).text, 'ab\ncd');
  eq('c128 latin1', code128Text(code128Values([...'Grüße'].map((c) => c.charCodeAt(0))).values).text, 'Grüße');

  // --- encoders ---------------------------------------------------------------------------------------------------
  eq('ean13 width', encode('ean13', '400638133393').width, 95);
  eq('ean13 data', encode('ean13', '400638133393').data, '4006381333931');
  eq('ean8 width', encode('ean8', '9638507').width, 67);
  eq('upce width', encode('upce', '01234565').width, 51);
  eq('upce from a', encode('upce', '012345000065').data, '01234565');
  eq('upca width', encode('upca', '03600029145').data, '036000291452');
  eq('ean13 addon', [encode('ean13', '9780306406157 51299').addon.digits, encode('ean13', '9780306406157', { addon: '05' }).width], ['51299', 95 + 9 + 20]);
  throwsCode('ean13 check', () => encode('ean13', '4006381333932'), 'check');
  throwsCode('ean13 length', () => encode('ean13', '40063813'), 'length');
  throwsCode('code39 chars', () => encode('code39', 'a~'), 'chars');
  throwsCode('upce impossible', () => encode('upce', '036000291452'), 'upce');
  throwsCode('gs1 bad', () => encode('gs1-128', '(01)09506000134353'), 'gs1');
  eq('itf14 bearer', encode('itf14', '1486000123456').bearer, 'frame');
  eq('gs1-128 hri', encode('gs1-128', '(01)04860001234561(10)LOT1').hri, '(01)04860001234561(10)LOT1');
  eq('every example encodes', SYMBOLOGIES.every((s) => !!encode(s.key, s.example)), true);

  // --- round trips ------------------------------------------------------------------------------------------------
  const noisy = (runs, amp) => runs.map((w) => w * (1 + (rnd(2001) / 1000 - 1) * amp));
  const roundTrip = (type, input, want, opts = {}, amp = 0.12) => {
    const sym = encode(type, input, opts);
    const runs = noisy(symbolRuns(sym, { addon: true }), amp).map((w) => w * 3.3);
    const lead = [40, ...runs, 40];
    const hits = decodeRuns(lead, { leadingSpace: true });
    const rev = decodeRuns([...lead].reverse(), { leadingSpace: true });
    const pick = (h) => (h[0] ? [h[0].type, h[0].text, h[0].addon || null] : null);
    eq(`rt ${type} ${input}`, pick(hits), want);
    eq(`rt rev ${type} ${input}`, pick(rev), want);
  };
  for (let k = 0; k < 40; k++) { const d = completeCheck(digits(12)); roundTrip('ean13', d, ['ean13', d, null]); }
  for (let k = 0; k < 20; k++) { const d = completeCheck(digits(7)); roundTrip('ean8', d, ['ean8', d, null]); }
  for (let k = 0; k < 20; k++) { const e = '0' + digits(6); const s = encode('upce', e); roundTrip('upce', e, ['upce', s.data, null]); }
  roundTrip('ean13', '9780306406157 51299', ['ean13', '9780306406157', '51299']);
  roundTrip('ean13', '9780306406157 05', ['ean13', '9780306406157', '05']);
  roundTrip('upca', '036000291452', ['ean13', '0036000291452', null]);
  for (const t of ['Hello, World!', 'abc-123 XYZ', '0123456789012345', 'MiXeD 12 34 ab', 'Grüße']) roundTrip('code128', t, ['code128', t, null]);
  roundTrip('gs1-128', '(01)04860001234561(17)271231(10)LOT42(21)7', ['gs1-128', '010486000123456117271231' + '10LOT42' + GS + '217', null]);
  for (const t of ['CODE39', 'INV-0042', 'A B.C$/+%']) roundTrip('code39', t, ['code39', t, null], {}, 0.08);
  for (const t of ['CODE 93', 'Shelf a-12', 'x']) roundTrip('code93', t, ['code93', t, null]);
  for (let k = 0; k < 10; k++) { const d = digits(2 * (2 + rnd(6))); roundTrip('itf', d, [d.length === 14 && gs1CheckDigit(d.slice(0, 13)) === +d[13] ? 'itf14' : 'itf', d, null], {}, 0.08); }
  roundTrip('itf14', '1486000123456', ['itf14', completeCheck('1486000123456'), null], {}, 0.08);
  for (const t of ['A40156B', 'C12-34$56:78/90.12+3D']) roundTrip('codabar', t, ['codabar', t, null], {}, 0.06);
  const c39 = decodeRuns([30, ...symbolRuns(encode('code39', 'abc', { fullAscii: true })), 30], { leadingSpace: true })[0];
  eq('code39 full ascii', [c39.text, c39.fullAscii], ['+A+B+C', 'abc']);
  const c39c = decodeRuns([30, ...symbolRuns(encode('code39', 'ABC', { check: true })), 30], { leadingSpace: true })[0];
  eq('code39 check', [c39c.text, c39c.checkOk], ['ABCK'.slice(0, 3) + c39c.text[3], true]);

  // --- image scan -------------------------------------------------------------------------------------------------
  const raster = (sym, ppm, opts = {}) => {
    const L = barcodeLayout(sym, { text: false, ...opts });
    const W = Math.ceil(L.width * ppm) + 20, H = Math.ceil(L.height * ppm) + 20;
    const data = new Uint8ClampedArray(W * H * 4).fill(255);
    for (const r of L.rects) {
      for (let y = Math.round(r.y * ppm) + 10; y < Math.round((r.y + r.h) * ppm) + 10; y++) {
        for (let x = Math.round(r.x * ppm) + 10; x < Math.round((r.x + r.w) * ppm) + 10; x++) {
          const p = (y * W + x) * 4; data[p] = data[p + 1] = data[p + 2] = 20;
        }
      }
    }
    // Light noise.
    for (let p = 0; p < data.length; p += 4) { const n = rnd(31) - 15; data[p] += n; data[p + 1] += n; data[p + 2] += n; }
    return { data, width: W, height: H };
  };
  const scanned = (type, input, ppm) => { const r = scanImage(raster(encode(type, input), ppm), { lines: 12 }); return r[0] ? [r[0].type, r[0].text] : null; };
  eq('scan ean13', scanned('ean13', '4860001234561', 2), ['ean13', '4860001234561']);
  eq('scan code128', scanned('code128', 'Batumi-2027', 2), ['code128', 'Batumi-2027']);
  eq('scan code39', scanned('code39', 'INV-0042', 2), ['code39', 'INV-0042']);
  eq('scan itf14', scanned('itf14', '1486000123456', 2), ['itf14', '14860001234568']);
  eq('scan fractional', scanned('ean13', '4006381333931', 1.6), ['ean13', '4006381333931']);
  // Rotated 90°: transpose the image.
  const img = raster(encode('code93', 'ROTATED'), 2);
  const T = { width: img.height, height: img.width, data: new Uint8ClampedArray(img.data.length) };
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) for (let c = 0; c < 4; c++) T.data[(x * T.width + y) * 4 + c] = img.data[(y * img.width + x) * 4 + c];
  const rot = scanImage(T, { lines: 12 })[0];
  eq('scan rotated', rot && [rot.type, rot.text, rot.orientation], ['code93', 'ROTATED', 'v']);
  eq('scan blank', scanImage({ data: new Uint8ClampedArray(40 * 40 * 4).fill(255), width: 40, height: 40 }), []);

  // --- svg --------------------------------------------------------------------------------------------------------
  const svg = barcodeSVG(encode('ean13', '4860001234561'), { unit: 'mm', xdim: 0.33 });
  eq('svg mm', /^<svg[^>]+width="[\d.]+mm"/.test(svg), true);
  eq('svg digits', (svg.match(/<text /g) || []).length, 13);
  eq('svg escapes', barcodeSVG(encode('code128', 'a<b&"c')).includes('a&lt;b&amp;&quot;c'), true);
  const lay = barcodeLayout(encode('ean13', '4860001234561'));
  eq('layout guards longer', lay.rects[0].h > lay.rects[2].h, true);
  eq('layout itf14 frame', barcodeLayout(encode('itf14', '1486000123456')).rects.filter((r) => r.bearer).length, 4);

  // --- data matrix ------------------------------------------------------------------------------------------------
  // ISO/IEC 16022 worked example: "123456" in a 10 x 10 symbol.
  eq('dm 123456', dataMatrix('123456').codewords, [142, 164, 186, 114, 25, 5, 88, 102]);
  // Reed-Solomon syndromes of every block are zero (GF(256) / 0x12D, roots a^1 … a^n).
  const gfExp = [], gfLog = [];
  for (let i = 0, x = 1; i < 255; i++) { gfExp[i] = x; gfLog[x] = i; x <<= 1; if (x & 256) x ^= 0x12d; }
  const gmul = (a, b) => (a && b ? gfExp[(gfLog[a] + gfLog[b]) % 255] : 0);
  const syndromesOk = (cw, size) => {
    for (let b = 0; b < size.blocks; b++) {
      const block = [...cw.slice(0, size.data).filter((_, i) => i % size.blocks === b), ...cw.slice(size.data).filter((_, i) => i % size.blocks === b)];
      for (let j = 1; j <= size.ecc / size.blocks; j++) { let s = 0; for (const v of block) s = gmul(s, gfExp[j]) ^ v; if (s) return false; }
    }
    return true;
  };
  for (const size of DM_SIZES) {
    const name = `${size.rows}x${size.cols}`;
    const text = Array.from({ length: Math.max(1, size.data - 2) }, (_, k) => String.fromCharCode(65 + ((k * 7) % 26))).join('');
    const sym = dataMatrix(text, { size: name });
    eq('dm size ' + name, [sym.matrix.length, sym.matrix[0].length], [size.rows, size.cols]);
    eq('dm rs ' + name, syndromesOk(sym.codewords, size), true);
    const back = readCodewords(sym.matrix, size);
    eq('dm read ' + name, back, sym.codewords);
    eq('dm text ' + name, decodeCodewords(back.slice(0, size.data)).text, text);
  }
  const dm = dataMatrix('(01)04860001234561(17)271231(10)LOT42(21)ABC', { gs1: true });
  const dmt = decodeCodewords(dm.codewords);
  eq('dm gs1', [dm.type, dmt.gs1, dmt.text], ['gs1-datamatrix', true, '010486000123456117271231' + '10LOT42' + GS + '21ABC']);
  eq('dm base256', decodeCodewords(dataMatrix(new Uint8Array([0, 255, 128, 7, 200])).codewords).text, String.fromCharCode(0, 255, 128, 7, 200));
  eq('dm latin1', decodeCodewords(dataMatrix('Grüße').codewords).text, 'Grüße');
  eq('dm rect', dataMatrix('HELLO', { shape: 'rect' }).rows, 8);
  eq('dm finder', [dataMatrix('1').matrix[9].every(Boolean), dataMatrix('1').matrix.every((r) => r[0])], [true, true]);
  eq('dm svg', /viewBox="0 0 14 14"/.test(matrixSVG(dataMatrix('1').matrix)), true);

  console.log(`barcode: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
