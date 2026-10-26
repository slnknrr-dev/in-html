// bitcoin/message.js - signed messages: the legacy format of Bitcoin Core / BIP-137 (a recoverable compact ECDSA
// signature over "Bitcoin Signed Message:\n" + message, header bytes for P2PKH, P2SH-P2WPKH and P2WPKH) and BIP-322
// generic signed messages (version 2.0.0: "smp" simple, "ful" full and "pof" proof-of-funds signatures, verified with
// the script interpreter, so any script — multisig, timelocks, taproot — verifies).
//
//   messageHash(message) -> 32 bytes                    bip322MessageHash(message) -> tagged hash
//   signMessage(message, privateKey, { type = 'p2pkh' | 'p2sh-p2wpkh' | 'p2wpkh', compressed = true }) -> base64
//   verifyMessage(message, address, signature, { network, loose = true }) -> { valid, format: 'legacy' | 'bip322-…',
//     error?, pubkey?, timelock?: { locktime, sequence } }
//     legacy signatures verify for P2PKH addresses (Core); loose also accepts the BIP-137 / Electrum headers for
//     segwit addresses; other signatures go through BIP-322.
//   bip322Sign(message, privateKey, address, { format = 'auto' | 'simple' | 'full', network }) -> 'smp…' | 'ful…'
//   bip322Verify(message, address, signature, { network }) -> { valid, format, error?, locktime?, sequence? }
//   bip322ToSpend(scriptPubKey, message), bip322ToSign(toSpendTxid, { version, locktime, sequence, witness })
//
// Security model:
// - Domain separation: the legacy format hashes "Bitcoin Signed Message:\n" + message (SHA-256d), BIP-322 uses the
//   tagged hash "BIP0322-signed-message". Either way a message signature can never be a valid transaction signature
//   - the reason a wallet may sign arbitrary text with a spending key at all.
// - BIP-322 signs a *virtual transaction* that spends a fake output (to_spend, version 0, input from the null outpoint
//   that commits to the message hash) into an OP_RETURN (to_sign). Neither can ever be mined: to_spend's input does
//   not exist, and to_sign spends to_spend. Verification is "does to_sign's input script pass the interpreter", so any
//   script a wallet can spend (multisig, timelocks, taproot) proves ownership with no new signature scheme.
// - Legacy verification recovers the public key from the signature (ECDSA public key recovery, header byte = 27 +
//   recovery id + 4 if compressed, + 8 / 12 for BIP-137 segwit headers) and compares its HASH160 to the address.
//   Recovery is why the format is P2PKH-shaped and does not extend to scripts.
import { sha256 } from '../crypto/sha2.js';
import { base64ToBytes, bytesToBase64, concatBytes, equalBytes, utf8ToBytes } from '../crypto/encoding.js';
import { Signature, ecdsaRecover, ecdsaSign, getPublicKey, schnorrSign, taggedHash, taprootTweakPrivateKey } from '../crypto/secp256k1.js';
import { Writer } from './bytes.js';
import { Transaction, SIGHASH } from './tx.js';
import { decodeAddress, hash160, p2shP2wpkhRedeemScript, toOutputScript } from './address.js';
import * as S from './script.js';
import { Psbt } from './psbt.js';
import { verifyScript, txChecker, FLAGS } from './interpreter.js';

const MAGIC = 'Bitcoin Signed Message:\n';
const msgBytes = (m) => (typeof m === 'string' ? utf8ToBytes(m) : m);

// Core's MessageHash: both the magic and the message are CompactSize-prefixed, so (magic, message) splits are
// unambiguous; the prefix length 24 = 0x18 is the byte older docs call "\x18Bitcoin Signed Message:\n".
export function messageHash(message) {
  const m = msgBytes(message);
  const w = new Writer().varbytes(utf8ToBytes(MAGIC)).varbytes(m).finish();
  return sha256(sha256(w));
}

// BIP-137 header bases (+ recovery id 0..3): 27 uncompressed P2PKH, 31 compressed P2PKH, 35 P2SH-P2WPKH, 39 P2WPKH.
const HEADER_BASE = { p2pkh: 27, 'p2pkh-compressed': 31, 'p2sh-p2wpkh': 35, p2wpkh: 39 };

