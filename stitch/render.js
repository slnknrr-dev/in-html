// stitch/render.js - drawing a chart on a Canvas 2D context (browsers; nothing runs at import): symbols, colours,
// colours with symbols, pale tints with symbols, and a realistic stitch preview (fabric weave, crossed strands with
// light and shadow, backstitch, knots, glossy beads); grid with 10-cell lines, highlight of one colour (the others
// fade), stitched-cell marks, parking marks, selection, page bounds and the centre. Far zoom levels draw one pixel
// per cell from a cached bitmap.
//
//   drawChart(ctx, scheme, view, opts)
//     view: { x, y (chart cell at the canvas origin, fractional), cell (px per cell), width, height (css px) }
//     opts: { mode: 'symbols' | 'color' | 'colorSymbols' | 'tint' | 'realistic', layer (flattened layer, cached by
//             the caller), grid (default true), highlight (palette index, -1 none), done (Uint8Array per cell),
//             doneParts (Set of part keys), doneStyle: 'fill' | 'cross' | 'fade', parked (Map cell -> palette index),
//             selection { x0, y0, x1, y1 }, pages [page], centre (bool), dark (bool), fabric (hex), ghost (layer to
//             show faintly, e.g. the layers below in the editor), font (letters font family) }
//   cellAt(view, px, py) -> { x, y, fx, fy } (cell and position inside it 0..1)
//   symbolPath(sym) -> Path2D (cached)
//   colorBitmap(scheme, layer) -> canvas with one pixel per cell (cached on the layer object)
//   contrastInk(hex) -> '#000' | '#fff'

// Performance model: drawChart is called on every pan / zoom frame, so it (1) draws only the visible cell range,
// (2) caches everything derived from colours (Path2D per symbol, L* per hex, fabric pattern, far-zoom bitmap),
// (3) switches to a one-pixel-per-cell bitmap below 5 px per cell, where per-cell fillRect calls would cost
// millions of draw calls for no visible detail, and (4) skips symbols below 7 px and the grid below 4 px.
// The module is stateless apart from those caches; the caller owns the view and passes the flattened layer (and is
// expected to cache it, flatten is O(cells)).
// Highlight = de-emphasise everything else rather than outline the chosen colour: on a dense chart an outline is
// lost, a faded background is not.
import { SYMBOLS, isVector } from './symbols.js';
import { hexToRgb, rgbToLab } from './threads.js';

// Path2D parses the SVG path string once; re-parsing per cell per frame would dominate the frame time.
const PATHS = new Map();
export function symbolPath(sym) {
  let p = PATHS.get(sym);
  if (!p) { p = new Path2D(SYMBOLS[sym].d); PATHS.set(sym, p); }
  return p;
}

// L* per hex string, memoised: contrastInk is asked for every visible cell on every frame.
const LUM = new Map();
const lumOf = (hex) => { let l = LUM.get(hex); if (l == null) { l = rgbToLab(hexToRgb(hex))[0]; LUM.set(hex, l); } return l; };
export const contrastInk = (hex) => (lumOf(hex) < 52 ? '#ffffff' : '#000000');
const tint = (hex, k) => { const c = hexToRgb(hex); return `rgb(${c.map((v) => Math.round(v + (255 - v) * k)).join(',')})`; };
const shade = (hex, k) => { const c = hexToRgb(hex); return `rgb(${c.map((v) => Math.round(v * (1 - k))).join(',')})`; };

// Inverse of X / Y: canvas px -> chart cell plus the position inside it (fx, fy in 0..1, used to pick the corner or
// diagonal of a fractional stitch) and the fractional grid position (gx, gy, used to snap lines to half cells).
export function cellAt(view, px, py) {
  const fx = view.x + px / view.cell, fy = view.y + py / view.cell;
  const x = Math.floor(fx), y = Math.floor(fy);
  return { x, y, fx: fx - x, fy: fy - y, gx: fx, gy: fy };
}

