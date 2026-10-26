// cloth/sim.js - position-based cloth (XPBD with small steps: one constraint pass per substep, compliances in
// cm / g / s units): stretch and bending distance constraints from the flat pattern, seams as attachments of a vertex
// to a point between two vertices of the other side (so seams sew pieces of different resolutions and spread the ease),
// pins, collisions with the body collider at a per-particle clearance (the layer offset) with friction, and layering
// between garments (a particle stays outside the particles of the layers under it). Deterministic.
//
//   createCloth(n) -> cloth;  cloth.addDistance(i, j, rest, compliance), addSew(a, b0, b1, t, compliance, rest),
//   addTriAttach(a, t0, t1, t2, w0, w1, w2, compliance), pin(i, [x, y, z]), step(dt, substeps), stats()
//   cloth.pos / prev / vel (Float32Array 3n), invMass, offset (clearance per particle, cm), layer (Int16), friction
//
// Why XPBD with many substeps and one iteration each: for cloth, substepping converges faster than iterating per
// step (Macklin et al., "Small Steps in Physics Simulation"), and compliance makes stiffness independent of the
// substep count. Constraints are stored as structure-of-arrays (typed arrays after pack()) for cache-friendly loops.
// Deterministic: fixed iteration order, no randomness, so a baked drape reproduces exactly.

const G = -981; // cm/s^2

export function createCloth(n) {
  const c = {
    n, pos: new Float32Array(n * 3), vel: new Float32Array(n * 3), prev: new Float32Array(n * 3), invMass: new Float32Array(n).fill(1),
    offset: new Float32Array(n).fill(0.4), layer: new Int16Array(n), friction: new Float32Array(n).fill(0.5), damping: 0.05, substeps: 12,
    dist: { i: [], j: [], rest: [], comp: [] }, sew: { a: [], b0: [], b1: [], t: [], comp: [], rest: [] },
    tri: { a: [], t0: [], t1: [], t2: [], w0: [], w1: [], w2: [], comp: [] }, pins: new Map(),
    collider: null, packed: false, time: 0, frames: 0, sewRamp: 1, layerPush: true, wind: [0, 0, 0],
  };
  c.addDistance = (i, j, rest, comp) => { c.dist.i.push(i); c.dist.j.push(j); c.dist.rest.push(rest); c.dist.comp.push(comp); c.packed = false; };
  c.addSew = (a, b0, b1, t, comp = 0, rest = 0) => { c.sew.a.push(a); c.sew.b0.push(b0); c.sew.b1.push(b1); c.sew.t.push(t); c.sew.comp.push(comp); c.sew.rest.push(rest); c.packed = false; };
  c.addTriAttach = (a, t0, t1, t2, w0, w1, w2, comp = 0, rest = 0) => { const T = c.tri; T.a.push(a); T.t0.push(t0); T.t1.push(t1); T.t2.push(t2); T.w0.push(w0); T.w1.push(w1); T.w2.push(w2); T.comp.push(comp); (T.rest ||= []).push(rest); c.packed = false; };
  c.pin = (i, p) => { c.pins.set(i, p); c.invMass[i] = 0; };
  c.step = (dt, sub) => step(c, dt, sub);
  c.stats = () => stats(c);
  return c;
}

function pack(c) {
  const f32 = (a) => Float32Array.from(a), i32 = (a) => Int32Array.from(a);
  c.D = { i: i32(c.dist.i), j: i32(c.dist.j), rest: f32(c.dist.rest), comp: f32(c.dist.comp) };
  c.S = { a: i32(c.sew.a), b0: i32(c.sew.b0), b1: i32(c.sew.b1), t: f32(c.sew.t), comp: f32(c.sew.comp), rest: f32(c.sew.rest) };
  const T = c.tri;
  c.T = { a: i32(T.a), t0: i32(T.t0), t1: i32(T.t1), t2: i32(T.t2), w0: f32(T.w0), w1: f32(T.w1), w2: f32(T.w2), comp: f32(T.comp), rest: f32(T.rest || []) };
  c.packed = true;
}

