// bitcoin/account.js - HD wallet accounts: BIP-44 (P2PKH), BIP-49 (P2SH-P2WPKH), BIP-84 (P2WPKH) and BIP-86 (P2TR)
// accounts from a master key, and watch-only accounts from an extended public key (any SLIP-132 prefix) or from
// output descriptors (receive and change, or one BIP-389 <0;1> multipath descriptor). Every address comes with what
// a PSBT needs to spend from it.
//
//   accountPath(type, network, account = 0) -> "m/84'/0'/0'"      PURPOSE_TYPE, TYPE_PURPOSE, SCRIPT_TYPES
//   deriveAccount(master: HDKey, { type = 'p2wpkh', account = 0, network = 'mainnet' }) -> Account
//   Account.fromExtendedKey(text, { type, network, fingerprint, path }) (type and network from the SLIP-132 prefix)
//   Account.fromDescriptors(receive, change = null, { network }) (receive may be a <0;1> multipath descriptor)
//   account.address(chain, index), account.script(chain, index) (chain 0 = receive, 1 = change)
//   account.spendInfo(chain, index) -> { script, address, type, redeemScript?, witnessScript?, tapInternalKey?,
//     bip32Derivation?: [{ pubkey, fingerprint, path }], tapBip32Derivation?: [...] }
//   account.descriptor({ multipath = true }) (false: [receive, change]), account.xpub (standard xpub / tpub), account.slip132 (ypub / zpub / …),
//   account.fingerprint (of the master key), account.path, account.type, account.network, account.toJSON()
//   deriveAddress(spec: xpub | descriptor | address, index, network, { chain, type }) -> address (watch-only)
//   scriptType(script) -> 'p2pkh' | 'p2sh' | 'p2wpkh' | 'p2wsh' | 'p2tr' | …  (for fee estimates)
//
// Key derivation model: m / purpose' / coin_type' / account' / chain / index. The three hardened levels isolate
// accounts: a leaked child private key plus the account xpub reveals that account's xpriv (non-hardened derivation is
// invertible given the chain code), but never the master or other accounts. Everything below the account is
// non-hardened so a watch-only xpub can derive every address.
// Internally every account is a pair of descriptors (receive /0/*, change /1/*): one representation for xpub, SLIP-132
// and descriptor imports, and the origin [fingerprint/path] travels with the key into PSBT bip32Derivation fields,
// which is how hardware signers recognize their own inputs and change.
// SLIP-132 prefixes (ypub / zpub) encode the script type in the version bytes; the standard xpub form is stored and the
// script type kept separately, since descriptors made the SLIP-132 convention obsolete (and BIP-86 never got one).
import { HDKey, HARDENED, VERSIONS, formatPath, parsePath, extendedKeyPrefix } from '../hdkey/bip32.js';
import { network as netOf } from './networks.js';
import { parseDescriptor, addChecksum } from './descriptor.js';
import { fromOutputScript, toOutputScript as toScript } from './address.js';
import { classify } from './script.js';

export const PURPOSE_TYPE = { 44: 'p2pkh', 49: 'p2sh-p2wpkh', 84: 'p2wpkh', 86: 'p2tr' };
export const TYPE_PURPOSE = { p2pkh: 44, 'p2sh-p2wpkh': 49, p2wpkh: 84, p2tr: 86 };
export const SCRIPT_TYPES = Object.keys(TYPE_PURPOSE);
const SLIP132 = { 'p2pkh': 'x', 'p2sh-p2wpkh': 'y', p2wpkh: 'z', p2tr: 'x' };
const TEST_SLIP132 = { 'p2pkh': 't', 'p2sh-p2wpkh': 'u', p2wpkh: 'v', p2tr: 't' };

export function accountPath(type, network = 'mainnet', account = 0) {
  const purpose = TYPE_PURPOSE[type];
  if (!purpose) throw new Error(`unknown account type "${type}"`);
  return `m/${purpose}'/${netOf(network).coinType}'/${account}'`;
}

const fpHex = (fp) => (fp >>> 0).toString(16).padStart(8, '0');
const hpath = (indexes) => indexes.map((i) => (i >= HARDENED ? `${i - HARDENED}h` : String(i))).join('/');

function singleDescriptor(type, key) {
  switch (type) {
    case 'p2pkh': return `pkh(${key})`;
    case 'p2sh-p2wpkh': return `sh(wpkh(${key}))`;
    case 'p2wpkh': return `wpkh(${key})`;
    case 'p2tr': return `tr(${key})`;
    default: throw new Error(`unknown account type "${type}"`);
  }
}

export const scriptType = (script) => classify(script).type;

