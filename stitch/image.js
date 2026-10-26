// stitch/image.js - chart pictures without a browser: SVG (vector: cells, symbols as <use> of shared paths, letters
// as text, grid with 10-cell lines, row / column numbers, lines, knots, beads) and PNG (a small rasterizer: non-zero
// polygon fill with 4 × 4 supersampling for symbols, lines and circles; letters from the stitch pixel font).
//
//   toSVG(scheme, { cell = 12, mode = 'colorSymbols' | 'symbols' | 'color' | 'tint', grid = true, numbers = true,
//                   layer }) -> SVG text
//   rasterize(scheme, { cell = 10, mode, grid = true, layer, background }) -> { width, height, data: RGBA }
//   toPNG(scheme, opts) -> PNG bytes (png/encode.js)
//   previewRGBA(scheme, { scale = 1, fabric = true, layer }) -> { width, height, data } (one colour block per stitch)
//   fillPolygons(cov, w, h, polys) -> coverage (0..1) of polygons (non-zero rule) accumulated into cov

// Why an own rasterizer: the module must run in Node (export, tests, build) where there is no canvas, and a canvas
// dependency (node-canvas, skia) is a native build. Charts need only polygons, so a scanline filler of ~40 lines is
// enough. Paint order matches render.js and pdf.js (fills, parts, grid, symbols, lines, knots, beads), so the three
// outputs look the same.
// Mode names: 'colorSymbols' = colour cells with contrasting symbols, 'symbols' = black on white, 'color' = no
// symbols, 'tint' = pale colour with black symbols.
import { SYMBOLS, isVector, pathCommands } from './symbols.js';
import { flatten } from './model.js';
import { hexToRgb, rgbToLab } from './threads.js';
import { textBitmap } from './font.js';
import { encodePNG } from '../png/encode.js';

// Text-node / attribute escaping for the four characters that matter in double-quoted XML; titles and letter
// symbols are user text.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lum = (hex) => rgbToLab(hexToRgb(hex))[0];
const tintHex = (hex, k) => '#' + hexToRgb(hex).map((v) => Math.round(v + (255 - v) * k).toString(16).padStart(2, '0')).join('');
const CORNER = { tl: [0, 0], tr: [1, 0], bl: [0, 1], br: [1, 1] };

