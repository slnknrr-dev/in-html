// archive/rarcrypt.js - RAR encryption: key derivation, password checks, checksum MACs and decrypting streams.
//
//   rar3Key(password, salt8 | null) -> { key, iv }       RAR 2.9-4.x: AES-128-CBC; SHA-1 over 0x40000 rounds of
//                                                         UTF-16LE password + salt + 3-byte round number
//   rar5Keys(password, salt16, lg2) -> { key, hashKey, check }   RAR 5: PBKDF2-HMAC-SHA256 with 2^lg2 iterations
//                                                         (key, AES-256), +16 more (hash key), +32 more (password
//                                                         check value, folded to 8 bytes)
//   rar5CheckSum(check8) -> 4 bytes (the stored checksum of the check value), rar5MacCrc(hashKey, crc) -> uint32,
//   rar5MacDigest(hashKey, digest32) -> 32 bytes        checksums of encrypted RAR 5 files when the MAC flag is set
//   cbcStream(stream, key, iv) -> Stream                 AES-CBC decryption of whole 16-byte blocks
//   rar15Stream(stream, password), rar13Stream(stream, password | null)   RAR 1.5 / 1.3 ciphers (null: the fixed
//                                                         key of packed RAR 1.4 archive comments)
// The key derivations are cached per (password, salt): encrypted RAR 3 headers repeat the salt.

import { crc32 } from '../codec/crc32.js';
import { AesCbc } from '../crypto/aes.js';
import { hmac } from '../crypto/hmac.js';
import { sha256 } from '../crypto/sha2.js';

// Derived keys cached (FIFO, 65 entries) because a RAR 3 archive with encrypted headers derives with the same salt
// for every header, and each derivation costs ~0.1 s. Trade-off: keys stay in memory keyed by the plaintext password
// for the page's lifetime; acceptable for a client-side extractor, not for a long-lived shared server process.
const CACHE = new Map();
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
function cached(key, make) {
  let v = CACHE.get(key);
  if (!v) {
    v = make();
    if (CACHE.size > 64) CACHE.delete(CACHE.keys().next().value);
    CACHE.set(key, v);
  }
  return v;
}

// --- RAR 3 ---------------------------------------------------------------------------------------------------

