// archive/lzma.js - LZMA and LZMA2 decoders (the formats of the LZMA SDK: 7z, xz, ZIP method 14, .lzma) over a
// dictionary that grows up to the dictionary size (or the known output size) and then works as a ring buffer.
//
//   lzmaStream(reader, props, { size }) -> Stream        props: the 5-byte properties (lc/lp/pb byte + dictionary);
//                                                           size: exact output length, or undefined (end marker)
//   lzma2Stream(reader, dictProp, { size }) -> Stream    dictProp: the LZMA2 dictionary byte (7z / xz property)
//   lzmaAloneStream(reader) -> Stream                    .lzma files: 13-byte header (props + 64-bit size)
//   lzmaProps(bytes) -> { lc, lp, pb, dictSize }, lzma2DictSize(prop)
// `reader` is an io.js Reader. Corrupt input throws ArchiveError 'corrupt' / 'truncated'.
//
// Model (LZMA SDK LzmaDec.c is the reference; there is no formal spec beyond it and the xz docs):
// - Adaptive binary range coder: every decision bit has an 11-bit probability (of a 0) that moves 1/32 of the way to
//   the observed value after each bit. All probabilities start at 1024 = 0.5.
// - A 12-state machine remembers the kinds of the last few packets (literal / match / rep / short rep); it selects the
//   probability sets, because "what came before" predicts "what comes next" much better than global statistics.
// - Packets: LIT (one byte, coded bit by bit with context from the previous byte and position), MATCH (length +
//   distance), REP0-3 (length + one of the last four distances), SHORTREP (one byte at rep0).
// - The window is the dictionary: matches copy from earlier output, so decoding needs no separate dictionary buffer.
// Numbers: range and code are kept as Numbers in 0..2^32-1 and updated with * 256 rather than << 8, which avoids the
// int32 sign trap without sprinkling >>> 0 through the hottest code in the library.

import { corrupt, fail, le32 } from './io.js';

// Distance coding: a 6-bit "slot" (tree coded, one tree per length class 2, 3, 4, 5+) gives the top two bits and the
// bit count; slots 0-3 are the distance itself, slots 4-13 add reverse-tree coded footer bits (posDec), slots 14-63
// add direct (probability-free) bits and 4 reverse-tree coded low "align" bits. FULL_DISTANCES = 128 is the first
// distance of slot 14.
const STATES = 12, POS_BITS_MAX = 4, LEN_TO_POS = 4, END_POS_MODEL = 14, FULL_DISTANCES = 128, ALIGN_BITS = 4;
// Length decoder layout in one array: choice, choice2, low[16][8], mid[16][8], high[256].
const LEN_LOW = 2, LEN_MID = 130, LEN_HIGH = 258, LEN_SIZE = 514;
// Normalisation threshold 2^24: when range drops below it, one input byte is shifted in, keeping 24..32 bits of
// precision for the next probability split.
const TOP = 16777216;

// Properties byte = (pb * 5 + lp) * 9 + lc: lc literal context bits (0-8), lp literal position bits (0-4), pb position
// bits (0-4). 9 * 5 * 5 = 225 combinations, hence >= 225 is corrupt.
export function lzmaProps(p) {
  let d = p[0];
  if (d >= 225) corrupt('LZMA properties');
  const lc = d % 9; d = (d / 9) | 0;
  return { lc, lp: d % 5, pb: (d / 5) | 0, dictSize: le32(p, 1) };
}

// LZMA2 dictionary byte: sizes 2^n and 3 * 2^(n-1) from 4 KiB (prop 0) upward; 40 means 4 GiB - 1.
export function lzma2DictSize(prop) {
  if (prop > 40) corrupt('LZMA2 dictionary size');
  return prop === 40 ? 0xffffffff : (2 | (prop & 1)) * 2 ** ((prop >> 1) + 11);
}

