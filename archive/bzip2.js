// archive/bzip2.js - bzip2 decoder (Julian Seward's format: Huffman + MTF + RLE2, inverse Burrows-Wheeler transform,
// RLE1), block and stream CRCs checked, concatenated streams (pbzip2) decoded one after another.
//
//   bzip2Stream(reader, { size, multi = true }) -> Stream    reader: io.js Reader at "BZh1".."BZh9"
//   (7z method 04 02 02 and ZIP method 12 hold the same streams.)
//
// Format summary (there is no official spec; the reference is libbzip2 1.0.x, decompress.c). All fields are packed
// MSB-first, with no byte alignment except at the very end of a stream:
//   stream = 'BZh' level('1'..'9', block size level * 100 000) block* end
//   block  = 48-bit magic 0x314159265359 (BCD pi), CRC32 (32), randomised (1), origPtr (24), symbol map (16 + 16*k),
//            nGroups (3), nSelectors (15), selectors (MTF + unary), code lengths (delta coded), Huffman data
//   end    = 48-bit magic 0x177245385090 (BCD sqrt(pi)), combined stream CRC (32), padding to a byte
// Decoding undoes, in reverse order of the encoder: Huffman -> RLE2 (RUNA/RUNB zero-run coding) -> MTF -> inverse BWT
// -> RLE1 (runs of 4..255 equal bytes). Block CRCs are computed over the final output (after RLE1).

import { corrupt, fail } from './io.js';

// bzip2's CRC-32 is the NON-reflected form of the IEEE polynomial (0x04C11DB7, MSB-first, as in CRC-32/BZIP2), not
// the reflected 0xEDB88320 of gzip / ZIP, so codec/crc32.js cannot be reused. Built lazily: modules that never decode
// bzip2 pay nothing. Int32Array: the values are used with signed shifts and XOR; only the final ~crc >>> 0 matters.
let CRC = null;
function crcTable() {
  if (CRC) return CRC;
  CRC = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 24;
    for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
    CRC[i] = c;
  }
  return CRC;
}

// 2..6 coding tables, one selector per 50 symbols, code lengths 1..20 (libbzip2 limits). FAST = 10-bit lookup: covers
// the vast majority of symbols with one table access (1024 entries per table, rebuilt per block) while staying cache
// friendly; longer codes fall back to the canonical limit[] walk.
const MAX_GROUPS = 6, GROUP = 50, MAX_LEN = 20, FAST = 10;

// MSB-first bit reader: new bytes enter at the bottom of bb, bits leave from the top. bc never exceeds 31 (refill
// stops at >= n with n <= 24, adding 8 at a time), so the 32-bit buffer cannot overflow. `pad` counts the zero bytes
// fed in beyond the real end by peek20(): looking ahead 20 bits at the tail of the stream is legal as long as the
// symbol finally consumed does not use them, which skip() checks.
class BitIn {
  constructor(r) { this.r = r; this.bb = 0; this.bc = 0; }
  bits(n) {
    while (this.bc < n) {
      const c = this.r.byte();
      if (c < 0) fail('truncated', 'unexpected end of bzip2 data');
      this.bb = ((this.bb << 8) | c) >>> 0;
      this.bc += 8;
    }
    this.bc -= n;
    return (this.bb >>> this.bc) & ((1 << n) - 1);
  }
  bit() { return this.bits(1); }
  // Up to 20 bits ahead without consuming (missing input reads as zeros; decode() checks the real count).
  peek20() {
    while (this.bc < MAX_LEN) {
      let c = this.r.byte();
      if (c < 0) { c = 0; this.pad = (this.pad || 0) + 8; }
      this.bb = ((this.bb << 8) | c) >>> 0;
      this.bc += 8;
    }
    return (this.bb >>> (this.bc - MAX_LEN)) & 0xfffff;
  }
  skip(n) { this.bc -= n; if (this.pad && this.bc < this.pad) fail('truncated', 'unexpected end of bzip2 data'); }
  align() { this.bc -= this.bc & 7; }
}

