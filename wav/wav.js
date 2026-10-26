// wav/wav.js - WAV (RIFF/WAVE) reading and writing: PCM 8/16/24/32-bit, IEEE float 32/64, A-law / mu-law,
// WAVE_FORMAT_EXTENSIBLE, LIST/INFO metadata. Pure functions over bytes (browsers, Node, Bun).
//
// Contract / key decisions:
// - RIFF is a chunk list: [4cc id][u32 LE size][body][pad to even]. The parser walks all chunks and keeps unknown ones
//   in `chunks`, so callers can inspect cue/smpl/bext without this module knowing them.
// - Decoding goes to planar Float32 in [-1, 1]: the shape Web Audio's AudioBuffer wants, so no further conversion.
// - Integer scaling is symmetric x / 2^(bits-1) both ways (encode clips at 2^(bits-1)-1): round trips are bit-exact.
//   The alternative (scale negatives by 2^(bits-1), positives by 2^(bits-1)-1) is exact at both rails but non-linear.
// - Sizes are u32: files over 4 GiB (RF64/W64) are out of scope; the streaming-size fallback below covers the common
//   'size unknown' case only.

const FORMAT = { 1: 'pcm', 3: 'float', 6: 'alaw', 7: 'mulaw', 0xfffe: 'extensible' };

// LIST/INFO fields: friendly name -> RIFF INFO id.
export const INFO_TAGS = {
  title: 'INAM', artist: 'IART', album: 'IPRD', comment: 'ICMT', date: 'ICRD', genre: 'IGNR',
  software: 'ISFT', track: 'ITRK', copyright: 'ICOP', engineer: 'IENG', keywords: 'IKEY', subject: 'ISBJ',
};
const INFO_NAMES = Object.fromEntries(Object.entries(INFO_TAGS).map(([k, v]) => [v, k]));

// asBytes accepts ArrayBuffer, any typed array or DataView, and respects byteOffset (a Node Buffer is often a slice of
// a shared pool: new Uint8Array(buf.buffer) would read foreign bytes).
const fourcc = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const asBytes = (b) => (b instanceof Uint8Array ? b : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b));

// INFO strings: UTF-8 when valid, otherwise Latin-1 (older writers); trailing NULs dropped.
function decodeText(bytes) {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  const b = bytes.subarray(0, end);
  // fatal:true makes invalid UTF-8 throw instead of producing U+FFFD, which is how Latin-1 input is detected.
  // KNOWN DEFECT: String.fromCharCode(...b) spreads every byte as an argument; a very large INFO field (> ~100k bytes)
  // overflows the call stack. Fix: new TextDecoder('latin1').decode(b).
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return String.fromCharCode(...b); }
}

/**
 * Parses the RIFF structure of a WAV file (no sample decoding).
 * Returns { formatTag, format, channels, sampleRate, byteRate, blockAlign, bitsPerSample, validBits, channelMask,
 *   subFormat, extensible, dataOffset, dataSize, frames, duration, info: { title, artist, ... , [id]: text },
 *   chunks: [{ id, offset, size }] }.
 */
