// bookmarks-editor/list.js - the sidebar (views, folder tree, tags) and the bookmark list (list / cards / compact),
// with selection (click, Ctrl / Shift click, keys, touch selection mode), drag and drop onto folders, and the context
// menus of bookmarks, folders and tags (ui/contextmenu.js: right click, long press, Menu key, Shift+F10).
//
// Rendering model: full re-render of the visible slice on every change (no virtual DOM, no diffing). Viable because
// the slice is capped (PAGE rows, grown on demand) and building ~150 rows is a few ms. Event handlers are delegated
// to the list root once (bindList), so re-rendering never re-binds per-row listeners.
// Keyboard model: roving tabindex. Exactly one row has tabindex=0 (S.focus); the others -1. Tab enters the list at
// the remembered row and leaves it in one step; arrows move focus inside. Buttons inside rows are tabindex=-1 for
// the same reason (keys E/T/V/F/Del reach their actions).
import { $, $$, h, lsGet, lsSet } from '../ui/dom.js';
import { icon, iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { contextMenu } from '../ui/contextmenu.js';
import { openMenu, toast } from '../ui/overlays.js';
import { parseQuery, searchItems } from '../bookmarks/search.js';
import { displayURL, hostOf, isLinkable } from '../bookmarks/url.js';
import {
  S, UI, avatar, copyItems, dateText, done, fineMouse, isTouch, items, moveBookmarks, openBookmark, setFlag, toggleFlag, when,
} from './common.js';

// Private MIME types identify our own drags; foreign drags (files, links from other apps) are handled by main.js.
const DRAG_TYPE = 'application/x-in-html-bookmarks';
const FOLDER_TYPE = 'application/x-in-html-folder';
// Rows rendered at first; "more" (or the IntersectionObserver sentinel) adds 2*PAGE at a time.
const PAGE = 150;
let shown = PAGE;
let lastKey = '';
let observer = null;
const openFolders = new Set(lsGet('bm-open-folders', []));

// --- what the list shows --------------------------------------------------------------------------------------------------
// Comparators. localeCompare with numeric:true sorts "Part 2" before "Part 10"; sensitivity:'base' ignores case and
// accents. Ties are broken by id in visibleItems() so the order is total and stable across renders.
const SORTS = {
  new: (a, b) => b.created - a.created,
  old: (a, b) => a.created - b.created,
  title: (a, b) => (a.title || a.url).localeCompare(b.title || b.url, undefined, { numeric: true, sensitivity: 'base' }),
  host: (a, b) => hostOf(a.url).localeCompare(hostOf(b.url)) || (a.title || '').localeCompare(b.title || ''),
  visited: (a, b) => (b.visited || 0) - (a.visited || 0) || b.created - a.created,
  modified: (a, b) => (b.modified || 0) - (a.modified || 0),
};
export const SORT_KEYS = Object.keys(SORTS);

// View filter, then search, then sort. Archived items are excluded unless the view is Archive or the query
// explicitly asks for is:archived: archiving means "out of the way", not deleted.
export function visibleItems() {
  const lib = S.lib;
  const v = S.view;
  const q = parseQuery(S.query);
  const archived = v.kind === 'archive' || q.terms.some((x) => x.op === 'is' && x.value.toLowerCase() === 'archived' && !x.neg);
  let list = lib.bookmarks({ archived });
  if (v.kind === 'unread') list = list.filter((b) => b.unread);
  else if (v.kind === 'fav') list = list.filter((b) => b.fav);
  else if (v.kind === 'archive') list = list.filter((b) => b.archived);
  else if (v.kind === 'untagged') list = list.filter((b) => !b.tags.length);
  else if (v.kind === 'folder') list = list.filter((b) => lib.folderOf(b) === v.id);
  else if (v.kind === 'tag') { const k = v.tag.toLowerCase(); list = list.filter((b) => b.tags.some((x) => x.toLowerCase() === k)); }
  if (S.query.trim()) {
    const tree = lib.tree();
    const res = searchItems(list, S.query, { path: (b) => tree.pathString(lib.folderOf(b)), host: (b) => hostOf(b.url) });
    // Ranked search (free-text terms produce scores): keep relevance order and ignore the chosen sort. A pure filter
    // query (all scores 1, e.g. tag:x) falls through and is sorted like a normal view.
    if (res.length && res.some((r) => r.score !== 1)) return res.map((r) => r.item);
    list = res.map((r) => r.item);
  }
  return list.slice().sort((a, b) => SORTS[S.sort](a, b) || (a.id < b.id ? -1 : 1));
}

export function viewTitle() {
  const v = S.view;
  if (v.kind === 'folder') { const f = S.lib.get(v.id); return f ? f.name : t('bm.side.all'); }
  if (v.kind === 'tag') return '#' + v.tag;
  return t('bm.side.' + v.kind);
}

// --- sidebar --------------------------------------------------------------------------------------------------------------------
const VIEWS = [['all', 'bookmark'], ['unread', 'inbox'], ['fav', 'star'], ['untagged', 'tag'], ['archive', 'archive']];

// Rebuilt as a whole; aria-current="page" marks the current view for screen readers in addition to .ed-on.
export function renderSidebar(side) {
  const lib = S.lib;
  const st = lib.stats();
  const counts = { all: st.all, unread: st.unread, fav: st.fav, untagged: st.untagged, archive: st.archived };
  const on = (kind, extra = {}) => S.view.kind === kind && Object.entries(extra).every(([k, v]) => S.view[k] === v);
  const navBtn = (kind, ic) => h('li', null, h('button', {
    type: 'button', class: 'bm-nav-i' + (on(kind) ? ' ed-on' : ''), 'aria-current': on(kind) ? 'page' : null,
    dataset: { view: kind, drop: kind }, onclick: () => UI.setView({ kind }),
  }, iconEl(ic), h('span', { class: 'bm-nav-l' }, t('bm.side.' + kind)), h('span', { class: 'bm-count' }, String(counts[kind] || 0))));

  const tree = lib.tree();
  // Folder rows are draggable only with a fine pointer: on touch, draggable rows hijack scroll and long press
  // (which opens the context menu instead).
  const folderItem = (f, depth) => {
    const kids = tree.children(f.id);
    const open = openFolders.has(f.id);
    const sel = on('folder', { id: f.id });
    const row = h('div', {
      class: 'bm-tree-row' + (sel ? ' ed-on' : ''), style: { '--bm-depth': String(depth) }, dataset: { folder: f.id, drop: 'folder' },
      draggable: fineMouse() ? 'true' : null,
    },
    kids.length ? h('button', {
      type: 'button', class: 'bm-tree-tw', 'aria-label': t(open ? 'bm.side.collapse' : 'bm.side.expand'), 'aria-expanded': String(open), html: icon('chevRight'),
      // Expanded folders persist in localStorage, so the tree reopens as the user left it.
      onclick: (e) => { e.stopPropagation(); if (open) openFolders.delete(f.id); else openFolders.add(f.id); lsSet('bm-open-folders', [...openFolders]); UI.render(); },
    }) : h('span', { class: 'bm-tree-tw' }),
    h('button', { type: 'button', class: 'bm-tree-b', 'aria-current': sel ? 'page' : null, onclick: () => UI.setView({ kind: 'folder', id: f.id }) },
      iconEl('folder'), h('span', { class: 'bm-nav-l' }, f.name), h('span', { class: 'bm-count' }, String(lib.folderCount(f.id) || ''))));
    return h('li', { role: 'none' }, row, kids.length && open ? h('ul', { class: 'bm-tree' }, kids.map((k) => folderItem(k, depth + 1))) : null);
  };
  const roots = tree.children('');
  const tags = lib.tags();
  const tagFilter = side.querySelector('.bm-tagfilter');
  const filterText = tagFilter ? tagFilter.value : '';
  const max = tags.length ? tags[0].count : 1;
  const tagBtn = (x) => {
    // Logarithmic weight 1..5: tag frequencies follow a power law, so a linear scale would make one huge tag and
    // the rest minimum size. max(2, max) avoids log(1) = 0 as a divisor when every tag is used once.
    const w = 1 + Math.round((4 * Math.log(x.count)) / Math.log(Math.max(2, max)));
    return h('button', {
      type: 'button', class: `bm-tagbtn bm-w${w}` + (on('tag') && S.view.tag.toLowerCase() === x.tag.toLowerCase() ? ' ed-on' : ''), dataset: { tag: x.tag, drop: 'tag' },
      onclick: () => UI.setView({ kind: 'tag', tag: x.tag }), title: t('bm.tag.count', { n: x.count }),
    }, x.tag, h('span', { class: 'bm-tagn' }, String(x.count)));
  };
  // At most 150 tags (the most used, since lib.tags() is ordered by count) then sorted alphabetically for scanning.
  const shownTags = (filterText ? tags.filter((x) => x.tag.toLowerCase().includes(filterText.toLowerCase())) : tags).slice(0, 150)
    .sort((a, b) => a.tag.localeCompare(b.tag));
  side.textContent = '';
  side.append(
    h('nav', { class: 'bm-side-sec', 'aria-label': t('bm.side.library') }, h('ul', { class: 'bm-nav' }, VIEWS.map(([k, ic]) => navBtn(k, ic)))),
    h('section', { class: 'bm-side-sec', 'aria-labelledby': 'bm-fh' },
      h('div', { class: 'bm-side-h' }, h('h2', { id: 'bm-fh' }, t('bm.side.folders')),
        h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('bm.folder.new'), 'aria-label': t('bm.folder.new'), html: icon('folderPlus'), onclick: () => UI.newFolder('') })),
      roots.length ? h('ul', { class: 'bm-tree bm-tree-root' }, roots.map((f) => folderItem(f, 0))) : h('p', { class: 'bm-side-empty' }, t('bm.side.noFolders'))),
    h('section', { class: 'bm-side-sec', 'aria-labelledby': 'bm-th' },
      h('div', { class: 'bm-side-h' }, h('h2', { id: 'bm-th' }, t('bm.side.tags')),
        tags.length ? h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('bm.tags.manage'), 'aria-label': t('bm.tags.manage'), html: icon('settings'), onclick: () => UI.tagManager() }) : null),
      tags.length > 12 ? (() => {
        const inp = h('input', { type: 'search', class: 'ed-input bm-tagfilter', placeholder: t('bm.side.filterTags'), 'aria-label': t('bm.side.filterTags'), value: filterText });
        // The filter re-renders the whole sidebar, which replaces the input: focus and caret are restored on the new
        // element so typing continues uninterrupted.
        inp.addEventListener('input', () => { const pos = inp.selectionStart; renderSidebar(side); const n = side.querySelector('.bm-tagfilter'); n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* ignore */ } });
        return inp;
      })() : null,
      tags.length ? h('div', { class: 'bm-tagcloud' }, shownTags.map(tagBtn)) : h('p', { class: 'bm-side-empty' }, t('bm.side.noTags'))),
  );
}

