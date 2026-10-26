// mediajobs/ffmpeg.js - ffmpeg jobs as data (mediajobs/job.js specs): conversions, remuxing, loudness, splitting,
// joining with chapters, tags and covers, frames; plus the parsers the runner needs. Nothing here runs ffmpeg.
//
// Every ffmpeg step starts with  -hide_banner -nostdin -y -progress pipe:1 -nostats :
//   -nostdin -y          never waits for a key or an overwrite question (outputs are replaced)
//   -progress pipe:1     machine-readable key=value progress on stdout (parseProgress); -nostats drops the stats line
//                        from stderr, which then carries only messages (logged by the runner)
//   no -loglevel         ffmpeg's default (info) keeps loudnorm's JSON report on stderr (parseLoudnorm)
// Times (start / end / at) are seconds or 'hh:mm:ss.xxx'; seeking is input seeking (-ss before -i, accurate when
// re-encoding; with stream copy cuts fall on packet boundaries); end becomes an output -t.
//
//   convertAudio({ input, output, format, quality: 'low'|'med'|'high'|'lossless', bitrate, sampleRate, channels,
//                  bits (wav / flac), tags, cover, keepCover, start, end, loudnorm: { I, TP, LRA } | null, measured,
//                  duration })                    loudnorm without measured values is two-pass: a measuring step,
//                                                 then the filter with {var:loudnorm.*} placeholders
//   convertVideo({ input, output, format: 'mp4'|'webm'|'mkv', quality, maxHeight, crf, preset, audio,
//                  subtitles: 'copy'|'burn'|'none', subtitleFile, subtitleStream, start, end, duration })
//   remux({ input, output, streams: 'all'|'av', duration })
//   extractAudio({ input, output, copy = true, format, quality, start, end, duration })
//   loudnessScan({ input, I, TP, LRA, start, end, duration })  one step, parse 'loudnorm'
//   normalize({ input, output, target: { I, TP, LRA }, measured, format, quality, sampleRate, duration })
//   splitTracks({ input, tracks: [{ number, title, artist, start, end, tags }], outDir, pattern, format, copy,
//                 quality, album, albumArtist, artist, year, genre, cover, duration })   one step per track
//   joinChapters({ inputs: [{ path, title, duration }], output (.m4b / .m4a / .mka / .mp3 / .opus), tags, cover,
//                  bitrate, copy })               aux files list.ffconcat + chapters.txt (FFMETADATA1)
//   embedMeta({ input, output, tags, cover, chapters: [{ start, end, title }], duration, existingAttachments })
//   frame({ input, output, at, width, quality })  one picture (virtual covers)
//   waveformImage({ input, output, width, height, color, duration })
//
//   ffmetadata(tags, chapters) -> FFMETADATA1 text (= ; # \ and line breaks escaped with a backslash)
//   concatList(paths) -> ffconcat text ('…' quoting, ' written as '\''; a path with a line break throws)
//   tagPairs(tags) -> [[ffmpeg key, value]]   resolveChapters(chapters, total) -> chapters with every end
//   parseLoudnorm(stderr) -> { input_i, input_tp, input_lra, input_thresh, target_offset, … } | null (numbers,
//                           infinities of silent input clamped to the ranges the second pass accepts)
//   parseProgress(text, state = {}) -> state { outTime (s), speed, frame, fps, totalSize, bitrate, done, rest }
//   progressFraction(state, duration) -> 0..1 | null
//   AUDIO_FORMATS, AUDIO_EXT, FFMPEG_HEAD
//
// Covers: attached-picture streams in mp3, m4a / m4b / mp4 / mov, flac; an attachment in mkv / mka; ffmpeg cannot
// write pictures into Ogg / Opus / WAV / ADTS AAC (the job carries a note). keepCover (default: the input is an audio
// file that can hold a picture: mp3, m4a, flac, ogg, …) copies the picture the input already has (an optional map).

import { f, Graph, raw } from '../ffcmd/graph.js';
import { seconds } from '../ffcmd/escape.js';
import { bitrate as bitrateText, encodeArgs } from '../ffcmd/codecs.js';
import { Args, argPath, baseName, extOf, fileSafe, joinPath, makeJob, parseTime } from './job.js';

// head() splits the common prefix into two groups only for line layout in rendered scripts; -progress pipe:1 and
// -nostats stay together so shell.js stripProgress can drop that group for hand-run commands.
export const FFMPEG_HEAD = ['-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats'];
const head = () => new Args().add(FFMPEG_HEAD.slice(0, 3)).add(FFMPEG_HEAD.slice(3));

export const AUDIO_FORMATS = {
  mp3: { ext: 'mp3', name: 'MP3' },
  opus: { ext: 'opus', name: 'Opus' },
  aac: { ext: 'aac', name: 'AAC (ADTS)' },
  m4a: { ext: 'm4a', name: 'AAC (M4A)' },
  flac: { ext: 'flac', name: 'FLAC' },
  wav: { ext: 'wav', name: 'WAV' },
  ogg: { ext: 'ogg', name: 'Ogg Vorbis' },
};

