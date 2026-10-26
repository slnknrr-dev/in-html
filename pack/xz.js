// pack/xz.js - xz writer (the .xz container of xz-utils): stream header and footer, one block with the LZMA2 filter,
// the index, and a CRC-64 (default), CRC-32 or no check of the uncompressed data.
//
//   xz(data, { level = 6, check = 'crc64' | 'crc32' | 'none' }) -> Uint8Array

import { crc32 } from '../codec/crc32.js';
import { crc64 } from '../archive/xz.js';
import { lzma2, lzma2DictProp } from './lzma.js';

// DESIGN. One stream, one block, one index record: the smallest valid layout. Compressed and uncompressed sizes
// are omitted from the block header (flags 0) because the index carries them; this lets the block be written
// without knowing its size first. All header CRCs are CRC-32 (reflected, as ../codec/crc32.js); the check of
// the data is selectable. Stream flags: [0, check type].
const MAGIC = [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00];
const CHECKS = { none: 0, crc32: 1, crc64: 4 };

// xz variable-length integer: 7 bits per byte, little-endian, high bit = more bytes.
function vli(v) {
  const out = [];
  do { let b = v % 128; v = Math.floor(v / 128); if (v) b |= 0x80; out.push(b); } while (v);
  return out;
}
const le32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
const pad4 = (n) => (4 - (n % 4)) % 4;

export function xz(data, { level = 6, check = 'crc64' } = {}) {
  const type = CHECKS[check] ?? 4;
  const flags = [0, type];
  const parts = [];
  parts.push(Uint8Array.from([...MAGIC, ...flags, ...le32(crc32(Uint8Array.from(flags)))]));
  const records = [];
  if (data.length) {
    const body = lzma2(data, { level });
    // Block header: size, flags (one filter, no sizes), LZMA2 filter with its dictionary property, padding, CRC-32.
    const h = [0, 0x00, 0x21, 1, lzma2DictProp(body.dictSize)];
    // The header size byte counts the header (incl. CRC) in 4-byte units minus one.
    while ((h.length + 4) % 4) h.push(0);
    h[0] = (h.length + 4) / 4 - 1;
    const head = Uint8Array.from([...h, ...le32(crc32(Uint8Array.from(h)))]);
    let ck;
    if (type === 1) ck = Uint8Array.from(le32(crc32(data)));
    else if (type === 4) { const [lo, hi] = crc64(data); ck = Uint8Array.from([...le32(lo), ...le32(hi)]); }
    else ck = new Uint8Array(0);
    // Block padding aligns to 4 bytes; the index "unpadded size" excludes it, as the format requires.
    parts.push(head, body, new Uint8Array(pad4(body.length)), ck);
    records.push([head.length + body.length + ck.length, data.length]);
  }
  const idx = [0, ...vli(records.length)];
  for (const [u, s] of records) idx.push(...vli(u), ...vli(s));
  while (idx.length % 4) idx.push(0);
  const index = Uint8Array.from([...idx, ...le32(crc32(Uint8Array.from(idx)))]);
  parts.push(index);
  // Stream footer: CRC32, backward size (index size / 4 - 1), flags, 'YZ'. Readers locate the index from the end.
  const back = [...le32(index.length / 4 - 1), ...flags];
  parts.push(Uint8Array.from([...le32(crc32(Uint8Array.from(back))), ...back, 0x59, 0x5a]));
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
