// sudoku-game/view.js - the board on screen: one SVG with the static picture of the puzzle (sudoku/svg.js layers) and
// dynamic layers (cell colours, highlights, symbols, pencil marks, selection, other players' cursors, hint marks),
// pointer input (tap / click, drag to select several cells, double tap for every cell with that symbol), zoom and pan
// (pinch, Ctrl + wheel, buttons; one-finger drag pans when zoomed) and the cell menu (right click, long press, Menu
// key: ui/contextmenu.js). The view keeps no game state: play.js passes everything to render().
//
//   createBoard(host, { select(cell, mode: 'set' | 'add' | 'toggle'), double(cell), menu(cell, info) -> items,
//                       zoomed(scale) }) -> board
//   board.setPuzzle(puzzle, symbols)     board.setSymbols(symbols)      board.render(state)
//   board.zoom(factor | 'fit')           board.ensureVisible(cell)      board.cellAt(clientX, clientY)
//   board.element (the focusable viewport)   board.scale()
// state = { values, givens, corner, center, colors, selection: Set, primary, highlight (value), tint: Set,
//           conflicts: Set, wrong: Set, owners?: [seat], ownerColors?: [css], cursors?: [{ cell, color, label }],
//           hint?: { area: [], cells: [], target, value, elim: [[cell, mask]] }, won?: boolean, readOnly?: boolean }

