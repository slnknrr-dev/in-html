// sudoku/geometry.js - the shape of a puzzle: an n-symbol grid with rectangular boxes, irregular (jigsaw) regions or
// no boxes at all (Latin square), and overlapping multi-grid layouts (samurai, twodoku, butterfly, sohei, flower).
//
// Cells are indexed in a rows × cols frame (r * cols + c); multi-grid layouts leave holes (present[i] = 0).
// A house is a set of exactly n cells that holds every value once: rows, columns and boxes / regions of every sub-grid
// (overlapping boxes of a layout are one house). Rules (diagonals, windows…) add further houses when a model is
// compiled (model.js).
//
//   makeGeometry({ n, box: [w, h] | null, regions: Int32Array(n*n) | null, layout: id | null }) -> geom
//   boxShapes(n) -> [[w, h], ...]   defaultBox(n) -> [w, h] | null   LAYOUTS
//   randomRegions(n, rng, box?) -> Int32Array(n*n) region ids (connected, n cells each)
//   regionsForSolution(n, solution, rng, box?) -> region ids that a complete grid satisfies
//   cellName(geom, i) -> 'R3C5'

export const MIN_N = 4;
// Up to 31 values a cell's candidates are one int32; 32..64 use two words (bits.js, wide.js).
export const MAX_N = 64;

// Box shapes w × h with w * h = n (w columns wide, h rows high), the squarest first; wide boxes before tall ones.
export function boxShapes(n) {
  const out = [];
  for (let h = Math.floor(Math.sqrt(n)); h >= 2; h--) if (n % h === 0) out.push([n / h, h]);
  return out;
}
export const defaultBox = (n) => boxShapes(n)[0] || null;

// Multi-grid layouts of square-box grids (n = b * b): sub-grid offsets and the frame size.
// Offsets are in cells of the frame; overlaps are exactly one box (b x b) for samurai / twodoku / sohei, and
// whole box bands for butterfly / flower. Overlapping boxes are the same cells, so addHouse's de-duplication merges
// them into one house.
export const LAYOUTS = {
  twodoku: { grids: (n, b) => [[0, 0], [n - b, n - b]], size: (n, b) => 2 * n - b },
  samurai: { grids: (n, b) => [[0, 0], [0, n + b], [n - b, n - b], [n + b, 0], [n + b, n + b]], size: (n, b) => 2 * n + b },
  butterfly: { grids: (n, b) => [[0, 0], [0, b], [b, 0], [b, b]], size: (n, b) => n + b },
  sohei: { grids: (n, b) => [[0, n - b], [n - b, 0], [n - b, 2 * n - 2 * b], [2 * n - 2 * b, n - b]], size: (n, b) => 3 * n - 2 * b },
  flower: { grids: (n, b) => [[b, b], [0, b], [b, 0], [b, 2 * b], [2 * b, b]], size: (n, b) => n + 2 * b },
};

// Layouts are limited to 4 x 4 and 9 x 9: bigger samurai frames are unwieldy to play and slow to generate.
export function layoutOK(layout, n) {
  const b = Math.round(Math.sqrt(n));
  return !!LAYOUTS[layout] && b * b === n && n >= 4 && n <= 9;
}

