// sudoku-game/play.js - the play screen: the board (view.js), number pad, input modes (symbols, corner and centre
// pencil marks, cell colours), keyboard, undo / redo, conflicts and mistakes, hints with explanations (hints.js),
// check / reveal, candidates, timer and pause, save / resume, completion with statistics — for a game alone (the
// solution is known) and for a room (rooms/: shared or race games online or against bots, where moves go through
// room.act and boards come back in views).
//
//   openSolo(game)   game = { puzzle, solution, code, options?, random?, daily?, saved? }
//   openRoom(room, { title?, onLeave? })
//   closePlay()      isPlaying()

//
// State model: three module singletons. G = the game (board, undo/redo of patches, timer, counters), UI = transient
// interaction state (selection, mode, hint stage, pause), board = the view. render*() functions read G/UI and
// rewrite their panel; there is no partial DOM patching beyond panel granularity.
// Solo vs room: solo games know the solution and apply moves locally. Room games apply each move optimistically to
// a COPY of the board (instant feedback and an undo patch), send it with room.act, and accept the authoritative
// board from the next 'view' event; a refused move re-applies the room's view, undoing the optimistic copy.
// Undo is patch-based (sudoku/board.js applyMove returns the inverse patch), so undo/redo cost O(changed cells) and
// the same patches can be sent to a room as 'restore' moves.
import { $, h } from '../ui/dom.js';
import { icon, iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { confirmDialog, layers, openMenu, toast } from '../ui/overlays.js';
import { baseSet, compile } from '../sudoku/model.js';
import { createLogic } from '../sudoku/logic.js';
import { decodePuzzle } from '../sudoku/codec.js';
import { applyMove, applyPatch, boardFrom, cloneBoard, newBoard } from '../sudoku/board.js';
import { setBits, setHas, setUnion, setWithout } from '../sudoku/bits.js';
import { keyMap } from '../sudoku/symbols.js';
import { createBoard } from './view.js';
import { explain, findHint, symHTML, cellName } from './hints.js';
import { clearSave, dailyDone, markDaily, prefs, recordGame, statKey, writeSave } from './store.js';
import { fmtTime, gameTitle, legendNeeded, playerColor, shareLink, solutionText, symbolsOf, variantName } from './common.js';
import { APP } from './shell.js';

const MODES = ['value', 'corner', 'center', 'color'];
const CELL_COLORS = 9;
// Debounced autosave: a burst of inputs writes localStorage once, 500ms after the last.
const SAVE_DELAY = 500;

let G = null;       // the game on screen
let UI = null;      // selection and panels
let board = null;   // view.js board
let root = null;    // .sg-play element
let tickTimer = 0;
let saveTimer = 0;
let keyBound = false;

export const isPlaying = () => !!G;

// --- sessions -------------------------------------------------------------------------------------------------------

// Precomputed per puzzle: peers (cells that see each other), houses per cell (for the peer tint), and perValue =
// how many times each symbol appears in a full solution (equal for every symbol), used by the pad counters.
function prepare(puzzle) {
  const model = compile(puzzle);
  const peers = model.peers.map((x) => Array.from(x));
  const open = Array.from(model.geom.cells).filter((c) => !model.givens[c]);
  // houses of each cell (tinted around the selection)
  const cellHouses = Array.from({ length: model.geom.size }, () => []);
  model.houses.forEach((hs, k) => { for (const c of hs.cells) cellHouses[c].push(k); });
  const perValue = model.geom.cells.length / model.n;
  return {
    puzzle, model, peers, open, cellHouses, perValue,
    ctx: { n: model.n, size: model.geom.size, givens: model.givens, present: model.geom.present, peers, autoNotes: true },
    logic: null,
  };
}

function baseSession(puzzle) {
  const P = prepare(puzzle);
  return {
    ...P, symbols: symbolsOf(puzzle.n), board: newBoard(P.model.geom.size), undo: [], redo: [],
    elapsed: 0, since: 0, hints: 0, mistakes: 0, checks: 0, finished: false, solved: false, marked: null,
  };
}

// Restoring a save validates loosely: numeric fields coerced, undo capped at 200 entries (saved: last 100).
export function openSolo(game) {
  closePlay(true);
  G = { kind: 'solo', ...baseSession(game.puzzle), solution: game.solution, code: game.code, options: game.options || null, random: game.random || null, daily: game.daily || null };
  if (game.saved) {
    const s = game.saved;
    G.board = boardFrom(s.board, G.model.geom.size);
    G.elapsed = +s.elapsed || 0;
    G.hints = s.hints | 0; G.mistakes = s.mistakes | 0; G.checks = s.checks | 0;
    if (Array.isArray(s.undo)) G.undo = s.undo.filter(Array.isArray).slice(-200);
  }
  mount();
  if (!game.saved) saveSoon();
}

// Every room listener is collected in G.offs and removed in closePlay(), so a left room can never repaint a newer game.
export function openRoom(room, opts = {}) {
  closePlay(true);
  const v = room.view;
  const puzzle = decodePuzzle(v.code);
  G = { kind: 'room', ...baseSession(puzzle), room, view: v, code: v.code, seat: room.seat, offs: [], onLeave: opts.onLeave || null, lastFull: false };
  G.title = opts.title || null;
  G.watch = room.seat >= 0 ? room.seat : 0; // race spectators watch one board
  G.offs.push(room.on('view', (view) => applyView(view)));
  G.offs.push(room.on('players', () => renderSide()));
  G.offs.push(room.on('event', (ev) => roomEvent(ev)));
  G.offs.push(room.on('status', (s) => { if (s.status === 'over') roomOver(s.result); else if (s.status === 'playing' && G.finished) { G.finished = false; G.recorded = false; G.since = performance.now(); } renderAll(); }));
  G.offs.push(room.on('error', (e) => { if (e && e.message && e.seat == null) toast(e.message, 'warn'); }));
  G.offs.push(room.on('connection', (c) => { G.connection = c; renderBar(); }));
  G.offs.push(room.on('chat', (m) => APP.chatMessage?.(m)));
  mount();
  applyView(v);
  if (room.status === 'over') roomOver(room.result);
}

// The room is the source of truth: its view replaces the local board each time. A different puzzle code means the
// owner started a rematch, so the session is rebuilt in place (same screen, new puzzle).
function applyView(v) {
  if (!G || G.kind !== 'room' || !v) return;
  if (v.code !== G.code) {
    // a rematch with another puzzle
    const fresh = baseSession(decodePuzzle(v.code));
    Object.assign(G, fresh, { code: v.code });
    board.setPuzzle(G.puzzle, G.symbols);
    UI.selection.clear(); UI.primary = -1; UI.hint = null;
    hideResults();
  }
  G.view = v;
  const src = v.board || (v.boards && v.boards[G.watch]) || null;
  G.board = boardFrom(src, G.model.geom.size);
  G.solved = !!v.solved || (v.mode === 'race' && v.finished.some((x) => x.seat === G.seat));
  if (G.solved && !G.finished) finishRoom();
  if (v.full && !G.lastFull) toast(t('sg.fullWrong'), 'warn');
  G.lastFull = !!v.full;
  renderAll();
}

function roomEvent(ev) {
  if (!G) return;
  const name = (seat) => (G.room.players[seat] && G.room.players[seat].name) || t('sg.player', { n: seat + 1 });
  if (ev.type === 'check') {
    G.marked = new Set(ev.wrong || []);
    toast(ev.wrong.length ? t('sg.checkWrong', { n: ev.wrong.length }) : t('sg.checkOk'), ev.wrong.length ? 'warn' : 'ok');
    renderBoard();
  } else if (ev.type === 'finished' && ev.seat !== G.seat) toast(t('sg.someoneFinished', { name: name(ev.seat), place: ev.place }), 'info');
  else if (ev.type === 'reveal' && ev.seat !== G.seat) toast(t('sg.someoneRevealed', { name: name(ev.seat) }), 'info');
}

// Tear-down order: save, unsubscribe, stop timers (tick, save, delayed results), remove DOM. `silent` skips the save
// when a new game is about to replace this one.
export function closePlay(silent = false) {
  if (!G) return;
  if (G.kind === 'solo' && !silent) saveNow();
  if (G.kind === 'room') { for (const off of G.offs) off(); }
  clearInterval(tickTimer);
  clearTimeout(saveTimer);
  clearTimeout(laterTimer);
  hideResults();
  G = null; UI = null;
  if (root) { root.remove(); root = null; }
  board = null;
  document.body.classList.remove('sg-in-play');
}

// --- layout ---------------------------------------------------------------------------------------------------------------

const EL = {};

// Builds the play screen once per game. The keydown listener is global and bound only once for the page lifetime
// (keyBound); onKey ignores events when no game is on screen. The timer ticks every second only to repaint; the
// time itself is measured with performance.now() deltas (monotonic, immune to system clock changes).
function mount() {
  UI = { selection: new Set(), primary: -1, mode: 'value', pin: 0, hint: null, hintStage: 0, paused: false, cursorSent: -2, cursorTimer: 0 };
  const main = APP.main();
  main.textContent = '';
  document.body.classList.add('sg-in-play');
  EL.title = h('div', { class: 'sg-bar-title' });
  EL.timer = h('span', { class: 'sg-timer', role: 'timer', 'aria-live': 'off' });
  EL.pause = h('button', { type: 'button', class: 'sg-iconbtn', onclick: () => setPaused(!UI.paused) });
  EL.conn = h('span', { class: 'sg-conn', hidden: true });
  EL.bar = h('div', { class: 'sg-bar' },
    h('button', { type: 'button', class: 'sg-iconbtn sg-back', title: t('sg.back'), 'aria-label': t('sg.back'), onclick: () => leave() }, iconEl('chevLeft')),
    EL.title, EL.conn, EL.timer, EL.pause,
    h('button', { type: 'button', class: 'sg-iconbtn', title: t('sg.menu'), 'aria-label': t('sg.menu'), onclick: (e) => gameMenu(e.currentTarget) }, iconEl('more')));
  EL.stage = h('div', { class: 'sg-stage' });
  EL.pauseCover = h('div', { class: 'sg-pausecover', hidden: true },
    h('div', { class: 'sg-pause-t' }, t('sg.paused')),
    h('button', { type: 'button', class: 'ed-btn ed-primary sg-big', onclick: () => setPaused(false) }, iconEl('play'), t('sg.resume')));
  EL.legend = h('div', { class: 'sg-legend', hidden: true });
  EL.players = h('div', { class: 'sg-players', hidden: true });
  EL.boardWrap = h('div', { class: 'sg-boardwrap' }, EL.players, EL.stage, EL.pauseCover, EL.legend);
  EL.modes = h('div', { class: 'sg-modes', role: 'radiogroup', 'aria-label': t('sg.mode') });
  EL.actions = h('div', { class: 'sg-actions' });
  EL.pad = h('div', { class: 'sg-pad' });
  EL.hint = h('div', { class: 'sg-hintbox', hidden: true, 'aria-live': 'polite' });
  EL.info = h('div', { class: 'sg-info' });
  EL.live = h('div', { class: 'sg-sr', 'aria-live': 'polite' });
  EL.side = h('div', { class: 'sg-side' }, EL.info, EL.hint, EL.modes, EL.pad, EL.actions);
  root = h('div', { class: 'sg-play' }, EL.bar, EL.boardWrap, EL.side, EL.live);
  main.append(root);
  board = createBoard(EL.stage, {
    select: (cell, how) => select(cell, how),
    double: (cell) => selectSame(cell),
    menu: (cell, info) => cellMenu(cell, info),
  });
  board.setPuzzle(G.puzzle, G.symbols);
  EL.stage.style.setProperty('--ar', String(boardAspect()));
  if (!keyBound) { document.addEventListener('keydown', onKey); keyBound = true; }
  clearInterval(tickTimer);
  tickTimer = setInterval(tick, 1000);
  G.since = performance.now();
  renderAll();
  requestAnimationFrame(() => { board?.measure(); board?.element.focus({ preventScroll: true }); });
}

// Aspect ratio including the outside-clue margin (~0.75 cell each side) for variants with clues around the grid.
function boardAspect() {
  const geom = G.model.geom;
  const outside = (G.puzzle.clues || []).some((c) => ['sandwich', 'sky', 'xsum', 'frame', 'little'].includes(c.t));
  return outside ? (geom.cols + 1.5) / (geom.rows + 1.5) : geom.cols / geom.rows;
}

// --- time -----------------------------------------------------------------------------------------------------------------

// Time runs only while the game is live, not paused and the tab visible: a backgrounded tab must not count.
const running = () => G && !G.finished && !UI.paused && !document.hidden;
function elapsed() { return G.elapsed + (G.since && running() ? performance.now() - G.since : 0); }
function tick() {
  if (!G) return;
  if (running()) { const now = performance.now(); if (G.since) G.elapsed += now - G.since; G.since = now; } else G.since = 0;
  renderTimer();
}
function freezeTime() { tick(); G.since = 0; }

// tick() first banks the time up to now, so pausing loses or adds nothing.
function setPaused(p) {
  if (!G || G.finished) return;
  tick();
  UI.paused = p;
  if (!p) G.since = performance.now();
  renderBar();
  EL.pauseCover.hidden = !p;
  EL.boardWrap.classList.toggle('sg-is-paused', p);
  if (!p) board.element.focus({ preventScroll: true });
}

// Hiding the tab auto-pauses solo games and saves at once (mobile browsers may kill a hidden tab without further
// events). pagehide is the last reliable moment on unload (beforeunload is unreliable on mobile).
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
  if (!G) return;
  tick();
  if (document.hidden) { if (G.kind === 'solo') { saveNow(); if (!G.finished) setPaused(true); } }
  else G.since = performance.now();
});
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { if (G && G.kind === 'solo') saveNow(); });

