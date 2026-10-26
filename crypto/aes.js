// crypto/aes.js - AES-128/192/256 (FIPS 197) with T-tables, and the modes ECB, CBC (PKCS#7), CTR (SP 800-38A) and
// GCM (SP 800-38D).
//
//   new AES(key) .encryptBlock(in16, out16) / .decryptBlock(in16, out16) / .encryptRepeated(words4, n)
//   One-shot:  aesEcbEncrypt(key, data, { padding = false }) / aesEcbDecrypt
//              aesCbcEncrypt(key, iv, data, { padding = true }) / aesCbcDecrypt (throws on bad padding)
//              aesCtr(key, iv, data) (encrypts and decrypts; 128-bit big-endian counter)
//              aesGcmEncrypt(key, iv, plaintext, aad) -> ciphertext || tag(16); aesGcmDecrypt(...) (throws on bad tag)
//   Streaming (Node-like): new AesEcb(key, { decrypt, padding }), AesCbc(key, iv, { decrypt, padding }), AesCtr(key, iv),
//              AesGcm(key, iv, { decrypt, aad, tagLength }); .update(chunk) -> bytes, .final() -> bytes;
//              GCM: .getTag() after final when encrypting, .setTag(tag) before final when decrypting.
//
// Security notes (read before using any mode):
// - KNOWN DEFECT (side channel): T-table AES and the GHASH byte tables index memory with key- and data-dependent
//   bytes, so cache timing leaks key bits to a co-resident attacker (Bernstein 2005, Osvik-Shamir-Tromer 2006).
//   Accepted for offline, single-user tools (KeePass files, local encryption); unsuitable for a multi-tenant server.
//   Fix: a bitsliced AES (e.g. the BearSSL ct64 design) and a constant-time carry-less multiply for GHASH.
// - ECB leaks equal plaintext blocks; it exists for test vectors and legacy formats only.
// - CBC is unauthenticated: without an external MAC checked first (encrypt-then-MAC), padding errors form a
//   padding oracle (Vaudenay 2002). KDBX 3 checks a hash of the header/blocks; standalone use needs HMAC.
// - CTR / GCM: never reuse an (key, IV) pair. A repeated GCM nonce reveals the XOR of the plaintexts AND the GHASH
//   key H, enabling forgeries. Use 96-bit random or counter IVs; other IV lengths go through GHASH (allowed, slower).
// - Byte order: AES words are big-endian (FIPS 197 column bytes 0..3 = word MSB..LSB); the CTR / GCM counters are
//   big-endian; GCM's length block is big-endian 64-bit bit counts.
import { concatBytes, equalBytes, toBytes, wipe } from './encoding.js';

// S-box, inverse S-box and the four encryption / decryption tables, computed once from GF(2^8) arithmetic.
// Generated rather than pasted (the technique of SJCL's AES): a few lines of source instead of 8 KiB of hex per
// direction, and a computed S-box cannot suffer a transcription typo. TEk[x] = rotations of the MixColumns column
// (2s, s, s, 3s) for s = SBOX[x], so one round is 16 lookups + XORs; TDk likewise for InvMixColumns (14, 9, 13, 11).
const SBOX = new Uint8Array(256), INV = new Uint8Array(256);
const TE0 = new Int32Array(256), TE1 = new Int32Array(256), TE2 = new Int32Array(256), TE3 = new Int32Array(256);
const TD0 = new Int32Array(256), TD1 = new Int32Array(256), TD2 = new Int32Array(256), TD3 = new Int32Array(256);
const TE = [TE0, TE1, TE2, TE3], TD = [TD0, TD1, TD2, TD3];
(() => {
  const d = new Uint8Array(256), th = new Uint8Array(256);
  for (let i = 0; i < 256; i++) th[(d[i] = (i << 1) ^ ((i >> 7) * 0x11b)) ^ i] = i;
  // Walk x over the multiplicative group with generator 3 (x ^= 2x), xi over its inverses (via th = "divide by 3").
  for (let x = 0, xi = 0, n = 0; n < 256; n++, x ^= d[x] || 1, xi = th[xi] || 1) {
    // Affine transform of the inverse: s = xi ^ rotl1(xi) ^ rotl2 ^ rotl3 ^ rotl4 ^ 0x63; the shifted copies are
    // folded back into 8 bits by XORing the overflow byte (s >> 8) - a rotation without masks.
    let s = xi ^ (xi << 1) ^ (xi << 2) ^ (xi << 3) ^ (xi << 4);
    s = (s >> 8) ^ (s & 255) ^ 0x63;
    SBOX[x] = s;
    INV[s] = x;
    const x2 = d[x], x4 = d[x2], x8 = d[x4];
    let dec = (x8 * 0x1010101) ^ (x4 * 0x10001) ^ (x2 * 0x101) ^ (x * 0x1010100);
    let enc = (d[s] * 0x101) ^ (s * 0x1010100);
    for (let k = 0; k < 4; k++) {
      enc = (enc << 24) | (enc >>> 8);
      dec = (dec << 24) | (dec >>> 8);
      TE[k][x] = enc;
      TD[k][s] = dec;
    }
  }
})();

