// archive/io.js - synchronous byte plumbing of the archive library: random-access sources, pull streams, the buffered
// Reader that decoders take their input from, checksum-verifying streams, typed errors and small binary helpers.
//
// Everything is synchronous so decoders stay plain loops. In a Worker a File is read with FileReaderSync (fileSource),
// elsewhere the bytes are in memory (bytesSource); a page that wants to stay responsive runs the library in a Worker.
//
//   Source  { size, name, read(offset, length) -> Uint8Array }   (shorter only at the end; the view may be shared:
//                                                                   callers never write into it)
//   Stream  { read(max) -> Uint8Array | null, size? }              (null = end; the returned view is valid until the
//                                                                   next read() call; `size` = total output if known)
//
//   bytesSource(bytes, name), fileSource(file), concatSource(sources, name), sliceSource(src, offset, length)
//   sourceStream(src, offset, length), bytesStream(bytes), concatStreams(streams), limitStream(stream, n)
//   new Reader(stream)  .byte() .bytes(n) .skip(n) .chunk(max) .pos .eof()   (decoder input)
//   readAll(stream, limit), drain(stream), crcStream(stream, crc, { name, size }), hashStream(stream, fn, check)
//   ArchiveError(code, message, detail): code 'format' | 'corrupt' | 'checksum' | 'password' | 'badPassword' |
//     'unsupported' | 'volume' | 'truncated' | 'aborted' | 'limit'
//   le16 / le32 / le64 / be16 / be32, dosDateTime, unixTime, fileTime, concat, latin1, utf8, decodeText, CP437
//
// Key decisions:
// - Pull, not push: a decoder asks for bytes when it needs them, so a format that must look ahead (ZIP data
//   descriptors, LZMA end markers) never needs an internal re-buffering protocol. Push (WHATWG streams) would force
//   every decoder into a resumable state machine; that cost buys nothing in a Worker that may block.
// - Zero-copy views with a short validity window: read() may return a subarray of a shared buffer, so consumers that
//   keep data across calls must copy (readAll does .slice()). Copying in every layer would double memory traffic.
// - One error type with a machine code: the UI branches on `code` (ask for a password, offer the next volume), never
//   on message text, which is free to change.

import { crc32 } from '../codec/crc32.js';

export class ArchiveError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'ArchiveError';
    this.code = code;
    if (detail) Object.assign(this, detail);
  }
}
// fail() is an expression (arrow that always throws), so it composes inside `cond || fail(...)` and ternaries.
export const fail = (code, message, detail) => { throw new ArchiveError(code, message, detail); };
export const corrupt = (what) => fail('corrupt', 'corrupt data: ' + what);
export const unsupported = (what) => fail('unsupported', 'not supported: ' + what);

export const EMPTY = new Uint8Array(0);
// Normalises any BufferSource to a Uint8Array view without copying; a DataView / Int16Array is reinterpreted over the
// same bytes (byteOffset kept), an ArrayBuffer is wrapped.
export const toU8 = (b) => (b instanceof Uint8Array ? b : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b));

// --- sources ---------------------------------------------------------------------------------------------------

// subarray clamps: a read past the end returns a short (possibly empty) view, the Source contract's end signal.
export function bytesSource(bytes, name = '') {
  const b = toU8(bytes);
  return { name, size: b.length, bytes: b, read: (off, len) => b.subarray(Math.min(off, b.length), Math.min(b.length, off + len)) };
}

/**
 * File / Blob source for Workers (FileReaderSync). Small reads (headers) go through a cache of 64 KiB blocks, large
 * reads go straight to the file. `stats.read` counts the bytes taken from the file (progress of sequential work).
 */
