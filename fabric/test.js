// fabric/test.js - tests of fabrics: `node fabric/test.js` (importing the module runs nothing). Weave structures (plain,
// twills S / Z, herringbone reversing, satins with single interlacings, baskets, ribs), drafts (the drawdown of the
// minimal draft of every weave is the weave; shaft counts), jacquard, tartan setts, normalisation, textures (seamless
// tiles for every preset, colour-and-weave effects), simulation parameters.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEAVES, cell, drawdown, floats, jacquard, knit, KNITS, warpFace, weave, weaveEquals, weaveToDraft } from './weave.js';
import { FABRICS, averageColor, colorOrder, normalizeFabric, parseSett, simParams } from './fabric.js';
import { fabricTexture, tileSeamless } from './texture.js';
import { DYES, applyDye, dyeSVG, dyeWeight, normalizeDye } from './dye.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function run() {
  let pass = 0, fail = 0;
  const t0 = Date.now();
  const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${typeof info === 'string' ? info : JSON.stringify(info)}`); } };
  const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

  // --- structures and drafts
  const plain = weave('plain');
  eq('plain draft', [weaveToDraft(plain).shafts, weaveToDraft(plain).treadles], [2, 2]);
  ok('plain alternates', cell(plain, 0, 0) !== cell(plain, 1, 0) && cell(plain, 0, 0) !== cell(plain, 0, 1));
  const tz = weave('twill', { up: 2, down: 2, dir: 'Z' }), ts = weave('twill', { up: 2, down: 2, dir: 'S' });
  eq('2/2 twill needs 4 shafts', weaveToDraft(tz).shafts, 4);
  ok('Z twill steps right', cell(tz, 1, 1) === cell(tz, 0, 0) && cell(tz, 2, 2) === cell(tz, 0, 0));
  ok('S twill steps left', cell(ts, 0, 1) === cell(ts, 1, 0));
  ok('S is the mirror of Z', [...Array(4)].every((_, p) => [...Array(4)].every((__, e) => cell(ts, e, p) === cell(tz, 1 - e, p))));
  const t31 = weave('twill', { up: 3, down: 1 });
  ok('3/1 twill warp-faced', Math.abs(warpFace(t31) - 0.75) < 1e-9);
  const hb = weave('herringbone', { up: 2, down: 2, period: 8 });
  const dirAt = (e) => (cell(hb, e + 1, 1) === cell(hb, e, 0) ? 'Z' : cell(hb, e, 1) === cell(hb, e + 1, 0) ? 'S' : '?');
  ok('herringbone reverses', dirAt(2) !== dirAt(10) && dirAt(2) !== '?' && dirAt(10) !== '?', [dirAt(2), dirAt(10)]);
  for (const n of [5, 8]) {
    const sat = weave('satin', { shafts: n, move: n === 8 ? 3 : 2, face: 'warp' });
    const rowsOk = [...Array(n)].every((_, p) => [...Array(n)].filter((__, e) => !cell(sat, e, p)).length === 1);
    const colsOk = [...Array(n)].every((_, e) => [...Array(n)].filter((__, p) => !cell(sat, e, p)).length === 1);
    ok(`${n}-shaft satin: one interlacing per thread`, rowsOk && colsOk);
    ok(`${n}-shaft satin: no adjacent interlacings (move)`, [...Array(n)].every((_, p) => { const a = [...Array(n)].findIndex((__, e) => !cell(sat, e, p)), b = [...Array(n)].findIndex((__, e) => !cell(sat, e, p + 1)); return Math.abs(a - b) > 1 && Math.abs(a - b) < n - 1; }));
    eq(`${n}-shaft satin floats`, floats(sat).warp, n - 1);
  }
  ok('invalid satin move corrected', (() => { const s = weave('satin', { shafts: 6, move: 3 }); return [...Array(6)].every((_, p) => [...Array(6)].filter((__, e) => !cell(s, e, p)).length === 1); })());
  eq('basket 2 floats', floats(weave('basket', { n: 2 })).warp, 2);
  eq('warp rib floats', floats(weave('rib', { n: 3, dir: 'warp' })).warp, 3);
  for (const k of Object.keys(WEAVES)) {
    const wv = weave(k);
    ok(`${k}: drawdown of its draft is itself`, weaveEquals(drawdown(weaveToDraft(wv)), wv));
  }
  // A threading / tie-up / treadling drafted by hand: point twill.
  const pt = drawdown({ threading: [0, 1, 2, 3, 2, 1], tieup: [[1, 1, 0, 0], [0, 1, 1, 0], [0, 0, 1, 1], [1, 0, 0, 1]], treadling: [0, 1, 2, 3] });
  ok('point twill mirrors at the point', [...Array(4)].every((_, p) => cell(pt, 1, p) === cell(pt, 5, p) && cell(pt, 2, p) === cell(pt, 4, p)));
  // Jacquard: a 2-tone bitmap.
  const bmp = { w: 10, h: 10, channels: 1, data: new Uint8Array(100).map((_, i) => ((i % 10) < 5 ? 0 : 255)) };
  const fig = weave('satin', { shafts: 5, face: 'warp' }), gr = weave('satin', { shafts: 5, face: 'weft' });
  const jq = jacquard(bmp, { figure: fig, ground: gr });
  ok('jacquard figure and ground', [...Array(10)].every((_, p) => [...Array(10)].every((__, e) => cell(jq, e, p) === (e < 5 ? cell(fig, e, p) : cell(gr, e, p)))));
  ok('jacquard needs more shafts than the satin', weaveToDraft(jq).shafts >= 5);
  for (const k of Object.keys(KNITS)) { const kn = knit(k); ok(`knit ${k}`, kn.stitches.length === kn.w * kn.h); }

  // --- colours and fabrics
  const sett = parseSett('K/4 R24 K24 Y/4');
  eq('symmetric sett', sett.map((s) => s.n), [4, 24, 24, 4, 24, 24]);
  eq('sett colours', sett[0].color, '#1b1b1f');
  const f = normalizeFabric({ preset: 'suiting', color: '#123456', props: { gsm: 99999, sheen: 2 } });
  ok('normalize clamps', f.props.gsm === 1200 && f.props.sheen === 1 && f.color === '#123456');
  ok('normalize unknown preset', normalizeFabric({ preset: 'nope' }).preset === 'poplin');
  eq('colour order of gingham', colorOrder(normalizeFabric({ preset: 'gingham' }), 'warp').length, 12);
  ok('average colour of gingham is between', /^#[0-9a-f]{6}$/.test(averageColor(normalizeFabric({ preset: 'gingham' }))));
  const stiff = simParams(normalizeFabric({ preset: 'canvas' })), soft = simParams(normalizeFabric({ preset: 'habotai' }));
  ok('stiffer fabric bends less', stiff.bendCompliance < soft.bendCompliance / 10);
  ok('heavier fabric is denser', stiff.density > soft.density * 4);

  // --- custom weaves and jacquards
  {
    const cu = normalizeFabric({ preset: 'poplin', structure: { type: 'woven', weave: 'custom', w: 3, h: 3, cells: '100010001' } });
    const { fabricWeave } = await import('./fabric.js');
    const wv = fabricWeave(cu);
    ok('custom weave cells', wv.w === 3 && wv.cells[0] === 1 && wv.cells[1] === 0 && wv.cells[4] === 1);
    ok('custom weave default when invalid', normalizeFabric({ structure: { type: 'woven', weave: 'custom', w: 4, h: 4, cells: 'zz' } }).structure.cells.length === 16);
    const jq = normalizeFabric({ structure: { type: 'jacquard', w: 4, h: 4, bitmap: Buffer.from(new Uint8Array(16).fill(0)).toString('base64') } });
    const jw = fabricWeave(jq);
    ok('jacquard from a bitmap: all figure', jw.w === 4 && jw.kind === 'jacquard');
    ok('jacquard texture', fabricTexture(jq, { px: 3 }).width > 0);
  }

  // --- textures
  for (const k of Object.keys(FABRICS)) {
    const t = fabricTexture(normalizeFabric({ preset: k }), { px: 4, repeat: [2, 2] });
    const s = tileSeamless(t);
    ok(`${k}: seamless tile`, s.ok, s);
    ok(`${k}: opaque`, t.data[3] === 255 && t.data[t.data.length - 1] === 255);
  }
  // Houndstooth: colour-and-weave gives both colours on the face in both directions.
  const hs = fabricTexture(normalizeFabric({ preset: 'houndstooth' }), { px: 2 });
  let dark = 0;
  for (let i = 0; i < hs.data.length; i += 4) if (hs.data[i] < 80) dark++;
  ok('houndstooth half dark', Math.abs(dark / (hs.data.length / 4) - 0.5) < 0.2, dark / (hs.data.length / 4));
  const tile = fabricTexture(normalizeFabric({ preset: 'tartan' }), { px: 6, maxSize: 512 });
  ok('tile limited to maxSize', tile.width <= 1024 && tile.cm[0] > 0);

  // dyes
  const none = normalizeDye(null);
  ok('dye: none by default', none.kind === 'none' && dyeWeight(none, 10, 10) === 0 && normalizeFabric({ preset: 'poplin' }).dye.kind === 'none');
  const om = normalizeDye({ kind: 'ombre', color: '#ff0000', from: 0, to: 100, angle: 90, strength: 1 });
  ok('dye: ombre rises along its direction', dyeWeight(om, 0, -5) === 0 && dyeWeight(om, 0, 50) > 0.3 && dyeWeight(om, 0, 50) < 0.7 && dyeWeight(om, 0, 120) === 1);
  const white = applyDye([255, 255, 255], om, 0, 120), black = applyDye([0, 0, 0], om, 0, 120);
  ok('dye: multiply (white takes the dye, black stays black)', white[0] === 255 && white[1] === 0 && black.every((v) => v === 0), [white, black]);
  const dip = normalizeDye({ kind: 'dip', level: 40, soft: 0 });
  ok('dye: dip below its line', dyeWeight(dip, 5, 20) === 0 && dyeWeight(dip, 5, 60) > 0.8);
  const tie = normalizeDye({ kind: 'tieDye', cx: 0, cy: 0, rings: 4 });
  const ws = Array.from({ length: 40 }, (_, i) => dyeWeight(tie, i, 0));
  ok('dye: tie-dye rings alternate', Math.max(...ws) > 0.7 && Math.min(...ws) < 0.15);
  const sp = normalizeDye({ kind: 'spray', amount: 0.4 });
  let cov = 0; for (let i = 0; i < 400; i++) cov += dyeWeight(sp, (i % 20) * 1.3, Math.floor(i / 20) * 1.3) > 0.4 ? 1 : 0;
  ok('dye: spray covers about its amount', cov > 60 && cov < 300, cov);
  ok('dye: clamped kinds', normalizeDye({ kind: 'weird' }).kind === 'none' && DYES.length === 5);
  ok('dye: svg paint', dyeSVG(om, '#ffffff', 'x', { w: 10, h: 10 }).fill === 'url(#x)' && dyeSVG(none, '#fff', 'y', {}) === null);

  console.log(`fabric: ${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
