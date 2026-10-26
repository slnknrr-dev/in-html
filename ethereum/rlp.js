// ethereum/rlp.js - Recursive Length Prefix encoding (Ethereum Yellow Paper, appendix B) with canonical decoding.
//
//   rlpEncode(item) -> Uint8Array
//     item: Uint8Array | array of items | bigint / number (minimal big-endian bytes, 0 -> empty string)
//           | string ('0x…' hex bytes, anything else UTF-8) | null / undefined (empty string)
//   rlpDecode(bytes | '0x…', { stream = false }) -> Uint8Array | nested arrays of them
//     stream: the input is several items one after another -> [items]
//     Non-canonical input throws: a single byte < 0x80 written as a string, long forms for lengths < 56, lengths with
//     leading zero bytes, lengths past the end of the input, list items that do not fill the list, trailing bytes.
//   rlpToHex(decoded) -> the same tree with '0x…' strings (display, tests)
//   bytesToInt(bytes, what, maxBytes = 32) -> bigint: canonical integer field (no leading zero byte)
// Design: one strict decoder instead of a lenient one. RLP is hashed (tx hashes, CREATE addresses, trie keys), so two
// byte strings decoding to the same tree would give two hashes for one transaction: malleability. Every encoding has
// exactly one valid form, and the decoder rejects all others (the list above) rather than normalising them.
import { bytesToHex, concatBytes, utf8ToBytes } from '../crypto/encoding.js';
import { fromHex } from './units.js';

// Integers are minimal big-endian byte strings: 0 is the EMPTY string (not 0x00), 255 is 0xff, 256 is 0x0100.
// A leading zero byte would be a second encoding of the same number, so it is never produced (and bytesToInt rejects it).
function intBytes(n) {
  if (n < 0n) throw new Error('rlp: negative integer');
  if (n === 0n) return new Uint8Array(0);
  let h = n.toString(16);
  if (h.length & 1) h = '0' + h;
  return fromHex(h);
}

// Prefix byte layout (short = 0x80 for strings, 0xc0 for lists):
//   0x00..0x7f        a single byte that is its own encoding (strings only, handled in encode())
//   short + 0..55     short form: payload length in the prefix itself
//   short + 56..63    long form: prefix - short - 55 = number of length bytes that follow (1..8)
// 56 is the boundary because 0x80 + 55 = 0xb7 and 0xb8..0xbf leave room for 8 length bytes before 0xc0.
function header(len, short) {
  if (len < 56) return Uint8Array.of(short + len);
  const lb = intBytes(BigInt(len));
  return concatBytes(Uint8Array.of(short + 55 + lb.length), lb);
}

// depth guard: a cyclic or absurdly nested JS array would otherwise overflow the stack with an unhelpful RangeError.
// 1024 mirrors the decoder's bound so whatever encodes also decodes.
function encode(item, depth) {
  if (depth > 1024) throw new Error('rlp: nesting too deep');
  if (Array.isArray(item)) {
    const body = concatBytes(...item.map((x) => encode(x, depth + 1)));
    return concatBytes(header(body.length, 0xc0), body);
  }
  let b;
  if (item instanceof Uint8Array) b = item;
  else if (typeof item === 'bigint') b = intBytes(item);
  else if (typeof item === 'number') {
    if (!Number.isSafeInteger(item)) throw new Error('rlp: number must be a safe integer (use bigint)');
    b = intBytes(BigInt(item));
  } else if (typeof item === 'string') b = /^0x/i.test(item) ? fromHex(item) : utf8ToBytes(item);
  else if (item == null) b = new Uint8Array(0);
  else throw new TypeError('rlp: unsupported item ' + typeof item);
  // Single-byte rule: 0x00..0x7f encode as themselves; 0x80 must be written 0x81 0x80. slice() returns a copy so the
  // caller's buffer is never aliased into an encoding that might later be mutated.
  if (b.length === 1 && b[0] < 0x80) return b.slice();
  return concatBytes(header(b.length, 0x80), b);
}

