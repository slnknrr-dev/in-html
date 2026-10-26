// archive/rarbits.js - machinery shared by the RAR decoders (unpack15 / unpack20 / unpack29 / unpack50).
//
//   new BitInput(reader?)   MSB-first bits over an io.js Reader, after its end an endless run of zero bytes:
//     .getbits() (next 16 bits, left aligned at bit 15) .addbits(n) .bits(n <= 16) .getbits32() .align()
//     .byte() (byte-aligned input of the RAR 3 range coder) .bytePos() .over() (read past the end)
//     Decoders test `inp.pos > inp.border` once per symbol (no symbol takes 64 bytes) and then call refill().
//   new DecodeTable(maxSize) .build(lengths, offset, size) .decode(inp)
//     canonical Huffman code of RAR from 4-bit code lengths (0 = unused), codes up to 15 bits, quick table for short
//     codes and per-length limits for the rest (unrar's MakeDecodeTables / DecodeNumber, same results on bad data).
//   class Unpacker: base of the decoders. The window is a ring of W bytes addressed by absolute stream positions
//     (`abs` = bytes produced since the solid stream started, `wr` = bytes flushed); pending filters are kept by
//     absolute block start, so the RAR 3 / RAR 5 "next window" special cases of a masked ring disappear.
//     file(reader, size, solid, variant) -> Stream of one file (size -1 = unknown); a later file() call (next file of
//     a solid stream) first decodes the rest of the current file, whose stream then fails with code 'aborted'.
//     Subclasses implement init(solid, variant), run(target) (decode until abs >= target or the file's data ends:
//     set this.done) and applyFilter(filter, bytes, fileOffset) -> output bytes.
//   windowSize(dict, total, filterMax) -> ring size for a stream of `total` bytes (-1 unknown).

import { fail } from './io.js';

const CAP = 0x10000, PAD = 0x400;

export class BitInput {
  constructor(reader = null) {
    this.buf = new Uint8Array(CAP + PAD);
    this.r = null;
    this.pos = 0;     // byte index in buf
    this.bit = 0;     // bit index in buf[pos], 0 = most significant
    this.top = 0;     // bytes of input in buf
    this.base = 0;    // input offset of buf[0]
    this.eof = true;
    this.border = 0;
    if (reader) this.reset(reader);
  }

  reset(reader) {
    this.r = reader;
    this.pos = this.bit = this.top = this.base = 0;
    this.eof = false;
    this.refill();
  }

  // Keeps the unread bytes and appends input up to CAP. At the end the buffer continues with zeros (reads beyond the
  // array also give 0 in the bit expressions) and `border` becomes the end, so the next test reaches over().
  refill() {
    if (this.eof) return;
    const buf = this.buf, p = Math.min(this.pos, this.top);
    if (p > 0) {
      buf.copyWithin(0, p, this.top);
      this.base += p;
      this.top -= p;
      this.pos -= p;
    }
    while (this.top < CAP) {
      const c = this.r.chunk(CAP - this.top);
      if (!c) { this.eof = true; break; }
      buf.set(c, this.top);
      this.top += c.length;
    }
    // The 64-byte slack is the invariant that lets the hot path skip bounds checks: no single symbol (code + extra
    // bits, or a table header item) consumes 64 bytes, so a decoder that checks `pos > border` once per symbol can
    // read freely up to the next check without running off the buffered input.
    if (this.eof) { buf.fill(0, this.top); this.border = this.top; } else this.border = this.top - 64;
  }

  /** True once the decoder has read beyond the last input byte (unrar: InAddr > ReadTop). */
  over() { return this.eof && this.pos > this.top; }

  bytePos() { return this.base + this.pos; }

  // Peek 16 bits MSB-first: load 24 bits big-endian, shift out the `bit` already consumed bits of the first byte.
  // 24 bits suffice because bit <= 7 and 7 + 16 <= 24. Bytes past the array read as undefined, which | coerces to 0.
  getbits() {
    const b = this.buf, p = this.pos;
    return ((((b[p] << 16) | (b[p + 1] << 8) | b[p + 2]) >>> (8 - this.bit)) & 0xffff);
  }