// --- saving ---------------------------------------------------------------------------------------------------------------

function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, SAVE_DELAY); }
// The solution is stored with the save: regenerating it from a seed is possible but a crypto-random game has no
// seed, and re-solving a hard imported puzzle at startup could take seconds.
function saveNow() {
  clearTimeout(saveTimer);
  if (!G || G.kind !== 'solo') return;
  if (G.finished) { clearSave(); return; }
  tick();
  writeSave({
    code: G.code, solution: solutionText(G.solution), board: G.board, elapsed: Math.round(G.elapsed), options: G.options, random: G.random,
    hints: G.hints, mistakes: G.mistakes, checks: G.checks, daily: G.daily, undo: G.undo.slice(-100), at: Date.now(),
  });
}

// --- selection --------------------------------------------------------------------------------------------------------------

function valueAt(c) { return G.model.givens[c] || G.board.values[c] || 0; }
const editable = (c) => !G.model.givens[c];

function select(cell, how = 'set') {
  if (!G || cell < 0) return;
  if (how === 'set') { UI.selection = new Set([cell]); UI.primary = cell; }
  else if (how === 'add') { UI.selection.add(cell); UI.primary = cell; }
  else if (how === 'toggle') {
    if (UI.selection.has(cell) && UI.selection.size > 1) { UI.selection.delete(cell); UI.primary = [...UI.selection].pop(); }
    else { UI.selection.add(cell); UI.primary = cell; }
  }
  sendCursor();
  renderBoard();
  renderPad();
  announce();
}

