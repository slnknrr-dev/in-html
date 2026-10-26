// funding-studio/server-crypto.js - crypto donations in the backend: a Bitcoin address per donation (derived from an
// xpub / descriptor through bitcoin/account.js, wired in by backend.js - else from the owner's address pool), payment
// detection through an Esplora API the owner configures; Ethereum donations claimed by the page after a wallet
// transaction and verified through the owner's JSON-RPC endpoint (receipt, value or ERC-20 Transfer log,
// confirmations). Prices come from fixed rates or the owner's price URL.
import { btcAddressInfo, canDerive, deriveBtcAddress, esploraClient, evmRpc, fromUnits, isEthAddress, tokenInfo, toUnits, TRANSFER_TOPIC } from './chains.js';
import { rateOf } from '../payments/money.js';
//
// Principles: watch-only (no private key ever reaches the server, so a compromised backend cannot move funds);
// amounts in base units as BigInt (satoshi, wei: float would lose precision past 2^53 wei = 0.009 ETH); the chain is
// the source of truth - the page's claimed amount is ignored and the received amount is what gets recorded.

// How long a donation may wait for its first on-chain sighting before it expires (and a pool address is freed).
const HOLD_MS = 48 * 3600 * 1000;

/* ---------- prices ---------- */

const priceCache = new Map(); // url -> { at, json }
const pathGet = (o, p) => { for (const k of String(p || '').split('.')) { if (o == null) return undefined; if (k) o = o[k]; } return o; };

// Price of 1 `sym` in `cur`: fixed rates (settings + the site's public rates), else the configured price URL.
// The price URL response is cached 5 minutes per URL (also failures, so a down price API is not hammered), with an
// 8 s timeout. The path template ('bitcoin.{cur}') is walked with pathGet; a non-positive result means "no price".
export async function priceOf(B, site, sym, cur) {
  if (sym === cur) return 1;
  const fixed = B.rates(site);
  const f = rateOf(sym, cur, fixed);
  if (f) return f;
  const doc = B.siteDoc(site);
  const conf = B.settings().price.url ? B.settings().price : doc && doc.pay.rates.url ? { url: doc.pay.rates.url, paths: doc.pay.rates.paths } : null;
  const tpl = conf && conf.paths && conf.paths[sym];
  if (!conf || !tpl) return null;
  const url = conf.url.replace(/\{cur\}/g, cur.toLowerCase()).replace(/\{CUR\}/g, cur);
  let c = priceCache.get(url);
  if (!c || Date.now() - c.at > 300000) {
    try {
      const r = await B.request({ method: 'GET', url, headers: { Accept: 'application/json' }, timeout: 8000 });
      c = { at: Date.now(), json: r.status === 200 ? JSON.parse(r.text) : null };
    } catch { c = { at: Date.now(), json: null }; }
    priceCache.set(url, c);
  }
  const v = Number(pathGet(c.json, tpl.replace(/\{cur\}/g, cur.toLowerCase()).replace(/\{CUR\}/g, cur)));
  return v > 0 ? v : null;
}

/* ---------- Bitcoin ---------- */

export const btcReady = (B) => { const s = B.settings().btc; return !!(s.esplora && ((s.xpub && canDerive()) || s.addresses.length)); };

