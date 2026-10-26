// bitcoin/tx.js - Bitcoin transactions: parse and serialize (with the BIP-144 segwit marker), txid / wtxid, size,
// weight and virtual size, and the three signature hash algorithms: legacy (Core's SignatureHash, including the
// SIGHASH_SINGLE bug and OP_CODESEPARATOR removal), BIP-143 (segwit v0) and BIP-341 (taproot key and script paths).
//
//   Transaction.fromBytes(bytes) / fromHex(hex) / new Transaction({ version, locktime, inputs, outputs })
//     input  { txid (display hex), vout, scriptSig: Uint8Array, sequence, witness: [Uint8Array] }
//     output { value (satoshis, Number), script: Uint8Array }
//   tx.toBytes({ witness = true }), tx.toHex(), tx.txid(), tx.wtxid(), tx.hasWitness, tx.size(), tx.baseSize(),
//   tx.weight(), tx.vsize(), tx.clone(), tx.isCoinbase(), tx.signalsRbf(), tx.addInput(…), tx.addOutput(…)
//   tx.sighashLegacy(index, scriptCode, hashType) -> 32 bytes (internal byte order)
//   tx.sighashV0(index, scriptCode, value, hashType)            BIP-143
//   tx.sighashTaproot(index, prevouts [{ value, script }], hashType = 0, { leafHash, codeSeparatorPos, annex })
//   tx.sigMsgTaproot(...) -> the epoch byte 0x00 + the BIP-341 SigMsg (the input of the TapSighash tagged hash)
//   SIGHASH { DEFAULT, ALL, NONE, SINGLE, ANYONECANPAY }, MAX_SEQUENCE, RBF_SEQUENCE
//
// Why three sighash algorithms:
// - Legacy (pre-segwit) re-serializes the whole transaction per input: O(n^2) hashing for n inputs (the "quadratic
//   hashing" DoS) and no commitment to the spent amount, so an offline signer cannot know the fee it signs.
// - BIP-143 (segwit v0) hashes shared parts once (hashPrevouts / hashSequence / hashOutputs) and commits to the
//   input's own amount: linear cost; a lie about the amount yields an invalid signature.
// - BIP-341 (taproot) commits to *all* spent amounts and scriptPubKeys (sha_amounts / sha_scriptpubkeys), closing the
//   remaining hole of BIP-143: a signer shown false amounts for the *other* inputs could be tricked into overpaying
//   fees (CVE-2020-14199 class). It uses single SHA-256 of each part and a tagged hash at the end.
// txid excludes witnesses (BIP-141): signatures can then be malleated without changing the txid, which is what makes
// chains of unconfirmed transactions (Lightning) safe. wtxid includes them.
import { sha256 } from '../crypto/sha2.js';
import { bytesToHex, hexToBytes } from '../crypto/encoding.js';
import { taggedHash } from '../crypto/secp256k1.js';
import { Reader, Writer, bytesToHexLE, hexToBytesLE } from './bytes.js';
import { getOp, OPS } from './script.js';

export const SIGHASH = Object.freeze({ DEFAULT: 0x00, ALL: 0x01, NONE: 0x02, SINGLE: 0x03, ANYONECANPAY: 0x80 });
export const MAX_SEQUENCE = 0xffffffff;
// nSequence of a new input: signals replace-by-fee (BIP-125), allows nLockTime.
export const RBF_SEQUENCE = 0xfffffffd;

const hash256 = (b) => sha256(sha256(b));
const ZERO32 = new Uint8Array(32);
// uint256 1 in internal order: the value Core's legacy SignatureHash returns for an out-of-range input or the
// SIGHASH_SINGLE bug (see sighashLegacy).
const ONE =(() => { const b = new Uint8Array(32); b[0] = 1; return b; })();

const toBytesAny = (x) => (typeof x === 'string' ? hexToBytes(x) : x || new Uint8Array(0));

export class Transaction {
  constructor({ version = 2, locktime = 0, inputs = [], outputs = [] } = {}) {
    this.version = version;
    this.locktime = locktime;
    this.inputs = inputs.map((i) => ({ txid: i.txid, vout: i.vout, scriptSig: toBytesAny(i.scriptSig), sequence: i.sequence ?? MAX_SEQUENCE, witness: (i.witness || []).map(toBytesAny) }));
    this.outputs = outputs.map((o) => ({ value: o.value, script: toBytesAny(o.script) }));
  }

  static fromHex(hex) { return Transaction.fromBytes(hexToBytes(String(hex).trim())); }

