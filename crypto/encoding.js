// crypto/encoding.js - byte helpers shared by the crypto library: UTF-8, hex, base64 / base64url, base32 (RFC 4648),
// concatenation, constant-time comparison, wiping, little / big endian word access.
//
// Design rules:
// - Decoders are liberal about presentation (case, whitespace, separators, missing padding) and strict about
//   content (any foreign character throws). Pasted keys arrive formatted every which way; a silent skip of an invalid
//   character would instead change the key.
// - Not constant time except equalBytes: hex / base64 / base32 go through lookup tables, parseInt and atob, whose
//   timing depends on the data. Acceptable for encoding keys in a local UI; a remote-oracle setting would need
//   branch-free table-free codecs.
// - Endianness is explicit in every word helper (LE / BE in the name); nothing here depends on platform byte order.
import { b64decode, b64encode } from '../codec/base64.js';

// One encoder / decoder pair per module, not per call: construction is not free and they are stateless for
// whole-buffer decode. TextEncoder replaces lone surrogates with U+FFFD (WHATWG "USVString" conversion), so two
// different JS strings can encode to the same bytes - harmless for passwords typed by humans, worth knowing for keys.
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8');
const decStrict = new TextDecoder('utf-8', { fatal: true });

export const utf8ToBytes = (s) => enc.encode(String(s));
// fatal: throw on invalid UTF-8 instead of inserting U+FFFD.
export const bytesToUtf8 = (b, fatal = false) => (fatal ? decStrict : dec).decode(b);

// Bytes of any input: strings are UTF-8 encoded, buffers and typed arrays are viewed (not copied). Subclasses
// (Node's Buffer, whose slice() does not copy) become plain Uint8Array views.
// View, not copy: hashing a 1 GB file must not double memory. Consequence for callers: the result aliases the input,
// so a module that keeps or wipes it must .slice() first (see AesCbc iv, setTag). null / undefined -> empty, so an
// omitted optional argument (aad, info, salt) behaves as the empty string the specs define; other types throw rather
// than being stringified ("[object Object]" as a key would be a silent disaster).
export function toBytes(data) {
  if (data instanceof Uint8Array) return data.constructor === Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === 'string') return enc.encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data == null) return new Uint8Array(0);
  throw new TypeError('bytes expected');
}

// 256-entry string table: one lookup per byte instead of toString(16) + padStart. String += in a loop is a rope in
// V8, so it is linear, not quadratic. Table index = secret byte (cache-timing, see the header).
const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
export function bytesToHex(b) {
  let s = '';
  for (let i = 0; i < b.length; i++) s += HEX[b[i]];
  return s;
}
// Accepts upper / lower case and ignores whitespace, ':' and '-' separators (as printed by many tools).
// The validity test runs before parseInt because parseInt('0g', 16) returns 0 instead of failing: without it a typo
// would decode to a different key. Odd length throws (no implicit leading zero: ambiguous for byte strings).
export function hexToBytes(hex) {
  const s = String(hex).replace(/[\s:-]+/g, '');
  if (s.length % 2 || /[^0-9a-f]/i.test(s)) throw new Error('invalid hex');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}
export const isHex = (s) => /^(?:[0-9a-f]{2})*$/i.test(String(s).replace(/[\s:-]+/g, ''));

// base64url (RFC 4648 section 5) is derived from the standard output by alphabet mapping and dropping '=' (JWT / JWK
// style), so there is exactly one encoder to get right.
export const bytesToBase64 = (b) => b64encode(b);
export const bytesToBase64Url = (b) => b64encode(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// Standard or URL-safe alphabet, padding optional, whitespace ignored; anything else throws.
// length % 4 === 1 (after removing padding) is impossible for any byte string (a lone sextet carries 6 of 8 bits),
// so it is rejected here; 2 and 3 are valid unpadded tails. Non-canonical trailing bits (e.g. "QR==" vs "QQ==") are
// accepted by atob underneath: two texts can decode to the same bytes - do not compare base64 strings as identities.
export function base64ToBytes(s) {
  const t = String(s).replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(t) || t.replace(/=+$/, '').length % 4 === 1) throw new Error('invalid base64');
  return b64decode(t);
}

