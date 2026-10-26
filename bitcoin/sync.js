// bitcoin/sync.js - wallet synchronisation over an Esplora-like source: gap-limit discovery of the used addresses of an
// account (receive and change chains), their transactions and unspent outputs, balances, the wallet's transaction
// history with net amounts and fees, and a balance-over-time series for charts. Works with esplora.js clients (the
// browser apps and the backend's upstream) and with any object that has the same methods.
//
//   scanAccount(account, source, { gapLimit = 20, concurrency = 4, maxIndex = 10000, onProgress, cache }) ->
//     { addresses: [{ chain, index, address, used, txCount, funded, spent, balance }], next: { receive, change },
//       txs: [esplora tx], utxos: [{ txid, vout, value, script, chain, index, address, confirmed, height, time }],
//       balance: { confirmed, unconfirmed, total }, tip }
//   walletHistory(txs, ownScripts: Set<hex>) -> [{ txid, time, height, confirmed, received, sent, net, fee, type,
//     vsize, feeRate, rbf }] (newest first)
//   balanceSeries(history) -> [{ time, balance }] (oldest first; unconfirmed at "now")
//   utxoFromEsplora(u, info) -> wallet coin for spend.js
//   source: { address(a), addressTxs(a, lastSeen), addressUtxos(a), tipHeight() }
//
// Gap limit (BIP-44): addresses are scanned in order per chain until `gapLimit` consecutive unused ones are seen.
// Wallets never hand out more than gapLimit unused addresses in a row, so recovery from a seed alone finds every
// coin; a too-small limit makes funds on later addresses invisible (not lost - rescanning with a larger limit finds
// them). Privacy: the scan reveals all queried addresses (used and the gap of unused ones) to the source; see
// esplora.js. The results are the server's view, unverified.
import { bytesToHex, hexToBytes } from '../crypto/encoding.js';

// Bounded-concurrency map: n workers pull the next index from a shared counter (safe: JS runs one worker at a time
// between awaits). Limits load on public servers, which rate-limit aggressively (mempool.space returns 429).
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  });
  await Promise.all(workers);
  return out;
}

// Stops on a short page, on no new txids (defends against a server that repeats a page forever) or once the known
// tx count is reached.
async function allTxs(source, address, count) {
  let txs = await source.addressTxs(address);
  const seen = new Set(txs.map((t) => t.txid));
  // Esplora pages: up to 50 mempool + 25 confirmed transactions; more confirmed ones after the last seen txid.
  let confirmed = txs.filter((t) => t.status && t.status.confirmed);
  while (confirmed.length && confirmed.length % 25 === 0 && txs.length < count) {
    const more = await source.addressTxs(address, confirmed[confirmed.length - 1].txid);
    const fresh = more.filter((t) => !seen.has(t.txid));
    if (!fresh.length) break;
    for (const t of fresh) seen.add(t.txid);
    txs = txs.concat(fresh);
    confirmed = fresh;
  }
  return txs;
}

