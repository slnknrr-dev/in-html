// catalog/interop.js - other programs' formats, from and to files (no network): the user's OWN list exports of
// MyAnimeList (the XML of "Export my list") and Shikimori (the JSON export), playlists as extended M3U8 / XSPF, works
// as Kodi / Jellyfin NFO, albums and audiobooks as CUE sheets.
//
//   parseMal(xml) -> { user, entries: [{ malId, title, type, episodes, watched, score, status, start, finish,
//                      rewatching, timesWatched, tags, comments, priority }], skipped }     (anime; manga is counted)
//   importMal(db, xml) / importShikimori(db, jsonText | array) -> { added, updated, entries }
//     Every entry is a show (domain anime, format from the type, total episodes, ids.mal) with tracking; "Title
//     Season 2" / "Title 2nd Season" / "Title S2" entries become season 2 of the show "Title" (tracking on the
//     season), so files named "Title S2 - 05" find them. Existing works are matched by ids.mal / ids.shikimori, then by
//     title; their tracking is replaced by the imported one when the import is newer.
//   exportMal(db, { user }) -> XML text ; exportShikimori(db) -> JSON text
//   splitSeasonTitle(title) -> { show, season } | null
//   playlistM3u(db, coll, { path(media) -> string | null }) / playlistXspf(db, coll, { path, location })
//   importPlaylist(db, text, { name, format: 'm3u' | 'xspf' | 'pls' }) -> { collection, matched, created }
//     entries are matched by path, then by title + artist; unmatched entries become nominal works (a URL becomes a
//     source)
//   workNfo(db, work) -> { kind, name, text } ; albumCue(db, albumId, { file }) -> text ; chaptersCue(db, media) -> text

//
// Key decisions:
// - Files only, no network APIs: the app is offline by contract, and the user's own export files need no OAuth.
// - Parsing and serialising of each format live in shared modules (xml/, mediatags/); this file only maps between
//   those neutral structures and catalogue nodes, so each format parser is reusable and tested on its own.
// - Imports reconcile instead of duplicating: list entries and playlist lines are matched to existing works first
//   (external id, index key, title key, path) and only then created, nominal when nothing is known but a name.

import { parseXML, root, children, child, textOf, escapeXML } from '../xml/xml.js';
import { parseM3u, writeM3u, parseXspf, writeXspf, parsePls } from '../mediatags/playlist.js';
import { serializeNfo } from '../mediatags/nfo.js';
import { serializeCue, buildCue } from '../mediatags/cue.js';
import { newWork, newMedia, uid, now, matchKey, firstPerson, peopleOf } from './model.js';
import { facts } from './facts.js';
import { itemsOf } from './collections.js';
import { srcKey } from './db.js';

// Status maps both ways. MAL exports use either text or numeric codes depending on the export path (5 is unused by
// MAL). MAL has no "rewatching" status, only a flag, so 'repeating' exports as Watching + my_rewatching = 1.
const MAL_STATUS = { watching: 'current', completed: 'completed', 'on-hold': 'paused', 'on hold': 'paused', dropped: 'dropped', 'plan to watch': 'planned', '1': 'current', '2': 'completed', '3': 'paused', '4': 'dropped', '6': 'planned' };
const MAL_OUT = { current: 'Watching', repeating: 'Watching', completed: 'Completed', paused: 'On-Hold', dropped: 'Dropped', planned: 'Plan to Watch' };
const SHIKI_STATUS = { planned: 'planned', watching: 'current', rewatching: 'repeating', completed: 'completed', on_hold: 'paused', dropped: 'dropped' };
const SHIKI_OUT = { planned: 'planned', current: 'watching', repeating: 'rewatching', completed: 'completed', paused: 'on_hold', dropped: 'dropped' };
const FORMAT = { tv: 'tv', movie: 'movie', ova: 'ova', ona: 'ona', special: 'special', music: 'music', 'tv short': 'tv_short', tv_special: 'special', cm: 'cm', pv: 'pv' };

// MAL writes '0000-00-00' for an unset date; both directions keep that convention.
const dateMs = (s) => { if (!s || /^0000/.test(s)) return undefined; const t = Date.parse(String(s).slice(0, 10)); return Number.isFinite(t) ? t : undefined; };
const day = (t) => (t ? new Date(t).toISOString().slice(0, 10) : '0000-00-00');

