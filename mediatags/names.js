// mediatags/names.js - what a file name (and the folders above it) says: scene and fansub release names, movies,
// music tracks, audiobook parts; matching keys and sort forms of titles.
//
//   parseName(nameOrRelPath, { hint = 'auto' }) -> { kind: 'episode' | 'movie' | 'track' | 'chapter' | 'extra' |
//       'unknown', ext, confidence (0..1), and any of: title, show, season, episode, episodeEnd, absolute, special,
//       extra ('op' | 'ed' | 'ncop' | 'nced' | 'pv' | 'cm' | 'preview' | 'menu' | 'trailer' | 'sample' | 'featurette' |
//       'interview' | 'deleted' | 'behindthescenes'), index (number of an extra), version, year, date (daily shows,
//       'yyyy-mm-dd'), group, resolution, source, vcodec, acodec, channels, hdr, bitDepth, crc, lang, edition, repack,
//       part, partTotal, track, disc, artist, album, chapter, author, series, seriesPart }
//     hint: 'auto' | 'music' | 'audiobook' | 'series' | 'anime' | 'movie'. 'auto' decides from library folders in the
//     path (Anime, TV Shows, Series, Movies, Music, Audiobooks, ...), the extension (.m4b: audiobook, audio: music,
//     video: episode / movie). For episodes `title` is the episode title and `show` the series; an episode number
//     without any season is also `absolute`. Folders fill what the name lacks: 'Season 2' / 'Specials' and the show
//     folder above it; 'CD1' / 'Disc 2', '1999 - Album' / 'Album (1999)' and the artist folder; 'Series 03 - Book' and
//     the author folder.
//   parseScene / parseFansub / parseMovie / parseMusic / parseAudiobook (stem) -> the same shape or null
//   cleanTitle(s)        dots / underscores -> spaces (dots kept when the name already has spaces), trimmed
//   normTitle(s)         matching key: NFKC, lowercase, Latin / Greek diacritics removed (ё -> е), & -> and,
//                        punctuation and whitespace collapsed to single spaces ('the' / 'a' kept)
//   sortTitle(s, lang = 'en')   'The Beatles' -> 'Beatles, The' (en / de / fr / es articles; French l' too)

//
// Approach: a cascade of specialised recognisers, most specific first (scene SxxEyy markers, then fansub
// '[Group] Show - 05', then movie 'Title (Year)'), each returning null when its anchor is absent, instead of one big
// regex. A single regex for all naming schemes becomes unmaintainable and its failures are silent; a cascade fails
// over to the next scheme. Every result carries a confidence so callers can prefer embedded tags or ask the user.
// Folder context is applied last and only fills gaps: the file name is closer to the truth than a folder that may
// hold mixed content.
// Regexes use lookarounds B / E instead of  because '_' and '.' are word separators in release names while 
// treats '_' as a word character ('x264_' would not end at ).
import { EXT } from './detect.js';
import { langCode } from './sidecar.js';

const AUDIO = new Set(EXT.audio);
const KNOWN_EXT = new Set([...EXT.audio, ...EXT.video, ...EXT.image, ...EXT.subtitle, ...EXT.lyrics, ...EXT.cue, ...EXT.nfo, ...EXT.playlist, ...EXT.text]);

// --- titles ------------------------------------------------------------------------------------

// Dots become spaces only when the name has no spaces at all ('The.Matrix' vs 'Mr. Robot'): a spaced name uses
// dots as real punctuation. Leading/trailing separators and dashes are stripped.
export function cleanTitle(s) {
  let t = String(s || '');
  if (!/\s/.test(t)) t = t.replace(/[._]+/g, ' ');
  else t = t.replace(/_+/g, ' ');
  return t.replace(/\s+/g, ' ').replace(/^[\s\-–—:,]+|[\s\-–—:,]+$/g, '').trim();
}

// Matching key, not display. NFKC first folds compatibility forms (full-width letters, ligatures); then NFD exposes
// combining marks, which are removed only after Latin / Greek letters: stripping all p{M} would destroy scripts where
// marks are letters (Devanagari vowel signs, Japanese dakuten). 'ё' -> 'е' because Russian writes them
// interchangeably. Articles are kept: dropping 'the' would merge distinct titles ('The Office' vs 'Office').
export function normTitle(s) {
  return String(s || '').normalize('NFKC').toLowerCase()
    .normalize('NFD').replace(/([\p{Script=Latin}\p{Script=Greek}])\p{M}+/gu, '$1').normalize('NFC')
    .replace(/ё/g, 'е').replace(/&/g, ' and ')
    .replace(/[\p{P}\p{S}\s]+/gu, ' ').trim();
}

// Leading articles moved to the end for sorting, per language. The elided French l' is matched with both apostrophes
// (ASCII and U+2019) and has no space before the noun.
const ARTICLES = { en: ['the', 'a', 'an'], de: ['der', 'die', 'das', 'ein', 'eine'], fr: ['le', 'la', 'les', "l'", 'un', 'une'], es: ['el', 'la', 'los', 'las', 'un', 'una'] };

