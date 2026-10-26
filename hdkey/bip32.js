// hdkey/bip32.js - BIP-32 hierarchical deterministic keys on secp256k1: master keys from a seed, private and public
// child derivation (hardened and normal), paths ("m/84'/0'/0'", "84h/0h/0h/0/5"), fingerprints, extended key
// serialisation (Base58Check) with the SLIP-132 version bytes (xpub / ypub / zpub / Ypub / Zpub and the testnet
// tpub / upub / vpub / Upub / Vpub).
//
//   HDKey.fromMasterSeed(seed, prefix = 'xprv')       HDKey.fromExtendedKey(text)   (any SLIP-132 prefix)
//   key.derive("m/84'/0'/0'") / key.deriveChild(index) / key.neuter() (public only) / key.wipe()
//   key.privateKey (32 bytes | null), key.publicKey (33, compressed), key.chainCode, key.depth, key.index,
//   key.parentFingerprint, key.fingerprint (uint32), key.identifier (HASH160 of the public key), key.prefix
//   key.toExtendedKey(prefix?) -> string (prefix: 'xpub', 'zprv', … default: the key's own), key.xpub, key.xprv
//   parsePath(path) -> [uint32], formatPath(indexes, mark = "'") -> 'm/…', HARDENED
//   convertExtendedKey(text, prefix) -> the same key with other version bytes (zpub -> xpub, …)
//   VERSIONS: prefix -> { version, private, network, script }    hash160(bytes)
//
// Security posture: private keys and chain codes live in Uint8Arrays (wipeable, unlike strings), intermediate HMAC
// outputs are wiped after use, and every key entering the class is range-checked (0 < k < n, valid curve point).
// Wiping in JS is best effort: the engine may have copied the bytes; it still shortens the exposure window.
// Validation is fail-fast with a specific message, because a silently wrong derivation means lost funds.
import { sha256 } from '../crypto/sha2.js';
import { ripemd160 } from '../crypto/ripemd.js';
import { hmac } from '../crypto/hmac.js';
import { sha512 } from '../crypto/sha2.js';
import { concatBytes, utf8ToBytes, wipe } from '../crypto/encoding.js';
import { base58checkDecode, base58checkEncode } from '../crypto/base58check.js';
import { getPublicKey, isValidPrivateKey, isValidPublicKey, privateAdd, publicAdd, CURVE, bytesToNumber } from '../crypto/secp256k1.js';

export const HARDENED = 0x80000000;

export const hash160 = (b) => ripemd160(sha256(b));

// SLIP-132: script = what the key's addresses are (p2pkh: BIP-44 or any, p2sh-p2wpkh: BIP-49, p2wpkh: BIP-84,
// p2sh-p2wsh / p2wsh: multisig); network 'main' or 'test' (testnet, signet and regtest share the test versions).
export const VERSIONS = {
  xpub: { version: 0x0488b21e, private: false, network: 'main', script: 'p2pkh' },
  xprv: { version: 0x0488ade4, private: true, network: 'main', script: 'p2pkh' },
  ypub: { version: 0x049d7cb2, private: false, network: 'main', script: 'p2sh-p2wpkh' },
  yprv: { version: 0x049d7878, private: true, network: 'main', script: 'p2sh-p2wpkh' },
  zpub: { version: 0x04b24746, private: false, network: 'main', script: 'p2wpkh' },
  zprv: { version: 0x04b2430c, private: true, network: 'main', script: 'p2wpkh' },
  Ypub: { version: 0x0295b43f, private: false, network: 'main', script: 'p2sh-p2wsh' },
  Yprv: { version: 0x0295b005, private: true, network: 'main', script: 'p2sh-p2wsh' },
  Zpub: { version: 0x02aa7ed3, private: false, network: 'main', script: 'p2wsh' },
  Zprv: { version: 0x02aa7a99, private: true, network: 'main', script: 'p2wsh' },
  tpub: { version: 0x043587cf, private: false, network: 'test', script: 'p2pkh' },
  tprv: { version: 0x04358394, private: true, network: 'test', script: 'p2pkh' },
  upub: { version: 0x044a5262, private: false, network: 'test', script: 'p2sh-p2wpkh' },
  uprv: { version: 0x044a4e28, private: true, network: 'test', script: 'p2sh-p2wpkh' },
  vpub: { version: 0x045f1cf6, private: false, network: 'test', script: 'p2wpkh' },
  vprv: { version: 0x045f18bc, private: true, network: 'test', script: 'p2wpkh' },
  Upub: { version: 0x024289ef, private: false, network: 'test', script: 'p2sh-p2wsh' },
  Uprv: { version: 0x024285b5, private: true, network: 'test', script: 'p2sh-p2wsh' },
  Vpub: { version: 0x02575483, private: false, network: 'test', script: 'p2wsh' },
  Vprv: { version: 0x02575048, private: true, network: 'test', script: 'p2wsh' },
};
// Reverse lookup for parsing; the 4-byte versions are unique, which SLIP-132 guarantees.
const BY_VERSION = new Map(Object.entries(VERSIONS).map(([k, v]) => [v.version, k]));

