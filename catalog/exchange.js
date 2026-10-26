// catalog/exchange.js - export and import: the descriptive tree (works, media descriptions, collections,
// workspaces, tags, skins — without files and without machine-specific locations) and the whole database (every
// node, the play history, optionally the blob store in a ZIP), with a merge on import.
//
// Merge: an incoming node with a known id is the same node; an unknown id is matched by its keys (source reference,
// external ids such as MyAnimeList, file hash, index key, title key of a top-level work), so trees exported from
// another catalogue merge into existing works instead of duplicating them. Policies for nodes present on both sides:
//   'newer'   the later `updated` wins (default); tags are united, tracking and plays are kept when the winner lacks them
//   'keep'    local nodes stay, only new nodes are added
//   'theirs'  incoming nodes replace local ones
//   'copy'    every incoming node gets a new id (an independent copy; references are remapped)
// References (parent, work, collection items, group members, workspace items, covers of frames, plays) follow the id
// mapping.
//
//   TREE_FORMAT, DB_FORMAT
//   exportTree(db, { ids, locations = false, history = false, generator }) -> { format, version, exported, nodes }
//   exportDB(db, { generator }) -> { format, schema, rev, exported, nodes }
//   async exportZip(db, { blobs: { list(): ids, get(id): { type, bytes } | Promise }, tree = false }) -> Uint8Array
//   async readExchange(input: string | Uint8Array | ArrayBuffer) -> { format, data, blobs: Map(id -> { type, bytes }) }
//   importData(db, data, { policy = 'newer', locations = true }) -> { added, updated, kept, matched, skipped, idMap }
//   subtreeIds(db, ids) -> Set   (the ids, their descendants and media, their containers)

// Key decisions:
// - Two formats on purpose. The tree is portable knowledge (shareable with another person or machine: no paths,
//   no blob refs, no resume positions); the DB export is a backup of this replica, byte-for-byte restorable.
// - Every imported node goes through normNode first: an export file is untrusted input regardless of who made it.
// - Identity before policy: phase 1 decides which local node (if any) each incoming node *is*; phase 2 applies the
//   policy in one batch (one undo step for the whole import). Separating them lets references be remapped before
//   any write, so a child never points at an id that is about to be replaced.

import { normNode, uid, now } from './model.js';
import { keysOf } from './db.js';
import { readZip, writeZip } from '../zip/zip.js';

export const TREE_FORMAT = 'in-html-media-tree';
export const DB_FORMAT = 'in-html-media-db';
// Types meaningful outside this replica. 'source' (index rules with local paths), 'play' (personal history) and
// 'setting' are opt-in or excluded.
const TREE_TYPES = new Set(['work', 'media', 'person', 'collection', 'workspace', 'tagdef', 'skin', 'layout']);

// Closure of a selection for partial export: descendants and media (down), members of collections / workspaces,
// then every ancestor of everything collected (up), so an exported track arrives with its album and the import
// can rebuild the hierarchy. `out` doubles as the visited set, which also makes collection cycles terminate.
export function subtreeIds(db, ids) {
  const out = new Set();
  const down = (id) => {
    if (out.has(id)) return;
    const n = db.get(id);
    if (!n) return;
    out.add(id);
    if (n.type === 'work') { for (const c of db.children(id)) down(c.id); for (const m of db.mediaOf(id)) out.add(m.id); }
    if (n.type === 'collection') { for (const i of n.items || []) down(typeof i === 'string' ? i : i.ref); for (const c of n.children || []) down(c); }
    if (n.type === 'workspace') { const walk = (f) => { for (const i of f.items || []) down(i); for (const c of f.children || []) walk(c); }; if (n.root) walk(n.root); }
  };
  for (const id of ids) down(id);
  for (const id of [...out]) { let p = db.get(id); for (let g = 0; p && p.parent && g < 8; g++) { out.add(p.parent); p = db.get(p.parent); } }
  return out;
}

