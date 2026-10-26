// stitch/test.js - unit tests of the embroidery library: node stitch/test.js (also node check.js tests stitch).
//
// Approach: no test framework (zero dependencies, runs in plain Node and under check.js). ok() counts and prints
// failures but never throws, so one broken area does not hide failures in the others; run() returns the failure
// count, and the process exit code is set only when the file is executed directly (isMain), so check.js can import
// run() without side effects. Tests check properties and round trips (JSON, OXS, PDF structure, PNG decode) rather
// than golden files, so harmless output changes (number formatting, object order) do not break them.
// Only modules that run without a DOM are tested here; render.js and view.js need a canvas and are not covered.
import { BRANDS, catalog, findThread, threadByKey, nearestThreads, crossReference, mixColors, blendThread, rgbToLab, hexToRgb, normCode, darkest } from './threads.js';
import { deltaE2000 } from '../color/metrics.js';
import { createScheme, normScheme, toJSON, fromJSON, encodeCells, decodeCells, setCell, cellAt, addPart, partsConflict, flatten, usage, bounds, transform, resizeCanvas, crop, threadEntry, blendEntry, mergePalette, removePalette, compactPalette, sortPalette, replacePalette, entryLabel } from './model.js';
import { SYMBOLS, SYMBOL_ORDER, LETTERS, assignSymbols, isVector, pathCommands } from './symbols.js';
import { convertImage, targetSize, resample, backgroundMask, cleanupGrid, outlineSegments } from './convert.js';
import { legend, shoppingList, fabricSize, stats, threadLength, PER_STITCH } from './estimate.js';
import { paginate, pageCapacity, pageOf } from './pages.js';
import { writeOXS, readOXS } from './oxs.js';
import { exportPDF } from './pdf.js';
import { inspectPDF, winAnsi, textWidth, transliterate, glyphOps } from './pdfdoc.js';
import { toSVG, rasterize, toPNG, previewRGBA, fillPolygons } from './image.js';
import { textBitmap, FONTS } from './font.js';
import { lineCells, floodFill, copyRegion, pasteClip, transformClip, clearRegion, textClip, createHistory, rectCells, ellipseCells } from './edit.js';
import { decodePNG } from '../png/decode.js';
import { parseXML } from '../xml/xml.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let failed = 0, passed = 0;
// info is JSON-printed on failure only: the actual value next to the expectation is what makes a failure readable.
function ok(cond, name, info) {
  if (cond) passed++;
  else { failed++; console.log('x stitch: ' + name + (info !== undefined ? ' ' + JSON.stringify(info) : '')); }
}
const near = (a, b, eps) => Math.abs(a - b) <= eps;

// A synthetic picture: background, two discs, a gradient band.
// Synthetic input instead of a fixture file: known colours (a saturated red and blue, a near-white background,
// a hue gradient) make assertions like "the red disc keeps a close red" possible, and nothing has to be loaded.
function picture(w = 240, h = 180) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    let c = [250, 250, 248];
    if (Math.hypot(x - 80, y - 80) < 50) c = [200, 30, 50];
    if (Math.hypot(x - 170, y - 70) < 40) c = [30, 80, 190];
    if (y > 140) c = [Math.round((x * 255) / w), 170, Math.round(255 - (x * 255) / w)];
    data.set([...c, 255], i);
  }
  return { width: w, height: h, data };
}

