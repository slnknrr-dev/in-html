// mp4/codecs.js - codec configuration records shared by the MP4 and WebM libraries: avcC, hvcC, av1C (with the AV1
// sequence header OBU parser), vpcC (with the VP9 frame header), AudioSpecificConfig / esds and dOps <-> OpusHead,
// plus the WebCodecs codec strings derived from them.

const asBytes = (b) => (b instanceof Uint8Array ? b : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b));
const hex2 = (n) => n.toString(16).padStart(2, '0').toUpperCase();
const dec2 = (n) => String(n).padStart(2, '0');

/** MSB-first bit reader (exp-Golomb, AV1 uvlc / leb128 helpers). */
// bits() accumulates with v * 2 + bit instead of shifts so values up to 2^53 stay exact (24-bit sample rates,
// 32-bit uvlc). ue() caps leading zeros at 31: a corrupt stream must throw, not loop or overflow.
export class BitReader {
  constructor(bytes, byteOffset = 0) { this.b = asBytes(bytes); this.p = byteOffset * 8; }
  bit() {
    const i = this.p >> 3;
    if (i >= this.b.length) throw new Error('bit reader: out of data');
    const v = (this.b[i] >> (7 - (this.p & 7))) & 1;
    this.p++;
    return v;
  }
  bits(n) { let v = 0; for (let i = 0; i < n; i++) v = v * 2 + this.bit(); return v; }
  skip(n) { this.p += n; }
  ue() { let z = 0; while (!this.bit()) { z++; if (z > 31) throw new Error('bad exp-Golomb code'); } return (2 ** z - 1) + this.bits(z); }
  se() { const k = this.ue(); return k & 1 ? (k + 1) / 2 : -k / 2; }
  uvlc() { let z = 0; while (!this.bit()) { z++; if (z >= 32) return 2 ** 32 - 1; } return (2 ** z - 1) + this.bits(z); }
  get bytePos() { return this.p >> 3; }
}

// ---------------------------------------------------------------------------------------------
// H.264 (avcC)

/** Parses an AVCDecoderConfigurationRecord: { profile, compat, level, nalLengthSize, sps: Uint8Array[], pps: Uint8Array[], codec }. */
export function parseAvcC(input) {
  const b = asBytes(input);
  if (b.length < 7 || b[0] !== 1) throw new Error('avcC: unsupported version');
  const out = { profile: b[1], compat: b[2], level: b[3], nalLengthSize: (b[4] & 3) + 1, sps: [], pps: [] };
  let p = 5;
  const nsps = b[p++] & 31;
  for (let i = 0; i < nsps && p + 2 <= b.length; i++) { const n = (b[p] << 8) | b[p + 1]; out.sps.push(b.subarray(p + 2, p + 2 + n)); p += 2 + n; }
  const npps = b[p++] || 0;
  for (let i = 0; i < npps && p + 2 <= b.length; i++) { const n = (b[p] << 8) | b[p + 1]; out.pps.push(b.subarray(p + 2, p + 2 + n)); p += 2 + n; }
  out.codec = `avc1.${hex2(out.profile)}${hex2(out.compat)}${hex2(out.level)}`.toLowerCase();
  if (out.sps[0]) { try { Object.assign(out, parseAvcSps(out.sps[0])); } catch { /* dimensions stay unknown */ } }
  return out;
}

// Removes emulation prevention bytes (00 00 03) of a NAL unit payload.
// H.264 / HEVC insert 0x03 after two zero bytes so the payload never contains a start code (00 00 01). The check
// looks at the output tail, so 00 00 03 03 keeps the second 03 (only the escaping byte is removed).
function unescapeRbsp(nal) {
  const out = [];
  for (let i = 0; i < nal.length; i++) {
    if (i >= 2 && nal[i] === 3 && nal[i - 1] === 0 && nal[i - 2] === 0 && out.length >= 2 && out[out.length - 1] === 0 && out[out.length - 2] === 0) continue;
    out.push(nal[i]);
  }
  return new Uint8Array(out);
}

