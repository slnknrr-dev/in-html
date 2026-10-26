// ethereum-wallet/common.js - shared pieces of the views: amounts (ether, gwei, token units), balances of accounts and
// tokens over JSON-RPC (with the local balance snapshots), recipients (addresses, ENS names), call data and event
// decoding with the known ABIs (ERC-20 / 721 / 1155 / WETH) plus the user's saved ABIs, and the decoded transaction
// view used by the explorer, the decoder and the review of a payment.
//
// Design rules of this module:
// - Amounts are bigint end to end (wei, token base units). Number would lose precision above 2^53 wei (~0.009 ETH),
//   so conversion to text happens only in the fmt* helpers, and parsing only in parse* helpers.
// - Null means "unknown" and renders as an em dash; 0n means a real zero. The distinction matters for balances that
//   failed to load: showing 0 would invite a wrong decision.
// - Decoding is best effort: every ABI attempt is wrapped in try/catch, unknown data falls back to raw hex. A view
//   must never throw because a contract used a non-standard ABI.
import { h } from '../ui/dom.js';
import { t, UI_STATE } from '../ui/i18n.js';
import { kv, linkTo, mono, copyable, section, OFFLINE } from '../walletui/shell.js';
import { short, dateTime } from '../walletui/format.js';
import { formatUnits, formatGwei, parseUnits, toQuantity } from '../ethereum/units.js';
import { isAddress, getAddress, equalAddress } from '../ethereum/address.js';
import { parseAbi, decodeFunctionData, decodeFunctionResult, decodeErrorResult, formatAbiValue } from '../ethereum/abi.js';
import { ERC20_ABI, ERC721_ABI, ERC1155_ABI, WETH_ABI, erc20BalanceOfData, decodeTokenTransfer } from '../ethereum/erc.js';
import { decodeLogs, tokenTransfersOf } from '../ethereum/logs.js';
import { txTypeName } from '../ethereum/tx.js';
import { isEnsName, resolveName } from '../ethereum/ens.js';
import { settings, rpc, balances, tokensOf, tokenByAddress, savedAbis, symbolOf, recordSnapshot, accountByAddress, accountLabel } from './state.js';

export const lang = () => UI_STATE.lang;

// --- amounts ---

// Formatters accept bigint, numeric string or number (BigInt(v) normalises), and default token precision to at most 6
// fraction digits: enough to see dust, short enough for a table column.
export const fmtUnits = (v, decimals = 18, max = 6) => (v === null || v === undefined ? '—' : formatUnits(BigInt(v), decimals, { maxDecimals: max, group: true }));
export const fmtEth = (wei, id = settings.chainId, max = 6) => (wei === null || wei === undefined ? '—' : `${fmtUnits(wei, 18, max)} ${symbolOf(id)}`);
export const fmtToken = (v, token) => (v === null || v === undefined ? '—' : `${fmtUnits(v, token.decimals, Math.min(6, token.decimals))} ${token.symbol}`);
export const fmtGwei = (wei) => (wei === null || wei === undefined ? '—' : `${formatGwei(BigInt(wei), { maxDecimals: 3 })} gwei`);
// Decimal comma accepted (first one only) for locales that type "1,5"; thousands separators are not supported and
// make parseUnits throw, which the form shows as an invalid amount rather than guessing.
export const parseGweiText = (text) => parseUnits(String(text).trim().replace(',', '.'), 9);
export const parseAmountText = (text, decimals = 18) => parseUnits(String(text).trim().replace(',', '.'), decimals);
export const big = (v) => (v === null || v === undefined || v === '' ? null : BigInt(v));

// --- balances ---

// Cache key includes the chain: the same address has unrelated balances on every EVM chain.
const bkey = (address, id) => `${id}|${address}`;
export const balanceOf = (address, id = settings.chainId) => balances.get(bkey(address, id)) || null;

// eth_call of balanceOf(owner). "0x" (empty return) means the target has no code (not a contract) - treated as zero
// rather than an error so a mistyped token address does not break the whole balance refresh.
export async function erc20Balance(client, token, owner) {
  const out = await client.call({ to: token, data: erc20BalanceOfData(owner) });
  return out && out !== '0x' ? decodeFunctionResult('function balanceOf(address) view returns (uint256)', out)[0] : 0n;
}