function selectSame(cell) {
  const v = valueAt(cell);
  if (!v) return;
  UI.selection = new Set(Array.from(G.model.geom.cells).filter((c) => valueAt(c) === v));
  UI.primary = cell;
  renderBoard();
}

// Arrow keys wrap around the edges and skip absent cells (holes of samurai-like layouts), at most one full lap.
function moveSelection(dr, dc, extend) {
  const geom = G.model.geom;
  let c = UI.primary >= 0 ? UI.primary : geom.cells[0];
  let r = Math.floor(c / geom.cols), k = c % geom.cols;
  for (let step = 0; step < Math.max(geom.rows, geom.cols); step++) {
    r = (r + dr + geom.rows) % geom.rows;
    k = (k + dc + geom.cols) % geom.cols;
    if (geom.present[r * geom.cols + k]) break;
  }
  const next = r * geom.cols + k;
  select(next, extend ? 'add' : 'set');
  board.ensureVisible(next);
}

// Screen-reader feedback through the visually hidden live region: cell name plus value or pencil marks.
function announce() {
  if (UI.primary < 0) return;
  const c = UI.primary, v = valueAt(c);
  const marks = setBits(setUnion(G.board.center[c], G.board.corner[c])).map((b) => G.symbols[b].text).join(' ');
  EL.live.textContent = `${cellName(G.model, c)}: ${v ? G.symbols[v - 1].text : marks ? t('sg.marks', { marks }) : t('sg.empty')}`;
}

let cursorQueued = false;
// Co-op cursor sharing throttled to one message per 150ms and only when the cell actually changed.
function sendCursor() {
  if (!G || G.kind !== 'room' || G.view.mode !== 'coop' || G.seat < 0 || UI.primary === UI.cursorSent || cursorQueued) return;
  cursorQueued = true;
  setTimeout(() => {
    cursorQueued = false;
    if (!G || UI.primary === UI.cursorSent) return;
    UI.cursorSent = UI.primary;
    G.room.act({ type: 'cursor', cell: UI.primary });
  }, 150);
}

// --- moves --------------------------------------------------------------------------------------------------------------------

const canEdit = () => G && !G.finished && !UI.paused && !(G.kind === 'room' && (G.seat < 0 || G.room.status !== 'playing'));

function targetCells() {
  const list = [...UI.selection];
  return list.length ? list : [];
}

// With no selection a symbol press "pins" that symbol (highlight all its cells) instead of doing nothing: the
// common scanning technique, available without a cell selected.
function input(v) {
  if (!canEdit()) return;
  const cells = targetCells().filter(editable);
  if (!cells.length) {
    UI.pin = UI.pin === v ? 0 : v; // nothing selected: the pad highlights the symbol
    renderBoard(); renderPad();
    return;
  }
  const mode = UI.mode;
  if (mode === 'color') doMove({ t: 'color', cells: targetCells(), k: v });
  else if (mode === 'value') doMove({ t: 'value', cells, v });
  else doMove({ t: mode, cells, v });
}

function erase() {
  if (!canEdit()) return;
  const cells = UI.mode === 'color' ? targetCells() : targetCells().filter(editable);
  if (cells.length) doMove({ t: 'erase', cells });
}

// Mistakes count only for value entries that differ from the solution and are not hint-placed. The undo stack is
// capped at 500 patches; any new move clears redo (linear history).
function doMove(m, { hint = false } = {}) {
  if (!canEdit()) return false;
  const ctx = { ...G.ctx, autoNotes: prefs().autoNotes };
  if (G.kind === 'solo') {
    const patch = applyMove(G.board, m, ctx);
    if (!patch) return false;
    G.undo.push(patch);
    if (G.undo.length > 500) G.undo.shift();
    G.redo = [];
    if (m.t === 'value' || hint) {
      for (const p of patch) {
        const v = G.board.values[p.i];
        if (v && v !== p.v && v !== G.solution[p.i] && !hint) { G.mistakes++; if (prefs().sound) buzz(); }
      }
    }
    G.marked = null;
    if (UI.hintStage && m.t === 'value') clearHint();
    afterChange();
    return true;
  }
  // a room: the patch is worked out on a copy (for undo); the room sends the new board back
  const copy = cloneBoard(G.board);
  const patch = applyMove(copy, m, ctx);
  if (!patch) return false;
  G.undo.push(patch);
  G.redo = [];
  G.board = copy;
  G.marked = null;
  if (UI.hintStage && m.t === 'value') clearHint();
  renderAll();
  G.room.act({ type: 'move', move: m, autoNotes: ctx.autoNotes }).then((r) => {
    if (r && !r.ok && r.error !== 'nothing changed') { toast(t('sg.moveRefused', { msg: r.error }), 'warn'); if (G && G.kind === 'room') applyView(G.room.view); }
  });
  return true;
}

function undo() { history(G.undo, G.redo); }
function redo() { history(G.redo, G.undo); }
function history(from, to) {
  if (!canEdit() || !from.length) return;
  const patch = from.pop();
  if (G.kind === 'solo') {
    to.push(applyPatch(G.board, patch));
    G.marked = null;
    afterChange();
  } else {
    const copy = cloneBoard(G.board);
    to.push(applyPatch(copy, patch));
    G.board = copy;
    renderAll();
    G.room.act({ type: 'move', move: { t: 'restore', patch } });
  }
}

function afterChange() {
  if (G.kind === 'solo') {
    if (G.open.every((c) => G.board.values[c] === G.solution[c])) { finishSolo(true); return; }
    saveSoon();
  }
  renderAll();
}

// Candidates of empty cells from the symbols on the board (rows, columns, boxes, rules that forbid neighbours, cell
// restrictions of the clues).
// "Fill candidates" uses only direct constraints: the base set of the cell (clue restrictions) minus the values
// of its peers. Deliberately no deeper logic: the player should do the reasoning; this saves the bookkeeping.
function candidatesOf(cells) {
  const { model, peers } = G;
  return cells.map((c) => {
    let m = baseSet(model, c);
    for (const p of peers[c]) { const v = valueAt(p); if (v) m = setWithout(m, v - 1); }
    return m;
  });
}

function fillCandidates(all = true) {
  const cells = (all ? G.open : targetCells().filter(editable)).filter((c) => !G.board.values[c]);
  if (!cells.length) return;
  doMove({ t: 'notes', cells, masks: candidatesOf(cells), kind: 'center' });
}