export function makeGeometry({ n, box = null, regions = null, layout = null }) {
  if (!(n >= MIN_N && n <= MAX_N)) throw new RangeError(`grid size ${n} is outside ${MIN_N}..${MAX_N}`);
  let rows = n, cols = n, grids = [[0, 0]];
  if (layout) {
    if (!layoutOK(layout, n)) throw new RangeError(`layout ${layout} needs square boxes (n = 4 or 9)`);
    const b = Math.round(Math.sqrt(n));
    box = [b, b];
    regions = null;
    grids = LAYOUTS[layout].grids(n, b);
    rows = cols = LAYOUTS[layout].size(n, b);
  }
  if (box && box[0] * box[1] !== n) throw new RangeError(`box ${box[0]}×${box[1]} does not tile ${n}`);
  if (regions && regions.length !== n * n) throw new RangeError('regions must cover the n × n grid');
  const size = rows * cols;
  const present = new Uint8Array(size);
  for (const [r0, c0] of grids) for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) present[(r0 + r) * cols + c0 + c] = 1;
  const cells = [];
  for (let i = 0; i < size; i++) if (present[i]) cells.push(i);
  const houses = [];
  const seen = new Map();
  // De-duplicated by sorted cell list (overlapping sub-grids share boxes).
  const addHouse = (kind, list, info) => {
    const key = [...list].sort((a, b) => a - b).join(',');
    if (seen.has(key)) return seen.get(key);
    const h = { kind, cells: Int32Array.from(list), ...info, id: houses.length };
    seen.set(key, h);
    houses.push(h);
    return h;
  };
  // region: box / region id per cell (thick borders are drawn between different ids); -1 = none
  const region = new Int32Array(size).fill(-1);
  grids.forEach(([r0, c0], g) => {
    for (let r = 0; r < n; r++) addHouse('row', Array.from({ length: n }, (_, c) => (r0 + r) * cols + c0 + c), { g, i: r, r: r0 + r, c: c0 });
    for (let c = 0; c < n; c++) addHouse('col', Array.from({ length: n }, (_, r) => (r0 + r) * cols + c0 + c), { g, i: c, r: r0, c: c0 + c });
  });
  if (regions) {
    const by = new Map();
    for (let i = 0; i < n * n; i++) {
      const id = regions[i];
      if (!(id >= 0 && id < n)) throw new RangeError('region ids must be 0..n-1');
      region[i] = id;
      if (!by.has(id)) by.set(id, []);
      by.get(id).push(i);
    }
    if (by.size !== n || [...by.values()].some((l) => l.length !== n)) throw new RangeError('every region needs exactly n cells');
    for (const [id, list] of [...by.entries()].sort((a, b) => a[0] - b[0])) {
      if (!connected(list, cols)) throw new RangeError('regions must be connected');
      addHouse('region', list, { g: 0, i: id });
    }
  } else if (box) {
    const [bw, bh] = box;
    // region ids for drawing are computed over the whole frame, so boxes of overlapping grids get one consistent id.
    const perRow = Math.ceil(cols / bw);
    for (const i of cells) region[i] = Math.floor(Math.floor(i / cols) / bh) * perRow + Math.floor((i % cols) / bw);
    grids.forEach(([r0, c0], g) => {
      for (let br = 0; br < n / bh; br++) {
        for (let bc = 0; bc < n / bw; bc++) {
          const list = [];
          for (let r = 0; r < bh; r++) for (let c = 0; c < bw; c++) list.push((r0 + br * bh + r) * cols + c0 + bc * bw + c);
          addHouse('box', list, { g, i: br * (n / bw) + bc, r: r0 + br * bh, c: c0 + bc * bw });
        }
      }
    });
  }
  return { n, rows, cols, size, present, cells: Int32Array.from(cells), grids, box: box ? [...box] : null, layout, region, houses, jigsaw: !!regions };
}

// Iterative flood fill (no recursion: 64 x 64 regions would overflow the stack); the c > 0 / c < cols - 1 guards stop row wrap-around.
function connected(list, cols) {
  const set = new Set(list);
  const stack = [list[0]];
  const seen = new Set(stack);
  while (stack.length) {
    const i = stack.pop();
    const c = i % cols;
    for (const j of [c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1, i - cols, i + cols]) {
      if (j >= 0 && set.has(j) && !seen.has(j)) { seen.add(j); stack.push(j); }
    }
  }
  return seen.size === list.length;
}

// Random irregular regions: starts from boxes (or rows when n is prime) and swaps cells between neighbouring regions
// while both stay connected, so every region keeps n cells.
// Cell swaps keep every region at exactly n cells; a swap that disconnects either region is undone. Swap count
// grows with n^2 (more for row starts, which are far from irregular).
export function randomRegions(n, rng, box = defaultBox(n)) {
  const reg = new Int32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const r = Math.floor(i / n), c = i % n;
    reg[i] = box ? Math.floor(r / box[1]) * (n / box[0]) + Math.floor(c / box[0]) : r;
  }
  const members = Array.from({ length: n }, () => []);
  for (let i = 0; i < n * n; i++) members[reg[i]].push(i);
  const isConnected = (id) => connected(members[id], n);
  const swaps = n * n * (box ? 3 : 6);
  for (let s = 0; s < swaps; s++) {
    const a = rng.int(n * n);
    const r = Math.floor(a / n), c = a % n;
    const nb = [];
    if (c > 0) nb.push(a - 1);
    if (c < n - 1) nb.push(a + 1);
    if (r > 0) nb.push(a - n);
    if (r < n - 1) nb.push(a + n);
    const b = rng.pick(nb);
    const A = reg[a], B = reg[b];
    if (A === B) continue;
    // a moves to B and some cell of B next to A (not b necessarily) moves to A: pick a random cell of B adjacent to A.
    const cand = members[B].filter((x) => adjacentTo(x, A, reg, n));
    if (!cand.length) continue;
    const d = rng.pick(cand);
    reg[a] = B; reg[d] = A;
    members[A] = members[A].filter((x) => x !== a); members[A].push(d);
    members[B] = members[B].filter((x) => x !== d); members[B].push(a);
    if (!isConnected(A) || !isConnected(B)) {
      reg[a] = A; reg[d] = B;
      members[A] = members[A].filter((x) => x !== d); members[A].push(a);
      members[B] = members[B].filter((x) => x !== a); members[B].push(d);
    }
  }
  return reg;
}