export function sortTitle(s, lang = 'en') {
  const t = String(s || '').trim();
  const list = ARTICLES[String(lang || 'en').slice(0, 2).toLowerCase()] || ARTICLES.en;
  for (const a of list) {
    if (a.endsWith("'")) {
      const m = new RegExp(`^${a.slice(0, -1)}['’](.+)$`, 'i').exec(t);
      if (m) return `${m[1].trim()}, ${t.slice(0, t.length - m[1].length).trim()}`;
      continue;
    }
    const m = new RegExp(`^(${a})\\s+(.+)$`, 'i').exec(t);
    if (m) return `${m[2]}, ${m[1]}`;
  }
  return t;
}

// --- release tags ------------------------------------------------------------------------------

// Release-tag table: [field, regex, converter, strong]. Strong tags (resolution, source, video codec) reliably mark the
// END of the title in scene names; weak ones (language words, 'dual', bit depth) can also be title words ('German' in a
// documentary title), so they are collected but do not cut the title. Converters normalise spellings to canonical ids.
const B = '(?<![a-z0-9])', E = '(?![a-z0-9])';
const re = (s) => new RegExp(B + s + E, 'i');
const TAGS = [
  ['resolution', re('(4320p|2160p|1440p|1080[pi]|720p|576[pi]|480[pi]|360p|240p)'), (m) => m[1].toLowerCase(), true],
  ['resolution', re('(\\d{3,4})x(\\d{3,4})'), (m) => `${m[2]}p`, true],
  ['resolution', re('(4k|uhd)'), () => '2160p', true],
  ['source', re('(web[-. ]?dl|webrip|web[-. ]rip|web|blu[-. ]?ray|bdrip|brrip|bdremux|bd|hdtv|pdtv|sdtv|dvdrip|dvd[-. ]?r|dvd|hdrip|tvrip|vhsrip|hd[-. ]?dvd|remux)'), (m) => {
    const v = m[1].toLowerCase().replace(/[-. ]/g, '');
    return { webdl: 'WEB-DL', webrip: 'WEBRip', web: 'WEB', bluray: 'BluRay', bdrip: 'BDRip', brrip: 'BRRip', bdremux: 'BD', bd: 'BD', hdtv: 'HDTV', pdtv: 'PDTV',
      sdtv: 'SDTV', dvdrip: 'DVDRip', dvdr: 'DVD', dvd: 'DVD', hdrip: 'HDRip', tvrip: 'TVRip', vhsrip: 'VHSRip', hddvd: 'HD-DVD', remux: 'Remux' }[v] || m[1];
  }, true],
  ['vcodec', re('(x264|x265|h[ .]?264|h[ .]?265|avc|hevc|av1|vp9|xvid|divx|mpeg-?2)'), (m) => {
    const v = m[1].toLowerCase().replace(/[ .-]/g, '');
    return { h264: 'h264', avc: 'h264', h265: 'hevc', hevc: 'hevc', mpeg2: 'mpeg2' }[v] || v;
  }, true],
  ['acodec', re('(ddp|dd\\+|e-?ac-?3|dd|ac-?3|aac|dts[-. ]?hd[-. ]?ma|dts[-. ]?hd|dts[-. ]?x|dts|truehd|atmos|flac|opus|mp3|lpcm|pcm)(?:[ .]?([257]\\.[01]))?'), (m) => {
    const v = m[1].toLowerCase().replace(/[-. ]/g, '');
    return { ddp: 'eac3', 'dd+': 'eac3', eac3: 'eac3', dd: 'ac3', ac3: 'ac3', dtshdma: 'dts-hd ma', dtshd: 'dts-hd', dtsx: 'dts:x' }[v] || v;
  }, false],
  ['hdr', re('(hdr10\\+|hdr10|hdr|dovi|dv|dolby[ .]vision|hlg)'), (m) => {
    const v = m[1].toLowerCase().replace(/[ .]/g, '');
    return { 'hdr10+': 'HDR10+', hdr10: 'HDR10', hdr: 'HDR', dovi: 'DV', dv: 'DV', dolbyvision: 'DV', hlg: 'HLG' }[v];
  }, false],
  ['edition', re("(director'?s[ .]cut|directors[ .]edition|extended(?:[ .](?:cut|edition))?|unrated|theatrical(?:[ .]cut)?|remastered|criterion|imax|final[ .]cut|special[ .]edition|ultimate[ .](?:edition|cut)|uncut|collector'?s[ .]edition|anniversary[ .]edition)"), (m) => {
    const v = m[1].toLowerCase().replace(/[.']/g, ' ').replace(/\s+/g, ' ');
    if (/director/.test(v)) return "Director's Cut";
    return v.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/^Imax$/, 'IMAX').replace(/Collector S/, "Collector's");
  }, false],
  ['lang', re('(multi|dual[ .]audio|dual|vostfr|vff|truefrench|french|german|deutsch|italian|ita|spanish|esp|russian|rus|english|eng|japanese|jap|jpn|korean|kor|chinese|chs|cht)'), (m) => {
    const v = m[1].toLowerCase();
    if (/^(multi)$/.test(v)) return 'multi';
    if (/^dual/.test(v)) return 'dual';
    if (/^(vostfr|vff|truefrench)$/.test(v)) return 'fr';
    return langCode(v) || v;
  }, false],
  ['bitDepth', re('(10|8|12)[ .-]?bits?'), (m) => +m[1], false],
  ['repack', re('(proper|repack|rerip)'), () => true, false],
];
const STRONG = new Set(['resolution', 'source', 'vcodec']);

// Each regex is re-created with the 'g' flag (the table stores non-global ones so .test() has no lastIndex state).
// First match per field wins; the position of the earliest strong tag is the title boundary.
// Release tags of a string: { tags, first (index of the first strong tag, else of any tag; -1) }.
function scanTags(s, { all = true } = {}) {
  const tags = {};
  let first = -1, firstAny = -1;
  for (const [key, rx, conv, strong] of TAGS) {
    const g = new RegExp(rx.source, 'gi');
    let m;
    while ((m = g.exec(s))) {
      if (tags[key] == null) {
        const v = conv(m);
        if (v != null) tags[key] = v;
        if (key === 'acodec' && m[2]) tags.channels = m[2];
      }
      if (strong && (first < 0 || m.index < first)) first = m.index;
      if (firstAny < 0 || m.index < firstAny) firstAny = m.index;
      if (!all) break;
    }
  }
  return { tags, first: first >= 0 ? first : firstAny };
}

// Brackets hold metadata in fansub names ([1080p], (2005), [ABCD1234]); they are extracted and the text without them
// is parsed separately, so a bracketed year cannot be mistaken for an episode number.
// Bracket groups: [...] and (...) -> their contents; the rest of the string.
function brackets(s) {
  const groups = [];
  const rest = s.replace(/\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\}/g, (m, a, b, c) => { groups.push({ text: a ?? b ?? c, round: b != null }); return ' '; });
  return { groups, rest: rest.replace(/\s+/g, ' ').trim() };
}

