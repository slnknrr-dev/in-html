// mines/test.js - unit tests of the mines library: `node mines/test.js` (importing the module runs nothing).
// Topologies (symmetry, counts), configuration limits, placement and first-click protection, seed reproducibility,
// flood / chord / flags / undo / win / loss, solver soundness on random views, no-guess boards solved from scratch,
// probabilities, 3BV, share codes and move lists, replays and statistics.
//
// Randomised but reproducible: every random case draws from seededRandom, so a failure replays identically.
// Solver soundness is tested against ground truth (the real layout): any "safe" deduction on a mine is a bug,
// which catches unsound rules far better than hand-built positions. botPlay below exercises game + solver together.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { topology, SQUARE_NB } from './topology.js';
import { normalizeConfig, maxMines, configKey, PRESETS } from './config.js';
import { placeMines, countNumbers, protectedCells, bbbv, noGuessSteps, runSteps } from './layout.js';
import { Solver, analyzeView, probabilities } from './solver.js';
import { Game, OPEN, FLAG, HIDDEN, MARK } from './game.js';
import { encodeGame, decodeGame, encodeMoves, decodeMoves, bitsToMines, minesToBits } from './code.js';
import { emptyStats, recordGame } from './stats.js';
import { seededRandom } from '../prng/prng.js';

// Run only when executed directly; importing run() has no side effects.
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const nbList = (topo, i) => { const b = new Int32Array(topo.maxN); return Array.from(b.subarray(0, topo.neighbors(i, b))); };
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// Plays a game with the solver: certain moves first, otherwise the safest guess. Returns the game.
function botPlay(game, rng, { first } = {}) {
  let t = 0;
  const f = first ?? rng.int(game.n);
  if (game.needsLayout()) game.prepare(game.layoutFirst(f));
  game.reveal(game.cfg.first === 'marked' ? game.start : f, t);
  while (!game.over) {
    t += 100;
    const a = analyzeView(game.topo, game.view());
    const safe = a.safe.find((d) => game.st[d.cell] !== OPEN);
    if (safe) { if (game.st[safe.cell] === FLAG) game.flag(safe.cell, t); game.reveal(safe.cell, t); continue; }
    const mine = a.mines.find((d) => game.st[d.cell] !== FLAG);
    if (mine) { game.flag(mine.cell, t); continue; }
    let pick = a.best;
    if (pick < 0 || game.st[pick] === OPEN) { do pick = rng.int(game.n); while (game.st[pick] === OPEN); }
    if (game.st[pick] === FLAG) game.flag(pick, t);
    if (game.st[pick] === MARK) game.flag(pick, t);
    game.reveal(pick, t);
  }
  return game;
}

