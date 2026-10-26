// sudoku/svg.js - SVG drawing of puzzles as strings (no DOM): the board of the app, thumbnails, rules examples, and
// SVG / PNG exports. Shapes carry `sd-*` classes; the app styles them with its theme, exports embed EXPORT_CSS.
//
//   layout(puzzle) -> { S, ml, mt, mr, mb, width, height, cols, rows, x(c), y(r), cx(i), cy(i) }   S = 100 per cell
//   staticLayers(puzzle, symbols?) -> { shade, under, grid, over }   strings of SVG elements (no <svg> wrapper);
//                                       symbols: quadruple circles show them instead of numbers
//   valueText(puzzle, i, v, symbols, cls) -> one cell's symbol
//   notesSVG(puzzle, i, mask, symbols, kind = 'center' | 'corner')
//   puzzleSVG(puzzle, { values, symbols, title, solution, css }) -> a complete SVG document
//
// Layers bottom to top: shade (jigsaw tints, windows, parity shapes), under (lines, thermometers, arrows), grid
// (thin and box lines), over (cages, dots, signs, quadruple circles, outside numbers).

import { makeGeometry } from './geometry.js';
import { setHas } from './bits.js';
import { lineFrom } from './clues.js';
import { RULES } from './rules.js';

export const S = 100;
const OUTSIDE = new Set(['sandwich', 'sky', 'xsum', 'frame', 'little']);
const LINE_CLASS = {
  thermo: 'sd-thermo', renban: 'sd-renban', whisper: 'sd-whisper', dutch: 'sd-dutch', palindrome: 'sd-palin',
  parityline: 'sd-parity', between: 'sd-between', zipper: 'sd-zipper', entropic: 'sd-entropic', modular: 'sd-modular', arrow: 'sd-arrow',
};

// Escapes text and double-quoted attribute content. Numeric clue values are interpolated unescaped: cleanPuzzle has
// validated them as integers. Colour fills come from the fixed ALPHABETS palette, never from user text.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const f = (x) => Math.round(x * 10) / 10;

// Keyed by the puzzle object: geometry is recomputed only for new puzzles, and entries die with the puzzle.
const geomCache = new WeakMap();
export function geometryOf(puzzle) {
  let g = geomCache.get(puzzle);
  if (!g) {
    g = makeGeometry({ n: puzzle.n, box: puzzle.box || null, regions: puzzle.regions ? Int32Array.from(puzzle.regions) : null, layout: puzzle.layout || null });
    geomCache.set(puzzle, g);
  }
  return g;
}

// Margins grow only on the sides that carry outside clues, so plain puzzles have no wasted border.
export function layout(puzzle) {
  const g = geometryOf(puzzle);
  const kinds = new Set((puzzle.clues || []).map((c) => c.t));
  const side = { l: 0, t: 0, r: 0, b: 0 };
  for (const c of puzzle.clues || []) {
    if (!OUTSIDE.has(c.t)) continue;
    if (c.t === 'little') {
      if (c.r < 0) side.t = 1; if (c.r >= g.rows) side.b = 1; if (c.c < 0) side.l = 1; if (c.c >= g.cols) side.r = 1;
    } else side[c.side] = 1;
  }
  const out = kinds.has('little') ? 0.75 * S : 0.7 * S;
  const pad = 0.08 * S;
  const ml = side.l ? out : pad, mt = side.t ? out : pad, mr = side.r ? out : pad, mb = side.b ? out : pad;
  const L = {
    S, ml, mt, mr, mb, rows: g.rows, cols: g.cols,
    width: ml + g.cols * S + mr, height: mt + g.rows * S + mb,
    x: (c) => ml + c * S, y: (r) => mt + r * S,
  };
  L.cx = (i) => L.x(i % g.cols) + S / 2;
  L.cy = (i) => L.y(Math.floor(i / g.cols)) + S / 2;
  return L;
}