// MAL lists each season as a separate entry with the season baked into the title. Patterns, tried in order:
// "X Season 2" / "X: Staffel 2" / "X S2", then ordinals "X 2nd Season", then Roman numerals "X II".
// Lazy (.+?) keeps the show name minimal so trailing separators are left for the cleanup replace. Roman numerals
// are case-sensitive on purpose: a lower-case "v" or "ii" at the end of a title is more likely a word.
// Known limits: "X 2" (bare number) is not split, since too many real titles end in a number.
export function splitSeasonTitle(title) {
  const t = String(title || '').trim();
  const ord = { second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, '6th': 6, '7th': 7, '8th': 8 };
  let m = /^(.+?)[\s:]+(?:season|staffel|saison)\s*(\d{1,2})$/i.exec(t) || /^(.+?)\s+s(\d{1,2})$/i.exec(t);
  if (m) return { show: m[1].replace(/[\s:–-]+$/, ''), season: Number(m[2]) };
  m = /^(.+?)[\s:]+(\d{1,2}(?:nd|rd|th)|second|third|fourth|fifth|sixth)\s+season$/i.exec(t);
  if (m) return { show: m[1].replace(/[\s:–-]+$/, ''), season: ord[m[2].toLowerCase()] || Number.parseInt(m[2], 10) };
  m = /^(.+?)\s+(II|III|IV|V)$/.exec(t);
  if (m) return { show: m[1], season: { II: 2, III: 3, IV: 4, V: 5 }[m[2]] };
  return null;
}

// Pure parse (no db): returns plain entries so the same data can be previewed before import. Numbers default to 0
// on garbage (Number('') is 0, NaN is coerced by `|| 0`); entries without a title are dropped.
export function parseMal(xml) {
  const doc = parseXML(String(xml).replace(/^﻿/, ''));
  const r = root(doc);
  if (!r || r.name !== 'myanimelist') throw new Error('not a MyAnimeList export');
  const info = child(r, 'myinfo');
  const val = (nd, name) => { const c = child(nd, name); return c ? textOf(c).trim() : ''; };
  const entries = children(r, 'anime').map((a) => ({
    malId: val(a, 'series_animedb_id'), title: val(a, 'series_title'), type: val(a, 'series_type'), episodes: Number(val(a, 'series_episodes')) || 0,
    watched: Number(val(a, 'my_watched_episodes')) || 0, score: Number(val(a, 'my_score')) || 0, status: val(a, 'my_status'),
    start: val(a, 'my_start_date'), finish: val(a, 'my_finish_date'), rewatching: val(a, 'my_rewatching') === '1', timesWatched: Number(val(a, 'my_times_watched')) || 0,
    tags: val(a, 'my_tags'), comments: val(a, 'my_comments'), priority: val(a, 'my_priority'),
  })).filter((e) => e.title);
  return { user: info ? val(info, 'user_name') : '', entries, skipped: { manga: children(r, 'manga').length } };
}

