// mediatags/read.js - embedded tags and stream information of a media file, reading only what it needs: headers,
// ID3v2 at the start / ID3v1 and APEv2 at the end, MP4 moov wherever it is, FLAC metadata blocks, Ogg header pages and
// the last page, Matroska elements through the SeekHead, WAV / AIFF chunk headers with LIST/INFO and ID3 chunks.
// Every read is bounded (ID3v2 and moov <= 64 MB, Matroska elements <= 16 MB, attachments <= 8 MB).
//
//   readMedia(src, { name = '', cover = true }) -> Promise<MediaInfo>
//     src: a source (source.js), Uint8Array, ArrayBuffer or Blob; other sources are wrapped in cachedSource().
//   readMediaSync(bytes, { name, cover }) -> MediaInfo
//   MediaInfo = {
//     container ('mp3' | 'flac' | 'ogg' | 'mp4' | 'mov' | 'webm' | 'mkv' | 'wav' | 'aiff' | 'aac' | image containers
//       | null), kind ('audio' | 'video' | null), mime, duration (s) | null, bitrate (kbps) | null,
//     audio: { codec, sampleRate, channels, bitsPerSample } | null, video: { codec, width, height, fps } | null,
//     streams: [{ index, type ('audio' | 'video' | 'subtitle' | 'attachment' | 'data'), codec, lang, title, default,
//       forced, channels?, width?, height? }],
//     tags (fields.js normalizeTags: absent keys omitted), replaygain | null, syncedLyrics (LRC) | null,
//     chapters: [{ start, end, title }], cover: { mime, data, description, type } | null (front cover preferred),
//     pictures (number of embedded pictures), warnings: [], image?: { width, height } (image files) }
//   With cover: false no picture data is read where the format allows it (FLAC, Matroska); `pictures` still counts.
//   Container errors become warnings; a failing read of the source rejects.

//
// Architecture: one generator per container produces a "raw" record (pairs in the fields.js vocabulary, pictures,
// stream facts, warnings); finish() merges tag layers and normalises. Readers never build MediaInfo themselves, so
// the output shape and the precedence rules live in exactly one place.
// Tag precedence (finish + tailTags): native container tags > ID3v2 > APEv2 > ID3v1 for FLAC (Vorbis comments are
// authoritative there); for MPEG / WAV / AIFF the ID3v2 tag is the primary layer and the others only fill gaps.
// Error model: a parser exception becomes a warning and an empty raw record (the caller still gets kind/mime from what
// was detected); a SOURCE read failure is not caught here (runAsync closes the flow and rejects), because a network
// error must not masquerade as "file has no tags".
import { id3v2Size, readId3v1 } from '../mp3/id3.js';
import { findFrame, parseFrameHeader, readVbrHeader } from '../mp3/frame.js';
import { INFO_TAGS } from '../wav/wav.js';
import { asBytes, asSource, cachedSource, runAsync, runSync } from './source.js';
import { containerOf, extOf } from './detect.js';
import { normalizeTags, vocabKey } from './fields.js';
import { apeTagSize, readApe, readId3Frames } from './id3frames.js';
import { flacFlow } from './flac.js';
import { oggFlow } from './oggmeta.js';
import { mp4Flow } from './mp4meta.js';
import { coverAttachment, matroskaFlow, matroskaPairs } from './mkv.js';

// 64 MB: ID3v2 can legally reach 256 MB, but anything this large is a broken size field or a hostile file.
const MAX_ID3 = 64 << 20;
const ascii = (b, o, n) => { let s = ''; for (let i = 0; i < n && o + i < b.length; i++) s += String.fromCharCode(b[o + i]); return s; };
const le16 = (b, p) => b[p] | (b[p + 1] << 8);
const le32 = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
const be16 = (b, p) => (b[p] << 8) | b[p + 1];
const be32 = (b, p) => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;