// Key schedule (FIPS 197 5.2): Nk = 4 / 6 / 8 words, Nr = Nk + 6 rounds, 4 (Nr + 1) round-key words. Every Nk-th
// word gets RotWord + SubWord + Rcon; AES-256 adds a SubWord-only step at i % 8 === 4. Rcon doubles in GF(2^8)
// (x ^ 0x11b reduction on overflow).
export class AES {
  constructor(key) {
    const k = toBytes(key);
    if (k.length !== 16 && k.length !== 24 && k.length !== 32) throw new Error('AES key must be 16, 24 or 32 bytes');
    const nk = k.length / 4, rounds = nk + 6, total = 4 * (rounds + 1);
    const ek = new Int32Array(total);
    for (let i = 0; i < nk; i++) ek[i] = (k[4 * i] << 24) | (k[4 * i + 1] << 16) | (k[4 * i + 2] << 8) | k[4 * i + 3];
    let rcon = 1;
    for (let i = nk; i < total; i++) {
      let t = ek[i - 1];
      if (i % nk === 0 || (nk === 8 && i % nk === 4)) {
        t = (SBOX[t >>> 24] << 24) | (SBOX[(t >>> 16) & 255] << 16) | (SBOX[(t >>> 8) & 255] << 8) | SBOX[t & 255];
        if (i % nk === 0) {
          t = (t << 8) | (t >>> 24);
          t ^= rcon << 24;
          rcon = (rcon << 1) ^ ((rcon >> 7) * 0x11b);
        }
      }
      ek[i] = ek[i - nk] ^ t;
    }
    // Equivalent inverse cipher: round keys in reverse order, InvMixColumns applied to the inner ones.
    // (FIPS 197 5.3.5) With InvMixColumns folded into the inner round keys, decryption has the same structure as
    // encryption and can use the TD tables. TDk[SBOX[b]] = InvMixColumns of byte b alone, because TD already
    // includes InvSubBytes: SBOX first cancels it.
    const dk = new Int32Array(total);
    for (let r = 0; r <= rounds; r++) {
      for (let c = 0; c < 4; c++) {
        const t = ek[4 * (rounds - r) + c];
        dk[4 * r + c] = r === 0 || r === rounds ? t
          : TD0[SBOX[t >>> 24]] ^ TD1[SBOX[(t >>> 16) & 255]] ^ TD2[SBOX[(t >>> 8) & 255]] ^ TD3[SBOX[t & 255]];
      }
    }
    this.rounds = rounds;
    this.ek = ek;
    this.dk = dk;
  }

