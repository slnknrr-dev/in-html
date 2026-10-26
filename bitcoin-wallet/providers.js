// bitcoin-wallet/providers.js - the data sources of the backend (Node only): one Esplora-compatible interface served
// at api/esplora/… on top of an upstream Esplora server (proxy with a cache), the owner's Bitcoin Core node (JSON-RPC;
// a watch-only descriptor wallet answers address queries of watched wallets) or an Electrum server (TCP / TLS).
//
//   createProvider(cfg, ctx) -> { name, get(path) -> { status, body (object | string) }, broadcast(hex), watchDescriptors(list),
//     tipHeight() }     cfg: see backend.js (source, network, esplora, rpc, electrum)
//   toEsploraTx(tx, { prevouts, status, network }) -> Esplora JSON of a parsed transaction
//
// Adapter pattern: each provider maps Esplora REST paths onto its own protocol and returns { status, body } exactly
// as Esplora would (JSON object or plain text). Paths a source cannot answer return 404 or an empty list with a hint,
// never invented data: Core only knows watched addresses, Electrum cannot look up a block by hash.
// Fidelity differs by source and is documented per route below; the browser treats missing fields as unknown.
import { bytesToHex, hexToBytes } from '../crypto/encoding.js';
import { Transaction } from '../bitcoin/tx.js';
import { fromOutputScript, toOutputScript } from '../bitcoin/address.js';
import { toAsm, classify } from '../bitcoin/script.js';
import { parseHeader } from '../bitcoin/block.js';
import { createEsploraClient } from '../bitcoin/esplora.js';
import { createCoreRpc, btcKvbToSatVb } from '../bitcoin/rpc.js';
import { createElectrumClient, electrumScriptHash } from '../bitcoin/electrum.js';
import { btcToSats } from '../bitcoin/units.js';

// Confirmation targets (blocks) of Esplora's /fee-estimates, reproduced so charts work identically on every source.
const TARGETS = [1, 2, 3, 4, 5, 6, 10, 12, 24, 48, 144, 504, 1008];
// Script type names in Esplora's spelling (v0_p2wpkh, v1_p2tr, ...), which the client's views expect.
const TYPE = { p2pkh: 'p2pkh', p2sh: 'p2sh', p2wpkh: 'v0_p2wpkh', p2wsh: 'v0_p2wsh', p2tr: 'v1_p2tr', nulldata: 'op_return', p2pk: 'p2pk', multisig: 'multisig' };

// Fee is 0 (Esplora's convention for "unknown" here) when any prevout is missing; coinbase fee is always 0.
export function toEsploraTx(tx, { prevouts = null, status = { confirmed: false }, network = 'mainnet' } = {}) {
  const outValue = tx.outputs.reduce((s, o) => s + o.value, 0);
  const inValue = prevouts && prevouts.every(Boolean) ? prevouts.reduce((s, p) => s + p.value, 0) : null;
  const vout = (o) => ({ scriptpubkey: bytesToHex(o.script), scriptpubkey_asm: toAsm(o.script), scriptpubkey_type: TYPE[classify(o.script).type] || 'unknown', scriptpubkey_address: fromOutputScript(o.script, network) || undefined, value: o.value });
  return {
    txid: tx.txid(), version: tx.version, locktime: tx.locktime, size: tx.size(), weight: tx.weight(),
    fee: inValue !== null && !tx.isCoinbase() ? inValue - outValue : 0,
    vin: tx.inputs.map((i, k) => ({
      txid: i.txid, vout: i.vout, is_coinbase: tx.isCoinbase(), sequence: i.sequence, scriptsig: bytesToHex(i.scriptSig), scriptsig_asm: toAsm(i.scriptSig),
      witness: i.witness.map(bytesToHex), prevout: prevouts && prevouts[k] ? vout(prevouts[k]) : null,
    })),
    vout: tx.outputs.map(vout), status,
  };
}

