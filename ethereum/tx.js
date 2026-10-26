// ethereum/tx.js - Ethereum transactions: legacy (type 0, with or without EIP-155 replay protection), EIP-2930
// access lists (type 1) and EIP-1559 fees (type 2) are built, signed, serialized and parsed; EIP-4844 blob (type 3,
// also the network form with the blob sidecar) and EIP-7702 set-code (type 4) transactions are parsed for explorers
// (their authorizations are recovered too) but not signed. Typed envelopes follow EIP-2718.
//
// A transaction object: { type, chainId, nonce, gasPrice | maxPriorityFeePerGas + maxFeePerGas, gasLimit, to
// (checksum address or null for a contract creation), value, data ('0x…'), accessList [{ address, storageKeys }],
// maxFeePerBlobGas + blobVersionedHashes (type 3), authorizationList [{ chainId, address, nonce, yParity, r, s,
// authority }] (type 4), v, r, s, yParity, hash, from }; numeric fields are bigint (yParity and type: numbers).
// Inputs may use numbers, decimal or '0x' text for numeric fields and the JSON-RPC names `gas` and `input`.
//
//   normalizeTransaction(tx) -> tx            the type is inferred when missing (authorizationList 4, blobs 3,
//                                             maxFeePerGas 2, accessList 1, else 0)
//   serializeTransaction(tx, signature = null) -> '0x…'   signature: { r, s, yParity | v } | 65 bytes | none
//                                             (then the tx's own r / s when present, else the unsigned payload)
//   parseTransaction(raw) -> tx               canonical RLP only; recovers `from` (and type-4 authorities); errors
//                                             carry `code` (names of ethereum/tests TransactionException)
//   signingHash(tx) -> Uint8Array(32)         signTransaction(tx, privateKey) -> { raw, hash, tx }   (low-S; legacy
//                                             v = chainId * 2 + 35 + parity with a chainId, else 27 + parity)
//   transactionHash(raw) -> '0x…'             recoverSender(tx) -> checksum address
//   intrinsicGas(tx) -> bigint                21000 + calldata (4 / 16 per zero / other byte) + creation (32000 +
//                                             2 per initcode word) + access list (2400 / address, 1900 / key) +
//                                             25000 per authorization (Prague rules)
//   floorDataGas(tx) -> bigint                EIP-7623 minimum: 21000 + 10 per calldata token (zero 1, other 4)
//   validateTransaction(tx, { chainId }) -> [codes]  consensus checks of a signed transaction ([] = valid)
//   maxTransactionCost(tx) -> bigint          gasLimit x (maxFeePerGas | gasPrice) + value (+ blob gas)
//   effectiveGasPrice(tx, baseFee) -> bigint  txTypeName(type) -> 'legacy' | 'EIP-2930' | 'EIP-1559' | …
//   authorizationHash({ chainId, address, nonce }) -> Uint8Array(32)  (EIP-7702 MAGIC 0x05 || rlp([...]))
import { keccak256 } from '../crypto/sha3.js';
import { bytesToHex, concatBytes } from '../crypto/encoding.js';
import { CURVE, ecdsaRecover, ecdsaSign, getPublicKey, numberToBytes } from '../crypto/secp256k1.js';
import { bytesToInt, rlpDecode, rlpEncode } from './rlp.js';
import { fromHex, toBigInt, toHex } from './units.js';
import { addressToBytes, getAddress, publicKeyToAddress, toChecksumAddress } from './address.js';

export const TX_TYPES = Object.freeze({ 0: 'legacy', 1: 'EIP-2930', 2: 'EIP-1559', 3: 'EIP-4844', 4: 'EIP-7702' });
export const txTypeName = (type) => TX_TYPES[Number(type)] || `type ${type}`;

export const GAS_PER_BLOB = 131072n;
// HALF_N: EIP-2 (Homestead) requires s <= n/2. For every valid (r, s) the pair (r, n - s) also verifies; without the
// rule a third party could flip s and change the transaction hash without the signer (malleability).
const U64 = 1n << 64n, U256 = 1n << 256n, HALF_N = CURVE.n >> 1n;

const txError = (message, code) => Object.assign(new Error(message), { code });

