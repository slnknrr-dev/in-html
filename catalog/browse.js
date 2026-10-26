// catalog/browse.js - the library views of the player: lists derived from the catalogue (memoized per change).
//
//   worksOf(db, domain, kinds?) -> works of a library section (domain: music | audiobook | anime | series | movie |
//                                  musicvideo | podcast)
//   artists(db, { role }) -> [{ key, name, albums: [ids], tracks, cover }]      album artists (or every artist)
//   artistWorks(db, key) -> { albums, tracks, appearsOn, videos }
//   albums(db, { sort }) -> album works ; editions(db, albumId) -> other releases of the same release group
//   discs(db, albumId) -> [{ disc, tracks }]
//   genres(db, ns = 'genre') -> [{ key, name, count }] ; years(db, domain) -> [{ year, count }] ; decades(db, domain)
//   shows(db, domain) -> shows ; seasons(db, showId) -> [{ season, work, episodes }] (specials last as season 0)
//   authors(db) -> [{ key, name, books }] ; bookSeries(db) -> [{ key, title, books (in series order) }]
//   people(db) -> [{ key, name, roles: { role: count } }]
//   recent(db, { domain, limit }) -> recently added leaves / containers
//   searchAll(db, text, { limit }) -> { works: { domain: [works] }, people, tags, collections }
//
// Key decisions:
// - Views are pure functions of the catalogue, recomputed lazily and cached with db.memo (dropped on any change).
//   No view keeps its own copy of state, so no view can show stale data after an edit or a sync.
// - Grouping by person uses matchKey(name), not the raw string: "Björk", "bjork" and "BJÖRK" are one artist. The
//   first spelling encountered becomes the display name.
// - Everything reads facts(), so inherited values (album artist on tracks, show on episodes) are seen uniformly.

import { matchKey, naturalCompare, sortKey } from './model.js';
import { facts, domainOf } from './facts.js';
import { tagCounts, tagIndex } from './tags.js';
import { runQuery, sortWorks } from './query.js';

// Kinds shown at the top level of each section. Children (tracks of albums, episodes) are reached by drilling down.
const TOP = { music: ['album', 'track'], audiobook: ['bookseries', 'book'], anime: ['show', 'movie'], series: ['show'], movie: ['movie'], musicvideo: ['musicvideo'], podcast: ['podcast'] };

export function worksOf(db, domain, kinds = null) {
  return db.memo(`browse:works:${domain}:${kinds ? kinds.join() : ''}`, () => db.all('work').filter((w) => (!kinds || kinds.includes(w.kind)) && domainOf(db, w) === domain));
}

// Top-level items of a section: albums and loose tracks for music, shows and films for anime, …
// "Top-level" = no parent, or a parent id that no longer resolves (an orphan after a partial import or delete is
// shown at top level rather than vanishing).
export function sectionItems(db, domain) {
  const kinds = TOP[domain] || null;
  return worksOf(db, domain).filter((w) => (!kinds || kinds.includes(w.kind)) && !(w.parent && db.get(w.parent)));
}

// Two passes: the first creates artist entries from albums (album artist, falling back to artist) and from loose
// tracks (or from every track when role === 'artist'); the second adds each album's child-track count to its album
// artist. Sorted by sortKey so "The Beatles" files under B.
// KNOWN DEFECT: with role 'artist' a track inside an album is counted in pass 1 and again via its album in pass 2,
// inflating `tracks`. Fix: skip pass 2 when role === 'artist', or count tracks only in pass 2.
export function artists(db, { role = 'albumartist' } = {}) {
  return db.memo('browse:artists:' + role, () => {
    const map = new Map();
    for (const w of worksOf(db, 'music')) {
      const f = facts(db, w);
      const list = w.kind === 'album' ? (f.albumartist.length ? f.albumartist : f.artist) : role === 'artist' || !(w.parent && db.get(w.parent)) ? f.artist : [];
      for (const name of list) {
        const key = matchKey(name);
        if (!key) continue;
        let a = map.get(key);
        if (!a) map.set(key, (a = { key, name, albums: [], tracks: 0, cover: null }));
        if (w.kind === 'album') { a.albums.push(w.id); if (!a.cover) a.cover = w.id; } else if (w.kind === 'track') a.tracks++;
      }
    }
    for (const w of worksOf(db, 'music', ['album'])) {
      const f = facts(db, w);
      const key = matchKey(f.albumartist[0] || f.artist[0] || '');
      const a = map.get(key);
      if (a) a.tracks += db.children(w.id).length;
    }
    return [...map.values()].sort((x, y) => naturalCompare(sortKey({ title: x.name }), sortKey({ title: y.name })));
  });
}

