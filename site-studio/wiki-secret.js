// site-studio/wiki-secret.js - "451" envelopes: secret pages and secret variants of pages, encrypted with a key
// derived from a password (Node and browsers; pure JavaScript crypto from ../crypto, no Web Crypto needed).
//
// Envelope (JSON, format v1; also documented in README.md):
//   { v: 1,
//     kdf: { a: 'argon2id', s, t, m, p } | { a: 'pbkdf2-sha256', s, i },   s = base64 salt (the base's salt)
//     id:  base64url of 16 bytes  = HKDF-SHA256(master, info 'kp451/id')   (finds the envelopes of a password)
//     iv:  base64 of 12 random bytes
//     ct:  base64 of AES-256-GCM(key, iv, payload, aad = 'kp451:' + id) ciphertext followed by the 16-byte tag
//     z:   1 when the payload is raw-deflated before encryption }
//   master = KDF(UTF-8 password NFC, salt, 32 bytes); key = HKDF-SHA256(master, info 'kp451/key', 32 bytes).
//   Every envelope sealed with the same password and KDF parameters has the same id, so a reader derives the key once
//   and opens exactly the envelopes whose id matches; a wrong password matches none (and GCM authenticates anyway).
// Payload (UTF-8 JSON): { kind: 'page' | 'variant', slug, label, …PAYLOAD_FIELDS of model.js, media?: { id: meta } }.
//   'page': a secret page that exists only for the password (without it the route is a plain 404);
//   'variant': an alternative of the public page `slug` (without the password the reader sees the public version).
//
//   deriveKeys(password, kdf, { onProgress, signal }) -> Promise<{ key, id, kdf }>   (slow: the KDF)
//   sealWith(keys, payload) -> envelope                                             (fast)
//   openWith(keys, envelope) -> payload | null                                       (fast; null: wrong key)
//   seal(password, kdf, payload) / open(password, envelope) -> Promise
//   kdfOf(kbKdf, salt) -> envelope kdf      kdfKey(kdf) -> string (envelopes with equal keys share a derivation)
//   unlockAll(password, envelopes, opts) -> Promise<{ payloads, keys }>   what the password opens, its keys
//   openAllWith(keys, envelopes) -> [payload]     keysToJSON(keys) / keysFromJSON(list): session keys
import { argon2Async } from '../crypto/argon2.js';
import { aesGcmDecrypt, aesGcmEncrypt } from '../crypto/aes.js';
import { base64ToBytes, bytesToBase64, bytesToBase64Url, bytesToUtf8, utf8ToBytes } from '../crypto/encoding.js';
import { hkdf, pbkdf2Async } from '../crypto/kdf.js';
import { randomBytes } from '../crypto/random.js';
import { sha256 } from '../crypto/sha2.js';
import { deflateRawSync, inflateRawSync } from '../codec/zlib.js';

// Design decisions:
// - Pure-JS crypto instead of Web Crypto: Web Crypto is missing in insecure contexts (http:// on a LAN, some file://
// setups) and has no Argon2. One implementation runs in the editor, the reader and Node.
// - Password -> slow KDF once -> HKDF splits the master into independent key and id (domain separation by info
// string), so the public id reveals nothing usable about the key.
// - The id lets a reader skip envelopes of other passwords without trial decryption. Accepted leak: envelopes sealed
// with the same password are linkable.
// - AAD binds the ciphertext to its id: moving a ciphertext into an envelope with another id fails authentication.
export const ENVELOPE_VERSION = 1;

// Defaults follow OWASP guidance: Argon2id t=2, m=19 MiB (19456 KiB), p=1; PBKDF2-SHA256 600000 iterations (the
// fallback for very weak devices). The salt is per knowledge base, not per envelope: one derivation per password
// opens every envelope of the base, which is what makes unlockAll fast.
export function kdfOf(k, salt) {
  if (k && k.a === 'pbkdf2-sha256') return { a: 'pbkdf2-sha256', s: salt, i: k.i || 600000 };
  return { a: 'argon2id', s: salt, t: (k && k.t) || 2, m: (k && k.m) || 19456, p: (k && k.p) || 1 };
}

// Canonical string of KDF parameters: two envelopes with equal kdfKey can share one derivation.
export const kdfKey = (k) => (k.a === 'pbkdf2-sha256' ? `p:${k.s}:${k.i}` : `a:${k.s}:${k.t}:${k.m}:${k.p}`);

// NFC: the same visible password typed on different keyboards/OSes (composed vs decomposed é) must give equal bytes.
const pwBytes = (pw) => utf8ToBytes(String(pw == null ? '' : pw).normalize('NFC'));

