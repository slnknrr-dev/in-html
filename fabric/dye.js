// fabric/dye.js - dyeing over a fabric: the dye is applied to the finished garment (or the cut pieces), so it lies in
// the garment's frame of centimetres, not in the weave tile. The dye colour multiplies the fabric colour (as a real
// overdye does: white takes the dye, dark stays dark), weighted by the dye's coverage at the point:
//
//   none     no dye
//   ombre    a gradient along a direction (angle, degrees; 90 = downwards) from `from` to `to` cm
//   dip      dipped from the hem: full below `level` cm (measured down from the top of the frame), a soft band `soft`
//   tieDye   rings round a centre (cx, cy) with `rings` per 10 cm and a ragged edge
//   spray    speckles of `amount` coverage, seeded
//
//   DYES, normalizeDye(raw), dyeWeight(dye, x, y) -> 0..1, applyDye(rgb, dye, x, y) -> rgb (0..255)
//
// Why dye is separate from the weave colours: a weave tile repeats every few millimetres, while an ombre spans the
// whole garment. Evaluating the dye per pixel in garment centimetres (not baking it into the tile) keeps the tile
// small and seamless and lets one fabric take any dye placement.

export const DYES = ['none', 'ombre', 'dip', 'tieDye', 'spray'];
const hexRe = /^#[0-9a-f]{6}$/i;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function normalizeDye(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const kind = DYES.includes(r.kind) ? r.kind : 'none';
  return {
    kind, color: hexRe.test(r.color) ? r.color : '#2a4a8a', strength: clamp(num(r.strength, 0.85), 0, 1),
    angle: clamp(num(r.angle, 90), -180, 180), from: clamp(num(r.from, 0), -50, 250), to: clamp(num(r.to, 70), -50, 250),
    level: clamp(num(r.level, 45), 0, 250), soft: clamp(num(r.soft, 6), 0, 60),
    cx: clamp(num(r.cx, 30), -100, 300), cy: clamp(num(r.cy, 30), -100, 300), rings: clamp(num(r.rings, 3), 0.5, 12),
    amount: clamp(num(r.amount, 0.35), 0, 1), seed: Math.round(clamp(num(r.seed, 7), 0, 1e6)),
  };
}

// GLSL-style smoothstep: C1-continuous edges, so dye bands have no visible Mach bands. The `|| 1e-6` guards e0 === e1.
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / ((e1 - e0) || 1e-6), 0, 1); return t * t * (3 - 2 * t); };
// Value noise for ragged edges and speckles (deterministic).
// Integer lattice hash -> [0, 1). Uses ordinary float multiplication, not Math.imul, so products above 2^53 are
// rounded; the result is still deterministic across engines (IEEE doubles), which is all a seeded pattern needs.
function hash(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
// Value noise: bilinear interpolation of lattice hashes with a smoothstep fade. Cheaper than Perlin and adequate for
// ragged dye edges, where gradient-noise isotropy is not noticeable.
function noise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Coverage of the dye at (x, y) cm, 0..1. */
export function dyeWeight(dye, x, y) {
  const d = dye;
  if (!d || d.kind === 'none') return 0;
  if (d.kind === 'ombre') {
    const a = (d.angle * Math.PI) / 180;
    const s = x * Math.cos(a) + y * Math.sin(a);
    return smooth(d.from, d.to, s) * d.strength;
  }
  if (d.kind === 'dip') {
    const rag = (noise(x / 4, y / 4, d.seed) - 0.5) * Math.min(4, d.soft);
    return smooth(d.level - d.soft / 2, d.level + d.soft / 2, y + rag) * d.strength;
  }
    // Concentric rings: cosine of radius gives alternating dyed / resisted bands (the binding pattern of tie-dye);
    // noise added to the radius makes the edges ragged, as real dye wicking does.
  if (d.kind === 'tieDye') {
    const r = Math.hypot(x - d.cx, y - d.cy) + (noise(x / 3, y / 3, d.seed) - 0.5) * 4;
    const phase = (r * d.rings) / 10;
    const band = 0.5 + 0.5 * Math.cos(phase * Math.PI * 2);
    return clamp(smooth(0.25, 0.75, band), 0, 1) * d.strength;
  }
    // Two octaves of noise thresholded around 1 - amount: `amount` approximates the covered area fraction.
  if (d.kind === 'spray') {
    const n = noise(x * 1.7, y * 1.7, d.seed) * 0.6 + noise(x * 6, y * 6, d.seed + 1) * 0.4;
    return smooth(1 - d.amount - 0.08, 1 - d.amount + 0.08, n) * d.strength;
  }
  return 0;
}

const hexRGB = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** The dyed colour of a fabric colour [r, g, b] at (x, y) cm (multiply blend weighted by the coverage). */
// Multiply blend lerped by coverage: dye only darkens (white takes the dye colour, black stays black), matching how
// a translucent dye bath behaves. `out` avoids allocating per pixel; the parsed dye colour is memoised on the object.
export function applyDye(rgb, dye, x, y, out = [0, 0, 0]) {
  const w = dyeWeight(dye, x, y);
  if (!w) { out[0] = rgb[0]; out[1] = rgb[1]; out[2] = rgb[2]; return out; }
  const c = dye._rgb || (dye._rgb = hexRGB(dye.color));
  for (let k = 0; k < 3; k++) out[k] = rgb[k] * (1 - w) + ((rgb[k] * c[k]) / 255) * w;
  return out;
}

/** SVG paint of a dyed fill over a box (a gradient for ombre / dip, a radial one for tie-dye; stops at `alpha`): { defs, fill } or null. */
// Vector approximation for SVG previews: gradients reproduce ombre / dip / tie-dye structure; noise cannot be
// expressed in a gradient, so spray degrades to a flat average-coloured fill.
export function dyeSVG(dye, base, id, box, alpha = 1) {
  const op = ` stop-opacity="${alpha}"`;
  if (!dye || dye.kind === 'none') return null;
  const [r, g, b] = hexRGB(base);
  const dyed = applyDye([r, g, b], { ...dye, kind: 'ombre', from: -1, to: 0, angle: 0 }, 1, 0);
  const col = `rgb(${dyed.map((v) => Math.round(v)).join(',')})`;
  if (dye.kind === 'tieDye') {
    const R = Math.max(box.w, box.h);
    const stops = Array.from({ length: 9 }, (_, i) => `<stop offset="${(i / 8).toFixed(3)}" stop-color="${i % 2 ? base : col}"${op}/>`).join('');
    return { defs: `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${dye.cx}" cy="${dye.cy}" r="${R}">${stops}</radialGradient>`, fill: `url(#${id})` };
  }
  if (dye.kind === 'spray') return { defs: `<linearGradient id="${id}"><stop offset="0" stop-color="${col}"${op}/></linearGradient>`, fill: `url(#${id})` };
  const y0 = dye.kind === 'dip' ? dye.level - dye.soft / 2 : dye.from, y1 = dye.kind === 'dip' ? dye.level + dye.soft / 2 : dye.to;
  return { defs: `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${y0}" x2="0" y2="${y1}"><stop offset="0" stop-color="${base}"${op}/><stop offset="1" stop-color="${col}"${op}/></linearGradient>`, fill: `url(#${id})` };
}
