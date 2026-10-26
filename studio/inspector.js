// studio/inspector.js - the block inspector: schema fields, items manager, columns and table tools, the product's
// common props (visibility, print / device…), anchor and block style.
//
// Design rules:
// - Every closure holds the block id (bid), never the block object: each commit replaces nothing, but undo/redo
//   swaps S.doc for a parsed snapshot, so a captured object would silently edit a detached tree. getBlock(bid)
//   re-resolves at call time.
// - Commits from typing carry a coalesce key '<kind>:<bid>:<key>' so one field's burst is one undo step, while two
//   different fields or blocks never merge.
// - The canvas re-renders just the edited block (render: bid); the inspector is rebuilt only for structural changes
//   (items added/moved, column counts), never per keystroke, so the focused input survives.
import { uid } from '../util/id.js';
import { own } from '../util/value.js';
import { P } from '../doc/product.js';
import { ED } from './config.js';
import { anchorField } from './anchors.js';
import { $, $$, clamp, clone, h, isObj } from '../ui/dom.js';
import { icon, iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { S } from './state.js';
import { findBlock, isTransparent, itemText, regionOf, typeDef, typeIcon } from './doc.js';
import { commit } from './history.js';
import { blockEl, itemEls } from './canvas.js';
import { select } from './select.js';
import { deleteBlock, duplicateBlock, moveBlockBy } from './ops.js';
import { rvDragData } from './dnd.js';
import { fieldRow, fmtNum, radioRoving, renderFields, section } from './fields.js';
import { setRightTab } from './right.js';
import { tblDeleteCols, tblDeleteRows, tblInsertCol, tblInsertRow, tblNormalize } from '../richtext/table-model.js';

// ===========================================================================
// 16. Block inspector
// ===========================================================================

// Common block props (ED.commonFields: hidden, languages, print / device…) and block style fields (ED.styleFields:
// spacing, colours, alignment) come from the product.

const getBlock = (bid) => findBlock(bid)?.block;

function setBlockProp(bid, key, value, typing) {
  commit('prop ' + key, () => { const b = getBlock(bid); if (b) b[key] = value; },
    { render: bid, coalesce: typing ? `prop:${bid}:${key}` : null });
}
// Types whose own 'style' prop is a variant name (resume timeline, skills, languages, keyvalue; tables) have
// no common block style: the spacing panel is not shown for them and a style edit never replaces the variant.
function hasVariantStyle(type) {
  try { return typeof typeDef(type).defaults?.().style === 'string'; } catch { return false; }
}
function setBlockStyle(bid, key, value, typing) {
  commit('style ' + key, () => {
    const b = getBlock(bid);
    if (!b || typeof b.style === 'string' || hasVariantStyle(b.type)) return;
    if (!isObj(b.style)) b.style = {};
    b.style[key] = value;
  },
    { render: bid, coalesce: typing ? `style:${bid}:${key}` : null });
}

// Full rebuild of the panel; scrollTop is saved and restored so a rebuild after an item operation does not jump
// the user back to the top of a long inspector.
function renderInspector() {
  const box = $('#ed-inspector');
  if (!box || !S.doc) return;
  const st = box.scrollTop;
  box.textContent = '';
  const fb = S.sel.bid && findBlock(S.sel.bid);
  if (!fb) {
    box.append(h('div', { class: 'ed-empty-state' },
      h('div', { class: 'ed-empty-ic', html: icon('sliders') }),
      h('p', {}, t('ins.none')),
      h('button', { type: 'button', class: 'ed-btn', onclick: () => setRightTab('document') }, iconEl('settings'), t('ins.docLink'))));
    return;
  }
  const { block } = fb;
  const bid = block.id;
  const def = typeDef(block.type);
  const rerender = () => renderInspector();

  // Header
  box.append(h('div', { class: 'ed-ins-head' },
    h('span', { class: 'ed-ins-ic', html: typeIcon(block.type) }),
    h('div', { class: 'ed-ins-title' },
      h('strong', {}, t('b.' + block.type)),
      h('small', {}, fb.parent ? t('ins.inside', { name: t('b.' + fb.parent.type) }) : t('out.' + (regionOf(fb.listPath) || 'main')))),
    h('div', { class: 'ed-ins-acts' },
      fb.parent && !isTransparent(fb.parent) ? h('button', { type: 'button', class: 'ed-iconbtn', title: t('blk.parent'), 'aria-label': t('blk.parent'), html: icon('parent'), onclick: () => select(fb.parent.id, null, { scroll: true }) }) : null,
      h('button', { type: 'button', class: 'ed-iconbtn', title: t('blk.up'), 'aria-label': t('blk.up'), html: icon('up'), onclick: () => moveBlockBy(bid, -1) }),
      h('button', { type: 'button', class: 'ed-iconbtn', title: t('blk.down'), 'aria-label': t('blk.down'), html: icon('down'), onclick: () => moveBlockBy(bid, 1) }),
      h('button', { type: 'button', class: 'ed-iconbtn', title: t('blk.dup'), 'aria-label': t('blk.dup'), html: icon('copy'), onclick: () => duplicateBlock(bid) }),
      h('button', { type: 'button', class: 'ed-iconbtn ed-danger', title: t('blk.del'), 'aria-label': t('blk.del'), html: icon('trash'), onclick: () => deleteBlock(bid) }))));
  box.append(h('p', { class: 'ed-ins-desc' }, t('bd.' + block.type)));

  // Schema fields
  const schema = (def.schema || []).filter(Boolean);
  if (schema.length) {
    const c = h('div', { class: 'ed-fields' });
    renderFields(c, schema, () => getBlock(bid), (k, v, typing) => setBlockProp(bid, k, v, typing), { rerender, blockType: block.type, bid, assetImages: true });
    if (schema.some((f) => f.type === 'att') && blockEl(bid)?.querySelector('[data-att-key]')) c.append(h('p', { class: 'ed-hint' }, t('ins.attDbl')));
    box.append(section('props', t('ins.props'), c));
  }

  // Custom parts
  if (block.type === 'columns') box.append(section('columns', t('ins.columns'), columnsUI(block)));
  if (block.type === 'table') box.append(section('table', t('ins.table'), tableUI(block)));
  if (Array.isArray(block.items) && (def.itemSchema || []).length) box.append(itemsUI(block, def));

  // Common props (+ anchor). A transparent container (a page) is not a visual block: no anchor, no block style.
  const cm = h('div', { class: 'ed-fields' });
  renderFields(cm, ED.commonFields || [], () => getBlock(bid), (k, v, typing) => setBlockProp(bid, k, v, typing), { rerender });
  if (P.anchors && !def.transparent) cm.append(anchorField(bid));
  if (cm.childElementCount) box.append(section('common', t('ins.common'), cm, false));
  if ((ED.styleFields || []).length && !def.transparent && !hasVariantStyle(block.type) && typeof block.style !== 'string') {
    const sp = h('div', { class: 'ed-fields ed-grid2' });
    renderFields(sp, ED.styleFields, () => (isObj(getBlock(bid)?.style) ? getBlock(bid).style : {}), (k, v, typing) => setBlockStyle(bid, k, v, typing), { rerender });
    box.append(section('spacing', t('ins.spacing'), sp, false));
  }

  box.scrollTop = st;
}

// --- items manager ---------------------------------------------------------

function itemLabel(block, it, i) {
  return itemText(block, it, i) || t('ins.item', { n: i + 1 });
}

// A new / copied item: the product may fix its unique keys (ED.onNewItem: SKUs…).
const prepItem = (blk, it) => (ED.onNewItem ? ED.onNewItem(blk, it) || it : it);

// Every item gets a stable id: list rendering, drag-reorder and product references survive reordering by id rather
// than index. A throwing itemDefaults degrades to an empty item.
function newItem(def) {
  let it;
  try { it = def.itemDefaults ? def.itemDefaults() : {}; } catch { it = {}; }
  if (!it.id) it.id = uid();
  return it;
}

function itemOp(bid, label, fn, sel) {
  commit(label, () => { const b = getBlock(bid); if (b && Array.isArray(b.items)) fn(b.items, b); }, { render: bid, select: bid, item: sel });
  renderInspector();
}

// Canvas placeholder of an empty list block: add one item, select it and focus its first text field.
function addFirstItem(bid) {
  const b = getBlock(bid);
  const def = b && typeDef(b.type);
  if (!def || !def.itemDefaults || !Array.isArray(b.items)) return;
  itemOp(bid, 'item add', (a, blk) => a.push(prepItem(blk, newItem(def))), b.items.length);
  setTimeout(() => {
    const be = blockEl(bid);
    const f = be && be.querySelector('[data-item] [data-f], [data-item][data-f]');
    if (f) { try { f.focus(); } catch { /* ignore */ } }
  });
}

// Items manager. Item drag uses its own dragFrom index (scoped to this list), plus the private drag MIME so the
// global guards in dnd.js refuse it everywhere else. Index fix-up: removing the source before inserting shifts
// later positions by one, hence 'if (from < to) to--'.
function itemsUI(block, def) {
  const bid = block.id;
  const items = block.items;
  const list = h('ol', { class: 'ed-items', role: 'list' });
  let dragFrom = null;
  items.forEach((it, i) => {
    const on = S.sel.item === i;
    const row = h('li', { class: 'ed-item-row' + (on ? ' ed-on' : ''), draggable: 'true', dataset: { i: String(i) } },
      h('span', { class: 'ed-grip', html: icon('grip'), 'aria-hidden': 'true' }),
      h('button', { type: 'button', class: 'ed-item-label', 'aria-pressed': String(on), onclick: () => { select(bid, on ? null : i); scrollItemIntoView(bid, i); } }, itemLabel(block, it, i)),
      h('span', { class: 'ed-item-acts' },
        h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('ins.itemUp'), 'aria-label': t('ins.itemUp'), disabled: i === 0, html: icon('up'), onclick: () => itemOp(bid, 'item up', (a) => a.splice(i - 1, 0, a.splice(i, 1)[0]), i - 1) }),
        h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('ins.itemDown'), 'aria-label': t('ins.itemDown'), disabled: i === items.length - 1, html: icon('down'), onclick: () => itemOp(bid, 'item down', (a) => a.splice(i + 1, 0, a.splice(i, 1)[0]), i + 1) }),
        h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('ins.itemDup'), 'aria-label': t('ins.itemDup'), html: icon('copy'), onclick: () => itemOp(bid, 'item dup', (a, blk) => { const c = clone(a[i]); c.id = uid(); a.splice(i + 1, 0, prepItem(blk, c)); }, i + 1) }),
        h('button', { type: 'button', class: 'ed-iconbtn ed-sm ed-danger', title: t('ins.itemDel'), 'aria-label': t('ins.itemDel'), html: icon('trash'), onclick: () => itemOp(bid, 'item del', (a) => a.splice(i, 1), null) })));
    row.addEventListener('dragstart', (e) => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; rvDragData(e, 'item'); row.classList.add('ed-dragging'); });
    row.addEventListener('dragend', () => { dragFrom = null; row.classList.remove('ed-dragging'); for (const r of $$('.ed-drop-before,.ed-drop-after', list)) r.classList.remove('ed-drop-before', 'ed-drop-after'); });
    row.addEventListener('dragover', (e) => {
      if (dragFrom == null) return;
      e.preventDefault();
      const r = row.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      for (const x of $$('.ed-drop-before,.ed-drop-after', list)) x.classList.remove('ed-drop-before', 'ed-drop-after');
      row.classList.add(after ? 'ed-drop-after' : 'ed-drop-before');
    });
    row.addEventListener('drop', (e) => {
      if (dragFrom == null) return;
      e.preventDefault();
      e.stopPropagation();
      const r = row.getBoundingClientRect();
      let to = i + (e.clientY > r.top + r.height / 2 ? 1 : 0);
      const from = dragFrom;
      dragFrom = null;
      if (from < to) to--;
      if (from === to) { renderInspector(); return; }
      itemOp(bid, 'item move', (a) => a.splice(to, 0, a.splice(from, 1)[0]), to);
    });
    list.append(row);
  });
  const add = h('button', {
    type: 'button', class: 'ed-btn ed-block-btn', onclick: () => {
      const at = S.sel.item != null ? S.sel.item + 1 : items.length;
      itemOp(bid, 'item add', (a, blk) => a.splice(at, 0, prepItem(blk, newItem(def))), at);
      requestAnimationFrame(() => {
        const be = blockEl(bid);
        const it = be && itemEls(be).find((x) => +x.dataset.item === at);
        const f = it && it.querySelector('[data-f]');
        if (f) { try { f.focus(); } catch { /* ignore */ } }
      });
    },
  }, iconEl('plus'), t('ins.addItem'));
  const content = h('div', {}, items.length ? list : h('p', { class: 'ed-muted' }, t('ins.noItems')), add);

  // Selected item editor
  const idx = S.sel.item;
  if (idx != null && items[idx]) {
    const ed = h('div', { class: 'ed-item-editor' },
      h('div', { class: 'ed-item-editor-h' },
        h('strong', {}, t('ins.item', { n: idx + 1 })),
        h('span', { class: 'ed-spacer' }),
        h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('ins.itemPrev'), 'aria-label': t('ins.itemPrev'), disabled: idx === 0, html: icon('chevLeft'), onclick: () => select(bid, idx - 1) }),
        h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('ins.itemNext'), 'aria-label': t('ins.itemNext'), disabled: idx >= items.length - 1, html: icon('chevRight'), onclick: () => select(bid, idx + 1) }),
        h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('ins.itemClose'), 'aria-label': t('ins.itemClose'), html: icon('close'), onclick: () => select(bid, null) })));
    const flds = h('div', { class: 'ed-fields' });
    // Product hooks per item key (ED.itemFields[key] = { check(value, item) → message, clean(value) → value }).
    const hookOf = (k) => own(ED.itemFields, k);
    const schema = def.itemSchema.filter(Boolean).map((f) => {
      const hk = hookOf(f.key);
      return hk && hk.check && f.type === 'text' && !f.check ? { ...f, check: hk.check } : f;
    });
    renderFields(flds, schema, () => getBlock(bid)?.items?.[idx], (k, v, typing) => {
      const hk = hookOf(k);
      if (hk && hk.clean && !typing) v = hk.clean(v);
      commit('item ' + k, () => { const it = getBlock(bid)?.items?.[idx]; if (it) it[k] = v; },
        { render: bid, coalesce: typing ? `item:${bid}:${idx}:${k}` : null });
      // clean() may normalise the value (e.g. SKU casing): reflect it in the input; the item label in the list is
      // patched in place instead of rebuilding the inspector (which would steal focus).
      if (hk && hk.clean && !typing) { const inp = flds.querySelector(`.ed-field[data-key="${k}"] input`); if (inp && inp.value !== v) inp.value = v; }
      const lab = $(`#ed-inspector .ed-item-row[data-i="${idx}"] .ed-item-label`);
      if (lab) lab.textContent = itemLabel(getBlock(bid), getBlock(bid)?.items?.[idx], idx);
    }, { rerender: () => renderInspector(), blockType: block.type, bid, pathPrefix: `items.${idx}.` });
    ed.append(flds);
    content.append(ed);
  }
  return section('items', t('ins.items') + ` (${items.length})`, content);
}