export function run() {
  // Catalogue integrity: sizes, unique codes, valid colours, code normalisation, and cross-brand equivalence through
  // the DMC tables (Anchor 403 / Gamma 0420 / PNK 7214 all map to DMC 310).
  // Note: the Madeira line (findThread(...) === null || true) is a smoke test that can only fail by throwing.
  // --- catalogues -----------------------------------------------------------------------------------------------
  const dmc = catalog('dmc');
  ok(dmc.threads.length === 489, 'DMC complete range (454 classic + 35 colours of 2017)', dmc.threads.length);
  ok(new Set(dmc.threads.map((t) => t.code)).size === dmc.threads.length, 'DMC codes unique');
  for (const b of BRANDS) {
    const c = catalog(b.id);
    ok(c && c.threads.length > 200, 'catalogue ' + b.id + ' has threads', c && c.threads.length);
    ok(c.threads.every((t) => /^#[0-9a-f]{6}$/.test(t.hex) && t.lab.length === 3), 'catalogue ' + b.id + ' colours valid');
  }
  ok(findThread('dmc', '310').hex === '#000000' && findThread('dmc', '0310') === findThread('dmc', '310'), 'DMC 310 is black, number normalized');
  ok(findThread('dmc', 'blanc').code === 'White' && findThread('dmc', '1').code === '01', 'DMC aliases (blanc, 01)');
  ok(threadByKey('anchor:403') && threadByKey('anchor:403').eq.includes('310'), 'Anchor 403 = DMC 310');
  ok(findThread('gamma', '420') && findThread('gamma', '0420').eq.includes('310'), 'Gamma 0420 = DMC 310');
  ok(findThread('pnk', '7214') && findThread('pnk', '7214').eq.includes('310'), 'PNK Kirova 7214 = DMC 310');
  ok(findThread('madeira', '2400') === null || true, 'Madeira lookups do not throw');
  ok(normCode('gamma', '42') === '0042' && normCode('anchor', '0403') === '403', 'code normalization per brand');
  const xr = crossReference(findThread('dmc', '321'), 'anchor');
  ok(xr.length >= 1 && xr[0].table && xr[0].dE < 1, 'cross-reference DMC 321 -> Anchor from the table', xr.map((r) => r.thread.code));
  const xr2 = crossReference(findThread('gamma', '0420'), 'dmc');
  ok(xr2[0].thread.code === '310', 'cross-reference Gamma -> DMC', xr2[0] && xr2[0].thread.code);
  const nr = nearestThreads('#c72b3b', 'dmc', { n: 3 });
  ok(nr[0].thread.code === '321' && nr[0].dE < 0.01, 'nearest thread of DMC 321 colour is DMC 321', nr[0].thread.code);
  ok(nearestThreads([255, 0, 0], 'dmc', { n: 5 }).every((r, i, a) => !i || a[i - 1].dE <= r.dE), 'nearest threads sorted by ΔE');
  ok(darkest('dmc').code === '310', 'darkest DMC thread');

  // Reference pairs from Sharma, Wu and Dalal (2005), the published test data for CIEDE2000; they cover the
  // discontinuities of the formula (hue angle wrap-around near a* = 0, the blue-region rotation term), where naive
  // implementations differ at the 1e-4 level.
  // --- ΔE2000 (Sharma, Wu, Dalal test pairs) ----------------------------------------------------------------------
  const pairs = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425], [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412], [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
    [[50, 0, 0], [50, -1, 2], 2.3669], [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644], [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
  ];
  for (const [a, b, e] of pairs) ok(near(deltaE2000(a, b), e, 1e-4), 'ΔE2000 test pair', [deltaE2000(a, b), e]);
  const mix = mixColors([[0, 0, 0], [255, 255, 255]]);
  ok(mix[0] === mix[1] && mix[0] > 180 && mix[0] < 195, 'blend of black and white mixes in linear light', mix);
  const bl = blendThread([findThread('dmc', '310'), findThread('dmc', 'White')]);
  ok(bl.blend.length === 2 && bl.code === '310+White', 'blended thread');

  // The fractional-stitch overlap rules (partsConflict) are tested case by case because addPart silently replaces
  // conflicting stitches: a wrong rule would lose stitches without any error.
  // --- model --------------------------------------------------------------------------------------------------------
  const s = createScheme({ width: 30, height: 20, title: 'T', palette: [threadEntry(findThread('dmc', '310')), threadEntry(findThread('dmc', '321')), blendEntry([findThread('dmc', '310'), findThread('dmc', 'White')])] });
  ok(s.width === 30 && s.layers[0].cells.length === 600, 'createScheme');
  setCell(s, 0, 0, 0); setCell(s, 1, 0, 1); setCell(s, 29, 19, 2);
  ok(cellAt(s, 1, 0) === 1 && cellAt(s, 2, 0) === -1 && cellAt(s, 40, 0) === -1, 'cellAt / setCell');
  const L0 = s.layers[0];
  addPart(L0, { x: 5, y: 5, k: 'three', c: 'tl', p: 0 });
  addPart(L0, { x: 5, y: 5, k: 'three', c: 'br', p: 1 });
  ok(L0.parts.length === 2, 'two opposite three-quarter stitches share a cell');
  addPart(L0, { x: 5, y: 5, k: 'quarter', c: 'tr', p: 2 });
  ok(L0.parts.length === 1 && L0.parts[0].k === 'quarter', 'a quarter in a neighbouring corner replaces both threes', L0.parts);
  addPart(L0, { x: 5, y: 5, k: 'petite', c: 'bl', p: 1 });
  ok(L0.parts.length === 2, 'quarters in different corners coexist');
  addPart(L0, { x: 5, y: 5, k: 'half', c: '/', p: 0 });
  ok(L0.parts.length === 1 && L0.parts[0].k === 'half', 'a half replaces the cell');
  ok(partsConflict({ x: 0, y: 0, k: 'three', c: 'tl' }, { x: 0, y: 0, k: 'quarter', c: 'br' }) === false, 'three and the opposite quarter do not conflict');
  L0.lines.push({ x1: 0, y1: 0, x2: 3, y2: 4, p: 0, k: 'back' });
  L0.knots.push({ x: 10, y: 10, p: 1 });
  L0.beads.push({ x: 12.5, y: 12.5, p: 2 });
  const u = usage(s);
  ok(u[0].full === 1 && u[1].full === 1 && u[0].half === 1 && near(u[0].back, 5, 1e-9) && u[1].knots === 1 && u[2].beads === 1, 'usage counts', u);
  const enc = encodeCells(new Uint16Array([0, 0, 0, 5, 5, 1, 0]));
  ok(enc === '3*0,2*5,1,0' && decodeCells(enc, 7).join() === '0,0,0,5,5,1,0', 'run-length cells', enc);
  const back = fromJSON(toJSON(s));
  ok(back.width === 30 && back.layers[0].cells.join() === s.layers[0].cells.join() && back.layers[0].parts.length === 1 && back.palette[2].blend.length === 2, 'JSON round trip');
  // Hostile input: every field wrong in a different way; the contract is "never throws, always valid".
  const bad = normScheme({ width: -5, height: 'x', palette: [{ hex: 'nope' }], layers: [{ cells: 'zz', parts: [{ k: 'bogus' }, { x: 0, y: 0, k: 'half', c: '/', p: 9 }] }] });
  ok(bad.width === 1 && bad.palette[0].hex === '#888888' && bad.layers[0].parts.length === 0, 'normScheme never throws on hostile input');
  const b = bounds(s);
  ok(b && b.x0 === 0 && b.y0 === 0 && b.x1 === 30 && b.y1 === 20, 'bounds', b);
  const fx = transform(s, 'fx');
  ok(cellAt(fx, 29, 0) === 0 && cellAt(fx, 28, 0) === 1 && fx.layers[0].lines[0].x1 === 30, 'mirror left-right');
  const r90 = transform(s, 'r90');
  ok(r90.width === 20 && r90.height === 30 && cellAt(r90, 19, 0) === 0, 'rotate 90° clockwise');
  ok(transform(transform(transform(transform(s, 'r90'), 'r90'), 'r90'), 'r90').layers[0].cells.join() === s.layers[0].cells.join(), 'four rotations are the identity');
  const rc = resizeCanvas(s, 40, 30, 5, 5);
  ok(rc.width === 40 && cellAt(rc, 5, 5) === 0 && cellAt(rc, 6, 5) === 1, 'resize canvas with offset');
  const cr = crop(s, { x0: 1, y0: 0, x1: 4, y1: 2 });
  ok(cr.width === 3 && cellAt(cr, 0, 0) === 1, 'crop');
  const m = fromJSON(toJSON(s));
  mergePalette(m, 1, 0);
  ok(m.palette.length === 2 && cellAt(m, 1, 0) === 0, 'merge palette entries');
  const rm = fromJSON(toJSON(s));
  removePalette(rm, 0);
  ok(rm.palette.length === 2 && cellAt(rm, 0, 0) === -1 && cellAt(rm, 1, 0) === 0, 'remove a palette entry and its stitches');
  const cp = fromJSON(toJSON(s));
  cp.palette.push(threadEntry(findThread('dmc', '666')));
  compactPalette(cp);
  ok(cp.palette.length === 3, 'compact drops unused entries');
  const sp = fromJSON(toJSON(s));
  sortPalette(sp, 'code');
  // Two accepted orders: whether a blend code ('310+White') sorts before or after '321' depends on the comparator's
  // numeric-prefix rule, which the test deliberately does not pin down.
  ok(sp.palette.map((e) => e.code).join() === '310,310+White,321' || sp.palette.map((e) => e.code).join() === '310,321,310+White', 'sort palette by code', sp.palette.map((e) => e.code));
  const rp = fromJSON(toJSON(s));
  replacePalette(rp, 0, threadEntry(findThread('dmc', '939')));
  ok(rp.palette[0].code === '939' && cellAt(rp, 0, 0) === 0, 'replace a thread keeps stitches');
  ok(entryLabel(s.palette[2]) === 'DMC 310 + White', 'blend label', entryLabel(s.palette[2]));
  const two = fromJSON(toJSON(s));
  two.layers.push({ ...two.layers[0], id: 'l2', cells: new Uint16Array(600), parts: [], lines: [], knots: [], beads: [] });
  two.layers[1].cells[0] = 2;
  ok(flatten(two).cells[0] === 2 && flatten(two).cells[1] === 2, 'flatten: upper layers win');

  // --- symbols ------------------------------------------------------------------------------------------------------
  ok(SYMBOL_ORDER.length >= 80 && new Set(SYMBOL_ORDER.map((id) => SYMBOLS[id].char)).size === SYMBOL_ORDER.length, 'symbols: many, distinct look-alike characters');
  ok(SYMBOL_ORDER.every((id) => pathCommands(SYMBOLS[id].d).every(([c, ...v]) => 'MLCZ'.includes(c) && v.every(Number.isFinite))), 'symbol paths parse');
  ok(LETTERS.every((x) => winAnsi(x)) && new Set(LETTERS).size === LETTERS.length, 'letters are WinAnsi and unique');
  const pal40 = Array.from({ length: 40 }, (_, i) => ({ hex: '#000000', symbol: '' }));
  const syms = assignSymbols(pal40, { counts: pal40.map((_, i) => 40 - i) });
  ok(new Set(syms).size === 40 && syms.every(isVector), 'assignSymbols: distinct vector symbols');
  const lets = assignSymbols(pal40, { mode: 'letters', blankFirst: true });
  ok(lets[0] === '' && new Set(lets.slice(1)).size === 39 && lets.slice(1).every((x) => !isVector(x)), 'letters mode with a blank most-used colour', lets.slice(0, 5));
  const labs = [[50, 0, 0], [51, 0, 0], [90, 0, 0]];
  const close = assignSymbols([{}, {}, {}], { labs });
  ok(SYMBOLS[close[0]].family !== SYMBOLS[close[1]].family, 'similar colours get different symbol families', close);
  const keep = assignSymbols([{ symbol: 'star' }, { symbol: 'star' }], { keep: true });
  ok(keep[0] === 'star' && keep[1] !== 'star', 'keep existing symbols, fix duplicates');

  // Thresholds (meanDE < 8, a red within 6 ΔE) are tolerances, not exact values: the test pins quality, not the
  // particular threads chosen, so tuning the reduction heuristics does not require rewriting assertions.
  // --- conversion -----------------------------------------------------------------------------------------------------
  const img = picture();
  ok(targetSize(240, 180, { width: 80 }).height === 60, 'size from stitches and aspect');
  const ts = targetSize(240, 180, { sizeBy: 'size', finishedWidth: 25.4, count: 14 });
  ok(ts.width === 140 && ts.height === 105, 'size from finished width and fabric count', ts);
  const rs = resample({ width: 2, height: 2, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255, 0, 0, 255, 255]) }, 1, 1);
  ok(rs[3] === 1 && rs[0] > 180 && rs[2] > 180, 'area resampling averages in linear light', [...rs]);
  const conv = convertImage(img, { width: 60, maxColors: 6, brand: 'dmc' });
  const cs = conv.scheme;
  ok(cs.width === 60 && cs.height === 45 && cs.palette.length <= 6 && cs.palette.length >= 4, 'convert: size and colour count', conv.stats);
  ok(conv.stats.meanDE < 8, 'convert: mean colour error is small', conv.stats.meanDE);
  ok(cs.palette.every((e) => findThread('dmc', e.code)), 'convert: palette entries are DMC threads');
  ok(cs.palette.some((e) => deltaE2000(rgbToLab(hexToRgb(e.hex)), rgbToLab([200, 30, 50])) < 6), 'convert: the red disc keeps a close red', cs.palette.map((e) => e.code));
  ok(new Set(cs.palette.map((e) => e.symbol)).size === cs.palette.length, 'convert: symbols assigned');
  const u2 = usage(cs);
  ok(u2.every((x, i) => !i || u2[i - 1].full >= x.full), 'convert: palette ordered by use');
  const bgc = convertImage(img, { width: 60, maxColors: 8, background: 'auto' });
  ok(bgc.stats.empty > 1000 && cellAt(bgc.scheme, 0, 0) === -1 && cellAt(bgc.scheme, 20, 20) >= 0, 'convert: background removed from the border', bgc.stats);
  const tr = { ...img, data: img.data.slice() };
  for (let i = 0; i < 240 * 30; i++) tr.data[i * 4 + 3] = 0;
  ok(convertImage(tr, { width: 60, maxColors: 6 }).stats.empty >= 420, 'convert: transparent pixels stay empty (the top 7.5 rows)');
  const fs = convertImage(img, { width: 60, maxColors: 6, dither: 'fs', cleanup: 0 });
  const od = convertImage(img, { width: 60, maxColors: 6, dither: 'ordered', cleanup: 0 });
  ok(fs.scheme.palette.length <= 6 && od.scheme.palette.length <= 6, 'dithering keeps the colour limit');
  const bl2 = convertImage(img, { width: 60, maxColors: 12, blends: true });
  ok(bl2.stats.candidates > 489, 'blends add candidates', bl2.stats);
  const ol = convertImage(img, { width: 60, maxColors: 6, outline: true, outlineThreshold: 25 });
  ok(ol.scheme.layers.length === 2 && ol.scheme.layers[1].lines.length > 10, 'outlines as a backstitch layer', ol.stats.outlines);
  const anchor = convertImage(img, { width: 40, maxColors: 5, brand: 'anchor' });
  ok(anchor.scheme.palette.every((e) => e.brand === 'Anchor'), 'convert to another brand');
  // Confetti: an isolated cell in a uniform area is cleaned.
  const grid = new Int16Array(25).fill(0);
  grid[12] = 1;
  const pal2 = [{ lab: [50, 0, 0] }, { lab: [60, 10, 0] }];
  ok(cleanupGrid(grid, 5, 5, pal2, 1) >= 1 && grid[12] === 0, 'confetti clean-up');
  const g2 = new Int16Array([0, 0, 1, 1]);
  ok(outlineSegments(g2, 2, 2, [{ lab: [20, 0, 0] }, { lab: [90, 0, 0] }], 30, false).length === 1, 'outline between strongly different colours');
  const mask = backgroundMask(new Float32Array([255, 255, 255, 1, 0, 0, 0, 1, 255, 255, 255, 1]), new Float32Array([100, 0, 0, 0, 0, 0, 100, 0, 0]), 3, 1, { background: 'color', bgColor: '#ffffff' });
  ok(mask.join() === '1,0,1', 'background mask by colour', [...mask]);

  // 4800 = 8 m skein x 100 cm x 6 strands: the strand-cm capacity of one DMC skein (see estimate.js design rules).
  // --- estimates -----------------------------------------------------------------------------------------------------
  ok(near(threadLength('full', { count: 14, strands: 2 }), (2 * Math.SQRT2 + 2) * (2.54 / 14) * 2, 1e-9), 'thread length of a cross');
  const est = createScheme({ width: 100, height: 100, palette: [threadEntry(findThread('dmc', '310'))] });
  est.layers[0].cells.fill(1, 0, 2000);
  const lg = legend(est, { count: 14, waste: 0 });
  const expectCm = 2000 * PER_STITCH.full * (2.54 / 14) * 2;
  ok(near(lg[0].lengthCm, expectCm, 1e-6) && lg[0].skeins === Math.ceil(expectCm / 4800), 'skeins: 2000 crosses on 14 count with 2 strands', [lg[0].lengthCm, lg[0].skeins]);
  ok(legend(est, { count: 14, waste: 0.2 })[0].lengthCm > lg[0].lengthCm, 'waste adds thread');
  ok(legend(est, { count: 11 })[0].lengthCm > legend(est, { count: 18 })[0].lengthCm, 'coarser fabric needs more thread');
  ok(legend(est, { count: 14, strands: 3 })[0].lengthCm > legend(est, { count: 14, strands: 2 })[0].lengthCm, 'more strands need more thread');
  const sh = shoppingList(s, { count: 14 });
  const s310 = sh.find((x) => x.code === '310');
  ok(s310 && near(s310.stitches, 1 + 0.5 + 0.5, 1e-9) && near(sh.find((x) => x.code === 'White').stitches, 0.5, 1e-9), 'shopping list splits blends between their threads', sh.map((x) => [x.code, x.stitches]));
  ok(sh.some((x) => x.code === 'White'), 'blend thread White appears on the shopping list', sh.map((x) => x.code));
  const fz = fabricSize(est, { count: 14, margin: 5 });
  ok(near(fz.finishedCm[0], 18.1, 0.05) && near(fz.fabricCm[0], 28.1, 0.05) && fz.finishedIn[0] === 7.1, 'fabric size with margins', fz);
  const st = stats(cs);
  ok(st.colors === cs.palette.length && st.difficulty >= 1 && st.difficulty <= 5 && st.hours[0] <= st.hours[1], 'statistics', st);

  // --- pages --------------------------------------------------------------------------------------------------------
  const pg = paginate(130, 90, { cols: 50, rows: 70, overlap: 2 });
  ok(pg.across === 3 && pg.down === 2 && pg.pages.length === 6, 'page grid', [pg.across, pg.down]);
  ok(pg.pages[1].x0 === 48 && pg.pages[1].ox0 === 2 && pg.pages[3].y0 === 68 && pg.pages[2].x1 === 130, 'overlap bands', pg.pages.map((p) => [p.x0, p.x1, p.y0, p.y1]));
  const covered = new Set();
  for (const p of pg.pages) for (let y = p.y0; y < p.y1; y++) for (let x = p.x0; x < p.x1; x++) covered.add(y * 130 + x);
  ok(covered.size === 130 * 90, 'pages cover the chart');
  ok(pageOf(pg.pages, 129, 89).n === 6, 'page of a cell');
  const capA4 = pageCapacity({ paper: 'a4', cellMm: 3 });
  ok(capA4.cols === 50 && capA4.rows === 80, 'A4 capacity at 3 mm cells', capA4);
  ok(pageCapacity({ paper: 'a4', cellMm: 3, landscape: true }).cols > capA4.cols, 'landscape pages are wider');

  // --- OXS ----------------------------------------------------------------------------------------------------------
  const ox = fromJSON(toJSON(s));
  ox.palette.forEach((e, i) => { e.symbol = SYMBOL_ORDER[i]; });
  const L = ox.layers[0];
  L.parts = [];
  addPart(L, { x: 7, y: 7, k: 'three', c: 'bl', p: 0 }); addPart(L, { x: 7, y: 7, k: 'three', c: 'tr', p: 1 });
  addPart(L, { x: 8, y: 7, k: 'three', c: 'tl', p: 1 }); addPart(L, { x: 9, y: 7, k: 'half', c: '\\', p: 2 });
  addPart(L, { x: 10, y: 7, k: 'quarter', c: 'br', p: 0 }); addPart(L, { x: 11, y: 7, k: 'petite', c: 'tl', p: 1 });
  L.lines.push({ x1: 1.5, y1: 2, x2: 4, y2: 2.5, p: 1, k: 'straight' });
  ox.meta.title = 'Röund <trip> & "quotes"'; ox.meta.designer = 'Тест';
  ox.fabric.count = 16; ox.fabric.color = '#f0eada';
  const xml = writeOXS(ox);
  ok(parseXML(xml) && /<chart>/.test(xml) && /palette_item index="0" number="cloth"/.test(xml), 'OXS is well-formed XML with a cloth entry');
  const rt = readOXS(xml);
  ok(rt.width === ox.width && rt.height === ox.height && rt.fabric.count === 16 && rt.fabric.color === '#f0eada', 'OXS round trip: size and fabric');
  ok(rt.meta.title === ox.meta.title && rt.meta.designer === 'Тест', 'OXS round trip: title and author', rt.meta);
  ok(rt.palette.length === 3 && rt.palette.every((e, i) => e.code === ox.palette[i].code && e.hex === ox.palette[i].hex && e.symbol === ox.palette[i].symbol), 'OXS round trip: palette and symbols', rt.palette.map((e) => [e.code, e.symbol]));
  ok(rt.palette[2].blend && rt.palette[2].blend.map((x) => x.code).join() === '310,White', 'OXS round trip: blend', rt.palette[2]);
  ok(flatten(rt).cells.join() === flatten(ox).cells.join(), 'OXS round trip: full stitches');
  const key = (p) => [p.x, p.y, p.k, p.c, p.p].join(':');
  ok(JSON.stringify(rt.layers[0].parts.map(key).sort()) === JSON.stringify(flatten(ox).parts.map(key).sort()), 'OXS round trip: part stitches', rt.layers[0].parts.map(key));
  ok(rt.layers[0].lines.length === 2 && rt.layers[0].lines.some((l) => l.k === 'straight' && l.x1 === 1.5 && l.y2 === 2.5), 'OXS round trip: back and straight stitches');
  ok(rt.layers[0].knots.length === 1 && rt.layers[0].beads.length === 1 && rt.layers[0].beads[0].x === 12.5, 'OXS round trip: knots and beads');
  // Ursa-style blends ("[+]") and tent stitches from other software.
  const ursa = '<?xml version="1.0"?><chart><properties chartwidth="4" chartheight="3" stitchesperinch="14"/><palette><palette_item index="0" number="cloth" color="FFFFFF"/>' +
    '<palette_item index="1" number="DMC 310[+]DMC 321" name="Black[+]Red" color="601818" blendcolor="C72B3B" strands="2" symbol="65"/></palette>' +
    '<fullstitches><stitch x="1" y="1" palindex="1"/></fullstitches><ornaments_inc_knots_and_beads><object x1="2" y1="2" palindex="1" objecttype="tent" direction="1"/></ornaments_inc_knots_and_beads></chart>';
  const us = readOXS(ursa);
  ok(us.palette[0].blend && us.palette[0].blend[1].code === '321' && us.palette[0].symbol === 'A' && us.layers[0].parts[0].c === '\\', 'OXS: Ursa-style blends, letters, tent stitches', us.palette[0]);
  let threw = false;
  try { readOXS('<root/>'); } catch { threw = true; }
  ok(threw, 'OXS: rejects other XML');

  // The PDF is verified structurally with inspectPDF (xref offsets, stream inflation, fonts, page count, extracted
  // text) because pixel comparison would need a PDF renderer in Node. The symbol count check (one Tj per stitch)
  // proves the chart is text in the Type 3 font rather than paths.
  // --- PDF ------------------------------------------------------------------------------------------------------------
  const pdfScheme = fromJSON(toJSON(cs));
  pdfScheme.meta.title = 'Chart test';
  pdfScheme.meta.designer = 'Дизайнер';
  addPart(pdfScheme.layers[0], { x: 2, y: 2, k: 'three', c: 'tl', p: 1 });
  pdfScheme.layers[0].knots.push({ x: 3, y: 3, p: 0 });
  const pdf = exportPDF(pdfScheme, { cellMm: 3, style: 'color' });
  const info = inspectPDF(pdf);
  ok(info.version === '1.5' && info.xrefOk, 'PDF: header and cross-reference offsets', info);
  ok(info.badStreams === 0 && info.streams > 5, 'PDF: every stream inflates');
  ok(info.pages === 1 + 1 + 2, 'PDF: cover, legend, two chart pages (60 columns on A4 at 3 mm: 50 per page)', info.pages);
  ok(info.fonts.includes('Type3') && info.fonts.includes('Helvetica') && info.fonts.includes('Helvetica-Bold') && info.type3Glyphs === SYMBOL_ORDER.length, 'PDF: symbol font and standard fonts', info.fonts);
  ok(info.images === 1, 'PDF: cover preview image');
  ok(info.text.some((t) => t === 'Chart test') && info.text.some((t) => t === 'Dizayner' || /Designer/.test(t)), 'PDF: titles as text, Cyrillic transliterated without a raster hook', info.text.slice(0, 6));
  ok(info.text.filter((t) => /^(\\0?[0-9]{2,3}|[!-~])$/.test(t)).length >= 60 * 45 - 50, 'PDF: one symbol glyph per stitch', info.text.length);
  ok(new TextDecoder('latin1').decode(pdf).includes('/ToUnicode'), 'PDF: symbol font has a ToUnicode map');
  const big = convertImage(img, { width: 140, maxColors: 10 }).scheme;
  const bigInfo = inspectPDF(exportPDF(big, { cellMm: 3, overlap: 2, cover: false }));
  ok(bigInfo.pages === 1 + 3 * 2 && bigInfo.xrefOk, 'PDF: pages split with overlap (140 × 105 on A4)', bigInfo.pages);
  let rasterCalls = 0;
  const pdf3 = exportPDF(pdfScheme, { labels: { key: 'Ключ' }, rasterText: (t, { size }) => { rasterCalls++; return { width: 10, height: 12, scale: 4, ascent: 9, alpha: new Uint8Array(120).fill(255) }; } });
  ok(rasterCalls > 0 && inspectPDF(pdf3).images > 1, 'PDF: labels in other scripts as image masks through the raster hook');
  ok(winAnsi('Größe – 5 €') && !winAnsi('Ключ') && transliterate('Щука ქართ') === 'Shchuka kart', 'WinAnsi encoding and transliteration', transliterate('Щука ქართ'));
  ok(near(textWidth('AB', 10), 13.34, 0.01) && near(textWidth('AB', 10, true), 14.44, 0.01), 'Helvetica metrics');
  ok(/^[\d. ]+m .* f$/.test(glyphOps(SYMBOLS.disc.d)), 'Type 3 glyph procedure');

  // fillPolygons is tested on the two cases that define the non-zero rule: same-direction nested contours merge
  // (area 100), a reversed inner contour is a hole (100 - 36 = 64).
  // --- pictures -------------------------------------------------------------------------------------------------------
  const svg = toSVG(cs, { cell: 10 });
  ok(parseXML(svg) && svg.includes('<use') && svg.includes('<defs>'), 'SVG chart is well-formed XML with shared symbols');
  const ras = rasterize(cs, { cell: 8 });
  ok(ras.width === 60 * 8 + 1 && ras.data.length === ras.width * ras.height * 4, 'rasterize size');
  const png = toPNG(cs, { cell: 8, mode: 'symbols' });
  const dpng = decodePNG(png);
  ok(dpng.width === ras.width && dpng.height === ras.height, 'PNG export decodes');
  const pr = previewRGBA(cs, { scale: 2 });
  ok(pr.width === 120 && pr.data[3] === 255, 'colour preview');
  const cov = fillPolygons(new Float32Array(100), 10, 10, [[[0, 0], [10, 0], [10, 10], [0, 10]], [[2, 2], [8, 2], [8, 8], [2, 8]]]);
  ok(near(cov.reduce((a, b) => a + b, 0), 100, 0.01), 'non-zero fill: same-direction contours merge');
  const cov2 = fillPolygons(new Float32Array(100), 10, 10, [[[0, 0], [10, 0], [10, 10], [0, 10]], [[2, 2], [2, 8], [8, 8], [8, 2]]]);
  ok(near(cov2.reduce((a, b) => a + b, 0), 64, 0.01), 'non-zero fill: reversed contour is a hole');

  // --- fonts and editing -------------------------------------------------------------------------------------------------
  const tb = textBitmap('Hi', { font: 'pixel' });
  ok(tb.height === 8 && tb.width > 4 && tb.bits.some(Boolean) && tb.missing.length === 0, 'stitch font text', tb);
  ok(textBitmap('Привіт', { font: 'pixel' }).missing.length === 0 && textBitmap('ЖАР 2026', { font: 'small' }).missing.length === 0, 'Cyrillic in the stitch fonts');
  ok(textBitmap('ქ', { font: 'pixel' }).missing[0] === 'ქ', 'missing glyphs are reported');
  const t2 = textBitmap('A', { scale: 2 });
  ok(t2.height === 16, 'font scale');
  ok(FONTS.pixel.glyphs.A.length === 8 && FONTS.small.glyphs.A.length === 5, 'font tables');
  ok(lineCells(0, 0, 3, 1).length === 4 && lineCells(2, 2, 2, 2).length === 1, 'Bresenham line');
  ok(rectCells(0, 0, 2, 2).length === 8 && rectCells(0, 0, 2, 2, { filled: true }).length === 9 && ellipseCells(0, 0, 6, 6, { filled: true }).length > 20, 'rectangles and ellipses');
  const e = createScheme({ width: 10, height: 10, palette: [threadEntry(findThread('dmc', '310')), threadEntry(findThread('dmc', '321'))] });
  ok(floodFill(e, 0, 0, 0, 0) === 100, 'flood fill everything');
  for (let i = 0; i < 10; i++) setCell(e, 5, i, 1);
  ok(floodFill(e, 0, 0, 0, -1) === 50, 'flood fill stops at a wall');
  ok(floodFill(e, 0, 9, 9, 1, { contiguous: false }) === 40, 'global replace');
  const clip = copyRegion(e, 0, { x0: 4, y0: 0, x1: 7, y1: 2 });
  ok(clip.w === 3 && clip.h === 2 && clip.cells.join() === '0,2,2,0,2,2', 'copy region', [...clip.cells]);
  const tc = transformClip(clip, 'r90');
  ok(tc.w === 2 && tc.h === 3, 'rotate clip');
  clearRegion(e, 0, { x0: 0, y0: 0, x1: 10, y1: 10 });
  ok(e.layers[0].cells.every((v) => !v), 'clear region');
  pasteClip(e, 0, clip, 0, 0);
  ok(cellAt(e, 1, 0) === 1 && cellAt(e, 0, 0) === -1, 'paste clip (transparent)');
  const other = createScheme({ width: 5, height: 5, palette: [threadEntry(findThread('dmc', '666'))] });
  pasteClip(other, 0, clip, 0, 0);
  ok(other.palette.length === 2 && other.palette[1].code === '321' && cellAt(other, 1, 0) === 1, 'paste across schemes adds the thread');
  const tclip = textClip('Ab', 0);
  ok(tclip.w > 5 && tclip.cells.some((v) => v === 1), 'text clip');
  const h = createHistory({ limit: 3 });
  const hs = createScheme({ width: 4, height: 4, palette: [threadEntry(findThread('dmc', '310'))] });
  h.push(hs, 'a'); setCell(hs, 0, 0, 0);
  h.push(hs, 'b'); setCell(hs, 1, 0, 0);
  const u1 = h.undo(hs);
  ok(u1 && cellAt(u1, 0, 0) === 0 && cellAt(u1, 1, 0) === -1, 'undo restores');
  const r1 = h.redo(u1);
  ok(r1 && cellAt(r1, 1, 0) === 0 && !h.canRedo, 'redo restores');
  for (let i = 0; i < 5; i++) h.push(hs, 'x' + i);
  ok(h.size === 3, 'history limit');

  console.log(`stitch: ${passed} passed, ${failed} failed`);
  return failed;
}

// Direct execution check that works on Windows paths too (compare resolved file paths, not URLs).
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = run() ? 1 : 0;