// Fansub CRC32 checksum: exactly 8 hex digits in brackets. YEAR limits plausible years to 1900..2099.
const CRC = /^[0-9A-F]{8}$/i;
const YEAR = /^(19\d{2}|20\d{2})$/;

function tagGroups(groups, out) {
  for (const g of groups) {
    const t = g.text.trim();
    if (CRC.test(t) && !YEAR.test(t)) { out.crc = t.toUpperCase(); continue; }
    if (YEAR.test(t)) { if (out.year == null) out.year = +t; continue; }
    const { tags } = scanTags(t);
    for (const [k, v] of Object.entries(tags)) if (out[k] == null) out[k] = v;
  }
}

// Scene group = trailing '-GROUP'. Rejected when it is really part of a tag ('WEB-DL', 'DTS-HD MA', 'x-264') or
// numeric (an episode range '-02').
function sceneGroup(s) {
  const m = /-([A-Za-z0-9][A-Za-z0-9_]*)$/.exec(s);
  if (!m) return null;
  const before = s.slice(0, m.index);
  if (/(?:^|[ ._])web$/i.test(before) && /^dl$/i.test(m[1])) return null;
  if (/^\d+$/.test(m[1]) || /^(dl|rip|hd|ma|x)$/i.test(m[1])) return null;
  return m[1];
}

function merge(out, tags) { for (const [k, v] of Object.entries(tags)) if (out[k] == null) out[k] = v; return out; }

// Peels known suffixes from a show name in a fixed order (year, then season, then special marker), so 'Show 2005 S2'
// and 'Show (2005) Season 2' both resolve.
// Show title -> { show, year, season?, special? } (trailing '(2005)' / '2005', 'S2', '2nd Season', 'Season 2', OVA).
function showTitle(raw) {
  let t = cleanTitle(raw).replace(/[\s\-–—]+$/, '');
  const out = {};
  let m = /^(.*\S)\s*[([]\s*((?:19|20)\d{2})\s*[)\]]$/.exec(t);
  if (m) { out.year = +m[2]; t = m[1]; } else if ((m = /^(.*\S)\s+((?:19|20)\d{2})$/.exec(t))) { out.year = +m[2]; t = m[1]; }
  if ((m = /^(.*\S)\s+S(\d{1,2})$/i.exec(t))) { out.season = +m[2]; t = m[1]; }
  else if ((m = /^(.*\S)\s+(\d{1,2})(?:st|nd|rd|th)\s+Season$/i.exec(t))) { out.season = +m[2]; t = m[1]; }
  else if ((m = /^(.*\S)\s+Season\s+(\d{1,2})$/i.exec(t))) { out.season = +m[2]; t = m[1]; }
  if ((m = /^(.*\S)\s+(OVA|OAD|ONA|Specials?|SP)$/i.exec(t))) { out.special = true; t = m[1]; }
  out.show = t.trim();
  return out;
}

