// catalog/indexer.js - index sources and their rules: files from a folder of the backend / Electron, a File System
// Access directory, the file API of another server, a list of links or a yt-dlp playlist / channel become works and
// media in the catalogue. Pure: the caller supplies the file system through `io`.
//
// Source node: { type: 'source', kind: 'folder' | 'fsa' | 'remote' | 'links' | 'ytdlp', name, loc, hint ('auto' |
//   'music' | 'audiobook' | 'series' | 'anime' | 'movie' | 'musicvideo' | 'podcast'), include: [globs],
//   exclude: [globs], templates: [{ tpl, kind? } | 'tpl'], order: ['template', 'tags', 'nfo', 'name', 'folder']
//   (field precedence, first wins), useTags, useSidecars, hashMode ('none' | 'quick'), removeMissing, enabled,
//   lastScan, stats }
// Manual overrides: the fields listed in a work's `locked` are never changed by a scan (the editor locks what the user
// edits); everything else follows the latest scan.
//
//   newSource(kind, fields) -> node ; SOURCE_KINDS, HINTS, DEFAULT_EXCLUDE, TEMPLATE_PRESETS, FIELD_ORDER
//   async scanSource(db, source, io, { onProgress, signal, now }) -> report
//     io = { list(): [{ path, size, mtime }] (every file, relative '/' paths), readMedia(path, entry): MediaInfo | null,
//            readText(path): string | null, loc(path): loc (where the file is: { kind: 'fs', mount, path } …),
//            hash?(path, entry): string, saveCover?({ mime, data }, path): cover ref (embedded pictures), concurrency = 4 }
//     readMedia is called with the cover wanted when saveCover exists; the embedded picture becomes the media's cover
//     and, when its folder has no cover file, the album's / book's.
//     report { listed, considered, added, updated, unchanged, moved, missing, removed, errors: [{ path, error }],
//              created: { works, media }, ms }
//   planScan(db, source, entries) -> { add, change, same, gone }
//   analyzeFile(entry, ctx) -> { kind, domain, fields, provenance }      (exported for the rule editor's preview)
//   previewRules(source, paths) -> [{ path, kind, domain, fields, provenance }]   (names and templates only)
//   indexLinks(db, source, links: [{ url, title }] | text) -> { added, existing }
//   indexYtdlp(db, source, info) -> { added, existing, playlist }   info: mediajobs/ytdlp.js infoToCatalog(...)
//   workKey(kind, fields, domain) -> the ixKey of a work (shared with imports and manual creation)
//
// Scan pipeline (scanSource), each phase cheap before expensive:
//   list -> include / exclude globs -> plan (diff against media of this source by path, size, mtime) -> hash
//   reconnect of moved files -> read tags and sidecars only for added / changed files (bounded concurrency) ->
//   folder pre-pass (compilations) -> one db.batch that places works, writes media, marks missing files.
// Rescanning an unchanged library therefore costs one directory listing and no file reads.
//
// Field resolution: several evidence sets (template match, embedded tags, NFO, file-name parser, folder names) each
// propose fields; `order` decides precedence per field, first non-empty wins, and `provenance` records the winner
// so the rule editor can show where each value came from. Precedence is per field, not per set, so a file with
// tags but no track number still gets its number from the name.
//
// Identity: works are found again by ixKey (workKey), a normalised composite of the identifying fields, so a rescan
// updates the same nodes instead of duplicating. Consequence: editing an identifying field in the tags (say the
// title, part of the track key) yields a new key, a new work, and the old work is left behind without media; lock
// the field in the editor to avoid it.
//
// Pure with respect to I/O: every filesystem call goes through `io`, so the same code indexes a backend folder, an
// FSA handle in the browser or a remote server, and tests run on an in-memory listing.

import { newWork, newMedia, uid, now, matchKey, setPeople } from './model.js';
import { kindOf } from '../mediatags/detect.js';
import { parseName } from '../mediatags/names.js';
import { compileTemplate } from '../mediatags/template.js';
import { groupSidecars } from '../mediatags/sidecar.js';
import { parseNfo } from '../mediatags/nfo.js';
import { parseCue, cueTracks } from '../mediatags/cue.js';
import { parseLrc } from '../mediatags/lrc.js';
import { filterPaths } from '../fileapi/glob.js';
import { parseSource, formatSource } from '../mediajobs/ytdlp.js';
import { attachFile, markMissing } from './presence.js';
import { srcKey } from './db.js';

export const SOURCE_KINDS = ['folder', 'fsa', 'remote', 'links', 'ytdlp'];
export const HINTS = ['auto', 'music', 'audiobook', 'series', 'anime', 'movie', 'musicvideo', 'podcast'];
export const FIELD_ORDER = ['template', 'tags', 'nfo', 'name', 'folder'];
// Default excludes: dotfiles, NAS metadata (@eaDir = Synology), Windows system folders, partial downloads, and
// "sample" clips that scene releases put next to the real film.
export const DEFAULT_EXCLUDE = ['.*', '@eaDir', '$RECYCLE.BIN', 'System Volume Information', '*.part', '*.tmp', '*.crdownload', 'Thumbs.db', 'desktop.ini', '*sample*.mkv'];
export const TEMPLATE_PRESETS = {
  music: ['{albumartist}/{year} - {album}/{disc}-{track:02} {title}.{ext}', '{albumartist}/{year} - {album}/{track:02} {title}.{ext}', '{albumartist}/{album}/{track:02} - {title}.{ext}', '{albumartist}/{album}/{track:02} {title}.{ext}'],
  audiobook: ['{author}/{series} {seriesPart} - {album}/{chapter} {title}.{ext}', '{author}/{album}/{chapter} {title}.{ext}', '{author}/{album}/{chapter}.{ext}'],
  series: ['{show}/Season {season}/{show} - S{season:02}E{episode:02} - {title}.{ext}', '{show}/Season {season}/S{season:02}E{episode:02}.{ext}'],
  anime: ['{show}/S{season:02}E{episode:02}.{ext}', 'Anime/{show}/{episode:02}.{ext}'],
  movie: ['{title} ({year})/{_}.{ext}', '{title} ({year}).{ext}'],
  musicvideo: ['{artist} - {title}.{ext}'],
  podcast: ['{album}/{date} {title}.{ext}'],
};

export function newSource(kind, fields = {}) {
  const t = now();
  return {
    id: uid(), type: 'source', kind: SOURCE_KINDS.includes(kind) ? kind : 'folder', name: '', hint: 'auto',
    include: [], exclude: DEFAULT_EXCLUDE.slice(), templates: [], order: FIELD_ORDER.slice(), useTags: true, useSidecars: true,
    hashMode: 'none', removeMissing: false, enabled: true, created: t, updated: t, tags: [], ...fields,
  };
}