export function toSVG(scheme, { cell = 12, mode = 'colorSymbols', grid = true, numbers = true, layer = null } = {}) {
  const s = scheme, L = layer || flatten(s);
  const pad = numbers ? cell * 2.2 : 1;
  const W = s.width * cell, H = s.height * cell;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W + 2 * pad}" height="${H + 2 * pad}" viewBox="${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}">`);
  out.push(`<title>${esc(s.meta.title || 'Chart')}</title>`);
  // Each used symbol path is defined once in <defs> and placed with <use>: a 100 x 100 chart would otherwise repeat
  // the same path data thousands of times. href and xlink:href both: SVG 2 readers use the first, older tools
  // (Inkscape 0.x, some print RIPs) only the second.
  const used = new Set(s.palette.map((e) => e.symbol).filter(isVector));
  out.push('<defs>' + [...used].map((id) => `<path id="s-${id}" d="${SYMBOLS[id].d}"/>`).join('') + '</defs>');
  out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${mode === 'color' || mode === 'colorSymbols' ? s.fabric.color : '#ffffff'}"/>`);
  const byColor = new Map();
  if (mode !== 'symbols') {
    for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
      const v = L.cells[y * s.width + x];
      if (!v) continue;
      // Rects are grouped into one <g fill> per colour, so fill is written once per colour, not per rectangle.
      // Runs of one colour in a row become one rectangle.
      let x2 = x;
      while (x2 + 1 < s.width && L.cells[y * s.width + x2 + 1] === v) x2++;
      if (!byColor.has(v)) byColor.set(v, []);
      byColor.get(v).push(`<rect x="${x * cell}" y="${y * cell}" width="${(x2 - x + 1) * cell}" height="${cell}"/>`);
      x = x2;
    }
    for (const [v, rects] of byColor) { const hex = s.palette[v - 1].hex; out.push(`<g fill="${mode === 'tint' ? tintHex(hex, 0.7) : hex}">${rects.join('')}</g>`); }
  }
  for (const p of L.parts) {
    const hex = s.palette[p.p].hex, x = p.x * cell, y = p.y * cell, c = cell;
    const fill = mode === 'symbols' ? '#d8d8d8' : mode === 'tint' ? tintHex(hex, 0.5) : hex;
    if (p.k === 'half') out.push(`<path d="${p.c === '/' ? `M${x} ${y + c}L${x + c} ${y}` : `M${x} ${y}L${x + c} ${y + c}`}" stroke="${fill}" stroke-width="${c * 0.22}"/>`);
    else if (p.k === 'three') {
      const others = { tl: ['tr', 'bl'], tr: ['tl', 'br'], bl: ['tl', 'br'], br: ['tr', 'bl'] }[p.c];
      const pt = (k) => `${x + CORNER[k][0] * c} ${y + CORNER[k][1] * c}`;
      out.push(`<path d="M${pt(p.c)}L${pt(others[0])}L${pt(others[1])}Z" fill="${fill}"/>`);
    } else out.push(`<rect x="${x + CORNER[p.c][0] * c / 2}" y="${y + CORNER[p.c][1] * c / 2}" width="${c / 2}" height="${c / 2}" fill="${fill}"/>`);
  }
  // The whole grid is two <path> elements (thin, thick): thousands of <line> elements make SVG viewers crawl.
  // Thin lines use stroke-opacity so they darken any cell colour instead of covering it with grey.
  if (grid) {
    const thin = [], thick = [];
    for (let x = 0; x <= s.width; x++) (x % 10 ? thin : thick).push(`M${x * cell} 0V${H}`);
    for (let y = 0; y <= s.height; y++) (y % 10 ? thin : thick).push(`M0 ${y * cell}H${W}`);
    out.push(`<path d="${thin.join('')}" stroke="#000" stroke-opacity=".18" stroke-width="${Math.max(0.4, cell / 24)}" fill="none"/>`);
    out.push(`<path d="${thick.join('')}" stroke="#000" stroke-width="${Math.max(0.8, cell / 10)}" fill="none"/>`);
  }
  if (mode !== 'color') {
    // Symbol box = 78 % of the cell, centred (11 % margin on each side), same proportions as PDF and canvas.
    // Ink: lum < 52 (L*) picks white ink, the shared contrast threshold.
    const k = (cell * 0.78) / 100, o = cell * 0.11;
    const sym = (e, x, y, size) => {
      const ink = mode === 'colorSymbols' && lum(e.hex) < 52 ? '#fff' : '#000';
      if (!e.symbol) return '';
      if (isVector(e.symbol)) return `<use href="#s-${e.symbol}" xlink:href="#s-${e.symbol}" transform="translate(${+(x + o * size / cell).toFixed(2)} ${+(y + o * size / cell).toFixed(2)}) scale(${+(k * size / cell).toFixed(4)})" fill="${ink}"/>`;
      return `<text x="${x + size / 2}" y="${y + size * 0.72}" font-size="${size * (e.symbol.length > 1 ? 0.6 : 0.78)}" font-weight="700" font-family="Arial, Helvetica, sans-serif" text-anchor="middle" fill="${ink}">${esc(e.symbol)}</text>`;
    };
    for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) { const v = L.cells[y * s.width + x]; if (v) out.push(sym(s.palette[v - 1], x * cell, y * cell, cell)); }
    for (const p of L.parts) {
      const e = s.palette[p.p];
      const bx = p.k === 'half' ? p.x * cell + cell / 4 : p.x * cell + CORNER[p.c][0] * cell / 2;
      const by = p.k === 'half' ? p.y * cell + cell / 4 : p.y * cell + CORNER[p.c][1] * cell / 2;
      out.push(sym(e, bx, by, cell / 2));
    }
  }
  for (const l of L.lines) {
    const hex = s.palette[l.p].hex;
    out.push(`<path d="M${l.x1 * cell} ${l.y1 * cell}L${l.x2 * cell} ${l.y2 * cell}" stroke="${lum(hex) > 80 ? '#555' : hex}" stroke-width="${cell * (l.k === 'straight' ? 0.14 : 0.2)}" stroke-linecap="round"/>`);
  }
  for (const k of L.knots) out.push(`<circle cx="${k.x * cell}" cy="${k.y * cell}" r="${cell * 0.28}" fill="${s.palette[k.p].hex}" stroke="#222" stroke-width="${cell / 16}"/>`);
  for (const b of L.beads) out.push(`<circle cx="${b.x * cell}" cy="${b.y * cell}" r="${cell * 0.38}" fill="${s.palette[b.p].hex}" stroke="#222" stroke-width="${cell / 14}"/><circle cx="${(b.x - 0.12) * cell}" cy="${(b.y - 0.12) * cell}" r="${cell * 0.08}" fill="#fff"/>`);
  if (numbers) {
    const fs = cell * 0.9;
    for (let x = 10; x <= s.width; x += 10) out.push(`<text x="${x * cell}" y="${-cell * 0.6}" font-size="${fs}" font-family="Arial, sans-serif" text-anchor="middle">${x}</text><text x="${x * cell}" y="${H + cell * 1.5}" font-size="${fs}" font-family="Arial, sans-serif" text-anchor="middle">${x}</text>`);
    for (let y = 10; y <= s.height; y += 10) out.push(`<text x="${-cell * 0.4}" y="${y * cell + fs * 0.35}" font-size="${fs}" font-family="Arial, sans-serif" text-anchor="end">${y}</text><text x="${W + cell * 0.4}" y="${y * cell + fs * 0.35}" font-size="${fs}" font-family="Arial, sans-serif">${y}</text>`);
    out.push(`<path d="M${W / 2 - cell / 2} ${-cell * 2}L${W / 2 + cell / 2} ${-cell * 2}L${W / 2} ${-cell * 1.2}Z" fill="#d42020"/><path d="M${-cell * 2.1} ${H / 2 - cell / 2}L${-cell * 2.1} ${H / 2 + cell / 2}L${-cell * 1.3} ${H / 2}Z" fill="#d42020"/>`);
  }
  out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#000" stroke-width="${Math.max(1, cell / 8)}"/>`);
  out.push('</svg>');
  return out.join('\n');
}

