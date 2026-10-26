// catalog/model.js - the media catalogue's data model: node types, kinds, presence levels, tracking statuses,
// normalization of untrusted nodes, ids, and the rules that tie works to their media.
//
// Every record is a *node* `{ id, type, created, updated, tags: [], note, locked: [], ext: {} , ... }` (times in ms).
//   work        something to watch / hear / read: kind 'track' | 'album' | 'book' | 'bookseries' | 'show' | 'season' |
//               'episode' | 'movie' | 'musicvideo' | 'podcast' | 'chapter'; `parent` links a track to its album, an
//               episode to its season (or show), a season to its show, a chapter to its book, a book to its series, a
//               podcast episode to its podcast. Descriptive fields: title, titles { romaji, native, en, … }, sortTitle,
//               order (track / episode / chapter / series part), disc, season, episode, absolute, special, year, date,
//               people [{ name, role, character?, id? }], format (anime 'tv' | 'movie' | 'ova' | 'ona' | 'special' |
//               'music'), cour, total (episodes / tracks / chapters planned), airing, description, lyrics { text, lrc },
//               cover (a cover ref, covers.js), ids { mal, shikimori, anilist, anidb, imdb, tmdb, tvdb, mb, isbn, … },
//               markers { intro: [a, b], outro: [a, b], recap } (seconds), track (tracking state, tracking.js),
//               rating (0..10), favorite, energy (0..10), bpm, plays, lastPlayed, added.
//   media       one representation of a work (one work, many media: files, sources, versions, qualities, languages):
//               work, presence ('file' | 'source' | 'nominal'), loc (where the file is, LOC_KINDS), source
//               ({ ref: 'youtube:ID' | URL, url, title }), nominal ({ image, lyrics, text }: information only), name,
//               path, size, mtime, hash, container, mime, kind ('audio' | 'video'), duration, audio, video, streams,
//               subs [{ lang, title, loc, forced, sdh, format }], chapters [{ start, end, title }], version, quality,
//               lang, replaygain, loudness, peak, bpm, missing, sourceId (the index source), position, bookmarks.
//   person      artist / author / narrator / studio … (optional enrichment; works name people directly)
//   collection  kind 'playlist' | 'smart' | 'group' | 'library' | 'mood' (collections.js, smart.js)
//   workspace   a custom folder tree of references with its own layout / skin (workspaces.js)
//   source      an index source with its rules (indexer.js)
//   tagdef      a tag definition: aliases, implications, colour (tags.js)
//   play        one entry of the play history (scrobble): ref (media), work, at, dur, pos, done
//   skin, layout, setting   user skins and player layouts (player/), catalogue settings
//
// Presence of a work: the best presence among its media; a work without media is 'nominal' (a card that cannot
// play: a song known by its lyrics or cover, an episode not owned yet). Upgrade: nominal -> source (a link or yt-dlp
// id) -> file (a download or an attached file); downgrade when a file disappears (file -> source when a link is known,
// else -> nominal) or a link is dropped.
//
//   uid(), now()                                   ids (8 chars, util/id.js style) and the clock (overridable: setClock)
//   TYPES, KINDS, CONTAINER_OF, CHILD_KINDS, PRESENCE, PRESENCE_RANK, LOC_KINDS, STATUSES, ROLES
//   normNode(raw) -> node | null                   bounded, typed copy of an untrusted node (import, remote)
//   kindFamily(kind) -> 'music' | 'audiobook' | 'video' | 'podcast'
//   isPlayableLoc(loc), bestPresence(list)
//   newWork(fields), newMedia(workId, fields)      constructors with defaults
//   peopleOf(work, role) -> names; firstPerson(work, role); setPeople(work, role, names)
//   displayTitle(work, { prefer: 'romaji' | 'native' | 'en' | lang }) ; sortKey(work)
//
// Key decisions:
// - One flat node shape for every type instead of a class hierarchy: nodes travel as JSON (IndexedDB, files, sync,
//   export), and plain objects round-trip losslessly where class instances do not.
// - Trust boundary is normNode(). Everything that arrives from outside (import file, peer, backend) passes through it:
//   whitelisted fields, typed, length-capped, prototype keys refused. Code past that point may assume shapes.
// - Presence is derived from media, never edited directly on a work, so it cannot contradict the media that exist.

