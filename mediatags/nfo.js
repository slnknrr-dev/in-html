// mediatags/nfo.js - Kodi / Jellyfin NFO files (xml/xml.js): movie, tvshow, episodedetails, musicvideo, album, artist.
//
//   parseNfo(text) -> { kind: 'movie' | 'tvshow' | 'episodedetails' | 'musicvideo' | 'album' | 'artist' | null, fields,
//                       episodes?: [fields] (several <episodedetails> roots: multi-episode files), url? }
//     fields (absent ones omitted): strings title originaltitle sorttitle plot outline tagline mpaa premiered aired
//       showtitle album albumartist label releasedate lastplayed dateadded status code name sortname biography born
//       formed died disbanded type review path trailer; numbers year runtime (minutes) season episode displayseason
//       displayepisode userrating playcount track top250; boolean watched; lists genre tag studio country director
//       credits writer artist style mood theme; actor [{ name, role?, order?, thumb? }]; uniqueid { imdb, tmdb, tvdb,
//       anidb, mal, ... (by the type attribute), default? (type of the default id) } (legacy <id>, <imdbid>,
//       <tmdbid>, <tvdbid> too); ratings [{ name, value, votes?, max?, default? }] (legacy <rating> + <votes> ->
//       name 'default'); thumb [{ url, aspect?, season?, type?, preview? }]; fanart [urls]; set (collection name)
//     Text after the XML (Kodi allows a scraper URL line) -> url. Bare '&' and unknown entities are tolerated;
//     malformed XML gives { kind: null, fields: {}, url? } (never throws).
//   serializeNfo(kind, fields | [fields]) -> XML text (UTF-8 declaration, Kodi element names and order; an array of
//     episodes gives several <episodedetails> roots); parseNfo(serializeNfo(k, f)).fields equals f
//   NFO_KINDS

//
// Why tolerant: NFO files are written by dozens of scrapers and by hand. Common breakage: a bare '&' in a plot,
// HTML entities (&nbsp;, &eacute;) that XML does not define, a URL line after the root, several roots in one file.
// A strict XML parser rejects all of these, so the text is sanitised first and the root(s) are wrapped in a synthetic
// element before parsing. Field tables (STR / NUM / LIST / BOOL) drive both reading and writing, so adding a field is
// one table edit and round-trips by construction.
import { attr, child, children, el, parseXML, root, serializeXML, textOf } from '../xml/xml.js';

export const NFO_KINDS = ['movie', 'tvshow', 'episodedetails', 'musicvideo', 'album', 'artist'];

const STR = ['title', 'originaltitle', 'sorttitle', 'showtitle', 'name', 'sortname', 'outline', 'plot', 'tagline', 'review', 'biography',
  'mpaa', 'premiered', 'aired', 'releasedate', 'album', 'albumartist', 'label', 'type', 'status', 'code', 'born', 'formed', 'died',
  'disbanded', 'lastplayed', 'dateadded', 'path', 'trailer'];
const NUM = ['year', 'runtime', 'season', 'episode', 'displayseason', 'displayepisode', 'userrating', 'playcount', 'track', 'top250'];
const LIST = ['genre', 'tag', 'style', 'mood', 'theme', 'studio', 'country', 'director', 'credits', 'writer', 'artist'];
const BOOL = ['watched'];
// Serialization order (Kodi's own writer order, extended).
const ORDER = ['title', 'originaltitle', 'sorttitle', 'showtitle', 'name', 'sortname', 'album', 'albumartist', 'artist', 'ratings',
  'userrating', 'top250', 'season', 'episode', 'displayseason', 'displayepisode', 'track', 'outline', 'plot', 'review', 'biography',
  'tagline', 'runtime', 'thumb', 'fanart', 'mpaa', 'playcount', 'lastplayed', 'uniqueid', 'genre', 'style', 'mood', 'theme', 'tag', 'set',
  'country', 'credits', 'writer', 'director', 'premiered', 'year', 'aired', 'releasedate', 'born', 'formed', 'died', 'disbanded', 'status',
  'code', 'studio', 'label', 'type', 'trailer', 'path', 'actor', 'watched', 'dateadded'];

