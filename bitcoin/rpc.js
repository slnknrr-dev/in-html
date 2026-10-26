// bitcoin/rpc.js - a Bitcoin Core JSON-RPC client (HTTP with Basic authentication: rpcuser / rpcpassword or the
// "__cookie__" credentials of the .cookie file), for Node backends (Core does not answer browsers: no CORS). Wallet
// RPCs go to /wallet/<name>. Amounts come back as Core's BTC numbers; helpers convert where noted.
//
//   createCoreRpc({ url = 'http://127.0.0.1:8332', user, password, cookie (file text "user:pass"), wallet, fetch,
//     timeout = 30000 }) -> client
//   client.call(method, ...params), client.batch([[method, params], …]), client.wallet(name) -> client of a wallet
//   getBlockchainInfo, getNetworkInfo, getIndexInfo, getBlockCount, getBestBlockHash, getBlockHash(h),
//   getBlock(hash, verbosity = 1), getBlockHeader(hash, verbose = true), getRawTransaction(txid, verbose, blockhash),
//   getMempoolInfo, getRawMempool(verbose), getMempoolEntry(txid), estimateSmartFee(target, mode) -> { feerate (BTC/kvB),
//   blocks } | null, sendRawTransaction(hex), testMempoolAccept([hex]), getTxOut(txid, n), scanTxOutSet(descriptors),
//   deriveAddresses(desc, range), getDescriptorInfo(desc), createWallet(name, { watchOnly }), loadWallet, listWallets,
//   importDescriptors(requests), listUnspent(min, max, addresses), listTransactions(label, count, skip, watchOnly),
//   listSinceBlock(hash), getWalletInfo, getChainTxStats
//   RpcError { code, message }      btcKvbToSatVb(feerate) -> sat/vB

//
// Security: RPC credentials grant full control of the node and its wallets (including sending funds). Basic auth over
// plain HTTP is acceptable only on localhost or a private link (Core's RPC has no TLS); never expose rpcport. The
// cookie file (datadir/.cookie, regenerated each start) is the safer default: no password in config files.
// Errors keep Core's numeric codes (e.g. -26 rejected by mempool, -18 wallet not loaded) so callers can branch.

export class RpcError extends Error {
  constructor(message, code, data) { super(message); this.code = code; this.data = data; }
}

const b64 = (s) => (typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'utf8').toString('base64'));

// BTC per 1000 vB -> sat per vB: x 1e8 / 1000, rounded to 3 decimals (Core's resolution is 1 sat/kvB).
export const btcKvbToSatVb = (feerate) => Math.round(feerate * 1e8 / 1000 * 1000) / 1000;

