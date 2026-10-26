// catalog/db.js - the in-memory catalogue store shared by the browser (IndexedDB behind it), the backend (JSON files
// behind it) and Electron: nodes by id with indexes (type, children of a container, media of a work, match keys),
// batched changes with a revision log for sync, undo of the last batches, snapshots.
//
//   createDB({ nodes, rev }) -> db
//   db.get(id) / db.has(id) / db.all(type?) -> nodes / db.count(type?)
//   db.children(id) -> child works in play order (season, disc, order / episode, title)
//   db.mediaOf(workId) -> media of a work (best presence first)
//   db.find(key) -> id | null ; db.findAll(key) -> ids     keys: keysOf(node) ('loc:…', 'src:…', 'hash:…', 'id:mal:123',
//                                                           'person:<name>', 'tag:<key>')
//   db.put(node, { keepTime }) -> node        insert or replace (sets updated unless keepTime)
//   db.patch(id, fields) -> node | null       shallow merge; a field set to undefined is deleted
//   db.remove(id, { cascade = true }) -> removed ids   (cascade: child works, media, plays of removed works)
//   db.batch(fn, { label }) -> fn's result    one change event, one undo step
//   db.undo() -> boolean ; db.canUndo()
//   db.apply(ops, { origin = 'remote' })      ops [{ op: 'put', node } | { op: 'del', id }] from another replica
//   db.on(listener) -> off                    listener({ rev, ops, origin: 'local' | 'remote' | 'undo', label })
//   db.changesSince(rev) -> { rev, ops } | { rev, reset: true }   (log of the last 20 000 ops)
//   db.snapshot() -> { format: 'in-html-media-db', schema: 1, rev, nodes }
//   db.rev, db.version (bumps on every change; caches key on it)
//   db.memo(key, fn) -> cached value until the next change (derived data: facts, tag index, browse lists)
//   keysOf(node) -> match keys of a node ; srcKey(ref) -> normalized source key
//
// Design rules (apply to every function below):
// - One source of truth, many derived indexes. `map` holds the nodes; byType / kids / media / keys are rebuilt from a
//   node by index()/unindex() only. Every mutation goes through write(), which unindexes the previous version and
//   indexes the next one, so an index can never drift from the node it describes. A second mutation path (writing to
//   map directly) is the classic way such stores rot: one forgotten index update and find() returns ghosts.
// - Nodes are treated as immutable values. put/patch build a fresh object; the old object is kept by reference in the
//   undo inverse and in emitted ops. Mutating a node in place after get() would corrupt undo and the sync log silently.
// - Every write happens inside a batch. A bare write opens an implicit one-op batch, so listeners always see whole
//   batches, never a half-applied cascade (remove() of an album must not announce tracks removed but album present).
// - Persistence is someone else's job: this module is synchronous and storage-agnostic; adapters subscribe via on().

import { PRESENCE_RANK, naturalCompare, matchKey, now } from './model.js';

// Revision log bound: a replica further behind than this gets { reset: true } and must re-pull a snapshot. The bound
// trades memory (one small entry per op) against how long a peer may stay offline before a full resync.
const LOG_MAX = 20000;
// Kinds that are matched by title. Only top-level containers: an episode titled "Pilot" or a track "Intro" would
// collide across thousands of unrelated works, so children are matched by parent + order instead.
const TITLED = new Set(['show', 'movie', 'album', 'book', 'bookseries', 'podcast', 'musicvideo']);
// Undo depth: each step holds references to whole previous nodes, so the cap bounds retained memory.
const UNDO_MAX = 60;

// Canonical form of a source reference so the same video added twice is recognised as one.
// Two shapes: 'extractor:id' (yt-dlp style) and URLs. URL normalisation lowercases the host (case-insensitive per
// RFC 3986), drops the fragment (client-side only) and trailing slashes, but keeps path and query case: both are
// case-sensitive on most servers, and over-normalising would merge distinct resources (worse than a missed dedupe).
export function srcKey(ref) {
  const s = String(ref || '').trim();
  if (!s) return '';
  // extractor:id references keep the id's case (YouTube ids are case-sensitive). The second test keeps real URL
  // schemes out of this branch: 'https:x' would otherwise pass the first regex. Only the extractor name is lowercased.
  if (/^[a-z][a-z0-9_]*:[^/\s]+$/i.test(s) && !/^(https?|ftp|file|data|blob):/i.test(s)) return s.replace(/^([a-z0-9_]+):/i, (m, e) => e.toLowerCase() + ':');
  try {
    const u = new URL(s);
    u.hash = '';
    return (u.protocol + '//' + u.host.toLowerCase() + u.pathname.replace(/\/+$/, '') + u.search);
  } catch { return s; } // not a URL: keep verbatim, still usable as an exact key
}