const mk = matchKey;
const first = (...xs) => xs.find((x) => x !== undefined && x !== null && x !== '' && !(Array.isArray(x) && !x.length));
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);
const stemOf = (p) => baseOf(p).replace(/\.[^.]+$/, '');
const extOf = (p) => (/\.([^./]+)$/.exec(p) || ['', ''])[1].toLowerCase();
// Folder names that denote a season / disc level rather than a title, in several languages. "Specials" / "Extras"
// carry no number: group 2 is undefined and folderFields maps them to season 0 (special).
const SEASON_DIR = /^(season|staffel|saison|temporada|сезон|series|s)\s*0*(\d{1,3})$|^specials?$|^extras?$/i;
const DISC_DIR = /^(cd|disc|disk|диск)\s*0*(\d{1,2})$/i;

// Hints from the folders of a path. Whole path segments only ((^|/) ... (/|$)), so "Music" matches a folder named
// Music but not "Musical Theatre". Checked in a deliberate order: the more specific libraries (audiobooks, anime,
// podcasts, music videos) before the generic ones (music, tv), since "Music/Audiobooks/..." is an audiobook.
function folderHint(path) {
  const p = path.toLowerCase();
  if (/(^|\/)(audio ?books?|hörbücher|hörbuch|livres audio|audiolibros|аудиокниги|аудіокниги)(\/|$)/.test(p)) return 'audiobook';
  if (/(^|\/)(anime|аниме|アニメ)(\/|$)/.test(p)) return 'anime';
  if (/(^|\/)(podcasts?|подкасты)(\/|$)/.test(p)) return 'podcast';
  if (/(^|\/)(music ?videos?|clips|клипы|videoclips)(\/|$)/.test(p)) return 'musicvideo';
  if (/(^|\/)(movies|films|filme|кино|фильмы|películas)(\/|$)/.test(p)) return 'movie';
  if (/(^|\/)(tv|tv ?shows|series|serien|séries|сериалы|серіали)(\/|$)/.test(p)) return 'series';
  if (/(^|\/)(music|musik|musique|música|музыка|музика)(\/|$)/.test(p)) return 'music';
  return null;
}

// Folder context: album / show / book names from the folders around a file.
// Walks up from the file: an optional disc folder, an optional season folder, then the title folder (parent) and
// the one above it (grand). "2019 - Album" and "Album (2019)" both yield name + year. The grandparent becomes the
// album artist / author unless it is itself a library root ("Music"), which folderHint recognises.
function folderFields(path, hint) {
  const dirs = dirOf(path).split('/').filter(Boolean);
  const out = {};
  let i = dirs.length - 1;
  if (i >= 0 && DISC_DIR.test(dirs[i])) { out.disc = Number(DISC_DIR.exec(dirs[i])[2]); i--; }
  if (i >= 0 && SEASON_DIR.test(dirs[i])) {
    const m = SEASON_DIR.exec(dirs[i]);
    out.season = m[2] ? Number(m[2]) : 0;
    if (!m[2]) out.special = true;
    i--;
  }
  const parent = dirs[i] || '';
  const grand = dirs[i - 1] || '';
  const ym = /^(\d{4})\s*[-–.]\s*(.+)$/.exec(parent) || /^(.+?)\s*[([](\d{4})[)\]]$/.exec(parent);
  const name = ym ? (/^\d{4}$/.test(ym[1]) ? ym[2] : ym[1]) : parent;
  const year = ym ? Number(/^\d{4}$/.test(ym[1]) ? ym[1] : ym[2]) : undefined;
  if (hint === 'series' || hint === 'anime' || hint === 'podcast') { if (name) out.show = name; if (year) out.year = year; }
  else if (hint === 'movie') { if (name && !/^(movies|films)$/i.test(name)) { out.title = name; if (year) out.year = year; } }
  else if (hint === 'audiobook') { if (name) out.album = name; if (grand) out.author = [grand]; }
  else { if (name) out.album = name; if (year) out.year = year; if (grand && !folderHint(grand)) out.albumartist = grand; }
  return out;
}

const asList = (v) => (v === undefined || v === null || v === '' ? undefined : Array.isArray(v) ? v.filter(Boolean) : [v]);

// Embedded tags -> neutral field names. Multi-value tags become arrays; MusicBrainz ids become external ids. A
// genre containing "audiobook" flags the file as a book even when it is an .mp3 in a music-looking folder.
function tagFields(info) {
  if (!info || !info.tags) return {};
  const t = info.tags;
  const f = {
    title: t.title, artist: asList(t.artists && t.artists.length ? t.artists : t.artist), albumartist: t.albumArtist, album: t.album,
    year: t.year ?? (t.date ? Number(String(t.date).slice(0, 4)) || undefined : undefined), date: t.date, track: t.track, trackTotal: t.trackTotal,
    disc: t.disc, discTotal: t.discTotal, genre: asList(t.genre), composer: asList(t.composer), compilation: t.compilation || undefined,
    bpm: t.bpm, language: t.language, description: t.description || t.comment, lyrics: t.lyrics, show: t.show, season: t.season, episode: t.episode,
    episodeTitle: t.episodeTitle, narrator: asList(t.narrator), author: asList(t.author), series: t.series, seriesPart: t.seriesPart, mood: t.mood,
  };
  if (t.mb) f.ids = Object.fromEntries(Object.entries({ mb: t.mb.recordingId || t.mb.trackId, mbalbum: t.mb.albumId, mbrg: t.mb.releaseGroupId }).filter(([, v]) => v));
  if (/audiobook|hörbuch|livre audio|аудиокнига/i.test((f.genre || []).join(' '))) f.isBook = true;
  return f;
}

function nfoFields(nfo) {
  if (!nfo || !nfo.fields) return {};
  const x = nfo.fields;
  const f = {
    title: x.title, originalTitle: x.originaltitle, sortTitle: x.sorttitle, year: x.year, date: x.premiered || x.aired, description: x.plot || x.outline,
    genre: asList(x.genre), director: asList(x.director), studio: asList(x.studio), season: x.season, episode: x.episode, show: x.showtitle,
    artist: asList(x.artist), album: x.album, track: x.track, cast: Array.isArray(x.actor) ? x.actor : undefined, tags: asList(x.tag),
  };
  if (x.uniqueid) f.ids = Object.fromEntries(Object.entries(x.uniqueid).filter(([k, v]) => v && k !== 'default'));
  if (x.userrating) f.rating = Number(x.userrating);
  return f;
}

// File-name parser output (release-name conventions: S01E02, [Group], 1080p, CRC ...). The `n.kind === 'episode'`
// ternary on title is a no-op (both branches identical). sourceTag renames `source` to avoid clashing with the
// catalogue's own `source` field.
function nameFields(n) {
  if (!n) return {};
  return {
    title: n.kind === 'episode' ? n.title : n.title, show: n.show, season: n.season, episode: n.episode, episodeEnd: n.episodeEnd, absolute: n.absolute,
    special: n.special || undefined, extra: n.extra, version: n.version, year: n.year, group: n.group, resolution: n.resolution, sourceTag: n.source,
    vcodec: n.vcodec, acodec: n.acodec, crc: n.crc, edition: n.edition, track: n.track, disc: n.disc, artist: asList(n.artist), album: n.album,
    chapter: n.chapter, part: n.part, partTotal: n.partTotal, nameKind: n.kind,
  };
}

