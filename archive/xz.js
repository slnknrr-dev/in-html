// archive/xz.js - the .xz container (tukaani.org xz-file-format 1.2): stream header and footer, blocks with filter
// chains (LZMA2 last; Delta and the branch filters before it), block checks (CRC32, CRC64, SHA-256), the index,
// concatenated streams and stream padding.
//
//   xzStream(reader) -> Stream          decoded data of all streams; every check is verified
//   xzInfo(src) -> { size, blocks, check, filters } | null   uncompressed size from the indexes (random access)
//   crc64(bytes, prev)                  CRC-64/XZ (ECMA-182, reflected)
//
// File layout: stream = header (12: magic 6, flags 2, CRC32 4) block* index footer (12: CRC32 4, backward size 4,
// flags 2, 'YZ'), streams may be concatenated with zero padding (multiples of 4) between them. Every structure is
// padded to 4 bytes and protected by its own CRC32, and the index repeats every block's sizes: this module verifies
// all of that, because the point of xz's redundancy is that a decoder catches damage before the user trusts output.
// Sizes use the xz variable-length integer (vli): 7 bits per byte, LSB group first, high bit = more.

import { crc32 } from '../codec/crc32.js';
import { sha256 } from '../crypto/sha2.js';
import { filterStream } from './filters.js';
import { Reader, corrupt, fail, le32, readAt, sourceStream } from './io.js';
import { lzma2Stream } from './lzma.js';

export const XZ_MAGIC = [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00];
// Check sizes by type id, as the spec reserves them in groups of three (so unknown checks can still be skipped).
const CHECK_SIZE = [0, 4, 4, 4, 8, 8, 8, 16, 16, 16, 32, 32, 32, 64, 64, 64];
const FILTER_NAMES = { 3: 'delta', 4: 'x86', 5: 'ppc', 6: 'ia64', 7: 'arm', 8: 'armt', 9: 'sparc', 10: 'arm64', 11: 'riscv' };
export const CHECK_NAMES = ['None', 'CRC32', '', '', 'CRC64', '', '', '', '', '', 'SHA-256'];

// CRC-64 table split into two Uint32Arrays: JS has no 64-bit integers except BigInt, which is an order of magnitude
// slower per operation. Reflected polynomial 0xC96C5795D7870F42 = hi 0xC96C5795, lo 0xD7870F42; a 64-bit right
// shift becomes "lo >>> 1 with hi's bit 0 moved into lo's bit 31".
let C64 = null;
function c64() {
  if (C64) return C64;
  const lo = new Uint32Array(256), hi = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let l = i, h = 0;
    for (let k = 0; k < 8; k++) {
      const m = l & 1;
      l = ((l >>> 1) | ((h & 1) << 31)) >>> 0;
      h >>>= 1;
      if (m) { l = (l ^ 0xd7870f42) >>> 0; h = (h ^ 0xc96c5795) >>> 0; }
    }
    lo[i] = l; hi[i] = h;
  }
  return (C64 = { lo, hi });
}

/** CRC-64 state as [lo, hi] (pass the previous result to continue); finish with crc64Final. */
export function crc64(b, prev = [0, 0]) {
  const { lo, hi } = c64();
  let l = ~prev[0] >>> 0, h = ~prev[1] >>> 0;
  for (let i = 0; i < b.length; i++) {
    const x = (l ^ b[i]) & 255;
    l = ((l >>> 8) | (h << 24)) ^ lo[x];
    h = (h >>> 8) ^ hi[x];
  }
  return [~l >>> 0, ~h >>> 0];
}

// xz vli: at most 9 bytes (63 bits). Float accumulation is exact up to 2^53, beyond any real size. A final byte of
// 0 after the first (i && !b) is a non-minimal encoding, which the spec forbids so that every number has exactly one
// encoding (it matters for the index, which is compared byte-for-byte via its CRC).
function vli(r) {
  let v = 0;
  for (let i = 0; i < 9; i++) {
    const b = r.u8('xz number');
    v += (b & 0x7f) * 2 ** (7 * i);
    if (!(b & 0x80)) { if (i && !b) corrupt('xz number'); return v; }
  }
  corrupt('xz number');
}

