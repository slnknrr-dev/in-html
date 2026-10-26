// mediatags/sidecar.js - files that belong to a media file or to its folder: subtitles, lyrics, NFO, CUE, covers and
// artwork, by the naming conventions of Kodi, Jellyfin, Plex and music players.
//
//   groupSidecars(paths) -> { media: Map(mediaPath -> { cover, lyrics, subs: [{ path, lang, forced, sdh, default,
//       title }], nfo, cue, art: { poster, fanart, banner, logo, clearart, landscape, thumb, disc, ... } }),
//       folders: Map(dirPath -> { cover, fanart, banner, logo, clearart, nfo: { tvshow, album, artist, movie, season,
//       release }, cue: [paths], posters: { [season]: path } (0 = specials, 'all'), extras: [image paths] }) }
//     paths are relative, with '/' (backslashes are normalized); matching is case-insensitive.
//     Same stem: Movie.mkv + Movie.srt / Movie.en.srt / Movie.en.forced.srt / Movie.eng.sdh.srt / Movie.lrc /
//     Movie.nfo / Movie.cue / Movie.jpg / Movie-poster.jpg (the longest matching media stem wins; '-fanart',
//     '-banner', '-logo', '-clearlogo', '-clearart', '-landscape', '-thumb', '-disc' go to `art`). Subtitles in Subs/
//     or Subtitles/ next to a video (also Subs/<stem>/*.srt) and subtitles with another stem in a folder with a single
//     video belong to that video. Folder images: cover.*, folder.*, front.*, poster.*, album.*, albumart*.* (cover,
//     in COVER_NAMES order), fanart.* / backdrop.* / background.*, banner.*, logo.* / clearlogo.*, clearart.*,
//     season01-poster.*, season-specials-poster.*, season-all-poster.*; tvshow.nfo, album.nfo, artist.nfo, movie.nfo,
//     season.nfo (another lone .nfo: release). A folder without a cover takes the cover of its Scans/, Covers/ or
//     Artwork/ subfolder.
//   COVER_NAMES                       folder cover names in priority order
//   isCoverName(name) -> boolean      an image named like a folder cover
//   langCode(s) -> two-letter ISO 639-1 code ('en', 'eng', 'English', 'en-US', 'pt_BR', 'jpn', 'japanese', 'русский'
//                  -> 'en' / 'pt' / 'ja' / 'ru') or null; three-letter codes without a two-letter one stay as given
//   subInfo(tokens) -> { lang, forced, sdh, default, title } of the name parts after the stem

import { EXT } from './detect.js';

