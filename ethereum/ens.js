// ethereum/ens.js - Ethereum Name Service (ERC-137): name hashing, DNS wire encoding (ENSIP-10), forward and reverse
// resolution through a JSON-RPC client (rpc.js) on Ethereum mainnet.
//
//   normalizeName(name) -> name     basic normalisation: NFC, lower case, no empty labels, no spaces, ASCII limited
//                                   to letters, digits, hyphen and leading underscores (no "xx--" ASCII labels),
//                                   other characters must be letters, digits, marks or emoji (with ZWJ / VS16).
//                                   Full ENSIP-15 normalisation (confusables, mixed scripts, emoji sequences) is NOT
//                                   implemented: show resolved addresses to the user before sending.
//   namehash(name) -> '0x…32'       labelhash(label) -> '0x…32' ('[<64 hex>]' labels are taken as their hash)
//   dnsEncode(name) -> '0x…'        isEnsName(text) -> boolean
//   ENS_REGISTRY                    '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e'
//   getResolver(rpc, name) -> resolver address | null (the name's own, else the closest parent's for ENSIP-10)
//   resolveName(rpc, name) -> checksum address | null           addr(bytes32), or resolve(bytes,bytes) (ENSIP-10)
//   lookupAddress(rpc, address) -> name | null                   reverse record, kept only if it is normalised and
//                                                                its forward resolution gives the same address
//   rpc: a client of createRpcClient (or anything with call({ to, data }, block) / request(method, params)).
//   Offchain resolvers (EIP-3668 CCIP-read: OffchainLookup reverts) are not followed: Error with code 'OFFCHAIN'.
import { keccak256 } from '../crypto/sha3.js';
import { bytesToHex, concatBytes, utf8ToBytes } from '../crypto/encoding.js';
import { decodeParameters, encodeFunctionData } from './abi.js';
import { ZERO_ADDRESS, equalAddress, getAddress } from './address.js';
import { fromHex } from './units.js';

export const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';

// Allowed non-ASCII characters: letters, digits, combining marks, emoji and their components, plus the literal ZWJ
// (U+200D) and VS16 (U+FE0F) at the end of the class (invisible in most editors). This is a coarse filter, NOT ENSIP-15:
// homoglyphs (Cyrillic 'а' vs Latin 'a') pass, which is why the header says to show resolved addresses.
const OTHER_OK = /^[\p{L}\p{N}\p{M}\p{Extended_Pictographic}\p{Emoji_Component}‍️]$/u;

// NFC then lower case: namehash is over bytes, so "Vitalik.eth" and "vitalik.eth", or composed and decomposed
// accents, would hash to different nodes. Normalisation is the only thing that maps user text to one node.
// The "xx--" rule rejects ASCII labels that look like IDNA punycode ("xn--…") and could render as a different name.
export function normalizeName(name) {
  if (typeof name !== 'string') throw new TypeError('ENS name: string expected');
  const s = name.normalize('NFC').toLowerCase();
  if (s === '') return '';
  const labels = s.split('.');
  for (const l of labels) {
    if (!l) throw new Error(`ENS name "${name}": empty label`);
    if (/^\[[0-9a-f]{64}\]$/.test(l)) continue;
    let ascii = true;
    for (const ch of l) {
      if (/^[a-z0-9_-]$/.test(ch)) continue;
      if (ch.codePointAt(0) < 0x80) throw new Error(`ENS name "${name}": character ${JSON.stringify(ch)} is not allowed`);
      if (!OTHER_OK.test(ch)) throw new Error(`ENS name "${name}": character U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} is not allowed`);
      ascii = false;
    }
    if (/[^_]_/.test(l)) throw new Error(`ENS name "${name}": underscores are only allowed at the start of a label`);
    if (ascii && l.length >= 4 && l[2] === '-' && l[3] === '-') throw new Error(`ENS name "${name}": invalid label extension "${l.slice(0, 4)}"`);
  }
  return labels.join('.');
}

// '[<64 hex>]' is the ENS convention for a label known only by its hash (e.g. recovered from events).
export function labelhash(label) {
  if (/^\[[0-9a-f]{64}\]$/.test(label)) return '0x' + label.slice(1, -1);
  return '0x' + bytesToHex(keccak256(utf8ToBytes(label)));
}

// ERC-137 namehash: node('') = 32 zero bytes; node(label.rest) = keccak256(node(rest) || keccak256(label)).
// Recursive from the right so a parent node is computable without knowing its children, and ownership of 'eth'
// can be checked without hashing full names. Hashing the whole string instead would lose that hierarchy.
export function namehash(name) {
  const n = normalizeName(name);
  let node = new Uint8Array(32);
  if (n === '') return '0x' + bytesToHex(node);
  const labels = n.split('.');
  for (let i = labels.length - 1; i >= 0; i--) node = keccak256(concatBytes(node, fromHex(labelhash(labels[i]))));
  return '0x' + bytesToHex(node);
}

