// battleship/bots.js - bots for Sea Battle. A bot is a profile: a shooting method (how it chooses cells), a placement
// strategy (how it hides its fleet), a targeting rule (whose sea it fires at when there are several), traits
// (discipline, curiosity, a prior for the edges, trigger-happiness with weapons, cunning in placement, chaos) and a
// level. Templates are named personalities; a constructed bot is any mix. Bots see only their seat's view and reason
// from public knowledge (knowledge.js): nobody ever peeks at a hidden fleet.
//
//   METHODS, TARGETING, TRAITS, LEVELS, TEMPLATES, BOT_KINDS
//   profileOf(kind, options) -> profile        kind: a template id or 'custom'; options: { level, method, placement,
//                                              targeting, traits }
//   makeBot(kind, options) -> (view, seat, rng) -> action | null      (null when the seat has nothing to do)
//   decide(view, seat, rng, profile) -> action
//   evaluateBoard(view, target, rng, profile) -> { K, p (hit chance per cell), score, info, st }   (hints, analysis)
//
// Methods: random (with a naive follow-up of hits), hunt (hunt and target: random search, then the neighbours of a
// hit and along the line), parity (hunt on a checkerboard of the smallest ship still afloat), density (the classic
// count of placements of the remaining ships), montecarlo (whole fleets consistent with everything known, sampled by
// a Markov chain: the chance of every cell), information (the same samples, maximising the expected information of
// the answer), solver (exact enumeration when the position is small enough, exact expectimax of the endgame, Monte
// Carlo otherwise). Levels: Easy (30 % random blunders, often forgets a wounded ship, no sampling), Normal (10 %,
// 120 samples), Hard (3 %, 300 samples, exact positions when small), Expert (no blunders, 800 samples, exact endgames).

import { geometry } from './board.js';
import { teamOf } from './ruleset.js';
import { boardKnowledge } from './knowledge.js';
import { sample, enumerate, density, expectedInfo, endgame } from './solver.js';
import { randomLayout, occupancy } from './placement.js';
import { weaponCells } from './engine.js';

//
// Design: personality = composition of orthogonal parts (method x placement x targeting x traits x level), not a
// class hierarchy. Any combination is valid, which is what the bot constructor exposes, and strength is tuned by the
// level (blunders, forgetting, sample budget) independently of style.
// Strength order of methods, weakest to strongest: random < hunt < parity < density < montecarlo ~ information <
// solver. Density ignores ship interactions; Monte Carlo samples the true posterior; solver adds exact enumeration
// and expectimax in small positions.
export const METHODS = ['random', 'hunt', 'parity', 'density', 'montecarlo', 'information', 'solver'];
export const PLACEMENTS = ['uniform', 'random', 'edges', 'sea', 'spread', 'cluster', 'antiDensity'];
export const TARGETING = ['best', 'weakest', 'leader', 'random', 'revenge'];
export const TRAITS = [
  { id: 'discipline', def: 0.9 },  // finishes a wounded ship before searching on
  { id: 'curiosity', def: 0.2 },   // weight of the expected information against the chance to hit
  { id: 'edgeBias', def: 0.5 },    // prior of the search: 0 the open sea first, 0.5 none, 1 the edges first
  { id: 'trigger', def: 0.5 },     // eagerness with weapons: 1 fires them at once, 0 keeps them for the end
  { id: 'cunning', def: 0.5 },     // how hard it optimises its placement strategy
  { id: 'chaos', def: 0.05 },      // noise on its scores
];
// blunder: chance a shot is uniformly random; forget: chance a wounded ship is ignored this turn; samples: MCMC
// budget (0 forces a fallback to density); endgame: 1 exact enumeration, 2 also expectimax; place: placement
// optimisation strength multiplier.
export const LEVELS = [
  { id: 1, name: 'Easy', blunder: 0.3, forget: 0.4, samples: 0, endgame: 0, place: 0.15 },
  { id: 2, name: 'Normal', blunder: 0.1, forget: 0.12, samples: 120, endgame: 0, place: 0.45 },
  { id: 3, name: 'Hard', blunder: 0.03, forget: 0, samples: 300, endgame: 1, place: 0.75 },
  { id: 4, name: 'Expert', blunder: 0, forget: 0, samples: 800, endgame: 2, place: 1 },
];