// Data table: one row per language. The lookup map below is built once at import; first writer wins, so an
// ambiguous token keeps the mapping of the earlier (more common) language.
// [ISO 639-1, ISO 639-2/T, ISO 639-2/B, names...]
const LANGS = [
  ['en', 'eng', '', 'english'], ['ja', 'jpn', '', 'japanese', 'jap', 'jp', '日本語'], ['ru', 'rus', '', 'russian', 'русский'],
  ['uk', 'ukr', '', 'ukrainian', 'українська'], ['de', 'deu', 'ger', 'german', 'deutsch'], ['fr', 'fra', 'fre', 'french', 'français', 'francais'],
  ['es', 'spa', '', 'spanish', 'español', 'espanol', 'castellano', 'esp'], ['it', 'ita', '', 'italian', 'italiano'], ['pt', 'por', '', 'portuguese', 'português', 'portugues'],
  ['zh', 'zho', 'chi', 'chinese', '中文', 'chs', 'cht', 'mandarin', 'cantonese'], ['ko', 'kor', '', 'korean', '한국어'], ['ar', 'ara', '', 'arabic'],
  ['he', 'heb', '', 'hebrew'], ['hi', 'hin', '', 'hindi'], ['th', 'tha', '', 'thai'], ['vi', 'vie', '', 'vietnamese'], ['id', 'ind', '', 'indonesian'],
  ['ms', 'msa', 'may', 'malay'], ['tr', 'tur', '', 'turkish'], ['pl', 'pol', '', 'polish', 'polski'], ['nl', 'nld', 'dut', 'dutch', 'nederlands', 'flemish'],
  ['sv', 'swe', '', 'swedish', 'svenska'], ['no', 'nor', '', 'norwegian', 'norsk'], ['nb', 'nob', '', 'bokmal', 'bokmål'], ['nn', 'nno', '', 'nynorsk'],
  ['da', 'dan', '', 'danish', 'dansk'], ['fi', 'fin', '', 'finnish', 'suomi'], ['is', 'isl', 'ice', 'icelandic'], ['cs', 'ces', 'cze', 'czech', 'čeština'],
  ['sk', 'slk', 'slo', 'slovak'], ['sl', 'slv', '', 'slovenian', 'slovene'], ['hu', 'hun', '', 'hungarian', 'magyar'], ['ro', 'ron', 'rum', 'romanian'],
  ['bg', 'bul', '', 'bulgarian'], ['hr', 'hrv', '', 'croatian'], ['sr', 'srp', '', 'serbian'], ['bs', 'bos', '', 'bosnian'], ['mk', 'mkd', 'mac', 'macedonian'],
  ['el', 'ell', 'gre', 'greek'], ['et', 'est', '', 'estonian'], ['lv', 'lav', '', 'latvian'], ['lt', 'lit', '', 'lithuanian'], ['be', 'bel', '', 'belarusian'],
  ['kk', 'kaz', '', 'kazakh'], ['uz', 'uzb', '', 'uzbek'], ['az', 'aze', '', 'azerbaijani'], ['hy', 'hye', 'arm', 'armenian'], ['ka', 'kat', 'geo', 'georgian'],
  ['fa', 'fas', 'per', 'persian', 'farsi'], ['ur', 'urd', '', 'urdu'], ['bn', 'ben', '', 'bengali'], ['ta', 'tam', '', 'tamil'], ['te', 'tel', '', 'telugu'],
  ['ml', 'mal', '', 'malayalam'], ['kn', 'kan', '', 'kannada'], ['mr', 'mar', '', 'marathi'], ['pa', 'pan', '', 'punjabi'], ['gu', 'guj', '', 'gujarati'],
  ['ca', 'cat', '', 'catalan'], ['eu', 'eus', 'baq', 'basque'], ['gl', 'glg', '', 'galician'], ['cy', 'cym', 'wel', 'welsh'], ['ga', 'gle', '', 'irish'],
  ['sq', 'sqi', 'alb', 'albanian'], ['tl', 'tgl', '', 'tagalog', 'filipino', 'fil'], ['sw', 'swa', '', 'swahili'], ['af', 'afr', '', 'afrikaans'],
  ['la', 'lat', '', 'latin'], ['mn', 'mon', '', 'mongolian'], ['km', 'khm', '', 'khmer'], ['lo', 'lao', '', 'lao'], ['my', 'mya', 'bur', 'burmese'],
  ['ne', 'nep', '', 'nepali'], ['si', 'sin', '', 'sinhala'], ['am', 'amh', '', 'amharic'], ['eo', 'epo', '', 'esperanto'],
];
const LANG = new Map();
for (const [two, t, b, ...names] of LANGS) {
  for (const k of [two, t, b, ...names]) if (k && !LANG.has(k)) LANG.set(k, two);
}
// Codes that are also common words in release names are only accepted as full tokens by langCode itself.
// Exact token, else a regioned tag ('en-US', 'pt_BR') reduced to its primary subtag. No fuzzy matching: release
// names are full of short words, and a false language is worse than none.
export function langCode(s) {
  const t = String(s || '').trim().toLowerCase();
  if (!t) return null;
  if (LANG.has(t)) return LANG.get(t);
  const m = /^([a-z]{2,3})[-_][a-z0-9]{2,4}$/.exec(t);
  if (m && LANG.has(m[1])) return LANG.get(m[1]);
  return null;
}

// Priority order: the explicit 'cover' / 'folder' conventions (players, Windows) before generic names.
export const COVER_NAMES = ['cover', 'folder', 'front', 'poster', 'album', 'albumart', 'albumartlarge', 'albumartsmall', 'thumb', 'default', 'art', 'artwork', 'jacket'];

const IMAGE = new Set(EXT.image.concat(['tbn']));
const SUB = new Set(EXT.subtitle.concat(['idx', 'sup']));
const MEDIA = new Set([...EXT.audio, ...EXT.video]);
const VIDEO = new Set(EXT.video);

// Path -> parts. 'd > 0' keeps dotfiles ('.nfo' alone) as a stem with no extension.
function split(path) {
  const p = String(path).replace(/\\/g, '/').replace(/^\.\/+/, '');
  const i = p.lastIndexOf('/');
  const dir = i >= 0 ? p.slice(0, i) : '';
  const name = i >= 0 ? p.slice(i + 1) : p;
  const d = name.lastIndexOf('.');
  return { path: p, dir, name, stem: d > 0 ? name.slice(0, d) : name, ext: d > 0 ? name.slice(d + 1).toLowerCase() : '' };
}

