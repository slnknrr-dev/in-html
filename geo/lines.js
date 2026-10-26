// geo/lines.js - planar geometry of lines and rings in latitude / longitude: clipping to a box (Liang-Barsky),
// simplification (Douglas-Peucker with a tolerance in metres, radial distance), chaining ways by shared ends,
// ring orientation, point in polygon, centroids, the length midpoint of a line, and turning OSM coastline into water
// polygons inside a box.
//
// Points are [lat, lng]; boxes { south, west, north, east }. Ring orientation is taken in the axes x = lng, y = lat
// (counter-clockwise > 0).
//
//   clipSegment(a, b, box) -> [a', b'] | null      clipToBBox(points, box) -> [[…], …] pieces inside
//   simplify(points, toleranceM) -> points          simplifyRadial(points, toleranceM)
//   chainWays(ways) -> chains                       ringSignedArea(ring)   pointInRing(p, ring)   ringCentroid(ring)
//   lineMidpoint(points) -> [lat, lng]              coastlineWaterRings(chains, box) -> water rings
//
// Coastline rule (OSM): land is left, water right of the line's direction. The sea is not a polygon in OSM, so the
// rings are closed along the box edge in the direction that keeps water on the right (clockwise). Islands (closed
// coastlines inside the box) and lines that end inside the box are skipped: painting land as sea is worse than not
// painting the sea.

export const insideBBox = (p, b) => p[0] >= b.south && p[0] <= b.north && p[1] >= b.west && p[1] <= b.east;

// Liang-Barsky in the axes x = lng, y = lat; null when the segment misses the box.
// Liang-Barsky: the segment is a + t(b - a), t in [0, 1]; each box edge gives an inequality p*t <= q, which narrows
// [t0, t1] (entering edges raise t0, leaving edges lower t1). Four divisions, no intersection points computed until
// the end, which is why it beats Cohen-Sutherland for the millions of segments a tile run clips.
export function clipSegment(a, b, box) {
  const dx = b[1] - a[1], dy = b[0] - a[0];
  let t0 = 0, t1 = 1;
  const edges = [[-dx, a[1] - box.west], [dx, box.east - a[1]], [-dy, a[0] - box.south], [dy, box.north - a[0]]];
  for (const [p, q] of edges) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  const at = (t) => [a[0] + dy * t, a[1] + dx * t];
  return [at(t0), at(t1)];
}

/**
 * Pieces of a line inside a box, with the crossing points on the edge. A piece ends when the next ORIGINAL point is
 * outside (comparing the clipped end with the original would split lines at random: a + (b - a) * 1 is not always b).
 */
export function clipToBBox(pts, box) {
  const runs = [];
  let cur = [];
  for (let i = 1; i < pts.length; i++) {
    const seg = clipSegment(pts[i - 1], pts[i], box);
    if (!seg) { if (cur.length > 1) runs.push(cur); cur = []; continue; }
    if (!cur.length) cur.push(seg[0]);
    cur.push(seg[1]);
    if (!insideBBox(pts[i], box)) { if (cur.length > 1) runs.push(cur); cur = []; }
  }
  if (cur.length > 1) runs.push(cur);
  return runs;
}

// Sutherland-Hodgman: a closed ring clipped to a box (polygons stay closed along the edge).
// Sutherland-Hodgman clips the polygon against one box edge at a time. The edge closures reference `at`, defined
// below them: legal because they are only called after the const is initialized. Correct for convex clip regions
// (a box); a concave ring may come back with zero-width bridges along the edge, invisible when filled.
export function clipRingToBBox(ring, b) {
  const edges = [
    [(p) => p[1] >= b.west, (p, q) => at(p, q, (b.west - p[1]) / (q[1] - p[1]))],
    [(p) => p[1] <= b.east, (p, q) => at(p, q, (b.east - p[1]) / (q[1] - p[1]))],
    [(p) => p[0] >= b.south, (p, q) => at(p, q, (b.south - p[0]) / (q[0] - p[0]))],
    [(p) => p[0] <= b.north, (p, q) => at(p, q, (b.north - p[0]) / (q[0] - p[0]))],
  ];
  const at = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  let out = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring.slice();
  for (const [inside, cross] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const p = input[i], q = input[(i + 1) % input.length];
      if (inside(q)) { if (!inside(p)) out.push(cross(p, q)); out.push(q); } else if (inside(p)) out.push(cross(p, q));
    }
    if (!out.length) return [];
  }
  return out.length >= 3 ? [...out, out[0]] : [];
}

