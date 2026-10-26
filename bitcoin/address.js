// bitcoin/address.js - Bitcoin addresses and private key strings: Base58Check (P2PKH, P2SH), Bech32 segwit v0
// (P2WPKH, P2WSH; BIP-173) and Bech32m v1+ (P2TR and future versions; BIP-350), WIF private keys, addresses from
// public keys and scripts.
//
//   toOutputScript(address, net?) -> scriptPubKey (throws: bad checksum, wrong network, invalid program)
//   fromOutputScript(script, net) -> address | null (scripts without an address: p2pk, multisig, OP_RETURN, …)
//   decodeAddress(address, net?) -> { type, network (name or a list for shared prefixes), hash | program, version, script }
//   isValidAddress(address, net?) -> boolean
//   addressOf(pubkey, type, net) with type 'p2pkh' | 'p2sh-p2wpkh' | 'p2wpkh' | 'p2tr' (BIP-86 key path, no scripts)
//   p2pkhAddress(pubkey, net), p2shP2wpkhAddress(pubkey, net), p2wpkhAddress(pubkey, net), p2trAddress(internalKey, net,
//   merkleRoot), p2shAddress(redeemScript, net), p2wshAddress(witnessScript, net), p2shP2wshAddress(witnessScript, net)
//   encodeWIF(priv, { compressed = true, network }), decodeWIF(text) -> { privateKey, compressed, network }
//   ADDRESS_TYPES: the single-key types with labels
// net: a network name of networks.js or its parameter object; default mainnet.
//
// Security-relevant decisions:
// - An address is an encoding of an output script, nothing more. Every decoder ends in `script`, and every encoder
//   starts from a script (fromOutputScript), so there is one path from bytes to text and no second, divergent one.
// - Checksums: Base58Check = first 4 bytes of SHA-256d (detects typos with ~2^-32 miss rate); bech32 / bech32m = BCH
//   code guaranteeing detection of up to 4 substitution errors. Bech32 (BIP-173) for witness v0 and bech32m (BIP-350)
//   for v1+ are enforced *both ways*: BIP-350 exists because bech32 has a length-extension weakness (inserting /
//   deleting 'q' before a final 'p' keeps the checksum valid), harmless for fixed-length v0 programs but fatal for
//   variable-length future versions. Accepting the wrong variant would reopen exactly that hole.
// - Program rules (BIP-141): version 0..16, program 2..40 bytes, v0 exactly 20 (P2WPKH) or 32 (P2WSH). Unknown v1+
//   programs are valid addresses ('witness_unknown'): sending to them is anyone-can-spend until a soft fork defines
//   them, which is why wallets should warn - but rejecting them would break forward compatibility (BIP-350 rationale).
// - Network: with `net` given, an address of another network is an error, not a warning. Funds sent to a testnet
//   address from a mainnet wallet would be decoded to a valid mainnet *script* (same hash) - the network check is the
//   only thing stopping it.
// - Segwit requires compressed keys (BIP-143 policy, WITNESS_PUBKEYTYPE): a P2WPKH of an uncompressed key is
//   non-standard to spend, i.e. coins stuck behind non-relayable transactions. needCompressed fails early.
import { sha256 } from '../crypto/sha2.js';
import { ripemd160 } from '../crypto/ripemd.js';
import { concatBytes } from '../crypto/encoding.js';
import { base58checkDecode, base58checkEncode } from '../crypto/base58check.js';
import { bech32Decode, bech32Encode, fromWords, toWords } from '../codec/bech32.js';
import { isValidPrivateKey, isValidPublicKey, taprootOutputKey } from '../crypto/secp256k1.js';
import { NETWORKS, network } from './networks.js';
import * as S from './script.js';

// HASH160 = RIPEMD-160(SHA-256(x)): 20-byte commitments for P2PKH / P2SH / P2WPKH (160-bit collision resistance
// ~2^80, which is why multi-party P2SH is considered weaker than 32-byte P2WSH). HASH256 = double SHA-256 (txids).
export const hash160 = (b) => ripemd160(sha256(b));
export const hash256 = (b) => sha256(sha256(b));

// Single-key types with their BIP-43 purpose (44 / 49 / 84 / 86): the purpose fixes the script type per account, so
// restoring a seed scans the right script for each derivation tree.
export const ADDRESS_TYPES = {
  p2pkh: { label: 'Legacy (P2PKH)', purpose: 44 },
  'p2sh-p2wpkh': { label: 'Nested SegWit (P2SH-P2WPKH)', purpose: 49 },
  p2wpkh: { label: 'Native SegWit (P2WPKH)', purpose: 84 },
  p2tr: { label: 'Taproot (P2TR)', purpose: 86 },
};

