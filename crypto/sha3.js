// crypto/sha3.js - Keccak-f[1600] sponge (FIPS 202): SHA3-224/256/384/512, SHAKE128/256 (extendable output) and the
// original Keccak-256 / Keccak-512 padding (Ethereum). Lanes are pairs of 32-bit words (lo, hi), little endian.
//
// Sponge: absorb `rate` bytes per permutation (rate = 200 - 2 * security bytes: 144 / 136 / 104 / 72 for SHA3-224 /
// 256 / 384 / 512), pad, squeeze. Padding differs only in the domain byte XORed after the message: 0x06 SHA-3 (bits
// 01 + pad10*1 start), 0x1f SHAKE (1111), 0x01 Keccak (pre-standard, what Ethereum's "sha3" actually is - the
// two give different digests for every input, a classic interop bug). The final 0x80 closes pad10*1; when the
// message ends at rate - 1 the two bytes coincide (0x06 ^ 0x80 = 0x86), which the XOR handles for free.
// Lanes are plain (lo, hi) halves, not bit-interleaved: 64-bit rotations become two 32-bit funnel shifts.
// Data-independent: no tables, no branches on data - constant time by construction (modulo JIT caveats).
import { toBytes } from './encoding.js';

// Round constants (LFSR of FIPS 202, 3.2.5), interleaved (lo, hi); the rho offsets and pi moves are unrolled below.
// rc(t) is an LFSR over GF(2) with polynomial x^8 + x^6 + x^5 + x^4 + 1 (the 0x71 feedback); bit j of round i's
// constant sits at lane bit position 2^j - 1 (0, 1, 3, 7, 15, 31, 63), which is why only 7 bits per round are set.
// Generated rather than tabulated: 24 lines of hex are a transcription risk; the LFSR is the definition.
const RC = new Int32Array(48);
(() => {
  let r = 1;
  for (let round = 0; round < 24; round++) {
    for (let j = 0; j < 7; j++) {
      r = ((r << 1) ^ ((r >> 7) * 0x71)) & 0xff;
      if (r & 2) {
        const bit = (1 << j) - 1;
        if (bit < 32) RC[2 * round] ^= 1 << bit; else RC[2 * round + 1] ^= 1 << (bit - 32);
      }
    }
  }
})();

