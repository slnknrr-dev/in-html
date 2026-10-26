// bitcoin/interpreter.js - a Bitcoin Script interpreter after Bitcoin Core's interpreter.cpp: legacy scripts, P2SH,
// segwit v0 (P2WPKH / P2WSH) and taproot (key path and tapscript with OP_CHECKSIGADD, OP_SUCCESSx, the validation
// weight budget), every verification flag of Core's script tests and Core's error names. Used to check transaction
// inputs in the explorer and BIP-322 message signatures; checked against Core's script_tests.json.
//
//   verifyScript(scriptSig, scriptPubKey, witness, flags, checker) -> { ok, error }   (error: 'EVAL_FALSE', …)
//   verifyInput(tx, index, prevouts: [{ value, script }], flags = STANDARD_FLAGS) -> { ok, error }
//   txChecker(tx, index, prevouts) -> checker (signature hashes, CHECKLOCKTIMEVERIFY / CHECKSEQUENCEVERIFY)
//   FLAGS (name -> bit), parseFlags('P2SH,WITNESS'), STANDARD_FLAGS, MANDATORY_FLAGS
//   evalScript(stack, script, flags, checker, sigversion) (lower level; throws ScriptError)
//
// Fidelity rules (why the code mirrors Core line by line instead of being "cleaned up"):
// - Consensus is whatever Core does, bugs included: the CHECKMULTISIG dummy pop (off-by-one, hence NULLDUMMY),
//   FindAndDelete of signatures from the scriptCode in legacy, OP_CODESEPARATOR semantics, the legacy SIGHASH_SINGLE
//   "1" hash (tx.js), lax DER parsing for pre-BIP-66 signatures. A "fixed" interpreter would reject valid history or
//   accept invalid spends, and then explorer verdicts would be wrong.
// - Flags select rule sets: MANDATORY_FLAGS = consensus soft forks active today (P2SH, BIP-66 DERSIG, BIP-147
//   NULLDUMMY, BIP-65 / 112 timelocks, segwit, taproot); STANDARD_FLAGS add relay policy (low-S, minimal pushes,
//   clean stack, upgrade-discouragement, …). A script can be consensus-valid but non-standard: both verdicts exist.
// - Error names are Core's ScriptError strings, so results compare 1:1 with script_tests.json.
// - Limits are Core's: 10000-byte scripts, 520-byte elements, 201 non-push ops, 1000 stack + altstack items, 20 keys
//   per CHECKMULTISIG (legacy / v0). Tapscript replaces the op and size limits with a per-input signature budget
//   (validation weight: 50 units per executed signature, funded by the witness size + 50).
// - Script numbers are BigInt during evaluation: arithmetic results may exceed 4 bytes (only *inputs* are limited),
//   e.g. 0x7fffffff + 0x7fffffff, which must be representable to be pushed and later rejected as an operand.
import { sha256 } from '../crypto/sha2.js';
import { sha1 } from '../crypto/sha1.js';
import { ripemd160 } from '../crypto/ripemd.js';
import { concatBytes, equalBytes } from '../crypto/encoding.js';
import { Signature, ecdsaVerify, schnorrVerify, isValidPublicKey, CURVE, bytesToNumber, numberToBytes } from '../crypto/secp256k1.js';
import { getOp, OPS as O, parseWitnessProgram } from './script.js';
import { Writer } from './bytes.js';
import { tapLeafHash, rootFromControlBlock } from './taproot.js';
import { taprootOutputKey } from '../crypto/secp256k1.js';

export const FLAGS = {
  NONE: 0, P2SH: 1 << 0, STRICTENC: 1 << 1, DERSIG: 1 << 2, LOW_S: 1 << 3, NULLDUMMY: 1 << 4, SIGPUSHONLY: 1 << 5,
  MINIMALDATA: 1 << 6, DISCOURAGE_UPGRADABLE_NOPS: 1 << 7, CLEANSTACK: 1 << 8, CHECKLOCKTIMEVERIFY: 1 << 9,
  CHECKSEQUENCEVERIFY: 1 << 10, WITNESS: 1 << 11, DISCOURAGE_UPGRADABLE_WITNESS_PROGRAM: 1 << 12, MINIMALIF: 1 << 13,
  NULLFAIL: 1 << 14, WITNESS_PUBKEYTYPE: 1 << 15, CONST_SCRIPTCODE: 1 << 16, TAPROOT: 1 << 17,
  DISCOURAGE_UPGRADABLE_TAPROOT_VERSION: 1 << 18, DISCOURAGE_OP_SUCCESS: 1 << 19, DISCOURAGE_UPGRADABLE_PUBKEYTYPE: 1 << 20,
};
const F = FLAGS;
export const MANDATORY_FLAGS = F.P2SH | F.DERSIG | F.NULLDUMMY | F.CHECKLOCKTIMEVERIFY | F.CHECKSEQUENCEVERIFY | F.WITNESS | F.TAPROOT;
export const STANDARD_FLAGS = MANDATORY_FLAGS | F.STRICTENC | F.MINIMALDATA | F.DISCOURAGE_UPGRADABLE_NOPS | F.CLEANSTACK |
  F.MINIMALIF | F.NULLFAIL | F.LOW_S | F.DISCOURAGE_UPGRADABLE_WITNESS_PROGRAM | F.WITNESS_PUBKEYTYPE | F.CONST_SCRIPTCODE |
  F.DISCOURAGE_UPGRADABLE_TAPROOT_VERSION | F.DISCOURAGE_OP_SUCCESS | F.DISCOURAGE_UPGRADABLE_PUBKEYTYPE;