function compileTemplates(source) {
  const list = Array.isArray(source.templates) ? source.templates : [];
  const out = [];
  for (const t of list) {
    const tpl = typeof t === 'string' ? t : t && t.tpl;
    if (!tpl) continue;
    try { out.push({ c: compileTemplate(tpl), kind: typeof t === 'object' ? t.kind : undefined }); } catch { /* invalid templates are reported by the editor */ }
  }
  return out;
}

// First matching template wins (list order = user priority). Person / genre fields are normalised to arrays so
// downstream code never branches on string vs array.
function templateFields(path, templates) {
  for (const t of templates) {
    const m = t.c.match(path);
    if (m) {
      const f = { ...m };
      for (const k of ['artist', 'author', 'narrator', 'composer', 'director', 'genre']) if (typeof f[k] === 'string') f[k] = [f[k]];
      if (t.kind) f.kindHint = t.kind;
      return f;
    }
  }
  return {};
}

// Kind / domain decision tree. Hint precedence: the source's explicit hint, then a template's kind, then the
// folder names, then a release-group tag ([Group] in the name is a strong anime signal). Then:
// - audio with book evidence (genre flag, .m4b, a narrator) is an audiobook: a single long file with chapters is a
//   whole 'book', otherwise each file is a 'chapter';
// - any other audio, or video under a music hint, is music (video -> musicvideo);
// - video: extras without an episode number are 'episode' + extra; episode / absolute numbers make an episode;
//   under series / anime hints a show name without a year means episode, otherwise a movie; with no hint, a year
//   or a movie-shaped name means movie.
function decideKind(path, f, hint, info, entryKind) {
  const isVideo = entryKind === 'video' || (info && info.kind === 'video');
  const fh = hint !== 'auto' ? hint : f.kindHint || folderHint(path) || (f.group ? 'anime' : null);
  if (fh === 'musicvideo') return { kind: 'musicvideo', domain: 'musicvideo' };
  if (fh === 'movie') return isVideo ? { kind: 'movie', domain: 'movie' } : { kind: 'track', domain: 'music' };
  if (fh === 'podcast') return { kind: 'episode', domain: 'podcast' };
  if (fh === 'audiobook' || (!isVideo && (f.isBook || extOf(path) === 'm4b' || (f.narrator && f.narrator.length)))) {
    const single = extOf(path) === 'm4b' || (info && info.chapters && info.chapters.length > 1 && (info.duration || 0) > 1800);
    return { kind: single ? 'book' : 'chapter', domain: 'audiobook' };
  }
  if (fh === 'music' || (!isVideo && fh !== 'series' && fh !== 'anime')) return { kind: isVideo ? 'musicvideo' : 'track', domain: isVideo ? 'musicvideo' : 'music' };
  const domain = fh === 'anime' ? 'anime' : 'series';
  if (f.extra && !f.episode) return { kind: 'episode', domain, extra: true };
  if (f.episode !== undefined || f.absolute !== undefined || f.nameKind === 'episode') return { kind: 'episode', domain };
  if (fh === 'series' || fh === 'anime') return f.show && !f.year ? { kind: 'episode', domain } : { kind: 'movie', domain: fh === 'anime' ? 'anime' : 'movie' };
  return { kind: f.nameKind === 'movie' || f.year ? 'movie' : 'episode', domain: f.nameKind === 'movie' || f.year ? 'movie' : domain };
}

// Two-step on purpose: kind is decided from a probe (name < tags < template, later spreads win), and only then are
// folder fields computed, because how a folder is read (album vs show vs book) depends on the kind. Then the
// per-field precedence merge described in the header. The user's `order` is completed with any missing sets so a
// partial order list cannot silently disable a source of evidence. NaN numbers (failed parses) count as empty.
export function analyzeFile(entry, ctx) {
  const { source, info = null, nfo = null, templates = compileTemplates(source) } = ctx;
  const hint = HINTS.includes(source.hint) ? source.hint : 'auto';
  const path = entry.path;
  const entryKind = kindOf(baseOf(path));
  const nameHint = hint === 'series' || hint === 'anime' || hint === 'movie' || hint === 'music' || hint === 'audiobook' ? hint : 'auto';
  const sets = {
    template: templateFields(path, templates),
    tags: source.useTags === false ? {} : tagFields(info),
    nfo: source.useSidecars === false ? {} : nfoFields(nfo),
    name: nameFields(parseName(path, { hint: nameHint })),
    folder: {},
  };
  const probe = { ...sets.name, ...sets.tags, ...sets.template };
  const { kind, domain, extra } = decideKind(path, probe, hint, info, entryKind);
  sets.folder = folderFields(path, domain === 'anime' || domain === 'series' ? 'series' : domain === 'podcast' ? 'podcast' : domain === 'movie' ? 'movie' : domain === 'audiobook' ? 'audiobook' : 'music');
  const order = (Array.isArray(source.order) && source.order.length ? source.order : FIELD_ORDER).filter((k) => sets[k]);
  for (const k of FIELD_ORDER) if (!order.includes(k)) order.push(k);
  const fields = {};
  const provenance = {};
  const keys = new Set(order.flatMap((k) => Object.keys(sets[k])));
  for (const key of keys) {
    for (const k of order) {
      const v = sets[k][key];
      if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length) && !(typeof v === 'number' && Number.isNaN(v))) { fields[key] = v; provenance[key] = k; break; }
    }
  }
  if (!fields.title) { fields.title = stemOf(path).replace(/[._]+/g, ' ').trim(); provenance.title = 'file'; }
  if (fields.episodeTitle && kind === 'episode') fields.title = fields.episodeTitle;
  if (kind === 'chapter' && fields.chapter === undefined && fields.track !== undefined) fields.chapter = fields.track;
  return { kind, domain, extra: !!extra, fields, provenance, info };
}

export function previewRules(source, paths) {
  const templates = compileTemplates(source);
  return paths.map((path) => { const a = analyzeFile({ path }, { source, templates }); return { path, kind: a.kind, domain: a.domain, fields: a.fields, provenance: a.provenance }; });
}

// --- keys and containers -----------------------------------------------------------------------------------------------

