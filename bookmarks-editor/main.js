// bookmarks-editor/main.js - Bookmarks: a bookmark manager that is one offline HTML file, a small self-hosted
// service, or a standalone file that syncs with such a service (globalThis.IN_HTML_ARTIFACT decides; account.js /
// account.offline.js). This module starts the shell, opens the storage, wires the search box, toolbar, bulk bar,
// keys, paste and drops, and renders the sidebar and the list (list.js) on every change of the library.
//
// Boot order (each step depends on the previous one): account (decides WHICH database: per user) -> store (WHERE
// it lives) -> library (in-memory model + change events) -> chrome -> first render -> sync attach. Rendering before
// the account resolves would show one user's data under another user's name.
// Data flow: user action -> lib mutation -> lib.on event -> (a) queued store write, (b) renderSoon(). The view never
// writes storage directly; the library is the single source of truth.
// Side-effect import first: strings.js registers the i18n keys before any t() below can run.
import './strings.js';
import { $, h } from '../ui/dom.js';
import { icon, iconEl } from '../ui/icons.js';
import { startApp, t, toast } from '../ui/app.js';
import { confirmDialog, layers, openMenu, promptDialog } from '../ui/overlays.js';
import { Library } from '../bookmarks/library.js';
import { cloneRecord } from '../bookmarks/record.js';
import { newId } from '../bookmarks/clock.js';
import { suggest } from '../bookmarks/search.js';
import { findURLs, parseUserURL } from '../bookmarks/url.js';
import { openStore } from './db.js';
import { networked, startAccount } from './account.js';
import { MODE, S, UI, done, isTouch, items, moveBookmarks, removeBookmarks, setFlag, toggleFlag, undo } from './common.js';
import { SORT_KEYS, bindDrops, bindList, bindSidebar, clearSelection, focusRow, itemMenu, renderList, renderSidebar, selectAll, targets, viewTitle } from './list.js';
import { deleteTags, mergeTags, openDuplicates, openEditor, openHelp, openSettings, openTagManager, openTagsDialog, pickFolder, renameTag } from './dialogs.js';
import { openTransfer } from './transfer.js';

const LOGO = 'M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z';
const main = $('#main');

// offline flag for the shell: true = no network at all (offline artifact), 'serverless' = a file that may talk to a
// server the user configures, false = served by the bookmark service itself.
startApp({
  key: 'bm', name: 'bm.name', logo: LOGO, offline: !networked ? true : MODE === 'standalone' ? 'serverless' : false,
  onLang: () => { decorateHeader(); if (S.lib) { buildChrome(); render(); } },
  footer: () => h('span', { class: 'bm-foot' }, S.storage === 'memory' && S.lib ? t('bm.storage.memoryShort') : ''),
});

// The sync chip goes after the shell's spacer, i.e. at the right end of the header; re-run on language change
// because the shell rebuilds the header then.
function decorateHeader() {
  const top = $('#ap-top');
  if (!top || !S.account || !S.account.chip) return;
  const chip = S.account.chip();
  if (chip) top.querySelector('.ed-spacer')?.after(chip);
}

