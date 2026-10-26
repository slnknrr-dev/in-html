// studio/history.js - document changes: commit (snapshot history with coalescing), undo / redo.
//
// Approach: whole-document JSON snapshots, not command objects / inverse operations. Criterion: correctness by
// construction. Any mutate() function, however complex (remapping links, moving trees), is undoable without writing
// its inverse; a missed inverse in a command system silently corrupts the document. Cost: O(document) per commit,
// acceptable because attachment bytes are kept outside S.doc (state.js), so a document is text-sized. Strings, not
// structured clones: immutable, compact, cheap to compare for the no-op check, and restore yields a fully fresh tree.
import { nowISO } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { toast } from '../ui/overlays.js';
import { S } from './state.js';
import { findBlock } from './doc.js';
import { markDirty } from './db.js';
import { renderCSS, renderCanvas, rerenderBlock } from './canvas.js';
import { markSelection } from './select.js';
import { refreshPanels, updateUndoButtons } from './shell.js';
import { rtFlush } from '../richtext/field.js';

// ===========================================================================
// 6. History & commit
// ===========================================================================

// Memory bound: 200 snapshots of a text-sized document; oldest dropped first (shift).
const HIST_MAX = 200;

// Commit pending Part-B text edits (guarded against re-entry: rtFlush itself commits).
let rtFlushing = false;
function flushRT() {
  if (rtFlushing) return;
  rtFlushing = true;
  try { rtFlush(); } catch (e) { console.error(e); } finally { rtFlushing = false; }
}

// mutate(doc) in place after a history snapshot.
// opts: { render: 'all'|'none'|'css'|blockId, coalesce: key, select: bid|null, item, inspector: bool }
// 'css' only rebuilds the page stylesheet (theme variables, margins, gaps) and keeps the canvas markup.
// A commit that leaves the document unchanged (e.g. the 'change' that follows coalesced 'input' commits)
// adds no undo step and does not re-render.
// Coalescing: commits with the same key within 1 s of the previous one share one undo entry (typing in a field
// is one step, not one per character). The window slides (H.time updates on each merge), so continuous typing is a
// single step until a 1 s pause. A mutate() that throws is reported and the snapshot stays: the user can undo
// whatever partial change it made.
function commit(label, mutate, opts = {}) {
  if (!String(opts.coalesce || '').startsWith('field:')) flushRT(); // typing commits come from richtext/ itself
  const H = S.hist;
  const now = Date.now();
  const co = opts.coalesce || null;
  const merge = co && H.key === co && now - H.time < 1000;
  const prev = { key: H.key, time: H.time };
  let snap = null;
  if (!merge) {
    snap = JSON.stringify(S.doc);
    H.undo.push({ snap, sel: { ...S.sel }, label, lang: S.lang });
    if (H.undo.length > HIST_MAX) H.undo.shift();
  }
  H.key = co;
  H.time = now;
  let res;
  try { res = mutate(S.doc); }
  catch (e) { console.error(e); toast(t('err.generic', { msg: e.message }), 'error'); }
  if (snap !== null && JSON.stringify(S.doc) === snap) {
    // No-op: drop the snapshot again and keep the previous coalescing state (typing may continue merging).
    if (H.undo[H.undo.length - 1]?.snap === snap) H.undo.pop();
    H.key = prev.key;
    H.time = prev.time;
    const before = S.sel;
    if (opts.select !== undefined) S.sel = { bid: opts.select, item: opts.item ?? null };
    validateSel();
    if (S.sel.bid !== before.bid || S.sel.item !== before.item) markSelection();
    if (opts.inspector === true) refreshPanels(true);
    else updateUndoButtons();
    return res;
  }
  H.redo.length = 0;
  if (S.doc.meta) S.doc.meta.modified = nowISO();
  if (opts.select !== undefined) S.sel = { bid: opts.select, item: opts.item ?? null };
  validateSel();
  markDirty();
  const r = opts.render === undefined ? 'all' : opts.render;
  if (r === 'all') renderCanvas();
  else if (r === 'css') renderCSS();
  else if (r && r !== 'none') rerenderBlock(r);
  if (r === 'none' || r === 'css') markSelection();
  refreshPanels(opts.inspector === true);
  return res;
}

// Selection may point at a block or list item the change removed: clear it rather than render a dangling chrome.
function validateSel() {
  const { bid, item } = S.sel;
  if (bid && !findBlock(bid)) { S.sel = { bid: null, item: null }; return; }
  if (bid && item != null) {
    const b = findBlock(bid).block;
    if (!Array.isArray(b.items) || !b.items[item]) S.sel.item = null;
  }
}

// Undo and redo are symmetric: the current state goes onto the opposite stack, the entry's snapshot becomes S.doc.
// H.key reset: an edit right after undo must never coalesce into an entry that no longer matches the document.
// The content language is kept when it still exists (the step may have removed it).
function restoreSnapshot(entry, pushTo) {
  pushTo.push({ snap: JSON.stringify(S.doc), sel: { ...S.sel }, label: entry.label, lang: S.lang });
  const keepSel = { ...S.sel };
  // A block the step brings back (undone deletion, redone insertion) becomes the selection.
  const back = entry.sel && entry.sel.bid && !findBlock(entry.sel.bid) ? entry.sel.bid : null;
  S.doc = JSON.parse(entry.snap);
  S.hist.key = null;
  if (!S.doc.langs.includes(S.lang)) S.lang = S.doc.langs.includes(entry.lang) ? entry.lang : S.doc.defaultLang;
  S.sel = back && findBlock(back) ? { ...entry.sel } : findBlock(keepSel.bid) ? keepSel : { ...entry.sel };
  validateSel();
  markDirty();
  renderCanvas();
  refreshPanels(true);
}

function undo() {
  flushRT();
  const e = S.hist.undo.pop();
  if (!e) { toast(t('undo.nothing')); return; }
  restoreSnapshot(e, S.hist.redo);
}
function redo() {
  flushRT();
  const e = S.hist.redo.pop();
  if (!e) { toast(t('redo.nothing')); return; }
  const redoStack = S.hist.redo.slice();
  restoreSnapshot(e, S.hist.undo);
  S.hist.redo = redoStack; // restoreSnapshot does not clear redo, keep remaining entries
}

export {
  commit,
  flushRT,
  redo,
  undo
};