/** The LZMA decoder state: probabilities, range coder and the window (shared by LZMA and LZMA2). */
export class LzmaDecoder {
  constructor(dictSize, outSize) {
    // 4 KiB floor: the LZMA SDK's minimum (LZMA_DIC_MIN); encoders never use less, and it keeps tiny-dictionary
    // headers from producing a window too small for the distances they code.
    this.dictSize = Math.max(4096, dictSize);
    // The window never has to hold more than the dictionary or the whole output.
    this.bufMax = outSize != null && outSize < this.dictSize ? Math.max(1, outSize) : this.dictSize;
    // 0x7FE00000 (2 GiB - 2 MiB): about the largest ArrayBuffer engines allocate reliably. The window starts at 1 MiB
    // and doubles on demand (room()), so a 1.5 GiB dictionary header does not allocate 1.5 GiB for a 10 kB file.
    if (this.bufMax > 0x7fe00000) fail('limit', 'LZMA dictionary too large for this browser: ' + this.dictSize + ' bytes');
    this.buf = new Uint8Array(Math.min(this.bufMax, 1 << 20));
    this.pos = 0; this.hist = 0; this.total = 0;
    this.lc = 0; this.lp = 0; this.pb = 0; this.lit = null;
    // Probability arrays: Uint16Array (values 0..2048 fit), laid out exactly as in LzmaDec.c so indices can be checked
    // against the reference. isMatch / isRep0Long are per (state, posState); the rep choices per state.
    this.isMatch = new Uint16Array(STATES << POS_BITS_MAX);
    this.isRep = new Uint16Array(STATES); this.isRepG0 = new Uint16Array(STATES);
    this.isRepG1 = new Uint16Array(STATES); this.isRepG2 = new Uint16Array(STATES);
    this.isRep0Long = new Uint16Array(STATES << POS_BITS_MAX);
    this.posSlot = new Uint16Array(LEN_TO_POS << 6);
    this.posDec = new Uint16Array(1 + FULL_DISTANCES - END_POS_MODEL);
    this.align = new Uint16Array(1 << ALIGN_BITS);
    this.lenDec = new Uint16Array(LEN_SIZE); this.repLenDec = new Uint16Array(LEN_SIZE);
    this.state = 0; this.rep0 = 0; this.rep1 = 0; this.rep2 = 0; this.rep3 = 0;
    this.remain = 0; // bytes of a match still to copy (output limit reached)
    this.range = 0; this.code = 0; this.in = null; this.over = 0;
    this.left = Infinity; // bytes still to decode in the current stream / chunk
    this.eos = false; // end marker seen
  }

  // Literal coder: 0x300 probabilities per context (256 for the plain tree + 2 * 256 for the matched-literal trees),
  // 2^(lc + lp) contexts. lc = 8, lp = 4 would be 3 M entries: LZMA2 caps lc + lp at 4 for exactly this reason.
  setProps(lc, lp, pb) {
    const n = 0x300 << (lc + lp);
    if (!this.lit || this.lit.length !== n) this.lit = new Uint16Array(n);
    this.lc = lc; this.lp = lp; this.pb = pb;
  }

  resetState() {
    for (const a of [this.lit, this.isMatch, this.isRep, this.isRepG0, this.isRepG1, this.isRepG2, this.isRep0Long,
      this.posSlot, this.posDec, this.align, this.lenDec, this.repLenDec]) a.fill(1024);
    this.state = 0; this.rep0 = this.rep1 = this.rep2 = this.rep3 = 0;
    this.remain = 0;
  }

  resetDict() { this.hist = 0; this.total = 0; this.remain = 0; }

  // The encoder's first output byte is always 0 (its initial cache byte), then 4 bytes of code. code must be < range
  // (0xFFFFFFFF) for the arithmetic to make sense, so code === 0xFFFFFFFF is corrupt.
  initRange(input) {
    this.in = input;
    if (input.byte() !== 0) corrupt('LZMA range coder');
    let c = 0;
    for (let i = 0; i < 4; i++) { const b = input.byte(); if (b < 0) fail('truncated', 'unexpected end of LZMA data'); c = c * 256 + b; }
    this.range = 0xffffffff;
    this.code = c;
    if (c === 0xffffffff) corrupt('LZMA range coder');
  }

  // Past the end of input: feed zeros and count them, then fail once at the end of decode(). Checking in bit() would
  // add a branch to every decoded bit; a truncated stream is rare and only needs to be reported, not avoided.
  next() { const b = this.in.byte(); if (b >= 0) return b; this.over++; return 0; }

  // One adaptive bit: split range at bound = (range / 2048) * P(0). (range >>> 11) * prob < 2^21 * 2^11 = 2^32, exact
  // as a Number. Adaptation by >> 5 (rate 1/32) is the trade-off of the SDK: faster learning, slightly noisier estimate.
  bit(p, i) {
    const prob = p[i];
    const bound = (this.range >>> 11) * prob;
    let b;
    if (this.code < bound) { this.range = bound; p[i] = prob + ((2048 - prob) >> 5); b = 0; }
    else { this.range -= bound; this.code -= bound; p[i] = prob - (prob >> 5); b = 1; }
    if (this.range < TOP) { this.range *= 256; this.code = this.code * 256 + this.next(); }
    return b;
  }

