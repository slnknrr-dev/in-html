// mines/solver.js - a logical Minesweeper solver for any topology (mines/topology.js).
//
// The solver knows which cells are safe (K = 0) or mines (K = 1); every other cell is unknown (K = -1). Open cells
// with a known number are constraints: "num[c] of my neighbours are mines". Deductions:
//   'single'  one constraint: no mines left → its unknown neighbours are safe; as many mines left as unknown
//             neighbours → they are all mines
//   'pair'    two constraints that share unknown cells (subset and overlap reasoning)
//   'count'   the total number of mines: none left → every unknown cell is safe; as many as unknown cells → mines
// Every deduction is certain, so a board that the solver clears from its first opening needs no guessing.
//
// new Solver(topo, num, { mines, open })
//   num     numbers of the cells (Uint8Array; read only for constraint cells)
//   mines   total number of mines (enables the 'count' rule), -1 when unknown
//   open    true while generating: a cell found safe is opened and its number becomes a new constraint;
//           false when analysing a player's view (the numbers of hidden safe cells are unknown)
//   log     true: record deductions [{ cell, mine, rule, by: [constraint cells] }] in solver.log
// solver.openCell(i)  opens a cell (a known safe constraint); solver.run() deduces until stuck;
// solver.solved()     all safe cells known; solver.touched(cells) after numbers of cells next to `cells` changed.
//
// probabilities(solver) - after run(): the chance that each unknown cell is a mine, exact by enumerating the
// arrangements of every frontier component (weighted by the arrangements of the remaining cells), with certain
// cells found on the way. analyzeView() wraps both for hints.

// Performance design (the generator reruns the solver many times per board):
// - incremental counters per cell (unk, mc, cn) instead of rescanning neighbourhoods on every rule check;
// - a work queue of constraints whose counters changed (only those can yield a new 'single' deduction);
// - a sparse set of active constraints (act / actPos: O(1) add, remove, iterate) for the pair pass;
// - change stamps (chg vs passStart) so a pair already found barren is not re-examined until one side changes;
// - generation stamps (stamp / seen) instead of clearing marker arrays: marking is O(1) and "clear" is ++counter.
// Rule order is cheapest first (single -> pair -> count); the expensive pass only runs when the cheap one is stuck.
export class Solver {
  constructor(topo, num, { mines = -1, open = false, log = false } = {}) {
    const n = topo.n;
    this.t = topo;
    this.num = num;
    this.mines = mines;
    this.canOpen = open;
    this.log = log ? [] : null;
    this.K = new Int8Array(n).fill(-1);
    this.isC = new Uint8Array(n); // constraint: an open cell whose number is known
    this.unk = new Uint8Array(n); // unknown neighbours
    this.mc = new Uint8Array(n); // known mine neighbours
    this.cn = new Uint8Array(n); // constraint neighbours (0 = an "interior" cell, no information touches it)
    this.q = new Int32Array(n);
    this.qn = 0;
    this.inQ = new Uint8Array(n);
    this.act = new Int32Array(n); // active constraints (unknown neighbours left): a sparse set
    this.actPos = new Int32Array(n).fill(-1);
    this.actN = 0;
    this.chg = new Float64Array(n); // change stamps of constraints (pairs are rechecked only after a change)
    this.clock = 1;
    this.passStart = 0;
    this.knownMines = 0;
    this.knownSafe = 0;
    this.nb = new Int32Array(topo.maxN);
    this.nb2 = new Int32Array(topo.maxN);
    this.nb3 = new Int32Array(topo.maxN);
    this.stamp = new Int32Array(n);
    this.stampN = 0;
    this.seen = new Int32Array(n);
    this.seenN = 0;
    for (let i = 0; i < n; i++) this.unk[i] = topo.neighbors(i, this.nb);
  }

  unknownLeft() { return this.t.n - this.knownMines - this.knownSafe; }
  solved() { return this.mines >= 0 ? this.knownSafe === this.t.n - this.mines : this.unknownLeft() === 0; }

