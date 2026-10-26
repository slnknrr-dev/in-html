// bitcoin/script.js - Bitcoin Script: opcodes, parsing into chunks, ASM text, minimal pushes and script numbers,
// the standard output templates (classification and builders) and multisig scripts.
//
//   OPS (name -> code), OP_NAMES (code -> name)
//   decompile(script) -> [{ op, data?, pos }] (throws on a truncated push), compile(chunks) (numbers = opcodes,
//   Uint8Array = minimal pushes), getOp(script, pc) -> { ok, op, data, pc } (Core's GetScriptOp, never throws)
//   toAsm(script) -> 'OP_DUP OP_HASH160 <hex> …' ("[error]" after a truncated push), fromAsm(text)
//   pushData(bytes) -> the minimal push of bytes, scriptNumEncode(n) / scriptNumDecode(bytes, maxLen = 4)
//   classify(script) -> { type: 'p2pkh' | 'p2sh' | 'p2wpkh' | 'p2wsh' | 'p2tr' | 'p2pk' | 'multisig' | 'nulldata' |
//     'anchor' | 'witness_unknown' | 'nonstandard', hash?, program?, version?, pubkey?, m?, n?, pubkeys?, data? }
//   p2pkh(hash20), p2sh(hash20), p2wpkh(hash20), p2wsh(hash32), p2tr(xonly32), p2pk(pubkey), witnessProgram(v, prog),
//   multisig(m, pubkeys, { sorted }), nulldata(...pushes), parseMultisig(script) -> { m, n, pubkeys } | null,
//   multiA(m, xonlyKeys, { sorted }) (BIP-387 tapscript multisig), parseWitnessProgram(script) -> { version, program } | null
//
// Key decisions:
// - Parsing follows Core's GetScriptOp exactly, including where it stops on a truncated push. Script bytes are
//   consensus data: two parsers that disagree on where an opcode ends would compute different scriptCodes / sighashes.
// - Templates are matched on raw bytes with fixed lengths (classify), not on decompiled chunks, like Core's Solver:
//   e.g. a P2PKH written with OP_PUSHDATA1 20 <hash> is *not* P2PKH to Core (non-standard) and must not be here either.
// - Minimal pushes everywhere we build scripts (BIP-62 rule 3, MINIMALDATA policy): non-minimal pushes are
//   non-standard, and a malleable push changes the txid of legacy spends.
// - Script numbers are little-endian sign-magnitude (not two's complement), minimal by default, max 4 bytes for
//   arithmetic operands (5 for CLTV / CSV): consensus rules of CScriptNum.
import { bytesToHex, concatBytes, hexToBytes } from '../crypto/encoding.js';

