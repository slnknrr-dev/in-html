// bitcoin-wallet/explorer.js - the block explorer over the chosen Esplora server: search (transaction id, block hash or
// height, address, raw transaction or PSBT → the decoder), latest blocks, the mempool, a block with its transactions,
// a transaction decoded (inputs with prevouts, scripts, witnesses, fee, outspends, script verification), an address
// with its statistics, transactions and unspent outputs.
//
// Trust model: the explorer displays server data, but recomputes what it cheaply can instead of trusting it: txids
// come from the parsed raw hex (txView), the block header is hashed locally and compared with the block id, script
// verification runs in the local interpreter. A lying server can withhold data, but cannot make a forged
// transaction look valid here.
import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { button } from '../ui/app.js';
import { hexToBytes } from '../crypto/encoding.js';
import { Transaction } from '../bitcoin/tx.js';
import { isValidAddress, toOutputScript } from '../bitcoin/address.js';
import { parseHeader, difficulty } from '../bitcoin/block.js';
import { section, kv, go, statusLine, linkTo, mono, copyable } from '../walletui/shell.js';
import { short, ago, dateTime, num } from '../walletui/format.js';
import { settings, source, walletsOfNetwork } from './state.js';
import { amt, txView, walletState, lang } from './common.js';

export async function renderExplorer(ctx) {
  const [, kind, id, page] = ctx.route.parts;
  const src = source();
  ctx.view.append(searchBox());
  // Without a server the explorer still offers the offline decoder (raw tx / PSBT), which needs no network.
  if (!src) {
    ctx.view.append(section(t('btc.tab.explorer'), statusLine('info', t('btc.noServerText')), h('div', { class: 'ap-row wu-mt' }, button('btc.chooseServer', 'globe', () => go('settings')), button('btc.decoder', 'terminal', () => go('tools/decode')))));
    return;
  }
  const box = h('div', { class: 'wu-col' }, statusLine('info', t('btc.loading')));
  ctx.view.append(box);
  try {
    let el;
    if (kind === 'tx') el = await txPage(src, id);
    else if (kind === 'block') el = await blockPage(src, id, +page || 0);
    else if (kind === 'address') el = await addressPage(src, id);
    else el = await homePage(src);
    // The user may have navigated while awaiting; a stale page must not replace the current one.
    if (!ctx.alive()) return;
    box.textContent = '';
    box.append(el);
  } catch (e) {
    if (!ctx.alive()) return;
    box.textContent = '';
    box.append(statusLine('error', e.status === 404 ? t('btc.notFound') : e.message));
  }
}

function searchBox() {
  const input = h('input', { class: 'ed-input wu-mono', placeholder: t('btc.searchHint'), 'aria-label': t('btc.search'), autocomplete: 'off', spellcheck: 'false' });
  const submit = (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    // Search heuristics: 64 hex chars are a block hash if they start with 8 zero hex digits (proof of work makes
    // mainnet hashes start with many zeros; txids almost never do), else a txid. Caveat: regtest / low-difficulty
    // signet block hashes may have fewer zeros and open as a (missing) transaction. Digits only = a block height.
    if (/^[0-9a-f]{64}$/i.test(q)) go(/^0{8}/.test(q) ? 'explorer/block/' + q : 'explorer/tx/' + q);
    else if (/^\d{1,8}$/.test(q)) go('explorer/block/' + q);
    else if (isValidAddress(q, settings.network)) go('explorer/address/' + q);
    // Long hex (60+ bytes), Base64 "cHNidP" (= "psbt" magic 70736274ff) or hex PSBT go to the decoder through
    // sessionStorage: too large for a URL hash, and gone when the tab closes.
    else if (/^(?:[0-9a-f]{2}){60,}$/i.test(q) || /^cHNidP/.test(q) || /^70736274ff/i.test(q)) { sessionStorage.setItem('btcw-decode', q); go('tools/decode'); }
    // setCustomValidity + reportValidity: native, accessible error bubble without extra markup; cleared after 2 s so
    // the next submit is not blocked by a stale error.
    else input.setCustomValidity(t('btc.searchUnknown')), input.reportValidity(), setTimeout(() => input.setCustomValidity(''), 2000);
  };
  return h('form', { class: 'wu-search', onsubmit: submit, role: 'search' }, input, h('button', { type: 'submit', class: 'ed-btn ed-primary' }, t('btc.search')));
}

