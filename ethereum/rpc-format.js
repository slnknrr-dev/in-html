// ethereum/rpc-format.js - Ethereum JSON-RPC data shapes shared by rpc.js and rpc.offline.js (no network code):
// block parameters, transaction requests, results with their quantities as bigint, JSON-RPC errors.
//
//   blockTag(tagOrNumber = 'latest') -> 'latest' | 'pending' | 'safe' | 'finalized' | 'earliest' | '0x…'
//   toRpcTransaction(tx) -> request object for eth_call / eth_estimateGas (quantities as '0x…', `data`)
//   formatBlock(json), formatTransaction(json), formatReceipt(json), formatLog(json), formatFeeHistory(json)
//       -> the same objects with bigint quantities (block numbers, gas, fees, values, nonces), numbers for indexes,
//          type and status, checksum addresses; transactions also get `gasLimit` and `data` (tx.js names)
//   rpcError({ code, message, data }) -> Error with code and data      jsonReplacer: bigint -> quantity for JSON
import { fromQuantity, toQuantity } from './units.js';
import { getAddress } from './address.js';

const TAGS = new Set(['latest', 'pending', 'safe', 'finalized', 'earliest']);

// Hex block numbers are re-encoded through toQuantity: nodes reject leading zeros ('0x01'). The < 66 length test keeps
// a 32-byte block hash from being mistaken for a number.
export function blockTag(tag = 'latest') {
  if (typeof tag === 'string' && TAGS.has(tag)) return tag;
  if (typeof tag === 'string' && /^0x[0-9a-f]+$/i.test(tag) && tag.length < 66) return toQuantity(BigInt(tag));
  if (typeof tag === 'bigint' || typeof tag === 'number') return toQuantity(tag);
  throw new Error(`invalid block tag ${JSON.stringify(String(tag))}`);
}

// JSON.stringify throws on bigint; the replacer turns every bigint in params into a QUANTITY.
export const jsonReplacer = (key, value) => (typeof value === 'bigint' ? toQuantity(value) : value);

export function rpcError(error) {
  const e = new Error(String((error && error.message) || 'JSON-RPC error'));
  e.code = error && error.code;
  if (error && error.data !== undefined) e.data = error.data;
  return e;
}

const Q = ['nonce', 'gas', 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas', 'maxFeePerBlobGas', 'value', 'chainId'];

// Accepts tx.js names (gasLimit, data) and JSON-RPC names (gas, input); sends `data` because every client accepts it
// (`input` is newer). Empty data is omitted rather than sent as '0x' to keep requests minimal.
export function toRpcTransaction(tx) {
  const out = {};
  if (tx.from) out.from = getAddress(tx.from);
  if (tx.to) out.to = getAddress(tx.to);
  const gas = tx.gasLimit ?? tx.gas;
  if (gas != null) out.gas = toQuantity(BigInt(gas));
  for (const k of Q) if (k !== 'gas' && tx[k] != null) out[k] = toQuantity(BigInt(tx[k]));
  const data = tx.data ?? tx.input;
  if (data != null && data !== '0x') out.data = data;
  if (tx.accessList) out.accessList = tx.accessList;
  if (tx.blobVersionedHashes) out.blobVersionedHashes = tx.blobVersionedHashes;
  if (tx.type != null) out.type = toQuantity(BigInt(tx.type));
  return out;
}

const big = (v) => (v == null ? v : fromQuantity(v));
const small = (v) => (v == null ? v : Number(fromQuantity(v)));
const addr = (v) => (v == null || v === '' ? null : getAddress(v));

// Copies, never mutates the node's object. bigs: values that can exceed 2^53 (wei, gas totals, block numbers in theory);
// smalls: indexes / type / status, always small, returned as numbers for convenient comparison.
function convert(json, bigs, smalls, addrs) {
  if (!json || typeof json !== 'object') return json;
  const out = { ...json };
  for (const k of bigs) if (k in out) out[k] = big(out[k]);
  for (const k of smalls) if (k in out) out[k] = small(out[k]);
  for (const k of addrs) if (k in out) out[k] = addr(out[k]);
  return out;
}

export function formatLog(log) {
  return convert(log, ['blockNumber'], ['logIndex', 'transactionIndex'], ['address']);
}

export function formatTransaction(tx) {
  if (!tx || typeof tx !== 'object') return tx;
  const out = convert(tx, ['blockNumber', 'nonce', 'gas', 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas', 'maxFeePerBlobGas', 'value', 'chainId', 'v', 'r', 's'], ['transactionIndex', 'type', 'yParity'], ['from', 'to']);
  if (out.gas != null) out.gasLimit = out.gas;
  if (out.input != null && out.data == null) out.data = out.input;
  // Typed transactions carry yParity; older nodes report it only as v (0 / 1), so it is derived here.
  if (out.yParity == null && out.type > 0 && out.v != null) out.yParity = Number(out.v);
  return out;
}

export function formatReceipt(r) {
  if (!r || typeof r !== 'object') return r;
  const out = convert(r, ['blockNumber', 'gasUsed', 'cumulativeGasUsed', 'effectiveGasPrice', 'blobGasUsed', 'blobGasPrice'], ['transactionIndex', 'type', 'status'], ['from', 'to', 'contractAddress']);
  if (Array.isArray(out.logs)) out.logs = out.logs.map(formatLog);
  return out;
}

export function formatBlock(b) {
  if (!b || typeof b !== 'object') return b;
  const out = convert(b, ['number', 'timestamp', 'gasLimit', 'gasUsed', 'baseFeePerGas', 'difficulty', 'totalDifficulty', 'size', 'blobGasUsed', 'excessBlobGas'], [], ['miner']);
  if (Array.isArray(out.transactions)) out.transactions = out.transactions.map((t) => (typeof t === 'object' ? formatTransaction(t) : t));
  return out;
}

export function formatFeeHistory(h) {
  if (!h || typeof h !== 'object') return h;
  const out = { ...h, oldestBlock: big(h.oldestBlock), baseFeePerGas: (h.baseFeePerGas || []).map(big), gasUsedRatio: (h.gasUsedRatio || []).map(Number) };
  if (h.reward) out.reward = h.reward.map((row) => row.map(big));
  if (h.baseFeePerBlobGas) out.baseFeePerBlobGas = h.baseFeePerBlobGas.map(big);
  if (h.blobGasUsedRatio) out.blobGasUsedRatio = h.blobGasUsedRatio.map(Number);
  return out;
}
