// diagram/kit.js - shared pieces of the diagram kinds that draw their own pictures (sequence, pie, Gantt, git graph,
// mind map, timeline, journey, quadrant): source lines without comments and front matter, theme colours and a
// categorical palette per theme, text, end markers with picture-unique ids, the <svg> wrapper.
//
//   sourceLines(src) -> { title, lines: [{ text, raw, line }] }   (text trimmed; raw keeps the indentation)
//   themeOf(opts) -> theme of svg.js THEMES + { dark, name, palette: [colour] }
//   textAt(text, x, y, { size, fill, anchor, bold, italic, extra }) -> SVG text (several lines on '\n' / <br>)
//   markerSet(id, theme) -> { use(name, colour) -> marker id, defs() -> <defs> text }
//   svgDoc({ kind, id, width, height, body, title, opts }) -> SVG text with class "dg dg-<kind>"
//   ink(colour) -> a readable text colour on that fill        fail(line, message) throws "line N: message"

import { MARKERS, THEMES, esc } from './svg.js';
import { labelLines } from './measure.js';

// num: two decimals. SVG coordinates finer than 0.01px are invisible; rounding shrinks output and makes it
// byte-stable across engines (no 0.30000000000000004 noise), which keeps snapshot tests meaningful.
export const num = (v) => Math.round(v * 100) / 100;
export const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Georgian", sans-serif';