// Deterministic nonce (RFC 6979 in ecdsaSign): no RNG dependence, so a broken RNG cannot leak the key through nonce
// reuse - the attack that drained Android wallets in 2013. lowR is not needed here: the compact format has fixed size.
export function signMessage(message, privateKey, { type = 'p2pkh', compressed = true } = {}) {
  if (type !== 'p2pkh' && !compressed) throw new Error('segwit addresses need compressed keys');
  const sig = ecdsaSign(messageHash(message), privateKey);
  const base = type === 'p2pkh' ? (compressed ? 31 : 27) : HEADER_BASE[type];
  if (base === undefined) throw new Error(`legacy message signatures support p2pkh, p2sh-p2wpkh and p2wpkh, not ${type}`);
  return bytesToBase64(concatBytes(Uint8Array.of(base + sig.recovery), sig.toCompact()));
}

// Strict mode is Core's verifymessage: P2PKH only, header 27..34. loose additionally accepts what Electrum / Trezor
// produce: BIP-137 segwit headers, and segwit addresses signed with plain 31..34 headers (Electrum never adopted
// BIP-137). In loose mode the header's type hint is not cross-checked against the address type - harmless, because
// the recovered key must still hash to the address; the header only selects how to hash it.
function legacyVerify(message, address, sigBytes, net, loose) {
  const h = sigBytes[0];
  if (h < 27 || h > 42) return { valid: false, format: 'legacy', error: 'invalid signature header' };
  const recovery = (h - 27) & 3;
  const compressed = h >= 31;
  let pub;
  try { pub = ecdsaRecover(Signature.fromCompact(sigBytes.subarray(1)), recovery, messageHash(message), compressed); } catch {
    return { valid: false, format: 'legacy', error: 'public key not recovered' };
  }
  const d = decodeAddress(address, net);
  const kh = hash160(pub);
  let ok = false;
  if (d.type === 'p2pkh') ok = equalBytes(kh, d.hash) && (loose || h <= 34);
  else if (loose && d.type === 'p2wpkh' && compressed) ok = equalBytes(kh, d.hash);
  else if (loose && d.type === 'p2sh' && compressed) ok = equalBytes(hash160(p2shP2wpkhRedeemScript(pub)), d.hash);
  return ok ? { valid: true, format: 'legacy', pubkey: pub } : { valid: false, format: 'legacy', error: 'not signed by this address' };
}

// Format dispatch: an explicit BIP-322 prefix wins; a 65-byte base64 blob is tried as legacy first and, for non-P2PKH
// addresses, retried as BIP-322 "simple" (an old unprefixed smp witness can also decode to 65 bytes).
export function verifyMessage(message, address, signature, { network = null, loose = true } = {}) {
  let d;
  try { d = decodeAddress(address, network); } catch { return { valid: false, format: null, error: 'invalid address' }; }
  const s = String(signature).trim();
  if (/^(smp|ful|pof)/.test(s)) return bip322Verify(message, address, s, { network });
  let b;
  try { b = base64ToBytes(s); } catch { return { valid: false, format: null, error: 'malformed base64 encoding' }; }
  if (b.length === 65) {
    const r = legacyVerify(message, address, b, network, loose);
    if (r.valid || d.type === 'p2pkh') return r;
  }
  return bip322Verify(message, address, s, { network });
}

// --- BIP-322 ---

export const bip322MessageHash = (message) => taggedHash('BIP0322-signed-message', msgBytes(message));

// to_spend exactly as BIP-322 fixes it: version 0, locktime 0, input = null outpoint (000…0:0xffffffff), sequence 0,
// scriptSig OP_0 PUSH32(message hash), one output of value 0 paying the address's scriptPubKey. Any deviation changes
// its txid and thereby every signature.
export function bip322ToSpend(scriptPubKey, message) {
  return new Transaction({
    version: 0, locktime: 0,
    inputs: [{ txid: '0'.repeat(64), vout: 0xffffffff, sequence: 0, scriptSig: concatBytes(Uint8Array.of(0, 32), bip322MessageHash(message)), witness: [] }],
    outputs: [{ value: 0, script: scriptPubKey }],
  });
}

