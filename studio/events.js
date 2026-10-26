// studio/events.js - canvas events (selection, links, attachment buttons, double-click file picking, context menu,
// stage resize) and the editor keyboard shortcuts.
//
// Design: one delegated listener per event type on #ed-canvas, resolving the block with closest('[data-bid]'),
// never listeners on rendered blocks. The canvas is re-rendered wholesale on many commits; per-node listeners would
// have to be re-attached each time and leak when they are not. data-* attributes are the contract with the
// viewer's edit markup: data-bid (block), data-item (list item index), data-f (editable field), data-att-* (buttons).
import { $$, isEditable } from '../ui/dom.js';
import { guessMime, pickFiles } from '../ui/files.js';
import { t } from '../ui/i18n.js';
import { toast } from '../ui/overlays.js';
import { S, canvas, scroller } from './state.js';
import { findBlock, typeDef } from './doc.js';
import { acceptOK, acceptOf, fieldUploadOpts } from './fields.js';
import { commit, flushRT, redo, undo } from './history.js';
import { addFiles, attButton } from './attach.js';
import { ZOOM_PROP, applyZoom, fitZoom, scheduleMeasure, setZoom } from './canvas.js';
import { chromeEl, scheduleChrome, select, setHover } from './select.js';
import { contextMenu } from '../ui/contextmenu.js';
import { blockMenuItems, copyBlock, deleteBlock, duplicateBlock, focusFirstField, insertPosAfter, moveBlockBy, pasteBlock } from './ops.js';
import { addFirstItem, renderInspector } from './inspector.js';
import { revealActiveLangTab } from './langs.js';
import { saveFile } from './fileio.js';

// ===========================================================================
// 13. Canvas events & keyboard
// ===========================================================================

function bindCanvasEvents() {
  canvas.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (a && canvas.contains(a)) e.preventDefault(); // links never navigate inside the editor
    const ab = e.target.closest('[data-att-dl],[data-att-op],[data-att-pr]');
    if (ab && canvas.contains(ab)) attButton(ab); // same buttons as the exported file, working in the editor too
    const be = e.target.closest('[data-bid]');
    if (!be) { if (!isEditable(e.target)) select(null); return; }
    // "Add an item" box of a list block without items (viewer edit markup): add the first item and focus it.
    const add = e.target.closest('[data-add-item]');
    if (add && add.closest('[data-bid]') === be && !S.readOnly) { addFirstItem(be.dataset.bid); return; }
    const it = e.target.closest('[data-item]');
    const item = it && it.closest('[data-bid]') === be ? +it.dataset.item : null;
    select(be.dataset.bid, Number.isFinite(item) ? item : null);
  });
  // Keyboard users reach fields with Tab, never clicking: focusin keeps the selection in sync (focus bubbles here
  // as focusin; plain focus does not bubble).
  canvas.addEventListener('focusin', (e) => {
    const f = e.target.closest('[data-f]');
    if (!f) return;
    const be = f.closest('[data-bid]');
    if (!be) return;
    const it = f.closest('[data-item]');
    const item = it && it.closest('[data-bid]') === be ? +it.dataset.item : null;
    if (S.sel.bid !== be.dataset.bid || S.sel.item !== item) select(be.dataset.bid, Number.isFinite(item) ? item : null);
  });
  canvas.addEventListener('mouseover', (e) => {
    const be = e.target.closest('[data-bid]');
    setHover(be && canvas.contains(be) ? be : null);
  });
  canvas.addEventListener('mouseleave', () => setHover(null));
  canvas.addEventListener('dblclick', (e) => {
    const be = e.target.closest('[data-bid]');
    if (!be || e.target.closest('[data-f]') || S.readOnly) return;
    // Media boxes rendered by the viewer name the field they show: data-att-key="media" / "items.2.image".
    const ak = e.target.closest('[data-att-key]');
    if (ak && ak.closest('[data-bid]') === be) { e.preventDefault(); pickAttFor(be.dataset.bid, ak.dataset.attKey); return; }
    // Otherwise a block whose only file field is still empty (image, attachment, embed…) picks a file for it.
    const fb = findBlock(be.dataset.bid);
    if (!fb) return;
    const atts = (typeDef(fb.block.type).schema || []).filter((f) => f && f.type === 'att');
    if (atts.length === 1 && !fb.block[atts[0].key]) pickAttFor(fb.block.id, atts[0].key);
  });
  // Clicking the empty stage around the page deselects.
  scroller.addEventListener('mousedown', (e) => {
    if (e.target === scroller || e.target === canvas) select(null);
  });
  scroller.addEventListener('scroll', () => { /* chrome is positioned inside the scroller: no work */ }, { passive: true });
  // Ctrl/Cmd + wheel = zoom the canvas instead of the browser page. passive:false is required to preventDefault;
  // trackpad pinch arrives as wheel with ctrlKey set in Chromium and Firefox, so it zooms too.
  scroller.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    setZoom(S.zoom + (e.deltaY < 0 ? 0.1 : -0.1));
  }, { passive: false });
  // ResizeObserver, not window resize: panels, drawers and content changes resize the canvas without a window event.
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(() => {
      if (S.zoomFit) fitZoom();
      else if (ZOOM_PROP !== 'zoom' && S.zoom !== 1) applyZoom();
      scheduleChrome();
      scheduleMeasure();
    });
    ro.observe(canvas);
    ro.observe(scroller);
  }
  window.addEventListener('resize', () => { scheduleChrome(); revealActiveLangTab(); });
}

