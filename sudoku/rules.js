// sudoku/rules.js - global rules: constraints that hold for the whole grid rather than for a drawn clue.
//   RULES[id] = { supports(geom) -> boolean, apply(ctx) }   (ctx: see model.js)
// Extra houses (diagonals, windows, disjoint groups, asterisk…) make the rule's cell sets hold every value once;
// anti-chess rules forbid equal numbers a move apart; non-consecutive forbids neighbours that differ by 1;
// the negative rules of dot / sign variants ("all dots are given") forbid the relation where no clue is drawn.

import { DIAG, KNIGHT, adjacentPairs, neighbours } from './geometry.js';
import { linearCons } from './constraints.js';

const squareBox = (g) => !!g.box && g.box[0] === g.box[1];
const regular = (g) => !!g.box && !g.jigsaw;
const single = (g) => g.grids.length === 1;
const nine = (g) => g.n === 9 && regular(g) && squareBox(g);

// Cells of a grid g at (r, c) relative to its top-left corner.
// Rules are written in sub-grid coordinates; at() maps them into the frame, so a rule works on every grid of a multi-grid layout.
const at = (geom, g, r, c) => (geom.grids[g][0] + r) * geom.cols + geom.grids[g][1] + c;

// Each rule declares supports(geom) so the generator / codec can reject impossible combinations up front
// (e.g. asterisk only on a single 9 x 9 with 3 x 3 boxes) instead of failing deep in compilation.
export const RULES = {
  diagonal: {
    supports: () => true,
    apply(ctx) {
      const { geom, n } = ctx;
      geom.grids.forEach((_, g) => {
        ctx.addHouse('diag', Array.from({ length: n }, (_, i) => at(geom, g, i, i)), { g, i: 0 });
        ctx.addHouse('diag', Array.from({ length: n }, (_, i) => at(geom, g, i, n - 1 - i)), { g, i: 1 });
      });
    },
  },
  // Windoku / hyper: extra windows of box size placed one cell in from every box corner.
  windoku: {
    supports: (g) => squareBox(g) && g.n >= 9,
    apply(ctx) {
      const { geom, n } = ctx;
      const b = geom.box[0];
      const starts = [];
      // Windows start at 1, b + 2, 2b + 3, ...: one cell in from each box corner with a one-cell gap, as long as the window fits.
      for (let k = 0; k * (b + 1) + 1 + b <= n; k++) starts.push(1 + k * (b + 1));
      geom.grids.forEach((_, g) => {
        let i = 0;
        for (const r0 of starts) for (const c0 of starts) {
          const cells = [];
          for (let r = 0; r < b; r++) for (let c = 0; c < b; c++) cells.push(at(geom, g, r0 + r, c0 + c));
          ctx.addHouse('window', cells, { g, i: i++, r: geom.grids[g][0] + r0, c: geom.grids[g][1] + c0 });
        }
      });
    },
  },
  // Disjoint groups: cells at the same position inside their boxes hold every value once.
  disjoint: {
    supports: (g) => regular(g) && single(g),
    apply(ctx) {
      const { geom, n } = ctx;
      const [bw, bh] = geom.box;
      for (let r = 0; r < bh; r++) for (let c = 0; c < bw; c++) {
        const cells = [];
        for (let br = 0; br < n / bh; br++) for (let bc = 0; bc < n / bw; bc++) cells.push(at(geom, 0, br * bh + r, bc * bw + c));
        ctx.addHouse('group', cells, { g: 0, i: r * bw + c });
      }
    },
  },
  // Centre dot: the centre cells of the boxes hold every value once.
  centerdot: {
    supports: (g) => regular(g) && single(g) && g.box[0] % 2 === 1 && g.box[1] % 2 === 1,
    apply(ctx) {
      const { geom, n } = ctx;
      const [bw, bh] = geom.box;
      const cells = [];
      for (let br = 0; br < n / bh; br++) for (let bc = 0; bc < n / bw; bc++) cells.push(at(geom, 0, br * bh + (bh - 1) / 2, bc * bw + (bw - 1) / 2));
      ctx.addHouse('center', cells, { g: 0, i: 0 });
    },
  },
  asterisk: {
    supports: (g) => nine(g) && single(g),
    apply(ctx) {
      const cells = [[1, 4], [2, 2], [2, 6], [4, 1], [4, 4], [4, 7], [6, 2], [6, 6], [7, 4]].map(([r, c]) => at(ctx.geom, 0, r, c));
      ctx.addHouse('asterisk', cells, { g: 0, i: 0 });
    },
  },
  girandola: {
    supports: (g) => nine(g) && single(g),
    apply(ctx) {
      const cells = [[0, 0], [0, 8], [1, 4], [4, 1], [4, 4], [4, 7], [7, 4], [8, 0], [8, 8]].map(([r, c]) => at(ctx.geom, 0, r, c));
      ctx.addHouse('girandola', cells, { g: 0, i: 0 });
    },
  },
  antiknight: {
    supports: () => true,
    apply(ctx) { forMoves(ctx, KNIGHT, (a, b) => ctx.addNeq(a, b)); },
  },
  antiking: {
    supports: () => true,
    apply(ctx) { forMoves(ctx, DIAG, (a, b) => ctx.addNeq(a, b)); },
  },
  nonconsecutive: {
    supports: (g) => g.n >= 4,
    apply(ctx) { for (const [a, b] of adjacentPairs(ctx.geom)) ctx.rel('nonconsec', 'nonconsec', a, b, 1); },
  },
  // Magic square: rows, columns and diagonals of the centre box of a 9 × 9 grid sum to 15.
  // Magic square: sums over a 3-cell line expressed as linear constraints (level 2: arithmetic). With all-different 1..9 the centre must be 5, which propagation finds by itself.
  magic: {
    supports: (g) => nine(g) && single(g),
    apply(ctx) {
      const c = (r, k) => at(ctx.geom, 0, 3 + r, 3 + k);
      const lines = [];
      for (let i = 0; i < 3; i++) { lines.push([c(i, 0), c(i, 1), c(i, 2)]); lines.push([c(0, i), c(1, i), c(2, i)]); }
      lines.push([c(0, 0), c(1, 1), c(2, 2)], [c(0, 2), c(1, 1), c(2, 0)]);
      for (const l of lines) ctx.addCons(linearCons('magic', l, [], 15, 2));
    },
  },
  // "All dots / signs are given": neighbours without the clue must not have its relation.
  // Negative constraints make dot / sign variants self-contained: without them, every pair without a dot would be
  // unconstrained and the generator would need far more givens for uniqueness.
  'kropki-neg': {
    supports: () => true,
    apply(ctx) { negative(ctx, ['kropki'], 'kropkiNone'); },
  },
  'xv-neg': {
    supports: () => true,
    apply(ctx) { negative(ctx, ['xv'], 'xvNone'); },
  },
  'consec-neg': {
    supports: () => true,
    apply(ctx) { negative(ctx, ['consec'], 'nonconsec'); },
  },
};

// a < b emits each unordered pair once (the move sets are symmetric).
function forMoves(ctx, moves, fn) {
  const { geom } = ctx;
  for (const a of geom.cells) for (const b of neighbours(geom, a, moves)) if (a < b) fn(a, b);
}

// Clue pairs are keyed min,max; adjacentPairs() already yields a < b, so the keys match without normalizing both sides.
function negative(ctx, kinds, rel) {
  const marked = new Set();
  for (const cl of ctx.puzzle.clues || []) if (kinds.includes(cl.t)) marked.add(Math.min(cl.a, cl.b) + ',' + Math.max(cl.a, cl.b));
  for (const [a, b] of adjacentPairs(ctx.geom)) if (!marked.has(a + ',' + b)) ctx.rel(rel, rel, a, b, 1);
}