// The private / public twin of a prefix: 'zpub' <-> 'zprv'.
// Valid because every registered prefix is a single letter + 'pub' / 'prv'.
export const twinPrefix = (prefix) => prefix.slice(0, 1) + (prefix.endsWith('pub') ? 'prv' : 'pub');

// "m/44'/0'/0'/0/1", "44h/0H/0'/1", "m" -> uint32 indexes (hardened ones + 2^31).
// Accepts the three hardened markers in the wild (', h, H). Indexes must be below 2^31 before marking; a raw index
// >= 2^31 would be ambiguous with the hardened range and is rejected.
export function parsePath(path) {
  const s = String(path).trim();
  if (s === '' || s === 'm' || s === 'M') return [];
  const parts = s.split('/');
  if (parts[0] === 'm' || parts[0] === 'M') parts.shift();
  return parts.map((p) => {
    const m = /^(\d+)(['hH]?)$/.exec(p);
    if (!m) throw new Error(`invalid path element "${p}"`);
    const n = Number(m[1]);
    if (!(n < HARDENED)) throw new Error(`path index out of range: ${p}`);
    return m[2] ? n + HARDENED : n;
  });
}

export const formatPath = (indexes, mark = "'") =>
  ['m', ...indexes.map((i) => (i >= HARDENED ? (i - HARDENED) + mark : String(i)))].join('/');

const u32 = (n) => Uint8Array.of(n >>> 24, n >>> 16, n >>> 8, n);
// >>> 0 converts the signed 32-bit result of the shifts to an unsigned value (b[o] << 24 can be negative).
const readU32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const MASTER_SECRET = utf8ToBytes('Bitcoin seed');

export class HDKey {
  constructor({ privateKey = null, publicKey = null, chainCode, depth = 0, index = 0, parentFingerprint = 0, prefix = 'xprv' }) {
    if (!chainCode || chainCode.length !== 32) throw new Error('chain code: 32 bytes expected');
    if (privateKey && !isValidPrivateKey(privateKey)) throw new Error('invalid private key');
    if (!privateKey && (!publicKey || publicKey.length !== 33 || !isValidPublicKey(publicKey))) throw new Error('invalid public key');
    this._priv = privateKey ? Uint8Array.from(privateKey) : null;
    this._pub = publicKey ? Uint8Array.from(publicKey) : null;
    this.chainCode = Uint8Array.from(chainCode);
    this.depth = depth;
    this.index = index;
    this.parentFingerprint = parentFingerprint >>> 0;
    // The key's own family of version bytes, kept for serialisation (private or public twin as needed).
    this.prefix = VERSIONS[prefix] ? prefix : 'xprv';
  }

  // BIP-32 master key: I = HMAC-SHA512("Bitcoin seed", seed); the seed has 16..64 bytes.
  // The 16-64 byte bound is BIP-32's; a 64-byte BIP-39 seed is the common case.
  static fromMasterSeed(seed, prefix = 'xprv') {
    if (seed.length < 16 || seed.length > 64) throw new Error('seed: 16 to 64 bytes expected');
    const I = hmac(sha512, MASTER_SECRET, seed);
    const key = new HDKey({ privateKey: I.subarray(0, 32), chainCode: I.subarray(32), prefix });
    wipe(I);
    return key;
  }

  static fromExtendedKey(text) {
    let b;
    try { b = base58checkDecode(String(text).trim()); } catch (e) { throw new Error('extended key: ' + e.message); }
    if (b.length !== 78) throw new Error('extended key: 78 bytes expected');
    const prefix = BY_VERSION.get(readU32(b, 0));
    if (!prefix) throw new Error('extended key: unknown version');
    const depth = b[4], parentFingerprint = readU32(b, 5), index = readU32(b, 9);
    // BIP-32 test vector 5 class checks: such keys are malformed and must not be accepted silently.
    if (depth === 0 && (parentFingerprint !== 0 || index !== 0)) throw new Error('extended key: zero depth with a parent fingerprint or index');
    const chainCode = b.subarray(13, 45), k = b.subarray(45);
    if (VERSIONS[prefix].private) {
      if (k[0] !== 0) throw new Error('extended key: private key prefix');
      const d = k.subarray(1);
      const n = bytesToNumber(d);
      if (n === 0n || n >= CURVE.n) throw new Error('extended key: private key out of range');
      return new HDKey({ privateKey: d, chainCode, depth, index, parentFingerprint, prefix });
    }
    if ((k[0] !== 2 && k[0] !== 3) || !isValidPublicKey(k)) throw new Error('extended key: invalid public key');
    return new HDKey({ publicKey: k, chainCode, depth, index, parentFingerprint, prefix });
  }

  get privateKey() { return this._priv; }

  // Lazily computed and cached: point multiplication is the costliest step, and a path derivation only needs the
  // public key of keys whose fingerprint or normal children are requested.
  get publicKey() {
    if (!this._pub) this._pub = getPublicKey(this._priv, true);
    return this._pub;
  }

  get identifier() { return hash160(this.publicKey); }

  get fingerprint() { return readU32(this.identifier, 0); }

  get isPrivate() { return !!this._priv; }

  // CKDpriv / CKDpub (BIP-32): hardened children need the private key.
  deriveChild(index) {
    if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) throw new Error('child index out of range');
    let data;
    // Hardened: HMAC over 0x00 || k_par || index, so a leaked child private key plus the parent xpub cannot reveal
    // the parent private key. Normal: HMAC over K_par || index, which makes public derivation (xpub -> child xpub)
    // possible.
    if (index >= HARDENED) {
      if (!this._priv) throw new Error('a hardened child needs the private key');
      data = concatBytes(Uint8Array.of(0), this._priv, u32(index));
    } else {
      data = concatBytes(this.publicKey, u32(index));
    }
    const I = hmac(sha512, this.chainCode, data);
    const IL = I.subarray(0, 32), IR = I.subarray(32);
    // Probability ~2^-127; BIP-32 says to skip to the next index. Surfaced as an error rather than skipping silently,
    // so the caller decides and paths stay predictable. A zero child key / point at infinity is rejected by the
    // HDKey constructor's validity checks.
    if (bytesToNumber(IL) >= CURVE.n) throw new Error('invalid child key, use the next index');
    const opts = { chainCode: IR, depth: this.depth + 1, index, parentFingerprint: this.fingerprint, prefix: this.prefix };
    const child = this._priv
      ? new HDKey({ ...opts, privateKey: privateAdd(this._priv, IL) })
      : new HDKey({ ...opts, publicKey: publicAdd(this.publicKey, IL) });
    wipe(I, data);
    return child;
  }

  // An absolute path from the master ("m/…", only at depth 0) or a path relative to this key ("0/5", "m" = this key).
  derive(path) {
    const s = String(path).trim();
    if (/^[mM](\/|$)/.test(s) && this.depth !== 0) throw new Error('an absolute path needs the master key');
    let k = this;
    for (const i of parsePath(s)) k = k.deriveChild(i);
    return k;
  }

  // The public-only twin (watch-only wallets, sharing).
  neuter() {
    return new HDKey({ publicKey: this.publicKey, chainCode: this.chainCode, depth: this.depth, index: this.index, parentFingerprint: this.parentFingerprint, prefix: this.prefix });
  }

  // Serialised key: private when it has one and the prefix is private (default), else public.
  // An explicit prefix decides private vs public; without one, the key serialises in its own kind. A prefix of the
  // wrong kind is switched to its twin instead of throwing, so toExtendedKey('zpub') works on a private key.
  toExtendedKey(prefix = null, { publicOnly = false } = {}) {
    let p = prefix || this.prefix;
    if (!VERSIONS[p]) throw new Error(`unknown extended key prefix "${p}"`);
    const wantPrivate = !publicOnly && (prefix ? VERSIONS[p].private : !!this._priv);
    if (VERSIONS[p].private !== wantPrivate) p = twinPrefix(p);
    if (wantPrivate && !this._priv) throw new Error('no private key');
    const key = wantPrivate ? concatBytes(Uint8Array.of(0), this._priv) : this.publicKey;
    const out = concatBytes(u32(VERSIONS[p].version), Uint8Array.of(this.depth), u32(this.parentFingerprint), u32(this.index), this.chainCode, key);
    return base58checkEncode(out);
  }

  get xprv() { return this.toExtendedKey(this.prefix.slice(0, 1) + 'prv'); }

  get xpub() { return this.toExtendedKey(this.prefix.slice(0, 1) + 'pub'); }

  // Overwrites the private key and chain code (the object is unusable for derivation afterwards).
  wipe() { wipe(this._priv, this.chainCode); this._priv = null; }
}

// The same extended key with other SLIP-132 version bytes ('zpub…' -> 'xpub…'); private keys stay private.
export function convertExtendedKey(text, prefix) {
  const k = HDKey.fromExtendedKey(text);
  if (!VERSIONS[prefix]) throw new Error(`unknown extended key prefix "${prefix}"`);
  const p = VERSIONS[prefix].private === k.isPrivate ? prefix : twinPrefix(prefix);
  return k.toExtendedKey(p);
}

// Prefix of an extended key text ('xpub', 'zprv', …) or null.
export function extendedKeyPrefix(text) {
  try { const b = base58checkDecode(String(text).trim()); return b.length === 78 ? BY_VERSION.get(readU32(b, 0)) || null : null; } catch { return null; }
}

export const fingerprintHex = (fp) => (fp >>> 0).toString(16).padStart(8, '0');
