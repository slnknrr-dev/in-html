// crypto/scrypt.js - scrypt (RFC 7914): PBKDF2-HMAC-SHA256 around ROMix with BlockMix / Salsa20/8.
//   scrypt(password, salt, { N = 16384, r = 8, p = 1, dkLen = 32 }) -> Uint8Array
//   scryptAsync(password, salt, opts, { onProgress, signal }) -> Promise<Uint8Array>
//
// Structure: B = PBKDF2-HMAC-SHA256(P, S, 1, p * 128r); each 128r-byte chunk goes through ROMix (fill V with N
// successive BlockMix states, then N data-dependent reads V[Integerify(X) mod N]); DK = PBKDF2(P, B', 1, dkLen).
// Memory = 128 * r * N bytes (16 MiB at the defaults N = 2^14, r = 8, the RFC 7914 interactive-login example).
// Side channel by design: the second ROMix loop reads V at password-dependent indices (cache timing), like
// Argon2d. Little-endian 32-bit words throughout (RFC 7914 section 4 / 5). Test vectors: RFC 7914 section 12.
import { pbkdf2, runAsync, runSync } from './kdf.js';
import { sha256 } from './sha2.js';
import { toBytes } from './encoding.js';

// Salsa20/8 core on 16 words of B at offset o, in place (x scratch of 16 words).
// A private copy of salsa.js's core with 4 double rounds and in-place feed-forward: the shared core has a fixed 20
// rounds and a separate output array, and this is the innermost loop of scrypt (2 * N * 2r calls per chunk).
function salsa8(B, o, x) {
  for (let i = 0; i < 16; i++) x[i] = B[o + i];
  let x0 = x[0], x1 = x[1], x2 = x[2], x3 = x[3], x4 = x[4], x5 = x[5], x6 = x[6], x7 = x[7];
  let x8 = x[8], x9 = x[9], x10 = x[10], x11 = x[11], x12 = x[12], x13 = x[13], x14 = x[14], x15 = x[15], t;
  for (let i = 0; i < 8; i += 2) {
    t = (x0 + x12) | 0; x4 ^= (t << 7) | (t >>> 25); t = (x4 + x0) | 0; x8 ^= (t << 9) | (t >>> 23);
    t = (x8 + x4) | 0; x12 ^= (t << 13) | (t >>> 19); t = (x12 + x8) | 0; x0 ^= (t << 18) | (t >>> 14);
    t = (x5 + x1) | 0; x9 ^= (t << 7) | (t >>> 25); t = (x9 + x5) | 0; x13 ^= (t << 9) | (t >>> 23);
    t = (x13 + x9) | 0; x1 ^= (t << 13) | (t >>> 19); t = (x1 + x13) | 0; x5 ^= (t << 18) | (t >>> 14);
    t = (x10 + x6) | 0; x14 ^= (t << 7) | (t >>> 25); t = (x14 + x10) | 0; x2 ^= (t << 9) | (t >>> 23);
    t = (x2 + x14) | 0; x6 ^= (t << 13) | (t >>> 19); t = (x6 + x2) | 0; x10 ^= (t << 18) | (t >>> 14);
    t = (x15 + x11) | 0; x3 ^= (t << 7) | (t >>> 25); t = (x3 + x15) | 0; x7 ^= (t << 9) | (t >>> 23);
    t = (x7 + x3) | 0; x11 ^= (t << 13) | (t >>> 19); t = (x11 + x7) | 0; x15 ^= (t << 18) | (t >>> 14);
    t = (x0 + x3) | 0; x1 ^= (t << 7) | (t >>> 25); t = (x1 + x0) | 0; x2 ^= (t << 9) | (t >>> 23);
    t = (x2 + x1) | 0; x3 ^= (t << 13) | (t >>> 19); t = (x3 + x2) | 0; x0 ^= (t << 18) | (t >>> 14);
    t = (x5 + x4) | 0; x6 ^= (t << 7) | (t >>> 25); t = (x6 + x5) | 0; x7 ^= (t << 9) | (t >>> 23);
    t = (x7 + x6) | 0; x4 ^= (t << 13) | (t >>> 19); t = (x4 + x7) | 0; x5 ^= (t << 18) | (t >>> 14);
    t = (x10 + x9) | 0; x11 ^= (t << 7) | (t >>> 25); t = (x11 + x10) | 0; x8 ^= (t << 9) | (t >>> 23);
    t = (x8 + x11) | 0; x9 ^= (t << 13) | (t >>> 19); t = (x9 + x8) | 0; x10 ^= (t << 18) | (t >>> 14);
    t = (x15 + x14) | 0; x12 ^= (t << 7) | (t >>> 25); t = (x12 + x15) | 0; x13 ^= (t << 9) | (t >>> 23);
    t = (x13 + x12) | 0; x14 ^= (t << 13) | (t >>> 19); t = (x14 + x13) | 0; x15 ^= (t << 18) | (t >>> 14);
  }
  B[o] += x0; B[o + 1] += x1; B[o + 2] += x2; B[o + 3] += x3; B[o + 4] += x4; B[o + 5] += x5; B[o + 6] += x6; B[o + 7] += x7;
  B[o + 8] += x8; B[o + 9] += x9; B[o + 10] += x10; B[o + 11] += x11; B[o + 12] += x12; B[o + 13] += x13; B[o + 14] += x14; B[o + 15] += x15;
}