// Lower is better; -1 means not a cover. AlbumArt*Large / *Small (Windows Media Player) fold into albumart ranks,
// Large half a step ahead of plain so the larger image wins.
function coverRank(stem) {
  const s = stem.toLowerCase();
  if (/^albumart/.test(s)) return COVER_NAMES.indexOf(/small$/.test(s) ? 'albumartsmall' : 'albumart') + (/large$/.test(s) ? -0.5 : 0);
  return COVER_NAMES.indexOf(s);
}

export function isCoverName(name) {
  const f = split(name);
  return IMAGE.has(f.ext) && coverRank(f.stem) >= 0;
}

// 'hi' is both Hindi and hearing-impaired: treated as SDH only when another language token is present
// ('Movie.en.hi.srt'), otherwise as Hindi. Numeric tokens (track indexes) are ignored; leftovers form the title.
/** Subtitle name parts -> { lang, forced, sdh, default, title }. */
export function subInfo(tokens) {
  const out = { lang: null, forced: false, sdh: false, default: false, title: null };
  const words = [];
  const toks = tokens.map((t) => t.toLowerCase()).filter(Boolean);
  const hasOtherLang = toks.some((t) => t !== 'hi' && langCode(t));
  for (const t of toks) {
    if (t === 'forced' || t === 'foreign') out.forced = true;
    else if (t === 'sdh' || t === 'cc' || (t === 'hi' && hasOtherLang)) out.sdh = true;
    else if (t === 'default') out.default = true;
    else if (!out.lang && langCode(t)) out.lang = langCode(t);
    else if (/^\d+$/.test(t)) continue;
    else words.push(t);
  }
  if (words.length) out.title = words.join(' ');
  return out;
}

const tokensOf = (s) => s.split(/[._\s-]+/).filter(Boolean);
const ART = { poster: 'poster', cover: 'poster', folder: 'poster', fanart: 'fanart', backdrop: 'fanart', banner: 'banner', logo: 'logo', clearlogo: 'logo',
  clearart: 'clearart', landscape: 'landscape', thumb: 'thumb', disc: 'disc', discart: 'disc', cdart: 'disc', keyart: 'keyart' };

