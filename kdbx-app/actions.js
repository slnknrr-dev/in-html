// kdbx-app/actions.js - what the vault does with entries and groups, shared by the panes, the context menus, the toolbar
// and the keyboard: the selection (one entry, Ctrl / Shift ranges, all, the selection mode of touch screens), copying
// fields and one-time codes, opening URLs, new / edit / duplicate / move / change icon / delete / restore for one or
// several entries, copying and pasting entries (inside this page until the vault locks), and the group operations.
// Changes re-render through S.hooks.render.
// 
// Every mutation calls markDirty(): the dirty flag drives the save button, the title bullet, the leave-page warning and
// blocks auto-lock.
import { t, toast } from '../ui/app.js';
import { h } from '../ui/dom.js';
import { confirmDialog, promptDialog } from '../ui/overlays.js';
import { ProtectedValue, entryOtp, otpCode } from '../kdbx/kdbx.js';
import { S, copySecret, markDirty } from './state.js';
import { duplicateDialog, moveDialog } from './dialogs.js';
import { applyIcon, iconDialog } from './iconpicker.js';
import { makeDraft } from './editor.js';

const render = () => S.hooks.render();
export const recycle = () => S.db.recycleBin(false);
// Groups that take new entries and groups (not the recycle bin or anything in it).
export const canAddTo = (g) => !!g && g !== recycle() && !S.db.inRecycleBin(g);
const title = (e) => e.get('Title') || t('kx.noTitle');

// --- the list and the selection ------------------------------------------------------------------------------------

// Natural, case-insensitive title order (numeric: "Server 2" before "Server 10").
export const entriesOf = (g) => [...g.entries].sort((a, b) => a.get('Title').localeCompare(b.get('Title'), undefined, { numeric: true, sensitivity: 'base' }));
// The entries of the list in display order (selection ranges and "select all" follow it).
export const visibleEntries = () => (S.query.trim() ? S.db.search(S.query) : S.group ? entriesOf(S.group) : []);
// The selected entries in list order; without a selection, the current entry.
export function selectedEntries() {
  const list = visibleEntries().filter((e) => S.sel.has(e));
  return list.length ? list : S.entry && S.entry.parent ? [S.entry] : [];
}

const resetEntry = () => { S.draft = null; S.reveal.clear(); };

// One entry (open: on narrow screens the details pane comes up).
export function selectOnly(e, { open = true } = {}) {
  S.entry = e;
  S.sel = new Set(e ? [e] : []);
  S.anchor = e;
  resetEntry();
  if (e && open) S.view = 'entry';
  render();
}

export function toggleSelect(e) {
  const sel = new Set(S.sel.size ? S.sel : S.entry ? [S.entry] : []);
  if (sel.has(e)) sel.delete(e); else sel.add(e);
  S.sel = sel;
  S.anchor = e;
  S.entry = sel.has(e) ? e : [...sel].pop() || null;
  resetEntry();
  render();
}

export function selectRange(e) {
  const list = visibleEntries();
  const a = list.indexOf(S.anchor), b = list.indexOf(e);
  if (a < 0 || b < 0) { selectOnly(e, { open: false }); return; }
  S.sel = new Set(list.slice(Math.min(a, b), Math.max(a, b) + 1));
  S.entry = e;
  resetEntry();
  render();
}

export function selectAll() {
  const list = visibleEntries();
  if (!list.length) return;
  S.sel = new Set(list);
  if (!S.entry || !S.sel.has(S.entry)) S.entry = list[0];
  S.anchor = S.anchor && S.sel.has(S.anchor) ? S.anchor : list[0];
  resetEntry();
  render();
}

export function clearSelection() {
  S.selecting = false;
  S.sel = new Set(S.entry ? [S.entry] : []);
  render();
}

// The selection mode of touch screens: check boxes, a tap toggles; starts with the pressed entry.
export function startSelecting(e) {
  S.selecting = true;
  S.sel = new Set(e ? [e] : []);
  if (e) { S.entry = e; S.anchor = e; }
  S.view = 'list';
  resetEntry();
  render();
}

// open: on narrow screens the entry list comes up (keyboard moves in the tree keep the tree).
export function selectGroup(g, { open = true } = {}) {
  if (!g) return;
  S.group = g;
  S.query = '';
  const s = document.getElementById('kx-search');
  if (s) s.value = '';
  S.entry = null;
  S.sel = new Set();
  S.anchor = null;
  S.selecting = false;
  resetEntry();
  if (open) S.view = 'list';
  render();
}

// --- fields --------------------------------------------------------------------------------------------------------

// Copies a field with its references resolved.
export function copyField(e, name, label) {
  const v = S.db.fieldValue(e, name);
  if (v) copySecret(v, label);
}

