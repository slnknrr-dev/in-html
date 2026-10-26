// icon-creator/test.js - unit tests of the icon document and the pixel operations (no DOM): `node icon-creator/test.js`
// (importing the module runs nothing).
//
// Why this shape: run() is exported so a repository-wide runner can import every app's tests and aggregate the counts;
// the isMain guard runs it only when the file is the node entry point. Assertions are small hand-written checks
// (no framework, no dependencies) that print only failures, so a green run is quiet. The cases target invariants a
// refactor is most likely to break: alpha blending, mirror symmetry, Bresenham endpoints, mask algebra (including
// the "empty = null" normalisation), history symmetry and the project/ICO round trips.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeICO, icoInfo } from '../ico/ico.js';
import {
  MASTER, SIZES, createDoc, cropSquare, exportICO, imageOf, importICO, loadProject, makeAuto, makeCustom, record, redo,
  regenerate, saveProject, setMaster, undo,
} from './doc.js';
import { blank, combineMask, dab, ellipsePoints, fill, invertMask, linePoints, outline, plot, rectMask, rgba, shift } from './paint.js';

// Compare resolved paths, not strings: argv[1] may be relative or use the other slash direction on Windows.
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const px = (img, x, y) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

export async function run() {
  let pass = 0, fail = 0;
  const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('x icon-creator: ' + msg); } };

  // --- paint
  const a = blank(8);
  plot(a, 1, 1, [255, 0, 0, 255]);
  ok(px(a, 1, 1).join() === '255,0,0,255', 'plot');
  plot(a, 1, 1, [0, 0, 255, 128]);
  ok(px(a, 1, 1)[2] > 120 && px(a, 1, 1)[0] > 120 && px(a, 1, 1)[3] === 255, 'over blending');
  dab(a, 2, 5, 1, [0, 255, 0, 255], 'over', null, 'x');
  ok(px(a, 5, 5)[1] === 255, 'mirror x');
  ok(linePoints(0, 0, 3, 3).length === 4 && linePoints(0, 0, 5, 2).length === 6, 'line points');
  ok(ellipsePoints(0, 0, 6, 6, true).length > ellipsePoints(0, 0, 6, 6, false).length, 'filled ellipse covers more');
  const b = blank(6);
  fill(b, 0, 0, [9, 9, 9, 255]);
  ok(b.data.every((v, i) => (i % 4 === 3 ? v === 255 : v === 9)), 'bucket fill of an empty image');
  const m = rectMask(6, 1, 1, 2, 2);
  ok(m.filter((v) => v).length === 4, 'rect mask');
  ok(combineMask(m, rectMask(6, 2, 2, 3, 3), 'intersect').filter((v) => v).length === 1, 'intersect');
  ok(combineMask(m, m, 'subtract') === null, 'subtract to nothing');
  ok(invertMask(m, 6).filter((v) => v).length === 32, 'invert');
  const c = blank(6);
  plot(c, 0, 0, [1, 2, 3, 255]);
  shift(c, 2, 1);
  ok(px(c, 2, 1).join() === '1,2,3,255' && px(c, 0, 0)[3] === 0, 'shift');
  const o = blank(5);
  plot(o, 2, 2, [0, 0, 0, 255]);
  ok(outline(o, [255, 255, 255, 255]) === 4, 'outline adds four neighbours');
  ok(rgba('#102030', 7).join() === '16,32,48,7', 'rgba');

  // --- document: sizes follow the master unless drawn by hand
  const doc = createDoc();
  ok(SIZES.length === 5 && SIZES.includes(32) && SIZES.includes(256), 'five sizes 32..256');
  const red = blank(256);
  for (let i = 0; i < red.data.length; i += 4) red.data.set([220, 20, 30, 255], i);
  record(doc, MASTER, 'import');
  setMaster(doc, red);
  ok(px(imageOf(doc, 32), 10, 10).join() === '220,20,30,255', 'automatic size follows the master');
  record(doc, 32, 'custom');
  makeCustom(doc, 32);
  plot(imageOf(doc, 32), 0, 0, [0, 0, 255, 255]);
  record(doc, MASTER, 'clear');
  doc.master.data.fill(0);
  regenerate(doc);
  ok(px(imageOf(doc, 32), 0, 0).join() === '0,0,255,255' && px(imageOf(doc, 48), 5, 5)[3] === 0, 'custom size keeps its pixels');
  undo(doc);
  ok(px(imageOf(doc, 48), 5, 5).join() === '220,20,30,255', 'undo of a master change');
  redo(doc);
  ok(px(imageOf(doc, 48), 5, 5)[3] === 0, 'redo');
  undo(doc); undo(doc);
  ok(!doc.sizes[32].custom, 'undo of make-custom');
  record(doc, 32, 'custom'); makeCustom(doc, 32); makeAuto(doc, 32);
  ok(!doc.sizes[32].custom && px(imageOf(doc, 32), 0, 0)[0] === 220, 'back to automatic');

  // --- crop of a large, non-square picture (the square may reach outside: transparent)
  const pic = { width: 600, height: 300, data: new Uint8ClampedArray(600 * 300 * 4).fill(255) };
  const sq = cropSquare(pic, { x: -150, y: 0, size: 300 }, 64);
  ok(sq.width === 64 && px(sq, 2, 30)[3] === 0 && px(sq, 40, 30)[3] === 255, 'square crop outside the picture is transparent');

  // --- export / import .ico, project round trip
  doc.sizes[64].on = false;
  const ico = exportICO(doc);
  const info = icoInfo(ico);
  ok(info.length === 4 && !info.some((e) => e.width === 64), 'disabled sizes are left out');
  ok(info.find((e) => e.width === 256).png && !info.find((e) => e.width === 32).png, '256 as PNG, small sizes as BMP');
  const d2 = createDoc();
  record(doc, 32, 'custom'); makeCustom(doc, 32); plot(imageOf(doc, 32), 3, 3, [0, 255, 0, 255]);
  importICO(d2, exportICO(doc));
  ok(d2.sizes[32].custom && px(imageOf(d2, 32), 3, 3).join() === '0,255,0,255', '.ico import keeps a hand-drawn size');
  ok(decodeICO(exportICO(d2)).length === 5, 'every enabled size exported');
  const d3 = loadProject(saveProject(doc));
  ok(!d3.sizes[64].on && d3.sizes[32].custom && px(imageOf(d3, 32), 3, 3).join() === '0,255,0,255' && px(d3.master, 100, 100).join() === '220,20,30,255', 'project round trip');
  let threw = false;
  try { loadProject('{"format":"other"}'); } catch { threw = true; }
  ok(threw, 'foreign JSON is refused');

  console.log(`icon-creator: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
