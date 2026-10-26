// agreement-constructor/store.js - the library in this browser: IndexedDB (database `agreement-constructor`) with
// localStorage as the fallback when IndexedDB is unavailable (private windows of some browsers). Four stores:
// templates (the latest version of each template), versions (immutable snapshots `id@version` that documents refer
// to), docs (filled documents) and meta (key / value: seeding, the last opened item). Every read is normalized by
// contract/model.js, so a damaged record never breaks the page.
//
//   const store = await openStore(name?)    store.kind: 'indexeddb' | 'localStorage'
//   store.templates.list() / get(id) / put(tpl) / remove(id)       store.docs.list() / get(id) / put(doc) / remove(id)
//
// Why IndexedDB first: contracts with their version snapshots outgrow the ~5 MB localStorage quota, IndexedDB stores
// structured clones without JSON round trips and does not block the main thread on large writes. The localStorage
// fallback keeps the app usable where IndexedDB is missing or blocked, at the price of rewriting a whole store per put.
// All operations are wrapped by safe(): storage failures (quota, private mode, blocked upgrade) degrade to "not
// saved" results instead of exceptions in UI code.
//   store.versions.get(id, version) / put(tpl)                      store.meta.get(key, def) / set(key, value)
import { normalizeDoc, normalizeTemplate } from '../contract/model.js';

const STORES = ['templates', 'versions', 'docs', 'meta'];

// Version 1 schema; onupgradeneeded creates any missing store, so adding a store later only needs a version bump.
// onblocked (another tab holds an older version open) rejects, and openStore falls back to localStorage.
function idb(name) {
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(name, 1); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => { const db = req.result; for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}

// The result is read on transaction complete, not on request success: only then is a write durable.
const tx = (db, store, mode, fn) => new Promise((resolve, reject) => {
  const t = db.transaction(store, mode);
  const r = fn(t.objectStore(store));
  t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
  t.onerror = () => reject(t.error);
  t.onabort = () => reject(t.error);
});

// A key / value backend over IndexedDB or localStorage: get, put, remove, all (values).
function backend(db, prefix) {
  if (db) {
    return (store) => ({
      get: (k) => tx(db, store, 'readonly', (s) => s.get(k)),
      put: (k, v) => tx(db, store, 'readwrite', (s) => s.put(v, k)),
      remove: (k) => tx(db, store, 'readwrite', (s) => s.delete(k)),
      all: () => tx(db, store, 'readonly', (s) => s.getAll()),
    });
  }
  const key = (store) => prefix + ':' + store;
  // localStorage layout: one JSON object per store under "<db name>:<store>"; hasOwnProperty avoids prototype keys
  // such as "__proto__" being read as stored values.
  const read = (store) => { try { return JSON.parse(localStorage.getItem(key(store)) || '{}') || {}; } catch { return {}; } };
  const write = (store, o) => { localStorage.setItem(key(store), JSON.stringify(o)); };
  return (store) => ({
    get: async (k) => (Object.prototype.hasOwnProperty.call(read(store), k) ? read(store)[k] : undefined),
    put: async (k, v) => { const o = read(store); o[k] = v; write(store, o); },
    remove: async (k) => { const o = read(store); delete o[k]; write(store, o); },
    all: async () => Object.values(read(store)),
  });
}

export async function openStore(name = 'agreement-constructor') {
  let db = null;
  try { if (typeof indexedDB !== 'undefined') db = await idb(name); } catch { db = null; }
  const B = backend(db, name);
  const T = B('templates'), V = B('versions'), D = B('docs'), M = B('meta');
  const safe = async (p, def) => { try { return await p; } catch { return def; } };
  return {
    kind: db ? 'indexeddb' : 'localStorage',
    templates: {
      list: async () => (await safe(T.all(), [])).map(normalizeTemplate),
      get: async (id) => { const r = await safe(T.get(id), null); return r ? normalizeTemplate(r) : null; },
      put: (t) => safe(T.put(t.id, t).then(() => true), false),
      remove: (id) => safe(T.remove(id), null),
    },
    versions: {
      // Version snapshots are keyed "id@version" and never overwritten in practice: documents point at the exact template
      // version they were filled with, so a later template edit cannot change an existing contract's text.
      get: async (id, v) => { const r = await safe(V.get(id + '@' + v), null); return r ? normalizeTemplate(r) : null; },
      put: (t) => safe(V.put(t.id + '@' + t.version, t).then(() => true), false),
    },
    docs: {
      list: async () => (await safe(D.all(), [])).map(normalizeDoc),
      get: async (id) => { const r = await safe(D.get(id), null); return r ? normalizeDoc(r) : null; },
      put: (d) => safe(D.put(d.id, d).then(() => true), false),
      remove: (id) => safe(D.remove(id), null),
    },
    meta: {
      get: async (k, def = null) => { const v = await safe(M.get(k), undefined); return v === undefined ? def : v; },
      set: (k, v) => safe(M.put(k, v), null),
    },
  };
}