const T = (o) => ({ discipline: 0.9, curiosity: 0.2, edgeBias: 0.5, trigger: 0.5, cunning: 0.5, chaos: 0.05, ...o });

// Templates. `principles` are three short sentences each (translated by the application).
export const TEMPLATES = [
  {
    id: 'rookie', name: 'Rookie', icon: '🐣', method: 'random', placement: 'random', targeting: 'random',
    summary: 'Fires wherever it fancies and follows up a hit only when it remembers to; drops its ships quickly one after another and fires its weapons at once.',
    principles: ['random shots', 'a naive follow-up of hits', 'quick placement'],
    traits: T({ discipline: 0.6, curiosity: 0, trigger: 1, cunning: 0, chaos: 0.3 }),
  },
  {
    id: 'hunter', name: 'Hunter', icon: '🎯', method: 'parity', placement: 'uniform', targeting: 'weakest',
    summary: 'The textbook hunt and target: searches on a checkerboard spaced by the smallest ship still afloat, finishes every wounded ship along its line and goes after the weakest fleet.',
    principles: ['checkerboard search', 'finishes wounded ships', 'presses the weakest'],
    traits: T({ discipline: 1, curiosity: 0, trigger: 0.8, cunning: 0.2 }),
  },
  {
    id: 'cartographer', name: 'Cartographer', icon: '🗺️', method: 'density', placement: 'spread', targeting: 'best',
    summary: 'Counts every way the remaining ships could still lie and fires where the most of them cross; spreads its own ships evenly over the sea.',
    principles: ['placement density', 'spread-out fleet', 'the best chance anywhere'],
    traits: T({ discipline: 1, curiosity: 0.05, trigger: 0.5, cunning: 0.7 }),
  },
  {
    id: 'statistician', name: 'Statistician', icon: '📊', method: 'montecarlo', placement: 'uniform', targeting: 'best',
    summary: 'Samples whole fleets consistent with everything it has seen and fires at the cell most likely to hold a ship; hides its own fleet uniformly at random, which no prior can exploit.',
    principles: ['Monte-Carlo fleets', 'the most likely cell', 'an unexploitable placement'],
    traits: T({ discipline: 1, curiosity: 0.1, trigger: 0.5, cunning: 0.3 }),
  },
  {
    id: 'scholar', name: 'Scholar', icon: '🧠', method: 'information', placement: 'sea', targeting: 'best',
    summary: 'Asks the questions whose answers teach it the most: maximises the expected information of every shot, loves radar scans, and keeps its ships away from the edges.',
    principles: ['maximal information', 'radar first', 'ships in the open sea'],
    traits: T({ discipline: 1, curiosity: 0.85, trigger: 0.4, cunning: 0.6 }),
  },
  {
    id: 'corsair', name: 'Corsair', icon: '🏴‍☠️', method: 'density', placement: 'edges', targeting: 'leader',
    summary: 'Hugs the coasts with its own ships and expects everybody else to do the same: searches the edges first, attacks the strongest fleet and fires its weapons early.',
    principles: ['ships along the edges', 'searches the edges first', 'attacks the leader'],
    traits: T({ discipline: 0.9, edgeBias: 0.9, trigger: 0.9, cunning: 0.9, chaos: 0.12 }),
  },
  {
    id: 'ghost', name: 'Ghost', icon: '👻', method: 'montecarlo', placement: 'antiDensity', targeting: 'weakest',
    summary: 'Hides where density hunters look last and saves its weapons for the endgame; sampled fleets guide its own shots, and it finishes off whoever is weakest.',
    principles: ['anti-density placement', 'patient weapons', 'finishes the weakest'],
    traits: T({ discipline: 1, curiosity: 0.15, trigger: 0.1, cunning: 1 }),
  },
  {
    id: 'admiral', name: 'Admiral', icon: '👑', method: 'solver', placement: 'antiDensity', targeting: 'best',
    summary: 'Everything at once: Monte-Carlo fleets, exact enumeration as soon as the position is small, an exact expectimax of the endgame, weapons weighed by their expected gain and a placement that density hunters miss.',
    principles: ['exact endgames', 'weapons by expected gain', 'unpredictable placement'],
    traits: T({ discipline: 1, curiosity: 0.12, trigger: 0.5, cunning: 0.7, chaos: 0.01 }),
  },
];

