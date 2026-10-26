// codec/base91.js - basE91 (Joachim Henke): 13 or 14 bits per pair of characters from 91 printable ASCII letters
// (no '-', '\'' or '\\'), about 23 % overhead.
//   base91Encode(bytes) -> string        base91Decode(text) -> Uint8Array   (characters outside the alphabet skipped)
//
// The trick: 91^2 = 8281 > 8192 = 2^13, so a pair always carries 13 bits, with 89 spare codes. When the next 13 bits
// have a value <= 88, the encoder takes a 14th bit instead (8192 + 88 < 8281 still fits), squeezing out extra bits.
// The decoder knows which case applies from the pair value itself (low 13 bits > 88 -> it was 13 bits).
// Bit order is LSB-first (bytes enter at the high end of the accumulator `b`), mirroring the reference C code;
// that is why it uses `|= x << n` and `>>>=` rather than shifting the accumulator left.

export const B91 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,./:;<=>?@[]^_`{|}~"';
// Map, not indexOf: O(1) lookup per character, and undefined cleanly signals "not in alphabet".
const IDX = new Map([...B91].map((c, i) => [c, i]));

// b: bit accumulator (at most 8 + 13 = 21 live bits, so 32-bit ops are safe); n: live bit count.
// Emission when more than 13 bits are buffered: try 13 bits; if their value <= 88 it is ambiguous with the 14-bit
// space, so take 14 bits. Low digit first (v % 91, then v / 91) as in the reference.
// Tail: one char if the leftover fits in one digit (n <= 7 bits and value < 91), else two.
export function base91Encode(bytes) {
  let out = '';
  let b = 0, n = 0;
  for (let i = 0; i < bytes.length; i++) {
    b |= bytes[i] << n;
    n += 8;
    if (n > 13) {
      let v = b & 8191;
      if (v > 88) { b >>>= 13; n -= 13; } else { v = b & 16383; b >>>= 14; n -= 14; }
      out += B91[v % 91] + B91[Math.floor(v / 91)];
    }
  }
  if (n) {
    out += B91[b % 91];
    if (n > 7 || b > 90) out += B91[Math.floor(b / 91)];
  }
  return out;
}

// v = -1 marks "waiting for the first character of a pair". Foreign characters are skipped (reference behaviour),
// so line breaks and whitespace need no special case - but so are typos: this decoder never fails, it is lenient by
// design, and corrupted input decodes to wrong bytes rather than an error.
// A dangling single character at the end carries the final < 8 bits (flushed as one byte).
export function base91Decode(text) {
  const out = [];
  let v = -1, b = 0, n = 0;
  for (const c of String(text)) {
    const d = IDX.get(c);
    if (d === undefined) continue;
    if (v < 0) { v = d; continue; }
    v += d * 91;
    b |= v << n;
    n += (v & 8191) > 88 ? 13 : 14;
    do { out.push(b & 255); b >>>= 8; n -= 8; } while (n > 7);
    v = -1;
  }
  if (v > -1) out.push((b | (v << n)) & 255);
  return Uint8Array.from(out);
}