  enqueue(c) { if (!this.inQ[c]) { this.inQ[c] = 1; this.q[this.qn++] = c; } }
  addActive(c) { if (this.actPos[c] < 0) { this.actPos[c] = this.actN; this.act[this.actN++] = c; } }
  dropActive(c) {
    const p = this.actPos[c];
    if (p < 0) return;
    const last = this.act[--this.actN];
    this.act[p] = last;
    this.actPos[last] = p;
    this.actPos[c] = -1;
  }

  // A cell became known: its neighbours lose an unknown neighbour (and gain a known mine).
  known(i, isMine) {
    const nb = this.nb3, k = this.t.neighbors(i, nb);
    for (let j = 0; j < k; j++) {
      const c = nb[j];
      this.unk[c]--;
      if (isMine) this.mc[c]++;
      if (this.isC[c]) {
        this.chg[c] = this.clock++;
        if (this.unk[c] === 0) this.dropActive(c);
        this.enqueue(c);
      }
    }
  }

  setSafe(i, rule, by) {
    if (this.K[i] !== -1) return false;
    this.K[i] = 0;
    this.knownSafe++;
    if (this.log) this.log.push({ cell: i, mine: false, rule, by });
    this.known(i, false);
    if (this.canOpen) this.makeConstraint(i);
    return true;
  }

  setMine(i, rule, by) {
    if (this.K[i] !== -1) return false;
    this.K[i] = 1;
    this.knownMines++;
    if (this.log) this.log.push({ cell: i, mine: true, rule, by });
    this.known(i, true);
    return true;
  }

  makeConstraint(i) {
    if (this.isC[i]) return;
    this.isC[i] = 1;
    this.chg[i] = this.clock++;
    const nb = this.nb3, k = this.t.neighbors(i, nb);
    for (let j = 0; j < k; j++) this.cn[nb[j]]++;
    if (this.unk[i] > 0) this.addActive(i);
    this.enqueue(i);
  }

  // Opens a cell known to be safe (the first click, or an open cell of a player's view).
  openCell(i) {
    if (this.K[i] === -1) { this.K[i] = 0; this.knownSafe++; this.known(i, false); }
    this.makeConstraint(i);
  }

  // The numbers next to these cells changed (board generation moved mines): recheck the constraints around them.
  touched(cells) {
    const nb = this.nb3;
    for (const x of cells) {
      const k = this.t.neighbors(x, nb);
      for (let j = 0; j < k; j++) { const c = nb[j]; if (this.isC[c]) { this.chg[c] = this.clock++; this.enqueue(c); } }
    }
  }

  // Unknown neighbours of c into out; returns their count.
  unknownOf(c, out) {
    const k = this.t.neighbors(c, this.nb);
    let m = 0;
    for (let j = 0; j < k; j++) if (this.K[this.nb[j]] === -1) out[m++] = this.nb[j];
    return m;
  }

  single(c) {
    const u = this.unk[c];
    if (!u) return false;
    const r = this.num[c] - this.mc[c];
    if (r !== 0 && r !== u) return false;
    const cells = this.nb2, m = this.unknownOf(c, cells);
    let any = false;
    for (let j = 0; j < m; j++) any = (r === 0 ? this.setSafe(cells[j], 'single', [c]) : this.setMine(cells[j], 'single', [c])) || any;
    return any;
  }

