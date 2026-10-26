// garment/piece.js - pattern pieces: a closed outline of named edges (polylines that join end to start, clockwise on
// paper with y down), seam allowances per edge, marks (notches are distances along edges; buttons, buttonholes, drill
// holes, placement lines and labels are points / lines), a grainline, cutting instructions and hints for the 3D
// arrangement and the technical flat. Operations keep seams exact by construction: splitting a piece along a cut gives
// two pieces whose cut edges are the same polyline; joining two pieces along congruent edges merges them (side
// panels, two-piece sleeves, dart pivots); unfolding a cut-on-fold piece reflects it across its fold.
//
//   makePiece(spec), clonePiece, outline(piece), edgeById(piece, id), edgeLength(piece, id), pieceArea, pieceBBox
//   transformPiece(piece, m), mirrorPiece(piece, x0), splitPiece(piece, cut), joinPieces(A, eA, B, eB, opts)
//   unfoldPiece(piece, foldEdge), renameEdge, cutOutline(piece) (seam allowance, darts bridged), validatePiece
//   pathPoints(pieces, path) / pathLength: a seam side as a chain of [pieceId, edgeId, reversed?]

import {
  apply, area, bbox, chain, compose, dedupe, det, dist, inside, lineIntersect, offsetPolyline, plLength, pointAt,
  reflectLine, reversed, rigidOnto, same, splitAt, segIntersect, segDist,
} from './geom.js';

//
// Data model choice: a piece is a ring of named edges rather than one polygon. Seams are defined between edge ids
// ("front.side" sews to "back.side"), so names must survive every operation: splits produce cut edges with given
// ids, joins merge edges, darts number edge parts. Pieces are plain JSON (clone = JSON round trip), so they can be
// stored, diffed and sent to workers without custom serialisation.
// Invariants (checked by validatePiece): consecutive edges share exact joint points, the outline is clockwise
// (positive area with y down), edge ids are unique.
const copyPts = (pts) => pts.map((p) => [p[0], p[1]]);

// spec: { id, name, material, layer, cut: { n, mirror, fold }, edges: [{ id, pts, sa, kind }], marks, grain, ... }
// Joints closer than 0.5 mm are snapped to be identical: drafting formulas produce tiny float gaps, and an exact
// shared point is what lets later operations compare joints with same() reliably.
export function makePiece(spec) {
  const p = {
    id: spec.id, name: spec.name || spec.id, material: spec.material || 'shell', layer: spec.layer || 'shell',
    cut: { n: 1, mirror: false, fold: null, ...(spec.cut || {}) },
    edges: spec.edges.map((e) => ({ id: e.id, pts: dedupe(copyPts(e.pts)), sa: e.sa ?? 1, kind: e.kind || 'seam' })).filter((e) => plLength(e.pts) > 1e-6),
    marks: (spec.marks || []).map((m) => JSON.parse(JSON.stringify(m))),
    grain: spec.grain ? copyPts(spec.grain) : null,
    arrange: spec.arrange ? JSON.parse(JSON.stringify(spec.arrange)) : null,
    flat: spec.flat ? JSON.parse(JSON.stringify(spec.flat)) : null,
    sim: spec.sim !== false,
    meta: spec.meta ? JSON.parse(JSON.stringify(spec.meta)) : {},
  };
  // Snap joints: every edge starts where the previous one ends.
  for (let i = 0; i < p.edges.length; i++) {
    const a = p.edges[i], b = p.edges[(i + 1) % p.edges.length];
    if (dist(a.pts[a.pts.length - 1], b.pts[0]) < 0.05) b.pts[0] = a.pts[a.pts.length - 1].slice();
  }
  // Drafts are written clockwise; a counter-clockwise outline is turned round (and flagged: its edges now run the
  // other way, which matters to seams that pair directions).
  const q = area(outline(p)) < 0 ? { ...reverseOrientation(p), meta: { ...p.meta, reversed: true } } : p;
  if (!q.grain) q.grain = defaultGrain(q);
  return q;
}

export const clonePiece = (p) => JSON.parse(JSON.stringify(p));

function defaultGrain(p) {
  const b = pieceBBox(p);
  const cx = (b.x0 + b.x1) / 2;
  return [[cx, b.y0 + b.h * 0.2], [cx, b.y0 + b.h * 0.8]];
}

// Closed outline points (no repeated joints).
export function outline(p) {
  const out = [];
  for (const e of p.edges) out.push(...e.pts.slice(0, -1));
  return out;
}

