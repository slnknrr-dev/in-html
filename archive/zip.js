// archive/zip.js - ZIP archives for the archive library on top of zip/zip.js (central directory) and zip/crypt.js:
// methods Stored, Shrunk, Reduced 1-4, Imploded, Deflate, Deflate64, BZip2, LZMA, XZ, Zstandard and PPMd (var. I rev. 1);
// ZipCrypto, WinZip AES (AE-1 / AE-2) and PKWARE strong encryption with AES (password) with password checks; Zip64;
// split archives (.z01 … .zip as one concatenated source); self-extractors; names in UTF-8, the Info-ZIP Unicode extra
// or a legacy code page. Without a (readable) central directory - a truncated download, a streamed archive - the
// entries are found by walking the local headers (scanLocalHeaders).
//
//   openZip(sources, { password, charset, offset }) -> Archive (see README.md)
//
// Spec reference: PKWARE APPNOTE.TXT 6.3.x (section numbers below). Layout reminder: [local header + data
// (+ data descriptor)]* central directory [zip64 end record + locator] end of central directory. The central
// directory is authoritative (sizes, attributes, names); local headers may hold zeros when sizes are in a
// descriptor (flag bit 3), which is why the scan fallback has to search for descriptors.
//
// Layering: zip/zip.js parses the directory structures (shared with the ZIP writer), zip/crypt.js holds ZipCrypto and
// WinZip AES; this module maps methods to decoders, adds PKWARE strong encryption and the local-header recovery, and
// stacks the streams: source -> decryption -> decompression -> CRC check (-> AES MAC check).

import { crc32 } from '../codec/crc32.js';
import { Inflater } from '../codec/zlib.js';
import { aesCbcDecrypt } from '../crypto/aes.js';
import { sha1 } from '../crypto/sha1.js';
import { AES_SALT, WinZipAes, ZipCrypto, aesKeys } from '../zip/crypt.js';
import { listZip } from '../zip/zip.js';
import { bzip2Stream } from './bzip2.js';
import { ArchiveError, Reader, concatSource, crcStream, decodeText, dosDateTime, fail, le16, le32, le64, limitStream, readAll, sourceStream, utf8 } from './io.js';
import { lzmaStream } from './lzma.js';
import { explodeStream, unreduceStream, unshrinkStream } from './pkware.js';
import { ppmd8Stream } from './ppmd8.js';
import { cbcStream } from './rarcrypt.js';
import { xzStream } from './xz.js';
import { zstdStream } from './zstd.js';

export const ZIP_METHODS = {
  0: 'Stored', 1: 'Shrunk', 2: 'Reduced:1', 3: 'Reduced:2', 4: 'Reduced:3', 5: 'Reduced:4', 6: 'Imploded', 7: 'Tokenized',
  8: 'Deflate', 9: 'Deflate64', 10: 'PKWARE DCL', 12: 'BZip2', 14: 'LZMA', 16: 'IBM z/OS CMPSC', 18: 'IBM TERSE',
  19: 'IBM LZ77', 20: 'Zstandard (old id)', 93: 'Zstandard', 94: 'MP3', 95: 'XZ', 96: 'JPEG', 97: 'WavPack', 98: 'PPMd', 99: 'AES',
};
// 99 (AES) is not a compression method: it marks WinZip AES, whose real method sits in the 0x9901 extra field.
const SUPPORTED = new Set([0, 1, 2, 3, 4, 5, 6, 8, 9, 12, 14, 20, 93, 95, 98]);
const enc = new TextEncoder();

// Password bytes in a single-byte legacy code page (old ZipCrypto archives made with OEM / ANSI passwords).
// ZipCrypto keys on raw bytes and the APPNOTE never fixed a password charset, so a Cyrillic password typed into a DOS
// archiver produced CP866 bytes, into a Windows one CP1251. The reverse table is built by decoding every byte once
// (TextDecoder has no encoder for legacy charsets); a character with no byte in that code page rules it out (null).
const REV = new Map();
function legacyBytes(pw, label) {
  if (!REV.has(label)) {
    let m = null;
    try { const d = new TextDecoder(label); m = new Map(); for (let i = 0; i < 256; i++) m.set(d.decode(Uint8Array.of(i)), i); } catch { m = null; }
    REV.set(label, m);
  }
  const m = REV.get(label);
  if (!m) return null;
  const out = new Uint8Array(pw.length);
  for (let i = 0; i < pw.length; i++) { const v = m.get(pw[i]); if (v === undefined) return null; out[i] = v; }
  return out;
}