// Greedy colouring of jigsaw regions (neighbouring regions get different tints).
// Greedy colouring in region-id order. Planar maps may need up to 4 colours but greedy can use more; tints wrap at
// 4 (sd-tint-k % 4), so in rare layouts two neighbouring regions can share a tint. The thick borders still separate them.
function regionTints(g) {
  const n = g.n;
  const adj = Array.from({ length: n }, () => new Set());
  for (const i of g.cells) {
    const c = i % g.cols;
    for (const j of [c + 1 < g.cols ? i + 1 : -1, i + g.cols]) {
      if (j >= 0 && j < g.size && g.present[j] && g.region[j] !== g.region[i]) { adj[g.region[i]].add(g.region[j]); adj[g.region[j]].add(g.region[i]); }
    }
  }
  const col = new Int32Array(n).fill(-1);
  for (let r = 0; r < n; r++) {
    const used = new Set([...adj[r]].map((x) => col[x]));
    let k = 0;
    while (used.has(k)) k++;
    col[r] = k;
  }
  return col;
}

function polyline(L, cells, cls, extra = '') {
  const pts = cells.map((i) => `${f(L.cx(i))},${f(L.cy(i))}`).join(' ');
  return `<polyline class="${cls}" points="${pts}" fill="none"${extra}/>`;
}

// Inset outline of a set of cells (killer cages): one segment per open side, extended at concave corners.
// Each open side is inset by d; at concave corners the segment is extended by d (sign flip) so the dashed outline closes.
function cageOutline(g, L, cells, d) {
  const set = new Set(cells);
  const has = (r, c) => r >= 0 && c >= 0 && r < g.rows && c < g.cols && set.has(r * g.cols + c);
  let p = '';
  for (const i of cells) {
    const r = Math.floor(i / g.cols), c = i % g.cols;
    const x = L.x(c), y = L.y(r);
    if (!has(r - 1, c)) p += `M${f(x + (has(r, c - 1) ? -d : d))} ${f(y + d)}H${f(x + S + (has(r, c + 1) ? d : -d))}`;
    if (!has(r + 1, c)) p += `M${f(x + (has(r, c - 1) ? -d : d))} ${f(y + S - d)}H${f(x + S + (has(r, c + 1) ? d : -d))}`;
    if (!has(r, c - 1)) p += `M${f(x + d)} ${f(y + (has(r - 1, c) ? -d : d))}V${f(y + S + (has(r + 1, c) ? d : -d))}`;
    if (!has(r, c + 1)) p += `M${f(x + S - d)} ${f(y + (has(r - 1, c) ? -d : d))}V${f(y + S + (has(r + 1, c) ? d : -d))}`;
  }
  return p;
}

// Midpoint of the edge between two orthogonal neighbours and whether it is vertical (left / right neighbours).
function edgeMid(g, L, a, b) {
  const ra = Math.floor(a / g.cols), ca = a % g.cols, rb = Math.floor(b / g.cols), cb = b % g.cols;
  return { x: (L.cx(a) + L.cx(b)) / 2, y: (L.cy(a) + L.cy(b)) / 2, vertical: ra === rb, dr: rb - ra, dc: cb - ca };
}

