// carpet/test.js - unit tests of the rug library: node carpet/test.js (also node check.js tests carpet).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateRug, knotGrid, TRADITIONS, FIELDS, rugRoleAt } from './generate.js';
import { fieldFold, wallpaperFold, WALLPAPER, FIELD_SYMMETRIES, isSymmetric, orbit } from './symmetry.js';
import { MOTIFS, motifSize, normMotif, mirrorMotif, rotateMotif } from './motifs.js';
import { PALETTES, paletteColors, ROLES } from './dyes.js';
import { encodeShare, decodeShare } from './share.js';
import { yarnEstimate } from './estimate.js';
import { knotScheme, crossStitchScheme } from './chart.js';
import { rugRGBA, rugSVG } from './render.js';
import { usage } from '../stitch/model.js';
import { writeOXS, readOXS } from '../stitch/oxs.js';
import { parseXML } from '../xml/xml.js';
import { PATTERNS } from './patterns.js';
import { normLayer, randomComposition } from './compose.js';
import { REGIONAL_FIELDS } from './regional.js';
import { DESIGNS } from './designs.js';
import { createEdits, paintBrush, encodeEdits, decodeEdits, applyEdits, floodFill } from './edits.js';
import { seededRandom } from '../prng/prng.js';

// Test strategy: properties over exhaustive small cases (every symmetry x odd/even/non-square sizes, every
// wallpaper group, every tradition and field, every pattern type) rather than golden images, which would break on
// any intentional design change. Determinism is asserted by generating twice and comparing cells.
let failed = 0, passed = 0;
const ok = (c, name, info) => { if (c) passed++; else { failed++; console.log('x carpet: ' + name + (info !== undefined ? ' ' + JSON.stringify(info) : '')); } };