  // Core's UnserializeTransaction: an empty input list followed by flag 0x01 means witness data.
  // witness: false reads the legacy serialization only (PSBT unsigned transactions).
  // The marker 0x00 is the CompactSize of an empty input list, which no valid tx has: that is how BIP-144 stays
  // unambiguous for old parsers. A zero next byte means "0 inputs, 0 outputs" (Core reads it as flags = 0 and leaves
  // vout empty - same result). An all-empty witness section after flag 1 is rejected ("superfluous witness record",
  // Core's exact rule): otherwise one tx would have two serializations and two wtxids.
  // Core's ambiguity with 64-byte transactions (a valid tx that parses as an inner merkle node) is not addressed here.
  static fromBytes(bytes, { allowTrailing = false, witness = true } = {}) {
    const r = new Reader(bytes);
    const tx = new Transaction();
    tx.version = r.i32();
    let flags = 0;
    let nIn = r.varint();
    if (witness && nIn === 0 && r.left > 0 && r.b[r.pos] !== 0) {
      flags = r.u8();
      if (flags !== 1) throw new Error('unknown transaction optional data');
      nIn = r.varint();
    }
    const readInputs = (n) => {
      for (let i = 0; i < n; i++) {
        const txid = bytesToHexLE(r.bytes(32));
        const vout = r.u32();
        const scriptSig = r.varbytes().slice();
        tx.inputs.push({ txid, vout, scriptSig, sequence: r.u32(), witness: [] });
      }
    };
    readInputs(nIn);
    const nOut = r.varint();
    for (let i = 0; i < nOut; i++) {
      const value = r.u64();
      tx.outputs.push({ value, script: r.varbytes().slice() });
    }
    if (flags & 1) {
      let any = false;
      for (const inp of tx.inputs) {
        const n = r.varint();
        for (let k = 0; k < n; k++) inp.witness.push(r.varbytes().slice());
        if (n) any = true;
      }
      if (!any) throw new Error('superfluous witness record');
    }
    tx.locktime = r.u32();
    if (!allowTrailing && !r.done()) throw new Error('trailing bytes after the transaction');
    tx._bytesRead = r.pos;
    return tx;
  }

  get hasWitness() { return this.inputs.some((i) => i.witness && i.witness.length); }

  // Writes the BIP-144 form only when some input has witness data; a tx without witnesses must serialize legacy-style,
  // or its "wtxid" would differ from its txid and Core would reject the encoding.
  toBytes({ witness = true } = {}) {
    const w = new Writer(64 + this.inputs.length * 150 + this.outputs.length * 40);
    const seg = witness && this.hasWitness;
    w.i32(this.version);
    if (seg) w.u8(0).u8(1);
    w.varint(this.inputs.length);
    for (const i of this.inputs) w.bytes(hexToBytesLE(i.txid)).u32(i.vout).varbytes(i.scriptSig).u32(i.sequence);
    w.varint(this.outputs.length);
    for (const o of this.outputs) w.u64(o.value).varbytes(o.script);
    if (seg) for (const i of this.inputs) { w.varint(i.witness.length); for (const item of i.witness) w.varbytes(item); }
    w.u32(this.locktime);
    return w.finish();
  }

  toHex(opts) { return bytesToHex(this.toBytes(opts)); }

  txid() { return bytesToHexLE(hash256(this.toBytes({ witness: false }))); }

  wtxid() { return bytesToHexLE(hash256(this.toBytes({ witness: true }))); }

  size() { return this.toBytes().length; }

  baseSize() { return this.toBytes({ witness: false }).length; }

  // BIP-141: weight = base * 4 + witness bytes, written as base * 3 + total. Witness bytes are 4x cheaper because they
  // do not enter the UTXO set. vsize rounds up (Core's GetVirtualTransactionSize, ignoring the sigop adjustment that
  // only affects pathological scripts).
  weight() { return this.baseSize() * 3 + this.size(); }

  vsize() { return Math.ceil(this.weight() / 4); }

  clone() { return new Transaction(this); }

  isCoinbase() { return this.inputs.length === 1 && this.inputs[0].txid === '0'.repeat(64) && this.inputs[0].vout === 0xffffffff; }

  // BIP-125: an input with nSequence below 0xfffffffe signals replaceability. (Core 28+ defaults to full-RBF
  // mempool policy, so this is a signal of intent, no longer a guarantee that unsignalled txs cannot be replaced -
  // never accept a 0-conf payment because it does not signal.)
  signalsRbf() { return this.inputs.some((i) => i.sequence < 0xfffffffe); }

