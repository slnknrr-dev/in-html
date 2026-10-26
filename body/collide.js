// body/collide.js - the body as a collider for cloth: every rig part is a generalized cylinder with domed ends, so a
// point is tested in the part's frame against the interpolated cross-section radius; the push-out direction is the
// surface normal of the swept ring (radial direction tilted by the slope of the radius along the axis), which lets
// cloth rest on sloping shoulders and under the bust instead of sliding sideways.
//
//   bodyCollider(rig) -> { parts, collide(pos, i, offset, mask?) -> 0 | 1 (moves pos[i..i+2] out of the body, sets .normal),
//                          signedDistance(x, y, z) -> cm (negative inside), inside(x, y, z), bounds,
//                          frame(pos, n, offset, reach, out) (once a frame: per particle the parts within reach, the
//                          distance and the outward normal - the substeps then test only those parts) }
//   bodyVolume(rig, res = 1.5) -> cm^3 of the union of the parts (voxels), weightFromVolume(cm3, density = 1.0)

//
// Why analytic part distance and not a voxel SDF or mesh BVH: the body is already described as swept rings, so the
// exact radius at (t, phi) is two table lookups. That is O(parts) per particle with no precomputed grid to rebuild
// when the body changes shape. Per-frame culling (frame()) brings the per-substep cost down to the parts nearby.
// Allocation-free in the hot path: scratch arrays (RS, tmp, api.normal) are reused, so the cloth solver triggers no GC.
// Consequence: the collider is not reentrant (fine on one thread).
import { TAU, clamp } from './geom.js';

function prep(part) {
  const n = part.rings.length, M = part.M;
  const r = new Float32Array(n * M), cx = new Float32Array(n), cz = new Float32Array(n);
  let rmax = 0;
  part.rings.forEach((rg, i) => {
    cx[i] = rg.cx; cz[i] = rg.cz;
    for (let j = 0; j < M; j++) { r[i * M + j] = rg.r[j]; rmax = Math.max(rmax, rg.r[j] + Math.hypot(rg.cx, rg.cz)); }
  });
  const mean = (i) => { let s = 0; for (let j = 0; j < M; j++) s += r[i * M + j]; return s / M; };
  const hS = part.capStart ? Math.min(mean(0) * 0.8, 6) : 0, hE = part.capEnd ? Math.min(mean(n - 1) * 0.8, 6) : 0;
  // Axis-aligned bounds of the swept part (both end discs inflated by the largest radius).
  const ends = [part.origin.map((v, k) => v - part.axis[k] * hS), part.origin.map((v, k) => v + part.axis[k] * (part.length + hE))];
  const min = [0, 1, 2].map((k) => Math.min(ends[0][k], ends[1][k]) - rmax), max = [0, 1, 2].map((k) => Math.max(ends[0][k], ends[1][k]) + rmax);
  // Slope of the radius along the axis per ring sample (central differences over one ring each way, cm per cm): the
  // normal's lean without sampling the radius twice more per query.
  const dr = new Float32Array(n * M);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    for (let j = 0; j < M; j++) dr[i * M + j] = (r[b * M + j] - r[a * M + j]) / (((b - a) || 1) * part.dt);
  }
  return { id: part.id, kind: part.kind, o: part.origin, a: part.axis, e1: part.e1, e2: part.e2, len: part.length, dt: part.dt, n, M, r, dr, cx, cz, hS, hE, min, max };
}

// Radius and its axial slope at (u, phi), bilinear in both tables; the slope goes to RS[1].
// Module-level scratch shared by every collider: radiusSlope returns the slope through RS[1] to avoid allocating a pair.
const RS = [0, 0];
function radiusSlope(P, u, phi) {
  const i = Math.min(P.n - 2, Math.max(0, Math.floor(u))), f = clamp(u - i, 0, 1);
  let jf = (phi / TAU) * P.M;
  if (jf >= P.M) jf -= P.M; else if (jf < 0) jf += P.M;
  const j0 = Math.floor(jf), g = jf - j0, j1 = j0 + 1 === P.M ? 0 : j0 + 1;
  const M = P.M, r = P.r, d = P.dr, A = i * M, B = A + M;
  const a = r[A + j0] * (1 - g) + r[A + j1] * g, b = r[B + j0] * (1 - g) + r[B + j1] * g;
  const sa = d[A + j0] * (1 - g) + d[A + j1] * g, sb = d[B + j0] * (1 - g) + d[B + j1] * g;
  RS[1] = sa + (sb - sa) * f;
  return a + (b - a) * f;
}