export const templateById = (id) => TEMPLATES.find((t) => t.id === id) || null;

// Untrusted options (from room settings) are whitelisted and clamped: methods/placements from fixed lists, traits
// into 0..1, samples capped at 4000 so a client cannot make the server burn CPU per bot move.
export function profileOf(kind, options = {}) {
  const tpl = templateById(kind) || templateById('statistician');
  const level = LEVELS.find((l) => l.id === (options.level | 0)) || LEVELS[1];
  const traits = { ...tpl.traits };
  for (const t of TRAITS) if (options.traits && Number.isFinite(+options.traits[t.id])) traits[t.id] = Math.min(1, Math.max(0, +options.traits[t.id]));
  const method = METHODS.includes(options.method) ? options.method : tpl.method;
  const placement = PLACEMENTS.includes(options.placement) ? options.placement : tpl.placement;
  const targeting = TARGETING.includes(options.targeting) ? options.targeting : tpl.targeting;
  return {
    kind: kind === 'custom' ? 'custom' : tpl.id, level: level.id, method, placement, targeting, traits,
    blunder: options.blunder ?? level.blunder, forget: level.forget,
    samples: options.samples != null ? Math.max(0, Math.min(4000, options.samples | 0)) : level.samples,
    endgame: level.endgame, placeStrength: traits.cunning * level.place,
  };
}

export function makeBot(kind, options = {}) {
  const P = profileOf(kind, options);
  return (view, seat, rng) => {
    if (!view || view.phase === 'over' || seat < 0) return null;
    if (view.phase === 'place') return view.boards[seat] && !view.boards[seat].placed && view.boards[seat].alive ? placeAction(view, seat, rng, P) : null;
    if (view.turn !== seat) return null;
    return decide(view, seat, rng, P);
  };
}

// --- placement --------------------------------------------------------------------------------------------------------

export function placeAction(view, seat, rng, P) {
  const layout = randomLayout(view.rs, rng, { strategy: P.placement, strength: P.placeStrength });
  return { type: 'place', ships: layout.ships, mines: layout.mines };
}

// --- evaluation of one board -------------------------------------------------------------------------------------------

// Hits not explained by a shown sunk ship (the "wounded" cells a hunter follows).
// Mark 2 = hit not part of a shown sunk ship. Under announce 'sunk' or 'hit' the hits of sunk ships also stay 2,
// so simple hunters may keep probing around a ship that is already gone; the sampling methods do not, because
// the knowledge model accounts for sunk ships.
function openHits(view, target) {
  const b = view.boards[target];
  const out = [];
  for (let c = 0; c < b.marks.length; c++) if (b.marks[c] === 2) out.push(c);
  return out;
}

// Unknown cells next to open hits, along the line when two hits are aligned (hunt and target).
// Classic "target mode": if two hits are aligned, extend the line at both ends; otherwise try the 4 neighbours.
// Assumes straight ships; for polyomino rulesets it is a heuristic only (sampling methods handle shapes exactly).
function targetCells(G, marks, hits) {
  const free = (c) => c >= 0 && marks[c] === 0 && !G.obstacle[c];
  const set = new Set(hits);
  const line = new Set(), around = new Set();
  for (const h of hits) {
    const x = h % G.W, y = (h / G.W) | 0;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const aligned = (x + dx < G.W && y + dy < G.H && set.has(h + dy * G.W + dx)) || (x - dx >= 0 && y - dy >= 0 && set.has(h - dy * G.W - dx));
      if (!aligned) continue;
      // walk both ways to the ends of the line of hits
      for (const s of [1, -1]) {
        let xx = x, yy = y;
        for (;;) {
          xx += dx * s; yy += dy * s;
          if (xx < 0 || yy < 0 || xx >= G.W || yy >= G.H) break;
          const c = yy * G.W + xx;
          if (set.has(c)) continue;
          if (free(c)) line.add(c);
          break;
        }
      }
    }
    for (const d of G.n4[h]) if (free(d)) around.add(d);
  }
  return line.size ? [...line] : [...around];
}

/**
 * Scores of every cell of one board for this profile: { K, p (estimated chance of a hit), score (what the method
 * maximises; -Infinity where it cannot fire), info (bits, when sampled), st (the samples) }.
 */