export const edgeById = (p, id) => p.edges.find((e) => e.id === id) || null;
export const edgeLength = (p, id) => { const e = edgeById(p, id); return e ? plLength(e.pts) : NaN; };
export const pieceArea = (p) => Math.abs(area(outline(p)));
export const pieceBBox = (p) => bbox(outline(p));

export function renameEdge(p, from, to) { const e = edgeById(p, from); if (e) e.id = to; return p; }

// Reverses the traversal (edges and their points) so that the outline is clockwise again.
// Notches are stored as distances from the edge start, so reversing an edge must re-measure them from the other end;
// point marks need no change.
function reverseOrientation(p) {
  const q = clonePiece(p);
  q.edges = q.edges.slice().reverse().map((e) => ({ ...e, pts: reversed(e.pts) }));
  // Notches are distances from the edge start: measure them from the other end now.
  for (const m of q.marks) if (m.edge) { const e = edgeById(q, m.edge); if (e && m.at != null) m.at = plLength(e.pts) - m.at; }
  return q;
}

// Angles are transformed by the linear part of M only (directions have no position), then re-read with atan2.
const mapMark = (m, M) => {
  const o = JSON.parse(JSON.stringify(m));
  if (o.p) o.p = apply(M, o.p);
  if (o.pts) o.pts = o.pts.map((q) => apply(M, q));
  if (o.angle != null) { const v = apply([M[0], M[1], M[2], M[3], 0, 0], [Math.cos(o.angle), Math.sin(o.angle)]); o.angle = Math.atan2(v[1], v[0]); }
  return o;
};

// Applies an affine map to a piece (reflections keep the outline clockwise by reversing it).
// A reflection (det < 0) would make the outline counter-clockwise; it is reversed to restore the invariant. The
// accumulated transform is kept in meta for mapping marks or 3D placement back to the draft.
export function transformPiece(p, M) {
  const q = clonePiece(p);
  q.edges = q.edges.map((e) => ({ ...e, pts: e.pts.map((pt) => apply(M, pt)) }));
  q.marks = q.marks.map((m) => mapMark(m, M));
  if (q.grain) q.grain = q.grain.map((pt) => apply(M, pt));
  q.meta.transform = compose(M, q.meta.transform || [1, 0, 0, 1, 0, 0]);
  return det(M) < 0 ? reverseOrientation(q) : q;
}

export const mirrorPiece = (p, x0 = 0) => transformPiece(p, [-1, 0, 0, 1, 2 * x0, 0]);

// Locates a point at distance `at` along an edge (negative: from the end).
function locate(p, edgeId, at) {
  const i = p.edges.findIndex((e) => e.id === edgeId);
  if (i < 0) throw new Error(`piece ${p.id}: no edge ${edgeId}`);
  const L = plLength(p.edges[i].pts);
  const s = at < 0 ? L + at : at;
  return { i, s: Math.max(0, Math.min(L, s)), L };
}

// A part id 'x.N' that is the only part of x left in a piece becomes 'x' again (after splits and joins).
// After splits/joins an edge may be the only remaining part "x.2" of x: it gets its plain name back, so seam
// definitions written against "x" keep working regardless of how the piece was produced.
function cleanIds(p) {
  const count = {};
  for (const e of p.edges) { const b = e.id.replace(/\.\d+$/, ''); if (e.kind !== 'dart') count[b] = (count[b] || 0) + 1; }
  const taken = new Set(p.edges.map((e) => e.id));
  for (const e of p.edges) {
    if (e.kind === 'dart') continue;
    const m = /^(.*)\.(\d+)$/.exec(e.id);
    if (m && count[m[1]] === 1 && !taken.has(m[1])) {
      for (const mk of p.marks) if (mk.edge === e.id) mk.edge = m[1];
      e.id = m[1];
    }
  }
  return p;
}

const nameDupes = (edges) => {
  const count = {};
  for (const e of edges) count[e.id] = (count[e.id] || 0) + 1;
  const seen = {};
  return edges.map((e) => (count[e.id] > 1 ? { ...e, id: `${e.id}.${(seen[e.id] = (seen[e.id] || 0) + 1)}` } : e));
};

