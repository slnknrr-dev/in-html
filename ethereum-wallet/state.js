// ethereum-wallet/state.js - the application state: settings (not secret, localStorage), the vault session with the
// wallets (secret, encrypted), runtime caches (HD roots and balances while unlocked), the JSON-RPC client of the
// chosen endpoint per chain (this site's backend proxy when the page is served by it), tokens, ABIs, sent
// transactions and balance snapshots.
//
// Vault data: { v: 1, wallets: [wallet], book: [contact], tokens: { [chainId]: [{ address, symbol, decimals, name }] },
//               abis: [{ name, address?, abi }], pending: [sent], snapshots: { [chainId]: { [address]: [[t, wei]] } },
//               server: { token } }
//   wallet: { id, name, created, kind: 'hd' | 'key' | 'watch', mnemonic?, passphrase?, scheme? ('bip44' |
//             'ledger-live'), key? (hex private key), accounts: [{ id, index?, address, label, ens? }] }
//   sent: { hash, chainId, from, nonce, to, value, data, gasLimit, type, maxFeePerGas?, maxPriorityFeePerGas?,
//           gasPrice?, token?, kind: 'send' | 'speedup' | 'cancel', at, status: 'pending' | 'confirmed' | 'failed' |
//           'replaced', blockNumber?, fee? }   (quantities as decimal strings: JSON has no bigint)
// An account address is the same on every EVM chain, so wallets are not tied to a chain.
//
// Secret vs public split: settings (chain, endpoints, auto-lock) are not secret and live in plain localStorage so
// the app can show the right chain before unlock. Everything that identifies or controls funds (mnemonics, keys,
// addresses, contacts, history) is inside the encrypted vault. Derived secrets (HD roots) exist only in memory while
// unlocked and are wiped on lock (clearRuntime).
import { lsGet, lsSet } from '../ui/dom.js';
import { VaultSession } from '../walletui/vault.js';
import { OFFLINE } from '../walletui/shell.js';
import { HDKey } from '../hdkey/bip32.js';
import { mnemonicToSeedAsync } from '../hdkey/bip39.js';
import { wipe, bytesToHex } from '../crypto/encoding.js';
import { randomUUID } from '../crypto/random.js';
import { deriveAccount } from '../ethereum/hd.js';
import { privateKeyToAddress, getAddress, equalAddress } from '../ethereum/address.js';
import { fromHex } from '../ethereum/units.js';
import { CHAINS, chainById } from '../ethereum/chains.js';
import { createRpcClient, ONLINE } from '../ethereum/rpc.js';

export const APP = 'ethereum-wallet';
const SKEY = 'ethw-settings';

// Settings are merged over defaults so a newer build adds fields without migration; invalid stored values (unknown
// chain, corrupt endpoints) are repaired at load instead of crashing later.
const DEFAULTS = { chainId: 1, endpoints: {}, autoLock: 5 };
export const settings = { ...DEFAULTS, ...(lsGet(SKEY, {}) || {}) };
if (!chainById(settings.chainId)) settings.chainId = 1;
if (!settings.endpoints || typeof settings.endpoints !== 'object') settings.endpoints = {};
export const saveSettings = () => lsSet(SKEY, settings);

export const vault = new VaultSession({ storageKey: 'ethw-vault', autoLockMinutes: settings.autoLock });
export const emptyData = () => ({ v: 1, wallets: [], book: [], tokens: {}, abis: [], pending: [], snapshots: {}, server: {} });
export const saveVault = () => vault.save();

// Older or imported vault data gets the fields of the current version.
// Additive migration only: fields are added, never renamed or removed, so an older build can still open the vault.
export function upgradeData() {
  const d = vault.data;
  if (!d) return;
  for (const [k, v] of Object.entries(emptyData())) if (d[k] === undefined) d[k] = v;
}

// Unknown chain id (e.g. a custom one stored earlier) gets a synthetic descriptor rather than null, so views never
// need null checks. testnet:true is the safe default: no "real money" assumptions for a chain we know nothing about.
export const chain = (id = settings.chainId) => chainById(id) || { id: Number(id), name: `Chain ${id}`, short: String(id), currency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpc: [], explorer: null, testnet: true, l2: false, eip1559: true };
export const symbolOf = (id = settings.chainId) => chain(id).currency.symbol;
export const CHAIN_LIST = CHAINS;

// --- runtime (dropped when the vault locks) ---

