// crypto-tool/hashing.js - every hash, MAC, checksum and key derivation function of the crypto library, declared
// through the DiscoverableHash registry (hash.js). Importing this module registers them (side effect at import time).
// Notes (note: 'broken', 'noncrypto', 'onetime', 'nopassword') become UI warnings next to the algorithm.
import { Hash, DiscoverableHash, getHashes, getHash, createHash } from './hash.js';
import { md2 } from '../crypto/md2.js';
import { md4 } from '../crypto/md4.js';
import { md5 } from '../crypto/md5.js';
import { sha1 } from '../crypto/sha1.js';
import { sha224, sha256, sha384, sha512, sha512_224, sha512_256 } from '../crypto/sha2.js';
import { keccak256, keccak512, sha3_224, sha3_256, sha3_384, sha3_512, shake128, shake256 } from '../crypto/sha3.js';
import { blake2b, blake2s } from '../crypto/blake2.js';
import { ripemd160 } from '../crypto/ripemd.js';
import { adler32, crc32 } from '../crypto/checksum.js';
import { Poly1305 } from '../crypto/chacha.js';
import { hkdf, pbkdf2Async } from '../crypto/kdf.js';
import { argon2Async } from '../crypto/argon2.js';
import { scryptAsync } from '../crypto/scrypt.js';
import { toBytes } from '../crypto/encoding.js';

// The canonical shape: initialize the engine (HMAC when the options carry a key), absorb bytes, squeeze the digest.
const sha_256 =
  new DiscoverableHash('sha-256', {
    label: 'SHA-256', group: 'sha2',
    initialize: [
      Hash.engine(sha256), Hash.hmac(sha256),
    ],
    update: [
      Hash.bytes, Hash.absorb,
    ],
    finalize: [
      Hash.squeeze,
    ],
  });

// The same shape for the other plain hashes.
const plain = (id, fn, label, group, note) => new DiscoverableHash(id, {
  label, group, note,
  initialize: [Hash.engine(fn), Hash.hmac(fn)],
  update: [Hash.bytes, Hash.absorb],
  finalize: [Hash.squeeze],
});

// MD2/MD4/MD5/SHA-1 are kept for verifying legacy checksums; collisions are practical, so they are tagged broken.
plain('md2', md2, 'MD2', 'legacy', 'broken');
plain('md4', md4, 'MD4', 'legacy', 'broken');
plain('md5', md5, 'MD5', 'legacy', 'broken');
plain('sha-1', sha1, 'SHA-1', 'legacy', 'broken');
plain('ripemd-160', ripemd160, 'RIPEMD-160', 'legacy');
plain('sha-224', sha224, 'SHA-224', 'sha2');
plain('sha-384', sha384, 'SHA-384', 'sha2');
plain('sha-512', sha512, 'SHA-512', 'sha2');
plain('sha-512/224', sha512_224, 'SHA-512/224', 'sha2');
plain('sha-512/256', sha512_256, 'SHA-512/256', 'sha2');
plain('sha3-224', sha3_224, 'SHA3-224', 'sha3');
plain('sha3-256', sha3_256, 'SHA3-256', 'sha3');
plain('sha3-384', sha3_384, 'SHA3-384', 'sha3');
plain('sha3-512', sha3_512, 'SHA3-512', 'sha3');
plain('keccak-256', keccak256, 'Keccak-256', 'sha3');
plain('keccak-512', keccak512, 'Keccak-512', 'sha3');

// Extendable output: the length comes from the options ({ dkLen }), no HMAC.
// No HMAC for XOFs: KMAC would be the keyed form, not implemented here.
for (const [id, fn, label] of [['shake128', shake128, 'SHAKE128'], ['shake256', shake256, 'SHAKE256']]) {
  new DiscoverableHash(id, {
    label, group: 'sha3',
    initialize: [Hash.engine(fn)],
    update: [Hash.bytes, Hash.absorb],
    finalize: [Hash.squeeze],
  });
}

