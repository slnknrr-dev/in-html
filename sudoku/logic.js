// sudoku/logic.js - a human-style solver: it repeats the easiest deduction that makes progress, records every step
// with what it used (houses, cells, values) so that hints can explain it, and grades a puzzle by the hardest
// technique it needed. Variant clues take part through the propagators of the model (constraints.js): applying one
// clue's rule to the current candidates is one step ("the cage 17 in two cells only fits 8 + 9").
//
// Techniques and levels (1 easy … 6 extreme):
//   1  fullHouse, nakedSingle, hiddenSingle, simple variant clues (dots, signs, thermometers, palindromes…)
//   2  lockedCandidates (pointing / claiming, any two houses), nakedPair, hiddenPair, arithmetic variant clues (cages,
//      arrows, sandwiches, skyscrapers, lines with sums or sets)
//   3  nakedTriple, hiddenTriple, xWing
//   4  nakedQuad, hiddenQuad, swordfish, jellyfish, xyWing, xyzWing
//   5  coloring (simple colouring of one value's strong links: colour wrap and colour trap)
//   6  trial (assume a candidate; propagation reaches a contradiction, so it is removed)
//
//   createLogic(model) -> logic
//   logic.stateFrom(values?) -> { val: Int32Array, cand: Int32Array }   values: numbers per frame cell (0 = empty)
//   logic.next(state, { maxLevel }) -> step | null
//   logic.apply(state, step)
//   logic.solve({ maxLevel, values }) -> { solved, steps, level, score, state }
//   logic.hint(values, { solution, maxLevel }) -> { type: 'solved' | 'error' | 'step' | 'reveal' | 'contradiction', … }
//
// step = { tech, level, place?: [cell, value], elim?: [[cell, mask]], house?, houses?, cells?, value?, values?, k?,
//          kind?, clue?, rule?, sub?, colors? }   values are numbers 1..n, masks use bit v-1.

import { bitsOf, isSingle, lowBit, popcount } from './bits.js';
import { makeEngine } from './solver.js';
import { createWideLogic } from './wide.js';

export const TECHNIQUES = [
  ['fullHouse', 1], ['nakedSingle', 1], ['hiddenSingle', 1], ['variant', 1],
  ['lockedCandidates', 2], ['nakedPair', 2], ['hiddenPair', 2],
  ['nakedTriple', 3], ['hiddenTriple', 3], ['xWing', 3],
  ['nakedQuad', 4], ['hiddenQuad', 4], ['swordfish', 4], ['jellyfish', 4], ['xyWing', 4], ['xyzWing', 4],
  ['coloring', 5], ['trial', 6],
];
// Score weights grow roughly geometrically so one hard step outweighs many easy ones (score ranks puzzles of the same level).
const WEIGHT = { 1: 1, 2: 4, 3: 12, 4: 30, 5: 60, 6: 120 };
export const LEVEL_NAMES = ['', 'easy', 'medium', 'hard', 'expert', 'master', 'extreme'];

const LINEISH = new Set(['row', 'col', 'diag']);

