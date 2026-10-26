// archive/unpack50.js - RAR 5.0 and RAR 7.0 decompression (the methods of RAR 5 archives).
//
//   const u = new Unpack50(windowSize(dict, total, UNPACK50_FILTER_MAX))
//   u.file(reader, size, solid, v7) -> Stream      (v7: RAR 7.0 algorithm, 80 distance slots; see rarbits.js)
//
// Input: blocks with a byte-aligned header (flags, checksum, size) and optional Huffman tables (main 306 symbols:
// literals, filter, repeat, 4 old distances, 44 length slots; distances 64 or 80 slots; 16 low-distance codes; 44
// repeat-length slots). Filters DELTA, E8, E8E9 and ARM work on blocks of up to 4 MiB of output. Distances are plain
// Numbers, so dictionaries above 4 GiB work as far as a typed array of that size can be allocated.

import { corrupt, unsupported } from './io.js';
import { DecodeTable, Unpacker } from './rarbits.js';

const NC = 306, DCB = 64, DCX = 80, LDC = 16, RC = 44, BC = 20;
export const UNPACK50_FILTER_MAX = 0x400000;
const MAX_FILTERS = 8192;
const POW2 = new Float64Array(64).map((_, i) => 2 ** i);

export class Unpack50 extends Unpacker {
  constructor(size) {
    super(size);
    this.BD = new DecodeTable(BC);
    this.LD = new DecodeTable(NC);
    this.DD = new DecodeTable(DCX);
    this.LDD = new DecodeTable(LDC);
    this.RD = new DecodeTable(RC);
    this.lens = new Uint8Array(NC + DCX + LDC + RC);
    this.bl = new Uint8Array(BC);
    this.od = new Float64Array(4);
    this.lastLen = 0;
    this.v7 = false;
    this.tablesRead = false;
    this.started = false;
    this.blockEnd = 0;   // absolute input offset of the last byte of the block
    this.blockBits = 0;  // bits used in that byte
    this.lastBlock = false;
    this.tablePresent = false;
    this.dst = new Uint8Array(0);
  }

  init(solid, v7) {
    this.v7 = !!v7;
    if (!solid) {
      this.tablesRead = false;
      this.od.fill(0);
      this.lastLen = 0;
    }
    this.started = false;
  }

  blockHeader() {
    const inp = this.inp;
    if (inp.pos > inp.border) inp.refill();
    inp.align();
    // Block header: flags (bits 0-2: valid bits in the last byte - 1, bits 3-4: size field bytes - 1, bit 6: last
    // block, bit 7: tables follow), an 8-bit checksum 0x5A ^ flags ^ size bytes, then the size. Checking the checksum
    // before trusting `size` stops a corrupt length from steering the decoder far past the block.
    const flags = inp.bits(8), n = ((flags >> 3) & 3) + 1;
    if (n === 4) corrupt('RAR 5 block header');
    const sum = inp.bits(8);
    let size = 0;
    for (let i = 0; i < n; i++) size += inp.bits(8) << (8 * i);
    if (sum !== ((0x5a ^ flags ^ size ^ (size >> 8) ^ (size >> 16)) & 0xff)) corrupt('RAR 5 block header checksum');
    if (inp.over()) corrupt('RAR 5 block header beyond the data');
    this.blockEnd = inp.bytePos() + size - 1;
    this.blockBits = (flags & 7) + 1;
    this.lastBlock = (flags & 0x40) !== 0;
    this.tablePresent = (flags & 0x80) !== 0;
  }

