// funding-studio/mock-chains.js - a local server that mimics an Esplora API (Blockstream / mempool.space shapes) and an
// Ethereum JSON-RPC endpoint, for tests and end-to-end scenarios (Node only; never reaches a real network).
//
//   startMockChains({ port }) -> Promise<{ url, esplora (= url + '/esplora'), rpc (= url + '/rpc'), btc, eth, close() }>
//   btc.pay(address, sats, { confirmed = true }) -> txid        btc.tip (height, settable)
//   eth.native({ to, wei, from }) -> hash      eth.token({ token, to, units, from }) -> hash      eth.block (number, settable)
import http from 'node:http';
import { TRANSFER_TOPIC } from './chains.js';

// Only the endpoints chains.js / server-crypto.js call are implemented, with the same response shapes (Esplora
// address stats and tx lists; JSON-RPC 2.0 envelopes with hex quantities), so the production clients run unmodified.
// Binds to 127.0.0.1 and port 0 by default (OS-assigned): parallel test runs never collide and nothing is exposed.
// Math.random ids are fine here - test data only.
const hex = (n) => '0x' + BigInt(n).toString(16);
const rnd = (n) => { let s = ''; for (let i = 0; i < n; i++) s += '0123456789abcdef'[Math.floor(Math.random() * 16)]; return s; };

export async function startMockChains({ port = 0, host = '127.0.0.1' } = {}) {
  const btc = { tip: 850000, txs: [] };
  const eth = { block: 21000000, txs: new Map() };
  const json = (res, status, v) => { const b = Buffer.from(JSON.stringify(v)); res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': b.length }); res.end(b); };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://mock');
    const p = url.pathname;
    let m;
    if (p === '/esplora/blocks/tip/height') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(String(btc.tip)); return; }
    if ((m = /^\/esplora\/address\/([^/]+)(\/txs)?$/.exec(p))) {
      const a = decodeURIComponent(m[1]);
      const txs = btc.txs.filter((t) => t.vout.some((o) => o.scriptpubkey_address === a));
      if (m[2]) { json(res, 200, txs); return; }
      const sum = (conf) => txs.filter((t) => t.status.confirmed === conf).reduce((s, t) => s + t.vout.filter((o) => o.scriptpubkey_address === a).reduce((x, o) => x + o.value, 0), 0);
      json(res, 200, { address: a, chain_stats: { funded_txo_count: txs.length, funded_txo_sum: sum(true), spent_txo_count: 0, spent_txo_sum: 0, tx_count: txs.length }, mempool_stats: { funded_txo_sum: sum(false), tx_count: 0 } });
      return;
    }
    if (p === '/rpc' && req.method === 'POST') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        let r;
        try { r = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
        const ok = (result) => json(res, 200, { jsonrpc: '2.0', id: r.id, result });
        const t = r.params && eth.txs.get(String(r.params[0]).toLowerCase());
        switch (r.method) {
          case 'eth_blockNumber': ok(hex(eth.block)); return;
          case 'eth_getTransactionByHash': ok(t ? t.tx : null); return;
          case 'eth_getTransactionReceipt': ok(t ? t.receipt : null); return;
          case 'eth_getBalance': ok('0x0'); return;
          default: json(res, 200, { jsonrpc: '2.0', id: r.id, error: { code: -32601, message: 'Method not found' } });
        }
      });
      return;
    }
    json(res, 404, { error: 'unknown mock route' });
  });
  await new Promise((r) => server.listen(port, host, r));
  const url = `http://${host}:${server.address().port}`;
  const pad = (a) => '0x' + a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  return {
    url, esplora: url + '/esplora', rpc: url + '/rpc', btc, eth,
    payBtc(address, sats, { confirmed = true } = {}) {
      const txid = rnd(64);
      btc.txs.push({ txid, status: confirmed ? { confirmed: true, block_height: btc.tip, block_time: Math.floor(Date.now() / 1000) } : { confirmed: false }, vout: [{ scriptpubkey_address: address, value: sats }] });
      return txid;
    },
    payEth({ to, wei, from = '0x' + '1'.repeat(40), status = '0x1' }) {
      const hash = '0x' + rnd(64);
      eth.txs.set(hash, { tx: { hash, from, to: to.toLowerCase(), value: hex(wei), blockNumber: hex(eth.block) }, receipt: { transactionHash: hash, status, blockNumber: hex(eth.block), logs: [] } });
      return hash;
    },
    payToken({ token, to, units, from = '0x' + '2'.repeat(40) }) {
      const hash = '0x' + rnd(64);
      eth.txs.set(hash, {
        tx: { hash, from, to: token.toLowerCase(), value: '0x0', blockNumber: hex(eth.block) },
        receipt: { transactionHash: hash, status: '0x1', blockNumber: hex(eth.block), logs: [{ address: token.toLowerCase(), topics: [TRANSFER_TOPIC, pad(from), pad(to)], data: pad(BigInt(units).toString(16)) }] },
      });
      return hash;
    },
    close: () => new Promise((r) => { server.close(() => r()); if (server.closeAllConnections) server.closeAllConnections(); }),
  };
}