// Static layers are computed once per puzzle and reused while the player types (only values and notes change).
// Rule houses are discovered by running the rule's apply() against a stub ctx that records addHouse calls: the
// drawing cannot drift from the solver's definition of the house.
export function staticLayers(puzzle, symbols = null) {
  const g = geometryOf(puzzle);
  const L = layout(puzzle);
  let shade = '', under = '', grid = '', over = '';
  // background of present cells
  for (const i of g.cells) shade += `<rect class="sd-cell" x="${f(L.x(i % g.cols))}" y="${f(L.y(Math.floor(i / g.cols)))}" width="${S}" height="${S}"/>`;
  if (puzzle.regions) {
    const tint = regionTints(g);
    for (const i of g.cells) shade += `<rect class="sd-tint sd-tint-${tint[g.region[i]] % 4}" x="${f(L.x(i % g.cols))}" y="${f(L.y(Math.floor(i / g.cols)))}" width="${S}" height="${S}"/>`;
  }
  // rule houses that are drawn
  const rules = new Set(puzzle.rules || []);
  if (rules.size) {
    const extra = [];
    const ctx = { geom: g, n: g.n, puzzle, addHouse: (kind, cells) => extra.push({ kind, cells }), addNeq() {}, addCons() {}, rel() {}, addDistinct() {}, restrict() {} };
    // only the house rules are drawn as shading
    for (const id of ['windoku', 'centerdot', 'asterisk', 'girandola', 'magic']) if (rules.has(id)) RULE_SHADES[id](ctx, extra);
    for (const h of extra) for (const i of h.cells) shade += `<rect class="sd-house sd-house-${h.kind}" x="${f(L.x(i % g.cols))}" y="${f(L.y(Math.floor(i / g.cols)))}" width="${S}" height="${S}"/>`;
    if (rules.has('diagonal')) {
      for (const [r0, c0] of g.grids) {
        under += `<path class="sd-diag" d="M${f(L.x(c0))} ${f(L.y(r0))}L${f(L.x(c0 + g.n))} ${f(L.y(r0 + g.n))}M${f(L.x(c0 + g.n))} ${f(L.y(r0))}L${f(L.x(c0))} ${f(L.y(r0 + g.n))}"/>`;
      }
    }
  }
  // clues drawn under the grid lines
  for (const cl of puzzle.clues || []) {
    if (cl.t === 'parity') {
      const cx = L.cx(cl.cell), cy = L.cy(cl.cell);
      shade += cl.odd ? `<circle class="sd-odd" cx="${f(cx)}" cy="${f(cy)}" r="${f(S * 0.38)}"/>` : `<rect class="sd-even" x="${f(cx - S * 0.36)}" y="${f(cy - S * 0.36)}" width="${f(S * 0.72)}" height="${f(S * 0.72)}" rx="${f(S * 0.06)}"/>`;
    } else if (cl.t === 'thermo') {
      under += `<circle class="sd-thermo-bulb" cx="${f(L.cx(cl.cells[0]))}" cy="${f(L.cy(cl.cells[0]))}" r="${f(S * 0.36)}"/>` + polyline(L, cl.cells, 'sd-line sd-thermo');
    } else if (cl.t === 'arrow') {
      const [c0, ...path] = cl.cells;
      const ox = L.cx(c0), oy = L.cy(c0);
      const r0 = S * 0.36;
      // start the shaft on the circle's rim
      const dx = L.cx(path[0]) - ox, dy = L.cy(path[0]) - oy, len = Math.hypot(dx, dy) || 1;
      const pts = [[ox + (dx / len) * r0, oy + (dy / len) * r0], ...path.map((i) => [L.cx(i), L.cy(i)])];
      const [ex, ey] = pts[pts.length - 1], [px, py] = pts[pts.length - 2];
      const ang = Math.atan2(ey - py, ex - px), a1 = ang + Math.PI * 0.8, a2 = ang - Math.PI * 0.8, h = S * 0.22;
      under += `<circle class="sd-arrow-circle" cx="${f(ox)}" cy="${f(oy)}" r="${f(r0)}"/>` +
        `<polyline class="sd-arrow" fill="none" points="${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}"/>` +
        `<polyline class="sd-arrow" fill="none" points="${f(ex + Math.cos(a1) * h)},${f(ey + Math.sin(a1) * h)} ${f(ex)},${f(ey)} ${f(ex + Math.cos(a2) * h)},${f(ey + Math.sin(a2) * h)}"/>`;
    } else if (cl.t === 'between') {
      const a = cl.cells[0], b = cl.cells[cl.cells.length - 1];
      under += polyline(L, cl.cells, 'sd-line sd-between') +
        `<circle class="sd-between-end" cx="${f(L.cx(a))}" cy="${f(L.cy(a))}" r="${f(S * 0.36)}"/><circle class="sd-between-end" cx="${f(L.cx(b))}" cy="${f(L.cy(b))}" r="${f(S * 0.36)}"/>`;
    } else if (LINE_CLASS[cl.t]) {
      under += polyline(L, cl.cells, 'sd-line ' + LINE_CLASS[cl.t]);
    }
  }
  // grid: thin lines inside regions, thick ones between regions and around the grid
  // Thin / thick lines are emitted per cell edge (right and bottom; left and top only on the outer border), so every edge is drawn exactly once.
  let thin = '', thick = '';
  const at = (r, c) => (r >= 0 && c >= 0 && r < g.rows && c < g.cols && g.present[r * g.cols + c] ? r * g.cols + c : -1);
  for (const i of g.cells) {
    const r = Math.floor(i / g.cols), c = i % g.cols;
    const x = f(L.x(c)), y = f(L.y(r)), x2 = f(L.x(c + 1)), y2 = f(L.y(r + 1));
    const right = at(r, c + 1), down = at(r + 1, c), left = at(r, c - 1), up = at(r - 1, c);
    const seg = (d, isThick) => { if (isThick) thick += d; else thin += d; };
    seg(`M${x2} ${y}V${y2}`, right < 0 || (g.region[right] !== g.region[i]));
    seg(`M${x} ${y2}H${x2}`, down < 0 || (g.region[down] !== g.region[i]));
    if (left < 0) thick += `M${x} ${y}V${y2}`;
    if (up < 0) thick += `M${x} ${y}H${x2}`;
  }
  grid = `<path class="sd-thin" d="${thin}"/><path class="sd-thick" d="${thick}"/>`;
  // clues over the grid
  for (const cl of puzzle.clues || []) {
    if (cl.t === 'cage') {
      over += `<path class="sd-cage" d="${cageOutline(g, L, cl.cells, S * 0.08)}"/>`;
      const first = Math.min(...cl.cells);
      const x = L.x(first % g.cols), y = L.y(Math.floor(first / g.cols));
      const txt = String(cl.sum);
      over += `<rect class="sd-cage-bg" x="${f(x + S * 0.04)}" y="${f(y + S * 0.04)}" width="${f(S * (0.08 + 0.15 * txt.length))}" height="${f(S * 0.26)}"/>` +
        `<text class="sd-cage-sum" x="${f(x + S * 0.08)}" y="${f(y + S * 0.235)}">${txt}</text>`;
    } else if (cl.t === 'kropki') {
      const m = edgeMid(g, L, cl.a, cl.b);
      over += `<circle class="sd-dot ${cl.k === 'b' ? 'sd-dot-black' : 'sd-dot-white'}" cx="${f(m.x)}" cy="${f(m.y)}" r="${f(S * 0.11)}"/>`;
    } else if (cl.t === 'consec') {
      const m = edgeMid(g, L, cl.a, cl.b);
      const w = S * 0.36, h = S * 0.13;
      over += m.vertical ? `<rect class="sd-bar" x="${f(m.x - h / 2)}" y="${f(m.y - w / 2)}" width="${f(h)}" height="${f(w)}" rx="${f(h / 2)}"/>` : `<rect class="sd-bar" x="${f(m.x - w / 2)}" y="${f(m.y - h / 2)}" width="${f(w)}" height="${f(h)}" rx="${f(h / 2)}"/>`;
    } else if (cl.t === 'xv') {
      const m = edgeMid(g, L, cl.a, cl.b);
      over += `<rect class="sd-xv-bg" x="${f(m.x - S * 0.13)}" y="${f(m.y - S * 0.15)}" width="${f(S * 0.26)}" height="${f(S * 0.3)}" rx="${f(S * 0.05)}"/>` +
        `<text class="sd-xv" x="${f(m.x)}" y="${f(m.y + S * 0.1)}">${cl.k === 'x' ? 'X' : 'V'}</text>`;
    } else if (cl.t === 'gt') {
      // chevron pointing at the smaller cell b
      const m = edgeMid(g, L, cl.a, cl.b);
      const k = S * 0.1;
      const tip = [m.x + m.dc * k, m.y + m.dr * k];
      const base1 = [m.x - m.dc * k + (m.dr ? k : 0) * 1.2, m.y - m.dr * k + (m.dc ? k : 0) * 1.2];
      const base2 = [m.x - m.dc * k - (m.dr ? k : 0) * 1.2, m.y - m.dr * k - (m.dc ? k : 0) * 1.2];
      // cl.a is greater: the chevron opens towards a and points to b
      over += `<polyline class="sd-gt" fill="none" points="${f(base1[0])},${f(base1[1])} ${f(tip[0])},${f(tip[1])} ${f(base2[0])},${f(base2[1])}"/>`;
    } else if (cl.t === 'quad') {
      const x = L.x(cl.cell % g.cols) + S, y = L.y(Math.floor(cl.cell / g.cols)) + S;
      const ds = cl.digits;
      over += `<circle class="sd-quad" cx="${f(x)}" cy="${f(y)}" r="${f(S * 0.27)}"/>`;
      const pos = ds.length === 1 ? [[0, 0]] : ds.length === 2 ? [[-0.09, 0], [0.09, 0]] : ds.length === 3 ? [[-0.09, -0.08], [0.09, -0.08], [0, 0.1]] : [[-0.09, -0.08], [0.09, -0.08], [-0.09, 0.1], [0.09, 0.1]];
      ds.forEach((d, k) => {
        const sy = symbols && symbols[d - 1], px = x + pos[k][0] * S, py = y + pos[k][1] * S;
        over += sy && sy.color ? `<circle class="sd-quad-sw" cx="${f(px)}" cy="${f(py)}" r="${f(S * 0.06)}" fill="${sy.color}"/>`
          : `<text class="sd-quad-d" data-num="${d}" x="${f(px)}" y="${f(py + S * 0.05)}">${esc(sy ? sy.text : d)}</text>`;
      });
    } else if (OUTSIDE.has(cl.t)) {
      over += outsideClue(g, L, cl);
    }
  }
  return { shade, under, grid, over, layout: L };
}