// --- normalization -------------------------------------------------------------------------------

const big = (v, what, dflt = 0n) => (v == null || v === '' ? dflt : toBigInt(v, what));
const optBig = (v, what) => (v == null || v === '' ? null : toBigInt(v, what));

function dataHex(v) {
  if (v == null || v === '') return '0x';
  return toHex(typeof v === 'string' && !/^0x/i.test(v) ? '0x' + v : v);
}

function hash32(v, what) {
  const b = typeof v === 'string' ? fromHex(v) : v;
  if (!(b instanceof Uint8Array) || b.length !== 32) throw new Error(`${what}: 32 bytes expected`);
  return '0x' + bytesToHex(b);
}

function normAccessList(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new Error('accessList: array expected');
  return list.map((e) => {
    const [address, keys] = Array.isArray(e) ? e : [e.address, e.storageKeys];
    return { address: getAddress(address), storageKeys: (keys || []).map((k) => hash32(k, 'storage key')) };
  });
}

function normAuthorizations(list) {
  if (list == null) return [];
  return list.map((a) => {
    const out = { chainId: big(a.chainId, 'chainId'), address: getAddress(a.address), nonce: big(a.nonce, 'nonce') };
    if (a.r != null) Object.assign(out, { yParity: Number(big(a.yParity ?? a.v, 'yParity')), r: big(a.r, 'r'), s: big(a.s, 's') });
    if (a.authority !== undefined) out.authority = a.authority;
    return out;
  });
}

// Inference order from newest to oldest feature: a field that only exists in type N forces N. Guessing the other
// way would silently drop authorizationList or blob fields from the signed payload.
function inferType(tx) {
  if (tx.type != null) {
    const t = Number(typeof tx.type === 'string' ? toBigInt(tx.type, 'type') : tx.type);
    if (!(t >= 0 && t <= 4)) throw txError(`transaction type ${tx.type} is not supported`, 'TYPE_NOT_SUPPORTED');
    return t;
  }
  if (tx.authorizationList) return 4;
  if (tx.blobVersionedHashes) return 3;
  if (tx.maxFeePerGas != null || tx.maxPriorityFeePerGas != null) return 2;
  if (tx.accessList != null) return 1;
  return 0;
}

// One canonical shape for every input form, so serialization, hashing and validation each have a single code path.
// r = s = 0 is treated as "unsigned" (some RPC nodes return zeroed signature fields for pending/unsigned txs).
export function normalizeTransaction(tx) {
  const type = inferType(tx);
  const out = { type, chainId: optBig(tx.chainId, 'chainId'), nonce: big(tx.nonce, 'nonce') };
  if (type < 2) out.gasPrice = big(tx.gasPrice, 'gasPrice');
  else {
    out.maxPriorityFeePerGas = big(tx.maxPriorityFeePerGas, 'maxPriorityFeePerGas');
    out.maxFeePerGas = big(tx.maxFeePerGas, 'maxFeePerGas');
  }
  out.gasLimit = big(tx.gasLimit ?? tx.gas, 'gasLimit');
  out.to = tx.to == null || tx.to === '' || tx.to === '0x' ? null : getAddress(tx.to);
  out.value = big(tx.value, 'value');
  out.data = dataHex(tx.data ?? tx.input);
  if (type >= 1) out.accessList = normAccessList(tx.accessList);
  if (type === 3) {
    out.maxFeePerBlobGas = big(tx.maxFeePerBlobGas, 'maxFeePerBlobGas');
    out.blobVersionedHashes = (tx.blobVersionedHashes || []).map((h) => hash32(h, 'blob versioned hash'));
  }
  if (type === 4) out.authorizationList = normAuthorizations(tx.authorizationList);
  if (tx.r != null && tx.s != null && !(big(tx.r, 'r') === 0n && big(tx.s, 's') === 0n)) {
    out.r = big(tx.r, 'r');
    out.s = big(tx.s, 's');
    const sig = sigParts(tx, type, out.chainId);
    out.v = sig.v;
    out.yParity = sig.yParity;
    // Legacy: v decides whether the signature covers a chain id (EIP-155) or not (27 / 28).
    if (type === 0) {
      if (out.chainId != null && sig.chainId != null && out.chainId !== sig.chainId) throw txError(`chainId ${out.chainId} does not match v ${sig.v}`, 'INVALID_CHAINID');
      out.chainId = sig.chainId;
    }
  }
  if (tx.hash != null) out.hash = tx.hash;
  if (tx.from != null) out.from = getAddress(tx.from);
  if (tx.sidecar) out.sidecar = tx.sidecar;
  return out;
}

