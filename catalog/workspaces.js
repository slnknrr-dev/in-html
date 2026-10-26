// catalog/workspaces.js - custom workspaces: several folder trees of references (works, collections, other folders'
// queries), each with its own layout, skin and view (desktop / mobile / auto). A folder holds sub-folders, explicit
// items (node ids, in order), an optional query (a virtual folder: its matches are listed after the items), tags and
// a colour / icon. Folders have ids unique within their workspace; cycles are impossible by construction (moves into
// a descendant are refused).
//
//   newWorkspace(name, fields) -> node ; createWorkspace(db, name, fields) -> stored node
//   newFolder(name, fields) -> folder { id, name, children: [], items: [], query?, tags?, color?, icon? }
//   findFolder(root, id) -> { folder, parent, index } | null ; walkFolders(root, fn(folder, depth, parent))
//   addFolder(db, wsId, parentId, name, fields) -> folder ; updateFolder(db, wsId, folderId, fields)
//   removeFolder(db, wsId, folderId) ; moveFolder(db, wsId, folderId, newParentId, index) -> boolean
//   addRefs(db, wsId, folderId, ids, { at }) ; removeRefs(db, wsId, folderId, ids) ; moveRef(db, wsId, folderId, from, to)
//   folderItems(db, ws, folderId, { recursive, now }) -> nodes (items, then query matches, unique)
//   folderPath(root, id) -> [folders from the root]
//   normWorkspaceRoot(root) -> a valid tree (ids made unique, depth <= 32, bounded sizes)
//
// Key decisions:
// - The whole tree lives inside one workspace node (`root`), not as one node per folder. A drag-and-drop move is
//   then a single atomic patch (one undo step, one sync op) and can never leave a folder half-moved across replicas.
//   The cost, rewriting the whole tree per edit, is negligible at folder-tree sizes.
// - Every edit is copy-on-write (editRoot deep-copies, mutates the copy, patches): db nodes are immutable values.
// - Folders reference nodes by id; a reference to a deleted node is silently skipped on read (folderItems), not
//   eagerly purged, so undoing the delete restores the folder entry too.

import { uid, now } from './model.js';
import { runQuery } from './query.js';

export function newFolder(name = '', fields = {}) {
  return { id: uid(), name: String(name || ''), children: [], items: [], ...fields };
}

export function newWorkspace(name = '', fields = {}) {
  const t = now();
  return { id: uid(), type: 'workspace', name: String(name || ''), created: t, updated: t, tags: [], view: 'auto', root: newFolder(''), ...fields };
}
export const createWorkspace = (db, name, fields) => db.put(newWorkspace(name, fields));

// Recursive traversal is safe here: trees pass through normWorkspaceRoot (depth <= 32) on import, and moves cannot
// create cycles, so the stack depth is bounded.
export function walkFolders(root, fn, depth = 0, parent = null) {
  if (!root) return;
  fn(root, depth, parent);
  for (const c of root.children || []) walkFolders(c, fn, depth + 1, root);
}

export function findFolder(root, id) {
  let hit = null;
  const go = (f, parent) => {
    if (hit) return;
    if (f.id === id) { hit = { folder: f, parent, index: parent ? parent.children.indexOf(f) : -1 }; return; }
    for (const c of f.children || []) go(c, f);
  };
  if (root) go(root, null);
  return hit;
}

export function folderPath(root, id) {
  const path = [];
  const go = (f) => { path.push(f); if (f.id === id) return true; for (const c of f.children || []) if (go(c)) return true; path.pop(); return false; };
  return root && go(root) ? path : [];
}

// Repair, not reject: an imported tree with duplicate or malformed ids gets fresh ids, overdeep or excess folders
// are dropped, unknown fields discarded. Duplicate ids must be fixed because findFolder returns the first match,
// making the second folder unreachable for every edit. The 20 000-folder cap bounds work on hostile input.
export function normWorkspaceRoot(root) {
  const seen = new Set();
  let count = 0;
  const fix = (f, depth) => {
    if (!f || typeof f !== 'object' || depth > 32 || ++count > 20000) return null;
    let id = typeof f.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(f.id) ? f.id : uid();
    if (seen.has(id)) id = uid();
    seen.add(id);
    const out = { id, name: String(f.name || '').slice(0, 300), children: [], items: [] };
    for (const c of Array.isArray(f.children) ? f.children : []) { const x = fix(c, depth + 1); if (x) out.children.push(x); }
    out.items = (Array.isArray(f.items) ? f.items : []).filter((x) => typeof x === 'string' && x.length <= 80).slice(0, 50000);
    if (typeof f.query === 'string' && f.query) out.query = f.query.slice(0, 4000);
    if (Array.isArray(f.tags) && f.tags.length) out.tags = f.tags.filter((x) => typeof x === 'string').slice(0, 100);
    for (const k of ['color', 'icon', 'sort']) if (typeof f[k] === 'string' && f[k]) out[k] = f[k].slice(0, 60);
    if (f.collapsed === true) out.collapsed = true;
    return out;
  };
  return fix(root, 0) || newFolder('');
}

