// kdbx-app/vault.js - the unlocked vault: toolbar, group tree (ARIA tree, icons, drag and drop target, keyboard), entry list
// (multi-selection listbox: Ctrl / Shift click, Ctrl+A, the selection mode of touch screens with check boxes, drag and
// drop, keyboard), entry details (icon, copy, reveal, field references resolved, TOTP with countdown, attachments,
// history; a summary with bulk actions for several entries), the entry editor (editor.js), context menus on all three
// panes (menus.js through ui/contextmenu.js) and the keyboard shortcuts.
// 
// Rendering: each pane re-renders wholesale from S (lists are small: a vault rarely has thousands of entries in one group)
// and restores scroll position and keyboard focus afterwards. Events are delegated on the pane containers, which survive
// re-renders, so no listener is re-attached per row.
// Security: secrets are rendered as text nodes only; protected values are masked unless revealed per field.
import { button, download, t, toast } from '../ui/app.js';
import { h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { openMenu } from '../ui/overlays.js';
import { contextMenu } from '../ui/contextmenu.js';
import { ProtectedValue, entryOtp, otpCode } from '../kdbx/kdbx.js';
import { S, copySecret, fmtDate, fmtSize, groupPath, isExpired, markDirty } from './state.js';
import { attachmentDialog, historyDialog, settingsDialog } from './dialogs.js';
import { generatorDialog, strengthView } from './generator.js';
import { iconTile, itemIcon } from './iconpicker.js';
import { OTP_FIELDS, editorView } from './editor.js';
import {
  canAddTo, changeEntryIcons, clearSelection, copyEntries, copyField, deleteEntries, deleteGroup,
  duplicateEntries, editEntry, entryUrl, moveEntries, newEntry, newGroup, openUrl, recycle, renameGroup, selectAll,
  selectGroup, selectOnly, selectRange, selectedEntries, toggleSelect, visibleEntries,
} from './actions.js';
import { bulkItems, entryItems, fieldItems, groupItems, listItems } from './menus.js';

let actions = { save: () => {}, lock: () => {} };
export const setActions = (a) => { actions = a; };

const LABEL = () => ({ Title: t('kx.f.title'), UserName: t('kx.f.user'), Password: t('kx.f.password'), URL: t('kx.f.url'), Notes: t('kx.f.notes') });
const entryByUuid = (uuid) => (uuid ? visibleEntries().find((e) => e.uuid === uuid) || S.db.getEntry(uuid) : null);
const groupOf = (el) => (el && el.dataset.uuid ? S.db.getGroup(el.dataset.uuid) : null);
// Rows drag with a mouse; touch gets the long-press menu instead (pointerdown switches per gesture).
// Mouse users can drag rows to groups; on touch, a long press opens the context menu instead of starting a native drag.
const FINE_POINTER = typeof matchMedia === 'function' && matchMedia('(any-pointer: fine)').matches;
const selectedText = (el) => { const s = window.getSelection(); return s && !s.isCollapsed && el.contains(s.anchorNode) ? String(s) : ''; };

// --- toolbar --------------------------------------------------------------------------------------------------

// Toolbar parts updated in place (name, dirty dot, save emphasis, title with a bullet when unsaved) without rebuilding the toolbar.
export function renderTop() {
  const bar = document.getElementById('kx-bar');
  if (!bar || !S.db) return;
  const name = bar.querySelector('.kx-db-name');
  if (name) name.textContent = S.db.meta.name || S.file?.name || t('kx.untitled');
  const dot = bar.querySelector('.kx-dirty');
  if (dot) dot.hidden = !S.dirty;
  const saveBtn = bar.querySelector('[data-act=save]');
  if (saveBtn) saveBtn.classList.toggle('ed-primary', S.dirty);
  document.title = `${S.dirty ? '• ' : ''}${S.db.meta.name || S.file?.name || ''} · ${t('app.name')}`;
}

function toolbar() {
  const search = h('input', { type: 'search', class: 'ed-input kx-search', placeholder: t('kx.searchPh'), 'aria-label': t('kx.search'), value: S.query, id: 'kx-search' });
  search.addEventListener('input', () => { S.query = search.value; S.entry = null; S.sel = new Set(); S.selecting = false; S.draft = null; S.view = 'list'; renderPanes(); });
  search.addEventListener('keydown', (e) => { if (e.key === 'Escape' && search.value) { search.value = ''; S.query = ''; renderPanes(); } });
  const tb = (act, ic, label, fn) => h('button', { type: 'button', class: 'ed-btn kx-tb', dataset: { act }, title: t(label), 'aria-label': t(label), onclick: fn }, iconEl(ic), h('span', { class: 'kx-tb-l' }, t(label)));
  return h('div', { class: 'kx-bar', id: 'kx-bar' },
    h('div', { class: 'kx-db' }, iconEl('vault'), h('strong', { class: 'kx-db-name kx-ellipsis' }), h('span', { class: 'kx-dirty', title: t('kx.unsaved'), 'aria-label': t('kx.unsaved'), hidden: true })),
    h('div', { class: 'kx-search-wrap' }, iconEl('search'), search),
    h('div', { class: 'kx-tools' },
      tb('new', 'plus', 'kx.newEntry', () => newEntry()),
      tb('gen', 'dice', 'kx.generator', () => generatorDialog()),
      tb('save', 'save', 'kx.save', () => actions.save()),
      tb('settings', 'settings', 'kx.settings', async () => { if (await settingsDialog()) renderPanes(); }),
      tb('lock', 'lock', 'kx.lock', () => actions.lock())));
}

// --- group tree -------------------------------------------------------------------------------------------------

// ARIA tree: treeitem contains its role=group of children; aria-expanded only on items with subgroups; roving tabindex on the selected group.
function treeItem(g, level) {
  const bin = g === recycle();
  const sel = g === S.group && !S.query.trim();
  const count = g.entries.length, kids = g.groups.length;
  const name = g.name || t('kx.root');
  const node = h('div', { class: 'kx-node' + (sel ? ' kx-on' : '') + (bin ? ' kx-bin' : ''), style: { paddingInlineStart: 4 + (level - 1) * 14 + 'px' } },
    h('span', { class: 'kx-twist', dataset: { twist: kids ? '1' : '' }, 'aria-hidden': 'true', title: kids ? t(g.isExpanded ? 'kx.collapse' : 'kx.expand') : null }, kids ? iconEl(g.isExpanded ? 'chevDown' : 'chevRight') : null),
    itemIcon(g, 18),
    h('span', { class: 'kx-node-name kx-ellipsis' }, name),
    count ? h('span', { class: 'kx-count', 'aria-hidden': 'true' }, String(count)) : null,
    h('button', { type: 'button', tabindex: '-1', class: 'ed-iconbtn ed-sm kx-node-more', title: t('kx.groupActions'), 'aria-label': t('kx.groupActions'), dataset: { more: '1' } }, iconEl('more')));
  return h('div', {
    role: 'treeitem', class: 'kx-ti', tabindex: sel ? '0' : '-1', dataset: { uuid: g.uuid },
    'aria-level': String(level), 'aria-selected': String(sel), 'aria-expanded': kids ? String(g.isExpanded) : null,
    'aria-label': count ? `${name}, ${t('kx.entriesN', { n: count })}` : name,
  }, node, kids && g.isExpanded ? h('div', { role: 'group' }, g.groups.map((c) => treeItem(c, level + 1))) : null);
}

let focusTree = false; // focus the selected group after the next render (keyboard navigation)
function renderTree() {
  const el = document.getElementById('kx-tree');
  if (!el) return;
  const hadFocus = focusTree || (el.contains(document.activeElement) && document.activeElement.classList.contains('kx-ti'));
  focusTree = false;
  const scroll = el.scrollTop;
  el.textContent = '';
  const body = h('div', { class: 'kx-tree-body', role: 'tree', 'aria-label': t('kx.groups') }, treeItem(S.db.root, 1));
  el.append(h('div', { class: 'kx-pane-h' }, h('span', {}, t('kx.groups')),
    h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('kx.newGroup'), 'aria-label': t('kx.newGroup'), onclick: () => newGroup(canAddTo(S.group) ? S.group : S.db.root) }, iconEl('folderPlus'))),
  body);
  if (!body.querySelector('.kx-ti[tabindex="0"]')) body.querySelector('.kx-ti').tabIndex = 0;
  el.scrollTop = scroll;
  if (hadFocus) body.querySelector('.kx-ti[tabindex="0"]')?.focus({ preventScroll: false });
}

