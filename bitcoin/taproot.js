// bitcoin/taproot.js - BIP-341 script trees: leaf and branch hashes, the merkle root, control blocks and output keys
// of a tree of scripts, and the BIP-371 PSBT encoding of a tree as (depth, leaf version, script) tuples.
//
//   tapLeafHash(script, leafVersion = 0xc0), tapBranchHash(a, b)
//   tapTree(tree) -> { root, leaves: [{ script, leafVersion, leafHash, path: [hashes], depth }] }
//     tree: a leaf { script, leafVersion? } or a pair [left, right] of trees (null / undefined = no scripts)
//   taprootCommit(internalKey (32 x-only or 33 bytes), tree) -> { internalKey, outputKey, parity, merkleRoot, tweak,
//     script (OP_1 <key>), leaves: [{ …leaf, controlBlock }] }
//   controlBlock(internalKey, parity, leaf), parseControlBlock(bytes) -> { leafVersion, parity, internalKey, path }
//   rootFromControlBlock(controlBlock, leafHash) -> merkle root
//   tapTreeToList(tree) -> [{ depth, leafVersion, script }] (BIP-371 PSBT_OUT_TAP_TREE), tapTreeFromList(list) -> tree
//
// BIP-341 in four lines: leaf = H_TapLeaf(leafVersion || compact_size(len) || script); branch = H_TapBranch of the two
// children sorted lexicographically; root = top branch; output key Q = P + H_TapTweak(P || root) * G. A control block
// proves one leaf: (leafVersion | parity of Q) || P (32 bytes) || the sibling hashes from the leaf up.
// Tagged hashes (H_tag(x) = SHA256(SHA256(tag) || SHA256(tag) || x)) give each use its own domain, so a leaf hash can
// never be replayed as a branch or a tweak.
// Sorting children (instead of left / right flags) means a control block needs no direction bits and the tree shape
// leaks less; the cost is that the verifier cannot tell left from right - which it never needs.
import { concatBytes } from '../crypto/encoding.js';
import { taggedHash, taprootOutputKey, taprootTweak } from '../crypto/secp256k1.js';
import { Writer } from './bytes.js';
import { p2tr, compareBytes } from './script.js';

// The only leaf version with defined semantics (BIP-342 tapscript). Leaf versions are even: the low bit of the
// control block's first byte carries the output key's parity.
export const LEAF_TAPSCRIPT = 0xc0;

export const tapLeafHash = (script, leafVersion = LEAF_TAPSCRIPT) =>
  taggedHash('TapLeaf', new Writer().u8(leafVersion).varbytes(script).finish());

export const tapBranchHash = (a, b) => (compareBytes(a, b) <= 0 ? taggedHash('TapBranch', a, b) : taggedHash('TapBranch', b, a));

const isLeaf = (t) => t && !Array.isArray(t) && t.script;

// Post-order walk: each leaf collects its merkle path while the recursion unwinds (sibling hash appended per level,
// so path[0] is the nearest sibling, as the control block wants). Depth limit 128 = the largest control block
// consensus accepts (33 + 128 * 32 bytes); a deeper leaf would be unspendable, so it fails here at build time.
// Leaves are returned in depth-first left-to-right order - the order BIP-371 PSBT_OUT_TAP_TREE serializes.
export function tapTree(tree) {
  if (tree == null) return { root: null, leaves: [] };
  const walk = (t, depth) => {
    if (isLeaf(t)) {
      const leafVersion = t.leafVersion ?? LEAF_TAPSCRIPT;
      const leafHash = tapLeafHash(t.script, leafVersion);
      return { hash: leafHash, leaves: [{ ...t, leafVersion, leafHash, path: [], depth }] };
    }
    if (!Array.isArray(t) || t.length !== 2) throw new Error('a script tree node is a leaf { script } or a pair [left, right]');
    const L = walk(t[0], depth + 1), R = walk(t[1], depth + 1);
    for (const l of L.leaves) l.path.push(R.hash);
    for (const l of R.leaves) l.path.push(L.hash);
    return { hash: tapBranchHash(L.hash, R.hash), leaves: [...L.leaves, ...R.leaves] };
  };
  const r = walk(tree, 0);
  if (r.leaves.some((l) => l.depth > 128)) throw new Error('script tree deeper than 128');
  return { root: r.hash, leaves: r.leaves };
}

export const controlBlock = (internalKey, parity, leaf) =>
  concatBytes(Uint8Array.of((leaf.leafVersion ?? LEAF_TAPSCRIPT) | parity), internalKey, ...leaf.path);

// Same size rule as consensus (Core's TAPROOT_CONTROL_BASE_SIZE / NODE_SIZE / MAX_NODE_COUNT). Subarrays: zero-copy
// views, the caller must not mutate the control block while using them.
export function parseControlBlock(cb) {
  if (cb.length < 33 || (cb.length - 33) % 32 || cb.length > 33 + 128 * 32) throw new Error('invalid control block length');
  const path = [];
  for (let o = 33; o < cb.length; o += 32) path.push(cb.subarray(o, o + 32));
  return { leafVersion: cb[0] & 0xfe, parity: cb[0] & 1, internalKey: cb.subarray(1, 33), path };
}

// Consensus side of the proof: fold the path into the root. The caller must still check that tweaking the internal
// key by this root gives the output key with the stated parity (interpreter.js does).
export function rootFromControlBlock(cb, leafHash) {
  let h = leafHash;
  for (const p of parseControlBlock(cb).path) h = tapBranchHash(h, p);
  return h;
}

// Builds everything a wallet stores for a P2TR output. A 33-byte key loses its prefix without a curve check here;
// taprootOutputKey's lift_x rejects a non-curve x. Use a NUMS internal key (e.g. BIP-341's H point) when the key
// path must be provably unspendable.
export function taprootCommit(internalKey, tree = null) {
  const ik = internalKey.length === 33 ? internalKey.subarray(1) : internalKey;
  const { root, leaves } = tapTree(tree);
  const { key, parity } = taprootOutputKey(ik, root);
  return {
    internalKey: ik, outputKey: key, parity, merkleRoot: root, tweak: taprootTweak(ik, root), script: p2tr(key),
    leaves: leaves.map((l) => ({ ...l, controlBlock: controlBlock(ik, parity, l) })),
  };
}

// BIP-371: the leaves in depth-first order with their depths.
export const tapTreeToList = (tree) => tapTree(tree).leaves.map((l) => ({ depth: l.depth, leafVersion: l.leafVersion, script: l.script }));

// Inverse of tapTreeToList: rebuild the shape from depths alone. Recursive descent: at the current depth take the
// next leaf if it sits here, else open a branch and fill both children one level deeper. Any list that is not a
// complete binary tree in DFS order (leftover leaves, a leaf shallower than the cursor, depth > 128) is rejected, as
// BIP-371 requires; otherwise two signers could rebuild different roots from one PSBT.
export function tapTreeFromList(list) {
  if (!list.length) throw new Error('empty script tree');
  let i = 0;
  const build = (depth) => {
    if (i >= list.length) throw new Error('incomplete script tree');
    const l = list[i];
    if (l.depth === depth) { i++; return { script: l.script, leafVersion: l.leafVersion }; }
    if (l.depth < depth || depth >= 128) throw new Error('invalid script tree depths');
    return [build(depth + 1), build(depth + 1)];
  };
  const t = build(0);
  if (i !== list.length) throw new Error('invalid script tree depths');
  return t;
}
