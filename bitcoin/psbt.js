// bitcoin/psbt.js - Partially Signed Bitcoin Transactions: BIP-174 (version 0) and BIP-370 (version 2) with the
// taproot fields of BIP-371 and the size checks of the MuSig2 fields of BIP-373. Every role: creator, updater, signer
// (ECDSA with Core's low-R grinding, BIP-340 for taproot key and script paths), combiner, finalizer (single-key
// types, multisig, nested segwit, taproot key path and simple tapscripts) and extractor. Serialization follows
// Bitcoin Core's field order, so PSBTs round-trip byte for byte with Core.
//
//   Psbt.fromBase64(text) / fromHex / fromBytes / Psbt.parse(text: base64 | hex | binary-string)
//   Psbt.create({ version = 2 (tx), locktime = 0, inputs: [{ txid, vout, sequence }], outputs: [{ script | address,
//     value }], network, psbtVersion = 0 })      Psbt.fromTransaction(tx)
//   psbt.toBase64() / toHex() / toBytes(), psbt.version (0 | 2), psbt.tx() (the unsigned transaction), psbt.txid()
//   psbt.inputs[i]  { nonWitnessUtxo (Transaction), witnessUtxo { value, script }, partialSigs [{ pubkey, signature }],
//     sighashType, redeemScript, witnessScript, bip32Derivation [{ pubkey, fingerprint, path }], finalScriptSig,
//     finalScriptWitness [items], ripemd160 / sha256 / hash160 / hash256 [{ hash, preimage }], previousTxid,
//     outputIndex, sequence, requiredTimeLocktime, requiredHeightLocktime, tapKeySig, tapScriptSigs [{ pubkey,
//     leafHash, signature }], tapLeafScripts [{ controlBlock, script, leafVersion }], tapBip32Derivation [{ pubkey,
//     leafHashes, fingerprint, path }], tapInternalKey, tapMerkleRoot, musig2* (raw), proprietary, unknown [{ key, value }] }
//   psbt.outputs[i] { redeemScript, witnessScript, bip32Derivation, amount, script, tapInternalKey, tapTree [{ depth,
//     leafVersion, script }], tapBip32Derivation, proprietary, unknown }
//   psbt.global { xpubs [{ xpub (78 bytes), fingerprint, path }], txVersion, fallbackLocktime, txModifiable, proprietary, unknown }
//   psbt.addInput(input), psbt.addOutput(output), psbt.updateInput(i, fields), psbt.updateOutput(i, fields)
//   psbt.spentOutput(i) -> { value, script } | null, psbt.fee() (null when an input value is unknown), psbt.feeRate()
//   psbt.signInput(i, signer, { sighashTypes, lowR = true }) -> number of signatures added
//     signer: { privateKey } (single key) | HDKey master (bip32Derivation entries with its fingerprint) | [signers]
//   psbt.signAll(signer, opts) -> signatures added     psbt.validateSignatures(i) -> boolean
//   psbt.combine(...others) (in place)                 Psbt.combine(a, b, …)
//   psbt.finalizeInput(i) / psbt.finalizeAll() -> boolean (true when complete); psbt.isFinalized(i)
//   psbt.extract() -> Transaction (throws unless every input is final)
//   psbt.toVersion(0 | 2) -> a converted copy; psbt.clone()
//
// Format: magic "psbt" 0xff, then key-value maps (global, one per input, one per output), each terminated by 0x00.
// key = compact_size(len) || type || keydata, value = compact_size(len) || bytes. Unknown and proprietary pairs are
// preserved verbatim, so a PSBT passing through this code loses nothing other tools put in.
// Parser stance: strict, with Core's error texts. Every size is checked, duplicate keys are rejected, hash preimages
// must match, non-witness UTXOs must hash to the outpoint txid. A PSBT is attacker-supplied input to a *signer*: a
// lenient parser is how mismatched fields get signed.
// Signer stance - what this signer verifies and what it does not:
// + legacy inputs are signed only with a non-witness UTXO (the amount is otherwise unauthenticated);
// + redeem / witness scripts must hash to the spent script, and a taproot key-path signature is made only if the
//   tweaked key reproduces the spent output;
// + a non-witness UTXO must match the outpoint txid.
// - KNOWN DEFECT (signing policy): by default every sighash type the PSBT asks for is honoured, including NONE and
//   ANYONECANPAY, so a malicious coordinator can obtain a signature that lets it redirect the outputs. Core's
//   walletprocesspsbt refuses a PSBT sighash that differs from the one the user chose. Fix: default sighashTypes to
//   [ALL] for ECDSA and [DEFAULT, ALL] for taproot.
// - KNOWN DEFECT: when an input carries both witnessUtxo and nonWitnessUtxo, spentOutput() trusts witnessUtxo without
//   checking it equals nonWitnessUtxo.outputs[vout]; a forged witnessUtxo amount then flows into the BIP-143 sighash and
//   fee(). (The signature stays invalid on chain for v0, but the fee shown to the user is wrong, and the CVE-2020-14199
//   two-session overpay attack is not prevented.) Fix: when both are present, require equality, else fail.
// Serialization follows Core's field order and sorting so that Core and this code produce identical bytes, which
// keeps combine / compare / hash-of-PSBT workflows stable across tools.
import { bytesToHex, concatBytes, equalBytes, hexToBytes, base64ToBytes, bytesToBase64 } from '../crypto/encoding.js';
import { sha256 } from '../crypto/sha2.js';
import { ripemd160 } from '../crypto/ripemd.js';
import {
  Signature, ecdsaSign, ecdsaVerify, getPublicKey, isValidPublicKey, schnorrSign, schnorrVerify, taprootTweakPrivateKey,
  liftX, schnorrPublicKey,
} from '../crypto/secp256k1.js';
import { Reader, Writer, bytesToHexLE, hexToBytesLE } from './bytes.js';
import { Transaction, SIGHASH } from './tx.js';
import * as S from './script.js';
import { toOutputScript } from './address.js';
import { parseControlBlock, tapLeafHash, tapTreeFromList, tapTree, rootFromControlBlock } from './taproot.js';

const MAGIC = Uint8Array.of(0x70, 0x73, 0x62, 0x74, 0xff);
const hash160 = (b) => ripemd160(sha256(b));
const hash256 = (b) => sha256(sha256(b));
const hex = bytesToHex;

export const PSBT_GLOBAL = { UNSIGNED_TX: 0x00, XPUB: 0x01, TX_VERSION: 0x02, FALLBACK_LOCKTIME: 0x03, INPUT_COUNT: 0x04, OUTPUT_COUNT: 0x05, TX_MODIFIABLE: 0x06, VERSION: 0xfb, PROPRIETARY: 0xfc };
export const PSBT_IN = {
  NON_WITNESS_UTXO: 0x00, WITNESS_UTXO: 0x01, PARTIAL_SIG: 0x02, SIGHASH_TYPE: 0x03, REDEEM_SCRIPT: 0x04, WITNESS_SCRIPT: 0x05,
  BIP32_DERIVATION: 0x06, FINAL_SCRIPTSIG: 0x07, FINAL_SCRIPTWITNESS: 0x08, RIPEMD160: 0x0a, SHA256: 0x0b, HASH160: 0x0c,
  HASH256: 0x0d, PREVIOUS_TXID: 0x0e, OUTPUT_INDEX: 0x0f, SEQUENCE: 0x10, REQUIRED_TIME_LOCKTIME: 0x11, REQUIRED_HEIGHT_LOCKTIME: 0x12,
  TAP_KEY_SIG: 0x13, TAP_SCRIPT_SIG: 0x14, TAP_LEAF_SCRIPT: 0x15, TAP_BIP32_DERIVATION: 0x16, TAP_INTERNAL_KEY: 0x17,
  TAP_MERKLE_ROOT: 0x18, MUSIG2_PARTICIPANT_PUBKEYS: 0x1a, MUSIG2_PUB_NONCE: 0x1b, MUSIG2_PARTIAL_SIG: 0x1c, PROPRIETARY: 0xfc,
};
export const PSBT_OUT = {
  REDEEM_SCRIPT: 0x00, WITNESS_SCRIPT: 0x01, BIP32_DERIVATION: 0x02, AMOUNT: 0x03, SCRIPT: 0x04, TAP_INTERNAL_KEY: 0x05,
  TAP_TREE: 0x06, TAP_BIP32_DERIVATION: 0x07, MUSIG2_PARTICIPANT_PUBKEYS: 0x08, PROPRIETARY: 0xfc,
};