// v / yParity / chain id of the signature fields of a transaction-like object.
function sigParts(src, type, chainId) {
  const yp = src.yParity != null ? Number(big(src.yParity, 'yParity')) : null;
  const v = src.v != null ? big(src.v, 'v') : null;
  if (type !== 0) {
    const p = yp ?? (v === 27n || v === 28n ? Number(v - 27n) : Number(v));
    if (p !== 0 && p !== 1) throw txError('yParity must be 0 or 1', 'INVALID_SIGNATURE_VRS');
    return { yParity: p, v: BigInt(p) };
  }
  if (v == null) {
    if (yp !== 0 && yp !== 1) throw txError('legacy signature: v or yParity required', 'INVALID_SIGNATURE_VRS');
    return { yParity: yp, v: chainId != null ? chainId * 2n + 35n + BigInt(yp) : 27n + BigInt(yp), chainId };
  }
  const d = legacyV(v);
  return { yParity: d.yParity, v, chainId: d.chainId };
}

// Legacy v: 27 / 28 (no chain id) or chainId * 2 + 35 / 36 (EIP-155).
// EIP-155: v = chainId * 2 + 35 + yParity, which makes the chain id part of the signature without a new field.
// v in 29..34 or 0..26 is neither form and is rejected.
function legacyV(v) {
  if (v === 27n || v === 28n) return { chainId: null, yParity: Number(v - 27n) };
  if (v >= 35n) return { chainId: (v - 35n) / 2n, yParity: Number((v - 35n) % 2n) };
  throw txError(`invalid legacy v ${v}`, 'INVALID_CHAINID');
}

// --- serialization ---------------------------------------------------------------------------------

const toField = (to) => (to == null ? new Uint8Array(0) : addressToBytes(to));
const accessListItems = (list) => list.map((e) => [addressToBytes(e.address), e.storageKeys.map((k) => fromHex(k))]);
const authItems = (list) => list.map((a) => {
  if (a.r == null) throw new Error('authorization without a signature');
  return [a.chainId, addressToBytes(a.address), a.nonce, BigInt(a.yParity), a.r, a.s];
});

function needChain(t) {
  if (t.chainId == null) throw new Error(`a ${txTypeName(t.type)} transaction needs a chainId`);
  return t.chainId;
}

// Unsigned fields of a (normalized) transaction, in RLP order.
// Field order is consensus: it is exactly the RLP list of each EIP. The signature fields are appended by the caller.
// A creation (to == null) is the EMPTY string, not 20 zero bytes, which would be a call to the zero address.
function payloadFields(t) {
  const common = [t.gasLimit, toField(t.to), t.value, fromHex(t.data)];
  switch (t.type) {
    case 0: return [t.nonce, t.gasPrice, ...common];
    case 1: return [needChain(t), t.nonce, t.gasPrice, ...common, accessListItems(t.accessList)];
    case 2: return [needChain(t), t.nonce, t.maxPriorityFeePerGas, t.maxFeePerGas, ...common, accessListItems(t.accessList)];
    case 3: return [needChain(t), t.nonce, t.maxPriorityFeePerGas, t.maxFeePerGas, ...common, accessListItems(t.accessList), t.maxFeePerBlobGas, t.blobVersionedHashes.map((h) => fromHex(h))];
    case 4: return [needChain(t), t.nonce, t.maxPriorityFeePerGas, t.maxFeePerGas, ...common, accessListItems(t.accessList), authItems(t.authorizationList)];
    default: throw txError(`transaction type ${t.type} is not supported`, 'TYPE_NOT_SUPPORTED');
  }
}