/** Width / height / chroma format / bit depth from an H.264 SPS NAL unit (with its 1-byte header). */
export function parseAvcSps(nal) {
  const r = new BitReader(unescapeRbsp(nal), 1);
  const profile = r.bits(8); r.bits(8); r.bits(8); r.ue();
  let chroma = 1, bitDepth = 8;
  if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) {
    chroma = r.ue();
    if (chroma === 3) r.bit();
    bitDepth = r.ue() + 8; r.ue(); r.bit();
    if (r.bit()) {
      for (let i = 0; i < (chroma !== 3 ? 8 : 12); i++) {
        if (r.bit()) { let last = 8, next = 8; for (let j = 0; j < (i < 6 ? 16 : 64); j++) { if (next) next = (last + r.se() + 256) % 256; last = next || last; } }
      }
    }
  }
  r.ue();
  const poc = r.ue();
  if (poc === 0) r.ue();
  else if (poc === 1) { r.bit(); r.se(); r.se(); const n = r.ue(); for (let i = 0; i < n; i++) r.se(); }
  r.ue(); r.bit();
  const wmb = r.ue() + 1, hmu = r.ue() + 1;
  const frameMbsOnly = r.bit();
  if (!frameMbsOnly) r.bit();
  r.bit();
  let cl = 0, cr = 0, ct = 0, cb = 0;
  if (r.bit()) { cl = r.ue(); cr = r.ue(); ct = r.ue(); cb = r.ue(); }
  const cx = chroma === 0 || chroma === 3 ? 1 : 2, cy = (chroma === 1 ? 2 : 1) * (2 - frameMbsOnly);
  return { width: wmb * 16 - cx * (cl + cr), height: hmu * 16 * (2 - frameMbsOnly) - cy * (ct + cb), chromaFormat: chroma, bitDepth };
}

// ---------------------------------------------------------------------------------------------
// HEVC (hvcC)

/** Parses an HEVCDecoderConfigurationRecord: { profileSpace, tier, profile, compat, constraints, level, nalLengthSize, codec }. */
export function parseHvcC(input, fourcc = 'hvc1') {
  const b = asBytes(input);
  if (b.length < 23) throw new Error('hvcC: too short');
  const out = {
    profileSpace: b[1] >> 6, tier: (b[1] >> 5) & 1, profile: b[1] & 31,
    compat: ((b[2] << 24) | (b[3] << 16) | (b[4] << 8) | b[5]) >>> 0,
    constraints: Array.from(b.subarray(6, 12)), level: b[12], nalLengthSize: (b[21] & 3) + 1,
    bitDepth: (b[19] & 7) + 8, chromaFormat: b[16] & 3,
  };
  // Codec string (ISO/IEC 14496-15 annex E): compatibility flags bit-reversed, trailing zero constraint bytes dropped.
  let rev = 0;
  for (let i = 0; i < 32; i++) if (out.compat & (1 << i)) rev |= 1 << (31 - i);
  const cons = out.constraints.slice();
  while (cons.length && cons[cons.length - 1] === 0) cons.pop();
  out.codec = [fourcc, ['', 'A', 'B', 'C'][out.profileSpace] + out.profile, (rev >>> 0).toString(16).toUpperCase(),
    (out.tier ? 'H' : 'L') + out.level, ...cons.map((c) => hex2(c))].join('.');
  return out;
}

// ---------------------------------------------------------------------------------------------
// AV1 (av1C, sequence header OBU)

// Little-endian base-128 (7 bits per byte, high bit = more), at most 8 bytes in AV1. Multiplication instead of <<
// keeps values above 2^31 correct.
function leb128(b, p) {
  let v = 0, n = 0;
  for (let i = 0; i < 8; i++) {
    const x = b[p + i];
    v += (x & 0x7f) * 2 ** (7 * i);
    n++;
    if (!(x & 0x80)) break;
  }
  return [v, n];
}