const MIME = {
  mp3: 'audio/mpeg', flac: 'audio/flac', wav: 'audio/wav', aiff: 'audio/aiff', aac: 'audio/aac', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', heic: 'image/heic', avi: 'video/x-msvideo', ts: 'video/mp2t',
  asf: 'video/x-ms-asf', flv: 'video/x-flv', ape: 'audio/x-ape', wv: 'audio/x-wavpack',
};
// Image containers get only dimensions (imageFlow); they are recognised so a library scan does not warn on covers.
const IMAGES = new Set(['jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'heic']);

const emptyRaw = (container) => ({
  container, duration: null, bitrate: null, audio: null, video: null, streams: [], pairs: [], pictures: [], pictureCount: 0, chapters: [],
  warnings: [], mime: null,
});

// Compared through vocabKey so 'YEAR' from ID3v1 does not duplicate 'DATE' from ID3v2.
// Pairs of `more` whose keys are not in `pairs` yet (ID3v1 / APE under ID3v2).
function fillMissing(pairs, more) {
  const have = new Set(pairs.map(([k]) => vocabKey(k)));
  for (const [k, v] of more) if (!have.has(vocabKey(k))) pairs.push([k, v]);
}

function v1Pairs(v1) {
  const m = { title: 'TITLE', artist: 'ARTIST', album: 'ALBUM', year: 'DATE', comment: 'COMMENT', track: 'TRACKNUMBER', genre: 'GENRE' };
  return Object.entries(v1 || {}).filter(([k, v]) => m[k] && v).map(([k, v]) => [m[k], v]);
}

// One 160-byte tail read covers ID3v1 (last 128) plus an APE footer (32) just before it. The APE tag is read only if
// its declared size fits between the audio start and the tail (and < 16 MB). `end` is the true audio end, which the
// CBR duration estimate needs (tags at the end would otherwise count as audio).
// ID3v1 / APEv2 at the end of an MPEG / ADTS stream: { end (audio end), pairs, pictures, pictureCount }.
function* tailTags(size, start, cover) {
  const out = { end: size, pairs: [], pictures: [], pictureCount: 0 };
  const n = Math.min(size - start, 160);
  if (n <= 0) return out;
  const tail = yield [size - n, n];
  let v1 = null;
  if (tail.length >= 128) { v1 = readId3v1(tail); if (v1) out.end -= 128; }
  const before = tail.subarray(0, tail.length - (v1 ? 128 : 0));
  const apeSize = before.length >= 32 ? apeTagSize(before.subarray(before.length - 32)) : 0;
  if (apeSize && apeSize <= out.end - start && apeSize < (16 << 20)) {
    const ape = yield [out.end - apeSize, apeSize];
    const r = readApe(ape, { cover });
    if (r) { out.pairs.push(...r.pairs); out.pictures.push(...r.pictures); out.pictureCount += r.pictureCount; }
    out.end -= apeSize;
  }
  fillMissing(out.pairs, v1Pairs(v1));
  return out;
}

// --- MPEG audio / ADTS ---------------------------------------------------------------------------

// MPEG audio duration: with a Xing / Info / VBRI header the frame count is exact (minus LAME encoder delay and
// padding for gapless duration); without one the stream is assumed CBR and duration = audio bytes / byte rate. The
// VBR header frame itself carries no audio, so its size is excluded. 128 KB is enough to skip junk before the first
// frame (findFrame validates sync). frameSeconds is exported for ID3 SYLT timestamps in MPEG-frame units.
function* mp3Flow(size, off, cover) {
  const raw = emptyRaw('mp3');
  const chunk = yield [off, 128 << 10];
  const p = findFrame(chunk, 0);
  if (p < 0) { raw.warnings.push('no MPEG audio frames found'); return raw; }
  const h = parseFrameHeader(chunk, p);
  const vbr = readVbrHeader(chunk, p, h);
  const start = off + p;
  const t = yield* tailTags(size, start, cover);
  raw.pairs.push(...t.pairs);
  raw.pictures.push(...t.pictures);
  raw.pictureCount += t.pictureCount;
  const bytes = Math.max(0, t.end - start - (vbr ? h.frameSize : 0));
  const codec = h.layer === 3 ? 'mp3' : h.layer === 2 ? 'mp2' : 'mp1';
  if (vbr && vbr.frames) {
    let samples = vbr.frames * h.samples;
    if (vbr.encoderDelay != null) samples -= vbr.encoderDelay + vbr.encoderPadding;
    raw.duration = Math.max(0, samples) / h.sampleRate;
    const b = vbr.bytes && vbr.bytes <= t.end - start ? vbr.bytes : bytes;
    raw.bitrate = raw.duration ? Math.round((b * 8) / raw.duration / 1000) : h.bitrate;
  } else {
    raw.duration = bytes / ((h.bitrate * 1000) / 8);
    raw.bitrate = h.bitrate;
  }
  raw.audio = { codec, sampleRate: h.sampleRate, channels: h.channels, bitsPerSample: null };
  raw.streams.push({ index: 0, type: 'audio', codec, lang: null, title: null, default: true, forced: false, channels: h.channels });
  raw.frameSeconds = h.samples / h.sampleRate;
  raw.mime = 'audio/mpeg';
  return raw;
}

// ADTS sampling_frequency_index table (ISO 14496-3); 13..15 are reserved.
const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

// ADTS has no index or total: walk up to 2000 frames from the head (frame length is a 13-bit field), then extrapolate
// frames-per-byte to the whole audio range. Each frame holds (raw_data_blocks + 1) * 1024 samples. Profile = object
// type - 1 in the header, so ot = profile + 1 (2 = AAC LC).
function* adtsFlow(size, off, cover) {
  const raw = emptyRaw('aac');
  const c = yield [off, 256 << 10];
  const t = yield* tailTags(size, off, cover);
  raw.pairs.push(...t.pairs);
  raw.pictures.push(...t.pictures);
  raw.pictureCount += t.pictureCount;
  let p = 0, frames = 0, bytes = 0, blocks = 0, rate = 0, ch = 0, ot = 2;
  while (p + 7 <= c.length && frames < 2000) {
    if (c[p] !== 0xff || (c[p + 1] & 0xf6) !== 0xf0) break;
    const len = ((c[p + 3] & 3) << 11) | (c[p + 4] << 3) | (c[p + 5] >> 5);
    if (len < 7) break;
    if (!frames) { ot = ((c[p + 2] >> 6) & 3) + 1; rate = AAC_RATES[(c[p + 2] >> 2) & 15] || 0; ch = ((c[p + 2] & 1) << 2) | (c[p + 3] >> 6); }
    frames++;
    bytes += len;
    blocks += (c[p + 6] & 3) + 1;
    p += len;
  }
  if (!frames || !rate) { raw.warnings.push('no ADTS frames found'); return raw; }
  const total = t.end - off;
  const estFrames = (total / bytes) * blocks;
  raw.duration = (estFrames * 1024) / rate;
  raw.bitrate = Math.round((total * 8) / raw.duration / 1000);
  raw.audio = { codec: 'aac', sampleRate: rate, channels: ch || null, bitsPerSample: null };
  raw.streams.push({ index: 0, type: 'audio', codec: 'aac', lang: null, title: null, default: true, forced: false, channels: ch || null, profile: ot });
  raw.mime = 'audio/aac';
  return raw;
}

// --- FLAC ----------------------------------------------------------------------------------------

// Pictures: PICTURE blocks first (unshift; the standard place), then METADATA_BLOCK_PICTURE comments (a Vorbis-ism
// some taggers also write into FLAC). Bitrate counts only audio bytes after the metadata blocks.
function* flacMedia(size, off, cover) {
  const raw = emptyRaw('flac');
  const m = yield* flacFlow(off, size, { pictures: cover ? 'best' : 'none' });
  raw.warnings.push(...m.warnings);
  if (m.tags) {
    for (const [k, v] of m.tags.comments) if (k !== 'METADATA_BLOCK_PICTURE') raw.pairs.push([k, v]);
    raw.pictureCount += m.tags.pictures.length;
    if (cover) raw.pictures.push(...m.tags.pictures);
  }
  raw.pictures.unshift(...m.pictures);
  raw.pictureCount += m.pictureCount;
  const si = m.streamInfo;
  if (si) {
    raw.duration = si.duration;
    raw.audio = { codec: 'flac', sampleRate: si.sampleRate, channels: si.channels, bitsPerSample: si.bitsPerSample };
    raw.streams.push({ index: 0, type: 'audio', codec: 'flac', lang: null, title: null, default: true, forced: false, channels: si.channels });
    if (raw.duration) raw.bitrate = Math.round(((size - m.audioOffset) * 8) / raw.duration / 1000);
  } else raw.warnings.push('FLAC without STREAMINFO');
  // Track 170 (CD) / 255 (non-CD) is the lead-out, not a track. Chapters are built only when titles exist: a bare
  // CD-rip CUESHEET without titles would yield 'Track N' noise. Track offset + INDEX 01 offset, both in samples.
  // CUESHEET block + CUE_TRACKnn_TITLE comments -> chapters
  if (m.cuesheet && si && si.sampleRate) {
    const titles = new Map();
    for (const [k, v] of raw.pairs) { const x = /^CUE_TRACK(\d+)_TITLE$/.exec(k); if (x) titles.set(+x[1], v); }
    if (titles.size) {
      for (const tr of m.cuesheet.tracks) {
        if (tr.number === 170 || tr.number === 255 || !titles.has(tr.number)) continue;
        const i1 = tr.indices.find((x) => x.number === 1) || tr.indices[0];
        raw.chapters.push({ start: (tr.offset + (i1 ? i1.offset : 0)) / si.sampleRate, end: null, title: titles.get(tr.number) });
      }
    }
  }
  raw.mime = 'audio/flac';
  return raw;
}

// --- Matroska ------------------------------------------------------------------------------------

// Attachments are listed as streams (as ffprobe does), so a UI can show fonts / images. The representative audio / video
// track is the default+enabled one, else the first of its type.
function* mkvMedia(size, cover) {
  const meta = yield* matroskaFlow(size, { data: cover ? 'cover' : 'none' });
  const raw = emptyRaw(meta.docType === 'webm' ? 'webm' : 'mkv');
  raw.warnings.push(...meta.warnings);
  raw.duration = meta.duration;
  const tracks = meta.tracks;
  tracks.forEach((t, i) => {
    const type = t.type === 'video' || t.type === 'audio' || t.type === 'subtitle' ? t.type : 'data';
    const st = { index: i, type, codec: t.codec, lang: t.lang && t.lang !== 'und' ? t.lang : null, title: t.name || null, default: t.default, forced: t.forced };
    if (type === 'audio') st.channels = t.channels || null;
    if (type === 'video') { st.width = t.width || null; st.height = t.height || null; }
    raw.streams.push(st);
  });
  meta.attachments.forEach((a, i) => raw.streams.push({
    index: tracks.length + i, type: 'attachment', codec: a.mime || null, lang: null, title: a.name || null, default: false, forced: false,
  }));
  const pick = (type) => tracks.find((t) => t.type === type && t.default && t.enabled) || tracks.find((t) => t.type === type);
  const a = pick('audio'), v = pick('video');
  if (a) raw.audio = { codec: a.codec, sampleRate: a.sampleRate || null, channels: a.channels || null, bitsPerSample: a.bitDepth || null };
  if (v) raw.video = { codec: v.codec, width: v.width || null, height: v.height || null, fps: v.fps || null };
  raw.pairs.push(...matroskaPairs(meta));
  const isImg = (x) => /^image\//.test(x.mime || '') || /\.(jpe?g|png|webp|gif|bmp)$/i.test(x.name || '');
  raw.pictureCount = meta.attachments.filter(isImg).length;
  const ci = coverAttachment(meta.attachments);
  if (cover && ci >= 0 && meta.attachments[ci].data) {
    const c = meta.attachments[ci];
    raw.pictures.push({ mime: c.mime || 'image/jpeg', data: c.data, description: c.description || c.name || '', type: 3 });
  }
  raw.chapters = meta.chapters.map((c) => ({ start: c.start, end: c.end, title: c.title }));
  const webm = raw.container === 'webm';
  raw.mime = v ? (webm ? 'video/webm' : 'video/x-matroska') : webm ? 'audio/webm' : 'audio/x-matroska';
  return raw;
}

// --- WAV / AIFF ----------------------------------------------------------------------------------

// RIFF INFO ids -> vocabulary, from wav/wav.js plus ids used by other writers (IPRT track, IMUS composer, ...).
const WAV_INFO = Object.fromEntries(Object.entries(INFO_TAGS).map(([k, id]) => [id, k === 'software' ? 'ENCODER' : vocabKey(k)]));
Object.assign(WAV_INFO, { IPRT: 'TRACKNUMBER', IMUS: 'COMPOSER', IWRI: 'LYRICIST', ILNG: 'LANGUAGE', IBPM: 'BPM', ICNT: 'COUNTRY' });

// RIFF INFO has no declared encoding: try strict UTF-8 first (modern writers), fall back to Latin-1 byte codes
// (legacy writers); fatal:true is what makes the fallback detectable. Trailing NUL padding stripped first.
function infoText(bytes) {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  const b = bytes.subarray(0, end);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return String.fromCharCode(...b); }
}

// WAVE format tags; 0xFFFE (WAVE_FORMAT_EXTENSIBLE) is resolved to the sub-format GUID's first two bytes below.
const WAV_CODECS = { 1: 'pcm', 3: 'pcm', 6: 'alaw', 7: 'mulaw', 2: 'adpcm', 0x11: 'adpcm', 0x55: 'mp3', 0x50: 'mp2', 0xff: 'aac', 0x2000: 'ac3', 0x2001: 'dts' };

// Chunk walk by 8-byte headers; chunks are word-aligned (odd sizes padded by one byte). RF64 / BW64: the data size
// field is 0xFFFFFFFF and the real 64-bit size comes from ds64. A data size of 0 or past EOF (streamed recording,
// truncated file) is replaced by "to the end". ID3 chunks (both spellings in the wild) are handed to the ID3 reader.
function* wavFlow(size) {
  const raw = emptyRaw('wav');
  let p = 12, fmt = null, dataOffset = -1, dataSize = 0, ds64 = null;
  for (let n = 0; p + 8 <= size && n < 10000; n++) {
    const c = yield [p, 8];
    if (c.length < 8) break;
    const id = ascii(c, 0, 4);
    let len = le32(c, 4);
    if (id === 'ds64') {
      const d = yield [p + 8, Math.min(len, 64)];
      ds64 = { data: le32(d, 8) + le32(d, 12) * 4294967296 };
    } else if (id === 'fmt ') {
      const f = yield [p + 8, Math.min(len, 1024)];
      fmt = { tag: le16(f, 0), channels: le16(f, 2), rate: le32(f, 4), byteRate: le32(f, 8), align: le16(f, 12), bits: le16(f, 14) };
      if (fmt.tag === 0xfffe && f.length >= 26) fmt.tag = le16(f, 24);
    } else if (id === 'LIST' && len >= 4) {
      const t = yield [p + 8, 4];
      if (ascii(t, 0, 4) === 'INFO') {
        const body = yield [p + 12, Math.min(len - 4, 1 << 20)];
        for (let q = 0; q + 8 <= body.length;) {
          const tid = ascii(body, q, 4), tsz = le32(body, q + 4);
          const text = infoText(body.subarray(q + 8, Math.min(body.length, q + 8 + tsz))).trim();
          if (text) raw.pairs.push([WAV_INFO[tid] || tid, text]);
          q += 8 + tsz + (tsz & 1);
        }
      }
    } else if (id === 'id3 ' || id === 'ID3 ') {
      if (len <= MAX_ID3) raw.id3Bytes = yield [p + 8, len];
    } else if (id === 'data') {
      dataOffset = p + 8;
      if (len === 0xffffffff && ds64) len = ds64.data;
      if (len === 0 || dataOffset + len > size) len = size - dataOffset;
      dataSize = len;
    }
    p += 8 + len + (len & 1);
  }
  if (!fmt) { raw.warnings.push('WAV: no fmt chunk'); return raw; }
  if (dataOffset < 0) raw.warnings.push('WAV: no data chunk');
  const codec = WAV_CODECS[fmt.tag] || `0x${fmt.tag.toString(16)}`;
  raw.audio = { codec, sampleRate: fmt.rate, channels: fmt.channels, bitsPerSample: codec === 'pcm' ? fmt.bits : null };
  raw.streams.push({ index: 0, type: 'audio', codec, lang: null, title: null, default: true, forced: false, channels: fmt.channels });
  if (fmt.byteRate) { raw.duration = dataSize / fmt.byteRate; raw.bitrate = Math.round((fmt.byteRate * 8) / 1000); }
  raw.mime = 'audio/wav';
  return raw;
}

// IEEE 754 80-bit extended (AIFF sample rate): sign, 15-bit exponent (bias 16383), 64-bit mantissa WITH an explicit
// integer bit, so value = m * 2^(e - 16383 - 63). Computed in a double: exact for every real sample rate.
function ext80(b, p) {
  const e = ((b[p] & 0x7f) << 8) | b[p + 1];
  const m = be32(b, p + 2) * 4294967296 + be32(b, p + 6);
  if (!e && !m) return 0;
  return (b[p] & 0x80 ? -1 : 1) * m * 2 ** (e - 16383 - 63);
}

// AIFF text chunks; '(c) ' is the copyright chunk id, literally parenthesis-c-parenthesis-space.
const AIFF_TEXT = { NAME: 'TITLE', AUTH: 'ARTIST', '(c) ': 'COPYRIGHT', ANNO: 'COMMENT' };

// AIFF is big-endian. AIFC adds a compression fourcc to COMM; 'sowt' (little-endian PCM) and the float/int ids are
// still PCM. NONE is the plain AIFF default.
function* aiffFlow(size) {
  const raw = emptyRaw('aiff');
  const h = yield [0, 12];
  const aifc = ascii(h, 8, 4) === 'AIFC';
  let p = 12, comm = null;
  for (let n = 0; p + 8 <= size && n < 10000; n++) {
    const c = yield [p, 8];
    if (c.length < 8) break;
    const id = ascii(c, 0, 4), len = be32(c, 4);
    if (id === 'COMM') {
      const b = yield [p + 8, Math.min(len, 256)];
      comm = { channels: be16(b, 0), frames: be32(b, 2), bits: be16(b, 6), rate: ext80(b, 8), compression: aifc && b.length >= 22 ? ascii(b, 18, 4) : 'NONE' };
    } else if (id === 'ID3 ' || id === 'id3 ') { if (len <= MAX_ID3) raw.id3Bytes = yield [p + 8, len]; }
    else if (AIFF_TEXT[id] && len < 65536) {
      const b = yield [p + 8, len];
      const text = infoText(b).trim();
      if (text) raw.pairs.push([AIFF_TEXT[id], text]);
    }
    p += 8 + len + (len & 1);
  }
  if (!comm) { raw.warnings.push('AIFF: no COMM chunk'); return raw; }
  const cmp = comm.compression;
  const codec = /^(NONE|sowt|twos|raw |in24|in32|fl32|fl64|FL32|FL64)$/.test(cmp) ? 'pcm' : cmp.trim().toLowerCase();
  raw.audio = { codec, sampleRate: Math.round(comm.rate), channels: comm.channels, bitsPerSample: codec === 'pcm' ? comm.bits : null };
  raw.streams.push({ index: 0, type: 'audio', codec, lang: null, title: null, default: true, forced: false, channels: comm.channels });
  if (comm.rate) raw.duration = comm.frames / comm.rate;
  if (codec === 'pcm') raw.bitrate = Math.round((comm.rate * comm.channels * comm.bits) / 1000);
  raw.mime = 'audio/aiff';
  return raw;
}

// --- images --------------------------------------------------------------------------------------

// Dimensions from fixed header offsets (PNG IHDR, GIF logical screen, BMP DIB with negative height = top-down, the three
// WebP variants). JPEG needs a marker walk to the first SOFn (C0..CF except C4 DHT, C8 JPG, CC DAC); standalone markers
// (D8, 01, RST) have no length. Stops at SOS / EOI.
// KNOWN DEFECT: JPEG fill bytes (0xFF 0xFF ... before a marker, allowed by ITU T.81 B.1.1.2) are not skipped; the
// walk then reads a garbage length and loses the SOF. Fix: while m[1] === 0xff advance p by 1 before dispatching.
function* imageFlow(container) {
  const raw = emptyRaw(container);
  const b = yield [0, 64];
  let w = null, h = null;
  if (container === 'png' && ascii(b, 12, 4) === 'IHDR') { w = be32(b, 16); h = be32(b, 20); }
  else if (container === 'gif') { w = le16(b, 6); h = le16(b, 8); }
  else if (container === 'bmp') { w = le32(b, 18); h = Math.abs(le32(b, 22) | 0); }
  else if (container === 'webp') {
    const k = ascii(b, 12, 4);
    if (k === 'VP8 ') { w = le16(b, 26) & 0x3fff; h = le16(b, 28) & 0x3fff; }
    else if (k === 'VP8L') { w = 1 + (((b[22] & 0x3f) << 8) | b[21]); h = 1 + (((b[24] & 0xf) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)); }
    else if (k === 'VP8X') { w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16)); h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16)); }
  } else if (container === 'jpeg') {
    let p = 2;
    for (let n = 0; n < 256; n++) {
      const m = yield [p, 9];
      if (m.length < 4 || m[0] !== 0xff) break;
      const mk = m[1];
      if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7)) { p += 2; continue; }
      if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) { h = be16(m, 5); w = be16(m, 7); break; }
      if (mk === 0xd9 || mk === 0xda) break;
      p += 2 + be16(m, 2);
    }
  }
  raw.image = { width: w, height: h };
  raw.mime = MIME[container];
  return raw;
}