export function bip322ToSign(toSpendTxid, { version = 0, locktime = 0, sequence = 0, scriptSig = new Uint8Array(0), witness = [] } = {}) {
  return new Transaction({
    version, locktime,
    inputs: [{ txid: toSpendTxid, vout: 0, sequence, scriptSig, witness }],
    outputs: [{ value: 0, script: Uint8Array.of(S.OPS.OP_RETURN) }],
  });
}

// The "simple" format is just to_sign's witness stack, serialized as in a transaction.
// readWitness is a deliberately small parser (CompactSize up to 0xfd prefix only): a message witness above 65535
// items or bytes per item is no real use case, so 0xfe / 0xff are rejected; missing bytes read as 0 and are then
// caught by the length / trailing-bytes checks. Non-canonical 0xfd-prefixed small sizes are tolerated (unlike
// bytes.js Reader) - harmless, the witness stack is not committed to by any sighash.
const witnessBytes = (items) => { const w = new Writer().varint(items.length); for (const i of items) w.varbytes(i); return w.finish(); };
function readWitness(b) {
  let pos = 0;
  const vi = () => { const p = b[pos++]; if (p < 0xfd) return p; if (p === 0xfd) { const n = b[pos] | (b[pos + 1] << 8); pos += 2; return n; } throw new Error('witness too large'); };
  const n = vi();
  const out = [];
  for (let i = 0; i < n; i++) { const len = vi(); if (pos + len > b.length) throw new Error('truncated witness'); out.push(b.slice(pos, pos + len)); pos += len; }
  if (pos !== b.length) throw new Error('trailing bytes after the witness');
  return out;
}

// Single-key signer for the four standard types. Each branch first proves the key matches the address (else the
// result would be a valid-looking signature for someone else's address that only fails at verification).
// Sighashes: segwit v0 uses BIP-143 with scriptCode = P2PKH of the key hash and amount 0 (to_spend's output value);
// legacy uses Core's SignatureHash; taproot uses BIP-341 SIGHASH_DEFAULT (64-byte signature) on the BIP-86 tweaked
// key - the key-path-only output every single-key taproot wallet derives. lowR grinding keeps DER signatures at 71
// bytes like Core's, so signatures are byte-identical to Core-generated vectors.
export function bip322Sign(message, privateKey, address, { format = 'auto', network = null } = {}) {
  const d = decodeAddress(address, network);
  const spk = d.script;
  const toSpend = bip322ToSpend(spk, message);
  const toSign = bip322ToSign(toSpend.txid());
  const prevouts = [{ value: 0, script: spk }];
  const pub = getPublicKey(privateKey, true);
  const ecdsa = (h) => concatBytes(ecdsaSign(h, privateKey, { lowR: true }).toDER(), Uint8Array.of(SIGHASH.ALL));
  switch (d.type) {
    case 'p2wpkh': {
      if (!equalBytes(hash160(pub), d.hash)) throw new Error('the key does not belong to the address');
      toSign.inputs[0].witness = [ecdsa(toSign.sighashV0(0, S.p2pkh(d.hash), 0, SIGHASH.ALL)), pub];
      break;
    }
    case 'p2tr': {
      const tweaked = taprootTweakPrivateKey(privateKey);
      if (!equalBytes(S.p2tr(getPublicKey(tweaked).subarray(1)), spk)) throw new Error('the key does not belong to the address (BIP-86 key path)');
      toSign.inputs[0].witness = [schnorrSign(toSign.sighashTaproot(0, prevouts, SIGHASH.DEFAULT), tweaked)];
      break;
    }
    case 'p2pkh': {
      if (!equalBytes(hash160(pub), d.hash) && !equalBytes(hash160(getPublicKey(privateKey, false)), d.hash)) throw new Error('the key does not belong to the address');
      const pk = equalBytes(hash160(pub), d.hash) ? pub : getPublicKey(privateKey, false);
      toSign.inputs[0].scriptSig = S.compile([ecdsa(toSign.sighashLegacy(0, spk, SIGHASH.ALL)), pk]);
      break;
    }
    case 'p2sh': {
      const redeem = p2shP2wpkhRedeemScript(pub);
      if (!equalBytes(hash160(redeem), d.hash)) throw new Error('only P2SH-P2WPKH addresses can be signed with one key');
      toSign.inputs[0].scriptSig = S.pushData(redeem);
      toSign.inputs[0].witness = [ecdsa(toSign.sighashV0(0, S.p2pkh(hash160(pub)), 0, SIGHASH.ALL)), pub];
      break;
    }
    default: throw new Error(`cannot sign for ${d.type} addresses with one key`);
  }
  const simple = format === 'simple' || (format === 'auto' && (d.type === 'p2wpkh' || d.type === 'p2tr'));
  if (simple) {
    if (toSign.inputs[0].scriptSig.length) throw new Error('the simple format is only for native segwit addresses');
    return 'smp' + bytesToBase64(witnessBytes(toSign.inputs[0].witness));
  }
  return 'ful' + bytesToBase64(toSign.toBytes());
}

