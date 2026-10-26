// geo/tree.js - a place tree country -> region -> city -> street -> building over plain nodes { id, kind, parentId,
// name: { en, ru, ka, … }, slug }: nesting rules (levels may be skipped), ancestors and breadcrumbs with cycle and
// orphan protection, subtree membership, cycle checks before re-parenting, names with language fallback, the
// depth-first panel order, path slugs and their resolution, area selections with include / exclude, and a gazetteer
// search over every language that tolerates inflection.
//
//   GEO_KINDS, geoLevel(kind), canNest(child, parent)
//   geoIndex(list) -> Map id -> node        geoAncestors(id, idx) / geoBreadcrumbs(id, idx) / geoIsWithin(id, anc, idx)
//   wouldCycle(id, newParent, idx)          geoName(node, lang)   geoPathLabel(id, idx, lang, sep)
//   sortGeo(list, lang) / geoTreeOrder(list, lang) -> [{ node, depth }]
//   geoSlug(name) / geoPathSlugs(id, idx) / geoResolvePath(segments, list) / geoHref(id, idx, prefix)
//   normalizeSelection(raw) -> { include, exclude }     selectionWithin(id, sel, idx)   selectionIds(sel, idx, kind)
//   gazetteer(list) -> index     searchPlaces(index, query, { lang, kinds, limit }) -> [{ node, score, path }]
//
// Rules carried over from the portal: a parent must be strictly higher, but need not be one level up (a city directly
// in a country is normal); every walk is guarded against cycles because re-parenting in two clicks can make an
// ancestor a descendant, and a looping breadcrumb would hang every page; orphans are shown as roots so they can be
// repaired; regions take no part in paths (/georgia/batumi/rustaveli), so one rule builds and resolves paths.
import { slugId, stemEq, words } from '../portal/text.js';

export const GEO_KINDS = ['country', 'region', 'city', 'street', 'building'];
export const GEO_KIND_LABEL = {
  country: { en: 'Country', ru: 'Страна', ka: 'ქვეყანა' },
  region: { en: 'Region', ru: 'Регион', ka: 'რეგიონი' },
  city: { en: 'City', ru: 'Город', ka: 'ქალაქი' },
  street: { en: 'Street', ru: 'Улица', ka: 'ქუჩა' },
  building: { en: 'Building', ru: 'Дом', ka: 'შენობა' },
};

export const isGeoKind = (v) => GEO_KINDS.includes(String(v));
// country 0 … building 4; unknown -1 (can neither nest nor be nested).
export const geoLevel = (kind) => GEO_KINDS.indexOf(String(kind));

export function canNest(childKind, parentKind) {
  const c = geoLevel(childKind);
  if (c < 0) return false;
  if (parentKind == null || parentKind === '') return true;
  const p = geoLevel(parentKind);
  return p >= 0 && p < c;
}

export const geoIndex = (list) => new Map((list || []).map((n) => [+n.id, n]));

const nodeOf = (idx, id) => (idx instanceof Map ? idx.get(+id) : idx?.[+id]) || null;

// Ancestors from the root to the parent (the node itself excluded); a cycle or a missing parent ends the chain.
// Every walk carries a `seen` set: the data is user-edited, and a cycle (A under B under A) must end the walk, never
// hang it. Ids are coerced with + because they arrive as strings from forms and as numbers from the database.
export function geoAncestors(id, idx) {
  const out = [];
  const seen = new Set([+id]);
  let cur = nodeOf(idx, id);
  while (cur && cur.parentId) {
    const pid = +cur.parentId;
    if (seen.has(pid)) break;
    seen.add(pid);
    const parent = nodeOf(idx, pid);
    if (!parent) break;
    out.unshift(parent);
    cur = parent;
  }
  return out;
}

export function geoBreadcrumbs(id, idx) {
  const self = nodeOf(idx, id);
  return self ? [...geoAncestors(id, idx), self] : [];
}

// Whether `id` lies in the subtree of `ancestorId` (a node is within itself).
export function geoIsWithin(id, ancestorId, idx) {
  const a = +ancestorId;
  if (!a || !+id) return false;
  if (+id === a) return true;
  return geoAncestors(id, idx).some((n) => +n.id === a);
}

// Would re-parenting `id` under `newParentId` make a cycle? Call before writing - afterwards the tree is broken.
// Re-parenting under one's own descendant is the only way to create a cycle; checking "is the new parent within
// me" before writing keeps the tree acyclic by construction.
export function wouldCycle(id, newParentId, idx) {
  const self = +id, parent = +newParentId;
  if (!parent) return false;
  if (parent === self) return true;
  return geoIsWithin(parent, self, idx);
}