// Container capability tables drive every cover/tag decision below, so a format's quirks are declared once:
// PICTURE_STREAM: the picture is a video stream flagged attached_pic (ID3 APIC, MP4 covr, FLAC PICTURE).
// PICTURE_ATTACH: Matroska stores pictures as attachments (-attach), not as streams.
// PICTURE_INPUT: inputs that may already hold a picture worth carrying over (mapped optionally with '?').
// NO_TAGS: raw ADTS AAC has no metadata container at all.
export const AUDIO_EXT = new Set(['mp3', 'm4a', 'm4b', 'aac', 'flac', 'wav', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'aif', 'ape', 'wv', 'mka', 'alac', 'ac3', 'mp2', 'caf', 'tta', 'spx', 'dsf', 'w64']);
const VIDEO_EXT = new Set(['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'ts', 'mts', 'm2ts', 'wmv', 'flv', 'mpg', 'mpeg', '3gp', 'ogv']);
// Audio files that can carry a cover picture (ffmpeg shows it as an attached-picture video stream).
const PICTURE_INPUT = new Set(['mp3', 'm4a', 'm4b', 'flac', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'aif', 'ape', 'wv', 'mka', 'dsf']);
const PICTURE_STREAM = new Set(['mp3', 'm4a', 'm4b', 'mp4', 'm4v', 'mov', 'flac']);
const PICTURE_ATTACH = new Set(['mkv', 'mka']);
const MP4_FAMILY = new Set(['mp4', 'm4a', 'm4b', 'm4v', 'mov']);
const NO_TAGS = new Set(['aac']);
const IMAGE_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' };

const need = (v, name, fn) => { if (v == null || v === '') throw new Error(`${fn}: ${name} is required`); };
// Bitrate normalization: '128k' passes through; numbers below 1000 are read as kbit/s (users type 128), larger
// ones as bit/s (probe results), formatted by ffcmd's bitrate().
const kbps = (b) => (b == null || b === '' ? null : typeof b === 'string' && /[kKmM]$/.test(b) ? b : +b < 1000 ? `${Math.round(+b)}k` : bitrateText(+b));

// --- tags -------------------------------------------------------------------------------------------------------

// Job tag names (camelCase, shared with mediatags) -> ffmpeg generic metadata keys; each muxer then maps generic
// keys to its native frames (ID3 TPE2 for album_artist, MP4 aART, Vorbis ALBUMARTIST). Keys handled specially
// (track/disc totals, date fallback, multi-value artists/genres) or not representable as text are skipped here.
// bpm uses the ID3 frame id TBPM because ffmpeg has no generic key that maps to it.
const TAG_KEYS = {
  title: 'title', artist: 'artist', album: 'album', albumArtist: 'album_artist', composer: 'composer', genre: 'genre',
  comment: 'comment', description: 'description', synopsis: 'synopsis', lyrics: 'lyrics', copyright: 'copyright',
  publisher: 'publisher', encodedBy: 'encoded_by', encoder: 'encoder', language: 'language', show: 'show',
  network: 'network', grouping: 'grouping', compilation: 'compilation', episodeId: 'episode_id', mediaType: 'media_type',
  season: 'season_number', episode: 'episode_sort', narrator: 'narrator', performer: 'performer', lyricist: 'lyricist',
  bpm: 'TBPM', isrc: 'isrc',
};
const SKIP_TAGS = new Set(['track', 'trackTotal', 'disc', 'discTotal', 'year', 'date', 'artists', 'genres', 'cover', 'chapters', 'pictures', 'replaygain']);
const snake = (k) => k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
const tagValue = (v) => (Array.isArray(v) ? v.filter((x) => x != null && x !== '').join('; ') : typeof v === 'boolean' ? (v ? '1' : '0') : String(v));

/** Tags of a job as ffmpeg's generic metadata keys (the muxers map them to ID3 frames, MP4 atoms, Vorbis comments). */
export function tagPairs(tags = {}) {
  const t = tags || {};
  const out = [];
  const has = (v) => v != null && !(Array.isArray(v) && !v.length);
  const nums = (n, total) => (has(total) && total !== '' ? `${n}/${total}` : String(n));
  for (const [k, v] of Object.entries(t)) {
    if (SKIP_TAGS.has(k) || !has(v) || typeof v === 'object' && !Array.isArray(v)) continue;
    if (k === 'artist' || k === 'genre') { out.push([k, tagValue(v)]); continue; }
    out.push([TAG_KEYS[k] || snake(k), tagValue(v)]);
  }
  if (!has(t.artist) && has(t.artists)) out.unshift(['artist', tagValue(t.artists)]);
  if (!has(t.genre) && has(t.genres)) out.push(['genre', tagValue(t.genres)]);
  if (has(t.track) && t.track !== '') out.push(['track', nums(t.track, t.trackTotal)]);
  if (has(t.disc) && t.disc !== '') out.push(['disc', nums(t.disc, t.discTotal)]);
  const date = has(t.date) ? t.date : t.year;
  if (has(date)) out.push(['date', String(date)]);
  return out;
}

function addTags(a, tags) {
  for (const [k, v] of tagPairs(tags)) a.add('-metadata', `${k}=${v}`);
}

// --- covers -----------------------------------------------------------------------------------------------------

// Maps the picture (a new image input, or the one an audio input has) and returns the options that follow the codec
// options, or null when the output cannot hold one.
// Two-phase API: the -map must be placed among the input mappings, while -c:v copy / -disposition must follow the
// codec options, so the function maps now and returns a closure that emits the tail later.
// '0:v:0?' (trailing ?) makes the mapping optional: an input without a picture does not fail the job.
// The cover is stream-copied (never re-encoded) and flagged attached_pic, else players treat it as a 1-frame video.
function coverMap(a, ext, { coverInput, keepInput }) {
  if (!PICTURE_STREAM.has(ext)) return null;
  if (coverInput != null) a.add('-map', `${coverInput}:v:0`);
  else if (keepInput) a.add('-map', '0:v:0?');
  else return null;
  return (b) => {
    b.add('-c:v', 'copy').add('-disposition:v:0', 'attached_pic');
    if (ext === 'mp3' || ext === 'flac') b.add('-metadata:s:v:0', 'title=Album cover').add('-metadata:s:v:0', 'comment=Cover (front)');
  };
}

function coverAttach(a, cover, index = 0) {
  const ext = extOf(cover);
  a.add('-attach', cover).add(`-metadata:s:t:${index}`, `mimetype=${IMAGE_MIME[ext] || 'image/jpeg'}`).add(`-metadata:s:t:${index}`, `filename=cover.${ext || 'jpg'}`);
}

// ID3v2.3 instead of ffmpeg's default v2.4: Windows Explorer and many car/hardware players read only v2.3.
// +faststart moves the MP4 'moov' index to the front (a second pass over the file), so playback and streaming
// can start before the whole file is downloaded.
function containerTail(a, ext) {
  if (ext === 'mp3') a.add('-id3v2_version', '3');
  else if (MP4_FAMILY.has(ext)) a.add('-movflags', '+faststart');
}

// --- audio codecs -----------------------------------------------------------------------------------------------

const QUALITY = { low: 0, med: 1, high: 2, lossless: 3 };

/** Codec options of an audio format: argv groups. */
// Quality ladders per codec: VBR where the encoder's VBR is the recommended mode (LAME -q:a 6/4/0 ~ 115/165/245
// kbit/s; Vorbis -q:a), constant bitrate targets for Opus/AAC. 'lossless' on lossy codecs means the codec's top
// setting. FLAC 24-bit: ffmpeg's flac encoder takes s32 samples, -bits_per_raw_sample 24 marks the real depth.
export function audioCodecArgs(format, { quality = 'high', bitrate = null, bits = null } = {}) {
  const q = QUALITY[quality] ?? 2;
  const br = kbps(bitrate);
  switch (format) {
    case 'mp3': return [['-c:a', 'libmp3lame'], br ? ['-b:a', br] : q === 3 ? ['-b:a', '320k'] : ['-q:a', String([6, 4, 0][q])]];
    case 'opus': return [['-c:a', 'libopus'], ['-b:a', br || ['64k', '128k', '160k', '256k'][q]]];
    case 'aac': case 'm4a': case 'm4b': return [['-c:a', 'aac'], ['-b:a', br || ['96k', '160k', '256k', '320k'][q]]];
    case 'ogg': return [['-c:a', 'libvorbis'], br ? ['-b:a', br] : ['-q:a', String([3, 5, 7, 10][q])]];
    case 'flac': return [['-c:a', 'flac'], ['-compression_level', '8'], ...(bits === 16 ? [['-sample_fmt', 's16']] : bits === 24 ? [['-sample_fmt', 's32', '-bits_per_raw_sample', '24']] : [])];
    case 'wav': return [['-c:a', bits === 24 ? 'pcm_s24le' : bits === 32 ? 'pcm_f32le' : 'pcm_s16le']];
    default: throw new Error('unknown audio format: ' + format);
  }
}

const formatOf = (format, output) => {
  const f0 = String(format || extOf(output) || '').toLowerCase();
  return f0 === 'm4b' ? 'm4a' : f0 === 'oga' ? 'ogg' : f0;
};

// --- loudnorm ---------------------------------------------------------------------------------------------------

// Two-pass EBU R128 loudness normalization: pass 1 runs loudnorm in analysis mode and prints JSON measurements;
// pass 2 feeds them back as measured_* so loudnorm can apply a single LINEAR gain (linear=true) instead of dynamic
// compression, which preserves the dynamics. When measurements are not known at build time they are {var:...}
// placeholders that the runner fills from pass 1's parsed output. Defaults -16 LUFS / -1.5 dBTP / LRA 11 are the
// common podcast/streaming target.
const LN_VARS = { input_i: 'measured_I', input_tp: 'measured_TP', input_lra: 'measured_LRA', input_thresh: 'measured_thresh', target_offset: 'offset' };
const target = (t = {}) => ({ I: t.I ?? -16, TP: t.TP ?? -1.5, LRA: t.LRA ?? 11 });

function loudnormMeasure(t) { return f('loudnorm', { ...target(t), print_format: 'json' }); }

function loudnormApply(t, measured) {
  const o = { ...target(t) };
  for (const [k, opt] of Object.entries(LN_VARS)) o[opt] = measured ? measured[k] : raw(`{var:loudnorm.${k}}`);
  return f('loudnorm', { ...o, linear: 'true', print_format: 'summary' });
}

// Measurement decodes into the null muxer (-f null -): nothing is written, only the filter's report matters.
function scanStep({ input, t, s, span, dur, comment }) {
  const a = head().addIf(s > 0, '-ss', seconds(s)).add('-i', input).opt('-t', span != null ? seconds(span) : null);
  a.add('-map', '0:a:0').add('-af', loudnormMeasure(t)).add('-f', 'null', '-');
  return a.step({ tool: 'ffmpeg', comment, parse: 'loudnorm', progress: 'ffmpeg', duration: dur });
}

const RANGES = { input_i: [-99, 0], input_tp: [-99, 99], input_lra: [0, 99], input_thresh: [-99, 0], target_offset: [-99, 99] };

// Extracts the LAST JSON object containing "input_i" from stderr (ffmpeg prints other braces before it, e.g. in
// stream metadata). Values arrive as strings, including "-inf" for silence; they are converted and clamped to the
// ranges pass 2 accepts, otherwise pass 2 would reject the option and the job would fail on a silent file.
export function parseLoudnorm(text) {
  const s = String(text ?? '');
  const k = s.lastIndexOf('"input_i"');
  if (k < 0) return null;
  const a = s.lastIndexOf('{', k), b = s.indexOf('}', k);
  if (a < 0 || b < 0) return null;
  let j;
  try { j = JSON.parse(s.slice(a, b + 1)); } catch { return null; }
  const num = (v) => {
    const t = String(v).trim().toLowerCase();
    if (/^[-+]?inf(inity)?$/.test(t)) return t.startsWith('-') ? -Infinity : Infinity;
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : null;
  };
  const out = {};
  for (const [key, v] of Object.entries(j)) out[key] = key === 'normalization_type' ? String(v) : num(v);
  for (const [key, [lo, hi]] of Object.entries(RANGES)) {
    if (out[key] == null) return null;
    out[key] = Math.min(hi, Math.max(lo, out[key]));
  }
  return out;
}

// --- audio jobs -------------------------------------------------------------------------------------------------

// s = seek offset, len = output length (only when an end is given), dur = expected output duration for progress
// (len, else the remaining part of the known total duration).
function span(start, end, duration) {
  const s = parseTime(start) ?? 0;
  const e = parseTime(end);
  const d = parseTime(duration);
  const len = e != null ? Math.max(0, e - s) : null;
  return { s, len, dur: len ?? (d != null ? Math.max(0, d - s) : null) };
}

function audioJob(kind, fn, o) {
  const { input, output, quality = 'high', bitrate = null, sampleRate = null, channels = null, bits = null, tags = null, cover = null, measured = null } = o;
  need(input, 'input', fn); need(output, 'output', fn);
  const ext = extOf(output);
  const fmt = formatOf(o.format, output);
  const videoOut = VIDEO_EXT.has(fmt);
  if (!videoOut && !AUDIO_FORMATS[fmt]) throw new Error(`${fn}: unknown audio format ${fmt || '(none)'}`);
  const { s, len, dur } = span(o.start, o.end, o.duration);
  const t = o.loudnorm ? target(o.loudnorm) : null;
  const notes = [];
  const steps = [];
  if (t && !measured) steps.push(scanStep({ input, t, s, span: len, dur, comment: `Measure the loudness of ${baseName(input)} (pass 1 of 2)` }));

  // Input seeking (-ss before -i): ffmpeg jumps by index instead of decoding from the start; with re-encoding it is
  // frame-accurate since ffmpeg 2.1. A video container output means "replace the audio track in place": video and
  // subtitles are copied, only the first audio stream is re-encoded.
  const a = head().addIf(s > 0, '-ss', seconds(s)).add('-i', input);
  const keepInput = o.keepCover ?? PICTURE_INPUT.has(extOf(input));
  let coverTail = null;
  if (videoOut) {
    a.add('-map', '0:v?').add('-map', '0:a:0').add('-map', '0:s?').add('-c', 'copy');
  } else {
    if (cover && PICTURE_STREAM.has(ext)) a.add('-i', cover);
    a.add('-map', '0:a:0');
    coverTail = coverMap(a, ext, { coverInput: cover && PICTURE_STREAM.has(ext) ? 1 : null, keepInput: !cover && keepInput });
    if (cover && !PICTURE_STREAM.has(ext)) notes.push(`ffmpeg cannot embed a cover picture in .${ext} files; the cover was left out`);
  }
  a.opt('-af', t ? loudnormApply(t, measured) : null);
  if (videoOut) for (const g of audioCodecArgs(fmt === 'webm' ? 'opus' : 'aac', { quality, bitrate })) a.add(g);
  else for (const g of audioCodecArgs(fmt, { quality, bitrate, bits })) a.add(g);
  // loudnorm works at 192 kHz: the output rate is set explicitly (48 kHz unless sampleRate says otherwise)
  a.opt('-ar', sampleRate ?? (t ? 48000 : null)).opt('-ac', channels);
  coverTail?.(a);
  a.opt('-t', len != null ? seconds(len) : null);
  if (tags && NO_TAGS.has(fmt)) notes.push('ADTS .aac files carry no tags; use m4a to keep them');
  else if (tags) addTags(a, tags);
  containerTail(a, ext);
  a.add(argPath(output));
  const label = videoOut ? fmt.toUpperCase() : AUDIO_FORMATS[fmt].name;
  const what = t ? `Normalize to ${t.I} LUFS and encode as ${label}` : `Convert to ${label} (${quality} quality)`;
  steps.push(a.step({ tool: 'ffmpeg', comment: steps.length ? `${what} (pass 2 of 2)` : what, progress: 'ffmpeg', duration: dur }));
  const title = o.title || (kind === 'ffmpeg.loudnorm' ? `Normalize ${baseName(input)}` : kind === 'ffmpeg.extractAudio' ? `Extract the audio of ${baseName(input)}` : `Convert ${baseName(input)} to ${label}`);
  return makeJob(kind, title, steps, [output], { notes });
}

export const convertAudio = (o = {}) => audioJob('ffmpeg.convertAudio', 'convertAudio', o);

export function normalize(o = {}) {
  return audioJob('ffmpeg.loudnorm', 'normalize', { quality: 'high', ...o, loudnorm: target(o.target), measured: o.measured || null });
}

export function loudnessScan({ input, I, TP, LRA, start, end, duration } = {}) {
  need(input, 'input', 'loudnessScan');
  const { s, len, dur } = span(start, end, duration);
  const t = target({ I, TP, LRA });
  return makeJob('ffmpeg.loudnessScan', `Measure the loudness of ${baseName(input)}`, [scanStep({ input, t, s, span: len, dur, comment: `Measure the loudness (target ${t.I} LUFS)` })], []);
}

export function extractAudio(o = {}) {
  const { input, output, copy = true } = o;
  need(input, 'input', 'extractAudio'); need(output, 'output', 'extractAudio');
  if (!copy) return audioJob('ffmpeg.extractAudio', 'extractAudio', { keepCover: false, ...o });
  const { s, len, dur } = span(o.start, o.end, o.duration);
  const ext = extOf(output);
  const a = head().addIf(s > 0, '-ss', seconds(s)).add('-i', input).opt('-t', len != null ? seconds(len) : null);
  a.add('-map', '0:a:0').add('-c:a', 'copy');
  containerTail(a, ext);
  a.add(argPath(output));
  return makeJob('ffmpeg.extractAudio', `Extract the audio of ${baseName(input)}`, [a.step({ tool: 'ffmpeg', comment: 'Copy the first audio stream without re-encoding', progress: 'ffmpeg', duration: dur })], [output]);
}

// --- video ------------------------------------------------------------------------------------------------------

// Encoder presets come from ffcmd/codecs.js (one source of truth for CRF/preset ladders); this function only
// patches them: drops -movflags for Matroska, overrides -crf / -preset when given. Subtitles must be converted
// for the target container: MP4 only holds mov_text, WebM only WebVTT; Matroska copies any format.
export function convertVideo(o = {}) {
  const { input, output, quality = 'med', maxHeight = null, crf = null, preset = null, audio = true, subtitles = 'none', subtitleFile = null, subtitleStream = 0, videoBitrate = 0, audioBitrate = 0 } = o;
  need(input, 'input', 'convertVideo'); need(output, 'output', 'convertVideo');
  let fmt = String(o.format || extOf(output)).toLowerCase();
  if (fmt === 'mov' || fmt === 'm4v') fmt = 'mp4';
  if (!['mp4', 'webm', 'mkv'].includes(fmt)) throw new Error('convertVideo: format must be mp4, webm or mkv');
  const id = fmt === 'webm' ? 'webm-vp9' : 'mp4-h264';
  let enc = encodeArgs(id, { quality: quality === 'lossless' ? 'high' : quality, audio, videoBitrate, audioBitrate });
  if (fmt === 'mkv') enc = enc.filter((g) => !(Array.isArray(g) && g[0] === '-movflags'));
  if (crf != null) enc = enc.map((g) => (Array.isArray(g) && g[0] === '-crf' ? ['-crf', String(crf), ...g.slice(2)] : g));
  if (preset && id === 'mp4-h264') enc = enc.map((g) => (Array.isArray(g) && g[0] === '-preset' ? ['-preset', String(preset)] : g));
  const { s, len, dur } = span(o.start, o.end, o.duration);
  const burn = subtitles === 'burn';
  const a = head();
  // Burning subtitles: the subtitles filter reads its file from the start, so the cut is an output seek (-ss after
  // -i keeps the original timestamps the filter matches).
  a.addIf(s > 0 && !burn, '-ss', seconds(s)).add('-i', input).addIf(s > 0 && burn, '-ss', seconds(s));
  a.opt('-t', len != null ? seconds(len) : null);
  a.add('-map', '0:v:0').addIf(audio, '-map', '0:a?').addIf(subtitles === 'copy', '-map', '0:s?');
  const filters = [];
  if (burn) filters.push(f('subtitles', { filename: subtitleFile || input, si: subtitleFile ? null : subtitleStream }));
  // scale=-2:...: width follows the aspect ratio rounded to an even number, height capped and forced even:
  // yuv420p (4:2:0 chroma subsampling) requires even dimensions, odd ones make libx264 fail.
  if (maxHeight) filters.push(f('scale', -2, `trunc(min(ih,${Math.round(maxHeight)})/2)*2`));
  a.opt('-vf', filters.length ? filters.join(',') : null);
  for (const g of enc) a.add(g);
  if (subtitles === 'copy') a.add('-c:s', fmt === 'mp4' ? 'mov_text' : fmt === 'webm' ? 'webvtt' : 'copy');
  else a.add('-sn');
  a.add(argPath(output));
  const what = `Encode as ${fmt.toUpperCase()} (${id.split('-')[1].toUpperCase()}, ${quality} quality${maxHeight ? `, at most ${maxHeight}p` : ''})`;
  return makeJob('ffmpeg.convertVideo', `Convert ${baseName(input)} to ${fmt.toUpperCase()}`, [a.step({ tool: 'ffmpeg', comment: what, progress: 'ffmpeg', duration: dur })], [output]);
}

// Stream copy into another container: no quality loss, near disk speed. -map 0 takes every stream (ffmpeg's default
// picks only one per type); subtitles still need a codec the target container supports.
export function remux({ input, output, streams = 'all', duration = null } = {}) {
  need(input, 'input', 'remux'); need(output, 'output', 'remux');
  const ext = extOf(output);
  const a = head().add('-i', input);
  if (streams === 'av') a.add('-map', '0:v?').add('-map', '0:a?');
  else a.add('-map', '0');
  a.add('-c', 'copy');
  if (streams !== 'av' && MP4_FAMILY.has(ext)) a.add('-c:s', 'mov_text');
  else if (streams !== 'av' && ext === 'webm') a.add('-c:s', 'webvtt');
  if (MP4_FAMILY.has(ext)) a.add('-movflags', '+faststart');
  a.add(argPath(output));
  const comment = streams === 'av' ? 'Copy the video and audio streams into the new container' : 'Copy every stream into the new container';
  return makeJob('ffmpeg.remux', `Remux ${baseName(input)} to .${ext}`, [a.step({ tool: 'ffmpeg', comment, progress: 'ffmpeg', duration: parseTime(duration) })], [output]);
}

// --- tracks and chapters ----------------------------------------------------------------------------------------

/** Chapters with every end filled in: the next chapter's start, else total (when known), else the start. */
// Sorted by start, then open ends closed by the next start: chapter lists from cue sheets or YouTube descriptions
// usually give only start times.
export function resolveChapters(chapters = [], total = null) {
  const list = (chapters || []).map((c) => ({ start: parseTime(c.start) ?? 0, end: parseTime(c.end), title: c.title ?? '' })).sort((x, y) => x.start - y.start);
  const t = parseTime(total);
  return list.map((c, i) => ({ ...c, end: c.end ?? (i + 1 < list.length ? list[i + 1].start : t ?? c.start) }));
}

// FFMETADATA1 escaping: '=', ';', '#', '\' and newline are syntax in that format and get a backslash. Chapters use
// TIMEBASE=1/1000 with integer milliseconds; END is forced >= START because ffmpeg rejects inverted chapters.
const metaEscape = (s) => String(s).replace(/\r\n?/g, '\n').replace(/[=;#\\\n]/g, (c) => '\\' + c);
const ms = (x) => Math.max(0, Math.round((parseTime(x) ?? 0) * 1000));

export function ffmetadata(tags = {}, chapters = []) {
  const lines = [';FFMETADATA1'];
  for (const [k, v] of tagPairs(tags)) lines.push(`${metaEscape(k)}=${metaEscape(v)}`);
  for (const c of resolveChapters(chapters)) {
    lines.push('', '[CHAPTER]', 'TIMEBASE=1/1000', `START=${ms(c.start)}`, `END=${Math.max(ms(c.start), ms(c.end))}`);
    if (c.title != null && c.title !== '') lines.push(`title=${metaEscape(c.title)}`);
  }
  return lines.join('\n') + '\n';
}

// ffconcat quoting is shell-like single quotes: ' is written as '\'' (close, escaped quote, reopen). A line break
// cannot be represented in the format at all, so such a path fails loudly instead of corrupting the list.
export function concatList(paths) {
  const lines = ['ffconcat version 1.0'];
  for (const p of paths || []) {
    const s = String(p && typeof p === 'object' ? p.path : p);
    if (/[\r\n]/.test(s)) throw new Error('concatList: a path with a line break cannot be listed: ' + JSON.stringify(s));
    lines.push(`file '${s.replace(/'/g, "'\\''")}'`);
  }
  return lines.join('\n') + '\n';
}

// File name template "{track:02} {title}.{ext}": each value is made file-safe separately (so a title with '/'
// cannot create directories), numbers can be zero-padded, missing values vanish; the whole name is sanitized again.
function patternName(pattern, values) {
  const name = String(pattern).replace(/\{(\w+)(?::(\d+))?\}/g, (m, key, width) => {
    const v = values[key];
    if (v == null || v === '') return '';
    if (width && /^\d+$/.test(String(v))) return String(v).padStart(+width, '0');
    return key === 'ext' ? String(v) : fileSafe(String(v), { maxBytes: 120 });
  });
  return fileSafe(name.replace(/[\\/]/g, '_'));
}

// One ffmpeg process per track (simple, restartable, per-track progress) rather than one process with N outputs.
// Names are de-duplicated case-insensitively (two "Intro" tracks -> "Intro (2)"): Windows and default macOS file
// systems are case-insensitive. -map_metadata -1 / -map_chapters -1 drop the source's album-wide tags and
// chapters, which would be wrong on each single track; per-track tags are then written explicitly.
export function splitTracks(o = {}) {
  const { input, tracks = [], outDir = '', pattern = '{track:02} {title}.{ext}', copy = false, quality = 'high', album = null, albumArtist = null, artist = null, year = null, genre = null, cover = null } = o;
  need(input, 'input', 'splitTracks');
  if (!tracks.length) throw new Error('splitTracks: no tracks');
  const inExt = extOf(input);
  const fmt = formatOf(o.format || (copy ? inExt : AUDIO_FORMATS[inExt] ? inExt : 'mp3'));
  const ext = o.format ? (fmt === 'm4a' && extOf('x.' + o.format) === 'm4b' ? 'm4b' : AUDIO_FORMATS[fmt]?.ext || fmt) : copy ? inExt : AUDIO_FORMATS[fmt].ext;
  if (!copy && !AUDIO_FORMATS[fmt]) throw new Error('splitTracks: unknown audio format ' + fmt);
  const total = tracks.length;
  const used = new Set();
  const outputs = [];
  const notes = [];
  const keepInput = o.keepCover ?? PICTURE_INPUT.has(inExt);
  if (cover && !PICTURE_STREAM.has(ext)) notes.push(`ffmpeg cannot embed a cover picture in .${ext} files; the cover was left out`);
  const steps = tracks.map((tr, i) => {
    const number = tr.number ?? i + 1;
    const s = parseTime(tr.start) ?? 0;
    const e = parseTime(tr.end) ?? (i + 1 < total ? parseTime(tracks[i + 1].start) : null);
    const len = e != null ? Math.max(0, e - s) : null;
    const dur = len ?? (o.duration != null ? Math.max(0, parseTime(o.duration) - s) : null);
    const trTitle = tr.title || `Track ${number}`;
    const trArtist = tr.artist || artist || albumArtist || null;
    let name = patternName(pattern, { track: number, n: number, title: trTitle, artist: trArtist, album, albumArtist, year, genre, disc: tr.disc, ext });
    for (let k = 2; used.has(name.toLowerCase()); k++) name = name.replace(/( \(\d+\))?(\.[^.]+)?$/, (m, _n, x) => ` (${k})${x || ''}`);
    used.add(name.toLowerCase());
    const out = joinPath(outDir, name);
    outputs.push(out);
    const a = head().addIf(s > 0, '-ss', seconds(s)).add('-i', input);
    const useCover = cover && PICTURE_STREAM.has(ext);
    if (useCover) a.add('-i', cover);
    a.opt('-t', len != null ? seconds(len) : null);
    a.add('-map', '0:a:0');
    const coverTail = coverMap(a, ext, { coverInput: useCover ? 1 : null, keepInput: !cover && keepInput });
    if (copy) a.add('-c:a', 'copy'); else for (const g of audioCodecArgs(fmt, { quality, bitrate: o.bitrate })) a.add(g);
    coverTail?.(a);
    a.add('-map_metadata', '-1').add('-map_chapters', '-1');
    addTags(a, { title: trTitle, artist: trArtist, album, albumArtist, track: number, trackTotal: total, year, genre, ...(tr.tags || {}) });
    containerTail(a, ext);
    a.add(argPath(out));
    return a.step({ tool: 'ffmpeg', comment: `Track ${number}: ${trTitle}`, progress: 'ffmpeg', duration: dur });
  });
  return makeJob('ffmpeg.split', `Split ${baseName(input)} into ${total} tracks`, steps, outputs, { notes });
}

// Concat demuxer + FFMETADATA input in ONE pass: list.ffconcat names the files (-safe 0 allows absolute paths and
// any characters), chapters.txt (input 1) provides tags and chapter marks computed from the input durations, which
// is why every input must have a probed duration. Both files live in {work}, written by the runner/shell.
export function joinChapters(o = {}) {
  const { inputs = [], output, tags = {}, cover = null, bitrate = null, copy = false } = o;
  need(output, 'output', 'joinChapters');
  if (!inputs.length) throw new Error('joinChapters: no inputs');
  const ext = extOf(output);
  let at = 0;
  const chapters = inputs.map((x, i) => {
    const p = typeof x === 'string' ? x : x.path;
    const d = parseTime(typeof x === 'string' ? null : x.duration);
    if (!(d > 0)) throw new Error(`joinChapters: input ${i + 1} (${baseName(p)}) has no duration; probe the inputs first`);
    const c = { start: at, end: at + d, title: (typeof x === 'object' && x.title) || baseName(p).replace(/\.[^.]+$/, '') };
    at += d;
    return c;
  });
  const files = { 'list.ffconcat': concatList(inputs.map((x) => (typeof x === 'string' ? x : x.path))), 'chapters.txt': ffmetadata(tags, chapters) };
  const a = head().add('-f', 'concat', '-safe', '0', '-i', '{work}/list.ffconcat').add('-f', 'ffmetadata', '-i', '{work}/chapters.txt');
  const stream = cover && PICTURE_STREAM.has(ext);
  if (stream) a.add('-i', cover);
  a.add('-map', '0:a').add('-map_metadata', '1').add('-map_chapters', '1');
  if (stream) a.add('-map', '2:v:0');
  const fmt = ext === 'mka' ? 'opus' : formatOf(null, output);
  if (copy) a.add('-c:a', 'copy');
  else if (AUDIO_FORMATS[fmt]) for (const g of audioCodecArgs(fmt, { quality: 'med', bitrate: bitrate ?? (['flac', 'wav'].includes(fmt) ? null : fmt === 'opus' ? '96k' : '128k') })) a.add(g);
  else throw new Error('joinChapters: unsupported output .' + ext);
  const notes = [];
  if (stream) a.add('-c:v', 'copy').add('-disposition:v:0', 'attached_pic');
  else if (cover && PICTURE_ATTACH.has(ext)) coverAttach(a, cover, 0);
  else if (cover) notes.push(`ffmpeg cannot embed a cover picture in .${ext} files; the cover was left out`);
  containerTail(a, ext);
  a.add(argPath(output));
  const step = a.step({ tool: 'ffmpeg', comment: `Join ${inputs.length} files into one with ${chapters.length} chapters`, files, progress: 'ffmpeg', duration: at });
  return makeJob('ffmpeg.joinChapters', `Join ${inputs.length} files into ${baseName(output)}`, [step], [output], { notes });
}

// Rewrites metadata with stream copy. Input numbering shifts when a chapters file is added (cover becomes input
// 2 instead of 1), hence the computed index. For Matroska audio the old attachments are unmapped (-0:t) so the new
// cover replaces rather than duplicates; for video, existingAttachments gives the index the new one will get.
export function embedMeta(o = {}) {
  const { input, output, tags = {}, cover = null, chapters = null, duration = null, existingAttachments = 0 } = o;
  need(input, 'input', 'embedMeta'); need(output, 'output', 'embedMeta');
  const ext = extOf(output);
  const audioOut = AUDIO_EXT.has(ext);
  const hasCh = Array.isArray(chapters) && chapters.length > 0;
  const files = hasCh ? { 'chapters.txt': ffmetadata({}, resolveChapters(chapters, duration)) } : {};
  const a = head().add('-i', input);
  if (hasCh) a.add('-f', 'ffmetadata', '-i', '{work}/chapters.txt');
  const stream = cover && PICTURE_STREAM.has(ext);
  const attach = cover && PICTURE_ATTACH.has(ext);
  const notes = [];
  if (stream) {
    a.add('-i', cover);
    // an audio file's old picture is replaced; a video keeps its streams and gets the picture as a second video stream
    a.add('-map', audioOut ? '0:a' : '0').add('-map', `${hasCh ? 2 : 1}:v:0`);
  } else if (attach && audioOut) a.add('-map', '0').add('-map', '-0:t');
  else a.add('-map', '0');
  a.add('-c', 'copy').add('-map_metadata', '0');
  if (hasCh) a.add('-map_chapters', '1');
  if (stream) {
    a.add(`-disposition:v:${audioOut ? 0 : 1}`, 'attached_pic');
    if (ext === 'mp3' || ext === 'flac') a.add('-metadata:s:v:0', 'title=Album cover').add('-metadata:s:v:0', 'comment=Cover (front)');
    if (!audioOut) notes.push('the cover becomes the second video stream (one video stream assumed)');
  } else if (attach) coverAttach(a, cover, audioOut ? 0 : existingAttachments);
  else if (cover) notes.push(`ffmpeg cannot embed a cover picture in .${ext} files; the cover was left out`);
  addTags(a, tags);
  containerTail(a, ext);
  a.add(argPath(output));
  const what = [Object.keys(tags || {}).length && 'tags', cover && 'cover', hasCh && `${chapters.length} chapters`].filter(Boolean).join(', ') || 'metadata';
  const step = a.step({ tool: 'ffmpeg', comment: `Write ${what} (streams copied)`, files, progress: 'ffmpeg', duration: parseTime(duration) });
  return makeJob('ffmpeg.embed', `Write ${what} into ${baseName(output)}`, [step], [output], { notes });
}

// --- pictures ---------------------------------------------------------------------------------------------------

// -q:v 2 is near the top of the MJPEG scale (2 best .. 31 worst) for JPEG output.
export function frame({ input, output, at = 0, width = null, quality = 2 } = {}) {
  need(input, 'input', 'frame'); need(output, 'output', 'frame');
  const t = parseTime(at) ?? 0;
  const ext = extOf(output);
  const a = head().addIf(t > 0, '-ss', seconds(t)).add('-i', input).add('-map', '0:v:0').add('-frames:v', '1');
  a.opt('-vf', width ? f('scale', Math.round(width), -2) : null);
  if (ext === 'jpg' || ext === 'jpeg') a.add('-q:v', String(quality));
  // -update 1: one picture, the file name is taken literally (no %d sequence pattern)
  a.add('-update', '1').add(argPath(output));
  return makeJob('ffmpeg.frame', `Picture of ${baseName(input)} at ${seconds(t)} s`, [a.step({ tool: 'ffmpeg', comment: `Save the frame at ${seconds(t)} s`, progress: 'ffmpeg' })], [output]);
}

// showwavespic renders the whole stream into one picture after reading it all, so -frames:v 1 with -update 1
// writes exactly that single image under the literal output name.
export function waveformImage({ input, output, width = 1200, height = 240, color = '#3b82f6', duration = null } = {}) {
  need(input, 'input', 'waveformImage'); need(output, 'output', 'waveformImage');
  const g = new Graph();
  g.chain(['0:a:0'], [f('showwavespic', { s: `${Math.round(width)}x${Math.round(height)}`, colors: color, split_channels: 0 })], ['wave']);
  const a = head().add('-i', input).add('-filter_complex', g.text()).add('-map', '[wave]').add('-frames:v', '1').add('-update', '1').add(argPath(output));
  return makeJob('ffmpeg.waveform', `Waveform of ${baseName(input)}`, [a.step({ tool: 'ffmpeg', comment: `Draw the waveform (${width}x${height})`, progress: 'ffmpeg', duration: parseTime(duration) })], [output]);
}

// --- progress ---------------------------------------------------------------------------------------------------

/** Reads `-progress pipe:1` output; chunks may split lines (the unfinished line waits in state.rest). */
// -progress output is blocks of key=value lines ending with progress=continue|end. out_time_ms is (despite its
// name) in MICROseconds in ffmpeg, the same as out_time_us; both are divided by 1e6. Once a microsecond key has been
// seen, the textual out_time is ignored (it is rounded and sometimes negative at the start).
export function parseProgress(text, state = {}) {
  const s = state;
  if (!('outTime' in s)) Object.assign(s, { outTime: null, speed: null, frame: null, fps: null, totalSize: null, bitrate: null, done: false, rest: '' });
  const lines = ((s.rest || '') + String(text ?? '')).split(/\r?\n|\r/);
  s.rest = lines.pop();
  for (const line of lines) {
    const i = line.indexOf('=');
    if (i < 0) continue;
    const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
    const n = parseFloat(v);
    if (k === 'out_time_us' || k === 'out_time_ms') { if (/^-?\d+$/.test(v)) { s.outTime = Math.max(0, +v / 1e6); s.usTime = true; } }
    else if (k === 'out_time') { const t = parseTime(v.replace(/^-/, '')); if (t != null && !s.usTime) s.outTime = t; }
    else if (k === 'speed') s.speed = Number.isFinite(n) ? n : null;
    else if (k === 'frame') s.frame = Number.isFinite(n) ? Math.round(n) : null;
    else if (k === 'fps') s.fps = Number.isFinite(n) ? n : null;
    else if (k === 'total_size') s.totalSize = Number.isFinite(n) ? Math.round(n) : null;
    else if (k === 'bitrate') s.bitrate = Number.isFinite(n) ? n : null;
    else if (k === 'progress') s.done = v === 'end';
  }
  return s;
}

export function progressFraction(state, duration) {
  const d = +duration;
  if (state?.done) return 1;
  if (!(d > 0) || state?.outTime == null) return null;
  return Math.min(1, Math.max(0, state.outTime / d));
}