// A small LRU map.
// Map preserves insertion order: get() re-inserts to mark recent use, set() evicts the first (oldest) key. O(1)
// both ways without a linked list. undefined is the miss marker, so undefined values cannot be cached (none are).
class Lru {
  constructor(max = 2000) { this.max = max; this.m = new Map(); }
  get(k) { const v = this.m.get(k); if (v === undefined) return undefined; this.m.delete(k); this.m.set(k, v); return v; }
  set(k, v) { this.m.set(k, v); if (this.m.size > this.max) this.m.delete(this.m.keys().next().value); return v; }
}

const ok = (body) => ({ status: 200, body });
const notFound = (msg = 'not found') => ({ status: 404, body: msg });

// --- upstream Esplora ---

function esploraProvider(cfg) {
  // Proxy cache: immutable resources (a confirmed tx, a block by hash) are cached forever, everything else for 15 s,
  // enough to absorb the burst of identical requests a wallet scan or several open browsers produce.
  const client = createEsploraClient({ url: cfg.esplora, timeout: 30000 });
  const cache = new Lru(4000);
  const immutable = (p) => /^\/(tx\/[0-9a-f]{64}(\/hex|\/raw)?|block\/[0-9a-f]{64}(\/header|\/txids|\/txs(\/\d+)?)?)$/.test(p);
  return {
    name: 'esplora',
    async get(path) {
      const hit = cache.get(path);
      if (hit && (hit.forever || Date.now() - hit.at < 15000)) return ok(hit.body);
      try {
        // Esplora answers these endpoints with plain text (heights, hashes, hex); everything else is JSON.
        const asText = /\/(height|hash|hex|header)$|^\/block-height\//.test(path);
        const body = await client.request(path, { as: asText ? 'text' : 'json' });
        // /tx/<id> itself is only immutable once confirmed: its status field changes on confirmation; hex and blocks are
        // immutable by hash from the start.
        const forever = immutable(path) && !(path.startsWith('/tx/') && path.split('/').length === 3 && !(body.status && body.status.confirmed));
        cache.set(path, { body, at: Date.now(), forever });
        return ok(body);
      } catch (e) { return { status: e.status || 502, body: e.message }; }
    },
    broadcast: (hex) => client.broadcast(hex),
    tipHeight: () => client.tipHeight(),
    async watchDescriptors() {},
  };
}

// --- Bitcoin Core ---

