// site-studio/wiki-store.js - the editor's storage in this browser (IndexedDB): knowledge bases (the model without
// media bytes) and media blobs, plus project archives (.zip: kb.json + media/<file>) and JSON backups in and out.
//
//   listKBs() -> [{ id, title, updated, pages, theme }]     getKB(id) -> kb | null      putKB(kb)      deleteKB(id)
//   getMedia(kbId, id) -> Blob | null    putMedia(kbId, id, blob)    deleteMedia(kbId, id)    mediaIds(kbId) -> [id]
//   lastOpened() / setLastOpened(id)
//   importKB(text | bytes) -> Promise<{ kb, media: Map(id -> Blob) }>   (JSON with base64 media, or a project .zip)
//   projectZip(kb, getBlob) -> Promise<Uint8Array>
// Without IndexedDB (private modes, file:// in some browsers) everything lives in memory for the session.
import { normKB } from './wiki-model.js';
import { mediaFileName } from './wiki-site.js';
import { readZip, writeZip } from '../zip/zip.js';
import { b64decode } from '../codec/base64.js';

// Design rules:
// - Three object stores with out-of-line keys: 'kbs' (id -> KB without media bytes), 'media' ('kbId/mediaId' -> Blob),
// 'meta' (small settings). Blobs are stored natively (structured clone), not as base64: no 33% overhead, and the
// browser may keep them on disk instead of in the JS heap.
// - Media is split from the KB because the KB is rewritten on every autosave; rewriting megabytes of images each
// time would make autosave slow and wear storage.
// - Graceful degradation: every accessor has an in-memory branch (s === null), so the editor works where IndexedDB is
// unavailable; isPersistent() lets the UI warn that work will not survive a reload.
const DB = 'site-studio-wiki';
let dbP = null;
const mem = { kbs: new Map(), media: new Map(), meta: new Map() };

// Memoised open. Version 1 only; onupgradeneeded creates missing stores idempotently, so adding a store later is a
// version bump plus one more contains() line. onblocked (another tab holds an older version open) and onerror
// degrade to memory instead of hanging the editor forever.
function open() {
  if (!dbP) {
    dbP = new Promise((resolve) => {
      let req;
      try { req = indexedDB.open(DB, 1); } catch { resolve(null); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kbs')) db.createObjectStore('kbs');
        if (!db.objectStoreNames.contains('media')) db.createObjectStore('media');
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
  }
  return dbP;
}

// Resolve on transaction complete, not on request success: for 'readwrite' that is the point where the data is
// durable. fn must issue its requests synchronously (no awaits on other promises inside): IndexedDB commits a
// transaction as soon as no request is pending at the end of a task.
async function tx(store, mode, fn) {
  const db = await open();
  if (!db) return fn(null);
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('aborted'));
  });
}
const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export const isPersistent = async () => !!(await open());

export async function listKBs() {
  const all = await tx('kbs', 'readonly', (s) => (s ? req(s.getAll()) : [...mem.kbs.values()]));
  return (all || []).map((k) => ({ id: k.id, title: k.title, updated: k.updated, pages: (k.pages || []).length, theme: k.theme, remote: k.remote || null }))
    .sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
}

// normKB on every read: stored data may come from an older editor version; normalising here migrates it lazily.
// `remote` (server sync binding) is editor-local and not part of the model, so it is re-attached by hand.
export async function getKB(id) {
  const k = await tx('kbs', 'readonly', (s) => (s ? req(s.get(id)) : mem.kbs.get(id)));
  if (!k) return null;
  const kb = normKB(k);
  if (k.remote) kb.remote = k.remote;
  return kb;
}

// JSON round trip = deep copy without media bytes; IndexedDB would clone anyway, but must not store data:.
export async function putKB(kb) {
  const v = JSON.parse(JSON.stringify(kb));
  for (const m of Object.values(v.media || {})) delete m.data;
  await tx('kbs', 'readwrite', (s) => (s ? req(s.put(v, kb.id)) : mem.kbs.set(kb.id, v)));
}