/** Splits a low-overhead AV1 bitstream (OBUs with size fields) into [{ type, start, end, header, payloadStart }]. */
export function av1Obus(input) {
  const b = asBytes(input);
  const out = [];
  let p = 0;
  while (p < b.length) {
    const h = b[p];
    const type = (h >> 3) & 15, ext = (h >> 2) & 1, hasSize = (h >> 1) & 1;
    let q = p + 1 + ext, size;
    if (hasSize) { const [v, n] = leb128(b, q); size = v; q += n; } else size = b.length - q;
    if (q + size > b.length) break;
    out.push({ type, start: p, end: q + size, payloadStart: q });
    p = q + size;
  }
  return out;
}

/**
 * Parses the first sequence header OBU of an AV1 temporal unit (keyframe) or of av1C configOBUs.
 * Returns { profile, level, tier, highBitdepth, twelveBit, bitDepth, monochrome, subsamplingX, subsamplingY,
 * chromaSamplePosition, width, height, colour: { primaries, transfer, matrix, fullRange }, obu (bytes) } or null.
 */
export function parseAv1SequenceHeader(input) {
  const b = asBytes(input);
  const obu = av1Obus(b).find((o) => o.type === 1);
  if (!obu) return null;
  const r = new BitReader(b, obu.payloadStart);
  const profile = r.bits(3);
  r.bit(); // still_picture
  const reduced = r.bit();
  let level = 0, tier = 0;
  if (reduced) level = r.bits(5);
  else {
    let decoderModel = 0, bufferDelayLen = 0;
    if (r.bit()) { // timing_info
      r.bits(32); r.bits(32);
      if (r.bit()) r.uvlc();
      decoderModel = r.bit();
      if (decoderModel) { bufferDelayLen = r.bits(5) + 1; r.bits(32); r.bits(5); r.bits(5); }
    }
    const initialDisplay = r.bit();
    const ops = r.bits(5) + 1;
    for (let i = 0; i < ops; i++) {
      r.bits(12);
      const lv = r.bits(5);
      const tr = lv > 7 ? r.bit() : 0;
      if (i === 0) { level = lv; tier = tr; }
      if (decoderModel && r.bit()) { r.bits(bufferDelayLen); r.bits(bufferDelayLen); r.bit(); }
      if (initialDisplay && r.bit()) r.bits(4);
    }
  }
  const wb = r.bits(4) + 1, hb = r.bits(4) + 1;
  const width = r.bits(wb) + 1, height = r.bits(hb) + 1;
  if (!reduced && r.bit()) { r.bits(4); r.bits(3); }
  r.bit(); r.bit(); r.bit();
  if (!reduced) {
    r.bit(); r.bit(); r.bit(); r.bit();
    const orderHint = r.bit();
    if (orderHint) { r.bit(); r.bit(); }
    const force = r.bit() ? 2 : r.bit();
    if (force > 0 && !r.bit()) r.bit();
    if (orderHint) r.bits(3);
  }
  r.bit(); r.bit(); r.bit(); // superres, cdef, restoration
  const highBitdepth = r.bit();
  const twelveBit = profile === 2 && highBitdepth ? r.bit() : 0;
  const bitDepth = twelveBit ? 12 : highBitdepth ? 10 : 8;
  const monochrome = profile === 1 ? 0 : r.bit();
  let primaries = 2, transfer = 2, matrix = 2;
  if (r.bit()) { primaries = r.bits(8); transfer = r.bits(8); matrix = r.bits(8); }
  let fullRange = 0, sx = 1, sy = 1, csp = 0;
  if (monochrome) fullRange = r.bit();
  else if (primaries === 1 && transfer === 13 && matrix === 0) { fullRange = 1; sx = 0; sy = 0; }
  else {
    fullRange = r.bit();
    if (profile === 0) { sx = 1; sy = 1; } else if (profile === 1) { sx = 0; sy = 0; } else if (bitDepth === 12) { sx = r.bit(); sy = sx ? r.bit() : 0; } else { sx = 1; sy = 0; }
    if (sx && sy) csp = r.bits(2);
  }
  return {
    profile, level, tier, highBitdepth, twelveBit, bitDepth, monochrome, subsamplingX: sx, subsamplingY: sy,
    chromaSamplePosition: csp, width, height, colour: { primaries, transfer, matrix, fullRange }, obu: b.slice(obu.start, obu.end),
  };
}