  readTables() {
    if (!this.tablePresent) return;
    const inp = this.inp, bl = this.bl, t = this.lens;
    if (inp.pos > inp.border) inp.refill();
    for (let i = 0; i < BC; i++) {
      const l = inp.bits(4);
      if (l === 15) {
        let z = inp.bits(4);
        if (z === 0) bl[i] = 15;
        else {
          z += 2;
          while (z-- > 0 && i < BC) bl[i++] = 0;
          i--;
        }
      } else bl[i] = l;
    }
    this.BD.build(bl, 0, BC);
    const dc = this.v7 ? DCX : DCB, size = NC + dc + LDC + RC;
    for (let i = 0; i < size;) {
      if (inp.pos > inp.border) { inp.refill(); if (inp.over()) corrupt('RAR 5 Huffman table beyond the data'); }
      const n = this.BD.decode(inp);
      if (n < 16) t[i++] = n;
      else if (n < 18) {
        let c = n === 16 ? inp.bits(3) + 3 : inp.bits(7) + 11;
        if (i === 0) corrupt('RAR 5 Huffman table');
        for (; c > 0 && i < size; c--, i++) t[i] = t[i - 1];
      } else {
        let c = n === 18 ? inp.bits(3) + 3 : inp.bits(7) + 11;
        for (; c > 0 && i < size; c--) t[i++] = 0;
      }
    }
    if (inp.over()) corrupt('RAR 5 Huffman table beyond the data');
    this.tablesRead = true;
    this.LD.build(t, 0, NC);
    this.DD.build(t, NC, dc);
    this.LDD.build(t, NC + dc, LDC);
    this.RD.build(t, NC + dc + LDC, RC);
  }

  pastBlock() {
    const p = this.inp.bytePos();
    return p > this.blockEnd || (p === this.blockEnd && this.inp.bit >= this.blockBits);
  }