// Two moves (centre, then corner marks) because a notes move targets one mark kind. In solo they are two undo
// steps; acceptable for a rarely used bulk action.
function clearNotes() {
  const cells = G.open.filter((c) => !G.board.values[c] && (G.board.center[c] || G.board.corner[c]));
  if (!cells.length) return;
  const any = doMove({ t: 'notes', cells, masks: cells.map(() => 0), kind: 'center' });
  const corner = cells.filter((c) => G.board.corner[c]);
  if (corner.length) doMove({ t: 'notes', cells: corner, masks: corner.map(() => 0), kind: 'corner' });
  return any;
}

// --- checks and hints ------------------------------------------------------------------------------------------------------

function check() {
  if (!canEdit()) return;
  if (G.kind === 'room') { G.room.act({ type: 'check' }).then((r) => { if (r && !r.ok) toast(t('sg.moveRefused', { msg: r.error }), 'warn'); }); return; }
  G.checks++;
  const wrong = G.open.filter((c) => G.board.values[c] && G.board.values[c] !== G.solution[c]);
  G.marked = new Set(wrong);
  toast(wrong.length ? t('sg.checkWrong', { n: wrong.length }) : t('sg.checkOk'), wrong.length ? 'warn' : 'ok');
  saveSoon();
  renderBoard();
}

function revealCell(cell = UI.primary) {
  if (!canEdit() || cell < 0 || !editable(cell)) return;
  if (G.kind === 'room') { G.room.act({ type: 'reveal', cell }).then((r) => { if (r && !r.ok) toast(t('sg.moveRefused', { msg: r.error }), 'warn'); }); return; }
  if (G.board.values[cell] === G.solution[cell]) return;
  G.hints++;
  doMove({ t: 'value', cells: [cell], v: G.solution[cell] }, { hint: true });
}

function hintsAllowed() { return G.kind === 'solo' || (G.view && G.view.hints); }

// Hint stages: 1 = point at the area only ("look here"), 2 = full explanation and target, then apply. A hint is
// counted when the player goes past stage 1, so a nudge costs nothing in the statistics. The solver (createLogic)
// is built lazily on the first hint, since compiling propagators for big variants is not free.
function showHint() {
  if (!canEdit() || !hintsAllowed()) return;
  G.logic ||= createLogic(G.model);
  const values = G.open.reduce((a, c) => { a[c] = G.board.values[c]; return a; }, new Array(G.model.geom.size).fill(0));
  const raw = findHint({ model: G.model, logic: G.logic, values, solution: G.kind === 'solo' ? G.solution : null });
  UI.hint = { raw, ex: explain(raw, { model: G.model, symbols: G.symbols }) };
  UI.hintStage = 1;
  renderHint();
  renderBoard();
}

function hintShow() {
  if (!UI.hint) return;
  if (UI.hintStage === 1 && G.kind === 'solo') { G.hints++; saveSoon(); }
  UI.hintStage = 2;
  const raw = UI.hint.raw;
  if (raw.kind === 'error' && G.kind === 'solo') G.marked = new Set(raw.cells);
  if (UI.hint.ex.target >= 0) { select(UI.hint.ex.target); board.ensureVisible(UI.hint.ex.target); }
  renderHint();
  renderBoard();
}

function hintApply() {
  if (!UI.hint) return;
  const raw = UI.hint.raw, ex = UI.hint.ex;
  if (UI.hintStage === 1 && G.kind === 'solo') G.hints++;
  if (raw.kind === 'error') {
    if (G.kind === 'solo') doMove({ t: 'erase', cells: raw.cells });
  } else if (ex.target >= 0 && ex.value) {
    if (G.kind === 'room') G.hints++;
    doMove({ t: 'value', cells: [ex.target], v: ex.value }, { hint: true });
  }
  clearHint();
  renderAll();
}

function clearHint() { UI.hint = null; UI.hintStage = 0; renderHint(); }

// --- endings -------------------------------------------------------------------------------------------------------------------

// Results appear after the win animation (900ms) via later(), which drops the call if the player already left
// this game (G changed).
function finishSolo(solved) {
  freezeTime();
  G.finished = true;
  G.solved = solved;
  UI.selection.clear(); UI.primary = -1;
  clearHint();
  clearSave();
  const time = Math.round(G.elapsed);
  const key = statKey({ variant: G.puzzle.variant || 'classic', n: G.puzzle.n, difficulty: G.puzzle.difficulty || 'custom' });
  const rec = recordGame({ key, solved, time, hints: G.hints, mistakes: G.mistakes, mode: G.daily ? 'daily' : 'solo' });
  if (solved && G.daily && dailyDone(G.daily) == null) markDaily(G.daily, time);
  renderAll();
  if (solved && prefs().sound) chime();
  later(() => showResults({ solved, time, rec }), solved ? 900 : 100);
}

function finishRoom() {
  freezeTime();
  G.finished = true;
  UI.selection.clear(); UI.primary = -1;
  clearHint();
  if (prefs().sound) chime();
}

// Statistics recorded once per room game (G.recorded), only for seated players, not spectators.
function roomOver(result) {
  if (!G || G.kind !== 'room') return;
  freezeTime();
  G.finished = true;
  renderAll();
  const time = Math.round(G.elapsed);
  if (!G.recorded && G.seat >= 0) {
    G.recorded = true;
    const won = result && (result.solved || result.winner === G.seat);
    recordGame({ key: statKey({ variant: G.puzzle.variant || 'classic', n: G.puzzle.n, difficulty: G.puzzle.difficulty || 'custom' }), solved: !!won, time, hints: G.hints, mistakes: G.view.progress?.[G.seat]?.mistakes | 0, mode: G.view.mode });
  }
  later(() => showResults({ room: true, result, time }), 700);
}

let resultsEl = null;
let laterTimer = 0;
// A delayed call for the game on screen only (leaving the game cancels it).
function later(fn, ms) {
  const g = G;
  clearTimeout(laterTimer);
  laterTimer = setTimeout(() => { if (G && G === g) fn(); }, ms);
}
function hideResults() { if (resultsEl) { resultsEl.remove(); resultsEl = null; } }