// SHA-1 with the quirk of RAR 2.9's implementation: 64-byte blocks hashed straight from the caller's buffer leave
// their expanded message words (W[64..79], little-endian) in that buffer. The key derivation hashes the same
// password buffer 0x40000 times, so passwords of 28+ characters (buffer >= 64 bytes) depend on it.
// Why not WebCrypto: it is async (0x40000 awaited digests would take minutes), and it cannot reproduce the quirk.
class Sha1Rar {
  constructor() {
    this.h = new Int32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]);
    this.w = new Int32Array(80);
    this.buf = new Uint8Array(64);
    this.n = 0;
  }

  block(b, o) {
    const w = this.w, h = this.h;
    for (let i = 0; i < 16; i++, o += 4) w[i] = (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
    for (let i = 16; i < 80; i++) { const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
    let a = h[0], bb = h[1], c = h[2], d = h[3], e = h[4], t = 0;
    for (let i = 0; i < 20; i++) {
      t = (((a << 5) | (a >>> 27)) + ((bb & c) | (~bb & d)) + e + 0x5a827999 + w[i]) | 0;
      e = d; d = c; c = (bb << 30) | (bb >>> 2); bb = a; a = t;
    }
    for (let i = 20; i < 40; i++) {
      t = (((a << 5) | (a >>> 27)) + (bb ^ c ^ d) + e + 0x6ed9eba1 + w[i]) | 0;
      e = d; d = c; c = (bb << 30) | (bb >>> 2); bb = a; a = t;
    }
    for (let i = 40; i < 60; i++) {
      t = (((a << 5) | (a >>> 27)) + ((bb & c) | (bb & d) | (c & d)) + e + 0x8f1bbcdc + w[i]) | 0;
      e = d; d = c; c = (bb << 30) | (bb >>> 2); bb = a; a = t;
    }
    for (let i = 60; i < 80; i++) {
      t = (((a << 5) | (a >>> 27)) + (bb ^ c ^ d) + e + 0xca62c1d6 + w[i]) | 0;
      e = d; d = c; c = (bb << 30) | (bb >>> 2); bb = a; a = t;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + bb) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0; h[4] = (h[4] + e) | 0;
  }

  // The derivation calls this 2 * 0x40000 times with a few bytes: plain loops instead of subarray copies.
  update(d, quirk = false) {
    const n = d.length, buf = this.buf;
    let j = this.n & 63, i = 0;
    this.n += n;
    if (j + n > 63) {
      i = 64 - j;
      for (let k = 0; k < i; k++) buf[j + k] = d[k];
      this.block(buf, 0);
      for (; i + 63 < n; i += 64) {
        this.block(d, i);
        if (quirk) {
          for (let k = 0; k < 16; k++) {
            const v = this.w[64 + k], o = i + 4 * k;
            d[o] = v; d[o + 1] = v >>> 8; d[o + 2] = v >>> 16; d[o + 3] = v >>> 24;
          }
        }
      }
      j = 0;
    }
    for (let k = i; k < n; k++) buf[j++] = d[k];
  }

  // Digest of a copy (the derivation keeps hashing after taking the IV bytes).
  digest() {
    const c = new Sha1Rar();
    c.h.set(this.h);
    c.buf.set(this.buf);
    c.n = this.n;
    const bits = this.n * 8, pad = new Uint8Array(((this.n + 8) & ~63) + 64 - this.n);
    pad[0] = 0x80;
    const e = pad.length;
    for (let i = 0; i < 4; i++) pad[e - 1 - i] = (bits >>> (8 * i)) & 0xff;
    const hi = Math.floor(bits / 4294967296);
    for (let i = 0; i < 4; i++) pad[e - 5 - i] = (hi >>> (8 * i)) & 0xff;
    c.update(pad);
    const out = new Uint8Array(20);
    for (let i = 0; i < 20; i++) out[i] = c.h[i >> 2] >>> (24 - 8 * (i & 3));
    return out;
  }
}

function utf16le(s) {
  const out = new Uint8Array(2 * s.length);
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out[2 * i] = c; out[2 * i + 1] = c >>> 8; }
  return out;
}

export function rar3Key(password, salt) {
  return cached('3\0' + password + '\0' + (salt ? hex(salt) : '-'), () => {
    const pw = utf16le(password);
    const raw = new Uint8Array(pw.length + (salt ? 8 : 0));
    raw.set(pw);
    if (salt) raw.set(salt.subarray(0, 8), pw.length);
    const sha = new Sha1Rar(), num = new Uint8Array(3), iv = new Uint8Array(16);
    const ROUNDS = 0x40000; // about 0.1 s in V8 for a short password (SHA-1 bound)
    for (let i = 0; i < ROUNDS; i++) {
      sha.update(raw, true);
      num[0] = i; num[1] = i >>> 8; num[2] = i >>> 16;
      sha.update(num);
      // IV byte k is the last byte of the running digest at round k * 0x4000 (16 samples over 0x40000 rounds); digest()
      // works on a copy so the running hash continues unaffected.
      if ((i & 0x3fff) === 0) iv[i >>> 14] = sha.digest()[19];
    }
    const d = sha.digest(), key = new Uint8Array(16);
    // The key takes the digest words least significant byte first.
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) key[4 * i + j] = d[4 * i + 3 - j];
    return { key, iv };
  });
}

// --- RAR 5 ---------------------------------------------------------------------------------------------------

export function rar5Keys(password, salt, lg2) {
  return cached('5\0' + password + '\0' + hex(salt) + '\0' + lg2, () => {
    // PBKDF2-HMAC-SHA256 (RFC 8018) written out instead of WebCrypto deriveBits so all three outputs come from ONE
    // iteration chain: RAR 5 continues the same U_j sequence for 16 and then 32 more rounds to get the hash key and the
    // password check, which three independent PBKDF2 calls cannot express without recomputing 2^lg2 rounds each time.
    // The inner / outer HMAC states are precomputed once and restored per round (saves two compressions per round).
    const prf = hmac.create(sha256, new TextEncoder().encode(password));
    const inner = prf.inner.clone(), outer = prf.outer.clone();
    let u = prf.clone().update(salt).update(new Uint8Array([0, 0, 0, 1])).digest();
    const t = u.slice(), out = [];
    for (const n of [2 ** lg2 - 1, 16, 16]) {
      for (let j = 0; j < n; j++) {
        u = outer.restoreFrom(prf.outer).update(inner.restoreFrom(prf.inner).update(u).digest()).digest();
        for (let k = 0; k < 32; k++) t[k] ^= u[k];
      }
      out.push(t.slice());
    }
    const check = new Uint8Array(8);
    for (let i = 0; i < 32; i++) check[i & 7] ^= out[2][i];
    return { key: out[0], hashKey: out[1], check };
  });
}

