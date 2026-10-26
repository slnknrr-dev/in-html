// pack/sevenzip.js - 7z writer: one solid LZMA2 folder (or Copy for data that does not shrink) holding every
// non-empty file, a plain (unencoded) header with sizes, CRC-32s, UTF-16 names, empty files and folders,
// modification times and attributes (Windows bits plus the Unix mode in the high word, as p7zip writes it).
// 7-Zip and ../archive/sevenzip.js read the output.
//
//   sevenZip(entries, { level = 5 }) -> Uint8Array
//     entries: { path, data?: Uint8Array, dir?: boolean, mtime?: Date | number (ms), mode?: number, attrib?: number }

import { crc32 } from '../codec/crc32.js';
import { lzma2, lzma2DictProp } from './lzma.js';

// DESIGN. Single solid folder + plain header: the minimal structure 7-Zip accepts, and solid compression gives the
// best ratio for many small files. Not supported: encoded (compressed) headers, multiple folders, BCJ filters,
// encryption. The whole archive is built in memory; the start header is written last because it holds the size
// and CRC of the end header. Property IDs: 01 Header, 04 MainStreamsInfo, 06 PackInfo, 07 UnpackInfo, 08
// SubStreamsInfo, 09 Size, 0A CRC, 0B Folder, 0C CodersUnpackSize, 0D NumUnpackStream, 05 FilesInfo,
// 0E EmptyStream, 0F EmptyFile, 11 Name, 14 MTime, 15 Attributes, 00 End.
// SIG: '7z' bc af 27 1c, then format version 0.4.
const SIG = [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4];

// Byte list builder: headers are small, so a plain array is simpler than a growing typed buffer.
class Out {
  constructor() { this.a = []; }
  b(...v) { for (const x of v) this.a.push(x & 255); return this; }
  bytes(u) { for (const x of u) this.a.push(x); return this; }
  // 7z UINT64: the count of leading 1 bits of the first byte tells how many little-endian bytes follow.
  num(v) {
    let n = 0;
    while (n < 8 && v >= 2 ** (7 * (n + 1))) n++;
    const low = [];
    let x = v;
    for (let i = 0; i < n; i++) { low.push(x % 256); x = Math.floor(x / 256); }
    const first = n === 8 ? 0xff : ((0xff00 >> n) & 0xff) | x;
    this.a.push(first, ...low);
    return this;
  }
  u32(v) { return this.b(v, v >>> 8, v >>> 16, v >>> 24); }
  u64(v) { let x = BigInt(v); for (let i = 0; i < 8; i++) { this.a.push(Number(x & 255n)); x >>= 8n; } return this; }
  get length() { return this.a.length; }
  u8() { return Uint8Array.from(this.a); }
}

// 7z bit vectors are MSB first within each byte.
function bitVector(bits) {
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((on, i) => { if (on) out[i >> 3] |= 0x80 >> (i & 7); });
  return out;
}

const msOf = (t) => (t instanceof Date ? t.getTime() : typeof t === 'number' ? t : null);
// FILETIME: 100 ns ticks since 1601-01-01; BigInt because the value exceeds 2^53.
const fileTime = (ms) => (BigInt(Math.round(ms)) + 11644473600000n) * 10000n;