// Result card: role=dialog but non-modal (aria-modal=false): the board stays visible and inspectable behind it.
// Focus moves to the primary action for keyboard users.
function showResults({ solved, time, rec, room, result }) {
  if (!G) return;
  hideResults();
  const rows = [];
  let title, sub = '';
  if (room) {
    const players = G.room.players;
    const name = (s) => (players[s] && players[s].name) || t('sg.player', { n: s + 1 });
    if (G.view.mode === 'coop') {
      title = t('sg.coopWon');
      const counts = result && result.owner ? result.owner : [];
      counts.forEach((k, s) => rows.push([h('span', { class: 'sg-dot', style: { background: playerColor(s) } }), name(s), t('sg.cellsBy', { n: k })]));
    } else {
      const winner = result && result.winner;
      title = winner === G.seat ? t('sg.youWon') : t('sg.raceOver', { name: name(winner) });
      for (const f of (result && result.finished) || []) rows.push([h('span', { class: 'sg-dot', style: { background: playerColor(f.seat) } }), `${f.place}. ${name(f.seat)}`, '']);
    }
    sub = t('sg.timeIs', { time: fmtTime(time) });
  } else if (solved) {
    title = G.daily ? t('sg.dailySolved') : t('sg.solved');
    sub = t('sg.timeIs', { time: fmtTime(time) });
    if (rec.best && rec.previous != null) rows.push(['🏆', t('sg.newBest'), fmtTime(time)]);
    else if (rec.record.best != null) rows.push(['', t('sg.bestTime'), fmtTime(rec.record.best)]);
    rows.push(['', t('sg.hintsUsed'), String(G.hints)]);
    rows.push(['', t('sg.mistakesMade'), String(G.mistakes)]);
    rows.push(['', t('sg.solvedCount'), String(rec.record.solved)]);
  } else {
    title = t('sg.revealed');
    sub = t('sg.revealedSub');
  }
  const card = h('div', { class: 'sg-result', role: 'dialog', 'aria-modal': 'false', 'aria-label': title },
    h('div', { class: 'sg-result-burst', 'aria-hidden': 'true' }, ...Array.from({ length: 14 }, (_, i) => h('i', { style: { '--i': i } }))),
    h('h2', { class: 'sg-result-t' }, title),
    sub ? h('p', { class: 'sg-result-sub' }, sub) : null,
    rows.length ? h('dl', { class: 'sg-result-rows' }, rows.map(([ic, k, v]) => h('div', {}, h('dt', {}, ic, k), h('dd', {}, v)))) : null,
    h('div', { class: 'sg-result-actions' },
      room ? null : h('button', { type: 'button', class: 'ed-btn', onclick: () => { hideResults(); } }, iconEl('eye'), t('sg.viewBoard')),
      room ? null : h('button', { type: 'button', class: 'ed-btn', onclick: () => { hideResults(); APP.again(G); } }, iconEl('refresh'), t('sg.again')),
      room && G.room.local ? h('button', { type: 'button', class: 'ed-btn', onclick: () => { hideResults(); APP.rematch?.(G.room); } }, iconEl('refresh'), t('sg.rematch')) : null,
      room && !G.room.local && G.room.isOwner ? h('button', { type: 'button', class: 'ed-btn', onclick: () => { hideResults(); APP.rematch?.(G.room); } }, iconEl('refresh'), t('sg.rematch')) : null,
      h('button', { type: 'button', class: 'ed-btn ed-primary', onclick: () => leave(true) }, iconEl('plus'), room ? t('sg.leaveRoom') : t('sg.newGame'))));
  resultsEl = h('div', { class: 'sg-result-wrap' }, card);
  root.append(resultsEl);
  card.querySelector('.ed-primary').focus({ preventScroll: true });
}

async function leave(force = false) {
  if (!G) return;
  if (G.kind === 'room') {
    if (!force && !G.finished && G.seat >= 0 && !(await confirmDialog(t('sg.leaveRoom'), t('sg.leaveRoomQ'), t('sg.leaveRoom')))) return;
    const room = G.room, after = G.onLeave;
    closePlay(true);
    try { room.leave(); } catch { /* gone */ }
    if (after) after(); else APP.home();
    return;
  }
  closePlay();
  APP.home();
}

// --- menus --------------------------------------------------------------------------------------------------------------------

function gameMenu(anchor) {
  if (!G) return;
  const solo = G.kind === 'solo';
  const live = canEdit();
  openMenu(anchor, [
    { label: t('sg.newGame'), icon: 'plus', action: () => leave(true) },
    solo ? { label: t('sg.restart'), icon: 'refresh', disabled: G.finished, action: restart } : null,
    { sep: true },
    hintsAllowed() ? { label: t('sg.check'), icon: 'check', disabled: !live, action: check } : null,
    hintsAllowed() ? { label: t('sg.revealCell'), icon: 'eye', disabled: !live || UI.primary < 0 || !editable(UI.primary), action: () => revealCell() } : null,
    { label: t('sg.fillCands'), icon: 'grid', disabled: !live, action: () => fillCandidates(true) },
    { label: t('sg.clearNotes'), icon: 'eraser', disabled: !live, action: clearNotes },
    solo ? { label: t('sg.showSolution'), icon: 'flag', danger: true, disabled: G.finished, action: giveUp } : null,
    { sep: true },
    { label: t('sg.rules'), icon: 'book', action: () => APP.rules(G.puzzle.variant || 'classic') },
    solo ? { label: t('sg.share'), icon: 'link', action: () => APP.share(G) } : null,
    { label: t('sg.export'), icon: 'print', action: () => APP.exportGame(G) },
    { sep: true },
    { label: t('sg.settings'), icon: 'settings', action: () => APP.settings() },
    { label: t('sg.help'), icon: 'help', action: () => APP.help() },
    document.fullscreenEnabled ? { label: document.fullscreenElement ? t('sg.exitFullscreen') : t('sg.fullscreen'), icon: 'fullscreen', action: toggleFullscreen } : null,
  ]);
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => toast(t('sg.noFullscreen'), 'warn'));
}

async function restart() {
  if (!(await confirmDialog(t('sg.restart'), t('sg.restartQ'), t('sg.restart'), true))) return;
  G.board = newBoard(G.model.geom.size);
  G.undo = []; G.redo = [];
  G.elapsed = 0; G.since = performance.now(); G.hints = 0; G.mistakes = 0; G.checks = 0; G.marked = null;
  clearHint();
  saveNow();
  renderAll();
}

async function giveUp() {
  if (!(await confirmDialog(t('sg.showSolution'), t('sg.showSolutionQ'), t('sg.showSolution'), true))) return;
  for (const c of G.open) G.board.values[c] = G.solution[c];
  finishSolo(false);
}

function cellMenu(cell, info) {
  if (!G || G.finished) return null;
  if (cell === -2) cell = UI.primary; // keyboard: the selected cell
  if (cell < 0) return null;
  if (!UI.selection.has(cell)) select(cell);
  const v = valueAt(cell);
  const live = canEdit();
  const sel = targetCells().filter(editable);
  const header = UI.selection.size > 1 ? t('sg.nCells', { n: UI.selection.size }) : cellName(G.model, cell);
  const items = [{ header: true, label: header }];
  items.push({ label: t('sg.pencilMode'), checked: UI.mode === 'center' || UI.mode === 'corner', disabled: !live, action: () => setMode(UI.mode === 'value' ? 'center' : 'value') });
  if (v) items.push({ label: t(UI.pin === v ? 'sg.unhighlight' : 'sg.highlightSym', { s: G.symbols[v - 1].text }), icon: 'sparkle', action: () => { UI.pin = UI.pin === v ? 0 : v; renderBoard(); renderPad(); } });
  if (sel.some((c) => !G.board.values[c])) items.push({ label: t('sg.cellCands'), icon: 'grid', disabled: !live, action: () => fillCandidates(false) });
  if (sel.some((c) => G.board.values[c] || G.board.center[c] || G.board.corner[c]) || UI.selection.size && [...UI.selection].some((c) => G.board.colors[c])) items.push({ label: t('sg.clearCell'), icon: 'eraser', disabled: !live, action: () => { const m = UI.mode; UI.mode = 'value'; erase(); UI.mode = m; } });
  if (hintsAllowed() && editable(cell)) items.push({ label: t('sg.revealCell'), icon: 'eye', disabled: !live, action: () => revealCell(cell) });
  return items;
}

