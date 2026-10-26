// sudoku/bits.js - candidate sets as bit masks: bit v (0-based) stands for the value v + 1. Up to 31 values fit an
// int32, so every grid size up to 31 x 31 works with plain integer operations.
//
// Why bit masks, not arrays or Sets: the solver's inner loop is "intersect, test empty, test single, count". On masks
// these are one AND, one compare, x & (x - 1), and popcount: branch-free, allocation-free, and the whole candidate
// grid is one Int32Array that can be copied with slice() per search node. A Set per cell would allocate on every
// search node and dominate run time.
//
// Bit 31 is deliberately unused in the narrow path: 1 << 31 is negative in JS int32 arithmetic, and code such as
// `m >= 0 && m < 2 ** n` (setValid) or minVal/maxVal on a negative mask would need special cases. The wide path
// (two words) accepts -1 / bit 31 explicitly instead.

export const fullMask = (n) => (n >= 31 ? 0x7fffffff : (1 << n) - 1);

// SWAR popcount (Hacker's Delight 5-1): pairwise, nibble and byte sums, then a multiply gathers the byte sums
// into the top byte. Math.imul gives the wrapping 32-bit product the trick needs; a plain * yields an exact double
// far above 2^32, whose top byte is not the sum. Initial >>> keeps the shift unsigned for masks with bit 31 set.
export function popcount(x) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24);
}

// Index of the lowest set bit (x != 0).
// x & -x isolates the lowest set bit (two's complement); clz32 turns it into an index without a loop.
export const lowBit = (x) => 31 - Math.clz32(x & -x);
export const isSingle = (x) => x !== 0 && (x & (x - 1)) === 0;

// [indices of the set bits], ascending.
export function bitsOf(x) {
  const out = [];
  while (x) { const b = x & -x; out.push(31 - Math.clz32(b)); x ^= b; }
  return out;
}

export const maskOf = (values) => values.reduce((m, v) => m | (1 << v), 0);

// Numeric extremes of a mask (values 1-based): min = lowest bit + 1, max = highest bit + 1.
export const minVal = (x) => lowBit(x) + 1;
// maxVal = index of the highest bit + 1 = 32 - clz32(x); undefined meaning for x = 0 (callers never pass an empty mask).
export const maxVal = (x) => 32 - Math.clz32(x);

// --- wide grids --------------------------------------------------------------------------------------------------
// Grids above WORD_N values (up to 64) keep their candidates in two int32 words per cell inside the solvers (wide.js).
// Outside the solvers (pencil marks, hint steps, the model's initial candidates) a value set is a "set": a plain
// int32 mask while every value fits the first word (all sets of grids up to 31 × 31, so nothing changes there), or
// [lo, hi] once a value above 32 is in it. The set* helpers accept both forms.

export const WORD_N = 31;
export const WIDE_MAX = 64;

// Normalizers: a number is [m, 0]; | 0 coerces to int32 so -1 (all 32 bits) and stored doubles compare equal.
const lo = (m) => (typeof m === 'number' ? m | 0 : m[0] | 0);
const hi = (m) => (typeof m === 'number' ? 0 : m[1] | 0);
// Canonical form: [lo, hi] only when hi is non-zero, so setEq / JSON round trips never see [x, 0] next to x.
export const setOf = (l, h) => (h ? [l | 0, h | 0] : l | 0);
export const setHas = (m, v) => (v < 32 ? (lo(m) >>> v) & 1 : (hi(m) >>> (v - 32)) & 1) === 1;
export const setWith = (m, v) => (v < 32 ? setOf(lo(m) | (1 << v), hi(m)) : setOf(lo(m), hi(m) | (1 << (v - 32))));
export const setWithout = (m, v) => (v < 32 ? setOf(lo(m) & ~(1 << v), hi(m)) : setOf(lo(m), hi(m) & ~(1 << (v - 32))));
export const setUnion = (a, b) => setOf(lo(a) | lo(b), hi(a) | hi(b));
export const setMinus = (a, b) => setOf(lo(a) & ~lo(b), hi(a) & ~hi(b));
export const setMeet = (a, b) => setOf(lo(a) & lo(b), hi(a) & hi(b));
export const setEq = (a, b) => lo(a) === lo(b) && hi(a) === hi(b);
export const setEmpty = (m) => !lo(m) && !hi(m);
export const setSize = (m) => popcount(lo(m)) + popcount(hi(m));
// [values (0-based)] of a set, ascending.
export const setBits = (m) => (hi(m) ? bitsOf(lo(m)).concat(bitsOf(hi(m)).map((b) => b + 32)) : bitsOf(lo(m)));
// n = 32 needs -1 (all bits): (1 << 32) - 1 is 0 in JS because shift counts are taken mod 32.
export const setFull = (n) => (n <= 32 ? setOf(n === 32 ? -1 : (1 << n) - 1, 0) : setOf(-1, n >= 64 ? -1 : (1 << (n - 32)) - 1));
// A valid set for n values (pencil marks from storage or the network).
// Strict validation of untrusted sets (storage, multiplayer moves): integer-only, no bits above n, and an array form
// only where it is canonical (n > 32, hi != 0). A permissive check would let a peer inject masks that render
// phantom pencil marks or break setEq-based undo diffs.
export const setValid = (m, n) => (typeof m === 'number' ? Number.isInteger(m) && (n >= 32 ? (m | 0) === m : m >= 0 && m < 2 ** n)
  : Array.isArray(m) && m.length === 2 && m.every((x) => Number.isInteger(x) && (x | 0) === x) && n > 32 && (n >= 64 || (m[1] >>> (n - 32)) === 0) && m[1] !== 0);
