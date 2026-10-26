// catalog/collections.js - collections: manual playlists, smart playlists, mood playlists, groups (collections of
// collections) and libraries (a filtered view of the catalogue: domains, index sources, a query).
//
//   COLLECTION_KINDS = ['playlist', 'smart', 'mood', 'group', 'library']
//   newCollection(kind, fields) -> node (not stored)       createCollection(db, kind, fields) -> stored node
//   itemsOf(db, coll, { now, seed, expand = true }) -> works   (manual items, smart results, mood mix for the current
//                                                       time of day, a group's member collections in order, a
//                                                       library's matching works; expand: containers -> leaves)
//   addItems(db, id, workIds, { at }) / removeItems(db, id, positions) / moveItem(db, id, from, to) /
//   dedupeItems(db, id) / setItems(db, id, workIds)
//   collectionDuration(db, coll) -> seconds ; coverSources(db, coll, n = 4) -> up to n work ids with covers (collage)
//   groupMembers(db, group) -> collections ; collectionsOf(db, workId) -> manual collections containing it
//
// Key decisions:
// - Only playlists store work references; every other kind is a *rule* evaluated on read (itemsOf). Storing results
//   of a smart list would go stale with every catalogue change.
// - Playlist items are objects { ref, added } (legacy plain-string refs still accepted via refOf), so per-entry data
//   can be added without a migration, and the same work may appear twice at different positions.
// - Edits address items by *position*, not by ref, for the same reason: refs are not unique within a playlist.

import { uid, now } from './model.js';
import { facts } from './facts.js';
import { runQuery } from './query.js';
import { resolveSmart, expandForPlay, timeOfDay, moodQuery } from './smart.js';

export const COLLECTION_KINDS = ['playlist', 'smart', 'mood', 'group', 'library'];

// Caller fields override defaults, but type and kind are forced last: an unknown kind degrades to 'playlist'.
export function newCollection(kind, fields = {}) {
  const t = now();
  const base = { id: uid(), type: 'collection', kind: COLLECTION_KINDS.includes(kind) ? kind : 'playlist', name: '', created: t, updated: t, tags: [] };
  if (base.kind === 'playlist') base.items = [];
  if (base.kind === 'group') base.children = [];
  if (base.kind === 'smart' || base.kind === 'library') base.query = '';
  return { ...base, ...fields, type: 'collection', kind: base.kind };
}

export const createCollection = (db, kind, fields) => db.put(newCollection(kind, fields));

const refOf = (i) => (typeof i === 'string' ? i : i && i.ref);

export function itemsOf(db, coll, { now: nowMs = Date.now(), seed = null, expand = true } = {}) {
  if (!coll) return [];
  switch (coll.kind) {
    case 'playlist': {
      const list = (coll.items || []).map((i) => db.get(refOf(i))).filter(Boolean);
      return expand ? expandForPlay(db, list, { playable: false }) : list;
    }
    case 'smart': return resolveSmart(db, coll, { now: nowMs, seed });
    // A mood list is a smart list whose query is ANDed with the time-of-day query (adjacent groups in the query
    // language are an implicit AND); each part is parenthesised so an OR inside the user's query cannot leak.
    case 'mood': {
      const tod = coll.tod && coll.tod !== 'auto' ? coll.tod : timeOfDay(new Date(nowMs));
      const q = [coll.query, moodQuery(tod)].filter(Boolean).map((x) => `(${x})`).join(' ');
      return resolveSmart(db, { ...coll, query: q, kinds: coll.kinds || ['track'], pick: coll.pick || 'random', spread: coll.spread || 'artist', limit: coll.limit || { minutes: 60 } }, { now: nowMs, seed });
    }
    case 'group': {
      const out = [];
      const seen = new Set();
      for (const c of groupMembers(db, coll)) for (const w of itemsOf(db, c, { now: nowMs, seed, expand })) if (!seen.has(w.id)) { seen.add(w.id); out.push(w); }
      return out;
    }
    case 'library': {
      const f = coll.filter || {};
      const domains = Array.isArray(f.domains) && f.domains.length ? f.domains : null;
      const sources = Array.isArray(f.sources) && f.sources.length ? new Set(f.sources) : null;
      let list = runQuery(db, coll.query || '', { domains, now: nowMs });
      if (sources) list = list.filter((w) => db.mediaOf(w.id).some((m) => sources.has(m.sourceId)) || db.children(w.id).some((c) => db.mediaOf(c.id).some((m) => sources.has(m.sourceId))));
      return list;
    }
    default: return [];
  }
}