function setMode(m) {
  UI.mode = m;
  renderModes();
  renderPad();
}

// --- keyboard ------------------------------------------------------------------------------------------------------------------

const DIGIT_CODE = /^(?:Digit|Numpad)(\d)$/;

// Keyboard map: digits/letters by the alphabet's key map; Shift+digit = corner mark, Alt+digit = centre mark, read
// from e.code (physical key), because Shift+1 gives "!" in e.key and the layout varies by country. Ctrl+Z/Y undo,
// Z X C V switch modes, H hint, P pause, +/-/0 zoom. Ignored inside fields and while a dialog or menu is open.
function onKey(e) {
  if (!G || !root || !root.isConnected) return;
  if (layers.length || resultsEl) return;
  const tgt = e.target;
  if (tgt && tgt.closest && tgt.closest('input, textarea, select, [contenteditable="true"], .ed-dialog')) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key;
  if (ctrl && !e.altKey && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (ctrl && !e.altKey && (k === 'y' || k === 'Y')) { e.preventDefault(); redo(); return; }
  if (ctrl) return;
  if (UI.paused) { if (k === 'p' || k === 'P' || k === ' ' || k === 'Enter') { e.preventDefault(); setPaused(false); } return; }
  const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  if (arrows[k]) { e.preventDefault(); moveSelection(...arrows[k], e.shiftKey); return; }
  if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); erase(); return; }
  if (k === 'Escape') { if (UI.hint) clearHint(); else { UI.selection.clear(); UI.primary = -1; } renderBoard(); return; }
  if (k === ' ' && tgt === board.element) { e.preventDefault(); setMode(MODES[(MODES.indexOf(UI.mode) + 1) % MODES.length]); return; }
  // symbols: the key itself, digits by their key code (Shift / Alt change the mark kind)
  const keys = UI.keyMap || (UI.keyMap = keyMap(G.symbols));
  let v = 0;
  const dm = DIGIT_CODE.exec(e.code || '');
  if (dm && (e.shiftKey || e.altKey)) v = +dm[1] === 0 ? (G.symbols.length >= 10 ? 10 : 0) : +dm[1];
  else v = keys.get(k) || keys.get(String(k).toLowerCase()) || 0;
  if (v && v <= G.symbols.length) {
    e.preventDefault();
    if (UI.mode === 'value' && (e.shiftKey || e.altKey)) {
      const m = UI.mode;
      UI.mode = e.shiftKey ? 'corner' : 'center';
      input(v);
      UI.mode = m;
    } else input(v);
    return;
  }
  const shortcuts = { z: 'value', x: 'corner', c: 'center', v: 'color' };
  const low = String(k).toLowerCase();
  if (shortcuts[low]) { e.preventDefault(); setMode(shortcuts[low]); return; }
  if (low === 'h') { e.preventDefault(); if (UI.hint) hintShow(); else showHint(); return; }
  if (low === 'p') { e.preventDefault(); setPaused(true); return; }
  if (k === '+' || k === '=') { board.zoom(1.3); return; }
  if (k === '-' || k === '_') { board.zoom(1 / 1.3); return; }
  if (k === '0' && !keys.has('0')) board.zoom('fit');
}

// --- rendering ------------------------------------------------------------------------------------------------------------------

function renderAll() {
  if (!G || !root) return;
  renderBar();
  renderBoard();
  renderModes();
  renderPad();
  renderActions();
  renderInfo();
  renderSide();
  renderHint();
  renderLegend();
}

function renderBar() {
  if (!G) return;
  EL.title.textContent = G.title || gameTitle(G.puzzle);
  EL.title.title = EL.title.textContent;
  EL.pause.hidden = G.finished;
  EL.pause.innerHTML = icon(UI.paused ? 'play' : 'pause');
  EL.pause.title = t(UI.paused ? 'sg.resume' : 'sg.pause');
  EL.pause.setAttribute('aria-label', EL.pause.title);
  const c = G.kind === 'room' && !G.room.local ? G.connection || 'open' : null;
  EL.conn.hidden = !c || c === 'open';
  EL.conn.textContent = c ? t('sg.conn.' + c) : '';
  renderTimer();
}

function renderTimer() {
  if (!G || !EL.timer) return;
  EL.timer.hidden = !prefs().timer;
  EL.timer.textContent = fmtTime(elapsed());
}

// Cells that break a rule: equal symbols that must differ, cell restrictions of clues, and every fully filled clue or
// rule whose propagator rejects the symbols.
// Memoised by the board values string: render runs often (selection moves), values change rarely. Two passes:
// cheap pairwise checks (peers with equal values, values outside the cell's base set), then each non-house
// constraint whose cells are all filled is run through its propagator on a scratch copy; a propagator that empties
// a cell rejects the filled values. Wide grids skip the second pass (too slow, houses already checked).
function conflicts() {
  const key = G.board.values.join(',');
  if (G.conflictKey === key) return G.conflictSet;
  const { model, peers } = G;
  const out = new Set();
  const vals = Array.from(model.geom.cells, (c) => [c, valueAt(c)]).filter(([, v]) => v);
  for (const [c, v] of vals) {
    if (!setHas(baseSet(model, c), v - 1)) out.add(c);
    for (const p of peers[c]) if (valueAt(p) === v) { out.add(c); out.add(p); }
  }
  if (model.wide) { G.conflictKey = key; G.conflictSet = out; return out; } // houses and pairs only: checked above
  const cand = new Int32Array(model.geom.size);
  for (const c of model.geom.cells) { const v = valueAt(c); cand[c] = v ? 1 << (v - 1) : model.base[c]; }
  for (const k of model.cons) {
    if (k.house !== undefined) continue;
    let full = true;
    for (const c of k.cells) if (!valueAt(c)) { full = false; break; }
    if (!full) continue;
    const work = cand.slice();
    let ok;
    try { ok = k.prop(work, (c, m) => { const nw = work[c] & m; if (!nw) return false; work[c] = nw; return true; }); } catch { ok = true; }
    if (!ok) for (const c of k.cells) out.add(c);
  }
  G.conflictKey = key;
  G.conflictSet = out;
  return out;
}

