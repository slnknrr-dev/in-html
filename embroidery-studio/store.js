// embroidery-studio/store.js - what stays in the browser: my schemes and stitching progress (IndexedDB, with an
// in-memory fallback when storage is unavailable), cached thumbnails, and the settings (localStorage).
//
//   settings() / setSettings(patch)                   viewer and print preferences, the reader key
//   listMine() -> [record]   getMine(id) -> record   putMine(record)   deleteMine(id)
//     record = { id, json (stitch/model toJSON), title, designer, category, tags, difficulty, width, height, colors,
//                stitches, created, updated, thumb (PNG data URL), origin: 'new' | 'convert' | 'import' | 'copy' |
//                'carpet', from (catalogue key of the original) }
//   getProgress(key) -> progress | null   putProgress(progress)   deleteProgress(key)   listProgress()
//     progress = { key, done (run-length cells), parts: [x:y:corner], parked: [[cell, palette]], started, updated,
//                  log: { 'YYYY-MM-DD': stitches }, total, doneCount }
//   getThumb(key) / putThumb(key, dataURL)
//   newReaderKey()

//
// Storage choice: charts and progress can be megabytes, beyond localStorage's ~5 MB per origin, so they go to
// IndexedDB; small settings stay in localStorage (synchronous read at startup). If IndexedDB cannot open (private
// modes, blocked by another tab) everything silently falls back to in-memory Maps: the app works, nothing persists.
import { lsGet, lsSet } from '../ui/dom.js';

const DB = 'embroidery-studio';
const STORES = ['schemes', 'progress', 'thumbs'];
let dbp = null;
const memory = new Map(STORES.map((s) => [s, new Map()]));

// One shared connection promise. Every failure path resolves to null (never rejects), which callers read as "use
// memory". onblocked: an older version is open in another tab; waiting could hang forever.
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB, 1); } catch { resolve(null); return; }
    req.onupgradeneeded = () => { const db = req.result; for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbp;
}

// fn receives the object store or, in memory mode, the Map; resolves on transaction complete (data committed), with
// the value fn produced.
async function tx(store, mode, fn) {
  const db = await open();
  if (!db) return fn(null, memory.get(store));
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const os = t.objectStore(store);
    let out;
    Promise.resolve(fn(os, null)).then((v) => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

async function getAll(store) {
  return tx(store, 'readonly', (os, mem) => (mem ? [...mem.values()] : req(os.getAll())));
}
async function get(store, id) {
  return tx(store, 'readonly', (os, mem) => (mem ? mem.get(id) || null : req(os.get(id)).then((v) => v || null)));
}
async function put(store, value) {
  return tx(store, 'readwrite', (os, mem) => { if (mem) mem.set(value.id, value); else os.put(value); });
}
async function del(store, id) {
  return tx(store, 'readwrite', (os, mem) => { if (mem) mem.delete(id); else os.delete(id); });
}

export const listMine = async () => (await getAll('schemes')).sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
export const getMine = (id) => get('schemes', id);
export const putMine = (r) => put('schemes', r);
// Deleting a scheme also deletes its progress and cached thumbnail (keys derived from the scheme id).
export const deleteMine = (id) => Promise.all([del('schemes', id), del('progress', 'my:' + id), del('thumbs', 'my:' + id)]);

export const getProgress = async (key) => { const r = await get('progress', key); return r ? { ...r, key: r.id } : null; };
export const putProgress = (p) => put('progress', { ...p, id: p.key });
export const deleteProgress = (key) => del('progress', key);
export const listProgress = async () => (await getAll('progress')).map((r) => ({ ...r, key: r.id }));

export const getThumb = async (key) => { const r = await get('thumbs', key); return r ? r.url : null; };
export const putThumb = (key, url) => put('thumbs', { id: key, url });

// --- settings ------------------------------------------------------------------------------------------------------

const DEFAULTS = {
  mode: 'colorSymbols', doneStyle: 'cross', symbolSet: 'symbols', grid: true, rulers: true, centre: false, pages: false,
  count: 14, strands: 2, brand: 'dmc', paper: 'a4', cellMm: 3, overlap: 2, pdfStyle: 'color', landscape: false,
  markRun: 'colour', readerKey: '', adminToken: '', sort: 'new', view: 'grid', overview: true,
};
let cache = null;
// Merge over defaults, then sanitise the fields that drive rendering (mode, fabric count, strands) so a corrupted
// or old value cannot break the chart. Cached per tab.
export function settings() {
  if (!cache) {
    const raw = lsGet('es-settings', {});
    cache = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
    if (!['symbols', 'color', 'colorSymbols', 'tint', 'realistic'].includes(cache.mode)) cache.mode = DEFAULTS.mode;
    if (![11, 14, 16, 18, 20, 22, 25, 28, 32].includes(+cache.count)) cache.count = 14;
    cache.strands = Math.max(1, Math.min(6, +cache.strands || 2));
  }
  return cache;
}
export function setSettings(patch) {
  cache = { ...settings(), ...patch };
  lsSet('es-settings', cache);
  return cache;
}

// 12 random bytes as base-36 pairs, cut to 20 chars of [a-z0-9]: matches the server's /^[a-z0-9]{12,40}$/.
export function newReaderKey() {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 20);
}
