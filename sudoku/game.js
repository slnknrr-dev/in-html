// sudoku/game.js - Sudoku as a rooms/ game definition (pure; the same code runs in local rooms and on the server).
//
// settings = { mode: 'coop' | 'race', puzzle?: code (codec.js), gen?: generator options (generate.js),
//              showMistakes = false, hints = true }
//   coop  one shared board; everybody's cursor is visible; the room is won together when the grid is complete
//   race  the same puzzle on separate boards; the others see only how far each player is; the first to finish wins
// A room is best created with a puzzle code made by the client (large grids take a while to generate); the room
// checks that it has exactly one solution. Without a code the room generates the puzzle with its random source.
//
// actions: { type: 'cursor', cell }            where the player looks (-1: nowhere)
//          { type: 'move', move, autoNotes? }   a board move (board.js)
//          { type: 'reveal', cell }             the solution of one cell (when hints are allowed; counted)
//          { type: 'check' }                    a private event with the wrong cells of the player's board
// events:  { type: 'solved' } · { type: 'finished', seat, place } · { type: 'reveal', seat, cell } ·
//          { type: 'check', to: seat, wrong: [cells] }
// view(seat): { mode, code, players, cursors, board, owner (coop: who entered each value), progress: [{ filled,
//   total, finished, mistakes, hints }], wrong? (with showMistakes), full (own board full but wrong), solved,
//   finished: [{ seat, place }], hints, showMistakes, boards? (spectators of a race see every board) }

import { compile } from './model.js';
import { solve } from './solver.js';
import { generate } from './generate.js';
import { createLogic } from './logic.js';
import { decodePuzzle, encodePuzzle } from './codec.js';
import { applyMove, cloneBoard, newBoard } from './board.js';

// LRU-ish cache of compiled puzzles keyed by code (Map iteration order = insertion order, so deleting the first
// key evicts the oldest). Compilation is costly for big grids and every action / view needs the model.
const CACHE = new Map();
// Compiled puzzle data per code (shared by actions, views and bots): { puzzle, model, ctx, open }.
function prepared(code) {
  let p = CACHE.get(code);
  if (p) return p;
  const puzzle = decodePuzzle(code);
  const model = compile(puzzle);
  const peers = model.peers.map((x) => Array.from(x));
  const open = Array.from(model.geom.cells).filter((c) => !model.givens[c]);
  p = { puzzle, model, open, ctx: { n: model.n, size: model.geom.size, givens: model.givens, present: model.geom.present, peers, autoNotes: true } };
  CACHE.set(code, p);
  if (CACHE.size > 32) CACHE.delete(CACHE.keys().next().value);
  return p;
}

