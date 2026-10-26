// mp3/frame.js - MPEG audio frame headers (MPEG-1 / 2 / 2.5, layers I-III) and stream analysis: first frame sync,
// frame count, bit rate, VBR headers (Xing / Info with the LAME extension, VBRI) and duration.
import { BITRATES, SAMPLE_RATES } from './tables.js';
import { id3v2Size, readId3v1 } from './id3.js';

const asBytes = (b) => (b instanceof Uint8Array ? b : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b));
const MODES = ['stereo', 'joint stereo', 'dual channel', 'mono'];

/**
 * Parses the 4-byte frame header at p. Returns null when it is not a valid header, else { version (1 | 2 | 2.5),
 * layer, crc, bitrate (kbps), sampleRate, padding, mode, channels, modeExtension, copyright, original, emphasis,
 * frameSize (bytes), samples (per frame) }. Free-format frames (bit rate index 0) are rejected.
 */
// Frame size formulas (ISO 11172-3 / 13818-3): Layer I counts 4-byte slots, Layer II and MPEG-1 Layer III use
// 144 * bitrate / rate, MPEG-2 / 2.5 Layer III half of that (576 samples per frame). Reserved values (version 01,
// layer 00, bitrate 1111, rate 11) and free format (bitrate 0, size unknowable from the header) are rejected.
export function parseFrameHeader(input, p = 0) {
  const b = asBytes(input);
  if (p + 4 > b.length || b[p] !== 0xff || (b[p + 1] & 0xe0) !== 0xe0) return null;
  const vbits = (b[p + 1] >> 3) & 3, lbits = (b[p + 1] >> 1) & 3;
  if (vbits === 1 || lbits === 0) return null;
  const version = vbits === 3 ? 1 : vbits === 2 ? 2 : 2.5;
  const layer = 4 - lbits;
  const bi = b[p + 2] >> 4, si = (b[p + 2] >> 2) & 3;
  if (bi === 0 || bi === 15 || si === 3) return null;
  const bitrate = BITRATES[version === 1 ? 0 : 1][layer - 1][bi];
  const sampleRate = SAMPLE_RATES[version][si];
  const padding = (b[p + 2] >> 1) & 1;
  const modeBits = b[p + 3] >> 6;
  let samples, frameSize;
  if (layer === 1) { samples = 384; frameSize = (Math.floor((12000 * bitrate) / sampleRate) + padding) * 4; }
  else if (layer === 2 || version === 1) { samples = 1152; frameSize = Math.floor((144000 * bitrate) / sampleRate) + padding; }
  else { samples = 576; frameSize = Math.floor((72000 * bitrate) / sampleRate) + padding; }
  return {
    version, layer, crc: !(b[p + 1] & 1), bitrate, sampleRate, padding, mode: MODES[modeBits], channels: modeBits === 3 ? 1 : 2,
    modeExtension: (b[p + 3] >> 4) & 3, copyright: !!(b[p + 3] & 8), original: !!(b[p + 3] & 4), emphasis: b[p + 3] & 3,
    frameSize, samples,
  };
}

const sameStream = (a, b) => a && b && a.version === b.version && a.layer === b.layer && a.sampleRate === b.sampleRate;

/** Offset of the first frame at or after `start` that is followed by another valid frame (or ends the data); -1 if none. */
// A single FF Ex pattern occurs by chance in any binary data (embedded cover art, ID3 padding); requiring the next
// header at the computed offset to belong to the same stream turns a 1-in-2000 false positive into a negligible one.
export function findFrame(input, start = 0, end) {
  const b = asBytes(input);
  const stop = end == null ? b.length : end;
  for (let p = start; p + 4 <= stop; p++) {
    if (b[p] !== 0xff) continue;
    const h = parseFrameHeader(b, p);
    if (!h) continue;
    const q = p + h.frameSize;
    if (q === stop || (q + 4 <= stop && sameStream(h, parseFrameHeader(b, q)))) return p;
  }
  return -1;
}

// Offset of the Xing / Info tag inside a frame: after the side information.
// Side information length: 17 / 32 bytes for MPEG-1 mono / stereo, 9 / 17 for MPEG-2 / 2.5, plus 2 for a CRC.
function sideInfoEnd(h) {
  const side = h.version === 1 ? (h.channels === 1 ? 17 : 32) : (h.channels === 1 ? 9 : 17);
  return 4 + (h.crc ? 2 : 0) + side;
}

