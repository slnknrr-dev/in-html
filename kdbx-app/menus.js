// kdbx-app/menus.js - the context menus of the vault (ui/contextmenu.js: right click, long press by touch or pen, the Menu
// key and Shift+F10; also the "more" buttons): entries, several selected entries, the entry list background, groups, and
// the fields of the details pane. Items follow ui/overlays.js openMenu; shortcuts are shown as kbd hints (main.js /
// vault.js handle them). Item builders are pure (state in, item list out), so the same items serve menus and buttons.
import { t } from '../ui/app.js';
import { entryOtp } from '../kdbx/kdbx.js';
import { S } from './state.js';
import {
  canAddTo, changeEntryIcons, changeGroupIcon, clearSelection, clipSize, copyEntries, copyField, copyTotp, deleteEntries,
  deleteGroup, duplicateEntries, editEntry, emptyBin, entryUrl, expandAll, moveEntries, moveGroup, newEntry, newGroup,
  openUrl, pasteEntries, recycle, renameGroup, restorable, restoreEntries, selectAll, selectedEntries, startSelecting,
  visibleEntries,
} from './actions.js';

// Modifier label for hints: ⌘ on Apple platforms, Ctrl+ elsewhere (navigator.platform is deprecated but still the simplest signal).
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl+';
// Menus opened by touch put "Select" first: a long press is how touch users start a selection.
const touchy = (info) => info && (info.via === 'touch' || info.via === 'pen');
const deleteLabel = (list) => {
  const db = S.db;
  return t(!db.meta.recycleBinEnabled || list.every((e) => db.inRecycleBin(e)) ? 'kx.deleteForever' : 'kx.toBin');
};

// One entry (or, when it is part of a multiple selection, the selection).
export function entryItems(e, info) {
  if (S.sel.size > 1 && S.sel.has(e)) return bulkItems(selectedEntries(), info);
  const db = S.db;
  const has = (n) => !!db.fieldValue(e, n);
  const inBin = db.inRecycleBin(e);
  return [
    { header: true, label: e.get('Title') || t('kx.noTitle') },
    { label: t('kx.copyUser'), icon: 'user', kbd: MOD + 'B', disabled: !has('UserName'), action: () => copyField(e, 'UserName', t('kx.f.user')) },
    { label: t('kx.copyPassword'), icon: 'key', kbd: MOD + 'C', disabled: !has('Password'), action: () => copyField(e, 'Password', t('kx.f.password')) },
    { label: t('kx.copyUrl'), icon: 'link', kbd: MOD + 'U', disabled: !has('URL'), action: () => copyField(e, 'URL', t('kx.f.url')) },
    entryOtp(e) ? { label: t('kx.copyTotp'), icon: 'clock', action: () => copyTotp(e) } : null,
    { label: t('kx.openUrl'), icon: 'external', kbd: MOD + 'Shift+U', disabled: !entryUrl(e), action: () => openUrl(e) },
    { sep: true },
    { label: t('kx.edit'), icon: 'edit', kbd: MOD + 'E', action: () => editEntry(e) },
    { label: t('kx.duplicate') + '…', icon: 'duplicate', kbd: MOD + 'K', action: () => duplicateEntries([e]) },
    { label: t('kx.changeIcon') + '…', icon: 'image', action: () => changeEntryIcons([e]) },
    { label: t('kx.moveTo'), icon: 'move', action: () => moveEntries([e]) },
    inBin ? { label: t('kx.restore'), icon: 'restore', disabled: !restorable(e), action: () => restoreEntries([e]) } : null,
    { label: t('kx.copyEntry'), icon: 'copy', action: () => copyEntries([e]) },
    touchy(info) || S.selecting ? { label: t('kx.select'), icon: 'selectBox', action: () => startSelecting(e) } : null,
    { sep: true },
    { label: deleteLabel([e]), icon: 'trash', danger: true, kbd: 'Del', action: () => deleteEntries([e]) },
  ];
}

