// studio/left.js - left panel: block palette, document outline (tree with keyboard model and drag & drop) and the
// Files panel.
import { own } from '../util/value.js';
import { $, $$, cssEsc, h, lsSet } from '../ui/dom.js';
import { fileExt, fmtBytes, isFontMime, isImageMime, pickFiles, safeAttName } from '../ui/files.js';
import { icon, iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { openMenu, promptDialog } from '../ui/overlays.js';
import { S, edKey } from './state.js';
import { blockLabel, eachChildList, getList, isWithin, listOwner, regions, typeDef, typeIcon, walk } from './doc.js';
import { ED } from './config.js';
import { commit } from './history.js';
import { addFiles, attURL, attUsage, blockForAttachment, deleteAttachment, downloadAttachment, openAttachment, replaceAttachment } from './attach.js';
import { blockEl, rerenderBlock } from './canvas.js';
import { select } from './select.js';
import { blockTypesByCat, insertBlock, insertBlockObject, insertPosAfter, routeInsertPos, toggleBlockProp } from './ops.js';
import { endDrag, hasFiles, performDrop, rvDragData } from './dnd.js';
import { renderFields } from './fields.js';

// ===========================================================================
// 17. Left panel: palette · outline · files
// ===========================================================================

// Panels are rebuilt from S on demand (renderX), never patched incrementally: they are small, and a rebuild from
// state cannot drift. Hidden panels skip rendering (box.hidden checks) and are rebuilt when their tab is shown.

// WAI-ARIA tabs: role tablist/tab/tabpanel, roving tabindex (only the active tab is a Tab stop), arrows switch
// (automatic activation: switching is cheap, so selection follows focus).
// tabs: [[key, label, icon, panelId?], ...]
function tabBar(id, tabs, current, onPick) {
  const bar = h('div', { class: 'ed-tabs', role: 'tablist', id });
  for (const [key, label, ic, panel] of tabs) {
    const on = key === current;
    bar.append(h('button', {
      type: 'button', class: 'ed-tab' + (on ? ' ed-on' : ''), role: 'tab', 'aria-selected': String(on), id: `${id}-${key}`, title: label,
      'aria-controls': panel || `${id}-p-${key}`, tabindex: on ? '0' : '-1', onclick: () => onPick(key),
    }, ic ? iconEl(ic) : null, h('span', {}, label)));
  }
  bar.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const keys = tabs.map((x) => x[0]);
    const i = keys.indexOf(current);
    const n = keys[(i + (e.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length];
    onPick(n);
    requestAnimationFrame(() => $(`#${id}-${n}`)?.focus());
  });
  // Labels that do not fit (long translations such as Georgian, narrow panel): inactive tabs show only their icon
  // (the label stays as tooltip and accessible name), the active tab keeps its full label.
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => fitTabs(bar)).observe(bar);
  return bar;
}
// Measure in full mode first (remove the class), then decide: measuring while compact would always report "fits"
// and the bar would oscillate between the two modes on every resize.
function fitTabs(bar) {
  if (!bar.isConnected) return;
  bar.classList.remove('ed-tabs-compact');
  const over = $$('.ed-tab > span:not(.ed-ic)', bar).some((s) => s.scrollWidth > s.clientWidth + 1);
  bar.classList.toggle('ed-tabs-compact', over);
}

function renderLeft() {
  const left = $('#ed-left');
  if (!left) return;
  left.textContent = '';
  left.append(tabBar('ed-ltabs', [['blocks', t('tab.blocks'), 'plus', 'ed-palette'], ['outline', t('tab.outline'), 'list', 'ed-outline'], ['files', t('tab.files'), 'clip', 'ed-files']], S.leftTab, setLeftTab));
  left.append(
    h('div', { class: 'ed-panel-body', id: 'ed-palette', role: 'tabpanel', 'aria-labelledby': 'ed-ltabs-blocks', hidden: S.leftTab !== 'blocks' }),
    h('div', { class: 'ed-panel-body', id: 'ed-outline', role: 'tabpanel', 'aria-labelledby': 'ed-ltabs-outline', hidden: S.leftTab !== 'outline' }),
    h('div', { class: 'ed-panel-body', id: 'ed-files', role: 'tabpanel', 'aria-labelledby': 'ed-ltabs-files', hidden: S.leftTab !== 'files' }));
  renderPalette();
  renderOutline();
  renderFiles();
}
function setLeftTab(k) {
  S.leftTab = k;
  lsSet(edKey('ltab'), k);
  renderLeft();
}