// --- start ---------------------------------------------------------------------------------------------------------------------
async function start() {
  // Sign-in screens replace the whole <main>; focus moves to the first field so keyboard users can type at once.
  const gate = (el) => { main.textContent = ''; main.className = 'ap-main bm-gate-main'; main.append(el); const f = el.querySelector('[autofocus], input, button'); if (f) f.focus(); };
  let started;
  try { started = await startAccount({ mode: MODE, gate }); } catch (e) { started = { dbName: 'in-html-bookmarks', account: null }; console.error(e); }
  S.account = started.account;
  main.className = 'ap-main ap-wide bm-app';
  main.textContent = '';
  main.append(h('div', { class: 'bm-loading' }, h('div', { class: 'ed-spinner' })));
  const store = await openStore(started.dbName);
  S.store = store;
  S.storage = store.kind;
  S.storageError = store.error;
  // Stable per-database device id + a random per-page suffix = the client id in record stamps. Two tabs of the same
  // browser get different client ids, so their concurrent edits never carry identical stamps (tie-breaking).
  let device = await store.getMeta('device');
  if (!device) { device = newId(8); await store.setMeta('device', device); }
  const lib = new Library({ client: device + newId(4) });
  lib.load(await store.load());
  S.lib = lib;
  const acc = S.account;
  S.features.sync = !!(acc && acc.remote);
  S.features.public = !!(acc && acc.remote);
  S.features.meta = !!(acc && acc.features && acc.features.meta);

  // Persistence: local edits are written as dirty (to be synced), merged ones as clean; another tab's writes are
  // merged without writing them back.
  // Writes are chained on one promise: IndexedDB transactions from rapid edits run in order, and S.flush() (used by
  // the sync loop) can await "everything written so far". A failed write is reported and the chain continues.
  let writes = Promise.resolve();
  let fromTab = false;
  S.flush = () => writes;
  const queue = (fn) => { writes = writes.then(fn).catch((e) => { console.error(e); toast(t('bm.storage.writeFail', { msg: e.message || e }), 'error'); }); };
  lib.on(({ origin, records }) => {
    // Records are cloned at event time: the library mutates its objects later, and the queued write must persist the
    // state of THIS change. Changes that came from another tab (fromTab) are already in IndexedDB; writing them back
    // would echo them forever between tabs.
    if (origin !== 'load' && !fromTab && records.length) { const copy = records.map(cloneRecord); queue(() => store.put(copy, { dirty: origin === 'local' })); }
    renderSoon();
  });
  store.onOtherTab((recs) => { fromTab = true; try { lib.merge(recs); } finally { fromTab = false; } });

  buildChrome();
  decorateHeader();
  render();
  bindGlobal();
  if (acc && acc.attach) acc.attach({ lib, store, flush: () => writes });
  if (store.kind === 'memory') toast(t('bm.storage.memory'), 'warn', { label: t('bm.set.backup'), fn: () => openTransfer('export') }, { sticky: true });
  // Test hooks for e2e.js (state inspection, readiness flag); harmless in production.
  window.__bm = { S, UI, render };
  window.__bmReady = true;
}

// --- chrome -------------------------------------------------------------------------------------------------------------------------
let side, listEl, toolbar, bulk, searchInput, suggList;
// Static frame built once (and again on language change): sidebar, search bar, toolbar, bulk bar, list. render()
// fills them. The search input is an ARIA combobox owning the suggestion listbox (#bm-qs).
function buildChrome() {
  main.textContent = '';
  side = h('aside', { class: 'bm-side', id: 'bm-side', 'aria-label': t('bm.side.library') });
  const backdrop = h('div', { class: 'bm-backdrop', onclick: () => drawer(false) });
  searchInput = h('input', {
    type: 'search', class: 'ed-input bm-q', id: 'bm-q', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'bm-qs', 'aria-autocomplete': 'list',
    autocomplete: 'off', spellcheck: 'false', placeholder: t('bm.search.ph'), 'aria-label': t('bm.search.label'), value: S.query,
  });
  suggList = h('ul', { class: 'bm-sugg bm-qsugg', id: 'bm-qs', role: 'listbox', hidden: true, 'aria-label': t('bm.search.sugg') });
  const bar = h('div', { class: 'bm-bar' },
    h('button', { type: 'button', class: 'ed-iconbtn bm-menu-btn', 'aria-label': t('bm.side.open'), 'aria-controls': 'bm-side', html: icon('menu'), onclick: () => drawer(true) }),
    h('div', { class: 'bm-search' }, h('span', { class: 'bm-q-ic', html: icon('search') }), searchInput,
      h('button', { type: 'button', class: 'ed-iconbtn bm-q-help', title: t('bm.help.syntax'), 'aria-label': t('bm.help.syntax'), html: icon('help'), onclick: () => openHelp() }), suggList),
    h('button', { type: 'button', class: 'ed-btn ed-primary bm-add', title: t('bm.add') + ' (N)', onclick: () => openEditor(null) }, iconEl('plus'), h('span', { class: 'bm-add-l' }, t('bm.add'))));
  toolbar = h('div', { class: 'bm-toolbar' });
  bulk = h('div', { class: 'bm-bulk', role: 'toolbar', 'aria-label': t('bm.sel.bar'), hidden: true });
  // listbox + aria-multiselectable: screen readers announce rows as selectable options. tabindex=-1: focusable by
  // script but not a tab stop itself; the roving row (list.js) is the tab stop.
  listEl = h('div', { class: 'bm-list', id: 'bm-list', role: 'listbox', 'aria-multiselectable': 'true', tabindex: '-1' });
  main.append(backdrop, side, h('section', { class: 'bm-content', 'aria-label': t('bm.list.label') }, bar, toolbar, bulk, listEl));
  bindList(listEl);
  bindSidebar(side);
  bindDrops(listEl);
  bindSearch();
}

