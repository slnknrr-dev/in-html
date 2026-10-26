// garment/edits.js - edits made on the pattern itself, on top of what the template and its details draft: a piece
// changes its material slot (a contrast yoke, a satin collar), and layers are laid onto pieces - patches, appliques,
// yokes, elbow pads, bands, any shape drawn on a piece in its own centimetres. Each layer is a cut piece of its own
// (in the cutting layouts and the material usage) and an overlay sewn onto its host in 3D (garment over garment).
//
// The outline of a piece is reshaped by handles: a point of an edge (a fraction of its length, or its start corner)
// moves by (dx, dy) and its neighbours along the edge follow with a smooth falloff over r cm, so an edge bends instead
// of breaking; a corner moves the ends of both edges that meet there. Handles are kept per edge id, not per point, so
// they survive option changes that redraft the piece; copies cut from the same shape (its lining, interfacing,
// wadding) take the same handles. Seams whose edges change length are left to the seam check to report.
//
//   edits = { materials: { pieceId: material }, layers: [layer], shape: { pieceId: [handle] } }
//   handle = { edge, at (0..1 along the edge; 0 = its start corner), dx, dy (cm), r (falloff, cm; 0 = half the edge) }
//   layer = { id, piece (host), shape: 'rect' | 'ellipse' | 'poly', x, y (centre, cm in the host's frame), w, h, rot (deg),
//             pts (poly: [[x, y], ...] relative to the centre), material, side: 'both' | 'R' | 'L', sa, name }
//
//   normalizeEdits(raw) ; applyEdits(draft, edits) (in place, returns the draft) ; layerOutline(layer) -> [[x, y], ...]
//   reshapePiece(piece, handles) -> piece ; handlePoint(piece, handle) -> [x, y] (where a handle sits now)

import { makePiece } from './piece.js';
import { plLength, pointAt } from './geom.js';

//
// Edits are stored as data on top of the parametric draft (not as a modified geometry), so a size or option change
// re-drafts the garment and re-applies the edits. normalizeEdits is the trust boundary for edits loaded from files
// or links: counts are capped (40 layers, 64 handles/points), numbers clamped, material names restricted to a safe
// identifier pattern.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v, d = '', max = 40) => (typeof v === 'string' && v ? v.slice(0, max) : d);
const MATERIAL_RE = /^[a-z][a-zA-Z0-9]{0,23}$/;
export const LAYER_SHAPES = ['rect', 'ellipse', 'poly'];

export function normalizeEdits(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const materials = {};
  for (const [k, v] of Object.entries(r.materials && typeof r.materials === 'object' ? r.materials : {})) {
    if (typeof k === 'string' && k.length < 80 && MATERIAL_RE.test(v)) materials[k] = v;
  }
  const layers = (Array.isArray(r.layers) ? r.layers : []).slice(0, 40).filter((l) => l && typeof l.piece === 'string').map((l, i) => {
    const shape = LAYER_SHAPES.includes(l.shape) ? l.shape : 'rect';
    const pts = shape === 'poly' && Array.isArray(l.pts) ? l.pts.filter((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)).slice(0, 64).map(([x, y]) => [clamp(x, -200, 200), clamp(y, -200, 200)]) : null;
    return {
      id: str(l.id, 'layer' + (i + 1)), piece: l.piece.slice(0, 80), shape: pts && pts.length >= 3 ? 'poly' : shape === 'poly' ? 'rect' : shape,
      x: clamp(num(l.x, 0), -300, 300), y: clamp(num(l.y, 0), -300, 300), w: clamp(num(l.w, 10), 0.5, 200), h: clamp(num(l.h, 10), 0.5, 200),
      rot: clamp(num(l.rot, 0), -180, 180), pts: pts && pts.length >= 3 ? pts : null,
      material: MATERIAL_RE.test(l.material) ? l.material : 'contrast', side: ['both', 'R', 'L'].includes(l.side) ? l.side : 'both',
      sa: clamp(num(l.sa, 1), 0, 3), name: str(l.name, ''),
    };
  });
  const shape = {};
  for (const [pid, list] of Object.entries(r.shape && typeof r.shape === 'object' ? r.shape : {})) {
    if (typeof pid !== 'string' || pid.length > 80 || !Array.isArray(list)) continue;
    const hs = list.filter((x) => x && typeof x.edge === 'string').slice(0, 64).map((x) => ({
      edge: x.edge.slice(0, 60), at: clamp(num(x.at, 0.5), 0, 1), dx: clamp(num(x.dx, 0), -60, 60), dy: clamp(num(x.dy, 0), -60, 60), r: clamp(num(x.r, 0), 0, 200),
    })).filter((x) => x.dx || x.dy);
    if (hs.length) shape[pid] = hs;
  }
  return { materials, layers, shape };
}