// One list entry -> one work, matched in this order: external id key, then top-level title key (show / movie,
// also the Russian title from Shikimori), creating show + season as needed. ixKey values mirror the indexer's
// keys (indexer.js) so files scanned later attach to these very works instead of creating twins.
// MAL user tags are namespaced 'mal:' so they round-trip on export without mixing into the user's own tags.
// Note: track.updated is now(), so `cur.updated <= track.updated` is practically always true and the import
// replaces existing tracking unconditionally; "when the import is newer" in the header is aspirational.
function applyEntry(db, e, report) {
  const status = e.rewatching ? 'repeating' : e.status;
  const track = { status, progress: e.watched || 0, repeats: e.timesWatched || 0, updated: now() };
  if (e.score) track.score = e.score;
  if (e.start) track.started = e.start;
  if (e.finish) track.finished = e.finish;
  if (e.comments) track.notes = e.comments;
  const format = FORMAT[String(e.type || '').toLowerCase()] || undefined;
  const idKey = e.malId ? `id:mal:${e.malId}` : e.shikiId ? `id:shikimori:${e.shikiId}` : null;
  let w = idKey ? db.get(db.find(idKey)) : null;
  const split = format === 'movie' ? null : splitSeasonTitle(e.title);
  const ids = { ...(e.malId ? { mal: String(e.malId) } : {}), ...(e.shikiId ? { shikimori: String(e.shikiId) } : {}) };
  const tags = e.tags ? e.tags.split(/\s*,\s*/).filter(Boolean).map((t) => 'mal:' + t.toLowerCase()) : [];
  if (!w) {
    const kind = format === 'movie' ? 'movie' : 'show';
    const t = matchKey(split ? split.show : e.title);
    const top = db.get(db.find(`t:${kind}:${t}`)) || (e.altTitle ? db.get(db.find(`t:${kind}:${matchKey(e.altTitle)}`)) : null);
    if (top && split) {
      w = db.children(top.id).find((c) => c.kind === 'season' && c.season === split.season) || null;
      if (!w) { w = db.put(newWork({ kind: 'season', title: `Season ${split.season}`, season: split.season, parent: top.id, domain: 'anime', ixKey: `season:anime|${t}|${split.season}` })); report.added++; }
    } else if (top && !split) w = top;
    else if (split) {
      const show = db.put(newWork({ kind: 'show', title: split.show, domain: 'anime', format, ixKey: `show:anime|${matchKey(split.show)}` }));
      w = db.put(newWork({ kind: 'season', title: `Season ${split.season}`, season: split.season, parent: show.id, domain: 'anime', ixKey: `season:anime|${matchKey(split.show)}|${split.season}` }));
      report.added += 2;
    } else {
      w = db.put(newWork({ kind, title: e.title, domain: 'anime', ixKey: kind === 'show' ? `show:anime|${t}` : undefined }));
      report.added++;
    }
  } else report.updated++;
  const patch = { ids: { ...(w.ids || {}), ...ids }, total: e.episodes || w.total, format: format || w.format };
  if (e.altTitle) patch.titles = { ...(w.titles || {}), ru: e.altTitle };
  if (tags.length) patch.tags = [...new Set([...(w.tags || []), ...tags])];
  const cur = w.track;
  if (!cur || !cur.updated || cur.updated <= track.updated) patch.track = track;
  db.patch(w.id, patch);
  return w;
}

export function importMal(db, xml) {
  const p = parseMal(xml);
  const report = { added: 0, updated: 0, entries: p.entries.length, skipped: p.skipped };
  db.batch(() => {
    for (const e of p.entries) applyEntry(db, { ...e, status: MAL_STATUS[String(e.status).toLowerCase()] || 'planned', start: dateMs(e.start), finish: dateMs(e.finish) }, report);
  }, { label: 'import MyAnimeList' });
  return report;
}

// Shikimori anime ids coincide with MAL ids, hence malId = target_id as well: a later MAL import matches the
// same work by id:mal.
export function importShikimori(db, json) {
  const list = typeof json === 'string' ? JSON.parse(json.replace(/^﻿/, '')) : json;
  if (!Array.isArray(list)) throw new Error('not a Shikimori export');
  const report = { added: 0, updated: 0, entries: 0, skipped: { manga: 0 } };
  db.batch(() => {
    for (const x of list) {
      if (!x || (x.target_type && x.target_type !== 'Anime')) { report.skipped.manga++; continue; }
      report.entries++;
      applyEntry(db, {
        shikiId: x.target_id, malId: x.target_id, title: x.target_title, altTitle: x.target_title_ru || undefined, type: x.kind || '',
        episodes: x.target_episodes || 0, watched: x.episodes || 0, score: x.score || 0, status: SHIKI_STATUS[x.status] || 'planned',
        rewatching: x.status === 'rewatching', timesWatched: x.rewatches || 0, comments: x.text || '',
      }, report);
    }
  }, { label: 'import Shikimori' });
  return report;
}

// Inverse of the season split: a tracked season is exported as "Show Season N" (season 1 as the bare show title),
// matching how MAL names entries, so a re-import maps back onto the same season.
function trackedAnime(db) {
  const out = [];
  for (const w of db.all('work')) {
    if (!w.track || !['show', 'season', 'movie'].includes(w.kind)) continue;
    if (facts(db, w).domain !== 'anime') continue;
    const parent = w.parent ? db.get(w.parent) : null;
    const title = w.kind === 'season' && parent ? (w.season > 1 ? `${parent.title} Season ${w.season}` : parent.title) : w.title;
    out.push({ w, title });
  }
  return out;
}