// --- palette -----------------------------------------------------------------

// Search matches the localised name, the description and the internal type id, so a user can find a block in the
// UI language or by the English id used in docs. The query is kept in S so a panel rebuild does not clear it.
function renderPalette() {
  const box = $('#ed-palette');
  if (!box) return;
  box.textContent = '';
  const search = h('input', { type: 'search', class: 'ed-input ed-search', placeholder: t('pal.search'), 'aria-label': t('pal.search'), value: S.palQuery });
  const groups = h('div', { class: 'ed-pal-groups' });
  const fill = () => {
    const q = search.value.trim().toLowerCase();
    S.palQuery = search.value;
    groups.textContent = '';
    let count = 0;
    for (const [cat, types] of blockTypesByCat()) {
      const hits = types.filter((ty) => !q || (t('b.' + ty) + ' ' + t('bd.' + ty) + ' ' + ty).toLowerCase().includes(q));
      if (!hits.length) continue;
      count += hits.length;
      groups.append(h('h3', { class: 'ed-pal-h' }, t('c.' + cat)),
        h('div', { class: 'ed-pal-grid' }, hits.map((ty) => h('button', {
          type: 'button', class: 'ed-pal-item', draggable: 'true', title: t('bd.' + ty), 'aria-label': t('b.' + ty) + ' — ' + t('bd.' + ty),
          onclick: () => insertBlock(ty, undefined, undefined, { route: true }),
          ondragstart: (e) => { S.drag = { kind: 'new', type: ty }; e.dataTransfer.effectAllowed = 'copy'; rvDragData(e, 'new:' + ty); },
          ondragend: endDrag,
        }, h('span', { class: 'ed-pal-ic', html: typeIcon(ty) }), h('span', { class: 'ed-pal-l' }, t('b.' + ty))))));
    }
    if (!count) groups.append(h('p', { class: 'ed-muted' }, t('pal.none')));
  };
  search.addEventListener('input', fill);
  fill();
  box.append(search, groups, h('p', { class: 'ed-hint' }, t('pal.hint')));
}

// --- outline -----------------------------------------------------------------

function renderOutline() {
  const box = $('#ed-outline');
  if (!box || box.hidden || !S.doc) return;
  const st = box.scrollTop;
  const hadFocus = box.contains(document.activeElement);
  const focusBid = hadFocus ? document.activeElement.closest?.('.ed-out-row')?.dataset.bid : null;
  box.textContent = '';
  for (const r of regions()) {
    if (ED.regionShown && !ED.regionShown(r, S.doc)) continue;
    // A multi-page product shows the edited page in place of the main region (ED.outlineRegion).
    const o = ED.outlineRegion ? ED.outlineRegion(r, S.doc) : null;
    const lp = o && o.listPath ? o.listPath : 'regions.' + r;
    const list = o && Array.isArray(o.list) ? o.list : S.doc.regions[r] || [];
    box.append(h('div', { class: 'ed-out-region' },
      outlineListHead(o && o.label ? o.label : t('out.' + r), lp),
      outlineList(list, lp, 0)));
  }
  box.append(h('p', { class: 'ed-hint' }, t('out.hint') + ' ' + t('out.keys')));
  box.scrollTop = st;
  highlightOutline();
  // Re-rendering dropped the focused row: put focus back on the selected (or previously focused) row.
  if (hadFocus && !box.contains(document.activeElement)) outlineFocus(focusBid || S.sel.bid, false);
}

