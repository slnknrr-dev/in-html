// battleship/solver.js - reasoning about a hidden fleet from what is known about a board: the knowledge model (cells
// known to be water, cells known to be hit, sunk ships with what their announcement revealed, radar counts), Monte-Carlo
// sampling of whole fleets consistent with everything known (a Gibbs sampler over ship placements with pair moves and
// restarts), exact enumeration for small positions, an estimate of the number of consistent fleets (sequential
// importance sampling, for the entropy in bits), the classic placement-density heuristic and an exact expectimax for
// small endgames. Pure functions on typed arrays: the same code serves bots, hints, replays and the analysis.
//
//   makeKnowledge(G, { water, hit, sunk, scans, mode }) -> K      sunk: [{ t, at, cells | null, hitsAt }]
//   emptyKnowledge(G) -> K                                        no information (placement generators)
//   new Chain(K, rng): init(budget) -> bool, sweep(), pos (placement per ship), occ (ship per cell)
//   sample(K, rng, { samples, burn, thin, chains, keep }) -> stats  { n, occ, sunk, sunkT, configs?, failed }
//   enumerate(K, { budget, keep }) -> stats & { complete, count }
//   estimateLog2(K, rng, samples) -> log2 of the number of consistent fleets (exact when enumerate() fits)
//   density(K, { hitBonus }) -> Float64Array        classic heuristic: placements of the remaining ships per cell
//   outcomeProbs(K, stats, c) -> { miss, hit, sunk, byType }      the answer to a shot at c
//   expectedInfo(K, stats, c) -> bits                             entropy of that answer
//   endgame(K, configs, { objective, budget }) -> { cell, value } | null    exact expectimax (minimal expected cost)
//
// A configuration places every ship of the fleet (sunk ones too) so that no two ships break the touching rule, no ship
// covers a cell known to be water, every known hit is covered, every radar count matches, a sunk ship lies where its
// announcement allows, and (when sinkings are announced) no ship that is still afloat is already fully hit.

//
// Why sampling instead of the density heuristic alone: placement density counts each ship independently, so it
// ignores that ships exclude each other and must jointly explain every hit. The posterior over whole fleets is what
// an optimal shooter needs; it is intractable to enumerate in general (billions of fleets on a 10x10 board), so it
// is sampled with MCMC, and enumerated exactly only when small. density() remains as a cheap baseline and as the
// weak bots' brain.
// Uniform prior: every consistent fleet is equally likely. Opponents with placement habits break this assumption,
// which is why bots.js can blend in style statistics.
const LN2 = Math.log(2);

// --- knowledge -------------------------------------------------------------------------------------------------------

// Precomputes for each ship its candidate placements (filtering known water, zones of fixed sunk ships, and for
// afloat ships "not already fully hit", since a fully hit ship would have been announced sunk). Everything later
// iterates candidates only, never the whole placement table.
// impossible: the evidence contradicts the ruleset (corrupt log, wrong announce mode); samplers then fail fast.
export function makeKnowledge(G, { water, hit, sunk = [], scans = [], mode = 'ship' } = {}) {
  const N = G.N, rs = G.rs;
  const W = new Uint8Array(N), Hh = new Uint8Array(N);
  for (let c = 0; c < N; c++) { W[c] = G.obstacle[c] || (water && water[c]) ? 1 : 0; Hh[c] = hit && hit[c] && !W[c] ? 1 : 0; }
  const ships = [];
  const fixedZone = new Uint8Array(N); // cells taken by the zones of ships that are fixed (shown sunk ships)
  let impossible = false;
  const sunkOfType = new Array(rs.types.length).fill(0);
  const announced = mode !== 'hit';
  if (announced) {
    for (const s of sunk) {
      const T = G.types[s.t];
      if (!T) { impossible = true; continue; }
      sunkOfType[s.t]++;
      let cand = [];
      // Shown sunk ship: exactly one placement matches its cell set (compare sorted cell lists).
      if (mode === 'ship' && s.cells) {
        const want = [...s.cells].sort((a, b) => a - b).join(',');
        for (const p of T.byCell[s.cells[0]] || []) {
          const cs = [...T.cells.subarray(p * T.size, (p + 1) * T.size)].sort((a, b) => a - b).join(',');
          if (cs === want) { cand.push(p); break; }
        }
      // Unshown sunk ship: any placement through the sinking cell made only of cells that were hits at that moment.
      } else {
        const at = s.at;
        const hs = s.hitsAt ? toMask(N, s.hitsAt) : Hh;
        for (const p of T.byCell[at] || []) {
          let ok = true;
          for (let k = 0; k < T.size; k++) { const c = T.cells[p * T.size + k]; if (!hs[c] || W[c]) { ok = false; break; } }
          if (ok) cand.push(p);
        }
      }
      if (!cand.length) impossible = true;
      const fixed = cand.length === 1 && mode === 'ship';
      if (fixed) for (const c of T.zone[cand[0]]) fixedZone[c] = 1;
      ships.push({ t: s.t, cand: Int32Array.from(cand), fixed, sunk: true, group: -1 });
    }
  }
  const order = rs.types.map((tp) => tp.index).sort((a, b) => rs.types[b].size - rs.types[a].size || a - b);
  for (const t of order) {
    const T = G.types[t];
    const free = rs.types[t].count - sunkOfType[t];
    if (free < 0) { impossible = true; continue; }
    if (!free) continue;
    const cand = [];
    for (let p = 0; p < T.P; p++) {
      let ok = true, allHit = true;
      for (let k = 0; k < T.size; k++) {
        const c = T.cells[p * T.size + k];
        if (W[c] || fixedZone[c]) { ok = false; break; }
        if (!Hh[c]) allHit = false;
      }
      if (ok && announced && allHit) ok = false;
      if (ok) cand.push(p);
    }
    if (!cand.length) impossible = true;
    const arr = Int32Array.from(cand);
    for (let k = 0; k < free; k++) ships.push({ t, cand: arr, fixed: false, sunk: false, group: -2 - t });
  }
  // Ships of the same type with the same candidates are interchangeable: enumeration places them in increasing
  // placement order and the init/cover step tries one representative per group. Without this, k identical ships
  // would make every configuration appear k! times (wrong counts, wasted search).
  // groups: interchangeable ships (same type, same candidates) share a group id; others get their own
  let g = 0;
  const groupOf = new Map();
  for (const s of ships) {
    if (s.group <= -2) { if (!groupOf.has(s.group)) groupOf.set(s.group, g++); s.group = groupOf.get(s.group); } else s.group = g++;
    const T = G.types[s.t];
    s.ok = new Uint8Array(T.P);
    for (const p of s.cand) s.ok[p] = 1;
  }
  const hitList = [];
  for (let c = 0; c < N; c++) if (Hh[c]) hitList.push(c);
  const sc = scans.map((x) => {
    const inArea = new Uint8Array(N);
    for (const c of x.cells) inArea[c] = 1;
    return { cells: Int16Array.from(x.cells), inArea, count: x.count | 0 };
  });
  let capacity = 0;
  for (const s of ships) capacity += G.types[s.t].size;
  if (hitList.length > capacity) impossible = true;
  return { G, N, mode, water: W, hit: Hh, hitList: Int16Array.from(hitList), ships, scans: sc, impossible, nTypes: rs.types.length };
}

