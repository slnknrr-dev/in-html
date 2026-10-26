// pack/lzma.js - LZMA encoder (range coder, literal / matched-literal coding, matches, the four repeat distances and
// short reps, lc = 3, lp = 0, pb = 2) with a hash-chain match finder and a greedy parser with one step of lazy
// evaluation; LZMA2 chunking (compressed chunks of at most 2 MiB / 64 KiB, stored chunks for data that does not
// shrink) and the .lzma (LZMA_Alone) file. xz-utils, 7-Zip and ../archive/lzma.js decode the output.
//
//   lzma2(data, { level = 6 }) -> Uint8Array       raw LZMA2 stream (xz, 7z method 21)
//   lzma2DictProp(dictSize) -> the LZMA2 dictionary property byte
//   lzmaAlone(data, { level = 6 }) -> Uint8Array   .lzma file (13-byte header, known size, no end marker)
//   lzmaLevel(level) -> { dict, depth, nice }      the presets

import { Matcher, matchLen } from './lz.js';

// DESIGN. Fixed lc/lp/pb = 3/0/2 (props byte 0x5d), the xz-utils and 7-Zip default: tuned for general data and
// the only combination every decoder is tested against. The parser is greedy with one-step lazy matching and
// xz-style rep preference heuristics, not the optimal (price-based) parser of xz's "normal" mode: about 3-8 %
// larger output for a fraction of the code. The range coder and probability model below follow the LZMA spec
// bit for bit; any deviation in a context index desynchronises the decoder silently, so these are the parts to
// read against the reference decoder (../archive/lzma.js).
const LC = 3, LP = 0, PB = 2;
const PROPS = (PB * 5 + LP) * 9 + LC; // 0x5d
const MAX_LEN = 273;

// Presets roughly following xz -0..-9: dictionary, chain depth and 'nice' length grow together; lazy evaluation
// from level 2. The dictionary never needs to exceed the input (LzmaEncoder shrinks it).
export function lzmaLevel(level = 6) {
  const l = Math.max(0, Math.min(9, Math.round(level)));
  const dict = [1 << 18, 1 << 20, 1 << 21, 1 << 22, 1 << 22, 1 << 23, 1 << 23, 1 << 24, 1 << 25, 1 << 26][l];
  const depth = [4, 8, 12, 16, 24, 32, 48, 64, 96, 128][l];
  const nice = [16, 24, 32, 48, 64, 96, 128, 192, 273, 273][l];
  return { dict, depth, nice, lazy: l >= 2 };
}

// LZMA range encoder. 'low' is kept as a JS number up to 2^32 + 2^32 (not an int32) so the carry out of bit 32 is
// visible; 'cache' + 'cacheSize' hold the last byte and the count of pending 0xff bytes that a later carry may
// still turn into 0x00 (with +1 on the cached byte). cacheSize starts at 1, so the first output byte is always a
// 0 - the format's leading zero byte that every LZMA decoder skips.
class RangeEncoder {
  constructor(cap = 1 << 16) { this.buf = new Uint8Array(cap); this.pos = 0; this.low = 0; this.range = 0xffffffff; this.cache = 0; this.cacheSize = 1; }
  byte(b) { if (this.pos >= this.buf.length) { const n = new Uint8Array(this.buf.length * 2); n.set(this.buf); this.buf = n; } this.buf[this.pos++] = b; }
  shiftLow() {
    if (this.low < 0xff000000 || this.low >= 0x100000000) {
      const carry = this.low >= 0x100000000 ? 1 : 0;
      let temp = this.cache;
      do { this.byte((temp + carry) & 0xff); temp = 0xff; } while (--this.cacheSize !== 0);
      this.cache = Math.floor(this.low / 0x1000000) & 0xff;
    }
    this.cacheSize++;
    this.low = (this.low % 0x1000000) * 256;
  }
  // Adaptive binary coding with 11-bit probabilities (of a 0), adaptation shift 5: the exact model of the spec.
  bit(p, i, b) {
    const prob = p[i];
    const bound = (this.range >>> 11) * prob;
    if (!b) { this.range = bound; p[i] = prob + ((2048 - prob) >> 5); } else { this.low += bound; this.range = (this.range - bound) >>> 0; p[i] = prob - (prob >> 5); }
    while (this.range < 0x1000000) { this.range = (this.range << 8) >>> 0; this.shiftLow(); }
  }
  // Fixed-probability (1/2) bits for the middle bits of large distances: they are close to uniform, so modelling
  // them would only cost memory.
  direct(v, n) {
    for (let k = n - 1; k >= 0; k--) {
      this.range >>>= 1;
      if ((v >>> k) & 1) this.low += this.range;
      while (this.range < 0x1000000) { this.range = (this.range << 8) >>> 0; this.shiftLow(); }
    }
  }
  // Bit trees: MSB first (tree) or LSB first (reverse); the node index m walks a binary tree rooted at 1, giving
  // each prefix its own probability.
  tree(p, base, n, v) { let m = 1; for (let k = n - 1; k >= 0; k--) { const b = (v >>> k) & 1; this.bit(p, base + m, b); m = (m << 1) | b; } }
  reverse(p, base, n, v) { let m = 1; for (let k = 0; k < n; k++) { const b = v & 1; this.bit(p, base + m, b); m = (m << 1) | b; v >>>= 1; } }
  // Five shiftLow calls push out the cache and all four bytes of 'low'; the decoder needs them to resolve the
  // last symbols.
  flush() { for (let i = 0; i < 5; i++) this.shiftLow(); return this.buf.subarray(0, this.pos); }
  // Bytes this coder will have written once flushed (an upper bound).
  get size() { return this.pos + this.cacheSize + 5; }
}