const tidy = (o) => { for (const k of Object.keys(o)) if (o[k] == null || o[k] === '') delete o[k]; return o; };

// --- scene / TV ----------------------------------------------------------------------------------

// Scene/TV: anchors, in decreasing reliability: SxxEyy (with multi-episode 'E01E02' / 'E01-02' ranges), 1x02,
// 'Season 1 Episode 2', and daily-show dates. Text before the anchor is the show, text after up to the first release
// tag is the episode title. A SxxEyy glued to more letters ('S01E05abc') is rejected: it is not a marker.
export function parseScene(stem) {
  const s = String(stem || '');
  let m, start, end, out = { kind: 'episode' };
  let conf = 0.95;
  if ((m = new RegExp(B + 's(\\d{1,3})[ ._-]?e(\\d{1,4})', 'i').exec(s))) {
    out.season = +m[1];
    out.episode = +m[2];
    start = m.index;
    end = m.index + m[0].length;
    const more = /^(?:(?:[ ._-]?-?[ ._-]?e|-)(\d{1,4}))+(?![0-9a-z])/i.exec(s.slice(end));
    if (more) {
      const nums = [...more[0].matchAll(/(\d{1,4})/g)].map((x) => +x[1]);
      if (nums.length) out.episodeEnd = nums[nums.length - 1];
      end += more[0].length;
    } else if (/^[0-9a-z]/i.test(s.slice(end))) return null;
  } else if ((m = new RegExp(B + '(\\d{1,2})x(\\d{2,3})' + E, 'i').exec(s))) {
    out.season = +m[1]; out.episode = +m[2]; start = m.index; end = start + m[0].length; conf = 0.85;
    const more = /^(?:[-_.]?\d{1,2}x(\d{2,3}))+/i.exec(s.slice(end));
    if (more) { out.episodeEnd = +more[1]; end += more[0].length; }
  } else if ((m = /(?:^|[ ._-])season[ ._-]*(\d{1,2})[ ._,-]*episode[ ._-]*(\d{1,4})(?![0-9])/i.exec(s))) {
    out.season = +m[1]; out.episode = +m[2]; start = m.index; end = start + m[0].length; conf = 0.9;
  } else if ((m = /(?<!\d)((?:19|20)\d{2})[._ -](0[1-9]|1[0-2])[._ -](0[1-9]|[12]\d|3[01])(?!\d)/.exec(s))) {
    out.date = `${m[1]}-${m[2]}-${m[3]}`; out.year = +m[1]; start = m.index; end = start + m[0].length; conf = 0.85;
  } else return null;
  const head = s.slice(0, start);
  const tail = s.slice(end);
  const st = showTitle(head.replace(/\[[^\]]*\]\s*$/, ''));
  if (st.show) out.show = st.show;
  if (st.year != null && out.year == null) out.year = st.year;
  const lead = /^\s*\[([^\]]+)\]/.exec(head);
  if (lead) out.show = showTitle(head.slice(lead[0].length)).show || out.show, out.group = lead[1];
  // the episode title: text after the marker up to the first release tag or bracket
  const { groups, rest } = brackets(tail);
  tagGroups(groups, out);
  const { tags, first } = scanTags(rest);
  merge(out, tags);
  let et = first >= 0 ? rest.slice(0, first) : rest;
  const grp = sceneGroup(rest);
  if (grp && out.group == null) { out.group = grp; if (first < 0) et = et.replace(new RegExp(`-${grp}$`), ''); }
  et = cleanTitle(et.replace(/^[\s._-]+/, ''));
  if (et && !/^(?:\d{3,4}p|web|hdtv)$/i.test(et)) out.title = et;
  out.confidence = conf;
  return tidy(out);
}

// --- fansub / anime --------------------------------------------------------------------------------

// Anime extras: OP/ED (opening/ending), NC = creditless, PV = promo video, CM = commercial.
const EXTRA_WORDS = { op: 'op', ed: 'ed', ncop: 'ncop', nced: 'nced', pv: 'pv', cm: 'cm', preview: 'preview', menu: 'menu', trailer: 'trailer' };