export const rlpEncode = (item) => encode(item, 0);

function fail(why) { throw new Error('rlp: ' + why); }

// Item at offset o of b (end = limit): [value, next offset].
// `end` is the limit of the enclosing list, not of the whole input: an item whose length runs past its parent's end is
// rejected even if the bytes exist further on. That is what makes "list items that do not fill the list" detectable.
// subarray() views, not copies: decoding a 128 KB blob transaction allocates no payload memory.
function decodeAt(b, o, end, depth) {
  if (depth > 1024) fail('nesting too deep');
  if (o >= end) fail('unexpected end of input');
  const p = b[o];
  if (p < 0x80) return [b.subarray(o, o + 1), o + 1];
  let len, start;
  const isList = p >= 0xc0;
  const short = isList ? 0xc0 : 0x80;
  if (p - short < 56) {
    len = p - short;
    start = o + 1;
  } else {
    const ll = p - short - 55;
    if (o + 1 + ll > end) fail('length past the end of the input');
    // Canonical length: no leading zero byte, and the long form only for lengths >= 56 (checked below).
    if (b[o + 1] === 0) fail('length with leading zeros');
    // More than 6 length bytes means >= 2^48 bytes: no JS typed array is that large, and len * 256 would also leave the
    // range of exact doubles. Rejected before the loop, so `len` is always an exact safe integer.
    if (ll > 6) fail('length past the end of the input');
    len = 0;
    for (let i = 0; i < ll; i++) len = len * 256 + b[o + 1 + i];
    if (len < 56) fail('long form for a short length');
    start = o + 1 + ll;
  }
  if (start + len > end) fail('length past the end of the input');
  if (!isList) {
    if (len === 1 && b[start] < 0x80) fail('single byte below 0x80 written as a string');
    return [b.subarray(start, start + len), start + len];
  }
  const out = [];
  let q = start;
  while (q < start + len) {
    const [v, n] = decodeAt(b, q, start + len, depth + 1);
    out.push(v);
    q = n;
  }
  return [out, start + len];
}

// Stream mode decodes concatenated items (e.g. devp2p frames, test fixtures); empty input is then a valid zero-item
// stream. In single-item mode empty input and trailing bytes both throw: a hash over "item + junk" must not verify.
export function rlpDecode(input, { stream = false } = {}) {
  const b = typeof input === 'string' ? fromHex(input) : input;
  if (!(b instanceof Uint8Array)) throw new TypeError('rlp: bytes or hex expected');
  if (stream) {
    const out = [];
    let o = 0;
    while (o < b.length) { const [v, n] = decodeAt(b, o, b.length, 0); out.push(v); o = n; }
    return out;
  }
  if (!b.length) fail('empty input');
  const [v, n] = decodeAt(b, 0, b.length, 0);
  if (n !== b.length) fail('trailing bytes after the item');
  return v;
}

export const rlpToHex = (item) => (Array.isArray(item) ? item.map(rlpToHex) : '0x' + bytesToHex(item));

// A canonical RLP integer: no leading zero byte, at most maxBytes bytes.
// Error codes (RLP_INVALID / RLP_LEADING_ZEROS / OVERFLOW) are mapped by tx.js onto ethereum/tests exception names.
// maxBytes is the field's width (nonce 8 bytes per EIP-2681 at the call site, most others 32).
export function bytesToInt(b, what = 'integer', maxBytes = 32) {
  if (!(b instanceof Uint8Array)) throw Object.assign(new Error(`${what}: a list where an integer was expected`), { code: 'RLP_INVALID' });
  if (b.length && b[0] === 0) throw Object.assign(new Error(`${what}: leading zero bytes`), { code: 'RLP_LEADING_ZEROS' });
  if (b.length > maxBytes) throw Object.assign(new Error(`${what}: more than ${maxBytes} bytes`), { code: 'OVERFLOW' });
  return b.length ? BigInt('0x' + bytesToHex(b)) : 0n;
}
