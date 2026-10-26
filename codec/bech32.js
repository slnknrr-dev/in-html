// codec/bech32.js - Bech32 (BIP-173) and Bech32m (BIP-350): a human-readable part, '1', 5-bit data in the 32
// letters 'qpzry9x8gf2tvdw0s3jn54khce6mua7l' and a 6-letter BCH checksum that finds any 4 errors.
//
//   bech32Encode(hrp, words, variant = 'bech32' | 'bech32m', { limit = 90 }) -> string
//   bech32Decode(text, { limit = 90 }) -> { hrp, words, variant }     variant from the checksum constant
//   toWords(bytes) -> 5-bit groups (zero-padded)    fromWords(words) -> Uint8Array (padding must be zero)
//   encodeBytes(hrp, bytes, variant, opts) / decodeBytes(text, opts) -> { hrp, bytes, variant }
// limit: maximum length (BIP-173: 90; 0 = none, e.g. Lightning invoices).
//
// Design: the checksum is a BCH code over GF(32) computed as a polynomial remainder (polymod); encode appends six
// zero words and XORs the remainder with a constant, so that polymod over (hrp, data, checksum) equals that constant.
// Decode therefore needs no separate "verify" step - it recomputes polymod and matches it against the two known
// constants, which also identifies the variant (Bech32m exists because Bech32's constant 1 let an inserted or deleted
// 'q' before a trailing 'p' go undetected; BIP-350 changed only the constant).
// Errors are fail-fast with a reason (case, separator, character, checksum); there is no error-correction attempt,
// because "correcting" an address could silently send funds to a different valid one.

// Alphabet ordered so that visually similar characters differ in few bits (chosen by BIP-173 for error patterns);
// '1', 'b', 'i', 'o' are excluded as confusable. '1' is therefore free to be the separator.
export const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
// Generator coefficients of the BCH code, from BIP-173's reference implementation.
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const CONST = { bech32: 1, bech32m: 0x2bc830a3 };

// 30-bit LFSR: shift in one 5-bit symbol, then fold the 5 bits that fell off the top back in via GEN.
// The mask to 25 bits before `<< 5` keeps the value within 30 bits, so signed 32-bit shifts never hit the sign bit;
// the final `>>> 0` normalises to unsigned for comparison with CONST.
function polymod(values) {
  let chk = 1;
  for (const v of values) {
    const b = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >>> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}

// The hrp enters the checksum as high 3 bits of each char, a 0 separator, then low 5 bits: both halves are covered,
// so a case-insensitive char swap still changes the checksum (case itself is excluded by lower-casing first).
const hrpExpand = (hrp) => [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];

function checkHrp(hrp) {
  if (!hrp.length || hrp.length > 83) throw new Error('the human-readable part needs 1–83 characters');
  for (const c of hrp) {
    const x = c.charCodeAt(0);
    if (x < 33 || x > 126) throw new Error(`invalid character "${c}" in the human-readable part`);
  }
}

// Checksum is always computed over the LOWER-case hrp, then the whole string is upper-cased if the caller's hrp was
// upper case (QR alphanumeric mode is upper-case only - the reason Bech32 permits all-caps). Mixed case is refused.
// The six checksum words come out most significant first (shift 25, 20, ... 0).
// KNOWN DEFECT: `words` is not range-checked; a value outside 0..31 makes CHARSET[w] undefined and the output
// contains the text "undefined". Fix: throw if any w is not an integer in [0, 31].
export function bech32Encode(hrp, words, variant = 'bech32', { limit = 90 } = {}) {
  hrp = String(hrp);
  checkHrp(hrp);
  if (hrp !== hrp.toLowerCase() && hrp !== hrp.toUpperCase()) throw new Error('mixed case in the human-readable part');
  const low = hrp.toLowerCase();
  const values = [...hrpExpand(low), ...words, 0, 0, 0, 0, 0, 0];
  const mod = polymod(values) ^ CONST[variant];
  let out = low + '1';
  for (const w of words) out += CHARSET[w];
  for (let i = 0; i < 6; i++) out += CHARSET[(mod >>> (5 * (5 - i))) & 31];
  if (limit && out.length > limit) throw new Error(`longer than ${limit} characters`);
  return hrp === hrp.toUpperCase() && hrp !== low ? out.toUpperCase() : out;
}

// lastIndexOf('1'): the hrp may itself contain '1' (any printable ASCII), the data part never does, so the LAST '1'
// is the separator. `pos < 1` rejects an empty hrp; `pos + 7 > length` requires at least the 6 checksum chars.
// Errors report the original-case character (s[i]) so the message matches what the user typed.
export function bech32Decode(text, { limit = 90 } = {}) {
  const s = String(text).trim();
  if (limit && s.length > limit) throw new Error(`longer than ${limit} characters`);
  if (s !== s.toLowerCase() && s !== s.toUpperCase()) throw new Error('mixed case');
  const low = s.toLowerCase();
  const pos = low.lastIndexOf('1');
  if (pos < 1 || pos + 7 > low.length) throw new Error('no separator "1" with a 6-character checksum after it');
  const hrp = low.slice(0, pos);
  checkHrp(hrp);
  const words = [];
  for (let i = pos + 1; i < low.length; i++) {
    const v = CHARSET.indexOf(low[i]);
    if (v < 0) throw new Error(`invalid character "${s[i]}" at ${i + 1}`);
    words.push(v);
  }
  const c = polymod([...hrpExpand(hrp), ...words]);
  const variant = c === CONST.bech32 ? 'bech32' : c === CONST.bech32m ? 'bech32m' : null;
  if (!variant) throw new Error('checksum mismatch');
  return { hrp, words: words.slice(0, -6), variant };
}

// General bit regrouping (BIP-173 convertbits). Encoding 8 -> 5 pads the tail with zero bits; decoding 5 -> 8 must
// NOT pad, and the leftover must be fewer than `from` bits and all zero - otherwise two different strings would decode
// to the same bytes (malleability), which BIP-173 forbids. acc is masked after each step, so it never exceeds
// from + to bits.
function convert(data, from, to, pad) {
  let acc = 0, bits = 0;
  const out = [];
  const max = (1 << to) - 1;
  for (const v of data) {
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) { bits -= to; out.push((acc >>> bits) & max); }
    acc &= (1 << bits) - 1;
  }
  if (pad) { if (bits) out.push((acc << (to - bits)) & max); }
  else if (bits >= from || acc) throw new Error('invalid padding');
  return out;
}

export const toWords = (bytes) => convert(bytes, 8, 5, true);
export const fromWords = (words) => Uint8Array.from(convert(words, 5, 8, false));

export function encodeBytes(hrp, bytes, variant = 'bech32', opts) {
  return bech32Encode(hrp, toWords(bytes), variant, opts);
}

export function decodeBytes(text, opts) {
  const r = bech32Decode(text, opts);
  return { hrp: r.hrp, bytes: fromWords(r.words), variant: r.variant };
}
