// sudoku/clues.js - the drawn clues of the variants and the constraints they stand for.
//   CLUES[t] = { build(clue, ctx), cells(clue, geom) -> cells the clue refers to, level }
// Clue records are plain JSON (puzzle.clues); cells are frame indices (r * cols + c).
//
//   cage       { cells, sum }                 killer cage: distinct numbers with the sum
//   parity     { cell, odd }                  even / odd cell
//   kropki     { a, b, k: 'w' | 'b' }         white: consecutive, black: one is double the other
//   xv         { a, b, k: 'x' | 'v' }         X: sum 10, V: sum 5
//   consec     { a, b }                       bar: consecutive numbers
//   gt         { a, b }                       a > b
//   thermo     { cells }                      strictly increasing from the bulb (cells[0])
//   arrow      { cells }                      circle cells[0] = sum of the arrow cells[1..]
//   renban     { cells }                      distinct consecutive numbers in any order
//   whisper    { cells }                      German whispers: neighbours on the line differ by at least ⌈n/2⌉
//   dutch      { cells }                      Dutch whispers: neighbours differ by at least ⌊n/2⌋
//   palindrome { cells }                      the line reads the same both ways
//   parityline { cells }                      neighbours on the line alternate odd / even
//   between    { cells }                      inner cells strictly between the two end circles
//   zipper     { cells }                      cells equally far from the middle sum to the same total (odd: the middle)
//   entropic   { cells }                      every 3 neighbours on the line: one low, one middle, one high third
//   modular    { cells }                      every 3 neighbours on the line: different remainders mod 3
//   quad       { cell, digits }               the digits appear in the 2 × 2 cells whose top-left is `cell`
//   sandwich   { side: 'l' | 't', i, sum }    sum between the 1 and the n of row / column i
//   sky        { side, i, count }             skyscrapers visible from that side of row / column i
//   xsum       { side, i, sum }               the first x numbers from that side sum to `sum` (x = the first number)
//   frame      { side, i, sum }               the first box-width (rows) / box-height (columns) numbers sum to `sum`
//   little     { r, c, dr, dc, sum }          little killer: the diagonal from the outside position (r, c) heading
//                                             (dr, dc) sums to `sum` (repeats allowed where the rules allow)

import { betweenCons, combosCons, enumCons, linearCons, quadCons, runCombos, sandwichCons, skyscraperCons, sumCombos, xsumCons, zipperCons } from './constraints.js';

// Cells of row / column i seen from a side: 'l' left → right, 'r' right → left, 't' top → bottom, 'b' bottom → top.
// Ordered from the clue outward: sandwich / skyscraper / x-sum propagators depend on the order.
export function lineFrom(geom, side, i) {
  const { n, cols } = geom;
  const out = [];
  for (let k = 0; k < n; k++) {
    if (side === 'l') out.push(i * cols + k);
    else if (side === 'r') out.push(i * cols + (n - 1 - k));
    else if (side === 't') out.push(k * cols + i);
    else out.push((n - 1 - k) * cols + i);
  }
  return out;
}

// Diagonal of a little killer clue.
export function littleCells(geom, { r, c, dr, dc }) {
  const out = [];
  for (let rr = r + dr, cc = c + dc; rr >= 0 && cc >= 0 && rr < geom.rows && cc < geom.cols; rr += dr, cc += dc) {
    const i = rr * geom.cols + cc;
    if (geom.present[i]) out.push(i);
  }
  return out;
}

const frameLen = (geom, side) => (side === 'l' || side === 'r' ? geom.box[0] : geom.box[1]);

const pairs = (cells) => cells.slice(1).map((b, i) => [cells[i], b]);
// Line clues whose rule is a relation between consecutive cells become pair constraints (exact arc consistency, cheapest).
const lineRel = (kind, rel, level) => ({
  level,
  cells: (cl) => cl.cells,
  build(cl, ctx) { for (const [a, b] of pairs(cl.cells)) ctx.rel(kind, rel, a, b, level); },
});

// every window of 3 neighbours holds one number of each class
// Entropic / modular: each 3-cell window is a small enumerated constraint (3 cells x n values stays under ENUM_LIMIT).
const windows3 = (kind, cls) => ({
  level: 2,
  cells: (cl) => cl.cells,
  build(cl, ctx) {
    const n = ctx.n;
    for (let i = 0; i + 3 <= cl.cells.length; i++) {
      ctx.addCons(enumCons(kind, cl.cells.slice(i, i + 3), (v, k) => {
        for (let a = 0; a < k; a++) if (cls(v[a], n) === cls(v[k], n)) return false;
        return true;
      }, 2));
    }
  },
});

