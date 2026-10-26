// mediajobs/ffprobe.js - media information through ffprobe: the job that asks for it and the reader of its JSON.
//
//   probeJob(input) -> job spec: one ffprobe step
//                      -v error -print_format json -show_format -show_streams -show_chapters <input>
//                      (capture 'json', parse 'ffprobe'; an input starting with '-' is passed as -i <input>)
//   parseProbe(json | text) -> MediaInfo | null (null for text that is not ffprobe JSON)
//   MediaInfo (the shape the tag reader library uses too; missing tags are omitted):
//     { container, kind: 'audio'|'video'|null, mime, duration, bitrate (kbps),
//       audio: { codec, sampleRate, channels, bitsPerSample } | null, video: { codec, width, height, fps } | null,
//       streams: [{ index, type: 'audio'|'video'|'subtitle'|'attachment'|'data', codec, lang, title, default, forced,
//                   channels?, width?, height?, picture? }],
//       tags: { title, artist, artists: [], album, albumArtist, track, trackTotal, disc, discTotal, year, date,
//               genre: [], composer, lyricist, conductor, comment, description, lyrics, compilation, bpm, key, isrc, label,
//               catalog, language, grouping, mood, show, season, episode, episodeId, network, narrator, author, series,
//               seriesPart, publisher, copyright, encoder, mediaKind, originalYear, mb: { trackId, recordingId, albumId, … } },
//       replaygain: { trackGain, trackPeak, albumGain, albumPeak } | null, syncedLyrics: null,
//       chapters: [{ start, end, title }], cover: null, pictures: n, warnings: [] }
//   An attached picture (disposition.attached_pic, or a single-picture mjpeg / png stream in an audio container) is
//   not the video of an audio file: kind stays 'audio' and it counts in pictures.
//   The vocabulary is the tag reader's (mediatags/read.js, fields.js): container mp3, mp4 (m4a / m4b / m4v / 3gp too),
//   mov (QuickTime brand), mkv (mka too), webm, ogg, flac, wav, aiff, aac, asf, avi, ts, mpeg, flv, ape, wv, ac3, … (ffprobe's
//   format name otherwise); images (image2 / *_pipe) are kind null with image: { width, height }.

import { Args, argPath, baseName, extOf, makeJob } from './job.js';

// -v error: only real errors on stderr, so the captured stdout is pure JSON. A name starting with '-' goes behind
// -i, which ffprobe always reads as an input path (the generic './' prefix of argPath would also work but changes
// the displayed name).
export function probeJob(input) {
  if (input == null || input === '') throw new Error('probeJob: input is required');
  const a = new Args().add('-v', 'error').add('-print_format', 'json').add('-show_format', '-show_streams', '-show_chapters');
  if (/^-/.test(String(input))) a.add('-i', input); else a.add(argPath(input));
  return makeJob('ffprobe', `Read the media information of ${baseName(input)}`, [a.step({ tool: 'ffprobe', comment: 'Streams, format, tags and chapters as JSON', capture: 'json', parse: 'ffprobe' })], []);
}

// Heuristics to tell a cover picture from real video: in audio containers a single-frame image codec stream is a
// picture even when the muxer did not set disposition.attached_pic (older taggers, some FLAC/OGG files).
const AUDIO_CONTAINERS = new Set(['mp3', 'flac', 'ogg', 'wav', 'aiff', 'ape', 'wv', 'm4a', 'm4b', 'mka', 'wma', 'aac', 'opus']);
const PICTURE_CODECS = new Set(['mjpeg', 'png', 'bmp', 'gif', 'webp', 'tiff']);

