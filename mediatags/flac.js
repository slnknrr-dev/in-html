// mediatags/flac.js - native FLAC metadata blocks: STREAMINFO, VORBIS_COMMENT (ogg/vorbis.js), PICTURE, CUESHEET;
// reading from bytes or, block by block, from a random-access source; writing for tests and taggers.
//
//   parseFlacMeta(bytes) -> { streamInfo: { minBlock, maxBlock, minFrame, maxFrame, sampleRate, channels,
//       bitsPerSample, totalSamples, duration (s), md5 (hex) }, tags: parseVorbisComment() result | null,
//       pictures: [{ type, mime, description, width, height, data }], cuesheet: { catalog, leadIn, isCd,
//       tracks: [{ number, offset (samples), isrc, audio, preEmphasis, indices: [{ number, offset (samples) }] }] } | null,
//       audioOffset, blocks: [{ type, offset, length }] }        (an ID3v2 prefix is skipped)
//   flacFlow(start, size, { pictures = 'all' | 'best' | 'none', maxBlock }) -> reader flow (source.js) with the
//       same result plus pictureCount; 'best' reads only the front cover (or the first picture), 'none' only counts.
//   parseStreamInfo(bytes) / parsePictureBlock(bytes) / parseCuesheetBlock(bytes)
//   buildFlacMeta({ streamInfo: { sampleRate, channels, bitsPerSample, totalSamples, minBlock, maxBlock },
//       vendor, tags, comments: [[KEY, value]], pictures, cuesheet, padding = 0 }) -> 'fLaC' + metadata blocks

//
// Layout reminder: 'fLaC', then blocks of [1 bit last-flag | 7 bit type | 24 bit big-endian length] + body. Audio
// frames start right after the block with the last flag. Everything is big-endian (unlike the little-endian Vorbis
// comment block, which ogg/vorbis.js parses).
// Why one flow for sync and async: over HTTP the cheap path is to read only headers (4 bytes each) and skip bodies
// we do not need (a 5 MB cover). The same generator answers both, so the in-memory parser is literally runSync(flow).
import { buildFlacPicture, buildVorbisComment, parseFlacPicture, parseVorbisComment } from '../ogg/vorbis.js';
import { id3v2Size } from '../mp3/id3.js';
import { asBytes, runSync } from './source.js';

const u24 = (b, p) => (b[p] << 16) | (b[p + 1] << 8) | b[p + 2];
const u32 = (b, p) => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
// 64-bit as hi * 2^32 + lo in a double: exact up to 2^53, far beyond any sample count. BigInt would infect every
// consumer. '>>> 0' in u32 converts the signed result of '<<' back to unsigned.
const u64 = (b, p) => u32(b, p) * 4294967296 + u32(b, p + 4);
const ascii0 = (b) => { let s = ''; for (const c of b) { if (!c) break; s += String.fromCharCode(c); } return s; };

// Block types from the FLAC format spec; 127 is reserved as invalid (it would make a header look like a frame sync).
export const BLOCK = { STREAMINFO: 0, PADDING: 1, APPLICATION: 2, SEEKTABLE: 3, VORBIS_COMMENT: 4, CUESHEET: 5, PICTURE: 6 };

// STREAMINFO bit layout (34 bytes): 16 min block, 16 max block, 24 min frame, 24 max frame, 20 sample rate,
// 3 channels-1, 5 bits-per-sample-1, 36 total samples, 128 MD5 of the decoded audio. totalSamples 0 means unknown,
// so duration is null rather than 0.
export function parseStreamInfo(b) {
  const sampleRate = (b[10] << 12) | (b[11] << 4) | (b[12] >> 4);
  const channels = ((b[12] >> 1) & 7) + 1;
  const bitsPerSample = (((b[12] & 1) << 4) | (b[13] >> 4)) + 1;
  const totalSamples = (b[13] & 15) * 4294967296 + u32(b, 14);
  const md5 = Array.from(b.subarray(18, 34), (x) => x.toString(16).padStart(2, '0')).join('');
  return {
    minBlock: (b[0] << 8) | b[1], maxBlock: (b[2] << 8) | b[3], minFrame: u24(b, 4), maxFrame: u24(b, 7), sampleRate, channels,
    bitsPerSample, totalSamples, duration: sampleRate && totalSamples ? totalSamples / sampleRate : null, md5,
  };
}

export const parsePictureBlock = (b) => parseFlacPicture(b);

