// battleship/engine.js - the state machine of Sea Battle on a data-driven ruleset (ruleset.js): secret fleets, shots
// and their answers, salvos and volleys, a shot again after a hit, sinkings announced or kept secret, the halo around
// sunk ships, special weapons (radar, air strike, cluster bomb, mines), two to six players in free-for-all or teams.
// Pure functions on plain JSON states, so the same code runs in browsers, on the rooms server, in simulations and
// inside bot searches.
//
//   newGame(ruleset, { players, rng, first, names }) -> state             phase 'place'
//   apply(state, seat, action) -> { state, events, error }                 validated; the input state is never changed
//   applyInPlace(state, seat, action) -> error | null                      the same on a state you own
//   actors(state) -> [seat]          who may act now (every seat without a fleet, or the seat whose turn it is)
//   targets(state, seat) -> [seat]   boards this seat may shoot at;  shootable(state, target) -> [cell]
//   dueFor(state, seat, target) -> number of cells a shot action must name now
//   viewOf(state, seat) -> what that seat may see (seat -1 = spectator);  result(state) -> null | {...}
//   rebuild(state, hist) -> state    the game replayed with a list of [seat, action] (undo in local play: undo())
//   undo(state, seat) -> state | null   the position before `seat`'s last shot (every later action dropped)
//
// Actions: { type: 'place', ships: [{ t, o, x, y }], mines: [cell] } · { type: 'fire', target, cells: [cell] } (one
// cell, or the whole salvo / volley) · { type: 'radar' | 'cluster', target, cell } · { type: 'airstrike', target, cell,
// dir: 'h' | 'v' } · { type: 'resign' }.
//
// Public marks of a board (views): 0 unknown, 1 miss, 2 hit, 3 hit of a shown sunk ship, 4 water marked by the halo,
// 5 an exploded mine. Public log (state.log, also in views): ['P', seat] fleet placed · ['T', seat] a turn begins ·
// ['F', seat, target, count] a fire action (its shots follow) · ['S', shooter, target, cell, ans, t?, cells?] a shot (ans 0 miss, 1 hit, 2 sunk with the type and — when ships are
// shown — the cells, 3 mine) · ['K', mineOwner, victim, cell, ans, t?, cells?] a mine strikes back · ['H', board, cells]
// halo · ['R', seat, target, cell, count] radar · ['A', seat, target, cell, dir] air strike · ['C', seat, target, cell]
// cluster bomb · ['O', seat] a fleet is lost · ['Q', seat] resigned · ['E'] end.

import { normalizeRuleset, playerRange, teamOf } from './ruleset.js';
import { geometry, haloOf, placementCells } from './board.js';
import { validateLayout } from './placement.js';

//
// Architecture: state is plain JSON (serialisable to the server, IndexedDB, replays); all hidden information lives
// in state.boards[i].ships/mines and leaves the module only through viewOf, which is the single information gate.
// The log is the public record: everything in it is visible to everyone, so knowledge.js can rebuild public
// knowledge from it alone. apply() is functional (clone, then mutate the copy) for UIs and the server;
// applyInPlace() skips the clone for searches that own their state.
// JSON clone: simple and correct for plain data; rs is excluded from the clone and re-attached because it is
// immutable and shared (cloning it per move would be wasted work).
const clone = (o) => JSON.parse(JSON.stringify(o));

// hist records every accepted action; rebuild()/undo() replay it, so undo needs no inverse operations (replaying a
// deterministic machine is simpler and cannot drift out of sync with the forward rules).
export function newGame(rsIn, { players = 2, rng = null, first = null, names = [] } = {}) {
  const rs = normalizeRuleset(rsIn);
  const G = geometry(rs);
  const pr = playerRange(rs);
  const n = Math.max(pr.min, Math.min(pr.max, players | 0));
  let f = Number.isInteger(first) && first >= 0 && first < n ? first : null;
  if (f == null) f = rs.rules.first === 'seat0' || !rng ? 0 : rng.int(n);
  const W = rs.weapons;
  return {
    v: 1, rs, n, phase: 'place', seed: rng && rng.kind === 'seeded' ? rng.seed : null,
    names: Array.isArray(names) ? names.slice(0, n) : [],
    first: f, turn: -1, streak: 0,
    boards: Array.from({ length: n }, () => ({ placed: false, ships: null, mines: [], marks: new Array(G.N).fill(0), sunk: [], sunkPub: [], alive: true })),
    charges: Array.from({ length: n }, () => ({ radar: W.radar, airstrike: W.airstrike, cluster: W.cluster })),
    scans: [],
    log: [],
    stats: { shots: new Array(n).fill(0), hits: new Array(n).fill(0), turns: 0 },
    out: [],
    result: null,
    hist: [],
  };
}

