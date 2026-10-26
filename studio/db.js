// studio/db.js - project storage: IndexedDB (documents, attachment files), autosave, one writer per project across
// tabs (locks, BroadcastChannel), read-only banner, storage quota checks.
//
// Storage layout (database '<prefix>-editor', version 1):
//   projects  keyPath id      -> { id, name, modified, doc } (doc WITHOUT attachment bytes)
//   files     key '<pid>:<attId>' -> base64 data (one record per attachment, so a text edit never rewrites media)
//   kv        free keys        -> lastProject, 'handle:<pid>' (File System Access handles are structured-cloneable)
// Prefix keys + key ranges give per-project scans and deletes without a secondary index.
// Invariants:
// - Saves are serialised through one promise chain (saving); nothing overlaps a save.
// - Record and files are written in ONE transaction: a crash never leaves a record pointing at missing data.
// - Optimistic concurrency: a save only applies if the stored modified equals what this tab loaded (S.baseModified);
//   otherwise the user decides (saveConflict). Locks prevent most conflicts; this check catches the rest
//   (different browser profiles never conflict: they do not share storage at all).
import { uid } from '../util/id.js';
import { $, appendKids, clone, debounce, h, nowISO } from '../ui/dom.js';
import { fmtDate } from '../ui/lang.js';
import { iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { confirmDialog, openDialog, toast } from '../ui/overlays.js';
import { BIG_FILE, S } from './state.js';
import { fullDoc } from './doc.js';
import { flushRT } from './history.js';
import { renderStatus } from './shell.js';
import { openProject, startProject } from './projects.js';
import { saveFile } from './fileio.js';
import { P } from '../doc/product.js';

// ===========================================================================
// 7. IndexedDB (projects, files, kv) + autosave
// ===========================================================================

const DB = (() => {
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB unavailable')); return; }
      let rq;
      try { rq = indexedDB.open(P.prefix + '-editor', 1); } catch (e) { reject(e); return; }
      rq.onupgradeneeded = () => {
        const db = rq.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error || new Error('IndexedDB error'));
      // blocked = another tab holds an older version open; fail into memory mode rather than hang boot forever.
      rq.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
    // A failed open is not cached: the next call retries (e.g. after the user freed storage).
    dbp.catch(() => { dbp = null; });
    return dbp;
  }
  async function run(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const r = fn(tx.objectStore(store));
      // Resolve on transaction complete, not request success: only then is the write durable.
      tx.oncomplete = () => resolve(r && typeof r === 'object' && 'result' in r ? r.result : r);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('aborted'));
    });
  }
  // One transaction over several stores: fn(tx, out) issues requests; resolves with out.value on commit.
  async function txn(stores, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      const out = { value: undefined };
      tx.oncomplete = () => resolve(out.value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('aborted'));
      try { fn(tx, out); } catch (e) { try { tx.abort(); } catch { /* already finished */ } reject(e); }
    });
  }
  // All string keys starting with prefix: upper bound prefix + U+FFFF (highest BMP code unit; ids are ASCII).
  const range = (prefix) => IDBKeyRange.bound(prefix, prefix + '￿');
  // Write a project record and its files atomically. ids: Set of attachment ids the doc references;
  // data: Map(attId → base64). Referenced files missing from the store are (re-)written and unreferenced
  // ones removed, so the stored record never points at missing data. o.base: when a string, the write only
  // happens if the stored record's `modified` still equals it (else → {conflict}). o.rewrite: put every file.
  function saveDoc(rec, ids, data, o = {}) {
    return txn(['projects', 'files'], 'readwrite', (tx, out) => {
      const ps = tx.objectStore('projects');
      const fs = tx.objectStore('files');
      const prefix = rec.id + ':';
      out.value = { conflict: null, written: 0, removed: 0, missing: [] };
      const write = () => {
        ps.put(rec);
        const kq = fs.getAllKeys(range(prefix));
        kq.onsuccess = () => {
          const have = new Set((kq.result || []).map((k) => String(k).slice(prefix.length)));
          for (const id of ids) {
            if (!o.rewrite && have.has(id)) continue;
            if (data.has(id)) { fs.put(data.get(id), prefix + id); out.value.written++; }
            else if (!have.has(id)) out.value.missing.push(id);
          }
          for (const id of have) if (!ids.has(id)) { fs.delete(prefix + id); out.value.removed++; }
        };
      };
      if (typeof o.base !== 'string') { write(); return; }
      const g = ps.get(rec.id);
      g.onsuccess = () => {
        const cur = g.result;
        if (cur && cur.modified !== o.base) out.value.conflict = { modified: cur.modified, name: cur.name };
        else write();
      };
    });
  }
  return {
    open, txn, saveDoc,
    get: (s, k) => run(s, 'readonly', (st) => st.get(k)),
    put: (s, v, k) => run(s, 'readwrite', (st) => (k === undefined ? st.put(v) : st.put(v, k))),
    del: (s, k) => run(s, 'readwrite', (st) => st.delete(k)),
    all: (s) => run(s, 'readonly', (st) => st.getAll()),
    delPrefix: (s, prefix) => run(s, 'readwrite', (st) => st.delete(range(prefix))),
    // Map(suffix → value) of keys starting with prefix
    getPrefix: (s, prefix) => run(s, 'readonly', (st) => {
      const out = new Map();
      const rq = st.openCursor(range(prefix));
      rq.onsuccess = () => {
        const c = rq.result;
        if (c) { out.set(String(c.key).slice(prefix.length), c.value); c.continue(); }
      };
      return out;
    }),
    countPrefix: (s, prefix) => run(s, 'readonly', (st) => st.count(range(prefix))),
  };
})();