// CUESHEET block: 128 catalog, 8 lead-in, 1 flags (bit 7 = CD), 258 reserved, 1 track count (offset 395); then per
// track 8 offset, 1 number, 12 ISRC, 1 flags, 13 reserved, 1 index count (36 bytes), and 12 bytes per index.
// Offsets are in samples, not CD frames. Loops are bounded by the buffer, so a lying count cannot read past it.
export function parseCuesheetBlock(b) {
  const out = { catalog: ascii0(b.subarray(0, 128)), leadIn: u64(b, 128), isCd: !!(b[136] & 0x80), tracks: [] };
  const n = b[395];
  let p = 396;
  for (let i = 0; i < n && p + 36 <= b.length; i++) {
    const t = {
      offset: u64(b, p), number: b[p + 8], isrc: ascii0(b.subarray(p + 9, p + 21)), audio: !(b[p + 21] & 0x80),
      preEmphasis: !!(b[p + 21] & 0x40), indices: [],
    };
    const ni = b[p + 35];
    p += 36;
    for (let k = 0; k < ni && p + 12 <= b.length; k++) { t.indices.push({ offset: u64(b, p), number: b[p + 8] }); p += 12; }
    out.tracks.push(t);
  }
  return out;
}

// Guards: at most 4096 blocks (a corrupt length chain cannot loop forever), bodies larger than maxBlock (16 MB) are
// skipped, not read (a hostile 16 MB 'picture' must not be pulled over the network), and block type 127 stops the scan.
// 'best' picture mode peeks only the 4-byte picture type and reads a body when it is the first picture or the first
// front cover (type 3); a later front cover replaces a non-cover. 'none' only counts.
/** Reader flow over the metadata blocks starting at `start` (the 'fLaC' marker). */
export function* flacFlow(start, size, { pictures = 'all', maxBlock = 16 << 20 } = {}) {
  const sig = yield [start, 4];
  if (String.fromCharCode(...sig) !== 'fLaC') throw new Error('not a FLAC stream');
  const out = { streamInfo: null, tags: null, pictures: [], pictureCount: 0, cuesheet: null, audioOffset: 0, blocks: [], warnings: [] };
  let p = start + 4, last = false, n = 0;
  let best = -1; // index in out.pictures of the picture chosen in 'best' mode
  while (!last && p + 4 <= size && n++ < 4096) {
    const h = yield [p, 4];
    if (h.length < 4) break;
    last = !!(h[0] & 0x80);
    const type = h[0] & 0x7f, len = u24(h, 1);
    const body = p + 4;
    out.blocks.push({ type, offset: p, length: len });
    if (type === 127) { out.warnings.push('invalid FLAC metadata block'); break; }
    // Delegating sub-generator (yield*): returns null for oversized bodies, otherwise the body bytes.
    const read = function* (n2 = len) { return len > maxBlock ? null : yield [body, n2]; };
    if (type === BLOCK.STREAMINFO) { const b = yield* read(); if (b && b.length >= 34) out.streamInfo = parseStreamInfo(b); }
    else if (type === BLOCK.VORBIS_COMMENT) {
      const b = yield* read();
      if (b) { try { out.tags = parseVorbisComment(b, 0); } catch { out.warnings.push('malformed Vorbis comment'); } } else out.warnings.push('Vorbis comment too large');
    } else if (type === BLOCK.CUESHEET) { const b = yield* read(); if (b && b.length >= 396) out.cuesheet = parseCuesheetBlock(b); }
    else if (type === BLOCK.PICTURE) {
      out.pictureCount++;
      if (pictures === 'all') { const b = yield* read(); if (b) { try { out.pictures.push(parseFlacPicture(b)); } catch { /* malformed */ } } }
      else if (pictures === 'best') {
        const t = yield [body, 4];
        const ptype = t.length === 4 ? u32(t, 0) : -1;
        const want = best < 0 || (ptype === 3 && out.pictures[best].type !== 3);
        if (want) {
          const b = yield* read();
          if (b) { try { out.pictures = [parseFlacPicture(b)]; best = 0; } catch { /* malformed */ } }
        }
      }
    }
    p = body + len;
  }
  // After the last block p points at the first audio frame (useful for the duration estimate of streams without totals).
  out.audioOffset = p;
  return out;
}

// Stacked ID3v2 tags (non-standard, written by some taggers) are skipped in a loop. In memory there is no cost to
// reading everything, so maxBlock is Infinity and warnings are dropped for the legacy result shape.
/** Parses the metadata of FLAC bytes (see the header). */
export function parseFlacMeta(input) {
  const b = asBytes(input);
  let start = 0, n;
  while ((n = id3v2Size(b, start))) start += n;
  const out = runSync(flacFlow(start, b.length, { pictures: 'all', maxBlock: Infinity }), b);
  delete out.warnings;
  return out;
}