export function parseFlags(text) {
  let f = 0;
  for (const n of String(text).split(',').map((s) => s.trim()).filter(Boolean)) {
    if (!(n in FLAGS)) throw new Error(`unknown script flag ${n}`);
    f |= FLAGS[n];
  }
  return f;
}

export const SIGVERSION = { BASE: 0, WITNESS_V0: 1, TAPROOT: 2, TAPSCRIPT: 3 };
const SV = SIGVERSION;

class ScriptError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const err = (code) => { throw new ScriptError(code); };

const MAX_SCRIPT_SIZE = 10000, MAX_ELEMENT = 520, MAX_OPS = 201, MAX_STACK = 1000, MAX_PUBKEYS = 20;
const LOCKTIME_THRESHOLD = 500000000;

// --- script numbers and booleans ---
// num: CScriptNum decode with the minimal-encoding rule applied only under MINIMALDATA (policy); maxLen 4 for
// arithmetic, 5 for CLTV / CSV. castToBool: any non-zero byte is true, except "negative zero" (0x80 as the last
// byte with all others zero), which is false.

function num(v, minimal, maxLen = 4) {
  if (v.length > maxLen) err('SCRIPTNUM');
  if (minimal && v.length && (v[v.length - 1] & 0x7f) === 0 && (v.length <= 1 || (v[v.length - 2] & 0x80) === 0)) err('SCRIPTNUM');
  if (!v.length) return 0n;
  let r = 0n;
  for (let i = v.length - 1; i >= 0; i--) r = (r << 8n) | BigInt(i === v.length - 1 ? v[i] & 0x7f : v[i]);
  return v[v.length - 1] & 0x80 ? -r : r;
}

function enc(n) {
  let v = BigInt(n);
  if (v === 0n) return new Uint8Array(0);
  const neg = v < 0n;
  if (neg) v = -v;
  const out = [];
  while (v > 0n) { out.push(Number(v & 0xffn)); v >>= 8n; }
  if (out[out.length - 1] & 0x80) out.push(neg ? 0x80 : 0);
  else if (neg) out[out.length - 1] |= 0x80;
  return Uint8Array.from(out);
}

function castToBool(v) {
  for (let i = 0; i < v.length; i++) {
    if (v[i] !== 0) return !(i === v.length - 1 && v[i] === 0x80);
  }
  return false;
}

const TRUE = Uint8Array.of(1), FALSE = new Uint8Array(0);

// Core's CheckMinimalPush (BIP-62 rule 3): empty -> OP_0, 1..16 -> OP_n, 0x81 -> OP_1NEGATE, else the shortest
// push opcode. Prevents third-party malleation of scriptSigs by re-encoding pushes.
function checkMinimalPush(data, op) {
  const n = data.length;
  if (n === 0) return op === O.OP_0;
  if (n === 1 && data[0] >= 1 && data[0] <= 16) return false;
  if (n === 1 && data[0] === 0x81) return false;
  if (n <= 75) return op === n;
  if (n <= 255) return op === O.OP_PUSHDATA1;
  if (n <= 65535) return op === O.OP_PUSHDATA2;
  return true;
}

// The push CScript() << vector writes (no small-integer opcodes), for FindAndDelete.
function rawPush(v) {
  const n = v.length;
  if (n < O.OP_PUSHDATA1) return concatBytes(Uint8Array.of(n), v);
  if (n <= 0xff) return concatBytes(Uint8Array.of(O.OP_PUSHDATA1, n), v);
  if (n <= 0xffff) return concatBytes(Uint8Array.of(O.OP_PUSHDATA2, n & 0xff, n >> 8), v);
  return concatBytes(Uint8Array.of(O.OP_PUSHDATA4, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24), v);
}

// Core's FindAndDelete: removes every occurrence of the pattern that starts at an opcode boundary (matches can
// repeat back to back at one position), then continues opcode by opcode. Legacy-only: a signature cannot sign
// itself, so Satoshi deleted it from the scriptCode. A quirky source of consensus edge cases (patterns inside data,
// non-standard pushes), and the reason CONST_SCRIPTCODE makes any such deletion non-standard.
function findAndDelete(script, pattern) {
  if (!pattern.length) return { script, found: 0 };
  let found = 0;
  const parts = [];
  let pc = 0, pc2 = 0;
  const end = script.length;
  for (;;) {
    parts.push(script.subarray(pc2, pc));
    while (end - pc >= pattern.length && equalBytes(script.subarray(pc, pc + pattern.length), pattern)) { pc += pattern.length; found++; }
    pc2 = pc;
    const r = getOp(script, pc);
    if (!r.ok) break;
    pc = r.pc;
  }
  if (!found) return { script, found };
  parts.push(script.subarray(pc2, end));
  return { script: concatBytes(...parts), found };
}

// --- signature encodings ---

// BIP-66 strict DER, Core's IsValidSignatureEncoding, on sig || hashtype: 0x30 len 0x02 lenR R 0x02 lenS S ht.
// Integers must be positive (top bit clear) and minimally encoded (no superfluous 0x00). Before BIP-66, OpenSSL's
// lenient parser defined validity, which made consensus depend on OpenSSL's version.
function isValidSignatureEncoding(sig) {
  const n = sig.length;
  if (n < 9 || n > 73) return false;
  if (sig[0] !== 0x30 || sig[1] !== n - 3) return false;
  const lenR = sig[3];
  if (5 + lenR >= n) return false;
  const lenS = sig[5 + lenR];
  if (lenR + lenS + 7 !== n) return false;
  if (sig[2] !== 0x02 || lenR === 0 || sig[4] & 0x80) return false;
  if (lenR > 1 && sig[4] === 0 && !(sig[5] & 0x80)) return false;
  if (sig[lenR + 4] !== 0x02 || lenS === 0 || sig[lenR + 6] & 0x80) return false;
  if (lenS > 1 && sig[lenR + 6] === 0 && !(sig[lenR + 7] & 0x80)) return false;
  return true;
}