/** Builds an AV1CodecConfigurationRecord from a parsed sequence header (configOBUs = the sequence header OBU). */
export function buildAv1C(sh) {
  const obu = sh.obu || new Uint8Array(0);
  const out = new Uint8Array(4 + obu.length);
  out[0] = 0x81; // marker + version 1
  out[1] = (sh.profile << 5) | sh.level;
  out[2] = (sh.tier << 7) | (sh.highBitdepth << 6) | (sh.twelveBit << 5) | (sh.monochrome << 4) | (sh.subsamplingX << 3) | (sh.subsamplingY << 2) | sh.chromaSamplePosition;
  out[3] = 0;
  out.set(obu, 4);
  return out;
}

/** Parses an av1C record: the fields of buildAv1C plus the codec string. */
export function parseAv1C(input) {
  const b = asBytes(input);
  if (b.length < 4 || (b[0] & 0x7f) !== 1) throw new Error('av1C: unsupported version');
  const out = {
    profile: b[1] >> 5, level: b[1] & 31, tier: b[2] >> 7, highBitdepth: (b[2] >> 6) & 1, twelveBit: (b[2] >> 5) & 1,
    monochrome: (b[2] >> 4) & 1, subsamplingX: (b[2] >> 3) & 1, subsamplingY: (b[2] >> 2) & 1, chromaSamplePosition: b[2] & 3,
    configOBUs: b.subarray(4),
  };
  out.bitDepth = out.twelveBit ? 12 : out.highBitdepth ? 10 : 8;
  if (out.configOBUs.length) { try { const sh = parseAv1SequenceHeader(out.configOBUs); if (sh) Object.assign(out, { width: sh.width, height: sh.height, colour: sh.colour }); } catch { /* keep the record fields */ } }
  out.codec = av1CodecString(out);
  return out;
}

export const av1CodecString = (s) => `av01.${s.profile}.${dec2(s.level)}${s.tier ? 'H' : 'M'}.${dec2(s.bitDepth || 8)}`;

// ---------------------------------------------------------------------------------------------
// VP9 (vpcC, uncompressed frame header)

/** Parses 'vp09.PP.LL.DD[.CC.cp.tc.mc.FF]' into { profile, level, bitDepth, chromaSubsampling, primaries, transfer, matrix, fullRange }. */
export function parseVp9CodecString(codec) {
  const f = String(codec || '').split('.').slice(1).map((x) => parseInt(x, 10));
  return {
    profile: f[0] || 0, level: f[1] || 10, bitDepth: f[2] || 8, chromaSubsampling: f[3] ?? 1,
    primaries: f[4] ?? 1, transfer: f[5] ?? 1, matrix: f[6] ?? 1, fullRange: f[7] ?? 0,
  };
}

// Levels 1 .. 6.2; an unknown level (0, as some writers leave it) becomes 1.0 so that decoders accept the string.
const VP9_LEVELS = [10, 11, 20, 21, 30, 31, 40, 41, 50, 51, 52, 60, 61, 62];
export const vp9CodecString = (v) => `vp09.${dec2(v.profile)}.${dec2(VP9_LEVELS.includes(v.level) ? v.level : 10)}.${dec2(v.bitDepth || 8)}`;

/** VP Codec Configuration Box payload (version 1 full box body, without the box header). */
export function buildVpcC(v) {
  const out = new Uint8Array(12);
  out[0] = 1; // version; flags (3 bytes) stay 0
  out[4] = v.profile;
  out[5] = v.level;
  out[6] = (v.bitDepth << 4) | ((v.chromaSubsampling ?? 1) << 1) | (v.fullRange ? 1 : 0);
  out[7] = v.primaries ?? 1;
  out[8] = v.transfer ?? 1;
  out[9] = v.matrix ?? 1;
  return out; // codecInitializationDataSize = 0
}

