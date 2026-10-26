// photo/test.js - unit tests of the photo editor core: `node photo/test.js` (importing the module runs nothing).
// Selections (shapes, combining, invert, feather, flood fill, contours), history, the document command (structure,
// quoting, files, script form) and the project format. Where ImageMagick 7 is installed, every adjustment and filter
// runs through `magick` with its generated arguments and is compared with the JS result (exact steps up to
// rounding), and whole layered documents (a background recipe, pixel layers with masks, opacity and every blend mode,
// adjustment layers with masks, opaque and transparent backdrops, text and shapes) run as the generated command -
// spawned without a shell, typed into bash and cmd.exe, saved as .sh / .bat, and as the script of steps - and are
// compared with a flatten done the editor's way (W3C compositing as the canvas does it; photo/README.md has the
// numbers of the in-browser comparison with the editor's own canvas flatten).

//
// Why the ImageMagick cross-check: the 'exact' fidelity label is a promise to the user; the only honest proof is to
// run the generated argv through the real binary and diff pixels. Tests that need magick or bash skip (not fail) when
// the tool is absent, so the suite stays runnable on any machine while CI with ImageMagick enforces the claim.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodePNG } from '../png/decode.js';
import { encodePNG } from '../png/encode.js';
import { findBash, findMagick, magickRun, magickShellEnv, pixelDiff, synthImage, withinFidelity } from '../raster/test.js';
import { cropImage, flip as flipImage } from '../raster/ops.js';
import { resize } from '../raster/resample.js';
import { plainArgv } from '../ffcmd/command.js';
import { ADJUSTMENTS, FILTERS, adjustmentStep, applyAdjustment, applyFilter, curveAt, curveSpline, filterStep, isIdentity } from './adjust.js';
import { combine, contours, coverage, ellipseSelection, feather, floodSelection, invert, polygonSelection, rectSelection, selectAll, translate, trim } from './select.js';
import { createHistory } from './history.js';
import { BLENDS_IM, blendArgs, commandText, docCommand, imFamily, mergeStep, scriptFile, shapeMvg } from './magick.js';
import { projectManifest, readManifest } from './project.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const copy = (img) => ({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) });
const flat = (step) => step.args.flat();