// XPBD distance constraint with compliance alpha: correction = C / (w_a + w_b + alpha / h^2). Gauss-Seidel order
// (positions updated in place) converges faster than Jacobi averaging.
function solveDistances(c, h2) {
  const { i: I, j: J, rest: R, comp: C } = c.D;
  const p = c.pos, w = c.invMass;
  for (let k = 0; k < I.length; k++) {
    const a = I[k] * 3, b = J[k] * 3;
    const wa = w[I[k]], wb = w[J[k]], ws = wa + wb;
    if (!ws) continue;
    const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (L < 1e-9) continue;
    const s = (L - R[k]) / (L * (ws + C[k] / h2));
    p[a] += wa * s * dx; p[a + 1] += wa * s * dy; p[a + 2] += wa * s * dz;
    p[b] -= wb * s * dx; p[b + 1] -= wb * s * dy; p[b + 2] -= wb * s * dz;
  }
}

// Vertex a to the point b0 + t (b1 - b0): distance -> rest (0 for seams).
// The target is an interpolated point on the other edge; its inverse mass is weighted by u^2 and t^2 (the
// generalised inverse mass of a point at a barycentric position), and the correction is distributed back with u and t.
// One-sided: only an over-long seam is pulled (L > rest), never pushed apart.
function solveSews(c, h2) {
  const { a: A, b0: B0, b1: B1, t: Tt, comp: C, rest: R } = c.S;
  const p = c.pos, w = c.invMass;
  const ramp = c.sewRamp;
  for (let k = 0; k < A.length; k++) {
    const a = A[k] * 3, b0 = B0[k] * 3, b1 = B1[k] * 3, t = Tt[k], u = 1 - t;
    const qx = p[b0] * u + p[b1] * t, qy = p[b0 + 1] * u + p[b1 + 1] * t, qz = p[b0 + 2] * u + p[b1 + 2] * t;
    const dx = qx - p[a], dy = qy - p[a + 1], dz = qz - p[a + 2];
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const target = R[k];
    if (L <= target + 1e-6) continue;
    const wa = w[A[k]], w0 = w[B0[k]] * u * u, w1 = w[B1[k]] * t * t, ws = wa + w0 + w1;
    if (!ws) continue;
    // Seams close gradually (ramp) so that pieces slide into place instead of snapping through the body.
    const s = ((L - target) * ramp) / (L * (ws + C[k] / h2));
    p[a] += wa * s * dx; p[a + 1] += wa * s * dy; p[a + 2] += wa * s * dz;
    const k0 = w[B0[k]] * u * s, k1 = w[B1[k]] * t * s;
    p[b0] -= k0 * dx; p[b0 + 1] -= k0 * dy; p[b0 + 2] -= k0 * dz;
    p[b1] -= k1 * dx; p[b1 + 1] -= k1 * dy; p[b1 + 2] -= k1 * dz;
  }
}

function solveTris(c, h2) {
  const T = c.T, p = c.pos, w = c.invMass;
  for (let k = 0; k < T.a.length; k++) {
    const a = T.a[k] * 3, i0 = T.t0[k], i1 = T.t1[k], i2 = T.t2[k], w0 = T.w0[k], w1 = T.w1[k], w2 = T.w2[k];
    const qx = p[i0 * 3] * w0 + p[i1 * 3] * w1 + p[i2 * 3] * w2, qy = p[i0 * 3 + 1] * w0 + p[i1 * 3 + 1] * w1 + p[i2 * 3 + 1] * w2, qz = p[i0 * 3 + 2] * w0 + p[i1 * 3 + 2] * w1 + p[i2 * 3 + 2] * w2;
    const dx = qx - p[a], dy = qy - p[a + 1], dz = qz - p[a + 2];
    const wa = w[T.a[k]], ws = wa + w[i0] * w0 * w0 + w[i1] * w1 * w1 + w[i2] * w2 * w2;
    if (!ws) continue;
    // Distance to the surface point -> rest (the lift of an overlay above its parent).
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz), r = T.rest[k] || 0;
    if (L <= r + 1e-6) continue;
    const s = (L - r) / (L * (ws + T.comp[k] / h2));
    p[a] += wa * s * dx; p[a + 1] += wa * s * dy; p[a + 2] += wa * s * dz;
    for (const [i, wi] of [[i0, w0], [i1, w1], [i2, w2]]) { const f = w[i] * wi * s; p[i * 3] -= f * dx; p[i * 3 + 1] -= f * dy; p[i * 3 + 2] -= f * dz; }
  }
}