  // One block from src[so..so+15] to dst[d0..d0+15] (offsets avoid subarray allocations in mode loops; src and dst
  // may be the same buffer - the input is fully read into a..d before anything is written). Inner rounds use the
  // T-tables (SubBytes + ShiftRows + MixColumns per lookup); the last round has no MixColumns, so it uses the plain
  // S-box. ShiftRows is the column rotation in the operand order (a, b, c, d -> b, c, d, a ...).
  encryptBlock(src, dst, so = 0, d0 = 0) {
    const k = this.ek, T0 = TE0, T1 = TE1, T2 = TE2, T3 = TE3;
    let a = ((src[so] << 24) | (src[so + 1] << 16) | (src[so + 2] << 8) | src[so + 3]) ^ k[0];
    let b = ((src[so + 4] << 24) | (src[so + 5] << 16) | (src[so + 6] << 8) | src[so + 7]) ^ k[1];
    let c = ((src[so + 8] << 24) | (src[so + 9] << 16) | (src[so + 10] << 8) | src[so + 11]) ^ k[2];
    let d = ((src[so + 12] << 24) | (src[so + 13] << 16) | (src[so + 14] << 8) | src[so + 15]) ^ k[3];
    let ki = 4;
    for (let r = 1; r < this.rounds; r++, ki += 4) {
      const a2 = T0[a >>> 24] ^ T1[(b >>> 16) & 255] ^ T2[(c >>> 8) & 255] ^ T3[d & 255] ^ k[ki];
      const b2 = T0[b >>> 24] ^ T1[(c >>> 16) & 255] ^ T2[(d >>> 8) & 255] ^ T3[a & 255] ^ k[ki + 1];
      const c2 = T0[c >>> 24] ^ T1[(d >>> 16) & 255] ^ T2[(a >>> 8) & 255] ^ T3[b & 255] ^ k[ki + 2];
      d = T0[d >>> 24] ^ T1[(a >>> 16) & 255] ^ T2[(b >>> 8) & 255] ^ T3[c & 255] ^ k[ki + 3];
      a = a2; b = b2; c = c2;
    }
    const S = SBOX;
    out4(dst, d0, (S[a >>> 24] << 24) | (S[(b >>> 16) & 255] << 16) | (S[(c >>> 8) & 255] << 8) | S[d & 255], k[ki]);
    out4(dst, d0 + 4, (S[b >>> 24] << 24) | (S[(c >>> 16) & 255] << 16) | (S[(d >>> 8) & 255] << 8) | S[a & 255], k[ki + 1]);
    out4(dst, d0 + 8, (S[c >>> 24] << 24) | (S[(d >>> 16) & 255] << 16) | (S[(a >>> 8) & 255] << 8) | S[b & 255], k[ki + 2]);
    out4(dst, d0 + 12, (S[d >>> 24] << 24) | (S[(a >>> 16) & 255] << 16) | (S[(b >>> 8) & 255] << 8) | S[c & 255], k[ki + 3]);
  }

  // Mirror image with dk and TD; InvShiftRows rotates the other way (a, d, c, b operand order).
  decryptBlock(src, dst, so = 0, d0 = 0) {
    const k = this.dk, T0 = TD0, T1 = TD1, T2 = TD2, T3 = TD3;
    let a = ((src[so] << 24) | (src[so + 1] << 16) | (src[so + 2] << 8) | src[so + 3]) ^ k[0];
    let b = ((src[so + 4] << 24) | (src[so + 5] << 16) | (src[so + 6] << 8) | src[so + 7]) ^ k[1];
    let c = ((src[so + 8] << 24) | (src[so + 9] << 16) | (src[so + 10] << 8) | src[so + 11]) ^ k[2];
    let d = ((src[so + 12] << 24) | (src[so + 13] << 16) | (src[so + 14] << 8) | src[so + 15]) ^ k[3];
    let ki = 4;
    for (let r = 1; r < this.rounds; r++, ki += 4) {
      const a2 = T0[a >>> 24] ^ T1[(d >>> 16) & 255] ^ T2[(c >>> 8) & 255] ^ T3[b & 255] ^ k[ki];
      const b2 = T0[b >>> 24] ^ T1[(a >>> 16) & 255] ^ T2[(d >>> 8) & 255] ^ T3[c & 255] ^ k[ki + 1];
      const c2 = T0[c >>> 24] ^ T1[(b >>> 16) & 255] ^ T2[(a >>> 8) & 255] ^ T3[d & 255] ^ k[ki + 2];
      d = T0[d >>> 24] ^ T1[(c >>> 16) & 255] ^ T2[(b >>> 8) & 255] ^ T3[a & 255] ^ k[ki + 3];
      a = a2; b = b2; c = c2;
    }
    const S = INV;
    out4(dst, d0, (S[a >>> 24] << 24) | (S[(d >>> 16) & 255] << 16) | (S[(c >>> 8) & 255] << 8) | S[b & 255], k[ki]);
    out4(dst, d0 + 4, (S[b >>> 24] << 24) | (S[(a >>> 16) & 255] << 16) | (S[(d >>> 8) & 255] << 8) | S[c & 255], k[ki + 1]);
    out4(dst, d0 + 8, (S[c >>> 24] << 24) | (S[(b >>> 16) & 255] << 16) | (S[(a >>> 8) & 255] << 8) | S[d & 255], k[ki + 2]);
    out4(dst, d0 + 12, (S[d >>> 24] << 24) | (S[(c >>> 16) & 255] << 16) | (S[(b >>> 8) & 255] << 8) | S[a & 255], k[ki + 3]);
  }