// An address for a new donation: the next derived one, or a pool address no other open donation holds.
// One address per donation is what makes matching possible: Bitcoin payments carry no reference field.
// Derived addresses are never reused (a persisted counter). Note: every request burns an index even if nobody pays,
// so a flood of requests can push used addresses beyond a wallet's gap limit (BIP-44 default 20) and the owner's
// wallet may not show later payments until its gap is raised - the payment rate limit bounds this.
// Pool addresses are reused once no open donation younger than HOLD_MS holds them.
export function assignBtc(B) {
  const s = B.settings().btc;
  if (s.xpub && canDerive()) {
    // Next unused index of this account (one counter per xpub / descriptor and network, so switching accounts and
    // back never hands out an address twice).
    const all = B.storage.read('btc-index');
    const map = all && typeof all === 'object' ? all : {};
    const key = s.network + ':' + s.xpub;
    const idx = Number(map[key]) || 0;
    const a = deriveBtcAddress(s.xpub, idx, s.network);
    map[key] = idx + 1;
    B.storage.write('btc-index', map);
    return a;
  }
  const busy = new Set(B.ledger.all().filter((d) => d.method === 'btc' && (d.status === 'created' || d.status === 'pending') && Date.now() - Date.parse(d.created) < HOLD_MS).map((d) => d.data.btc && d.data.btc.address));
  return s.addresses.find((a) => !busy.has(a) && btcAddressInfo(a).ok) || '';
}

// Polls Esplora for every open BTC donation. Rules: outputs to the donation's address in txs not older than 1 h
// before the donation (a reused pool address must not credit an old payment); each output (txid:vout) can credit
// one donation only (ledger ref); confirmed when depth >= configured confirmations (tip - height + 1). Success when
// the confirmed sum reaches 97 % of the expected amount (tolerates wallet fee rounding and price drift between quote
// and payment). Unconfirmed sightings move 'created' to 'pending' so the thank-you page can say "seen".
// Without an expected amount (no price at request time), the received BTC is converted now, or recorded in BTC.
export async function btcScan(B) {
  const s = B.settings().btc;
  if (!s.esplora) return 0;
  const es = esploraClient(B.request, s.esplora);
  let tip = null;
  let n = 0;
  for (const d of B.ledger.all()) {
    if (d.method !== 'btc' || !(d.status === 'created' || d.status === 'pending') || !d.data.btc) continue;
    const info = d.data.btc;
    try {
      if (tip == null) tip = await es.tipHeight();
      const txs = await es.addressTxs(info.address);
      let conf = 0n;
      let seen = 0n;
      const used = [];
      for (const tx of Array.isArray(txs) ? txs : []) {
        const t = tx.status && tx.status.block_time ? tx.status.block_time * 1000 : Date.now();
        if (t < Date.parse(d.created) - 3600000) continue;
        tx.vout.forEach((o, i) => {
          if (o.scriptpubkey_address !== info.address) return;
          const ref = 'btc:tx:' + tx.txid + ':' + i;
          const owner = B.ledger.byRef(ref);
          if (owner && owner.id !== d.id) return;
          seen += BigInt(o.value);
          const ok = tx.status && tx.status.confirmed && tip - tx.status.block_height + 1 >= Math.max(1, s.confirmations);
          if (ok) { conf += BigInt(o.value); used.push(ref); }
        });
      }
      const expect = info.expect ? BigInt(info.expect) : null;
      if (conf > 0n && (expect == null || conf * 100n >= expect * 97n)) {
        for (const r of used) B.ledger.addRef(d, r);
        info.received = conf.toString();
        let o = { status: 'succeeded' };
        if (expect == null) {
          const btc = Number(fromUnits(conf, 8));
          const p = await priceOf(B, d.site, 'BTC', d.currency);
          o = p ? { status: 'succeeded', amount: Math.round(btc * p * 100) / 100 } : { status: 'succeeded', amount: btc, currency: 'BTC' };
        }
        B.ledger.settle(d, { ...o, rates: B.rates(d.site), receiptPrefix: B.receiptPrefix(), wallAuto: B.wallAuto() });
        n++;
      } else if (seen > 0n && d.status === 'created') { B.ledger.settle(d, { status: 'pending' }); n++; }
      else if (Date.now() - Date.parse(d.created) > HOLD_MS && seen === 0n) { B.ledger.settle(d, { status: 'expired' }); n++; }
    } catch (e) { B.log('btc scan', d.id, e.message); }
  }
  return n;
}

/* ---------- Ethereum ---------- */

