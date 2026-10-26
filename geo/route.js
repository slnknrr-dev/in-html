// geo/route.js - visiting order of stops and a trip sheet: a distance matrix (haversine, or any metric), nearest
// neighbour construction from a fixed start (optionally a fixed end or a return to the start), 2-opt and or-opt
// improvement, precedence constraints ("pickup before delivery", "sender before receiver"), route length, and a trip
// sheet with leg distances, cumulative kilometres and arrival / departure times.
//
//   distanceMatrix(points, metric?) -> number[][] (m)
//   planRoute(stops, { start, end, closed, before, roadFactor, improve }) -> { order, km, legs, valid }
//   nearestNeighbour(dist, { start, end, before }) -> order      improveRoute(order, dist, { closed, fixedEnd, before })
//   routeLength(order, dist, closed) -> m                        respects(order, before) -> boolean
//   tripSheet(stops, order, { start: '08:30', speedKmh, serviceMin, roadFactor }) -> { rows, km, minutes }
//   orderByDistance(ids, movements, coordOf)    routeKm(points)        (the retail project's API)
//
// Stops are { lat, lng } (other fields are kept: id, name, service minutes). Precedence pairs `before` are [a, b]
// index pairs: a must be visited before b. Straight-line distance underestimates streets; `roadFactor` (1.3 is a usual
// urban detour index) scales the kilometres and times of the sheet, not the order.
import { haversine, latLng } from './sphere.js';

// Symmetric metrics (haversine) are computed once per pair; any other metric is evaluated both ways because road
// distances need not be symmetric. Missing coordinates become Infinity so the planner never routes through them.
export function distanceMatrix(points, metric = haversine) {
  const n = points.length;
  const d = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const v = latLng(points[i]) && latLng(points[j]) ? metric(points[i], points[j]) : Infinity;
      d[i][j] = v; d[j][i] = metric === haversine ? v : (latLng(points[i]) && latLng(points[j]) ? metric(points[j], points[i]) : Infinity);
    }
  }
  return d;
}

export function routeLength(order, dist, closed = false) {
  let m = 0;
  for (let i = 1; i < order.length; i++) m += dist[order[i - 1]][order[i]];
  if (closed && order.length > 1) m += dist[order[order.length - 1]][order[0]];
  return m;
}

// Predecessor sets from [a, b] pairs.
function preds(n, before) {
  const p = Array.from({ length: n }, () => []);
  for (const [a, b] of before || []) if (a !== b && a >= 0 && b >= 0 && a < n && b < n) p[b].push(a);
  return p;
}

export function respects(order, before) {
  const pos = new Map(order.map((v, i) => [v, i]));
  return (before || []).every(([a, b]) => !pos.has(a) || !pos.has(b) || pos.get(a) < pos.get(b));
}

/**
 * Greedy construction: from `start`, always the nearest stop whose predecessors are all visited. `end` is kept for
 * the last place. When constraints leave no candidate (a cycle in `before`), the nearest remaining stop is taken.
 */
// Construction heuristic for the travelling-salesman-like ordering (exact TSP is NP-hard; delivery routes have tens
// of stops, where NN + local search is within a few percent of optimal). Precedence is enforced by only
// considering stops whose predecessors are visited; an unsatisfiable (cyclic) constraint set falls back to plain
// nearest so the result is always a complete order.
export function nearestNeighbour(dist, { start = 0, end = null, before = [] } = {}) {
  const n = dist.length;
  if (!n) return [];
  const p = preds(n, before);
  const seen = new Set([start]);
  const order = [start];
  while (order.length < n - (end !== null && end !== start ? 1 : 0)) {
    const here = order[order.length - 1];
    let best = -1, bestD = Infinity, any = -1, anyD = Infinity;
    for (let j = 0; j < n; j++) {
      if (seen.has(j) || j === end) continue;
      const d = dist[here][j];
      if (d < anyD || any < 0) { anyD = d; any = j; }
      if (p[j].every((a) => seen.has(a) || a === end) && (d < bestD || best < 0)) { bestD = d; best = j; }
    }
    const next = best >= 0 ? best : any;
    if (next < 0) break;
    seen.add(next); order.push(next);
  }
  if (end !== null && end !== start && !seen.has(end)) order.push(end);
  return order;
}

