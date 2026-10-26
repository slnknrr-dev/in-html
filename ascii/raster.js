// ascii/raster.js - draws a character grid on a 2D canvas context (PNG export): monospace glyphs, crisp block
// elements and round braille dots. The context is passed in, so the module itself never touches the DOM.
import { BRAILLE_BASE, BRAILLE_BITS, FULL_BLOCK, HALF_LOWER, HALF_UPPER } from './ramps.js';
import { hex } from './palette.js';
import { MONO_STACK, inkColors } from './writers.js';

const BLOCKS = { [HALF_UPPER]: [0, 0.5], [HALF_LOWER]: [0.5, 0.5], [FULL_BLOCK]: [0, 1] };

/**
 * Pixel size of a grid drawn with `cell` px glyphs: { width, height, cw, ch, pad }.
 *   cell (font size px), charWidth (em, 0.6), aspect (cell height ÷ width), padding (px)
 */
export function rasterSize(grid, { cell = 14, charWidth = 0.6, aspect, padding = 16 } = {}) {
  const cw = cell * charWidth, ch = cw * (aspect || grid.aspect || 2);
  return { width: Math.ceil(grid.cols * cw + 2 * padding), height: Math.ceil(grid.rows * ch + 2 * padding), cw, ch, pad: padding };
}

/**
 * Draws `grid` on `ctx` (whose canvas should have rasterSize() dimensions). Options: cell, charWidth, aspect,
 * padding, background, foreground, fontFamily. Returns the geometry used.
 */
// Block elements and braille are drawn as geometry, not text: font glyphs for these characters vary between fonts
// and leave gaps or overlaps between cells, while rects and arcs tile exactly. fillStyle is changed only when the
// colour changes, since canvas state changes are a measurable cost per glyph.
export function drawGrid(ctx, grid, opts = {}) {
  const ink = inkColors(grid.ink);
  const bgc = opts.background || ink.background, fgc = opts.foreground || ink.foreground;
  const geo = rasterSize(grid, opts);
  const { cw, ch, pad } = geo;
  const { cols, rows, codes, fg, bg } = grid;
  const cell = opts.cell || 14;
  ctx.fillStyle = bgc;
  ctx.fillRect(0, 0, geo.width, geo.height);
  if (bg) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols;) {
        const i = r * cols + c, col = hex(bg[i * 3], bg[i * 3 + 1], bg[i * 3 + 2]);
        let e = c + 1;
        while (e < cols && bg[(r * cols + e) * 3] === bg[i * 3] && bg[(r * cols + e) * 3 + 1] === bg[i * 3 + 1] && bg[(r * cols + e) * 3 + 2] === bg[i * 3 + 2]) e++;
        ctx.fillStyle = col;
        // Pixel-snapped edges: neighbouring runs meet without hairline seams.
        const x0 = Math.round(pad + c * cw), x1 = Math.round(pad + e * cw);
        ctx.fillRect(x0, Math.round(pad + r * ch), x1 - x0, Math.round(pad + (r + 1) * ch) - Math.round(pad + r * ch));
        c = e;
      }
    }
  }
  ctx.font = `${cell}px ${opts.fontFamily || MONO_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const dotR = Math.max(0.5, Math.min(cw / 2, ch / 4) * 0.36);
  let cur = null;
  for (let r = 0; r < rows; r++) {
    const y0 = pad + r * ch;
    for (let c = 0, i = r * cols; c < cols; c++, i++) {
      const cp = codes[i];
      if (cp === 32 || cp === BRAILLE_BASE) continue;
      const col = fg ? hex(fg[i * 3], fg[i * 3 + 1], fg[i * 3 + 2]) : fgc;
      if (col !== cur) { ctx.fillStyle = col; cur = col; }
      const x0 = pad + c * cw;
      const blk = BLOCKS[cp];
      if (blk) {
        const xa = Math.round(x0), xb = Math.round(x0 + cw);
        const ya = Math.round(y0 + blk[0] * ch), yb = Math.round(y0 + (blk[0] + blk[1]) * ch);
        ctx.fillRect(xa, ya, xb - xa, yb - ya);
      } else if (cp > BRAILLE_BASE && cp <= BRAILLE_BASE + 0xff) {
        const bits = cp - BRAILLE_BASE;
        ctx.beginPath();
        for (let k = 0; k < 8; k++) {
          if (!(bits & BRAILLE_BITS[k])) continue;
          const dx = k & 1, dy = k >> 1;
          const x = x0 + (dx + 0.5) * (cw / 2), y = y0 + (dy + 0.5) * (ch / 4);
          ctx.moveTo(x + dotR, y);
          ctx.arc(x, y, dotR, 0, Math.PI * 2);
        }
        ctx.fill();
      } else ctx.fillText(String.fromCodePoint(cp), x0 + cw / 2, y0 + ch / 2);
    }
  }
  return geo;
}