// libsecp256k1's lax DER parser as used by Bitcoin Core (ecdsa_signature_parse_der_lax): BER lengths, extra zeros;
// out-of-range values give an invalid (zero) signature, a malformed structure null.
function parseDerLax(input) {
  const n = input.length;
  let pos = 0;
  if (pos === n || input[pos] !== 0x30) return null;
  pos++;
  if (pos === n) return null;
  let lenbyte = input[pos++];
  if (lenbyte & 0x80) { lenbyte -= 0x80; if (lenbyte > n - pos) return null; pos += lenbyte; }
  const readInt = () => {
    if (pos === n || input[pos] !== 0x02) return null;
    pos++;
    if (pos === n) return null;
    let lb = input[pos++], len;
    if (lb & 0x80) {
      lb -= 0x80;
      if (lb > n - pos) return null;
      while (lb > 0 && input[pos] === 0) { pos++; lb--; }
      if (lb >= 4) return null;
      len = 0;
      while (lb > 0) { len = len * 256 + input[pos]; pos++; lb--; }
    } else len = lb;
    if (len > n - pos) return null;
    const start = pos;
    pos += len;
    return [start, len];
  };
  const R = readInt();
  if (!R) return null;
  const Sx = readInt();
  if (!Sx) return null;
  let [rpos, rlen] = R, [spos, slen] = Sx;
  while (rlen > 0 && input[rpos] === 0) { rlen--; rpos++; }
  while (slen > 0 && input[spos] === 0) { slen--; spos++; }
  if (rlen > 32 || slen > 32) return new Signature(0n, 0n);
  const r = bytesToNumber(input.subarray(rpos, rpos + rlen)), s = bytesToNumber(input.subarray(spos, spos + slen));
  if (r >= CURVE.n || s >= CURVE.n) return new Signature(0n, 0n);
  return new Signature(r, s);
}

// LOW_S (BIP-62 / BIP-146 policy): s <= n/2. (r, s) and (r, n - s) are both valid, so without this rule anyone could
// flip s and change a legacy txid; checkECDSA normalizes s before verifying so high-S still verifies under consensus.
function isLowDER(sig) {
  const s = parseDerLax(sig.subarray(0, -1));
  return !!s && s.s <= CURVE.n >> 1n;
}

function checkSignatureEncoding(sig, flags) {
  if (!sig.length) return;
  if ((flags & (F.DERSIG | F.LOW_S | F.STRICTENC)) && !isValidSignatureEncoding(sig)) err('SIG_DER');
  if ((flags & F.LOW_S) && !isLowDER(sig)) err('SIG_HIGH_S');
  if (flags & F.STRICTENC) {
    const ht = sig[sig.length - 1] & ~0x80;
    if (ht < 1 || ht > 3) err('SIG_HASHTYPE');
  }
}

const isCompressedOrUncompressed = (pk) => (pk.length === 33 && (pk[0] === 2 || pk[0] === 3)) || (pk.length === 65 && pk[0] === 4);

function checkPubKeyEncoding(pk, flags, sv) {
  if ((flags & F.STRICTENC) && !isCompressedOrUncompressed(pk)) err('PUBKEYTYPE');
  if ((flags & F.WITNESS_PUBKEYTYPE) && sv === SV.WITNESS_V0 && !(pk.length === 33 && (pk[0] === 2 || pk[0] === 3))) err('WITNESS_PUBKEYTYPE');
}

// Public keys as libsecp256k1 parses them: compressed, uncompressed and hybrid (06 / 07) encodings.
function parsePubkey(pk) {
  if (pk.length === 65 && (pk[0] === 6 || pk[0] === 7)) {
    if ((pk[64] & 1) !== (pk[0] & 1)) return null;
    const u = concatBytes(Uint8Array.of(4), pk.subarray(1));
    return isValidPublicKey(u) ? u : null;
  }
  if (!isCompressedOrUncompressed(pk)) return null;
  return isValidPublicKey(pk) ? pk : null;
}

// --- signature checker of a transaction input ---