  // The hot loop keeps the bit position in locals and inlines the quick-table part of the Huffman decoding; other
  // work (block headers, tables, filters, refills, long codes) goes through `inp` after storing the locals.
  run(target) {
    const inp = this.inp, win = this.win, W = this.W, od = this.od, buf = inp.buf;
    if (!this.started) {
      this.started = true;
      this.blockHeader();
      this.readTables();
      if (!this.tablesRead) corrupt('RAR 5 data without Huffman tables');
    }
    const LD = this.LD, DD = this.DD, LDD = this.LDD, RD = this.RD;
    const ldQ = LD.quick, ldL = LD.limit, ddQ = DD.quick, ddL = DD.limit, lddQ = LDD.quick, lddL = LDD.limit;
    const limit = this.size >= 0 ? this.fileStart + this.size : Infinity, small = W < 0x40000000;
    let ptr = this.ptr, abs = this.abs, pos = inp.pos, bit = inp.bit, end = this.blockEnd - inp.base, border = inp.border;
    let bf, e, slot, len, dist;
    while (abs < target) {
      if (pos >= end) {
        inp.pos = pos; inp.bit = bit;
        if (this.pastBlock()) {
          let fileDone = false;
          while (this.pastBlock()) {
            if (this.lastBlock) { fileDone = true; break; }
            this.blockHeader();
            this.readTables();
          }
          pos = inp.pos; bit = inp.bit; end = this.blockEnd - inp.base; border = inp.border;
          if (fileDone) { this.done = true; break; }
        }
      }
      if (pos > border) {
        inp.pos = pos; inp.bit = bit;
        inp.refill();
        pos = inp.pos; end = this.blockEnd - inp.base; border = inp.border;
        if (inp.over()) { this.done = true; break; }
      }
      if (abs > limit) { this.done = true; break; } // more output than the file has: damaged data

      bf = (((buf[pos] << 16) | (buf[pos + 1] << 8) | buf[pos + 2]) >>> (8 - bit)) & 0xfffe;
      if (bf < ldL[10]) { e = ldQ[bf >>> 6]; bit += e >>> 16; pos += bit >> 3; bit &= 7; slot = e & 0xffff; }
      else { inp.pos = pos; inp.bit = bit; slot = LD.slow(inp, bf); pos = inp.pos; bit = inp.bit; }
      if (slot < 256) {
        win[ptr++] = slot;
        abs++;
        if (ptr === W) ptr = 0;
        continue;
      }
      if (slot >= 262) {
        slot -= 262;
        if (slot < 8) len = 2 + slot;
        else {
          const lb = (slot >> 2) - 1;
          len = 2 + ((4 | (slot & 3)) << lb) + (((((buf[pos] << 16) | (buf[pos + 1] << 8) | buf[pos + 2]) >>> (8 - bit)) & 0xffff) >>> (16 - lb));
          bit += lb; pos += bit >> 3; bit &= 7;
        }
        bf = (((buf[pos] << 16) | (buf[pos + 1] << 8) | buf[pos + 2]) >>> (8 - bit)) & 0xfffe;
        if (bf < ddL[7]) { e = ddQ[bf >>> 9]; bit += e >>> 16; pos += bit >> 3; bit &= 7; slot = e & 0xffff; }
        else { inp.pos = pos; inp.bit = bit; slot = DD.slow(inp, bf); pos = inp.pos; bit = inp.bit; }
        if (slot < 4) dist = 1 + slot;
        else {
          const db = (slot >> 1) - 1;
          dist = 1 + (2 | (slot & 1)) * POW2[db];
          if (db >= 4) {
            if (db > 4) { inp.pos = pos; inp.bit = bit; dist += bigBits(inp, db - 4) * 16; pos = inp.pos; bit = inp.bit; }
            bf = (((buf[pos] << 16) | (buf[pos + 1] << 8) | buf[pos + 2]) >>> (8 - bit)) & 0xfffe;
            if (bf < lddL[7]) { e = lddQ[bf >>> 9]; bit += e >>> 16; pos += bit >> 3; bit &= 7; dist += e & 0xffff; }
            else { inp.pos = pos; inp.bit = bit; dist += LDD.slow(inp, bf); pos = inp.pos; bit = inp.bit; }
          } else {
            dist += ((((buf[pos] << 16) | (buf[pos + 1] << 8) | buf[pos + 2]) >>> (8 - bit)) & 0xffff) >>> (16 - db);
            bit += db; pos += bit >> 3; bit &= 7;
          }
        }
        if (dist > 0x100) { len++; if (dist > 0x2000) { len++; if (dist > 0x40000) len++; } }
        od[3] = od[2]; od[2] = od[1]; od[1] = od[0]; od[0] = dist;
        this.lastLen = len;
      } else if (slot === 256) {
        this.ptr = ptr; this.abs = abs; inp.pos = pos; inp.bit = bit;
        this.readFilter();
        pos = inp.pos; bit = inp.bit;
        continue;
      } else if (slot === 257) {
        if (this.lastLen === 0) continue;
        len = this.lastLen;
        dist = od[0];
      } else {
        const k = slot - 258;
        dist = od[k];
        for (let i = k; i > 0; i--) od[i] = od[i - 1];
        od[0] = dist;
        inp.pos = pos; inp.bit = bit;
        len = slotToLength(inp, RD.decode(inp));
        pos = inp.pos; bit = inp.bit;
        this.lastLen = len;
      }
      // Copy `len` bytes from `dist` back; distances before the stream start give zeros (unrar: !FirstWinDone).
      if (dist > abs || dist > W) {
        for (let k = 0; k < len; k++) { win[ptr++] = 0; if (ptr === W) ptr = 0; }
      } else {
        let src = ptr - dist;
        if (src < 0) src += W;
        if (small) src |= 0; // distances come from Float64 arrays: keep the copy loop on small integers
        if (src + len <= W && ptr + len <= W) {
          if (len <= 32) for (let k = 0; k < len; k++) win[ptr + k] = win[src + k];
          else if (dist >= len) win.copyWithin(ptr, src, src + len);
          else for (let p = ptr, n = len; n > 0;) { const k = Math.min(p - src, n); win.copyWithin(p, src, src + k); p += k; n -= k; } // runs: the copied period doubles
          ptr += len;
          if (ptr === W) ptr = 0;
        } else {
          for (let k = 0; k < len; k++) {
            win[ptr++] = win[src++];
            if (ptr === W) ptr = 0;
            if (src === W) src = 0;
          }
        }
      }
      abs += len;
    }
    this.ptr = ptr;
    this.abs = abs;
    inp.pos = pos;
    inp.bit = bit;
  }

  readFilter() {
    const inp = this.inp;
    if (inp.pos > inp.border) inp.refill();
    const start = filterData(inp);
    let length = filterData(inp);
    if (length > UNPACK50_FILTER_MAX) length = 0;
    const type = inp.bits(3);
    const channels = type === 0 ? inp.bits(5) + 1 : 0;
    if (this.filters.length >= MAX_FILTERS) this.filters.length = 0; // damaged data: unrar drops them too
    this.filters.push({ start: this.abs + start, length, type, channels });
  }

  applyFilter(f, data, fileOffset) {
    switch (f.type) {
      case 1: case 2: e8e9(data, fileOffset, f.type === 2); return data;
      case 3: arm(data, fileOffset); return data;
      case 0: {
        if (this.dst.length < data.length) this.dst = new Uint8Array(Math.max(data.length, 2 * this.dst.length));
        const dst = this.dst.subarray(0, data.length);
        delta(data, f.channels, dst);
        return dst;
      }
      default: return unsupported('RAR 5 filter type ' + f.type);
    }
  }
}