class PsbtError extends Error {}
const fail = (msg) => { throw new PsbtError(msg); };

const cmp = S.compareBytes;
const cmpPath = (a, b) => { for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return a.length - b.length; };

// --- small codecs ------------------------------------------------------------------------------

function readKeyType(key) {
  const r = new Reader(key);
  const type = r.varint();
  return { type, data: key.subarray(r.pos) };
}

const keyBytes = (type, data = new Uint8Array(0)) => concatBytes(new Writer().varint(type).finish(), data);

function parseOrigin(v, what) {
  if (v.length < 4 || v.length % 4) fail(`${what}: invalid length of the key origin`);
  // The fingerprint as a big-endian uint32 (like HDKey.fingerprint), the path as little-endian indexes.
  const fingerprint = ((v[0] << 24) | (v[1] << 16) | (v[2] << 8) | v[3]) >>> 0;
  const r = new Reader(v, 4);
  const path = [];
  while (!r.done()) path.push(r.u32());
  return { fingerprint, path };
}

const originBytes = ({ fingerprint, path }) => {
  const w = new Writer().u8(fingerprint >>> 24).u8(fingerprint >>> 16).u8(fingerprint >>> 8).u8(fingerprint);
  for (const p of path) w.u32(p);
  return w.finish();
};

// Value codecs insist that the value is consumed exactly ("Size of value was not the stated size"): trailing bytes
// would be an ambiguity two implementations might resolve differently.
function readWitnessStack(v) {
  const r = new Reader(v);
  const n = r.varint();
  const items = [];
  for (let i = 0; i < n; i++) items.push(r.varbytes().slice());
  if (!r.done()) fail('Size of value was not the stated size');
  return items;
}
const witnessStackBytes = (items) => { const w = new Writer().varint(items.length); for (const i of items) w.varbytes(i); return w.finish(); };

function readTxOut(v) {
  const r = new Reader(v);
  const value = r.u64();
  const script = r.varbytes().slice();
  if (!r.done()) fail('Size of value was not the stated size');
  return { value, script };
}
const txOutBytes = (o) => new Writer().u64(o.value).varbytes(o.script).finish();

const u32le = (n) => new Writer().u32(n).finish();
function readU32(v, what) { if (v.length !== 4) fail(`Size of value was not the stated size (${what})`); return new Reader(v).u32(); }
function readI32(v, what) { if (v.length !== 4) fail(`Size of value was not the stated size (${what})`); return new Reader(v).i32(); }

const needKeyLen = (data, n, what) => { if (data.length !== n) fail(`Size of key was not the expected size for the type ${what}`); };
const needPubkey = (pk, what) => { if (!isValidPublicKey(pk)) fail(`${what} is invalid`); };
const needXOnly = (pk, what) => { try { liftX(pk); } catch { fail(`${what} is invalid`); } };

// --- the PSBT ------------------------------------------------------------------------------------

export class Psbt {
  constructor() {
    this.version = 0;
    this.global = { tx: null, xpubs: [], txVersion: undefined, fallbackLocktime: undefined, inputCount: undefined, outputCount: undefined, txModifiable: undefined, proprietary: [], unknown: [] };
    this.inputs = [];
    this.outputs = [];
  }

  // Format sniffing: raw bytes, hex (starts with the magic in hex), a binary string (file read as latin-1, starts
  // with "psbt" + U+00FF), else base64 - the BIP-174 text form.
  static parse(text) {
    if (text instanceof Uint8Array) return Psbt.fromBytes(text);
    const s = String(text).trim();
    if (/^70736274ff/i.test(s)) return Psbt.fromHex(s);
    if (s.startsWith('psbtÿ')) return Psbt.fromBytes(Uint8Array.from(s, (c) => c.charCodeAt(0)));
    return Psbt.fromBase64(s);
  }

  static fromBase64(text) {
    let b;
    try { b = base64ToBytes(text); } catch { fail('invalid base64'); }
    return Psbt.fromBytes(b);
  }

  static fromHex(text) { return Psbt.fromBytes(hexToBytes(text)); }

  static fromBytes(bytes) {
    try { return parsePsbt(bytes); } catch (e) {
      if (e instanceof PsbtError) throw e;
      throw new PsbtError(e.message);
    }
  }

  toBytes() { return serializePsbt(this); }

  toBase64() { return bytesToBase64(this.toBytes()); }

  toHex() { return hex(this.toBytes()); }

  clone() { return Psbt.fromBytes(this.toBytes()); }

  // --- creator --------------------------------------------------------------------------------

  static create({ version = 2, locktime = 0, inputs = [], outputs = [], network = null, psbtVersion = 0 } = {}) {
    const p = new Psbt();
    const tx = new Transaction({ version, locktime });
    for (const i of inputs) tx.addInput({ txid: i.txid, vout: i.vout, sequence: i.sequence ?? (locktime ? 0xfffffffe : 0xffffffff) });
    for (const o of outputs) tx.addOutput({ value: o.value, script: o.script || toOutputScript(o.address, network) });
    p.global.tx = tx;
    p.inputs = tx.inputs.map(() => ({}));
    p.outputs = tx.outputs.map(() => ({}));
    return psbtVersion === 2 ? p.toVersion(2) : p;
  }

  // The unsigned tx of a v0 PSBT must have empty scriptSigs and witnesses (BIP-174), so they are stripped.
  static fromTransaction(tx) {
    const t = tx.clone();
    for (const i of t.inputs) { i.scriptSig = new Uint8Array(0); i.witness = []; }
    const p = new Psbt();
    p.global.tx = t;
    p.inputs = t.inputs.map(() => ({}));
    p.outputs = t.outputs.map(() => ({}));
    return p;
  }

  // The unsigned transaction (v2: built from the per-input / per-output fields, BIP-370 locktime rules).
  tx() {
    if (this.version === 0) return this.global.tx.clone();
    const tx = new Transaction({ version: this.global.txVersion, locktime: this.locktime() });
    this.inputs.forEach((i) => tx.addInput({ txid: i.previousTxid, vout: i.outputIndex, sequence: i.sequence ?? 0xffffffff }));
    this.outputs.forEach((o) => tx.addOutput({ value: o.amount, script: o.script }));
    return tx;
  }

  // BIP-370: the largest required time or height locktime (height when every input allows it), else the fallback.
  locktime() {
    if (this.version === 0) return this.global.tx.locktime;
    const times = this.inputs.map((i) => i.requiredTimeLocktime).filter((x) => x !== undefined);
    const heights = this.inputs.map((i) => i.requiredHeightLocktime).filter((x) => x !== undefined);
    if (!times.length && !heights.length) return this.global.fallbackLocktime ?? 0;
    const heightOk = this.inputs.every((i) => i.requiredTimeLocktime === undefined || i.requiredHeightLocktime !== undefined);
    const timeOk = this.inputs.every((i) => i.requiredHeightLocktime === undefined || i.requiredTimeLocktime !== undefined);
    if (heights.length && heightOk) return Math.max(...heights);
    if (times.length && timeOk) return Math.max(...times);
    fail('the inputs require incompatible locktime types');
  }

  txid() { return this.tx().txid(); }

  // v0 <-> v2: v0 keeps the unsigned tx in the global map; v2 (BIP-370) spreads it into per-input / per-output fields
  // so inputs and outputs can be added later (interactive construction, coinjoin, payjoin). The tx's locktime
  // becomes the fallback locktime. Converting back recomputes the tx from the fields.
  toVersion(v) {
    if (v !== 0 && v !== 2) throw new Error('PSBT version 0 or 2');
    const p = this.clone();
    if (p.version === v) return p;
    if (v === 2) {
      const tx = p.global.tx;
      p.version = 2;
      p.global.tx = null;
      p.global.txVersion = tx.version;
      p.global.fallbackLocktime = tx.locktime;
      tx.inputs.forEach((t, k) => Object.assign(p.inputs[k], { previousTxid: t.txid, outputIndex: t.vout, sequence: t.sequence }));
      tx.outputs.forEach((t, k) => Object.assign(p.outputs[k], { amount: t.value, script: t.script }));
    } else {
      const tx = p.tx();
      p.version = 0;
      p.global.tx = tx;
      for (const k of ['txVersion', 'fallbackLocktime', 'inputCount', 'outputCount', 'txModifiable']) p.global[k] = undefined;
      for (const i of p.inputs) for (const k of ['previousTxid', 'outputIndex', 'sequence', 'requiredTimeLocktime', 'requiredHeightLocktime']) delete i[k];
      for (const o of p.outputs) { delete o.amount; delete o.script; }
    }
    return p;
  }

