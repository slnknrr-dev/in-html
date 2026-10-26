// cloth/mesh.js - triangle meshes of pattern pieces for the cloth simulation: the outline resampled at the target
// edge length (every edge keeps the list of its boundary vertices, so seams can find them), interior points on a
// hexagonal grid, a Delaunay triangulation (Bowyer-Watson) and removal of the triangles outside the outline. The 2D
// coordinates stay with every vertex: they are the texture coordinates, so a print placed on a piece in 2D lands on the
// same spot in 3D.
//
//   pieceMesh(piece, { h }) -> { xy: Float64Array, tris: Uint32Array, edges: { edgeId: [vertex, ...] }, boundary: n }
//   meshEdges(tris) -> [[a, b], ...] unique edges, bendPairs(tris) -> [[c, d, a, b], ...] (opposite vertices of
//   triangles sharing the edge a-b)

import { inside, plLength, resample } from '../garment/geom.js';

// Bowyer-Watson Delaunay triangulation of points [[x, y], ...] -> flat triangle index array.
// Bowyer-Watson: start from a super-triangle enclosing all points, insert points one by one, delete every triangle
// whose circumcircle contains the point and re-triangulate the cavity from its boundary edges. O(n^2) with the naive
// triangle scan, acceptable for a few thousand vertices per piece. The relative 1e-12 slack on r2 makes co-circular
// points (a regular hex grid has many) resolve consistently instead of leaving slivers or holes.
export function delaunay(pts) {
  const n = pts.length;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  const d = Math.max(x1 - x0, y1 - y0) * 20 + 1, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const P = pts.concat([[cx - d, cy - d], [cx + d, cy - d], [cx, cy + d]]);
  // Triangles with cached circumcircles.
  let tris = [];
  const add = (a, b, c) => {
    const [ax, ay] = P[a], [bx, by] = P[b], [qx, qy] = P[c];
    const D = 2 * (ax * (by - qy) + bx * (qy - ay) + qx * (ay - by)) || 1e-12;
    const ux = ((ax * ax + ay * ay) * (by - qy) + (bx * bx + by * by) * (qy - ay) + (qx * qx + qy * qy) * (ay - by)) / D;
    const uy = ((ax * ax + ay * ay) * (qx - bx) + (bx * bx + by * by) * (ax - qx) + (qx * qx + qy * qy) * (bx - ax)) / D;
    tris.push({ a, b, c, ux, uy, r2: (ax - ux) ** 2 + (ay - uy) ** 2 });
  };
  add(n, n + 1, n + 2);
  // Insert in a spatially coherent order (sorted by x) - the naive scan stays fast enough for pattern pieces.
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => pts[i][0] - pts[j][0] || pts[i][1] - pts[j][1]);
  for (const i of order) {
    const [px, py] = P[i];
    const bad = [], keep = [];
    for (const t of tris) ((px - t.ux) ** 2 + (py - t.uy) ** 2 < t.r2 * (1 + 1e-12) ? bad : keep).push(t);
    // Boundary of the cavity: edges of bad triangles not shared by two bad triangles.
    const cnt = new Map();
    for (const t of bad) for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) { const k = u < v ? u + ',' + v : v + ',' + u; cnt.set(k, (cnt.get(k) || 0) + 1); }
    tris = keep;
    for (const t of bad) for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) { const k = u < v ? u + ',' + v : v + ',' + u; if (cnt.get(k) === 1) add(u, v, i); }
  }
  const out = [];
  for (const t of tris) if (t.a < n && t.b < n && t.c < n) out.push(t.a, t.b, t.c);
  return out;
}

const segCross = (a, b, c, d) => {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
};

