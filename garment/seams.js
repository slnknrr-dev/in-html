// garment/seams.js - seams between piece edges: paths (chains of [pieceId, edgeBase, reversed?, from?, to?] where
// the base resolves to the edge and its dart-split parts, and from / to cut a stretch of it in cm), their lengths and
// points, the seam check of a draft (both sides have the intended length difference: zero, the cap ease of a sleeve,
// the stretch of a rib band) and the notches that mark matching points on both sides. A path is a list of runs
// (polylines); the gaps between runs (a dart mouth, the step from one piece to the next) have no length, because
// they close when the garment is sewn.
//
//   pathRuns(pieces, path) -> [{ piece, pts, len }]    seamPathLength(pieces, path)
//   pathSampler(pieces, path) -> { length, at(s) -> { piece, p, tangent } }
//   checkSeams(draft, { tol }) -> [{ id, kind, a, b, ease, diff, ok }]
//   seamNotches(draft) -> [{ piece, p, dir, seam }]

import { edgeChain, edgeById } from './piece.js';
import { plLength, pointAt, reversed, splitAt } from './geom.js';

//
// Seams reference edges by base id, not by geometry: after a dart splits "side" into "side.1"/"side.2", the seam
// "side" still resolves (edgeChain) to the parts in order. Lengths ignore the gaps between runs (a dart mouth closes
// when sewn), which is exactly what a tailor measures when walking a seam.
const pieceOf = (pieces, id) => (Array.isArray(pieces) ? pieces.find((p) => p.id === id) : pieces[id]) || null;

// Runs of one path item: one polyline per edge part, in path order.
// Optional [s0, s1] cuts a stretch measured along the concatenated runs (e.g. only the upper part of a side seam
// meets the sleeve); reversal is applied after cutting so distances always count from the edge start.
export function itemRuns(pieces, item) {
  const [pid, base, rev, s0, s1] = item;
  const p = pieceOf(pieces, pid);
  if (!p) throw new Error(`seam: no piece ${pid}`);
  let ids = edgeChain(p, base);
  if (!ids.length) {
    const e = edgeById(p, base);
    if (!e) throw new Error(`seam: no edge ${pid}.${base}`);
    ids = [e.id];
  }
  let runs = ids.map((id) => edgeById(p, id).pts.map((q) => q.slice()));
  if (s0 != null || s1 != null) {
    // Cut the stretch [s0, s1] measured along the runs.
    const total = runs.reduce((s, r) => s + plLength(r), 0);
    const a = Math.max(0, s0 ?? 0), b = Math.min(total, s1 ?? total);
    const out = [];
    let acc = 0;
    for (const r of runs) {
      const L = plLength(r);
      const lo = Math.max(a, acc), hi = Math.min(b, acc + L);
      if (hi > lo + 1e-9) out.push(splitAt(splitAt(r, hi - acc)[0], lo - acc)[1]);
      acc += L;
    }
    runs = out;
  }
  if (rev) runs = runs.reverse().map(reversed);
  return runs.map((pts) => ({ piece: pid, pts, len: plLength(pts) }));
}

export const pathRuns = (pieces, path) => path.flatMap((it) => itemRuns(pieces, it));
export const seamPathLength = (pieces, path) => pathRuns(pieces, path).reduce((s, r) => s + r.len, 0);

// Position s cm along a path (gaps between runs skipped).
// Arc-length parametrisation across runs, used to place matching notches at the same fraction on both sides.
export function pathSampler(pieces, path) {
  const runs = pathRuns(pieces, path);
  const length = runs.reduce((s, r) => s + r.len, 0);
  return {
    runs, length,
    at(s) {
      let k = 0, x = Math.max(0, Math.min(length, s));
      while (k < runs.length - 1 && x > runs[k].len) { x -= runs[k].len; k++; }
      const q = pointAt(runs[k].pts, x);
      return { piece: runs[k].piece, p: q.p, tangent: q.tangent, run: k };
    },
  };
}

/**
 * Seam check: for every seam, the drafted lengths of both sides and the difference against the intended ease.
 * Darts compare their two legs; lining copies of seams whose pieces were cut by a facing are reported, not judged.
 */
// Expected relation: len(b) - len(a) = ease (0 for plain seams, positive for a sleeve cap or a gathered side,
// negative for a stretched rib band). Tolerance 0.5 mm. Lining seams are reported but not judged, because facings
// legitimately cut lining pieces shorter.
export function checkSeams(d, { tol = 0.05 } = {}) {
  const out = [];
  for (const s of d.seams) {
    let la, lb;
    try { la = seamPathLength(d.pieces, s.a); lb = seamPathLength(d.pieces, s.b); } catch (e) { out.push({ id: s.id, kind: s.kind, error: e.message, ok: false }); continue; }
    const diff = lb - la - (s.ease || 0);
    const judged = !/Lining$/.test(s.id);
    out.push({ id: s.id, kind: s.kind, a: la, b: lb, ease: s.ease || 0, diff, ok: !judged || Math.abs(diff) <= tol, judged });
  }
  return out;
}

// Notches at the seam's notch fractions on both sides (the ease spread evenly along the longer side).
// Notches at equal fractions of each side: with ease, the extra length is thereby spread evenly between notches,
// which is how ease is distributed when sewing.
export function seamNotches(d) {
  const out = [];
  for (const s of d.seams) {
    if (s.kind === 'dart' || !s.notches?.length) continue;
    for (const side of [s.a, s.b]) {
      let sm;
      try { sm = pathSampler(d.pieces, side); } catch { continue; }
      for (const f of s.notches) {
        const q = sm.at(sm.length * f);
        out.push({ piece: q.piece, p: q.p, dir: q.tangent, seam: s.id });
      }
    }
  }
  return out;
}
