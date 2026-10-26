// zip/zip.js - ZIP archives (PKWARE APPNOTE): read and write, stored or deflated entries, UTF-8 names, Zip64 sizes and
// offsets, CRC-32 checked. Deflate runs through Compression Streams (codec/deflate.js); everything else is
// synchronous byte work. Encryption: zip/crypt.js; the other compression methods: archive/zip.js.
//
//   readZip(bytes) -> [{ name, dir, size, csize, method, crc, time: Date, comment, extra, data(): Promise<Uint8Array>,
//                        text(): Promise<string> }]
//   writeZip(files, { level }) -> Promise<Uint8Array>
//     files: [{ name, data: Uint8Array | string, time?: Date, store?: boolean, comment? }] (directories: name ending '/')
//
//   listZip(src, { charset, diskStarts }) -> { entries, comment, zip64, disks, shift }
//     src: { size, read(offset, length) -> Uint8Array } (random access; a File in a Worker, bytes elsewhere).
//     Central directory with everything it can tell: names (UTF-8 flag, Info-ZIP Unicode path, legacy code pages via
//     `charset(bytes)`), Zip64, NTFS / extended / Unix times, Unix modes and symlinks, DOS attributes, ZipCrypto and
//     WinZip AES markers, split archives (diskStarts: offset of each disk in the concatenated source) and data
//     prepended to the archive (self-extractors). entry.dataOffset() reads the local header.
//   new ZipWriter({ method: 'deflate' | 'store' })  .add(name, data | AsyncIterable<Uint8Array>, { time, mode, dir })
//     .finish() -> Promise<Blob>   streaming writer (Zip64 when needed), output kept as Blob parts
//
// Design decisions:
// - The central directory is the source of truth, read from the end (EOCD), as unzip does. Local headers are only
//   consulted to find where data starts (their name/extra lengths may differ from the central copy).
// - Random-access source interface ({ size, read }) instead of a whole ArrayBuffer: a 20 GB File in a Worker is read
//   with FileReaderSync slices; only the tail and the central directory are ever loaded.
// - Failures are explicit errors with a reason (truncated, missing volumes, CRC mismatch), never partial silent data.

import { crc32 } from '../codec/crc32.js';
import { compress, decompress } from '../codec/deflate.js';

const SIG_LOCAL = 0x04034b50, SIG_CENTRAL = 0x02014b50, SIG_END = 0x06054b50, SIG_END64 = 0x06064b50, SIG_LOC64 = 0x07064b50;
const utf8 = new TextEncoder();
// Two decoders: the non-fatal one for names flagged UTF-8 (a broken byte becomes U+FFFD, the entry stays usable);
// the fatal one only to probe whether unflagged bytes are valid UTF-8.
const decUTF8 = new TextDecoder('utf-8', { fatal: false });
const decUTF8Fatal = new TextDecoder('utf-8', { fatal: true });
// IBM437 upper half for legacy (non-UTF-8) names.
const CP437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
const cp437 = (b) => Array.from(b, (c) => (c < 128 ? String.fromCharCode(c) : CP437[c - 128])).join('');
// Legacy names: UTF-8 when the bytes are valid UTF-8 (many tools omit the flag), else IBM437.
// Heuristic order: pure ASCII (fast path), valid UTF-8 (macOS Archive Utility and many tools omit flag 0x800), else
// IBM437, the code page APPNOTE prescribes. Valid-UTF-8-by-accident CP437 text is rare because UTF-8 continuation
// bytes must follow strict lead patterns.
const legacyName = (b) => { if (!/[^\x00-\x7f]/.test(String.fromCharCode(...b.subarray(0, 512)))) return decUTF8.decode(b); try { return decUTF8Fatal.decode(b); } catch { return cp437(b); } };

// MS-DOS date/time: 2-second resolution, local time, years 1980-2107. Earlier dates clamp to 1980 (the field cannot
// express them); seconds are halved, so odd seconds round down.
function dosTime(d) {
  const y = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}