// Smoothstep falloff 3u^2 - 2u^3 with u = 1 - t: weight 1 at the handle, 0 at distance r, zero slope at both ends, so
// the bent edge has no kink where the influence ends.
const smooth = (t) => { const u = clamp(1 - t, 0, 1); return u * u * (3 - 2 * u); };

/** Where a handle sits on the piece as drafted (before it moves). */
export function handlePoint(p, hd) {
  const e = p.edges.find((x) => x.id === hd.edge);
  if (!e) return null;
  return hd.at <= 0 ? e.pts[0].slice() : pointAt(e.pts, plLength(e.pts) * hd.at).p;
}

/** The piece with its outline moved by the handles (a new piece; marks and grain stay). */
// A corner handle moves both edges meeting there (the previous edge measured backwards from its end), so the joint
// stays shared. An interior handle keeps the edge ends fixed (extra taper near the ends) so neighbouring edges and
// seams keep their joints. A straight two-point edge is subdivided into 12 segments first so it can bend.
// The result goes through makePiece, which re-snaps joints and restores orientation.
export function reshapePiece(p, handles) {
  if (!handles || !handles.length) return p;
  const q = JSON.parse(JSON.stringify(p));
  const n = q.edges.length;
  for (const hd of handles) {
    const k = q.edges.findIndex((x) => x.id === hd.edge);
    if (k < 0) continue;
    const e = q.edges[k];
    const L = plLength(e.pts) || 1;
    const cum = [0];
    for (let i = 1; i < e.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(e.pts[i][0] - e.pts[i - 1][0], e.pts[i][1] - e.pts[i - 1][1]));
    if (hd.at <= 0) {
      // the start corner: this edge's first points and the previous edge's last points
      const prev = q.edges[(k - 1 + n) % n];
      const r = hd.r || Math.min(L, plLength(prev.pts)) / 2;
      e.pts.forEach((pt, i) => { const w = smooth(cum[i] / r); pt[0] += hd.dx * w; pt[1] += hd.dy * w; });
      const pc = [0];
      for (let i = prev.pts.length - 2; i >= 0; i--) pc.unshift(pc[0] + Math.hypot(prev.pts[i + 1][0] - prev.pts[i][0], prev.pts[i + 1][1] - prev.pts[i][1]));
      prev.pts.forEach((pt, i) => { const w = smooth(pc[i] / r); pt[0] += hd.dx * w; pt[1] += hd.dy * w; });
      continue;
    }
    // a point inside the edge: the ends stay, the falloff reaches them at most
    const s0 = L * hd.at, r = hd.r || Math.max(Math.min(s0, L - s0), L * 0.15);
    // a straight two-point edge gains a point at the handle so that it can bend
    if (e.pts.length === 2) {
      const m = [e.pts[0][0] + (e.pts[1][0] - e.pts[0][0]) * hd.at, e.pts[0][1] + (e.pts[1][1] - e.pts[0][1]) * hd.at];
      const a = e.pts[0], b = e.pts[1];
      e.pts = Array.from({ length: 13 }, (_, i) => { const t = i / 12; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; });
      void m;
      cum.length = 0; cum.push(0);
      for (let i = 1; i < e.pts.length; i++) cum.push(cum[i - 1] + L / 12);
    }
    e.pts.forEach((pt, i) => {
      if (i === 0 || i === e.pts.length - 1) return;
      const w = smooth(Math.abs(cum[i] - s0) / r) * Math.min(1, cum[i] / Math.max(0.5, r * 0.25), (L - cum[i]) / Math.max(0.5, r * 0.25));
      pt[0] += hd.dx * w; pt[1] += hd.dy * w;
    });
  }
  return makePiece(q);
}

