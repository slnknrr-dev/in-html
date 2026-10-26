// bitcoin-wallet/state.js - the application state: settings (not secret, localStorage), the vault session with the
// wallets (secret, encrypted), runtime caches (master keys while unlocked, synchronisation results), the data source
// (an Esplora client for the chosen server or this site's backend), labels and the address book.
//
// Vault data: { v: 1, wallets: [wallet], book: [contact], labels: [BIP-329 record] }
//   wallet: { id, name, network, created, kind: 'hd' | 'watch', mnemonic?, passphrase?, fingerprint?,
//             accounts: [{ id, type, index?, label, receive, change, xpub?, addresses? }] }
//     receive / change: descriptors (public); type 'addresses' accounts list fixed addresses instead.
//
// Security split (the central decision of this module):
// - settings: plain localStorage, contains nothing an attacker could use (network, unit, server URLs).
// - vault: walletui/vault.js VaultSession, encrypted at rest with the user's password; holds mnemonics, passphrases,
//   descriptors, labels, contacts. Decrypted data exists only in memory while unlocked; auto-lock after N minutes.
// - masters: derived BIP-32 master keys, memory only, wiped (zeroed) on lock and on wallet deletion. Re-deriving from
//   the mnemonic costs a PBKDF2 run (2048 rounds of HMAC-SHA512), hence the cache while unlocked.
// Descriptors (public) are stored per account so watch-only views and sync never need the master key.
import { lsGet, lsSet } from '../ui/dom.js';
import { VaultSession } from '../walletui/vault.js';
import { HDKey } from '../hdkey/bip32.js';
import { mnemonicToSeedAsync } from '../hdkey/bip39.js';
import { wipe, bytesToHex } from '../crypto/encoding.js';
import { randomUUID } from '../crypto/random.js';
import { Account, deriveAccount } from '../bitcoin/account.js';
import { NETWORKS } from '../bitcoin/networks.js';
import { toOutputScript, fromOutputScript } from '../bitcoin/address.js';
import { createEsploraClient, ONLINE } from '../bitcoin/esplora.js';
import { OFFLINE } from '../walletui/shell.js';

export const APP = 'bitcoin-wallet';
const SKEY = 'btcw-settings';

// Settings merged over defaults at load: new settings added in later versions get their default without migration.
// An unknown network (renamed / removed) falls back to mainnet instead of crashing every NETWORKS[...] lookup.
const DEFAULTS = { network: 'mainnet', endpoints: {}, unit: 'BTC', autoLock: 5, gapLimit: 20 };
export const settings = { ...DEFAULTS, ...(lsGet(SKEY, {}) || {}) };
if (!NETWORKS[settings.network]) settings.network = 'mainnet';
export const saveSettings = () => lsSet(SKEY, settings);

// autoLockMinutes is read once at startup; settings.js updates the running session through vaultSettings.
export const vault = new VaultSession({ storageKey: 'btcw-vault', autoLockMinutes: settings.autoLock });
export const emptyData = () => ({ v: 1, wallets: [], book: [], labels: [] });
export const data = () => vault.data;
export const saveVault = () => vault.save();

// Runtime only: master keys of unlocked HD wallets and sync results per account.
const masters = new Map();
// Sync results are cache, not state: cleared on lock (clearRuntime) so no balances linger in memory for a locked app.
export const syncCache = new Map(); // accountId -> { scan, history, at, error }
export let backendInfo = null;
export const setBackendInfo = (i) => { backendInfo = i; };

// Called on lock: wipe() overwrites key bytes in place. JS cannot guarantee no copies exist (GC may have moved
// them), but zeroing the live buffers shortens the window in which a memory dump reveals keys.
export function clearRuntime() {
  for (const m of masters.values()) m.wipe();
  masters.clear();
  syncCache.clear();
}

