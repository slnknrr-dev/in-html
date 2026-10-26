// bitcoin/esplora.js - a client of the Esplora REST API (Blockstream's esplora, mempool.space, electrs-esplora, and the
// Esplora-compatible API of the bitcoin-wallet backend) for browsers and Node. Nothing is contacted until a method is
// called; the base URL is always the caller's choice. Offline builds replace this module by esplora.offline.js.
//
//   createEsploraClient({ url, fetch = globalThis.fetch, timeout = 20000, headers }) -> client
//   client.tipHeight(), tipHash(), blockHash(height), block(hash), blockHeader(hash), blockStatus(hash),
//     blockTxids(hash), blockTxs(hash, start = 0), blockRaw(hash) -> Uint8Array, blocks(startHeight?) (10 per page)
//   client.tx(txid), txHex(txid), txStatus(txid), txOutspends(txid), txMerkleProof(txid), broadcast(hex) -> txid
//   client.address(addr), addressTxs(addr, lastSeenTxid?), addressMempoolTxs(addr), addressUtxos(addr)
//   client.scripthash(hash), scripthashTxs(hash, lastSeen?), scripthashUtxos(hash)      (hash: sha256 of the script, hex)
//   client.mempool(), mempoolRecent(), mempoolTxids(), feeEstimates() -> { "1": sat/vB, … }
//   client.recommendedFees() -> mempool.space /v1/fees/recommended or null, client.mempoolBlocks() -> … or null
//   client.request(path, { method, body, as: 'json' | 'text' | 'bytes' })
//   ONLINE = true (false in the offline twin)     scriptHashOf(script) -> hex for the scripthash endpoints
//
// Privacy: each address query tells the server (and anyone on the path without TLS) that this IP is interested in
// that address; querying all wallet addresses from one client links them. mempool.space / blockstream.info presets
// are convenience, not privacy - point `url` at your own electrs-esplora or a Tor (.onion) instance for that.
// Integrity: responses are trusted as-is (no merkle / header verification), same trust model as electrum.js.
// Broadcast posts the raw hex as text/plain: a CORS "simple request" (no preflight), which public Esplora instances
// accept from any origin.
import { sha256 } from '../crypto/sha2.js';
import { bytesToHex } from '../crypto/encoding.js';

// The build swaps this module for esplora.offline.js; apps check ONLINE to hide network features in offline builds.
export const ONLINE = true;

export const scriptHashOf = (script) => bytesToHex(sha256(script));

export class EsploraError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

export function createEsploraClient({ url, fetch: fetchFn = globalThis.fetch, timeout = 20000, headers = {} } = {}) {
  if (!url) throw new Error('an Esplora URL is needed');
  if (typeof fetchFn !== 'function') throw new Error('no fetch available');
  const base = String(url).replace(/\/+$/, '');
  // AbortController timeout (fetch has none); cache: 'no-store' because balances and tips must never come from the
  // HTTP cache. Error bodies are kept (Esplora returns the node's reject reason, e.g. "min relay fee not met", as
  // text) but truncated for the message, as they are server-controlled text.
  async function request(path, { method = 'GET', body, as = 'json' } = {}) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
    let r;
    try {
      r = await fetchFn(base + path, { method, body, headers: { ...(body ? { 'Content-Type': 'text/plain' } : {}), ...headers }, signal: ctrl ? ctrl.signal : undefined, cache: 'no-store' });
    } catch (e) {
      throw new EsploraError(e && e.name === 'AbortError' ? 'request timed out' : `network error: ${e && e.message}`, 0, null);
    } finally { if (timer) clearTimeout(timer); }
    if (!r.ok) {
      let text = '';
      try { text = await r.text(); } catch { /* ignore */ }
      throw new EsploraError(text.trim().slice(0, 300) || `HTTP ${r.status}`, r.status, text);
    }
    if (as === 'text') return (await r.text()).trim();
    if (as === 'bytes') return new Uint8Array(await r.arrayBuffer());
    return r.json();
  }
  // mempool.space-only extensions: 404 / 400 on plain Esplora means "not supported", reported as null.
  // Path segments are encodeURIComponent-ed: an address or txid from user input cannot inject '/..' or a query.
  const optional = async (path) => { try { return await request(path); } catch (e) { if (e.status === 404 || e.status === 400) return null; throw e; } };
  const enc = encodeURIComponent;
  return {
    url: base,
    request,
    tipHeight: async () => Number(await request('/blocks/tip/height', { as: 'text' })),
    tipHash: () => request('/blocks/tip/hash', { as: 'text' }),
    blockHash: (height) => request(`/block-height/${height}`, { as: 'text' }),
    block: (hash) => request(`/block/${enc(hash)}`),
    blockHeader: (hash) => request(`/block/${enc(hash)}/header`, { as: 'text' }),
    blockStatus: (hash) => request(`/block/${enc(hash)}/status`),
    blockTxids: (hash) => request(`/block/${enc(hash)}/txids`),
    blockTxs: (hash, start = 0) => request(`/block/${enc(hash)}/txs${start ? '/' + start : ''}`),
    blockRaw: (hash) => request(`/block/${enc(hash)}/raw`, { as: 'bytes' }),
    blocks: (start) => request(`/blocks${start !== undefined && start !== null ? '/' + start : ''}`),
    tx: (txid) => request(`/tx/${enc(txid)}`),
    txHex: (txid) => request(`/tx/${enc(txid)}/hex`, { as: 'text' }),
    txStatus: (txid) => request(`/tx/${enc(txid)}/status`),
    txOutspends: (txid) => request(`/tx/${enc(txid)}/outspends`),
    txMerkleProof: (txid) => request(`/tx/${enc(txid)}/merkle-proof`),
    broadcast: (hex) => request('/tx', { method: 'POST', body: String(hex).trim(), as: 'text' }),
    address: (a) => request(`/address/${enc(a)}`),
    addressTxs: (a, lastSeen) => request(lastSeen ? `/address/${enc(a)}/txs/chain/${enc(lastSeen)}` : `/address/${enc(a)}/txs`),
    addressMempoolTxs: (a) => request(`/address/${enc(a)}/txs/mempool`),
    addressUtxos: (a) => request(`/address/${enc(a)}/utxo`),
    scripthash: (h) => request(`/scripthash/${enc(h)}`),
    scripthashTxs: (h, lastSeen) => request(lastSeen ? `/scripthash/${enc(h)}/txs/chain/${enc(lastSeen)}` : `/scripthash/${enc(h)}/txs`),
    scripthashUtxos: (h) => request(`/scripthash/${enc(h)}/utxo`),
    mempool: () => request('/mempool'),
    mempoolRecent: () => request('/mempool/recent'),
    mempoolTxids: () => request('/mempool/txids'),
    feeEstimates: () => request('/fee-estimates'),
    recommendedFees: () => optional('/v1/fees/recommended'),
    mempoolBlocks: () => optional('/v1/fees/mempool-blocks'),
  };
}
