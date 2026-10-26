// ethereum-wallet/explorer.js - the block explorer over the chosen JSON-RPC endpoint: search (transaction hash, block
// number or hash, address or ENS name, raw signed transaction -> the decoder), latest blocks, the pending block when
// the node offers it, a block with its transactions, a transaction (status from the receipt, fees paid, call data
// decoded with the known and saved ABIs, logs and token transfers), an address (balance, nonce, contract or not, the
// added tokens' balances), and the contract tool (an ABI and an address -> view / pure functions -> eth_call ->
// decoded outputs; ABIs saved in the vault).
//
// Indexer-free by design: only standard JSON-RPC methods are used, so any node (or the site's proxy) works and no
// third-party API sees the user's queries. Consequence: no per-address history (a node cannot list transactions by
// address without an index), stated on the address page (eth.noIndexer).
import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { button, field, textInput } from '../ui/app.js';
import { toast, confirmDialog, promptDialog } from '../ui/overlays.js';
import { contextMenu } from '../ui/contextmenu.js';
import { section, kv, go, busy, statusLine, linkTo, mono, copyable } from '../walletui/shell.js';
import { short, ago, dateTime, num } from '../walletui/format.js';
import { isAddress, getAddress } from '../ethereum/address.js';
import { isEnsName } from '../ethereum/ens.js';
import { parseAbi, encodeFunctionData, decodeFunctionResult, formatAbiValue, formatFragment } from '../ethereum/abi.js';
import { settings, rpc, chain, tokensOf, savedAbis, saveVault, vault, accountByAddress, accountLabel } from './state.js';
import { fmtEth, fmtToken, fmtGwei, erc20Balance, txView, resolveRecipient, hashLink, lang, decodeRevert } from './common.js';

// Route #/explorer/<kind>/<id>. A "loading" box is shown first and replaced when the page promise settles; the
// ctx.alive() checks drop results that arrive after the user navigated elsewhere (see main.js renderToken).
export async function renderExplorer(ctx) {
  const [, kind, id] = ctx.route.parts;
  const client = rpc();
  ctx.view.append(searchBox());
  if (!client) {
    ctx.view.append(section(t('eth.tab.explorer'), statusLine('info', t('eth.noEndpointText')), h('div', { class: 'ap-row wu-mt' }, button('eth.chooseEndpoint', 'globe', () => go('settings')), button('eth.decoder', 'terminal', () => go('tools/decode')))));
    return;
  }
  const box = h('div', { class: 'wu-col' }, statusLine('info', t('eth.loading')));
  ctx.view.append(box);
  try {
    let el;
    if (kind === 'tx') el = await txPage(client, id);
    else if (kind === 'block') el = await blockPage(client, id);
    else if (kind === 'address') el = await addressPage(client, id);
    else if (kind === 'pending') el = await pendingPage(client);
    else if (kind === 'contract') el = contractTool(client, id || '');
    else el = await homePage(client);
    if (!ctx.alive()) return;
    box.textContent = '';
    box.append(el);
  } catch (e) {
    if (!ctx.alive()) return;
    box.textContent = '';
    box.append(statusLine('error', e.code === 'notfound' ? t('eth.notFound') : e.message));
  }
}

// Tagged error so the router can show a friendly "not found" rather than the raw RPC message.
const notFound = () => Object.assign(new Error('not found'), { code: 'notfound' });

// Classification by shape, most specific first: 32-byte hex = tx hash (txPage falls back to block hash, both are
// 32 bytes and indistinguishable by shape), up to 12 digits = block number, 20-byte hex = address, >= 60 bytes of hex =
// raw signed transaction (handed to the decoder via sessionStorage), else ENS. Unknown input uses the native
// constraint-validation bubble (setCustomValidity + reportValidity): accessible and needs no extra DOM; cleared after
// 2 s so the next submit is not blocked by a stale custom error.
function searchBox() {
  const input = h('input', { class: 'ed-input wu-mono', placeholder: t('eth.searchHint'), 'aria-label': t('eth.search'), autocomplete: 'off', spellcheck: 'false' });
  const submit = async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    if (/^0x[0-9a-fA-F]{64}$/.test(q)) go('explorer/tx/' + q.toLowerCase());
    else if (/^\d{1,12}$/.test(q)) go('explorer/block/' + q);
    else if (/^0x[0-9a-fA-F]{40}$/.test(q)) go('explorer/address/' + q);
    else if (/^(0x)?(?:[0-9a-fA-F]{2}){60,}$/.test(q)) { sessionStorage.setItem('ethw-decode', q); go('tools/decode'); }
    else if (isEnsName(q)) {
      try { go('explorer/address/' + (await resolveRecipient(q)).address); } catch (x) { toast(x.message, 'error'); }
    } else { input.setCustomValidity(t('eth.searchUnknown')); input.reportValidity(); setTimeout(() => input.setCustomValidity(''), 2000); }
  };
  return h('form', { class: 'wu-search', onsubmit: submit, role: 'search' }, input, h('button', { type: 'submit', class: 'ed-btn ed-primary' }, t('eth.search')));
}

