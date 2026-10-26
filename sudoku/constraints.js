// sudoku/constraints.js - constraint propagators shared by the exact solver (solver.js) and the logical solver
// (logic.js). A constraint is
//   { kind, cells: Int32Array (scope), level, prop(cand, narrow) -> boolean }
// prop() reads the candidate masks of its scope and removes impossible candidates with narrow(cell, keepMask), which
// returns false on a contradiction (a cell without candidates); prop() returns false when the constraint cannot be
// satisfied. Every propagator must reject a fully assigned scope that breaks the rule (the solver relies on it).
// `level` is the difficulty of the deduction for a human (logic.js grades puzzles with it).
//
// Values are 0-based bit indices; their numbers are value + 1 (sums, differences and ratios use the numbers).

import { bitsOf, fullMask, isSingle, lowBit, maxVal, minVal, popcount } from './bits.js';

// Enumeration (generalized arc consistency) is exact but exponential; the product of domain sizes bounds its cost.
// Above the limit a constraint falls back to its cheap bounds reasoning and waits for smaller domains.
const ENUM_LIMIT = 6000; // largest candidate product a scope is enumerated for (generalized arc consistency)

// --- houses -------------------------------------------------------------------------------------------------

// n cells holding every value exactly once: a value with no place is a contradiction, a value with one place is set
// there (hidden single). Naked singles are removed from peers by the solver itself.
// once / twice accumulation finds, in one pass, values with no place (once != full -> contradiction) and values
// with exactly one place (uniq). A cell holding two unique values is a contradiction (one cell cannot take both).
export function houseCons(cells, n) {
  const full = fullMask(n);
  return {
    kind: 'house', cells, level: 1,
    prop(cand, narrow) {
      let once = 0, twice = 0;
      for (let i = 0; i < cells.length; i++) { const m = cand[cells[i]]; twice |= once & m; once |= m; }
      if (once !== full) return false;
      const uniq = once & ~twice;
      if (!uniq) return true;
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i], m = cand[c] & uniq;
        if (!m) continue;
        if (m & (m - 1)) return false; // two values that only fit here
        if (cand[c] !== m && !narrow(c, m)) return false;
      }
      return true;
    },
  };
}

// --- pairs --------------------------------------------------------------------------------------------------

// Relation tables are cached per (relation, n): thousands of pair constraints share a handful of tables.
const TABLES = new Map();
// fwd[a] = mask of b values allowed with a; rev[b] = mask of a values allowed with b. rel(x, y) on numbers 1..n.
export function pairTable(key, n, rel) {
  const k = key + '/' + n;
  let t = TABLES.get(k);
  if (!t) {
    const fwd = new Int32Array(n), rev = new Int32Array(n);
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (rel(a + 1, b + 1, n)) { fwd[a] |= 1 << b; rev[b] |= 1 << a; }
    t = { fwd, rev };
    TABLES.set(k, t);
  }
  return t;
}

// Binary relation between two cells (arc consistency both ways).
// Arc consistency both ways: keep a's values that have a supporting value in b, then b's against the NEW a.
// Using the narrowed a (A2) for the second pass makes one call reach the pair's fixpoint.
export function pairCons(kind, a, b, table, level = 1) {
  const { fwd, rev } = table;
  return {
    kind, cells: Int32Array.of(a, b), level,
    prop(cand, narrow) {
      const A = cand[a];
      const B = cand[b];
      let na = 0;
      for (let m = A; m; m &= m - 1) { const v = lowBit(m); if (fwd[v] & B) na |= 1 << v; }
      if (na !== A && !narrow(a, na)) return false;
      const A2 = cand[a];
      let nb = 0;
      for (let m = B; m; m &= m - 1) { const v = lowBit(m); if (rev[v] & A2) nb |= 1 << v; }
      if (nb !== B && !narrow(b, nb)) return false;
      return true;
    },
  };
}

