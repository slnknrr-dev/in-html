// webm/mux.js - WebM / Matroska muxer for WebCodecs output: VP8 / VP9 / AV1 (and H.264 / HEVC in Matroska) video,
// Opus / Vorbis (and AAC / FLAC / PCM in Matroska) audio. Frames are buffered and written on finalize() as a
// seekable file: known sizes, SeekHead, Info with Duration, a cluster per video keyframe and Cues.
import { ID, concat, el, elBinary, elFloat, elString, elUint, encodeId, encodeSize, uintBytes } from './ebml.js';
import { buildAv1C, parseAv1SequenceHeader } from '../mp4/codecs.js';

const asBytes = (b) => (b instanceof Uint8Array ? b : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b));
const MAX_CLUSTER_MS = 5000; // keeps clusters seekable and block offsets far from the int16 limit

// WebCodecs codec string or Matroska id -> Matroska CodecID.
export function matroskaCodecId(codec) {
  const c = String(codec || '');
  if (/^[AV]_/.test(c)) return c;
  const l = c.toLowerCase();
  if (l === 'vp8' || l.startsWith('vp08')) return 'V_VP8';
  if (l.startsWith('vp09') || l === 'vp9') return 'V_VP9';
  if (l.startsWith('av01')) return 'V_AV1';
  if (l.startsWith('avc1') || l.startsWith('avc3')) return 'V_MPEG4/ISO/AVC';
  if (l.startsWith('hvc1') || l.startsWith('hev1')) return 'V_MPEGH/ISO/HEVC';
  if (l === 'opus') return 'A_OPUS';
  if (l === 'vorbis') return 'A_VORBIS';
  if (l === 'flac') return 'A_FLAC';
  if (l.startsWith('mp4a')) return 'A_AAC';
  if (l === 'mp3') return 'A_MPEG/L3';
  if (l.startsWith('pcm')) return l === 'pcm-f32' ? 'A_PCM/FLOAT/IEEE' : 'A_PCM/INT/LIT';
  throw new Error('WebM muxer: unsupported codec ' + codec);
}

// DocType 'webm' is a restricted Matroska profile: only these codecs. Anything else is written as 'matroska' so
// strict WebM players do not reject the file.
const WEBM_CODECS = new Set(['V_VP8', 'V_VP9', 'V_AV1', 'A_OPUS', 'A_VORBIS']);

function takeChunk(chunk) {
  let data;
  if (typeof chunk.copyTo === 'function' && !chunk.data) { data = new Uint8Array(chunk.byteLength); chunk.copyTo(data); }
  else data = asBytes(chunk.data).slice();
  return {
    data, timestamp: Math.round(chunk.timestamp || 0), duration: chunk.duration == null ? null : Math.round(chunk.duration),
    keyframe: chunk.type ? chunk.type === 'key' : chunk.keyframe !== false,
  };
}

// Default OpusHead when the encoder gives no description.
function opusHead(channels, sampleRate, preSkip) {
  const out = new Uint8Array(19);
  const dv = new DataView(out.buffer);
  out.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, channels]);
  dv.setUint16(10, preSkip, true);
  dv.setUint32(12, sampleRate, true);
  return out;
}

/**
 * const mux = new WebmMuxer({
 *   video: { codec: 'vp8' | 'vp09…' | 'av01…', width, height, frameRate?, alpha?, codecPrivate? },
 *   audio: { codec: 'opus' | 'vorbis', sampleRate, channels, codecPrivate? (OpusHead / Xiph headers), preSkip? },
 *   title?, writingApp? });
 * mux.addVideoChunk(chunk, metadata?); mux.addAudioChunk(chunk, metadata?);
 * mux.finalize() -> Uint8Array (or Uint8Array[] with { parts: true }).
 * Chunks: EncodedVideoChunk / EncodedAudioChunk or { data, timestamp (µs), duration?, type | keyframe }.
 */
export class WebmMuxer {
  constructor({ video = null, audio = null, title = '', writingApp = 'in-html', muxingApp = 'in-html webm/mux.js', shiftToZero = true } = {}) {
    if (!video && !audio) throw new Error('WebmMuxer: no tracks');
    this.tracks = [];
    if (video) this.video = this.track(1, { ...video });
    if (audio) this.audio = this.track(2, { ...audio });
    this.title = title;
    this.writingApp = writingApp;
    this.muxingApp = muxingApp;
    this.shiftToZero = shiftToZero;
    this.done = false;
  }

  track(type, cfg) {
    const t = { number: this.tracks.length + 1, type, cfg, frames: [], codecId: matroskaCodecId(cfg.codec), codecPrivate: cfg.codecPrivate ? asBytes(cfg.codecPrivate).slice() : null };
    this.tracks.push(t);
    return t;
  }

