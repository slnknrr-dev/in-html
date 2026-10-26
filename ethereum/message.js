// ethereum/message.js - signed messages: EIP-191 personal messages ("\x19Ethereum Signed Message:\n" + length),
// 65-byte r || s || v signatures and EIP-2098 64-byte compact ones, EIP-712 typed structured data (nested structs,
// fixed and dynamic arrays, bytes, string, bool, address, intN / uintN, bytesN). Hashes are '0x…' hex strings.
//
//   hashMessage(message) -> '0x…'               message: string (UTF-8) or Uint8Array
//   signMessage(message, privateKey) -> '0x' + r + s + v (v 27 / 28, low-S)
//   recoverMessageAddress(message, signature) -> checksum address      verifyMessage(message, signature, address)
//   hashValidatorData(validator, data) -> '0x…'  (EIP-191 version 0x00)
//   splitSignature(sig) -> { r, s, v, yParity, compact }   65 bytes (v 0/1, 27/28 or EIP-155 style) or 64 (EIP-2098)
//   joinSignature({ r, s, v | yParity }) -> 65-byte '0x…'    recoverAddress(hash32, signature) -> checksum address
//   EIP-712:
//   encodeType(types, primaryType) -> 'Mail(Person from,Person to,string contents)Person(string name,address wallet)'
//   typeHash(types, primaryType)                   encodeData(types, primaryType, data) -> '0x…' (typeHash || fields)
//   hashStruct(types, primaryType, data)           hashDomain(domain, types?)  (EIP712Domain fields inferred if absent)
//   hashTypedData({ types, primaryType, domain, message }) -> keccak256(0x19 0x01 || domainSeparator || hashStruct)
//   signTypedData(typedData, privateKey) -> 65-byte '0x…'      recoverTypedDataAddress(typedData, signature)
import { keccak256 } from '../crypto/sha3.js';
import { bytesToHex, concatBytes, utf8ToBytes } from '../crypto/encoding.js';
import { CURVE, ecdsaRecover, ecdsaSign, numberToBytes } from '../crypto/secp256k1.js';
import { encodeParameters, parseParam } from './abi.js';
import { addressToBytes, equalAddress, publicKeyToAddress } from './address.js';
import { fromHex, toBigInt } from './units.js';

const hex = (b) => '0x' + bytesToHex(b);
const msgBytes = (m) => (typeof m === 'string' ? utf8ToBytes(m) : m instanceof Uint8Array ? m : (() => { throw new TypeError('message: string or bytes expected'); })());
const hashBytes = (h) => (typeof h === 'string' ? fromHex(h) : h);
const privBytes = (k) => (typeof k === 'string' ? fromHex(k) : k);

// --- EIP-191 ---------------------------------------------------------------------------------------------

// EIP-191 version 0x45 ('E'): the prefix "\x19Ethereum Signed Message:\n" + decimal byte length. 0x19 is not a valid
// first byte of an RLP transaction, so a signed message can never be replayed as a transaction. The length is in
// BYTES of the UTF-8 encoding, not JS string length (UTF-16 units): 'é' is 2 bytes, one char.
export function hashMessage(message) {
  const m = msgBytes(message);
  return hex(keccak256(concatBytes(utf8ToBytes('\x19Ethereum Signed Message:\n' + m.length), m)));
}

export function hashValidatorData(validator, data) {
  return hex(keccak256(concatBytes(Uint8Array.of(0x19, 0x00), addressToBytes(validator), msgBytes(data))));
}

// Recovery ids 2 / 3 occur only when r >= n (probability ~2^-127); they cannot be expressed in a 27/28 v byte.
function signHash(hash, privateKey) {
  const sig = ecdsaSign(hashBytes(hash), privBytes(privateKey));
  if (sig.recovery > 1) throw new Error('signature with an unrepresentable recovery id');
  return joinSignature({ r: sig.r, s: sig.s, yParity: sig.recovery });
}

export const signMessage = (message, privateKey) => signHash(hashMessage(message), privateKey);

