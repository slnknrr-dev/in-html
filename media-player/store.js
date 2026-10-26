// media-player/store.js - where the catalogue lives. One schema (catalog/), two places:
//   local    this browser: IndexedDB 'media-player' (nodes, blobs, kv for File System Access handles); other tabs of
//            the same origin follow through a BroadcastChannel; without IndexedDB (some private windows, file://)
//            the catalogue lives in memory and the page says so
//   remote   a backend (the page's own in the backend / Electron artifacts, or a server the user configured): the
//            catalogue is loaded from api/db, changes go to api/db/ops, other clients' changes come by long polling
//            api/db/changes; blobs live in api/blobs
//
//   openStore({ server }) -> store { kind, db, blobs, kv, status, persistent, on(fn), flush(), close() }
//   blobs: { put(blob | bytes, type, id?) -> id, get(id) -> Blob | null, url(id) -> string, remove(id), list() }
//   kv:    { get(key), set(key, value), del(key) }     (local only: handles of picked folders)

import { createDB } from '../catalog/db.js';
import { normNode, uid } from '../catalog/model.js';
import { api, apiURL } from './env.js';

// SYNC MODEL: the in-memory catalog/db.js is the source of truth for the UI; stores persist or replicate its ops.
// Ops are coalesced per node id (last write wins inside a flush window), so a node edited 50 times in 150 ms is
// written once. Every apply carries an `origin` ('tab', 'remote', 'client') so a replicated op is not echoed back
// to where it came from, which would otherwise loop forever between tabs or between client and server.
const DB_NAME = 'media-player';

// Resolves null instead of rejecting on every failure mode (no IndexedDB in some private windows, file:// in some
// browsers, blocked upgrade): the store then runs in memory and reports persistent: false.
function idb() {
  return new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, 1); } catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('nodes')) d.createObjectStore('nodes', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const txDone = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });

function emitter() {
  const fns = new Set();
  return { on: (f) => { fns.add(f); return () => fns.delete(f); }, emit: (e) => { for (const f of fns) { try { f(e); } catch (err) { console.error(err); } } } };
}

async function openLocal() {
  const d = await idb();
  const ev = emitter();
  const urls = new Map();
  const mem = { blobs: new Map(), kv: new Map() };
  let nodes = [];
  if (d) { try { nodes = await reqP(d.transaction('nodes').objectStore('nodes').getAll()); } catch { nodes = []; } }
  const db = createDB({ nodes: nodes.map(normNode).filter(Boolean) });
  let pending = new Map();
  let timer = null;
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('media-player-db') : null;
  const flush = async () => {
    timer = null;
    if (!pending.size) return;
    const ops = [...pending.values()];
    pending = new Map();
    if (d) {
      try {
        const tx = d.transaction('nodes', 'readwrite');
        const st = tx.objectStore('nodes');
        for (const o of ops) { if (o.op === 'put') st.put(o.node); else st.delete(o.id); }
        await txDone(tx);
      } catch (e) { console.error(e); ev.emit({ type: 'error', error: e }); }
    }
  };
  db.on((e) => {
    if (e.origin === 'tab') return;
    for (const o of e.ops) pending.set(o.op === 'put' ? o.node.id : o.id, o);
    if (!timer) timer = setTimeout(flush, 150);
    // Other tabs apply the ops in memory only (origin 'tab' is not written again): the originating tab already
    // persisted them, and two tabs writing the same ops would just double the IndexedDB work.
    if (channel) { try { channel.postMessage({ ops: e.ops }); } catch { /* too large */ } }
  });
  if (channel) channel.onmessage = (m) => { if (m.data && Array.isArray(m.data.ops)) db.apply(m.data.ops, { origin: 'tab' }); };
  // Best effort: IndexedDB transactions started in pagehide usually complete, but the page may be frozen first; the
  // 150 ms flush window bounds what can be lost.
  addEventListener('pagehide', () => { flush(); });

  const blobs = {
    async put(data, type = 'application/octet-stream', id = 'b' + uid(10)) {
      const blob = data instanceof Blob ? data : new Blob([data], { type });
      if (d) { const tx = d.transaction('blobs', 'readwrite'); tx.objectStore('blobs').put({ id, type: blob.type || type, data: blob, size: blob.size, created: Date.now() }); await txDone(tx); } else mem.blobs.set(id, blob);
      return id;
    },
    async get(id) {
      if (!d) return mem.blobs.get(id) || null;
      const r = await reqP(d.transaction('blobs').objectStore('blobs').get(id));
      return r ? r.data : null;
    },
    async url(id) {
      if (urls.has(id)) return urls.get(id);
      const b = await blobs.get(id);
      if (!b) return null;
      const u = URL.createObjectURL(b);
      urls.set(id, u);
      return u;
    },
    async remove(id) {
      if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
      if (!d) { mem.blobs.delete(id); return; }
      const tx = d.transaction('blobs', 'readwrite'); tx.objectStore('blobs').delete(id); await txDone(tx);
    },
    async list() { return d ? reqP(d.transaction('blobs').objectStore('blobs').getAllKeys()) : [...mem.blobs.keys()]; },
  };
  const kv = {
    async get(k) { return d ? reqP(d.transaction('kv').objectStore('kv').get(k)) : mem.kv.get(k); },
    async set(k, v) { if (!d) { mem.kv.set(k, v); return; } const tx = d.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); await txDone(tx); },
    async del(k) { if (!d) { mem.kv.delete(k); return; } const tx = d.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(k); await txDone(tx); },
  };
  return { kind: 'local', db, blobs, kv, persistent: !!d, status: 'ok', on: ev.on, flush, close() { if (channel) channel.close(); } };
}