/**
 * 2-opt (reverse a stretch) and or-opt (move a run of 1-3 stops) until no move shortens the route; the first stop
 * stays, the last too with `fixedEnd`; `closed` measures the return leg. Moves that break `before` are rejected.
 */
// Local search: 2-opt removes crossings by reversing a segment; or-opt relocates short runs, which 2-opt alone
// cannot do without reversing. Each candidate is re-measured with routeLength (O(n)), so a pass is O(n^3): fine for
// the tens of stops this targets, too slow for thousands (delta evaluation would be O(1) per move). Asymmetric
// distances are handled correctly precisely because whole routes are re-measured. maxPasses bounds the loop.
export function improveRoute(order, dist, { closed = false, fixedEnd = false, before = [], maxPasses = 50 } = {}) {
  let best = order.slice();
  if (best.length < 3) return best;
  let bestLen = routeLength(best, dist, closed);
  const last = best.length - (fixedEnd ? 2 : 1);
  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;
    // 2-opt
    for (let i = 1; i < last; i++) {
      for (let k = i + 1; k <= last; k++) {
        const cand = best.slice(0, i).concat(best.slice(i, k + 1).reverse(), best.slice(k + 1));
        const len = routeLength(cand, dist, closed);
        if (len < bestLen - 1e-9 && respects(cand, before)) { best = cand; bestLen = len; improved = true; }
      }
    }
    // or-opt: move a run of length 1..3 elsewhere
    for (let size = 1; size <= 3; size++) {
      for (let i = 1; i + size - 1 <= last; i++) {
        const run = best.slice(i, i + size);
        const rest = best.slice(0, i).concat(best.slice(i + size));
        const restLast = rest.length - (fixedEnd ? 1 : 0);
        for (let j = 1; j <= restLast; j++) {
          if (j === i) continue;
          const cand = rest.slice(0, j).concat(run, rest.slice(j));
          const len = routeLength(cand, dist, closed);
          if (len < bestLen - 1e-9 && respects(cand, before)) { best = cand; bestLen = len; improved = true; break; }
        }
      }
    }
    if (!improved) break;
  }
  return best;
}

/**
 * Stops -> visiting order. `start` (index, default 0) stays first; `end` (index) last; `closed: true` returns to the
 * start; `before` precedence pairs (pickup before delivery). Stops without coordinates go last in input order.
 * Returns { order (indices), km (rounded to 0.1, times roadFactor), legs: [{ from, to, km }], valid }.
 */
export function planRoute(stops, { start = 0, end = null, closed = false, before = [], roadFactor = 1, improve = true } = {}) {
  const n = (stops || []).length;
  if (!n) return { order: [], km: 0, legs: [], valid: true };
  const located = [], missing = [];
  for (let i = 0; i < n; i++) (latLng(stops[i]) ? located : missing).push(i);
  // A start without a position still goes first; the located stops are planned from the first of them.
  const lead = latLng(stops[start]) ? [] : [start];
  const tail = missing.filter((i) => i !== start);
  const idx = located;
  const sub = idx.map((i) => stops[i]);
  const dist = distanceMatrix(sub);
  const local = new Map(idx.map((v, i) => [v, i]));
  const lb = (before || []).filter(([a, b]) => local.has(a) && local.has(b)).map(([a, b]) => [local.get(a), local.get(b)]);
  const s = local.get(start) ?? 0;
  const e = end !== null && local.has(end) ? local.get(end) : null;
  let order = nearestNeighbour(dist, { start: s, end: e, before: lb });
  if (improve) order = improveRoute(order, dist, { closed, fixedEnd: e !== null, before: lb });
  const full = lead.concat(order.map((i) => idx[i]), tail);
  const legs = [];
  for (let i = 1; i < order.length; i++) legs.push({ from: idx[order[i - 1]], to: idx[order[i]], km: Math.round((dist[order[i - 1]][order[i]] * roadFactor) / 100) / 10 });
  if (closed && order.length > 1) legs.push({ from: idx[order[order.length - 1]], to: idx[order[0]], km: Math.round((dist[order[order.length - 1]][order[0]] * roadFactor) / 100) / 10 });
  const km = Math.round((routeLength(order, dist, closed) * roadFactor) / 100) / 10;
  return { order: full, km, legs, valid: respects(full, before) };
}