async function homePage(src) {
  // Independent requests in parallel; optional ones (mempool, fees) degrade to null instead of failing the page.
  const [tip, blocks, mempool, fees] = await Promise.all([src.tipHeight(), src.blocks(), src.mempool().catch(() => null), src.feeEstimates().catch(() => null)]);
  const recent = await src.mempoolRecent().catch(() => []);
  return h('div', { class: 'wu-col' },
    h('div', { class: 'wu-stats' },
      stat(t('btc.height'), num(tip, lang(), 0)),
      mempool ? stat(t('btc.mempoolTxs'), num(mempool.count, lang(), 0)) : null,
      mempool ? stat(t('btc.mempoolSize'), num(mempool.vsize / 1e6, lang(), 2) + ' MvB') : null,
      // Next-block fee: target 1, else 2 (some servers omit 1), else the 1 sat/vB floor.
      fees ? stat(t('btc.nextBlockFee'), `${num(fees['1'] || fees['2'] || 1, lang(), 1)} sat/vB`) : null,
      blocks[0] ? stat(t('btc.difficulty'), num(blocks[0].difficulty || difficulty(blocks[0].bits), lang(), 0)) : null),
    section(t('btc.latestBlocks'), h('div', { class: 'wu-list' }, blocks.map((b) => h('a', { class: 'wu-item', href: '#/explorer/block/' + b.id }, iconBlock(),
      h('div', { class: 'wu-item-main' }, h('b', null, num(b.height, lang(), 0)), h('span', { class: 'wu-small wu-muted wu-mono' }, short(b.id, 12, 8))),
      h('span', { class: 'wu-item-side wu-small' }, t('btc.txCount', { n: b.tx_count }), h('div', { class: 'wu-muted' }, ago(b.timestamp, lang()))))))),
    recent.length ? section(t('btc.mempoolRecent'), h('div', { class: 'wu-list' }, recent.slice(0, 10).map((x) => h('a', { class: 'wu-item', href: '#/explorer/tx/' + x.txid },
      h('div', { class: 'wu-item-main' }, mono(short(x.txid, 12, 10))), h('span', { class: 'wu-item-side wu-small' }, amt(x.value), h('div', { class: 'wu-muted' }, `${(x.fee / x.vsize).toFixed(1)} sat/vB`)))))) : null);
}