// Phone drawer: a body class drives the CSS; focus moves into the drawer so keyboard and screen-reader users land
// in it, Escape and the backdrop close it.
function drawer(open) {
  document.body.classList.toggle('bm-drawer-open', open);
  if (open) { const f = side.querySelector('.bm-nav-i.ed-on, .bm-nav-i'); if (f) f.focus(); }
}

let raf = 0;
// Coalesce bursts of library events (an import fires many) into one render per animation frame.
function renderSoon() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }
function render() {
  if (!S.lib || !listEl) return;
  // Prune selection of records deleted elsewhere (other tab, sync) so bulk actions never target ghosts.
  for (const id of [...S.selection]) if (!S.lib.get(id)) S.selection.delete(id);
  renderSidebar(side);
  renderList(listEl); // computes S.visible, which the toolbar counts
  renderToolbar();
  renderBulk();
}

function renderToolbar() {
  toolbar.textContent = '';
  const n = (S.visible || []).length;
  const sort = h('select', { class: 'ed-input ed-select bm-sort', 'aria-label': t('bm.sort.label'), title: t('bm.sort.label') }, SORT_KEYS.map((k) => h('option', { value: k, selected: k === S.sort }, t('bm.sort.' + k))));
  // Write the stored value straight to localStorage as JSON: the same format lsGet() parses on the next start.
  sort.value = S.sort;
  sort.addEventListener('change', () => { S.sort = sort.value; localStorage.setItem('bm-sort', JSON.stringify(S.sort)); render(); });
  // Segmented control as a radiogroup of buttons with aria-checked: one-of-three semantics for assistive tech.
  const layouts = h('div', { class: 'ed-seg bm-layouts', role: 'radiogroup', 'aria-label': t('bm.layout.label') }, [['list', 'rows'], ['cards', 'cards'], ['compact', 'compact']].map(([k, ic]) => h('button', {
    type: 'button', role: 'radio', class: 'ed-seg-btn' + (S.layout === k ? ' ed-on' : ''), 'aria-checked': String(S.layout === k), title: t('bm.layout.' + k), 'aria-label': t('bm.layout.' + k), html: icon(ic),
    onclick: () => { S.layout = k; localStorage.setItem('bm-layout', JSON.stringify(k)); render(); },
  })));
  const tools = h('button', { type: 'button', class: 'ed-iconbtn', title: t('bm.tools'), 'aria-label': t('bm.tools'), 'aria-haspopup': 'menu', html: icon('more') });
  tools.addEventListener('click', () => openMenu(tools, [
    { label: t('bm.tr.title'), icon: 'upload', action: () => openTransfer('import') },
    { label: t('bm.dupes.title'), icon: 'dupes', action: () => openDuplicates() },
    { label: t('bm.tags.manage'), icon: 'tag', action: () => openTagManager() },
    { sep: true },
    { label: t('bm.select'), icon: 'checkSq', action: () => { S.selectMode = true; render(); } },
    { label: t('bm.help.selectAll'), icon: 'selectAll', kbd: 'Ctrl+A', action: () => selectAll() },
    { label: t('dlg.undo'), icon: 'undo', kbd: 'Ctrl+Z', disabled: !S.history.length, action: () => undo() },
    { sep: true },
    { label: t('ap.settings'), icon: 'settings', action: () => openSettings() },
    { label: t('bm.help.title'), icon: 'keyboard', kbd: '?', action: () => openHelp() },
  ]));
  const crumbs = h('div', { class: 'bm-title-wrap' });
  if (S.view.kind === 'folder') {
    const path = S.lib.tree().path(S.view.id);
    const ids = [];
    // Breadcrumb ids from the root down; tree.path() gives the matching names. The last entry is the current folder,
    // shown as the heading instead of a link.
    for (let x = S.view.id; x; x = S.lib.tree().parentOf(x)) ids.unshift(x);
    crumbs.append(h('nav', { class: 'bm-crumbs', 'aria-label': t('bm.side.folders') }, ids.slice(0, -1).map((id, i) => [h('button', { type: 'button', class: 'bm-crumb-b', onclick: () => UI.setView({ kind: 'folder', id }) }, path[i]), h('span', { 'aria-hidden': 'true' }, ' / ')])));
  }
  crumbs.append(h('h2', { class: 'bm-view-t' }, viewTitle()), h('span', { class: 'bm-view-n', role: 'status' }, S.query.trim() ? t('bm.list.found', { n }) : t('bm.list.count', { n })));
  if (S.view.kind === 'folder') {
    crumbs.append(h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('bm.act.more'), 'aria-label': t('bm.folder.actions'), html: icon('more'), onclick: (e) => openMenu(e.currentTarget, [
      { label: t('bm.folder.sub'), icon: 'folderPlus', action: () => UI.newFolder(S.view.id) },
      { label: t('bm.folder.rename'), icon: 'edit', action: () => UI.renameFolder(S.view.id) },
      { label: t('bm.folder.move'), icon: 'move', action: () => UI.moveFolder(S.view.id) },
      { label: t('bm.folder.export'), icon: 'download', action: () => UI.exportFolder(S.view.id) },
      { sep: true },
      { label: t('bm.folder.delete'), icon: 'trash', danger: true, action: () => UI.deleteFolder(S.view.id) },
    ]) }));
  }
  const selBtn = h('button', {
    type: 'button', class: 'ed-iconbtn bm-selmode' + (S.selectMode ? ' ed-on' : ''), 'aria-pressed': String(S.selectMode), title: t('bm.select'), 'aria-label': t('bm.select'), html: icon('checkSq'),
    onclick: () => { if (S.selectMode) clearSelection(); else { S.selectMode = true; render(); } },
  });
  toolbar.append(crumbs, h('span', { class: 'ed-spacer' }), sort, layouts, selBtn, tools);
}