export async function deriveKeys(password, kdf, opts = {}) {
  const salt = base64ToBytes(kdf.s);
  let master;
  if (kdf.a === 'pbkdf2-sha256') master = await pbkdf2Async(sha256, pwBytes(password), salt, kdf.i, 32, opts);
  else if (kdf.a === 'argon2id') master = await argon2Async('argon2id', pwBytes(password), salt, { t: kdf.t, m: kdf.m, p: kdf.p, dkLen: 32 }, opts);
  else throw new Error('unknown KDF ' + kdf.a);
  const key = hkdf(sha256, master, new Uint8Array(0), utf8ToBytes('kp451/key'), 32);
  const id = bytesToBase64Url(hkdf(sha256, master, new Uint8Array(0), utf8ToBytes('kp451/id'), 16));
  // Best-effort wipe of the master secret; JS gives no guarantee about copies, but it shortens the exposure.
  master.fill(0);
  return { key, id, kdf: { ...kdf } };
}

// Compression only when it saves more than the 16-byte margin (z flag), so tiny payloads are not inflated. Note:
// compress-then-encrypt leaks length; acceptable here because an attacker cannot inject chosen text into a payload
// (no CRIME/BREACH-style oracle). Fresh random 96-bit IV per seal: GCM is catastrophically broken by IV reuse.
export function sealWith(keys, payload) {
  const raw = utf8ToBytes(JSON.stringify(payload));
  const packed = deflateRawSync(raw, { level: 9 });
  const z = packed.length + 16 < raw.length ? 1 : 0;
  const iv = randomBytes(12);
  const ct = aesGcmEncrypt(keys.key, iv, z ? packed : raw, utf8ToBytes('kp451:' + keys.id));
  return { v: ENVELOPE_VERSION, kdf: { ...keys.kdf }, id: keys.id, iv: bytesToBase64(iv), ct: bytesToBase64(ct), z };
}

// Returns null for every failure (wrong id, other KDF, bad tag, corrupt inflate, bad JSON): callers only need
// "opened or not", and distinct errors would turn this into an oracle for nothing.
export function openWith(keys, env) {
  if (!env || env.id !== keys.id || kdfKey(env.kdf) !== kdfKey(keys.kdf)) return null;
  let pt;
  try { pt = aesGcmDecrypt(keys.key, base64ToBytes(env.iv), base64ToBytes(env.ct), utf8ToBytes('kp451:' + env.id)); } catch { return null; }
  try {
    const bytes = env.z === 1 ? inflateRawSync(pt) : pt;
    return JSON.parse(bytesToUtf8(bytes));
  } catch { return null; }
}

export async function seal(password, kdf, payload, opts) {
  return sealWith(await deriveKeys(password, kdf, opts), payload);
}

export async function open(password, env, opts) {
  return openWith(await deriveKeys(password, env.kdf, opts), env);
}

// Derives once per distinct KDF setting and returns every payload the password opens (in envelope order) and the
// derived keys that matched an envelope (a list: a reader keeps the keys of several passwords for the session).
// Envelopes are grouped by kdfKey first, so the expensive KDF runs once per distinct parameter set, not per envelope.
export async function unlockAll(password, envelopes, opts = {}) {
  const groups = new Map();
  for (const e of envelopes || []) {
    if (!e || !e.kdf) continue;
    const k = kdfKey(e.kdf);
    if (!groups.has(k)) groups.set(k, e.kdf);
  }
  const keys = [];
  for (const kdf of groups.values()) keys.push(await deriveKeys(password, kdf, opts));
  const payloads = openAllWith(keys, envelopes);
  return { payloads, keys: keys.filter((k) => (envelopes || []).some((e) => e && e.id === k.id)) };
}

// Every payload that one of the keys opens.
export function openAllWith(keys, envelopes) {
  const out = [];
  for (const e of envelopes || []) {
    if (!e || !e.kdf) continue;
    const ek = kdfKey(e.kdf);
    for (const ks of keys || []) {
      if (ks.id !== e.id || kdfKey(ks.kdf) !== ek) continue;
      const p = openWith(ks, e);
      if (p) { out.push(p); break; }
    }
  }
  return out;
}

// Session keys as JSON-safe values (sessionStorage) and back.
// Security trade-off: derived keys (not the password) go to sessionStorage, so a reload does not re-run the KDF.
// They die with the tab; anyone with script access to the origin during the session can read them.
export const keysToJSON = (keys) => (keys || []).map((k) => ({ key: bytesToBase64(k.key), id: k.id, kdf: k.kdf }));
export function keysFromJSON(list) {
  const out = [];
  for (const k of Array.isArray(list) ? list : []) {
    if (!k || !k.kdf || typeof k.key !== 'string' || typeof k.id !== 'string') continue;
    try { out.push({ key: base64ToBytes(k.key), id: k.id, kdf: k.kdf }); } catch { /* skip */ }
  }
  return out;
}