// The bytes whose keccak256 is signed.
// What gets signed:
//   legacy pre-155:  rlp([nonce, gasPrice, gas, to, value, data])
//   legacy EIP-155:  rlp([..., chainId, 0, 0])   -- the two zeros are placeholders where r, s will go
//   typed (2718):    type byte || rlp([...fields])
// The type byte prefix keeps typed payloads from ever parsing as a legacy list (all < 0x7f vs list prefix >= 0xc0).
function unsignedBytes(t) {
  const f = payloadFields(t);
  if (t.type === 0) return rlpEncode(t.chainId != null ? [...f, t.chainId, 0n, 0n] : f);
  return concatBytes(Uint8Array.of(t.type), rlpEncode(f));
}

export const signingHash = (tx) => keccak256(unsignedBytes(normalizeTransaction(tx)));

// { r, s, yParity, v? } from a signature argument.
// 65-byte signatures carry v in byte 64: 27/28, 0/1, or EIP-155 v truncated to a byte; (v - 27) & 1 gives the parity
// for both 27/28 and odd chainId*2+35 forms, since 35 - 27 = 8 is even.
function sigArg(sig) {
  if (typeof sig === 'string' || sig instanceof Uint8Array) {
    const b = typeof sig === 'string' ? fromHex(sig) : sig;
    if (b.length !== 65) throw new Error('signature: 65 bytes expected');
    const v = b[64];
    return { r: BigInt('0x' + bytesToHex(b.subarray(0, 32))), s: BigInt('0x' + bytesToHex(b.subarray(32, 64))), yParity: v >= 27 ? (v - 27) & 1 : v & 1 };
  }
  const yParity = sig.yParity ?? sig.recovery;
  return { r: big(sig.r, 'r'), s: big(sig.s, 's'), yParity: yParity == null ? null : Number(yParity), v: sig.v == null ? null : big(sig.v, 'v') };
}

export function serializeTransaction(tx, signature = null) {
  const t = normalizeTransaction(tx);
  let sig = null;
  if (signature) {
    const s = sigArg(signature);
    sig = { r: s.r, s: s.s, ...sigParts({ yParity: s.yParity, v: s.yParity == null ? s.v : null }, t.type, t.chainId) };
  } else if (t.r != null) sig = { r: t.r, s: t.s, v: t.v, yParity: t.yParity };
  if (!sig) return toHex(unsignedBytes(t));
  const f = payloadFields(t);
  if (t.type === 0) return toHex(rlpEncode([...f, sig.v, sig.r, sig.s]));
  return toHex(concatBytes(Uint8Array.of(t.type), rlpEncode([...f, BigInt(sig.yParity), sig.r, sig.s])));
}

export const transactionHash = (raw) => toHex(keccak256(typeof raw === 'string' ? fromHex(raw) : raw));

// --- signing and recovery ----------------------------------------------------------------------

function recoverAddress(hash, r, s, yParity) {
  if (r <= 0n || r >= CURVE.n || s <= 0n || s >= CURVE.n) throw txError('signature r / s out of range', 'INVALID_SIGNATURE_VRS');
  let pub;
  try {
    pub = ecdsaRecover(concatBytes(numberToBytes(r), numberToBytes(s)), yParity, hash, false);
  } catch (e) {
    throw txError('signature recovery failed: ' + e.message, 'EC_RECOVERY_FAIL');
  }
  return publicKeyToAddress(pub);
}

export function recoverSender(tx) {
  const t = normalizeTransaction(tx);
  if (t.r == null) throw new Error('the transaction is not signed');
  return recoverAddress(keccak256(unsignedBytes(t)), t.r, t.s, t.yParity);
}

const privBytes = (k) => (typeof k === 'string' ? fromHex(k) : k);

