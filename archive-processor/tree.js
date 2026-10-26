// archive-processor/tree.js - the file tree of an open archive: folders (stored or implied by paths) with aggregated
// counts and sizes, sorting (folders first), the visible rows of the tree or of a search, and the selection of files
// (folders show none / some / all of their files selected).
// 
// Selection model: only files carry a checked flag; every folder keeps sel = number of checked files below it,
// updated incrementally along the parent chain (bump). Folder state is then O(1) (sel vs files) — rendering 50 visible
// rows never walks subtrees. Empty folders have no files to count, so they keep their own checked flag.

// Module-wide id counter: node ids stay unique across archives opened in one session.
let nid = 0;

function node(name, path, dir, parent) {
  return { id: ++nid, name, path, dir, parent, depth: parent ? parent.depth + 1 : -1, dirs: dir ? new Map() : null, list: dir ? [] : null,
    entry: null, files: 0, size: 0, packed: 0, sel: 0, open: false, checked: false, mtime: null };
}

/** Builds the tree from engine entries ({ id, path, dir, size, packed, mtime, … }). */
export function buildTree(entries) {
  const root = node('', '', true, null);
  root.open = true;
  const byId = new Map();
  // Folders are implied by paths: "a/b/c.txt" creates a and a/b even when the archive stores no folder entries.
  const dirChild = (n, name) => {
    let c = n.dirs.get(name);
    if (!c) { c = node(name, n.path ? n.path + '/' + name : name, true, n); n.dirs.set(name, c); n.list.push(c); }
    return c;
  };
  for (const e of entries) {
    const segs = e.path.split('/');
    let n = root;
    for (let i = 0; i < segs.length - 1; i++) n = dirChild(n, segs[i]);
    const name = segs[segs.length - 1];
    let leaf;
    if (e.dir) leaf = dirChild(n, name);
    else { leaf = node(name, e.path, false, n); n.list.push(leaf); } // duplicate names (ZIP, tar) stay separate rows
    leaf.entry = e;
    leaf.mtime = e.mtime;
    byId.set(e.id, leaf);
  }
  let dirs = 0;
  // One post-order pass aggregates files/size/packed bottom-up, so folder figures are ready before the first render.
  const sum = (n) => {
    if (n.dir && n.depth >= 0) dirs++;
    if (!n.dir) { n.files = 1; n.size = n.entry.size || 0; n.packed = n.entry.packed || 0; return; }
    for (const c of n.list) { sum(c); n.files += c.files; n.size += c.size; n.packed += c.packed; }
  };
  sum(root);
  // A single top folder is opened right away.
  if (root.list.length === 1 && root.list[0].dir) root.list[0].open = true;
  return { root, byId, dirs };
}

// numeric: "file2" before "file10"; sensitivity base: case- and accent-insensitive like file managers.
const COLL = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const KEYS = {
  name: (a, b) => COLL.compare(a.name, b.name),
  size: (a, b) => a.size - b.size,
  packed: (a, b) => a.packed - b.packed,
  mtime: (a, b) => (a.mtime || 0) - (b.mtime || 0),
  method: (a, b) => String((a.entry && a.entry.method) || '').localeCompare(String((b.entry && b.entry.method) || '')),
  order: (a, b) => ((a.entry && a.entry.id) ?? 1e12) - ((b.entry && b.entry.id) ?? 1e12),
};

// Folders always first; ties broken by name so the order is total and stable across sorts.
export function sortTree(root, key = 'name', dir = 1) {
  const cmp = KEYS[key] || KEYS.name;
  const f = (a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : cmp(a, b) * dir || KEYS.name(a, b));
  const walk = (n) => { if (!n.dir) return; n.list.sort(f); for (const c of n.list) walk(c); };
  walk(root);
}

/** Visible rows: the open part of the tree. */
export function treeRows(root) {
  const out = [];
  const walk = (n) => { for (const c of n.list) { out.push(c); if (c.dir && c.open) walk(c); } };
  walk(root);
  return out;
}

// Search: '*' and '?' are wildcards (matched against the name, or the path when the pattern has a '/'),
// anything else is a case-insensitive substring of the path.
// Wildcard pattern -> anchored RegExp after escaping every other metacharacter, so a user typing "(1).txt" cannot
// inject regex syntax. Pattern with "/" matches the path, else only the name (as shell globs do).
export function matcher(q) {
  const s = q.trim().toLowerCase();
  if (!s) return null;
  if (/[*?]/.test(s)) {
    const re = new RegExp('^' + s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
    return s.includes('/') ? (n) => re.test(n.path) : (n) => re.test(n.name);
  }
  return (n) => n.path.toLowerCase().includes(s);
}

/** Search rows: every matching file and folder, in tree order (sorted as the tree is). */
export function searchRows(root, match) {
  const out = [];
  const walk = (n) => { for (const c of n.list) { if (match(c)) out.push(c); if (c.dir) walk(c); } };
  walk(root);
  return out;
}

// --- selection ---------------------------------------------------------------------------------------------

function bump(n, d) { for (let p = n.parent; p; p = p.parent) p.sel += d; }

// Early return when unchanged keeps the parent counters exact: bump must run once per real change.
export function setChecked(n, on) {
  if (!n.dir) {
    if (n.checked === on) return;
    n.checked = on;
    bump(n, on ? 1 : -1);
    return;
  }
  for (const c of n.list) setChecked(c, on);
  if (n.files === 0) n.checked = on; // empty folders keep their own mark
}

/** 'all' | 'some' | 'none' for a folder (by its files; empty folders by their own mark). */
export function checkState(n) {
  if (!n.dir) return n.checked ? 'all' : 'none';
  if (n.files === 0) return n.checked ? 'all' : 'none';
  return n.sel === 0 ? 'none' : n.sel === n.files ? 'all' : 'some';
}

/** Selected entries (files, and folders that are selected as a whole so empty folders travel too). */
// Whole folders contribute their own entry id too, so empty folders are extracted; partially selected folders only contribute their checked files.
export function selection(root) {
  const ids = [];
  let size = 0, files = 0;
  const walk = (n) => {
    for (const c of n.list) {
      if (c.dir) {
        const st = checkState(c);
        if (st === 'none') continue;
        if (st === 'all' && c.entry) ids.push(c.entry.id);
        walk(c);
      } else if (c.checked) { ids.push(c.entry.id); size += c.entry.size || 0; files++; }
    }
  };
  walk(root);
  return { ids, size, files };
}

/** Every entry below a node (for "extract this folder"). */
export function entriesUnder(n) {
  const ids = [];
  const walk = (x) => { if (x.entry) ids.push(x.entry.id); if (x.dir) for (const c of x.list) walk(c); };
  walk(n);
  return ids;
}