export const rar5CheckSum = (check) => sha256(check).subarray(0, 4);

export function rar5MacCrc(hashKey, crc) {
  const d = hmac(sha256, hashKey, new Uint8Array([crc, crc >>> 8, crc >>> 16, crc >>> 24]));
  let v = 0;
  for (let i = 0; i < 32; i++) v ^= d[i] << ((i & 3) * 8);
  return v >>> 0;
}

export const rar5MacDigest = (hashKey, digest) => hmac(sha256, hashKey, digest);

// --- streams -------------------------------------------------------------------------------------------------

// No padding removal: RAR stores the unpacked size, and the decoder stops there, so trailing pad bytes are never read.
// AesCbc buffers a partial block between reads, hence the loop until a non-empty output or the end.
export function cbcStream(stream, key, iv) {
  const c = new AesCbc(key, iv, { decrypt: true, padding: false });
  let done = false;
  return {
    size: stream.size,
    read(max) {
      while (!done) {
        const b = stream.read(max);
        if (!b) { done = true; break; }
        const out = c.update(b);
        if (out.length) return out;
      }
      return null;
    },
  };
}

// Byte-wise ciphers as stream transforms (the input views are never modified).
// The output buffer is reused between reads: a consumer must use (or copy) each chunk before the next read(), which is
// the Stream contract of io.js decoders.
function byteStream(stream, step) {
  let out = new Uint8Array(0);
  return {
    size: stream.size,
    read(max) {
      const b = stream.read(max);
      if (!b) return null;
      if (out.length < b.length) out = new Uint8Array(b.length);
      const o = out.subarray(0, b.length);
      for (let i = 0; i < b.length; i++) o[i] = step(b[i]);
      return o;
    },
  };
}

let CRC_TABLE = null;
function crcTable() {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  return CRC_TABLE;
}

const ansi = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

/** RAR 1.5 cipher: four 16-bit keys seeded with the password's CRC, stepped through the CRC table. */
export function rar15Stream(stream, password) {
  const T = crcTable(), pw = ansi(password);
  const crc = ~crc32(pw) >>> 0; // unrar keeps the CRC register without the final inversion
  let k0 = crc & 0xffff, k1 = crc >>> 16, k2 = 0, k3 = 0;
  for (const p of pw) {
    k2 = (k2 ^ p ^ T[p]) & 0xffff;
    k3 = (k3 + p + (T[p] >>> 16)) & 0xffff;
  }
  const ror = (x) => ((x >>> 1) | (x << 15)) & 0xffff;
  return byteStream(stream, (b) => {
    k0 = (k0 + 0x1234) & 0xffff;
    const t = T[(k0 & 0x1fe) >>> 1];
    k1 = (k1 ^ t) & 0xffff;
    k2 = (k2 - (t >>> 16)) & 0xffff;
    k0 ^= k2;
    k3 = ror(ror(k3) ^ k1);
    k0 ^= k3;
    return b ^ (k0 >>> 8);
  });
}

/** RAR 1.3 cipher (three byte keys); `password` null = the fixed key of packed RAR 1.4 comments. */
export function rar13Stream(stream, password) {
  let k0 = 0, k1 = 7, k2 = 77;
  if (password != null) {
    k0 = k1 = k2 = 0;
    for (const p of ansi(password)) {
      k0 = (k0 + p) & 0xff;
      k1 ^= p;
      k2 = (k2 + p) & 0xff;
      k2 = ((k2 << 1) | (k2 >>> 7)) & 0xff;
    }
  }
  return byteStream(stream, (b) => {
    k1 = (k1 + k2) & 0xff;
    k0 = (k0 + k1) & 0xff;
    return (b - k0) & 0xff;
  });
}
