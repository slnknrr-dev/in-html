// plan/geom.js - geometry of floor plans in metres (y down as on screen): polygon rooms (shoelace area, perimeter,
// edge lengths, centroid, containment with edges counted inside), outline editing (move / insert / remove vertices),
// snapping to a grid and to angle steps, rotation, shapes as rectangles { x, y, w, h, rot } turned by `rot` degrees
// about their centre (corners, bounding boxes, hit tests with a grab band for flat lines), the corner resize that
// keeps the opposite corner in place even when the shape is rotated, edge-handle resizes with kept ratio, bounds of
// many shapes, fit-to-view and zoom-about-a-point view boxes. Builds on garment/geom.js for the polygon primitives.

import { area as signedArea, bbox as ptsBBox, dist, inside, segDist } from '../garment/geom.js';

// Units are metres (not pixels) everywhere: the model is resolution-independent, the view box maps it to the screen,
// and measurements (areas, edge lengths) are read straight from the data. All edits return new arrays / shapes.
export { dist, segDist };
export const mm = (v) => Math.round(v * 1000) / 1000;          // millimetre rounding keeps JSON diffs readable
const RAD = Math.PI / 180;

// --- polygons ------------------------------------------------------------------------------------------------------

export const polygonArea = (pts) => Math.abs(signedArea(pts));
export const isClockwise = (pts) => signedArea(pts) > 0;          // on screen, y down
export const edgeLengths = (pts) => pts.map((p, i) => dist(p, pts[(i + 1) % pts.length]));
export const perimeter = (pts) => edgeLengths(pts).reduce((a, b) => a + b, 0);
export const rectOutline = (w, h, x = 0, y = 0) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

// Area centroid (falls back to the vertex mean for degenerate polygons).
export function centroid(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    const c = x1 * y2 - x2 * y1;
    a += c; cx += (x1 + x2) * c; cy += (y1 + y2) * c;
  }
  if (Math.abs(a) < 1e-12) return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  return [cx / (3 * a), cy / (3 * a)];
}

// Point in polygon; points within `tol` of an edge count as inside.
export function pointInPolygon(pts, p, tol = 1e-9) {
  for (let i = 0; i < pts.length; i++) if (segDist(p, pts[i], pts[(i + 1) % pts.length]) <= tol) return true;
  return inside(pts, p);
}

// Midpoints of the edges with their lengths: where dimension labels and "add vertex" handles go.
export const edgeMidpoints = (pts) => pts.map((p, i) => { const q = pts[(i + 1) % pts.length]; return { i, at: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], length: dist(p, q) }; });

// Outline editing (new arrays; at least 3 vertices stay).
export const moveVertex = (pts, i, p, step = 0) => pts.map((q, j) => (j === i ? snapPoint(p, step) : q));
export const insertVertex = (pts, edge, p, step = 0) => [...pts.slice(0, edge + 1), snapPoint(p ?? edgeMidpoints(pts)[edge].at, step), ...pts.slice(edge + 1)];
export const removeVertex = (pts, i) => (pts.length > 3 ? pts.filter((_, j) => j !== i) : pts);

// --- snapping and rotation -----------------------------------------------------------------------------------------

// Snap to a grid step; step 0 only rounds to millimetres (the author holds Alt).
export const snap = (v, step = 0) => mm(step > 0 ? Math.round(v / step) * step : v);
export const snapPoint = (p, step = 0) => [snap(p[0], step), snap(p[1], step)];
export const normAngle = (deg) => mm(((deg % 360) + 360) % 360);
export const snapAngle = (deg, step = 15) => normAngle(step > 0 ? Math.round(deg / step) * step : deg);

export function rotatePoint(p, deg, c = [0, 0]) {
  const a = deg * RAD, cs = Math.cos(a), sn = Math.sin(a), dx = p[0] - c[0], dy = p[1] - c[1];
  return [c[0] + dx * cs - dy * sn, c[1] + dx * sn + dy * cs];
}