function coreProvider(cfg) {
  const rpc = createCoreRpc({ url: cfg.rpc.url, user: cfg.rpc.user, password: cfg.rpc.password, cookie: cfg.rpc.cookie });
  const walletName = cfg.rpc.wallet || 'in-html-watch';
  let wallet = null;
  const cache = new Lru(4000);
  const net = cfg.network;
  // Lazily opens (or creates) the watch-only descriptor wallet: try it, then loadwallet, then createwallet. Only after
  // all three fail does the error propagate.
  async function ensureWallet() {
    if (wallet) return wallet;
    const w = rpc.wallet(walletName);
    try { await w.getWalletInfo(); } catch {
      try { await rpc.loadWallet(walletName); } catch { await rpc.createWallet(walletName, { watchOnly: true }); }
    }
    wallet = w;
    return w;
  }
  // Core's getblock fields renamed to Esplora's; bits as a number (Core returns hex).
  const blockJson = (b) => ({ id: b.hash, height: b.height, version: b.version, timestamp: b.time, mediantime: b.mediantime, tx_count: b.nTx, size: b.size, weight: b.weight,
    merkle_root: b.merkleroot, previousblockhash: b.previousblockhash, nonce: b.nonce, bits: parseInt(b.bits, 16), difficulty: b.difficulty });
  const txFromVerbose = (v, status) => {
    const tx = Transaction.fromHex(v.hex);
    // Verbosity 2/3 includes prevouts (value in BTC as a float); btcToSats converts with rounding, not truncation.
    const prevouts = v.vin.map((i) => (i.prevout ? { value: btcToSats(i.prevout.value), script: hexToBytes(i.prevout.scriptPubKey.hex) } : null));
    return toEsploraTx(tx, { prevouts, status, network: net });
  };
  const statusOf = (v) => (v.blockhash ? { confirmed: true, block_hash: v.blockhash, block_time: v.blocktime, block_height: v.blockheight } : { confirmed: false });
  // Only confirmed transactions are cached: an unconfirmed one may confirm, be replaced (RBF) or vanish.
  async function txVerbose(txid) {
    const c = cache.get('tx:' + txid);
    if (c) return c;
    const v = await rpc.getRawTransaction(txid, 2);
    // Older Core versions omit blockheight in getrawtransaction; one header lookup fills it.
    if (!v.blockheight && v.blockhash) { try { v.blockheight = (await rpc.getBlockHeader(v.blockhash)).height; } catch { /* ignore */ } }
    if (v.blockhash) cache.set('tx:' + txid, v);
    return v;
  }
  // Address data from the watch-only wallet (watched descriptors only).
  // Approximations: spent_txo_count is 0 and spent sums are derived as funded - current balance; listtransactions is
  // capped at the 10000 most recent wallet entries, so a very old, very busy wallet loses its oldest history here.
  // Core has no address index; using the wallet keeps this working on a pruned node without txindex.
  async function addressInfo(address) {
    const w = await ensureWallet();
    const info = await w.call('getaddressinfo', address);
    if (!info.ismine && !info.iswatchonly) return null;
    const utxos = await w.listUnspent(0, 9999999, [address]);
    const txs = (await w.call('listtransactions', '*', 10000, 0, true)).filter((x) => x.address === address);
    const funded = txs.filter((x) => x.category === 'receive');
    const conf = (x) => x.confirmations > 0;
    const sum = (a) => a.reduce((s, x) => s + btcToSats(Math.abs(x.amount)), 0);
    const bal = sum(utxos), balConf = sum(utxos.filter((u) => u.confirmations > 0));
    return {
      address, txids: [...new Set(txs.map((x) => x.txid))], utxos,
      chain_stats: { funded_txo_count: funded.filter(conf).length, funded_txo_sum: sum(funded.filter(conf)), spent_txo_count: 0, spent_txo_sum: sum(funded.filter(conf)) - balConf, tx_count: new Set(txs.filter(conf).map((x) => x.txid)).size },
      mempool_stats: { funded_txo_count: funded.filter((x) => !conf(x)).length, funded_txo_sum: sum(funded.filter((x) => !conf(x))), spent_txo_count: 0, spent_txo_sum: sum(funded.filter((x) => !conf(x))) - (bal - balConf), tx_count: new Set(txs.filter((x) => !conf(x)).map((x) => x.txid)).size },
    };
  }
  // getrawtransaction needs txindex for arbitrary txids; for wallet transactions gettransaction works without it.
  async function walletTx(txid) {
    const w = await ensureWallet();
    try { return await txVerbose(txid); } catch {
      const g = await w.call('gettransaction', txid, true, true);
      const v = g.decoded;
      v.hex = g.hex;
      if (g.blockhash) { v.blockhash = g.blockhash; v.blocktime = g.blocktime; v.blockheight = g.blockheight; }
      return v;
    }
  }
  return {
    name: 'core',
    async get(path) {
      let m;
      try {
        if (path === '/blocks/tip/height') return ok(String(await rpc.getBlockCount()));
        if (path === '/blocks/tip/hash') return ok(await rpc.getBestBlockHash());
        if ((m = /^\/block-height\/(\d+)$/.exec(path))) return ok(await rpc.getBlockHash(+m[1]));
        // Esplora returns 10 blocks downward from a height; one RPC pair per block (getblockhash + getblock).
        if ((m = /^\/blocks(?:\/(\d+))?$/.exec(path))) {
          let h = m[1] !== undefined ? +m[1] : await rpc.getBlockCount();
          const out = [];
          for (let i = 0; i < 10 && h >= 0; i++, h--) out.push(blockJson(await rpc.getBlock(await rpc.getBlockHash(h), 1)));
          return ok(out);
        }
        if ((m = /^\/block\/([0-9a-f]{64})$/.exec(path))) return ok(blockJson(await rpc.getBlock(m[1], 1)));
        if ((m = /^\/block\/([0-9a-f]{64})\/header$/.exec(path))) return ok(await rpc.getBlockHeader(m[1], false));
        if ((m = /^\/block\/([0-9a-f]{64})\/txids$/.exec(path))) return ok((await rpc.getBlock(m[1], 1)).tx);
        if ((m = /^\/block\/([0-9a-f]{64})\/txs(?:\/(\d+))?$/.exec(path))) {
          const b = await rpc.getBlock(m[1], 3);
          const st = { confirmed: true, block_hash: b.hash, block_height: b.height, block_time: b.time };
          return ok(b.tx.slice(+(m[2] || 0), +(m[2] || 0) + 25).map((v) => txFromVerbose(v, st)));
        }
        if ((m = /^\/tx\/([0-9a-f]{64})$/.exec(path))) { const v = await walletTx(m[1]); return ok(txFromVerbose(v, statusOf(v))); }
        if ((m = /^\/tx\/([0-9a-f]{64})\/hex$/.exec(path))) return ok((await walletTx(m[1])).hex);
        if ((m = /^\/tx\/([0-9a-f]{64})\/status$/.exec(path))) return ok(statusOf(await walletTx(m[1])));
        if ((m = /^\/tx\/([0-9a-f]{64})\/outspends$/.exec(path))) {
          const v = await walletTx(m[1]);
          const out = [];
          // gettxout returns null for spent outputs: spent = no unspent entry. The spending txid is unknown to Core here.
          for (let i = 0; i < v.vout.length; i++) out.push({ spent: !(await rpc.getTxOut(m[1], i)) });
          return ok(out);
        }
        if (path === '/fee-estimates') {
          const out = {};
          for (const n of TARGETS) { const r = await rpc.estimateSmartFee(n); if (r) out[n] = btcKvbToSatVb(r.feerate); }
          return ok(out);
        }
        if (path === '/mempool') {
          const i = await rpc.getMempoolInfo();
          let hist = [];
          // The fee histogram needs the whole mempool (getrawmempool verbose); skipped above 20000 entries to bound memory
          // and latency on a busy mainnet node. Buckets: fee rate rounded to 0.1 sat/vB, weighted by vsize, high to low.
          if (i.size < 20000) {
            const all = await rpc.getRawMempool(true);
            const buckets = new Map();
            for (const e of Object.values(all)) { const r = Math.round((btcToSats(e.fees.base) / e.vsize) * 10) / 10; buckets.set(r, (buckets.get(r) || 0) + e.vsize); }
            hist = [...buckets].sort((a, b) => b[0] - a[0]);
          }
          return ok({ count: i.size, vsize: i.bytes, total_fee: btcToSats(i.total_fee || 0), fee_histogram: hist });
        }
        if (path === '/mempool/recent') return ok([]);
        if ((m = /^\/address\/([^/]+)(\/utxo|\/txs(?:\/chain(?:\/[0-9a-f]{64})?)?)?$/.exec(path))) {
          const a = decodeURIComponent(m[1]);
          const info = await addressInfo(a);
          if (!info) return notFound('address not watched by this server (add its wallet to the watch list)');
          if (!m[2]) return ok({ address: a, chain_stats: info.chain_stats, mempool_stats: info.mempool_stats });
          if (m[2] === '/utxo') return ok(info.utxos.map((u) => ({ txid: u.txid, vout: u.vout, value: btcToSats(u.amount), status: u.confirmations > 0 ? { confirmed: true, block_height: null } : { confirmed: false } })));
          if (m[2].includes('/chain/')) return ok([]);
          const out = [];
          for (const id of info.txids.slice(0, 50)) { const v = await walletTx(id); out.push(txFromVerbose(v, statusOf(v))); }
          return ok(out);
        }
        return notFound();
      // RPC error -5 = "No such mempool or blockchain transaction / invalid address": Esplora's 404.
      } catch (e) { return { status: e.code === -5 ? 404 : 502, body: e.message }; }
    },
    broadcast: (hex) => rpc.sendRawTransaction(hex),
    tipHeight: () => rpc.getBlockCount(),
    // Imports watched descriptors into the watch-only wallet (rescan from `since`, unix seconds; 0 = genesis).
    // getdescriptorinfo adds the checksum Core requires; ranged descriptors are imported for indexes 0..999.
    // active:false: these are watched scripts, not the wallet's own address source.
    async watchDescriptors(list, since = 0) {
      const w = await ensureWallet();
      const reqs = [];
      for (const d of list) {
        const info = await rpc.getDescriptorInfo(d);
        reqs.push({ desc: info.descriptor, timestamp: since || 0, active: false, ...(info.isrange ? { range: [0, 999] } : {}) });
      }
      if (reqs.length) await w.importDescriptors(reqs);
    },
  };
}