export async function run() {
  let pass = 0, fail = 0;
  const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${info}`); } };
  const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);

  // --- selections
  {
    const r = rectSelection({ x: 2, y: 3, w: 4, h: 2 }, 10, 10);
    eq('rect box', [r.x, r.y, r.w, r.h], [2, 3, 4, 2]);
    ok('rect full', r.data.every((v) => v === 255));
    const half = rectSelection({ x: 1.5, y: 1, w: 2, h: 1 }, 10, 10);
    eq('rect partial edges', [...half.data], [128, 255, 128]);
    const all = selectAll(8, 6);
    eq('select all', [all.w, all.h, all.data.length], [8, 6, 48]);
    const p = polygonSelection([[0, 0], [10, 0], [10, 10], [0, 10]], 20, 20);
    ok('polygon square', p.w === 10 && p.h === 10 && p.data.every((v) => v === 255), JSON.stringify([p.x, p.y, p.w, p.h]));
    const tri = polygonSelection([[0, 0], [8, 0], [0, 8]], 20, 20);
    ok('polygon triangle area', Math.abs([...tri.data].reduce((a, b) => a + b, 0) / 255 - 32) < 1.5);
    const e = ellipseSelection({ x: 0, y: 0, w: 20, h: 20 }, 40, 40);
    ok('ellipse area', Math.abs([...e.data].reduce((a, b) => a + b, 0) / 255 - Math.PI * 100) < 4);
    const a = rectSelection({ x: 0, y: 0, w: 6, h: 6 }, 20, 20), b = rectSelection({ x: 3, y: 3, w: 6, h: 6 }, 20, 20);
    const add = combine(a, b, 'add'), sub = combine(a, b, 'subtract'), int = combine(a, b, 'intersect');
    eq('add box', [add.x, add.y, add.w, add.h], [0, 0, 9, 9]);
    ok('add holes', coverage(add, 7, 1) === 0 && coverage(add, 7, 7) === 255 && coverage(add, 1, 1) === 255);
    ok('subtract', coverage(sub, 4, 4) === 0 && coverage(sub, 1, 1) === 255 && coverage(sub, 5, 1) === 255);
    eq('intersect box', [int.x, int.y, int.w, int.h], [3, 3, 3, 3]);
    eq('intersect empty', combine(rectSelection({ x: 0, y: 0, w: 2, h: 2 }, 9, 9), rectSelection({ x: 5, y: 5, w: 2, h: 2 }, 9, 9), 'intersect'), null);
    const inv = invert(a, 10, 10);
    ok('invert', coverage(inv, 1, 1) === 0 && coverage(inv, 8, 8) === 255 && inv.w === 10);
    const f = feather(a, 2, 20, 20);
    ok('feather grows soft', f.w > 6 && coverage(f, 3, 3) > 200 && coverage(f, 7, 3) > 0 && coverage(f, 7, 3) < 128);
    const t = translate(a, 3, 2, 20, 20);
    eq('translate', [t.x, t.y], [3, 2]);
    eq('trim empty', trim({ x: 0, y: 0, w: 2, h: 2, data: new Uint8Array(4) }), null);
    // flood fill: two regions split by a line
    const img = { width: 10, height: 6, data: new Uint8ClampedArray(240) };
    for (let i = 0; i < 60; i++) { const x = i % 10; const v = x === 4 ? 0 : x < 4 ? 200 : 205; img.data.set([v, v, v, 255], i * 4); }
    const fl = floodSelection(img, 1, 1, 10, { antialias: false });
    eq('flood contiguous', [fl.x, fl.y, fl.w, fl.h], [0, 0, 4, 6]);
    const fg = floodSelection(img, 1, 1, 10, { contiguous: false, antialias: false });
    eq('flood global', [fg.x, fg.w], [0, 10]);
    ok('flood global skips line', coverage(fg, 4, 2) === 0 && coverage(fg, 7, 2) === 255);
    const loops = contours(rectSelection({ x: 2, y: 2, w: 3, h: 2 }, 10, 10));
    eq('contour rect', loops.length === 1 ? loops[0].length : -1, 5);
    const ring = combine(rectSelection({ x: 0, y: 0, w: 9, h: 9 }, 20, 20), rectSelection({ x: 3, y: 3, w: 3, h: 3 }, 20, 20), 'subtract');
    eq('contour ring', contours(ring).length, 2);
  }

  // --- curves
  {
    const id = curveSpline([[0, 0], [255, 255]]);
    ok('identity curve', [0, 0.3, 1].every((v) => Math.abs(curveAt(id, v) - v) < 1e-9));
    const s = curveSpline([[0, 0], [64, 40], [192, 215], [255, 255]]);
    let mono = true, prev = -1;
    for (let v = 0; v <= 1; v += 1 / 255) { const y = curveAt(s, v); if (y < prev - 1e-9) mono = false; prev = y; }
    ok('monotone curve', mono);
    ok('identity params', isIdentity('curves', ADJUSTMENTS.curves.defaults) && isIdentity('levels', {}) && !isIdentity('invert', {}));
  }

  // --- history
  {
    let v = 0;
    const changes = [];
    const hst = createHistory({ budget: 100, onChange: () => changes.push(hst.index) });
    const step = (to, bytes = 10) => { const from = v; v = to; hst.push({ label: 'set ' + to, undo: () => { v = from; }, redo: () => { v = to; }, bytes }); };
    step(1); step(2); step(3);
    hst.undo(); eq('undo', v, 2);
    hst.undo(); hst.redo(); eq('redo', v, 2);
    step(9); eq('push drops redo', [hst.entries.length, hst.canRedo], [3, false]);
    hst.jump(0); eq('jump', v, 1);
    hst.jump(hst.entries.length - 1); eq('jump forward', v, 9);
    for (let i = 0; i < 20; i++) step(i, 30);
    ok('budget trims', hst.bytes <= 100 && hst.entries.length < 10, `${hst.bytes} ${hst.entries.length}`);
    ok('change events', changes.length > 10);
  }

  // --- document command: structure
  structureTests(ok, eq);

  // --- project manifest
  {
    const doc = { width: 30, height: 20, bgId: 1, activeId: 2, recipe: { source: { name: 'a.png', steps: [] }, steps: [], painted: {} }, layers: [{ id: 1, kind: 'raster', name: 'B', visible: true, opacity: 1, blend: 'normal', x: 0, y: 0, w: 30, h: 20, mask: null }, { id: 2, kind: 'adjust', name: 'Inv', visible: false, opacity: 0.5, blend: 'normal', adjust: { type: 'invert', params: {} }, mask: { enabled: true, w: 30, h: 20 } }] };
    const m = projectManifest(doc);
    eq('manifest files', m.layers.map((l) => [l.file || null, l.mask ? l.mask.file : null]), [['layers/1.png', null], [null, 'masks/2.png']]);
    const back = readManifest(JSON.parse(JSON.stringify(m)));
    eq('manifest round trip', [back.width, back.layers.length, back.layers[1].opacity, back.layers[1].adjust.type, back.activeId], [30, 2, 0.5, 'invert', 2]);
    let bad = false;
    try { readManifest({ format: 'other' }); } catch { bad = true; }
    ok('manifest rejects other formats', bad);
  }

  // --- adjustments and filters against ImageMagick
  const exe = findMagick();
  if (!exe) console.log('photo: ImageMagick 7 not found, magick comparisons skipped');
  else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-magick-'));
    const img = synthImage(181, 123, false, 5);
    const cases = [
      ['brightnessContrast', { brightness: 20, contrast: 0 }], ['brightnessContrast', { brightness: -15, contrast: 35 }], ['brightnessContrast', { brightness: 10, contrast: -40 }],
      ['levels', { inBlack: 20, inWhite: 230, gamma: 1.3, outBlack: 0, outWhite: 255 }], ['levels', { inBlack: 0, inWhite: 255, gamma: 0.8, outBlack: 30, outWhite: 220 }],
      ['curves', { rgb: [[0, 0], [70, 45], [190, 215], [255, 255]] }], ['curves', { rgb: [[0, 20], [255, 235]], r: [[0, 0], [128, 160], [255, 255]], b: [[0, 30], [255, 255]] }],
      ['hueSaturation', { hue: 40, saturation: 30, lightness: 0 }], ['hueSaturation', { hue: -90, saturation: -50, lightness: 15 }],
      ['invert', {}], ['blackWhite', {}], ['threshold', { level: 140 }], ['posterize', { levels: 5 }],
      ['colorBalance', { shadows: [30, -10, 0], midtones: [0, 25, -20], highlights: [-15, 0, 40], preserve: true }], ['colorBalance', { shadows: [0, 0, 0], midtones: [40, 0, -30], highlights: [0, 0, 0], preserve: false }],
    ];
    for (const [type, p] of cases) {
      const st = adjustmentStep(type, p);
      let im;
      try { im = magickRun(exe, dir, img, flat(st), type); } catch (e) { ok(type, false, e.message); continue; }
      const d = pixelDiff(applyAdjustment(type, copy(img), p), im);
      ok(`adjust ${type} ${JSON.stringify(p)} [${st.fidelity}]`, withinFidelity(d, st.fidelity), JSON.stringify(d) + ' ' + flat(st).join(' ').slice(0, 200));
    }
    for (const [type, p] of [['gaussianBlur', { radius: 1.5 }], ['gaussianBlur', { radius: 6 }], ['unsharp', { amount: 150, radius: 1.2, threshold: 0 }], ['unsharp', { amount: 80, radius: 2, threshold: 10 }], ['pixelate', { size: 8 }], ['pixelate', { size: 7 }], ['noise', { amount: 10 }]]) {
      const size = { w: img.width, h: img.height };
      const st = filterStep(type, p, size);
      let im;
      try { im = magickRun(exe, dir, img, flat(st), type); } catch (e) { ok(type, false, e.message); continue; }
      const d = pixelDiff(applyFilter(type, img, p), im);
      // noise is random on both sides: only the size and a similar strength are checked
      const good = type === 'noise' ? !d.size && d.mean < 40 : withinFidelity(d, st.fidelity);
      ok(`filter ${type} ${JSON.stringify(p)} [${st.fidelity}]`, good, JSON.stringify(d) + ' ' + flat(st).join(' '));
    }
    ok('pixelate exact when divisible', filterStep('pixelate', { size: 8 }, { w: 160, h: 120 }).fidelity === 'exact');
    void FILTERS;
    fs.rmSync(dir, { recursive: true, force: true });
    await documentTests(exe, ok);
  }
  console.log(`photo: ${pass} passed, ${fail} failed`);
  return fail;
}

// --- the document command ---------------------------------------------------------------------------------------------

const lay = (o) => ({ visible: true, opacity: 1, blend: 'normal', mask: null, x: 0, y: 0, ...o });
const words = (c) => plainArgv(c.argv).flat();

function structureTests(ok, eq) {
  const doc = {
    width: 400, height: 300, bgId: 1,
    recipe: { source: { name: 'my photo.jpg', steps: [{ id: 'autoOrient', args: [['-auto-orient']], fidelity: 'exact', label: 'Auto-orient' }] }, steps: [{ id: 'crop', seq: 4, args: [['-crop', '400x300+10+20', '+repage']], fidelity: 'exact', label: 'Crop' }], painted: {} },
    layers: [
      lay({ id: 1, kind: 'raster', name: 'Background', w: 400, h: 300, opaque: true }),
      lay({ id: 2, kind: 'adjust', name: 'Levels', adjust: { type: 'levels', params: { inBlack: 10, inWhite: 240, gamma: 1.2, outBlack: 0, outWhite: 255 } } }),
      lay({ id: 3, kind: 'text', name: 'Title', text: { value: 'Hi % there', size: 32, family: 'Arial', weight: 700, italic: false, color: '#ff0000', align: 'left', lineHeight: 1.2 }, x: 20, y: 30, rotation: 0 }),
      lay({ id: 4, kind: 'shape', name: 'Box', shape: { type: 'rect', w: 50, h: 40, fill: '#00ff00', stroke: null, strokeWidth: 0, radius: 0 }, x: 100, y: 100, rotation: 0 }),
    ],
  };
  const c = docCommand(doc, { format: 'png', output: 'out.png' });
  const all = words(c);
  ok('doc command parts', ['-auto-orient', '-crop', '-level', '-annotate', '-draw'].every((w) => all.includes(w)) && all[1] === 'my photo.jpg' && all[all.length - 1] === 'out.png', all.join(' '));
  ok('doc command reads no files', c.assets.length === 0, JSON.stringify(c.assets));
  ok('annotate escapes %', all.includes('Hi %% there'));
  ok('levels on colour channels', all.join(' ').includes('-channel RGB -level 3.9216%,94.1176%,1.2 -clamp +channel'));
  ok('shape on whole pixels', all.includes('rectangle 100,100 149,139'), all.join(' '));
  ok('recipe refs', c.ops.get('L1').map((o) => o.key).join() === 'source,step,step' && commandText(c, 'bash').pieces.some((p) => p.ref === 'L1:s4'));
  ok('text approximate', c.fidelity === 'approx' && c.notes.some((n) => n.code === 'fonts'));
  // painted background, pixel layer with a mask, blend modes
  doc.recipe.painted = { brush: 2 };
  doc.layers.push(lay({ id: 5, kind: 'raster', name: 'Layer 1', w: 400, h: 300, blend: 'screen', opacity: 0.5, mask: { enabled: true } }), lay({ id: 6, kind: 'raster', name: 'Layer 1', w: 400, h: 300, blend: 'hue' }), lay({ id: 7, kind: 'raster', name: 'Слой 2', w: 400, h: 300 }));
  const c2 = docCommand(doc, { format: 'jpeg', quality: 80, output: 'out.jpg' });
  eq('files', c2.assets.map((a) => a.name), ['background.png', 'layer-1.png', 'layer-1-mask.png', 'layer-1-2.png', 'layer-2.png']);
  ok('painted note', c2.notes.some((n) => n.code === 'painted' && n.vars.counts.brush === 2));
  const t2 = words(c2).join(' ');
  ok('mask and opacity', t2.includes('( layer-1.png -alpha set ( layer-1-mask.png -alpha copy ) -compose DstIn -composite -channel A -evaluate multiply 0.5 +channel ) -channel RGB -fx u+v.a*((u+v-u*v)-u) +channel'), t2);
  ok('hue blend as -fx', /layer-1-2.png -channel RGB -fx S*smx=/.test(t2) && c2.notes.some((n) => n.code === 'blendHcl'), t2);
  ok('jpeg output', t2.endsWith('-compose Over -background white -alpha remove -alpha off -quality 80 -strip out.jpg'), t2.slice(-120));
  // quoting in both shells, the script
  const bash = commandText(c2, 'bash').text, cmd = commandText(c2, 'cmd').text, bat = commandText(c2, 'cmd', { batch: true }).text;
  ok('bash parentheses', bash.includes('\\( layer-1.png') && bash.includes("'u+v.a*((u+v-u*v)-u)'") && bash.split('\n').length === c2.argv.length, bash);
  ok('cmd quoting', cmd.includes('"(" layer-1.png') && cmd.includes(' ^\n') && cmd.includes('"Hi %% there"') && bat.includes('"Hi %%%% there"'), cmd);
  const sc = commandText(c2, 'bash', { form: 'steps' }).text;
  ok('script steps', c2.steps.length === 7 && c2.temps.length === 6 && sc.startsWith('# Background\nmagick background.png') && sc.endsWith('rm -f ' + c2.temps.join(' ')), sc);
  ok('script files', scriptFile(c2, 'bash').startsWith('#!/usr/bin/env bash\n# ImageMagick 7\nset -e\n') && scriptFile(c2, 'cmd').startsWith('@echo off\r\nREM ') && scriptFile(c2, 'cmd', { form: 'steps' }).includes('\r\ndel step-01.miff'));
  // canvas base, blank source, blends, fonts, shapes, merging
  const blank = docCommand({ width: 64, height: 32, bgId: 1, recipe: { source: { blank: '#ffffff', w: 64, h: 32 }, steps: [], painted: {} }, layers: [lay({ id: 1, kind: 'raster', name: 'Background', w: 64, h: 32 })] });
  ok('blank source', words(blank).slice(0, 4).join(' ') === 'magick -size 64x32 xc:#ffffff', words(blank).join(' '));
  const half = docCommand({ width: 64, height: 32, bgId: null, layers: [lay({ id: 1, kind: 'raster', name: 'A', w: 64, h: 32, opacity: 0.5 }), lay({ id: 2, kind: 'raster', name: 'B', w: 64, h: 32, blend: 'multiply' })] });
  ok('transparent canvas base', words(half).slice(0, 4).join(' ') === 'magick -size 64x32 xc:none' && words(half).join(' ').includes('channel(mix,mix,mix,0,ko)'), words(half).join(' '));
  eq('blend kinds', ['normal', 'multiply', 'screen', 'hue'].map((b) => blendArgs(b, true).kind), ['compose', 'compose', 'fx', 'fx']);
  eq('blend kinds over transparency', ['overlay', 'multiply', 'darken'].map((b) => blendArgs(b, false).kind), ['compose', 'fxAlpha', 'fxAlpha']);
  ok('every blend mode mapped', Object.keys(BLENDS_IM).length === 16);
  eq('font families', ['system-ui', '"Times New Roman", serif', 'monospace', 'Georgia'].map(imFamily), ['Segoe UI', 'Times New Roman', 'Courier New', 'Georgia']);
  const sh = (o) => shapeMvg(lay({ kind: 'shape', x: 10, y: 20, rotation: 0, ...o, shape: { type: 'rect', w: 50, h: 40, fill: '#000000', stroke: null, strokeWidth: 0, radius: 0, ...o.shape } }));
  eq('shape mvg', [sh({}), sh({ shape: { type: 'ellipse' } }), sh({ shape: { stroke: '#fff', strokeWidth: 2 } }), sh({ rotation: 90 })],
    ['rectangle 10,20 59,59', 'stroke-linecap round stroke-linejoin round ellipse 34.5,39.5 25,20 0,360', 'stroke-linecap round stroke-linejoin round rectangle 9.5,19.5 59.5,59.5',
      'stroke-linecap round stroke-linejoin round translate 34.5,39.5 rotate 90 rectangle -25,-20 25,20']);
  const ms = mergeStep(doc.layers[2], doc);
  ok('merge step of text', ms && ms.args[0].includes('-annotate') && !ms.args[0].includes('('), JSON.stringify(ms));
  ok('merge step needs no mask', mergeStep(lay({ id: 9, kind: 'adjust', adjust: { type: 'invert', params: {} }, mask: { enabled: true } }), doc) === null);
}

// Compositing the editor's way (W3C, as the canvas does it): blend functions and source-over with alpha.
const SEP = {
  normal: (b, s) => s, multiply: (b, s) => b * s, screen: (b, s) => b + s - b * s, overlay: (b, s) => SEP['hard-light'](s, b), darken: Math.min, lighten: Math.max,
  'color-dodge': (b, s) => (b === 0 ? 0 : s === 1 ? 1 : Math.min(1, b / (1 - s))), 'color-burn': (b, s) => (b === 1 ? 1 : s === 0 ? 0 : 1 - Math.min(1, (1 - b) / s)),
  'hard-light': (b, s) => (s <= 0.5 ? b * 2 * s : SEP.screen(b, 2 * s - 1)),
  'soft-light': (b, s) => { if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b); const D = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b); return b + (2 * s - 1) * (D - b); },
  difference: (b, s) => Math.abs(b - s), exclusion: (b, s) => b + s - 2 * b * s,
};
const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
const clipColor = (c) => { const l = lum(c), n = Math.min(...c), x = Math.max(...c); let o = [...c]; if (n < 0) o = o.map((v) => l + ((v - l) * l) / (l - n)); if (x > 1) o = o.map((v) => l + ((v - l) * (1 - l)) / (x - l)); return o; };
const setLum = (c, l) => { const d = l - lum(c); return clipColor(c.map((v) => v + d)); };
const sat = (c) => Math.max(...c) - Math.min(...c);
const setSat = (c, s) => { const mx = Math.max(...c), mn = Math.min(...c); return mx <= mn ? [0, 0, 0] : c.map((v) => ((v - mn) * s) / (mx - mn)); };
const NONSEP = { hue: (b, s) => setLum(setSat(s, sat(b)), lum(b)), saturation: (b, s) => setLum(setSat(b, sat(s)), lum(b)), color: (b, s) => setLum(s, lum(b)), luminosity: (b, s) => setLum(b, lum(s)) };
function composite(back, src, mode) {
  const out = { width: back.width, height: back.height, data: new Uint8ClampedArray(back.data.length) };
  for (let p = 0; p < out.data.length; p += 4) {
    const ab = back.data[p + 3] / 255, as = src.data[p + 3] / 255;
    const cb = [0, 1, 2].map((i) => back.data[p + i] / 255), cs = [0, 1, 2].map((i) => src.data[p + i] / 255);
    const bl = NONSEP[mode] ? NONSEP[mode](cb, cs) : cb.map((v, i) => (SEP[mode] || SEP.normal)(v, cs[i]));
    const ao = as + ab * (1 - as);
    for (let i = 0; i < 3; i++) out.data[p + i] = ao > 0 ? Math.round(((as * ((1 - ab) * cs[i] + ab * bl[i]) + (1 - as) * ab * cb[i]) / ao) * 255) : 0;
    out.data[p + 3] = Math.round(ao * 255);
  }
  return out;
}
/** The document flattened like photo/render.js: pix: Map(layer id -> { img (document size), mask (grey bytes) }). */
function referenceFlatten(doc, pix) {
  let out = { width: doc.width, height: doc.height, data: new Uint8ClampedArray(doc.width * doc.height * 4) };
  for (const L of doc.layers) {
    if (!L.visible || L.opacity <= 0) continue;
    const m = L.mask && L.mask.enabled ? pix.get(L.id).mask : null;
    const k = (i) => L.opacity * (m ? m[i] / 255 : 1);
    if (L.kind === 'adjust') {
      const after = applyAdjustment(L.adjust.type, copy(out), L.adjust.params), d = out.data;
      for (let i = 0, p = 0; p < d.length; i++, p += 4) for (let c = 0; c < 3; c++) d[p + c] = Math.round(d[p + c] + (after.data[p + c] - d[p + c]) * k(i));
      continue;
    }
    const src = copy(pix.get(L.id).img);
    for (let i = 0, p = 3; p < src.data.length; i++, p += 4) src.data[p] = Math.round(src.data[p] * k(i));
    out = composite(out, src, L.blend);
  }
  return out;
}
const grey = (w, h, fn) => { const g = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = Math.round(255 * Math.max(0, Math.min(1, fn(x / (w - 1), y / (h - 1))))); return g; };
const greyPNG = (g, w, h) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < g.length; i++) d.set([g[i], g[i], g[i], 255], i * 4); return encodePNG({ width: w, height: h, data: d }, { level: 1 }); };
const decode = (bytes) => { const d = decodePNG(new Uint8Array(bytes)); return { width: d.width, height: d.height, data: d.data }; };
const alphaScaled = (img, fn) => { const o = copy(img); for (let i = 0; i < o.width * o.height; i++) o.data[i * 4 + 3] = Math.round(o.data[i * 4 + 3] * fn(i % o.width, Math.floor(i / o.width))); return o; };

async function documentTests(exe, ok) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-doc-'));
  const W = 120, H = 75;
  // Writes the files a command reads, runs its argv without a shell, returns the decoded output.
  const files = (dir, c, pix, extra = {}) => {
    fs.mkdirSync(dir, { recursive: true });
    for (const [n, bytes] of Object.entries(extra)) fs.writeFileSync(path.join(dir, n), bytes);
    for (const a of c.assets) {
      const p = pix.get(a.layerId);
      fs.writeFileSync(path.join(dir, a.name), a.kind === 'mask' ? greyPNG(p.mask, W, H) : encodePNG(p.img, { level: 1 }));
    }
  };
  const runArgv = (dir, c) => {
    const argv = plainArgv(c.argv).flat();
    const r = spawnSync(exe, argv.slice(1), { cwd: dir, encoding: 'utf8', timeout: 300000 });
    if (r.status !== 0) throw new Error((r.stderr || '').slice(0, 500));
    return decode(fs.readFileSync(path.join(dir, c.output)));
  };
  const numbers = [];
  const check = (label, dir, doc, pix, extra, want) => {
    const c = docCommand(doc, { output: 'out.png' });
    files(dir, c, pix, extra);
    let got;
    try { got = runArgv(dir, c); } catch (e) { ok(label, false, e.message); return null; }
    const ref = referenceFlatten(doc, pix);
    const d = pixelDiff(ref, got);
    numbers.push(label + ' ' + JSON.stringify(d));
    ok(`${label} [${c.fidelity}]`, want ? want(d, c) : withinFidelity(d, c.fidelity) && c.fidelity === 'exact', JSON.stringify(d) + '\n  ' + words(c).join(' ').slice(0, 600));
    return { c, got };
  };

  // 1. A background recipe (source file, crop, resize, flop) under pixel layers with masks, opacity and blend modes and
  //    adjustment layers (direct, with a mask, with opacity): the whole command must reproduce the flatten exactly.
  const src = synthImage(181, 123, false, 5);
  const bg = flipImage(resize(cropImage(src, { x: 10, y: 12, w: 160, h: 100 }), W, H, 'lanczos3'), true, false);
  const m1 = grey(W, H, (x, y) => (x + y) / 2), m2 = grey(W, H, (x, y) => 1 - x * 0.8 - (y > 0.5 ? 0.2 : 0));
  const px = (seed, alpha = true) => alphaScaled(synthImage(W, H, alpha, seed), (x, y) => 0.35 + 0.65 * (y / (H - 1)));
  const pix = new Map([[1, { img: bg }], [2, { img: px(8), mask: m1 }], [3, { img: px(13) }], [5, { mask: m2 }], [6, { img: px(21) }], [7, { img: px(34) }], [9, { img: px(55), mask: m1 }], [10, { img: px(89) }]]);
  const docA = {
    width: W, height: H, bgId: 1,
    recipe: { source: { name: 'source photo.png', steps: [] }, painted: {}, steps: [
      { id: 'crop', seq: 1, args: [['-crop', '160x100+10+12', '+repage']], fidelity: 'exact', label: 'Crop' },
      { id: 'resize', seq: 2, args: [['-filter', 'Lanczos', '-resize', W + 'x' + H + '!']], fidelity: 'exact', label: 'Resize' },
      { id: 'flip', seq: 3, args: [['-flop']], fidelity: 'exact', label: 'Flip' }] },
    layers: [
      lay({ id: 1, kind: 'raster', name: 'Background', w: W, h: H, opaque: true }),
      lay({ id: 2, kind: 'raster', name: 'Shadow', w: W, h: H, blend: 'multiply', opacity: 0.6, mask: { enabled: true } }),
      lay({ id: 3, kind: 'raster', name: 'Glow', w: W, h: H, blend: 'screen' }),
      lay({ id: 4, kind: 'adjust', name: 'Levels', adjust: { type: 'levels', params: { inBlack: 12, inWhite: 235, gamma: 1.15, outBlack: 5, outWhite: 250 } } }),
      lay({ id: 5, kind: 'adjust', name: 'Hue', opacity: 0.5, mask: { enabled: true }, adjust: { type: 'hueSaturation', params: { hue: 35, saturation: 20, lightness: 0 } } }),
      lay({ id: 6, kind: 'raster', name: 'Soft', w: W, h: H, blend: 'soft-light' }),
      lay({ id: 7, kind: 'raster', name: 'Difference', w: W, h: H, blend: 'difference', opacity: 0.7 }),
      lay({ id: 8, kind: 'adjust', name: 'Balance', adjust: { type: 'colorBalance', params: { shadows: [20, 0, -10], midtones: [0, 15, 0], highlights: [-10, 0, 25], preserve: true } } }),
      lay({ id: 9, kind: 'raster', name: 'Top', w: W, h: H, opacity: 0.5, mask: { enabled: true } }),
      lay({ id: 10, kind: 'raster', name: 'Overlay', w: W, h: H, blend: 'overlay' }),
      lay({ id: 11, kind: 'adjust', name: 'Curves', opacity: 0.8, adjust: { type: 'curves', params: { rgb: [[0, 10], [90, 70], [200, 220], [255, 250]] } } }),
    ],
  };
  const extra = { 'source photo.png': encodePNG(src, { level: 1 }) };
  // eleven layers: the editor rounds to 8 bits after every layer (adjustments work on 8-bit tables), ImageMagick keeps
  // floating point - rounding adds up, every single operation is exact (cases 2 and 3)
  const A = check('document: recipe, masks, opacity, blends, adjustments', path.join(root, 'a'), docA, pix, extra, (d, c) => !d.size && c.fidelity === 'exact' && d.mean <= 1 && d.max <= 12);

  // 2. Every blend mode over an opaque picture (a semi-transparent layer at 80 %): exact.
  const base = synthImage(W, H, false, 3);
  for (const mode of Object.keys(BLENDS_IM)) {
    const doc = { width: W, height: H, bgId: null, layers: [lay({ id: 1, kind: 'raster', name: 'Base', w: W, h: H, opaque: true }), lay({ id: 2, kind: 'raster', name: 'Layer', w: W, h: H, blend: mode, opacity: 0.8 })] };
    const p = new Map([[1, { img: base }], [2, { img: px(8) }]]);
    check(`blend ${mode}`, path.join(root, 'b-' + mode), doc, p, {});
  }
  // 3. Blends over a transparent picture (no opaque layer at the bottom): the -fx forms with alpha, still exact; then
  //    adjustments (direct, by a mask, by opacity) over the transparent result keep its alpha.
  const bottom = synthImage(W, H, true, 5);
  for (const mode of Object.keys(BLENDS_IM)) {
    const doc = { width: W, height: H, bgId: null, layers: [lay({ id: 1, kind: 'raster', name: 'Bottom', w: W, h: H }), lay({ id: 2, kind: 'raster', name: 'Layer', w: W, h: H, blend: mode, opacity: 0.9 })] };
    const p = new Map([[1, { img: bottom }], [2, { img: alphaScaled(synthImage(W, H, true, 60), (x) => 0.3 + 0.7 * (1 - x / (W - 1))) }]]);
    check(`blend ${mode} over transparency`, path.join(root, 't-' + mode), doc, p, {});
  }
  {
    const doc = { width: W, height: H, bgId: null, layers: [lay({ id: 1, kind: 'raster', name: 'Bottom', w: W, h: H }),
      lay({ id: 4, kind: 'adjust', name: 'Posterize', adjust: { type: 'posterize', params: { levels: 6 } } }),
      lay({ id: 2, kind: 'adjust', name: 'Invert', mask: { enabled: true }, adjust: { type: 'invert', params: {} } }),
      lay({ id: 3, kind: 'adjust', name: 'Levels', opacity: 0.6, adjust: { type: 'levels', params: { inBlack: 30, inWhite: 220, gamma: 0.9, outBlack: 0, outWhite: 255 } } })] };
    const p = new Map([[1, { img: bottom }], [2, { mask: m1 }]]);
    check('adjustments over transparency', path.join(root, 'd'), doc, p, {});
  }
  // 5. Text and shapes (fonts by name: pixels are compared in the browser, here the command must run).
  {
    const doc = { width: W, height: H, bgId: 1, recipe: { source: { blank: '#ffffff', w: W, h: H }, steps: [], painted: {} }, layers: [
      lay({ id: 1, kind: 'raster', name: 'Background', w: W, h: H, opaque: true }),
      lay({ id: 2, kind: 'text', name: 'Title', x: 6, y: 4, rotation: 0, text: { value: "It's 100 %\n\"quoted\" & <b>", family: 'system-ui', size: 18, weight: 700, italic: false, color: '#c2410c', align: 'center', lineHeight: 1.2 } }),
      lay({ id: 3, kind: 'text', name: 'Rotated', x: 20, y: 40, rotation: -15, blend: 'multiply', opacity: 0.7, text: { value: 'Ünïcødé ✓', family: 'Georgia', size: 14, weight: 400, italic: true, color: '#1d4ed8', align: 'left', lineHeight: 1.2 } }),
      lay({ id: 4, kind: 'shape', name: 'Ring', x: 70, y: 30, rotation: 20, shape: { type: 'ellipse', w: 40, h: 30, fill: null, stroke: '#16a34a', strokeWidth: 4, radius: 0 } }),
      lay({ id: 5, kind: 'shape', name: 'Card', x: 10, y: 50, rotation: 0, opacity: 0.6, shape: { type: 'rect', w: 50, h: 20, fill: '#facc15', stroke: '#111111', strokeWidth: 2, radius: 6 } }),
      lay({ id: 6, kind: 'shape', name: 'Line', x: 5, y: 70, rotation: 0, shape: { type: 'line', w: 110, h: -60, fill: null, stroke: '#7c3aed', strokeWidth: 3, radius: 0 } }),
    ] };
    const c = docCommand(doc, { output: 'out.png' });
    const dir = path.join(root, 'e');
    files(dir, c, new Map());
    try { const got = runArgv(dir, c); ok('text and shapes run', got.width === W && got.height === H && c.fidelity === 'approx'); } catch (e) { ok('text and shapes run', false, e.message); }
  }

  // 6. The command text through the shells (document 1): bash and cmd.exe, typed and as script files, one command and
  //    the script of steps - every output equal to the spawned argv's.
  if (A) {
    const { c, got } = A;
    const { env, bashPrelude } = magickShellEnv(exe);
    const same = (label, dir, name = 'out.png') => {
      const p = path.join(dir, name);
      if (!fs.existsSync(p)) { ok(label, false, 'no output; folder: ' + fs.readdirSync(dir).join(', ')); return; }
      const d = pixelDiff(got, decode(fs.readFileSync(p)));
      ok(label, d.max <= 1 && !d.size, JSON.stringify(d));
    };
    const fresh = (name) => { const d = path.join(root, name); files(d, c, pix, extra); return d; };
    const bash = findBash();
    if (bash) {
      for (const [form, wrap] of [['single', true], ['single', false], ['steps', true]]) {
        const dir = fresh(`bash-${form}-${wrap}`);
        const r = spawnSync(bash, ['-s'], { input: bashPrelude + commandText(c, 'bash', { form, wrap }).text + '\n', cwd: dir, env, encoding: 'utf8' });
        if (r.status !== 0) ok(`bash ${form} runs`, false, r.stderr);
        same(`bash ${form} (wrap ${wrap})`, dir);
        if (form === 'steps') ok('bash steps clean up', !fs.readdirSync(dir).some((n) => n.endsWith('.miff')));
      }
      const dir = fresh('sh');
      fs.writeFileSync(path.join(dir, 'edit.sh'), scriptFile(c, 'bash', { form: 'steps' }).replace('set -e\n', 'set -e\n' + bashPrelude));
      const r = spawnSync(bash, ['edit.sh'], { cwd: dir, env, encoding: 'utf8' });
      if (r.status !== 0) ok('.sh runs', false, r.stderr);
      same('.sh file', dir);
    } else console.log('photo: bash not available, bash runs skipped');
    if (process.platform === 'win32') {
      for (const form of ['single', 'steps']) {
        const dir = fresh('cmd-' + form);
        const r = spawnSync('cmd.exe', ['/d', '/q', '/k'], { input: commandText(c, 'cmd', { form }).text.replace(/\n/g, '\r\n') + '\r\nexit\r\n', cwd: dir, env, encoding: 'utf8' });
        if (r.status !== 0) ok('cmd window runs', false, r.stderr);
        same(`cmd.exe window (${form})`, dir);
      }
      for (const form of ['single', 'steps']) {
        const dir = fresh('bat-' + form);
        fs.writeFileSync(path.join(dir, 'edit.bat'), scriptFile(c, 'cmd', { form, head: 'test 100% & more' }));
        const r = spawnSync('cmd.exe', ['/d', '/c', path.join(dir, 'edit.bat')], { cwd: dir, env, encoding: 'utf8' });
        if (r.status !== 0) ok('.bat runs', false, r.stderr);
        same(`.bat file (${form})`, dir);
      }
    }
  }
  if (process.env.PHOTO_NUMBERS) console.log(numbers.join('\n'));
  fs.rmSync(root, { recursive: true, force: true });
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