// Fractional episodes (12.5) are recaps/specials by fansub convention, hence special = true. v2 = re-release.
// The episode part of a fansub name ('05v2', '12.5', 'S01E05', 'NCOP1', 'OVA 2', '05 - Title') -> fields or null.
function episodePart(ep) {
  let x;
  const res = { kind: 'episode' };
  if ((x = /^S(\d{1,2})E(\d{1,4})(?:v(\d+))?(?:\s+(.*))?$/i.exec(ep))) {
    res.season = +x[1]; res.episode = +x[2]; if (x[3]) res.version = +x[3]; if (x[4]) res.title = cleanTitle(x[4].replace(/^-\s*/, ''));
  } else if ((x = /^(NC)?(OP|ED)\s*(\d*)(?:v(\d+))?(?:\s+(.*))?$/i.exec(ep))) {
    res.kind = 'extra'; res.extra = ((x[1] || '') + x[2]).toLowerCase(); if (x[3]) res.index = +x[3]; if (x[4]) res.version = +x[4];
  } else if ((x = /^(PV|CM|Preview|Menu|Trailer)\s*(\d*)$/i.exec(ep))) {
    res.kind = 'extra'; res.extra = EXTRA_WORDS[x[1].toLowerCase()]; if (x[2]) res.index = +x[2];
  } else if ((x = /^(OVA|OAD|ONA|SP|Special)\s*(\d*)(?:v(\d+))?$/i.exec(ep))) {
    res.special = true; if (x[2]) res.episode = +x[2]; if (x[3]) res.version = +x[3];
  } else if ((x = /^(?:E|Ep|Episode\s*)?(\d{1,4})(?:\.(\d))?(?:v(\d+))?(?:(?:\s*-\s*|\s+)(.*))?$/i.exec(ep))) {
    res.episode = x[2] ? +`${x[1]}.${x[2]}` : +x[1];
    if (x[2]) res.special = true;
    if (x[3]) res.version = +x[3];
    const t = cleanTitle(x[4] || '');
    if (t) res.title = t;
  } else return null;
  return res;
}

// Fansub: '[Group] Show - 05v2 - Title [1080p][CRC]'. Without a leading group a ' - ' separator is required, otherwise
// any 'Artist - Title' would parse as an anime episode. The split point is the leftmost ' - ' whose right side parses as
// an episode part, because show names themselves may contain ' - '. An episode without season is also 'absolute'
// (anime numbering commonly runs across seasons).
export function parseFansub(stem) {
  let s = String(stem || '').trim();
  const out = {};
  const g = /^\[([^\]]+)\]\s*/.exec(s);
  if (g) { out.group = g[1].trim(); s = s.slice(g[0].length); }
  const { groups, rest } = brackets(s);
  tagGroups(groups, out);
  let core = rest.replace(/[_]+/g, ' ').trim();
  if (!g && !/\s-\s/.test(core)) return null;
  // trailing release tags without brackets
  const tailTags = scanTags(core);
  if (tailTags.first > 0 && /\s-\s/.test(core.slice(0, tailTags.first))) { merge(out, tailTags.tags); core = core.slice(0, tailTags.first).trim(); }
  // the leftmost ' - ' whose right side reads as an episode (titles may hold ' - ' themselves)
  let showPart = null, res = null;
  for (const sp of core.matchAll(/\s-\s/g)) {
    const r = episodePart(core.slice(sp.index + sp[0].length).trim());
    if (r) { showPart = core.slice(0, sp.index); res = r; break; }
  }
  if (!res) {
    const m = /^(.*?)\s+(?:ep?\.?\s*)?(\d{2,4}(?:\.\d)?(?:v\d+)?)$/i.exec(core);
    if (m && g) { showPart = m[1]; res = episodePart(m[2]); }
    if (!res) {
      if (!g) return null;
      const st = showTitle(core);
      return tidy({ kind: 'movie', title: st.show, year: st.year ?? out.year, ...out, confidence: 0.5 });
    }
  }
  const st = showTitle(showPart);
  res.show = st.show;
  if (st.year != null) res.year = st.year;
  if (st.season != null && res.season == null) res.season = st.season;
  if (st.special) res.special = true;
  if (res.season == null && res.episode != null && !res.special) res.absolute = res.episode;
  merge(res, out);
  res.confidence = res.kind === 'extra' ? 0.8 : g ? 0.9 : 0.75;
  return tidy(res);
}

// --- movies --------------------------------------------------------------------------------------

