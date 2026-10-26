// mediajobs/ytdlp.js - yt-dlp: source references for online media, the info and download jobs, and the readers of
// yt-dlp's progress lines and JSON. No network here; the runner spawns yt-dlp.
//
// Source references: a URL, or 'extractor:id' for the known extractors. Ids carry what the canonical URL needs:
//   youtube      video 'dQw4w9WgXcQ' (11 chars), playlist 'PL…' / 'OLAK5uy_…', channel '@handle[/tab]' | 'UC…[/tab]'
//                | 'c/name' | 'user/name' (watch, youtu.be, shorts, live, embed, music.youtube.com, playlist?list=)
//   vimeo        '123456' | '123456/hash' (unlisted), 'showcase/N' | 'album/N', 'channels/x' | 'groups/x' | 'name'
//   dailymotion  'x7tgad0', 'playlist/x6hynp', 'user/name'         soundcloud  'artist/track[/s-token]',
//   'artist/sets/name', 'artist[/tab]'                              bandcamp    'artist/track/slug', 'artist/album/slug', 'artist'
//   twitch       'v123456' (VOD), 'clip/Slug', 'name[/videos]'      niconico    'sm9', 'mylist/N' | 'series/N', 'user/N'
//   bilibili     'BV1xx411c7mD' | 'av170001' | 'ep123', 'ss123', 'space/N'
//   peertube     'host/w/<short uuid>', 'host/w/p/<id>', 'host/c/<name>' (PeerTube paths on any host)
// Other http(s) URLs: { extractor: 'generic', id: null, kind: 'unknown' }.
//
//   parseSource(text) -> { extractor, id, url, kind: 'video'|'playlist'|'channel'|'unknown', playlist? } | null
//                       (url: the canonical URL for known references, the URL itself otherwise; null for text that
//                       is neither an http(s) URL nor a known extractor:id)
//   formatSource({ extractor, id, url }) -> 'youtube:dQw4w9WgXcQ' (generic: the URL)
//   sourceURL(ref) -> canonical URL | the URL itself | null        isSourceRef(s) -> parseSource(s) !== null
//   infoJob(ref, { flat = true, playlistItems, ignoreConfig }) -> job: -J --flat-playlist --no-warnings
//                       --no-progress <url> (capture 'json', parse 'ytdlp-info')
//   downloadJob(ref, { outDir, template = '%(title)s [%(id)s].%(ext)s', mode: 'best'|'video'|'audio',
//                      audioFormat: 'best'|'opus'|'mp3'|'m4a'|'flac', maxHeight, subs: { langs, auto, embed },
//                      thumbnail = true, embedMetadata = true, embedChapters = true, infoJson = true, playlistItems,
//                      archive, ffmpegLocation, rateLimit, ignoreConfig }) -> job
//                       progress through --newline --progress --progress-template (DL_TEMPLATE / PP_TEMPLATE), the
//                       final path through --print after_move:filepath=%(filepath)s (which also implies --quiet);
//                       never cookies or credentials. mode 'video' prefers H.264 / AAC in MP4 (plays everywhere),
//                       'best' takes yt-dlp's best and writes the thumbnail as a file next to it (webm cannot embed
//                       one), 'audio' extracts the audio (-x) with the thumbnail embedded.
//   parseProgressLine(line) -> { kind: 'download'|'postprocess'|'destination'|'filepath'|'info'|'warning'|'error',
//                       percent, downloaded, total, speed, eta, file, status?, postprocessor?, text? } | null
//                       (the templates above and yt-dlp's default [download] lines)
//   infoToCatalog(info) -> { source, url, extractor, id, title, kind: 'track'|'video'|'episode'|'playlist', artist,
//                       artists, album, track, trackNumber, releaseYear, uploadDate ('YYYY-MM-DD'), uploader, channel,
//                       duration, description, tags, genres, chapters, thumbnail, thumbnails, series, season, episode,
//                       language, playlist: { id, title, index, count } | null, entries, subtitles: { lang: [ext] },
//                       autoSubtitles, filepath }

import { Args, makeJob } from './job.js';

// Why short references ('youtube:ID') instead of storing URLs: one video has many URL spellings (youtu.be, shorts,
// embed, m., tracking params); a canonical reference makes duplicates detectable, keeps catalogs compact, and the
// canonical URL is rebuilt on demand. Recognition is purely syntactic (no network), so it is conservative: anything
// unrecognized on a known host becomes kind 'unknown' with the original URL, still downloadable by yt-dlp.
export const EXTRACTORS = ['youtube', 'vimeo', 'dailymotion', 'soundcloud', 'bandcamp', 'twitch', 'niconico', 'bilibili', 'peertube'];

// --- references -------------------------------------------------------------------------------------------------

