// crypto/salsa.js - Salsa20/20 (Bernstein; 16- or 32-byte key, 8-byte nonce, 64-bit block counter), HSalsa20 and
// XSalsa20 (24-byte nonce). KDBX 3 protects in-memory fields with a Salsa20 stream.
//
//   new Salsa20(key, nonce, counter = 0) .update(chunk) -> xored bytes; .keystream(n)
//   salsa20(key, nonce, data, counter = 0), xsalsa20(key, nonce24, data), hsalsa20(key, nonce16) -> 32 bytes
//   salsa20Core(in64) -> out64 (the Salsa20 hash function)
//
// ChaCha's predecessor: same ARX family (constant time, no tables), different quarter round (add-rotate-xor into
// the target instead of in place, rotations 7 / 9 / 13 / 18) and state layout (constants on the diagonal). Kept for
// formats that fixed it: KDBX 3 inner stream, NaCl secretbox (XSalsa20), and scrypt's Salsa20/8 (scrypt.js has its
// own 8-round copy). Little-endian words and counter. No authentication: pair with a MAC.
import { toBytes, wipe } from './encoding.js';

const le32 = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);

// 10 double rounds (column round then row round), unrolled into locals; add = false for HSalsa20.
function core(s, x, add) {
  let x0 = s[0], x1 = s[1], x2 = s[2], x3 = s[3], x4 = s[4], x5 = s[5], x6 = s[6], x7 = s[7];
  let x8 = s[8], x9 = s[9], x10 = s[10], x11 = s[11], x12 = s[12], x13 = s[13], x14 = s[14], x15 = s[15], t;
  for (let i = 0; i < 20; i += 2) {
    // column round
    t = (x0 + x12) | 0; x4 ^= (t << 7) | (t >>> 25); t = (x4 + x0) | 0; x8 ^= (t << 9) | (t >>> 23);
    t = (x8 + x4) | 0; x12 ^= (t << 13) | (t >>> 19); t = (x12 + x8) | 0; x0 ^= (t << 18) | (t >>> 14);
    t = (x5 + x1) | 0; x9 ^= (t << 7) | (t >>> 25); t = (x9 + x5) | 0; x13 ^= (t << 9) | (t >>> 23);
    t = (x13 + x9) | 0; x1 ^= (t << 13) | (t >>> 19); t = (x1 + x13) | 0; x5 ^= (t << 18) | (t >>> 14);
    t = (x10 + x6) | 0; x14 ^= (t << 7) | (t >>> 25); t = (x14 + x10) | 0; x2 ^= (t << 9) | (t >>> 23);
    t = (x2 + x14) | 0; x6 ^= (t << 13) | (t >>> 19); t = (x6 + x2) | 0; x10 ^= (t << 18) | (t >>> 14);
    t = (x15 + x11) | 0; x3 ^= (t << 7) | (t >>> 25); t = (x3 + x15) | 0; x7 ^= (t << 9) | (t >>> 23);
    t = (x7 + x3) | 0; x11 ^= (t << 13) | (t >>> 19); t = (x11 + x7) | 0; x15 ^= (t << 18) | (t >>> 14);
    // row round
    t = (x0 + x3) | 0; x1 ^= (t << 7) | (t >>> 25); t = (x1 + x0) | 0; x2 ^= (t << 9) | (t >>> 23);
    t = (x2 + x1) | 0; x3 ^= (t << 13) | (t >>> 19); t = (x3 + x2) | 0; x0 ^= (t << 18) | (t >>> 14);
    t = (x5 + x4) | 0; x6 ^= (t << 7) | (t >>> 25); t = (x6 + x5) | 0; x7 ^= (t << 9) | (t >>> 23);
    t = (x7 + x6) | 0; x4 ^= (t << 13) | (t >>> 19); t = (x4 + x7) | 0; x5 ^= (t << 18) | (t >>> 14);
    t = (x10 + x9) | 0; x11 ^= (t << 7) | (t >>> 25); t = (x11 + x10) | 0; x8 ^= (t << 9) | (t >>> 23);
    t = (x8 + x11) | 0; x9 ^= (t << 13) | (t >>> 19); t = (x9 + x8) | 0; x10 ^= (t << 18) | (t >>> 14);
    t = (x15 + x14) | 0; x12 ^= (t << 7) | (t >>> 25); t = (x12 + x15) | 0; x13 ^= (t << 9) | (t >>> 23);
    t = (x13 + x12) | 0; x14 ^= (t << 13) | (t >>> 19); t = (x14 + x13) | 0; x15 ^= (t << 18) | (t >>> 14);
  }
  if (add) {
    x0 += s[0]; x1 += s[1]; x2 += s[2]; x3 += s[3]; x4 += s[4]; x5 += s[5]; x6 += s[6]; x7 += s[7];
    x8 += s[8]; x9 += s[9]; x10 += s[10]; x11 += s[11]; x12 += s[12]; x13 += s[13]; x14 += s[14]; x15 += s[15];
  }
  x[0] = x0; x[1] = x1; x[2] = x2; x[3] = x3; x[4] = x4; x[5] = x5; x[6] = x6; x[7] = x7;
  x[8] = x8; x[9] = x9; x[10] = x10; x[11] = x11; x[12] = x12; x[13] = x13; x[14] = x14; x[15] = x15;
}

