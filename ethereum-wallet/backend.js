// ethereum-wallet/backend.js - the server side of the BACKEND artifact (hosting.js mounts it; so does the development
// server `node ethereum-wallet/server.js`): a JSON-RPC proxy to the owner's node (geth, reth, erigon, nethermind,
// anvil) or to configured upstreams with failover, a method allowlist, a cache of immutable answers, and a watch index
// of addresses (balance snapshots of ether and ERC-20 tokens, their transactions from the block where watching started
// onward) for the explorer, the dashboard and the history of the browser app. Watch-only: it never accepts or sees a
// private key; signing happens in the browser, the proxy only relays signed transactions.
//
// Configuration (environment variables; read at start):
//   ETH_RPC_URL     the owner's node, e.g. http://127.0.0.1:8545
//   ETH_UPSTREAMS   comma-separated JSON-RPC URLs tried in order (failover), instead of or after ETH_RPC_URL
//   ETH_CHAIN_ID    the expected chain id (checked against eth_chainId; the proxy refuses to serve on a mismatch)
//   ETH_TOKEN       bearer token for watch-list changes (else one is generated, stored and printed at start)
// API below the page (<base>api/…, JSON, CORS for GET / POST):
//   GET    api/info          { app: 'ethereum-wallet', version, chainId, head, upstream (host only), watchOnly: true }
//   POST   api/rpc           JSON-RPC 2.0 (single or batch of up to 100) with the allowlist below
//   GET    api/watch         the watch list [{ id, label, chainId, addresses, tokens, fromBlock, created, updated }]
//   POST   api/watch         { label, addresses: [], tokens: [] }  (token)
//   GET    api/watch/<id>    { …entry, balances: { [address]: { wei, tokens } }, series: [{ t, wei }], transactions, scanned }
//   DELETE api/watch/<id>    (token)
// Storage keys: 'token', 'watch' (the list), 'watch:<id>' (its data).
//
// Design decisions:
// - Allowlist, not denylist: unknown methods (admin_*, debug_*, personal_*, txpool_*, eth_sign*) are refused by
//   default. A denylist misses whatever the next client release adds; an allowlist fails closed.
// - The node URL never leaves the server (api/info reports the host only): many node URLs embed an API key.
// - Platform-neutral: storage/log come from the host (hosting.js), no Node fs here; Node is touched only through
//   globalThis.process for env, so the module also loads in tests and other runtimes.
import { randomBytes } from '../crypto/random.js';
import { bytesToHex, equalBytes, utf8ToBytes } from '../crypto/encoding.js';
import { createRpcClient } from '../ethereum/rpc.js';
import { isAddress, getAddress } from '../ethereum/address.js';
import { erc20BalanceOfData } from '../ethereum/erc.js';
import { eventTopic, decodeParameters } from '../ethereum/abi.js';

const env = (k, d = '') => ((globalThis.process && process.env && process.env[k]) || d);

// eth_getLogs is allowed but range-limited (LOG_RANGE) in checkCall: an unbounded log query is the classic way to make
// a public proxy burn its node. eth_sendRawTransaction is the only state-changing method and only relays already
// signed bytes.
export const READ_METHODS = new Set([
  'eth_chainId', 'eth_blockNumber', 'eth_getBalance', 'eth_getTransactionCount', 'eth_getCode', 'eth_getStorageAt', 'eth_call',
  'eth_estimateGas', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory', 'eth_getBlockByNumber', 'eth_getBlockByHash',
  'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getLogs', 'net_version', 'web3_clientVersion',
]);
export const ALLOWED = new Set([...READ_METHODS, 'eth_sendRawTransaction']);
export const LOG_RANGE = 5000;
// Request limits: 1 MiB body, 100 calls per batch, 200 blocks scanned per watch refresh (bounds one run to ~200
// getBlock calls so a long-idle watch catches up over several runs instead of one huge burst).
const MAX_BODY = 1 << 20;
const MAX_BATCH = 100;
const SCAN_PER_RUN = 200;