// sanitize: (1) '&' not starting a syntactically valid reference becomes '&amp;'; (2) named references other than the
// five XML predefined ones are escaped literally ('&eacute;' survives as text), except &nbsp; which maps to U+00A0
// because it is by far the most common and its intended meaning is unambiguous.
const PREDEF = new Set(['lt', 'gt', 'amp', 'quot', 'apos']);
const sanitize = (s) => s.replace(/&(?!(#\d+|#x[0-9a-fA-F]+|[A-Za-z][\w.-]*);)/g, '&amp;')
  .replace(/&([A-Za-z][\w.-]*);/g, (m, n) => (PREDEF.has(n) ? m : n === 'nbsp' ? '&#160;' : `&amp;${n};`));

const text = (n) => textOf(n).trim();
// toNum accepts a decimal comma (European scrapers write ratings as '7,5'); Number('') is 0, hence the explicit
// empty check.
const toNum = (s) => { const v = Number(String(s).trim().replace(',', '.')); return Number.isFinite(v) && String(s).trim() !== '' ? v : null; };

// runtime uses parseInt so '120 min' still yields 120. Only direct children are read (child/children), so <name>
// inside <actor> or <set> never leaks into the top-level fields.
function readFields(node) {
  const f = {};
  for (const k of STR) { const c = child(node, k); if (c && text(c)) f[k] = text(c); }
  for (const k of NUM) {
    const c = child(node, k);
    if (!c) continue;
    const v = k === 'runtime' ? parseInt(text(c), 10) : toNum(text(c));
    if (v != null && Number.isFinite(v)) f[k] = v;
  }
  for (const k of BOOL) { const c = child(node, k); if (c && text(c)) f[k] = /^(true|1|yes)$/i.test(text(c)); }
  for (const k of LIST) { const l = children(node, k).map(text).filter(Boolean); if (l.length) f[k] = l; }
  const actors = children(node, 'actor').map((a) => {
    const x = { name: text(child(a, 'name')) };
    const role = text(child(a, 'role'));
    if (role) x.role = role;
    const order = toNum(text(child(a, 'order')));
    if (order != null) x.order = order;
    const thumb = text(child(a, 'thumb'));
    if (thumb) x.thumb = thumb;
    return x;
  }).filter((a) => a.name);
  if (actors.length) f.actor = actors;
  // IDs: modern <uniqueid type="imdb" default="true">, then legacy per-provider elements, then a bare <id> (IMDb when it
  // looks like tt1234567). Legacy values never override a uniqueid of the same type.
  const uid = {};
  for (const u of children(node, 'uniqueid')) {
    const v = text(u);
    if (!v) continue;
    const type = (attr(u, 'type') || 'unknown').toLowerCase();
    uid[type] = v;
    if (/^true$/i.test(attr(u, 'default') || '')) uid.default = type;
  }
  for (const [tag, type] of [['imdbid', 'imdb'], ['imdb_id', 'imdb'], ['tmdbid', 'tmdb'], ['tvdbid', 'tvdb']]) {
    const c = child(node, tag);
    if (c && text(c) && !uid[type]) uid[type] = text(c);
  }
  const legacyId = text(child(node, 'id'));
  if (legacyId && !Object.keys(uid).length) uid[/^tt\d+$/.test(legacyId) ? 'imdb' : 'unknown'] = legacyId;
  if (Object.keys(uid).length) f.uniqueid = uid;
  // Ratings: Kodi v17+ <ratings><rating name max default><value/><votes/></rating></ratings>; older files have a bare
  // <rating> + <votes>. Vote counts are stripped of thousands separators ('1,234').
  const ratings = [];
  const rs = child(node, 'ratings');
  for (const r of children(rs, 'rating')) {
    const value = toNum(text(child(r, 'value')) || (child(r, 'value') ? '' : text(r)));
    if (value == null) continue;
    const x = { name: attr(r, 'name') || 'default', value };
    const votes = toNum(text(child(r, 'votes')).replace(/[,\s]/g, ''));
    if (votes != null) x.votes = votes;
    const max = toNum(attr(r, 'max') || '');
    if (max != null) x.max = max;
    if (/^true$/i.test(attr(r, 'default') || '')) x.default = true;
    ratings.push(x);
  }
  if (!ratings.length) {
    const r = child(node, 'rating');
    const value = r ? toNum(text(r)) : null;
    if (value != null) {
      const x = { name: 'default', value };
      const votes = toNum(text(child(node, 'votes')).replace(/[,\s]/g, ''));
      if (votes != null) x.votes = votes;
      ratings.push(x);
    }
  }
  if (ratings.length) f.ratings = ratings;
  const thumbs = children(node, 'thumb').map((t) => {
    const x = { url: text(t) };
    for (const a of ['aspect', 'season', 'type', 'preview']) { const v = attr(t, a); if (v != null && v !== '') x[a] = v; }
    return x;
  }).filter((t) => t.url);
  if (thumbs.length) f.thumb = thumbs;
  // <set> is either <set><name>X</name></set> (Kodi v17+) or plain <set>X</set> (older).
  const fanart = children(child(node, 'fanart'), 'thumb').map(text).filter(Boolean);
  if (fanart.length) f.fanart = fanart;
  const set = child(node, 'set');
  if (set) { const name = child(set, 'name') ? text(child(set, 'name')) : text(set); if (name) f.set = name; }
  return f;
}

// Root detection by regex before XML parsing: finds the first known root anywhere (junk or a BOM before it is common)
// and the LAST matching close tag (multi-episode files repeat the root). Any http(s) URL outside the XML is the
// scraper hint line Kodi supports. Parsing failures return the empty result; the contract is 'never throws'.
/** Parses an NFO file (see the header); never throws. */
export function parseNfo(input) {
  const s = String(input || '').replace(/^﻿/, '');
  const m = /<(movie|tvshow|episodedetails|musicvideo|album|artist)[\s>/]/i.exec(s);
  const urlOf = (t) => (/(https?:\/\/\S+)/.exec(t || '') || [])[1];
  if (!m) { const url = urlOf(s); return url ? { kind: null, fields: {}, url } : { kind: null, fields: {} }; }
  const kind = m[1].toLowerCase();
  const closeRe = new RegExp(`</${m[1]}\\s*>`, 'gi');
  let end = -1, c;
  while ((c = closeRe.exec(s))) end = c.index + c[0].length;
  const after = end >= 0 ? s.slice(end) : '';
  const before = s.slice(0, m.index);
  const url = urlOf(after) || urlOf(before.replace(/<\?xml[^>]*\?>/, ''));
  const result = { kind: null, fields: {} };
  if (url) result.url = url;
  if (end < 0) return result;
  try {
    const xml = sanitize(s.slice(m.index, end));
    const doc = parseXML(`<nfo-root>${xml}</nfo-root>`);
    const roots = children(root(doc)).filter((x) => x.name.toLowerCase() === kind);
    if (!roots.length) return result;
    result.kind = kind;
    result.fields = readFields(roots[0]);
    if (roots.length > 1) result.episodes = roots.map(readFields);
    return result;
  } catch {
    return result;
  }
}

// Writes in Kodi's order (scrapers and Kodi itself diff files; a stable order keeps diffs clean), then unknown keys in
// insertion order. null attributes are omitted by el().
function elements(f) {
  const out = [];
  const keys = [...ORDER.filter((k) => k in f), ...Object.keys(f).filter((k) => !ORDER.includes(k))];
  for (const k of keys) {
    const v = f[k];
    if (v == null) continue;
    if (k === 'actor') {
      for (const a of v) out.push(el('actor', {}, el('name', {}, a.name), a.role != null ? el('role', {}, a.role) : null,
        a.order != null ? el('order', {}, String(a.order)) : null, a.thumb != null ? el('thumb', {}, a.thumb) : null));
    } else if (k === 'uniqueid') {
      for (const [type, id] of Object.entries(v)) {
        if (type === 'default') continue;
        out.push(el('uniqueid', { type, default: v.default === type ? 'true' : null }, String(id)));
      }
    } else if (k === 'ratings') {
      out.push(el('ratings', {}, v.map((r) => el('rating', { name: r.name || 'default', max: r.max != null ? r.max : null, default: r.default ? 'true' : null },
        el('value', {}, String(r.value)), r.votes != null ? el('votes', {}, String(r.votes)) : null))));
    } else if (k === 'thumb') {
      for (const t of v) out.push(el('thumb', { aspect: t.aspect, season: t.season, type: t.type, preview: t.preview }, t.url));
    } else if (k === 'fanart') {
      out.push(el('fanart', {}, v.map((u) => el('thumb', {}, u))));
    } else if (k === 'set') out.push(el('set', {}, el('name', {}, v)));
    else if (Array.isArray(v)) for (const x of v) out.push(el(k, {}, String(x)));
    else if (typeof v === 'boolean') out.push(el(k, {}, v ? 'true' : 'false'));
    else if (typeof v !== 'object') out.push(el(k, {}, String(v)));
  }
  return out;
}

// Multi-episode: several roots, the XML declaration only once at the top.
/** NFO text of a kind and its fields (see the header). */
export function serializeNfo(kind, fields) {
  const list = Array.isArray(fields) ? fields : [fields || {}];
  return list.map((f, i) => serializeXML(el(kind, {}, elements(f)), { declaration: i === 0, indent: '  ' })).join('\n') + '\n';
}