const toMask = (N, list) => { if (list instanceof Uint8Array && list.length === N) return list; const m = new Uint8Array(N); for (const c of list) m[c] = 1; return m; };

export function emptyKnowledge(G) {
  return makeKnowledge(G, { water: null, hit: null, sunk: [], scans: [], mode: 'hit' });
}

// --- the chain: one consistent configuration and its moves ------------------------------------------------------------

// Incremental state of one configuration: pos (placement per ship), occ (ship per cell), zc (zone coverage
// counter per cell, so compatibility of a new placement is "all its cells have zc = 0"), scnt (ship cells per
// radar area). put/take update all of them in O(ship size + zone size), so a Gibbs step costs O(candidates).
export class Chain {
  constructor(K, rng) {
    this.K = K; this.G = K.G; this.rng = rng;
    const S = K.ships.length, N = K.N;
    this.S = S;
    this.pos = new Int32Array(S).fill(-1);
    this.occ = new Int16Array(N).fill(-1);
    this.zc = new Int16Array(N);
    this.scnt = new Int32Array(K.scans.length);
    this.buf = new Int32Array(4096);
    this.coverers = [];
  }

  cellsOf(i, p) { const T = this.G.types[this.K.ships[i].t]; return T.cells.subarray(p * T.size, (p + 1) * T.size); }

  put(i, p) {
    const T = this.G.types[this.K.ships[i].t];
    const o = p * T.size;
    for (let k = 0; k < T.size; k++) this.occ[T.cells[o + k]] = i;
    const z = T.zone[p];
    for (let k = 0; k < z.length; k++) this.zc[z[k]]++;
    const sc = this.K.scans;
    for (let s = 0; s < sc.length; s++) { const a = sc[s].inArea; for (let k = 0; k < T.size; k++) if (a[T.cells[o + k]]) this.scnt[s]++; }
    this.pos[i] = p;
  }

  take(i) {
    const p = this.pos[i];
    if (p < 0) return;
    const T = this.G.types[this.K.ships[i].t];
    const o = p * T.size;
    for (let k = 0; k < T.size; k++) this.occ[T.cells[o + k]] = -1;
    const z = T.zone[p];
    for (let k = 0; k < z.length; k++) this.zc[z[k]]--;
    const sc = this.K.scans;
    for (let s = 0; s < sc.length; s++) { const a = sc[s].inArea; for (let k = 0; k < T.size; k++) if (a[T.cells[o + k]]) this.scnt[s]--; }
    this.pos[i] = -1;
  }

