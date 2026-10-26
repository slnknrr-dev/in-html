// ethereum/address.js - Ethereum addresses: the last 20 bytes of keccak256 of the uncompressed public key, EIP-55
// mixed-case checksums (EIP-1191 chain-specific checksums for the chains that adopted it), validation, contract
// addresses of CREATE and CREATE2 (EIP-1014).
//
//   ZERO_ADDRESS                                     '0x0000000000000000000000000000000000000000'
//   publicKeyToAddress(pub33or65) -> checksum address        privateKeyToAddress(priv) -> checksum address
//   toChecksumAddress(addr, chainId = null) -> string
//       EIP-55; with a chainId of EIP1191_CHAINS (RSK 30 / 31) the EIP-1191 variant (keccak of "<chainId>0x<hex>")
//   isAddress(text, { strict = false, chainId = null }) -> boolean
//       '0x' + 40 hex digits; a mixed-case address must carry a valid checksum; strict: the checksum is required
//   isChecksumAddress(text, chainId = null) -> boolean        getAddress(text) -> EIP-55 address or throws
//   addressToBytes(addr) -> Uint8Array(20)                    equalAddress(a, b) -> boolean (case-insensitive)
//   contractAddress(from, nonce) -> address of CREATE (keccak256(rlp([from, nonce]))[12..])
//   create2Address(from, salt32, initCodeHash32) -> address of CREATE2 (keccak256(0xff ++ from ++ salt ++ hash)[12..])
//   shortAddress(addr, { head = 4, tail = 4 }) -> '0x1234…abcd'
//   EIP1191_CHAINS: Set of chain ids that use EIP-1191 checksums (callers may add more)
import { keccak256 } from '../crypto/sha3.js';
import { bytesToHex, concatBytes, utf8ToBytes } from '../crypto/encoding.js';
import { convertPublicKey, getPublicKey } from '../crypto/secp256k1.js';
import { rlpEncode } from './rlp.js';
import { fromHex, toBigInt } from './units.js';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const EIP1191_CHAINS = new Set([30, 31]);

// Shape check only; checksum validity is a separate decision (isAddress / getAddress), because all-lower and all-upper
// addresses are valid but carry no checksum (EIP-55 is backward compatible by design).
const HEX40 = /^0x[0-9a-fA-F]{40}$/;

function lowerHex(addr) {
  if (addr instanceof Uint8Array) {
    if (addr.length !== 20) throw new Error('address: 20 bytes expected');
    return bytesToHex(addr);
  }
  if (typeof addr !== 'string' || !HEX40.test(addr)) throw new Error(`invalid address ${typeof addr === 'string' ? JSON.stringify(addr) : typeof addr}`);
  return addr.slice(2).toLowerCase();
}

// EIP-55: hash the lower-case ASCII hex (not the bytes!) with keccak256; hex letter i is upper-cased when nibble i of
// the hash is >= 8. About 15 of 40 characters are letters, each carrying ~1 bit, so a random typo passes with
// probability ~2^-15. EIP-1191 prefixes "<chainId>0x" so the same key yields different checksums per chain (RSK); it
// is opt-in per chain because applying it on Ethereum would mark every correct EIP-55 address as wrong.
export function toChecksumAddress(addr, chainId = null) {
  const hex = lowerHex(addr);
  const id = chainId == null ? null : Number(chainId);
  const input = id != null && EIP1191_CHAINS.has(id) ? `${id}0x${hex}` : hex;
  const h = bytesToHex(keccak256(utf8ToBytes(input)));
  let out = '0x';
  for (let i = 0; i < 40; i++) out += parseInt(h[i], 16) >= 8 ? hex[i].toUpperCase() : hex[i];
  return out;
}

export function isChecksumAddress(text, chainId = null) {
  return typeof text === 'string' && HEX40.test(text) && toChecksumAddress(text, chainId) === text;
}

// Non-strict: uniform case is accepted unchecked (legacy addresses); mixed case is a checksum claim and must be right.
// Strict: only a correct checksum passes, for inputs where a silent typo would send funds to nobody.
export function isAddress(text, { strict = false, chainId = null } = {}) {
  if (typeof text !== 'string' || !HEX40.test(text)) return false;
  const body = text.slice(2);
  if (!strict && (body === body.toLowerCase() || body === body.toUpperCase())) return true;
  return toChecksumAddress(text, chainId) === text;
}

// The EIP-55 form of a valid address; a mixed-case input with a wrong checksum throws (a typo).
export function getAddress(text) {
  if (text instanceof Uint8Array) return toChecksumAddress(text);
  if (typeof text !== 'string' || !HEX40.test(text)) throw new Error(`invalid address ${typeof text === 'string' ? JSON.stringify(text) : typeof text}`);
  if (!isAddress(text)) throw new Error(`bad address checksum ${JSON.stringify(text)}`);
  return toChecksumAddress(text);
}

export const addressToBytes = (addr) => fromHex(lowerHex(addr));

// Case-insensitive byte comparison; invalid input compares unequal rather than throwing (used in boolean checks).
export function equalAddress(a, b) {
  try { return lowerHex(a) === lowerHex(b); } catch { return false; }
}

// Address = last 20 bytes of keccak256(X || Y), the 64-byte uncompressed point WITHOUT the 0x04 prefix. Hashing the
// 33-byte compressed form, or including 0x04, gives a valid-looking but wrong address, so compressed keys are first
// decompressed and a bare 64-byte key is accepted as X || Y.
export function publicKeyToAddress(pub) {
  const p = typeof pub === 'string' ? fromHex(pub) : pub;
  const full = p.length === 64 ? concatBytes(Uint8Array.of(4), p) : convertPublicKey(p, false);
  return toChecksumAddress(keccak256(full.subarray(1)).subarray(12));
}

export const privateKeyToAddress = (priv) => publicKeyToAddress(getPublicKey(typeof priv === 'string' ? fromHex(priv) : priv, false));

// CREATE: keccak256(rlp([sender, nonce]))[12..]. Nonce 0 RLP-encodes as the empty string 0x80 (see rlp.js intBytes),
// which is why a bigint goes through rlpEncode rather than a hand-made byte array.
export function contractAddress(from, nonce) {
  const n = toBigInt(nonce, 'nonce');
  if (n < 0n) throw new Error('nonce: negative');
  return toChecksumAddress(keccak256(rlpEncode([addressToBytes(from), n])).subarray(12));
}

function bytes32(v, what) {
  const b = typeof v === 'string' ? fromHex(v) : v;
  if (!(b instanceof Uint8Array) || b.length !== 32) throw new Error(`${what}: 32 bytes expected`);
  return b;
}

// CREATE2 (EIP-1014): keccak256(0xff || sender || salt || keccak256(initCode))[12..]. 0xff cannot start an RLP list
// of the CREATE form, so the two address spaces cannot collide. The caller passes the init code HASH, not the code.
export function create2Address(from, salt, initCodeHash) {
  const data = concatBytes(Uint8Array.of(0xff), addressToBytes(from), bytes32(salt, 'salt'), bytes32(initCodeHash, 'init code hash'));
  return toChecksumAddress(keccak256(data).subarray(12));
}

export function shortAddress(addr, { head = 4, tail = 4 } = {}) {
  const a = toChecksumAddress(addr);
  return a.slice(0, 2 + head) + '…' + a.slice(42 - tail);
}