  // Bit tree of n levels, MSB first: node index m starts at 1 and doubles plus the bit, so the 2^n - 1 internal nodes
  // are p[base + 1 .. base + 2^n - 1] and the result is m minus the leading 1.
  tree(p, base, n) {
    let m = 1;
    for (let i = 0; i < n; i++) m = (m << 1) | this.bit(p, base + m);
    return m - (1 << n);
  }

  // Same tree walk, but the bits form the value LSB first (used for distance footers and align bits, whose low bits
  // are the noisy ones and benefit from being coded first).
  revTree(p, base, n) {
    let m = 1, sym = 0;
    for (let i = 0; i < n; i++) { const b = this.bit(p, base + m); m = (m << 1) | b; sym |= b << i; }
    return sym;
  }

  // Direct bits: probability fixed at 0.5 (range halved), for the high-entropy middle bits of long distances where
  // modelling gains nothing. Math.floor rather than >> 1: range may be >= 2^31.
  direct(n) {
    let res = 0;
    for (let i = 0; i < n; i++) {
      this.range = Math.floor(this.range / 2);
      if (this.code >= this.range) { this.code -= this.range; res = res * 2 + 1; } else res *= 2;
      if (this.range < TOP) { this.range *= 256; this.code = this.code * 256 + this.next(); }
    }
    return res;
  }

  // Match length minus 2 (so 0..271 -> lengths 2..273): choice bit -> 8 low lengths (per posState), choice2 -> 8 mid
  // lengths (per posState), else 256 high lengths (shared). Short lengths are both most frequent and most position
  // dependent, so they get the per-posState trees.
  len(p, posState) {
    if (!this.bit(p, 0)) return this.tree(p, LEN_LOW + (posState << 3), 3);
    if (!this.bit(p, 1)) return 8 + this.tree(p, LEN_MID + (posState << 3), 3);
    return 16 + this.tree(p, LEN_HIGH, 8);
  }

  /** Grows the window, or wraps it when the end is reached (called before decoding into it). */
  room() {
    if (this.pos < this.buf.length) return;
    if (this.buf.length < this.bufMax) {
      const nb = new Uint8Array(Math.min(this.bufMax, this.buf.length * 2));
      nb.set(this.buf);
      this.buf = nb;
    } else this.pos = 0;
  }

  // LZ77 copy of n bytes from `dist` back. copyWithin has memmove semantics (it copies as if through a temporary), so
  // it is only correct when source and destination do not overlap (dist >= n) and the source does not wrap; an
  // overlapping copy (dist < n, e.g. dist 1 = run of one byte) must replicate bytes as they are written, byte by byte.
  copy(dist, n) {
    const buf = this.buf, size = buf.length;
    let pos = this.pos, src = pos - dist;
    if (src < 0) src += size;
    this.total += n;
    if (src + n <= size && dist >= n) { buf.copyWithin(pos, src, src + n); pos += n; }
    else for (let k = 0; k < n; k++) { buf[pos++] = buf[src++]; if (src === size) src = 0; }
    this.pos = pos;
    this.hist = Math.min(this.bufMax, this.hist + n);
  }