// The transaction-dependent half of verification (Core's GenericTransactionSignatureChecker).
// checkECDSA returns false instead of throwing (legacy semantics: a failed CHECKSIG pushes false); checkSchnorr
// throws on any failure, because in tapscript a non-empty invalid signature fails the script outright (BIP-342).
// Taproot needs every spent output (BIP-341 sha_amounts / sha_scriptpubkeys); without them the check fails closed.
// checkLockTime (BIP-65): same type (height vs time, split at 500 000 000), lock <= nLockTime, and the input not final
// (else nLockTime is not enforced and CLTV would be bypassable). checkSequence (BIP-112): tx version >= 2, input's
// disable bit clear, same type flag (bit 22: time in 512 s units vs blocks), masked value comparison.
export function txChecker(tx, index, prevouts = null, amount = null) {
  const value = amount ?? (prevouts && prevouts[index] ? prevouts[index].value : 0);
  return {
    checkECDSA(sig, pubkey, scriptCode, sv) {
      if (!sig.length) return false;
      const pk = parsePubkey(pubkey);
      if (!pk) return false;
      const ht = sig[sig.length - 1];
      const s = parseDerLax(sig.subarray(0, -1));
      if (!s || s.r === 0n || s.s === 0n) return false;
      const h = sv === SV.BASE ? tx.sighashLegacy(index, scriptCode, ht) : tx.sighashV0(index, scriptCode, value, ht);
      return ecdsaVerify(s.normalizeS(), h, pk);
    },
    checkSchnorr(sig, pubkey, sv, exec) {
      let ht = 0, s = sig;
      if (sig.length === 65) { ht = sig[64]; if (ht === 0) err('SCHNORR_SIG_HASHTYPE'); s = sig.subarray(0, 64); }
      else if (sig.length !== 64) err('SCHNORR_SIG_SIZE');
      if (!prevouts) err('SCHNORR_SIG');
      let h;
      try {
        h = tx.sighashTaproot(index, prevouts, ht, sv === SV.TAPSCRIPT ? { leafHash: exec.leafHash, codeSeparatorPos: exec.codesepPos, annex: exec.annex } : { annex: exec.annex });
      } catch { err('SCHNORR_SIG_HASHTYPE'); }
      if (!schnorrVerify(s, h, pubkey)) err('SCHNORR_SIG');
      return true;
    },
    checkLockTime(lock) {
      const tl = tx.locktime;
      if (!((tl < LOCKTIME_THRESHOLD && lock < LOCKTIME_THRESHOLD) || (tl >= LOCKTIME_THRESHOLD && lock >= LOCKTIME_THRESHOLD))) return false;
      if (lock > tl) return false;
      if (tx.inputs[index].sequence === 0xffffffff) return false;
      return true;
    },
    checkSequence(seq) {
      const txSeq = tx.inputs[index].sequence;
      if (tx.version < 2) return false;
      if (txSeq & 0x80000000) return false;
      const mask = (1 << 22) | 0xffff;
      const a = txSeq & mask, b = Number(seq & BigInt(mask));
      if (!((a < (1 << 22) && b < (1 << 22)) || (a >= (1 << 22) && b >= (1 << 22)))) return false;
      return b <= a;
    },
  };
}

// Opcodes disabled in 2010 after the OP_LSHIFT / OP_RETURN incidents: they fail even in an unexecuted branch.
// OP_SUCCESSx (BIP-342): in tapscript these make the whole script succeed immediately (checked before execution),
// reserving them for soft forks that can give them any semantics - unlike NOPs, which can only add VERIFY behavior.
const DISABLED = new Set([O.OP_CAT, O.OP_SUBSTR, O.OP_LEFT, O.OP_RIGHT, O.OP_INVERT, O.OP_AND, O.OP_OR, O.OP_XOR, O.OP_2MUL, O.OP_2DIV, O.OP_MUL, O.OP_DIV, O.OP_MOD, O.OP_LSHIFT, O.OP_RSHIFT]);
const isOpSuccess = (op) => op === 80 || op === 98 || (op >= 126 && op <= 129) || (op >= 131 && op <= 134) || (op >= 137 && op <= 138) ||
  (op >= 141 && op <= 142) || (op >= 149 && op <= 153) || (op >= 187 && op <= 254);

// --- EvalScript ---