  // Two constraints a, b with unknown sets A, B: mines in A∩B lie in [lo, hi]; that bounds A\B and B\A.
  // With ra / rb mines remaining in A / B and "both" shared unknowns: the shared part holds at least
  // max(0, ra - onlyA, rb - onlyB) and at most min(both, ra, rb) mines. When that range forces A\B (or B\A) to be
  // all-safe or all-mine, the cells are set. This subsumes the classic 1-2-1 / subset patterns.
  pair(a, b, A, nA) {
    const st = this.stamp, mark = this.stampN;
    const B = this.nb2, nB = this.unknownOf(b, B);
    let both = 0;
    for (let j = 0; j < nB; j++) if (st[B[j]] === mark) both++;
    if (!both) return false;
    const onlyA = nA - both, onlyB = nB - both;
    const ra = this.num[a] - this.mc[a], rb = this.num[b] - this.mc[b];
    const lo = Math.max(0, ra - onlyA, rb - onlyB), hi = Math.min(both, ra, rb);
    if (lo > hi) return false; // inconsistent view (cannot happen with true numbers)
    let any = false;
    const by = [a, b];
    // A \ B
    if (onlyA && (ra - lo <= 0 || ra - hi >= onlyA)) {
      const mine = ra - hi >= onlyA;
      for (let j = 0; j < nA; j++) {
        const x = A[j];
        if (this.K[x] !== -1) continue;
        let inB = false;
        for (let i = 0; i < nB; i++) if (B[i] === x) { inB = true; break; }
        if (!inB) any = (mine ? this.setMine(x, 'pair', by) : this.setSafe(x, 'pair', by)) || any;
      }
    }
    // B \ A
    if (onlyB && (rb - lo <= 0 || rb - hi >= onlyB)) {
      const mine = rb - hi >= onlyB;
      for (let j = 0; j < nB; j++) {
        const x = B[j];
        if (st[x] !== mark && this.K[x] === -1) any = (mine ? this.setMine(x, 'pair', by) : this.setSafe(x, 'pair', by)) || any;
      }
    }
    // A ∩ B when its count is fixed at none or all
    if (lo === hi && (lo === 0 || lo === both)) {
      for (let j = 0; j < nB; j++) {
        const x = B[j];
        if (st[x] === mark && this.K[x] === -1) any = (lo === 0 ? this.setSafe(x, 'pair', by) : this.setMine(x, 'pair', by)) || any;
      }
    }
    return any;
  }

  pairs() {
    const since = this.passStart;
    this.passStart = this.clock;
    const list = this.act.slice(0, this.actN);
    const A = new Int32Array(this.t.maxN);
    const nbu = new Int32Array(this.t.maxN);
    let any = false;
    for (const a of list) {
      if (this.actPos[a] < 0) continue;
      const nA = this.unknownOf(a, A);
      const mark = ++this.stampN;
      for (let j = 0; j < nA; j++) this.stamp[A[j]] = mark;
      const seenMark = ++this.seenN;
      let changed = false;
      for (let j = 0; j < nA && !changed; j++) {
        const k = this.t.neighbors(A[j], nbu);
        for (let i = 0; i < k; i++) {
          const b = nbu[i];
          if (b === a || !this.isC[b] || this.actPos[b] < 0 || this.seen[b] === seenMark) continue;
          this.seen[b] = seenMark;
          if (this.chg[a] < since && this.chg[b] < since) continue; // checked before, nothing changed since
          if (this.pair(a, b, A, nA)) { changed = true; any = true; break; }
        }
      }
    }
    return any;
  }

  // Global rule: only fires at the extremes (no mines left / every unknown is a mine). Intermediate global reasoning
  // is left to probabilities(), which weighs interior cells exactly.
  count() {
    if (this.mines < 0) return false;
    const left = this.mines - this.knownMines, u = this.unknownLeft();
    if (!u || (left !== 0 && left !== u)) return false;
    for (let i = 0; i < this.t.n; i++) if (this.K[i] === -1) { if (left === 0) this.setSafe(i, 'count', []); else this.setMine(i, 'count', []); }
    return true;
  }

  drain() {
    while (this.qn) {
      const c = this.q[--this.qn];
      this.inQ[c] = 0;
      if (this.isC[c]) this.single(c);
    }
  }

