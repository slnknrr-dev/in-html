// ethereum/rpc.js - Ethereum JSON-RPC 2.0 client over HTTP POST. Offline builds (bundle.js variant 'offline') use
// ./rpc.offline.js instead: the same exports without any network code.
//
//   ONLINE = true
//   createRpcClient({ url, fetch = the platform fetch, headers = {}, timeout = 20000 }) -> client
//     client.url
//     client.request(method, params = []) -> the JSON result as is (bigints in params are sent as quantities)
//     client.batch([[method, params], ...]) -> [result | Error] in order (one HTTP request)
//     chainId() -> number          blockNumber(), gasPrice(), maxPriorityFeePerGas() -> bigint
//     getBalance(address, block = 'latest') -> bigint        getTransactionCount(address, block = 'pending') -> bigint
//     getCode(address, block), getStorageAt(address, slot, block), call(tx, block = 'latest') -> '0x…'
//     estimateGas(tx, block = null) -> bigint                 feeHistory(blockCount, newestBlock = 'latest', percentiles = [])
//     getBlock(tagOrNumberOrHash = 'latest', full = false), getTransaction(hash), getTransactionReceipt(hash)
//     getLogs({ address, topics, fromBlock, toBlock, blockHash }) -> formatted (rpc-format.js) or null
//     sendRawTransaction(raw) -> transaction hash             clientVersion() -> string
//   Errors: JSON-RPC errors keep `code` and `data` (revert data of eth_call / eth_estimateGas); transport errors have
//   code 'TIMEOUT', 'NETWORK', 'HTTP' (with `status`) or 'BAD_RESPONSE'.
//   The fetch function is injectable (tests, a Node backend with its own agent); no request leaves without a call.
//   Re-exports rpc-format.js (blockTag, toRpcTransaction, formatBlock, formatTransaction, formatReceipt, formatLog,
//   formatFeeHistory, rpcError, jsonReplacer).
import { fromQuantity } from './units.js';
import { getAddress } from './address.js';
import { blockTag, formatBlock, formatFeeHistory, formatLog, formatReceipt, formatTransaction, jsonReplacer, rpcError, toRpcTransaction } from './rpc-format.js';

export * from './rpc-format.js';
export const ONLINE = true;

const transportError = (message, code, extra = {}) => Object.assign(new Error('rpc: ' + message), { code, ...extra });

// The default transport is written as a plain fetch() call so that the network audit (policy.js) reports it.
const platformFetch = (input, init) => fetch(input, init);

