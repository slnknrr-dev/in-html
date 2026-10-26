// bitcoin/electrum.js - a client of the Electrum protocol (Electrum servers: electrs, Fulcrum, ElectrumX) over TCP or
// TLS: newline-delimited JSON-RPC 2.0, requests matched by id, subscriptions as notifications. For Node backends: the
// socket modules are passed in (hosting.js gives bundled backends ctx.node.net; TLS needs node:tls, see backend.js).
//
//   createElectrumClient({ host, port, tls = false, net, tlsModule, rejectUnauthorized = false, timeout = 20000,
//     client = 'in-html', protocol = '1.4' }) -> client
//   client.request(method, params), client.close(), client.onNotification(fn)
//   serverVersion(), banner(), ping(), headersSubscribe() -> { height, hex }, blockHeader(height), blockHeaders(start, n),
//   estimateFee(blocks) -> BTC/kvB, relayFee(), feeHistogram(),
//   scripthashBalance(sh), scripthashHistory(sh) -> [{ tx_hash, height, fee? }], scripthashUnspent(sh) -> [{ tx_hash,
//   tx_pos, value, height }], scripthashMempool(sh), scripthashSubscribe(sh),
//   transactionGet(txid, verbose = false), transactionBroadcast(hex), transactionMerkle(txid, height)
//   electrumScriptHash(script) -> hex of the reversed SHA-256 of the output script
//
// Security / privacy of this backend:
// - The server learns every script hash the wallet asks about, i.e. the full set of its addresses, linked together
//   and to the client's IP. Use your own server (electrs / Fulcrum on your node) or Tor; a public server is a
//   surveillance point by design of the protocol.
// - rejectUnauthorized defaults to false because most Electrum servers use self-signed certificates. TLS then only
//   protects against passive eavesdroppers, not against an active MITM, who can lie about balances and history
//   (never about signatures: a lying server cannot steal funds, but can hide coins or fake incoming payments).
//   Pin the certificate (pass a tlsModule with checkServerIdentity / ca) for a server you control.
// - Responses are not verified (no merkle proof checks against headers): trust in the server is total for data.
// - KNOWN DEFECT: incoming data is buffered until a newline with no size limit; a malicious server can send an endless
//   line and grow memory without bound. Fix: drop the connection when buffer exceeds a cap (e.g. 16 MB).
import { sha256 } from '../crypto/sha2.js';
import { bytesToHex } from '../crypto/encoding.js';

// Electrum's script hash is SHA-256 of the scriptPubKey with the bytes *reversed* (it reused the txid display
// convention); Esplora's /scripthash endpoint uses the unreversed hash (esplora.js scriptHashOf). Mixing them up
// returns an empty history, not an error.
export const electrumScriptHash = (script) => bytesToHex(sha256(script).reverse());

export function createElectrumClient({ host, port, tls = false, net, tlsModule = null, rejectUnauthorized = false, timeout = 20000, client = 'in-html', protocol = '1.4' } = {}) {
  if (!host || !port) throw new Error('Electrum host and port are needed');
  let socket = null, ready = null, buffer = '', id = 0, versionDone = null;
  const pending = new Map();
  const listeners = new Set();

  // Connection state is reset on any failure so the next request reconnects (lazy, idempotent connect()).
  function fail(err) {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(err); }
    pending.clear();
    socket = null; ready = null; versionDone = null;
  }

  function connect() {
    if (ready) return ready;
    ready = new Promise((resolve, reject) => {
      const onConnect = () => resolve();
      // SNI only for host names: RFC 6066 forbids IP literals in server_name (the regex catches IPv4 and IPv6).
      const opts = { host, port: Number(port) };
      let s;
      try {
        if (tls) {
          if (!tlsModule) throw new Error('TLS needs node:tls (tlsModule)');
          s = tlsModule.connect({ ...opts, servername: /^[\d.]+$|:/.test(host) ? undefined : host, rejectUnauthorized }, onConnect);
        } else {
          if (!net) throw new Error('a net module is needed');
          s = net.connect(opts, onConnect);
        }
      } catch (e) { ready = null; reject(e); return; }
      socket = s;
      s.setEncoding('utf8');
      if (s.setKeepAlive) s.setKeepAlive(true, 30000);
      // Line framing: TCP delivers arbitrary chunks, so data accumulates until '\n'. Batch replies arrive as arrays.
      // Unparseable lines are skipped rather than killing the session; replies to unknown ids (e.g. after a timeout)
      // are dropped; messages with a method are subscription notifications.
      s.on('data', (chunk) => {
        buffer += chunk;
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          let msg;
          try { msg = JSON.parse(line); } catch { continue; }
          for (const m of Array.isArray(msg) ? msg : [msg]) {
            if (m.id !== undefined && pending.has(m.id)) {
              const p = pending.get(m.id);
              pending.delete(m.id);
              clearTimeout(p.timer);
              if (m.error) p.reject(Object.assign(new Error(m.error.message || JSON.stringify(m.error)), { code: m.error.code }));
              else p.resolve(m.result);
            } else if (m.method) for (const fn of listeners) { try { fn(m.method, m.params); } catch { /* listener errors */ } }
          }
        }
      });
      s.on('error', (e) => { reject(e); fail(e); });
      s.on('close', () => fail(new Error('Electrum connection closed')));
    });
    return ready;
  }

  async function raw(method, params = []) {
    await connect();
    return new Promise((resolve, reject) => {
      const i = ++id;
      const timer = setTimeout(() => { pending.delete(i); reject(new Error(`Electrum ${method} timed out`)); }, timeout);
      if (timer.unref) timer.unref();
      pending.set(i, { resolve, reject, timer });
      socket.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n');
    });
  }

  // server.version must be the first message of a session.
  // The negotiation promise is shared so concurrent first requests do not each send server.version; on failure it is
  // cleared so a later call retries instead of reusing a rejected promise forever.
  async function request(method, params = []) {
    if (!versionDone) versionDone = raw('server.version', [client, protocol]).catch((e) => { versionDone = null; throw e; });
    const v = await versionDone;
    if (method === 'server.version') return v;
    return raw(method, params);
  }

  return {
    request,
    close() { if (socket) socket.destroy(); fail(new Error('closed')); },
    onNotification(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    serverVersion: () => request('server.version'),
    banner: () => request('server.banner'),
    ping: () => request('server.ping'),
    headersSubscribe: () => request('blockchain.headers.subscribe'),
    blockHeader: (height) => request('blockchain.block.header', [height]),
    blockHeaders: (start, count) => request('blockchain.block.headers', [start, count]),
    estimateFee: (blocks) => request('blockchain.estimatefee', [blocks]),
    relayFee: () => request('blockchain.relayfee'),
    feeHistogram: () => request('mempool.get_fee_histogram'),
    scripthashBalance: (sh) => request('blockchain.scripthash.get_balance', [sh]),
    scripthashHistory: (sh) => request('blockchain.scripthash.get_history', [sh]),
    scripthashUnspent: (sh) => request('blockchain.scripthash.listunspent', [sh]),
    scripthashMempool: (sh) => request('blockchain.scripthash.get_mempool', [sh]),
    scripthashSubscribe: (sh) => request('blockchain.scripthash.subscribe', [sh]),
    transactionGet: (txid, verbose = false) => request('blockchain.transaction.get', [txid, verbose]),
    transactionBroadcast: (hex) => request('blockchain.transaction.broadcast', [hex]),
    transactionMerkle: (txid, height) => request('blockchain.transaction.get_merkle', [txid, height]),
  };
}
