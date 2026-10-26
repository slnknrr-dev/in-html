// battleship/board.js - the compiled geometry of a ruleset (cached by its hash): cells, obstacles, neighbourhoods,
// the touching rule as a list of forbidden neighbours, and every placement of every ship type on the board (cells,
// orientation, anchor, the "zone" another ship may not enter, an index by cell). The engine, the generators, the
// solvers and the bots all work on these tables; nothing evaluates shapes during play.
//
//   geometry(rs) -> G
//     G.W, G.H, G.N, G.obstacle (Uint8Array), G.border (Uint8Array), G.n4[c], G.n8[c], G.touch[c] (Int16Arrays)
//     G.types[t] = { t, size, orients, P, cells (Int16Array P × size), ori, ax, ay, zone[p] (Int16Array),
//                    byCell[c] (Int32Array of placements covering c), at(o, x, y) -> p | -1 }
//     G.ships = rs.ships (type of every ship, largest first)
//   placementCells(G, t, p) -> Int16Array;  haloOf(G, cells) -> [cells around a ship that another ship may not use]
//   compatible(G, t1, p1, t2, p2) -> boolean
//
// Two ships are compatible when no cell of one lies in the zone of the other (the zone is the ship's cells plus its
// forbidden neighbours: all eight around for touch 'none', the four side neighbours for 'corners', none for 'any');
// the relation is symmetric, so the solvers keep one count of zones per cell.

import { normalizeRuleset, orientations } from './ruleset.js';

//
// Why precompute: solvers enumerate millions of placement combinations per decision; any shape rotation or bounds
// check done inside that loop would dominate. All geometry is done once per ruleset into typed arrays (compact,
// cache-friendly, no GC churn) and shared by every game with the same ruleset hash.
// Capacity limits implied by the types: cells are Int16 (N <= 32767 cells), anchors are Uint8 (x, y <= 255),
// placement indices are Int32. ruleset.js caps each side at MAX_SIDE = 24 (576 cells), far below these limits.
// CACHE is a small FIFO keyed by the ruleset hash (Map keeps insertion order, so keys().next() is the oldest):
// bounded memory when a constructor UI generates many rulesets, O(1) hits for the common case.
const CACHE = new Map();

export function geometry(rsIn) {
  const rs = rsIn && rsIn.types ? rsIn : normalizeRuleset(rsIn);
  const hit = CACHE.get(rs.hash);
  if (hit) return hit;
  const W = rs.board.width, H = rs.board.height, N = W * H;
  const obstacle = new Uint8Array(N);
  for (const [x, y] of rs.board.obstacles) obstacle[y * W + x] = 1;
  const border = new Uint8Array(N);
  const n4 = [], n8 = [];
  for (let c = 0; c < N; c++) {
    const x = c % W, y = (c / W) | 0;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border[c] = 1;
    const a4 = [], a8 = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        a8.push(ny * W + nx);
        if (!dx || !dy) a4.push(ny * W + nx);
      }
    }
    n4.push(Int16Array.from(a4));
    n8.push(Int16Array.from(a8));
  }
  // The touching rule becomes data: 'none' forbids all 8 neighbours, 'corners' only the 4 side neighbours (diagonal
  // contact allowed), 'any' forbids nothing. Downstream code never branches on the rule again.
  const touch = rs.rules.touch === 'none' ? n8 : rs.rules.touch === 'corners' ? n4 : n8.map(() => new Int16Array(0));
  // Every placement p of a type: its cells (flat Int16Array, P x size), orientation index, anchor, and zone = own
  // cells + forbidden neighbours (sorted, enabling the binary search in compatible()). byCell[c] lists placements
  // covering c, the inverted index that lets a solver drop every placement killed by a miss at c in O(hits).
  // lookup maps (orientation, anchor) -> p for O(1) translation of the layout format { t, o, x, y }.
  const types = rs.types.map((tp) => {
    const orients = orientations(tp.shape);
    const size = tp.size;
    const cells = [], ori = [], ax = [], ay = [], zone = [];
    const lookup = new Int32Array(orients.length * N).fill(-1);
    orients.forEach((cl, o) => {
      const mw = Math.max(...cl.map((p) => p[0])) + 1, mh = Math.max(...cl.map((p) => p[1])) + 1;
      for (let y = 0; y + mh <= H; y++) {
        for (let x = 0; x + mw <= W; x++) {
          let ok = true;
          const cs = [];
          for (const [dx, dy] of cl) { const c = (y + dy) * W + x + dx; if (obstacle[c]) { ok = false; break; } cs.push(c); }
          if (!ok) continue;
          const p = ori.length;
          lookup[o * N + y * W + x] = p;
          cells.push(...cs);
          ori.push(o); ax.push(x); ay.push(y);
          const z = new Set(cs);
          for (const c of cs) for (const d of touch[c]) z.add(d);
          zone.push(Int16Array.from([...z].sort((a, b) => a - b)));
        }
      }
    });
    const P = ori.length;
    const flat = Int16Array.from(cells);
    const by = Array.from({ length: N }, () => []);
    for (let p = 0; p < P; p++) for (let k = 0; k < size; k++) by[flat[p * size + k]].push(p);
    return {
      t: tp.index, size, orients, P, cells: flat, ori: Uint8Array.from(ori), ax: Uint8Array.from(ax), ay: Uint8Array.from(ay), zone,
      byCell: by.map((a) => Int32Array.from(a)),
      at: (o, x, y) => (o >= 0 && o < orients.length && x >= 0 && y >= 0 && x < W && y < H ? lookup[o * N + y * W + x] : -1),
    };
  });
  const G = { rs, W, H, N, obstacle, border, n4, n8, touch, types, ships: rs.ships };
  CACHE.set(rs.hash, G);
  if (CACHE.size > 48) CACHE.delete(CACHE.keys().next().value);
  return G;
}

export const placementCells = (G, t, p) => G.types[t].cells.subarray(p * G.types[t].size, (p + 1) * G.types[t].size);

// The cells around a ship (its forbidden neighbours) that are not its own cells.
export function haloOf(G, cells) {
  const own = new Set(cells);
  const out = new Set();
  for (const c of cells) for (const d of G.touch[c]) if (!own.has(d)) out.add(d);
  return [...out].sort((a, b) => a - b);
}

// Checking cells of ship 2 against the zone of ship 1 suffices: zone membership is symmetric for these touch
// rules (if A's cell is in B's halo, B's cell is in A's halo), so one direction decides.
export function compatible(G, t1, p1, t2, p2) {
  const z = G.types[t1].zone[p1];
  const cs = placementCells(G, t2, p2);
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    // zones are sorted: binary search
    let lo = 0, hi = z.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (z[m] === c) return false; if (z[m] < c) lo = m + 1; else hi = m - 1; }
  }
  return true;
}

// The placement of a ship given by type, orientation and anchor (the layout format { t, o, x, y }), or -1.
export const placementOf = (G, s) => (s && G.types[s.t] ? G.types[s.t].at(s.o | 0, s.x | 0, s.y | 0) : -1);

// The layout entry { t, o, x, y } of a placement.
export function shipOf(G, t, p) {
  const T = G.types[t];
  return { t, o: T.ori[p], x: T.ax[p], y: T.ay[p] };
}