// Keccak-f[1600] on 50 32-bit words, each round unrolled into local variables: theta (column parities c, d),
// rho + pi into b (lanes rotated and moved), chi + iota back into the state.
// Lane (x, y) lives at words 2 * (x + 5y) (lo) and +1 (hi). bNN names the destination word after pi, so chi can read
// rows b[10y .. 10y + 9] directly. Rotation by n < 32: (l << n | h >>> (32 - n), h << n | l >>> (32 - n)); by n > 32
// the halves swap roles (e.g. lane (2, 0), rho offset 62: b40 = h2 << 30 | l2 >>> 2, a rotation right by 2). Full
// unrolling into locals beats a loop over offset tables in V8: no bounds checks, no table loads, values in registers.
// The `round` counter steps by 2 because RC is stored as (lo, hi) pairs.
export function keccakF1600(s) {
  for (let round = 0; round < 48; round += 2) {
    const c0 = s[0] ^ s[10] ^ s[20] ^ s[30] ^ s[40];
    const c1 = s[1] ^ s[11] ^ s[21] ^ s[31] ^ s[41];
    const c2 = s[2] ^ s[12] ^ s[22] ^ s[32] ^ s[42];
    const c3 = s[3] ^ s[13] ^ s[23] ^ s[33] ^ s[43];
    const c4 = s[4] ^ s[14] ^ s[24] ^ s[34] ^ s[44];
    const c5 = s[5] ^ s[15] ^ s[25] ^ s[35] ^ s[45];
    const c6 = s[6] ^ s[16] ^ s[26] ^ s[36] ^ s[46];
    const c7 = s[7] ^ s[17] ^ s[27] ^ s[37] ^ s[47];
    const c8 = s[8] ^ s[18] ^ s[28] ^ s[38] ^ s[48];
    const c9 = s[9] ^ s[19] ^ s[29] ^ s[39] ^ s[49];
    const d0 = c8 ^ ((c2 << 1) | (c3 >>> 31)), d1 = c9 ^ ((c3 << 1) | (c2 >>> 31));
    const d2 = c0 ^ ((c4 << 1) | (c5 >>> 31)), d3 = c1 ^ ((c5 << 1) | (c4 >>> 31));
    const d4 = c2 ^ ((c6 << 1) | (c7 >>> 31)), d5 = c3 ^ ((c7 << 1) | (c6 >>> 31));
    const d6 = c4 ^ ((c8 << 1) | (c9 >>> 31)), d7 = c5 ^ ((c9 << 1) | (c8 >>> 31));
    const d8 = c6 ^ ((c0 << 1) | (c1 >>> 31)), d9 = c7 ^ ((c1 << 1) | (c0 >>> 31));
    const b0 = (s[0] ^ d0), b1 = (s[1] ^ d1);
    const l1 = (s[2] ^ d2), h1 = (s[3] ^ d3);
    const b20 = (l1 << 1) | (h1 >>> 31), b21 = (h1 << 1) | (l1 >>> 31);
    const l2 = (s[4] ^ d4), h2 = (s[5] ^ d5);
    const b40 = (h2 << 30) | (l2 >>> 2), b41 = (l2 << 30) | (h2 >>> 2);
    const l3 = (s[6] ^ d6), h3 = (s[7] ^ d7);
    const b10 = (l3 << 28) | (h3 >>> 4), b11 = (h3 << 28) | (l3 >>> 4);
    const l4 = (s[8] ^ d8), h4 = (s[9] ^ d9);
    const b30 = (l4 << 27) | (h4 >>> 5), b31 = (h4 << 27) | (l4 >>> 5);
    const l5 = (s[10] ^ d0), h5 = (s[11] ^ d1);
    const b32 = (h5 << 4) | (l5 >>> 28), b33 = (l5 << 4) | (h5 >>> 28);
    const l6 = (s[12] ^ d2), h6 = (s[13] ^ d3);
    const b2 = (h6 << 12) | (l6 >>> 20), b3 = (l6 << 12) | (h6 >>> 20);
    const l7 = (s[14] ^ d4), h7 = (s[15] ^ d5);
    const b22 = (l7 << 6) | (h7 >>> 26), b23 = (h7 << 6) | (l7 >>> 26);
    const l8 = (s[16] ^ d6), h8 = (s[17] ^ d7);
    const b42 = (h8 << 23) | (l8 >>> 9), b43 = (l8 << 23) | (h8 >>> 9);
    const l9 = (s[18] ^ d8), h9 = (s[19] ^ d9);
    const b12 = (l9 << 20) | (h9 >>> 12), b13 = (h9 << 20) | (l9 >>> 12);
    const l10 = (s[20] ^ d0), h10 = (s[21] ^ d1);
    const b14 = (l10 << 3) | (h10 >>> 29), b15 = (h10 << 3) | (l10 >>> 29);
    const l11 = (s[22] ^ d2), h11 = (s[23] ^ d3);
    const b34 = (l11 << 10) | (h11 >>> 22), b35 = (h11 << 10) | (l11 >>> 22);
    const l12 = (s[24] ^ d4), h12 = (s[25] ^ d5);
    const b4 = (h12 << 11) | (l12 >>> 21), b5 = (l12 << 11) | (h12 >>> 21);
    const l13 = (s[26] ^ d6), h13 = (s[27] ^ d7);
    const b24 = (l13 << 25) | (h13 >>> 7), b25 = (h13 << 25) | (l13 >>> 7);
    const l14 = (s[28] ^ d8), h14 = (s[29] ^ d9);
    const b44 = (h14 << 7) | (l14 >>> 25), b45 = (l14 << 7) | (h14 >>> 25);
    const l15 = (s[30] ^ d0), h15 = (s[31] ^ d1);
    const b46 = (h15 << 9) | (l15 >>> 23), b47 = (l15 << 9) | (h15 >>> 23);
    const l16 = (s[32] ^ d2), h16 = (s[33] ^ d3);
    const b16 = (h16 << 13) | (l16 >>> 19), b17 = (l16 << 13) | (h16 >>> 19);
    const l17 = (s[34] ^ d4), h17 = (s[35] ^ d5);
    const b36 = (l17 << 15) | (h17 >>> 17), b37 = (h17 << 15) | (l17 >>> 17);
    const l18 = (s[36] ^ d6), h18 = (s[37] ^ d7);
    const b6 = (l18 << 21) | (h18 >>> 11), b7 = (h18 << 21) | (l18 >>> 11);
    const l19 = (s[38] ^ d8), h19 = (s[39] ^ d9);
    const b26 = (l19 << 8) | (h19 >>> 24), b27 = (h19 << 8) | (l19 >>> 24);
    const l20 = (s[40] ^ d0), h20 = (s[41] ^ d1);
    const b28 = (l20 << 18) | (h20 >>> 14), b29 = (h20 << 18) | (l20 >>> 14);
    const l21 = (s[42] ^ d2), h21 = (s[43] ^ d3);
    const b48 = (l21 << 2) | (h21 >>> 30), b49 = (h21 << 2) | (l21 >>> 30);
    const l22 = (s[44] ^ d4), h22 = (s[45] ^ d5);
    const b18 = (h22 << 29) | (l22 >>> 3), b19 = (l22 << 29) | (h22 >>> 3);
    const l23 = (s[46] ^ d6), h23 = (s[47] ^ d7);
    const b38 = (h23 << 24) | (l23 >>> 8), b39 = (l23 << 24) | (h23 >>> 8);
    const l24 = (s[48] ^ d8), h24 = (s[49] ^ d9);
    const b8 = (l24 << 14) | (h24 >>> 18), b9 = (h24 << 14) | (l24 >>> 18);
    s[0] = b0 ^ (~b2 & b4) ^ RC[round]; s[1] = b1 ^ (~b3 & b5) ^ RC[round + 1];
    s[2] = b2 ^ (~b4 & b6); s[3] = b3 ^ (~b5 & b7);
    s[4] = b4 ^ (~b6 & b8); s[5] = b5 ^ (~b7 & b9);
    s[6] = b6 ^ (~b8 & b0); s[7] = b7 ^ (~b9 & b1);
    s[8] = b8 ^ (~b0 & b2); s[9] = b9 ^ (~b1 & b3);
    s[10] = b10 ^ (~b12 & b14); s[11] = b11 ^ (~b13 & b15);
    s[12] = b12 ^ (~b14 & b16); s[13] = b13 ^ (~b15 & b17);
    s[14] = b14 ^ (~b16 & b18); s[15] = b15 ^ (~b17 & b19);
    s[16] = b16 ^ (~b18 & b10); s[17] = b17 ^ (~b19 & b11);
    s[18] = b18 ^ (~b10 & b12); s[19] = b19 ^ (~b11 & b13);
    s[20] = b20 ^ (~b22 & b24); s[21] = b21 ^ (~b23 & b25);
    s[22] = b22 ^ (~b24 & b26); s[23] = b23 ^ (~b25 & b27);
    s[24] = b24 ^ (~b26 & b28); s[25] = b25 ^ (~b27 & b29);
    s[26] = b26 ^ (~b28 & b20); s[27] = b27 ^ (~b29 & b21);
    s[28] = b28 ^ (~b20 & b22); s[29] = b29 ^ (~b21 & b23);
    s[30] = b30 ^ (~b32 & b34); s[31] = b31 ^ (~b33 & b35);
    s[32] = b32 ^ (~b34 & b36); s[33] = b33 ^ (~b35 & b37);
    s[34] = b34 ^ (~b36 & b38); s[35] = b35 ^ (~b37 & b39);
    s[36] = b36 ^ (~b38 & b30); s[37] = b37 ^ (~b39 & b31);
    s[38] = b38 ^ (~b30 & b32); s[39] = b39 ^ (~b31 & b33);
    s[40] = b40 ^ (~b42 & b44); s[41] = b41 ^ (~b43 & b45);
    s[42] = b42 ^ (~b44 & b46); s[43] = b43 ^ (~b45 & b47);
    s[44] = b44 ^ (~b46 & b48); s[45] = b45 ^ (~b47 & b49);
    s[46] = b46 ^ (~b48 & b40); s[47] = b47 ^ (~b49 & b41);
    s[48] = b48 ^ (~b40 & b42); s[49] = b49 ^ (~b41 & b43);
  }

}

