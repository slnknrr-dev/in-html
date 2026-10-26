// sudoku/model.js - compiles a puzzle (plain JSON) into the solver model shared by solver.js and logic.js.
//
// puzzle = {
//   n, box: [w, h] | null, regions: number[n*n] | null, layout: id | null,   shape (geometry.js)
//   rules: [id],                         global rules (rules.js)
//   clues: [{ t, ... }],                 drawn clues (clues.js)
//   givens: number[rows*cols]            0 = empty, 1..n
//   variant, title, meta …               informative
// }
// model = { puzzle, geom, n, full, houses, groups, cons, peers, watch, init, givens }
//   houses  [{ kind, cells, g, i, … }]   every value exactly once (rows, columns, boxes, rule houses)
//   groups  [Int32Array]                 all-different sets that are not houses (cages, renban lines)
//   cons    [constraint]                 houses first (cons[k].house = house index), then rules and clues
//                                         (cons[k].clue = clue index, cons[k].rule = rule id)
//   peers   [Int32Array]                 cells that must differ from each cell (houses, groups, anti-chess pairs)
//   watch   [Int32Array]                 constraint indices per cell
//   init    Int32Array                   candidates after the givens and cell restrictions (no propagation yet)
//   base    Int32Array                   the same before the givens (startFor(model, values) applies other values)
//   wide    boolean                      n > 31: two words per cell in init / base (wide.js), houses and pairs only

import { WORD_N, fullMask, setFull, setOf } from './bits.js';
import { makeGeometry } from './geometry.js';
import { houseCons, relCons } from './constraints.js';
import { wideHouseCons } from './wide.js';
import { RULES } from './rules.js';
import { CLUES } from './clues.js';

