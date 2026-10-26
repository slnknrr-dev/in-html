// richtext/table-ui.js - table editing UI: cell selection, table toolbar, context menu, column resizing.
import { walkBlocks } from '../doc/model.js';
import { t } from '../ui/i18n.js';
import { openMenu, toast } from '../ui/overlays.js';
import { S, canvas } from '../studio/state.js';
import { findBlock } from '../studio/doc.js';
import { commit } from '../studio/history.js';
import { rerenderBlock } from '../studio/canvas.js';
import { select } from '../studio/select.js';
import { RT_S, rtEsc } from './sanitize.js';
import { rtBid, rtCaretEnd, rtEl, rtFlush } from './field.js';
import { RT_ICO, rtBtn, rtGrp, rtHost, rtPalette, rtPopOpen, rtSchedUpdate } from './toolbar.js';
import { tblClear, tblDeleteCols, tblDeleteRows, tblDistribute, tblExpand, tblInsertCol, tblInsertRow, tblMerge, tblNextCell, tblNormalize, tblOrigin, tblOrigins, tblRescale, tblSetCells, tblSplit } from './table-model.js';

// ---------- Table editing UI: cell selection, toolbar, context menu, column resize ----------

// State model: selection lives in MODEL coordinates (block id + r1,c1,r2,c2 over the dense grid of
// table-model.js), not as DOM element references, because every structural operation re-renders the block and
// replaces the cell elements. DOM cells carry data-r/data-c (origin coordinates) so the two can be joined at any
// time. `keep` suppresses the focus handler while code moves focus itself; `anchor` is the fixed corner for
// shift+click and drags; `rs` is an active column resize, `hover` the resize-ready boundary under the pointer.
const TBL_S = { sel: null, anchor: null, drag: null, hover: null, rs: null, inited: false, ui: {}, keep: false };
const TBL_CELL = 'td[data-r][data-c],th[data-r][data-c]';

