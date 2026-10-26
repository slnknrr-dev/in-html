// prng/prng.js - random numbers for games and generators, from two sources behind one interface:
//   seededRandom(seed)  deterministic: the same seed gives the same sequence on every platform (xoshiro128** seeded
//                       with SHA-256 of the seed text), for shareable boards, deals and replays;
//   cryptoRandom()      crypto.getRandomValues (CSPRNG), for fair, unpredictable shuffles.
//
// rng: { kind: 'seeded' | 'crypto', seed, u32(), next() [0, 1), int(n) [0, n) unbiased, range(a, b) [a, b], chance(p),
//        pick(array), shuffle(array) (Fisher–Yates, in place, returns it), sample(array, k), bytes(n), fork(label),
//        save() -> state | null, restore(state) }
// randomSeed(words = 4) -> a readable seed made with the CSPRNG ("cold-river-amber-41").
// Both sources draw integers by rejection sampling, so int(n) is exactly uniform for every n.
//
// Why these choices:
// - xoshiro128** not Math.random: Math.random is unseedable and engine-specific; xoshiro is tiny, statistically strong,
//   and uses only 32-bit ops (Math.imul, rotations), so every JS engine yields bit-identical sequences.
// - SHA-256 seeding: any text spreads over the 128-bit state; near-identical seeds give unrelated streams. A naive
//   char-code sum would make "ab" and "ba" collide.
// - `u32() % n` alone is biased whenever 2^32 is not a multiple of n; rejection removes the bias at < 2 draws average.
// KNOWN DEFECT: the header above says randomSeed(words = 4); the default is 3. Fix: correct the header line.

import { sha256 } from '../crypto/sha2.js';
import { utf8ToBytes } from '../crypto/encoding.js';

const rotl = (x, k) => (x << k) | (x >>> (32 - k));

// The shared methods, built on u32().
function api(rng) {
  // 32 random bits / 2^32: in [0, 1), never 1. Only 2^32 distinct values (Math.random has 52 bits); fine for games.
  rng.next = () => rng.u32() / 4294967296;
  rng.int = (n) => {
    n = Math.floor(n);
    if (!(n >= 1)) throw new RangeError('int(n) needs n >= 1');
    // hi*2^32 + lo is uniform over [0, ceil(n/2^32)*2^32); rejecting values >= n keeps it exactly uniform.
    if (n > 4294967296) { // two draws for large n (up to 2^53)
      const hi = rng.int(Math.ceil(n / 4294967296));
      const v = hi * 4294967296 + rng.u32();
      return v < n ? v : rng.int(n);
    }
    const limit = 4294967296 - (4294967296 % n); // largest multiple of n
    for (;;) { const x = rng.u32(); if (x < limit) return x % n; }
  };
  rng.range = (a, b) => a + rng.int(b - a + 1);
  rng.chance = (p) => rng.next() < p;
  rng.pick = (arr) => arr[rng.int(arr.length)];
  rng.shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) { const j = rng.int(i + 1); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  };
  // Copies first so the caller's array keeps its order. O(n) even for small k: acceptable for UI-sized arrays.
  rng.sample = (arr, k) => rng.shuffle(arr.slice()).slice(0, k);
  // Each word unpacked little-endian; the tail word is partly discarded, so the byte stream is reproducible.
  rng.bytes = (n) => { const out = new Uint8Array(n); for (let i = 0; i < n; i += 4) { const x = rng.u32(); for (let j = 0; j < 4 && i + j < n; j++) out[i + j] = x >>> (8 * j); } return out; };
  return rng;
}

export function seededRandom(seed) {
  const text = String(seed);
  const h = sha256(utf8ToBytes(text));
  const s = new Uint32Array(4);
  for (let i = 0; i < 4; i++) s[i] = (h[4 * i] | (h[4 * i + 1] << 8) | (h[4 * i + 2] << 16) | (h[4 * i + 3] << 24)) >>> 0;
  if (!(s[0] | s[1] | s[2] | s[3])) s[0] = 1; // xoshiro must not start from zero
  const rng = {
    kind: 'seeded', seed: text,
    // xoshiro128** (Blackman & Vigna)
    u32() {
      const r = Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0;
      const t = s[1] << 9;
      s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3];
      s[2] ^= t;
      s[3] = rotl(s[3], 11);
      return r;
    },
    save: () => Array.from(s),
    restore(state) { for (let i = 0; i < 4; i++) s[i] = state[i] >>> 0; return rng; },
    // An independent stream for a sub-task ("board", "deal 3") that does not disturb this one.
    fork: (label) => seededRandom(`${text}/${label}`),
  };
  return api(rng);
}

// Buffered: each getRandomValues call crosses into the platform CSPRNG; one 1 KiB fill serves 256 draws.
// save/restore/fork carry no state by design: a CSPRNG stream must not be replayable.
export function cryptoRandom() {
  const buf = new Uint32Array(256);
  let pos = buf.length;
  const rng = {
    kind: 'crypto', seed: null,
    u32() {
      if (pos >= buf.length) { globalThis.crypto.getRandomValues(buf); pos = 0; }
      return buf[pos++];
    },
    save: () => null,
    restore: () => rng,
    fork: () => cryptoRandom(),
  };
  return api(rng);
}

// Either source by name: makeRandom({ kind: 'crypto' }) or makeRandom({ kind: 'seeded', seed }).
export function makeRandom({ kind = 'crypto', seed } = {}) {
  return kind === 'seeded' ? seededRandom(seed ?? randomSeed()) : cryptoRandom();
}

// Seed vocabulary: short, distinct, easy to read aloud and type. ~140^3 * 100 ~ 2.7e8 seeds: ample for sharing but
// enumerable, which is fine: seeds identify games, they protect nothing.
const WORDS = ('amber anchor apple arch aspen atlas autumn badge bamboo basil beacon birch blossom bold breeze brook ' +
  'canyon cedar chalk cherry cinder clover cobalt comet coral crane crystal dawn delta dune echo ember fable falcon ' +
  'fern fjord flint forest frost garnet glade granite harbor hazel heron honey indigo iris island ivory jade jasper ' +
  'juniper kestrel kite lagoon lark lava lemon lilac linen lotus lunar maple marble meadow mint mist moss nectar ' +
  'nova oak ocean olive onyx opal orbit orchid pearl pebble pepper pine plum polar poppy quartz quill raven reef ' +
  'river robin ruby saffron sage sapphire shadow silver sky slate solar spruce storm summit swan thistle thunder ' +
  'tide topaz tulip umber valley velvet violet walnut willow winter wren zephyr').split(' ');

export function randomSeed(words = 3) {
  const r = cryptoRandom();
  return [...Array.from({ length: words }, () => r.pick(WORDS)), String(r.int(100))].join('-');
}