export async function run() {
  let pass = 0, fail = 0;
  const ok = (name, cond, info) => { if (cond) pass++; else { fail++; console.log(`FAIL ${name}${info !== undefined ? ': ' + JSON.stringify(info) : ''}`); } };
  const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });

  // --- topologies ---------------------------------------------------------------------------------------------
  const sq = topology({ w: 9, h: 9 });
  eq('king corner / edge / centre', [nbList(sq, 0).length, nbList(sq, 4).length, nbList(sq, 40).length], [3, 5, 8]);
  eq('cross centre', nbList(topology({ w: 9, h: 9, nb: 'cross' }), 40).length, 4);
  eq('knight corner / centre', [nbList(topology({ w: 9, h: 9, nb: 'knight' }), 0).length, nbList(topology({ w: 9, h: 9, nb: 'knight' }), 40).length], [2, 8]);
  eq('wide corner / centre', [nbList(topology({ w: 9, h: 9, nb: 'wide' }), 0).length, nbList(topology({ w: 9, h: 9, nb: 'wide' }), 40).length], [8, 24]);
  eq('torus corner', nbList(topology({ w: 9, h: 9, wrap: true }), 0).sort((a, b) => a - b), [1, 8, 9, 10, 17, 72, 73, 80]);
  const hx = topology({ w: 6, h: 6, grid: 'hex' });
  eq('hex even row', nbList(hx, 2 * 6 + 2).sort((a, b) => a - b), [7, 8, 13, 15, 19, 20]);
  eq('hex odd row', nbList(hx, 3 * 6 + 2).sort((a, b) => a - b), [14, 15, 19, 21, 26, 27]);
  eq('hex wide centre', nbList(topology({ w: 9, h: 9, grid: 'hex', nb: 'wide' }), 4 * 9 + 4).length, 18);
  for (const grid of ['square', 'hex']) {
    for (const nb of grid === 'hex' ? ['king', 'wide'] : Object.keys(SQUARE_NB)) {
      for (const wrap of [false, true]) {
        const t = topology({ w: 7, h: 8, grid, nb, wrap });
        let symmetric = true, clean = true;
        for (let i = 0; i < t.n; i++) {
          const l = nbList(t, i);
          if (new Set(l).size !== l.length || l.includes(i)) clean = false;
          for (const j of l) if (!nbList(t, j).includes(i)) symmetric = false;
          if (wrap && l.length !== t.maxN) clean = false;
        }
        ok(`${grid}/${nb}/${wrap ? 'torus' : 'flat'} symmetric`, symmetric);
        ok(`${grid}/${nb}/${wrap ? 'torus' : 'flat'} no self / duplicates`, clean);
      }
    }
  }

  // --- configuration ----------------------------------------------------------------------------------------------
  eq('normalize default', normalizeConfig({}), { w: 9, h: 9, mines: 10, grid: 'square', nb: 'king', wrap: false, first: 'opening', noGuess: false, marks: false });
  eq('clamp size and mines', (({ w, h, mines }) => [w, h, mines])(normalizeConfig({ w: 1, h: 9999, mines: 1e9 })), [3, 500, 3 * 500 - 9]);
  eq('hex torus rows even', normalizeConfig({ grid: 'hex', wrap: true, h: 9 }).h, 10);
  eq('hex has no knight', normalizeConfig({ grid: 'hex', nb: 'knight' }).nb, 'king');
  eq('no-guess needs an opening', [normalizeConfig({ noGuess: true, first: 'safe' }).first, normalizeConfig({ noGuess: true, first: 'off' }).first], ['opening', 'marked']);
  eq('wide torus min side', normalizeConfig({ w: 3, h: 3, nb: 'wide', wrap: true }).w, 5);
  eq('max mines', [maxMines(normalizeConfig(PRESETS.beginner)), maxMines(normalizeConfig({ ...PRESETS.beginner, first: 'safe' }))], [72, 80]);
  eq('config key', configKey({ ...PRESETS.expert, noGuess: true }), '30x16-99-square-king-ng');

  // --- placement ---------------------------------------------------------------------------------------------------
  {
    const t = topology({ w: 30, h: 16 });
    const keep = protectedCells(t, normalizeConfig({ first: 'opening' }), 100);
    const m1 = placeMines(t, 99, seededRandom('alpha'), keep), m2 = placeMines(t, 99, seededRandom('alpha'), keep);
    const m3 = placeMines(t, 99, seededRandom('beta'), keep);
    eq('placed count', m1.reduce((a, b) => a + b, 0), 99);
    ok('protected cells free', [100, ...nbList(t, 100)].every((i) => !m1[i]));
    ok('same seed same layout', same(m1, m2));
    ok('other seed other layout', !same(m1, m3));
    const num = countNumbers(t, m1);
    let good = true;
    for (let i = 0; i < t.n; i++) if (num[i] !== nbList(t, i).filter((j) => m1[j]).length) good = false;
    ok('numbers match neighbours', good);
    // uniformity: every free cell is chosen about equally often
    const hits = new Uint32Array(t.n), r = seededRandom('uniform');
    for (let k = 0; k < 400; k++) { const m = placeMines(t, 99, r, keep); for (let i = 0; i < t.n; i++) hits[i] += m[i]; }
    const free = [...hits].filter((_, i) => !keep[i]);
    const mean = free.reduce((a, b) => a + b, 0) / free.length;
    ok('placement roughly uniform', Math.max(...free) < mean * 1.6 && Math.min(...free) > mean * 0.45, { mean, max: Math.max(...free), min: Math.min(...free) });
  }

  // --- 3BV ----------------------------------------------------------------------------------------------------------
  {
    const t = topology({ w: 3, h: 3 });
    const m = new Uint8Array(9); m[0] = 1;
    eq('3bv one opening', bbbv(t, m, countNumbers(t, m)), 1);
    m[8] = 1;
    eq('3bv two openings', bbbv(t, m, countNumbers(t, m)), 2);
    const m2 = new Uint8Array(9); m2[1] = m2[7] = 1;
    eq('3bv no opening', bbbv(t, m2, countNumbers(t, m2)), 7);
  }

  // --- games ---------------------------------------------------------------------------------------------------------
  {
    let openings = true, safe = true;
    const r = seededRandom('first clicks');
    for (let k = 0; k < 150; k++) {
      const g = new Game(PRESETS.expert, { kind: 'seeded', seed: 'g' + k });
      const f = r.int(g.n);
      g.prepare(g.layoutFirst(f));
      g.reveal(f, 0);
      if (g.num[f] !== 0 || g.status === 'lost') openings = false;
      const s = new Game({ ...PRESETS.expert, first: 'safe' }, { kind: 'seeded', seed: 's' + k });
      s.prepare(s.layoutFirst(f));
      if (s.reveal(f, 0).lost) safe = false;
    }
    ok('first click opens an area', openings);
    ok('first click is safe', safe);

    // Same seed + same first click = same board; 'marked' boards ignore the click.
    const lay = (cfg, seed, f) => { const g = new Game(cfg, { kind: 'seeded', seed }); g.prepare(g.layoutFirst(f)); return g; };
    ok('seed + click reproducible', same(lay(PRESETS.intermediate, 'x', 37).mine, lay(PRESETS.intermediate, 'x', 37).mine));
    ok('other click other board', !same(lay(PRESETS.intermediate, 'x', 37).mine, lay(PRESETS.intermediate, 'x', 200).mine));
    const mk = { ...PRESETS.intermediate, first: 'marked' };
    const a = lay(mk, 'daily', 3), b = lay(mk, 'daily', 250);
    ok('marked board fixed by the seed', same(a.mine, b.mine) && a.start === b.start && a.start >= 0);
    ok('marked start opens an area', a.num[a.start] === 0 && !a.mine[a.start]);
    ok('off board fixed by the seed', same(lay({ ...PRESETS.beginner, first: 'off' }, 'q', 1).mine, lay({ ...PRESETS.beginner, first: 'off' }, 'q', 70).mine));

    // Flood: every open zero has all its neighbours open.
    const g = lay(PRESETS.expert, 'flood', 200);
    g.reveal(200, 0);
    let flood = true;
    for (let i = 0; i < g.n; i++) if (g.st[i] === OPEN && g.num[i] === 0) for (const j of nbList(g.topo, i)) if (g.st[j] !== OPEN) flood = false;
    ok('flood opens around zeros', flood);
    eq('opened count', g.opened, [...g.st].filter((s) => s === OPEN).length);

    // Flags, question marks, chords.
    const c = new Game({ ...PRESETS.beginner, marks: true }, { kind: 'seeded', seed: 'chord' });
    c.prepare(c.layoutFirst(40));
    c.reveal(40, 0);
    const numbered = [...Array(c.n).keys()].find((i) => c.st[i] === OPEN && c.num[i] > 0 && nbList(c.topo, i).some((j) => c.st[j] === HIDDEN && !c.mine[j]));
    ok('a number with hidden safe neighbours', numbered !== undefined);
    if (numbered !== undefined) {
      ok('not chordable without flags', !c.chordable(numbered));
      for (const j of nbList(c.topo, numbered)) if (c.mine[j]) c.flag(j, 10);
      ok('chordable with correct flags', c.chordable(numbered));
      const before = c.opened;
      const r2 = c.chord(numbered, 20);
      ok('chord opens', r2 && !r2.lost && c.opened > before);
      // wrong flag: chording loses, undo restores
      const cell = [...Array(c.n).keys()].find((i) => c.st[i] === OPEN && c.num[i] > 0 && nbList(c.topo, i).some((j) => c.st[j] === HIDDEN && !c.mine[j]) && nbList(c.topo, i).some((j) => c.mine[j] && c.st[j] === HIDDEN));
      if (cell !== undefined) {
        const nbs = nbList(c.topo, cell);
        const wrong = nbs.filter((j) => c.st[j] === HIDDEN && !c.mine[j]).slice(0, c.num[cell] - nbs.filter((j) => c.st[j] === FLAG).length);
        for (const j of wrong) c.flag(j, 30);
        if (c.chordable(cell)) {
          const st = Uint8Array.from(c.st);
          const r3 = c.chord(cell, 40);
          ok('chord on a wrong flag loses', r3 && r3.lost && c.status === 'lost' && r3.boom.length > 0);
          c.undo(50);
          ok('undo after a loss', c.status === 'playing' && same(c.st, st) && c.assisted);
        }
      }
    }
    const fl = new Game({ ...PRESETS.beginner, marks: true }, { kind: 'seeded', seed: 'flags' });
    fl.flag(0, 0);
    ok('flag before the first click', fl.st[0] === FLAG && fl.remaining === 9);
    fl.flag(0, 0);
    ok('question mark', fl.st[0] === MARK && fl.remaining === 10);
    fl.flag(0, 0);
    ok('back to hidden', fl.st[0] === HIDDEN);

    // Winning by revealing every safe cell flags the mines; losing shows the mine.
    const w = lay(PRESETS.beginner, 'win', 0);
    for (let i = 0; i < w.n; i++) if (!w.mine[i]) w.reveal(i, 1000 + i);
    ok('won', w.status === 'won' && w.flags === w.cfg.mines && w.remaining === 0 && w.time > 0);
    ok('no undo after a win', !w.canUndo());
    const l = lay(PRESETS.beginner, 'lose', 0);
    l.reveal(0, 0);
    const bomb = l.mine.indexOf(1);
    const res = l.reveal(bomb, 500);
    ok('lost', res.lost && l.status === 'lost' && res.boom[0] === bomb && l.time === 500);
    ok('no moves after the end', l.reveal(l.mine.indexOf(0), 600) === null);
  }

  // --- solver -----------------------------------------------------------------------------------------------------------
  {
    // Soundness: on random boards, every deduction from the player's view is true.
    let sound = true, deduced = 0, probOk = true;
    const r = seededRandom('soundness');
    for (let k = 0; k < 60; k++) {
      const grid = k % 3 === 2 ? 'hex' : 'square';
      const nb = ['king', 'cross', 'knight', 'wide'][k % 4];
      const cfg = { w: 12, h: 10, mines: 18 + (k % 10), grid, nb: grid === 'hex' ? (k % 2 ? 'wide' : 'king') : nb, wrap: k % 5 === 0 };
      const g = new Game(cfg, { kind: 'seeded', seed: 'sound' + k });
      const f = r.int(g.n);
      g.prepare(g.layoutFirst(f));
      g.reveal(f, 0);
      for (let s = 0; s < 3 && !g.over; s++) { const x = r.int(g.n); if (g.st[x] !== OPEN && !g.mine[x]) g.reveal(x, 0); }
      if (g.over) continue;
      const a = analyzeView(g.topo, g.view());
      for (const d of a.safe) { deduced++; if (g.mine[d.cell]) sound = false; }
      for (const d of a.mines) { deduced++; if (!g.mine[d.cell]) sound = false; }
      if (a.probs) for (let i = 0; i < g.n; i++) if (!Number.isNaN(a.probs[i]) && (a.probs[i] < -1e-6 || a.probs[i] > 1 + 1e-6)) probOk = false;
    }
    ok('deductions are true', sound);
    ok('deductions found', deduced > 100, deduced);
    ok('probabilities in [0, 1]', probOk);

    // Classic 1-2-1: hidden row above "1 2 1" → the outer cells are mines, the middle one is safe.
    const t = topology({ w: 5, h: 3 });
    // row 0 hidden; row 1 open: 1 2 1 in columns 1..3 with walls (open cells known safe) at columns 0 and 4
    const mine = new Uint8Array(15); mine[1] = 1; mine[3] = 1;
    const num = countNumbers(t, mine);
    const s = new Solver(t, num, { mines: -1, log: true });
    for (const i of [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) s.openCell(i);
    s.run();
    eq('1-2-1 pattern', [s.K[0], s.K[1], s.K[2], s.K[3], s.K[4]], [0, 1, 0, 1, 0]);

    // Probabilities: the centre "1" of a 3 × 3 board with one mine → 1/8 for each other cell.
    const t2 = topology({ w: 3, h: 3 });
    const m2 = new Uint8Array(9); m2[0] = 1;
    const s2 = new Solver(t2, countNumbers(t2, m2), { mines: 1 });
    s2.openCell(4);
    s2.run();
    const p = probabilities(s2);
    ok('1/8 probabilities', p.exact && [0, 1, 2, 3, 5, 6, 7, 8].every((i) => Math.abs(p.p[i] - 0.125) < 1e-6), Array.from(p.p));
    // A corner "1" of a 4 × 4 board with 2 mines: 1/3 for its three neighbours, 1/12 for the 12 cells no number touches.
    const t3 = topology({ w: 4, h: 4 });
    const m3 = new Uint8Array(16); m3[5] = 1; m3[15] = 1;
    const s3 = new Solver(t3, countNumbers(t3, m3), { mines: 2 });
    s3.openCell(0);
    s3.run();
    const p3 = probabilities(s3);
    ok('weighted by the cells no number touches', p3.exact && [1, 4, 5].every((i) => Math.abs(p3.p[i] - 1 / 3) < 1e-6) && Math.abs(p3.p[10] - 1 / 12) < 1e-6, Array.from(p3.p));
  }

  // --- no guessing ----------------------------------------------------------------------------------------------------
  {
    const cases = [
      [PRESETS.beginner, 12], [PRESETS.intermediate, 8], [PRESETS.expert, 5],
      [{ w: 16, h: 16, mines: 30, grid: 'hex' }, 4], [{ w: 16, h: 16, mines: 32, nb: 'knight' }, 3],
      [{ w: 16, h: 16, mines: 40, wrap: true }, 3], [{ w: 16, h: 16, mines: 60, nb: 'wide' }, 2], [{ w: 16, h: 16, mines: 24, nb: 'cross' }, 3],
    ];
    const r = seededRandom('no guess');
    let all = true, okFlag = true, mines = true;
    const t0 = Date.now();
    for (const [cfg0, count] of cases) {
      for (let k = 0; k < count; k++) {
        const cfg = normalizeConfig({ ...cfg0, noGuess: true });
        const g = new Game(cfg, { kind: 'seeded', seed: `ng ${cfg.grid} ${cfg.nb} ${k}` });
        const f = r.int(g.n);
        const res = g.prepare(g.layoutFirst(f));
        if (!res.ok) okFlag = false;
        if (g.mine.reduce((a, b) => a + b, 0) !== cfg.mines) mines = false;
        const s = new Solver(g.topo, g.num, { mines: cfg.mines, open: true });
        s.openCell(f);
        if (!s.run() || g.num[f] !== 0 || g.mine[f]) all = false;
      }
    }
    ok('no-guess generation succeeded', okFlag);
    ok('no-guess boards keep the mine count', mines);
    ok('no-guess boards solve from the first click', all);
    console.log(`  no-guess boards: ${Date.now() - t0} ms`);
    // The bot never guesses on a no-guess board.
    let neverLost = true;
    for (let k = 0; k < 6; k++) {
      const g = new Game({ ...PRESETS.intermediate, noGuess: true }, { kind: 'seeded', seed: 'bot ng ' + k });
      botPlay(g, seededRandom('bot' + k));
      if (g.status !== 'won') neverLost = false;
    }
    ok('a logical player wins no-guess boards', neverLost);
    const ng = new Game({ ...PRESETS.expert, noGuess: true, first: 'marked' }, { kind: 'seeded', seed: 'daily-2026-10-13' });
    ng.prepare(ng.layoutFirst(0));
    const ng2 = new Game({ ...PRESETS.expert, noGuess: true, first: 'marked' }, { kind: 'seeded', seed: 'daily-2026-10-13' });
    ng2.prepare(ng2.layoutFirst(77));
    ok('marked no-guess board fixed by the seed', same(ng.mine, ng2.mine) && ng.start === ng2.start);
  }

  // --- codes, replays, statistics -----------------------------------------------------------------------------------
  {
    const moves = [[0, 0, 5], [130, 1, 17], [130, 2, 200], [99999, 3, -1], [100500, 0, 0]];
    eq('moves round trip', decodeMoves(encodeMoves(moves)), moves);
    const cfg = normalizeConfig({ w: 20, h: 12, mines: 33, grid: 'hex', nb: 'wide', wrap: true, first: 'marked', noGuess: true, marks: true });
    const code = encodeGame({ cfg, seed: 'hello world & co', start: 17, moves });
    const back = decodeGame('https://example.test/miner/#' + code);
    eq('code round trip', [back.cfg, back.seed, back.start, back.moves], [cfg, 'hello world & co', 17, moves]);
    const g = new Game(PRESETS.expert, { kind: 'crypto' });
    g.prepare(g.layoutFirst(50));
    const lay = decodeGame(encodeGame({ cfg: g.cfg, bits: g.layoutBits() }));
    ok('layout round trip', same(bitsToMines(lay.bits, g.n), g.mine) && same(minesToBits(g.mine), g.layoutBits()));
    eq('not a code', decodeGame('#something=else'), null);

    // Replays: a played game, re-run from its layout and moves, ends the same way.
    let replays = true;
    for (let k = 0; k < 8; k++) {
      const p = new Game({ ...PRESETS.intermediate, marks: k % 2 === 1 }, { kind: k % 3 ? 'seeded' : 'crypto', seed: 'replay' + k });
      botPlay(p, seededRandom('rb' + k));
      const rec = decodeGame(encodeGame({ cfg: p.cfg, bits: p.layoutBits(), start: p.first, moves: p.moves }));
      const q = new Game(rec.cfg, { kind: 'layout', mine: bitsToMines(rec.bits, p.n), start: rec.start });
      for (const m of rec.moves) q.apply(m);
      if (!same(q.st, p.st) || q.status !== p.status || q.time !== p.time) replays = false;
    }
    ok('replays end the same way', replays);
    // A seeded game replays from its seed alone.
    const sg = new Game(PRESETS.expert, { kind: 'seeded', seed: 'seeded replay' });
    botPlay(sg, seededRandom('sr'));
    const sq2 = new Game(sg.cfg, { kind: 'seeded', seed: 'seeded replay' });
    for (const m of sg.moves) sq2.apply(m);
    ok('seeded replay', same(sq2.st, sg.st) && sq2.status === sg.status);

    const st = emptyStats();
    eq('first win rank', recordGame(st, 'k', { won: true, ms: 5000, date: 1 }), 1);
    eq('slower win rank', recordGame(st, 'k', { won: true, ms: 9000, date: 2 }), 2);
    eq('assisted win not ranked', recordGame(st, 'k', { won: true, ms: 1000, date: 3, assisted: true }), 0);
    recordGame(st, 'k', { won: false, ms: 1000, date: 4 });
    eq('faster win rank', recordGame(st, 'k', { won: true, ms: 3000, date: 5 }), 1);
    const e = st.games.k;
    eq('stats', [e.played, e.won, e.streak, e.bestStreak, e.best.map((b) => b.ms)], [5, 4, 1, 3, [3000, 5000, 9000]]);
  }

  // --- speed ------------------------------------------------------------------------------------------------------------
  {
    const t0 = Date.now();
    const big = new Game({ w: 200, h: 200, mines: 6000 }, { kind: 'seeded', seed: 'big' });
    big.prepare(big.layoutFirst(20100));
    big.reveal(20100, 0);
    const a = analyzeView(big.topo, big.view());
    const ms = Date.now() - t0;
    ok('200 × 200 board, reveal and analysis under 1.5 s', ms < 1500, ms);
    const t1 = Date.now();
    const ngBig = new Game({ w: 60, h: 60, mines: 540, noGuess: true }, { kind: 'seeded', seed: 'ng big' });
    const res = ngBig.prepare(ngBig.layoutFirst(1830));
    console.log(`  200x200 reveal + analysis ${ms} ms (${a.safe.length} safe), 60x60 no-guess ${Date.now() - t1} ms (ok ${res.ok}, ${res.attempts} attempts, ${res.moves} moves)`);
    ok('60 × 60 no-guess board', res.ok);
  }

  console.log(`mines: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
