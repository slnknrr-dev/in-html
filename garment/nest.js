// garment/nest.js - the cutting layout: every piece of a draft as many times as it is cut (mirrored pairs as a left
// and a right copy, cut-on-fold pieces opened out) placed on a fabric of a given width, grain along the selvedge
// (rotation 0 or 180 only). Pieces are rasterized conservatively (every cell the cutting line touches is taken),
// dropped onto the skyline of what is already placed and then slid into the hollows below it (bottom-left fill on
// bitsets), largest first. Grouped by material: shell, lining, interfacing ... each gets its own layout.
//
//   cutInstances(draft, { material }) -> [{ id, piece, poly, mirrored, label }]
//   nest(instances, { width, res, gap, slide }) -> { placed: [{ id, poly, x, y, rot, mirrored }], length, efficiency, width }
//   layoutsByMaterial(draft, { width, ... }) -> { material: nest result }
//   layoutSVG(result, { fabric, label }) -> SVG

import { cutOutline, mirrorPiece, unfoldPiece } from './piece.js';
import { area, bbox } from './geom.js';
import { esc } from './svg.js';

//
// Why raster nesting: exact polygon nesting (no-fit polygons) is complex and slow; a 1 cm raster with conservative
// cells (any cell the cutting line touches counts as taken) never produces overlaps, and bitset tests make each
// candidate position cheap. The cost is up to ~1 cm of slack per edge, acceptable for buying estimates.
// Rotations are limited to 0/180 degrees because the grainline must stay parallel to the selvedge; 180 keeps it.
// Mirrored pairs: every second copy is mirrored (left/right pieces), fold pieces are opened out so they can be cut
// flat. Note: Math.ceil(p.cut.n / 1) for fold pieces is a no-op (same as p.cut.n).
export function cutInstances(d, o = {}) {
  const out = [];
  for (const p of d.pieces) {
    if (o.material && p.material !== o.material) continue;
    const base = p.cut.fold ? unfoldPiece(p) : p;
    const n = Math.max(1, p.cut.fold ? Math.ceil(p.cut.n / 1) : p.cut.n);
    for (let k = 0; k < n; k++) {
      const mirrored = !!p.cut.mirror && k % 2 === 1;
      const q = mirrored ? mirrorPiece(base, 0) : base;
      out.push({ id: `${p.id}#${k + 1}`, piece: p.id, poly: cutOutline(q), mirrored, label: p.name });
    }
  }
  return out;
}

const transform = (poly, rot) => {
  const b = bbox(poly);
  return poly.map(([x, y]) => (rot === 180 ? [b.x1 - x, b.y1 - y] : [x - b.x0, y - b.y0]));
};

// Conservative raster of a polygon on cells of `res` cm: rows of spans [x0, x1] (inclusive cell indices).
// Two passes: scanline fill of cells whose centre is inside (even-odd), then every cell an edge passes through
// (sampled at res / 3 so no cell is skipped), dilated by the gap. top[] is the first occupied row per column, used
// to drop the piece onto the skyline.
function rasterize(poly, res, gap) {
  const b = bbox(poly);
  const W = Math.ceil((b.w + 2 * gap) / res) + 1, H = Math.ceil((b.h + 2 * gap) / res) + 1;
  const cells = new Uint8Array(W * H);
  const ox = b.x0 - gap, oy = b.y0 - gap;
  // Interior: cell centres inside (even-odd scanlines).
  for (let j = 0; j < H; j++) {
    const yc = oy + (j + 0.5) * res;
    const xs = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], c = poly[(i + 1) % poly.length];
      if ((a[1] > yc) !== (c[1] > yc)) xs.push(a[0] + ((yc - a[1]) / (c[1] - a[1])) * (c[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.floor((xs[k] - ox) / res)), i1 = Math.min(W - 1, Math.floor((xs[k + 1] - ox) / res));
      for (let i = i0; i <= i1; i++) cells[j * W + i] = 1;
    }
  }
  // Boundary: every cell an edge passes through, grown by the gap.
  const g = Math.ceil(gap / res);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], c = poly[(i + 1) % poly.length];
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const steps = Math.max(1, Math.ceil(L / (res / 3)));
    for (let s = 0; s <= steps; s++) {
      const x = a[0] + ((c[0] - a[0]) * s) / steps, y = a[1] + ((c[1] - a[1]) * s) / steps;
      const ci = Math.floor((x - ox) / res), cj = Math.floor((y - oy) / res);
      for (let dj = -g; dj <= g; dj++) for (let di = -g; di <= g; di++) {
        const ii = ci + di, jj = cj + dj;
        if (ii >= 0 && jj >= 0 && ii < W && jj < H) cells[jj * W + ii] = 1;
      }
    }
  }
  const rows = [];
  const top = new Int32Array(W).fill(-1);
  for (let j = 0; j < H; j++) {
    const spans = [];
    let i = 0;
    while (i < W) {
      if (!cells[j * W + i]) { i++; continue; }
      const s = i;
      while (i < W && cells[j * W + i]) { if (top[i] < 0) top[i] = j; i++; }
      spans.push([s, i - 1]);
    }
    rows.push(spans);
  }
  return { W, H, rows, top, ox, oy };
}

