// mediatags/fields.js - one tag vocabulary for every container: format readers turn their tags into [KEY, value] pairs
// named like Vorbis comments (TITLE, ARTIST, TRACKNUMBER, REPLAYGAIN_TRACK_GAIN, MUSICBRAINZ_ALBUMID, ...), and
// normalizeTags() turns the pairs into MediaInfo.tags.
//
//   normalizeTags(pairs) -> { tags, replaygain | null, syncedLyrics | null, chapters: [{ start, end: null, title }] }
//     tags: title, artist (display: the single value as written, several values joined with ', '), artists [] (split
//       on NUL, ' / ', '; ' and ' feat. ' is NOT split), album, albumArtist, track, trackTotal, disc, discTotal
//       ('3/12' split), year, date, originalYear, genre [] (split on NUL and ';'), composer, lyricist, conductor,
//       comment, description, lyrics, compilation (boolean), bpm, key, isrc, label, catalog, language, grouping, mood,
//       show, season, episode, episodeTitle, network, narrator, author, series, seriesPart (number when numeric),
//       publisher, copyright, encoder, mediaKind, mb: { trackId, recordingId, albumId, artistId, albumArtistId,
//       releaseGroupId }. Absent values are omitted; numbers are numbers.
//     replaygain: { trackGain, trackPeak, albumGain, albumPeak } (dB / linear; '-6.20 dB' strings parsed; Opus
//       R128_*_GAIN (Q7.8, -23 LUFS) converted to the ReplayGain reference: dB + 5)
//     syncedLyrics: LRC text from a '_SYNCEDLYRICS' pair (ID3 SYLT) or a lyrics value that is LRC (tags.lyrics then
//       holds its plain text)
//     chapters: from CHAPTERnnn / CHAPTERnnnNAME comments, else from an embedded CUESHEET comment
//   vocabKey(name) -> the vocabulary key of a field name (aliases: ALBUM ARTIST, YEAR, TRACK, TOTALTRACKS, ...)
//   parseGain('-6.20 dB') -> -6.2           splitValues(list, seps) -> trimmed, de-duplicated values
//   chapterTime('00:01:02.500') -> 62.5

//
// Why Vorbis-comment names as the pivot: they are free-form uppercase keys with an established community vocabulary
// (MusicBrainz Picard / foobar2000 mappings), so ID3 frames, MP4 atoms, APE and Matroska tags can all be mapped onto
// them losslessly by the format readers, and this file stays the ONE place that knows the output shape. The
// alternative (each reader building MediaInfo.tags itself) duplicates the splitting / number / ReplayGain rules and
// lets formats disagree.
// Pairs, not an object: a key may repeat (several ARTIST comments are legal and meaningful), and the first occurrence
// wins for single-valued fields, which preserves the reader's priority order.
// Keys starting with '_' are internal (produced by readers from binary frames: _SYNCEDLYRICS, _MEDIAKIND, _RVA2_*),
// never standard comment names. A text comment literally named _MEDIAKIND would be honoured too; harmless.
import { cueTracks, parseCue } from './cue.js';
import { isLrc, parseLrc, plainLyrics } from './lrc.js';

