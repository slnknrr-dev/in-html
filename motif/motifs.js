// motif/motifs.js - built-in vector motifs, defined in a unit box ([-1, 1] on both axes, y down) as closed polygons
// (curves flattened): dot, ring, star, heart, leaf, flower, diamond, triangle, cross, moon, drop, paisley, chevron, wave
// band, square, hexagon. Used by repeats, placement prints and the mockup.
//
//   MOTIFS { id: { polys: [[[x, y], ...]], fill: 'nonzero' } }, motifPolys(id), motifPath(id) (SVG path data, unit box)
//
// Why flattened polygons and not SVG path strings or Path2D: the same geometry must feed the pure-JS rasterizer
// (raster.js, which only fills polygons), the SVG writer and hit tests, in Node and the browser. Flattening once at
// module load (14-40 points per curve) makes every consumer trivial; the cost is a fixed tessellation, invisible at
// print sizes because motifs are small relative to the 4x-supersampled pixel grid.
// Fill rule is non-zero everywhere; holes are expressed by opposite winding (see hole()), never by even-odd, so
// overlapping petals of a flower union instead of cancelling.

const circle = (cx, cy, r, n = 40, ccw = false) => Array.from({ length: n }, (_, i) => { const a = ((ccw ? -1 : 1) * i * 2 * Math.PI) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
// Cubic Bezier sampled at t = 0, 1/n, ..., (n-1)/n: the end point is omitted on purpose because the next segment
// starts there; chaining segments therefore produces no duplicate vertices (zero-length edges).
const bez = (p0, p1, p2, p3, n = 14) => Array.from({ length: n }, (_, i) => { const t = i / n, u = 1 - t; return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]; });
const rot = (pts, a) => pts.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);

// Alternating outer / inner radius, starting at the top (-PI/2, y down). 0.42 approximates the classic pentagram
// inner ratio (0.382) slightly fattened so small prints do not lose the tips.
function star(points = 5, inner = 0.42) {
  return Array.from({ length: points * 2 }, (_, i) => { const r = i % 2 ? inner : 1, a = -Math.PI / 2 + (i * Math.PI) / points; return [r * Math.cos(a), r * Math.sin(a)]; });
}
function heart() {
  return [...bez([0, 0.95], [-0.55, 0.55], [-1.05, 0.1], [-0.95, -0.4]), ...bez([-0.95, -0.4], [-0.85, -1.0], [-0.1, -1.0], [0, -0.45]),
    ...bez([0, -0.45], [0.1, -1.0], [0.85, -1.0], [0.95, -0.4]), ...bez([0.95, -0.4], [1.05, 0.1], [0.55, 0.55], [0, 0.95])];
}
function leaf() { return [...bez([0, -1], [0.75, -0.55], [0.7, 0.45], [0, 1]), ...bez([0, 1], [-0.7, 0.45], [-0.75, -0.55], [0, -1])]; }
function petal(a) { return rot([...bez([0, 0], [0.35, -0.25], [0.3, -0.85], [0, -1]), ...bez([0, -1], [-0.3, -0.85], [-0.35, -0.25], [0, 0])], a); }
function drop() { return [...bez([0, -1], [0.25, -0.45], [0.75, 0.05], [0.6, 0.55]), ...bez([0.6, 0.55], [0.45, 1.05], [-0.45, 1.05], [-0.6, 0.55]), ...bez([-0.6, 0.55], [-0.75, 0.05], [-0.25, -0.45], [0, -1])]; }
function paisley() {
  return [...bez([0.55, -1], [0.1, -0.75], [-0.85, -0.2], [-0.75, 0.45]), ...bez([-0.75, 0.45], [-0.65, 1.05], [0.6, 1.05], [0.75, 0.35]),
    ...bez([0.75, 0.35], [0.85, -0.15], [0.35, -0.25], [0.3, -0.55]), ...bez([0.3, -0.55], [0.28, -0.75], [0.4, -0.9], [0.55, -1])];
}
// Crescent: the left arc of the unit circle and the left arc of a circle through the same two points.
function moon() {
  const outer = Array.from({ length: 33 }, (_, i) => { const a = ((60 + (240 * i) / 32) * Math.PI) / 180; return [Math.cos(a), Math.sin(a)]; });
  const c = 0.45, r = Math.hypot(0.5 - c, Math.sin(Math.PI / 3)), a0 = Math.atan2(-Math.sin(Math.PI / 3), 0.5 - c);
  const inner = Array.from({ length: 31 }, (_, i) => { const a = a0 - ((2 * Math.PI + 2 * a0) * (i + 1)) / 32; return [c + r * Math.cos(a), r * Math.sin(a)]; });
  return [...outer, ...inner];
}
// Shoelace formula; its sign gives the winding direction (positive = clockwise on a y-down canvas).
const signedArea = (p) => p.reduce((s, q, i) => { const n = p[(i + 1) % p.length]; return s + q[0] * n[1] - n[0] * q[1]; }, 0) / 2;
// An inner loop wound against its outer loop: a hole under the non-zero rule.
const hole = (outer, inner) => (Math.sign(signedArea(outer)) === Math.sign(signedArea(inner)) ? inner.slice().reverse() : inner);

export const MOTIFS = {
  dot: { polys: [circle(0, 0, 1)] },
  ring: { polys: [circle(0, 0, 1), hole(circle(0, 0, 1), circle(0, 0, 0.6, 40))] },
  star: { polys: [star()] },
  heart: { polys: [heart()] },
  leaf: { polys: [leaf()] },
  flower: { polys: [...[0, 1, 2, 3, 4].map((i) => petal((i * 2 * Math.PI) / 5)), circle(0, 0, 0.22, 24)] },
  diamond: { polys: [[[0, -1], [0.62, 0], [0, 1], [-0.62, 0]]] },
  triangle: { polys: [[[0, -1], [0.95, 0.75], [-0.95, 0.75]]] },
  cross: { polys: [[[-0.3, -1], [0.3, -1], [0.3, -0.3], [1, -0.3], [1, 0.3], [0.3, 0.3], [0.3, 1], [-0.3, 1], [-0.3, 0.3], [-1, 0.3], [-1, -0.3], [-0.3, -0.3]]] },
  moon: { polys: [moon()] },
  drop: { polys: [drop()] },
  paisley: { polys: [paisley(), hole(paisley(), circle(0.05, 0.35, 0.28, 24))] },
  chevron: { polys: [[[-1, -0.2], [0, -1], [1, -0.2], [1, 0.35], [0, -0.45], [-1, 0.35]]] },
  wave: { polys: [[...Array.from({ length: 33 }, (_, i) => [-1 + i / 16, -0.15 + 0.35 * Math.sin((i / 16) * Math.PI * 2)]), ...Array.from({ length: 33 }, (_, i) => [1 - i / 16, 0.25 + 0.35 * Math.sin(((32 - i) / 16) * Math.PI * 2)])]] },
  square: { polys: [[[-1, -1], [1, -1], [1, 1], [-1, 1]]] },
  hexagon: { polys: [Array.from({ length: 6 }, (_, i) => [Math.cos((i * Math.PI) / 3), Math.sin((i * Math.PI) / 3)])] },
};

export const motifPolys = (id) => (MOTIFS[id] || MOTIFS.dot).polys;

// SVG path data in the unit box.
export function motifPath(id) {
  return motifPolys(id).map((p) => 'M' + p.map((q) => q[0].toFixed(3) + ' ' + q[1].toFixed(3)).join('L') + 'Z').join('');
}