// Movie: title ends at the year (the last year not at position 0 and not after the first release tag; '2001 A Space
// Odyssey 1968' keeps 2001 in the title), else at the first release tag. Confidence reflects which anchors exist.
export function parseMovie(stem) {
  let s = String(stem || '').trim();
  const out = { kind: 'movie' };
  const g = /^\[([^\]]+)\]\s*/.exec(s);
  if (g) { out.group = g[1].trim(); s = s.slice(g[0].length); }
  const grp = sceneGroup(s);
  // years: the last one that is not at the start
  const years = [...s.matchAll(/(?<![0-9a-z])(19\d{2}|20\d{2})(?![0-9])/gi)].filter((m) => m.index > 0);
  const { tags, first } = scanTags(s);
  let titleEnd;
  const y = years.filter((m) => first < 0 || m.index < first + 1).pop() || years[years.length - 1];
  if (y) { out.year = +y[1]; titleEnd = y.index; } else titleEnd = first >= 0 ? first : s.length;
  let title = s.slice(0, titleEnd).replace(/[\s._\-([]+$/, '');
  const { groups, rest } = brackets(title);
  title = rest;
  tagGroups(brackets(s.slice(titleEnd)).groups, out);
  tagGroups(groups, out);
  merge(out, tags);
  if (grp && out.group == null && (first >= 0 || y)) out.group = grp;
  if (!y && first < 0 && grp) title = title.replace(new RegExp(`-${grp}$`), '');
  out.title = cleanTitle(title);
  if (!out.title) return null;
  out.confidence = y ? (first >= 0 ? 0.9 : 0.8) : first >= 0 ? 0.6 : 0.4;
  return tidy(out);
}

// --- music ---------------------------------------------------------------------------------------

// Music patterns, most structured first: 'Artist - Album - 01 - Title', 'Artist - 01 - Title', disc-track '1-05 Title'
// (disc <= 20 so '2005 Title' is not disc 2005), '(01) Title', '01. Title'. A numeric 'artist' is rejected: it is a
// track number.
export function parseMusic(stem) {
  const s = cleanTitle(String(stem || '').replace(/_/g, ' ')).replace(/\s+/g, ' ');
  const out = { kind: 'track' };
  const split = (rest) => {
    const k = rest.indexOf(' - ');
    if (k > 0) { out.artist = rest.slice(0, k).trim(); out.title = rest.slice(k + 3).trim(); } else out.title = rest.trim();
  };
  let m;
  if ((m = /^(.+?) - (.+?) - (\d{1,3})\.? - (.+)$/.exec(s))) { out.artist = m[1]; out.album = m[2]; out.track = +m[3]; out.title = m[4]; out.confidence = 0.85; }
  else if ((m = /^(.+?) - (\d{1,3})\.? - (.+)$/.exec(s)) && !/^\d+$/.test(m[1])) { out.artist = m[1]; out.track = +m[2]; out.title = m[3]; out.confidence = 0.8; }
  else if ((m = /^(\d{1,2})[-.](\d{1,3})(?:\s*[-.)]\s*|\s+)(.+)$/.exec(s)) && +m[1] <= 20 && +m[1] > 0) { out.disc = +m[1]; out.track = +m[2]; split(m[3]); out.confidence = 0.8; }
  else if ((m = /^[([](\d{1,3})[)\]]\s*[-.]?\s*(.+)$/.exec(s))) { out.track = +m[1]; split(m[2]); out.confidence = 0.75; }
  else if ((m = /^(\d{1,3})(?:\s*[-.)]\s*|\s+)(.+)$/.exec(s))) { out.track = +m[1]; split(m[2]); out.confidence = 0.8; }
  else if ((m = /^track\s*(\d{1,3})$/i.exec(s))) { out.track = +m[1]; out.confidence = 0.6; }
  else if ((m = /^(\d{1,3})$/.exec(s))) { out.track = +m[1]; out.confidence = 0.5; }
  else { split(s); out.confidence = out.artist ? 0.6 : 0.3; }
  if (out.title) out.title = out.title.replace(/^[-.\s]+/, '').trim();
  return tidy(out);
}

// --- audiobooks ------------------------------------------------------------------------------------

// Audiobook patterns with chapter / part words in several languages (the Cyrillic forms are deliberate, a Russian
// audiobook library is a target), then plain track numbers, then 'Book - 03' / 'Book - Part 3 of 12'.
export function parseAudiobook(stem) {
  const s = cleanTitle(String(stem || '').replace(/_/g, ' '));
  const out = { kind: 'chapter' };
  let m;
  if ((m = /^(?:chapter|chap|ch|kapitel|chapitre|capitulo|capítulo|глава)\.?\s*(\d{1,4})(?:\s*[-:.]\s*|\s+)?(.*)$/i.exec(s))) {
    out.chapter = +m[1]; if (m[2]) out.title = cleanTitle(m[2]); out.confidence = 0.85;
  } else if ((m = /^(?:part|pt|teil|partie|parte|часть)\.?\s*(\d{1,4})(?:\s*(?:of|\/|из|von|de)\s*(\d{1,4}))?(?:\s*[-:.]\s*|\s+)?(.*)$/i.exec(s))) {
    out.part = +m[1]; if (m[2]) out.partTotal = +m[2]; if (m[3]) out.title = cleanTitle(m[3]); out.confidence = 0.85;
  } else if ((m = /^(?:disc|disk|cd)\s*(\d{1,3})(?:\s*[-:.]\s*|\s+)?(.*)$/i.exec(s))) {
    out.disc = +m[1]; if (m[2]) out.title = cleanTitle(m[2]); out.confidence = 0.6;
  } else if ((m = /^(\d{1,4})(?:\s*[-.)]\s*|\s+)(.+)$/.exec(s))) {
    out.track = +m[1];
    const rest = m[2];
    const c = /^(?:chapter|chap|ch|глава)\.?\s*(\d{1,4})(?:\s*[-:.]\s*|\s+)?(.*)$/i.exec(rest);
    if (c) { out.chapter = +c[1]; if (c[2]) out.title = cleanTitle(c[2]); } else out.title = cleanTitle(rest);
    out.confidence = 0.7;
  } else if ((m = /^(.+?)\s*-\s*(?:part|pt|chapter|ch)?\.?\s*(\d{1,4})(?:\s*(?:of|\/)\s*(\d{1,4}))?$/i.exec(s))) {
    out.album = cleanTitle(m[1]); out.track = +m[2]; if (m[3]) out.partTotal = +m[3]; out.confidence = 0.7;
  } else if ((m = /^(\d{1,4})$/.exec(s))) { out.track = +m[1]; out.confidence = 0.5; }
  else { out.title = s; out.confidence = 0.3; }
  return tidy(out);
}

