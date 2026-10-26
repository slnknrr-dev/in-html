// codec/radix.js - radix encodings of bytes: the whole input as one big number (Base58, Base62, Base36, Base26, …)
// and fixed-width digits per byte (binary, octal, decimal and hex dumps).
//
//   radixEncode(bytes, alphabet) -> string     big-endian number in base alphabet.length; every leading zero byte
//                                              becomes one alphabet[0] (the Base58 convention: lengths stay reversible)
//   radixDecode(text, alphabet, { caseless }) -> Uint8Array   whitespace ignored; caseless: a single-case alphabet
//                                              also accepts the other case (Base36)
//   byteDigits(bytes, base, { sep = ' ', pad }) -> string      one group per byte (base 2 / 8 / 10 / 16; pad to the
//                                              full width 8 / 3 / 3 / 2, default: on except for base 10)
//   parseByteDigits(text, base) -> Uint8Array  groups split by any non-digit, or fixed-width runs without separators
//   RADIX: named alphabets
// The big-number form uses BigInt with divide and conquer: about 10 ms for 16 KiB, a second or two for 1 MiB.
//
// Why big-number at all: bases that are not powers of two (58, 62, 36, 10, 26) do not align with bit groups, so the
// only exact mapping is "the byte string is one integer". The naive algorithm (repeated division by the base,
// byte array as the dividend) is O(n^2) and takes minutes for 1 MiB; this module delegates the heavy arithmetic to
// BigInt and splits the number recursively so each step is a few large multiplications/divisions.
// Leading zero bytes carry no numeric value, so they are counted separately and encoded as leading alphabet[0]
// (Base58 rule) - without it "\0\0x" and "x" would encode identically.

// Alphabets as strings: digit value = index. Base58 variants are permutations of the same 58 characters (no 0 O I l),
// so they are NOT interchangeable - a Ripple address decoded with the Bitcoin alphabet yields different bytes.
export const RADIX = {
  base2: '01',
  base8: '01234567',
  base10: '0123456789',
  base16: '0123456789ABCDEF',
  base26: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  base36: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  base36lower: '0123456789abcdefghijklmnopqrstuvwxyz',
  base58: '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz',     // Bitcoin, IPFS
  flickr58: '123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ',   // Flickr short URLs
  ripple58: 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz',   // XRP Ledger addresses and seeds
  base62: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
};

// Decoder maps memoised per (alphabet, caseless): the key appends '\0i' for caseless because NUL cannot occur in an
// alphabet string, so the two keys cannot collide. caseless is only sound for single-case alphabets: applied to
// base58/base62 it would map 'a' and 'A' (different digits) to whichever was set last.
const LOOKUP = new Map();
function lookup(alphabet, caseless) {
  const key = alphabet + (caseless ? '\0i' : '');
  let m = LOOKUP.get(key);
  if (m) return m;
  m = new Map();
  for (let i = 0; i < alphabet.length; i++) {
    const c = alphabet[i];
    m.set(c, i);
    if (caseless) { m.set(c.toLowerCase(), i); m.set(c.toUpperCase(), i); }
  }
  LOOKUP.set(key, m);
  return m;
}

// Digits are handled in chunks of k digits that fit a double (base^k < 2^52), and the number is split or joined
// through powers base^(k·2^i) (divide and conquer), so the work follows BigInt multiplication rather than n².
const chunkDigits = (base) => Math.floor(52 / Math.log2(base));

// Bytes -> BigInt via a hex string: BigInt('0x...') is native and linear, unlike folding bytes with n * 256n + b
// (quadratic in BigInt allocations). pows is the ladder base^k, base^2k, base^4k, ... up to sqrt(n); split() then
// halves the number at each level, so the recursion depth is log2(digits / k) and the leaves are plain doubles.
export function radixEncode(bytes, alphabet) {
  const base = alphabet.length;
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const out = [alphabet[0].repeat(zeros)];
  if (zeros === bytes.length) return out[0];
  let hex = '';
  for (let i = zeros; i < bytes.length; i++) hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  const n = BigInt('0x' + hex);
  const k = chunkDigits(base);
  const pows = [BigInt(base) ** BigInt(k)]; // pows[i] = base^(k·2^i)
  while (pows[pows.length - 1] * pows[pows.length - 1] <= n) pows.push(pows[pows.length - 1] ** 2n);
  // One chunk (< base^k) as k digits, or without leading zeros for the most significant one.
  const emit = (x, pad) => {
    let v = Number(x), s = '';
    for (let j = 0; j < k && (pad || v > 0); j++) { s = alphabet[v % base] + s; v = Math.floor(v / base); }
    out.push(s);
  };
  // x < pows[i]², split into x / pows[i] and x % pows[i] (the low half always has its full width).
  const split = (x, i, pad) => {
    if (i < 0) { emit(x, pad); return; }
    if (!pad && x < pows[i]) { split(x, i - 1, false); return; }
    split(x / pows[i], i - 1, pad);
    split(x % pows[i], i - 1, true);
  };
  split(n, pows.length - 1, false);
  return out.join('');
}