// Locative keys (`ru_in`: "в Батуми") are skipped by the any-language fallback, or a node with only a locative would
// be called "в Батуми" in breadcrumbs.
export const GEO_LOC_SUFFIX = '_in';

// Name in a language: the language, then en, ru, ka, any non-locative key, then '#id'.
export function geoName(n, lang = 'en') {
  const nm = (n && n.name) || {};
  if (typeof nm === 'string') return nm;
  if (typeof nm !== 'object') return n ? '#' + n.id : '';
  for (const l of [lang, 'en', 'ru', 'ka']) if (nm[l]) return String(nm[l]);
  for (const k of Object.keys(nm)) if (nm[k] && !k.endsWith(GEO_LOC_SUFFIX)) return String(nm[k]);
  return n ? '#' + n.id : '';
}

// The ready locative phrase of a place in a language ('в Батуми', 'ბათუმში', 'in Batumi'); '' when none.
export function geoLoc(n, lang = 'en') {
  const nm = (n && n.name) || {};
  return typeof nm === 'object' ? String(nm[lang + GEO_LOC_SUFFIX] || '').trim() : '';
}

export const geoPathLabel = (id, idx, lang = 'en', sep = ' · ') => geoBreadcrumbs(id, idx).map((n) => geoName(n, lang)).join(sep);

// By level, then by name; the input is not mutated.
export function sortGeo(list, lang = 'en') {
  return list.slice().sort((a, b) => geoLevel(a.kind) - geoLevel(b.kind) || geoName(a, lang).localeCompare(geoName(b, lang), lang, { numeric: true }));
}

// Depth-first order with depth for indentation; orphans and nodes in cycles appear as roots (nothing is lost).
// Nodes whose parent is missing or part of a cycle are promoted to roots, so the admin panel shows every node and
// broken links can be repaired from the UI.
export function geoTreeOrder(list, lang = 'en') {
  const idx = geoIndex(list);
  const byParent = new Map();
  const roots = [];
  for (const n of list) {
    const pid = +(n.parentId || 0);
    if (!pid || !idx.has(pid) || geoIsWithin(pid, n.id, idx)) { roots.push(n); continue; }
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid).push(n);
  }
  const out = [];
  const walk = (nodes, depth) => {
    for (const n of sortGeo(nodes, lang)) { out.push({ node: n, depth }); walk(byParent.get(+n.id) || [], depth + 1); }
  };
  walk(roots, 0);
  return out;
}

export function geoChildren(id, list) {
  return (list || []).filter((n) => +(n.parentId || 0) === +id);
}

// --- paths ------------------------------------------------------------------------------------------------------

// A path slug from a name in any script ('რუსთაველის გამზირი' -> 'rustavelis-gamziri', 'Шерифа' -> 'sherifa').
export const geoSlug = (name, fallback = 'x') => slugId(name, fallback);

// Path positions: a region is not addressed, a building comes after its street.
const PATH_KINDS = ['country', 'city', 'street', 'building'];

// Path segments of a node: ['georgia', 'batumi', 'rustaveli']; the region and levels without a slug are skipped.
export function geoPathSlugs(id, idx) {
  const parts = [];
  for (const n of geoBreadcrumbs(id, idx)) {
    const slug = String(n.slug || '').toLowerCase();
    if (n.kind === 'region' || !slug || !PATH_KINDS.includes(String(n.kind))) continue;
    parts.push(slug);
  }
  return parts;
}

export function geoHref(id, idx, prefix = '/') {
  const parts = geoPathSlugs(id, idx);
  return parts.length ? prefix.replace(/\/?$/, '/') + parts.join('/') : '';
}

/**
 * Segments -> chain of nodes: each segment is looked up by slug and kind INSIDE the previous node's subtree, so
 * streets of the same name in different cities do not mix. null when any segment does not match.
 */
// Each segment is matched by kind for its path position and within the subtree of the previous match, so
// /georgia/batumi/rustaveli and /georgia/tbilisi/rustaveli resolve to different streets. Linear scans: fine for
// gazetteers of thousands of nodes; an index by slug would be needed beyond that.
export function geoResolvePath(segments, list) {
  const segs = (segments || []).map((s) => String(s || '').toLowerCase()).filter(Boolean);
  if (!segs.length || segs.length > PATH_KINDS.length) return null;
  const idx = geoIndex(list);
  const chain = [];
  let parent = null;
  for (let i = 0; i < segs.length; i++) {
    const kind = PATH_KINDS[i];
    const hit = list.find((n) => String(n.kind) === kind && String(n.slug || '').toLowerCase() === segs[i] && (!parent || geoIsWithin(n.id, parent.id, idx)));
    if (!hit) return null;
    chain.push(hit);
    parent = hit;
  }
  return { chain, node: chain[chain.length - 1], depth: chain.length };
}

// --- area selections ------------------------------------------------------------------------------------------