// --- folders -------------------------------------------------------------------------------------

// Library root folder names set the hint and are not used as show / album names. A null hint ('Videos', 'Downloads')
// means 'generic root': skipped, but no hint.
const ROOTS = [
  [/^(anime|аниме)$/i, 'anime'], [/^(tv|tv[ ._-]?shows?|series|shows|сериалы)$/i, 'series'], [/^(movies?|films?|кино|фильмы)$/i, 'movie'],
  [/^(music|музыка|musik|musique)$/i, 'music'], [/^(audio[ ._-]?books?|аудиокниги|hörbücher|hoerbuecher)$/i, 'audiobook'],
  [/^(videos?|media|downloads?|library|видео)$/i, null],
];
const rootHint = (d) => { for (const [rx, h] of ROOTS) if (rx.test(d.trim())) return { hint: h }; return null; };
const SEASON_DIR = /^(?:season|staffel|saison|temporada|stagione|сезон)[ ._-]*(\d{1,3})$|^s(\d{1,3})$/i;
const SPECIALS_DIR = /^(specials?|extras?|sp|ova)$/i;
const DISC_DIR = /^(?:cd|disc|disk|диск)[ ._-]*(\d{1,2})(?:\b.*)?$/i;

// Album folder conventions: '1999 - Album', 'Album (1999)', 'Artist - 1999 - Album', 'Artist - Album'.
function albumDir(d) {
  const t = cleanTitle(d);
  let m;
  if ((m = /^[([]?((?:19|20)\d{2})[)\]]?\s*[-–.]?\s+(.+)$/.exec(t))) return { year: +m[1], album: m[2].trim() };
  if ((m = /^(.+?)\s*[([]((?:19|20)\d{2})[)\]]$/.exec(t))) return { year: +m[2], album: m[1].trim() };
  if ((m = /^(.+?) - ((?:19|20)\d{2}) - (.+)$/.exec(t))) return { artist: m[1], year: +m[2], album: m[3] };
  if ((m = /^(.+?) - (.+)$/.exec(t))) return { artist: m[1], album: m[2] };
  return { album: t };
}