// Strategy: bucket by directory, then resolve per directory: media files first, sidecars matched by the LONGEST
// media stem that prefixes them (so 'Movie.Part2.srt' binds to 'Movie.Part2.mkv', not 'Movie.mkv'). Folder-level
// images and NFOs go to the folder record. Duplicate input paths are removed first (Set).
/** Groups sidecar files with their media files and folders (see the header). */
export function groupSidecars(paths) {
  const files = [...new Set(paths)].map(split).filter((f) => f.name);
  const byDir = new Map();
  for (const f of files) { if (!byDir.has(f.dir)) byDir.set(f.dir, []); byDir.get(f.dir).push(f); }
  const media = new Map(), folders = new Map();
  const folder = (dir) => {
    if (!folders.has(dir)) folders.set(dir, { cover: null, fanart: null, banner: null, logo: null, clearart: null, nfo: {}, cue: [], posters: {}, extras: [] });
    return folders.get(dir);
  };
  const coverOf = new Map(); // dir -> rank of the chosen cover
  const subsDir = /^(subs|subtitles|sub)$/i;
  const addSub = (m, f, tokens) => media.get(m.path).subs.push({ path: f.path, ...subInfo(tokens) });
  for (const [dir, list] of byDir) {
    const fo = folder(dir);
    const mediaFiles = list.filter((f) => MEDIA.has(f.ext));
    for (const m of mediaFiles) media.set(m.path, { cover: null, lyrics: null, subs: [], nfo: null, cue: null, art: {} });
    const stems = [...mediaFiles].sort((a, b) => b.stem.length - a.stem.length);
    const videos = mediaFiles.filter((f) => VIDEO.has(f.ext));
    const coverRanks = new Map();
    for (const f of list) {
      if (MEDIA.has(f.ext)) continue;
      const low = f.stem.toLowerCase();
      const owner = stems.find((m) => {
        const s = m.stem.toLowerCase();
        return low === s || (low.startsWith(s) && /^[.\-_ ]/.test(low.slice(s.length)));
      });
      if (owner) {
        const e = media.get(owner.path);
        const suffix = f.stem.slice(owner.stem.length);
        const toks = tokensOf(suffix);
        if (SUB.has(f.ext)) { addSub(owner, f, toks); continue; }
        if (f.ext === 'lrc') { if (!e.lyrics) e.lyrics = f.path; continue; }
        if (f.ext === 'nfo') { if (!e.nfo || !toks.length) e.nfo = f.path; continue; }
        if (f.ext === 'cue') { if (!e.cue) e.cue = f.path; continue; }
        if (IMAGE.has(f.ext)) {
          const kind = toks.length ? ART[toks[toks.length - 1].toLowerCase()] : 'self';
          if (kind === 'self' || kind === 'poster') {
            const rank = kind === 'self' ? 0 : 1;
            if (!e.cover || rank < coverRanks.get(owner.path)) { e.cover = f.path; coverRanks.set(owner.path, rank); }
            if (kind === 'poster' && !e.art.poster) e.art.poster = f.path;
          } else if (kind) { if (!e.art[kind]) e.art[kind] = f.path; } else fo.extras.push(f.path);
          continue;
        }
      }
      // folder level
      if (SUB.has(f.ext) && videos.length === 1) { addSub(videos[0], f, tokensOf(f.stem)); continue; }
      if (f.ext === 'nfo') {
        const k = low.replace(/[^a-z]/g, '');
        if (['tvshow', 'album', 'artist', 'movie', 'season'].includes(k)) fo.nfo[k] = f.path;
        else if (!fo.nfo.release) fo.nfo.release = f.path;
        continue;
      }
      if (f.ext === 'cue') { fo.cue.push(f.path); continue; }
      if (IMAGE.has(f.ext)) {
        let m;
        const rank = coverRank(f.stem);
        if (rank >= 0) {
          if (!fo.cover || rank < coverOf.get(dir)) { if (fo.cover) fo.extras.push(fo.cover); fo.cover = f.path; coverOf.set(dir, rank); }
          else fo.extras.push(f.path);
        } else if (/^(fanart|backdrop|background)\d*$/.test(low)) { if (!fo.fanart) fo.fanart = f.path; else fo.extras.push(f.path); }
        else if (low === 'banner') fo.banner = f.path;
        else if (low === 'logo' || low === 'clearlogo') { if (!fo.logo) fo.logo = f.path; }
        else if (low === 'clearart') fo.clearart = f.path;
        else if ((m = /^season[ ._-]?(\d{1,3})[ ._-]?poster$/.exec(low))) fo.posters[+m[1]] = f.path;
        else if (/^season[ ._-]?specials?[ ._-]?poster$/.test(low)) fo.posters[0] = f.path;
        else if (/^season[ ._-]?all[ ._-]?poster$/.test(low)) fo.posters.all = f.path;
        else fo.extras.push(f.path);
      }
    }
  }
  // Subs/ and Subtitles/ folders next to videos; scans / covers folders
  for (const [dir, list] of byDir) {
    const parts = dir.split('/');
    const last = parts[parts.length - 1];
    const isSubs = subsDir.test(last), isNested = parts.length >= 2 && subsDir.test(parts[parts.length - 2]);
    if (isSubs || isNested) {
      const parent = parts.slice(0, isSubs ? -1 : -2).join('/');
      const vids = (byDir.get(parent) || []).filter((f) => VIDEO.has(f.ext));
      for (const f of list) {
        if (!SUB.has(f.ext)) continue;
        let v = null, toks = tokensOf(f.stem);
        if (isNested) v = vids.find((x) => x.stem.toLowerCase() === last.toLowerCase());
        if (!v) {
          const low = f.stem.toLowerCase();
          v = [...vids].sort((a, b) => b.stem.length - a.stem.length).find((x) => low.startsWith(x.stem.toLowerCase()));
          if (v) toks = tokensOf(f.stem.slice(v.stem.length));
        }
        if (!v && vids.length === 1) v = vids[0];
        if (v) addSub(v, f, toks);
      }
    }
    if (/^(scans|covers?|artwork|art|images)$/i.test(last) && parts.length >= 1) {
      const parent = parts.slice(0, -1).join('/');
      const pf = folders.get(parent);
      const own = folders.get(dir);
      let pick = own?.cover;
      if (!pick) pick = list.find((f) => IMAGE.has(f.ext) && /front|cover/i.test(f.stem))?.path || null;
      if (pf && !pf.cover && pick) pf.cover = pick;
    }
  }
  return { media, folders };
}