// The bulk bar appears with a selection or in select mode; body.bm-bulk-on lets CSS reserve space for it.
function renderBulk() {
  const n = S.selection.size;
  document.body.classList.toggle('bm-bulk-on', !!(n || S.selectMode));
  bulk.hidden = !(n || S.selectMode);
  bulk.textContent = '';
  if (bulk.hidden) return;
  const ids = [...S.selection];
  const list = items(ids);
  const all = (f) => list.length && list.every((b) => b[f]);
  const btn = (ic, key, fn, opts = {}) => h('button', { type: 'button', class: 'ed-btn ed-sm bm-bulk-b' + (opts.danger ? ' ed-danger' : ''), disabled: !n, title: t(key), onclick: fn }, iconEl(ic), h('span', { class: 'bm-bulk-l' }, t(key)));
  const more = h('button', { type: 'button', class: 'ed-iconbtn', disabled: !n, title: t('bm.act.more'), 'aria-label': t('bm.act.more'), 'aria-haspopup': 'menu', html: icon('more') });
  more.addEventListener('click', () => openMenu(more, itemMenu(ids[0], isTouch() ? 'touch' : 'mouse'), { className: 'ed-ctx-menu', restoreFocus: true, label: t('bm.act.more') }));
  bulk.append(
    h('button', { type: 'button', class: 'ed-iconbtn', title: t('bm.sel.clear'), 'aria-label': t('bm.sel.clear'), html: icon('close'), onclick: () => clearSelection() }),
    h('span', { class: 'bm-bulk-n', role: 'status' }, n ? t('bm.sel.count', { n }) : t('bm.sel.tap')),
    h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => selectAll() }, t('bm.sel.all')),
    h('span', { class: 'ed-spacer' }),
    btn('tag', 'bm.act.tags', () => UI.tags(ids)),
    btn('move', 'bm.act.move', () => UI.move(ids)),
    btn(all('unread') ? 'read' : 'inbox', all('unread') ? 'bm.act.markRead' : 'bm.act.markUnread', () => setFlag(ids, 'unread', !all('unread'))),
    btn('star', all('fav') ? 'bm.act.unfav' : 'bm.act.fav', () => toggleFlag(ids, 'fav')),
    btn('trash', 'dlg.delete', () => UI.remove(ids), { danger: true }),
    more);
}

