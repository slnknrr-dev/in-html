// crypto-tool/container.js - the password-protected container of the encryption page (format "CTENC" v1, specified in
// README.md): a self-describing header (KDF, its parameters and salt, cipher, chunk size, nonce prefix) authenticated as
// associated data of every chunk; the plaintext is cut into chunks sealed separately (counter and last-chunk flag in the
// nonce), so files of any size stream through with progress and truncation is detected.
// 
//   encryptContainer(input: Blob | Uint8Array, password, { kdf, cipher, name, argon2: { m, t, p }, pbkdf2: { iterations },
//                    chunkExp }, { onProgress({ phase, fraction }), signal }) -> Promise<Uint8Array[]> (parts of the file)
//   decryptContainer(input, password, run) -> Promise<{ name, parts: Uint8Array[], header }>
//   parseHeader(bytes) -> header | null (no exception for foreign data: null), isContainer(bytes)
//   armor(bytes) -> text, unarmor(text) -> bytes | null
// 
// Security design (STREAM construction, as in age / Tink streaming AEAD):
// - Header as AAD of every chunk: changing any parameter (KDF cost, cipher id, chunk size) breaks every tag.
// - Nonce = random prefix || u32 chunk counter || last flag. Reordering chunks breaks the counter; dropping the tail
//   breaks the last flag (the new final chunk was sealed with last = 0); appending fails because nothing follows last = 1.
// - Random prefix per file: the same key is never reused with the same nonce across files even with the same password
//   and salt (the salt is random too).
// - Key material is wiped (wipe) in finally blocks; JS cannot guarantee no copies remain, so this is best effort.
import { getCipher } from './ciphering.js';
import { createHash } from './hashing.js';
import { base64ToBytes, bytesToBase64, bytesToUtf8, concatBytes, readU32BE, utf8ToBytes, wipe, writeU32BE } from '../crypto/encoding.js';
import { randomBytes } from '../crypto/random.js';
import { nextTick } from '../crypto/kdf.js';

const MAGIC = utf8ToBytes('CTENC');
const VERSION = 1;
export const KDFS = { 1: 'argon2id', 2: 'pbkdf2-sha256' };
export const CIPHERS = { 1: { id: 'aes-256-gcm', prefix: 7 }, 2: { id: 'xchacha20-poly1305', prefix: 19 } };
export const DEFAULTS = { kdf: 1, cipher: 2, chunkExp: 18, argon2: { m: 65536, t: 3, p: 4 }, pbkdf2: { iterations: 600000 } };
// Limits checked before any work, so a crafted header cannot ask for gigabytes of memory or hours of hashing.
// m in KiB (8 KiB .. 1 GiB), t, p, PBKDF2 iterations and chunk size exponent (1 KiB .. 16 MiB) — enforced on parse, i.e. on untrusted input.
const LIMITS = { m: [8, 1048576], t: [1, 64], p: [1, 64], iterations: [1000, 20000000], chunkExp: [10, 24] };

const within = (v, [a, b]) => Number.isInteger(v) && v >= a && v <= b;

// Layout: "CTENC" | version | kdf | cipher | chunkExp | saltLen | salt | kdf params (Argon2: m u32, t u32, p u8;
// PBKDF2: iterations u32) | prefixLen | prefix. Big-endian integers.
export function buildHeader({ kdf, cipher, chunkExp, salt, params, prefix }) {
  const kp = kdf === 1 ? new Uint8Array(9) : new Uint8Array(4);
  if (kdf === 1) { writeU32BE(kp, 0, params.m); writeU32BE(kp, 4, params.t); kp[8] = params.p; }
  else writeU32BE(kp, 0, params.iterations);
  return concatBytes(MAGIC, new Uint8Array([VERSION, kdf, cipher, chunkExp, salt.length]), salt, kp, new Uint8Array([prefix.length]), prefix);
}

