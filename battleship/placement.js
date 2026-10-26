// battleship/placement.js - fleets on a board: validation of a layout (the fleet of the ruleset, inside the board, off
// the obstacles, the touching rule, the mines), seeded generators (prng/) and placement strategies: uniform (every
// legal layout equally likely, by Markov-chain sampling), sequential random, along the edges, in the open sea, spread
// out, clustered, and anti-density (where a density hunter looks last). Also the occupancy map of uniform layouts
// (the density a shooter without information expects) and the ruleset check that the fleet fits at all.
//
//   validateLayout(rs, layout) -> { ok, error?, ships: [{ t, o, x, y, p, cells }], mines }
//   layout = { ships: [{ t, o, x, y }], mines: [cell] }
//   randomLayout(rs, rng, { strategy, strength, mines }) -> layout        STRATEGIES: ids of the strategies
//   occupancy(rs) -> Float64Array          probability that a cell holds a ship under uniform layouts (cached)
//   huntDensity(rs) -> Float64Array        where a density hunter looks first on an empty board (mean 1; cached)
//   layoutFeatures(rs, layout) -> { edge, spread, horizontal, touching, center }   (style analysis)
//   validateRuleset(raw) -> validateBasics(raw) + the fleet must fit
//   encodeLayout(rs, layout) / decodeLayout(rs, text)    compact text: ships 't.o.x.y' joined by '_', mines after '~'

import { normalizeRuleset, validateBasics } from './ruleset.js';
import { geometry, placementOf, placementCells, shipOf, compatible } from './board.js';
import { Chain, emptyKnowledge, density } from './solver.js';
import { seededRandom } from '../prng/prng.js';

//
// Why Markov-chain sampling for "uniform": naive sequential random placement (largest ship first, uniform among free
// places) is NOT uniform over layouts: early ships constrain later ones, biasing ships toward edges and corners.
// A Markov chain over full layouts (solver.js Chain: move one ship at a time to a compatible place) has the uniform
// distribution as its stationary distribution, so after enough sweeps samples are unbiased. Sequential placement is
// kept as the 'random' strategy precisely because it imitates the human bias.
export const STRATEGIES = ['uniform', 'random', 'edges', 'sea', 'spread', 'cluster', 'antiDensity'];

const b36 = (n) => n.toString(36);

// Server-side trust boundary for a player's fleet: type counts must match exactly, every ship must map to a
// precomputed placement (bounds and obstacles in one lookup), pairs must be compatible (touch rule), mines distinct,
// in the sea and off ships. Pairwise check is O(ships^2), trivial at <= 40 ships.
export function validateLayout(rsIn, layout) {
  const rs = rsIn.types ? rsIn : normalizeRuleset(rsIn);
  const G = geometry(rs);
  const fail = (error) => ({ ok: false, error });
  if (!layout || !Array.isArray(layout.ships)) return fail('no ships');
  const want = new Map();
  for (const t of rs.ships) want.set(t, (want.get(t) || 0) + 1);
  const have = new Map();
  const ships = [];
  for (const s of layout.ships) {
    if (!s || !G.types[s.t]) return fail('unknown ship type');
    const p = placementOf(G, s);
    if (p < 0) return fail('a ship lies outside the sea or on an obstacle');
    ships.push({ t: s.t | 0, o: s.o | 0, x: s.x | 0, y: s.y | 0, p, cells: Array.from(placementCells(G, s.t, p)) });
    have.set(s.t, (have.get(s.t) || 0) + 1);
  }
  for (const [t, n] of want) if ((have.get(t) || 0) !== n) return fail('the fleet does not match the rules');
  for (const [t] of have) if (!want.has(t)) return fail('the fleet does not match the rules');
  for (let i = 0; i < ships.length; i++) {
    for (let j = i + 1; j < ships.length; j++) {
      if (!compatible(G, ships[i].t, ships[i].p, ships[j].t, ships[j].p)) return fail(rs.rules.touch === 'any' ? 'ships overlap' : 'ships touch');
    }
  }
  const occupied = new Uint8Array(G.N);
  for (const s of ships) for (const c of s.cells) occupied[c] = 1;
  const mines = Array.isArray(layout.mines) ? layout.mines.map((c) => c | 0) : [];
  if (mines.length !== rs.weapons.mines) return fail('wrong number of mines');
  const seen = new Set();
  for (const c of mines) {
    if (!(c >= 0 && c < G.N) || G.obstacle[c]) return fail('a mine lies outside the sea');
    if (occupied[c]) return fail('a mine lies on a ship');
    if (seen.has(c)) return fail('two mines in one cell');
    seen.add(c);
  }
  // ships in the canonical order (rs.ships: the largest first) so that indices are stable
  ships.sort((a, b) => rs.types[b.t].size - rs.types[a.t].size || a.t - b.t || a.p - b.p);
  return { ok: true, ships, mines: mines.slice().sort((a, b) => a - b) };
}

