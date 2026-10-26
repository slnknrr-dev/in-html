// archive/gzip.js - gzip (RFC 1952) and Unix compress (.Z, LZW) streams.
//
//   gzipStream(reader, { multi = true }) -> Stream   all members decoded, CRC-32 and ISIZE of each checked; data after
//                                                     the last member that is not another member is ignored
//   gzipHeader(bytes, charset) -> { name, comment, mtime, os, extra, length } | null   (first member's header)
//   lzwStream(reader) -> Stream                       compress(1) data after the 1F 9D magic (9-16 bit codes)
//
// gzip member layout (RFC 1952 section 2.3): ID1 ID2 (1F 8B), CM (8 = Deflate, the only one ever defined), FLG,
// MTIME le32, XFL, OS, then optional FEXTRA (le16 length + data), FNAME and FCOMMENT (NUL-terminated, ISO 8859-1 per
// the RFC but in practice any local charset, hence decodeText), FHCRC (le16), the Deflate data, CRC32 le32, ISIZE le32
// (length mod 2^32). Deflate itself is codec/zlib.js; this module is framing and verification only.

import { crc32 } from '../codec/crc32.js';
import { Inflater } from '../codec/zlib.js';
import { corrupt, decodeText, fail, unixTime } from './io.js';

// OS byte values 0..13 from RFC 1952; 255 = unknown. Shown in the UI only, never used for decoding decisions.
const OS = ['FAT', 'Amiga', 'VMS', 'Unix', 'VM/CMS', 'Atari TOS', 'HPFS', 'Macintosh', 'Z-System', 'CP/M', 'TOPS-20', 'NTFS', 'QDOS', 'Acorn RISCOS'];

// Reads one member header through next() (-1 at the end); returns null when the bytes are not a gzip header.
function readHeader(next, charset = 'auto') {
  const id1 = next(), id2 = next();
  if (id1 !== 0x1f || id2 !== 0x8b) return null;
  const cm = next(), flg = next();
  if (cm !== 8) fail('unsupported', 'not supported: gzip compression method ' + cm);
  // FLG bits 5-7 are reserved and must be zero (RFC 1952: a decoder must reject them, they may change the layout).
  // Bits used: 1 FHCRC, 2 FEXTRA, 3 FNAME, 4 FCOMMENT; bit 0 FTEXT is a hint only.
  if (flg & 0xe0) corrupt('gzip flags');
  // Multiplication, not shifts: `<< 24` would make MTIME >= 2^31 (2038 and later) negative. MTIME 0 = not stored.
  let t = 0;
  for (let i = 0; i < 4; i++) t += next() * 2 ** (8 * i);
  const xfl = next(), os = next();
  if (os < 0 || xfl < 0) fail('truncated', 'unexpected end of gzip header');
  const h = { mtime: t ? unixTime(t) : null, os: OS[os] || (os === 255 ? 'unknown' : 'OS ' + os), name: '', comment: '', extra: null, length: 10 };
  if (flg & 4) {
    const n = next() | (next() << 8);
    h.extra = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const b = next(); if (b < 0) fail('truncated', 'unexpected end of gzip header'); h.extra[i] = b; }
    h.length += 2 + n;
  }
  const zstr = () => {
    const b = [];
    for (let c; (c = next()) !== 0;) { if (c < 0) fail('truncated', 'unexpected end of gzip header'); b.push(c); }
    h.length += b.length + 1;
    return decodeText(Uint8Array.from(b), charset);
  };
  if (flg & 8) h.name = zstr();
  if (flg & 16) h.comment = zstr();
  // FHCRC (low 16 bits of the CRC-32 of the header) is skipped, not verified: rare in the wild, and a damaged header
  // field would already have broken parsing; the data CRC-32 still protects the content.
  if (flg & 2) { next(); next(); h.length += 2; }
  return h;
}

// Header-only parse for listing (name, mtime, OS) without starting the inflater; any error means "no usable header".
export function gzipHeader(bytes, charset) {
  let i = 0;
  try { return readHeader(() => (i < bytes.length ? bytes[i++] : -1), charset); } catch { return null; }
}

