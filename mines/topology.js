// mines/topology.js - board shapes of the game: square or hexagonal cells, the neighbourhood that the numbers count
// (classic king moves, orthogonal cross, knight moves, a wide 5 × 5 ring; hexagons: adjacent ring or radius 2) and
// optional wrap-around edges (a torus). Cells are indices 0 … w·h-1 in row-major order.
//
// topology({ w, h, grid, nb, wrap }) -> {
//   w, h, n, grid, nb, wrap, maxN,          maxN = largest neighbour count of a cell
//   neighbors(i, out) -> count               fills out (Int32Array(maxN) or array) with the neighbours of cell i
//   xy(i) -> [x, y], at(x, y) -> i | -1      (at() wraps coordinates on a torus)
// }
// Hexagons use "odd-r" offset coordinates: pointy-top cells, odd rows shifted half a cell to the right.

// Design: neighbourhoods are offset tables, and neighbors() writes into a caller-supplied buffer and returns a count.
// The solver and flood fill call it in hot loops; returning fresh arrays would make GC the bottleneck.
const ring = (r) => {
  const out = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx || dy) out.push([dx, dy]);
  return out;
};

// Square neighbourhoods as [dx, dy] offsets.
export const SQUARE_NB = {
  king: ring(1),
  cross: [[0, -1], [-1, 0], [1, 0], [0, 1]],
  knight: [[1, -2], [2, -1], [2, 1], [1, 2], [-1, 2], [-2, 1], [-2, -1], [-1, -2]],
  wide: ring(2),
};
// Hexagonal neighbourhoods by cube distance: 'king' = the 6 adjacent cells, 'wide' = radius 2 (18 cells).
export const HEX_NB = { king: 1, wide: 2 };

export const GRIDS = ['square', 'hex'];
export const NEIGHBORHOODS = { square: Object.keys(SQUARE_NB), hex: Object.keys(HEX_NB) };

// How far a neighbourhood reaches (a torus needs at least 2·reach + 1 cells per side, so no cell meets itself).
export function reach(grid, nb) {
  if (grid === 'hex') return HEX_NB[nb] || 1;
  return Math.max(...(SQUARE_NB[nb] || SQUARE_NB.king).map(([dx, dy]) => Math.max(Math.abs(dx), Math.abs(dy))));
}

// Offsets of a hexagonal neighbourhood for even and odd rows (odd-r offset coordinates through cube coordinates).
// Offsets depend on row parity in offset coordinates, so they are computed once per parity by converting a sample
// cell (col 10, row 10 or 11; far from 0 so the integer row & 1 trick is safe) to cube coordinates, enumerating
// the cube ball, and converting back. Cube distance is the true hex distance; offset coordinates are only storage.
function hexOffsets(radius) {
  const rows = [[], []];
  for (const parity of [0, 1]) {
    const col = 10, row = 10 + parity;
    const cx = col - (row - (row & 1)) / 2, cz = row;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const dy = -dx - dz;
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) > radius || (!dx && !dz)) continue;
        const x = cx + dx, z = cz + dz;
        const c = x + (z - (z & 1)) / 2;
        rows[parity].push([c - col, z - row]);
      }
    }
  }
  return rows;
}

export function topology({ w, h, grid = 'square', nb = 'king', wrap = false }) {
  const hex = grid === 'hex';
  const rows = hex ? hexOffsets(HEX_NB[nb] || 1) : [SQUARE_NB[nb] || SQUARE_NB.king, SQUARE_NB[nb] || SQUARE_NB.king];
  const n = w * h;
  const maxN = rows[0].length;
  // Flattened offsets: [dx0, dy0, dx1, dy1, …] per row parity.
  const off = rows.map((r) => Int32Array.from(r.flat()));
  // Wrap is a single conditional add/subtract: valid because normalizeConfig guarantees |offset| < side.
  // Cells off the board are skipped, so edge cells simply have fewer neighbours (count < maxN).
  function neighbors(i, out) {
    const y = (i / w) | 0, x = i - y * w;
    const o = off[y & 1];
    let k = 0;
    for (let j = 0; j < o.length; j += 2) {
      let nx = x + o[j], ny = y + o[j + 1];
      if (wrap) {
        if (nx < 0) nx += w; else if (nx >= w) nx -= w;
        if (ny < 0) ny += h; else if (ny >= h) ny -= h;
      } else if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      out[k++] = ny * w + nx;
    }
    return k;
  }
  const xy = (i) => { const y = (i / w) | 0; return [i - y * w, y]; };
  function at(x, y) {
    if (wrap) { x = ((x % w) + w) % w; y = ((y % h) + h) % h; } else if (x < 0 || y < 0 || x >= w || y >= h) return -1;
    return y * w + x;
  }
  return { w, h, n, grid: hex ? 'hex' : 'square', nb, wrap: !!wrap, maxN, neighbors, xy, at };
}