// Core's EvalScript. vfExec is the IF / ELSE nesting; an opcode runs only when every enclosing branch is true, but
// IF..ENDIF opcodes are always processed to track nesting (and OP_VERIF / OP_VERNOTIF, inside that range, fail even
// unexecuted). Per-op checks before execution: element size, op count (legacy / v0 only), disabled opcodes.
// beginCode / codesepPos: the scriptCode starts after the last executed OP_CODESEPARATOR (legacy / v0), and tapscript
// commits to that separator's opcode position instead (BIP-342).
export function evalScript(stack, script, flags, checker, sv, exec = {}) {
  if ((sv === SV.BASE || sv === SV.WITNESS_V0) && script.length > MAX_SCRIPT_SIZE) err('SCRIPT_SIZE');
  const minimal = !!(flags & F.MINIMALDATA);
  const vfExec = [];
  const alt = [];
  let pc = 0, beginCode = 0, opCount = 0, opPos = 0;
  exec.codesepPos = 0xffffffff;
  const top = (i) => { if (stack.length < -i) err('INVALID_STACK_OPERATION'); return stack[stack.length + i]; };
  const need = (n) => { if (stack.length < n) err('INVALID_STACK_OPERATION'); };
  const pop = () => stack.pop();
  while (pc < script.length) {
    const fExec = !vfExec.includes(false);
    const r = getOp(script, pc);
    if (!r.ok) err('BAD_OPCODE');
    const op = r.op, data = r.data;
    pc = r.pc;
    if (data && data.length > MAX_ELEMENT) err('PUSH_SIZE');
    if (sv === SV.BASE || sv === SV.WITNESS_V0) {
      if (op > O.OP_16 && ++opCount > MAX_OPS) err('OP_COUNT');
    }
    if (DISABLED.has(op)) err('DISABLED_OPCODE');
    if (op === O.OP_CODESEPARATOR && sv === SV.BASE && (flags & F.CONST_SCRIPTCODE)) err('OP_CODESEPARATOR');
    if (fExec && op <= O.OP_PUSHDATA4) {
      if (minimal && !checkMinimalPush(data, op)) err('MINIMALDATA');
      stack.push(data);
    } else if (fExec || (op >= O.OP_IF && op <= O.OP_ENDIF)) {
      switch (op) {
        case O.OP_1NEGATE: case O.OP_1: case O.OP_2: case O.OP_3: case O.OP_4: case O.OP_5: case O.OP_6: case O.OP_7: case O.OP_8:
        case O.OP_9: case O.OP_10: case O.OP_11: case O.OP_12: case O.OP_13: case O.OP_14: case O.OP_15: case O.OP_16:
          stack.push(enc(op - (O.OP_1 - 1)));
          break;
        case O.OP_NOP: break;
        case O.OP_CHECKLOCKTIMEVERIFY: {
          if (!(flags & F.CHECKLOCKTIMEVERIFY)) { if (flags & F.DISCOURAGE_UPGRADABLE_NOPS) err('DISCOURAGE_UPGRADABLE_NOPS'); break; }
          const lock = num(top(-1), minimal, 5);
          if (lock < 0n) err('NEGATIVE_LOCKTIME');
          if (!checker.checkLockTime(Number(lock))) err('UNSATISFIED_LOCKTIME');
          break;
        }
        case O.OP_CHECKSEQUENCEVERIFY: {
          if (!(flags & F.CHECKSEQUENCEVERIFY)) { if (flags & F.DISCOURAGE_UPGRADABLE_NOPS) err('DISCOURAGE_UPGRADABLE_NOPS'); break; }
          const seq = num(top(-1), minimal, 5);
          if (seq < 0n) err('NEGATIVE_LOCKTIME');
          if (seq & (1n << 31n)) break;
          if (!checker.checkSequence(seq)) err('UNSATISFIED_LOCKTIME');
          break;
        }
        case O.OP_NOP1: case O.OP_NOP4: case O.OP_NOP5: case O.OP_NOP6: case O.OP_NOP7: case O.OP_NOP8: case O.OP_NOP9: case O.OP_NOP10:
          if (flags & F.DISCOURAGE_UPGRADABLE_NOPS) err('DISCOURAGE_UPGRADABLE_NOPS');
          break;
        case O.OP_IF: case O.OP_NOTIF: {
          let v = false;
          if (fExec) {
            if (stack.length < 1) err('INVALID_STACK_OPERATION');
            const t = top(-1);
            if (sv === SV.TAPSCRIPT && (t.length > 1 || (t.length === 1 && t[0] !== 1))) err('TAPSCRIPT_MINIMALIF');
            if (sv === SV.WITNESS_V0 && (flags & F.MINIMALIF) && (t.length > 1 || (t.length === 1 && t[0] !== 1))) err('MINIMALIF');
            v = castToBool(t);
            if (op === O.OP_NOTIF) v = !v;
            pop();
          }
          vfExec.push(v);
          break;
        }
        case O.OP_ELSE: if (!vfExec.length) err('UNBALANCED_CONDITIONAL'); vfExec[vfExec.length - 1] = !vfExec[vfExec.length - 1]; break;
        case O.OP_ENDIF: if (!vfExec.length) err('UNBALANCED_CONDITIONAL'); vfExec.pop(); break;
        case O.OP_VERIFY: if (castToBool(top(-1))) pop(); else err('VERIFY'); break;
        case O.OP_RETURN: err('OP_RETURN'); break;
        case O.OP_TOALTSTACK: alt.push(top(-1)); pop(); break;
        case O.OP_FROMALTSTACK: if (!alt.length) err('INVALID_ALTSTACK_OPERATION'); stack.push(alt.pop()); break;
        case O.OP_2DROP: need(2); pop(); pop(); break;
        case O.OP_2DUP: { need(2); const a = top(-2), b = top(-1); stack.push(a, b); break; }
        case O.OP_3DUP: { need(3); const a = top(-3), b = top(-2), c = top(-1); stack.push(a, b, c); break; }
        case O.OP_2OVER: { need(4); const a = top(-4), b = top(-3); stack.push(a, b); break; }
        case O.OP_2ROT: { need(6); const a = top(-6), b = top(-5); stack.splice(stack.length - 6, 2); stack.push(a, b); break; }
        case O.OP_2SWAP: { need(4); const s = stack.splice(stack.length - 4, 2); stack.push(...s); break; }
        case O.OP_IFDUP: { const t = top(-1); if (castToBool(t)) stack.push(t); break; }
        case O.OP_DEPTH: stack.push(enc(stack.length)); break;
        case O.OP_DROP: need(1); pop(); break;
        case O.OP_DUP: stack.push(top(-1)); break;
        case O.OP_NIP: need(2); stack.splice(stack.length - 2, 1); break;
        case O.OP_OVER: stack.push(top(-2)); break;
        case O.OP_PICK: case O.OP_ROLL: {
          need(2);
          const n = Number(num(top(-1), minimal));
          pop();
          if (n < 0 || n >= stack.length) err('INVALID_STACK_OPERATION');
          const v = stack[stack.length - 1 - n];
          if (op === O.OP_ROLL) stack.splice(stack.length - 1 - n, 1);
          stack.push(v);
          break;
        }
        case O.OP_ROT: { need(3); const a = stack.splice(stack.length - 3, 1)[0]; stack.push(a); break; }
        case O.OP_SWAP: { need(2); const a = pop(), b = pop(); stack.push(a, b); break; }
        case O.OP_TUCK: { need(2); const a = top(-1); stack.splice(stack.length - 2, 0, a); break; }
        case O.OP_SIZE: stack.push(enc(top(-1).length)); break;
        case O.OP_EQUAL: case O.OP_EQUALVERIFY: {
          need(2);
          const eq = equalBytes(top(-2), top(-1));
          pop(); pop();
          stack.push(eq ? TRUE : FALSE);
          if (op === O.OP_EQUALVERIFY) { if (eq) pop(); else err('EQUALVERIFY'); }
          break;
        }
        case O.OP_1ADD: case O.OP_1SUB: case O.OP_NEGATE: case O.OP_ABS: case O.OP_NOT: case O.OP_0NOTEQUAL: {
          let n = num(top(-1), minimal);
          if (op === O.OP_1ADD) n += 1n;
          else if (op === O.OP_1SUB) n -= 1n;
          else if (op === O.OP_NEGATE) n = -n;
          else if (op === O.OP_ABS) n = n < 0n ? -n : n;
          else if (op === O.OP_NOT) n = n === 0n ? 1n : 0n;
          else n = n !== 0n ? 1n : 0n;
          pop();
          stack.push(enc(n));
          break;
        }
        case O.OP_ADD: case O.OP_SUB: case O.OP_BOOLAND: case O.OP_BOOLOR: case O.OP_NUMEQUAL: case O.OP_NUMEQUALVERIFY:
        case O.OP_NUMNOTEQUAL: case O.OP_LESSTHAN: case O.OP_GREATERTHAN: case O.OP_LESSTHANOREQUAL: case O.OP_GREATERTHANOREQUAL:
        case O.OP_MIN: case O.OP_MAX: {
          need(2);
          const a = num(top(-2), minimal), b = num(top(-1), minimal);
          let n;
          switch (op) {
            case O.OP_ADD: n = a + b; break;
            case O.OP_SUB: n = a - b; break;
            case O.OP_BOOLAND: n = a !== 0n && b !== 0n ? 1n : 0n; break;
            case O.OP_BOOLOR: n = a !== 0n || b !== 0n ? 1n : 0n; break;
            case O.OP_NUMEQUAL: case O.OP_NUMEQUALVERIFY: n = a === b ? 1n : 0n; break;
            case O.OP_NUMNOTEQUAL: n = a !== b ? 1n : 0n; break;
            case O.OP_LESSTHAN: n = a < b ? 1n : 0n; break;
            case O.OP_GREATERTHAN: n = a > b ? 1n : 0n; break;
            case O.OP_LESSTHANOREQUAL: n = a <= b ? 1n : 0n; break;
            case O.OP_GREATERTHANOREQUAL: n = a >= b ? 1n : 0n; break;
            case O.OP_MIN: n = a < b ? a : b; break;
            default: n = a > b ? a : b;
          }
          pop(); pop();
          stack.push(enc(n));
          if (op === O.OP_NUMEQUALVERIFY) { if (castToBool(top(-1))) pop(); else err('NUMEQUALVERIFY'); }
          break;
        }
        case O.OP_WITHIN: {
          need(3);
          const x = num(top(-3), minimal), lo = num(top(-2), minimal), hi = num(top(-1), minimal);
          pop(); pop(); pop();
          stack.push(lo <= x && x < hi ? TRUE : FALSE);
          break;
        }
        case O.OP_RIPEMD160: case O.OP_SHA1: case O.OP_SHA256: case O.OP_HASH160: case O.OP_HASH256: {
          const v = top(-1);
          const h = op === O.OP_RIPEMD160 ? ripemd160(v) : op === O.OP_SHA1 ? sha1(v) : op === O.OP_SHA256 ? sha256(v) : op === O.OP_HASH160 ? ripemd160(sha256(v)) : sha256(sha256(v));
          pop();
          stack.push(h);
          break;
        }
        case O.OP_CODESEPARATOR: beginCode = pc; exec.codesepPos = opPos; break;
        case O.OP_CHECKSIG: case O.OP_CHECKSIGVERIFY: {
          need(2);
          const sig = top(-2), pk = top(-1);
          const ok = evalChecksig(sig, pk, script.subarray(beginCode), flags, checker, sv, exec);
          pop(); pop();
          stack.push(ok ? TRUE : FALSE);
          if (op === O.OP_CHECKSIGVERIFY) { if (ok) pop(); else err('CHECKSIGVERIFY'); }
          break;
        }
        case O.OP_CHECKSIGADD: {
          if (sv === SV.BASE || sv === SV.WITNESS_V0) err('BAD_OPCODE');
          need(3);
          const sig = top(-3), n = num(top(-2), minimal), pk = top(-1);
          const ok = evalChecksig(sig, pk, script, flags, checker, sv, exec);
          pop(); pop(); pop();
          stack.push(enc(n + (ok ? 1n : 0n)));
          break;
        }
        // CHECKMULTISIG, transcribed from Core with its index arithmetic: keys and signatures are matched in order,
        // each key tried once, so signatures must follow key order. The extra element popped at the end is Satoshi's
        // off-by-one ("dummy"), required to be empty by NULLDUMMY (BIP-147) so it cannot be malleated. Each key counts
        // toward the 201-op limit. ikey2 tracks how many key slots remain for the NULLFAIL check on cleanup.
        case O.OP_CHECKMULTISIG: case O.OP_CHECKMULTISIGVERIFY: {
          if (sv === SV.TAPSCRIPT) err('TAPSCRIPT_CHECKMULTISIG');
          let i = 1;
          need(i);
          let nKeys = Number(num(top(-i), minimal));
          if (nKeys < 0 || nKeys > MAX_PUBKEYS) err('PUBKEY_COUNT');
          opCount += nKeys;
          if (opCount > MAX_OPS) err('OP_COUNT');
          let ikey = ++i;
          let ikey2 = nKeys + 2;
          i += nKeys;
          need(i);
          let nSigs = Number(num(top(-i), minimal));
          if (nSigs < 0 || nSigs > nKeys) err('SIG_COUNT');
          let isig = ++i;
          i += nSigs;
          need(i);
          let scriptCode = script.subarray(beginCode);
          for (let k = 0; k < nSigs; k++) {
            if (sv === SV.BASE) {
              const fd = findAndDelete(scriptCode, rawPush(top(-isig - k)));
              if (fd.found && (flags & F.CONST_SCRIPTCODE)) err('SIG_FINDANDDELETE');
              scriptCode = fd.script;
            }
          }
          let success = true;
          while (success && nSigs > 0) {
            const sig = top(-isig), pk = top(-ikey);
            checkSignatureEncoding(sig, flags);
            checkPubKeyEncoding(pk, flags, sv);
            if (checker.checkECDSA(sig, pk, scriptCode, sv)) { isig++; nSigs--; }
            ikey++; nKeys--;
            if (nSigs > nKeys) success = false;
          }
          while (i-- > 1) {
            if (!success && (flags & F.NULLFAIL) && !ikey2 && top(-1).length) err('NULLFAIL');
            if (ikey2 > 0) ikey2--;
            pop();
          }
          need(1);
          if ((flags & F.NULLDUMMY) && top(-1).length) err('SIG_NULLDUMMY');
          pop();
          stack.push(success ? TRUE : FALSE);
          if (op === O.OP_CHECKMULTISIGVERIFY) { if (success) pop(); else err('CHECKMULTISIGVERIFY'); }
          break;
        }
        default: err('BAD_OPCODE');
      }
    }
    if (stack.length + alt.length > MAX_STACK) err('STACK_SIZE');
    opPos++;
  }
  if (vfExec.length) err('UNBALANCED_CONDITIONAL');
}

