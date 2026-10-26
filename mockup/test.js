// mockup/test.js - tests of the mockup library: `node mockup/test.js` (importing the module runs nothing). Spec
// normalisation (never throws, clamps sizes, outfits by name), print areas, piece textures (UVs inside the texture,
// a placement print lands where it was placed), the full preview in Node (a T-shirt with a print draped and rendered
// with the software renderer), baked drapes (a spec with its drape renders without simulating, identically).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SPEC, normalizePreviewSpec, defaultFabric, prepare, resolvePlacement, simulate, coolDown, buildScene, cameraFor, renderPreview, bakeDrape, applyDrape } from './preview.js';
import { pieceTexture } from './texture.js';
import { normalizeFabric } from '../fabric/fabric.js';
import { renderSoft } from '../view3d/soft.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function run() {
  let pass = 0, fail = 0;
  const t0 = Date.now();
  const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${typeof info === 'string' ? info : JSON.stringify(info)}`); } };

  // --- spec normalisation
  {
    let threw = false;
    try { for (const bad of [null, 1, 'x', [], { garments: 7 }, { garments: [{ garment: 'nope' }] }, { view: { width: 1e9 } }, { sim: { frames: -5, h: 99 } }]) normalizePreviewSpec(bad); } catch { threw = true; }
    ok('normalize: never throws', !threw);
    const d = normalizePreviewSpec({});
    ok('normalize: defaults to a T-shirt on a body', d.garments.length === 1 && d.garments[0].garment === 'tshirt' && d.body.preset === DEFAULT_SPEC.body.preset);
    const c = normalizePreviewSpec({ view: { width: 1e9, height: 3 }, sim: { frames: 9999, h: 0.1 } });
    ok('normalize: clamps image size and simulation', c.view.width === 2048 && c.view.height === 64 && c.sim.frames === 600 && c.sim.h === 1.5, [c.view, c.sim]);
    const t = normalizePreviewSpec({ outfit: 'tuxedo', body: 'male-m' });
    ok('normalize: outfit by name, body by preset name', t.garments.map((g) => g.garment).join() === 'shirt,trousers,cummerbund,jacket' && t.body.preset === 'male-m', t.garments.map((g) => g.garment));
    ok('default fabrics by garment and material', defaultFabric('tshirt', 'shell').preset === 'jersey' && defaultFabric('jacket', 'shell').preset === 'suiting' && !!defaultFabric('jacket', 'lining').preset);
  }

  // --- the preview of a T-shirt with a placement print
  const spec = {
    body: { preset: 'female-m' },
    garments: [{ garment: 'tshirt', fabrics: { shell: { preset: 'jersey', color: '#2050a0' } }, placements: [{ area: 'front', x: 0, y: 0, w: 18, art: { kind: 'motif', motif: 'star', color: '#ffdd00' } }] }],
    view: { width: 120, height: 160 }, sim: { frames: 90, h: 3.5 },
  };
  const prep = prepare(spec);
  {
    const g = prep.spec.garments[0], area = prep.drafts[0].printAreas.front;
    ok('print area resolved to its piece and centre', g.placements[0].piece === 'front' && Math.abs(g.placements[0].x - area.center[0]) < 1e-9 && Math.abs(g.placements[0].y - area.center[1]) < 1e-9, g.placements[0]);
    const r = resolvePlacement({ area: 'nope', x: 3, y: 4 }, prep.drafts[0]);
    ok('unknown area: the placement keeps its own position', r.x === 3 && r.y === 4 && r.w === 20, r);
    // Textures: every UV inside [0, 1]; the star's yellow is in the front's texture.
    const front = prep.sim.instances.find((it) => it.pieceId === 'front');
    const tx = pieceTexture(front, { fabric: normalizeFabric({ preset: 'jersey', color: '#2050a0' }), placements: g.placements.filter((pl) => pl.piece === 'front'), pxPerCm: 4 });
    let inside = true;
    for (const v of tx.uv) if (!(v >= 0 && v <= 1)) inside = false;
    ok('piece texture: UVs inside the texture', inside && tx.uv.length === front.count * 2, tx.uv.length);
    let yellow = 0;
    for (let i = 0; i < tx.texture.data.length; i += 4) if (tx.texture.data[i] > 200 && tx.texture.data[i + 1] > 180 && tx.texture.data[i + 2] < 90) yellow++;
    ok('piece texture: the placement print is drawn', yellow > 200, yellow);
    const back = prep.sim.instances.find((it) => it.pieceId === 'back');
    const tb = pieceTexture(back, { fabric: normalizeFabric({ preset: 'jersey', color: '#2050a0' }), placements: [], pxPerCm: 4 });
    let y2 = 0;
    for (let i = 0; i < tb.texture.data.length; i += 4) if (tb.texture.data[i] > 200 && tb.texture.data[i + 1] > 180 && tb.texture.data[i + 2] < 90) y2++;
    ok('piece texture: not on the back', y2 === 0, y2);
  }
  {
    const st = simulate(prep, 90);
    coolDown(prep, 20);
    ok('drape: finite and out of the body', st.finite && st.penetrating === 0, st);
    const scene = buildScene(prep);
    ok('scene: body + every piece instance', scene.meshes.length === 1 + prep.sim.instances.length, scene.meshes.length);
    const img = renderSoft(scene, cameraFor(prep), { width: 120, height: 160 });
    // The T-shirt's blue covers the torso in the middle of the image.
    let blue = 0;
    for (let y = 50; y < 90; y++) for (let x = 45; x < 75; x++) { const i = (y * 120 + x) * 4; if (img.data[i + 2] > img.data[i] + 30) blue++; }
    ok('render: the garment is in the picture', blue > 300, blue);
    // Baked drape: the same positions, no simulation, the same image.
    const baked = bakeDrape(prep);
    const p2 = prepare({ ...spec, drape: baked });
    let same = true;
    for (let i = 0; i < p2.sim.cloth.pos.length; i++) if (p2.sim.cloth.pos[i] !== prep.sim.cloth.pos[i]) { same = false; break; }
    ok('baked drape: positions restored exactly', same && p2.spec.drape);
    const img2 = renderSoft(buildScene(p2), cameraFor(p2), { width: 120, height: 160 });
    let diff = 0;
    for (let i = 0; i < img.data.length; i++) diff = Math.max(diff, Math.abs(img.data[i] - img2.data[i]));
    ok('baked drape: identical rendering', diff <= 1, diff);
    ok('baked drape: refused for another mesh', applyDrape(prepare({ ...spec, garments: [{ garment: 'tank' }] }), baked) === false);
    const imgs = await renderPreview({ ...spec, drape: baked }, { views: [0, Math.PI], width: 60, height: 80 });
    ok('renderPreview: one image per view', imgs.length === 2 && imgs[0].width === 60 && imgs[1].height === 80);
  }

  console.log(`mockup: ${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