// Tree keyboard pattern (WAI-ARIA): Up/Down move, Right opens or enters, Left closes or goes to the parent, Enter selects, F2 renames.
function treeEvents(el) {
  el.addEventListener('click', (ev) => {
    const ti = ev.target.closest('.kx-ti');
    const g = groupOf(ti);
    if (!g) return;
    if (ev.target.closest('[data-more]')) {
      const b = ev.target.closest('[data-more]').getBoundingClientRect();
      treeCtx?.open(ti, { x: b.left, y: b.bottom + 2, via: 'mouse' });
      return;
    }
    if (ev.target.closest('[data-twist="1"]')) { g.isExpanded = !g.isExpanded; focusTree = true; renderTree(); return; }
    focusTree = true;
    selectGroup(g);
  });
  el.addEventListener('keydown', (ev) => {
    const ti = ev.target.closest && ev.target.closest('.kx-ti');
    if (!ti || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const g = groupOf(ti);
    const items = [...el.querySelectorAll('.kx-ti')];
    const i = items.indexOf(ti);
    const go = (x) => { if (!x) return; focusTree = true; selectGroup(groupOf(x), { open: false }); };
    switch (ev.key) {
      case 'ArrowDown': ev.preventDefault(); go(items[i + 1]); break;
      case 'ArrowUp': ev.preventDefault(); go(items[i - 1]); break;
      case 'Home': ev.preventDefault(); go(items[0]); break;
      case 'End': ev.preventDefault(); go(items[items.length - 1]); break;
      case 'ArrowRight':
        ev.preventDefault();
        if (g.groups.length && !g.isExpanded) { g.isExpanded = true; focusTree = true; renderTree(); } else if (g.groups.length) go(ti.querySelector('[role=group] > .kx-ti'));
        break;
      case 'ArrowLeft':
        ev.preventDefault();
        if (g.groups.length && g.isExpanded) { g.isExpanded = false; focusTree = true; renderTree(); } else go(ti.parentElement.closest('.kx-ti'));
        break;
      case 'Enter': case ' ': ev.preventDefault(); focusTree = true; selectGroup(g); break;
      case 'F2': ev.preventDefault(); renameGroup(g); break;
      case 'Delete': if (g.parent) { ev.preventDefault(); deleteGroup(g); } break;
      default:
    }
  });
  // Entries dragged from the list drop onto groups.
  const nodeAt = (ev) => ev.target.closest && ev.target.closest('.kx-node');
  // Custom MIME type text/x-kx-entry: only drags started in our list are accepted, never files or text from elsewhere.
  el.addEventListener('dragover', (ev) => {
    const n = nodeAt(ev);
    if (!n || ![...ev.dataTransfer.types].includes('text/x-kx-entry')) return;
    const g = groupOf(n.parentElement);
    if (!canAddTo(g) && g !== recycle()) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    for (const x of el.querySelectorAll('.kx-drop')) if (x !== n) x.classList.remove('kx-drop');
    n.classList.add('kx-drop');
  });
  el.addEventListener('dragleave', (ev) => { const n = nodeAt(ev); if (n && !n.contains(ev.relatedTarget)) n.classList.remove('kx-drop'); });
  el.addEventListener('drop', (ev) => {
    const n = nodeAt(ev);
    for (const x of el.querySelectorAll('.kx-drop')) x.classList.remove('kx-drop');
    if (!n) return;
    const g = groupOf(n.parentElement);
    const list = String(ev.dataTransfer.getData('text/x-kx-entry') || '').split('\n').map((u) => S.db.getEntry(u)).filter((e) => e && e.parent !== g);
    if (!g || !list.length) return;
    ev.preventDefault();
    for (const e of list) S.db.move(e, g);
    markDirty();
    toast(t('kx.movedN', { n: list.length, name: g.name || t('kx.root') }), 'ok');
    S.sel = new Set();
    S.entry = null;
    renderPanes();
  });
}

// --- entry list ---------------------------------------------------------------------------------------------------

function selectionBar() {
  const n = selectedEntries().filter((e) => S.sel.has(e)).length;
  const act = (ic, label, fn, danger) => h('button', { type: 'button', class: 'ed-iconbtn ed-sm' + (danger ? ' ed-danger' : ''), title: label, 'aria-label': label, disabled: !n, onclick: fn }, iconEl(ic));
  return h('div', { class: 'kx-pane-h kx-selbar' },
    h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('kx.selectDone'), 'aria-label': t('kx.selectDone'), onclick: () => clearSelection() }, iconEl('close')),
    h('span', { class: 'kx-ellipsis', 'aria-live': 'polite' }, t('kx.nSelected', { n })),
    h('span', { class: 'ed-spacer' }),
    h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('kx.selectAll'), 'aria-label': t('kx.selectAll'), onclick: () => selectAll() }, iconEl('selectAll')),
    act('move', t('kx.moveTo'), () => moveEntries()),
    act('image', t('kx.changeIcon'), () => changeEntryIcons()),
    act('trash', t('kx.delete'), () => deleteEntries(), true));
}