// Folder / tag menus of the sidebar.
function sideMenu(target) {
  if (target.dataset.folder) {
    const f = S.lib.get(target.dataset.folder);
    if (!f) return null;
    return [
      { header: true, label: f.name },
      { label: t('bm.folder.open'), icon: 'folder', action: () => UI.setView({ kind: 'folder', id: f.id }) },
      { label: t('bm.folder.sub'), icon: 'folderPlus', action: () => UI.newFolder(f.id) },
      { label: t('bm.folder.rename'), icon: 'edit', action: () => UI.renameFolder(f.id) },
      { label: t('bm.folder.move'), icon: 'move', action: () => UI.moveFolder(f.id) },
      { label: t('bm.folder.export'), icon: 'download', action: () => UI.exportFolder(f.id) },
      { sep: true },
      { label: t('bm.folder.delete'), icon: 'trash', danger: true, action: () => UI.deleteFolder(f.id) },
    ];
  }
  if (target.dataset.tag) {
    const tag = target.dataset.tag;
    return [
      { header: true, label: '#' + tag },
      { label: t('bm.tag.show'), icon: 'tag', action: () => UI.setView({ kind: 'tag', tag }) },
      { label: t('bm.tag.rename'), icon: 'edit', action: () => UI.renameTag(tag) },
      { label: t('bm.tag.merge'), icon: 'layers', action: () => UI.mergeTag(tag) },
      { sep: true },
      { label: t('bm.tag.delete'), icon: 'trash', danger: true, action: () => UI.deleteTag(tag) },
    ];
  }
  return null;
}

