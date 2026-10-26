// ascii/writers.js - output of a character grid (convert.js): plain text, ANSI escapes, HTML fragment and page, SVG.
//
// Every writer merges runs of equal colour into one span / tspan / escape: per-character markup would multiply output
// size by ten and make terminals and browsers slow on large grids.
import { FULL_BLOCK, HALF_LOWER, HALF_UPPER } from './ramps.js';
import { hex, nearest16, nearest256 } from './palette.js';

// Monospace font stack of the HTML / SVG output (fonts with block elements and braille first).
export const MONO_STACK = '"Cascadia Mono", "Cascadia Code", "DejaVu Sans Mono", Consolas, "SF Mono", Menlo, "Liberation Mono", "Courier New", monospace';

// Default colours for a grid's ink: light glyphs on a dark screen or dark glyphs on paper.
export function inkColors(ink) {
  return ink === 'dark' ? { background: '#f7f3ea', foreground: '#1f1b16' } : { background: '#0b0f14', foreground: '#dbe4ef' };
}

const ESC = '\x1b[';
const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escText = (s) => String(s).replace(/[&<>]/g, (c) => HTML_ESC[c]);
const escAttr = (s) => String(s).replace(/[&<>"]/g, (c) => HTML_ESC[c]);
const ch = (cp) => String.fromCodePoint(cp);
const fmt = (v) => String(Math.round(v * 100) / 100);
const hexAt = (rgb, i) => hex(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);

// Plain text: one line per row, every line ends with `eol`.
export function toText(grid, { eol = '\n' } = {}) {
  return grid.chars.map((r) => r + eol).join('');
}

// ---------------------------------------------------------------------------------------------
// ANSI

function ansiMode(mode, grid) {
  if (mode === 16 || mode === '16' || mode === 'ansi16') return 16;
  if (mode === 256 || mode === '256' || mode === 'ansi256') return 256;
  if (mode === 'truecolor' || mode === 24 || mode === 'html') return 24;
  if (mode === 'mono') return 0;
  return grid.color === 'ansi16' ? 16 : grid.color === 'ansi256' ? 256 : grid.color === 'mono' ? 0 : 24;
}

// Palette indices of an RGB array for a mode (the grid's own when it was quantised to that palette).
function indices(grid, which, mode) {
  const own = which === 'fg' ? grid.fgIdx : grid.bgIdx;
  if (own && grid.palette === (mode === 16 ? 'ansi16' : 'ansi256')) return own;
  const rgb = grid[which], n = rgb.length / 3, out = new Uint8Array(n);
  const near = mode === 16 ? nearest16 : nearest256;
  for (let i = 0; i < n; i++) out[i] = near(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
  return out;
}

function sgrPart(mode, rgb, idx, i, bg) {
  if (mode === 24) return `${bg ? 48 : 38};2;${rgb[i * 3]};${rgb[i * 3 + 1]};${rgb[i * 3 + 2]}`;
  if (mode === 256) return `${bg ? 48 : 38};5;${idx[i]}`;
  const k = idx[i];
  return String((k < 8 ? 30 : 82) + k + (bg ? 10 : 0));
}

/**
 * Text with SGR colour escapes: mode 16 | 256 | 'truecolor' (default: the grid's colour mode; mono gives plain
 * text). An escape is written only where the colour changes (spaces keep the current foreground), and every line
 * that set a colour ends with a reset, so lines can be cut or pasted independently.
 */
export function toANSI(grid, { mode } = {}) {
  const m = ansiMode(mode, grid);
  const { cols, rows, codes, fg, bg } = grid;
  if (!m || (!fg && !bg)) return toText(grid);
  const fi = fg && m !== 24 ? indices(grid, 'fg', m) : null;
  const bi = bg && m !== 24 ? indices(grid, 'bg', m) : null;
  let out = '';
  for (let r = 0; r < rows; r++) {
    let curF = '', curB = '', line = '';
    for (let c = 0, i = r * cols; c < cols; c++, i++) {
      const cp = codes[i];
      const b = bg ? sgrPart(m, bg, bi, i, true) : '';
      const f = fg && !(cp === 32 && !bg) ? sgrPart(m, fg, fi, i, false) : curF;
      if (f !== curF || b !== curB) {
        const parts = [];
        if (f !== curF) parts.push(f || '39');
        if (b !== curB) parts.push(b || '49');
        line += ESC + parts.join(';') + 'm';
        curF = f; curB = b;
      }
      line += ch(cp);
    }
    out += line + (curF || curB ? ESC + '0m' : '') + '\n';
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// HTML

/**
 * HTML fragment for a <pre>: rows separated by '\n', colours as merged <span style="color:…;background:…"> runs
 * (one run per stretch of equal colours; spaces join the current run when only the foreground is coloured).
 * fg / bg: false leaves that colour out (e.g. when backgrounds are painted separately).
 */
export function toHTML(grid, { fg = true, bg = true } = {}) {
  const F = fg ? grid.fg : null, Bk = bg ? grid.bg : null;
  if (!F && !Bk) return grid.chars.map(escText).join('\n');
  const { cols, rows, codes } = grid;
  const lines = new Array(rows);
  for (let r = 0; r < rows; r++) {
    let cur = null, line = '';
    for (let c = 0, i = r * cols; c < cols; c++, i++) {
      const cp = codes[i];
      if (cp === 32 && !Bk) {
        line += ' ';
        continue;
      }
      const style = (F ? 'color:' + hexAt(F, i) : '') + (Bk ? (F ? ';' : '') + 'background:' + hexAt(Bk, i) : '');
      if (style !== cur) {
        if (cur !== null) line += '</span>';
        line += `<span style="${style}">`;
        cur = style;
      }
      line += cp === 38 ? '&amp;' : cp === 60 ? '&lt;' : cp === 62 ? '&gt;' : ch(cp);
    }
    // Trailing spaces stay outside the last run.
    if (cur !== null) {
      const m = /( +)$/.exec(line);
      line = m && !Bk ? line.slice(0, -m[1].length) + '</span>' + m[1] : line + '</span>';
    }
    lines[r] = line;
  }
  return lines.join('\n');
}

/**
 * Standalone HTML document with the art in a <pre> (no external resources).
 *   title, background, foreground, fontSize (px), lineHeight (em; default 0.6 × aspect), fontFamily, lang
 */
// KNOWN DEFECT: opts.background, opts.foreground and opts.fontFamily are interpolated into the <style> block
// unescaped, so a caller passing user input could inject CSS or close the style element ('</style><script>').
// Fix: validate colours with parseHex (or a strict CSS colour regex) and strip '<', '{' and '}' from the font stack.
export function toHTMLPage(grid, opts = {}) {
  const ink = inkColors(grid.ink);
  const bgc = opts.background || ink.background, fgc = opts.foreground || ink.foreground;
  const fs = +opts.fontSize || 12;
  const lh = +opts.lineHeight || Math.round(0.6 * (grid.aspect || 2) * 1000) / 1000;
  const font = opts.fontFamily || MONO_STACK;
  // Cell backgrounds tile without gaps when every run box is exactly one line high.
  const cells = grid.bg ? `pre span{display:inline-block;height:${lh}em;vertical-align:top}` : '';
  return `<!doctype html>
<html lang="${escAttr(opts.lang || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="img2ascii">
<title>${escText(opts.title || 'ASCII art')}</title>
<style>
html,body{margin:0;background:${bgc};color:${fgc}}
body{display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
pre{margin:0;font-family:${font};font-size:${fs}px;line-height:${lh};letter-spacing:0;white-space:pre;font-kerning:none;font-variant-ligatures:none;-webkit-text-size-adjust:none;text-size-adjust:none}
${cells}
</style>
</head>
<body>
<pre>${toHTML(grid)}</pre>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------------------------
// SVG

const BLOCK_RECT = { [HALF_UPPER]: [0, 0.5], [HALF_LOWER]: [0.5, 0.5], [FULL_BLOCK]: [0, 1] };

/**
 * SVG image: a background rect, cell backgrounds and block glyphs (▀ ▄ █) as crisp rects, one <text> per row with
 * <tspan fill> colour runs. Options: background, foreground, fontSize, charWidth (em, default 0.6), aspect,
 * padding, fontFamily, title.
 */
// textLength + lengthAdjust="spacing" forces each row to exactly cols x cell width whatever font the viewer
// substitutes, so columns stay aligned in SVG viewers that lack the monospace font.
export function toSVG(grid, opts = {}) {
  const ink = inkColors(grid.ink);
  const bgc = opts.background || ink.background, fgc = opts.foreground || ink.foreground;
  const fs = +opts.fontSize || 12, cwr = +opts.charWidth || 0.6, pad = opts.padding == null ? 12 : +opts.padding;
  const cw = fs * cwr, chh = cw * (+opts.aspect || grid.aspect || 2);
  const { cols, rows, codes, fg, bg } = grid;
  const W = fmt(cols * cw + 2 * pad), H = fmt(rows * chh + 2 * pad);
  const font = (opts.fontFamily || MONO_STACK).replace(/"/g, '\'');
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  if (opts.title) out += `<title>${escText(opts.title)}</title>`;
  out += `<rect width="100%" height="100%" fill="${escAttr(bgc)}"/>`;
  // Rects: cell background runs, then block glyphs.
  let rects = '';
  for (let r = 0; r < rows; r++) {
    const y = pad + r * chh;
    if (bg) {
      for (let c = 0; c < cols;) {
        const i = r * cols + c, col = hexAt(bg, i);
        let e = c + 1;
        while (e < cols && hexAt(bg, r * cols + e) === col) e++;
        rects += `<rect x="${fmt(pad + c * cw)}" y="${fmt(y)}" width="${fmt((e - c) * cw)}" height="${fmt(chh)}" fill="${col}"/>`;
        c = e;
      }
    }
    for (let c = 0; c < cols;) {
      const i = r * cols + c, b = BLOCK_RECT[codes[i]];
      if (!b) { c++; continue; }
      const col = fg ? hexAt(fg, i) : fgc;
      let e = c + 1;
      while (e < cols && codes[r * cols + e] === codes[i] && (fg ? hexAt(fg, r * cols + e) : fgc) === col) e++;
      rects += `<rect x="${fmt(pad + c * cw)}" y="${fmt(y + b[0] * chh)}" width="${fmt((e - c) * cw)}" height="${fmt(b[1] * chh)}" fill="${escAttr(col)}"/>`;
      c = e;
    }
  }
  if (rects) out += `<g shape-rendering="crispEdges">${rects}</g>`;
  out += `<g font-family="${escAttr(font)}" font-size="${fmt(fs)}" fill="${escAttr(fgc)}">`;
  for (let r = 0; r < rows; r++) {
    let line = '', cur = null, visible = false;
    for (let c = 0, i = r * cols; c < cols; c++, i++) {
      let cp = codes[i];
      if (BLOCK_RECT[cp]) cp = 32;
      if (cp === 32 || cp === 0x2800) {
        line += cp === 32 ? ' ' : ch(cp);
        continue;
      }
      visible = true;
      const col = fg ? hexAt(fg, i) : null;
      if (col !== cur) {
        if (cur !== null) line += '</tspan>';
        line += col ? `<tspan fill="${col}">` : '';
        cur = col;
      }
      line += cp === 38 ? '&amp;' : cp === 60 ? '&lt;' : cp === 62 ? '&gt;' : ch(cp);
    }
    if (cur !== null) line += '</tspan>';
    if (!visible) continue;
    const y = pad + r * chh + chh / 2 + fs * 0.35;
    out += `<text x="${fmt(pad)}" y="${fmt(y)}" xml:space="preserve" textLength="${fmt(cols * cw)}" lengthAdjust="spacing">${line}</text>`;
  }
  out += '</g></svg>\n';
  return out;
}
