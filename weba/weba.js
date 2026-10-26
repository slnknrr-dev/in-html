// weba/weba.js - audio-only WebM (.weba) helpers on top of webm/: muxing Opus packets, extracting the audio track of
// a WebM / Matroska file without re-encoding, reading audio info, and Opus WebM -> Ogg Opus remuxing.
//
// Contract: pure byte-in / byte-out functions, no DOM, no I/O; they run identically in a page, a Worker and Node.
// Everything is stream copy: compressed packets are moved between containers untouched, so the result is
// bit-exact and instant. Re-encoding would cost generational quality loss and a codec dependency we do not have.
//
// Time units, the main trap of this module (each container uses its own):
//   WebM block timestamps   microseconds here (webm/ converts from the TimecodeScale ticks)
//   WebM CodecDelay         nanoseconds (Matroska spec), as returned in extractAudio().codecDelay
//   Opus pre-skip / granule samples at 48 kHz, ALWAYS 48 kHz regardless of the input sample rate (RFC 7845)
// Mixing these without conversion is the classic off-by-1000 bug; every conversion below names its factor.
import { parseWebm } from '../webm/demux.js';
import { WebmMuxer } from '../webm/mux.js';
import { muxOggOpus, opusPacketSamples } from '../ogg/opus.js';

// Normalises any byte source to a Uint8Array VIEW (no copy). For a typed-array view the byteOffset/byteLength are
// kept: new Uint8Array(view.buffer) alone would expose the whole underlying buffer, a silent corruption when the
// caller passes a subarray (e.g. a slice of a fetched multipart body).
const asBytes = (b) => (b instanceof Uint8Array ? b : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b));

// One packet source -> { data, timestamp?, duration? }. Accepts raw bytes, plain objects and WebCodecs
// EncodedAudioChunk. The chunk has no .data (its payload is private), so copyTo() into a fresh buffer is the only
// way out; the !pk.data guard lets a plain object that happens to define copyTo keep its own bytes.
function packetOf(pk) {
  if (pk instanceof Uint8Array || ArrayBuffer.isView(pk) || pk instanceof ArrayBuffer) return { data: asBytes(pk) };
  if (typeof pk.copyTo === 'function' && !pk.data) { const d = new Uint8Array(pk.byteLength); pk.copyTo(d); return { data: d, timestamp: pk.timestamp, duration: pk.duration }; }
  return { data: asBytes(pk.data), timestamp: pk.timestamp, duration: pk.duration };
}

/**
 * Muxes Opus packets into an audio-only WebM file.
 *   packets  Uint8Array[] (timed from their TOC bytes) or [{ data, timestamp (µs), duration? }] / EncodedAudioChunk[]
 *   opts     { sampleRate = 48000 (input rate, informative), channels = 2, preSkip = 312, head (OpusHead bytes), title }
 */
export function muxOpus(packets, opts = {}) {
  const mux = new WebmMuxer({
    audio: { codec: 'opus', sampleRate: opts.sampleRate || 48000, channels: opts.channels || 2, preSkip: opts.preSkip ?? 312, codecPrivate: opts.head || null },
    title: opts.title || '',
  });
  // t: running sample count at 48 kHz (the Opus clock). Packets without timestamps are laid end to end from their
  // TOC-derived length; computing from the integer sample sum (not by adding rounded µs durations) keeps rounding
  // error from accumulating over long files.
  let t = 0;
  for (const raw of packets) {
    const pk = packetOf(raw);
    const samples = opusPacketSamples(pk.data);
    const ts = pk.timestamp != null ? pk.timestamp : Math.round((t * 1e6) / 48000);
    mux.addAudioChunk({ data: pk.data, timestamp: ts, duration: pk.duration ?? Math.round((samples * 1e6) / 48000), type: 'key' });
    // type 'key': every Opus packet is independently decodable, so all blocks may be SimpleBlock keyframes.
    t += samples;
  }
  return mux.finalize();
}

/**
 * Extracts an audio track of a WebM / Matroska file (stream copy).
 *   opts.track  track number (default: the first audio track)
 * Returns { codec, codecId, sampleRate, channels, codecPrivate, codecDelay (ns), duration (s),
 *   packets: [{ data, timestamp (µs), duration (µs) }], bytes (audio-only WebM, Opus / Vorbis only; null otherwise) }.
 */