const fromDos = (time, date) => new Date(((date >> 9) & 0x7f) + 1980, ((date >> 5) & 0xf) - 1, date & 0x1f, (time >> 11) & 0x1f, (time >> 5) & 0x3f, (time & 0x1f) * 2);
const le16 = (b, o) => b[o] | (b[o + 1] << 8);
const le32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
// Two 32-bit halves combined in floating point: exact up to 2^53 bytes (8 PiB), cheaper than BigInt for offsets.
const le64 = (b, o) => le32(b, o) + le32(b, o + 4) * 4294967296;
// Windows FILETIME: 100 ns ticks since 1601-01-01; 11644473600000 ms is the 1601 -> 1970 offset.
const fileTime = (b, o) => { const v = le64(b, o); return v ? new Date(v / 10000 - 11644473600000) : undefined; };

function readExact(src, off, len, what) {
  const b = src.read(off, len);
  if (b.length < len) throw new Error(`ZIP archive truncated (${what})`);
  return b;
}

/** Central directory of a ZIP archive held by a random-access source (see the header). */
export function listZip(src, { charset = legacyName, diskStarts = [0] } = {}) {
  // EOCD is 22 bytes plus a comment of up to 65535; +20 for the Zip64 locator that sits right before it.
  const tailLen = Math.min(src.size, 22 + 65535 + 20);
  const tailAt = src.size - tailLen;
  const tail = src.read(tailAt, tailLen);
  // End of central directory: scan back over a comment of up to 64 KiB.
  let eocd = -1, loose = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] !== 0x50 || le32(tail, i) !== SIG_END) continue;
    if (loose < 0) loose = i;
    // A signature inside the comment or compressed data is a false hit; prefer the last candidate whose declared
    // comment length fits the file. `loose` keeps the first candidate seen as a fallback for archives with a
    // truncated comment.
    if (i + 22 + le16(tail, i + 20) <= tail.length) { eocd = i; break; }
  }
  if (eocd < 0) eocd = loose;
  if (eocd < 0) throw new Error('not a ZIP archive (no end of central directory)');
  const eocdPos = tailAt + eocd;
  let disk = le16(tail, eocd + 4), cdDisk = le16(tail, eocd + 6);
  let count = le16(tail, eocd + 10);
  let cdSize = le32(tail, eocd + 12), cdOffset = le32(tail, eocd + 16);
  const comment = tail.subarray(eocd + 22, eocd + 22 + le16(tail, eocd + 20));
  let zip64 = false, endStart = eocdPos;
  // Zip64: the 16/32-bit EOCD fields are saturated (0xFFFF / 0xFFFFFFFF) and the real values live in the Zip64 end
  // record pointed to by the locator.
  if (eocd >= 20 && le32(tail, eocd - 20) === SIG_LOC64) {
    const loc = eocd - 20;
    let e64 = le64(tail, loc + 8);
    const e64Disk = le32(tail, loc + 4);
    e64 += diskStarts[e64Disk] || 0;
    let rec = src.read(e64, 56);
    // Prepended data shifts the Zip64 record as well: look just before the locator.
    if (rec.length < 56 || le32(rec, 0) !== SIG_END64) { e64 = eocdPos - 20 - 56; rec = src.read(e64, 56); }
    if (rec.length >= 56 && le32(rec, 0) === SIG_END64) {
      zip64 = true;
      disk = le32(rec, 16); cdDisk = le32(rec, 20);
      count = le64(rec, 32); cdSize = le64(rec, 40); cdOffset = le64(rec, 48);
      endStart = e64;
    }
  }
  const multi = disk > 0 || diskStarts.length > 1;
  let cdPos = (diskStarts[cdDisk] || 0) + cdOffset;
  // Data before the archive (self-extractor stubs): the directory ends right before the end records.
  // Self-extractors and archives concatenated after other data store offsets relative to the archive start, not the
  // file start. Where the directory should end (right before the end records) versus where it claims to start gives
  // the shift, applied to every offset below.
  let shift = 0;
  if (!multi) {
    shift = endStart - cdSize - cdPos;
    if (shift < 0) shift = 0;
    cdPos += shift;
  }
  if (cdPos + cdSize > src.size) throw new Error('ZIP central directory outside the file (missing volumes?)');
  const cd = src.read(cdPos, cdSize);
  const entries = [];
  let p = 0;
  for (let k = 0; k < count; k++) {
    if (p + 46 > cd.length || le32(cd, p) !== SIG_CENTRAL) throw new Error('bad central directory entry');
    const made = le16(cd, p + 4), needed = le16(cd, p + 6), flags = le16(cd, p + 8);
    let method = le16(cd, p + 10);
    const time = le16(cd, p + 12), date = le16(cd, p + 14);
    const crc = le32(cd, p + 16);
    let csize = le32(cd, p + 20), size = le32(cd, p + 24);
    const nlen = le16(cd, p + 28), xlen = le16(cd, p + 30), clen = le16(cd, p + 32);
    let diskStart = le16(cd, p + 34);
    const attrs = le32(cd, p + 38);
    let local = le32(cd, p + 42);
    const nameBytes = cd.subarray(p + 46, p + 46 + nlen);
    const extra = cd.subarray(p + 46 + nlen, p + 46 + nlen + xlen);
    const commentBytes = cd.subarray(p + 46 + nlen + xlen, p + 46 + nlen + xlen + clen);
    p += 46 + nlen + xlen + clen;
    const e = { name: '', nameBytes, flags, method, made, needed, host: made >> 8, crc, time: fromDos(time, date), dosTime: time, attrs, extra, utf8: (flags & 0x800) !== 0, encrypted: (flags & 1) !== 0, aes: null };
    let unicodeName = null, unicodeComment = null;
    for (let x = 0; x + 4 <= extra.length;) {
      const id = le16(extra, x), len = le16(extra, x + 2), o = x + 4;
      if (o + len > extra.length) break;
      if (id === 0x0001) {
        // (APPNOTE 4.5.3: uncompressed size, compressed size, local offset, disk; each present only if its 32-bit
        // field is 0xFFFFFFFF. Reading all four unconditionally is a classic bug.)
        // Zip64: only the saturated fields are present, in this order.
        let q = o;
        if (size === 0xffffffff && q + 8 <= o + len) { size = le64(extra, q); q += 8; }
        if (csize === 0xffffffff && q + 8 <= o + len) { csize = le64(extra, q); q += 8; }
        if (local === 0xffffffff && q + 8 <= o + len) { local = le64(extra, q); q += 8; }
        if (diskStart === 0xffff && q + 4 <= o + len) { diskStart = le32(extra, q); q += 4; }
        e.zip64 = true;
      } else if (id === 0x000a && len >= 32) {
        // NTFS: tag 1 holds mtime, atime, ctime as FILETIMEs.
        for (let q = o + 4; q + 4 <= o + len;) {
          const tag = le16(extra, q), tl = le16(extra, q + 2);
          if (tag === 1 && tl >= 24) { e.mtime = fileTime(extra, q + 4); e.atime = fileTime(extra, q + 12); e.ctime = fileTime(extra, q + 20); }
          q += 4 + tl;
        }
      } else if (id === 0x5455 && len >= 5) {
        // Extended timestamp: flags, then Unix mtime (the central copy carries the mtime only).
        if (extra[o] & 1 && !e.mtime) e.mtime = new Date((le32(extra, o + 1) | 0) * 1000);
        // Info-ZIP Unicode path: valid only if its CRC matches the current raw name; a mismatch means a later tool
        // renamed the entry without updating the extra field, so the stale Unicode name must be ignored.
      } else if (id === 0x7075 && len >= 5 && extra[o] === 1) {
        if (le32(extra, o + 1) === crc32(nameBytes)) unicodeName = decUTF8.decode(extra.subarray(o + 5, o + len));
      } else if (id === 0x6375 && len >= 5 && extra[o] === 1) {
        if (le32(extra, o + 1) === crc32(commentBytes)) unicodeComment = decUTF8.decode(extra.subarray(o + 5, o + len));
      } else if (id === 0x9901 && len >= 7) {
        e.aes = { version: le16(extra, o), strength: extra[o + 4], method: le16(extra, o + 5) };
      } else if (id === 0x0017) {
        e.strong = true;
      }
      x = o + len;
    }
    e.name = unicodeName ?? (e.utf8 ? decUTF8.decode(nameBytes) : charset(nameBytes));
    e.comment = unicodeComment ?? (e.utf8 ? decUTF8.decode(commentBytes) : charset(commentBytes));
    e.size = size; e.csize = csize;
    e.disk = diskStart;
    e.offset = (multi ? diskStarts[diskStart] || 0 : shift) + local;
    if (e.offset > src.size) throw new Error('ZIP entry outside the file (missing volumes?)');
    // Directory detection: trailing slash (or backslash from old Windows tools), or the DOS directory attribute on
    // hosts that set DOS attributes (0 MS-DOS, 11 NTFS, 14 VFAT) for an empty entry.
    e.dir = e.name.endsWith('/') || e.name.endsWith('\\') || ((e.host === 0 || e.host === 11 || e.host === 14) && (attrs & 0x10) !== 0 && size === 0);
    if (e.host === 3 || e.host === 19 || (attrs >>> 16)) e.mode = attrs >>> 16 || undefined;
    if (!e.mtime) e.mtime = e.time;
    if (e.aes) e.method = method; // 99: the real method is in e.aes.method
    e.dataOffset = () => {
      const h = readExact(src, e.offset, 30, 'local header');
      if (le32(h, 0) !== SIG_LOCAL) throw new Error('bad local header: ' + e.name);
      return e.offset + 30 + le16(h, 26) + le16(h, 28);
    };
    entries.push(e);
  }
  return { entries, comment: decUTF8.decode(comment), commentBytes: comment, zip64, disks: disk + 1, shift };
}