// Ids: 8 chars of [a-z0-9], first char a letter (safe as a CSS / DOM id and as an unquoted key). 26 * 36^7 ≈ 2e12
// values: collision odds stay negligible for a personal catalogue of millions of nodes.
// Modulo bias (256 % 36 = 4) skews a few characters by ~1.5 %; irrelevant for uniqueness, not acceptable for secrets.
// The Math.random fallback exists for very old runtimes only; ids are not security tokens, so it is tolerable.
const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
export function uid(len = 8) {
  const bytes = new Uint8Array(len);
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < len; i++) bytes[i] = (Math.random() * 256) | 0;
  let s = ID_CHARS[bytes[0] % 26];
  for (let i = 1; i < len; i++) s += ID_CHARS[bytes[i] % 36];
  return s;
}

// Indirected clock: every timestamp in the catalogue goes through now(), so a test can freeze time and get
// byte-identical snapshots. Calling Date.now() directly anywhere would break that determinism.
let clock = () => Date.now();
export const now = () => clock();
// Tests and deterministic exports replace the clock.
export function setClock(fn) { clock = typeof fn === 'function' ? fn : () => Date.now(); }

export const TYPES = ['work', 'media', 'person', 'collection', 'workspace', 'source', 'tagdef', 'play', 'skin', 'layout', 'setting'];
export const KINDS = ['track', 'album', 'book', 'bookseries', 'show', 'season', 'episode', 'movie', 'musicvideo', 'podcast', 'chapter'];
// The container kind each kind normally hangs under.
export const CONTAINER_OF = { track: 'album', episode: 'season', season: 'show', chapter: 'book', book: 'bookseries', musicvideo: null, movie: null, album: null, show: null, podcast: null, bookseries: null };
export const CHILD_KINDS = { album: ['track'], show: ['season', 'episode'], season: ['episode'], book: ['chapter'], bookseries: ['book'], podcast: ['episode'] };
export const PRESENCE = ['nominal', 'source', 'file'];
// Numeric rank so "best presence" is a max(), and sorting media by playability is a subtraction (db.mediaOf).
export const PRESENCE_RANK = { nominal: 0, source: 1, file: 2 };
// Where a file lives: fs (backend / Electron file API: mount + path), fsa (a File System Access directory handle kept
// in the browser: handle + path), remote (the file API of a configured server: server + mount + path), blob (bytes in
// the catalogue's blob store), url (a direct http(s) media URL the user added), session (a file picked in this
// session; not persistent).
export const LOC_KINDS = ['fs', 'fsa', 'remote', 'blob', 'url', 'session'];
// Tracking statuses (MyAnimeList / Shikimori): current = watching / listening / reading.
export const STATUSES = ['current', 'completed', 'paused', 'dropped', 'planned', 'repeating'];
export const ROLES = ['artist', 'albumartist', 'composer', 'lyricist', 'conductor', 'performer', 'author', 'narrator', 'director', 'writer', 'studio', 'cast', 'host', 'publisher', 'label'];
export const FORMATS = ['tv', 'movie', 'ova', 'ona', 'special', 'music', 'tv_short', 'pv', 'cm'];

// Family drives the player UI and default views. 'video' is the fallback, so a kind added later without a family
// entry still gets a working (video) player rather than none.
const MUSIC = new Set(['track', 'album', 'musicvideo']);
const BOOK = new Set(['book', 'bookseries', 'chapter']);
export function kindFamily(kind) {
  if (MUSIC.has(kind)) return 'music';
  if (BOOK.has(kind)) return 'audiobook';
  if (kind === 'podcast') return 'podcast';
  return 'video';
}

export const isPlayableLoc = (loc) => !!loc && LOC_KINDS.includes(loc.kind);
export function bestPresence(list) {
  let best = 'nominal';
  for (const p of list) if (PRESENCE_RANK[p] > PRESENCE_RANK[best]) best = p;
  return best;
}

// --- normalization of untrusted data ----------------------------------------------------------------------------------