// BLAKE2 has its own keyed mode (a MAC without HMAC's double hashing).
for (const [id, fn, dkLen, maxKey, label] of [['blake2b-512', blake2b, 64, 64, 'BLAKE2b-512'], ['blake2b-256', blake2b, 32, 64, 'BLAKE2b-256'],
  ['blake2s-256', blake2s, 32, 32, 'BLAKE2s-256']]) {
  new DiscoverableHash(id, {
    label, group: 'blake2',
    initialize: [Hash.keyedEngine(fn, { dkLen, maxKey })],
    update: [Hash.bytes, Hash.absorb],
    finalize: [Hash.squeeze],
  });
}

for (const [id, fn, label] of [['crc-32', crc32, 'CRC-32'], ['adler-32', adler32, 'Adler-32']]) {
  new DiscoverableHash(id, {
    label, group: 'checksum', note: 'noncrypto',
    initialize: [Hash.engine(fn)],
    update: [Hash.bytes, Hash.absorb],
    finalize: [Hash.squeeze],
  });
}

new DiscoverableHash('poly1305', {
  label: 'Poly1305', group: 'mac', note: 'onetime',
  initialize: [Hash.mac((key) => new Poly1305(key), 32)],
  update: [Hash.bytes, Hash.absorb],
  finalize: [Hash.squeeze],
});

// Key derivation: the input (password) is collected, the KDF runs at the end with { salt, dkLen, ... } options and
// reports progress through options.onProgress; options.signal aborts.
const run = (o) => ({ onProgress: o.onProgress, signal: o.signal });
const salt = (o) => toBytes(o.salt || new Uint8Array(0));

// Argon2 defaults t=3, m=64 MiB, p=4 (RFC 9106 second recommended option for memory-constrained use).
for (const type of ['argon2id', 'argon2i', 'argon2d']) {
  new DiscoverableHash(type, {
    label: type === 'argon2id' ? 'Argon2id' : type === 'argon2i' ? 'Argon2i' : 'Argon2d', group: 'kdf',
    initialize: [],
    update: [Hash.bytes, Hash.collect],
    finalize: [Hash.derive((pw, o) => argon2Async(type, pw, salt(o), { t: o.t, m: o.m, p: o.p, dkLen: o.dkLen, secret: o.secret, ad: o.ad }, run(o)),
      { t: 3, m: 65536, p: 4, dkLen: 32 })],
  });
}

// scrypt defaults N=2^14, r=8, p=1: the classic interactive-login parameters.
new DiscoverableHash('scrypt', {
  label: 'scrypt', group: 'kdf',
  initialize: [],
  update: [Hash.bytes, Hash.collect],
  finalize: [Hash.derive((pw, o) => scryptAsync(pw, salt(o), { N: o.N, r: o.r, p: o.p, dkLen: o.dkLen }, run(o)), { N: 16384, r: 8, p: 1, dkLen: 32 })],
});

// Default iterations: SHA-256 600 000 and SHA-512 210 000 match OWASP 2023 (crypto/kdf.js); SHA-1 100 000 is a
// compatibility default, far below the OWASP figure for SHA-1 (1 300 000).
for (const [id, fn, label, iterations] of [['pbkdf2-sha256', sha256, 'PBKDF2-HMAC-SHA256', 600000], ['pbkdf2-sha512', sha512, 'PBKDF2-HMAC-SHA512', 210000],
  ['pbkdf2-sha1', sha1, 'PBKDF2-HMAC-SHA1', 100000]]) {
  new DiscoverableHash(id, {
    label, group: 'kdf',
    initialize: [],
    update: [Hash.bytes, Hash.collect],
    finalize: [Hash.derive((pw, o) => pbkdf2Async(fn, pw, salt(o), o.iterations, o.dkLen, run(o)), { iterations, dkLen: 32 })],
  });
}

// HKDF expands high-entropy key material; it is not a password hash (no work factor), hence the "nopassword" note.
for (const [id, fn, label] of [['hkdf-sha256', sha256, 'HKDF-SHA256'], ['hkdf-sha512', sha512, 'HKDF-SHA512']]) {
  new DiscoverableHash(id, {
    label, group: 'kdf', note: 'nopassword',
    initialize: [],
    update: [Hash.bytes, Hash.collect],
    finalize: [Hash.derive((ikm, o) => hkdf(fn, ikm, salt(o), toBytes(o.info || ''), o.dkLen), { dkLen: 32 })],
  });
}

export { getHashes, getHash, createHash };