function tblBlockEl(bid) {
  return bid ? canvas.querySelector(`[data-bid="${CSS.escape(bid)}"]`) : null;
}
function tblCellEls(bid) {
  const b = tblBlockEl(bid);
  return b ? [...b.querySelectorAll(TBL_CELL)] : [];
}
function tblModel(bid) {
  const fb = bid ? findBlock(bid) : null;
  return fb && fb.block.type === 'table' && Array.isArray(fb.block.rows) ? fb.block : null;
}
/** Repair the grid only when it is actually broken (normalizeDoc normally guarantees the invariant). */
// Cheap shape check first: tblNormalize allocates a coverage bitmap and runs on every toolbar refresh otherwise.
function tblEnsure(tb) {
  const C = Array.isArray(tb.cols) ? tb.cols.length : 0;
  const ok = C > 0 && Array.isArray(tb.rows) && tb.rows.length > 0 && tb.rows.every((row) => Array.isArray(row) &&
    row.length === C && row.every((x) => x && typeof x === 'object' && x.cs >= 1 && x.rs >= 1));
  if (!ok) tblNormalize(tb);
  return tb;
}
/** Cell elements of the current multi-cell selection, or null when fewer than two cells are selected. */
// A merged cell is included only when its whole span lies inside the rectangle (rowSpan/colSpan from the DOM).
function tblMultiCells() {
  const s = TBL_S.sel;
  if (!s || !s.multi) return null;
  const els = tblCellEls(s.bid).filter((el) => {
    const r = +el.dataset.r;
    const c = +el.dataset.c;
    return r >= s.r1 && c >= s.c1 && r + (el.rowSpan || 1) - 1 <= s.r2 && c + (el.colSpan || 1) - 1 <= s.c2;
  });
  return els.length > 1 ? els : null;
}
function tblSetRect(bid, r1, c1, r2, c2) {
  const tb = tblModel(bid);
  if (!tb) { TBL_S.sel = null; tblPaint(); return null; }
  tblEnsure(tb);
  const rect = tblExpand(tb, r1, c1, r2, c2);
  TBL_S.sel = { bid, ...rect, multi: tblOrigins(tb, rect).length > 1 };
  tblPaint();
  rtSchedUpdate();
  return TBL_S.sel;
}
function tblClearSel(soft = false) {
  if (soft && TBL_S.keep) return;
  if (!TBL_S.sel && !TBL_S.anchor) return;
  TBL_S.sel = null;
  TBL_S.anchor = null;
  tblPaint();
  rtSchedUpdate();
}
/** Highlight selected cells (.ed-cell-sel) — only for multi-cell selections. */
function tblPaint() {
  for (const el of canvas.querySelectorAll('.ed-cell-sel')) el.classList.remove('ed-cell-sel');
  const s = TBL_S.sel;
  if (!s) return;
  const tb = tblModel(s.bid);
  if (!tb || s.r2 >= tb.rows.length || s.c2 >= tb.cols.length) { TBL_S.sel = null; return; }
  const els = tblMultiCells();
  if (els) for (const el of els) el.classList.add('ed-cell-sel');
}
function tblOnCellFocus(cell) {
  if (TBL_S.keep || TBL_S.drag) return;
  const bid = rtBid(cell);
  const r = +cell.dataset.r;
  const c = +cell.dataset.c;
  const s = TBL_S.sel;
  if (s && s.bid === bid && s.multi && r >= s.r1 && r <= s.r2 && c >= s.c1 && c <= s.c2) return;
  TBL_S.anchor = { bid, r, c };
  tblSetRect(bid, r, c, r, c);
}
/** Current table context: selection, else the selected table block (cell 0,0). */
function tblCtx() {
  const s = TBL_S.sel;
  let bid = s ? s.bid : null;
  let tb = tblModel(bid);
  if (!tb) { bid = S.sel && S.sel.bid; tb = tblModel(bid); }
  if (!tb) return null;
  tblEnsure(tb);
  const src = s && s.bid === bid ? s : { r1: 0, c1: 0, r2: 0, c2: 0 };
  const rect = tblExpand(tb, src.r1, src.c1, src.r2, src.c2);
  return { bid, tb, rect, multi: tblOrigins(tb, rect).length > 1 };
}
/** Focus a cell (origin of the merge covering r,c) with the caret at the end. */
function tblFocusCell(bid, r, c) {
  const tb = tblModel(bid);
  if (!tb) return;
  const [or, oc] = tblOrigin(tb, r, c);
  const el = tblCellEls(bid).find((x) => +x.dataset.r === or && +x.dataset.c === oc);
  if (!el) return;
  TBL_S.keep = true;
  try {
    el.focus({ preventScroll: true });
    rtCaretEnd(el);
    RT_S.field = el;
  } finally { TBL_S.keep = false; }
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
/** Structural op: pure fn(tableBlock) → commit → re-render → restore selection/focus. */
// Every structural op: flush pending typing first (else it would be committed after, against a changed grid),
// mutate the model inside commit() (one undo step, normalized before and after), re-render only this block, then
// restore selection and caret by coordinates.
function tblApply(bid, fn, focus, rect) {
  rtFlush();
  let res;
  commit(t('rt.h.table'), () => {
    const x = findBlock(bid);
    if (x && x.block.type === 'table') { tblNormalize(x.block); res = fn(x.block); tblNormalize(x.block); }
  }, { render: 'none' });
  rerenderBlock(bid);
  if (focus) {
    const [fr, fc] = focus;
    if (rect) tblSetRect(bid, rect.r1, rect.c1, rect.r2, rect.c2); else tblSetRect(bid, fr, fc, fr, fc);
    TBL_S.anchor = { bid, r: fr, c: fc };
    tblFocusCell(bid, fr, fc);
  }
  tblPaint();
  rtSchedUpdate();
  return res;
}
function tblDeleteTable(bid) {
  rtFlush();
  commit(t('rt.h.table'), () => {
    const x = findBlock(bid);
    if (x) x.list.splice(x.index, 1);
  }, { render: 'all' });
  TBL_S.sel = null;
  TBL_S.anchor = null;
  RT_S.field = null;
  select(null);
  toast(t('tb.deleted'), 'info');
  rtSchedUpdate();
}
/** Table toolbar / context-menu actions. */
// Toggle semantics for cell properties: if every selected cell already has the value, clear it; else set it on all.
// Deleting all rows or all columns deletes the table instead (the model refuses an empty grid). Focus after a
// delete moves to the nearest surviving row/column.
function tblOp(kind, arg) {
  const ctx = tblCtx();
  if (!ctx) return;
  const { bid, tb, rect } = ctx;
  const { r1, c1, r2, c2 } = rect;
  const R = tb.rows.length;
  const C = tb.cols.length;
  const toggle = (prop, v) => {
    const list = tblOrigins(tb, rect).map(([r, c]) => tb.rows[r][c][prop]);
    return list.every((x) => x === v) ? (prop === 'th' ? false : '') : v;
  };
  switch (kind) {
    case 'rowAbove': tblApply(bid, (b) => tblInsertRow(b, r1), [r1, c1]); break;
    case 'rowBelow': tblApply(bid, (b) => tblInsertRow(b, r2 + 1), [r2 + 1, c1]); break;
    case 'colLeft': tblApply(bid, (b) => tblInsertCol(b, c1), [r1, c1]); break;
    case 'colRight': tblApply(bid, (b) => tblInsertCol(b, c2 + 1), [r1, c2 + 1]); break;
    case 'delRows':
      if (r1 === 0 && r2 === R - 1) { tblDeleteTable(bid); break; }
      tblApply(bid, (b) => tblDeleteRows(b, r1, r2), [Math.min(r1, R - (r2 - r1 + 1) - 1), c1]);
      break;
    case 'delCols':
      if (c1 === 0 && c2 === C - 1) { tblDeleteTable(bid); break; }
      tblApply(bid, (b) => tblDeleteCols(b, c1, c2), [r1, Math.min(c1, C - (c2 - c1 + 1) - 1)]);
      break;
    case 'merge':
      if (!ctx.multi) { toast(t('tb.mergeHint'), 'info'); break; }
      tblApply(bid, (b) => tblMerge(b, r1, c1, r2, c2), [r1, c1]);
      break;
    case 'split': {
      const [or, oc] = tblOrigin(tb, r1, c1);
      const o = tb.rows[or][oc];
      if (o.cs === 1 && o.rs === 1) { toast(t('tb.splitHint'), 'info'); break; }
      tblApply(bid, (b) => tblSplit(b, or, oc), [or, oc], { r1: or, c1: oc, r2: or + o.rs - 1, c2: oc + o.cs - 1 });
      break;
    }
    case 'header': tblApply(bid, (b) => { b.header = arg; }, [r1, c1], rect); break;
    case 'style': tblApply(bid, (b) => { b.style = arg; }, [r1, c1], rect); break;
    case 'th': { const v = toggle('th', true); tblApply(bid, (b) => tblSetCells(b, rect, { th: v }), [r1, c1], rect); break; }
    case 'bg': tblApply(bid, (b) => tblSetCells(b, rect, { bg: arg || '' }), [r1, c1], rect); break;
    case 'align': { const v = toggle('align', arg); tblApply(bid, (b) => tblSetCells(b, rect, { align: v }), [r1, c1], rect); break; }
    case 'va': { const v = toggle('va', arg); tblApply(bid, (b) => tblSetCells(b, rect, { va: v }), [r1, c1], rect); break; }
    case 'distribute': tblApply(bid, (b) => tblDistribute(b), [r1, c1], rect); break;
    case 'clear': { const lang = S.lang; tblApply(bid, (b) => tblClear(b, rect, lang), [r1, c1], rect); break; }
    case 'delete': tblDeleteTable(bid); break;
    default: break;
  }
}
/** Tab / Shift+Tab between cells; Tab in the last cell appends a row. */
// Spreadsheet/word-processor convention: Tab past the last cell appends a row.
function tblTab(cell, dir) {
  const bid = rtBid(cell);
  const tb = tblModel(bid);
  if (!tb) return;
  tblEnsure(tb);
  const nx = tblNextCell(tb, +cell.dataset.r, +cell.dataset.c, dir);
  if (nx) {
    rtFlush();
    tblSetRect(bid, nx[0], nx[1], nx[0], nx[1]);
    TBL_S.anchor = { bid, r: nx[0], c: nx[1] };
    tblFocusCell(bid, nx[0], nx[1]);
  } else if (dir > 0) {
    const R = tb.rows.length;
    tblApply(bid, (b) => tblInsertRow(b, R), [R, 0]);
  }
}

const TBL_STYLES = ['grid', 'lines', 'minimal', 'striped', 'none'];
const TBL_HEADERS = ['none', 'row', 'col', 'both'];
function tblBuildBar() {
  const host = rtHost();
  const old = host.querySelector('.tbl-bar');
  TBL_S.ui = {};
  const ui = TBL_S.ui;
  const b = (id, key, ico, act) => rtBtn(id, t(key), ico, act, 'any', ui);
  const sel = (id, key, opts, prefix) => {
    const s = rtEl('select', { class: 'rt-sel', title: t(key), 'aria-label': t(key) },
      ...opts.map((v) => rtEl('option', { value: v, text: t(prefix + v) })));
    s.addEventListener('change', () => tblOp(id, s.value));
    ui[id] = s;
    return s;
  };
  const bgBtn = b('bg', 'tb.bg', RT_ICO.bg + '<i class="rt-cbar"></i>' + RT_ICO.caret, (btn) =>
    rtPopOpen(btn, rtPalette((c) => tblOp('bg', c), t('tb.bg.none'), '')));
  bgBtn.classList.add('rt-colorbtn');
  const bar = rtEl('div', { class: 'tbl-bar', role: 'toolbar', 'aria-label': t('tb.toolbar'), hidden: true },
    rtEl('span', { class: 'tbl-label', html: RT_ICO.table + `<span>${rtEsc(t('tb.table'))}</span>` }),
    rtGrp(b('rowAbove', 'tb.rowAbove', RT_ICO.rowAbove, () => tblOp('rowAbove')),
      b('rowBelow', 'tb.rowBelow', RT_ICO.rowBelow, () => tblOp('rowBelow')),
      b('colLeft', 'tb.colLeft', RT_ICO.colLeft, () => tblOp('colLeft')),
      b('colRight', 'tb.colRight', RT_ICO.colRight, () => tblOp('colRight'))),
    rtGrp(b('delRows', 'tb.delRows', RT_ICO.delRow, () => tblOp('delRows')),
      b('delCols', 'tb.delCols', RT_ICO.delCol, () => tblOp('delCols'))),
    rtGrp(b('merge', 'tb.merge', RT_ICO.merge, () => tblOp('merge')),
      b('split', 'tb.split', RT_ICO.split, () => tblOp('split'))),
    rtGrp(b('th', 'tb.th', RT_ICO.th, () => tblOp('th')), sel('header', 'tb.header', TBL_HEADERS, 'tb.header.')),
    rtGrp(bgBtn,
      b('alignleft', 'tb.align.left', RT_ICO.alignleft, () => tblOp('align', 'left')),
      b('aligncenter', 'tb.align.center', RT_ICO.aligncenter, () => tblOp('align', 'center')),
      b('alignright', 'tb.align.right', RT_ICO.alignright, () => tblOp('align', 'right')),
      b('vatop', 'tb.va.top', RT_ICO.vtop, () => tblOp('va', 'top')),
      b('vamiddle', 'tb.va.middle', RT_ICO.vmid, () => tblOp('va', 'middle')),
      b('vabottom', 'tb.va.bottom', RT_ICO.vbot, () => tblOp('va', 'bottom'))),
    rtGrp(sel('style', 'tb.style', TBL_STYLES, 'tb.style.'),
      b('distribute', 'tb.distribute', RT_ICO.distribute, () => tblOp('distribute')),
      b('delete', 'tb.delete', RT_ICO.trash, () => tblOp('delete'))));
  ui.bar = bar;
  if (old) old.replaceWith(bar); else host.append(bar);
  tblUpdateBar();
}
function tblUpdateBar() {
  const ui = TBL_S.ui;
  if (!ui.bar) return;
  const ctx = tblCtx();
  // The bar is in the flow above the page: showing / hiding it on table focus moved the page under the pointer in
  // mid-click (accidental cell-range drags). It stays up while the document has a table, disabled outside one
  // (narrow / touch layouts, short of room and without mouse drags, still show it only inside a table).
  ui.bar.hidden = !ctx && (S.narrow || !tblDocHasTable());
  ui.bar.classList.toggle('tbl-off', !ctx);
  for (const el of ui.bar.querySelectorAll('button, select')) el.disabled = !ctx;
  if (!ctx) {
    for (const el of ui.bar.querySelectorAll('[aria-pressed]')) el.setAttribute('aria-pressed', 'false');
    return;
  }
  const { tb, rect } = ctx;
  const [or, oc] = tblOrigin(tb, rect.r1, rect.c1);
  const o = tb.rows[or][oc];
  ui.header.value = TBL_HEADERS.includes(tb.header) ? tb.header : 'row';
  ui.style.value = TBL_STYLES.includes(tb.style) ? tb.style : 'grid';
  ui.merge.disabled = !ctx.multi;
  ui.split.disabled = ctx.multi || (o.cs === 1 && o.rs === 1);
  const cells = tblOrigins(tb, rect).map(([r, c]) => tb.rows[r][c]);
  const all = (p, v) => cells.length > 0 && cells.every((x) => x[p] === v);
  const press = (id, on) => ui[id] && ui[id].setAttribute('aria-pressed', on ? 'true' : 'false');
  press('th', all('th', true));
  for (const a of ['left', 'center', 'right']) press('align' + a, all('align', a));
  for (const v of ['top', 'middle', 'bottom']) press('va' + v, all('va', v));
  const bar = ui.bg && ui.bg.querySelector('.rt-cbar');
  if (bar) bar.style.background = o.bg || 'transparent';
}
function tblDocHasTable() {
  let any = false;
  try { if (S.doc) walkBlocks(S.doc, (b) => { if (b && b.type === 'table') any = true; }); } catch { /* ignore */ }
  return any;
}
// The palette popover expects an anchor ELEMENT; a context menu has only a point, so a duck-typed object provides
// the few members rtPopOpen reads (getBoundingClientRect, aria-label, contains).
function tblMenuItems(ctx, at) {
  const it = (key, kind, extra = {}) => ({ label: t(key), action: () => tblOp(kind), ...extra });
  const [or, oc] = tblOrigin(ctx.tb, ctx.rect.r1, ctx.rect.c1);
  const o = ctx.tb.rows[or][oc];
  const cells = tblOrigins(ctx.tb, ctx.rect).map(([r, c]) => ctx.tb.rows[r][c]);
  const all = (p, v) => cells.length > 0 && cells.every((x) => x[p] === v);
  // Same actions as the table toolbar; checked = current state of the selected cells / table.
  const opt = (key, kind, arg, on) => ({ label: t(key), checked: !!on, action: () => tblOp(kind, arg) });
  const header = TBL_HEADERS.includes(ctx.tb.header) ? ctx.tb.header : 'row';
  const style = TBL_STYLES.includes(ctx.tb.style) ? ctx.tb.style : 'grid';
  // The colour palette opens where the menu was (a point anchor for rtPopOpen).
  const pt = at || { x: innerWidth / 2, y: innerHeight / 3 };
  const anchor = {
    getBoundingClientRect: () => ({ left: pt.x, right: pt.x, top: pt.y, bottom: pt.y, width: 0, height: 0 }),
    getAttribute: (n) => (n === 'aria-label' ? t('tb.bg') : null), setAttribute() {}, contains: () => false,
  };
  return [
    it('tb.rowAbove', 'rowAbove'), it('tb.rowBelow', 'rowBelow'), it('tb.colLeft', 'colLeft'), it('tb.colRight', 'colRight'),
    { sep: true },
    it('tb.delRows', 'delRows'), it('tb.delCols', 'delCols'),
    { sep: true },
    it('tb.merge', 'merge', { disabled: !ctx.multi }),
    it('tb.split', 'split', { disabled: ctx.multi || (o.cs === 1 && o.rs === 1) }),
    { sep: true },
    it('tb.th', 'th'), it('tb.clear', 'clear'), it('tb.distribute', 'distribute'),
    { sep: true },
    { label: t('tb.bg') + '…', icon: 'palette', action: () => rtPopOpen(anchor, rtPalette((c) => tblOp('bg', c), t('tb.bg.none'), o.bg || '')) },
    opt('tb.align.left', 'align', 'left', all('align', 'left')),
    opt('tb.align.center', 'align', 'center', all('align', 'center')),
    opt('tb.align.right', 'align', 'right', all('align', 'right')),
    opt('tb.va.top', 'va', 'top', all('va', 'top')),
    opt('tb.va.middle', 'va', 'middle', all('va', 'middle')),
    opt('tb.va.bottom', 'va', 'bottom', all('va', 'bottom')),
    { sep: true },
    { header: true, label: t('tb.header') },
    ...TBL_HEADERS.map((v) => opt('tb.header.' + v, 'header', v, header === v)),
    { sep: true },
    { header: true, label: t('tb.style') },
    ...TBL_STYLES.map((v) => opt('tb.style.' + v, 'style', v, style === v)),
    { sep: true },
    it('tb.delete', 'delete'),
  ];
}
// Capture phase + stopPropagation: inside a cell the table menu replaces the editor's block context menu.
function tblOnContext(e) {
  const cell = e.target.closest && e.target.closest(TBL_CELL);
  if (!cell || !canvas.contains(cell)) return;
  e.preventDefault();
  e.stopPropagation(); // the table menu replaces the editor's block menu inside cells
  const bid = rtBid(cell);
  const r = +cell.dataset.r;
  const c = +cell.dataset.c;
  const s = TBL_S.sel;
  if (!(s && s.bid === bid && r >= s.r1 && r <= s.r2 && c >= s.c1 && c <= s.c2)) {
    rtFlush();
    TBL_S.anchor = { bid, r, c };
    tblSetRect(bid, r, c, r, c);
    tblFocusCell(bid, r, c);
  }
  const ctx = tblCtx();
  if (ctx) openMenu({ x: e.clientX, y: e.clientY }, tblMenuItems(ctx, { x: e.clientX, y: e.clientY }));
}

// --- mouse: cell selection (click / shift+click / drag) and column resize ---
// Capture-phase mousedown on the canvas so selection logic runs before the editor's own block-selection handler.
// Shift+click extends from the anchor and preventDefault keeps the caret in the anchor cell. A plain press arms a
// drag; mousemove is attached to document (not the canvas) only during the drag, so leaving the table still tracks.
function tblOnDown(e) {
  if (e.button !== 0) return;
  if (TBL_S.hover && tblStartResize(e)) return;
  const cell = e.target.closest && e.target.closest(TBL_CELL);
  if (!cell || !canvas.contains(cell)) {
    if (canvas.contains(e.target)) tblClearSel();
    return;
  }
  const bid = rtBid(cell);
  const r = +cell.dataset.r;
  const c = +cell.dataset.c;
  if (e.shiftKey && TBL_S.anchor && TBL_S.anchor.bid === bid) {
    e.preventDefault(); // keep focus and caret in the anchor cell
    tblSetRect(bid, TBL_S.anchor.r, TBL_S.anchor.c, r, c);
    return;
  }
  TBL_S.anchor = { bid, r, c };
  tblSetRect(bid, r, c, r, c);
  TBL_S.drag = { bid, r, c, cell, table: cell.closest('table'), moved: false, x: e.clientX, y: e.clientY };
  document.addEventListener('mousemove', tblOnDrag);
}
// e.buttons & 1 detects a release that happened outside the window (no mouseup was delivered). elementFromPoint
// finds the cell under the pointer even when the pointer is over a child element or a native selection overlay.
function tblOnDrag(e) {
  const d = TBL_S.drag;
  if (!d) return;
  if (!(e.buttons & 1)) { tblEndDrag(); return; }
  // A click jitters by a pixel or two (and the page may move under a still pointer): no range below 4 px of travel.
  if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= 4) return;
  const hit = document.elementFromPoint(e.clientX, e.clientY);
  const el = hit && hit.closest && hit.closest(TBL_CELL);
  if (!el || el.closest('table') !== d.table) return;
  const r = +el.dataset.r;
  const c = +el.dataset.c;
  if (!d.moved && r === d.r && c === d.c) return;
  if (!d.moved) {
    d.moved = true;
    d.table.classList.add('tbl-selecting'); // user-select:none stops native selection across cells
    const sel = getSelection();
    if (d.cell.isConnected) { try { sel.collapse(d.cell, 0); } catch { /* ignore */ } }
  }
  tblSetRect(d.bid, d.r, d.c, r, c);
}
function tblEndDrag() {
  const d = TBL_S.drag;
  TBL_S.drag = null;
  document.removeEventListener('mousemove', tblOnDrag);
  if (!d) return;
  d.table.classList.remove('tbl-selecting');
  if (d.moved && d.cell.isConnected) {
    TBL_S.keep = true;
    try { d.cell.focus({ preventScroll: true }); rtCaretEnd(d.cell); } finally { TBL_S.keep = false; }
  }
  rtSchedUpdate();
}
function tblOnUp() {
  if (TBL_S.rs) tblEndResize();
  if (TBL_S.drag) tblEndDrag();
}
function tblHoverOff() {
  if (TBL_S.hover) TBL_S.hover.cell.classList.remove('tbl-rs-hover');
  TBL_S.hover = null;
}
// Column resize affordance: within 4 px of a cell's left/right edge, mapped to the boundary between grid columns k
// and k+1 (colSpan aware). The outer table edges are not resizable: widths are percentages summing to 100.
function tblOnHover(e) {
  if (TBL_S.rs || TBL_S.drag || e.buttons) return;
  const cell = e.target.closest && e.target.closest(TBL_CELL);
  let hv = null;
  if (cell && canvas.contains(cell)) {
    const rc = cell.getBoundingClientRect();
    const c = +cell.dataset.c;
    const cs = cell.colSpan || 1;
    const nearR = Math.abs(e.clientX - rc.right) <= 4;
    const nearL = Math.abs(e.clientX - rc.left) <= 4 && c > 0;
    if (nearR || nearL) {
      const bid = rtBid(cell);
      const tb = tblModel(bid);
      const C = tb ? tb.cols.length : 0;
      const k = nearR ? c + cs - 1 : c - 1; // boundary between column k and k+1
      if (tb && k >= 0 && k < C - 1) hv = { cell, bid, k, C, table: cell.closest('table') };
    }
  }
  if (TBL_S.hover && (!hv || TBL_S.hover.cell !== hv.cell)) TBL_S.hover.cell.classList.remove('tbl-rs-hover');
  TBL_S.hover = hv;
  if (hv) hv.cell.classList.add('tbl-rs-hover');
}
/** Right edges (viewport px) of every column, from rendered cells; gaps (all-merged columns) interpolated. */
// Column boundaries are measured from rendered cells (getBoundingClientRect), not computed from stored widths:
// browsers adjust percentage widths to content minimums, and the drag must follow what is on screen. Columns whose
// every cell is part of a wider merge have no own right edge; they are interpolated between known neighbours.
function tblEdges(table, C) {
  const right = new Array(C).fill(null);
  let left = null;
  for (const el of table.querySelectorAll(TBL_CELL)) {
    const c = +el.dataset.c;
    const k = c + (el.colSpan || 1) - 1;
    const rc = el.getBoundingClientRect();
    if (k < C && right[k] == null) right[k] = rc.right;
    if (c === 0 && left == null) left = rc.left;
  }
  const tr = table.getBoundingClientRect();
  if (left == null) left = tr.left;
  if (right[C - 1] == null) right[C - 1] = tr.right;
  for (let k = 0; k < C; k++) {
    if (right[k] != null) continue;
    let j = k + 1;
    while (right[j] == null) j++;
    const prev = k > 0 ? right[k - 1] : left;
    right[k] = prev + (right[j] - prev) / (j - k + 1);
  }
  return { left, right };
}
// Moving boundary k changes only columns k and k+1 (others keep their measured share); rounding error is pushed
// into column k+1 so the sum stays exactly 100.
function tblWidths(rs, x) {
  const { left, right } = rs.ed;
  const edges = right.slice();
  edges[rs.k] = x;
  const P = edges.map((e, j) => ((e - (j ? edges[j - 1] : left)) / rs.total) * 100);
  const out = P.map((p) => Math.round(p * 10) / 10);
  const diff = Math.round((100 - out.reduce((s, p) => s + p, 0)) * 10) / 10;
  out[rs.k + 1] = Math.round((out[rs.k + 1] + diff) * 10) / 10;
  return out;
}
// Drag limits keep each of the two affected columns at least 5% of the table width. The guide line is a fixed
// element on <body> (outside the canvas, not re-rendered), and live preview writes <col> widths directly; the model
// is updated once on release (one undo step instead of one per mousemove).
function tblStartResize(e) {
  const hv = TBL_S.hover;
  if (!hv || !hv.cell.isConnected || !hv.table) return false;
  const ed = tblEdges(hv.table, hv.C);
  const total = ed.right[hv.C - 1] - ed.left;
  if (!(total > 0)) return false;
  e.preventDefault();
  e.stopPropagation();
  rtFlush();
  const prev = hv.k === 0 ? ed.left : ed.right[hv.k - 1];
  const next = ed.right[hv.k + 1];
  const tr = hv.table.getBoundingClientRect();
  const guide = rtEl('div', { class: 'tbl-guide' });
  guide.style.left = ed.right[hv.k] + 'px';
  guide.style.top = tr.top + 'px';
  guide.style.height = tr.height + 'px';
  document.body.append(guide);
  document.body.classList.add('tbl-resizing');
  TBL_S.rs = { ...hv, ed, total, min: prev + total * 0.05, max: next - total * 0.05, x: ed.right[hv.k], guide,
    cols: [...hv.table.querySelectorAll('colgroup > col')] };
  document.addEventListener('mousemove', tblOnResizeMove);
  return true;
}
function tblOnResizeMove(e) {
  const rs = TBL_S.rs;
  if (!rs) return;
  if (!(e.buttons & 1)) { tblEndResize(); return; }
  rs.x = Math.max(rs.min, Math.min(rs.max, e.clientX));
  rs.guide.style.left = rs.x + 'px';
  if (rs.cols.length === rs.C) { // live preview through <colgroup>
    const P = tblWidths(rs, rs.x);
    rs.cols.forEach((col, j) => { col.style.width = P[j] + '%'; });
  }
}
function tblEndResize() {
  const rs = TBL_S.rs;
  TBL_S.rs = null;
  document.removeEventListener('mousemove', tblOnResizeMove);
  document.body.classList.remove('tbl-resizing');
  if (!rs) return;
  rs.guide.remove();
  tblHoverOff();
  if (Math.abs(rs.x - rs.ed.right[rs.k]) < 1) return;
  const P = tblWidths(rs, rs.x);
  const a = TBL_S.anchor && TBL_S.anchor.bid === rs.bid ? [TBL_S.anchor.r, TBL_S.anchor.c] : null;
  tblApply(rs.bid, (b) => {
    if (b.cols.length !== P.length) return;
    b.cols.forEach((col, j) => { col.w = Math.max(5, P[j]); });
    tblRescale(b);
  }, a, TBL_S.sel && TBL_S.sel.bid === rs.bid ? TBL_S.sel : null);
}

/** Once at startup: table toolbar + mouse handlers on the canvas. Safe to call again (relabels). */
// mouseup on document: a drag or resize released outside the canvas must still end.
function tblInit() {
  tblBuildBar();
  if (TBL_S.inited) return;
  TBL_S.inited = true;
  canvas.addEventListener('mousedown', tblOnDown, true);
  canvas.addEventListener('mousemove', tblOnHover);
  canvas.addEventListener('mouseleave', tblHoverOff);
  canvas.addEventListener('contextmenu', tblOnContext, true);
  document.addEventListener('mouseup', tblOnUp);
}

export {
  TBL_S,
  tblClearSel,
  tblFocusCell,
  tblInit,
  tblMultiCells,
  tblOnCellFocus,
  tblOp,
  tblPaint,
  tblTab,
  tblUpdateBar
};