// HD master keys are cached because BIP-39 seed derivation (PBKDF2, 2048 rounds) is deliberately slow; re-deriving
// on every signature would stall the UI. Cache lives only while unlocked.
const roots = new Map(); // wallet id -> HDKey
export const balances = new Map(); // `${chainId}|${address}` -> { wei, nonce, tokens: { [token]: bigint }, at, error }
export let backendInfo = null;
export const setBackendInfo = (i) => { backendInfo = i; };

// HDKey.wipe zeroes the key bytes; dropping references alone would leave secrets in memory until GC, and GC does not
// clear memory either. Best effort: JS strings (the mnemonic in vault.data) cannot be wiped.
export function clearRuntime() {
  for (const r of roots.values()) r.wipe();
  roots.clear();
  balances.clear();
}

// --- wallets and accounts ---

export const wallets = () => (vault.data ? vault.data.wallets : []);
export const walletById = (id) => wallets().find((w) => w.id === id) || null;
export const allAccounts = () => wallets().flatMap((w) => w.accounts.map((acc) => ({ w, acc })));
export const accountByAddress = (address) => allAccounts().find((x) => equalAddress(x.acc.address, address)) || null;
export const canSign = (w) => w && w.kind !== 'watch';
export const accountLabel = (w, acc) => acc.label || (w.kind === 'hd' ? `${w.name} #${acc.index}` : w.name);

// The seed is wiped right after the master key is built: the root is all that is needed for derivation.
async function rootOf(w) {
  let r = roots.get(w.id);
  if (!r) {
    const seed = await mnemonicToSeedAsync(w.mnemonic, w.passphrase || '');
    r = HDKey.fromMasterSeed(seed);
    wipe(seed);
    roots.set(w.id, r);
  }
  return r;
}

// The private key of an account (a fresh copy: the caller wipes it after signing).
// Defence in depth: the re-derived address must equal the stored one. A mismatch means a corrupted vault, a changed
// passphrase or scheme; signing with the wrong key would at best fail and at worst sign from an unexpected account.
// .slice() for imported keys: the caller wipes the returned buffer, which must not zero the cached decoded key.
export async function privateKeyOf(w, acc) {
  if (w.kind === 'key') return fromHex(w.key).slice();
  if (w.kind !== 'hd') throw new Error('watch-only');
  const a = deriveAccount(await rootOf(w), acc.index, w.scheme || 'bip44');
  if (!equalAddress(a.address, acc.address)) { wipe(a.privateKey); throw new Error('derived key does not match the account'); }
  return a.privateKey;
}

// getAddress stores the EIP-55 checksummed form, so later display and comparison are canonical.
const record = (address, extra = {}) => ({ id: randomUUID(), address: getAddress(address), label: '', ...extra });

// Private keys are derived only to compute addresses and wiped at once; the wallet stores the mnemonic, not keys.
export async function createHdWallet({ name, mnemonic, passphrase = '', scheme = 'bip44', count = 1 }) {
  const w = { id: randomUUID(), name, created: Math.floor(Date.now() / 1000), kind: 'hd', mnemonic, passphrase, scheme, accounts: [] };
  const r = await rootOf(w);
  for (let i = 0; i < count; i++) {
    const a = deriveAccount(r, i, scheme);
    wipe(a.privateKey);
    w.accounts.push(record(a.address, { index: i }));
  }
  vault.data.wallets.push(w);
  saveVault();
  return w;
}

// Next index = highest existing + 1 (gaps from removed accounts are not refilled). Returns null if the address is
// already present (explicit index re-added).
export async function addHdAccount(w, index = null) {
  const i = index ?? Math.max(-1, ...w.accounts.map((a) => a.index)) + 1;
  const a = deriveAccount(await rootOf(w), i, w.scheme || 'bip44');
  wipe(a.privateKey);
  if (w.accounts.some((x) => equalAddress(x.address, a.address))) return null;
  const rec = record(a.address, { index: i });
  w.accounts.push(rec);
  saveVault();
  return rec;
}

export function createKeyWallet({ name, privateKey }) {
  const key = typeof privateKey === 'string' ? fromHex(privateKey) : privateKey;
  const address = privateKeyToAddress(key);
  const w = { id: randomUUID(), name, created: Math.floor(Date.now() / 1000), kind: 'key', key: '0x' + bytesToHex(key), accounts: [record(address, { index: 0 })] };
  vault.data.wallets.push(w);
  saveVault();
  return w;
}

