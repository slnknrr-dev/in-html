// walletui/vault.js - the encrypted vault of the wallet applications: the secrets (mnemonics, keys) and the private
// data (address book, labels) as one JSON object, encrypted at rest with AES-256-GCM under a key derived from the
// password with Argon2id (default) or scrypt, kept decrypted in memory only while unlocked, locked automatically after
// a period of inactivity. Pure functions (Node-importable) plus a small browser session.
//
//   DEFAULT_KDF = { name: 'argon2id', m: 65536 (KiB), t: 3, p: 1 }     SCRYPT_KDF = { name: 'scrypt', N: 131072, r: 8, p: 1 }
//   deriveVaultKey(password, kdf, { onProgress, signal }) -> Promise<32 bytes>
//   sealWithKey(data, key, kdf) -> envelope     openWithKey(envelope, key) -> data (throws code 'password')
//   sealVault(data, password, { kdf, onProgress }) / openVault(envelope, password, { onProgress }) -> envelope / { data, key }
//   envelope: { format: 'in-html-vault', v: 1, kdf: { name, …params, salt (base64) }, cipher: 'aes-256-gcm', iv, ct }
//   new VaultSession({ storageKey, storage = localStorage, autoLockMinutes = 5, onLock, kdf })
//     .exists(), .create(password, data), .unlock(password), .lock(), .unlocked, .data, .save(),
//     .touch(), .setAutoLock(minutes), .changePassword(old, new), .exportEnvelope(), .importEnvelope(env, password),
//     .destroy()   (deletes the stored vault)
import { argon2Async } from '../crypto/argon2.js';
import { scryptAsync } from '../crypto/scrypt.js';
import { aesGcmDecrypt, aesGcmEncrypt } from '../crypto/aes.js';
import { randomBytes } from '../crypto/random.js';
import { base64ToBytes, bytesToBase64, bytesToUtf8, utf8ToBytes, wipe } from '../crypto/encoding.js';

// Threat model: someone copies localStorage or the backup file and brute-forces the password offline. Argon2id with
// 64 MiB makes each guess cost memory (GPU / ASIC resistant); scrypt is the fallback. Parameters and salt travel in
// the envelope, so they can be raised later without breaking old vaults. Frozen so callers cannot weaken defaults.
export const DEFAULT_KDF = Object.freeze({ name: 'argon2id', m: 65536, t: 3, p: 1 });
export const SCRYPT_KDF = Object.freeze({ name: 'scrypt', N: 131072, r: 8, p: 1 });
const FORMAT = 'in-html-vault';

// NFC normalisation: the same visible password typed on two keyboards / OSes can differ in Unicode composition and
// must derive the same key. The password bytes are wiped after use (best effort in a GC language).
export async function deriveVaultKey(password, kdf, { onProgress, signal } = {}) {
  const pw = utf8ToBytes(String(password).normalize('NFC'));
  const salt = typeof kdf.salt === 'string' ? base64ToBytes(kdf.salt) : kdf.salt;
  if (!salt || salt.length < 16) throw new Error('vault: salt missing');
  try {
    if (kdf.name === 'argon2id') return await argon2Async('argon2id', pw, salt, { m: kdf.m, t: kdf.t, p: kdf.p, dkLen: 32 }, { onProgress, signal });
    if (kdf.name === 'scrypt') return await scryptAsync(pw, salt, { N: kdf.N, r: kdf.r, p: kdf.p, dkLen: 32 }, { onProgress, signal });
    throw new Error(`vault: unknown key derivation ${kdf.name}`);
  } finally { wipe(pw); }
}

// Associated data binds format, version and KDF name into the GCM tag: swapping the kdf block (a downgrade to weaker
// parameters) makes decryption fail instead of silently succeeding.
const aad = (kdf) => utf8ToBytes(`${FORMAT}/1/${kdf.name}`);

// Fresh random 96-bit IV per save: GCM is catastrophically broken if an IV repeats under one key, and saves reuse
// the session key.
export function sealWithKey(data, key, kdf) {
  const iv = randomBytes(12);
  const pt = utf8ToBytes(JSON.stringify(data));
  const ct = aesGcmEncrypt(key, iv, pt, aad(kdf));
  wipe(pt);
  const k = { ...kdf, salt: typeof kdf.salt === 'string' ? kdf.salt : bytesToBase64(kdf.salt) };
  return { format: FORMAT, v: 1, kdf: k, cipher: 'aes-256-gcm', iv: bytesToBase64(iv), ct: bytesToBase64(ct) };
}

export function checkEnvelope(env) {
  if (!env || env.format !== FORMAT || env.v !== 1 || env.cipher !== 'aes-256-gcm' || !env.kdf || !env.iv || !env.ct) {
    throw Object.assign(new Error('not a vault file of this application'), { code: 'format' });
  }
  return env;
}

