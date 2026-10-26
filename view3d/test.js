// view3d/test.js - tests of the view3d library: `node view3d/test.js` (importing the module runs nothing). Matrix
// maths (projection of known points, lookAt orthonormality, the orbit camera), normals, the shading model (energy
// bounds, lit side brighter), and the software renderer on a small scene: background gradient, a cube in the middle,
// depth test, culling, depth bias, textures, supersampling.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { perspective, lookAt, mul, transformPoint, orbitCamera, computeNormals } from './math.js';
import { shade, toLinear, toSRGB, LIGHTS } from './shade.js';
import { renderSoft } from './soft.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// A cube of size s centred at c (outward winding).
function cube(c = [0, 0, 0], s = 1) {
  const h = s / 2, P = [];
  for (let i = 0; i < 8; i++) P.push(c[0] + (i & 1 ? h : -h), c[1] + (i & 2 ? h : -h), c[2] + (i & 4 ? h : -h));
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  const I = [];
  for (const [a, b, cc, d] of quads) I.push(a, b, cc, a, cc, d);
  return { positions: new Float32Array(P), indices: new Uint32Array(I) };
}

export async function run() {
  let pass = 0, fail = 0;
  const t0 = Date.now();
  const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${typeof info === 'string' ? info : JSON.stringify(info)}`); } };
  const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

  // --- matrices
  {
    const V = lookAt([0, 0, 10], [0, 0, 0]);
    const p = transformPoint(V, [1, 2, 0]);
    ok('lookAt: target 10 in front', near(p[0], 1) && near(p[1], 2) && near(p[2], -10), p);
    const V2 = lookAt([3, 4, 5], [0, 1, 0]);
    const rows = [0, 1, 2].map((r) => [V2[r], V2[4 + r], V2[8 + r]]);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    ok('lookAt: orthonormal rotation', near(dot(rows[0], rows[1]), 0) && near(dot(rows[1], rows[2]), 0) && near(dot(rows[0], rows[0]), 1, 1e-5), rows);
    const P = perspective(Math.PI / 2, 1, 1, 100);
    const ndc = (q) => { const c = transformPoint(P, q); return [c[0] / c[3], c[1] / c[3], c[2] / c[3]]; };
    const n = ndc([0, 0, -1]), f = ndc([0, 0, -100]), e = ndc([1, 1, -1]);
    ok('perspective: near plane -> -1, far plane -> +1', near(n[2], -1, 1e-5) && near(f[2], 1, 1e-4), [n, f]);
    ok('perspective: 90° frustum edge -> ±1', near(e[0], 1, 1e-5) && near(e[1], 1, 1e-5), e);
    const I = mul(P, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
    ok('mul: identity', I.every((v, i) => near(v, P[i])));
    const cam = orbitCamera({ target: [0, 100, 0], distance: 200, yaw: Math.PI / 2, pitch: 0 });
    ok('orbit camera: yaw 90° looks from +x', near(cam.eye[0], 200, 1e-6) && near(cam.eye[1], 100) && near(cam.eye[2], 0, 1e-6), cam.eye);
    const t = transformPoint(cam.viewProj(1), [0, 100, 0]);
    ok('orbit camera: target at the centre of the view', near(t[0], 0, 1e-5) && near(t[1], 0, 1e-5), t);
  }
  // --- normals
  {
    const c = cube();
    const N = computeNormals(c.positions, c.indices);
    let outward = true;
    for (let v = 0; v < 8; v++) {
      const d = c.positions[v * 3] * N[v * 3] + c.positions[v * 3 + 1] * N[v * 3 + 1] + c.positions[v * 3 + 2] * N[v * 3 + 2];
      if (!(d > 0) || !near(Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]), 1, 1e-5)) outward = false;
    }
    ok('normals: unit and outward on a cube', outward);
  }
  // --- shading
  {
    const L = LIGHTS[0].dir, l = Math.hypot(...L), toLight = L.map((x) => x / l);
    const lit = shade([0.5, 0.5, 0.5], toLight, toLight), dark = shade([0.5, 0.5, 0.5], toLight.map((x) => -x), toLight);
    ok('shade: the side facing the key light is brighter', lit[0] > dark[0], [lit, dark]);
    let bounded = true;
    for (let i = 0; i < 200; i++) {
      const a = (i * 2.399) % (2 * Math.PI), z = (i / 100) - 1, r = Math.sqrt(1 - z * z);
      const n = [r * Math.cos(a), z, r * Math.sin(a)];
      const s = shade([1, 1, 1], n, [0, 0, 1], 1, 0.2);
      if (!s.every((x) => Number.isFinite(x) && x >= 0 && x < 4)) bounded = false;
    }
    ok('shade: finite and bounded', bounded);
    ok('sRGB round trip', near(toSRGB(toLinear(0.5)), 0.5, 1e-9));
  }
  // --- software renderer
  {
    const cam = orbitCamera({ target: [0, 0, 0], distance: 6, yaw: 0.5, pitch: 0.4, fov: 0.6 });
    const red = { ...cube(), color: [0.9, 0.1, 0.1], doubleSided: false };
    const img = renderSoft({ meshes: [red] }, cam, { width: 80, height: 60, background: [[0, 0, 1], [0, 1, 0]] });
    const px = (x, y) => Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
    ok('render: size and alpha', img.width === 80 && img.height === 60 && img.data.length === 80 * 60 * 4 && px(0, 0)[3] === 255);
    const top = px(1, 1), bottom = px(1, 58), mid = px(40, 30);
    ok('render: background gradient top -> bottom', top[2] > top[1] && bottom[1] > bottom[2], [top, bottom]);
    ok('render: the cube in the middle is red', mid[0] > 2 * mid[1] && mid[0] > 2 * mid[2], mid);
    // A blue cube behind the red one is hidden; with a depth bias larger than the gap it wins.
    const blue = { ...cube([0, 0, -0.05], 0.9), color: [0.1, 0.1, 0.9], doubleSided: false };
    const cam0 = orbitCamera({ target: [0, 0, 0], distance: 6, yaw: 0, pitch: 0, fov: 0.6 });
    const a = renderSoft({ meshes: [red, blue] }, cam0, { width: 60, height: 60 });
    const b = renderSoft({ meshes: [red, { ...blue, bias: 0.3 }] }, cam0, { width: 60, height: 60 });
    const c0 = (im) => Array.from(im.data.slice((30 * 60 + 30) * 4, (30 * 60 + 30) * 4 + 3));
    ok('render: depth test', c0(a)[0] > c0(a)[2], c0(a));
    ok('render: depth bias wins over a small gap', c0(b)[2] > c0(b)[0], c0(b));
    // Culling the front faces leaves the inside of a cube visible (linings), seen as the darker back side.
    const inside = renderSoft({ meshes: [{ ...cube(), color: [0.9, 0.9, 0.9], cull: 'front' }] }, cam0, { width: 60, height: 60, background: [[0, 0, 0], [0, 0, 0]] });
    const ci = c0(inside), outside = c0(renderSoft({ meshes: [{ ...cube(), color: [0.9, 0.9, 0.9] }] }, cam0, { width: 60, height: 60 }));
    ok('render: front culling shows the inside, darker', ci[0] > 0 && ci[0] < outside[0], [ci, outside]);
    // Texture: a 2 x 1 texture, left half green, right half magenta, on a quad facing the camera.
    const quad = { positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), indices: new Uint32Array([0, 1, 2, 0, 2, 3]), uvs: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
      texture: { width: 2, height: 1, data: new Uint8ClampedArray([0, 255, 0, 255, 255, 0, 255, 255]) }, color: [1, 1, 1] };
    const tq = renderSoft({ meshes: [quad] }, cam0, { width: 60, height: 60 });
    const l = Array.from(tq.data.slice((30 * 60 + 24) * 4, (30 * 60 + 24) * 4 + 3)), r = Array.from(tq.data.slice((30 * 60 + 36) * 4, (30 * 60 + 36) * 4 + 3));
    ok('render: texture sampled across the quad', l[1] > l[0] && r[0] > r[1], [l, r]);
    const ss = renderSoft({ meshes: [red] }, cam, { width: 40, height: 30, ss: 2 });
    ok('render: supersampled output at the requested size', ss.width === 40 && ss.height === 30 && ss.data.length === 40 * 30 * 4);
  }

  console.log(`view3d: ${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