// The 'att' field at `path` of a block ('logo', 'items.2.image'), checked against the registry (the path comes
// from canvas markup): → {field, item: index|null, key} or null.
// Security: path comes from DOM attributes, which document content can influence; the strict regexes and the schema
// lookup ensure only declared att fields are written (no '__proto__' or arbitrary key assignment).
function attFieldAt(block, path) {
  const def = typeDef(block.type);
  let m = /^([A-Za-z][\w]{0,40})$/.exec(String(path || ''));
  if (m) {
    const f = (def.schema || []).find((x) => x && x.type === 'att' && x.key === m[1]);
    return f ? { field: f, item: null, key: f.key } : null;
  }
  m = /^items\.(\d{1,4})\.([A-Za-z][\w]{0,40})$/.exec(String(path || ''));
  if (m && Array.isArray(block.items) && block.items[+m[1]]) {
    const f = (def.itemSchema || []).find((x) => x && x.type === 'att' && x.key === m[2]);
    return f ? { field: f, item: +m[1], key: f.key } : null;
  }
  return null;
}

// Upload-and-assign helper for the att field at `path` of a block.
async function pickAttFor(bid, path) {
  const b = findBlock(bid)?.block;
  const at = b && attFieldAt(b, path);
  if (!at) return;
  const files = await pickFiles({ accept: acceptOf(at.field) });
  if (!files.length) return;
  if (!acceptOK(at.field, guessMime(files[0].name, files[0].type))) { toast(t('fld.wrongType', { name: files[0].name }), 'warn'); return; }
  const ids = await addFiles(files.slice(0, 1), { quiet: true, ...fieldUploadOpts(at.field) });
  if (!ids.length) return;
  commit('set file', () => {
    const blk = findBlock(bid)?.block;
    if (!blk) return;
    const o = at.item == null ? blk : blk.items && blk.items[at.item];
    if (o) o[at.key] = ids[0];
  }, { render: bid, select: bid, item: at.item });
  renderInspector();
}

