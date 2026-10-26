// knowledge-processor/state.js - the editor's state: the open knowledge base, the selection, undo / redo, autosave,
// change notifications, and the 451 session (envelopes the author unlocked: their keys and decrypted payloads, edited
// in clear and sealed again on every change).
//
//   S                                   the state object (see below)
//   on(event, fn) / emit(event, info)   'change' (info: { structure, kb }), 'select', 'saved', 'kb' (another base opened)
//   commit(fn, { key, structure })       mutates S.kb through fn(kb); `key` coalesces quick edits of one field into one
//                                       undo step; structure: panels must re-render (not just the preview)
//   undo() / redo() / canUndo() / canRedo()
//   target() -> { obj, kind, secret }   what the page editor edits: the page itself, a secret page's payload or a
//                                       secret variant's payload (obj has the page fields: title, slug, versions, …)
//   commitTarget(fn, opts)              commit(fn(targetObj)) + sealing of a payload
//   setKB(kb), select({ pageId, sid, versionId, blockId })
import { normKB, pageById } from './model.js';
import { openWith, sealWith } from './secret.js';
import { putKB } from './store.js';

// One mutable singleton instead of a store library: the editor is one page with one open base; modules read
// S directly and react to events. Invariant: all mutation of S.kb goes through commit(), which is what keeps
// undo, autosave and re-render consistent.
export const S = {
  kb: null,
  pageId: '',
  sid: '',            // secret entry edited ('' = the public page)
  versionId: '',
  blockId: '',
  unlocked: new Map(), // secret entry id -> { keys, payload }
  saving: false,
  savedAt: 0,
  dirty: false,
  readOnly: false,
};

// Each listener isolated in try/catch: one broken panel must not stop the others (or the save) from updating.
// on() returns an unsubscribe function, so callers do not need to keep the fn reference.
const listeners = new Map();
export function on(ev, fn) { (listeners.get(ev) || listeners.set(ev, new Set()).get(ev)).add(fn); return () => listeners.get(ev).delete(fn); }
export function emit(ev, info) { for (const fn of listeners.get(ev) || []) { try { fn(info); } catch (e) { console.error(e); } } }

// Undo by whole-KB JSON snapshots, not by inverse operations: trivially correct for any edit, including
// encrypted payloads, at the cost of memory (80 copies). Inverse ops would need one per edit kind and are a
// constant source of bugs. Strings are immutable, so a snapshot cannot be mutated later.
const MAX_UNDO = 80;
let past = [], future = [], lastKey = '', lastAt = 0;
const snap = () => JSON.stringify(S.kb);

// History is per base: undo must never cross into a previously opened KB. Unlocked secrets are dropped too:
// keys of one base are meaningless (and should not linger) for another.
export function setKB(kb) {
  S.kb = kb;
  past = []; future = []; lastKey = '';
  S.unlocked = new Map();
  S.pageId = kb.pages.some((p) => p.id === kb.home) ? kb.home : (kb.pages[0] || {}).id || '';
  S.sid = ''; S.versionId = ''; S.blockId = '';
  S.dirty = false;
  emit('kb', {});
  emit('change', { structure: true });
}

// Coalescing: consecutive commits with the same key within 1.2 s share one undo step (typing a title makes one
// step, not one per character). The snapshot is taken BEFORE fn, so the step restores the state prior to the
// first keystroke of the burst. Any new commit clears redo (standard linear history).
export function commit(fn, { key = '', structure = false } = {}) {
  if (!S.kb || S.readOnly) return;
  const now = Date.now();
  const coalesce = key && key === lastKey && now - lastAt < 1200;
  if (!coalesce) { past.push(snap()); if (past.length > MAX_UNDO) past.shift(); }
  future = [];
  lastKey = key; lastAt = now;
  fn(S.kb);
  S.kb.updated = new Date().toISOString();
  S.dirty = true;
  scheduleSave();
  emit('change', { structure });
}

// Restoring replaces S.kb with a fresh object, so every unlocked payload is re-decrypted from the restored
// envelope (the clear-text copy must match the ciphertext that will be saved). Entries whose envelope vanished
// are forgotten. `media` is dropped from the payload because reseal re-attaches it.
function restore(json) {
  const remote = S.kb.remote;
  S.kb = normKB(JSON.parse(json));
  if (remote) S.kb.remote = remote;
  // Unlocked payloads follow the restored envelopes.
  for (const [sid, u] of S.unlocked) {
    const e = findSecret(sid);
    const p = e && openWith(u.keys, e.secret.env);
    if (p) { delete p.media; u.payload = p; } else S.unlocked.delete(sid);
  }
  if (!pageById(S.kb, S.pageId)) S.pageId = S.kb.home;
  if (S.sid && !findSecret(S.sid)) S.sid = '';
  lastKey = '';
  S.dirty = true;
  scheduleSave();
  emit('change', { structure: true });
}
export function undo() { if (!past.length) return; future.push(snap()); restore(past.pop()); }
export function redo() { if (!future.length) return; past.push(snap()); restore(future.pop()); }
export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;