// DNS wire format (ENSIP-10): each label as <length byte><bytes>, terminated by 0x00. A length byte caps a label at
// 255 bytes; longer labels are replaced by their '[hash]' form (66 bytes) as the spec prescribes.
export function dnsEncode(name) {
  const n = normalizeName(name);
  const parts = [];
  for (const l of n ? n.split('.') : []) {
    let b = utf8ToBytes(l);
    if (b.length > 255) b = utf8ToBytes('[' + labelhash(l).slice(2) + ']');
    parts.push(Uint8Array.of(b.length), b);
  }
  parts.push(Uint8Array.of(0));
  return '0x' + bytesToHex(concatBytes(...parts));
}

// Requires a dot and rejects 0x addresses so an address field can route text to ENS only when it is not an address.
export function isEnsName(text) {
  if (typeof text !== 'string' || !text.includes('.') || /^0x[0-9a-fA-F]{40}$/.test(text)) return false;
  try { return normalizeName(text).length > 0; } catch { return false; }
}

// --- resolution -------------------------------------------------------------------------------------------

const OFFCHAIN_LOOKUP = '0x556f1830';
const EXTENDED_RESOLVER = '0x9061b923';

// EIP-3668 OffchainLookup is signalled as a revert whose data starts with selector 0x556f1830. Following it would mean
// fetching an arbitrary URL chosen by the resolver; this module deliberately surfaces it as code 'OFFCHAIN' instead.
async function ethCall(rpc, to, data) {
  try {
    if (typeof rpc.call === 'function') return await rpc.call({ to, data }, 'latest');
    return await rpc.request('eth_call', [{ to, data }, 'latest']);
  } catch (e) {
    const d = e && (typeof e.data === 'string' ? e.data : e.data && e.data.data);
    if (typeof d === 'string' && d.toLowerCase().startsWith(OFFCHAIN_LOOKUP)) throw Object.assign(new Error('ENS: offchain (CCIP-read) resolution is not supported'), { code: 'OFFCHAIN', data: d });
    throw e;
  }
}

// Empty return data ('0x') means "no such function / no record" on most resolvers; treated as the default, not an error.
const decodeOr = (types, data, dflt) => {
  try { return data && data !== '0x' ? decodeParameters(types, data)[0] : dflt; } catch { return dflt; }
};

async function registryResolver(rpc, node) {
  const r = decodeOr(['address'], await ethCall(rpc, ENS_REGISTRY, encodeFunctionData('resolver(bytes32)', [node])), ZERO_ADDRESS);
  return r === ZERO_ADDRESS ? null : r;
}

// Resolver of the name, or of its closest parent that has one (ENSIP-10 wildcards): { resolver, exact } | null.
async function findResolver(rpc, name) {
  let n = normalizeName(name);
  let exact = true;
  for (;;) {
    const r = await registryResolver(rpc, namehash(n));
    if (r) return { resolver: r, exact };
    const dot = n.indexOf('.');
    if (dot < 0) return null;
    n = n.slice(dot + 1);
    exact = false;
  }
}

export async function getResolver(rpc, name) {
  const f = await findResolver(rpc, name);
  return f ? f.resolver : null;
}

// 0x9061b923 = ERC-165 id of IExtendedResolver (resolve(bytes,bytes)). Old resolvers revert on unknown calls; any
// failure other than OFFCHAIN means "not extended".
async function supportsExtended(rpc, resolver) {
  try {
    return decodeOr(['bool'], await ethCall(rpc, resolver, encodeFunctionData('supportsInterface(bytes4)', [EXTENDED_RESOLVER])), false);
  } catch (e) {
    if (e && e.code === 'OFFCHAIN') throw e;
    return false;
  }
}

// Calls `data` (a call for `node`) on the resolver of `name`, through resolve(bytes,bytes) when it is an extended one.
async function resolverCall(rpc, name, data) {
  const f = await findResolver(rpc, name);
  if (!f) return null;
  if (await supportsExtended(rpc, f.resolver)) {
    const out = await ethCall(rpc, f.resolver, encodeFunctionData('resolve(bytes,bytes)', [dnsEncode(name), data]));
    return decodeOr(['bytes'], out, null);
  }
  // A parent's resolver may answer for a child name only through resolve(bytes,bytes) (wildcard); calling addr(node)
  // of the child on a non-extended parent resolver would return the parent's unrelated record, or nothing.
  if (!f.exact) return null;
  return ethCall(rpc, f.resolver, data);
}

export async function resolveName(rpc, name) {
  const n = normalizeName(name);
  const out = await resolverCall(rpc, n, encodeFunctionData('addr(bytes32)', [namehash(n)]));
  const a = decodeOr(['address'], out, null);
  return a && a !== ZERO_ADDRESS ? a : null;
}

// Reverse records are self-asserted: anyone can set name(<their addr>.addr.reverse) to "vitalik.eth". The record is
// trusted only if the forward resolution of that name points back to the same address (the two-way check below).
export async function lookupAddress(rpc, address) {
  const a = getAddress(address);
  const reverse = a.slice(2).toLowerCase() + '.addr.reverse';
  const out = await resolverCall(rpc, reverse, encodeFunctionData('name(bytes32)', [namehash(reverse)]));
  const name = decodeOr(['string'], out, null);
  if (!name) return null;
  try { if (normalizeName(name) !== name) return null; } catch { return null; }
  let forward = null;
  try { forward = await resolveName(rpc, name); } catch { return null; }
  return forward && equalAddress(forward, a) ? name : null;
}