export function fileSource(file, name = file.name || '') {
  const reader = new FileReaderSync();
  const BLOCK = 65536, KEEP = 32;
  const cache = new Map();
  const stats = { read: 0 };
  const raw = (off, len) => {
    const b = new Uint8Array(reader.readAsArrayBuffer(file.slice(off, off + len)));
    stats.read += b.length;
    return b;
  };
  const block = (i) => {
    let b = cache.get(i);
    // LRU on a Map: insertion order is iteration order, so delete + set moves the block to the young end and
    // keys().next() is the oldest. O(1) per access without a linked list.
    if (b) { cache.delete(i); cache.set(i, b); return b; }
    b = raw(i * BLOCK, BLOCK);
    cache.set(i, b);
    if (cache.size > KEEP) cache.delete(cache.keys().next().value);
    return b;
  };
  return {
    name, size: file.size, stats, file,
    read(off, len) {
      len = Math.max(0, Math.min(len, file.size - off));
      if (len <= 0) return EMPTY;
      // Bulk reads (entry data) bypass the cache: caching them would evict the header blocks that random access
      // (central directory, ISO path tables) keeps revisiting, and each block would be touched only once anyway.
      if (len >= 4 * BLOCK) return raw(off, len);
      const first = Math.floor(off / BLOCK), last = Math.floor((off + len - 1) / BLOCK);
      if (first === last) { const b = block(first); return b.subarray(off - first * BLOCK, off - first * BLOCK + len); }
      const out = new Uint8Array(len);
      for (let i = first, o = 0; i <= last; i++) {
        const b = block(i);
        const s = i === first ? off - first * BLOCK : 0;
        const e = Math.min(b.length, off + len - i * BLOCK);
        out.set(b.subarray(s, e), o);
        o += e - s;
      }
      return out;
    },
  };
}

/** Logical concatenation (split volumes such as name.7z.001, .002 …). `starts[i]` is the offset of part i. */
export function concatSource(sources, name = sources[0] ? sources[0].name : '') {
  if (sources.length === 1) return sources[0];
  const starts = [];
  let size = 0;
  for (const s of sources) { starts.push(size); size += s.size; }
  return {
    name, size, parts: sources, starts,
    read(off, len) {
      len = Math.max(0, Math.min(len, size - off));
      if (len <= 0) return EMPTY;
      // Linear scan: volume counts are small (tens), a binary search would not pay for itself.
      let i = 0;
      while (i + 1 < sources.length && starts[i + 1] <= off) i++;
      if (off + len <= starts[i] + sources[i].size) return sources[i].read(off - starts[i], len);
      const out = new Uint8Array(len);
      for (let o = 0; o < len; i++) {
        const b = sources[i].read(off + o - starts[i], Math.min(len - o, sources[i].size - (off + o - starts[i])));
        out.set(b, o);
        o += b.length;
        if (!b.length) break;
      }
      return out;
    },
  };
}

// Window of a source; reads are clamped to the window so a decoder can never see bytes of the neighbouring member.
export function sliceSource(src, offset, length = src.size - offset) {
  length = Math.max(0, Math.min(length, src.size - offset));
  return { name: src.name, size: length, read: (off, len) => src.read(offset + off, Math.max(0, Math.min(len, length - off))) };
}

/** Reads exactly `len` bytes at `off` (throws 'truncated' when the source is shorter). */
export function readAt(src, off, len) {
  const b = src.read(off, len);
  if (b.length < len) fail('truncated', `unexpected end of ${src.name || 'archive'} at ${off + b.length}`);
  return b;
}

// --- streams ---------------------------------------------------------------------------------------------------

// 1 MiB: large enough that per-call overhead (FileReaderSync, function dispatch) is negligible, small enough that
// a few live chunks do not pressure memory on multi-GB inputs.
const CHUNK = 1 << 20;

/** Bytes [offset, offset + length) of a source as a stream. */
export function sourceStream(src, offset = 0, length = src.size - offset, chunk = CHUNK) {
  let pos = offset;
  const end = offset + length;
  return {
    size: length,
    read(max = chunk) {
      if (pos >= end) return null;
      const b = src.read(pos, Math.min(max, chunk, end - pos));
      // An empty read before `end` means the declared length lies; failing here stops an infinite loop upstream.
      if (!b.length) fail('truncated', `unexpected end of ${src.name || 'archive'} at ${pos}`);
      pos += b.length;
      return b;
    },
  };
}

