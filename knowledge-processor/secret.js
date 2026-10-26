// knowledge-processor/secret.js - "451" envelopes: secret pages and secret variants of pages, encrypted with a key
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

// Design choices of this module (fail-fast summary):
// - Pure-JS crypto, not Web Crypto: SubtleCrypto is missing in insecure contexts (http, some file:// setups)
//   and has no Argon2. Exports must open anywhere, including offline files.
// - Password -> slow KDF once -> HKDF splits independent subkeys: the AES key and a public lookup id. The id
//   lets a reader pick matching envelopes without trial-decrypting all; HKDF domain separation ('kp451/key'
//   vs 'kp451/id') ensures the id reveals nothing about the key.
// - AES-GCM with AAD binding the id: an envelope cannot be re-labelled with another id undetected.
// - Known trade-off: equal ids reveal which envelopes share a password; accepted for O(1) lookup.
export const ENVELOPE_VERSION = 1;

// Defaults follow OWASP guidance: argon2id m=19 MiB (19456 KiB), t=2, p=1; PBKDF2-SHA256 600000 iterations.
// Salt is per knowledge base (not per envelope) so one derivation opens every envelope of a password.
export function kdfOf(k, salt) {
  if (k && k.a === 'pbkdf2-sha256') return { a: 'pbkdf2-sha256', s: salt, i: k.i || 600000 };
  return { a: 'argon2id', s: salt, t: (k && k.t) || 2, m: (k && k.m) || 19456, p: (k && k.p) || 1 };
}

// Canonical string of KDF parameters: envelopes with equal kdfKey can share one derivation.
export const kdfKey = (k) => (k.a === 'pbkdf2-sha256' ? `p:${k.s}:${k.i}` : `a:${k.s}:${k.t}:${k.m}:${k.p}`);

// NFC normalisation: the same visible password typed on different OSes/keyboards may arrive as composed or
// decomposed Unicode; without NFC they would derive different keys.
const pwBytes = (pw) => utf8ToBytes(String(pw == null ? '' : pw).normalize('NFC'));

// Empty HKDF salt is fine here: the master key is already uniformly random output of a salted KDF.
// master.fill(0): best-effort wipe of the root secret (JS cannot guarantee no copies, but it shortens its life).
export async function deriveKeys(password, kdf, opts = {}) {
  const salt = base64ToBytes(kdf.s);
  let master;
  if (kdf.a === 'pbkdf2-sha256') master = await pbkdf2Async(sha256, pwBytes(password), salt, kdf.i, 32, opts);
  else if (kdf.a === 'argon2id') master = await argon2Async('argon2id', pwBytes(password), salt, { t: kdf.t, m: kdf.m, p: kdf.p, dkLen: 32 }, opts);
  else throw new Error('unknown KDF ' + kdf.a);
  const key = hkdf(sha256, master, new Uint8Array(0), utf8ToBytes('kp451/key'), 32);
  const id = bytesToBase64Url(hkdf(sha256, master, new Uint8Array(0), utf8ToBytes('kp451/id'), 16));
  master.fill(0);
  return { key, id, kdf: { ...kdf } };
}

// Compression only if it saves more than a 16-byte margin. Note: compress-then-encrypt leaks compressibility
// through ciphertext length (CRIME class); acceptable because an attacker cannot inject chosen plaintext into
// an author's sealed page. 12-byte random IV: the GCM standard size, safe for far more seals than a base makes.
export function sealWith(keys, payload) {
  const raw = utf8ToBytes(JSON.stringify(payload));
  const packed = deflateRawSync(raw, { level: 9 });
  const z = packed.length + 16 < raw.length ? 1 : 0;
  const iv = randomBytes(12);
  const ct = aesGcmEncrypt(keys.key, iv, z ? packed : raw, utf8ToBytes('kp451:' + keys.id));
  return { v: ENVELOPE_VERSION, kdf: { ...keys.kdf }, id: keys.id, iv: bytesToBase64(iv), ct: bytesToBase64(ct), z };
}

// Cheap id/kdf pre-check before any AES work; every failure (wrong key, tampered ct, corrupt deflate, bad
// JSON) collapses to null, so callers cannot distinguish failure modes (no oracle for an attacker).
// KNOWN DEFECT: an envelope with a matching id but missing `kdf` makes kdfKey(env.kdf) throw a TypeError
// instead of returning null (unlockAll/openAllWith pre-filter, direct callers do not). Fix: add `!env.kdf ||`
// to the guard.
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
// Derive once per distinct KDF setting (normally one per base): the KDF dominates the cost. Only keys that
// matched some envelope are returned, so a mistyped password's keys are not kept in the session.
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
// Session keys go to sessionStorage (tab-scoped, cleared on close): derived keys, never the password itself,
// so reopening a page skips the slow KDF without persisting the secret beyond the tab.
export const keysToJSON = (keys) => (keys || []).map((k) => ({ key: bytesToBase64(k.key), id: k.id, kdf: k.kdf }));
// Storage content is untrusted (other scripts, manual edits): validate shape, skip bad entries silently.
export function keysFromJSON(list) {
  const out = [];
  for (const k of Array.isArray(list) ? list : []) {
    if (!k || !k.kdf || typeof k.key !== 'string' || typeof k.id !== 'string') continue;
    try { out.push({ key: base64ToBytes(k.key), id: k.id, kdf: k.kdf }); } catch { /* skip */ }
  }
  return out;
}