// The relations used by the variants (numbers x, y in 1..n).
export const REL = {
  neq: (x, y) => x !== y,
  eq: (x, y) => x === y,
  less: (x, y) => x < y,
  consec: (x, y) => Math.abs(x - y) === 1,
  nonconsec: (x, y) => Math.abs(x - y) !== 1,
  double: (x, y) => x === 2 * y || y === 2 * x,
  kropkiNone: (x, y) => Math.abs(x - y) !== 1 && x !== 2 * y && y !== 2 * x,
  sum5: (x, y) => x + y === 5,
  sum10: (x, y) => x + y === 10,
  xvNone: (x, y) => x + y !== 5 && x + y !== 10,
  parity: (x, y) => (x + y) % 2 === 1,
  whisper: (x, y, n) => Math.abs(x - y) >= Math.ceil(n / 2),
  dutch: (x, y, n) => Math.abs(x - y) >= Math.floor(n / 2),
};
export const relCons = (kind, rel, a, b, n, level = 1) => pairCons(kind, a, b, pairTable(rel, n, REL[rel]), level);

// --- enumeration (generalized arc consistency on small scopes) -------------------------------------------------

// Enumerates the assignments of `cells` allowed by `check(vals, k)` (vals[0..k] assigned; k = cells.length - 1 is a
// full assignment) and keeps only supported candidates. Returns null when the scope is too large to enumerate now,
// false on a contradiction, true otherwise.
// Backtracking over the scope with an incremental check(vals, k) so dead prefixes are pruned early; support[i]
// collects the values that occur in at least one full valid assignment. Result: null = skipped (too large),
// false = no assignment exists, true = domains reduced to supported values.
export function enumerate(cells, cand, narrow, check, limit = ENUM_LIMIT) {
  const L = cells.length;
  let product = 1;
  for (let i = 0; i < L; i++) { product *= popcount(cand[cells[i]]); if (product > limit) return null; }
  const vals = new Int32Array(L);
  const support = new Int32Array(L);
  const doms = Array.from(cells, (c) => bitsOf(cand[c]));
  const rec = (k) => {
    const d = doms[k];
    for (let j = 0; j < d.length; j++) {
      vals[k] = d[j] + 1;
      if (!check(vals, k)) continue;
      if (k === L - 1) { for (let i = 0; i < L; i++) support[i] |= 1 << (vals[i] - 1); }
      else rec(k + 1);
    }
  };
  rec(0);
  for (let i = 0; i < L; i++) {
    if (!support[i]) return false;
    if (support[i] !== cand[cells[i]] && !narrow(cells[i], support[i])) return false;
  }
  return true;
}

// A constraint defined by a check on (partial) assignments; propagates when the scope is small enough to enumerate,
// otherwise it waits until it is (a full assignment always fits the limit).
export function enumCons(kind, cells, check, level = 2) {
  return {
    kind, cells: Int32Array.from(cells), level,
    prop(cand, narrow) {
      const r = enumerate(this.cells, cand, narrow, check);
      return r !== false;
    },
  };
}

// --- linear sums ----------------------------------------------------------------------------------------------

// Σ numbers(pos) − Σ numbers(neg) = k (repeats allowed unless the cells are peers): bounds propagation, and full
// enumeration once the scope is small. Cages with repeats, little killer diagonals, arrows (Σ path − circle = 0),
// frame sums, magic square lines.
// Weighted sum with signs (+1 for pos, -1 for neg). Two stages: interval (bounds) reasoning to a fixpoint, which is
// cheap and handles long cages / diagonals, then exact enumeration if the scope became small. The check closure uses
// sufMin / sufMax suffix bounds (declared below, filled in prop before enumerate runs) to cut prefixes that can no
// longer reach k.
export function linearCons(kind, pos, neg, k, level = 2) {
  const cells = Int32Array.from([...pos, ...neg]);
  const P = pos.length;
  const sign = Array.from(cells, (_, i) => (i < P ? 1 : -1));
  // suffix bounds for the enumeration check
  const check = (vals, at) => {
    let s = 0;
    for (let i = 0; i <= at; i++) s += sign[i] * vals[i];
    if (at === cells.length - 1) return s === k;
    return s + sufMin[at + 1] <= k && s + sufMax[at + 1] >= k;
  };
  const sufMin = new Float64Array(cells.length + 1), sufMax = new Float64Array(cells.length + 1);
  return {
    kind, cells, level,
    prop(cand, narrow) {
      // bounds of Σ sign * x; every cell keeps the numbers the others can complete to k (to a fixpoint)
      for (;;) {
        let lo = 0, hi = 0;
        for (let i = 0; i < cells.length; i++) {
          const m = cand[cells[i]];
          if (sign[i] > 0) { lo += minVal(m); hi += maxVal(m); } else { lo -= maxVal(m); hi -= minVal(m); }
        }
        if (lo > k || hi < k) return false;
        let changed = false;
        for (let i = 0; i < cells.length; i++) {
          const c = cells[i], m = cand[c];
          const mn = minVal(m), mx = maxVal(m);
          let a, b; // allowed numbers for this cell, from the others' range
          if (sign[i] > 0) { a = k - (hi - mx); b = k - (lo - mn); }
          else { a = (lo + mx) - k; b = (hi + mn) - k; }
          if (a <= mn && b >= mx) continue;
          const keep = rangeMask(a, b) & m;
          if (!keep || !narrow(c, keep)) return false;
          changed = true;
        }
        if (!changed) break;
      }
      sufMin[cells.length] = 0; sufMax[cells.length] = 0;
      for (let i = cells.length - 1; i >= 0; i--) {
        const m = cand[cells[i]];
        if (sign[i] > 0) { sufMin[i] = sufMin[i + 1] + minVal(m); sufMax[i] = sufMax[i + 1] + maxVal(m); }
        else { sufMin[i] = sufMin[i + 1] - maxVal(m); sufMax[i] = sufMax[i + 1] - minVal(m); }
      }
      return enumerate(cells, cand, narrow, check) !== false;
    },
  };
}