  // --- updater --------------------------------------------------------------------------------

  addInput(input) {
    const { txid, vout, sequence = 0xfffffffd, ...fields } = input;
    if (this.version === 0) this.global.tx.addInput({ txid, vout, sequence });
    this.inputs.push(this.version === 0 ? { ...fields } : { previousTxid: txid, outputIndex: vout, sequence, ...fields });
    return this.inputs.length - 1;
  }

  addOutput(output) {
    const { value, script, address, network, ...fields } = output;
    const spk = script || toOutputScript(address, network);
    if (this.version === 0) this.global.tx.addOutput({ value, script: spk });
    this.outputs.push(this.version === 0 ? { ...fields } : { amount: value, script: spk, ...fields });
    return this.outputs.length - 1;
  }

  updateInput(i, fields) { Object.assign(this.inputs[i], fields); return this; }

  updateOutput(i, fields) { Object.assign(this.outputs[i], fields); return this; }

  // The output an input spends: { value, script } from its witness UTXO or its full previous transaction.
  // witnessUtxo wins when both exist (see the KNOWN DEFECT in the header: no cross-check).
  spentOutput(i) {
    const inp = this.inputs[i];
    if (inp.witnessUtxo) return inp.witnessUtxo;
    if (inp.nonWitnessUtxo) {
      const vout = this.version === 0 ? this.global.tx.inputs[i].vout : inp.outputIndex;
      return inp.nonWitnessUtxo.outputs[vout] || null;
    }
    return null;
  }

  fee() {
    let total = 0;
    for (let i = 0; i < this.inputs.length; i++) { const o = this.spentOutput(i); if (!o) return null; total += o.value; }
    return total - this.tx().outputs.reduce((s, o) => s + o.value, 0);
  }

  // --- signer ---------------------------------------------------------------------------------

  // Keys a signer has for an input: [{ privateKey, pubkey, leafHashes? }] from bip32 / tap bip32 derivations or the
  // signer's own key.
  // HD signer: only derivations whose fingerprint equals the master's own fingerprint are followed, and the derived
  // pubkey must equal the one in the PSBT - a derivation path from the PSBT is never trusted blindly (a wrong path
  // simply yields no key). Fingerprints are only 32 bits, so the pubkey comparison is what actually authenticates.
  keysFor(i, signer) {
    const inp = this.inputs[i];
    const out = [];
    const signers = Array.isArray(signer) ? signer : [signer];
    for (const sg of signers) {
      if (!sg) continue;
      if (typeof sg.derive === 'function' && sg.privateKey) {
        // An HD master key: derivations with its fingerprint.
        const fp = sg.fingerprint;
        for (const d of inp.bip32Derivation || []) {
          if (d.fingerprint !== fp) continue;
          const k = deriveIndexes(sg, d.path);
          if (k && equalBytes(getPublicKey(k.privateKey, d.pubkey.length === 33), d.pubkey)) out.push({ privateKey: k.privateKey, pubkey: d.pubkey });
        }
        for (const d of inp.tapBip32Derivation || []) {
          if (d.fingerprint !== fp) continue;
          const k = deriveIndexes(sg, d.path);
          if (k && equalBytes(schnorrPublicKey(k.privateKey), d.pubkey)) out.push({ privateKey: k.privateKey, pubkey: d.pubkey, xonly: true, leafHashes: d.leafHashes });
        }
      } else if (sg.privateKey) {
        out.push({ privateKey: sg.privateKey, pubkey: getPublicKey(sg.privateKey, sg.compressed !== false), single: true });
      }
    }
    return out;
  }

  // Taproot: the sighash covers all inputs' spent outputs, so every input needs its UTXO. Key path: tweak the private
  // key by H_TapTweak(P || merkle root) and sign only if that reproduces the output key; script path: sign each leaf
  // that contains the key (and that the derivation's leafHashes name). SIGHASH_DEFAULT signatures are 64 bytes, any
  // explicit type appends a byte.
  // ECDSA: resolve the executed script (redeem / witness script after their hash checks; P2WPKH's implied P2PKH),
  // compute the BIP-143 or legacy sighash, sign with low-S and low-R (Core's grinding: 71-byte DER, deterministic
  // RFC 6979 nonces with a counter as extra entropy). An existing signature for the same key is never replaced.
  signInput(i, signer, { sighashTypes = null, lowR = true } = {}) {
    const inp = this.inputs[i];
    if (inp.finalScriptSig || inp.finalScriptWitness) return 0;
    const prev = this.spentOutput(i);
    if (!prev) throw new Error(`input ${i}: the spent output is unknown (add a witness or non-witness UTXO)`);
    const tx = this.tx();
    if (inp.nonWitnessUtxo && inp.nonWitnessUtxo.txid() !== tx.inputs[i].txid) throw new Error(`input ${i}: the non-witness UTXO does not match the outpoint`);
    const keys = this.keysFor(i, signer);
    let added = 0;
    const c = S.classify(prev.script);
    if (c.type === 'p2tr') {
      const ht = inp.sighashType ?? SIGHASH.DEFAULT;
      if (sighashTypes && !sighashTypes.includes(ht)) throw new Error(`input ${i}: sighash type ${ht} not allowed`);
      const prevouts = this.inputs.map((_, k) => this.spentOutput(k));
      if (prevouts.some((p) => !p)) throw new Error('taproot signing needs the spent outputs of every input');
      const sigOf = (h, priv) => { const s = schnorrSign(h, priv); return ht === SIGHASH.DEFAULT ? s : concatBytes(s, Uint8Array.of(ht)); };
      for (const k of keys) {
        const xk = k.pubkey.length === 32 ? k.pubkey : k.pubkey.subarray(1);
        // Key path: the key is the internal key (or, for a single key without PSBT fields, the BIP-86 internal key).
        const internal = inp.tapInternalKey || (k.single ? schnorrPublicKey(k.privateKey) : null);
        if (internal && equalBytes(internal, xk) && !inp.tapKeySig) {
          const tweaked = taprootTweakPrivateKey(k.privateKey, inp.tapMerkleRoot || null);
          if (equalBytes(S.p2tr(schnorrPublicKey(tweaked)), prev.script)) {
            inp.tapKeySig = sigOf(tx.sighashTaproot(i, prevouts, ht), tweaked);
            added++;
          }
        }
        // Script paths: leaves that contain the key.
        for (const leaf of inp.tapLeafScripts || []) {
          const lh = tapLeafHash(leaf.script, leaf.leafVersion);
          if (k.leafHashes && !k.leafHashes.some((x) => equalBytes(x, lh))) continue;
          if (!scriptHasKey(leaf.script, xk)) continue;
          inp.tapScriptSigs = inp.tapScriptSigs || [];
          if (inp.tapScriptSigs.some((s) => equalBytes(s.pubkey, xk) && equalBytes(s.leafHash, lh))) continue;
          inp.tapScriptSigs.push({ pubkey: xk, leafHash: lh, signature: sigOf(tx.sighashTaproot(i, prevouts, ht, { leafHash: lh }), k.privateKey) });
          added++;
        }
      }
      return added;
    }
    const ht = inp.sighashType ?? SIGHASH.ALL;
    if (sighashTypes && !sighashTypes.includes(ht)) throw new Error(`input ${i}: sighash type ${ht} not allowed`);
    // The script that is executed and whether it is segwit.
    let script = prev.script, segwit = false, cls = c;
    if (c.type === 'p2sh') {
      if (!inp.redeemScript) return 0;
      if (!equalBytes(hash160(inp.redeemScript), c.hash)) return 0; // a wrong redeem script: nothing is signed (BIP-174)
      script = inp.redeemScript;
      cls = S.classify(script);
    }
    if (cls.type === 'p2wpkh') { segwit = true; script = S.p2pkh(cls.hash); }
    else if (cls.type === 'p2wsh') {
      if (!inp.witnessScript) return 0;
      if (!equalBytes(sha256(inp.witnessScript), cls.hash)) return 0;
      segwit = true;
      script = inp.witnessScript;
    }
    // A legacy spend needs the full previous transaction (its amount cannot be trusted otherwise; BIP-174).
    if (!segwit && !inp.nonWitnessUtxo) return 0;
    const hash = segwit ? tx.sighashV0(i, script, prev.value, ht) : tx.sighashLegacy(i, script, ht);
    for (const k of keys) {
      if (k.xonly) continue;
      if (!scriptHasKey(script, k.pubkey) && !(S.classify(script).type === 'p2pkh' && equalBytes(hash160(k.pubkey), S.classify(script).hash))) continue;
      inp.partialSigs = inp.partialSigs || [];
      if (inp.partialSigs.some((s) => equalBytes(s.pubkey, k.pubkey))) continue;
      const sig = ecdsaSign(hash, k.privateKey, { lowR });
      inp.partialSigs.push({ pubkey: k.pubkey, signature: concatBytes(sig.toDER(), Uint8Array.of(ht)) });
      added++;
    }
    return added;
  }