// --- writing -----------------------------------------------------------------------------------

// --- writing: emits valid minimal metadata for tests and taggers; no audio frames, no SEEKTABLE.
// Body length must fit 24 bits (16 MB); larger pictures would silently wrap. Callers keep pictures small.
function block(type, body, last) {
  const out = new Uint8Array(4 + body.length);
  out[0] = (last ? 0x80 : 0) | type;
  out[1] = (body.length >> 16) & 0xff; out[2] = (body.length >> 8) & 0xff; out[3] = body.length & 0xff;
  out.set(body, 4);
  return out;
}

// Inverse of parseStreamInfo; MD5 left zero, which the spec defines as 'not computed'.
function streamInfoBytes({ sampleRate = 44100, channels = 2, bitsPerSample = 16, totalSamples = 0, minBlock = 4096, maxBlock = 4096, minFrame = 0, maxFrame = 0 }) {
  const b = new Uint8Array(34);
  b[0] = minBlock >> 8; b[1] = minBlock & 0xff; b[2] = maxBlock >> 8; b[3] = maxBlock & 0xff;
  b[4] = minFrame >> 16; b[5] = (minFrame >> 8) & 0xff; b[6] = minFrame & 0xff;
  b[7] = maxFrame >> 16; b[8] = (maxFrame >> 8) & 0xff; b[9] = maxFrame & 0xff;
  b[10] = (sampleRate >> 12) & 0xff;
  b[11] = (sampleRate >> 4) & 0xff;
  b[12] = ((sampleRate & 15) << 4) | ((channels - 1) << 1) | (((bitsPerSample - 1) >> 4) & 1);
  const hi = Math.floor(totalSamples / 4294967296) & 15;
  b[13] = (((bitsPerSample - 1) & 15) << 4) | hi;
  new DataView(b.buffer).setUint32(14, totalSamples % 4294967296);
  return b;
}

function cuesheetBytes(c) {
  const tracks = c.tracks || [];
  const size = 396 + tracks.reduce((n, t) => n + 36 + 12 * (t.indices || []).length, 0);
  const b = new Uint8Array(size);
  const dv = new DataView(b.buffer);
  const put64 = (p, v) => { dv.setUint32(p, Math.floor(v / 4294967296)); dv.setUint32(p + 4, v % 4294967296); };
  for (let i = 0; i < Math.min(128, (c.catalog || '').length); i++) b[i] = c.catalog.charCodeAt(i);
  put64(128, c.leadIn || 0);
  b[136] = c.isCd ? 0x80 : 0;
  b[395] = tracks.length;
  let p = 396;
  for (const t of tracks) {
    put64(p, t.offset || 0);
    b[p + 8] = t.number;
    for (let i = 0; i < Math.min(12, (t.isrc || '').length); i++) b[p + 9 + i] = t.isrc.charCodeAt(i);
    b[p + 21] = (t.audio === false ? 0x80 : 0) | (t.preEmphasis ? 0x40 : 0);
    const idx = t.indices || [];
    b[p + 35] = idx.length;
    p += 36;
    for (const x of idx) { put64(p, x.offset || 0); b[p + 8] = x.number; p += 12; }
  }
  return b;
}

/** 'fLaC' + metadata blocks (see the header); append audio frames to make a file. */
// Block order STREAMINFO first (required by the spec), padding last (so a tagger can grow tags in place later).
// The last-flag goes on whichever block ends the list.
export function buildFlacMeta({ streamInfo = {}, vendor, tags, comments, pictures = [], cuesheet = null, padding = 0 } = {}) {
  const blocks = [[0, streamInfoBytes(streamInfo)]];
  if (tags || comments) blocks.push([4, buildVorbisComment({ vendor, tags: tags || {}, comments: comments || [] })]);
  for (const pic of pictures) blocks.push([6, buildFlacPicture(pic)]);
  if (cuesheet) blocks.push([5, cuesheetBytes(cuesheet)]);
  if (padding) blocks.push([1, new Uint8Array(padding)]);
  const parts = [new Uint8Array([0x66, 0x4c, 0x61, 0x43]), ...blocks.map(([t, body], i) => block(t, body, i === blocks.length - 1))];
  let n = 0;
  for (const x of parts) n += x.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const x of parts) { out.set(x, o); o += x.length; }
  return out;
}