// Accepts every v convention in use: 0/1 (yParity), 27/28 (Bitcoin heritage, eth_sign), and EIP-155 style v >= 35.
// High-S signatures are accepted here (recovery works with either s); signers in this module always produce low-S.
// compact (EIP-2098) packs yParity into the top bit of s, which is free only when s < 2^255; null otherwise.
export function splitSignature(sig) {
  let r, s, yParity;
  if (sig && typeof sig === 'object' && !(sig instanceof Uint8Array)) {
    r = toBigInt(sig.r, 'r');
    s = toBigInt(sig.s, 's');
    if (sig.yParity != null) yParity = Number(sig.yParity);
    else if (sig.recovery != null) yParity = Number(sig.recovery);
    else yParity = vToParity(toBigInt(sig.v, 'v'));
  } else {
    const b = typeof sig === 'string' ? fromHex(sig) : sig;
    if (!(b instanceof Uint8Array)) throw new TypeError('signature: hex, bytes or { r, s, v } expected');
    r = BigInt(hex(b.subarray(0, 32)));
    if (b.length === 65) {
      s = BigInt(hex(b.subarray(32, 64)));
      yParity = vToParity(BigInt(b[64]));
    } else if (b.length === 64) {
      // EIP-2098: the top bit of the second word is the y parity.
      const vs = BigInt(hex(b.subarray(32, 64)));
      yParity = Number(vs >> 255n);
      s = vs & ((1n << 255n) - 1n);
    } else throw new Error('signature: 64 or 65 bytes expected');
  }
  if (yParity !== 0 && yParity !== 1) throw new Error('signature: y parity must be 0 or 1');
  if (r <= 0n || r >= CURVE.n || s <= 0n || s >= CURVE.n) throw new Error('signature: r / s out of range');
  const rh = hex(numberToBytes(r)), sh = hex(numberToBytes(s));
  const compact = s >> 255n ? null : rh + bytesToHex(numberToBytes(s | (BigInt(yParity) << 255n)));
  return { r: rh, s: sh, v: 27 + yParity, yParity, compact };
}

function vToParity(v) {
  if (v === 0n || v === 1n) return Number(v);
  if (v === 27n || v === 28n) return Number(v - 27n);
  if (v >= 35n) return Number((v - 35n) % 2n);
  throw new Error(`signature: invalid v ${v}`);
}

export function joinSignature(sig) {
  const p = splitSignature(sig);
  return p.r + p.s.slice(2) + (27 + p.yParity).toString(16);
}

export function recoverAddress(hash, signature) {
  const p = splitSignature(signature);
  const pub = ecdsaRecover(concatBytes(fromHex(p.r), fromHex(p.s)), p.yParity, hashBytes(hash), false);
  return publicKeyToAddress(pub);
}

export const recoverMessageAddress = (message, signature) => recoverAddress(hashMessage(message), signature);

export function verifyMessage(message, signature, address) {
  try { return equalAddress(recoverMessageAddress(message, signature), address); } catch { return false; }
}

// --- EIP-712 ------------------------------------------------------------------------------------------------

const DOMAIN_FIELDS = [
  ['name', 'string'], ['version', 'string'], ['chainId', 'uint256'], ['verifyingContract', 'address'], ['salt', 'bytes32'],
];

// Struct name of a field type ('Person[]' -> 'Person') when it is a struct of `types`.
function structOf(types, type) {
  const base = type.replace(/(\[\d*\])+$/, '');
  return Object.prototype.hasOwnProperty.call(types, base) ? base : null;
}

function fieldsOf(types, name) {
  const f = types[name];
  if (!Array.isArray(f)) throw new Error(`EIP-712: unknown type ${name}`);
  return f;
}

// Depth-first collection of every struct type reachable from primary; the Set doubles as the visited mark, so recursive
// types (A contains A[]) terminate.
function dependencies(types, primary, found = new Set()) {
  if (found.has(primary)) return found;
  found.add(primary);
  for (const field of fieldsOf(types, primary)) {
    const s = structOf(types, field.type);
    if (s) dependencies(types, s, found);
  }
  return found;
}

// EIP-712 encodeType: primary type first, then referenced types sorted by name. The sort makes the type hash
// independent of declaration order; a different order would give a different typeHash and a signature that verifies
// nowhere.
export function encodeType(types, primaryType) {
  const deps = [...dependencies(types, primaryType)].filter((t) => t !== primaryType).sort();
  return [primaryType, ...deps].map((t) => `${t}(${fieldsOf(types, t).map((f) => `${f.type} ${f.name}`).join(',')})`).join('');
}