  signAll(signer, opts) {
    let n = 0;
    for (let i = 0; i < this.inputs.length; i++) n += this.signInput(i, signer, opts);
    return n;
  }

  // Every partial / taproot signature of an input verifies. ECDSA signatures are parsed with strict DER (BIP-66), the
  // only encoding a standard transaction may carry. A partial signature by a key unrelated to the script still
  // "verifies" here; whether it satisfies the script is the finalizer's / interpreter's question.
  validateSignatures(i) {
    const inp = this.inputs[i];
    const prev = this.spentOutput(i);
    if (!prev) return false;
    const tx = this.tx();
    const c = S.classify(prev.script);
    if (c.type === 'p2tr') {
      const prevouts = this.inputs.map((_, k) => this.spentOutput(k));
      const check = (sig, key, leafHash) => {
        const ht = sig.length === 65 ? sig[64] : 0;
        return schnorrVerify(sig.subarray(0, 64), tx.sighashTaproot(i, prevouts, ht, leafHash ? { leafHash } : {}), key);
      };
      if (inp.tapKeySig && !check(inp.tapKeySig, c.program)) return false;
      for (const s of inp.tapScriptSigs || []) if (!check(s.signature, s.pubkey, s.leafHash)) return false;
      return true;
    }
    let script = prev.script, segwit = false, cls = c;
    if (c.type === 'p2sh' && inp.redeemScript) { script = inp.redeemScript; cls = S.classify(script); }
    if (cls.type === 'p2wpkh') { segwit = true; script = S.p2pkh(cls.hash); }
    else if (cls.type === 'p2wsh' && inp.witnessScript) { segwit = true; script = inp.witnessScript; }
    for (const s of inp.partialSigs || []) {
      const ht = s.signature[s.signature.length - 1];
      const h = segwit ? tx.sighashV0(i, script, prev.value, ht) : tx.sighashLegacy(i, script, ht);
      let sig;
      try { sig = Signature.fromDER(s.signature.subarray(0, -1)); } catch { return false; }
      if (!ecdsaVerify(sig, h, s.pubkey)) return false;
    }
    return true;
  }

  // --- combiner -------------------------------------------------------------------------------

  // BIP-174 combiner: only PSBTs of the same unsigned transaction (same txid) merge; fields are unioned.
  combine(...others) {
    for (const o of others) {
      if (o.version !== this.version) throw new Error('cannot combine PSBTs of different versions');
      if (this.txid() !== o.txid()) throw new Error('cannot combine PSBTs of different transactions');
      mergeMap(this.global, o.global);
      this.inputs.forEach((inp, k) => mergeMap(inp, o.inputs[k]));
      this.outputs.forEach((out, k) => mergeMap(out, o.outputs[k]));
    }
    return this;
  }

  static combine(first, ...rest) { return first.clone().combine(...rest); }

  // --- finalizer ------------------------------------------------------------------------------

  isFinalized(i) { const inp = this.inputs[i]; return !!(inp.finalScriptSig || inp.finalScriptWitness); }

  // On success all signing metadata is deleted (BIP-174: the finalizer clears everything but the UTXOs, unknown /
  // proprietary fields and the v2 tx fields) - leftover partial signatures would be dead weight and a privacy leak.
  // The finalizer does not run the interpreter; verify with interpreter.js verifyInput before broadcasting.
  finalizeInput(i) {
    const inp = this.inputs[i];
    if (this.isFinalized(i)) return true;
    const prev = this.spentOutput(i);
    if (!prev) return false;
    const r = finalScripts(inp, prev.script);
    if (!r) return false;
    for (const k of Object.keys(inp)) if (!KEEP_AFTER_FINAL.has(k)) delete inp[k];
    if (r.scriptSig && r.scriptSig.length) inp.finalScriptSig = r.scriptSig;
    if (r.witness && r.witness.length) inp.finalScriptWitness = r.witness;
    return true;
  }

  finalizeAll() {
    let ok = true;
    for (let i = 0; i < this.inputs.length; i++) ok = this.finalizeInput(i) && ok;
    return ok;
  }

  // --- extractor ------------------------------------------------------------------------------

  extract() {
    const tx = this.tx();
    this.inputs.forEach((inp, i) => {
      if (!this.isFinalized(i)) throw new Error(`input ${i} is not finalized`);
      tx.inputs[i].scriptSig = inp.finalScriptSig || new Uint8Array(0);
      tx.inputs[i].witness = inp.finalScriptWitness || [];
    });
    return tx;
  }
}

const KEEP_AFTER_FINAL = new Set(['nonWitnessUtxo', 'witnessUtxo', 'proprietary', 'unknown', 'previousTxid', 'outputIndex', 'sequence', 'requiredTimeLocktime', 'requiredHeightLocktime', '_nwuRaw']);

function deriveIndexes(root, path) {
  try { let k = root; for (const p of path) k = k.deriveChild(p); return k; } catch { return null; }
}

// Does a script contain a push of this public key (33-byte, 65-byte or 32-byte x-only)?
function scriptHasKey(script, key) {
  let chunks;
  try { chunks = S.decompile(script); } catch { return false; }
  return chunks.some((c) => c.data && equalBytes(c.data, key));
}