// Match keys: the identities by which an incoming file / import / remote node finds an existing node (dedupe).
// Prefixes namespace the key spaces so a hash can never equal an id. Several keys per node on purpose: a file found
// again under a new path still matches by hash; a re-import with a MAL id matches even after a title edit.
// Keys are derived from the node, never stored, so they cannot go stale (see design rules).
export function keysOf(n) {
  const out = [];
  if (!n) return out;
  if (n.type === 'media') {
    const l = n.loc;
    if (l) out.push(`loc:${l.kind}:${l.server || ''}:${l.mount || l.handle || l.blob || l.url || ''}:${l.path || ''}`);
    if (n.source && n.source.ref) out.push('src:' + srcKey(n.source.ref));
    if (n.hash) out.push('hash:' + n.hash);
  } else if (n.type === 'work' || n.type === 'person') {
    if (n.ids) for (const [k, v] of Object.entries(n.ids)) if (v) out.push(`id:${k}:${String(v).toLowerCase()}`);
    if (n.ixKey) out.push('ix:' + n.ixKey);
    // Title keys of top-level works (alternative titles too), so files and imports find them by any of their names.
    if (n.type === 'work' && !n.parent && TITLED.has(n.kind)) for (const t of new Set([n.title, ...Object.values(n.titles || {})])) { const k = matchKey(t); if (k) out.push(`t:${n.kind}:${k}`); }
    if (n.type === 'person' && n.name) out.push('person:' + matchKey(n.name));
  } else if (n.type === 'tagdef' && n.name) {
    out.push('tag:' + matchKey(n.name));
  }
  return out;
}

// Play order of the children of a container. Key cascade: season, then specials after regular episodes of the same
// season, disc, explicit position (order > episode > absolute), finally natural title order as tie-break.
// Missing positions sort last via Infinity; the explicit branch avoids Infinity - Infinity = NaN, which would make the
// comparator inconsistent and Array.prototype.sort's result implementation-defined.
export function childOrder(a, b) {
  const s = (a.season ?? 0) - (b.season ?? 0);
  if (s) return s;
  if (!!a.special !== !!b.special) return a.special ? 1 : -1;
  const d = (a.disc ?? 1) - (b.disc ?? 1);
  if (d) return d;
  const oa = a.order ?? a.episode ?? a.absolute ?? Infinity, ob = b.order ?? b.episode ?? b.absolute ?? Infinity;
  if (oa !== ob) return oa === Infinity ? 1 : ob === Infinity ? -1 : oa - ob;
  return naturalCompare(a.title, b.title);
}

