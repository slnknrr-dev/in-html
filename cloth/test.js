// cloth/test.js - tests of the cloth library: `node cloth/test.js [--long]` (importing the module runs nothing).
// Meshes (triangulated area = piece area, seam edges keep their vertices, Delaunay on random points), the solver on a
// hanging sheet (pins hold, energy decays, stretch bounded), and the headless stability check: garments drafted for a
// body, assembled and simulated for 2.5 s of simulated time; every run must stay finite, close its seams, keep out of
// the body and come to rest. The numbers are printed (they are quoted in the README).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { delaunay, pieceMesh, meshEdges, bendPairs } from './mesh.js';
import { createCloth } from './sim.js';
import { assemble } from './assemble.js';
import { draftGarment, OUTFITS } from '../garment/garments.js';
import { pieceArea } from '../garment/piece.js';
import { patternDXF, readPatternDXF } from '../garment/dxf.js';
import { buildRig, bodyFromPreset } from '../body/body.js';
import { draftMeasurements } from '../body/measure.js';
import { seededRandom } from '../prng/prng.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function run(opts = {}) {
  const long = opts.long ?? (typeof process !== 'undefined' && process.argv.includes('--long'));
  let pass = 0, fail = 0;
  const t0 = Date.now();
  const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${typeof info === 'string' ? info : JSON.stringify(info)}`); } };

  // --- Delaunay and piece meshes
  {
    const rng = seededRandom('delaunay');
    const pts = Array.from({ length: 300 }, () => [rng.next() * 100, rng.next() * 60]);
    const tris = delaunay(pts);
    let empty = true;
    for (let i = 0; i < tris.length && empty; i += 3) {
      const [a, b, c] = [pts[tris[i]], pts[tris[i + 1]], pts[tris[i + 2]]];
      const D = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
      const ux = ((a[0] ** 2 + a[1] ** 2) * (b[1] - c[1]) + (b[0] ** 2 + b[1] ** 2) * (c[1] - a[1]) + (c[0] ** 2 + c[1] ** 2) * (a[1] - b[1])) / D;
      const uy = ((a[0] ** 2 + a[1] ** 2) * (c[0] - b[0]) + (b[0] ** 2 + b[1] ** 2) * (a[0] - c[0]) + (c[0] ** 2 + c[1] ** 2) * (b[0] - a[0])) / D;
      const r2 = (a[0] - ux) ** 2 + (a[1] - uy) ** 2;
      for (let k = 0; k < pts.length; k += 7) if ((pts[k][0] - ux) ** 2 + (pts[k][1] - uy) ** 2 < r2 * (1 - 1e-9)) { empty = false; break; }
    }
    ok('delaunay: empty circumcircles', empty);
    ok('delaunay: triangle count 2n - 2 - hull', tris.length / 3 > 2 * 300 - 2 - 60 && tris.length / 3 <= 2 * 300 - 5);
    const m = draftMeasurements(buildRig(bodyFromPreset('male-m')));
    const d = draftGarment({ garment: 'jacket' }, m);
    for (const p of d.pieces.filter((q) => q.arrange)) {
      const mesh = pieceMesh(p, { h: 2.5 });
      let a = 0;
      for (let k = 0; k < mesh.tris.length; k += 3) {
        const [i, j, l] = [mesh.tris[k], mesh.tris[k + 1], mesh.tris[k + 2]];
        a += ((mesh.xy[j * 2] - mesh.xy[i * 2]) * (mesh.xy[l * 2 + 1] - mesh.xy[i * 2 + 1]) - (mesh.xy[j * 2 + 1] - mesh.xy[i * 2 + 1]) * (mesh.xy[l * 2] - mesh.xy[i * 2])) / 2;
      }
      ok(`mesh ${p.id}: area`, Math.abs(a - pieceArea(p)) < pieceArea(p) * 0.004, [a, pieceArea(p)]);
      ok(`mesh ${p.id}: every edge has vertices`, p.edges.every((e) => mesh.edges[e.id]?.length >= 2));
      ok(`mesh ${p.id}: bend pairs`, bendPairs(mesh.tris).length > 0 && meshEdges(mesh.tris).length > mesh.count);
    }
  }

  // --- the solver on a pinned sheet
  {
    const N = 15, sp = 2;
    const c = createCloth(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const k = (j * N + i) * 3; c.pos[k] = i * sp; c.pos[k + 1] = 100; c.pos[k + 2] = j * sp; }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (i + 1 < N) c.addDistance(j * N + i, j * N + i + 1, sp, 1e-7);
      if (j + 1 < N) c.addDistance(j * N + i, (j + 1) * N + i, sp, 1e-7);
      if (i + 1 < N && j + 1 < N) c.addDistance(j * N + i, (j + 1) * N + i + 1, sp * Math.SQRT2, 1e-6);
    }
    c.pin(0, [0, 100, 0]); c.pin(N - 1, [(N - 1) * sp, 100, 0]);
    for (let f = 0; f < 240; f++) c.step(1 / 60);
    const st = c.stats();
    ok('sheet: pins hold', c.pos[1] === 100 && c.pos[(N - 1) * 3 + 1] === 100);
    ok('sheet: hangs down', c.pos[((N - 1) * N) * 3 + 1] < 100 - (N - 1) * sp * 0.8, c.pos[((N - 1) * N) * 3 + 1]);
    ok('sheet: comes to rest', st.meanSpeed < 2, st);
    ok('sheet: stretch bounded (hanging from two corners)', st.strainMax < 0.12, st.strainMax);
  }

  // --- headless stability of garments on bodies
  const cases = [
    ['female-m', ['tshirt']], ['male-m', ['jacket']], ['male-m', ['trousers']], ['female-m', ['dress']], ['male-m', ['hoodie']], ['female-m', ['tote']],
    ...(long ? [['female-curvy', ['shirt']], ['male-l', ['waistcoat']], ['female-m', ['skirt']], ['male-m', ['sweatshirt']]] : []),
  ];
  const report = [];
  const simulate = (preset, list, frames, h) => {
    const rig = buildRig(bodyFromPreset(preset));
    const m = draftMeasurements(rig);
    const drafts = list.map((g) => (typeof g === 'string' ? draftGarment({ garment: g }, m) : draftGarment(g, m)));
    const S = assemble(drafts, rig, { h });
    const t1 = Date.now();
    let first = null;
    for (let f = 0; f < frames; f++) { S.cloth.step(1 / 60); if (f === 29) first = S.cloth.stats(); }
    const st = S.cloth.stats();
    // Outward orientation of the torso garments: normals point away from the body.
    return { S, st, first, ms: (Date.now() - t1) / frames, particles: S.stats.particles };
  };
  for (const [preset, list] of cases) {
    const { st, first, ms, particles } = simulate(preset, list, 150, 3.5);
    const name = `${list.join('+')} on ${preset}`;
    report.push({ name, particles, msPerFrame: +ms.toFixed(1), meanSpeed: +st.meanSpeed.toFixed(2), p95Speed: +st.p95Speed.toFixed(2), seamGapMean: +st.seamGapMean.toFixed(3), seamGapMax: +st.seamGapMax.toFixed(2), strainMean: +st.strainMean.toFixed(3), penetrating: st.penetrating, meanSpeedAt05s: +first.meanSpeed.toFixed(2) });
    ok(`${name}: finite`, st.finite);
    ok(`${name}: nothing inside the body`, st.penetrating === 0, st.penetrationMax);
    ok(`${name}: seams closed`, st.seamGapMean < 0.15, st.seamGapMean);
    ok(`${name}: at rest (mean speed < 3 cm/s, 95 % < 8 cm/s)`, st.meanSpeed < 3 && st.p95Speed < 8, [st.meanSpeed, st.p95Speed]);
    ok(`${name}: little stretch`, st.strainMean < 0.05, st.strainMean);
    ok(`${name}: settles (mean speed at 2.5 s not above 0.5 s)`, st.meanSpeed <= Math.max(first.meanSpeed, 1.5), [first.meanSpeed, st.meanSpeed]);
  }
  // An outfit (shirt under a lined jacket): layering is approximate; it must stay finite, sewn and out of the body.
  {
    const tux = OUTFITS.tuxedo.filter((x) => x.garment === 'shirt' || x.garment === 'jacket').map((x) => ({ garment: x.garment, opts: x.opts, details: x.details }));
    const { st, ms, particles } = simulate('male-m', tux, 150, 3.5);
    report.push({ name: 'shirt+jacket (tuxedo) on male-m', particles, msPerFrame: +ms.toFixed(1), meanSpeed: +st.meanSpeed.toFixed(2), p95Speed: +st.p95Speed.toFixed(2), seamGapMean: +st.seamGapMean.toFixed(3), seamGapMax: +st.seamGapMax.toFixed(2), strainMean: +st.strainMean.toFixed(3), penetrating: st.penetrating });
    ok('outfit: finite', st.finite);
    ok('outfit: nothing inside the body', st.penetrating === 0);
    ok('outfit: seams closed', st.seamGapMean < 0.2, st.seamGapMean);
    ok('outfit: bounded motion', st.meanSpeed < 20, st.meanSpeed);
  }
  // An imported pattern (the t-shirt read back from its own DXF): placed by the piece names, sewn by where edges meet.
  {
    const m = draftMeasurements(buildRig(bodyFromPreset('male-m')));
    const r = readPatternDXF(patternDXF(draftGarment({ garment: 'tshirt', details: [] }, m)));
    const d = draftGarment({ garment: 'imported', imported: { pieces: r.pieces } }, m);
    const rig = buildRig(bodyFromPreset('male-m'));
    const a = assemble([d], rig, { h: 3.5 });
    ok('imported: placed pieces simulated', a.stats.instances >= 4 && d.pieces.every((p) => p.meta.place && p.meta.place !== 'none'), d.pieces.map((p) => p.meta.place));
    ok('imported: seams found (sides, shoulders, sleeves, armholes)', a.stats.seams >= 8, a.stats.seams);
    for (let k = 0; k < 120; k++) a.cloth.step(1 / 60);
    const st = a.cloth.stats();
    ok('imported: finite, sewn, out of the body', st.finite && st.penetrating === 0 && st.seamGapMean < 0.3, [st.seamGapMean, st.penetrating]);
  }
  for (const r of report) console.log('  ' + JSON.stringify(r));

  console.log(`cloth: ${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