// Length slots: 0-7 are lengths 2-9 directly; above, a slot encodes 2 mantissa bits plus an exponent, and lb extra
// bits refine within the range, the usual logarithmic slot scheme (as Deflate / LZMA distances).
function slotToLength(inp, slot) {
  if (slot < 8) return 2 + slot;
  const lb = (slot >> 2) - 1;
  return 2 + ((4 | (slot & 3)) << lb) + inp.bits(lb);
}

// Up to 34 bits (RAR 7 distances reach 2^40).
// Above 32 bits the value is assembled with multiplication, not shifts: JS bitwise operators truncate to 32 bits,
// while doubles represent integers exactly up to 2^53.
function bigBits(inp, n) {
  if (n <= 16) return inp.bits(n);
  if (n <= 32) {
    const v = inp.getbits32() >>> (32 - n);
    inp.addbits(n);
    return v;
  }
  const hi = inp.bits(n - 32), lo = inp.getbits32();
  inp.addbits(32);
  return hi * 4294967296 + lo;
}

function filterData(inp) {
  const n = inp.bits(2) + 1;
  let v = 0;
  for (let i = 0; i < n; i++) v += inp.bits(8) * POW2[8 * i];
  return v;
}

// --- filters (inverse transforms; also used by the RAR 3 standard filters) -----------------------------------

/** x86 CALL (E8) / JMP (E9) targets back from absolute to relative. `mod24`: RAR 5 takes the offset modulo 2^24. */
// Why the filter exists: relative call targets differ at every call site, absolute ones repeat (same function called
// from many places), so the compressor converted rel -> abs to create LZ matches. Only addresses that were in range
// [-offset, FILE_SIZE) at compression time were converted, so the inverse must apply the same two range tests (the
// sign-bit tricks below) or it would corrupt operands that merely look like E8 targets. After a match, 4 bytes are
// skipped: an operand byte is never itself an opcode candidate.
export function e8e9(d, fileOffset, e9, mod24 = true) {
  const FILE_SIZE = 0x1000000, n = d.length;
  for (let pos = 0; pos + 4 < n;) {
    const b = d[pos++];
    if (b === 0xe8 || (e9 && b === 0xe9)) {
      const offset = mod24 ? (pos + fileOffset) % FILE_SIZE : (pos + fileOffset) % 4294967296;
      const addr = (d[pos] | (d[pos + 1] << 8) | (d[pos + 2] << 16) | (d[pos + 3] << 24)) >>> 0;
      let v = 0, put = false;
      if (addr & 0x80000000) { if (((addr + offset) & 0x80000000) === 0) { v = addr + FILE_SIZE; put = true; } } // addr < 0 <= addr + offset
      else if ((addr - FILE_SIZE) & 0x80000000) { v = addr - offset; put = true; } // 0 <= addr < FILE_SIZE
      if (put) {
        d[pos] = v; d[pos + 1] = v >>> 8; d[pos + 2] = v >>> 16; d[pos + 3] = v >>> 24;
      }
      pos += 4;
    }
  }
}

/** ARM BL instructions (condition "always"): absolute -> relative 24-bit word offsets. */
// Same idea for ARM: byte 3 == 0xEB is BL with condition AL; the 24-bit operand counts 4-byte words.
export function arm(d, fileOffset) {
  for (let pos = 0; pos + 3 < d.length; pos += 4) {
    if (d[pos + 3] === 0xeb) {
      const o = (d[pos] | (d[pos + 1] << 8) | (d[pos + 2] << 16)) - Math.floor(((fileOffset + pos) % 4294967296) / 4);
      d[pos] = o; d[pos + 1] = o >> 8; d[pos + 2] = o >> 16;
    }
  }
}

/** Bytes of each channel stored as a run of differences -> interleaved bytes. */
export function delta(src, channels, dst) {
  const n = src.length;
  let s = 0;
  for (let c = 0; c < channels; c++) {
    let prev = 0;
    for (let p = c; p < n; p += channels) dst[p] = prev = (prev - src[s++]) & 0xff;
  }
}