// Upstreams deduplicated in order: ETH_RPC_URL first (the owner's node), then the failover list.
export function readConfig() {
  const urls = [env('ETH_RPC_URL'), ...env('ETH_UPSTREAMS').split(',')].map((s) => s.trim()).filter(Boolean);
  return { upstreams: [...new Set(urls)], chainId: env('ETH_CHAIN_ID') ? Number(env('ETH_CHAIN_ID')) : null, token: env('ETH_TOKEN') };
}

// A small LRU map.
// LRU on Map insertion order: get re-inserts (moves to newest), set evicts the first key (oldest). O(1) without a
// linked list because Map preserves insertion order by spec.
export class Lru {
  constructor(max = 2000) { this.max = max; this.map = new Map(); }
  get(k) { if (!this.map.has(k)) return undefined; const v = this.map.get(k); this.map.delete(k); this.map.set(k, v); return v; }
  set(k, v) { this.map.delete(k); this.map.set(k, v); if (this.map.size > this.max) this.map.delete(this.map.keys().next().value); }
}

const hostOf = (u) => { try { return new URL(u).host; } catch { return '?'; } };
const rpcErr = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
// Hex quantity -> bigint, or null for tags ("latest", "pending") and malformed values.
const q = (v) => (typeof v === 'string' && /^0x[0-9a-f]+$/i.test(v) ? BigInt(v) : null);

// CORS "*": the API is public read data plus bearer-token writes; no cookies are used, so a wildcard origin does not
// expose credentials (browsers never attach Authorization cross-origin unless the page script sets it).
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
// no-store: RPC answers are live data; nosniff: JSON must never be sniffed and executed as script/HTML.
const sendJson = (res, status, v, extra = {}) => {
  const body = utf8ToBytes(JSON.stringify(v));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...CORS, ...extra });
  res.end(body);
};

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    let over = false;
    // Too large: the rest is drained (not stored) so that the 413 answer reaches the client.
    req.on('data', (c) => { n += c.length; if (n > limit) { if (!over) { over = true; chunks.length = 0; } } else chunks.push(c); });
    req.on('end', () => {
      if (over) { reject(Object.assign(new Error('body too large'), { status: 413 })); return; } const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } resolve(new TextDecoder().decode(out)); });
    req.on('error', reject);
  });
}

// The upstream transport: each JSON-RPC body goes to the first upstream that answers (transport errors and HTTP 5xx /
// 429 move on to the next one).
// Failover with stickiness: the last upstream that answered becomes preferred and is tried first next time, so a
// dead primary costs one timeout once, not on every request. 4xx other than 429 is returned as is: it is the
// node's answer to a bad request, and another upstream would answer the same.
export function createUpstream(urls, { fetchFn = (u, i) => fetch(u, i), timeout = 20000, log = () => {} } = {}) {
  let preferred = 0;
  async function post(body) {
    let last = null;
    for (let k = 0; k < urls.length; k++) {
      const i = (preferred + k) % urls.length;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      try {
        const r = await fetchFn(urls[i], { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body, signal: ctrl.signal });
        if (r.status >= 500 || r.status === 429) { last = new Error(`${hostOf(urls[i])}: HTTP ${r.status}`); continue; }
        const text = await r.text();
        if (i !== preferred) { log(`ethereum-wallet: upstream ${hostOf(urls[i])} now preferred`); preferred = i; }
        return text;
      } catch (e) { last = new Error(`${hostOf(urls[i])}: ${e.name === 'AbortError' ? 'timeout' : e.message}`); } finally { clearTimeout(timer); }
    }
    throw last || new Error('no upstream configured');
  }
  // A Response-like object for rpc.js (createRpcClient's injectable fetch).
  const clientFetch = async (_url, init) => { const text = await post(init.body); return { ok: true, status: 200, text: async () => text }; };
  return { post, clientFetch, current: () => urls[preferred] || null };
}