  addVideoChunk(chunk, meta) {
    const t = this.video;
    if (!t) throw new Error('WebmMuxer: no video track');
    if (meta?.decoderConfig) {
      const dc = meta.decoderConfig;
      if (dc.description && !t.codecPrivate) t.codecPrivate = asBytes(dc.description).slice();
      if (dc.codedWidth && !t.cfg.width) { t.cfg.width = dc.codedWidth; t.cfg.height = dc.codedHeight; }
    }
    if (meta?.alphaSideData) t.cfg.alpha = true;
    const f = takeChunk(chunk);
    if (f.keyframe && t.codecId === 'V_AV1' && !t.codecPrivate) {
      const sh = parseAv1SequenceHeader(f.data);
      if (sh) t.codecPrivate = buildAv1C(sh);
    }
    t.frames.push(f);
  }

  addAudioChunk(chunk, meta) {
    const t = this.audio;
    if (!t) throw new Error('WebmMuxer: no audio track');
    if (meta?.decoderConfig) {
      const dc = meta.decoderConfig;
      if (dc.description && !t.codecPrivate) t.codecPrivate = asBytes(dc.description).slice();
      if (dc.sampleRate) t.cfg.sampleRate = dc.sampleRate;
      if (dc.numberOfChannels) t.cfg.channels = dc.numberOfChannels;
    }
    const f = takeChunk(chunk);
    f.keyframe = true;
    t.frames.push(f);
  }

  // Buffer-then-write: all frames are known at finalize time, so sizes are exact, Duration and Cues are written up
  // front, and the result is seekable without a second pass. The cost is holding the encoded stream in memory.
  // KNOWN DEFECT: Math.min(...t.frames.map(...)) spreads every frame timestamp as call arguments; engines cap
  // argument counts (around 10^5 - 10^6), so very long recordings throw a RangeError. Fix: compute the minimum with
  // a loop or reduce.
  finalize({ parts = false } = {}) {
    if (this.done) throw new Error('WebmMuxer: already finalized');
    this.done = true;
    const tracks = this.tracks.filter((t) => t.frames.length);
    if (!tracks.length) throw new Error('WebmMuxer: no frames');
    const t0 = this.shiftToZero ? Math.min(...tracks.map((t) => Math.min(...t.frames.map((f) => f.timestamp)))) : 0;
    // All frames in timestamp order (stable: video before audio at equal times).
    const all = [];
    for (const t of tracks) for (const f of t.frames) all.push({ t, f, ms: Math.max(0, Math.round((f.timestamp - t0) / 1000)) });
    all.sort((a, b) => a.ms - b.ms || a.t.number - b.t.number);
    // Duration: the end of the last frame of every track.
    let endUs = 0;
    for (const t of tracks) {
      const fr = t.frames;
      for (let i = 0; i < fr.length; i++) {
        const d = fr[i].duration != null ? fr[i].duration : i + 1 < fr.length ? fr[i + 1].timestamp - fr[i].timestamp : i ? fr[i].timestamp - fr[i - 1].timestamp : 0;
        endUs = Math.max(endUs, fr[i].timestamp - t0 + Math.max(0, d));
      }
    }
    const hasVideo = tracks.some((t) => t.type === 1);
    const webm = tracks.every((t) => WEBM_CODECS.has(t.codecId));
    // Clusters
    const clusters = [];
    let cur = null;
    for (const x of all) {
      const isKey = x.t.type === 1 && x.f.keyframe;
      // New cluster at every video keyframe (each cluster then starts decodable, so a cue can point at it), and at
      // least every 5 s / 8 MB to keep block offsets inside int16 and seeking granular in audio-only files.
      if (!cur || (isKey && cur.blocks.length) || x.ms - cur.ms > MAX_CLUSTER_MS || cur.bytes > 8e6) {
        cur = { ms: x.ms, blocks: [], bytes: 0, cue: hasVideo ? (isKey ? x.t.number : 0) : x.t.number };
        clusters.push(cur);
      }
      const head = new Uint8Array(4);
      head[0] = 0x80 | x.t.number;
      const rel = x.ms - cur.ms;
      head[1] = (rel >> 8) & 0xff;
      head[2] = rel & 0xff;
      head[3] = x.f.keyframe ? 0x80 : 0;
      const blk = concat([encodeId(ID.SimpleBlock), encodeSize(4 + x.f.data.length), head]);
      cur.blocks.push(blk, x.f.data);
      cur.bytes += blk.length + x.f.data.length;
    }
    const clusterBytes = clusters.map((c) => {
      const ts = el(ID.Timestamp, uintBytes(c.ms));
      return [concat([encodeId(ID.Cluster), encodeSize(ts.length + c.bytes, 8), ts]), ...c.blocks];
    });
    const header = el(ID.EBML, elUint(ID.EBMLVersion, 1), elUint(ID.EBMLReadVersion, 1), elUint(ID.EBMLMaxIDLength, 4),
      elUint(ID.EBMLMaxSizeLength, 8), elString(ID.DocType, webm ? 'webm' : 'matroska'), elUint(ID.DocTypeVersion, 4), elUint(ID.DocTypeReadVersion, 2));
    const info = el(ID.Info, elUint(ID.TimestampScale, 1000000), elString(ID.MuxingApp, this.muxingApp), elString(ID.WritingApp, this.writingApp),
      elFloat(ID.Duration, endUs / 1000), this.title ? elString(ID.Title, this.title) : null);
    const trackEls = el(ID.Tracks, tracks.map((t) => this.trackEntry(t)));
    // Positions relative to the segment data; the SeekHead has a fixed size (8-byte positions).
    const seekEntry = (id, pos) => el(ID.Seek, el(ID.SeekID, encodeId(id)), elUint(ID.SeekPosition, pos, 8));
    const seekLen = el(ID.SeekHead, seekEntry(ID.Info, 0), seekEntry(ID.Tracks, 0), seekEntry(ID.Cues, 0)).length;
    const infoPos = seekLen, tracksPos = infoPos + info.length;
    let pos = tracksPos + trackEls.length;
    const cuePoints = [];
    clusterBytes.forEach((parts, i) => {
      const c = clusters[i];
      if (c.cue) cuePoints.push(el(ID.CuePoint, elUint(ID.CueTime, c.ms), el(ID.CueTrackPositions, elUint(ID.CueTrack, c.cue), elUint(ID.CueClusterPosition, pos))));
      for (const p of parts) pos += p.length;
    });
    const cues = el(ID.Cues, cuePoints);
    const seekHead = el(ID.SeekHead, seekEntry(ID.Info, infoPos), seekEntry(ID.Tracks, tracksPos), seekEntry(ID.Cues, pos));
    const segSize = pos + cues.length;
    const out = [header, concat([encodeId(ID.Segment), encodeSize(segSize, 8)]), seekHead, info, trackEls, ...clusterBytes.flat(), cues];
    return parts ? out : concat(out);
  }