// --- rasterizer ----------------------------------------------------------------------------------------------------

// Polygons (arrays of [x, y] in pixels) filled with the non-zero rule into a coverage buffer (4 × 4 supersampling).
// Scanline polygon fill with exact horizontal coverage and 4 vertical subsamples per pixel row: for each subsample
// line (at its centre, py = (sy + 0.5) / S) the edge crossings are sorted, the winding number is accumulated left to
// right, and every span with non-zero winding adds its exact fractional width / S to the pixels it covers. Cheaper
// than 4 x 4 point sampling (no horizontal subsamples) and smoother on near-vertical edges.
// Horizontal edges are skipped (they never cross a scanline); the half-open test py >= y1 && py < y2 counts a
// shared vertex once. Coverage accumulates into cov (clamped at 1) so several calls can build one mask.
export function fillPolygons(cov, w, h, polys) {
  const S = 4;
  const edges = [];
  let minY = Infinity, maxY = -Infinity;
  for (const p of polys) for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
    if (y1 === y2) continue;
    edges.push(y1 < y2 ? [x1, y1, x2, y2, 1] : [x2, y2, x1, y1, -1]);
    minY = Math.min(minY, y1, y2); maxY = Math.max(maxY, y1, y2);
  }
  const ys = Math.max(0, Math.floor(minY * S)), ye = Math.min(h * S - 1, Math.ceil(maxY * S));
  const xs = [];
  const row = new Float32Array(w + 1);
  let curRow = -1;
  const flush = () => { if (curRow < 0) return; for (let x = 0; x < w; x++) if (row[x]) { cov[curRow * w + x] = Math.min(1, cov[curRow * w + x] + row[x]); row[x] = 0; } };
  for (let sy = ys; sy <= ye; sy++) {
    const py = (sy + 0.5) / S;
    const r = Math.floor(sy / S);
    if (r !== curRow) { flush(); curRow = r; }
    xs.length = 0;
    for (const [x1, y1, x2, y2, d] of edges) if (py >= y1 && py < y2) xs.push([x1 + ((py - y1) * (x2 - x1)) / (y2 - y1), d]);
    xs.sort((a, b) => a[0] - b[0]);
    let wind = 0;
    for (let i = 0; i < xs.length - 1; i++) {
      wind += xs[i][1];
      if (!wind) continue;
      const a = Math.max(0, xs[i][0]), b = Math.min(w, xs[i + 1][0]);
      if (b <= a) continue;
      const ia = Math.floor(a), ib = Math.floor(b);
      if (ia === ib) { row[ia] += (b - a) / S; continue; }
      row[ia] += (ia + 1 - a) / S;
      for (let x = ia + 1; x < ib; x++) row[x] += 1 / S;
      if (ib < w) row[ib] += (b - ib) / S;
    }
  }
  flush();
  return cov;
}