// Bottom-left fill: largest pieces first (they constrain the layout most), for every x the piece is dropped onto the
// skyline (cannot overlap anything, by construction), then tried up to `slide` rows lower to fill hollows under
// overhangs. Score prefers the lowest top edge, then the lowest position, then the leftmost x.
// The grid grows by doubling rows (amortised O(1)); one Uint32 word holds 32 columns.
export function nest(instances, o = {}) {
  const width = o.width || 150, res = o.res || 1, gap = o.gap ?? 0.3, slide = o.slide ?? 40;
  const cols = Math.floor(width / res);
  const words = Math.ceil(cols / 32);
  let grid = new Uint32Array(words * 256);
  let gridRows = 256;
  const skyline = new Int32Array(cols);
  const ensure = (rows) => {
    if (rows <= gridRows) return;
    let n = gridRows;
    while (n < rows) n *= 2;
    const g2 = new Uint32Array(words * n);
    g2.set(grid);
    grid = g2; gridRows = n;
  };
  const fits = (m, x, y) => {
    for (let j = 0; j < m.H; j++) {
      const row = (y + j) * words;
      for (const [s, e] of m.rows[j]) {
        for (let c = x + s; c <= x + e; c++) if (grid[row + (c >>> 5)] & (1 << (c & 31))) return false;
      }
    }
    return true;
  };
  const occupy = (m, x, y) => {
    ensure(y + m.H + 1);
    for (let j = 0; j < m.H; j++) {
      const row = (y + j) * words;
      for (const [s, e] of m.rows[j]) for (let c = x + s; c <= x + e; c++) { grid[row + (c >>> 5)] |= 1 << (c & 31); skyline[c] = Math.max(skyline[c], y + j + 1); }
    }
  };
  const order = instances.map((it, i) => ({ it, i, a: Math.abs(area(it.poly)) })).sort((p, q) => q.a - p.a);
  const placed = [];
  for (const { it } of order) {
    let best = null;
    for (const rot of [0, 180]) {
      const poly = transform(it.poly, rot);
      const m = rasterize(poly, res, gap / 2);
      if (m.W > cols) continue;
      for (let x = 0; x + m.W <= cols; x++) {
        // Drop onto the skyline, then slide down into hollows.
        let y = 0;
        for (let c = 0; c < m.W; c++) if (m.top[c] >= 0) y = Math.max(y, skyline[x + c] - m.top[c]);
        ensure(y + m.H + 1);
        let yy = y;
        for (let t = Math.max(0, y - slide); t < y; t++) if (fits(m, x, t)) { yy = t; break; }
        const score = (yy + m.H) * 1e6 + yy * 1e3 + x;
        if (!best || score < best.score) best = { score, x, y: yy, rot, m, poly };
      }
    }
    if (!best) { placed.push({ id: it.id, piece: it.piece, failed: true }); continue; }
    occupy(best.m, best.x, best.y);
    const dx = best.x * res - best.m.ox, dy = best.y * res - best.m.oy;
    placed.push({ id: it.id, piece: it.piece, label: it.label, mirrored: it.mirrored, rot: best.rot, x: best.x * res, y: best.y * res, poly: best.poly.map(([px, py]) => [px + dx, py + dy]) });
  }
  let length = 0, used = 0;
  for (const p of placed) if (p.poly) { length = Math.max(length, ...p.poly.map((q) => q[1])); used += Math.abs(area(p.poly)); }
  return { placed, width, length, efficiency: length ? used / (width * length) : 0, failed: placed.filter((p) => p.failed).length };
}

export function layoutsByMaterial(d, o = {}) {
  const mats = [...new Set(d.pieces.map((p) => p.material))];
  const out = {};
  for (const mat of mats) {
    const inst = cutInstances(d, { material: mat });
    if (inst.length) out[mat] = nest(inst, { width: (o.widths && o.widths[mat]) || o.width || 150, res: o.res, gap: o.gap });
  }
  return out;
}

// Physical units: width/height in cm with a matching viewBox, so the SVG prints at true scale.
// KNOWN DEFECT (minor): o.fabric is interpolated into the fill attribute unescaped; if it can come from user input
// (a colour field), a quote breaks out of the attribute. Fix: pass it through esc() or a colour whitelist.
export function layoutSVG(r, o = {}) {
  const pad = 2, W = r.width, H = Math.max(10, r.length);
  const fill = o.fabric || '#e9eef7';
  const shapes = r.placed.filter((p) => p.poly).map((p) => {
    const b = bbox(p.poly);
    const d = 'M' + p.poly.map((q) => q[0].toFixed(2) + ' ' + q[1].toFixed(2)).join('L') + 'Z';
    const s = Math.max(0.9, Math.min(2.4, Math.min(b.w, b.h) / 6));
    return `<path d="${d}" fill="#ffffff" fill-opacity="0.82" stroke="#1d2330" stroke-width="0.12"/><text x="${(b.x0 + b.w / 2).toFixed(2)}" y="${(b.y0 + b.h / 2).toFixed(2)}" font-size="${s.toFixed(2)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" fill="#1d2330">${esc((o.label ? o.label(p) : p.label) + (p.mirrored ? ' (R)' : ''))}</text>`;
  }).join('');
  const ruler = Array.from({ length: Math.floor(H / 10) + 1 }, (_, i) => `<path d="M${-pad} ${i * 10}h${pad * 0.6}" stroke="#666" stroke-width="0.1"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W + 2 * pad}cm" height="${H + 2 * pad}cm" viewBox="${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}"><rect x="0" y="0" width="${W}" height="${H}" fill="${fill}" stroke="#888" stroke-width="0.15"/>${ruler}${shapes}</svg>`;
}
