// sudoku/board.js - a player's board: entered values, corner and centre pencil marks and cell colours, changed only
// by moves (plain JSON, so the same moves travel through multiplayer rooms). Every applied move returns a patch with
// the previous contents of the cells it touched, which undoes it.
//
//   newBoard(size) -> { values, corner, center, colors }       arrays of numbers per frame cell
//   applyMove(board, move, ctx) -> patch | null                 null: the move changes nothing (or is invalid)
//   applyPatch(board, patch) -> inverse patch                  undo / redo
//   validMove(move, ctx) -> boolean
//   filled(board, givens, cells) -> count of cells with a value or a given
//   cloneBoard(board), boardFrom(json, size)
// ctx = { n, size, givens, present, peers (arrays of peer cells, for removing marks), autoNotes }
// Pencil marks are sets (bits.js): an int32 mask, or [lo, hi] on grids above 32 × 32 once a mark above 32 is set.

import { setEq, setHas, setOf, setValid, setWith, setWithout } from './bits.js';
//
// moves: { t: 'value', cells, v }   enter v (toggles off when every cell already holds v)
//        { t: 'erase', cells }      values first, then marks, then colours
//        { t: 'corner' | 'center', cells, v }   toggle a pencil mark (added unless every empty cell has it)
//        { t: 'color', cells, k }   toggle colour k (1..9)
//        { t: 'notes', cells, masks, kind }   set pencil marks (auto candidates, hints)
//        { t: 'restore', patch }    put cells back as a patch describes (undo in shared games)

// Board = four parallel arrays over frame cells (holes included, so an index means the same cell everywhere).
// Moves are data, not functions, so they can be validated, sent over the network and replayed identically.
export const newBoard = (size) => ({
  values: new Array(size).fill(0), corner: new Array(size).fill(0), center: new Array(size).fill(0), colors: new Array(size).fill(0),
});
const copySet = (m) => (Array.isArray(m) ? [...m] : m);
export const cloneBoard = (b) => ({ values: [...b.values], corner: b.corner.map(copySet), center: b.center.map(copySet), colors: [...b.colors] });

export function boardFrom(json, size) {
  const b = newBoard(size);
  if (!json) return b;
  for (const k of ['values', 'corner', 'center', 'colors']) {
    const src = json[k];
    if (!Array.isArray(src) || src.length !== size) continue;
    const marks = k === 'corner' || k === 'center';
    for (let i = 0; i < size; i++) b[k][i] = marks && Array.isArray(src[i]) ? setOf(src[i][0], src[i][1]) : src[i] | 0;
  }
  return b;
}

// Upper bound on cells per move: a 64 x 64 grid has 4096 cells, but a selection beyond 2000 is not a human move;
// the cap bounds the work a single hostile multiplayer message can cause.
const MAX_CELLS = 2000;

// Whitelist validation, type by type; anything not matching exactly is rejected. present[c] excludes the holes of
// multi-grid layouts. 'restore' is the most dangerous move (writes arbitrary cell contents), so it additionally
// refuses givens and validates every field of every patch entry.
export function validMove(m, ctx) {
  if (!m || typeof m !== 'object') return false;
  const { n, size, givens, present } = ctx;
  const okCells = (cells) => Array.isArray(cells) && cells.length > 0 && cells.length <= MAX_CELLS && cells.every((c) => Number.isInteger(c) && c >= 0 && c < size && present[c]);
  switch (m.t) {
    case 'value': return okCells(m.cells) && Number.isInteger(m.v) && m.v >= 1 && m.v <= n;
    case 'erase': return okCells(m.cells);
    case 'corner': case 'center': return okCells(m.cells) && Number.isInteger(m.v) && m.v >= 1 && m.v <= n;
    case 'color': return okCells(m.cells) && Number.isInteger(m.k) && m.k >= 0 && m.k <= 9;
    case 'notes': return okCells(m.cells) && Array.isArray(m.masks) && m.masks.length === m.cells.length && m.masks.every((x) => setValid(x, n)) && (m.kind === 'corner' || m.kind === 'center');
    case 'restore': return Array.isArray(m.patch) && m.patch.length <= MAX_CELLS && m.patch.every((p) => p && Number.isInteger(p.i) && p.i >= 0 && p.i < size && present[p.i] && !givens[p.i]
      && [p.v, p.color].every((x) => Number.isInteger(x) && x >= 0) && p.v <= n && setValid(p.corner, n) && setValid(p.center, n) && p.color <= 9);
    default: return false;
  }
}