const probs = (n) => new Uint16Array(n).fill(1024);

// Lengths 2..273 as len - 2: choice bit -> low (0-7, per posState) | mid (8-15, per posState) | high (16-271, 8-bit
// tree). Layout of p: [choice, choice2, low 16x8, mid 16x8, high 256] - indices must match the decoder.
class LenCoder {
  constructor() { this.p = probs(2 + 16 * 8 * 2 + 256); }
  encode(rc, l, posState) {
    const p = this.p;
    if (l < 8) { rc.bit(p, 0, 0); rc.tree(p, 2 + posState * 8, 3, l); }
    else if (l < 16) { rc.bit(p, 0, 1); rc.bit(p, 1, 0); rc.tree(p, 2 + 128 + posState * 8, 3, l - 8); }
    else { rc.bit(p, 0, 1); rc.bit(p, 1, 1); rc.tree(p, 2 + 256, 8, l - 16); }
  }
}

// Distance slot: 2 * floor(log2 d) + the next bit below the top one; slots 0-3 are the distances themselves.
const posSlotOf = (d) => { if (d < 4) return d; const n = 31 - Math.clz32(d); return (n << 1) | ((d >>> (n - 1)) & 1); };

/** Encoder state that LZMA2 chunks share (window = the input itself). */
// The window is the input array itself (the whole input is in memory), so no circular dictionary buffer is needed;
// distances are just i - j.
class LzmaEncoder {
  constructor(data, level) {
    this.d = data;
    this.cfg = lzmaLevel(level);
    // Advertise a dictionary no larger than needed (>= 4 KiB, the LZMA minimum in practice): decoders allocate it
    // up front, and a 64 MiB header for a 10 kB file would make small archives expensive to open.
    if (this.cfg.dict > data.length) this.cfg.dict = Math.max(1 << 12, 2 ** Math.ceil(Math.log2(Math.max(1, data.length))));
    this.mf = new Matcher(data, { window: this.cfg.dict, depth: this.cfg.depth, nice: this.cfg.nice });
    this.resetState();
  }
  // Fresh probabilities and state; LZMA2 needs this whenever a chunk resets the state (after stored chunks).
  // 12 states x 16 posStates for isMatch / isRep0Long; 0x300 literal probabilities per (lc, lp) context.
  resetState() {
    this.state = 0;
    this.reps = [0, 0, 0, 0];
    this.isMatch = probs(12 << 4); this.isRep = probs(12); this.isRepG0 = probs(12); this.isRepG1 = probs(12); this.isRepG2 = probs(12);
    this.isRep0Long = probs(12 << 4);
    this.lit = probs(0x300 << (LC + LP));
    this.posSlot = probs(4 * 64);
    this.posSpecial = probs(1 + 114 + 16);
    this.align = probs(16);
    this.len = new LenCoder();
    this.repLen = new LenCoder();
  }
  // Literal context: the high lc bits of the previous byte. After a match (state >= 7) the "matched literal" mode
  // also conditions on the byte at rep0: while the bits agree, it uses a separate probability set (offs), which
  // pays because the literal right after a match often differs from the match continuation in only a few bits.
  literal(rc, i) {
    const d = this.d;
    const prev = i > 0 ? d[i - 1] : 0;
    const base = 0x300 * (((i & ((1 << LP) - 1)) << LC) + (prev >> (8 - LC)));
    rc.bit(this.isMatch, (this.state << 4) | (i & 3), 0);
    let sym = d[i] | 0x100;
    if (this.state >= 7) {
      let match = d[i - this.reps[0] - 1], offs = 0x100;
      do {
        match <<= 1;
        rc.bit(this.lit, base + offs + (match & offs) + (sym >> 8), (sym >> 7) & 1);
        sym <<= 1;
        offs &= ~(match ^ sym);
      } while (sym < 0x10000);
    } else {
      do { rc.bit(this.lit, base + (sym >> 8), (sym >> 7) & 1); sym <<= 1; } while (sym < 0x10000);
    }
    // State machine transitions (spec table): states 0-6 follow literals, 7-11 follow match/rep/shortrep.
    this.state = this.state < 4 ? 0 : this.state < 10 ? this.state - 3 : this.state - 6;
  }
  match(rc, i, len, dist) {
    // dist: the real distance (>= 1)
    const ps = i & 3, s = this.state;
    rc.bit(this.isMatch, (s << 4) | ps, 1);
    rc.bit(this.isRep, s, 0);
    this.len.encode(rc, len - 2, ps);
    const d = dist - 1;
    const slot = posSlotOf(d);
    // Slot probabilities depend on the length (2, 3, 4, 5+): short matches favour short distances.
    rc.tree(this.posSlot, Math.min(len - 2, 3) * 64, 6, slot);
    if (slot >= 4) {
      const footer = (slot >>> 1) - 1;
      const base = (2 | (slot & 1)) << footer;
      const red = d - base;
      // Slots < 14: all footer bits modelled (reverse tree in posSpecial, base - slot is the spec's offset);
      // larger: direct bits, then the low 4 bits through the shared 'align' tree.
      if (slot < 14) rc.reverse(this.posSpecial, base - slot, footer, red);
      else { rc.direct(red >>> 4, footer - 4); rc.reverse(this.align, 0, 4, red & 15); }
    }
    const r = this.reps;
    r[3] = r[2]; r[2] = r[1]; r[1] = r[0]; r[0] = d;
    this.state = s < 7 ? 7 : 10;
  }
  // Repeat distances: rep0 with length 1 is a "short rep" (one byte from rep0); other reps move the used distance
  // to the front of the list, keeping the others in order.
  rep(rc, i, len, idx) {
    const ps = i & 3, s = this.state, r = this.reps;
    rc.bit(this.isMatch, (s << 4) | ps, 1);
    rc.bit(this.isRep, s, 1);
    if (idx === 0) {
      rc.bit(this.isRepG0, s, 0);
      rc.bit(this.isRep0Long, (s << 4) | ps, len === 1 ? 0 : 1);
      if (len === 1) { this.state = s < 7 ? 9 : 11; return; }
    } else {
      rc.bit(this.isRepG0, s, 1);
      const dd = r[idx];
      if (idx === 1) rc.bit(this.isRepG1, s, 0);
      else { rc.bit(this.isRepG1, s, 1); rc.bit(this.isRepG2, s, idx - 2); if (idx === 3) r[3] = r[2]; r[2] = r[1]; }
      if (idx >= 1) { r[1] = r[0]; r[0] = dd; }
    }
    this.repLen.encode(rc, len - 2, ps);
    this.state = s < 7 ? 8 : 11;
  }
  // The next symbol at i: [kind, len, arg]; kind 0 literal, 1 match (arg distance), 2 rep (arg index), 3 short rep.
  // Heuristics (from xz's fast parser): a rep match is nearly free to code, so it wins unless the new match is
  // clearly longer, with the required advantage growing with the new distance; 3-byte matches far away cost more
  // than three literals and are dropped. Lazy step: if position i + 1 has a longer match, emit a literal now.
  choose(i) {
    const d = this.d, n = d.length;
    const left = n - i;
    if (left < 2) return this.shortRepOk(i) ? [3, 1, 0] : [0, 1, 0];
    const maxLen = Math.min(MAX_LEN, left);
    let repLen = 0, repIdx = 0;
    for (let k = 0; k < 4; k++) {
      const l = matchLen(d, i, this.reps[k] + 1, maxLen);
      if (l > repLen) { repLen = l; repIdx = k; }
    }
    if (repLen >= this.cfg.nice) return [2, repLen, repIdx];
    let mainLen = this.mf.find(i, maxLen, 3), mainDist = this.mf.dist;
    if (mainLen >= this.cfg.nice) return [1, mainLen, mainDist];
    if (repLen >= 2 && (repLen + 1 >= mainLen || (repLen + 2 >= mainLen && mainDist >= 512) || (repLen + 3 >= mainLen && mainDist >= 32768))) return [2, repLen, repIdx];
    if (mainLen === 3 && mainDist >= 1 << 14) mainLen = 0;
    if (mainLen < 3) return this.shortRepOk(i) ? [3, 1, 0] : [0, 1, 0];
    if (this.cfg.lazy && left > mainLen + 1) {
      const next = this.mf.find(i + 1, maxLen, 3), nd = this.mf.dist;
      if (next > mainLen + 1 || (next === mainLen + 1 && nd <= mainDist * 2)) return this.shortRepOk(i) ? [3, 1, 0] : [0, 1, 0];
    }
    return [1, mainLen, mainDist];
  }
  // Short rep (1 byte at rep0) costs fewer bits than a literal when it applies.
  shortRepOk(i) { const j = i - this.reps[0] - 1; return j >= 0 && this.d[j] === this.d[i] && i > 0; }
  emit(rc, i, c) {
    switch (c[0]) {
      case 0: this.literal(rc, i); break;
      case 1: this.match(rc, i, c[1], c[2]); break;
      case 2: this.rep(rc, i, c[1], c[2]); break;
      default: this.rep(rc, i, 1, 0);
    }
  }
}