/**
 * A selection of areas { include: [ids], exclude: [ids] } from a scalar id, an array, a JSON string or an object.
 * Garbage gives an empty selection (never an exception). Exclusion always wins: include Adjara, exclude Batumi
 * covers Kobuleti but not Batumi; an empty include means everything (minus exclude).
 */
export function normalizeSelection(raw) {
  const ids = (v) => {
    const arr = Array.isArray(v) ? v : v == null ? [] : [v];
    const seen = new Set();
    for (const x of arr) { const n = Math.trunc(+x); if (n > 0) seen.add(n); }
    return [...seen];
  };
  let v = raw;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return { include: [], exclude: [] };
    if (s[0] === '{' || s[0] === '[') { try { v = JSON.parse(s); } catch { v = s; } }
  }
  if (v && typeof v === 'object' && !Array.isArray(v) && ('include' in v || 'exclude' in v)) return { include: ids(v.include), exclude: ids(v.exclude) };
  return { include: ids(v), exclude: [] };
}

const withinAny = (id, anchors, idx) => anchors.some((a) => geoIsWithin(id, a, idx));

export function selectionWithin(id, sel, idx) {
  if (!+id) return false;
  if (sel.include.length && !withinAny(id, sel.include, idx)) return false;
  return !withinAny(id, sel.exclude, idx);
}

export const selectionIsSet = (sel) => sel.include.length > 0 || sel.exclude.length > 0;

// Ids of nodes of a kind inside a selection (default: cities).
export function selectionIds(sel, idx, kind = 'city') {
  const out = [];
  const each = (n) => { if (n && String(n.kind) === kind && selectionWithin(n.id, sel, idx)) out.push(+n.id); };
  if (idx instanceof Map) idx.forEach(each); else for (const k of Object.keys(idx)) each(idx[k]);
  return out;
}

// --- gazetteer ------------------------------------------------------------------------------------------------

/**
 * A search index over all names of all nodes (every language, slugs, `alt` names): [{ node, keys: [[folded words]] }].
 */
export function gazetteer(list) {
  const idx = geoIndex(list);
  return {
    idx,
    entries: (list || []).map((node) => {
      const nm = node.name && typeof node.name === 'object' ? node.name : { '': node.name };
      const texts = [...Object.entries(nm).filter(([k, v]) => v && !k.endsWith(GEO_LOC_SUFFIX)).map(([, v]) => v), ...(node.alt || []), node.slug ? String(node.slug).replace(/-/g, ' ') : ''];
      return { node, keys: [...new Set(texts.filter(Boolean).map(String))].map((t) => words(t)) };
    }),
  };
}

/**
 * Places matching a query: every query word must match a word of one name (equal, a prefix of it, or the same word
 * in another case: "Руставели" finds "проспект Руставели", "batum" finds "Batumi", "ქუჩაზე" finds "ქუჩა").
 * Words of the query that name the parent ("Rustaveli Batumi") may match the ancestors. Higher levels and full
 * matches rank first. Returns [{ node, score, path }].
 */
// Scoring per query word: exact 3, prefix 2 (at least 2 letters), same stem 1 (inflected Russian/Georgian forms via
// stemEq). Words that do not match the node may match an ancestor at half weight ("Rustaveli Batumi"), but at least
// one word must match the node itself. NOTE: the ancestor lookup uses entries.find, O(n) per ancestor, so the search
// is O(n^2) in the worst case; a Map from node to entry would make it linear.
export function searchPlaces(index, query, { lang = 'en', kinds = null, limit = 20 } = {}) {
  const q = words(query);
  if (!q.length) return [];
  const wordHit = (w, k) => (k === w ? 3 : k.startsWith(w) && w.length >= 2 ? 2 : stemEq(w, k) ? 1 : 0);
  const best = (w, keys) => {
    let s = 0;
    for (const ws of keys) for (const k of ws) s = Math.max(s, wordHit(w, k));
    return s;
  };
  const out = [];
  for (const e of index.entries) {
    if (kinds && !kinds.includes(e.node.kind)) continue;
    let score = 0, own = 0;
    let ok = true;
    const anc = geoAncestors(e.node.id, index.idx);
    for (const w of q) {
      const s = best(w, e.keys);
      if (s) { score += s; own++; continue; }
      const a = anc.map((n) => best(w, index.entries.find((x) => x.node === n)?.keys || [])).reduce((m, v) => Math.max(m, v), 0);
      if (!a) { ok = false; break; }
      score += a * 0.5;
    }
    if (!ok || !own) continue;
    score += (GEO_KINDS.length - geoLevel(e.node.kind)) * 0.1;
    out.push({ node: e.node, score, path: [...anc, e.node].map((n) => geoName(n, lang)).join(' · ') });
  }
  return out.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
}

