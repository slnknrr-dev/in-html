// kdbx-app/main.js - entry of the password vault page: shell, lock / unlock, save (download), lock with unsaved changes,
// leave-page warning, keyboard shortcuts and automatic locking after inactivity. In a Worker (the single-file page
// re-runs its own module as the key derivation Worker) only kdfWorkerMain() runs.
// 
// Lifecycle: locked (S.file only) -> unlocked (S.db) -> locked again. Locking destroys the database object (protected
// values are wiped by the library), clears the in-page entry clipboard and the system clipboard, so no secret survives
// a lock in this page's memory more than the GC allows.
import './strings.js';
import { download, startApp, t, toast } from '../ui/app.js';
import { openDialog } from '../ui/overlays.js';
import { saveKdbx } from '../kdbx/kdbx.js';
import { S } from './state.js';
import { renderLock } from './lock.js';
import { renderPanes, renderTop, renderVault, setActions, vaultKeys } from './vault.js';
import { busy } from './dialogs.js';
import { deriveKey, kdfWorkerMain } from './kdf.js';
import { clearClip } from './actions.js';
import { clearIconCache } from './iconpicker.js';

const main = typeof document !== 'undefined' ? document.getElementById('kx-main') : null;
// Inactivity limit before the vault locks itself.
const IDLE_MINUTES = 15;
// Last user activity. A key derivation may take longer than the idle limit, so opening and saving count as activity
// (otherwise the vault would lock again the moment a slow derivation finishes).
let idle = Date.now();

// Every per-database view state is reset: nothing from a previous database may leak into the next one.
function opened(db, isNew = false) {
  idle = Date.now();
  S.db = db;
  db.recycleBinName = t('kx.recycleBinName');
  S.dirty = isNew;
  S.group = db.root;
  S.entry = null;
  S.draft = null;
  S.query = '';
  S.view = 'list';
  S.sel = new Set();
  S.anchor = null;
  S.selecting = false;
  clearIconCache();
  renderVault(main);
}

function showLock() {
  document.title = t('app.name');
  renderLock(main, opened);
}

// Saving re-encrypts the whole database (fresh random seeds, full KDF run) and downloads it; the new bytes become S.file, so unlocking after a lock uses the saved version.
async function save() {
  if (!S.db) return false;
  const b = busy(t('kx.saving'));
  try {
    const bytes = await saveKdbx(S.db, { deriveKey, onProgress: ({ phase, fraction }) => b.set(fraction, t('kx.phase.' + phase, { p: Math.round(fraction * 100) })) });
    idle = Date.now();
    const name = (S.file && S.file.name) || 'Passwords.kdbx';
    S.file = { name, bytes };
    download(bytes, name, 'application/octet-stream');
    S.dirty = false;
    renderTop();
    toast(t('kx.saved', { name }), 'ok');
    return true;
  } catch (e) {
    toast(t('kx.saveFailed', { msg: e.message }), 'error');
    return false;
  } finally { b.close(); }
}

// Unsaved changes ask first: discard, save and lock, or cancel. force (auto-lock) never runs with unsaved changes, see the interval below.
async function lock(force = false) {
  if (!S.db) return;
  if (S.dirty && !force) {
    const r = await openDialog({
      title: t('kx.lockTitle'), body: t('kx.lockUnsaved'),
      buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('kx.lockDiscard'), value: 'discard', danger: true }, { label: t('kx.saveLock'), value: 'save', primary: true }],
    });
    if (!r) return;
    if (r === 'save' && !await save()) return;
    // Discarding keeps the last saved file (or nothing for a database that was never saved).
  }
  S.db.destroy();
  S.db = null;
  S.entry = S.group = S.draft = S.anchor = null;
  S.sel = new Set();
  S.selecting = false;
  clearClip(); // copied entries hold protected values
  clearIconCache();
  S.dirty = false;
  S.reveal.clear();
  try { await navigator.clipboard.writeText(''); } catch { /* not focused */ }
  if (S.file && !S.file.bytes) S.file = null;
  showLock();
}

function boot() {
  setActions({ save, lock: () => lock() });
  S.hooks.renderTop = renderTop;
  S.hooks.render = renderPanes;

  startApp({
    key: 'kdbx-vault', name: 'app.name', logo: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5zM12 15v2', offline: true,
    onLang: () => { if (S.db) renderVault(main); else showLock(); },
  });
  showLock();

  // Browsers show their own generic text; returnValue must be set for older engines.
  window.addEventListener('beforeunload', (e) => {
    if (S.db && S.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && S.db) { e.preventDefault(); save(); return; }
    vaultKeys(e);
  });

  // Inactivity lock: secrets do not stay on screen and in memory when the device is left alone (unsaved changes keep
  // the vault open, so no work is lost).
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, () => { idle = Date.now(); }, { passive: true });
  // Polled every 30 s. Skipped while a dialog is open (.ed-backdrop) and when changes are unsaved: auto-lock must never lose work.
  setInterval(() => {
    if (S.db && !S.dirty && !document.querySelector('.ed-backdrop') && Date.now() - idle > IDLE_MINUTES * 60000) {
      lock(true);
      toast(t('kx.autoLocked', { n: IDLE_MINUTES }), 'info', null, { sticky: true });
    }
  }, 30000);
}

if (typeof document !== 'undefined') boot();
else if (typeof WorkerGlobalScope !== 'undefined') kdfWorkerMain();
