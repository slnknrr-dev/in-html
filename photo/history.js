// photo/history.js - undo / redo stack of the photo editor with a memory budget. An entry is
// { label, icon?, cmd? (has a command equivalent), undo(), redo(), bytes? }; `index` is the last applied entry
// (-1: the initial state). Pushing drops the redo branch; the oldest entries go when the bytes exceed the budget or
// the count exceeds maxEntries (at least one entry stays).

//
// Design: command pattern (each entry owns its undo / redo closures) rather than full-document snapshots. A snapshot
// per edit of a multi-layer 4K document is tens of MB; an entry stores only what it changed (often a dirty rectangle
// of one layer), and `bytes` is the entry's own estimate of that. The byte budget, not just the count, bounds memory:
// 150 tiny text edits and 3 full-canvas filters cost very different amounts.
export function createHistory({ budget = 512 * 1024 * 1024, maxEntries = 150, onChange = () => {} } = {}) {
  const entries = [];
  let index = -1, bytes = 0, base = 0; // base: how many entries were dropped from the start (for "initial state" labels)

  // Drop from the oldest end only while index > 0: the current entry is never dropped, so undo always has at least the
  // last action even when one entry alone exceeds the budget. dispose() releases resources (canvases, bitmaps) held by
  // closures, which the GC cannot see as large.
  function trim() {
    while (entries.length > 1 && (bytes > budget || entries.length > maxEntries) && index > 0) {
      const e = entries.shift();
      bytes -= e.bytes || 0;
      index--;
      base++;
      if (e.dispose) e.dispose();
    }
  }

  const h = {
    get entries() { return entries; },
    get index() { return index; },
    get bytes() { return bytes; },
    get dropped() { return base; },
    get canUndo() { return index >= 0; },
    get canRedo() { return index < entries.length - 1; },
    push(entry) {
      // Linear history: a new action after undo discards the redo branch (no undo tree), the convention users expect.
      for (const e of entries.splice(index + 1)) { bytes -= e.bytes || 0; if (e.dispose) e.dispose(); }
      entries.push(entry);
      bytes += entry.bytes || 0;
      index = entries.length - 1;
      trim();
      onChange(h);
    },
    undo() {
      if (index < 0) return false;
      entries[index].undo();
      index--;
      onChange(h);
      return true;
    },
    redo() {
      if (index >= entries.length - 1) return false;
      index++;
      entries[index].redo();
      onChange(h);
      return true;
    },
    /** State after entry i (-1: before the first kept entry). */
    // Replays undo / redo step by step instead of restoring a state directly: entries only know deltas, so the walk is
    // the only correct path. Cost is linear in the distance, fine for a history panel click.
    jump(i) {
      i = Math.max(-1, Math.min(entries.length - 1, i));
      while (index > i) { entries[index].undo(); index--; }
      while (index < i) { index++; entries[index].redo(); }
      onChange(h);
    },
    clear() { for (const e of entries) if (e.dispose) e.dispose(); entries.length = 0; index = -1; bytes = 0; base = 0; onChange(h); },
  };
  return h;
}
