// kdbx/format.js - the outer KDBX format: signatures and header fields (KDBX 3.1 and 4.x), key transformation (AES-KDF,
// Argon2d / Argon2id), payload encryption (AES-256-CBC, ChaCha20), the hashed block stream of KDBX 3 and the
// HMAC-SHA-256 block stream of KDBX 4, gzip, and the KDBX 4 inner header (inner stream, binaries).
//
//   loadKdbx(bytes, credentials, { onProgress({ phase, fraction }), signal, deriveKey }) -> Promise<KdbxDatabase>
//   saveKdbx(db, { onProgress, signal, deriveKey }) -> Promise<Uint8Array>   (always KDBX 4.0 or 4.1)
//   transformKey(composite, kdf, run), aesKdfHalf(seed, half, rounds, run), aesKdfFinish(lo, hi): the key derivation
//   (deriveKey replaces transformKey, e.g. to run it in Workers; no time limit)
//   readHeader(bytes) -> { major, minor, fields, kdf, cipher, ... } without decrypting
import { Reader, VD, Writer, readVariantDictionary, uuidString, writeVariantDictionary } from './bytes.js';
import { KdbxBinary, KdbxDatabase } from './model.js';
import { INNER_STREAM, createInnerStream } from './protect.js';
import { readDocument, writeDocument } from './document.js';
import { sha256, sha512 } from '../crypto/sha2.js';
import { hmac } from '../crypto/hmac.js';
import { AES, AesCbc } from '../crypto/aes.js';
import { ChaCha20 } from '../crypto/chacha.js';
import { argon2Async } from '../crypto/argon2.js';
import { nextTick } from '../crypto/kdf.js';
import { bytesToUtf8, concatBytes, equalBytes, hexToBytes, utf8ToBytes, wipe, writeU32LE, writeU64LE } from '../crypto/encoding.js';
import { randomBytes } from '../crypto/random.js';
import { compress, decompress } from '../codec/deflate.js';
//
// Integrity model, which dictates the read order below:
//   KDBX 4: header SHA-256 (detects corruption before the slow KDF) -> KDF -> header HMAC (proves the key: a wrong
//           password fails HERE, authenticated, before any decryption) -> per-block HMAC (encrypt-then-MAC: no
//           ciphertext is decrypted unless authenticated) -> decrypt -> gunzip -> inner header -> XML.
//   KDBX 3: KDF -> decrypt -> compare the first 32 plaintext bytes with StreamStartBytes (the only key check, and it
//           happens after decryption: no MAC, so CBC padding errors are also reported as "wrong key") -> SHA-256
//           hashed blocks (integrity, not authenticity).
// Writing always produces KDBX 4: the KDBX 3 format has no authenticated encryption, so down-level saving would be
// a security regression for the user.
// Error vocabulary is a small closed set (KdbxError.code) so the UI can localise messages without parsing strings.

export class KdbxError extends Error {
  // code: 'BadSignature' | 'Unsupported' | 'InvalidKey' | 'Corrupted'
  constructor(code, message) { super(message); this.code = code; }
}

// Magic numbers (little-endian u32). SIG2_KDB identifies KeePass 1.x files so they get a specific message instead of
// "not a KeePass database". Ciphers and KDFs are identified by UUIDs in the header; Twofish is listed only so it
// can be named in the "unsupported" error. 'aes2' is the second AES-KDF UUID used by KDBX 4 (both map to type aes).
const SIG1 = 0x9aa2d903, SIG2 = 0xb54bfb67, SIG2_KDB = 0xb54bfb65;
export const CIPHERS = { aes256: '31c1f2e6-bf71-4350-be58-05216afc5aff', chacha20: 'd6038a2b-8b6f-4cb5-a524-339a31dbb59a', twofish: 'ad68f29f-576f-4bb9-a36a-d47af965346c' };
export const KDFS = { aes: 'c9d9f39a-628a-4460-bf74-0d08c18a4fea', aes2: '7c02bb82-79a7-4ac0-927d-114a00648238', argon2d: 'ef636ddf-8c29-444b-91f7-a9a403e30a0c', argon2id: '9e298b19-56db-4773-b23d-fc3ec6f0a1e6' };
const H = { end: 0, comment: 1, cipher: 2, compression: 3, masterSeed: 4, transformSeed: 5, transformRounds: 6, iv: 7, streamKey: 8,
  streamStart: 9, streamId: 10, kdf: 11, publicData: 12 };