const clone = (v) => JSON.parse(JSON.stringify(v));

// Removes everything that only makes sense on this machine: file locs (but not public url locs), the index source,
// local subtitle files, resume state, and covers stored as blobs / sidecar files / frames. Presence is downgraded
// accordingly, and ext.hadFile records that a file existed, so the receiver can show "you may own this".
// Works on a clone: export must never mutate db nodes.
function stripLocations(n) {
  const x = clone(n);
  if (x.type === 'media') {
    if (x.loc && x.loc.kind !== 'url') {
      delete x.loc;
      x.presence = x.source ? 'source' : 'nominal';
      x.ext = { ...(x.ext || {}), hadFile: true };
    }
    delete x.sourceId;
    for (const s of x.subs || []) if (s.loc && s.loc.kind !== 'url') delete s.loc;
    delete x.position; delete x.positionAt; delete x.missing;
  }
  if (x.cover && (x.cover.blob || x.cover.loc || x.cover.frame)) delete x.cover;
  return x;
}

export function exportTree(db, { ids = null, locations = false, history = false, generator = 'in-html' } = {}) {
  const set = ids ? subtreeIds(db, ids) : null;
  const nodes = [];
  const usedTags = new Set();
  for (const n of db.all()) {
    if (set && !set.has(n.id)) continue;
    if (!TREE_TYPES.has(n.type) && !(history && n.type === 'play') && !(locations && n.type === 'source')) continue;
    if (n.type === 'play' && set && !set.has(n.work)) continue;
    nodes.push(locations ? clone(n) : stripLocations(n));
    for (const t of n.tags || []) usedTags.add(String(t).toLowerCase());
  }
  // Partial export: bring the definitions of tags the selection uses, so aliases / colours survive the trip.
  // Matching is by lower-cased raw name, not tagKey, so 'Genre: Rock' vs 'genre:rock' or a used descendant
  // ('genre:rock/punk' of a defined 'genre:rock') is missed; tagKey(...) on both sides would be the robust match.
  if (set) {
    const have = new Set(nodes.map((x) => x.id));
    for (const d of db.all('tagdef')) if (!have.has(d.id) && usedTags.has(String(d.name).toLowerCase())) nodes.push(clone(d));
  }
  return { format: TREE_FORMAT, version: 1, exported: new Date(now()).toISOString(), generator, locations, nodes };
}

export function exportDB(db, { generator = 'in-html' } = {}) {
  const s = db.snapshot();
  return { format: DB_FORMAT, schema: 1, rev: s.rev, exported: new Date(now()).toISOString(), generator, nodes: s.nodes };
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'video/webm': 'webm', 'video/mp4': 'mp4', 'audio/webm': 'weba', 'text/plain': 'txt' };

// ZIP layout: tree.json | db.json, blobs/<id>.<ext>, manifest.json (blob id -> entry name, type). Already-compressed
// media (JPEG, PNG, WebP, GIF, MP3, Ogg, any video) are STOREd: deflating them again costs CPU and gains ~nothing.
// WAV, SVG and text are deflated. Blob access is injected (list / get) so the same code serves IndexedDB and disk.
export async function exportZip(db, { blobs = null, tree = false, generator = 'in-html' } = {}) {
  const data = tree ? exportTree(db, { generator }) : exportDB(db, { generator });
  const files = [{ name: tree ? 'tree.json' : 'db.json', data: JSON.stringify(data) }];
  const manifest = [];
  if (blobs) {
    for (const id of await blobs.list()) {
      const b = await blobs.get(id);
      if (!b || !b.bytes) continue;
      const name = `blobs/${id}.${EXT[b.type] || 'bin'}`;
      files.push({ name, data: b.bytes instanceof Uint8Array ? b.bytes : new Uint8Array(b.bytes), store: /^(image\/(jpeg|png|webp|gif)|audio\/(mpeg|ogg)|video\/)/.test(b.type || '') });
      manifest.push({ id, type: b.type || 'application/octet-stream', name, size: b.bytes.byteLength || b.bytes.length });
    }
  }
  files.push({ name: 'manifest.json', data: JSON.stringify({ format: data.format, generator, blobs: manifest }) });
  return writeZip(files);
}

