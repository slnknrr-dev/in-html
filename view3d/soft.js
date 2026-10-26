// view3d/soft.js - a software renderer for the same scenes the WebGL renderer draws: perspective projection, z-buffer,
// perspective-correct texture coordinates, Gouraud lighting from view3d/shade.js computed per vertex for both faces
// (garments show their darker inside), bilinear textures, a soft ground shadow and optional supersampling. Pure JS, so it
// is the fallback without WebGL and renders mockup images in Node.
//
//   renderSoft(scene, camera, { width, height, ss = 1, background: [top, bottom] }) -> { width, height, data }
//   scene = { meshes: [{ positions, normals?, indices, uvs?, texture? { width, height, data }, color [r, g, b] 0..1,
//             sheen, roughness, doubleSided, cull: 'front' (linings: seen only from inside), bias (world units toward the eye
//             for the depth test: outer garments win over small penetrations) }], shadow: { center: [x, z], radius } }
//
// Pipeline: background gradient (linear space) -> shadow -> per mesh: vertex lighting, then scanline-free
// half-space rasterization (bounding box + barycentric tests) with a z-buffer -> box-filter downsample -> sRGB.
// All shading accumulates in a Float32 linear buffer; quantising to 8-bit only at the end avoids banding.

import { computeNormals, transformPoint } from './math.js';
import { shade, toLinear, toSRGB } from './shade.js';

const hexOr = (c) => (Array.isArray(c) ? c : [0.8, 0.8, 0.8]);

