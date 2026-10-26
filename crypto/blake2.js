// crypto/blake2.js - BLAKE2b (64-bit words as 32-bit pairs) and BLAKE2s (RFC 7693) with keys, salt and
// personalization. Options: { dkLen (output bytes), key, salt, personalization }.
//
// HAIFA-style compression with a byte counter t and a final-block flag f instead of MD length padding: the last
// block is zero-padded and compressed with f set, so the buffer must always hold back the last (possibly full) block
// until digest() - see update(). Keyed mode is a built-in MAC (no HMAC needed): the key, zero-padded to one block,
// is the first block. The parameter block (digest length, key length, fanout, depth, salt, personalization) is XORed
// into the IV, so different parameters give unrelated functions (BLAKE2b-256 is not truncated BLAKE2b-512).
// Little-endian everywhere (words, counter, output). Pure ARX: no tables, constant time by construction.
// Byte counter: a Number, exact to 2^53 bytes; the counter's high words (t1 / beyond 2^64) are never needed.
import { toBytes } from './encoding.js';

// Message word permutations of the 10 rounds; BLAKE2b's 12 rounds reuse rows 0 and 1 (r % 10).
const SIGMA = new Uint8Array([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3,
  11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4,
  7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8,
  9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13,
  2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9,
  12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11,
  13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10,
  6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5,
  10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0,
]);
// The SHA-256 / SHA-512 IVs (sqrt of the first 8 primes): nothing-up-my-sleeve constants shared with sha2.js.
const IV32 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
// BLAKE2b IV as (lo, hi) pairs.
const IV64 = new Uint32Array([0xf3bcc908, 0x6a09e667, 0x84caa73b, 0xbb67ae85, 0xfe94f82b, 0x3c6ef372, 0x5f1d36f1, 0xa54ff53a,
  0xade682d1, 0x510e527f, 0x2b3e6c1f, 0x9b05688c, 0xfb41bd6b, 0x1f83d9ab, 0x137e2179, 0x5be0cd19]);

const le32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

// Validates the RFC 7693 limits: output 1..64 (b) / 1..32 (s), key <= the same, salt and personalization exactly
// 16 (b) / 8 (s) bytes. Exact lengths, not zero-padding of short values: silently padding would make "ab" and
// "ab\0" the same salt.
function params(opts, maxOut, maxKey, saltLen, defOut) {
  const o = opts || {};
  const dkLen = o.dkLen ?? defOut;
  const key = o.key ? toBytes(o.key) : new Uint8Array(0);
  if (!(dkLen >= 1 && dkLen <= maxOut)) throw new Error(`output length must be 1..${maxOut}`);
  if (key.length > maxKey) throw new Error(`key longer than ${maxKey} bytes`);
  const salt = o.salt ? toBytes(o.salt) : null, pers = o.personalization ? toBytes(o.personalization) : null;
  if (salt && salt.length !== saltLen) throw new Error(`salt must be ${saltLen} bytes`);
  if (pers && pers.length !== saltLen) throw new Error(`personalization must be ${saltLen} bytes`);
  return { dkLen, key, salt, pers };
}

class Blake2 {
  update(data) {
    if (this.done) throw new Error('digest already computed');
    const d = toBytes(data), bl = this.blockLen, buf = this.buffer;
    for (let i = 0; i < d.length;) {
      // The last block is compressed with the final flag, so a full buffer waits until more data arrives.
      // Hence `> bl` (strictly more than one block left) on the direct path: an input that ends exactly on a block
      // boundary leaves that block in the buffer for digest(). Classic bug otherwise: compressing it without f
      // and then finalising an empty block gives a wrong digest for every multiple-of-block input.
      if (this.pos === bl) { this.counter(bl); this.compress(buf, 0, false); this.pos = 0; }
      if (this.pos === 0 && d.length - i > bl) {
        while (d.length - i > bl) { this.counter(bl); this.compress(d, i, false); i += bl; }
        continue;
      }
      const take = Math.min(bl - this.pos, d.length - i);
      buf.set(d.subarray(i, i + take), this.pos);
      this.pos += take;
      i += take;
    }
    return this;
  }