class Keccak {
  constructor(rate, suffix, outputLen, xof) {
    this.blockLen = rate;
    this.suffix = suffix;
    this.outputLen = outputLen;
    this.xof = xof;
    this.state = new Int32Array(50);
    // Byte view over the same 200 bytes: partial blocks and squeezing work byte-wise, full blocks word-wise.
    // KNOWN DEFECT (portability, latent): byte access through this view assumes a little-endian platform; on a
    // big-endian engine the partial-block path and squeeze would disagree with the word path. Every shipping JS
    // engine is little-endian today. Fix: use DataView with explicit little-endian access, or byte-swap like chacha.js.
    this.bytes = new Uint8Array(this.state.buffer);
    this.pos = 0;
    this.done = false;
  }

  update(data) {
    if (this.done) throw new Error('digest already computed');
    const d = toBytes(data), st = this.bytes, rate = this.blockLen;
    // Byte-wise XOR into the little-endian state (Int32Array views follow the platform order, little endian everywhere
    // JavaScript runs in practice).
    let i = 0;
    // Whole blocks straight from the input, a 32-bit word at a time.
    if (this.pos === 0) {
      const words = rate >> 2, state = this.state;
      for (; i + rate <= d.length; i += rate) {
        for (let w = 0, o = i; w < words; w++, o += 4) state[w] ^= d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24);
        keccakF1600(state);
      }
    }
    while (i < d.length) {
      const take = Math.min(rate - this.pos, d.length - i);
      for (let k = 0; k < take; k++) st[this.pos + k] ^= d[i + k];
      this.pos += take;
      i += take;
      if (this.pos === rate) { keccakF1600(this.state); this.pos = 0; }
    }
    return this;
  }

  // SHAKE: digest(n) squeezes n bytes (default: the nominal output length).
  // Squeeze: copy up to `rate` bytes, permute only if more output is needed (the last permutation would be wasted).
  // The state is zeroed afterwards; a SHAKE cannot be squeezed incrementally here (one digest call per instance).
  digest(n = this.outputLen) {
    if (this.done) throw new Error('digest already computed');
    this.done = true;
    const st = this.bytes, rate = this.blockLen;
    st[this.pos] ^= this.suffix;
    st[rate - 1] ^= 0x80;
    keccakF1600(this.state);
    const out = new Uint8Array(n);
    for (let o = 0; o < n;) {
      const take = Math.min(rate, n - o);
      out.set(st.subarray(0, take), o);
      o += take;
      if (o < n) keccakF1600(this.state);
    }
    this.state.fill(0);
    return out;
  }

  restoreFrom(o) { this.state.set(o.state); this.pos = o.pos; this.done = o.done; return this; }

  clone() {
    const c = new Keccak(this.blockLen, this.suffix, this.outputLen, this.xof);
    c.state.set(this.state);
    c.pos = this.pos;
    c.done = this.done;
    return c;
  }
}

