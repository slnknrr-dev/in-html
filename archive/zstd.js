// archive/zstd.js - Zstandard decoder (RFC 8878): frames (window or single segment, content size, XXH64 content
// checksum), skippable frames, concatenated frames; raw, RLE and compressed blocks; literals raw / RLE / Huffman
// (1 or 4 streams, FSE-compressed or direct weights, treeless reuse); sequences with predefined, RLE, FSE and
// repeated tables and the repeat-offset history. Dictionaries are not supported (frames that need one are refused).
//
//   zstdStream(reader, { size }) -> Stream      reader: io.js Reader at a frame (magic 28 B5 2F FD)
//   zstdFrameInfo(bytes) -> { contentSize, windowSize, checksum, dictionary } | null   (first frame header)
//   xxh64(bytes, seed = 0) -> [lo, hi]
//
// Key decisions:
// - One output buffer per frame that holds the window plus room for a block; before each block, room() slides the
//   last `win` bytes to the front. Matches then copy inside one flat array (no ring-buffer index wrapping in the
//   hot loop); the cost is an occasional memmove of `win` bytes, amortised over many blocks.
// - Block-at-a-time: a block (<= 128 KiB) is decoded whole and returned as one view; read(max) ignores `max`
//   (callers such as limitStream handle longer chunks). Splitting a block mid-sequence would need resumable state.
// - 64-bit XXH64 arithmetic on [lo, hi] pairs of uint32: BigInt is far too slow per byte, and only the low 32 bits of
//   the digest are compared (that is all a frame stores).
// - Two bit-stream directions, as in the RFC: FSE table descriptions are read forwards (LSB first), entropy-coded
//   payloads (Huffman literals, sequences) backwards from a 1-bit end marker in the last byte.

import { corrupt, fail } from './io.js';

// BLOCK_MAX = Block_Maximum_Size (128 KiB). The RFC caps it further at the window size; that tighter limit is not
// enforced here (lenient: a too-large block in a small-window frame is decoded instead of refused).
const MAGIC = 0xfd2fb528, BLOCK_MAX = 1 << 17;

// --- XXH64 on 32-bit halves --------------------------------------------------------------------------------