const nameOf = (table, id) => Object.keys(table).find((k) => table[k] === id) || null;
const idBytes = (s) => hexToBytes(s.replace(/-/g, ''));

// --- header ------------------------------------------------------------------------------------------------

// Header = TLV fields until id 0. Field length is u16 in KDBX 3 and u32 in KDBX 4 - the one structural difference.
// `bytes` (the exact header bytes, end-of-header field included) is returned because KDBX 4 hashes and HMACs the
// raw header: re-serialising the parsed fields would not reproduce it bit-for-bit.
// Unknown field ids are kept in `fields` and ignored, as the format allows.
// KNOWN DEFECT: a KDBX 3 header without TransformRounds (or other mandatory fields) makes `new Reader(undefined)`
// throw a TypeError instead of KdbxError('Corrupted'). Fix: check required fields and throw KdbxError when missing.
export function readHeader(bytes) {
  const r = new Reader(bytes);
  if (bytes.length < 12) throw new KdbxError('BadSignature', 'not a KeePass database');
  const s1 = r.u32(), s2 = r.u32();
  if (s1 === SIG1 && s2 === SIG2_KDB) throw new KdbxError('Unsupported', 'KeePass 1.x databases (.kdb) are not supported');
  if (s1 !== SIG1 || s2 !== SIG2) throw new KdbxError('BadSignature', 'not a KeePass database');
  const ver = r.u32(), major = ver >>> 16, minor = ver & 0xffff;
  if (major !== 3 && major !== 4) throw new KdbxError('Unsupported', `unsupported KDBX version ${major}.${minor}`);
  const fields = new Map();
  for (;;) {
    const id = r.u8();
    const len = major >= 4 ? r.u32() : r.u16();
    const data = r.bytes(len);
    if (id === H.end) break;
    fields.set(id, data);
  }
  const end = r.pos;
  const cipherId = fields.get(H.cipher) ? uuidString(fields.get(H.cipher)) : '';
  const cipher = nameOf(CIPHERS, cipherId);
  if (!cipher) throw new KdbxError('Unsupported', 'unknown cipher ' + cipherId);
  const compression = fields.get(H.compression) ? new Reader(fields.get(H.compression)).u32() : 0;
  let kdf;
  if (major >= 4) {
    const vd = readVariantDictionary(fields.get(H.kdf) || new Uint8Array(0));
    const g = (k) => (vd.get(k) ? vd.get(k).value : undefined);
    const id = g('$UUID') ? uuidString(g('$UUID')) : '';
    const type = nameOf(KDFS, id);
    if (!type) throw new KdbxError('Unsupported', 'unknown key derivation ' + id);
    kdf = type.startsWith('aes') ? { type: 'aes', rounds: g('R'), salt: g('S') }
      : { type, salt: g('S'), parallelism: g('P'), memory: g('M'), iterations: g('I'), version: g('V'), secret: g('K'), ad: g('A') };
  } else {
    kdf = { type: 'aes', rounds: new Reader(fields.get(H.transformRounds)).u64(), salt: fields.get(H.transformSeed) };
  }
  const publicCustomData = major >= 4 && fields.get(H.publicData) ? readVariantDictionary(fields.get(H.publicData)) : null;
  return { major, minor, fields, end, bytes: bytes.subarray(0, end), cipher, compression: compression === 1, kdf, publicCustomData };
}

// --- key transformation --------------------------------------------------------------------------------------