function entryRow(e, focusUuid, searching) {
  const user = S.db.fieldValue(e, 'UserName');
  const on = e === S.entry, picked = S.sel.has(e);
  return h('div', {
    class: 'kx-row' + (on ? ' kx-on' : '') + (picked ? ' kx-sel' : '') + (isExpired(e) ? ' kx-expired' : ''),
    role: 'option', 'aria-selected': String(picked), tabindex: e.uuid === focusUuid ? '0' : '-1', dataset: { uuid: e.uuid }, draggable: FINE_POINTER ? 'true' : null,
  },
  S.selecting ? h('span', { class: 'kx-check', 'aria-hidden': 'true' }, picked ? iconEl('check') : null) : null,
  iconTile(e, 32),
  h('span', { class: 'kx-row-text' },
    h('span', { class: 'kx-row-title kx-ellipsis' }, e.get('Title') || t('kx.noTitle')),
    h('span', { class: 'kx-row-sub kx-ellipsis' }, searching ? [user, groupPath(e.parent)].filter(Boolean).join(' · ') : user)),
  entryOtp(e) ? h('span', { class: 'kx-row-flag', title: 'TOTP' }, iconEl('clock')) : null,
  e.binaries.size ? h('span', { class: 'kx-row-flag', title: t('kx.attachments') }, iconEl('clip')) : null);
}