// Mask of the numbers a..b (clamped to 1..31).
// Clamped to 31 values: narrow masks only (wide models never build arithmetic constraints).
export function rangeMask(a, b) {
  a = Math.max(1, a); b = Math.min(31, b);
  if (a > b) return 0;
  const hi = b >= 31 ? 0x7fffffff : (1 << b) - 1;
  return hi & ~((1 << (a - 1)) - 1);
}

// --- value sets (killer cages, renban) -------------------------------------------------------------------------

// Distinct values forming exactly one of `combos` (masks): killer cages (k-subsets with the sum), renban lines (runs).
// Set-based constraint (cages with known value combinations, renban runs). Filters combos that are compatible
// with the fixed values and present candidates, restricts cells to the union of live combos, places values needed
// by every live combo that have one possible cell, then enumerates. liveCombos is shared with check() so the
// enumeration prunes against the already filtered list.
export function combosCons(kind, cells, combos, level = 2) {
  cells = Int32Array.from(cells);
  const set = new Set(combos);
  const L = cells.length;
  const check = (vals, k) => {
    let used = 0;
    for (let i = 0; i <= k; i++) { const b = 1 << (vals[i] - 1); if (used & b) return false; used |= b; }
    if (k === L - 1) return set.has(used);
    for (const c of liveCombos) if ((used & c) === used) return true;
    return false;
  };
  let liveCombos = combos;
  return {
    kind, cells, level, combos,
    prop(cand, narrow) {
      let any = 0, fixed = 0;
      for (let i = 0; i < L; i++) { const m = cand[cells[i]]; any |= m; if (isSingle(m)) { if (fixed & m) return false; fixed |= m; } }
      let union = 0, inter = -1;
      const live = [];
      for (const C of combos) {
        if ((fixed & ~C) || (any & C) !== C) continue;
        let ok = true;
        for (let i = 0; i < L; i++) if (!(cand[cells[i]] & C)) { ok = false; break; }
        if (!ok) continue;
        live.push(C);
        union |= C; inter &= C;
      }
      if (!union) return false;
      for (let i = 0; i < L; i++) {
        const c = cells[i];
        if ((cand[c] & union) !== cand[c] && !narrow(c, union)) return false;
      }
      // a value every combination needs, with a single place in the scope
      for (let m = inter; m; m &= m - 1) {
        const b = m & -m;
        let at = -1, cnt = 0;
        for (let i = 0; i < L; i++) if (cand[cells[i]] & b) { cnt++; at = cells[i]; }
        if (!cnt) return false;
        if (cnt === 1 && cand[at] !== b && !narrow(at, b)) return false;
      }
      liveCombos = live;
      return enumerate(cells, cand, narrow, check) !== false;
    },
  };
}