export function sevenZip(entries, { level = 5 } = {}) {
  const files = entries.map((e) => {
    const dir = !!e.dir || e.kind === 'dir';
    // Symbolic links are files holding the target, marked by the Unix mode (as p7zip stores them).
    const link = e.kind === 'symlink' && e.link != null;
    const data = link ? new TextEncoder().encode(e.link) : !dir && e.data ? e.data : null;
    return { name: String(e.path).replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''), dir, data, mtime: msOf(e.mtime), mode: link ? 0o120777 : e.mode, attrib: e.attrib };
  });
  // Only non-empty files get a stream; empty files and directories exist only in the FilesInfo bit vectors.
  const streams = files.filter((f) => f.data && f.data.length);
  const total = streams.reduce((n, f) => n + f.data.length, 0);
  let packed = new Uint8Array(0), coder = null;
  if (streams.length) {
    const all = new Uint8Array(total);
    let o = 0;
    for (const f of streams) { all.set(f.data, o); o += f.data.length; }
    const z = lzma2(all, { level });
    // Copy (method 00) when LZMA2 does not shrink the data; the LZMA2 coder property is the dictionary byte.
    if (z.length < total) { packed = z; coder = [0x21, lzma2DictProp(z.dictSize)]; } else { packed = all; coder = [0x00]; }
  }
  const h = new Out();
  if (files.length) {
    h.b(0x01);
    if (streams.length) {
      h.b(0x04);
      h.b(0x06).num(0).num(1).b(0x09).num(packed.length).b(0x00);
      // One folder, not external, one coder. Coder flag byte 0x21 = id size 1 | has properties (0x20), then id
      // 0x21 (LZMA2) and 1 property byte; 0x01, 0x00 = id size 1, id 00 (Copy).
      h.b(0x07, 0x0b).num(1).b(0x00).num(1);
      if (coder.length > 1) h.b(0x21, coder[0]).num(1).b(coder[1]); else h.b(0x01, 0x00);
      h.b(0x0c).num(total).b(0x00);
      h.b(0x08, 0x0d).num(streams.length);
      // Sizes of all substreams but the last (implied by the folder size).
      if (streams.length > 1) { h.b(0x09); for (const f of streams.slice(0, -1)) h.num(f.data.length); }
      h.b(0x0a, 0x01);
      for (const f of streams) h.u32(crc32(f.data));
      h.b(0x00, 0x00);
    }
    h.b(0x05).num(files.length);
    const empty = files.map((f) => !(f.data && f.data.length));
    if (empty.some(Boolean)) {
      const ev = bitVector(empty);
      h.b(0x0e).num(ev.length).bytes(ev);
      const emptyFiles = files.filter((f, i) => empty[i]).map((f) => !f.dir);
      if (emptyFiles.some(Boolean)) { const fv = bitVector(emptyFiles); h.b(0x0f).num(fv.length).bytes(fv); }
    }
    // Names: external = 0, then UTF-16LE with NUL terminators; astral characters become surrogate pairs.
    const names = new Out().b(0x00);
    for (const f of files) { for (const c of f.name) { const u = c.codePointAt(0); if (u > 0xffff) { const v = u - 0x10000; names.b(0xd800 + (v >> 10), (0xd800 + (v >> 10)) >> 8, 0xdc00 + (v & 1023), (0xdc00 + (v & 1023)) >> 8); } else names.b(u, u >> 8); } names.b(0, 0); }
    h.b(0x11).num(names.length).bytes(names.a);
    if (files.some((f) => f.mtime != null)) {
      const defined = files.map((f) => f.mtime != null);
      const all = defined.every(Boolean);
      const t = new Out();
      // AllAreDefined byte, else a bit vector; then external = 0 and the defined times.
      if (all) t.b(0x01); else t.b(0x00).bytes(bitVector(defined));
      t.b(0x00);
      for (const f of files) if (f.mtime != null) t.u64(fileTime(f.mtime));
      h.b(0x14).num(t.length).bytes(t.a);
    }
    const at = new Out().b(0x01, 0x00);
    for (const f of files) {
      let a = f.attrib != null ? f.attrib : f.dir ? 0x10 : 0x20;
      // p7zip convention: 0x8000 (FILE_ATTRIBUTE_UNIX_EXTENSION) and st_mode in the high 16 bits.
      if (f.mode != null) a = (a | 0x8000 | ((f.mode & 0xffff) << 16)) >>> 0;
      at.u32(a);
    }
    h.b(0x15).num(at.length).bytes(at.a);
    h.b(0x00, 0x00);
  }
  const header = h.u8();
  // Start header: next-header offset (relative to byte 32), size, CRC; its own CRC goes at bytes 8-11.
  const start = new Out().u64(packed.length).u64(header.length).u32(header.length ? crc32(header) : 0).u8();
  const out = new Uint8Array(32 + packed.length + header.length);
  out.set(SIG, 0);
  const sc = crc32(start);
  out.set([sc & 255, (sc >>> 8) & 255, (sc >>> 16) & 255, sc >>> 24], 8);
  out.set(start, 12);
  out.set(packed, 32);
  out.set(header, 32 + packed.length);
  return out;
}
