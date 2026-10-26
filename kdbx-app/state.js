// kdbx-app/state.js - the state of the vault page (the open database, selection, editing) and small helpers shared by its
// modules: clipboard with auto-clear, file names, dates, protected-value access.
// 
// One mutable singleton S, read and written by every module; repaints go through S.hooks (set by main.js) so lower
// modules never import the view layer (no import cycles).
import { copyText, t, toast } from '../ui/app.js';
import { addIcons } from '../ui/icons.js';

export const S = {
  file: null,          // { name, bytes } of the encrypted file (kept while locked to unlock again)
  db: null,            // KdbxDatabase while unlocked
  dirty: false,
  group: null,         // selected group
  entry: null,         // selected entry
  query: '',
  draft: null,         // entry being edited ({ entry | null, group, ... })
  view: 'list',        // narrow screens: 'tree' | 'list' | 'entry'
  reveal: new Set(),   // field names shown in clear text in the details pane
  sel: new Set(),      // selected entries (several: Ctrl / Shift click, Ctrl+A, selection mode)
  anchor: null,        // entry where a Shift range starts
  selecting: false,    // selection mode (check boxes; a tap toggles)
  hooks: { render: () => {}, renderTop: () => {} },
};

// Seconds until a copied secret is cleared: long enough to paste, short enough not to linger.
export const CLIPBOARD_SECONDS = 20;

addIcons({
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  move: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 13h7M13 10l3 3-3 3',
  folderPlus: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 10v6M9 13h6',
  dice: 'M4 4h16v16H4zM8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01',
  vault: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5zM12 15v2',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  back: 'M15 6l-6 6 6 6',
  duplicate: 'M8 8h12v12H8zM4 16V5a1 1 0 0 1 1-1h11M14 11v6M11 14h6',
  selectBox: 'M4 4h16v16H4zM8 12l3 3 5-6',
  selectAll: 'M3 3h12v12H3zM9 21h12V9M6 9l2 2 4-4',
  expand: 'M7 15l5 5 5-5M7 9l5-5 5 5',
  collapse: 'M7 20l5-5 5 5M7 4l5 5 5-5',
  restore: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
});

// Locale-aware number formatting.
export const fmtNum = (n, d = 0) => new Intl.NumberFormat(document.documentElement.lang || undefined, { maximumFractionDigits: d }).format(n);

export function markDirty() {
  S.dirty = true;
  S.hooks.renderTop();
}

let clearTimer = null;
// Copies a secret and empties the clipboard after CLIPBOARD_SECONDS (if the page still may write it).
// The clear is best effort: browsers allow clipboard writes only while the page has focus, so it may fail silently.
// It also clears unconditionally — if the user copied something else meanwhile, that is wiped too (KeePassXC compares first;
// the async clipboard API cannot read without a permission prompt).
export async function copySecret(text, what) {
  await copyText(text);
  clearTimeout(clearTimer);
  clearTimer = setTimeout(async () => {
    try { await navigator.clipboard.writeText(''); toast(t('kx.clipCleared'), 'info'); } catch { /* the page lost focus; nothing to do */ }
  }, CLIPBOARD_SECONDS * 1000);
  if (what) toast(t('kx.copiedClear', { what, s: CLIPBOARD_SECONDS }), 'ok');
}

export const fmtDate = (d) => (d instanceof Date && !isNaN(d) ? d.toLocaleString(document.documentElement.lang || undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

export function fmtSize(n) {
  if (n < 1024) return t('kx.bytes', { n });
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KiB';
  return (n / 1048576).toFixed(1) + ' MiB';
}

// Path of a group from the root ("Email / Work").
export function groupPath(g) {
  const parts = [];
  for (let x = g; x && x.parent; x = x.parent) parts.unshift(x.name);
  return parts.join(' / ');
}

// Groups in tree order with their depth (move dialogs, selects).
// skip excludes a group and its whole subtree (moving a group into itself is impossible from this list).
export function flatGroups(db, skip = null) {
  const out = [];
  const walk = (g, depth) => {
    if (g === skip) return;
    out.push({ g, depth });
    for (const c of g.groups) walk(c, depth + 1);
  };
  walk(db.root, 0);
  return out;
}

// Expiry only counts when the KeePass "expires" flag is set; the expiry time alone is ignored.
export const isExpired = (e) => e.times.expires && e.times.expiry < new Date();