// Assembles the view state: peer tint only for a single selection, same-symbol highlight from the selection or the
// pinned symbol, wrong cells from "show mistakes" or the last check, hint overlays by stage.
function renderBoard() {
  if (!G || !board) return;
  const p = prefs();
  const sel = UI.selection;
  let tint = null;
  if (p.peers && UI.primary >= 0 && sel.size === 1) {
    tint = new Set();
    for (const hs of G.cellHouses[UI.primary]) for (const c of G.model.houses[hs].cells) tint.add(c);
  }
  const pv = UI.primary >= 0 ? valueAt(UI.primary) : 0;
  const highlight = p.same ? (pv || UI.pin) : UI.pin;
  let wrong = null;
  if (G.kind === 'solo') {
    if (p.mistakes) wrong = new Set(G.open.filter((c) => G.board.values[c] && G.board.values[c] !== G.solution[c]));
    if (G.marked) wrong = new Set([...(wrong || []), ...G.marked]);
  } else {
    if (G.view.wrong) wrong = new Set(G.view.wrong);
    if (G.marked) wrong = new Set([...(wrong || []), ...G.marked]);
  }
  let hint = null;
  if (UI.hint) {
    const ex = UI.hint.ex;
    hint = UI.hintStage >= 2 ? { area: ex.area, cells: ex.cells, target: ex.target, value: ex.value, elim: ex.elim } : { area: ex.area, cells: [], target: -1, elim: [] };
    if (UI.hint.raw.kind === 'error' && UI.hintStage < 2) hint = { area: [], cells: [], target: -1, elim: [] };
  }
  let cursors = null, owners = null;
  if (G.kind === 'room' && G.view.mode === 'coop') {
    cursors = (G.view.cursors || []).map((cell, s) => (s === G.seat || cell < 0 ? null : { cell, color: playerColor(s), label: (G.room.players[s]?.name || '?').slice(0, 1).toUpperCase() })).filter(Boolean);
    if (p.owners) owners = G.view.owner;
  }
  board.render({
    values: G.board.values, givens: G.model.givens, corner: G.board.corner, center: G.board.center, colors: G.board.colors,
    selection: sel, primary: UI.primary, highlight, tint, conflicts: p.conflicts ? conflicts() : null, wrong, hint,
    cursors, owners, ownerColors: owners ? G.room.players.map((_, s) => playerColor(s)) : null,
    won: G.finished && G.solved, readOnly: G.kind === 'room' && G.seat < 0,
  });
}

function renderModes() {
  if (!G) return;
  EL.modes.textContent = '';
  const labels = { value: ['sg.m.value', 'type'], corner: ['sg.m.corner', 'cornerMark'], center: ['sg.m.center', 'centerMark'], color: ['sg.m.color', 'palette'] };
  for (const m of MODES) {
    const on = UI.mode === m;
    EL.modes.append(h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(on), class: 'sg-mode' + (on ? ' sg-on' : ''), title: t(labels[m][0] + 'Hint'),
      onclick: () => setMode(m),
    }, iconEl(labels[m][1]), h('span', {}, t(labels[m][0]))));
  }
  EL.modes.hidden = G.finished || (G.kind === 'room' && G.seat < 0);
}

// The pad shows how many of each symbol are still missing (perValue - placed); a completed symbol dims. Right-click
// (contextmenu) on a key pins that symbol.
function renderPad() {
  if (!G) return;
  const p = prefs();
  EL.pad.textContent = '';
  const n = G.symbols.length;
  EL.pad.style.setProperty('--cols', String(padColumns(n)));
  EL.pad.classList.toggle('sg-pad-colors', UI.mode === 'color');
  EL.pad.classList.toggle('sg-pad-many', n > 25 && UI.mode !== 'color'); // big alphabets: smaller keys, the pad scrolls
  EL.pad.hidden = G.finished || (G.kind === 'room' && G.seat < 0);
  if (UI.mode === 'color') {
    EL.pad.style.setProperty('--cols', String(padColumns(CELL_COLORS)));
    for (let k = 1; k <= CELL_COLORS; k++) {
      EL.pad.append(h('button', { type: 'button', class: `sg-key sg-key-col sg-col-${k}`, 'aria-label': t('sg.colorN', { n: k }), onclick: () => input(k) }, h('span', { class: 'sg-swatch-k' })));
    }
    return;
  }
  const counts = new Array(n + 1).fill(0);
  for (const c of G.model.geom.cells) { const v = valueAt(c); if (v) counts[v]++; }
  const selVal = UI.primary >= 0 ? valueAt(UI.primary) : 0;
  for (let v = 1; v <= n; v++) {
    const s = G.symbols[v - 1];
    const left = Math.round(G.perValue - counts[v]);
    const done = left <= 0;
    const btn = h('button', {
      type: 'button', class: 'sg-key' + (done ? ' sg-done' : '') + ((UI.pin || selVal) === v ? ' sg-key-hl' : '') + (UI.mode !== 'value' ? ' sg-key-note' : ''),
      'aria-label': s.color ? t('sg.colorSymbol', { n: v }) : s.text, onclick: () => input(v),
    }, s.color ? h('span', { class: 'sg-key-sw', style: { background: s.color } }) : h('span', { class: 'sg-key-s' }, s.text),
    p.counts && !done ? h('small', { class: 'sg-key-n' }, String(left)) : null);
    btn.addEventListener('contextmenu', (e) => { e.preventDefault(); UI.pin = UI.pin === v ? 0 : v; renderBoard(); renderPad(); });
    EL.pad.append(btn);
  }
}

// Phones: one row up to 10 symbols, else rows of at most ~9 balanced (ceil(n / ceil(n/9))). Wide screens: a square-ish
// grid (3x3 for 9, 4x4 for 16, 5x5 for 25), 8 columns above.
function padColumns(n) {
  const phone = matchMedia('(max-width: 899px)').matches;
  if (phone) return n <= 10 ? n : Math.ceil(n / Math.ceil(n / 9));
  if (n <= 9) return 3;
  if (n <= 16) return 4;
  return n <= 25 ? 5 : 8;
}

function renderActions() {
  if (!G) return;
  EL.actions.textContent = '';
  const live = canEdit();
  const btn = (ic, label, fn, disabled = false, cls = '') => h('button', { type: 'button', class: 'sg-act' + (cls ? ' ' + cls : ''), title: t(label), disabled: disabled || !live, onclick: fn }, iconEl(ic), h('span', {}, t(label)));
  EL.actions.append(
    btn('undo', 'sg.undo', undo, !G.undo.length),
    btn('redo', 'sg.redo', redo, !G.redo.length),
    btn('eraser', 'sg.erase', erase, !UI.selection.size),
    btn('grid', 'sg.notesAll', () => fillCandidates(true), false, 'sg-act-wide'),
    hintsAllowed() ? btn('bulb', 'sg.hint', () => (UI.hint && UI.hintStage === 1 ? hintShow() : showHint()), false, 'sg-act-hint') : null);
  EL.actions.hidden = G.finished || (G.kind === 'room' && G.seat < 0);
}

function renderInfo() {
  if (!G) return;
  EL.info.textContent = '';
  const rows = [];
  const p = G.puzzle;
  rows.push(h('div', { class: 'sg-info-title' }, variantName(p.variant || 'classic'), h('button', { type: 'button', class: 'sg-link', onclick: () => APP.rules(p.variant || 'classic') }, t('sg.rulesShort'))));
  const tags = [];
  if (p.difficulty) tags.push(t('sg.d.' + p.difficulty));
  const graded = ['', 'easy', 'medium', 'hard', 'expert', 'master', 'extreme', 'beyond'][Math.min(7, p.level | 0)];
  if (p.level && graded !== p.difficulty) tags.push(t('sg.grade', { level: t('sg.lv.' + Math.min(7, p.level)) }));
  tags.push(`${p.n}×${p.n}`);
  rows.push(h('div', { class: 'sg-tags' }, tags.map((x) => h('span', { class: 'sg-tag' }, x))));
  if (G.kind === 'solo') {
    if (G.random && G.random.kind === 'seeded') {
      rows.push(h('div', { class: 'sg-seedrow' }, h('span', { class: 'sg-muted' }, t('sg.seed')), h('code', { class: 'sg-seed' }, G.random.seed),
        h('button', { type: 'button', class: 'sg-iconbtn sg-sm', title: t('sg.copySeed'), 'aria-label': t('sg.copySeed'), onclick: () => APP.copy(G.random.seed) }, iconEl('copy'))));
    }
    if (G.daily) rows.push(h('div', { class: 'sg-muted' }, t('sg.dailyOf', { date: G.daily })));
    rows.push(h('div', { class: 'sg-stats-line sg-muted' }, t('sg.hintsN', { n: G.hints }), ' · ', t('sg.mistakesN', { n: G.mistakes })));
  } else {
    const v = G.view;
    rows.push(h('div', { class: 'sg-muted' }, t(v.mode === 'coop' ? 'sg.coopInfo' : 'sg.raceInfo'), G.seat < 0 ? ' · ' + t('sg.spectating') : ''));
    const buttons = [];
    if (!G.room.local && APP.invite) buttons.push(h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => APP.invite(G.room) }, iconEl('link'), t('sg.invite')));
    if (!G.room.local) buttons.push(h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => APP.chat(G.room) }, iconEl('chat'), t('sg.chat')));
    if (buttons.length) rows.push(h('div', { class: 'sg-row' }, buttons));
  }
  EL.info.append(...rows);
}

