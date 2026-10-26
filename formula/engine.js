// formula/engine.js - recalculation of a workbook in the model of xlsx/cells.js: formula registry, dependency graph
// (cells, ranges, whole columns / rows), topological recalculation of what changed, circular references (#CIRC!),
// volatile functions, spilled array results (#SPILL!) and a per-pass cache of dereferenced ranges.
//
//   const eng = new Engine(book, { now?, random? })   book: { sheets: [{ name, rows }], names?: [{ name, ref }] }
//   eng.rebuild()                 scans every sheet, registers formulas, recalculates everything -> { formulas, ms }
//                                 (call after structural edits: sorting, inserting / deleting rows, sheets, renames)
//   eng.update([[s, r, c], ...])  the caller changed these cells (values or formulas): dependents are recalculated
//   eng.recalc()                  volatile formulas (NOW, RAND, OFFSET, INDIRECT…) and their dependents
//   eng.evaluate(text, s, r, c)   value of a formula at a position (nothing is stored)
//   eng.precedents(s, r, c) / eng.dependents(s, r, c) -> [[s, r, c] | [s, r1, c1, r2, c2]]
//
// Formula cells are rich cells { f, v }: the engine writes `v`. Spilled values are written into empty neighbours as
// { v, sp: ownerCell }; they are removed again on rebuild() or when the owner changes.
// Graph nodes are the formula records themselves; a recalculation pass marks them with its stamp (no key sets), and
// positions are looked up through two-level maps with small integer keys (sheet * MAX_COLS + col, then row).

import { ERR, CellError, MAX_COLS, MAX_ROWS, isRich } from '../xlsx/cells.js';
import { parseFormula } from './parser.js';
import { Ref, isMatrix } from './values.js';
import { FUNCTIONS, VOLATILE, evaluate } from './evaluate.js';
import './functions.js';
import './lookup.js';

// Records hang off their cells (stale ones only lend their AST: their marks never match a later stamp).
const FSYM = Symbol('formula');
const colKey = (s, c) => s * MAX_COLS + c;
const EDGE_BUDGET = 4e6; // range edges per pass; beyond it precedents are evaluated on demand
const DEPTH_CAP = 400;

function pushTo(map, k, v) {
  const a = map.get(k);
  if (a) a.push(v); else map.set(k, [v]);
}

// Lower bound in a sorted array of [row, index] pairs.
function lowerBound(a, r) {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m][0] < r) lo = m + 1; else hi = m; }
  return lo;
}

// Members of directed cycles among `nodes` (iterative Tarjan over succ[] adjacency; self-loops count).
function cycleMembers(nodes, succ, inSet) {
  let index = 0;
  const idx = new Map(), low = new Map(), on = new Set(), stack = [], members = new Set();
  for (const v0 of nodes) {
    if (idx.has(v0)) continue;
    idx.set(v0, index); low.set(v0, index); index++; stack.push(v0); on.add(v0);
    const work = [[v0, 0]];
    while (work.length) {
      const top = work[work.length - 1];
      const v = top[0];
      const ss = succ[v] || [];
      if (top[1] < ss.length) {
        const w = ss[top[1]++];
        if (!inSet.has(w)) continue;
        if (!idx.has(w)) { idx.set(w, index); low.set(w, index); index++; stack.push(w); on.add(w); work.push([w, 0]); }
        else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
        continue;
      }
      work.pop();
      if (work.length) { const p = work[work.length - 1][0]; low.set(p, Math.min(low.get(p), low.get(v))); }
      if (low.get(v) === idx.get(v)) {
        const comp = [];
        let w;
        do { w = stack.pop(); on.delete(w); comp.push(w); } while (w !== v);
        if (comp.length > 1 || ss.includes(v)) for (const x of comp) members.add(x);
      }
    }
  }
  return members;
}

const rangeKey = (g) => g.s + ':' + g.r1 + ':' + g.c1 + ':' + g.r2 + ':' + g.c2;

export class Engine {
  constructor(book, { now, random } = {}) {
    this.book = book;
    this.now = now || (() => new Date());
    this.random = random || Math.random;
    this.stamp = 0;
    this.reset();
    this.ctxBase = {
      deref: (ref) => this.deref(ref),
      value: (s, r, c) => this.value(s, r, c),
      sheetIndex: (name) => this.sheetIndex(name),
      name: (name) => this.nameAst(name),
      now: () => this.now(),
      random: () => this.random(),
    };
  }

