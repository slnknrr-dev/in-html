// knowledge-processor/store.js - the editor's storage in this browser (IndexedDB): knowledge bases (the model without
// media bytes) and media blobs, plus project archives (.zip: kb.json + media/<file>) and JSON backups in and out.
//
//   listKBs() -> [{ id, title, updated, pages, theme }]     getKB(id) -> kb | null      putKB(kb)      deleteKB(id)
//   getMedia(kbId, id) -> Blob | null    putMedia(kbId, id, blob)    deleteMedia(kbId, id)    mediaIds(kbId) -> [id]
//   lastOpened() / setLastOpened(id)
//   importKB(text | bytes) -> Promise<{ kb, media: Map(id -> Blob) }>   (JSON with base64 media, or a project .zip)
//   projectZip(kb, getBlob) -> Promise<Uint8Array>
// Without IndexedDB (private modes, file:// in some browsers) everything lives in memory for the session.
import { normKB } from './model.js';
import { mediaFileName } from './site.js';
import { readZip, writeZip } from '../zip/zip.js';
import { b64decode } from '../codec/base64.js';

// Three object stores with out-of-line keys: kbs (kb.id), media (kbId + '/' + mediaId), meta ('last').
// Media are separate Blobs, not base64 inside the KB record: a KB write on every keystroke must not rewrite
// megabytes of images, and IndexedDB stores Blobs natively (structured clone, no 33% base64 overhead).
// `mem` mirrors the same three maps for the no-IndexedDB fallback, so every function has one code shape.
const DB = 'knowledge-processor';
let dbP = null;
const mem = { kbs: new Map(), media: new Map(), meta: new Map() };

// Memoised promise: one connection per page. It never rejects; any failure (SecurityError in private modes,
// onblocked by another tab holding an older version) resolves null = "use memory". Rationale: the editor must
// keep working; persistence is an upgrade, not a precondition. Version 1 + contains() guards make the upgrade
// idempotent if stores are added later.
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

// Runs fn inside one transaction and resolves with fn's value only on `complete`, i.e. after the write is
// durable; resolving on the request's success would report a save that may still abort.
// Caveat: fn must issue its requests synchronously (before returning to the event loop); IndexedDB
// auto-commits a transaction that has no pending requests, so an await on something else inside fn would
// hit TransactionInactiveError. All callers here issue exactly one request.
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

// Summary records for the picker; sorted newest first. ISO-8601 timestamps sort correctly as strings.
export async function listKBs() {
  const all = await tx('kbs', 'readonly', (s) => (s ? req(s.getAll()) : [...mem.kbs.values()]));
  return (all || []).map((k) => ({ id: k.id, title: k.title, updated: k.updated, pages: (k.pages || []).length, theme: k.theme, remote: k.remote || null }))
    .sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
}

// normKB on read: records written by older versions are upgraded on the fly (no migration step).
// `remote` is re-attached because normKB drops unknown fields and remote is editor-local metadata.
export async function getKB(id) {
  const k = await tx('kbs', 'readonly', (s) => (s ? req(s.get(id)) : mem.kbs.get(id)));
  if (!k) return null;
  const kb = normKB(k);
  if (k.remote) kb.remote = k.remote;
  return kb;
}

// JSON clone decouples the stored record from the live object; inline base64 `data` is dropped because bytes
// live in the media store.
export async function putKB(kb) {
  const v = JSON.parse(JSON.stringify(kb));
  for (const m of Object.values(v.media || {})) delete m.data;
  await tx('kbs', 'readwrite', (s) => (s ? req(s.put(v, kb.id)) : mem.kbs.set(kb.id, v)));
}

// Media deleted one by one after the KB: not atomic, but an orphaned blob only wastes space, while the reverse
// order could leave a KB pointing at deleted media if the tab closes midway.
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
// getAllKeys + prefix filter: O(all media of all bases). Acceptable for a local editor; an IDBKeyRange bound
// on the kbId + '/' prefix would scale better.
export async function mediaIds(kbId) {
  const keys = await tx('media', 'readonly', (s) => (s ? req(s.getAllKeys()) : [...mem.media.keys()]));
  return (keys || []).map(String).filter((k) => k.startsWith(kbId + '/')).map((k) => k.slice(kbId.length + 1));
}

export async function lastOpened() { return tx('meta', 'readonly', (s) => (s ? req(s.get('last')) : mem.meta.get('last'))); }
export async function setLastOpened(id) { await tx('meta', 'readwrite', (s) => (s ? req(s.put(id, 'last')) : mem.meta.set('last', id))); }

// A knowledge base from a JSON backup (media bytes inline as base64 `data`) or a project archive.
// Format sniffed by content, not file name: 'PK' (0x50 0x4b) = zip local file header, else JSON text.
export async function importKB(input) {
  const bytes = typeof input === 'string' ? null : input instanceof Uint8Array ? input : new Uint8Array(input);
  let src, files = null;
  if (bytes && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const entries = readZip(bytes);
    // kb.json accepted at any depth: users often re-zip the extracted folder, which adds a top directory.
    const main = entries.find((e) => /(^|\/)kb\.json$/.test(e.name));
    if (!main) throw new Error('kb.json missing');
    src = JSON.parse(await main.text());
    files = new Map();
    for (const e of entries) if (/(^|\/)media\/[^/]+$/.test(e.name)) files.set(e.name.split('/').pop(), e);
  } else {
    src = JSON.parse(typeof input === 'string' ? input : new TextDecoder().decode(bytes));
  }
  // Format marker check: fail fast on arbitrary JSON instead of normalising it into an empty base.
  if (!src || src.format !== 'kp-kb') throw new Error('not a knowledge base');
  const kb = normKB(src);
  const media = new Map();
  // Media bytes: inline base64 (JSON backup) wins, else the archive file named by mediaFileName (the same
  // function that wrote it in projectZip, so names round-trip).
  for (const [id, m] of Object.entries(kb.media)) {
    if (m.data) { media.set(id, new Blob([b64decode(m.data)], { type: m.type })); delete m.data; continue; }
    const e = files && files.get(mediaFileName(id, m));
    if (e) media.set(id, new Blob([await e.data()], { type: m.type }));
  }
  return { kb, media };
}

// `store` (no compression) for already compressed formats: deflating JPEG/PNG/audio/video costs CPU and saves
// nothing. SVG, JSON and text are deflated. kb.json goes first (unshift) so tools listing the archive see it
// at the top; JSON indented by 1 keeps it diffable at small cost.
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