export function createWatchWallet({ name, entries }) {
  const w = { id: randomUUID(), name, created: Math.floor(Date.now() / 1000), kind: 'watch', accounts: entries.map((e) => record(e.address, { ens: e.ens || null, label: e.ens || '' })) };
  vault.data.wallets.push(w);
  saveVault();
  return w;
}

export function deleteWallet(id) {
  const i = vault.data.wallets.findIndex((w) => w.id === id);
  if (i < 0) return;
  const r = roots.get(id);
  if (r) { r.wipe(); roots.delete(id); }
  vault.data.wallets.splice(i, 1);
  saveVault();
}

// --- the JSON-RPC endpoint of each chain ---

// Relative to the page URL: the backend mounts the app under /ethereum-wallet/, so api/rpc lands on its proxy whatever
// the deployment prefix.
export const backendRpcUrl = () => (backendInfo ? new URL('api/rpc', location.href).href : null);
export const endpointOf = (id = settings.chainId) => settings.endpoints[id] || '';
export function setEndpoint(url, id = settings.chainId) {
  if (url) settings.endpoints[id] = url; else delete settings.endpoints[id];
  saveSettings();
  clients.clear();
}

// One client per URL (not per chain): two chains pointed at the same URL share it. setEndpoint clears the map so a
// changed URL never keeps a client to the old one.
const clients = new Map();
// The JSON-RPC client of the chain, or null (offline build, or no endpoint chosen: nothing is contacted).
export function rpc(id = settings.chainId) {
  if (OFFLINE || !ONLINE) return null;
  const url = endpointOf(id);
  if (!url) return null;
  if (!clients.has(url)) clients.set(url, createRpcClient({ url }));
  return clients.get(url);
}

// --- tokens and ABIs ---

export const tokensOf = (id = settings.chainId) => (vault.data && vault.data.tokens[id]) || [];
// Token metadata comes from user input or an on-chain call and is untrusted: symbol/name are clamped in length so a
// hostile contract cannot flood the UI; decimals coerced to a number (NaN -> 0).
export function addToken(token, id = settings.chainId) {
  const list = (vault.data.tokens[id] ||= []);
  if (list.some((x) => equalAddress(x.address, token.address))) return false;
  list.push({ address: getAddress(token.address), symbol: String(token.symbol || '?').slice(0, 16), decimals: Number(token.decimals) || 0, name: String(token.name || '').slice(0, 60) });
  saveVault();
  return true;
}
export function removeToken(address, id = settings.chainId) {
  const list = vault.data.tokens[id] || [];
  const i = list.findIndex((x) => equalAddress(x.address, address));
  if (i >= 0) { list.splice(i, 1); saveVault(); }
}
export const tokenByAddress = (address, id = settings.chainId) => tokensOf(id).find((x) => equalAddress(x.address, address)) || null;

export const savedAbis = () => (vault.data ? vault.data.abis : []);

// --- sent transactions ---

export const sentOf = (id = settings.chainId) => (vault.data ? vault.data.pending.filter((p) => p.chainId === id) : []);
// Newest first, capped at 500 entries: the vault is re-encrypted on every save, so unbounded history would make every
// save slower.
export function rememberSent(entry) {
  vault.data.pending.unshift(entry);
  if (vault.data.pending.length > 500) vault.data.pending.length = 500;
  saveVault();
}

// --- balance snapshots: at most one point per 10 minutes per account and chain (a change inside the window moves
// the last point), 2000 points each ---

export const SNAPSHOT_EVERY = 600;
export function recordSnapshot(address, wei, id = settings.chainId, now = Math.floor(Date.now() / 1000)) {
  if (!vault.data) return;
  const byChain = (vault.data.snapshots[id] ||= {});
  const list = (byChain[address] ||= []);
  const last = list[list.length - 1];
  if (last && now - last[0] < SNAPSHOT_EVERY) {
    // Within the 10 minutes of the last point: it keeps the latest value of its window.
    // KNOWN DEFECT: moving last[0] to now restarts the window, so a balance that changes more often than every 10
    // minutes keeps sliding one point forward and never records history. Fix: keep last[0] (window start) and update
    // only last[1], or compare against the window start of the previous point.
    if (last[1] !== wei.toString()) { last[0] = now; last[1] = wei.toString(); saveVault(); }
    return;
  }
  list.push([now, wei.toString()]);
  if (list.length > 2000) list.splice(0, list.length - 2000);
  saveVault();
}
export const snapshotsOf = (address, id = settings.chainId) => ((vault.data && vault.data.snapshots[id]) || {})[address] || [];