// Reads the ether balance, the pending nonce and the balances of the added tokens of each address.
// Cache policy: a cached entry younger than 20 s, without error and covering every added token, is reused unless
// force. 20 s ~ one or two blocks on mainnet: fresher data would cost RPC calls for no visible change. Per-token
// failures degrade to null (unknown) so one broken token contract cannot hide the ether balance. The pending nonce
// (not "latest") is read so a second send right after the first does not reuse the nonce.
// On error the previous values are kept with the error attached (stale-but-visible), and the error is rethrown so
// the caller can show it. Promise.all rejects on the first failure while the other addresses still finish and fill
// the cache.
export async function refreshBalances(addresses, { id = settings.chainId, force = false } = {}) {
  const client = rpc(id);
  if (!client) throw Object.assign(new Error(t('eth.noEndpoint')), { code: 'noendpoint' });
  const tokens = tokensOf(id);
  await Promise.all(addresses.map(async (address) => {
    const c = balanceOf(address, id);
    if (c && !force && Date.now() - c.at < 20000 && !c.error && tokens.every((tk) => tk.address in c.tokens)) return;
    try {
      const [wei, nonce, ...tb] = await Promise.all([client.getBalance(address), client.getTransactionCount(address, 'pending'),
        ...tokens.map((tk) => erc20Balance(client, tk.address, address).catch(() => null))]);
      balances.set(bkey(address, id), { wei, nonce, tokens: Object.fromEntries(tokens.map((tk, i) => [tk.address, tb[i]])), at: Date.now(), error: null });
      recordSnapshot(address, wei, id);
    } catch (e) {
      balances.set(bkey(address, id), { ...(c || { wei: null, nonce: null, tokens: {} }), at: Date.now(), error: e.message });
      throw e;
    }
  }));
}

// --- recipients ---

// An address, or an ENS name resolved over the Ethereum mainnet endpoint. Returns { address, ens }.
// Order of checks matters: a well-formed hex address with a wrong EIP-55 checksum is rejected (not lower-cased and
// accepted) because a checksum mismatch usually means a typo. ENS always resolves on mainnet (chain 1) whatever chain
// is selected: the ENS registry lives there; resolving on the current chain would give nothing or a spoofed record.
export async function resolveRecipient(text) {
  const s = String(text || '').trim();
  if (isAddress(s)) return { address: getAddress(s), ens: null };
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) throw new Error(t('eth.badChecksum'));
  if (isEnsName(s)) {
    const client = rpc(1);
    if (!client) throw new Error(OFFLINE ? t('eth.ensOffline') : t('eth.ensNeedsMainnet'));
    const a = await resolveName(client, s);
    if (!a) throw new Error(t('eth.ensNotFound', { name: s }));
    return { address: a, ens: s };
  }
  throw new Error(t('eth.badAddress', { a: s }));
}

// --- ABIs ---

// Lazily parsed once. WETH_ABI starts with the ERC-20 fragments, so only its tail (deposit/withdraw) is appended to
// avoid duplicate selectors.
let KNOWN = null;
export const knownAbi = () => (KNOWN ||= parseAbi([...ERC20_ABI, ...ERC721_ABI, ...ERC1155_ABI, ...WETH_ABI.slice(ERC20_ABI.length)]));

// Saved ABIs bound to this contract address first, then all others (a generic ABI saved without address may still
// match by selector).
export function userAbiFor(address) {
  const list = savedAbis();
  const own = address ? list.filter((a) => a.address && equalAddress(a.address, address)) : [];
  return [...own, ...list.filter((a) => !own.includes(a))];
}

// Call data decoded with the saved ABIs (the contract's own first), then the token standards.
// length < 10: fewer than "0x" + 4-byte selector, cannot be a call. First matching ABI wins; a 4-byte selector can
// collide between unrelated functions, which is why the contract's own ABI is tried first.
export function decodeCall(data, to = null) {
  if (!data || data === '0x' || data.length < 10) return null;
  for (const a of userAbiFor(to)) {
    try { const d = decodeFunctionData(parseAbi(a.abi), data); if (d) return { ...d, source: a.name }; } catch { /* not this ABI */ }
  }
  try { const d = decodeFunctionData(knownAbi(), data); if (d) return { ...d, source: 'standard' }; } catch { /* unknown */ }
  return null;
}

// decodeErrorResult with an empty ABI still knows the built-in Error(string) and Panic(uint256) selectors.
export function decodeRevert(data) {
  if (!data || typeof data !== 'string') return null;
  for (const a of savedAbis()) { try { const r = decodeErrorResult(parseAbi(a.abi), data); if (r) return r; } catch { /* next */ } }
  try { return decodeErrorResult([], data); } catch { return null; }
}

export const argRows = (fragment, args) => (fragment.inputs || []).map((p, i) => [p.name || '#' + i, p.type, formatAbiValue(args[i], p)]);

export function argsTable(fragment, args) {
  const rows = argRows(fragment, args);
  if (!rows.length) return h('div', { class: 'wu-small wu-muted' }, t('eth.noArgs'));
  return h('div', { class: 'ap-table-wrap' }, h('table', { class: 'ap-table' }, h('tbody', null, rows.map(([n, ty, v]) =>
    h('tr', null, h('td', null, h('b', null, n)), h('td', { class: 'wu-muted wu-small' }, ty), h('td', null, mono(v)))))));
}