// Aliases -> vocabulary keys (keys compared uppercased, '-' and spaces as written).
const ALIAS = {
  'ALBUM ARTIST': 'ALBUMARTIST', ALBUM_ARTIST: 'ALBUMARTIST', 'ALBUM-ARTIST': 'ALBUMARTIST',
  YEAR: 'DATE', TRACK: 'TRACKNUMBER', DISC: 'DISCNUMBER', DISK: 'DISCNUMBER', TOTALTRACKS: 'TRACKTOTAL', TOTALDISCS: 'DISCTOTAL',
  UNSYNCEDLYRICS: 'LYRICS', 'UNSYNCED LYRICS': 'LYRICS', LYRICS_UNSYNCED: 'LYRICS',
  ORGANIZATION: 'LABEL', ORGANISATION: 'LABEL', 'RECORD LABEL': 'LABEL', CATALOG: 'CATALOGNUMBER', 'CATALOG NUMBER': 'CATALOGNUMBER',
  INITIALKEY: 'KEY', 'INITIAL KEY': 'KEY', TEMPO: 'BPM', CONTENTGROUP: 'GROUPING', ORIGINALYEAR: 'ORIGINALDATE', 'ORIGINAL YEAR': 'ORIGINALDATE',
  TVSHOW: 'SHOW', TVSHOWNAME: 'SHOW', TVSEASON: 'SEASON', TVEPISODE: 'EPISODE', TVNETWORK: 'NETWORK', 'SERIES PART': 'SERIES-PART',
  SERIESPART: 'SERIES-PART', SERIES_PART: 'SERIES-PART', 'SERIES-NUMBER': 'SERIES-PART',
  'MUSICBRAINZ ALBUM ID': 'MUSICBRAINZ_ALBUMID', 'MUSICBRAINZ ARTIST ID': 'MUSICBRAINZ_ARTISTID',
  'MUSICBRAINZ ALBUM ARTIST ID': 'MUSICBRAINZ_ALBUMARTISTID', 'MUSICBRAINZ RELEASE GROUP ID': 'MUSICBRAINZ_RELEASEGROUPID',
  'MUSICBRAINZ RELEASE TRACK ID': 'MUSICBRAINZ_RELEASETRACKID', 'MUSICBRAINZ TRACK ID': 'MUSICBRAINZ_TRACKID',
  'MUSICBRAINZ RECORDING ID': 'MUSICBRAINZ_TRACKID', MUSICBRAINZ_RECORDINGID: 'MUSICBRAINZ_TRACKID',
  MUSICBRAINZ_ALBUMARTISTID: 'MUSICBRAINZ_ALBUMARTISTID', MUSICBRAINZ_RELEASE_GROUP_ID: 'MUSICBRAINZ_RELEASEGROUPID',
  SYNOPSIS: 'DESCRIPTION', SUMMARY: 'DESCRIPTION',
};

// Unknown names pass through uppercased: readers can emit keys that have no alias and they still land in the map.
export function vocabKey(name) {
  const k = String(name || '').trim().toUpperCase();
  return ALIAS[k] || k;
}

// Leading number only: tolerates ' dB', 'dB', trailing junk; a decimal comma (written by some EU-locale taggers) is
// accepted. Returns null, not NaN, so callers can test with == null.
export function parseGain(v) {
  const m = /^\s*([+-]?\d+(?:[.,]\d+)?)/.exec(String(v ?? ''));
  return m ? Number(m[1].replace(',', '.')) : null;
}

// Default separators: NUL (ID3v2.4 multi-value), ';' and ' / ' with surrounding spaces. A bare '/' is NOT a separator:
// it would split 'AC/DC' and '3/12'. ' feat. ' is deliberately not split either: 'A feat. B' is one credited artist
// string, and splitting it would invent an artist entry 'B' that the tagger never wrote. Dedup is O(n^2) via
// includes(), fine for the handful of values a tag holds.
/** Splits values on the separators, trims, drops empty and repeated ones. */
export function splitValues(list, seps = /\u0000|;\s*|\s+\/\s+/) {
  const out = [];
  for (const v of list) for (const x of String(v).split(seps)) { const t = x.trim(); if (t && !out.includes(t)) out.push(t); }
  return out;
}

// Accepts the Vorbis CHAPTERnnn form (HH:MM:SS.mmm) and plain seconds; anything else is null, so a garbage chapter
// entry is dropped instead of becoming chapter 0.
/** 'HH:MM:SS.mmm' / 'MM:SS' / seconds -> seconds (null when unparsable). */
export function chapterTime(s) {
  const t = String(s || '').trim();
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:[.,]\d+)?)$/.exec(t);
  if (m) return (+(m[1] || 0)) * 3600 + +m[2] * 60 + Number(m[3].replace(',', '.'));
  return /^\d+(?:\.\d+)?$/.test(t) ? Number(t) : null;
}

