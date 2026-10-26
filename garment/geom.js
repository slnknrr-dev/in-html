// garment/geom.js - 2D geometry of pattern drafting (centimetres, y down as on paper): points as [x, y], cubic Bézier
// and Hermite curves flattened to polylines, arc length, resampling, points at a distance, polyline offsets with
// mitred corners, polygon area / orientation / containment, segment and line intersections, affine transforms
// (rigid motions, reflections) as [a, b, c, d, e, f] with x' = a x + c y + e, y' = b x + d y + f.

//
// Conventions: points are plain [x, y] arrays (cheap to create, JSON-serialisable, no class overhead); y points
// down like SVG and paper, so "clockwise on screen" means positive shoelace area. All curves are flattened to
// polylines early: seam lengths, offsets, nesting and export all work on polylines, so one representation serves
// every downstream step. Flattening step 0.4 cm keeps the chord error far below cutting accuracy (~1 mm).
export const EPS = 1e-9;
export const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
export const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const add2 = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const mul2 = (a, s) => [a[0] * s, a[1] * s];
export const norm2 = (a) => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };
export const perp = (a) => [-a[1], a[0]];
export const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];
export const cross2 = (a, b) => a[0] * b[1] - a[1] * b[0];
export const polar = (p, ang, len) => [p[0] + Math.cos(ang) * len, p[1] + Math.sin(ang) * len];
export const same = (a, b, tol = 1e-6) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;
export const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

// --- curves ------------------------------------------------------------------------------------------------------

// Cubic Bézier flattened to points (including both ends) with segments of at most `step` cm.
// Segment count from the control-polygon length, an upper bound of the arc length, so segments are at most `step`.
// Uniform t (not arc-length) spacing: good enough for drawing; resample() exists where even spacing matters.
export function bezier(p0, p1, p2, p3, step = 0.4) {
  const est = dist(p0, p1) + dist(p1, p2) + dist(p2, p3);
  const n = Math.max(2, Math.ceil(est / step));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

// Arc length of a cubic Bezier by 12-point Gauss-Legendre quadrature (no flattening; used inside solvers).
// Positive half of the 12-point Gauss-Legendre nodes on [-1, 1] (symmetric, so each is used with both signs) and
// their weights; mapped to t = 0.5 + 0.5 x, hence the final / 2. Exact for polynomials up to degree 23; the
// speed |B'(t)| is a square root, not a polynomial, so the result is approximate, but very accurate for the smooth
// curves of drafting, at a fixed cost (no adaptive loop), which matters inside solvers that call it many times.
const GL_X = [0.1252334085114689, 0.3678314989981802, 0.5873179542866175, 0.7699026741943047, 0.9041172563704749, 0.9815606342467192];
const GL_W = [0.2491470458134028, 0.2334925365383548, 0.2031674267230659, 0.1600783285433462, 0.1069393259953184, 0.0471753363865118];
export function bezierLength(p0, p1, p2, p3) {
  let s = 0;
  for (let k = 0; k < 6; k++) {
    for (const sg of [-1, 1]) {
      const t = 0.5 + 0.5 * sg * GL_X[k], u = 1 - t;
      const dx = 3 * (u * u * (p1[0] - p0[0]) + 2 * u * t * (p2[0] - p1[0]) + t * t * (p3[0] - p2[0]));
      const dy = 3 * (u * u * (p1[1] - p0[1]) + 2 * u * t * (p2[1] - p1[1]) + t * t * (p3[1] - p2[1]));
      s += GL_W[k] * Math.hypot(dx, dy);
    }
  }
  return s / 2;
}

// Curve from a to b leaving a in direction da and arriving at b in direction db (unit vectors), handle lengths as
// fractions of the chord (Hermite-like cubic).
// Handles proportional to the chord (default 0.4) keep the curve shape scale-invariant: the same call drafts a
// child's and an adult's armhole with the same proportions.
export function curve(a, da, b, db, ka = 0.4, kb = 0.4, step = 0.4) {
  const c = dist(a, b);
  return bezier(a, add2(a, mul2(norm2(da), c * ka)), sub2(b, mul2(norm2(db), c * kb)), b, step);
}

// Smooth curve through points (uniform Catmull-Rom), flattened.
// Catmull-Rom tangent (p2 - p0) / 2 becomes Bézier handles at 1/3 of it, i.e. (p2 - p0) / 6; the curve passes
// through every point (unlike a B-spline). End segments reuse the end point as the missing neighbour.
export function spline(pts, step = 0.4) {
  if (pts.length < 3) return line(pts[0], pts[pts.length - 1], step);
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1 = add2(p1, mul2(sub2(p2, p0), 1 / 6)), c2 = sub2(p2, mul2(sub2(p3, p1), 1 / 6));
    out.push(...bezier(p1, c1, c2, p2, step).slice(1));
  }
  return out;
}