// Old signature fields are deleted first so a re-sign never mixes the new signature with stale v/hash/from.
// Types 3 and 4 are not signed here: a blob tx needs KZG commitments and proofs (network form), and a set-code tx
// signer should understand the delegation it grants; parsing them is still supported.
export function signTransaction(tx, privateKey) {
  const t = normalizeTransaction(tx);
  if (t.type > 2) throw new Error(`${txTypeName(t.type)} transactions are parse-only in this library`);
  delete t.r; delete t.s; delete t.v; delete t.yParity; delete t.hash; delete t.from;
  if (t.type !== 0) needChain(t);
  const key = privBytes(privateKey);
  const sig = ecdsaSign(keccak256(unsignedBytes(t)), key);
  if (sig.recovery > 1) throw new Error('signature with an unrepresentable recovery id, change the nonce');
  const yParity = sig.recovery;
  const v = t.type === 0 ? (t.chainId != null ? t.chainId * 2n + 35n : 27n) + BigInt(yParity) : BigInt(yParity);
  const signed = { ...t, v, r: sig.r, s: sig.s, yParity };
  const raw = serializeTransaction(signed);
  const hash = transactionHash(raw);
  return { raw, hash, tx: { ...signed, hash, from: publicKeyToAddress(getPublicKey(key, false)) } };
}

// EIP-7702: keccak256(0x05 || rlp([chainId, address, nonce])). The MAGIC 0x05 domain-separates authorizations from
// transactions (0x00..0x04 prefixes) and messages (0x19); chainId 0 means "valid on every chain".
export function authorizationHash({ chainId, address, nonce }) {
  return keccak256(concatBytes(Uint8Array.of(5), rlpEncode([big(chainId, 'chainId'), addressToBytes(address), big(nonce, 'nonce')])));
}

// --- parsing ---------------------------------------------------------------------------------------

function str(item, what) {
  if (!(item instanceof Uint8Array)) throw txError(`${what}: a list where bytes were expected`, 'RLP_INVALID_' + what.toUpperCase());
  return item;
}

const OVERFLOW_CODES = { basefee: 'GASPRICE_OVERFLOW', priority_fee: 'PRIORITY_OVERFLOW', r: 'INVALID_SIGNATURE_VRS', s: 'INVALID_SIGNATURE_VRS' };

// Translates rlp.js errors into ethereum/tests TransactionException names, so the test suite can compare codes
// directly; the field name in `what` selects the specific code (e.g. RLP_LEADING_ZEROS_NONCE).
const int = (item, what, maxBytes = 32) => {
  try { return bytesToInt(str(item, what), what, maxBytes); } catch (e) {
    throw txError(e.message, e.code === 'RLP_LEADING_ZEROS' ? 'RLP_LEADING_ZEROS_' + what.toUpperCase() : e.code === 'OVERFLOW' ? OVERFLOW_CODES[what] || what.toUpperCase() + '_OVERFLOW' : e.code);
  }
};

function addr(item, what, nullable) {
  const b = str(item, what);
  if (!b.length && nullable) return null;
  if (b.length < 20) throw txError(`${what}: address shorter than 20 bytes`, 'ADDRESS_TOO_SHORT');
  if (b.length > 20) throw txError(`${what}: address longer than 20 bytes`, 'ADDRESS_TOO_LONG');
  return toChecksumAddress(b);
}

function list(item, what) {
  if (!Array.isArray(item)) throw txError(`${what}: list expected`, 'RLP_INVALID_' + what.toUpperCase());
  return item;
}

function parseAccessList(item) {
  return list(item, 'access_list').map((e) => {
    const [a, keys, ...extra] = list(e, 'access_list');
    if (keys === undefined || extra.length) throw txError('access list entry: 2 elements expected', 'RLP_INVALID_ACCESS_LIST');
    const ab = str(a, 'access_list_address');
    if (ab.length !== 20) throw txError('access list address: 20 bytes expected', ab.length > 20 ? 'RLP_INVALID_ACCESS_LIST_ADDRESS_TOO_LONG' : 'RLP_INVALID_ACCESS_LIST_ADDRESS_TOO_SHORT');
    return {
      address: toChecksumAddress(ab),
      storageKeys: list(keys, 'access_list_keys').map((k) => {
        const kb = str(k, 'access_list_storage');
        if (kb.length !== 32) throw txError('storage key: 32 bytes expected', kb.length > 32 ? 'RLP_INVALID_ACCESS_LIST_STORAGE_TOO_LONG' : 'RLP_INVALID_ACCESS_LIST_STORAGE_TOO_SHORT');
        return '0x' + bytesToHex(kb);
      }),
    };
  });
}