// Returns null only when the magic does not match (foreign data); a CTENC file with bad fields throws, so the user sees why it cannot be opened.
export function parseHeader(b) {
  if (!b || b.length < 11) return null;
  for (let i = 0; i < MAGIC.length; i++) if (b[i] !== MAGIC[i]) return null;
  const err = (m) => { throw new Error(m); };
  if (b[5] !== VERSION) err('unsupported container version ' + b[5]);
  const kdf = b[6], cipher = b[7], chunkExp = b[8], saltLen = b[9];
  if (!KDFS[kdf] || !CIPHERS[cipher]) err('unknown key derivation or cipher in the header');
  if (!within(chunkExp, LIMITS.chunkExp) || saltLen < 16 || saltLen > 64) err('invalid header');
  let o = 10;
  const salt = b.slice(o, o + saltLen); o += saltLen;
  let params;
  if (kdf === 1) {
    params = { m: readU32BE(b, o), t: readU32BE(b, o + 4), p: b[o + 8] }; o += 9;
    // Argon2 requires m >= 8·p KiB (RFC 9106); checked here rather than inside the KDF.
    if (!within(params.m, LIMITS.m) || !within(params.t, LIMITS.t) || !within(params.p, LIMITS.p) || params.m < 8 * params.p) err('Argon2 parameters out of range');
  } else {
    params = { iterations: readU32BE(b, o) }; o += 4;
    if (!within(params.iterations, LIMITS.iterations)) err('PBKDF2 iterations out of range');
  }
  const prefixLen = b[o++];
  if (prefixLen !== CIPHERS[cipher].prefix) err('invalid nonce prefix');
  const prefix = b.slice(o, o + prefixLen); o += prefixLen;
  if (o > b.length) err('truncated header');
  return { kdf, cipher, chunkExp, salt, params, prefix, length: o, bytes: b.slice(0, o) };
}

// A throwing parse still means "this is a container" (magic matched, fields bad): the UI then offers decryption and shows the error.
export const isContainer = (b) => { try { return !!parseHeader(b); } catch { return true; } };

// Key derivation through the hash registry (NFC: the same password typed on any system gives the same key).
// NFC normalisation: "é" typed as one code point or as e + combining accent must give the same key on every OS / keyboard.
export async function deriveKey(password, h, run = {}) {
  const pw = utf8ToBytes(String(password).normalize('NFC'));
  const opts = h.kdf === 1 ? { salt: h.salt, m: h.params.m, t: h.params.t, p: h.params.p, dkLen: 32 }
    : { salt: h.salt, iterations: h.params.iterations, dkLen: 32 };
  const onProgress = run.onProgress ? (f) => run.onProgress({ phase: 'kdf', fraction: f }) : undefined;
  const key = await createHash(KDFS[h.kdf], { ...opts, onProgress, signal: run.signal }).update(pw).digest();
  wipe(pw);
  return key;
}

// Prefix length = cipher nonce length − 5 (7 for GCM 12-byte nonces, 19 for XChaCha 24-byte), leaving 4 bytes counter + 1 flag byte.
const nonce = (prefix, i, last) => {
  const n = new Uint8Array(prefix.length + 5);
  n.set(prefix);
  writeU32BE(n, prefix.length, i);
  n[prefix.length + 4] = last ? 1 : 0;
  return n;
};

// Uniform random access for Uint8Array and Blob: Blob.slice reads only the requested range, so multi-GB files never sit in memory whole.
const reader = (input) => (o, n) => (input instanceof Uint8Array ? Promise.resolve(input.subarray(o, o + n))
  : input.slice(o, o + n).arrayBuffer().then((b) => new Uint8Array(b)));