// RFC 4648 base32 (not base32hex, not Crockford). Bit accumulator: bytes shift in 8 bits at a time, 5-bit groups
// shift out MSB first; acc is masked to its low byte after each byte (fewer than 5 pending bits always fit), so it never exceeds 16
// significant bits and cannot overflow int32 however long the input.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function bytesToBase32(b, pad = true) {
  let out = '', bits = 0, acc = 0;
  for (let i = 0; i < b.length; i++) {
    acc = (acc << 8) | b[i];
    bits += 8;
    while (bits >= 5) { out += B32[(acc >>> (bits - 5)) & 31]; bits -= 5; }
    acc &= 0xff;
  }
  if (bits) out += B32[(acc << (5 - bits)) & 31];
  if (pad) while (out.length % 8) out += '=';
  return out;
}
// Case-insensitive, spaces / dashes / padding ignored (TOTP secrets are often grouped and lower case).
// Output length floor(5n / 8): leftover bits (< 8) are dropped without checking they are zero, so non-canonical
// encodings decode too (lenient on purpose for TOTP secrets). '=' anywhere is stripped, not only at the end.
export function base32ToBytes(s) {
  const t = String(s).toUpperCase().replace(/[\s=-]+/g, '');
  const out = new Uint8Array(Math.floor((t.length * 5) / 8));
  let bits = 0, acc = 0, o = 0;
  for (let i = 0; i < t.length; i++) {
    const v = B32.indexOf(t[i]);
    if (v < 0) throw new Error('invalid base32');
    acc = ((acc << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) { out[o++] = (acc >>> (bits - 8)) & 0xff; bits -= 8; }
  }
  return out;
}

export function concatBytes(...parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// Constant-time equality (time depends on the length only): MAC and tag checks.
// OR-accumulate the XOR of every pair and decide once at the end: no early exit, so the time does not reveal the
// length of the matching prefix (the byte-at-a-time tag forgery that `a[i] !== b[i] return false` allows). The
// length check may exit early: lengths are public (tag sizes are fixed by the algorithm). Caveat: no JS engine
// promises not to optimise this; it is the best a JIT language offers, verified by inspection, not by guarantee.
export function equalBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

// Overwrites secrets in place (keys, passwords, intermediate states).
// Best effort: earlier copies (GC moves, strings, slices made by callers) are out of reach. Duck-typed on .fill so
// it accepts every typed array and tolerates null for optional buffers.
export function wipe(...arrays) {
  for (const a of arrays) if (a && typeof a.fill === 'function') a.fill(0);
}

// `>>> 0` makes the reads unsigned: `b[o + 3] << 24` is negative for bytes >= 0x80 in int32 arithmetic. Writes need no
// masking: assignment into a Uint8Array truncates modulo 256.
export const readU32LE =(b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
export const readU32BE = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
export function writeU32LE(b, o, v) { b[o] = v; b[o + 1] = v >>> 8; b[o + 2] = v >>> 16; b[o + 3] = v >>> 24; }
export function writeU32BE(b, o, v) { b[o] = v >>> 24; b[o + 1] = v >>> 16; b[o + 2] = v >>> 8; b[o + 3] = v; }
// 64-bit values as Numbers (exact up to 2^53). Enough for lengths and counters (KDBX header fields, GCM lengths);
// not for arbitrary u64 data, where BigInt (getBigUint64) would be needed. The high half is split off by division,
// not `>>> 32` (JS shift counts are taken mod 32, so `v >>> 32` is `v >>> 0`).
export const readU64LE = (b, o) => readU32LE(b, o) + readU32LE(b, o + 4) * 0x100000000;
export function writeU64LE(b, o, v) { writeU32LE(b, o, v >>> 0); writeU32LE(b, o + 4, Math.floor(v / 0x100000000) >>> 0); }
export function writeU64BE(b, o, v) { writeU32BE(b, o, Math.floor(v / 0x100000000) >>> 0); writeU32BE(b, o + 4, v >>> 0); }