// --- occupancy of uniform layouts ---------------------------------------------------------------------------------------

const OCC = new Map();

// The probability that a cell holds a ship when every legal layout is equally likely (Markov-chain estimate with a
// fixed seed, so it is the same everywhere).
// Fixed seed per ruleset hash: every client and the server compute the identical map, so analyses and bot
// behaviour are reproducible. 30 burn-in sweeps discard the dependence on the initial layout.
export function occupancy(rsIn, samples = 1500) {
  const rs = rsIn.types ? rsIn : normalizeRuleset(rsIn);
  const key = rs.hash + ':' + samples;
  if (OCC.has(key)) return OCC.get(key);
  const G = geometry(rs);
  const K = emptyKnowledge(G);
  const rng = seededRandom('occupancy/' + rs.hash);
  const out = new Float64Array(G.N);
  const chain = new Chain(K, rng);
  let n = 0;
  if (chain.init(20000)) {
    for (let b = 0; b < 30; b++) chain.sweep();
    for (let k = 0; k < samples; k++) {
      chain.sweep();
      for (let c = 0; c < G.N; c++) if (chain.occ[c] >= 0) out[c]++;
      n++;
    }
  }
  if (n) for (let c = 0; c < G.N; c++) out[c] /= n;
  OCC.set(key, out);
  if (OCC.size > 24) OCC.delete(OCC.keys().next().value);
  return out;
}

const HUNT = new Map();

// Where a density hunter looks first on an empty board: the number of placements of the fleet's ships through each
// cell, normalised to a mean of 1 (the open sea scores high, edges and corners low). Anti-density placements and the
// mines of the clever strategies use it.
// Placement counting (not sampling): exact and cheap. Normalised to mean 1 so strategies can compare cells across
// rulesets of different sizes.
export function huntDensity(rsIn) {
  const rs = rsIn.types ? rsIn : normalizeRuleset(rsIn);
  if (HUNT.has(rs.hash)) return HUNT.get(rs.hash);
  const G = geometry(rs);
  const d = density(emptyKnowledge(G), { hitBonus: 0 });
  let sum = 0, n = 0;
  for (let c = 0; c < G.N; c++) if (!G.obstacle[c]) { sum += d[c]; n++; }
  const m = sum / Math.max(1, n) || 1;
  const out = new Float64Array(G.N);
  for (let c = 0; c < G.N; c++) out[c] = d[c] / m;
  HUNT.set(rs.hash, out);
  if (HUNT.size > 24) HUNT.delete(HUNT.keys().next().value);
  return out;
}

// --- generators ---------------------------------------------------------------------------------------------------------

// A uniform layout: Markov chain from a random start (enough sweeps to forget the start).
// init(n) finds a first legal layout within n tries; on dense fleets it may fail, so it retries with a larger budget.
function uniformPositions(G, rng, sweeps = 24) {
  const K = emptyKnowledge(G);
  const chain = new Chain(K, rng);
  let ok = chain.init(6000);
  for (let r = 0; !ok && r < 20; r++) ok = chain.init(20000);
  if (!ok) return null;
  for (let s = 0; s < sweeps; s++) chain.sweep();
  return K.ships.map((sh, i) => ({ t: sh.t, p: chain.pos[i] }));
}

// Sequential random placement (the largest ship first, each uniformly among the places still free): what a quick
// human "random" tends to do; restarts when it gets stuck.
// zc marks the zones of placed ships; a placement is free iff none of its cells is in a zone. Restart on dead end
// (up to 200 attempts) instead of backtracking: simple, and the restarts are cheap on realistic fleets.
function sequentialPositions(G, rng) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const zc = new Uint8Array(G.N);
    const out = [];
    let stuck = false;
    for (const t of G.ships) {
      const T = G.types[t];
      const opts = [];
      for (let p = 0; p < T.P; p++) {
        let ok = true;
        for (let k = 0; k < T.size; k++) if (zc[T.cells[p * T.size + k]]) { ok = false; break; }
        if (ok) opts.push(p);
      }
      if (!opts.length) { stuck = true; break; }
      const p = opts[rng.int(opts.length)];
      for (const c of T.zone[p]) zc[c] = 1;
      out.push({ t, p });
    }
    if (!stuck) return out;
  }
  return null;
}

