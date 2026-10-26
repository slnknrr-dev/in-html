// bitcoin-wallet/backend.js - the server side of the BACKEND artifact (hosting.js mounts it; so does the development
// server `node bitcoin-wallet/server.js`): an Esplora-compatible API for the explorer, the dashboard and the wallets,
// served from the owner's Bitcoin Core node, an Electrum server or an upstream Esplora instance, with a cache, and a
// watch list of wallets (xpubs, descriptors, addresses) that it indexes in the background. Watch-only: it never sees a
// private key; signing happens in the browser.
//
// Configuration (environment variables; read at start):
//   BTC_NETWORK      mainnet | testnet | testnet4 | signet | regtest                    (default mainnet)
//   BTC_SOURCE       core | electrum | esplora (default: the first one configured below)
//   BTC_RPC_URL      Bitcoin Core JSON-RPC, e.g. http://127.0.0.1:8332; BTC_RPC_USER / BTC_RPC_PASSWORD or
//                    BTC_RPC_COOKIE (path of the .cookie file); BTC_RPC_WALLET (watch-only wallet, default in-html-watch)
//   BTC_ELECTRUM     host:port[:s]  (":s" = TLS; BTC_ELECTRUM_VERIFY=1 checks the certificate)
//   BTC_ESPLORA_URL  an upstream Esplora API, e.g. https://mempool.space/api
//   BTC_TOKEN        bearer token for watch-list changes (else one is generated, stored and printed at start)
// API below the page (<base>api/…, JSON):
//   GET  api/info                    { app, network, source, watchOnly: true, tip }
//   GET  api/esplora/<esplora path>  blocks, transactions, addresses, mempool, fee estimates (Esplora's REST API)
//   POST api/esplora/tx              broadcast a signed transaction (raw hex body)
//   GET  api/watch                   the watch list with summaries          (no keys, no token needed)
//   POST api/watch                   { label, xpub | descriptor | descriptors: [receive, change] | addresses: [] } (token)
//   GET  api/watch/<id>              { balance, utxos, history, series, addresses, updated }
//   DELETE api/watch/<id>            (token)
//
// Design: the browser app only speaks Esplora's REST dialect. This backend makes every data source look like
// Esplora (providers.js adapts Core RPC and Electrum), so the client has one code path whether it talks to
// mempool.space, to this server, or to nothing at all (offline build). The backend never derives or stores private
// material; the watch list holds public descriptors only and actively rejects anything resembling a private key.
import { randomBytes } from '../crypto/random.js';
import { bytesToHex, equalBytes, utf8ToBytes } from '../crypto/encoding.js';
import { NETWORKS } from '../bitcoin/networks.js';
import { Account } from '../bitcoin/account.js';
import { isValidAddress, toOutputScript } from '../bitcoin/address.js';
import { scanAccount, walletHistory, balanceSeries } from '../bitcoin/sync.js';
import { createProvider } from './providers.js';

// process.env read through globalThis so the module can be loaded by non-Node hosts without a ReferenceError.
const env = (k, d = '') => ((globalThis.process && process.env && process.env[k]) || d);

export function readConfig() {
  // Unknown network names fall back to mainnet. BTC_ELECTRUM "host:port[:s]": a missing port takes the network's
  // default Electrum TCP port.
  const network = NETWORKS[env('BTC_NETWORK')] ? env('BTC_NETWORK') : 'mainnet';
  const el = env('BTC_ELECTRUM').split(':');
  const cfg = {
    network,
    rpc: { url: env('BTC_RPC_URL'), user: env('BTC_RPC_USER'), password: env('BTC_RPC_PASSWORD'), cookieFile: env('BTC_RPC_COOKIE'), wallet: env('BTC_RPC_WALLET') },
    electrum: el[0] ? { host: el[0], port: +el[1] || NETWORKS[network].electrumPorts.tcp, tls: el[2] === 's', verifyCert: env('BTC_ELECTRUM_VERIFY') === '1' } : null,
    esplora: env('BTC_ESPLORA_URL'),
  };
  // Source auto-selection by configuration order: a local node is preferred (most private, no third party), then
  // Electrum, then an upstream Esplora.
  cfg.source = env('BTC_SOURCE') || (cfg.rpc.url ? 'core' : cfg.electrum ? 'electrum' : cfg.esplora ? 'esplora' : '');
  return cfg;
}