  reset() {
    this.all = new Set();           // formula records
    this.atPos = new Map();         // colKey -> Map<row, record>
    this.cellDeps = new Map();      // colKey -> Map<row, [record]> (formulas reading that cell)
    this.rangeEntries = new Map();  // 's:r1:c1:r2:c2' -> { s, r1, c1, r2, c2, keys: Set<record> }
    this.colDeps = new Map();       // colKey -> [range entry] (ranges up to 32 columns wide)
    this.wide = [];                 // wider range entries
    this.volatiles = new Set();
    this.blocked = new Set();       // records showing #SPILL!
    this.spillers = new Set();      // records with a spilled area
    this.spillChanged = [];         // flat [s, r, c, ...] of ghost cells written or removed
    this.pass = 0;
    this.depth = 0;
    this.cache = new Map();
    this.widths = new Map();
    this.sheetMap = null;
    this.names = null;
  }

  // --- lookups ---------------------------------------------------------------------------

  sheetIndex(name) {
    if (!this.sheetMap || this.sheetMap.size !== this.book.sheets.length) {
      this.sheetMap = new Map(this.book.sheets.map((sh, i) => [String(sh.name).toLowerCase(), i]));
    }
    const i = this.sheetMap.get(String(name).toLowerCase());
    return i === undefined ? -1 : i;
  }

  nameAst(name) {
    if (!this.names) {
      this.names = new Map();
      for (const n of this.book.names || []) {
        try { this.names.set(String(n.name).toLowerCase(), parseFormula(String(n.ref))); } catch { /* unusable name */ }
      }
    }
    return this.names.get(String(name).toLowerCase()) || null;
  }

  // The previous record of a cell (kept on the cell object, which moves with its row when sorted) lends its AST.
  parse(src, cell) {
    const old = cell && cell[FSYM];
    if (old && old.src === src) return old.ast;
    try { return parseFormula(src); } catch { return null; }
  }

  cellAt(s, r, c) {
    const sh = this.book.sheets[s];
    const row = sh && sh.rows[r];
    return row ? row[c] : undefined;
  }

  recordAt(s, r, c) {
    const m = this.atPos.get(colKey(s, c));
    return m ? m.get(r) : undefined;
  }

  // --- values ----------------------------------------------------------------------------

  // Pull-based safety net under the push-based topological order: if a formula reads a marked cell that has not been
  // computed yet in this pass (an edge the graph missed, e.g. OFFSET/INDIRECT or a range past EDGE_BUDGET), it is
  // evaluated on demand. `busy` detects a cycle on that path (#CIRC!); DEPTH_CAP bounds the recursion so a long
  // chain cannot overflow the JS stack (the stale value is read instead).
  value(s, r, c) {
    const sheet = this.book.sheets[s];
    if (!sheet) return ERR.REF;
    const row = sheet.rows[r];
    if (!row) return null;
    const cell = row[c];
    if (cell == null) return null;
    if (typeof cell !== 'object' || cell instanceof CellError) return cell;
    if (this.pass && cell.f != null) {
      const F = cell[FSYM];
      if (F && F.mark === this.pass && F.done !== this.pass) {
        if (F.busy) return ERR.CIRC;
        if (this.depth < DEPTH_CAP) this.evalF(F);
      }
    }
    return cell.v === undefined ? null : cell.v;
  }

  rowWidth(s) {
    let w = this.widths.get(s);
    if (w === undefined) {
      w = 0;
      for (const row of this.book.sheets[s].rows) if (row && row.length > w) w = row.length;
      this.widths.set(s, w);
    }
    return w;
  }

  // Whole-column/row refs are clipped to the used area (rows.length, widest row) before materializing: SUM(A:A)
  // costs the used rows, not a million. Matrices are cached per pass by rectangle key (bounded size and count), and
  // the cache is cleared whenever a write changes values.
  deref(ref) {
    const sheet = this.book.sheets[ref.s];
    if (!sheet) return [[ERR.REF]];
    const r1 = ref.r1, c1 = ref.c1;
    const r2 = Math.min(ref.r2, sheet.rows.length - 1);
    const c2 = ref.c2 >= MAX_COLS - 1 ? Math.min(ref.c2, this.rowWidth(ref.s) - 1) : ref.c2;
    if (r2 < r1 || c2 < c1) return [[null]];
    const key = ref.s + ':' + r1 + ':' + c1 + ':' + r2 + ':' + c2;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const h = r2 - r1 + 1, w = c2 - c1 + 1;
    const m = new Array(h);
    for (let i = 0; i < h; i++) {
      const row = new Array(w);
      for (let j = 0; j < w; j++) row[j] = this.value(ref.s, r1 + i, c1 + j);
      m[i] = row;
    }
    if (h * w <= 4e6) {
      if (this.cache.size > 256) this.cache.clear();
      this.cache.set(key, m);
    }
    return m;
  }