// BIP-322 "required rules" as script flags (and the upgradeable ones: NOPs, unknown witness versions).
const BIP322_FLAGS = FLAGS.P2SH | FLAGS.DERSIG | FLAGS.NULLDUMMY | FLAGS.CHECKLOCKTIMEVERIFY | FLAGS.CHECKSEQUENCEVERIFY |
  FLAGS.WITNESS | FLAGS.TAPROOT | FLAGS.STRICTENC | FLAGS.LOW_S | FLAGS.NULLFAIL | FLAGS.MINIMALDATA | FLAGS.CLEANSTACK |
  FLAGS.MINIMALIF | FLAGS.CONST_SCRIPTCODE | FLAGS.WITNESS_PUBKEYTYPE | FLAGS.DISCOURAGE_UPGRADABLE_NOPS |
  FLAGS.DISCOURAGE_UPGRADABLE_WITNESS_PROGRAM;

// Signatures must use SIGHASH_ALL (or DEFAULT for taproot): every signature-looking witness / scriptSig item.
// Why: with NONE / SINGLE / ANYONECANPAY a signature over to_sign would not commit to all of it, so a proof-of-funds
// signature could be recombined with other inputs. The check is heuristic, by shape: 64 bytes = Schnorr DEFAULT;
// 65 bytes not starting with 0x04 (that would be an uncompressed pubkey) = Schnorr with explicit hash type; a
// strict-DER envelope (0x30, length byte = size - 3) = ECDSA with its hash type in the last byte. Anything else is
// treated as data and passes.
// KNOWN DEFECT: a 65-byte Schnorr signature whose R happens to start with byte 0x04 (about 1 in 256) is classified as a
// pubkey and escapes the check, so a non-ALL taproot signature can slip through in that case. Fix: decide per
// position from the script being executed (e.g. hook the interpreter's checkSchnorr / checkECDSA and reject
// hash types there) instead of by item shape.
function onlySighashAll(tx) {
  const items = [];
  for (const i of tx.inputs) {
    items.push(...i.witness);
    try { for (const c of S.decompile(i.scriptSig)) if (c.data) items.push(c.data); } catch { /* checked by the interpreter */ }
  }
  return items.every((x) => {
    if (x.length === 64) return true;
    if (x.length === 65 && x[0] !== 4) return x[64] === SIGHASH.ALL;
    if (x.length >= 9 && x.length <= 73 && x[0] === 0x30 && x[1] === x.length - 3) return x[x.length - 1] === SIGHASH.ALL;
    return true;
  });
}

