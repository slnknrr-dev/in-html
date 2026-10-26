// bitcoin/descriptor.js - output script descriptors: the BIP-380 checksum and key expressions (hex / WIF keys,
// xpub / xprv with key origins, derivation paths, ranges, BIP-389 multipath <a;b>), pk / pkh / sh (BIP-381), wpkh /
// wsh (BIP-382), multi / sortedmulti (BIP-383), combo (BIP-384), raw / addr (BIP-385), tr with script trees
// (BIP-386), multi_a / sortedmulti_a (BIP-387). Every context rule of the BIPs is enforced.
//
//   descriptorChecksum(text) -> 8 characters      addChecksum(text) -> 'desc#checksum'
//   parseDescriptor(text, { network = 'mainnet', requireChecksum = false }) -> Descriptor
//   desc.isRange, desc.multipath (number of alternatives, 1 without <a;b>), desc.hasPrivateKeys, desc.type
//   desc.expand(index = 0, { multipath = 0 }) -> { scripts: [Uint8Array], keys: [{ pubkey, fingerprint, path,
//     xonly?, leafHashes? }], redeemScript?, witnessScript?, tapInternalKey?, tapMerkleRoot?, tapTree?, leaves? }
//   desc.script(index, opts) (first script), desc.address(index, opts) (null for scripts without an address)
//   desc.toString({ public = false, checksum = true }) (public: xprv -> xpub with origin, WIF -> hex)
//   desc.split() -> [Descriptor] (BIP-389: one descriptor per multipath alternative)
//   deriveAddresses(text, start, count, opts) -> [address]
import { bytesToHex, concatBytes, hexToBytes } from '../crypto/encoding.js';
import { sha256 } from '../crypto/sha2.js';
import { isValidPublicKey, getPublicKey } from '../crypto/secp256k1.js';
import { HDKey, HARDENED } from '../hdkey/bip32.js';
import { decodeWIF, decodeAddress, fromOutputScript, hash160, p2shP2wpkhRedeemScript } from './address.js';
import * as S from './script.js';
import { taprootCommit } from './taproot.js';
import { network as netOf } from './networks.js';

// Checksum (BIP-380): a BCH code over GF(32) with generator GEN, 8 symbols, designed to guarantee detection of a few
// character errors in descriptors of practical length (see BIP-380 for the exact bounds). Each input character maps to a position
// in INPUT_CHARSET: its low 5 bits form one symbol, and the high bits (the "group", 0..2) of every 3 characters are
// packed into one extra symbol, so case and similar-looking characters land in different symbols. The polynomial
// state is 40 bits, beyond JS's 32-bit bitwise ops, hence BigInt.
// Why it matters: a descriptor typo (one wrong xpub character) still parses into a *valid but different* wallet.
// Without the checksum, funds could be sent to addresses nobody can spend.
const INPUT_CHARSET ='0123456789()[],\'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#"\\ ';
const CHECKSUM_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GEN = [0xf5dee51989n, 0xa9fdca3312n, 0x1bab10e32dn, 0x3706b1677an, 0x644d626ffdn];

function polymod(symbols) {
  let chk = 1n;
  for (const v of symbols) {
    const top = chk >> 35n;
    chk = ((chk & 0x7ffffffffn) << 5n) ^ BigInt(v);
    for (let i = 0; i < 5; i++) if ((top >> BigInt(i)) & 1n) chk ^= GEN[i];
  }
  return chk;
}

export function descriptorChecksum(text) {
  const symbols = [];
  let groups = [];
  for (const c of String(text)) {
    const v = INPUT_CHARSET.indexOf(c);
    if (v < 0) throw new Error(`invalid character "${c}" in a descriptor`);
    symbols.push(v & 31);
    groups.push(v >> 5);
    if (groups.length === 3) { symbols.push(groups[0] * 9 + groups[1] * 3 + groups[2]); groups = []; }
  }
  if (groups.length === 1) symbols.push(groups[0]);
  else if (groups.length === 2) symbols.push(groups[0] * 3 + groups[1]);
  const c = polymod([...symbols, 0, 0, 0, 0, 0, 0, 0, 0]) ^ 1n;
  let out = '';
  for (let i = 0; i < 8; i++) out += CHECKSUM_CHARSET[Number((c >> BigInt(5 * (7 - i))) & 31n)];
  return out;
}