// Convenience over listZip for in-memory archives. Encrypted entries are listed but data() rejects: decryption is a
// separate, opt-in path (crypt.js) so an archive cannot silently yield ciphertext as content.
export function readZip(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const src = { size: b.length, read: (off, len) => b.subarray(off, Math.min(b.length, off + len)) };
  return listZip(src).entries.map((x) => {
    const { name, dir, size, csize, method, crc, time, comment, extra } = x;
    if (x.encrypted) return { name, dir, size, csize, method, crc, time, comment, extra, encrypted: true, data: async () => { throw new Error('encrypted entry: ' + name); }, text: async () => { throw new Error('encrypted entry: ' + name); } };
    return {
      name, dir, size, csize, method, crc, time, comment, extra,
      async data() {
        const start = x.dataOffset();
        const raw = b.subarray(start, start + csize);
        let out;
        if (method === 0) out = raw;
        else if (method === 8) out = await decompress(raw, 'deflate-raw');
        else throw new Error(`unsupported compression method ${method}: ${name}`);
        // CRC is checked after decompression: catches corruption the deflate decoder cannot detect (stored entries).
        if (crc32(out) !== crc) throw new Error('CRC mismatch: ' + name);
        return out;
      },
      async text() { return decUTF8.decode(await this.data()); },
    };
  });
}