/** Parses a vpcC full box body (version byte first). */
export function parseVpcC(input) {
  const b = asBytes(input);
  const o = 4;
  const v = {
    profile: b[o], level: b[o + 1], bitDepth: b[o + 2] >> 4, chromaSubsampling: (b[o + 2] >> 1) & 7, fullRange: b[o + 2] & 1,
    primaries: b[o + 3], transfer: b[o + 4], matrix: b[o + 5],
  };
  v.codec = vp9CodecString(v);
  return v;
}

/** VP9 uncompressed header basics: { keyframe, profile, bitDepth, width, height, showFrame } (width / height on keyframes). */
export function parseVp9Frame(input) {
  const r = new BitReader(input);
  if (r.bits(2) !== 2) return null;
  const lo = r.bit(), hi = r.bit();
  const profile = (hi << 1) | lo;
  if (profile === 3) r.bit();
  if (r.bit()) return { keyframe: false, profile, showExisting: true };
  const keyframe = r.bit() === 0;
  const showFrame = r.bit();
  r.bit(); // error_resilient_mode
  const out = { keyframe, profile, showFrame, bitDepth: 8 };
  if (keyframe) {
    if (r.bits(24) !== 0x498342) return out;
    if (profile >= 2) out.bitDepth = r.bit() ? 12 : 10;
    const cs = r.bits(3);
    if (cs !== 7) { r.bit(); if (profile === 1 || profile === 3) { r.bits(3); } } else if (profile === 1 || profile === 3) r.bit();
    out.width = r.bits(16) + 1;
    out.height = r.bits(16) + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// AAC (AudioSpecificConfig, esds)

const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/** Parses an AudioSpecificConfig: { objectType, sampleRate, channels, codec: 'mp4a.40.N' }. */
// Object type 31 is an escape to a 6-bit extension; frequency index 15 is an escape to an explicit 24-bit rate;
// channel configuration 7 means 8 channels (7.1). For HE-AAC (5 = SBR, 29 = PS) the output rate is the extension
// rate (twice the core rate), which is what players must report.
export function parseAudioSpecificConfig(input) {
  const r = new BitReader(input);
  let ot = r.bits(5);
  if (ot === 31) ot = 32 + r.bits(6);
  const fi = r.bits(4);
  const sampleRate = fi === 15 ? r.bits(24) : AAC_RATES[fi] || 0;
  const channels = r.bits(4);
  let codecOt = ot;
  // Explicit SBR / PS signalling (HE-AAC v1 / v2): the extension sample rate is the output rate.
  let rate = sampleRate;
  if (ot === 5 || ot === 29) {
    const ei = r.bits(4);
    rate = ei === 15 ? r.bits(24) : AAC_RATES[ei] || sampleRate;
    codecOt = ot;
  }
  return { objectType: ot, sampleRate: rate, coreSampleRate: sampleRate, channels: channels === 7 ? 8 : channels, codec: `mp4a.40.${codecOt}` };
}

/** Builds a 2-byte AudioSpecificConfig (AAC-LC by default). */
// Common rates fit the 2-byte form (5 + 4 + 4 bits + padding); others need the explicit 24-bit rate, written by a
// small MSB-first bit packer.
export function buildAudioSpecificConfig({ objectType = 2, sampleRate, channels }) {
  const fi = AAC_RATES.indexOf(sampleRate);
  if (fi < 0) {
    const out = new Uint8Array(5);
    const v = [objectType, 5, 15, 4, sampleRate, 24, channels, 4];
    let acc = 0, n = 0, o = 0;
    for (let i = 0; i < v.length; i += 2) {
      for (let k = v[i + 1] - 1; k >= 0; k--) { acc = (acc << 1) | ((v[i] >> k) & 1); n++; if (n === 8) { out[o++] = acc; acc = 0; n = 0; } }
    }
    if (n) out[o++] = acc << (8 - n);
    return out.subarray(0, o);
  }
  return new Uint8Array([(objectType << 3) | (fi >> 1), ((fi & 1) << 7) | (channels << 3)]);
}

/** Parses an esds full box body: { objectTypeIndication, streamType, bufferSize, maxBitrate, avgBitrate, asc, codec }. */
export function parseEsds(input) {
  const b = asBytes(input);
  let p = 4; // version + flags
  const out = { objectTypeIndication: 0, asc: null };
  const len = () => { let n = 0; for (let i = 0; i < 4; i++) { const x = b[p++]; n = (n << 7) | (x & 0x7f); if (!(x & 0x80)) break; } return n; };
  while (p < b.length) {
    const tag = b[p++];
    const n = len();
    const end = p + n;
    if (tag === 3) { const flags = b[p + 2]; p += 3; if (flags & 0x80) p += 2; if (flags & 0x40) p += 1 + b[p]; if (flags & 0x20) p += 2; continue; }
    if (tag === 4) {
      const dv = new DataView(b.buffer, b.byteOffset + p, 13);
      Object.assign(out, { objectTypeIndication: b[p], streamType: b[p + 1] >> 2, bufferSize: (b[p + 2] << 16) | (b[p + 3] << 8) | b[p + 4], maxBitrate: dv.getUint32(5), avgBitrate: dv.getUint32(9) });
      p += 13;
      continue;
    }
    if (tag === 5) out.asc = b.slice(p, end);
    p = end;
  }
  const oti = out.objectTypeIndication;
  if (oti === 0x40 || oti === 0x66 || oti === 0x67 || oti === 0x68) {
    if (out.asc) { try { Object.assign(out, parseAudioSpecificConfig(out.asc)); } catch { /* keep defaults */ } }
    out.codec ||= 'mp4a.40.2';
  } else out.codec = 'mp4a.' + hex2(oti);
  return out;
}

// MPEG-4 descriptor with a 4-byte length (always the long form: simple and accepted by every parser).
function descriptor(tag, body) {
  const n = body.length;
  const out = new Uint8Array(5 + n);
  out[0] = tag;
  out[1] = 0x80 | ((n >> 21) & 0x7f); out[2] = 0x80 | ((n >> 14) & 0x7f); out[3] = 0x80 | ((n >> 7) & 0x7f); out[4] = n & 0x7f;
  out.set(body, 5);
  return out;
}

/** esds full box body (version/flags + ES_Descriptor) for an AAC track. */
export function buildEsds({ asc, trackId = 1, bitrate = 0, maxBitrate = 0, bufferSize = 0 }) {
  const dcd = new Uint8Array(13);
  const dv = new DataView(dcd.buffer);
  dcd[0] = 0x40; // MPEG-4 Audio
  dcd[1] = (5 << 2) | 1; // audio stream
  dcd[2] = (bufferSize >> 16) & 0xff; dcd[3] = (bufferSize >> 8) & 0xff; dcd[4] = bufferSize & 0xff;
  dv.setUint32(5, maxBitrate || bitrate);
  dv.setUint32(9, bitrate);
  const dsi = descriptor(5, asBytes(asc));
  const dcdFull = descriptor(4, concatBytes([dcd, dsi]));
  const sl = descriptor(6, new Uint8Array([2]));
  const es = descriptor(3, concatBytes([new Uint8Array([(trackId >> 8) & 0xff, trackId & 0xff, 0]), dcdFull, sl]));
  return concatBytes([new Uint8Array(4), es]);
}

// ---------------------------------------------------------------------------------------------
// Opus in ISO BMFF (dOps is big-endian; OpusHead little-endian)

/** dOps box body from { channels, preSkip, inputSampleRate, outputGain, mappingFamily, streamCount, coupledCount, mapping }. */
export function buildDOps(h) {
  const fam = h.mappingFamily || 0;
  const out = new Uint8Array(11 + (fam ? 2 + h.channels : 0));
  const dv = new DataView(out.buffer);
  out[0] = 0;
  out[1] = h.channels;
  dv.setUint16(2, h.preSkip ?? 312);
  dv.setUint32(4, h.inputSampleRate || 48000);
  dv.setInt16(8, h.outputGain || 0);
  out[10] = fam;
  if (fam) { out[11] = h.streamCount; out[12] = h.coupledCount; out.set(h.mapping, 13); }
  return out;
}

/** Parses a dOps body to the OpusHead fields. */
export function parseDOps(input) {
  const b = asBytes(input);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const h = { version: b[0], channels: b[1], preSkip: dv.getUint16(2), inputSampleRate: dv.getUint32(4), outputGain: dv.getInt16(8), mappingFamily: b[10] };
  if (h.mappingFamily) { h.streamCount = b[11]; h.coupledCount = b[12]; h.mapping = Array.from(b.subarray(13, 13 + h.channels)); }
  return h;
}

/** OpusHead bytes (the WebCodecs / Matroska description) from dOps fields. */
export function opusHeadFromDOps(h) {
  const fam = h.mappingFamily || 0;
  const out = new Uint8Array(19 + (fam ? 2 + h.channels : 0));
  const dv = new DataView(out.buffer);
  out.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, h.channels]);
  dv.setUint16(10, h.preSkip, true);
  dv.setUint32(12, h.inputSampleRate, true);
  dv.setInt16(16, h.outputGain, true);
  out[18] = fam;
  if (fam) { out[19] = h.streamCount; out[20] = h.coupledCount; out.set(h.mapping, 21); }
  return out;
}