// Identity keys per kind: the minimal set of fields that tells two works apart within a library. All text parts go
// through matchKey so case / punctuation / diacritics differences in tags do not split one album into two.
// Shows and seasons include the domain (an anime and a live-action series may share a title). Episodes fall back
// to absolute number ('a' prefix keeps it distinct from a season episode number), then title; extras append
// their own suffix so "Extra: Interview" never collides with episode 1.
export function workKey(kind, f, domain = '') {
  switch (kind) {
    case 'album': return `album:${mk(f.albumartist)}|${mk(f.album)}`;
    case 'track': return `track:${mk(f.albumartist)}|${mk(f.album)}|${f.disc || 1}|${f.track ?? ''}|${mk(f.title)}`;
    case 'show': return `show:${domain}|${mk(f.show)}`;
    case 'season': return `season:${domain}|${mk(f.show)}|${f.season ?? 1}`;
    case 'episode': return `ep:${domain}|${mk(f.show)}|${f.special ? 0 : f.season ?? ''}|${f.episode ?? (f.absolute !== undefined ? 'a' + f.absolute : mk(f.title))}${f.extra ? '|x' + mk(f.extra + (f.title || '')) : ''}`;
    case 'movie': return `movie:${mk(f.title)}|${f.year || ''}`;
    case 'musicvideo': return `mv:${mk((f.artist || [])[0])}|${mk(f.title)}`;
    case 'book': return `book:${mk((f.author || [])[0])}|${mk(f.album || f.title)}`;
    case 'chapter': return `ch:${mk((f.author || [])[0])}|${mk(f.album)}|${f.chapter ?? ''}|${mk(f.title)}`;
    case 'bookseries': return `bseries:${mk((f.author || [])[0])}|${mk(f.series)}`;
    case 'podcast': return `podcast:${mk(f.album || f.show)}`;
    default: return `${kind}:${mk(f.title)}`;
  }
}

// Finds or creates a container (album, show, season, book, series, podcast) and updates unlocked fields.
// Lookup: exact ixKey first; then title keys, so a show created earlier by a MAL import (interop.js, title only)
// adopts the scanned files. A title hit carrying a *different* ixKey is rejected except for shows: two albums named
// "Greatest Hits" by different artists must stay apart, while a show's title is identity enough.
// Patches only fields that differ (JSON comparison) and never overwrite locked fields or an existing cover:
// rescans must be idempotent and must not churn `updated` (which would win sync conflicts spuriously).
function container(db, kind, key, titleKeys, fields, report) {
  let id = db.find('ix:' + key);
  if (!id) for (const t of titleKeys) { if (!t) continue; id = db.find(`t:${kind}:${mk(t)}`); if (id && db.get(id).ixKey && db.get(id).ixKey !== key && kind !== 'show') id = null; if (id) break; }
  if (id) {
    const w = db.get(id);
    const patch = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined || (w.locked || []).includes(k) || (k === 'cover' && w.cover)) continue;
      if (JSON.stringify(w[k]) !== JSON.stringify(v)) patch[k] = v;
    }
    if (!w.ixKey) patch.ixKey = key;
    if (Object.keys(patch).length) { db.patch(id, patch); report.updatedWorks++; }
    return db.get(id);
  }
  report.created.works++;
  return db.put(newWork({ kind, ixKey: key, ...fields }));
}

function applyWorkFields(db, w, fields, report) {
  const patch = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || (w.locked || []).includes(k)) continue;
    if (JSON.stringify(w[k]) !== JSON.stringify(v)) patch[k] = v;
  }
  if (Object.keys(patch).length) { db.patch(w.id, patch); report.updatedWorks++; }
  return db.get(w.id);
}

function peopleList(roles) {
  const out = [];
  for (const [role, names] of Object.entries(roles)) for (const n of names || []) if (n && !out.some((p) => p.role === role && mk(p.name) === mk(n))) out.push({ name: String(n), role });
  return out.length ? out : undefined;
}

// Genre strings are split on ; / | (common multi-genre separators in ID3). Purely numeric genres like "(17)" are
// ID3v1 index codes not resolved here and are dropped rather than stored as meaningless tags.
// Note: '/' splitting means "Rock/Punk" becomes two flat genres, not the hierarchical 'genre:rock/punk' tag.
function genreTags(f) {
  const tags = [];
  for (const g of f.genre || []) for (const part of String(g).split(/\s*[;/|]\s*/)) if (part && !/^\(?\d+\)?$/.test(part)) tags.push('genre:' + part.toLowerCase());
  if (f.mood) tags.push('mood:' + String(f.mood).toLowerCase());
  for (const t of f.tags || []) tags.push(String(t));
  return tags;
}