export class Account {
  // receive / change: Descriptor objects (ranged). meta: { type, network, fingerprint, path, xpub }.
  constructor(receive, change, meta = {}) {
    this.receive = receive;
    this.change = change;
    this.network = meta.network || receive.network;
    this.type = meta.type || receive.type;
    this.fingerprint = meta.fingerprint ?? null;
    this.path = meta.path ?? null;
    this.xpubKey = meta.xpub || null;
  }

  // neuter() first: even if an xprv is passed, the account keeps only public data (watch-only by construction).
  // The network implied by the prefix must match the requested one - deriving mainnet addresses from a tpub would
  // produce valid-looking addresses whose keys the signer files under coin type 1.
  // Path guess: a depth-3 key is assumed to be the standard account path of its type (purpose'/coin'/account');
  // pass `path` for any other layout, or PSBT origins will point signers at the wrong keys.
  static fromExtendedKey(text, { type = null, network = null, fingerprint = null, path = null, account = 0 } = {}) {
    const prefix = extendedKeyPrefix(text);
    if (!prefix) throw new Error('not an extended key');
    const info = VERSIONS[prefix];
    const k = HDKey.fromExtendedKey(text).neuter();
    const t = type || info.script;
    if (!TYPE_PURPOSE[t]) throw new Error(`a ${prefix} key is a ${info.script} multisig key: import it with a descriptor`);
    const net = network || (info.network === 'main' ? 'mainnet' : 'testnet');
    if ((netOf(net).testnet ? 'test' : 'main') !== info.network) throw new Error('the key belongs to another network');
    const xpub = k.toExtendedKey(info.network === 'main' ? 'xpub' : 'tpub');
    const pth = path ? parsePath(path) : (k.depth === 3 ? [TYPE_PURPOSE[t] + HARDENED, netOf(net).coinType + HARDENED, account + HARDENED] : null);
    // Without the master fingerprint the key has no origin: PSBTs then name the account key itself (its fingerprint,
    // paths relative to it), which signers holding the account key understand.
    const fp = typeof fingerprint === 'string' && fingerprint ? parseInt(fingerprint, 16) >>> 0 : fingerprint ?? null;
    const origin = fp !== null && pth ? `[${fpHex(fp)}/${hpath(pth)}]` : '';
    const recv = parseDescriptor(singleDescriptor(t, `${origin}${xpub}/0/*`), { network: net });
    const chg = parseDescriptor(singleDescriptor(t, `${origin}${xpub}/1/*`), { network: net });
    return new Account(recv, chg, { type: t, network: net, fingerprint: fp ?? null, path: pth ? formatPath(pth) : null, xpub });
  }

  // Private keys are refused: an account object is shared with sync / UI code that should never hold secrets.
  // The account path is inferred by dropping the last two steps (chain / index) of the first key's origin path.
  static fromDescriptors(receive, change = null, { network = 'mainnet' } = {}) {
    const r = typeof receive === 'string' ? parseDescriptor(receive, { network }) : receive;
    if (!r.isRange) throw new Error('a wallet descriptor must be ranged (end in /*)');
    if (r.hasPrivateKeys) throw new Error('watch-only descriptors must not contain private keys');
    let recv = r, chg = change ? (typeof change === 'string' ? parseDescriptor(change, { network }) : change) : null;
    if (r.multipath > 1) {
      if (r.multipath !== 2) throw new Error('a multipath wallet descriptor has two alternatives (receive;change)');
      [recv, chg] = r.split();
    }
    const keys = recv.expand(0).keys;
    const k0 = keys[0];
    return new Account(recv, chg, {
      type: recv.type, network, fingerprint: k0 && k0.fingerprint != null ? k0.fingerprint : null,
      path: k0 && k0.path.length > 2 ? formatPath(k0.path.slice(0, -2)) : null,
    });
  }

  chainDescriptor(chain) {
    if (chain === 1 && this.change) return this.change;
    if (chain === 1) throw new Error('this account has no change descriptor');
    return this.receive;
  }

  script(chain, index) { return this.chainDescriptor(chain).script(index); }

  address(chain, index) { return fromOutputScript(this.script(chain, index), this.network); }

