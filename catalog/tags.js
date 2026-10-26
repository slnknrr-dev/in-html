// catalog/tags.js - the virtual tag system: namespaced tags (`genre:rock`, `mood:calm`, `lang:ja`, `people:…`, plain
// `favourite`), hierarchy by path (`genre:rock/punk` implies `genre:rock`), aliases and implications from tag
// definitions (tagdef nodes: { name, label, color, aliases: [], implies: [], description }), tags on any node (work,
// media, collection, workspace folder), inheritance down containers (album -> tracks, show -> seasons -> episodes,
// book -> chapters, series -> books) and up from media to their work.
//
//   tagKey(t) -> canonical text key ('Genre : Rock / Punk' -> 'genre:rock/punk'), '' for an empty tag
//   parseTag(t) -> { ns, path: [segments], key, name }
//   ancestors(key) -> ['genre:rock'] for 'genre:rock/punk'
//   NAMESPACES  [{ ns, hint }] suggested namespaces
//   tagIndex(db) -> { canon(t), closure(tags) -> Set(keys), def(key), label(key), color(key), implied(key) }   (memoized)
//   effectiveTags(db, node) -> Set(keys)                 own + ancestors + implications + inherited (memoized per change)
//   tagCounts(db, { type = 'work' }) -> Map(key -> count) (explicit tags with their ancestors)
//   allTags(db) -> sorted [{ key, name, count, def }]  (used tags and defined tags)
//   suggestTags(db, prefix, limit) -> names
//   addTags(db, ids, tags) / removeTags(db, ids, tags) / renameTag(db, from, to) / mergeTags(db, froms, to) /
//   deleteTag(db, t)                                     batch edits of every node (and tag definitions)
//   defineTag(db, name, { label, color, aliases, implies, description }) -> tagdef node
//
// Key decisions:
// - Tags are stored as the user typed them (display form) and compared by tagKey (canonical form). Storing only keys
//   would lose capitalisation the user chose ("Slice of Life"); comparing raw strings would make "Rock" != "rock".
// - "Virtual" means derived: effective tags (ancestors, implications, inheritance) are computed, never written back
//   to nodes. Writing them would freeze yesterday's implication rules into the data and make un-implying impossible.
// - Hierarchy is encoded in the key ('/' path), so ancestors() needs no lookup at all; implications and aliases,
//   which are arbitrary graphs, live in tagdef nodes and are resolved by tagIndex.

import { uid, now } from './model.js';

export const NAMESPACES = [
  { ns: 'genre', hint: 'rock, jazz/bebop, ambient, drama, slice of life' },
  { ns: 'mood', hint: 'calm, happy, melancholic, energetic, dark, romantic' },
  { ns: 'activity', hint: 'workout, study, sleep, driving, cooking' },
  { ns: 'tod', hint: 'time of day: morning, afternoon, evening, night' },
  { ns: 'occasion', hint: 'party, holiday, rainy day' },
  { ns: 'theme', hint: 'isekai, mecha, space, time travel' },
  { ns: 'lang', hint: 'en, ja, ru (audio / lyrics language)' },
  { ns: 'people', hint: 'performers, cast, crew' },
  { ns: 'era', hint: '80s, baroque, showa' },
  { ns: 'place', hint: 'tokyo, tbilisi, studio live' },
  { ns: 'origin', hint: 'manga, light novel, original, game' },
  { ns: 'quality', hint: 'hi-res, lossless, 4k, low' },
  { ns: 'studio', hint: 'animation / film studio, label' },
];