// --- list ----------------------------------------------------------------------------------------------------------------------------------
// One row. role=option inside the listbox list root; aria-selected mirrors the selection. The title link exists only
// for linkable URLs (http, https, ftp, ...); javascript: bookmarklets render as plain text so a click never runs
// them in this origin. Long URLs show just the host (over 80 chars the path is noise).
function itemEl(b) {
  const lib = S.lib;
  const sel = S.selection.has(b.id);
  const linkable = isLinkable(b.url);
  const folder = lib.folderOf(b);
  const titleText = b.title || displayURL(b.url) || b.url;
  // A real <a href>: middle-click, Ctrl-click, "copy link" and drag-to-tab work natively. tabindex=-1 keeps the
  // roving-tabindex model (the row is the tab stop); draggable=false so dragging the row drags the selection.
  const title = linkable
    ? h('a', { class: 'bm-title', href: b.url, target: '_blank', rel: 'noopener noreferrer', tabindex: '-1', draggable: 'false' }, titleText)
    : h('span', { class: 'bm-title bm-nolink', title: t('bm.item.noLink') }, titleText);
  const meta = [h('span', { class: 'bm-host' }, linkable ? (displayURL(b.url).length > 80 ? hostOf(b.url) : displayURL(b.url)) : t('bm.item.script'))];
  if (folder && S.view.kind !== 'folder') meta.push(h('button', { type: 'button', class: 'bm-crumb', tabindex: '-1', dataset: { goFolder: folder } }, iconEl('folder'), lib.tree().pathString(folder)));
  // <time datetime> carries the machine-readable date; the visible text is relative ("3 days ago").
  meta.push(h('time', { datetime: new Date(b.created || 0).toISOString(), title: dateText(b.created, true) }, when(b.created)));
  const flags = h('span', { class: 'bm-flags' },
    b.unread ? h('span', { class: 'bm-unread', title: t('bm.item.unread'), 'aria-label': t('bm.item.unread') }) : null,
    b.public && S.features.public ? h('span', { class: 'bm-flag', title: t('bm.item.public'), html: icon('globe') }) : null,
    b.archived ? h('span', { class: 'bm-flag', title: t('bm.item.archived'), html: icon('archive') }) : null);
  const row = h('div', {
    class: 'bm-item' + (sel ? ' bm-sel' : '') + (b.unread ? ' bm-is-unread' : ''), role: 'option', id: 'bm-i-' + b.id, 'aria-selected': String(sel),
    tabindex: S.focus === b.id ? '0' : '-1', dataset: { id: b.id }, draggable: fineMouse() ? 'true' : null, 'aria-label': titleText,
  },
  h('span', { class: 'bm-check', 'aria-hidden': 'true' }, h('span', { class: 'bm-box', html: sel ? icon('check') : '' })),
  avatar(b, S.layout === 'compact' ? 20 : 32),
  h('div', { class: 'bm-main' },
    h('div', { class: 'bm-line1' }, title, flags),
    h('div', { class: 'bm-meta' }, meta),
    b.notes && S.layout !== 'compact' ? h('div', { class: 'bm-notes' }, b.notes) : null,
    b.tags.length ? h('div', { class: 'bm-tags' }, b.tags.map((x) => h('button', { type: 'button', class: 'bm-tag', tabindex: '-1', dataset: { tag: x } }, x))) : null),
  h('div', { class: 'bm-acts' },
    h('button', { type: 'button', class: 'ed-iconbtn bm-star' + (b.fav ? ' ed-star-on' : ''), tabindex: '-1', 'aria-pressed': String(b.fav), title: t(b.fav ? 'bm.act.unfav' : 'bm.act.fav'), 'aria-label': t(b.fav ? 'bm.act.unfav' : 'bm.act.fav'), html: icon('star') }),
    h('button', { type: 'button', class: 'ed-iconbtn bm-more', tabindex: '-1', title: t('bm.act.more'), 'aria-label': t('bm.act.more'), 'aria-haspopup': 'menu', html: icon('more') })));
  return row;
}