// --- assembly ------------------------------------------------------------------------------------

// Front cover (type 3) first, then 'other' / 'file icon' / untyped (often the only picture), then anything.
function pickCover(pictures) {
  if (!pictures.length) return null;
  const p = pictures.find((x) => x.type === 3) || pictures.find((x) => x.type === 0 || x.type === 2 || x.type == null) || pictures[0];
  return { mime: p.mime || 'image/jpeg', data: p.data, description: p.description || '', type: p.type ?? 0 };
}

// Merges ID3 (from the file head or a WAV/AIFF chunk) with the container's own pairs. Duration is rounded to the
// microsecond and anything non-finite or ~0 becomes null. Chapter ends are filled from the next start / the duration.
// Bitrate fallback is file size / duration (includes tag bytes: an approximation, only when the reader had none).
function finish(raw, size, id3) {
  if (id3) {
    const vorbisLike = raw.container === 'flac';
    if (!vorbisLike || !raw.pairs.length) {
      const own = raw.pairs;
      raw.pairs = [...id3.pairs];
      fillMissing(raw.pairs, own);
    }
    if (!raw.pictures.length) raw.pictures.push(...id3.pictures);
    raw.pictureCount += id3.pictureCount;
    if (!raw.chapters.length) raw.chapters = id3.chapters;
    if (id3.syncedLyrics) raw.pairs.push(['_SYNCEDLYRICS', id3.syncedLyrics]);
  }
  const n = normalizeTags(raw.pairs);
  const duration = raw.duration != null && Number.isFinite(raw.duration) && raw.duration >= 1e-6 ? Math.round(raw.duration * 1e6) / 1e6 : null;
  const chapters = (raw.chapters && raw.chapters.length ? raw.chapters : n.chapters)
    .filter((c) => c && Number.isFinite(c.start))
    .map((c) => ({ start: c.start, end: c.end ?? null, title: c.title ?? '' }))
    .sort((a, b) => a.start - b.start);
  chapters.forEach((c, i) => { if (c.end == null) c.end = i + 1 < chapters.length ? chapters[i + 1].start : duration; });
  const kind = raw.video ? 'video' : raw.audio ? 'audio' : null;
  let bitrate = raw.bitrate != null ? Math.round(raw.bitrate) : duration && kind ? Math.round((size * 8) / duration / 1000) : null;
  if (!Number.isFinite(bitrate) || bitrate < 0) bitrate = null;
  const out = {
    container: raw.container, kind, mime: raw.mime || MIME[raw.container] || null, duration, bitrate,
    audio: raw.audio, video: raw.video, streams: raw.streams, tags: n.tags, replaygain: n.replaygain, syncedLyrics: n.syncedLyrics,
    chapters, cover: pickCover(raw.pictures), pictures: raw.pictureCount, warnings: raw.warnings,
  };
  if (raw.image) out.image = raw.image;
  return out;
}

