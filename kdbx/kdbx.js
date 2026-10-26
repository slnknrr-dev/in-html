// kdbx/kdbx.js - public API of the KDBX library: open, create and save KeePass databases (see README.md).
//
//   const creds = new KdbxCredentials({ password, keyFile });
//   const db = await openKdbx(bytes, creds, { onProgress, signal });   // KDBX 3.1, 4.0, 4.1
//   const db = createKdbx({ name, credentials, kdf, cipher });           // new KDBX 4 database
//   const bytes = await saveKdbx(db, { onProgress, signal });            // KDBX 4.0 (4.1 when opened as 4.1)
//
// Module map: bytes.js (binary primitives) <- protect.js (in-memory masking, inner stream) <- keys.js (composite key)
// <- model.js (object graph) <- document.js (XML <-> model) <- format.js (container: header, KDF, cipher, HMAC
// blocks). This file only re-exports and builds a fresh database, so applications import one path and the
// internal layering can change without breaking them.
import { KdbxDatabase } from './model.js';
import { loadKdbx, saveKdbx, readHeader, KdbxError, transformKey, aesKdfHalf, aesKdfFinish } from './format.js';
import { now } from './bytes.js';

// New-database defaults follow KeePassXC's: Argon2d, 64 MiB, 2 iterations, parallelism 2, Argon2 version 0x13 (1.3).
// Argon2 over AES-KDF because it is memory-hard (GPU/ASIC guessing costs RAM, not just cycles); 'd' over 'id' for
// compatibility with the KeePass default - side channels matter less for an offline file than for a server.
// AES-KDF keeps 100 000 rounds only as a legacy option for KDBX 3-era clients. link() wires parent pointers.
export function createKdbx({ name = 'Passwords', credentials = null, kdf = 'argon2d', cipher = 'aes256' } = {}) {
  const db = new KdbxDatabase();
  db.meta.name = name;
  db.meta.generator = 'in-html kdbx';
  db.meta.settingsChanged = now();
  db.root.name = name;
  db.header.cipher = cipher;
  db.header.kdf = kdf === 'aes' ? { type: 'aes', rounds: 100000 }
    : { type: kdf === 'argon2id' ? 'argon2id' : 'argon2d', memory: 64 * 1024 * 1024, iterations: 2, parallelism: 2, version: 0x13 };
  db.credentials = credentials;
  db.link();
  return db;
}

export const openKdbx = loadKdbx;
export { saveKdbx, readHeader, KdbxError, transformKey, aesKdfHalf, aesKdfFinish };
export { KdbxDatabase, KdbxEntry, KdbxGroup, KdbxMeta, KdbxTimes, KdbxBinary, STANDARD_FIELDS, ICON, ICON_NAMES } from './model.js';
export { KdbxCredentials, generateKeyFile, keyFileKey } from './keys.js';
export { ProtectedValue } from './protect.js';
export { entryOtp, otpCode, hotp, totp, parseOtpUri, buildOtpUri, setEntryOtp } from './otp.js';
export { ZERO_UUID, newUuid, isZeroUuid, uuidHex, uuidFromHex } from './bytes.js';