// One pixel per cell, cached on the layer object until its `rev` changes.
// Cache key = everything that changes pixels: layer revision, highlight, done revision, fabric and the palette hexes
// (a colour edit without a layer change must still invalidate). Stored as expando properties on the layer object,
// so the cache dies with the layer and needs no eviction policy. OffscreenCanvas where available, so the bitmap
// does not touch the DOM; a detached <canvas> otherwise.
// Parts are drawn at alpha 200: a partly stitched cell reads lighter than a full cross at a glance.
export function colorBitmap(scheme, layer, { highlight = -1, done = null, fabric = null } = {}) {
  const key = `${layer.rev || 0}|${highlight}|${done ? done.rev || 0 : ''}|${fabric || ''}|${scheme.palette.map((e) => e.hex).join('')}`;
  if (layer.__bmp && layer.__bmpKey === key) return layer.__bmp;
  const W = scheme.width, H = scheme.height;
  const c = layer.__bmp || (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H }));
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const pal = scheme.palette.map((e) => hexToRgb(e.hex));
  const fab = fabric ? hexToRgb(fabric) : null;
  const cells = layer.cells;
  for (let i = 0; i < W * H; i++) {
    const v = cells[i];
    let col = v ? pal[v - 1] : fab;
    if (!col) continue;
    if (highlight >= 0 && v && v - 1 !== highlight) col = col.map((x) => Math.round(x * 0.25 + 220 * 0.75));
    if (done && done[i] && v) col = col.map((x) => Math.round(x * 0.45 + 255 * 0.55));
    img.data[i * 4] = col[0]; img.data[i * 4 + 1] = col[1]; img.data[i * 4 + 2] = col[2]; img.data[i * 4 + 3] = 255;
  }
  for (const p of layer.parts) {
    const i = p.y * W + p.x, col = pal[p.p];
    if (cells[i]) continue;
    img.data[i * 4] = col[0]; img.data[i * 4 + 1] = col[1]; img.data[i * 4 + 2] = col[2]; img.data[i * 4 + 3] = 200;
  }
  g.putImageData(img, 0, 0);
  layer.__bmp = c;
  layer.__bmpKey = key;
  return c;
}

const CORNER = { tl: [0, 0], tr: [1, 0], bl: [0, 1], br: [1, 1] };