  // --- registry --------------------------------------------------------------------------

  collect(n, F) {
    switch (n.type) {
      case 'ref': {
        const s = n.sheet == null ? F.s : this.sheetIndex(n.sheet);
        if (s >= 0) F.cells.push(s, n.r, n.c);
        return;
      }
      case 'range': {
        const s = n.sheet == null ? F.s : this.sheetIndex(n.sheet);
        if (s >= 0) F.ranges.push({ s, r1: n.r1 ?? 0, r2: n.r2 ?? MAX_ROWS - 1, c1: n.c1 ?? 0, c2: n.c2 ?? MAX_COLS - 1 });
        return;
      }
      case 'call': {
        const d = FUNCTIONS.get(n.name);
        if (VOLATILE.has(n.name) || (d && d.volatile)) F.volatile = true;
        for (const a of n.args) this.collect(a, F);
        return;
      }
      case 'name': F.volatile = true; return;
      case 'unary': case 'postfix': case 'paren': this.collect(n.a, F); return;
      case 'bin': this.collect(n.a, F); this.collect(n.b, F); return;
      default:
    }
  }

  // Identical ranges share one entry (thousands of lookups into the same table cost one dependency).
  register(s, r, c, cell) {
    const F = { s, r, c, cell, src: cell.f, ast: this.parse(String(cell.f), cell), cells: [], ranges: [], volatile: false, spill: null, mark: 0, done: 0, busy: false, idx: -1 };
    if (F.ast) this.collect(F.ast, F);
    cell[FSYM] = F;
    this.all.add(F);
    let pm = this.atPos.get(colKey(s, c));
    if (!pm) { pm = new Map(); this.atPos.set(colKey(s, c), pm); }
    pm.set(r, F);
    for (let i = 0; i < F.cells.length; i += 3) {
      const ck = colKey(F.cells[i], F.cells[i + 2]);
      let m = this.cellDeps.get(ck);
      if (!m) { m = new Map(); this.cellDeps.set(ck, m); }
      pushTo(m, F.cells[i + 1], F);
    }
    for (const g of F.ranges) {
      const rk = rangeKey(g);
      let e = this.rangeEntries.get(rk);
      if (!e) {
        e = { ...g, keys: new Set() };
        this.rangeEntries.set(rk, e);
        if (g.c2 - g.c1 < 32) for (let cc = g.c1; cc <= g.c2; cc++) pushTo(this.colDeps, colKey(g.s, cc), e);
        else this.wide.push(e);
      }
      e.keys.add(F);
    }
    if (F.volatile) this.volatiles.add(F);
    return F;
  }

  unregister(F) {
    for (let i = 0; i < F.cells.length; i += 3) {
      const m = this.cellDeps.get(colKey(F.cells[i], F.cells[i + 2]));
      const a = m && m.get(F.cells[i + 1]);
      if (!a) continue;
      const j = a.indexOf(F);
      if (j >= 0) a.splice(j, 1);
      if (!a.length) m.delete(F.cells[i + 1]);
    }
    for (const g of F.ranges) {
      const rk = rangeKey(g);
      const e = this.rangeEntries.get(rk);
      if (!e) continue;
      e.keys.delete(F);
      if (e.keys.size) continue;
      this.rangeEntries.delete(rk);
      if (g.c2 - g.c1 < 32) {
        for (let cc = g.c1; cc <= g.c2; cc++) {
          const a = this.colDeps.get(colKey(g.s, cc));
          if (!a) continue;
          const b = a.filter((x) => x !== e);
          if (b.length) this.colDeps.set(colKey(g.s, cc), b); else this.colDeps.delete(colKey(g.s, cc));
        }
      } else this.wide = this.wide.filter((x) => x !== e);
    }
    const pm = this.atPos.get(colKey(F.s, F.c));
    if (pm && pm.get(F.r) === F) pm.delete(F.r);
    this.volatiles.delete(F);
    this.blocked.delete(F);
    if (F.spill) this.clearSpill(F);
    this.all.delete(F);
    if (F.cell[FSYM] === F) F.cell[FSYM] = undefined;
  }