export async function scanAccount(account, source, { gapLimit = 20, concurrency = 4, maxIndex = 10000, onProgress = null, cache = null } = {}) {
  const addresses = [], txMap = new Map(), utxos = [];
  const next = { receive: 0, change: 0 };
  const chains = account.change ? [0, 1] : [0];
  let checked = 0;
  // Batches are sized to the remaining gap (gapLimit - gap), so the scan never queries more addresses than needed to
  // prove the gap; maxIndex is a safety stop against a source that reports every address as used.
  // cache: address stats flagged `final` by the caller (e.g. old, deeply confirmed) are not re-fetched.
  for (const chain of chains) {
    let gap = 0, index = 0;
    while (gap < gapLimit && index < maxIndex) {
      const batch = [];
      for (let k = 0; k < gapLimit - gap && index < maxIndex; k++, index++) batch.push(index);
      const infos = await pool(batch, concurrency, async (i) => {
        const address = account.address(chain, i);
        const st = cache && cache[address] && cache[address].final ? cache[address] : await source.address(address);
        return { i, address, st };
      });
      for (const { i, address, st } of infos) {
        const cs = st.chain_stats || {}, ms = st.mempool_stats || {};
        const txCount = (cs.tx_count || 0) + (ms.tx_count || 0);
        const funded = (cs.funded_txo_sum || 0) + (ms.funded_txo_sum || 0), spent = (cs.spent_txo_sum || 0) + (ms.spent_txo_sum || 0);
        const rec = { chain, index: i, address, used: txCount > 0, txCount, funded, spent, balance: funded - spent, confirmed: (cs.funded_txo_sum || 0) - (cs.spent_txo_sum || 0) };
        addresses.push(rec);
        if (rec.used) { gap = 0; next[chain ? 'change' : 'receive'] = Math.max(next[chain ? 'change' : 'receive'], i + 1); } else gap++;
      }
      checked += infos.length;
      if (onProgress) onProgress({ checked, found: addresses.filter((a) => a.used).length });
    }
  }
  const used = addresses.filter((a) => a.used);
  await pool(used, concurrency, async (a) => {
    const [txs, us] = await Promise.all([allTxs(source, a.address, a.txCount), a.balance > 0 ? source.addressUtxos(a.address) : Promise.resolve([])]);
    for (const t of txs) txMap.set(t.txid, t);
    const script = account.script(a.chain, a.index);
    for (const u of us) {
      utxos.push({ txid: u.txid, vout: u.vout, value: u.value, script, chain: a.chain, index: a.index, address: a.address,
        confirmed: !!(u.status && u.status.confirmed), height: u.status && u.status.block_height, time: u.status && u.status.block_time });
    }
  });
  const confirmed = utxos.filter((u) => u.confirmed).reduce((s, u) => s + u.value, 0);
  const total = utxos.reduce((s, u) => s + u.value, 0);
  let tip = null;
  try { tip = source.tipHeight ? await source.tipHeight() : null; } catch { tip = null; }
  addresses.sort((a, b) => a.chain - b.chain || a.index - b.index);
  return { addresses, next, txs: [...txMap.values()], utxos, balance: { confirmed, unconfirmed: total - confirmed, total }, tip };
}

// Net effect per transaction from the wallet's point of view: received = own outputs, sent = own inputs' prevouts.
// 'self' = all inputs and outputs ours (consolidation / self-transfer); the fee is attributed only when we paid
// into the tx (sent > 0) - for incoming payments the fee is the sender's. rbf is the BIP-125 signal of any input,
// which tells the UI an unconfirmed incoming payment can still be replaced.
// Sort: unconfirmed first, then newest block.
export function walletHistory(txs, ownScripts) {
  const own = (spk) => ownScripts.has(spk);
  const out = [];
  for (const t of txs) {
    let received = 0, sent = 0, allOwnIn = t.vin.length > 0;
    for (const v of t.vout) if (own(v.scriptpubkey)) received += v.value;
    for (const i of t.vin) {
      if (i.prevout && own(i.prevout.scriptpubkey)) sent += i.prevout.value;
      else allOwnIn = false;
    }
    const net = received - sent;
    const allOwnOut = t.vout.every((v) => own(v.scriptpubkey));
    const type = sent === 0 ? 'receive' : allOwnIn && allOwnOut ? 'self' : 'send';
    const vsize = t.weight ? Math.ceil(t.weight / 4) : t.size;
    out.push({
      txid: t.txid, confirmed: !!(t.status && t.status.confirmed), height: t.status && t.status.block_height, time: t.status && t.status.block_time,
      received, sent, net, fee: sent ? t.fee : null, type, vsize, feeRate: t.fee && vsize ? t.fee / vsize : null,
      rbf: t.vin.some((i) => i.sequence < 0xfffffffe),
    });
  }
  out.sort((a, b) => (a.confirmed !== b.confirmed ? (a.confirmed ? 1 : -1) : (b.height || 0) - (a.height || 0) || (b.time || 0) - (a.time || 0)));
  return out;
}

// Running sum over the history reversed to chronological order (history is newest-first, unconfirmed at the head, so
// they land at the end with time = now).
export function balanceSeries(history, now = Math.floor(Date.now() / 1000)) {
  const chrono = [...history].reverse();
  let bal = 0;
  const pts = [];
  for (const h of chrono) { bal += h.net; pts.push({ time: h.confirmed ? h.time : now, balance: bal, txid: h.txid }); }
  return pts;
}

// A coin of spend.js from an entry of scanAccount().utxos and the account's spend info.
export const utxoFromEsplora = (u, spendInfo, prevTx = null) => ({ ...u, script: typeof u.script === 'string' ? hexToBytes(u.script) : u.script, spendInfo, prevTx });

export const scriptHex = (s) => (typeof s === 'string' ? s : bytesToHex(s));