  addInput({ txid, vout, sequence = RBF_SEQUENCE, scriptSig = new Uint8Array(0), witness = [] }) {
    this.inputs.push({ txid, vout, scriptSig: toBytesAny(scriptSig), sequence, witness: witness.map(toBytesAny) });
    return this.inputs.length - 1;
  }

  addOutput({ value, script }) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('output value must be a non-negative integer of satoshis');
    this.outputs.push({ value, script: toBytesAny(script) });
    return this.outputs.length - 1;
  }

  // --- legacy signature hash (Bitcoin Core SignatureHash, SigVersion::BASE) ---

  // A modified copy of the tx is serialized: other inputs get empty scripts, the signed input gets scriptCode (with
  // OP_CODESEPARATORs removed); NONE drops outputs and zeroes others' sequences; SINGLE keeps outputs up to index with
  // the earlier ones blanked to (-1, empty); ANYONECANPAY keeps only this input. The 4-byte hash type is appended
  // whole (only its low 5 bits select the mode, so 0x41-style "forkid" types hash differently but act like ALL).
  // The SIGHASH_SINGLE bug: for an input without a matching output Core returns uint256(1) instead of failing, so a
  // signature over "1" authorizes *any* transaction spending that coin. Reproduced because consensus requires it;
  // signers must never produce such a signature.
  sighashLegacy(index, scriptCode, hashType) {
    if (index >= this.inputs.length) return ONE.slice();
    const base = hashType & 0x1f;
    const anyone = !!(hashType & SIGHASH.ANYONECANPAY);
    const single = base === SIGHASH.SINGLE, none = base === SIGHASH.NONE;
    if (single && index >= this.outputs.length) return ONE.slice();
    const w = new Writer();
    w.i32(this.version);
    const ins = anyone ? [index] : this.inputs.map((_, i) => i);
    w.varint(ins.length);
    for (const i of ins) {
      const inp = this.inputs[i];
      w.bytes(hexToBytesLE(inp.txid)).u32(inp.vout);
      if (i === index) writeScriptCode(w, scriptCode);
      else w.varint(0);
      w.u32(i !== index && (single || none) ? 0 : inp.sequence);
    }
    const nOut = none ? 0 : single ? index + 1 : this.outputs.length;
    w.varint(nOut);
    for (let i = 0; i < nOut; i++) {
      if (single && i !== index) w.u64(0xffffffffffffffffn).varint(0);
      else w.u64(this.outputs[i].value).varbytes(this.outputs[i].script);
    }
    w.u32(this.locktime).i32(hashType);
    return hash256(w.finish());
  }

  // --- BIP-143 ---

  // BIP-143 preimage: version, hashPrevouts, hashSequence, outpoint, scriptCode, amount, nSequence, hashOutputs,
  // locktime, hash type. Zero hashes stand in for parts a mode excludes; SINGLE without a matching output hashes
  // zeros (the legacy "1" bug is gone). scriptCode for P2WPKH is the P2PKH script of the key hash (caller's job).
  sighashV0(index, scriptCode, value, hashType) {
    if (index >= this.inputs.length) throw new Error('input index out of range');
    const base = hashType & 0x1f;
    const anyone = !!(hashType & SIGHASH.ANYONECANPAY);
    let hashPrevouts = ZERO32, hashSequence = ZERO32, hashOutputs = ZERO32;
    if (!anyone) {
      const w = new Writer();
      for (const i of this.inputs) w.bytes(hexToBytesLE(i.txid)).u32(i.vout);
      hashPrevouts = hash256(w.finish());
    }
    if (!anyone && base !== SIGHASH.SINGLE && base !== SIGHASH.NONE) {
      const w = new Writer();
      for (const i of this.inputs) w.u32(i.sequence);
      hashSequence = hash256(w.finish());
    }
    if (base !== SIGHASH.SINGLE && base !== SIGHASH.NONE) {
      const w = new Writer();
      for (const o of this.outputs) w.u64(o.value).varbytes(o.script);
      hashOutputs = hash256(w.finish());
    } else if (base === SIGHASH.SINGLE && index < this.outputs.length) {
      const o = this.outputs[index];
      hashOutputs = hash256(new Writer().u64(o.value).varbytes(o.script).finish());
    }
    const inp = this.inputs[index];
    const w = new Writer();
    w.i32(this.version).bytes(hashPrevouts).bytes(hashSequence).bytes(hexToBytesLE(inp.txid)).u32(inp.vout)
      .varbytes(scriptCode).u64(value).u32(inp.sequence).bytes(hashOutputs).u32(this.locktime).i32(hashType);
    return hash256(w.finish());
  }

  // --- BIP-341 ---

  // BIP-341 SigMsg, field by field. Differences from BIP-143 worth knowing:
  // - Only the listed hash types are valid (0x00 DEFAULT = ALL without an explicit byte; 0x04..0x7f etc. fail),
  //   unlike legacy where any byte goes.
  // - spend_type = ext_flag * 2 + annex_present; ext_flag 1 (script path, BIP-342) appends leaf hash, key_version 0
  //   and the last executed OP_CODESEPARATOR position (0xffffffff = none).
  // - The annex (last witness item starting 0x50) is committed as sha256(compact_size || annex), so a third party
  //   cannot add or strip it without invalidating the signature.
  // - SINGLE without a matching output is an error here (no "1" bug, no zero-hash fallback).
  sigMsgTaproot(index, prevouts, hashType = SIGHASH.DEFAULT, { leafHash = null, codeSeparatorPos = 0xffffffff, annex = null } = {}) {
    if (![0x00, 0x01, 0x02, 0x03, 0x81, 0x82, 0x83].includes(hashType)) throw new Error('invalid taproot sighash type');
    if (index >= this.inputs.length) throw new Error('input index out of range');
    if (prevouts.length !== this.inputs.length) throw new Error('taproot signature hashes need every spent output');
    const out = hashType & 0x03;
    const anyone = !!(hashType & SIGHASH.ANYONECANPAY);
    const w = new Writer();
    w.u8(0).u8(hashType).i32(this.version).u32(this.locktime); // epoch 0, then SigMsg
    if (!anyone) {
      const a = new Writer(), b = new Writer(), c = new Writer(), d = new Writer();
      for (const i of this.inputs) a.bytes(hexToBytesLE(i.txid)).u32(i.vout);
      for (const p of prevouts) b.u64(p.value);
      for (const p of prevouts) c.varbytes(toBytesAny(p.script));
      for (const i of this.inputs) d.u32(i.sequence);
      w.bytes(sha256(a.finish())).bytes(sha256(b.finish())).bytes(sha256(c.finish())).bytes(sha256(d.finish()));
    }
    if (out !== SIGHASH.NONE && out !== SIGHASH.SINGLE) {
      const o = new Writer();
      for (const x of this.outputs) o.u64(x.value).varbytes(x.script);
      w.bytes(sha256(o.finish()));
    }
    w.u8((leafHash ? 2 : 0) + (annex ? 1 : 0));
    if (anyone) {
      const inp = this.inputs[index], p = prevouts[index];
      w.bytes(hexToBytesLE(inp.txid)).u32(inp.vout).u64(p.value).varbytes(toBytesAny(p.script)).u32(inp.sequence);
    } else w.u32(index);
    if (annex) w.bytes(sha256(new Writer().varbytes(annex).finish()));
    if (out === SIGHASH.SINGLE) {
      if (index >= this.outputs.length) throw new Error('SIGHASH_SINGLE without a matching output');
      const o = this.outputs[index];
      w.bytes(sha256(new Writer().u64(o.value).varbytes(o.script).finish()));
    }
    if (leafHash) w.bytes(leafHash).u8(0).u32(codeSeparatorPos);
    return w.finish();
  }

  sighashTaproot(index, prevouts, hashType = SIGHASH.DEFAULT, opts = {}) {
    return taggedHash('TapSighash', this.sigMsgTaproot(index, prevouts, hashType, opts));
  }
}

// Core's SerializeScriptCode: the script with every OP_CODESEPARATOR removed (malformed tails as Core leaves them).
// Two passes: first count separators for the length prefix, then copy the spans between them. Removing only
// *opcodes* (via getOp), not every 0xab byte, matters: 0xab inside push data must stay.
function writeScriptCode(w, script) {
  let seps = 0;
  for (let pc = 0; ;) { const r = getOp(script, pc); if (!r.ok) break; if (r.op === OPS.OP_CODESEPARATOR) seps++; pc = r.pc; }
  w.varint(script.length - seps);
  let begin = 0, pc = 0;
  for (;;) {
    const r = getOp(script, pc);
    pc = r.pc;
    if (!r.ok) break;
    if (r.op === OPS.OP_CODESEPARATOR) { w.bytes(script.subarray(begin, pc - 1)); begin = pc; }
  }
  if (begin !== script.length) w.bytes(script.subarray(begin, pc));
}

export { hash256 };