// Legacy / v0: encoding checks, then ECDSA; NULLFAIL (BIP-146) requires a failing signature to be empty, so a
// "false" result cannot be produced from many different garbage signatures (malleability, and DoS: no wasted
// verifications). Tapscript (BIP-342): empty sig = false without cost; otherwise 50 budget units and a mandatory valid
// Schnorr signature for a 32-byte key; other key lengths are "unknown key types" that succeed (soft-fork room),
// discouraged by policy.
function evalChecksig(sig, pk, scriptCode, flags, checker, sv, exec) {
  if (sv === SV.BASE || sv === SV.WITNESS_V0) {
    let code = scriptCode;
    if (sv === SV.BASE) {
      const fd = findAndDelete(code, rawPush(sig));
      if (fd.found && (flags & F.CONST_SCRIPTCODE)) err('SIG_FINDANDDELETE');
      code = fd.script;
    }
    checkSignatureEncoding(sig, flags);
    checkPubKeyEncoding(pk, flags, sv);
    const ok = checker.checkECDSA(sig, pk, code, sv);
    if (!ok && (flags & F.NULLFAIL) && sig.length) err('NULLFAIL');
    return ok;
  }
  // Tapscript
  const success = sig.length > 0;
  if (success) {
    exec.weightLeft -= 50;
    if (exec.weightLeft < 0) err('TAPSCRIPT_VALIDATION_WEIGHT');
  }
  if (pk.length === 0) err('TAPSCRIPT_EMPTY_PUBKEY');
  if (pk.length === 32) {
    if (success) checker.checkSchnorr(sig, pk, sv, exec);
  } else if (flags & F.DISCOURAGE_UPGRADABLE_PUBKEYTYPE) err('DISCOURAGE_UPGRADABLE_PUBKEYTYPE');
  return success;
}