  // Encrypts the block held as 4 big-endian words in w, in place, n times in a row (KeePass AES-KDF runs millions
  // of rounds; staying in words avoids the byte conversions of encryptBlock).
  encryptRepeated(w, n) {
    const k = this.ek, T0 = TE0, T1 = TE1, T2 = TE2, T3 = TE3, S = SBOX, R = this.rounds;
    let a = w[0], b = w[1], c = w[2], d = w[3];
    for (let i = 0; i < n; i++) {
      a ^= k[0]; b ^= k[1]; c ^= k[2]; d ^= k[3];
      let ki = 4;
      for (let r = 1; r < R; r++, ki += 4) {
        const a2 = T0[a >>> 24] ^ T1[(b >>> 16) & 255] ^ T2[(c >>> 8) & 255] ^ T3[d & 255] ^ k[ki];
        const b2 = T0[b >>> 24] ^ T1[(c >>> 16) & 255] ^ T2[(d >>> 8) & 255] ^ T3[a & 255] ^ k[ki + 1];
        const c2 = T0[c >>> 24] ^ T1[(d >>> 16) & 255] ^ T2[(a >>> 8) & 255] ^ T3[b & 255] ^ k[ki + 2];
        d = T0[d >>> 24] ^ T1[(a >>> 16) & 255] ^ T2[(b >>> 8) & 255] ^ T3[c & 255] ^ k[ki + 3];
        a = a2; b = b2; c = c2;
      }
      const a2 = ((S[a >>> 24] << 24) | (S[(b >>> 16) & 255] << 16) | (S[(c >>> 8) & 255] << 8) | S[d & 255]) ^ k[ki];
      const b2 = ((S[b >>> 24] << 24) | (S[(c >>> 16) & 255] << 16) | (S[(d >>> 8) & 255] << 8) | S[a & 255]) ^ k[ki + 1];
      const c2 = ((S[c >>> 24] << 24) | (S[(d >>> 16) & 255] << 16) | (S[(a >>> 8) & 255] << 8) | S[b & 255]) ^ k[ki + 2];
      d = ((S[d >>> 24] << 24) | (S[(a >>> 16) & 255] << 16) | (S[(b >>> 8) & 255] << 8) | S[c & 255]) ^ k[ki + 3];
      a = a2; b = b2; c = c2;
    }
    w[0] = a; w[1] = b; w[2] = c; w[3] = d;
  }

  // Zeroes the round keys; the instance is unusable afterwards (encrypting with zero keys would silently produce
  // garbage, so modes call it only in final()).
  destroy() { wipe(this.ek, this.dk); }
}

function out4(dst, o, w, k) {
  w ^= k;
  dst[o] = w >>> 24; dst[o + 1] = w >>> 16; dst[o + 2] = w >>> 8; dst[o + 3] = w;
}

const checkIv = (iv, n, what = 'IV') => {
  const v = toBytes(iv);
  if (v.length !== n) throw new Error(`${what} must be ${n} bytes`);
  return v;
};

// --- ECB / CBC -------------------------------------------------------------------------------