  // Deduces until nothing more follows; returns solved().
  run() {
    for (;;) {
      this.drain();
      if (!this.unknownLeft()) break;
      if (this.pairs()) continue;
      if (this.count()) continue;
      break;
    }
    return this.solved();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Probabilities

// ln Gamma(x); lnChoose below builds ln C(n, k) from it. Logs are required: C(250000, 40000) overflows a double by
// thousands of orders of magnitude, while differences of logs stay small.
function lnGamma(x) {
  // Lanczos approximation (g = 7, n = 9), accurate to ~15 digits for x > 0.
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
const lnChoose = (n, k) => (k < 0 || k > n ? -Infinity : lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1));

// Enumeration is exponential in the worst case; these caps turn a pathological frontier into an approximate answer
// (exact: false) instead of a frozen page.
const COMPONENT_LIMIT = 60; // unknown cells in one frontier component
const NODE_BUDGET = 400000; // search nodes per component

/**
 * Mine probabilities of the unknown cells after solver.run(). Returns
 * { p: Float32Array (NaN for known cells), exact, safe: [cells], mines: [cells] } — safe / mines are cells that are
 * certain only by considering every arrangement (the 'enum' rule).
 */
// Exact model: frontier components are independent given their mine counts; interior cells (touching no number) are
// exchangeable, so a configuration with M frontier mines has C(interior, left - M) completions. Probabilities are
// arrangement counts weighted by that factor. Per-component distributions are combined by convolution, with
// prefix / suffix products so each component's "all others" distribution costs O(components) instead of O(n^2).
// Every intermediate array is rescaled by its maximum to stay inside double range.
export function probabilities(s) {
  const t = s.t, n = t.n, K = s.K;
  const p = new Float32Array(n).fill(NaN);
  const nb = new Int32Array(t.maxN);
  // Frontier: unknown cells next to an active constraint. Components through shared constraints (union-find).
  const parent = new Int32Array(n).fill(-1);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const frontier = [];
  for (let a = 0; a < s.actN; a++) {
    const c = s.act[a];
    const k = s.unknownOf(c, nb);
    for (let j = 0; j < k; j++) { const x = nb[j]; if (parent[x] < 0) { parent[x] = x; frontier.push(x); } }
    for (let j = 1; j < k; j++) { const r1 = find(nb[0]), r2 = find(nb[j]); if (r1 !== r2) parent[r1] = r2; }
  }
  const groups = new Map();
  for (const x of frontier) { const r = find(x); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(x); }
  let interior = 0;
  for (let i = 0; i < n; i++) if (K[i] === -1 && parent[i] < 0) interior++;
  const left = s.mines >= 0 ? s.mines - s.knownMines : -1;

  const comps = [];
  let exact = true;
  for (const cells of groups.values()) {
    const comp = enumerate(s, cells);
    if (!comp) { exact = false; comps.push({ cells, approx: true }); } else comps.push(comp);
  }

  const safe = [], mines = [];
  if (!exact || left < 0) {
    // Local estimate: the highest share of remaining mines among the constraints that touch a cell.
    let expected = 0;
    for (const x of frontier) {
      let best = 0;
      const k = t.neighbors(x, nb);
      for (let j = 0; j < k; j++) {
        const c = nb[j];
        if (s.isC[c] && s.unk[c]) best = Math.max(best, (s.num[c] - s.mc[c]) / s.unk[c]);
      }
      p[x] = best;
      expected += best;
    }
    for (const comp of comps) {
      if (comp.approx) continue;
      // exact components without global weighting
      const total = comp.cnt.reduce((a, b) => a + b, 0);
      comp.cells.forEach((x, ci) => {
        let m = 0;
        for (let k = 0; k < comp.cnt.length; k++) m += comp.cell[ci * comp.cnt.length + k];
        p[x] = total ? m / total : p[x];
        if (m === 0) safe.push(x); else if (m === total) mines.push(x);
      });
    }
    const ip = interior ? Math.min(1, Math.max(0, ((left >= 0 ? left : interior * 0.2) - expected) / interior)) : 0;
    for (let i = 0; i < n; i++) if (K[i] === -1 && parent[i] < 0) p[i] = ip;
    return { p, exact: false, safe, mines };
  }

  // Exact: weight each total of frontier mines M by C(interior, left - M).
  const lnB = (r) => lnChoose(interior, r);
  // Distribution of every component's mine count (scaled), convolutions of all but one (prefix / suffix).
  const dists = comps.map((c) => c.cnt);
  const conv = (a, b) => {
    const out = new Float64Array(a.length + b.length - 1);
    for (let i = 0; i < a.length; i++) if (a[i]) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
    const mx = Math.max(...out) || 1;
    for (let i = 0; i < out.length; i++) out[i] /= mx;
    return out;
  };
  const pre = [Float64Array.of(1)], suf = [];
  for (let i = 0; i < dists.length; i++) pre.push(conv(pre[i], dists[i]));
  suf[dists.length] = Float64Array.of(1);
  for (let i = dists.length - 1; i >= 0; i--) suf[i] = conv(dists[i], suf[i + 1]);
  // Interior weights b(r) = C(interior, r), scaled by their maximum over feasible r.
  let lnMax = -Infinity;
  for (let r = Math.max(0, left - pre[dists.length].length + 1); r <= Math.min(left, interior); r++) lnMax = Math.max(lnMax, lnB(r));
  if (lnMax === -Infinity) return { p, exact: false, safe, mines };
  const bw = (r) => (r < 0 || r > interior ? 0 : Math.exp(lnB(r) - lnMax));

  let Z = 0, interiorMines = 0;
  const all = pre[dists.length];
  for (let M = 0; M < all.length; M++) { const w = all[M] * bw(left - M); Z += w; interiorMines += w * (left - M); }
  if (!(Z > 0)) return { p, exact: false, safe, mines };
  comps.forEach((comp, ci) => {
    const others = conv(pre[ci], suf[ci + 1]);
    const L = comp.cnt.length;
    const G = new Float64Array(L);
    for (let m = 0; m < L; m++) for (let k = 0; k < others.length; k++) G[m] += others[k] * bw(left - m - k);
    let Zc = 0;
    for (let m = 0; m < L; m++) Zc += comp.cnt[m] * G[m];
    comp.cells.forEach((x, idx) => {
      let num = 0, sure = true, never = true;
      for (let m = 0; m < L; m++) {
        const v = comp.cell[idx * L + m];
        num += v * G[m];
        if (G[m] > 0 && comp.cnt[m] > 0) { if (v !== 0) never = false; if (v !== comp.cnt[m]) sure = false; }
      }
      p[x] = Zc > 0 ? num / Zc : 0;
      if (never) safe.push(x); else if (sure) mines.push(x);
    });
  });
  const ip = interior ? interiorMines / Z / interior : 0;
  for (let i = 0; i < n; i++) if (K[i] === -1 && parent[i] < 0) p[i] = ip;
  if (interior && ip === 0) for (let i = 0; i < n; i++) if (K[i] === -1 && parent[i] < 0) safe.push(i);
  return { p, exact: true, safe, mines };
}

// Every arrangement of mines in one frontier component that satisfies its constraints:
// { cells, cnt[m] (arrangements with m mines, scaled), cell[idx · L + m] (those with cell idx a mine) } or null.
// Backtracking with forward checking: after each assignment every touched constraint must still be satisfiable
// (mines <= need <= mines + free), which prunes most of the 2^size tree. BFS ordering keeps related cells adjacent
// so violations surface near the top of the tree.
function enumerate(s, cells) {
  const t = s.t;
  const size = cells.length;
  if (size > COMPONENT_LIMIT) return null;
  const nb = new Int32Array(t.maxN), buf = new Int32Array(t.maxN);
  const idx = new Map(cells.map((x, i) => [x, i]));
  // Constraints touching the component and, per cell, its constraints.
  const cons = [], byCell = cells.map(() => []);
  const seen = new Set();
  for (const x of cells) {
    const k = t.neighbors(x, nb);
    for (let j = 0; j < k; j++) {
      const c = nb[j];
      if (!s.isC[c] || seen.has(c)) continue;
      seen.add(c);
      const u = [];
      const kk = s.unknownOf(c, buf);
      for (let q = 0; q < kk; q++) if (idx.has(buf[q])) u.push(idx.get(buf[q]));
      const ci = cons.length;
      cons.push({ need: s.num[c] - s.mc[c], cells: u, mines: 0, free: u.length });
      for (const v of u) byCell[v].push(ci);
    }
  }
  // Order: breadth-first through shared constraints, so assignments meet their constraints early.
  const order = [], placed = new Uint8Array(size);
  for (let start = 0; start < size; start++) {
    if (placed[start]) continue;
    const queue = [start];
    placed[start] = 1;
    while (queue.length) {
      const v = queue.shift();
      order.push(v);
      for (const ci of byCell[v]) for (const w of cons[ci].cells) if (!placed[w]) { placed[w] = 1; queue.push(w); }
    }
  }
  const L = size + 1;
  const cnt = new Float64Array(L), cell = new Float64Array(size * L);
  const val = new Uint8Array(size);
  let nodes = 0, mines = 0, ok = true;
  const fits = (v) => {
    for (const ci of byCell[v]) { const c = cons[ci]; if (c.mines > c.need || c.mines + c.free < c.need) return false; }
    return true;
  };
  const rec = (d) => {
    if (++nodes > NODE_BUDGET) { ok = false; return; }
    if (d === size) {
      cnt[mines]++;
      for (let i = 0; i < size; i++) if (val[i]) cell[i * L + mines]++;
      return;
    }
    const v = order[d];
    for (const m of [0, 1]) {
      val[v] = m;
      mines += m;
      for (const ci of byCell[v]) { cons[ci].free--; cons[ci].mines += m; }
      if (fits(v)) rec(d + 1);
      for (const ci of byCell[v]) { cons[ci].free++; cons[ci].mines -= m; }
      mines -= m;
      val[v] = 0;
      if (!ok) return;
    }
  };
  rec(0);
  if (!ok) return null;
  const mx = Math.max(...cnt) || 1;
  for (let i = 0; i < L; i++) cnt[i] /= mx;
  for (let i = 0; i < cell.length; i++) cell[i] /= mx;
  return { cells, cnt, cell };
}

/**
 * Analysis of a player's view for hints.
 *   view = { open: (i) => bool, num: Uint8Array (numbers of open cells), mines: total, flagged: (i) => bool }
 * Returns { safe: [{cell, rule, by}], mines: [{cell, rule, by}], wrongFlags: [cells], probs: Float32Array | null,
 *           best: cell with the lowest mine probability (when nothing is certain), bestP }.
 * Flags are not trusted: the analysis uses the numbers only.
 */
// s.log is cleared after opening the view's cells: openCell itself logs nothing, but the reset makes the log contain
// only deductions from run(), i.e. exactly the hints.
export function analyzeView(topo, view, { probs = true } = {}) {
  const s = new Solver(topo, view.num, { mines: view.mines, open: false, log: true });
  for (let i = 0; i < topo.n; i++) if (view.open(i)) s.openCell(i);
  s.log.length = 0;
  s.run();
  const safe = [], mines = [];
  for (const d of s.log) (d.mine ? mines : safe).push(d);
  let pr = null, best = -1, bestP = 1;
  if (probs) {
    pr = probabilities(s);
    for (const x of pr.safe) if (s.K[x] === -1) safe.push({ cell: x, rule: 'enum', by: [] });
    for (const x of pr.mines) if (s.K[x] === -1) mines.push({ cell: x, rule: 'enum', by: [] });
    for (let i = 0; i < topo.n; i++) {
      if (s.K[i] !== -1 || Number.isNaN(pr.p[i])) continue;
      if (pr.p[i] < bestP - 1e-9) { bestP = pr.p[i]; best = i; }
    }
  }
  const wrongFlags = [];
  if (view.flagged) for (const d of safe) if (view.flagged(d.cell)) wrongFlags.push(d.cell);
  return { safe, mines, wrongFlags, probs: pr ? pr.p : null, exact: pr ? pr.exact : false, best, bestP: best >= 0 ? bestP : NaN, solver: s };
}
