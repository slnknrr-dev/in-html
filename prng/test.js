// prng/test.js - unit tests of the random sources: `node prng/test.js` (importing the module runs nothing).
// Determinism of seeds, the xoshiro128** reference sequence, uniformity of int(n) (chi-squared), shuffles, forks and
// save / restore.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cryptoRandom, makeRandom, randomSeed, seededRandom } from './prng.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const ok = (name, cond, info) => eq(name, cond ? true : info ?? false, true);

  // xoshiro128** reference: state (1, 2, 3, 4) gives 11520, 0, 5927040, 70819200 (the authors' C code).
  const ref = seededRandom('x').restore([1, 2, 3, 4]);
  eq('xoshiro128** reference', [ref.u32(), ref.u32(), ref.u32(), ref.u32()], [11520, 0, 5927040, 70819200]);

  const a = seededRandom('board-42'), b = seededRandom('board-42'), c = seededRandom('board-43');
  const seqA = Array.from({ length: 50 }, () => a.u32()), seqB = Array.from({ length: 50 }, () => b.u32()), seqC = Array.from({ length: 50 }, () => c.u32());
  eq('same seed, same sequence', seqA, seqB);
  ok('different seed, different sequence', JSON.stringify(seqA) !== JSON.stringify(seqC));
  // Golden values: the sequence must never change between versions (shared seeds and saved games depend on it).
  const golden = seededRandom('golden');
  eq('golden sequence', [golden.int(100), golden.int(100), golden.int(100), golden.int(6), golden.int(6)], GOLDEN);

  for (const [name, rng] of [['seeded', seededRandom('chi')], ['crypto', cryptoRandom()]]) {
    for (const n of [2, 3, 7, 10, 52, 1000]) {
      const counts = new Array(n).fill(0), N = n * 2000;
      for (let i = 0; i < N; i++) counts[rng.int(n)]++;
      const e = N / n;
      const chi = counts.reduce((s, x) => s + ((x - e) ** 2) / e, 0);
      // Mean n−1, sd √(2(n−1)): six standard deviations is a generous bound.
      ok(`${name} int(${n}) uniform`, chi < (n - 1) + 6 * Math.sqrt(2 * (n - 1)), chi);
    }
    const big = rng.int(2 ** 40);
    ok(`${name} int(2^40) in range`, Number.isInteger(big) && big >= 0 && big < 2 ** 40, big);
    const deck = Array.from({ length: 36 }, (_, i) => i);
    rng.shuffle(deck);
    eq(`${name} shuffle is a permutation`, [...deck].sort((x, y) => x - y), Array.from({ length: 36 }, (_, i) => i));
    let inRange = true;
    for (let i = 0; i < 1000; i++) { const v = rng.range(-3, 3); if (v < -3 || v > 3) inRange = false; }
    ok(`${name} range`, inRange);
  }
  // Shuffle uniformity: every position of a 4-element shuffle is equally likely.
  const sr = seededRandom('perm'), pos = Array.from({ length: 4 }, () => new Array(4).fill(0));
  for (let i = 0; i < 40000; i++) { const p = sr.shuffle([0, 1, 2, 3]); p.forEach((v, j) => pos[v][j]++); }
  ok('shuffle uniform', pos.flat().every((x) => Math.abs(x - 10000) < 500), pos);

  const s = seededRandom('save');
  s.u32(); s.u32();
  const saved = s.save();
  const next = [s.u32(), s.u32()];
  s.restore(saved);
  eq('save / restore', [s.u32(), s.u32()], next);
  eq('fork is deterministic', seededRandom('f').fork('deal 1').u32(), seededRandom('f').fork('deal 1').u32());
  ok('fork differs from parent', seededRandom('f').fork('deal 1').u32() !== seededRandom('f').u32());
  ok('random seed text', /^[a-z]+-[a-z]+-[a-z]+-\d{1,2}$/.test(randomSeed()), randomSeed());
  eq('makeRandom seeded', makeRandom({ kind: 'seeded', seed: 'q' }).u32(), seededRandom('q').u32());
  eq('makeRandom crypto', makeRandom().kind, 'crypto');

  console.log(`prng: ${pass} passed, ${fail} failed`);
  return fail;
}

const GOLDEN = [42, 1, 5, 3, 5];

if (isMain) process.exitCode = (await run()) ? 1 : 0;
