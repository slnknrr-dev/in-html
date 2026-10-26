// ethereum/hd.js - Ethereum accounts of BIP-32 / BIP-39 / BIP-44 wallets (coin type 60).
//
//   ETH_PATH = "m/44'/60'/0'/0"
//   ethPath(index, scheme = 'bip44') -> path
//       'bip44'         m/44'/60'/0'/0/<index>     (MetaMask, Trezor, Ledger Live "legacy" accounts of most wallets)
//       'ledger-live'   m/44'/60'/<index>'/0/0     (Ledger Live)
//       'ledger-legacy' m/44'/60'/0'/<index>       (Ledger Chrome app / MyEtherWallet "Ledger (legacy)")
//   deriveAccount(root: HDKey, index = 0, scheme = 'bip44') -> { path, index, privateKey (32 bytes),
//       publicKey (65 bytes, uncompressed), address (checksum) }
//   accountFromMnemonic(mnemonic, passphrase = '', index = 0, scheme = 'bip44') -> the same
//       (the phrase is not validated here: call hdkey/bip39.js validateMnemonic first)
//   deriveAddressFromXpub(xpub, index = 0, { path = '' }) -> checksum address (watch-only)
//   PATH_SCHEMES: ['bip44', 'ledger-live', 'ledger-legacy']
import { HDKey } from '../hdkey/bip32.js';
import { mnemonicToSeed } from '../hdkey/bip39.js';
import { getPublicKey } from '../crypto/secp256k1.js';
import { wipe } from '../crypto/encoding.js';
import { publicKeyToAddress } from './address.js';

export const ETH_PATH = "m/44'/60'/0'/0";
export const PATH_SCHEMES = Object.freeze(['bip44', 'ledger-live', 'ledger-legacy']);

// Three schemes exist because wallets disagreed on WHICH BIP-44 level the account index goes to; the same mnemonic
// gives different addresses under each, so a recovery tool must try all of them. 2^31 bound: indexes at or above it
// are the hardened range, encoded by the apostrophe, not by the number.
export function ethPath(index = 0, scheme = 'bip44') {
  if (!Number.isInteger(index) || index < 0 || index >= 0x80000000) throw new Error('account index must be an integer 0..2^31-1');
  switch (scheme) {
    case 'bip44': return `${ETH_PATH}/${index}`;
    case 'ledger-live': return `m/44'/60'/${index}'/0/0`;
    case 'ledger-legacy': return `m/44'/60'/0'/${index}`;
    default: throw new Error(`unknown derivation scheme ${scheme}`);
  }
}

// Copies the private key out before key.wipe(): the HDKey's own buffer is zeroed, the caller owns the copy.
export function deriveAccount(root, index = 0, scheme = 'bip44') {
  const path = ethPath(index, scheme);
  const key = root.derive(path);
  if (!key.privateKey) throw new Error('deriveAccount needs a private root key (hardened path)');
  const privateKey = Uint8Array.from(key.privateKey);
  const publicKey = getPublicKey(privateKey, false);
  key.wipe();
  return { path, index, privateKey, publicKey, address: publicKeyToAddress(publicKey) };
}

// Watch-only derivation (donation pages, invoices): the address at `index` below an extended public key, usually the
// chain key m/44'/60'/0'/0 (public keys cannot derive hardened steps); `path` adds normal steps first ('0' below an
// account key m/44'/60'/0').
//   deriveAddressFromXpub(xpub, index = 0, { path = '' }) -> checksum address
export function deriveAddressFromXpub(xpub, index = 0, { path = '' } = {}) {
  let k = HDKey.fromExtendedKey(xpub);
  if (path) k = k.derive(path);
  return publicKeyToAddress(k.deriveChild(index).publicKey);
}

// Seed and root are wiped in finally: the seed derives every account of the wallet, so it must not outlive the call.
// (JS cannot guarantee zeroing of copies made by the engine; wiping still shortens the exposure of our own buffers.)
export function accountFromMnemonic(mnemonic, passphrase = '', index = 0, scheme = 'bip44') {
  const seed = mnemonicToSeed(mnemonic, passphrase);
  const root = HDKey.fromMasterSeed(seed);
  wipe(seed);
  try { return deriveAccount(root, index, scheme); } finally { root.wipe(); }
}