// Canonicalisation, order matters: NFKC (full-width "ｒｏｃｋ" == "rock") and lower case first, then whitespace
// collapse, then separator cleanup. The ':' replace is deliberately not global: only the first colon separates the
// namespace, later colons belong to the value ("title:re:zero"). Leading '#' is accepted for hashtag-style input.
export function tagKey(t) {
  let s = String(t ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s) return '';
  s = s.replace(/^#/, '').replace(/\s*:\s*/, ':').replace(/\s*\/\s*/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
  const i = s.indexOf(':');
  if (i === 0) s = s.slice(1);
  return s.replace(/:$/, '');
}

export function parseTag(t) {
  const key = tagKey(t);
  const i = key.indexOf(':');
  const ns = i > 0 ? key.slice(0, i) : '';
  const path = (i > 0 ? key.slice(i + 1) : key).split('/').filter(Boolean);
  const raw = String(t ?? '').trim().replace(/^#/, '');
  return { ns, path, key, name: raw || key };
}

// Proper prefixes of the path, nearest first; the namespace itself is never an ancestor ('genre:rock' does not
// imply a bare 'genre' tag), otherwise every genre tag would match every other in a query.
export function ancestors(key) {
  const { ns, path } = parseTag(key);
  const out = [];
  for (let i = path.length - 1; i > 0; i--) out.push((ns ? ns + ':' : '') + path.slice(0, i).join('/'));
  return out;
}

// Built once per catalogue version (db.memo) from all tagdefs. An alias pointing at itself is ignored and an
// implication of itself is dropped, so a sloppy definition cannot create a trivial cycle; longer cycles
// (a implies b implies a) are cut by the `out.has` check in expand().
export function tagIndex(db) {
  return db.memo('tags:index', () => {
    const defs = new Map();
    const alias = new Map();
    const implies = new Map();
    for (const d of db.all('tagdef')) {
      const k = tagKey(d.name);
      if (!k) continue;
      defs.set(k, d);
      for (const a of d.aliases || []) { const ak = tagKey(a); if (ak && ak !== k) alias.set(ak, k); }
      const imp = (d.implies || []).map(tagKey).filter((x) => x && x !== k);
      if (imp.length) implies.set(k, imp);
    }
    const canon = (t) => { const k = tagKey(t); return alias.get(k) || k; };
    const cache = new Map();
    // Every key a tag stands for: itself, its ancestors and its implications (transitively; cycles are cut).
    // Iterative DFS with an explicit stack: no recursion depth limit on long implication chains. Each popped key is
    // canonicalised, so an implication may name an alias. Results are cached per key for the index's lifetime.
    const expand = (k) => {
      if (cache.has(k)) return cache.get(k);
      const out = new Set();
      const stack = [k];
      while (stack.length) {
        const x = canon(stack.pop());
        if (!x || out.has(x)) continue;
        out.add(x);
        for (const a of ancestors(x)) stack.push(a);
        for (const i of implies.get(x) || []) stack.push(i);
      }
      cache.set(k, out);
      return out;
    };
    return {
      canon,
      closure(tags) { const out = new Set(); for (const t of tags || []) for (const k of expand(canon(t))) out.add(k); return out; },
      def: (k) => defs.get(canon(k)) || null,
      label: (k) => { const d = defs.get(canon(k)); return (d && d.label) || (d && d.name) || canon(k); },
      color: (k) => { const d = defs.get(canon(k)); return (d && d.color) || null; },
      implied: (k) => [...expand(canon(k))].filter((x) => x !== canon(k)),
      defs,
    };
  });
}

// Containers whose tags flow down to their children. Only containers: a track's tags must not flow to sibling
// tracks, and an album tagged 'genre:jazz' should make every track findable by 'genre:jazz'.
// Media tags flow up to their work (a tag set on a file describes the work it represents). Not down: a work's
// tags already apply to all its media logically, and queries run on works.
const INHERIT = new Set(['album', 'show', 'season', 'book', 'bookseries', 'podcast']);

export function effectiveTags(db, node) {
  if (!node) return new Set();
  const all = db.memo('tags:effective', () => new Map());
  if (all.has(node.id)) return all.get(node.id);
  const ix = tagIndex(db);
  const own = [...(node.tags || [])];
  if (node.type === 'work') {
    for (const m of db.mediaOf(node.id)) own.push(...(m.tags || []));
    let p = node.parent ? db.get(node.parent) : null;
    let guard = 0;
    while (p && guard++ < 8) {
      if (INHERIT.has(p.kind)) own.push(...(p.tags || []));
      p = p.parent ? db.get(p.parent) : null;
    }
  }
  const set = ix.closure(own);
  all.set(node.id, set);
  return set;
}

// Counts explicit tags only (plus path ancestors), not implications or inheritance: the tag cloud should reflect
// what users tagged, and counting inherited tags would multiply an album tag by its track count.
// `seen` makes a node count once per key even if it carries both 'genre:rock' and 'genre:rock/punk'.
export function tagCounts(db, { type = 'work' } = {}) {
  return db.memo('tags:counts:' + type, () => {
    const ix = tagIndex(db);
    const counts = new Map();
    for (const n of db.all(type)) {
      const seen = new Set();
      for (const t of n.tags || []) {
        const k = ix.canon(t);
        for (const x of [k, ...ancestors(k)]) if (!seen.has(x)) { seen.add(x); counts.set(x, (counts.get(x) || 0) + 1); }
      }
    }
    return counts;
  });
}

export function allTags(db) {
  const counts = new Map();
  for (const type of ['work', 'media', 'collection']) for (const [k, c] of tagCounts(db, { type })) counts.set(k, (counts.get(k) || 0) + c);
  const ix = tagIndex(db);
  for (const k of ix.defs.keys()) if (!counts.has(k)) counts.set(k, 0);
  return [...counts].map(([key, count]) => ({ key, name: ix.label(key), count, def: ix.def(key) }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

// Autocomplete: matches at the start of the key, of the value after the namespace, or of any path segment, so
// typing "punk" finds 'genre:rock/punk'. Namespace stubs ('mood:') come first while no ':' has been typed yet,
// guiding users toward namespaced tags. allTags is already sorted by popularity.
export function suggestTags(db, prefix = '', limit = 12) {
  const p = tagKey(prefix);
  const list = allTags(db).filter((x) => !p || x.key.startsWith(p) || x.key.includes(':' + p) || x.key.includes('/' + p));
  const ns = NAMESPACES.filter((n) => p && n.ns.startsWith(p) && !p.includes(':')).map((n) => ({ key: n.ns + ':', count: -1 }));
  return [...ns, ...list].slice(0, limit).map((x) => x.key);
}

// Dedupe by canonical key, keep the first display form seen (so existing spelling wins over a newly typed variant).
const uniq = (list) => { const seen = new Set(); const out = []; for (const t of list) { const k = tagKey(t); if (k && !seen.has(k)) { seen.add(k); out.push(String(t).trim().replace(/^#/, '')); } } return out; };

export function addTags(db, ids, tags) {
  db.batch(() => {
    for (const id of ids) { const n = db.get(id); if (n) db.patch(id, { tags: uniq([...(n.tags || []), ...tags]) }); }
  }, { label: 'tags' });
}

export function removeTags(db, ids, tags) {
  const drop = new Set(tags.map(tagKey));
  db.batch(() => {
    for (const id of ids) { const n = db.get(id); if (n && (n.tags || []).some((t) => drop.has(tagKey(t)))) db.patch(id, { tags: n.tags.filter((t) => !drop.has(tagKey(t))) }); }
  }, { label: 'tags' });
}

// Renames a tag and its descendants ('genre:rock' -> 'genre:guitar' also moves 'genre:rock/punk').
export function renameTag(db, from, to) { mergeTags(db, [from], to); }

// One full scan in one batch (one undo step) touching every place a tag can live: node tag lists, tagdefs (renamed,
// or folded into an existing target definition with the old name kept as an alias so old imports still resolve),
// implications of other tagdefs, and the nested folder trees of workspaces. The JSON.stringify comparison avoids
// patching (and emitting / bumping updated on) workspaces that did not actually change.
// Iterates a snapshot (db.all() copies), so removing tagdefs mid-loop is safe.
export function mergeTags(db, froms, to) {
  const keys = froms.map(tagKey).filter(Boolean);
  const target = String(to).trim().replace(/^#/, '');
  const tkey = tagKey(target);
  const map = (t) => {
    const k = tagKey(t);
    for (const f of keys) {
      if (k === f) return target;
      if (k.startsWith(f + '/')) return tkey + k.slice(f.length);
    }
    return t;
  };
  db.batch(() => {
    for (const n of db.all()) {
      if (Array.isArray(n.tags) && n.tags.some((t) => map(t) !== t)) db.patch(n.id, { tags: uniq(n.tags.map(map)) });
      if (n.type === 'tagdef') {
        const nk = tagKey(n.name);
        if (keys.includes(nk)) {
          const existing = db.all('tagdef').find((d) => tagKey(d.name) === tkey && d.id !== n.id);
          if (existing) {
            db.patch(existing.id, { aliases: uniq([...(existing.aliases || []), ...(n.aliases || []), n.name]), implies: uniq([...(existing.implies || []), ...(n.implies || [])]) });
            db.remove(n.id);
          } else db.patch(n.id, { name: target, aliases: uniq([...(n.aliases || []), n.name]) });
        } else if ((n.implies || []).some((t) => map(t) !== t)) db.patch(n.id, { implies: uniq(n.implies.map(map)) });
      }
      if (n.type === 'workspace' && n.root) {
        const fix = (f) => ({ ...f, tags: f.tags ? uniq(f.tags.map(map)) : f.tags, children: (f.children || []).map(fix) });
        const root = fix(n.root);
        if (JSON.stringify(root) !== JSON.stringify(n.root)) db.patch(n.id, { root });
      }
    }
  }, { label: 'merge tags' });
}

// Deletes the tag and its whole subtree ('genre:rock' also drops 'genre:rock/punk'), mirroring rename semantics.
// Workspace folder tags and other tagdefs' implications are not cleaned here (unlike mergeTags); dangling
// implications are harmless, since they only add an unused key to closures.
export function deleteTag(db, t) {
  const k = tagKey(t);
  db.batch(() => {
    for (const n of db.all()) {
      if (Array.isArray(n.tags) && n.tags.some((x) => { const xk = tagKey(x); return xk === k || xk.startsWith(k + '/'); })) {
        db.patch(n.id, { tags: n.tags.filter((x) => { const xk = tagKey(x); return !(xk === k || xk.startsWith(k + '/')); }) });
      }
      if (n.type === 'tagdef' && tagKey(n.name) === k) db.remove(n.id);
    }
  }, { label: 'delete tag' });
}

// Upsert by canonical key: defining an existing tag updates it instead of creating a rival definition (two tagdefs
// for one key would make tagIndex keep whichever came last in iteration order).
export function defineTag(db, name, { label, color, aliases = [], implies = [], description } = {}) {
  const k = tagKey(name);
  const existing = db.all('tagdef').find((d) => tagKey(d.name) === k);
  const fields = { name: String(name).trim().replace(/^#/, ''), aliases: uniq(aliases), implies: uniq(implies) };
  if (label !== undefined) fields.label = label;
  if (color !== undefined) fields.color = color;
  if (description !== undefined) fields.description = description;
  if (existing) return db.patch(existing.id, fields);
  const t = now();
  return db.put({ id: uid(), type: 'tagdef', created: t, updated: t, tags: [], ...fields });
}
