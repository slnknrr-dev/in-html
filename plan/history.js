// plan/history.js - undo / redo of an editor as JSON snapshots: push the state before a change, undo returns the
// previous state and keeps the current one for redo. Snapshots are strings, so later mutations of the live object
// never leak into the history, and pushing a state equal to the last one is a no-op (a click without a drag).
// A revision counter tells an autosave whether anything changed: `changedSince(mark)`.

// Snapshot (memento) history rather than command objects: every editing operation is free to be any pure function,
// with no inverse to write. Cost: memory per step (plans are small JSON; limit caps it). shift() on overflow is O(n)
// but n <= limit.
export function createHistory({ limit = 100 } = {}) {
  const undo = [], redo = [];
  let rev = 0;
  const snap = (state) => JSON.stringify(state);
  return {
    // Record the state BEFORE a change.
    push(state) {
      const s = snap(state);
      if (undo[undo.length - 1] === s) return false;
      undo.push(s);
      if (undo.length > limit) undo.shift();
      redo.length = 0;
      rev++;
      return true;
    },
    // Previous state (a fresh object) or null; `current` goes onto the redo stack.
    undo(current) {
      if (!undo.length) return null;
      redo.push(snap(current));
      rev++;
      return JSON.parse(undo.pop());
    },
    redo(current) {
      if (!redo.length) return null;
      undo.push(snap(current));
      rev++;
      return JSON.parse(redo.pop());
    },
    get canUndo() { return undo.length > 0; },
    get canRedo() { return redo.length > 0; },
    get size() { return undo.length; },
    get revision() { return rev; },
    changedSince(mark) { return rev !== mark; },
    clear() { undo.length = 0; redo.length = 0; rev++; },
  };
}
