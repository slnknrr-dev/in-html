// catalog/facts.js - the flattened record of a work that searches, smart playlists, sorting, browsing and statistics
// share: its own fields plus what it inherits from its containers (a track's album and album artist, an episode's
// show and season, a chapter's book), its media (presence, formats, paths, languages, durations) and its tracking.
// Memoized per catalogue change (db.memo).
//
//   facts(db, work) -> {
//     id, kind, domain ('music' | 'audiobook' | 'anime' | 'series' | 'movie' | 'musicvideo' | 'podcast' | 'other'),
//     title, titles [all titles], sort, artist [], albumartist [], composer [], author [], narrator [], director [],
//     studio [], people [all names], album, show, season, episode, absolute, track, disc, series, seriesPart,
//     year, decade, date, format, status, score, progress, total, repeats, plays, lastPlayed, added, updated, duration,
//     rating, favorite, energy, bpm, loudness, lang [], presence, counts { file, source, nominal } (works below
//     containers included), media (count), paths [], exts [], codecs [], height, size, tags Set, has Set
//     ('file' | 'source' | 'nominal' | 'cover' | 'lyrics' | 'synced' | 'subs' | 'chapters' | 'tags' | 'tracking' |
//     'markers' | 'description' | 'missing' | 'children' | 'video' | 'audio'), text (normalized search text) }
//   domainOf(db, work) -> domain ; containers(db, work) -> [parent, grandparent, …]
//   DOMAINS
//
// Why a flattened record: query, sort, browse and stats all ask "what is this track's album artist / year / presence".
// Answering by walking parents and media at every comparison would be O(depth + media) inside an O(n log n) sort.
// facts() pays that walk once per work per catalogue version, and every consumer reads plain fields.
// Invalidation is free: the cache lives in db.memo, which is dropped on any change. The cost is a full recompute
// after each edit, accepted because edits are rare relative to reads and a single facts() is cheap.
// Inheritance rule: own value first, then the nearest container that has one ("own wins"), so a compilation track
// with its own artist is not overwritten by the album's "Various Artists".

import { bestPresence, PRESENCE_RANK, matchKey, sortKey, displayTitle } from './model.js';
import { effectiveTags } from './tags.js';

export const DOMAINS = ['music', 'audiobook', 'anime', 'series', 'movie', 'musicvideo', 'podcast', 'other'];
const DEFAULT_DOMAIN = { track: 'music', album: 'music', musicvideo: 'musicvideo', book: 'audiobook', bookseries: 'audiobook', chapter: 'audiobook', podcast: 'podcast', movie: 'movie', show: 'series', season: 'series', episode: 'series' };

// Ancestor chain, nearest first. Two guards against corrupt data (a parent cycle from a bad import): the includes()
// check stops a loop, the 8-level cap bounds a pathological chain. Real hierarchies are at most 3 deep.
export function containers(db, w) {
  const out = [];
  let p = w && w.parent ? db.get(w.parent) : null;
  while (p && out.length < 8 && !out.includes(p)) { out.push(p); p = p.parent ? db.get(p.parent) : null; }
  return out;
}

export function domainOf(db, w) {
  if (!w) return 'other';
  if (w.domain && DOMAINS.includes(w.domain)) return w.domain;
  for (const c of containers(db, w)) if (c.domain && DOMAINS.includes(c.domain)) return c.domain;
  // An episode defaults to 'series' unless it hangs under a podcast: the kind alone is ambiguous here.
  if (w.kind === 'episode') { const c = containers(db, w).find((x) => x.kind === 'podcast'); if (c) return 'podcast'; }
  return DEFAULT_DOMAIN[w.kind] || 'other';
}

const names = (w, role) => (w && w.people ? w.people.filter((p) => p.role === role).map((p) => p.name) : []);