// Path data (M / L / C / Z) to polygons, transformed by (x, y, scale).
// Flattens cubic Beziers into 8 chords each: at symbol sizes of 5..30 px the chord error is far below a pixel.
function pathPolys(d, ox, oy, k) {
  const polys = [];
  let cur = null, px = 0, py = 0;
  for (const [c, ...v] of pathCommands(d)) {
    if (c === 'M') { cur = [[ox + v[0] * k, oy + v[1] * k]]; polys.push(cur); px = v[0]; py = v[1]; }
    else if (c === 'L') { cur.push([ox + v[0] * k, oy + v[1] * k]); px = v[0]; py = v[1]; }
    else if (c === 'C') {
      for (let t = 1; t <= 8; t++) {
        const u = t / 8, a = (1 - u) ** 3, b = 3 * (1 - u) ** 2 * u, cc = 3 * (1 - u) * u * u, e = u ** 3;
        cur.push([ox + (a * px + b * v[0] + cc * v[2] + e * v[4]) * k, oy + (a * py + b * v[1] + cc * v[3] + e * v[5]) * k]);
      }
      px = v[4]; py = v[5];
    }
  }
  return polys;
}
const circlePoly = (cx, cy, r, n = 20) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]);
function barPoly(x1, y1, x2, y2, t) {
  const dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy) || 1, nx = (-dy / l) * t / 2, ny = (dx / l) * t / 2;
  return [[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]];
}