function parseAuthorizations(item) {
  return list(item, 'authorization_list').map((e) => {
    const f = list(e, 'authorization');
    if (f.length !== 6) throw txError('authorization: 6 elements expected', 'RLP_INVALID_AUTHORIZATION');
    // Authorization nonce is 8 bytes (u64) and yParity 1 byte per EIP-7702; wider values make the whole tx invalid.
    const a = { chainId: int(f[0], 'auth_chain_id'), address: addr(f[1], 'auth_address', false), nonce: int(f[2], 'auth_nonce', 8), yParity: Number(int(f[3], 'auth_y_parity', 1)), r: int(f[4], 'auth_r'), s: int(f[5], 'auth_s') };
    // An invalid authorization does not invalidate the transaction (EIP-7702): authority is null then.
    try {
      if (a.yParity > 1 || a.s > HALF_N) throw new Error('bad authorization signature');
      a.authority = recoverAddress(authorizationHash(a), a.r, a.s, a.yParity);
    } catch { a.authority = null; }
    return a;
  });
}

// Unsigned field count per typed envelope; the signed form adds yParity, r, s (+3).
const FIELD_COUNTS = { 1: 8, 2: 9, 3: 11, 4: 10 };

// First byte dispatch (EIP-2718): >= 0xc0 is an RLP list, i.e. a legacy tx; 0x00..0x7f is a type byte; 0x80..0xbf
// would be an RLP string, which no transaction form uses.
export function parseTransaction(raw) {
  const b = typeof raw === 'string' ? fromHex(raw) : raw;
  if (!(b instanceof Uint8Array)) throw new TypeError('transaction: bytes or hex expected');
  if (!b.length) throw txError('empty transaction', 'RLP_ERROR_EOF');
  if (b[0] >= 0xc0) return parseLegacy(b);
  if (b[0] > 0x7f) throw txError('not a transaction (an RLP string)', 'TYPE_NOT_SUPPORTED');
  const type = b[0];
  if (!FIELD_COUNTS[type]) throw txError(`transaction type ${type} is not supported`, 'TYPE_NOT_SUPPORTED');
  let body = rlpOrThrow(b.subarray(1));
  if (!Array.isArray(body)) throw txError('typed transaction: list expected', 'RLP_INVALID_HEADER');
  let sidecar = null, hashBytes = b;
  // The tx hash of a blob transaction covers only the inner payload, never the sidecar (blobs are pruned after ~18 days
  // but the hash must stay valid), so hashBytes is re-encoded from body[0] instead of hashing the received bytes.
  if (type === 3 && Array.isArray(body[0])) {
    // Network form: [tx_payload_body, blobs, commitments, proofs] or EIP-7594 [body, version, blobs, commitments, cell_proofs].
    const w = body.length === 5 ? 1 : 0;
    if (body.length !== 4 + w) throw txError('blob transaction wrapper: 4 or 5 elements expected', 'RLP_INVALID_WRAPPER');
    sidecar = {
      version: w ? Number(int(body[1], 'wrapper_version', 1)) : 0,
      blobs: list(body[1 + w], 'blobs').length,
      commitments: list(body[2 + w], 'commitments').map((c) => '0x' + bytesToHex(str(c, 'commitment'))),
      proofs: list(body[3 + w], 'proofs').length,
    };
    body = body[0];
    hashBytes = concatBytes(Uint8Array.of(3), rlpEncode(body));
  }
  const n = FIELD_COUNTS[type];
  if (body.length !== n && body.length !== n + 3) throw txError(`${txTypeName(type)} transaction: ${n + 3} elements expected, got ${body.length}`, body.length < n + 3 ? 'RLP_TOO_FEW_ELEMENTS' : 'RLP_TOO_MANY_ELEMENTS');
  const tx = { type, chainId: int(body[0], 'chain_id'), nonce: int(body[1], 'nonce') };
  let i = 2;
  if (type === 1) tx.gasPrice = int(body[i++], 'gasprice');
  else {
    tx.maxPriorityFeePerGas = int(body[i++], 'priority_fee');
    tx.maxFeePerGas = int(body[i++], 'basefee');
  }
  tx.gasLimit = int(body[i++], 'gaslimit');
  tx.to = addr(body[i++], 'to', true);
  tx.value = int(body[i++], 'value');
  tx.data = '0x' + bytesToHex(str(body[i++], 'data'));
  tx.accessList = parseAccessList(body[i++]);
  if (type === 3) {
    tx.maxFeePerBlobGas = int(body[i++], 'blob_fee');
    tx.blobVersionedHashes = list(body[i++], 'blob_hashes').map((h) => {
      const hb = str(h, 'blob_hash');
      if (hb.length !== 32) throw txError('blob versioned hash: 32 bytes expected', 'RLP_INVALID_BLOB_HASH');
      return '0x' + bytesToHex(hb);
    });
  }
  if (type === 4) tx.authorizationList = parseAuthorizations(body[i++]);
  if (sidecar) tx.sidecar = sidecar;
  if (body.length === n) return tx;
  const yParity = int(body[i++], 'v', 32);
  tx.r = int(body[i++], 'r');
  tx.s = int(body[i++], 's');
  if (yParity > 1n) throw txError('yParity must be 0 or 1', 'INVALID_SIGNATURE_VRS');
  tx.yParity = Number(yParity);
  tx.v = yParity;
  tx.hash = toHex(keccak256(hashBytes));
  tx.from = recoverAddress(keccak256(unsignedBytes(tx)), tx.r, tx.s, tx.yParity);
  return tx;
}