// Deep copy via JSON: nodes are plain JSON by contract (normNode), so this is exact and drops nothing that matters.
// structuredClone would also work but is absent in older runtimes this module targets.
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// Factory with closure state instead of a class: the indexes are unreachable from outside, so callers cannot bypass
// write() (design rule 1). Initial nodes are loaded without events and without undo: loading is not a change.
export function createDB({ nodes = [], rev = 0 } = {}) {
  const map = new Map();
  const byType = new Map();
  const kids = new Map();      // parent id -> Set(child ids)
  const media = new Map();     // work id -> Set(media ids)
  const keys = new Map();      // key -> Set(ids)
  const listeners = new Set();
  const log = [];
  const undoStack = [];
  let memo = new Map();
  let pending = null;          // open batch: { ops, inverse, label }
  let depth = 0;               // batch nesting; only the outermost batch commits (emit + undo step)

  // Multimap helpers. Empty sets are deleted so index size tracks live data and find() never sees an empty bucket.
  const addIdx = (m, k, v) => { if (k == null) return; let s = m.get(k); if (!s) m.set(k, (s = new Set())); s.add(v); };
  const delIdx = (m, k, v) => { if (k == null) return; const s = m.get(k); if (s) { s.delete(v); if (!s.size) m.delete(k); } };

  function index(n) {
    addIdx(byType, n.type, n.id);
    if (n.type === 'work' && n.parent) addIdx(kids, n.parent, n.id);
    if (n.type === 'media' && n.work) addIdx(media, n.work, n.id);
    for (const k of keysOf(n)) addIdx(keys, k, n.id);
  }
  function unindex(n) {
    delIdx(byType, n.type, n.id);
    if (n.type === 'work' && n.parent) delIdx(kids, n.parent, n.id);
    if (n.type === 'media' && n.work) delIdx(media, n.work, n.id);
    for (const k of keysOf(n)) delIdx(keys, k, n.id);
  }

  // First occurrence of a duplicate id wins; malformed entries are skipped, not thrown on (a damaged file still loads).
  for (const n of nodes) if (n && n.id && !map.has(n.id)) { map.set(n.id, n); index(n); }

  const db = {
    rev,
    version: 0,
    get: (id) => map.get(id) || null,
    has: (id) => map.has(id),
    all(type) {
      if (!type) return [...map.values()];
      const s = byType.get(type);
      return s ? [...s].map((id) => map.get(id)) : [];
    },
    count(type) { return type ? (byType.get(type) || { size: 0 }).size : map.size; },
    children(id) {
      const s = kids.get(id);
      return s ? [...s].map((x) => map.get(x)).filter(Boolean).sort(childOrder) : [];
    },
    mediaOf(workId) {
      const s = media.get(workId);
      return s ? [...s].map((x) => map.get(x)).filter(Boolean).sort((a, b) => (PRESENCE_RANK[b.presence] - PRESENCE_RANK[a.presence]) || (b.updated - a.updated)) : [];
    },
    // find() returns an arbitrary (insertion-order first) holder of the key; callers that must resolve ambiguity
    // (two works sharing a title) use findAll().
    find(key) { const s = keys.get(key); return s && s.size ? s.values().next().value : null; },
    findAll(key) { const s = keys.get(key); return s ? [...s] : []; },
    // Whole-cache invalidation on any change (emit replaces the Map). Coarse but correct: derived data (facts, tag
    // index) depends on arbitrary sets of nodes, and fine-grained dependency tracking would cost more than recompute.
    memo(key, fn) {
      if (memo.has(key)) return memo.get(key);
      const v = fn();
      memo.set(key, v);
      return v;
    },

    put(node, { keepTime = false } = {}) {
      if (!node || !node.id || !node.type) throw new Error('put: a node needs id and type');
      const prev = map.get(node.id) || null;
      // updated is strictly monotonic per node (prev + 1 floor): two writes in the same millisecond must still order,
      // because sync resolves conflicts by `updated` (last writer wins). keepTime is for imports / remote copies
      // whose timestamps are authoritative; note it stores the caller's object itself, not a copy.
      const n = keepTime ? node : { ...node, updated: Math.max(now(), (prev && prev.updated || 0) + 1) };
      if (!n.created) n.created = prev ? prev.created : n.updated;
      write(n.id, n, prev);
      return n;
    },
    patch(id, fields) {
      const prev = map.get(id);
      if (!prev) return null;
      const n = { ...prev };
      for (const [k, v] of Object.entries(fields)) { if (v === undefined) delete n[k]; else n[k] = v; }
      n.updated = Math.max(now(), (prev.updated || 0) + 1);
      write(id, n, prev);
      return n;
    },
    remove(id, { cascade = true } = {}) {
      const removed = [];
      // Depth-first: children and media go before their parent, so the inverse log restores parents first on undo
      // (undo replays inverses in reverse order).
      const go = (x) => {
        const n = map.get(x);
        if (!n) return;
        if (cascade && n.type === 'work') {
          for (const c of [...(kids.get(x) || [])]) go(c);
          for (const m of [...(media.get(x) || [])]) go(m);
        }
        write(x, null, n);
        removed.push(x);
      };
      db.batch(() => {
        go(id);
        // Plays have no index by work, hence a full scan; removed.includes is O(removed) per play, i.e.
        // O(plays x removed). Fine for single removals; a bulk delete of a large library would want a Set here.
        if (cascade) for (const p of db.all('play')) if (removed.includes(p.work) || removed.includes(p.ref)) { write(p.id, null, p); removed.push(p.id); }
      });
      return removed;
    },
    // Re-entrant: nested batches join the outer one (its label wins). try/finally commits even when fn throws, so
    // partial writes are still emitted and undoable; there is no rollback. Rationale: the in-memory state already
    // changed, and hiding it from listeners would desynchronise persistence from memory, which is worse.
    batch(fn, { label = '' } = {}) {
      depth++;
      if (!pending) pending = { ops: [], inverse: [], label };
      let r;
      try { r = fn(); } finally {
        depth--;
        if (depth === 0) {
          const b = pending;
          pending = null;
          if (b.ops.length) {
            if (!b.noUndo) { undoStack.push(b); if (undoStack.length > UNDO_MAX) undoStack.shift(); }
            emit(b.ops, b.origin || 'local', b.label);
          }
        }
      }
      return r;
    },
    canUndo: () => undoStack.length > 0,
    // Undo replays the inverse ops (previous versions) in reverse order through write(), so indexes, the sync log and
    // listeners treat it as an ordinary change (origin 'undo'), and peers receive the reverted state. noUndo keeps
    // the undo itself off the stack: there is no redo.
    // KNOWN DEFECT: undo() called inside an open batch overwrites `pending` and then nulls it, so the outer batch's
    // finally reads pending === null and throws on b.ops. Fix: refuse (or queue) undo while depth > 0.
    undo() {
      const b = undoStack.pop();
      if (!b) return false;
      depth++;
      pending = { ops: [], inverse: [], label: 'undo', noUndo: true, origin: 'undo' };
      try {
        for (const inv of b.inverse.slice().reverse()) {
          if (inv.op === 'put') write(inv.node.id, inv.node, map.get(inv.node.id) || null);
          else write(inv.id, null, map.get(inv.id) || null);
        }
      } finally {
        depth--;
        const p = pending;
        pending = null;
        if (p.ops.length) emit(p.ops, 'undo', 'undo');
      }
      return true;
    },
    // Remote ops are applied verbatim (nodes are expected to be normNode'd by the caller) and are not undoable:
    // undoing a peer's change locally would fight the peer. Joins an open batch if one exists.
    apply(ops, { origin = 'remote' } = {}) {
      depth++;
      pending = pending || { ops: [], inverse: [], label: origin, noUndo: true, origin };
      try {
        for (const o of ops || []) {
          if (o.op === 'put' && o.node && o.node.id) write(o.node.id, o.node, map.get(o.node.id) || null);
          else if (o.op === 'del' && o.id) write(o.id, null, map.get(o.id) || null);
        }
      } finally {
        depth--;
        if (depth === 0) {
          const p = pending;
          pending = null;
          if (p.ops.length) emit(p.ops, origin, origin);
        }
      }
    },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // Incremental sync. If the log no longer reaches back to r + 1 (trimmed, or a fresh process whose log starts
    // empty at a non-zero rev) the caller must reset: a partial answer would silently lose ops. Ops are deduplicated
    // per id and carry the *current* node, not the logged one: the peer only needs the final state.
    changesSince(r) {
      if (r >= db.rev) return { rev: db.rev, ops: [] };
      if (!log.length || log[0].rev > r + 1) return { rev: db.rev, reset: true };
      const ops = [];
      const last = new Map();
      for (const e of log) if (e.rev > r) last.set(e.id, e);
      for (const e of last.values()) ops.push(e.op === 'put' ? { op: 'put', node: map.get(e.id) || e.node } : { op: 'del', id: e.id });
      return { rev: db.rev, ops: ops.filter((o) => o.op === 'del' || o.node) };
    },
    snapshot() { return { format: 'in-html-media-db', schema: 1, rev: db.rev, nodes: [...map.values()].map(clone) }; },
  };

  // The single mutation path. next === null deletes. Records both the forward op (for listeners / sync) and the
  // inverse (for undo) in the open batch.
  function write(id, next, prev) {
    if (!pending) { db.batch(() => write(id, next, prev)); return; }
    if (prev) unindex(prev);
    if (next) { map.set(id, next); index(next); } else map.delete(id);
    pending.inverse.push(prev ? { op: 'put', node: prev } : { op: 'del', id });
    pending.ops.push(next ? { op: 'put', node: next } : { op: 'del', id });
  }

  function emit(ops, origin, label) {
    // Several writes of one id in a batch collapse into the last one. One rev per surviving op, so changesSince can
    // resume from any rev. Listener errors are caught and logged: one broken subscriber (say, a UI panel) must not
    // stop persistence, which is just another subscriber.
    const last = new Map();
    for (const o of ops) last.set(o.op === 'put' ? o.node.id : o.id, o);
    const list = [...last.values()];
    for (const o of list) {
      db.rev++;
      log.push({ rev: db.rev, op: o.op, id: o.op === 'put' ? o.node.id : o.id });
    }
    if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
    db.version++;
    memo = new Map();
    const ev = { rev: db.rev, ops: list, origin, label };
    for (const fn of listeners) { try { fn(ev); } catch (e) { (globalThis.console || {}).error?.(e); } }
  }

  return db;
}
