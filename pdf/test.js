// pdf/test.js - unit tests of the PDF library: `node pdf/test.js` (importing the module runs nothing).
// A synthetic TrueType font (simple and composite glyphs, a monospaced hmtx tail, format 4 + 12 cmaps, OS/2 licence
// bits) through parse -> subset -> embed -> inspect; SVG paths and arcs; colours; the file structure (xref offsets,
// /Size, object and stream counts, stream lengths, Flate data); text that copies back through ToUnicode; links,
// bookmarks, metadata, images (PNG with alpha -> soft mask, JPEG passthrough, RGBA); layout (wrapping, justify,
// ellipsis, fitting, tables over several pages with a repeated header); deterministic output. When Noto Sans and
// Noto Sans Georgian (or Arial / DejaVu) are installed, the same checks run on them too; otherwise those are skipped.
//
// The synthetic font makes the suite hermetic (no font files in the repo, identical results on every machine) and
// lets it hit corners real fonts may lack - a composite glyph, a short hmtx, a format 12 cmap. Every generated PDF is
// read back with inspect.js, i.e. checked structurally (offsets, lengths) and semantically (text copies back), not
// just "did not throw". Installed system fonts add a real-world pass when available.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, mm, pageSize, parseColor, pdfText } from './doc.js';
import { buildTTF, parseTTF, subsetTTF, tableChecksum, glyphClosure } from './ttf.js';
import { measureText, shapeText, lineMetrics, cleanText } from './font.js';
import { parsePath, pathOps, rectPath, arcPath, pathBounds } from './path.js';
import { Flow, clipText, fitText, textBox, wrapText } from './layout.js';
import { inspectPDF, parseCMap, tokenize } from './inspect.js';
import { imageKind, jpegInfo, prepareImage } from './image.js';
import { winAnsiCode, standardWidth } from './standard.js';
import { encodePNG } from '../png/encode.js';
import { encodeJPEG } from '../jpg/encode.js';
import { unzlibSync } from '../codec/zlib.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// A small font: .notdef box, A (triangle), B (square), space, Georgian ani (U+10D0, a diamond), Cyrillic Zhe
// (U+0416), a composite Ä (A + a dot glyph) and an astral smiley (U+1F600, format 12 only). Advances of the last
// glyphs come from the monospaced hmtx tail (hmetrics: 6 of 9).
function syntheticFont(extra = {}) {
  const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  return buildTTF({
    unitsPerEm: 2048, ascent: 1638, descent: -410, name: 'Synthetic Sans', hmetrics: 6, ...extra,
    glyphs: [
      { advance: 1024, contours: [box(100, 0, 900, 1400), box(200, 100, 800, 1300).reverse()] }, // 0 .notdef
      { advance: 1300, contours: [[[0, 0], [650, 1400], [1300, 0]]] },                              // 1 A
      { advance: 1200, contours: [box(100, 0, 1100, 1400)] },                                        // 2 B
      { advance: 512, contours: [] },                                                                // 3 space
      { advance: 1100, contours: [[[550, 0], [1100, 700, false], [550, 1400], [0, 700, false]]] },  // 4 ani (quadratic)
      { advance: 1400, contours: [box(0, 0, 1400, 200), box(600, 0, 800, 1400)] },                   // 5 Zhe
      { advance: 1400, contours: [box(0, 0, 300, 300)] },                                            // 6 dot (tail advance)
      { advance: 1400, components: [{ glyph: 1 }, { glyph: 6, dx: 500, dy: 1500 }] },                // 7 A-diaeresis
      { advance: 1400, contours: [box(100, 100, 1300, 1300)] },                                      // 8 smiley
    ],
    cmap: { 0x41: 1, 0x42: 2, 0x20: 3, 0x10d0: 4, 0x416: 5, 0xc4: 7, 0x1f600: 8 },
  });
}

const dec = (b) => { let s = ''; for (const x of b) s += String.fromCharCode(x); return s; };