export const rpcFor = (B, chain) => { const u = B.settings().eth.rpc[String(chain)]; return u ? evmRpc(B.request, u) : null; };
const pad = (a) => '0x' + a.slice(2).toLowerCase().padStart(64, '0');

// Verifies a claimed transaction: success, recipient, amount, confirmations. Updates the donation.
// Native coin: tx.to must be the campaign address and tx.value is the amount. ERC-20: sum the Transfer(from, to,
// value) logs emitted by the expected token contract whose `to` topic (topics[2], address left-padded to 32 bytes) is
// the campaign address - this is how a token payment is proven, since the tx itself is addressed to the contract.
// A reverted tx (status != 0x1) fails; a tx not yet mined stays open until HOLD_MS.
// Known limits: native ETH sent through a contract (internal transfer) is not seen, and the claim is not bound to its
// sender (tx.from is not compared with the claimed `from`), so whoever claims a tx hash first gets the donor
// attribution for it; the amount and recipient are still enforced by the chain.
export async function ethVerify(B, d) {
  const info = d.data.eth;
  const doc = B.siteDoc(d.site);
  if (!info || !doc) return d;
  const rpc = rpcFor(B, info.chain);
  if (!rpc) return d;
  const our = doc.pay.eth.address.toLowerCase();
  const rcpt = await rpc.receipt(info.tx);
  if (!rcpt) { if (Date.now() - Date.parse(d.created) > HOLD_MS) B.ledger.settle(d, { status: 'expired' }); return d; }
  if (rcpt.status !== '0x1') { B.ledger.settle(d, { status: 'failed' }); return d; }
  const tip = await rpc.blockNumber();
  const confs = tip - Number(BigInt(rcpt.blockNumber)) + 1;
  let units = 0n;
  let decimals = 18;
  let sym = info.token;
  const tk = tokenInfo(info.chain, info.token, doc.pay.eth.custom);
  if (!tk) { B.ledger.settle(d, { status: 'failed' }); return d; }
  if (tk.native) {
    const tx = await rpc.tx(info.tx);
    if (tx && String(tx.to || '').toLowerCase() === our) units = BigInt(tx.value);
    sym = tk.symbol;
  } else {
    decimals = tk.decimals;
    for (const l of rcpt.logs || []) {
      if (String(l.address).toLowerCase() !== tk.address.toLowerCase() || !l.topics || l.topics[0] !== TRANSFER_TOPIC) continue;
      if (String(l.topics[2]).toLowerCase() !== pad(our)) continue;
      units += BigInt(l.data);
    }
  }
  if (units === 0n) { B.ledger.settle(d, { status: 'failed' }); d.note = 'no transfer to the campaign address'; B.ledger.save(d); return d; }
  info.units = units.toString();
  info.confirmations = confs;
  if (confs < Math.max(1, B.settings().eth.confirmations)) { if (d.status !== 'pending') B.ledger.settle(d, { status: 'pending' }); else B.ledger.save(d); return d; }
  const amountTok = Number(fromUnits(units, decimals));
  const p = await priceOf(B, d.site, tk.usd ? 'USD' : sym, d.currency);
  const o = p ? { amount: Math.round(amountTok * p * 100) / 100 } : { amount: amountTok, currency: tk.usd ? 'USD' : sym };
  B.ledger.settle(d, { status: 'succeeded', ...o, rates: B.rates(d.site), receiptPrefix: B.receiptPrefix(), wallAuto: B.wallAuto() });
  return d;
}

export async function ethScan(B) {
  let n = 0;
  for (const d of B.ledger.all()) {
    if (d.method !== 'eth' || !(d.status === 'created' || d.status === 'pending')) continue;
    try { await ethVerify(B, d); n++; } catch (e) { B.log('eth verify', d.id, e.message); }
  }
  return n;
}

export const ethReady = (B, doc) => !!(doc && isEthAddress(doc.pay.eth.address) && doc.pay.eth.chains.some((c) => B.settings().eth.rpc[String(c)]));
export const btcUnits = (amount) => toUnits(amount, 8);