// Witness version is its own 5-bit word (not packed with the program), then the program regrouped 8 -> 5 bits.
function encodeSegwit(hrp, version, program) {
  const words = [version, ...toWords(program)];
  return bech32Encode(hrp, words, version === 0 ? 'bech32' : 'bech32m');
}

// Base58Check payloads and segwit programs of every network, for decoding.
function base58Networks(version) {
  const out = [];
  for (const n of Object.values(NETWORKS)) {
    if (n.pubKeyHash === version) out.push([n.name, 'p2pkh']);
    if (n.scriptHash === version) out.push([n.name, 'p2sh']);
  }
  return out;
}

export function decodeAddress(address, net = null) {
  const a = String(address).trim();
  const want = net ? network(net) : null;
  // Bech32 / Bech32m: the part before the last '1' is a known prefix (bc, tb, bcrt). lastIndexOf: '1' is legal in the
  // HRP charset but not in the data charset, so the last one is the separator. Dispatch by HRP, not by trying both
  // decoders: valid Base58 addresses start with 1 / 3 / m / n / 2, so they never yield a known HRP, and trying
  // bech32 first with a Base58 fallback would turn a bech32 typo into a confusing "invalid Base58" error.
  const low = a.toLowerCase();
  const sep = low.lastIndexOf('1');
  const hrp = sep > 0 ? low.slice(0, sep) : '';
  if (Object.values(NETWORKS).some((n) => n.bech32 === hrp)) {
    let d;
    try { d = bech32Decode(a); } catch (e) { throw new Error('invalid address: ' + e.message); }
    {
      const nets = Object.values(NETWORKS).filter((n) => n.bech32 === d.hrp).map((n) => n.name);
      if (want && want.bech32 !== d.hrp) throw new Error(`address of another network (${d.hrp})`);
      if (!d.words.length) throw new Error('empty witness program');
      const version = d.words[0];
      if (version > 16) throw new Error('invalid witness version');
      const program = fromWords(d.words.slice(1));
      if (program.length < 2 || program.length > 40) throw new Error('invalid witness program length');
      if (version === 0 && program.length !== 20 && program.length !== 32) throw new Error('invalid segwit v0 program length');
      if ((version === 0) !== (d.variant === 'bech32')) throw new Error(version === 0 ? 'segwit v0 needs bech32' : 'segwit v1+ needs bech32m');
      const type = version === 0 ? (program.length === 20 ? 'p2wpkh' : 'p2wsh') : version === 1 && program.length === 32 ? 'p2tr' : 'witness_unknown';
      return { type, network: want ? want.name : nets.length === 1 ? nets[0] : nets, version, program, hash: version === 0 ? program : undefined, script: S.witnessProgram(version, program) };
    }
  }
  // Base58Check: 1 version byte + 20-byte hash. The version bytes of P2PKH / P2SH never collide across types
  // (0x00 / 0x05 / 0x6f / 0xc4), so matches[0] gives the type; only the network can be ambiguous (test chains).
  let payload;
  try { payload = base58checkDecode(a); } catch (e) { throw new Error('invalid address: ' + e.message); }
  if (payload.length !== 21) throw new Error('invalid address length');
  const matches = base58Networks(payload[0]).filter(([n]) => !want || n === want.name);
  if (!matches.length) throw new Error(want ? 'address of another network' : 'unknown address version');
  const type = matches[0][1];
  const hash = payload.subarray(1);
  const nets = [...new Set(matches.map((m) => m[0]))];
  return { type, network: nets.length === 1 ? nets[0] : nets, hash, script: type === 'p2pkh' ? S.p2pkh(hash) : S.p2sh(hash) };
}

export const toOutputScript = (address, net = null) => decodeAddress(address, net).script;

export function isValidAddress(address, net = null) {
  try { decodeAddress(address, net); return true; } catch { return false; }
}

// Inverse of decodeAddress. P2PK, bare multisig and OP_RETURN have no address form (null, not a throw: explorers
// list such outputs as "non-standard / no address"). 'anchor' is P2A (OP_1 <0x4e73>, Core 28 ephemeral anchors):
// a v1 witness program, so it does have a bech32m address (bc1pfeessrawgf).
export function fromOutputScript(script, net = 'mainnet') {
  const n = network(net);
  const c = S.classify(script);
  switch (c.type) {
    case 'p2pkh': return base58checkEncode(concatBytes(Uint8Array.of(n.pubKeyHash), c.hash));
    case 'p2sh': return base58checkEncode(concatBytes(Uint8Array.of(n.scriptHash), c.hash));
    case 'p2wpkh': case 'p2wsh': case 'p2tr': case 'anchor': case 'witness_unknown': return encodeSegwit(n.bech32, c.version, c.program);
    default: return null;
  }
}