export const CLUES = {
  // Cage = all-different group (feeds peers) + sum constraint over precomputed combinations. A 1-cell cage is a given in
  // disguise and becomes a candidate restriction. 2-cell cages are graded level 1 (sum pairs are easy for humans).
  cage: {
    level: 2,
    cells: (cl) => cl.cells,
    build(cl, ctx) {
      ctx.addDistinct(cl.cells);
      if (cl.cells.length === 1) { ctx.restrict(cl.cells[0], 1 << (cl.sum - 1)); return; }
      ctx.addCons(combosCons('cage', cl.cells, sumCombos(ctx.n, cl.cells.length, cl.sum), cl.cells.length <= 2 ? 1 : 2));
    },
  },
  parity: {
    level: 1,
    cells: (cl) => [cl.cell],
    build(cl, ctx) {
      let m = 0;
      for (let v = 1; v <= ctx.n; v++) if ((v % 2 === 1) === !!cl.odd) m |= 1 << (v - 1);
      ctx.restrict(cl.cell, m);
    },
  },
  kropki: {
    level: 1,
    cells: (cl) => [cl.a, cl.b],
    build(cl, ctx) { ctx.rel('kropki', cl.k === 'b' ? 'double' : 'consec', cl.a, cl.b, 1); },
  },
  xv: {
    level: 1,
    cells: (cl) => [cl.a, cl.b],
    build(cl, ctx) { ctx.rel('xv', cl.k === 'x' ? 'sum10' : 'sum5', cl.a, cl.b, 1); },
  },
  consec: {
    level: 1,
    cells: (cl) => [cl.a, cl.b],
    build(cl, ctx) { ctx.rel('consec', 'consec', cl.a, cl.b, 1); },
  },
  // a > b is expressed as less(b, a): one relation table serves thermometers and inequality signs.
  gt: {
    level: 1,
    cells: (cl) => [cl.a, cl.b],
    build(cl, ctx) { ctx.rel('gt', 'less', cl.b, cl.a, 1); },
  },
  thermo: lineRel('thermo', 'less', 1),
  whisper: lineRel('whisper', 'whisper', 1),
  dutch: lineRel('dutch', 'dutch', 1),
  parityline: lineRel('parityline', 'parity', 1),
  palindrome: {
    level: 1,
    cells: (cl) => cl.cells,
    build(cl, ctx) {
      const L = cl.cells.length;
      for (let i = 0; i < Math.floor(L / 2); i++) ctx.rel('palindrome', 'eq', cl.cells[i], cl.cells[L - 1 - i], 1);
    },
  },
  arrow: {
    level: 2,
    cells: (cl) => cl.cells,
    build(cl, ctx) { ctx.addCons(linearCons('arrow', cl.cells.slice(1), [cl.cells[0]], 0, 2)); },
  },
  renban: {
    level: 2,
    cells: (cl) => cl.cells,
    build(cl, ctx) {
      ctx.addDistinct(cl.cells);
      ctx.addCons(combosCons('renban', cl.cells, runCombos(ctx.n, cl.cells.length), 2));
    },
  },
  between: {
    level: 2,
    cells: (cl) => cl.cells,
    build(cl, ctx) {
      const L = cl.cells.length;
      ctx.addCons(betweenCons(cl.cells[0], cl.cells[L - 1], cl.cells.slice(1, L - 1)));
    },
  },
  zipper: {
    level: 2,
    cells: (cl) => cl.cells,
    build(cl, ctx) { ctx.addCons(zipperCons(cl.cells)); },
  },
  // Thirds by floor((v-1) / (n/3)): for n not divisible by 3 the classes are uneven; the variant is offered only for n % 3 === 0.
  entropic: windows3('entropic', (v, n) => Math.floor((v - 1) / (n / 3))),
  modular: windows3('modular', (v) => v % 3),
  quad: {
    level: 2,
    cells: (cl, geom) => [cl.cell, cl.cell + 1, cl.cell + geom.cols, cl.cell + geom.cols + 1],
    build(cl, ctx) { ctx.addCons(quadCons(CLUES.quad.cells(cl, ctx.geom), cl.digits)); },
  },
  sandwich: {
    level: 2,
    cells: (cl, geom) => lineFrom(geom, cl.side, cl.i),
    build(cl, ctx) { ctx.addCons(sandwichCons(lineFrom(ctx.geom, cl.side, cl.i), cl.sum, ctx.n)); },
  },
  sky: {
    level: 2,
    cells: (cl, geom) => lineFrom(geom, cl.side, cl.i),
    build(cl, ctx) { ctx.addCons(skyscraperCons(lineFrom(ctx.geom, cl.side, cl.i), cl.count, ctx.n)); },
  },
  xsum: {
    level: 2,
    cells: (cl, geom) => lineFrom(geom, cl.side, cl.i),
    build(cl, ctx) { ctx.addCons(xsumCons(lineFrom(ctx.geom, cl.side, cl.i), cl.sum, ctx.n)); },
  },
  frame: {
    level: 2,
    cells: (cl, geom) => lineFrom(geom, cl.side, cl.i).slice(0, frameLen(geom, cl.side)),
    build(cl, ctx) { ctx.addCons(linearCons('frame', CLUES.frame.cells(cl, ctx.geom), [], cl.sum, 2)); },
  },
  little: {
    level: 2,
    cells: (cl, geom) => littleCells(geom, cl),
    build(cl, ctx) { ctx.addCons(linearCons('little', littleCells(ctx.geom, cl), [], cl.sum, 2)); },
  },
};