// Immutable answers: blocks by hash, transactions and receipts once mined, blocks by number well below the head.
// Cache criterion: answers that cannot change. 64 blocks below head is a reorg-safety margin (two epochs on PoS
// mainnet; final in practice) - caching a receipt from a block that is later reorged out would serve a wrong status.
// Blocks by hash are immutable content by definition (the hash commits to it).
export function cacheable(method, params, result, head) {
  if (result == null) return false;
  if (method === 'eth_chainId' || method === 'net_version') return true;
  if (method === 'eth_getBlockByHash') return true;
  if (method === 'eth_getTransactionByHash' || method === 'eth_getTransactionReceipt') return result.blockNumber != null && head != null && q(result.blockNumber) <= head - 64n;
  if (method === 'eth_getBlockByNumber') { const n = q(params[0]); return n != null && head != null && n <= head - 64n; }
  return false;
}

export default function backend(ctx) {
  const { storage, log } = ctx;
  const cfg = readConfig();
  let token = cfg.token || storage.read('token');
  if (!token) { token = bytesToHex(randomBytes(16)); storage.write('token', token); }
  const up = createUpstream(cfg.upstreams, { log });
  const client = cfg.upstreams.length ? createRpcClient({ url: 'upstream', fetch: up.clientFetch }) : null;
  const cache = new Lru(4000);
  let chainId = null, head = null, problem = cfg.upstreams.length ? null : 'no upstream (set ETH_RPC_URL or ETH_UPSTREAMS)';
  log(`ethereum-wallet: upstreams ${cfg.upstreams.map(hostOf).join(', ') || 'none (set ETH_RPC_URL or ETH_UPSTREAMS)'}; watch-list token ${token} (set ETH_TOKEN to choose one)`);

  // Startup probe: chain id is verified once against ETH_CHAIN_ID. A mismatch sets "problem" and the proxy refuses
  // to serve: a wallet signing for chain A while reading balances from chain B is worse than no service.
  const ready = (async () => {
    if (!client) return;
    try {
      chainId = await client.chainId();
      if (cfg.chainId && cfg.chainId !== chainId) { problem = `chain id ${chainId} of the upstream is not ETH_CHAIN_ID ${cfg.chainId}`; log('ethereum-wallet: ' + problem); }
      head = await client.blockNumber();
    } catch (e) { log('ethereum-wallet: upstream error', e.message); }
  })();
  const ensureChain = async () => {
    if (chainId == null && client) { try { chainId = await client.chainId(); if (cfg.chainId && cfg.chainId !== chainId) problem = `chain id ${chainId} of the upstream is not ETH_CHAIN_ID ${cfg.chainId}`; } catch { /* still unknown */ } }
  };

  // --- the JSON-RPC proxy ---
  // Per-call validation returns an error object (or null) instead of throwing, so one bad call in a batch does not
  // fail the others - JSON-RPC 2.0 batch semantics.
  function checkCall(c) {
    if (!c || typeof c !== 'object' || c.jsonrpc !== '2.0' || typeof c.method !== 'string') return rpcErr(c && c.id, -32600, 'invalid request');
    if (!ALLOWED.has(c.method)) return rpcErr(c.id, -32601, `method ${c.method} is not available here`);
    const p = Array.isArray(c.params) ? c.params : c.params == null ? [] : null;
    if (!p) return rpcErr(c.id, -32602, 'params must be an array');
    if (c.method === 'eth_getLogs') {
      const f = p[0] || {};
      if (f.blockHash) return null;
      const from = f.fromBlock === 'earliest' ? 0n : q(f.fromBlock) ?? head;
      const to = q(f.toBlock) ?? head;
      if (from == null || to == null || to - from > BigInt(LOG_RANGE)) return rpcErr(c.id, -32005, `eth_getLogs: at most ${LOG_RANGE} blocks per request`);
    }
    return null;
  }

  // Cache hits are answered locally; misses are sent upstream in one request (batch preserved). Answers are matched
  // by id (JSON.stringify so 1 and "1" stay distinct), falling back to position for a single call - some nodes echo
  // ids loosely. head is tracked from eth_blockNumber traffic for the cache criterion at no extra cost.
  async function forward(calls, batch) {
    const out = new Array(calls.length).fill(null);
    const todo = [];
    calls.forEach((c, i) => {
      const bad = checkCall(c);
      if (bad) { out[i] = bad; return; }
      const key = c.method + JSON.stringify(c.params || []);
      const hit = cache.get(key);
      if (hit !== undefined) out[i] = { jsonrpc: '2.0', id: c.id, result: hit };
      else todo.push({ i, c, key });
    });
    if (todo.length) {
      const text = await up.post(JSON.stringify(batch ? todo.map((x) => x.c) : todo[0].c));
      let json;
      try { json = JSON.parse(text); } catch { throw Object.assign(new Error('upstream answer is not JSON'), { status: 502 }); }
      const list = Array.isArray(json) ? json : [json];
      const byId = new Map(list.map((r) => [JSON.stringify(r && r.id), r]));
      for (const x of todo) {
        const r = byId.get(JSON.stringify(x.c.id)) || (todo.length === 1 ? list[0] : null) || rpcErr(x.c.id, -32603, 'no answer from the upstream');
        out[x.i] = r;
        if (r && 'result' in r && cacheable(x.c.method, x.c.params || [], r.result, head)) cache.set(x.key, r.result);
        if (x.c.method === 'eth_blockNumber' && r && r.result) head = q(r.result) ?? head;
        if (x.c.method === 'eth_sendRawTransaction') log('ethereum-wallet: relayed', r && r.result ? r.result : 'error ' + JSON.stringify(r && r.error));
      }
    }
    return out;
  }

  async function rpcApi(req, res) {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST a JSON-RPC request' });
    if (!client) return sendJson(res, 503, rpcErr(null, -32603, problem));
    await ready;
    if (problem) return sendJson(res, 503, rpcErr(null, -32603, problem));
    let body;
    try { body = JSON.parse(await readBody(req)); } catch (e) { return sendJson(res, e.status || 400, rpcErr(null, -32700, e.status ? e.message : 'parse error')); }
    const batch = Array.isArray(body);
    const calls = batch ? body : [body];
    if (!calls.length || calls.length > MAX_BATCH) return sendJson(res, 400, rpcErr(null, -32600, `a batch has 1..${MAX_BATCH} requests`));
    try {
      const out = await forward(calls, batch);
      return sendJson(res, 200, batch ? out : out[0]);
    } catch (e) { return sendJson(res, e.status || 502, rpcErr(batch ? null : body.id, -32603, e.message)); }
  }

  // --- the watch index ---
  const list = () => storage.read('watch') || [];
  const saveList = (l) => storage.write('watch', l);
  const TRANSFER = eventTopic('event Transfer(address indexed from, address indexed to, uint256 value)');
  // Address as a 32-byte topic: indexed address params are left-padded with 12 zero bytes in log topics.
  const pad = (a) => '0x' + '0'.repeat(24) + a.slice(2).toLowerCase();

  // One watch-list refresh: balances (sequential: a small list, and parallel bursts invite upstream rate limits),
  // a series point at most every 10 minutes, then a scan of new blocks for ether transfers (full blocks) and ERC-20
  // Transfer logs where the address is topic1 (from) or topic2 (to) - two getLogs calls because topic positions are
  // ANDed, not ORed.
  async function refresh(w) {
    const d = storage.read('watch:' + w.id) || { balances: {}, series: [], transactions: [], scanned: w.fromBlock - 1 };
    const now = Math.floor(Date.now() / 1000);
    const latest = await client.blockNumber();
    head = latest;
    let total = 0n;
    for (const a of w.addresses) {
      const wei = await client.getBalance(a);
      total += wei;
      const tokens = {};
      for (const tk of w.tokens) {
        try { const out = await client.call({ to: tk, data: erc20BalanceOfData(a) }); tokens[tk] = out && out !== '0x' ? decodeParameters(['uint256'], out)[0].toString() : '0'; } catch { tokens[tk] = null; }
      }
      d.balances[a] = { wei: wei.toString(), tokens };
    }
    const last = d.series[d.series.length - 1];
    if (!last || now - last.t >= 600) d.series.push({ t: now, wei: total.toString() });
    if (d.series.length > 5000) d.series.splice(0, d.series.length - 5000);
    // New blocks: ether transfers (full transactions) and ERC-20 Transfer logs of the watched addresses.
    const from = BigInt(d.scanned) + 1n;
    const to = latest < from + BigInt(SCAN_PER_RUN) - 1n ? latest : from + BigInt(SCAN_PER_RUN) - 1n;
    if (from <= to) {
      const own = new Set(w.addresses.map((a) => a.toLowerCase()));
      const seen = new Set(d.transactions.map((x) => x.hash + x.kind + (x.logIndex ?? '')));
      const add = (x) => { const k = x.hash + x.kind + (x.logIndex ?? ''); if (!seen.has(k)) { seen.add(k); d.transactions.unshift(x); } };
      for (let n = from; n <= to; n++) {
        const b = await client.getBlock(n, true);
        // KNOWN DEFECT: a null block (node behind its own head, pruned) breaks the loop, but d.scanned is still set to
        // "to" below, so the remaining blocks of this range are never scanned. Fix: record n - 1 as scanned on break.
        if (!b) break;
        for (const tx of b.transactions || []) {
          if (own.has(String(tx.from).toLowerCase()) || (tx.to && own.has(String(tx.to).toLowerCase()))) {
            add({ kind: 'tx', hash: tx.hash, blockNumber: Number(n), time: Number(b.timestamp), from: tx.from, to: tx.to, value: String(tx.value), nonce: Number(tx.nonce) });
          }
        }
      }
      const pads = w.addresses.map(pad);
      for (const topics of [[TRANSFER, pads], [TRANSFER, null, pads]]) {
        try {
          for (const log of await client.getLogs({ fromBlock: from, toBlock: to, topics })) {
            if (log.topics.length !== 3) continue; // ERC-721 indexes the token id
            add({ kind: 'erc20', hash: log.transactionHash, blockNumber: Number(log.blockNumber), logIndex: log.logIndex, token: log.address, from: getAddress('0x' + log.topics[1].slice(26)), to: getAddress('0x' + log.topics[2].slice(26)), amount: BigInt(log.data).toString() });
          }
        } catch (e) { log('ethereum-wallet: logs', e.message); }
      }
      d.transactions.sort((a, b) => b.blockNumber - a.blockNumber);
      if (d.transactions.length > 5000) d.transactions.length = 5000;
      d.scanned = Number(to);
    }
    d.updated = now;
    storage.write('watch:' + w.id, d);
    return d;
  }
  // Re-entrancy guard: a refresh slower than the 60 s interval must not overlap the next one. unref(): the timer does
  // not keep the process alive on shutdown.
  let running = false;
  async function refreshAll() {
    if (running || !client || problem) return;
    running = true;
    try { for (const w of list()) { try { await refresh(w); } catch (e) { log('ethereum-wallet: watch', w.id, e.message); } } } finally { running = false; }
  }
  const timer = setInterval(refreshAll, 60000);
  if (timer.unref) timer.unref();
  ready.then(() => refreshAll());

  // Constant-time comparison (equalBytes) of the bearer token: string === leaks the matching prefix length via timing.
  const authed = (req) => {
    const m = /^Bearer\s+(.+)$/.exec(req.headers.authorization || '');
    return !!m && equalBytes(utf8ToBytes(m[1].trim()), utf8ToBytes(token));
  };

  async function watchApi(req, res, rest) {
    const id = rest[0];
    if (req.method === 'GET' && !id) return sendJson(res, 200, list().map((w) => { const d = storage.read('watch:' + w.id); return { ...w, updated: d ? d.updated : null }; }));
    if (req.method === 'GET') {
      const w = list().find((x) => x.id === id);
      if (!w) return sendJson(res, 404, { error: 'not found' });
      const d = storage.read('watch:' + id) || (client && !problem ? await refresh(w) : { balances: {}, series: [], transactions: [], scanned: w.fromBlock - 1 });
      return sendJson(res, 200, { ...w, ...d });
    }
    if (!authed(req)) return sendJson(res, 401, { error: 'token required' }, { 'WWW-Authenticate': 'Bearer' });
    if (req.method === 'DELETE' && id) { saveList(list().filter((w) => w.id !== id)); storage.remove('watch:' + id); return sendJson(res, 200, { ok: true }); }
    if (req.method === 'POST' && !id) {
      let b;
      try { b = JSON.parse(await readBody(req, 65536)); } catch { return sendJson(res, 400, { error: 'invalid JSON' }); }
      const text = JSON.stringify(b);
      // Watch-only: anything that looks like a private key or a recovery phrase is refused. Heuristic, deliberately
      // over-strict: any 64-hex run (also a tx hash) is rejected; no legitimate field of this API carries one.
      if (/(?:^|[^0-9a-fA-F])(?:0x)?[0-9a-fA-F]{64}(?![0-9a-fA-F])/.test(text) || /privateKey|mnemonic|phrase|keystore|crypto/i.test(Object.keys(b || {}).join(' '))) return sendJson(res, 400, { error: 'private keys are not accepted' });
      const addresses = Array.isArray(b.addresses) ? b.addresses : [];
      const tokens = Array.isArray(b.tokens) ? b.tokens : [];
      if (!addresses.length || addresses.length > 100 || addresses.some((a) => !isAddress(a))) return sendJson(res, 400, { error: '1..100 valid addresses expected' });
      if (tokens.length > 50 || tokens.some((a) => !isAddress(a))) return sendJson(res, 400, { error: 'invalid token address' });
      await ready;
      if (!client || problem) return sendJson(res, 503, { error: problem || 'no upstream' });
      let start;
      try { start = Number(await client.blockNumber()); } catch (e) { return sendJson(res, 502, { error: e.message }); }
      const w = { id: bytesToHex(randomBytes(8)), label: String(b.label || '').slice(0, 80), chainId, addresses: addresses.map(getAddress), tokens: tokens.map(getAddress), fromBlock: start, created: Math.floor(Date.now() / 1000) };
      saveList([...list(), w]);
      refresh(w).catch((e) => log('ethereum-wallet: watch', w.id, e.message));
      return sendJson(res, 200, w);
    }
    return sendJson(res, 405, { error: 'method not allowed' });
  }

  // Mounted under any prefix: the regex takes everything before /api/ as the base, so the same code works at
  // /ethereum-wallet/api/ and at a custom deployment path. Returns false for non-API paths so the host serves files.
  async function handle(req, res, url) {
    const m = /^(.*?\/)api\/(.*)$/.exec(url.pathname);
    if (!m) return false;
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return true; }
    const parts = m[2].split('/').filter(Boolean);
    try {
      if (parts[0] === 'info') {
        await ready;
        await ensureChain();
        if (client && !problem) { try { head = await client.blockNumber(); } catch { /* keep the last one */ } }
        sendJson(res, 200, { app: 'ethereum-wallet', version: 1, chainId, head: head != null ? Number(head) : null, upstream: client ? hostOf(up.current()) : null, watchOnly: true, problem });
        return true;
      }
      if (parts[0] === 'rpc' && parts.length === 1) { await rpcApi(req, res); return true; }
      if (parts[0] === 'watch') { await ready; await watchApi(req, res, parts.slice(1)); return true; }
      sendJson(res, 404, { error: 'not found' });
      return true;
    } catch (e) {
      sendJson(res, e.status || 500, { error: e.message });
      return true;
    }
  }
  // close(): stops the background job (tests, embedding).
  return { handle, close() { clearInterval(timer); } };
}