// %%{init}%% directives are replaced by their newlines only (not removed): line numbers in error messages must still
// point at the user's real source lines. Same reason for adding the front matter line count back.
// Tabs -> 4 spaces in raw: indentation-based kinds (mindmap, timeline) compare indent widths, and a mixed tab/space
// source would otherwise compare a tab (1 char) against spaces.
export function sourceLines(src) {
  let text = String(src == null ? '' : src).replace(/\r\n?/g, '\n');
  let title = '';
  const fm = /^\s*---\n([\s\S]*?)\n---\s*\n/.exec(text);
  if (fm) { const m = /^title:\s*(.+)$/m.exec(fm[1]); if (m) title = m[1].trim().replace(/^["']|["']$/g, ''); text = text.slice(fm[0].length); }
  text = text.replace(/%%\{[\s\S]*?\}%%/g, (m) => m.replace(/[^\n]/g, ''));
  const lines = [];
  text.split('\n').forEach((raw, i) => {
    if (/^\s*%%/.test(raw)) return;
    const t = raw.trim();
    if (t) lines.push({ text: t, raw: raw.replace(/\t/g, '    ').replace(/\s+$/, ''), line: i + 1 + (fm ? fm[0].split('\n').length - 1 : 0) });
  });
  return { title, lines };
}

export function fail(line, message) { throw new Error((line ? 'line ' + line + ': ' : '') + message); }

// Categorical palettes, 10 hues each. light = Tableau 10 (designed for distinguishability, incl. common colour-vision
// deficiencies); dark = the same hues lifted in lightness for a dark background, so a series keeps its hue across
// themes. Kinds index them modulo length.
const PALETTES = {
  light: ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#b07aa1', '#76b7b2', '#edc948', '#ff9da7', '#9c755f', '#8ca0c8'],
  dark: ['#7aa6e0', '#ffa95c', '#7fca74', '#f2797b', '#cfa0c4', '#8fd3cd', '#f2d464', '#ffb3bc', '#c79a7f', '#a9b8e0'],
  neutral: ['#555555', '#888888', '#333333', '#aaaaaa', '#666666', '#999999', '#444444', '#bbbbbb', '#777777', '#cccccc'],
  forest: ['#3e7d32', '#88b04b', '#2f5d50', '#c0b44a', '#6b8f3a', '#9fc5a0', '#4f6d2a', '#d6c96a', '#7a9e6a', '#a7b98c'],
};

// Unknown theme names fall back to 'light' rather than throwing: theme often comes from user-written front matter.
export function themeOf(opts = {}) {
  const name = THEMES[opts.theme] ? opts.theme : 'light';
  return { ...THEMES[name], ...(opts.colors || {}), name, dark: name === 'dark', palette: (opts.colors && opts.colors.palette) || PALETTES[name] };
}

// Black or white text for a #rgb / #rrggbb fill (other colours: the theme's own text decides).
export function ink(color, fallback = '#1d2130') {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color || '').trim());
  if (!m) return fallback;
  const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
  // WCAG relative luminance: sRGB -> linear (piecewise gamma), then Rec. 709 weights. The pure-contrast crossover is
  // L ~ 0.18; the higher 0.32 threshold deliberately prefers white text on mid-tones, which reads better on saturated
  // palette colours at small sizes.
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.32 ? '#1d2130' : '#ffffff';
}

// dominant-baseline central: y is the visual middle of the text, so callers centre labels without font metrics.
// Multi-line: lines are centred as a block around y, each a <tspan> with absolute x/y (dy chains would accumulate
// rounding and break if one line is empty).
export function textAt(text, x, y, { size = 14, fill = '#000', anchor = 'middle', bold = false, italic = false, extra = '' } = {}) {
  const lines = labelLines(text);
  const lh = size * 1.3;
  const top = y - ((lines.length - 1) * lh) / 2;
  return `<text x="${num(x)}" y="${num(top)}" text-anchor="${anchor}" dominant-baseline="central" font-size="${num(size)}" fill="${esc(fill)}"${bold ? ' font-weight="600"' : ''}${italic ? ' font-style="italic"' : ''}${extra}>` +
    (lines.length === 1 ? esc(lines[0]) : lines.map((l, i) => `<tspan x="${num(x)}" y="${num(top + i * lh)}">${esc(l)}</tspan>`).join('')) + '</text>';
}

// SVG markers cannot inherit the stroke colour of the path that uses them (SVG 1.1; context-stroke is SVG 2 and not
// universally supported), so one <marker> per (shape, colour) pair is emitted, lazily, only for pairs actually used.
// ids are prefixed by the picture id: several inline SVGs on one page share one id namespace, and a duplicate id
// would make every diagram use the first diagram's markers.
export function markerSet(id, t) {
  const used = new Map();
  return {
    use(name, color) {
      if (!name || name === 'none' || !MARKERS[name]) return '';
      const key = name + '|' + color;
      if (!used.has(key)) used.set(key, { id: `${id}-m${used.size}`, name, color });
      return used.get(key).id;
    },
    defs: () => [...used.values()].map((m) => MARKERS[m.name](m.id, esc(m.color), esc(t.hollow || '#fff'))).join(''),
  };
}

// Math.ceil: width/height must cover fractional content; rounding down would clip the last half pixel.
// role="img" + <title> + aria-label: the picture is announced as one image with its title by screen readers.
export function svgDoc({ kind, id, width, height, body, defs = '', title = '', opts = {} }) {
  const W = Math.ceil(width), H = Math.ceil(height);
  return `<svg xmlns="http://www.w3.org/2000/svg" class="dg dg-${kind}" id="${id}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"${title ? ` aria-label="${esc(title)}"` : ''} font-family="${esc(opts.fontFamily || FONT)}">` +
    (title ? `<title>${esc(title)}</title>` : '') + (defs ? `<defs>${defs}</defs>` : '') + body + '</svg>';
}

// Unquoted label: "text" -> text; Markdown-ish <br> stays (labelLines splits it).
export const unquote = (s) => { const t = String(s || '').trim(); return t.length >= 2 && /^(["']).*\1$/.test(t) ? t.slice(1, -1) : t; };
// A CSS colour from diagram text, or '' (no markup can escape: only colour syntax passes).
// Security: diagram text is untrusted (pasted Markdown). Colours are interpolated into attributes, so only colour
// syntax passes the whitelist; anything with quotes, < or ; is rejected, closing the attribute-injection path.
export const safeColor = (c) => { const s = String(c || '').trim(); return /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|[a-z]{3,20})$/i.test(s) ? s : ''; };
