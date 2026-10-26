// sudoku/generate.js - puzzles with exactly one solution, reproducible from a seed.
//
//   generate(options, rng, { onProgress }) -> { puzzle, solution, grade }
//   normalize(options) -> options with valid size, box, variant and rules (throws on impossible combinations)
//   difficultiesFor(n) -> the difficulty ids offered for a grid size (above 16 × 16 up to 'hard', above 31 × 31
//                         'easy' only)
//   DIFFICULTIES, SYMMETRIES
//
// options = { variant = 'classic', n = 9, box: [w, h] | 'none' | null (default box), difficulty = 'medium',
//             symmetry = 'rotational' | 'mirror' | 'diagonal' | 'none', rules: [extra rule ids] }
// Steps: shape (random jigsaw regions) → a random complete grid satisfying every rule (solver.js) → the variant's clues
// made from it (variants.js) → givens removed while the puzzle stays unique and solvable by the techniques of the
// difficulty (logic.js) → clues that are not needed removed (variants with `prune`) → graded. Candidates that miss
// the difficulty's lowest level are retried with fresh grids and the closest one is kept. Every random choice comes
// from `rng` forks and every search has a counted budget, so a seed always gives the same puzzle.

import { defaultBox, layoutOK, makeGeometry, MAX_N, MIN_N, randomRegions, regionsForSolution } from './geometry.js';
import { compile, startFor } from './model.js';
import { isUnique, makeEngine, randomSolution, solve } from './solver.js';
import { solvedWide } from './wide.js';
import { createLogic } from './logic.js';
import { RULES } from './rules.js';
import { EXTRA_RULES, WIDE_RULES, variant as variantOf, wideOK } from './variants.js';
import { WORD_N } from './bits.js';

// Levels of logic.js allowed per difficulty; `tries` = candidate puzzles for a 9 × 9 grid (fewer for big grids);
// `hardest`: keep the hardest candidate instead of the first that fits. Level 7 = beyond the techniques (guessing).
export const DIFFICULTIES = {
  easy: { min: 1, max: 1, tries: 2 },
  medium: { min: 2, max: 2, tries: 4 },
  hard: { min: 3, max: 4, tries: 16 },
  expert: { min: 5, max: 6, tries: 24 },
  extreme: { min: 6, max: 7, tries: 24, hardest: true },
};
export const SYMMETRIES = ['rotational', 'mirror', 'diagonal', 'none'];
// Jigsaw grids larger than this are made solution first (regionsForSolution).
const JIGSAW_SOLUTION_FIRST = 12;
// Grids above 16 × 16 stop at 'hard': grading expert puzzles of 625 cells takes minutes (30 × 30 hard: about 10 s).
// Wide grids (above 31 × 31) are 'easy' only: a 64 × 64 easy puzzle takes about 20 s, a 32 × 32 medium more than a
// minute (digging with locked candidates and pairs over 1000+ cells).
const BIG = 16;

// The hardest level offered for a grid size.
// The ceiling is measured run time of grading, not a theoretical limit: offering more would freeze the UI.
const maxLevelFor = (n) => (n <= BIG ? 7 : n <= WORD_N ? DIFFICULTIES.hard.max : DIFFICULTIES.easy.max);

// Difficulties offered for a grid size (ids of DIFFICULTIES, easiest first).
export const difficultiesFor = (n) => Object.keys(DIFFICULTIES).filter((d) => DIFFICULTIES[d].max <= maxLevelFor(n));

export function normalize(o = {}) {
  const v = variantOf(o.variant || 'classic');
  if (!v) throw new Error(`unknown variant ${o.variant}`);
  let n = Math.round(+o.n || 9);
  if (!(n >= MIN_N && n <= MAX_N)) throw new Error(`size must be ${MIN_N}..${MAX_N}`);
  let box;
  if (v.layout) {
    if (!layoutOK(v.layout, n)) n = 9;
    box = [Math.round(Math.sqrt(n)), Math.round(Math.sqrt(n))];
  } else if (v.shape === 'jigsaw') box = null;
  else if (o.box === 'none') box = null;
  else if (Array.isArray(o.box) && o.box[0] * o.box[1] === n) box = [o.box[0] | 0, o.box[1] | 0];
  else box = defaultBox(n);
  // a variant that needs boxes falls back to the default shape; one that cannot use this size fails
  if (!v.supports({ n, box }) && box === null && defaultBox(n) && v.supports({ n, box: defaultBox(n) })) box = defaultBox(n);
  if (!v.supports({ n, box: v.shape === 'jigsaw' ? null : box })) throw new Error(`variant ${v.id} does not support this size`);
  if (n > WORD_N && !wideOK(v)) throw new Error(`variant ${v.id} has clues: up to ${WORD_N} × ${WORD_N}`);
  const offered = difficultiesFor(n);
  // Precedence: (known difficulty that is not offered for this size || medium not offered) -> hardest offered; an
  // unknown id -> 'medium'. So 'expert' on 25 x 25 clamps to 'hard' (a test checks this).
  const difficulty = offered.includes(o.difficulty) ? o.difficulty : DIFFICULTIES[o.difficulty] || !offered.includes('medium') ? offered[offered.length - 1] : 'medium';
  const symmetry = SYMMETRIES.includes(o.symmetry) ? o.symmetry : 'rotational';
  const rules = [...new Set([...(v.rules || []), ...(o.rules || []).filter((r) => EXTRA_RULES.includes(r))])];
  const geom = makeGeometry({ n, box: v.shape === 'jigsaw' ? null : box, layout: v.layout || null, regions: v.shape === 'jigsaw' ? new Int32Array(n * n).map((_, i) => Math.floor(i / n)) : null });
  for (const r of rules) {
    if (!RULES[r]) throw new Error(`unknown rule ${r}`);
    if (n > WORD_N && !WIDE_RULES.has(r)) throw new Error(`rule ${r} works up to ${WORD_N} × ${WORD_N}`);
    if (!RULES[r].supports(v.shape === 'jigsaw' ? { ...geom, jigsaw: true } : geom)) throw new Error(`rule ${r} does not fit this grid`);
  }
  return { variant: v.id, n, box, difficulty, symmetry, rules };
}