// Coercers: each returns a valid value or undefined (= "drop the field"), never throws. Throwing would let one bad
// field reject a whole import of thousands of nodes; dropping keeps the rest. Caps on lengths and counts bound memory
// against hostile or corrupted files (a 1 GB title string must not reach IndexedDB or the DOM).
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : undefined);
const num = (v, lo = -1e15, hi = 1e15) => { const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : undefined; };
const bool = (v) => (typeof v === 'boolean' ? v : undefined);
const strList = (v, max = 200, len = 300) => (Array.isArray(v) ? v.map((x) => str(x, len)).filter((x) => x !== undefined && x !== '').slice(0, max) : undefined);
// Id whitelist: no slashes, spaces or quotes, so an id is safe in file names, URLs and attribute values unescaped.
const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const id = (v) => (typeof v === 'string' && ID_RE.test(v) ? v : undefined);

// Plain JSON data of bounded size (ext, ids, misc). Depth, array length, key count and string length are capped;
// '__proto__' / 'constructor' / 'prototype' keys are skipped so a crafted import cannot pollute Object.prototype when
// the result is later merged with spread or Object.assign elsewhere.
function plain(v, depth = 0) {
  if (depth > 6) return undefined;
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') return v.slice(0, 20000);
  if (Array.isArray(v)) return v.slice(0, 2000).map((x) => plain(x, depth + 1)).filter((x) => x !== undefined);
  if (isObj(v)) {
    const out = {};
    let n = 0;
    for (const [k, x] of Object.entries(v)) {
      if (++n > 400 || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      const y = plain(x, depth + 1);
      if (y !== undefined) out[k.slice(0, 100)] = y;
    }
    return out;
  }
  return undefined;
}

function range2(v) {
  if (!Array.isArray(v) || v.length !== 2) return undefined;
  const a = num(v[0], 0, 1e7), b = num(v[1], 0, 1e7);
  return a !== undefined && b !== undefined && b > a ? [a, b] : undefined;
}

function loc(v) {
  if (!isObj(v) || !LOC_KINDS.includes(v.kind)) return undefined;
  const out = { kind: v.kind };
  for (const k of ['mount', 'path', 'handle', 'server', 'blob', 'url', 'name']) { const s = str(v[k], 4000); if (s !== undefined) out[k] = s; }
  // url locs feed <audio>/<video> src: only http(s), never javascript:, data: or file: from an untrusted import.
  if (out.kind === 'url' && !/^https?:\/\//i.test(out.url || '')) return undefined;
  const size = num(v.size, 0); if (size !== undefined) out.size = size;
  return out;
}

function people(v) {
  if (!Array.isArray(v)) return undefined;
  return v.slice(0, 200).filter(isObj).map((p) => {
    const o = { name: str(p.name, 300) || '', role: ROLES.includes(p.role) ? p.role : 'artist' };
    const c = str(p.character, 300); if (c) o.character = c;
    const i = id(p.id); if (i) o.id = i;
    return o;
  }).filter((p) => p.name);
}

function tracking(v) {
  if (!isObj(v)) return undefined;
  const t = { status: STATUSES.includes(v.status) ? v.status : 'planned' };
  for (const k of ['progress', 'repeats', 'priority']) { const n = num(v[k], 0, 1e6); if (n !== undefined) t[k] = Math.round(n); }
  const sc = num(v.score, 0, 10); if (sc !== undefined) t.score = Math.round(sc * 10) / 10;
  for (const k of ['started', 'finished', 'updated']) { const n = num(v[k], 0); if (n !== undefined) t[k] = n; }
  const notes = str(v.notes, 5000); if (notes) t.notes = notes;
  return t;
}

// Field whitelists shared by all types. Flat lists instead of per-type schemas: simpler, and a field that is
// meaningless for a type is harmless (unused). The type-specific structured fields are handled in normNode below.
const COMMON_NUM = ['order', 'disc', 'discTotal', 'trackTotal', 'season', 'episode', 'episodeEnd', 'absolute', 'year', 'originalYear', 'cour', 'total',
  'rating', 'energy', 'bpm', 'plays', 'lastPlayed', 'added', 'duration', 'loudness', 'size', 'mtime', 'bitrate', 'peak', 'position', 'positionAt',
  'scanned', 'at', 'dur', 'pos', 'seriesPart'];
const COMMON_STR = ['title', 'sortTitle', 'name', 'sortName', 'description', 'date', 'format', 'airing', 'language', 'country', 'edition', 'kind',
  'path', 'hash', 'container', 'mime', 'version', 'quality', 'lang', 'work', 'parent', 'ref', 'sourceId', 'skin', 'layout', 'view', 'query',
  'pick', 'color', 'icon', 'label', 'series', 'releaseGroup', 'network', 'key', 'presence', 'domain', 'ixKey', 'tod', 'spread', 'hint',
  'policy', 'hashMode'];

// A typed copy of a node with every known field checked; unknown top-level fields are dropped except `ext`.
export function normNode(raw) {
  if (!isObj(raw)) return null;
  const type = TYPES.includes(raw.type) ? raw.type : null;
  const nid = id(raw.id);
  if (!type || !nid) return null;
  const n = { id: nid, type };
  for (const k of COMMON_STR) { const s = str(raw[k], k === 'description' || k === 'query' ? 20000 : 2000); if (s !== undefined) n[k] = s; }
  for (const k of COMMON_NUM) { const x = num(raw[k]); if (x !== undefined) n[k] = x; }
  for (const k of ['special', 'compilation', 'favorite', 'missing', 'fixed', 'collapsed', 'enabled', 'playable', 'useTags', 'useSidecars', 'removeMissing']) { const b = bool(raw[k]); if (b !== undefined) n[k] = b; }
  n.created = num(raw.created, 0) ?? now();
  n.updated = num(raw.updated, 0) ?? n.created;
  n.tags = strList(raw.tags, 500, 200) || [];
  const note = str(raw.note, 20000); if (note) n.note = note;
  const locked = strList(raw.locked, 100, 60); if (locked && locked.length) n.locked = locked;
  if (isObj(raw.ext)) n.ext = plain(raw.ext);
  if (isObj(raw.titles)) { n.titles = {}; for (const [k, v] of Object.entries(raw.titles).slice(0, 30)) { const s = str(v, 500); if (s && /^[a-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(k)) n.titles[k] = s; } }
  if (isObj(raw.ids)) { n.ids = {}; for (const [k, v] of Object.entries(raw.ids).slice(0, 40)) { const s = str(v, 300); if (s && /^[a-z][a-z0-9_]{0,30}$/.test(k)) n.ids[k] = s; } }
  const ppl = people(raw.people); if (ppl && ppl.length) n.people = ppl;
  if (raw.track !== undefined) { const t = tracking(raw.track); if (t) n.track = t; }
  if (isObj(raw.lyrics)) { const l = {}; const t = str(raw.lyrics.text, 200000); const r = str(raw.lyrics.lrc, 400000); if (t) l.text = t; if (r) l.lrc = r; if (t || r) n.lyrics = l; }
  if (isObj(raw.cover)) n.cover = plain(raw.cover);
  if (isObj(raw.markers)) { const m = {}; for (const k of ['intro', 'outro', 'recap', 'preview']) { const r = range2(raw.markers[k]); if (r) m[k] = r; } if (Object.keys(m).length) n.markers = m; }
  // Presence is re-derived, not trusted: a claimed 'file' without a loc, or 'source' without a link, is demoted, so
  // the UI never offers Play for something that cannot play.
  if (type === 'media') {
    n.presence = PRESENCE.includes(raw.presence) ? raw.presence : 'nominal';
    const l = loc(raw.loc); if (l) n.loc = l;
    if (isObj(raw.source)) { const s = { ref: str(raw.source.ref, 4000) || '' }; for (const k of ['url', 'title', 'extractor', 'id']) { const v = str(raw.source[k], 4000); if (v) s[k] = v; } if (s.ref) n.source = s; }
    if (isObj(raw.nominal)) n.nominal = plain(raw.nominal);
    for (const k of ['audio', 'video', 'replaygain', 'segment', 'cover']) if (isObj(raw[k])) n[k] = plain(raw[k]);
    for (const k of ['streams', 'subs', 'chapters', 'bookmarks']) if (Array.isArray(raw[k])) n[k] = plain(raw[k]).slice(0, 2000);
    if (n.presence === 'file' && !n.loc) n.presence = n.source ? 'source' : 'nominal';
    if (n.presence === 'source' && !n.source && !(n.loc && n.loc.kind === 'url')) n.presence = 'nominal';
  }
  if (type === 'work' && !KINDS.includes(n.kind)) n.kind = 'track';
  // Structured payloads of non-work types go through plain() (shape-agnostic, size-bounded); their owning modules
  // (collections.js, tags.js, indexer.js, ...) validate semantics on use. 'tokens' appears twice in the list: harmless.
  if (type === 'collection' || type === 'workspace' || type === 'source' || type === 'tagdef' || type === 'skin' || type === 'layout' || type === 'setting' || type === 'person') {
    for (const k of ['items', 'children', 'root', 'rules', 'templates', 'include', 'exclude', 'parsers', 'aliases', 'implies', 'loc', 'sort', 'limit', 'stats', 'tokens', 'controls', 'regions', 'data', 'roles', 'filter', 'kinds', 'order', 'tokens']) {
      if (raw[k] !== undefined) { const v = plain(raw[k]); if (v !== undefined) n[k] = v; }
    }
  }
  return n;
}

// --- constructors ------------------------------------------------------------------------------------------------------

// Defaults first, caller fields spread over them, then id / kind / work forced last so a caller cannot produce a
// node without an id or with an unknown kind.
export function newWork(fields = {}) {
  const t = now();
  return { type: 'work', title: '', created: t, updated: t, added: t, tags: [], ...fields, id: fields.id || uid(), kind: KINDS.includes(fields.kind) ? fields.kind : 'track' };
}

export function newMedia(workId, fields = {}) {
  const t = now();
  return { type: 'media', presence: 'nominal', created: t, updated: t, tags: [], ...fields, id: fields.id || uid(), work: workId };
}

// --- people ------------------------------------------------------------------------------------------------------------

export const peopleOf = (w, role) => (w && Array.isArray(w.people) ? w.people.filter((p) => !role || p.role === role).map((p) => p.name) : []);
export const firstPerson = (w, role) => peopleOf(w, role)[0] || '';
// Replaces all people of one role, keeps the others. Mutates w in place: intended for a fresh copy before db.put,
// never for a node obtained from db.get (db nodes are immutable values, see db.js).
export function setPeople(w, role, names) {
  const rest = (w.people || []).filter((p) => p.role !== role);
  const list = (Array.isArray(names) ? names : [names]).map((n) => String(n || '').trim()).filter(Boolean);
  w.people = [...rest, ...list.map((name) => ({ name, role }))];
  if (!w.people.length) delete w.people;
  return w;
}

// --- titles ------------------------------------------------------------------------------------------------------------

// The title to show: the preferred alternative title when set (anime: romaji / native / en), else title.
export function displayTitle(w, { prefer = '' } = {}) {
  if (!w) return '';
  if (prefer && w.titles && w.titles[prefer]) return w.titles[prefer];
  return w.title || w.name || (w.titles && Object.values(w.titles)[0]) || '';
}

// KNOWN DEFECT: the alternative "l'" requires whitespace after it, but French elision has none ("L'Amour"), so it
// never matches. Fix: /^(?:(?:the|a|an|der|die|das|le|la|les|el|los|las)\s+|l')/i.
const ARTICLES = /^(the|a|an|der|die|das|le|la|les|l'|el|los|las)\s+/i;
// Sort key: sortTitle, else the title without a leading article, lower case, numbers padded for natural order.
// Precomputed string key (not a comparator) so lists can sort with plain string comparison and cache the key.
// Diacritics are removed via NFKD + stripping U+0300..U+036F combining marks ("É" sorts with "E").
// Padding to 8 digits makes "Episode 2" < "Episode 10" lexicographically; numbers over 8 digits fall back to
// lexicographic order, acceptable for titles.
export function sortKey(w) {
  const t = (w && (w.sortTitle || w.sortName)) || String(displayTitle(w)).replace(ARTICLES, '');
  return t.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\d+/g, (d) => d.padStart(8, '0'));
}

// Natural comparison of two strings ('2' < '10').
const collator = typeof Intl !== 'undefined' ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }) : null;
export const naturalCompare = (a, b) => (collator ? collator.compare(String(a ?? ''), String(b ?? '')) : String(a ?? '').localeCompare(String(b ?? '')));

// Normalized key for matching names and titles: NFKD to split diacritics off and strip them, then NFKC to fold
// compatibility forms (full-width Latin, ligatures) to their plain form, lower case, and every run of whitespace /
// punctuation / symbols (Unicode property classes, so it works for CJK punctuation too) collapsed to one space.
// "Re:Zero" and "Re Zero" thus share a key. Letters of any script survive, so non-Latin titles still match.
export function matchKey(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').normalize('NFKC').toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, ' ').trim();
}