// Final scriptSig / witness of an input from its partial signatures (null when not enough signatures).
// Supported templates: P2PK, P2PKH, bare / P2SH / P2WSH / P2SH-P2WSH multisig, P2WPKH, P2SH-P2WPKH, taproot key path
// and the two common tapscript leaves (pk and multi_a). Multisig: signatures in key order (CHECKMULTISIG walks keys
// and signatures in step), exactly m of them, after the empty dummy. In a scriptSig an empty element must be written
// as OP_0, not as a zero-length push (MINIMALDATA). For taproot the key path is preferred (smallest, and reveals no
// scripts); otherwise the smallest satisfiable leaf is chosen.
function finalScripts(inp, prevScript) {
  const c = S.classify(prevScript);
  const sigFor = (pk) => (inp.partialSigs || []).find((s) => equalBytes(s.pubkey, pk));
  const pushes = (items) => S.compile(items.map((x) => (typeof x === 'number' ? x : x)));
  // Satisfies a script that is run directly (redeem / witness script or the output itself): stack items or null.
  const satisfy = (script) => {
    const t = S.classify(script);
    if (t.type === 'p2pkh') {
      const s = (inp.partialSigs || []).find((x) => equalBytes(hash160(x.pubkey), t.hash));
      return s ? [s.signature, s.pubkey] : null;
    }
    if (t.type === 'p2pk') { const s = sigFor(t.pubkey); return s ? [s.signature] : null; }
    if (t.type === 'multisig') {
      const sigs = t.pubkeys.map(sigFor).filter(Boolean).slice(0, t.m);
      return sigs.length === t.m ? [new Uint8Array(0), ...sigs.map((s) => s.signature)] : null;
    }
    return null;
  };
  const asScriptSig = (items) => pushes(items.map((x) => (x.length ? x : S.OPS.OP_0)));
  if (c.type === 'p2pkh' || c.type === 'p2pk' || c.type === 'multisig') {
    const items = satisfy(prevScript);
    return items ? { scriptSig: asScriptSig(items) } : null;
  }
  if (c.type === 'p2wpkh') {
    const s = (inp.partialSigs || []).find((x) => equalBytes(hash160(x.pubkey), c.hash));
    return s ? { witness: [s.signature, s.pubkey] } : null;
  }
  if (c.type === 'p2wsh') {
    if (!inp.witnessScript) return null;
    const items = satisfy(inp.witnessScript);
    return items ? { witness: [...items, inp.witnessScript] } : null;
  }
  if (c.type === 'p2sh') {
    if (!inp.redeemScript) return null;
    const rc = S.classify(inp.redeemScript);
    const redeemPush = S.pushData(inp.redeemScript);
    if (rc.type === 'p2wpkh') {
      const s = (inp.partialSigs || []).find((x) => equalBytes(hash160(x.pubkey), rc.hash));
      return s ? { scriptSig: redeemPush, witness: [s.signature, s.pubkey] } : null;
    }
    if (rc.type === 'p2wsh') {
      if (!inp.witnessScript) return null;
      const items = satisfy(inp.witnessScript);
      return items ? { scriptSig: redeemPush, witness: [...items, inp.witnessScript] } : null;
    }
    const items = satisfy(inp.redeemScript);
    return items ? { scriptSig: concatBytes(asScriptSig(items), redeemPush) } : null;
  }
  if (c.type === 'p2tr') {
    if (inp.tapKeySig) return { witness: [inp.tapKeySig] };
    // Script path: the cheapest leaf with enough signatures (pk(K) or multi_a).
    let best = null;
    for (const leaf of inp.tapLeafScripts || []) {
      const lh = tapLeafHash(leaf.script, leaf.leafVersion);
      const sigOf = (k) => (inp.tapScriptSigs || []).find((s) => equalBytes(s.pubkey, k) && equalBytes(s.leafHash, lh));
      let chunks;
      try { chunks = S.decompile(leaf.script); } catch { continue; }
      let items = null;
      if (chunks.length === 2 && chunks[0].data && chunks[0].data.length === 32 && chunks[1].op === S.OPS.OP_CHECKSIG) {
        const s = sigOf(chunks[0].data);
        if (s) items = [s.signature];
      } else if (chunks.length >= 4 && chunks[chunks.length - 1].op === S.OPS.OP_NUMEQUAL) {
        const keys = [];
        for (let k = 0; k + 1 < chunks.length - 2; k += 2) {
          if (!chunks[k].data || chunks[k].data.length !== 32) { keys.length = 0; break; }
          keys.push(chunks[k].data);
        }
        const mc = chunks[chunks.length - 2];
        const m = mc.data ? S.scriptNumDecode(mc.data) : S.smallInt(mc.op);
        if (keys.length && m) {
          const sigs = keys.map(sigOf);
          if (sigs.filter(Boolean).length >= m) {
            let need = m;
            // Witness items are consumed in reverse key order: the last key's signature first on the stack.
            items = [...sigs].reverse().map((s) => (s && need-- > 0 ? s.signature : new Uint8Array(0)));
          }
        }
      }
      if (items) {
        const w = [...items, leaf.script, leaf.controlBlock];
        const size = w.reduce((a, x) => a + x.length, 0);
        if (!best || size < best.size) best = { w, size };
      }
    }
    return best ? { witness: best.w } : null;
  }
  return null;
}

// Union of fields: arrays of keyed records are merged by key, scalars are taken when missing.
// On conflicting scalars the first PSBT wins (BIP-174 leaves the choice to the combiner). finalScriptWitness and
// tapTree are whole values, not record lists, so they are never merged element-wise.
function mergeMap(a, b) {
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && Array.isArray(a[k]) && k !== 'finalScriptWitness' && k !== 'tapTree') {
      const seen = new Set(a[k].map(recordKey));
      for (const x of v) if (!seen.has(recordKey(x))) { a[k].push(x); seen.add(recordKey(x)); }
    } else if (a[k] === undefined || a[k] === null || (Array.isArray(a[k]) && !a[k].length)) a[k] = v;
  }
}

const recordKey = (x) => {
  if (x && x.key) return hex(x.key);
  if (x && x.pubkey && x.leafHash) return hex(x.pubkey) + hex(x.leafHash);
  if (x && x.pubkey) return hex(x.pubkey);
  if (x && x.controlBlock) return hex(x.controlBlock);
  if (x && x.hash) return hex(x.hash);
  if (x && x.xpub) return hex(x.xpub);
  return JSON.stringify(x);
};

// --- parsing -------------------------------------------------------------------------------------

function readMap(r) {
  const pairs = [];
  const seen = new Set();
  for (;;) {
    if (r.done()) fail('Missing separator');
    const klen = r.varint();
    if (klen === 0) return pairs;
    const key = r.bytes(klen);
    const value = r.varbytes();
    const kh = hex(key);
    if (seen.has(kh)) fail('Duplicate Key');
    seen.add(kh);
    pairs.push([key, value]);
  }
}

// Global map first; its version decides the rest: v0 requires the unsigned tx and forbids the v2 globals, v2 the
// reverse. The number of input / output maps comes from the tx (v0) or the count fields (v2), and trailing data
// after the last map is an error.
function parsePsbt(bytes) {
  if (bytes.length < 5 || !equalBytes(bytes.subarray(0, 5), MAGIC)) fail('Invalid PSBT magic bytes');
  const r = new Reader(bytes, 5);
  const p = new Psbt();
  const g = p.global;
  let version = null;
  for (const [key, v] of readMap(r)) {
    const { type, data } = readKeyType(key);
    switch (type) {
      case PSBT_GLOBAL.UNSIGNED_TX: {
        needKeyLen(data, 0, 'Global Unsigned TX');
        const tx = Transaction.fromBytes(v, { witness: false, allowTrailing: true });
        if (tx._bytesRead !== v.length) fail('Size of value was not the stated size');
        if (tx.inputs.some((i) => i.scriptSig.length || i.witness.length)) fail('Unsigned tx does not have empty scriptSigs and scriptWitnesses.');
        g.tx = tx;
        break;
      }
      case PSBT_GLOBAL.XPUB: {
        if (data.length !== 78) fail('Size of key was not the expected size for the type global xpub');
        g.xpubs.push({ xpub: data.slice(), ...parseOrigin(v, 'global xpub') });
        break;
      }
      case PSBT_GLOBAL.TX_VERSION: needKeyLen(data, 0, 'global tx version'); g.txVersion = readI32(v, 'tx version'); break;
      case PSBT_GLOBAL.FALLBACK_LOCKTIME: needKeyLen(data, 0, 'global fallback locktime'); g.fallbackLocktime = readU32(v, 'fallback locktime'); break;
      case PSBT_GLOBAL.INPUT_COUNT: { needKeyLen(data, 0, 'global input count'); const rr = new Reader(v); g.inputCount = rr.varint(); if (!rr.done()) fail('Size of value was not the stated size'); break; }
      case PSBT_GLOBAL.OUTPUT_COUNT: { needKeyLen(data, 0, 'global output count'); const rr = new Reader(v); g.outputCount = rr.varint(); if (!rr.done()) fail('Size of value was not the stated size'); break; }
      case PSBT_GLOBAL.TX_MODIFIABLE: needKeyLen(data, 0, 'global tx modifiable'); if (v.length !== 1) fail('Size of value was not the stated size'); g.txModifiable = v[0]; break;
      case PSBT_GLOBAL.VERSION: needKeyLen(data, 0, 'global version'); version = readU32(v, 'version'); break;
      case PSBT_GLOBAL.PROPRIETARY: g.proprietary.push({ key: key.slice(), value: v.slice() }); break;
      default: g.unknown.push({ key: key.slice(), value: v.slice() });
    }
  }
  p.version = version ?? 0;
  if (p.version !== 0 && p.version !== 2) fail('Unsupported version number');
  let nIn, nOut;
  if (p.version === 0) {
    if (!g.tx) fail('No unsigned transaction was provided');
    for (const k of ['txVersion', 'fallbackLocktime', 'inputCount', 'outputCount', 'txModifiable']) if (g[k] !== undefined) fail(`PSBT_GLOBAL_${k} is not allowed in PSBTv0`);
    nIn = g.tx.inputs.length; nOut = g.tx.outputs.length;
  } else {
    if (g.tx) fail('PSBT_GLOBAL_UNSIGNED_TX is not allowed in PSBTv2');
    if (g.txVersion === undefined) fail('PSBT_GLOBAL_TX_VERSION is required in PSBTv2');
    if (g.inputCount === undefined) fail('PSBT_GLOBAL_INPUT_COUNT is required in PSBTv2');
    if (g.outputCount === undefined) fail('PSBT_GLOBAL_OUTPUT_COUNT is required in PSBTv2');
    nIn = g.inputCount; nOut = g.outputCount;
  }
  for (let i = 0; i < nIn; i++) {
    if (r.done()) fail('Inputs provided does not match the number of inputs in transaction.');
    p.inputs.push(parseInput(readMap(r), p.version, p.version === 0 ? g.tx.inputs[i] : null));
  }
  for (let i = 0; i < nOut; i++) {
    if (r.done()) fail('Outputs provided does not match the number of outputs in transaction.');
    p.outputs.push(parseOutput(readMap(r), p.version));
  }
  if (!r.done()) fail('Trailing data after the PSBT');
  return p;
}

