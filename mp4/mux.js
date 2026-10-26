// mp4/mux.js - progressive MP4 muxer (ftyp + moov before mdat, "fast start") for WebCodecs output: H.264 (avc1),
// HEVC (hvc1), AV1 (av01), VP9 (vp09) video and AAC (mp4a) / Opus audio. Samples are buffered and written on
// finalize(); B-frame reordering gets a ctts table and an edit list.
import { MATRIX, ascii, box, cat, fixed16, fixed8, fullBox, i16, i32, u16, u32, u64, u8, utf8, zeros } from './box.js';
import {
  buildAudioSpecificConfig, buildAv1C, buildDOps, buildEsds, buildVpcC, dOpsFromOpusHead, parseAudioSpecificConfig,
  parseAv1SequenceHeader, parseVp9CodecString, parseVp9Frame,
} from './codecs.js';

const asBytes = (b) => (b instanceof Uint8Array ? b : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b));
//
// Why progressive (moov first) and not fragmented: a single moov in front lets browsers and messengers start playing
// and seeking before the whole file arrives, and every player supports it. Cost: all samples are buffered in memory
// until finalize(), since chunk offsets in moov depend on its own size. Fragmented output would stream but is
// handled worse by some players and editors.
const MAC_EPOCH = Date.UTC(1904, 0, 1) / 1000;

// Chunk source -> { data, timestamp (µs), duration (µs), keyframe }.
// EncodedVideoChunk / EncodedAudioChunk expose data only via copyTo(); the bytes are copied immediately because the
// encoder may reuse its buffers after the output callback returns.
function takeChunk(chunk) {
  let data;
  if (typeof chunk.copyTo === 'function' && !(chunk.data)) { data = new Uint8Array(chunk.byteLength); chunk.copyTo(data); }
  else data = asBytes(chunk.data).slice();
  return {
    data, timestamp: Math.round(chunk.timestamp || 0), duration: chunk.duration == null ? null : Math.round(chunk.duration),
    keyframe: chunk.type ? chunk.type === 'key' : !!chunk.keyframe,
  };
}

/**
 * const mux = new Mp4Muxer({
 *   video: { codec: 'avc1.42001f' | 'hvc1…' | 'av01…' | 'vp09…', width, height, description?, frameRate? },
 *   audio: { codec: 'mp4a.40.2' | 'opus', sampleRate, channels, description? },
 *   metadata: { title, encoder, … }, timescale: 90000 (video) });
 * mux.addVideoChunk(encodedVideoChunk, metadata?)   // EncodedVideoChunk or { data, timestamp, duration, type }
 * mux.addAudioChunk(encodedAudioChunk, metadata?)
 * const bytes = mux.finalize();                     // Uint8Array; finalize({ parts: true }) -> Uint8Array[] (for a Blob)
 * Timestamps are microseconds; the earliest one becomes time 0 when `shiftToZero` (default true).
 */
export class Mp4Muxer {
  constructor({ video = null, audio = null, metadata = {}, timescale = 90000, shiftToZero = true } = {}) {
    if (!video && !audio) throw new Error('Mp4Muxer: no tracks');
    this.tracks = [];
    if (video) this.video = this.addTrack('video', { ...video, timescale });
    if (audio) this.audio = this.addTrack('audio', { ...audio, timescale: audio.sampleRate || 48000 });
    this.metadata = metadata;
    this.shiftToZero = shiftToZero;
    this.done = false;
  }

  addTrack(type, cfg) {
    const t = { id: this.tracks.length + 1, type, cfg: { ...cfg }, samples: [], description: cfg.description ? asBytes(cfg.description).slice() : null };
    this.tracks.push(t);
    return t;
  }

  addVideoChunk(chunk, meta) {
    if (!this.video) throw new Error('Mp4Muxer: no video track');
    const s = takeChunk(chunk);
    const t = this.video;
    if (meta?.decoderConfig) {
      const dc = meta.decoderConfig;
      if (dc.description && !t.description) t.description = asBytes(dc.description).slice();
      if (dc.codec) t.cfg.codec = dc.codec;
      if (dc.codedWidth && !t.cfg.width) { t.cfg.width = dc.codedWidth; t.cfg.height = dc.codedHeight; }
      if (dc.colorSpace) t.cfg.colorSpace = dc.colorSpace;
    }
    if (s.keyframe && !t.description && /^av01/.test(t.cfg.codec)) {
      const sh = parseAv1SequenceHeader(s.data);
      if (sh) t.description = buildAv1C(sh);
    }
    if (s.keyframe && /^vp09/.test(t.cfg.codec) && !t.vp9) {
      const fi = parseVp9Frame(s.data);
      t.vp9 = { ...parseVp9CodecString(t.cfg.codec), ...(fi && fi.bitDepth ? { bitDepth: fi.bitDepth, profile: fi.profile } : {}) };
    }
    t.samples.push(s);
  }