// The password as UTF-8 and in the legacy code pages old archivers used (OEM / ANSI), without duplicates.
// Each candidate costs only one 12-byte header test, so trying four encodings is free; dedup by content avoids
// repeating identical byte strings (pure ASCII passwords are the same in all of them).
const passwordBytes = (pw) => [enc.encode(pw), legacyBytes(pw, 'ibm866'), legacyBytes(pw, 'windows-1251'), legacyBytes(pw, 'windows-1252')]
  .filter((b, i, a) => b && a.findIndex((x) => x && x.join() === b.join()) === i);

// Method id -> decoding Stream over `reader` (already decrypted). `size` is passed so decoders can size buffers
// and stop exactly; Stored without a known size (a cut entry) passes through whatever is there.
function decoderFor(method, reader, e) {
  const size = e.size;
  switch (method) {
    case 0: return size == null ? { read: (max) => reader.chunk(max) } : limitStream({ read: (max) => reader.chunk(max) }, size, 'ZIP data');
    case 1: return unshrinkStream(reader, { size });
    case 2: case 3: case 4: case 5: return unreduceStream(reader, method - 1, { size });
    // Implode parameters live in the general purpose flags (APPNOTE 4.4.4): bit 1 = 8 KiB dictionary (else 4 KiB),
    // bit 2 = 3 Shannon-Fano trees (literal tree present, else 2).
    case 6: return explodeStream(reader, { bigDictionary: (e.flags & 2) !== 0, literalTree: (e.flags & 4) !== 0, size });
    case 8: case 9: {
      const inf = new Inflater(reader, { deflate64: method === 9, size });
      return { size, read: (max) => inf.read(max) };
    }
    // multi: false: the entry is exactly one bzip2 stream; bytes after it belong to the archive, not to the entry.
    case 12: return bzip2Stream(reader, { size, multi: false });
    case 14: {
      // LZMA in ZIP: version (2 bytes), properties size (2), properties; bit 1 of the flags = end marker present.
      const h = reader.bytes(4, 'LZMA header');
      const props = reader.bytes(h[2] | (h[3] << 8), 'LZMA properties');
      return lzmaStream(reader, props, { size });
    }
    case 20: case 93: return zstdStream(reader, { size });
    case 95: return xzStream(reader);
    case 98: return ppmd8Stream(reader, { size });
    default: return fail('unsupported', 'not supported: ZIP method ' + (ZIP_METHODS[method] || method));
  }
}

// --- PKWARE strong encryption (APPNOTE 7.2, SecureZIP): password-based AES, as 7-Zip's ZipStrong.cpp -----------

const PK_ALGS = { 0x6601: 'DES', 0x6602: 'RC2', 0x6603: '3DES-168', 0x6609: '3DES-112', 0x660e: 'AES-128', 0x660f: 'AES-192', 0x6610: 'AES-256', 0x6702: 'RC2', 0x6720: 'Blowfish', 0x6721: 'Twofish', 0x6801: 'RC4' };
const PK_AES_KEY = { 0x660e: 16, 0x660f: 24, 0x6610: 32 };

/** The strong encryption header extra field (0x0017) of a central directory entry: { alg, bits, flags } | null. */
function strongInfo(extra) {
  for (let x = 0; x + 4 <= extra.length;) {
    const id = le16(extra, x), len = le16(extra, x + 2);
    if (id === 0x0017 && len >= 8) return { alg: le16(extra, x + 6), bits: le16(extra, x + 8), flags: le16(extra, x + 10) };
    x += 4 + len;
  }
  return null;
}