/** Outline of a layer in its host's frame (clockwise, y down). */
// Rotation about the layer centre, then translation into the host's frame (y down, so positive rot is clockwise).
export function layerOutline(l) {
  let pts;
  if (l.shape === 'poly' && l.pts) pts = l.pts.map((p) => p.slice());
  else if (l.shape === 'ellipse') {
    const n = 40;
    pts = Array.from({ length: n }, (_, k) => { const a = (k / n) * Math.PI * 2; return [(l.w / 2) * Math.cos(a), (l.h / 2) * Math.sin(a)]; });
  } else pts = [[-l.w / 2, -l.h / 2], [l.w / 2, -l.h / 2], [l.w / 2, l.h / 2], [-l.w / 2, l.h / 2]];
  const a = ((l.rot || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return pts.map(([x, y]) => [l.x + x * c - y * s, l.y + x * s + y * c]);
}

// A closed outline as a piece: one edge per side (rectangles, polygons) or four arcs (ellipses).
function outlinePiece(id, pts, o) {
  const n = pts.length;
  const parts = o.shape === 'ellipse' ? 4 : n;
  const per = Math.ceil(n / parts);
  const edges = [];
  for (let k = 0; k < parts; k++) {
    const seg = [];
    for (let j = k * per; j <= Math.min(n, (k + 1) * per); j++) seg.push(pts[j % n]);
    if (seg.length >= 2) edges.push({ id: 'e' + (k + 1), pts: seg, sa: o.sa });
  }
  return makePiece({ id, name: o.name || 'layer', material: o.material, layer: 'pocket', cut: { n: o.side === 'both' ? 2 : 1, mirror: o.side === 'both' }, edges, meta: { editLayer: true } });
}

/** Applies the edits to a draft (in place). Unknown pieces are skipped; a note tells which. */
// Shape handles apply to the piece and to every copy cut from its shape (lining, interfacing, wadding), filtered to
// the handles whose edge exists on that copy.
export function applyEdits(d, edits) {
  const e = normalizeEdits(edits);
  for (const [pid, mat] of Object.entries(e.materials)) {
    const p = d.pieces.find((q) => q.id === pid);
    if (p) p.material = mat;
    for (const ov of d.overlays) if (ov.id === pid || ov.piece?.id === pid) { ov.material = mat; if (ov.piece) ov.piece.material = mat; }
  }
  // reshaped outlines: the piece and the copies cut from its shape
  for (const [pid, hs] of Object.entries(e.shape)) {
    const ids = new Set([pid, pid + 'Lining', pid + 'Interfacing', pid + 'Wadding']);
    d.pieces = d.pieces.map((p) => (ids.has(p.id) || p.meta?.liningOf === pid ? reshapePiece(p, hs.filter((hd) => p.edges.some((x) => x.id === hd.edge))) : p));
  }
  for (const l of e.layers) {
    const host = d.pieces.find((q) => q.id === l.piece);
    if (!host) { (d.notes = d.notes || []).push(`layer ${l.id}: no piece ${l.piece}`); continue; }
    const pts = layerOutline(l);
    let piece;
    try { piece = outlinePiece('layer-' + l.id, pts, l); } catch { continue; }
    d.pieces.push(piece);
    // the 3D layer lies on its host, every edge sewn down
    d.overlays.push({ id: 'layer-' + l.id, piece: { ...piece, layer: 'pocket', material: l.material }, on: host.id, lift: 0.3, attach: piece.edges.map((x) => x.id), layer: 'pocket', material: l.material, side: host.cut?.mirror || host.cut?.n > 1 || host.cut?.fold ? l.side : 'both' });
    host.marks.push({ type: 'line', id: 'layer-' + l.id, pts: [...pts, pts[0]].map((p) => p.slice()), role: 'layer', side: l.side });
  }
  d.edits = e;
  return d;
}
