// bookmarks-editor/db.js - where the page keeps the library: IndexedDB (records merged in place, so several tabs and
// the sync loop never overwrite each other), else localStorage (one JSON value), else memory only (the page warns).
// Records carry a dirty flag: changed here and not yet confirmed by the server.
//
//   const store = await openStore(name)   store.kind: 'indexeddb' | 'localstorage' | 'memory'; store.error: why not IndexedDB
//   await store.load() -> [records]                       await store.put(records, { dirty })
//   await store.dirty() -> [records]                      await store.clean(records)   (sent and confirmed)
//   await store.getMeta(key) / setMeta(key, value)        await store.clear()
//   store.onOtherTab((records) => …)                      changes written by another tab of this page
//
// Why merge on write instead of overwrite: two tabs and the sync loop can all write the same record. put() reads the
// stored version and merges field by field (record.js decides by per-field timestamps) inside one readwrite
// transaction, so the later write never erases a newer field written by someone else. A plain put() would be
// last-writer-wins on the whole record.
import { cloneRecord, mergeRecord } from '../bookmarks/record.js';

// Structural equality via JSON: records are plain data (no Dates, no cycles). Key order matters to stringify, so a
// re-ordered but equal record compares unequal; the cost is one redundant re-send, never data loss.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// BroadcastChannel tells other tabs of the same origin which ids changed; they re-read those ids from IndexedDB
// (the message carries ids only, so the database stays the single source of truth).
function channel(name) {
  try { return typeof BroadcastChannel === 'function' ? new BroadcastChannel('in-html-bookmarks:' + name) : null; } catch { return null; }
}

