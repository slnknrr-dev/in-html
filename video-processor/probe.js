// video-processor/probe.js - identifies a media file and reads it with the format libraries: container,
// tracks, codecs, durations, bit rates, metadata (media info panel) and, for WebM / Matroska / MP4, the timed
// samples that the WebCodecs export decodes. No DOM access.
//
// Why parse containers ourselves: the browser exposes no track list, codec strings or encoded samples. The
// WebCodecs export needs the raw encoded samples (demux) plus a decoder config, and the info panel wants metadata
// the <video> element hides. Parsers are pure functions over a Uint8Array, so they also run in Node tests.
import { parseWebm, decoderConfig as webmConfig } from '../webm/demux.js';
import { parseMp4, decoderConfig as mp4Config } from '../mp4/demux.js';
import { readOggInfo } from '../ogg/vorbis.js';
import { parseWav } from '../wav/wav.js';
import { scanMp3 } from '../mp3/frame.js';
import { readId3v2, readId3v1 } from '../mp3/id3.js';
import { codecName } from '../mp4/codecs.js';

const ascii = (b, o, n) => String.fromCharCode(...b.subarray(o, o + n));

/** Container of a file from its first bytes: webm | mp4 | ogg | wav | mp3 | flac | unknown. */
// Magic numbers: EBML header 1A 45 DF A3 (WebM / Matroska), an ISO-BMFF box type at offset 4 (MP4 / MOV; files may
// start with ftyp, moov, mdat or free/wide/skip padding), OggS, RIFF....WAVE, fLaC, an ID3 tag or an MPEG frame
// sync (11 set bits: FF then top 3 bits of the next byte). Extensions are never trusted for detection.
export function sniff(b) {
  if (b.length < 12) return 'unknown';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
  const t4 = ascii(b, 4, 4);
  if (['ftyp', 'moov', 'mdat', 'free', 'wide', 'skip', 'pnot'].includes(t4)) return 'mp4';
  if (ascii(b, 0, 4) === 'OggS') return 'ogg';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE') return 'wav';
  if (ascii(b, 0, 4) === 'fLaC') return 'flac';
  if (ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'mp3';
  return 'unknown';
}

const LABELS = { webm: 'WebM', mkv: 'Matroska', mp4: 'MP4', mov: 'QuickTime', m4a: 'MPEG-4 audio', ogg: 'Ogg', wav: 'WAV', mp3: 'MP3', flac: 'FLAC', unknown: '?' };

/**
 * Reads a file. Returns { container, label, duration (s, 0 when unknown), bitrate, tracks: [{ type, codec, codecName,
 * width, height, fps, sampleRate, channels, bitDepth, bitrate, language, frames }], meta: { title, artist, … },
 * extra: [[labelKey, value]], cover: { mime, data } | null, demux: { video?, audio? } | null }.
 * demux.video / demux.audio: { config (WebCodecs decoder config), samples: [{ timestamp, duration (µs), keyframe, data }] }.
 */
// Never throws: a parse error is reported in out.error and whatever was read before it is kept (partial info is
// still useful). A missing overall bitrate is derived from size / duration.
export function probe(bytes, name = '') {
  const container = sniff(bytes);
  const out = { container, label: LABELS[container], duration: 0, bitrate: 0, tracks: [], meta: {}, extra: [], cover: null, demux: null };
  try {
    if (container === 'webm') readWebm(bytes, out);
    else if (container === 'mp4') readMp4(bytes, out);
    else if (container === 'ogg') readOgg(bytes, out);
    else if (container === 'wav') readWav(bytes, out);
    else if (container === 'mp3') readMp3(bytes, out);
    else if (container === 'flac') readFlac(bytes, out);
  } catch (e) {
    out.error = String(e && e.message || e);
  }
  if (out.duration && !out.bitrate) out.bitrate = Math.round((bytes.length * 8) / out.duration);
  if (/\.mkv$/i.test(name) && container === 'webm') out.label = LABELS.mkv;
  return out;
}

// "seekable" = the file has both Cues and a Duration; MediaRecorder files have neither (media.js fixes them).
// Only the first video and first audio track are demuxed for export.
function readWebm(b, out) {
  const w = parseWebm(b);
  out.label = w.docType === 'webm' ? 'WebM' : 'Matroska';
  out.duration = w.duration;
  if (w.info.title) out.meta.title = w.info.title;
  for (const [k, v] of Object.entries(w.tags)) if (['title', 'artist', 'album', 'date_released', 'comment', 'encoder', 'genre'].includes(k)) out.meta[k === 'date_released' ? 'date' : k] = v;
  out.extra.push(['vp.i.muxer', [w.info.muxingApp, w.info.writingApp].filter(Boolean).join(' / ')]);
  out.extra.push(['vp.i.seekable', w.hasCues && w.hasDuration ? 'yes' : 'no']);
  out.demux = {};
  for (const t of w.tracks) {
    out.tracks.push({
      type: t.type, codec: t.codec, codecName: t.codecName, width: t.width, height: t.height, fps: t.frameRate || (t.defaultDuration ? 1e9 / t.defaultDuration : 0),
      sampleRate: t.sampleRate, channels: t.channels, bitDepth: t.bitDepth, bitrate: t.bitrate, language: t.language, frames: t.frames,
    });
    if ((t.type === 'video' || t.type === 'audio') && !out.demux[t.type]) {
      out.demux[t.type] = { config: webmConfig(t), samples: w.frames.filter((f) => f.track === t.number) };
    }
  }
}

// The major brand distinguishes QuickTime ('qt  ') and M4A audio from plain MP4. Creation dates use the 1904 epoch
// in MP4; a value at or before 1970 means "not set" and is hidden.
function readMp4(b, out) {
  const m = parseMp4(b);
  const major = m.brands?.major || '';
  out.label = major === 'qt  ' ? 'QuickTime' : /^M4A/.test(major) ? 'MPEG-4 audio' : 'MP4';
  out.duration = m.duration;
  Object.assign(out.meta, m.metadata);
  out.cover = m.cover;
  if (m.brands) out.extra.push(['vp.i.brands', [m.brands.major, ...m.brands.compatible].map((s) => s.trim()).filter((v, i, a) => a.indexOf(v) === i).join(', ')]);
  if (m.fragmented) out.extra.push(['vp.i.fragmented', 'yes']);
  if (m.created && m.created.getUTCFullYear() > 1970) out.extra.push(['vp.i.created', m.created.toISOString().slice(0, 19).replace('T', ' ')]);
  out.demux = {};
  for (const t of m.tracks) {
    out.tracks.push({
      type: t.type, codec: t.codec, codecName: t.codecName || codecName(t.codec), width: t.width, height: t.height, fps: t.frameRate,
      sampleRate: t.sampleRate, channels: t.channels, bitDepth: t.type === 'video' ? t.bitDepth : t.sampleSize, bitrate: t.bitrate,
      language: t.language, frames: t.samples.length, rotation: t.rotation,
    });
    if ((t.type === 'video' || t.type === 'audio') && !out.demux[t.type] && t.samples.length) {
      out.demux[t.type] = { config: mp4Config(t), samples: t.samples.map((s) => ({ timestamp: s.timestamp, duration: s.durationUs, keyframe: s.keyframe, data: s.data })).filter((s) => s.data) };
    }
  }
}

function readOgg(b, out) {
  const o = readOggInfo(b);
  out.duration = o.duration;
  Object.assign(out.meta, o.tags);
  for (const s of o.streams) {
    const video = s.codec === 'theora';
    out.tracks.push({ type: video ? 'video' : 'audio', codec: s.codec, codecName: codecName(s.codec), width: s.width, height: s.height, sampleRate: s.sampleRate, channels: s.channels, bitrate: s.bitrate });
    if (s.vendor) out.extra.push(['vp.i.vendor', s.vendor]);
    if (s.pictures?.length && !out.cover) out.cover = { mime: s.pictures[0].mime, data: s.pictures[0].data };
  }
}

function readWav(b, out) {
  const w = parseWav(b);
  out.duration = w.duration;
  Object.assign(out.meta, w.info);
  const codec = w.format === 'float' ? 'pcm-f' + w.bitsPerSample : w.format === 'pcm' ? 'pcm-s' + w.bitsPerSample : w.format;
  out.tracks.push({ type: 'audio', codec, codecName: w.format === 'alaw' ? 'G.711 A-law' : w.format === 'mulaw' ? 'G.711 µ-law' : 'PCM', sampleRate: w.sampleRate, channels: w.channels, bitDepth: w.bitsPerSample, bitrate: w.byteRate * 8 });
  if (w.extensible) out.extra.push(['vp.i.format', 'WAVE_FORMAT_EXTENSIBLE']);
}

// ID3v2 (start) wins over ID3v1 (last 128 bytes) where both exist; the free-form "user" frames are dropped. CBR vs
// VBR comes from the Xing / VBRI header scan.
function readMp3(b, out) {
  const s = scanMp3(b);
  out.duration = s.duration;
  out.bitrate = s.bitrate * 1000;
  const v2 = readId3v2(b), v1 = readId3v1(b);
  Object.assign(out.meta, v1 || {}, v2?.tags || {});
  delete out.meta.user;
  if (v2?.pictures?.length) out.cover = { mime: v2.pictures[0].mime, data: v2.pictures[0].data };
  if (v2) out.extra.push(['vp.i.tag', `ID3v2.${v2.version[0]}` + (v1 ? ' + ID3v1' : '')]);
  else if (v1) out.extra.push(['vp.i.tag', 'ID3v1']);
  out.extra.push(['vp.i.mode', `MPEG-${s.version} Layer ${'I'.repeat(s.layer)}, ${s.mode}` + (s.vbr ? `, ${s.vbr.type}` : '') + (s.cbr ? ', CBR' : ', VBR')]);
  if (s.vbr?.encoder) out.extra.push(['vp.i.encoder', s.vbr.encoder]);
  out.tracks.push({ type: 'audio', codec: 'mp3', codecName: 'MP3', sampleRate: s.sampleRate, channels: s.channels, bitrate: s.bitrate * 1000, frames: s.frames });
}

// STREAMINFO bit layout (after the 4-byte magic and 4-byte block header, offset 8): sample rate 20 bits, channels
// 3 bits (stored minus 1), bits per sample 5 bits (minus 1), total samples 36 bits. 36 bits exceed 32-bit integer
// ops, so the top 4 bits are multiplied by 2^32 in floating point; `>>> 0` keeps the byte<<24 term unsigned.
function readFlac(b, out) {
  // STREAMINFO is the first metadata block after 'fLaC'.
  const o = 8;
  const rate = (b[o + 10] << 12) | (b[o + 11] << 4) | (b[o + 12] >> 4);
  const channels = ((b[o + 12] >> 1) & 7) + 1;
  const bits = (((b[o + 12] & 1) << 4) | (b[o + 13] >> 4)) + 1;
  const total = (b[o + 13] & 15) * 4294967296 + ((b[o + 14] << 24) >>> 0) + (b[o + 15] << 16) + (b[o + 16] << 8) + b[o + 17];
  out.duration = rate ? total / rate : 0;
  out.tracks.push({ type: 'audio', codec: 'flac', codecName: 'FLAC', sampleRate: rate, channels, bitDepth: bits });
}