// There is no time limit anywhere: a database tuned to take minutes takes minutes (with progress; run.signal aborts).
// run.deriveKey(composite, kdf, run) may replace transformKey, e.g. to run the derivation in Workers.
export async function transformKey(composite, kdf, run = {}) {
  const progress = (f) => run.onProgress && run.onProgress({ phase: 'kdf', fraction: f });
  if (kdf.type === 'aes') {
    if (!kdf.salt || kdf.salt.length !== 32) throw new KdbxError('Corrupted', 'invalid AES-KDF seed');
    const lo = await aesKdfHalf(kdf.salt, composite.subarray(0, 16), kdf.rounds, { signal: run.signal, onProgress: (f) => progress(f / 2) });
    const hi = await aesKdfHalf(kdf.salt, composite.subarray(16, 32), kdf.rounds, { signal: run.signal, onProgress: (f) => progress(0.5 + f / 2) });
    progress(1);
    return aesKdfFinish(lo, hi);
  }
  // Argon2: the header stores memory in BYTES, Argon2 takes KiB. Negated comparisons reject undefined/NaN too, so a
  // header with missing parameters fails as 'Corrupted' instead of running Argon2 with garbage (or forever).
  const mem = Math.floor(kdf.memory / 1024);
  if (!(mem >= 8) || !(kdf.iterations >= 1) || !(kdf.parallelism >= 1)) throw new KdbxError('Corrupted', 'invalid Argon2 parameters');
  return argon2Async(kdf.type, composite, kdf.salt, { t: kdf.iterations, m: mem, p: kdf.parallelism, version: kdf.version || 0x13, secret: kdf.secret, ad: kdf.ad, dkLen: 32 },
    { onProgress: progress, signal: run.signal });
}

// AES-KDF encrypts each 16-byte half of the composite key `rounds` times (AES-256 keyed by the seed, ECB) and hashes
// the result: the halves are independent, so they may run in parallel. run: { onProgress(fraction), signal }.
// The block is kept as four big-endian Int32 words (the AES implementation's native state) and encrypted in place
// in batches of 20 000 rounds; control returns to the event loop at most every ~25 ms (progress + abort check), so
// the UI stays responsive without paying a microtask per round. On abort, key material is wiped before throwing.
export async function aesKdfHalf(seed, half, rounds, run = {}) {
  const aes = new AES(seed);
  const w = new Int32Array(4);
  for (let i = 0; i < 4; i++) w[i] = (half[4 * i] << 24) | (half[4 * i + 1] << 16) | (half[4 * i + 2] << 8) | half[4 * i + 3];
  let last = Date.now();
  for (let done = 0; done < rounds;) {
    const n = Math.min(rounds - done, 20000);
    aes.encryptRepeated(w, n);
    done += n;
    if (Date.now() - last > 25) {
      if (run.onProgress) run.onProgress(done / rounds);
      await nextTick();
      last = Date.now();
      if (run.signal && run.signal.aborted) { aes.destroy(); wipe(w); throw new Error('aborted'); }
    }
  }
  const out = new Uint8Array(16);
  for (let i = 0; i < 4; i++) { const v = w[i]; out[4 * i] = v >>> 24; out[4 * i + 1] = v >>> 16; out[4 * i + 2] = v >>> 8; out[4 * i + 3] = v; }
  aes.destroy();
  wipe(w);
  return out;
}

export function aesKdfFinish(lo, hi) {
  const out = concatBytes(lo, hi);
  const key = sha256(out);
  wipe(out, lo, hi);
  return key;
}

// --- payload ciphers --------------------------------------------------------------------------------------------

// A CBC padding failure maps to InvalidKey: for KDBX 3 there is no MAC, so a bad padding is the most likely symptom
// of a wrong key. ChaCha20 has no padding and cannot fail here; its key check is the HMAC (v4) or StreamStartBytes.
function decryptPayload(cipher, key, iv, data) {
  if (cipher === 'aes256') {
    const c = new AesCbc(key, iv, { decrypt: true });
    try { return concatBytes(c.update(data), c.final()); } catch { throw new KdbxError('InvalidKey', 'wrong password or key file'); }
  }
  if (cipher === 'chacha20') return new ChaCha20(key, iv).update(data);
  throw new KdbxError('Unsupported', 'the Twofish cipher is not supported');
}

function encryptPayload(cipher, key, iv, data) {
  if (cipher === 'aes256') { const c = new AesCbc(key, iv); return concatBytes(c.update(data), c.final()); }
  return new ChaCha20(key, iv).update(data);
}