// In-memory writer for small archives (exports, bundles). Sizes are known before each header is written, so no data
// descriptors (flag bit 3) are needed, which keeps the output readable by the most limited extractors.
// KNOWN DEFECT: entry counts above 65535 are written truncated into the 16-bit EOCD fields (no Zip64 here), and
// duplicate names are not deduplicated (ZipWriter does both). Fix: throw on files.length > 0xffff, or delegate to
// ZipWriter.
export async function writeZip(files, { level = 'deflate' } = {}) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = utf8.encode(String(f.name).replace(/\\/g, '/').replace(/^\/+/, ''));
    const dir = String(f.name).endsWith('/');
    const data = dir ? new Uint8Array(0) : typeof f.data === 'string' ? utf8.encode(f.data) : f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data || []);
    const crc = crc32(data);
    let method = 0, body = data;
    // Deflate is kept only if it actually shrinks the data; tiny or already-compressed inputs (PNG, JPEG) are stored,
    // which saves both space and the reader's inflate time.
    if (!dir && !f.store && level !== 'store' && data.length > 64) {
      const z = await compress(data, 'deflate-raw');
      if (z.length < data.length) { method = 8; body = z; }
    }
    const { time, date } = dosTime(f.time instanceof Date ? f.time : new Date());
    const comment = utf8.encode(f.comment || '');
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, SIG_LOCAL, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x800, true); // UTF-8 names
    lv.setUint16(8, method, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cd = new Uint8Array(46 + name.length + comment.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, SIG_CENTRAL, true);
    cv.setUint16(4, 0x0314, true); // made by: Unix, 2.0
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(32, comment.length, true);
    cv.setUint32(38, dir ? 0x41ed0010 : 0x81a40000, true); // external attrs: drwxr-xr-x / -rw-r--r--
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    cd.set(comment, 46 + name.length);
    parts.push(local, body);
    central.push(cd);
    offset += local.length + body.length;
    if (offset > 0xfffffff0) throw new Error('archive too large (Zip64 writing is not supported)');
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, SIG_END, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of all) { out.set(a, o); o += a.length; }
  return out;
}