export function copyTotp(e) {
  const otp = entryOtp(e);
  if (otp) copySecret(otpCode(otp, Date.now()).code, t('kx.totp'));
}

// The URL of an entry that can be opened: http(s), ftp and mailto, or a host name (https:// is added); other schemes
// (javascript:, data:, file:, cmd://) are refused.
// Scheme whitelist: http(s), ftp, mailto; a bare host name gets https://. javascript:, data:, file: and anything else
// are refused — a URL field is attacker-controllable data (imported databases).
export function entryUrl(e) {
  const u = S.db.fieldValue(e, 'URL').trim();
  if (!u) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return /^(https?|ftp):\/\/[^\s]+$|^mailto:[^\s]+$/i.test(u) ? u : null;
  return /^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+(:\d+)?([/?#][^\s]*)?$/u.test(u) ? 'https://' + u : null;
}

// Opens the URL in a new tab (a navigation the user asked for; the page itself sends nothing).
// rel=noopener noreferrer: the opened page gets no window.opener handle and no Referer pointing at this vault.
export function openUrl(e) {
  const u = entryUrl(e);
  if (!u) { toast(t('kx.urlCannot'), 'warn'); return; }
  const a = h('a', { href: u, target: '_blank', rel: 'noopener noreferrer', style: { display: 'none' } });
  document.body.append(a);
  a.click();
  a.remove();
}

// --- entries -------------------------------------------------------------------------------------------------------------

export function newEntry(group = S.group) {
  const g = canAddTo(group) ? group : S.db.root;
  S.group = g;
  S.query = '';
  const s = document.getElementById('kx-search');
  if (s) s.value = '';
  S.selecting = false;
  S.sel = new Set();
  S.draft = makeDraft(null, g);
  S.view = 'entry';
  render();
  setTimeout(() => document.getElementById('kx-ed-title')?.focus(), 30);
}

export function editEntry(e) {
  if (!e || !e.parent) return;
  S.entry = e;
  S.sel = new Set([e]);
  S.selecting = false;
  S.draft = makeDraft(e, e.parent);
  S.view = 'entry';
  render();
  setTimeout(() => document.getElementById('kx-ed-title')?.focus(), 30);
}

export async function deleteEntries(list = selectedEntries()) {
  if (!list.length) return;
  const db = S.db;
  const forever = !db.meta.recycleBinEnabled || list.every((e) => db.inRecycleBin(e));
  const mixed = !forever && list.some((e) => db.inRecycleBin(e));
  const text = list.length === 1
    ? t(forever || db.inRecycleBin(list[0]) ? 'kx.deleteEntryText' : 'kx.binEntryText', { name: title(list[0]) })
    : t(forever ? 'kx.deleteEntriesText' : 'kx.binEntriesText', { n: list.length }) + (mixed ? ' ' + t('kx.mixedBinText') : '');
  if (!await confirmDialog(t(forever ? 'kx.deleteForever' : 'kx.toBin'), text, t('dlg.delete'), true)) return;
  for (const e of list) if (e.parent) db.remove(e);
  S.entry = null;
  S.sel = new Set();
  S.anchor = null;
  S.view = 'list';
  markDirty();
  toast(t(forever ? 'kx.deletedN' : 'kx.binnedN', { n: list.length }), 'ok');
  render();
}

export async function moveEntries(list = selectedEntries()) {
  if (list.length && await moveDialog(list)) render();
}

export async function changeEntryIcons(list = selectedEntries()) {
  if (!list.length) return;
  const c = await iconDialog({ kind: 'entry', icon: list[0].icon, customIcon: list[0].customIcon, title: list.length > 1 ? t('kx.icon.titleN', { n: list.length }) : '' });
  if (!c) return;
  for (const e of list) applyIcon(e, c);
  render();
}

export async function duplicateEntries(list = selectedEntries()) {
  if (!list.length) return;
  const copies = await duplicateDialog(list);
  if (!copies) return;
  S.sel = new Set(copies);
  S.entry = copies[copies.length - 1];
  S.anchor = S.entry;
  S.draft = null;
  toast(t('kx.duplicatedN', { n: copies.length }), 'ok');
  render();
}

// Recycled entries go back to the group they were deleted from (PreviousParentGroup), when it still exists.
export const restorable = (e) => {
  const db = S.db, g = e.previousParentGroup && db.inRecycleBin(e) ? db.getGroup(e.previousParentGroup) : null;
  return g && !db.inRecycleBin(g) ? g : null;
};
export function restoreEntries(list = selectedEntries()) {
  let n = 0;
  for (const e of list) { const g = restorable(e); if (g) { S.db.move(e, g); n++; } }
  if (!n) { toast(t('kx.cannotRestore'), 'warn'); return; }
  markDirty();
  toast(t('kx.restoredN', { n }), 'ok');
  S.sel = new Set();
  S.entry = null;
  render();
}

// --- copy and paste entries (this page only) ---------------------------------------------------------------------------

// Deep copies (history included) and the custom icons they show, so they can be pasted into this or another database.
const clip = { entries: [], icons: new Map() };
export const clipSize = () => clip.entries.length;

// Protected values of copied entries are destroyed explicitly (the library wipes their bytes) instead of waiting for GC.
export function clearClip() {
  for (const e of clip.entries) for (const x of [e, ...e.history]) for (const v of x.fields.values()) if (v instanceof ProtectedValue) v.destroy();
  clip.entries = [];
  clip.icons.clear();
}

// Deep clones with history, plus the custom icons they reference, so a paste into another database keeps the icons.
export function copyEntries(list = selectedEntries()) {
  if (!list.length) return;
  clearClip();
  for (const e of list) {
    const c = e.clone({ history: true });
    for (const x of [c, ...c.history]) {
      const ic = x.customIcon && S.db.meta.customIcons.get(x.customIcon);
      if (ic && !clip.icons.has(x.customIcon)) clip.icons.set(x.customIcon, { data: ic.data.slice(), name: ic.name });
    }
    clip.entries.push(c);
  }
  toast(t('kx.copiedEntries', { n: list.length }), 'ok');
}

// Custom icons missing in the target database are added from the clip; a paste into the recycle bin goes to the root instead.
export function pasteEntries(group = S.group) {
  if (!clip.entries.length) return;
  const db = S.db, g = canAddTo(group) ? group : db.root;
  const out = [];
  for (const src of clip.entries) {
    const c = src.clone({ history: true });
    for (const x of [c, ...c.history]) {
      if (x.customIcon && !db.meta.customIcons.has(x.customIcon)) {
        const ic = clip.icons.get(x.customIcon);
        x.customIcon = ic ? db.addCustomIcon(ic.data.slice(), ic.name) : null;
      }
    }
    c.parent = g;
    g.entries.push(c);
    out.push(c);
  }
  S.group = g;
  S.query = '';
  S.sel = new Set(out);
  S.entry = out[out.length - 1];
  S.anchor = S.entry;
  S.draft = null;
  markDirty();
  toast(t('kx.pastedN', { n: out.length }), 'ok');
  render();
}

// --- groups ----------------------------------------------------------------------------------------------------------------

export async function newGroup(parent = S.group) {
  const p = canAddTo(parent) ? parent : S.db.root;
  const name = await promptDialog(t('kx.newGroup'), t('kx.groupName'), '');
  if (!name) return;
  const g = S.db.createGroup(p, name);
  p.isExpanded = true;
  markDirty();
  selectGroup(g);
}

export async function renameGroup(g) {
  if (!g.parent || g === recycle()) return;
  const name = await promptDialog(t('kx.rename'), t('kx.groupName'), g.name);
  if (!name || name === g.name) return;
  g.name = name;
  g.times.touch();
  markDirty();
  render();
}

export async function moveGroup(g) {
  if (g.parent && g !== recycle() && await moveDialog(g)) render();
}

export async function changeGroupIcon(g) {
  const c = await iconDialog({ kind: 'group', icon: g.icon, customIcon: g.customIcon, title: t('kx.icon.titleGroup', { name: g.name || t('kx.root') }) });
  if (!c) return;
  applyIcon(g, c);
  render();
}

export async function deleteGroup(g) {
  if (!g.parent) return;
  const db = S.db;
  const forever = db.inRecycleBin(g) || !db.meta.recycleBinEnabled;
  if (!await confirmDialog(t(forever ? 'kx.deleteForever' : 'kx.toBin'), t(forever ? 'kx.deleteGroupText' : 'kx.binGroupText', { name: g.name }), t('dlg.delete'), true)) return;
  const parent = g.parent;
  db.remove(g);
  S.group = forever ? parent : g;
  S.entry = null;
  S.sel = new Set();
  markDirty();
  render();
}

export async function emptyBin() {
  if (!recycle()) return;
  if (!await confirmDialog(t('kx.emptyBin'), t('kx.emptyBinText'), t('dlg.delete'), true)) return;
  S.db.emptyRecycleBin();
  S.entry = null;
  S.sel = new Set();
  markDirty();
  render();
}

// Expands or collapses a group and everything below it.
export function expandAll(g, on) {
  for (const x of g.allGroups()) if (x.groups.length) x.isExpanded = on;
  render();
}