// --- search box with suggestions ------------------------------------------------------------------------------------------------------
// Live search: suggestions repaint on every keystroke (cheap, local), the list re-filters 120 ms after typing
// stops (debounce) because filtering + rendering thousands of bookmarks per keystroke would lag.
function bindSearch() {
  let active = -1, current = { items: [] };
  const apply = () => { S.query = searchInput.value; S.selection.clear(); render(); };
  let timer = 0;
  const close = () => { suggList.hidden = true; searchInput.setAttribute('aria-expanded', 'false'); searchInput.removeAttribute('aria-activedescendant'); active = -1; };
  const paint = () => {
    const caret = searchInput.selectionStart ?? searchInput.value.length;
    const tree = S.lib.tree();
    const folders = S.lib.folders().map((f) => ({ path: tree.pathString(f.id), count: S.lib.folderCount(f.id) }));
    current = suggest(searchInput.value, caret, { tags: S.lib.tags(), hosts: S.lib.hosts(), folders });
    suggList.textContent = '';
    if (!current.items.length || document.activeElement !== searchInput) { close(); return; }
    current.items.forEach((x, i) => suggList.append(h('li', {
      id: 'bm-qs-' + i, role: 'option', class: 'bm-sugg-i' + (i === active ? ' ed-on' : ''), 'aria-selected': String(i === active),
      onmousedown: (e) => { e.preventDefault(); accept(i); },
    }, h('span', { class: 'bm-sugg-k' }, t('bm.sugg.' + x.kind)), h('span', { class: 'bm-sugg-v' }, x.label), x.count ? h('span', { class: 'bm-count' }, String(x.count)) : null)));
    suggList.hidden = false;
    searchInput.setAttribute('aria-expanded', 'true');
    if (active >= 0) searchInput.setAttribute('aria-activedescendant', 'bm-qs-' + active); else searchInput.removeAttribute('aria-activedescendant');
  };
  // Suggestions replace only the token under the caret (current.from..to from bookmarks/search.js suggest), so
  // "tag:cs|" + Enter becomes "tag:css " and the rest of the query stays. Operators ending in ':' get no space so
  // the user can continue typing the value.
  const accept = (i) => {
    const x = current.items[i];
    if (!x) return;
    const v = searchInput.value;
    const ins = x.insert + (x.insert.endsWith(':') ? '' : ' ');
    searchInput.value = v.slice(0, current.from) + ins + v.slice(current.to).replace(/^\s+/, '');
    const pos = current.from + ins.length;
    searchInput.setSelectionRange(pos, pos);
    active = -1;
    apply();
    paint();
  };
  searchInput.addEventListener('input', () => { active = -1; paint(); clearTimeout(timer); timer = setTimeout(apply, 120); });
  searchInput.addEventListener('focus', paint);
  // Delay: a mousedown on a suggestion (preventDefault keeps focus) must not race with close.
  searchInput.addEventListener('blur', () => setTimeout(close, 120));
  searchInput.addEventListener('keydown', (e) => {
    const n = current.items.length;
    if (e.key === 'ArrowDown' && !suggList.hidden && n) { e.preventDefault(); active = (active + 1) % n; paint(); }
    else if (e.key === 'ArrowUp' && !suggList.hidden && n) { e.preventDefault(); active = (active - 1 + n) % n; paint(); }
    else if ((e.key === 'Enter' || e.key === 'Tab') && active >= 0 && !suggList.hidden) { e.preventDefault(); accept(active); }
    else if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); apply(); close(); if (S.visible && S.visible.length) focusRow(S.visible[0].id); }
    else if (e.key === 'ArrowDown' && S.visible && S.visible.length) { e.preventDefault(); close(); focusRow(S.visible[0].id); }
    // Escape peels one layer at a time: suggestions, then the query, then focus.
    else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (!suggList.hidden) close();
      else if (searchInput.value) { searchInput.value = ''; apply(); }
      else searchInput.blur();
    }
  });
}

