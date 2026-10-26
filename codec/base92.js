// codec/base92.js - Base92 (thenoviceoof's base92): 13 bits per pair of characters, a last 1–6 bits as one character;
// 91 letters '!', '#'…'_', 'a'…'}' (no '"' or '`'), and '~' alone for an empty input.
//   base92Encode(bytes) -> string        base92Decode(text) -> Uint8Array
//
// Unlike basE91 this is a fixed-width bit stream (always 13 bits per pair, MSB-first), simpler but ~1 % less dense.
// Despite the name only 91 symbols are digits; '~' is the 92nd, reserved as the empty-input sentinel, so an empty
// string is distinguishable from "no data field" in the reference format.

// Digit <-> character as arithmetic, not a lookup string: the alphabet is two contiguous ASCII runs with holes at
// '"' (34) and '`' (96), plus '!' (33) for 0. ord() is the exact inverse and doubles as the validator.
const chr = (v) => String.fromCharCode(v === 0 ? 33 : v <= 61 ? 34 + v : 35 + v); // 0 '!', 1..61 '#'..'_', 62..90 'a'..'}'
function ord(c, i) {
  const x = c.charCodeAt(0);
  if (x === 33) return 0;
  if (x >= 35 && x <= 95) return x - 34;
  if (x >= 97 && x <= 125) return x - 35;
  throw new Error(`invalid character "${c}" at ${i + 1}`);
}

// acc is masked to 21 bits (0x1fffff): at most 12 pending + 8 new = 20 bits are live, so the mask only discards
// already-emitted high bits and keeps `acc << 8` far from the 32-bit sign bit.
export function base92Encode(bytes) {
  if (!bytes.length) return '~';
  let out = '';
  let acc = 0, n = 0; // pending bits, most significant first
  for (let i = 0; i < bytes.length; i++) {
    acc = ((acc << 8) | bytes[i]) & 0x1fffff;
    n += 8;
    if (n >= 13) {
      n -= 13;
      const v = (acc >>> n) & 8191;
      out += chr(Math.floor(v / 91)) + chr(v % 91);
    }
  }
  // Tail: up to 6 bits as one character, 7–12 bits as a zero-filled 13-bit pair (the reference's rule).
  if (n > 0) {
    if (n < 7) out += chr((acc << (6 - n)) & 63);
    else {
      const v = (acc << (13 - n)) & 8191;
      out += chr(Math.floor(v / 91)) + chr(v % 91);
    }
  }
  return out;
}

// Pairs first, then an optional single 6-bit tail character (odd length). Zero-fill bits that do not complete a byte
// are dropped by the `while (n >= 8)` loop - that is how padding disappears without being encoded explicitly.
// `acc &= (1 << n) - 1` after each byte leaves fewer than 8 live bits, so the next `<< 13` stays below 2^21.
// Range checks: a pair can reach 90·91 + 90 = 8280 > 8191, a single char up to 90 > 63 - both malformed.
export function base92Decode(text) {
  const s = String(text).replace(/\s+/g, '');
  if (s === '~' || s === '') return new Uint8Array(0);
  const out = [];
  let acc = 0, n = 0;
  const pairs = Math.floor(s.length / 2);
  for (let i = 0; i < pairs; i++) {
    const v = ord(s[2 * i], 2 * i) * 91 + ord(s[2 * i + 1], 2 * i + 1);
    if (v > 8191) throw new Error(`pair ${i + 1} is out of range`);
    acc = ((acc << 13) | v) >>> 0;
    n += 13;
    while (n >= 8) { n -= 8; out.push((acc >>> n) & 255); acc &= (1 << n) - 1; }
  }
  if (s.length % 2) {
    const v = ord(s[s.length - 1], s.length - 1);
    if (v > 63) throw new Error('last character is out of range');
    acc = (acc << 6) | v;
    n += 6;
    while (n >= 8) { n -= 8; out.push((acc >>> n) & 255); acc &= (1 << n) - 1; }
  }
  return Uint8Array.from(out);
}