// Cells that are given or removed together.
// Cells removed together keep the givens symmetric (the classic aesthetic); diagonal symmetry needs a square frame.
export function symmetryGroups(geom, sym) {
  const { rows, cols, present } = geom;
  const seen = new Uint8Array(geom.size);
  const out = [];
  for (const c of geom.cells) {
    if (seen[c]) continue;
    const r = Math.floor(c / cols), k = c % cols;
    let partner = -1;
    if (sym === 'rotational') partner = (rows - 1 - r) * cols + (cols - 1 - k);
    else if (sym === 'mirror') partner = r * cols + (cols - 1 - k);
    else if (sym === 'diagonal' && rows === cols) partner = k * cols + r;
    const g = [c];
    seen[c] = 1;
    if (partner >= 0 && partner !== c && present[partner] && !seen[partner]) { g.push(partner); seen[partner] = 1; }
    out.push(g);
  }
  return out;
}

// Node budget linear in cell count: enough for propagation-heavy searches, small enough that a bad region set is abandoned fast.
const budgetFor = (geom) => 300 + geom.cells.length * 6;

// Each attempt uses its own rng fork named by attempt index, so attempt k is identical regardless of what earlier
// attempts consumed: reproducible and independent of timing.
export function generate(options, rng, { onProgress = null, attempts = null } = {}) {
  const o = normalize(options);
  const v = variantOf(o.variant);
  const D = DIFFICULTIES[o.difficulty];
  const cells = v.layout ? 200 : o.n * o.n;
  const tries = attempts || Math.max(1, Math.round(D.tries * (cells <= 81 ? 1 : cells <= 144 ? 0.3 : 0.12)));
  let best = null;
  const progress = (phase, f) => onProgress && onProgress({ phase, fraction: f });
  for (let attempt = 0; attempt < tries * 2 + 4 && (!best || attempt < tries); attempt++) {
    const arng = rng.fork(`attempt ${attempt}`);
    const shape = { n: o.n, box: o.box, layout: v.layout || null, regions: null };
    // Negative rules are excluded when filling: the clues do not exist yet, so "no clue here" would forbid every relation.
    const rules = o.rules.filter((r) => !/-neg$/.test(r));
    // Big jigsaw grids: random regions are rarely fillable within a budget, so the grid comes first (boxes, or rows
    // when n has no box shape) and the regions are then bent around its numbers (regionsForSolution).
    const solutionFirst = v.shape === 'jigsaw' && o.n > JIGSAW_SOLUTION_FIRST && !!defaultBox(o.n);
    let preset = null;
    if (solutionFirst) {
      const box = defaultBox(o.n);
      let classic;
      try { classic = compile({ n: o.n, box, regions: box ? null : Array.from({ length: o.n * o.n }, (_, i) => Math.floor(i / o.n)), rules, clues: [], givens: [] }); } catch { continue; }
      preset = randomSolution(classic, arng.fork('solution'), { nodeLimit: budgetFor(classic.geom), tries: 12 });
      if (!preset) continue;
      shape.regions = Array.from(regionsForSolution(o.n, preset, arng.fork('regions'), box));
    } else if (v.shape === 'jigsaw') shape.regions = Array.from(randomRegions(o.n, arng.fork('regions'), defaultBox(o.n)));
    const base = { ...shape, rules, clues: [], givens: [] };
    let fillModel;
    try { fillModel = compile(base); } catch { continue; }
    progress('solution', attempt / tries);
    // jigsaw regions can be unsolvable: a few short searches, then new regions
    const solution = preset || randomSolution(fillModel, arng.fork('solution'), { nodeLimit: budgetFor(fillModel.geom), tries: v.shape === 'jigsaw' ? 4 : 12 });
    if (!solution) continue;
    const clues = v.clues ? v.clues({ solution, geom: fillModel.geom, n: o.n, rng: arng.fork('clues'), cfg: o }) : [];
    const puzzle = { ...base, rules: o.rules, clues, givens: Array.from(solution), variant: o.variant };
    const model = compile(puzzle);
    const checker = makeChecker(model, D.max);
    if (!checker.ok(solution)) continue; // the clues must hold for the solution (always true by construction)
    // 1. givens
    const groups = arng.fork('dig').shuffle(symmetryGroups(model.geom, o.symmetry));
    const givens = Int32Array.from(solution);
    digBatches(groups, givens, checker, (f) => progress('givens', (attempt + f) / tries));
    // 2. clues that are not needed
    if (v.prune && clues.length) {
      const order = arng.fork('prune').shuffle(clues.map((_, i) => i));
      const keep = new Set(clues.map((_, i) => i));
      let done = 0;
      for (const i of order) {
        keep.delete(i);
        const trial = { ...puzzle, clues: clues.filter((_, k) => keep.has(k)), givens: Array.from(givens) };
        const m = compile(trial);
        const ch = makeChecker(m, D.max);
        if (!ch.ok(givens)) keep.add(i);
        progress('clues', (attempt + ++done / order.length) / tries);
      }
      puzzle.clues = clues.filter((_, k) => keep.has(k));
    }
    puzzle.givens = Array.from(givens);
    const gradeModel = compile(puzzle);
    const r = createLogic(gradeModel).solve({ maxLevel: 6 });
    const level = r.solved ? r.level : 7;
    const result = { puzzle, solution: Array.from(solution), grade: { level, score: r.score, steps: r.steps.length, solved: r.solved } };
    const fits = level >= D.min && level <= D.max;
    const dist = level < D.min ? D.min - level : level > D.max ? level - D.max : 0;
    // Selection: closest to the difficulty band first; ties by hardest level (extreme) or by score.
    const better = !best || dist < best.dist || (dist === best.dist && (D.hardest && level !== best.result.grade.level ? level > best.result.grade.level : result.grade.score > best.result.grade.score));
    if (better) best = { result, dist };
    if (fits && !D.hardest) break;
  }
  if (!best) throw new Error('no puzzle could be made with these rules');
  progress('done', 1);
  const { result } = best;
  result.puzzle.difficulty = o.difficulty;
  result.puzzle.level = result.grade.level;
  return result;
}