// k-subsets of 1..n with the sum s, as masks.
const COMBO_CACHE = new Map();
// k-subsets with sum s, generated in increasing order with an early break on the minimal completion; cached (killer cages repeat sums).
export function sumCombos(n, k, s) {
  const key = `${n}/${k}/${s}`;
  if (COMBO_CACHE.has(key)) return COMBO_CACHE.get(key);
  const out = [];
  const rec = (start, left, sum, mask) => {
    if (left === 0) { if (sum === s) out.push(mask); return; }
    for (let v = start; v <= n; v++) {
      if (sum + v * left + (left * (left - 1)) / 2 > s) break; // smallest completion too big
      rec(v + 1, left - 1, sum + v, mask | (1 << (v - 1)));
    }
  };
  rec(1, k, 0, 0);
  COMBO_CACHE.set(key, out);
  return out;
}

// Runs of k consecutive numbers in 1..n, as masks.
export function runCombos(n, k) {
  const out = [];
  for (let s = 1; s + k - 1 <= n; s++) out.push(rangeMask(s, s + k - 1));
  return out;
}

// --- outside clues --------------------------------------------------------------------------------------------

// Sandwich: the numbers between the 1 and the n of the line (a row or column, in order) sum to s.
// Sandwich: tries every (1, n) position pair; a pair is feasible if the cells between can reach s both by their
// candidate bounds and by the distinct-values bounds (min = 2+3+..., max = (n-1)+(n-2)+...). Positions are
// bitsets over line indices (L <= 31). Once both crusts are fixed, the inner cells get plain sum bounds.
export function sandwichCons(cells, s, n) {
  cells = Int32Array.from(cells);
  const L = cells.length, ONE = 1, TOP = 1 << (n - 1);
  return {
    kind: 'sandwich', cells, level: 2,
    prop(cand, narrow) {
      let okOne = 0, okTop = 0; // positions (bit per index) that can hold the crusts
      for (let i = 0; i < L; i++) {
        if (!(cand[cells[i]] & ONE)) continue;
        for (let j = 0; j < L; j++) {
          if (j === i || !(cand[cells[j]] & TOP)) continue;
          const a = Math.min(i, j), b = Math.max(i, j);
          let lo = 0, hi = 0, bad = false;
          for (let x = a + 1; x < b; x++) {
            const m = cand[cells[x]] & ~(ONE | TOP);
            if (!m) { bad = true; break; }
            lo += minVal(m); hi += maxVal(m);
          }
          const len = b - a - 1;
          // distinct numbers 2..n-1
          const dLo = len * (len + 3) / 2, dHi = len * (2 * n - 1 - len) / 2;
          if (bad || lo > s || hi < s || dLo > s || dHi < s) continue;
          okOne |= 1 << i; okTop |= 1 << j;
        }
      }
      if (!okOne || !okTop) return false;
      let one = -1, top = -1;
      for (let i = 0; i < L; i++) {
        const c = cells[i];
        let keep = cand[c];
        if (!(okOne >> i & 1)) keep &= ~ONE;
        if (!(okTop >> i & 1)) keep &= ~TOP;
        if (keep !== cand[c] && !narrow(c, keep)) return false;
        if (cand[c] === ONE) one = i;
        if (cand[c] === TOP) top = i;
      }
      if (one >= 0 && top >= 0) {
        const a = Math.min(one, top), b = Math.max(one, top);
        const inner = [];
        for (let x = a + 1; x < b; x++) inner.push(cells[x]);
        if (!inner.length) return s === 0;
        return sumBounds(inner, s, cand, narrow);
      }
      return true;
    },
  };
}

// Σ numbers(cells) = s by bounds (repeats allowed), iterated to a fixpoint.
function sumBounds(cells, s, cand, narrow) {
  for (;;) {
    let lo = 0, hi = 0;
    for (const c of cells) { lo += minVal(cand[c]); hi += maxVal(cand[c]); }
    if (lo > s || hi < s) return false;
    let changed = false;
    for (const c of cells) {
      const m = cand[c], mn = minVal(m), mx = maxVal(m);
      const a = s - (hi - mx), b = s - (lo - mn);
      if (a <= mn && b >= mx) continue;
      const keep = rangeMask(a, b) & m;
      if (!keep || !narrow(c, keep)) return false;
      changed = true;
    }
    if (!changed) return true;
  }
}

