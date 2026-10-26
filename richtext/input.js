// richtext/input.js - keyboard, input and focus handling of rich fields; rtInit binds it, rtOnRender re-attaches
// after a canvas render.
import { canvas } from '../studio/state.js';
import { RT_S, RT_ZW } from './sanitize.js';
import { rtActive, rtCaretEnd, rtCurRange, rtFieldOf, rtFlush, rtIsUI, rtKind, rtNormalizeEl, rtRestoreSel, rtSchedule, rtSetRange, rtUp } from './field.js';
import { rtCmd, rtIndent, rtRun } from './ops.js';
import { rtBuildBar, rtPopClose, rtSchedUpdate, rtUpdateBar } from './toolbar.js';
import { rtOnCopy, rtOnPaste } from './clipboard.js';
import { TBL_S, tblClearSel, tblMultiCells, tblOnCellFocus, tblOp, tblPaint, tblTab } from './table-ui.js';
import { P } from '../doc/product.js';

//
// Event architecture: a few listeners on document/canvas (event delegation), never per field. The canvas is
// re-rendered often (any block change), so per-field listeners would leak or go stale; delegation needs no
// re-binding, and rtOnRender only refreshes references.
// ---------- Keyboard / input / focus events ----------

// Tab order for Enter in plain fields: visible fields only (getClientRects() is empty for display:none ancestors).
function rtFields() {
  return [...canvas.querySelectorAll('[data-f][contenteditable="true"]')].filter((el) => el.getClientRects().length);
}
function rtNextField(f, dir) {
  const all = rtFields();
  const nx = all[all.indexOf(f) + dir];
  if (!nx) return;
  rtFlush();
  nx.focus({ preventScroll: true });
  rtCaretEnd(nx);
  nx.scrollIntoView({ block: 'nearest' });
}
/** Inline fields: Enter inserts <br> (a second trailing <br> makes the new line visible). */
// A <br> at the very end of a block is not rendered as a new line by browsers (it terminates the current line);
// a second <br> gives the new empty line height and a caret slot. The sanitizer later normalizes the pair.
function rtInsertBr(f) {
  const sel = getSelection();
  if (!sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  r.deleteContents();
  const br = document.createElement('br');
  r.insertNode(br);
  const rest = document.createRange();
  rest.setStartAfter(br);
  rest.setEnd(f, f.childNodes.length);
  const fr = rest.cloneContents();
  if (fr.textContent === '' && !fr.querySelector('br')) br.after(document.createElement('br'));
  const c = document.createRange();
  c.setStartAfter(br);
  c.collapse(true);
  rtSetRange(c);
  rtSchedule(f);
}
function rtSelLi(f) {
  const r = rtCurRange(f);
  return r ? rtUp(r.startContainer, f, (a) => a.localName === 'li') : null;
}
// IME guard: during composition (isComposing, or legacy keyCode 229) keys belong to the input method; acting on
// Enter there would split a paragraph in the middle of a Japanese/Chinese conversion.
// Shortcuts use e.code for punctuation/digits (layout-independent physical keys: Ctrl+. is the same key on a
// Russian layout where the character differs) and e.key for letters (follows the user's layout, as users expect
// Ctrl+B to be the key labelled B).
function rtOnKeyDown(e) {
  const f = rtFieldOf(e.target);
  if (!f || e.isComposing || e.keyCode === 229) return;
  const kind = rtKind(f);
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key;
  if (mod && !e.altKey) {
    const lk = k.length === 1 ? k.toLowerCase() : k;
    const run = (fn) => { e.preventDefault(); if (kind !== 'plain') fn(); };
    if (!e.shiftKey && lk === 'b') return run(() => rtCmd('bold'));
    if (!e.shiftKey && lk === 'i') return run(() => rtCmd('italic'));
    if (!e.shiftKey && lk === 'u') return run(() => rtCmd('underline'));
    if (!e.shiftKey && lk === 'k') return run(() => rtCmd('link'));
    if (e.shiftKey && e.code === 'KeyX') return run(() => rtCmd('strike'));
    if (!e.shiftKey && e.code === 'Period') return run(() => rtCmd('sup'));
    if (!e.shiftKey && e.code === 'Comma') return run(() => rtCmd('sub'));
    if (e.code === 'Backslash') return run(() => rtCmd('clear'));
    if (e.shiftKey && e.code === 'Digit7') return run(() => kind === 'rich' && rtCmd('ol'));
    if (e.shiftKey && e.code === 'Digit8') return run(() => kind === 'rich' && rtCmd('ul'));
    return;
  }
  if (k === 'Enter' && !e.altKey) {
    if (kind === 'plain') { e.preventDefault(); if (!e.shiftKey) rtNextField(f, 1); return; }
    if (kind === 'inline') { e.preventDefault(); rtInsertBr(f); return; }
    return; // rich: native paragraph split / Shift+Enter → <br>
  }
  if (k === 'Tab' && !e.altKey) {
    if (kind === 'rich' && rtSelLi(f)) {
      e.preventDefault();
      rtRun((ff, r) => rtIndent(ff, r, e.shiftKey ? -1 : 1), { need: 'rich', multi: false });
      return;
    }
    if (f.matches('td,th')) { e.preventDefault(); tblTab(f, e.shiftKey ? -1 : 1); return; }
    return;
  }
  if (k === 'Escape') {
    if (tblMultiCells()) { e.preventDefault(); e.stopPropagation(); tblClearSel(); return; }
    rtFlush();
    f.blur();
    return;
  }
  if ((k === 'Delete' || k === 'Backspace') && tblMultiCells()) {
    e.preventDefault();
    e.stopPropagation();
    tblOp('clear');
  }
}
function rtIsBare(f) {
  return !f.querySelector('p,h3,h4,ul,ol,blockquote,pre,hr') && f.textContent.replace(RT_ZW, '') === '';
}
// beforeinput is the one place to veto native editing operations before the DOM changes. Native undo is blocked
// because the editor's history (studio/history.js) owns undo across fields and blocks; letting contenteditable undo
// would desynchronize the DOM from the model. Plain and inline fields refuse structural edits by inputType.
function rtOnBeforeInput(e) {
  const f = rtFieldOf(e.target);
  if (!f) return;
  const kind = rtKind(f);
  const it = e.inputType || '';
  if (it === 'historyUndo' || it === 'historyRedo') { e.preventDefault(); return; } // global undo lives in studio/history.js
  if (kind === 'plain' && (it.startsWith('format') || it === 'insertParagraph' || it === 'insertLineBreak')) { e.preventDefault(); return; }
  if (kind === 'inline') {
    if (it === 'insertParagraph') { e.preventDefault(); rtInsertBr(f); return; }
    if (/^format(Justify|Indent|Outdent|SetBlockTextDirection)/.test(it)) { e.preventDefault(); return; }
  }
  if (kind === 'rich' && it === 'insertText' && rtIsBare(f)) {
    // first keystroke in an empty rich field: give it a paragraph to type into
    f.innerHTML = '<p><br></p>';
    const r = document.createRange();
    r.setStart(f.firstChild, 0);
    r.collapse(true);
    rtSetRange(r);
  }
}
// Drag-and-drop, native paste paths and spell-check replacements insert markup the paste handler never saw:
// they are re-sanitized right after the fact. Then the debounced commit.
function rtOnInput(e) {
  const f = rtFieldOf(e.target);
  if (!f) return;
  const it = e.inputType || '';
  if (!RT_S.busy && (it === 'insertFromDrop' || it === 'insertFromPaste' || it === 'insertReplacementText')) {
    RT_S.busy = true;
    try { rtNormalizeEl(f, true); } finally { RT_S.busy = false; }
  }
  if (f.classList.contains(P.prefix + '-missing') || f.dataset.rtMissing) {
    f.dataset.rtMissing = '1';
    f.classList.toggle(P.prefix + '-missing', f.textContent.replace(RT_ZW, '').trim() === '');
  }
  rtSchedule(f);
  rtSchedUpdate();
}
// Engine-wide contenteditable defaults, set lazily on first focus: <p> as the paragraph separator (Chrome
// default is <div>), formatting as tags not inline CSS, and Firefox's built-in table/image resize handles off.
// execCommand is deprecated but remains the only API for these switches; failures are ignored per engine.
function rtOnce() {
  if (RT_S.once) return;
  RT_S.once = true;
  for (const [c, v] of [['defaultParagraphSeparator', 'p'], ['styleWithCSS', false], ['enableObjectResizing', false],
    ['enableInlineTableEditing', false], ['enableAbsolutePositionEditor', false]]) {
    try { document.execCommand(c, false, v); } catch { /* unsupported in this engine */ }
  }
}
function rtOnFocusIn(e) {
  const tg = e.target;
  const f = rtFieldOf(tg);
  if (f) {
    rtOnce();
    if (RT_S.field !== f) RT_S.range = null;
    RT_S.field = f;
    if (f.matches('td[data-r],th[data-r]')) tblOnCellFocus(f);
    else if (!TBL_S.keep) tblClearSel(true);
  } else if (!rtIsUI(tg)) {
    RT_S.field = null;
    RT_S.range = null;
    if (canvas.contains(tg)) tblClearSel(true);
  }
  rtSchedUpdate();
}
// Deferred to the next task: during focusout document.activeElement is still the old element (or body), so the
// real destination is known only after the event. Window blur (switching apps) keeps activeElement on the field,
// which is detected and ignored, so the field keeps its context when the user comes back.
function rtOnFocusOut(e) {
  const f = rtFieldOf(e.target);
  if (!f) return;
  if (e.relatedTarget && rtIsUI(e.relatedTarget)) return; // toolbar / popover / dialog keep the context
  setTimeout(() => {
    if (document.activeElement === f || RT_S.busy) return; // window blur keeps activeElement
    rtFlush();
    if (f.isConnected && !rtIsUI(document.activeElement)) rtNormalizeEl(f, false);
    if (RT_S.field === f && !rtIsUI(document.activeElement)) { RT_S.field = null; RT_S.range = null; }
    rtSchedUpdate();
  }, 0);
}
// selectionchange fires on document for every caret move; the last selection fully inside one field is cached so
// toolbar commands can restore it after the toolbar has taken focus.
function rtOnSelChange() {
  if (RT_S.busy) return;
  const sel = getSelection();
  if (sel.rangeCount) {
    const r = sel.getRangeAt(0);
    const f = rtFieldOf(r.startContainer);
    if (f && f === rtFieldOf(r.endContainer)) { RT_S.field = f; RT_S.range = r.cloneRange(); }
  }
  rtSchedUpdate();
}
// Capture-phase mousedown (registered with true): closes popovers before any click handler of the target runs.
function rtOnDocDown(e) {
  const p = RT_S.pop;
  if (p && !p.el.contains(e.target) && !p.anchor.contains(e.target)) rtPopClose();
}
function rtOnDocKey(e) {
  if (e.key === 'Escape' && RT_S.pop) {
    e.preventDefault();
    rtPopClose();
    const f = rtActive();
    if (f) rtRestoreSel(f);
  }
}

/** Once at startup: build the toolbar, listen on canvas/document. Safe to call again (relabels the toolbar). */
// Idempotent: listeners are attached once (RT_S.inited), but the toolbar is rebuilt on each call so a UI language
// switch can relabel it.
function rtInit() {
  rtBuildBar();
  if (RT_S.inited) return;
  RT_S.inited = true;
  document.addEventListener('selectionchange', rtOnSelChange);
  document.addEventListener('focusin', rtOnFocusIn);
  document.addEventListener('focusout', rtOnFocusOut);
  document.addEventListener('mousedown', rtOnDocDown, true);
  document.addEventListener('keydown', rtOnDocKey);
  window.addEventListener('resize', rtPopClose);
  canvas.addEventListener('beforeinput', rtOnBeforeInput);
  canvas.addEventListener('input', rtOnInput);
  canvas.addEventListener('keydown', rtOnKeyDown);
  canvas.addEventListener('paste', rtOnPaste);
  canvas.addEventListener('copy', (e) => rtOnCopy(e, false));
  canvas.addEventListener('cut', (e) => rtOnCopy(e, true));
  document.addEventListener('click', rtSchedUpdate); // block selection changes made by the editor
}
/** After every canvas (re)render: drop stale references, re-apply table selection, refresh toolbar. */
function rtOnRender() {
  if (RT_S.field && !RT_S.field.isConnected) { RT_S.field = null; RT_S.range = null; }
  const ae = document.activeElement && rtFieldOf(document.activeElement);
  if (ae) RT_S.field = ae;
  if (TBL_S.hover && !TBL_S.hover.cell.isConnected) TBL_S.hover = null;
  tblPaint();
  rtUpdateBar();
}

export {
  rtInit,
  rtOnRender
};