// Signed distance-like value of a point to a part (negative inside) and the outward unit normal.
// limit: points farther out than this (cm) return early with the radial gap (no normal) - the common case.
// Not an exact Euclidean distance: radial gap divided by the normal's length (a first-order correction for sloped
// walls) on the barrel, scaled ellipsoid level set on the caps. Exact enough near the surface, where it matters.
function partDistance(P, x, y, z, out, limit = Infinity) {
  if (x < P.min[0] || y < P.min[1] || z < P.min[2] || x > P.max[0] || y > P.max[1] || z > P.max[2]) return Infinity;
  const dx = x - P.o[0], dy = y - P.o[1], dz = z - P.o[2];
  const t = dx * P.a[0] + dy * P.a[1] + dz * P.a[2];
  if (t < -P.hS || t > P.len + P.hE) return Infinity;
  const tc = clamp(t, 0, P.len);
  const u = tc / P.dt;
  const i = Math.min(P.n - 2, Math.floor(u)), f = u - i;
  const ccx = P.cx[i] + (P.cx[i + 1] - P.cx[i]) * f, ccz = P.cz[i] + (P.cz[i + 1] - P.cz[i]) * f;
  const du = dx * P.e1[0] + dy * P.e1[1] + dz * P.e1[2] - ccx;
  const dv = dx * P.e2[0] + dy * P.e2[1] + dz * P.e2[2] - ccz;
  const rho = Math.hypot(du, dv) || 1e-6;
  let phi = Math.atan2(dv, du);
  if (phi < 0) phi += TAU;
  const R = radiusSlope(P, u, phi);
  if (rho - R > limit + 0.5 && t >= 0 && t <= P.len) return rho - R;
  const cu = du / rho, cv = dv / rho;
  // Radial direction in world space.
  const rx = P.e1[0] * cu + P.e2[0] * cv, ry = P.e1[1] * cu + P.e2[1] * cv, rz = P.e1[2] * cu + P.e2[2] * cv;
  if (t >= 0 && t <= P.len) {
    // Slope of the radius along the axis: the normal leans against it.
    const s = RS[1];
    let nx = rx - P.a[0] * s, ny = ry - P.a[1] * s, nz = rz - P.a[2] * s;
    const nl = Math.hypot(nx, ny, nz);
    nx /= nl; ny /= nl; nz /= nl;
    out[0] = nx; out[1] = ny; out[2] = nz;
    return (rho - R) / nl;
  }
  // Domed ends: a half ellipsoid of height h over the end ring.
  const h = t < 0 ? P.hS : P.hE, e = t < 0 ? -t : t - P.len;
  const q = Math.hypot(e / h, rho / R);
  // Gradient of (e/h)^2 + (rho/R)^2.
  const sgn = t < 0 ? -1 : 1, gr = rho / (R * R), ga = sgn * e / (h * h);
  const nx = rx * gr + P.a[0] * ga, ny = ry * gr + P.a[1] * ga, nz = rz * gr + P.a[2] * ga;
  const nl = Math.hypot(nx, ny, nz) || 1;
  out[0] = nx / nl; out[1] = ny / nl; out[2] = nz / nl;
  return (q - 1) * Math.min(R, h);
}