// Accepts values (numbers per cell, 0 = empty) when they leave exactly one solution that the techniques up to
// `maxLevel` find (a logical solution is unique by itself). Fast paths: propagation (singles + every clue) solving
// the grid; without arithmetic clues propagation is exactly level 1, so failing it fails "easy"; a short exact search
// that finds two solutions rejects before the slower logical solver runs.
// Fast paths ordered by cost. Uniqueness is implied by a logical solve (deductions never branch), so the exact
// search is only a cheap early rejection with a small node budget.
function makeChecker(model, maxLevel) {
  const engine = makeEngine(model);
  const logic = maxLevel <= 6 ? createLogic(model) : null;
  const hard = model.cons.some((c) => c.house === undefined && c.level >= 2);
  const quick = 40 + model.geom.cells.length;
  const budget = budgetFor(model.geom) * 2;
  return {
    ok(values) {
      const start = startFor(model, values);
      const prop = start.slice();
      if (!engine.start(prop)) return false;
      const solvedByProp = model.wide ? solvedWide(model, prop) : model.geom.cells.every((c) => (prop[c] & (prop[c] - 1)) === 0);
      if (solvedByProp && (maxLevel >= 2 || !hard)) return true;
      if (!solvedByProp && maxLevel === 1 && !hard) return false;
      if (!logic) return isUnique(model, { start, nodeLimit: budget, engine });
      const r = solve(model, { limit: 2, start, nodeLimit: quick, engine });
      if (r.count >= 2 || (!r.aborted && r.count === 0)) return false;
      return logic.solve({ maxLevel, values }).solved;
    },
  };
}

// Removes groups of givens in batches; a batch that fails is split in halves (group testing), so the early, easy
// removals cost one check per batch and the result is still minimal for the checker.
// Group testing: try removing a chunk; if that fails, bisect. Assuming checker monotonicity (removing more givens
// never makes a puzzle easier or more unique), every group that stays is individually necessary.
function digBatches(groups, givens, checker, progress) {
  let done = 0;
  const total = groups.length;
  const tryRemove = (list) => {
    if (!list.length) return;
    const saved = list.map((g) => g.map((c) => givens[c]));
    for (const g of list) for (const c of g) givens[c] = 0;
    if (checker.ok(givens)) { done += list.length; progress(done / total); return; }
    list.forEach((g, i) => g.forEach((c, j) => { givens[c] = saved[i][j]; }));
    if (list.length === 1) { done++; progress(done / total); return; }
    const mid = list.length >> 1;
    tryRemove(list.slice(0, mid));
    tryRemove(list.slice(mid));
  };
  let chunk = Math.max(1, Math.floor(total / 3));
  for (let i = 0; i < total;) {
    const list = groups.slice(i, i + chunk);
    tryRemove(list);
    i += list.length;
    chunk = Math.max(1, Math.floor(chunk / 2));
  }
}

