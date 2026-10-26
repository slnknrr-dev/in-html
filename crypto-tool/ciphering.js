// crypto-tool/ciphering.js - every cipher and AEAD of the crypto library, declared through the DiscoverableCipher
// registry (cipher.js). Importing this module registers them (side effect at import time).
// 
// Shapes:
// - AEAD (GCM, ChaCha20-Poly1305): update = bytes -> detachTag(16) -> transform; finalize = verifyTag -> flush -> appendTag.
// - Block modes (CBC, ECB): padding flag and 16-byte block size declared on the engine step.
// - Stream ciphers (CTR, ChaCha20, Salsa20): no padding, no authentication; the same call encrypts and decrypts.
import { Cipher, DiscoverableCipher, getCiphers, getCipher, createCipher } from './cipher.js';
import { AesCbc, AesCtr, AesEcb, AesGcm } from '../crypto/aes.js';
import { ChaCha20, ChaCha20Poly1305 } from '../crypto/chacha.js';
import { Salsa20 } from '../crypto/salsa.js';

const aes_256_ctr =
  new DiscoverableCipher('aes-256-ctr', {
    label: 'AES-256-CTR', group: 'aes',
    initialize: [
      // use Cipher static methods as primitives
      Cipher.key(32), Cipher.iv(16), Cipher.engine((c) => new AesCtr(c.key, c.iv)),
    ],
    update: [
      Cipher.bytes, Cipher.transform,
    ],
    finalize: [
      Cipher.flush,
    ],
  });

// GCM accepts 12-byte nonces (recommended: no GHASH derivation of J0), plus 16 and 8 for interoperability.
for (const bits of [128, 192, 256]) {
  const k = bits / 8;
  new DiscoverableCipher(`aes-${bits}-gcm`, {
    label: `AES-${bits}-GCM`, group: 'aes', note: 'aead',
    initialize: [Cipher.key(k), Cipher.iv(12, 16, 8), Cipher.engine((c) => new AesGcm(c.key, c.iv, { decrypt: c.decrypt, aad: c.options.aad }))],
    update: [Cipher.bytes, Cipher.detachTag(16), Cipher.transform],
    finalize: [Cipher.verifyTag, Cipher.flush, Cipher.appendTag],
  });
  new DiscoverableCipher(`aes-${bits}-cbc`, {
    label: `AES-${bits}-CBC`, group: 'aes',
    initialize: [Cipher.key(k), Cipher.iv(16),
      Cipher.engine((c) => new AesCbc(c.key, c.iv, { decrypt: c.decrypt, padding: c.options.padding !== false }), { padding: true, blockSize: 16 })],
    update: [Cipher.bytes, Cipher.transform],
    finalize: [Cipher.flush],
  });
  if (bits !== 256) {
    new DiscoverableCipher(`aes-${bits}-ctr`, {
      label: `AES-${bits}-CTR`, group: 'aes',
      initialize: [Cipher.key(k), Cipher.iv(16), Cipher.engine((c) => new AesCtr(c.key, c.iv))],
      update: [Cipher.bytes, Cipher.transform],
      finalize: [Cipher.flush],
    });
  }
  // ECB is registered for interoperability and teaching only (the UI warns): identical plaintext blocks give identical ciphertext blocks.
  new DiscoverableCipher(`aes-${bits}-ecb`, {
    label: `AES-${bits}-ECB`, group: 'aes', note: 'ecb',
    initialize: [Cipher.key(k),
      Cipher.engine((c) => new AesEcb(c.key, { decrypt: c.decrypt, padding: c.options.padding !== false }), { padding: true, blockSize: 16 })],
    update: [Cipher.bytes, Cipher.transform],
    finalize: [Cipher.flush],
  });
}

new DiscoverableCipher('chacha20-poly1305', {
  label: 'ChaCha20-Poly1305', group: 'chacha', note: 'aead',
  initialize: [Cipher.key(32), Cipher.iv(12), Cipher.engine((c) => new ChaCha20Poly1305(c.key, c.iv, { decrypt: c.decrypt, aad: c.options.aad }))],
  update: [Cipher.bytes, Cipher.detachTag(16), Cipher.transform],
  finalize: [Cipher.verifyTag, Cipher.flush, Cipher.appendTag],
});

// XChaCha20: 24-byte nonce, large enough to be chosen at random for every message without birthday-bound worries (the container uses it by default).
new DiscoverableCipher('xchacha20-poly1305', {
  label: 'XChaCha20-Poly1305', group: 'chacha', note: 'aead',
  initialize: [Cipher.key(32), Cipher.iv(24), Cipher.engine((c) => new ChaCha20Poly1305(c.key, c.iv, { decrypt: c.decrypt, aad: c.options.aad }))],
  update: [Cipher.bytes, Cipher.detachTag(16), Cipher.transform],
  finalize: [Cipher.verifyTag, Cipher.flush, Cipher.appendTag],
});

// Plain stream ciphers (no authentication): the same call encrypts and decrypts. options.counter = first block.
for (const [id, label, ivs, make] of [
  ['chacha20', 'ChaCha20', [12, 8], (c) => new ChaCha20(c.key, c.iv, c.options.counter || 0)],
  ['xchacha20', 'XChaCha20', [24], (c) => new ChaCha20(c.key, c.iv, c.options.counter || 0)],
  ['salsa20', 'Salsa20', [8], (c) => new Salsa20(c.key, c.iv, c.options.counter || 0)],
  ['xsalsa20', 'XSalsa20', [24], (c) => new Salsa20(c.key, c.iv, c.options.counter || 0)],
]) {
  new DiscoverableCipher(id, {
    label, group: id.includes('salsa') ? 'salsa' : 'chacha',
    // Salsa20 also defines a 16-byte key variant ("expand 16-byte k"); the X-variants require 32.
    initialize: [Cipher.key(32, ...(id === 'salsa20' ? [16] : [])), Cipher.iv(...ivs), Cipher.engine(make)],
    update: [Cipher.bytes, Cipher.transform],
    finalize: [Cipher.flush],
  });
}

export { getCiphers, getCipher, createCipher };