  // Does placement p of ship i fit next to the placed ships (zones), cover every cell of `need`, and add exactly
  // `want[s]` cells to every radar area (want null: only stay within the counts)?
  fits(i, p, need, want) {
    const T = this.G.types[this.K.ships[i].t];
    const o = p * T.size;
    for (let k = 0; k < T.size; k++) if (this.zc[T.cells[o + k]]) return false;
    if (need) {
      for (let n = 0; n < need.length; n++) {
        let has = false;
        for (let k = 0; k < T.size; k++) if (T.cells[o + k] === need[n]) { has = true; break; }
        if (!has) return false;
      }
    }
    const sc = this.K.scans;
    for (let s = 0; s < sc.length; s++) {
      const a = sc[s].inArea;
      let add = 0;
      for (let k = 0; k < T.size; k++) if (a[T.cells[o + k]]) add++;
      if (want ? add !== want[s] : this.scnt[s] + add > sc[s].count) return false;
    }
    return true;
  }

  clear() { for (let i = 0; i < this.S; i++) this.take(i); }

  // A first consistent configuration by randomized backtracking: uncovered hits first (any ship that can cover the
  // hit), then the other ships at random. Returns false when the budget runs out (callers restart).
  // Randomised so independent chains start from different configurations (better coverage of multimodal posteriors).
  // Hits are covered first because they are the hardest constraints; capOk prunes when the remaining ships cannot
  // cover the remaining hits. coprimeStep gives a random permutation-like walk through candidates without allocating
  // a shuffled copy (a stride coprime with n visits every index once).
  init(budget = 4000) {
    this.clear();
    const K = this.K, rng = this.rng, G = this.G;
    if (K.impossible) return false;
    let nodes = 0;
    const unplaced = () => { const u = []; for (let i = 0; i < this.S; i++) if (this.pos[i] < 0) u.push(i); return u; };
    const capOk = () => {
      let uncovered = 0;
      for (let k = 0; k < K.hitList.length; k++) if (this.occ[K.hitList[k]] < 0) uncovered++;
      if (!uncovered) return true;
      let cap = 0;
      for (let i = 0; i < this.S; i++) if (this.pos[i] < 0) cap += G.types[K.ships[i].t].size;
      return uncovered <= cap;
    };
    const scansDone = () => { for (let s = 0; s < K.scans.length; s++) if (this.scnt[s] !== K.scans[s].count) return false; return true; };
    const go = () => {
      if (++nodes > budget) return false;
      let h = -1;
      for (let k = 0; k < K.hitList.length; k++) if (this.occ[K.hitList[k]] < 0) { h = K.hitList[k]; break; }
      const un = unplaced();
      if (h >= 0) {
        const opts = [];
        const seen = new Set();
        for (const i of un) {
          const sh = K.ships[i];
          if (seen.has(sh.group)) continue;
          seen.add(sh.group);
          const by = G.types[sh.t].byCell[h];
          for (let k = 0; k < by.length; k++) { const p = by[k]; if (sh.ok[p] && this.fits(i, p, null, null)) opts.push(i, p); }
        }
        const m = opts.length >> 1;
        const order = shuffled(m, rng);
        for (let k = 0; k < m; k++) {
          const i = opts[order[k] * 2], p = opts[order[k] * 2 + 1];
          this.put(i, p);
          if (capOk() && go()) return true;
          this.take(i);
          if (nodes > budget) return false;
        }
        return false;
      }
      if (!un.length) return scansDone();
      // the most constrained ship first: sunk ships, then the largest
      const i = un[0];
      const sh = K.ships[i];
      const n = sh.cand.length;
      const start = rng.int(Math.max(1, n));
      const tries = Math.min(n, 60);
      // a random stride through the candidates (cheap shuffle)
      const stride = n > 1 ? coprimeStep(n, rng) : 1;
      for (let k = 0; k < tries; k++) {
        const p = sh.cand[(start + k * stride) % n];
        if (!this.fits(i, p, null, null)) continue;
        this.put(i, p);
        if (go()) return true;
        this.take(i);
        if (nodes > budget) return false;
      }
      return false;
    };
    return go();
  }

  // Gibbs move of ship i: remove it and put it back uniformly among the placements consistent with the others.
  // Gibbs update: ship i is resampled from its exact conditional given all other ships. If i covered hits, its new
  // place must cover them too (need), unless another ship covers them, which single moves cannot arrange; pair()
  // handles that. The current placement is always in the candidate set, so n > 0 except on numerical surprises.
  step(i) {
    const K = this.K, G = this.G;
    const sh = K.ships[i];
    if (sh.cand.length <= 1) return;
    const T = G.types[sh.t];
    const old = this.pos[i];
    const oc = this.cellsOf(i, old);
    this.take(i);
    let need = null;
    for (let k = 0; k < oc.length; k++) if (K.hit[oc[k]]) (need || (need = [])).push(oc[k]);
    const want = K.scans.length ? this.wantAfterRemoval() : null;
    let n = 0;
    const buf = this.buf.length >= sh.cand.length ? this.buf : (this.buf = new Int32Array(sh.cand.length * 2));
    if (need) {
      const by = T.byCell[need[0]];
      for (let k = 0; k < by.length; k++) { const p = by[k]; if (sh.ok[p] && this.fits(i, p, need, want)) buf[n++] = p; }
    } else {
      for (let k = 0; k < sh.cand.length; k++) { const p = sh.cand[k]; if (this.fits(i, p, null, want)) buf[n++] = p; }
    }
    this.put(i, n ? buf[this.rng.int(n)] : old);
  }