function checker(type) {
  if (type === 0) return { update() {}, ok: () => true, size: 0 };
  if (type === 1) { let c = 0; return { update(b) { c = crc32(b, 0, b.length, c); }, ok: (v) => le32(v, 0) === c, size: 4 }; }
  if (type === 4) { let c = [0, 0]; return { update(b) { c = crc64(b, c); }, ok: (v) => le32(v, 0) === c[0] && le32(v, 4) === c[1], size: 8 }; }
  if (type === 10) { const h = sha256.create(); return { update(b) { h.update(b); }, ok: (v) => h.digest().every((x, i) => x === v[i]), size: 32 }; }
  // Unknown check types are skipped by size, as xz does (it warns; a future check must not make old files unreadable).
  return { update() {}, ok: () => true, size: CHECK_SIZE[type] };
}

// Block header: filters (outermost first) and the declared sizes. Layout: size byte (real size = (byte + 1) * 4,
// byte 0 is reserved for the index indicator), flags (bits 0-1 filter count - 1, bits 2-5 reserved, bit 6 compressed
// size present, bit 7 uncompressed size present), optional sizes, filter flags (id, props size, props), zero padding,
// CRC32. The header is parsed from a private Reader over its own bytes so a malformed field cannot read into the
// compressed data. Note: the zero padding before the CRC is not checked (the spec requires it); the CRC already
// covers it, so only a deliberately crafted header would pass with non-zero padding.
function blockHeader(r, first) {
  const size = (first + 1) * 4;
  const h = new Uint8Array(size);
  h[0] = first;
  h.set(r.bytes(size - 1, 'xz block header'), 1);
  if (crc32(h, 0, size - 4) !== le32(h, size - 4)) corrupt('xz block header CRC');
  const hr = new Reader({ read: (() => { let d = false; return () => (d ? null : (d = true, h.subarray(2, size - 4))); })() });
  const flags = h[1];
  if (flags & 0x3c) fail('unsupported', 'not supported: xz block flags');
  const blk = { csize: undefined, usize: undefined, filters: [] };
  if (flags & 0x40) blk.csize = vli(hr);
  if (flags & 0x80) blk.usize = vli(hr);
  const n = (flags & 3) + 1;
  for (let i = 0; i < n; i++) {
    const id = vli(hr), ps = vli(hr);
    blk.filters.push({ id, props: hr.bytes(ps, 'xz filter properties') });
  }
  return blk;
}

// The chain is listed outermost (applied last by the encoder, first in the list) to innermost; LZMA2 must be the
// last entry (the only filter here that changes size, the others are reversible byte transforms), so decoding builds
// LZMA2 first and wraps each preceding filter around it.
function decodeChain(r, filters, usize) {
  const last = filters[filters.length - 1];
  if (last.id !== 0x21) fail('unsupported', 'not supported: xz filter 0x' + last.id.toString(16));
  let s = lzma2Stream(r, last.props[0], { size: usize });
  for (let i = filters.length - 2; i >= 0; i--) {
    const f = filters[i];
    const name = FILTER_NAMES[f.id];
    if (!name) fail('unsupported', 'not supported: xz filter 0x' + f.id.toString(16));
    s = filterStream(s, name, f.props);
  }
  return s;
}