  addAudioChunk(chunk, meta) {
    if (!this.audio) throw new Error('Mp4Muxer: no audio track');
    const t = this.audio;
    if (meta?.decoderConfig) {
      const dc = meta.decoderConfig;
      if (dc.description && !t.description) t.description = asBytes(dc.description).slice();
      if (dc.sampleRate) t.cfg.sampleRate = dc.sampleRate;
      if (dc.numberOfChannels) t.cfg.channels = dc.numberOfChannels;
    }
    t.samples.push(takeChunk(chunk));
  }

  /** Builds the file. Returns Uint8Array, or Uint8Array[] with { parts: true }. */
  finalize({ parts = false } = {}) {
    if (this.done) throw new Error('Mp4Muxer: already finalized');
    this.done = true;
    const tracks = this.tracks.filter((t) => t.samples.length);
    if (!tracks.length) throw new Error('Mp4Muxer: no samples');
    let t0 = 0;
    if (this.shiftToZero) t0 = Math.min(...tracks.map((t) => Math.min(...t.samples.map((s) => s.timestamp))));
    for (const t of tracks) timeTrack(t, t0);
    // Interleave: chunks of up to ~0.5 s per track, ordered by start time. Interleaving keeps a progressive download
    // playable (audio and video for the same moment are near each other in the file); 1024 samples cap a chunk so
    // stsc entries and read sizes stay bounded.
    const chunks = [];
    for (const t of tracks) {
      t.chunks = [];
      let cur = null;
      for (let i = 0; i < t.samples.length; i++) {
        const s = t.samples[i];
        if (!cur || s.dts - cur.startDts >= t.timescale / 2 || cur.count >= 1024) {
          cur = { track: t, first: i, count: 0, startDts: s.dts, start: s.dts / t.timescale, bytes: 0 };
          t.chunks.push(cur);
          chunks.push(cur);
        }
        cur.count++;
        cur.bytes += s.data.length;
      }
    }
    chunks.sort((a, b) => a.start - b.start || a.track.id - b.track.id);
    const mdatSize = chunks.reduce((n, c) => n + c.bytes, 0);
    const big = mdatSize + 16 > 0xffffffff;
    const ftyp = this.ftyp(tracks);
    // The moov size does not depend on the offset values (32- or 64-bit chosen up front), so build it twice.
    const layout = (base) => { let o = base; for (const c of chunks) { c.offset = o; o += c.bytes; } };
    layout(0);
    const co64 = big;
    let moov = this.moov(tracks, co64);
    const mdatHeader = big ? cat(u32(1), ascii('mdat'), u64(mdatSize + 16)) : cat(u32(mdatSize + 8), ascii('mdat'));
    layout(ftyp.length + moov.length + mdatHeader.length);
    moov = this.moov(tracks, co64);
    const out = [ftyp, moov, mdatHeader];
    for (const c of chunks) for (let i = c.first; i < c.first + c.count; i++) out.push(c.track.samples[i].data);
    return parts ? out : cat(out);
  }

  ftyp(tracks) {
    const brands = ['isom', 'iso2', 'iso6', 'mp41'];
    const v = tracks.find((t) => t.type === 'video');
    if (v && /^avc/.test(v.cfg.codec)) brands.push('avc1');
    if (v && /^av01/.test(v.cfg.codec)) brands.push('av01');
    return box('ftyp', ascii('isom'), u32(0x200), brands.map(ascii));
  }

  moov(tracks, co64) {
    const movieScale = 1000;
    const now = Math.floor(Date.now() / 1000 - MAC_EPOCH);
    const dur = Math.max(...tracks.map((t) => t.endTime));
    const mvhd = fullBox('mvhd', 0, 0, u32(now), u32(now), u32(movieScale), u32(Math.round(dur * movieScale)),
      u32(0x10000), u16(0x100), zeros(10), MATRIX, zeros(24), u32(tracks.length + 1));
    return box('moov', mvhd, tracks.map((t) => this.trak(t, now, movieScale, co64)), this.udta());
  }

  // iTunes-style metadata (udta/meta/ilst, data type 1 = UTF-8), the variant that both QuickTime and ffprobe read.
  udta() {
    const m = { encoder: 'in-html', ...this.metadata };
    const keys = { title: '\xa9nam', artist: '\xa9ART', album: '\xa9alb', date: '\xa9day', comment: '\xa9cmt', genre: '\xa9gen', encoder: '\xa9too' };
    const items = Object.entries(keys).filter(([k]) => m[k]).map(([k, id]) =>
      box(id, box('data', u32(1), u32(0), utf8(String(m[k])))));
    if (!items.length) return null;
    const hdlr = fullBox('hdlr', 0, 0, u32(0), ascii('mdir'), ascii('appl'), zeros(9));
    return box('udta', fullBox('meta', 0, 0, hdlr, box('ilst', items)));
  }

