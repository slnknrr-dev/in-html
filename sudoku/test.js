// sudoku/test.js - unit tests of the sudoku library: `node sudoku/test.js` (importing the module runs nothing).
// Known puzzles (solutions, counts, techniques, grades), generator determinism per seed, every variant generated and
// checked by an independent rule checker written here (not with the propagators under test), codes, boards,
// alphabets and the rooms game (coop and race with bots in local rooms).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seededRandom } from '../prng/prng.js';
import { compile } from './model.js';
import { solve, randomSolution } from './solver.js';
import { createLogic, grade } from './logic.js';
import { difficultiesFor, generate, normalize } from './generate.js';
import { VARIANTS, sizeProblem, sizesFor } from './variants.js';
import { bitsOf, fullMask, popcount, setBits, setFull, setHas, setMeet, setMinus, setSize, setUnion, setValid, setWith, setWithout } from './bits.js';
import { decodePuzzle, encodePuzzle, parseGrid } from './codec.js';
import { applyMove, applyPatch, newBoard } from './board.js';
import { keyMap, parseCustom, symbolsFor } from './symbols.js';
import { makeGeometry, regionsForSolution } from './geometry.js';
import { lineFrom, littleCells } from './clues.js';
import { puzzleSVG } from './svg.js';
import { game } from './game.js';
import { localRoom } from '../rooms/local.js';

// Runs only when executed directly, so a test aggregator can import run() without side effects.
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// Reference puzzles: a singles-only classic, puzzles that need x-wing / xy-wing, and Inkala's "hardest" puzzle (beyond the techniques).
const EASY = '53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79';
const EASY_SOL = '534678912672195348198342567859761423426853791713924856961537284287419635345286179';
const XWING = '1.....569492.561.8.561.924...964.8.1.64.1....218.356.4.4.5...169.5.614.2621.....5';
const XYWING = '9..24.....5.69.231.2..5..9..9.7..32...29356.7.7...29...69.2..7351..79.622.7.86..9';
const INKALA = '8..........36......7..9.2...5...7.......457.....1...3...1....68..85...1..9....4..';

// --- independent rule checker -----------------------------------------------------------------------------------