export const game = {
  id: 'sudoku',
  version: 1,
  seats: () => ({ min: 1, max: 8 }),

  // A client-supplied code is untrusted: it is decoded (validated) and solved with a node budget. Unverifiable or
  // non-unique puzzles are refused; the solution is computed server-side so a client cannot ship a fake one.
  create(settings = {}, rng) {
    let puzzle, solution;
    if (settings.puzzle) {
      puzzle = decodePuzzle(settings.puzzle);
      const model = compile(puzzle);
      const r = solve(model, { limit: 2, nodeLimit: 300000 });
      if (r.aborted) throw new Error('the puzzle could not be verified');
      if (r.count !== 1) throw new Error('the puzzle must have exactly one solution');
      solution = Array.from(r.solution);
    } else {
      const g = generate(settings.gen || {}, rng);
      puzzle = g.puzzle;
      solution = g.solution;
    }
    const code = encodePuzzle(puzzle);
    const P = prepared(code);
    const players = Math.max(1, settings.players | 0 || 1);
    const mode = settings.mode === 'race' ? 'race' : 'coop';
    const size = P.ctx.size;
    return {
      code, solution, mode, players,
      boards: mode === 'coop' ? [newBoard(size)] : Array.from({ length: players }, () => newBoard(size)),
      owner: mode === 'coop' ? new Array(size).fill(-1) : null,
      cursors: new Array(players).fill(-1),
      stats: Array.from({ length: players }, () => ({ moves: 0, mistakes: 0, hints: 0 })),
      finished: [],
      solved: false,
      turn: 0,
      showMistakes: !!settings.showMistakes,
      hints: settings.hints !== false,
    };
  },

  // Pure reducer: never mutates state, returns a new state plus events. Boards and stats are cloned first, so a
  // rejected action leaves the old state untouched. Mistakes are counted against the stored solution as values are
  // entered; owner records who entered each value in coop.
  act(state, seat, action) {
    if (!action || typeof action !== 'object') return { error: 'bad action' };
    if (!(seat >= 0 && seat < state.players)) return { error: 'not a player' };
    const P = prepared(state.code);
    const { size } = P.ctx;
    if (action.type === 'cursor') {
      const cell = action.cell;
      if (!Number.isInteger(cell) || cell < -1 || cell >= size) return { error: 'bad cell' };
      const cursors = [...state.cursors];
      cursors[seat] = cell;
      return { state: { ...state, cursors } };
    }
    if (state.solved) return { error: 'solved' };
    const bi = state.mode === 'coop' ? 0 : seat;
    if (state.mode === 'race' && state.finished.some((f) => f.seat === seat)) return { error: 'finished' };
    const board = cloneBoard(state.boards[bi]);
    const stats = state.stats.map((s) => ({ ...s }));
    const owner = state.owner ? [...state.owner] : null;
    const events = [];
    if (action.type === 'move') {
      const ctx = { ...P.ctx, autoNotes: action.autoNotes !== false };
      const patch = applyMove(board, action.move, ctx);
      if (!patch) return { error: 'nothing changed' };
      stats[seat].moves++;
      for (const p of patch) {
        const v = board.values[p.i];
        if (v && v !== p.v) {
          if (v !== state.solution[p.i]) stats[seat].mistakes++;
          if (owner) owner[p.i] = seat;
        } else if (!v && owner) owner[p.i] = -1;
      }
    } else if (action.type === 'reveal') {
      if (!state.hints) return { error: 'hints are off' };
      const c = action.cell;
      if (!Number.isInteger(c) || c < 0 || c >= size || !P.model.geom.present[c] || P.model.givens[c]) return { error: 'bad cell' };
      if (board.values[c] === state.solution[c]) return { error: 'already right' };
      board.values[c] = state.solution[c];
      board.corner[c] = 0; board.center[c] = 0;
      if (owner) owner[c] = seat;
      stats[seat].hints++;
      events.push({ type: 'reveal', seat, cell: c });
    // check is a private event (to: seat): wrong cells are never broadcast, so other players do not see each other's mistakes.
    } else if (action.type === 'check') {
      if (!state.hints) return { error: 'hints are off' };
      stats[seat].hints++;
      events.push({ type: 'check', to: seat, wrong: wrongCells(P, board, state.solution) });
      const boards = [...state.boards];
      return { state: { ...state, stats, turn: state.turn + 1, boards }, events };
    } else return { error: 'unknown action' };
    const boards = [...state.boards];
    boards[bi] = board;
    const next = { ...state, boards, stats, owner, turn: state.turn + 1 };
    const done = P.open.every((c) => board.values[c] === state.solution[c]);
    if (done) {
      if (state.mode === 'coop') { next.solved = true; events.push({ type: 'solved' }); }
      else {
        next.finished = [...state.finished, { seat, place: state.finished.length + 1, turn: next.turn }];
        events.push({ type: 'finished', seat, place: next.finished.length });
      }
    }
    return { state: next, events };
  },

  // Per-seat projection: the solution is never part of a view. In race mode a player sees only own board plus
  // progress counts; spectators (seat < 0) see all boards.
  view(state, seat) {
    const P = prepared(state.code);
    const total = P.open.length;
    const progress = state.stats.map((s, k) => {
      const b = state.mode === 'coop' ? state.boards[0] : state.boards[k];
      return { filled: P.open.reduce((a, c) => a + (b.values[c] ? 1 : 0), 0), total, finished: state.finished.some((f) => f.seat === k), mistakes: s.mistakes, hints: s.hints, moves: s.moves };
    });
    const own = state.mode === 'coop' ? state.boards[0] : seat >= 0 ? state.boards[seat] : null;
    const v = {
      mode: state.mode, code: state.code, players: state.players, cursors: state.cursors, board: own, owner: state.owner,
      progress, solved: state.solved, finished: state.finished, hints: state.hints, showMistakes: state.showMistakes,
    };
    if (own) {
      const wrong = wrongCells(P, own, state.solution);
      if (state.showMistakes) v.wrong = wrong;
      v.full = P.open.every((c) => own.values[c]) && wrong.length > 0;
    }
    if (state.mode === 'race' && seat < 0) v.boards = state.boards;
    return v;
  },

  result(state) {
    if (state.mode === 'coop') return state.solved ? { solved: true, stats: state.stats, owner: countOwners(state) } : null;
    if (!state.finished.length) return null;
    return { winner: state.finished[0].seat, finished: state.finished, stats: state.stats };
  },

  // Bots play by the logical solver (up to level 4) on their correct values, with a think delay in turns, so they look human-paced.
  bot: {
    kinds: [{ id: 'relaxed', think: [5, 9] }, { id: 'steady', think: [2, 5] }, { id: 'quick', think: [0, 2] }],
    create(kind, options = {}) {
      const def = game.bot.kinds.find((k) => k.id === kind) || game.bot.kinds[1];
      const [lo, hi] = options.think || def.think;
      let plan = null, wait = 0, solved = null, logic = null;
      return (view, seat, rng) => {
        if (!view || view.solved || !view.board || view.finished.some((f) => f.seat === seat)) return null;
        const P = prepared(view.code);
        if (!solved || solved.code !== view.code) {
          const r = solve(P.model, { limit: 1 });
          solved = { code: view.code, solution: r.solution };
          logic = createLogic(P.model);
          plan = null;
        }
        const b = view.board;
        if (!plan || b.values[plan.cell] === plan.v) {
          plan = nextPlacement(P, logic, b, solved.solution, rng);
          if (!plan) return null;
          wait = lo + rng.int(hi - lo + 1);
        }
        if (wait > 0) { wait--; return { type: 'cursor', cell: plan.cell }; }
        const move = { t: 'value', cells: [plan.cell], v: plan.v };
        plan = null;
        return { type: 'move', move };
      };
    },
  },
};

function wrongCells(P, board, solution) {
  return P.open.filter((c) => board.values[c] && board.values[c] !== solution[c]);
}

function countOwners(state) {
  const out = new Array(state.players).fill(0);
  for (const o of state.owner || []) if (o >= 0) out[o]++;
  return out;
}

// The bot's next cell: the next logical placement from the correct values on the board, else an empty cell.
// Wrong entries are excluded from the logic state so the bot does not deduce from them; fallback reveals a random empty cell from the solution.
function nextPlacement(P, logic, board, solution, rng) {
  const values = Array.from(P.model.givens);
  const wrong = new Set();
  for (const c of P.open) {
    const v = board.values[c];
    if (v === solution[c]) values[c] = v;
    else if (v) wrong.add(c);
  }
  const st = logic.stateFrom(values);
  for (let k = 0; k < 60; k++) {
    const s = logic.next(st, { maxLevel: 4 });
    if (!s || s.tech === 'contradiction') break;
    if (s.place && !wrong.has(s.place[0])) return { cell: s.place[0], v: s.place[1] };
    logic.apply(st, s);
  }
  const empty = P.open.filter((c) => !board.values[c]);
  if (!empty.length) return null;
  const c = rng.pick(empty);
  return { cell: c, v: solution[c] };
}