const RULE_SHADES = {
  windoku: (ctx, out) => collect(ctx, 'windoku', out),
  centerdot: (ctx, out) => collect(ctx, 'centerdot', out),
  asterisk: (ctx, out) => collect(ctx, 'asterisk', out),
  girandola: (ctx, out) => collect(ctx, 'girandola', out),
  magic: (ctx, out) => {
    const g = ctx.geom;
    const cells = [];
    for (let r = 3; r < 6; r++) for (let c = 3; c < 6; c++) cells.push(r * g.cols + c);
    out.push({ kind: 'magic', cells });
  },
};

function collect(ctx, id, out) {
  RULES[id].apply({ ...ctx, addHouse: (kind, cells) => out.push({ kind, cells }) });
}

function outsideClue(g, L, cl) {
  let x, y, text;
  if (cl.t === 'little') {
    // the number sits in the outside cell; a small arrow points along the diagonal
    const cx = cl.c < 0 ? L.ml / 2 : cl.c >= g.cols ? L.x(g.cols) + L.mr / 2 : L.x(cl.c) + S / 2;
    const cy = cl.r < 0 ? L.mt / 2 : cl.r >= g.rows ? L.y(g.rows) + L.mb / 2 : L.y(cl.r) + S / 2;
    const ax = cx + cl.dc * S * 0.3, ay = cy + cl.dr * S * 0.3;
    const h = S * 0.1;
    return `<text class="sd-out sd-little" x="${f(cx - cl.dc * S * 0.05)}" y="${f(cy - cl.dr * S * 0.05 + S * 0.1)}">${cl.sum}</text>` +
      `<path class="sd-little-arrow" d="M${f(ax - cl.dc * h * 1.6)} ${f(ay - cl.dr * h * 1.6)}L${f(ax)} ${f(ay)}M${f(ax - cl.dc * h)} ${f(ay)}L${f(ax)} ${f(ay)}L${f(ax)} ${f(ay - cl.dr * h)}"/>`;
  }
  const cells = lineFrom(g, cl.side, cl.i);
  const first = cells[0];
  text = cl.t === 'sky' ? cl.count : cl.sum;
  if (cl.side === 'l') { x = L.ml / 2; y = L.cy(first); }
  else if (cl.side === 'r') { x = L.x(g.cols) + L.mr / 2; y = L.cy(first); }
  else if (cl.side === 't') { x = L.cx(first); y = L.mt / 2; }
  else { x = L.cx(first); y = L.y(g.rows) + L.mb / 2; }
  return `<text class="sd-out sd-out-${cl.t}" x="${f(x)}" y="${f(y + S * 0.12)}">${text}</text>`;
}

