// ogg/opus.js - Ogg Opus (RFC 7845): OpusHead / OpusTags, packet durations from the TOC byte (RFC 6716),
// muxing of encoded Opus packets (e.g. WebCodecs AudioEncoder output) and demuxing to timed packets.
import { OggWriter, readPackets } from './ogg.js';
import { buildVorbisComment, parseVorbisComment } from './vorbis.js';

const asBytes = (b) => (b instanceof Uint8Array ? b : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b));
const MAGIC_HEAD = [0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64]; // OpusHead
const MAGIC_TAGS = [0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73]; // OpusTags
const has = (b, sig) => sig.every((v, i) => b[i] === v);

// Channel mapping family 1 (Vorbis order, RFC 7845 section 5.1.1.2): [streams, coupled, mapping] per channel count.
// Multistream layout per channel count: how many Opus streams, how many of them are stereo-coupled, and which
// decoded channel feeds each output channel. Values are RFC 7845's recommended Vorbis-order layouts.
const FAMILY1 = {
  3: [2, 1, [0, 2, 1]], 4: [2, 2, [0, 1, 2, 3]], 5: [3, 2, [0, 4, 1, 2, 3]], 6: [4, 2, [0, 4, 1, 2, 3, 5]],
  7: [4, 3, [0, 4, 1, 2, 3, 5, 6]], 8: [5, 3, [0, 6, 1, 2, 3, 4, 5, 7]],
};

/** Parses an OpusHead packet: { version, channels, preSkip, inputSampleRate, outputGain, mappingFamily, streamCount, coupledCount, mapping }. */
export function parseOpusHead(input) {
  const b = asBytes(input);
  if (b.length < 19 || !has(b, MAGIC_HEAD)) throw new Error('not an OpusHead packet');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const h = {
    version: b[8], channels: b[9], preSkip: dv.getUint16(10, true), inputSampleRate: dv.getUint32(12, true),
    outputGain: dv.getInt16(16, true), mappingFamily: b[18], streamCount: 1, coupledCount: b[9] > 1 ? 1 : 0, mapping: [],
  };
  if (h.mappingFamily !== 0 && b.length >= 21 + h.channels) {
    h.streamCount = b[19];
    h.coupledCount = b[20];
    h.mapping = Array.from(b.subarray(21, 21 + h.channels));
  }
  return h;
}

/** Builds an OpusHead packet: { channels, preSkip = 312, inputSampleRate = 48000, outputGain = 0 }. */
// preSkip 312 = libopus encoder lookahead at 48 kHz (6.5 ms). WebCodecs encoders report their own value in the
// decoderConfig description, which muxOggOpus prefers when passed as `head`.
export function buildOpusHead({ channels = 2, preSkip = 312, inputSampleRate = 48000, outputGain = 0, mappingFamily } = {}) {
  const fam = mappingFamily ?? (channels > 2 ? 1 : 0);
  const m = fam ? FAMILY1[channels] : null;
  if (fam && !m) throw new Error(`OpusHead: no default mapping for ${channels} channels`);
  const out = new Uint8Array(19 + (m ? 2 + channels : 0));
  const dv = new DataView(out.buffer);
  out.set(MAGIC_HEAD);
  out[8] = 1;
  out[9] = channels;
  dv.setUint16(10, preSkip, true);
  dv.setUint32(12, inputSampleRate, true);
  dv.setInt16(16, outputGain, true);
  out[18] = fam;
  if (m) { out[19] = m[0]; out[20] = m[1]; out.set(m[2], 21); }
  return out;
}

/** Parses an OpusTags packet: { vendor, comments, tags, pictures }. */
export function parseOpusTags(input) {
  const b = asBytes(input);
  if (!has(b, MAGIC_TAGS)) throw new Error('not an OpusTags packet');
  return parseVorbisComment(b, 8);
}

/** Builds an OpusTags packet: { vendor, tags: { title, artist, ... }, comments, pictures }. */
export function buildOpusTags(opts = {}) {
  const body = buildVorbisComment({ vendor: 'in-html', ...opts });
  const out = new Uint8Array(8 + body.length);
  out.set(MAGIC_TAGS);
  out.set(body, 8);
  return out;
}

// Frame size in 48 kHz samples of each TOC configuration (RFC 6716 section 3.1).
const CONFIG_SAMPLES = [
  480, 960, 1920, 2880, 480, 960, 1920, 2880, 480, 960, 1920, 2880, // SILK NB / MB / WB: 10, 20, 40, 60 ms
  480, 960, 480, 960, // Hybrid SWB / FB: 10, 20 ms
  120, 240, 480, 960, 120, 240, 480, 960, 120, 240, 480, 960, 120, 240, 480, 960, // CELT: 2.5, 5, 10, 20 ms
];