// Opcode table (Core's script.h). Aliases OP_FALSE / OP_TRUE share codes with OP_0 / OP_1 and are skipped when
// building OP_NAMES, so toAsm prints the canonical names. OP_NOP2 / OP_NOP3 appear only under their BIP-65 / BIP-112
// names; 0xba OP_CHECKSIGADD is tapscript-only (BIP-342); in legacy and segwit v0 scripts it is a bad opcode.
export const OPS = {
  OP_0: 0x00, OP_FALSE: 0x00, OP_PUSHDATA1: 0x4c, OP_PUSHDATA2: 0x4d, OP_PUSHDATA4: 0x4e, OP_1NEGATE: 0x4f, OP_RESERVED: 0x50,
  OP_1: 0x51, OP_TRUE: 0x51, OP_2: 0x52, OP_3: 0x53, OP_4: 0x54, OP_5: 0x55, OP_6: 0x56, OP_7: 0x57, OP_8: 0x58, OP_9: 0x59,
  OP_10: 0x5a, OP_11: 0x5b, OP_12: 0x5c, OP_13: 0x5d, OP_14: 0x5e, OP_15: 0x5f, OP_16: 0x60,
  OP_NOP: 0x61, OP_VER: 0x62, OP_IF: 0x63, OP_NOTIF: 0x64, OP_VERIF: 0x65, OP_VERNOTIF: 0x66, OP_ELSE: 0x67, OP_ENDIF: 0x68,
  OP_VERIFY: 0x69, OP_RETURN: 0x6a, OP_TOALTSTACK: 0x6b, OP_FROMALTSTACK: 0x6c, OP_2DROP: 0x6d, OP_2DUP: 0x6e, OP_3DUP: 0x6f,
  OP_2OVER: 0x70, OP_2ROT: 0x71, OP_2SWAP: 0x72, OP_IFDUP: 0x73, OP_DEPTH: 0x74, OP_DROP: 0x75, OP_DUP: 0x76, OP_NIP: 0x77,
  OP_OVER: 0x78, OP_PICK: 0x79, OP_ROLL: 0x7a, OP_ROT: 0x7b, OP_SWAP: 0x7c, OP_TUCK: 0x7d, OP_CAT: 0x7e, OP_SUBSTR: 0x7f,
  OP_LEFT: 0x80, OP_RIGHT: 0x81, OP_SIZE: 0x82, OP_INVERT: 0x83, OP_AND: 0x84, OP_OR: 0x85, OP_XOR: 0x86, OP_EQUAL: 0x87,
  OP_EQUALVERIFY: 0x88, OP_RESERVED1: 0x89, OP_RESERVED2: 0x8a, OP_1ADD: 0x8b, OP_1SUB: 0x8c, OP_2MUL: 0x8d, OP_2DIV: 0x8e,
  OP_NEGATE: 0x8f, OP_ABS: 0x90, OP_NOT: 0x91, OP_0NOTEQUAL: 0x92, OP_ADD: 0x93, OP_SUB: 0x94, OP_MUL: 0x95, OP_DIV: 0x96,
  OP_MOD: 0x97, OP_LSHIFT: 0x98, OP_RSHIFT: 0x99, OP_BOOLAND: 0x9a, OP_BOOLOR: 0x9b, OP_NUMEQUAL: 0x9c, OP_NUMEQUALVERIFY: 0x9d,
  OP_NUMNOTEQUAL: 0x9e, OP_LESSTHAN: 0x9f, OP_GREATERTHAN: 0xa0, OP_LESSTHANOREQUAL: 0xa1, OP_GREATERTHANOREQUAL: 0xa2,
  OP_MIN: 0xa3, OP_MAX: 0xa4, OP_WITHIN: 0xa5, OP_RIPEMD160: 0xa6, OP_SHA1: 0xa7, OP_SHA256: 0xa8, OP_HASH160: 0xa9,
  OP_HASH256: 0xaa, OP_CODESEPARATOR: 0xab, OP_CHECKSIG: 0xac, OP_CHECKSIGVERIFY: 0xad, OP_CHECKMULTISIG: 0xae,
  OP_CHECKMULTISIGVERIFY: 0xaf, OP_NOP1: 0xb0, OP_CHECKLOCKTIMEVERIFY: 0xb1, OP_CHECKSEQUENCEVERIFY: 0xb2, OP_NOP4: 0xb3,
  OP_NOP5: 0xb4, OP_NOP6: 0xb5, OP_NOP7: 0xb6, OP_NOP8: 0xb7, OP_NOP9: 0xb8, OP_NOP10: 0xb9, OP_CHECKSIGADD: 0xba,
  OP_INVALIDOPCODE: 0xff,
};

export const OP_NAMES = {};
for (const [k, v] of Object.entries(OPS)) if (!(v in OP_NAMES) && k !== 'OP_FALSE' && k !== 'OP_TRUE') OP_NAMES[v] = k;

const O = OPS;

// Core's GetScriptOp: the opcode at pc, its push data, the position after it. On failure (truncated push or end)
// ok is false and pc is where Core leaves it (after the opcode and the length bytes that could be read).
export function getOp(script, pc) {
  const end = script.length;
  if (pc >= end) return { ok: false, op: O.OP_INVALIDOPCODE, data: null, pc };
  const op = script[pc++];
  if (op > O.OP_PUSHDATA4) return { ok: true, op, data: null, pc };
  let size;
  if (op < O.OP_PUSHDATA1) size = op;
  else if (op === O.OP_PUSHDATA1) {
    if (end - pc < 1) return { ok: false, op, data: null, pc };
    size = script[pc++];
  } else if (op === O.OP_PUSHDATA2) {
    if (end - pc < 2) return { ok: false, op, data: null, pc };
    size = script[pc] | (script[pc + 1] << 8);
    pc += 2;
  } else {
    if (end - pc < 4) return { ok: false, op, data: null, pc };
    size = (script[pc] | (script[pc + 1] << 8) | (script[pc + 2] << 16) | (script[pc + 3] << 24)) >>> 0;
    pc += 4;
  }
  if (end - pc < size) return { ok: false, op, data: null, pc };
  return { ok: true, op, data: script.subarray(pc, pc + size), pc: pc + size };
}

// Strict chunk list for builders / UIs: throws on a truncated push (callers that must mirror consensus on malformed
// scripts use getOp directly). Data chunks are subarrays of the input (no copy).
export function decompile(script) {
  const out = [];
  let pc = 0;
  while (pc < script.length) {
    const r = getOp(script, pc);
    if (!r.ok) throw new Error(`truncated push at byte ${pc}`);
    out.push(r.data ? { op: r.op, data: r.data, pos: pc } : { op: r.op, pos: pc });
    pc = r.pc;
  }
  return out;
}