const stat = (label, value) => h('div', { class: 'wu-stat' }, h('span', null, label), h('b', null, value));
// Inline SVG string via the html attribute: a static trusted literal, never user data, so no injection risk.
const blockIcon = () => h('span', { class: 'ed-ic', html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 2 21 7v10l-9 5-9-5V7zM12 12l9-5M12 12 3 7M12 12v10"/></svg>' });

// Head block plus up to 9 predecessors, fetched in parallel; individual failures are dropped (filter(Boolean)) so a
// pruned or rate-limited node still shows what it can. gasPrice is optional for nodes that do not serve it.
async function homePage(client) {
  const head = await client.blockNumber();
  const n = Number(head);
  const [latest, gasPrice] = await Promise.all([client.getBlock(head), client.gasPrice().catch(() => null)]);
  const blocks = [latest, ...(await Promise.all(Array.from({ length: Math.min(9, n) }, (_, i) => client.getBlock(BigInt(n - 1 - i)).catch(() => null))))].filter(Boolean);
  return h('div', { class: 'wu-col' },
    h('div', { class: 'wu-stats' },
      stat(t('eth.chain'), `${chain().name} (${chain().id})`),
      stat(t('eth.latestBlock'), num(n, lang(), 0)),
      latest.baseFeePerGas != null ? stat(t('eth.baseFee'), fmtGwei(latest.baseFeePerGas)) : null,
      gasPrice != null ? stat(t('eth.gasPrice'), fmtGwei(gasPrice)) : null),
    section(t('eth.latestBlocks'), h('div', { class: 'wu-list' }, blocks.map((b) => h('a', { class: 'wu-item', href: '#/explorer/block/' + b.number }, blockIcon(),
      h('div', { class: 'wu-item-main' }, h('b', null, num(Number(b.number), lang(), 0)), h('span', { class: 'wu-small wu-muted wu-mono' }, short(b.hash, 12, 8))),
      h('span', { class: 'wu-item-side wu-small' }, t('eth.txCount', { n: b.transactions.length }), h('div', { class: 'wu-muted' }, ago(Number(b.timestamp), lang()))))))),
    h('div', { class: 'ap-row' }, linkTo('explorer/pending', t('eth.pendingBlock') + ' →'), linkTo('explorer/contract', t('eth.contractTool') + ' →')));
}

// Unknown tx hash: try it as a block hash before giving up; replace:true keeps the wrong URL out of history.
async function txPage(client, hash) {
  const [tx, receipt] = await Promise.all([client.getTransaction(hash), client.getTransactionReceipt(hash).catch(() => null)]);
  if (!tx) {
    // Maybe a block hash.
    const b = await client.getBlock(hash).catch(() => null);
    if (b) { go('explorer/block/' + b.number, { replace: true }); return h('div'); }
    throw notFound();
  }
  const block = tx.blockNumber != null ? await client.getBlock(tx.blockNumber).catch(() => null) : null;
  return txView(tx, { receipt, block });
}

// Digits = block number (BigInt for the RPC quantity), else a block hash. Full transactions requested (true) to list
// value/recipient; capped at 500 rows to keep the DOM bounded on very full blocks. Burnt fee = baseFee * gasUsed
// (EIP-1559 burns the base fee; priority fees go to the fee recipient). "Next" is always offered: the node answers
// notfound past the head, which is cheaper than another blockNumber call.
async function blockPage(client, id) {
  const ref = /^\d+$/.test(id) ? BigInt(id) : id;
  const b = await client.getBlock(ref, true);
  if (!b) throw notFound();
  const n = Number(b.number);
  const txs = b.transactions || [];
  const list = h('div', { class: 'wu-list' }, txs.slice(0, 500).map((x) => h('a', { class: 'wu-item', href: '#/explorer/tx/' + x.hash },
    h('div', { class: 'wu-item-main' }, mono(short(x.hash, 14, 10)), h('span', { class: 'wu-small wu-muted wu-mono wu-break' }, `${short(x.from, 8, 6)} → ${x.to ? short(x.to, 8, 6) : t('eth.contractCreation')}`)),
    h('span', { class: 'wu-item-side wu-small' }, fmtEth(x.value, settings.chainId, 4), h('div', { class: 'wu-muted' }, x.data && x.data !== '0x' ? x.data.slice(0, 10) : t('eth.transfer'))))));
  return h('div', { class: 'wu-col' },
    section(t('eth.blockN', { n: num(n, lang(), 0) }), kv([
      [t('eth.hash'), copyable(b.hash)],
      [t('eth.time'), dateTime(Number(b.timestamp), lang()) + ' · ' + ago(Number(b.timestamp), lang())],
      [t('eth.txs'), String(txs.length)],
      [t('eth.gasUsed'), `${num(Number(b.gasUsed), lang(), 0)} / ${num(Number(b.gasLimit), lang(), 0)} (${((Number(b.gasUsed) / Number(b.gasLimit || 1)) * 100).toFixed(1)} %)`],
      b.baseFeePerGas != null ? [t('eth.baseFee'), fmtGwei(b.baseFeePerGas)] : null,
      b.baseFeePerGas != null ? [t('eth.burnt'), fmtEth(b.baseFeePerGas * b.gasUsed, settings.chainId, 6)] : null,
      b.miner ? [t('eth.feeRecipient'), linkTo('explorer/address/' + b.miner, b.miner)] : null,
      b.size != null ? [t('eth.size'), `${num(Number(b.size), lang(), 0)} B`] : null,
      n > 0 ? [t('eth.parent'), linkTo('explorer/block/' + (n - 1), short(b.parentHash, 12, 8))] : null,
    ]), h('div', { class: 'ap-row wu-mt' }, n > 0 ? linkTo('explorer/block/' + (n - 1), '← ' + t('eth.prev')) : null, linkTo('explorer/block/' + (n + 1), t('eth.next') + ' →'))),
    section(t('eth.txsN', { n: txs.length }), txs.length ? list : h('div', { class: 'ap-empty' }, t('eth.noTxInBlock'))));
}

// "pending" block support varies (many providers disable it); an error is expected and shown as information.
async function pendingPage(client) {
  let b = null;
  try { b = await client.getBlock('pending', true); } catch (e) { return section(t('eth.pendingBlock'), statusLine('info', t('eth.noPending', { msg: e.message }))); }
  if (!b) return section(t('eth.pendingBlock'), statusLine('info', t('eth.noPending', { msg: '' })));
  const txs = b.transactions || [];
  return section(t('eth.pendingBlockN', { n: txs.length }), h('div', { class: 'wu-list' }, txs.length ? txs.slice(0, 200).map((x) => h('a', { class: 'wu-item', href: '#/explorer/tx/' + x.hash },
    h('div', { class: 'wu-item-main' }, mono(short(x.hash, 14, 10)), h('span', { class: 'wu-small wu-muted' }, `nonce ${x.nonce}`)),
    h('span', { class: 'wu-item-side wu-small' }, fmtEth(x.value, settings.chainId, 4), h('div', { class: 'wu-muted' }, fmtGwei(x.maxFeePerGas ?? x.gasPrice))))) : [h('div', { class: 'ap-empty' }, t('eth.noTx'))]));
}

// EIP-7702 delegation: an EOA with delegated code has exactly 0xef0100 + 20-byte address as its code, so it is shown
// as "delegated to" rather than as a contract. Nonce uses 'latest' here (confirmed count) unlike the wallet, which
// needs 'pending' for the next send.
async function addressPage(client, address) {
  if (!isAddress(address)) throw new Error(t('eth.badAddress', { a: address }));
  const a = getAddress(address);
  const tokens = tokensOf();
  const [bal, nonce, code, ...tb] = await Promise.all([client.getBalance(a), client.getTransactionCount(a, 'latest'), client.getCode(a).catch(() => '0x'),
    ...tokens.map((tk) => erc20Balance(client, tk.address, a).catch(() => null))]);
  const contract = code && code !== '0x';
  const own = accountByAddress(a);
  const delegated = contract && /^0xef0100[0-9a-f]{40}$/i.test(code) ? '0x' + code.slice(8) : null;
  const tokRows = tokens.map((tk, i) => (tb[i] ? [tk.symbol, fmtToken(tb[i], tk)] : null)).filter(Boolean);
  return h('div', { class: 'wu-col' },
    section(t('eth.address'), kv([
      [t('eth.address'), copyable(a)],
      own ? [t('eth.yours'), accountLabel(own.w, own.acc)] : null,
      [t('eth.balance'), fmtEth(bal, settings.chainId, 18)],
      [t('eth.nonce'), String(nonce)],
      [t('eth.kindLabel'), delegated ? t('eth.delegated', { a: delegated }) : contract ? t('eth.contractCode', { n: (code.length - 2) / 2 }) : t('eth.eoa')],
    ]), contract ? h('div', { class: 'ap-row wu-mt' }, linkTo('explorer/contract/' + a, t('eth.readContract') + ' →')) : null),
    section(t('eth.tokenBalances'), tokRows.length ? kv(tokRows) : h('div', { class: 'ap-empty' }, tokens.length ? t('eth.noTokenBalances') : t('eth.noTokens'))),
    h('p', { class: 'wu-small wu-muted' }, t('eth.noIndexer')));
}

// --- the contract tool ---

// Human-readable ERC-20 view ABI for the one-click preset; enough to inspect any token.
const ERC20_VIEW = ['function name() view returns (string)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function totalSupply() view returns (uint256)', 'function balanceOf(address owner) view returns (uint256)', 'function allowance(address owner, address spender) view returns (uint256)'].join('\n');

// Arrays and tuples are entered as JSON; bool accepts true/1; everything else is passed as text and validated by the
// ABI encoder (which knows the exact type range), so errors surface with the encoder's precise message.
function parseArg(text, param) {
  const s = text.trim();
  if (param.type.endsWith(']') || param.type === 'tuple' || param.type.startsWith('(')) return JSON.parse(s);
  if (param.type === 'bool') return s === 'true' || s === '1';
  return s;
}

// Read-only contract tool: only view/pure functions are offered, called with eth_call (no transaction, no gas, no
// signature). Revert data is decoded with the saved ABIs (custom errors) or Error(string). Saving an ABI bound to an
// address replaces that entry's ABI; unbound ABIs accumulate. A preset address with a saved ABI loads on the next
// tick (setTimeout 0) because the inputs are not yet in the document when this function returns.
function contractTool(client, preset) {
  const saved = savedAbis();
  const presetAbi = saved.find((x) => x.address && preset && x.address.toLowerCase() === preset.toLowerCase());
  const addr = textInput(preset, () => {}, { class: 'ed-input wu-mono', placeholder: '0x…', 'aria-label': t('eth.contract') });
  const abiIn = textInput(presetAbi ? (typeof presetAbi.abi === 'string' ? presetAbi.abi : JSON.stringify(presetAbi.abi)) : '', () => {}, { multiline: true, rows: 6, class: 'ed-input ed-textarea wu-mono', placeholder: t('eth.abiHint'), 'aria-label': 'ABI' });
  const out = h('div', { class: 'wu-col' });
  const savedBox = h('div', { class: 'wu-col' });
  const load = () => {
    out.textContent = '';
    let abi;
    try { abi = parseAbi(abiIn.value.trim()); } catch (e) { out.append(statusLine('error', t('eth.abiBad', { msg: e.message }))); return; }
    const fns = abi.functions.filter((f) => f.stateMutability === 'view' || f.stateMutability === 'pure');
    if (!fns.length) { out.append(statusLine('info', t('eth.noViewFns'))); return; }
    for (const fr of fns) {
      const ins = fr.inputs.map((p) => h('input', { class: 'ed-input wu-mono', placeholder: `${p.type} ${p.name || ''}`.trim(), 'aria-label': p.name || p.type }));
      const res = h('div', { class: 'ew-fn-out' });
      const call = h('button', { type: 'button', class: 'ed-btn' }, t('eth.call'));
      call.addEventListener('click', () => busy(call, (async () => {
        res.textContent = '';
        try {
          if (!isAddress(addr.value.trim())) throw new Error(t('eth.badAddress', { a: addr.value }));
          const data = encodeFunctionData(fr, fr.inputs.map((p, i) => parseArg(ins[i].value, p)));
          const raw = await client.call({ to: getAddress(addr.value.trim()), data });
          const vals = decodeFunctionResult(fr, raw);
          res.append(...(fr.outputs || []).map((p, i) => h('div', null, h('span', { class: 'wu-muted' }, (p.name || '#' + i) + ' (' + p.type + '): '), formatAbiValue(vals[i], p))));
        } catch (e) { const r = decodeRevert(e.data); res.append(h('span', { class: 'wu-error' }, r && r.reason ? t('eth.reverted', { msg: r.reason }) : e.message)); }
      })()));
      out.append(h('div', { class: 'ew-fn' }, h('b', { class: 'wu-mono' }, formatFragment(fr, 'human')), ins.length ? h('div', { class: 'wu-col wu-tight' }, ins) : null, h('div', { class: 'ap-row' }, call), res));
    }
  };
  const save = button('eth.saveAbi', 'save', async () => {
    try { parseAbi(abiIn.value.trim()); } catch (e) { toast(t('eth.abiBad', { msg: e.message }), 'error'); return; }
    const a = addr.value.trim();
    const name = await promptDialog(t('eth.saveAbi'), t('eth.abiName'), isAddress(a) ? short(getAddress(a), 6, 4) : 'ABI ' + (saved.length + 1));
    if (!name) return;
    const entry = { name: name.trim().slice(0, 60), address: isAddress(a) ? getAddress(a) : null, abi: abiIn.value.trim() };
    const i = saved.findIndex((x) => entry.address && x.address === entry.address);
    if (i >= 0) saved[i] = { ...saved[i], abi: entry.abi }; else saved.push(entry);
    saveVault();
    toast(t('eth.abiSaved'), 'ok');
    paintSaved();
  });
  const paintSaved = () => {
    savedBox.textContent = '';
    if (!saved.length) return;
    const list = h('div', { class: 'wu-list' }, saved.map((x, i) => h('div', { class: 'wu-item', tabindex: '0', dataset: { i } },
      h('div', { class: 'wu-item-main' }, h('b', null, x.name), h('span', { class: 'wu-mono wu-small wu-muted' }, x.address || t('eth.anyContract'))),
      h('button', { type: 'button', class: 'ed-btn', onclick: () => { addr.value = x.address || addr.value; abiIn.value = typeof x.abi === 'string' ? x.abi : JSON.stringify(x.abi); load(); } }, t('eth.use')))));
    contextMenu(list, (el) => {
      const x = saved[+el.dataset.i];
      if (!x) return null;
      return [
        { label: t('eth.use'), icon: 'check', action: () => { addr.value = x.address || addr.value; abiIn.value = typeof x.abi === 'string' ? x.abi : JSON.stringify(x.abi); load(); } },
        { label: t('dlg.delete'), icon: 'trash', danger: true, action: async () => { if (await confirmDialog(t('eth.deleteAbi'), x.name, t('dlg.delete'), true)) { saved.splice(saved.indexOf(x), 1); saveVault(); paintSaved(); } } },
      ];
    }, { selector: '.wu-item', label: t('eth.savedAbis') });
    savedBox.append(section(t('eth.savedAbis'), list));
  };
  paintSaved();
  if (presetAbi) setTimeout(load, 0);
  return h('div', { class: 'wu-col' }, section(t('eth.contractTool'), h('p', { class: 'wu-small wu-muted' }, t('eth.contractIntro')),
    field('eth.contract', addr), field('=ABI', abiIn),
    h('div', { class: 'ap-row' }, button('eth.loadAbi', 'check', load, 'primary'), button('eth.erc20Abi', 'layers', () => { abiIn.value = ERC20_VIEW; load(); }), save)), out, savedBox);
}

// Re-export kept for modules that import vault through the explorer (module graph compatibility).
export { vault };