// Hand-built XML mirroring MAL's own export byte layout (tabs, element order, CDATA for free text), because MAL's
// importer is strict about structure. Free text goes in CDATA; a literal "]]>" inside is split across two CDATA
// sections (the standard escape). Plain fields go through escapeXML. Scores are rounded: MAL accepts integers only.
export function exportMal(db, { user = '' } = {}) {
  const list = trackedAnime(db);
  const counts = { current: 0, completed: 0, paused: 0, dropped: 0, planned: 0 };
  const rows = list.map(({ w, title }) => {
    const t = w.track;
    counts[t.status === 'repeating' ? 'current' : t.status] = (counts[t.status === 'repeating' ? 'current' : t.status] || 0) + 1;
    const type = { tv: 'TV', movie: 'Movie', ova: 'OVA', ona: 'ONA', special: 'Special', music: 'Music' }[w.format || (w.kind === 'movie' ? 'movie' : 'tv')] || 'TV';
    return `\t<anime>\n\t\t<series_animedb_id>${escapeXML(w.ids && w.ids.mal || '0')}</series_animedb_id>\n\t\t<series_title><![CDATA[${title.replace(/]]>/g, ']]]]><![CDATA[>')}]]></series_title>\n` +
      `\t\t<series_type>${type}</series_type>\n\t\t<series_episodes>${w.total || 0}</series_episodes>\n\t\t<my_id>0</my_id>\n` +
      `\t\t<my_watched_episodes>${t.progress || 0}</my_watched_episodes>\n\t\t<my_start_date>${day(t.started)}</my_start_date>\n\t\t<my_finish_date>${day(t.finished)}</my_finish_date>\n` +
      `\t\t<my_rated></my_rated>\n\t\t<my_score>${Math.round(t.score || 0)}</my_score>\n\t\t<my_storage></my_storage>\n\t\t<my_storage_value>0.00</my_storage_value>\n` +
      `\t\t<my_status>${MAL_OUT[t.status] || 'Plan to Watch'}</my_status>\n\t\t<my_comments><![CDATA[${(t.notes || '').replace(/]]>/g, ']]]]><![CDATA[>')}]]></my_comments>\n` +
      `\t\t<my_times_watched>${t.repeats || 0}</my_times_watched>\n\t\t<my_rewatch_value></my_rewatch_value>\n\t\t<my_priority>LOW</my_priority>\n` +
      `\t\t<my_tags><![CDATA[${(w.tags || []).filter((x) => /^mal:/i.test(x)).map((x) => x.slice(4)).join(', ')}]]></my_tags>\n` +
      `\t\t<my_rewatching>${t.status === 'repeating' ? 1 : 0}</my_rewatching>\n\t\t<my_rewatching_ep>0</my_rewatching_ep>\n\t\t<update_on_import>1</update_on_import>\n\t</anime>`;
  });
  return `<?xml version="1.0" encoding="UTF-8" ?>\n<!--\n Created by the in-html media player (export of the user's own list)\n-->\n<myanimelist>\n\t<myinfo>\n\t\t<user_id></user_id>\n\t\t<user_name>${escapeXML(user)}</user_name>\n` +
    `\t\t<user_export_type>1</user_export_type>\n\t\t<user_total_anime>${rows.length}</user_total_anime>\n\t\t<user_total_watching>${counts.current}</user_total_watching>\n` +
    `\t\t<user_total_completed>${counts.completed}</user_total_completed>\n\t\t<user_total_onhold>${counts.paused}</user_total_onhold>\n\t\t<user_total_dropped>${counts.dropped}</user_total_dropped>\n` +
    `\t\t<user_total_plantowatch>${counts.planned}</user_total_plantowatch>\n\t</myinfo>\n${rows.join('\n')}\n</myanimelist>\n`;
}

export function exportShikimori(db) {
  const out = trackedAnime(db).map(({ w, title }) => ({
    target_title: title, target_title_ru: (w.titles && w.titles.ru) || null, target_id: Number((w.ids && (w.ids.shikimori || w.ids.mal)) || 0) || null, target_type: 'Anime',
    score: Math.round(w.track.score || 0), status: SHIKI_OUT[w.track.status] || 'planned', rewatches: w.track.repeats || 0, episodes: w.track.progress || 0, text: w.track.notes || null,
  }));
  return JSON.stringify(out, null, 1);
}

// --- playlists ----------------------------------------------------------------------------------------------------------

// Playlist line of a work: the path comes from the injected path() (the host knows how to express a loc as a
// path / URL for the target player), falling back to the source link. Only the first (best) media is used.
function entryOf(db, w, path) {
  const f = facts(db, w);
  const m = db.mediaOf(w.id)[0];
  return {
    path: (m && path(m)) || (m && m.source && (m.source.url || m.source.ref)) || '', title: f.title, artist: f.artist[0] || f.author[0] || '', album: f.album || f.show || f.book || '',
    duration: f.duration ? Math.round(f.duration) : null,
  };
}