// 800 ms after the last change: long enough to batch a typing burst into one write, short enough that a crash
// loses under a second of work. pagehide / visibilitychange flush it early (global.js).
const autosave = debounce(() => { saveProject().catch(() => {}); }, 800);

function markDirty() {
  S.gen++;
  if (!S.idb) { S.saveState = 'memory'; renderStatus(); return; }
  if (S.readOnly) { S.saveState = 'readonly'; renderStatus(); return; }
  S.saveState = 'unsaved';
  renderStatus();
  autosave();
}

// Saves are serialized: each one starts after the previous one finished (project switches, deletes and
// imports await `saving` before touching the stores). Resolves true when the document was stored.
let saving = Promise.resolve(true);
// then(run, run): the next save runs whether the previous one succeeded or failed; saving itself never rejects,
// so the chain cannot get stuck on one failure. Callers still get the real result via p.
function saveProject(opts = {}) {
  const run = () => doSave(opts);
  const p = saving.then(run, run);
  saving = p.catch(() => false);
  return p;
}

async function doSave(opts = {}) {
  if (!S.idb || !S.doc) return !!S.idb;
  if (S.readOnly) { S.saveState = 'readonly'; renderStatus(); return false; }
  autosave.cancel();
  // Everything this save needs is captured now: the doc may be switched while it awaits.
  const gen = S.gen;
  const doc = S.doc;
  const pid = doc.id;
  const data = S.attData;
  const ids = new Set(Object.keys(doc.attachments || {}));
  // clone(): the record must be a snapshot; IndexedDB clones at put time, but put happens after an await.
  const rec = { id: pid, name: doc.name || t('pj.untitled'), modified: doc.meta?.modified || nowISO(), doc: clone(doc) };
  const isCur = () => !!S.doc && S.doc.id === pid;
  S.saveState = 'saving';
  renderStatus();
  try {
    const r = await DB.saveDoc(rec, ids, data, { base: opts.force ? undefined : S.baseModified, rewrite: !!opts.rewrite });
    if (r.conflict) return await saveConflict(r.conflict, pid);
    if (r.missing.length) console.warn('attachment data missing for', r.missing);
    if (isCur()) {
      S.baseModified = rec.modified;
      try { await DB.put('kv', pid, 'lastProject'); } catch { /* not critical */ }
    }
    peerPost({ t: 'saved', id: pid, modified: rec.modified });
    // Edits made during the save bumped S.gen: then the state stays unsaved (autosave is already re-armed).
    if (isCur()) S.saveState = S.readOnly ? 'readonly' : S.gen === gen ? 'saved' : 'unsaved';
    if (saveErrFor === pid) saveErrFor = null;
    renderStatus();
    return true;
  } catch (e) {
    console.error(e);
    if (isCur()) S.saveState = 'error';
    // One message per failure streak of a project (autosave retries after every edit), with a way out.
    if (saveErrFor !== pid) {
      saveErrFor = pid;
      const msg = isQuotaError(e) ? t('io.quota') : t('io.saveErr', { msg: e.message || e });
      toast(msg, 'error', isCur() ? { label: t('io.saveToFile'), fn: () => saveFile(false) } : null, { sticky: isQuotaError(e) });
    }
    renderStatus();
    return false;
  }
}
let saveErrFor = null; // project id whose saves currently fail (its error was already reported)
// Quota error names differ by engine (code 22 = legacy DOMException code, Firefox NS_ERROR name).
const isQuotaError = (e) => !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22);