function scrollItemIntoView(bid, i) {
  const be = blockEl(bid);
  const it = be && itemEls(be).find((x) => +x.dataset.item === i);
  if (it) it.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// --- columns ---------------------------------------------------------------

// Removing columns never deletes content: blocks of dropped columns move into the last remaining one.
function setColumnCount(bid, n) {
  commit('columns', () => {
    const b = getBlock(bid);
    if (!b) return;
    if (!Array.isArray(b.cols)) b.cols = [];
    while (b.cols.length < n) b.cols.push({ id: uid(), w: null, blocks: [] });
    while (b.cols.length > n) {
      const gone = b.cols.pop();
      b.cols[b.cols.length - 1].blocks.push(...(gone.blocks || [])); // keep content
    }
    equalizeCols(b);
  }, { render: bid });
  renderInspector();
}
// Column i → v % (clamped so every other column keeps ≥ 10 %); the others share the rest in their current
// proportions, rounded, with the remainder settled so the total is exactly 100.
function setColWidth(b, i, v) {
  const n = b.cols.length;
  if (n < 2) { if (b.cols[0]) b.cols[0].w = 100; return; }
  const MIN = 10;
  v = clamp(Math.round(+v || 0), MIN, 100 - MIN * (n - 1));
  const cur = b.cols.map((c) => (+c.w > 0 ? +c.w : 100 / n));
  const restOld = cur.reduce((s, w, j) => (j === i ? s : s + w), 0) || 1;
  const rest = 100 - v;
  const ws = cur.map((w, j) => (j === i ? v : Math.max(MIN, Math.round((w * rest) / restOld))));
  let diff = 100 - ws.reduce((s, w) => s + w, 0);
  const others = ws.map((_, j) => j).filter((j) => j !== i);
  // Settle on the last other column first, then take from (or give to) the widest ones, never below MIN.
  for (let guard = 0; diff !== 0 && guard < 100; guard++) {
    let j;
    if (diff > 0) j = others[others.length - 1];
    else j = others.filter((k) => ws[k] > MIN).sort((a, c) => ws[c] - ws[a])[0];
    if (j == null) break;
    const step = diff > 0 ? diff : -Math.min(-diff, ws[j] - MIN);
    ws[j] += step;
    diff -= step;
  }
  b.cols.forEach((c, j) => { c.w = ws[j]; });
}
// Integer percentages with the remainder on the last column, so the sum is exactly 100 (33 / 33 / 34).
function equalizeCols(b) {
  const n = b.cols.length;
  const w = Math.floor(100 / n);
  b.cols.forEach((c, i) => { c.w = i === n - 1 ? 100 - w * (n - 1) : w; });
}
function setColumnWidths(bid, ws) {
  commit('column widths', () => {
    const b = getBlock(bid);
    if (!b) return;
    while (b.cols.length < ws.length) b.cols.push({ id: uid(), w: null, blocks: [] });
    while (b.cols.length > ws.length) { const g = b.cols.pop(); b.cols[b.cols.length - 1].blocks.push(...(g.blocks || [])); }
    b.cols.forEach((c, i) => { c.w = ws[i]; });
  }, { render: bid });
  renderInspector();
}

function columnsUI(block) {
  const bid = block.id;
  const cols = block.cols || [];
  const n = cols.length;
  const wrap = h('div', { class: 'ed-fields' });
  const cnt = radioRoving(h('div', { class: 'ed-seg', role: 'radiogroup', 'aria-label': t('ins.colCount') },
    [1, 2, 3, 4].map((k) => h('button', { type: 'button', class: 'ed-seg-btn' + (k === n ? ' ed-on' : ''), role: 'radio', 'aria-checked': String(k === n), onclick: () => setColumnCount(bid, k) }, String(k)))));
  wrap.append(h('div', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('ins.colCount')), cnt));
  const presets = [[50, 50], [33, 67], [67, 33], [25, 75], [75, 25], [33, 34, 33], [25, 50, 25], [25, 25, 25, 25]];
  wrap.append(h('div', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('ins.presets')),
    h('div', { class: 'ed-col-presets' }, presets.map((p) => h('button', {
      type: 'button', class: 'ed-col-preset', title: p.join(' / '), 'aria-label': p.join(' / '), onclick: () => setColumnWidths(bid, p),
    }, p.map((w) => h('span', { style: { flexGrow: String(w) } })))))));
  // Widths are percentages summing to 100: moving one slider rescales the others (shown live).
  const rows = [];
  const showWidths = () => {
    const b = getBlock(bid);
    if (!b) return;
    rows.forEach((row, j) => {
      const w = b.cols[j]?.w;
      const inp = row.querySelector('.ed-range');
      const out = row.querySelector('.ed-range-val');
      if (inp && w != null && document.activeElement !== inp) inp.value = String(w);
      if (out && w != null) out.textContent = fmtNum(w) + '%';
    });
  };
  if (n > 1) cols.forEach((c, i) => {
    const row = fieldRow({ key: 'w', type: 'range', min: 10, max: 100 - 10 * (n - 1), step: 1, unit: '%', labelText: t('ins.colWidth', { n: i + 1 }) }, () => c.w ?? Math.round(100 / n), (v, typing) => {
      commit('column width', () => { const b = getBlock(bid); if (b && b.cols[i]) setColWidth(b, i, v); }, { render: bid, coalesce: typing ? `colw:${bid}:${i}` : null });
      showWidths();
    });
    rows.push(row);
    wrap.append(row);
  });
  wrap.append(h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => { commit('equalize', () => { const b = getBlock(bid); if (b) equalizeCols(b); }, { render: bid }); renderInspector(); } }, t('ins.equalize')));
  return wrap;
}

