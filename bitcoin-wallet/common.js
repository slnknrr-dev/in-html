// bitcoin-wallet/common.js - shared pieces of the views: amounts in the chosen unit, wallet synchronisation over the
// data source, combined balances / history / coins of a wallet, and the decoded transaction view (inputs, outputs,
// scripts, witnesses, fee, script verification with the interpreter) used by the explorer, the decoder and the
// review of a payment.
//
// Design rules:
// - Amounts are integer satoshis everywhere in state; units (BTC, mBTC, bits, sat) exist only at the edges
//   (formatting, parsing). Floating-point BTC values would lose precision (0.1 + 0.2 problem) in fee arithmetic.
// - Sync results live in syncCache (state.js), keyed by account id, never inside the persisted wallet: chain data is
//   re-derivable and possibly stale, keys and settings are not. walletState() is a pure merge over that cache.
// - The transaction view shows facts, then the wallet's interpretation: raw scripts / witnesses are always displayed
//   next to the derived address, so a misclassified script cannot hide what will actually be signed.
import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { UI_STATE } from '../ui/i18n.js';
import { bytesToHex } from '../crypto/encoding.js';
import { formatBtc, parseBtc } from '../bitcoin/units.js';
import { fromOutputScript } from '../bitcoin/address.js';
import { classify, toAsm } from '../bitcoin/script.js';
import { scanAccount, walletHistory, balanceSeries } from '../bitcoin/sync.js';
import { verifyInput } from '../bitcoin/interpreter.js';
import { kv, linkTo, mono, copyable, section } from '../walletui/shell.js';
import { short, dateTime } from '../walletui/format.js';
import { settings, accountOf, source, syncCache, labelOf, isFrozen } from './state.js';

// Unit names are not translated: BTC / sat are the same tokens in every UI language.
export const UNIT_LABEL = { BTC: 'BTC', mBTC: 'mBTC', bits: 'bits', sat: 'sat' };

// null/undefined -> em dash, not "0 BTC": an unknown balance must not look like an empty one.
export const amt = (sats, { unit = settings.unit, sign = false } = {}) =>
  sats === null || sats === undefined ? '—' : `${formatBtc(sats, { unit, group: true, sign })} ${UNIT_LABEL[unit]}`;

// Parsing by the bitcoin/units.js parser: exact decimal-string to integer-sat conversion, no float in between.
export const parseAmount = (text, unit = settings.unit) => parseBtc(text, unit);

export const amtEl = (sats, opts = {}) => h('span', { class: 'wu-amt' + (opts.sign && sats > 0 ? ' wu-pos' : '') }, amt(sats, opts));

export const lang = () => UI_STATE.lang;

// --- synchronisation ---

// Throttle: an account synced in the last 30 s is skipped unless forced (tab switches would otherwise hammer the
// server). Accounts of type 'addresses' (imported address lists) scan exactly their list: the gap limit equals the
// list length and nothing is derived. On failure the previous scan is kept and the error recorded, then rethrown:
// the UI shows stale data with an error instead of an empty wallet. Remaining accounts are not attempted after an
// error (sequential loop, throw); the next sync retries them.
export async function syncWallet(wallet, { force = false, onProgress } = {}) {
  const src = source(wallet.network);
  if (!src) throw Object.assign(new Error(t('btc.noServer')), { code: 'noserver' });
  for (const acc of wallet.accounts) {
    const c = syncCache.get(acc.id);
    if (c && !force && Date.now() - c.at < 30000) continue;
    try {
      const fixed = acc.type === 'addresses';
      const scan = await scanAccount(accountOf(wallet, acc), src, { gapLimit: fixed ? acc.addresses.length : settings.gapLimit, maxIndex: fixed ? acc.addresses.length : 10000, onProgress });
      syncCache.set(acc.id, { scan, at: Date.now(), error: null });
    } catch (e) {
      syncCache.set(acc.id, { scan: c ? c.scan : null, at: Date.now(), error: e.message });
      throw e;
    }
  }
  return walletState(wallet);
}