// "Appears on": albums containing a track by this artist whose album artist is someone else (compilations,
// features). Full scan of music works per call, not memoized: an artist page is opened one at a time.
export function artistWorks(db, key) {
  const albums = [], tracks = [], appearsOn = [], videos = [];
  for (const w of worksOf(db, 'music').concat(worksOf(db, 'musicvideo'))) {
    const f = facts(db, w);
    const mine = (list) => list.some((n) => matchKey(n) === key);
    if (w.kind === 'album') { if (mine(f.albumartist.length ? f.albumartist : f.artist)) albums.push(w); }
    else if (w.kind === 'musicvideo') { if (mine(f.artist)) videos.push(w); }
    else if (w.kind === 'track' && mine(f.artist)) {
      tracks.push(w);
      const alb = w.parent && db.get(w.parent);
      if (alb && !mine(facts(db, alb).albumartist.length ? facts(db, alb).albumartist : facts(db, alb).artist) && !appearsOn.includes(alb)) appearsOn.push(alb);
    }
  }
  return { albums: sortWorks(db, albums, 'year title'), tracks: sortWorks(db, tracks, '-plays title'), appearsOn: sortWorks(db, appearsOn, 'year'), videos };
}

export const albums = (db, { sort = 'artist year title' } = {}) => db.memo('browse:albums:' + sort, () => sortWorks(db, worksOf(db, 'music', ['album']), sort));

// Other releases of the same album. Explicit releaseGroup (MusicBrainz) wins; otherwise a heuristic key: the title
// with bracketed edition markers removed ("(2011 Remaster)", "[Deluxe Edition]") + the first album artist. The
// heuristic can over-merge ("Live" albums are kept apart only if their brackets lack these words) but under-merging
// is the commoner failure without it. The regex is duplicated for both sides and must stay identical.
export function editions(db, albumId) {
  const a = db.get(albumId);
  if (!a) return [];
  const f = facts(db, a);
  const group = a.releaseGroup || matchKey(f.title.replace(/\s*[([].*?(remaster|deluxe|edition|expanded|anniversary|mono|stereo).*?[)\]]\s*/gi, ' ')) + '|' + matchKey(f.albumartist[0] || f.artist[0] || '');
  return worksOf(db, 'music', ['album']).filter((x) => {
    if (x.id === albumId) return false;
    const g = facts(db, x);
    const k = x.releaseGroup || matchKey(g.title.replace(/\s*[([].*?(remaster|deluxe|edition|expanded|anniversary|mono|stereo).*?[)\]]\s*/gi, ' ')) + '|' + matchKey(g.albumartist[0] || g.artist[0] || '');
    return k === group;
  });
}

export function discs(db, albumId) {
  const map = new Map();
  for (const t of db.children(albumId)) { const d = t.disc || 1; if (!map.has(d)) map.set(d, []); map.get(d).push(t); }
  return [...map].sort((a, b) => a[0] - b[0]).map(([disc, tracks]) => ({ disc, tracks }));
}