// CryptDeriveKey (Windows CryptoAPI) with SHA-1: SHA-1 of the digest XOR 0x36 x 64 and of the digest XOR 0x5c x 64.
// (The HMAC ipad / opad constants, used here only to stretch a 20-byte digest to 40 bytes; SecureZIP was built on
// CryptoAPI, so the format inherited its key derivation verbatim. No salt, no iterations: weak by modern standards.)
function deriveKey(digest) {
  const key = new Uint8Array(40);
  for (const [c, at] of [[0x36, 0], [0x5c, 20]]) {
    const buf = new Uint8Array(64).fill(c);
    for (let i = 0; i < 20; i++) buf[i] ^= digest[i];
    key.set(sha1(buf), at);
  }
  return key;
}

/**
 * Reads the decryption header at the start of the entry data and checks the password candidates against its
 * validation data: { key, iv, headerLen } of the file data.
 */
// Decryption header (APPNOTE 7.2.4): IVSize, IV, Size, Format (3), AlgID, BitLen, Flags, ErdSize, ErdData (random
// data encrypted with the password-derived master key), Reserved (certificate count, 0 for password-only), VSize,
// VData (validation data encrypted with the file key, ending in its own CRC-32). Two-level keys: master key =
// derive(SHA1(password)); file key = derive(SHA1(IV || decrypted random data)). The 16 bytes of 0x10 at the end of
// the decrypted random data (PKCS#7 padding of a block-aligned plaintext) are a cheap first password test before the
// second derivation; the validation CRC is the definitive one.
function strongKey(r, z, passwords) {
  const ivSize = le16(r.bytes(2, 'decryption header'), 0);
  let iv, ivHash;
  if (ivSize === 0) {
    // No IV stored: CRC-32 and the 64-bit uncompressed size make it.
    iv = new Uint8Array(16);
    const v = new DataView(iv.buffer);
    v.setUint32(0, z.crc >>> 0, true);
    v.setUint32(4, z.size % 4294967296, true);
    v.setUint32(8, Math.floor(z.size / 4294967296), true);
    ivHash = iv.subarray(0, 12);
  } else if (ivSize === 16) ivHash = iv = r.bytes(16, 'decryption header');
  else fail('unsupported', 'not supported: PKWARE strong encryption IV of ' + ivSize + ' bytes');
  const remSize = le32(r.bytes(4, 'decryption header'), 0);
  // 256 KiB cap: a sanity bound before allocating; real headers are a few hundred bytes.
  if (remSize < 16 || remSize > 1 << 18) fail('corrupt', 'corrupt PKWARE decryption header');
  const p = r.bytes(remSize, 'decryption header');
  const format = le16(p, 0), alg = le16(p, 2), bits = le16(p, 4), flags = le16(p, 6);
  const keyLen = PK_AES_KEY[alg];
  if (format !== 3) fail('unsupported', 'not supported: PKWARE decryption header format ' + format);
  if (!keyLen || bits !== keyLen * 8) fail('unsupported', 'not supported: PKWARE strong encryption ' + (PK_ALGS[alg] || '0x' + alg.toString(16)));
  if (flags & 0x4000) fail('unsupported', 'not supported: PKWARE strong encryption with 3DES random data');
  if (!(flags & 1)) fail('unsupported', 'not supported: PKWARE strong encryption with certificates');
  const rdSize = le16(p, 8);
  if (rdSize < 16 || rdSize + 16 > remSize || rdSize % 16) fail('corrupt', 'corrupt PKWARE decryption header');
  const rd = p.subarray(10, 10 + rdSize);
  if (le32(p, 10 + rdSize) !== 0) fail('unsupported', 'not supported: PKWARE strong encryption with certificates');
  const vSize = le16(p, 14 + rdSize), vOff = 16 + rdSize;
  if (vSize < 16 || vSize % 16 || vOff + vSize !== remSize) fail('corrupt', 'corrupt PKWARE decryption header');
  for (const pw of passwords) {
    const master = deriveKey(sha1(pw)).subarray(0, keyLen);
    const plain = aesCbcDecrypt(master, iv, rd, { padding: false });
    let padOk = true;
    for (let i = rdSize - 16; i < rdSize; i++) if (plain[i] !== 16) padOk = false;
    if (!padOk) continue;
    const key = deriveKey(sha1.create().update(ivHash).update(plain.subarray(0, rdSize - 16)).digest()).subarray(0, keyLen);
    const v = aesCbcDecrypt(key, iv, p.subarray(vOff, vOff + vSize), { padding: false });
    if (le32(v, vSize - 4) !== crc32(v.subarray(0, vSize - 4))) continue;
    // The file data continues the CBC chain of the validation data.
    return { key, iv: p.slice(vOff + vSize - 16, vOff + vSize), headerLen: 6 + (ivSize ? 16 : 0) + remSize };
  }
  return fail('badPassword', 'wrong password');
}