// Snapshot of one cell; patches are lists of snapshots, so undo = apply the snapshot list.
const snap = (b, i) => ({ i, v: b.values[i], corner: b.corner[i], center: b.center[i], color: b.colors[i] });

// Mutates b and returns the inverse patch. The touched map records each cell's state BEFORE its first change only,
// so a cell changed twice in one move (value + peer mark removal) still restores to the original. Givens are
// filtered out of the target cells (colours excepted: colouring a given is allowed).
// Toggle semantics everywhere ("off when every target already has it") make a repeated key press undo itself.
export function applyMove(b, m, ctx) {
  if (!validMove(m, ctx)) return null;
  const { givens } = ctx;
  const touched = new Map();
  const touch = (i) => { if (!touched.has(i)) touched.set(i, snap(b, i)); };
  const cells = (m.cells || []).filter((c) => !givens[c]);
  if (m.t === 'value') {
    if (!cells.length) return null;
    const off = cells.every((c) => b.values[c] === m.v);
    for (const c of cells) { touch(c); b.values[c] = off ? 0 : m.v; }
    // Auto-notes: entering v removes v from the pencil marks of every peer, recorded in the same patch so one undo restores both.
    if (!off && ctx.autoNotes && ctx.peers) {
      const v = m.v - 1;
      for (const c of cells) {
        for (const p of ctx.peers[c]) if (setHas(b.corner[p], v) || setHas(b.center[p], v)) { touch(p); b.corner[p] = setWithout(b.corner[p], v); b.center[p] = setWithout(b.center[p], v); }
      }
    }
  // Erase is layered: values first; only when no target holds a value, marks; only then colours (one key clears progressively).
  } else if (m.t === 'erase') {
    if (cells.some((c) => b.values[c])) { for (const c of cells) if (b.values[c]) { touch(c); b.values[c] = 0; } }
    else if (cells.some((c) => b.corner[c] || b.center[c])) { for (const c of cells) if (b.corner[c] || b.center[c]) { touch(c); b.corner[c] = 0; b.center[c] = 0; } }
    else for (const c of m.cells) if (b.colors[c]) { touch(c); b.colors[c] = 0; }
  } else if (m.t === 'corner' || m.t === 'center') {
    const key = m.t, v = m.v - 1;
    const open = cells.filter((c) => !b.values[c]);
    if (!open.length) return null;
    const remove = open.every((c) => setHas(b[key][c], v));
    for (const c of open) { touch(c); b[key][c] = remove ? setWithout(b[key][c], v) : setWith(b[key][c], v); }
  } else if (m.t === 'color') {
    const all = m.cells.every((c) => b.colors[c] === m.k);
    for (const c of m.cells) { touch(c); b.colors[c] = all ? 0 : m.k; }
  } else if (m.t === 'notes') {
    m.cells.forEach((c, k) => { if (givens[c] || b.values[c]) return; touch(c); b[m.kind][c] = setOf(...(Array.isArray(m.masks[k]) ? m.masks[k] : [m.masks[k], 0])); });
  } else if (m.t === 'restore') {
    for (const p of m.patch) { touch(p.i); put(b, p); }
  }
  // Drop no-op entries (e.g. toggles that ended where they started) so an empty result means "nothing changed" (null).
  const patch = [...touched.values()].filter((p) => { const now = snap(b, p.i); return now.v !== p.v || !setEq(now.corner, p.corner) || !setEq(now.center, p.center) || now.color !== p.color; });
  return patch.length ? patch : null;
}

function put(b, p) { b.values[p.i] = p.v; b.corner[p.i] = p.corner; b.center[p.i] = p.center; b.colors[p.i] = p.color; }

// Returns the inverse, so undo / redo is the same call alternating.
export function applyPatch(b, patch) {
  const inverse = patch.map((p) => snap(b, p.i));
  for (const p of patch) put(b, p);
  return inverse;
}

export function filled(b, givens, cells) {
  let k = 0;
  for (const c of cells) if (givens[c] || b.values[c]) k++;
  return k;
}
