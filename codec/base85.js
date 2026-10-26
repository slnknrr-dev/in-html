// codec/base85.js - the Base85 family: four bytes -> five characters (big-endian base 85), a last partial group of k
// bytes -> k + 1 characters.
//
//   base85Encode(bytes, alphabet = B85) / base85Decode(text, alphabet = B85)   RFC 1924 letters by default (as Git
//        binary patches and Python's b85encode); Z85 (ZeroMQ, same partial-group rule as Python's z85encode)
//   ascii85Encode(bytes, { adobe, foldSpaces, wrap }) / ascii85Decode(text)   btoa / PostScript letters '!'…'u',
//        'z' for a whole zero group, 'y' for four spaces (foldSpaces), adobe: <~ … ~> delimiters (Adobe85)
// Decoders skip whitespace; partial groups are completed with the highest digit.
//
// Why 85: the smallest base with base^5 >= 2^32 (84^5 < 2^32 < 85^5), so 5 chars carry exactly one 32-bit word -
// 25 % overhead against base64's 33 %. One engine (encodeGroups / decodeGroups) serves every variant; variants differ
// only in alphabet and the two shortcut characters, so they are parameters, not copies.
// Arithmetic: n stays below 2^32 and is built with `n * 256 + b` (float math), not `n << 8 | b` - JS bitwise ops are
// signed 32-bit and would turn words >= 2^31 negative, breaking the % 85 digit extraction.

// RFC 1924 order (digits, upper, lower, then 23 symbols). Z85 is a different permutation chosen to be safe inside
// source-code string literals (no quote, backslash). A85 is the contiguous run '!' (33) .. 'u' (117).
export const B85 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~';
export const Z85 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#';
export const A85 = Array.from({ length: 85 }, (_, i) => String.fromCharCode(33 + i)).join('');

// Partial last group: pad with zero bytes, encode 5 digits, keep only k + 1. Keeping k + 1 is the minimum that still
// determines k bytes uniquely (the decoder pads with the top digit and truncates; see decodeGroups).
// Shortcuts 'z' / 'y' apply only to FULL groups (k === 4): a partial zero group must stay "!!" etc., otherwise the
// decoder could not know how many bytes the 'z' stands for.
function encodeGroups(bytes, alphabet, zero, spaces) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 4) {
    const k = Math.min(4, bytes.length - i);
    let n = 0;
    for (let j = 0; j < 4; j++) n = n * 256 + (j < k ? bytes[i + j] : 0);
    if (k === 4 && n === 0 && zero) { out += zero; continue; }
    if (k === 4 && n === 0x20202020 && spaces) { out += spaces; continue; }
    const g = new Array(5);
    for (let j = 4; j >= 0; j--) { g[j] = alphabet[n % 85]; n = Math.floor(n / 85); }
    out += g.slice(0, k + 1).join('');
  }
  return out;
}

// Inverse. Padding a partial group with digit 84 (the highest) is the standard trick: the encoder truncated the low
// digits, so the true value lies in [prefix·85^m, prefix·85^m + 85^m - 1]; filling with 84 lands at the top of that
// range, whose high k bytes equal the original k bytes. Filling with 0 would round DOWN and corrupt the last byte.
// `>>>` (unsigned) for byte extraction because n may exceed 2^31.
// Shortcut characters are honoured only at a group boundary (!group.length): 'z' inside a group is a data digit in
// alphabets that contain it (Ascii85 does not, so there it is simply invalid mid-group -> map lookup fails).
// A single leftover digit cannot encode any byte (k + 1 >= 2) -> 'impossible length', fail-fast.
// Range check: 5 digits can reach 85^5 - 1 > 2^32 - 1; anything above 0xffffffff is malformed, not wrapped.
function decodeGroups(s, alphabet, zero, spaces) {
  const map = new Map([...alphabet].map((c, i) => [c, i]));
  const out = [];
  let group = [];
  const flush = (k) => {
    while (group.length < 5) group.push(84);
    let n = 0;
    for (const d of group) n = n * 85 + d;
    if (n > 0xffffffff) throw new Error('group out of range');
    for (let j = 0; j < k; j++) out.push((n >>> (24 - 8 * j)) & 255);
    group = [];
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (/\s/.test(c)) continue;
    if (zero && c === zero && !group.length) { out.push(0, 0, 0, 0); continue; }
    if (spaces && c === spaces && !group.length) { out.push(32, 32, 32, 32); continue; }
    const d = map.get(c);
    if (d === undefined) throw new Error(`invalid character "${c}" at ${i + 1}`);
    group.push(d);
    if (group.length === 5) flush(4);
  }
  if (group.length === 1) throw new Error('impossible length');
  if (group.length) flush(group.length - 1);
  return Uint8Array.from(out);
}

// RFC 1924 / Z85 have no shortcut characters (null, null). Note: strict ZeroMQ Z85 requires length % 4 === 0; this
// implementation accepts partial groups like Python's z85 variant, so it is a superset, not a validator.
export function base85Encode(bytes, alphabet = B85) {
  return encodeGroups(bytes, alphabet, null, null);
}

export function base85Decode(text, alphabet = B85) {
  return decodeGroups(String(text), alphabet, null, null);
}

// Ascii85: 'z' always on (part of the format); 'y' only on request (a btoa extension, not understood by every
// reader). wrap splits lines with a regex `.{1,wrap}`: '.' never matches '\n', and the body contains none, so every
// line is exactly `wrap` long except the last. Delimiters are added after wrapping so they never get split.
export function ascii85Encode(bytes, { adobe = false, foldSpaces = false, wrap = 0 } = {}) {
  let body = encodeGroups(bytes, A85, 'z', foldSpaces ? 'y' : null);
  if (wrap > 0 && body.length > wrap) body = body.match(new RegExp(`.{1,${wrap}}`, 'g')).join('\n');
  return adobe ? `<~${body}~>` : body;
}

// Liberal reader: delimiters optional (each end independently), 'y' accepted by default because 'y' (121) lies
// outside the A85 range '!'..'u', so treating it as the shortcut can never misread valid digits.
export function ascii85Decode(text, { foldSpaces = true } = {}) {
  let s = String(text).trim();
  if (s.startsWith('<~')) s = s.slice(2);
  if (s.endsWith('~>')) s = s.slice(0, -2);
  return decodeGroups(s, A85, 'z', foldSpaces ? 'y' : null);
}