export function bytesStream(bytes) {
  let b = toU8(bytes), done = false;
  return { size: b.length, read(max = CHUNK) { if (done || !b.length) { done = true; return null; } const r = b.subarray(0, max); b = b.subarray(r.length); return r; } };
}

// Entries may be thunks (functions) opened lazily on first read: a multi-volume chain does not open volume N until
// volume N-1 is exhausted. `size` is known only if every part declares it (a thunk has no .size, so it is unknown).
export function concatStreams(streams) {
  let i = 0;
  const size = streams.every((s) => s.size != null) ? streams.reduce((n, s) => n + s.size, 0) : undefined;
  return {
    size,
    read(max) {
      while (i < streams.length) {
        const s = typeof streams[i] === 'function' ? (streams[i] = streams[i]()) : streams[i];
        const b = s.read(max);
        if (b && b.length) return b;
        i++;
      }
      return null;
    },
  };
}

/** Exactly `n` bytes of `stream` ('truncated' when it ends early); further input is left unread. */
export function limitStream(stream, n, what = 'data') {
  let left = n;
  return {
    size: n,
    read(max = CHUNK) {
      if (left <= 0) return null;
      const b = stream.read(Math.min(max, left));
      if (!b || !b.length) fail('truncated', `unexpected end of ${what}`);
      const r = b.length > left ? b.subarray(0, left) : b;
      left -= r.length;
      return r;
    },
  };
}

/** The whole stream in one array (`limit`: refuse longer output). */
export function readAll(stream, limit = Infinity) {
  const parts = [];
  let n = 0;
  for (let b; (b = stream.read(CHUNK));) {
    n += b.length;
    if (n > limit) fail('limit', 'data larger than ' + limit + ' bytes');
    // slice(), not the view: the stream may reuse its buffer on the next read().
    parts.push(b.slice());
  }
  return concat(parts, n);
}

/** Reads the stream to its end, discarding the bytes; returns the count. */
export function drain(stream) {
  let n = 0;
  for (let b; (b = stream.read(CHUNK));) n += b.length;
  return n;
}

/**
 * Passes `stream` through, feeding every chunk to `update`; at the end `check()` must return true, otherwise the
 * stream throws a 'checksum' error naming `name`. `size`: expected length (checked too).
 */
export function hashStream(stream, update, check, { name = '', size } = {}) {
  let n = 0, done = false;
  return {
    size: stream.size ?? size,
    read(max) {
      if (done) return null;
      const b = stream.read(max);
      if (b && b.length) { update(b); n += b.length; return b; }
      done = true;
      if (size != null && n !== size) fail('corrupt', `size mismatch${name ? ': ' + name : ''} (${n} of ${size} bytes)`);
      if (!check()) fail('checksum', `checksum mismatch${name ? ': ' + name : ''}`, { file: name });
      return null;
    },
  };
}

// CRC-32 (IEEE 802.3, reflected, poly 0xEDB88320) verification. `>>> 0` on the expected value: headers parsed with
// signed arithmetic may hold it as a negative int32; null skips the check (format without a stored CRC).
export function crcStream(stream, expected, opts = {}) {
  let c = 0;
  return hashStream(stream, (b) => { c = crc32(b, 0, b.length, c); }, () => expected == null || c === expected >>> 0, opts);
}

/**
 * Buffered input of the decoders: byte() returns the next byte or -1 at the end of the stream; `pos` counts the bytes
 * taken so far. The underlying stream is read only when the current chunk is used up, so its views stay valid.
 */
export class Reader {
  constructor(stream, chunk = CHUNK) {
    this.s = stream;
    this.chunkSize = chunk;
    this.b = EMPTY;
    this.p = 0;
    this.e = 0;
    this.base = 0;
    this.done = false;
  }

  // Fields: b = current chunk, p = cursor in it, e = its length, base = stream offset of b[0]. pos is thus the
  // absolute input offset, used by formats that store compressed sizes or need padding to an alignment.
  get pos() { return this.base + this.p; }

  fill() {
    if (this.done) return false;
    const c = this.s.read(this.chunkSize);
    if (!c || !c.length) { this.done = true; return false; }
    this.base += this.e;
    this.b = c;
    this.p = 0;
    this.e = c.length;
    return true;
  }