const outlineRows = () => $$('#ed-outline .ed-out-row');
function outlineRow(bid) {
  const box = $('#ed-outline');
  return bid && box ? box.querySelector(`.ed-out-row[data-bid="${cssEsc(bid)}"]`) : null;
}
// Move the tree's single Tab stop to `row` (or the selected / first row).
function outlineRove(row) {
  const rows = outlineRows();
  const cur = row || outlineRow(S.sel.bid) || rows[0];
  for (const r of rows) r.tabIndex = r === cur ? 0 : -1;
  return cur;
}
function outlineFocus(bid, scroll = true) {
  const row = outlineRow(bid) || outlineRow(S.sel.bid) || outlineRows()[0];
  if (!row) return;
  outlineRove(row);
  try { row.focus({ preventScroll: !scroll }); } catch { /* ignore */ }
  if (scroll) row.scrollIntoView({ block: 'nearest' });
}
// Tree keyboard model (WAI-ARIA treeview, always expanded): ↑/↓ previous / next row, ← parent, → first child,
// Home / End, Enter / Space select, H show / hide.
function outlineKey(e, bid) {
  const row = e.currentTarget;
  if (e.target !== row || e.altKey || e.ctrlKey || e.metaKey) return;
  const rows = outlineRows();
  const i = rows.indexOf(row);
  let to = null;
  switch (e.key) {
    case 'ArrowDown': to = rows[i + 1]; break;
    case 'ArrowUp': to = rows[i - 1]; break;
    case 'Home': to = rows[0]; break;
    case 'End': to = rows[rows.length - 1]; break;
    case 'ArrowLeft': to = row.closest('.ed-out-li')?.parentElement?.closest('.ed-out-li')?.querySelector(':scope > .ed-out-row'); break;
    case 'ArrowRight': to = row.closest('.ed-out-li')?.querySelector('.ed-out-list .ed-out-row'); break;
    case 'Enter': case ' ':
      e.preventDefault();
      select(bid, null, { scroll: true });
      if (!$('#ed-outline')?.contains(document.activeElement)) outlineFocus(bid, false);
      return;
    case 'h': case 'H':
      if (e.shiftKey) return;
      e.preventDefault();
      toggleBlockProp(bid, 'hidden');
      renderOutline(); // panels holding focus are not refreshed by commit(); keeps focus on this row
      if (!$('#ed-outline')?.contains(document.activeElement)) outlineFocus(bid, false);
      return;
    default: return;
  }
  e.preventDefault();
  if (to) { outlineRove(to); to.focus(); }
}

function outlineListHead(label, lp) {
  const el = h('div', { class: 'ed-out-head', dataset: { list: lp } }, label);
  bindOutlineDrop(el, () => ({ listPath: lp, index: (getList(lp) || []).length }), 'into');
  return el;
}

function outlineList(list, lp, depth) {
  const ul = h('ul', { class: 'ed-out-list', role: depth ? 'group' : 'tree' });
  if (!list.length) {
    const li = h('li', { class: 'ed-out-empty', role: 'none' }, t('out.empty'));
    bindOutlineDrop(li, () => ({ listPath: lp, index: 0 }), 'into');
    ul.append(li);
  }
  list.forEach((b, i) => {
    const lbl = blockLabel(b);
    // Roving tabindex (highlightOutline): only the selected / first row is a Tab stop; arrows move (outlineKey).
    const row = h('div', {
      class: 'ed-out-row' + (b.hidden ? ' ed-out-hidden' : ''), draggable: 'true', dataset: { bid: b.id }, tabindex: '-1', role: 'treeitem',
      'aria-level': String(depth + 1), 'aria-selected': 'false',
      onclick: () => select(b.id, null, { scroll: true }),
      onkeydown: (e) => outlineKey(e, b.id),
      ondragstart: (e) => { S.drag = { kind: 'move', bid: b.id }; e.dataTransfer.effectAllowed = 'move'; rvDragData(e, 'block:' + b.id); },
      ondragend: endDrag,
    },
    h('span', { class: 'ed-out-ic', html: typeIcon(b.type) }),
    h('span', { class: 'ed-out-l' }, h('span', { class: 'ed-out-type' }, t('b.' + b.type)), lbl ? h('span', { class: 'ed-out-txt' }, lbl) : null),
    Array.isArray(b.langs) ? h('span', { class: 'ed-out-badge' }, b.langs.join(' ').toUpperCase()) : null,
    h('button', {
      // Not a Tab stop of its own (the tree has one); keyboard: H on the focused row.
      type: 'button', class: 'ed-iconbtn ed-sm ed-out-eye', tabindex: '-1', title: t('out.toggle') + ' (H)', 'aria-label': t('out.toggle'), 'aria-pressed': String(!!b.hidden),
      html: icon(b.hidden ? 'eyeOff' : 'eye'), onclick: (e) => { e.stopPropagation(); toggleBlockProp(b.id, 'hidden'); renderOutline(); },
    }));
    bindOutlineDrop(row, (after) => ({ listPath: lp, index: i + (after ? 1 : 0) }), 'row', b.id);
    const li = h('li', { class: 'ed-out-li', role: 'none' }, row);
    // nested lists
    const def = typeDef(b.type);
    if (def.container) {
      const subs = [];
      eachChildList(b, (l, p) => subs.push([l, p]));
      if (b.type === 'columns' && subs.length) {
        subs.forEach(([l, p], ci) => li.append(h('div', { class: 'ed-out-sub' }, outlineListHead(t('out.col', { n: ci + 1 }), p), outlineList(l, p, depth + 1))));
      } else for (const [l, p] of subs) li.append(outlineList(l, p, depth + 1));
    }
    ul.append(li);
  });
  return ul;
}