// --- local header scan ----------------------------------------------------------------------------------------

// 'PK' 03 04 local header, 07 08 data descriptor (signature optional per APPNOTE 4.3.9.3), 01 02 central header,
// 05 06 end of central directory.
const SIG_LOCAL = 0x04034b50, SIG_DESC = 0x08074b50, SIG_CENTRAL = 0x02014b50, SIG_END = 0x06054b50;

/**
 * Entries of a ZIP without a usable central directory, from its local headers (same shape as listZip's entries).
 * Data descriptors (flag 3) are found by their signature or by the next header, with the compressed size matching
 * the distance; the last entry of a truncated file keeps what is there.
 */
export function scanLocalHeaders(src, { charset = 'auto', start = 0, max = 1e6 } = {}) {
  const entries = [];
  let pos = start, truncated = false;
  while (entries.length < max && pos + 30 <= src.size) {
    const h = src.read(pos, 30);
    if (le32(h, 0) !== SIG_LOCAL) {
      // Split archives begin with a spanning marker; anything else ends the scan.
      if (pos === start && le32(h, 0) === SIG_DESC) { pos += 4; continue; }
      break;
    }
    const flags = le16(h, 6), method = le16(h, 8), dosTime = le16(h, 10), dosDate = le16(h, 12);
    let crc = le32(h, 14), csize = le32(h, 18), size = le32(h, 22);
    const nlen = le16(h, 26), xlen = le16(h, 28);
    const meta = src.read(pos + 30, nlen + xlen);
    if (meta.length < nlen + xlen) { truncated = true; break; }
    // Flag bits 0 (encrypted) + 6 (strong) + 13 (central directory encrypted, local header fields masked): without
    // the directory the masked local fields are meaningless, so there is nothing to recover.
    if ((flags & 0x2041) === 0x2041) fail('unsupported', 'not supported: ZIP with an encrypted central directory (PKWARE SecureZIP)');
    const nameBytes = meta.subarray(0, nlen), extra = meta.subarray(nlen);
    let zip64 = false, aes = null, unicodeName = null, mtime = null;
    for (let x = 0; x + 4 <= extra.length;) {
      const id = le16(extra, x), len = le16(extra, x + 2), o = x + 4;
      if (o + len > extra.length) break;
      // Extra fields used here: 0x0001 Zip64 (local order: size then csize, present only for 0xFFFFFFFF fields),
      // 0x9901 WinZip AES (version, 'AE', strength, real method), 0x7075 Info-ZIP Unicode Path (honoured only when
      // its CRC matches the header name, so a renamed-by-a-legacy-tool entry falls back to the header name),
      // 0x5455 extended timestamp (flag bit 0 = mtime as signed int32 Unix seconds, hence | 0).
      if (id === 0x0001) {
        zip64 = true;
        let q = o;
        if (size === 0xffffffff && q + 8 <= o + len) { size = le64(extra, q); q += 8; }
        if (csize === 0xffffffff && q + 8 <= o + len) { csize = le64(extra, q); q += 8; }
      } else if (id === 0x9901 && len >= 7) aes = { version: le16(extra, o), strength: extra[o + 4], method: le16(extra, o + 5) };
      else if (id === 0x7075 && len >= 5 && extra[o] === 1 && le32(extra, o + 1) === crc32(nameBytes)) unicodeName = utf8(extra.subarray(o + 5, o + len));
      else if (id === 0x5455 && len >= 5 && extra[o] & 1) mtime = new Date((le32(extra, o + 1) | 0) * 1000);
      x = o + len;
    }
    const dataStart = pos + 30 + nlen + xlen;
    let next = -1, cut = false;
    if (flags & 8) {
      // Sizes follow the data: the first descriptor whose compressed size equals the distance from the data start.
      const d = findDescriptor(src, dataStart, zip64);
      if (d) { crc = d.crc; csize = d.csize; size = d.size; next = d.next; }
    } else next = dataStart + csize;
    if (next < 0 || next > src.size) {
      // Cut off: the data that is there (its checks will fail on extraction).
      truncated = cut = true;
      csize = Math.max(0, src.size - dataStart);
      if (flags & 8 || method !== 0) size = undefined;
      next = src.size;
    }
    const name = unicodeName ?? (flags & 0x800 ? utf8(nameBytes) : decodeText(nameBytes, charset));
    const z = {
      name, nameBytes, flags, method, made: 0, needed: le16(h, 4), host: 0, crc, dosTime,
      time: dosDateTime(dosTime, dosDate) || undefined, attrs: 0, extra, utf8: (flags & 0x800) !== 0,
      encrypted: (flags & 1) !== 0, aes, strong: (flags & 0x40) !== 0, size, csize, offset: pos, zip64,
      dir: /[\\/]$/.test(name) && !csize, comment: '', cut,
    };
    z.mtime = mtime || z.time;
    z.dataOffset = () => dataStart;
    entries.push(z);
    pos = next;
  }
  return { entries, truncated, end: pos };
}