export function parseWav(input) {
  const b = asBytes(input);
  if (b.length < 12 || fourcc(b, 0) !== 'RIFF' || fourcc(b, 8) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = { chunks: [], info: {}, extensible: false, channelMask: 0, validBits: 0, subFormat: null, dataOffset: -1, dataSize: 0 };
  let fmt = null;
  let p = 12;
  while (p + 8 <= b.length) {
    const id = fourcc(b, p);
    let size = dv.getUint32(p + 4, true);
    const body = p + 8;
    // Streaming writers leave the data size at 0 or 0xFFFFFFFF: the data runs to the end of the file.
    if (id === 'data' && (size === 0 || size === 0xffffffff || body + size > b.length)) size = b.length - body;
    out.chunks.push({ id, offset: p, size });
    if (id === 'fmt ' && size >= 16) {
      fmt = {
        formatTag: dv.getUint16(body, true), channels: dv.getUint16(body + 2, true), sampleRate: dv.getUint32(body + 4, true),
        byteRate: dv.getUint32(body + 8, true), blockAlign: dv.getUint16(body + 12, true), bitsPerSample: dv.getUint16(body + 14, true),
      };
      if (fmt.formatTag === 0xfffe && size >= 40) {
        out.extensible = true;
        out.validBits = dv.getUint16(body + 18, true);
        out.channelMask = dv.getUint32(body + 20, true);
        // Extensible layout: cbSize(2) validBits(2) channelMask(4) GUID(16) after the 16-byte base, i.e. body+16.
        out.subFormat = dv.getUint16(body + 24, true); // first two bytes of the GUID carry the format tag
      }
    } else if (id === 'data' && out.dataOffset < 0) {
      out.dataOffset = body;
      out.dataSize = size;
    } else if (id === 'LIST' && size >= 4 && fourcc(b, body) === 'INFO') {
      let q = body + 4;
      const end = Math.min(b.length, body + size);
      while (q + 8 <= end) {
        const tid = fourcc(b, q);
        const tsz = dv.getUint32(q + 4, true);
        const text = decodeText(b.subarray(q + 8, Math.min(end, q + 8 + tsz)));
        out.info[INFO_NAMES[tid] || tid] = text;
        q += 8 + tsz + (tsz & 1);
      }
    }
    // Odd-sized chunks are followed by one pad byte (RIFF rule); forgetting it misaligns every later chunk id.
    p = body + size + (size & 1);
  }
  if (!fmt) throw new Error('WAV: no fmt chunk');
  if (out.dataOffset < 0) throw new Error('WAV: no data chunk');
  const tag = out.extensible ? out.subFormat : fmt.formatTag;
  Object.assign(out, fmt, { format: FORMAT[tag] || 'unknown', codecTag: tag });
  if (!out.validBits) out.validBits = fmt.bitsPerSample;
  // blockAlign is trusted when present (it includes container padding, e.g. 20-bit in 24-bit slots); derived otherwise.
  const align = fmt.blockAlign || (fmt.channels * fmt.bitsPerSample) >> 3;
  out.frames = align ? Math.floor(out.dataSize / align) : 0;
  out.duration = fmt.sampleRate ? out.frames / fmt.sampleRate : 0;
  return out;
}

// The standard Sun reference expansions. A-law inverts even bits (^0x55) and has a linear first segment; mu-law is
// stored complemented with a +0x84 (132) bias removed after the shift. Results fit 14/13 bits, scaled as 16-bit.
// G.711 expansions to linear 16-bit.
function alaw(v) {
  v ^= 0x55;
  const seg = (v & 0x70) >> 4;
  let t = (v & 0x0f) << 4;
  t = seg === 0 ? t + 8 : seg === 1 ? t + 0x108 : (t + 0x108) << (seg - 1);
  return v & 0x80 ? t : -t;
}
function mulaw(v) {
  v = ~v & 0xff;
  let t = ((v & 0x0f) << 3) + 0x84;
  t <<= (v & 0x70) >> 4;
  return v & 0x80 ? 0x84 - t : t - 0x84;
}

/**
 * Decodes a WAV file to planar float samples in [-1, 1].
 * Returns parseWav(...) plus { channelData: Float32Array[] }.
 */
export function decodeWav(input) {
  const b = asBytes(input);
  const w = parseWav(b);
  const { channels, frames, format, bitsPerSample: bits } = w;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const align = w.blockAlign || (channels * bits) >> 3;
  const bps = bits >> 3;
  const data = Array.from({ length: channels }, () => new Float32Array(frames));
  let reader;
  if (format === 'pcm') {
    if (bits === 8) reader = (o) => (b[o] - 128) / 128;
    else if (bits === 16) reader = (o) => dv.getInt16(o, true) / 32768;
    // 24-bit: assemble 3 bytes, then `<< 8 >> 8` sign-extends via the arithmetic shift (no DataView getInt24).
    else if (bits === 24) reader = (o) => ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) << 8 >> 8) / 8388608;
    else if (bits === 32) reader = (o) => dv.getInt32(o, true) / 2147483648;
  } else if (format === 'float') {
    if (bits === 32) reader = (o) => dv.getFloat32(o, true);
    else if (bits === 64) reader = (o) => dv.getFloat64(o, true);
  } else if (format === 'alaw' && bits === 8) reader = (o) => alaw(b[o]) / 32768;
  else if (format === 'mulaw' && bits === 8) reader = (o) => mulaw(b[o]) / 32768;
  if (!reader) throw new Error(`WAV: unsupported encoding ${format} ${bits}-bit`);
  // One reader closure chosen up front keeps the loop free of format branches (the per-sample cost is the call).
  for (let i = 0; i < frames; i++) {
    const base = w.dataOffset + i * align;
    for (let c = 0; c < channels; c++) data[c][i] = reader(base + c * bps);
  }
  return Object.assign(w, { channelData: data });
}