// --- hooks ---------------------------------------------------------------------------------------------------------------------------------
// Fill the hook table declared in common.js; leaf modules call these without importing main.js.
Object.assign(UI, {
  render, renderSoon,
  setView(v) {
    S.view = { kind: 'all', id: '', tag: '', ...v };
    S.selection.clear();
    S.selectMode = false;
    drawer(false);
    render();
    window.scrollTo({ top: 0 });
  },
  setQuery(q) { S.query = q; if (searchInput) searchInput.value = q; render(); },
  edit: (b, preset) => openEditor(b, preset),
  tags: (ids) => openTagsDialog(ids),
  async move(ids) {
    const list = items(ids);
    if (!list.length) return;
    const cur = list.every((b) => S.lib.folderOf(b) === S.lib.folderOf(list[0])) ? S.lib.folderOf(list[0]) : null;
    const to = await pickFolder({ title: t('bm.move.title', { n: list.length }), current: cur ?? '' });
    if (to !== null) moveBookmarks(list.map((b) => b.id), to);
  },
  // Focus moves to the next surviving row (then the previous one) so repeated Delete walks down the list.
  async remove(ids) {
    const list = items(ids);
    if (!list.length) return;
    if (S.settings.confirmDelete && !(await confirmDialog(t('dlg.delete'), t('bm.act.deleteConfirm', { n: list.length }), t('dlg.delete'), true))) return;
    const next = nextFocus(list.map((b) => b.id));
    removeBookmarks(list.map((b) => b.id));
    if (next) S.focus = next;
  },
  async newFolder(parent = '') {
    const name = await promptDialog(t(parent ? 'bm.folder.sub' : 'bm.folder.new'), t('bm.folder.name'));
    if (!name) return;
    const f = S.lib.addFolder({ name, parent });
    done(t('bm.folder.created', { name: f.name }), [{ id: f.id, type: 'folder', value: null }]);
  },
  async renameFolder(id) {
    const f = S.lib.get(id);
    if (!f) return;
    const name = await promptDialog(t('bm.folder.rename'), t('bm.folder.name'), f.name);
    if (!name || name === f.name) return;
    const snap = S.lib.snapshot([id]);
    S.lib.renameFolder(id, name);
    done(t('bm.folder.renamed'), snap);
  },
  async moveFolder(id) {
    const f = S.lib.get(id);
    if (!f) return;
    const to = await pickFolder({ title: t('bm.folder.moveTitle', { name: f.name }), current: S.lib.tree().parentOf(id), exclude: S.lib.tree().descendants(id), rootLabel: t('bm.folder.top') });
    if (to === null) return;
    const snap = S.lib.snapshot([id]);
    if (S.lib.moveFolder(id, to)) done(t('bm.folder.moved'), snap); else toast(t('bm.folder.cannotMove'), 'warn');
  },
  // Empty folders are deleted without asking; otherwise the confirmation states how many bookmarks and subfolders
  // go. removeFolder returns the snapshot for undo.
  async deleteFolder(id) {
    const f = S.lib.get(id);
    if (!f) return;
    const n = S.lib.folderCount(id);
    const subs = S.lib.tree().descendants(id).size - 1;
    if ((n || subs) && !(await confirmDialog(t('bm.folder.delete'), t('bm.folder.deleteText', { name: f.name, n, subs }), t('dlg.delete'), true))) return;
    const snap = S.lib.removeFolder(id);
    if (S.view.kind === 'folder' && !S.lib.get(S.view.id)) S.view = { kind: 'all', id: '', tag: '' };
    done(t('bm.folder.deleted', { name: f.name }), snap);
  },
  exportFolder: (id) => openTransfer('export', { folder: id }),
  renameTag: (tag) => renameTag(tag),
  mergeTag: (tag) => mergeTags([tag]),
  deleteTag: (tag) => deleteTags([tag]),
  tagManager: () => openTagManager(),
  transfer: (tab, opts) => openTransfer(tab, opts),
  settings: () => openSettings(),
  // Wipe = delete every live record as normal deletions (tombstones), so with sync on it propagates to the server
  // and other devices; a local clear() would be undone by the next sync.
  async wipe() {
    const ids = S.lib.allRecords().filter((r) => !r.v.del).map((r) => r.id);
    if (!ids.length) return;
    if (!(await confirmDialog(t('bm.set.wipe'), t(S.features.sync ? 'bm.set.wipeSynced' : 'bm.set.wipeText', { n: S.lib.stats().total }), t('dlg.delete'), true))) return;
    const snap = S.lib.remove(ids);
    S.view = { kind: 'all', id: '', tag: '' };
    done(t('bm.set.wiped'), snap);
  },
});

