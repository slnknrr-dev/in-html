// view3d/shade.js - the lighting shared by the WebGL and the software renderers, so both draw the same picture: a key
// light from the front left above, a cool fill from the right, a rim light from behind, hemisphere ambient (sky /
// ground), Lambert diffuse with a soft wrap for cloth, a Blinn-Phong highlight whose width and strength follow the
// fabric's sheen and roughness, and a darker inside for back faces (the inside of a garment).
//
// Single source of truth for lighting: this file holds the constants and the reference implementation; the GLSL in
// webgl.js mirrors shade() line for line, so a change here must be made there as well.

export const LIGHTS = [
  { dir: [-0.45, 0.62, 0.64], color: [1.0, 0.97, 0.92], k: 0.82 },
  { dir: [0.75, 0.25, 0.45], color: [0.75, 0.82, 1.0], k: 0.32 },
  { dir: [0.1, 0.5, -0.86], color: [1.0, 1.0, 1.0], k: 0.35 },
];
export const SKY = [0.42, 0.44, 0.48], GROUND = [0.24, 0.23, 0.22];

const normalize = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const L = LIGHTS.map((l) => ({ ...l, dir: normalize(l.dir) }));

// Colour of a surface point: base [0..1]^3, normal (unit, facing the viewer), view direction (unit, towards the eye).
// Wrapped Lambert ((n.l + 0.25) / 1.25): light reaches slightly past the terminator, imitating cloth's subsurface
// scattering and softening the hard shadow edge plain Lambert gives on folds. Blinn-Phong exponent goes from 8
// (rough) to 98 (smooth); highlight strength 0.04 base plus sheen, 0.04 being the typical dielectric reflectance.
export function shade(base, n, v, sheen = 0.1, rough = 0.6, inside = false) {
  const hemi = 0.5 + 0.5 * n[1];
  let r = base[0] * (GROUND[0] + (SKY[0] - GROUND[0]) * hemi), g = base[1] * (GROUND[1] + (SKY[1] - GROUND[1]) * hemi), b = base[2] * (GROUND[2] + (SKY[2] - GROUND[2]) * hemi);
  const shin = 8 + (1 - rough) * 90;
  for (const l of L) {
    const nd = n[0] * l.dir[0] + n[1] * l.dir[1] + n[2] * l.dir[2];
    const diff = Math.max(0, (nd + 0.25) / 1.25) * l.k;
    r += base[0] * l.color[0] * diff; g += base[1] * l.color[1] * diff; b += base[2] * l.color[2] * diff;
    if (nd > 0) {
      const hx = l.dir[0] + v[0], hy = l.dir[1] + v[1], hz = l.dir[2] + v[2], hl = Math.hypot(hx, hy, hz) || 1;
      const sp = Math.pow(Math.max(0, (n[0] * hx + n[1] * hy + n[2] * hz) / hl), shin) * (0.04 + sheen * 0.9) * l.k;
      r += sp * l.color[0]; g += sp * l.color[1]; b += sp * l.color[2];
    }
  }
  const k = inside ? 0.62 : 1;
  return [r * k, g * k, b * k];
}

// sRGB <-> linear (textures are sRGB; lighting is done in linear light and encoded back).
// Gamma 2.2 approximation of the sRGB curve: within a few percent of the piecewise formula and identical in GLSL
// (pow), so both renderers agree exactly.
export const toLinear = (c) => Math.pow(c, 2.2);
export const toSRGB = (c) => Math.pow(Math.max(0, Math.min(1, c)), 1 / 2.2);