/** OpusHead (little-endian) -> fields usable by buildDOps. */
export function dOpsFromOpusHead(input) {
  const b = asBytes(input);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const h = { channels: b[9], preSkip: dv.getUint16(10, true), inputSampleRate: dv.getUint32(12, true), outputGain: dv.getInt16(16, true), mappingFamily: b[18] };
  if (h.mappingFamily && b.length >= 21 + h.channels) { h.streamCount = b[19]; h.coupledCount = b[20]; h.mapping = Array.from(b.subarray(21, 21 + h.channels)); }
  return h;
}

export function concatBytes(parts) {
  let n = 0;
  for (const x of parts) n += x.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const x of parts) { out.set(x, o); o += x.length; }
  return out;
}

/** Human-readable codec name of a WebCodecs codec string or a 4CC / Matroska codec id. */
export function codecName(codec) {
  const c = String(codec || '').toLowerCase();
  if (/^(avc[13]|v_mpeg4\/iso\/avc)/.test(c)) return 'H.264 / AVC';
  if (/^(hvc1|hev1|v_mpegh\/iso\/hevc)/.test(c)) return 'H.265 / HEVC';
  if (/^(av01|v_av1)/.test(c)) return 'AV1';
  if (/^(vp09|vp9|v_vp9)/.test(c)) return 'VP9';
  if (/^(vp8|vp08|v_vp8)/.test(c)) return 'VP8';
  if (/^(mp4a\.40\.(5|29))/.test(c)) return 'HE-AAC';
  if (/^(mp4a\.40|a_aac)/.test(c)) return 'AAC';
  if (/^(mp4a\.6b|mp4a\.69|mp3|\.mp3|a_mpeg\/l3)/.test(c)) return 'MP3';
  if (/^(opus|a_opus)/.test(c)) return 'Opus';
  if (/^(vorbis|a_vorbis)/.test(c)) return 'Vorbis';
  if (/^(flac|fla|a_flac)/.test(c)) return 'FLAC';
  if (/^(ac-3|a_ac3)/.test(c)) return 'AC-3';
  if (/^(ec-3|a_eac3)/.test(c)) return 'E-AC-3';
  if (/^(pcm|ipcm|lpcm|sowt|twos|a_pcm)/.test(c)) return 'PCM';
  if (/^(mp4v|v_mpeg4\/iso\/(sp|asp|ap))/.test(c)) return 'MPEG-4 Part 2';
  return codec || '?';
}
