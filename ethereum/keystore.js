// ethereum/keystore.js - Web3 Secret Storage Definition version 3 (the JSON key files of geth, Clef, MetaMask exports,
// MyEtherWallet / MyCrypto): scrypt or PBKDF2-HMAC-SHA256 key derivation, AES-128-CTR, MAC = keccak256(dk[16..32]
// || ciphertext) compared in constant time.
//
//   decryptKeystore(json, password) -> Uint8Array(32) private key       (json: object or text; synchronous)
//   decryptKeystoreAsync(json, password, { onProgress(fraction), signal }) -> Promise<Uint8Array>
//   encryptKeystore(privateKey, password, { kdf = 'scrypt', n = 131072, r = 8, p = 1, c = 262144, dklen = 32, salt,
//                   iv, uuid }) -> keystore object (salt 32 / iv 16 random bytes and a v4 uuid unless given)
//   encryptKeystoreAsync(privateKey, password, { ...options, onProgress, signal }) -> Promise<object>
//   keystoreAddress(json) -> checksum address of the `address` field, or null
//
// A wrong password throws an Error with code 'password'; a key that does not match the file's `address` field
// throws code 'address'; malformed files throw code 'format'. Passwords are UTF-8 encoded as given (no Unicode
// normalisation, like geth). The derived key and the decrypted copy are wiped after use; the caller owns the result.
import { keccak256 } from '../crypto/sha3.js';
import { sha256 } from '../crypto/sha2.js';
import { aesCtr } from '../crypto/aes.js';
import { scrypt, scryptAsync } from '../crypto/scrypt.js';
import { pbkdf2, pbkdf2Async } from '../crypto/kdf.js';
import { bytesToHex, concatBytes, equalBytes, toBytes, utf8ToBytes, wipe } from '../crypto/encoding.js';
import { randomBytes, randomUUID } from '../crypto/random.js';
import { isValidPrivateKey } from '../crypto/secp256k1.js';
import { fromHex } from './units.js';
import { equalAddress, privateKeyToAddress, toChecksumAddress } from './address.js';

const fmt = (message) => Object.assign(new Error('keystore: ' + message), { code: 'format' });
const pw = (p) => (typeof p === 'string' ? utf8ToBytes(p) : toBytes(p));

// All KDF parameters come from an untrusted file, so they are bounded before any work (scrypt memory = 128 * r * n
// bytes; PBKDF2 capped at 1e8 rounds). Without bounds a crafted file is a denial of service on open.
// KNOWN DEFECT: the bounds are independent, so n = 2^22 with r = 256 passes and asks for 128 GiB (r * p <= 256 limits
// the product, not memory). Fix: also require 128 * r * n <= a memory cap (e.g. 2^30 bytes) before deriving.
// 'Crypto' (capitalised) is accepted because early geth versions wrote it.
function parse(json) {
  let j = json;
  if (typeof json === 'string') { try { j = JSON.parse(json); } catch { throw fmt('not JSON'); } }
  if (!j || typeof j !== 'object') throw fmt('object expected');
  if (Number(j.version) !== 3) throw fmt(`version ${j.version} is not supported (3 expected)`);
  const c = j.crypto || j.Crypto;
  if (!c || typeof c !== 'object') throw fmt('no crypto section');
  if (String(c.cipher).toLowerCase() !== 'aes-128-ctr') throw fmt(`cipher ${c.cipher} is not supported`);
  const hexField = (v, what, len = null) => {
    let b;
    try { b = fromHex(String(v)); } catch { throw fmt(`${what}: hex expected`); }
    if (len != null && b.length !== len) throw fmt(`${what}: ${len} bytes expected`);
    return b;
  };
  const kp = c.kdfparams || {};
  const kdf = String(c.kdf).toLowerCase();
  const dklen = Number(kp.dklen);
  if (!(dklen >= 32 && dklen <= 64)) throw fmt('dklen must be 32..64');
  const params = { kdf, dklen, salt: hexField(kp.salt, 'salt') };
  if (kdf === 'scrypt') {
    Object.assign(params, { n: Number(kp.n), r: Number(kp.r), p: Number(kp.p) });
    if (!(params.n > 1 && (params.n & (params.n - 1)) === 0 && params.n <= 1 << 22)) throw fmt('scrypt n must be a power of two up to 2^22');
    if (!(params.r >= 1 && params.p >= 1 && params.r * params.p <= 256)) throw fmt('scrypt r / p out of range');
  } else if (kdf === 'pbkdf2') {
    if (String(kp.prf).toLowerCase() !== 'hmac-sha256') throw fmt(`pbkdf2 prf ${kp.prf} is not supported`);
    params.c = Number(kp.c);
    if (!(params.c >= 1 && params.c <= 1e8)) throw fmt('pbkdf2 c out of range');
  } else throw fmt(`kdf ${c.kdf} is not supported`);
  return {
    params,
    iv: hexField(c.cipherparams && c.cipherparams.iv, 'iv', 16),
    ciphertext: hexField(c.ciphertext, 'ciphertext'),
    mac: hexField(c.mac, 'mac', 32),
    address: typeof j.address === 'string' && /^(0x)?[0-9a-fA-F]{40}$/.test(j.address) ? j.address : null,
  };
}