export function bodyCollider(rig) {
  const parts = rig.parts.map(prep);
  const tmp = [0, 0, 0];
  const bmin = [0, 1, 2].map((k) => Math.min(...parts.map((p) => p.min[k]))), bmax = [0, 1, 2].map((k) => Math.max(...parts.map((p) => p.max[k])));
  const api = {
    parts, bounds: { min: bmin, max: bmax }, normal: [0, 0, 0],
    // Moves the point at pos[i..i+2] out of every part it is inside (with a clearance), returns 1 when it moved.
    // Two passes, each pushing out of the deepest part only: where two parts meet (neck and torso, arm and torso)
    // their pushes would otherwise fight and make the cloth shiver.
    // KNOWN DEFECT: masks are 32-bit (1 << k, mask >>> k), so a rig with more than 32 parts aliases part k with
    // part k - 32. Fix: an array of masks or a Uint8Array per particle when parts.length > 32.
    collide(pos, i, offset = 0, mask = -1) {
      if (!mask) return 0;
      let moved = 0;
      for (let pass = 0; pass < 2; pass++) {
        const x = pos[i], y = pos[i + 1], z = pos[i + 2];
        let best = offset, bn0 = 0, bn1 = 0, bn2 = 0, hit = false;
        for (let k = 0; k < parts.length; k++) {
          if (!((mask >>> k) & 1)) continue;
          const P = parts[k];
          if (x < P.min[0] - offset || y < P.min[1] - offset || z < P.min[2] - offset || x > P.max[0] + offset || y > P.max[1] + offset || z > P.max[2] + offset) continue;
          const d = partDistance(P, x, y, z, tmp, offset);
          if (d < best) { best = d; bn0 = tmp[0]; bn1 = tmp[1]; bn2 = tmp[2]; hit = true; }
        }
        if (!hit) break;
        const push = offset - best;
        pos[i] += bn0 * push; pos[i + 1] += bn1 * push; pos[i + 2] += bn2 * push;
        api.normal[0] = bn0; api.normal[1] = bn1; api.normal[2] = bn2;
        moved = 1;
      }
      return moved;
    },
    // Once a frame: for every particle the parts it may touch before the next frame (closer than its clearance plus
    // reach[i] cm) as a bit mask, its distance to the body and the outward normal of the nearest part (0 normal far
    // away). out = { mask: Uint32Array(n), sd: Float32Array(n), nrm: Float32Array(3n) }.
    frame(pos, n, offset, reach, out) {
      const { mask, sd, nrm } = out;
      for (let i = 0; i < n; i++) {
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        const lim = offset[i] + reach[i];
        let m = 0, best = Infinity, n0 = 0, n1 = 0, n2 = 0;
        for (let k = 0; k < parts.length; k++) {
          const P = parts[k];
          if (x < P.min[0] - lim || y < P.min[1] - lim || z < P.min[2] - lim || x > P.max[0] + lim || y > P.max[1] + lim || z > P.max[2] + lim) continue;
          tmp[0] = 0; tmp[1] = 0; tmp[2] = 0;
          const d = partDistance(P, x, y, z, tmp, lim + 2);
          // beyond the part's axial range the distance is not measured (Infinity): inside the widened bounds it is near
          if (d < lim || d === Infinity) m |= 1 << k;
          if (d < best) { best = d; n0 = tmp[0]; n1 = tmp[1]; n2 = tmp[2]; }
        }
        mask[i] = m; sd[i] = Number.isFinite(best) ? best : 50;
        nrm[i * 3] = n0; nrm[i * 3 + 1] = n1; nrm[i * 3 + 2] = n2;
      }
      return out;
    },
    signedDistance(x, y, z) {
      let best = Infinity;
      for (const P of parts) { const d = partDistance(P, x, y, z, tmp); if (d < best) best = d; }
      return best;
    },
    inside(x, y, z) {
      for (const P of parts) if (partDistance(P, x, y, z, tmp) < 0) return true;
      return false;
    },
  };
  return api;
}

// Volume of the union of the parts by voxels of `res` cm.
// Union volume by point sampling at voxel centres: overlapping parts are counted once, which a sum of mesh volumes
// cannot do. Starts at y = 0 (the floor). Cost grows with 1/res^3; the error is a fraction of a voxel layer over the surface.
export function bodyVolume(rig, res = 1.5) {
  const c = bodyCollider(rig);
  const { min, max } = c.bounds;
  let n = 0;
  for (let y = Math.max(0, min[1]) + res / 2; y < max[1]; y += res) {
    for (let x = min[0] + res / 2; x < max[0]; x += res) {
      for (let z = min[2] + res / 2; z < max[2]; z += res) if (c.inside(x, y, z)) n++;
    }
  }
  return n * res * res * res;
}

// Body density is close to water (about 1.01-1.07 g/cm3 depending on fat); 1.0 makes the estimate a little light,
// which the overlapping skin of the parts compensates.
export const weightFromVolume = (cm3, density = 1.0) => (cm3 * density) / 1000;