export const wallets = () => (vault.data ? vault.data.wallets : []);
export const walletsOfNetwork = (net = settings.network) => wallets().filter((w) => w.network === net);
export const walletById = (id) => wallets().find((w) => w.id === id) || null;

// mnemonicToSeedAsync: the async variant yields to the event loop (WebCrypto PBKDF2), so the UI does not freeze
// during the 2048-round derivation. The seed is wiped right after deriving the master key: only the key is cached.
export async function masterOf(wallet) {
  if (wallet.kind !== 'hd') return null;
  let m = masters.get(wallet.id);
  if (!m) {
    const seed = await mnemonicToSeedAsync(wallet.mnemonic, wallet.passphrase || '');
    m = HDKey.fromMasterSeed(seed);
    wipe(seed);
    masters.set(wallet.id, m);
  }
  return m;
}

// Account objects of bitcoin/account.js (cached per account id; descriptors are public data).
// The key includes network and descriptor text, so an edited account or a network switch never reuses a stale
// object. Parsing descriptors and deriving scripts is costly; views call accountOf on every render.
const accountObjects = new Map();
export function accountOf(wallet, acc) {
  const key = wallet.network + '|' + acc.id + '|' + (acc.receive || (acc.addresses || []).join(','));
  let a = accountObjects.get(key);
  if (!a) {
    a = acc.type === 'addresses' ? addressAccount(acc.addresses, wallet.network) : Account.fromDescriptors(acc.receive, acc.change, { network: wallet.network });
    accountObjects.set(key, a);
  }
  return a;
}

// A watch-only "account" of fixed addresses with the interface sync.js and the views use.
// Out-of-range indexes fall back to the first address/last script instead of throwing: sync.js scans exactly
// `fixed` indexes (gapLimit = list length), so the fallback is only a guard against off-by-one callers.
// change: null and spendInfo: () => null mark it as receive-only and unsignable.
function addressAccount(addresses, network) {
  const scripts = addresses.map((a) => toOutputScript(a, network));
  return {
    type: 'addresses', network, change: null, fixed: addresses.length,
    address: (chain, i) => (chain === 0 && i < addresses.length ? addresses[i] : fromOutputScript(scripts[0], network)),
    script: (chain, i) => scripts[Math.min(i, scripts.length - 1)],
    spendInfo: () => null,
  };
}

// Default account types: native segwit (BIP-84) first as the recommended receive type, taproot (BIP-86), nested
// segwit (BIP-49) and legacy (BIP-44) so funds sent by older wallets to any of the four derivations are found.
// fingerprint = first 4 bytes of HASH160(master pubkey), needed in PSBTs so hardware signers recognise their keys.
export async function createHdWallet({ name, mnemonic, passphrase = '', network = settings.network, types = ['p2wpkh', 'p2tr', 'p2sh-p2wpkh', 'p2pkh'] }) {
  const w = { id: randomUUID(), name, network, created: Math.floor(Date.now() / 1000), kind: 'hd', mnemonic, passphrase, accounts: [] };
  const m = await masterOf(w);
  w.fingerprint = m.fingerprint.toString(16).padStart(8, '0');
  for (const type of types) w.accounts.push(accountRecord(deriveAccount(m, { type, network, account: 0 }), type, 0));
  vault.data.wallets.push(w);
  saveVault();
  return w;
}

// Descriptor in single-path form: [receive, change]. xpub stored in SLIP-132 form (zpub/ypub) when available,
// because other wallets expect that prefix to know the script type on import.
export function accountRecord(acc, type, index) {
  const d = acc.descriptor({ multipath: false });
  const [receive, change] = Array.isArray(d) ? d : [d, null];
  return { id: randomUUID(), type, index, label: '', receive, change, xpub: acc.slip132 || acc.xpub || null };
}

export async function addHdAccount(wallet, type, index) {
  const m = await masterOf(wallet);
  wallet.accounts.push(accountRecord(deriveAccount(m, { type, network: wallet.network, account: index }), type, index));
  saveVault();
}