export const typeHash = (types, primaryType) => hex(keccak256(utf8ToBytes(encodeType(types, primaryType))));

// The 32-byte encoding of one field value.
// Every field becomes exactly 32 bytes, so encodeData is a fixed-width sequence and needs no offsets:
//   arrays   -> keccak256 of the concatenated element encodings
//   structs  -> keccak256(encodeStruct) (= hashStruct)
//   string / bytes -> keccak256 of the content
//   atomic   -> the ABI word (via abi.js, which range-checks intN / uintN and pads bytesN / address)
// Hashing dynamic values (instead of ABI head/tail) is what lets a hardware wallet stream and display fields one by one.
function encodeField(types, type, value, depth) {
  if (depth > 64) throw new Error('EIP-712: data nested too deeply');
  const arr = /^(.*)\[(\d*)\]$/.exec(type);
  if (arr) {
    if (!Array.isArray(value)) throw new Error(`EIP-712: ${type} expects an array`);
    if (arr[2] !== '' && value.length !== Number(arr[2])) throw new Error(`EIP-712: ${type} expects ${arr[2]} elements`);
    return keccak256(concatBytes(...value.map((v) => encodeField(types, arr[1], v, depth + 1))));
  }
  if (structOf(types, type)) return keccak256(encodeStruct(types, type, value, depth + 1));
  if (type === 'string') {
    if (typeof value !== 'string') throw new Error('EIP-712: string expected');
    return keccak256(utf8ToBytes(value));
  }
  if (type === 'bytes') return keccak256(typeof value === 'string' ? fromHex(value) : value);
  const p = parseParam(type);
  if (p.kind === 'array' || p.kind === 'tuple') throw new Error(`EIP-712: unknown type ${type}`);
  return fromHex(encodeParameters([p], [value]));
}

function encodeStruct(types, primaryType, data, depth = 0) {
  if (!data || typeof data !== 'object') throw new Error(`EIP-712: ${primaryType} expects an object`);
  const parts = [keccak256(utf8ToBytes(encodeType(types, primaryType)))];
  for (const f of fieldsOf(types, primaryType)) {
    if (data[f.name] === undefined) throw new Error(`EIP-712: ${primaryType}.${f.name} is missing`);
    parts.push(encodeField(types, f.type, data[f.name], depth));
  }
  return concatBytes(...parts);
}

export const encodeData = (types, primaryType, data) => hex(encodeStruct(types, primaryType, data));
export const hashStruct = (types, primaryType, data) => hex(keccak256(encodeStruct(types, primaryType, data)));

// When EIP712Domain is not declared, its fields are inferred from the keys present, in the canonical order of the EIP.
// Including an absent field (or using a different order) changes the domain separator and breaks verification.
function domainTypes(domain, types) {
  if (types && types.EIP712Domain) return types;
  return { ...(types || {}), EIP712Domain: DOMAIN_FIELDS.filter(([n]) => domain[n] !== undefined).map(([name, type]) => ({ name, type })) };
}

export const hashDomain = (domain, types = null) => hashStruct(domainTypes(domain || {}, types), 'EIP712Domain', domain || {});

// Final digest: keccak256(0x19 0x01 || domainSeparator || hashStruct(message)). The domain (chainId, verifying
// contract) binds the signature to one deployment; primaryType 'EIP712Domain' signs the domain alone (no message hash).
export function hashTypedData({ types, primaryType, domain = {}, message }) {
  const all = domainTypes(domain, types);
  const parts = [Uint8Array.of(0x19, 0x01), fromHex(hashStruct(all, 'EIP712Domain', domain))];
  if (primaryType !== 'EIP712Domain') parts.push(fromHex(hashStruct(all, primaryType, message)));
  return hex(keccak256(concatBytes(...parts)));
}

export const signTypedData = (typedData, privateKey) => signHash(hashTypedData(typedData), privateKey);
export const recoverTypedDataAddress = (typedData, signature) => recoverAddress(hashTypedData(typedData), signature);