// [audio-only, with video] media types per container (the tag reader's choices).
const MIME = {
  mp3: ['audio/mpeg'], mp4: ['audio/mp4', 'video/mp4'], mov: ['video/quicktime', 'video/quicktime'], mkv: ['audio/x-matroska', 'video/x-matroska'],
  webm: ['audio/webm', 'video/webm'], ogg: ['audio/ogg', 'video/ogg'], flac: ['audio/flac'], wav: ['audio/wav'], aiff: ['audio/aiff'], aac: ['audio/aac'],
  asf: ['audio/x-ms-wma', 'video/x-ms-asf'], avi: ['video/x-msvideo', 'video/x-msvideo'], ts: ['video/mp2t', 'video/mp2t'], mpeg: ['audio/mpeg', 'video/mpeg'],
  flv: ['video/x-flv', 'video/x-flv'], ape: ['audio/x-ape'], wv: ['audio/x-wavpack'], ac3: ['audio/ac3'], amr: ['audio/amr'], caf: ['audio/x-caf'],
  jpeg: ['image/jpeg'], png: ['image/png'], webp: ['image/webp'], gif: ['image/gif'], bmp: ['image/bmp'],
};

const numOrNull = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const intOrNull = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const disp = (s, k) => !!(s?.disposition && (s.disposition[k] === 1 || s.disposition[k] === true));

// ffprobe frame rates are rationals ("30000/1001"); "0/0" means unknown and maps to null. Rounded to 3 decimals
// (29.97) for display.
function rate(r) {
  const m = /^(\d+)(?:\/(\d+))?$/.exec(String(r || ''));
  if (!m) return null;
  const d = m[2] ? +m[2] : 1;
  if (!d || !+m[1]) return null;
  return Math.round((+m[1] / d) * 1000) / 1000;
}

// Container names as the tag reader (mediatags/read.js) gives them: one name per container format, not per extension.
// ffprobe reports demuxer families ("mov,mp4,m4a,3gp,3g2,mj2", "matroska,webm"), not the actual file type. The
// MP4 major brand distinguishes QuickTime ('qt  ') from ISO MP4; Matroska vs WebM is only knowable from the
// extension here (the DocType is not in ffprobe's format section).
function containerOf(format, kind, firstAudio, firstVideo) {
  const names = String(format.format_name || '').toLowerCase().split(',');
  const ext = extOf(format.filename || '');
  const brand = String(format.tags?.major_brand || format.tags?.MAJOR_BRAND || '').trim().toLowerCase();
  if (names.includes('mov') || names.includes('mp4')) return brand === 'qt' || (!brand && ext === 'mov') ? 'mov' : 'mp4';
  if (names.includes('matroska') || names.includes('webm')) return ext === 'webm' ? 'webm' : 'mkv';
  if (names.includes('asf')) return 'asf';
  if (names.includes('ogg')) return 'ogg';
  if (names.includes('mpegts')) return 'ts';
  if (names.includes('image2') || names.some((n) => n.endsWith('_pipe'))) {
    const c = (firstVideo || {}).codec_name || names[0].replace(/_pipe$/, '');
    return c === 'mjpeg' ? 'jpeg' : c;
  }
  const map = { mp3: 'mp3', flac: 'flac', wav: 'wav', aiff: 'aiff', aac: 'aac', avi: 'avi', mpeg: 'mpeg', flv: 'flv', ape: 'ape', wv: 'wv', ac3: 'ac3', amr: 'amr', caf: 'caf', w64: 'w64', dsf: 'dsf', tta: 'tta' };
  for (const n of names) if (map[n]) return map[n];
  return names[0] || ext || null;
}