// Listbox with aria-multiselectable; the focusable row is the current entry or the first one.
function renderList() {
  const el = document.getElementById('kx-list');
  if (!el) return;
  const active = document.activeElement;
  const hadFocus = el.contains(active) && active.classList.contains('kx-row');
  const scroll = el.scrollTop;
  el.textContent = '';
  const list = visibleEntries();
  const searching = !!S.query.trim();
  el.dataset.selecting = S.selecting ? '1' : '';
  el.append(S.selecting ? selectionBar() : h('div', { class: 'kx-pane-h' },
    h('button', { type: 'button', class: 'ed-iconbtn ed-sm kx-back', title: t('kx.groups'), 'aria-label': t('kx.groups'), onclick: () => { S.view = 'tree'; renderPanes(); } }, iconEl('back')),
    h('span', { class: 'kx-ellipsis' }, searching ? t('kx.results') : S.group.name || t('kx.root')),
    h('span', { class: 'kx-count' }, S.sel.size > 1 ? t('kx.nOfM', { n: S.sel.size, m: list.length }) : String(list.length)),
    h('span', { class: 'ed-spacer' }),
    !searching && canAddTo(S.group) ? h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('kx.newEntry'), 'aria-label': t('kx.newEntry'), onclick: () => newEntry() }, iconEl('plus')) : null));
  const body = h('div', { class: 'kx-list-body' });
  el.append(body);
  if (!list.length) {
    body.append(h('div', { class: 'ap-empty' }, t(searching ? 'kx.noResults' : 'kx.emptyGroup')));
    return;
  }
  const focusUuid = (S.entry && list.includes(S.entry) ? S.entry : list[0]).uuid;
  const box = h('div', { class: 'kx-rows', role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': searching ? t('kx.results') : S.group.name || t('kx.root') },
    list.map((e) => entryRow(e, focusUuid, searching)));
  body.append(box);
  el.scrollTop = scroll;
  if (hadFocus) box.querySelector('.kx-row[tabindex="0"]')?.focus({ preventScroll: true });
  box.querySelector('.kx-row[tabindex="0"]')?.scrollIntoView({ block: 'nearest' });
}

// Selection changes that keep the rows (right click, long press): classes and the details pane only.
// Right click / long press must not rebuild the list (the menu is anchored to the row element), so only classes change.
function selectQuiet(e) {
  S.entry = e;
  S.sel = new Set([e]);
  S.anchor = e;
  S.draft = null;
  S.reveal.clear();
  for (const row of document.querySelectorAll('#kx-list .kx-row')) {
    const on = row.dataset.uuid === e.uuid;
    row.classList.toggle('kx-on', on);
    row.classList.toggle('kx-sel', on);
    row.setAttribute('aria-selected', String(on));
    row.tabIndex = on ? 0 : -1;
  }
  renderDetail();
}