// Precomputation for the techniques: a size x size "sees" bitmap (O(1) peer test; 1 MB for 31 x 31, which is why
// wide grids use binary search instead), house membership per cell, house pairs sharing at least 2 cells (locked
// candidates generalized to any pair of houses, including diagonals and windows), and row / column lists per
// sub-grid for fish.
export function createLogic(model) {
  if (model.wide) return createWideLogic(model); // grids above 31 × 31: levels 1-2 on two-word candidates
  const { geom, n, houses, groups, cons, peers } = model;
  const nh = houses.length;
  const size = geom.size;
  const cells = Array.from(geom.cells);
  const hcells = houses.map((h) => Array.from(h.cells)); // plain arrays: filter / map keep their elements
  // sees[a * size + b]: a and b must differ
  const sees = new Uint8Array(size * size);
  for (const a of cells) for (const b of peers[a]) sees[a * size + b] = 1;
  const see = (a, b) => sees[a * size + b] === 1;
  // houses containing each cell
  const cellHouses = Array.from({ length: size }, () => []);
  houses.forEach((h, k) => { for (const c of h.cells) cellHouses[c].push(k); });
  // pairs of houses sharing at least two cells (locked candidates)
  const housePairs = [];
  for (let a = 0; a < nh; a++) {
    const setA = new Set(hcells[a]);
    for (let b = 0; b < nh; b++) {
      if (a === b) continue;
      const inter = hcells[b].filter((c) => setA.has(c));
      if (inter.length < 2) continue;
      const setB = new Set(hcells[b]);
      housePairs.push({ a, b, inter, aOnly: hcells[a].filter((c) => !setB.has(c)), bOnly: hcells[b].filter((c) => !setA.has(c)) });
    }
  }
  // rows and columns per sub-grid (fish)
  const lines = geom.grids.map((_, g) => ({
    rows: houses.map((h, k) => (h.kind === 'row' && h.g === g ? k : -1)).filter((k) => k >= 0),
    cols: houses.map((h, k) => (h.kind === 'col' && h.g === g ? k : -1)).filter((k) => k >= 0),
  }));
  const subsetUnits = [...hcells, ...groups.map((g) => Array.from(g))];
  const variantCons = cons.filter((c) => c.house === undefined);
  let engine = null;

  // --- state ---------------------------------------------------------------------------------------------------

  // Player values start from model.base (no givens applied); otherwise from model.init. place() eliminates from peers immediately.
  function stateFrom(values) {
    const val = new Int32Array(size);
    const cand = Int32Array.from(values ? model.base : model.init);
    const st = { val, cand };
    for (const c of cells) {
      const v = (values ? values[c] : model.givens[c]) | 0;
      if (v) place(st, c, v);
    }
    return st;
  }

  function place(st, c, v) {
    const b = 1 << (v - 1);
    st.val[c] = v;
    st.cand[c] = b;
    for (const p of peers[c]) st.cand[p] &= ~b;
  }

  function apply(st, step) {
    if (step.place) place(st, step.place[0], step.place[1]);
    if (step.elim) for (const [c, m] of step.elim) st.cand[c] &= ~m;
  }

  // --- techniques ----------------------------------------------------------------------------------------------

  // Order matters for hint quality: full house, then naked single, then hidden single (what a human notices first).
  function singles(st) {
    // full house: the last empty cell of a house
    for (let h = 0; h < nh; h++) {
      let open = 0, at = -1;
      for (const c of hcells[h]) if (!st.val[c]) { open++; at = c; if (open > 1) break; }
      if (open === 1 && isSingle(st.cand[at])) return { tech: 'fullHouse', level: 1, house: h, place: [at, lowBit(st.cand[at]) + 1] };
    }
    for (const c of cells) if (!st.val[c] && isSingle(st.cand[c])) return { tech: 'nakedSingle', level: 1, place: [c, lowBit(st.cand[c]) + 1] };
    for (let h = 0; h < nh; h++) {
      const hc = hcells[h];
      let once = 0, twice = 0, placed = 0;
      for (const c of hc) {
        if (st.val[c]) { placed |= 1 << (st.val[c] - 1); continue; }
        const m = st.cand[c];
        twice |= once & m; once |= m;
      }
      const uniq = once & ~twice & ~placed;
      if (!uniq) continue;
      const b = uniq & -uniq;
      for (const c of hc) if (!st.val[c] && (st.cand[c] & b)) return { tech: 'hiddenSingle', level: 1, house: h, place: [c, lowBit(b) + 1] };
    }
    return null;
  }

  // Checked before any technique so a hint reports a broken board instead of deducing from it.
  function contradiction(st) {
    for (const c of cells) if (!st.val[c] && !st.cand[c]) return { tech: 'contradiction', level: 0, cells: [c] };
    for (let h = 0; h < nh; h++) {
      let all = 0;
      for (const c of hcells[h]) all |= st.val[c] ? 1 << (st.val[c] - 1) : st.cand[c];
      if (all !== model.full) return { tech: 'contradiction', level: 0, house: h, cells: [...hcells[h]] };
    }
    return null;
  }

  // Variant clues as human steps: run one propagator on a scratch copy and report what it eliminated. Exceptions
  // from a propagator are swallowed (treated as "no deduction") so a buggy clue cannot crash hints; this also hides
  // such bugs, the exact solver path does not catch them.
  function variant(st, maxLevel) {
    for (const k of variantCons) {
      if (k.level > maxLevel) continue;
      const work = st.cand.slice();
      let ok = true;
      const narrow = (c, m) => { const nw = work[c] & m; if (!nw) return false; work[c] = nw; return true; };
      try { ok = k.prop(work, narrow); } catch { ok = true; }
      const elim = [];
      for (const c of k.cells) if (!st.val[c] && work[c] !== st.cand[c]) elim.push([c, st.cand[c] & ~work[c]]);
      if (!ok) return { tech: 'contradiction', level: 0, kind: k.kind, clue: k.clue, rule: k.rule, cells: [...k.cells] };
      if (elim.length) return { tech: 'variant', level: k.level, kind: k.kind, clue: k.clue, rule: k.rule, cells: [...k.cells], elim };
    }
    return null;
  }

  // Locked candidates generalized: value candidates of A confined to A ∩ B are removed from B \ A. Pointing / claiming are named only for the classic shapes.
  function locked(st) {
    // a value of house A whose places all lie in A ∩ B is removed from the rest of B
    const orOpen = (list) => { let m = 0; for (const c of list) if (!st.val[c]) m |= st.cand[c]; return m; };
    for (const { a, b, inter, aOnly, bOnly } of housePairs) {
      const m = orOpen(inter) & ~orOpen(aOnly) & orOpen(bOnly);
      if (!m) continue;
      const bit = m & -m;
      const A = houses[a], B = houses[b];
      const pos = inter.filter((c) => !st.val[c] && (st.cand[c] & bit));
      const elim = bOnly.filter((c) => !st.val[c] && (st.cand[c] & bit)).map((c) => [c, bit]);
      const sub = !LINEISH.has(A.kind) && LINEISH.has(B.kind) ? 'pointing' : LINEISH.has(A.kind) && !LINEISH.has(B.kind) ? 'claiming' : 'locked';
      return { tech: 'lockedCandidates', level: 2, sub, houses: [a, b], value: lowBit(bit) + 1, cells: pos, elim };
    }
    return null;
  }

  function combos(arr, k, fn) {
    const pick = [];
    const rec = (start) => {
      if (pick.length === k) return fn(pick);
      for (let i = start; i < arr.length; i++) {
        pick.push(arr[i]);
        const r = rec(i + 1);
        pick.pop();
        if (r) return r;
      }
      return null;
    };
    return rec(0);
  }

  // Subsets are searched in houses and in non-house all-different groups (cages, renban), where naked subsets are equally valid.
  function nakedSubset(st, k) {
    for (let u = 0; u < subsetUnits.length; u++) {
      const unit = subsetUnits[u];
      const open = unit.filter((c) => !st.val[c]);
      if (open.length <= k) continue;
      const small = open.filter((c) => popcount(st.cand[c]) <= k && popcount(st.cand[c]) >= 2);
      if (small.length < k) continue;
      const r = combos(small, k, (pick) => {
        let m = 0;
        for (const c of pick) m |= st.cand[c];
        if (popcount(m) !== k) return null;
        const elim = open.filter((c) => !pick.includes(c) && (st.cand[c] & m)).map((c) => [c, st.cand[c] & m]);
        if (!elim.length) return null;
        return { cells: [...pick], values: m, elim };
      });
      if (r) return { tech: ['', '', 'nakedPair', 'nakedTriple', 'nakedQuad'][k], level: [0, 0, 2, 3, 4][k], k, house: u < nh ? u : -1, unit: u < nh ? null : [...unit], ...r };
    }
    return null;
  }

  function hiddenSubset(st, k) {
    for (let h = 0; h < nh; h++) {
      const hc = hcells[h];
      const open = hc.filter((c) => !st.val[c]);
      if (open.length <= k) continue;
      const pos = []; // [value, mask over open indices]
      for (let v = 0; v < n; v++) {
        let m = 0;
        open.forEach((c, i) => { if (st.cand[c] & (1 << v)) m |= 1 << i; });
        const pc = popcount(m);
        if (pc >= 2 && pc <= k) pos.push([v, m]);
      }
      if (pos.length < k) continue;
      const r = combos(pos, k, (pick) => {
        let m = 0, vm = 0;
        for (const [v, pm] of pick) { m |= pm; vm |= 1 << v; }
        if (popcount(m) !== k) return null;
        const cs = bitsOf(m).map((i) => open[i]);
        const elim = cs.filter((c) => st.cand[c] & ~vm).map((c) => [c, st.cand[c] & ~vm]);
        if (!elim.length) return null;
        return { cells: cs, values: vm, elim };
      });
      if (r) return { tech: ['', '', 'hiddenPair', 'hiddenTriple', 'hiddenQuad'][k], level: [0, 0, 2, 3, 4][k], k, house: h, ...r };
    }
    return null;
  }

  // Fish over the rows / columns of each sub-grid separately: a row of one samurai grid is not a base line of another.
  function fish(st, k) {
    for (let g = 0; g < lines.length; g++) {
      for (const [baseL, coverL] of [[lines[g].rows, lines[g].cols], [lines[g].cols, lines[g].rows]]) {
        if (baseL.length < k + 1) continue;
        // cover index of a cell: its position along the base line
        const coverOf = new Map();
        coverL.forEach((h, i) => { for (const c of hcells[h]) coverOf.set(c, i); });
        for (let v = 0; v < n; v++) {
          const bit = 1 << v;
          const bases = [];
          for (const h of baseL) {
            let m = 0, placed = false;
            for (const c of hcells[h]) {
              if (st.val[c] === v + 1) { placed = true; break; }
              if (!st.val[c] && (st.cand[c] & bit)) m |= 1 << coverOf.get(c);
            }
            if (placed) continue;
            const pc = popcount(m);
            if (pc >= 2 && pc <= k) bases.push([h, m]);
          }
          if (bases.length < k) continue;
          const r = combos(bases, k, (pick) => {
            let m = 0;
            for (const [, pm] of pick) m |= pm;
            if (popcount(m) !== k) return null;
            const baseSet = new Set(pick.flatMap(([h]) => [...hcells[h]]));
            const covers = bitsOf(m).map((i) => coverL[i]);
            const elim = [];
            for (const ch of covers) for (const c of hcells[ch]) if (!baseSet.has(c) && !st.val[c] && (st.cand[c] & bit)) elim.push([c, bit]);
            if (!elim.length) return null;
            const fishCells = [...baseSet].filter((c) => !st.val[c] && (st.cand[c] & bit) && covers.some((ch) => hcells[ch].includes(c)));
            return { houses: pick.map(([h]) => h), cover: covers, cells: fishCells, elim };
          });
          if (r) return { tech: ['', '', 'xWing', 'swordfish', 'jellyfish'][k], level: [0, 0, 3, 4, 4][k], k, value: v + 1, ...r };
        }
      }
    }
    return null;
  }

  function wings(st) {
    const bi = cells.filter((c) => !st.val[c] && popcount(st.cand[c]) === 2);
    // XY-wing: pivot {x,y}, pincers {x,z} and {y,z} seen by the pivot
    for (const p of bi) {
      const pm = st.cand[p];
      const wingsOf = bi.filter((q) => q !== p && see(p, q) && popcount(st.cand[q] & pm) === 1);
      for (let i = 0; i < wingsOf.length; i++) {
        for (let j = i + 1; j < wingsOf.length; j++) {
          const a = wingsOf[i], b = wingsOf[j];
          const za = st.cand[a] & ~pm, zb = st.cand[b] & ~pm;
          if (za !== zb || !za || (st.cand[a] & pm) === (st.cand[b] & pm)) continue;
          const elim = cells.filter((c) => !st.val[c] && c !== a && c !== b && c !== p && (st.cand[c] & za) && see(c, a) && see(c, b)).map((c) => [c, za]);
          if (elim.length) return { tech: 'xyWing', level: 4, cells: [p, a, b], value: lowBit(za) + 1, elim };
        }
      }
    }
    // XYZ-wing: pivot {x,y,z}, pincers {x,z}, {y,z}; eliminate z from cells seeing all three
    for (const p of cells) {
      if (st.val[p] || popcount(st.cand[p]) !== 3) continue;
      const pm = st.cand[p];
      const ws = bi.filter((q) => see(p, q) && (st.cand[q] & pm) === st.cand[q]);
      for (let i = 0; i < ws.length; i++) {
        for (let j = i + 1; j < ws.length; j++) {
          const a = ws[i], b = ws[j];
          if (st.cand[a] === st.cand[b]) continue;
          const z = st.cand[a] & st.cand[b];
          if (!isSingle(z)) continue;
          const elim = cells.filter((c) => !st.val[c] && c !== a && c !== b && c !== p && (st.cand[c] & z) && see(c, a) && see(c, b) && see(c, p)).map((c) => [c, z]);
          if (elim.length) return { tech: 'xyzWing', level: 4, cells: [p, a, b], value: lowBit(z) + 1, elim };
        }
      }
    }
    return null;
  }

  // Simple colouring on conjugate pairs (houses with exactly 2 places for v): 2-colour each connected chain; two
  // same-coloured cells that see each other prove that colour false (wrap); a cell seeing both colours loses v
  // (trap). Chains under 4 cells are skipped: they reduce to simpler techniques.
  function coloring(st) {
    for (let v = 0; v < n; v++) {
      const bit = 1 << v;
      const adj = new Map();
      for (let h = 0; h < nh; h++) {
        const pos = [];
        let placed = false;
        for (const c of hcells[h]) {
          if (st.val[c] === v + 1) { placed = true; break; }
          if (!st.val[c] && (st.cand[c] & bit)) pos.push(c);
        }
        if (placed || pos.length !== 2) continue;
        const [a, b] = pos;
        (adj.get(a) || adj.set(a, new Set()).get(a)).add(b);
        (adj.get(b) || adj.set(b, new Set()).get(b)).add(a);
      }
      const color = new Map();
      for (const start of adj.keys()) {
        if (color.has(start)) continue;
        const comp = [[], []];
        color.set(start, 0);
        const stack = [start];
        while (stack.length) {
          const c = stack.pop();
          const col = color.get(c);
          comp[col].push(c);
          for (const d of adj.get(c)) if (!color.has(d)) { color.set(d, 1 - col); stack.push(d); }
        }
        if (comp[0].length + comp[1].length < 4) continue;
        // colour wrap: two cells of one colour see each other -> that colour is false
        for (let k = 0; k < 2; k++) {
          const cs = comp[k];
          let wrap = false;
          for (let i = 0; i < cs.length && !wrap; i++) for (let j = i + 1; j < cs.length; j++) if (see(cs[i], cs[j])) { wrap = true; break; }
          if (wrap) return { tech: 'coloring', level: 5, sub: 'wrap', value: v + 1, colors: comp, cells: [...comp[0], ...comp[1]], elim: cs.map((c) => [c, bit]) };
        }
        // colour trap: a cell seeing both colours
        const inComp = new Set([...comp[0], ...comp[1]]);
        const elim = cells.filter((c) => !st.val[c] && !inComp.has(c) && (st.cand[c] & bit) && comp[0].some((x) => see(c, x)) && comp[1].some((x) => see(c, x))).map((c) => [c, bit]);
        if (elim.length) return { tech: 'coloring', level: 5, sub: 'trap', value: v + 1, colors: comp, cells: [...inComp], elim };
      }
    }
    return null;
  }

  // Level 6 "trial": one-step contradiction by full propagation. Tries cells with fewest candidates first (shortest explanations).
  function trial(st) {
    engine ||= makeEngine(model);
    const order = cells.filter((c) => !st.val[c] && popcount(st.cand[c]) >= 2).sort((a, b) => popcount(st.cand[a]) - popcount(st.cand[b]));
    for (const c of order) {
      for (const v of bitsOf(st.cand[c])) {
        const work = st.cand.slice();
        work[c] = 1 << v;
        if (!engine.start(work)) return { tech: 'trial', level: 6, cells: [c], value: v + 1, elim: [[c, 1 << v]] };
      }
    }
    return null;
  }

  // --- driver --------------------------------------------------------------------------------------------------

  // Easiest-first ladder. Jellyfish needs at least 9 lines to be meaningful, hence the n >= 9 guard.
  function next(st, { maxLevel = 6 } = {}) {
    const bad = contradiction(st);
    if (bad) return bad;
    let s = singles(st);
    if (s) return s;
    if ((s = variant(st, 1))) return s;
    if (maxLevel < 2) return null;
    if ((s = variant(st, 2)) || (s = locked(st)) || (s = nakedSubset(st, 2)) || (s = hiddenSubset(st, 2))) return s;
    if (maxLevel < 3) return null;
    if ((s = nakedSubset(st, 3)) || (s = hiddenSubset(st, 3)) || (s = fish(st, 2))) return s;
    if (maxLevel < 4) return null;
    if ((s = wings(st)) || (s = nakedSubset(st, 4)) || (s = hiddenSubset(st, 4)) || (s = fish(st, 3)) || (n >= 9 && (s = fish(st, 4)))) return s;
    if (maxLevel < 5) return null;
    if ((s = coloring(st))) return s;
    if (maxLevel < 6) return null;
    return trial(st);
  }

  const solvedState = (st) => cells.every((c) => st.val[c]);

  function solve({ maxLevel = 6, values = null, maxSteps = 100000 } = {}) {
    const st = stateFrom(values);
    const steps = [];
    let level = 0, score = 0;
    for (let i = 0; i < maxSteps; i++) {
      if (solvedState(st)) return { solved: true, steps, level, score, state: st };
      const s = next(st, { maxLevel });
      if (!s || s.tech === 'contradiction') return { solved: false, steps, level, score, state: st, stuck: s };
      apply(st, s);
      steps.push(s);
      if (s.level > level) level = s.level;
      score += WEIGHT[s.level] || 1;
    }
    return { solved: false, steps, level, score, state: st };
  }

  // The next hint for a player's values: wrong entries first (with the solution), then the next logical step, else a
  // cell to reveal.
  function hint(values, { solution = null, maxLevel = 6 } = {}) {
    if (solution) {
      const wrong = cells.filter((c) => values[c] && values[c] !== solution[c]);
      if (wrong.length) return { type: 'error', cells: wrong };
    }
    const st = stateFrom(values);
    if (solvedState(st)) return { type: 'solved' };
    const s = next(st, { maxLevel });
    if (s && s.tech === 'contradiction') return { type: 'contradiction', step: s };
    if (s) return { type: 'step', step: s, state: st };
    if (solution) {
      const open = cells.filter((c) => !st.val[c]).sort((a, b) => popcount(st.cand[a]) - popcount(st.cand[b]));
      return { type: 'reveal', cell: open[0], value: solution[open[0]] };
    }
    return { type: 'stuck' };
  }

  // candidates of a cell as a set (bits.js), the same call for wide logic
  const candOf = (st, c) => st.cand[c];

  return { stateFrom, next, apply, solve, hint, see, cellHouses, candOf };
}

// Difficulty grade of a puzzle: { level, name, score, solved, steps }.
// Level 7 = not solvable by the techniques (needs guessing beyond trial).
export function grade(model, maxLevel = 6) {
  const r = createLogic(model).solve({ maxLevel });
  return { level: r.solved ? r.level : 7, name: r.solved ? LEVEL_NAMES[r.level] : 'beyond', score: r.score, solved: r.solved, steps: r.steps.length };
}