// Several selected entries.
export function bulkItems(list, info) {
  const n = list.length;
  const inBin = list.some((e) => S.db.inRecycleBin(e));
  return [
    { header: true, label: t('kx.nSelected', { n }) },
    { label: t('kx.duplicate') + '…', icon: 'duplicate', kbd: MOD + 'K', action: () => duplicateEntries(list) },
    { label: t('kx.changeIcon') + '…', icon: 'image', action: () => changeEntryIcons(list) },
    { label: t('kx.moveTo'), icon: 'move', action: () => moveEntries(list) },
    inBin ? { label: t('kx.restore'), icon: 'restore', disabled: !list.some(restorable), action: () => restoreEntries(list) } : null,
    { label: t('kx.copyEntries', { n }), icon: 'copy', action: () => copyEntries(list) },
    { sep: true },
    visibleEntries().length > n ? { label: t('kx.selectAll'), icon: 'selectAll', kbd: MOD + 'A', action: () => selectAll() } : null,
    { label: t('kx.selectNone'), icon: 'close', kbd: 'Esc', action: () => clearSelection() },
    touchy(info) && !S.selecting ? { label: t('kx.select'), icon: 'selectBox', action: () => { S.selecting = true; S.hooks.render(); } } : null,
    { sep: true },
    { label: `${deleteLabel(list)} (${n})`, icon: 'trash', danger: true, kbd: 'Del', action: () => deleteEntries(list) },
  ];
}

// The empty part of the entry list.
export function listItems(info) {
  const searching = !!S.query.trim();
  const g = S.group;
  const n = clipSize();
  const count = visibleEntries().length;
  return [
    !searching && canAddTo(g) ? { label: t('kx.newEntry'), icon: 'plus', action: () => newEntry(g) } : null,
    !searching && canAddTo(g) ? { label: n ? t('kx.pasteEntries', { n }) : t('kx.paste'), icon: 'paste', disabled: !n, action: () => pasteEntries(g) } : null,
    count ? { sep: true } : null,
    count ? { label: t('kx.selectAll'), icon: 'selectAll', kbd: MOD + 'A', action: () => selectAll() } : null,
    count && (touchy(info) || S.selecting) ? { label: S.selecting ? t('kx.selectDone') : t('kx.select'), icon: 'selectBox', action: () => (S.selecting ? clearSelection() : startSelecting(null)) } : null,
    !searching && g && g === recycle() && g.entries.length + g.groups.length ? { sep: true } : null,
    !searching && g && g === recycle() && g.entries.length + g.groups.length ? { label: t('kx.emptyBin'), icon: 'trash', danger: true, action: () => emptyBin() } : null,
  ];
}

// A group of the tree.
export function groupItems(g) {
  const bin = g === recycle(), root = !g.parent, add = canAddTo(g);
  const n = clipSize();
  return [
    { header: true, label: g.name || t('kx.root') },
    add ? { label: t('kx.newEntry'), icon: 'plus', action: () => newEntry(g) } : null,
    add ? { label: t('kx.newGroup'), icon: 'folderPlus', action: () => newGroup(g) } : null,
    add && n ? { label: t('kx.pasteEntries', { n }), icon: 'paste', action: () => pasteEntries(g) } : null,
    { sep: true },
    !bin && !root ? { label: t('kx.rename'), icon: 'edit', kbd: 'F2', action: () => renameGroup(g) } : null,
    { label: t('kx.changeIcon') + '…', icon: 'image', action: () => changeGroupIcon(g) },
    !bin && !root ? { label: t('kx.moveTo'), icon: 'move', action: () => moveGroup(g) } : null,
    g.groups.length ? { sep: true } : null,
    g.groups.length ? { label: t('kx.expandAll'), icon: 'expand', action: () => expandAll(g, true) } : null,
    g.groups.length ? { label: t('kx.collapseAll'), icon: 'collapse', action: () => expandAll(g, false) } : null,
    bin ? { sep: true } : null,
    bin ? { label: t('kx.emptyBin'), icon: 'trash', danger: true, disabled: !(g.entries.length + g.groups.length), action: () => emptyBin() } : null,
    !root ? { sep: true } : null,
    !root ? { label: t(S.db.inRecycleBin(g) || !S.db.meta.recycleBinEnabled ? 'kx.deleteForever' : 'kx.toBin'), icon: 'trash', danger: true, kbd: 'Del', action: () => deleteGroup(g) } : null,
  ];
}

// A field of the details pane: copy (references resolved), show / hide a protected value, open a URL.
export function fieldItems(e, name, label, { toggleReveal } = {}) {
  const v = S.db.fieldValue(e, name);
  const prot = e.isProtected(name);
  return [
    { header: true, label },
    { label: t('kx.copyWhat', { what: label }), icon: 'copy', disabled: !v, action: () => copyField(e, name, label) },
    prot && toggleReveal ? { label: t(S.reveal.has(name) ? 'kx.hide' : 'kx.show'), icon: S.reveal.has(name) ? 'eyeOff' : 'eye', action: toggleReveal } : null,
    name === 'URL' ? { label: t('kx.openUrl'), icon: 'external', disabled: !entryUrl(e), action: () => openUrl(e) } : null,
  ];
}