function rlpOrThrow(b) {
  try { return rlpDecode(b); } catch (e) { throw txError(e.message, 'RLP_ERROR_SIZE'); }
}

// Legacy hash = keccak256 of the received bytes; this is safe only because the RLP decoder is canonical (rlp.js), so
// the bytes are the one valid encoding of the parsed fields.
function parseLegacy(b) {
  const f = rlpOrThrow(b);
  if (f.length !== 6 && f.length !== 9) throw txError(`legacy transaction: 9 elements expected, got ${f.length}`, f.length < 9 ? 'RLP_TOO_FEW_ELEMENTS' : 'RLP_TOO_MANY_ELEMENTS');
  const tx = {
    type: 0, chainId: null, nonce: int(f[0], 'nonce'), gasPrice: int(f[1], 'gasprice'), gasLimit: int(f[2], 'gaslimit'),
    to: addr(f[3], 'to', true), value: int(f[4], 'value'), data: '0x' + bytesToHex(str(f[5], 'data')),
  };
  if (f.length === 6) return tx;
  const v = int(f[6], 'v'), r = int(f[7], 'r', 32), s = int(f[8], 's', 32);
  if (r === 0n && s === 0n) {
    // Unsigned EIP-155 payload [..., chainId, 0, 0] (or a pre-EIP-155 one with empty v).
    if (v) tx.chainId = v;
    return tx;
  }
  const d = legacyV(v);
  Object.assign(tx, { chainId: d.chainId, v, r, s, yParity: d.yParity });
  tx.hash = toHex(keccak256(b));
  tx.from = recoverAddress(keccak256(unsignedBytes(tx)), r, s, d.yParity);
  return tx;
}

// --- gas and checks --------------------------------------------------------------------------------

function calldataCounts(data) {
  const b = fromHex(data);
  let zeros = 0;
  for (let i = 0; i < b.length; i++) if (b[i] === 0) zeros++;
  return { zeros: BigInt(zeros), nonzeros: BigInt(b.length - zeros), length: BigInt(b.length) };
}

// Zero bytes cost 4 gas and others 16 (EIP-2028) because zeros compress well in block propagation. Init code words
// cost 2 each (EIP-3860) to price jumpdest analysis. Access list items are pre-paid warm slots (EIP-2930).
export function intrinsicGas(tx) {
  const t = normalizeTransaction(tx);
  const { zeros, nonzeros, length } = calldataCounts(t.data);
  let gas = 21000n + zeros * 4n + nonzeros * 16n;
  if (t.to == null) gas += 32000n + 2n * ((length + 31n) / 32n);
  for (const e of t.accessList || []) gas += 2400n + 1900n * BigInt(e.storageKeys.length);
  if (t.type === 4) gas += 25000n * BigInt(t.authorizationList.length);
  return gas;
}