// Witness scripts must leave exactly one true element (clean stack is consensus for segwit, policy for legacy).
// Tapscript: the OP_SUCCESS scan comes first, over the whole script, before any execution - so an OP_SUCCESS even in
// an unexecuted branch (or after a would-be failure) makes the spend valid.
function executeWitnessScript(stack, script, flags, sv, checker, exec) {
  if (sv === SV.TAPSCRIPT) {
    for (let pc = 0; pc < script.length;) {
      const r = getOp(script, pc);
      if (!r.ok) err('BAD_OPCODE');
      if (isOpSuccess(r.op)) { if (flags & F.DISCOURAGE_OP_SUCCESS) err('DISCOURAGE_OP_SUCCESS'); return; }
      pc = r.pc;
    }
    if (stack.length > MAX_STACK) err('STACK_SIZE');
  }
  for (const e of stack) if (e.length > MAX_ELEMENT) err('PUSH_SIZE');
  evalScript(stack, script, flags, checker, sv, exec);
  if (stack.length !== 1) err('CLEANSTACK');
  if (!castToBool(stack[0])) err('EVAL_FALSE');
}

const p2pkhScript = (h) => concatBytes(Uint8Array.of(O.OP_DUP, O.OP_HASH160, 20), h, Uint8Array.of(O.OP_EQUALVERIFY, O.OP_CHECKSIG));