// Watch-only from (a) a list of addresses, (b) an extended public key (type inferred from its version prefix),
// (c) explicit descriptors. No private material is ever stored for kind 'watch'.
export function createWatchWallet({ name, network = settings.network, xpub = null, receive = null, change = null, addresses = null }) {
  const w = { id: randomUUID(), name, network, created: Math.floor(Date.now() / 1000), kind: 'watch', accounts: [] };
  if (addresses) w.accounts.push({ id: randomUUID(), type: 'addresses', label: '', addresses });
  else if (xpub) {
    const a = Account.fromExtendedKey(xpub, { network });
    w.accounts.push(accountRecord(a, a.type, 0));
  } else {
    const a = Account.fromDescriptors(receive, change, { network });
    const rec = accountRecord(a, a.type, 0);
    w.accounts.push(rec);
  }
  vault.data.wallets.push(w);
  saveVault();
  return w;
}

// Deleting also wipes the cached master key and the account caches, not just the vault record.
export function deleteWallet(id) {
  const i = vault.data.wallets.findIndex((w) => w.id === id);
  if (i >= 0) {
    const w = vault.data.wallets[i];
    const m = masters.get(w.id);
    if (m) { m.wipe(); masters.delete(w.id); }
    for (const a of w.accounts) syncCache.delete(a.id);
    vault.data.wallets.splice(i, 1);
    saveVault();
  }
}

// --- the data source -------------------------------------------------------------------------------

// Backend mode: the site's own backend proxies Esplora at a relative URL, so the app works behind any base path.
export const backendEsplora = () => (backendInfo ? new URL('api/esplora', location.href).href : null);
export const endpointOf = (net = settings.network) => settings.endpoints[net] || '';
// Clearing the client cache forces a new client for the new URL (clients may hold per-server state).
export function setEndpoint(url, net = settings.network) { settings.endpoints[net] = url; saveSettings(); sources.clear(); }

const sources = new Map();
// An Esplora client for the network, or null (offline build, or no server chosen).
// Two independent offline switches: OFFLINE (walletui build flag) and ONLINE (bitcoin/esplora.js variant). Either
// one disables every network request, so an offline artifact cannot leak addresses to a server even if configured.
export function source(net = settings.network) {
  if (OFFLINE || !ONLINE) return null;
  const url = endpointOf(net);
  if (!url) return null;
  if (!sources.has(url)) sources.set(url, createEsploraClient({ url }));
  return sources.get(url);
}

// --- labels (BIP-329 records in the vault) ---------------------------------------------------------
// BIP-329 is the wallet-label interchange format: { type: tx | addr | output | ..., ref, label, spendable? }.
// Storing labels in that shape makes import/export a plain copy. Freezing a coin is a label with spendable:false,
// exactly how BIP-329 encodes it. Lookups are linear: label lists are small and this keeps one source of truth.

export function labelOf(type, ref) {
  const r = vault.data && vault.data.labels.find((l) => l.type === type && l.ref === ref);
  return r ? r.label || '' : '';
}

export function setLabel(type, ref, label, extra = {}) {
  const list = vault.data.labels;
  const i = list.findIndex((l) => l.type === type && l.ref === ref);
  // Empty label and no extra fields: the record is removed (keeps exports free of empty records). Callers that edit
  // a frozen output's label pass { spendable: false } again so clearing the text does not unfreeze it.
  if (!label && !Object.keys(extra).length) { if (i >= 0) list.splice(i, 1); }
  else if (i >= 0) Object.assign(list[i], { label }, extra);
  else list.push({ type, ref, label, ...extra });
  saveVault();
}

export const isFrozen = (txid, vout) => !!(vault.data && vault.data.labels.find((l) => l.type === 'output' && l.ref === `${txid}:${vout}` && l.spendable === false));

export const scriptHexOf = (s) => bytesToHex(s);