// Places an analyzed file in the catalogue: its work (and containers) and returns the work to attach media to.
// Per family: music (album via container, track; compilations get "Various Artists" so their tracks share one
// album instead of one album per artist), episodes (show / podcast, optional season, episode), movies (matched by
// key or title, but a different year means a remake: new work), books / chapters (optional series, book,
// chapter ordered by number or by position in the folder). Genre tags go on the album rather than every track
// (inheritance in tags.js spreads them), and only when the album has no tags yet so user edits are not undone.
// A track's own artist list is stored only when it differs from the album artist, avoiding redundant people.
function placeWork(db, a, report, extras) {
  const f = { ...a.fields };
  const tags = genreTags(f);
  const base = { domain: a.domain };
  if (a.kind === 'track' || a.kind === 'musicvideo') {
    const artists = f.artist || (f.albumartist ? [f.albumartist] : []);
    if (a.kind === 'musicvideo') {
      const k = workKey('musicvideo', { artist: artists, title: f.title });
      const id = db.find('ix:' + k);
      const fields = { ...base, title: f.title, year: f.year, people: peopleList({ artist: artists, director: f.director }), description: f.description };
      if (id) return applyWorkFields(db, db.get(id), fields, report);
      report.created.works++;
      return db.put(newWork({ kind: 'musicvideo', ixKey: k, tags, ...fields }));
    }
    const albumartist = f.albumartist || (extras.compilation || f.compilation ? 'Various Artists' : artists[0] || '');
    const albumTitle = f.album || '';
    let album = null;
    if (albumTitle) {
      album = container(db, 'album', workKey('album', { albumartist, album: albumTitle }), [], {
        ...base, title: albumTitle, year: f.year, people: peopleList({ albumartist: albumartist ? [albumartist] : [] }), compilation: extras.compilation || f.compilation || undefined,
        discTotal: f.discTotal, cover: extras.folderCover,
      }, report);
      if (tags.length && !(album.tags || []).length) db.patch(album.id, { tags: tags.filter((t) => t.startsWith('genre:')) });
    }
    const k = workKey('track', { albumartist, album: albumTitle, disc: f.disc, track: f.track, title: f.title });
    const fields = {
      ...base, title: f.title, parent: album ? album.id : undefined, order: f.track, disc: f.disc, year: album ? undefined : f.year, bpm: f.bpm, language: f.language,
      people: peopleList({ artist: artists.length && mk(artists.join()) !== mk(albumartist) ? artists : album ? [] : artists, composer: f.composer }),
      lyrics: f.lyrics || extras.lrc ? { text: f.lyrics || undefined, lrc: extras.lrc || undefined } : undefined, ids: f.ids,
    };
    const id = db.find('ix:' + k);
    if (id) return applyWorkFields(db, db.get(id), fields, report);
    report.created.works++;
    return db.put(newWork({ kind: 'track', ixKey: k, tags: tags.filter((t) => !t.startsWith('genre:') || !album), ...fields }));
  }
  if (a.kind === 'episode') {
    const showTitle = f.show || f.album || 'Unknown';
    const isPodcast = a.domain === 'podcast';
    const show = container(db, isPodcast ? 'podcast' : 'show', workKey(isPodcast ? 'podcast' : 'show', { show: showTitle, album: showTitle }, a.domain), [showTitle], {
      ...base, title: showTitle, year: extras.showNfo ? extras.showNfo.year : undefined, description: extras.showNfo ? extras.showNfo.description : undefined,
      ids: extras.showNfo ? extras.showNfo.ids : undefined, cover: extras.showCover,
    }, report);
    if (tags.length && !(show.tags || []).length && extras.showNfo) db.patch(show.id, { tags: genreTags(extras.showNfo) });
    let parent = show;
    const hasSeason = !isPodcast && (f.season !== undefined || a.domain === 'series' || f.special);
    const seasonNo = f.special ? 0 : f.season ?? 1;
    if (hasSeason) parent = container(db, 'season', workKey('season', { show: showTitle, season: seasonNo }, a.domain), [], { ...base, title: seasonNo === 0 ? 'Specials' : `Season ${seasonNo}`, season: seasonNo, parent: show.id, special: seasonNo === 0 || undefined, cover: extras.seasonCover }, report);
    const k = workKey('episode', { show: showTitle, season: hasSeason ? seasonNo : undefined, special: f.special, episode: f.episode, absolute: f.absolute, title: f.title, extra: a.extra ? f.extra || 'extra' : undefined }, a.domain);
    const fields = {
      ...base, title: f.title, parent: parent.id, season: hasSeason ? seasonNo : undefined, episode: f.episode, episodeEnd: f.episodeEnd, absolute: f.absolute,
      special: f.special || a.extra || undefined, date: f.date, year: f.year && !hasSeason ? f.year : undefined, description: f.description, ids: f.ids,
      order: f.episode === undefined && f.absolute === undefined ? f.track : undefined,
    };
    const id = db.find('ix:' + k);
    if (id) return applyWorkFields(db, db.get(id), fields, report);
    report.created.works++;
    return db.put(newWork({ kind: 'episode', ixKey: k, tags: a.extra ? ['extra:' + String(f.extra || 'extra').toLowerCase()] : [], ...fields }));
  }
  if (a.kind === 'movie') {
    const k = workKey('movie', f);
    const fields = { ...base, title: f.title, year: f.year, description: f.description, ids: f.ids, people: peopleList({ director: f.director, studio: f.studio }), edition: f.edition, cover: extras.folderCover };
    let id = db.find('ix:' + k) || db.find(`t:movie:${mk(f.title)}`);
    if (id && db.get(id).year && f.year && db.get(id).year !== f.year) id = null;
    if (id) return applyWorkFields(db, db.get(id), { ...fields, ixKey: db.get(id).ixKey || k }, report);
    report.created.works++;
    return db.put(newWork({ kind: 'movie', ixKey: k, tags, ...fields }));
  }
  if (a.kind === 'book' || a.kind === 'chapter') {
    const author = f.author || (f.albumartist ? [f.albumartist] : f.artist) || [];
    const bookTitle = a.kind === 'book' ? f.album || f.title : f.album || 'Unknown book';
    let parent;
    if (f.series) parent = container(db, 'bookseries', workKey('bookseries', { author, series: f.series }), [f.series], { ...base, title: f.series, people: peopleList({ author }) }, report);
    const book = container(db, 'book', workKey('book', { author, album: bookTitle }), parent ? [] : [bookTitle], {
      ...base, title: bookTitle, parent: parent ? parent.id : undefined, order: f.seriesPart !== undefined ? Number(f.seriesPart) || undefined : undefined,
      people: peopleList({ author, narrator: f.narrator }), year: f.year, description: a.kind === 'book' ? f.description : undefined, cover: extras.folderCover,
    }, report);
    if (a.kind === 'book') return book;
    const k = workKey('chapter', { author, album: bookTitle, chapter: f.chapter, title: f.title });
    const fields = { ...base, title: f.title, parent: book.id, order: f.chapter !== undefined ? Number(f.chapter) || extras.index : extras.index };
    const id = db.find('ix:' + k);
    if (id) return applyWorkFields(db, db.get(id), fields, report);
    report.created.works++;
    return db.put(newWork({ kind: 'chapter', ixKey: k, ...fields }));
  }
  report.created.works++;
  return db.put(newWork({ kind: a.kind, title: f.title, ...base }));
}

// The media record of a file. `missing: undefined` clears a stale missing flag (db.patch deletes undefined keys).
// Quality / version labels come from the file name (release conventions), so choosePlayable (presence.js) can
// prefer a version or quality. Note: an edition overrides a numeric version (v2) when both are present.
function mediaFields(entry, info, source, loc, extras) {
  const m = { loc, sourceId: source.id, name: baseOf(entry.path), path: entry.path, size: entry.size, mtime: entry.mtime, scanned: now(), missing: undefined, presence: 'file' };
  if (info) {
    Object.assign(m, { container: info.container || undefined, mime: info.mime || undefined, kind: info.kind || undefined, duration: info.duration || undefined, bitrate: info.bitrate || undefined,
      audio: info.audio || undefined, video: info.video || undefined, streams: info.streams && info.streams.length ? info.streams : undefined,
      chapters: info.chapters && info.chapters.length ? info.chapters : undefined, replaygain: info.replaygain || undefined });
    if (info.tags && info.tags.bpm) m.bpm = info.tags.bpm;
  }
  if (!m.kind) m.kind = kindOf(m.name) === 'video' ? 'video' : 'audio';
  if (extras.subs && extras.subs.length) m.subs = extras.subs;
  if (extras.cover) m.cover = extras.cover;
  if (extras.segment) m.segment = extras.segment;
  if (extras.hash) m.hash = extras.hash;
  const n = parseName(entry.path, {});
  const q = [n.resolution, n.source, n.vcodec, n.hdr].filter(Boolean).join(' ');
  if (q) m.quality = q;
  if (n.version) m.version = 'v' + n.version;
  if (n.edition) m.version = n.edition;
  if (n.group) m.ext = { group: n.group, crc: n.crc };
  return m;
}

