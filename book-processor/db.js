// book-processor/db.js - offline storage in IndexedDB (files never leave the device): the library shelf
// (light records for the grid), book contents (parsed model + the original file), reading marks (position,
// bookmarks, highlights) and writer drafts. When IndexedDB is unavailable (some private modes) everything lives in
// memory for the session and `db.memory` is true.
//
//   shelf record   { id, title, authors, lang, format, fileName, size, added, opened, progress, pos, words, series,
//                    thumb: Blob | null, cover: { design, palette } | null }
//   content        { id, book, original: Uint8Array | null, originalName }
//   marks          { id, bookmarks: [], highlights: [], updated }
//   draft          { id, book, created, updated, libraryId }

const NAME = 'book-processor-offline';   // the IndexedDB name keeps the folder's former name, so existing shelves stay
// Split stores by access pattern: the library grid reads every shelf record on each visit, so records there are
// small (title, progress, thumbnail); the heavy parsed book and original file live in `content`, read only when a
// book opens. One combined record would make opening the library parse megabytes per book.
const STORES = ['shelf', 'content', 'marks', 'drafts'];
let dbp = null;
const mem = new Map(STORES.map((s) => [s, new Map()]));

export const db = {
  memory: false,

  // Memoised promise: concurrent callers share one open request. Every failure (including onblocked, when another tab
  // holds an old version open) degrades to memory mode instead of rejecting, so the app always starts.
  open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      let rq;
      try { rq = indexedDB.open(NAME, 1); } catch (e) { reject(e); return; }
      rq.onupgradeneeded = () => {
        const d = rq.result;
        for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
      };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error || new Error('IndexedDB error'));
      rq.onblocked = () => reject(new Error('IndexedDB blocked'));
    }).catch((e) => { db.memory = true; console.warn('IndexedDB unavailable, keeping data in memory:', e && e.message); return null; });
    return dbp;
  },

  // Resolve on transaction complete, not on request success: only `complete` guarantees the write is durable, and
  // reading r.result there still works because the request finished before its transaction. fn returns the request
  // (or the memory store's { result } look-alike), so callers are identical in both modes.
  async req(store, mode, fn) {
    const d = await db.open();
    if (!d) return fn(memStore(store));
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, mode);
      const r = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(r && typeof r === 'object' && 'result' in r ? r.result : r);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('aborted'));
    });
  },
  all: (store) => db.req(store, 'readonly', (s) => s.getAll()),
  get: (store, id) => db.req(store, 'readonly', (s) => s.get(id)),
  put: (store, rec) => db.req(store, 'readwrite', (s) => s.put(rec)),
  del: (store, id) => db.req(store, 'readwrite', (s) => s.delete(id)),

  // Library.
  shelf: () => db.all('shelf'),
  getShelf: (id) => db.get('shelf', id),
  putShelf: (rec) => db.put('shelf', rec),
  getContent: (id) => db.get('content', id),
  putContent: (rec) => db.put('content', rec),
  async deleteBook(id) { await db.del('shelf', id); await db.del('content', id); await db.del('marks', id); },
  async getMarks(id) { return (await db.get('marks', id)) || { id, bookmarks: [], highlights: [], updated: '' }; },
  putMarks: (rec) => db.put('marks', { ...rec, updated: new Date().toISOString() }),

  // Writer.
  drafts: () => db.all('drafts'),
  getDraft: (id) => db.get('drafts', id),
  putDraft: (rec) => db.put('drafts', { ...rec, updated: new Date().toISOString() }),
  delDraft: (id) => db.del('drafts', id),

  async estimate() {
    try { return navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; } catch { return null; }
  },
  async persisted() { try { return navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false; } catch { return false; } },
  // navigator.storage.persist() asks the browser not to evict this origin's data under storage pressure; without it
  // a library of books can be silently wiped (best-effort storage), which matters for an offline-only app.
  async persist() { try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch { return false; } },
};

// The same request surface over a Map (structured clones, like IndexedDB would keep).
// structuredClone on put and get mimics IndexedDB semantics: callers that mutate a returned record must not change
// the stored one, otherwise memory mode would behave differently from real storage and hide bugs.
function memStore(name) {
  const m = mem.get(name);
  const copy = (v) => (v === undefined ? undefined : structuredClone(v));
  return {
    getAll: () => ({ result: [...m.values()].map(copy) }),
    get: (id) => ({ result: copy(m.get(id)) }),
    put: (rec) => { m.set(rec.id, copy(rec)); return { result: rec.id }; },
    delete: (id) => { m.delete(id); return { result: undefined }; },
  };
}