// PKCS#7: the last byte n (1..16) and n copies of it. All checks happen before throwing one generic error.
// KNOWN DEFECT (padding-oracle timing): the loop stops at the first bad byte (`!bad` in the condition) and the length
// is read early, so the time to reject depends on the padding contents; combined with an observable error this is
// a padding oracle on unauthenticated CBC. Mitigation is architectural (MAC before decrypt, as KDBX does).
// Fix: scan all 16 bytes unconditionally with masks, then throw once.
function unpad(b) {
  const n = b[b.length - 1];
  let bad = b.length === 0 || n === 0 || n > 16 ? 1 : 0;
  for (let i = 0; i < 16 && !bad; i++) if (i < n && b[b.length - 1 - i] !== n) bad = 1;
  if (bad) throw new Error('bad padding (wrong key or corrupted data)');
  return b.subarray(0, b.length - n);
}

// Shared block buffering of ECB and CBC streams: whole blocks out, the last block held back when decrypting with
// padding (it carries the padding).
class BlockStream {
  constructor(key, decrypt, padding) {
    this.aes = new AES(key);
    this.decrypt = !!decrypt;
    this.padding = padding;
    this.buf = new Uint8Array(0);
  }

  // Output length is always a multiple of 16; the remainder waits in this.buf. When decrypting with padding, a
  // complete final block is held back too: only final() knows it is the last one and may strip its padding.
  update(chunk) {
    const data = this.buf.length ? concatBytes(this.buf, toBytes(chunk)) : toBytes(chunk);
    let n = data.length - (data.length % 16);
    if (this.decrypt && this.padding && n === data.length && n > 0) n -= 16;
    this.buf = data.slice(n);
    const out = new Uint8Array(n);
    for (let o = 0; o < n; o += 16) this.block(data, o, out);
    return out;
  }

  final() {
    let out;
    if (this.decrypt) {
      if (this.buf.length % 16) throw new Error('data is not a multiple of the block size');
      out = new Uint8Array(this.buf.length);
      for (let o = 0; o < out.length; o += 16) this.block(this.buf, o, out);
      if (this.padding) out = unpad(out);
    } else {
      let data = this.buf;
      if (this.padding) {
        // 1..16 bytes: an aligned message gets a whole block of 0x10 so unpadding is never ambiguous.
        const n = 16 - (data.length % 16);
        data = concatBytes(data, new Uint8Array(n).fill(n));
      } else if (data.length % 16) throw new Error('data is not a multiple of the block size (enable padding)');
      out = new Uint8Array(data.length);
      for (let o = 0; o < out.length; o += 16) this.block(data, o, out);
    }
    this.buf = new Uint8Array(0);
    this.aes.destroy();
    return out;
  }
}

export class AesEcb extends BlockStream {
  constructor(key, { decrypt = false, padding = false } = {}) { super(key, decrypt, padding); }
  block(src, o, out) { if (this.decrypt) this.aes.decryptBlock(src, out, o, o); else this.aes.encryptBlock(src, out, o, o); }
}

export class AesCbc extends BlockStream {
  constructor(key, iv, { decrypt = false, padding = true } = {}) {
    super(key, decrypt, padding);
    this.prev = checkIv(iv, 16).slice();
    this.tmp = new Uint8Array(16);
  }

  // C_i = E(P_i ^ C_{i-1}), P_i = D(C_i) ^ C_{i-1}; C_0 = IV. Decryption saves src before it could be overwritten
  // (src and out are distinct arrays in BlockStream, but prev must hold ciphertext, not plaintext). Encryption goes
  // through a scratch block because the XOR input must not clobber the caller's plaintext.
  // The IV must be unpredictable (random) for CBC: a predictable IV allows chosen-plaintext attacks (BEAST).
  block(src, o, out) {
    const prev = this.prev;
    if (this.decrypt) {
      this.aes.decryptBlock(src, out, o, o);
      for (let i = 0; i < 16; i++) { out[o + i] ^= prev[i]; prev[i] = src[o + i]; }
    } else {
      const t = this.tmp;
      for (let i = 0; i < 16; i++) t[i] = src[o + i] ^ prev[i];
      this.aes.encryptBlock(t, out, 0, o);
      prev.set(out.subarray(o, o + 16));
    }
  }
}

// --- CTR ---------------------------------------------------------------------------------------

