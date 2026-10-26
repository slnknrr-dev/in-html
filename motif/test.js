// motif/test.js - tests of print design: `node motif/test.js` (importing the module runs nothing). The rasterizer
// (areas of filled shapes, holes by winding, wrap-around, images), every repeat type seamless and periodic with the
// right unit, colourways, separations that partition the printed area, SVG output, placements.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canvas, drawImage, fillPolys, trsM } from './raster.js';
import { MOTIFS, motifPath, motifPolys } from './motifs.js';
import { DEFAULT_DESIGN, REPEATS, designSVG, normalizeDesign, normalizePlacement, renderInto, renderUnit, repeatUnit, seamlessCheck, separations } from './repeat.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const inked = (cv, bg = 255) => { let n = 0; for (let i = 0; i < cv.data.length; i += 4) n += (bg - cv.data[i]) / bg; return n; };

export async function run() {
  let pass = 0, fail = 0;
  const t0 = Date.now();
  const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${typeof info === 'string' ? info : JSON.stringify(info)}`); } };
  const near = (name, got, want, tol) => ok(name, Math.abs(got - want) <= tol, `got ${got} want ${want} ±${tol}`);

  // --- rasterizer
  {
    const cv = canvas(100, 100, '#ffffff');
    fillPolys(cv, [[[10, 10], [60, 10], [60, 40], [10, 40]]], '#000000');
    near('rectangle area', inked(cv), 1500, 1);
    const c2 = canvas(100, 100, '#ffffff');
    fillPolys(c2, motifPolys('dot'), '#000000', { m: trsM(50, 50, 30) });
    near('disc area', inked(c2), Math.PI * 900, 15);
    const c3 = canvas(100, 100, '#ffffff');
    fillPolys(c3, motifPolys('ring'), '#000000', { m: trsM(50, 50, 30) });
    near('ring has a hole (non-zero winding)', inked(c3), Math.PI * (900 - 324), 20);
    const c4 = canvas(100, 100, '#ffffff');
    fillPolys(c4, motifPolys('dot'), '#000000', { m: trsM(95, 50, 20), wrap: true });
    near('wrap keeps the whole area', inked(c4), Math.PI * 400, 12);
    const img = { width: 2, height: 2, data: new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]) };
    const c5 = canvas(50, 50, '#ffffff');
    drawImage(c5, img, [20, 0, 0, 10, 5, 5]);
    near('image covers its box', inked(c5), 200, 4);
    for (const k of Object.keys(MOTIFS)) {
      const c = canvas(64, 64, '#ffffff');
      fillPolys(c, motifPolys(k), '#000000', { m: trsM(32, 32, 28) });
      const a = inked(c);
      ok(`motif ${k} draws inside its box`, a > 150 && a < 64 * 64 * 0.98, a);
      ok(`motif ${k} svg path`, /^M[-\d.]+ [-\d.]+L/.test(motifPath(k)));
    }
  }

  // --- repeats
  for (const r of REPEATS) {
    const d = { ...DEFAULT_DESIGN, repeat: r, w: 8, h: 6 };
    const u = repeatUnit(normalizeDesign(d));
    const want = { block: [8, 6], halfDrop: [16, 6], brick: [8, 12], mirror: [16, 12], rotate: [16, 16] }[r];
    ok(`${r}: unit size`, u.w === want[0] && u.h === want[1], [u.w, u.h]);
    const s = seamlessCheck(d);
    ok(`${r}: seamless`, s.ok, s);
    const t = renderUnit(d, { pxPerCm: 5 });
    ok(`${r}: rendered size`, t.width === want[0] * 5 && t.height === want[1] * 5);
  }
  // Mirror repeat: the unit is symmetric left-right.
  {
    const t = renderUnit({ ...DEFAULT_DESIGN, repeat: 'mirror', w: 8, h: 6 }, { pxPerCm: 5 });
    let worst = 0;
    for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) { const a = (y * t.width + x) * 4, b = (y * t.width + (t.width - 1 - x)) * 4; worst = Math.max(worst, Math.abs(t.data[a] - t.data[b])); }
    ok('mirror repeat is symmetric', worst < 40, worst);
  }
  // Colourways recolour without moving anything.
  {
    const a = renderUnit({ ...DEFAULT_DESIGN, colorway: 0 }, { pxPerCm: 4 }), b = renderUnit({ ...DEFAULT_DESIGN, colorway: 1 }, { pxPerCm: 4 });
    ok('colourways differ', a.data.some((v, i) => v !== b.data[i]));
    ok('colourway background', a.data[0] !== b.data[0]);
  }
  // Separations partition the printed pixels.
  {
    const s = separations(DEFAULT_DESIGN, { pxPerCm: 6 });
    let overlap = 0;
    for (let p = 0; p < s.width * s.height; p++) { let n = 0; for (const l of s.layers) if (l.mask[p]) n++; if (n > 1) overlap++; }
    ok('separations do not overlap', overlap === 0, overlap);
    ok('one separation per used colour', s.layers.length === 3 && s.layers.every((l) => l.coverage > 0.005 && l.coverage < 0.5), s.layers.map((l) => l.coverage));
  }
  // renderInto tiles the design over a target.
  {
    const cv = canvas(120, 60, '#ffffff');
    renderInto(cv, { ...DEFAULT_DESIGN, repeat: 'block' }, [6, 0, 0, 6, 0, 0]);
    const unitPx = 60; // 10 cm at 6 px/cm
    let worst = 0;
    for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) { const a = (y * 120 + x) * 4, b = (y * 120 + x + unitPx) * 4; worst = Math.max(worst, Math.abs(cv.data[a] - cv.data[b])); }
    ok('renderInto repeats with the unit period', worst < 3, worst);
  }
  const svg = designSVG(DEFAULT_DESIGN);
  ok('design svg', svg.startsWith('<svg') && svg.includes('width="20cm"') && (svg.match(/<path/g) || []).length === 3 * 2 * 9);
  const n = normalizeDesign({ w: -5, repeat: 'zz', layers: [{ motif: 'nope', size: 9999 }], colorways: [{ colors: ['bad'] }] });
  ok('normalize design', n.w === 0.5 && n.repeat === 'halfDrop' && n.layers[0].motif === 'dot' && n.layers[0].size === 200 && n.colorways.length === 3);
  const pl = normalizePlacement({ x: 3, y: 4, w: 9999, art: { kind: 'image', id: 'a1' } });
  ok('placement', pl.w === 200 && pl.art.kind === 'image' && pl.art.id === 'a1' && pl.side === 'C');

  console.log(`motif: ${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