  wantAfterRemoval() {
    const sc = this.K.scans;
    const w = new Int32Array(sc.length);
    for (let s = 0; s < sc.length; s++) w[s] = sc[s].count - this.scnt[s];
    return w;
  }

  // Joint move of two ships (exact conditional over both): lets hits change hands between ships (one long ship ↔ two
  // short ones), which single moves cannot do.
  // Block Gibbs on two ships: enumerates all joint placements covering the hits left uncovered after removing both.
  // KNOWN DEFECT: the pair list is truncated at 20000 / 40000 entries, so in very open positions the move samples from
  // a prefix of the joint space (biased toward early placements), not the exact conditional. Fix: reservoir-sample
  // one pair while enumerating instead of storing and truncating.
  // Note: `want ? null : null` in the first loop is dead code (always null); the radar check happens in tryPair.
  pair(i, j) {
    const K = this.K, G = this.G;
    const si = K.ships[i], sj = K.ships[j];
    const Ti = G.types[si.t], Tj = G.types[sj.t];
    const oi = this.pos[i], oj = this.pos[j];
    this.take(i); this.take(j);
    const need = [];
    for (let k = 0; k < K.hitList.length; k++) if (this.occ[K.hitList[k]] < 0) need.push(K.hitList[k]);
    if (!need.length) { this.put(i, oi); this.put(j, oj); return; }
    const want = K.scans.length ? this.wantAfterRemoval() : null;
    const pairs = [];
    const h = need[0];
    const tryPair = (a, pa, b, Tb, sb, swap) => {
      // a placed with pa (covers h); b over its candidates
      this.put(a, pa);
      const rest = need.filter((c) => this.occ[c] < 0);
      const wantB = want ? this.wantAfterRemoval() : null;
      const list = rest.length ? Tb.byCell[rest[0]] : sb.cand;
      for (let k = 0; k < list.length; k++) {
        const pb = list[k];
        if (!sb.ok[pb]) continue;
        if (this.fits(b, pb, rest.length ? rest : null, wantB)) { if (swap) pairs.push(pb, pa); else pairs.push(pa, pb); }
        if (pairs.length > 20000) break;
      }
      this.take(a);
    };
    // pairs where i covers h, then pairs where j covers h (and i does not: no double counting)
    const byI = Ti.byCell[h];
    for (let k = 0; k < byI.length; k++) { const p = byI[k]; if (si.ok[p] && this.fits(i, p, null, want ? null : null)) tryPair(i, p, j, Tj, sj, false); }
    const byJ = Tj.byCell[h];
    for (let k = 0; k < byJ.length; k++) {
      const p = byJ[k];
      if (!sj.ok[p] || !this.fits(j, p, null, null)) continue;
      // j covers h: i must not cover h (those pairs were counted above)
      this.put(j, p);
      const rest = need.filter((c) => this.occ[c] < 0);
      const wantI = want ? this.wantAfterRemoval() : null;
      const list = rest.length ? Ti.byCell[rest[0]] : si.cand;
      for (let m = 0; m < list.length; m++) {
        const pi = list[m];
        if (!si.ok[pi]) continue;
        if (this.fits(i, pi, rest.length ? rest : null, wantI)) pairs.push(pi, p);
        if (pairs.length > 40000) break;
      }
      this.take(j);
    }
    // keep only pairs that satisfy the radar counts exactly (fits() checked them one ship at a time)
    const m = pairs.length >> 1;
    if (!m) { this.put(i, oi); this.put(j, oj); return; }
    const k = this.rng.int(m);
    this.put(i, pairs[2 * k]);
    this.put(j, pairs[2 * k + 1]);
    if (want && !this.scansExact()) { this.take(i); this.take(j); this.put(i, oi); this.put(j, oj); }
  }

  scansExact() { const sc = this.K.scans; for (let s = 0; s < sc.length; s++) if (this.scnt[s] !== sc[s].count) return false; return true; }

  // Joint move of two ships that cover no hits (ships jammed in a tight space can only move together). Skipped when
  // the pair space is large: single moves mix well there.
  // Ships boxed in together (e.g. two ships in a 2-wide corridor) cannot move one at a time because every single
  // move collides; a joint move unlocks them. The limit keeps the quadratic enumeration cheap.
  pairFree(i, j, limit = 5000) {
    const K = this.K;
    const si = K.ships[i], sj = K.ships[j];
    const oi = this.pos[i], oj = this.pos[j];
    this.take(i); this.take(j);
    const Fi = [], Fj = [];
    for (let k = 0; k < si.cand.length; k++) if (this.fits(i, si.cand[k], null, null)) Fi.push(si.cand[k]);
    for (let k = 0; k < sj.cand.length; k++) if (this.fits(j, sj.cand[k], null, null)) Fj.push(sj.cand[k]);
    if (Fi.length * Fj.length > limit || Fi.length < 1 || Fj.length < 1) { this.put(i, oi); this.put(j, oj); return; }
    const exact = K.scans.length > 0;
    const pairs = [];
    for (const a of Fi) {
      this.put(i, a);
      const want = exact ? this.wantAfterRemoval() : null;
      for (const b of Fj) if (this.fits(j, b, null, want)) pairs.push(a, b);
      this.take(i);
    }
    const m = pairs.length >> 1;
    if (!m) { this.put(i, oi); this.put(j, oj); return; }
    const k = this.rng.int(m);
    this.put(i, pairs[2 * k]);
    this.put(j, pairs[2 * k + 1]);
  }