function parseHashPreimage(list, data, v, n, fn, what) {
  if (data.length !== n) fail(`Size of key was not the expected size for the type ${what} preimage`);
  if (!equalBytes(fn(v), data)) fail(`Provided ${what} preimage does not match`);
  list.push({ hash: data.slice(), preimage: v.slice() });
}

function parseInput(pairs, version, txin) {
  const inp = {};
  const list = (k) => (inp[k] = inp[k] || []);
  for (const [key, v] of pairs) {
    const { type, data } = readKeyType(key);
    switch (type) {
      // The raw bytes are kept (_nwuRaw) and re-emitted verbatim: the previous tx may be serialized with witnesses,
      // and re-encoding could differ from what the creator sent while the txid check still passes.
      case PSBT_IN.NON_WITNESS_UTXO: {
        needKeyLen(data, 0, 'input non-witness utxo');
        const tx = Transaction.fromBytes(v, { allowTrailing: true });
        if (tx._bytesRead !== v.length) fail('Size of value was not the stated size');
        inp.nonWitnessUtxo = tx;
        inp._nwuRaw = v.slice();
        break;
      }
      case PSBT_IN.WITNESS_UTXO: needKeyLen(data, 0, 'input witness utxo'); inp.witnessUtxo = readTxOut(v); break;
      case PSBT_IN.PARTIAL_SIG: {
        if (data.length !== 33 && data.length !== 65) fail('Size of key was not the expected size for the type partial signature pubkey');
        needPubkey(data, 'Input partial signature pubkey');
        list('partialSigs').push({ pubkey: data.slice(), signature: v.slice() });
        break;
      }
      case PSBT_IN.SIGHASH_TYPE: needKeyLen(data, 0, 'sighash type'); inp.sighashType = readI32(v, 'sighash type'); break;
      case PSBT_IN.REDEEM_SCRIPT: needKeyLen(data, 0, 'input redeemScript'); inp.redeemScript = v.slice(); break;
      case PSBT_IN.WITNESS_SCRIPT: needKeyLen(data, 0, 'input witnessScript'); inp.witnessScript = v.slice(); break;
      case PSBT_IN.BIP32_DERIVATION: {
        if (data.length !== 33 && data.length !== 65) fail('Size of key was not the expected size for the type BIP32 keypath');
        needPubkey(data, 'Input BIP32 keypath pubkey');
        list('bip32Derivation').push({ pubkey: data.slice(), ...parseOrigin(v, 'Input BIP32 keypath') });
        break;
      }
      case PSBT_IN.FINAL_SCRIPTSIG: needKeyLen(data, 0, 'input final scriptSig'); inp.finalScriptSig = v.slice(); break;
      case PSBT_IN.FINAL_SCRIPTWITNESS: needKeyLen(data, 0, 'input final scriptWitness'); inp.finalScriptWitness = readWitnessStack(v); break;
      case PSBT_IN.RIPEMD160: parseHashPreimage(list('ripemd160'), data, v, 20, ripemd160, 'ripemd160'); break;
      case PSBT_IN.SHA256: parseHashPreimage(list('sha256'), data, v, 32, sha256, 'sha256'); break;
      case PSBT_IN.HASH160: parseHashPreimage(list('hash160'), data, v, 20, hash160, 'hash160'); break;
      case PSBT_IN.HASH256: parseHashPreimage(list('hash256'), data, v, 32, hash256, 'hash256'); break;
      case PSBT_IN.PREVIOUS_TXID: needKeyLen(data, 0, 'previous txid'); if (v.length !== 32) fail('Size of value was not the stated size'); inp.previousTxid = bytesToHexLE(v); break;
      case PSBT_IN.OUTPUT_INDEX: needKeyLen(data, 0, 'output index'); inp.outputIndex = readU32(v, 'output index'); break;
      case PSBT_IN.SEQUENCE: needKeyLen(data, 0, 'sequence'); inp.sequence = readU32(v, 'sequence'); break;
      // BIP-370 locktime requirements must be of the right kind: time >= 500 000 000, height 1 .. 499 999 999.
      case PSBT_IN.REQUIRED_TIME_LOCKTIME: {
        needKeyLen(data, 0, 'required time locktime');
        const t = readU32(v, 'time locktime');
        if (t < 500000000) fail(`Required time based locktime is invalid (${t})`);
        inp.requiredTimeLocktime = t;
        break;
      }
      case PSBT_IN.REQUIRED_HEIGHT_LOCKTIME: {
        needKeyLen(data, 0, 'required height locktime');
        const t = readU32(v, 'height locktime');
        if (t === 0 || t >= 500000000) fail(`Required height based locktime is invalid (${t})`);
        inp.requiredHeightLocktime = t;
        break;
      }
      case PSBT_IN.TAP_KEY_SIG: {
        needKeyLen(data, 0, 'input Taproot key signature');
        if (v.length !== 64 && v.length !== 65) fail('Input Taproot key path signature is shorter than 64 bytes or longer than 65 bytes');
        inp.tapKeySig = v.slice();
        break;
      }
      case PSBT_IN.TAP_SCRIPT_SIG: {
        if (data.length !== 64) fail('Size of key was not the expected size for the type Input Taproot script signature');
        if (v.length !== 64 && v.length !== 65) fail('Input Taproot script path signature is shorter than 64 bytes or longer than 65 bytes');
        list('tapScriptSigs').push({ pubkey: data.slice(0, 32), leafHash: data.slice(32), signature: v.slice() });
        break;
      }
      case PSBT_IN.TAP_LEAF_SCRIPT: {
        if (data.length < 33 || (data.length - 33) % 32) fail('Input Taproot leaf script key is not at least 34 bytes or is not 33 + 32k');
        if (!v.length) fail('Input Taproot leaf script must be at least 1 byte');
        const cb = data.slice();
        parseControlBlock(cb);
        list('tapLeafScripts').push({ controlBlock: cb, script: v.slice(0, -1), leafVersion: v[v.length - 1] });
        break;
      }
      case PSBT_IN.TAP_BIP32_DERIVATION: {
        if (data.length !== 32) fail('Size of key was not the expected size for the type Input Taproot BIP32 keypath');
        list('tapBip32Derivation').push({ pubkey: data.slice(), ...parseTapOrigin(v, 'Input Taproot BIP32 keypath') });
        break;
      }
      case PSBT_IN.TAP_INTERNAL_KEY: {
        needKeyLen(data, 0, 'Input Taproot internal key');
        if (v.length !== 32) fail('Input Taproot internal key is not 32 bytes');
        inp.tapInternalKey = v.slice();
        break;
      }
      case PSBT_IN.TAP_MERKLE_ROOT: {
        needKeyLen(data, 0, 'Input Taproot merkle root');
        if (v.length !== 32) fail('Input Taproot merkle root is not 32 bytes');
        inp.tapMerkleRoot = v.slice();
        break;
      }
      // BIP-373 MuSig2 fields: only sizes and curve points are validated; the values are carried, not used (no MuSig2
      // signing here).
      case PSBT_IN.MUSIG2_PARTICIPANT_PUBKEYS: list('musig2Participants').push(parseMusigParticipants(data, v, 'Input')); break;
      case PSBT_IN.MUSIG2_PUB_NONCE:
      case PSBT_IN.MUSIG2_PARTIAL_SIG: {
        const nonce = type === PSBT_IN.MUSIG2_PUB_NONCE;
        if (data.length !== 66 && data.length !== 98) fail(`Input musig2 ${nonce ? 'pubnonce' : 'partial sig'} key is not expected size`);
        if (!isValidPublicKey(data.subarray(0, 33))) fail('musig2 participant pubkey is invalid');
        if (!isValidPublicKey(data.subarray(33, 66))) fail('musig2 aggregate pubkey is invalid');
        if (nonce && v.length !== 66) fail('Input musig2 pubnonce value is not 66 bytes');
        if (!nonce && v.length !== 32) fail('Size of value was not the stated size');
        list(nonce ? 'musig2PubNonces' : 'musig2PartialSigs').push({ key: key.slice(), value: v.slice() });
        break;
      }
      case PSBT_IN.PROPRIETARY: list('proprietary').push({ key: key.slice(), value: v.slice() }); break;
      default: list('unknown').push({ key: key.slice(), value: v.slice() });
    }
  }
  if (version === 0) {
    for (const k of ['previousTxid', 'outputIndex', 'sequence', 'requiredTimeLocktime', 'requiredHeightLocktime']) if (inp[k] !== undefined) fail(`${k} is not allowed in PSBTv0`);
    if (inp.nonWitnessUtxo && txin && inp.nonWitnessUtxo.txid() !== txin.txid) fail('Non-witness UTXO does not match outpoint hash');
    if (inp.nonWitnessUtxo && txin && txin.vout >= inp.nonWitnessUtxo.outputs.length) fail('Input specifies output index that does not exist');
  } else {
    if (inp.previousTxid === undefined) fail('Previous TXID is required in PSBTv2');
    if (inp.outputIndex === undefined) fail('Previous output\'s index is required in PSBTv2');
    if (inp.nonWitnessUtxo && inp.nonWitnessUtxo.txid() !== inp.previousTxid) fail('Non-witness UTXO does not match outpoint hash');
    if (inp.nonWitnessUtxo && inp.outputIndex >= inp.nonWitnessUtxo.outputs.length) fail('Input specifies output index that does not exist');
  }
  return inp;
}

