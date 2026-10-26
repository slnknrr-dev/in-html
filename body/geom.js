// body/geom.js - small numeric helpers of the body model: 3D vectors as arrays, monotone cubic interpolation
// (PCHIP, no overshoot between key cross-sections), 2D convex hulls and polygon perimeters (a tape measure bridges
// hollows, so girths are convex-hull perimeters), superellipse radii in polar form.

//
// Vectors are plain 3-element arrays and every op allocates a new one: clarity over speed for the model-building
// code, which runs once per body. Hot loops (collide.js, mesh.js) inline the arithmetic on typed arrays instead.
// Units throughout the body library: centimetres, radians.
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// --- 3D vectors ([x, y, z]) ------------------------------------------------------------------------------------------
export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

// Rotation of vector v about a unit axis k by angle a (Rodrigues).
export function rotate(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a), d = dot(k, v) * (1 - c);
  const x = cross(k, v);
  return [v[0] * c + x[0] * s + k[0] * d, v[1] * c + x[1] * s + k[1] * d, v[2] * c + x[2] * s + k[2] * d];
}

// --- monotone cubic interpolation (Fritsch-Carlson) ------------------------------------------------------------------

// pchip(xs, ys) -> f(x): xs strictly increasing; constant beyond the ends.
// Why PCHIP and not a natural cubic spline: body profiles (girth along height) have sharp transitions (waist to hip);
// a C2 spline overshoots there and produces bulges or negative radii. PCHIP is only C1 but never leaves the range
// of neighbouring samples. Interior slopes: weighted harmonic mean of the adjacent secants (Fritsch-Butland form),
// zero at local extrema (secants of opposite sign), which is what guarantees monotonicity.
// Lookup is a binary search per call: O(log n), fine for the dozen key sections a profile has.
export function pchip(xs, ys) {
  const n = xs.length;
  if (n === 1) return () => ys[0];
  const h = [], d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / h[i]; }
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
  }
  // End slopes: one-sided three-point estimate, limited to keep monotonicity.
  if (n > 2) {
    const e0 = ((2 * h[0] + h[1]) * d[0] - h[0] * d[1]) / (h[0] + h[1]);
    m[0] = Math.sign(e0) !== Math.sign(d[0]) ? 0 : Math.abs(e0) > 3 * Math.abs(d[0]) ? 3 * d[0] : e0;
    const k = n - 2;
    const e1 = ((2 * h[k] + h[k - 1]) * d[k] - h[k] * d[k - 1]) / (h[k] + h[k - 1]);
    m[n - 1] = Math.sign(e1) !== Math.sign(d[k]) ? 0 : Math.abs(e1) > 3 * Math.abs(d[k]) ? 3 * d[k] : e1;
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
    const t = (x - xs[lo]) / h[lo], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h[lo] * m[lo] + (-2 * t3 + 3 * t2) * ys[lo + 1] + (t3 - t2) * h[lo] * m[lo + 1];
  };
}

// --- 2D polygons ([[x, y], ...]) -------------------------------------------------------------------------------------

// Convex hull (monotone chain), counter-clockwise.
// Andrew's monotone chain: O(n log n) from the sort, robust with collinear points (<= 0 drops them, so the hull has
// no redundant vertices that would add zero-length edges to a perimeter).
export function hull(pts) {
  const p = pts.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cr(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cr(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

export function perimeter(poly, closed = true) {
  let s = 0;
  for (let i = 0; i < poly.length - (closed ? 0 : 1); i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return s;
}

// Shoelace formula; signed (positive for counter-clockwise), despite the name it already divides by 2.
export function area2(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}

// --- superellipse in polar form --------------------------------------------------------------------------------------

// Radius at polar angle phi of |x/a|^n + |z/c|^n = 1 with c = front depth (sin > 0) or back depth (sin < 0).
// Superellipse: n = 2 is an ellipse, larger n squarer (boxier torso sections). Separate front / back depths make
// the section asymmetric (chest vs back) while staying continuous at the sides (sin = 0 uses front, both give a).
export function superR(phi, a, front, back, n) {
  const c = Math.cos(phi), s = Math.sin(phi);
  const d = s >= 0 ? front : back;
  const v = Math.pow(Math.abs(c) / a, n) + Math.pow(Math.abs(s) / d, n);
  return v > 0 ? Math.pow(v, -1 / n) : Math.max(a, d);
}

// Angular difference wrapped to (-pi, pi].
export const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d <= -Math.PI) d += TAU; return d; };

// Bisection for a monotone function: the x in [lo, hi] where f(x) = target.
// 40 halvings shrink the bracket by 2^40 (~1e-12 of its width): far below a millimetre for any body dimension.
// Works for increasing or decreasing f; if target is outside [f(lo), f(hi)] it converges to the nearer end.
export function solveMonotone(f, target, lo, hi, iters = 40) {
  let flo = f(lo) - target;
  for (let i = 0; i < iters; i++) {
    const mid = (lo + hi) / 2, fm = f(mid) - target;
    if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else hi = mid;
  }
  return (lo + hi) / 2;
}
