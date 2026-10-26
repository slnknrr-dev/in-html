// language-studio/store.js - the progress document in this browser: IndexedDB (database `language-studio`, or
// `language-studio@<user>` for a signed-in account), with localStorage as the fallback when IndexedDB is unavailable
// (private windows of some browsers). Every read is validated (progress.js cleanProgress).
//
//   const store = await openStore(name)   store.load() -> doc   store.save(doc)   store.clear()
import { cleanProgress, emptyProgress } from './progress.js';

// Why IndexedDB first: the card map can reach tens of thousands of entries (LIMITS.cards = 50000), beyond what is
// comfortable in localStorage (about 5 MB, synchronous, string-only). IndexedDB stores the object structured-cloned,
// asynchronously, with a larger quota. One object store 'kv' with a single key: the document is always read and
// written whole, so finer-grained stores would add complexity without benefit.
// One database per account name, so two people on one browser do not mix their progress.
const KEY = 'progress';

// Promise wrapper of indexedDB.open. onblocked (another tab holds an older version open) rejects instead of waiting
// forever: the caller falls back to localStorage rather than hanging the app at startup.
function idb(name) {
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(name, 1); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}

// Resolve on transaction complete, not on request success: only then is a write durable. The request's result is
// read at that point (it is set by then).
const tx = (db, mode, fn) => new Promise((resolve, reject) => {
  const t = db.transaction('kv', mode);
  const r = fn(t.objectStore('kv'));
  t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
  t.onerror = () => reject(t.error);
  t.onabort = () => reject(t.error);
});

// Never throws: load falls back to an empty document, save reports false (quota, blocked storage). Learning must keep
// working in a private window even if nothing can be kept.
export async function openStore(name = 'language-studio') {
  let db = null;
  try { if (typeof indexedDB !== 'undefined') db = await idb(name); } catch { db = null; }
  const lsKey = name + ':' + KEY;
  return {
    kind: db ? 'indexeddb' : 'localStorage',
    async load() {
      try {
        if (db) return cleanProgress(await tx(db, 'readonly', (s) => s.get(KEY)));
        return cleanProgress(JSON.parse(localStorage.getItem(lsKey) || 'null'));
      } catch { return emptyProgress(); }
    },
    async save(doc) {
      try {
        if (db) await tx(db, 'readwrite', (s) => s.put(doc, KEY));
        else localStorage.setItem(lsKey, JSON.stringify(doc));
        return true;
      } catch { return false; }
    },
    async clear() {
      try { if (db) await tx(db, 'readwrite', (s) => s.delete(KEY)); else localStorage.removeItem(lsKey); } catch { /* nothing to clear */ }
    },
  };
}