// Combined state of the synchronised accounts of a wallet.
// Merge across accounts: `own` = hex of every scanned output script (used to mark "mine" in tx views and to compute
// the wallet's net effect per transaction); txs deduplicated by txid because two accounts of one wallet can appear
// in the same transaction (a payment between them). spendInfo is null for address-only accounts: no keys, so their
// coins are displayed but never selectable for signing.
export function walletState(wallet) {
  const scans = wallet.accounts.map((a) => ({ acc: a, c: syncCache.get(a.id) })).filter((x) => x.c && x.c.scan);
  const own = new Set();
  const utxos = [];
  const txs = new Map();
  let total = 0, confirmed = 0, tip = null;
  for (const { acc, c } of scans) {
    const account = accountOf(wallet, acc);
    for (const a of c.scan.addresses) own.add(bytesToHex(account.script(a.chain, a.index)));
    for (const u of c.scan.utxos) {
      const info = acc.type === 'addresses' ? null : account.spendInfo(u.chain, u.index);
      utxos.push({ ...u, accountId: acc.id, spendInfo: info, frozen: isFrozen(u.txid, u.vout), label: labelOf('output', `${u.txid}:${u.vout}`) || labelOf('addr', u.address) });
    }
    for (const tx of c.scan.txs) txs.set(tx.txid, tx);
    total += c.scan.balance.total;
    confirmed += c.scan.balance.confirmed;
    tip = c.scan.tip ?? tip;
  }
  const history = walletHistory([...txs.values()], own);
  // synced = every account has a scan; partial data is shown but flagged.
  return { synced: scans.length === wallet.accounts.length && scans.length > 0, total, confirmed, unconfirmed: total - confirmed, utxos, history, txs, own, tip, series: balanceSeries(history),
    errors: wallet.accounts.map((a) => syncCache.get(a.id)).filter((c) => c && c.error).map((c) => c.error) };
}

// The first unused receive (or change) address of an account after synchronisation (index 0 before).
export function nextIndex(wallet, acc, chain = 0) {
  const c = syncCache.get(acc.id);
  if (!c || !c.scan) return 0;
  return chain ? c.scan.next.change : c.scan.next.receive;
}

// --- the decoded transaction ---

// Human label per script template; P2A = pay-to-anchor (the ephemeral anchor output used for CPFP fee bumping).
const scriptLabel = (script) => {
  const c = classify(script);
  return { p2pkh: 'P2PKH', p2sh: 'P2SH', p2wpkh: 'P2WPKH', p2wsh: 'P2WSH', p2tr: 'P2TR', p2pk: 'P2PK', multisig: 'multisig', nulldata: 'OP_RETURN', anchor: 'P2A', witness_unknown: 'witness v' + c.version, nonstandard: t('btc.nonstandard') }[c.type];
};