// Click semantics of file managers: Shift = range from the anchor, Ctrl/Cmd = toggle, plain = select only; in selection mode a tap toggles.
function listEvents(el) {
  const rowOf = (ev) => ev.target.closest && ev.target.closest('.kx-row');
  // Rows drag with a mouse only: a long press by touch opens the menu instead of a drag.
  el.addEventListener('pointerdown', (ev) => { const r = rowOf(ev); if (r) r.draggable = ev.pointerType === 'mouse'; });
  el.addEventListener('click', (ev) => {
    const r = rowOf(ev);
    const e = r && entryByUuid(r.dataset.uuid);
    if (!e) return;
    if (S.selecting) toggleSelect(e);
    else if (ev.shiftKey) selectRange(e);
    else if (ev.ctrlKey || ev.metaKey) toggleSelect(e);
    else selectOnly(e);
  });
  el.addEventListener('dblclick', (ev) => { const r = rowOf(ev); if (r && !S.selecting) editEntry(entryByUuid(r.dataset.uuid)); });
  el.addEventListener('dragstart', (ev) => {
    const r = rowOf(ev);
    const e = r && entryByUuid(r.dataset.uuid);
    if (!e) return;
    const list = S.sel.has(e) && S.sel.size > 1 ? selectedEntries() : [e];
    ev.dataTransfer.setData('text/x-kx-entry', list.map((x) => x.uuid).join('\n'));
    ev.dataTransfer.setData('text/plain', list.map((x) => x.get('Title')).join('\n'));
    ev.dataTransfer.effectAllowed = 'move';
  });
  el.addEventListener('keydown', (ev) => {
    const r = rowOf(ev);
    if (!r) return;
    const rows = [...el.querySelectorAll('.kx-row')];
    const i = rows.indexOf(r);
    const e = entryByUuid(r.dataset.uuid);
    const to = (j, extend) => {
      const x = rows[Math.max(0, Math.min(rows.length - 1, j))];
      if (!x || x === r) return;
      const target = entryByUuid(x.dataset.uuid);
      if (extend) selectRange(target);
      else if (S.selecting) { S.entry = target; renderList(); el.querySelector(`.kx-row[data-uuid="${CSS.escape(target.uuid)}"]`)?.focus(); return; }
      else selectOnly(target, { open: false });
      el.querySelector('.kx-row[tabindex="0"]')?.focus();
    };
    if (ev.altKey) return;
    switch (ev.key) {
      case 'ArrowDown': ev.preventDefault(); to(i + 1, ev.shiftKey); break;
      case 'ArrowUp': ev.preventDefault(); to(i - 1, ev.shiftKey); break;
      case 'Home': ev.preventDefault(); to(0, ev.shiftKey); break;
      case 'End': ev.preventDefault(); to(rows.length - 1, ev.shiftKey); break;
      case 'PageDown': ev.preventDefault(); to(i + 10, ev.shiftKey); break;
      case 'PageUp': ev.preventDefault(); to(i - 10, ev.shiftKey); break;
      case ' ':
        ev.preventDefault();
        if (S.selecting || ev.ctrlKey || ev.metaKey) toggleSelect(e); else selectOnly(e, { open: false });
        el.querySelector(`.kx-row[data-uuid="${CSS.escape(e.uuid)}"]`)?.focus();
        break;
      case 'Enter':
        ev.preventDefault();
        if (S.selecting) toggleSelect(e); else selectOnly(e);
        break;
      default:
    }
  });
}

// --- details --------------------------------------------------------------------------------------------------------

let totpTimer = null;
// One shared interval; it stops itself when the code element is gone (pane re-rendered), so no timer outlives its view.
function totpBlock(e) {
  const otp = entryOtp(e);
  if (!otp) return null;
  const code = h('span', { class: 'kx-totp-code' });
  const ring = h('span', { class: 'kx-totp-ring' });
  const left = h('span', { class: 'kx-totp-left' });
  let first = true;
  const paint = () => {
    // The block is built before it is attached; later ticks stop once it left the page.
    if (!first && !code.isConnected) { clearInterval(totpTimer); return; }
    first = false;
    const r = otpCode(otp, Date.now());
    code.textContent = r.code.length > 5 ? r.code.slice(0, Math.ceil(r.code.length / 2)) + ' ' + r.code.slice(Math.ceil(r.code.length / 2)) : r.code;
    code.dataset.code = r.code;
    if (r.remaining != null) {
      left.textContent = t('kx.seconds', { n: r.remaining });
      ring.style.setProperty('--kx-p', String(r.remaining / r.period));
      ring.classList.toggle('kx-low', r.remaining <= 5);
    }
  };
  clearInterval(totpTimer);
  paint();
  totpTimer = setInterval(paint, 1000);
  return h('div', { class: 'kx-field', dataset: { field: 'otp' } },
    h('div', { class: 'kx-field-l' }, t('kx.totp')),
    h('div', { class: 'kx-field-v kx-totp' }, ring, code, left),
    h('div', { class: 'kx-field-a' }, h('button', { type: 'button', class: 'ed-iconbtn', title: t('ap.copy'), 'aria-label': `${t('ap.copy')}: ${t('kx.totp')}`, onclick: () => copySecret(code.dataset.code, t('kx.totp')) }, iconEl('copy'))));
}

const toggleReveal = (name) => { if (S.reveal.has(name)) S.reveal.delete(name); else S.reveal.add(name); renderDetail(); };