// Diff of a listing against this source's media, keyed by relative path. Change detection is size + mtime at
// whole-second resolution: file APIs report mtime with different precision (ms, s, FAT's 2 s), and comparing raw
// values would mark every file changed when switching between them. FAT's 2 s granularity can still flip a
// second boundary; the cost is one unnecessary re-read. A media flagged missing is always re-processed so it is
// cleared. Paths left in `existing` at the end are gone.
export function planScan(db, source, entries) {
  const existing = new Map();
  for (const m of db.all('media')) if (m.sourceId === source.id && m.path) { if (!existing.has(m.path)) existing.set(m.path, []); existing.get(m.path).push(m); }
  const add = [], change = [], same = [];
  for (const e of entries) {
    const list = existing.get(e.path);
    if (!list) { add.push(e); continue; }
    existing.delete(e.path);
    const m = list[0];
    if (m.size !== e.size || Math.floor((m.mtime || 0) / 1000) !== Math.floor((e.mtime || 0) / 1000) || m.missing) change.push({ entry: e, media: list });
    else same.push({ entry: e, media: list });
  }
  return { add, change, same, gone: [...existing.values()].flat() };
}

// Bounded-concurrency worker pool: n async loops pull from a shared index. The `i++` is safe without locks because
// JS is single-threaded and the read-increment happens synchronously between awaits. Bounded because unbounded
// Promise.all over 50 000 files would open every file handle at once. Abort is checked between items.
async function pool(items, n, fn, signal) {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    while (i < items.length) {
      if (signal && signal.aborted) throw new Error('aborted');
      const k = i++;
      await fn(items[k], k);
    }
  });
  await Promise.all(workers);
}