/**
 * Splits a piece along a cut from a point on one edge to a point on another (or the same) edge.
 *   cut = { from: { edge, at }, to: { edge, at }, via: [[x, y], ...] (interior points of the cut, optional),
 *           pts: the whole cut polyline (overrides from/to positions' points except for locating), ids: [cutIdA, cutIdB],
 *           pieces: [specA, specB] (id, name, ... overrides), kind }
 * A runs from the `from` point forward along the outline to `to`, then back along the cut; B is the rest.
 */
// The cut polyline is shared exactly by both pieces (A's copy reversed), so the seam they form is congruent by
// construction: no tolerance-based matching is ever needed for split seams. ptsB allows a wedge (panel seams that
// absorb suppression), where the two sides intentionally differ.
// Three cases: both points on one edge (forward or wrapping), or on different edges; each assembles A and B from
// the edge parts in outline order so both stay clockwise.
export function splitPiece(p, cut) {
  const P = locate(p, cut.from.edge, cut.from.at), Q = locate(p, cut.to.edge, cut.to.at);
  const ptP = pointAt(p.edges[P.i].pts, P.s).p, ptQ = pointAt(p.edges[Q.i].pts, Q.s).p;
  const cutPts = dedupe(cut.pts ? copyPts(cut.pts) : [ptP, ...(cut.via || []).map((v) => v.slice()), ptQ]);
  cutPts[0] = ptP; cutPts[cutPts.length - 1] = ptQ;
  // A wedge between the pieces (panel seams taking suppression): B's side of the cut (cut.ptsB) may differ from A's.
  const cutPtsB = cut.ptsB ? dedupe(copyPts(cut.ptsB)) : cutPts;
  cutPtsB[0] = ptP; cutPtsB[cutPtsB.length - 1] = ptQ;
  const E = p.edges, n = E.length;
  const part = (e, pts) => ({ ...e, pts });
  const [headP, tailP] = splitAt(E[P.i].pts, P.s);
  const [headQ, tailQ] = splitAt(E[Q.i].pts, Q.s);
  const A = [], B = [];
  const cutA = { id: cut.ids?.[0] || 'cut', pts: reversed(cutPts), sa: cut.sa ?? 1, kind: cut.kind || 'seam' };
  const cutB = { id: cut.ids?.[1] || cut.ids?.[0] || 'cut', pts: cutPtsB.map((q) => q.slice()), sa: cut.sa ?? 1, kind: cut.kind || 'seam' };
  if (P.i === Q.i && P.s < Q.s) {
    const mid = splitAt(tailP, Q.s - P.s)[0];
    A.push(part(E[P.i], mid), cutA);
    B.push(part(E[Q.i], tailQ));
    for (let k = 1; k < n; k++) B.push(E[(P.i + k) % n]);
    B.push(part(E[P.i], headP), cutB);
  } else if (P.i === Q.i) {
    // Q before P on the same edge: A goes all the way round.
    A.push(part(E[P.i], tailP));
    for (let k = 1; k < n; k++) A.push(E[(P.i + k) % n]);
    A.push(part(E[Q.i], headQ), cutA);
    B.push(part(E[P.i], splitAt(tailQ, P.s - Q.s)[0]), cutB);
  } else {
    A.push(part(E[P.i], tailP));
    for (let k = (P.i + 1) % n; k !== Q.i; k = (k + 1) % n) A.push(E[k]);
    A.push(part(E[Q.i], headQ), cutA);
    B.push(part(E[Q.i], tailQ));
    for (let k = (Q.i + 1) % n; k !== P.i; k = (k + 1) % n) B.push(E[k]);
    B.push(part(E[P.i], headP), cutB);
  }
  const mk = (edges, spec) => {
    const q = clonePiece(p);
    q.edges = nameDupes(edges.map((e) => ({ ...e, pts: copyPts(e.pts) })).filter((e) => plLength(e.pts) > 1e-6));
    Object.assign(q, spec || {});
    return q;
  };
  const a = cleanIds(mk(A, cut.pieces?.[0])), b = cleanIds(mk(B, cut.pieces?.[1]));
  // Marks go to the piece that contains them; edge notches follow their edge.
  const oa = outline(a), ob = outline(b);
  a.marks = []; b.marks = [];
  // A mark belongs to the piece that holds all its points (on the outline counts); marks across the cut are dropped.
  const within = (poly, q) => inside(poly, q) || poly.some((v, i) => segDist(q, v, poly[(i + 1) % poly.length]) < 0.2);
  for (const m of p.marks) {
    if (m.edge) { if (edgeById(a, m.edge)) a.marks.push(m); else if (edgeById(b, m.edge)) b.marks.push(m); continue; }
    const pts = m.pts || (m.p ? [m.p] : []);
    if (!pts.length) continue;
    if (pts.every((q) => within(oa, q))) a.marks.push(m); else if (pts.every((q) => within(ob, q))) b.marks.push(m);
  }
  a.grain = fitGrain(p.grain, oa);
  b.grain = fitGrain(p.grain, ob);
  return [a, b];
}

