// ethereum-wallet/test.js - tests of the backend (`node ethereum-wallet/test.js`, `node check.js tests ethereum-wallet`)
// against a mock JSON-RPC node on 127.0.0.1 (nothing leaves the machine): info, the proxy's allowlist, batches,
// failover between upstreams, broadcast relay, the watch list with its token, balance snapshots. When `anvil` is
// installed, the proxy is also checked against a throw-away Anvil node (skipped otherwise).
//
// Test style: no framework, a tiny eq() that compares JSON forms and counts failures; run() returns the failure count
// so check.js can aggregate suites. Environment variables are swapped per scenario (withEnv) because backend()
// reads its config at construction time.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns';
import zlib from 'node:zlib';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import backend from './backend.js';

// Runs standalone only when executed directly; check.js imports run() instead.
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'; // Hardhat / Anvil development account #0 (public test key)

// Port 0 = OS picks a free port: tests can run in parallel and never collide with a running dev server.
const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const memoryStorage = () => { const m = new Map(); return { read: (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), write: (k, v) => m.set(k, JSON.stringify(v)), list: (p = '') => [...m.keys()].filter((k) => k.startsWith(p)), remove: (k) => m.delete(k) }; };

async function withEnv(vars, fn) {
  const old = {};
  for (const k of Object.keys(vars)) { old[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(vars)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } }
}

async function startBackend() {
  const api = backend({ dataDir: '', storage: memoryStorage(), log: () => {}, name: 'ethereum-wallet', node: { http, https, dns, net, zlib } });
  const server = http.createServer(async (req, res) => { if (!(await api.handle(req, res, new URL(req.url, 'http://local')))) { res.writeHead(404); res.end(); } });
  const port = await listen(server);
  const call = async (method, p, body, token) => {
    const r = await fetch(`http://127.0.0.1:${port}/${p}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: r.status, json };
  };
  return { call, close: () => { if (api.close) api.close(); server.closeAllConnections(); server.close(); } };
}

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const seen = [];
  const node = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const reqs = JSON.parse(body);
      const one = (r) => {
        seen.push(r.method);
        const result = { eth_chainId: '0x7a69', eth_blockNumber: '0x10', eth_getBalance: '0xde0b6b3a7640000', eth_sendRawTransaction: '0x' + 'ab'.repeat(32), eth_getBlockByNumber: null, eth_call: '0x' + '0'.repeat(64), eth_getLogs: [], web3_clientVersion: 'mock/1.0' }[r.method];
        return { jsonrpc: '2.0', id: r.id, result: result === undefined ? null : result };
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(Array.isArray(reqs) ? reqs.map(one) : one(reqs)));
    });
  });
  const port = await listen(node);
  // Failover is tested with a real refused connection (port 1) rather than a mock throw: it exercises the actual
  // fetch error path in createUpstream.
  const dead = 'http://127.0.0.1:1'; // nothing listens there: failover to the next upstream
  await withEnv({ ETH_RPC_URL: undefined, ETH_UPSTREAMS: `${dead},http://127.0.0.1:${port}`, ETH_CHAIN_ID: '31337', ETH_TOKEN: 'tok' }, async () => {
    const b = await startBackend();
    const info = await b.call('GET', 'ethereum-wallet/api/info');
    eq('info', [info.status, info.json.app, info.json.chainId, info.json.watchOnly], [200, 'ethereum-wallet', 31337, true]);
    const bal = await b.call('POST', 'api/rpc', { jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [ADDR, 'latest'] });
    eq('proxy read', bal.json.result, '0xde0b6b3a7640000');
    const denied = await b.call('POST', 'api/rpc', { jsonrpc: '2.0', id: 2, method: 'eth_sign', params: [ADDR, '0x00'] });
    eq('allowlist', !!denied.json.error, true);
    const batch = await b.call('POST', 'api/rpc', [{ jsonrpc: '2.0', id: 3, method: 'eth_chainId', params: [] }, { jsonrpc: '2.0', id: 4, method: 'eth_blockNumber', params: [] }]);
    eq('batch', batch.json.map((x) => x.result), ['0x7a69', '0x10']);
    const sent = await b.call('POST', 'api/rpc', { jsonrpc: '2.0', id: 5, method: 'eth_sendRawTransaction', params: ['0x02f8'] });
    eq('relay signed transaction', sent.json.result, '0x' + 'ab'.repeat(32));
    eq('watch needs the token', (await b.call('POST', 'api/watch', { addresses: [ADDR] })).status, 401);
    const w = await b.call('POST', 'api/watch', { label: 'dev', addresses: [ADDR] }, 'tok');
    eq('watch added', w.status, 200);
    eq('watch rejects keys', (await b.call('POST', 'api/watch', { addresses: ['0x' + '11'.repeat(32)] }, 'tok')).status, 400);
    eq('watch list', (await b.call('GET', 'api/watch')).json.length, 1);
    b.close();
  });
  node.closeAllConnections();
  node.close();

  // Optional integration against a real node; a fixed 2.5 s startup wait is crude but adequate for anvil, and the
  // random port avoids clashing with a developer's own anvil on 8545.
  const anvil = spawnSync('anvil', ['--version'], { encoding: 'utf8' });
  if (anvil.error || anvil.status !== 0) console.log('ethereum-wallet: anvil not installed, Anvil integration test skipped');
  else {
    const p = 20000 + Math.floor(Math.random() * 20000);
    const proc = spawn('anvil', ['--port', String(p), '--silent'], { stdio: 'ignore' });
    try {
      await new Promise((r) => setTimeout(r, 2500));
      await withEnv({ ETH_RPC_URL: `http://127.0.0.1:${p}`, ETH_UPSTREAMS: undefined, ETH_CHAIN_ID: '31337', ETH_TOKEN: 'tok' }, async () => {
        const b = await startBackend();
        const r = await b.call('POST', 'api/rpc', { jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [ADDR, 'latest'] });
        eq('anvil balance', BigInt(r.json.result) > 0n, true);
        b.close();
      });
    } finally { proc.kill(); }
  }
  console.log(`ethereum-wallet backend: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