  // fn(record) for formulas reading the cell; fnEntry(entry) first for range entries (false skips the entry).
  forDependents(s, r, c, fn, fnEntry) {
    const m = this.cellDeps.get(colKey(s, c));
    const a = m && m.get(r);
    if (a) for (const F of a) fn(F);
    const hit = (e) => { if (!fnEntry || fnEntry(e) !== false) for (const F of e.keys) fn(F); };
    const b = this.colDeps.get(colKey(s, c));
    if (b) for (const e of b) if (r >= e.r1 && r <= e.r2) hit(e);
    for (const e of this.wide) if (e.s === s && r >= e.r1 && r <= e.r2 && c >= e.c1 && c <= e.c2) hit(e);
  }

  // Formulas depending (transitively) on the positions (flat [s, r, c, ...]) plus the seeds, marked with a new
  // stamp. Very wide fan-outs give up and take every formula (a full recalculation is cheaper than the bookkeeping).
  closure(positions, seeds) {
    const stamp = ++this.stamp;
    const list = [];
    const queue = positions.slice();
    const mark = (F) => {
      if (F.mark === stamp) return;
      F.mark = stamp;
      list.push(F);
      queue.push(F.s, F.r, F.c);
      if (F.spill) for (let i = 0; i < F.spill.h; i++) for (let j = 0; j < F.spill.w; j++) if (i || j) queue.push(F.s, F.r + i, F.c + j);
    };
    for (const F of seeds) mark(F);
    const seen = new Set();
    let work = 0;
    const entry = (e) => { work++; if (seen.has(e)) return false; seen.add(e); return true; };
    while (queue.length) {
      const c = queue.pop(), r = queue.pop(), s = queue.pop();
      this.forDependents(s, r, c, mark, entry);
      if (++work > 3e6) return this.everything();
    }
    return { list, stamp };
  }

  everything() {
    const stamp = ++this.stamp;
    const list = [...this.all];
    for (const F of list) F.mark = stamp;
    return { list, stamp };
  }

  // --- recalculation ---------------------------------------------------------------------

  // Dependency graph of the marked formulas over dense indices: 0..n-1 are formulas, higher indices are one virtual
  // node per distinct range (its marked formulas -> node -> formulas reading the range).
  // Range dependencies use one virtual node per distinct range instead of an edge from every cell in the range to
  // every reader: k readers of a range of m formulas cost m + k edges, not m * k. Formulas inside a range are found
  // by binary search over per-column sorted row lists.
  order(list, stamp) {
    const n = list.length;
    const byCol = new Map();
    const colsOf = new Map();
    for (let i = 0; i < n; i++) {
      const F = list[i];
      F.idx = i;
      const key = colKey(F.s, F.c);
      let a = byCol.get(key);
      if (!a) { a = []; byCol.set(key, a); pushTo(colsOf, F.s, F.c); }
      a.push([F.r, i]);
    }
    for (const a of byCol.values()) a.sort((x, y) => x[0] - y[0]);
    for (const a of colsOf.values()) a.sort((x, y) => x - y);
    const indeg = new Array(n).fill(0);
    const succ = [];
    const edge = (p, q) => { const a = succ[p]; if (a) a.push(q); else succ[p] = [q]; indeg[q]++; };
    const nodes = new Map();
    let budget = EDGE_BUDGET;
    for (let q = 0; q < n; q++) {
      const F = list[q];
      for (let i = 0; i < F.cells.length; i += 3) {
        const cell = this.cellAt(F.cells[i], F.cells[i + 1], F.cells[i + 2]);
        const G = isRich(cell) ? cell[FSYM] : undefined;
        if (G && G.mark === stamp) edge(G.idx, q);
      }
      for (const g of F.ranges) {
        const rk = rangeKey(g);
        let node = nodes.get(rk);
        if (node === undefined) {
          node = -1;
          const cols = colsOf.get(g.s);
          if (cols && budget > 0) {
            for (const cc of cols) {
              if (cc < g.c1) continue;
              if (cc > g.c2 || budget <= 0) break;
              const a = byCol.get(colKey(g.s, cc));
              for (let i = lowerBound(a, g.r1); i < a.length && a[i][0] <= g.r2 && budget > 0; i++) {
                if (node < 0) { node = indeg.length; indeg.push(0); }
                edge(a[i][1], node);
                budget--;
              }
            }
          }
          nodes.set(rk, node);
        }
        if (node >= 0) edge(node, q);
      }
    }
    return { indeg, succ };
  }