// Keeps the grain direction, moves the line into the piece if it is outside.
// The grain direction is a fabric constraint, not a position: it is kept, and the line re-centred in the new piece
// (bbox centre, or the vertex average if the centre falls outside a concave piece).
function fitGrain(g, poly) {
  const b = bbox(poly);
  const d = g ? [g[1][0] - g[0][0], g[1][1] - g[0][1]] : [0, 1];
  const L = Math.hypot(d[0], d[1]) || 1, u = [d[0] / L, d[1] / L];
  const len = Math.min(b.h, b.w) > 0 ? Math.max(3, Math.min(L, Math.max(b.h, b.w) * 0.6)) : 3;
  let c = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  if (!inside(poly, c)) {
    // Centroid of the polygon as a fallback anchor.
    let sx = 0, sy = 0;
    for (const q of poly) { sx += q[0]; sy += q[1]; }
    c = [sx / poly.length, sy / poly.length];
  }
  return [[c[0] - u[0] * len / 2, c[1] - u[1] * len / 2], [c[0] + u[0] * len / 2, c[1] + u[1] * len / 2]];
}

// Outline edges of q following the edge at index i (round), excluding it.
const others = (q, i) => Array.from({ length: q.edges.length - 1 }, (_, k) => q.edges[(i + 1 + k) % q.edges.length]);

// Merges B into A along A.eA and B.eB, where B is already placed so that eB (reversed) lies on eA.
// B's outline (without eB) replaces eA in A's ring. Its chain ends are snapped onto eA's ends, absorbing the float
// error of the rigid motion, which keeps the joints exact.
function mergePlaced(A, eA, B, eB, opts = {}) {
  const ia = A.edges.findIndex((e) => e.id === eA), ib = B.edges.findIndex((e) => e.id === eB);
  if (ia < 0 || ib < 0) throw new Error(`join: missing edge ${ia < 0 ? A.id + '.' + eA : B.id + '.' + eB}`);
  const rename = opts.renameB || ((id) => id);
  const fromB = others(B, ib).map((e) => ({ ...e, id: rename(e.id), pts: copyPts(e.pts) }));
  // Snap the chain ends onto eA's ends.
  const a0 = A.edges[ia].pts[0], a1 = A.edges[ia].pts[A.edges[ia].pts.length - 1];
  fromB[0].pts[0] = a0.slice();
  fromB[fromB.length - 1].pts[fromB[fromB.length - 1].pts.length - 1] = a1.slice();
  let edges = [...A.edges.slice(0, ia), ...fromB, ...A.edges.slice(ia + 1)].map((e) => ({ ...e, pts: copyPts(e.pts) }));
  // Adjacent edges with the same id become one edge (the hems of back and front of a side panel).
  if (opts.mergeSame !== false) {
    const may = (id) => opts.mergeSame === undefined || opts.mergeSame === true || (Array.isArray(opts.mergeSame) && opts.mergeSame.includes(id));
    const out = [];
    for (const e of edges) {
      const last = out[out.length - 1];
      if (last && last.id === e.id && last.kind === e.kind && may(e.id)) last.pts = chain(last.pts, e.pts);
      else out.push(e);
    }
    if (out.length > 1 && out[0].id === out[out.length - 1].id && out[0].kind === out[out.length - 1].kind && may(out[0].id)) {
      const last = out.pop();
      out[0].pts = chain(last.pts, out[0].pts);
    }
    edges = out;
  }
  const C = clonePiece(A);
  Object.assign(C, opts.piece || {});
  C.edges = nameDupes(edges);
  cleanIds(C);
  C.marks = [...A.marks.filter((m) => m.edge !== eA), ...B.marks.filter((m) => !m.edge || m.edge !== eB).map((m) => (m.edge ? { ...m, edge: rename(m.edge) } : m))];
  return C;
}