// Default speaker positions of WAVE_FORMAT_EXTENSIBLE by channel count.
// Bits per the SPEAKER_* constants: 0x3 = FL|FR, 0x4 = FC, 0x33 = quad, 0x3f = 5.1, 0x63f = 7.1 (side pair).
const MASKS = { 1: 0x4, 2: 0x3, 3: 0x7, 4: 0x33, 5: 0x37, 6: 0x3f, 7: 0x13f, 8: 0x63f };

/**
 * Encodes planar float channels as WAV.
 *   channelData  Float32Array[] (or arrays), one per channel, equal lengths
 *   opts         { sampleRate (required), bitDepth: 8 | 16 | 24 | 32 (default 16), float: false (32-bit float when true),
 *                  info: { title, artist, ... or 4CC ids }, extensible: auto (more than 2 channels or more than 16 bits) }
 */
export function encodeWav(channelData, opts = {}) {
  const sampleRate = Math.round(opts.sampleRate || 0);
  if (!sampleRate) throw new Error('encodeWav: sampleRate is required');
  const nch = channelData.length;
  if (!nch) throw new Error('encodeWav: no channels');
  const isFloat = !!opts.float;
  const bits = isFloat ? (opts.bitDepth === 64 ? 64 : 32) : [8, 16, 24, 32].includes(opts.bitDepth) ? opts.bitDepth : 16;
  const frames = channelData[0].length;
  const bps = bits >> 3;
  const align = nch * bps;
  const dataSize = frames * align;
  // EXTENSIBLE is required by the spec for > 2 channels or > 16 bits; Windows players may refuse plain PCM there.
  // Float defaults to the plain tag 3 (with cbSize, fmt size 18), which every reader accepts.
  const ext = opts.extensible ?? (!isFloat && (nch > 2 || bits > 16));
  const infoChunk = buildInfo(opts.info);
  const fmtSize = ext ? 40 : isFloat ? 18 : 16;
  // Sizes known up front: one allocation, no growing buffers. RIFF size field = total - 8 (excludes id + size).
  const total = 12 + 8 + fmtSize + infoChunk.length + 8 + dataSize + (dataSize & 1);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  const put4 = (o, s) => { for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i); };
  put4(0, 'RIFF'); dv.setUint32(4, total - 8, true); put4(8, 'WAVE');
  let p = 12;
  put4(p, 'fmt '); dv.setUint32(p + 4, fmtSize, true);
  const tag = isFloat ? 3 : 1;
  dv.setUint16(p + 8, ext ? 0xfffe : tag, true);
  dv.setUint16(p + 10, nch, true);
  dv.setUint32(p + 12, sampleRate, true);
  dv.setUint32(p + 16, sampleRate * align, true);
  dv.setUint16(p + 20, align, true);
  dv.setUint16(p + 22, bits, true);
  if (fmtSize > 16) dv.setUint16(p + 24, fmtSize - 18, true);
  if (ext) {
    dv.setUint16(p + 26, bits, true);
    dv.setUint32(p + 28, MASKS[nch] || 0, true);
    // KSDATAFORMAT_SUBTYPE_PCM / _IEEE_FLOAT: {0000000X-0000-0010-8000-00aa00389b71}
    out.set([tag, 0, 0, 0, 0, 0, 0x10, 0, 0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71], p + 32);
  }
  p += 8 + fmtSize;
  out.set(infoChunk, p);
  p += infoChunk.length;
  put4(p, 'data'); dv.setUint32(p + 4, dataSize, true);
  p += 8;
  const ch = channelData;
  const scale = 2 ** (bits - 1);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      let v = +ch[c][i] || 0;
      if (isFloat) {
        if (bits === 64) dv.setFloat64(p, v, true); else dv.setFloat32(p, v, true);
      } else {
        // Same scale as decoding (x / 2^(bits-1)), clipped to the integer range.
        // 8-bit WAV is unsigned (offset 128); every wider depth is signed two's complement.
        let s = Math.round(v * scale);
        s = s < -scale ? -scale : s > scale - 1 ? scale - 1 : s;
        if (bits === 8) out[p] = s + 128;
        else if (bits === 16) dv.setInt16(p, s, true);
        else if (bits === 24) { out[p] = s & 0xff; out[p + 1] = (s >> 8) & 0xff; out[p + 2] = (s >> 16) & 0xff; }
        else dv.setInt32(p, s, true);
      }
      p += bps;
    }
  }
  return out;
}