// EIP-7623 (Prague): calldata-heavy txs pay at least 10 gas per token (zero byte = 1 token, other = 4), which bounds
// worst-case block size now that blobs are the intended channel for bulk data.
export function floorDataGas(tx) {
  const { zeros, nonzeros } = calldataCounts(normalizeTransaction(tx).data);
  return 21000n + 10n * (zeros + 4n * nonzeros);
}

const feeCap = (t) => (t.type >= 2 ? t.maxFeePerGas : t.gasPrice);

// The balance a sender must hold for the tx to be valid; blob gas is charged separately at maxFeePerBlobGas.
export function maxTransactionCost(tx) {
  const t = normalizeTransaction(tx);
  let cost = t.gasLimit * feeCap(t) + t.value;
  if (t.type === 3) cost += BigInt(t.blobVersionedHashes.length) * GAS_PER_BLOB * t.maxFeePerBlobGas;
  return cost;
}

export function effectiveGasPrice(tx, baseFee) {
  const t = normalizeTransaction(tx);
  if (t.type < 2) return t.gasPrice;
  const b = toBigInt(baseFee, 'baseFee');
  const p = b + t.maxPriorityFeePerGas;
  return p < t.maxFeePerGas ? p : t.maxFeePerGas;
}

// Rules a valid signed transaction meets (Prague): [] or codes in the style of ethereum/tests.
// Stateless checks only (no balance or nonce lookup). Collects ALL violations instead of failing fast, because the
// callers (explorers, tests) want the full diagnosis. NONCE_TOO_BIG: EIP-2681 caps the nonce at 2^64 - 2 so that
// incrementing it never overflows. 49152 = 2 x 24576, the EIP-3860 init code limit.
export function validateTransaction(tx, { chainId = null } = {}) {
  const t = normalizeTransaction(tx);
  const bad = [];
  if (t.r == null) bad.push('INVALID_SIGNATURE_VRS');
  else if (t.r <= 0n || t.r >= CURVE.n || t.s <= 0n || t.s > HALF_N) bad.push('INVALID_SIGNATURE_VRS');
  if (t.chainId === 0n || (chainId != null && t.chainId != null && t.chainId !== toBigInt(chainId, 'chainId'))) bad.push('INVALID_CHAINID');
  if (t.type !== 0 && t.chainId == null) bad.push('INVALID_CHAINID');
  if (t.nonce >= U64) bad.push('NONCE_OVERFLOW');
  else if (t.nonce === U64 - 1n) bad.push('NONCE_TOO_BIG');
  if (t.gasLimit >= U64) bad.push('GASLIMIT_OVERFLOW');
  if (t.value >= U256) bad.push('VALUE_OVERFLOW');
  const cap = feeCap(t);
  if (cap >= U256) bad.push('GASPRICE_OVERFLOW');
  else if (t.gasLimit * cap >= U256) bad.push('GASLIMIT_PRICE_PRODUCT_OVERFLOW');
  if (t.type >= 2) {
    if (t.maxPriorityFeePerGas >= U256) bad.push('PRIORITY_OVERFLOW');
    else if (t.maxPriorityFeePerGas > t.maxFeePerGas) bad.push('PRIORITY_GREATER_THAN_MAX_FEE_PER_GAS');
  }
  if (t.to == null && fromHex(t.data).length > 49152) bad.push('INITCODE_SIZE_EXCEEDED');
  if (t.type === 3) {
    if (t.to == null) bad.push('TYPE_3_TX_CONTRACT_CREATION');
    if (!t.blobVersionedHashes.length) bad.push('TYPE_3_TX_ZERO_BLOBS');
    if (t.blobVersionedHashes.some((h) => !h.startsWith('0x01'))) bad.push('TYPE_3_TX_INVALID_BLOB_VERSIONED_HASH');
  }
  if (t.type === 4) {
    if (t.to == null) bad.push('TYPE_4_TX_CONTRACT_CREATION');
    if (!t.authorizationList.length) bad.push('TYPE_4_EMPTY_AUTHORIZATION_LIST');
  }
  if (t.gasLimit < intrinsicGas(t)) bad.push('INTRINSIC_GAS_TOO_LOW');
  else if (t.gasLimit < floorDataGas(t)) bad.push('INTRINSIC_NO_FLOOR_GAS');
  return bad;
}