const le64 = (n) => { const b = new Uint8Array(8); writeU64LE(b, 0, n); return b; };
const le32 = (n) => { const b = new Uint8Array(4); writeU32LE(b, 0, n >>> 0); return b; };
// KDBX 4 per-block HMAC key = SHA-512(LE64(index) || hmacKey). Binding the index into both the key and the MACed
// data prevents reordering, dropping or duplicating blocks. The header uses index 2^64 - 1 (all 0xff), a value no
// data block can take.
const MAX_INDEX = new Uint8Array(8).fill(0xff);
const blockKey = (index, hmacKey) => sha512(concatBytes(index instanceof Uint8Array ? index : le64(index), hmacKey));

// --- reading ------------------------------------------------------------------------------------------------------

// The composite key is wiped on every exit path (try/catch + final wipe). The transformed key is NOT wiped: it is
// kept in db.keyCache so a later save need not repeat the KDF (see saveKdbx). Each block's MAC is checked before the
// size-0 terminator is accepted, so a truncated file cannot pass as complete.
// KDBX 4 inner header: id 1 stream id, 2 stream key, 3 binary (first byte = flags, bit 0 "protected"), 0 end.
// Note: the decrypted plaintext buffers are not wiped after parsing; they remain until garbage collection.
export async function loadKdbx(input, credentials, run = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const h = readHeader(bytes);
  const composite = credentials.compositeKey();
  const r = new Reader(bytes, h.end);
  let payload, stream, binaries = [], transformed;
  try {
    if (h.major >= 4) {
      const hash = r.bytes(32), mac = r.bytes(32);
      if (!equalBytes(sha256(h.bytes), hash)) throw new KdbxError('Corrupted', 'the header is corrupted');
      transformed = await (run.deriveKey || transformKey)(composite, h.kdf, run);
      const seed = h.fields.get(H.masterSeed);
      const hmacKey = sha512(concatBytes(seed, transformed, new Uint8Array([1])));
      if (!equalBytes(hmac(sha256, blockKey(MAX_INDEX, hmacKey), h.bytes), mac)) throw new KdbxError('InvalidKey', 'wrong password or key file');
      const blocks = [];
      for (let i = 0; ; i++) {
        const m = r.bytes(32), size = r.u32(), data = r.bytes(size);
        const expect = hmac(sha256, blockKey(i, hmacKey), concatBytes(le64(i), le32(size), data));
        if (!equalBytes(expect, m)) throw new KdbxError('Corrupted', `block ${i} is corrupted`);
        if (size === 0) break;
        blocks.push(data);
      }
      const encKey = sha256(concatBytes(seed, transformed));
      if (run.onProgress) run.onProgress({ phase: 'decrypt', fraction: 0 });
      await nextTick();
      let plain = decryptPayload(h.cipher, encKey, h.fields.get(H.iv), concatBytes(...blocks));
      wipe(encKey, hmacKey);
      if (h.compression) plain = await decompress(plain, 'gzip');
      // inner header
      const ir = new Reader(plain);
      let streamId = INNER_STREAM.chacha20, streamKey = null;
      for (;;) {
        const id = ir.u8(), size = ir.u32(), data = ir.bytes(size);
        if (id === 0) break;
        if (id === 1) streamId = new Reader(data).u32();
        else if (id === 2) streamKey = data.slice();
        else if (id === 3) binaries.push(new KdbxBinary(data.slice(1), (data[0] & 1) === 1));
      }
      stream = createInnerStream(streamId, streamKey);
      payload = plain.subarray(ir.pos);
    } else {
      transformed = await (run.deriveKey || transformKey)(composite, h.kdf, run);
      const seed = h.fields.get(H.masterSeed);
      const key = sha256(concatBytes(seed, transformed));
      if (run.onProgress) run.onProgress({ phase: 'decrypt', fraction: 0 });
      await nextTick();
      const plain = decryptPayload(h.cipher, key, h.fields.get(H.iv), bytes.subarray(h.end));
      wipe(key);
      const start = h.fields.get(H.streamStart);
      if (!start || !equalBytes(plain.subarray(0, 32), start)) throw new KdbxError('InvalidKey', 'wrong password or key file');
      // hashed block stream: u32 index, 32-byte SHA-256, u32 size, data; ends with an empty block
      // The index is read and discarded (not checked for sequence); the hash of the terminator is not checked.
      const br = new Reader(plain, 32), blocks = [];
      for (;;) {
        br.u32();
        const hash = br.bytes(32), size = br.u32();
        if (size === 0) break;
        const data = br.bytes(size);
        if (!equalBytes(sha256(data), hash)) throw new KdbxError('Corrupted', 'a data block is corrupted');
        blocks.push(data);
      }
      payload = concatBytes(...blocks);
      if (h.compression) payload = await decompress(payload, 'gzip');
      const sid = h.fields.get(H.streamId) ? new Reader(h.fields.get(H.streamId)).u32() : INNER_STREAM.none;
      stream = createInnerStream(sid, h.fields.get(H.streamKey));
    }
  } catch (e) {
    wipe(composite);
    throw e;
  }
  if (run.onProgress) run.onProgress({ phase: 'parse', fraction: 0 });
  await nextTick();
  const doc = await readDocument(bytesToUtf8(payload), { stream, binaries });
  stream.destroy();
  const db = new KdbxDatabase();
  db.header = { major: h.major, minor: h.minor, cipher: h.cipher, compression: h.compression, kdf: { ...h.kdf }, publicCustomData: h.publicCustomData };
  db.meta = doc.meta;
  db.root = doc.root;
  db.deletedObjects = doc.deletedObjects;
  db.link();
  db.credentials = credentials;
  db.keyCache = { params: kdfSignature(db.header.kdf), salt: h.kdf.salt, key: transformed, credentials };
  wipe(composite);
  return db;
}