// --- streaming writer ------------------------------------------------------------------------------------------

// Parts are folded into a Blob every 32 MiB: browsers can back Blobs by disk, and a huge array of small Uint8Arrays
// would keep everything on the JS heap.
const BLOB_CHUNK = 32 << 20;

/**
 * Streaming ZIP writer for large outputs: each file's data (bytes or an async iterable of chunks) is deflated through
 * Compression Streams (or stored), the local header is written once the sizes are known (no data descriptors), and
 * Zip64 records appear only when a size, an offset or the entry count needs them. The output accumulates as Blob
 * parts, so gigabytes never sit in one array.
 */
export class ZipWriter {
  constructor({ method = 'deflate' } = {}) {
    this.deflate = method !== 'store';
    this.blobs = [];
    this.parts = [];
    this.pending = 0;
    this.offset = 0;
    this.central = [];
    this.count = 0;
    this.names = new Set();
  }

  push(b) {
    const n = b instanceof Blob ? b.size : b.length;
    this.parts.push(b);
    this.pending += n;
    this.offset += n;
    if (this.pending >= BLOB_CHUNK) { this.blobs.push(new Blob(this.parts)); this.parts = []; this.pending = 0; }
  }

  /** Adds a file or directory (name ending in '/' or opts.dir). Duplicate names get ' (2)', ' (3)' … */
  async add(name, data, { time = new Date(), mode, dir = false, store = false } = {}) {
    let n = String(name).replace(/\\/g, '/').replace(/^\/+/, '');
    dir = dir || n.endsWith('/');
    if (dir && !n.endsWith('/')) n += '/';
    n = this.unique(n);
    const nameBytes = utf8.encode(n);
    let crc = 0, size = 0, csize = 0;
    // The file's data is buffered as Blob pieces (the local header needs the sizes first).
    const body = [], bodyBlobs = [];
    let bodyPending = 0;
    const keep = (b) => { body.push(b); bodyPending += b.length; if (bodyPending >= BLOB_CHUNK) { bodyBlobs.push(new Blob(body.splice(0))); bodyPending = 0; } };
    const method = dir || store || !this.deflate ? 0 : 8;
    const chunks = data == null ? [] : data instanceof Uint8Array || typeof data === 'string' ? [typeof data === 'string' ? utf8.encode(data) : data] : data;
    if (method === 8) {
      const cs = new CompressionStream('deflate-raw');
      const w = cs.writable.getWriter();
      // The readable side must be drained concurrently with writing; awaiting writes without a reader deadlocks once
      // the stream's internal queue fills (backpressure).
      const reading = (async () => {
        const rd = cs.readable.getReader();
        for (;;) { const { value, done } = await rd.read(); if (done) break; keep(value); csize += value.length; }
      })();
      for await (const c of chunks) {
        crc = crc32(c, 0, c.length, crc); size += c.length;
        // slice(): the stream may hold the chunk after write() resolves; the caller may reuse its buffer.
        await w.write(c.slice());
      }
      await w.close();
      await reading;
    } else {
      for await (const c of chunks) { crc = crc32(c, 0, c.length, crc); size += c.length; csize += c.length; keep(c.slice()); }
    }
    // >= rather than >: 0xFFFFFFFF itself is the "see Zip64" sentinel and cannot be written as a literal size.
    const big = size >= 0xffffffff || csize >= 0xffffffff;
    const at = this.offset;
    const { time: dt, date: dd } = dosTime(time instanceof Date && !isNaN(time) ? time : new Date());
    // Local header (Zip64 extra with both sizes when they do not fit).
    const lx = big ? 20 : 0;
    const local = new Uint8Array(30 + nameBytes.length + lx);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, SIG_LOCAL, true);
    lv.setUint16(4, big ? 45 : 20, true);
    lv.setUint16(6, 0x800, true);
    lv.setUint16(8, method, true);
    lv.setUint16(10, dt, true); lv.setUint16(12, dd, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, big ? 0xffffffff : csize, true);
    lv.setUint32(22, big ? 0xffffffff : size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, lx, true);
    local.set(nameBytes, 30);
    if (big) {
      const o = 30 + nameBytes.length;
      lv.setUint16(o, 1, true); lv.setUint16(o + 2, 16, true);
      lv.setBigUint64(o + 4, BigInt(size), true); lv.setBigUint64(o + 12, BigInt(csize), true);
    }
    this.push(local);
    if (bodyBlobs.length) this.push(new Blob([...bodyBlobs, ...body])); else for (const b of body) this.push(b);
    // Central record: Zip64 fields for whatever does not fit.
    const z = [];
    if (size >= 0xffffffff) z.push(size);
    if (csize >= 0xffffffff) z.push(csize);
    if (at >= 0xffffffff) z.push(at);
    const cx = z.length ? 4 + 8 * z.length : 0;
    const cd = new Uint8Array(46 + nameBytes.length + cx);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, SIG_CENTRAL, true);
    cv.setUint16(4, 0x0314 + (z.length ? 25 : 0), true); // made by Unix, version 2.0 (4.5 with Zip64)
    cv.setUint16(6, z.length ? 45 : 20, true);
    cv.setUint16(8, 0x800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, dt, true); cv.setUint16(14, dd, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, csize >= 0xffffffff ? 0xffffffff : csize, true);
    cv.setUint32(24, size >= 0xffffffff ? 0xffffffff : size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, cx, true);
    const m = mode != null ? mode & 0xffff : dir ? 0o40755 : 0o100644;
    cv.setUint32(38, ((m << 16) | (dir ? 0x10 : 0)) >>> 0, true);
    cv.setUint32(42, at >= 0xffffffff ? 0xffffffff : at, true);
    cd.set(nameBytes, 46);
    if (cx) {
      const o = 46 + nameBytes.length;
      cv.setUint16(o, 1, true); cv.setUint16(o + 2, 8 * z.length, true);
      z.forEach((v, i) => cv.setBigUint64(o + 4 + 8 * i, BigInt(v), true));
    }
    this.central.push(cd);
    this.count++;
    return { name: n, size, csize, crc };
  }

  // Duplicate names make extractors overwrite or prompt; suffix ' (2)' before the extension, like file managers.
  unique(n) {
    if (!this.names.has(n)) { this.names.add(n); return n; }
    const slash = n.endsWith('/') ? '/' : '';
    const base = slash ? n.slice(0, -1) : n;
    const m = /^(.*?)(\.[^./]{1,10})?$/.exec(base);
    for (let i = 2; ; i++) {
      const c = `${m[1]} (${i})${m[2] || ''}${slash}`;
      if (!this.names.has(c)) { this.names.add(c); return c; }
    }
  }

  // Zip64 end record + locator only when a count / size / offset overflows, so ordinary archives stay classic ZIP.
  async finish() {
    const cdStart = this.offset;
    for (const c of this.central) this.push(c);
    const cdSize = this.offset - cdStart;
    if (this.count >= 0xffff || cdStart >= 0xffffffff || cdSize >= 0xffffffff) {
      const e64 = new Uint8Array(56 + 20);
      const v = new DataView(e64.buffer);
      const at = this.offset;
      v.setUint32(0, SIG_END64, true);
      v.setBigUint64(4, 44n, true);
      v.setUint16(12, 45, true); v.setUint16(14, 45, true);
      v.setBigUint64(24, BigInt(this.count), true); v.setBigUint64(32, BigInt(this.count), true);
      v.setBigUint64(40, BigInt(cdSize), true); v.setBigUint64(48, BigInt(cdStart), true);
      v.setUint32(56, SIG_LOC64, true);
      v.setBigUint64(64, BigInt(at), true);
      v.setUint32(72, 1, true);
      this.push(e64);
    }
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, SIG_END, true);
    ev.setUint16(8, Math.min(this.count, 0xffff), true);
    ev.setUint16(10, Math.min(this.count, 0xffff), true);
    ev.setUint32(12, Math.min(cdSize, 0xffffffff), true);
    ev.setUint32(16, Math.min(cdStart, 0xffffffff), true);
    this.push(end);
    const blob = new Blob([...this.blobs, ...this.parts], { type: 'application/zip' });
    this.blobs = []; this.parts = [];
    return blob;
  }
}