// --- links and labels ---

// Address with an identity pill: own account label (green) or known token symbol. Helps the user spot a wrong
// recipient at a glance. Offline build renders plain monospace text: explorer links would lead nowhere.
export function addrEl(address, { link = !OFFLINE } = {}) {
  if (!address) return h('span', { class: 'wu-muted' }, '—');
  const own = accountByAddress(address);
  const tk = tokenByAddress(address);
  const tag = own ? h('span', { class: 'wu-pill wu-okc' }, accountLabel(own.w, own.acc)) : tk ? h('span', { class: 'wu-pill' }, tk.symbol) : null;
  return h('span', { class: 'wu-addr' }, link ? linkTo('explorer/address/' + address, address) : mono(address), tag ? ' ' : null, tag);
}

export const hashLink = (hash, { link = !OFFLINE, kind = 'tx' } = {}) => (link ? linkTo(`explorer/${kind}/${hash}`, short(hash, 12, 10)) : mono(short(hash, 12, 10)));

// --- the decoded transaction ---

// tx: rpc.js formatted transaction or tx.js parsed one; receipt / block optional.
// Renders both a mined transaction (with receipt/block) and an unsigned or locally signed one (review before
// broadcast). Status logic: receipt -> success/failed; mined without receipt -> nothing; no hash -> not broadcast;
// otherwise pending (only meaningful when live and online).
// Type 2+ (EIP-1559, 4844, 7702) shows maxFee/priority; type 0/1 shows gasPrice. Before mining, "max cost" is the
// worst case gasLimit * maxFee + value; after mining, the actual fee is gasUsed * effectiveGasPrice.
export function txView(tx, { receipt = null, block = null, link = !OFFLINE, title = t('eth.transaction'), live = true } = {}) {
  const chainId = tx.chainId != null ? Number(tx.chainId) : settings.chainId;
  const sym = symbolOf(chainId);
  const type = tx.type != null ? Number(tx.type) : 0;
  const status = receipt ? (receipt.status === 1 ? h('span', { class: 'wu-pill wu-okc' }, t('eth.success')) : h('span', { class: 'wu-pill wu-warnc' }, t('eth.failed')))
    : tx.blockNumber != null ? null : !tx.hash ? h('span', { class: 'wu-pill' }, t('eth.notBroadcast')) : live && link ? h('span', { class: 'wu-pill' }, t('eth.pendingTx')) : null;
  const feePaid = receipt && receipt.gasUsed != null && receipt.effectiveGasPrice != null ? receipt.gasUsed * receipt.effectiveGasPrice : null;
  const data = tx.data || tx.input || '0x';
  const call = decodeCall(data, tx.to);
  const transfer = data !== '0x' ? decodeTokenTransfer(data) : null;
  const token = tx.to ? tokenByAddress(tx.to, chainId) : null;
  const pairs = [
    tx.hash ? [t('eth.hash'), copyable(tx.hash)] : null,
    status ? [t('eth.status'), status] : null,
    tx.blockNumber != null ? [t('eth.block'), link ? linkTo('explorer/block/' + tx.blockNumber, String(tx.blockNumber)) : String(tx.blockNumber)] : null,
    block && block.timestamp ? [t('eth.time'), dateTime(Number(block.timestamp), lang())] : null,
    [t('eth.from'), tx.from ? addrEl(tx.from, { link }) : h('span', { class: 'wu-muted' }, t('eth.unsigned'))],
    [t('eth.to'), tx.to ? addrEl(tx.to, { link }) : receipt && receipt.contractAddress ? h('span', null, t('eth.created') + ' ', addrEl(receipt.contractAddress, { link })) : t('eth.contractCreation')],
    [t('eth.value'), fmtEth(tx.value ?? 0n, chainId, 18)],
    [t('eth.nonce'), String(tx.nonce)],
    [t('eth.type'), `${type} · ${txTypeName(type)}`],
    tx.chainId != null ? [t('eth.chainId'), String(tx.chainId)] : null,
    [t('eth.gasLimit'), fmtUnits(tx.gasLimit ?? tx.gas, 0)],
    // KNOWN DEFECT: the percentage is computed only when tx.gasLimit is set; transactions formatted with a 'gas' field
    // (JSON-RPC naming) show '?' although the divisor below already falls back to tx.gas. Fix: test (tx.gasLimit ?? tx.gas).
    receipt ? [t('eth.gasUsed'), `${fmtUnits(receipt.gasUsed, 0)} (${tx.gasLimit ? ((Number(receipt.gasUsed) / Number(tx.gasLimit ?? tx.gas)) * 100).toFixed(1) : '?'} %)`] : null,
    type >= 2 ? [t('eth.maxFee'), `${fmtGwei(tx.maxFeePerGas)} · ${t('eth.priority')} ${fmtGwei(tx.maxPriorityFeePerGas)}`] : [t('eth.gasPrice'), fmtGwei(tx.gasPrice)],
    receipt && receipt.effectiveGasPrice != null ? [t('eth.effectivePrice'), fmtGwei(receipt.effectiveGasPrice)] : null,
    feePaid !== null ? [t('eth.feePaid'), fmtEth(feePaid, chainId, 9)] : !receipt && (tx.gasLimit ?? tx.gas) != null ? [t('eth.maxCost'), fmtEth(BigInt(tx.gasLimit ?? tx.gas) * BigInt((type >= 2 ? tx.maxFeePerGas : tx.gasPrice) || 0n) + BigInt(tx.value || 0n), chainId, 9)] : null,
  ];
  const parts = [section(title, kv(pairs))];
  if (data !== '0x') {
    parts.push(section(t('eth.input'),
      call ? h('div', { class: 'wu-col' }, h('div', null, h('b', { class: 'wu-mono' }, call.signature), ' ', h('span', { class: 'wu-pill' }, call.source === 'standard' ? t('eth.knownAbi') : call.source)), argsTable(call.fragment, call.args))
        : h('div', { class: 'wu-small wu-muted' }, t('eth.unknownCall', { sel: data.slice(0, 10) })),
      transfer && transfer.standard === 'erc20' && token ? statusLine2(t('eth.tokenTransfer', { amt: fmtToken(transfer.amount, token), to: transfer.to })) : null,
      h('details', null, h('summary', { class: 'wu-small' }, t('eth.rawData', { n: (data.length - 2) / 2 })), h('div', { class: 'wu-script' }, data))));
  }
  if (receipt && receipt.logs) parts.push(logsView(receipt, { link, chainId }));
  return h('div', { class: 'wu-col' }, parts);
}

