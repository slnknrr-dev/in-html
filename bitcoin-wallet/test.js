// bitcoin-wallet/test.js - tests of the backend (`node bitcoin-wallet/test.js`, `node check.js tests bitcoin-wallet`):
// the API against local mock servers on 127.0.0.1 (an upstream Esplora over HTTP, Bitcoin Core JSON-RPC over HTTP, an
// Electrum server over TCP) — nothing leaves the machine — and, only when `bitcoind` is installed, an integration test
// on a throw-away regtest node (skipped otherwise).
//
// Testing approach: protocol-level mocks instead of stubbing provider functions. Each mock speaks the real wire
// format (Esplora HTTP, Core JSON-RPC with Basic auth, Electrum newline-delimited JSON over TCP), so the tests cover
// request building, parsing and the Esplora mapping end to end. Port 0 lets the OS pick free ports (no collisions
// when tests run in parallel); every server binds to 127.0.0.1 only.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns';
import zlib from 'node:zlib';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import backend from './backend.js';

// Runs standalone (`node test.js`) or imported by check.js, which calls run() itself.
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
// BIP-173 test vector address (testnet), so no real coins or third-party address is involved.
const ADDR = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';

const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
// Storage double with the ctx.storage contract; JSON round trip mimics the file store (no shared object references).
const memoryStorage = () => { const m = new Map(); return { read: (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), write: (k, v) => m.set(k, JSON.stringify(v)), list: (p = '') => [...m.keys()].filter((k) => k.startsWith(p)), remove: (k) => m.delete(k) }; };

// readConfig() reads process.env at backend start, so each scenario sets its variables around startBackend() and
// restores them afterwards (undefined = delete), keeping scenarios independent.
async function withEnv(vars, fn) {
  const old = {};
  for (const k of Object.keys(vars)) { old[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(vars)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } }
}

// The backend behind a local HTTP server: call(method, path, body, token) -> { status, json | text }.
async function startBackend() {
  const api = backend({ dataDir: '', storage: memoryStorage(), log: () => {}, name: 'bitcoin-wallet', node: { http, https, dns, net, zlib } });
  const server = http.createServer(async (req, res) => { if (!(await api.handle(req, res, new URL(req.url, 'http://local')))) { res.writeHead(404); res.end(); } });
  const port = await listen(server);
  const call = async (method, p, body, token) => {
    const r = await fetch(`http://127.0.0.1:${port}/${p}`, { method, body, headers: token ? { Authorization: 'Bearer ' + token } : {} });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: r.status, json, text };
  };
  // closeAllConnections(): fetch keeps sockets alive; without it server.close() would wait for idle timeouts.
  return { call, close: () => { api.close(); server.closeAllConnections(); server.close(); } };
}