// Produces two arrays: p (calibrated hit probability, used for weapons, mines and board choice) and score (what the
// method maximises, possibly mixing information and priors). Keeping them separate lets curiosity change the choice
// without corrupting probability estimates used elsewhere.
export function evaluateBoard(view, target, rng, P, seat = view.seat) {
  const rs = view.rs, G = geometry(rs);
  const b = view.boards[target];
  const K = boardKnowledge(view, target);
  const N = G.N;
  const p = new Float64Array(N), score = new Float64Array(N).fill(-Infinity);
  const free = [];
  for (let c = 0; c < N; c++) if (!G.obstacle[c] && b.marks[c] === 0) free.push(c);
  const out = { K, p, score, info: null, st: null, free, target, best: null, exact: false };
  if (!free.length) return out;
  const tr = P.traits;
  const hits = openHits(view, target);
  const following = hits.length && rng.next() < tr.discipline * (1 - P.forget);
  let method = P.method;
  if ((method === 'montecarlo' || method === 'information' || method === 'solver') && !P.samples) method = 'density';
  const remaining = remainingCells(view, target, K);
  if (method === 'random' || method === 'hunt' || method === 'parity') {
    const tc = following ? targetCells(G, b.marks, hits) : [];
    const par = method === 'parity' ? parityOf(view, target, seat) : null;
    for (const c of free) {
      let s = 1;
      if (tc.length) s = tc.includes(c) ? 10 : 0.01;
      else if (par && par.m > 1 && ((c % G.W) + ((c / G.W) | 0)) % par.m !== par.r) s = 0.05;
      if (method === 'random' && !tc.length) s = 1;
      score[c] = s * edgePrior(G, c, tr.edgeBias, !tc.length);
      p[c] = remaining / Math.max(1, free.length);
    }
    if (tc.length) for (const c of tc) p[c] = 0.35;
  } else if (method === 'density') {
    const d = density(K);
    let sum = 0;
    for (const c of free) sum += d[c];
    for (const c of free) {
      const v = sum > 0 ? d[c] / sum : 1 / free.length;
      p[c] = Math.min(1, v * remaining * (hits.length ? 0.6 : 1));
      score[c] = v * edgePrior(G, c, tr.edgeBias, !hits.length);
    }
  } else {
    let st = null;
    if (method === 'solver' && P.endgame && (K.unknown <= 40 || K.ships.filter((s) => !s.sunk).length <= 4)) {
      const ex = enumerate(K, { budget: P.endgame >= 2 ? 40000 : 15000, keep: P.endgame >= 2 ? 64 : 0 });
      if (ex.complete && ex.count > 0) { st = ex; out.exact = true; }
    }
    if (!st) {
      // Sample count scales inversely with total placements (work per sweep), floor 40, so decision time stays roughly
      // constant across board sizes. Configurations are kept only when radar charges exist (radarInfo needs them).
      // big seas: fewer samples, so that a decision stays fast (the work of a sweep grows with ships × placements)
      const work = G.ships.reduce((a, t) => a + G.types[t].P, 0);
      const n = Math.max(40, Math.round(P.samples * Math.min(1, 1600 / Math.max(1, work))));
      const keep = view.charges && view.charges[seat] && view.charges[seat].radar > 0 ? Math.min(n, 300) : 0;
      st = sample(K, rng, { samples: n, chains: n >= 300 ? 4 : 2, burn: 6, keep });
    }
    if (st.failed || !st.n) {
      const d = density(K);
      for (const c of free) { p[c] = d[c]; score[c] = d[c]; }
    } else {
      out.st = st;
      const info = new Float64Array(N);
      let maxInfo = 1e-9;
      for (const c of free) {
        p[c] = st.occ[c] / st.n;
        info[c] = expectedInfo(K, st, c);
        if (info[c] > maxInfo) maxInfo = info[c];
      }
      out.info = info;
      // score = (1 - c) * P(hit) + c * normalised information. Pure information maximisation wastes shots on informative
      // misses late in the game; pure probability ignores learning. The 0.9 factor keeps a certain hit (p = 1) above any
      // information-only cell even at high curiosity.
      const cur = method === 'information' ? Math.max(tr.curiosity, 0.6) : tr.curiosity;
      for (const c of free) score[c] = ((1 - cur) * p[c] + cur * (info[c] / maxInfo) * 0.9) * edgePrior(G, c, tr.edgeBias, !hits.length);
      // exact endgame: the expectimax cell
      if (method === 'solver' && out.exact && P.endgame >= 2 && st.configs && st.configs.length === st.count && st.count > 1 && st.count <= 64) {
        // Objective: when a hit earns another shot, only misses cost a turn, so the optimal policy minimises misses.
        // The +10 bonus makes the expectimax cell dominate the score array without discarding other scores.
        const r = endgame(K, st.configs, { objective: rs.rules.afterHit === 'again' && rs.rules.shots === 'single' ? 'misses' : 'shots', budget: 25000 });
        if (r) { out.best = r.cell; score[r.cell] += 10; }
      }
    }
  }
  // Penalty proportional to the chance a cell is water (mines lie in water) and to the expected mine density among
  // water cells; scaled by the best score so it is commensurate with the method's units.
  // mines: a shot into a mine costs a shot at the own board
  if (K.minesLeft > 0) {
    let water = 0;
    for (const c of free) water += 1 - Math.min(1, p[c]);
    const pm = K.minesLeft / Math.max(1, water);
    let mx = 0;
    for (const c of free) mx = Math.max(mx, score[c]);
    for (const c of free) score[c] -= mx * 0.6 * pm * (1 - Math.min(1, p[c]));
  }
  // Chaos: uniform noise relative to the score range. Makes bots less predictable (a human cannot learn a fixed
  // order) at a controlled strength cost.
  if (tr.chaos > 0) {
    let mx = 0;
    for (const c of free) mx = Math.max(mx, Math.abs(score[c]));
    for (const c of free) score[c] += (rng.next() - 0.5) * tr.chaos * mx;
  }
  return out;
}