// Core's VerifyWitnessProgram. v0: 32 bytes = P2WSH (last item is the script, must hash to the program), 20 bytes =
// P2WPKH (exactly sig + pubkey, run as the implied P2PKH). v1 / 32 bytes, not nested in P2SH = taproot: an annex
// (last item starting 0x50, only with >= 2 items) is removed first; one item left = key path Schnorr signature;
// otherwise script + control block: recompute the root, check the tweak against the output key *and* its parity.
// Taproot nested in P2SH is deliberately not taproot (BIP-341), and P2A (v1, 4e73) is anyone-can-spend, as in Core.
// Any other version / length: valid (future soft forks), unless policy discourages it.
function verifyWitnessProgram(witness, version, program, flags, checker, isP2sh) {
  let stack = witness.slice();
  const exec = {};
  if (version === 0) {
    if (program.length === 32) {
      if (!stack.length) err('WITNESS_PROGRAM_WITNESS_EMPTY');
      const ws = stack.pop();
      if (!equalBytes(sha256(ws), program)) err('WITNESS_PROGRAM_MISMATCH');
      return executeWitnessScript(stack, ws, flags, SV.WITNESS_V0, checker, exec);
    }
    if (program.length === 20) {
      if (stack.length !== 2) err('WITNESS_PROGRAM_MISMATCH');
      return executeWitnessScript(stack, p2pkhScript(program), flags, SV.WITNESS_V0, checker, exec);
    }
    err('WITNESS_PROGRAM_WRONG_LENGTH');
  }
  if (version === 1 && program.length === 32 && !isP2sh) {
    if (!(flags & F.TAPROOT)) return;
    if (!stack.length) err('WITNESS_PROGRAM_WITNESS_EMPTY');
    exec.annex = null;
    if (stack.length >= 2 && stack[stack.length - 1].length && stack[stack.length - 1][0] === 0x50) exec.annex = stack.pop();
    if (stack.length === 1) { checker.checkSchnorr(stack[0], program, SV.TAPROOT, exec); return; }
    const control = stack.pop(), script = stack.pop();
    if (control.length < 33 || control.length > 33 + 128 * 32 || (control.length - 33) % 32) err('TAPROOT_WRONG_CONTROL_SIZE');
    exec.leafHash = tapLeafHash(script, control[0] & 0xfe);
    const root = rootFromControlBlock(control, exec.leafHash);
    let q;
    try { q = taprootOutputKey(control.subarray(1, 33), root); } catch { err('WITNESS_PROGRAM_MISMATCH'); }
    if (!equalBytes(q.key, program) || q.parity !== (control[0] & 1)) err('WITNESS_PROGRAM_MISMATCH');
    if ((control[0] & 0xfe) === 0xc0) {
      exec.weightLeft = witnessSize(witness) + 50;
      return executeWitnessScript(stack, script, flags, SV.TAPSCRIPT, checker, exec);
    }
    if (flags & F.DISCOURAGE_UPGRADABLE_TAPROOT_VERSION) err('DISCOURAGE_UPGRADABLE_TAPROOT_VERSION');
    return;
  }
  if (version === 1 && program.length === 2 && program[0] === 0x4e && program[1] === 0x73 && !isP2sh) return; // P2A anchor
  if (flags & F.DISCOURAGE_UPGRADABLE_WITNESS_PROGRAM) err('DISCOURAGE_UPGRADABLE_WITNESS_PROGRAM');
}

function witnessSize(items) {
  const w = new Writer().varint(items.length);
  for (const i of items) w.varbytes(i);
  return w.finish().length;
}

function isPushOnly(script) {
  for (let pc = 0; pc < script.length;) {
    const r = getOp(script, pc);
    if (!r.ok || r.op > O.OP_16) return false;
    pc = r.pc;
  }
  return true;
}

const isP2sh = (s) => s.length === 23 && s[0] === O.OP_HASH160 && s[1] === 20 && s[22] === O.OP_EQUAL;

// Core's VerifyScript, in Core's order: scriptSig, then scriptPubKey on the resulting stack (separate evaluations
// since 2010 - concatenating them allowed a scriptSig to end with OP_RETURN tricks); native witness program (the
// scriptSig must then be empty, else WITNESS_MALLEATED); P2SH (BIP-16: push-only scriptSig, the last pushed item is
// run as the redeem script on a copy of the stack), possibly a nested witness program (the scriptSig must be exactly
// one push of it); clean stack; and witness data on a non-witness spend is rejected (WITNESS_UNEXPECTED), otherwise
// anyone could attach junk witnesses and change the wtxid.
// Only ScriptErrors become { ok: false }; any other exception is a bug here and is rethrown.
export function verifyScript(scriptSig, scriptPubKey, witness, flags, checker) {
  try {
    if ((flags & F.SIGPUSHONLY) && !isPushOnly(scriptSig)) err('SIG_PUSHONLY');
    let stack = [];
    evalScript(stack, scriptSig, flags, checker, SV.BASE);
    const copy = flags & F.P2SH ? stack.slice() : null;
    evalScript(stack, scriptPubKey, flags, checker, SV.BASE);
    if (!stack.length || !castToBool(stack[stack.length - 1])) err('EVAL_FALSE');
    let hadWitness = false;
    const wp = flags & F.WITNESS ? parseWitnessProgram(scriptPubKey) : null;
    if (wp) {
      hadWitness = true;
      if (scriptSig.length) err('WITNESS_MALLEATED');
      verifyWitnessProgram(witness || [], wp.version, wp.program, flags, checker, false);
      stack = [stack[0]];
    }
    if ((flags & F.P2SH) && isP2sh(scriptPubKey)) {
      if (!isPushOnly(scriptSig)) err('SIG_PUSHONLY');
      stack = copy;
      const redeem = stack.pop();
      evalScript(stack, redeem, flags, checker, SV.BASE);
      if (!stack.length || !castToBool(stack[stack.length - 1])) err('EVAL_FALSE');
      const wp2 = flags & F.WITNESS ? parseWitnessProgram(redeem) : null;
      if (wp2) {
        hadWitness = true;
        if (!equalBytes(scriptSig, rawPush(redeem))) err('WITNESS_MALLEATED_P2SH');
        verifyWitnessProgram(witness || [], wp2.version, wp2.program, flags, checker, true);
        stack = [stack[0]];
      }
    }
    if (flags & F.CLEANSTACK) { if (stack.length !== 1) err('CLEANSTACK'); }
    if ((flags & F.WITNESS) && !hadWitness && witness && witness.length) err('WITNESS_UNEXPECTED');
    return { ok: true, error: null };
  } catch (e) {
    if (e instanceof ScriptError) return { ok: false, error: e.code };
    throw e;
  }
}

export function verifyInput(tx, index, prevouts, flags = STANDARD_FLAGS) {
  const inp = tx.inputs[index];
  const prev = prevouts[index];
  return verifyScript(inp.scriptSig, prev.script, inp.witness, flags, txChecker(tx, index, prevouts.every(Boolean) ? prevouts : null, prev.value));
}

export { ScriptError, castToBool, numberToBytes as _numberToBytes };