// Canonical Huffman decoder of one coding table (MSB-first codes, lengths 1..20). Same scheme as libbzip2's
// hbCreateDecodeTables: perm = symbols sorted by (length, symbol value); for each length l the codes are consecutive,
// so a code c of length l is valid iff c <= limit[l], and its symbol is perm[base[l] + c]. Lengths that oversubscribe
// the code space are not rejected; they make some codes unreachable but every index stays inside perm.
function makeTable(lens, n) {
  let minLen = 32, maxLen = 0;
  for (let i = 0; i < n; i++) { if (lens[i] > maxLen) maxLen = lens[i]; if (lens[i] < minLen) minLen = lens[i]; }
  const perm = new Uint16Array(n), limit = new Int32Array(MAX_LEN + 2), base = new Int32Array(MAX_LEN + 2);
  let pp = 0;
  for (let l = minLen; l <= maxLen; l++) for (let s = 0; s < n; s++) if (lens[s] === l) perm[pp++] = s;
  const count = new Int32Array(MAX_LEN + 2);
  for (let i = 0; i < n; i++) count[lens[i]]++;
  // limit[l]: the largest code of length l (left-aligned at l bits); base[l]: index offset into perm.
  let code = 0, idx = 0;
  for (let l = 1; l <= MAX_LEN; l++) {
    base[l] = idx - code;
    code += count[l];
    idx += count[l];
    limit[l] = code - 1;
    code <<= 1;
  }
  // Fast table for codes up to FAST bits: (symbol << 5) | length, 0 = longer code. 0 is unambiguous because every real
  // entry has length >= 1 in its low 5 bits. Filled by brute force (1024 x up to 10 lengths): cheap next to a block of
  // up to 900 000 symbols.
  const fast = new Int32Array(1 << FAST);
  for (let v = 0; v < 1 << FAST; v++) {
    for (let l = minLen; l <= Math.min(maxLen, FAST); l++) {
      const c = v >> (FAST - l);
      if (c <= limit[l]) { fast[v] = (perm[base[l] + c] << 5) | l; break; }
    }
  }
  return { fast, limit, base, perm, minLen, maxLen };
}

// General-path symbol decoder (not used by the hot loop in block(), which inlines the same logic on local variables).
function decodeSym(bits, t) {
  const v = bits.peek20();
  const f = t.fast[v >>> (MAX_LEN - FAST)];
  if (f) { bits.skip(f & 31); return f >> 5; }
  for (let l = Math.max(t.minLen, FAST + 1); l <= t.maxLen; l++) {
    const c = v >>> (MAX_LEN - l);
    if (c <= t.limit[l]) { bits.skip(l); return t.perm[t.base[l] + c]; }
  }
  corrupt('bzip2 Huffman code');
}