// Two layers. Capture phase on window for truly global keys, so no focused widget can swallow them. Bubble phase
// on document for block shortcuts, so richtext/ (which handles text editing first) can claim a key with
// preventDefault. The onCanvasSide test keeps Delete / arrows / Ctrl+C from acting on a block while the user is in
// an inspector input or panel.
function bindKeyboard() {
  // Capture phase: layers (Esc), undo/redo, save — global.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S.layers.length) {
      e.preventDefault();
      e.stopPropagation();
      S.layers[S.layers.length - 1].onEsc();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) return;
    const k = e.key.toLowerCase();
    const inOverlay = e.target && e.target.closest && e.target.closest('#ed-overlays');
    // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y: document undo, even inside canvas text (rich text commits into history, so the
    // document stack is the only consistent one). Dialog inputs keep native undo; any open layer blocks it.
    if (k === 'z' || k === 'y') {
      if (inOverlay && isEditable(e.target)) return; // native undo inside dialog inputs
      if (S.layers.length) return;
      e.preventDefault();
      e.stopPropagation();
      if (k === 'y' || e.shiftKey) redo(); else undo();
    } else if (k === 's') {
      e.preventDefault();
      e.stopPropagation();
      saveFile(e.shiftKey);
    }
  }, true);

  // Bubble phase: block shortcuts (richtext/ handles text shortcuts first and may preventDefault).
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || S.layers.length) return;
    const tg = e.target;
    const editing = isEditable(tg);
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const bid = S.sel.bid;
    const onCanvasSide = tg === document.body || tg === document.documentElement || canvas.contains(tg) ||
      (chromeEl() && chromeEl().contains(tg)) || !!(tg.closest && tg.closest('#ed-outline'));
    if (k === 'Escape') {
      if (editing && canvas.contains(tg)) { tg.blur(); window.getSelection()?.removeAllRanges(); }
      else if (bid && onCanvasSide) select(null);
      return;
    }
    if (!bid) {
      if (!editing && mod && k.toLowerCase() === 'v' && onCanvasSide) { e.preventDefault(); pasteBlock(); }
      return;
    }
    if (mod && !e.altKey && k.toLowerCase() === 'd' && !(tg.closest && tg.closest('#ed-overlays'))) {
      e.preventDefault();
      flushRT();
      duplicateBlock(bid);
      return;
    }
    if (e.altKey && !mod && (k === 'ArrowUp' || k === 'ArrowDown') && (onCanvasSide || !editing)) {
      e.preventDefault();
      flushRT();
      moveBlockBy(bid, k === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (editing || !onCanvasSide) return;
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); deleteBlock(bid); }
    else if (k === 'Enter') { e.preventDefault(); focusFirstField(bid); }
    else if (mod && k.toLowerCase() === 'c') { e.preventDefault(); copyBlock(bid); }
    else if (mod && k.toLowerCase() === 'x') { e.preventDefault(); copyBlock(bid); deleteBlock(bid); }
    else if (mod && k.toLowerCase() === 'v') { e.preventDefault(); pasteBlock(insertPosAfter(bid)); }
    else if (!mod && (k === 'ArrowUp' || k === 'ArrowDown')) {
      e.preventDefault();
      const all = $$('[data-bid]', canvas);
      const i = all.findIndex((x) => x.dataset.bid === bid);
      const n = all[i + (k === 'ArrowUp' ? -1 : 1)];
      if (n) select(n.dataset.bid, null, { scroll: true });
    }
  });

  // Context menu on blocks (ui/contextmenu.js): the right mouse button, a long press by touch / pen, the Menu key and
  // Shift+F10. The table cell menu (richtext/table-ui.js, capture phase) runs first and wins.
  contextMenu(canvas, (be, info) => {
    const e = info.event;
    if (e.defaultPrevented) return null;
    const f = e.target instanceof Element ? e.target.closest('[data-f]') : null;
    // A long press on editable text keeps the system's selection / callout (editing on touch screens), and the
    // browser menu appears while text is selected (spell check, copy…).
    if (f && f.isContentEditable && (info.via === 'touch' || info.via === 'pen')) return null;
    const s = window.getSelection();
    if (f && s && !s.isCollapsed && f.contains(s.anchorNode)) return null;
    const bid = be.dataset.bid;
    select(bid);
    return blockMenuItems(bid, info.via === 'keyboard' ? be : { x: info.x, y: info.y });
  }, { selector: '[data-bid]', fields: true });
}

export {
  bindCanvasEvents,
  bindKeyboard
};
