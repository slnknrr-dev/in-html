// crypto/md5.js - MD5 (RFC 1321). Broken for collision resistance; kept for checksums of legacy downloads.
// Collisions are cheap (seconds on a laptop, chosen-prefix too), so MD5 proves nothing about tampering; it still
// detects accidental corruption. Little-endian words and length.
import { MDHasher, hasher, wordsLE } from './hasher.js';

// K[i] = floor(2^32 * |sin(i + 1)|) (RFC 1321), precomputed: Math.sin is not guaranteed bit-exact across engines.
const K = new Int32Array([
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501, 0x698098d8, 0x8b44f7af,
  0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
  0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8, 0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8,
  0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665, 0xf4292244, 0x432aff97,
  0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1, 0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
  0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
]);
// Rotation amounts: 4 per round, repeating every 4 steps (indexed by (round << 2) | (i & 3)).
const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

class MD5 extends MDHasher {
  constructor() {
    super(64, 16, 8, true);
    this.state = new Int32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
    this.w = new Int32Array(16);
  }

  process(b, o) {
    const w = this.w, st = this.state;
    for (let i = 0; i < 16; i++, o += 4) w[i] = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
    let a = st[0], bb = st[1], c = st[2], d = st[3];
    // One loop with a per-round branch rather than 64 unrolled steps: compact; the branch is perfectly predictable
    // (it changes every 16 steps). g is the message word order of each round: i, 5i+1, 3i+5, 7i (mod 16).
    for (let i = 0; i < 64; i++) {
      let f, g;
      const r = i >> 4;
      if (r === 0) { f = (bb & c) | (~bb & d); g = i; }
      else if (r === 1) { f = (d & bb) | (~d & c); g = (5 * i + 1) & 15; }
      else if (r === 2) { f = bb ^ c ^ d; g = (3 * i + 5) & 15; }
      else { f = c ^ (bb | ~d); g = (7 * i) & 15; }
      const t = (a + f + K[i] + w[g]) | 0;
      const s = S[(r << 2) | (i & 3)];
      a = d; d = c; c = bb;
      bb = (bb + ((t << s) | (t >>> (32 - s)))) | 0;
    }
    st[0] = (st[0] + a) | 0; st[1] = (st[1] + bb) | 0; st[2] = (st[2] + c) | 0; st[3] = (st[3] + d) | 0;
  }

  output() { return wordsLE(this.state, 16); }
}

export const md5 = hasher('md5', () => new MD5(), 64, 16);