// --- queries -------------------------------------------------------------------------------------------------------------

export const isOver = (s) => s.phase === 'over';
const aliveSeat = (s, i) => s.boards[i] && s.boards[i].alive;

export function targets(s, seat) {
  if (seat < 0 || !aliveSeat(s, seat)) return [];
  const out = [];
  for (let i = 0; i < s.n; i++) if (i !== seat && aliveSeat(s, i) && teamOf(s.rs, i) !== teamOf(s.rs, seat)) out.push(i);
  return out;
}

export function shootable(s, target) {
  const G = geometry(s.rs);
  const b = s.boards[target];
  const out = [];
  if (!b) return out;
  for (let c = 0; c < G.N; c++) if (!G.obstacle[c] && b.marks[c] === 0) out.push(c);
  return out;
}

export function afloat(s, seat) {
  const b = s.boards[seat];
  return b && b.ships ? b.ships.length - b.sunk.length : 0;
}

// Shots a fire action of `seat` must name against `target` (before the cap by the free cells when target is null).
// Salvo: one shot per own ship afloat (losing ships weakens your fire, the classic salvo variant). Capped by the free
// cells of the target so a nearly finished board does not demand impossible shots.
export function dueFor(s, seat, target = null) {
  const R = s.rs.rules;
  let due = R.shots === 'salvo' ? afloat(s, seat) : R.shots === 'volley' ? R.volley : 1;
  due = Math.max(1, due);
  if (target != null) due = Math.min(due, shootable(s, target).length);
  return due;
}

export function actors(s) {
  if (s.phase === 'place') { const a = []; for (let i = 0; i < s.n; i++) if (!s.boards[i].placed && s.boards[i].alive) a.push(i); return a; }
  if (s.phase === 'battle' && s.turn >= 0) return [s.turn];
  return [];
}

export const turn = (s) => (s.phase === 'battle' ? s.turn : -1);

// --- actions --------------------------------------------------------------------------------------------------------------

export function apply(state, seat, action) {
  const s = cloneState(state);
  const from = s.log.length;
  const err = applyInPlace(s, seat, action);
  if (err) return { state, events: [], error: err };
  return { state: s, events: s.log.slice(from), error: null };
}

export function cloneState(s) {
  const c = clone({ ...s, rs: null });
  c.rs = s.rs;
  return c;
}

export function applyInPlace(s, seat, action) {
  if (!action || typeof action !== 'object') return 'bad-action';
  if (!Number.isInteger(seat) || seat < 0 || seat >= s.n) return 'not-seated';
  if (s.phase === 'over') return 'over';
  const err = act(s, seat, action);
  if (!err) s.hist.push([seat, clone(action)]);
  return err;
}