// Format sniffing by magic bytes ('PK' = ZIP), else UTF-8 JSON; a leading BOM (U+FEFF) is stripped because
// JSON.parse rejects it and Windows editors add it. Blob ids from the manifest are whitelisted before use since they
// become storage keys. No size limit on archive entries: importing a hostile ZIP (decompression bomb) could exhaust
// memory; acceptable only because imports are user-initiated with user-chosen files.
export async function readExchange(input) {
  const blobs = new Map();
  let text = null;
  if (typeof input === 'string') text = input;
  else {
    const b = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (b[0] === 0x50 && b[1] === 0x4b) {
      const entries = readZip(b);
      const byName = new Map(entries.map((e) => [e.name, e]));
      const main = byName.get('db.json') || byName.get('tree.json') || entries.find((e) => e.name.endsWith('.json') && e.name !== 'manifest.json');
      if (!main) throw new Error('no catalogue in the archive');
      text = await main.text();
      const man = byName.get('manifest.json');
      if (man) {
        const m = JSON.parse(await man.text());
        for (const x of m.blobs || []) { const e = byName.get(x.name); if (e && /^[A-Za-z0-9_.-]{1,80}$/.test(x.id)) blobs.set(x.id, { type: x.type, bytes: await e.data() }); }
      }
    } else text = new TextDecoder().decode(b);
  }
  const data = JSON.parse(text.replace(/^﻿/, ''));
  if (!data || !Array.isArray(data.nodes)) throw new Error('not a catalogue export');
  return { format: data.format || TREE_FORMAT, data, blobs };
}

// Reference fields of a node, mapped through `map` (old id -> new id). Mutates n (callers pass a clone). Every field
// that holds a node id must be listed here; a forgotten one leaves a dangling reference after 'copy' imports or key
// matches. Ids not in the map pass through unchanged (same-id identity or references to existing local nodes).
function remap(n, map) {
  const m = (id) => (typeof id === 'string' && map.has(id) ? map.get(id) : id);
  if (n.parent) n.parent = m(n.parent);
  if (n.work) n.work = m(n.work);
  if (n.ref) n.ref = m(n.ref);
  if (Array.isArray(n.items)) n.items = n.items.map((i) => (typeof i === 'string' ? m(i) : { ...i, ref: m(i.ref) }));
  if (Array.isArray(n.children) && n.type === 'collection') n.children = n.children.map(m);
  if (n.cover && n.cover.frame) n.cover.frame.media = m(n.cover.frame.media);
  if (n.type === 'workspace' && n.root) { const walk = (f) => { f.items = (f.items || []).map(m); (f.children || []).forEach(walk); }; walk(n.root); }
  if (n.sourceId) n.sourceId = m(n.sourceId);
  return n;
}

// 'newer' when incoming wins: take incoming, but never lose local-only knowledge: tags are united, tracking kept if
// the winner has none, play counters take the max (plays only grow), and a local file location / resume position
// survive (an incoming tree export has none by design, which must not unlink the user's file).
function mergeNodes(local, incoming) {
  const out = { ...incoming };
  const tags = new Set([...(local.tags || []), ...(incoming.tags || [])]);
  out.tags = [...tags];
  if (!out.track && local.track) out.track = local.track;
  if ((local.plays || 0) > (out.plays || 0)) out.plays = local.plays;
  if ((local.lastPlayed || 0) > (out.lastPlayed || 0)) out.lastPlayed = local.lastPlayed;
  if (local.type === 'media') {
    if (local.loc && !out.loc) { out.loc = local.loc; out.presence = local.presence; }
    if (local.position && !out.position) out.position = local.position;
  }
  if (local.locked && !out.locked) out.locked = local.locked;
  out.id = local.id;
  return out;
}