export function createCoreRpc({ url = 'http://127.0.0.1:8332', user = '', password = '', cookie = '', wallet = '', fetch: fetchFn = globalThis.fetch, timeout = 30000 } = {}) {
  const base = String(url).replace(/\/+$/, '');
  const cred = cookie ? String(cookie).trim() : user || password ? `${user}:${password}` : '';
  let id = 0;
  async function post(body) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    let r;
    try {
      r = await fetchFn(base + (wallet ? '/wallet/' + encodeURIComponent(wallet) : ''), {
        method: 'POST', body: JSON.stringify(body), signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', ...(cred ? { Authorization: 'Basic ' + b64(cred) } : {}) },
      });
    } catch (e) {
      throw new RpcError(e && e.name === 'AbortError' ? 'RPC timed out' : `cannot reach the node: ${e && e.message}`, -1);
    } finally { clearTimeout(t); }
    if (r.status === 401) throw new RpcError('RPC authentication failed (check rpcuser / rpcpassword or the cookie)', -401);
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { throw new RpcError(`HTTP ${r.status}: ${text.slice(0, 200)}`, -r.status); }
    return json;
  }
  async function call(method, ...params) {
    const res = await post({ jsonrpc: '1.0', id: ++id, method, params });
    if (res.error) throw new RpcError(res.error.message, res.error.code, res.error);
    return res.result;
  }
  // JSON-RPC batch: one HTTP round trip, replies matched by id (order is not guaranteed by the spec). Per-call errors
  // are returned as RpcError values in place, not thrown, so one failure does not lose the other results.
  // KNOWN DEFECT: if Core answers the whole batch with a single error object (e.g. HTTP 500 with a JSON error), res
  // is not an array and res.map throws a TypeError instead of an RpcError. Fix: check Array.isArray(res) first.
  async function batch(calls) {
    const body = calls.map(([method, params = []]) => ({ jsonrpc: '1.0', id: ++id, method, params }));
    const res = await post(body);
    const byId = new Map(res.map((x) => [x.id, x]));
    return body.map((b) => { const x = byId.get(b.id); return x && !x.error ? x.result : new RpcError(x ? x.error.message : 'no reply', x && x.error ? x.error.code : -1); });
  }
  const c = {
    url: base, call, batch,
    wallet: (name) => createCoreRpc({ url, user, password, cookie, wallet: name, fetch: fetchFn, timeout }),
    getBlockchainInfo: () => call('getblockchaininfo'),
    getNetworkInfo: () => call('getnetworkinfo'),
    getIndexInfo: () => call('getindexinfo'),
    getBlockCount: () => call('getblockcount'),
    getBestBlockHash: () => call('getbestblockhash'),
    getBlockHash: (h) => call('getblockhash', h),
    getBlock: (hash, verbosity = 1) => call('getblock', hash, verbosity),
    getBlockHeader: (hash, verbose = true) => call('getblockheader', hash, verbose),
    getRawTransaction: (txid, verbose = false, blockhash) => (blockhash ? call('getrawtransaction', txid, verbose, blockhash) : call('getrawtransaction', txid, verbose)),
    getMempoolInfo: () => call('getmempoolinfo'),
    getRawMempool: (verbose = false) => call('getrawmempool', verbose),
    getMempoolEntry: (txid) => call('getmempoolentry', txid),
    estimateSmartFee: async (target, mode = 'conservative') => { const r = await call('estimatesmartfee', target, mode); return r && r.feerate ? r : null; },
    sendRawTransaction: (hex) => call('sendrawtransaction', hex),
    testMempoolAccept: (hexes) => call('testmempoolaccept', hexes),
    getTxOut: (txid, n, mempool = true) => call('gettxout', txid, n, mempool),
    scanTxOutSet: (descriptors) => call('scantxoutset', 'start', descriptors),
    deriveAddresses: (desc, range) => (range ? call('deriveaddresses', desc, range) : call('deriveaddresses', desc)),
    getDescriptorInfo: (desc) => call('getdescriptorinfo', desc),
    // createwallet positional args: name, disable_private_keys, blank, passphrase, avoid_reuse, descriptors,
    // load_on_startup. Watch-only = no private keys and blank, so the node never generates or holds keys of ours.
    createWallet: (name, { watchOnly = true } = {}) => call('createwallet', name, watchOnly, watchOnly, '', false, true, true),
    loadWallet: (name) => call('loadwallet', name),
    listWallets: () => call('listwallets'),
    importDescriptors: (reqs) => call('importdescriptors', reqs),
    listUnspent: (min = 0, max = 9999999, addresses) => (addresses ? call('listunspent', min, max, addresses) : call('listunspent', min, max)),
    listTransactions: (label = '*', count = 1000, skip = 0, watchOnly = true) => call('listtransactions', label, count, skip, watchOnly),
    listSinceBlock: (hash) => (hash ? call('listsinceblock', hash) : call('listsinceblock')),
    getWalletInfo: () => call('getwalletinfo'),
    getChainTxStats: (n) => (n ? call('getchaintxstats', n) : call('getchaintxstats')),
  };
  return c;
}
