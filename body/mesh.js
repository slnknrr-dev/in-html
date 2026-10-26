// body/mesh.js - triangle mesh of a rig: every part is swept from its rings (M vertices per ring) and closed with
// domed caps, so the mesh is generated procedurally from the cross-sections (no external models).
//
//   bodyMesh(rig, { step }) -> { positions: Float32Array, normals: Float32Array, indices: Uint32Array,
//                                parts: [{ id, kind, first, count }] (index ranges), bounds: { min, max } }
//   step: take every step-th ring (1 = all rings, 2 = a lighter mesh for previews)

//
// Ring topology: vertex j of ring i is base + i*M + j, so neighbours are index arithmetic, no adjacency search.
// Parts are separate closed shells that interpenetrate at joints (no boolean union): cheap and good enough for
// display and volume estimation, where overlap is compensated elsewhere (collide.js weightFromVolume).
// Indices are Uint32Array: WebGL1 needs OES_element_index_uint for them, WebGL2 has it built in.
import { TAU, add, cross, dot, scale, madd } from './geom.js';

export function bodyMesh(rig, opts = {}) {
  const step = Math.max(1, opts.step | 0 || 1);
  const pos = [], idx = [], parts = [];
  for (const part of rig.parts) {
    const first = idx.length;
    const base = pos.length / 3;
    const M = part.M;
    // Winding: faces point outwards whatever the handedness of the part's frame.
    const flip = dot(cross(part.e1, part.e2), part.axis) < 0;
    const tri = (a, b, c) => (flip ? idx.push(a, c, b) : idx.push(a, b, c));
    // The last ring is always kept so a decimated part keeps its full length.
    const rings = part.rings.filter((_, i) => i % step === 0 || i === part.rings.length - 1);
    const cosT = [], sinT = [];
    for (let j = 0; j < M; j++) { cosT.push(Math.cos((j / M) * TAU)); sinT.push(Math.sin((j / M) * TAU)); }
    const point = (t, cx, cz, r, j) => add(add(madd(part.origin, part.axis, t), scale(part.e1, cx + r * cosT[j])), scale(part.e2, cz + r * sinT[j]));
    // Rings with dome caps: extra rings beyond each end shrinking like a half ellipsoid.
    const seq = [];
    const meanR = (rg) => rg.r.reduce((a, b) => a + b, 0) / M;
    // [axial fraction, radius factor] pairs = points of a quarter circle (sin/cos of 30, 60, ~76 degrees): the cap
    // follows a half ellipsoid with three rings, enough for smooth shading at preview sizes.
    const DOME = [[0.5, 0.866], [0.866, 0.5], [0.97, 0.24]];
    if (part.capStart) {
      const rg = rings[0], h = Math.min(meanR(rg) * 0.8, 6);
      for (let k = DOME.length - 1; k >= 0; k--) seq.push({ t: rg.t - h * DOME[k][0], cx: rg.cx, cz: rg.cz, r: rg.r.map((v) => v * DOME[k][1]) });
    }
    for (const rg of rings) seq.push(rg);
    if (part.capEnd) {
      const rg = rings[rings.length - 1], h = Math.min(meanR(rg) * 0.8, 6);
      for (const d of DOME) seq.push({ t: rg.t + h * d[0], cx: rg.cx, cz: rg.cz, r: rg.r.map((v) => v * d[1]) });
    }
    for (const rg of seq) for (let j = 0; j < M; j++) pos.push(...point(rg.t, rg.cx, rg.cz, rg.r[j], j));
    for (let i = 0; i < seq.length - 1; i++) {
      for (let j = 0; j < M; j++) {
        const a = base + i * M + j, b = base + i * M + ((j + 1) % M), c = a + M, d = b + M;
        // Outward faces (counter-clockwise seen from outside).
        tri(a, b, d); tri(a, d, c);
      }
    }
    // Poles closing both ends.
    const close = (ringIndex, rg, tEnd, outward) => {
      const p = pos.length / 3;
      pos.push(...add(madd(part.origin, part.axis, tEnd), add(scale(part.e1, rg.cx), scale(part.e2, rg.cz))));
      for (let j = 0; j < M; j++) {
        const a = base + ringIndex * M + j, b = base + ringIndex * M + ((j + 1) % M);
        if (outward) tri(a, b, p); else tri(b, a, p);
      }
    };
    const first0 = seq[0], last0 = seq[seq.length - 1];
    close(0, first0, first0.t - (part.capStart ? Math.min(meanR(rings[0]) * 0.8, 6) * 0.03 : 0), false);
    close(seq.length - 1, last0, last0.t + (part.capEnd ? Math.min(meanR(rings[rings.length - 1]) * 0.8, 6) * 0.03 : 0), true);
    parts.push({ id: part.id, kind: part.kind, first, count: idx.length - first });
  }
  const positions = new Float32Array(pos);
  const indices = new Uint32Array(idx);
  return { positions, normals: vertexNormals(positions, indices), indices, parts, bounds: bounds(positions) };
}

// Area-weighted vertex normals.
// The unnormalised cross product has length = 2 * triangle area, so summing it weights each face by its area for
// free; large faces dominate, which avoids the faceting of angle-blind averaging on uneven rings.
export function vertexNormals(positions, indices) {
  const n = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { n[k] += nx; n[k + 1] += ny; n[k + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

export function bounds(positions) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) { const v = positions[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
  }
  return { min, max };
}

// Signed volume of a closed triangle mesh part (cm^3).
// Divergence theorem: sum of signed tetrahedra (origin, a, b, c) = a . (b x c) / 6. Exact for a closed, consistently
// wound shell regardless of where the origin is; the sign tells the winding (positive = outward).
export function meshVolume(positions, indices, first = 0, count = indices.length) {
  let v = 0;
  for (let i = first; i < first + count; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    v += (positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1])
      - positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c])
      + positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c])) / 6;
  }
  return v;
}