// Same geometry as SVG and PDF (78 % box, 11 % margin). Letter symbols use the system font with fillText's maxWidth
// (95 % of the cell), so two-letter codes are condensed instead of overflowing into neighbours.
function drawSymbol(ctx, sym, x, y, size, ink, font) {
  if (!sym) return;
  if (isVector(sym)) {
    const k = (size * 0.78) / 100, o = size * 0.11;
    ctx.save();
    ctx.translate(x + o, y + o);
    ctx.scale(k, k);
    ctx.fillStyle = ink;
    ctx.fill(symbolPath(sym));
    ctx.restore();
  } else {
    const fs = size * (sym.length > 1 ? 0.6 : 0.78);
    ctx.fillStyle = ink;
    ctx.font = `700 ${fs}px ${font || 'Arial, Helvetica, sans-serif'}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sym, x + size / 2, y + size / 2 + fs * 0.04, size * 0.95);
  }
}

// A thread leg from (x1, y1) to (x2, y2) with a realistic look: dark edge, colour body, light twist highlights.
// Three passes: dark full-width stroke (edge / shadow), colour stroke at 72 % (body), then short light dashes across
// the strand every ~0.7 w (twist highlights). Skipped below 5 px, where the dashes would only add noise.
function strand(ctx, x1, y1, x2, y2, w, hex) {
  ctx.lineCap = 'round';
  ctx.strokeStyle = shade(hex, 0.35);
  ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.strokeStyle = hex;
  ctx.lineWidth = w * 0.72;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  // Twist: short light dashes across the strand.
  if (w > 5) {
    ctx.save();
    ctx.strokeStyle = tint(hex, 0.45);
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(1, w * 0.16);
    const len = Math.hypot(x2 - x1, y2 - y1), n = Math.max(2, Math.round(len / (w * 0.7)));
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len, nx = -uy * w * 0.28, ny = ux * w * 0.28;
    ctx.beginPath();
    for (let i = 1; i < n; i++) {
      const cx = x1 + ((x2 - x1) * i) / n, cy = y1 + ((y2 - y1) * i) / n;
      ctx.moveTo(cx - nx - ux * w * 0.15, cy - ny - uy * w * 0.15);
      ctx.lineTo(cx + nx + ux * w * 0.15, cy + ny + uy * w * 0.15);
    }
    ctx.stroke();
    ctx.restore();
  }
}

// One cached CanvasPattern (keyed by cell size and colour, stored on the function object): an Aida block with a
// darker hole at the corner, rebuilt only on zoom or fabric change.
function fabricPattern(ctx, cell, hex, dark) {
  const key = cell + hex;
  if (fabricPattern.key === key) return fabricPattern.pat;
  const s = Math.max(4, Math.round(cell));
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(s, s) : Object.assign(document.createElement('canvas'), { width: s, height: s });
  const g = c.getContext('2d');
  g.fillStyle = hex;
  g.fillRect(0, 0, s, s);
  // Aida: blocks of threads with holes at the corners.
  g.fillStyle = shade(hex, dark ? 0.25 : 0.12);
  g.fillRect(0, 0, s, Math.max(1, s * 0.12));
  g.fillRect(0, 0, Math.max(1, s * 0.12), s);
  g.fillStyle = shade(hex, 0.45);
  const h = Math.max(1, s * 0.16);
  g.fillRect(0, 0, h, h);
  g.fillStyle = tint(hex, 0.35);
  g.fillRect(s * 0.3, s * 0.3, s * 0.4, Math.max(1, s * 0.08));
  fabricPattern.key = key;
  fabricPattern.pat = ctx.createPattern(c, 'repeat');
  return fabricPattern.pat;
}

export function drawChart(ctx, scheme, view, opts = {}) {
  const { width, height, cell } = view;
  const layer = opts.layer;
  const mode = opts.mode || 'colorSymbols';
  const W = scheme.width, H = scheme.height;
  const dark = !!opts.dark;
  const pal = scheme.palette;
  const hl = opts.highlight ?? -1;
  const done = opts.done || null;
  const fabric = opts.fabric || scheme.fabric.color || '#ffffff';
  const bg = mode === 'realistic' ? fabric : mode === 'symbols' || mode === 'tint' ? (dark ? '#1d1f23' : '#ffffff') : dark ? '#1d1f23' : '#ffffff';
  ctx.save();
  ctx.fillStyle = dark ? '#121316' : '#e9e7e2';
  ctx.fillRect(0, 0, width, height);
  // Visible cell range.
  const x0 = Math.max(0, Math.floor(view.x)), y0 = Math.max(0, Math.floor(view.y));
  const x1 = Math.min(W, Math.ceil(view.x + width / cell)), y1 = Math.min(H, Math.ceil(view.y + height / cell));
  const X = (x) => (x - view.x) * cell, Y = (y) => (y - view.y) * cell;
  // Chart background (fabric / paper).
  ctx.fillStyle = mode === 'realistic' ? fabricPattern(ctx, cell, fabric, dark) : bg;
  // The pattern is anchored at the chart origin (translate) so the weave scrolls with the chart instead of sliding
  // under it.
  // KNOWN DEFECT: the rectangle starts at max(0, -X(0)) but its width is min(W * cell, width) regardless of that
  // start, so when the chart is scrolled left (X(0) < 0) and its right edge is visible, the fabric extends past the
  // chart edge by up to -X(0) pixels (same for height). Fix: width = min(W * cell - start, width), likewise height.
  if (mode === 'realistic') {
    ctx.save();
    ctx.translate(X(0), Y(0));
    ctx.fillRect(Math.max(0, -X(0)), Math.max(0, -Y(0)), Math.min(W * cell, width), Math.min(H * cell, height));
    ctx.restore();
  } else ctx.fillRect(X(0), Y(0), W * cell, H * cell);
  if (x1 <= x0 || y1 <= y0 || !layer) { ctx.restore(); return; }
  const cells = layer.cells;
  const far = cell < 5;
  // Ghost (layers below the edited one).
  if (opts.ghost && !far) {
    ctx.globalAlpha = 0.18;
    const gc = opts.ghost.cells;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const v = gc[y * W + x]; if (v) { ctx.fillStyle = pal[v - 1].hex; ctx.fillRect(X(x), Y(y), cell, cell); } }
    ctx.globalAlpha = 1;
  }
  // Far zoom: smoothing is disabled while magnifying (cell >= 1) so cells stay crisp squares, and enabled when
  // minifying (cell < 1) so the browser averages cells instead of dropping them (aliasing). Note: the fabric argument
  // evaluates to null in both branches, so empty cells stay transparent in every mode.
  if (far && mode !== 'realistic') {
    // Bitmap: one pixel per cell, scaled without smoothing.
    const bmp = colorBitmap(scheme, layer, { highlight: hl, done, fabric: mode === 'symbols' ? null : null });
    ctx.imageSmoothingEnabled = cell < 1;
    ctx.drawImage(bmp, 0, 0, W, H, X(0), Y(0), W * cell, H * cell);
    ctx.imageSmoothingEnabled = true;
  } else if (mode === 'realistic') {
    // Realistic mode: each cross is two strands, bottom leg '/' first, top leg '\' second, matching the usual stitching
    // order, so the top leg's highlight overlaps the bottom one as on real fabric.
    const w = Math.max(1.2, cell * 0.36);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const v = cells[y * W + x];
      if (!v) continue;
      const hex = pal[v - 1].hex;
      ctx.globalAlpha = hl >= 0 && v - 1 !== hl ? 0.22 : done && done[y * W + x] ? 0.55 : 1;
      const m = cell * 0.16, px = X(x), py = Y(y);
      strand(ctx, px + m, py + cell - m, px + cell - m, py + m, w, hex); // bottom leg "/"
      strand(ctx, px + m, py + m, px + cell - m, py + cell - m, w, hex); // top leg "\"
    }
    ctx.globalAlpha = 1;
    for (const p of layer.parts) {
      if (p.x < x0 || p.x >= x1 || p.y < y0 || p.y >= y1) continue;
      const hex = pal[p.p].hex, px = X(p.x), py = Y(p.y), m = cell * 0.16;
      ctx.globalAlpha = hl >= 0 && p.p !== hl ? 0.22 : 1;
      if (p.k === 'half') { if (p.c === '/') strand(ctx, px + m, py + cell - m, px + cell - m, py + m, w, hex); else strand(ctx, px + m, py + m, px + cell - m, py + cell - m, w, hex); }
      else {
        const [cx, cy] = CORNER[p.c];
        const ex = px + cell / 2, ey = py + cell / 2;
        const sx = px + (cx ? cell - m : m), sy = py + (cy ? cell - m : m);
        if (p.k === 'three') {
          const diag = p.c === 'tl' || p.c === 'br' ? '/' : '\\';
          if (diag === '/') strand(ctx, px + m, py + cell - m, px + cell - m, py + m, w, hex); else strand(ctx, px + m, py + m, px + cell - m, py + cell - m, w, hex);
          strand(ctx, sx, sy, ex, ey, w, hex);
        } else if (p.k === 'quarter') strand(ctx, sx, sy, ex, ey, w, hex);
        else {
          const qx = px + cx * cell / 2, qy = py + cy * cell / 2, q = cell / 2, mm = q * 0.18;
          strand(ctx, qx + mm, qy + q - mm, qx + q - mm, qy + mm, w * 0.6, hex);
          strand(ctx, qx + mm, qy + mm, qx + q - mm, qy + q - mm, w * 0.6, hex);
        }
      }
    }
    ctx.globalAlpha = 1;
  } else {
    // Cell fills.
    if (mode !== 'symbols') {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const v = cells[y * W + x];
        if (!v) continue;
        const hex = pal[v - 1].hex;
        ctx.fillStyle = mode === 'tint' ? tint(hex, 0.7) : hex;
        if (hl >= 0 && v - 1 !== hl) ctx.fillStyle = dark ? '#2a2c31' : mode === 'tint' ? '#f4f3f0' : tint(hex, 0.82);
        // +0.5 px overdraw: at fractional cell sizes adjacent rects would leave antialiased hairline seams otherwise.
        ctx.fillRect(X(x), Y(y), cell + 0.5, cell + 0.5);
      }
    } else if (hl >= 0) {
      ctx.fillStyle = dark ? 'rgba(255,214,0,.22)' : 'rgba(255,214,0,.35)';
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (cells[y * W + x] - 1 === hl) ctx.fillRect(X(x), Y(y), cell, cell);
    }
    // Part stitches as shapes.
    for (const p of layer.parts) {
      if (p.x < x0 || p.x >= x1 || p.y < y0 || p.y >= y1) continue;
      const hex = pal[p.p].hex, px = X(p.x), py = Y(p.y);
      ctx.fillStyle = mode === 'symbols' ? (dark ? '#3a3d44' : '#d8d8d8') : mode === 'tint' ? tint(hex, 0.5) : hex;
      if (hl >= 0 && p.p !== hl) ctx.globalAlpha = 0.25;
      ctx.beginPath();
      if (p.k === 'half') {
        ctx.lineWidth = Math.max(1, cell * 0.22);
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineCap = 'butt';
        if (p.c === '/') { ctx.moveTo(px, py + cell); ctx.lineTo(px + cell, py); } else { ctx.moveTo(px, py); ctx.lineTo(px + cell, py + cell); }
        ctx.stroke();
      } else if (p.k === 'three') {
        const others = { tl: ['tr', 'bl'], tr: ['tl', 'br'], bl: ['tl', 'br'], br: ['tr', 'bl'] }[p.c];
        const pt = (c) => [px + CORNER[c][0] * cell, py + CORNER[c][1] * cell];
        ctx.moveTo(...pt(p.c)); ctx.lineTo(...pt(others[0])); ctx.lineTo(...pt(others[1])); ctx.closePath();
        ctx.fill();
      } else {
        const [cx, cy] = CORNER[p.c];
        ctx.rect(px + cx * cell / 2, py + cy * cell / 2, cell / 2, cell / 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // Symbols.
    const withSymbols = mode === 'symbols' || mode === 'colorSymbols' || mode === 'tint';
    if (withSymbols && cell >= 7) {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const v = cells[y * W + x];
        if (!v) continue;
        const e = pal[v - 1];
        let ink = mode === 'colorSymbols' ? contrastInk(e.hex) : dark ? '#e8e8e8' : '#111111';
        if (hl >= 0 && v - 1 !== hl) ink = dark ? '#555' : '#b9b9b9';
        drawSymbol(ctx, e.symbol, X(x), Y(y), cell, ink, opts.font);
      }
      for (const p of layer.parts) {
        if (p.x < x0 || p.x >= x1 || p.y < y0 || p.y >= y1) continue;
        const e = pal[p.p];
        const half = cell / 2;
        let bx = X(p.x) + cell / 4, by = Y(p.y) + cell / 4;
        if (p.k !== 'half') { const [cx, cy] = CORNER[p.c]; bx = X(p.x) + cx * half; by = Y(p.y) + cy * half; }
        drawSymbol(ctx, e.symbol, bx, by, half, mode === 'colorSymbols' ? contrastInk(e.hex) : dark ? '#e8e8e8' : '#111', opts.font);
      }
    }
  }
  // Stitched marks.
  if (done && !far) {
    const style = opts.doneStyle || 'cross';
    ctx.save();
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * W + x;
      if (!done[i] || !cells[i]) continue;
      const px = X(x), py = Y(y);
      if (style === 'fill' || mode === 'realistic') { ctx.fillStyle = dark ? 'rgba(20,20,20,.55)' : 'rgba(255,255,255,.62)'; ctx.fillRect(px, py, cell, cell); }
      if (style === 'cross' && mode !== 'realistic') {
        ctx.strokeStyle = dark ? 'rgba(255,255,255,.75)' : 'rgba(10,10,10,.6)';
        ctx.lineWidth = Math.max(1, cell * 0.08);
        ctx.beginPath(); ctx.moveTo(px + 1, py + 1); ctx.lineTo(px + cell - 1, py + cell - 1); ctx.moveTo(px + cell - 1, py + 1); ctx.lineTo(px + 1, py + cell - 1); ctx.stroke();
      }
      if (style === 'fade' && mode !== 'realistic') { ctx.fillStyle = dark ? 'rgba(0,0,0,.6)' : 'rgba(255,255,255,.75)'; ctx.fillRect(px, py, cell, cell); }
    }
    ctx.restore();
  }
  // Grid.
  // Lines snapped to pixel centres (round + 0.5) so 1 px lines are crisp instead of 2 px blurred. Thin lines skip
  // every tenth position (drawn thick afterwards), avoiding a double stroke. One path per weight = two stroke() calls.
  if (opts.grid !== false && cell >= 4) {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = mode === 'realistic' ? 'rgba(0,0,0,.08)' : dark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.16)';
    ctx.beginPath();
    for (let x = x0; x <= x1; x++) if (x % 10) { const px = Math.round(X(x)) + 0.5; ctx.moveTo(px, Y(y0)); ctx.lineTo(px, Y(y1)); }
    for (let y = y0; y <= y1; y++) if (y % 10) { const py = Math.round(Y(y)) + 0.5; ctx.moveTo(X(x0), py); ctx.lineTo(X(x1), py); }
    ctx.stroke();
    ctx.strokeStyle = mode === 'realistic' ? 'rgba(0,0,0,.22)' : dark ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.7)';
    ctx.lineWidth = cell >= 10 ? 1.6 : 1;
    ctx.beginPath();
    for (let x = Math.ceil(x0 / 10) * 10; x <= x1; x += 10) { const px = Math.round(X(x)) + 0.5; ctx.moveTo(px, Y(y0)); ctx.lineTo(px, Y(y1)); }
    for (let y = Math.ceil(y0 / 10) * 10; y <= y1; y += 10) { const py = Math.round(Y(y)) + 0.5; ctx.moveTo(X(x0), py); ctx.lineTo(X(x1), py); }
    ctx.stroke();
    ctx.restore();
  }
  // Lines, knots, beads.
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const l of layer.lines) {
    const e = pal[l.p];
    const hex = e.hex;
    ctx.globalAlpha = hl >= 0 && l.p !== hl ? 0.25 : 1;
    if (mode === 'realistic') strand(ctx, X(l.x1), Y(l.y1), X(l.x2), Y(l.y2), Math.max(1.5, cell * 0.2), hex);
    else {
      ctx.strokeStyle = lumOf(hex) > 80 ? (dark ? '#ddd' : '#555') : hex;
      ctx.lineWidth = Math.max(1.5, cell * (l.k === 'straight' ? 0.14 : 0.2));
      ctx.beginPath(); ctx.moveTo(X(l.x1), Y(l.y1)); ctx.lineTo(X(l.x2), Y(l.y2)); ctx.stroke();
    }
  }
  for (const k of layer.knots) {
    const hex = pal[k.p].hex, r = Math.max(2, cell * 0.28);
    ctx.globalAlpha = hl >= 0 && k.p !== hl ? 0.25 : 1;
    if (mode === 'realistic') {
      const g = ctx.createRadialGradient(X(k.x) - r * 0.3, Y(k.y) - r * 0.3, r * 0.1, X(k.x), Y(k.y), r);
      g.addColorStop(0, tint(hex, 0.4)); g.addColorStop(1, shade(hex, 0.4));
      ctx.fillStyle = g;
    } else ctx.fillStyle = hex;
    ctx.beginPath(); ctx.arc(X(k.x), Y(k.y), r, 0, Math.PI * 2); ctx.fill();
    if (mode !== 'realistic') { ctx.lineWidth = 1; ctx.strokeStyle = dark ? '#eee' : '#222'; ctx.stroke(); }
  }
  for (const b of layer.beads) {
    const hex = pal[b.p].hex, r = Math.max(2.5, cell * 0.38);
    ctx.globalAlpha = hl >= 0 && b.p !== hl ? 0.25 : 1;
    const g = ctx.createRadialGradient(X(b.x) - r * 0.35, Y(b.y) - r * 0.35, r * 0.05, X(b.x), Y(b.y), r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.25, tint(hex, 0.3)); g.addColorStop(1, shade(hex, 0.45));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(X(b.x), Y(b.y), r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = shade(hex, 0.6); ctx.stroke();
  }
  ctx.restore();
  // Parking marks: a small coloured flag in the corner of a cell.
  // Parking (a stitching method): a thread left at a cell to continue later; the flag shows its colour in the corner.
  if (opts.parked && opts.parked.size && cell >= 6) {
    for (const [i, p] of opts.parked) {
      const x = i % W, y = (i / W) | 0;
      if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
      const px = X(x), py = Y(y), s = cell * 0.45;
      ctx.fillStyle = pal[p] ? pal[p].hex : '#e11';
      ctx.strokeStyle = dark ? '#fff' : '#000';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px + cell, py); ctx.lineTo(px + cell, py + s); ctx.lineTo(px + cell - s, py); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }
  // Page bounds.
  if (opts.pages && opts.pages.length > 1) {
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = 'rgba(220,30,30,.8)';
    ctx.lineWidth = 2;
    for (const p of opts.pages) ctx.strokeRect(X(p.x0) + 1, Y(p.y0) + 1, (p.x1 - p.x0) * cell - 2, (p.y1 - p.y0) * cell - 2);
    ctx.restore();
  }
  // Centre lines.
  if (opts.centre) {
    ctx.save();
    ctx.strokeStyle = 'rgba(220,30,30,.85)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(X(W / 2), Y(0)); ctx.lineTo(X(W / 2), Y(H));
    ctx.moveTo(X(0), Y(H / 2)); ctx.lineTo(X(W), Y(H / 2));
    ctx.stroke();
    ctx.restore();
  }
  // Selection.
  if (opts.selection) {
    const s = opts.selection;
    ctx.save();
    ctx.fillStyle = 'rgba(30,120,255,.12)';
    ctx.fillRect(X(s.x0), Y(s.y0), (s.x1 - s.x0) * cell, (s.y1 - s.y0) * cell);
    ctx.setLineDash([5, 4]);
    ctx.lineDashOffset = opts.ants || 0;
    ctx.strokeStyle = '#1e78ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(X(s.x0), Y(s.y0), (s.x1 - s.x0) * cell, (s.y1 - s.y0) * cell);
    ctx.restore();
  }
  // Chart border.
  ctx.strokeStyle = dark ? 'rgba(255,255,255,.6)' : 'rgba(0,0,0,.65)';
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(X(0)) + 0.5, Math.round(Y(0)) + 0.5, W * cell, H * cell);
  ctx.restore();
}

// Rulers: numbers every 10 (or 5 when zoomed in) along the top and left edges of the visible area.
// Label step adapts to zoom so labels never collide (5 when cells are large, up to 50 when tiny). The top-left
// square is painted last to cover where the two rulers overlap.
export function drawRulers(ctx, scheme, view, { size = 22, dark = false, cursor = null } = {}) {
  const { width, height, cell } = view;
  ctx.save();
  ctx.fillStyle = dark ? '#1a1b1f' : '#f4f3ef';
  ctx.fillRect(0, 0, width, size);
  ctx.fillRect(0, 0, size, height);
  ctx.fillStyle = dark ? '#cfd2d8' : '#333';
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const step = cell >= 14 ? 5 : cell >= 3 ? 10 : cell >= 1.5 ? 20 : 50;
  const X = (x) => (x - view.x) * cell, Y = (y) => (y - view.y) * cell;
  for (let x = Math.ceil(view.x / step) * step; x <= Math.min(scheme.width, view.x + width / cell); x += step) {
    const px = X(x);
    if (px < size) continue;
    ctx.fillRect(px - 0.5, size - (x % 10 ? 4 : 7), 1, x % 10 ? 4 : 7);
    if (x % 10 === 0 || step === 5) ctx.fillText(String(x), px, size / 2 - 1);
  }
  ctx.save();
  for (let y = Math.ceil(view.y / step) * step; y <= Math.min(scheme.height, view.y + height / cell); y += step) {
    const py = Y(y);
    if (py < size) continue;
    ctx.fillRect(size - (y % 10 ? 4 : 7), py - 0.5, y % 10 ? 4 : 7, 1);
    if (y % 10 === 0 || step === 5) { ctx.save(); ctx.translate(size / 2 - 1, py); ctx.rotate(-Math.PI / 2); ctx.fillText(String(y), 0, 0); ctx.restore(); }
  }
  ctx.restore();
  // Cursor position marks.
  if (cursor) {
    ctx.fillStyle = 'rgba(30,120,255,.35)';
    ctx.fillRect(X(cursor.x), 0, cell, size);
    ctx.fillRect(0, Y(cursor.y), size, cell);
  }
  // Centre marks.
  ctx.fillStyle = '#d42020';
  const cx = X(scheme.width / 2), cy = Y(scheme.height / 2);
  if (cx > size) { ctx.beginPath(); ctx.moveTo(cx - 5, 0); ctx.lineTo(cx + 5, 0); ctx.lineTo(cx, 7); ctx.fill(); }
  if (cy > size) { ctx.beginPath(); ctx.moveTo(0, cy - 5); ctx.lineTo(0, cy + 5); ctx.lineTo(7, cy); ctx.fill(); }
  ctx.fillStyle = dark ? '#1a1b1f' : '#f4f3ef';
  ctx.fillRect(0, 0, size, size);
  ctx.restore();
}