// Validation before any mutation: every error return happens before the first state change, so a rejected action
// leaves even an in-place state untouched (applyInPlace relies on this).
function act(s, seat, a) {
  if (a.type === 'resign') return resign(s, seat);
  if (s.phase === 'place') {
    if (a.type !== 'place') return 'placing';
    return place(s, seat, a);
  }
  if (a.type === 'place') return 'already-placed';
  if (seat !== s.turn) return 'not-your-turn';
  const R = s.rs.rules;
  const target = a.target | 0;
  if (!targets(s, seat).includes(target)) return 'bad-target';
  const G = geometry(s.rs);
  const b = s.boards[target];
  const inBoard = (c) => Number.isInteger(c) && c >= 0 && c < G.N;
  let res = null;
  if (a.type === 'fire') {
    const cells = Array.isArray(a.cells) ? a.cells : [];
    const due = dueFor(s, seat, target);
    if (cells.length !== due) return 'wrong-number-of-shots';
    const seen = new Set();
    // Integer, in range, not an obstacle, not already marked, no duplicates: a client can send anything, the engine
    // trusts nothing.
    for (const c of cells) {
      if (!inBoard(c) || G.obstacle[c] || b.marks[c] !== 0) return 'cell-not-free';
      if (seen.has(c)) return 'cell-not-free';
      seen.add(c);
    }
    s.log.push(['F', seat, target, cells.length]);
    res = volley(s, seat, target, cells, 'S');
  } else if (a.type === 'radar' || a.type === 'airstrike' || a.type === 'cluster') {
    if (!(s.charges[seat][a.type] > 0)) return 'no-charges';
    const c = a.cell;
    if (!inBoard(c)) return 'bad-cell';
    const area = weaponCells(s.rs, a.type, c, a.dir);
    if (a.type === 'radar') {
      s.charges[seat].radar--;
      const ships = shipMap(s, target);
      let count = 0;
      for (const x of area) if (ships[x] >= 0) count++;
      s.scans.push({ by: seat, target, cell: c, cells: area, count });
      s.log.push(['R', seat, target, c, count]);
      res = { hit: false, mine: false };
    } else {
      const free = area.filter((x) => !G.obstacle[x] && b.marks[x] === 0);
      if (!free.length) return 'no-effect';
      s.charges[seat][a.type]--;
      s.log.push(a.type === 'airstrike' ? ['A', seat, target, c, a.dir === 'v' ? 'v' : 'h'] : ['C', seat, target, c]);
      res = volley(s, seat, target, free, 'S');
    }
  } else return 'bad-action';
  afterShot(s, seat, res);
  return null;
}

// The cells a weapon covers from cell c.
// Radar: square centred on c (clipped). Air strike: from c to the right or downward, clipped at the edge (the anchor
// is the strike's start, not its centre). Cluster: c and its four side neighbours.
export function weaponCells(rs, kind, c, dir = 'h') {
  const W = rs.board.width, H = rs.board.height;
  const x = c % W, y = (c / W) | 0;
  const out = [];
  if (kind === 'radar') {
    const r = rs.weapons.radarSize, x0 = x - ((r - 1) >> 1), y0 = y - ((r - 1) >> 1);
    for (let yy = y0; yy < y0 + r; yy++) for (let xx = x0; xx < x0 + r; xx++) if (xx >= 0 && yy >= 0 && xx < W && yy < H) out.push(yy * W + xx);
  } else if (kind === 'airstrike') {
    const L = rs.weapons.airstrikeLength;
    for (let k = 0; k < L; k++) {
      const xx = dir === 'v' ? x : x + k, yy = dir === 'v' ? y + k : y;
      if (xx < W && yy < H) out.push(yy * W + xx);
    }
  } else if (kind === 'cluster') {
    for (const [dx, dy] of [[0, 0], [0, -1], [-1, 0], [1, 0], [0, 1]]) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) out.push(yy * W + xx); }
  } else out.push(c);
  return out;
}

// ship index per cell of a board (-1: water)
function shipMap(s, seat) {
  const N = s.boards[seat].marks.length;
  const m = new Int16Array(N).fill(-1);
  const b = s.boards[seat];
  if (b.ships) b.ships.forEach((sh, i) => { for (const c of sh.cells) m[c] = i; });
  return m;
}

function place(s, seat, a) {
  const b = s.boards[seat];
  if (b.placed) return 'already-placed';
  const v = validateLayout(s.rs, { ships: a.ships, mines: a.mines || [] });
  if (!v.ok) return 'bad-layout: ' + v.error;
  b.ships = v.ships.map((x) => ({ t: x.t, o: x.o, x: x.x, y: x.y, p: x.p, cells: x.cells }));
  b.mines = v.mines;
  b.placed = true;
  s.log.push(['P', seat]);
  maybeStart(s);
  return null;
}

function maybeStart(s) {
  if (s.phase !== 'place') return;
  if (s.boards.some((b) => b.alive && !b.placed)) return;
  s.phase = 'battle';
  let f = s.first;
  if (!aliveSeat(s, f)) f = nextSeat(s, f);
  if (checkEnd(s)) return;
  s.turn = f;
  s.streak = 0;
  s.stats.turns++;
  s.log.push(['T', f]);
}