// --- writing --------------------------------------------------------------------------------------------------

// Cache key of the derived key: every KDF parameter except the salt (the salt is cached alongside). JSON of an array
// is a cheap, order-stable structural fingerprint.
const kdfSignature = (k) => JSON.stringify([k.type, k.rounds, k.memory, k.iterations, k.parallelism, k.version || 0x13]);

function kdfDictionary(kdf, salt) {
  const vd = new Map();
  if (kdf.type === 'aes') {
    vd.set('$UUID', { type: VD.Bytes, value: idBytes(KDFS.aes) });
    vd.set('R', { type: VD.UInt64, value: kdf.rounds });
    vd.set('S', { type: VD.Bytes, value: salt });
  } else {
    vd.set('$UUID', { type: VD.Bytes, value: idBytes(KDFS[kdf.type]) });
    vd.set('S', { type: VD.Bytes, value: salt });
    vd.set('P', { type: VD.UInt32, value: kdf.parallelism });
    vd.set('M', { type: VD.UInt64, value: kdf.memory });
    vd.set('I', { type: VD.UInt64, value: kdf.iterations });
    vd.set('V', { type: VD.UInt32, value: kdf.version || 0x13 });
    if (kdf.secret && kdf.secret.length) vd.set('K', { type: VD.Bytes, value: kdf.secret });
    if (kdf.ad && kdf.ad.length) vd.set('A', { type: VD.Bytes, value: kdf.ad });
  }
  return writeVariantDictionary(vd);
}