// One cell's symbol (number v = 1..n). cls: 'sd-given' | 'sd-value' | 'sd-wrong' ….
export function valueText(puzzle, i, v, symbols, cls = 'sd-value', L = layout(puzzle)) {
  const s = symbols[v - 1];
  const cx = L.cx(i), cy = L.cy(i);
  if (s.color) return `<circle class="${cls} sd-swatch" cx="${f(cx)}" cy="${f(cy)}" r="${f(S * 0.3)}" fill="${s.color}"/>`;
  const len = [...s.text].length;
  const size = len >= 4 ? 0.3 : len === 3 ? 0.38 : len === 2 ? 0.48 : 0.62;
  return `<text class="${cls}" x="${f(cx)}" y="${f(cy + S * size * 0.36)}" font-size="${f(S * size)}">${esc(s.text)}</text>`;
}

// Pencil marks of a cell: centre marks in a row (shrinking), corner marks in a k × k grid.
export function notesSVG(puzzle, i, mask, symbols, kind = 'center', L = layout(puzzle)) {
  const vals = [];
  for (let v = 0; v < symbols.length; v++) if (setHas(mask, v)) vals.push(v);
  if (!vals.length) return '';
  const x0 = L.x(i % L.cols), y0 = L.y(Math.floor(i / L.cols));
  let out = '';
  if (kind === 'corner') {
    const k = Math.ceil(Math.sqrt(symbols.length));
    const step = S / k;
    for (const v of vals) {
      const r = Math.floor(v / k), c = v % k;
      const cx = x0 + step * (c + 0.5), cy = y0 + step * (r + 0.5);
      const s = symbols[v];
      out += s.color ? `<circle class="sd-note-sw" cx="${f(cx)}" cy="${f(cy)}" r="${f(step * 0.3)}" fill="${s.color}"/>`
        : `<text class="sd-note" x="${f(cx)}" y="${f(cy + step * 0.24)}" font-size="${f(step * 0.66)}">${esc(s.text)}</text>`;
    }
    return out;
  }
  const texts = vals.map((v) => symbols[v]);
  if (texts.some((s) => s.color)) {
    const step = Math.min(S * 0.2, (S * 0.84) / texts.length);
    texts.forEach((s, k) => { out += `<circle class="sd-note-sw" cx="${f(x0 + S / 2 + (k - (texts.length - 1) / 2) * step)}" cy="${f(y0 + S / 2)}" r="${f(step * 0.38)}" fill="${s.color || 'currentColor'}"/>`; });
    return out;
  }
  const str = texts.map((s) => s.text).join('');
  const size = Math.min(S * 0.3, (S * 0.9) / Math.max(1, [...str].length) * 1.7);
  return `<text class="sd-note sd-note-center" x="${f(x0 + S / 2)}" y="${f(y0 + S / 2 + size * 0.36)}" font-size="${f(size)}">${esc(str)}</text>`;
}