// Data descriptor search for streamed entries (flag bit 3). The compressed length is unknown, so candidates are
// validated by self-consistency: a descriptor is accepted only if its csize field equals its distance from the data
// start, which a chance 'PK 07 08' inside compressed data essentially never satisfies. Descriptors without their
// (optional) signature are recognised the same way, 12 bytes before the next header signature. 1 MiB windows overlap
// by 24 bytes (the largest descriptor) so no candidate is cut by a window edge. Cost: a linear scan of the entry's
// data, acceptable for a recovery path.
function findDescriptor(src, from, zip64) {
  const CH = 1 << 20;
  for (let at = from; at < src.size; at += CH - 24) {
    const b = src.read(at, CH);
    for (let i = b.indexOf(0x50); i >= 0 && i + 4 <= b.length; i = b.indexOf(0x50, i + 1)) {
      if (b[i + 1] !== 0x4b) continue;
      const sig = le32(b, i), p = at + i;
      if (sig === SIG_DESC && i + 16 <= b.length) {
        if (zip64 && i + 24 <= b.length && le64(b, i + 8) === p - from) return { crc: le32(b, i + 4), csize: le64(b, i + 8), size: le64(b, i + 16), next: p + 24 };
        if (le32(b, i + 8) === (p - from) % 4294967296) return { crc: le32(b, i + 4), csize: p - from, size: le32(b, i + 12), next: p + 16 };
      } else if ((sig === SIG_LOCAL || sig === SIG_CENTRAL || sig === SIG_END) && i >= 12) {
        // A descriptor without its signature right before the next header.
        if (le32(b, i - 8) === (p - 12 - from) % 4294967296 && p - 12 >= from) return { crc: le32(b, i - 12), csize: p - 12 - from, size: le32(b, i - 4), next: p };
      }
    }
    if (b.length < CH) break;
  }
  // A descriptor without its signature at the very end (the last entry of an archive without a directory).
  const end = src.size;
  if (end - 12 >= from) {
    const t = src.read(end - 12, 12);
    if (le32(t, 4) === (end - 12 - from) % 4294967296) return { crc: le32(t, 0), csize: end - 12 - from, size: le32(t, 8), next: end };
  }
  return null;
}