// Scores of a layout for the strategies (higher = better for that strategy).
// Strategies are implemented as "best of N uniform samples by a score", not as dedicated generators: every
// candidate is a legal uniform layout, the score only tilts the choice, and strength controls N.
function scoreOf(G, ships, strategy, occ) {
  const cells = [];
  for (const s of ships) cells.push(...placementCells(G, s.t, s.p));
  const W = G.W, H = G.H;
  if (strategy === 'edges') {
    let e = 0;
    for (const c of cells) if (G.border[c]) e++;
    return e / cells.length;
  }
  if (strategy === 'sea') {
    let d = 0;
    for (const c of cells) { const x = c % W, y = (c / W) | 0; d += Math.min(x, y, W - 1 - x, H - 1 - y); }
    return d / cells.length;
  }
  if (strategy === 'spread' || strategy === 'cluster') {
    // mean distance from each ship's centre to the nearest other ship's centre
    const cs = ships.map((s) => { const pc = placementCells(G, s.t, s.p); let x = 0, y = 0; for (const c of pc) { x += c % W; y += (c / W) | 0; } return [x / pc.length, y / pc.length]; });
    let sum = 0;
    for (let i = 0; i < cs.length; i++) {
      let best = Infinity;
      for (let j = 0; j < cs.length; j++) if (i !== j) best = Math.min(best, Math.hypot(cs[i][0] - cs[j][0], cs[i][1] - cs[j][1]));
      sum += best === Infinity ? 0 : best;
    }
    const m = sum / Math.max(1, cs.length);
    return strategy === 'spread' ? m : -m;
  }
  if (strategy === 'antiDensity') {
    let d = 0;
    for (const c of cells) d += occ[c];
    return -d;
  }
  return 0;
}

/**
 * A random legal layout. strategy: 'uniform' (default) | 'random' | 'edges' | 'sea' | 'spread' | 'cluster' |
 * 'antiDensity'; strength 0…1 (how many candidate layouts compete: the best of 1 + 24 × strength). Mines go on free
 * cells: where shooters are expected (high occupancy) for the clever strategies, else at random.
 */
export function randomLayout(rsIn, rng, { strategy = 'uniform', strength = 0.6 } = {}) {
  const rs = rsIn.types ? rsIn : normalizeRuleset(rsIn);
  const G = geometry(rs);
  const occ = strategy === 'antiDensity' || rs.weapons.mines ? huntDensity(rs) : null;
  const tries = strategy === 'uniform' || strategy === 'random' ? 1 : 1 + Math.round(24 * Math.max(0, Math.min(1, strength)));
  let best = null, bestScore = -Infinity;
  // Later candidates use fewer sweeps (10): they start from a random init and only need decorrelation, not full mixing.
  // The 1e-6 jitter breaks score ties randomly instead of always keeping the first candidate.
  for (let k = 0; k < tries; k++) {
    const pos = strategy === 'random' ? sequentialPositions(G, rng) : uniformPositions(G, rng, k ? 10 : 24);
    if (!pos) continue;
    const sc = scoreOf(G, pos, strategy, occ) + rng.next() * 1e-6;
    if (sc > bestScore) { bestScore = sc; best = pos; }
  }
  if (!best) best = sequentialPositions(G, rng);
  if (!best) throw new Error('the fleet does not fit on this board');
  const ships = best.map((s) => shipOf(G, s.t, s.p));
  const mines = [];
  if (rs.weapons.mines) {
    const taken = new Uint8Array(G.N);
    for (const s of best) for (const c of placementCells(G, s.t, s.p)) taken[c] = 1;
    const free = [];
    for (let c = 0; c < G.N; c++) if (!taken[c] && !G.obstacle[c]) free.push(c);
    const smart = strategy !== 'uniform' && strategy !== 'random';
    for (let m = 0; m < rs.weapons.mines && free.length; m++) {
      let i;
      if (smart) {
        // Roulette-wheel selection weighted by density squared: squaring sharpens the preference for hot cells.
        // the more a shooter is drawn to a cell, the likelier a mine
        let sum = 0;
        for (const c of free) sum += occ[c] * occ[c];
        let r = rng.next() * sum;
        i = 0;
        for (; i < free.length - 1; i++) { r -= occ[free[i]] * occ[free[i]]; if (r <= 0) break; }
      } else i = rng.int(free.length);
      mines.push(free[i]);
      free.splice(i, 1);
    }
  }
  return { ships, mines: mines.sort((a, b) => a - b) };
}