// Members in stored order, deduped, excluding the group itself (`seen.add` returns the Set, truthy, so it doubles as
// the filter's "keep" result).
// KNOWN DEFECT: only self-membership is excluded. Group A containing group B containing A makes itemsOf recurse
// forever (stack overflow). Fix: thread a visited Set of group ids through itemsOf's 'group' case.
export function groupMembers(db, group) {
  const seen = new Set([group.id]);
  return (group.children || []).map((id) => db.get(id)).filter((c) => c && c.type === 'collection' && !seen.has(c.id) && seen.add(c.id));
}

// Copy-on-write helper for all playlist edits: items are copied (and legacy strings upgraded) before fn mutates
// them, so the stored node stays untouched until db.patch swaps it (db nodes are immutable values).
function editItems(db, id, fn) {
  const c = db.get(id);
  if (!c || c.kind !== 'playlist') return null;
  const items = (c.items || []).map((i) => (typeof i === 'string' ? { ref: i } : { ...i }));
  const next = fn(items);
  return db.patch(id, { items: next });
}

export const setItems = (db, id, ids) => editItems(db, id, () => ids.map((ref) => ({ ref, added: now() })));
export const addItems = (db, id, ids, { at = -1 } = {}) => editItems(db, id, (items) => {
  const add = ids.map((ref) => ({ ref, added: now() }));
  if (at < 0 || at >= items.length) items.push(...add); else items.splice(at, 0, ...add);
  return items;
});
export const removeItems = (db, id, positions) => editItems(db, id, (items) => { const drop = new Set(positions); return items.filter((_, i) => !drop.has(i)); });
export const moveItem = (db, id, from, to) => editItems(db, id, (items) => {
  if (from < 0 || from >= items.length) return items;
  const [x] = items.splice(from, 1);
  items.splice(Math.max(0, Math.min(items.length, to)), 0, x);
  return items;
});
export const dedupeItems = (db, id) => editItems(db, id, (items) => { const seen = new Set(); return items.filter((i) => !seen.has(i.ref) && seen.add(i.ref)); });

export function collectionDuration(db, coll) {
  return itemsOf(db, coll).reduce((s, w) => s + (facts(db, w).duration || 0), 0);
}

// Works whose covers make a playlist's 2x2 collage: distinct albums / shows first. Unexpanded items come first, then
// the expanded leaves as fill-in; a leaf maps to its container id so four tracks of one album give one tile.
// Note: despite the header, it does not check that a cover exists; the renderer must fall back for coverless ids.
export function coverSources(db, coll, n = 4) {
  const out = [];
  const seenGroup = new Set();
  for (const w of itemsOf(db, coll, { expand: false }).concat(itemsOf(db, coll))) {
    const p = w.parent ? db.get(w.parent) : null;
    const g = p && ['album', 'show', 'season', 'book', 'podcast'].includes(p.kind) ? p.id : w.id;
    if (seenGroup.has(g)) continue;
    seenGroup.add(g);
    out.push(g);
    if (out.length >= n) break;
  }
  return out;
}

export function collectionsOf(db, workId) {
  return db.all('collection').filter((c) => c.kind === 'playlist' && (c.items || []).some((i) => refOf(i) === workId));
}