  trak(t, now, movieScale, co64) {
    const isV = t.type === 'video';
    const durMovie = Math.round(t.endTime * movieScale);
    const w = isV ? t.cfg.displayWidth || t.cfg.width : 0, h = isV ? t.cfg.displayHeight || t.cfg.height : 0;
    const tkhd = fullBox('tkhd', 0, 3, u32(now), u32(now), u32(t.id), u32(0), u32(durMovie), zeros(8),
      u16(0), u16(isV ? 0 : 1), fixed8(isV ? 0 : 1), u16(0), MATRIX, fixed16(w), fixed16(h));
    // Edit list: presentation starts at the first sample (B-frame delay / shifted start).
    let edts = null;
    if (t.mediaStart > 0 || t.emptyStart > 0) {
      const entries = [];
      if (t.emptyStart > 0) entries.push(cat(u32(Math.round(t.emptyStart * movieScale)), i32(-1), u32(0x10000)));
      entries.push(cat(u32(Math.round((t.mediaDuration / t.timescale) * movieScale)), i32(t.mediaStart), u32(0x10000)));
      edts = box('edts', fullBox('elst', 0, 0, u32(entries.length), entries));
    }
    const mdhd = fullBox('mdhd', 0, 0, u32(now), u32(now), u32(t.timescale), u32(t.mediaDuration), u16(0x55c4), u16(0)); // 'und'
    const hdlr = fullBox('hdlr', 0, 0, u32(0), ascii(isV ? 'vide' : 'soun'), zeros(12), utf8(isV ? 'VideoHandler\0' : 'SoundHandler\0'));
    const mhd = isV ? fullBox('vmhd', 0, 1, zeros(8)) : fullBox('smhd', 0, 0, zeros(4));
    const dinf = box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1)));
    const stbl = box('stbl', fullBox('stsd', 0, 0, u32(1), isV ? this.videoEntry(t) : this.audioEntry(t)), ...this.tables(t, co64));
    return box('trak', tkhd, edts, box('mdia', mdhd, hdlr, box('minf', mhd, dinf, stbl)));
  }

  videoEntry(t) {
    const c = t.cfg.codec || '';
    const head = (type, ...kids) => box(type, zeros(6), u16(1), zeros(16), u16(t.cfg.width), u16(t.cfg.height),
      u32(0x480000), u32(0x480000), u32(0), u16(1), compressorName('in-html'), u16(0x18), i16(-1), ...kids);
    if (/^(avc1|avc3)/.test(c)) { if (!t.description) throw new Error('H.264 needs an avcC description (avc format)'); return head('avc1', box('avcC', t.description)); }
    if (/^(hvc1|hev1)/.test(c)) { if (!t.description) throw new Error('HEVC needs an hvcC description'); return head(c.slice(0, 4), box('hvcC', t.description)); }
    if (/^av01/.test(c)) { if (!t.description) throw new Error('AV1: no sequence header in the first keyframe'); return head('av01', box('av1C', t.description)); }
    if (/^vp09/.test(c)) return head('vp09', box('vpcC', buildVpcC(t.vp9 || parseVp9CodecString(c))));
    if (/^vp8/.test(c)) return head('vp08', box('vpcC', buildVpcC({ profile: 0, level: 10, bitDepth: 8 })));
    throw new Error('Mp4Muxer: unsupported video codec ' + c);
  }

  // The audio sample entry stores the rate as 16.16 fixed point, so rates >= 65536 Hz cannot be represented there
  // and are written as 0 (the real rate lives in the codec configuration: esds / dOps).
  audioEntry(t) {
    const c = (t.cfg.codec || '').toLowerCase();
    const ch = t.cfg.channels || 2, rate = t.cfg.sampleRate || 48000;
    const head = (type, ...kids) => box(type, zeros(6), u16(1), zeros(8), u16(ch), u16(16), u16(0), u16(0), u32(rate < 65536 ? rate * 65536 : 0), ...kids);
    if (c.startsWith('mp4a')) {
      let asc = t.description;
      if (!asc) asc = buildAudioSpecificConfig({ objectType: +(c.split('.')[2] || 2), sampleRate: rate, channels: ch });
      try { const a = parseAudioSpecificConfig(asc); if (a.channels && a.channels !== ch) t.cfg.channels = a.channels; } catch { /* keep */ }
      const bytes = t.samples.reduce((n, s) => n + s.data.length, 0);
      const br = t.endTime ? Math.round((bytes * 8) / t.endTime) : 0;
      const maxSample = t.samples.reduce((m, s) => Math.max(m, s.data.length), 0);
      return head('mp4a', box('esds', buildEsds({ asc, trackId: t.id, bitrate: br, bufferSize: maxSample })));
    }
    if (c === 'opus') {
      const d = t.description && t.description.length >= 19 && t.description[0] === 0x4f ? dOpsFromOpusHead(t.description) : { channels: ch, preSkip: t.cfg.preSkip ?? 312, inputSampleRate: rate };
      return box('Opus', zeros(6), u16(1), zeros(8), u16(d.channels), u16(16), u16(0), u16(0), u32(48000 * 65536), box('dOps', buildDOps(d)));
    }
    throw new Error('Mp4Muxer: unsupported audio codec ' + c);
  }

  tables(t, co64) {
    const S = t.samples;
    // stts: run-length of durations
    const stts = [];
    for (const s of S) { const last = stts[stts.length - 1]; if (last && last[1] === s.dur) last[0]++; else stts.push([1, s.dur]); }
    const out = [fullBox('stts', 0, 0, u32(stts.length), stts.map(([n, d]) => cat(u32(n), u32(d))))];
    if (t.hasCtts) {
      const ctts = [];
      for (const s of S) { const off = s.pts - s.dts; const last = ctts[ctts.length - 1]; if (last && last[1] === off) last[0]++; else ctts.push([1, off]); }
      out.push(fullBox('ctts', 0, 0, u32(ctts.length), ctts.map(([n, o]) => cat(u32(n), u32(o)))));
    }
    if (t.type === 'video' && S.some((s) => !s.keyframe)) {
      const keys = [];
      S.forEach((s, i) => { if (s.keyframe) keys.push(i + 1); });
      out.push(fullBox('stss', 0, 0, u32(keys.length), keys.map(u32)));
    }
    const stsc = [];
    t.chunks.forEach((c, i) => { const last = stsc[stsc.length - 1]; if (!last || last[1] !== c.count) stsc.push([i + 1, c.count]); });
    out.push(fullBox('stsc', 0, 0, u32(stsc.length), stsc.map(([f, n]) => cat(u32(f), u32(n), u32(1)))));
    out.push(fullBox('stsz', 0, 0, u32(0), u32(S.length), S.map((s) => u32(s.data.length))));
    out.push(co64 ? fullBox('co64', 0, 0, u32(t.chunks.length), t.chunks.map((c) => u64(c.offset)))
      : fullBox('stco', 0, 0, u32(t.chunks.length), t.chunks.map((c) => u32(c.offset))));
    return out;
  }
}