// Features of a layout for the style profile: share of ship cells on the edge, mean distance to the nearest ship
// (in cells), share of horizontal ships (straight ships longer than one cell), touching corners / sides, and the mean
// distance from the edge.
export function layoutFeatures(rsIn, layout) {
  const rs = rsIn.types ? rsIn : normalizeRuleset(rsIn);
  const G = geometry(rs);
  const v = validateLayout(rs, layout);
  if (!v.ok) return null;
  const pos = v.ships.map((s) => ({ t: s.t, p: s.p }));
  const cells = v.ships.flatMap((s) => s.cells);
  let edge = 0;
  for (const c of cells) if (G.border[c]) edge++;
  let horiz = 0, long = 0;
  for (const s of v.ships) {
    const T = G.types[s.t];
    if (T.size < 2) continue;
    const ys = new Set(s.cells.map((c) => (c / G.W) | 0)), xs = new Set(s.cells.map((c) => c % G.W));
    if (ys.size === 1 || xs.size === 1) { long++; if (ys.size === 1) horiz++; }
  }
  let touching = 0;
  const own = new Map();
  v.ships.forEach((s, i) => s.cells.forEach((c) => own.set(c, i)));
  for (const s of v.ships) {
    const i = own.get(s.cells[0]);
    let touches = false;
    for (const c of s.cells) for (const d of G.n8[c]) if (own.has(d) && own.get(d) !== i) touches = true;
    if (touches) touching++;
  }
  return {
    edge: edge / Math.max(1, cells.length),
    spread: scoreOf(G, pos, 'spread', null),
    horizontal: long ? horiz / long : null,
    touching: touching / Math.max(1, v.ships.length),
    sea: scoreOf(G, pos, 'sea', null),
  };
}

// --- ruleset validation with the fit check ------------------------------------------------------------------------------

// A fleet fits iff some layout exists. Sequential placement finds one quickly in most cases; the Markov init is the
// fallback. Both are randomised (seeded per hash), so "does not fit" means "no layout found", which for very tight
// fleets can be a false negative.
export function validateRuleset(raw) {
  const v = validateBasics(raw);
  if (!v.ruleset || v.errors.some((e) => e.path === 'board.width' || e.path === 'board.height' || e.path === 'fleet')) return v;
  const rs = v.ruleset;
  try {
    const G = geometry(rs);
    for (const T of G.types) if (!T.P) { v.errors.push({ path: 'fleet', msg: 'a ship does not fit on the board' }); v.ok = false; return v; }
    const rng = seededRandom('fit/' + rs.hash);
    let ok = !!sequentialPositions(G, rng);
    if (!ok) ok = !!uniformPositions(G, rng, 0);
    if (!ok) { v.errors.push({ path: 'fleet', msg: 'the fleet does not fit on the board with these touching rules' }); v.ok = false; }
  } catch (e) {
    v.errors.push({ path: '', msg: String(e.message || e) });
    v.ok = false;
  }
  return v;
}

// --- text form of a layout ----------------------------------------------------------------------------------------------

// Base-36 numbers joined by '.', ships by '_', mines after '~': URL-safe without escaping, compact for sharing.
// decodeLayout does not validate; callers pass the result through validateLayout.
export function encodeLayout(rs, layout) {
  const ships = (layout.ships || []).map((s) => [s.t, s.o, s.x, s.y].map(b36).join('.')).join('_');
  const mines = (layout.mines || []).map(b36).join('.');
  return mines ? ships + '~' + mines : ships;
}

export function decodeLayout(rs, text) {
  const [a, b] = String(text || '').split('~');
  const ships = a ? a.split('_').filter(Boolean).map((s) => { const [t, o, x, y] = s.split('.').map((v) => parseInt(v, 36)); return { t, o, x, y }; }) : [];
  const mines = b ? b.split('.').filter(Boolean).map((v) => parseInt(v, 36)) : [];
  return { ships, mines };
}
