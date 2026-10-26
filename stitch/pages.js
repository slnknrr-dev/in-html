// stitch/pages.js - splitting a chart into printed pages: how many cells fit a paper size at a cell size, the page
// grid with overlap (repeated rows / columns at the edges, shaded on the page), page labels and the page map.
//
//   PAPERS            { a4: [210, 297], a3, letter, legal, a5 } in mm (portrait)
//   pageCapacity({ paper, landscape, cellMm, margins (mm), header (mm), round10 }) -> { cols, rows }
//   paginate(width, height, { cols, rows, overlap }) -> { pages: [page], across, down }
//     page = { n (1-based), row, col (1-based in the page grid), x0, y0, x1, y1 (cells, exclusive ends),
//              ox0, oy0 (cells repeated from the previous page: the overlap band), label: 'r-c' }
//   pageOf(pages, x, y) -> page containing a cell (the first one)

// Design: capacity is computed in whole cells and rounded down to multiples of 10, so the thick 10-cell grid lines
// fall at the same place on every page and page edges coincide with them; stitchers count in tens.
// Overlap repeats rows / columns of the previous page so the eye can align pages; it is capped at a third of the
// page, beyond which pages would mostly repeat each other.
export const PAPERS = { a4: [210, 297], a3: [297, 420], a5: [148, 210], letter: [215.9, 279.4], legal: [215.9, 355.6] };

// Usable area = paper minus margins on both sides, header and footer bands, and the row / column number gutters
// (numbers, both sides). At least 10 x 10 cells so a tiny paper or huge cell size still yields a page.
export function pageCapacity({ paper = 'a4', landscape = false, cellMm = 3, margins = 10, header = 14, footer = 8, numbers = 6, round10 = true } = {}) {
  let [w, h] = PAPERS[paper] || PAPERS.a4;
  if (landscape) [w, h] = [h, w];
  const aw = w - 2 * margins - 2 * numbers, ah = h - 2 * margins - header - footer - 2 * numbers;
  let cols = Math.max(10, Math.floor(aw / cellMm)), rows = Math.max(10, Math.floor(ah / cellMm));
  if (round10) { cols = Math.max(10, cols - (cols % 10)); rows = Math.max(10, rows - (rows % 10)); }
  return { cols, rows };
}

// Pages over a W × H chart; each page shows up to cols × rows cells, of which `overlap` rows / columns at the top /
// left repeat the end of the previous page.
// Pages step by (cols - overlap); the count formula 1 + ceil((W - cols) / step) guarantees the last page reaches W
// (x1 is clamped to W). Row-major order (left to right, then down) matches reading order and page labels 'r-c'.
export function paginate(W, H, { cols = 60, rows = 80, overlap = 0 } = {}) {
  overlap = Math.max(0, Math.min(Math.floor(Math.min(cols, rows) / 3), overlap | 0));
  const stepX = cols - overlap, stepY = rows - overlap;
  const across = W <= cols ? 1 : 1 + Math.ceil((W - cols) / stepX);
  const down = H <= rows ? 1 : 1 + Math.ceil((H - rows) / stepY);
  const pages = [];
  for (let r = 0; r < down; r++) for (let c = 0; c < across; c++) {
    const x0 = c * stepX, y0 = r * stepY;
    pages.push({
      n: pages.length + 1, row: r + 1, col: c + 1,
      x0, y0, x1: Math.min(W, x0 + cols), y1: Math.min(H, y0 + rows),
      ox0: c > 0 ? overlap : 0, oy0: r > 0 ? overlap : 0,
      label: `${r + 1}-${c + 1}`,
    });
  }
  return { pages, across, down, cols, rows, overlap };
}

// With overlap a cell can lie on two pages; find returns the first (the earlier page), where it is not shaded.
export const pageOf = (pages, x, y) => pages.find((p) => x >= p.x0 && x < p.x1 && y >= p.y0 && y < p.y1) || null;