// Callback protocol: return false = abort (nothing written, result null); undefined = write, return the new root;
// anything else = write, return that value. JSON round-trip is an exact deep copy here (the tree is plain JSON).
function editRoot(db, wsId, fn) {
  const ws = db.get(wsId);
  if (!ws || ws.type !== 'workspace') return null;
  const root = JSON.parse(JSON.stringify(ws.root || newFolder('')));
  const r = fn(root);
  if (r === false) return null;
  db.patch(wsId, { root });
  return r === undefined ? root : r;
}

export function addFolder(db, wsId, parentId, name, fields = {}) {
  const f = newFolder(name, fields);
  return editRoot(db, wsId, (root) => {
    const p = parentId ? findFolder(root, parentId) : { folder: root };
    if (!p) return false;
    p.folder.children.push(f);
    return f;
  });
}

export const updateFolder = (db, wsId, folderId, fields) => editRoot(db, wsId, (root) => {
  const hit = findFolder(root, folderId);
  if (!hit) return false;
  for (const [k, v] of Object.entries(fields)) if (k !== 'id' && k !== 'children') { if (v === undefined) delete hit.folder[k]; else hit.folder[k] = v; }
  return hit.folder;
});

export const removeFolder = (db, wsId, folderId) => editRoot(db, wsId, (root) => {
  const hit = findFolder(root, folderId);
  if (!hit || !hit.parent) return false;
  hit.parent.children.splice(hit.index, 1);
});

// The root cannot move (no parent). Cycle guard: searching the moved folder's own subtree for the target catches
// both "into itself" and "into a descendant". `index` is applied after removal, so when reordering within the same
// parent, an index past the old position lands one slot earlier than in the pre-removal list; UIs should pass
// the post-removal index.
export function moveFolder(db, wsId, folderId, newParentId, index = -1) {
  return !!editRoot(db, wsId, (root) => {
    const hit = findFolder(root, folderId);
    if (!hit || !hit.parent) return false;
    const target = newParentId ? findFolder(root, newParentId) : { folder: root };
    if (!target || findFolder(hit.folder, target.folder.id)) return false; // into itself or a descendant
    hit.parent.children.splice(hit.index, 1);
    const kids = target.folder.children;
    kids.splice(index < 0 || index > kids.length ? kids.length : index, 0, hit.folder);
    return true;
  });
}

// Unlike playlists, a folder holds each ref at most once (set semantics): it is a filing system, not a play order.
export const addRefs = (db, wsId, folderId, ids, { at = -1 } = {}) => editRoot(db, wsId, (root) => {
  const hit = folderId ? findFolder(root, folderId) : { folder: root };
  if (!hit) return false;
  const items = hit.folder.items || (hit.folder.items = []);
  const add = ids.filter((x) => !items.includes(x));
  if (at < 0 || at >= items.length) items.push(...add); else items.splice(at, 0, ...add);
  return hit.folder;
});

export const removeRefs = (db, wsId, folderId, ids) => editRoot(db, wsId, (root) => {
  const hit = folderId ? findFolder(root, folderId) : { folder: root };
  if (!hit) return false;
  const drop = new Set(ids);
  hit.folder.items = (hit.folder.items || []).filter((x) => !drop.has(x));
  return hit.folder;
});

export const moveRef = (db, wsId, folderId, from, to) => editRoot(db, wsId, (root) => {
  const hit = folderId ? findFolder(root, folderId) : { folder: root };
  if (!hit || from < 0 || from >= (hit.folder.items || []).length) return false;
  const [x] = hit.folder.items.splice(from, 1);
  hit.folder.items.splice(Math.max(0, Math.min(hit.folder.items.length, to)), 0, x);
  return hit.folder;
});

// Explicit items first (the user's order), then query matches not already listed, then (recursive) sub-folders
// depth-first. One `seen` set across the whole walk, so a node filed in several sub-folders appears once.
export function folderItems(db, ws, folderId, { recursive = false, now: nowMs = Date.now() } = {}) {
  const root = ws && ws.root;
  const hit = folderId ? findFolder(root, folderId) : root ? { folder: root } : null;
  if (!hit) return [];
  const out = [];
  const seen = new Set();
  const take = (f) => {
    for (const id of f.items || []) { const n = db.get(id); if (n && !seen.has(id)) { seen.add(id); out.push(n); } }
    if (f.query) for (const w of runQuery(db, f.query, { now: nowMs, sort: f.sort || 'title' })) if (!seen.has(w.id)) { seen.add(w.id); out.push(w); }
    if (recursive) for (const c of f.children || []) take(c);
  };
  take(hit.folder);
  return out;
}