function renderSide() {
  if (!G) return;
  if (G.kind !== 'room') { EL.players.hidden = true; return; }
  const v = G.view;
  const players = G.room.players || [];
  EL.players.hidden = false;
  EL.players.textContent = '';
  players.forEach((pl, s) => {
    if (!pl || pl.name == null) return;
    const pr = v.progress[s] || { filled: 0, total: 1 };
    const fin = v.finished.find((x) => x.seat === s);
    const pct = Math.round((pr.filled / Math.max(1, pr.total)) * 100);
    const watchable = v.mode === 'race' && G.seat < 0 && v.boards;
    EL.players.append(h(watchable ? 'button' : 'div', {
      class: 'sg-pl' + (s === G.seat ? ' sg-me' : '') + (watchable && G.watch === s ? ' sg-on' : '') + (pl.connected ? '' : ' sg-away'),
      type: watchable ? 'button' : null, style: { '--c': playerColor(s) },
      onclick: watchable ? () => { G.watch = s; applyView(G.view); } : null,
      title: pl.name,
    },
    h('span', { class: 'sg-pl-dot' }, pl.bot ? iconEl('bot') : (pl.name || '?').slice(0, 1).toUpperCase()),
    h('span', { class: 'sg-pl-name' }, pl.name + (s === G.seat ? ' ' + t('sg.you') : '')),
    v.mode === 'race' ? h('span', { class: 'sg-pl-bar' }, h('i', { style: { width: pct + '%' } })) : null,
    v.mode === 'race' ? h('span', { class: 'sg-pl-pct' }, fin ? '#' + fin.place : pct + '%') : null));
  });
}

// Hint lines are HTML produced by hints.js with all dynamic parts escaped there; plain strings here go through
// escHTML before innerHTML.
function renderHint() {
  if (!G || !EL.hint) return;
  const H = UI.hint;
  EL.hint.hidden = !H;
  EL.hint.textContent = '';
  if (!H) return;
  const ex = H.ex, raw = H.raw;
  const body = h('div', { class: 'sg-hint-body' });
  const early = UI.hintStage < 2 && (raw.kind === 'steps' || raw.kind === 'reveal');
  if (!early) body.innerHTML = ex.lines.map((l) => `<p>${l}</p>`).join('');
  else body.innerHTML = `<p>${escHTML(t(raw.kind === 'reveal' ? 'sg.hint.revealLook' : 'sg.hint.look'))}</p>`;
  const lvl = ex.level ? h('span', { class: 'sg-hint-lvl sg-lv-' + Math.min(7, ex.level) }, t('sg.lv.' + Math.min(7, ex.level))) : null;
  const canApply = !early && (raw.kind === 'steps' || raw.kind === 'reveal') && ex.target >= 0;
  EL.hint.append(
    h('div', { class: 'sg-hint-head' }, iconEl('bulb'), h('b', {}, ex.title), lvl,
      h('button', { type: 'button', class: 'sg-iconbtn sg-sm', title: t('dlg.close'), 'aria-label': t('dlg.close'), onclick: () => { clearHint(); renderBoard(); } }, iconEl('close'))),
    body,
    h('div', { class: 'sg-hint-actions' },
      UI.hintStage < 2 && raw.kind !== 'solved' && raw.kind !== 'stuck' && raw.kind !== 'contradiction' ? h('button', { type: 'button', class: 'ed-btn ed-sm' + (early ? ' ed-primary' : ''), onclick: hintShow }, iconEl('eye'), t(raw.kind === 'error' ? 'sg.hint.showErrors' : raw.kind === 'reveal' ? 'sg.hint.revealBtn' : 'sg.hint.explain')) : null,
      canApply ? h('button', { type: 'button', class: 'ed-btn ed-sm ed-primary', onclick: hintApply }, iconEl('check'), t('sg.hint.apply', { s: G.symbols[ex.value - 1]?.text || '' })) : null,
      raw.kind === 'error' && G.kind === 'solo' ? h('button', { type: 'button', class: 'ed-btn ed-sm ed-primary', onclick: hintApply }, iconEl('eraser'), t('sg.hint.fix')) : null));
}

const escHTML = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function renderLegend() {
  if (!G) return;
  const need = legendNeeded(G.puzzle, G.symbols);
  EL.legend.hidden = !need;
  if (!need) return;
  EL.legend.innerHTML = `<span class="sg-legend-t">${escHTML(t('sg.legend'))}</span> ` + G.symbols.map((s, i) => `<span class="sg-legend-i">${symHTML(G.symbols, i + 1)}=${i + 1}</span>`).join('');
}

// Preferences or the alphabet changed while playing.
// Symbols compared by JSON: only a real alphabet change redraws the static board layers.
export function refreshPlay() {
  if (!G || !board) return;
  const syms = symbolsOf(G.puzzle.n);
  if (JSON.stringify(syms) !== JSON.stringify(G.symbols)) {
    G.symbols = syms;
    UI.keyMap = null;
    board.setSymbols(syms);
  }
  renderAll();
}

// --- sounds (tiny synthesized clicks; off by default) -------------------------------------------------------------------------

let audio = null;
// Sounds synthesised with WebAudio (no audio files to ship). The AudioContext is created lazily on the first sound,
// which happens inside a user gesture, satisfying autoplay policies. Exponential ramps to 0.0001 (not 0: an
// exponential ramp cannot reach zero) avoid clicks at note ends.
function tone(freqs, dur = 0.12, type = 'sine', gain = 0.05) {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audio.currentTime;
    freqs.forEach((fq, i) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = type; o.frequency.value = fq;
      g.gain.setValueAtTime(0, t0 + i * dur * 0.8);
      g.gain.linearRampToValueAtTime(gain, t0 + i * dur * 0.8 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * dur * 0.8 + dur);
      o.connect(g).connect(audio.destination);
      o.start(t0 + i * dur * 0.8); o.stop(t0 + i * dur * 0.8 + dur + 0.02);
    });
  } catch { /* no audio */ }
}
const buzz = () => tone([180], 0.15, 'square', 0.03);
const chime = () => tone([523, 659, 784, 1047], 0.18, 'triangle', 0.06);