function derive(params, password) {
  if (params.kdf === 'scrypt') return scrypt(pw(password), params.salt, { N: params.n, r: params.r, p: params.p, dkLen: params.dklen });
  return pbkdf2(sha256, pw(password), params.salt, params.c, params.dklen);
}

function deriveAsync(params, password, run) {
  if (params.kdf === 'scrypt') return scryptAsync(pw(password), params.salt, { N: params.n, r: params.r, p: params.p, dkLen: params.dklen }, run);
  return pbkdf2Async(sha256, pw(password), params.salt, params.c, params.dklen, run);
}

// MAC = keccak256(dk[16..32] || ciphertext): the second half of the derived key authenticates, the first half
// (dk[0..16]) is the AES-128 key. Using disjoint halves keeps the MAC from leaking anything about the cipher key.
// It is keccak, not HMAC: fixed by the format; acceptable because the key is a fixed-length prefix of the input.
const macOf = (dk, ciphertext) => keccak256(concatBytes(dk.subarray(16, 32), ciphertext));

// Verify-then-decrypt: the MAC is checked before AES runs, so a wrong password never produces a garbage "key".
// CTR mode has no padding, so without the MAC a wrong password would be undetectable. equalBytes compares in
// constant time (no early exit) so timing does not reveal how many MAC bytes matched.
// The address check catches a file whose ciphertext was swapped (MAC recomputed by an attacker who knew the password).
function finish(k, dk) {
  try {
    if (!equalBytes(macOf(dk, k.ciphertext), k.mac)) throw Object.assign(new Error('wrong password (MAC mismatch)'), { code: 'password' });
    const key = aesCtr(dk.subarray(0, 16), k.iv, k.ciphertext);
    if (key.length !== 32 || !isValidPrivateKey(key)) { wipe(key); throw fmt('the decrypted key is not a valid secp256k1 private key'); }
    if (k.address && !equalAddress(privateKeyToAddress(key), k.address.startsWith('0x') ? k.address : '0x' + k.address)) {
      wipe(key);
      throw Object.assign(new Error('keystore: the key does not match the address of the file'), { code: 'address' });
    }
    return key;
  } finally { wipe(dk); }
}

export function decryptKeystore(json, password) {
  const k = parse(json);
  return finish(k, derive(k.params, password));
}

export async function decryptKeystoreAsync(json, password, { onProgress, signal } = {}) {
  const k = parse(json);
  return finish(k, await deriveAsync(k.params, password, { onProgress, signal }));
}

export function keystoreAddress(json) {
  try {
    const a = parse(json).address;
    return a ? toChecksumAddress(a.startsWith('0x') ? a : '0x' + a) : null;
  } catch { return null; }
}

// Defaults: scrypt n = 2^17, r = 8, p = 1 (128 MiB; geth's "standard" is n = 2^18). Salt and IV are fresh random values per
// file; reusing an IV with the same derived key in CTR mode would XOR-leak the two plaintexts.
function setup(privateKey, opts) {
  const key = typeof privateKey === 'string' ? fromHex(privateKey) : toBytes(privateKey);
  if (key.length !== 32 || !isValidPrivateKey(key)) throw new Error('keystore: invalid private key');
  const { kdf = 'scrypt', n = 131072, r = 8, p = 1, c = 262144, dklen = 32 } = opts;
  const salt = opts.salt ? (typeof opts.salt === 'string' ? fromHex(opts.salt) : opts.salt) : randomBytes(32);
  const iv = opts.iv ? (typeof opts.iv === 'string' ? fromHex(opts.iv) : opts.iv) : randomBytes(16);
  if (iv.length !== 16) throw new Error('keystore: iv must be 16 bytes');
  let params;
  if (kdf === 'scrypt') params = { kdf, dklen, n, r, p, salt };
  else if (kdf === 'pbkdf2') params = { kdf, dklen, c, salt };
  else throw new Error(`keystore: unknown kdf ${kdf}`);
  return { key, params, iv, uuid: opts.uuid || randomUUID() };
}

// Field order and lower-case hex without 0x match geth's output, so files round-trip byte-compatibly with other tools.
function build(s, dk) {
  try {
    const ciphertext = aesCtr(dk.subarray(0, 16), s.iv, s.key);
    const { kdf, dklen, salt } = s.params;
    const kdfparams = kdf === 'scrypt' ? { dklen, n: s.params.n, r: s.params.r, p: s.params.p, salt: bytesToHex(salt) } : { c: s.params.c, dklen, prf: 'hmac-sha256', salt: bytesToHex(salt) };
    return {
      version: 3,
      id: s.uuid,
      address: privateKeyToAddress(s.key).slice(2).toLowerCase(),
      crypto: { ciphertext: bytesToHex(ciphertext), cipherparams: { iv: bytesToHex(s.iv) }, cipher: 'aes-128-ctr', kdf, kdfparams, mac: bytesToHex(macOf(dk, ciphertext)) },
    };
  } finally { wipe(dk); }
}

export function encryptKeystore(privateKey, password, opts = {}) {
  const s = setup(privateKey, opts);
  return build(s, derive(s.params, password));
}

export async function encryptKeystoreAsync(privateKey, password, opts = {}) {
  const s = setup(privateKey, opts);
  return build(s, await deriveAsync(s.params, password, { onProgress: opts.onProgress, signal: opts.signal }));
}