export async function saveKdbx(db, run = {}) {
  if (!db.credentials) throw new Error('the database has no credentials');
  const hd = db.header;
  if (hd.cipher !== 'aes256' && hd.cipher !== 'chacha20') hd.cipher = 'aes256';
  if (hd.kdf.type === 'aes' && !(hd.kdf.rounds >= 1)) hd.kdf.rounds = 100000;
  // KDBX 4.1 when the file was 4.1 or uses its elements (custom icon names, group tags, ...), else 4.0: a minor
  // version step is not critical, KDBX 4.0 readers open 4.1 files.
  const minor = (hd.major >= 4 && hd.minor >= 1) || db.usesKdbx41() ? 1 : 0;
  // The transformed key of the last open / save is reused while the credentials and KDF parameters are unchanged
  // (KeePassXC does the same), so saving does not repeat a slow key derivation.
  let salt, transformed;
  const sig = kdfSignature(hd.kdf);
  if (db.keyCache && db.keyCache.params === sig && db.keyCache.credentials === db.credentials && db.keyCache.salt && db.keyCache.salt.length === 32) {
    salt = db.keyCache.salt;
    transformed = db.keyCache.key;
  } else {
    salt = randomBytes(32);
    const composite = db.credentials.compositeKey();
    transformed = await (run.deriveKey || transformKey)(composite, { ...hd.kdf, salt }, run);
    wipe(composite);
    if (db.keyCache) wipe(db.keyCache.key);
    db.keyCache = { params: sig, salt, key: transformed, credentials: db.credentials };
  }
  // With a cached key the KDF salt is reused, but the master seed and IV are fresh on every save, so the actual
  // encryption key SHA-256(seed || transformed) and keystream never repeat. IV length: 16 for AES-CBC, 12 for the
  // IETF ChaCha20 nonce. The end-of-header field carries "\r\n\r\n" like KeePass (content is ignored by readers).
  hd.kdf.salt = salt;
  const seed = randomBytes(32), iv = randomBytes(hd.cipher === 'aes256' ? 16 : 12);
  const w = new Writer().u32(SIG1).u32(SIG2).u32((4 << 16) | minor);
  const field = (id, data) => w.u8(id).u32(data.length).bytes(data);
  field(H.cipher, idBytes(CIPHERS[hd.cipher]));
  field(H.compression, le32(hd.compression ? 1 : 0));
  field(H.masterSeed, seed);
  field(H.iv, iv);
  field(H.kdf, kdfDictionary(hd.kdf, salt));
  if (hd.publicCustomData && hd.publicCustomData.size) field(H.publicData, writeVariantDictionary(hd.publicCustomData));
  field(H.end, utf8ToBytes('\r\n\r\n'));
  const header = w.done();

  // inner header + XML
  // Binary pool: attachments are stored once in the inner header and referenced by index from entries (and their
  // history). Dedup first by object identity, then by (size, hash) so identical files attached twice share a slot.
  // The linear find makes this O(n^2) in distinct attachments - fine for the tens typical of a password database.
  const streamKey = randomBytes(64);
  const stream = createInnerStream(INNER_STREAM.chacha20, streamKey);
  const binaryIndex = new Map(), binaryList = [];
  for (const e of db.allEntries()) {
    for (const x of [e, ...e.history]) {
      for (const b of x.binaries.values()) {
        if (binaryIndex.has(b)) continue;
        const same = binaryList.find((y) => y.size === b.size && y.hash === b.hash);
        if (same) { binaryIndex.set(b, binaryIndex.get(same)); continue; }
        binaryIndex.set(b, binaryList.length);
        binaryList.push(b);
      }
    }
  }
  if (run.onProgress) run.onProgress({ phase: 'encrypt', fraction: 0 });
  await nextTick();
  const xml = writeDocument(db, { stream, binaryIndex, minor });
  stream.destroy();
  const inner = new Writer();
  inner.u8(1).u32(4).u32(INNER_STREAM.chacha20);
  inner.u8(2).u32(64).bytes(streamKey);
  for (const b of binaryList) inner.u8(3).u32(b.data.length + 1).u8(b.protected ? 1 : 0).bytes(b.data);
  inner.u8(0).u32(0);
  let payload = concatBytes(inner.done(), utf8ToBytes(xml));
  wipe(streamKey);
  if (hd.compression) payload = await compress(payload, 'gzip');
  const encKey = sha256(concatBytes(seed, transformed));
  const ct = encryptPayload(hd.cipher, encKey, iv, payload);
  wipe(encKey, payload);
  const hmacKey = sha512(concatBytes(seed, transformed, new Uint8Array([1])));
  const out = new Writer().bytes(header).bytes(sha256(header)).bytes(hmac(sha256, blockKey(MAX_INDEX, hmacKey), header));
  // 1 MiB HMAC blocks (KeePass's size), terminated by an authenticated empty block - the loop emits it naturally
  // when the slice runs out (data.length === 0 is written, then breaks).
  const BLOCK = 1 << 20;
  for (let i = 0, o = 0; ; i++) {
    const data = ct.subarray(o, Math.min(ct.length, o + BLOCK));
    out.bytes(hmac(sha256, blockKey(i, hmacKey), concatBytes(le64(i), le32(data.length), data))).u32(data.length).bytes(data);
    o += data.length;
    if (data.length === 0) break;
  }
  wipe(hmacKey);
  hd.major = 4;
  hd.minor = minor;
  return out.done();
}