// Remote replication: optimistic local apply, batched POST of pending ops (120 ms), exponential backoff up to 30 s
// on failure with ops kept (not dropped) so offline edits survive until the server returns.
async function openRemote(server) {
  const ev = emitter();
  const snap = await api(server, 'db');
  const db = createDB({ nodes: (snap.nodes || []).map(normNode).filter(Boolean) });
  let serverRev = snap.rev || 0;
  let pending = new Map();
  let timer = null, backoff = 500, closed = false;
  const store = { kind: 'remote', server, db, persistent: true, status: 'ok', on: ev.on };
  const setStatus = (s) => { if (store.status !== s) { store.status = s; ev.emit({ type: 'status', status: s }); } };
  const push = async () => {
    timer = null;
    if (!pending.size) return;
    const ops = [...pending.values()];
    pending = new Map();
    try {
      await api(server, 'db/ops', { method: 'POST', body: { ops } });
      backoff = 500;
      setStatus('ok');
    } catch (e) {
      for (const o of ops) { const k = o.op === 'put' ? o.node.id : o.id; if (!pending.has(k)) pending.set(k, o); }
      setStatus(e.status === 401 || e.status === 403 ? 'auth' : 'offline');
      timer = setTimeout(push, (backoff = Math.min(30000, backoff * 2)));
    }
  };
  db.on((e) => {
    if (e.origin === 'remote') return;
    for (const o of e.ops) pending.set(o.op === 'put' ? o.node.id : o.id, o);
    if (!timer) timer = setTimeout(push, 120);
  });
  (async function poll() {
    while (!closed) {
      try {
        const ch = await api(server, `db/changes?since=${serverRev}&wait=20`);
        // reset: the server no longer has the change log since our revision (restart, compaction). Resync by diffing a full
        // snapshot: put everything it has, delete what it lacks.
        if (ch.reset) {
          const s = await api(server, 'db');
          const have = new Set(db.all().map((n) => n.id));
          const ops = (s.nodes || []).map((n) => ({ op: 'put', node: normNode(n) })).filter((o) => o.node);
          for (const o of ops) have.delete(o.node.id);
          for (const id of have) ops.push({ op: 'del', id });
          db.apply(ops, { origin: 'remote' });
          serverRev = s.rev;
        } else {
          // Incoming ops are dropped for nodes with unsent local edits (pending), so a slow poll cannot overwrite what the
          // user just typed; and for nodes already at the same `updated` stamp (our own ops coming back).
          const ops = (ch.ops || []).filter((o) => {
            if (o.op === 'del') return db.has(o.id) && !pending.has(o.id);
            const cur = db.get(o.node.id);
            return !pending.has(o.node.id) && !(cur && cur.updated === o.node.updated);
          }).map((o) => (o.op === 'put' ? { op: 'put', node: normNode(o.node) } : o)).filter((o) => o.op === 'del' || o.node);
          if (ops.length) db.apply(ops, { origin: 'remote' });
          serverRev = ch.rev;
        }
        setStatus('ok');
      } catch (e) {
        setStatus(e.status === 401 || e.status === 403 ? 'auth' : 'offline');
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
  })();
  store.blobs = {
    async put(data, type = 'application/octet-stream', id = 'b' + uid(10)) {
      const blob = data instanceof Blob ? data : new Blob([data], { type });
      await api(server, `blobs/${id}?type=${encodeURIComponent(blob.type || type)}`, { method: 'PUT', body: blob });
      return id;
    },
    async get(id) { try { return await (await api(server, 'blobs/' + id, { raw: true })).blob(); } catch { return null; } },
    // A remote blob is played by URL (Range-capable) instead of downloading it into a Blob first.
    async url(id) { return apiURL(server, 'blobs/' + encodeURIComponent(id)); },
    async remove(id) { await api(server, 'blobs/' + id, { method: 'DELETE' }); },
    async list() { return api(server, 'blobs'); },
  };
  const mem = new Map();
  store.kv = { async get(k) { return mem.get(k); }, async set(k, v) { mem.set(k, v); }, async del(k) { mem.delete(k); } };
  store.flush = push;
  store.close = () => { closed = true; };
  return store;
}

export async function openStore({ server = null } = {}) {
  return server ? openRemote(server) : openLocal();
}
