// crypto/index.js - every public export of the crypto library in one place (bundles keep only what is used).
//
// Contract of the library (applies to every module re-exported here):
// - Pure JavaScript, no WebCrypto / node:crypto dependency except crypto.getRandomValues (random.js). Reason: the apps
//   run offline from file:// and must give bit-identical results in every engine; WebCrypto is async-only, missing
//   on insecure origins and lacks MD4, RIPEMD-160, BLAKE2, Argon2, scrypt, Salsa20, secp256k1.
// - Bytes in, Uint8Array out. Every input goes through encoding.toBytes (strings = UTF-8), so callers never pass a
//   string where bytes were meant by accident of encoding.
// - NOT constant time in general. JIT-compiled JS gives no timing guarantees; table-driven AES / GHASH and BigInt
//   secp256k1 leak through cache and operand-size timing. Fine for local tools (the attacker is not co-resident);
//   wrong for a server handling remote secrets. equalBytes is the one deliberately data-independent primitive.
// - Secrets are wiped (encoding.wipe) where the module owns the buffer; JS cannot wipe strings or GC copies, so this
//   is hygiene, not a guarantee.
// Named re-exports where a module also exports helpers meant for siblings only (hasher.js exports MDHasher,
// wordsBE...); `export *` where the whole module surface is public. secp256k1 is a namespace: its names (mod, pow,
// Point, CURVE) are too generic to flatten into the library scope.
export * from './encoding.js';
export { hasher } from './hasher.js';
export { md2 } from './md2.js';
export { md4 } from './md4.js';
export { md5 } from './md5.js';
export { sha1 } from './sha1.js';
export { sha224, sha256, sha384, sha512, sha512_224, sha512_256 } from './sha2.js';
export { keccak256, keccak512, keccakF1600, sha3_224, sha3_256, sha3_384, sha3_512, shake128, shake256 } from './sha3.js';
export { blake2b, blake2b256, blake2s, blake2sp } from './blake2.js';
export { ripemd160 } from './ripemd.js';
export { base58checkDecode, base58checkEncode } from './base58check.js';
export { adler32, crc32 } from './checksum.js';
export { hmac } from './hmac.js';
export { hkdf, hkdfExpand, hkdfExtract, nextTick, pbkdf2, pbkdf2Async, runAsync, runSync } from './kdf.js';
export { argon2Async, argon2d, argon2i, argon2id } from './argon2.js';
export { scrypt, scryptAsync } from './scrypt.js';
export * as secp256k1 from './secp256k1.js';
export * from './aes.js';
export * from './chacha.js';
export * from './salsa.js';
export * from './random.js';
export * from './password.js';
export * from './strength.js';
