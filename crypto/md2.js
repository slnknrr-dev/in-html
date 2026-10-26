// crypto/md2.js - MD2 (RFC 1319, with the checksum erratum: C[j] ^= S[c ^ L]). 16-byte blocks, byte-oriented, slow
// and broken (preimage attacks); kept for legacy formats: old X.509 / PKCS#1 signatures (md2WithRSAEncryption).
//
// Not Merkle-Damgard with length padding (hence no MDHasher): pad with i bytes of value i, then append a 16-byte
// checksum block. Erratum note: the RFC 1319 pseudo-code reads `C[j] = S[c ^ L]`; the reference C code and every
// published digest use `C[j] ^= S[c ^ L]`. Using the RFC text verbatim gives wrong digests for every input.
// Byte-oriented with S-box lookups indexed by data: table timing applies, irrelevant for a broken legacy hash.
import { toBytes } from './encoding.js';
import { hasher } from './hasher.js';

// The substitution permutation built from the digits of pi (RFC 1319, PI_SUBST).
const S = new Uint8Array([
  41, 46, 67, 201, 162, 216, 124, 1, 61, 54, 84, 161, 236, 240, 6, 19, 98, 167, 5, 243, 192, 199, 115, 140, 152, 147,
  43, 217, 188, 76, 130, 202, 30, 155, 87, 60, 253, 212, 224, 22, 103, 66, 111, 24, 138, 23, 229, 18, 190, 78, 196,
  214, 218, 158, 222, 73, 160, 251, 245, 142, 187, 47, 238, 122, 169, 104, 121, 145, 21, 178, 7, 63, 148, 194, 16, 137,
  11, 34, 95, 33, 128, 127, 93, 154, 90, 144, 50, 39, 53, 62, 204, 231, 191, 247, 151, 3, 255, 25, 48, 179, 72, 165,
  181, 209, 215, 94, 146, 42, 172, 86, 170, 198, 79, 184, 56, 210, 150, 164, 125, 182, 118, 252, 107, 226, 156, 116, 4,
  241, 69, 157, 112, 89, 100, 113, 135, 32, 134, 91, 207, 101, 230, 45, 168, 2, 27, 96, 37, 173, 174, 176, 185, 246, 28,
  70, 97, 105, 52, 64, 126, 15, 85, 71, 163, 35, 221, 81, 175, 58, 195, 92, 249, 206, 186, 197, 234, 38, 44, 83, 13,
  110, 133, 40, 132, 9, 211, 223, 205, 244, 65, 129, 77, 82, 106, 220, 55, 200, 108, 193, 171, 250, 36, 225, 123, 8, 12,
  189, 177, 74, 120, 136, 149, 139, 227, 99, 232, 109, 233, 203, 213, 254, 59, 0, 29, 57, 242, 239, 183, 14, 102, 88,
  208, 228, 166, 119, 114, 248, 235, 117, 75, 10, 49, 68, 80, 180, 143, 237, 31, 26, 219, 153, 141, 51, 159, 17, 131,
  20,
]);

class MD2 {
  constructor() {
    this.blockLen = 16;
    this.outputLen = 16;
    this.state = new Uint8Array(48);   // X: digest state, message block, their xor
    this.checksum = new Uint8Array(16); // C, with its running last byte L
    this.last = 0;
    this.buffer = new Uint8Array(16);
    this.pos = 0;
    this.done = false;
  }

  // One 16-byte block; `sum` also feeds it into the checksum (every block but the checksum block itself).
  process(b, o, sum) {
    const x = this.state;
    if (sum) {
      const c = this.checksum;
      let l = this.last;
      for (let j = 0; j < 16; j++) l = c[j] ^= S[b[o + j] ^ l];
      this.last = l;
    }
    for (let j = 0; j < 16; j++) {
      x[16 + j] = b[o + j];
      x[32 + j] = x[16 + j] ^ x[j];
    }
    // 18 rounds over the 48-byte X; t chains through every byte and the round number is added between rounds.
    let t = 0;
    for (let j = 0; j < 18; j++) {
      for (let k = 0; k < 48; k++) t = x[k] ^= S[t];
      t = (t + j) & 255;
    }
  }

  update(data) {
    if (this.done) throw new Error('digest already computed');
    const d = toBytes(data);
    const n = d.length, buf = this.buffer;
    let i = 0;
    if (this.pos) {
      const take = Math.min(16 - this.pos, n);
      buf.set(d.subarray(0, take), this.pos);
      this.pos += take;
      i = take;
      if (this.pos === 16) { this.process(buf, 0, true); this.pos = 0; }
    }
    for (; i + 16 <= n; i += 16) this.process(d, i, true);
    if (i < n) { buf.set(d.subarray(i), 0); this.pos = n - i; }
    return this;
  }

  digest() {
    if (this.done) throw new Error('digest already computed');
    this.done = true;
    // Padding: always 1–16 bytes, each holding the padding length.
    // pos < 16 after update, so pad >= 1: an aligned message gets a whole block of 16s (unambiguous unpadding).
    // The checksum block is compressed with sum = false: it must not be folded into itself.
    const pad = 16 - this.pos;
    this.buffer.fill(pad, this.pos);
    this.process(this.buffer, 0, true);
    this.process(this.checksum, 0, false);
    const out = this.state.slice(0, 16);
    this.destroy();
    return out;
  }

  restoreFrom(o) {
    this.state.set(o.state); this.checksum.set(o.checksum); this.buffer.set(o.buffer);
    this.last = o.last; this.pos = o.pos; this.done = o.done;
    return this;
  }

  clone() {
    const c = Object.create(MD2.prototype);
    for (const [k, v] of Object.entries(this)) c[k] = ArrayBuffer.isView(v) ? v.slice() : v;
    return c;
  }

  destroy() { this.state.fill(0); this.checksum.fill(0); this.buffer.fill(0); }
}

export const md2 = hasher('md2', () => new MD2(), 16, 16);
