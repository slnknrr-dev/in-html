// kdbx/protect.js - protected values (passwords and other secret fields) and the inner random streams of KDBX.
//
//   ProtectedValue.fromString(s) / fromBytes(b): the value is kept XOR-masked with a random pad in memory, so a
//     heap dump does not show it as plain text; .getText(), .getBytes(), .length, .equals(other), .destroy()
//   createInnerStream(id, key): KDBX inner stream (2 = Salsa20 of KDBX 3, 3 = ChaCha20 of KDBX 4) with
//     .apply(bytes) -> bytes XORed with the next keystream bytes (protected XML values in document order)
import { Salsa20 } from '../crypto/salsa.js';
import { ChaCha20 } from '../crypto/chacha.js';
import { sha256, sha512 } from '../crypto/sha2.js';
import { bytesToUtf8, utf8ToBytes, wipe } from '../crypto/encoding.js';
import { randomBytes } from '../crypto/random.js';

// Threat model, stated honestly: XOR masking defeats casual exposure (heap snapshots, string searches in a crash
// dump, accidental logging) - the pad sits right next to the data, so it is not encryption against an attacker
// with full memory access. JS cannot guarantee wiping either: every getText() creates an immutable string the GC
// frees whenever it likes. Hence toString/toJSON return '[protected]', so template literals and JSON.stringify never
// leak the value by accident.
export class ProtectedValue {
  constructor(masked, pad) { this.masked = masked; this.pad = pad; }

  static fromBytes(bytes) {
    const pad = randomBytes(bytes.length), masked = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) masked[i] = bytes[i] ^ pad[i];
    return new ProtectedValue(masked, pad);
  }

  static fromString(s) {
    const b = utf8ToBytes(String(s));
    const v = ProtectedValue.fromBytes(b);
    wipe(b);
    return v;
  }

  getBytes() {
    const out = new Uint8Array(this.masked.length);
    for (let i = 0; i < out.length; i++) out[i] = this.masked[i] ^ this.pad[i];
    return out;
  }

  getText() {
    const b = this.getBytes();
    const s = bytesToUtf8(b);
    wipe(b);
    return s;
  }

  get length() { return this.masked.length; }
  get byteLength() { return this.masked.length; }

  // Branch-free comparison over the common length with the length difference folded in: timing does not reveal the
  // position of the first mismatch. (The length itself still leaks via loop count - acceptable for a UI check.)
  equals(other) {
    const a = this.getBytes(), b = other instanceof ProtectedValue ? other.getBytes() : utf8ToBytes(String(other));
    let d = a.length ^ b.length;
    for (let i = 0; i < Math.min(a.length, b.length); i++) d |= a[i] ^ b[i];
    wipe(a, b);
    return d === 0;
  }

  clone() { return new ProtectedValue(this.masked.slice(), this.pad.slice()); }
  destroy() { wipe(this.masked, this.pad); }
  toString() { return '[protected]'; }
  toJSON() { return '[protected]'; }
}

// Inner random stream: inside the decrypted XML, protected values are additionally XORed with a keystream, in
// document order, so the XML never contains plaintext passwords even after outer decryption. Order is the contract:
// reader and writer must call apply() for exactly the same values in exactly the same sequence, or every value after
// the first divergence decrypts to garbage.
// ArcFour (1) is refused - obsolete and never written by KDBX 3.1+. Salsa20 uses SHA-256(key) and a fixed IV
// defined by KeePass; ChaCha20 derives key (32) and nonce (12) from SHA-512(key).
export const INNER_STREAM = { none: 0, arcfour: 1, salsa20: 2, chacha20: 3 };
const SALSA_IV = new Uint8Array([0xe8, 0x30, 0x09, 0x4b, 0x97, 0x20, 0x5d, 0x2a]);

export function createInnerStream(id, key) {
  let cipher;
  if (id === INNER_STREAM.salsa20) cipher = new Salsa20(sha256(key), SALSA_IV);
  else if (id === INNER_STREAM.chacha20) {
    const h = sha512(key);
    cipher = new ChaCha20(h.subarray(0, 32), h.subarray(32, 44));
  } else if (id === INNER_STREAM.none) cipher = { update: (b) => b.slice() };
  else throw new Error('unsupported inner random stream ' + id);
  return { apply: (bytes) => cipher.update(bytes), destroy: () => cipher.destroy && cipher.destroy() };
}