// Outline drop targets: rows (before / after by vertical half) and list heads / empty lists ('into'). Refuses (no
// preventDefault) drops into the dragged block's own subtree, the same cycle rule as ops.moveBlockTo.
// stopPropagation: nested lists are inside parent rows' <li>, the innermost target must win.
function bindOutlineDrop(el, posFn, mode, bid) {
  el.addEventListener('dragover', (e) => {
    if (!S.drag) return;
    if (S.drag.kind === 'move' && bid && isWithin(bid, S.drag.bid)) return;
    const pos = posFn(false);
    const owner = listOwner(pos.listPath);
    if (S.drag.kind === 'move' && owner && isWithin(owner, S.drag.bid)) return;
    e.preventDefault();
    e.stopPropagation();
    for (const x of $$('#ed-outline .ed-drop-before, #ed-outline .ed-drop-after, #ed-outline .ed-drop-into')) x.classList.remove('ed-drop-before', 'ed-drop-after', 'ed-drop-into');
    if (mode === 'row') {
      const r = el.getBoundingClientRect();
      el.classList.add(e.clientY > r.top + r.height / 2 ? 'ed-drop-after' : 'ed-drop-before');
    } else el.classList.add('ed-drop-into');
  });
  el.addEventListener('dragleave', () => el.classList.remove('ed-drop-before', 'ed-drop-after', 'ed-drop-into'));
  el.addEventListener('drop', (e) => {
    if (!S.drag) return;
    e.preventDefault();
    e.stopPropagation();
    let after = false;
    if (mode === 'row') { const r = el.getBoundingClientRect(); after = e.clientY > r.top + r.height / 2; }
    const pos = posFn(after);
    performDrop(pos, null);
    endDrag();
  });
}

function highlightOutline() {
  const box = $('#ed-outline');
  if (!box) return;
  for (const r of $$('.ed-out-row.ed-on', box)) { r.classList.remove('ed-on'); r.setAttribute('aria-selected', 'false'); }
  // Keep the Tab stop on the focused row while the user is arrowing through the tree.
  const focused = document.activeElement?.closest?.('#ed-outline .ed-out-row');
  outlineRove(focused || null);
  if (!S.sel.bid) return;
  const row = outlineRow(S.sel.bid);
  if (row) {
    row.classList.add('ed-on');
    row.setAttribute('aria-selected', 'true');
    const br = box.getBoundingClientRect(), rr = row.getBoundingClientRect();
    if (rr.top < br.top || rr.bottom > br.bottom) row.scrollIntoView({ block: 'nearest' });
  }
}

// --- files -------------------------------------------------------------------

function renderFiles() {
  const box = $('#ed-files');
  if (!box || box.hidden || !S.doc) return;
  const st = box.scrollTop;
  box.textContent = '';
  const drop = h('button', { type: 'button', class: 'ed-dropzone', onclick: async () => { const f = await pickFiles({ multiple: true }); if (f.length) addFiles(f); } },
    iconEl('upload'), h('span', {}, t('files.drop')));
  drop.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); drop.classList.add('ed-over'); } });
  drop.addEventListener('dragleave', () => drop.classList.remove('ed-over'));
  drop.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    drop.classList.remove('ed-over');
    addFiles(e.dataTransfer.files);
  });
  box.append(drop);
  const atts = Object.values(S.doc.attachments || {});
  if (!atts.length) { box.append(h('p', { class: 'ed-muted ed-center' }, t('files.empty'))); return; }
  const total = atts.reduce((s, a) => s + (+a.size || 0), 0);
  box.append(h('p', { class: 'ed-muted' }, t('files.total', { n: atts.length, size: fmtBytes(total) })));
  const list = h('ul', { class: 'ed-file-list' });
  for (const a of atts) list.append(fileRow(a));
  box.append(list);
  box.scrollTop = st;
}