  // One sweep = S single-ship updates at random indices plus a few pair moves. Random scan Gibbs keeps detailed
  // balance; the pair moves address the two known mixing traps (hits changing hands, jammed ships).
  sweep() {
    const K = this.K, S = this.S, rng = this.rng;
    for (let k = 0; k < S; k++) this.step(rng.int(S));
    if (S < 2) return;
    if (K.hitList.length) {
      // pair moves for ships that cover hits
      const tries = Math.min(3, S);
      for (let k = 0; k < tries; k++) {
        const h = K.hitList[rng.int(K.hitList.length)];
        const i = this.occ[h];
        if (i < 0 || K.ships[i].cand.length <= 1) continue;
        let j = rng.int(S - 1);
        if (j >= i) j++;
        if (K.ships[j].cand.length <= 1) continue;
        this.pair(i, j);
      }
    }
    // one joint move of two ships that cover no hits
    const i = rng.int(S);
    let j = rng.int(S - 1);
    if (j >= i) j++;
    if (K.ships[i].cand.length > 1 && K.ships[j].cand.length > 1 && !this.coversHit(i) && !this.coversHit(j)) this.pairFree(i, j);
  }

  coversHit(i) {
    const p = this.pos[i];
    if (p < 0) return false;
    const T = this.G.types[this.K.ships[i].t];
    for (let k = 0; k < T.size; k++) if (this.K.hit[T.cells[p * T.size + k]]) return true;
    return false;
  }
}

// Up to 8 random tries for a stride coprime with n; falls back to 1 (sequential), still a valid full cycle.
function coprimeStep(n, rng) {
  for (let k = 0; k < 8; k++) { const s = 1 + rng.int(n - 1); if (gcd(s, n) === 1) return s; }
  return 1;
}
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

