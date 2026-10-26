// codec/rfc4648.js - bit-group encodings: Base16, Base32, Base64 (RFC 4648) and their alphabets — base32hex,
// Crockford's Base32, z-base-32, base64url and the GMP digit order.
//
//   bitsEncode(bytes, alphabet, { pad = false, wrap = 0 }) -> string   4, 5 or 6 bits per character (16 / 32 / 64
//                                     letters), most significant first; pad: '=' up to a whole quantum (8 / 4 chars);
//                                     wrap: line length (0 = one line; MIME uses 76)
//   bitsDecode(text, alphabet, { caseless, aliases, ignore }) -> Uint8Array   whitespace and '=' padding ignored,
//                                     aliases: extra letters for a value ({ O: 0, I: 1, … }), ignore: other characters
//                                     to skip (Crockford: '-'); trailing non-zero bits are rejected
//   B16, B32, B32HEX, CROCKFORD, ZBASE32, B64, B64URL, GMP64: the alphabets
//
// One engine for every power-of-two base: the alphabet length decides bits per char (16 -> 4, 32 -> 5, 64 -> 6), so
// the variants are data, not code. A streaming bit accumulator (acc, n) replaces per-base quantum loops; the
// accumulator is masked to 16 bits because at most bits + 7 <= 13 bits are live, which keeps `<< 8` sign-safe.
// Strictness: trailing non-zero bits are rejected (RFC 4648 section 3.5 "canonical encoding") so one byte string
// has one encoding - matters when encodings are compared or hashed.

export const B16 = '0123456789ABCDEF';
export const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const B32HEX = '0123456789ABCDEFGHIJKLMNOPQRSTUV';
export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const ZBASE32 = 'ybndrfg8ejkmcpqxot1uwisza345h769';
export const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
// GMP's digit order (0-9, A-Z, a-z) completed with '+' and '/': the same bit groups as Base64.
export const GMP64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/';

// Crockford: decoders map the look-alikes (case-insensitive).
export const CROCKFORD_ALIASES = { O: 0, I: 1, L: 1 };

// Fail-fast on a malformed alphabet: Math.log2 of a non-power-of-two is fractional and fails includes().
const bitsOf = (alphabet) => {
  const b = Math.log2(alphabet.length);
  if (![4, 5, 6].includes(b)) throw new Error('the alphabet needs 16, 32 or 64 letters');
  return b;
};
// Characters per padded quantum: 8 bits * k = bits * chars.
const QUANTUM = { 4: 2, 5: 8, 6: 4 };

export function bitsEncode(bytes, alphabet, { pad = false, wrap = 0 } = {}) {
  const bits = bitsOf(alphabet);
  const mask = (1 << bits) - 1;
  // Character codes first, joined into a string in slices (fast for multi-megabyte inputs).
  const codes = Uint8Array.from(alphabet, (c) => c.charCodeAt(0));
  const len = Math.ceil((bytes.length * 8) / bits);
  const q = QUANTUM[bits];
  const buf = new Uint8Array(pad ? Math.ceil(len / q) * q : len);
  let acc = 0, n = 0, o = 0;
  for (let i = 0; i < bytes.length; i++) {
    acc = ((acc << 8) | bytes[i]) & 0xffff;
    n += 8;
    while (n >= bits) { n -= bits; buf[o++] = codes[(acc >>> n) & mask]; }
  }
  // Leftover bits are left-aligned and zero-filled (the canonical form the decoder insists on).
  if (n > 0) buf[o++] = codes[(acc << (bits - n)) & mask];
  // buf was sized to the padded length up front, so padding is a fill of the tail (no-op when pad is false).
  buf.fill(61, o); // '='
  let out = '';
  for (let i = 0; i < buf.length; i += 0x2000) out += String.fromCharCode.apply(null, buf.subarray(i, i + 0x2000));
  if (wrap > 0 && out.length > wrap) out = out.match(new RegExp(`.{1,${wrap}}`, 'g')).join('\n');
  return out;
}

// Only TRAILING '=' are stripped; an '=' left inside the data is not in any alphabet and gets a specific message.
// Length validity falls out of the bit count: a leftover of >= `bits` bits means a whole character contributed no
// byte, which no encoder produces (e.g. 4k + 1 base64 chars) -> 'impossible length'.
// Aliases are registered in both cases regardless of `caseless` (Crockford is case-insensitive by definition).
export function bitsDecode(text, alphabet, { caseless = false, aliases = null, ignore = '' } = {}) {
  const bits = bitsOf(alphabet);
  const map = new Map();
  for (let i = 0; i < alphabet.length; i++) {
    map.set(alphabet[i], i);
    if (caseless) { map.set(alphabet[i].toLowerCase(), i); map.set(alphabet[i].toUpperCase(), i); }
  }
  if (aliases) for (const [c, v] of Object.entries(aliases)) { map.set(c, v); map.set(c.toLowerCase(), v); map.set(c.toUpperCase(), v); }
  const s = String(text).replace(/\s+/g, '').replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((s.length * bits) / 8));
  let acc = 0, n = 0, o = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (ignore && ignore.includes(c)) continue;
    const v = map.get(c);
    if (v === undefined) throw new Error(c === '=' ? `padding inside the data at ${i + 1}` : `invalid character "${c}" at ${i + 1}`);
    acc = ((acc << bits) | v) & 0xffff;
    n += bits;
    if (n >= 8) { n -= 8; out[o++] = (acc >>> n) & 255; }
  }
  if (n >= bits) throw new Error('impossible length');
  if (acc & ((1 << n) - 1)) throw new Error('non-zero trailing bits');
  return out.subarray(0, o);
}