// IDBRequest -> Promise. The raw API is event-based; wrapping keeps the code linear.
function req2p(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

async function idbStore(name) {
  if (typeof indexedDB === 'undefined' || !indexedDB) throw new Error('IndexedDB is not available');
  const db = await new Promise((resolve, reject) => {
    let r;
    try { r = indexedDB.open(name, 1); } catch (e) { reject(e); return; }
    // Schema v1: records keyed by id, meta keyed by k. A future schema change bumps the version passed to open().
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('records')) d.createObjectStore('records', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'k' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('IndexedDB refused to open'));
    // onblocked fires when another tab holds an older version open. setTimeout: some engines (private modes,
    // locked-down profiles) never answer at all; after 8 s the page falls back to localStorage instead of hanging.
    // A late reject after resolve is a no-op on a settled promise, so the timer needs no clearing.
    r.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
    setTimeout(() => reject(new Error('IndexedDB did not answer')), 8000);
  });
  const bc = channel(name);
  const listeners = new Set();
  // Validate the message shape: anything else posted on the channel name is ignored.
  if (bc) bc.onmessage = async (e) => {
    const ids = e.data && e.data.ids;
    if (!Array.isArray(ids) || !listeners.size) return;
    const tx = db.transaction('records', 'readonly');
    const st = tx.objectStore('records');
    const recs = (await Promise.all(ids.map((id) => req2p(st.get(id))))).filter(Boolean).map((x) => x.rec);
    for (const fn of listeners) fn(recs);
  };
  // Resolve on oncomplete, not on the last request's onsuccess: only oncomplete guarantees the data is committed.
  const tx = (stores, mode, fn) => new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let out;
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('transaction aborted'));
    out = fn(t);
  });
  return {
    kind: 'indexeddb',
    async load() {
      // The transaction resolves with the request promise, which is then awaited for its value.
      const all = await tx('records', 'readonly', (t) => req2p(t.objectStore('records').getAll()));
      return (await all).map((x) => x.rec);
    },
    async put(records, { dirty = false } = {}) {
      if (!records.length) return;
      await tx('records', 'readwrite', (t) => {
        const st = t.objectStore('records');
        for (const rec of records) {
          const r = st.get(rec.id);
          r.onsuccess = () => {
            const old = r.result;
            let next = cloneRecord(rec);
            if (old) { next = cloneRecord(old.rec); mergeRecord(next, rec); }
            // dirty as 1/0, not boolean: keeps the option of an index on it (booleans are not valid IDB keys).
            // A non-dirty write (server merge) keeps an existing dirty mark: a local edit not yet sent survives.
            st.put({ id: rec.id, rec: next, dirty: dirty ? 1 : old ? old.dirty : 0 });
          };
        }
      });
      if (bc) { try { bc.postMessage({ ids: records.map((r) => r.id) }); } catch { /* closed */ } }
    },
    async dirty() {
      const all = await tx('records', 'readonly', (t) => req2p(t.objectStore('records').getAll()));
      return (await all).filter((x) => x.dirty).map((x) => x.rec);
    },
    async clean(records) {
      await tx('records', 'readwrite', (t) => {
        const st = t.objectStore('records');
        for (const rec of records) {
          const r = st.get(rec.id);
          // Clean only if the stored record is still exactly what was sent: an edit made during the request keeps
          // the record dirty, so it goes out in the next sync instead of being silently dropped.
          r.onsuccess = () => { const x = r.result; if (x && x.dirty && same(x.rec, rec)) st.put({ ...x, dirty: 0 }); };
        }
      });
    },
    async getMeta(k) { const x = await tx('meta', 'readonly', (t) => req2p(t.objectStore('meta').get(k))); const v = await x; return v ? v.v : undefined; },
    async setMeta(k, v) { await tx('meta', 'readwrite', (t) => { t.objectStore('meta').put({ k, v }); }); },
    async clear() { await tx(['records', 'meta'], 'readwrite', (t) => { t.objectStore('records').clear(); t.objectStore('meta').clear(); }); },
    onOtherTab(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

// Fallback store: the whole library as one JSON value. The probe write throws early when storage is disabled or
// full (Safari private mode used to have a 0-byte quota), so openStore falls through to memory.
function lsStore(name) {
  const key = 'in-html-bookmarks:' + name;
  const ls = globalThis.localStorage;
  ls.setItem(key + ':probe', '1');
  ls.removeItem(key + ':probe');
  let data;
  try { data = JSON.parse(ls.getItem(key) || 'null'); } catch { data = null; }
  if (!data || typeof data !== 'object') data = { records: {}, meta: {} };
  const save = () => ls.setItem(key, JSON.stringify(data));
  return memoryLike('localstorage', data, save);
}

// Same interface over a plain object; `save` persists it (localStorage) or does nothing (memory). No cross-tab
// notification: localStorage mode has no merge, so concurrent tabs are last-writer-wins there.
function memoryLike(kind, data, save = () => {}) {
  return {
    kind,
    async load() { return Object.values(data.records).map((x) => x.rec); },
    async put(records, { dirty = false } = {}) {
      for (const rec of records) {
        const old = data.records[rec.id];
        let next = cloneRecord(rec);
        if (old) { next = cloneRecord(old.rec); mergeRecord(next, rec); }
        data.records[rec.id] = { rec: next, dirty: dirty ? 1 : old ? old.dirty : 0 };
      }
      save();
    },
    async dirty() { return Object.values(data.records).filter((x) => x.dirty).map((x) => x.rec); },
    async clean(records) { for (const rec of records) { const x = data.records[rec.id]; if (x && same(x.rec, rec)) x.dirty = 0; } save(); },
    async getMeta(k) { return data.meta[k]; },
    async setMeta(k, v) { data.meta[k] = v; save(); },
    async clear() { data.records = {}; data.meta = {}; save(); },
    onOtherTab() { return () => {}; },
  };
}

// Best store first; `error` accumulates the reasons so the page can tell the user why data is not persistent.
export async function openStore(name) {
  let error = '';
  try { return Object.assign(await idbStore(name), { error }); } catch (e) { error = String(e && e.message || e); }
  try { return Object.assign(lsStore(name), { error }); } catch (e) { error += '; ' + String(e && e.message || e); }
  return Object.assign(memoryLike('memory', { records: {}, meta: {} }), { error });
}