export class AesCtr {
  // inc32: only the low 32 bits of the counter block wrap (GCM); otherwise the whole 128-bit block is incremented.
  constructor(key, iv, { inc32 = false } = {}) {
    this.aes = key instanceof AES ? key : new AES(key);
    this.ctr = checkIv(iv, 16).slice();
    this.ks = new Uint8Array(16);
    this.pos = 16;
    this.inc32 = inc32;
  }

  // Keystream block = E(counter); then the counter is incremented as a big-endian integer (bytes 15 down to 0, or
  // down to 12 for inc32). Wrap-around of the full 128 bits is silent (2^128 blocks are unreachable).
  // KNOWN DEFECT (GCM limit not enforced): with inc32 the low 32 bits wrap after 2^32 blocks (64 GiB) and the
  // keystream repeats; SP 800-38D caps plaintext at 2^39 - 256 bits per invocation, which nothing here checks.
  // Fix: count blocks in AesGcm.update and throw past 2^32 - 2.
  next() {
    const ctr = this.ctr;
    this.aes.encryptBlock(ctr, this.ks);
    for (let j = 15, stop = this.inc32 ? 12 : 0; j >= stop; j--) if (++ctr[j] !== 256) break; else ctr[j] = 0;
    this.pos = 0;
  }

  // Three phases: drain the leftover keystream of the previous call, whole blocks, then a tail that leaves unused
  // keystream in ks for the next call - so chunk boundaries never change the output.
  update(chunk) {
    const d = toBytes(chunk), n = d.length, out = new Uint8Array(n), ks = this.ks;
    let i = 0;
    while (i < n && this.pos < 16) out[i] = d[i++] ^ ks[this.pos++];
    for (; i + 16 <= n; i += 16) {
      this.next();
      for (let j = 0; j < 16; j++) out[i + j] = d[i + j] ^ ks[j];
      this.pos = 16;
    }
    while (i < n) {
      if (this.pos === 16) this.next();
      out[i] = d[i++] ^ ks[this.pos++];
    }
    return out;
  }

  // No destroy here: AesGcm passes its own AES instance in and destroys it itself.
  final() { return new Uint8Array(0); }
}

// --- GCM ---------------------------------------------------------------------------------------

// GHASH with an 8-bit table per byte position: M[j][v] = (byte v at bits 8j..8j+7) * H, so a product is 16 table
// lookups and XORs (field elements as 4 big-endian 32-bit words, bit 0 = MSB of byte 0; 64 KiB of tables per key).
// GCM's bit-reflected convention: multiplying by x is a RIGHT shift of the 128-bit value, and the reduction
// polynomial x^128 + x^7 + x^2 + x + 1 appears as 0xe1 in the top byte. Trade-off: 16 x 256 x 16 bytes = 64 KiB
// tables cost ~4096 entries x 4 XORs to build per key (cheap next to any real message) and make each block 16
// lookups; Shoup's 4-bit tables would be 8 KiB but twice the lookups. Both leak via cache timing (see header).
class GHash {
  constructor(h) {
    const P = new Int32Array(128 * 4); // H * x^i
    let v0 = (h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3], v1 = (h[4] << 24) | (h[5] << 16) | (h[6] << 8) | h[7];
    let v2 = (h[8] << 24) | (h[9] << 16) | (h[10] << 8) | h[11], v3 = (h[12] << 24) | (h[13] << 16) | (h[14] << 8) | h[15];
    for (let i = 0; i < 128; i++) {
      P[4 * i] = v0; P[4 * i + 1] = v1; P[4 * i + 2] = v2; P[4 * i + 3] = v3;
      const lsb = v3 & 1;
      v3 = (v3 >>> 1) | (v2 << 31); v2 = (v2 >>> 1) | (v1 << 31); v1 = (v1 >>> 1) | (v0 << 31); v0 >>>= 1;
      if (lsb) v0 ^= 0xe1000000;
    }
    // Linear in v: M[j][v] = M[j][v without its top bit] ^ H * x^(8j + position of that bit).
    const M = new Int32Array(16 * 256 * 4);
    for (let j = 0; j < 16; j++) {
      for (let v = 1, top = 1, k = 7; v < 256; v++) {
        if (v === top * 2) { top = v; k--; }
        const o = (j * 256 + v) * 4, q = (j * 256 + (v - top)) * 4, p = (8 * j + k) * 4;
        M[o] = M[q] ^ P[p]; M[o + 1] = M[q + 1] ^ P[p + 1]; M[o + 2] = M[q + 2] ^ P[p + 2]; M[o + 3] = M[q + 3] ^ P[p + 3];
      }
    }
    this.M = M;
    this.y = new Int32Array(4);
    this.buf = new Uint8Array(16);
    this.pos = 0;
  }

