// crypto/hmac.js - HMAC (RFC 2104) over any block hash of the library: hmac(hashFn, key, data) -> tag;
// hmac.create(hashFn, key) -> streaming { update, digest, clone }.
//
// HMAC(K, m) = H((K' ^ opad) || H((K' ^ ipad) || m)), K' = K zero-padded to the block length (hashed first when
// longer). Both padded keys are absorbed once in the constructor; the keyed inner / outer states are kept, so
// clone() is the cheap way to MAC many messages under one key (PBKDF2 does exactly that, kdf.js).
// Tag comparison is NOT done here: callers compare with encoding.equalBytes (constant time), never with ===.
import { toBytes, wipe } from './encoding.js';

class HMAC {
  constructor(hashFn, key) {
    // Refuse XOFs (SHAKE: KMAC is the keyed construction for them) and checksums (CRC is linear: an "HMAC-CRC32"
    // would be forgeable). Fail at construction, not with a wrong tag later.
    if (!hashFn || !hashFn.create || hashFn.xof || hashFn.checksum) throw new Error('HMAC needs a block hash function');
    const bl = hashFn.blockLen;
    let k = toBytes(key);
    // RFC 2104: keys longer than B are replaced by H(K). Consequence: K and H(K) give the same MAC (a known, harmless
    // HMAC property); keys shorter than B are only padded, never hashed.
    if (k.length > bl) k = hashFn(k);
    const pad = new Uint8Array(bl);
    pad.set(k);
    for (let i = 0; i < bl; i++) pad[i] ^= 0x36;
    this.inner = hashFn.create().update(pad);
    // Turn ipad into opad in place (x ^ 0x36 ^ 0x36 ^ 0x5c = x ^ 0x5c): one buffer, wiped once below.
    for (let i = 0; i < bl; i++) pad[i] ^= 0x36 ^ 0x5c;
    this.outer = hashFn.create().update(pad);
    // The padded key is wiped; the caller's key buffer is theirs to wipe, and a hashed long key `k` is not wiped
    // (minor: it is H(K), and the keyed hash states hold equivalent secrets for the object's lifetime anyway).
    wipe(pad);
    this.blockLen = bl;
    this.outputLen = hashFn.outputLen;
  }

  update(data) { this.inner.update(data); return this; }

  // Single use: the inner and outer hashes reject a second digest() ("digest already computed"). Clone before
  // digest to continue from the same keyed state.
  digest() { return this.outer.update(this.inner.digest()).digest(); }

  // Object.create + assign instead of the constructor: re-running it would re-absorb the key (two compressions);
  // copying the keyed states costs only array copies.
  clone() {
    const c = Object.create(HMAC.prototype);
    Object.assign(c, this, { inner: this.inner.clone(), outer: this.outer.clone() });
    return c;
  }
}

export function hmac(hashFn, key, data) { return new HMAC(hashFn, key).update(data).digest(); }
hmac.create = (hashFn, key) => new HMAC(hashFn, key);