// The minimal push of `bytes` (BIP-62 MINIMALDATA: OP_0, OP_1..OP_16, OP_1NEGATE for single small values).
export function pushData(bytes) {
  const n = bytes.length;
  if (n === 0) return Uint8Array.of(O.OP_0);
  if (n === 1 && bytes[0] >= 1 && bytes[0] <= 16) return Uint8Array.of(0x50 + bytes[0]);
  if (n === 1 && bytes[0] === 0x81) return Uint8Array.of(O.OP_1NEGATE);
  if (n < O.OP_PUSHDATA1) return concatBytes(Uint8Array.of(n), bytes);
  if (n <= 0xff) return concatBytes(Uint8Array.of(O.OP_PUSHDATA1, n), bytes);
  if (n <= 0xffff) return concatBytes(Uint8Array.of(O.OP_PUSHDATA2, n & 0xff, n >> 8), bytes);
  return concatBytes(Uint8Array.of(O.OP_PUSHDATA4, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24), bytes);
}

// Chunks: numbers are opcodes, Uint8Array are data pushes (minimal), { op, data } chunks keep their opcode.
// Keeping the original push opcode lets decompile -> compile round-trip a non-minimal script byte for byte (needed
// to re-serialize someone else's script without changing its hash).
export function compile(chunks) {
  const parts = [];
  for (const c of chunks) {
    if (typeof c === 'number') parts.push(Uint8Array.of(c));
    else if (c instanceof Uint8Array) parts.push(pushData(c));
    else if (c && c.data) parts.push(c.op <= O.OP_PUSHDATA4 ? rawPush(c.op, c.data) : pushData(c.data));
    else if (c && typeof c.op === 'number') parts.push(Uint8Array.of(c.op));
    else throw new Error('invalid script chunk');
  }
  return concatBytes(...parts);
}

function rawPush(op, data) {
  const n = data.length;
  if (op < O.OP_PUSHDATA1) return concatBytes(Uint8Array.of(n), data);
  if (op === O.OP_PUSHDATA1) return concatBytes(Uint8Array.of(op, n), data);
  if (op === O.OP_PUSHDATA2) return concatBytes(Uint8Array.of(op, n & 0xff, n >> 8), data);
  return concatBytes(Uint8Array.of(op, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24), data);
}