function systemFont(names) {
  const dirs = [process.env.PDF_TEST_FONTS, 'C:/Windows/Fonts', '/usr/share/fonts/truetype/noto', '/usr/share/fonts/noto', '/usr/share/fonts/truetype/dejavu', '/usr/share/fonts/TTF', '/Library/Fonts', '/System/Library/Fonts/Supplemental'].filter(Boolean);
  for (const n of names) for (const d of dirs) { const p = path.join(d, n); try { if (fs.statSync(p).isFile()) return fs.readFileSync(p); } catch { /* absent */ } }
  return null;
}

export async function run() {
  let pass = 0, fail = 0, skipped = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const ok = (name, cond, info = '') => eq(name + (cond ? '' : ' ' + info), !!cond, true);
  const throws = (name, fn, re) => { try { fn(); fail++; console.log(`FAIL ${name}: no throw`); } catch (e) { ok(name, re.test(String(e.message)), e.message); } };
  const near = (name, got, want, tol = 1e-6) => ok(name, Math.abs(got - want) <= tol, `${got} vs ${want}`);
  const date = new Date(Date.UTC(2026, 9, 24, 12, 0, 0));

  // --- ttf ----------------------------------------------------------------------------------------------------------
  const bytes = syntheticFont();
  eq('sfnt checksum adjustment', tableChecksum(bytes), 0xb1b0afba);
  const f = parseTTF(bytes);
  eq('ttf metrics', [f.unitsPerEm, f.numGlyphs, f.numberOfHMetrics, f.ascent, f.descent], [2048, 9, 6, 800, -200]);
  eq('ttf cmap fmt4', [f.gidFor(0x41), f.gidFor(0x42), f.gidFor(0x10d0), f.gidFor(0x416), f.gidFor(0x43)], [1, 2, 4, 5, 0]);
  eq('ttf cmap fmt12', f.gidFor(0x1f600), 8);
  eq('ttf widths', [f.widthOf(1), f.widthOf(3)], [Math.round((1300 * 1000) / 2048), 250]);
  // glyphs 6..8 lie past numberOfHMetrics: they repeat the last stored advance (glyph 5), not bytes of the next table
  eq('ttf hmtx tail', [f.advance(6), f.advance(7), f.advance(8)], [1400, 1400, 1400]);
  eq('ttf names', [f.postscriptName, f.familyName], ['SyntheticSans', 'Synthetic Sans']);
  eq('ttf composite', f.components(7), [1, 6]);
  eq('ttf closure', [...glyphClosure(f, [7])].sort(), [0, 1, 6, 7]);
  eq('ttf os2', [f.capHeight, f.xHeight, f.embeddable, f.bold], [Math.round(700 * 1000 / 2048), Math.round(500 * 1000 / 2048), true, false]);
  throws('ttf otto', () => parseTTF(new Uint8Array([0x4f, 0x54, 0x54, 0x4f, 0, 0, 0, 0, 0, 0, 0, 0])), /CFF/);
  throws('ttf garbage', () => parseTTF(new Uint8Array(40)), /not a TrueType/);
  const keepCopy = Uint8Array.from(bytes);
  const sub = subsetTTF(parseTTF(typeof Buffer !== 'undefined' ? Buffer.from(bytes) : bytes), [1, 2]);
  eq('subset leaves the source intact', dec(bytes) === dec(keepCopy), true);
  const s2 = parseTTF(sub);
  eq('subset checksum', tableChecksum(sub), 0xb1b0afba);
  eq('subset glyph count', s2.numGlyphs, 3);
  eq('subset keeps ids and outlines', [!!s2.glyphRange(0), !!s2.glyphRange(1), !!s2.glyphRange(2)], [true, true, true]);
  const r1 = f.glyphRange(1), q1 = s2.glyphRange(1);
  eq('subset glyph bytes', dec(sub.subarray(q1[0], q1[1])).slice(0, r1[1] - r1[0]), dec(bytes.subarray(r1[0], r1[1])));
  eq('subset widths', [s2.widthOf(1), s2.widthOf(2)], [f.widthOf(1), f.widthOf(2)]);
  const s3 = parseTTF(subsetTTF(f, [7]));
  eq('subset composite closure', [!!s3.glyphRange(1), !!s3.glyphRange(6), !!s3.glyphRange(7), !!s3.glyphRange(2)], [true, true, true, false]);
  eq('subset tail advance', s3.advance(7), 1400);
  ok('subset smaller', sub.length < bytes.length, `${sub.length} >= ${bytes.length}`);

  // --- path ---------------------------------------------------------------------------------------------------------
  eq('path abs/rel', parsePath('M10 20 L30 40 l5 5 H0 v-10 z'), [['M', 10, 20], ['L', 30, 40], ['L', 35, 45], ['L', 0, 45], ['L', 0, 35], ['Z']]);
  eq('path implicit lineto', parsePath('m1 1 2 2 3 3'), [['M', 1, 1], ['L', 3, 3], ['L', 6, 6]]);
  eq('path packed numbers', parsePath('M.5.5L-1-1').map((c) => c.slice(1)), [[0.5, 0.5], [-1, -1]]);
  const q = parsePath('M0 0 Q 10 10 20 0')[1];
  eq('path quad -> cubic', q.map((v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)), ['C', 6.667, 6.667, 13.333, 6.667, 20, 0]);
  const arc = parsePath('M0 0 a50 50 0 0 1 100 0');
  eq('path arc ends', arc[arc.length - 1].slice(5).map(Math.round), [100, 0]);
  eq('path arc segments', arc.length - 1, 2);
  const glued = parsePath('M0 0 a1 1 0 011 1');
  eq('path glued arc flags', glued[glued.length - 1].slice(5).map((v) => Math.round(v * 1000) / 1000), [1, 1]);
  const full = arcPath(0, 0, 10, 0, 360);
  near('arc full circle end', full[full.length - 1][5], 10, 1e-9);
  eq('arc bounds', pathBounds(arcPath(0, 0, 10, 0, 90)).map((v) => Math.round(v)), [0, 0, 10, 10]);
  eq('path ops', pathOps([['M', 1.23456, 2], ['L', 3, 4], ['Z']]), '1.235 2 m 3 4 l h');
  eq('rounded rect', rectPath(0, 0, 10, 10, 2).filter((c) => c[0] === 'C').length, 4);
  throws('path bad', () => parsePath('M 1'), /number expected/);
  throws('path no command', () => parsePath('1 2'), /must start/);

  // --- colours, sizes, strings -------------------------------------------------------------------------------------
  eq('colour hex', parseColor('#f80'), { space: 'rgb', v: [1, 0x88 / 255, 0], alpha: 1 });
  eq('colour alpha', parseColor('#00000080').alpha, 128 / 255);
  eq('colour grey / cmyk / none', [parseColor(0.5).space, parseColor([0, 0, 0, 1]).space, parseColor('none')], ['gray', 'cmyk', null]);
  throws('colour bad', () => parseColor('red'), /bad colour/);
  eq('page sizes', [pageSize('a4'), pageSize('A4', true), pageSize([100, 50], true)], [[595.28, 841.89], [841.89, 595.28], [100, 50]]);
  near('mm', mm(25.4), 72);
  eq('pdf text strings', [pdfText('Hi (x)'), pdfText('Жa')], ['(Hi \\(x\\))', '<FEFF0416 0061>'.replace(' ', '')]);
  eq('winansi', [winAnsiCode(0x41), winAnsiCode(0x20ac), winAnsiCode(0x416)], [0x41, 0x80, 0]);
  eq('helvetica widths', [standardWidth('Helvetica', 0x41), standardWidth('Helvetica-Bold', 0x41), standardWidth('Courier', 0x41)], [667, 722, 600]);
  eq('clean text', cleanText('a\u200bb\tc\u00ade\u0301'), 'ab c\u00e9');

  // --- shaping ------------------------------------------------------------------------------------------------------
  const doc0 = new PDFDocument();
  const syn = doc0.addFont(bytes);
  const helv = doc0.addStandardFont('Helvetica');
  const runs = shapeText('AB Cა', [syn, helv]);
  eq('shape runs by font', runs.map((r) => [r.font.name, r.glyphs]), [['SyntheticSans', [1, 2, 3]], ['Helvetica', [0x43]], ['SyntheticSans', [4]]]);
  eq('shape missing glyph stays', shapeText('A\u{1F4A9}', [syn]).flatMap((r) => r.glyphs), [1, 0]);
  eq('shape astral', shapeText('\u{1F600}', [syn])[0].glyphs, [8]);
  near('measure', measureText('AB', [syn], 10), ((f.widthOf(1) + f.widthOf(2)) * 10) / 1000);
  near('measure scales', measureText('AB', [syn], 20), 2 * measureText('AB', [syn], 10));
  near('measure char spacing', measureText('AB', [syn], 10, { charSpacing: 1 }), measureText('AB', [syn], 10) + 2);
  eq('line metrics', lineMetrics([syn], 10).height, 10);
  throws('restricted licence', () => new PDFDocument().addFont(syntheticFont({ fsType: 2 })), /licence/);
  ok('restricted override', new PDFDocument().addFont(syntheticFont({ fsType: 2 }), { ignoreLicense: true }));

  // --- document structure -------------------------------------------------------------------------------------------
  const build = (opts = {}) => {
    const doc = new PDFDocument({ title: 'Test ქართული', author: 'in-html', subject: 'structure', lang: 'ka', date, ...opts });
    const font = doc.addFont(bytes);
    const h = doc.addStandardFont('Helvetica');
    doc.setFont([font, h]);
    const p1 = doc.addPage('A4');
    p1.text('AB ა Ж', 50, 100, { size: 24 });
    p1.text('Helvetica (Café)', 50, 140, { font: h, size: 12, color: '#336699', link: 'https://example.org/a b' });
    p1.text('AAA', 300, 300, { size: 12, rotate: 45, underline: true, opacity: 0.5 });
    p1.rect(40, 40, 200, 100, { fill: '#ffeeaa', stroke: '#000', width: 2, radius: 6, dash: [4, 2] });
    p1.circle(400, 400, 30, { fill: [0, 0.5, 1], opacity: 0.3 });
    p1.path('M100 500 a50 50 0 1 1 100 0 z', { stroke: '#080', fill: 'none', width: 1.5 });
    p1.save().rotate(10, 300, 600).line(250, 600, 350, 600, { stroke: '#f00', cap: 'round' }).restore();
    const p2 = doc.addPage('A5', { landscape: true });
    p2.text('B', 20, 40, { size: 30, align: 'center', baseline: 'top' });
    p1.link(50, 700, 100, 20, { page: p2, y: 0 });
    doc.bookmark('First', p1).bookmark('Второй', p2, 10);
    return doc.toBytes();
  };
  const pdf = build();
  const ins = inspectPDF(pdf);
  eq('structure ok', [ins.ok, ins.problems], [true, []]);
  eq('structure version', ins.version, '1.7');
  eq('xref ok', ins.xrefOk, true);
  eq('object count = /Size - 1', ins.objects, ins.size - 1);
  ok('streams have exact lengths', ins.streams.length >= 4 && ins.streams.every((s) => s.lengthOk));
  eq('pages', ins.pages.map((p) => [p.width, p.height]), [[595.28, 841.89], [595.28, 419.53]]);
  eq('text copies back', ins.pages[0].text, ['AB ა Ж', 'Helvetica (Café)', 'AAA']);
  eq('text page 2', ins.pages[1].text, ['B']);
  const tt = ins.fonts.find((x) => x.subtype === 'Type0');
  eq('font embedded subset with ToUnicode', [tt.embedded, tt.subset, tt.toUnicode, /\+SyntheticSans$/.test(tt.base)], [true, true, true, true]);
  eq('standard font', ins.fonts.find((x) => x.subtype === 'Type1').base, 'Helvetica');
  eq('links', ins.links.map((l) => (l.uri ? l.uri : typeof l.dest)), ['https://example.org/a%20b', 'number']);
  eq('internal link points at page 2', ins.links[1].dest, ins.pages[1].obj);
  eq('bookmarks', ins.outlines, 2);
  eq('info', [ins.info.Title, ins.info.Author, ins.info.CreationDate], ['Test ქართული', 'in-html', 'D:20261024120000Z']);
  eq('catalog lang', /\/Lang \(ka\)/.test(dec(pdf)), true);
  eq('deterministic', dec(build()) === dec(pdf), true);
  ok('trailer id', /\/ID \[<[0-9A-F]{32}> <[0-9A-F]{32}>\]/.test(dec(pdf)));
  // the font file inside is a valid subset TrueType that still maps the drawn glyphs
  const ff = ins.streams.map((s) => s.obj).find((n) => new RegExp(`\\n${n} 0 obj\\n<< /Length1`).test(dec(pdf)));
  const ffText = dec(pdf);
  const at = ffText.indexOf(`\n${ff} 0 obj\n`) + 1;
  const len = +/\/Length (\d+) >>/.exec(ffText.slice(at, at + 200))[1];
  const st = ffText.indexOf('stream\n', at) + 7;
  const embedded = parseTTF(unzlibSync(pdf.subarray(st, st + len)));
  eq('embedded subset', [embedded.numGlyphs, !!embedded.glyphRange(1), !!embedded.glyphRange(4), !!embedded.glyphRange(5), !!embedded.glyphRange(3)], [6, true, true, true, false]);
  const raw = new PDFDocument({ compress: false, date });
  raw.addPage([200, 100]).rect(10, 10, 20, 20, { fill: '#000' });
  const rawText = dec(raw.toBytes());
  ok('uncompressed content', /q 1 0 0 -1 0 100 cm\nq 0 0 0 rg 10 10 m 30 10 l 30 30 l 10 30 l h f Q\nQ/.test(rawText));
  eq('empty document has a page', inspectPDF(new PDFDocument({ date }).toBytes()).pages.length, 1);
  throws('javascript link', () => new PDFDocument().addPage().link(0, 0, 1, 1, 'javascript:alert(1)'), /refusing/);
  // /W ranges: consecutive glyph ids share one array
  const wdoc = new PDFDocument({ date, compress: false });
  wdoc.addFont(bytes);
  wdoc.addPage().text('ABა', 0, 20);
  const wtxt = dec(wdoc.toBytes());
  eq('/W ranges', /\/W \[([^\]]*\])*\]/.exec(wtxt)[0].replace(/\s+/g, ' '), `/W [1 [${f.widthOf(1)} ${f.widthOf(2)}] 4 [${f.widthOf(4)}]]`);
  eq('ToUnicode map', [...parseCMap(wtxt.slice(wtxt.indexOf('begincmap'))).entries()], [[1, 'A'], [2, 'B'], [4, 'ა']]);
  eq('tokenize', tokenize('/F1 12 Tf (a\\(b) Tj <0041> Tj [1 -2] TJ').map((t) => t.t + ':' + (t.v ?? '')), ['name:F1', 'num:12', 'op:Tf', 'str:a(b', 'op:Tj', 'hex:\0A', 'op:Tj', '[:', 'num:1', 'num:-2', ']:', 'op:TJ']);
  // a broken file is reported, not trusted
  const broken = pdf.slice();
  const so = dec(broken).indexOf('stream\n') + 7;
  broken.copyWithin(so + 1, so); // shifts everything after the first stream start by a byte
  ok('broken file detected', !inspectPDF(broken).ok);

  // --- images -------------------------------------------------------------------------------------------------------
  const W = 8, H = 6;
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) rgba.set([i * 5, 255 - i * 5, 128, i % 2 ? 255 : 100], i * 4);
  const png = encodePNG({ width: W, height: H, data: rgba });
  const jpg = encodeJPEG({ width: W, height: H, data: rgba.map((v, i) => (i % 4 === 3 ? 255 : v)) }, { quality: 90 });
  eq('image kinds', [imageKind(png), imageKind(jpg), imageKind(new Uint8Array(10))], ['png', 'jpeg', null]);
  eq('jpeg info', [jpegInfo(jpg).width, jpegInfo(jpg).height, jpegInfo(jpg).components], [W, H, 3]);
  const pi = prepareImage(png);
  eq('png -> rgb + smask', [pi.colorSpace, pi.filter, !!pi.smask, unzlibSync(pi.data).length, unzlibSync(pi.smask.data).length], ['DeviceRGB', 'FlateDecode', true, W * H * 3, W * H]);
  const ji = prepareImage(jpg);
  eq('jpeg passthrough', [ji.filter, ji.colorSpace, ji.data === jpg], ['DCTDecode', 'DeviceRGB', true]);
  const gray = prepareImage({ width: 2, height: 1, data: new Uint8Array([9, 9, 9, 255, 200, 200, 200, 255]) });
  eq('rgba grey detection', [gray.colorSpace, gray.smask, [...unzlibSync(gray.data)]], ['DeviceGray', null, [9, 200]]);
  throws('image bad', () => prepareImage(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])), /only JPEG, PNG/);
  const idoc = new PDFDocument({ date });
  const ip = idoc.addPage();
  const imPng = idoc.addImage(png), imJpg = idoc.addImage(jpg);
  ip.image(imPng, 10, 10, 80).image(imJpg, 100, 10, 80, 80, { fit: 'contain' }).image(imJpg, 200, 10, 80, 30, { fit: 'cover', opacity: 0.5 });
  const iout = idoc.toBytes();
  const iins = inspectPDF(iout);
  eq('images in file', [iins.ok, iins.images, iins.pages[0].images.length], [true, 3, 2]);
  ok('jpeg bytes embedded verbatim', dec(iout).includes(dec(jpg)));
  ok('smask referenced', /\/SMask \d+ 0 R/.test(dec(iout)));

  // --- layout -------------------------------------------------------------------------------------------------------
  const ldoc = new PDFDocument({ date });
  const lf = ldoc.addFont(bytes);
  const lines = wrapText('AB AB AB AB AB AB', [lf], 10, 40);
  ok('wrap widths fit', lines.every((l) => l.width <= 40 + 1e-6), JSON.stringify(lines));
  eq('wrap text kept', lines.map((l) => l.text).join(' '), 'AB AB AB AB AB AB');
  eq('wrap paragraph ends', wrapText('A\n\nB', [lf], 10, 100).map((l) => [l.text, l.end]), [['A', true], ['', true], ['B', true]]);
  const long = wrapText('AAAAAAAAAAAAAAAAAAAA', [lf], 10, 30);
  ok('wrap breaks long words', long.length > 1 && long.every((l) => l.width <= 30 + 1e-6));
  eq('wrap breaks after hyphen', wrapText('AAAA-BBBBBBBB', [ldoc.addStandardFont('Courier')], 10, 60).map((l) => l.text), ['AAAA-', 'BBBBBBBB']);
  const clipped = clipText('ABABABABAB', [lf], 10, 30);
  ok('clip ellipsis', clipped.endsWith('…') && measureText(clipped, [lf], 10) <= 30);
  eq('clip fits already', clipText('AB', [lf], 10, 100), 'AB');
  const fs1 = fitText('ABAB', [lf], 100);
  ok('fit text', measureText('ABAB', [lf], fs1) <= 100 && measureText('ABAB', [lf], fs1 + 0.5) > 100);
  eq('fit text by height', fitText('A', [lf], 1000, { height: 20 }), 20);
  const lp = ldoc.addPage();
  const box = textBox(lp, 'AB AB AB AB AB AB AB AB', { x: 10, y: 10, width: 40, size: 10, maxLines: 2, align: 'justify' });
  eq('text box overflow', [box.lines.length, box.overflow, box.lines[1].endsWith('…')], [2, true, true]);
  ok('justify uses TJ', lp.ops.some((o) => / TJ /.test(o)));
  const tb = textBox(lp, 'AB', { x: 0, y: 100, width: 100, height: 50, size: 10, valign: 'middle', align: 'right' });
  eq('text box height', tb.height, 10);
  // flow with a long table: pages break, header repeats on every page
  const lh = ldoc.addStandardFont('Helvetica');
  const flow = new Flow(ldoc, { font: lf, margin: 36, footer: (p, i, n) => p.text(`${i + 1}/${n}`, p.width / 2, p.height - 20, { font: lh, size: 8, align: 'center' }) });
  flow.heading('A').paragraph('AB '.repeat(200), { align: 'justify' }).rule();
  const rows = [['A', 'B', 'AB']];
  for (let i = 0; i < 150; i++) rows.push(['A', 'B'.repeat(1 + (i % 3)), i % 10 === 0 ? 'AB AB AB AB AB AB AB AB AB AB' : 'A']);
  flow.table(rows, { widths: [1, 2, 2], align: [null, 'right', null], zebra: true });
  flow.finish();
  const lout = ldoc.toBytes();
  const lins = inspectPDF(lout);
  eq('flow file ok', lins.ok, true);
  ok('table spans pages', lins.pages.length >= 4, String(lins.pages.length));
  const head3 = (p) => JSON.stringify(p.text.slice(0, 3)) === '["A","B","AB"]';
  const firstTable = lins.pages.findIndex((p) => p.text.some((t, i) => t === 'A' && p.text[i + 1] === 'B' && p.text[i + 2] === 'AB'));
  ok('table found', firstTable >= 0);
  ok('header repeats on every following page', lins.pages.slice(firstTable + 1).every(head3), JSON.stringify(lins.pages.map((p) => p.text.slice(0, 3))));
  eq('footers', lins.pages.map((p) => p.text[p.text.length - 1]), lins.pages.map((_, i) => `${i + 1}/${lins.pages.length}`));

  // --- system fonts (skipped when absent) ----------------------------------------------------------------------------
  const notoBytes = systemFont(['NotoSans-Regular.ttf', 'DejaVuSans.ttf', 'arial.ttf', 'Arial.ttf']);
  const geoBytes = systemFont(['NotoSansGeorgian-Regular.ttf', 'sylfaen.ttf', 'DejaVuSans.ttf']);
  if (!notoBytes || !geoBytes) { skipped++; console.log('pdf: system fonts not found, skipping their checks (set PDF_TEST_FONTS to a font folder)'); }
  else {
    const noto = parseTTF(notoBytes), geo = parseTTF(geoBytes);
    eq('sys latin + cyrillic glyphs', [noto.gidFor(0x41) > 0, noto.gidFor(0x416) > 0, new Set([0x41, 0x42, 0x416, 0x44f].map((c) => noto.gidFor(c))).size], [true, true, 4]);
    ok('sys georgian glyphs', geo.gidFor(0x10d0) > 0 && geo.gidFor(0x10d0) !== geo.gidFor(0x10e2));
    if (geo.numberOfHMetrics < geo.numGlyphs) {
      const last = geo.widthOf(geo.numberOfHMetrics - 1);
      let tailOk = true;
      for (let g = geo.numberOfHMetrics; g < geo.numGlyphs; g++) if (geo.widthOf(g) !== last) tailOk = false;
      ok('sys hmtx tail repeats', tailOk);
    }
    const sdoc = new PDFDocument({ title: 'გამარჯობა', date });
    const a = sdoc.addFont(notoBytes), g = sdoc.addFont(geoBytes);
    sdoc.setFont([a, g]);
    const sp = sdoc.addPage();
    const line = 'Привет, мир! Hello — გამარჯობა, მსოფლიო 123';
    sp.text(line, 40, 60, { size: 14 });
    textBox(sp, 'ქართული ტექსტი გადატანით და სწორებით, საკმარისად გრძელი რომ რამდენიმე ხაზად გაიყოს. Русский текст тоже переносится по словам.', { x: 40, y: 100, width: 250, size: 11, align: 'justify' });
    const sout = sdoc.toBytes();
    const sins = inspectPDF(sout);
    eq('sys file ok', [sins.ok, sins.problems], [true, []]);
    eq('sys text copies back', sins.pages[0].text[0], line);
    ok('sys wrapped georgian copies back', sins.pages[0].text.slice(1).join(' ').replace(/\s+/g, ' ').startsWith('ქართული ტექსტი გადატანით'));
    ok('sys subset is small', sout.length < (notoBytes.length + geoBytes.length) / 4, `${sout.length} vs ${notoBytes.length + geoBytes.length}`);
    const full = new PDFDocument({ date, subset: false });
    full.addFont(geoBytes);
    full.addPage().text('ა', 10, 20);
    ok('sys no-subset embeds whole font', full.toBytes().length > sout.length / 4);
    const reparsed = sins.fonts.filter((x) => x.subtype === 'Type0');
    eq('sys fonts embedded', reparsed.map((x) => [x.embedded, x.subset, x.toUnicode]), [[true, true, true], [true, true, true]]);
  }

  console.log(`pdf: ${pass} passed, ${fail} failed${skipped ? ', system-font checks skipped' : ''}`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