  getbits32() {
    const b = this.buf, p = this.pos;
    return ((((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) << this.bit) | (b[p + 4] >>> (8 - this.bit))) >>> 0;
  }

  addbits(n) {
    n += this.bit;
    this.pos += n >> 3;
    this.bit = n & 7;
  }

  bits(n) {
    const v = this.getbits() >>> (16 - n);
    this.addbits(n);
    return v;
  }

  align() { if (this.bit) { this.pos++; this.bit = 0; } }

  byte() {
    if (this.pos >= this.border) this.refill();
    return this.buf[this.pos++] | 0;
  }
}

const COUNT = new Uint32Array(16), NEXT = new Uint32Array(16);

export class DecodeTable {
  constructor(maxSize) {
    this.limit = new Uint32Array(16); // left-aligned upper limit code of each bit length (DecodeLen)
    this.first = new Uint32Array(16); // index in `sym` of the first code of each length (DecodePos)
    this.sym = new Uint16Array(maxSize); // symbols in code order (DecodeNum)
    this.quick = new Int32Array(1024); // (length << 16) | symbol for the first `qbits` bits
    this.qbits = 10;
    this.size = 0;
  }

  build(lengths, off, size) {
    const count = COUNT, limit = this.limit, first = this.first, sym = this.sym;
    count.fill(0);
    for (let i = 0; i < size; i++) count[lengths[off + i] & 15]++;
    count[0] = 0;
    sym.fill(0, 0, size);
    first[0] = 0;
    limit[0] = 0;
    let upper = 0;
    for (let i = 1; i < 16; i++) {
      upper += count[i];
      // Canonical Huffman: codes of length i follow, in order, after all shorter codes doubled per length step.
      // limit[i] is the first left-aligned 16-bit value NOT covered by codes of length <= i, so decoding finds the
      // length as the smallest i with bitfield < limit[i]. An over-subscribed length set makes upper exceed 2^i; the
      // multiplication then wraps, which is kept on purpose to reproduce unrar's behaviour on corrupt tables.
      limit[i] = upper * (1 << (16 - i)); // stored modulo 2^32 like unrar's uint
      upper *= 2;
      first[i] = first[i - 1] + count[i - 1];
    }
    const next = NEXT;
    next.set(first);
    for (let i = 0; i < size; i++) {
      const l = lengths[off + i] & 15;
      if (l) sym[next[l]++] = i;
    }
    this.size = size;
    // More quick bits for the large literal / length alphabets (unrar: NC, NC20, NC30 get 10, the others 7).
    // Quick table: one lookup resolves every code of length <= qbits (the frequent ones by construction of Huffman
    // codes); longer codes fall back to the per-length limit scan. 2^10 entries fit in L1 cache.
    const qb = this.qbits = size >= 298 ? 10 : 7, quick = this.quick;
    let len = 1;
    for (let code = 0, n = 1 << qb; code < n; code++) {
      const bf = code << (16 - qb);
      while (len < 16 && bf >= limit[len]) len++;
      let s = 0;
      if (len < 16) {
        const p = first[len] + ((bf - limit[len - 1]) >>> (16 - len));
        if (p < size) s = sym[p];
      }
      quick[code] = (len << 16) | s;
    }
  }

  decode(inp) {
    const bf = inp.getbits() & 0xfffe;
    if (bf < this.limit[this.qbits]) {
      const e = this.quick[bf >>> (16 - this.qbits)];
      inp.addbits(e >>> 16);
      return e & 0xffff;
    }
    return this.slow(inp, bf);
  }

  // Codes longer than the quick table (hot loops inline the quick part and call this with the 16-bit field & 0xfffe).
  slow(inp, bf) {
    const limit = this.limit;
    let bits = 15;
    for (let i = this.qbits + 1; i < 15; i++) if (bf < limit[i]) { bits = i; break; }
    inp.addbits(bits);
    let p = this.first[bits] + ((bf - limit[bits - 1]) >>> (16 - bits));
    if (p >= this.size) p = 0;
    return this.sym[p];
  }
}

// Output is produced in steps of about STEP bytes; the ring also holds the history (the dictionary), the largest
// pending filter block and one match, so unflushed data is never overwritten.
const STEP = 0x100000, SLACK = 0x10000;

export function windowSize(dict, total, filterMax = 0) {
  const need = Math.max(dict, STEP + filterMax) + SLACK;
  return total >= 0 && total + SLACK < need ? total + SLACK : need;
}

export class Unpacker {
  constructor(size) {
    try { this.win = new Uint8Array(size); } catch { fail('limit', `cannot allocate a dictionary window of ${size} bytes`); }
    this.W = size;
    this.ptr = 0;            // ring index of `abs`
    this.abs = 0;            // absolute position of the next decoded byte
    this.wr = 0;             // absolute position flushed so far
    this.filters = [];       // pending filters in order: { start (absolute), length, ... }
    this.chain = false;      // RAR 3: filters on the same block apply one after another
    this.inp = new BitInput();
    this.fileStart = 0;
    this.out = 0;            // bytes the current file has produced (unrar: WrittenFileSize)
    this.size = -1;
    this.done = true;
    this.token = null;
    this.chunk = null;
    this.cpos = 0;
    this.scratch = new Uint8Array(0);
  }