export function createRpcClient({ url, fetch: fetchFn = platformFetch, headers = {}, timeout = 20000 } = {}) {
  if (!url) throw new Error('rpc: url required');
  if (typeof fetchFn !== 'function' || (fetchFn === platformFetch && typeof globalThis.fetch !== 'function')) throw new Error('rpc: no fetch function available');
  let nextId = 1;

  // Error taxonomy matters to callers: TIMEOUT (retry later), NETWORK (endpoint down), HTTP (rate limit, 5xx),
  // BAD_RESPONSE (wrong endpoint), JSON-RPC error (node answered: revert, invalid params; never retried blindly).
  // A non-2xx response that still carries a JSON-RPC error body is passed through, since some providers send
  // revert errors with HTTP 400/500 and the revert data is what the caller needs.
  async function post(body) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl && timeout > 0 ? setTimeout(() => ctrl.abort(), timeout) : null;
    try {
      let res;
      try {
        res = await fetchFn(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
          body: JSON.stringify(body, jsonReplacer),
          signal: ctrl ? ctrl.signal : undefined,
        });
      } catch (e) {
        if (ctrl && ctrl.signal.aborted) throw transportError(`no answer within ${timeout} ms`, 'TIMEOUT');
        throw transportError(String((e && e.message) || e), 'NETWORK');
      }
      let text;
      try { text = await res.text(); } catch (e) {
        throw transportError(ctrl && ctrl.signal.aborted ? `no answer within ${timeout} ms` : String(e && e.message), ctrl && ctrl.signal.aborted ? 'TIMEOUT' : 'NETWORK');
      }
      let json;
      try { json = JSON.parse(text); } catch {
        if (!res.ok) throw transportError(`HTTP ${res.status}`, 'HTTP', { status: res.status, data: text.slice(0, 500) });
        throw transportError('the answer is not JSON', 'BAD_RESPONSE', { data: text.slice(0, 500) });
      }
      if (!res.ok && !(json && (json.error || Array.isArray(json)))) throw transportError(`HTTP ${res.status}`, 'HTTP', { status: res.status, data: json });
      return json;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function request(method, params = []) {
    const json = await post({ jsonrpc: '2.0', id: nextId++, method, params });
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw transportError('unexpected answer', 'BAD_RESPONSE', { data: json });
    if (json.error) throw rpcError(json.error);
    if (!('result' in json)) throw transportError('answer without a result', 'BAD_RESPONSE', { data: json });
    return json.result;
  }

  // Ids are reserved up front and answers matched by id: the JSON-RPC spec allows batch answers in any order, and
  // indexing by position would silently attach results to the wrong calls. A missing answer yields an Error entry, not
  // a throw, so one failed entry does not discard the others.
  async function batch(calls) {
    if (!calls.length) return [];
    const first = nextId;
    nextId += calls.length;
    const json = await post(calls.map(([method, params = []], i) => ({ jsonrpc: '2.0', id: first + i, method, params })));
    if (!Array.isArray(json)) {
      if (json && json.error) throw rpcError(json.error);
      throw transportError('batch answer is not an array', 'BAD_RESPONSE', { data: json });
    }
    const byId = new Map(json.map((r) => [r && r.id, r]));
    return calls.map((_, i) => {
      const r = byId.get(first + i);
      if (!r) return transportError('no answer for this batch entry', 'BAD_RESPONSE');
      return r.error ? rpcError(r.error) : r.result;
    });
  }

  const q = async (method, params) => fromQuantity(await request(method, params));
  const isHash = (v) => typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v);

  return {
    url,
    request,
    batch,
    chainId: async () => Number(await q('eth_chainId', [])),
    blockNumber: () => q('eth_blockNumber', []),
    gasPrice: () => q('eth_gasPrice', []),
    maxPriorityFeePerGas: () => q('eth_maxPriorityFeePerGas', []),
    getBalance: (address, block = 'latest') => q('eth_getBalance', [getAddress(address), blockTag(block)]),
    // 'pending' by default: the next nonce must count transactions still in the mempool, or two sends reuse a nonce.
    getTransactionCount: (address, block = 'pending') => q('eth_getTransactionCount', [getAddress(address), blockTag(block)]),
    getCode: (address, block = 'latest') => request('eth_getCode', [getAddress(address), blockTag(block)]),
    getStorageAt: (address, slot, block = 'latest') => request('eth_getStorageAt', [getAddress(address), typeof slot === 'string' ? slot : '0x' + BigInt(slot).toString(16), blockTag(block)]),
    call: (tx, block = 'latest') => request('eth_call', [toRpcTransaction(tx), blockTag(block)]),
    estimateGas: (tx, block = null) => q('eth_estimateGas', block == null ? [toRpcTransaction(tx)] : [toRpcTransaction(tx), blockTag(block)]),
    feeHistory: async (blockCount, newestBlock = 'latest', percentiles = []) => formatFeeHistory(await request('eth_feeHistory', ['0x' + BigInt(blockCount).toString(16), blockTag(newestBlock), percentiles])),
    getBlock: async (block = 'latest', full = false) => formatBlock(await (isHash(block) ? request('eth_getBlockByHash', [block, !!full]) : request('eth_getBlockByNumber', [blockTag(block), !!full]))),
    getTransaction: async (hash) => formatTransaction(await request('eth_getTransactionByHash', [hash])),
    getTransactionReceipt: async (hash) => formatReceipt(await request('eth_getTransactionReceipt', [hash])),
    getLogs: async (filter = {}) => {
      const f = { ...filter };
      if (f.fromBlock != null) f.fromBlock = blockTag(f.fromBlock);
      if (f.toBlock != null) f.toBlock = blockTag(f.toBlock);
      if (typeof f.address === 'string') f.address = getAddress(f.address);
      else if (Array.isArray(f.address)) f.address = f.address.map(getAddress);
      return ((await request('eth_getLogs', [f])) || []).map(formatLog);
    },
    sendRawTransaction: (raw) => request('eth_sendRawTransaction', [raw]),
    clientVersion: () => request('web3_clientVersion', []),
  };
}