  // Kahn's algorithm over the graph; what remains with indegree > 0 contains cycles. Tarjan's SCC (cycleMembers)
  // separates true cycle members (written #CIRC!) from formulas merely downstream of a cycle, which are then still
  // evaluated normally. Spills can change cells other formulas read, so dependents of changed spill cells get
  // another round, capped at 8 to stop oscillating spills.
  recalcSet({ list, stamp }, round = 0) {
    if (!list.length) return;
    this.cache.clear();
    this.widths.clear();
    const prev = this.pass;
    this.pass = stamp;
    const n = list.length;
    const { indeg, succ } = this.order(list, stamp);
    const queue = [];
    for (let i = 0; i < indeg.length; i++) if (indeg[i] === 0) queue.push(i);
    let qi = 0;
    const drain = () => {
      while (qi < queue.length) {
        const i = queue[qi++];
        if (i < n && list[i].done !== stamp) this.evalF(list[i]);
        const ss = succ[i];
        if (ss) for (const q of ss) if (--indeg[q] === 0) queue.push(q);
      }
    };
    drain();
    const rest = [];
    for (let i = 0; i < indeg.length; i++) if (indeg[i] > 0) rest.push(i);
    if (rest.length) {
      const members = cycleMembers(rest, succ, new Set(rest));
      for (const i of members) {
        if (i >= n) continue;
        this.write(list[i], ERR.CIRC);
        list[i].done = stamp;
      }
      for (const i of members) for (const q of succ[i] || []) if (!members.has(q) && --indeg[q] === 0) queue.push(q);
      drain();
      for (const F of list) if (F.done !== stamp) this.evalF(F);
    }
    this.pass = prev;
    if (this.spillChanged.length && round < 8) {
      const changed = this.spillChanged.splice(0);
      this.recalcSet(this.closure(changed, []), round + 1);
    }
  }

  // A RangeError (stack overflow from runaway recursion, e.g. a defined name that refers to itself) is reported as
  // #CIRC!; any other exception becomes #VALUE! so one broken function cannot abort the pass.
  evalF(F) {
    let v;
    if (!F.ast) v = ERR.ERROR;
    else {
      F.busy = true;
      this.depth++;
      try {
        v = evaluate(F.ast, { ...this.ctxBase, s: F.s, r: F.r, c: F.c });
        if (v instanceof Ref) v = v.single ? this.value(v.s, v.r1, v.c1) : this.deref(v);
      } catch (e) {
        v = e instanceof RangeError ? ERR.CIRC : ERR.VALUE;
      }
      this.depth--;
      F.busy = false;
    }
    if (this.pass) F.done = this.pass;
    this.write(F, v);
  }

  write(F, v) {
    if (isMatrix(v)) {
      if (v.length > 1 || (v[0] && v[0].length > 1)) { this.spill(F, v); return; }
      v = v.length && v[0].length ? v[0][0] : null;
    }
    if (F.spill) this.clearSpill(F);
    this.blocked.delete(F);
    F.cell.v = v == null ? 0 : v;
  }

  // Removes ghosts of F's area outside rows [0, keepH) x cols [0, keepW).
  dropGhosts(F, keepH = 0, keepW = 0) {
    const rows = this.book.sheets[F.s].rows;
    const { h, w } = F.spill;
    for (let i = 0; i < h; i++) {
      const row = rows[F.r + i];
      if (!row) continue;
      for (let j = 0; j < w; j++) {
        if ((!i && !j) || (i < keepH && j < keepW)) continue;
        const cell = row[F.c + j];
        if (isRich(cell) && cell.sp === F.cell) {
          row[F.c + j] = null;
          this.spillChanged.push(F.s, F.r + i, F.c + j);
        }
      }
    }
  }

  clearSpill(F) {
    this.dropGhosts(F);
    F.spill = null;
    this.spillers.delete(F);
    this.cache.clear();
  }