// 'newer' when local wins: add only what local lacks. External ids merge with local values winning on conflict;
// a minimal patch (or null) avoids bumping `updated` on nodes that gained nothing, which would otherwise make them
// look newer on the next sync and win conflicts they should not.
function fillMissing(local, incoming) {
  const patch = {};
  const tags = [...new Set([...(local.tags || []), ...(incoming.tags || [])])];
  if (tags.length !== (local.tags || []).length) patch.tags = tags;
  if (incoming.ids) { const ids = { ...incoming.ids, ...(local.ids || {}) }; if (JSON.stringify(ids) !== JSON.stringify(local.ids || {})) patch.ids = ids; }
  for (const k of ['track', 'lyrics', 'description', 'cover', 'titles', 'people', 'year', 'source']) if (local[k] === undefined && incoming[k] !== undefined) patch[k] = incoming[k];
  return Object.keys(patch).length ? patch : null;
}

export function importData(db, data, { policy = 'newer', locations = true } = {}) {
  const raw = (data && data.data ? data.data : data).nodes || [];
  const nodes = raw.map(normNode).filter(Boolean);
  const report = { added: 0, updated: 0, kept: 0, matched: 0, skipped: raw.length - nodes.length, idMap: {} };
  const map = new Map();
  const localOf = new Map();
  // 1. identity: same id, else same keys (only nodes whose type is the same)
  //    Works must also agree on kind: a movie and a show titled alike share a title key prefix only if kinds match
  //    anyway, but an id:mal key can be shared by a show and its season. loc: keys are skipped when locations are
  //    not imported (a path on another machine proves nothing).
  // KNOWN DEFECT: an incoming id that exists locally with a *different* type and no key match is not remapped, so
  //    phase 2 db.put()s it over the unrelated local node. Fix: when db.has(n.id) and types differ, map.set(n.id, uid()).
  for (const n of nodes) {
    if (policy === 'copy') { map.set(n.id, uid()); continue; }
    const local = db.get(n.id);
    if (local && local.type === n.type) { localOf.set(n.id, local); continue; }
    let hit = null;
    for (const k of keysOf(n)) {
      if (k.startsWith('loc:') && !locations) continue;
      const id = db.find(k);
      const cand = id && db.get(id);
      if (cand && cand.type === n.type && (n.type !== 'work' || cand.kind === n.kind)) { hit = cand; break; }
    }
    if (hit) { map.set(n.id, hit.id); localOf.set(n.id, hit); report.matched++; }
  }
  db.batch(() => {
    for (const n0 of nodes) {
      const n = remap(clone(n0), map);
      if (map.has(n0.id) && policy === 'copy') n.id = map.get(n0.id);
      if (!locations && n.type === 'media' && n.loc && n.loc.kind !== 'url') { delete n.loc; n.presence = n.source ? 'source' : 'nominal'; }
      const local = localOf.get(n0.id);
      // keepTime: imported `updated` stamps are kept so the 'newer' comparison stays meaningful on later imports.
      if (!local) { db.put(n, { keepTime: true }); report.added++; continue; }
      n.id = local.id;
      const take = policy === 'theirs' || (policy === 'newer' && (n.updated || 0) > (local.updated || 0));
      if (!take) {
        // The local node stays; under 'newer' it still gains what only the incoming side knows (tags, ids, tracking…).
        const add = policy === 'newer' ? fillMissing(local, n) : null;
        if (add) { db.patch(local.id, add); report.updated++; } else report.kept++;
        continue;
      }
      db.put(policy === 'theirs' ? n : mergeNodes(local, n), { keepTime: true });
      report.updated++;
    }
  }, { label: 'import' });
  report.idMap = Object.fromEntries(map);
  return report;
}