//
// Rendering strategy: the puzzle picture (grid, cages, lines, outside clues) is drawn once per puzzle into fixed <g>
// layers; every state change rewrites only the four dynamic layers as SVG strings via innerHTML. Building strings
// and assigning once is much faster than creating thousands of elements with createElementNS on a 25x25 grid, and
// the static layers never re-parse. Layer order = paint order (SVG has no z-index).
// Zoom strategy: the SVG has a viewBox, so zooming only changes its CSS width/height and the canvas translate; the
// browser re-rasterises vector content crisply and no re-render is needed.
import { h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { contextMenu } from '../ui/contextmenu.js';
import { S, geometryOf, layout, staticLayers } from '../sudoku/svg.js';
import { graphemes } from '../sudoku/symbols.js';
import { setHas } from '../sudoku/bits.js';

const NS = 'http://www.w3.org/2000/svg';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const f = (x) => Math.round(x * 10) / 10;
// Max zoom: at least 2x the fitted size and large enough for a 46px cell (comfortable touch target on 25x25+ grids).
const MIN_CELL_PX = 46; // the largest zoom makes a cell at least this big (and twice the fitted size)

function svgEl(tag, cls) {
  const e = document.createElementNS(NS, tag);
  if (cls) e.setAttribute('class', cls);
  return e;
}

export function createBoard(host, opts = {}) {
  const svg = svgEl('svg', 'sg-svg');
  svg.setAttribute('aria-hidden', 'true');
  const layer = {};
  for (const k of ['shade', 'colors', 'hl', 'under', 'grid', 'over', 'text', 'sel']) { layer[k] = svgEl('g', 'sg-l-' + k); svg.append(layer[k]); }
  const canvas = h('div', { class: 'sg-canvas' });
  canvas.append(svg);
  const zoomBar = h('div', { class: 'sg-zoombar' },
    h('button', { type: 'button', class: 'sg-zbtn', title: t('sg.zoomIn'), 'aria-label': t('sg.zoomIn'), onclick: () => zoom(1.4) }, iconEl('zoomIn')),
    h('button', { type: 'button', class: 'sg-zbtn', title: t('sg.zoomOut'), 'aria-label': t('sg.zoomOut'), onclick: () => zoom(1 / 1.4) }, iconEl('zoomOut')),
    h('button', { type: 'button', class: 'sg-zbtn', title: t('sg.zoomFit'), 'aria-label': t('sg.zoomFit'), onclick: () => zoom('fit') }, iconEl('fitWidth')));
  // role=application: the board handles arrow keys and letters itself; screen readers then pass keys through instead
  // of using them for their own navigation. The SVG is aria-hidden; play.js announces moves through a live region.
  const vp = h('div', { class: 'sg-vp', tabindex: '0', role: 'application', 'aria-label': t('sg.boardAria') }, canvas, zoomBar);
  host.append(vp);

  let puzzle = null, L = null, geom = null, symbols = [];
  let base = 1, scale = 1, tx = 0, ty = 0, vw = 0, vh = 0;
  let last = null; // last rendered state (re-render on zoom changes is not needed: SVG scales)
  let prevValues = null;

  // --- geometry -----------------------------------------------------------------------------------------------------

  const maxScale = () => (L ? Math.max(2, MIN_CELL_PX / (S * base)) : 1);

  // base = scale that fits the whole layout into the viewport; user zoom multiplies it. Called on resize via
  // ResizeObserver (catches layout changes that are not window resizes, e.g. the side panel appearing).
  function measure() {
    const r = vp.getBoundingClientRect();
    vw = r.width; vh = r.height;
    if (!L || !vw || !vh) return;
    base = Math.min(vw / L.width, vh / L.height);
    applyTransform();
  }

  // The zoom buttons sit beside the board when there is room on the sides, else under it (the board moves up to
  // leave them a strip when it can).
  const ZOOMBAR = 46;
  // Zoom controls appear when zoomed in, or when cells are smaller than 40px at fit (big grids on phones).
  const zoomable = () => scale > 1.01 || S * base < 40;
  // Smaller than the viewport on an axis: centre it. Larger: clamp so no empty gap shows at either edge. When the
  // zoom bar needs a strip under the board, the board is shifted up by up to ZOOMBAR px instead of being covered.
  function clampPan() {
    const bw = L.width * base * scale, bh = L.height * base * scale;
    const side = (vw - bw) / 2 >= ZOOMBAR;
    vp.classList.toggle('sg-zoom-side', side);
    tx = bw <= vw ? (vw - bw) / 2 : Math.min(0, Math.max(vw - bw, tx));
    ty = bh <= vh ? (zoomable() && !side ? Math.min((vh - bh) / 2, Math.max(0, vh - bh - ZOOMBAR)) : (vh - bh) / 2) : Math.min(0, Math.max(vh - bh, ty));
  }

  function applyTransform() {
    if (!L) return;
    clampPan();
    svg.style.width = f(L.width * base * scale) + 'px';
    svg.style.height = f(L.height * base * scale) + 'px';
    canvas.style.transform = `translate(${f(tx)}px, ${f(ty)}px)`;
    vp.classList.toggle('sg-zoomed', scale > 1.01);
    vp.classList.toggle('sg-zoomable', zoomable());
    if (opts.zoomed) opts.zoomed(scale);
  }

  // Zoom by a factor around a point of the viewport (default: its centre), or back to the fitted size.
  // Zoom about a fixed point: the content point under (cx, cy) must stay under it, so
  // t' = c - (c - t) * s'/s. Same formula for wheel (cursor position) and buttons (viewport centre).
  function zoom(k, cx = vw / 2, cy = vh / 2) {
    if (!L) return;
    const s0 = scale;
    scale = k === 'fit' ? 1 : Math.min(maxScale(), Math.max(1, scale * k));
    tx = cx - (cx - tx) * (scale / s0);
    ty = cy - (cy - ty) * (scale / s0);
    applyTransform();
  }

  // Hit testing by arithmetic on the layout, not by DOM targets: works through every overlay layer and for
  // pointers that moved during capture. ml/mt are the outside-clue margins of the layout.
  function cellAt(x, y) {
    if (!L) return -1;
    const r = svg.getBoundingClientRect();
    if (!r.width) return -1;
    const ux = ((x - r.left) / r.width) * L.width, uy = ((y - r.top) / r.height) * L.height;
    const c = Math.floor((ux - L.ml) / S), row = Math.floor((uy - L.mt) / S);
    if (c < 0 || row < 0 || c >= geom.cols || row >= geom.rows) return -1;
    const i = row * geom.cols + c;
    return geom.present[i] ? i : -1;
  }

  // Pans so that a cell is inside the viewport (keyboard moves while zoomed).
  // Keep the keyboard cursor 0.6 cell away from the viewport edge while zoomed, so the next arrow move is visible.
  function ensureVisible(i) {
    if (!L || scale <= 1.01 || i < 0) return;
    const px = base * scale;
    const x0 = L.x(i % geom.cols) * px + tx, y0 = L.y(Math.floor(i / geom.cols)) * px + ty, cs = S * px;
    const m = cs * 0.6;
    if (x0 < m) tx += m - x0; else if (x0 + cs > vw - m) tx -= x0 + cs - (vw - m);
    if (y0 < m) ty += m - y0; else if (y0 + cs > vh - m) ty -= y0 + cs - (vh - m);
    applyTransform();
  }

  // --- static picture -----------------------------------------------------------------------------------------------

  function setPuzzle(p, syms) {
    puzzle = p;
    geom = geometryOf(p);
    L = layout(p);
    symbols = syms;
    svg.setAttribute('viewBox', `0 0 ${f(L.width)} ${f(L.height)}`);
    svg.classList.toggle('sg-holes', !!p.layout);
    drawStatic();
    scale = 1;
    prevValues = null;
    measure();
  }

  function drawStatic() {
    const st = staticLayers(puzzle, symbols);
    layer.shade.innerHTML = st.shade;
    layer.under.innerHTML = st.under;
    layer.grid.innerHTML = st.grid;
    layer.over.innerHTML = st.over;
  }

  function setSymbols(syms) {
    symbols = syms;
    if (puzzle) { drawStatic(); if (last) render(last); }
  }

  // --- dynamic layers -----------------------------------------------------------------------------------------------

  const cx = (i) => L.cx(i), cy = (i) => L.cy(i);
  const cellX = (i) => L.x(i % geom.cols), cellY = (i) => L.y(Math.floor(i / geom.cols));
  const rect = (i, cls, inset = 0, extra = '') => `<rect class="${cls}" x="${f(cellX(i) + inset)}" y="${f(cellY(i) + inset)}" width="${f(S - 2 * inset)}" height="${f(S - 2 * inset)}"${extra}/>`;

  // Font size by grapheme count (multi-letter symbols shrink), emoji slightly smaller (they render wider). The y
  // offset 0.36*size approximates the baseline shift that centres the glyph vertically, since SVG text has no
  // reliable dominant-baseline across engines. graphemes() counts user-perceived characters (flags, ZWJ emoji).
  function symbolMark(i, v, cls, extra = '') {
    const s = symbols[v - 1];
    if (!s) return '';
    if (s.color) return `<circle class="${cls} sd-swatch" cx="${f(cx(i))}" cy="${f(cy(i))}" r="${f(S * 0.32)}" fill="${s.color}"${extra}/>`;
    const len = graphemes(s.text).length;
    const emoji = /\p{Extended_Pictographic}/u.test(s.text);
    const size = emoji ? 0.56 : len >= 4 ? 0.3 : len === 3 ? 0.38 : len === 2 ? 0.48 : 0.64;
    return `<text class="${cls}" x="${f(cx(i))}" y="${f(cy(i) + S * size * 0.36)}" font-size="${f(S * size)}"${extra}>${esc(s.text)}</text>`;
  }

  // Corner marks: fixed positions on a k x k sub-grid (k = ceil(sqrt(n))), so a digit always sits in the same spot,
  // which is what players scan for. Centre marks: one or two centred lines, shrunk to fit.
  function notes(i, mask, kind, hlBit) {
    const vals = [];
    for (let v = 0; v < symbols.length; v++) if (setHas(mask, v)) vals.push(v);
    if (!vals.length) return '';
    const x0 = cellX(i), y0 = cellY(i);
    let out = '';
    if (kind === 'corner') {
      const k = Math.ceil(Math.sqrt(symbols.length));
      const step = S / k;
      for (const v of vals) {
        const px = x0 + step * ((v % k) + 0.5), py = y0 + step * (Math.floor(v / k) + 0.5);
        const s = symbols[v], hl = hlBit === v;
        if (hl) out += `<circle class="sg-note-hlbg" cx="${f(px)}" cy="${f(py)}" r="${f(step * 0.46)}"/>`;
        out += s.color ? `<circle class="sd-note-sw" cx="${f(px)}" cy="${f(py)}" r="${f(step * 0.3)}" fill="${s.color}"/>`
          : `<text class="sd-note${hl ? ' sg-note-hl' : ''}" x="${f(px)}" y="${f(py + step * 0.24)}" font-size="${f(step * 0.66)}">${esc(s.text)}</text>`;
      }
      return out;
    }
    const list = vals.map((v) => symbols[v]);
    if (list.some((s) => s.color)) {
      const per = Math.min(5, list.length), rows = Math.ceil(list.length / per);
      const step = Math.min(S * 0.19, (S * 0.86) / per);
      list.forEach((s, k) => {
        const r = Math.floor(k / per), c = k % per, inRow = Math.min(per, list.length - r * per);
        out += `<circle class="sd-note-sw" cx="${f(x0 + S / 2 + (c - (inRow - 1) / 2) * step)}" cy="${f(y0 + S / 2 + (r - (rows - 1) / 2) * step)}" r="${f(step * 0.38)}" fill="${s.color || 'currentColor'}"/>`;
      });
      return out;
    }
    // centre marks: one line, two when long; the highlighted value in its own colour
    const texts = vals.map((v) => ({ v, s: list[vals.indexOf(v)].text }));
    const chars = texts.reduce((a, x) => a + graphemes(x.s).length, 0);
    const lines = chars > 6 ? [texts.slice(0, Math.ceil(texts.length / 2)), texts.slice(Math.ceil(texts.length / 2))] : [texts];
    const longest = Math.max(...lines.map((l) => l.reduce((a, x) => a + graphemes(x.s).length, 0)));
    const size = Math.min(S * 0.3, (S * 0.92) / Math.max(1, longest) * 1.75);
    lines.forEach((line, k) => {
      const y = y0 + S / 2 + size * 0.36 + (k - (lines.length - 1) / 2) * size * 1.05;
      out += `<text class="sd-note sd-note-center" x="${f(x0 + S / 2)}" y="${f(y)}" font-size="${f(size)}">` +
        line.map((x) => (x.v === hlBit ? `<tspan class="sg-note-hl">${esc(x.s)}</tspan>` : esc(x.s))).join('') + '</text>';
    });
    return out;
  }

  // Outline around a set of cells (selection): boundary edges only.
  // Selection outline = only the boundary edges of the cell set (an edge is drawn when the neighbour on that side
  // is not selected). One path for any shape, including holes and disjoint groups.
  function outline(cells, cls) {
    const set = new Set(cells);
    const has = (r, c) => r >= 0 && c >= 0 && r < geom.rows && c < geom.cols && set.has(r * geom.cols + c);
    let d = '';
    for (const i of set) {
      const r = Math.floor(i / geom.cols), c = i % geom.cols;
      const x = f(L.x(c)), y = f(L.y(r)), x2 = f(L.x(c + 1)), y2 = f(L.y(r + 1));
      if (!has(r - 1, c)) d += `M${x} ${y}H${x2}`;
      if (!has(r + 1, c)) d += `M${x} ${y2}H${x2}`;
      if (!has(r, c - 1)) d += `M${x} ${y}V${y2}`;
      if (!has(r, c + 1)) d += `M${x2} ${y}V${y2}`;
    }
    return d ? `<path class="${cls}" d="${d}"/>` : '';
  }

  // Stateless: everything comes from `st`. prevValues is the only memory, used to animate just the cells that got a
  // value since the last render (sg-pop).
  function render(st) {
    if (!puzzle) return;
    last = st;
    const cells = geom.cells;
    let colors = '', hl = '', text = '', sel = '';
    const values = st.values, givens = st.givens;
    const valueAt = (i) => givens[i] || values[i] || 0;
    // cell colours (colour mode)
    if (st.colors) for (const i of cells) if (st.colors[i]) colors += rect(i, `sg-col sg-col-${st.colors[i]}`);
    // highlights: hint area, peers, same symbol, selection fill, conflicts
    const hint = st.hint;
    if (hint && hint.area) for (const i of hint.area) hl += rect(i, 'sg-hint-area');
    if (st.tint) for (const i of st.tint) hl += rect(i, 'sg-peer');
    if (st.highlight) for (const i of cells) if (valueAt(i) === st.highlight) hl += rect(i, 'sg-same');
    if (st.selection) for (const i of st.selection) hl += rect(i, 'sg-selfill');
    if (st.conflicts) for (const i of st.conflicts) hl += rect(i, 'sg-conflict-bg', 4);
    if (hint && hint.cells) for (const i of hint.cells) hl += rect(i, 'sg-hint-cell', 3);
    // symbols and pencil marks
    const hlBit = st.highlight ? st.highlight - 1 : -1;
    const fresh = prevValues;
    for (const i of cells) {
      const g = givens[i], v = values[i];
      // Win wave delay grows with row + column: a diagonal sweep from the top-left corner.
      const wave = st.won ? ` style="--d:${(Math.floor(i / geom.cols) + (i % geom.cols)) * 28}ms"` : '';
      if (g) text += symbolMark(i, g, 'sd-given' + (st.conflicts && st.conflicts.has(i) ? ' sg-conflict' : '') + (st.won ? ' sg-wave' : ''), wave);
      else if (v) {
        let cls = 'sd-value';
        if (st.wrong && st.wrong.has(i)) cls += ' sg-wrong';
        else if (st.conflicts && st.conflicts.has(i)) cls += ' sg-conflict';
        if (fresh && !fresh[i]) cls += ' sg-pop';
        if (st.won) cls += ' sg-wave';
        // Shared games: an entry takes its author's colour (inline fill beats the class fill), except when wrong or
        // conflicting, where the warning colour must win.
        const own = st.owners && st.ownerColors && st.owners[i] >= 0 && !st.wrong?.has(i) && !st.conflicts?.has(i) ? ` style="fill:${st.ownerColors[st.owners[i] % st.ownerColors.length]}"` : '';
        text += symbolMark(i, v, cls, own || wave);
      } else {
        if (st.center && st.center[i]) text += notes(i, st.center[i], 'center', hlBit);
        if (st.corner && st.corner[i]) text += notes(i, st.corner[i], 'corner', hlBit);
      }
    }
    prevValues = values.slice();
    // hint target and eliminations
    if (hint && hint.target >= 0 && hint.value) {
      sel += rect(hint.target, 'sg-hint-target', 4);
      if (!valueAt(hint.target)) sel += symbolMark(hint.target, hint.value, 'sg-hint-ghost');
    }
    if (hint && hint.elim) {
      for (const [i, mask] of hint.elim) {
        if (valueAt(i)) continue;
        const k = Math.ceil(Math.sqrt(symbols.length)), step = S / k;
        for (let v = 0; v < symbols.length; v++) {
          if (!setHas(mask, v)) continue;
          const px = cellX(i) + step * ((v % k) + 0.5), py = cellY(i) + step * (Math.floor(v / k) + 0.5);
          const s = symbols[v];
          sel += s.color ? `<circle class="sg-elim-sw" cx="${f(px)}" cy="${f(py)}" r="${f(step * 0.28)}" fill="${s.color}"/>`
            : `<text class="sg-elim" x="${f(px)}" y="${f(py + step * 0.24)}" font-size="${f(step * 0.66)}">${esc(s.text)}</text>`;
          sel += `<path class="sg-elim-x" d="M${f(px - step * 0.3)} ${f(py - step * 0.3)}L${f(px + step * 0.3)} ${f(py + step * 0.3)}"/>`;
        }
      }
    }
    // other players' cursors, then the selection on top
    for (const cur of st.cursors || []) {
      if (!(cur.cell >= 0) || !geom.present[cur.cell]) continue;
      sel += rect(cur.cell, 'sg-cursor', 5, ` style="stroke:${cur.color}"`);
      if (cur.label) sel += `<text class="sg-cursor-tag" x="${f(cellX(cur.cell) + S - 9)}" y="${f(cellY(cur.cell) + 24)}" style="fill:${cur.color}">${esc(cur.label)}</text>`;
    }
    if (st.selection && st.selection.size) sel += outline(st.selection, 'sg-selline');
    layer.colors.innerHTML = colors;
    layer.hl.innerHTML = hl;
    layer.text.innerHTML = text;
    layer.sel.innerHTML = sel;
    svg.classList.toggle('sg-won', !!st.won);
    vp.classList.toggle('sg-readonly', !!st.readOnly);
  }

  // --- pointer input --------------------------------------------------------------------------------------------------

  const pts = new Map();
  let gesture = null;
  let lastTap = { cell: -1, at: 0 };
  let spaceHeld = false;
  const local = (e) => { const r = vp.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const readOnly = () => !!(last && last.readOnly);

  function startPinch() {
    const [a, b] = [...pts.values()];
    gesture = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, s0: scale, tx0: tx, ty0: ty };
  }

  // Pointer Events unify mouse, touch and pen. Capture keeps move/up events flowing to the viewport even when the
  // finger leaves it. Mouse selects immediately; touch starts as 'pending' and becomes select or pan only after
  // 9px of movement, so a tap is never mistaken for a drag (and vice versa).
  vp.addEventListener('pointerdown', (e) => {
    if (!L) return;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return; // right button: the cell menu
    try { vp.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const p = local(e);
    pts.set(e.pointerId, p);
    if (pts.size === 2 && e.pointerType !== 'mouse') { startPinch(); return; }
    if (pts.size > 1) return;
    if (e.button === 1 || spaceHeld) { e.preventDefault(); gesture = { kind: 'pan', x: p.x, y: p.y }; return; }
    const cell = cellAt(e.clientX, e.clientY);
    const mode = e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'add' : 'set';
    gesture = { kind: e.pointerType === 'mouse' ? 'select' : 'pending', x0: p.x, y0: p.y, x: p.x, y: p.y, cell, moved: false };
    if (cell >= 0 && !readOnly()) opts.select?.(cell, mode);
    if (e.pointerType === 'mouse') vp.focus({ preventScroll: true });
  });

  vp.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !gesture) return;
    const p = local(e);
    pts.set(e.pointerId, p);
    // Pinch: scale by the ratio of finger distances, anchored at the moving midpoint (same fixed-point formula as zoom).
    if (gesture.kind === 'pinch') {
      if (pts.size < 2) return;
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      scale = Math.min(maxScale(), Math.max(1, gesture.s0 * d / gesture.d0));
      tx = m.x - (gesture.m0.x - gesture.tx0) * (scale / gesture.s0);
      ty = m.y - (gesture.m0.y - gesture.ty0) * (scale / gesture.s0);
      applyTransform();
      return;
    }
    if (gesture.kind === 'pending') {
      if (Math.hypot(p.x - gesture.x0, p.y - gesture.y0) < 9) return;
      gesture.kind = scale > 1.01 || readOnly() ? 'pan' : 'select';
      gesture.x = p.x; gesture.y = p.y;
    }
    if (gesture.kind === 'pan') {
      tx += p.x - gesture.x; ty += p.y - gesture.y;
      gesture.x = p.x; gesture.y = p.y;
      gesture.moved = true;
      applyTransform();
    } else if (gesture.kind === 'select' && !readOnly()) {
      const cell = cellAt(e.clientX, e.clientY);
      if (cell >= 0 && cell !== gesture.cell) { gesture.cell = cell; gesture.moved = true; opts.select?.(cell, 'add'); }
    }
  });

  // Double tap = two taps on the same cell within 380ms (no dblclick: it does not fire for touch in all engines and
  // would add delay). Lifting one finger of a pinch continues as a pan with the other.
  function endPointer(e) {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (!gesture) return;
    if (gesture.kind === 'pinch') {
      if (pts.size === 1) { const [p] = [...pts.values()]; gesture = { kind: 'pan', x: p.x, y: p.y, moved: true }; } else gesture = null;
      return;
    }
    if (pts.size) return;
    const g = gesture;
    gesture = null;
    if (e.type === 'pointercancel' || g.moved || g.kind === 'pan' || g.cell < 0) return;
    const now = performance.now();
    if (lastTap.cell === g.cell && now - lastTap.at < 380) { lastTap = { cell: -1, at: 0 }; opts.double?.(g.cell); }
    else lastTap = { cell: g.cell, at: now };
  }
  vp.addEventListener('pointerup', endPointer);
  vp.addEventListener('pointercancel', endPointer);
  vp.addEventListener('lostpointercapture', (e) => { if (pts.has(e.pointerId)) endPointer(e); });

  // passive:false is required to preventDefault (page zoom on Ctrl+wheel, page scroll while panning). Ctrl+wheel is
  // also what trackpad pinch sends in Chromium. deltaMode 1 = lines (Firefox mouse wheels), scaled up to pixels.
  vp.addEventListener('wheel', (e) => {
    if (!L) return;
    const p = local(e);
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      zoom(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.002)), p.x, p.y);
    } else if (scale > 1.01) {
      e.preventDefault();
      const k = e.deltaMode === 1 ? 20 : 1;
      if (e.shiftKey && !e.deltaX) tx -= e.deltaY * k;
      else { tx -= e.deltaX * k; ty -= e.deltaY * k; }
      applyTransform();
    }
  }, { passive: false });

  // Space + drag pans with the mouse.
  window.addEventListener('keydown', (e) => { if (e.code === 'Space' && e.target === vp) spaceHeld = true; });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceHeld = false; });
  // Safari's pinch gestures would zoom the page.
  // Safari-only non-standard gesture events.
  vp.addEventListener('gesturestart', (e) => e.preventDefault());

  // The cell menu: right click, long press, Menu key / Shift+F10 (the focused viewport opens it for the primary cell).
  if (opts.menu) {
    // Keyboard-opened menu passes -2 ("the primary selected cell"); a pointer outside the grid (-1) opens nothing.
    contextMenu(vp, (target, info) => {
      if (readOnly() || (gesture && gesture.kind === 'pinch')) return null;
      const cell = info.via === 'keyboard' ? -2 : cellAt(info.x, info.y);
      if (cell === -1) return null;
      return opts.menu(cell, info);
    }, { delay: 480 });
  }

  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => measure()).observe(vp);
  window.addEventListener('resize', measure);

  return {
    element: vp,
    setPuzzle,
    setSymbols,
    render,
    zoom,
    ensureVisible,
    cellAt,
    measure,
    scale: () => scale,
    geometry: () => geom,
  };
}