// lowercase tag key -> MediaInfo key
// One normalized vocabulary over three tagging systems as ffprobe exposes them: ID3v2 frame ids (tit2, tpe1, ...)
// when ffmpeg has no generic name, Vorbis comment names (tracknumber, albumartist), and MP4/ffmpeg generic keys
// (album_artist, episode_sort). Keys are lowercased before lookup; first value wins (??=).
const ALIASES = {
  title: 'title', tit2: 'title',
  artist: 'artist', tpe1: 'artist', author: 'author',
  artists: 'artists',
  album: 'album', talb: 'album',
  album_artist: 'albumArtist', albumartist: 'albumArtist', 'album artist': 'albumArtist', tpe2: 'albumArtist',
  track: 'track', tracknumber: 'track', trck: 'track',
  tracktotal: 'trackTotal', totaltracks: 'trackTotal', track_total: 'trackTotal',
  disc: 'disc', discnumber: 'disc', tpos: 'disc', disk: 'disc',
  disctotal: 'discTotal', totaldiscs: 'discTotal', disc_total: 'discTotal',
  date: 'date', tdrc: 'date', tyer: 'date', year: 'date', originaldate: 'originalYear', originalyear: 'originalYear', tdor: 'originalYear', 'original year': 'originalYear',
  genre: 'genre', tcon: 'genre',
  composer: 'composer', tcom: 'composer',
  comment: 'comment', comm: 'comment',
  description: 'description', desc: 'description', synopsis: 'description',
  lyrics: 'lyrics', unsyncedlyrics: 'lyrics', uslt: 'lyrics',
  compilation: 'compilation', tcmp: 'compilation', cpil: 'compilation',
  bpm: 'bpm', tbpm: 'bpm', tmpo: 'bpm',
  show: 'show', tvsh: 'show',
  season_number: 'season', tvsn: 'season', season: 'season',
  episode_sort: 'episode', tves: 'episode', episode: 'episode',
  episode_id: 'episodeId', tven: 'episodeId',
  network: 'network', tvnn: 'network',
  narrator: 'narrator', narratedby: 'narrator',
  copyright: 'copyright', tcop: 'copyright',
  publisher: 'publisher', tpub: 'publisher', label: 'label', organization: 'label', organisation: 'label', 'record label': 'label',
  catalognumber: 'catalog', catalog: 'catalog', 'catalog number': 'catalog', encoder: 'encoder', key: 'key', initialkey: 'key', tkey: 'key',
  language: 'language', isrc: 'isrc', grouping: 'grouping', tit1: 'grouping', contentgroup: 'grouping', lyricist: 'lyricist', text: 'lyricist',
  conductor: 'conductor', tpe3: 'conductor', mood: 'mood', media_type: 'mediaKind', series: 'series', 'series-part': 'seriesPart', series_part: 'seriesPart',
};
// MusicBrainz ids (Vorbis names and ID3 TXXX descriptions, lowercased) -> tags.mb keys
const MB = {
  musicbrainz_trackid: 'trackId', 'musicbrainz release track id': 'trackId', musicbrainz_releasetrackid: 'trackId',
  'musicbrainz track id': 'recordingId', 'musicbrainz recording id': 'recordingId', musicbrainz_recordingid: 'recordingId',
  musicbrainz_albumid: 'albumId', 'musicbrainz album id': 'albumId', musicbrainz_artistid: 'artistId', 'musicbrainz artist id': 'artistId',
  musicbrainz_albumartistid: 'albumArtistId', 'musicbrainz album artist id': 'albumArtistId',
  musicbrainz_releasegroupid: 'releaseGroupId', 'musicbrainz release group id': 'releaseGroupId',
};

// The tag reader's separators: artists split on NUL, ';' and ' / ' (not 'feat.'), genres on NUL and ';'.
// Multi-value splitting mirrors mediatags so both readers agree: ID3v2.4 uses NUL separators, many taggers use ';'
// or ' / '. "feat." is NOT a separator (it is part of an artist credit). Set() removes duplicates.
const splitBy = (re) => (v) => [...new Set(String(v).split(re).map((x) => x.trim()).filter(Boolean))];
const splitArtists = splitBy(/\u0000|;\s*|\s+\/\s+/);
const splitGenres = splitBy(/\u0000|;/);
const pair = (v) => { const m = /^\s*(\d+)\s*(?:\/\s*(\d+))?/.exec(String(v)); return m ? [+m[1], m[2] ? +m[2] : null] : [null, null]; };
const gain = (v) => { const m = /[-+]?\d+(?:\.\d+)?/.exec(String(v ?? '')); return m ? parseFloat(m[0]) : null; };
const NUMERIC = new Set(['trackTotal', 'discTotal', 'bpm', 'season', 'episode']);