const toLE = (words) => {
  const out = new Uint8Array(words.length * 4);
  for (let i = 0; i < words.length; i++) { const w = words[i]; out[4 * i] = w; out[4 * i + 1] = w >>> 8; out[4 * i + 2] = w >>> 16; out[4 * i + 3] = w >>> 24; }
  return out;
};

export function salsa20Core(input) {
  const b = toBytes(input), s = new Int32Array(16), x = new Int32Array(16);
  for (let i = 0; i < 16; i++) s[i] = le32(b, 4 * i);
  core(s, x, true);
  return toLE(x);
}

// "expand 32-byte k" / "expand 16-byte k" at words 0, 5, 10, 15; key at 1..4 and 11..14; nonce 6, 7; counter 8, 9.
// 16-byte keys are repeated into both key slots with the "16-byte" constants (Bernstein's spec), so a 128-bit key
// is not merely a zero-padded 256-bit key.
function initState(key) {
  const k = toBytes(key);
  if (k.length !== 32 && k.length !== 16) throw new Error('Salsa20 key must be 16 or 32 bytes');
  const s = new Int32Array(16);
  const c = k.length === 32 ? [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574] : [0x61707865, 0x3120646e, 0x79622d36, 0x6b206574];
  s[0] = c[0]; s[5] = c[1]; s[10] = c[2]; s[15] = c[3];
  for (let i = 0; i < 4; i++) s[1 + i] = le32(k, 4 * i);
  const k2 = k.length === 32 ? 16 : 0;
  for (let i = 0; i < 4; i++) s[11 + i] = le32(k, k2 + 4 * i);
  return s;
}

export function hsalsa20(key, nonce16) {
  const n = toBytes(nonce16);
  if (n.length !== 16 || toBytes(key).length !== 32) throw new Error('HSalsa20 needs a 32-byte key and a 16-byte nonce');
  const s = initState(key), x = new Int32Array(16);
  for (let i = 0; i < 4; i++) s[6 + i] = le32(n, 4 * i);
  core(s, x, false);
  // Output = the constant and nonce positions of the bare permutation (same reasoning as HChaCha20 in chacha.js).
  const out = toLE([x[0], x[5], x[10], x[15], x[6], x[7], x[8], x[9]]);
  wipe(s, x);
  return out;
}

export class Salsa20 {
  constructor(key, nonce, counter = 0) {
    let n = toBytes(nonce), k = toBytes(key);
    // XSalsa20: subkey from HSalsa20 over the first 16 nonce bytes, the last 8 are the Salsa20 nonce.
    // (Same minor hygiene gap as chacha.js: the derived subkey k is not wiped.)
    if (n.length === 24) { k = hsalsa20(k, n.subarray(0, 16)); n = n.subarray(16); }
    if (n.length !== 8) throw new Error('Salsa20 nonce must be 8 bytes (24 for XSalsa20)');
    const s = initState(k);
    s[6] = le32(n, 0); s[7] = le32(n, 4);
    s[8] = counter >>> 0; s[9] = Math.floor(counter / 0x100000000);
    this.s = s;
    this.x = new Int32Array(16);
    this.ks = new Uint8Array(64);
    this.pos = 64;
  }

  // Explicit little-endian serialisation into ks (unlike chacha.js's aliased view): endian-independent at the cost
  // of 64 byte stores per block. 64-bit counter: wraps only after 2^70 bytes, so no overflow check.
  next() {
    core(this.s, this.x, true);
    const x = this.x, ks = this.ks;
    for (let i = 0; i < 16; i++) { const w = x[i]; ks[4 * i] = w; ks[4 * i + 1] = w >>> 8; ks[4 * i + 2] = w >>> 16; ks[4 * i + 3] = w >>> 24; }
    const s = this.s;
    s[8] = (s[8] + 1) | 0;
    if (s[8] === 0) s[9] = (s[9] + 1) | 0;
    this.pos = 0;
  }

  update(chunk) {
    const d = toBytes(chunk), n = d.length, out = new Uint8Array(n), ks = this.ks;
    let i = 0;
    while (i < n && this.pos < 64) out[i] = d[i++] ^ ks[this.pos++];
    for (; i + 64 <= n; i += 64) {
      this.next();
      for (let j = 0; j < 64; j++) out[i + j] = d[i + j] ^ ks[j];
      this.pos = 64;
    }
    while (i < n) {
      if (this.pos === 64) this.next();
      out[i] = d[i++] ^ ks[this.pos++];
    }
    return out;
  }

  keystream(n) { return this.update(new Uint8Array(n)); }
  final() { this.destroy(); return new Uint8Array(0); }
  destroy() { wipe(this.s, this.x, this.ks); }
}

export const salsa20 = (key, nonce, data, counter = 0) => new Salsa20(key, nonce, counter).update(data);
export const xsalsa20 = (key, nonce24, data) => {
  if (toBytes(nonce24).length !== 24) throw new Error('XSalsa20 nonce must be 24 bytes');
  return new Salsa20(key, nonce24).update(data);
};