// Angle of the rotation handle above the shape for a pointer at p (handle on top = 0°), snapped to `step`.
export function handleAngle(sh, p, step = 15) {
  const c = center(sh);
  return snapAngle(Math.atan2(p[1] - c[1], p[0] - c[0]) / RAD + 90, step);
}

// --- shapes as rotated rectangles ----------------------------------------------------------------------------------

export const center = (sh) => [sh.x + sh.w / 2, sh.y + sh.h / 2];

// Corners in plan coordinates: top-left, top-right, bottom-right, bottom-left of the unrotated shape.
export function corners(sh) {
  const c = center(sh);
  return rectOutline(sh.w, sh.h, sh.x, sh.y).map((p) => (sh.rot ? rotatePoint(p, sh.rot, c) : p));
}

// Axis-aligned box of the rotated shape: { x, y, w, h }.
export function shapeBox(sh) {
  if (!sh.rot) return { x: sh.x, y: sh.y, w: sh.w, h: sh.h };
  const a = sh.rot * RAD, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const w = sh.w * c + sh.h * s, h = sh.w * s + sh.h * c;
  return { x: sh.x + (sh.w - w) / 2, y: sh.y + (sh.h - h) / 2, w, h };
}

// Point in plan coordinates -> the shape's own coordinates (origin at its top-left, unrotated).
export function toLocal(sh, p) {
  const c = center(sh);
  const q = sh.rot ? rotatePoint(p, -sh.rot, c) : p;
  return [q[0] - sh.x, q[1] - sh.y];
}
export const toPlan = (sh, p) => (sh.rot ? rotatePoint([sh.x + p[0], sh.y + p[1]], sh.rot, center(sh)) : [sh.x + p[0], sh.y + p[1]]);

// Is p on the shape? Flat shapes (lines, arrows) get a grab band of `band` metres (a finger's width on a plan).
export function hitShape(sh, p, band = 0.2) {
  const [lx, ly] = toLocal(sh, p);
  const hw = Math.max(sh.w, band / 2) / 2, hh = Math.max(sh.h, band) / 2;
  return Math.abs(lx - sh.w / 2) <= hw + 1e-9 && Math.abs(ly - sh.h / 2) <= hh + 1e-9;
}

// The topmost shape under p: the last in the list is drawn on top.
export function pick(shapes, p, band) {
  for (let i = shapes.length - 1; i >= 0; i--) if (hitShape(shapes[i], p, band)) return shapes[i];
  return null;
}

// Shapes whose rotated box lies in a selection rectangle { x, y, w, h } (fully, or touching with `touch`).
export function inRect(shapes, r, touch = false) {
  return shapes.filter((s) => {
    const b = shapeBox(s);
    return touch ? b.x <= r.x + r.w && b.x + b.w >= r.x && b.y <= r.y + r.h && b.y + b.h >= r.y
      : b.x >= r.x - 1e-9 && b.y >= r.y - 1e-9 && b.x + b.w <= r.x + r.w + 1e-9 && b.y + b.h <= r.y + r.h + 1e-9;
  });
}

/**
 * Resize by the bottom-right corner handle dragged to plan point p: the top-left corner stays where it is, also when
 * the shape is rotated (the new centre is recomputed along the rotated axes). Returns a new shape.
 *   step  grid step for the new width / depth (0 = free)      min  smallest side (default step or 0.05)
 */
// Technique: project the pointer into the shape's rotated axes (dot products with the axis unit vectors) to get the
// new local width / depth, then rebuild the centre from the fixed corner. Storing x / y as the unrotated top-left
// means the centre, not the corner, is the rotation pivot, hence the recomputation.
export function resizeCorner(sh, p, { step = 0, min } = {}) {
  const a = (sh.rot || 0) * RAD, cs = Math.cos(a), sn = Math.sin(a);
  const tl = corners(sh)[0];
  const v = [p[0] - tl[0], p[1] - tl[1]];
  const lw = v[0] * cs + v[1] * sn, lh = -v[0] * sn + v[1] * cs;
  const lo = min ?? (step || 0.05);
  const w = Math.max(lo, snap(lw, step)), h = Math.max(lo, snap(lh, step));
  const nc = [tl[0] + (w / 2) * cs - (h / 2) * sn, tl[1] + (w / 2) * sn + (h / 2) * cs];
  return { ...sh, w: mm(w), h: mm(h), x: mm(nc[0] - w / 2), y: mm(nc[1] - h / 2) };
}

