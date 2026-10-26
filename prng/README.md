# prng/

Random numbers for games and generators from two sources behind one interface: `seededRandom(seed)` (deterministic
xoshiro128** seeded with SHA-256 of the seed text — the same seed gives the same boards, deals and replays on every
platform) and `cryptoRandom()` (`crypto.getRandomValues`, a CSPRNG for fair, unpredictable shuffles).

| file | contents |
| --- | --- |
| `prng.js` | `seededRandom(seed)`, `cryptoRandom()`, `makeRandom({ kind, seed })`, `randomSeed(words)` |
| `test.js` | unit tests: `node prng/test.js` (reference sequence, golden values, chi-squared uniformity, shuffles, save / restore) |

An rng has `kind`, `seed`, `u32()`, `next()` (0 ≤ x < 1), `int(n)` (exactly uniform by rejection sampling, n up to
2^53), `range(a, b)`, `chance(p)`, `pick(array)`, `shuffle(array)` (Fisher–Yates in place), `sample(array, k)`,
`bytes(n)`, `fork(label)` (an independent deterministic stream: "board", "deal 3"), `save()` / `restore(state)` (seeded
only). The seeded sequence is frozen by golden values in the tests: saved games and shared seeds depend on it.