function nextFocus(removed) {
  const ids = (S.visible || []).map((b) => b.id);
  const gone = new Set(removed);
  const i = ids.indexOf(S.focus);
  for (let j = i + 1; j < ids.length; j++) if (!gone.has(ids[j])) return ids[j];
  for (let j = i - 1; j >= 0; j--) if (!gone.has(ids[j])) return ids[j];
  return '';
}

// --- keys, paste, drops ---------------------------------------------------------------------------------------------------------------------
// Global keys. `layers.length` = a dialog or menu is open; those own the keyboard. Ctrl+K and '/' focus search
// from anywhere (the de facto web convention); single letters only outside fields.
function bindGlobal() {
  document.addEventListener('keydown', (e) => {
    if (layers.length || e.defaultPrevented) return;
    const inField = e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]');
    const mod = e.ctrlKey || e.metaKey;
    if ((e.key === 'k' && mod) || (e.key === '/' && !inField && !mod)) { e.preventDefault(); searchInput.focus(); searchInput.select(); return; }
    if (inField) return;
    if (e.key === 'z' && mod && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (e.key === 'a' && mod) { e.preventDefault(); selectAll(); focusRow(S.focus, { scroll: false }); return; }
    if (mod || e.altKey) return;
    if (e.key === 'n' || e.key === 'a') { e.preventDefault(); openEditor(null); }
    else if (e.key === '?') { e.preventDefault(); openHelp(); }
    else if (e.key === 'Escape' && (S.selection.size || S.selectMode)) { clearSelection(); }
    else if (e.key === 'Escape' && document.body.classList.contains('bm-drawer-open')) drawer(false);
    else if (!listEl.contains(e.target) && ['ArrowDown', 'ArrowUp', 'j', 'k'].includes(e.key) && S.visible && S.visible.length) { e.preventDefault(); focusRow(S.focus || S.visible[0].id); }
    else if (!listEl.contains(e.target) && S.focus && ['e', 'f', 'r', 't', 'v', 'Delete', 'Enter'].includes(e.key) && document.activeElement === document.body) {
      const ids = targets(S.focus);
      if (e.key === 'e') openEditor(S.lib.get(S.focus));
      else if (e.key === 'f') toggleFlag(ids, 'fav');
      else if (e.key === 'r') toggleFlag(ids, 'unread');
      else if (e.key === 't') UI.tags(ids);
      else if (e.key === 'v') UI.move(ids);
      else if (e.key === 'Delete') UI.remove(ids);
    }
  });

  // Paste a URL (or several, or a bookmark file) anywhere outside fields.
  // Paste outside fields: files -> import dialog, several URLs -> import, one URL -> editor with the rest of the text
  // as the title. Fields keep native paste.
  document.addEventListener('paste', (e) => {
    if (layers.length || e.defaultPrevented || (e.target.closest && e.target.closest('input, textarea, [contenteditable]'))) return;
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); openTransfer('import', { file: files[0] }); return; }
    const text = e.clipboardData?.getData('text/plain') || '';
    const urls = findURLs(text);
    if (!urls.length && !parseUserURL(text.trim())) return;
    e.preventDefault();
    if (urls.length > 1) openTransfer('import', { text });
    else {
      const url = urls[0] || parseUserURL(text.trim());
      const rest = text.replace(/\b(?:(?:https?|ftp):\/\/|www\.)\S+/i, ' ').replace(/\s+/g, ' ').trim();
      openEditor(null, { url, title: rest.length < 300 ? rest : '' });
    }
  });

  // Drop links or bookmark files from elsewhere.
  // A foreign drag carries Files or a URL type and none of our private types (those are handled by list.js zones).
  // text/x-moz-url is Firefox's "URL\nTitle" pair, which also gives the title.
  const external = (e) => e.dataTransfer && ![...e.dataTransfer.types].includes('application/x-in-html-bookmarks') && ![...e.dataTransfer.types].includes('application/x-in-html-folder') &&
    [...e.dataTransfer.types].some((x) => x === 'Files' || x === 'text/uri-list' || x === 'text/x-moz-url');
  document.addEventListener('dragover', (e) => { if (!layers.length && external(e) && !e.defaultPrevented) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; document.body.classList.add('bm-drop-page'); } });
  // relatedTarget null = the pointer left the window (not just moved between child elements).
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('bm-drop-page'); });
  document.addEventListener('drop', (e) => {
    document.body.classList.remove('bm-drop-page');
    if (layers.length || e.defaultPrevented || !external(e)) return;
    e.preventDefault();
    const files = [...e.dataTransfer.files];
    if (files.length) { openTransfer('import', { file: files[0] }); return; }
    const moz = e.dataTransfer.getData('text/x-moz-url');
    // RFC 2483: lines starting with '#' are comments in text/uri-list.
    const list = (e.dataTransfer.getData('text/uri-list') || '').split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
    if (list.length > 1) { openTransfer('import', { text: list.join('\n') }); return; }
    const url = parseUserURL(list[0] || (moz ? moz.split('\n')[0] : ''));
    if (url) openEditor(null, { url, title: moz ? (moz.split('\n')[1] || '') : '' });
  });
}

// Last-resort boot failure: show the error in place of the app instead of a blank page.
start().catch((e) => {
  console.error(e);
  main.textContent = '';
  main.append(h('div', { class: 'ap-empty ed-error', role: 'alert' }, t('err.generic', { msg: e && e.message || e })));
});
