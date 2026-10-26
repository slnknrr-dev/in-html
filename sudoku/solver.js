// sudoku/solver.js - exact solver: candidate bit masks, constraint propagation to a fixpoint (naked singles removed
// from peers, hidden singles in houses, every variant propagator of the model) and depth-first search on the cell with
// the fewest candidates. Counts solutions up to a limit (uniqueness = exactly one), finds random complete grids for
// the generator, and stops after a node budget (counted, never timed, so results are reproducible).
//
//   makeEngine(model) -> { start(cand) -> boolean, assign(cand, cell, mask) -> boolean }   propagation only
//   solve(model, { limit = 2, rng, nodeLimit, start }) -> { count, solution: Int32Array | null, nodes, aborted }
//   isUnique(model, opts) -> boolean (false when the budget ran out)
//   randomSolution(model, rng, { nodeLimit, tries }) -> Int32Array (numbers 1..n per frame cell) | null
//   propagated(model, cand?) -> Int32Array | null   candidates after propagation (null: contradiction)

import { bitsOf, isSingle, lowBit, popcount } from './bits.js';
import { makeWideEngine, propagatedWide, randomSolutionWide, solveWide } from './wide.js';

// Wide models (grids above 31 × 31, model.wide) are solved by wide.js with two words per cell; the same calls work.

// Propagation engine (AC-3 style): a circular queue of dirty constraints plus a stack of new singles.
// - narrow() is the only write path: it intersects, detects empty (contradiction), enqueues every constraint
//   watching the cell (dirty[] guarantees each constraint is queued at most once, so capacity nc suffices) and
//   records new singles.
// - Singles are processed before the queue: removing a fixed value from peers is the cheapest, most productive
//   deduction, and peers are precomputed so it needs no constraint objects.
// - fail() drains the queue so the engine is reusable after a contradiction (the search reuses one engine for all
//   nodes instead of allocating per node).
// The engine works on the array passed in (cand is reassigned per call), so the caller owns copying.
export function makeEngine(model) {
  if (model.wide) return makeWideEngine(model);
  const { cons, peers, watch, geom } = model;
  const nc = cons.length;
  const dirty = new Uint8Array(nc);
  const queue = new Int32Array(nc + 1);
  let qh = 0, qt = 0, qn = 0;
  const singles = [];
  let cand = null;
  const narrow = (c, mask) => {
    const old = cand[c], nw = old & mask;
    if (nw === old) return true;
    if (nw === 0) return false;
    cand[c] = nw;
    const w = watch[c];
    for (let i = 0; i < w.length; i++) {
      const k = w[i];
      if (!dirty[k]) { dirty[k] = 1; queue[qt] = k; qt = qt === nc ? 0 : qt + 1; qn++; }
    }
    if ((nw & (nw - 1)) === 0) singles.push(c);
    return true;
  };
  const fail = () => {
    while (qn) { dirty[queue[qh]] = 0; qh = qh === nc ? 0 : qh + 1; qn--; }
    singles.length = 0;
    return false;
  };
  const run = () => {
    for (;;) {
      while (singles.length) {
        const c = singles.pop();
        const v = cand[c];
        const p = peers[c];
        for (let i = 0; i < p.length; i++) {
          const q = p[i];
          if ((cand[q] & v) && !narrow(q, ~v)) return fail();
        }
      }
      if (!qn) return true;
      const k = queue[qh];
      qh = qh === nc ? 0 : qh + 1;
      qn--;
      dirty[k] = 0;
      if (!cons[k].prop(cand, narrow)) return fail();
    }
  };
  return {
    narrow,
    start(cd) {
      cand = cd;
      for (const c of geom.cells) { if (!cand[c]) return fail(); if (isSingle(cand[c])) singles.push(c); }
      for (let k = 0; k < nc; k++) if (!dirty[k]) { dirty[k] = 1; queue[qt] = k; qt = qt === nc ? 0 : qt + 1; qn++; }
      return run();
    },
    assign(cd, c, mask) {
      cand = cd;
      if (!narrow(c, mask)) return fail();
      return run();
    },
  };
}

// Candidates after propagation from `cand` (default: the model's initial candidates), or null on a contradiction.
export function propagated(model, cand = model.init) {
  if (model.wide) return propagatedWide(model, cand);
  const cd = Int32Array.from(cand);
  return makeEngine(model).start(cd) ? cd : null;
}

export function solve(model, opts = {}) {
  return model.wide ? solveWide(model, opts) : solveNarrow(model, opts);
}

// DFS with MRV (minimum remaining values): branch on the cell with the fewest candidates; stop scanning at 2,
// which cannot be beaten. Each child gets a copy of the candidate array (cheap Int32Array slice) so backtracking
// needs no undo log. Counting stops at `limit` (2 is enough to prove non-uniqueness).
// nodeLimit counts nodes, not milliseconds: the same input gives the same result on every machine, which the seeded
// generator depends on.
function solveNarrow(model, { limit = 2, rng = null, nodeLimit = 0, start = null, engine = null }) {
  const eng = engine || makeEngine(model);
  const cells = model.geom.cells;
  const nCells = cells.length;
  let count = 0, nodes = 0, aborted = false, solution = null;
  const root = Int32Array.from(start || model.init);
  if (!eng.start(root)) return { count: 0, solution: null, nodes: 0, aborted: false };
  const dfs = (cand) => {
    if (nodeLimit && ++nodes > nodeLimit) { aborted = true; return; }
    let best = -1, bc = 99;
    for (let i = 0; i < nCells; i++) {
      const m = cand[cells[i]];
      if (m & (m - 1)) {
        const pc = popcount(m);
        if (pc < bc) { bc = pc; best = cells[i]; if (pc === 2) break; }
      }
    }
    if (best < 0) {
      count++;
      if (!solution) {
        solution = new Int32Array(cand.length);
        for (let i = 0; i < nCells; i++) solution[cells[i]] = lowBit(cand[cells[i]]) + 1;
      }
      return;
    }
    const vals = bitsOf(cand[best]);
    if (rng) rng.shuffle(vals);
    for (let j = 0; j < vals.length; j++) {
      const next = cand.slice();
      if (eng.assign(next, best, 1 << vals[j])) dfs(next);
      if (count >= limit || aborted) return;
    }
  };
  dfs(root);
  return { count, solution, nodes, aborted };
}

// A budget overrun is reported as "not unique" (false): fail safe, the generator then keeps more givens.
export function isUnique(model, opts = {}) {
  const r = solve(model, { limit: 2, nodeLimit: opts.nodeLimit || 0, start: opts.start, engine: opts.engine });
  return r.count === 1 && !r.aborted;
}

// A random complete grid that satisfies every rule and clue of the model. Random searches are heavy-tailed, so short
// restarts with fresh random streams beat one long search; the budget grows slowly. Deterministic for a seeded rng.
export function randomSolution(model, rng, { nodeLimit = 1000, tries = 12 } = {}) {
  if (model.wide) return randomSolutionWide(model, rng, { nodeLimit, tries });
  const engine = makeEngine(model);
  for (let t = 0; t < tries; t++) {
    const r = solve(model, { limit: 1, rng: rng.fork ? rng.fork('fill ' + t) : rng, nodeLimit: Math.round(nodeLimit * (1 + t / 4)), engine });
    if (r.solution) return r.solution;
    if (!r.aborted) return null; // no solution at all
  }
  return null;
}