export function openZip(sources, opts = {}) {
  const src = concatSource(sources);
  const charset = opts.charset || 'auto';
  let dir;
  const warnings = [];
  // zip/zip.js throws plain Errors (it is shared with code that does not know ArchiveError); they are classified here
  // by message. Coupling to message text is fragile: a reworded error in zip/zip.js silently changes the category.
  try {
    dir = listZip(src, { charset: (b) => decodeText(b, charset), diskStarts: src.starts || [0] });
  } catch (e) {
    if (e instanceof ArchiveError) throw e;
    const msg = String(e.message || e);
    if (/missing volumes|outside the file/.test(msg)) fail('volume', msg);
    // No end record or a broken directory: a truncated or streamed archive still has its local headers.
    const scan = /not a ZIP|bad central directory/.test(msg) ? scanLocalHeaders(src, { charset, start: opts.offset || 0 }) : null;
    if (!scan || !scan.entries.length) {
      if (/not a ZIP/.test(msg)) fail('format', msg);
      fail('corrupt', msg);
    }
    dir = { entries: scan.entries, comment: '', zip64: scan.entries.some((z) => z.zip64), disks: 1, shift: 0 };
    warnings.push(scan.truncated ? 'the archive is truncated: the entries were found from their local headers' : 'no central directory: the entries were found from their local headers');
  }
  const arc = { password: opts.password ?? null };
  const methods = new Set();
  const entries = dir.entries.map((z, index) => {
    const method = z.aes ? z.aes.method : z.method;
    const kind = z.dir ? 'dir' : z.mode && (z.mode & 0xf000) === 0xa000 ? 'symlink' : 'file';
    const e = {
      index, path: z.name.replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '').replace(/\/+$/, ''), dir: z.dir, kind,
      size: z.size, packed: z.csize, mtime: z.mtime, atime: z.atime, ctime: z.ctime, mode: z.mode,
      // DOS attribute byte is meaningful only for hosts 0 (MS-DOS / FAT), 11 (NTFS) and 14 (VFAT). For AE-2 the CRC
      // field is deliberately 0 (WinZip omits it so small files do not leak plaintext via the CRC); the MAC replaces it.
      attrib: z.host === 0 || z.host === 11 || z.host === 14 ? z.attrs & 0xff : undefined,
      method: ZIP_METHODS[method] || 'method ' + method, encrypted: z.encrypted, crc: z.aes && z.aes.version === 2 ? undefined : z.crc,
      comment: z.comment || undefined, zip: z, zipMethod: method,
    };
    // PKWARE strong encryption: the algorithm is in the 0x0017 extra field (and in the decryption header).
    const strong = z.encrypted && !z.aes && (z.strong || (z.flags & 0x40)) ? strongInfo(z.extra) || { alg: 0 } : null;
    if (strong) e.strong = strong;
    if (z.encrypted) e.method += z.aes ? ' AES-' + ({ 1: 128, 2: 192, 3: 256 }[z.aes.strength] || '?') : strong ? ' ' + (PK_ALGS[strong.alg] || 'strong encryption') + ' (PKWARE)' : ' ZipCrypto';
    if (!z.dir) methods.add(e.method);
    if (strong && strong.alg && !PK_AES_KEY[strong.alg]) e.unsupported = 'PKWARE strong encryption ' + (PK_ALGS[strong.alg] || '0x' + strong.alg.toString(16));
    else if (strong && strong.flags != null && !(strong.flags & 1)) e.unsupported = 'PKWARE strong encryption with certificates';
    else if (!z.dir && !SUPPORTED.has(method)) e.unsupported = ZIP_METHODS[method] || 'method ' + method;
    return e;
  });
  // Symlink targets are the (small) data of the entry. Unix mode S_IFLNK (0xA000 in the high bits of the external
  // attributes) marks them; reading at list time costs one tiny decode per link and lets the UI show the target.
  for (const e of entries) {
    if (e.kind === 'symlink' && !e.encrypted && !e.unsupported && e.size < 4096) {
      try { e.link = new TextDecoder().decode(readAll(open(e), 4096)); } catch { /* listed without a target */ }
    }
  }
  function open(e) {
    const z = e.zip;
    if (e.dir || e.size === 0) return { size: 0, read: () => null };
    if (e.unsupported) fail('unsupported', 'not supported: ' + e.unsupported);
    const start = z.dataOffset();
    let packed = sourceStream(src, start, z.csize);
    let plain = packed;
    let tagCheck = null;
    if (z.encrypted) {
      if (arc.password == null) fail('password', 'password required');
      const r = new Reader(packed);
      if (z.aes) {
        const saltLen = AES_SALT[z.aes.strength];
        if (!saltLen) fail('unsupported', 'not supported: AES strength ' + z.aes.strength);
        // WinZip AES: salt (8/12/16 bytes), 2-byte password verifier, AES-CTR data, 10-byte HMAC-SHA1 tag. Keys come
        // from PBKDF2-HMAC-SHA1 (1000 iterations). The verifier rejects a wrong password with probability 1 - 2^-16;
        // the MAC over the ciphertext, checked at the end, catches the rest and any damage.
        const salt = r.bytes(saltLen, 'AES header'), pv = r.bytes(2, 'AES header');
        const k = aesKeys(enc.encode(arc.password), salt, z.aes.strength);
        if (k.verifier[0] !== pv[0] || k.verifier[1] !== pv[1]) fail('badPassword', 'wrong password');
        const aes = new WinZipAes(k.key, k.macKey);
        const body = limitStream({ read: (max) => r.chunk(max) }, z.csize - saltLen - 12, 'AES data');
        plain = { read(max) { const c = body.read(max); return c ? aes.decrypt(c) : null; } };
        tagCheck = () => {
          const tag = r.bytes(10, 'AES authentication code'), want = aes.tag();
          for (let i = 0; i < 10; i++) if (tag[i] !== want[i]) fail('checksum', 'AES authentication failed (damaged data): ' + e.path);
        };
      } else if (e.strong) {
        const pk = strongKey(r, z, passwordBytes(arc.password));
        const n = z.csize - pk.headerLen;
        if (n < 0 || n % 16) fail('corrupt', 'corrupt PKWARE encrypted data: ' + e.path);
        plain = cbcStream(limitStream({ read: (max) => r.chunk(max) }, n, 'encrypted data'), pk.key, pk.iv);
      } else {
        const head = r.bytes(12, 'encryption header');
        // ZipCrypto: the 12th byte of the decrypted header must equal the CRC's high byte, or, with a data descriptor
        // (CRC unknown when the header was written), the high byte of the DOS time (Info-ZIP convention, APPNOTE 6.1.6).
        const check = z.flags & 8 ? (z.dosTime >> 8) & 255 : z.crc >>> 24;
        let zc = null;
        for (const pw of passwordBytes(arc.password)) { const c = new ZipCrypto(pw); if (c.header(head) === check) { zc = c; break; } }
        if (!zc) fail('badPassword', 'wrong password');
        const body = limitStream({ read: (max) => r.chunk(max) }, z.csize - 12, 'encrypted data');
        plain = { read(max) { const c = body.read(max); return c ? zc.decrypt(c) : null; } };
      }
    }
    let out = decoderFor(e.zipMethod, new Reader(plain), e);
    if (z.cut) {
      // The archive ends inside this entry (no data descriptor was found): what is there, then an error.
      const inner = out;
      out = { read(max) { const b = inner.read(max); if (!b) fail('truncated', 'the archive ends inside ' + e.path); return b; } };
    }
    out = crcStream(out, e.crc, { name: e.path, size: e.size });
    if (z.encrypted) {
      // A wrong ZipCrypto password passes the 1-byte check 1 time in 256: decoding errors then mean a wrong password.
      const inner = out;
      let finished = false;
      out = {
        size: e.size,
        read(max) {
          try {
            const b = inner.read(max);
            if (!b && !finished) { finished = true; if (tagCheck) tagCheck(); }
            return b;
          } catch (err) {
            if (!z.aes && !e.strong && err instanceof ArchiveError && /^(corrupt|checksum|truncated)$/.test(err.code)) throw new ArchiveError('badPassword', 'wrong password or damaged data');
            throw err;
          }
        },
      };
    }
    return out;
  }
  const info = {
    encrypted: entries.some((e) => e.encrypted), methods: [...methods], comment: dir.comment || undefined,
    props: [['Entries', String(entries.length)]], warnings,
  };
  if (dir.zip64) info.props.push(['Zip64', 'yes']);
  if (dir.disks > 1) info.volumes = dir.disks;
  if (dir.shift) info.sfx = dir.shift;
  return {
    format: 'zip', label: 'ZIP', entries, info,
    get password() { return arc.password; }, set password(v) { arc.password = v; },
    open,
  };
}