export async function run() {
  let pass = 0, fail = 0;
  // Deep equality via JSON: enough for plain data; failures print got/want for diagnosis.
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // --- upstream Esplora ---
  const posted = [];
  const upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const p = req.url.replace(/^\/api/, '');
      const j = (v) => { res.writeHead(200, { 'Content-Type': typeof v === 'string' ? 'text/plain' : 'application/json' }); res.end(typeof v === 'string' ? v : JSON.stringify(v)); };
      if (p === '/blocks/tip/height') return j('321');
      if (p === '/fee-estimates') return j({ 1: 12.5, 6: 3 });
      if (p === `/address/${ADDR}`) return j({ chain_stats: { tx_count: 1, funded_txo_sum: 5000, spent_txo_sum: 0 }, mempool_stats: { tx_count: 0, funded_txo_sum: 0, spent_txo_sum: 0 } });
      if (p === `/address/${ADDR}/txs`) return j([{ txid: 'ab'.repeat(32), status: { confirmed: true, block_height: 300, block_time: 1700000000 }, fee: 100, weight: 400, vin: [{ prevout: { scriptpubkey: '0014' + '11'.repeat(20), value: 5100 }, sequence: 0xffffffff }], vout: [{ scriptpubkey: '0014751e76e8199196d454941c45d1b3a323f1433bd6', value: 5000 }] }]);
      if (p === `/address/${ADDR}/utxo`) return j([{ txid: 'ab'.repeat(32), vout: 0, value: 5000, status: { confirmed: true, block_height: 300 } }]);
      if (p === '/tx' && req.method === 'POST') { posted.push(body); return j('cd'.repeat(32)); }
      res.writeHead(404); res.end('not found');
    });
  });
  const upPort = await listen(upstream);
  await withEnv({ BTC_NETWORK: 'testnet4', BTC_ESPLORA_URL: `http://127.0.0.1:${upPort}/api`, BTC_TOKEN: 'secret-token', BTC_RPC_URL: undefined, BTC_ELECTRUM: undefined, BTC_SOURCE: undefined }, async () => {
    const b = await startBackend();
    const info = await b.call('GET', 'bitcoin-wallet/api/info');
    eq('info', [info.status, info.json.app, info.json.network, info.json.source, info.json.watchOnly, info.json.tip], [200, 'bitcoin-wallet', 'testnet4', 'esplora', true, 321]);
    eq('esplora proxy', (await b.call('GET', 'api/esplora/fee-estimates')).json, { 1: 12.5, 6: 3 });
    eq('esplora text', (await b.call('GET', 'api/esplora/blocks/tip/height')).text, '321');
    eq('broadcast', (await b.call('POST', 'api/esplora/tx', '0200000000')).text, 'cd'.repeat(32));
    eq('broadcast body', posted, ['0200000000']);
    eq('broadcast rejects non-hex', (await b.call('POST', 'api/esplora/tx', 'hello')).status, 400);
    eq('watch needs a token', (await b.call('POST', 'api/watch', JSON.stringify({ addresses: [ADDR] }))).status, 401);
    eq('watch rejects private keys', (await b.call('POST', 'api/watch', JSON.stringify({ xpub: 'tprv8ZgxMBicQKsPd7Uf69XL1XwhmjHopUGep8GuEiJDZmbQz6o58LninorQAfcKZWARbtRtfnLcJ5MQ2AtHcQJCCRUcMRvmDUjyEmNUWwx8UbK' }), 'secret-token')).status, 400);
    const w = await b.call('POST', 'api/watch', JSON.stringify({ label: 'cold', addresses: [ADDR] }), 'secret-token');
    eq('watch added', [w.status, w.json.label, w.json.addresses], [200, 'cold', [ADDR]]);
    // The watch refresh runs in the background after the POST answer; give it a moment before reading the summary.
    await sleep(300);
    const s = await b.call('GET', 'api/watch/' + w.json.id);
    eq('watch summary', [s.status, s.json.balance.total, s.json.utxos.length, s.json.history.length, s.json.history[0].net], [200, 5000, 1, 1, 5000]);
    eq('watch list', (await b.call('GET', 'api/watch')).json.map((x) => x.id), [w.json.id]);
    eq('watch delete', (await b.call('DELETE', 'api/watch/' + w.json.id, null, 'secret-token')).status, 200);
    eq('unknown route', (await b.call('GET', 'api/nothing')).status, 404);
    b.close();
  });
  upstream.closeAllConnections(); upstream.close();

  // --- Bitcoin Core JSON-RPC (mock) ---
  const rpcSeen = [];
  const core = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const r = JSON.parse(body);
      rpcSeen.push([r.method, req.headers.authorization]);
      const result = { getblockcount: 150, estimatesmartfee: { feerate: 0.00012, blocks: 2 }, getbestblockhash: '00'.repeat(32), sendrawtransaction: 'ef'.repeat(32) }[r.method];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result === undefined ? { id: r.id, result: null, error: { code: -32601, message: 'Method not found' } } : { id: r.id, result, error: null }));
    });
  });
  const corePort = await listen(core);
  await withEnv({ BTC_NETWORK: 'regtest', BTC_RPC_URL: `http://127.0.0.1:${corePort}`, BTC_RPC_USER: 'u', BTC_RPC_PASSWORD: 'p', BTC_ESPLORA_URL: undefined, BTC_ELECTRUM: undefined, BTC_SOURCE: undefined }, async () => {
    const b = await startBackend();
    eq('core tip', (await b.call('GET', 'api/esplora/blocks/tip/height')).text, '150');
    // 0.00012 BTC/kvB = 12 sat/vB: proves the unit conversion of estimatesmartfee.
    eq('core fee estimates', (await b.call('GET', 'api/esplora/fee-estimates')).json[1], 12);
    eq('core broadcast', (await b.call('POST', 'api/esplora/tx', '0200')).text, 'ef'.repeat(32));
    eq('core auth', rpcSeen[0][1], 'Basic ' + Buffer.from('u:p').toString('base64'));
    b.close();
  });
  core.closeAllConnections(); core.close();

  // --- Electrum (mock TCP server) ---
  const electrum = net.createServer((sock) => {
    let buf = '';
    sock.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const m = JSON.parse(buf.slice(0, i));
        buf = buf.slice(i + 1);
        const result = { 'server.version': ['mock', '1.4'], 'blockchain.headers.subscribe': { height: 777, hex: '00'.repeat(80) }, 'blockchain.scripthash.get_balance': { confirmed: 42000, unconfirmed: 0 }, 'blockchain.scripthash.get_history': [{ tx_hash: 'aa'.repeat(32), height: 700 }], 'blockchain.estimatefee': 0.0002 }[m.method];
        sock.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: result ?? null }) + '\n');
      }
    });
  });
  const elPort = await listen(electrum);
  await withEnv({ BTC_NETWORK: 'testnet4', BTC_ELECTRUM: `127.0.0.1:${elPort}`, BTC_RPC_URL: undefined, BTC_ESPLORA_URL: undefined, BTC_SOURCE: undefined }, async () => {
    const b = await startBackend();
    eq('electrum tip', (await b.call('GET', 'api/esplora/blocks/tip/height')).text, '777');
    const a = (await b.call('GET', `api/esplora/address/${ADDR}`)).json;
    eq('electrum address', [a.chain_stats.funded_txo_sum, a.chain_stats.tx_count], [42000, 1]);
    // 0.0002 BTC/kvB from Electrum's estimatefee -> 20 sat/vB.
    eq('electrum fee', (await b.call('GET', 'api/esplora/fee-estimates')).json[1], 20);
    b.close();
  });
  electrum.close();

  // --- optional: bitcoind regtest ---
  // Integration test only when bitcoind exists: CI without it still passes, developers with it get real coverage.
  const bitcoind = spawnSync('bitcoind', ['-version'], { encoding: 'utf8' });
  if (bitcoind.error || bitcoind.status !== 0) console.log('bitcoin-wallet: bitcoind not installed, regtest integration test skipped');
  else fail += await regtest(eq);

  console.log(`bitcoin-wallet backend: ${pass} passed, ${fail} failed`);
  return fail;
}

