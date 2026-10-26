// codec/base100.js - Base100 ("emoji encoding", Adam Niederer's base100): every byte b becomes the emoji U+1F3F7 + b
// (4 bytes of UTF-8 per input byte).
//   base100Encode(bytes) -> string        base100Decode(text) -> Uint8Array   (whitespace ignored)
//
// Design: a pure 1:1 byte <-> code point map, no grouping, no padding, no state. 300 % size overhead in UTF-8 is the
// price of the novelty; the point of the module is round-trip compatibility with the reference implementation, so the
// base code point is the reference's constant, not a "nicer" emoji block.

// U+1F3F7 .. U+1F4F6: 256 consecutive assigned emoji, all outside the BMP. That is why the code below must iterate
// by code point (for..of / codePointAt), never by UTF-16 unit (s[i] / charCodeAt), which would see surrogate halves.
const FIRST = 0x1f3f7;

// String concatenation, not an array join: V8 ropes make += linear for this size class; fromCodePoint (not
// fromCharCode) because the code points are astral and need a surrogate pair.
export function base100Encode(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCodePoint(FIRST + bytes[i]);
  return out;
}

// Fail-fast decoder: any non-whitespace symbol outside the 256-wide window throws with a 1-based position counted in
// code points (what a user sees), not UTF-16 units. Whitespace is skipped so wrapped / pasted text decodes.
// `!(b >= 0 && b <= 255)` rather than `b < 0 || b > 255`: also rejects NaN (cannot occur for a non-empty ch, but the
// negated form is the defensive idiom for "not a valid range member").
export function base100Decode(text) {
  const out = [];
  let i = 0;
  for (const ch of String(text)) {
    i++;
    if (/\s/.test(ch)) continue;
    const b = ch.codePointAt(0) - FIRST;
    if (!(b >= 0 && b <= 255)) throw new Error(`"${ch}" is not a Base100 symbol (at ${i})`);
    out.push(b);
  }
  return Uint8Array.from(out);
}
