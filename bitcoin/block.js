// bitcoin/block.js - blocks: the 80-byte header (hash, previous block, merkle root, time, compact target, nonce),
// target and difficulty, proof-of-work check, merkle roots and proofs of transaction ids, whole raw blocks, the
// BIP-34 height of a coinbase and the block subsidy.
//
//   parseHeader(bytes | hex) -> { version, prevHash, merkleRoot, time, bits, nonce, hash }
//   serializeHeader(header) -> 80 bytes, blockHash(header bytes) -> display hex
//   bitsToTarget(bits) -> bigint, targetToBits(target), difficulty(bits) -> number, checkProofOfWork(header)
//   merkleRoot(txids: display hex[]) -> display hex, merkleProof(txids, index) -> [hashes], verifyMerkleProof(txid,
//   proof, index, root)
//   parseBlock(bytes | hex) -> { header, txs: [Transaction] }, coinbaseHeight(tx) (BIP-34), blockSubsidy(height)
//
// Scope: inspection, not validation. These helpers compute what an explorer shows and let an SPV-style client check
// a merkle proof against a header; they do not implement contextual rules (difficulty retargeting, median time past,
// chain work comparison), so a lone header that passes checkProofOfWork proves only that work was spent on it.
import { hexToBytes } from '../crypto/encoding.js';
import { sha256 } from '../crypto/sha2.js';
import { Reader, Writer, bytesToHexLE, hexToBytesLE } from './bytes.js';
import { Transaction } from './tx.js';
import { scriptNumDecode, getOp } from './script.js';

const hash256 = (b) => sha256(sha256(b));
const asBytes = (x) => (typeof x === 'string' ? hexToBytes(x.trim()) : x);

export const blockHash = (header80) => bytesToHexLE(hash256(header80));

// Accepts more than 80 bytes (parseBlock passes the whole block) and hashes exactly the first 80.
export function parseHeader(input) {
  const b = asBytes(input);
  if (b.length < 80) throw new Error('a block header has 80 bytes');
  const r = new Reader(b);
  const h = { version: r.i32(), prevHash: bytesToHexLE(r.bytes(32)), merkleRoot: bytesToHexLE(r.bytes(32)), time: r.u32(), bits: r.u32(), nonce: r.u32() };
  h.hash = blockHash(b.subarray(0, 80));
  return h;
}

export const serializeHeader = (h) => new Writer(80).i32(h.version).bytes(hexToBytesLE(h.prevHash)).bytes(hexToBytesLE(h.merkleRoot)).u32(h.time).u32(h.bits).u32(h.nonce).finish();

// nBits "compact" encoding (Core's arith_uint256::SetCompact): 1-byte exponent (size in bytes), 3-byte mantissa with
// a sign bit (0x00800000). target = mantissa * 256^(exp - 3).
// Core also reports overflow (a mantissa shifted past 256 bits) and rejects it; here such bits yield a huge BigInt
// target that checkProofOfWork would accept - see the KNOWN DEFECT there.
export function bitsToTarget(bits) {
  const exp = bits >>> 24, mant = BigInt(bits & 0x7fffff);
  if (bits & 0x800000) return 0n; // negative targets are invalid
  return exp <= 3 ? mant >> BigInt(8 * (3 - exp)) : mant << BigInt(8 * (exp - 3));
}

// GetCompact: if the mantissa's top bit is set it would read as negative, so shift one byte right and bump the
// exponent (the reason mainnet's 0x1d00ffff has a leading 00 in the mantissa).
export function targetToBits(target) {
  let size = Math.ceil(target.toString(16).length / 2);
  let compact = size <= 3 ? Number(target << BigInt(8 * (3 - size))) : Number(target >> BigInt(8 * (size - 3)));
  if (compact & 0x800000) { compact >>= 8; size++; }
  return ((size << 24) | compact) >>> 0;
}

const MAX_TARGET = bitsToTarget(0x1d00ffff);

// Difficulty relative to the genesis target (floating point, as shown by explorers).
export function difficulty(bits) {
  const t = bitsToTarget(bits);
  if (!t) return 0;
  // Keep 15 significant digits through the integer division.
  const scale = 10n ** 15n;
  return Number((MAX_TARGET * scale) / t) / 1e15;
}