// ReplayGain and Opus R128 keys are collected separately (they become numbers in replaygain, not text tags);
// MusicBrainz ids go to tags.mb. track "3/12" yields track and trackTotal; the year is derived from any date form.
function readTags(raw) {
  const out = {};
  const rg = {};
  const mb = {};
  for (const [k0, v0] of Object.entries(raw)) {
    const k = k0.toLowerCase();
    const v = String(v0);
    if (v === '') continue;
    if (k.startsWith('replaygain_')) { rg[k.slice(11)] = v; continue; }
    if (k.startsWith('r128_')) { rg[k] = v; continue; }
    if (MB[k]) { mb[MB[k]] ??= v.trim(); continue; }
    if (k.startsWith('lyrics-') || k.startsWith('lyrics_') || k.startsWith('uslt')) { out.lyrics ??= v; continue; }
    const key = ALIASES[k];
    if (!key) continue;
    if (key === 'track' || key === 'disc') {
      const [n, total] = pair(v);
      if (n != null) out[key] ??= n;
      if (total != null) out[key + 'Total'] ??= total;
    } else if (NUMERIC.has(key)) {
      const n = parseFloat(v);
      if (Number.isFinite(n)) out[key] ??= n;
    } else if (key === 'originalYear') { const y = /\b(\d{4})\b/.exec(v); if (y) out.originalYear ??= +y[1]; }
    else if (key === 'seriesPart') out.seriesPart ??= /^\d+(\.\d+)?$/.test(v.trim()) ? +v.trim() : v;
    else if (key === 'compilation') out.compilation ??= /^(1|true|yes)$/i.test(v.trim());
    else if (key === 'genre') out.genre ??= splitGenres(v);
    else if (key === 'artists') out.artists ??= splitArtists(v);
    else out[key] ??= v;
  }
  if (out.artist && !out.artists) out.artists = splitArtists(out.artist);
  if (out.artists && !out.artist) out.artist = out.artists.join(', ');
  const y = /\b(\d{4})\b/.exec(out.date || '');
  if (y) out.year = +y[1];
  if (Object.keys(mb).length) out.mb = mb;
  return { tags: out, rg };
}

// Sources in priority order: ReplayGain tags, Opus R128 header tags, then decoder side data (ffprobe reports MP3
// LAME/ID3 ReplayGain as stream side data). ??= keeps the first source that has a value.
function replayGain(rg, streams) {
  const r = { trackGain: gain(rg.track_gain), trackPeak: gain(rg.track_peak), albumGain: gain(rg.album_gain), albumPeak: gain(rg.album_peak) };
  // Opus R128 gains (Q7.8 relative to -23 LUFS) on the ReplayGain reference, as the tag reader does: dB + 5
  const r128 = (v) => (gain(v) == null ? null : Math.round((gain(v) / 256 + 5) * 100) / 100);
  r.trackGain ??= r128(rg.r128_track_gain);
  r.albumGain ??= r128(rg.r128_album_gain);
  for (const s of streams) {
    for (const sd of s.side_data_list || []) {
      if (!/replay\s*gain/i.test(sd.side_data_type || '')) continue;
      r.trackGain ??= gain(sd.track_gain); r.trackPeak ??= gain(sd.track_peak);
      r.albumGain ??= gain(sd.album_gain); r.albumPeak ??= gain(sd.album_peak);
    }
  }
  return Object.values(r).some((v) => v != null) ? r : null;
}