// Ship cells still afloat on a board (estimate when sinkings are secret).
function remainingCells(view, target, K) {
  const rs = view.rs;
  let total = rs.cellCount;
  const b = view.boards[target];
  let hit = 0;
  for (const m of b.marks) if (m === 2 || m === 3) hit++;
  void K;
  return Math.max(1, total - hit);
}

// Parity search: a ship of length m always covers a cell of the lattice (x + y) mod m = r, so searching that lattice
// finds every ship of length >= m with 1/m of the shots. r varies with seat/target so different bots probe different
// lattices. Span (bounding box side) generalises "length" to polyominoes conservatively.
function parityOf(view, target, seat) {
  const rs = view.rs;
  const b = view.boards[target];
  const sunkTypes = (b.sunk || []).map((s) => s.t);
  let m = Infinity;
  const left = rs.ships.slice();
  for (const t of sunkTypes) { const i = left.indexOf(t); if (i >= 0) left.splice(i, 1); }
  // the lattice of the smallest ship of two cells or more still afloat (boats are found on the way or at the end)
  for (const t of left) {
    const sh = rs.types[t].shape;
    const xs = sh.cells.map((c) => c[0]), ys = sh.cells.map((c) => c[1]);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + 1;
    if (span >= 2) m = Math.min(m, span);
  }
  if (!Number.isFinite(m)) m = 1;
  return { m, r: m > 1 ? (seat * 7 + target * 3) % m : 0 };
}

// Only in hunt mode (no open hits): a prior on distance from the edge, reflecting the human habit of hiding ships
// along the coast (bias > 0.5) or away from it (bias < 0.5).
function edgePrior(G, c, bias, hunting) {
  if (!hunting || Math.abs(bias - 0.5) < 0.01) return 1;
  const x = c % G.W, y = (c / G.W) | 0;
  const d = Math.min(x, y, G.W - 1 - x, G.H - 1 - y);
  const k = (bias - 0.5) * 2; // -1 … 1
  return d === 0 ? 1 + 0.6 * k : d === 1 ? 1 + 0.2 * k : 1 - 0.15 * k;
}

// --- weapons ---------------------------------------------------------------------------------------------------------