  digest() {
    if (this.done) throw new Error('digest already computed');
    this.done = true;
    // The counter counts real bytes only (padding excluded): an empty unkeyed message compresses one zero block
    // with t = 0.
    this.counter(this.pos);
    this.buffer.fill(0, this.pos);
    this.compress(this.buffer, 0, true);
    const out = new Uint8Array(this.outputLen);
    for (let i = 0; i < out.length; i++) out[i] = this.h[i >> 2] >>> (8 * (i & 3));
    this.h.fill(0);
    this.buffer.fill(0);
    return out;
  }

  // Copies the running state of another instance of the same parameters (PBKDF2 / HMAC loops).
  restoreFrom(o) {
    this.h.set(o.h); this.buffer.set(o.buffer); this.pos = o.pos; this.t0 = o.t0; this.done = o.done;
    return this;
  }

  clone() {
    const c = Object.create(Object.getPrototypeOf(this));
    for (const [k, v] of Object.entries(this)) c[k] = ArrayBuffer.isView(v) ? v.slice() : v;
    return c;
  }
}

class Blake2b extends Blake2 {
  constructor(opts) {
    super();
    const { dkLen, key, salt, pers } = params(opts, 64, 64, 16, 64);
    this.blockLen = 128;
    this.outputLen = dkLen;
    this.h = new Uint32Array(IV64);
    // Parameter block word 0: digest length | key length << 8 | fanout 1 << 16 | depth 1 << 24 (sequential mode).
    // Salt is parameter bytes 32..47 -> u64 words 4, 5 -> 32-bit (lo, hi) slots 8..11; personalization 12..15.
    this.h[0] ^= 0x01010000 ^ (key.length << 8) ^ dkLen;
    if (salt) for (let i = 0; i < 4; i++) this.h[8 + i] ^= le32(salt, 4 * i);
    if (pers) for (let i = 0; i < 4; i++) this.h[12 + i] ^= le32(pers, 4 * i);
    this.v = new Int32Array(32);
    this.m = new Int32Array(32);
    this.t0 = 0; // byte counter (Number, exact up to 2^53; the high words stay 0)
    this.buffer = new Uint8Array(128);
    this.pos = 0;
    this.done = false;
    // Keyed: the padded key is a full first block, left in the buffer like data (so a keyed hash of the empty
    // message compresses exactly that block with the final flag, as RFC 7693 requires). The caller's key buffer is
    // copied, not retained; digest() zeroes this copy.
    if (key.length) { this.buffer.set(key); this.pos = 128; }
  }

  counter(n) { this.t0 += n; }

  compress(b, o, last) {
    const v = this.v, m = this.m, h = this.h;
    for (let i = 0; i < 32; i++, o += 4) m[i] = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
    for (let i = 0; i < 16; i++) { v[i] = h[i]; v[i + 16] = IV64[i]; }
    // v12 ^= t (low 64 bits of the counter: words 24, 25), v13 ^= t >> 64 (always 0 here, skipped),
    // v14 = ~v14 on the last block (words 28, 29). Message words are paired (lo, hi), so SIGMA indices are doubled.
    v[24] ^= this.t0 >>> 0;
    v[25] ^= Math.floor(this.t0 / 0x100000000);
    if (last) { v[28] = ~v[28]; v[29] = ~v[29]; }
    for (let r = 0; r < 12; r++) {
      const s = (r % 10) * 16;
      G64(v, m, 0, 8, 16, 24, SIGMA[s] * 2, SIGMA[s + 1] * 2);
      G64(v, m, 2, 10, 18, 26, SIGMA[s + 2] * 2, SIGMA[s + 3] * 2);
      G64(v, m, 4, 12, 20, 28, SIGMA[s + 4] * 2, SIGMA[s + 5] * 2);
      G64(v, m, 6, 14, 22, 30, SIGMA[s + 6] * 2, SIGMA[s + 7] * 2);
      G64(v, m, 0, 10, 20, 30, SIGMA[s + 8] * 2, SIGMA[s + 9] * 2);
      G64(v, m, 2, 12, 22, 24, SIGMA[s + 10] * 2, SIGMA[s + 11] * 2);
      G64(v, m, 4, 14, 16, 26, SIGMA[s + 12] * 2, SIGMA[s + 13] * 2);
      G64(v, m, 6, 8, 18, 28, SIGMA[s + 14] * 2, SIGMA[s + 15] * 2);
    }
    for (let i = 0; i < 16; i++) h[i] ^= v[i] ^ v[i + 16];
  }
}

