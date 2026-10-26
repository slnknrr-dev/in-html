// body/silhouette.js - 2D silhouettes of the body (front, side, back): the mesh is projected orthographically and
// rasterized into a mask, whose outline is traced by marching squares and simplified (Ramer-Douglas-Peucker). Works in
// any pose, arms and legs included. Also the landmark lines drawn over the front view.
//
//   silhouette(rig, view = 'front', { res = 0.5, mesh }) -> { view, contours: [[[x, y], ...]], outline, bbox }
//      x: front = wearer's left to the right (as seen), back = mirrored, side = seen from the wearer's right, facing
//      right (+z to the right); y up, centimetres
//   silhouettePath(contours, { scale, height, dx }) -> SVG path data (y always flipped around height)
//   landmarkLines(rig, sil) -> [{ id, y, x0, x1 }] (horizontal extents of the silhouette at the girth levels)

//
// Why rasterise instead of computing the outline geometrically: the projected union of dozens of overlapping parts
// in arbitrary poses has no simple analytic outline; a mask handles overlaps, holes (between arm and torso) and
// self-occlusion for free. res (cm per pixel) trades accuracy for O(area / res^2) memory and time; RDP tolerance is
// tied to res (0.6 px) so simplification never removes more than the raster already lost.
import { bodyMesh } from './mesh.js';

const project = (view) => (view === 'side' ? (x, y, z) => [z, y] : view === 'back' ? (x, y) => [-x, y] : (x, y) => [x, y]);

export function silhouette(rig, view = 'front', opts = {}) {
  const res = opts.res || 0.5;
  const mesh = opts.mesh || bodyMesh(rig, { step: 1 });
  const P = project(view);
  const p = mesh.positions;
  const n = p.length / 3;
  const xy = new Float64Array(n * 2);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const [x, y] = P(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    xy[i * 2] = x; xy[i * 2 + 1] = y;
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  // A 2-pixel empty border guarantees every contour is closed inside the grid.
  minX -= 2 * res; minY -= 2 * res; maxX += 2 * res; maxY += 2 * res;
  const W = Math.ceil((maxX - minX) / res) + 1, H = Math.ceil((maxY - minY) / res) + 1;
  const mask = new Uint8Array(W * H);
  const idx = mesh.indices;
  for (let k = 0; k < idx.length; k += 3) {
    const ax = (xy[idx[k] * 2] - minX) / res, ay = (xy[idx[k] * 2 + 1] - minY) / res;
    const bx = (xy[idx[k + 1] * 2] - minX) / res, by = (xy[idx[k + 1] * 2 + 1] - minY) / res;
    const cx = (xy[idx[k + 2] * 2] - minX) / res, cy = (xy[idx[k + 2] * 2 + 1] - minY) / res;
    fillTri(mask, W, H, ax, ay, bx, by, cx, cy);
  }
  const contours = traceContours(mask, W, H).map((c) => simplify(c.map(([i, j]) => [minX + i * res, minY + j * res]), res * 0.6)).filter((c) => c.length > 2);
  contours.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
  return { view, contours, outline: contours[0] || [], bbox: { minX: minX + 2 * res, minY: Math.max(0, minY + 2 * res), maxX: maxX - 2 * res, maxY: maxY - 2 * res }, res };
}

// Barycentric test per pixel of the bounding box; the small negative epsilon closes hairline gaps between adjacent
// triangles that would otherwise show as pinholes in the mask. Degenerate (edge-on) triangles are skipped.
function fillTri(mask, W, H, ax, ay, bx, by, cx, cy) {
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
  const d = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(d) < 1e-12) return;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const w0 = ((bx - x) * (cy - y) - (by - y) * (cx - x)) / d;
      const w1 = ((cx - x) * (ay - y) - (cy - y) * (ax - x)) / d;
      const w2 = 1 - w0 - w1;
      if (w0 >= -1e-9 && w1 >= -1e-9 && w2 >= -1e-9) mask[y * W + x] = 1;
    }
  }
}