// XXH64 primes as [lo, hi]: PRIME64_1 = 0x9E3779B185EBCA87 etc. (xxHash spec).
const P1 = [0x85ebca87, 0x9e3779b1], P2 = [0x27d4eb4f, 0xc2b2ae3d], P3 = [0x9e3779f9, 0x165667b1], P4 = [0xc2b2ae63, 0x85ebca77], P5 = [0x165667c5, 0x27d4eb2f];
// [lo, hi] arithmetic modulo 2^64.
const add = (a, b) => { const lo = a[0] + b[0]; return [lo >>> 0, (a[1] + b[1] + (lo > 0xffffffff ? 1 : 0)) >>> 0]; };
// 64 x 64 -> low 64 bits. The low halves are multiplied exactly in 16-bit limbs (every partial product < 2^33, exact
// in a double); the cross terms aH * bL and aL * bH only reach the high word, where Math.imul's low 32 bits suffice.
function mul(a, b) {
  const a0 = a[0] & 0xffff, a1 = a[0] >>> 16, b0 = b[0] & 0xffff, b1 = b[0] >>> 16;
  const mid = a0 * b1 + a1 * b0;
  const low = a0 * b0 + (mid % 65536) * 65536;
  const hi = a1 * b1 + Math.floor(mid / 65536) + Math.floor(low / 4294967296);
  return [low >>> 0, (hi + Math.imul(a[1], b[0]) + Math.imul(a[0], b[1])) >>> 0];
}
const rotl = (a, r) => (r < 32 ? [((a[0] << r) | (a[1] >>> (32 - r))) >>> 0, ((a[1] << r) | (a[0] >>> (32 - r))) >>> 0] : [((a[1] << (r - 32)) | (a[0] >>> (64 - r))) >>> 0, ((a[0] << (r - 32)) | (a[1] >>> (64 - r))) >>> 0]);
const xor = (a, b) => [(a[0] ^ b[0]) >>> 0, (a[1] ^ b[1]) >>> 0];
const shr = (a, r) => (r >= 32 ? [a[1] >>> (r - 32), 0] : [((a[0] >>> r) | (a[1] << (32 - r))) >>> 0, a[1] >>> r]);
const neg = (a) => add([~a[0] >>> 0, ~a[1] >>> 0], [1, 0]);
const u64 = (b, o) => [(b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0, (b[o + 4] | (b[o + 5] << 8) | (b[o + 6] << 16) | (b[o + 7] << 24)) >>> 0];
const round = (acc, x) => mul(rotl(add(acc, mul(x, P2)), 31), P1);
const merge = (acc, v) => add(mul(xor(acc, round([0, 0], v)), P1), P4);

// The stripe loop without allocations: products land in RL / RH. Same arithmetic as mul(); `mid & 0xffff` stays
// correct although mid can exceed 2^32 because ToInt32 (mod 2^32) preserves the low 16 bits.
let RL = 0, RH = 0;
function mulR(aL, aH, bL, bH) {
  const a0 = aL & 0xffff, a1 = aL >>> 16, b0 = bL & 0xffff, b1 = bL >>> 16;
  const mid = a0 * b1 + a1 * b0;
  const low = a0 * b0 + (mid & 0xffff) * 65536;
  RL = low >>> 0;
  RH = (a1 * b1 + ((mid / 65536) | 0) + ((low / 4294967296) | 0) + Math.imul(aH, bL) + Math.imul(aL, bH)) >>> 0;
}

/** Streaming XXH64: update(bytes), digest() -> [lo, hi]. */
export class XXH64 {
  constructor(seed = 0) {
    const s = [seed >>> 0, 0];
    this.v = new Uint32Array([add(add(s, P1), P2), add(s, P2), s, add(s, neg(P1))].flat());
    this.seed = s;
    this.buf = new Uint8Array(32);
    this.n = 0;
    this.total = 0;
  }

  update(b) {
    this.total += b.length;
    let i = 0;
    if (this.n) {
      const take = Math.min(32 - this.n, b.length);
      this.buf.set(b.subarray(0, take), this.n);
      this.n += take; i = take;
      if (this.n < 32) return this;
      this.stripe(this.buf, 0);
      this.n = 0;
    }
    for (; i + 32 <= b.length; i += 32) this.stripe(b, i);
    if (i < b.length) { this.buf.set(b.subarray(i), 0); this.n = b.length - i; }
    return this;
  }

  // One 32-byte stripe: four lanes of round(v, x) = rotl(v + x * PRIME2, 31) * PRIME1, inlined (rotl 31 written out
  // as the lo/hi swap with 31 / 1 bit shifts) to avoid allocating arrays per 8 bytes.
  stripe(b, o) {
    const v = this.v;
    for (let k = 0; k < 8; k += 2, o += 8) {
      mulR((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0, (b[o + 4] | (b[o + 5] << 8) | (b[o + 6] << 16) | (b[o + 7] << 24)) >>> 0, P2[0], P2[1]);
      const lo = v[k] + RL;
      const hi = (v[k + 1] + RH + (lo > 0xffffffff ? 1 : 0)) >>> 0;
      const l = lo >>> 0;
      mulR(((l << 31) | (hi >>> 1)) >>> 0, ((hi << 31) | (l >>> 1)) >>> 0, P1[0], P1[1]);
      v[k] = RL; v[k + 1] = RH;
    }
  }

  // Finalisation per the xxHash spec: merge the 4 lanes (or seed + PRIME5 for inputs < 32 bytes), add the length, fold
  // the buffered tail 8 / 4 / 1 bytes at a time, then the avalanche (xor-shift 33, *P2, xor-shift 29, *P3, xor-shift 32).
  digest() {
    const v = [[this.v[0], this.v[1]], [this.v[2], this.v[3]], [this.v[4], this.v[5]], [this.v[6], this.v[7]]];
    let h;
    if (this.total >= 32) {
      h = add(add(rotl(v[0], 1), rotl(v[1], 7)), add(rotl(v[2], 12), rotl(v[3], 18)));
      for (const x of v) h = merge(h, x);
    } else h = add(this.seed, P5);
    h = add(h, [this.total >>> 0, Math.floor(this.total / 4294967296) >>> 0]);
    const b = this.buf, n = this.n;
    let i = 0;
    for (; i + 8 <= n; i += 8) h = add(mul(rotl(xor(h, round([0, 0], u64(b, i))), 27), P1), P4);
    if (i + 4 <= n) { h = add(mul(rotl(xor(h, mul([(b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0, 0], P1)), 23), P2), P3); i += 4; }
    for (; i < n; i++) h = mul(rotl(xor(h, mul([b[i], 0], P5)), 11), P1);
    h = mul(xor(h, shr(h, 33)), P2);
    h = mul(xor(h, shr(h, 29)), P3);
    return xor(h, shr(h, 32));
  }
}
export const xxh64 = (b, seed = 0) => new XXH64(seed).update(b).digest();

// --- bit streams ---------------------------------------------------------------------------------------------

// Backward bit stream of RFC 8878 (Huffman literals, sequences): starts at the highest set bit of the last byte.
// The encoder writes forwards and appends a 1 bit after the last value, so the decoder, reading backwards, can find
// the exact end in the final byte: a final byte of 0 has no marker and is corrupt. `p` is the bit index just below the
// unread part; values are read from p downwards, MSB of the value first.
class BackBits {
  constructor(d) {
    this.d = d;
    if (!d.length || !d[d.length - 1]) corrupt('zstd bit stream end marker');
    this.p = d.length * 8 - (Math.clz32(d[d.length - 1]) - 23); // bit position just below the marker
  }
  // n <= 24 bits ending at the current position (missing bits below the start read as zeros). A 32-bit little-endian
  // load at byte q >> 3 then a shift by q & 7 yields up to 25 valid bits, hence the 24-bit cap. For q < 0, d[-1] is
  // undefined -> 0 under |, and q & 7 still gives the right shift in two's complement.
  peek(n) {
    if (!n) return 0;
    const q = this.p - n, d = this.d, i = q >> 3;
    return ((d[i] | (d[i + 1] << 8) | (d[i + 2] << 16) | (d[i + 3] << 24)) >>> (q & 7)) & ((1 << n) - 1);
  }
  read(n) {
    if (n > 24) { const hi = this.read(n - 16); return hi * 65536 + this.read(16); }
    const v = this.peek(n);
    this.p -= n;
    return v;
  }
}

// FSE table description (forward, little-endian bits) -> normalized counts (RFC 8878 section 4.1.1).
// accuracy log = 4 bits + 5. Then per symbol a value coded with a variable bit count: the remaining probability mass
// bounds the largest possible value, so only enough bits for that bound are used, and the smaller half of the
// values save one bit (the low / max trick). Value - 1 is the count; -1 means "less than 1": the symbol gets one
// cell at the top of the table with a full-width state reset. After a zero count, 2-bit repeat flags code further
// zeros (3 = "three more and continue"). The description ends when the mass is exactly used up (remaining === 1).
function readCounts(b, at, maxLog, maxSym) {
  let bitPos = at * 8;
  const bits = (n) => { const i = bitPos >> 3; const v = ((b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> (bitPos & 7)) & ((1 << n) - 1); return v; };
  const log = bits(4) + 5;
  bitPos += 4;
  if (log > maxLog) corrupt('zstd FSE accuracy');
  let remaining = (1 << log) + 1, threshold = 1 << log, nb = log + 1, sym = 0;
  const counts = [];
  let prev0 = false;
  while (remaining > 1 && sym <= maxSym) {
    if (prev0) {
      let n = 0;
      for (;;) { const r = bits(2); bitPos += 2; n += r; if (r !== 3) break; }
      for (let k = 0; k < n; k++) counts[sym++] = 0;
      if (sym > maxSym) break;
    }
    const max = 2 * threshold - 1 - remaining;
    let c;
    const low = bits(nb - 1);
    if (low < max) { c = low; bitPos += nb - 1; }
    else { c = bits(nb); if (c >= threshold) c -= max; bitPos += nb; }
    c--;
    remaining -= c < 0 ? -c : c;
    counts[sym++] = c;
    prev0 = c === 0;
    while (remaining < threshold) { nb--; threshold >>= 1; }
  }
  if (remaining !== 1 || sym > maxSym + 1) corrupt('zstd FSE table');
  if (bitPos > b.length * 8) corrupt('zstd FSE table');
  return { counts, log, size: ((bitPos + 7) >> 3) - at };
}

// Decoding table: per state the symbol, the bits to read and the baseline of the next state.
// Spread: symbols are placed with the fixed step (size/2 + size/8 + 3), which is odd and therefore coprime with the
// power-of-2 size, so the walk visits every cell once; cells taken by "less than 1" symbols at the top are skipped.
// Ending anywhere but cell 0 means the counts did not sum to the table size. Then for symbol s with count c, its
// c states get x = c .. 2c - 1 in table order; nbits = log - floor(log2 x) and base = (x << nbits) - size, so that
// base + readBits(nbits) lands back in 0 .. size - 1 (the tANS state transition).
function buildTable(counts, log) {
  const size = 1 << log;
  const sym = new Uint8Array(size), nbits = new Uint8Array(size), base = new Int32Array(size);
  let high = size - 1;
  const next = new Int32Array(counts.length);
  for (let s = 0; s < counts.length; s++) {
    if (counts[s] === -1) { sym[high--] = s; next[s] = 1; } else next[s] = counts[s] || 0;
  }
  const step = (size >> 1) + (size >> 3) + 3, mask = size - 1;
  let pos = 0;
  for (let s = 0; s < counts.length; s++) {
    for (let i = 0; i < (counts[s] > 0 ? counts[s] : 0); i++) {
      sym[pos] = s;
      do pos = (pos + step) & mask; while (pos > high);
    }
  }
  if (pos !== 0) corrupt('zstd FSE spread');
  for (let u = 0; u < size; u++) {
    const s = sym[u];
    const x = next[s]++;
    const nb = log - (31 - Math.clz32(x));
    nbits[u] = nb;
    base[u] = (x << nb) - size;
  }
  return { sym, nbits, base, log };
}
const rleTable = (s) => ({ sym: Uint8Array.of(s), nbits: new Uint8Array(1), base: new Int32Array(1), log: 0 });

// Predefined distributions (RFC 8878 section 3.1.1.3.2.2): literal length (log 6), match length (log 6), offset
// (log 5). Used when a block selects mode 0, so small blocks need not transmit tables. Built once, lazily.
const LL_DEF = [4, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 2, 1, 1, 1, 1, 1, -1, -1, -1, -1];
const ML_DEF = [1, 4, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1, -1, -1];
const OF_DEF = [1, 1, 1, 1, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1];
let DEF = null;
const defaults = () => DEF || (DEF = { ll: buildTable(LL_DEF, 6), ml: buildTable(ML_DEF, 6), of: buildTable(OF_DEF, 5) });

// Code -> (baseline, extra bits) for literal and match lengths: small values are coded exactly, larger ones in
// geometrically growing buckets plus raw extra bits (the same idea as Deflate's length codes). Match lengths start at 3.
const LL_BASE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 40, 48, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536];
const LL_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const ML_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34,
  35, 37, 39, 41, 43, 47, 51, 59, 67, 83, 99, 131, 259, 515, 1027, 2051, 4099, 8195, 16387, 32771, 65539];
const ML_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  1, 1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

// --- Huffman literals ----------------------------------------------------------------------------------------

// Huffman tree description (RFC 8878 section 4.2.1): weights per symbol, weight w > 0 meaning code length
// maxBits + 1 - w. Header byte < 128: that many bytes of FSE-compressed weights; >= 128: (head - 127) weights as raw
// 4-bit nibbles. The last symbol's weight is implicit: the sum of 2^(w-1) must reach the next power of two, and the
// missing amount (which must itself be a power of two) gives it.
function readHuffman(b, at) {
  const head = b[at];
  let weights, used;
  if (head < 128) {
    // FSE-compressed weights: two interleaved states over one backward stream.
    const t = readCounts(b, at + 1, 6, 255);
    const table = buildTable(t.counts, t.log);
    const s = new BackBits(b.subarray(at + 1 + t.size, at + 1 + head));
    let s1 = s.read(t.log), s2 = s.read(t.log);
    weights = [];
    const step = (st) => { const v = table.sym[st]; return [v, table.base[st] + s.read(table.nbits[st])]; };
    for (;;) {
      if (weights.length > 254) corrupt('zstd Huffman weights');
      let r = step(s1); weights.push(r[0]); s1 = r[1];
      if (s.p < 0) { weights.push(table.sym[s2]); break; }
      if (weights.length > 254) corrupt('zstd Huffman weights');
      r = step(s2); weights.push(r[0]); s2 = r[1];
      if (s.p < 0) { weights.push(table.sym[s1]); break; }
    }
    used = 1 + head;
  } else {
    const n = head - 127;
    weights = [];
    for (let i = 0; i < n; i++) { const x = b[at + 1 + (i >> 1)]; weights.push(i & 1 ? x & 15 : x >> 4); }
    used = 1 + ((n + 1) >> 1);
  }
  let sum = 0;
  for (const w of weights) { if (w > 11) corrupt('zstd Huffman weight'); if (w) sum += 1 << (w - 1); }
  if (!sum) corrupt('zstd Huffman weights');
  const maxBits = 32 - Math.clz32(sum);
  const left = (1 << maxBits) - sum;
  if (left & (left - 1)) corrupt('zstd Huffman weights');
  weights.push(32 - Math.clz32(left));
  if (maxBits > 11) corrupt('zstd Huffman depth');
  // Table: index = the next maxBits bits; longer codes (smaller weights) take the low indices. Each symbol fills
  // 2^(w-1) consecutive cells (all suffixes of its code), so one peek + one lookup decodes any symbol: the depth limit
  // of 11 bits keeps the table at <= 2048 entries.
  const size = 1 << maxBits;
  const sym = new Uint8Array(size), nb = new Uint8Array(size);
  const rankStart = new Int32Array(maxBits + 2);
  const count = new Int32Array(maxBits + 2);
  for (const w of weights) count[w]++;
  for (let w = 1, u = 0; w <= maxBits; w++) { rankStart[w] = u; u += count[w] << (w - 1); }
  weights.forEach((w, s) => {
    if (!w) return;
    const len = 1 << (w - 1), start = rankStart[w];
    sym.fill(s, start, start + len); nb.fill(maxBits + 1 - w, start, start + len);
    rankStart[w] += len;
  });
  return { sym, nb, maxBits, used };
}

// Decodes exactly n symbols; the stream must then be consumed to the bit (p === 0), which catches most corruption
// without a checksum.
function huffStream(d, h, out, o, n) {
  const s = new BackBits(d), { sym, nb, maxBits } = h;
  for (let i = 0; i < n; i++) {
    const v = s.peek(maxBits);
    out[o + i] = sym[v];
    s.p -= nb[v];
  }
  if (s.p !== 0) corrupt('zstd Huffman stream');
}

// --- frames and blocks -----------------------------------------------------------------------------------------

/** Frame header facts of the first frame (for listings), or null. */
// Frame header: magic, descriptor byte (bits 6-7 content-size field code, bit 5 single segment, bit 4 unused,
// bit 3 reserved, bit 2 checksum flag, bits 0-1 dictionary id size), window descriptor (absent with single segment:
// then the window is the content size), dictionary id, content size (a 2-byte field stores size - 256).
export function zstdFrameInfo(b) {
  if (b.length < 6 || ((b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0) !== MAGIC) return null;
  const fhd = b[4], single = (fhd >> 5) & 1, fcsCode = fhd >> 6, dictCode = fhd & 3;
  let p = 5, windowSize = 0;
  if (!single) { const wd = b[p++]; const log = 10 + (wd >> 3); windowSize = 2 ** log + (2 ** log / 8) * (wd & 7); }
  const dictBytes = [0, 1, 2, 4][dictCode];
  let dictionary = 0;
  for (let i = 0; i < dictBytes; i++) dictionary += b[p + i] * 2 ** (8 * i);
  p += dictBytes;
  const fcsBytes = fcsCode === 0 ? (single ? 1 : 0) : [0, 2, 4, 8][fcsCode];
  let contentSize;
  if (fcsBytes) {
    contentSize = 0;
    for (let i = 0; i < fcsBytes; i++) contentSize += b[p + i] * 2 ** (8 * i);
    if (fcsBytes === 2) contentSize += 256;
    p += fcsBytes;
  }
  if (single) windowSize = contentSize;
  return { contentSize, windowSize, checksum: !!(fhd & 4), dictionary, headerSize: p };
}

export function zstdStream(reader, { size } = {}) {
  let state = 0; // 0: next frame, 1: blocks, 2: done
  let buf = null, pos = 0, win = 0, last = false, check = null, frameOut = 0, frame = null;
  // Per-frame entropy state that later blocks may reuse ("repeat" modes, treeless literals): repeat offsets start at
  // 1, 4, 8 (RFC), tables and the Huffman tree are reset at each frame start.
  let reps = [1, 4, 8], huff = null, tLL = null, tML = null, tOF = null, total = 0;
  const lits = new Uint8Array(BLOCK_MAX + 32);

  const startFrame = () => {
    for (;;) {
      const m = reader.byte();
      if (m < 0) return false;
      const hb = [m, reader.u8(), reader.u8(), reader.u8()];
      const magic = (hb[0] | (hb[1] << 8) | (hb[2] << 16) | (hb[3] << 24)) >>> 0;
      // Skippable frames (0x184D2A50..5F): user metadata, skipped by their le32 size. Data after a complete frame that
      // is not a frame ends the stream (as `zstd -d` stops at trailing garbage with a warning); at the start it is corrupt.
      if ((magic & 0xfffffff0) === 0x184d2a50) { const n = reader.u32('zstd skippable frame'); reader.skip(n, 'zstd skippable frame'); continue; }
      if (magic !== MAGIC) { if (total) return false; corrupt('zstd magic'); }
      const fhd = reader.u8();
      const single = (fhd >> 5) & 1, dictBytes = [0, 1, 2, 4][fhd & 3];
      const fcsBytes = (fhd >> 6) === 0 ? (single ? 1 : 0) : [0, 2, 4, 8][fhd >> 6];
      const head = [m, hb[1], hb[2], hb[3], fhd, ...reader.bytes((single ? 0 : 1) + dictBytes + fcsBytes, 'zstd frame header')];
      if (fhd & 8) corrupt('zstd frame header');
      frame = zstdFrameInfo(Uint8Array.from(head));
      if (frame.dictionary) fail('unsupported', 'not supported: Zstandard frames with a dictionary');
      win = frame.windowSize || frame.contentSize || BLOCK_MAX;
      // 1 GiB cap: memory protection against a hostile header (the reference decoder defaults to 128 MiB unless told
      // otherwise; a browser tab can afford more, but not an arbitrary 2^41).
      if (win > 1 << 30) fail('limit', 'Zstandard window too large: ' + win + ' bytes');
      // Buffer = window history + a margin of blocks, so compaction (room()) runs only every ~win bytes of output;
      // a known small content size caps it. Reallocated only when too small or wastefully large (> 4x).
      const cap = frame.contentSize != null ? Math.min(frame.contentSize, 2 * win + 4 * BLOCK_MAX) : 2 * win + 4 * BLOCK_MAX;
      const want = Math.max(cap + BLOCK_MAX, 1024);
      if (!buf || buf.length < want || buf.length > 4 * want) buf = new Uint8Array(want);
      pos = 0; last = false; frameOut = 0;
      reps = [1, 4, 8]; huff = null; tLL = tML = tOF = null;
      check = frame.checksum ? new XXH64() : null;
      return true;
    }
  };

  const room = () => {
    if (pos + BLOCK_MAX <= buf.length) return;
    const keep = Math.min(pos, win);
    buf.copyWithin(0, pos - keep, pos);
    pos = keep;
  };

  // Literals section header: type (0 raw, 1 RLE, 2 Huffman with tree, 3 treeless = reuse the previous tree) and a
  // size format that picks between 1-5 header bytes and 1 or 4 Huffman streams. Returns [count, bytes used].
  // KNOWN DEFECT: the RLE branch does not check hs < b.length; a truncated block yields b[hs] = undefined, which
  // fill() turns into zeros instead of a 'corrupt' error. Fix: `if (hs >= b.length) corrupt('zstd literals')`.
  const literals = (b) => {
    const type = b[0] & 3, sf = (b[0] >> 2) & 3;
    if (type < 2) {
      let n, hs;
      if (sf === 0 || sf === 2) { n = b[0] >> 3; hs = 1; } else if (sf === 1) { n = (b[0] >> 4) + (b[1] << 4); hs = 2; } else { n = (b[0] >> 4) + (b[1] << 4) + (b[2] << 12); hs = 3; }
      if (n > BLOCK_MAX) corrupt('zstd literals size');
      if (type === 0) { if (hs + n > b.length) corrupt('zstd literals'); lits.set(b.subarray(hs, hs + n)); return [n, hs + n]; }
      lits.fill(b[hs], 0, n);
      return [n, hs + 1];
    }
    let n, c, hs, streams = 4;
    if (sf === 0 || sf === 1) { const v = b[0] | (b[1] << 8) | (b[2] << 16); n = (v >> 4) & 0x3ff; c = (v >> 14) & 0x3ff; hs = 3; if (sf === 0) streams = 1; }
    else if (sf === 2) { const v = (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0; n = (v >>> 4) & 0x3fff; c = (v >>> 18) & 0x3fff; hs = 4; }
    else { const v = (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0; n = (v >>> 4) & 0x3ffff; c = ((v >>> 22) | (b[4] << 10)) & 0x3ffff; hs = 5; }
    if (n > BLOCK_MAX || hs + c > b.length) corrupt('zstd literals size');
    let d = b.subarray(hs, hs + c);
    if (type === 2) { huff = readHuffman(d, 0); d = d.subarray(huff.used); } else if (!huff) corrupt('zstd treeless literals without a table');
    if (streams === 1) huffStream(d, huff, lits, 0, n);
    else {
      if (d.length < 6) corrupt('zstd literal streams');
      // 4 streams (decodable in parallel by SIMD-minded decoders): a 6-byte jump table gives the sizes of the first
      // three; each stream holds ceil(n / 4) symbols except the last, which takes the remainder.
      const s1 = d[0] | (d[1] << 8), s2 = d[2] | (d[3] << 8), s3 = d[4] | (d[5] << 8);
      const seg = (n + 3) >> 2;
      let o = 6;
      const parts = [s1, s2, s3, d.length - 6 - s1 - s2 - s3];
      if (parts[3] < 0) corrupt('zstd literal streams');
      for (let k = 0; k < 4; k++) { huffStream(d.subarray(o, o + parts[k]), huff, lits, k * seg, k < 3 ? seg : n - 3 * seg); o += parts[k]; }
    }
    return [n, hs + c];
  };

  // Sequence table modes: 0 predefined, 1 RLE (a single symbol, 0 bits per state), 2 FSE-compressed description
  // (max accuracy log 9 for lengths, 8 for offsets), 3 repeat the previous block's table.
  const table = (mode, b, p, kind) => {
    const def = defaults();
    if (mode === 0) return [def[kind], p];
    if (mode === 1) return [rleTable(b[p]), p + 1];
    if (mode === 2) { const t = readCounts(b, p, kind === 'of' ? 8 : 9, kind === 'll' ? 35 : kind === 'ml' ? 52 : 31); return [buildTable(t.counts, t.log), p + t.size]; }
    const prev = kind === 'll' ? tLL : kind === 'ml' ? tML : tOF;
    if (!prev) corrupt('zstd repeated table without a previous one');
    return [prev, p];
  };

  const compressed = (b, end) => {
    const [nLits, lsize] = literals(b);
    let p = lsize;
    let nSeq = b[p++];
    // Sequence count: 1 byte (< 128), 2 bytes ((b0 - 128) << 8 + b1), or 0xFF + le16 + 0x7F00.
    if (nSeq >= 128) { if (nSeq === 255) { nSeq = b[p] + (b[p + 1] << 8) + 0x7f00; p += 2; } else { nSeq = ((nSeq - 128) << 8) + b[p++]; } }
    let lp = 0;
    if (nSeq) {
      const modes = b[p++];
      [tLL, p] = table(modes >> 6, b, p, 'll');
      [tOF, p] = table((modes >> 4) & 3, b, p, 'of');
      [tML, p] = table((modes >> 2) & 3, b, p, 'ml');
      if (p > b.length) corrupt('zstd sequences');
      // The hot loop: bit reads, repeat offsets and short copies on locals.
      const d = b.subarray(p);
      if (!d.length || !d[d.length - 1]) corrupt('zstd bit stream end marker');
      let bp = d.length * 8 - (Math.clz32(d[d.length - 1]) - 23);
      const rd = (n) => {
        if (!n) return 0;
        if (n > 24) { const hi = rd(n - 16); return hi * 65536 + rd(16); }
        bp -= n;
        const i = bp >> 3;
        return ((d[i] | (d[i + 1] << 8) | (d[i + 2] << 16) | (d[i + 3] << 24)) >>> (bp & 7)) & ((1 << n) - 1);
      };
      const LLs = tLL.sym, LLn = tLL.nbits, LLb = tLL.base, MLs = tML.sym, MLn = tML.nbits, MLb = tML.base, OFs = tOF.sym, OFn = tOF.nbits, OFb = tOF.base;
      // Initial states in the order LL, OF, ML; per sequence the extra bits are read OF, ML, LL, then the states are
      // updated LL, ML, OF (skipped after the last sequence). The order is normative: the encoder wrote the reverse.
      let sl = rd(tLL.log), so = rd(tOF.log), sm = rd(tML.log);
      let r0 = reps[0], r1 = reps[1], r2 = reps[2];
      for (let i = 0; i < nSeq; i++) {
        const oc = OFs[so], mc = MLs[sm], lc = LLs[sl];
        if (oc > 31 || mc > 52 || lc > 35) corrupt('zstd sequence code');
        // Offset value = 2^code + extra bits (1 << 31 would be negative, hence the literal). Values 1-3 are repeat
        // offsets; > 3 is a new offset of value - 3, which pushes the history.
        const ov = (oc < 31 ? 1 << oc : 2147483648) + rd(oc);
        const ml = ML_BASE[mc] + rd(ML_BITS[mc]);
        const ll = LL_BASE[lc] + rd(LL_BITS[lc]);
        let off;
        if (ov > 3) { off = ov - 3; r2 = r1; r1 = r0; r0 = off; }
        else {
          // With literal length 0 the repeat indices shift by one (repeating rep0 right after a match would be
          // pointless), and index 4 means rep0 - 1.
          const idx = ll === 0 ? ov + 1 : ov;
          if (idx === 1) off = r0;
          else if (idx === 2) { off = r1; r1 = r0; r0 = off; }
          else if (idx === 3) { off = r2; r2 = r1; r1 = r0; r0 = off; }
          else { off = r0 - 1; if (!off) corrupt('zstd offset'); r2 = r1; r1 = r0; r0 = off; }
        }
        if (i < nSeq - 1) {
          sl = LLb[sl] + rd(LLn[sl]);
          sm = MLb[sm] + rd(MLn[sm]);
          so = OFb[so] + rd(OFn[so]);
        }
        if (lp + ll > nLits) corrupt('zstd literal length');
        if (pos + ll + ml > end) corrupt('zstd block size');
        if (ll < 32) { for (let k = 0; k < ll; k++) buf[pos + k] = lits[lp + k]; } else buf.set(lits.subarray(lp, lp + ll), pos);
        pos += ll; lp += ll; frameOut += ll;
        if (off > frameOut || off > pos) corrupt('zstd offset beyond the window');
        let from = pos - off;
        // Overlapping matches (off < ml) must copy forwards byte by byte; copyWithin (memmove) is only used for long
        // non-overlapping copies, short ones are cheaper as a plain loop.
        if (off >= ml && ml >= 32) { buf.copyWithin(pos, from, from + ml); pos += ml; } else for (let k = 0; k < ml; k++) buf[pos++] = buf[from++];
        frameOut += ml;
      }
      reps = [r0, r1, r2];
      if (bp !== 0) corrupt('zstd sequence stream');
    } else if (p !== b.length) corrupt('zstd block size');
    if (pos + nLits - lp > end) corrupt('zstd block size');
    buf.set(lits.subarray(lp, nLits), pos);
    pos += nLits - lp; frameOut += nLits - lp;
  };

  return {
    size,
    read() {
      for (;;) {
        if (state === 2) return null;
        if (state === 0) {
          if (!startFrame()) { state = 2; if (size != null && total !== size) corrupt('zstd size'); return null; }
          state = 1;
          continue;
        }
        if (last) {
          if (frame.contentSize != null && frameOut !== frame.contentSize) corrupt('zstd content size');
          if (check) {
            const want = reader.u32('zstd checksum');
            // The frame stores only the low 32 bits of the XXH64 of the content (seed 0).
            if (check.digest()[0] !== want) fail('checksum', 'Zstandard checksum mismatch');
          }
          state = 0;
          continue;
        }
        // Block header (le24): bit 0 last block, bits 1-2 type (0 raw, 1 RLE, 2 compressed, 3 reserved), bits 3-23 size
        // (for RLE: the regenerated size, the payload is 1 byte).
        const h = reader.u8() | (reader.u8() << 8) | (reader.u8() << 16);
        last = (h & 1) === 1;
        const type = (h >> 1) & 3, bsize = h >>> 3;
        room();
        const start = pos;
        if (type === 0) { if (bsize > BLOCK_MAX) corrupt('zstd block size'); const d = reader.bytes(bsize, 'zstd block'); buf.set(d, pos); pos += bsize; frameOut += bsize; }
        else if (type === 1) { if (bsize > BLOCK_MAX) corrupt('zstd block size'); buf.fill(reader.u8(), pos, pos + bsize); pos += bsize; frameOut += bsize; }
        else if (type === 2) { if (bsize > BLOCK_MAX) corrupt('zstd block size'); compressed(reader.bytes(bsize, 'zstd block'), pos + BLOCK_MAX); }
        else corrupt('zstd block type');
        if (pos - start > BLOCK_MAX) corrupt('zstd block size');
        if (pos > start) {
          const out = buf.subarray(start, pos);
          if (check) check.update(out);
          total += out.length;
          return out;
        }
      }
    },
  };
}
