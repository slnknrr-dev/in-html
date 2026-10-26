// codec/punycode.js - Punycode (RFC 3492, Bootstring) and the IDNA wrapper for domain names.
//
//   punycodeEncode(label) -> string      Unicode label -> ASCII ("bücher" -> "bcher-kva")
//   punycodeDecode(ascii) -> string      the reverse
//   domainToASCII(domain) -> string      labels with non-ASCII characters become "xn--" + Punycode (NFC, lower case;
//                                        full UTS #46 mapping is not applied); '。', '．', '｡' separate labels too
//   domainToUnicode(domain) -> string    "xn--" labels decoded

//
// Bootstring in one paragraph: basic (ASCII) code points are copied first, then the non-basic ones are inserted in
// ascending code-point order. Each insertion is a single integer delta (how far to advance a combined
// (code point, position) counter), written as a variable-length base-36 number whose digit thresholds t adapt to the
// recent delta sizes (bias). The decoder replays the same state machine. All constants are fixed by RFC 3492 section
// 5; any change breaks interoperability with every IDN resolver.
// Why hand-written: the URL API would do domainToASCII, but it applies full UTS #46 mapping, rejects some inputs,
// and does not expose raw Punycode of a single label - a codec tool needs the raw transform.

const BASE = 36, TMIN = 1, TMAX = 26, SKEW = 38, DAMP = 700, INITIAL_BIAS = 72, INITIAL_N = 128;

// Bias adaptation (RFC 3492 section 6.1): scale delta down (heavily after the first insertion, DAMP, since the first
// delta is large by construction), compensate for the growing string, then count how many base-35 divisions bring it
// under the threshold - the new bias predicts how many digits the next delta will need.
function adapt(delta, numPoints, first) {
  delta = first ? Math.floor(delta / DAMP) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  let k = 0;
  while (delta > ((BASE - TMIN) * TMAX) >> 1) { delta = Math.floor(delta / (BASE - TMIN)); k += BASE; }
  return k + Math.floor(((BASE - TMIN + 1) * delta) / (delta + SKEW));
}

// Digit values: a..z = 0..25, 0..9 = 26..35. Decoding is case-insensitive (RFC allows mixed-case annotation);
// encoding always emits lower case.
const digit = (d) => String.fromCharCode(d < 26 ? 97 + d : 22 + d); // 0..25 a..z, 26..35 0..9
function value(c) {
  const x = c.charCodeAt(0);
  if (x >= 48 && x <= 57) return x - 22;
  if (x >= 65 && x <= 90) return x - 65;
  if (x >= 97 && x <= 122) return x - 97;
  throw new Error(`invalid Punycode character "${c}"`);
}

// Array.from(String) iterates code points, so astral characters count as one (the RFC works on code points).
// The '-' delimiter is written only if there were basic characters; the decoder mirrors this with lastIndexOf('-').
// Overflow guard uses MAX_SAFE_INTEGER instead of the RFC's 32-bit maxint: JS numbers are exact to 2^53, and real
// labels (<= 63 chars) never come near either bound - the guard is for adversarial input only.
// Per round: m = smallest code point not yet handled; delta jumps over (m - n) * (h + 1) states; then every char
// below n bumps delta, every char equal to n emits delta as a generalized variable-length integer.
export function punycodeEncode(input) {
  const cps = Array.from(String(input), (c) => c.codePointAt(0));
  let out = cps.filter((c) => c < 128).map((c) => String.fromCharCode(c)).join('');
  const b = out.length;
  let h = b;
  if (b > 0) out += '-';
  let n = INITIAL_N, delta = 0, bias = INITIAL_BIAS;
  while (h < cps.length) {
    let m = Infinity;
    for (const c of cps) if (c >= n && c < m) m = c;
    if ((m - n) * (h + 1) > Number.MAX_SAFE_INTEGER - delta) throw new Error('overflow');
    delta += (m - n) * (h + 1);
    n = m;
    for (const c of cps) {
      if (c < n) delta++;
      if (c === n) {
        let q = delta;
        for (let k = BASE; ; k += BASE) {
          const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
          if (q < t) break;
          out += digit(t + ((q - t) % (BASE - t)));
          q = Math.floor((q - t) / (BASE - t));
        }
        out += digit(q);
        bias = adapt(delta, h + 1, h === b);
        delta = 0;
        h++;
      }
    }
    delta++;
    n++;
  }
  return out;
}

// Inverse state machine: read one variable-length delta into i (position and code point packed together), split it
// with / and % by the current length + 1, insert. out holds code points (splice into an array, then fromCodePoint
// once) - building a string per insertion would be quadratic and would break on astral characters.
// Safety checks: truncated digit sequence, non-safe integers (overflow), and code points above U+10FFFF all throw.
// Note: surrogate code points (U+D800..DFFF) are not rejected; fromCodePoint accepts them and yields lone surrogates.
export function punycodeDecode(input) {
  const s = String(input);
  const out = [];
  let basic = s.lastIndexOf('-');
  if (basic < 0) basic = 0;
  for (let j = 0; j < basic; j++) {
    if (s.charCodeAt(j) >= 128) throw new Error('non-ASCII character in the basic part');
    out.push(s.charCodeAt(j));
  }
  let n = INITIAL_N, i = 0, bias = INITIAL_BIAS;
  for (let p = basic > 0 ? basic + 1 : 0; p < s.length;) {
    const oldi = i;
    for (let w = 1, k = BASE; ; k += BASE) {
      if (p >= s.length) throw new Error('truncated input');
      const d = value(s[p++]);
      i += d * w;
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (d < t) break;
      w *= BASE - t;
      if (!Number.isSafeInteger(i) || !Number.isSafeInteger(w)) throw new Error('overflow');
    }
    bias = adapt(i - oldi, out.length + 1, oldi === 0);
    n += Math.floor(i / (out.length + 1));
    i %= out.length + 1;
    if (n > 0x10ffff) throw new Error('code point out of range');
    out.splice(i++, 0, n);
  }
  return String.fromCodePoint(...out);
}

// IDNA (RFC 3490 section 3.1) treats U+3002 ideographic full stop, U+FF0E fullwidth full stop and U+FF61 halfwidth
// ideographic full stop as label separators, because CJK input methods produce them where users mean '.'.
// Output always rejoins with ASCII '.'.
const SEP = /[.。．｡]/;

// ASCII labels pass through untouched (including their case); only labels with a non-ASCII char are NFC-normalised,
// lower-cased and encoded. NFC first so "u + combining diaeresis" and precomposed "ü" give the same xn-- label.
export function domainToASCII(domain) {
  return String(domain).split(SEP).map((label) => {
    // eslint-disable-next-line no-control-regex
    if (/^[\x00-\x7f]*$/.test(label)) return label;
    return 'xn--' + punycodeEncode(label.normalize('NFC').toLowerCase());
  }).join('.');
}

export function domainToUnicode(domain) {
  return String(domain).split(SEP).map((label) => (/^xn--/i.test(label) ? punycodeDecode(label.slice(4).toLowerCase()) : label)).join('.');
}