// A throw-away regtest node: mine, watch a descriptor through the backend, broadcast through the backend.
async function regtest(eq) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'btcw-regtest-'));
  // Random high RPC port and a temp datadir: the node never touches a real wallet or a running node's port.
  // -txindex lets getrawtransaction find arbitrary transactions; 101 blocks make the first coinbase spendable
  // (coinbase maturity is 100 blocks).
  const port = 20000 + Math.floor(Math.random() * 20000);
  const node = spawn('bitcoind', ['-regtest', `-datadir=${dir}`, `-rpcport=${port}`, '-rpcuser=u', '-rpcpassword=p', '-server', '-listen=0', '-fallbackfee=0.0002', '-txindex'], { stdio: 'ignore' });
  const { createCoreRpc } = await import('../bitcoin/rpc.js');
  const rpc = createCoreRpc({ url: `http://127.0.0.1:${port}`, user: 'u', password: 'p' });
  try {
    for (let i = 0; i < 60; i++) { try { await rpc.getBlockCount(); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
    await rpc.createWallet('miner', { watchOnly: false }).catch(() => {});
    const miner = rpc.wallet('miner');
    const addr = await miner.call('getnewaddress');
    await rpc.call('generatetoaddress', 101, addr);
    await withEnv({ BTC_NETWORK: 'regtest', BTC_RPC_URL: `http://127.0.0.1:${port}`, BTC_RPC_USER: 'u', BTC_RPC_PASSWORD: 'p', BTC_TOKEN: 't', BTC_ESPLORA_URL: undefined, BTC_ELECTRUM: undefined, BTC_SOURCE: undefined }, async () => {
      const b = await startBackend();
      eq('regtest tip', (await b.call('GET', 'api/esplora/blocks/tip/height')).text, '101');
      const target = await miner.call('getnewaddress', '', 'bech32');
      const w = await b.call('POST', 'api/watch', JSON.stringify({ addresses: [target] }), 't');
      eq('regtest watch', w.status, 200);
      const txid = await miner.call('sendtoaddress', target, 1.5);
      const tx = await b.call('GET', 'api/esplora/tx/' + txid);
      eq('regtest tx', tx.json.txid, txid);
      await rpc.call('generatetoaddress', 1, addr);
      const a = await b.call('GET', 'api/esplora/address/' + target);
      eq('regtest balance', a.json.chain_stats.funded_txo_sum - a.json.chain_stats.spent_txo_sum, 150000000);
      b.close();
    });
    return 0;
  // finally: the node is killed and its datadir removed even on failure (Windows may keep files locked briefly).
  } catch (e) { console.log('FAIL regtest:', e.message); return 1; } finally { node.kill(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* locked */ } }
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