// Reserved first path segments per site: real site sections that look like user names (soundcloud.com/discover,
// vimeo.com/upload, twitch.tv/directory). Without them a site page would be misread as a channel reference.
const YT_TABS = new Set(['videos', 'shorts', 'streams', 'playlists', 'podcasts', 'releases', 'featured', 'live', 'community']);
const SC_RESERVED = new Set(['discover', 'search', 'you', 'stream', 'charts', 'upload', 'settings', 'messages', 'pages', 'terms-of-use', 'mobile', 'tags', 'signin', 'notifications', 'people', 'jobs', 'imprint', 'popular', 'go']);
const SC_TABS = new Set(['tracks', 'albums', 'sets', 'likes', 'reposts', 'popular-tracks', 'followers', 'following', 'comments', 'spotlight']);
const VIMEO_RESERVED = new Set(['about', 'blog', 'features', 'upload', 'search', 'log_in', 'join', 'watch', 'categories', 'help', 'ott', 'live', 'enterprise', 'solutions', 'create', 'manage', 'settings', 'stock', 'pricing']);
const TWITCH_RESERVED = new Set(['directory', 'settings', 'p', 'downloads', 'jobs', 'turbo', 'subscriptions', 'inventory', 'wallet', 'search', 'friends', 'messages', 'videos']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_UUID = /^[0-9A-Za-z]{22}$/;

/** Kind of an id of a known extractor, or null when the id is not one. */
// The single grammar of ids per extractor; ref() refuses ids it does not accept, so every produced reference is
// valid by construction. YouTube: exactly 11 [\w-] chars is a video id; longer ids are playlists (PL..., OLAK5uy_...,
// UU...); channels are @handles (Unicode allowed via the À-￿ range), UC + 22 chars, or legacy c/ and user/ paths.
// Order matters: the 11-char video test runs before the generic 12+ playlist test.
function idKind(extractor, id) {
  const s = String(id ?? '');
  switch (extractor) {
    case 'youtube':
      if (/^[\w-]{11}$/.test(s)) return 'video';
      if (/^@[\w.\-À-￿]+(\/[a-z]+)?$/.test(s) || /^UC[\w-]{22}(\/[a-z]+)?$/.test(s) || /^(c|user)\/[\w.\-À-￿]+(\/[a-z]+)?$/.test(s)) return 'channel';
      if (/^[\w-]{12,}$/.test(s)) return 'playlist';
      return null;
    case 'vimeo':
      if (/^\d+(\/[0-9a-f]+)?$/.test(s)) return 'video';
      if (/^(showcase|album)\/\d+$/.test(s)) return 'playlist';
      if (/^(channels|groups)\/[\w-]+$/.test(s) || (/^[A-Za-z][\w-]*$/.test(s) && !VIMEO_RESERVED.has(s))) return 'channel';
      return null;
    case 'dailymotion':
      if (/^x[a-z0-9]+$/.test(s)) return 'video';
      if (/^playlist\/x[a-z0-9]+$/.test(s)) return 'playlist';
      if (/^user\/[\w.-]+$/.test(s)) return 'channel';
      return null;
    case 'soundcloud': {
      const p = s.split('/');
      if (!p.every((x) => /^[\w.-]+$/.test(x)) || SC_RESERVED.has(p[0])) return null;
      if (p.length === 1) return 'channel';
      if (p[1] === 'sets' && p.length >= 3) return 'playlist';
      if (p.length === 2 && SC_TABS.has(p[1])) return 'channel';
      if (p.length === 2 || (p.length === 3 && /^s-\w+$/.test(p[2]))) return 'video';
      return null;
    }
    case 'bandcamp':
      if (/^[\w-]+$/.test(s)) return 'channel';
      if (/^[\w-]+\/track\/[\w-]+$/.test(s)) return 'video';
      if (/^[\w-]+\/album\/[\w-]+$/.test(s)) return 'playlist';
      return null;
    case 'twitch':
      if (/^v\d+$/.test(s) || /^clip\/[\w-]+$/.test(s)) return 'video';
      if (/^\w+(\/videos)?$/.test(s) && !TWITCH_RESERVED.has(s.split('/')[0])) return 'channel';
      return null;
    case 'niconico':
      if (/^(sm|so|nm)\d+$/.test(s)) return 'video';
      if (/^(mylist|series)\/\d+$/.test(s)) return 'playlist';
      if (/^user\/\d+$/.test(s)) return 'channel';
      return null;
    case 'bilibili':
      if (/^(BV[0-9A-Za-z]{10}|av\d+|ep\d+)$/.test(s)) return 'video';
      if (/^ss\d+$/.test(s)) return 'playlist';
      if (/^space\/\d+$/.test(s)) return 'channel';
      return null;
    case 'peertube': {
      const m = /^([a-z0-9.-]+\.[a-z]{2,}(?::\d+)?)\/(.+)$/i.exec(s);
      if (!m) return null;
      if (/^w\/p\/[\w-]+$/.test(m[2])) return 'playlist';
      if (/^w\/[\w-]+$/.test(m[2])) return 'video';
      if (/^[ac]\/[\w.@-]+$/.test(m[2])) return 'channel';
      return null;
    }
    default: return null;
  }
}

function canonical(extractor, id) {
  const s = String(id);
  switch (extractor) {
    case 'youtube': {
      const k = idKind('youtube', s);
      if (k === 'video') return `https://www.youtube.com/watch?v=${s}`;
      if (k === 'playlist') return `https://www.youtube.com/playlist?list=${s}`;
      if (/^UC/.test(s)) return `https://www.youtube.com/channel/${s}`;
      return `https://www.youtube.com/${s}`;
    }
    case 'vimeo': return `https://vimeo.com/${s}`;
    case 'dailymotion':
      if (/^x/.test(s)) return `https://www.dailymotion.com/video/${s}`;
      if (s.startsWith('user/')) return `https://www.dailymotion.com/${s.slice(5)}`;
      return `https://www.dailymotion.com/${s}`;
    case 'soundcloud': return `https://soundcloud.com/${s}`;
    case 'bandcamp': { const [artist, ...rest] = s.split('/'); return `https://${artist}.bandcamp.com/${rest.join('/')}`; }
    case 'twitch':
      if (/^v\d+$/.test(s)) return `https://www.twitch.tv/videos/${s.slice(1)}`;
      if (s.startsWith('clip/')) return `https://clips.twitch.tv/${s.slice(5)}`;
      return `https://www.twitch.tv/${s}`;
    case 'niconico': return /^(sm|so|nm)\d+$/.test(s) ? `https://www.nicovideo.jp/watch/${s}` : `https://www.nicovideo.jp/${s}`;
    case 'bilibili':
      if (/^(ep|ss)\d+$/.test(s)) return `https://www.bilibili.com/bangumi/play/${s}`;
      if (s.startsWith('space/')) return `https://space.bilibili.com/${s.slice(6)}`;
      return `https://www.bilibili.com/video/${s}`;
    case 'peertube': return `https://${s}`;
    default: return null;
  }
}

function ref(extractor, id, extra = {}) {
  const kind = idKind(extractor, id);
  if (!kind) return null;
  return { extractor, id: String(id), url: canonical(extractor, id), kind, ...extra };
}
const unknown = (extractor, href) => ({ extractor, id: null, url: href, kind: 'unknown' });

// A watch URL with both v= and list= is the video (the list is kept as context in `playlist`), matching what a
// user who pasted a link to one video expects; yt-dlp is later told --no-playlist for video refs.
// KNOWN DEFECT: decodeURIComponent throws URIError on malformed percent escapes (checked:
// parseSource('https://youtube.com/@%E0%A4%A') throws), so parseSource breaks its "null for bad input" contract.
// Fix: wrap the decode in try/catch and fall back to unknown('youtube', u.href).
function fromYouTube(u, host) {
  const seg = u.pathname.split('/').filter(Boolean);
  const q = u.searchParams;
  if (host === 'youtu.be') return seg[0] ? ref('youtube', seg[0]) : null;
  const list = q.get('list');
  if (seg[0] === 'watch') {
    const v = q.get('v');
    if (v) return ref('youtube', v, list ? { playlist: list } : {});
    return list ? ref('youtube', list) : null;
  }
  if (['shorts', 'live', 'v', 'e'].includes(seg[0]) && seg[1]) return ref('youtube', seg[1]);
  if (seg[0] === 'embed' && seg[1]) return seg[1] === 'videoseries' && list ? ref('youtube', list) : ref('youtube', seg[1]);
  if (seg[0] === 'playlist' && list) return ref('youtube', list);
  const tab = seg[2] && YT_TABS.has(seg[2]) ? '/' + seg[2] : '';
  if (seg[0]?.startsWith('@')) {
    const t1 = seg[1] && YT_TABS.has(seg[1]) ? '/' + seg[1] : '';
    return ref('youtube', decodeURIComponent(seg[0]) + t1);
  }
  if (seg[0] === 'channel' && seg[1]) return ref('youtube', seg[1] + tab);
  if ((seg[0] === 'c' || seg[0] === 'user') && seg[1]) return ref('youtube', `${seg[0]}/${decodeURIComponent(seg[1])}${tab}`);
  return unknown('youtube', u.href);
}

function fromVimeo(u, host) {
  const seg = u.pathname.split('/').filter(Boolean);
  if (host === 'player.vimeo.com') {
    if (seg[0] === 'video' && /^\d+$/.test(seg[1] || '')) { const h = u.searchParams.get('h'); return ref('vimeo', h && /^[0-9a-f]+$/.test(h) ? `${seg[1]}/${h}` : seg[1]); }
    return null;
  }
  if (/^\d+$/.test(seg[0] || '')) return ref('vimeo', seg[1] && /^[0-9a-f]{6,}$/.test(seg[1]) ? `${seg[0]}/${seg[1]}` : seg[0]);
  if (seg[0] === 'channels' && seg[1]) return /^\d+$/.test(seg[2] || '') ? ref('vimeo', seg[2]) : ref('vimeo', `channels/${seg[1]}`);
  if (seg[0] === 'groups' && seg[1]) return seg[2] === 'videos' && /^\d+$/.test(seg[3] || '') ? ref('vimeo', seg[3]) : ref('vimeo', `groups/${seg[1]}`);
  if ((seg[0] === 'showcase' || seg[0] === 'album') && /^\d+$/.test(seg[1] || '')) return ref('vimeo', `${seg[0]}/${seg[1]}`);
  if (seg.length >= 1 && !VIMEO_RESERVED.has(seg[0])) return ref('vimeo', seg[0]) || unknown('vimeo', u.href);
  return unknown('vimeo', u.href);
}

function fromDailymotion(u, host) {
  const seg = u.pathname.split('/').filter(Boolean);
  if (host === 'dai.ly') return seg[0] ? ref('dailymotion', seg[0]) : null;
  const vid = (x) => (x || '').split('_')[0];
  if (seg[0] === 'video' && seg[1]) return ref('dailymotion', vid(seg[1]));
  if (seg[0] === 'embed' && seg[1] === 'video' && seg[2]) return ref('dailymotion', vid(seg[2]));
  if (seg[0] === 'playlist' && seg[1]) return ref('dailymotion', `playlist/${vid(seg[1])}`);
  if (seg.length === 1 && /^[\w.-]+$/.test(seg[0])) return ref('dailymotion', `user/${seg[0]}`);
  return unknown('dailymotion', u.href);
}

function fromSoundCloud(u, host) {
  if (host === 'on.soundcloud.com') return unknown('soundcloud', u.href);
  const seg = u.pathname.split('/').filter(Boolean);
  if (!seg.length) return unknown('soundcloud', u.href);
  return ref('soundcloud', seg.join('/')) || unknown('soundcloud', u.href);
}

function fromBandcamp(u, host) {
  const artist = host.slice(0, -'.bandcamp.com'.length);
  if (!artist || artist === 'www' || artist.includes('.')) return unknown('bandcamp', u.href);
  const seg = u.pathname.split('/').filter(Boolean);
  if (!seg.length || (seg.length === 1 && seg[0] === 'music')) return ref('bandcamp', artist);
  if ((seg[0] === 'track' || seg[0] === 'album') && seg[1]) return ref('bandcamp', `${artist}/${seg[0]}/${seg[1]}`);
  return unknown('bandcamp', u.href);
}

function fromTwitch(u, host) {
  const seg = u.pathname.split('/').filter(Boolean);
  if (host === 'clips.twitch.tv') return seg[0] ? ref('twitch', `clip/${seg[0]}`) : null;
  if (seg[0] === 'videos' && /^\d+$/.test(seg[1] || '')) return ref('twitch', `v${seg[1]}`);
  if (seg[1] === 'clip' && seg[2]) return ref('twitch', `clip/${seg[2]}`);
  if (seg[1] === 'v' && /^\d+$/.test(seg[2] || '')) return ref('twitch', `v${seg[2]}`);
  if (seg[0] && !TWITCH_RESERVED.has(seg[0].toLowerCase())) return ref('twitch', seg[1] === 'videos' ? `${seg[0].toLowerCase()}/videos` : seg[0].toLowerCase()) || unknown('twitch', u.href);
  return unknown('twitch', u.href);
}

function fromNiconico(u, host) {
  const seg = u.pathname.split('/').filter(Boolean);
  if (host === 'nico.ms') return seg[0] ? ref('niconico', seg[0]) || unknown('niconico', u.href) : null;
  if (seg[0] === 'watch' && seg[1]) return ref('niconico', seg[1]) || unknown('niconico', u.href);
  if (seg[0] === 'mylist' && /^\d+$/.test(seg[1] || '')) return ref('niconico', `mylist/${seg[1]}`);
  if (seg[0] === 'user' && /^\d+$/.test(seg[1] || '')) {
    if (seg[2] === 'mylist' && /^\d+$/.test(seg[3] || '')) return ref('niconico', `mylist/${seg[3]}`);
    if (seg[2] === 'series' && /^\d+$/.test(seg[3] || '')) return ref('niconico', `series/${seg[3]}`);
    return ref('niconico', `user/${seg[1]}`);
  }
  if (seg[0] === 'series' && /^\d+$/.test(seg[1] || '')) return ref('niconico', `series/${seg[1]}`);
  return unknown('niconico', u.href);
}

function fromBilibili(u, host) {
  const seg = u.pathname.split('/').filter(Boolean);
  if (host === 'space.bilibili.com') return /^\d+$/.test(seg[0] || '') ? ref('bilibili', `space/${seg[0]}`) : unknown('bilibili', u.href);
  if (host === 'b23.tv') return unknown('bilibili', u.href);
  if (seg[0] === 'video' && seg[1]) return ref('bilibili', seg[1]) || unknown('bilibili', u.href);
  if (seg[0] === 'bangumi' && seg[1] === 'play' && seg[2]) return ref('bilibili', seg[2]) || unknown('bilibili', u.href);
  return unknown('bilibili', u.href);
}

function fromPeerTube(u) {
  const seg = u.pathname.split('/').filter(Boolean);
  const host = u.host.toLowerCase();
  const isId = (x) => SHORT_UUID.test(x || '') || UUID.test(x || '');
  if (seg[0] === 'w' && seg[1] === 'p' && isId(seg[2])) return ref('peertube', `${host}/w/p/${seg[2]}`);
  if (seg[0] === 'w' && isId(seg[1])) return ref('peertube', `${host}/w/${seg[1]}`);
  if (seg[0] === 'videos' && seg[1] === 'watch' && seg[2] === 'playlist' && isId(seg[3])) return ref('peertube', `${host}/w/p/${seg[3]}`);
  if (seg[0] === 'videos' && seg[1] === 'watch' && isId(seg[2])) return ref('peertube', `${host}/w/${seg[2]}`);
  if ((seg[0] === 'c' || seg[0] === 'a') && seg[1] && /^(videos|video-channels|video-playlists)$/.test(seg[2] || '')) return ref('peertube', `${host}/${seg[0]}/${seg[1]}`);
  if (seg[0] === 'video-channels' && seg[1]) return ref('peertube', `${host}/c/${seg[1]}`);
  if (seg[0] === 'accounts' && seg[1]) return ref('peertube', `${host}/a/${seg[1]}`);
  return null;
}

// Scheme-less input ("youtu.be/x") is accepted only for known hosts; arbitrary "example.com/x" text stays null so
// free text is not mistaken for a link.
const BARE_HOST = /^(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com|vimeo\.com|player\.vimeo\.com|dailymotion\.com|dai\.ly|soundcloud\.com|on\.soundcloud\.com|[\w-]+\.bandcamp\.com|twitch\.tv|clips\.twitch\.tv|nicovideo\.jp|sp\.nicovideo\.jp|nico\.ms|bilibili\.com|space\.bilibili\.com|b23\.tv)(?:[/?#]|$)/i;

// `extractor:id` is tested before URL parsing; the (?!\/\/) lookahead keeps "https://..." from matching as
// extractor 'https'. Whitespace anywhere means free text, not a reference. Only http(s) URLs are accepted: file:,
// javascript: and data: never reach yt-dlp (which would otherwise happily open local files).
export function parseSource(text) {
  if (text == null) return null;
  if (typeof text === 'object') return text.extractor && text.id ? ref(String(text.extractor).toLowerCase(), text.id) : text.url ? parseSource(text.url) : null;
  const s = String(text).trim();
  if (!s || /\s/.test(s)) return null;
  const m = /^([a-z]+):(?!\/\/)(.+)$/i.exec(s);
  if (m && EXTRACTORS.includes(m[1].toLowerCase())) return ref(m[1].toLowerCase(), m[2]);
  let href = s;
  if (!/^https?:\/\//i.test(href)) {
    if (!BARE_HOST.test(href)) return null;
    href = 'https://' + href;
  }
  let u;
  try { u = new URL(href); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !u.hostname) return null;
  const host = u.hostname.toLowerCase().replace(/^(?:www|m)\./, '');
  let r = null;
  if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com' || host === 'youtu.be') r = fromYouTube(u, host);
  else if (host === 'vimeo.com' || host === 'player.vimeo.com') r = fromVimeo(u, host);
  else if (host === 'dailymotion.com' || host === 'dai.ly') r = fromDailymotion(u, host);
  else if (host === 'soundcloud.com' || host === 'on.soundcloud.com') r = fromSoundCloud(u, host);
  else if (host.endsWith('.bandcamp.com')) r = fromBandcamp(u, host);
  else if (host === 'twitch.tv' || host === 'clips.twitch.tv') r = fromTwitch(u, host);
  else if (host === 'nicovideo.jp' || host === 'sp.nicovideo.jp' || host === 'nico.ms') r = fromNiconico(u, host);
  else if (host === 'bilibili.com' || host === 'space.bilibili.com' || host === 'b23.tv') r = fromBilibili(u, host);
  else r = fromPeerTube(u);
  return r || unknown('generic', u.href);
}

export function formatSource(r) {
  if (!r) return null;
  if (r.extractor && r.id && EXTRACTORS.includes(r.extractor)) return `${r.extractor}:${r.id}`;
  return r.url || null;
}

export function sourceURL(r) {
  const p = parseSource(r);
  return p ? p.url : null;
}

export const isSourceRef = (s) => parseSource(s) !== null;

function resolve(r, fn) {
  const p = parseSource(r);
  if (!p || !/^https?:\/\//i.test(p.url || '')) throw new Error(`${fn}: not a source reference or http(s) URL: ${typeof r === 'string' ? r : JSON.stringify(r)}`);
  return p;
}

// --- jobs -------------------------------------------------------------------------------------------------------

// Machine-readable progress: --progress-template prints one space-separated line per update with fixed field
// order and 'NA' for unknowns, far more robust to parse than the localized human [download] line; --newline forces
// one line per update instead of \r rewrites. --print after_move:filepath= reports the FINAL path after merging and
// post-processing (the only reliable way to learn the output name a template produced).
export const DL_TEMPLATE = 'download:[dl] %(progress.status)s %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s %(progress.filename)s';
export const PP_TEMPLATE = 'postprocess:[pp] %(progress.status)s %(progress.postprocessor)s';
export const FILEPATH_PRINT = 'after_move:filepath=%(filepath)s';

export function infoJob(r, { flat = true, playlistItems = null, ignoreConfig = false } = {}) {
  const p = resolve(r, 'infoJob');
  const a = new Args().add('-J').addIf(flat, '--flat-playlist').add('--no-warnings').add('--no-progress').opt('--playlist-items', playlistItems).addIf(ignoreConfig, '--ignore-config').add(p.url);
  const step = a.step({ tool: 'yt-dlp', comment: `Read the information of ${formatSource(p)}${flat && p.kind !== 'video' ? ' (playlist entries without details)' : ''}`, capture: 'json', parse: 'ytdlp-info' });
  return makeJob('ytdlp.info', `Information about ${formatSource(p)}`, [step], []);
}

// Format selection strings (yt-dlp syntax): 'bv*+ba/b' = best video (any, possibly with audio) + best audio, else
// the best single file; [height<=N] applies to both alternatives. Mode 'video' sorts by -S vcodec:h264,acodec:aac and
// merges into MP4 for universal playback; mode 'audio' takes best audio and extracts with -x (--audio-quality 0 is
// the best VBR when converting). --no-playlist / --yes-playlist remove yt-dlp's guess on watch?v=..&list=.. URLs.
// Privacy/security rule: no cookies, no credentials, no browser cookie import are ever emitted.
export function downloadJob(r, o = {}) {
  const p = resolve(r, 'downloadJob');
  const { outDir = null, template = '%(title)s [%(id)s].%(ext)s', mode = 'best', audioFormat = 'best', maxHeight = null, subs = null, thumbnail = true, embedMetadata = true, embedChapters = true, infoJson = true, playlistItems = null, archive = null, ffmpegLocation = null, rateLimit = null, ignoreConfig = false } = o;
  if (!['best', 'video', 'audio'].includes(mode)) throw new Error('downloadJob: mode must be best, video or audio');
  const a = new Args();
  a.addIf(ignoreConfig, '--ignore-config');
  a.add('--newline', '--progress').add('--progress-template', DL_TEMPLATE).add('--progress-template', PP_TEMPLATE).add('--print', FILEPATH_PRINT);
  a.opt('-P', outDir).add('-o', template);
  const h = maxHeight ? `[height<=${Math.round(maxHeight)}]` : '';
  if (mode === 'audio') {
    a.add('-f', 'ba/b').add('-x');
    if (audioFormat && audioFormat !== 'best') a.add('--audio-format', audioFormat).add('--audio-quality', '0');
  } else if (mode === 'video') {
    a.add('-f', `bv*${h}+ba/b${h}`).add('-S', 'vcodec:h264,res,acodec:aac').add('--merge-output-format', 'mp4');
  } else a.add('-f', `bv*${h}+ba/b${h}`);
  if (subs && (subs.langs?.length || subs.auto)) {
    a.add('--write-subs').addIf(subs.auto, '--write-auto-subs').add('--sub-langs', (subs.langs?.length ? subs.langs : ['en']).join(',')).add('--sub-format', 'vtt/srt/best');
    a.addIf(subs.embed, '--embed-subs');
  }
  if (thumbnail) {
    if (mode === 'best') a.add('--write-thumbnail').add('--convert-thumbnails', 'jpg');
    else a.add('--embed-thumbnail').add('--convert-thumbnails', 'jpg');
  }
  a.addIf(embedMetadata, '--embed-metadata').addIf(embedChapters, '--embed-chapters').addIf(infoJson, '--write-info-json');
  a.opt('--playlist-items', playlistItems);
  if (p.kind === 'video') a.add('--no-playlist');
  else if (p.kind === 'playlist') a.add('--yes-playlist');
  a.opt('--download-archive', archive).opt('--ffmpeg-location', ffmpegLocation).opt('--limit-rate', rateLimit);
  a.add(p.url);
  const what = mode === 'audio' ? `audio${audioFormat !== 'best' ? ' as ' + audioFormat : ''}` : mode === 'video' ? `MP4 video${maxHeight ? ` up to ${maxHeight}p` : ''}` : `best quality${maxHeight ? ` up to ${maxHeight}p` : ''}`;
  const step = a.step({ tool: 'yt-dlp', comment: `Download ${formatSource(p)} (${what})`, progress: 'ytdlp' });
  return makeJob('ytdlp.download', `Download ${formatSource(p)}`, [step], []);
}

// --- progress ---------------------------------------------------------------------------------------------------

// yt-dlp prints binary units (KiB, MiB) in human lines; decimal units are accepted too for other extractors' output.
const UNITS = { b: 1, bytes: 1, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12 };
const numNA = (v) => { if (v == null || /^(NA|None|N\/A|null)$/i.test(v)) return null; const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const size = (n, u) => { const k = UNITS[String(u || 'b').toLowerCase()]; return k ? Math.round(parseFloat(n) * k) : null; };
function clock(s) {
  if (!s || /unknown/i.test(s)) return null;
  const p = String(s).split(':').map(Number);
  if (p.some((x) => !Number.isFinite(x))) return null;
  return p.reduce((a, x) => a * 60 + x, 0);
}

// Ordered matchers from most to least specific: our [dl]/[pp] templates first (exact), then the filepath print, then
// yt-dlp's default human lines (fallback when a user config overrides the template), then WARNING/ERROR, then any
// "[tag] ..." as info. Returns null for unrecognized text so the runner logs it verbatim.
export function parseProgressLine(line) {
  const s = String(line ?? '').replace(/[\r\n]+$/, '').replace(/^\s+/, '');
  if (!s) return null;
  const base = { kind: null, percent: null, downloaded: null, total: null, speed: null, eta: null, file: null };
  let m = /^\[dl\] (\S+) (\S+) (\S+) (\S+) (\S+) (\S+)(?: (.*))?$/.exec(s);
  if (m) {
    const downloaded = numNA(m[2]), total = numNA(m[3]) ?? numNA(m[4]);
    const percent = m[1] === 'finished' ? 100 : downloaded != null && total ? Math.min(100, (downloaded / total) * 100) : null;
    return { ...base, kind: 'download', status: m[1], percent, downloaded, total: total != null ? Math.round(total) : null, speed: numNA(m[5]), eta: numNA(m[6]), file: m[7] && !/^NA$/.test(m[7]) ? m[7] : null };
  }
  if ((m = /^\[pp\] (\S+) (\S+)/.exec(s))) return { ...base, kind: 'postprocess', status: m[1], postprocessor: m[2] };
  if ((m = /^filepath=(.+)$/.exec(s))) return { ...base, kind: 'filepath', file: m[1] };
  if ((m = /^\[download\]\s+Destination:\s+(.+)$/.exec(s))) return { ...base, kind: 'destination', file: m[1] };
  if ((m = /^\[download\]\s+(.+?) has already been downloaded/.exec(s))) return { ...base, kind: 'destination', file: m[1], percent: 100 };
  if ((m = /^\[(?:Merger|ffmpeg)\] Merging formats into "(.+)"$/.exec(s))) return { ...base, kind: 'destination', file: m[1] };
  if ((m = /^\[(\w+)\] Destination:\s+(.+)$/.exec(s))) return { ...base, kind: 'destination', file: m[2], postprocessor: m[1] };
  if ((m = /^\[download\]\s+([\d.]+)%/.exec(s))) {
    const percent = parseFloat(m[1]);
    const t = /\bof\s+~?\s*([\d.]+)\s*([KMGT]i?B|B)\b/i.exec(s);
    const sp = /\bat\s+([\d.]+)\s*([KMGT]i?B|B)\/s/i.exec(s);
    const eta = /\bETA\s+([\d:]+)/.exec(s);
    const total = t ? size(t[1], t[2]) : null;
    return { ...base, kind: 'download', percent, total, downloaded: total != null ? Math.round((total * percent) / 100) : null, speed: sp ? size(sp[1], sp[2]) : null, eta: eta ? clock(eta[1]) : null };
  }
  if ((m = /^WARNING:\s*(.*)$/.exec(s))) return { ...base, kind: 'warning', text: m[1] };
  if ((m = /^ERROR:\s*(.*)$/.exec(s))) return { ...base, kind: 'error', text: m[1] };
  if (/^\[[\w:+-]+\]/.test(s)) return { ...base, kind: 'info', text: s };
  return null;
}

// --- catalog ----------------------------------------------------------------------------------------------------

// Defensive readers for yt-dlp's info JSON: fields differ per extractor and may be null, '', a scalar or a list.
// day(): upload_date is YYYYMMDD without separators.
const arr = (v) => (Array.isArray(v) ? v.filter((x) => x != null && x !== '') : v != null && v !== '' ? [v] : []);
const str = (v) => (v == null || v === '' ? null : String(v));
const numv = (v) => (v == null || v === '' || !Number.isFinite(+v) ? null : +v);
const day = (d) => { const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(d ?? '')); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };

function extractorName(info) {
  const e = String(info.extractor || info.ie_key || info.extractor_key || '').toLowerCase();
  const b = e.split(':')[0];
  if (b === 'youtube' || b === 'youtubetab' || b === 'youtubeplaylist' || b === 'youtubemusic') return 'youtube';
  return b || null;
}

function catalogSource(info, extractor, url) {
  const parsed = url ? parseSource(url) : null;
  if (parsed && parsed.extractor !== 'generic' && parsed.id) return { source: formatSource(parsed), url: parsed.url, kind: parsed.kind };
  if (extractor === 'youtube' && info.id && idKind('youtube', info.id)) {
    const p = ref('youtube', info.id);
    return { source: formatSource(p), url: url || p.url, kind: p.kind };
  }
  return { source: url || (extractor && info.id ? `${extractor}:${info.id}` : null), url: url || null, kind: null };
}

// Classification heuristic: a playlist is anything with entries; an episode has series/season/episode numbers; a
// track has music metadata, no video codec, or comes from an audio-only site; everything else is a video.
// Entries are converted recursively (flat playlists give minimal entries, which the same readers tolerate).
// The final file path is looked up in three places used by different yt-dlp versions.
export function infoToCatalog(info) {
  if (!info || typeof info !== 'object') return null;
  const extractor = extractorName(info);
  const url = str(info.webpage_url) || str(info.original_url) || (/^https?:/.test(info.url || '') ? info.url : null);
  const src = catalogSource(info, extractor, url);
  const isList = info._type === 'playlist' || Array.isArray(info.entries);
  const artists = arr(info.artists).length ? arr(info.artists).map(String) : info.artist ? String(info.artist).split(/\s*,\s*/).filter(Boolean) : arr(info.creators).map(String);
  const artist = str(info.artist) || (artists.length ? artists.join(', ') : null) || str(info.creator);
  const audioOnly = info.vcodec === 'none' || (info.vcodec == null && info.acodec && info.acodec !== 'none' && !info.width && !info.height) || ['soundcloud', 'bandcamp'].includes(extractor);
  const kind = isList ? 'playlist'
    : info.series || info.episode_number != null || info.season_number != null ? 'episode'
    : info.track || info.album || audioOnly ? 'track' : 'video';
  const subs = {};
  for (const [lang, list] of Object.entries(info.subtitles || {})) subs[lang] = [...new Set(arr(list).map((x) => x.ext).filter(Boolean))];
  const auto = Object.keys(info.automatic_captions || {});
  const release = numv(info.release_year) ?? (/^(\d{4})/.exec(String(info.release_date || ''))?.[1] ? +/^(\d{4})/.exec(String(info.release_date))[1] : null);
  const pl = info.playlist_id || info.playlist || info.playlist_index != null
    ? { id: str(info.playlist_id), title: str(info.playlist_title || info.playlist), index: numv(info.playlist_index), count: numv(info.n_entries ?? info.playlist_count) }
    : null;
  return {
    source: src.source, url: src.url, extractor, id: str(info.id), title: str(info.title) || str(info.track) || '',
    kind, artist, artists, album: str(info.album), track: str(info.track), trackNumber: numv(info.track_number),
    releaseYear: release, uploadDate: day(info.upload_date), uploader: str(info.uploader), channel: str(info.channel),
    duration: numv(info.duration), description: str(info.description), tags: arr(info.tags).map(String),
    genres: (arr(info.genres).length ? arr(info.genres) : arr(info.genre)).map(String),
    chapters: arr(info.chapters).map((c) => ({ start: numv(c.start_time) ?? 0, end: numv(c.end_time), title: str(c.title) || '' })),
    thumbnail: str(info.thumbnail) || str(arr(info.thumbnails).filter((t) => t.url).slice(-1)[0]?.url),
    thumbnails: arr(info.thumbnails).filter((t) => t && t.url).map((t) => ({ url: String(t.url), width: numv(t.width), height: numv(t.height) })),
    series: str(info.series), season: numv(info.season_number) ?? str(info.season), episode: numv(info.episode_number) ?? str(info.episode),
    language: str(info.language), playlist: isList ? null : pl,
    entries: isList ? arr(info.entries).map((e) => infoToCatalog(e)).filter(Boolean) : [],
    subtitles: subs, autoSubtitles: auto,
    filepath: str(info.filepath) || str(arr(info.requested_downloads)[0]?.filepath) || str(info._filename) || null,
    ...(isList ? { count: numv(info.playlist_count ?? info.n_entries) ?? arr(info.entries).length } : {}),
  };
}