// Shots at several cells of one board (a salvo, a volley, a weapon): { hit, mine }.
// All cells of an action are resolved even after the target fleet is gone: the action was declared as a whole, and
// replays must show every shot that was fired.
function volley(s, seat, target, cells, op) {
  let hit = false, mine = false;
  // every cell of the action is answered, also after the last ship sank (the record keeps the whole salvo)
  for (const c of cells) {
    const ans = strike(s, seat, target, c, op);
    s.stats.shots[seat]++;
    if (ans === 1 || ans === 2) { hit = true; s.stats.hits[seat]++; }
    if (ans === 3) {
      mine = true;
      // the mine strikes back at the same cell of the shooter's board
      if (s.boards[seat].alive) strike(s, target, seat, c, 'K');
    }
  }
  return { hit, mine };
}

// One shot of `by` at cell c of board `target`: marks, sinking, halo, loss of the fleet; returns 0 miss, 1 hit,
// 2 sunk, 3 mine. A shot at a known cell (a mine striking back at a cell already shot) does nothing (-1).
// Mark 4 (halo) on a cell of the same salvo: a ship sunk earlier in this salvo revealed its halo, and the cell was
// chosen before that; it is resolved as a miss rather than rejected, since the salvo was legal when declared.
// A mine struck by the back-fire ('K') does not chain: it returns 0, preventing infinite mine ping-pong.
function strike(s, by, target, c, op) {
  const b = s.boards[target];
  const G = geometry(s.rs);
  if (G.obstacle[c]) return -1;
  // a cell of a salvo that the halo of a ship sunk earlier in the same salvo has already marked: a miss
  if (b.marks[c] === 4 && op === 'S') { b.marks[c] = 1; s.log.push([op, by, target, c, 0]); return 0; }
  if (b.marks[c] !== 0) return -1;
  if (b.mines.includes(c)) {
    b.marks[c] = 5;
    s.log.push([op, by, target, c, 3]);
    return op === 'K' ? 0 : 3;
  }
  const idx = b.ships ? b.ships.findIndex((sh) => sh.cells.includes(c)) : -1;
  if (idx < 0) {
    b.marks[c] = 1;
    s.log.push([op, by, target, c, 0]);
    return 0;
  }
  b.marks[c] = 2;
  const sh = b.ships[idx];
  const sunk = sh.cells.every((x) => b.marks[x] === 2 || b.marks[x] === 3);
  if (!sunk) { s.log.push([op, by, target, c, 1]); return 1; }
  b.sunk.push(idx);
  // Announce levels: 'ship' reveals cells (and the halo), 'sunk' reveals only type and the sinking cell, 'hit' says
  // just "hit" (a sinking looks like any hit; elimination still shows in the log as 'O').
  const A = s.rs.rules.announce;
  if (A === 'ship') {
    for (const x of sh.cells) b.marks[x] = 3;
    b.sunkPub.push({ t: sh.t, at: c, cells: sh.cells.slice() });
    s.log.push([op, by, target, c, 2, sh.t, sh.cells.slice()]);
    if (s.rs.rules.halo && s.rs.rules.touch !== 'any') {
      const halo = haloOf(G, sh.cells).filter((x) => b.marks[x] === 0 && !G.obstacle[x]);
      if (halo.length) {
        for (const x of halo) b.marks[x] = 4;
        s.log.push(['H', target, halo]);
      }
    }
  } else if (A === 'sunk') {
    b.sunkPub.push({ t: sh.t, at: c, cells: null });
    s.log.push([op, by, target, c, 2, sh.t]);
  } else s.log.push([op, by, target, c, 1]);
  if (b.sunk.length === b.ships.length) eliminate(s, target);
  return 2;
}

function eliminate(s, seat) {
  const b = s.boards[seat];
  if (!b.alive) return;
  b.alive = false;
  s.out.push(seat);
  s.log.push(['O', seat]);
}

function resign(s, seat) {
  if (!aliveSeat(s, seat)) return 'out';
  s.log.push(['Q', seat]);
  eliminate(s, seat);
  if (s.phase === 'place') { if (!checkEnd(s)) maybeStart(s); return null; }
  if (checkEnd(s)) return null;
  if (s.turn === seat) passTurn(s, seat);
  return null;
}

// A mine ends the streak even after a hit: the strike-back is the mine's punishment.
function afterShot(s, seat, res) {
  if (checkEnd(s)) return;
  const again = s.rs.rules.afterHit === 'again' && res.hit && !res.mine && aliveSeat(s, seat) && targets(s, seat).length > 0;
  if (again) { s.streak++; return; }
  passTurn(s, seat);
}

function passTurn(s, seat) {
  const nx = nextSeat(s, seat);
  s.turn = nx;
  s.streak = 0;
  s.stats.turns++;
  s.log.push(['T', nx]);
}