/** Number of 48 kHz samples an Opus packet decodes to (0 for an empty or malformed packet). */
// TOC byte: config (top 5 bits) gives frame duration; code (low 2 bits) gives 1, 2, 2 or N frames (N in byte 2).
// 5760 = 120 ms, the maximum packet duration RFC 6716 allows; clamps malformed packets.
export function opusPacketSamples(input) {
  const p = asBytes(input);
  if (!p.length) return 0;
  const toc = p[0];
  const frames = (toc & 3) === 0 ? 1 : (toc & 3) === 3 ? (p.length > 1 ? p[1] & 0x3f : 0) : 2;
  return Math.min(5760, frames * CONFIG_SAMPLES[toc >> 3]);
}

// Packet source: Uint8Array, { data } or an EncodedAudioChunk (copyTo).
function packetBytes(pk) {
  if (pk instanceof Uint8Array || ArrayBuffer.isView(pk) || pk instanceof ArrayBuffer) return asBytes(pk);
  if (pk.data) return asBytes(pk.data);
  if (typeof pk.copyTo === 'function') { const d = new Uint8Array(pk.byteLength); pk.copyTo(d); return d; }
  throw new Error('Opus packet: unsupported value');
}

/**
 * Muxes Opus packets into an Ogg Opus file.
 *   packets  Uint8Array[] | [{ data }] | EncodedAudioChunk[] in decode order
 *   opts     { channels, preSkip = 312, inputSampleRate = 48000, head (OpusHead bytes, e.g. a WebCodecs
 *              decoderConfig.description; overrides channels / preSkip), tags, vendor, pictures, serial,
 *              totalSamples (48 kHz samples to keep after pre-skip: trims the encoder padding at the end) }
 */
export function muxOggOpus(packets, opts = {}) {
  const head = opts.head && has(asBytes(opts.head), MAGIC_HEAD) ? asBytes(opts.head)
    : buildOpusHead({ channels: opts.channels || 2, preSkip: opts.preSkip ?? 312, inputSampleRate: opts.inputSampleRate || 48000 });
  const preSkip = parseOpusHead(head).preSkip;
  const w = new OggWriter({ serial: opts.serial });
  w.addPacket(head, 0, { flush: true });
  w.addPacket(buildOpusTags({ vendor: opts.vendor, tags: opts.tags, pictures: opts.pictures }), 0, { flush: true });
  // Ogg Opus granule = total 48 kHz samples decoded so far INCLUDING pre-skip. Starting at 0 and adding packet
  // durations does that; the decoder subtracts preSkip. The last page's granule may be smaller than the sum: that
  // is how encoder padding at the end is trimmed (end-trimming, RFC 7845 4.4).
  let granule = 0;
  const end = opts.totalSamples != null ? preSkip + Math.max(0, Math.round(opts.totalSamples)) : Infinity;
  const list = Array.from(packets);
  list.forEach((pk, i) => {
    const data = packetBytes(pk);
    granule += opusPacketSamples(data);
    const last = i === list.length - 1;
    w.addPacket(data, last ? Math.min(granule, end) : granule, { eos: last });
  });
  if (!list.length) w.addPacket(new Uint8Array(0), preSkip, { eos: true });
  return w.bytes();
}

/**
 * Demuxes the first Opus stream of an Ogg file.
 * Returns { head, tags: { vendor, tags, comments, pictures }, packets: [{ data, timestamp (µs, pre-skip removed),
 * duration (µs), samples }], duration (s), sampleRate: 48000, channels, preSkip, serial }.
 */
export function demuxOggOpus(input) {
  let stream = null;
  for (const s of readPackets(input).values()) if (s.packets[0] && has(s.packets[0].data, MAGIC_HEAD)) { stream = s; break; }
  if (!stream) throw new Error('no Opus stream in this Ogg file');
  const head = parseOpusHead(stream.packets[0].data);
  let tags = { vendor: '', tags: {}, comments: [], pictures: [] };
  let i = 1;
  if (stream.packets[1] && has(stream.packets[1].data, MAGIC_TAGS)) { tags = parseOpusTags(stream.packets[1].data); i = 2; }
  const packets = [];
  let pos = 0, lastGranule = -1;
  for (; i < stream.packets.length; i++) {
    const pk = stream.packets[i];
    const samples = opusPacketSamples(pk.data);
    // Timestamps are relative to the first audible sample, so the first packets (pre-skip) get negative values,
    // which is what WebCodecs AudioDecoder expects to discard them.
    packets.push({ data: pk.data, timestamp: Math.round(((pos - head.preSkip) * 1e6) / 48000), duration: Math.round((samples * 1e6) / 48000), samples });
    pos += samples;
    if (pk.granule >= 0) lastGranule = pk.granule;
  }
  const total = lastGranule >= 0 ? lastGranule : pos;
  return {
    head, tags, packets, sampleRate: 48000, channels: head.channels, preSkip: head.preSkip, serial: stream.serial,
    duration: Math.max(0, total - head.preSkip) / 48000,
  };
}