export async function deleteKB(id) {
  await tx('kbs', 'readwrite', (s) => (s ? req(s.delete(id)) : mem.kbs.delete(id)));
  for (const mid of await mediaIds(id)) await deleteMedia(id, mid);
}

export async function getMedia(kbId, id) {
  return tx('media', 'readonly', (s) => (s ? req(s.get(kbId + '/' + id)) : mem.media.get(kbId + '/' + id))).then((b) => b || null);
}
export async function putMedia(kbId, id, blob) {
  await tx('media', 'readwrite', (s) => (s ? req(s.put(blob, kbId + '/' + id)) : mem.media.set(kbId + '/' + id, blob)));
}
export async function deleteMedia(kbId, id) {
  await tx('media', 'readwrite', (s) => (s ? req(s.delete(kbId + '/' + id)) : mem.media.delete(kbId + '/' + id)));
}
// Prefix scan over all keys: O(all media). Acceptable for thousands of keys; an index or key range would scale further.
export async function mediaIds(kbId) {
  const keys = await tx('media', 'readonly', (s) => (s ? req(s.getAllKeys()) : [...mem.media.keys()]));
  return (keys || []).map(String).filter((k) => k.startsWith(kbId + '/')).map((k) => k.slice(kbId.length + 1));
}

export async function lastOpened() { return tx('meta', 'readonly', (s) => (s ? req(s.get('last')) : mem.meta.get('last'))); }
export async function setLastOpened(id) { await tx('meta', 'readwrite', (s) => (s ? req(s.put(id, 'last')) : mem.meta.set('last', id))); }

// A knowledge base from a JSON backup (media bytes inline as base64 `data`) or a project archive.
// Format sniffing by content, not by file name: 'PK' (zip local-file header) -> project archive, else JSON text.
// kb.json may sit in a sub-folder (archives re-zipped by OS tools add one); media are matched by exported file name.
// The format tag check rejects unrelated JSON before normKB silently turns it into an empty base.
export async function importKB(input) {
  const bytes = typeof input === 'string' ? null : input instanceof Uint8Array ? input : new Uint8Array(input);
  let src, files = null;
  if (bytes && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const entries = readZip(bytes);
    const main = entries.find((e) => /(^|\/)kb\.json$/.test(e.name));
    if (!main) throw new Error('kb.json missing');
    src = JSON.parse(await main.text());
    files = new Map();
    for (const e of entries) if (/(^|\/)media\/[^/]+$/.test(e.name)) files.set(e.name.split('/').pop(), e);
  } else {
    src = JSON.parse(typeof input === 'string' ? input : new TextDecoder().decode(bytes));
  }
  if (!src || src.format !== 'ss-wiki') throw new Error('not a knowledge base');
  const kb = normKB(src);
  const media = new Map();
  for (const [id, m] of Object.entries(kb.media)) {
    if (m.data) { media.set(id, new Blob([b64decode(m.data)], { type: m.type })); delete m.data; continue; }
    const e = files && files.get(mediaFileName(id, m));
    if (e) media.set(id, new Blob([await e.data()], { type: m.type }));
  }
  return { kb, media };
}

// store: already-compressed formats (PNG/JPEG/WebP/GIF/AVIF, audio, video) are stored, not deflated: deflate gains
// nothing on them and costs CPU. SVG and text still deflate well. kb.json is pretty-printed with indent 1: diffable
// in version control at a small size cost, and placed first so tools listing the archive show it on top.
export async function projectZip(kb, getBlob) {
  const v = JSON.parse(JSON.stringify(kb));
  delete v.remote;
  const out = [];
  for (const [id, m] of Object.entries(v.media || {})) {
    delete m.data;
    if (m.secret) continue; // inside its envelopes only
    const b = await getBlob(id);
    if (b) out.push({ name: 'media/' + mediaFileName(id, m), data: new Uint8Array(await b.arrayBuffer()), store: /^(image\/(png|jpeg|webp|gif|avif)|audio|video)/.test(m.type) });
  }
  out.unshift({ name: 'kb.json', data: JSON.stringify(v, null, 1) });
  return writeZip(out);
}