export async function encryptContainer(input, password, opts = {}, run = {}) {
  const kdf = opts.kdf || DEFAULTS.kdf, cipher = opts.cipher || DEFAULTS.cipher, chunkExp = opts.chunkExp || DEFAULTS.chunkExp;
  const params = kdf === 1 ? { ...DEFAULTS.argon2, ...opts.argon2 } : { ...DEFAULTS.pbkdf2, ...opts.pbkdf2 };
  const salt = randomBytes(16), prefix = randomBytes(CIPHERS[cipher].prefix);
  const header = buildHeader({ kdf, cipher, chunkExp, salt, params, prefix });
  // Round-trip through the parser: the encoder can never write a header the decoder would reject.
  const h = parseHeader(header); // validates the parameters the same way decryption will
  const key = await deriveKey(password, h, run);
  // The original file name travels inside the encrypted stream (2-byte length + UTF-8), never in the clear header.
  const name = utf8ToBytes(opts.name || '').subarray(0, 1024);
  const lead = concatBytes(new Uint8Array([name.length >>> 8, name.length & 255]), name);
  const size = input instanceof Uint8Array ? input.length : input.size;
  const total = lead.length + size, cs = 2 ** chunkExp, read = reader(input);
  const def = getCipher(CIPHERS[cipher].id);
  const parts = [header];
  try {
    for (let i = 0, off = 0; ; i++) {
      // plaintext stream offset off .. off + cs: the lead (name) first, then the input
      const end = Math.min(total, off + cs);
      const pieces = [];
      if (off < lead.length) pieces.push(lead.subarray(off, Math.min(end, lead.length)));
      if (end > lead.length) pieces.push(await read(Math.max(0, off - lead.length), end - Math.max(off, lead.length)));
      const last = end >= total;
      parts.push(def.apply(concatBytes(...pieces), { key, iv: nonce(prefix, i, last), aad: header }));
      off = end;
      if (run.onProgress) run.onProgress({ phase: 'data', fraction: total ? off / total : 1 });
      if (last) break;
      // Yield between chunks: keeps the page responsive and lets an abort signal be observed.
      await nextTick();
      if (run.signal && run.signal.aborted) throw new Error('aborted');
    }
  } finally { wipe(key); }
  return parts;
}

export async function decryptContainer(input, password, run = {}) {
  const read = reader(input);
  const size = input instanceof Uint8Array ? input.length : input.size;
  const h = parseHeader(await read(0, Math.min(size, 256)));
  if (!h) throw new Error('not an encrypted container');
  const key = await deriveKey(password, h, run);
  // Each sealed chunk = chunk plaintext + 16-byte tag; the last chunk may be shorter.
  const seg = 2 ** h.chunkExp + 16, bodyLen = size - h.length;
  if (bodyLen < 16) throw new Error('truncated container');
  const def = getCipher(CIPHERS[h.cipher].id);
  const out = [];
  let name = null, pending = new Uint8Array(0);
  try {
    for (let i = 0, off = 0; off < bodyLen; i++) {
      const n = Math.min(seg, bodyLen - off), last = off + n >= bodyLen;
      let pt;
      try { pt = def.apply(await read(h.length + off, n), { key, iv: nonce(h.prefix, i, last), aad: h.bytes, decrypt: true }); }
      // A failing first chunk is almost always a wrong password (AEAD cannot tell the two apart); later chunks mean corruption.
      catch { throw new Error(i === 0 ? 'wrong password or damaged file' : 'the file is damaged (chunk ' + (i + 1) + ')'); }
      off += n;
      if (name === null) {
        // the name length and name sit at the start of the plaintext stream (they may span chunks)
        pending = concatBytes(pending, pt);
        if (pending.length < 2) continue;
        const nl = (pending[0] << 8) | pending[1];
        if (pending.length < 2 + nl) { if (last) throw new Error('truncated container'); continue; }
        name = bytesToUtf8(pending.subarray(2, 2 + nl));
        pt = pending.subarray(2 + nl);
      }
      if (pt.length) out.push(pt);
      if (run.onProgress) run.onProgress({ phase: 'data', fraction: off / bodyLen });
      if (!last) { await nextTick(); if (run.signal && run.signal.aborted) throw new Error('aborted'); }
    }
  } finally { wipe(key); }
  if (name === null) throw new Error('truncated container');
  return { name, parts: out, header: h };
}

// Text form: base64 lines between markers (the markers are optional when reading).
// ASCII armour for pasting into chat or e-mail: 64-character base64 lines between PEM-like markers (optional on input).
const BEGIN = '-----BEGIN CRYPTO TOOLS MESSAGE-----', END = '-----END CRYPTO TOOLS MESSAGE-----';
export function armor(bytes) {
  const b64 = bytesToBase64(bytes);
  const lines = [];
  for (let i = 0; i < b64.length; i += 64) lines.push(b64.slice(i, i + 64));
  return [BEGIN, ...lines, END].join('\n');
}

export function unarmor(text) {
  const s = String(text || '').replace(BEGIN, '').replace(END, '').replace(/\s+/g, '');
  if (!s) return null;
  try { return base64ToBytes(s); } catch { return null; }
}