export function xzStream(reader) {
  // A resumable state machine, because read() must return after each output chunk. records = (unpadded size,
  // uncompressed size) of each decoded block, compared against the index at the end of the stream.
  let state = 0; // 0: stream header, 1: next block or index, 2: block data, 3: done
  let check = 0, cur = null, chk = null, blockStart = 0, usize = 0, records = [], headerSize = 0, blk = null;
  const streamHeader = () => {
    const h = reader.bytes(12, 'xz stream header');
    for (let i = 0; i < 6; i++) if (h[i] !== XZ_MAGIC[i]) corrupt('xz signature');
    if (crc32(h, 6, 8) !== le32(h, 8)) corrupt('xz stream header CRC');
    // Stream flags: byte 6 reserved (0), byte 7 = check type in the low 4 bits, high bits reserved.
    if (h[6] || h[7] > 15) fail('unsupported', 'not supported: xz stream flags');
    check = h[7];
    records = [];
  };
  const index = () => {
    // The index: record count, (unpadded size, uncompressed size) pairs, padding, CRC32 — compared with the blocks.
    // The index indicator 0x00 was already consumed by the caller, hence pos - 1 and the leading 0 in `bytes` (the CRC
    // covers the indicator). `tap` records the bytes vli() reads so the CRC can be computed afterwards.
    const start = reader.pos - 1;
    const bytes = [0];
    const tap = { u8: () => { const b = reader.u8('xz index'); bytes.push(b); return b; } };
    const n = vli(tap);
    if (n !== records.length) corrupt('xz index record count');
    for (const rec of records) { if (vli(tap) !== rec[0] || vli(tap) !== rec[1]) corrupt('xz index'); }
    while ((reader.pos - start) % 4) if (tap.u8()) corrupt('xz index padding');
    const crc = reader.bytes(4, 'xz index');
    if (crc32(Uint8Array.from(bytes)) !== le32(crc, 0)) corrupt('xz index CRC');
    const foot = reader.bytes(12, 'xz stream footer');
    if (foot[10] !== 0x59 || foot[11] !== 0x5a) corrupt('xz stream footer');
    // Footer CRC covers backward size + flags (bytes 4..9). The backward size itself is not compared with the actual
    // index size here: the index was just parsed in full and its CRC verified, so a mismatch would only affect
    // backwards readers such as xzInfo.
    if (crc32(foot, 4, 10) !== le32(foot, 0)) corrupt('xz stream footer CRC');
    if (foot[9] !== check) corrupt('xz stream flags');
  };
  return {
    read(max = 1 << 20) {
      for (;;) {
        if (state === 3) return null;
        if (state === 0) { streamHeader(); state = 1; continue; }
        if (state === 1) {
          blockStart = reader.pos;
          // First byte: 0x00 = index indicator, else the block header size byte.
          const b = reader.u8('xz block');
          if (b === 0) {
            index();
            // Stream padding (multiples of 4 zero bytes), then maybe another stream.
            let z = 0, c;
            while ((c = reader.byte()) === 0) z++;
            if (c < 0) { if (z % 4) corrupt('xz stream padding'); state = 3; continue; }
            if (z % 4 || c !== 0xfd) corrupt('data after the xz stream');
            reader.unread();
            state = 0;
            continue;
          }
          blk = blockHeader(reader, b);
          headerSize = reader.pos - blockStart;
          cur = decodeChain(reader, blk.filters, blk.usize);
          chk = checker(check);
          usize = 0;
          state = 2;
          continue;
        }
        const out = cur.read(max);
        if (out) { chk.update(out); usize += out.length; return out; }
        const csize = reader.pos - blockStart - headerSize;
        if (blk.csize !== undefined && blk.csize !== csize) corrupt('xz compressed size');
        if (blk.usize !== undefined && blk.usize !== usize) corrupt('xz uncompressed size');
        // Block padding aligns the compressed data to 4; the check follows. The index stores the "unpadded size"
        // (header + compressed + check), which is what `records` collects.
        for (let i = csize; i % 4; i++) if (reader.u8('xz block padding')) corrupt('xz block padding');
        const v = reader.bytes(chk.size, 'xz check');
        if (!chk.ok(v)) fail('checksum', 'xz check mismatch (' + (CHECK_NAMES[check] || 'check ' + check) + ')');
        records.push([headerSize + csize + chk.size, usize]);
        state = 1;
      }
    },
  };
}

/** Uncompressed size and facts from the stream footers and indexes (null when the file is not a clean xz). */
// Walks the file backwards stream by stream (what `xz -l` does): skip stream padding, read the footer, jump back
// by the backward size to the index, sum the record sizes, then jump over the blocks (unpadded sizes rounded up to 4)
// and the 12-byte header to the end of the previous stream. Only O(index) bytes are read, so a multi-GB file is
// sized without decompressing; headers and block contents are not verified here (xzStream does that when decoding).
export function xzInfo(src) {
  let end = src.size, size = 0, blocks = 0, check = -1, streams = 0;
  try {
    while (end > 0) {
      while (end >= 4 && le32(readAt(src, end - 4, 4), 0) === 0) end -= 4;
      if (end < 24) return null;
      const foot = readAt(src, end - 12, 12);
      if (foot[10] !== 0x59 || foot[11] !== 0x5a) return null;
      const back = (le32(foot, 4) + 1) * 4;
      check = foot[9];
      const idxStart = end - 12 - back;
      const r = new Reader(sourceStream(src, idxStart, back));
      if (r.u8() !== 0) return null;
      const n = vli(r);
      let unpadded = 0;
      for (let i = 0; i < n; i++) { const u = vli(r); unpadded += u + ((4 - (u % 4)) % 4); size += vli(r); }
      blocks += n;
      streams++;
      end = idxStart - unpadded - 12;
      if (end < 0) return null;
    }
  } catch { return null; }
  return { size, blocks, streams, check: CHECK_NAMES[check] || 'check ' + check };
}