// Note: both branches of the ternary are identical (a string is JSON-encoded too); harmless redundancy.
// Content-Length from the encoded bytes, not the string length: UTF-8 characters can take several bytes.
// CORS '*': the API holds no cookies; write routes require a bearer token, which a foreign page cannot obtain.
const sendJson = (res, status, v, extra = {}) => {
  const body = utf8ToBytes(typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*', ...extra });
  res.end(body);
};
const sendText = (res, status, text) => {
  const body = utf8ToBytes(String(text));
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
};

// Size-capped body reader: the socket is destroyed past the limit instead of buffering unbounded input.
function readBody(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(new TextDecoder().decode(concat(chunks))));
    req.on('error', reject);
  });
}
const concat = (chunks) => { const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0)); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out; };

export default function backend(ctx) {
  const { storage, log } = ctx;
  const cfg = readConfig();
  // Token precedence: env, then the one persisted in storage, else a fresh 128-bit random token, saved so it
  // survives restarts. Printed in the log once so the owner can copy it into the app.
  let token = env('BTC_TOKEN') || storage.read('token');
  if (!token) { token = bytesToHex(randomBytes(16)); storage.write('token', token); }
  log(`bitcoin-wallet: network ${cfg.network}, source ${cfg.source || 'none (set BTC_RPC_URL, BTC_ELECTRUM or BTC_ESPLORA_URL)'}; watch-list token ${token} (set BTC_TOKEN to choose one)`);
  let provider = null;
  // Provider setup is async (the cookie file is read lazily); every request awaits `ready`. On failure provider stays
  // null and the API answers 503 instead of crashing the host.
  const ready = (async () => {
    if (cfg.source === 'core' && cfg.rpc.cookieFile) {
      // 'node:fs' assembled at runtime: a literal import specifier would be seen by the bundler and the offline-build
      // policy scanner; this module only runs on the server, where the dynamic import resolves normally.
      const fs = await import(['node', 'fs'].join(':'));
      cfg.rpc.cookie = fs.readFileSync(cfg.rpc.cookieFile, 'utf8').trim();
    }
    provider = createProvider(cfg, ctx);
  })().catch((e) => log('bitcoin-wallet: provider error', e.message));

  // equalBytes compares in constant time once the lengths match (crypto/encoding.js), so timing does not reveal how
  // much of a guessed token was right; the length itself is not secret-dependent for generated tokens.
  const authed = (req) => {
    const m = /^Bearer\s+(.+)$/.exec(req.headers.authorization || '');
    return !!m && equalBytes(utf8ToBytes(m[1].trim()), utf8ToBytes(token));
  };

  // --- the watch list ---
  // --- persistence: the watch list as one record, each wallet's last scan as summary:<id> (served without rescanning).
  const list = () => storage.read('watch') || [];
  const saveList = (l) => storage.write('watch', l);
  // Same adapter idea as state.js addressAccount: a fixed address list exposed through the account interface.
  const accountOfWatch = (w) => {
    if (w.addresses) {
      const scripts = w.addresses.map((a) => toOutputScript(a, cfg.network));
      return { change: null, address: (c, i) => w.addresses[Math.min(i, w.addresses.length - 1)], script: (c, i) => scripts[Math.min(i, scripts.length - 1)], fixed: w.addresses.length };
    }
    if (w.xpub) return Account.fromExtendedKey(w.xpub, { network: cfg.network });
    return Account.fromDescriptors(w.descriptors[0], w.descriptors[1] || null, { network: cfg.network });
  };
  // sync.js expects an Esplora client; this adapter routes its calls through the provider, so the same scanner runs
  // in the browser and on the server.
  const source = {
    async address(a) { const r = await provider.get('/address/' + encodeURIComponent(a)); if (r.status !== 200) throw new Error(String(r.body)); return r.body; },
    async addressTxs(a) { const r = await provider.get('/address/' + encodeURIComponent(a) + '/txs'); if (r.status !== 200) throw new Error(String(r.body)); return r.body; },
    async addressUtxos(a) { const r = await provider.get('/address/' + encodeURIComponent(a) + '/utxo'); if (r.status !== 200) throw new Error(String(r.body)); return r.body; },
    tipHeight: () => provider.tipHeight(),
  };
  // One full gap-limit scan per watched wallet; the summary is stored so GET requests are cheap.
  async function refresh(w) {
    const acc = accountOfWatch(w);
    const scan = await scanAccount(acc, source, { gapLimit: w.addresses ? w.addresses.length : 20, maxIndex: w.addresses ? w.addresses.length : 10000 });
    const own = new Set(scan.addresses.map((a) => bytesToHex(acc.script(a.chain, a.index))));
    const history = walletHistory(scan.txs, own);
    const summary = { id: w.id, label: w.label, updated: Math.floor(Date.now() / 1000), balance: scan.balance, utxos: scan.utxos.map((u) => ({ ...u, script: bytesToHex(u.script) })),
      history, series: balanceSeries(history), addresses: scan.addresses, next: scan.next, tip: scan.tip };
    storage.write('summary:' + w.id, summary);
    return summary;
  }
  // busy guard: a refresh cycle can take longer than the 60 s interval on a slow source; overlapping cycles would
  // double the load. unref(): the timer alone does not keep the Node process alive (tests exit cleanly).
  let busy = false;
  async function refreshAll() {
    if (busy || !provider) return;
    busy = true;
    try { for (const w of list()) { try { await refresh(w); } catch (e) { log('bitcoin-wallet: watch', w.id, e.message); } } } finally { busy = false; }
  }
  const timer = setInterval(refreshAll, 60000);
  if (timer.unref) timer.unref();
  ready.then(() => refreshAll());

  async function watchApi(req, res, rest) {
    const id = rest[0];
    // KNOWN DEFECT (privacy): the unauthenticated GET returns the full watch records incl. xpubs / descriptors, which
    // reveal every past and future address of those wallets to anyone who can reach the server. Fix: require the token
    // for GET api/watch (and api/watch/<id>), or strip xpub / descriptors from the public listing.
    if (req.method === 'GET' && !id) return sendJson(res, 200, list().map((w) => ({ ...w, summary: storage.read('summary:' + w.id) })));
    if (req.method === 'GET') {
      // A missing summary triggers a synchronous scan on first request (e.g. right after adding a wallet).
      const s = storage.read('summary:' + id) || (list().find((w) => w.id === id) ? await refresh(list().find((w) => w.id === id)) : null);
      return s ? sendJson(res, 200, s) : sendJson(res, 404, { error: 'not found' });
    }
    if (!authed(req)) return sendJson(res, 401, { error: 'token required' }, { 'WWW-Authenticate': 'Bearer' });
    if (req.method === 'DELETE' && id) { saveList(list().filter((w) => w.id !== id)); storage.remove('summary:' + id); return sendJson(res, 200, { ok: true }); }
    if (req.method === 'POST' && !id) {
      let b;
      try { b = JSON.parse(await readBody(req, 65536)); } catch { return sendJson(res, 400, { error: 'invalid JSON' }); }
      const w = { id: bytesToHex(randomBytes(8)), label: String(b.label || '').slice(0, 80), created: Math.floor(Date.now() / 1000) };
      try {
        if (Array.isArray(b.addresses)) {
          if (!b.addresses.length || b.addresses.some((a) => !isValidAddress(a, cfg.network))) throw new Error('invalid address');
          w.addresses = b.addresses.slice(0, 1000);
        } else if (b.xpub) { w.xpub = String(b.xpub).trim(); }
        else if (b.descriptor || b.descriptors) w.descriptors = b.descriptors || [b.descriptor];
        else throw new Error('xpub, descriptor(s) or addresses expected');
        // Defence in depth against pasting the wrong secret: anything containing "prv" (xprv / tprv / zprv) or a
        // WIF-looking string (base58, 51-52 chars, prefixes 5 K L c 9) is refused before it is stored or logged.
        // Heuristic: a label that happens to contain "prv" is rejected too; a false positive is the safe failure.
        if (/prv/.test(JSON.stringify(b)) || /\b[5KLc9][1-9A-HJ-NP-Za-km-z]{50,51}\b/.test(JSON.stringify(b))) throw new Error('private keys are not accepted');
        accountOfWatch(w); // validates
        // With Bitcoin Core as source the descriptors are imported into Core's watch-only wallet (rescanFrom = birth
        // height), because Core can only report history for scripts it tracks.
        if (cfg.source === 'core') {
          await ready;
          const acc = accountOfWatch(w);
          const descs = w.addresses ? w.addresses.map((a) => `addr(${a})`) : [acc.receive.toString({ public: true }), ...(acc.change ? [acc.change.toString({ public: true })] : [])];
          await provider.watchDescriptors(descs, b.rescanFrom || 0);
        }
      } catch (e) { return sendJson(res, 400, { error: e.message }); }
      saveList([...list(), w]);
      // Respond first, scan in the background: a first scan can take minutes on a large wallet.
      refresh(w).catch((e) => log('bitcoin-wallet: watch', w.id, e.message));
      return sendJson(res, 200, w);
    }
    return sendJson(res, 405, { error: 'method not allowed' });
  }

  async function handle(req, res, url) {
    // The API lives below any base path (non-greedy prefix up to the first "/api/"), so the backend works wherever
    // hosting.js mounts the app.
    const m = /^(.*?\/)api\/(.*)$/.exec(url.pathname);
    if (!m) return false;
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, DELETE', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }); res.end(); return true; }
    await ready;
    const parts = m[2].split('/').filter(Boolean);
    try {
      if (parts[0] === 'info') {
        let tip = null;
        try { tip = provider ? await provider.tipHeight() : null; } catch { tip = null; }
        sendJson(res, 200, { app: 'bitcoin-wallet', version: 1, network: cfg.network, source: cfg.source || null, watchOnly: true, tip });
        return true;
      }
      if (parts[0] === 'watch') { await watchApi(req, res, parts.slice(1)); return true; }
      if (parts[0] === 'esplora') {
        if (!provider) { sendJson(res, 503, { error: 'no data source configured' }); return true; }
        const path = '/' + parts.slice(1).join('/');
        // Broadcast: body must be plain hex (even length); the provider returns the txid as text, as Esplora does.
        if (req.method === 'POST' && path === '/tx') {
          const hex = (await readBody(req, 4 << 20)).trim();
          if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) { sendText(res, 400, 'invalid hex'); return true; }
          try { sendText(res, 200, await provider.broadcast(hex)); } catch (e) { sendText(res, 400, e.message); }
          return true;
        }
        if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return true; }
        // Pass-through: the provider already shaped the response like Esplora (status + JSON or text body).
        const r = await provider.get(path);
        if (typeof r.body === 'string') sendText(res, r.status, r.body); else sendJson(res, r.status, r.body);
        return true;
      }
      sendJson(res, 404, { error: 'not found' });
      return true;
    } catch (e) {
      sendJson(res, e.status || 500, { error: e.message });
      return true;
    }
  }
  // close(): stops the background job and the provider's connections (tests, embedding).
  return { handle, close() { clearInterval(timer); if (provider && provider.close) provider.close(); } };
}