  // Y = (Y ^ block) * H for the 16 bytes of b at o.
  block(b, o) {
    const M = this.M, y = this.y;
    const w0 = y[0] ^ ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
    const w1 = y[1] ^ ((b[o + 4] << 24) | (b[o + 5] << 16) | (b[o + 6] << 8) | b[o + 7]);
    const w2 = y[2] ^ ((b[o + 8] << 24) | (b[o + 9] << 16) | (b[o + 10] << 8) | b[o + 11]);
    const w3 = y[3] ^ ((b[o + 12] << 24) | (b[o + 13] << 16) | (b[o + 14] << 8) | b[o + 15]);
    let z0 = 0, z1 = 0, z2 = 0, z3 = 0;
    for (let q = 0; q < 4; q++) {
      const w = q === 0 ? w0 : q === 1 ? w1 : q === 2 ? w2 : w3;
      for (let k = 0, m0 = q * 4096; k < 4; k++, m0 += 1024) {
        const m = m0 + (((w >>> (24 - 8 * k)) & 255) << 2);
        z0 ^= M[m]; z1 ^= M[m + 1]; z2 ^= M[m + 2]; z3 ^= M[m + 3];
      }
    }
    y[0] = z0; y[1] = z1; y[2] = z2; y[3] = z3;
  }

  update(d) {
    let i = 0;
    if (this.pos) {
      while (this.pos < 16 && i < d.length) this.buf[this.pos++] = d[i++];
      if (this.pos < 16) return;
      this.block(this.buf, 0);
      this.pos = 0;
    }
    for (; i + 16 <= d.length; i += 16) this.block(d, i);
    while (i < d.length) this.buf[this.pos++] = d[i++];
  }

  // Zero-pads a partial block (between AAD and ciphertext, and at the end).
  pad() { if (this.pos) { this.buf.fill(0, this.pos); this.block(this.buf, 0); this.pos = 0; } }

  digest() {
    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i++) out[i] = this.y[i >> 2] >>> (24 - 8 * (i & 3));
    return out;
  }
}

const lenBlock = (aadBytes, ctBytes) => {
  const b = new Uint8Array(16);
  const put = (o, bytes) => {
    const bits = bytes * 8, hi = Math.floor(bits / 0x100000000), lo = bits >>> 0;
    b[o] = hi >>> 24; b[o + 1] = hi >>> 16; b[o + 2] = hi >>> 8; b[o + 3] = hi;
    b[o + 4] = lo >>> 24; b[o + 5] = lo >>> 16; b[o + 6] = lo >>> 8; b[o + 7] = lo;
  };
  put(0, aadBytes);
  put(8, ctBytes);
  return b;
};

export class AesGcm {
  // H = E_K(0^128) is the GHASH key. J0 = IV || 0^31 || 1 for 96-bit IVs; otherwise GHASH(IV padded || len64(IV)).
  // E_K(J0) masks the tag; data encryption starts at inc32(J0). tagLength 12..16: SP 800-38D also allows 4 and 8
  // bytes for special cases, refused here because short tags make forgery practical.
  // The AAD is passed once to the constructor (not streamed): it is hashed before any ciphertext, and GHASH needs
  // the AAD zero-padded to a block boundary before the first ciphertext byte.
  constructor(key, iv, { decrypt = false, aad, tagLength = 16 } = {}) {
    const v = toBytes(iv);
    if (!v.length) throw new Error('GCM IV must not be empty');
    if (!(tagLength >= 12 && tagLength <= 16)) throw new Error('GCM tag length must be 12..16 bytes');
    this.aes = new AES(key);
    const h = new Uint8Array(16);
    this.aes.encryptBlock(h, h);
    let j0;
    if (v.length === 12) { j0 = new Uint8Array(16); j0.set(v); j0[15] = 1; }
    else {
      const g = new GHash(h);
      g.update(v); g.pad(); g.update(lenBlock(0, v.length));
      j0 = g.digest();
    }
    this.ghash = new GHash(h);
    this.ek0 = new Uint8Array(16);
    this.aes.encryptBlock(j0, this.ek0);
    const c1 = j0.slice();
    for (let j = 15; j >= 12; j--) if (++c1[j] !== 256) break; else c1[j] = 0;
    this.ctr = new AesCtr(this.aes, c1, { inc32: true });
    this.decrypt = !!decrypt;
    this.tagLength = tagLength;
    this.aadLen = 0;
    this.len = 0;
    this.tag = null;
    if (aad && aad.length) { const a = toBytes(aad); this.ghash.update(a); this.aadLen = a.length; }
    this.ghash.pad();
  }