export async function scanSource(db, source, io, { onProgress = () => {}, signal = null } = {}) {
  const t0 = now();
  const report = { listed: 0, considered: 0, added: 0, updated: 0, unchanged: 0, moved: 0, missing: 0, removed: 0, errors: [], created: { works: 0, media: 0 }, updatedWorks: 0, ms: 0 };
  onProgress({ phase: 'list', done: 0, total: 0 });
  const all = await io.list();
  report.listed = all.length;
  const paths = all.map((e) => e.path);
  const allowed = new Set(filterPaths(paths, { include: source.include || [], exclude: source.exclude || [] }));
  const byPath = new Map(all.map((e) => [e.path, e]));
  const side = source.useSidecars === false ? { media: new Map(), folders: new Map() } : groupSidecars(paths);
  const mediaEntries = all.filter((e) => allowed.has(e.path) && ['audio', 'video'].includes(kindOf(baseOf(e.path))));
  report.considered = mediaEntries.length;
  const plan = planScan(db, source, mediaEntries);
  const work = [...plan.add.map((e) => ({ entry: e, media: null })), ...plan.change];
  report.unchanged = plan.same.length;

  // Hashes reconnect moved files (a renamed / moved file keeps its work, tracking and position).
  // Only new paths are hashed, and only when something disappeared: no gone media means no possible move. Hashing
  // here is sequential (not pooled); acceptable because typical moves touch few files, but a large reorganisation
  // will be slow.
  const gone = plan.gone.slice();
  if (source.hashMode && source.hashMode !== 'none' && io.hash && gone.length) {
    const goneByHash = new Map();
    for (const m of gone) if (m.hash) goneByHash.set(m.hash, m);
    for (const item of work) {
      if (item.media) continue;
      try { item.hash = await io.hash(item.entry.path, item.entry); } catch { item.hash = null; }
      const m = item.hash && goneByHash.get(item.hash);
      if (m) { item.media = [m]; item.moved = true; gone.splice(gone.indexOf(m), 1); goneByHash.delete(item.hash); }
    }
  }

  // Read tags and sidecar texts (bounded concurrency).
  // readText memoises the *promise* per path, so concurrent workers asking for the same folder.cue or tvshow.nfo
  // share one read instead of racing to read it N times. Read errors become null: one unreadable sidecar must not
  // abort a library scan. Embedded cover bytes are handed to saveCover and then dropped from info to free memory
  // before the apply phase.
  let done = 0;
  const texts = new Map();
  const readText = async (p) => {
    if (!p || !io.readText) return null;
    if (!texts.has(p)) texts.set(p, Promise.resolve().then(() => io.readText(p)).catch(() => null));
    return texts.get(p);
  };
  await pool(work, io.concurrency || 4, async (item) => {
    try {
      item.info = source.useTags === false || !io.readMedia ? null : await io.readMedia(item.entry.path, item.entry);
    } catch (e) { item.info = null; report.errors.push({ path: item.entry.path, error: String(e && e.message || e) }); }
    const sc = side.media.get(item.entry.path) || {};
    const folder = side.folders.get(dirOf(item.entry.path)) || {};
    item.sc = sc;
    item.folder = folder;
    if (sc.nfo) { const t = await readText(sc.nfo); item.nfo = t ? parseNfo(t) : null; }
    const cuePath = sc.cue || (folder.cue && folder.cue.length === 1 && kindOf(baseOf(item.entry.path)) === 'audio' ? folder.cue[0] : null);
    if (cuePath) {
      const t = await readText(cuePath);
      const cue = t ? parseCue(t) : null;
      if (cue && cue.files.some((f) => mk(stemOf(f.name)) === mk(stemOf(item.entry.path)) || cue.files.length === 1)) item.cue = cue;
    }
    if (sc.lyrics) { const t = await readText(sc.lyrics); if (t) item.lrc = t; }
    if (io.saveCover && item.info && item.info.cover && item.info.cover.data) {
      try { item.embeddedCover = await io.saveCover(item.info.cover, item.entry.path); } catch { item.embeddedCover = null; }
      item.info = { ...item.info, cover: null };
    }
    if (kindOf(baseOf(item.entry.path)) === 'video') {
      const d = dirOf(item.entry.path);
      const up = SEASON_DIR.test(baseOf(d)) ? dirOf(d) : d;
      const sf = side.folders.get(up) || {};
      if (sf.nfo && sf.nfo.tvshow) { const t = await readText(sf.nfo.tvshow); const n = t ? parseNfo(t) : null; if (n && n.kind === 'tvshow') item.showNfo = nfoFields(n); }
    }
    if (!item.hash && source.hashMode === 'quick' && io.hash) { try { item.hash = await io.hash(item.entry.path, item.entry); } catch { /* optional */ } }
    onProgress({ phase: 'read', done: ++done, total: work.length, path: item.entry.path });
  }, signal);

  // Folder pre-pass: compilations (one album name, several artists, no album artist).
  // Needs >= 3 files so a two-track single with a featured artist is not taken for a compilation. Unchanged files
  // (plan.same) have no `info` (they were not read), so on an incremental rescan only the re-read files vote.
  const folderAlbums = new Map();
  for (const item of work.concat(plan.same.map((s) => ({ entry: s.entry })))) {
    const t = item.info && item.info.tags;
    if (!t || !t.album || t.albumArtist) continue;
    const d = dirOf(item.entry.path);
    if (!folderAlbums.has(d)) folderAlbums.set(d, { album: new Set(), artists: new Set(), n: 0 });
    const x = folderAlbums.get(d);
    x.album.add(mk(t.album)); x.artists.add(mk(t.artist)); x.n++;
  }
  const isCompilation = (p) => { const x = folderAlbums.get(dirOf(p)); return !!x && x.album.size === 1 && x.artists.size > 1 && x.n >= 3; };

  const templates = compileTemplates(source);
  // Position of each file in its folder (chapters without numbers play in file order).
  const folderIndex = new Map();
  const counters = new Map();
  for (const p of mediaEntries.map((e) => e.path).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) { const d = dirOf(p); const c = (counters.get(d) || 0) + 1; counters.set(d, c); folderIndex.set(p, c); }
  const sorted = work.slice().sort((a, b) => a.entry.path.localeCompare(b.entry.path, undefined, { numeric: true }));

  // Apply phase: synchronous, one batch (one change event, one undo step for the whole scan). Processing in natural
  // path order makes container creation and chapter numbering deterministic. Per-file try/catch: a broken file is
  // reported, the rest of the library still lands.
  db.batch(() => {
    let k = 0;
    for (const item of sorted) {
      onProgress({ phase: 'apply', done: ++k, total: sorted.length, path: item.entry.path });
      try {
        const loc = io.loc(item.entry.path);
        const folder = item.folder || {};
        const coverOf = (p) => (p ? { loc: io.loc(p) } : undefined);
        const subs = (item.sc && item.sc.subs || []).map((s) => ({ lang: s.lang, title: s.title, forced: s.forced || undefined, sdh: s.sdh || undefined, format: extOf(s.path), loc: io.loc(s.path) }));
        const lrc = item.lrc && parseLrc(item.lrc).synced ? item.lrc : undefined;
        const extras = {
          compilation: isCompilation(item.entry.path), folderCover: coverOf(folder.cover) || item.embeddedCover || undefined, showCover: undefined, seasonCover: undefined,
          index: folderIndex.get(item.entry.path), lrc, subs,
          cover: item.sc && item.sc.cover ? coverOf(item.sc.cover) : item.embeddedCover || undefined, hash: item.hash || undefined,
        };
        const a = analyzeFile(item.entry, { source, info: item.info, nfo: item.nfo, templates });
        if (a.kind === 'episode') {
          // Show folder: one or two levels up (Show/Season 1/file).
          const d = dirOf(item.entry.path);
          const up = SEASON_DIR.test(baseOf(d)) ? dirOf(d) : d;
          const sf = side.folders.get(up) || {};
          extras.showCover = coverOf(sf.cover || sf.posters && sf.posters[0]);
          extras.seasonCover = coverOf(folder.posters && folder.posters[a.fields.season ?? 1]) || (up !== d ? coverOf(folder.cover) : undefined);
          extras.showNfo = item.showNfo || null;
        }
        if (item.cue && a.kind !== 'episode') {
          // A CUE sheet splits one file into tracks (segments of the same file).
          // One media per track, all pointing at the same loc with a segment window. Existing media of the file are
          // reused positionally (track i -> old media i) to keep ids, positions and bookmarks across rescans; surplus
          // old media (the CUE lost tracks) are removed.
          const tracks = cueTracks(item.cue, { durations: { [baseOf(item.entry.path)]: item.info ? item.info.duration : null } });
          const ownTracks = tracks.filter((t) => item.cue.files.length === 1 || mk(stemOf(t.file)) === mk(stemOf(item.entry.path)));
          const old = item.media || [];
          let i = 0;
          for (const t of ownTracks) {
            const fields = { ...a.fields, title: t.title || `Track ${t.number}`, artist: t.performer ? [t.performer] : a.fields.artist, album: item.cue.title || a.fields.album, albumartist: item.cue.performer || a.fields.albumartist, track: t.number, year: Number(item.cue.rem && item.cue.rem.date) || a.fields.year, genre: item.cue.rem && item.cue.rem.genre ? [item.cue.rem.genre] : a.fields.genre };
            const w = placeWork(db, { ...a, kind: 'track', domain: 'music', fields }, report, { ...extras, compilation: false });
            const mf = mediaFields(item.entry, item.info, source, loc, { ...extras, segment: { start: t.start, end: t.end ?? undefined } });
            mf.duration = t.end ? t.end - t.start : item.info && item.info.duration ? item.info.duration - t.start : undefined;
            const prev = old[i++];
            if (prev) { db.patch(prev.id, { ...mf, work: w.id }); report.updated++; } else { db.put(newMedia(w.id, mf)); report.created.media++; report.added++; }
          }
          for (; i < old.length; i++) db.remove(old[i].id);
          continue;
        }
        const w = placeWork(db, a, report, extras);
        const mf = mediaFields(item.entry, item.info, source, loc, extras);
        if (item.media && item.media.length) {
          const prev = item.media[0];
          // A media whose current work has locked fields stays on that work: the user curated it (for instance moved
          // the file to another work by hand), and the scan must not undo that.
          db.patch(prev.id, { ...mf, work: prev.work && db.get(prev.work) && (db.get(prev.work).locked || []).length ? prev.work : w.id });
          if (item.moved) report.moved++; else report.updated++;
          for (const extra of item.media.slice(1)) db.remove(extra.id);
        } else {
          // A nominal or source media of the same work becomes the file (upgrade), else a new media.
          const up = db.mediaOf(w.id).find((m) => m.presence !== 'file' && !m.loc);
          if (up) db.patch(up.id, mf); else { db.put(newMedia(w.id, mf)); report.created.media++; }
          report.added++;
        }
      } catch (e) {
        report.errors.push({ path: item.entry.path, error: String(e && e.message || e) });
      }
    }
    // Disappeared files: by default only marked missing (an unplugged drive must not wipe history); removeMissing
    // deletes the media but not its work (cascade: false), so tracking and plays survive as a nominal card.
    for (const m of gone) {
      if (source.removeMissing) { db.remove(m.id, { cascade: false }); report.removed++; }
      else if (!m.missing) { markMissing(db, m.id); report.missing++; }
    }
    db.patch(source.id, { lastScan: now(), stats: { listed: report.listed, media: report.considered, missing: report.missing, errors: report.errors.length } });
  }, { label: 'scan ' + (source.name || source.id) });
  report.ms = now() - t0;
  return report;
}

// --- links and yt-dlp --------------------------------------------------------------------------------------------------

const KIND_OF_HINT = { music: 'track', audiobook: 'book', series: 'episode', anime: 'episode', movie: 'movie', musicvideo: 'musicvideo', podcast: 'episode', auto: null };
const DOMAIN_OF_HINT = { music: 'music', audiobook: 'audiobook', series: 'series', anime: 'anime', movie: 'movie', musicvideo: 'musicvideo', podcast: 'podcast' };