// `shown` resets only when view, query or sort changes (key); a data change keeps the user's scroll depth.
// Focus is restored to the same row if the list had focus before the rebuild (DOM replaced => focus would drop to
// <body> and keyboard users would lose their place).
export function renderList(listEl, { keepShown = true } = {}) {
  const lib = S.lib;
  const list = visibleItems();
  S.visible = list;
  const key = JSON.stringify([S.view, S.query, S.sort]);
  if (key !== lastKey || !keepShown) { shown = PAGE; lastKey = key; }
  const hadFocus = listEl.contains(document.activeElement);
  if (S.focus && !list.some((b) => b.id === S.focus)) S.focus = '';
  if (!S.focus && list.length) S.focus = list[0].id;
  if (observer) { observer.disconnect(); observer = null; }
  listEl.textContent = '';
  listEl.className = `bm-list bm-l-${S.layout}` + (S.selectMode ? ' bm-selecting' : '') + (S.selection.size ? ' bm-has-sel' : '');
  listEl.setAttribute('aria-label', viewTitle());
  // Subfolders of the open folder come first, as chips.
  if (S.view.kind === 'folder' && !S.query.trim()) {
    const kids = lib.tree().children(S.view.id);
    if (kids.length) {
      listEl.append(h('div', { class: 'bm-subfolders', role: 'presentation' }, kids.map((f) => h('button', {
        type: 'button', class: 'bm-subfolder', dataset: { goFolder: f.id, folder: f.id, drop: 'folder' },
      }, iconEl('folder'), f.name, h('span', { class: 'bm-count' }, String(lib.folderCount(f.id) || ''))))));
    }
  }
  if (!list.length) {
    listEl.append(emptyState());
    return;
  }
  // Fragment: one insertion into the live DOM = one style/layout pass instead of one per row.
  const frag = document.createDocumentFragment();
  for (const b of list.slice(0, shown)) frag.append(itemEl(b));
  listEl.append(frag);
  if (list.length > shown) {
    const more = h('button', { type: 'button', class: 'ed-btn bm-more-items', onclick: () => { shown += PAGE * 2; renderList(listEl); } }, t('bm.list.more', { n: list.length - shown }));
    listEl.append(more);
    if ('IntersectionObserver' in window) {
      // Infinite scroll: the "more" button doubles as the sentinel; 600px rootMargin loads before it is visible. The
      // button stays as the fallback for engines without IntersectionObserver and for keyboard users.
      observer = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { shown += PAGE * 2; renderList(listEl); } }, { rootMargin: '600px' });
      observer.observe(more);
    }
  }
  if (hadFocus) focusRow(S.focus, { scroll: false });
}