/**
 * Joins B to A along congruent edges: B is moved rigidly so that its edge eB, traversed backwards, lies on A's eA
 * (the way two pieces lie flat side by side at a seam). A keeps its coordinates. opts: { piece: overrides,
 * renameB(id), mergeSame, transform: false (B already placed) }.
 */
// B's edge is laid on A's edge backwards (b1 -> a0, b0 -> a1), the way two pieces lie when seamed and opened flat.
export function joinPieces(A, eA, B, eB, opts = {}) {
  const ea = edgeById(A, eA), eb = edgeById(B, eB);
  if (!ea || !eb) throw new Error(`join: missing edge ${!ea ? A.id + '.' + eA : B.id + '.' + eB}`);
  let Bp = B;
  if (opts.transform !== false) {
    const b0 = eb.pts[0], b1 = eb.pts[eb.pts.length - 1];
    const M = rigidOnto(b1, b0, ea.pts[0], ea.pts[ea.pts.length - 1]);
    Bp = transformPiece(B, M);
  }
  return mergePlaced(A, eA, Bp, eB, opts);
}

// Cut-on-fold piece opened out: reflected across the (straight) fold edge and merged. Edges of the mirrored half get
// the suffix ':L' (the piece is drafted as the right half), so seams can name either half.
// Mirror across the fold line and merge along it; ':L' suffixes keep the mirrored half's edges addressable.
export function unfoldPiece(p, foldEdge = p.cut?.fold) {
  const e = edgeById(p, foldEdge);
  if (!e) return clonePiece(p);
  const a = e.pts[0], b = e.pts[e.pts.length - 1];
  const R = transformPiece(p, reflectLine(a, b));
  const C = mergePlaced(p, foldEdge, R, foldEdge, { renameB: (id) => id + ':L', mergeSame: false });
  C.cut = { ...C.cut, n: 1, mirror: false, fold: null };
  C.meta = { ...C.meta, unfolded: true, fold: [a, b] };
  return C;
}

// --- seam allowance --------------------------------------------------------------------------------------------------

/**
 * Cutting line: every edge offset outwards by its allowance, mitred at the corners (bevelled when the mitre would
 * reach far). Dart edges (kind 'dart', in pairs) are bridged: the allowance runs straight across the dart mouth.
 * Fold edges have no allowance. Returns a closed polygon.
 */
// Each edge is offset independently (its own allowance), then consecutive offsets are joined at their line
// intersection (mitre) when it is near the corner, otherwise bevelled (both ends kept). Sharp concave corners make
// the offsets cross; removeLoops cuts those small loops out.
// Negative offset: offsetPolyline offsets to the left of travel, and for a clockwise outline in y-down coordinates
// "outside" is to the right, hence -sa.
export function cutOutline(p, opts = {}) {
  const scale = opts.allowance ?? 1;
  // Bridge darts: replace each run of dart edges by a straight edge with the allowance of its neighbours.
  const edges = [];
  for (let i = 0; i < p.edges.length; i++) {
    const e = p.edges[i];
    if (e.kind === 'dart') {
      const start = e.pts[0];
      let j = i;
      while (j + 1 < p.edges.length && p.edges[j + 1].kind === 'dart') j++;
      const end = p.edges[j].pts[p.edges[j].pts.length - 1];
      const prev = p.edges[(i - 1 + p.edges.length) % p.edges.length];
      edges.push({ id: e.id, pts: [start.slice(), end.slice()], sa: prev.sa, kind: 'bridge' });
      i = j;
    } else edges.push(e);
  }
  const offs = edges.map((e) => {
    const sa = e.kind === 'fold' ? 0 : (e.sa ?? 1) * scale;
    return sa > 0 ? offsetPolyline(e.pts, -sa) : e.pts.map((q) => q.slice());
  });
  const out = [];
  for (let i = 0; i < offs.length; i++) {
    const cur = offs[i], nxt = offs[(i + 1) % offs.length];
    const a = cur[cur.length - 2], b = cur[cur.length - 1], c = nxt[0], d = nxt[1];
    out.push(...cur.slice(1, -1));
    const X = lineIntersect(a, b, c, d);
    const maxSa = Math.max(edges[i].sa || 0, edges[(i + 1) % edges.length].sa || 0) * scale;
    if (X && X.t > 0.2 && X.u < 0.8 && dist(X.p, edges[i].pts[edges[i].pts.length - 1]) < Math.max(4 * maxSa, 0.5)) out.push(X.p);
    else { out.push(b); if (!same(b, c, 1e-6)) out.push(c); }
  }
  return removeLoops(dedupe(out));
}