// Boundary first, interior second: the first `boundary` vertices are the resampled outline, shared by adjacent edges
// through a 1/1000 cm rounding key, so a seam edge's vertex list is exactly the outline vertices. Interior points sit
// on a hexagonal grid (equilateral triangles: the most uniform stretch behaviour) and keep 0.55 h from the outline so
// no sliver triangles form there. Delaunay of a concave outline also creates triangles outside it, removed by the
// centroid test plus a segment-crossing test against the outline.
export function pieceMesh(piece, o = {}) {
  const h = o.h || 2.5;
  const pts = [], edges = {};
  const key = (p) => Math.round(p[0] * 1000) + ',' + Math.round(p[1] * 1000);
  const index = new Map();
  const vert = (p) => { const k = key(p); if (index.has(k)) return index.get(k); index.set(k, pts.length); pts.push([p[0], p[1]]); return pts.length - 1; };
  const poly = [];
  for (const e of piece.edges) {
    const L = plLength(e.pts);
    const n = Math.max(1, o.counts?.[e.id] ?? Math.round(L / h));
    const rs = resample(e.pts, n);
    edges[e.id] = rs.map((p) => vert(p));
    for (const p of rs.slice(0, -1)) poly.push(p);
  }
  const boundary = pts.length;
  // Interior: hexagonal grid at spacing h, kept away from the outline.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const dy = h * Math.sqrt(3) / 2;
  const near = (p, lim) => {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ab = [b[0] - a[0], b[1] - a[1]], l2 = ab[0] ** 2 + ab[1] ** 2 || 1e-12;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2));
      if (Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t) < lim) return true;
    }
    return false;
  };
  let row = 0;
  for (let y = y0 + dy / 2; y < y1; y += dy, row++) {
    for (let x = x0 + (row % 2 ? h / 2 : 0) + h / 4; x < x1; x += h) {
      const p = [x, y];
      if (inside(poly, p) && !near(p, h * 0.55)) pts.push(p);
    }
  }
  const raw = delaunay(pts);
  // Keep triangles inside the outline whose edges do not cross the outline.
  const tris = [];
  for (let i = 0; i < raw.length; i += 3) {
    const a = pts[raw[i]], b = pts[raw[i + 1]], c = pts[raw[i + 2]];
    const g = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
    if (!inside(poly, g)) continue;
    let crosses = false;
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      for (let k = 0; k < poly.length && !crosses; k++) if (segCross(p, q, poly[k], poly[(k + 1) % poly.length])) crosses = true;
      if (crosses) break;
    }
    if (crosses) continue;
    // Counter-clockwise in 2D (consistent normals in 3D).
    const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(cr) < 1e-9) continue;
    if (cr > 0) tris.push(raw[i], raw[i + 1], raw[i + 2]); else tris.push(raw[i], raw[i + 2], raw[i + 1]);
  }
  const xy = new Float64Array(pts.length * 2);
  pts.forEach((p, i) => { xy[i * 2] = p[0]; xy[i * 2 + 1] = p[1]; });
  return { xy, tris: new Uint32Array(tris), edges, boundary, count: pts.length };
}

// Numeric edge keys a * 1e7 + b avoid string allocation; valid while vertex indices stay below 1e7.
export function meshEdges(tris) {
  const set = new Map();
  for (let i = 0; i < tris.length; i += 3) {
    for (const [a, b] of [[tris[i], tris[i + 1]], [tris[i + 1], tris[i + 2]], [tris[i + 2], tris[i]]]) {
      const k = a < b ? a * 1e7 + b : b * 1e7 + a;
      if (!set.has(k)) set.set(k, [Math.min(a, b), Math.max(a, b)]);
    }
  }
  return [...set.values()];
}

// Bending via distance constraints between the two vertices opposite a shared edge: cheaper than dihedral
// constraints and stable in XPBD, at the cost of mixing a little stretch resistance into bending.
export function bendPairs(tris) {
  const m = new Map();
  const out = [];
  for (let i = 0; i < tris.length; i += 3) {
    const t = [tris[i], tris[i + 1], tris[i + 2]];
    for (let k = 0; k < 3; k++) {
      const a = t[k], b = t[(k + 1) % 3], c = t[(k + 2) % 3];
      const key = a < b ? a * 1e7 + b : b * 1e7 + a;
      if (m.has(key)) { const [aa, bb, cc] = m.get(key); out.push([cc, c, aa, bb]); } else m.set(key, [a, b, c]);
    }
  }
  return out;
}
