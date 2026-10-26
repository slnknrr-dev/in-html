// studio/select.js - block selection and hover, the floating block chrome.
import { $, $$, appendKids, h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { S, canvas, scroller } from './state.js';
import { findBlock, isTransparent, typeIconEl } from './doc.js';
import { blockEl, itemEls } from './canvas.js';
import { deleteBlock, duplicateBlock, insertPosAfter, moveBlockBy, openBlockMenu, openInsertMenu } from './ops.js';
import { endDrag, rvDragData } from './dnd.js';
import { renderInspector } from './inspector.js';
import { highlightOutline } from './left.js';
import { setRightTab } from './right.js';

// ===========================================================================
// 10. Selection & block chrome
// ===========================================================================

// Selection is a class on the rendered block, never a re-render: selecting must be O(1) and must not destroy an
// active contenteditable or a playing media element in the canvas.
function markSelection() {
  for (const e of $$('.ed-sel, .ed-item-sel', canvas)) e.classList.remove('ed-sel', 'ed-item-sel');
  const be = blockEl(S.sel.bid);
  if (!be) return;
  be.classList.add('ed-sel');
  if (S.sel.item != null) {
    const it = itemEls(be).find((x) => +x.dataset.item === S.sel.item);
    if (it) it.classList.add('ed-item-sel');
  }
}

// The inspector is rebuilt only when the selection actually changed (or force): rebuilding on every click would
// discard focus and half-typed values in inspector fields. The 'ed-select' event lets products react without
// studio importing them.
function select(bid, item = null, opts = {}) {
  if (bid && !findBlock(bid)) bid = null;
  const changed = S.sel.bid !== bid || S.sel.item !== (bid ? item : null);
  S.sel = { bid: bid || null, item: bid ? item : null };
  markSelection();
  positionChrome();
  if (changed || opts.force) {
    if (bid && opts.tab !== false && S.rightTab !== 'block') setRightTab('block');
    else renderInspector();
    highlightOutline();
  }
  if (opts.scroll && bid) {
    const be = blockEl(bid);
    if (be) be.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  document.dispatchEvent(new CustomEvent('ed-select', { detail: { ...S.sel } }));
}

const chromeEl = () => $('#ed-chrome');
// rAF-throttled: scroll and resize fire many times per frame; positioning once per frame avoids layout thrash
// (each positionChrome reads layout with getBoundingClientRect).
let chromeRAF = 0;
function scheduleChrome() {
  cancelAnimationFrame(chromeRAF);
  chromeRAF = requestAnimationFrame(positionChrome);
}

function buildChrome(bid) {
  const ch = chromeEl();
  const fb = findBlock(bid);
  if (!ch || !fb) return;
  ch.textContent = '';
  ch.dataset.for = bid;
  // mousedown preventDefault: clicking a chrome button must not steal focus from (and thus blur / commit) an
  // active rich-text field or collapse its selection. stopPropagation keeps the canvas click handler from reselecting.
  const btn = (ic, title, fn, cls = '') => h('button', {
    type: 'button', class: 'ed-chrome-btn ' + cls, title, 'aria-label': title, html: icon(ic),
    onmousedown: (e) => e.preventDefault(), onclick: (e) => { e.stopPropagation(); fn(e); },
  });
  const grip = h('span', {
    class: 'ed-chrome-grip', draggable: 'true', title: t('blk.drag'), 'aria-label': t('blk.drag'), role: 'button', tabindex: '-1', html: icon('grip'),
    ondragstart: (e) => {
      S.drag = { kind: 'move', bid };
      e.dataTransfer.effectAllowed = 'move';
      rvDragData(e, 'block:' + bid);
      const be = blockEl(bid);
      if (be) { try { e.dataTransfer.setDragImage(be, 12, 12); } catch { /* ignore */ } be.classList.add('ed-dragging'); }
    },
    ondragend: endDrag,
  });
  const label = h('span', { class: 'ed-chrome-label' }, typeIconEl(fb.block.type), t('b.' + fb.block.type));
  appendKids(ch, [
    grip, label,
    fb.parent && !isTransparent(fb.parent) ? btn('parent', t('blk.parent'), () => select(fb.parent.id, null, { scroll: true })) : null,
    btn('up', t('blk.up'), () => moveBlockBy(bid, -1)),
    btn('down', t('blk.down'), () => moveBlockBy(bid, 1)),
    btn('copy', t('blk.dup'), () => duplicateBlock(bid)),
    btn('plus', t('blk.add'), (e) => openInsertMenu(e.currentTarget, insertPosAfter(bid))),
    btn('more', t('blk.more'), (e) => openBlockMenu(bid, e.currentTarget)),
    btn('trash', t('blk.del'), () => deleteBlock(bid), 'ed-danger'),
  ]);
}

// The chrome lives inside the scroller (absolute, scroll coordinates), not position:fixed: it scrolls with the
// block for free and stays clipped to the stage. Placed above the block; flipped inside its top edge when there is no
// room above; clamped horizontally to the visible width. Rebuilt only when the block or the UI language changed.
function positionChrome() {
  const ch = chromeEl();
  if (!ch) return;
  const be = blockEl(S.sel.bid);
  if (!be) { ch.hidden = true; ch.dataset.for = ''; return; }
  if (ch.dataset.for !== S.sel.bid || ch.dataset.lang !== S.uiLang) { buildChrome(S.sel.bid); ch.dataset.lang = S.uiLang; }
  ch.hidden = false;
  const sr = scroller.getBoundingClientRect();
  const r = be.getBoundingClientRect();
  const chH = ch.offsetHeight || 30;
  let top = r.top - sr.top + scroller.scrollTop - chH - 6;
  if (top < scroller.scrollTop + 2) top = Math.max(scroller.scrollTop + 2, r.top - sr.top + scroller.scrollTop + 2);
  let left = r.left - sr.left + scroller.scrollLeft;
  const maxLeft = scroller.scrollLeft + scroller.clientWidth - (ch.offsetWidth || 260) - 8;
  left = Math.max(4, Math.min(left, maxLeft));
  ch.style.top = Math.round(top) + 'px';
  ch.style.left = Math.round(left) + 'px';
}

let hoverEl = null;
function setHover(el) {
  if (hoverEl === el) return;
  if (hoverEl) hoverEl.classList.remove('ed-hover');
  hoverEl = el;
  if (el) el.classList.add('ed-hover');
}

export {
  chromeEl,
  markSelection,
  scheduleChrome,
  select,
  setHover
};