// BLAKE2b mixing on 64-bit words stored as (lo, hi) at even indices of v, message words m[x], m[y].
// Rotations 32 / 24 / 16 / 63: rotr32 is a free half swap, rotr63 = rotl1. Additions carry from lo to hi through a
// Number sum (< 2^34, exact) divided by 2^32 - the same technique as SHA-512 in sha2.js.
function G64(v, m, a, b, c, d, x, y) {
  let al = v[a], ah = v[a + 1], bl = v[b], bh = v[b + 1], cl = v[c], ch = v[c + 1], dl = v[d], dh = v[d + 1];
  // a = a + b + m[x]; d = rotr32(d ^ a)
  let l = (al >>> 0) + (bl >>> 0) + (m[x] >>> 0);
  ah = (ah + bh + m[x + 1] + ((l / 0x100000000) | 0)) | 0; al = l | 0;
  let tl = dl ^ al, th = dh ^ ah;
  dl = th; dh = tl;
  // c = c + d; b = rotr24(b ^ c)
  l = (cl >>> 0) + (dl >>> 0);
  ch = (ch + dh + ((l / 0x100000000) | 0)) | 0; cl = l | 0;
  tl = bl ^ cl; th = bh ^ ch;
  bl = (tl >>> 24) | (th << 8); bh = (th >>> 24) | (tl << 8);
  // a = a + b + m[y]; d = rotr16(d ^ a)
  l = (al >>> 0) + (bl >>> 0) + (m[y] >>> 0);
  ah = (ah + bh + m[y + 1] + ((l / 0x100000000) | 0)) | 0; al = l | 0;
  tl = dl ^ al; th = dh ^ ah;
  dl = (tl >>> 16) | (th << 16); dh = (th >>> 16) | (tl << 16);
  // c = c + d; b = rotr63(b ^ c) = rotl1
  l = (cl >>> 0) + (dl >>> 0);
  ch = (ch + dh + ((l / 0x100000000) | 0)) | 0; cl = l | 0;
  tl = bl ^ cl; th = bh ^ ch;
  bl = (tl << 1) | (th >>> 31); bh = (th << 1) | (tl >>> 31);
  v[a] = al; v[a + 1] = ah; v[b] = bl; v[b + 1] = bh; v[c] = cl; v[c + 1] = ch; v[d] = dl; v[d + 1] = dh;
}

class Blake2s extends Blake2 {
  constructor(opts) {
    super();
    const { dkLen, key, salt, pers } = params(opts, 32, 32, 8, 32);
    this.blockLen = 64;
    this.outputLen = dkLen;
    this.h = new Uint32Array(IV32);
    this.h[0] ^= 0x01010000 ^ (key.length << 8) ^ dkLen;
    if (salt) { this.h[4] ^= le32(salt, 0); this.h[5] ^= le32(salt, 4); }
    if (pers) { this.h[6] ^= le32(pers, 0); this.h[7] ^= le32(pers, 4); }
    this.v = new Int32Array(16);
    this.m = new Int32Array(16);
    this.t0 = 0;
    this.buffer = new Uint8Array(64);
    this.pos = 0;
    this.done = false;
    if (key.length) { this.buffer.set(key); this.pos = 64; }
  }

  counter(n) { this.t0 += n; }