// Accepts a textarea paste: one link per line, optional title after whitespace, '#' comment lines skipped.
function linkList(links) {
  if (typeof links === 'string') {
    return links.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => {
      const m = /^(\S+)\s+(.+)$/.exec(l);
      return m && /^(https?:|[a-z]+:)/i.test(m[1]) ? { url: m[1], title: m[2] } : { url: l };
    });
  }
  return Array.isArray(links) ? links.filter((l) => l && l.url) : [];
}

// Canonical 'extractor:id' ref when yt-dlp recognises the URL (so youtu.be/x and youtube.com/watch?v=x dedupe to
// one key); the raw URL for the generic extractor, where no stable id exists.
function sourceRefOf(url) {
  const p = parseSource(url);
  return p && p.extractor && p.id && p.extractor !== 'generic' ? { ref: formatSource(p), url: p.url || url, extractor: p.extractor, id: p.id } : { ref: url, url };
}

// Existing links are found by source key, with a raw-URL scan as fallback for media stored before keys were
// normalised. A URL ending in a media extension is directly playable, so it becomes presence 'file' with a url loc;
// anything else (a page) is a 'source' that needs yt-dlp.
export function indexLinks(db, source, links) {
  const hint = source.hint || 'auto';
  const report = { added: 0, existing: 0, works: [] };
  db.batch(() => {
    for (const l of linkList(links)) {
      const s = sourceRefOf(l.url);
      const found = db.get(db.find('src:' + srcKey(s.ref))) || db.all('media').find((m) => m.source && m.source.url === l.url) || null;
      if (found) { report.existing++; report.works.push(found.work); continue; }
      const kind = KIND_OF_HINT[hint] || (/\.(mp3|m4a|flac|ogg|opus|wav|aac)(\?|$)/i.test(l.url) ? 'track' : 'musicvideo');
      const title = l.title || decodeURIComponent(String(l.url).split(/[?#]/)[0].split('/').pop() || l.url).replace(/\.[a-z0-9]{2,5}$/i, '') || l.url;
      const w = db.put(newWork({ kind, title, domain: DOMAIN_OF_HINT[hint] || (kind === 'track' ? 'music' : 'musicvideo') }));
      const direct = /^https?:\/\/[^\s]+\.(mp3|m4a|aac|ogg|oga|opus|flac|wav|webm|mp4|m4v)(\?[^\s]*)?$/i.test(l.url);
      db.put(newMedia(w.id, direct ? { presence: 'file', loc: { kind: 'url', url: l.url }, source: s, sourceId: source.id } : { presence: 'source', source: s, sourceId: source.id }));
      report.added++;
      report.works.push(w.id);
    }
    db.patch(source.id, { lastScan: now() });
  }, { label: 'links' });
  return report;
}

// yt-dlp metadata -> work. Music is assumed when the extractor reports music fields (artist / track / album);
// uploader stands in for the artist otherwise. Uploader tags are namespaced 'yt:' and capped at 20 (YouTube tag
// lists are long SEO noise) so they do not pollute the user's tag space. The thumbnail is a remote { url } cover,
// shown only when remote pictures are allowed.
function infoWork(db, source, e, hint) {
  const isMusic = hint === 'music' || (hint === 'auto' && (e.artist || e.track || e.album));
  const kind = isMusic ? 'track' : KIND_OF_HINT[hint] || (e.series ? 'episode' : 'musicvideo');
  const domain = DOMAIN_OF_HINT[hint] || (isMusic ? 'music' : e.series ? 'series' : 'musicvideo');
  const w = newWork({ kind, title: e.track || e.title || e.id || 'Untitled', domain, year: e.releaseYear || (e.uploadDate ? Number(e.uploadDate.slice(0, 4)) : undefined), duration: e.duration || undefined, description: e.description ? String(e.description).slice(0, 4000) : undefined });
  setPeople(w, 'artist', e.artists && e.artists.length ? e.artists : e.artist ? [e.artist] : e.uploader ? [e.uploader] : []);
  if (!w.people) delete w.people;
  if (e.tags && e.tags.length) w.tags = e.tags.slice(0, 20).map((t) => 'yt:' + String(t).toLowerCase());
  if (e.genres && e.genres.length) w.tags = [...(w.tags || []), ...e.genres.map((g) => 'genre:' + String(g).toLowerCase())];
  if (e.thumbnail) w.cover = { url: e.thumbnail };
  return w;
}

// A playlist / channel also becomes (or refreshes) a playlist collection, found again by ext.key = 'ytpl:<id>',
// so re-indexing a channel updates its playlist in place rather than adding a second one. Refresh replaces the
// item list wholesale, mirroring the remote order.
export function indexYtdlp(db, source, info) {
  const hint = source.hint || 'auto';
  const report = { added: 0, existing: 0, playlist: null };
  const entries = info && Array.isArray(info.entries) && info.entries.length ? info.entries : info ? [info] : [];
  db.batch(() => {
    const ids = [];
    for (const e of entries) {
      const ref = e.source || e.url;
      if (!ref) continue;
      const existing = db.find('src:' + srcKey(ref));
      if (existing) { report.existing++; ids.push(db.get(existing).work); continue; }
      const w = db.put(infoWork(db, source, e, hint));
      db.put(newMedia(w.id, { presence: 'source', source: { ref, url: e.url, title: e.title, extractor: e.extractor, id: e.id }, sourceId: source.id, duration: e.duration || undefined, chapters: e.chapters && e.chapters.length ? e.chapters : undefined }));
      ids.push(w.id);
      report.added++;
    }
    if (entries.length > 1 || (info && info.kind === 'playlist')) {
      const name = (info && info.title) || source.name || 'Playlist';
      const key = 'ytpl:' + ((info && info.id) || name);
      let coll = db.all('collection').find((c) => c.ext && c.ext.key === key);
      if (coll) db.patch(coll.id, { items: ids.map((ref) => ({ ref, added: now() })) });
      else coll = db.put({ id: uid(), type: 'collection', kind: 'playlist', name, items: ids.map((ref) => ({ ref, added: now() })), ext: { key }, tags: [], created: now(), updated: now() });
      report.playlist = coll.id;
    }
    db.patch(source.id, { lastScan: now() });
  }, { label: 'yt-dlp' });
  return report;
}

// After a download job: the source media becomes a file (presence.attachFile) and fills empty fields from yt-dlp.
export function attachDownload(db, mediaId, loc, info = {}) {
  const m = db.get(mediaId);
  if (!m) return null;
  return db.batch(() => {
    const media = attachFile(db, m.work, loc, { name: info.filename || undefined, duration: info.duration || m.duration, chapters: info.chapters && info.chapters.length ? info.chapters : m.chapters, scanned: now() }, { media: mediaId });
    const w = db.get(m.work);
    if (w && info.title && !w.title) db.patch(w.id, { title: info.title });
    return media;
  }, { label: 'downloaded' });
}