// Layering between garments, once a frame: where a particle of an outer garment is not at least a cloth thickness
// farther from the body than a particle of an inner garment next to it (within 2 cm), both move along the body normal
// - the outer one out by 60 % of the overlap, the inner one in by 40 % (cloth pressing on cloth) - as a projection that
// adds no velocity. Layers of one garment are excluded (they are sewn or attached to each other).
// Neighbour search over a counting-sort spatial hash (2 cm cells, 2^15 buckets): O(n) build, 27-cell query, no
// per-frame allocation once the buffers exist. Hash collisions only add candidates, rejected by the distance test.
function resolveLayers(c) {
  if (!c.layerPush || !c.collider) return 0;
  const n = c.n, p = c.pos;
  let multi = false;
  for (let i = 0; i < n; i++) if (c.layer[i] >> 2) { multi = true; break; }
  if (!multi) return 0;
  // distances and normals of this frame (collider.frame), a hash grid of 2 cm cells as sorted index lists
  const sd = c.F.sd, N = c.F.nrm;
  const cell = 2, size = 1 << 15, hmask = size - 1;
  const key = (x, y, z) => (((Math.floor(x / cell) * 73856093) ^ (Math.floor(y / cell) * 19349663) ^ (Math.floor(z / cell) * 83492791)) >>> 0) & hmask;
  const head = c.gridHead || (c.gridHead = new Int32Array(size + 1)), list = c.gridList && c.gridList.length >= n ? c.gridList : (c.gridList = new Int32Array(n));
  const keys = c.gridKeys && c.gridKeys.length >= n ? c.gridKeys : (c.gridKeys = new Int32Array(n));
  head.fill(0);
  for (let i = 0; i < n; i++) { const k = key(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]); keys[i] = k; head[k + 1]++; }
  for (let k = 0; k < size; k++) head[k + 1] += head[k];
  const fill = c.gridFill || (c.gridFill = new Int32Array(size));
  fill.set(head.subarray(0, size));
  for (let i = 0; i < n; i++) list[fill[keys[i]]++] = i;
  const normal = (i, out) => {
    const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
    if (!nx && !ny && !nz) return false;
    out[0] = nx; out[1] = ny; out[2] = nz;
    return true;
  };
  const np = [0, 0, 0], nq = [0, 0, 0];
  let fixes = 0;
  for (let i = 0; i < n; i++) {
    const G = c.layer[i] >> 2;
    if (!G || !c.invMass[i]) continue;
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    let worst = 0, wj = -1;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const kk = key(x + dx * cell, y + dy * cell, z + dz * cell);
      for (let q = head[kk], e = head[kk + 1]; q < e; q++) {
        const j = list[q];
        if ((c.layer[j] >> 2) >= G) continue;
        const ex = p[j * 3] - x, ey = p[j * 3 + 1] - y, ez = p[j * 3 + 2] - z;
        if (ex * ex + ey * ey + ez * ez > cell * cell) continue;
        const over = sd[j] + 0.3 - sd[i];
        if (over > worst) { worst = over; wj = j; }
      }
    }
    if (wj < 0 || worst < 0.02) continue;
    const d = Math.min(worst, 2);
    if (normal(i, np)) { const k = 0.6 * d; p[i * 3] += np[0] * k; p[i * 3 + 1] += np[1] * k; p[i * 3 + 2] += np[2] * k; sd[i] += k; }
    if (c.invMass[wj] && sd[wj] - 0.4 * d > c.offset[wj] && normal(wj, nq)) { const k = 0.4 * d; p[wj * 3] -= nq[0] * k; p[wj * 3 + 1] -= nq[1] * k; p[wj * 3 + 2] -= nq[2] * k; sd[wj] -= k; }
    fixes++;
  }
  return fixes;
}