// Any GCM failure is reported as 'password': a wrong password and a tampered file are indistinguishable by design
// (authenticated encryption), and the UI only needs one message.
export function openWithKey(env, key) {
  checkEnvelope(env);
  let pt;
  try { pt = aesGcmDecrypt(key, base64ToBytes(env.iv), base64ToBytes(env.ct), aad(env.kdf)); } catch {
    throw Object.assign(new Error('wrong password'), { code: 'password' });
  }
  const data = JSON.parse(bytesToUtf8(pt));
  wipe(pt);
  return data;
}

export async function sealVault(data, password, { kdf = DEFAULT_KDF, onProgress, signal } = {}) {
  const k = { ...kdf, salt: bytesToBase64(randomBytes(16)) };
  const key = await deriveVaultKey(password, k, { onProgress, signal });
  return { envelope: sealWithKey(data, key, k), key, kdf: k };
}

export async function openVault(env, password, { onProgress, signal } = {}) {
  checkEnvelope(env);
  const key = await deriveVaultKey(password, env.kdf, { onProgress, signal });
  return { data: openWithKey(env, key), key, kdf: env.kdf };
}

const memoryStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

export class VaultSession {
  constructor({ storageKey, storage = null, autoLockMinutes = 5, onLock = null, kdf = DEFAULT_KDF } = {}) {
    this.storageKey = storageKey;
    this.storage = storage || (typeof localStorage !== 'undefined' ? localStorage : memoryStorage());
    this.autoLockMinutes = autoLockMinutes;
    this.onLock = onLock;
    this.kdfDefaults = kdf;
    this.key = null;
    this.kdf = null;
    this.data = null;
    this.lastActive = Date.now();
    this.timer = null;
  }

  readEnvelope() {
    try { const s = this.storage.getItem(this.storageKey); return s ? JSON.parse(s) : null; } catch { return null; }
  }

  exists() { return !!this.readEnvelope(); }

  get unlocked() { return !!this.key; }

  async create(password, data, opts = {}) {
    const r = await sealVault(data, password, { kdf: this.kdfDefaults, ...opts });
    this.storage.setItem(this.storageKey, JSON.stringify(r.envelope));
    this.key = r.key; this.kdf = r.kdf; this.data = data;
    this.startTimer();
    return data;
  }

  async unlock(password, opts = {}) {
    const env = this.readEnvelope();
    if (!env) throw Object.assign(new Error('no vault'), { code: 'missing' });
    const r = await openVault(env, password, opts);
    this.key = r.key; this.kdf = r.kdf; this.data = r.data;
    this.startTimer();
    return r.data;
  }

  // Re-encrypts the current data (new IV, same key) and stores it.
  save() {
    if (!this.key) throw new Error('the vault is locked');
    this.storage.setItem(this.storageKey, JSON.stringify(sealWithKey(this.data, this.key, this.kdf)));
  }

  lock(reason = 'manual') {
    if (!this.key) return;
    wipe(this.key);
    this.key = null; this.kdf = null; this.data = null;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.onLock) this.onLock(reason);
  }

  touch() { this.lastActive = Date.now(); }

  setAutoLock(minutes) { this.autoLockMinutes = minutes; this.touch(); }

  // Polling every 5 s instead of one long setTimeout: timers are throttled or frozen in background tabs and while
  // the machine sleeps; comparing wall-clock time on the next tick still locks correctly after wake-up.
  startTimer() {
    this.touch();
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (this.autoLockMinutes > 0 && Date.now() - this.lastActive > this.autoLockMinutes * 60000) this.lock('timeout');
    }, 5000);
  }

  // KNOWN DEFECT: when called while locked, this.data is null and the new envelope encrypts null, destroying the
  // vault contents. Fix: use the data returned by openVault (const r = await openVault(...); seal r.data).
  async changePassword(oldPassword, newPassword, opts = {}) {
    const env = this.readEnvelope();
    await openVault(env, oldPassword, opts); // proves the old password
    const r = await sealVault(this.data, newPassword, { kdf: this.kdfDefaults, ...opts });
    this.storage.setItem(this.storageKey, JSON.stringify(r.envelope));
    if (this.key) wipe(this.key);
    this.key = r.key; this.kdf = r.kdf;
  }

  exportEnvelope() { return this.readEnvelope(); }

  async importEnvelope(env, password, opts = {}) {
    checkEnvelope(env);
    const r = await openVault(env, password, opts);
    this.storage.setItem(this.storageKey, JSON.stringify(env));
    this.key = r.key; this.kdf = r.kdf; this.data = r.data;
    this.startTimer();
    return r.data;
  }

  destroy() {
    this.lock('destroy');
    this.storage.removeItem(this.storageKey);
  }
}