// Presence counts of a work and the works below it: one count per leaf at its best presence, so an album shows
// "8 files, 2 links, 1 wishlist". A container with own media (a whole-album file, a movie split into parts) counts
// itself too. Depth cap 3 matches the deepest real tree (show > season > episode) and stops runaway recursion on
// corrupt data. A leaf with no media counts as nominal (bestPresence([]) is 'nominal').
function presenceCounts(db, w, depth = 0) {
  const counts = { file: 0, source: 0, nominal: 0 };
  const kids = depth < 3 ? db.children(w.id) : [];
  if (kids.length) {
    for (const c of kids) { const x = presenceCounts(db, c, depth + 1); counts.file += x.file; counts.source += x.source; counts.nominal += x.nominal; }
    const own = db.mediaOf(w.id);
    if (own.length) counts[bestPresence(own.map((m) => m.presence))]++;
    return counts;
  }
  const media = db.mediaOf(w.id);
  counts[bestPresence(media.map((m) => m.presence))]++;
  return counts;
}

export function facts(db, w) {
  const cache = db.memo('facts', () => new Map());
  if (cache.has(w.id)) return cache.get(w.id);
  const chain = containers(db, w);
  const find = (kind) => chain.find((c) => c.kind === kind) || null;
  const album = w.kind === 'album' ? w : find('album');
  const show = w.kind === 'show' ? w : find('show') || find('podcast');
  const season = w.kind === 'season' ? w : find('season');
  const book = w.kind === 'book' ? w : find('book');
  const series = w.kind === 'bookseries' ? w : find('bookseries');
  const media = db.mediaOf(w.id);
  const kids = db.children(w.id);

  // Album artist: own, else the album's albumartist, else the album's artist. A track without an artist inherits the
  // album artist, so "artist:" queries find tracks of albums tagged only at album level.
  const artist = names(w, 'artist');
  const albumartist = names(w, 'albumartist').length ? names(w, 'albumartist') : album && album !== w ? (names(album, 'albumartist').length ? names(album, 'albumartist') : names(album, 'artist')) : [];
  if (!artist.length && albumartist.length) artist.push(...albumartist);
  const inherited = (role) => { const own = names(w, role); if (own.length) return own; for (const c of chain) { const x = names(c, role); if (x.length) return x; } return []; };
  const author = inherited('author'), narrator = inherited('narrator'), director = inherited('director'), studio = inherited('studio'), composer = names(w, 'composer');
  const people = [...new Set([...(w.people || []).map((p) => p.name), ...albumartist, ...author, ...narrator, ...studio])];

  const counts = presenceCounts(db, w);
  const presence = counts.file ? 'file' : counts.source ? 'source' : 'nominal';
  const tagset = effectiveTags(db, w);
  const has = new Set();
  for (const p of ['file', 'source', 'nominal']) if (counts[p]) has.add(p);
  const mediaDur = media.reduce((m, x) => Math.max(m, x.duration || 0), 0);
  // Duration: explicit, else the longest media (versions of one work are alternatives, not parts, so max not sum),
  // else the sum of the children (a container's length is its parts). Recursion goes through facts(), so each child
  // is computed once and cached.
  let duration = w.duration || mediaDur || 0;
  if (!duration && kids.length) duration = kids.reduce((s, c) => s + (facts(db, c).duration || 0), 0);
  const paths = [], exts = [], codecs = [], lang = new Set();
  let height = 0, size = 0;
  for (const m of media) {
    const p = (m.loc && (m.loc.path || m.loc.url || m.loc.name)) || m.path || m.name || (m.source && m.source.ref) || '';
    if (p) paths.push(p);
    const e = /\.([a-z0-9]{1,6})$/i.exec(m.name || p);
    if (e) exts.push(e[1].toLowerCase());
    if (m.audio && m.audio.codec) codecs.push(String(m.audio.codec).toLowerCase());
    if (m.video && m.video.codec) codecs.push(String(m.video.codec).toLowerCase());
    if (m.video && m.video.height > height) height = m.video.height;
    if (m.video) has.add('video'); else if (m.presence === 'file') has.add('audio');
    size += m.size || 0;
    if (m.lang) lang.add(String(m.lang).toLowerCase());
    for (const s of m.subs || []) if (s.lang) lang.add('sub:' + String(s.lang).toLowerCase());
    if ((m.subs || []).length) has.add('subs');
    if ((m.chapters || []).length) has.add('chapters');
    if (m.missing) has.add('missing');
    // 'nominal-info' is set here but missing from the documented `has` list in the header.
    if (m.nominal && (m.nominal.image || m.nominal.lyrics || m.nominal.text)) has.add('nominal-info');
  }
  if (w.language) lang.add(String(w.language).toLowerCase());
  for (const t of tagset) if (t.startsWith('lang:')) lang.add(t.slice(5));
  if (w.cover || (album && album.cover) || (show && show.cover) || media.some((m) => m.cover)) has.add('cover');
  if (w.lyrics && (w.lyrics.text || w.lyrics.lrc)) has.add('lyrics');
  if (w.lyrics && w.lyrics.lrc) has.add('synced');
  if ((w.tags || []).length) has.add('tags');
  // Tracking is usually kept on the season or show (MAL tracks a show, not each episode), so an episode reads it from
  // there for status / score; 'tracking' in `has` stays reserved for works that carry their own.
  const trackSrc = w.track || (season && season.track) || (show && show.track) || null;
  if (w.track) has.add('tracking');
  if (w.markers || media.some((m) => m.markers)) has.add('markers');
  if (w.description) has.add('description');
  if (kids.length) has.add('children');

  const titles = [displayTitle(w), ...Object.values(w.titles || {})].filter(Boolean);
  const containerTitle = (c) => (c && c !== w ? displayTitle(c) : '');
  const f = {
    id: w.id, kind: w.kind, domain: domainOf(db, w),
    title: displayTitle(w), titles, sort: sortKey(w),
    artist, albumartist, composer, author, narrator, director, studio, people,
    album: containerTitle(album), show: containerTitle(show), series: containerTitle(series) || w.series || '', book: containerTitle(book),
    season: w.season ?? (season ? season.season : undefined), episode: w.episode, absolute: w.absolute,
    track: w.kind === 'track' ? w.order : undefined, disc: w.disc, seriesPart: w.kind === 'book' ? (w.order ?? w.seriesPart) : undefined,
    year: w.year ?? (album && album.year) ?? (season && season.year) ?? (show && show.year),
    date: w.date, format: w.format || (show && show.format) || '',
    status: trackSrc ? trackSrc.status : '', score: trackSrc && trackSrc.score != null ? trackSrc.score : w.rating,
    progress: trackSrc ? trackSrc.progress || 0 : 0, total: w.total ?? (show && show.total), repeats: trackSrc ? trackSrc.repeats || 0 : 0,
    plays: w.plays || 0, lastPlayed: w.lastPlayed || 0, added: w.added || w.created || 0, updated: w.updated || 0,
    duration, rating: w.rating, favorite: !!w.favorite, energy: w.energy, bpm: w.bpm || media.reduce((b, m) => b || m.bpm || 0, 0) || undefined,
    loudness: w.loudness ?? media.reduce((l, m) => (l != null ? l : m.loudness), null) ?? undefined,
    lang: [...lang], presence, counts, media: media.length, paths, exts: [...new Set(exts)], codecs: [...new Set(codecs)], height, size,
    tags: tagset, has,
  };
  f.decade = f.year ? Math.floor(f.year / 10) * 10 : undefined;
  // Free-text search target: one pre-normalized string, so a bare-word query is a substring test, not a field walk.
  // Only file basenames (folder names would make every file of a library match its root folder name) and the first
  // 300 chars of the description (bounds memory per work).
  f.text = matchKey([...titles, ...people, f.album, f.show, f.series, f.book, ...tagset, ...paths.map((p) => String(p).split(/[\\/]/).pop()), String(w.description || '').slice(0, 300)].join(' '));
  cache.set(w.id, f);
  return f;
}

export const presenceRank = (p) => PRESENCE_RANK[p] ?? 0;