// ---- saving
// Debounced autosave (700 ms): bursts of edits produce one IndexedDB write. `savers` are extra sinks (server
// sync) registered by other modules, run after the local write so local persistence never waits on network.
let saveTimer = 0;
const savers = [];
export function addSaver(fn) { savers.push(fn); }
export function scheduleSave(ms = 700) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, ms);
}
// `kb === S.kb` guards against a base switch during the await: a finished save of the old base must not clear
// the new base's dirty flag.
// KNOWN DEFECT: commit() mutates S.kb in place, so kb === S.kb stays true across edits made while putKB/savers
// are awaited. Those edits set dirty=true and schedule a save, then this function resets dirty=false, and the
// scheduled saveNow returns early on !S.dirty: the latest edits are not persisted until the next commit.
// Two saveNow calls can also overlap (no in-flight guard). Fix: snapshot a change counter before saving and
// clear dirty only if it is unchanged; chain saves through a single in-flight promise.
export async function saveNow() {
  clearTimeout(saveTimer);
  if (!S.kb || !S.dirty) return;
  S.saving = true;
  const kb = S.kb;
  try {
    await putKB(kb);
    for (const fn of savers) await fn(kb);
    if (kb === S.kb) { S.dirty = false; S.savedAt = Date.now(); }
  } catch (e) {
    emit('error', e);
  } finally {
    S.saving = false;
    emit('saved', {});
  }
}

// ---- selection
// Selection cascades downward: changing the page resets secret, version and block; changing the secret resets
// version and block. Prevents a stale blockId pointing into a different page.
export function select(o = {}) {
  if (o.pageId !== undefined && o.pageId !== S.pageId) { S.pageId = o.pageId; S.sid = ''; S.versionId = ''; S.blockId = ''; }
  if (o.sid !== undefined && o.sid !== S.sid) { S.sid = o.sid; S.versionId = ''; S.blockId = ''; }
  if (o.versionId !== undefined) { S.versionId = o.versionId; S.blockId = ''; }
  if (o.blockId !== undefined) S.blockId = o.blockId;
  emit('select', o);
}

export const curPage = () => (S.kb ? pageById(S.kb, S.pageId) : null);

export function findSecret(sid) {
  for (const p of S.kb ? S.kb.pages : []) {
    const i = (p.secrets || []).findIndex((s) => s.id === sid);
    if (i >= 0) return { page: p, secret: p.secrets[i], index: i };
  }
  return null;
}

// The object the page editor edits.
// Three editing targets behind one shape { obj, kind }: the public page, the decrypted payload of a secret
// page, or of a secret variant. 'locked' (obj null) means the author has not entered the password yet; the UI
// shows an unlock form instead of fields. A secret page has exactly one envelope (secrets[0]).
export function target() {
  const page = curPage();
  if (!page) return null;
  if (page.access === 'secret') {
    const s = page.secrets[0];
    const u = s && S.unlocked.get(s.id);
    return u ? { obj: u.payload, kind: 'secretPage', secret: s, page } : { obj: null, kind: 'locked', secret: s, page };
  }
  if (S.sid) {
    const s = (page.secrets || []).find((x) => x.id === S.sid);
    const u = s && S.unlocked.get(s.id);
    if (s) return u ? { obj: u.payload, kind: 'variant', secret: s, page } : { obj: null, kind: 'locked', secret: s, page };
  }
  return { obj: page, kind: 'page', page };
}

// Hooks set by other modules: payloadMedia(payload) -> { id: meta + base64 d } | null (secret media sealed along).
// Hook instead of import: the media module depends on state.js, so importing it here would be circular.
export const hooks = { payloadMedia: null };

// Seals the payload of an unlocked secret entry into its envelope (inside a commit).
// Every edit of a clear-text payload re-encrypts immediately (fresh IV per seal): the stored KB never contains
// the clear text, so autosave and export cannot leak it. Cost: one AES-GCM pass per commit; the slow KDF is
// not repeated (keys are cached in S.unlocked).
export function reseal(kb, sid) {
  const u = S.unlocked.get(sid);
  if (!u) return;
  const media = hooks.payloadMedia ? hooks.payloadMedia(u.payload) : null;
  const payload = media ? { ...u.payload, media } : u.payload;
  for (const p of kb.pages) for (const s of p.secrets || []) if (s.id === sid) s.env = sealWith(u.keys, payload);
}

// For a payload target, fn mutates the cached clear payload (tg.obj), then the envelope is resealed inside the
// same commit, so the undo snapshot pairs with consistent ciphertext. `updated` is bumped on both the
// captured page object and the one found in kb.
export function commitTarget(fn, opts = {}) {
  const tg = target();
  if (!tg || !tg.obj) return;
  commit((kb) => {
    if (tg.kind === 'page') fn(pageById(kb, tg.page.id));
    else {
      fn(tg.obj);
      tg.page.updated = new Date().toISOString();
      const p = pageById(kb, tg.page.id);
      if (p) p.updated = tg.page.updated;
      reseal(kb, tg.secret.id);
    }
  }, opts);
}

// The edited version of the target (by S.versionId, else the first).
export function curVersion(obj) {
  const vs = (obj && obj.versions) || [];
  return vs.find((v) => v.id === S.versionId) || vs[0] || null;
}