// Irregular regions that a complete grid already satisfies: starts from its boxes (rows when n has no box shape) and
// moves cells of one number around a cycle of neighbouring regions (a cell of x joins a neighbouring region, whose
// own x moves on to one of its neighbours, … until an x arrives in the first region). Rows and columns keep their
// numbers, every region keeps n cells and each number once; the regions must stay connected.
// Cycle moves preserve the invariant "each region holds each number once": every region in the cycle gives away
// one x and receives one x. The cycle is capped at 6 steps; failed connectivity rolls the moves back.
export function regionsForSolution(n, solution, rng, box = defaultBox(n)) {
  const reg = new Int32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const r = Math.floor(i / n), c = i % n;
    reg[i] = box ? Math.floor(r / box[1]) * (n / box[0]) + Math.floor(c / box[0]) : r;
  }
  const members = Array.from({ length: n }, () => []);
  for (let i = 0; i < n * n; i++) members[reg[i]].push(i);
  const around = (i) => {
    const r = Math.floor(i / n), c = i % n, out = [];
    for (const j of [c > 0 ? i - 1 : -1, c < n - 1 ? i + 1 : -1, r > 0 ? i - n : -1, r < n - 1 ? i + n : -1]) if (j >= 0 && reg[j] !== reg[i] && !out.includes(reg[j])) out.push(reg[j]);
    return out;
  };
  const swaps = n * n * 16;
  for (let s = 0; s < swaps; s++) {
    const a = rng.int(n * n), x = solution[a], A = reg[a];
    const moves = [];
    const seen = new Set([A]);
    let cell = a, closed = false;
    for (let step = 0; step < 6 && !closed; step++) {
      const targets = around(cell);
      if (!targets.length) break;
      const to = targets.includes(A) && (step > 0 || targets.length === 1 || rng.chance(0.5)) ? A : rng.pick(targets);
      moves.push([cell, reg[cell], to]);
      if (to === A) closed = true;
      else if (seen.has(to)) break;
      else { seen.add(to); cell = members[to].find((y) => solution[y] === x); }
    }
    if (!closed) continue;
    for (const [c, , to] of moves) reg[c] = to;
    const touched = [...new Set(moves.flatMap(([, from, to]) => [from, to]))];
    const next = new Map(touched.map((id) => [id, members[id].filter((y) => reg[y] === id).concat(moves.filter((m) => m[2] === id && !members[id].includes(m[0])).map((m) => m[0]))]));
    if ([...next.values()].every((l) => l.length === n && connected(l, n))) for (const [id, l] of next) members[id] = l;
    else for (const [c, from] of moves) reg[c] = from;
  }
  return reg;
}

function adjacentTo(i, id, reg, n) {
  const r = Math.floor(i / n), c = i % n;
  return (c > 0 && reg[i - 1] === id) || (c < n - 1 && reg[i + 1] === id) || (r > 0 && reg[i - n] === id) || (r < n - 1 && reg[i + n] === id);
}

export const cellName = (geom, i) => `R${Math.floor(i / geom.cols) + 1}C${(i % geom.cols) + 1}`;

// Orthogonal neighbour pairs [a, b] (a < b) of present cells.
export function adjacentPairs(geom) {
  const out = [];
  const { rows, cols, present } = geom;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!present[i]) continue;
      if (c + 1 < cols && present[i + 1]) out.push([i, i + 1]);
      if (r + 1 < rows && present[i + cols]) out.push([i, i + cols]);
    }
  }
  return out;
}

// Neighbours of a cell by offsets [[dr, dc], ...] inside the frame (present cells only).
export function neighbours(geom, i, offsets) {
  const r = Math.floor(i / geom.cols), c = i % geom.cols;
  const out = [];
  for (const [dr, dc] of offsets) {
    const rr = r + dr, cc = c + dc;
    if (rr < 0 || cc < 0 || rr >= geom.rows || cc >= geom.cols) continue;
    const j = rr * geom.cols + cc;
    if (geom.present[j]) out.push(j);
  }
  return out;
}

export const ORTHO = [[0, 1], [1, 0], [0, -1], [-1, 0]];
export const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
export const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
export const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