// Accepts the JSON text or an already parsed object; anything that is not ffprobe output returns null (the runner
// turns null into a "no ffprobe result" step error). Selection rule for the main streams: the default-disposition
// stream of each type, else the first; attached pictures never count as the video, so an MP3 with a cover is
// kind 'audio'. Duration falls back to the longest stream when the container has none (raw streams, some TS).
export function parseProbe(input) {
  let j = input;
  if (typeof input === 'string') { try { j = JSON.parse(input); } catch { return null; } }
  if (!j || typeof j !== 'object' || (!j.format && !j.streams)) return null;
  const format = j.format || {};
  const streams = Array.isArray(j.streams) ? j.streams : [];
  const warnings = [];
  const names = String(format.format_name || '').toLowerCase().split(',');
  const image = names.includes('image2') || names.some((n) => n.endsWith('_pipe'));
  const audioish = names.some((n) => AUDIO_CONTAINERS.has(n)) || AUDIO_CONTAINERS.has(extOf(format.filename || ''));
  const isPicture = (s) => s.codec_type === 'video' && (disp(s, 'attached_pic') ||
    (audioish && PICTURE_CODECS.has(s.codec_name) && (intOrNull(s.nb_frames) ?? 1) <= 1 && !(numOrNull(s.duration) > 1)));
  const pick = (list) => list.find((s) => disp(s, 'default')) || list[0] || null;
  const audioS = pick(streams.filter((s) => s.codec_type === 'audio'));
  const videoS = image ? null : pick(streams.filter((s) => s.codec_type === 'video' && !isPicture(s)));
  const kind = videoS ? 'video' : audioS ? 'audio' : null;
  const container = containerOf(format, kind, audioS, streams.find((s) => s.codec_type === 'video'));
  const brand = String(format.tags?.major_brand || '').trim().toUpperCase();
  const mt = MIME[container];
  let mime = mt ? (kind === 'video' && mt[1] ? mt[1] : mt[0]) : null;
  if (container === 'mp4' && kind === 'video' && /^M4V/.test(brand)) mime = 'video/x-m4v';
  let duration = numOrNull(format.duration);
  if (duration == null) {
    const ds = streams.map((s) => numOrNull(s.duration)).filter((d) => d != null);
    duration = ds.length ? Math.max(...ds) : null;
  }
  if (duration == null && !image && kind) warnings.push('duration unknown');
  const br = numOrNull(format.bit_rate);
  const bits = intOrNull(audioS?.bits_per_raw_sample) || intOrNull(audioS?.bits_per_sample) || null;
  const audio = audioS ? { codec: audioS.codec_name || null, sampleRate: intOrNull(audioS.sample_rate), channels: intOrNull(audioS.channels), bitsPerSample: bits } : null;
  const video = videoS ? { codec: videoS.codec_name || null, width: intOrNull(videoS.width), height: intOrNull(videoS.height), fps: rate(videoS.avg_frame_rate) ?? rate(videoS.r_frame_rate) } : null;
  const TYPES = new Set(['audio', 'video', 'subtitle', 'attachment', 'data']);
  const list = streams.map((s, i) => {
    const lang = s.tags?.language || s.tags?.LANGUAGE || null;
    const e = {
      index: Number.isInteger(s.index) ? s.index : i, type: TYPES.has(s.codec_type) ? s.codec_type : 'data', codec: s.codec_name || null,
      lang: lang && lang.toLowerCase() !== 'und' ? lang : null, title: s.tags?.title || s.tags?.TITLE || null,
      default: disp(s, 'default'), forced: disp(s, 'forced'),
    };
    if (s.codec_type === 'audio') e.channels = intOrNull(s.channels);
    if (s.codec_type === 'video') { e.width = intOrNull(s.width); e.height = intOrNull(s.height); if (isPicture(s)) e.picture = true; }
    return e;
  });
  // Tags: the format's; Ogg keeps its Vorbis comments on the audio stream (used when the format has none).
  // MP4 container bookkeeping (brands, creation_time) is not user metadata and is removed before tag mapping.
  const raw = { ...(format.tags || {}) };
  delete raw.major_brand; delete raw.minor_version; delete raw.compatible_brands; delete raw.creation_time;
  if (audioS?.tags && (names.includes('ogg') || !Object.keys(raw).some((k) => ALIASES[k.toLowerCase()]))) {
    for (const [k, v] of Object.entries(audioS.tags)) if (!(k in raw) && !/^(duration|encoder|language|handler_name|vendor_id)$/i.test(k)) raw[k] = v;
  }
  const { tags, rg } = readTags(raw);
  const chapters = (Array.isArray(j.chapters) ? j.chapters : []).map((c) => ({
    start: numOrNull(c.start_time) ?? 0, end: numOrNull(c.end_time) ?? numOrNull(c.start_time) ?? 0, title: c.tags?.title || c.tags?.TITLE || '',
  }));
  if (!streams.length) warnings.push('no streams');
  return {
    container, kind, mime, duration, bitrate: br != null ? Math.round(br / 1000) : null, audio, video, streams: list,
    tags, replaygain: replayGain(rg, streams), syncedLyrics: null, chapters, cover: null,
    pictures: streams.filter(isPicture).length, warnings,
    ...(image && streams[0] ? { image: { width: intOrNull(streams[0].width), height: intOrNull(streams[0].height) } } : {}),
  };
}