// Value coercers. num takes the leading integer ('3/12' -> 3, '03' -> 3). year takes the first 4-digit run, so ISO
// dates, '2003-05' and 'May 2003' all work. truthy covers the spellings taggers use for COMPILATION ('1', 'true').
const num = (v) => { const m = /^\s*(\d+)/.exec(String(v ?? '')); return m ? +m[1] : null; };
const numOrText = (v) => (/^\s*\d+(?:\.\d+)?\s*$/.test(String(v)) ? Number(v) : String(v).trim());
const year = (v) => { const m = /(\d{4})/.exec(String(v ?? '')); return m ? +m[1] : null; };
const truthy = (v) => /^\s*(1|true|yes|y)\s*$/i.test(String(v));

// iTunes 'stik' atom values (MP4 media kind). 0 and 9 both mean movie (0 = legacy 'Movie (old)').
const MEDIA_KIND = { 0: 'movie', 1: 'music', 2: 'audiobook', 5: 'bookmark', 6: 'musicvideo', 9: 'movie', 10: 'tvshow', 11: 'booklet', 14: 'ringtone', 21: 'podcast', 23: 'itunesu' };

/** Turns [KEY, value] pairs into MediaInfo tags (see the header). */
export function normalizeTags(pairs) {
  // Group values by vocabulary key, preserving order. Trailing NULs are stripped (ID3 text frames are often
  // NUL-terminated) and blank values dropped, so 'present but empty' never shadows a later real value.
  const m = new Map();
  for (const [k, v] of pairs || []) {
    if (v == null) continue;
    const s = typeof v === 'string' ? v.replace(/\u0000+$/, '') : String(v);
    if (!s.trim()) continue;
    const key = vocabKey(k);
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(s);
  }
  // set() is the single gate: drops null, '' and non-finite numbers, so 'absent values are omitted' holds everywhere.
  const all = (k) => m.get(k) || [];
  const one = (...ks) => { for (const k of ks) { const v = all(k)[0]; if (v != null) return v.trim(); } return null; };
  const tags = {};
  const set = (k, v) => { if (v != null && v !== '' && !(typeof v === 'number' && !Number.isFinite(v))) tags[k] = v; };

  // artist (display string) vs artists (list): the display keeps a single value exactly as written (including any
  // ' / ' or 'feat.'), while the list is split. An explicit ARTISTS tag (Picard) beats splitting ARTIST.
  set('title', one('TITLE'));
  const artistVals = all('ARTIST').map((s) => s.trim()).filter(Boolean);
  const artists = all('ARTISTS').length ? splitValues(all('ARTISTS')) : splitValues(artistVals);
  if (artistVals.length) set('artist', artistVals.length === 1 ? artistVals[0] : splitValues(artistVals).join(', '));
  else if (artists.length) set('artist', artists.join(', '));
  if (artists.length) tags.artists = artists;
  set('album', one('ALBUM'));
  const aa = all('ALBUMARTIST');
  if (aa.length) set('albumArtist', aa.length === 1 ? aa[0].trim() : splitValues(aa).join(', '));

  // 'n/total' (ID3 TRCK, MP4 trkn rendered by readers) is split; an explicit TRACKTOTAL / DISCTOTAL wins over the
  // embedded total because it is set after.
  const tn = one('TRACKNUMBER');
  if (tn) { set('track', num(tn)); const t = /\/\s*(\d+)/.exec(tn); if (t) set('trackTotal', +t[1]); }
  if (one('TRACKTOTAL')) set('trackTotal', num(one('TRACKTOTAL')));
  const dn = one('DISCNUMBER');
  if (dn) { set('disc', num(dn)); const t = /\/\s*(\d+)/.exec(dn); if (t) set('discTotal', +t[1]); }
  if (one('DISCTOTAL')) set('discTotal', num(one('DISCTOTAL')));

  const date = one('DATE');
  if (date) { set('date', date); set('year', year(date)); }
  const od = one('ORIGINALDATE');
  if (od) set('originalYear', year(od));
  // Genre is split on NUL and ';' only, not ' / ': 'Drum / Bass'-style names are not lists.
  const genres = splitValues(all('GENRE'), /\u0000|;\s*/);
  if (genres.length) tags.genre = genres;
  for (const [k, key] of [['composer', 'COMPOSER'], ['lyricist', 'LYRICIST'], ['conductor', 'CONDUCTOR'], ['key', 'KEY'], ['isrc', 'ISRC'],
    ['catalog', 'CATALOGNUMBER'], ['language', 'LANGUAGE'], ['grouping', 'GROUPING'], ['mood', 'MOOD'], ['show', 'SHOW'],
    ['episodeTitle', 'EPISODETITLE'], ['network', 'NETWORK'], ['narrator', 'NARRATOR'], ['author', 'AUTHOR'], ['series', 'SERIES'],
    ['publisher', 'PUBLISHER'], ['copyright', 'COPYRIGHT'], ['encoder', 'ENCODER']]) {
    const v = all(key);
    if (v.length) set(k, v.length === 1 ? v[0].trim() : splitValues(v).join(', '));
  }
  // Label falls back to PUBLISHER (ID3 TPUB serves as the label in most taggers). LONGDESCRIPTION (MP4 ldes) beats
  // DESCRIPTION because the short one is often truncated.
  set('label', one('LABEL', 'PUBLISHER'));
  set('comment', one('COMMENT'));
  set('description', one('LONGDESCRIPTION', 'DESCRIPTION'));
  if (one('COMPILATION') != null) tags.compilation = truthy(one('COMPILATION'));
  const bpm = one('BPM');
  if (bpm != null && Number.isFinite(parseFloat(bpm))) set('bpm', Math.round(parseFloat(bpm) * 100) / 100);
  if (one('SEASON') != null) set('season', num(one('SEASON')));
  if (one('EPISODE') != null) set('episode', num(one('EPISODE')));
  if (one('SERIES-PART') != null) set('seriesPart', numOrText(one('SERIES-PART')));
  // Audiobooks tagged by iTunes-style tools store series in the movement fields (MP4 (c)mvn / (c)mvi); TV shows put the
  // episode name in TITLE. Both are mapped only when the media kind says so, to avoid misreading classical movements.
  const stik = one('_MEDIAKIND');
  if (stik != null && MEDIA_KIND[stik] != null) tags.mediaKind = MEDIA_KIND[stik];
  if (tags.mediaKind === 'audiobook' && !tags.series && one('MOVEMENTNAME')) {
    set('series', one('MOVEMENTNAME'));
    if (one('MOVEMENT') != null && tags.seriesPart == null) set('seriesPart', numOrText(one('MOVEMENT')));
  }
  if (tags.show && !tags.episodeTitle && tags.title && tags.mediaKind === 'tvshow') set('episodeTitle', tags.title);

  // MusicBrainz ids: one UUID per field; a multi-valued field keeps the first. Note the naming trap: Picard's
  // MUSICBRAINZ_TRACKID is the RECORDING id, MUSICBRAINZ_RELEASETRACKID is the track id.
  const mb = {};
  for (const [k, key] of [['trackId', 'MUSICBRAINZ_RELEASETRACKID'], ['recordingId', 'MUSICBRAINZ_TRACKID'], ['albumId', 'MUSICBRAINZ_ALBUMID'],
    ['artistId', 'MUSICBRAINZ_ARTISTID'], ['albumArtistId', 'MUSICBRAINZ_ALBUMARTISTID'], ['releaseGroupId', 'MUSICBRAINZ_RELEASEGROUPID']]) {
    const v = one(key);
    if (v) mb[k] = v.split(/\u0000|;\s*|\s+\/\s+/)[0].trim();
  }
  if (Object.keys(mb).length) tags.mb = mb;

  // Priority: a binary SYLT-derived LRC beats any text; an LRC-shaped LYRICS value is both kept as synced lyrics and
  // flattened into tags.lyrics, so a consumer that only knows plain lyrics never sees timestamps.
  // lyrics
  let syncedLyrics = all('_SYNCEDLYRICS')[0] || null;
  const lyr = all('LYRICS').map((s) => s.replace(/\r\n?/g, '\n')).find((s) => s.trim());
  const synced = one('SYNCEDLYRICS', 'LYRICS_SYNCED');
  if (!syncedLyrics && synced && isLrc(synced)) syncedLyrics = synced;
  if (lyr) {
    if (isLrc(lyr)) {
      if (!syncedLyrics) syncedLyrics = lyr;
      set('lyrics', plainLyrics(parseLrc(lyr)));
    } else set('lyrics', lyr);
  }

  // Priority: REPLAYGAIN_* text > Opus R128_* > ID3 RVA2. R128 gains are Q7.8 fixed point (value/256 dB) relative to
  // -23 LUFS (EBU R128); ReplayGain 2 references -18 LUFS, so +5 dB converts. Rounded to 0.01 dB (the precision
  // ReplayGain strings carry). Missing fields are explicit nulls so the result shape is stable.
  // replay gain
  const rg = {};
  const g = (k) => parseGain(one(k));
  if (g('REPLAYGAIN_TRACK_GAIN') != null) rg.trackGain = g('REPLAYGAIN_TRACK_GAIN');
  if (g('REPLAYGAIN_TRACK_PEAK') != null) rg.trackPeak = g('REPLAYGAIN_TRACK_PEAK');
  if (g('REPLAYGAIN_ALBUM_GAIN') != null) rg.albumGain = g('REPLAYGAIN_ALBUM_GAIN');
  if (g('REPLAYGAIN_ALBUM_PEAK') != null) rg.albumPeak = g('REPLAYGAIN_ALBUM_PEAK');
  if (rg.trackGain == null && g('R128_TRACK_GAIN') != null) rg.trackGain = Math.round((g('R128_TRACK_GAIN') / 256 + 5) * 100) / 100;
  if (rg.albumGain == null && g('R128_ALBUM_GAIN') != null) rg.albumGain = Math.round((g('R128_ALBUM_GAIN') / 256 + 5) * 100) / 100;
  for (const [k, key] of [['trackGain', '_RVA2_TRACK_GAIN'], ['trackPeak', '_RVA2_TRACK_PEAK'], ['albumGain', '_RVA2_ALBUM_GAIN'], ['albumPeak', '_RVA2_ALBUM_PEAK']]) {
    if (rg[k] == null && g(key) != null) rg[k] = g(key);
  }
  const replaygain = Object.keys(rg).length ? { trackGain: null, trackPeak: null, albumGain: null, albumPeak: null, ...rg } : null;

  // CHAPTERnnn keys come from the map (insertion order), then sort by time with the number as tie-break. A CUESHEET is
  // only a fallback: an embedded sheet describes the original disc layout, which is less precise than chapter tags.
  // chapters from comments
  const chapters = [];
  for (const [key, vals] of m) {
    const c = /^CHAPTER(\d{1,4})$/.exec(key);
    if (!c) continue;
    const start = chapterTime(vals[0]);
    if (start == null) continue;
    const name = all(`CHAPTER${c[1]}NAME`)[0];
    chapters.push({ n: +c[1], start, end: null, title: name ? name.trim() : '' });
  }
  chapters.sort((a, b) => a.start - b.start || a.n - b.n);
  const outChapters = chapters.map(({ start, end, title }) => ({ start, end, title }));
  if (!outChapters.length && one('CUESHEET')) {
    try {
      const cue = parseCue(all('CUESHEET')[0]);
      for (const t of cueTracks(cue)) if (t.start != null) outChapters.push({ start: t.start, end: null, title: t.title || `Track ${t.number}` });
    } catch { /* malformed sheet */ }
  }
  return { tags, replaygain, syncedLyrics: syncedLyrics || null, chapters: outChapters };
}