function shuffled(n, rng) {
  const a = new Int32Array(n);
  for (let i = 0; i < n; i++) a[i] = i;
  for (let i = n - 1; i > 0; i--) { const j = rng.int(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

// --- statistics of configurations ------------------------------------------------------------------------------------

function newStats(K) {
  return { n: 0, occ: new Float64Array(K.N), sunk: new Float64Array(K.N), sunkT: new Float64Array(K.N * K.nTypes), configs: null, failed: false };
}

// Adds one configuration (pos per ship) to the statistics; kept configurations are a uniform subset (reservoir
// sampling when an rng is given, otherwise the first ones).
// occ[c] counts configurations with a ship on c; sunk[c] counts those where c is the last unhit cell of its ship
// (a shot there would sink it), split by type in sunkT. These are sufficient statistics for outcomeProbs.
function record(K, st, pos, keep, rng = null) {
  const G = K.G;
  st.n++;
  if (keep && st.configs && st.configs.length >= keep && rng) {
    const j = rng.int(st.n);
    if (j < keep) st.configs[j] = Int32Array.from(pos);
    keep = 0;
  }
  for (let i = 0; i < pos.length; i++) {
    const t = K.ships[i].t, T = G.types[t];
    const o = pos[i] * T.size;
    let unknown = 0, last = -1;
    for (let k = 0; k < T.size; k++) { const c = T.cells[o + k]; st.occ[c]++; if (!K.hit[c]) { unknown++; last = c; } }
    if (unknown === 1) { st.sunk[last]++; st.sunkT[last * K.nTypes + t]++; }
  }
  if (keep && st.configs && st.configs.length < keep) st.configs.push(Int32Array.from(pos));
}

/**
 * Monte-Carlo sample of consistent fleets. opts: { samples (300), burn (sweeps before the first sample, 8), thin
 * (sweeps between samples, 1), chains (independent restarts, 4), keep (how many configurations to keep, 0) }.
 */
// Exact enumeration is tried first under a small budget: when the posterior is small it is computed exactly (no
// sampling noise, and MCMC mixes worst exactly in these tight endgames). Otherwise several independent chains.
// Kept configurations from chains are the first `keep` samples (record without rng), not a reservoir: adequate for
// endgame() which is only invoked when enumeration succeeded.
export function sample(K, rng, { samples = 300, burn = 8, thin = 1, chains = 4, keep = 0, budget = 4000, exact = 2500 } = {}) {
  // small positions: every configuration, exactly (also where a chain would mix slowly)
  if (exact > 0 && !K.impossible) {
    const ex = enumerate(K, { budget: exact, keep, rng });
    if (ex.complete && ex.count > 0) { ex.exact = true; return ex; }
  }
  const st = newStats(K);
  if (keep) st.configs = [];
  if (K.impossible) { st.failed = true; return st; }
  const per = Math.ceil(samples / chains);
  let fails = 0;
  for (let ch = 0; ch < chains && st.n < samples; ch++) {
    const chain = new Chain(K, rng);
    let ok = chain.init(budget);
    for (let r = 0; !ok && r < 6; r++) ok = chain.init(budget * 2);
    if (!ok) { fails++; continue; }
    for (let b = 0; b < burn; b++) chain.sweep();
    for (let k = 0; k < per && st.n < samples; k++) {
      for (let s = 0; s < thin; s++) chain.sweep();
      record(K, st, chain.pos, keep);
    }
  }
  if (!st.n) st.failed = fails > 0;
  return st;
}

/**
 * Exact enumeration of every consistent configuration (uniform weights), within a node budget. Returns the statistics
 * with { complete, count }; incomplete results are not usable as probabilities.
 */
// The search tree of consistent configurations, shared by the exact enumeration and the estimate of its size: at a node,
// an uncovered hit is covered first (by any ship that can: one representative of each group of interchangeable
// ships), then the remaining ships are placed in order, interchangeable ships in increasing placement order, so that
// every configuration is exactly one leaf. children() lists the moves of the node: [ship, placement, ...]; 'leaf'
// when every ship lies and the radar counts match, 'dead' otherwise.
// Canonical search tree: one leaf per configuration. Hit-cover moves come first (any group may cover the first
// uncovered hit); then remaining ships in index order, and an interchangeable ship placed freely must use a larger
// placement index than its already-free-placed twins (minP), which removes permutation duplicates.
function children(K, chain, freePhase, out) {
  const G = K.G, S = K.ships.length;
  let h = -1, unc = 0;
  for (let k = 0; k < K.hitList.length; k++) if (chain.occ[K.hitList[k]] < 0) { if (h < 0) h = K.hitList[k]; unc++; }
  out.length = 0;
  if (h >= 0) {
    let cap = 0;
    for (let i = 0; i < S; i++) if (chain.pos[i] < 0) cap += G.types[K.ships[i].t].size;
    if (unc > cap) return 'dead';
    const seen = new Set();
    for (let i = 0; i < S; i++) {
      if (chain.pos[i] >= 0) continue;
      const sh = K.ships[i];
      if (seen.has(sh.group)) continue;
      seen.add(sh.group);
      const by = G.types[sh.t].byCell[h];
      for (let k = 0; k < by.length; k++) { const p = by[k]; if (sh.ok[p] && chain.fits(i, p, null, null)) out.push(i, p); }
    }
    return out.length ? 'nodes' : 'dead';
  }
  let i = -1;
  for (let k = 0; k < S; k++) if (chain.pos[k] < 0) { i = k; break; }
  if (i < 0) return chain.scansExact() ? 'leaf' : 'dead';
  const sh = K.ships[i];
  let minP = -1;
  for (let k = i - 1; k >= 0; k--) if (K.ships[k].group === sh.group && freePhase[k] && chain.pos[k] >= 0) minP = Math.max(minP, chain.pos[k]);
  for (let k = 0; k < sh.cand.length; k++) { const p = sh.cand[k]; if (p > minP && chain.fits(i, p, null, null)) out.push(i, p); }
  return out.length ? 'nodes' : 'dead';
}

// Is a move of the free phase (no uncovered hit when it was chosen)?
const hitsCovered = (K, chain) => { for (let k = 0; k < K.hitList.length; k++) if (chain.occ[K.hitList[k]] < 0) return false; return true; };

// Depth-first over children(); budget counts nodes, and an aborted enumeration is flagged incomplete because a
// partial count is not a probability distribution.
export function enumerate(K, { budget = 200000, keep = 0, rng = null } = {}) {
  const st = newStats(K);
  st.complete = false; st.count = 0;
  if (keep) st.configs = [];
  if (K.impossible) { st.complete = true; return st; }
  const S = K.ships.length;
  const chain = new Chain(K, null);
  const freePhase = new Uint8Array(S);
  let nodes = 0, aborted = false;
  const go = () => {
    if (++nodes > budget) { aborted = true; return; }
    const list = [];
    const kind = children(K, chain, freePhase, list);
    if (kind === 'leaf') { st.count++; record(K, st, chain.pos, keep, rng); return; }
    if (kind === 'dead') return;
    const free = hitsCovered(K, chain) ? 1 : 0;
    for (let k = 0; k < list.length && !aborted; k += 2) {
      const i = list[k], p = list[k + 1];
      chain.put(i, p); freePhase[i] = free;
      go();
      chain.take(i); freePhase[i] = 0;
    }
  };
  go();
  st.complete = !aborted;
  return st;
}

/**
 * log2 of the number of consistent fleets: exact by enumeration when it fits the budget, otherwise Knuth's estimate of
 * the number of leaves of the search tree (random descents; each leaf is one configuration, the estimate is the mean of
 * the products of the branching factors along the descents — unbiased, and hits are covered by construction).
 */
// Knuth's estimator: along a random root-to-leaf path the product of branching factors is an unbiased estimate of
// the leaf count. Computed in log space (lw) and averaged with log-sum-exp to avoid overflow; dead ends contribute
// 0. Unbiased in N but high-variance; the log2 is used for display (bits of uncertainty), where that is acceptable.
export function estimateLog2(K, rng, samples = 600, budget = 60000) {
  if (K.impossible) return { log2: 0, exact: true, count: 0 };
  const ex = enumerate(K, { budget });
  if (ex.complete) return { log2: ex.count > 0 ? Math.log2(ex.count) : 0, exact: true, count: ex.count };
  const S = K.ships.length;
  const chain = new Chain(K, rng);
  const freePhase = new Uint8Array(S);
  const logs = [];
  const list = [];
  for (let k = 0; k < samples; k++) {
    chain.clear();
    freePhase.fill(0);
    let lw = 0;
    for (;;) {
      const kind = children(K, chain, freePhase, list);
      if (kind === 'leaf') { logs.push(lw); break; }
      if (kind === 'dead') { logs.push(-Infinity); break; }
      const m = list.length >> 1;
      lw += Math.log(m);
      const j = rng.int(m);
      const free = hitsCovered(K, chain) ? 1 : 0;
      chain.put(list[2 * j], list[2 * j + 1]);
      freePhase[list[2 * j]] = free;
    }
  }
  const finite = logs.filter((l) => l > -Infinity);
  if (!finite.length) return { log2: NaN, exact: false, count: null };
  const mx = Math.max(...finite);
  let sum = 0;
  for (const l of finite) sum += Math.exp(l - mx);
  const lnN = mx + Math.log(sum / samples);
  return { log2: lnN / LN2, exact: false, count: null };
}

// --- heuristics and outcome probabilities ----------------------------------------------------------------------------

/**
 * The classic density heuristic: for every ship still afloat, every placement that avoids known water and the zones of
 * shown sunk ships adds its weight to its cells; placements through known hits weigh (1 + hitBonus × hits) times more.
 * Known cells score 0.
 */
// hitBonus * hits^2: placements through several hits weigh much more, approximating "this ship probably continues
// the hit line"; the square favours lines over scattered single hits. Each type is processed once and weighted by
// its count of afloat ships (mult).
export function density(K, { hitBonus = 30 } = {}) {
  const G = K.G, N = K.N;
  const out = new Float64Array(N);
  const fixed = new Uint8Array(N);
  for (const sh of K.ships) if (sh.fixed) for (const c of G.types[sh.t].zone[sh.cand[0]]) fixed[c] = 1;
  const done = new Set();
  for (const sh of K.ships) {
    if (sh.fixed || sh.sunk) continue;
    const key = sh.t;
    const mult = K.ships.filter((x) => x.t === sh.t && !x.sunk && !x.fixed).length;
    if (done.has(key)) continue;
    done.add(key);
    const T = G.types[sh.t];
    for (let m = 0; m < sh.cand.length; m++) {
      const p = sh.cand[m];
      let hits = 0, bad = false;
      for (let k = 0; k < T.size; k++) { const c = T.cells[p * T.size + k]; if (fixed[c]) { bad = true; break; } if (K.hit[c]) hits++; }
      if (bad) continue;
      const w = mult * (1 + hitBonus * hits * hits);
      for (let k = 0; k < T.size; k++) out[T.cells[p * T.size + k]] += w;
    }
  }
  for (let c = 0; c < N; c++) if (K.hit[c] || K.water[c]) out[c] = 0;
  return out;
}

// The answer to a shot at c under the sampled (or enumerated) configurations.
// Math.max(0, ...) absorbs floating rounding (hit - sunk may be -1e-17).
export function outcomeProbs(K, st, c) {
  const n = st.n || 1;
  const hit = st.occ[c] / n, sunk = st.sunk[c] / n;
  const byType = [];
  for (let t = 0; t < K.nTypes; t++) byType.push(st.sunkT[c * K.nTypes + t] / n);
  return { miss: Math.max(0, 1 - hit), hit: Math.max(0, hit - sunk), sunk, byType };
}

// Entropy (bits) of the answer to a shot at c: miss / hit / sunk by type (only miss / hit when sinkings are secret).
// Entropy of the answer distribution = expected information gain of the shot (the answer is a deterministic
// function of the configuration, so information gain equals answer entropy). Under 'hit' announcements sunk
// is not distinguishable from hit, so those outcomes merge.
export function expectedInfo(K, st, c) {
  const o = outcomeProbs(K, st, c);
  const ps = K.mode === 'hit' ? [o.miss, o.hit + o.sunk] : [o.miss, o.hit, ...o.byType];
  let h = 0;
  for (const p of ps) if (p > 1e-12) h -= p * Math.log2(p);
  return h;
}

// Probability of an observed answer (for the bits of a shot): ans 0 miss, 1 hit, 2 sunk (type t).
export function answerProb(K, st, c, ans, t = -1) {
  const o = outcomeProbs(K, st, c);
  if (K.mode === 'hit') return ans === 0 ? o.miss : o.hit + o.sunk;
  if (ans === 0) return o.miss;
  if (ans === 1) return o.hit;
  return t >= 0 && o.byType[t] != null ? o.byType[t] : o.sunk;
}

// --- exact endgame ---------------------------------------------------------------------------------------------------

/**
 * Minimal expected cost to sink every ship of a board, over a small list of configurations (all consistent ones):
 * objective 'shots' (every shot costs one) or 'misses' (a hit earns another shot, so only misses cost). Returns the
 * best cell and its expected cost, or null when the search does not fit the budget.
 */
// Exact expectimax over the remaining configurations (<= 96): a shot partitions configurations by answer, the value
// is the probability-weighted cost of the best continuation. Memoised on (config set, shots); branch-and-bound stops
// evaluating a cell once its partial expectation exceeds the best so far (all terms are non-negative).
// With objective 'misses' a cell that is a hit in every configuration is free and is taken immediately.
// Int8Array occupancy limits ship indices to 127, ample for the 40-ship cap of rulesets.
export function endgame(K, configs, { objective = 'shots', budget = 20000 } = {}) {
  const G = K.G, N = K.N;
  if (!configs || !configs.length || configs.length > 96) return null;
  const S = K.ships.length;
  // per configuration: ship per cell and the cells of each ship
  const occOf = configs.map((pos) => {
    const o = new Int8Array(N).fill(-1);
    for (let i = 0; i < S; i++) { const T = G.types[K.ships[i].t]; for (let k = 0; k < T.size; k++) o[T.cells[pos[i] * T.size + k]] = i; }
    return o;
  });
  const shipCells = configs.map((pos) => K.ships.map((sh, i) => { const T = G.types[sh.t]; return Array.from(T.cells.subarray(pos[i] * T.size, (pos[i] + 1) * T.size)); }));
  const base = new Uint8Array(N);
  for (let c = 0; c < N; c++) if (K.hit[c] || K.water[c]) base[c] = 1;
  let nodes = 0;
  const memo = new Map();
  const remaining = (k, shot) => { let r = 0; for (const cs of shipCells[k]) for (const c of cs) if (!shot.has(c) && !base[c]) r++; return r; };
  const solve = (ids, shot) => {
    if (++nodes > budget) return null;
    if (ids.length === 1) return { value: objective === 'shots' ? remaining(ids[0], shot) : 0, cell: firstCell(ids[0], shot) };
    // done when no configuration has an unshot ship cell
    const key = ids.join(',') + '|' + [...shot].sort((a, b) => a - b).join(',');
    if (memo.has(key)) return memo.get(key);
    const cand = new Map();
    for (const k of ids) { const o = occOf[k]; for (let c = 0; c < N; c++) if (o[c] >= 0 && !base[c] && !shot.has(c)) cand.set(c, (cand.get(c) || 0) + 1); }
    if (!cand.size) { memo.set(key, { value: 0, cell: -1 }); return memo.get(key); }
    let best = null;
    // certain hits first when misses are the only cost
    const cells = [...cand.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
    if (objective === 'misses' && cand.get(cells[0]) === ids.length) {
      const c = cells[0];
      const parts = partition(ids, c, shot);
      let v = 0;
      for (const part of parts.values()) { const r = solve(part, new Set([...shot, c])); if (!r) return null; v += (part.length / ids.length) * r.value; }
      best = { value: v, cell: c };
    } else {
      for (const c of cells) {
        const parts = partition(ids, c, shot);
        let v = 0;
        for (const [ans, part] of parts) {
          const r = solve(part, new Set([...shot, c]));
          if (!r) return null;
          const cost = objective === 'shots' ? 1 : ans === 'm' ? 1 : 0;
          v += (part.length / ids.length) * (cost + r.value);
          if (best && v >= best.value) break;
        }
        if (!best || v < best.value - 1e-9) best = { value: v, cell: c };
      }
    }
    memo.set(key, best);
    return best;
  };
  const firstCell = (k, shot) => { for (const cs of shipCells[k]) for (const c of cs) if (!shot.has(c) && !base[c]) return c; return -1; };
  const partition = (ids, c, shot) => {
    const parts = new Map();
    for (const k of ids) {
      const s = occOf[k][c];
      let ans = 'm';
      if (s >= 0) {
        let left = 0;
        for (const x of shipCells[k][s]) if (x !== c && !shot.has(x) && !base[x]) left++;
        ans = left ? 'h' : K.mode === 'hit' ? 'h' : 's' + K.ships[s].t;
      }
      if (!parts.has(ans)) parts.set(ans, []);
      parts.get(ans).push(k);
    }
    return parts;
  };
  const r = solve(configs.map((_, k) => k), new Set());
  return r && r.cell >= 0 ? r : null;
}