// Field references ({REF:…}) are resolved for display and copy; the stored value keeps the reference.
function fieldRow(e, name, label) {
  const v = e.fields.get(name);
  if (v == null || (typeof v === 'string' && !v && name !== 'Password')) return null;
  const prot = v instanceof ProtectedValue;
  const shown = !prot || S.reveal.has(name);
  const raw = prot ? v.getText() : v;
  if (!raw && name === 'Password' && !prot) return null;
  // Field references ({REF:P@I:...}) show the value they point at.
  const text = raw.includes('{REF:') ? S.db.resolveReferences(raw) : raw;
  const isRef = text !== raw;
  const val = h('div', { class: 'kx-field-v' + (prot && !shown ? ' kx-masked' : '') + (name === 'Password' || prot ? ' kx-mono' : '') }, shown ? text : '•'.repeat(Math.min(12, Math.max(6, [...text].length))));
  return h('div', { class: 'kx-field', dataset: { field: name, label } },
    h('div', { class: 'kx-field-l' }, label, isRef ? h('span', { class: 'kx-ref', title: t('kx.ref'), 'aria-label': t('kx.ref') }, iconEl('link')) : null),
    val,
    h('div', { class: 'kx-field-a' },
      prot ? h('button', { type: 'button', class: 'ed-iconbtn', 'aria-pressed': String(shown), title: t('kx.reveal'), 'aria-label': `${t('kx.reveal')}: ${label}`, onclick: () => toggleReveal(name) }, iconEl(shown ? 'eyeOff' : 'eye')) : null,
      name === 'URL' && entryUrl(e) ? h('button', { type: 'button', class: 'ed-iconbtn', title: t('kx.openUrl'), 'aria-label': t('kx.openUrl'), onclick: () => openUrl(e) }, iconEl('external')) : null,
      h('button', { type: 'button', class: 'ed-iconbtn', title: t('ap.copy'), 'aria-label': `${t('ap.copy')}: ${label}`, onclick: () => copySecret(text, label) }, iconEl('copy'))));
}

function moreButton(e) {
  return h('button', { type: 'button', class: 'ed-iconbtn', title: t('kx.more'), 'aria-label': t('kx.more'), 'aria-haspopup': 'menu', onclick: (ev) => {
    openMenu(ev.currentTarget, [
      ...entryItems(e, { via: 'mouse' }).filter((x) => x && !x.header),
      { sep: true },
      { label: t('kx.historyBtn', { n: e.history.length }), icon: 'history', disabled: !e.history.length, action: async () => { if (await historyDialog(e) === 'restored') renderPanes(); } },
    ], { restoreFocus: true });
  } }, iconEl('more'));
}

// Several entries selected: what they are and what can be done with all of them.
function multiDetail(el, list) {
  el.append(h('div', { class: 'kx-detail-h' },
    h('button', { type: 'button', class: 'ed-iconbtn kx-back', title: t('kx.back'), 'aria-label': t('kx.back'), onclick: () => { S.view = 'list'; renderPanes(); } }, iconEl('back')),
    h('div', { class: 'kx-multi-tiles', 'aria-hidden': 'true' }, list.slice(0, 3).map((e) => iconTile(e, 34))),
    h('div', { class: 'kx-detail-t' }, h('h2', {}, t('kx.nSelected', { n: list.length })), h('div', { class: 'ed-muted kx-ellipsis' }, t('kx.multiHint')))));
  const btn = (label, ic, fn, kind) => { const b = button('=' + label, ic, fn, kind); b.classList.add('ed-sm'); return b; };
  el.append(h('div', { class: 'kx-multi' },
    h('div', { class: 'kx-multi-a' },
      btn(t('kx.moveTo'), 'move', () => moveEntries(list)),
      btn(t('kx.changeIcon') + '…', 'image', () => changeEntryIcons(list)),
      btn(t('kx.duplicate') + '…', 'duplicate', () => duplicateEntries(list)),
      btn(t('kx.copyEntries', { n: list.length }), 'copy', () => copyEntries(list)),
      btn(t('kx.selectNone'), 'close', () => clearSelection()),
      btn(t('kx.delete'), 'trash', () => deleteEntries(list), 'danger')),
    h('ul', { class: 'kx-multi-list' }, list.slice(0, 200).map((e) => h('li', {}, itemIcon(e, 16), h('span', { class: 'kx-ellipsis' }, e.get('Title') || t('kx.noTitle')),
      h('span', { class: 'ed-muted kx-ellipsis' }, S.db.fieldValue(e, 'UserName'))))),
    list.length > 200 ? h('div', { class: 'ed-hint' }, t('kx.andMore', { n: list.length - 200 })) : null));
}