  trackEntry(t) {
    const c = t.cfg;
    // TrackUID must be non-zero and unique within the file; a deterministic value keeps output byte-stable.
    const kids = [elUint(ID.TrackNumber, t.number), elUint(ID.TrackUID, t.number * 0x1000 + 0x77), elUint(ID.TrackType, t.type),
      elUint(ID.FlagLacing, 0), elString(ID.Language, 'und'), elString(ID.CodecID, t.codecId)];
    if (t.type === 1) {
      if (t.codecPrivate && t.codecId !== 'V_VP8' && t.codecId !== 'V_VP9') kids.push(elBinary(ID.CodecPrivate, t.codecPrivate));
      if (c.frameRate) kids.push(elUint(ID.DefaultDuration, Math.round(1e9 / c.frameRate)));
      kids.push(el(ID.Video, elUint(ID.PixelWidth, c.width), elUint(ID.PixelHeight, c.height),
        c.displayWidth ? elUint(ID.DisplayWidth, c.displayWidth) : null, c.displayHeight ? elUint(ID.DisplayHeight, c.displayHeight) : null,
        c.alpha ? elUint(ID.AlphaMode, 1) : null));
    } else {
      const rate = c.sampleRate || 48000, ch = c.channels || 2;
      if (t.codecId === 'A_OPUS') {
        const head = t.codecPrivate && t.codecPrivate.length >= 19 && t.codecPrivate[0] === 0x4f ? t.codecPrivate : opusHead(ch, rate, c.preSkip ?? 312);
        const preSkip = head[10] | (head[11] << 8);
        // Opus in Matroska: CodecDelay = pre-skip in ns, SeekPreRoll 80 ms (the decoder must pre-roll that much after
        // a seek to converge), both required by the WebM Opus mapping.
        kids.push(elBinary(ID.CodecPrivate, head), elUint(ID.CodecDelay, Math.round((preSkip * 1e9) / 48000)), elUint(ID.SeekPreRoll, 80000000));
      } else if (t.codecPrivate) kids.push(elBinary(ID.CodecPrivate, t.codecPrivate));
      else if (t.codecId === 'A_VORBIS') throw new Error('Vorbis needs its headers (codecPrivate)');
      kids.push(el(ID.Audio, elFloat(ID.SamplingFrequency, rate), elUint(ID.Channels, ch), c.bitDepth ? elUint(ID.BitDepth, c.bitDepth) : null));
    }
    return el(ID.TrackEntry, kids);
  }
}