// fn.xof marks SHAKE so hmac.js refuses it and callers know { dkLen } is honoured; for fixed-output functions dkLen
// is ignored on purpose (a truncated "SHA3-256" of another length would be a different, unnamed function).
const sponge = (algo, rate, suffix, outputLen, xof = false) => {
  const make = (opts) => new Keccak(rate, suffix, xof && opts && opts.dkLen ? opts.dkLen : outputLen, xof);
  const fn = (data, opts) => make(opts).update(data).digest();
  fn.create = make;
  fn.algo = algo;
  fn.blockLen = rate;
  fn.outputLen = outputLen;
  fn.xof = xof;
  return fn;
};

export const sha3_224 = sponge('sha3-224', 144, 0x06, 28);
export const sha3_256 = sponge('sha3-256', 136, 0x06, 32);
export const sha3_384 = sponge('sha3-384', 104, 0x06, 48);
export const sha3_512 = sponge('sha3-512', 72, 0x06, 64);
// SHAKE outputs default to 2x the security level; pass { dkLen } for any length.
export const shake128 = sponge('shake128', 168, 0x1f, 32, true);
export const shake256 = sponge('shake256', 136, 0x1f, 64, true);
export const keccak256 = sponge('keccak256', 136, 0x01, 32);
export const keccak512 = sponge('keccak512', 72, 0x01, 64);