export function run() {
  // Knot grid.
  const g = knotGrid(100, 150, 100);
  ok(g.width === 394 && g.height === 591 && Math.abs(g.kpiH - 10) < 0.02, 'knot grid from size and KPSI', g);
  const big = knotGrid(600, 900, 900);
  ok(big.width * big.height <= 1.5e6, 'knot grid capped', big);

  // Field symmetries: every cell maps into its orbit and a folded drawing is exactly symmetric.
  for (const sym of FIELD_SYMMETRIES) {
    for (const [w, h] of [[9, 9], [10, 10], [7, 12]]) {
      const grid = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [a, b] = fieldFold(sym, x, y, w, h); grid.push((a * 31 + b * 17) % 7); }
      const effective = (sym === 'rot4' || sym === 'd4') && w !== h ? 'mirrorXY' : sym;
      ok(sym === 'none' || isSymmetric((x, y) => grid[y * w + x], w, h, effective), `field symmetry ${sym} on ${w}×${h}`);
      ok(orbit(sym, 1, 2, w, h).some(([a, b]) => a === 1 && b === 2), 'orbit contains the cell');
    }
  }
  // Wallpaper groups: folds land in the tile and are periodic.
  for (const grp of WALLPAPER) {
    let inTile = true, periodic = true;
    const tw = 12, th = grp.startsWith('p4') ? 12 : 10;
    const pw = grp === 'cm' || grp === 'cmm' ? tw : tw, ph = grp === 'cm' || grp === 'cmm' ? th * 2 : th;
    for (let y = -15; y < 15; y++) for (let x = -15; x < 15; x++) {
      const [u, v] = wallpaperFold(grp, x, y, tw, th);
      if (u < 0 || v < 0 || u >= tw || v >= th) inTile = false;
      const [u2, v2] = wallpaperFold(grp, x + pw, y + ph, tw, th);
      if (u2 !== u || v2 !== v) periodic = false;
    }
    ok(inTile && periodic, 'wallpaper group ' + grp);
  }
  const pmm = (x, y) => wallpaperFold('pmm', x, y, 10, 10).join();
  ok(pmm(2, 3) === pmm(7, 3) && pmm(2, 3) === pmm(2, 6), 'pmm mirrors both ways');
  const p4 = (x, y) => wallpaperFold('p4', x, y, 10, 10).join();
  ok(p4(7, 2) === p4(7, 7) || p4(7, 2) === p4(2, 7) || p4(7, 2) === p4(2, 2), 'p4 rotates quarter turns');

  // Motifs.
  for (const m of Object.values(MOTIFS)) {
    const s = motifSize(m);
    ok(m.rows.every((r) => r.length === s.w && /^[.ABCDOGFRL]+$/.test(r)), 'motif ' + m.id + ' rows are well formed', m.rows);
  }
  const gul = MOTIFS.gul;
  ok(JSON.stringify(mirrorMotif(gul).rows) === JSON.stringify(gul.rows) && JSON.stringify(mirrorMotif(gul, 'y').rows) === JSON.stringify(gul.rows), 'gul is mirror-symmetric');
  ok(motifSize(rotateMotif(MOTIFS.boteh)).w === motifSize(MOTIFS.boteh).h, 'rotate motif');
  ok(normMotif({ rows: ['AX', 'B'] }).rows.join('|') === 'A.|B.', 'normalize user motifs');

  // Palettes.
  for (const id of Object.keys(PALETTES)) ok(paletteColors(id).length === ROLES.length && paletteColors(id).every((c) => /^#[0-9a-f]{6}$/.test(c.hex)), 'palette ' + id);
  ok(paletteColors('persian', { ground: '#123456' })[0].hex === '#123456', 'palette overrides');

  // Generation: every tradition and field, deterministic.
  for (const t of Object.keys(TRADITIONS)) {
    const a = generateRug({ tradition: t, seed: 'test-1', widthCm: 60, lengthCm: 90, kpsi: 25 });
    const b = generateRug({ tradition: t, seed: 'test-1', widthCm: 60, lengthCm: 90, kpsi: 25 });
    ok(a.cells.length === a.width * a.height && a.cells.every((v) => v < a.palette.length), 'rug ' + t + ' is valid');
    ok(a.cells.join() === b.cells.join(), 'rug ' + t + ' is reproducible from its seed');
    const c = generateRug({ tradition: t, seed: 'test-2', widthCm: 60, lengthCm: 90, kpsi: 25 });
    ok(c.cells.join() !== a.cells.join(), 'another seed, another rug: ' + t);
    ok(new Set(a.cells).size >= 3, 'rug ' + t + ' uses several colours', new Set(a.cells).size);
  }
  for (const f of FIELDS) {
    const r = generateRug({ tradition: 'anatolian', seed: 'f', field: f, widthCm: 50, lengthCm: 80, kpsi: 25 });
    ok(r.meta.field === f, 'field ' + f);
  }
  const sym = generateRug({ tradition: 'persian', seed: 'sym', field: 'medallion', symmetry: 'mirrorXY', widthCm: 80, lengthCm: 120, kpsi: 16 });
  // The field is exactly symmetric (running borders follow their unit around the rug, as on real rugs).
  const m0 = Math.round(Math.min(sym.width, sym.height) * 0.25), fw = sym.width - 2 * m0, fh = sym.height - 2 * m0;
  ok(isSymmetric((x, y) => sym.cells[(y + m0) * sym.width + x + m0], fw, fh, 'mirrorXY'), 'a medallion field with mirror symmetry is symmetric');
  ok(rugRoleAt(sym, 0, 0) === 'outline', 'the outer edge is the outline');

  // Share codes.
  const opts = { tradition: 'caucasian', seed: 'Cold River 41!', widthCm: 150, lengthCm: 230, kpsi: 81, palette: 'anatolian', field: 'allover', wallpaper: 'p4m', overrides: { ground: '#112233' } };
  const code = encodeShare(opts);
  const back = decodeShare(code);
  ok(/^caucasian\.cold-river-41\.150x230\.81\.p-anatolian\.o-/.test(code), 'share code is readable', code);
  ok(back && back.seed === 'cold-river-41' && back.wallpaper === 'p4m' && back.overrides.ground === '#112233' && back.widthCm === 150, 'share code round trip', back);
  ok(generateRug(back).cells.join() === generateRug({ ...opts, seed: 'cold-river-41' }).cells.join(), 'a share code regenerates the rug');
  ok(decodeShare('nonsense') === null && decodeShare('persian.x.1x2') === null, 'bad codes are rejected');

  // Estimates.
  const rug = generateRug({ tradition: 'turkmen', seed: 'e', widthCm: 100, lengthCm: 150, kpsi: 100 });
  const e = yarnEstimate(rug);
  ok(e.knots === rug.width * rug.height && e.colors.reduce((a, c) => a + c.knots, 0) === e.knots, 'knots per colour add up');
  const perKnotM = ((2 * rug.pileMm + 2.2 * (25.4 / rug.kpiH)) / 1000) * 1.12;
  ok(Math.abs(e.pileGrams - (e.knots * perKnotM / 1600) * 1000) < 1, 'pile yarn weight', e.pileGrams);
  ok(e.finishedCm[0] === 100 && e.finishedCm[1] === 150 && e.hours > 100 && e.warpMeters > 0 && e.weftMeters > 0, 'size, time, warp and weft', e);

  // Charts through the stitch library.
  const ks = knotScheme(rug, { title: 'Test rug' });
  ok(ks.width === rug.width && ks.fabric.kind === 'rug' && ks.palette.length === new Set(rug.cells).size, 'knotting chart');
  const u = usage(ks);
  ok(u.reduce((a, x) => a + x.full, 0) === rug.width * rug.height, 'every knot is a chart cell');
  ok(new Set(ks.palette.map((p) => p.symbol)).size === ks.palette.length, 'knotting chart symbols are distinct');
  const cs = crossStitchScheme(rug, { brand: 'anchor' });
  ok(cs.palette.every((p) => p.brand === 'Anchor') && cs.palette.length <= ks.palette.length, 'cross-stitch version in Anchor threads');
  const oxs = readOXS(writeOXS(cs));
  ok(oxs.width === rug.width && oxs.palette.length === cs.palette.length, 'cross-stitch version survives OXS');

  // Pictures.
  const img = rugRGBA(rug, { scale: 2, pile: true });
  ok(img.width === rug.width * 2 && img.height > rug.height * 2 && img.oy > 0, 'realistic picture with fringe', [img.width, img.height, img.oy]);
  const svg = rugSVG(generateRug({ tradition: 'modern', seed: 's', widthCm: 40, lengthCm: 60, kpsi: 16 }));
  ok(parseXML(svg) && /<path fill="#/.test(svg), 'SVG of a rug');

  // Compositions: every pattern type paints, layers are deterministic, masks and blends behave.
  for (const type of Object.keys(PATTERNS)) {
    const r = generateRug({ tradition: 'mashup', seed: 'p', field: 'plain', widthCm: 60, lengthCm: 90, kpsi: 9, borders: 0, layers: [{ type, params: type === 'reaction' ? { grid: 40, steps: 200 } : {} }] });
    ok(new Set(r.cells).size > 1, 'pattern paints: ' + type);
  }
  const lay = [{ type: 'mandelbrot', sym: 'kaleido', fold: 8 }, { type: 'star', blend: 'outline', roles: ['outline'] }];
  const c1 = generateRug({ tradition: 'mashup', seed: 'q', field: 'plain', layers: lay, kpsi: 16 }), c2 = generateRug({ tradition: 'mashup', seed: 'q', field: 'plain', layers: lay, kpsi: 16 });
  ok(c1.cells.every((v, i) => v === c2.cells[i]), 'compositions are deterministic');
  const masked = generateRug({ tradition: 'mashup', seed: 'm', field: 'plain', kpsi: 9, borders: 0, layers: [{ type: 'rings', params: { count: 1, fill: 1, size: 0.3 }, blend: 'mask' }, { type: 'checks', roles: ['accent1', 'accent2'] }] });
  ok(masked.cells[masked.meta.rect.y * masked.width + masked.meta.rect.x] === ROLES.indexOf('field') && masked.cells[(masked.height >> 1) * masked.width + (masked.width >> 1)] !== ROLES.indexOf('field'), 'masks clip later layers');
  ok(normLayer({ type: 'nope', blend: 'x', fold: 99 }).type === 'medallion' && normLayer({ fold: 99 }).fold === 24, 'layers are normalized');
  ok(randomComposition(seededRandom('a'), { motifIds: ['star8'] }).length >= 3, 'random compositions');
  // Regional recipes and the gallery.
  for (const f of REGIONAL_FIELDS) { const r = generateRug({ tradition: 'georgian', seed: 'r', field: f, kpsi: 9 }); ok(r.meta.fieldLayers.length > 0 && new Set(r.cells).size > 1, 'regional field ' + f); }
  for (const d of DESIGNS) { const o = { ...d.opts, kpsi: 9 }; const r = generateRug(o); ok(r.width > 0 && decodeShare(encodeShare(o)).seed === o.seed, 'design ' + d.id); }
  // Hand edits: paint, encode, decode, apply, symmetry, fill.
  const er = generateRug({ tradition: 'modern', seed: 'e', kpsi: 9 });
  const ed = createEdits(er.width, er.height);
  paintBrush(ed, 3, 4, 1, 7, 'mirrorXY');
  ok(ed.data[4 * ed.w + 3] === 7 && ed.data[(ed.h - 5) * ed.w + ed.w - 4] === 7, 'symmetric brush');
  const e2 = decodeEdits(encodeEdits(ed), er.width, er.height);
  ok(e2 && e2.data.every((v, i) => v === ed.data[i]) && encodeEdits(createEdits(4, 4)) === '', 'edits round trip');
  ok(decodeEdits(encodeEdits(ed), er.width + 1, er.height) === null, 'edits of another grid are refused');
  ok(applyEdits(er, ed).cells[4 * er.width + 3] === 7, 'edits apply');
  const fe = createEdits(er.width, er.height);
  floodFill(fe, er, 0, 0, 9);
  ok(fe.data[0] === 9, 'flood fill');
  const sc = encodeShare({ tradition: 'persian', seed: 's', widthCm: 100, lengthCm: 150, kpsi: 64, layers: lay, edits: encodeEdits(ed) });
  ok(decodeShare(sc).layers.length === 2 && decodeShare(sc).edits === encodeEdits(ed), 'share codes carry layers and edits');

  console.log(`carpet: ${passed} passed, ${failed} failed`);
  return failed;
}

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = run() ? 1 : 0;