function emptyState() {
  const total = S.lib.stats().total;
  if (!total) {
    return h('div', { class: 'bm-empty bm-welcome' },
      h('div', { class: 'bm-empty-ic', html: icon('bookmark') }),
      h('h2', null, t('bm.empty.title')),
      h('p', null, t('bm.empty.text')),
      h('div', { class: 'ap-actions' },
        h('button', { type: 'button', class: 'ed-btn ed-primary', onclick: () => UI.edit(null) }, iconEl('plus'), t('bm.add')),
        h('button', { type: 'button', class: 'ed-btn', onclick: () => UI.transfer('import') }, iconEl('upload'), t('bm.import.fromBrowser'))),
      h('details', { class: 'bm-howto' }, h('summary', null, t('bm.empty.howto')),
        h('ul', null, ['chrome', 'firefox', 'safari', 'edge'].map((k) => h('li', null, h('b', null, t('bm.howto.' + k + '.name')), ' — ', t('bm.howto.' + k))))));
  }
  return h('div', { class: 'bm-empty' }, h('div', { class: 'bm-empty-ic', html: icon('search') }), h('h2', null, t('bm.empty.none')),
    S.query ? h('button', { type: 'button', class: 'ed-btn', onclick: () => UI.setQuery('') }, t('bm.search.clear')) : null);
}

// --- focus and selection ---------------------------------------------------------------------------------------------------------------------
const rowOf = (id) => document.getElementById('bm-i-' + id);

// Move the roving tab stop. If the target is beyond the rendered slice (Shift+End, search jump), grow the slice and
// re-render first. preventScroll lets the caller decide; scrollIntoView 'nearest' moves only when needed.
export function focusRow(id, { scroll = true } = {}) {
  if (!id) return;
  for (const r of $$('.bm-item[tabindex="0"]')) if (r.dataset.id !== id) r.tabIndex = -1;
  S.focus = id;
  let r = rowOf(id);
  if (!r && S.visible) {
    const i = S.visible.findIndex((b) => b.id === id);
    if (i >= shown) { shown = i + PAGE; UI.render(); r = rowOf(id); }
  }
  if (!r) return;
  r.tabIndex = 0;
  try { r.focus({ preventScroll: !scroll }); } catch { /* ignore */ }
  if (scroll) r.scrollIntoView({ block: 'nearest' });
}

export function selectOnly(ids) { S.selection = new Set(ids); UI.render(); }

function toggleSel(id) {
  if (S.selection.has(id)) S.selection.delete(id); else S.selection.add(id);
  S.anchor = id;
  UI.render();
}

// Shift range from the anchor (last plainly clicked row) to id, in visible order. Without Ctrl it replaces the
// selection (file-manager semantics); with Ctrl it adds to it.
function rangeSel(id, add) {
  const ids = (S.visible || []).map((b) => b.id);
  const a = ids.indexOf(S.anchor || S.focus), b = ids.indexOf(id);
  if (a < 0 || b < 0) { toggleSel(id); return; }
  const part = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
  if (!add) S.selection.clear();
  for (const x of part) S.selection.add(x);
  UI.render();
}

export function selectAll() { S.selection = new Set((S.visible || []).map((b) => b.id)); UI.render(); }
export function clearSelection() { S.selection.clear(); S.selectMode = false; UI.render(); }

// Bookmarks an action applies to: the selection when the target is in it, else the target.
// Desktop convention: acting on a row inside the selection acts on the whole selection; on a row outside it, on
// that row only (the selection is left alone).
export function targets(id) { return id && !S.selection.has(id) ? [id] : [...S.selection]; }