export function bzip2Stream(reader, { size, multi = true } = {}) {
  const bits = new BitIn(reader);
  const T = crcTable();
  let level = 0, tt = null, streamCrc = 0, done = false;
  // Current block: inverse-BWT walk state and the RLE1 state.
  let left = 0, tPos = 0, blockCrc = 0, wantCrc = 0, last = -1, run = 0, rep = 0, repByte = 0, total = 0;
  let out = new Uint8Array(1 << 16);

  const header = () => {
    if (bits.bits(8) !== 0x42 || bits.bits(8) !== 0x5a || bits.bits(8) !== 0x68) corrupt('bzip2 signature');
    const l = bits.bits(8) - 0x30;
    if (l < 1 || l > 9) corrupt('bzip2 block size');
    level = l;
    // tt is reused across blocks and concatenated streams; it only grows. One Int32 per byte of the block: the low
    // 8 bits hold the byte, the high 24 bits the inverse-BWT link (900 000 < 2^24).
    if (!tt || tt.length < level * 100000) tt = new Int32Array(level * 100000);
    streamCrc = 0;
  };

  // Reads the next block into tt; false at the end of the stream(s).
  const block = () => {
    for (;;) {
      const m1 = bits.bits(24), m2 = bits.bits(24);
      if (m1 === 0x177245 && m2 === 0x385090) {
        // Two 16-bit reads combined arithmetically: a 32-bit value would not fit the bit buffer's (bb >>> bc) & mask.
        const c = bits.bits(16) * 65536 + bits.bits(16);
        if (c !== streamCrc >>> 0) fail('checksum', 'bzip2 stream CRC mismatch');
        bits.align();
        if (!multi) return false;
        // Another stream may follow (pbzip2 and concatenated files); anything else after the end is ignored.
        // Peek one byte without consuming it, from wherever it currently lives: still in the bit buffer (take 8 bits
        // and give them back with bc += 8), a partial non-byte remainder (impossible after align(): treat as end), or the
        // reader (pull it into the buffer so header() can read it again). Pad bytes are not real input.
        const pad = bits.pad || 0;
        let b;
        if (bits.bc - pad >= 8) { b = bits.bits(8); bits.bc += 8; } else if (bits.bc > 0) b = -1;
        else { b = reader.byte(); if (b >= 0) { bits.bb = ((bits.bb << 8) | b) >>> 0; bits.bc += 8; } }
        if (b !== 0x42) return false;
        header();
        continue;
      }
      if (m1 !== 0x314159 || m2 !== 0x265359) corrupt('bzip2 block signature');
      break;
    }
    wantCrc = bits.bits(16) * 65536 + bits.bits(16);
    // Randomisation XORed the block with a fixed table to defeat the slow sorter of early bzip2 on repetitive input;
    // no encoder since 0.9.5 sets it, so the 512-entry rNums table is not worth carrying.
    if (bits.bit()) fail('unsupported', 'not supported: randomised bzip2 blocks (bzip2 0.9.0 and older)');
    const origPtr = bits.bits(24);
    // Symbol map: 16 groups of 16 byte values; a 16-bit mask says which groups follow. Only bytes present in the block
    // get MTF symbols, which shrinks the alphabet: alpha = used bytes + RUNA/RUNB (2) - MTF index 0 (1) + EOB (1).
    const used = bits.bits(16);
    const seqToUnseq = new Uint8Array(256);
    let nInUse = 0;
    for (let i = 0; i < 16; i++) {
      if (!(used & (0x8000 >> i))) continue;
      const g = bits.bits(16);
      for (let j = 0; j < 16; j++) if (g & (0x8000 >> j)) seqToUnseq[nInUse++] = i * 16 + j;
    }
    if (!nInUse) corrupt('bzip2 symbol map');
    const alpha = nInUse + 2;
    const nGroups = bits.bits(3);
    if (nGroups < 2 || nGroups > MAX_GROUPS) corrupt('bzip2 table count');
    const nSel = bits.bits(15);
    if (!nSel) corrupt('bzip2 selectors');
    // Selectors (which table codes each group of 50 symbols) are MTF-transformed, then unary coded (j one-bits and a
    // zero). nSel is not capped at 18002 as libbzip2 1.0.8 does; a larger count only costs a bigger array here and
    // the per-group check below (sel >= nSel) still bounds the decode.
    const mtfSel = [0, 1, 2, 3, 4, 5].slice(0, nGroups);
    const selectors = new Uint8Array(nSel);
    for (let i = 0; i < nSel; i++) {
      let j = 0;
      while (bits.bit()) { j++; if (j >= nGroups) corrupt('bzip2 selector'); }
      const v = mtfSel[j];
      mtfSel.splice(j, 1);
      mtfSel.unshift(v);
      selectors[i] = v;
    }
    const tables = [];
    const lens = new Uint8Array(alpha);
    for (let g = 0; g < nGroups; g++) {
      // Code lengths: a 5-bit start value, then per symbol a delta code: '0' = keep, '10' = +1, '11' = -1.
      let cur = bits.bits(5);
      for (let s = 0; s < alpha; s++) {
        for (;;) {
          if (cur < 1 || cur > MAX_LEN) corrupt('bzip2 code length');
          if (!bits.bit()) break;
          cur += bits.bit() ? -1 : 1;
        }
        lens[s] = cur;
      }
      tables.push(makeTable(lens, alpha));
    }
    // MTF / RLE2 decoding into tt (low byte = value), counting byte frequencies.
    const counts = new Int32Array(256);
    const mtf = new Uint8Array(256);
    for (let i = 0; i < 256; i++) mtf[i] = i;
    // runLen / runBit: RLE2 decodes runs of MTF index 0 in bijective base 2, least significant digit first:
    // RUNA (0) adds 1 * runBit, RUNB (1) adds 2 * runBit, runBit doubles per digit. So A=1, B=2, AA=3, BA=4, AB=5 ...
    const eob = nInUse + 1, max = level * 100000;
    let n = 0, sel = 0, gLeft = 0, t = null, runLen = 0, runBit = 1;
    // The hot loop keeps the bit buffer in locals (the fast table covers most codes).
    let bb = bits.bb, bc = bits.bc, pad = bits.pad || 0, fast = null;
    for (;;) {
      if (!gLeft) {
        if (sel >= nSel) corrupt('bzip2 selector overflow');
        t = tables[selectors[sel++]];
        fast = t.fast;
        gLeft = GROUP;
      }
      gLeft--;
      while (bc < MAX_LEN) {
        let c = reader.byte();
        if (c < 0) { c = 0; pad += 8; }
        bb = ((bb << 8) | c) >>> 0;
        bc += 8;
      }
      const v20 = (bb >>> (bc - MAX_LEN)) & 0xfffff;
      let s;
      const f = fast[v20 >>> (MAX_LEN - FAST)];
      if (f) { bc -= f & 31; s = f >> 5; }
      else {
        s = -1;
        for (let l = Math.max(t.minLen, FAST + 1); l <= t.maxLen; l++) {
          const c = v20 >>> (MAX_LEN - l);
          if (c <= t.limit[l]) { bc -= l; s = t.perm[t.base[l] + c]; break; }
        }
        if (s < 0) corrupt('bzip2 Huffman code');
      }
      // The symbol consumed bits that were zero padding: the stream really ended mid-block.
      if (bc < pad) fail('truncated', 'unexpected end of bzip2 data');
      if (s <= 1) { runLen += runBit << s; runBit <<= 1; if (runLen > max) corrupt('bzip2 run'); continue; }
      if (runLen) {
        if (n + runLen > max) corrupt('bzip2 block overflow');
        const v = seqToUnseq[mtf[0]];
        counts[v] += runLen;
        tt.fill(v, n, n + runLen);
        n += runLen;
        runLen = 0; runBit = 1;
      }
      if (s === eob) break;
      if (n >= max) corrupt('bzip2 block overflow');
      // Symbol s >= 2 means MTF index s - 1. Move-to-front by hand for small k (typical: MTF output is dominated by
      // small indices), copyWithin for long moves where the call overhead pays off.
      const k = s - 1;
      const v = mtf[k];
      if (k < 16) { for (let j = k; j > 0; j--) mtf[j] = mtf[j - 1]; } else mtf.copyWithin(1, 0, k);
      mtf[0] = v;
      const b = seqToUnseq[v];
      counts[b]++;
      tt[n++] = b;
    }
    bits.bb = bb; bits.bc = bc; bits.pad = pad;
    if (origPtr >= n) corrupt('bzip2 origin pointer');
    // Inverse BWT: tt[i] high 24 bits = the index of the next byte in the original order.
    // cf[b] = number of bytes smaller than b (cumulative frequencies); scanning the last column L in order and
    // placing i at cf[L[i]]++ builds the LF-mapping inverse in one pass. Starting at origPtr (the row of the original
    // string in the sorted matrix) and following the links yields the block forwards. This "T vector" walk is the
    // fast method of libbzip2; its cost is a random memory access per output byte (cache misses dominate).
    const cf = new Int32Array(256);
    for (let i = 0, s = 0; i < 256; i++) { cf[i] = s; s += counts[i]; }
    for (let i = 0; i < n; i++) { const b = tt[i] & 255; tt[cf[b]++] |= i << 8; }
    tPos = tt[origPtr] >>> 8;
    left = n;
    blockCrc = -1;
    last = -1; run = 0; rep = 0;
    return true;
  };

  let started = false, inBlock = false;
  return {
    size,
    read(max = 1 << 20) {
      if (done) return null;
      if (!started) { started = true; header(); }
      if (out.length < max) out = new Uint8Array(max);
      let o = 0;
      while (o < max) {
        if (rep > 0) {
          const n = Math.min(rep, max - o);
          out.fill(repByte, o, o + n);
          for (let i = 0; i < n; i++) blockCrc = (blockCrc << 8) ^ T[((blockCrc >>> 24) ^ repByte) & 255];
          o += n; rep -= n;
          continue;
        }
        if (!inBlock || left === 0) {
          if (inBlock) {
            const c = ~blockCrc >>> 0;
            if (c !== wantCrc) fail('checksum', 'bzip2 block CRC mismatch');
            // Stream CRC = rotate-left-by-1 of the running value, XOR the block CRC (libbzip2's combinedCRC).
            streamCrc = (((streamCrc << 1) | (streamCrc >>> 31)) ^ c) >>> 0;
            inBlock = false;
          }
          if (!block()) {
            done = true;
            if (size != null && total + o !== size) corrupt('bzip2 size');
            break;
          }
          inBlock = true;
          continue;
        }
        // Walk the BWT chain, undoing RLE1 (four equal bytes are followed by a repeat count 0..255). After the count
        // `run` restarts at 0, so a fifth equal byte begins a new run instead of triggering another count.
        // The CRC update is the MSB-first table step: crc = (crc << 8) ^ T[(crc >>> 24) ^ byte].
        while (left > 0 && o < max) {
          const e = tt[tPos];
          const b = e & 255;
          tPos = e >>> 8;
          left--;
          if (run === 4) {
            run = 0;
            if (b) { rep = b; repByte = last; break; }
            continue;
          }
          if (b === last) run++; else { run = 1; last = b; }
          out[o++] = b;
          blockCrc = (blockCrc << 8) ^ T[((blockCrc >>> 24) ^ b) & 255];
        }
      }
      total += o;
      return o ? out.subarray(0, o) : null;
    },
  };
}