// Audiobook folder conventions: 'Series 03 - Book' (also '#3', 'Vol. 3', 'Book 3'), 'Author - Book'.
function bookDir(d) {
  const t = cleanTitle(d);
  let m;
  if ((m = /^(.+?)\s+(?:#|vol\.?\s*|book\s*)?(\d{1,3}(?:\.\d)?)\s*[-–:]\s*(.+)$/i.exec(t))) return { series: m[1].trim(), seriesPart: +m[2], album: m[3].trim() };
  if ((m = /^(.+?) - (.+)$/.exec(t))) return { author: m[1], album: m[2] };
  return { album: t };
}

// Extension rule: a known extension, or a short alphanumeric non-numeric one; '2001.1968' or 'Mr. Smith' must not lose
// a fake extension. Hint resolution: explicit hint > library root folder > extension. For video, scene beats fansub,
// fansub episode beats a movie reading, and series/anime hints allow bare '05 - Title' episode names.
/** Parses a file name or a relative path (see the header). */
export function parseName(input, { hint = 'auto' } = {}) {
  const path = String(input || '').replace(/\\/g, '/').replace(/^\.?\/+/, '');
  const segs = path.split('/').filter(Boolean);
  const file = segs.pop() || '';
  const dot = file.lastIndexOf('.');
  const extRaw = dot > 0 ? file.slice(dot + 1).toLowerCase() : '';
  const ext = KNOWN_EXT.has(extRaw) || (extRaw && extRaw.length <= 4 && /^[a-z0-9]+$/.test(extRaw) && !/^\d+$/.test(extRaw)) ? extRaw : '';
  const stem = ext ? file.slice(0, dot) : file;
  const dirs = [];
  let h = hint;
  for (const d of segs) {
    const r = rootHint(d);
    if (r) { if (h === 'auto' && r.hint) h = r.hint; continue; }
    dirs.push(d);
  }
  if (h === 'auto') {
    if (ext === 'm4b') h = 'audiobook';
    else if (AUDIO.has(ext)) h = 'music';
    else h = 'video';
  }
  const near = [...dirs].reverse();
  let r = null;
  if (h === 'music') r = parseMusic(stem);
  else if (h === 'audiobook') r = parseAudiobook(stem);
  else {
    const scene = parseScene(stem);
    const fan = scene ? null : parseFansub(stem);
    if (scene) r = scene;
    else if (fan && fan.kind !== 'movie') r = fan;
    else if (h === 'series' || h === 'anime') {
      const m = /^(?:e|ep|episode)?[ ._-]*(\d{1,4})(?:v(\d+))?(?:\s*[-.]\s*(.*))?$/i.exec(stem.trim());
      if (m) r = tidy({ kind: 'episode', episode: +m[1], version: m[2] ? +m[2] : null, title: m[3] ? cleanTitle(m[3]) : null, confidence: 0.6 });
    }
    if (!r) {
      const extra = /(?:^|[ ._-])(trailer|sample|featurette|interview|deleted(?:[ ._-]scenes?)?|behind[ ._-]the[ ._-]scenes|making[ ._-]of)$/i.exec(stem);
      r = fan && fan.kind === 'movie' ? fan : parseMovie(stem);
      if (extra && r) {
        const w = extra[1].toLowerCase().replace(/[ ._-]+/g, '');
        r.kind = 'extra';
        r.extra = w.startsWith('deleted') ? 'deleted' : w === 'behindthescenes' || w === 'makingof' ? 'behindthescenes' : w;
        if (r.title) r.title = cleanTitle(r.title.replace(new RegExp(`[ ._-]*${extra[1].replace(/[.]/g, '\\.')}$`, 'i'), ''));
      }
      if (!r) r = { kind: 'unknown', confidence: 0.1 };
    }
  }
  // Folder context, nearest folder first: Season / Specials folder then the show folder; Disc folder then album then
  // artist; Disc then book then (series and) author. A movie with a generic or year-less name borrows the folder's
  // title/year only when titles agree (or the file title is meaningless), so a folder of mixed movies cannot rename files.
  // folder context
  if (r.kind === 'episode' || ((h === 'series' || h === 'anime') && r.kind !== 'extra')) {
    let i = 0;
    const sm = near[0] && SEASON_DIR.exec(near[0].trim());
    if (sm) { if (r.season == null) r.season = +(sm[1] ?? sm[2]); delete r.absolute; i = 1; }
    else if (near[0] && SPECIALS_DIR.test(near[0].trim())) { if (r.season == null) r.season = 0; r.special = true; delete r.absolute; i = 1; }
    if (near[i] && !r.show) {
      const st = showTitle(near[i]);
      r.show = st.show;
      if (st.year != null && r.year == null) r.year = st.year;
      if (r.kind === 'movie') { r.kind = 'episode'; if (r.title === r.show) delete r.title; }
      r.confidence = Math.min(1, (r.confidence || 0.3) + 0.1);
    }
    if (r.kind === 'unknown' && r.episode != null) r.kind = 'episode';
  } else if (r.kind === 'movie' && near[0]) {
    const generic = !r.title || /^(movie|film|video|main|feature|[a-z]{1,3}\d*)$/i.test(r.title);
    if (generic || r.year == null) {
      const p = parseMovie(near[0]);
      if (p && p.year != null && (generic || normTitle(p.title) === normTitle(r.title))) { r.title = p.title; r.year = p.year; r.confidence = Math.max(r.confidence || 0, 0.8); }
      else if (generic && p) r.title = p.title;
    }
  } else if (r.kind === 'track' && near.length) {
    let i = 0;
    const dm = DISC_DIR.exec(near[0].trim());
    if (dm) { if (r.disc == null) r.disc = +dm[1]; i = 1; }
    if (near[i]) {
      const a = albumDir(near[i]);
      if (r.album == null) r.album = a.album;
      if (r.year == null && a.year != null) r.year = a.year;
      if (r.artist == null && a.artist) r.artist = a.artist;
      if (r.artist == null && near[i + 1]) r.artist = cleanTitle(near[i + 1]);
    }
    r.confidence = Math.min(1, (r.confidence || 0.3) + 0.1);
  } else if (r.kind === 'chapter' && near.length) {
    let i = 0;
    const dm = DISC_DIR.exec(near[0].trim());
    if (dm) { if (r.disc == null) r.disc = +dm[1]; i = 1; }
    if (near[i]) {
      const b = bookDir(near[i]);
      if (r.album == null) r.album = b.album;
      if (b.series && r.series == null) { r.series = b.series; r.seriesPart = b.seriesPart; }
      if (b.author && r.author == null) r.author = b.author;
      if (r.author == null && near[i + 1]) {
        const up = bookDir(near[i + 1]);
        if (!b.series && /\S/.test(near[i + 1]) && near[i + 2] && !up.author) { r.series = up.album; r.author = cleanTitle(near[i + 2]); }
        else r.author = cleanTitle(near[i + 1]);
      }
    }
    r.confidence = Math.min(1, (r.confidence || 0.3) + 0.1);
  }
  if (ext) r.ext = ext;
  return tidy(r);
}