// Broad phase once per frame (and every 4 substeps): the collider pre-selects nearby body parts per particle so
// substep collisions test only those. Velocities are derived from positions (v = (p - prev) / h), the PBD way, so
// constraint projections and collisions never inject energy through stale velocities.
// Note: damping multiplies velocity once per substep, so the same `damping` value damps more with more substeps.
// `extra` is always null and `sewRamp = min(1, sewRamp)` is a no-op: remnants of earlier tuning.
function step(c, dt, sub = c.substeps) {
  if (!c.packed) pack(c);
  const h = dt / sub, h2 = h * h;
  const p = c.pos, v = c.vel, prev = c.prev, w = c.invMass, n = c.n;
  // Once a frame: the body parts each particle may reach during this frame (its speed over the frame plus a margin),
  // its distance to the body and the normal; the substeps collide against those parts only, layering uses the rest.
  if (c.collider && c.collider.frame) {
    const F = c.F && c.F.mask.length === n ? c.F : (c.F = { mask: new Uint32Array(n), sd: new Float32Array(n), nrm: new Float32Array(n * 3), reach: new Float32Array(n) });
    // reach: what the particle moved over the last frame (seams and layers move it more than its speed tells), doubled
    const last = c.framePos && c.framePos.length === n * 3 ? c.framePos : null;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const dv = Math.sqrt(v[k] * v[k] + v[k + 1] * v[k + 1] + v[k + 2] * v[k + 2]) * dt;
      const dp = last ? Math.hypot(p[k] - last[k], p[k + 1] - last[k + 1], p[k + 2] - last[k + 2]) : 5;
      F.reach[i] = 1.5 + 2 * Math.max(dv, dp);
    }
    (c.framePos && c.framePos.length === n * 3 ? c.framePos : (c.framePos = new Float32Array(n * 3))).set(p);
    c.collider.frame(p, n, c.offset, F.reach, F);
  } else c.F = null;
  c.layerFixes = c.F ? resolveLayers(c) : 0;
  const extra = null;
  const damp = Math.max(0, 1 - c.damping);
  for (let s = 0; s < sub; s++) {
    // seams can drag a particle several cm within a frame: the near parts are found again every 4 substeps
    if (c.F && s && s % 4 === 0) c.collider.frame(p, n, c.offset, c.F.reach, c.F);
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      prev[k] = p[k]; prev[k + 1] = p[k + 1]; prev[k + 2] = p[k + 2];
      if (!w[i]) continue;
      v[k + 1] += G * h;
      v[k] += c.wind[0] * h; v[k + 2] += c.wind[2] * h;
      p[k] += v[k] * h; p[k + 1] += v[k + 1] * h; p[k + 2] += v[k + 2] * h;
    }
    solveDistances(c, h2);
    solveSews(c, h2);
    solveTris(c, h2);
    for (const [i, q] of c.pins) { p[i * 3] = q[0]; p[i * 3 + 1] = q[1]; p[i * 3 + 2] = q[2]; }
    if (c.collider) {
      const col = c.collider, nrm = col.normal, mask = c.F ? c.F.mask : null;
      for (let i = 0; i < n; i++) {
        if (!w[i] || (mask && !mask[i])) continue;
        const k = i * 3;
        if (col.collide(p, k, c.offset[i] + (extra ? extra[i] : 0), mask ? mask[i] : -1)) {
          // Friction: remove part of the tangential displacement of this substep.
          const dx = p[k] - prev[k], dy = p[k + 1] - prev[k + 1], dz = p[k + 2] - prev[k + 2];
          const dn = dx * nrm[0] + dy * nrm[1] + dz * nrm[2];
          const tx = dx - dn * nrm[0], ty = dy - dn * nrm[1], tz = dz - dn * nrm[2];
          const f = c.friction[i];
          p[k] -= tx * f; p[k + 1] -= ty * f; p[k + 2] -= tz * f;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      v[k] = ((p[k] - prev[k]) / h) * damp; v[k + 1] = ((p[k + 1] - prev[k + 1]) / h) * damp; v[k + 2] = ((p[k + 2] - prev[k + 2]) / h) * damp;
    }
  }
  c.time += dt;
  c.frames++;
  c.sewRamp = Math.min(1, c.sewRamp);
}