export const addChecksum = (text) => `${stripChecksum(text)}#${descriptorChecksum(stripChecksum(text))}`;
const stripChecksum = (t) => { const s = String(t).trim(); const i = s.indexOf('#'); return i >= 0 ? s.slice(0, i) : s; };

function splitChecksum(text, requireChecksum) {
  const s = String(text).trim();
  const i = s.indexOf('#');
  if (i < 0) { if (requireChecksum) throw new Error('missing checksum'); return s; }
  const body = s.slice(0, i), sum = s.slice(i + 1);
  if (sum.length !== 8) throw new Error(`checksum must have 8 characters (got ${sum.length})`);
  if (descriptorChecksum(body) !== sum) throw new Error(`checksum mismatch (expected ${descriptorChecksum(body)})`);
  return body;
}

// --- key expressions -----------------------------------------------------------------------------

// A BIP-32 index: decimal below 2^31 plus an optional hardened marker (' or h; both accepted, h is shell-safe). The
// length guard rejects absurd digit strings before Number() could lose precision.
const PATH_STEP = /^(\d+)(['h]?)$/;
function parseStep(s, what) {
  const m = PATH_STEP.exec(s);
  if (!m) throw new Error(`invalid ${what} "${s}"`);
  const n = Number(m[1]);
  if (!(n < HARDENED) || m[1].length > 10) throw new Error(`${what} out of range: ${s}`);
  return m[2] ? n + HARDENED : n;
}

// ctx: { xonly (tr / tapscript), compressedOnly (wsh, wpkh, tapscript) }
// Key expression grammar: [fingerprint/origin/path]KEY/steps…/(* | *h), KEY = hex pubkey | WIF | xpub / xprv. The
// origin is metadata (where the key came from), the steps are derivation actually performed here.
// Context rules (BIP-381..386): uncompressed keys only in legacy contexts (segwit policy forbids them), x-only keys
// only in tr(). Hex keys and WIF cannot have derivation steps (they have no chain code).
// state collects document-wide facts: whether private keys occur, the multipath width (all <a;b;…> must agree).
// KNOWN DEFECT: neither WIF nor extended keys are checked against the descriptor's network (a tpub or a testnet WIF
// is accepted in a mainnet descriptor; Core rejects both). Addresses then come out in the requested network's
// encoding, silently mixing test keys into a mainnet wallet. Fix: compare decodeWIF(...).networks and the HD key's
// version prefix network with state.network.
function parseKey(text, ctx, state) {
  let s = text;
  let origin = null;
  if (s.startsWith('[')) {
    const end = s.indexOf(']');
    if (end < 0) throw new Error('key origin without "]"');
    const parts = s.slice(1, end).split('/');
    if (!/^[0-9a-f]{8}$/i.test(parts[0])) throw new Error(`invalid key origin fingerprint "${parts[0]}"`);
    origin = { fingerprint: parseInt(parts[0], 16) >>> 0, path: parts.slice(1).map((p) => parseStep(p, 'key origin path element')) };
    s = s.slice(end + 1);
    if (s.includes('[') || s.includes(']')) throw new Error('multiple key origins');
  } else if (s.includes(']')) throw new Error('key origin without "["');
  if (!s) throw new Error('key origin without a key');
  const slash = s.indexOf('/');
  const head = slash < 0 ? s : s.slice(0, slash);
  const steps = slash < 0 ? [] : s.slice(slash + 1).split('/');
  const key = { origin, text: head };
  // Hex public key (33 / 65 bytes, or 32-byte x-only in tr).
  if (/^[0-9a-f]+$/i.test(head) && (head.length === 66 || head.length === 130 || head.length === 64)) {
    if (steps.length) throw new Error('a hex key cannot have derivation steps');
    const b = hexToBytes(head);
    if (b.length === 32) {
      if (!ctx.xonly) throw new Error('x-only keys are only allowed in tr()');
      key.kind = 'xonly';
      key.pubkey = b;
      if (!isValidPublicKey(concatBytes(Uint8Array.of(2), b))) throw new Error('invalid x-only key');
    } else {
      if (!isValidPublicKey(b)) throw new Error('invalid public key');
      if (b.length === 65 && ctx.compressedOnly) throw new Error('uncompressed keys are not allowed here');
      key.kind = 'pub';
      key.pubkey = b;
    }
    return key;
  }
  // WIF: mainnet 5 (uncompressed) / K, L (compressed), testnet 9 / c; 51 or 52 Base58 characters in total.
  if (/^[5KLc9][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(head)) {
    let w;
    try { w = decodeWIF(head); } catch (e) { throw new Error('invalid private key: ' + e.message); }
    if (steps.length) throw new Error('a private key cannot have derivation steps');
    if (!w.compressed && ctx.compressedOnly) throw new Error('uncompressed keys are not allowed here');
    key.kind = 'wif';
    key.privateKey = w.privateKey;
    key.pubkey = getPublicKey(w.privateKey, w.compressed);
    state.private = true;
    return key;
  }
  // Extended key
  let hd;
  try { hd = HDKey.fromExtendedKey(head); } catch (e) { throw new Error(`invalid key "${head.slice(0, 16)}…": ${e.message}`); }
  key.kind = 'ext';
  key.hd = hd;
  if (hd.isPrivate) state.private = true;
  key.steps = [];
  let multi = null;
  steps.forEach((st, i) => {
    if (st === '*' || st === "*'" || st === '*h') {
      if (i !== steps.length - 1) throw new Error('"*" must be the last step');
      key.range = st === '*' ? 'normal' : 'hardened';
      return;
    }
    const m = /^<(.*)>$/.exec(st);
    if (m) {
      if (multi) throw new Error('multiple multipath specifiers in one key');
      const alts = m[1].split(';');
      if (alts.length < 2 || alts.some((a) => !a)) throw new Error('invalid multipath specifier');
      multi = alts.map((a) => parseStep(a, 'multipath index'));
      if (new Set(multi).size !== multi.length) throw new Error('duplicate multipath indexes');
      key.steps.push({ multi });
      return;
    }
    if (/[<>;]/.test(st)) throw new Error(`invalid derivation step "${st}"`);
    key.steps.push(parseStep(st, 'derivation index'));
  });
  if (multi) {
    if (state.multipath && state.multipath !== multi.length) throw new Error('multipath specifiers of mismatched lengths');
    state.multipath = multi.length;
  }
  return key;
}

const markOf = (i) => (i >= HARDENED ? `${i - HARDENED}h` : String(i));
const originText = (o) => (o ? `[${(o.fingerprint >>> 0).toString(16).padStart(8, '0')}${o.path.map((p) => '/' + markOf(p)).join('')}]` : '');

// The concrete key at a range index: { pubkey (33 / 65 / 32 x-only), fingerprint, path, privateKey? }.
// Fingerprint without an origin: the key's own fingerprint (HASH160 of its pubkey, first 4 bytes) and a path relative
// to it, which is what Core writes into PSBTs in that case. Hardened steps below an xpub are impossible (hardened
// derivation needs the parent private key) and fail loudly instead of producing a wrong key.
// alt: which alternative of a <a;b> step to take (BIP-389).
function resolveKey(key, index, alt, ctx) {
  if (key.kind === 'xonly') return { pubkey: key.pubkey, xonly: true, fingerprint: key.origin?.fingerprint ?? null, path: key.origin?.path || [] };
  if (key.kind === 'pub' || key.kind === 'wif') {
    const pk = ctx.xonly ? key.pubkey.subarray(1) : key.pubkey;
    return { pubkey: pk, xonly: !!ctx.xonly, fingerprint: key.origin ? key.origin.fingerprint : hash160Fp(key.pubkey), path: key.origin?.path || [], privateKey: key.privateKey };
  }
  let hd = key.hd;
  const path = [];
  for (const st of key.steps) {
    const i = typeof st === 'number' ? st : st.multi[alt];
    if (i === undefined) throw new Error('multipath index out of range');
    path.push(i);
  }
  if (key.range) path.push(key.range === 'hardened' ? index + HARDENED : index);
  for (const i of path) {
    if (i >= HARDENED && !hd.isPrivate) throw new Error('hardened derivation needs a private key');
    hd = hd.deriveChild(i);
  }
  const fingerprint = key.origin ? key.origin.fingerprint : key.hd.fingerprint;
  const full = [...(key.origin?.path || []), ...path];
  return { pubkey: ctx.xonly ? hd.publicKey.subarray(1) : hd.publicKey, xonly: !!ctx.xonly, fingerprint, path: full, privateKey: hd.privateKey || undefined };
}
const hash160Fp = (pub) => { const h = hash160(pub); return ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0; };

// Serialization. pub = true turns a private descriptor into its watch-only equivalent: WIF -> hex pubkey, xprv ->
// xpub. A private key followed by hardened steps cannot simply be neutered (the xpub could not perform them), so the
// hardened prefix is derived here and moved into the origin - the same thing Core's getdescriptorinfo does. The
// prefix's first letter is kept (x / t) so the network survives; SLIP-132 letters (y / z) collapse to x as
// descriptors carry the script type themselves.
function keyText(key, { pub = false } = {}) {
  if (key.kind === 'xonly' || key.kind === 'pub') return originText(key.origin) + key.text;
  if (key.kind === 'wif') return originText(key.origin) + (pub ? bytesToHex(key.pubkey) : key.text);
  const stepText = (st) => (typeof st === 'number' ? markOf(st) : `<${st.multi.map(markOf).join(';')}>`);
  let hd = key.hd, origin = key.origin, steps = key.steps;
  if (pub && hd.isPrivate) {
    // Derive through the hardened steps so that the rest can be public.
    const lastHard = steps.reduce((acc, st, i) => (typeof st === 'number' && st >= HARDENED ? i : acc), -1);
    const multiBefore = steps.slice(0, lastHard + 1).some((st) => typeof st !== 'number');
    if (lastHard >= 0 && !multiBefore) {
      const pre = steps.slice(0, lastHard + 1);
      for (const st of pre) hd = hd.deriveChild(st);
      origin = { fingerprint: key.origin ? key.origin.fingerprint : key.hd.fingerprint, path: [...(key.origin?.path || []), ...pre] };
      steps = steps.slice(lastHard + 1);
    }
    hd = hd.neuter();
  }
  const head = pub || !hd.isPrivate ? hd.toExtendedKey(hd.prefix.slice(0, 1) + 'pub') : hd.toExtendedKey(hd.prefix.slice(0, 1) + 'prv');
  const range = key.range === 'normal' ? '/*' : key.range === 'hardened' ? "/*h" : '';
  return originText(origin) + head + steps.map((st) => '/' + stepText(st)).join('') + range;
}

// --- the parser ----------------------------------------------------------------------------------

// Splits "a,b,{c,d}" at top-level commas.
function splitArgs(s) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (c === ',' && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
    if (depth < 0) throw new Error('unbalanced brackets');
  }
  if (depth !== 0) throw new Error('unbalanced brackets');
  out.push(s.slice(start));
  return out;
}

function call(s) {
  const m = /^([a-z_]+)\((.*)\)$/s.exec(s);
  return m ? { name: m[1], args: m[2] } : null;
}

// ctx: 'top' | 'sh' | 'wsh' | 'tap' (a leaf of tr)
// Recursive descent with the context passed down, which is how every "only allowed in …" rule of the BIPs is
// enforced in one place: e.g. sh() only at top (P2SH cannot nest), wpkh() not inside wsh() (a witness program cannot
// be a witness script), multi() vs multi_a() by tapscript context (CHECKMULTISIG is disabled in tapscript).
// Key limits: 15 in sh() (the 520-byte redeem script push limit, 15 * 34 + 3 = 513), 20 in wsh / top (consensus
// MAX_PUBKEYS_PER_MULTISIG), 999 in multi_a (BIP-387).
function parseScript(s, ctx, state) {
  const c = call(s);
  if (!c) throw new Error(`"${s.slice(0, 40)}" is not a script expression`);
  const keyCtx = { xonly: ctx === 'tap', compressedOnly: ctx === 'wsh' || ctx === 'tap' };
  const one = () => { const a = splitArgs(c.args); if (a.length !== 1) throw new Error(`${c.name}() takes one argument`); return a[0]; };
  switch (c.name) {
    case 'pk': case 'pkh': return { type: c.name, key: parseKey(one(), keyCtx, state) };
    case 'wpkh':
      if (ctx !== 'top' && ctx !== 'sh') throw new Error('wpkh() is only allowed at the top level or inside sh()');
      return { type: 'wpkh', key: parseKey(one(), { compressedOnly: true }, state) };
    case 'combo':
      if (ctx !== 'top') throw new Error('combo() is only allowed at the top level');
      return { type: 'combo', key: parseKey(one(), {}, state) };
    case 'sh':
      if (ctx !== 'top') throw new Error('sh() is only allowed at the top level');
      return { type: 'sh', inner: parseScript(one(), 'sh', state) };
    case 'wsh':
      if (ctx !== 'top' && ctx !== 'sh') throw new Error('wsh() is only allowed at the top level or inside sh()');
      return { type: 'wsh', inner: parseScript(one(), 'wsh', state) };
    case 'multi': case 'sortedmulti': case 'multi_a': case 'sortedmulti_a': {
      const tap = c.name.endsWith('_a');
      if (tap && ctx !== 'tap') throw new Error(`${c.name}() is only allowed in tr() script trees`);
      if (!tap && ctx === 'tap') throw new Error(`${c.name}() is not allowed in tapscript (use ${c.name}_a)`);
      const a = splitArgs(c.args);
      if (!/^\d+$/.test(a[0])) throw new Error('invalid multisig threshold');
      const m = Number(a[0]);
      const keys = a.slice(1).map((k) => parseKey(k, keyCtx, state));
      if (!keys.length) throw new Error('multisig without keys');
      if (m < 1 || m > keys.length) throw new Error('multisig threshold out of range');
      const max = tap ? 999 : ctx === 'sh' ? 15 : 20;
      if (keys.length > max) throw new Error(`more than ${max} keys in ${c.name}()${ctx === 'sh' ? ' inside sh()' : ''}`);
      return { type: c.name, m, keys };
    }
    case 'tr': {
      if (ctx !== 'top') throw new Error('tr() is only allowed at the top level');
      const a = splitArgs(c.args);
      if (a.length > 2) throw new Error('tr() takes a key and an optional tree');
      const key = parseKey(a[0], { xonly: true, compressedOnly: true }, state);
      return { type: 'tr', key, tree: a.length === 2 ? parseTree(a[1], state) : null };
    }
    case 'addr': {
      if (ctx !== 'top') throw new Error('addr() is only allowed at the top level');
      const addr = one();
      let d;
      try { d = decodeAddress(addr, state.network); } catch (e) { throw new Error('invalid address: ' + e.message); }
      return { type: 'addr', address: addr, scriptPubKey: d.script };
    }
    case 'raw': {
      if (ctx !== 'top') throw new Error('raw() is only allowed at the top level');
      const h = one();
      if (!/^(?:[0-9a-f]{2})*$/i.test(h)) throw new Error('raw() needs hex');
      return { type: 'raw', hex: h, scriptPubKey: hexToBytes(h) };
    }
    default: throw new Error(`unknown script expression ${c.name}()`);
  }
}

// tr() script tree: {A,B} is a branch, anything else a leaf parsed in tapscript context.
function parseTree(s, state) {
  if (s.startsWith('{')) {
    if (!s.endsWith('}')) throw new Error('unbalanced braces in a script tree');
    const parts = splitArgs(s.slice(1, -1));
    if (parts.length !== 2) throw new Error('a script tree branch has two children');
    return [parseTree(parts[0], state), parseTree(parts[1], state)];
  }
  return { leaf: parseScript(s, 'tap', state) };
}

// --- scripts -------------------------------------------------------------------------------------

function build(node, index, alt, ctx, keysOut) {
  const keyCtx = { xonly: ctx === 'tap' };
  const k = (key, tap = false) => { const r = resolveKey(key, index, alt, tap ? { xonly: true } : keyCtx); keysOut.push(r); return r; };
  switch (node.type) {
    case 'pk': return { script: S.p2pk(k(node.key).pubkey) }; // <key> OP_CHECKSIG (x-only in tapscript)
    case 'pkh': { const r = k(node.key); return { script: S.p2pkh(hash160(r.pubkey)) }; }
    case 'wpkh': { const r = k(node.key); return { script: S.p2wpkh(hash160(r.pubkey)) }; }
    case 'multi': case 'sortedmulti': {
      const pks = node.keys.map((x) => k(x).pubkey);
      return { script: S.multisig(node.m, pks, { sorted: node.type === 'sortedmulti' }) };
    }
    case 'multi_a': case 'sortedmulti_a': {
      const pks = node.keys.map((x) => k(x, true).pubkey);
      return { script: S.multiA(node.m, pks, { sorted: node.type === 'sortedmulti_a' }) };
    }
    case 'wsh': {
      const inner = build(node.inner, index, alt, 'wsh', keysOut);
      return { script: S.p2wsh(sha256(inner.script)), witnessScript: inner.script };
    }
    case 'sh': {
      const inner = build(node.inner, index, alt, 'sh', keysOut);
      return { script: S.p2sh(hash160(inner.script)), redeemScript: inner.script, witnessScript: inner.witnessScript };
    }
    default: throw new Error(`cannot build ${node.type}()`);
  }
}

class Descriptor {
  constructor(root, state, text) {
    this.root = root;
    this.network = state.network;
    this.hasPrivateKeys = !!state.private;
    this.multipath = state.multipath || 1;
    this.type = root.type === 'sh' && root.inner.type === 'wpkh' ? 'sh-wpkh' : root.type === 'sh' && root.inner.type === 'wsh' ? 'sh-wsh' : root.type;
    this.source = text;
    this.isRange = keysOf(root).some((k) => k.range);
  }

  // Scripts and the metadata a PSBT updater needs. combo() yields several scripts (P2PK, P2PKH, and for compressed
  // keys P2WPKH and P2SH-P2WPKH, BIP-384). For tr(), every key in a leaf gets the leaf hash it signs in (PSBT
  // tapBip32Derivation leafHashes), and the internal key an empty list (key path).
  expand(index = 0, { multipath = 0 } = {}) {
    if (!this.isRange && index !== 0) throw new Error('not a ranged descriptor');
    const n = this.root, keys = [];
    switch (n.type) {
      case 'addr': case 'raw': return { scripts: [n.scriptPubKey], keys };
      case 'combo': {
        const r = resolveKey(n.key, index, multipath, {});
        keys.push(r);
        const scripts = [S.p2pk(r.pubkey), S.p2pkh(hash160(r.pubkey))];
        if (r.pubkey.length === 33) scripts.push(S.p2wpkh(hash160(r.pubkey)), S.p2sh(hash160(p2shP2wpkhRedeemScript(r.pubkey))));
        return { scripts, keys };
      }
      case 'tr': {
        const ik = resolveKey(n.key, index, multipath, { xonly: true });
        keys.push(ik);
        const leaves = [];
        const toTree = (t) => {
          if (!t) return null;
          if (Array.isArray(t)) return [toTree(t[0]), toTree(t[1])];
          const lk = [];
          const b = build(t.leaf, index, multipath, 'tap', lk);
          const leaf = { script: b.script, leafVersion: 0xc0, keys: lk };
          leaves.push(leaf);
          return leaf;
        };
        const tree = toTree(n.tree);
        const c = taprootCommit(ik.pubkey, tree);
        // Leaf hashes of every key (PSBT tap bip32 derivations).
        for (const l of c.leaves) for (const kk of l.keys) { kk.leafHashes = [l.leafHash]; keys.push(kk); }
        ik.leafHashes = [];
        return { scripts: [c.script], keys, tapInternalKey: ik.pubkey, tapMerkleRoot: c.merkleRoot, tapTree: tree, leaves: c.leaves, outputKey: c.outputKey };
      }
      default: {
        const b = build(n, index, multipath, 'top', keys);
        return { scripts: [b.script], keys, redeemScript: b.redeemScript, witnessScript: b.witnessScript };
      }
    }
  }

  script(index = 0, opts) { return this.expand(index, opts).scripts[0]; }

  address(index = 0, opts = {}) { return fromOutputScript(this.script(index, opts), opts.network || this.network); }

  toString({ public: pub = false, checksum = true } = {}) {
    const body = nodeText(this.root, pub);
    return checksum ? addChecksum(body) : body;
  }

  // BIP-389: one descriptor per alternative of the multipath specifiers.
  split() {
    if (this.multipath === 1) return [this];
    const out = [];
    for (let a = 0; a < this.multipath; a++) {
      const text = nodeText(this.root, false, a);
      out.push(parseDescriptor(text, { network: this.network }));
    }
    return out;
  }
}

function keysOf(n) {
  if (!n) return [];
  if (Array.isArray(n)) return [...keysOf(n[0]), ...keysOf(n[1])];
  if (n.leaf) return keysOf(n.leaf);
  return [...(n.key ? [n.key] : []), ...(n.keys || []), ...keysOf(n.inner), ...keysOf(n.tree)];
}

function nodeText(n, pub, alt = null) {
  const kt = (k) => {
    if (alt === null || k.kind !== 'ext' || !k.steps.some((s) => typeof s !== 'number')) return keyText(k, { pub });
    const copy = { ...k, steps: k.steps.map((s) => (typeof s === 'number' ? s : s.multi[alt])) };
    return keyText(copy, { pub });
  };
  const tree = (t) => (Array.isArray(t) ? `{${tree(t[0])},${tree(t[1])}}` : nodeText(t.leaf, pub, alt));
  switch (n.type) {
    case 'addr': return `addr(${n.address})`;
    case 'raw': return `raw(${n.hex})`;
    case 'sh': case 'wsh': return `${n.type}(${nodeText(n.inner, pub, alt)})`;
    case 'multi': case 'sortedmulti': case 'multi_a': case 'sortedmulti_a': return `${n.type}(${n.m},${n.keys.map(kt).join(',')})`;
    case 'tr': return n.tree ? `tr(${kt(n.key)},${tree(n.tree)})` : `tr(${kt(n.key)})`;
    default: return `${n.type}(${kt(n.key)})`;
  }
}

// Checksum first (over the exact text, spaces included), then the charset, then whitespace removal and parsing.
// requireChecksum = true is the safe setting for anything pasted by a user; false allows hand-written descriptors.
export function parseDescriptor(text, { network = 'mainnet', requireChecksum = false } = {}) {
  const body = splitChecksum(text, requireChecksum);
  for (const c of body) if (!INPUT_CHARSET.includes(c)) throw new Error(`invalid character "${c}" in a descriptor`);
  const state = { network: netOf(network).name, private: false, multipath: 0 };
  const root = parseScript(body.replace(/\s+/g, ''), 'top', state);
  return new Descriptor(root, state, body);
}

export function deriveAddresses(text, start = 0, count = 1, opts = {}) {
  const d = parseDescriptor(text, opts);
  const out = [];
  for (let i = start; i < start + count; i++) out.push(d.address(i, opts));
  return out;
}

export { Descriptor };
