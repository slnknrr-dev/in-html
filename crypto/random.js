// crypto/random.js - cryptographically secure randomness from the platform (crypto.getRandomValues: browsers, Node,
// Bun, Deno): random bytes, unbiased integers, choices, shuffles and UUIDs.
//
// RNG source: the OS CSPRNG behind crypto.getRandomValues (getrandom(2) / BCryptGenRandom / arc4random through the
// engine). No userland PRNG, no Math.random fallback: a missing source throws instead of silently degrading, because
// every caller (passwords, nonces, salts, keys) is security-relevant and a weak fallback would be invisible.
// Uniformity: every integer helper rejects instead of reducing modulo, so no value is favoured.

// Looked up per call, not cached at import: tests and polyfills may install globalThis.crypto later, and a module
// that captured `undefined` at load would stay broken.
function source() {
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== 'function') throw new Error('no secure random source (crypto.getRandomValues)');
  return c;
}

// getRandomValues fills at most 65536 bytes per call (the spec throws QuotaExceededError beyond), so larger requests
// are served in 64 KiB subarray views of one buffer: no copies, one allocation.
export function randomBytes(n) {
  const out = new Uint8Array(n), c = source();
  for (let o = 0; o < n; o += 65536) c.getRandomValues(out.subarray(o, Math.min(n, o + 65536)));
  return out;
}

// Uniform integer in [0, max) by rejection sampling (no modulo bias); max <= 2^32.
// limit is the largest multiple of max not above 2^32; draws >= limit are discarded, so every residue has exactly
// limit / max preimages. Expected draws < 2 for any max (worst case max = 2^31 + 1, rejection rate just under 1/2).
// `x % max` alone would favour small residues by up to 1 / floor(2^32 / max): measurable for large max.
export function randomInt(max) {
  if (!(max >= 1 && max <= 0x100000000)) throw new Error('randomInt: max must be 1..2^32');
  if (max === 1) return 0;
  // For max = 2^32: 2^32 % max = 0, limit = 2^32, nothing is rejected (a Uint32 is always < 2^32).
  const limit = 0x100000000 - (0x100000000 % max), buf = new Uint32Array(1), c = source();
  for (;;) {
    c.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

export const randomChoice = (list) => list[randomInt(list.length)];

// Fisher-Yates (Durstenfeld) shuffle in place: j uniform in [0, i], so each of the n! orders has probability 1/n!.
// The common "j in [0, n)" variant is biased (n^n paths onto n! orders, not divisible), and sort(() => random - 0.5)
// is worse still and engine-dependent.
export function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) { const j = randomInt(i + 1); const t = list[i]; list[i] = list[j]; list[j] = t; }
  return list;
}

// RFC 9562 version 4 UUID: 122 random bits. Byte 6 high nibble = 0100 (version 4), byte 8 top bits = 10 (the
// RFC 4122 / 9562 variant); everything else stays random. Hand-built rather than crypto.randomUUID, which exists only
// in secure contexts (absent on http:// and some file:// pages).
export function randomUUID() {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