// --- table quick actions (delegate to richtext/ table ops) ---------------------------

// Table structure is owned by richtext/table-model.js (merged cells, spans); the inspector only calls its ops and
// normalises afterwards, so the quick actions and the in-cell table toolbar can never disagree.
function tableOp(bid, label, fn) {
  commit(label, () => { const b = getBlock(bid); if (b) { fn(b); try { tblNormalize(b); } catch { /* ignore */ } } }, { render: bid });
  renderInspector();
}
function tableUI(block) {
  const bid = block.id;
  const r = (block.rows || []).length, c = (block.cols || []).length;
  const b = (ic, label, fn, disabled) => h('button', { type: 'button', class: 'ed-btn ed-sm', disabled: !!disabled, onclick: fn }, iconEl(ic), label);
  return h('div', { class: 'ed-fields' },
    h('p', { class: 'ed-muted' }, t('ins.tblSize', { r, c })),
    h('div', { class: 'ed-btn-grid' },
      b('plus', t('ins.addRow'), () => tableOp(bid, 'add row', (tb) => tblInsertRow(tb, (tb.rows || []).length))),
      b('plus', t('ins.addCol'), () => tableOp(bid, 'add col', (tb) => tblInsertCol(tb, (tb.cols || []).length))),
      b('minus', t('ins.delRow'), () => tableOp(bid, 'del row', (tb) => tblDeleteRows(tb, tb.rows.length - 1, tb.rows.length - 1)), r <= 1),
      b('minus', t('ins.delCol'), () => tableOp(bid, 'del col', (tb) => tblDeleteCols(tb, tb.cols.length - 1, tb.cols.length - 1)), c <= 1),
      b('columns', t('ins.tblDistribute'), () => tableOp(bid, 'distribute', (tb) => { (tb.cols || []).forEach((x) => { x.w = null; }); }))),
    h('p', { class: 'ed-hint' }, t('ins.tblHint')));
}

export {
  addFirstItem,
  newItem,
  renderInspector,
  setBlockProp
};