// attUsage per row is a full document scan; acceptable for the Files panel (dozens of files) and it keeps the
// "unused" hint always truthful without maintaining reference counts.
function fileRow(a) {
  const id = a.id;
  const u = isImageMime(a.mime) ? attURL(id) : '';
  const used = attUsage(id);
  const thumb = u ? h('img', { class: 'ed-file-thumb', src: u, alt: '' }) : h('span', { class: 'ed-file-thumb ed-file-ic', html: icon(isFontMime(a.mime, a.name) ? 'font' : /^audio\//.test(a.mime || '') ? 'music' : /^video\//.test(a.mime || '') ? 'play' : 'file') }, h('small', {}, (String(a.name).split('.').pop() || '').slice(0, 4).toUpperCase()));
  const head = h('div', { class: 'ed-file-head' },
    thumb,
    h('div', { class: 'ed-file-info' },
      h('span', { class: 'ed-file-name', title: a.name }, a.name),
      h('small', { class: 'ed-muted' }, `${fmtBytes(a.size)} · ${used ? t('files.used', { n: used }) : t('files.unused')}`)),
    h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('top.more'), 'aria-label': t('top.more'), html: icon('more'), onclick: (e) => fileMenu(id, e.currentTarget) }));
  const det = h('details', { class: 'ed-file-det', open: !!S.openSecs['file:' + id] }, h('summary', {}, t('files.details')));
  det.addEventListener('toggle', () => { S.openSecs['file:' + id] = det.open; });
  const flds = h('div', { class: 'ed-fields' });
  // Title / description: nothing is re-rendered while typing; blocks showing them refresh when the edit ends.
  const setAtt = (k, v, typing) => {
    const text = k === 'title' || k === 'desc';
    commit('file ' + k, () => { const x = own(S.doc.attachments, id); if (x) x[k] = v; }, { render: text ? 'none' : 'all', coalesce: typing ? `att:${id}:${k}` : null });
    if (text && !typing) rerenderAttUsers(id);
  };
  renderFields(flds, [
    { key: 'title', type: 'i18n', label: 'files.title' },
    { key: 'desc', type: 'i18n', label: 'files.desc', multiline: true, rows: 2 },
    ...(ED.fileFields || []),
  ], () => own(S.doc.attachments, id), setAtt);
  det.append(flds);
  return h('li', { class: 'ed-file' }, head, det);
}

// Re-render the blocks that reference attachment `id` in their own props (not via nested child blocks).
// Child lists are removed from the copy before the substring test, so a container is not re-rendered just because
// a nested block uses the file (the nested block is found by the walk itself). The local 'own' shadows the imported
// helper of the same name inside this function only.
function rerenderAttUsers(id) {
  const ids = [];
  walk((b) => {
    const own = { ...b };
    for (const lp of typeDef(b.type).lists || []) delete own[lp.split('.')[0]];
    if (JSON.stringify(own).includes(id)) ids.push(b.id);
  });
  for (const bid of ids) if (blockEl(bid)) rerenderBlock(bid);
}

function fileMenu(id, anchor) {
  const a = own(S.doc.attachments, id);
  if (!a) return;
  openMenu(anchor, [
    { label: t('files.insert'), icon: 'plus', disabled: isFontMime(a.mime, a.name), action: () => {
      const b = blockForAttachment(a);
      if (b) insertBlockObject(b, routeInsertPos(b.type, insertPosAfter(S.sel.bid)));
    } },
    { label: t('files.open'), icon: 'external', action: () => openAttachment(id) },
    { label: t('files.download'), icon: 'download', action: () => downloadAttachment(id) },
    { sep: true },
    { label: t('files.rename'), icon: 'edit', action: async () => {
      const ext = fileExt(a.name);
      const raw = await promptDialog(t('files.rename'), t('files.newName'), a.name, { selectEnd: a.name.length - ext.length });
      const nv = raw == null ? null : safeAttName(raw, a.name);
      if (nv && nv !== a.name) commit('rename file', () => { const x = own(S.doc.attachments, id); if (x) x.name = nv; }, { render: 'all' });
    } },
    { label: t('files.replace'), icon: 'replace', action: () => replaceAttachment(id) },
    { sep: true },
    { label: t('files.delete'), icon: 'trash', danger: true, action: () => deleteAttachment(id) },
  ]);
}

export {
  highlightOutline,
  renderFiles,
  renderLeft,
  renderOutline,
  tabBar
};