// --- menus ---------------------------------------------------------------------------------------------------------------------------------------
// Menu items are data; null entries (feature off) are dropped by openMenu. "Open all" is disabled over 30 tabs:
// popup blockers allow few window.open calls per gesture and 100 tabs is never what the user wants.
export function itemMenu(id, via = 'mouse') {
  const b = S.lib.get(id);
  if (!b) return null;
  const ids = targets(id);
  const list = items(ids);
  const multi = list.length > 1;
  const all = (f) => list.every((x) => x[f]);
  const open = list.filter((x) => isLinkable(x.url));
  const menu = [];
  if (multi) menu.push({ header: true, label: t('bm.sel.count', { n: list.length }) });
  if (!multi) {
    menu.push({ label: t('bm.act.open'), icon: 'external', kbd: 'Enter', disabled: !open.length, action: () => openBookmark(b) });
  } else menu.push({ label: t('bm.act.openAll', { n: open.length }), icon: 'external', disabled: !open.length || open.length > 30, action: () => { for (const x of open) openBookmark(x); } });
  menu.push({ sep: true },
    { label: t(multi ? 'bm.act.copyUrls' : 'bm.act.copyUrl'), icon: 'link', action: () => copyItems(list, 'url') },
    { label: t('bm.act.copyTitle'), icon: 'copy', action: () => copyItems(list, 'title') },
    { label: t('bm.act.copyMd'), icon: 'doc', action: () => copyItems(list, 'md') },
    { sep: true });
  if (!multi) menu.push({ label: t('bm.act.edit'), icon: 'edit', kbd: 'E', action: () => UI.edit(b) });
  menu.push(
    { label: t('bm.act.tags'), icon: 'tag', kbd: 'T', action: () => UI.tags(ids) },
    { label: t('bm.act.move'), icon: 'move', kbd: 'V', action: () => UI.move(ids) },
    { label: t(all('unread') ? 'bm.act.markRead' : 'bm.act.markUnread'), icon: all('unread') ? 'read' : 'inbox', kbd: 'R', action: () => setFlag(ids, 'unread', !all('unread')) },
    { label: t(all('fav') ? 'bm.act.unfav' : 'bm.act.fav'), icon: 'star', kbd: 'F', action: () => setFlag(ids, 'fav', !all('fav')) },
    S.features.public ? { label: t(all('public') ? 'bm.act.private' : 'bm.act.public'), icon: all('public') ? 'lock' : 'globe', action: () => setFlag(ids, 'public', !all('public')) } : null,
    { label: t(all('archived') ? 'bm.act.unarchive' : 'bm.act.archive'), icon: 'archive', action: () => setFlag(ids, 'archived', !all('archived')) },
    { sep: true });
  // Touch has no Ctrl/Shift click: "Select" in the long-press menu enters select mode, where taps toggle.
  if (via === 'touch' || via === 'pen' || isTouch()) {
    menu.push({ label: t(S.selection.has(id) ? 'bm.act.deselect' : 'bm.act.select'), icon: 'checkSq', action: () => { S.selectMode = true; toggleSel(id); } });
  }
  menu.push({ label: multi ? t('bm.act.deleteN', { n: list.length }) : t('bm.act.delete'), icon: 'trash', kbd: 'Del', danger: true, action: () => UI.remove(ids) });
  return menu;
}