// The strength meter is shown only while the password is revealed (it describes the visible value).
function renderDetail() {
  const el = document.getElementById('kx-detail');
  if (!el) return;
  el.textContent = '';
  if (S.draft) { el.append(editorView()); return; }
  const many = selectedEntries();
  if (S.sel.size > 1 && many.length > 1) { multiDetail(el, many); return; }
  const e = S.entry;
  if (!e || !e.parent) {
    el.append(h('div', { class: 'kx-placeholder' }, iconEl('vault'), h('p', {}, t('kx.pickEntry'))));
    return;
  }
  const L = LABEL();
  el.append(h('div', { class: 'kx-detail-h' },
    h('button', { type: 'button', class: 'ed-iconbtn kx-back', title: t('kx.back'), 'aria-label': t('kx.back'), onclick: () => { S.view = 'list'; renderPanes(); } }, iconEl('back')),
    h('button', { type: 'button', class: 'kx-icon-btn', title: t('kx.changeIcon'), 'aria-label': t('kx.changeIcon'), onclick: () => changeEntryIcons([e]) }, iconTile(e, 40)),
    h('div', { class: 'kx-detail-t' }, h('h2', { class: 'kx-ellipsis' }, e.get('Title') || t('kx.noTitle')), h('div', { class: 'ed-muted kx-ellipsis' }, groupPath(e.parent) || t('kx.root'))),
    h('div', { class: 'kx-detail-a' }, button('kx.edit', 'edit', () => editEntry(e)), moreButton(e))));
  if (isExpired(e)) el.append(h('div', { class: 'kx-warn' }, iconEl('warn'), t('kx.expired', { d: fmtDate(e.times.expiry) })));
  let meter = null;
  if (e.get('Password') && S.reveal.has('Password') && e.isProtected('Password')) {
    meter = strengthView({ compact: true });
    meter.set(S.db.fieldValue(e, 'Password'));
    meter.el.classList.add('kx-hint-row');
  }
  el.append(h('div', { class: 'kx-fields' },
    fieldRow(e, 'UserName', L.UserName), fieldRow(e, 'Password', L.Password), meter ? meter.el : null,
    fieldRow(e, 'URL', L.URL), totpBlock(e),
    ...e.customFields.filter((k) => !OTP_FIELDS.test(k)).map((k) => fieldRow(e, k, k))));
  if (e.get('Notes')) el.append(h('div', { class: 'kx-block' }, h('h3', {}, L.Notes), h('div', { class: 'kx-notes' }, e.get('Notes'))));
  if (e.tags.length) el.append(h('div', { class: 'kx-block' }, h('h3', {}, t('kx.tags')), h('div', { class: 'kx-tags' }, e.tags.map((x) => h('span', { class: 'ed-tag' }, x)))));
  if (e.binaries.size) {
    el.append(h('div', { class: 'kx-block' }, h('h3', {}, t('kx.attachments')),
      h('div', { class: 'kx-atts' }, [...e.binaries].map(([name, b]) => h('div', { class: 'kx-att', dataset: { att: name } }, iconEl('file'),
        h('button', { type: 'button', class: 'kx-link kx-ellipsis', title: t('kx.view'), onclick: () => attachmentDialog(name, b) }, name),
        h('span', { class: 'ed-muted' }, fmtSize(b.size)),
        h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('ap.download'), 'aria-label': `${t('ap.download')}: ${name}`, onclick: () => download(b.data, name) }, iconEl('download')))))));
  }
  el.append(h('div', { class: 'kx-block kx-times' },
    h('dl', { class: 'ap-kv' },
      h('dt', {}, t('kx.created')), h('dd', {}, fmtDate(e.times.creation)),
      h('dt', {}, t('kx.modified')), h('dd', {}, fmtDate(e.times.lastModification)),
      e.times.expires ? [h('dt', {}, t('kx.expires')), h('dd', {}, fmtDate(e.times.expiry))] : null,
      e.history.length ? [h('dt', {}, t('kx.history')), h('dd', {}, h('button', { type: 'button', class: 'kx-link', onclick: async () => { if (await historyDialog(e) === 'restored') renderPanes(); } }, t('kx.versions', { n: e.history.length })))] : null)));
}

// --- context menus ---------------------------------------------------------------------------------------------------

let treeCtx = null;
let detachers = [];