// Independent checker: re-implements every rule and clue directly over the solution numbers. Testing the generator
// with the propagators under test would only prove they agree with themselves.
function verify(p, sol) {
  const g = makeGeometry({ n: p.n, box: p.box, regions: p.regions, layout: p.layout });
  const { n, cols } = g;
  const errs = [];
  const distinct = (cells, what) => { const vs = cells.map((c) => sol[c]); if (new Set(vs).size !== vs.length) errs.push(what); };
  const all = (cells, what) => { distinct(cells, what); if (cells.length !== n || cells.some((c) => !(sol[c] >= 1 && sol[c] <= n))) errs.push(what + ' values'); };
  const rc = (r, c) => r * cols + c;
  for (const [r0, c0] of g.grids) {
    for (let i = 0; i < n; i++) {
      all(Array.from({ length: n }, (_, k) => rc(r0 + i, c0 + k)), 'row');
      all(Array.from({ length: n }, (_, k) => rc(r0 + k, c0 + i)), 'col');
    }
    if (p.box) {
      const [bw, bh] = p.box;
      for (let br = 0; br < n; br += bh) for (let bc = 0; bc < n; bc += bw) {
        const cells = [];
        for (let r = 0; r < bh; r++) for (let c = 0; c < bw; c++) cells.push(rc(r0 + br + r, c0 + bc + c));
        all(cells, 'box');
      }
    }
  }
  if (p.regions) for (let id = 0; id < n; id++) all(p.regions.map((x, i) => (x === id ? i : -1)).filter((i) => i >= 0), 'region');
  for (let i = 0; i < g.size; i++) if (g.present[i] && p.givens[i] && p.givens[i] !== sol[i]) errs.push('given');
  const R = new Set(p.rules || []);
  const at = (r, c) => (r >= 0 && c >= 0 && r < g.rows && c < cols && g.present[rc(r, c)] ? rc(r, c) : -1);
  const nb = (offs, fn) => { for (const i of g.cells) { const r = Math.floor(i / cols), c = i % cols; for (const [dr, dc] of offs) { const j = at(r + dr, c + dc); if (j >= 0) fn(i, j); } } };
  if (R.has('diagonal')) for (const [r0, c0] of g.grids) { all(Array.from({ length: n }, (_, k) => rc(r0 + k, c0 + k)), 'diag'); all(Array.from({ length: n }, (_, k) => rc(r0 + k, c0 + n - 1 - k)), 'anti-diag'); }
  if (R.has('windoku')) { const b = p.box[0]; for (let r0 = 1; r0 + b <= n; r0 += b + 1) for (let c0 = 1; c0 + b <= n; c0 += b + 1) { const cs = []; for (let r = 0; r < b; r++) for (let c = 0; c < b; c++) cs.push(rc(r0 + r, c0 + c)); all(cs, 'window'); } }
  if (R.has('disjoint')) { const [bw, bh] = p.box; for (let r = 0; r < bh; r++) for (let c = 0; c < bw; c++) { const cs = []; for (let br = 0; br < n; br += bh) for (let bc = 0; bc < n; bc += bw) cs.push(rc(br + r, bc + c)); all(cs, 'disjoint'); } }
  if (R.has('centerdot')) { const [bw, bh] = p.box; const cs = []; for (let br = 0; br < n; br += bh) for (let bc = 0; bc < n; bc += bw) cs.push(rc(br + (bh - 1) / 2, bc + (bw - 1) / 2)); all(cs, 'centerdot'); }
  if (R.has('asterisk')) all([[1, 4], [2, 2], [2, 6], [4, 1], [4, 4], [4, 7], [6, 2], [6, 6], [7, 4]].map(([r, c]) => rc(r, c)), 'asterisk');
  if (R.has('girandola')) all([[0, 0], [0, 8], [1, 4], [4, 1], [4, 4], [4, 7], [7, 4], [8, 0], [8, 8]].map(([r, c]) => rc(r, c)), 'girandola');
  if (R.has('antiknight')) nb([[1, 2], [2, 1], [-1, 2], [-2, 1]], (a, b) => { if (sol[a] === sol[b]) errs.push('knight'); });
  if (R.has('antiking')) nb([[1, 1], [1, -1]], (a, b) => { if (sol[a] === sol[b]) errs.push('king'); });
  if (R.has('nonconsecutive')) nb([[0, 1], [1, 0]], (a, b) => { if (Math.abs(sol[a] - sol[b]) === 1) errs.push('nonconsecutive'); });
  if (R.has('magic')) {
    const v = (r, c) => sol[rc(3 + r, 3 + c)];
    for (let i = 0; i < 3; i++) { if (v(i, 0) + v(i, 1) + v(i, 2) !== 15 || v(0, i) + v(1, i) + v(2, i) !== 15) errs.push('magic'); }
    if (v(0, 0) + v(1, 1) + v(2, 2) !== 15 || v(0, 2) + v(1, 1) + v(2, 0) !== 15) errs.push('magic diag');
  }
  const marked = new Map();
  const key = (a, b) => Math.min(a, b) + ',' + Math.max(a, b);
  const sum = (cells) => cells.reduce((s, c) => s + sol[c], 0);
  for (const cl of p.clues) {
    const v = cl.cells ? cl.cells.map((c) => sol[c]) : null;
    switch (cl.t) {
      case 'cage': distinct(cl.cells, 'cage'); if (sum(cl.cells) !== cl.sum) errs.push('cage sum'); break;
      case 'parity': if ((sol[cl.cell] % 2 === 1) !== cl.odd) errs.push('parity'); break;
      case 'kropki': { const x = sol[cl.a], y = sol[cl.b]; if (cl.k === 'w' ? Math.abs(x - y) !== 1 : x !== 2 * y && y !== 2 * x) errs.push('kropki'); marked.set(key(cl.a, cl.b), 'kropki'); break; }
      case 'xv': if (sol[cl.a] + sol[cl.b] !== (cl.k === 'x' ? 10 : 5)) errs.push('xv'); marked.set(key(cl.a, cl.b), 'xv'); break;
      case 'consec': if (Math.abs(sol[cl.a] - sol[cl.b]) !== 1) errs.push('consec'); marked.set(key(cl.a, cl.b), 'consec'); break;
      case 'gt': if (!(sol[cl.a] > sol[cl.b])) errs.push('gt'); break;
      case 'thermo': for (let i = 1; i < v.length; i++) if (!(v[i] > v[i - 1])) errs.push('thermo'); break;
      case 'arrow': if (v.slice(1).reduce((a, b) => a + b, 0) !== v[0]) errs.push('arrow'); break;
      case 'renban': if (new Set(v).size !== v.length || Math.max(...v) - Math.min(...v) !== v.length - 1) errs.push('renban'); break;
      case 'whisper': for (let i = 1; i < v.length; i++) if (Math.abs(v[i] - v[i - 1]) < Math.ceil(n / 2)) errs.push('whisper'); break;
      case 'dutch': for (let i = 1; i < v.length; i++) if (Math.abs(v[i] - v[i - 1]) < Math.floor(n / 2)) errs.push('dutch'); break;
      case 'palindrome': if (v.join() !== [...v].reverse().join()) errs.push('palindrome'); break;
      case 'parityline': for (let i = 1; i < v.length; i++) if ((v[i] + v[i - 1]) % 2 !== 1) errs.push('parityline'); break;
      case 'between': { const lo = Math.min(v[0], v[v.length - 1]), hi = Math.max(v[0], v[v.length - 1]); if (v.slice(1, -1).some((x) => x <= lo || x >= hi)) errs.push('between'); break; }
      case 'zipper': { const L = v.length; for (let i = 0; i < Math.floor(L / 2); i++) if (v[i] + v[L - 1 - i] !== (L % 2 ? v[(L - 1) / 2] : v[0] + v[L - 1])) errs.push('zipper'); break; }
      case 'entropic': { const c = (x) => Math.floor((x - 1) / (n / 3)); for (let i = 0; i + 2 < v.length; i++) if (new Set([c(v[i]), c(v[i + 1]), c(v[i + 2])]).size !== 3) errs.push('entropic'); break; }
      case 'modular': for (let i = 0; i + 2 < v.length; i++) if (new Set([v[i] % 3, v[i + 1] % 3, v[i + 2] % 3]).size !== 3) errs.push('modular'); break;
      case 'quad': { const four = [cl.cell, cl.cell + 1, cl.cell + cols, cl.cell + cols + 1].map((c) => sol[c]); const left = [...four]; for (const d of cl.digits) { const k = left.indexOf(d); if (k < 0) errs.push('quad'); else left.splice(k, 1); } break; }
      case 'sandwich': { const line = lineFrom(g, cl.side, cl.i).map((c) => sol[c]); const a = line.indexOf(1), b = line.indexOf(n); let s = 0; for (let i = Math.min(a, b) + 1; i < Math.max(a, b); i++) s += line[i]; if (s !== cl.sum) errs.push('sandwich'); break; }
      case 'sky': { let mx = 0, k = 0; for (const c of lineFrom(g, cl.side, cl.i)) if (sol[c] > mx) { mx = sol[c]; k++; } if (k !== cl.count) errs.push('sky'); break; }
      case 'xsum': { const line = lineFrom(g, cl.side, cl.i).map((c) => sol[c]); if (line.slice(0, line[0]).reduce((a, b) => a + b, 0) !== cl.sum) errs.push('xsum'); break; }
      case 'frame': { const line = lineFrom(g, cl.side, cl.i).map((c) => sol[c]); const k = cl.side === 'l' || cl.side === 'r' ? p.box[0] : p.box[1]; if (line.slice(0, k).reduce((a, b) => a + b, 0) !== cl.sum) errs.push('frame'); break; }
      case 'little': if (sum(littleCells(g, cl)) !== cl.sum) errs.push('little'); break;
      default: errs.push('unknown clue ' + cl.t);
    }
  }
  // negative rules: no relation where no clue is drawn
  const neg = { 'kropki-neg': ['kropki', (x, y) => Math.abs(x - y) === 1 || x === 2 * y || y === 2 * x], 'xv-neg': ['xv', (x, y) => x + y === 5 || x + y === 10], 'consec-neg': ['consec', (x, y) => Math.abs(x - y) === 1] };
  for (const [rule, [kind, rel]] of Object.entries(neg)) {
    if (!R.has(rule)) continue;
    nb([[0, 1], [1, 0]], (a, b) => { if (marked.get(key(a, b)) !== kind && rel(sol[a], sol[b])) errs.push(rule); });
  }
  return [...new Set(errs)];
}

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)?.slice(0, 400)}\n  want ${JSON.stringify(want)?.slice(0, 400)}`); }
  };
  const ok = (name, cond, info) => eq(name, cond ? true : info ?? false, true);
  const classic = (s) => compile(parseGrid(s));

  // --- exact solver -----------------------------------------------------------------------------------------------
  const r1 = solve(classic(EASY));
  eq('solves a known puzzle', [r1.count, r1.solution && Array.from(r1.solution).join('')], [1, EASY_SOL]);
  eq('hard puzzle is unique', solve(classic(INKALA)).count, 1);
  eq('two solutions are counted', solve(classic('.' + EASY.slice(1).replace(/[1-4]/g, '.'))).count, 2);
  eq('contradiction has none', solve(classic('55' + EASY.slice(2))).count, 0);
  for (const [n, box] of [[4, [2, 2]], [6, [3, 2]], [8, [4, 2]], [12, [4, 3]], [16, [4, 4]], [25, [5, 5]]]) {
    const sol = randomSolution(compile({ n, box, givens: [] }), seededRandom('fill' + n));
    ok(`random complete ${n}×${n}`, sol && verify({ n, box, givens: [], clues: [], rules: [] }, sol).length === 0);
  }

  // --- logical solver --------------------------------------------------------------------------------------------
  const techs = (s) => new Set(createLogic(classic(s)).solve({ maxLevel: 6 }).steps.map((x) => x.tech));
  eq('singles only', grade(classic(EASY)).level, 1);
  ok('x-wing found', techs(XWING).has('xWing'));
  ok('xy-wing found', techs(XYWING).has('xyWing'));
  eq('beyond the techniques', grade(classic(INKALA)).level, 7);
  const hint = createLogic(classic(EASY)).hint(parseGrid(EASY).givens);
  ok('hint is a placement', hint.type === 'step' && !!hint.step.place, hint);
  const wrongVals = parseGrid(EASY).givens.slice();
  wrongVals[2] = 1;
  eq('hint reports a wrong entry first', createLogic(classic(EASY)).hint(wrongVals, { solution: Array.from(r1.solution) }).cells, [2]);
  // every logical step is sound: the solution keeps all its candidates
  {
    const m = classic(XYWING), L = createLogic(m), st = L.stateFrom(), sol = solve(m).solution;
    let sound = true;
    for (let s; (s = L.next(st));) { L.apply(st, s); for (const c of m.geom.cells) if (!(st.cand[c] & (1 << (sol[c] - 1)))) sound = false; if (s.tech === 'contradiction') break; }
    ok('logical steps are sound', sound);
  }

  // --- generator ---------------------------------------------------------------------------------------------------
  const a = generate({ variant: 'classic', difficulty: 'medium' }, seededRandom('same-seed'));
  const b = generate({ variant: 'classic', difficulty: 'medium' }, seededRandom('same-seed'));
  const c = generate({ variant: 'classic', difficulty: 'medium' }, seededRandom('other-seed'));
  eq('same seed, same puzzle', encodePuzzle(a.puzzle), encodePuzzle(b.puzzle));
  ok('other seed, other puzzle', encodePuzzle(a.puzzle) !== encodePuzzle(c.puzzle));
  eq('generated puzzle is unique', solve(compile(a.puzzle)).count, 1);
  eq('generated solution matches', Array.from(solve(compile(a.puzzle)).solution), a.solution);
  const easy = generate({ variant: 'classic', difficulty: 'easy' }, seededRandom('e'));
  eq('easy needs only singles', grade(compile(easy.puzzle)).level, 1);
  const hard = generate({ variant: 'classic', difficulty: 'hard' }, seededRandom('h'));
  ok('hard needs more than pairs', grade(compile(hard.puzzle)).level >= 3, hard.grade);
  const sym = generate({ variant: 'classic', difficulty: 'easy', symmetry: 'rotational' }, seededRandom('sym'));
  ok('rotational symmetry of the givens', sym.puzzle.givens.every((v, i) => !!v === !!sym.puzzle.givens[80 - i]));
  for (const [n, box] of [[6, 'none'], [12, [6, 2]], [16, null]]) {
    const r = generate({ n, box, difficulty: 'easy' }, seededRandom('size' + n));
    ok(`size ${n} generates`, r.puzzle.n === n && solve(compile(r.puzzle)).count === 1 && verify(r.puzzle, r.solution).length === 0);
  }
  {
    // big jigsaw grids: the regions are bent around a complete grid (solution first)
    const r = generate({ variant: 'jigsaw', n: 16, difficulty: 'easy' }, seededRandom('jigsaw 16'));
    const boxes = Array.from({ length: 256 }, (_, i) => Math.floor(Math.floor(i / 16) / 4) * 4 + Math.floor((i % 16) / 4));
    ok('jigsaw 16: unique, rules hold', solve(compile(r.puzzle)).count === 1 && verify(r.puzzle, r.solution).length === 0);
    ok('jigsaw 16: irregular regions', r.puzzle.regions.some((x, i) => x !== boxes[i]));
    const sol = randomSolution(compile({ n: 9, box: [3, 3], givens: [] }), seededRandom('rfs'));
    const reg = regionsForSolution(9, sol, seededRandom('rfs regions'));
    ok('regions for a solution keep it valid', verify({ n: 9, box: null, regions: Array.from(reg), givens: [], clues: [], rules: [] }, sol).length === 0);
  }
  eq('difficulties of big grids', [difficultiesFor(16).length, difficultiesFor(25)], [5, ['easy', 'medium', 'hard']]);
  eq('too hard for the size is clamped', normalize({ n: 25, difficulty: 'expert' }).difficulty, 'hard');
  let threw = false;
  try { normalize({ variant: 'asterisk', n: 6 }); } catch { threw = true; }
  ok('impossible variant size is refused', threw);

  // every variant: unique, and the solution obeys the rules (independent checker)
  for (const v of VARIANTS) {
    const sizes = sizesFor(v.id);
    const n = sizes.includes(6) && !['magic'].includes(v.id) && v.id !== 'samurai' ? 6 : sizes.includes(9) ? 9 : sizes[0];
    for (const size of new Set([n, 9].filter((x) => sizes.includes(x)))) {
      let r;
      try { r = generate({ variant: v.id, n: size, difficulty: 'medium' }, seededRandom(`variant ${v.id} ${size}`)); } catch (e) { ok(`${v.id} ${size}: generates`, false, e.message); continue; }
      const m = compile(r.puzzle);
      const s = solve(m, { limit: 2 });
      eq(`${v.id} ${size}: unique`, s.count, 1);
      eq(`${v.id} ${size}: rules hold`, verify(r.puzzle, r.solution), []);
      eq(`${v.id} ${size}: code round trip`, encodePuzzle(decodePuzzle(encodePuzzle(r.puzzle))), encodePuzzle(r.puzzle));
      ok(`${v.id} ${size}: logical solution`, createLogic(m).solve({ maxLevel: 6 }).solved || r.grade.level === 7);
      ok(`${v.id} ${size}: svg`, puzzleSVG(r.puzzle, { symbols: symbolsFor('digits', size) }).startsWith('<svg'));
    }
  }
  // a broken rule is caught by the propagators: the solution with one swap must fail
  {
    const r = generate({ variant: 'thermo', difficulty: 'easy' }, seededRandom('thermo-break'));
    const th = r.puzzle.clues.find((x) => x.t === 'thermo');
    const vals = Array.from(r.solution);
    [vals[th.cells[0]], vals[th.cells[1]]] = [vals[th.cells[1]], vals[th.cells[0]]];
    eq('propagators reject a broken thermometer', solve(compile({ ...r.puzzle, givens: vals })).count, 0);
  }

  // --- wide grids (above 31 × 31: two words per cell) -------------------------------------------------------------
  {
    // sets (bits.js) against plain int32 masks for every size up to 31
    const rng = seededRandom('sets');
    let same = true;
    for (let k = 0; k < 400; k++) {
      const n = 4 + rng.int(28), full = fullMask(n);
      const a = rng.int(1 << 30) & full, b = rng.int(1 << 30) & full, v = rng.int(n);
      const want = [a | b, a & ~b, a & b, a | (1 << v), a & ~(1 << v), !!(a & (1 << v)), popcount(a), bitsOf(a)];
      const got = [setUnion(a, b), setMinus(a, b), setMeet(a, b), setWith(a, v), setWithout(a, v), setHas(a, v), setSize(a), setBits(a)];
      if (JSON.stringify(got) !== JSON.stringify(want) || !setValid(a, n) || setFull(n) !== full) { same = false; break; }
    }
    ok('sets match int32 masks up to 31', same);
    const big = setWith(setWith(0, 40), 3);
    eq('sets above 32', [setBits(big), setHas(big, 40), setHas(big, 8), setWithout(big, 40), setValid(big, 41), setValid(big, 40), setSize(setFull(64))], [[3, 40], true, false, 8, true, false, 64]);
    // the two-word solvers on small grids (compile(…, { wide: true })) find what the int32 solvers find
    for (const [name, s] of [['easy', EASY], ['inkala', INKALA], ['x-wing', XWING], ['xy-wing', XYWING]]) {
      const p = parseGrid(s), narrow = solve(compile(p)), wide = solve(compile(p, { wide: true }));
      eq(`two words solve ${name}`, [wide.count, Array.from(wide.solution || [])], [narrow.count, Array.from(narrow.solution || [])]);
      const ln = createLogic(compile(p)).solve({ maxLevel: 1 }), lw = createLogic(compile(p, { wide: true })).solve({ maxLevel: 1 });
      eq(`two words, same singles: ${name}`, lw.steps.map((x) => x.tech + x.place), ln.steps.map((x) => x.tech + x.place));
      const gn = createLogic(compile(p)).solve({ maxLevel: 2 }), gw = createLogic(compile(p, { wide: true })).solve({ maxLevel: 2 });
      eq(`two words, level 2: ${name}`, [gw.solved, gw.level], [gn.solved, gn.level]);
    }
    for (const [n, box] of [[16, [4, 4]], [25, [5, 5]], [30, [6, 5]]]) {
      const m = compile({ n, box, givens: [] }), mw = compile({ n, box, givens: [] }, { wide: true });
      eq(`two words fill ${n}×${n} like one`, Array.from(randomSolution(mw, seededRandom('fill' + n))), Array.from(randomSolution(m, seededRandom('fill' + n))));
    }
    {
      // medium puzzles: the wide logic (locked candidates, pairs) solves what the int32 logic solves, steps are sound
      const r = generate({ variant: 'classic', difficulty: 'medium' }, seededRandom('wide medium'));
      const mw = compile(r.puzzle, { wide: true }), L = createLogic(mw), st = L.stateFrom();
      let sound = true, lvl = 0;
      for (let s; (s = L.next(st, { maxLevel: 2 }));) {
        if (s.tech === 'contradiction') { sound = false; break; }
        L.apply(st, s); lvl = Math.max(lvl, s.level);
        for (const c of mw.geom.cells) if (!setHas(L.candOf(st, c), r.solution[c] - 1)) sound = false;
      }
      ok('two words: medium solved soundly', sound && mw.geom.cells.every((c) => st.val[c] === r.solution[c]) && lvl === 2, { sound, lvl });
    }
    // sizes above 25: generate, unique, valid, codes, alphabets
    for (const [n, extra] of [[26, {}], [30, {}], [30, { difficulty: 'medium' }], [32, {}], [36, {}], [37, {}], [49, {}], [36, { variant: 'diagonal' }], [40, { rules: ['antiknight'] }]]) {
      const opts = { n, difficulty: 'easy', ...extra };
      const r = generate(opts, seededRandom('big ' + n + JSON.stringify(extra)));
      const name = `${opts.variant || 'classic'} ${n}×${n}${extra.rules ? ' + ' + extra.rules : ''} ${opts.difficulty}`;
      ok(`${name}: rules hold`, r.puzzle.n === n && verify(r.puzzle, r.solution).length === 0);
      // a logical solution is unique by itself (the exact search is slow on sparse medium grids this big)
      const L = createLogic(compile(r.puzzle)).solve({ maxLevel: 2 });
      ok(`${name}: unique`, L.solved && r.puzzle.givens.length === r.solution.length && Array.from(L.state.val).every((v, i) => v === r.solution[i]) && (opts.difficulty === 'medium' || solve(compile(r.puzzle), { limit: 2 }).count === 1));
      ok(`${name}: logical`, r.grade.solved && r.grade.level <= (opts.difficulty === 'medium' ? 2 : 1), r.grade);
      const back = decodePuzzle(encodePuzzle(r.puzzle));
      eq(`${name}: code round trip`, [back.givens, back.box], [r.puzzle.givens, r.puzzle.box]);
      ok(`${name}: svg`, puzzleSVG(r.puzzle, { symbols: symbolsFor('digits', n) }).startsWith('<svg'));
      const hint = createLogic(compile(r.puzzle)).hint(r.puzzle.givens, { solution: r.solution });
      ok(`${name}: hint`, hint.type === 'step' && hint.step.place && r.solution[hint.step.place[0]] === hint.step.place[1], hint.type);
    }
    eq('prime 37 has no boxes', normalize({ n: 37 }).box, null);
    eq('difficulties above 31', [difficultiesFor(30), difficultiesFor(36), difficultiesFor(49)], [['easy', 'medium', 'hard'], ['easy'], ['easy']]);
    eq('size problems', [sizeProblem('classic', 64), sizeProblem('classic', 65), sizeProblem('killer', 20), sizeProblem('sandwich', 31), sizeProblem('sandwich', 32), sizeProblem('windoku', 49), sizeProblem('windoku', 50), sizeProblem('samurai', 16)],
      [null, 'range', 'variant', null, 'wide', null, 'variant', 'variant']);
    let refused = 0;
    for (const o of [{ variant: 'killer', n: 40 }, { variant: 'thermo', n: 36 }, { n: 36, rules: ['nonconsecutive'] }, { n: 65 }]) { try { normalize(o); } catch { refused++; } }
    eq('clues above 31 are refused', refused, 4);
    // codes: old ones still decode, big ones keep every number
    eq('old code decodes', decodePuzzle(encodePuzzle(parseGrid(EASY))).givens, parseGrid(EASY).givens);
    const g64 = Array.from({ length: 64 * 64 }, (_, i) => (i % 64 === Math.floor(i / 64) ? (i % 64) + 1 : 0));
    eq('64×64 code keeps 1..64', decodePuzzle(encodePuzzle({ n: 64, box: [8, 8], givens: g64 })).givens, g64);
    eq('64 digits', symbolsFor('digits', 64).map((s) => s.text).join(''), '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz@#&');
    const km = keyMap(symbolsFor('digits', 40));
    eq('case-sensitive keys above 35', [km.get('A'), km.get('a'), km.get('Z'), km.get('d')], [10, 36, 35, 39]);
    eq('25 digits unchanged', symbolsFor('digits', 25).map((s) => s.text).join(''), '123456789ABCDEFGHIJKLMNOP');
    // boards with marks above 32
    const ctx = { n: 40, size: 1600, givens: new Int32Array(1600), present: new Uint8Array(1600).fill(1), peers: [[1], [0]], autoNotes: true };
    const bd = newBoard(1600);
    applyMove(bd, { t: 'center', cells: [1], v: 38 }, ctx);
    applyMove(bd, { t: 'center', cells: [1], v: 2 }, ctx);
    eq('marks above 32', setBits(bd.center[1]), [1, 37]);
    const p = applyMove(bd, { t: 'value', cells: [0], v: 38 }, ctx);
    eq('value removes a mark above 32', bd.center[1], 2);
    applyPatch(bd, p);
    eq('undo restores a mark above 32', setBits(bd.center[1]), [1, 37]);
    ok('notes move with a wide mask', !!applyMove(bd, { t: 'notes', cells: [5], masks: [[1, 255]], kind: 'corner' }, ctx));
    eq('invalid wide mask refused', applyMove(bd, { t: 'notes', cells: [5], masks: [[1, 1 << 9]], kind: 'corner' }, ctx), null);
  }

  // --- codes ------------------------------------------------------------------------------------------------------
  let bad = 0;
  for (const code of ['', 'S1', 'S1!!!', 'X1abc', 'S1' + 'A'.repeat(40)]) { try { decodePuzzle(code); } catch { bad++; } }
  eq('damaged codes are refused', bad, 5);
  eq('classic text form', parseGrid(EASY).givens.filter(Boolean).length, 30);

  // --- boards -----------------------------------------------------------------------------------------------------
  {
    const m = classic(EASY);
    const ctx = { n: 9, size: 81, givens: m.givens, present: m.geom.present, peers: m.peers.map((x) => Array.from(x)), autoNotes: true };
    const bd = newBoard(81);
    applyMove(bd, { t: 'center', cells: [3, 11], v: 4 }, ctx);
    const p = applyMove(bd, { t: 'value', cells: [2], v: 4 }, ctx);
    eq('value removes peer marks', [bd.values[2], bd.center[3], bd.center[11]], [4, 0, 0]);
    applyPatch(bd, p);
    eq('undo restores', [bd.values[2], bd.center[3], bd.center[11]], [0, 8, 8]);
    eq('givens cannot change', applyMove(bd, { t: 'value', cells: [0], v: 1 }, ctx), null);
    eq('invalid move refused', applyMove(bd, { t: 'value', cells: [2], v: 10 }, ctx), null);
  }

  // --- alphabets --------------------------------------------------------------------------------------------------
  eq('custom by characters', parseCustom('ABCD', 4).ok, true);
  eq('custom by words', parseCustom('one two three four', 4).symbols, ['one', 'two', 'three', 'four']);
  eq('custom duplicates', parseCustom('AABC', 4).error, 'duplicate');
  eq('custom count', parseCustom('ABC', 4).error, 'count');
  eq('emoji graphemes', parseCustom('🍎🍊🍋🍇', 4).count, 4);
  eq('keys of letters', keyMap(symbolsFor('latin', 9)).get('c'), 3);
  eq('digits as keys', keyMap(symbolsFor('greek', 9)).get('2'), 2);
  eq('16 symbols', symbolsFor('digits', 16).map((s) => s.text).join(''), '123456789ABCDEFG');

  // --- rooms game ---------------------------------------------------------------------------------------------------
  {
    const code = encodePuzzle(generate({ n: 4, difficulty: 'easy' }, seededRandom('room')).puzzle);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const coop = localRoom(game, { mode: 'coop', puzzle: code }, { seats: 2, bots: [{ seat: 1, kind: 'quick' }], botDelay: 1, random: { kind: 'seeded', seed: 'coop' } });
    for (let i = 0; i < 400 && coop.status === 'playing'; i++) await wait(2);
    eq('coop: a bot completes the grid', coop.result && coop.result.solved, true);
    const race = localRoom(game, { mode: 'race', puzzle: code }, { seats: 3, seat: 0, bots: [{ seat: 1, kind: 'quick' }, { seat: 2, kind: 'relaxed' }], botDelay: 1, random: { kind: 'seeded', seed: 'race' } });
    eq('race: own board only', race.view.boards, undefined);
    for (let i = 0; i < 600 && race.status === 'playing'; i++) await wait(2);
    ok('race: a winner', race.result && (race.result.winner === 1 || race.result.winner === 2), race.result);
    const solo = localRoom(game, { mode: 'coop', puzzle: code, hints: true }, { seats: 1 });
    const empty = solo.view.board.values.findIndex((v, i) => !v && !decodePuzzle(code).givens[i]);
    eq('reveal', (await solo.act({ type: 'reveal', cell: empty })).ok, true);
    eq('bad action', (await solo.act({ type: 'move', move: { t: 'value', cells: [999], v: 1 } })).ok, false);
    let refused = false;
    try { game.create({ puzzle: encodePuzzle({ n: 4, box: [2, 2], givens: new Array(16).fill(0), clues: [], rules: [] }) }, seededRandom('x')); } catch { refused = true; }
    ok('rooms refuse puzzles without a unique solution', refused);
    coop.leave(); race.leave(); solo.leave();
  }

  console.log(`sudoku: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