  compress(b, o, last) {
    const v = this.v, m = this.m, h = this.h;
    for (let i = 0; i < 16; i++, o += 4) m[i] = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
    for (let i = 0; i < 8; i++) { v[i] = h[i]; v[i + 8] = IV32[i]; }
    v[12] ^= this.t0 >>> 0;
    v[13] ^= Math.floor(this.t0 / 0x100000000);
    if (last) v[14] = ~v[14];
    for (let r = 0; r < 10; r++) {
      const s = r * 16;
      G32(v, m, 0, 4, 8, 12, SIGMA[s], SIGMA[s + 1]);
      G32(v, m, 1, 5, 9, 13, SIGMA[s + 2], SIGMA[s + 3]);
      G32(v, m, 2, 6, 10, 14, SIGMA[s + 4], SIGMA[s + 5]);
      G32(v, m, 3, 7, 11, 15, SIGMA[s + 6], SIGMA[s + 7]);
      G32(v, m, 0, 5, 10, 15, SIGMA[s + 8], SIGMA[s + 9]);
      G32(v, m, 1, 6, 11, 12, SIGMA[s + 10], SIGMA[s + 11]);
      G32(v, m, 2, 7, 8, 13, SIGMA[s + 12], SIGMA[s + 13]);
      G32(v, m, 3, 4, 9, 14, SIGMA[s + 14], SIGMA[s + 15]);
    }
    for (let i = 0; i < 8; i++) h[i] ^= v[i] ^ v[i + 8];
  }
}

// BLAKE2s mixing: the ChaCha quarter round with message injection, rotations 16 / 12 / 8 / 7.
function G32(v, m, a, b, c, d, x, y) {
  let va = v[a], vb = v[b], vc = v[c], vd = v[d], t;
  va = (va + vb + m[x]) | 0; t = vd ^ va; vd = (t >>> 16) | (t << 16);
  vc = (vc + vd) | 0; t = vb ^ vc; vb = (t >>> 12) | (t << 20);
  va = (va + vb + m[y]) | 0; t = vd ^ va; vd = (t >>> 8) | (t << 24);
  vc = (vc + vd) | 0; t = vb ^ vc; vb = (t >>> 7) | (t << 25);
  v[a] = va; v[b] = vb; v[c] = vc; v[d] = vd;
}

const make = (algo, C, blockLen, outputLen) => {
  const fn = (data, opts) => new C(opts).update(data).digest();
  fn.create = (opts) => new C(opts);
  fn.algo = algo;
  fn.blockLen = blockLen;
  fn.outputLen = outputLen;
  return fn;
};

export const blake2b = make('blake2b', Blake2b, 128, 64);
export const blake2s = make('blake2s', Blake2s, 64, 32);
// BLAKE2b with digest length 32 in the parameter block (Cardano, Polkadot, Zcash use it): a distinct function, so
// fn.outputLen must say 32 for HMAC / PBKDF2 sizing - which `blake2b` with { dkLen: 32 } could not express.
export const blake2b256 = make('blake2b-256', class extends Blake2b { constructor(o) { super({ ...o, dkLen: 32 }); } }, 128, 32);

// --- BLAKE2sp ----------------------------------------------------------------------------------
// Eight BLAKE2s leaves (fanout 8, depth 2, inner length 32, node offsets 0..7) take the input's 64-byte blocks in
// turn; the root hashes the eight leaf digests. The last leaf and the root carry the last-node flag. Used by RAR 5.
// One state array holds the leaves (8 words each) so a 512-byte stripe is eight compressions without objects.

class Blake2sp {
  constructor() {
    this.blockLen = 64;
    this.outputLen = 32;
    this.h = new Int32Array(72); // 8 leaves + root
    for (let n = 0; n < 9; n++) {
      for (let i = 0; i < 8; i++) this.h[8 * n + i] = IV32[i];
      this.h[8 * n] ^= 0x02080020; // digest 32, key 0, fanout 8, depth 2
      this.h[8 * n + 2] ^= n < 8 ? n : 0; // node offset
      this.h[8 * n + 3] ^= n < 8 ? 0x20000000 : 0x20010000; // inner length 32, node depth 0 (leaves) / 1 (root)
    }
    this.t = 0; // bytes compressed per leaf (the leaves move together while whole stripes are hashed)
    this.v = new Int32Array(16);
    this.m = new Int32Array(16);
    this.buffer = new Uint8Array(1024); // up to two stripes: see update()
    this.pos = 0;
    this.done = false;
  }