export function renderSoft(scene, cam, o = {}) {
  const ss = Math.max(1, o.ss | 0 || 1);
  const W = (o.width || 480) * ss, H = (o.height || 640) * ss;
  const color = new Float32Array(W * H * 3);
  const depth = new Float32Array(W * H).fill(Infinity);
  const [top, bot] = o.background || [[0.93, 0.94, 0.96], [0.8, 0.82, 0.86]];
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; for (let k = 0; k < 3; k++) color[i + k] = toLinear(top[k] + (bot[k] - top[k]) * t); }
  }
  const VP = cam.viewProj(W / H);
  // Perspective divide to NDC, then to pixels with y flipped (screen y grows downward). w is kept for perspective-
  // correct interpolation and for rejecting points behind the camera (w <= 0).
  const toScreen = (p) => {
    const c = transformPoint(VP, p);
    return [(c[0] / c[3] * 0.5 + 0.5) * W, (1 - (c[1] / c[3] * 0.5 + 0.5)) * H, c[2] / c[3], c[3]];
  };
  // Ground shadow: a soft dark disc on the floor (y = 0) drawn into the background.
  if (scene.shadow) {
    const { center, radius } = scene.shadow;
    const steps = 48;
    for (let a = 0; a < steps; a++) {
      for (let r = 0; r < 1; r += 0.02) {
        const ang = (a / steps) * Math.PI * 2;
        const p = toScreen([center[0] + Math.cos(ang) * radius * r, 0, center[1] + Math.sin(ang) * radius * 0.6 * r]);
        const x = Math.round(p[0]), y = Math.round(p[1]);
        if (x < 0 || y < 0 || x >= W || y >= H || p[3] <= 0) continue;
        const k = 1 - 0.35 * (1 - r) ** 1.5 / steps * 6;
        for (let dy = -ss * 3; dy <= ss * 3; dy++) for (let dx = -ss * 3; dx <= ss * 3; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const i = (yy * W + xx) * 3;
          color[i] *= k; color[i + 1] *= k; color[i + 2] *= k;
        }
      }
    }
  }
  const eye = cam.eye;
  for (const m of scene.meshes) {
    const P = m.positions, I = m.indices;
    const N = m.normals || computeNormals(P, I);
    const nv = P.length / 3;
    const scr = new Float32Array(nv * 4);
    const front = new Float32Array(nv * 6), back = new Float32Array(nv * 6); // diffuse rgb + specular rgb
    const base = hexOr(m.color).map(toLinear);
    const tex = m.texture;
    // Gouraud with textures: lighting is computed per vertex with a white base, then multiplied by the per-pixel
    // texel; that keeps texture detail sharp while lighting stays cheap. Two light sets (front, back) per vertex let
    // either face of a garment be drawn without recomputation.
    const lightBase = tex ? [1, 1, 1] : base;
    for (let v = 0; v < nv; v++) {
      const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
      const vd = [eye[0] - p[0], eye[1] - p[1], eye[2] - p[2]], vl = Math.hypot(...vd) || 1;
      const view = [vd[0] / vl, vd[1] / vl, vd[2] / vl];
      const bias = m.bias || 0;
      const s = toScreen(bias ? [p[0] + view[0] * bias, p[1] + view[1] * bias, p[2] + view[2] * bias] : p);
      scr.set(s, v * 4);
      const n = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]];
      // Diffuse with a white base, specular with a black base: their sum reconstructs shade() for any texel.
      const dF = shade(lightBase, n, view, 0, m.roughness ?? 0.6), sF = shade([0, 0, 0], n, view, m.sheen ?? 0.1, m.roughness ?? 0.6);
      const nb = [-n[0], -n[1], -n[2]];
      const dB = shade(lightBase, nb, view, 0, 1, true), sB = shade([0, 0, 0], nb, view, (m.sheen ?? 0.1) * 0.3, 1, true);
      // KNOWN DEFECT: dF is shade() with sheen 0, which still contains the 0.04 base specular, and sF contains it
      // again; the base specular is therefore multiplied by the texel colour and also added on top, slightly
      // over-brightening highlights versus the GLSL path. The `- sF[k] * 0` is a vestige of an intended subtraction.
      // Fix: compute dF with a variant of shade() that omits the specular term.
      for (let k = 0; k < 3; k++) { front[v * 6 + k] = dF[k] - sF[k] * 0; front[v * 6 + 3 + k] = sF[k]; back[v * 6 + k] = dB[k]; back[v * 6 + 3 + k] = sB[k]; }
    }
    const UV = m.uvs;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2];
      const ax = scr[a * 4], ay = scr[a * 4 + 1], bx = scr[b * 4], by = scr[b * 4 + 1], cx = scr[c * 4], cy = scr[c * 4 + 1];
      if (scr[a * 4 + 3] <= 0 || scr[b * 4 + 3] <= 0 || scr[c * 4 + 3] <= 0) continue;
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-9) continue;
      // Counter-clockwise on screen (y down: negative area) is the front face.
      const isFront = area < 0;
      // Linings use cull 'front': only their inside is drawn, so they show through openings without z-fighting the
      // shell from outside. doubleSided === false (the body) draws front faces only.
      if ((!isFront && m.doubleSided === false) || (isFront && m.cull === 'front')) continue;
      const L = isFront ? front : back;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
      const iwa = 1 / scr[a * 4 + 3], iwb = 1 / scr[b * 4 + 3], iwc = 1 / scr[c * 4 + 3];
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5;
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          let w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
          let w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
          let w2 = 1 - w0 - w1;
          // Small negative tolerance closes hairline cracks between adjacent triangles caused by rounding; the price
          // is an occasional doubly-covered pixel on shared edges, invisible after the depth test.
          if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
          const z = w0 * scr[a * 4 + 2] + w1 * scr[b * 4 + 2] + w2 * scr[c * 4 + 2];
          const di = y * W + x;
          if (z >= depth[di] || z < -1) continue;
          depth[di] = z;
          // Perspective-correct weights.
          // Screen-space barycentrics are not linear in world space; weighting by 1/w and renormalising gives the
          // perspective-correct weights used for UVs and lighting (depth itself is interpolated linearly in NDC,
          // which is correct for z/w).
          const q0 = w0 * iwa, q1 = w1 * iwb, q2 = w2 * iwc, qs = q0 + q1 + q2;
          w0 = q0 / qs; w1 = q1 / qs; w2 = q2 / qs;
          let br = base[0], bg = base[1], bb = base[2];
          if (tex && UV) {
            const u = w0 * UV[a * 2] + w1 * UV[b * 2] + w2 * UV[c * 2], v = w0 * UV[a * 2 + 1] + w1 * UV[b * 2 + 1] + w2 * UV[c * 2 + 1];
            const s = sample(tex, u, v);
            br = toLinear(s[0] / 255); bg = toLinear(s[1] / 255); bb = toLinear(s[2] / 255);
          }
          const ci = di * 3;
          color[ci] = br * (w0 * L[a * 6] + w1 * L[b * 6] + w2 * L[c * 6]) + w0 * L[a * 6 + 3] + w1 * L[b * 6 + 3] + w2 * L[c * 6 + 3];
          color[ci + 1] = bg * (w0 * L[a * 6 + 1] + w1 * L[b * 6 + 1] + w2 * L[c * 6 + 1]) + w0 * L[a * 6 + 4] + w1 * L[b * 6 + 4] + w2 * L[c * 6 + 4];
          color[ci + 2] = bb * (w0 * L[a * 6 + 2] + w1 * L[b * 6 + 2] + w2 * L[c * 6 + 2]) + w0 * L[a * 6 + 5] + w1 * L[b * 6 + 5] + w2 * L[c * 6 + 5];
        }
      }
    }
  }
  // Resolve: supersampling box filter and sRGB encoding.
  const w = W / ss, h = H / ss;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) { const i = ((y * ss + sy) * W + x * ss + sx) * 3; r += color[i]; g += color[i + 1]; b += color[i + 2]; }
    const k = 1 / (ss * ss), o4 = (y * w + x) * 4;
    out[o4] = toSRGB(r * k) * 255; out[o4 + 1] = toSRGB(g * k) * 255; out[o4 + 2] = toSRGB(b * k) * 255; out[o4 + 3] = 255;
  }
  return { width: w, height: h, data: out };
}

// Bilinear with clamp-to-edge, matching the WebGL texture parameters. The -0.5 aligns texel centres with the GPU
// convention; 1.001 keeps x0 + 1 inside the texture.
function sample(t, u, v) {
  const x = Math.max(0, Math.min(t.width - 1.001, u * t.width - 0.5)), y = Math.max(0, Math.min(t.height - 1.001, v * t.height - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  // Neighbours clamped at the edges (textures one texel wide or high).
  const sx = x0 + 1 < t.width ? 4 : 0, sy = y0 + 1 < t.height ? t.width * 4 : 0;
  const i00 = (y0 * t.width + x0) * 4, i10 = i00 + sx, i01 = i00 + sy, i11 = i01 + sx;
  const d = t.data;
  return [0, 1, 2].map((k) => (d[i00 + k] * (1 - fx) + d[i10 + k] * fx) * (1 - fy) + (d[i01 + k] * (1 - fx) + d[i11 + k] * fx) * fy);
}