  // Everything an updater puts into a PSBT input for this address (BIP-174 / 371 fields). Keys without an origin
  // (fingerprint null) are left out of the derivations - a signer cannot use a derivation it cannot match. m / n are
  // attached for multisig so fees.js can size the input.
  spendInfo(chain, index) {
    const e = this.chainDescriptor(chain).expand(index);
    const out = { chain, index, script: e.scripts[0], address: fromOutputScript(e.scripts[0], this.network), type: scriptType(e.scripts[0]) };
    if (e.redeemScript) out.redeemScript = e.redeemScript;
    if (e.witnessScript) out.witnessScript = e.witnessScript;
    const deriv = (k) => ({ pubkey: k.pubkey, fingerprint: k.fingerprint ?? 0, path: k.path });
    if (e.tapInternalKey) {
      out.tapInternalKey = e.tapInternalKey;
      if (e.tapMerkleRoot) out.tapMerkleRoot = e.tapMerkleRoot;
      out.tapBip32Derivation = e.keys.filter((k) => k.fingerprint != null).map((k) => ({ ...deriv(k), leafHashes: k.leafHashes || [] }));
      if (e.leaves) out.leaves = e.leaves;
    } else out.bip32Derivation = e.keys.filter((k) => k.fingerprint != null).map(deriv);
    if (out.type === 'p2wsh' || (out.redeemScript && out.witnessScript)) {
      const c = classify(out.witnessScript);
      if (c.type === 'multisig') { out.m = c.m; out.n = c.n; }
    } else if (out.redeemScript && classify(out.redeemScript).type === 'multisig') {
      const c = classify(out.redeemScript);
      out.m = c.m; out.n = c.n;
    }
    return out;
  }

  // The public descriptor of the account: one multipath descriptor <0;1> when both chains share a template.
  // Template test by text: split on '/0/*' and '/1/*' and compare the pieces, so only descriptors that differ
  // exactly in the chain step are merged (BIP-389); anything else stays two descriptors.
  descriptor({ multipath = true } = {}) {
    const r = this.receive.toString({ public: true, checksum: false });
    if (!this.change) return addChecksum(r);
    const c = this.change.toString({ public: true, checksum: false });
    if (!multipath) return [addChecksum(r), addChecksum(c)];
    const a = r.split('/0/*'), b = c.split('/1/*');
    if (a.length > 1 && a.length === b.length && a.join('|') === b.join('|')) return addChecksum(a.join('/<0;1>/*'));
    return [addChecksum(r), addChecksum(c)];
  }

  get xpub() { return this.xpubKey; }

  // SLIP-132 form of the account key (zpub for BIP-84, ypub for BIP-49, xpub otherwise).
  get slip132() {
    if (!this.xpubKey) return null;
    const p = (netOf(this.network).testnet ? TEST_SLIP132 : SLIP132)[this.type];
    return p ? HDKey.fromExtendedKey(this.xpubKey).toExtendedKey(p + 'pub') : this.xpubKey;
  }

  toJSON() {
    return { type: this.type, network: this.network, fingerprint: this.fingerprint, path: this.path, xpub: this.xpubKey, descriptor: this.descriptor() };
  }
}

// Watch-only address derivation for other applications (donation pages, invoices): the address at `index` of
// `spec`, which is an account-level extended public key (xpub / ypub / zpub / tpub / upub / vpub: the SLIP-132 prefix
// gives the script type, `type` overrides it, e.g. 'p2tr' for a BIP-86 xpub), a ranged output descriptor (with or
// without checksum; `<0;1>` multipath picks `chain`), or a plain address (returned for every index).
//   deriveAddress(spec, index = 0, network = 'mainnet', { chain = 0, type }) -> address (throws on invalid input)
export function deriveAddress(spec, index = 0, network = 'mainnet', { chain = 0, type = null } = {}) {
  const s = String(spec).trim();
  if (!Number.isInteger(index) || index < 0 || index >= HARDENED) throw new Error('index must be an integer 0..2^31-1');
  if (extendedKeyPrefix(s)) return Account.fromExtendedKey(s, { network, type }).address(chain, index);
  if (/^[a-z_]+\(/.test(s)) {
    const d = parseDescriptor(s, { network });
    if (d.hasPrivateKeys) throw new Error('the descriptor contains private keys');
    if (d.multipath > 1) return d.split()[chain].address(index);
    return d.isRange ? d.address(index) : d.address(0);
  }
  const net = netOf(network);
  try { if (fromOutputScript(toScript(s, net.name), net.name)) return s; } catch { /* below */ }
  throw new Error('expected an xpub, a descriptor or an address of this network');
}

// The only function that touches the master private key: it derives the hardened account path and immediately
// keeps only the neutered xpub plus the master fingerprint (the origin signers need).
export function deriveAccount(master, { type = 'p2wpkh', account = 0, network = 'mainnet' } = {}) {
  if (master.depth !== 0) throw new Error('the master key is needed');
  const path = accountPath(type, network, account);
  const k = master.derive(path).neuter();
  const net = netOf(network);
  return Account.fromExtendedKey(k.toExtendedKey(net.testnet ? 'tpub' : 'xpub'), { type, network, fingerprint: master.fingerprint, path });
}