// Script numbers: little endian, sign bit in the last byte, minimal.
// If the magnitude already uses the top bit of its last byte, an extra 0x00 / 0x80 byte carries the sign (so 128 is
// 80 00 and -128 is 80 80). BigInt: CLTV locktimes need 5 bytes (> 2^31), beyond 32-bit bitwise ops.
export function scriptNumEncode(n) {
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

// Core's CScriptNum minimality: the last byte may be 0x00 / 0x80 only if it is needed for the sign, i.e. if the byte
// before it has its top bit set. maxLen 4 is the consensus operand size; callers pass 5 (CLTV / CSV) or 8 with
// minimal = false (BIP-34 coinbase heights, which predate the rule).
export function scriptNumDecode(bytes, maxLen = 4, minimal = true) {
  if (bytes.length > maxLen) throw new Error('script number overflow');
  if (!bytes.length) return 0;
  if (minimal && (bytes[bytes.length - 1] & 0x7f) === 0 && (bytes.length === 1 || !(bytes[bytes.length - 2] & 0x80))) {
    throw new Error('non-minimal script number');
  }
  let v = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(i === bytes.length - 1 ? bytes[i] & 0x7f : bytes[i]);
  const neg = bytes[bytes.length - 1] & 0x80;
  return Number(neg ? -v : v);
}

// The script number pushed by a small-int opcode (OP_0, OP_1NEGATE, OP_1..OP_16) or null.
export function smallInt(op) {
  if (op === O.OP_0) return 0;
  if (op === O.OP_1NEGATE) return -1;
  if (op >= O.OP_1 && op <= O.OP_16) return op - 0x50;
  return null;
}

// Core-style ASM (data as bare hex, empty push as OP_0). Lossy by design: the push opcode is not shown, so fromAsm(
// toAsm(s)) re-minimizes pushes; use the raw hex when exact bytes matter.
export function toAsm(script) {
  const parts = [];
  let pc = 0;
  while (pc < script.length) {
    const r = getOp(script, pc);
    if (!r.ok) { parts.push('[error]'); break; }
    if (r.data) parts.push(r.data.length ? bytesToHex(r.data) : 'OP_0');
    else parts.push(OP_NAMES[r.op] || `OP_UNKNOWN_${r.op.toString(16)}`);
    pc = r.pc;
  }
  return parts.join(' ');
}

// ASM: opcode names (with or without OP_), hex data (pushed minimally unless written <hex> after OP_PUSHBYTES / an
// explicit push opcode), decimal numbers as script numbers.
// Token precedence resolves ambiguity: 1) OP_-prefixed names; 2) bare names, but only if the word contains a
// non-hex character - 'DUP' is OP_DUP, while a word made only of hex digits (e.g. 'ADD', '16') is never read as an
// opcode, because it could be data; such opcodes must be written with OP_; 3) decimals shorter than 12 characters
// (longer digit strings are hex data, not numbers); 4) even-length hex. Anything else throws.
export function fromAsm(text) {
  const chunks = [];
  for (const tok of String(text).trim().split(/\s+/).filter(Boolean)) {
    const up = tok.toUpperCase();
    if (up.startsWith('OP_') && up in OPS) { chunks.push(OPS[up]); continue; }
    if (!/^[0-9A-F-]+$/.test(up) && ('OP_' + up) in OPS) { chunks.push(OPS['OP_' + up]); continue; }
    if (/^-?\d+$/.test(tok) && tok.length < 12) {
      const n = Number(tok);
      if (n === 0) chunks.push(O.OP_0);
      else if (n === -1) chunks.push(O.OP_1NEGATE);
      else if (n >= 1 && n <= 16) chunks.push(0x50 + n);
      else chunks.push(scriptNumEncode(n));
      continue;
    }
    if (/^(?:[0-9a-f]{2})+$/i.test(tok)) { chunks.push(hexToBytes(tok)); continue; }
    throw new Error(`invalid script token "${tok}"`);
  }
  return compile(chunks);
}

// --- templates ---------------------------------------------------------------------------------

// isPubkey checks the encoding shape only (prefix + length), like Core's Solver; curve membership is checked where it
// matters (signing / verifying), not in classification.
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const isPubkey = (d) => d && ((d.length === 33 && (d[0] === 2 || d[0] === 3)) || (d.length === 65 && d[0] === 4));

export const p2pkh = (hash) => concatBytes(Uint8Array.of(O.OP_DUP, O.OP_HASH160, 20), hash, Uint8Array.of(O.OP_EQUALVERIFY, O.OP_CHECKSIG));
export const p2sh = (hash) => concatBytes(Uint8Array.of(O.OP_HASH160, 20), hash, Uint8Array.of(O.OP_EQUAL));
export const p2wpkh = (hash) => concatBytes(Uint8Array.of(0, 20), hash);
export const p2wsh = (hash) => concatBytes(Uint8Array.of(0, 32), hash);
export const p2tr = (key) => concatBytes(Uint8Array.of(O.OP_1, 32), key);
export const p2pk = (pubkey) => concatBytes(pushData(pubkey), Uint8Array.of(O.OP_CHECKSIG));

// Witness program = version opcode (OP_0 or OP_1..OP_16, never a push of the number) + one direct push of 2..40
// bytes (BIP-141). parseWitnessProgram is Core's IsWitnessProgram: total length 4..42 and the push byte must cover
// the rest exactly.
export function witnessProgram(version, program) {
  if (version < 0 || version > 16 || program.length < 2 || program.length > 40) throw new Error('invalid witness program');
  return concatBytes(Uint8Array.of(version ? 0x50 + version : 0, program.length), program);
}

export function parseWitnessProgram(script) {
  const n = script.length;
  if (n < 4 || n > 42) return null;
  const v = script[0];
  if (v !== 0 && (v < O.OP_1 || v > O.OP_16)) return null;
  if (script[1] + 2 !== n) return null;
  return { version: v ? v - 0x50 : 0, program: script.subarray(2) };
}

const compareBytes = (a, b) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
};
export { compareBytes };

// Bare / P2SH / P2WSH multisig: OP_m <keys> OP_n OP_CHECKMULTISIG. 20 keys is the consensus cap of CHECKMULTISIG
// (MAX_PUBKEYS_PER_MULTISIG); inside P2SH the 520-byte redeem script limit lowers it to 15 compressed keys
// (descriptor.js enforces that). sorted = BIP-67 lexicographic key order, so cosigners derive the same script
// without agreeing on an order.
export function multisig(m, pubkeys, { sorted = false } = {}) {
  const keys = sorted ? [...pubkeys].sort(compareBytes) : pubkeys;
  if (!(m >= 1 && m <= keys.length) || keys.length > 20) throw new Error('invalid multisig threshold or key count');
  const num = (k) => (k <= 16 ? Uint8Array.of(k ? 0x50 + k : 0) : pushData(scriptNumEncode(k)));
  return concatBytes(num(m), ...keys.map(pushData), num(keys.length), Uint8Array.of(O.OP_CHECKMULTISIG));
}