// Entry flow. Skips up to 8 stacked ID3v2 tags (taggers that prepend instead of replacing), keeps the first, then
// skips zero padding that some writers put after a tag's declared size. Unknown bytes after an ID3 tag, or a .mp3
// name, default to MP3: ID3v2 is almost exclusively an MPEG-audio prefix and findFrame will confirm or warn.
function* mediaFlow(size, { name = '', cover = true } = {}) {
  const pre = [];
  let off = 0, id3Bytes = null;
  let head = yield [0, 4096];
  for (let i = 0; i < 8; i++) {
    const n = id3v2Size(head);
    if (!n) break;
    if (n > MAX_ID3) pre.push('ID3v2 tag too large: skipped');
    else if (!id3Bytes) id3Bytes = n <= head.length ? head.subarray(0, n) : yield [off, n];
    off += n;
    head = yield [off, 4096];
  }
  let z = 0;
  while (off && z < head.length && head[z] === 0) z++;
  if (z && z < head.length) { off += z; head = head.subarray(z); }
  let container = containerOf(head);
  if (!container && (off > 0 || extOf(name) === 'mp3')) container = 'mp3';
  let raw;
  try {
    switch (container) {
      case 'mp3': raw = yield* mp3Flow(size, off, cover); break;
      case 'aac': raw = yield* adtsFlow(size, off, cover); break;
      case 'flac': raw = yield* flacMedia(size, off, cover); break;
      case 'ogg': raw = yield* oggFlow(size, { cover }); break;
      case 'mp4': raw = yield* mp4Flow(size, { cover }); break;
      case 'webm': case 'mkv': raw = yield* mkvMedia(size, cover); break;
      case 'wav': raw = yield* wavFlow(size); break;
      case 'aiff': raw = yield* aiffFlow(size); break;
      default:
        if (IMAGES.has(container)) raw = yield* imageFlow(container);
        else { raw = emptyRaw(container); raw.warnings.push(container ? `unsupported container: ${container}` : 'unrecognized format'); }
    }
  } catch (e) {
    raw = emptyRaw(container);
    raw.warnings.push(String((e && e.message) || e));
  }
  raw.warnings.unshift(...pre);
  let id3 = null;
  const tagBytes = raw.id3Bytes || id3Bytes;
  if (tagBytes) {
    try { id3 = readId3Frames(tagBytes, { cover, frameSeconds: raw.frameSeconds }); } catch (e) { raw.warnings.push('malformed ID3v2 tag'); }
  }
  return finish(raw, size, id3);
}

/** Tags and stream information of a media source (see the header). */
// In-memory input skips the async machinery entirely (same flow, runSync). Real sources get the block cache:
// container walks issue many tiny header reads that share blocks.
export async function readMedia(input, opts = {}) {
  const src = asSource(input);
  if (src.bytes) return readMediaSync(src.bytes, opts);
  return runAsync(mediaFlow(src.size, opts), cachedSource(src));
}

/** Same as readMedia for bytes in memory. */
export function readMediaSync(bytes, opts = {}) {
  const b = asBytes(bytes);
  return runSync(mediaFlow(b.length, opts), b);
}