// Skyscraper: seen from the clue, taller numbers hide shorter ones; exactly `count` are visible along the line
// (cells ordered from the clue). Distinct values along the line (it is a house).
// Skyscraper: classic cap rule (the d-th cell from the clue is at most n - count + 1 + d), the count 1 / count n
// special cases, a visibility check on the fixed prefix, then enumeration with a tighter limit (3000) because the
// check is more expensive than for sums.
export function skyscraperCons(cells, count, n) {
  cells = Int32Array.from(cells);
  const L = cells.length;
  const caps = Array.from({ length: L }, (_, d) => rangeMask(1, Math.min(n, n - count + 1 + d)));
  const visible = (vals, k) => {
    let mx = 0, v = 0;
    for (let i = 0; i <= k; i++) if (vals[i] > mx) { mx = vals[i]; v++; }
    return [v, mx];
  };
  const check = (vals, k) => {
    for (let i = 0; i < k; i++) if (vals[i] === vals[k]) return false;
    const [v, mx] = visible(vals, k);
    if (k === L - 1) return v === count;
    if (v > count) return false;
    return v + Math.min(L - 1 - k, n - mx) >= count;
  };
  return {
    kind: 'skyscraper', cells, level: 2,
    prop(cand, narrow) {
      for (let d = 0; d < L; d++) {
        const c = cells[d];
        let keep = cand[c] & caps[d];
        if (count === 1 && d === 0) keep &= 1 << (n - 1);
        if (count === n) keep &= 1 << d;
        if (keep !== cand[c] && !narrow(c, keep)) return false;
      }
      // fixed prefix: visible so far, and what is still possible
      let mx = 0, v = 0, d = 0;
      for (; d < L && isSingle(cand[cells[d]]); d++) { const x = lowBit(cand[cells[d]]) + 1; if (x > mx) { mx = x; v++; } }
      if (v > count) return false;
      if (d === L || mx === n) { if (v !== count) return false; }
      else if (v + Math.min(L - d, n - mx) < count) return false;
      return enumerate(cells, cand, narrow, check, 3000) !== false;
    },
  };
}

// X-sums: the first number x of the line (from the clue) says how many cells to add; their sum is s.
// X-sum: filter the first cell to values x whose x-cell prefix can still reach s, then, once x is fixed, sum bounds on cells 1..x-1.
export function xsumCons(cells, s, n) {
  cells = Int32Array.from(cells);
  return {
    kind: 'xsum', cells, level: 2,
    prop(cand, narrow) {
      const first = cells[0];
      let keep = 0;
      for (let m = cand[first]; m; m &= m - 1) {
        const x = lowBit(m) + 1;
        if (x > cells.length) continue;
        let lo = x, hi = x;
        for (let i = 1; i < x; i++) { const cm = cand[cells[i]] & ~(1 << (x - 1)); if (!cm) { lo = Infinity; break; } lo += minVal(cm); hi += maxVal(cm); }
        if (lo <= s && hi >= s) keep |= 1 << (x - 1);
      }
      if (!keep) return false;
      if (keep !== cand[first] && !narrow(first, keep)) return false;
      if (isSingle(cand[first])) {
        const x = lowBit(cand[first]) + 1;
        if (x === 1) return s === 1;
        return sumBounds(Array.from(cells.subarray(1, x)), s - x, cand, narrow);
      }
      return true;
    },
  };
}

// --- lines with endpoints ---------------------------------------------------------------------------------------

// Between line: the numbers on the line lie strictly between the numbers of its two ends (the circles).
// Given the ends, the inner cells are independent, so enumerating the end pairs gives exact supports.
export function betweenCons(a, b, inner) {
  const cells = Int32Array.from([a, b, ...inner]);
  return {
    kind: 'between', cells, level: 2,
    prop(cand, narrow) {
      let sa = 0, sb = 0;
      const si = new Int32Array(inner.length);
      for (let ma = cand[a]; ma; ma &= ma - 1) {
        const x = lowBit(ma) + 1;
        for (let mb = cand[b]; mb; mb &= mb - 1) {
          const y = lowBit(mb) + 1;
          if (x === y) continue;
          const mid = rangeMask(Math.min(x, y) + 1, Math.max(x, y) - 1);
          let ok = true;
          for (let i = 0; i < inner.length; i++) if (!(cand[inner[i]] & mid)) { ok = false; break; }
          if (!ok) continue;
          sa |= 1 << (x - 1); sb |= 1 << (y - 1);
          for (let i = 0; i < inner.length; i++) si[i] |= cand[inner[i]] & mid;
        }
      }
      if (!sa) return false;
      if (sa !== cand[a] && !narrow(a, sa)) return false;
      if (sb !== cand[b] && !narrow(b, sb)) return false;
      for (let i = 0; i < inner.length; i++) if (si[i] !== cand[inner[i]] && !narrow(inner[i], si[i])) return false;
      return true;
    },
  };
}