  // A dynamic array spills only if every target cell is empty or already this formula's spill; otherwise the owner
  // shows #SPILL! and remembers it is blocked (re-tried when the blocker changes). Spill cells are ghost objects
  // { v, sp } pointing to the owner, so they can be recognized and removed when the result shrinks.
  spill(F, m) {
    const h = m.length, w = m[0].length;
    const rows = this.book.sheets[F.s].rows;
    let blocked = F.r + h > MAX_ROWS || F.c + w > MAX_COLS;
    for (let i = 0; i < h && !blocked; i++) {
      const row = rows[F.r + i];
      if (!row) continue;
      for (let j = 0; j < w; j++) {
        if (!i && !j) continue;
        const cell = row[F.c + j];
        if (cell != null && cell !== '' && !(isRich(cell) && cell.sp === F.cell)) { blocked = true; break; }
      }
    }
    if (blocked) {
      if (F.spill) this.clearSpill(F);
      F.cell.v = ERR.SPILL;
      this.blocked.add(F);
      return;
    }
    this.blocked.delete(F);
    if (F.spill) this.dropGhosts(F, h, w);
    let changed = false;
    for (let i = 0; i < h; i++) {
      let row = rows[F.r + i];
      if (!row) { row = []; rows[F.r + i] = row; }
      for (let j = 0; j < w; j++) {
        if (!i && !j) continue;
        let v = m[i][j];
        if (v == null) v = 0;
        const cell = row[F.c + j];
        if (isRich(cell) && cell.sp === F.cell) {
          if (cell.v === v) continue;
          cell.v = v;
        } else row[F.c + j] = { v, sp: F.cell };
        changed = true;
        this.spillChanged.push(F.s, F.r + i, F.c + j);
      }
    }
    if (changed) { this.cache.clear(); this.widths.clear(); }
    const v0 = m[0][0];
    F.cell.v = v0 == null ? 0 : v0;
    F.spill = { h, w };
    this.spillers.add(F);
  }

  // --- public ----------------------------------------------------------------------------

  rebuild() {
    const t0 = Date.now();
    this.reset();
    const sheets = this.book.sheets;
    for (let s = 0; s < sheets.length; s++) {
      const rows = sheets[s].rows;
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
          const cell = row[c];
          if (!isRich(cell)) continue;
          if (cell.sp) row[c] = null;
          else if (cell.f != null && cell.f !== '') this.register(s, r, c, cell);
        }
      }
    }
    this.spillChanged.length = 0;
    this.recalcSet(this.everything());
    return { formulas: this.all.size, ms: Date.now() - t0 };
  }

  update(cells) {
    const seeds = [];
    const positions = [];
    for (const [s, r, c] of cells) {
      const cell = this.cellAt(s, r, c);
      const old = this.recordAt(s, r, c);
      const isF = isRich(cell) && cell.f != null && cell.f !== '';
      if (old && (!isF || old.cell !== cell || old.src !== cell.f)) this.unregister(old);
      if (isF) seeds.push(this.recordAt(s, r, c) || this.register(s, r, c, cell));
      // a spilled area overwritten by the caller: its owner shows #SPILL! now
      for (const F of this.spillers) {
        if (F.s === s && r >= F.r && c >= F.c && r < F.r + F.spill.h && c < F.c + F.spill.w && (r !== F.r || c !== F.c) && !(isRich(cell) && cell.sp === F.cell)) seeds.push(F);
      }
      positions.push(s, r, c);
    }
    for (const F of this.blocked) seeds.push(F);
    for (const F of this.volatiles) seeds.push(F);
    this.recalcSet(this.closure(positions.concat(this.spillChanged.splice(0)), seeds));
  }

  recalc() {
    this.recalcSet(this.closure(this.spillChanged.splice(0), [...this.volatiles]));
  }

  get size() { return this.all.size; }

  evaluate(text, s = 0, r = 0, c = 0) {
    let ast;
    try { ast = parseFormula(text); } catch { return ERR.ERROR; }
    try {
      let v = evaluate(ast, { ...this.ctxBase, s, r, c });
      if (v instanceof Ref) v = v.single ? this.value(v.s, v.r1, v.c1) : this.deref(v);
      return v;
    } catch { return ERR.VALUE; } finally { this.cache.clear(); }
  }

  precedents(s, r, c) {
    const F = this.recordAt(s, r, c);
    if (!F) return [];
    const out = [];
    for (let i = 0; i < F.cells.length; i += 3) out.push([F.cells[i], F.cells[i + 1], F.cells[i + 2]]);
    for (const g of F.ranges) out.push([g.s, g.r1, g.c1, g.r2, g.c2]);
    return out;
  }

  dependents(s, r, c) {
    const out = [];
    this.forDependents(s, r, c, (F) => out.push([F.s, F.r, F.c]));
    return out;
  }
}