// Diagnostics: finite positions, speeds, kinetic energy, seam gaps, stretch of the mesh, body penetration.
// Health metrics for tests and the UI: NaN detection, kinetic energy (convergence), seam gaps, strain, and body
// penetration measured with the exact signed distance rather than the broad-phase cache.
function stats(c) {
  if (!c.packed) pack(c);
  const p = c.pos, v = c.vel;
  let finite = true, maxV = 0, ke = 0;
  for (let i = 0; i < c.n; i++) {
    const k = i * 3;
    if (!Number.isFinite(p[k]) || !Number.isFinite(p[k + 1]) || !Number.isFinite(p[k + 2])) finite = false;
    const sp = Math.hypot(v[k], v[k + 1], v[k + 2]);
    maxV = Math.max(maxV, sp);
    ke += 0.5 * sp * sp / Math.max(1e-6, c.invMass[i] || 1e9);
  }
  let gapSum = 0, gapMax = 0;
  const S = c.S;
  for (let k = 0; k < S.a.length; k++) {
    const a = S.a[k] * 3, b0 = S.b0[k] * 3, b1 = S.b1[k] * 3, t = S.t[k];
    const g = Math.hypot(p[b0] * (1 - t) + p[b1] * t - p[a], p[b0 + 1] * (1 - t) + p[b1 + 1] * t - p[a + 1], p[b0 + 2] * (1 - t) + p[b1 + 2] * t - p[a + 2]) - S.rest[k];
    gapSum += Math.max(0, g); gapMax = Math.max(gapMax, g);
  }
  let strainMax = 0, strainSum = 0;
  const D = c.D;
  for (let k = 0; k < D.i.length; k++) {
    const a = D.i[k] * 3, b = D.j[k] * 3;
    const L = Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]);
    const s = L / D.rest[k] - 1;
    strainMax = Math.max(strainMax, s); strainSum += Math.abs(s);
  }
  let pen = 0, penMax = 0;
  if (c.collider) {
    for (let i = 0; i < c.n; i++) {
      const d = c.collider.signedDistance(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      if (d < 0) { pen++; penMax = Math.max(penMax, -d); }
    }
  }
  const speeds = [];
  for (let i = 0; i < c.n; i++) speeds.push(Math.hypot(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]));
  speeds.sort((a, b) => a - b);
  const meanSpeed = speeds.reduce((s, x) => s + x, 0) / Math.max(1, c.n);
  return {
    finite, maxSpeed: maxV, meanSpeed, p95Speed: speeds[Math.floor(c.n * 0.95)] || 0, kinetic: ke, seamGapMean: S.a.length ? gapSum / S.a.length : 0, seamGapMax: gapMax,
    strainMean: D.i.length ? strainSum / D.i.length : 0, strainMax, penetrating: pen, penetrationMax: penMax, time: c.time,
  };
}