// Standalone styling for exported SVG / PNG (the app replaces it with themed CSS). Strokes are in user units of the 100-per-cell viewBox.
export const EXPORT_CSS = `
.sd-cell{fill:#fff}.sd-tint-0{fill:#fff}.sd-tint-1{fill:#eef3fb}.sd-tint-2{fill:#fbf1e6}.sd-tint-3{fill:#eef8ef}
.sd-house{fill:#dfe6f3;opacity:.7}.sd-house-magic{fill:#f4e6c8}
.sd-diag{stroke:#9aa7bd;stroke-width:3;fill:none}
.sd-thin{stroke:#8d95a3;stroke-width:2;fill:none}.sd-thick{stroke:#1b2230;stroke-width:6;fill:none;stroke-linecap:square}
.sd-odd{fill:#d9dde4}.sd-even{fill:#d9dde4}
.sd-line{stroke-linecap:round;stroke-linejoin:round;fill:none;stroke-width:20;opacity:.75}
.sd-thermo{stroke:#b8bec9;stroke-width:24;opacity:1}.sd-thermo-bulb{fill:#b8bec9}
.sd-renban{stroke:#c58df0}.sd-whisper{stroke:#58c26d}.sd-dutch{stroke:#f0a346}.sd-palin{stroke:#a0a8b6}.sd-parity{stroke:#ef7b7b}
.sd-between{stroke:#9fb4d8;stroke-width:12}.sd-between-end{fill:#fff;stroke:#9fb4d8;stroke-width:5}
.sd-zipper{stroke:#b6a6ec}.sd-entropic{stroke:#e8c45a}.sd-modular{stroke:#5cc6c0}
.sd-arrow{stroke:#9aa1ad;stroke-width:5;fill:none;stroke-linecap:round;stroke-linejoin:round}.sd-arrow-circle{fill:#fff;stroke:#9aa1ad;stroke-width:5}
.sd-cage{stroke:#3a4252;stroke-width:2.5;stroke-dasharray:7 6;fill:none}.sd-cage-bg{fill:#fff}
.sd-cage-sum{font:600 22px system-ui,sans-serif;fill:#1b2230}
.sd-dot{stroke:#1b2230;stroke-width:3}.sd-dot-white{fill:#fff}.sd-dot-black{fill:#1b2230}
.sd-bar{fill:#fff;stroke:#1b2230;stroke-width:3}
.sd-xv-bg{fill:#fff}.sd-xv{font:700 26px system-ui,sans-serif;fill:#1b2230;text-anchor:middle}
.sd-gt{stroke:#1b2230;stroke-width:4;stroke-linecap:round;stroke-linejoin:round}
.sd-quad{fill:#fff;stroke:#1b2230;stroke-width:3}.sd-quad-d{font:600 17px system-ui,sans-serif;text-anchor:middle;fill:#1b2230}
.sd-out{font:600 38px system-ui,sans-serif;text-anchor:middle;fill:#1b2230}.sd-little{font-size:30px}
.sd-little-arrow{stroke:#1b2230;stroke-width:3;fill:none}
.sd-given{font-family:system-ui,sans-serif;font-weight:600;text-anchor:middle;fill:#1b2230}
.sd-value{font-family:system-ui,sans-serif;text-anchor:middle;fill:#2563eb}
.sd-note{font-family:system-ui,sans-serif;text-anchor:middle;fill:#5b6474}
`;

// A complete SVG document (for downloads, print and PNG export).
export function puzzleSVG(puzzle, { values = null, symbols, title = '', css = EXPORT_CSS, solution = null } = {}) {
  const layers = staticLayers(puzzle, symbols);
  const L = layers.layout;
  const g = geometryOf(puzzle);
  let vals = '';
  for (const i of g.cells) {
    const given = puzzle.givens && puzzle.givens[i];
    const v = given || (values && values[i]) || (solution && solution[i]) || 0;
    if (v) vals += valueText(puzzle, i, v, symbols, given ? 'sd-given' : 'sd-value', L);
  }
  const W = f(L.width), H = f(L.height);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${f(W * 0.6)}" height="${f(H * 0.6)}">` +
    (title ? `<title>${esc(title)}</title>` : '') + `<style>${css}</style><rect width="${W}" height="${H}" fill="#fff"/>` +
    layers.shade + layers.under + layers.grid + layers.over + vals + '</svg>';
}