// Marching squares on a binary mask: closed loops of [i, j] grid coordinates (edge midpoints).
// Grid points are keyed as doubled integer strings ("x*2,y*2") so half-pixel midpoints are exact map keys.
// Each segment is stored by its start point; because every boundary point has exactly one outgoing segment, loops
// are followed by lookup in O(1) per step. Saddles (5, 10) are resolved one fixed way, which may join or split two
// touching blobs; acceptable for an outline.
export function traceContours(mask, W, H) {
  const at = (i, j) => (i >= 0 && j >= 0 && i < W && j < H ? mask[j * W + i] : 0);
  const segs = new Map(); // start key -> [end key, start point, end point]
  const key = (x, y) => x * 2 + ',' + y * 2;
  const addSeg = (a, b) => { segs.set(key(a[0], a[1]), b); };
  for (let j = -1; j < H; j++) {
    for (let i = -1; i < W; i++) {
      const tl = at(i, j + 1), tr = at(i + 1, j + 1), br = at(i + 1, j), bl = at(i, j);
      const c = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (c === 0 || c === 15) continue;
      const T = [i + 0.5, j + 1], R = [i + 1, j + 0.5], B = [i + 0.5, j], L = [i, j + 0.5];
      // Segments oriented with the inside on the left.
      switch (c) {
        case 1: addSeg(L, B); break;
        case 2: addSeg(B, R); break;
        case 3: addSeg(L, R); break;
        case 4: addSeg(R, T); break;
        case 5: addSeg(L, T); addSeg(R, B); break;
        case 6: addSeg(B, T); break;
        case 7: addSeg(L, T); break;
        case 8: addSeg(T, L); break;
        case 9: addSeg(T, B); break;
        case 10: addSeg(T, R); addSeg(B, L); break;
        case 11: addSeg(T, R); break;
        case 12: addSeg(R, L); break;
        case 13: addSeg(R, B); break;
        case 14: addSeg(B, L); break;
        default: break;
      }
    }
  }
  const loops = [];
  const seen = new Set();
  for (const [k0, first] of segs) {
    if (seen.has(k0)) continue;
    const loop = [];
    let k = k0, guard = 0;
    while (!seen.has(k) && guard++ < 1e7) {
      seen.add(k);
      const [x, y] = k.split(',').map(Number);
      loop.push([x / 2, y / 2]);
      const nxt = segs.get(k);
      if (!nxt) break;
      k = key(nxt[0], nxt[1]);
    }
    void first;
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}

function area(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}

// Ramer-Douglas-Peucker on a closed polygon.
// RDP needs fixed endpoints, which a closed loop lacks: it is split at poly[0] and the point farthest from it, both
// kept, and each half is simplified as an open chain.
export function simplify(poly, tol) {
  if (poly.length < 4) return poly;
  // Split at the two farthest-apart points to simplify two open chains.
  let far = 0, fd = -1;
  for (let i = 1; i < poly.length; i++) { const d = (poly[i][0] - poly[0][0]) ** 2 + (poly[i][1] - poly[0][1]) ** 2; if (d > fd) { fd = d; far = i; } }
  const a = rdp(poly.slice(0, far + 1), tol), b = rdp(poly.slice(far).concat([poly[0]]), tol);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

// Iterative with an explicit stack: recursive RDP can overflow the call stack on long contours of a fine raster.
function rdp(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const [ax, ay] = pts[s], [bx, by] = pts[e];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    let best = -1, bd = tol;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L;
      if (d > bd) { bd = d; best = i; }
    }
    if (best > 0) { keep[best] = 1; stack.push([s, best], [best, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// SVG path data of contours: x scaled, y flipped (SVG y grows down) around `height`.
export function silhouettePath(contours, { scale = 1, height = 0, dx = 0 } = {}) {
  return contours.map((c) => 'M' + c.map(([x, y]) => `${((x + dx) * scale).toFixed(2)} ${((height - y) * scale).toFixed(2)}`).join('L') + 'Z').join('');
}

// Horizontal extents of the outline at the landmark heights (girth levels).
export function landmarkLines(rig, sil) {
  const out = [];
  const levels = { bust: rig.lm.bust, waist: rig.lm.waist, hip: rig.lm.hip, highHip: rig.lm.highHip, shoulder: rig.lm.shoulder, crotch: rig.lm.crotch, knee: rig.lm.knee };
  if (rig.sex !== 'female') { levels.chest = levels.bust; delete levels.bust; }
  for (const [id, y] of Object.entries(levels)) {
    const xs = [];
    for (const c of sil.contours) {
      for (let i = 0; i < c.length; i++) {
        const a = c[i], b = c[(i + 1) % c.length];
        if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1]) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    // The torso: the crossing pair around x = 0 (the arms are outside it).
    let x0 = xs[0], x1 = xs[xs.length - 1];
    for (let i = 0; i < xs.length - 1; i++) if (xs[i] <= 0 && xs[i + 1] >= 0) { x0 = xs[i]; x1 = xs[i + 1]; }
    out.push({ id, y, x0, x1 });
  }
  return out;
}
