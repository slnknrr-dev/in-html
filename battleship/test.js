// battleship/test.js - tests of the Sea Battle library: `node battleship/test.js [--long]` (importing the module runs
// nothing). Rulesets (normalisation, validation, hashes, shapes and their orientations), the geometry and placements,
// layouts and every placement strategy, the engine move by move (turns, a shot again after a hit, sinking, the halo,
// secret sinkings, salvos, volleys, radar, air strike, cluster bomb, mines, resigning, teams, hidden fleets in views,
// undo), the solver (Monte-Carlo fleets against exact enumeration, counts, the endgame), full bot games on every preset
// with every personality (no illegal decision, every game finished, determinism per seed), a small simulation (win
// rates against the reference), the notation (SBN round trips, public replays, the bits of the answers), the style
// analysis and achievements, a local room and a networked game through rooms/server.js.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeRuleset, validateBasics, orientations, shapeById, cellName, parseCell, playerRange, rulesetHash } from './ruleset.js';
import { PRESETS, presetById } from './presets.js';
import { geometry, haloOf } from './board.js';
import { validateLayout, validateRuleset, randomLayout, STRATEGIES, layoutFeatures, encodeLayout, decodeLayout, occupancy } from './placement.js';
import { newGame, apply, viewOf, actors, dueFor, targets, undo, weaponCells } from './engine.js';
import { boardKnowledge, knowledgeAt } from './knowledge.js';
import { sample, enumerate, estimateLog2, density, endgame } from './solver.js';
import { BOT_KINDS, TEMPLATES, decide, makeBot, profileOf, placeAction } from './bots.js';
import { encode, parse, replay, analyze, startEntropy, decisions } from './notation.js';
import { compare, features, gameSummary, newAchievements, newCounters, observe, observePlacement, traitsOf, ACHIEVEMENTS } from './analysis.js';
import { game, hydrate, rulesetOf } from './game.js';
import { ratingOf, REF } from './sim.js';
import { playGame, searchShots } from './match.js';
import { seededRandom } from '../prng/prng.js';
import { localRoom } from '../rooms/local.js';

//
// Test strategy: hand-built positions for exact rule checks (setup + fixed fleets), seeded full games for
// invariants (no illegal decision, every game finishes, same seed -> same game), and statistical checks with loose
// thresholds (sampler vs exact enumeration, bots vs reference) that are robust to noise yet catch real regressions.
// --long enlarges the statistical runs. Laps print where time goes, so a slow regression is visible at once.
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// A position built by hand: fleets given as lists of ship entries per seat.
function setup(raw, fleets, { first = 0, mines = [] } = {}) {
  const rs = normalizeRuleset(raw);
  let s = newGame(rs, { players: fleets.length, first });
  fleets.forEach((ships, i) => {
    const r = apply(s, i, { type: 'place', ships, mines: mines[i] || [] });
    if (r.error) throw new Error('setup: ' + r.error);
    s = r.state;
  });
  return s;
}

// The classic fleet at known places: a four-decker on row 1, three-deckers, two-deckers and boats spread out.
// A legal classic layout (no touching), written by hand so tests can name the exact cells that hold ships.
const CLASSIC_FLEET = [
  { t: 0, o: 0, x: 0, y: 0 }, // I4 a1-d1
  { t: 1, o: 0, x: 6, y: 0 }, { t: 1, o: 1, x: 0, y: 2 }, // I3 g1-i1, a3-a5
  { t: 2, o: 0, x: 3, y: 3 }, { t: 2, o: 1, x: 9, y: 3 }, { t: 2, o: 0, x: 5, y: 6 }, // I2
  { t: 3, o: 0, x: 2, y: 8 }, { t: 3, o: 0, x: 9, y: 9 }, { t: 3, o: 0, x: 7, y: 8 }, { t: 3, o: 0, x: 0, y: 9 }, // I1
];
const c = (rs, name) => parseCell(rs, name);