// opts.wide: two-word candidates for any size (tests compare both paths on small grids).
// Compilation pipeline: geometry -> rule houses / pairs / constraints -> clue constraints -> houses turned into
// constraints -> peer and watch lists -> initial candidates. Everything the solver needs per step is precomputed
// here as typed arrays, so the hot loop does no Map lookups or allocation.
// Wide (> 31 values) models only support houses and "must differ" pairs: ctx.addCons / restrict throw (fail fast with
// a message) instead of silently ignoring a clue, which would yield puzzles with several solutions.
export function compile(puzzle, { wide: forceWide = false } = {}) {
  const geom = makeGeometry({ n: puzzle.n, box: puzzle.box || null, regions: puzzle.regions ? Int32Array.from(puzzle.regions) : null, layout: puzzle.layout || null });
  const n = geom.n, wide = n > WORD_N || forceWide, full = wide ? setFull(n) : fullMask(n);
  const noWide = (what) => { throw new Error(`${what} are not available on grids above ${WORD_N} × ${WORD_N}`); };
  const houses = geom.houses.map((h) => ({ ...h }));
  // Houses are de-duplicated by sorted cell list: a rule may add a house that geometry already has (e.g. a window equal to a box).
  const houseKeys = new Set(houses.map((h) => [...h.cells].sort((a, b) => a - b).join(',')));
  const groups = [];
  const cons = [];
  // Pairwise "must differ" relations go straight into peers (cheapest possible propagation), not into constraint objects.
  const neq = new Map(); // cell -> Set of cells
  const init = new Int32Array(wide ? geom.size * 2 : geom.size);
  if (wide) { const [fl, fh] = typeof full === 'number' ? [full, 0] : full; for (const i of geom.cells) { init[2 * i] = fl; init[2 * i + 1] = fh; } }
  else for (const i of geom.cells) init[i] = full;
  const addNeqPair = (a, b) => {
    if (a === b) return;
    (neq.get(a) || neq.set(a, new Set()).get(a)).add(b);
    (neq.get(b) || neq.set(b, new Set()).get(b)).add(a);
  };
  const ctx = {
    geom, n, puzzle, current: -1, rule: null,
    addHouse(kind, cells, info = {}) {
      const key = [...cells].sort((a, b) => a - b).join(',');
      if (houseKeys.has(key)) return;
      houseKeys.add(key);
      houses.push({ kind, cells: Int32Array.from(cells), ...info, id: houses.length });
    },
    addDistinct(cells) { groups.push(Int32Array.from(cells)); },
    addNeq: addNeqPair,
    addCons(c) {
      if (wide) noWide('rules with clues or arithmetic');
      if (ctx.current >= 0) c.clue = ctx.current;
      if (ctx.rule) c.rule = ctx.rule;
      cons.push(c);
      return c;
    },
    restrict(cell, mask) { if (wide) noWide('cell clues'); init[cell] &= mask; },
    rel(kind, rel, a, b, level = 1) {
      if (rel === 'neq') { addNeqPair(a, b); return; }
      ctx.addCons(relCons(kind, rel, a, b, n, level));
    },
  };
  // ctx.rule / ctx.current tag every constraint with its origin so logic.js steps can name the clue or rule that made a deduction.
  for (const id of puzzle.rules || []) {
    const rule = RULES[id];
    if (!rule) throw new Error(`unknown rule ${id}`);
    if (!rule.supports(geom)) throw new Error(`rule ${id} does not fit this grid`);
    ctx.rule = id;
    rule.apply(ctx);
  }
  ctx.rule = null;
  if (wide && (puzzle.clues || []).length) noWide('drawn clues');
  (puzzle.clues || []).forEach((cl, k) => {
    const kind = CLUES[cl.t];
    if (!kind) throw new Error(`unknown clue ${cl.t}`);
    for (const c of kind.cells(cl, geom)) if (!(c >= 0 && c < geom.size && geom.present[c])) throw new Error(`clue ${cl.t} refers to a missing cell`);
    ctx.current = k;
    kind.build(cl, ctx);
  });
  ctx.current = -1;
  // houses become constraints first, so cons index k < houses.length is house k
  // Ordering invariant relied on by logic.js: cons[k].house === k for k < houses.length; variantCons = the rest.
  const houseCs = houses.map((h, k) => Object.assign(wide ? wideHouseCons(h.cells, n) : houseCons(h.cells, n), { house: k }));
  const allCons = [...houseCs, ...cons];
  // peers
  const peerSets = Array.from({ length: geom.size }, () => new Set());
  for (const h of houses) for (const a of h.cells) for (const b of h.cells) if (a !== b) peerSets[a].add(b);
  for (const g of groups) for (const a of g) for (const b of g) if (a !== b) peerSets[a].add(b);
  for (const [a, set] of neq) for (const b of set) peerSets[a].add(b);
  const peers = peerSets.map((s) => Int32Array.from([...s].sort((a, b) => a - b)));
  // watch[c] = constraints to re-run when cell c narrows (the propagation queue is driven by this list).
  const watchL = Array.from({ length: geom.size }, () => []);
  allCons.forEach((c, k) => { for (const cell of c.cells) watchL[cell].push(k); });
  const watch = watchL.map((l) => Int32Array.from(l));
  // base keeps candidates after rules / cell clues but before givens: startFor() and logic.stateFrom(values) start from it with player values.
  const base = init.slice(); // before the givens
  const givens = new Int32Array(geom.size);
  const gv = puzzle.givens || [];
  for (const i of geom.cells) {
    const v = gv[i] | 0;
    if (v < 0 || v > n) throw new Error('given out of range');
    if (!v) continue;
    givens[i] = v;
    if (wide) keepOnly(init, i, v);
    else init[i] &= 1 << (v - 1);
  }
  return { puzzle, geom, n, full, houses, groups, cons: allCons, peers, watch, init, base, givens, wide };
}

// Two-word candidates of cell i reduced to the number v (wide models).
function keepOnly(cand, i, v) {
  const b = v - 1;
  cand[2 * i] &= b < 32 ? 1 << b : 0;
  cand[2 * i + 1] &= b < 32 ? 0 : 1 << (b - 32);
}

// The candidates of cell c before the givens as a set (bits.js): the same for plain and wide models.
export const baseSet = (model, c) => (model.wide ? setOf(model.base[2 * c], model.base[2 * c + 1]) : model.base[c]);

// Initial candidates of the model for other values (numbers per frame cell, 0 = empty): the rules and clues stay.
export function startFor(model, values) {
  const cand = model.base.slice();
  for (const i of model.geom.cells) {
    const v = values[i] | 0;
    if (!v) continue;
    if (model.wide) keepOnly(cand, i, v);
    else cand[i] &= 1 << (v - 1);
  }
  return cand;
}