// Verification order is fail-fast and mirrors BIP-322's rule list: parse; to_sign spends to_spend:0; exactly one
// zero-value OP_RETURN output; version 0 or 2 (others are "inconclusive", reserved for upgrades); SIGHASH_ALL only;
// then run every input through the interpreter with BIP322_FLAGS (the BIP's "required" rules: most of Core's standard
// flags, so a non-standard-but-consensus-valid trick does not count as proof; the taproot DISCOURAGE_* flags are
// left out). Proof-of-funds inputs beyond the
// first spend real UTXOs carried in the PSBT. The returned locktime / sequence let the caller see when a timelocked
// script would actually be spendable - BIP-322 says such a proof is only valid from that time on.
export function bip322Verify(message, address, signature, { network = null } = {}) {
  let d;
  try { d = decodeAddress(address, network); } catch { return { valid: false, format: null, error: 'invalid address' }; }
  let s = String(signature).trim();
  let format = s.slice(0, 3);
  if (!['smp', 'ful', 'pof'].includes(format)) format = 'smp'; // before version 2.0.0 there was no prefix
  else s = s.slice(3);
  let raw;
  try { raw = base64ToBytes(s); } catch { return { valid: false, format: 'bip322-' + format, error: 'error decoding signature as base64' }; }
  if (!raw.length) return { valid: false, format: 'bip322-' + format, error: 'signature too short' };
  const toSpend = bip322ToSpend(d.script, message);
  let toSign, prevouts;
  const fmt = { smp: 'bip322-simple', ful: 'bip322-full', pof: 'bip322-proof-of-funds' }[format];
  try {
    if (format === 'smp') {
      toSign = bip322ToSign(toSpend.txid(), { witness: readWitness(raw) });
      prevouts = [toSpend.outputs[0]];
    } else if (format === 'ful') {
      toSign = Transaction.fromBytes(raw);
      if (toSign.inputs.length !== 1) throw new Error('a full signature has one input');
      prevouts = [toSpend.outputs[0]];
    } else {
      const p = Psbt.fromBytes(raw);
      toSign = p.extract();
      prevouts = toSign.inputs.map((_, i) => (i === 0 ? toSpend.outputs[0] : p.spentOutput(i) || inheritUtxo(p, i)));
      if (prevouts.some((x) => !x)) throw new Error('a proof-of-funds input lacks its UTXO');
    }
  } catch (e) {
    return { valid: false, format: fmt, error: format === 'smp' ? 'invalid signature' : `error parsing signature as ${format === 'ful' ? 'full' : 'proof of funds'} variant: ${e.message}` };
  }
  const i0 = toSign.inputs[0];
  if (i0.txid !== toSpend.txid() || i0.vout !== 0) return { valid: false, format: fmt, error: 'invalid signature: it does not spend the message challenge' };
  if (toSign.outputs.length !== 1 || toSign.outputs[0].value !== 0 || !equalBytes(toSign.outputs[0].script, Uint8Array.of(S.OPS.OP_RETURN))) {
    return { valid: false, format: fmt, error: 'to_sign must have one OP_RETURN output of zero value' };
  }
  if (toSign.version !== 0 && toSign.version !== 2) return { valid: false, format: fmt, error: 'inconclusive: transaction version' };
  if (!onlySighashAll(toSign)) return { valid: false, format: fmt, error: 'signatures must use SIGHASH_ALL' };
  for (let i = 0; i < toSign.inputs.length; i++) {
    const inp = toSign.inputs[i];
    const r = verifyScript(inp.scriptSig, prevouts[i].script, inp.witness, BIP322_FLAGS, txChecker(toSign, i, prevouts, prevouts[i].value));
    if (!r.ok) return { valid: false, format: fmt, error: `invalid signature (${r.error}${i ? ', input ' + i : ''})` };
  }
  return { valid: true, format: fmt, locktime: toSign.locktime, sequence: i0.sequence, inputs: toSign.inputs.length };
}

// Proof of funds: an input may take the non-witness UTXO of an earlier input with the same txid (two outputs of one
// previous transaction need its bytes only once). The prevout's authenticity is then the PSBT's txid check in
// psbt.js parseInput (non-witness UTXO hash == outpoint); a witnessUtxo-only input is taken on trust - BIP-322
// proof of funds proves control of those coins only if the verifier also checks they are unspent on chain.
function inheritUtxo(p, i) {
  const tx = p.tx();
  const txid = tx.inputs[i].txid;
  for (let k = 1; k < i; k++) {
    const nw = p.inputs[k].nonWitnessUtxo;
    if (tx.inputs[k].txid === txid && nw) return nw.outputs[tx.inputs[i].vout] || null;
  }
  return null;
}

export { toOutputScript };