// --- wiring ----------------------------------------------------------------------------------------------------------------------------------------
// One delegated click handler resolves the target by closest(): folder crumb, star, more, tag, checkbox, link,
// then the row. Order matters: the most specific control wins before the generic row behaviour.
export function bindList(listEl) {
  listEl.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go-folder]');
    if (go && listEl.contains(go)) { e.preventDefault(); UI.setView({ kind: 'folder', id: go.dataset.goFolder }); return; }
    const row = e.target.closest('.bm-item');
    if (!row) return;
    const id = row.dataset.id;
    const b = S.lib.get(id);
    if (!b) return;
    if (e.target.closest('.bm-star')) { toggleFlag([id], 'fav'); return; }
    if (e.target.closest('.bm-more')) {
      const btn = e.target.closest('.bm-more');
      openMenu(btn, itemMenu(id, isTouch() ? 'touch' : 'mouse'), { className: 'ed-ctx-menu', restoreFocus: true, label: t('bm.act.more') });
      return;
    }
    const tagBtn = e.target.closest('.bm-tag');
    if (tagBtn && !S.selectMode) { UI.setView({ kind: 'tag', tag: tagBtn.dataset.tag }); return; }
    const link = e.target.closest('a.bm-title');
    if (S.selectMode || e.target.closest('.bm-check')) { e.preventDefault(); S.focus = id; toggleSel(id); return; }
    if (e.shiftKey) { e.preventDefault(); rangeSel(id, e.ctrlKey || e.metaKey); focusRow(id, { scroll: false }); return; }
    if (link) {
      // The browser opens the link (new tab, middle / Ctrl click as usual); remember the visit.
      // Deferred with setTimeout: updating the library re-renders the list, which would replace the <a> while the
      // browser is still handling its default action.
      if (!e.ctrlKey && !e.metaKey) { const f = { visited: Date.now() }; if (S.settings.markReadOnOpen && b.unread) f.unread = false; setTimeout(() => S.lib.update(id, f), 0); }
      else S.lib.update(id, { visited: Date.now() });
      return;
    }
    if (e.ctrlKey || e.metaKey) { toggleSel(id); focusRow(id, { scroll: false }); return; }
    S.anchor = id;
    if (S.selection.size && !S.selection.has(id)) { S.selection.clear(); UI.render(); }
    focusRow(id, { scroll: false });
  });
  listEl.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.bm-item');
    if (!row || S.selectMode || e.target.closest('button, a')) return;
    openBookmark(S.lib.get(row.dataset.id));
  });
  // Middle-click opens a link without a click event; auxclick records the visit for that path too.
  listEl.addEventListener('auxclick', (e) => {
    const link = e.target.closest('a.bm-title');
    if (link && e.button === 1) { const row = link.closest('.bm-item'); if (row) S.lib.update(row.dataset.id, { visited: Date.now() }); }
  });
  // Mouse or screen-reader focus on a row also moves the roving tab stop, keeping S.focus truthful.
  listEl.addEventListener('focusin', (e) => {
    const row = e.target.closest('.bm-item');
    if (row && row.dataset.id !== S.focus) { S.focus = row.dataset.id; for (const r of $$('.bm-item[tabindex="0"]', listEl)) if (r !== row) r.tabIndex = -1; row.tabIndex = 0; }
  });

  // Keys of the list.
  listEl.addEventListener('keydown', (e) => {
    // Single-letter shortcuts must not fire while typing in a field inside the list area.
    if (e.target.closest('input, textarea, select')) return;
    const ids = (S.visible || []).map((b) => b.id);
    const i = ids.indexOf(S.focus);
    const k = e.key;
    const mod = e.ctrlKey || e.metaKey;
    const step = (d) => {
      e.preventDefault();
      const j = Math.max(0, Math.min(ids.length - 1, (i < 0 ? 0 : i + d)));
      if (e.shiftKey) { if (!S.anchor) S.anchor = S.focus; focusRow(ids[j]); rangeSel(ids[j], false); }
      else focusRow(ids[j]);
    };
    if (k === 'ArrowDown' || (k === 'j' && !mod)) step(1);
    else if (k === 'ArrowUp' || (k === 'k' && !mod)) step(-1);
    else if (k === 'PageDown') step(10);
    else if (k === 'PageUp') step(-10);
    else if (k === 'Home') { e.preventDefault(); focusRow(ids[0]); }
    else if (k === 'End') { e.preventDefault(); focusRow(ids[ids.length - 1]); }
    else if ((k === ' ' || k === 'x') && !mod && S.focus) { e.preventDefault(); toggleSel(S.focus); focusRow(S.focus, { scroll: false }); }
    else if ((k === 'Enter' || k === 'o') && !mod && S.focus) { e.preventDefault(); const list = items(targets(S.focus)); if (list.length > 1 && list.length <= 30) for (const b of list) openBookmark(b); else openBookmark(S.lib.get(S.focus)); }
    else if (k === 'e' && !mod && S.focus) { e.preventDefault(); UI.edit(S.lib.get(S.focus)); }
    // '#' = Gmail's delete key; Backspace for Mac keyboards without a Delete key.
    else if ((k === 'Delete' || k === 'Backspace' || k === '#') && !mod && S.focus) { e.preventDefault(); UI.remove(targets(S.focus)); }
    else if (k === 'f' && !mod && S.focus) { e.preventDefault(); toggleFlag(targets(S.focus), 'fav'); }
    else if ((k === 'r' || k === 'm') && !mod && S.focus) { e.preventDefault(); toggleFlag(targets(S.focus), 'unread'); }
    else if (k === 't' && !mod && S.focus) { e.preventDefault(); UI.tags(targets(S.focus)); }
    else if (k === 'v' && !mod && S.focus) { e.preventDefault(); UI.move(targets(S.focus)); }
    else if (k === 'c' && !mod && S.focus) { e.preventDefault(); copyItems(items(targets(S.focus)), 'url'); }
    else if (k === 'Escape' && (S.selection.size || S.selectMode)) { e.preventDefault(); e.stopPropagation(); clearSelection(); focusRow(S.focus, { scroll: false }); }
  });

  // Context menu of bookmarks: right click, long press, Menu key, Shift+F10.
  // Right-click on an unselected row selects-focuses it first, so the menu visibly applies to that row only.
  contextMenu(listEl, (row, info) => {
    const id = row.dataset.id;
    if (!S.selection.has(id)) {
      if (S.selection.size && !S.selectMode) { S.selection.clear(); UI.render(); }
      focusRow(id, { scroll: false });
    }
    return itemMenu(id, info.via);
  }, { selector: '.bm-item', label: (row) => row.getAttribute('aria-label') || t('bm.act.more') });

  // Drag bookmarks onto folders (and to other applications as links).
  // Three payloads: the private type for drops inside the app, text/uri-list for browsers and file managers
  // (CRLF-separated by RFC 2483), text/plain for editors. The custom ghost shows "N bookmarks" for multi-drags; it
  // must stay in the DOM until the browser snapshots it, hence removal on the next task.
  listEl.addEventListener('dragstart', (e) => {
    const row = e.target.closest && e.target.closest('.bm-item');
    if (!row) return;
    const ids = targets(row.dataset.id);
    const list = items(ids);
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
    e.dataTransfer.setData('text/uri-list', list.map((b) => b.url).join('\r\n'));
    e.dataTransfer.setData('text/plain', list.map((b) => b.url).join('\n'));
    if (list.length > 1) {
      const ghost = h('div', { class: 'bm-drag-ghost' }, t('bm.sel.count', { n: list.length }));
      document.body.append(ghost);
      e.dataTransfer.setDragImage(ghost, 12, 12);
      setTimeout(() => ghost.remove(), 0);
    }
    document.body.classList.add('bm-dragging');
  });
  listEl.addEventListener('dragend', () => document.body.classList.remove('bm-dragging'));
}