// Context menus re-attached per render; old bindings are detached first (no duplicate menus).
function attachMenus(tree, list, detail) {
  for (const d of detachers) d();
  treeCtx = contextMenu(tree, (target) => {
    const g = groupOf(target);
    if (g) return groupItems(g);
    return [
      { label: t('kx.newGroup'), icon: 'folderPlus', action: () => newGroup(S.db.root) },
      { label: t('kx.expandAll'), icon: 'expand', action: () => { for (const x of S.db.allGroups()) if (x.groups.length && x !== recycle()) x.isExpanded = true; renderTree(); } },
      { label: t('kx.collapseAll'), icon: 'collapse', action: () => { for (const x of S.db.allGroups()) if (x.parent) x.isExpanded = false; renderTree(); } },
    ];
  }, { selector: '.kx-ti, .kx-tree-body', label: t('kx.groupActions') });
  const listCtx = contextMenu(list, (target, info) => {
    if (!target.classList.contains('kx-row')) return listItems(info);
    const e = entryByUuid(target.dataset.uuid);
    if (!e) return null;
    // Like a file manager: the pressed entry becomes the selection unless it is part of it.
    if (!S.sel.has(e) && !S.selecting) selectQuiet(e);
    return S.sel.size > 1 && S.sel.has(e) ? bulkItems(selectedEntries(), info) : entryItems(e, info);
  }, { selector: '.kx-row, .kx-list-body', label: t('kx.entryActions') });
  const detailCtx = contextMenu(detail, (target, info) => {
    const e = S.entry;
    if (S.draft || !e || !e.parent) return null;
    if (selectedText(target)) return null; // selected text keeps the browser's menu (copy)
    if (target.classList.contains('kx-detail-h')) return entryItems(e, info);
    if (target.classList.contains('kx-notes')) return [{ label: t('kx.copyWhat', { what: t('kx.f.notes') }), icon: 'copy', action: () => copyField(e, 'Notes', t('kx.f.notes')) }];
    if (target.dataset.att) {
      const b = e.binaries.get(target.dataset.att);
      return b ? [{ label: t('kx.view'), icon: 'eye', action: () => attachmentDialog(target.dataset.att, b) }, { label: t('ap.download'), icon: 'download', action: () => download(b.data, target.dataset.att) }] : null;
    }
    if (target.dataset.field === 'otp') return [{ label: t('kx.copyTotp'), icon: 'copy', action: () => { const o = entryOtp(e); if (o) copySecret(otpCode(o, Date.now()).code, t('kx.totp')); } }];
    if (target.dataset.field) return fieldItems(e, target.dataset.field, target.dataset.label, { toggleReveal: () => toggleReveal(target.dataset.field) });
    return null;
  }, { selector: '.kx-field, .kx-notes, .kx-att, .kx-detail-h' });
  detachers = [treeCtx, listCtx, detailCtx];
}

// --- layout ---------------------------------------------------------------------------------------------------------------

export function renderPanes() {
  const panes = document.getElementById('kx-panes');
  if (!panes || !S.db) return;
  if (!S.group || (S.group !== S.db.root && !S.db.getGroup(S.group.uuid))) S.group = S.db.root;
  if (S.entry && !S.entry.parent) S.entry = null;
  for (const e of [...S.sel]) if (!e.parent) S.sel.delete(e);
  panes.dataset.view = S.view;
  renderTree();
  renderList();
  renderDetail();
  renderTop();
}

export function renderVault(main) {
  main.textContent = '';
  const tree = h('nav', { class: 'kx-pane kx-tree', id: 'kx-tree', 'aria-label': t('kx.groups') });
  const list = h('section', { class: 'kx-pane kx-list', id: 'kx-list', 'aria-label': t('kx.entries') });
  const detail = h('section', { class: 'kx-pane kx-detail', id: 'kx-detail', 'aria-label': t('kx.details') });
  main.append(h('div', { class: 'kx-app' }, toolbar(), h('div', { class: 'kx-panes', id: 'kx-panes' }, tree, list, detail)));
  treeEvents(tree);
  listEvents(list);
  attachMenus(tree, list, detail);
  renderPanes();
}

// Keyboard: Ctrl+F search, Ctrl+B / C / U copy the user name / password / URL (when no text is selected), Ctrl+Shift+U
// opens the URL, Ctrl+E edits, Ctrl+K duplicates, Ctrl+A selects every entry of the list, Delete deletes, Escape ends
// a multiple selection.
export function vaultKeys(e) {
  if (!S.db || e.defaultPrevented || document.querySelector('.ed-backdrop')) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable]');
  const inTree = e.target.closest && e.target.closest('#kx-tree');
  const entry = S.entry && S.entry.parent && !S.draft ? S.entry : null;
  if (mod && k === 'f') { e.preventDefault(); document.getElementById('kx-search')?.focus(); return; }
  if (typing || S.draft) return;
  if (mod && !e.altKey) {
    if (k === 'b' && entry) { e.preventDefault(); copyField(entry, 'UserName', t('kx.f.user')); }
    else if (k === 'c' && entry && !String(window.getSelection())) { e.preventDefault(); copyField(entry, 'Password', t('kx.f.password')); }
    else if (k === 'u' && entry && e.shiftKey) { e.preventDefault(); openUrl(entry); }
    else if (k === 'u' && entry) { e.preventDefault(); copyField(entry, 'URL', t('kx.f.url')); }
    else if (k === 'e' && entry) { e.preventDefault(); editEntry(entry); }
    else if (k === 'k' && selectedEntries().length) { e.preventDefault(); duplicateEntries(); }
    else if (k === 'a' && !inTree && visibleEntries().length) { e.preventDefault(); selectAll(); }
    return;
  }
  if (e.altKey) return;
  if (k === 'Delete' && !inTree && selectedEntries().length) { e.preventDefault(); deleteEntries(); }
  else if (k === 'Escape' && (S.selecting || S.sel.size > 1)) { e.preventDefault(); clearSelection(); }
}