  file(reader, size, solid, variant) {
    // A solid continuation needs the rest of the current file; a new stream only cuts the old one off.
    if (this.token) { if (solid) this.finish(); else this.token.detached = true; }
    if (!solid) this.ptr = this.abs = this.wr = 0;
    this.inp.reset(reader);
    this.fileStart = this.abs;
    this.out = 0;
    this.size = size;
    this.done = false;
    this.filters.length = 0; // filters never cross files, also in solid archives
    this.chunk = null;
    this.init(solid, variant);
    const token = this.token = { ended: false, detached: false };
    return { size: size >= 0 ? size : undefined, read: (max) => this.read(token, max) };
  }

  // Decodes the rest of the current file (the next file of a solid stream starts after it).
  finish() {
    const token = this.token;
    while (this.read(token, Infinity) !== null);
    token.detached = true;
  }

  read(token, max = STEP) {
    if (token !== this.token) {
      if (token.detached) fail('aborted', 'the solid stream has moved on to another file');
      return null;
    }
    for (;;) {
      const c = this.chunk;
      if (c) {
        const n = Math.min(max, c.length - this.cpos), r = c.subarray(this.cpos, this.cpos + n);
        this.cpos += n;
        if (this.cpos >= c.length) this.chunk = null;
        return r;
      }
      const v = this.flush();
      if (v) {
        if (v.length) { this.chunk = v; this.cpos = 0; }
        continue;
      }
      if (this.done) {
        if (this.wr < this.abs) { this.filters.length = 0; continue; } // a filter block the data never completed
        token.ended = true;
        this.token = null;
        if (this.size >= 0 && this.out < this.size) {
          fail(this.inp.over() ? 'truncated' : 'corrupt', `compressed data ended after ${this.out} of ${this.size} bytes`);
        }
        return null;
      }
      let target = this.wr + STEP;
      const f = this.filters[this.nextFilter()];
      if (f && f.start < target) target = Math.max(target, f.start + f.length);
      this.run(Math.max(target, this.abs + 1));
    }
  }

  // Index of the pending filter with the lowest block start (encoders send them in order; damaged data may not).
  nextFilter() {
    const fs = this.filters;
    let k = 0;
    for (let i = 1; i < fs.length; i++) if (fs[i].start < fs[k].start) k = i;
    return k;
  }

  // Next ready piece of output (a view of the ring or of a filter's output) or null when more decoding is needed.
  flush() {
    for (;;) {
      let end = this.abs;
      const k = this.nextFilter(), f = this.filters.length ? this.filters[k] : null;
      if (f) {
        if (f.start < this.wr) { this.filters.splice(k, 1); continue; } // overlaps written data: never applicable
        if (f.start < end || f.start === this.wr) {
          if (f.start > this.wr) end = f.start;
          else {
            const fend = f.start + f.length;
            if (fend > this.abs) return null; // wait for the rest of the block
            this.filters.splice(k, 1);
            let out = this.applyFilter(f, this.region(f.start, f.length), this.out);
            for (let j; this.chain && (j = this.filters.findIndex((g) => g.start === f.start)) >= 0 && this.filters[j].length === out.length;) {
              out = this.applyFilter(this.filters.splice(j, 1)[0], out, this.out);
            }
            return this.emit(out, fend);
          }
        }
      }
      if (end <= this.wr) return null;
      const i = this.index(this.wr), n = Math.min(end - this.wr, this.W - i);
      return this.emit(this.win.subarray(i, i + n), this.wr + n);
    }
  }

  emit(view, wr) {
    const before = this.out;
    this.out += view.length;
    this.wr = wr;
    if (this.size < 0) return view;
    const rem = this.size - before;
    return rem >= view.length ? view : view.subarray(0, Math.max(0, rem));
  }

  index(pos) {
    const i = this.ptr - (this.abs - pos);
    return i < 0 ? i + this.W : i;
  }

  /** Copy of the ring bytes [start, start + len) (filters work on copies: the window keeps the unfiltered data). */
  region(start, len) {
    if (this.scratch.length < len) this.scratch = new Uint8Array(Math.max(len, 2 * this.scratch.length));
    const dst = this.scratch, i = this.index(start), first = Math.min(len, this.W - i);
    dst.set(this.win.subarray(i, i + first), 0);
    if (first < len) dst.set(this.win.subarray(0, len - first), first);
    return dst.subarray(0, len);
  }
}