// Mirror of radixEncode: leading alphabet[0] chars become zero bytes; the rest is cut into k-digit chunks parsed as
// doubles (exact, since base^k < 2^52), then neighbours are merged pairwise with the same power ladder, built
// bottom-up (p squares each round). Output goes BigInt -> hex -> bytes, again to stay linear.
// Invalid characters throw with a 1-based position in the whitespace-stripped string (not the original text).
export function radixDecode(text, alphabet, { caseless = false } = {}) {
  const map = lookup(alphabet, caseless);
  const base = alphabet.length;
  const s = String(text).replace(/\s+/g, '');
  let zeros = 0;
  while (zeros < s.length && s[zeros] === alphabet[0]) zeros++;
  const k = chunkDigits(base);
  // Chunks of k digits from the right, most significant first.
  let vals = [];
  for (let end = s.length; end > zeros; end -= k) {
    let v = 0;
    for (let i = Math.max(zeros, end - k); i < end; i++) {
      const d = map.get(s[i]);
      if (d === undefined) throw new Error(`invalid character "${s[i]}" at ${i + 1}`);
      v = v * base + d;
    }
    vals.push(BigInt(v));
  }
  vals.reverse();
  // Join neighbours from the right: hi · base^(k·2^i) + lo, until one number is left.
  for (let p = BigInt(base) ** BigInt(k); vals.length > 1; p *= p) {
    const next = [];
    let i = vals.length - 1;
    for (; i >= 1; i -= 2) next.push(vals[i - 1] * p + vals[i]);
    if (i === 0) next.push(vals[0]);
    vals = next.reverse();
  }
  let hex = vals.length && vals[0] > 0n ? vals[0].toString(16) : '';
  if (hex.length & 1) hex = '0' + hex;
  const out = new Uint8Array(zeros + hex.length / 2);
  for (let i = 0; i < hex.length / 2; i++) out[zeros + i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// Per-byte dumps: digits needed for 255 in each base. Decimal is unpadded by default because "007" reads as octal to
// many humans and languages; other bases pad so columns align in a dump.
const WIDTH = { 2: 8, 8: 3, 10: 3, 16: 2 };

export function byteDigits(bytes, base, { sep = ' ', pad = base !== 10, upper = true } = {}) {
  const w = WIDTH[base];
  if (!w) throw new Error('base must be 2, 8, 10 or 16');
  const parts = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    let d = bytes[i].toString(base);
    if (upper) d = d.toUpperCase();
    parts[i] = pad ? d.padStart(w, '0') : d;
  }
  return parts.join(sep);
}

// Two input shapes, chosen by structure: any separators -> groups; a single long run -> fixed-width slices (a run of
// exactly w or fewer digits is one group). The per-character digit test after splitting is redundant for the split
// regex but guards the fixed-width path; the 0..255 check catches "777" octal / "999" decimal.
export function parseByteDigits(text, base) {
  const w = WIDTH[base];
  if (!w) throw new Error('base must be 2, 8, 10 or 16');
  const s = String(text).trim();
  if (!s) return new Uint8Array(0);
  const digit = base === 16 ? /[0-9a-f]/i : new RegExp(`[0-${base - 1}]`);
  // Separated groups (any run of non-digits), or one run cut into fixed-width groups.
  let groups = s.split(base === 16 ? /[^0-9a-f]+/i : new RegExp(`[^0-${base - 1}]+`)).filter(Boolean);
  if (groups.length === 1 && groups[0].length > w) {
    const run = groups[0];
    if (run.length % w) throw new Error(`length is not a multiple of ${w} digits`);
    groups = run.match(new RegExp(`.{${w}}`, 'g'));
  }
  const out = new Uint8Array(groups.length);
  groups.forEach((g, i) => {
    if (![...g].every((c) => digit.test(c))) throw new Error(`invalid group "${g}"`);
    const v = parseInt(g, base);
    if (!(v >= 0 && v <= 255)) throw new Error(`"${g}" is not a byte`);
    out[i] = v;
  });
  return out;
}