// Before keeping large files in IndexedDB: ask once for persistent storage and warn when they will not fit.
let persistAsked = false;
async function checkStorageRoom(bytes) {
  const st = navigator.storage;
  if (!S.idb || !st) return true;
  if (!persistAsked && st.persist && bytes > BIG_FILE) {
    persistAsked = true;
    try { if (!(await st.persisted?.())) await st.persist(); } catch { /* not granted: best effort */ }
  }
  if (!st.estimate) return true;
  try {
    const { usage = 0, quota = 0 } = await st.estimate();
    // Stored as base64 (+⅓) next to the project record; keep some headroom.
    return !quota || usage + bytes * 1.4 < quota * 0.95;
  } catch { return true; }
}

// The stored record changed since this tab loaded it (another tab / window saved it): ask, never overwrite silently.
async function saveConflict(c, pid) {
  autosave.cancel();
  if (!S.doc || S.doc.id !== pid) return false;
  S.saveState = 'unsaved';
  renderStatus();
  const v = await openDialog({
    title: t('cf.title'),
    body: t('cf.text', { name: S.doc.name || t('pj.untitled'), time: fmtDate(c.modified) }),
    buttons: [
      { label: t('cf.reload'), value: 'reload' },
      { label: t('cf.keepBoth'), value: 'both' },
      { label: t('cf.overwrite'), value: 'overwrite', primary: true, danger: true },
    ],
  });
  if (!S.doc || S.doc.id !== pid) return false;
  if (v === 'overwrite') return doSave({ force: true });
  setReadOnly('stale');
  // These wait for the save queue, so they run outside of it.
  if (v === 'reload') setTimeout(() => { openProject(pid, { force: true }); }, 0);
  else if (v === 'both') setTimeout(() => { forkCurrent(); }, 0);
  return false;
}

// Resolves true when the current document is stored in IndexedDB (nothing pending, last save OK).
async function flushSave() {
  if (!S.idb) return false;
  if (S.doc && !S.readOnly && (autosave.pending() || S.saveState === 'unsaved')) return saveProject();
  await saving;
  return !S.doc || S.saveState === 'saved';
}

// Before replacing the current document: never lose work silently. Resolves false to abort.
async function guardUnsaved() {
  if (!S.doc) return true;
  flushRT();
  const stored = await flushSave();
  if (stored || !S.hist.undo.length) return true;
  const why = !S.idb ? 'gu.memory' : S.readOnly ? 'gu.readonly' : 'gu.error';
  const v = await openDialog({
    title: t('gu.title'), body: t(why),
    buttons: [
      { label: t('dlg.cancel'), value: null },
      { label: t('gu.discard'), value: 'discard', danger: true },
      { label: t('gu.save'), value: 'save', primary: true, icon: 'save' },
    ],
  });
  if (v === 'discard') return true;
  if (v === 'save') return (await saveFile(false)) === true;
  return false;
}