const iconBlock = () => h('span', { class: 'ed-ic', html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 2 21 7v10l-9 5-9-5V7zM12 12l9-5M12 12 3 7M12 12v10"/></svg>' });
const stat = (label, value) => h('div', { class: 'wu-stat' }, h('span', null, label), h('b', null, value));

// Union of scripts of all wallets on this network: highlights "mine" in any transaction or address page.
async function ownScripts() {
  const set = new Set();
  for (const w of walletsOfNetwork()) for (const s of walletState(w).own) set.add(s);
  return set;
}

async function txPage(src, txid) {
  // Both the JSON (prevouts, status) and the raw hex: the view is built from the raw bytes, JSON only adds context.
  const [json, hex, outspends] = await Promise.all([src.tx(txid), src.txHex(txid), src.txOutspends(txid).catch(() => null)]);
  const tx = Transaction.fromHex(hex);
  const prevouts = json.vin.map((i) => (i.prevout ? { value: i.prevout.value, script: hexToBytes(i.prevout.scriptpubkey) } : null));
  return txView(tx, { prevouts: tx.isCoinbase() ? null : prevouts, status: json.status, own: await ownScripts(), outspends });
}

async function blockPage(src, id, page) {
  const hash = /^\d+$/.test(id) ? await src.blockHash(+id) : id;
  const [b, headerHex] = await Promise.all([src.block(hash), src.blockHeader(hash).catch(() => null)]);
  const txs = await src.blockTxs(hash, page * 25);
  const header = headerHex ? parseHeader(headerHex) : null;
  // Esplora pages block transactions by 25.
  const pages = Math.ceil(b.tx_count / 25);
  return h('div', { class: 'wu-col' },
    section(t('btc.blockN', { n: num(b.height, lang(), 0) }), kv([
      [t('btc.hash'), copyable(b.id)],
      [t('btc.time'), dateTime(b.timestamp, lang()) + ' · ' + ago(b.timestamp, lang())],
      [t('btc.txs'), String(b.tx_count)],
      [t('btc.size'), `${num(b.size / 1000, lang(), 1)} kB · ${num(b.weight / 4000, lang(), 1)} kvB`],
      [t('btc.difficulty'), num(b.difficulty || difficulty(b.bits), lang(), 0)],
      [t('btc.merkleRoot'), mono(short(b.merkle_root, 16, 16))],
      // >>> 0: version and bits are unsigned 32-bit fields; JS bit ops would otherwise print negative numbers.
      [t('btc.version'), '0x' + (b.version >>> 0).toString(16)],
      ['nonce / bits', `${b.nonce} / 0x${(b.bits >>> 0).toString(16)}`],
      // Header check: double SHA-256 of the 80-byte header must equal the block id the server claims.
      header ? [t('btc.headerCheck'), header.hash === b.id ? t('btc.headerOk') : t('btc.headerBad')] : null,
      b.previousblockhash ? [t('btc.previous'), linkTo('explorer/block/' + b.previousblockhash, short(b.previousblockhash, 12, 8))] : null,
    ])),
    section(t('btc.txsPage', { from: page * 25 + 1, to: Math.min(b.tx_count, page * 25 + 25), n: b.tx_count }),
      h('div', { class: 'wu-list' }, txs.map((x) => h('a', { class: 'wu-item', href: '#/explorer/tx/' + x.txid },
        h('div', { class: 'wu-item-main' }, mono(short(x.txid, 14, 10)), h('span', { class: 'wu-small wu-muted' }, x.vin[0] && x.vin[0].is_coinbase ? t('btc.coinbase') : t('btc.inOut', { i: x.vin.length, o: x.vout.length }))),
        h('span', { class: 'wu-item-side wu-small' }, amt(x.vout.reduce((s, o) => s + o.value, 0)), x.fee ? h('div', { class: 'wu-muted' }, `${(x.fee / Math.ceil(x.weight / 4)).toFixed(1)} sat/vB`) : null)))),
      h('div', { class: 'ap-row wu-mt' },
        page > 0 ? linkTo(`explorer/block/${b.id}/${page - 1}`, '← ' + t('btc.prev')) : null,
        page + 1 < pages ? linkTo(`explorer/block/${b.id}/${page + 1}`, t('btc.next') + ' →') : null)));
}

async function addressPage(src, address) {
  const [info, txs, utxos] = await Promise.all([src.address(address), src.addressTxs(address), src.addressUtxos(address).catch(() => [])]);
  const cs = info.chain_stats, ms = info.mempool_stats;
  const spk = toOutputScript(address, settings.network);
  const ownSet = await ownScripts();
  return h('div', { class: 'wu-col' },
    section(t('btc.address'), kv([
      [t('btc.address'), copyable(address)],
      // Balance = funded - spent over confirmed and mempool stats (Esplora reports sums, not a balance).
      [t('btc.balance'), amt(cs.funded_txo_sum - cs.spent_txo_sum + ms.funded_txo_sum - ms.spent_txo_sum)],
      [t('btc.received'), amt(cs.funded_txo_sum + ms.funded_txo_sum)],
      [t('btc.txs'), String(cs.tx_count + ms.tx_count)],
      [t('btc.utxos'), String(utxos.length)],
      ownSet.has([...spk].map((b) => b.toString(16).padStart(2, '0')).join('')) ? [t('btc.mine'), t('btc.yes')] : null,
    ])),
    section(t('btc.history'), h('div', { class: 'wu-list' }, txs.map((x) => {
      // Net effect of each tx on this address: outputs to it minus inputs spending from it.
      const inSum = x.vin.filter((i) => i.prevout && i.prevout.scriptpubkey_address === address).reduce((s, i) => s + i.prevout.value, 0);
      const outSum = x.vout.filter((o) => o.scriptpubkey_address === address).reduce((s, o) => s + o.value, 0);
      return h('a', { class: 'wu-item', href: '#/explorer/tx/' + x.txid }, h('div', { class: 'wu-item-main' }, mono(short(x.txid, 14, 10)),
        h('span', { class: 'wu-small wu-muted' }, x.status.confirmed ? ago(x.status.block_time, lang()) : t('btc.unconfirmed'))),
      h('span', { class: 'wu-item-side ' + (outSum - inSum > 0 ? 'wu-pos' : '') }, amt(outSum - inSum, { sign: true })));
    }))));
}