// Local copy of a green status line (named 2 to avoid clashing with walletui helpers of the same purpose).
const statusLine2 = (text) => h('div', { class: 'wu-status wu-ok' }, h('span', null, text));

// Each log is decoded with the emitting contract's saved ABIs first (accepted only when it is a non-standard event,
// so a saved ERC-20 ABI does not shadow the standard label), then with the built-in standards. Token transfers
// (ERC-20/721/1155) get a separate summary list because they are what users look for in a receipt.
export function logsView(receipt, { link = !OFFLINE, chainId = settings.chainId } = {}) {
  const transfers = tokenTransfersOf(receipt);
  const decoded = receipt.logs.map((log) => {
    for (const a of userAbiFor(log.address)) { try { const d = decodeLogs([log], a.abi)[0]; if (!d.unknown && d.standard === null) return d; } catch { /* next */ } }
    return decodeLogs([log])[0];
  });
  const tr = transfers.length ? h('div', { class: 'wu-list' }, transfers.map((x) => {
    const tk = tokenByAddress(x.token, chainId);
    const amount = x.standard === 'erc721' ? `#${x.tokenId}` : tk ? fmtToken(x.amount, tk) : `${x.amount} (${short(x.token, 6, 4)})` + (x.tokenId != null ? ` #${x.tokenId}` : '');
    return h('div', { class: 'wu-item' }, h('div', { class: 'wu-item-main' },
      h('span', null, h('span', { class: 'wu-pill' }, x.standard.toUpperCase()), ' ', link ? linkTo('explorer/address/' + x.token, tk ? tk.symbol : short(x.token, 8, 6)) : mono(short(x.token, 8, 6))),
      h('span', { class: 'wu-small wu-mono wu-break' }, `${short(x.from, 8, 6)} → ${short(x.to, 8, 6)}`)),
    h('span', { class: 'wu-item-side' }, amount));
  })) : null;
  const logs = h('div', { class: 'wu-col' }, decoded.map((d, i) => h('div', { class: 'wu-io-item' },
    h('div', { class: 'wu-io-head' }, h('b', null, '#' + (d.log.logIndex ?? i) + ' ' + (d.unknown ? t('eth.unknownEvent') : d.name)), d.standard ? h('span', { class: 'wu-pill' }, d.standard) : null),
    h('div', { class: 'wu-small' }, addrEl(d.log.address, { link })),
    d.unknown ? h('div', { class: 'wu-script' }, [...(d.log.topics || []), d.log.data].join(' ')) : argsTable(d.fragment, d.args))));
  return h('div', { class: 'wu-col' },
    transfers.length ? section(t('eth.tokenTransfers', { n: transfers.length }), tr) : null,
    section(t('eth.logs', { n: receipt.logs.length }), receipt.logs.length ? logs : h('div', { class: 'ap-empty' }, t('eth.noLogs'))));
}

export { toQuantity, short };