function parseTapOrigin(v, what) {
  const r = new Reader(v);
  let n;
  try { n = r.varint(); } catch { fail(`${what} has an invalid length`); }
  if (r.left < n * 32 + 4 || (r.left - n * 32) % 4) fail(`${what} has an invalid length`);
  const leafHashes = [];
  for (let i = 0; i < n; i++) leafHashes.push(r.bytes(32).slice());
  return { leafHashes, ...parseOrigin(v.subarray(r.pos), what) };
}

function parseMusigParticipants(data, v, where) {
  if (data.length !== 33) fail(`Size of key was not 34 for the type ${where} MuSig2 Participants Pubkeys`);
  if (!isValidPublicKey(data)) fail(`${where} musig2 aggregate pubkey is invalid`);
  const participants = [];
  let o = 0;
  for (; o + 33 <= v.length; o += 33) {
    const pk = v.subarray(o, o + 33);
    if (!isValidPublicKey(pk)) fail(`${where} musig2 participant pubkey is invalid`);
    participants.push(pk.slice());
  }
  if (o !== v.length) fail(`${where} musig2 participants pubkeys value size is not a multiple of 33`);
  return { aggregate: data.slice(), participants };
}

function parseOutput(pairs, version) {
  const out = {};
  const list = (k) => (out[k] = out[k] || []);
  for (const [key, v] of pairs) {
    const { type, data } = readKeyType(key);
    switch (type) {
      case PSBT_OUT.REDEEM_SCRIPT: needKeyLen(data, 0, 'output redeemScript'); out.redeemScript = v.slice(); break;
      case PSBT_OUT.WITNESS_SCRIPT: needKeyLen(data, 0, 'output witnessScript'); out.witnessScript = v.slice(); break;
      case PSBT_OUT.BIP32_DERIVATION: {
        if (data.length !== 33 && data.length !== 65) fail('Size of key was not the expected size for the type BIP32 keypath');
        needPubkey(data, 'Output BIP32 keypath pubkey');
        list('bip32Derivation').push({ pubkey: data.slice(), ...parseOrigin(v, 'Output BIP32 keypath') });
        break;
      }
      case PSBT_OUT.AMOUNT: {
        needKeyLen(data, 0, 'output amount');
        if (v.length !== 8) fail('Size of value was not the stated size');
        // Read as BigInt to apply Core's int64 sign check. KNOWN DEFECT: values between 2^53 and 2^63 (far above
        // MAX_MONEY) are then converted to Number with rounding instead of rejected. Fix: fail when amount > MAX_MONEY.
        const amount = new Reader(v).u64big();
        if (amount >= 1n << 63n) fail('Output amount is negative');
        out.amount = Number(amount);
        break;
      }
      case PSBT_OUT.SCRIPT: needKeyLen(data, 0, 'output script'); out.script = v.slice(); break;
      case PSBT_OUT.TAP_INTERNAL_KEY: {
        needKeyLen(data, 0, 'Output Taproot internal key');
        if (v.length !== 32) fail('Output Taproot internal key is not 32 bytes');
        out.tapInternalKey = v.slice();
        break;
      }
      case PSBT_OUT.TAP_TREE: {
        needKeyLen(data, 0, 'Output Taproot tree');
        if (!v.length) fail('Output Taproot tree must not be empty');
        const r = new Reader(v);
        const leaves = [];
        while (!r.done()) {
          const depth = r.u8(), leafVersion = r.u8();
          if (depth > 128) fail('Output Taproot tree has as leaf greater than Taproot maximum depth');
          if (leafVersion & 1) fail('Output Taproot tree has a leaf with an invalid leaf version');
          leaves.push({ depth, leafVersion, script: r.varbytes().slice() });
        }
        try { tapTreeFromList(leaves); } catch { fail('Output Taproot tree is malformed'); }
        out.tapTree = leaves;
        break;
      }
      case PSBT_OUT.TAP_BIP32_DERIVATION: {
        if (data.length !== 32) fail('Size of key was not the expected size for the type Output Taproot BIP32 keypath');
        list('tapBip32Derivation').push({ pubkey: data.slice(), ...parseTapOrigin(v, 'Output Taproot BIP32 keypath') });
        break;
      }
      case PSBT_OUT.MUSIG2_PARTICIPANT_PUBKEYS: list('musig2Participants').push(parseMusigParticipants(data, v, 'Output')); break;
      case PSBT_OUT.PROPRIETARY: list('proprietary').push({ key: key.slice(), value: v.slice() }); break;
      default: list('unknown').push({ key: key.slice(), value: v.slice() });
    }
  }
  if (version === 0) {
    if (out.amount !== undefined || out.script !== undefined) fail('Output amount and script are not allowed in PSBTv0');
  } else {
    if (out.amount === undefined) fail('Output amount is required in PSBTv2');
    if (out.script === undefined) fail('Output script is required in PSBTv2');
  }
  return out;
}

// --- serialization (Bitcoin Core's order) ---------------------------------------------------------