export async function run({ long = false } = {}) {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const ok = (name, cond, info) => eq(name, cond ? true : info ?? false, true);
  const t0 = Date.now();
  let tl = t0, last = 'start';
  const laps = [];
  const lap = (name) => { laps.push(`${last} ${((Date.now() - tl) / 1000).toFixed(1)}s`); tl = Date.now(); last = name; };

  lap('rulesets');
  // --- rulesets ----------------------------------------------------------------------------------------------------
  {
    for (const p of PRESETS) {
      const v = validateRuleset(p);
      ok(`preset ${p.id} validates`, v.ok, v.errors);
    }
    eq('preset ids are unique', new Set(PRESETS.map((p) => p.id)).size, PRESETS.length);
    const a = normalizeRuleset(presetById('classic'));
    eq('classic: ten ships, twenty cells', [a.ships.length, a.cellCount], [10, 20]);
    eq('classic: the largest ship first', a.ships.map((t) => a.types[t].size), [4, 3, 3, 2, 2, 2, 1, 1, 1, 1]);
    eq('the hash ignores names', rulesetHash({ ...presetById('classic'), name: 'Other', description: 'x' }), a.hash);
    ok('the hash follows the rules', rulesetHash({ ...presetById('classic'), rules: { ...presetById('classic').rules, touch: 'corners' } }) !== a.hash);
    eq('orientations: I4, L4, T4, S4, O4, X5', ['I4', 'L4', 'T4', 'S4', 'O4', 'X5'].map((id) => orientations(shapeById(id)).length), [2, 8, 4, 4, 1, 1]);
    eq('orientations: no mirror', orientations({ cells: [[0, 0], [0, 1], [0, 2], [1, 2]], rotate: true, mirror: false }).length, 4);
    eq('cell names', [cellName(a, 0), cellName(a, 99), parseCell(a, 'e5'), parseCell(a, 'k1'), parseCell(a, 'a11')], ['a1', 'j10', 44, -1, -1]);
    const bad = validateBasics({ board: { width: 3, height: 30 }, shapes: [{ id: 'Z', cells: [[0, 0], [2, 2]] }], fleet: [{ shape: 'nope' }] });
    ok('validation: sides, unconnected shape, unknown shape', !bad.ok && ['board.width', 'board.height', 'shapes[0].cells', 'fleet[0].shape'].every((p) => bad.errors.some((e) => e.path === p)), bad.errors);
    const crowded = validateRuleset({ board: { width: 6, height: 6 }, fleet: [{ shape: 'I5', count: 4 }], rules: { touch: 'none' } });
    ok('validation: a fleet that does not fit', !crowded.ok && crowded.errors.some((e) => e.path === 'fleet'), crowded.errors);
    eq('players: free-for-all, teams', [playerRange(normalizeRuleset(presetById('ffa'))), playerRange(normalizeRuleset(presetById('teams')))], [{ min: 3, max: 4 }, { min: 4, max: 4 }]);
  }

  lap('geometry');
  // --- geometry and layouts ----------------------------------------------------------------------------------------
  {
    const rs = normalizeRuleset(presetById('classic'));
    const G = geometry(rs);
    eq('placements of I4, I3, I2, I1 on 10 × 10', G.types.map((T) => T.P), [140, 160, 180, 100]);
    eq('the zone of a corner boat (touch none)', G.types[3].zone[G.types[3].at(0, 0, 0)].length, 4);
    eq('the halo of a ship in the corner', haloOf(G, [0, 1, 2, 3]).length, 6);
    const isl = normalizeRuleset(presetById('ex-archipelago'));
    const GI = geometry(isl);
    ok('islands take no ships', GI.types.every((T) => { for (let p = 0; p < T.P; p++) for (let k = 0; k < T.size; k++) if (GI.obstacle[T.cells[p * T.size + k]]) return false; return true; }));
    eq('a valid layout', validateLayout(rs, { ships: CLASSIC_FLEET, mines: [] }).ok, true);
    const touching = CLASSIC_FLEET.map((s, i) => (i === 9 ? { t: 3, o: 0, x: 1, y: 7 } : s)); // b8 touches c9 at a corner
    eq('touching corners are refused (touch none)', validateLayout(rs, { ships: touching }).error, 'ships touch');
    const rc = normalizeRuleset({ ...presetById('classic'), rules: { ...presetById('classic').rules, touch: 'corners' } });
    eq('touching corners are fine (touch corners)', validateLayout(rc, { ships: touching }).ok, true);
    eq('a missing ship', validateLayout(rs, { ships: CLASSIC_FLEET.slice(1) }).error, 'the fleet does not match the rules');
    const ar = normalizeRuleset(presetById('ex-arsenal'));
    eq('mines on a ship are refused', validateLayout(ar, { ships: CLASSIC_FLEET, mines: [0, 50] }).error, 'a mine lies on a ship');
    eq('mines must be complete', validateLayout(ar, { ships: CLASSIC_FLEET, mines: [50] }).error, 'wrong number of mines');
    const rng = seededRandom('layouts');
    let allOk = true;
    const feat = {};
    for (const p of PRESETS) {
      const r = normalizeRuleset(p);
      for (const st of STRATEGIES) {
        const L = randomLayout(r, rng, { strategy: st, strength: 0.6 });
        if (!validateLayout(r, L).ok) allOk = false;
      }
    }
    ok('every strategy gives legal layouts on every preset', allOk);
    for (const st of ['edges', 'uniform', 'sea']) {
      let e = 0;
      for (let k = 0; k < 12; k++) e += layoutFeatures(rs, randomLayout(rs, rng, { strategy: st, strength: 1 })).edge;
      feat[st] = e / 12;
    }
    ok('edges > uniform > open sea (share of cells on the edge)', feat.edges > feat.uniform && feat.uniform > feat.sea, feat);
    const L = randomLayout(ar, rng);
    eq('layout text round trip', decodeLayout(ar, encodeLayout(ar, L)), { ships: L.ships, mines: L.mines });
    const occ = occupancy(rs);
    ok('uniform layouts: corners are likelier than the centre (no touching)', occ[0] > occ[44], [occ[0], occ[44]]);
    const same = JSON.stringify(randomLayout(rs, seededRandom('x'))) === JSON.stringify(randomLayout(rs, seededRandom('x')));
    ok('a seed gives the same layout', same);
  }

  lap('engine');
  // --- the engine --------------------------------------------------------------------------------------------------
  {
    const raw = presetById('classic');
    const rs = normalizeRuleset(raw);
    let s = setup(raw, [CLASSIC_FLEET, CLASSIC_FLEET], { first: 0 });
    eq('battle starts with the first seat', [s.phase, s.turn], ['battle', 0]);
    const fire = (seat, target, names) => apply(s, seat, { type: 'fire', target, cells: names.map((n) => c(rs, n)) });
    let r = fire(1, 0, ['a1']);
    eq('not your turn', r.error, 'not-your-turn');
    r = fire(0, 1, ['e5']);
    eq('a miss passes the turn', [r.error, r.state.turn, r.state.boards[1].marks[c(rs, 'e5')]], [null, 1, 1]);
    s = r.state;
    r = fire(1, 0, ['a1']);
    eq('a hit earns another shot', [r.state.turn, r.state.boards[0].marks[0]], [1, 2]);
    s = r.state;
    eq('a cell is shot once', fire(1, 0, ['a1']).error, 'cell-not-free');
    for (const n of ['b1', 'c1']) s = fire(1, 0, [n]).state;
    r = fire(1, 0, ['d1']);
    const b0 = r.state.boards[0];
    eq('sunk: the ship is shown', [0, 1, 2, 3].map((x) => b0.marks[x]), [3, 3, 3, 3]);
    eq('sunk: the halo is marked', [c(rs, 'e1'), c(rs, 'a2'), c(rs, 'e2')].map((x) => b0.marks[x]), [4, 4, 4]);
    eq('sunk: announced in the log', r.events.find((e) => e[0] === 'S')[4], 2);
    s = r.state;
    // views: own fleet only, spectators nothing
    const v1 = viewOf(s, 1);
    ok('a view shows the own fleet and hides the other', v1.boards[1].ships && !v1.boards[0].ships && !v1.boards[0].mines);
    ok('a spectator sees no fleet', viewOf(s, -1).boards.every((b) => !b.ships));
    eq('views show the sunk ship to everybody', viewOf(s, -1).boards[0].sunk.length, 1);
    // undo: the position before seat 1's last shot
    const u = undo(s, 1);
    eq('undo: the last shot is taken back', [u.boards[0].marks[3], u.turn], [0, 1]);
    // the whole fleet: elimination and the result
    let t = setup(raw, [CLASSIC_FLEET, CLASSIC_FLEET], { first: 0 });
    const cells = CLASSIC_FLEET.flatMap((sh) => validateLayout(rs, { ships: CLASSIC_FLEET }).ships.find((x) => x.t === sh.t && x.x === sh.x && x.y === sh.y && x.o === sh.o).cells);
    for (const x of cells) { const q = apply(t, 0, { type: 'fire', target: 1, cells: [x] }); if (q.error) { ok('fleet sinks', false, q.error); break; } t = q.state; }
    eq('the last ship ends the game', [t.phase, t.result.winners, t.result.shots[0]], ['over', [0], 20]);
    ok('the end opens every fleet', viewOf(t, -1).boards.every((b) => b.ships));
    // secret sinkings and announced types
    const hb = normalizeRuleset(presetById('hasbro'));
    const HF = [{ t: 0, o: 0, x: 0, y: 0 }, { t: 1, o: 0, x: 0, y: 1 }, { t: 2, o: 0, x: 0, y: 2 }, { t: 3, o: 0, x: 0, y: 3 }, { t: 4, o: 0, x: 0, y: 4 }];
    let h = setup(hb, [HF, HF]);
    for (const n of ['a5', 'b6']) h = apply(h, h.turn, { type: 'fire', target: 1 - h.turn, cells: [c(hb, n)] }).state;
    const hs = apply(h, 0, { type: 'fire', target: 1, cells: [c(hb, 'b5')] });
    const se = hs.events.find((e) => e[0] === 'S');
    eq('Hasbro: the type is named, the cells are not', [se[4], se[5], se[6] ?? null, hs.state.boards[1].marks[c(hb, 'a5')]], [2, 4, null, 2]);
    const fog = normalizeRuleset(presetById('fog'));
    let f = setup(fog, [CLASSIC_FLEET, CLASSIC_FLEET]);
    f = apply(f, 0, { type: 'fire', target: 1, cells: [c(fog, 'j10')] }).state;
    eq('fog: a sunk boat answers only "hit", nothing is marked', [f.log.find((e) => e[0] === 'S')[4], f.boards[1].marks.filter((m) => m === 4).length, viewOf(f, 0).boards[1].sunk.length], [1, 0, 0]);
    // salvo: one shot per ship afloat
    const sv = normalizeRuleset(presetById('salvo'));
    let g = setup(sv, [HF, HF]);
    eq('salvo: five shots with five ships', dueFor(g, 0, 1), 5);
    eq('salvo: the wrong number of shots', apply(g, 0, { type: 'fire', target: 1, cells: [10, 11] }).error, 'wrong-number-of-shots');
    g = apply(g, 0, { type: 'fire', target: 1, cells: [40, 41, 50, 60, 70] }).state;
    eq('salvo: the turn passes', g.turn, 1);
    g = apply(g, 1, { type: 'fire', target: 0, cells: [c(sv, 'a5'), c(sv, 'b5'), 80, 90] }).state; // seat 1 lost its destroyer: four shots
    eq('salvo: a lost ship costs a shot', dueFor(g, 0, 1), 4);
    const vo = normalizeRuleset(presetById('volley'));
    eq('volley: three shots', dueFor(setup(vo, [HF.map((x, i) => ({ ...x, y: x.y * 2 }))].concat([HF.map((x) => ({ ...x, y: x.y * 2 }))])), 0, 1), 3);
    // weapons and mines
    const am = normalizeRuleset(presetById('ex-arsenal'));
    let w = setup(am, [CLASSIC_FLEET, CLASSIC_FLEET], { mines: [[c(am, 'e9'), c(am, 'h6')], [c(am, 'e9'), c(am, 'h6')]] });
    let wr = apply(w, 0, { type: 'radar', target: 1, cell: c(am, 'b2') });
    eq('radar: ship cells in the 3 × 3 square (a1 b1 c1 a3)', wr.events.find((e) => e[0] === 'R')[4], 4);
    eq('radar: the turn passes, a charge is used', [wr.state.turn, wr.state.charges[0].radar], [1, 1]);
    w = wr.state;
    wr = apply(w, 1, { type: 'airstrike', target: 0, cell: c(am, 'g1'), dir: 'h' });
    eq('air strike: four cells of the row', wr.events.filter((e) => e[0] === 'S').map((e) => [cellName(am, e[3]), e[4]]), [['g1', 1], ['h1', 1], ['i1', 2], ['j1', 0]]);
    eq('air strike: hits earn another turn, one charge only', apply(wr.state, 1, { type: 'airstrike', target: 0, cell: 0, dir: 'v' }).error, 'no-charges');
    w = wr.state;
    eq('cluster cells (a cross, clipped)', weaponCells(am, 'cluster', 0).length, 3);
    wr = apply(w, 1, { type: 'fire', target: 0, cells: [c(am, 'e9')] });
    const k = wr.events.find((e) => e[0] === 'K');
    eq('a mine strikes back at the same cell of the shooter', [wr.events.find((e) => e[0] === 'S')[4], k && k[2], k && cellName(am, k[3]), wr.state.turn], [3, 1, 'e9', 0]);
    // teams: targets are the other team only
    const tm = normalizeRuleset(presetById('teams'));
    const TF = randomLayout(tm, seededRandom('tf'));
    const ts = setup(tm, [TF.ships, TF.ships, TF.ships, TF.ships], { first: 0 });
    eq('teams: seat 0 fires at seats 1 and 3', targets(ts, 0), [1, 3]);
    eq('teams: a partner is no target', apply(ts, 0, { type: 'fire', target: 2, cells: [5] }).error, 'bad-target');
    // resigning
    const rz = apply(setup(raw, [CLASSIC_FLEET, CLASSIC_FLEET]), 1, { type: 'resign' });
    eq('resigning ends a duel', [rz.state.phase, rz.state.result.winners], ['over', [0]]);
    eq('placing twice is refused', apply(newGame(rs, { players: 2 }), 0, { type: 'fire', target: 1, cells: [1] }).error, 'placing');
  }

  lap('solver');
  // Sampler validation: on positions small enough to enumerate, the Monte-Carlo occupancy must match the exact one
  // within a tolerance; this is the test that would catch a non-uniform Gibbs move (a broken detailed balance).
  // --- the solver --------------------------------------------------------------------------------------------------
  let simGames = 0, simIllegal = 0, simUnfinished = 0;
  {
    let worst = 0, n = 0, knuth = 0;
    for (const id of ['mini-6', 'quick-8', 'hasbro', 'fog', 'ex-tetromino']) {
      const rs = normalizeRuleset(presetById(id));
      const rng = seededRandom('cmp-' + id);
      let s = newGame(rs, { players: 2, rng });
      const P = profileOf('hunter', { level: 2 });
      let steps = 0;
      while (s.phase !== 'over' && steps < 600) {
        const seat = actors(s)[0];
        const v = viewOf(s, seat);
        s = apply(s, seat, s.phase === 'place' ? placeAction(v, seat, rng, P) : decide(v, seat, rng, P)).state;
        steps++;
        if (s.phase !== 'battle' || steps % 9) continue;
        const K = boardKnowledge(viewOf(s, 0), 1);
        const ex = enumerate(K, { budget: 150000 });
        if (!ex.complete || ex.count < 4) continue;
        const st = sample(K, seededRandom('s' + steps), { samples: 2000, chains: 6, burn: 10, exact: 0 });
        let d = 0;
        for (let x = 0; x < K.N; x++) d = Math.max(d, Math.abs(st.occ[x] / st.n - ex.occ[x] / ex.count));
        worst = Math.max(worst, d); n++;
        const est = estimateLog2(K, seededRandom('k' + steps), 1500, 1);
        if (Number.isFinite(est.log2)) knuth = Math.max(knuth, Math.abs(est.log2 - Math.log2(ex.count)));
      }
    }
    ok(`solver: Monte-Carlo fleets match the exact enumeration (${n} positions, worst ${worst.toFixed(3)})`, n >= 8 && worst < 0.07, { n, worst });
    ok(`solver: Knuth's estimate of the number of fleets (worst ${knuth.toFixed(2)} bits)`, knuth < 4, knuth);
    const rs = normalizeRuleset(presetById('classic'));
    let s = setup(presetById('classic'), [CLASSIC_FLEET, CLASSIC_FLEET]);
    s = apply(s, 0, { type: 'fire', target: 1, cells: [c(rs, 'g1')] }).state;
    const K = boardKnowledge(viewOf(s, 0), 1);
    const d = density(K);
    ok('density: a hit draws its neighbours', d[c(rs, 'h1')] > 3 * d[c(rs, 'e5')], [d[c(rs, 'h1')], d[c(rs, 'e5')]]);
    const st = sample(K, seededRandom('x'), { samples: 600 });
    ok('Monte Carlo: beside a hit likely ships, its corners certainly water', st.occ[c(rs, 'h1')] / st.n > 0.3 && st.occ[c(rs, 'g2')] / st.n > 0.15 && st.occ[c(rs, 'h2')] === 0, [st.occ[c(rs, 'h1')] / st.n, st.occ[c(rs, 'g2')] / st.n, st.occ[c(rs, 'h2')]]);
    // a tiny endgame: a two-cell ship left in b2-c2 or c2-c3 (everything else is water): c2 is certain, then a coin
    // flip: 1 + ½ · 1 + ½ · 2 = 2.5 shots
    const mini = normalizeRuleset({ board: { width: 4, height: 4 }, fleet: [{ shape: 'I2', count: 1 }], rules: { touch: 'none' } });
    const marks = new Array(16).fill(1);
    for (const x of [5, 6, 10]) marks[x] = 0;
    const Km = boardKnowledge({ rs: mini, boards: [{ marks, sunk: [] }], scans: [], log: [] }, 0);
    const ex = enumerate(Km, { keep: 64 });
    const eg = endgame(Km, ex.configs, { objective: 'shots' });
    eq('endgame: the expectimax of a two-placement position', [ex.count, eg && eg.cell, eg && eg.value], [2, 6, 2.5]);
    const egm = endgame(Km, ex.configs, { objective: 'misses' });
    eq('endgame: with a shot again after a hit only misses count', egm && egm.value, 0.5);
  }

  lap('bots');
  // --- bots --------------------------------------------------------------------------------------------------------
  {
    const levels = long ? [1, 2, 3, 4] : [1, 2, 3, 2];
    for (const p of PRESETS) {
      const pr = playerRange(normalizeRuleset(p));
      const rounds = long ? 3 : 1;
      for (let k = 0; k < rounds; k++) {
        for (let g = 0; g < TEMPLATES.length; g += 4) {
          const n = Math.min(pr.max, pr.min + ((g / 4 + k) % 2));
          const seats = Array.from({ length: n }, (_, i) => ({ kind: TEMPLATES[(g + i) % TEMPLATES.length].id, level: levels[(g + i + k) % 4] }));
          const r = playGame({ rs: normalizeRuleset(p), seats, seed: `bots-${p.id}-${g}-${k}` });
          simGames++;
          simIllegal += r.illegal;
          if (!r.over) simUnfinished++;
        }
      }
    }
    // the full Expert budget once in the quick run
    const ex = playGame({ rs: normalizeRuleset(presetById('classic')), seats: [{ kind: 'admiral', level: 4 }, { kind: 'scholar', level: 4 }], seed: 'bots-expert' });
    simGames++; simIllegal += ex.illegal; if (!ex.over) simUnfinished++;
    eq('bots: never an illegal decision', simIllegal, 0);
    eq('bots: every game finished', simUnfinished, 0);
    const rs = normalizeRuleset(presetById('hasbro'));
    const seats = [{ kind: 'statistician', level: 3 }, { kind: 'corsair', level: 2 }];
    const a = playGame({ rs, seats, seed: 'det' }), b = playGame({ rs, seats, seed: 'det' }), c2 = playGame({ rs, seats, seed: 'det2' });
    eq('bots: same seed, same game', JSON.stringify(a.result) + a.actions, JSON.stringify(b.result) + b.actions);
    ok('bots: another seed, another game', JSON.stringify(a.result) + a.actions !== JSON.stringify(c2.result) + c2.actions);
    const P = profileOf('custom', { level: 4, method: 'information', placement: 'edges', targeting: 'revenge', traits: { curiosity: 1, trigger: 0 } });
    ok('bots: a constructed profile', P.kind === 'custom' && P.method === 'information' && P.placement === 'edges' && P.traits.curiosity === 1 && P.samples === 800, P);
    eq('bots: the level sets the sampling', [1, 2, 3, 4].map((l) => profileOf('statistician', { level: l }).samples), [0, 120, 300, 800]);
    ok('bots: kinds for rooms', BOT_KINDS.length === TEMPLATES.length + 1);
    // searches: a sampling shooter needs fewer shots than random fire
    const cl = normalizeRuleset(presetById('classic'));
    let sMc = 0, sRnd = 0;
    for (let i = 0; i < 6; i++) {
      sMc += searchShots({ rs: cl, strategy: 'uniform', shooter: { kind: 'statistician', level: 3 }, seed: 'sh' + i }).shots;
      sRnd += searchShots({ rs: cl, strategy: 'uniform', shooter: { kind: 'custom', level: 3, options: { method: 'random', traits: { discipline: 0 } } }, seed: 'sh' + i }).shots;
    }
    ok(`bots: Monte-Carlo search beats random fire (${(sMc / 6).toFixed(1)} against ${(sRnd / 6).toFixed(1)} shots)`, sMc < sRnd * 0.88, [sMc, sRnd]);
  }

  lap('simulation');
  // Directional check only (a strong bot must beat a weak one against the same reference), since 16 games cannot
  // measure ratings precisely; the Elo mapping itself is checked at exact points (0.5 -> 1500, 0.909 -> ~1900).
  // --- a small simulation: win rates against the reference -----------------------------------------------------------
  {
    const rs = normalizeRuleset(presetById('quick-8'));
    const rate = (seat) => {
      let w = 0;
      const games = long ? 60 : 16;
      for (let i = 0; i < games; i++) {
        const order = i % 2 ? [REF, seat] : [seat, REF];
        const r = playGame({ rs, seats: order, seed: 'sim-' + i });
        simGames++; simIllegal += r.illegal; if (!r.over) simUnfinished++;
        if (!r.result.draw && r.result.winners.includes(i % 2 ? 1 : 0)) w++;
      }
      return w / games;
    };
    const rookie = rate({ kind: 'rookie', level: 1 }), stat = rate({ kind: 'statistician', level: 3 });
    ok(`simulation: Rookie Easy ${ratingOf(rookie)}, Statistician Hard ${ratingOf(stat)} against ${REF.kind}.${REF.level}`, stat > rookie, [rookie, stat]);
    eq('simulation: ratings', [ratingOf(0.5), ratingOf(0.909)], [1500, 1900]);
  }

  lap('notation');
  // --- notation ----------------------------------------------------------------------------------------------------
  {
    let rounds = 0, bad = [];
    let bitsOk = true, bitInfo = [];
    for (const p of PRESETS) {
      const rs = normalizeRuleset(p);
      const n = playerRange(rs).min;
      const seats = Array.from({ length: n }, (_, i) => ({ kind: TEMPLATES[(i * 3 + 1) % TEMPLATES.length].id, level: 2 }));
      const rng = seededRandom('nt-' + p.id);
      let s = newGame(rs, { players: n, rng });
      const brng = rng.fork('bots');
      const P = seats.map((x) => profileOf(x.kind, { level: x.level }));
      while (s.phase !== 'over') { const seat = actors(s)[0]; const v = viewOf(s, seat); s = apply(s, seat, s.phase === 'place' ? placeAction(v, seat, brng, P[seat]) : decide(v, seat, brng, P[seat])).state; }
      const text = encode(s, { names: ['Ann', 'Bo;b', 'Cé', 'D~'], bots: [null, 'hunter.2', null, 'admiral.3'], seed: 'nt-' + p.id });
      const pr = parse(text);
      const full = replay(pr);
      const pub = replay({ ...pr, fleets: null });
      const same = full.ok && pub.ok && Array.from({ length: n }, (_, b) => knowledgeAt(rs, s.log, b).hit.join('') === knowledgeAt(rs, pub.log, b).hit.join('') && knowledgeAt(rs, s.log, b).water.join('') === knowledgeAt(rs, pub.log, b).water.join('')).every(Boolean);
      if (pr.ok && full.ok && pub.ok && same && pr.names[1] === 'Bo;b' && pr.bots[1] === 'hunter.2' && full.frames.length === pr.moves.length + 1) rounds++;
      else bad.push([p.id, pr.error, full.error, pub.error, same]);
      if (['classic', 'quick-8', 'hasbro'].includes(p.id)) {
        const an = analyze(rs, s.log, { samples: 300, n });
        const prior = startEntropy(rs);
        for (const b of an.boards) if (b.end === 0) { bitInfo.push([p.id, +b.start.toFixed(1), +prior.toFixed(1)]); if (Math.abs(b.start - prior) > Math.max(3, prior * 0.08)) bitsOk = false; }
        if (!an.seats.every((x) => x.skill == null || (x.skill >= 0 && x.skill <= 1))) bitsOk = false;
      }
    }
    eq('notation: round trips on every preset (full and public replays agree)', bad, []);
    ok(`notation: ${rounds} records`, rounds === PRESETS.length);
    ok('notation: the bits of a sunk board add up to its starting entropy', bitsOk && bitInfo.length >= 3, bitInfo);
    eq('notation: not a record', parse('hello').ok, false);
    eq('notation: a damaged move', parse('SBN1;r=classic@b8703da5;n=2;f=0;m=0:zz9').ok, false);
    const rs = normalizeRuleset(presetById('classic'));
    const tampered = (() => { let s = setup(presetById('classic'), [CLASSIC_FLEET, CLASSIC_FLEET]); s = apply(s, 0, { type: 'fire', target: 1, cells: [c(rs, 'e5')] }).state; return encode(s).replace(':e5.', ':e5x'); })();
    const tr = replay(parse(tampered));
    ok('notation: an answer that contradicts the fleets is caught', !tr.ok && /answers differ/.test(tr.error), tr.error);
    const own = { ...presetById('ex-tetromino'), id: 'my-sea', board: { width: 11, height: 9 } };
    let s = newGame(own, { players: 2, first: 0 });
    for (const i of [0, 1]) s = apply(s, i, placeAction(viewOf(s, i), i, seededRandom('o' + i), profileOf('rookie', { level: 1 }))).state;
    s = apply(s, 0, { type: 'fire', target: 1, cells: [3] }).state;
    const ownText = encode(s, { fleets: false });
    const op = parse(ownText);
    ok('notation: own rulesets travel inside the record', op.ok && op.rs && op.rs.board.width === 11 && replay(op).ok, ownText.slice(0, 80));
    eq('decisions of a log', decisions(s.log).map((d) => d.kind), ['fire']);
  }

  lap('analysis');
  // --- analysis ----------------------------------------------------------------------------------------------------
  {
    const rs = normalizeRuleset(presetById('classic'));
    const prof = {};
    for (const id of ['hunter', 'statistician', 'corsair']) {
      const r = playGame({ rs, seats: [{ kind: id, level: 3 }, { kind: 'rookie', level: 2 }], seed: 'an-' + id, record: true });
      prof[id] = features(r.counters[0]);
    }
    ok('analysis: the hunter searches on a checkerboard', prof.hunter.parity > 0.7 && prof.hunter.parity > prof.statistician.parity, [prof.hunter.parity, prof.statistician.parity]);
    ok('analysis: the corsair hugs the edges', prof.corsair.placeEdge > prof.statistician.placeEdge, [prof.corsair.placeEdge, prof.statistician.placeEdge]);
    ok('analysis: the statistician chooses better cells than the hunter', prof.statistician.choice > prof.hunter.choice, [prof.statistician.choice, prof.hunter.choice]);
    eq('analysis: the closest profile of a hunter', compare(prof.hunter, prof)[0].id, 'hunter');
    ok('analysis: badges', traitsOf(prof.hunter).includes('bloodhound') && traitsOf(prof.corsair).includes('coastHugger'), [traitsOf(prof.hunter), traitsOf(prof.corsair)]);
    const cn = newCounters();
    const s = setup(presetById('classic'), [CLASSIC_FLEET, CLASSIC_FLEET]);
    observe(cn, viewOf(s, 0), 0, { type: 'fire', target: 1, cells: [c(rs, 'e5')] }, { rng: seededRandom('o'), samples: 80 });
    observePlacement(cn, rs, { ships: CLASSIC_FLEET });
    eq('analysis: one shot, one fleet', [cn.shots, cn.hunt, cn.fleets], [1, 1, 1]);
    const g = playGame({ rs, seats: [{ kind: 'admiral', level: 3 }, { kind: 'rookie', level: 1 }], seed: 'sum' });
    void g;
    const st = (() => { let t = setup(presetById('classic'), [CLASSIC_FLEET, CLASSIC_FLEET], { first: 0 }); const cells = validateLayout(rs, { ships: CLASSIC_FLEET }).ships.flatMap((x) => x.cells); for (const x of cells) t = apply(t, 0, { type: 'fire', target: 1, cells: [x] }).state; return t; })();
    const sm = gameSummary(viewOf(st, 0), 0, { opponents: [{ kind: 'admiral', level: 3 }], seeded: true });
    eq('analysis: a perfect game', [sm.won, sm.shots, sm.accuracy, sm.streak, sm.lostCells], [true, 20, 1, 20, 0]);
    const got = newAchievements([], sm, []);
    ok('analysis: achievements of a perfect game', ['firstWin', 'flawless', 'sharpshooter', 'hotStreak', 'doubleSink', 'admiralSlayer', 'blitz', 'seeded'].every((x) => got.includes(x)), got);
    eq('analysis: practice games earn nothing', newAchievements([], { ...sm, practice: true }, []), []);
    eq('analysis: achievement ids are unique', new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);
  }

  lap('rooms');
  // --- rooms: a local room ---------------------------------------------------------------------------------------------
  {
    const settings = { rulesetId: 'quick-8' };
    const room = localRoom(game, settings, { seats: 2, botDelay: 0, random: { kind: 'seeded', seed: 'room' }, bots: [{ seat: 1, kind: 'ghost', options: { level: 2 } }] });
    const v0 = room.view;
    ok('game: the view hides the bot fleet and the ruleset travels by hash', v0 && v0.phase === 'place' && !v0.rs && v0.rsHash && v0.boards[1].ships === null, v0 && v0.phase);
    ok('game: hydrate', hydrate(v0).rs.hash === rulesetOf(settings).hash);
    const me = makeBot('hunter', { level: 2 });
    const rng = seededRandom('me');
    let guard = 0, leak = false;
    while (room.status === 'playing' && guard++ < 3000) {
      const v = room.view;
      if (v.phase !== 'over' && v.boards[1].ships) leak = true;
      const a = me(hydrate(v), 0, rng);
      if (a) { const r = await room.act(a); if (!r.ok) { ok('game: own action accepted', false, r.error); break; } }
      await new Promise((res) => setTimeout(res, 1));
    }
    eq('game: a room game ends', room.status, 'over');
    ok('game: the bot fleet stayed hidden until the end', !leak);
    ok('game: the end shows both fleets and the seed', room.view.boards.every((b) => b.ships) && room.view.seed === 'room');
    room.leave();
  }

  lap('online');
  // End-to-end: a real HTTP server on an ephemeral port (listen(0)) with two clients, exercising room creation,
  // passwords, hidden fleets over the wire and server-side bots. 127.0.0.1 binding keeps the test off the network.
  // --- online: the game over HTTP (rooms/server.js) ----------------------------------------------------------------------
  {
    const http = await import('node:http');
    const { createRoomService } = await import('../rooms/server.js');
    const { connect } = await import('../rooms/client.js');
    const service = createRoomService({ games: { [game.id]: game }, botDelay: 1 });
    const server = http.createServer((req, res) => { service.handle(req, res).then((done) => { if (!done) { res.writeHead(404); res.end(); } }); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${server.address().port}`;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      const a = connect(url), b = connect(url);
      const skin = { theme: 'radar', tableImage: null };
      const own = { ...presetById('mini-6'), id: 'online-mini', board: { width: 7, height: 6 } };
      const made = await a.create({ game: game.id, name: 'Test', player: 'Ann', settings: { ruleset: own, skin }, seats: 3, password: 'secret', public: false, random: { kind: 'seeded', seed: 'net' } });
      ok('online: room created', !!made.roomId && made.seat === 0, made);
      let denied = null;
      try { await b.join(made.roomId, { player: 'Bob', password: 'wrong' }); } catch (e) { denied = e.status; }
      eq('online: wrong password refused', denied, 403);
      const joined = await b.join(made.roomId, { player: 'Bob', invite: made.invite });
      eq('online: the invite replaces the password', joined.seat, 1);
      const ra = a.open(made.roomId, made.token), rb = b.open(made.roomId, joined.token);
      await wait(150);
      eq('online: the room look reaches every player', [ra.settings.skin && ra.settings.skin.theme, rb.settings.skin && rb.settings.skin.theme], ['radar', 'radar']);
      const st = await ra.start();
      ok('online: started', st.ok !== false, st);
      const policy = makeBot('statistician', { level: 2 });
      const rng = seededRandom('net-play');
      let guard = 0, leak = false;
      while ((ra.status !== 'over' || rb.status !== 'over') && guard++ < 4000) {
        for (const [room, seat] of [[ra, 0], [rb, 1]]) {
          const v = room.view;
          if (!v || v.phase === 'over') continue;
          if (v.boards.some((x, i) => i !== seat && x.ships)) leak = true;
          const act = policy(hydrate(v), seat, rng);
          if (act) await room.act(act);
        }
        await wait(3);
      }
      eq('online: a networked game ends', [ra.status, rb.status], ['over', 'over']);
      ok('online: views never showed the other fleet', !leak);
      ok('online: the own ruleset travelled with the room', ra.view && hydrate(ra.view).rs.board.width === 7);
      ra.leave(); rb.leave();
    } catch (e) {
      ok('online: no exception', false, e.message);
    } finally {
      service.close();
      await new Promise((r) => server.close(r));
    }
  }

  lap('end');
  if (isMain) console.log(laps.slice(1).join(', '));
  console.log(`battleship: simulations ${simGames} games, ${simIllegal} illegal decisions, ${simUnfinished} unfinished`);
  console.log(`battleship: ${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  return fail;
}

if (isMain) {
  const failures = await run({ long: process.argv.includes('--long') });
  process.exitCode = failures ? 1 : 0;
}