// LZMA2 dictionary byte p encodes (2 | (p & 1)) << (p / 2 + 11); returns the smallest p whose size covers dict.
// 40 means 4 GiB - 1.
export function lzma2DictProp(dict) {
  for (let p = 0; p < 40; p++) if ((2 | (p & 1)) * 2 ** ((p >> 1) + 11) >= dict) return p;
  return 40;
}

// LZMA2 container: a sequence of chunks, control byte first. Compressed chunks: 0x80 | reset << 5 | (usize - 1) >> 16,
// then usize - 1 (16 bits), csize - 1 (16 bits), props when reset >= 2. Reset levels: 0 none, 1 state, 2 state +
// props, 3 everything + dictionary. Stored chunks: 1 (dictionary reset) or 2, then size - 1 (16 bits). End: 0.
// Limits: usize <= 2 MiB, csize <= 64 KiB; the loop guard keeps a margin of MAX_LEN (one more symbol) and 40 bytes
// of range-coder growth so neither limit can be crossed.
export function lzma2(data, { level = 6 } = {}) {
  const enc = new LzmaEncoder(data, level);
  const out = [];
  let total = 0;
  const push = (b) => { out.push(b); total += b.length; };
  const n = data.length;
  let pos = 0, first = true, propsSent = false, needReset = false;
  while (pos < n) {
    const rc = new RangeEncoder();
    const start = pos;
    // State snapshot is unnecessary: a chunk stored uncompressed is followed by a state reset.
    while (pos < n && pos - start + MAX_LEN <= 1 << 21 && rc.size + 40 <= 1 << 16) {
      const c = enc.choose(pos);
      enc.emit(rc, pos, c);
      pos += c[1];
    }
    const packed = rc.flush();
    const usize = pos - start;
    // Incompressible chunk: store it. Because the LZMA state advanced while encoding it, the next LZMA chunk must
    // reset state (needReset) so encoder and decoder agree again; the dictionary keeps the stored bytes.
    if (packed.length >= usize || packed.length > 1 << 16) {
      // Stored chunks (dictionary reset for the very first one); the next LZMA chunk resets the state.
      for (let o = start; o < pos; o += 1 << 16) {
        const e = Math.min(pos, o + (1 << 16));
        push(Uint8Array.of(first ? 1 : 2, (e - o - 1) >> 8, (e - o - 1) & 255));
        push(data.subarray(o, e));
        first = false;
      }
      enc.resetState();
      needReset = true;
      continue;
    }
    const reset = first ? 3 : !propsSent ? 2 : needReset ? 1 : 0;
    const u = usize - 1, p = packed.length - 1;
    const head = [0x80 | (reset << 5) | (u >>> 16), (u >> 8) & 255, u & 255, p >> 8, p & 255];
    if (reset >= 2) head.push(PROPS);
    push(Uint8Array.from(head));
    push(packed.slice());
    first = false; propsSent = true; needReset = false;
  }
  push(Uint8Array.of(0));
  const res = new Uint8Array(total);
  let o = 0;
  for (const b of out) { res.set(b, o); o += b.length; }
  // Side channel for the containers (xz, 7z) that must declare the dictionary in their own headers.
  res.dictSize = enc.cfg.dict;
  return res;
}

// .lzma (LZMA_Alone): props byte, dictionary size (LE32), uncompressed size (LE64), raw LZMA stream. A known size
// means no end marker is written; decoders stop after exactly that many bytes. Sizes are split with % / floor
// because >> would truncate to 32 bits.
export function lzmaAlone(data, { level = 6 } = {}) {
  const enc = new LzmaEncoder(data, level);
  const rc = new RangeEncoder(Math.max(1 << 16, data.length >> 1));
  for (let i = 0; i < data.length;) { const c = enc.choose(i); enc.emit(rc, i, c); i += c[1]; }
  const body = rc.flush();
  const out = new Uint8Array(13 + body.length);
  out[0] = PROPS;
  const dict = enc.cfg.dict;
  out[1] = dict; out[2] = dict >>> 8; out[3] = dict >>> 16; out[4] = dict >>> 24;
  let s = data.length;
  for (let k = 0; k < 8; k++) { out[5 + k] = s % 256; s = Math.floor(s / 256); }
  out.set(body, 13);
  return out;
}