// Core's order: per map, fields by type number, multi-record fields sorted by key bytes (partial signatures by the
// HASH160 of the pubkey, as Core's std::map<CKeyID, …> iterates). Finalized inputs omit the signing fields.
function serializePsbt(p) {
  const w = new Writer(1024);
  w.bytes(MAGIC);
  const kv = (key, value) => { w.varbytes(key); w.varbytes(value); };
  const g = p.global;
  if (p.version === 0) kv(keyBytes(PSBT_GLOBAL.UNSIGNED_TX), g.tx.toBytes({ witness: false }));
  for (const x of [...g.xpubs].sort((a, b) => a.fingerprint - b.fingerprint || cmpPath(a.path, b.path) || cmp(a.xpub, b.xpub))) kv(keyBytes(PSBT_GLOBAL.XPUB, x.xpub), originBytes(x));
  if (p.version === 2) {
    kv(keyBytes(PSBT_GLOBAL.TX_VERSION), new Writer().i32(g.txVersion).finish());
    if (g.fallbackLocktime !== undefined) kv(keyBytes(PSBT_GLOBAL.FALLBACK_LOCKTIME), u32le(g.fallbackLocktime));
    kv(keyBytes(PSBT_GLOBAL.INPUT_COUNT), new Writer().varint(p.inputs.length).finish());
    kv(keyBytes(PSBT_GLOBAL.OUTPUT_COUNT), new Writer().varint(p.outputs.length).finish());
    if (g.txModifiable !== undefined) kv(keyBytes(PSBT_GLOBAL.TX_MODIFIABLE), Uint8Array.of(g.txModifiable));
  }
  if (p.version > 0) kv(keyBytes(PSBT_GLOBAL.VERSION), u32le(p.version));
  for (const x of sortByKey(g.proprietary)) kv(x.key, x.value);
  for (const x of sortByKey(g.unknown)) kv(x.key, x.value);
  w.u8(0);
  for (const inp of p.inputs) { writeInput(kv, inp, p.version); w.u8(0); }
  for (const out of p.outputs) { writeOutput(kv, out, p.version); w.u8(0); }
  return w.finish();
}

const sortByKey = (list) => [...(list || [])].sort((a, b) => cmp(a.key, b.key));

function writeInput(kv, inp, version) {
  if (inp.nonWitnessUtxo) kv(keyBytes(PSBT_IN.NON_WITNESS_UTXO), inp._nwuRaw || inp.nonWitnessUtxo.toBytes());
  if (inp.witnessUtxo) kv(keyBytes(PSBT_IN.WITNESS_UTXO), txOutBytes(inp.witnessUtxo));
  const final = inp.finalScriptSig || inp.finalScriptWitness;
  if (!final) {
    for (const s of [...(inp.partialSigs || [])].sort((a, b) => cmp(hash160(a.pubkey), hash160(b.pubkey)))) kv(keyBytes(PSBT_IN.PARTIAL_SIG, s.pubkey), s.signature);
    if (inp.sighashType !== undefined) kv(keyBytes(PSBT_IN.SIGHASH_TYPE), new Writer().i32(inp.sighashType).finish());
    if (inp.redeemScript) kv(keyBytes(PSBT_IN.REDEEM_SCRIPT), inp.redeemScript);
    if (inp.witnessScript) kv(keyBytes(PSBT_IN.WITNESS_SCRIPT), inp.witnessScript);
    for (const d of [...(inp.bip32Derivation || [])].sort((a, b) => cmp(a.pubkey, b.pubkey))) kv(keyBytes(PSBT_IN.BIP32_DERIVATION, d.pubkey), originBytes(d));
    for (const [k, t] of [['ripemd160', PSBT_IN.RIPEMD160], ['sha256', PSBT_IN.SHA256], ['hash160', PSBT_IN.HASH160], ['hash256', PSBT_IN.HASH256]]) {
      for (const x of [...(inp[k] || [])].sort((a, b) => cmp(a.hash, b.hash))) kv(keyBytes(t, x.hash), x.preimage);
    }
    if (inp.tapKeySig) kv(keyBytes(PSBT_IN.TAP_KEY_SIG), inp.tapKeySig);
    for (const s of [...(inp.tapScriptSigs || [])].sort((a, b) => cmp(a.pubkey, b.pubkey) || cmp(a.leafHash, b.leafHash))) kv(keyBytes(PSBT_IN.TAP_SCRIPT_SIG, concatBytes(s.pubkey, s.leafHash)), s.signature);
    for (const l of [...(inp.tapLeafScripts || [])].sort((a, b) => cmp(a.script, b.script) || a.leafVersion - b.leafVersion || cmp(a.controlBlock, b.controlBlock))) {
      kv(keyBytes(PSBT_IN.TAP_LEAF_SCRIPT, l.controlBlock), concatBytes(l.script, Uint8Array.of(l.leafVersion)));
    }
    for (const d of [...(inp.tapBip32Derivation || [])].sort((a, b) => cmp(a.pubkey, b.pubkey))) kv(keyBytes(PSBT_IN.TAP_BIP32_DERIVATION, d.pubkey), tapOriginBytes(d));
    if (inp.tapInternalKey) kv(keyBytes(PSBT_IN.TAP_INTERNAL_KEY), inp.tapInternalKey);
    if (inp.tapMerkleRoot) kv(keyBytes(PSBT_IN.TAP_MERKLE_ROOT), inp.tapMerkleRoot);
    for (const m of inp.musig2Participants || []) kv(keyBytes(PSBT_IN.MUSIG2_PARTICIPANT_PUBKEYS, m.aggregate), concatBytes(...m.participants));
    for (const x of sortByKey(inp.musig2PubNonces)) kv(x.key, x.value);
    for (const x of sortByKey(inp.musig2PartialSigs)) kv(x.key, x.value);
  }
  if (version === 2) {
    kv(keyBytes(PSBT_IN.PREVIOUS_TXID), hexToBytesLE(inp.previousTxid));
    kv(keyBytes(PSBT_IN.OUTPUT_INDEX), u32le(inp.outputIndex));
    if (inp.sequence !== undefined) kv(keyBytes(PSBT_IN.SEQUENCE), u32le(inp.sequence));
    if (inp.requiredTimeLocktime !== undefined) kv(keyBytes(PSBT_IN.REQUIRED_TIME_LOCKTIME), u32le(inp.requiredTimeLocktime));
    if (inp.requiredHeightLocktime !== undefined) kv(keyBytes(PSBT_IN.REQUIRED_HEIGHT_LOCKTIME), u32le(inp.requiredHeightLocktime));
  }
  if (inp.finalScriptSig) kv(keyBytes(PSBT_IN.FINAL_SCRIPTSIG), inp.finalScriptSig);
  if (inp.finalScriptWitness) kv(keyBytes(PSBT_IN.FINAL_SCRIPTWITNESS), witnessStackBytes(inp.finalScriptWitness));
  for (const x of sortByKey(inp.proprietary)) kv(x.key, x.value);
  for (const x of sortByKey(inp.unknown)) kv(x.key, x.value);
}

const tapOriginBytes = (d) => concatBytes(new Writer().varint(d.leafHashes.length).finish(), ...d.leafHashes, originBytes(d));

function writeOutput(kv, out, version) {
  if (out.redeemScript) kv(keyBytes(PSBT_OUT.REDEEM_SCRIPT), out.redeemScript);
  if (out.witnessScript) kv(keyBytes(PSBT_OUT.WITNESS_SCRIPT), out.witnessScript);
  for (const d of [...(out.bip32Derivation || [])].sort((a, b) => cmp(a.pubkey, b.pubkey))) kv(keyBytes(PSBT_OUT.BIP32_DERIVATION, d.pubkey), originBytes(d));
  if (version === 2) {
    kv(keyBytes(PSBT_OUT.AMOUNT), new Writer().u64(out.amount).finish());
    kv(keyBytes(PSBT_OUT.SCRIPT), out.script);
  }
  if (out.tapInternalKey) kv(keyBytes(PSBT_OUT.TAP_INTERNAL_KEY), out.tapInternalKey);
  if (out.tapTree) {
    const w = new Writer();
    for (const l of out.tapTree) w.u8(l.depth).u8(l.leafVersion).varbytes(l.script);
    kv(keyBytes(PSBT_OUT.TAP_TREE), w.finish());
  }
  for (const d of [...(out.tapBip32Derivation || [])].sort((a, b) => cmp(a.pubkey, b.pubkey))) kv(keyBytes(PSBT_OUT.TAP_BIP32_DERIVATION, d.pubkey), tapOriginBytes(d));
  for (const m of out.musig2Participants || []) kv(keyBytes(PSBT_OUT.MUSIG2_PARTICIPANT_PUBKEYS, m.aggregate), concatBytes(...m.participants));
  for (const x of sortByKey(out.proprietary)) kv(x.key, x.value);
  for (const x of sortByKey(out.unknown)) kv(x.key, x.value);
}

// A script tree of a PSBT output as a nested tree for taproot.js.
export const outputTapTree = (out) => (out.tapTree ? tapTreeFromList(out.tapTree) : null);

export { PsbtError, tapTree, rootFromControlBlock };