// The hash, read as a 256-bit little-endian number (= the display hex as big-endian), must not exceed the target.
// KNOWN DEFECT: Core's CheckProofOfWork also rejects a negative / zero / overflowing target and a target above the
// network's powLimit; here bits like 0x2100ffff (target just below 2^256) make almost every hash "pass". Harmless for
// display, wrong for SPV header validation. Fix: reject bits with the sign bit, a zero target, overflow, or a
// target > bitsToTarget(powLimit) of the network (0x1d00ffff mainnet, 0x207fffff regtest).
export function checkProofOfWork(header) {
  const h = typeof header === 'string' || header instanceof Uint8Array ? parseHeader(header) : header;
  return BigInt('0x' + h.hash) <= bitsToTarget(h.bits);
}

// One merkle level: SHA-256d of each pair, an odd last hash paired with itself (Satoshi's rule).
// That duplication is CVE-2012-2459: [a, b, c] and [a, b, c, c] have the same root, so a block with a repeated last
// tx has the root of a valid block. Core detects the mutation while computing the root; these helpers do not, which
// is acceptable for proofs of a txid against a header Core already validated, not for validating blocks.
function level(hashes) {
  const next = [];
  for (let i = 0; i < hashes.length; i += 2) {
    const a = hashes[i], b = hashes[i + 1] || hashes[i];
    const c = new Uint8Array(64); c.set(a); c.set(b, 32);
    next.push(hash256(c));
  }
  return next;
}

export function merkleRoot(txids) {
  if (!txids.length) throw new Error('no transactions');
  let h = txids.map(hexToBytesLE);
  while (h.length > 1) h = level(h);
  return bytesToHexLE(h[0]);
}

// Sibling at each level from the leaf up (the Electrum blockchain.transaction.get_merkle shape); i ^ 1 is the sibling
// index, falling back to the node itself for the duplicated odd tail.
export function merkleProof(txids, index) {
  let h = txids.map(hexToBytesLE), i = index;
  const proof = [];
  while (h.length > 1) {
    proof.push(bytesToHexLE(h[i ^ 1] || h[i]));
    h = level(h);
    i >>= 1;
  }
  return proof;
}

// The index bits choose left / right at each level. SPV caveat: a 64-byte transaction can masquerade as an inner node
// (its two halves look like two hashes), so a proof's depth should be checked against the block's tx count when the
// counterparty is untrusted; the consensus cleanup soft-fork proposal (BIP-54) would forbid 64-byte transactions for this.
// Comparison is on display hex: callers must pass the root in the same (lower-case) form.
export function verifyMerkleProof(txid, proof, index, root) {
  let h = hexToBytesLE(txid), i = index;
  for (const p of proof) {
    const s = hexToBytesLE(p);
    const c = new Uint8Array(64);
    if (i & 1) { c.set(s); c.set(h, 32); } else { c.set(h); c.set(s, 32); }
    h = hash256(c);
    i >>= 1;
  }
  return bytesToHexLE(h) === root;
}

// Transactions are concatenated without length prefixes: each parse reports how many bytes it consumed
// (_bytesRead) and the cursor advances by that. Trailing bytes are an error.
export function parseBlock(input) {
  const b = asBytes(input);
  const header = parseHeader(b);
  const r = new Reader(b, 80);
  const n = r.varint();
  const txs = [];
  for (let i = 0; i < n; i++) {
    const tx = Transaction.fromBytes(b.subarray(r.pos), { allowTrailing: true });
    r.pos += tx._bytesRead;
    txs.push(tx);
  }
  if (!r.done()) throw new Error('trailing bytes after the block');
  return { header, txs };
}

// BIP-34: the first push of the coinbase scriptSig is the block height (made coinbase txids unique after the duplicate
// coinbase incidents of blocks 91842 / 91880). Core's check compares against CScript() << height, so heights 1..16 are
// OP_1..OP_16; minimal = false and 8 bytes to read whatever pre-BIP-34 miners wrote without throwing (null = no height).

export function coinbaseHeight(tx) {
  const s = tx.inputs[0].scriptSig;
  const r = getOp(s, 0);
  if (!r.ok) return null;
  if (r.op >= 0x51 && r.op <= 0x60) return r.op - 0x50;
  if (!r.data) return r.op === 0 ? 0 : null;
  try { return scriptNumDecode(r.data, 8, false); } catch { return null; }
}

// Core's GetBlockSubsidy: 50 BTC >> halvings, forced to 0 from 64 halvings on (a >> by 64 is undefined in C++; BigInt
// would give 0 anyway, the guard mirrors Core). The sum converges to just under 21 million BTC.
export function blockSubsidy(height, halvingInterval = 210000) {
  const halvings = Math.floor(height / halvingInterval);
  if (halvings >= 64) return 0;
  return Number(5000000000n >> BigInt(halvings));
}