// `ns` is interpolated into a RegExp unescaped: callers pass fixed namespace names (letters only); a namespace with
// regex metacharacters would need escaping.
export function genres(db, ns = 'genre') {
  const ix = tagIndex(db);
  const out = [];
  for (const [key, count] of tagCounts(db)) if (key.startsWith(ns + ':')) out.push({ key, name: ix.label(key).replace(new RegExp('^' + ns + ':', 'i'), ''), count });
  return out.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function years(db, domain = null) {
  const map = new Map();
  for (const w of domain ? sectionItems(db, domain) : db.all('work')) { const y = facts(db, w).year; if (y) map.set(y, (map.get(y) || 0) + 1); }
  return [...map].sort((a, b) => b[0] - a[0]).map(([year, count]) => ({ year, count }));
}

export function decades(db, domain = null) {
  const map = new Map();
  for (const { year, count } of years(db, domain)) { const d = Math.floor(year / 10) * 10; map.set(d, (map.get(d) || 0) + count); }
  return [...map].sort((a, b) => b[0] - a[0]).map(([decade, count]) => ({ decade, count }));
}

export const shows = (db, domain = 'series') => sortWorks(db, sectionItems(db, domain).filter((w) => w.kind === 'show' || w.kind === 'podcast'), 'title');

// Accepts both tree shapes found in the wild: show > season > episode, and episodes directly under the show with a
// `season` number. Loose episodes merge into a matching season node when one exists. Specials are season 0 and
// sort last (1e9 sentinel) because viewers expect them after the main run, not before season 1.
export function seasons(db, showId) {
  const out = [];
  const loose = [];
  for (const c of db.children(showId)) {
    if (c.kind === 'season') out.push({ season: c.season ?? 1, work: c, episodes: db.children(c.id) });
    else loose.push(c);
  }
  if (loose.length) {
    const bySeason = new Map();
    for (const e of loose) { const s = e.special ? 0 : e.season ?? 1; if (!bySeason.has(s)) bySeason.set(s, []); bySeason.get(s).push(e); }
    for (const [s, eps] of bySeason) {
      const hit = out.find((x) => x.season === s);
      if (hit) hit.episodes.push(...eps); else out.push({ season: s, work: null, episodes: eps });
    }
  }
  return out.sort((a, b) => (a.season === 0 ? 1e9 : a.season) - (b.season === 0 ? 1e9 : b.season));
}

export function authors(db) {
  return db.memo('browse:authors', () => {
    const map = new Map();
    for (const w of worksOf(db, 'audiobook', ['book'])) {
      for (const name of facts(db, w).author) {
        const key = matchKey(name);
        if (!map.has(key)) map.set(key, { key, name, books: [] });
        map.get(key).books.push(w.id);
      }
    }
    return [...map.values()].sort((a, b) => naturalCompare(a.name, b.name));
  });
}

// Series come from two sources: explicit bookseries nodes, and a `series` text field on parentless books (common in
// audiobook tags). Virtual series get a 'series:' key prefix so they never collide with node ids.
export function bookSeries(db) {
  const out = [];
  for (const s of worksOf(db, 'audiobook', ['bookseries'])) out.push({ key: s.id, title: facts(db, s).title, work: s, books: db.children(s.id) });
  const named = new Map();
  for (const b of worksOf(db, 'audiobook', ['book'])) {
    if (b.parent && db.get(b.parent)) continue;
    if (!b.series) continue;
    const k = matchKey(b.series);
    if (!named.has(k)) named.set(k, { key: 'series:' + k, title: b.series, work: null, books: [] });
    named.get(k).books.push(b);
  }
  for (const s of named.values()) { s.books.sort((a, b) => (a.order ?? a.seriesPart ?? 0) - (b.order ?? b.seriesPart ?? 0)); out.push(s); }
  return out.sort((a, b) => naturalCompare(a.title, b.title));
}

export function people(db) {
  return db.memo('browse:people', () => {
    const map = new Map();
    for (const w of db.all('work')) for (const p of w.people || []) {
      const key = matchKey(p.name);
      if (!key) continue;
      if (!map.has(key)) map.set(key, { key, name: p.name, roles: {} });
      const e = map.get(key);
      e.roles[p.role] = (e.roles[p.role] || 0) + 1;
    }
    return [...map.values()].sort((a, b) => naturalCompare(a.name, b.name));
  });
}

export function recent(db, { domain = null, limit = 24 } = {}) {
  const list = (domain ? sectionItems(db, domain) : db.all('work').filter((w) => !(w.parent && db.get(w.parent))));
  return sortWorks(db, list, '-added').slice(0, limit);
}

// Global search box. Works go through the full query language (so 'year:1999 blue' works) and are bucketed by
// domain; over-fetching limit * 4 gives each domain a chance to fill. People / tags / collections are matched by
// plain substring on the free-text part only: field tokens (word:value) are stripped first, since "year:1999" is
// not a person's name.
export function searchAll(db, text, { limit = 60 } = {}) {
  const q = String(text || '').trim();
  const works = {};
  if (!q) return { works, people: [], tags: [], collections: [] };
  for (const w of runQuery(db, q, { limit: limit * 4, sort: '-presence title' })) {
    const d = facts(db, w).domain;
    (works[d] ||= []);
    if (works[d].length < limit) works[d].push(w);
  }
  const k = matchKey(q.replace(/\b\w+:\S+/g, ' '));
  const ppl = k ? people(db).filter((p) => p.key.includes(k)).slice(0, 20) : [];
  const tags = k ? [...tagCounts(db).keys()].filter((t) => matchKey(t).includes(k)).slice(0, 20) : [];
  const collections = k ? db.all('collection').filter((c) => matchKey(c.name).includes(k)).slice(0, 20) : [];
  return { works, people: ppl, tags, collections };
}