export function extractAudio(input, opts = {}) {
  const w = parseWebm(asBytes(input));
  const t = opts.track ? w.tracks.find((x) => x.number === opts.track) : w.tracks.find((x) => x.type === 'audio');
  if (!t) throw new Error('no audio track');
  const packets = w.frames.filter((f) => f.track === t.number).map((f) => ({ data: f.data, timestamp: f.timestamp, duration: f.duration }));
  // Re-muxing is offered only for the codecs WebmMuxer can describe (Opus, Vorbis); other audio (e.g. AAC in .mkv)
  // is still returned as packets, with bytes null, rather than producing a WebM a browser would reject.
  // shiftToZero false: keeps the original timestamps, so the codec delay already baked into them stays consistent.
  let bytes = null;
  if (t.codecId === 'A_OPUS' || t.codecId === 'A_VORBIS') {
    const mux = new WebmMuxer({
      audio: { codec: t.codecId, sampleRate: t.sampleRate, channels: t.channels, codecPrivate: t.codecPrivate },
      title: w.info.title || '', shiftToZero: false,
    });
    for (const p of packets) mux.addAudioChunk({ data: p.data, timestamp: p.timestamp, duration: p.duration, type: 'key' });
    bytes = packets.length ? mux.finalize() : null;
  }
  // Duration from the last packet end, not from the Segment Info: Info.Duration is optional and is often absent in
  // streamed (MediaRecorder) files, whereas packet times are always present.
  const end = packets.length ? packets[packets.length - 1].timestamp + (packets[packets.length - 1].duration || 0) : 0;
  return {
    codec: t.codec, codecId: t.codecId, sampleRate: t.sampleRate, channels: t.channels, codecPrivate: t.codecPrivate,
    codecDelay: t.codecDelay, duration: end / 1e6, packets, bytes,
  };
}

/** Audio summary of a WebM file: { codec, codecName, sampleRate, channels, duration, bitrate, title, tags } of the first audio track. */
export function parseWeba(input) {
  // frames:false: header-only parse, cheap even for long recordings (no per-block allocation).
  const w = parseWebm(asBytes(input), { frames: false });
  const t = w.tracks.find((x) => x.type === 'audio');
  if (!t) throw new Error('no audio track');
  return {
    codec: t.codec, codecName: t.codecName, sampleRate: t.sampleRate, channels: t.channels, duration: w.duration || t.duration,
    bitrate: t.bitrate, title: w.info.title || '', tags: w.tags, muxingApp: w.info.muxingApp, writingApp: w.info.writingApp,
  };
}

/** Opus-in-WebM -> Ogg Opus (stream copy): { bytes, duration }. opts: { tags } (Vorbis comment fields). */
export function webmToOggOpus(input, opts = {}) {
  const a = extractAudio(input, opts);
  if (a.codecId !== 'A_OPUS') throw new Error('the audio track is not Opus');
  // OpusHead is 19 bytes minimum (RFC 7845 5.1); a shorter CodecPrivate is treated as missing and muxOggOpus builds
  // one. Pre-skip: little-endian u16 at offset 10 of OpusHead; else derived from CodecDelay (ns -> 48 kHz samples).
  const head = a.codecPrivate && a.codecPrivate.length >= 19 ? a.codecPrivate : null;
  const preSkip = head ? head[10] | (head[11] << 8) : Math.round((a.codecDelay || 0) * 48000 / 1e9);
  // Timestamps of WebM Opus blocks include the codec delay; the kept length is the presented duration.
  // totalSamples sets the final granule position, which tells the Ogg decoder where to trim the end padding;
  // Math.max(0, …) guards against a negative granule for files shorter than their own pre-skip.
  // inputSampleRate is informative only (OpusHead field); Opus always decodes at 48 kHz.
  const first = a.packets.length ? a.packets[0].timestamp : 0;
  const totalSamples = Math.max(0, Math.round(((a.duration - first / 1e6) * 48000)) - preSkip);
  const bytes = muxOggOpus(a.packets.map((p) => p.data), { head, channels: a.channels, preSkip, inputSampleRate: Math.round(a.sampleRate) || 48000, tags: opts.tags, totalSamples });
  return { bytes, duration: totalSamples / 48000 };
}