// Straight segment as a polyline (only the ends: lines are never subdivided unless asked).
export const line = (a, b, step = 0) => {
  if (!step) return [a.slice(), b.slice()];
  const n = Math.max(1, Math.ceil(dist(a, b) / step));
  return Array.from({ length: n + 1 }, (_, i) => lerp2(a, b, i / n));
};

// Concatenates polylines that share their joints.
export function chain(...parts) {
  const out = [];
  for (const p of parts) {
    if (!p || !p.length) continue;
    if (out.length && same(out[out.length - 1], p[0], 1e-6)) out.push(...p.slice(1));
    else out.push(...p);
  }
  return out;
}

// --- polylines -----------------------------------------------------------------------------------------------------

export function plLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

// Cumulative lengths [0, d1, d1+d2, ...].
export function cumLengths(pts) {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + dist(pts[i - 1], pts[i]));
  return c;
}

// Point at distance s from the start (clamped), with the index of the segment and the unit tangent.
// Linear scan over cumulative lengths: O(n) per query, fine for pattern polylines of a few hundred points. A binary
// search would only pay off for many queries on one long polyline.
export function pointAt(pts, s) {
  const c = cumLengths(pts);
  const total = c[c.length - 1];
  s = Math.max(0, Math.min(total, s));
  let i = 1;
  while (i < c.length - 1 && c[i] < s) i++;
  const seg = c[i] - c[i - 1] || 1e-12;
  const t = (s - c[i - 1]) / seg;
  return { p: lerp2(pts[i - 1], pts[i], t), seg: i - 1, t, tangent: norm2(sub2(pts[i], pts[i - 1])) };
}

// n + 1 points evenly spaced by arc length (n segments).
export function resample(pts, n) {
  const c = cumLengths(pts), total = c[c.length - 1];
  const out = [];
  let j = 1;
  for (let i = 0; i <= n; i++) {
    const s = (total * i) / n;
    while (j < c.length - 1 && c[j] < s) j++;
    const seg = c[j] - c[j - 1] || 1e-12;
    out.push(lerp2(pts[j - 1], pts[j], Math.max(0, Math.min(1, (s - c[j - 1]) / seg))));
  }
  return out;
}

// Splits a polyline at distance s: [head, tail] (the split point is shared).
export function splitAt(pts, s) {
  const { p, seg } = pointAt(pts, s);
  return [pts.slice(0, seg + 1).concat([p]), [p].concat(pts.slice(seg + 1))].map((x) => dedupe(x));
}

// Never returns a single point: a degenerate polyline is kept as two coincident points so code that reads
// pts[0] and pts[length - 1] as a segment keeps working.
export function dedupe(pts, tol = 1e-7) {
  const out = [];
  for (const p of pts) if (!out.length || !same(out[out.length - 1], p, tol)) out.push(p);
  return out.length === 1 ? [out[0], out[0].slice()] : out;
}

export const reversed = (pts) => pts.slice().reverse();

// Offset of an open polyline by d (positive = to the left of the direction of travel in y-down coordinates, i.e.
// perp(tangent) = [-ty, tx]), with mitred joints.
// Mitre join: the vertex moves along the bisector m by d / cos(half angle) (c = m . n1). The cos is clamped at 0.25,
// i.e. a mitre limit of 4x d, so a near-reversal does not shoot a spike far out of the seam allowance.
// Not a full polygon offset (no self-intersection cleanup): adequate for the gently curved seams of pattern pieces.
export function offsetPolyline(pts, d) {
  if (pts.length < 2) return pts.slice();
  const out = [];
  const nrm = [];
  for (let i = 1; i < pts.length; i++) nrm.push(perp(norm2(sub2(pts[i], pts[i - 1]))));
  out.push(add2(pts[0], mul2(nrm[0], d)));
  for (let i = 1; i < pts.length - 1; i++) {
    const n1 = nrm[i - 1], n2 = nrm[i];
    const m = norm2(add2(n1, n2));
    const c = dot2(m, n1);
    out.push(add2(pts[i], mul2(m, d / Math.max(0.25, c))));
  }
  out.push(add2(pts[pts.length - 1], mul2(nrm[nrm.length - 1], d)));
  return out;
}