  // Hot path of every entropy decoder: one compare and one index in the common case; fill() only at chunk boundaries.
  byte() {
    if (this.p < this.e) return this.b[this.p++];
    return this.fill() ? this.b[this.p++] : -1;
  }

  eof() { return this.p >= this.e && !this.fill(); }

  /** Puts back the byte just returned by byte() (always possible: it is still in the current chunk). */
  unread() { if (this.p > 0) this.p--; }

  /** Up to `max` bytes as a view (valid until the next call), null at the end. */
  chunk(max) {
    if (this.p >= this.e && !this.fill()) return null;
    const n = Math.min(max, this.e - this.p);
    const r = this.b.subarray(this.p, this.p + n);
    this.p += n;
    return r;
  }

  /** Exactly n bytes (a copy; 'truncated' when the stream ends first). */
  bytes(n, what = 'data') {
    const out = new Uint8Array(n);
    for (let o = 0; o < n;) {
      const c = this.chunk(n - o);
      if (!c) fail('truncated', 'unexpected end of ' + what);
      out.set(c, o);
      o += c.length;
    }
    return out;
  }

  skip(n, what = 'data') {
    while (n > 0) {
      const c = this.chunk(Math.min(n, CHUNK));
      if (!c) fail('truncated', 'unexpected end of ' + what);
      n -= c.length;
    }
  }

  u8(what) { const v = this.byte(); if (v < 0) fail('truncated', 'unexpected end of ' + (what || 'data')); return v; }
  // Little-endian: JS evaluates operands left to right, so the first u8() call is the low byte (guaranteed by spec,
  // not an engine accident). u32 needs >>> 0 because << 16 can set bit 31 and make the int32 negative.
  u16(what) { return this.u8(what) | (this.u8(what) << 8); }
  u32(what) { return (this.u16(what) | (this.u16(what) << 16)) >>> 0; }
}

// --- binary helpers --------------------------------------------------------------------------------------------

// Bitwise ops work on int32: `<< 24` of a byte >= 0x80 yields a negative number, hence >>> 0 for 32-bit values.
// le64 uses float arithmetic (hi * 2^32 + lo): exact up to 2^53, which covers any real file size; BigInt would make
// every offset computation slower and incompatible with Number-indexed APIs.
export const le16 = (b, o) => b[o] | (b[o + 1] << 8);
export const le32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
export const le64 = (b, o) => le32(b, o) + le32(b, o + 4) * 4294967296;
export const be16 = (b, o) => (b[o] << 8) | b[o + 1];
export const be32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