/** Reads a Xing / Info tag (with the LAME extension) or a VBRI tag in the frame at p, or null. */
export function readVbrHeader(input, p, h = parseFrameHeader(input, p)) {
  const b = asBytes(input);
  if (!h || h.layer !== 3) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const x = p + sideInfoEnd(h);
  const tag = String.fromCharCode(b[x], b[x + 1], b[x + 2], b[x + 3]);
  if ((tag === 'Xing' || tag === 'Info') && x + 8 <= b.length) {
    const flags = dv.getUint32(x + 4);
    let q = x + 8;
    const out = { type: tag, frames: null, bytes: null, toc: null, quality: null };
    if (flags & 1) { out.frames = dv.getUint32(q); q += 4; }
    if (flags & 2) { out.bytes = dv.getUint32(q); q += 4; }
    if (flags & 4) { out.toc = Array.from(b.subarray(q, q + 100)); q += 100; }
    if (flags & 8) { out.quality = dv.getUint32(q); q += 4; }
    if (q + 36 <= b.length) {
      const enc = String.fromCharCode(...b.subarray(q, q + 9)).replace(/[^\x20-\x7e]/g, '').trim();
      if (/^(LAME|Lavf|Lavc|GOGO|L3.99)/.test(enc)) {
        // LAME tag: encoder delay and end padding as two 12-bit values; needed for gapless playback and exact duration.
        const d = (b[q + 21] << 16) | (b[q + 22] << 8) | b[q + 23];
        out.encoder = enc;
        out.encoderDelay = d >> 12;
        out.encoderPadding = d & 0xfff;
        out.lowpass = b[q + 10] * 100;
      }
    }
    return out;
  }
  // VBRI (Fraunhofer) sits at a fixed 32 bytes after the 4-byte header, regardless of side information size.
  const v = p + 36;
  if (v + 26 <= b.length && b[v] === 0x56 && b[v + 1] === 0x42 && b[v + 2] === 0x52 && b[v + 3] === 0x49) {
    return { type: 'VBRI', version: dv.getUint16(v + 4), delay: dv.getUint16(v + 6), quality: dv.getUint16(v + 8), bytes: dv.getUint32(v + 10), frames: dv.getUint32(v + 14) };
  }
  return null;
}

/**
 * Analyses an MP3 stream (ID3 tags skipped).
 * Returns { audioStart, audioEnd, id3v2Size, hasId3v1, version, layer, sampleRate, channels, mode, frames, duration (s),
 *   bitrate (average kbps), cbr, vbr: { type, frames, bytes, toc, encoder, encoderDelay, encoderPadding } | null,
 *   firstFrame: header, samplesPerFrame }.
 * Frames are counted by walking the stream (`scan: false` trusts a Xing / VBRI frame count when present).
 */
// Duration strategy: walking every frame is exact (the default); trusting the Xing / VBRI frame count is O(1) but
// wrong for files that were cut or concatenated after encoding. Trailing tags (ID3v1, APEv2) are excluded first so
// their bytes are not mistaken for frames; after a desync the walk resynchronises with findFrame.
export function scanMp3(input, { scan = true } = {}) {
  const b = asBytes(input);
  const tagSize = id3v2Size(b);
  let end = b.length;
  const v1 = readId3v1(b);
  if (v1) end -= 128;
  // APEv2 footer before ID3v1
  if (end >= 32 && String.fromCharCode(...b.subarray(end - 32, end - 24)) === 'APETAGEX') {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    // APEv2 footer: tag size excludes the 32-byte header, whose presence is flag bit 31.
    end -= dv.getUint32(end - 20, true) + ((dv.getUint32(end - 12, true) >>> 31) ? 32 : 0);
  }
  const first = findFrame(b, tagSize, end);
  if (first < 0) throw new Error('no MPEG audio frames found');
  const h = parseFrameHeader(b, first);
  const vbr = readVbrHeader(b, first, h);
  const out = {
    audioStart: first, audioEnd: end, id3v2Size: tagSize, hasId3v1: !!v1, version: h.version, layer: h.layer,
    sampleRate: h.sampleRate, channels: h.channels, mode: h.mode, firstFrame: h, samplesPerFrame: h.samples, vbr,
    frames: 0, duration: 0, bitrate: h.bitrate, cbr: true,
  };
  let frames = 0, bytes = 0, p = first;
  const rates = new Set();
  if (vbr) p += h.frameSize; // the tag frame carries no audio
  if (scan || !vbr || !vbr.frames) {
    while (p + 4 <= end) {
      const f = parseFrameHeader(b, p);
      if (!f || !sameStream(f, h)) {
        const n = findFrame(b, p + 1, end);
        if (n < 0) break;
        p = n;
        continue;
      }
      frames++;
      bytes += f.frameSize;
      rates.add(f.bitrate);
      p += f.frameSize;
    }
  }
  if (!scan && vbr && vbr.frames) { frames = vbr.frames; bytes = vbr.bytes || end - first; }
  out.frames = frames;
  out.cbr = rates.size <= 1 && (!vbr || vbr.type === 'Info');
  let samples = frames * h.samples;
  // Gapless duration: the encoder's delay and padding are not part of the original audio.
  if (vbr && vbr.encoderDelay != null) samples -= vbr.encoderDelay + vbr.encoderPadding;
  out.duration = Math.max(0, samples) / h.sampleRate;
  out.bitrate = out.duration ? Math.round((bytes * 8) / (frames * h.samples / h.sampleRate) / 1000) : h.bitrate;
  return out;
}