// tx: Transaction; info: { prevouts: [{ value, script }] | null, status, network, own: Set<hex>, link: true }
// Fee = sum(prevout values) - sum(outputs), only when every prevout is known; a partial sum would print a wrong fee.
// Coinbase transactions have no fee (their input creates coins).
export function txView(tx, { prevouts = null, status = null, network = settings.network, own = new Set(), link = true, outspends = null } = {}) {
  const inValue = prevouts && prevouts.every(Boolean) ? prevouts.reduce((s, p) => s + p.value, 0) : null;
  const outValue = tx.outputs.reduce((s, o) => s + o.value, 0);
  const fee = inValue !== null && !tx.isCoinbase() ? inValue - outValue : null;
  const vsize = tx.vsize();
  const addr = (script) => fromOutputScript(script, network);
  const addrEl = (a) => (a && link ? linkTo('explorer/address/' + a, a) : a ? mono(a) : h('span', { class: 'wu-muted' }, '—'));
  let verify = null;
  // Script verification with the local interpreter: proves each input's signature against the prevout script and
  // amount (needed for segwit / taproot sighash). An interpreter exception is reported as a failed check, not thrown.
  if (prevouts && prevouts.every(Boolean) && !tx.isCoinbase()) {
    verify = tx.inputs.map((_, i) => { try { return verifyInput(tx, i, prevouts); } catch (e) { return { ok: false, error: e.message }; } });
  }
  const ins = tx.inputs.map((inp, i) => {
    const p = prevouts && prevouts[i];
    const a = p ? addr(p.script) : null;
    const mine = p && own.has(bytesToHex(p.script));
    return h('div', { class: 'wu-io-item' + (mine ? ' wu-mine' : '') },
      h('div', { class: 'wu-io-head' }, h('b', null, '#' + i), p ? h('span', null, amt(p.value)) : null),
      tx.isCoinbase() ? h('span', { class: 'wu-pill' }, t('btc.coinbase')) : h('div', { class: 'wu-small' }, link ? linkTo('explorer/tx/' + inp.txid, short(inp.txid, 10, 8)) : mono(short(inp.txid, 10, 8)), ':' + inp.vout),
      p ? h('div', null, addrEl(a), ' ', h('span', { class: 'wu-pill' }, scriptLabel(p.script))) : null,
      inp.scriptSig.length ? h('div', { class: 'wu-script' }, 'scriptSig: ' + toAsm(inp.scriptSig)) : null,
      // Empty witness items shown as <> (the conventional notation), so item positions stay countable.
      inp.witness.length ? h('div', { class: 'wu-script' }, t('btc.witness') + ': ' + inp.witness.map((w) => (w.length ? bytesToHex(w) : '<>')).join(' ')) : null,
      // BIP 125: any input with nSequence < 0xfffffffe signals replace-by-fee.
      h('div', { class: 'wu-small wu-muted' }, 'nSequence 0x' + inp.sequence.toString(16).padStart(8, '0') + (inp.sequence < 0xfffffffe ? ' · RBF' : '')),
      verify ? h('div', { class: 'wu-small ' + (verify[i].ok ? 'wu-ok' : 'wu-error') }, verify[i].ok ? t('btc.scriptOk') : t('btc.scriptBad', { error: verify[i].error })) : null);
  });
  const outs = tx.outputs.map((o, i) => {
    const a = addr(o.script);
    const mine = own.has(bytesToHex(o.script));
    const sp = outspends && outspends[i];
    const c = classify(o.script);
    return h('div', { class: 'wu-io-item' + (mine ? ' wu-mine' : '') },
      h('div', { class: 'wu-io-head' }, h('b', null, '#' + i), h('span', null, amt(o.value))),
      h('div', null, addrEl(a), ' ', h('span', { class: 'wu-pill' }, scriptLabel(o.script)), mine ? h('span', { class: 'wu-pill wu-okc' }, t('btc.mine')) : null),
      // OP_RETURN payloads: printable ASCII is shown as text, anything else as hex. fatal:false decoding turns invalid
      // UTF-8 into U+FFFD, which fails the ASCII test and falls back to hex, so binary never renders as mojibake.
      c.type === 'nulldata' && c.data ? h('div', { class: 'wu-small' }, 'OP_RETURN: ', mono(c.data.filter(Boolean).map((d) => { const s = new TextDecoder('utf-8', { fatal: false }).decode(d); return /^[\x20-\x7e]*$/.test(s) ? `"${s}"` : bytesToHex(d); }).join(' '))) : null,
      h('div', { class: 'wu-script' }, toAsm(o.script)),
      sp ? h('div', { class: 'wu-small wu-muted' }, sp.spent ? [t('btc.spentIn') + ' ', link ? linkTo('explorer/tx/' + sp.txid, short(sp.txid, 10, 8)) : short(sp.txid)] : t('btc.unspent')) : null);
  });
  const conf = status ? (status.confirmed ? t('btc.confirmedAt', { height: status.block_height }) : t('btc.unconfirmed')) : null;
  return h('div', { class: 'wu-col' },
    section(t('btc.transaction'), kv([
      [t('btc.txid'), copyable(tx.txid())],
      tx.hasWitness ? [t('btc.wtxid'), copyable(tx.wtxid(), short(tx.wtxid(), 12, 12))] : null,
      conf ? [t('btc.status'), status && status.block_hash && link ? linkTo('explorer/block/' + status.block_hash, conf) : conf] : null,
      status && status.block_time ? [t('btc.time'), dateTime(status.block_time, lang())] : null,
      [t('btc.size'), `${tx.size()} B · ${vsize} vB · ${tx.weight()} WU`],
      // sat/vB from vsize (weight / 4), the unit fee markets use since segwit; bytes alone would overstate segwit fees.
      fee !== null ? [t('btc.fee'), `${amt(fee)} · ${(fee / vsize).toFixed(2)} sat/vB`] : null,
      [t('btc.version'), String(tx.version)],
      // Consensus rule: locktime below 500 000 000 is a block height, otherwise a Unix timestamp.
      [t('btc.locktime'), tx.locktime ? (tx.locktime < 500000000 ? t('btc.lockHeight', { n: tx.locktime }) : dateTime(tx.locktime, lang())) : '0'],
      [t('btc.rbf'), tx.signalsRbf() ? t('btc.yes') : t('btc.no')],
      [t('btc.totalOut'), amt(outValue)],
    ])),
    h('div', { class: 'wu-io' },
      section(t('btc.inputs', { n: tx.inputs.length }), h('div', { class: 'wu-col' }, ins)),
      section(t('btc.outputs', { n: tx.outputs.length }), h('div', { class: 'wu-col' }, outs))));
}