// 32-byte Pascal string of the visual sample entry.
function compressorName(s) {
  const out = new Uint8Array(32);
  const b = ascii(s.slice(0, 31));
  out[0] = b.length;
  out.set(b, 1);
  return out;
}

// Decode / presentation times in the track timescale. Decode times are the sorted presentation times, delayed so
// that no sample is decoded after it is shown (ctts); the first sample decodes at media time 0 (stts), so the
// presentation starts at media time `mediaStart` (elst) and, for a track that starts late, after an empty edit.
// Why decode times are derived instead of taken from the encoder: WebCodecs chunks carry presentation timestamps only.
// With B-frames presentation order differs from decode order; sorting the PTS gives a monotonic decode clock, and
// shifting it by the largest (PTS - sorted PTS) lag guarantees dts <= pts for every sample, which ctts version 0
// (unsigned offsets) requires.
function timeTrack(t, t0) {
  const c = (t.cfg.codec || '').toLowerCase();
  const ts = t.timescale = t.type === 'video' ? t.cfg.timescale || 90000 : c === 'opus' ? 48000 : t.cfg.sampleRate || 48000;
  const S = t.samples;
  const n = S.length;
  for (const s of S) s.pts = Math.round(((s.timestamp - t0) * ts) / 1e6);
  const P = S.map((s) => s.pts).sort((a, b) => a - b);
  let delay = 0;
  for (let i = 0; i < n; i++) delay = Math.max(delay, P[i] - S[i].pts);
  for (let i = 0; i < n; i++) S[i].dts = P[i] - delay;
  t.hasCtts = S.some((s) => s.pts !== s.dts);
  // The last presented sample keeps its own duration (or the previous interval).
  let lastP = S[0];
  for (const s of S) if (s.pts >= lastP.pts) lastP = s;
  const prevGap = n > 1 ? P[n - 1] - P[n - 2] : Math.round(ts / 30);
  const lastDur = Math.max(1, lastP.duration != null && lastP.duration > 0 ? Math.round((lastP.duration * ts) / 1e6) : prevGap || 1);
  for (let i = 0; i < n - 1; i++) S[i].dur = P[i + 1] - P[i];
  S[n - 1].dur = lastDur;
  t.mediaDuration = P[n - 1] - P[0] + lastDur;
  t.mediaStart = delay;
  t.emptyStart = P[0] > 0 ? P[0] / ts : 0;
  t.endTime = (P[n - 1] + lastDur) / ts;
}