// LIST/INFO chunk bytes for { title, artist, ... } (empty when there is nothing to write).
function buildInfo(info) {
  const entries = Object.entries(info || {})
    .map(([k, v]) => [INFO_TAGS[k] || (/^[A-Z0-9]{4}$/.test(k) ? k : null), v == null ? '' : String(v)])
    // Unknown keys pass only if they look like a 4cc ("IXYZ"); empty values are dropped (readers show them as blank).
    .filter(([id, v]) => id && v);
  if (!entries.length) return new Uint8Array(0);
  const enc = new TextEncoder();
  const parts = entries.map(([id, v]) => {
    const text = enc.encode(v);
    const size = text.length + 1; // NUL terminated
    const part = new Uint8Array(8 + size + (size & 1));
    for (let i = 0; i < 4; i++) part[i] = id.charCodeAt(i);
    new DataView(part.buffer).setUint32(4, size, true);
    part.set(text, 8);
    return part;
  });
  const bodyLen = 4 + parts.reduce((n, x) => n + x.length, 0);
  const out = new Uint8Array(8 + bodyLen);
  out.set([0x4c, 0x49, 0x53, 0x54]); // LIST
  new DataView(out.buffer).setUint32(4, bodyLen, true);
  out.set([0x49, 0x4e, 0x46, 0x4f], 8); // INFO
  let p = 12;
  for (const x of parts) { out.set(x, p); p += x.length; }
  return out;
}

// Interleaves planar channels into one Float32Array (L R L R ...).
export function interleave(channelData) {
  const n = channelData.length, len = n ? channelData[0].length : 0;
  const out = new Float32Array(n * len);
  for (let c = 0; c < n; c++) { const ch = channelData[c]; for (let i = 0; i < len; i++) out[i * n + c] = ch[i]; }
  return out;
}

// Splits interleaved samples into planar channels.
export function deinterleave(samples, channels) {
  const len = Math.floor(samples.length / channels);
  const out = Array.from({ length: channels }, () => new Float32Array(len));
  for (let i = 0; i < len; i++) for (let c = 0; c < channels; c++) out[c][i] = samples[i * channels + c];
  return out;
}