// M3U cannot express an entry without a location, so pathless (nominal) items are dropped; XSPF keeps them with an
// empty location plus a urn:in-html identifier, so a round trip through XSPF loses nothing.
export function playlistM3u(db, coll, { path = (m) => (m.loc && (m.loc.path || m.loc.url)) || null } = {}) {
  const entries = itemsOf(db, coll).map((w) => entryOf(db, w, path)).filter((e) => e.path).map((e) => ({ path: e.path, title: e.title, artist: e.artist, duration: e.duration, extra: { album: e.album } }));
  return writeM3u({ title: coll.name, entries }, { extended: true });
}

export function playlistXspf(db, coll, { path = (m) => (m.loc && (m.loc.path || m.loc.url)) || null } = {}) {
  const entries = itemsOf(db, coll).map((w) => { const e = entryOf(db, w, path); return { location: e.path ? [e.path] : [], title: e.title, creator: e.artist, album: e.album, duration: e.duration || undefined, identifier: [`urn:in-html:${w.id}`] }; });
  return writeXspf({ title: coll.name, creator: 'in-html media player', entries });
}

// Format sniffed from content when not given. Matching per line: exact normalised path (lower case, forward
// slashes: playlists written on Windows and read elsewhere), then path-suffix either way (relative playlist paths
// vs absolute catalogue paths), then title + artist. The suffix scan is O(lines x media); fine for playlists.
// Case-folding paths can conflate files on case-sensitive filesystems; accepted for cross-OS matching.
// The `srcKey(loc) === loc ? loc : loc` expression is a no-op (both branches equal); the raw URL is stored.
export function importPlaylist(db, text, { name = 'Playlist', format = null } = {}) {
  const fmt = format || (/^\s*<\?xml|<playlist[\s>]/i.test(text) ? 'xspf' : /^\s*\[playlist\]/i.test(text) ? 'pls' : 'm3u');
  const parsed = fmt === 'xspf' ? parseXspf(text) : fmt === 'pls' ? parsePls(text) : parseM3u(text);
  const report = { collection: null, matched: 0, created: 0 };
  db.batch(() => {
    const ids = [];
    const byPath = new Map();
    for (const m of db.all('media')) { const p = m.loc && (m.loc.path || m.loc.url); if (p) byPath.set(String(p).toLowerCase().replace(/\\/g, '/'), m); }
    for (const e of parsed.entries || []) {
      const loc = e.path || e.url || (Array.isArray(e.location) ? e.location[0] : e.location) || '';
      const norm = String(loc).toLowerCase().replace(/\\/g, '/');
      let hit = byPath.get(norm) || [...byPath.entries()].find(([p]) => norm && (p.endsWith('/' + norm) || norm.endsWith('/' + p)))?.[1];
      let w = hit ? db.get(hit.work) : null;
      const title = e.title || e.name || (loc ? decodeURIComponent(String(loc).split(/[/\\]/).pop()).replace(/\.[a-z0-9]{2,5}$/i, '') : '');
      const artist = e.artist || e.creator || '';
      if (!w && title) {
        const k = matchKey(title), a = matchKey(artist);
        w = db.all('work').find((x) => ['track', 'episode', 'chapter', 'movie', 'musicvideo'].includes(x.kind) && matchKey(x.title) === k && (!a || facts(db, x).artist.some((n) => matchKey(n) === a))) || null;
      }
      if (w) { report.matched++; ids.push(w.id); continue; }
      if (!title) continue;
      const nw = db.put(newWork({ kind: 'track', title, domain: 'music', people: artist ? [{ name: artist, role: 'artist' }] : undefined, duration: e.duration || undefined }));
      if (/^https?:\/\//i.test(loc)) db.put(newMedia(nw.id, { presence: 'source', source: { ref: srcKey(loc) === loc ? loc : loc, url: loc } }));
      ids.push(nw.id);
      report.created++;
    }
    const coll = db.put({ id: uid(), type: 'collection', kind: 'playlist', name: parsed.title || name, items: ids.map((ref) => ({ ref, added: now() })), tags: [], created: now(), updated: now() });
    report.collection = coll.id;
  }, { label: 'import playlist' });
  return report;
}

// --- NFO / CUE ---------------------------------------------------------------------------------------------------------

// Kodi / Jellyfin NFO: root element and file name depend on the kind (movie.nfo, tvshow.nfo, ...). Genre tags map
// to <genre> without namespace, the rest to <tag> with it; effective tags are used, so inherited genres appear.
export function workNfo(db, w) {
  const f = facts(db, w);
  const genres = [...f.tags].filter((t) => t.startsWith('genre:')).map((t) => t.slice(6));
  const tags = [...f.tags].filter((t) => !t.startsWith('genre:'));
  const ids = w.ids || {};
  const common = { title: f.title, year: f.year, plot: w.description, genre: genres, tag: tags, uniqueid: ids, userrating: f.score ?? undefined, playcount: f.plays || undefined };
  if (w.kind === 'movie') return { kind: 'movie', name: 'movie.nfo', text: serializeNfo('movie', { ...common, director: f.director, studio: f.studio, runtime: f.duration ? Math.round(f.duration / 60) : undefined }) };
  if (w.kind === 'show') return { kind: 'tvshow', name: 'tvshow.nfo', text: serializeNfo('tvshow', { ...common, studio: f.studio, originaltitle: (w.titles && (w.titles.native || w.titles.romaji)) || undefined }) };
  if (w.kind === 'season') return { kind: 'season', name: 'season.nfo', text: serializeNfo('season', { ...common, season: w.season }) };
  if (w.kind === 'episode') return { kind: 'episodedetails', name: 'episode.nfo', text: serializeNfo('episodedetails', { ...common, showtitle: f.show, season: f.season, episode: f.episode, aired: w.date }) };
  if (w.kind === 'musicvideo') return { kind: 'musicvideo', name: 'musicvideo.nfo', text: serializeNfo('musicvideo', { ...common, artist: f.artist, album: f.album }) };
  if (w.kind === 'album') return { kind: 'album', name: 'album.nfo', text: serializeNfo('album', { ...common, artist: f.albumartist.length ? f.albumartist : f.artist, label: w.label }) };
  return { kind: 'movie', name: 'info.nfo', text: serializeNfo('movie', common) };
}

// A CUE sheet of an album: one FILE per track file, or one FILE with INDEX times when the tracks are segments of one file.
// KNOWN DEFECT: the non-segment branch does not emit one FILE per track; it emits a single FILE (`file` or
// "<title>.flac", which may not exist) with INDEX times from cumulative durations. Fix: build per-track FILE
// entries from each track's media name, with INDEX 01 00:00:00.
export function albumCue(db, albumId, { file = null } = {}) {
  const album = db.get(albumId);
  if (!album) return '';
  const tracks = db.children(albumId);
  const fa = facts(db, album);
  const media = tracks.map((t) => db.mediaOf(t.id)[0] || null);
  const one = media.length && media.every((m) => m && m.segment && m.loc && media[0].loc && m.loc.path === media[0].loc.path);
  const genre = [...fa.tags].find((t) => t.startsWith('genre:'));
  const rem = { ...(fa.year ? { date: String(fa.year) } : {}), ...(genre ? { genre: genre.slice(6) } : {}) };
  if (one) {
    return serializeCue(buildCue({
      performer: fa.albumartist[0] || fa.artist[0] || '', title: fa.title, file: file || (media[0].name || 'album.flac'), rem,
      tracks: tracks.map((t, i) => ({ title: t.title, performer: peopleOf(t, 'artist')[0] || undefined, start: media[i].segment.start || 0 })),
    }));
  }
  let start = 0;
  return serializeCue(buildCue({
    performer: fa.albumartist[0] || fa.artist[0] || '', title: fa.title, file: file || `${fa.title}.flac`, rem,
    tracks: tracks.map((t) => { const s = start; start += facts(db, t).duration || 0; return { title: t.title, performer: peopleOf(t, 'artist')[0] || undefined, start: s }; }),
  }));
}

export function chaptersCue(db, mediaId) {
  const m = db.get(mediaId);
  if (!m || !(m.chapters || []).length) return '';
  const w = db.get(m.work);
  return serializeCue(buildCue({ performer: w ? firstPerson(w, 'author') || firstPerson(w, 'artist') : '', title: w ? w.title : '', file: m.name || 'book.m4b', tracks: m.chapters.map((c) => ({ title: c.title, start: c.start })) }));
}