// ---------------------------------------------------------------------------
// Several editor tabs: one writer per project (Web Locks; BroadcastChannel probe as fallback).
// Other tabs open the project read-only; saves are announced so stale tabs stop autosaving.
// ---------------------------------------------------------------------------

// Random per-tab id so a tab ignores its own BroadcastChannel echoes and peers can tell tabs apart.
const TAB_ID = uid() + uid();
const lockName = (id) => P.prefix + '-project:' + id;
const peerWaiters = new Set();
// Channel to the editor's other tabs (opened on first use: its name carries the product prefix).
let peerChannel;
function peerBC() {
  if (peerChannel === undefined) {
    try { peerChannel = 'BroadcastChannel' in window ? new BroadcastChannel(P.prefix + '-editor') : null; } catch { peerChannel = null; }
    if (peerChannel) peerChannel.onmessage = (e) => onPeerMessage(e.data);
  }
  return peerChannel;
}
function peerPost(msg) { try { peerBC()?.postMessage({ ...msg, tab: TAB_ID }); } catch { /* channel closed */ } }

const hasLocks = () => !!(navigator.locks && typeof navigator.locks.request === 'function');
// Web Locks hold a lock while the callback's promise is pending: lock.release resolves that promise.
// seq is a generation counter: an async claim that finishes after a newer claim/release started gives its lock back.
const lock = { id: null, owned: false, release: null, seq: 0 };

function releaseProject() {
  const rel = lock.release;
  lock.seq++;
  lock.id = null; lock.owned = false; lock.release = null;
  if (rel) { try { rel(); } catch { /* ignore */ } }
}

// Fallback without Web Locks: ask the other tabs whether one of them writes this project.
// Probe: broadcast 'claim', the writer answers 'busy'. Silence for 250 ms = nobody. Racy by nature (two tabs
// claiming at once both see silence), which is why Web Locks are preferred and the save-time modified check exists.
function peerHolds(id, ms = 250) {
  if (!peerBC()) return Promise.resolve(false);
  return new Promise((resolve) => {
    let tm = 0;
    const w = (m) => { if (m.t === 'busy' && m.id === id) done(true); };
    const done = (v) => { peerWaiters.delete(w); clearTimeout(tm); resolve(v); };
    peerWaiters.add(w);
    tm = setTimeout(() => done(false), ms);
    peerPost({ t: 'claim', id });
  });
}

// Is project `id` being edited (written) by another tab? (Not meaningful for the current project.)
async function lockedElsewhere(id) {
  if (hasLocks() && typeof navigator.locks.query === 'function') {
    try { const q = await navigator.locks.query(); return (q.held || []).some((l) => l.name === lockName(id)); } catch { /* fall through */ }
  }
  return peerHolds(id);
}

// Become the writer of project `id` (held until the next claim). steal: take it over from another tab.
// ifAvailable: never queue behind another tab (a queued request would silently become writer later); steal:
// the other tab's lock request rejects with AbortError and that tab turns read-only ('lost').
async function claimProject(id, steal = false) {
  releaseProject();
  const seq = lock.seq;
  lock.id = id;
  let owned = false;
  if (hasLocks()) {
    owned = await new Promise((resolve) => {
      navigator.locks.request(lockName(id), steal ? { steal: true } : { ifAvailable: true }, (l) => {
        if (!l) { resolve(false); return null; }
        return new Promise((rel) => {
          if (lock.seq === seq) lock.release = rel; else rel();
          resolve(true);
        });
      }).catch(() => {
        // AbortError: another tab took the lock over.
        resolve(false);
        if (lock.seq === seq && lock.owned) lockLost(id);
      });
    });
  } else {
    owned = steal || !(await peerHolds(id));
  }
  if (lock.seq !== seq) return false; // superseded by another claim
  lock.owned = owned;
  if (steal) peerPost({ t: 'takeover', id });
  return owned;
}