// --- Electrum ---

function electrumProvider(cfg, ctx) {
  let client = null;
  const cache = new Lru(4000);
  const net = cfg.network;
  // One persistent connection, opened on demand. TLS module from the host context when provided (tests), else
  // node:tls (specifier assembled at runtime, see backend.js). rejectUnauthorized is opt-in because most personal
  // Electrum servers use self-signed certificates.
  async function c() {
    if (client) return client;
    let tlsModule = null;
    if (cfg.electrum.tls) tlsModule = ctx.node.tls || (await import(['node', 'tls'].join(':')));
    client = createElectrumClient({ host: cfg.electrum.host, port: cfg.electrum.port, tls: cfg.electrum.tls, net: ctx.node.net, tlsModule, rejectUnauthorized: !!cfg.electrum.verifyCert });
    return client;
  }
  async function rawTx(txid) {
    let hex = cache.get('hex:' + txid);
    if (!hex) hex = cache.set('hex:' + txid, await (await c()).transactionGet(txid));
    return Transaction.fromHex(hex);
  }
  async function esploraTx(txid, height = null) {
    const tx = await rawTx(txid);
    // Electrum returns raw transactions only; prevouts (for fees and addresses) need one more fetch per input, cached.
    const prevouts = tx.isCoinbase() ? null : await Promise.all(tx.inputs.map(async (i) => (await rawTx(i.txid)).outputs[i.vout]));
    let status = { confirmed: false };
    if (height > 0) {
      const hdr = parseHeader(await (await c()).blockHeader(height));
      status = { confirmed: true, block_height: height, block_hash: hdr.hash, block_time: hdr.time };
    }
    return toEsploraTx(tx, { prevouts, status, network: net });
  }
  return {
    name: 'electrum',
    async get(path) {
      let m;
      try {
        const cl = await c();
        if (path === '/blocks/tip/height') return ok(String((await cl.headersSubscribe()).height));
        if (path === '/blocks/tip/hash') return ok(parseHeader((await cl.headersSubscribe()).hex).hash);
        if ((m = /^\/block-height\/(\d+)$/.exec(path))) return ok(parseHeader(await cl.blockHeader(+m[1])).hash);
        if ((m = /^\/blocks(?:\/(\d+))?$/.exec(path))) {
          let h = m[1] !== undefined ? +m[1] : (await cl.headersSubscribe()).height;
          const out = [];
          for (let i = 0; i < 10 && h >= 0; i++, h--) {
            const hd = parseHeader(await cl.blockHeader(h));
            cache.set('height:' + hd.hash, h);
            out.push({ id: hd.hash, height: h, version: hd.version, timestamp: hd.time, bits: hd.bits, nonce: hd.nonce, merkle_root: hd.merkleRoot, previousblockhash: hd.prevHash, tx_count: null });
          }
          return ok(out);
        }
        if ((m = /^\/block\/([0-9a-f]{64})(\/header)?$/.exec(path))) {
          const h = cache.get('height:' + m[1]);
          if (h === undefined) return notFound('block unknown to this Electrum server (open it by height)');
          const hex = await cl.blockHeader(h);
          if (m[2]) return ok(hex);
          const hd = parseHeader(hex);
          return ok({ id: hd.hash, height: h, version: hd.version, timestamp: hd.time, bits: hd.bits, nonce: hd.nonce, merkle_root: hd.merkleRoot, previousblockhash: hd.prevHash, tx_count: 0 });
        }
        if ((m = /^\/block\/([0-9a-f]{64})\/txs/.exec(path))) return ok([]);
        if ((m = /^\/tx\/([0-9a-f]{64})\/hex$/.exec(path))) return ok((await rawTx(m[1])).toHex());
        if ((m = /^\/tx\/([0-9a-f]{64})$/.exec(path))) {
          let height = null;
          // Electrum's verbose transaction (when supported) gives confirmations; height = tip - confirmations + 1.
          try { const v = await cl.transactionGet(m[1], true); height = v && v.confirmations ? (await cl.headersSubscribe()).height - v.confirmations + 1 : null; } catch { height = null; }
          return ok(await esploraTx(m[1], height));
        }
        if (path === '/fee-estimates') {
          const out = {};
          for (const n of TARGETS) { const r = await cl.estimateFee(n); if (r > 0) out[n] = btcKvbToSatVb(r); }
          return ok(out);
        }
        if (path === '/mempool') {
          const hist = await cl.feeHistogram().catch(() => []);
          return ok({ count: null, vsize: hist.reduce((s, x) => s + x[1], 0), total_fee: null, fee_histogram: hist });
        }
        if (path === '/mempool/recent') return ok([]);
        if ((m = /^\/address\/([^/]+)(\/utxo|\/txs(?:\/chain(?:\/[0-9a-f]{64})?)?)?$/.exec(path))) {
          const a = decodeURIComponent(m[1]);
          const sh = electrumScriptHash(toOutputScript(a, net));
          if (!m[2]) {
            const [bal, hist] = await Promise.all([cl.scripthashBalance(sh), cl.scripthashHistory(sh)]);
            // Electrum reports a balance, not funded/spent sums; the mapping fills Esplora fields with the closest meaning.
            const conf = hist.filter((x) => x.height > 0).length;
            return ok({ address: a, chain_stats: { tx_count: conf, funded_txo_sum: bal.confirmed, spent_txo_sum: 0 }, mempool_stats: { tx_count: hist.length - conf, funded_txo_sum: Math.max(0, bal.unconfirmed), spent_txo_sum: Math.max(0, -bal.unconfirmed) } });
          }
          if (m[2] === '/utxo') return ok((await cl.scripthashUnspent(sh)).map((u) => ({ txid: u.tx_hash, vout: u.tx_pos, value: u.value, status: u.height > 0 ? { confirmed: true, block_height: u.height } : { confirmed: false } })));
          if (m[2].includes('/chain/')) return ok([]);
          // Newest first; mempool entries (height 0 or -1) sort as 1e9 (top) only for 0, -1 stays at the bottom.
          const hist = (await cl.scripthashHistory(sh)).sort((x, y) => (y.height || 1e9) - (x.height || 1e9)).slice(0, 50);
          return ok(await Promise.all(hist.map((x) => esploraTx(x.tx_hash, x.height))));
        }
        return notFound();
      // KNOWN DEFECT: on any error the client reference is dropped without client.close(), so the old socket stays open
      // until the server times it out; repeated errors leak connections. Fix: `if (client) client.close();` before
      // resetting. (The reset itself is intended: it forces a reconnect after a dead connection.)
      } catch (e) { client = null; return { status: 502, body: e.message }; }
    },
    broadcast: async (hex) => (await c()).transactionBroadcast(hex),
    tipHeight: async () => (await (await c()).headersSubscribe()).height,
    async watchDescriptors() {},
    close() { if (client) client.close(); client = null; },
  };
}

export function createProvider(cfg, ctx) {
  if (cfg.source === 'core') return coreProvider(cfg, ctx);
  if (cfg.source === 'electrum') return electrumProvider(cfg, ctx);
  if (cfg.source === 'esplora') return esploraProvider(cfg, ctx);
  return null;
}