// BlockMix_salsa8 of the 2r 64-byte blocks of B (words at bo), output to Y (words at yo).
// X starts as the last block; X = Salsa(X ^ B_i) for each block; outputs are de-interleaved (even i first half, odd
// i second half) as RFC 7914 section 4 specifies - forgetting the shuffle is the classic incompatible-scrypt bug.
// Callers pass Y = the second half of the same XY buffer, so input and output never overlap.
function blockMix(B, bo, Y, yo, r, X, x) {
  const n = 32 * r;
  for (let i = 0; i < 16; i++) X[i] = B[bo + n - 16 + i];
  for (let i = 0; i < 2 * r; i++) {
    for (let k = 0; k < 16; k++) X[k] ^= B[bo + 16 * i + k];
    salsa8(X, 0, x);
    // even blocks to the first half, odd blocks to the second half
    const dst = yo + (i & 1 ? r * 16 + (i >> 1) * 16 : (i >> 1) * 16);
    for (let k = 0; k < 16; k++) Y[dst + k] = X[k];
  }
}

function* scryptSteps(password, salt, opts = {}) {
  const N = opts.N ?? 16384, r = opts.r ?? 8, p = opts.p ?? 1, dkLen = opts.dkLen ?? 32;
  // RFC 7914 limits: N a power of two > 1 (Integerify reduces with a mask), r * p < 2^30. The 2^31 - 1 byte cap on V
  // is this implementation's: one Int32Array, and the `& (N - 1)` / int32 index arithmetic stay exact below it.
  // `N & (N - 1)` is int32 arithmetic, so some N >= 2^32 (e.g. 3 * 2^32) pass the power-of-two test - harmless, the
  // memory test on the next lines rejects every N that large.
  if (!(N > 1) || (N & (N - 1)) !== 0) throw new Error('scrypt: N must be a power of two > 1');
  if (!(r >= 1) || !(p >= 1) || r * p >= 1 << 30) throw new Error('scrypt: invalid r / p');
  if (128 * r * N > 0x7fffffff) throw new Error('scrypt: too much memory');
  const pw = toBytes(password);
  const b = pbkdf2(sha256, pw, toBytes(salt), 1, p * 128 * r);
  const words = 32 * r;
  const B = new Int32Array(p * words);
  for (let i = 0; i < B.length; i++) B[i] = b[4 * i] | (b[4 * i + 1] << 8) | (b[4 * i + 2] << 16) | (b[4 * i + 3] << 24);
  // XY: X in words [0, 32r), BlockMix output in [32r, 64r), copied back with copyWithin (no allocation per step).
  // KNOWN DEFECT (hygiene): only V is wiped at the end; B, b, out and XY (all password-derived) are left for the GC,
  // and an aborted scryptAsync drops even V un-wiped. Fix: wipe them before returning, try / finally for V.
  const V = new Int32Array(N * words), XY = new Int32Array(2 * words), X = new Int32Array(16), x = new Int32Array(16);
  const total = 2 * N * p;
  for (let k = 0; k < p; k++) {
    const off = k * words;
    for (let i = 0; i < words; i++) XY[i] = B[off + i];
    for (let i = 0; i < N; i++) {
      V.set(XY.subarray(0, words), i * words);
      blockMix(XY, 0, XY, words, r, X, x);
      XY.copyWithin(0, words, 2 * words);
      if ((i & 255) === 255) yield (2 * N * k + i) / total;
    }
    for (let i = 0; i < N; i++) {
      // Integerify: first word of the last 64-byte block, mod N (N <= 2^31)
      // (RFC: the 64-bit little-endian value mod N; since N <= 2^31 only the low 32 bits matter.)
      const j = (XY[words - 16] >>> 0) & (N - 1);
      for (let q = 0; q < words; q++) XY[q] ^= V[j * words + q];
      blockMix(XY, 0, XY, words, r, X, x);
      XY.copyWithin(0, words, 2 * words);
      if ((i & 255) === 255) yield (2 * N * k + N + i) / total;
    }
    for (let i = 0; i < words; i++) B[off + i] = XY[i];
  }
  V.fill(0);
  const out = new Uint8Array(B.length * 4);
  for (let i = 0; i < B.length; i++) { const v = B[i]; out[4 * i] = v; out[4 * i + 1] = v >>> 8; out[4 * i + 2] = v >>> 16; out[4 * i + 3] = v >>> 24; }
  return pbkdf2(sha256, pw, out, 1, dkLen);
}

export const scrypt = (password, salt, opts) => runSync(scryptSteps(password, salt, opts));
export const scryptAsync = (password, salt, opts, run) => runAsync(scryptSteps(password, salt, opts), run);