  compress(n, b, o, t, last, lastNode) {
    const v = this.v, m = this.m, h = this.h, s = 8 * n;
    for (let i = 0; i < 16; i++, o += 4) m[i] = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
    for (let i = 0; i < 8; i++) { v[i] = h[s + i]; v[i + 8] = IV32[i]; }
    v[12] ^= t >>> 0;
    v[13] ^= Math.floor(t / 0x100000000);
    if (last) v[14] = ~v[14];
    if (lastNode) v[15] = ~v[15];
    for (let r = 0; r < 10; r++) {
      const k = r * 16;
      G32(v, m, 0, 4, 8, 12, SIGMA[k], SIGMA[k + 1]);
      G32(v, m, 1, 5, 9, 13, SIGMA[k + 2], SIGMA[k + 3]);
      G32(v, m, 2, 6, 10, 14, SIGMA[k + 4], SIGMA[k + 5]);
      G32(v, m, 3, 7, 11, 15, SIGMA[k + 6], SIGMA[k + 7]);
      G32(v, m, 0, 5, 10, 15, SIGMA[k + 8], SIGMA[k + 9]);
      G32(v, m, 1, 6, 11, 12, SIGMA[k + 10], SIGMA[k + 11]);
      G32(v, m, 2, 7, 8, 13, SIGMA[k + 12], SIGMA[k + 13]);
      G32(v, m, 3, 4, 9, 14, SIGMA[k + 14], SIGMA[k + 15]);
    }
    for (let i = 0; i < 8; i++) h[s + i] ^= v[i] ^ v[i + 8];
  }

  stripe(b, o) {
    this.t += 64;
    for (let n = 0; n < 8; n++) this.compress(n, b, o + 64 * n, this.t, false, false);
  }

  // Every leaf finalizes the last block it receives, so a stripe is hashed (without the final flag) only once all
  // eight leaves have data after it: more than 512 + 448 bytes must follow its start.
  update(data) {
    if (this.done) throw new Error('digest already computed');
    const d = toBytes(data), buf = this.buffer;
    for (let i = 0; i < d.length;) {
      if (this.pos === 1024) { this.stripe(buf, 0); buf.copyWithin(0, 512, 1024); this.pos = 512; }
      if (this.pos === 512 && d.length - i > 448) { this.stripe(buf, 0); this.pos = 0; }
      if (this.pos === 0) while (d.length - i > 960) { this.stripe(d, i); i += 512; }
      const take = Math.min(1024 - this.pos, d.length - i);
      buf.set(d.subarray(i, i + take), this.pos);
      this.pos += take;
      i += take;
    }
    return this;
  }

  digest() {
    if (this.done) throw new Error('digest already computed');
    this.done = true;
    // Up to 1024 buffered bytes: leaf n owns bytes [64n, 64n + 64) of the first stripe and [512 + 64n, ...) of the
    // second. A leaf with data in the second stripe compresses its first-stripe block normally, then its second
    // block as final; otherwise its (possibly empty) first-stripe block is final. Counters add only the real bytes.
    // Root: the eight 32-byte leaf digests = 256 bytes = 4 blocks, the 4th with both final and last-node flags.
    const buf = this.buffer, leaves = new Uint8Array(256), n0 = this.pos;
    buf.fill(0, n0);
    for (let n = 0; n < 8; n++) {
      const a = 64 * n, b = 512 + a;
      if (n0 > b) {
        this.compress(n, buf, a, this.t + 64, false, false);
        this.compress(n, buf, b, this.t + 64 + Math.min(64, n0 - b), true, n === 7);
      } else this.compress(n, buf, a, this.t + Math.max(0, Math.min(64, n0 - a)), true, n === 7);
      for (let i = 0; i < 32; i++) leaves[32 * n + i] = this.h[8 * n + (i >> 2)] >>> (8 * (i & 3));
    }
    for (let k = 0; k < 4; k++) this.compress(8, leaves, 64 * k, 64 * (k + 1), k === 3, k === 3);
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) out[i] = this.h[64 + (i >> 2)] >>> (8 * (i & 3));
    this.h.fill(0);
    buf.fill(0);
    return out;
  }

  clone() {
    const c = Object.create(Blake2sp.prototype);
    for (const [k, v] of Object.entries(this)) c[k] = ArrayBuffer.isView(v) ? v.slice() : v;
    return c;
  }
}

export const blake2sp = make('blake2sp', Blake2sp, 64, 32);
