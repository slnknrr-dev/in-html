// view3d/math.js - column-major 4x4 matrices (as WebGL expects), the orbit camera and per-vertex normals.
//
//   perspective(fovY, aspect, near, far), lookAt(eye, target, up), mul(a, b), transformPoint(m, p)
//   orbitCamera({ target, distance, yaw, pitch, fov }) -> { eye, view, proj(aspect), viewProj(aspect) }
//   computeNormals(positions, indices, normals?) -> Float32Array
//
// Conventions: right-handed world, y up, centimetres; matrices column-major Float32Array(16) so they upload to
// WebGL uniforms without transposition; clip space is OpenGL's (z in [-1, 1]).

// Standard OpenGL frustum matrix. Depth precision is set by near / far; orbitCamera scales both with distance
// (near = 5 % of it) so the z-buffer resolution stays useful at any zoom.
export function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

// Gram-Schmidt basis (z back toward the eye, x = up x z, y = z x x) written as the inverse rigid transform.
// Degenerate when looking straight up or down (up parallel to z); the camera's pitch clamp prevents that.
export function lookAt(eye, t, up = [0, 1, 0]) {
  let zx = eye[0] - t[0], zy = eye[1] - t[1], zz = eye[2] - t[2];
  let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]), -(yx * eye[0] + yy * eye[1] + yz * eye[2]), -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1]);
}

export function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

// Clip-space coordinates [x, y, z, w] of a point.
export const transformPoint = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14], m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15],
];

// Yaw 0 looks at the front of the body (the camera on +z); pitch lifts the camera.
export function orbitCamera(o = {}) {
  const target = o.target || [0, 100, 0], dist = o.distance || 260, yaw = o.yaw ?? 0, pitch = o.pitch ?? 0.08, fov = o.fov || 0.6;
  const eye = [target[0] + dist * Math.sin(yaw) * Math.cos(pitch), target[1] + dist * Math.sin(pitch), target[2] + dist * Math.cos(yaw) * Math.cos(pitch)];
  const view = lookAt(eye, target);
  const proj = (aspect) => perspective(fov, aspect, Math.max(1, dist * 0.05), dist * 6);
  return { eye, target, view, proj, viewProj: (aspect) => mul(proj(aspect), view), fov, distance: dist, yaw, pitch };
}

// Area-weighted vertex normals: the unnormalised cross product of each triangle is added to its three vertices, so
// large triangles dominate and slivers barely count, with no per-face normalisation cost. `out` is reused across
// frames (the cloth moves every step) to avoid allocating a large array per frame.
export function computeNormals(pos, idx, out) {
  const n = out && out.length === pos.length ? out.fill(0) : new Float32Array(pos.length);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    n[a] += nx; n[a + 1] += ny; n[a + 2] += nz; n[b] += nx; n[b + 1] += ny; n[b + 2] += nz; n[c] += nx; n[c + 1] += ny; n[c + 2] += nz;
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  return n;
}