export function bindSidebar(side) {
  contextMenu(side, (target) => sideMenu(target), { selector: '[data-folder], [data-tag]' });
  side.addEventListener('dragstart', (e) => {
    const row = e.target.closest && e.target.closest('.bm-tree-row');
    if (!row) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(FOLDER_TYPE, row.dataset.folder);
  });
  bindDrops(side);
}

// Drop targets: folders (and subfolder chips), the root, Read later, Favourites, Archive, tags.
// dragover must preventDefault to mark a zone as a valid target; otherwise the browser rejects the drop.
// During dragover only `types` is readable (data is protected until drop), so the decision uses types alone.
export function bindDrops(root) {
  const zoneOf = (e) => {
    const z = e.target.closest && e.target.closest('[data-drop]');
    return z && root.contains(z) ? z : null;
  };
  const ours = (e) => [...e.dataTransfer.types].some((x) => x === DRAG_TYPE || x === FOLDER_TYPE);
  root.addEventListener('dragover', (e) => {
    const z = zoneOf(e);
    if (!z || !ours(e)) return;
    const folderDrag = [...e.dataTransfer.types].includes(FOLDER_TYPE);
    // A folder can only be dropped into another folder or the root ("all"); flags and tags do not apply to folders.
    if (folderDrag && !(z.dataset.drop === 'folder' || z.dataset.drop === 'all')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    for (const x of $$('.bm-drop-on')) if (x !== z) x.classList.remove('bm-drop-on');
    z.classList.add('bm-drop-on');
  });
  root.addEventListener('dragleave', (e) => { const z = zoneOf(e); if (z && !z.contains(e.relatedTarget)) z.classList.remove('bm-drop-on'); });
  root.addEventListener('drop', (e) => {
    const z = zoneOf(e);
    for (const x of $$('.bm-drop-on')) x.classList.remove('bm-drop-on');
    if (!z || !ours(e)) return;
    e.preventDefault();
    e.stopPropagation();
    document.body.classList.remove('bm-dragging');
    const folder = e.dataTransfer.getData(FOLDER_TYPE);
    if (folder) {
      const to = z.dataset.drop === 'folder' ? z.dataset.folder : '';
      if (to === folder) return;
      // moveFolder refuses moving a folder into its own subtree (would create a cycle).
      if (!S.lib.moveFolder(folder, to)) toast(t('bm.folder.cannotMove'), 'warn');
      else toast(t('bm.folder.moved'), 'ok');
      return;
    }
    let ids = [];
    try { ids = JSON.parse(e.dataTransfer.getData(DRAG_TYPE) || '[]'); } catch { ids = []; }
    if (!ids.length) return;
    const kind = z.dataset.drop;
    if (kind === 'folder') moveBookmarks(ids, z.dataset.folder);
    else if (kind === 'all') moveBookmarks(ids, '');
    else if (kind === 'unread') setFlag(ids, 'unread', true);
    else if (kind === 'fav') setFlag(ids, 'fav', true);
    else if (kind === 'archive') setFlag(ids, 'archived', true);
    else if (kind === 'tag') { const snap = S.lib.snapshot(ids); S.lib.addTags(ids, [z.dataset.tag]); done(t('bm.act.tagged', { n: ids.length, tag: z.dataset.tag }), snap); }
  });
}