  // GHASH always runs over the ciphertext: the input when decrypting, the output when encrypting.
  // Streaming decryption returns plaintext BEFORE the tag is checked (final()); callers of the streaming API must
  // not act on it until final() succeeds. The one-shot aesGcmDecrypt below enforces this.
  update(chunk) {
    const d = toBytes(chunk);
    this.len += d.length;
    if (this.decrypt) { this.ghash.update(d); return this.ctr.update(d); }
    const out = this.ctr.update(d);
    this.ghash.update(out);
    return out;
  }

  final() {
    this.ghash.pad();
    this.ghash.update(lenBlock(this.aadLen, this.len));
    const s = this.ghash.digest();
    for (let i = 0; i < 16; i++) s[i] ^= this.ek0[i];
    // Truncated tag = leftmost tagLength bytes (SP 800-38D MSB_t). Compared in constant time (equalBytes); a missing
    // setTag() fails closed rather than skipping verification.
    const tag = s.subarray(0, this.tagLength);
    this.aes.destroy();
    if (this.decrypt) {
      if (!this.expected || !equalBytes(tag, this.expected)) throw new Error('authentication failed (wrong key or corrupted data)');
    } else this.tag = tag.slice();
    return new Uint8Array(0);
  }

  getTag() { if (!this.tag) throw new Error('call final() first'); return this.tag; }
  setTag(tag) { this.expected = toBytes(tag).slice(); return this; }
}

// --- one-shot helpers ---------------------------------------------------------------------------
// The one-shot GCM functions use the default 16-byte tag (sealed = ciphertext || tag, the WebCrypto / libsodium
// layout); other tag lengths need the streaming class.

const run = (c, data) => concatBytes(c.update(data), c.final());
export const aesEcbEncrypt = (key, data, { padding = false } = {}) => run(new AesEcb(key, { padding }), data);
export const aesEcbDecrypt = (key, data, { padding = false } = {}) => run(new AesEcb(key, { decrypt: true, padding }), data);
export const aesCbcEncrypt = (key, iv, data, { padding = true } = {}) => run(new AesCbc(key, iv, { padding }), data);
export const aesCbcDecrypt = (key, iv, data, { padding = true } = {}) => run(new AesCbc(key, iv, { decrypt: true, padding }), data);
export const aesCtr = (key, iv, data) => new AesCtr(key, iv).update(data);

export function aesGcmEncrypt(key, iv, plaintext, aad) {
  const g = new AesGcm(key, iv, { aad });
  const ct = g.update(plaintext);
  g.final();
  return concatBytes(ct, g.getTag());
}

export function aesGcmDecrypt(key, iv, sealed, aad) {
  const s = toBytes(sealed);
  if (s.length < 16) throw new Error('ciphertext too short');
  const g = new AesGcm(key, iv, { decrypt: true, aad }).setTag(s.subarray(s.length - 16));
  // The tag is checked before any plaintext is returned.
  // (Decrypt-then-verify internally, then the plaintext is wiped on failure: GCM's CTR part is cheap, and the caller
  // never sees unauthenticated bytes.)
  const pt = g.update(s.subarray(0, s.length - 16));
  try { g.final(); } catch (e) { wipe(pt); throw e; }
  return pt;
}