// --- polygons ------------------------------------------------------------------------------------------------------

// Signed area (shoelace); positive = clockwise on screen (y down).
export function area(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}

export function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[0] > x1) x1 = p[0]; if (p[1] > y1) y1 = p[1]; }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

// Even-odd point in polygon.
// Even-odd ray casting; the half-open test (a.y > p.y) !== (b.y > p.y) counts a vertex on the ray exactly once.
export function inside(poly, p) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

// Proper segment intersection (excluding shared endpoints within tol): the point or null.
// Parametric form a + t r = c + u s; endpoints are excluded (t, u strictly inside (tol, 1 - tol)) so adjacent edges
// of a polygon sharing a vertex are not reported as crossing.
export function segIntersect(a, b, c, d, tol = 1e-9) {
  const r = sub2(b, a), s = sub2(d, c);
  const den = cross2(r, s);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross2(sub2(c, a), s) / den, u = cross2(sub2(c, a), r) / den;
  if (t <= tol || t >= 1 - tol || u <= tol || u >= 1 - tol) return null;
  return add2(a, mul2(r, t));
}

// Intersection of two infinite lines (a, b) and (c, d): { p, t, u } or null when parallel.
export function lineIntersect(a, b, c, d) {
  const r = sub2(b, a), s = sub2(d, c);
  const den = cross2(r, s);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross2(sub2(c, a), s) / den, u = cross2(sub2(c, a), r) / den;
  return { p: add2(a, mul2(r, t)), t, u };
}

// Does a closed polygon cross itself? (O(n^2), pattern pieces are small)
export function selfIntersects(poly) {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = poly[j], d = poly[(j + 1) % n];
      if (segIntersect(a, b, c, d, 1e-7)) return true;
    }
  }
  return false;
}

// Distance from a point to a segment.
export function segDist(p, a, b) {
  const ab = sub2(b, a), l2 = dot2(ab, ab);
  const t = l2 ? Math.max(0, Math.min(1, dot2(sub2(p, a), ab) / l2)) : 0;
  return dist(p, add2(a, mul2(ab, t)));
}

// --- affine transforms ---------------------------------------------------------------------------------------------

// Affine matrices in the SVG/canvas order [a, b, c, d, e, f], so they can be written straight into
// transform="matrix(...)" and ctx.setTransform without conversion.
export const I = [1, 0, 0, 1, 0, 0];
export const apply = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
// compose(a, b): first b, then a.
export const compose = (a, b) => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];
export const translate = (dx, dy) => [1, 0, 0, 1, dx, dy];
export const rotation = (ang, c = [0, 0]) => {
  const cs = Math.cos(ang), sn = Math.sin(ang);
  return [cs, sn, -sn, cs, c[0] - cs * c[0] + sn * c[1], c[1] - sn * c[0] - cs * c[1]];
};
export const mirrorX = (x0 = 0) => [-1, 0, 0, 1, 2 * x0, 0];
// Reflection across the line through a and b.
// Reflection across a line through the origin with unit direction d is [[cos 2t, sin 2t], [sin 2t, -cos 2t]]; the
// translation then makes point a a fixed point. det = -1 (orientation flips), which callers use to reverse polygons.
export function reflectLine(a, b) {
  const d = norm2(sub2(b, a));
  const c = d[0] * d[0] - d[1] * d[1], s = 2 * d[0] * d[1];
  const m = [c, s, s, -c, 0, 0];
  const pa = apply(m, a);
  return [c, s, s, -c, a[0] - pa[0], a[1] - pa[1]];
}
export const det = (m) => m[0] * m[3] - m[1] * m[2];

// Rigid motion (rotation + translation) taking segment (a0, a1) onto (b0, b1) (a0 -> b0, direction of a1 -> b1).
// Rotation by the angle difference about the origin, then a translation moving a0 onto b0: a proper rigid motion
// (det = +1), used to lay a seam of one piece onto its partner (walking seams, joined views).
export function rigidOnto(a0, a1, b0, b1) {
  const ang = Math.atan2(b1[1] - b0[1], b1[0] - b0[0]) - Math.atan2(a1[1] - a0[1], a1[0] - a0[0]);
  const r = rotation(ang);
  const p = apply(r, a0);
  return compose(translate(b0[0] - p[0], b0[1] - p[1]), r);
}