// Single part of the right length is returned as is (no copy): the common case of a one-chunk stream.
export function concat(parts, total) {
  if (parts.length === 1 && (total == null || parts[0].length === total)) return parts[0];
  const n = total ?? parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** MS-DOS date and time words -> Date (local time, as the archivers write it); null when the fields are invalid. */
// Layout: date = yyyyyyy mmmm ddddd (year since 1980), time = hhhhh mmmmmm sssss (seconds / 2, so odd seconds are
// unrepresentable). No time zone is stored, hence local time.
// KNOWN DEFECT: the Date constructor normalises out-of-range fields (month 0 or 13, day 0, hour 31) by rolling over
// instead of producing NaN, so the isNaN check almost never fires and invalid fields yield a shifted date instead of
// null. Fix: range-check month 1-12, day 1-31, hour < 24, minute < 60, seconds < 60 before constructing.
export function dosDateTime(time, date) {
  if (!date && !time) return null;
  const d = new Date(((date >> 9) & 0x7f) + 1980, ((date >> 5) & 0xf) - 1, date & 0x1f, (time >> 11) & 0x1f, (time >> 5) & 0x3f, (time & 0x1f) * 2);
  return isNaN(d) ? null : d;
}
/** Unix seconds (may be fractional or negative) -> Date. */
export const unixTime = (s) => (Number.isFinite(s) ? new Date(s * 1000) : null);
/** Windows FILETIME (100 ns since 1601) given as two 32-bit halves -> Date (null for 0). */
export function fileTime(lo, hi) {
  if (!lo && !hi) return null;
  // 10000 ticks per ms; 11644473600000 ms = 369 years (with 89 leap days) between 1601-01-01 and 1970-01-01.
  const ms = (hi * 4294967296 + lo) / 10000 - 11644473600000;
  return Number.isFinite(ms) ? new Date(ms) : null;
}

// --- text ------------------------------------------------------------------------------------------------------

// Decoders built once: TextDecoder construction is not free and names are decoded per entry. The lenient one maps
// bad sequences to U+FFFD (display); the fatal one is only a validity probe for the charset guess.
const UTF8 = new TextDecoder('utf-8');
const UTF8_FATAL = new TextDecoder('utf-8', { fatal: true });
export const utf8 = (b) => UTF8.decode(b);
export const latin1 = (b) => { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; };
export const isUtf8 = (b) => { try { UTF8_FATAL.decode(b); return true; } catch { return false; } };
// "Printable ASCII" (0x20-0x7E plus TAB): control bytes in a name suggest a non-ASCII charset, not plain text.
export const isAscii = (b) => { for (let i = 0; i < b.length; i++) if (b[i] > 0x7e || (b[i] < 0x20 && b[i] !== 9)) return false; return true; };

// IBM437 upper half (DOS / legacy ZIP / ARC names), indexed by byte - 128; the last char (0xFF) is NBSP. Spelled out
// because TextDecoder has no 'ibm437' label in the WHATWG Encoding standard. The lower half is taken as ASCII; the
// CP437 graphic glyphs for 0x01-0x1F (smileys, arrows) are deliberately not mapped, they never appear in real names.
export const CP437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
const cp437 = (b) => { let s = ''; for (let i = 0; i < b.length; i++) s += b[i] < 128 ? String.fromCharCode(b[i]) : CP437[b[i] - 128]; return s; };

const DECODERS = new Map();
// Memoised per label; an unknown label is cached as null so the try/catch runs once, and decodeText falls back to CP437.
function decoderFor(label) {
  if (!DECODERS.has(label)) { try { DECODERS.set(label, new TextDecoder(label)); } catch { DECODERS.set(label, null); } }
  return DECODERS.get(label);
}

/**
 * Legacy (non-Unicode) name bytes -> string. `charset`: 'auto' (UTF-8 when valid, otherwise a guess between the DOS
 * code pages 437 and 866 and Windows-1251 by the distribution of the high bytes), 'utf-8', 'cp437', or any
 * TextDecoder label ('ibm866', 'windows-1251', 'windows-1252', 'shift_jis', 'gbk', 'big5', 'euc-kr', …).
 */
export function decodeText(b, charset = 'auto') {
  if (isAscii(b)) return latin1(b);
  if (charset === 'auto') {
    if (isUtf8(b)) return utf8(b);
    charset = guessCharset(b);
  }
  if (charset === 'utf-8') return utf8(b);
  if (charset === 'cp437') return cp437(b);
  const d = decoderFor(charset);
  return d ? d.decode(b) : cp437(b);
}

/**
 * Guess for legacy bytes: Cyrillic in CP866 (0x80-0xAF, 0xE0-0xF1; 0xF0/0xF1 are Yo/yo) or Windows-1251 (0xC0-0xFF),
 * else CP437. Ranges overlap (0xE0-0xF1 counts for both), hence the n866 >= n1251 tie-break and the high 0.85 bar:
 * a statistical guess on a short name is weak, and CP437 is the documented ZIP default when evidence is ambiguous.
 */
export function guessCharset(b) {
  let n866 = 0, n1251 = 0, high = 0;
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c < 0x80) continue;
    high++;
    if (c <= 0xaf || (c >= 0xe0 && c <= 0xf1)) n866++;
    if (c >= 0xc0) n1251++;
  }
  if (!high) return 'cp437';
  // Box drawing (0xB0-0xDF) is rare in names: letters dominate in a real Cyrillic name.
  if (n866 / high > 0.85 && n866 >= n1251) return 'ibm866';
  if (n1251 / high > 0.85) return 'windows-1251';
  return 'cp437';
}
