// kdbx/keys.js - the composite key of a database (password and / or key file) and key files.
//
//   new KdbxCredentials({ password?: string | ProtectedValue, keyFile?: Uint8Array }) .compositeKey() -> 32 bytes
//     composite = SHA-256(SHA-256(UTF-8 password) || keyFileKey), each component optional
//   keyFileKey(bytes) -> 32 bytes: XML key file v1 (base64) or v2 (hex with hash check), 32 raw bytes, 64 hex characters,
//     anything else hashed with SHA-256 (the rules of KeePass 2.x / KeePassXC)
//   generateKeyFile() -> { bytes (XML v2.0), key }
import { sha256 } from '../crypto/sha2.js';
import { base64ToBytes, bytesToHex, bytesToUtf8, concatBytes, hexToBytes, utf8ToBytes, wipe } from '../crypto/encoding.js';
import { randomBytes } from '../crypto/random.js';
import { parseXML, path, textOf, attr, root } from '../xml/xml.js';
import { ProtectedValue } from './protect.js';

// Detection order matters and mirrors KeePass: XML first (only for files < 16 KiB that decode as strict UTF-8 and
// contain <KeyFile>), then exactly 32 bytes = raw key, then exactly 64 hex characters = hex key, else SHA-256 of
// the whole file (any file can be a key file). Reordering would change the derived key for some files and lock
// users out of existing databases.
// XML v2.0 carries a 4-byte SHA-256 prefix as a typo/corruption check; v1.0 is base64 with no check.
export function keyFileKey(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // XML key file (KeePass 2.x): <KeyFile><Meta><Version>1.0|2.0</Version></Meta><Key><Data [Hash]>...</Data></Key></KeyFile>
  if (b.length < 4096 * 4) {
    let text = null;
    try { text = bytesToUtf8(b, true); } catch { text = null; }
    if (text && /<KeyFile[\s>]/.test(text)) {
      const doc = parseXML(text);
      const r = root(doc);
      const version = textOf(path(r, 'Meta', 'Version')).trim();
      const dataEl = path(r, 'Key', 'Data');
      if (!dataEl) throw new Error('invalid key file: no Key/Data');
      const data = textOf(dataEl).replace(/\s+/g, '');
      if (version.startsWith('2.')) {
        const key = hexToBytes(data);
        const hash = attr(dataEl, 'Hash');
        if (hash && bytesToHex(sha256(key).subarray(0, 4)).toLowerCase() !== hash.toLowerCase()) throw new Error('the key file is corrupted (hash mismatch)');
        return key;
      }
      if (version.startsWith('1.') || !version) return base64ToBytes(data);
      throw new Error('unsupported key file version ' + version);
    }
  }
  if (b.length === 32) return b.slice();
  if (b.length === 64) {
    const s = String.fromCharCode(...b);
    if (/^[0-9a-fA-F]{64}$/.test(s)) return hexToBytes(s);
  }
  return sha256(b);
}

// Writes the KeePass 2.x v2.0 XML layout byte-for-byte (tabs, upper-case hex in 8-digit groups, two lines of four):
// other clients parse it either way, but matching the reference layout keeps diffs and support questions simple.
export function generateKeyFile() {
  const key = randomBytes(32);
  const hex = bytesToHex(key).toUpperCase();
  const groups = hex.match(/.{8}/g);
  const hash = bytesToHex(sha256(key).subarray(0, 4)).toUpperCase();
  const xml = '<?xml version="1.0" encoding="utf-8"?>\n<KeyFile>\n\t<Meta>\n\t\t<Version>2.0</Version>\n\t</Meta>\n\t<Key>\n'
    + `\t\t<Data Hash="${hash}">\n\t\t\t${groups.slice(0, 4).join(' ')}\n\t\t\t${groups.slice(4).join(' ')}\n\t\t</Data>\n\t</Key>\n</KeyFile>\n`;
  return { bytes: utf8ToBytes(xml), key };
}

// Stores only the component HASHES, never the password itself: the plaintext is hashed and wiped in the constructor,
// so a long-lived credentials object holds nothing a heap dump could turn back into the password. The composite is
// SHA-256 over the concatenation in fixed order (password, key file); KeePass also supports a Windows user account
// component, which is deliberately unsupported (not portable). destroy() wipes the hashes.
export class KdbxCredentials {
  // password: string or ProtectedValue (null / undefined: no password); keyFile: the bytes of the key file.
  constructor({ password = null, keyFile = null } = {}) {
    this.passwordHash = null;
    this.keyFileHash = null;
    if (password != null) {
      const pw = password instanceof ProtectedValue ? password.getBytes() : utf8ToBytes(String(password));
      this.passwordHash = sha256(pw);
      wipe(pw);
    }
    if (keyFile) this.keyFileHash = keyFileKey(keyFile);
    if (!this.passwordHash && !this.keyFileHash) throw new Error('a password or a key file is required');
  }

  compositeKey() {
    const parts = [this.passwordHash, this.keyFileHash].filter(Boolean);
    const all = concatBytes(...parts);
    const out = sha256(all);
    wipe(all);
    return out;
  }

  destroy() { wipe(this.passwordHash, this.keyFileHash); this.passwordHash = this.keyFileHash = null; }
}