  /** Decodes into the window up to buffer position `limit` (or `left` bytes, or the end marker). */
  decode(limit) {
    // Finish a match that the previous call had to cut at its output limit (remain bytes at the same distance rep0).
    if (this.remain > 0) {
      const n = Math.min(this.remain, limit - this.pos, this.left);
      this.copy(this.rep0 + 1, n);
      this.remain -= n; this.left -= n;
    }
    const pbMask = (1 << this.pb) - 1, lpMask = (1 << this.lp) - 1, lc = this.lc;
    const lit = this.lit, isMatch = this.isMatch, buf = this.buf, size = buf.length;
    while (this.pos < limit && this.left > 0 && !this.eos) {
      // Position contexts use the total output position (not the window position, which wraps).
      const posState = this.total & pbMask;
      let state = this.state;
      if (!this.bit(isMatch, (state << POS_BITS_MAX) + posState)) {
        const prev = this.hist ? buf[this.pos > 0 ? this.pos - 1 : size - 1] : 0;
        // Literal context: lp low bits of the position and lc high bits of the previous byte.
        const base = 0x300 * (((this.total & lpMask) << lc) + (prev >> (8 - lc)));
        let sym = 1;
        // Matched literal: right after a match (state >= 7) the byte at rep0 is a strong predictor (the match probably
        // ended because of a single differing byte). Its bits select one of two extra trees until the first bit that
        // differs; from there on the plain tree is used.
        if (state >= 7) {
          let src = this.pos - this.rep0 - 1;
          if (src < 0) src += size;
          let match = buf[src];
          do {
            const mb = (match >> 7) & 1;
            match <<= 1;
            const b = this.bit(lit, base + ((1 + mb) << 8) + sym);
            sym = (sym << 1) | b;
            if (mb !== b) break;
          } while (sym < 0x100);
        }
        while (sym < 0x100) sym = (sym << 1) | this.bit(lit, base + sym);
        buf[this.pos++] = sym & 255;
        this.total++; this.left--;
        if (this.hist < this.bufMax) this.hist++;
        // State update after a literal (LzmaDec UpdateState_Literal): states 0-6 mean "last packet was a literal".
        this.state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
        continue;
      }
      let len;
      if (this.bit(this.isRep, state)) {
        if (!this.hist) corrupt('LZMA repeated match at the start');
        if (!this.bit(this.isRepG0, state)) {
          // SHORTREP: one byte from distance rep0, no length coded.
          if (!this.bit(this.isRep0Long, (state << POS_BITS_MAX) + posState)) {
            this.state = state < 7 ? 9 : 11;
            let src = this.pos - this.rep0 - 1;
            if (src < 0) src += size;
            buf[this.pos++] = buf[src];
            this.total++; this.left--;
            if (this.hist < this.bufMax) this.hist++;
            continue;
          }
        } else {
          // REP1-3: the chosen distance moves to the front of the 4-entry recent-distance list (an MTF of distances).
          let dist;
          if (!this.bit(this.isRepG1, state)) dist = this.rep1;
          else {
            if (!this.bit(this.isRepG2, state)) dist = this.rep2;
            else { dist = this.rep3; this.rep3 = this.rep2; }
            this.rep2 = this.rep1;
          }
          this.rep1 = this.rep0;
          this.rep0 = dist;
        }
        len = this.len(this.repLenDec, posState);
        this.state = state < 7 ? 8 : 11;
      } else {
        this.rep3 = this.rep2; this.rep2 = this.rep1; this.rep1 = this.rep0;
        len = this.len(this.lenDec, posState);
        this.state = state < 7 ? 7 : 10;
        const slot = this.tree(this.posSlot, (len < LEN_TO_POS ? len : LEN_TO_POS - 1) << 6, 6);
        let dist;
        if (slot < 4) dist = slot;
        else {
          const nd = (slot >> 1) - 1;
          // >>> 0: for slot 62/63, 3 << 30 sets bit 31 and would go negative.
          dist = ((2 | (slot & 1)) << nd) >>> 0;
          if (slot < END_POS_MODEL) dist += this.revTree(this.posDec, dist - slot, nd);
          else dist += this.direct(nd - ALIGN_BITS) * 16 + this.revTree(this.align, 0, ALIGN_BITS);
        }
        // Distance 0xFFFFFFFF is the end-of-stream marker (used when the size is unknown, optional otherwise).
        if (dist === 0xffffffff) { this.eos = true; break; }
        this.rep0 = dist;
      }
      // A distance reaching before the start of output (or beyond the window) can only come from corrupt data; checking
      // here keeps copy() from reading stale or zeroed window bytes silently.
      if (this.rep0 >= this.hist) corrupt('LZMA distance');
      len += 2;
      const n = Math.min(len, limit - this.pos, this.left);
      this.copy(this.rep0 + 1, n);
      this.left -= n;
      this.remain = this.left > 0 ? len - n : 0;
    }
    if (this.over) fail('truncated', 'unexpected end of LZMA data');
  }
}

/** LZMA (7z method 03 01 01, ZIP method 14 after its 4-byte header) with the 5 property bytes. */
export function lzmaStream(reader, props, { size } = {}) {
  const p = lzmaProps(props);
  const d = new LzmaDecoder(p.dictSize, size);
  d.setProps(p.lc, p.lp, p.pb);
  d.resetState();
  let started = false, done = false;
  d.left = size == null ? Infinity : size;
  return {
    size,
    read(max = 1 << 20) {
      if (done) return null;
      if (!started) { started = true; if (d.left === 0) { done = true; return null; } d.initRange(reader); }
      d.room();
      const start = d.pos;
      d.decode(Math.min(d.buf.length, start + Math.max(1, max)));
      if (d.pos === start) {
        done = true;
        if (d.left > 0 && size != null) fail('truncated', 'LZMA data ended early (end marker before the end)');
        return null;
      }
      return d.buf.subarray(start, d.pos);
    },
  };
}