// "08:30" | minutes -> minutes since midnight.
const toMin = (t) => {
  if (typeof t === 'number') return t;
  const m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  return m ? +m[1] * 60 + +m[2] : 0;
};
export const clock = (min) => { const m = ((Math.round(min) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

/**
 * A trip sheet: for each stop in order { n, index, stop, legKm, totalKm, arrive, depart } (times 'HH:MM'), with
 * driving time from `speedKmh` (25 km/h is a city average) and `serviceMin` per stop (or stop.serviceMin).
 * The first stop is departed at `start`. `closed` adds the return to the first stop.
 */
// Times are minutes since midnight; clock() wraps past 24:00 so an overnight trip prints valid times (the day is
// not shown). No service time at the start or at the final return.
export function tripSheet(stops, order, { start = '09:00', speedKmh = 25, serviceMin = 10, roadFactor = 1.3, closed = false } = {}) {
  const rows = [];
  let t = toMin(start), total = 0, prev = null;
  const seq = closed && order.length > 1 ? [...order, order[0]] : order;
  seq.forEach((i, n) => {
    const st = stops[i];
    let leg = 0;
    if (prev !== null && latLng(stops[prev]) && latLng(st)) leg = (haversine(stops[prev], st) * roadFactor) / 1000;
    total += leg;
    t += (leg / Math.max(1, speedKmh)) * 60;
    const arrive = t;
    const service = n === 0 || (closed && n === seq.length - 1) ? 0 : st.serviceMin ?? serviceMin;
    t += service;
    rows.push({ n: n + 1, index: i, stop: st, legKm: Math.round(leg * 10) / 10, totalKm: Math.round(total * 10) / 10, arrive: clock(arrive), depart: clock(t), serviceMin: service });
    prev = i;
  });
  return { rows, km: Math.round(total * 10) / 10, minutes: Math.round(t - toMin(start)), end: clock(t) };
}

// --- the retail project's API ------------------------------------------------------------------------------------

// Length of a route over points with coordinates (km, 0.1); points without coordinates are skipped.
export function routeKm(points) {
  let m = 0, prev = null;
  for (const p of points || []) { if (!latLng(p)) continue; if (prev) m += haversine(prev, p); prev = p; }
  return Math.round(m / 100) / 10;
}

/**
 * Object ids -> visiting order: the first stays (where the trip starts), then always the nearest allowed one. A stop
 * is allowed when every sender of the movements delivered to it is already visited (sender before receiver).
 * Stops without coordinates come last; coordOf(id) -> { lat, lng } | null.
 */
export function orderByDistance(order, movements, coordOf) {
  if (order.length < 3) return order;
  const senders = new Map(order.map((id) => [id, new Set((movements || []).filter((m) => m.to_object === id).map((m) => m.from_object))]));
  const out = [order[0]];
  const left = order.slice(1);
  while (left.length) {
    const ok = left.filter((id) => [...senders.get(id)].every((s) => out.includes(s) || s === id || !order.includes(s)));
    const pool = ok.length ? ok : left;
    const here = coordOf(out[out.length - 1]);
    let best = null, bestD = Infinity;
    for (const id of pool) {
      const c = coordOf(id);
      const d = c && here ? haversine(here, c) : c ? 1e9 : 2e9;
      if (d < bestD) { bestD = d; best = id; }
    }
    out.push(best);
    left.splice(left.indexOf(best), 1);
  }
  return out;
}