/**
 * Resize by an edge / corner handle ('n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw') moved by (dx, dy) in the shape's
 * axes: west and north handles move the origin too, so the opposite edge stays put. keepRatio scales both sides
 * (round tables, doors). flat shapes keep h = 0. Returns a new shape.
 */
export function resizeHandle(sh, handle, dx, dy, { step = 0, keepRatio = false, flat = false, min } = {}) {
  const MIN = min ?? (flat ? 0.1 : 0.2);
  let { x, y, w, h } = sh;
  if (handle.includes('e')) w = Math.max(MIN, snap(sh.w + dx, step));
  if (handle.includes('s')) h = Math.max(MIN, snap(sh.h + dy, step));
  if (handle.includes('w')) { const nx = snap(sh.x + dx, step); w = Math.max(MIN, sh.x + sh.w - nx); x = sh.x + sh.w - w; }
  if (handle.includes('n')) { const ny = snap(sh.y + dy, step); h = Math.max(MIN, sh.y + sh.h - ny); y = sh.y + sh.h - h; }
  if (keepRatio && sh.w > 0 && sh.h > 0) {
    const k = Math.max(w / sh.w, h / sh.h);
    const nw = sh.w * k, nh = sh.h * k;
    if (handle.includes('w')) x = sh.x + sh.w - nw;
    if (handle.includes('n')) y = sh.y + sh.h - nh;
    w = nw; h = nh;
  }
  return { ...sh, x: mm(x), y: mm(y), w: mm(w), h: mm(flat ? 0 : h) };
}

// --- bounds and views ----------------------------------------------------------------------------------------------

// Bounds of shapes (rotated boxes) and point lists: { x, y, w, h } or null when empty.
export function bounds(shapes = [], outlines = []) {
  const pts = [];
  for (const s of shapes) { const b = shapeBox(s); pts.push([b.x, b.y], [b.x + b.w, b.y + b.h]); }
  for (const o of outlines) pts.push(...o);
  if (!pts.length) return null;
  const b = ptsBBox(pts);
  return { x: b.x0, y: b.y0, w: b.w, h: b.h };
}

/**
 * Fit a box into a view of vw x vh pixels with a margin (fraction of the larger side + `pad` metres):
 * -> { scale (px per metre), tx, ty (screen = plan * scale + t), viewBox: { x, y, w, h } of the view aspect }.
 */
export function fitView(box, vw, vh, { margin = 0.06, pad = 0.2 } = {}) {
  const m = Math.max(box.w, box.h) * margin + pad;
  const bw = box.w + 2 * m, bh = box.h + 2 * m;
  const scale = Math.min(vw / bw, vh / bh);
  const w = vw / scale, h = vh / scale;
  const x = box.x - m - (w - bw) / 2, y = box.y - m - (h - bh) / 2;
  return { scale, tx: -x * scale, ty: -y * scale, viewBox: { x, y, w, h } };
}

// Zoom a view box by factor f about plan point p (f < 1 zooms in), clamped to [minW, maxW] width.
// Keeps the plan point under the cursor fixed while zooming (scale the view box about p), the behaviour users expect
// from maps.
export function zoomAt(vb, p, f, { minW = 0.5, maxW = 2000 } = {}) {
  f = Math.min(Math.max(f, minW / vb.w), maxW / vb.w);
  return { x: p[0] - (p[0] - vb.x) * f, y: p[1] - (p[1] - vb.y) * f, w: vb.w * f, h: vb.h * f };
}

// Screen pixel -> plan point for a view box drawn into vw x vh pixels with "xMidYMid meet".
export function screenToPlan(vb, vw, vh, sx, sy) {
  const k = Math.max(vb.w / vw, vb.h / vh);
  const ox = (vw * k - vb.w) / 2, oy = (vh * k - vb.h) / 2;
  return [vb.x - ox + sx * k, vb.y - oy + sy * k];
}