// Zipper line: cells at the same distance from the middle of the line sum to the same total — the middle cell's
// number on odd lines, a common unknown total on even lines.
// Zipper: try every possible total (the middle cell's values on odd lines, 2..62 on even lines) and keep supports
// from totals for which every mirrored pair has a matching pair of values.
export function zipperCons(line) {
  const L = line.length;
  const mid = L % 2 ? line[(L - 1) / 2] : -1;
  const pairs = [];
  for (let i = 0; i < Math.floor(L / 2); i++) pairs.push([line[i], line[L - 1 - i]]);
  return {
    kind: 'zipper', cells: Int32Array.from(line), level: 2,
    prop(cand, narrow) {
      const sup = pairs.map(() => [0, 0]);
      let smid = 0;
      const totals = mid >= 0 ? bitsOf(cand[mid]).map((v) => v + 1) : Array.from({ length: 61 }, (_, i) => i + 2);
      for (const t of totals) {
        const part = [];
        let ok = true;
        for (const [p, q] of pairs) {
          let sp = 0, sq = 0;
          for (let m = cand[p]; m; m &= m - 1) {
            const x = lowBit(m) + 1, y = t - x;
            if (y >= 1 && y <= 31 && cand[q] & (1 << (y - 1))) { sp |= 1 << (x - 1); sq |= 1 << (y - 1); }
          }
          if (!sp) { ok = false; break; }
          part.push([sp, sq]);
        }
        if (!ok) continue;
        if (mid >= 0) smid |= 1 << (t - 1);
        part.forEach(([sp, sq], i) => { sup[i][0] |= sp; sup[i][1] |= sq; });
      }
      if (mid >= 0) { if (!smid) return false; if (smid !== cand[mid] && !narrow(mid, smid)) return false; }
      for (let i = 0; i < pairs.length; i++) {
        const [p, q] = pairs[i];
        if (!sup[i][0]) return false;
        if (sup[i][0] !== cand[p] && !narrow(p, sup[i][0])) return false;
        if (sup[i][1] !== cand[q] && !narrow(q, sup[i][1])) return false;
      }
      return true;
    },
  };
}

// Quadruple: the listed numbers (a multiset) all appear in the 2 × 2 cells around the circle.
// Quadruple: counting rules (each required digit needs enough places) plus enumeration with a multiset check.
export function quadCons(cells, digits) {
  cells = Int32Array.from(cells);
  const need = new Map();
  for (const d of digits) need.set(d, (need.get(d) || 0) + 1);
  const check = (vals, k) => {
    if (k < cells.length - 1) {
      // enough free cells left for the digits still missing
      let missing = 0;
      for (const [d, cnt] of need) { let have = 0; for (let i = 0; i <= k; i++) if (vals[i] === d) have++; missing += Math.max(0, cnt - have); }
      return missing <= cells.length - 1 - k;
    }
    for (const [d, cnt] of need) { let have = 0; for (let i = 0; i <= k; i++) if (vals[i] === d) have++; if (have < cnt) return false; }
    return true;
  };
  return {
    kind: 'quad', cells, level: 2,
    prop(cand, narrow) {
      for (const [d, cnt] of need) {
        const b = 1 << (d - 1);
        let places = 0, at = -1;
        for (const c of cells) if (cand[c] & b) { places++; at = c; }
        if (places < cnt) return false;
        if (places === 1 && cand[at] !== b && !narrow(at, b)) return false;
      }
      if (digits.length === cells.length) {
        const m = digits.reduce((a, d) => a | (1 << (d - 1)), 0);
        for (const c of cells) if ((cand[c] & m) !== cand[c] && !narrow(c, m)) return false;
      }
      return enumerate(cells, cand, narrow, check, 7000) !== false;
    },
  };
}