// Removes small self-intersection loops of an offset outline (concave corners).
// Local search only (crossings within 40 segments): offset loops at concave corners are short, and a global
// O(n^2) sweep would be slower without finding anything more on a valid piece.
function removeLoops(poly) {
  let pts = poly.slice();
  for (let guard = 0; guard < 50; guard++) {
    let found = false;
    const n = pts.length;
    outer: for (let i = 0; i < n; i++) {
      for (let k = 2; k < Math.min(n - 1, 40); k++) {
        const j = (i + k) % n;
        const X = segIntersect(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n], 1e-7);
        if (X) {
          // Drop the points between the two segments (the loop) and insert the crossing.
          const keep = [];
          for (let m = 0; m < n; m++) {
            const inLoop = (m - i - 1 + n) % n < k;
            if (!inLoop) keep.push(pts[m]);
            if (m === i) keep.push(X);
          }
          pts = keep;
          found = true;
          break outer;
        }
      }
    }
    if (!found) break;
  }
  return pts;
}

// --- seam paths ------------------------------------------------------------------------------------------------------

const pieceOf = (pieces, id) => (Array.isArray(pieces) ? pieces.find((p) => p.id === id) : pieces[id]);

// Points of a seam side: a chain of [pieceId, edgeId, reversed?] (edges of different pieces simply concatenate).
export function pathPoints(pieces, path) {
  const out = [];
  for (const [pid, eid, rev] of path) {
    const p = pieceOf(pieces, pid);
    const e = p && edgeById(p, eid);
    if (!e) throw new Error(`seam: missing ${pid}.${eid}`);
    out.push(rev ? reversed(e.pts) : e.pts);
  }
  return out;
}

export function pathLength(pieces, path) {
  return pathPoints(pieces, path).reduce((s, pts) => s + plLength(pts), 0);
}

// Structural checks: closed joints, no self-intersection, positive area, finite numbers -> list of problems.
export function validatePiece(p) {
  const problems = [];
  for (let i = 0; i < p.edges.length; i++) {
    const a = p.edges[i], b = p.edges[(i + 1) % p.edges.length];
    if (dist(a.pts[a.pts.length - 1], b.pts[0]) > 1e-6) problems.push(`gap after ${a.id}`);
    for (const q of a.pts) if (!Number.isFinite(q[0]) || !Number.isFinite(q[1])) { problems.push(`non-finite point in ${a.id}`); break; }
  }
  const ol = outline(p);
  if (area(ol) <= 0) problems.push('orientation / area');
  const x = selfIntersectsSafe(ol);
  if (x) problems.push('self-intersection at ' + x.map((v) => v.toFixed(2)).join(','));
  const ids = new Set();
  for (const e of p.edges) { if (ids.has(e.id)) problems.push(`duplicate edge id ${e.id}`); ids.add(e.id); }
  return problems;
}

function selfIntersectsSafe(poly) {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const X = segIntersect(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n], 1e-6);
      if (X) return X;
    }
  }
  return null;
}

// --- darts and edge chains ---------------------------------------------------------------------------------------------

/**
 * Opens a dart in an edge: the legs start `width` apart, centred at distance `at` along the edge, and meet at `apex`.
 * The parts of the edge become `${base}.1`, `${base}.2`, ... in outline order (further darts keep numbering), the legs
 * are `${id}.a` (towards the apex) and `${id}.b` (back out), kind 'dart'. Returns the new piece.
 */