// Output is (width x cell + 1) pixels so the closing grid line has a pixel column of its own.
// blend() is "source over" with coverage as alpha, on 8-bit values (Uint8ClampedArray rounds and clamps).
export function rasterize(scheme, { cell = 10, mode = 'colorSymbols', grid = true, layer = null, background = null } = {}) {
  const s = scheme, L = layer || flatten(s);
  const W = s.width * cell + 1, H = s.height * cell + 1;
  const data = new Uint8ClampedArray(W * H * 4);
  const bg = hexToRgb(background || (mode === 'color' || mode === 'colorSymbols' ? s.fabric.color : '#ffffff'));
  for (let i = 0; i < W * H; i++) { data[i * 4] = bg[0]; data[i * 4 + 1] = bg[1]; data[i * 4 + 2] = bg[2]; data[i * 4 + 3] = 255; }
  const rect = (x, y, w, h, c) => { for (let yy = Math.max(0, y); yy < Math.min(H, y + h); yy++) for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx++) { const i = (yy * W + xx) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; } };
  const blend = (cov, c, x0 = 0, y0 = 0, cw = W, ch = H) => {
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const a = cov[y * cw + x];
      if (!a) continue;
      const px = x0 + x, py = y0 + y;
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      const i = (py * W + px) * 4;
      data[i] += (c[0] - data[i]) * a; data[i + 1] += (c[1] - data[i + 1]) * a; data[i + 2] += (c[2] - data[i + 2]) * a;
    }
  };
  const pal = s.palette.map((e) => hexToRgb(e.hex));
  const tint = (c) => c.map((v) => Math.round(v + (255 - v) * 0.7));
  if (mode !== 'symbols') for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) { const v = L.cells[y * s.width + x]; if (v) rect(x * cell, y * cell, cell, cell, mode === 'tint' ? tint(pal[v - 1]) : pal[v - 1]); }
  for (const p of L.parts) {
    const cov = new Float32Array(cell * cell);
    let poly;
    if (p.k === 'half') poly = p.c === '/' ? barPoly(0, cell, cell, 0, cell * 0.22) : barPoly(0, 0, cell, cell, cell * 0.22);
    else if (p.k === 'three') { const o = { tl: ['tr', 'bl'], tr: ['tl', 'br'], bl: ['tl', 'br'], br: ['tr', 'bl'] }[p.c]; poly = [p.c, ...o].map((k) => [CORNER[k][0] * cell, CORNER[k][1] * cell]); }
    else { const [cx, cy] = CORNER[p.c]; const h2 = cell / 2; poly = [[cx * h2, cy * h2], [cx * h2 + h2, cy * h2], [cx * h2 + h2, cy * h2 + h2], [cx * h2, cy * h2 + h2]]; }
    fillPolygons(cov, cell, cell, [poly]);
    blend(cov, mode === 'symbols' ? [216, 216, 216] : mode === 'tint' ? tint(pal[p.p]) : pal[p.p], p.x * cell, p.y * cell, cell, cell);
  }
  if (grid) {
    // The second loop skips pixels where a vertical line already passed (x % cell === 0) on thin rows, so crossings are
    // not darkened twice.
    // Thin lines darken what is under them; every tenth line is solid.
    const mark = (i, thick) => { if (thick) { data[i] = data[i + 1] = data[i + 2] = 20; } else { data[i] *= 0.74; data[i + 1] *= 0.74; data[i + 2] *= 0.74; } };
    for (let x = 0; x <= s.width; x++) for (let y = 0; y < H; y++) mark((y * W + x * cell) * 4, x % 10 === 0);
    for (let y = 0; y <= s.height; y++) for (let x = 0; x < W; x++) if ((x % cell) || y % 10 === 0) mark((y * cell * W + x) * 4, y % 10 === 0);
  }
  // Symbols: one coverage mask per symbol and size.
  // Below 6 px a symbol is an unreadable blot, so symbols are skipped. Masks are cached per symbol and size: a chart
  // has few symbols but many cells. Letter symbols use the stitch pixel font (not system fonts, which Node lacks),
  // each pixel as a square polygon so the same antialiased filler scales them.
  if (mode !== 'color' && cell >= 6) {
    const masks = new Map();
    const maskOf = (sym, size) => {
      const key = sym + '@' + size;
      if (masks.has(key)) return masks.get(key);
      const cov = new Float32Array(size * size);
      if (isVector(sym)) fillPolygons(cov, size, size, pathPolys(SYMBOLS[sym].d, size * 0.11, size * 0.11, (size * 0.78) / 100));
      else {
        const b = textBitmap(sym, { font: 'pixel' });
        const k = Math.max(0.1, Math.min((size * 0.8) / b.width, (size * 0.8) / b.height));
        const ox = (size - b.width * k) / 2, oy = (size - b.height * k) / 2;
        const polys = [];
        for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) if (b.bits[y * b.width + x]) polys.push([[ox + x * k, oy + y * k], [ox + (x + 1) * k, oy + y * k], [ox + (x + 1) * k, oy + (y + 1) * k], [ox + x * k, oy + (y + 1) * k]]);
        fillPolygons(cov, size, size, polys);
      }
      masks.set(key, cov);
      return cov;
    };
    const ink = (hex) => (mode === 'colorSymbols' && lum(hex) < 52 ? [255, 255, 255] : [0, 0, 0]);
    for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
      const v = L.cells[y * s.width + x];
      if (!v) continue;
      const e = s.palette[v - 1];
      if (e.symbol) blend(maskOf(e.symbol, cell), ink(e.hex), x * cell, y * cell, cell, cell);
    }
    const hc = Math.max(3, Math.floor(cell / 2));
    for (const p of L.parts) {
      const e = s.palette[p.p];
      if (!e.symbol) continue;
      const bx = p.k === 'half' ? p.x * cell + Math.floor(cell / 4) : p.x * cell + CORNER[p.c][0] * hc, by = p.k === 'half' ? p.y * cell + Math.floor(cell / 4) : p.y * cell + CORNER[p.c][1] * hc;
      blend(maskOf(e.symbol, hc), ink(e.hex), bx, by, hc, hc);
    }
  }
  // Lines, knots, beads: polygons filled in a buffer around their bounding box.
  // Coverage buffer only as large as the shape's bounding box, not the whole image: one knot must not cost a
  // full-image allocation. Lines get round caps from two end circles (a bar plus circles under the non-zero rule).
  const paint = (polys, c) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of polys) for (const [x, y] of p) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    x0 = Math.floor(x0); y0 = Math.floor(y0);
    const bw = Math.ceil(x1) - x0 + 1, bh = Math.ceil(y1) - y0 + 1;
    if (bw <= 0 || bh <= 0) return;
    const cov = fillPolygons(new Float32Array(bw * bh), bw, bh, polys.map((p) => p.map(([x, y]) => [x - x0, y - y0])));
    blend(cov, c, x0, y0, bw, bh);
  };
  for (const l of L.lines) {
    const hex = s.palette[l.p].hex, r = Math.max(0.75, cell * 0.1);
    paint([barPoly(l.x1 * cell, l.y1 * cell, l.x2 * cell, l.y2 * cell, 2 * r), circlePoly(l.x1 * cell, l.y1 * cell, r, 8), circlePoly(l.x2 * cell, l.y2 * cell, r, 8)], lum(hex) > 80 ? [85, 85, 85] : hexToRgb(hex));
  }
  for (const k of L.knots) { paint([circlePoly(k.x * cell, k.y * cell, cell * 0.32)], [34, 34, 34]); paint([circlePoly(k.x * cell, k.y * cell, cell * 0.26)], pal[k.p]); }
  for (const b of L.beads) { paint([circlePoly(b.x * cell, b.y * cell, cell * 0.42)], [34, 34, 34]); paint([circlePoly(b.x * cell, b.y * cell, cell * 0.36)], pal[b.p]); paint([circlePoly((b.x - 0.12) * cell, (b.y - 0.12) * cell, cell * 0.08, 8)], [255, 255, 255]); }
  return { width: W, height: H, data };
}

export function toPNG(scheme, opts = {}) {
  return encodePNG(rasterize(scheme, opts));
}

// A picture of the finished piece: `scale` pixels per stitch, fabric colour where nothing is stitched.
// One flat colour per stitch; a cell with only fractional stitches shows the colour of its last part (approximation
// at preview scale, same as the PDF cover).
export function previewRGBA(scheme, { scale = 1, fabric = true, layer = null } = {}) {
  const s = scheme, L = layer || flatten(s);
  const W = s.width * scale, H = s.height * scale;
  const data = new Uint8ClampedArray(W * H * 4);
  const fab = hexToRgb(s.fabric.color);
  const pal = s.palette.map((e) => hexToRgb(e.hex));
  const partColor = new Map();
  for (const p of L.parts) partColor.set(p.y * s.width + p.x, pal[p.p]);
  for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
    const i = y * s.width + x, v = L.cells[i];
    const c = v ? pal[v - 1] : partColor.get(i) || (fabric ? fab : null);
    if (!c) continue;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) { const o = ((y * scale + dy) * W + x * scale + dx) * 4; data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255; }
  }
  return { width: W, height: H, data };
}