function lockLost(id) {
  if (lock.id === id) { lock.owned = false; lock.release = null; }
  if (S.doc && S.doc.id === id) setReadOnly('lost');
}

// After loadDoc(): claim the project; when another tab writes it, this tab is read-only.
async function enterProject(id) {
  if (!S.idb) return true;
  const owned = await claimProject(id);
  if (S.doc && S.doc.id === id && !owned && lock.id === id) setReadOnly('locked');
  return owned;
}

function onPeerMessage(m) {
  if (!m || typeof m !== 'object' || m.tab === TAB_ID || typeof m.id !== 'string') return;
  for (const w of [...peerWaiters]) w(m);
  const cur = !!S.doc && S.doc.id === m.id;
  switch (m.t) {
    case 'claim':
      if (lock.id === m.id && lock.owned) peerPost({ t: 'busy', id: m.id });
      break;
    case 'saved':
      if (cur && m.modified !== S.baseModified && S.readOnly !== 'lost' && S.readOnly !== 'deleted') setReadOnly('stale');
      break;
    case 'takeover':
      if (lock.id === m.id) lockLost(m.id);
      else if (cur) setReadOnly('lost');
      break;
    case 'deleted':
      if (cur) setReadOnly('deleted');
      break;
    default: break;
  }
}

function setReadOnly(kind) {
  if (S.readOnly === (kind || null)) return;
  S.readOnly = kind || null;
  if (S.readOnly) { autosave.cancel(); S.saveState = 'readonly'; }
  renderBanner();
  renderStatus();
}

// Non-blocking notice above the page while this tab cannot save.
function renderBanner() {
  const el = $('#ed-banner');
  if (!el) return;
  el.textContent = '';
  const k = S.doc ? S.readOnly : null;
  el.hidden = !k;
  if (!k) return;
  const msg = { locked: 'bn.locked', stale: 'bn.changed', lost: 'bn.lost', deleted: 'bn.deleted' }[k] || 'bn.changed';
  const btn = (label, fn, primary) => h('button', { type: 'button', class: 'ed-btn ed-sm' + (primary ? ' ed-primary' : ''), onclick: fn }, label);
  appendKids(el, [
    iconEl('warn'),
    h('span', { class: 'ed-banner-msg' }, t(msg)),
    k === 'locked' ? btn(t('bn.takeOver'), () => takeOverProject()) : null,
    k === 'stale' || k === 'lost' ? btn(t('bn.reload'), () => reloadProject(), true) : null,
    btn(t('bn.copy'), () => forkCurrent(), k === 'locked' || k === 'deleted')]);
}

async function reloadProject() {
  if (!S.doc) return;
  if (S.hist.undo.length && !(await confirmDialog(t('bn.reload'), t('bn.reloadQ'), t('bn.reload'), true))) return;
  await openProject(S.doc.id, { force: true });
}

async function takeOverProject() {
  if (!S.doc) return;
  if (S.hist.undo.length && !(await confirmDialog(t('bn.takeOver'), t('bn.takeOverQ'), t('bn.takeOver'), true))) return;
  await openProject(S.doc.id, { force: true, steal: true });
}

// Keep this tab's version (including edits that were not saved) as a new project.
async function forkCurrent() {
  if (!S.doc) return false;
  flushRT();
  const d = fullDoc();
  d.id = uid();
  d.name = (S.doc.name || t('pj.untitled')) + t('pj.copySuffix');
  if (!d.meta) d.meta = {};
  d.meta.created = d.meta.modified = nowISO();
  const ok = await startProject(d, { lang: S.lang, noGuard: true });
  if (ok) toast(t('bn.copied', { name: d.name }), 'ok');
  return ok;
}

export {
  DB,
  autosave,
  checkStorageRoom,
  claimProject,
  enterProject,
  flushSave,
  guardUnsaved,
  lockedElsewhere,
  markDirty,
  peerPost,
  releaseProject,
  renderBanner,
  saveProject,
  saving,
  setReadOnly
};