export function gzipStream(reader, { multi = true } = {}) {
  let inf = null, crc = 0, size = 0, done = false, members = 0;
  const startMember = () => {
    const h = readHeader(() => reader.byte());
    if (!h) { if (!members) corrupt('gzip signature'); return false; }
    inf = new Inflater(reader);
    crc = 0; size = 0; members++;
    return true;
  };
  return {
    read(max = 1 << 20) {
      while (!done) {
        if (!inf && !startMember()) { done = true; break; }
        const out = inf.read(max);
        if (out) { crc = crc32(out, 0, out.length, crc); size += out.length; return out; }
        // The trailer starts at the next byte boundary after the final Deflate block. alignedByte() takes bytes from
        // the inflater's bit buffer first (it may have read ahead), then from the reader: reading reader.byte() here
        // directly would skip bytes the inflater already holds.
        const t = [];
        for (let i = 0; i < 8; i++) { const b = inf.alignedByte(); if (b < 0) fail('truncated', 'unexpected end of gzip data (trailer)'); t.push(b); }
        const wantCrc = (t[0] | (t[1] << 8) | (t[2] << 16) | (t[3] << 24)) >>> 0;
        const wantSize = (t[4] | (t[5] << 8) | (t[6] << 16) | (t[7] << 24)) >>> 0;
        if (wantCrc !== crc) fail('checksum', 'gzip CRC-32 mismatch');
        if (wantSize !== size % 4294967296) corrupt('gzip size');
        inf = null;
        if (!multi) done = true;
        else {
          // Another member, or the end (zero padding and other trailing bytes are ignored, as gzip -d does).
          const b = reader.byte();
          if (b < 0 || b !== 0x1f) done = true; else reader.unread();
        }
      }
      return null;
    },
  };
}

/**
 * compress(1): LZW with 9..maxbits codes, block mode (code 256 clears the table), codes packed LSB first.
 * Flags byte: bits 0-4 maxbits (9..16), bit 7 block mode; bits 5-6 unused. Without block mode (very old files) code
 * 256 is an ordinary dictionary entry, hence `free` starts at 256 instead of 257.
 * Dictionary as prefix/suffix arrays (code -> previous code + last byte): 3 bytes per entry, strings are rebuilt
 * backwards onto `stack` and emitted reversed. Storing whole strings would cost O(n^2) memory in the worst case.
 */
export function lzwStream(reader) {
  const flags = reader.u8('compress header');
  const maxBits = flags & 0x1f, block = (flags & 0x80) !== 0;
  if (maxBits < 9 || maxBits > 16) corrupt('compress header');
  const maxCode = 1 << maxBits;
  const prefix = new Uint16Array(maxCode), suffix = new Uint8Array(maxCode), stack = new Uint8Array(maxCode + 1);
  for (let i = 0; i < 256; i++) suffix[i] = i;
  // bits = current code width; free = next code to assign; old = previous code (-1 right after a clear);
  // fin = first byte of the previous string (needed for the KwKwK case); bb/bc = LSB-first bit buffer;
  // pos/start = bit position overall and where the current width began (for align()).
  let bits = 9, free = block ? 257 : 256, old = -1, fin = 0, bb = 0, bc = 0, done = false;
  let pos = 0, start = 0, out = new Uint8Array(1 << 16);
  const code = () => {
    while (bc < bits) {
      const c = reader.byte();
      if (c < 0) return -1;
      bb |= c << bc; bc += 8;
    }
    const v = bb & ((1 << bits) - 1);
    bb >>>= bits; bc -= bits; pos += bits;
    return v;
  };
  // compress writes codes in groups of 8 (`bits` bytes): a width change or a clear skips to the end of the group,
  // counted from where the current width started.
  const align = () => {
    const g = bits * 8;
    const target = start + Math.ceil((pos - start) / g) * g;
    let need = target - pos;
    if (need <= bc) { bb >>>= need; bc -= need; } else { need -= bc; bb = 0; bc = 0; for (; need > 0; need -= 8) if (reader.byte() < 0) break; }
    pos = start = target;
  };
  return {
    read(max = 1 << 20) {
      if (done) return null;
      // One code can expand to up to maxCode bytes and the loop only checks `o < max` between codes, so a call may
      // return up to max + maxCode - 1 bytes; the buffer is sized for that instead of splitting a string across calls.
      if (out.length < max + maxCode) out = new Uint8Array(max + maxCode);
      let o = 0;
      while (o < max) {
        const c = code();
        if (c < 0) { done = true; break; }
        if (c === 256 && block) {
          align();
          free = 257; old = -1; bits = 9;
          continue;
        }
        if (old < 0) {
          if (c > 255) corrupt('compress data');
          old = fin = c;
          out[o++] = c;
          continue;
        }
        // c === free is the KwKwK case: the encoder used the entry it was just about to define, whose string is
        // old's string + old's first byte. c > free cannot be produced by any encoder.
        let cur = c, sp = 0;
        if (cur >= free) {
          if (cur > free) corrupt('compress data');
          stack[sp++] = fin;
          cur = old;
        }
        while (cur > 255) { stack[sp++] = suffix[cur]; cur = prefix[cur]; }
        fin = cur;
        out[o++] = fin;
        while (sp) out[o++] = stack[--sp];
        // When the table is full (free === maxCode) compress stops adding entries and keeps coding at maxbits until a
        // clear; the width grows exactly when the next code to be assigned no longer fits in `bits`.
        if (free < maxCode) {
          prefix[free] = old; suffix[free] = fin; free++;
          if (free >= 1 << bits && bits < maxBits) { align(); bits++; }
        }
        old = c;
      }
      return o ? out.subarray(0, o) : null;
    },
  };
}