/** .lzma (LZMA_Alone): props(5) + uncompressed size (8 bytes LE, all ones = unknown, end marker) + data. */
export function lzmaAloneStream(reader) {
  const head = reader.bytes(13, 'LZMA header');
  let unknown = true;
  for (let i = 5; i < 13; i++) if (head[i] !== 255) unknown = false;
  const size = unknown ? undefined : le32(head, 5) + le32(head, 9) * 4294967296;
  return lzmaStream(reader, head.subarray(0, 5), { size });
}

/** LZMA2 (7z method 21, xz filter 0x21): chunks of uncompressed or LZMA data with dictionary / state resets. */
// LZMA2 = LZMA in chunks with a 1-byte control code each (xz-file-format and LzmaDec/Lzma2Dec.c):
//   0x00            end of data
//   0x01 / 0x02     uncompressed chunk (with / without dictionary reset), then be16 size - 1
//   0x80-0xFF       LZMA chunk: bits 0-4 = bits 16-20 of (unpacked size - 1), then be16 low bits, be16 packed size - 1;
//                   bits 5-6 = reset level: 0 none, 1 state, 2 state + new props byte, 3 everything + dictionary
// Chunking lets an encoder store incompressible data raw and lets multithreaded encoders reset at chunk boundaries.
// Every LZMA chunk restarts the range coder (5 bytes), hence the exact packed-size check at its end.
export function lzma2Stream(reader, dictProp, { size } = {}) {
  const d = new LzmaDecoder(lzma2DictSize(dictProp), size);
  let mode = 0, done = false, produced = 0; // mode 0: chunk header, 1: uncompressed chunk, 2: LZMA chunk
  let packEnd = 0, havePropsState = false, first = true;
  const header = () => {
    const c = reader.byte();
    if (c < 0) fail('truncated', 'unexpected end of LZMA2 data');
    if (c === 0) { done = true; return; }
    if (c === 1 || c === 2) {
      if (c === 1) d.resetDict(); else if (first) corrupt('LZMA2 missing dictionary reset');
      d.left = ((reader.u8() << 8) | reader.u8()) + 1;
      mode = 1;
      first = false;
      return;
    }
    if (c < 0x80) corrupt('LZMA2 chunk type');
    const unpack = ((c & 0x1f) << 16) + (reader.u8() << 8) + reader.u8() + 1;
    const pack = (reader.u8() << 8) + reader.u8() + 1;
    const reset = (c >> 5) & 3;
    if (reset === 3) d.resetDict(); else if (first) corrupt('LZMA2 missing dictionary reset');
    if (reset >= 2) {
      const p = reader.u8();
      if (p > 224) corrupt('LZMA2 properties');
      const lc = p % 9, rest = (p / 9) | 0, lp = rest % 5, pb = (rest / 5) | 0;
      // LZMA2-specific limit (keeps the literal table at most 0x300 << 4 entries).
      if (lc + lp > 4) corrupt('LZMA2 properties');
      d.setProps(lc, lp, pb);
      havePropsState = false;
    } else if (!d.lit) corrupt('LZMA2 missing properties');
    if (reset >= 1) { d.resetState(); havePropsState = true; } else if (!havePropsState) corrupt('LZMA2 missing state reset');
    d.remain = 0; d.eos = false;
    d.left = unpack;
    const at = reader.pos;
    d.initRange(reader);
    packEnd = at + pack;
    mode = 2;
    first = false;
  };
  return {
    size,
    read(max = 1 << 20) {
      while (!done) {
        if (mode === 0) { header(); continue; }
        d.room();
        const start = d.pos;
        const limit = Math.min(d.buf.length, start + Math.max(1, max));
        if (mode === 1) {
          while (d.pos < limit && d.left > 0) {
            const c = reader.chunk(Math.min(limit - d.pos, d.left));
            if (!c) fail('truncated', 'unexpected end of LZMA2 data');
            d.buf.set(c, d.pos);
            d.pos += c.length; d.left -= c.length; d.total += c.length;
            d.hist = Math.min(d.bufMax, d.hist + c.length);
          }
        } else d.decode(limit);
        if (d.left === 0 || d.eos) {
          if (mode === 2) {
            if (d.eos || d.remain) corrupt('LZMA2 chunk');
            if (reader.pos !== packEnd) corrupt('LZMA2 packed size');
          }
          mode = 0;
        }
        if (d.pos > start) { produced += d.pos - start; return d.buf.subarray(start, d.pos); }
      }
      if (size != null && produced !== size) corrupt('LZMA2 size (' + produced + ' of ' + size + ' bytes)');
      return null;
    },
  };
}