// Local planar metres around a latitude (equirectangular): good for tolerances of a city-sized area.
// Equirectangular approximation (x scaled by cos of the mean latitude): distance errors well below 1% over a city,
// so metre tolerances in simplify() behave the same at Batumi and at the equator.
const M_PER_DEG = 111319.49079327357;
const planar = (pts) => {
  const lat0 = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const kx = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  return pts.map((p) => [p[1] * kx, p[0] * M_PER_DEG]);
};

function segDist2(p, a, b) {
  let x = a[0], y = a[1];
  const dx = b[0] - x, dy = b[1] - y;
  if (dx || dy) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; }
  }
  return (p[0] - x) ** 2 + (p[1] - y) ** 2;
}

/**
 * Douglas-Peucker: drops points closer than `toleranceM` metres to the simplified line. The first and last points are
 * always kept (tile seams and chained ways meet there). Iterative, so long coastlines do not overflow the stack.
 */
// Squared distances throughout (tol2): no sqrt in the inner loop.
export function simplify(points, toleranceM = 1) {
  if (!points || points.length < 3) return (points || []).slice();
  const xy = planar(points);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const tol2 = toleranceM * toleranceM;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist2(xy[i], xy[a], xy[b]);
      if (d > max) { max = d; idx = i; }
    }
    if (idx >= 0 && max > tol2) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

// Radial distance: drops points within `toleranceM` of the last kept point (a cheap pre-pass before simplify()).
export function simplifyRadial(points, toleranceM = 1) {
  if (!points || points.length < 3) return (points || []).slice();
  const xy = planar(points);
  const out = [points[0]];
  let last = xy[0];
  for (let i = 1; i < points.length - 1; i++) {
    if ((xy[i][0] - last[0]) ** 2 + (xy[i][1] - last[1]) ** 2 > toleranceM * toleranceM) { out.push(points[i]); last = xy[i]; }
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Joins lines that share ends (coastline arrives from OSM in pieces of a few hundred points). Growth starts from
 * "heads" - pieces whose start is no other piece's end - so the order of the Overpass answer does not matter (a naive
 * pass that starts in the middle splits a coastline into fragments, as happened on Batumi). `reverse: true` also joins
 * pieces drawn in opposite directions (roads; never coastlines, whose direction carries meaning).
 */
export function chainWays(ways, { reverse = false } = {}) {
  const key = (p) => p[0].toFixed(7) + ',' + p[1].toFixed(7);
  const list = (ways || []).filter((w) => w && w.length > 1).map((w) => w.slice());
  const byStart = new Map(), byEnd = new Map();
  const endKeys = new Set();
  const add = (m, k, w) => { if (!m.has(k)) m.set(k, []); m.get(k).push(w); };
  for (const w of list) { add(byStart, key(w[0]), w); add(byEnd, key(w[w.length - 1]), w); endKeys.add(key(w[w.length - 1])); }
  const used = new Set();
  const grow = (w) => {
    used.add(w);
    const chain = w.slice();
    for (;;) {
      const k = key(chain[chain.length - 1]);
      let next = (byStart.get(k) || []).find((c) => !used.has(c)), flip = false;
      if (!next && reverse) { next = (byEnd.get(k) || []).find((c) => !used.has(c)); flip = !!next; }
      if (!next) return chain;
      used.add(next);
      const seq = flip ? next.slice().reverse() : next;
      for (let i = 1; i < seq.length; i++) chain.push(seq[i]);
      if (chain.length > 200000) return chain;  // a guard against broken data
    }
  };
  const out = [];
  for (const w of list) if (!used.has(w) && !endKeys.has(key(w[0]))) out.push(grow(w));
  for (const w of list) if (!used.has(w)) out.push(grow(w));   // the rest: closed rings
  return out;
}

// Shoelace in x = lng, y = lat: > 0 counter-clockwise, < 0 clockwise.
export function ringSignedArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a[1] * b[0] - b[1] * a[0];
  }
  return s / 2;
}

export const isClosed = (pts) => pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];

// Even-odd point in polygon (ring or [outer, ...holes]).
// Ray casting over all rings with one parity flag: a point in a hole crosses the outer ring and the hole once each,
// so even-odd handles holes without knowing which ring is which.
export function pointInRing(p, ring) {
  const rings = Array.isArray(ring[0]?.[0]) ? ring : [ring];
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i], b = r[j];
      if ((a[0] > p[0]) !== (b[0] > p[0]) && p[1] < ((b[1] - a[1]) * (p[0] - a[0])) / (b[0] - a[0]) + a[1]) inside = !inside;
    }
  }
  return inside;
}