// BIP-387 multi_a: <key1> OP_CHECKSIG <key2> OP_CHECKSIGADD … <m> OP_NUMEQUAL (x-only keys).
// Tapscript removed CHECKMULTISIG (BIP-342) because its key-by-key trial loop prevents batch verification; the
// CHECKSIGADD chain needs one signature-or-empty per key, each checked independently. 999 keys is BIP-387's cap,
// derived from the 1000-element stack limit (one witness item per key must fit beside the running counter).
export function multiA(m, keys, { sorted = false } = {}) {
  const ks = sorted ? [...keys].sort(compareBytes) : keys;
  if (!(m >= 1 && m <= ks.length) || ks.length > 999) throw new Error('invalid multi_a threshold or key count');
  const parts = [];
  ks.forEach((k, i) => { parts.push(pushData(k), Uint8Array.of(i ? O.OP_CHECKSIGADD : O.OP_CHECKSIG)); });
  parts.push(m <= 16 ? Uint8Array.of(0x50 + m) : pushData(scriptNumEncode(m)), Uint8Array.of(O.OP_NUMEQUAL));
  return concatBytes(...parts);
}

export function parseMultisig(script) {
  let chunks;
  try { chunks = decompile(script); } catch { return null; }
  if (chunks.length < 4 || chunks[chunks.length - 1].op !== O.OP_CHECKMULTISIG) return null;
  const num = (c) => (c.data ? (() => { try { return scriptNumDecode(c.data); } catch { return null; } })() : smallInt(c.op));
  const m = num(chunks[0]), n = num(chunks[chunks.length - 2]);
  const keys = chunks.slice(1, -2);
  if (m === null || n === null || n !== keys.length || m < 1 || m > n || !keys.every((c) => isPubkey(c.data))) return null;
  return { m, n, pubkeys: keys.map((c) => c.data) };
}

export const nulldata = (...pushes) => concatBytes(Uint8Array.of(O.OP_RETURN), ...pushes.map(pushData));

// Output type, checked in order of frequency / specificity. Witness programs are tested before nulldata and p2pk
// because their byte patterns are unambiguous. 'anchor' = P2A (OP_1 PUSH2 4e73, Core 28 pay-to-anchor).
// nulldata: data is null when the OP_RETURN payload does not parse (still an OP_RETURN, still provably unspendable).
export function classify(script) {
  const s = script, n = s.length;
  if (n === 25 && s[0] === O.OP_DUP && s[1] === O.OP_HASH160 && s[2] === 20 && s[23] === O.OP_EQUALVERIFY && s[24] === O.OP_CHECKSIG) {
    return { type: 'p2pkh', hash: s.subarray(3, 23) };
  }
  if (n === 23 && s[0] === O.OP_HASH160 && s[1] === 20 && s[22] === O.OP_EQUAL) return { type: 'p2sh', hash: s.subarray(2, 22) };
  const wp = parseWitnessProgram(s);
  if (wp) {
    if (wp.version === 0 && wp.program.length === 20) return { type: 'p2wpkh', hash: wp.program, version: 0, program: wp.program };
    if (wp.version === 0 && wp.program.length === 32) return { type: 'p2wsh', hash: wp.program, version: 0, program: wp.program };
    if (wp.version === 1 && wp.program.length === 32) return { type: 'p2tr', program: wp.program, version: 1 };
    if (wp.version === 1 && eq(wp.program, [0x4e, 0x73])) return { type: 'anchor', program: wp.program, version: 1 };
    return { type: 'witness_unknown', version: wp.version, program: wp.program };
  }
  if (n > 0 && s[0] === O.OP_RETURN) {
    let data = [];
    try { data = decompile(s.subarray(1)).map((c) => c.data || null); } catch { data = null; }
    return { type: 'nulldata', data };
  }
  if ((n === 35 && s[0] === 33 && s[34] === O.OP_CHECKSIG && isPubkey(s.subarray(1, 34))) ||
      (n === 67 && s[0] === 65 && s[66] === O.OP_CHECKSIG && isPubkey(s.subarray(1, 66)))) {
    return { type: 'p2pk', pubkey: s.subarray(1, n - 1) };
  }
  const ms = parseMultisig(s);
  if (ms) return { type: 'multisig', ...ms };
  return { type: 'nonstandard' };
}