// Expected hits of a weapon from cell c (air strike / cluster) or the entropy of a radar count, from the evaluation.
// Air strike / cluster: expected hits = sum of hit probabilities of free cells covered (linearity of expectation).
// Radar without kept samples: Gaussian entropy approximation of the count (sum of independent Bernoullis).
// Note: with 1..19 kept configurations this returns 0 for radar (the caller uses radarInfo only from 20), so radar
// is then never chosen; harmless, as such tiny posteriors are better resolved by shots.
function weaponValue(view, ev, kind, c, dir) {
  const rs = view.rs;
  const b = view.boards[ev.target];
  const cells = weaponCells(rs, kind, c, dir);
  if (kind === 'radar') {
    if (!ev.st || !ev.st.configs || !ev.st.configs.length) {
      // without samples: the variance of a sum of independent cells as a stand-in for its information
      let v = 0;
      for (const x of cells) if (b.marks[x] === 0) v += ev.p[x] * (1 - ev.p[x]);
      return v > 0 ? 0.5 * Math.log2(2 * Math.PI * Math.E * v) : 0;
    }
    return 0;
  }
  let e = 0;
  for (const x of cells) if (b.marks[x] === 0 && !geometry(rs).obstacle[x]) e += Math.min(1, ev.p[x]);
  return e;
}

// Radar information from kept configurations: entropy of the ship-cell count in each candidate square.
// Exact entropy of the radar answer under the kept configurations: the count distribution per square, then
// H = -sum q log2 q. This is the expected information of the scan, directly comparable to a shot's expectedInfo.
function radarInfo(view, ev, centers) {
  const st = ev.st, K = ev.K, G = K.G;
  const configs = st.configs;
  const occ = new Int8Array(G.N);
  const counts = centers.map(() => new Map());
  const areas = centers.map((c) => weaponCells(view.rs, 'radar', c));
  for (const pos of configs) {
    occ.fill(0);
    for (let i = 0; i < pos.length; i++) { const Tt = G.types[K.ships[i].t]; for (let k = 0; k < Tt.size; k++) occ[Tt.cells[pos[i] * Tt.size + k]] = 1; }
    areas.forEach((a, j) => { let n = 0; for (const x of a) n += occ[x]; counts[j].set(n, (counts[j].get(n) || 0) + 1); });
  }
  return counts.map((m) => { let h = 0; for (const v of m.values()) { const q = v / configs.length; h -= q * Math.log2(q); } return h; });
}

// Weapons are fired when their expected value beats a plain shot by a margin that shrinks with the trigger trait;
// near the end any gain suffices (unused charges are worth nothing after the game).
// Radar centres exclude the edge row/column: a clipped square carries less information per charge.
function chooseWeapon(view, seat, ev, rng, P) {
  const ch = view.charges[seat];
  if (!ch) return null;
  const rs = view.rs, G = geometry(rs);
  const tr = P.traits;
  const b = view.boards[ev.target];
  const left = b.left != null ? b.left : rs.ships.length;
  const endgameNear = left <= 2;
  let bestShot = 0;
  for (const c of ev.free) bestShot = Math.max(bestShot, Math.min(1, ev.p[c]));
  const opts = [];
  for (const kind of ['airstrike', 'cluster']) {
    if (!(ch[kind] > 0)) continue;
    let best = null;
    for (let c = 0; c < G.N; c++) {
      for (const dir of kind === 'airstrike' ? ['h', 'v'] : ['h']) {
        const v = weaponValue(view, ev, kind, c, dir);
        if (!best || v > best.v) best = { kind, c, dir, v };
      }
    }
    if (!best || best.v <= 0) continue;
    // fire when the expected hits clearly beat one shot, sooner for trigger-happy bots, always near the end
    const need = 1.1 + 1.6 * (1 - tr.trigger);
    if (best.v >= Math.max(need, bestShot * 1.5) || (endgameNear && best.v > bestShot) || (tr.trigger >= 0.95 && rng.next() < 0.7)) opts.push({ ...best, gain: best.v - bestShot });
  }
  if (ch.radar > 0 && !openHits(view, ev.target).length) {
    const centers = [];
    for (let c = 0; c < G.N; c++) { const x = c % G.W, y = (c / G.W) | 0; if (x > 0 && y > 0 && x < G.W - 1 && y < G.H - 1) centers.push(c); }
    let infos;
    if (ev.st && ev.st.configs && ev.st.configs.length >= 20) infos = radarInfo(view, ev, centers);
    else infos = centers.map((c) => weaponValue(view, ev, 'radar', c));
    let bi = -1;
    infos.forEach((v, j) => { if (bi < 0 || v > infos[bi]) bi = j; });
    let shotInfo = 0;
    if (ev.info) for (const c of ev.free) shotInfo = Math.max(shotInfo, ev.info[c]);
    else shotInfo = 1;
    const want = (0.6 + 1.6 * (1 - tr.trigger)) * Math.max(0.5, shotInfo) * (1 - 0.5 * tr.curiosity);
    if (bi >= 0 && (infos[bi] > want || (tr.trigger >= 0.95 && rng.next() < 0.6))) opts.push({ kind: 'radar', c: centers[bi], dir: 'h', gain: infos[bi] * 0.3 });
  }
  if (!opts.length) return null;
  opts.sort((a, b2) => b2.gain - a.gain);
  const o = opts[0];
  return o.kind === 'airstrike' ? { type: 'airstrike', target: ev.target, cell: o.c, dir: o.dir } : { type: o.kind, target: ev.target, cell: o.c };
}