// Dart legs must have equal length so they sew together: the mouth position is solved by bisection on the leg
// length difference, first near the requested position, then (if no sign change) on the bracket nearest to it along
// the whole edge. If even that fails (curved/short edges), the apex is nudged onto the perpendicular bisector of the
// mouth, limited to a small move so it cannot cross other seams.
export function addEdgeDart(p, edgeId, at, width, apex, id = 'dart') {
  const q = clonePiece(p);
  const i = q.edges.findIndex((e) => e.id === edgeId);
  if (i < 0) throw new Error(`dart: piece ${p.id} has no edge ${edgeId}`);
  const e = q.edges[i];
  const L = plLength(e.pts);
  // Equal legs: the apex stays, the mouth slides along the edge until both legs have the same length.
  const legDiff = (c) => dist(pointAt(e.pts, c - width / 2).p, apex) - dist(pointAt(e.pts, c + width / 2).p, apex);
  let lo = Math.max(width / 2 + 0.1, at - 3 * width), hi = Math.min(L - width / 2 - 0.1, at + 3 * width);
  if (legDiff(lo) * legDiff(hi) >= 0) {
    // no sign change near the wanted position: the bracket nearest to it along the whole edge
    const a0 = width / 2 + 0.1, a1 = L - width / 2 - 0.1, n = 80;
    let bestGap = Infinity;
    for (let k = 0; k < n; k++) {
      const u = a0 + ((a1 - a0) * k) / n, v = a0 + ((a1 - a0) * (k + 1)) / n;
      if (legDiff(u) * legDiff(v) < 0 && Math.abs((u + v) / 2 - at) < bestGap) { bestGap = Math.abs((u + v) / 2 - at); lo = u; hi = v; }
    }
  }
  if (legDiff(lo) * legDiff(hi) < 0) {
    for (let k = 0; k < 50; k++) { const mid = (lo + hi) / 2; if ((legDiff(mid) < 0) === (legDiff(lo) < 0)) lo = mid; else hi = mid; }
    at = (lo + hi) / 2;
  }
  const s0 = Math.max(0.1, at - width / 2), s1 = Math.min(L - 0.1, at + width / 2);
  const [head, rest] = splitAt(e.pts, s0);
  const [, tail] = splitAt(rest, s1 - s0);
  // No equal-leg position near the wanted one (strongly curved or short edges): the apex moves onto the perpendicular
  // bisector of the mouth at the same depth, so the legs are equal whatever the edge does.
  const m0 = head[head.length - 1], m1 = tail[0];
  if (Math.abs(dist(m0, apex) - dist(m1, apex)) > 0.02) {
    const M = [(m0[0] + m1[0]) / 2, (m0[1] + m1[1]) / 2];
    let n = [-(m1[1] - m0[1]), m1[0] - m0[0]];
    const nl = Math.hypot(n[0], n[1]) || 1;
    n = [n[0] / nl, n[1] / nl];
    const depth = (apex[0] - M[0]) * n[0] + (apex[1] - M[1]) * n[1];
    const moved = [M[0] + n[0] * depth, M[1] + n[1] * depth];
    // only a small correction (ends of short edges); a far move would cross other seams
    if (dist(moved, apex) < Math.max(1.5, width)) apex = moved;
  }
  const base = edgeId.replace(/\.\d+$/, '');
  const parts = [
    { ...e, id: base + '#1', pts: head },
    { id: id + '.a', pts: [head[head.length - 1].slice(), apex.slice()], sa: e.sa, kind: 'dart' },
    { id: id + '.b', pts: [apex.slice(), tail[0].slice()], sa: e.sa, kind: 'dart' },
    { ...e, id: base + '#2', pts: tail },
  ];
  q.edges.splice(i, 1, ...parts);
  const isPart = (x) => x.kind !== 'dart' && (x.id === base || x.id.startsWith(base + '#') || (x.id.startsWith(base + '.') && /^\d+$/.test(x.id.slice(base.length + 1))));
  let k = 0;
  for (const x of q.edges) if (isPart(x)) x.id = `${base}.${++k}`;
  q.marks = q.marks.filter((m) => m.edge !== edgeId);
  const mouth = [(head[head.length - 1][0] + tail[0][0]) / 2, (head[head.length - 1][1] + tail[0][1]) / 2];
  q.marks.push({ type: 'dart', id, pts: [mouth, apex.slice()] });
  return q;
}

// The edges of a piece that belong to a base edge id (base, base.1, base.2 ... in outline order), darts excluded.
// The base id is regex-escaped (ids may contain '.' or ':'), then the parts are rotated so the chain starts after the
// largest index gap, since the chain may wrap past the outline start.
export function edgeChain(p, base) {
  const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('^' + esc + '(\\.\\d+)?$');
  const list = p.edges.filter((e) => e.kind !== 'dart' && re.test(e.id));
  if (list.length < 2) return list.map((e) => e.id);
  // Contiguous in outline order (the chain may wrap around the outline start).
  const idx = list.map((e) => p.edges.indexOf(e));
  let start = 0;
  for (let k = 0; k < idx.length; k++) {
    const prev = idx[(k - 1 + idx.length) % idx.length];
    if ((idx[k] - prev + p.edges.length) % p.edges.length > 3) { start = k; break; }
  }
  return [...list.slice(start), ...list.slice(0, start)].map((e) => e.id);
}