// Area centroid of a ring (the vertex mean for degenerate rings).
// Area-weighted centroid from the shoelace terms (the standard polygon centroid formula), in lng/lat axes and then
// swapped back to [lat, lng]; degenerate (zero-area) rings fall back to the vertex mean.
export function ringCentroid(ring) {
  const pts = isClosed(ring) ? ring.slice(0, -1) : ring;
  if (!pts.length) return null;
  let a = 0, x = 0, y = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const c = p[1] * q[0] - q[1] * p[0];
    a += c; x += (p[1] + q[1]) * c; y += (p[0] + q[0]) * c;
  }
  if (Math.abs(a) < 1e-18) return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  return [y / (3 * a), x / (3 * a)];
}

/**
 * The middle of a line by length (not the middle point of the list: on a street with a dense bend the middle of the
 * list sits in the bend). Neighbouring tiles compute the same anchor, so a label is drawn once and continues across.
 */
export function lineMidpoint(pts) {
  if (!pts || !pts.length) return null;
  if (pts.length === 1) return pts[0];
  let total = 0;
  const segs = [];
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(d); total += d; }
  if (!total) return pts[0];
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    if (acc + segs[i] >= total / 2) {
      const k = (total / 2 - acc) / (segs[i] || 1);
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k];
    }
    acc += segs[i];
  }
  return pts[pts.length - 1];
}

// --- coastline -> water ----------------------------------------------------------------------------------------

// Position of an edge point on the box perimeter in [0, 4): 0 SW->SE, 1 SE->NE, 2 NE->NW, 3 NW->SW (counter-clockwise).
export function perimeterT(p, b) {
  const h = b.east - b.west || 1, v = b.north - b.south || 1;
  const d = [Math.abs(p[0] - b.south), Math.abs(p[1] - b.east), Math.abs(p[0] - b.north), Math.abs(p[1] - b.west)];
  const side = d.indexOf(Math.min(...d));
  if (side === 0) return (p[1] - b.west) / h;
  if (side === 1) return 1 + (p[0] - b.south) / v;
  if (side === 2) return 2 + (b.east - p[1]) / h;
  return 3 + (b.north - p[0]) / v;
}

const corners = (b) => [[b.south, b.west], [b.south, b.east], [b.north, b.east], [b.north, b.west]];

// Box corners met walking the perimeter from t0 to t1 (forward = counter-clockwise).
export function boundaryWalk(t0, t1, b, forward) {
  const cs = corners(b);
  const out = [];
  const dist = forward ? (t1 - t0 + 4) % 4 : (t0 - t1 + 4) % 4;
  for (let step = 1; step <= 4; step++) {
    const k = forward ? Math.floor(t0) + step : Math.ceil(t0) - step;
    const kk = ((k % 4) + 4) % 4;
    const travelled = forward ? (k - t0 + 4) % 4 : (t0 - k + 4) % 4;
    if (travelled >= dist || travelled <= 0) continue;
    out.push(cs[kk]);
  }
  return out;
}

// Strictly inside the box (a thousandth of the side as tolerance: crossings come from floating point).
export function strictlyInside(p, b) {
  const ev = (b.north - b.south) / 1000, eh = (b.east - b.west) / 1000;
  return p[0] > b.south + ev && p[0] < b.north - ev && p[1] > b.west + eh && p[1] < b.east - eh;
}

/**
 * Coastline chains -> water rings inside a box. A real city's coast enters and leaves the box several times (capes,
 * a port, breakwaters), so the pieces are stitched along the edge: from the end of a piece walk the edge BACKWARDS
 * (clockwise, water on the right) to the nearest start of a piece, until the ring closes.
 */
export function coastlineWaterRings(chains, box) {
  const runs = [];
  for (const chain of chains) {
    for (const r of clipToBBox(chain, box)) {
      if (r.length < 2 || strictlyInside(r[0], box) || strictlyInside(r[r.length - 1], box)) continue;
      runs.push({ pts: r, tIn: perimeterT(r[0], box), tOut: perimeterT(r[r.length - 1], box) });
    }
  }
  if (!runs.length) return [];
  // Backwards distance along the edge; zero counts as a full turn (a piece must not close on itself at zero length).
  const back = (t0, t1) => { const d = (t0 - t1 + 4) % 4; return d || 4; };
  const used = new Set();
  const rings = [];
  for (let start = 0; start < runs.length; start++) {
    if (used.has(start)) continue;
    const ring = [];
    let cur = start;
    for (let guard = 0; guard <= runs.length; guard++) {
      used.add(cur);
      for (const p of runs[cur].pts) ring.push(p);
      let next = -1, best = Infinity;
      for (let j = 0; j < runs.length; j++) {
        if (used.has(j) && j !== start) continue;
        const d = back(runs[cur].tOut, runs[j].tIn);
        if (d < best) { best = d; next = j; }
      }
      if (next < 0) break;
      for (const p of boundaryWalk(runs[cur].tOut, runs[next].tIn, box, false)) ring.push(p);
      if (next === start) break;
      cur = next;
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}