// --- the decision ------------------------------------------------------------------------------------------------------

function opponentsOf(view, seat) {
  const out = [];
  for (let i = 0; i < view.n; i++) if (i !== seat && view.boards[i].alive && teamOf(view.rs, i) !== teamOf(view.rs, seat)) out.push(i);
  return out;
}

function lastShooterAt(view, seat) {
  for (let i = view.log.length - 1; i >= 0; i--) { const e = view.log[i]; if (e[0] === 'S' && e[2] === seat) return e[1]; }
  return -1;
}

// Salvo shots are the top-k cells by single-shot score, not a jointly optimised set: correlated cells (two ends of
// the same probable ship) can both be picked. A joint choice would need conditional resampling per pick.
export function decide(view, seat, rng, P) {
  const rs = view.rs;
  const tg = opponentsOf(view, seat);
  if (!tg.length) return null;
  const G = geometry(rs);
  // which board: evaluate the candidates the targeting rule allows
  let cands = tg;
  const afloatCells = (i) => { const b = view.boards[i]; let hit = 0; for (const m of b.marks) if (m === 2 || m === 3) hit++; return rs.cellCount - hit; };
  if (tg.length > 1) {
    if (P.targeting === 'weakest') { const m = Math.min(...tg.map(afloatCells)); cands = tg.filter((i) => afloatCells(i) === m); }
    else if (P.targeting === 'leader') { const m = Math.max(...tg.map(afloatCells)); cands = tg.filter((i) => afloatCells(i) === m); }
    else if (P.targeting === 'random') cands = [tg[rng.int(tg.length)]];
    else if (P.targeting === 'revenge') { const r = lastShooterAt(view, seat); if (tg.includes(r)) cands = [r]; }
  }
  const evals = cands.map((t) => evaluateBoard(view, t, rng, P, seat)).filter((e) => e.free.length);
  if (!evals.length) return null;
  // the board with the best single shot (the chance of a hit, then the method's score)
  let ev = evals[0];
  const top = (e) => { let m = -Infinity, pm = 0; for (const c of e.free) { if (e.score[c] > m) { m = e.score[c]; pm = e.p[c]; } } return pm + 1e-6 * m; };
  for (const e of evals) if (top(e) > top(ev)) ev = e;
  // weapons
  const w = chooseWeapon(view, seat, ev, rng, P);
  if (w) return w;
  // shots
  const due = Math.min(view.due || 1, ev.free.length);
  const ranked = ev.free.slice().sort((a, b) => ev.score[b] - ev.score[a] || a - b);
  const cells = [];
  for (let k = 0; k < due; k++) {
    const rest = ranked.filter((c) => !cells.includes(c));
    if (!rest.length) break;
    let c;
    if (rng.next() < P.blunder) c = rest[rng.int(rest.length)];
    else if (k === 0 && ev.best != null && rest.includes(ev.best)) c = ev.best;
    else {
      // ties: a random cell among the best
      const bestScore = ev.score[rest[0]];
      const ties = rest.filter((x) => ev.score[x] >= bestScore - 1e-12);
      c = ties[rng.int(ties.length)];
    }
    cells.push(c);
  }
  void G;
  return { type: 'fire', target: ev.target, cells };
}

export const BOT_KINDS = [...TEMPLATES.map((t) => ({ id: t.id, name: t.name, icon: t.icon, levels: LEVELS.map((l) => l.id) })), { id: 'custom', name: 'Custom', levels: LEVELS.map((l) => l.id) }];

export { occupancy };