const needPub = (pub) => { if (!isValidPublicKey(pub)) throw new Error('invalid public key'); return pub; };
const needCompressed = (pub) => { if (needPub(pub).length !== 33) throw new Error('segwit needs a compressed public key'); return pub; };

export const p2pkhAddress = (pub, net) => fromOutputScript(S.p2pkh(hash160(needPub(pub))), net);
export const p2wpkhAddress = (pub, net) => fromOutputScript(S.p2wpkh(hash160(needCompressed(pub))), net);
export const p2shP2wpkhRedeemScript = (pub) => S.p2wpkh(hash160(needCompressed(pub)));
export const p2shP2wpkhAddress = (pub, net) => fromOutputScript(S.p2sh(hash160(p2shP2wpkhRedeemScript(pub))), net);
export const p2shAddress = (redeemScript, net) => fromOutputScript(S.p2sh(hash160(redeemScript)), net);
export const p2wshAddress = (witnessScript, net) => fromOutputScript(S.p2wsh(sha256(witnessScript)), net);
export const p2shP2wshAddress = (witnessScript, net) => fromOutputScript(S.p2sh(hash160(S.p2wsh(sha256(witnessScript)))), net);

// The x-only internal key of a 32-byte x-only or 33-byte compressed public key. Dropping the parity byte is lossless
// for taproot: BIP-340 lift_x always picks the even-y point, and BIP-341 tweaking works on that point (a signer with
// an odd-y key negates its secret; see secp256k1.js taprootTweakPrivateKey).
export const xOnly = (pub) => (pub.length === 32 ? pub : needCompressed(pub).subarray(1));

// P2TR output script of an internal key (BIP-86 without scripts, or with the script tree's merkle root).
// Q = P + H_TapTweak(P || root) * G. Even without scripts the key is tweaked (H_TapTweak(P)): BIP-86 / BIP-341
// recommend it so that an untweaked key cannot hide a script path the other cosigners never agreed to.
export const p2trScript = (internalKey, merkleRoot = null) => S.p2tr(taprootOutputKey(xOnly(internalKey), merkleRoot).key);
export const p2trAddress = (internalKey, net, merkleRoot = null) => fromOutputScript(p2trScript(internalKey, merkleRoot), net);

// Output script of a single-key address type.
export function scriptOf(pub, type) {
  switch (type) {
    case 'p2pkh': return S.p2pkh(hash160(needPub(pub)));
    case 'p2wpkh': return S.p2wpkh(hash160(needCompressed(pub)));
    case 'p2sh-p2wpkh': return S.p2sh(hash160(p2shP2wpkhRedeemScript(pub)));
    case 'p2tr': return p2trScript(pub);
    default: throw new Error(`unknown address type "${type}"`);
  }
}

export const addressOf = (pub, type, net) => fromOutputScript(scriptOf(pub, type), net);

// --- WIF -----------------------------------------------------------------------------------------
// Wallet Import Format: Base58Check(version || 32-byte secret || [0x01 if the pubkey is compressed]). The suffix is
// part of the key's identity: the same secret yields different P2PKH addresses for its compressed and uncompressed
// public keys, so dropping it on import makes the wallet scan the wrong address and "lose" the coins.

export function encodeWIF(priv, { compressed = true, network: net = 'mainnet' } = {}) {
  if (!isValidPrivateKey(priv)) throw new Error('invalid private key');
  return base58checkEncode(concatBytes(Uint8Array.of(network(net).wif), priv, compressed ? Uint8Array.of(1) : new Uint8Array(0)));
}

export function decodeWIF(text, net = null) {
  const p = base58checkDecode(String(text).trim());
  const nets = Object.values(NETWORKS).filter((n) => n.wif === p[0] && (!net || n.name === network(net).name)).map((n) => n.name);
  if (!nets.length) throw new Error('not a private key of a known network');
  let compressed;
  if (p.length === 34 && p[33] === 1) compressed = true;
  else if (p.length === 33) compressed = false;
  else throw new Error('invalid private key length');
  // Range check 1 <= d < n: a zero or >= n secret has no public key (and some libraries would silently reduce it mod n,
  // producing a key nobody intended).
  const privateKey = p.slice(1, 33);
  if (!isValidPrivateKey(privateKey)) throw new Error('private key out of range');
  return { privateKey, compressed, network: nets.length === 1 ? nets[0] : nets.includes('mainnet') ? 'mainnet' : nets[0], networks: nets };
}