// Skips seats that are out or have no target left (in team games a seat whose enemies are all gone cannot act).
export function nextSeat(s, from) {
  for (let k = 1; k <= s.n; k++) {
    const i = (from + k) % s.n;
    if (aliveSeat(s, i) && targets(s, i).length) return i;
  }
  return from;
}

// The game ends when at most one team (or player) has a fleet afloat. winners empty = draw (possible when the last
// two fleets die in the same volley via a mine strike-back).
function checkEnd(s) {
  const teams = new Set();
  for (let i = 0; i < s.n; i++) if (aliveSeat(s, i)) teams.add(teamOf(s.rs, i));
  if (teams.size > 1) return false;
  s.phase = 'over';
  s.turn = -1;
  const winners = [];
  for (let i = 0; i < s.n; i++) if (aliveSeat(s, i)) winners.push(i);
  const team = winners.length && s.rs.rules.teams ? teamOf(s.rs, winners[0]) : null;
  // places: the winners, then the fleets in the reverse order of their loss
  const places = [...winners, ...s.out.slice().reverse().filter((i) => !winners.includes(i))];
  s.result = {
    draw: winners.length === 0, winners, winner: winners.length ? winners[0] : -1, team, places, out: s.out.slice(),
    turns: s.stats.turns, shots: s.stats.shots.slice(), hits: s.stats.hits.slice(),
  };
  s.log.push(['E']);
  return true;
}

export function result(s) {
  return s.phase === 'over' ? s.result : null;
}

// --- views --------------------------------------------------------------------------------------------------------------

// The information gate. Own ships and mines are visible to their owner; everybody's are visible after the game.
// `left` (ships afloat) is public when sinkings are announced, and also under salvo rules, where the number of
// shots a player fires already reveals it. Marks, sunk lists, scans and the log are public by definition.
// The log array is shared, not copied (views are created per message and serialised; copying would double the
// cost); consumers must treat it as read-only.
export function viewOf(s, seat) {
  const over = s.phase === 'over';
  const announced = s.rs.rules.announce !== 'hit' || s.rs.rules.shots === 'salvo';
  return {
    v: 1, rs: s.rs, n: s.n, seat, phase: s.phase, turn: turn(s), first: s.first, streak: s.streak,
    due: s.phase === 'battle' && s.turn >= 0 ? dueFor(s, s.turn) : 0,
    boards: s.boards.map((b, i) => ({
      marks: b.marks.slice(), placed: b.placed, alive: b.alive,
      sunk: b.sunkPub.map((x) => ({ t: x.t, at: x.at, cells: x.cells ? x.cells.slice() : null })),
      left: announced && b.ships ? b.ships.length - b.sunk.length : null,
      ships: (i === seat || over) && b.ships ? b.ships.map((x) => ({ t: x.t, o: x.o, x: x.x, y: x.y, cells: x.cells.slice(), sunk: b.sunk.includes(b.ships.indexOf(x)) })) : null,
      mines: (i === seat || over) ? b.mines.slice() : null,
    })),
    charges: s.charges.map((c) => ({ ...c })),
    scans: s.scans.map((x) => ({ ...x, cells: x.cells.slice() })),
    stats: { shots: s.stats.shots.slice(), hits: s.stats.hits.slice(), turns: s.stats.turns },
    log: s.log, out: s.out.slice(), result: s.result,
    names: s.names,
  };
}

// --- undo (local play) ----------------------------------------------------------------------------------------------------

// The game replayed from the start with another list of actions.
export function rebuild(s, hist) {
  const t = newGame(s.rs, { players: s.n, first: s.first, names: s.names });
  t.seed = s.seed;
  for (const [seat, a] of hist) { const e = applyInPlace(t, seat, a); if (e) throw new Error('rebuild: ' + e); }
  return t;
}

// The position before the last shot (or weapon) of `seat`; null when there is none.
// Undo removes the seat's last shot and everything after it (including other seats' moves), then replays: the only
// consistent way in a game where later moves depended on that shot's answer.
export function undo(s, seat) {
  let k = s.hist.length - 1;
  while (k >= 0 && !(s.hist[k][0] === seat && s.hist[k][1].type !== 'place')) k--;
  if (k < 0) return null;
  return rebuild(s, s.hist.slice(0, k));
}

export { placementCells };
