// zip/crypt.js - ZIP encryption, decrypting side: traditional PKWARE encryption ("ZipCrypto", APPNOTE 6.1) and
// WinZip AES (AE-1 / AE-2: PBKDF2-HMAC-SHA1 with 1000 rounds, AES-CTR with a little-endian counter, HMAC-SHA1 tag).
//
//   new ZipCrypto(passwordBytes)  .header(bytes12) -> the last decrypted header byte (check against the CRC's high
//                                 byte, or the DOS time's when bit 3 is set); .decrypt(chunk) -> new plain bytes
//   aesKeys(password, salt, strength) -> { key, macKey, verifier }   strength 1 / 2 / 3 = AES-128 / 192 / 256
//   new WinZipAes(key, macKey)    .decrypt(chunk) -> plain bytes; .tag() -> the 10-byte authentication code
//   AES_SALT = { 1: 8, 2: 12, 3: 16 }
//
// Decrypt-only by design: ZipCrypto is broken (known-plaintext attack with 12 bytes recovers the keys), so this
// library never produces it; it exists to open legacy archives. WinZip AES is the format to write, elsewhere.
// Both classes are incremental (decrypt(chunk) keeps state) so multi-gigabyte entries stream through in slices.

import { AES } from '../crypto/aes.js';
import { hmac } from '../crypto/hmac.js';
import { pbkdf2 } from '../crypto/kdf.js';
import { sha1 } from '../crypto/sha1.js';

// CRC-32 table (reflected polynomial 0xEDB88320), built lazily on first use: ZipCrypto's key schedule is defined in
// terms of the CRC step, so the same table drives update().
let T = null;
function table() {
  if (T) return T;
  T = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c; }
  return T;
}

export class ZipCrypto {
  constructor(password) {
    this.t = table();
    this.k0 = 0x12345678; this.k1 = 0x23456789; this.k2 = 0x34567890;
    for (const c of password) this.update(c);
  }

  // APPNOTE 6.1.5 key update. Math.imul + |0 reproduce 32-bit wrap-around multiplication exactly; a plain '*' would
  // exceed 2^53 and lose low bits, silently producing wrong keys.
  update(c) {
    const t = this.t;
    this.k0 = (this.k0 >>> 8) ^ t[(this.k0 ^ c) & 255];
    this.k1 = (Math.imul((this.k1 + (this.k0 & 255)) | 0, 134775813) + 1) | 0;
    this.k2 = (this.k2 >>> 8) ^ t[(this.k2 ^ (this.k1 >>> 24)) & 255];
  }

  decrypt(chunk) {
    const out = new Uint8Array(chunk.length);
    for (let i = 0; i < chunk.length; i++) {
      const tmp = (this.k2 | 2) & 0xffff;
      const p = chunk[i] ^ ((Math.imul(tmp, tmp ^ 1) >>> 8) & 255);
      out[i] = p;
      this.update(p);
    }
    return out;
  }

  // The 12-byte encryption header is random except its last byte, a check value; a mismatch rejects a wrong password
  // with probability 255/256 only, so callers must still verify the CRC after decryption.
  header(h) { const d = this.decrypt(h); return d[11]; }
}

export const AES_SALT = { 1: 8, 2: 12, 3: 16 };

// One PBKDF2 run yields key | macKey | 2-byte password verifier, as the WinZip spec lays them out. 1000 iterations is
// fixed by the format (weak by today's standards, but changing it would break compatibility).
export function aesKeys(password, salt, strength) {
  const n = { 1: 16, 2: 24, 3: 32 }[strength];
  if (!n) throw new Error('bad WinZip AES strength ' + strength);
  const dk = pbkdf2(sha1, password, salt, 1000, 2 * n + 2);
  return { key: dk.slice(0, n), macKey: dk.slice(n, 2 * n), verifier: dk.slice(2 * n) };
}

export class WinZipAes {
  constructor(key, macKey) {
    this.aes = new AES(key);
    this.mac = hmac.create(sha1, macKey);
    this.ctr = new Uint8Array(16);
    this.ks = new Uint8Array(16);
    this.used = 16;
  }

  decrypt(chunk) {
    // Encrypt-then-MAC: the HMAC covers the ciphertext, so it is updated with the input before decryption.
    // CTR mode: keystream = AES(counter), counter little-endian starting at 1 (WinZip's choice, unlike NIST CTR's
    // big-endian). The tag must be compared by the caller after the last chunk; data is unauthenticated until then.
    this.mac.update(chunk);
    const out = new Uint8Array(chunk.length);
    const ctr = this.ctr, ks = this.ks;
    for (let i = 0; i < chunk.length; i++) {
      if (this.used === 16) {
        for (let k = 0; k < 16; k++) if (++ctr[k] !== 256) break; else ctr[k] = 0; // little-endian counter from 1
        this.aes.encryptBlock(ctr, ks);
        this.used = 0;
      }
      out[i] = chunk[i] ^ ks[this.used++];
    }
    return out;
  }

  tag() { return this.mac.digest().subarray(0, 10); }
}
