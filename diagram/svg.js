// diagram/svg.js - SVG text of laid-out diagrams: node shapes (rect, round, stadium, subroutine, cylinder, circle,
// double circle, diamond, hexagon, parallelograms, trapezoids, asymmetric flag, note, text, point; compartments of
// class / entity boxes; the dot, bullseye and bar of state diagrams), smooth edges (B-spline through the layout points)
// with solid / dotted / thick / invisible lines and end markers (arrow, open, circle, cross, hollow triangle, filled
// and hollow diamond, crow's feet), edge labels on a backing, groups with headers, per-node and per-class styles,
// themes. Every id inside the picture carries a prefix so several diagrams can share a page. Text is escaped;
// nothing executes.
//
//   THEMES { light, dark, neutral, forest }    MARKERS { name: (id, color, hollowFill = '#fff') -> <marker> }
//   SHAPES { name: (n, st, theme) -> svg }      compartmentSize(sections, fontSize) -> { w, h }
//   renderSVG(layout, { theme = 'light', fontFamily, fontSize = 14, idPrefix, title, extra, className }) -> SVG text
//   nextId(prefix) -> a fresh picture id       textSVG(text, x, y, size, colour, { bold, italic, anchor }) -> SVG text
//   edgePath(points, curved = true) -> path data       esc(text)       styleOf(spec) -> { fill, stroke, … }

import { labelLines, textWidth } from './measure.js';

//
// Security model: every string from diagram source reaches the SVG through esc() (text and attribute values) or a
// whitelist (styleOf strips < > "). The output is meant for innerHTML, so an unescaped label would be an XSS vector;
// ' is escaped too, so the result is safe in single-quoted attributes as well.
// Paint order (renderSVG): groups, edges, nodes, edge labels. SVG has no z-index; document order is the stacking
// order, so labels must come last to sit above edges and nodes.
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => Math.round(v * 100) / 100;

// bg 'transparent' by default: the picture adopts the page background (light or dark page CSS) instead of a white
// slab. hollow: fill of open markers; dark theme overrides it, otherwise open arrowheads would be white on dark.
export const THEMES = {
  light: { bg: 'transparent', fill: '#eef1ff', stroke: '#6875d6', text: '#1d2130', edge: '#555b6e', label: '#ffffff', labelText: '#333847', group: '#fbf7e6', groupStroke: '#d6c98a', groupText: '#5b5230', note: '#fff5c2', noteStroke: '#d8b94a', accents: ['#e6f0ff', '#e9f8ee', '#fff1e3', '#f6e8ff', '#e3f7f7', '#fde8ee', '#f2f2dc', '#e8eaf6'] },
  dark: { bg: 'transparent', fill: '#232a48', stroke: '#8b98ff', text: '#e8eaf3', edge: '#a5abbd', label: '#15171f', hollow: '#15171f', labelText: '#d9dce6', group: '#25261c', groupStroke: '#6f6a3c', groupText: '#d9cf98', note: '#3a3417', noteStroke: '#8c7a2c', accents: ['#1f3150', '#1d3a2a', '#47321c', '#36234a', '#173c3c', '#4a2230', '#3a3a22', '#2a2d44'] },
  neutral: { bg: 'transparent', fill: '#f4f4f4', stroke: '#666666', text: '#222222', edge: '#555555', label: '#ffffff', labelText: '#333333', group: '#fafafa', groupStroke: '#bbbbbb', groupText: '#444444', note: '#f8f8e8', noteStroke: '#aaaa77', accents: ['#eeeeee', '#e4e4e4', '#f6f6f6', '#dddddd', '#ebebeb', '#f0f0f0', '#e8e8e8', '#f3f3f3'] },
  forest: { bg: 'transparent', fill: '#e6f2dc', stroke: '#4c8a3a', text: '#1e2a19', edge: '#4a5a44', label: '#f6fbf2', labelText: '#2a3a24', group: '#f3f7e6', groupStroke: '#9db57a', groupText: '#3c5a2a', note: '#fbf6d8', noteStroke: '#b5a24a', accents: ['#dff0d0', '#eaf4d8', '#f4efd2', '#dcefe4', '#e8f0c8', '#d6eadc', '#eef6e0', '#e2ecd4'] },
};

// classDef / style specs: 'fill:#f9f,stroke:#333,stroke-width:2px,color:#fff,stroke-dasharray:5 5,font-weight:bold'
// Mermaid style syntax, split on , or ; (both appear in the wild). Unknown keys are ignored, not passed through:
// passing raw CSS would reopen injection (url(), expression()) and make output engine-dependent.
export function styleOf(spec) {
  if (!spec) return {};
  if (typeof spec === 'object') return spec;
  const out = {};
  for (const part of String(spec).split(/[,;]/)) {
    const m = /^\s*([a-z-]+)\s*:\s*(.+?)\s*$/i.exec(part);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].replace(/[<>"]/g, '');
    if (k === 'fill') out.fill = v;
    else if (k === 'stroke') out.stroke = v;
    else if (k === 'stroke-width') out.strokeWidth = parseFloat(v) || 1;
    else if (k === 'stroke-dasharray') out.dash = v;
    else if (k === 'color') out.color = v;
    else if (k === 'font-weight') out.bold = /bold|[6-9]00/.test(v);
    else if (k === 'font-style') out.italic = /italic/.test(v);
    else if (k === 'opacity') out.opacity = parseFloat(v);
  }
  return out;
}

const attrs = (st, t) => `fill="${esc(st.fill || t.fill)}" stroke="${esc(st.stroke || t.stroke)}" stroke-width="${st.strokeWidth || 1.4}"${st.dash ? ` stroke-dasharray="${esc(st.dash)}"` : ''}${st.opacity != null ? ` opacity="${st.opacity}"` : ''}`;
const poly = (pts) => pts.map((p) => num(p[0]) + ',' + num(p[1])).join(' ');

// Shape drawers: n = { x, y, w, h } (centre and size), st = resolved style, t = theme.
// Every drawer is a pure (n, st, t) -> markup function keyed by shape name, so kinds can add shapes (Object.assign
// below) without touching renderSVG. Unknown shape names fall back to rect in renderSVG.
export const SHAPES = {
  rect: (n, st, t) => `<rect x="${num(n.x - n.w / 2)}" y="${num(n.y - n.h / 2)}" width="${num(n.w)}" height="${num(n.h)}" rx="2" ${attrs(st, t)}/>`,
  round: (n, st, t) => `<rect x="${num(n.x - n.w / 2)}" y="${num(n.y - n.h / 2)}" width="${num(n.w)}" height="${num(n.h)}" rx="8" ${attrs(st, t)}/>`,
  stadium: (n, st, t) => `<rect x="${num(n.x - n.w / 2)}" y="${num(n.y - n.h / 2)}" width="${num(n.w)}" height="${num(n.h)}" rx="${num(n.h / 2)}" ${attrs(st, t)}/>`,
  subroutine: (n, st, t) => SHAPES.rect(n, st, t) + `<path d="M${num(n.x - n.w / 2 + 7)} ${num(n.y - n.h / 2)}v${num(n.h)}M${num(n.x + n.w / 2 - 7)} ${num(n.y - n.h / 2)}v${num(n.h)}" fill="none" ${attrs({ ...st, fill: 'none' }, t)}/>`,
  cylinder: (n, st, t) => {
    const x0 = n.x - n.w / 2, x1 = n.x + n.w / 2, y0 = n.y - n.h / 2 + 6, y1 = n.y + n.h / 2 - 6, rx = n.w / 2, ry = 6;
    return `<path d="M${num(x0)} ${num(y0)}A${num(rx)} ${ry} 0 0 1 ${num(x1)} ${num(y0)}V${num(y1)}A${num(rx)} ${ry} 0 0 1 ${num(x0)} ${num(y1)}Z" ${attrs(st, t)}/><path d="M${num(x0)} ${num(y0)}A${num(rx)} ${ry} 0 0 0 ${num(x1)} ${num(y0)}" fill="none" ${attrs({ ...st, fill: 'none' }, t)}/>`;
  },
  circle: (n, st, t) => `<ellipse cx="${num(n.x)}" cy="${num(n.y)}" rx="${num(n.w / 2)}" ry="${num(n.h / 2)}" ${attrs(st, t)}/>`,
  ellipse: (n, st, t) => SHAPES.circle(n, st, t),
  doublecircle: (n, st, t) => SHAPES.circle(n, st, t) + `<ellipse cx="${num(n.x)}" cy="${num(n.y)}" rx="${num(n.w / 2 - 4)}" ry="${num(n.h / 2 - 4)}" fill="none" ${attrs({ ...st, fill: 'none' }, t)}/>`,
  diamond: (n, st, t) => `<polygon points="${poly([[n.x, n.y - n.h / 2], [n.x + n.w / 2, n.y], [n.x, n.y + n.h / 2], [n.x - n.w / 2, n.y]])}" ${attrs(st, t)}/>`,
  hexagon: (n, st, t) => { const k = n.h * 0.35; return `<polygon points="${poly([[n.x - n.w / 2 + k, n.y - n.h / 2], [n.x + n.w / 2 - k, n.y - n.h / 2], [n.x + n.w / 2, n.y], [n.x + n.w / 2 - k, n.y + n.h / 2], [n.x - n.w / 2 + k, n.y + n.h / 2], [n.x - n.w / 2, n.y]])}" ${attrs(st, t)}/>`; },
  parallelogram: (n, st, t) => { const k = n.h * 0.4; return `<polygon points="${poly([[n.x - n.w / 2 + k, n.y - n.h / 2], [n.x + n.w / 2, n.y - n.h / 2], [n.x + n.w / 2 - k, n.y + n.h / 2], [n.x - n.w / 2, n.y + n.h / 2]])}" ${attrs(st, t)}/>`; },
  parallelogramAlt: (n, st, t) => { const k = n.h * 0.4; return `<polygon points="${poly([[n.x - n.w / 2, n.y - n.h / 2], [n.x + n.w / 2 - k, n.y - n.h / 2], [n.x + n.w / 2, n.y + n.h / 2], [n.x - n.w / 2 + k, n.y + n.h / 2]])}" ${attrs(st, t)}/>`; },
  trapezoid: (n, st, t) => { const k = n.h * 0.4; return `<polygon points="${poly([[n.x - n.w / 2 + k, n.y - n.h / 2], [n.x + n.w / 2 - k, n.y - n.h / 2], [n.x + n.w / 2, n.y + n.h / 2], [n.x - n.w / 2, n.y + n.h / 2]])}" ${attrs(st, t)}/>`; },
  trapezoidAlt: (n, st, t) => { const k = n.h * 0.4; return `<polygon points="${poly([[n.x - n.w / 2, n.y - n.h / 2], [n.x + n.w / 2, n.y - n.h / 2], [n.x + n.w / 2 - k, n.y + n.h / 2], [n.x - n.w / 2 + k, n.y + n.h / 2]])}" ${attrs(st, t)}/>`; },
  asymmetric: (n, st, t) => { const k = n.h * 0.4; return `<polygon points="${poly([[n.x - n.w / 2, n.y - n.h / 2], [n.x + n.w / 2, n.y - n.h / 2], [n.x + n.w / 2, n.y + n.h / 2], [n.x - n.w / 2, n.y + n.h / 2], [n.x - n.w / 2 + k, n.y]])}" ${attrs(st, t)}/>`; },
  note: (n, st, t) => { const x0 = n.x - n.w / 2, y0 = n.y - n.h / 2, k = 8; return `<path d="M${num(x0)} ${num(y0)}h${num(n.w - k)}l${k} ${k}v${num(n.h - k)}h${num(-n.w)}z" ${attrs({ fill: t.note, stroke: t.noteStroke, ...st }, t)}/>`; },
  text: () => '',
  point: (n, st, t) => `<circle cx="${num(n.x)}" cy="${num(n.y)}" r="5" fill="${esc(st.stroke || t.text)}"/>`,
};

// Boxes divided into compartments (class and entity diagrams): n.sections = [{ lines: [text], bold, italic,
// align: 'middle' | 'start' } | { rows: [[cell]] (aligned columns) }], drawn at n.fontSize (14). compartmentSize gives
// the box of a list of sections; the kind sets n.w / n.h from it and leaves n.label empty.
// rows: column widths are the max over all rows, so members of a class box line up like a table. The 4th column
// (index 3) is rendered italic: in ER attribute rows [type, name, keys, comment] it is the comment.
const CPAD = { x: 10, y: 5, gap: 14 };
function sectionsOf(sections, fs) {
  const lh = fs * 1.3;
  return (sections || []).map((s) => {
    if (s.rows) {
      const cols = [];
      for (const r of s.rows) r.forEach((c, i) => { cols[i] = Math.max(cols[i] || 0, textWidth(c, fs * 0.92)); });
      const w = cols.reduce((a, c) => a + c, 0) + CPAD.gap * Math.max(0, cols.filter(Boolean).length - 1) + 2 * CPAD.x;
      return { s, cols, w, h: s.rows.length ? s.rows.length * lh + 2 * CPAD.y : 10 };
    }
    const lines = s.lines || [];
    const w = Math.max(0, ...lines.map((l) => textWidth(l, fs, { bold: s.bold }))) + 2 * CPAD.x;
    return { s, w, h: lines.length ? lines.length * lh + 2 * CPAD.y : 10 };
  });
}
export function compartmentSize(sections, fontSize = 14) {
  const L = sectionsOf(sections, fontSize);
  return { w: Math.max(60, ...L.map((x) => x.w)), h: L.reduce((a, x) => a + x.h, 0) || 24 };
}
// Text of one or more lines ('\n', <br>) centred on (x, y): size, colour, { bold, italic, anchor }.
export const textSVG = (text, x, y, size, color, o = {}) => textBlock(labelLines(text), x, y, size, color, o);
Object.assign(SHAPES, {
  compartments: (n, st, t) => {
    const fs = n.fontSize || 14, lh = fs * 1.3, color = st.color || t.text;
    const x0 = n.x - n.w / 2;
    let y = n.y - n.h / 2;
    let out = `<rect x="${num(x0)}" y="${num(y)}" width="${num(n.w)}" height="${num(n.h)}" rx="3" ${attrs(st, t)}/>`;
    sectionsOf(n.sections, fs).forEach((L, k) => {
      if (k) out += `<path d="M${num(x0)} ${num(y)}h${num(n.w)}" stroke="${esc(st.stroke || t.stroke)}" stroke-width="1"/>`;
      const top = y + CPAD.y + lh / 2;
      if (L.s.rows) {
        L.s.rows.forEach((r, i) => {
          let cx = x0 + CPAD.x;
          r.forEach((c, j) => { if (c) out += textBlock([String(c)], cx, top + i * lh, fs * 0.92, color, { anchor: 'start', italic: j === 3 }); cx += (L.cols[j] || 0) + (L.cols[j] ? CPAD.gap : 0); });
        });
      } else {
        const mid = L.s.align !== 'start';
        (L.s.lines || []).forEach((l, i) => { out += textBlock([l], mid ? n.x : x0 + CPAD.x, top + i * lh, fs, color, { anchor: mid ? 'middle' : 'start', bold: L.s.bold, italic: L.s.italic }); });
      }
      y += L.h;
    });
    return out;
  },
  // State diagrams: the start dot, the end bullseye, fork / join bars.
  dot: (n, st, t) => `<circle cx="${num(n.x)}" cy="${num(n.y)}" r="${num(Math.min(n.w, n.h) / 2)}" fill="${esc(st.fill || t.text)}"/>`,
  bullseye: (n, st, t) => `<circle cx="${num(n.x)}" cy="${num(n.y)}" r="${num(Math.min(n.w, n.h) / 2)}" fill="none" stroke="${esc(st.stroke || t.text)}" stroke-width="1.6"/><circle cx="${num(n.x)}" cy="${num(n.y)}" r="${num(Math.min(n.w, n.h) / 2 - 3.5)}" fill="${esc(st.fill || t.text)}"/>`,
  bar: (n, st, t) => `<rect x="${num(n.x - n.w / 2)}" y="${num(n.y - n.h / 2)}" width="${num(n.w)}" height="${num(n.h)}" rx="2" fill="${esc(st.fill || t.text)}"/>`,
});

// End markers (drawn at the end of a path pointing along it). Each returns <marker> text for an id and a colour.
// markerUnits userSpaceOnUse: marker size does not scale with stroke-width, so thick edges keep normal arrowheads.
// orient auto-start-reverse: one marker definition serves both ends; at marker-start it is flipped to point outward.
// refX is the tip of each shape, so the tip touches the path end (which layout clipped to the node border).
const mk = (id, body, { w = 12, h = 12, rx = 10, ry = 6 } = {}) => `<marker id="${id}" viewBox="0 0 ${w} ${h}" refX="${rx}" refY="${ry}" markerWidth="${w}" markerHeight="${h}" markerUnits="userSpaceOnUse" orient="auto-start-reverse">${body}</marker>`;
export const MARKERS = {
  arrow: (id, c) => mk(id, `<path d="M1 1.5L11 6L1 10.5z" fill="${c}"/>`, { rx: 10.5 }),
  open: (id, c) => mk(id, `<path d="M1 1.5L11 6L1 10.5" fill="none" stroke="${c}" stroke-width="1.4"/>`, { rx: 10.5 }),
  circle: (id, c) => mk(id, `<circle cx="6" cy="6" r="4" fill="${c}"/>`, { rx: 9 }),
  circleOpen: (id, c, bg = '#fff') => mk(id, `<circle cx="6" cy="6" r="4" fill="${bg}" stroke="${c}" stroke-width="1.4"/>`, { rx: 10 }),
  cross: (id, c) => mk(id, `<path d="M2 2L10 10M10 2L2 10" stroke="${c}" stroke-width="1.8"/>`, { rx: 7 }),
  triangle: (id, c, bg = '#fff') => mk(id, `<path d="M1 1L15 8L1 15z" fill="${bg}" stroke="${c}" stroke-width="1.3"/>`, { w: 16, h: 16, rx: 15, ry: 8 }),
  diamond: (id, c) => mk(id, `<path d="M1 7L9 2L17 7L9 12z" fill="${c}"/>`, { w: 18, h: 14, rx: 17, ry: 7 }),
  diamondOpen: (id, c, bg = '#fff') => mk(id, `<path d="M1 7L9 2L17 7L9 12z" fill="${bg}" stroke="${c}" stroke-width="1.3"/>`, { w: 18, h: 14, rx: 17, ry: 7 }),
  // Crow's feet (ER): the end touches the entity at x = 17.
  one: (id, c) => mk(id, `<path d="M17 9H0M11 2v14M7 2v14" stroke="${c}" stroke-width="1.3" fill="none"/>`, { w: 18, h: 18, rx: 17, ry: 9 }),
  zeroOrOne: (id, c, bg = '#fff') => mk(id, `<path d="M17 9H10M11 2v14" stroke="${c}" stroke-width="1.3" fill="none"/><circle cx="5" cy="9" r="4" fill="${bg}" stroke="${c}" stroke-width="1.3"/>`, { w: 18, h: 18, rx: 17, ry: 9 }),
  oneOrMany: (id, c) => mk(id, `<path d="M17 2L9 9L17 16M17 9H0M6 2v14" stroke="${c}" stroke-width="1.3" fill="none"/>`, { w: 18, h: 18, rx: 17, ry: 9 }),
  zeroOrMany: (id, c, bg = '#fff') => mk(id, `<path d="M21 2L13 9L21 16M21 9H10" stroke="${c}" stroke-width="1.3" fill="none"/><circle cx="6" cy="9" r="4" fill="${bg}" stroke="${c}" stroke-width="1.3"/>`, { w: 22, h: 18, rx: 21, ry: 9 }),
};

// A B-spline (like d3's curveBasis) through the points; straight segments when there are two points.
// Why B-spline and not Catmull-Rom: a B-spline does not pass through the inner points, it stays inside their convex
// hull, so it never overshoots into neighbouring nodes. Dummy points from the layout are guides, not must-pass points.
export function edgePath(pts, curved = true) {
  if (!pts.length) return '';
  const P = (p) => num(p[0]) + ' ' + num(p[1]);
  if (pts.length === 2 || !curved) return 'M' + pts.map(P).join('L');
  // Uniform cubic B-spline clamped to the end points (d3's curveBasis).
  let d = 'M' + P(pts[0]);
  let [x0, y0] = pts[0], [x1, y1] = pts[1];
  const seg = (x, y) => {
    d += `C${num((2 * x0 + x1) / 3)} ${num((2 * y0 + y1) / 3)} ${num((x0 + 2 * x1) / 3)} ${num((y0 + 2 * y1) / 3)} ${num((x0 + 4 * x1 + x) / 6)} ${num((y0 + 4 * y1 + y) / 6)}`;
  };
  for (let i = 2; i < pts.length; i++) {
    const [x, y] = pts[i];
    if (i === 2) d += `L${num((5 * x0 + x1) / 6)} ${num((5 * y0 + y1) / 6)}`;
    seg(x, y);
    x0 = x1; y0 = y1; x1 = x; y1 = y;
  }
  seg(x1, y1);
  d += 'L' + P([x1, y1]);
  return d;
}

function textBlock(lines, x, y, size, color, { bold, italic, anchor = 'middle' } = {}) {
  if (!lines.length) return '';
  const lh = size * 1.3;
  const top = y - ((lines.length - 1) * lh) / 2;
  const style = `${bold ? ' font-weight="600"' : ''}${italic ? ' font-style="italic"' : ''}`;
  return `<text x="${num(x)}" text-anchor="${anchor}" dominant-baseline="central" font-size="${num(size)}" fill="${esc(color)}"${style}>` +
    lines.map((l, i) => `<tspan x="${num(x)}" y="${num(top + i * lh)}">${esc(l)}</tspan>`).join('') + '</text>';
}

// Module-level counter: ids unique within one page session. Not stable across reloads; pass idPrefix for
// deterministic output (snapshot tests, server rendering where several processes generate ids).
let seq = 0;
// A fresh id for one picture (every id inside it starts with this prefix): shared by all diagram kinds.
export const nextId = (prefix) => (prefix || 'dg') + (++seq).toString(36);
export function renderSVG(L, opts = {}) {
  const t = { ...(THEMES[opts.theme] || THEMES.light), ...(opts.colors || {}) };
  const fs = opts.fontSize || 14;
  const id = nextId(opts.idPrefix);
  const classes = opts.classes || {};
  const out = [];
  const used = new Map();
  const marker = (name, color) => {
    if (!name || name === 'none' || !MARKERS[name]) return '';
    const key = name + '|' + color;
    if (!used.has(key)) used.set(key, { id: `${id}-m${used.size}`, svg: null, name, color });
    return used.get(key).id;
  };
  // Groups (outer first), then edges, then nodes, then edge labels on top.
  for (const g of L.groups || []) {
    const st = { ...styleOf(classes[g.cls]), ...styleOf(g.style) };
    out.push(`<g class="dg-group"><rect x="${num(g.x)}" y="${num(g.y)}" width="${num(g.w)}" height="${num(g.h)}" rx="6" fill="${esc(st.fill || t.group)}" stroke="${esc(st.stroke || t.groupStroke)}" stroke-width="${st.strokeWidth || 1.2}"${st.dash ? ` stroke-dasharray="${esc(st.dash)}"` : ''}/>` +
      (g.label ? textBlock(labelLines(g.label), g.x + g.w / 2, g.y + 6 + (labelLines(g.label).length * fs * 0.92 * 1.3) / 2, fs * 0.92, st.color || t.groupText, { bold: true }) : '') + '</g>');
  }
  // KNOWN DEFECT: a dotted edge with a style dash emits stroke-dasharray twice in one element. Duplicate attributes
  // are a well-formedness error in XML (an .svg file or XHTML refuses to load); the HTML parser silently keeps the
  // first one, so the style dash is ignored. Fix: emit one attribute, st.dash taking precedence over the dotted default.
  for (const e of L.edges || []) {
    if (e.line === 'invisible') continue;
    const st = styleOf(e.style);
    const color = st.stroke || t.edge;
    const w = st.strokeWidth || (e.line === 'thick' ? 3 : 1.4);
    const head = marker(e.head == null ? 'arrow' : e.head, color), tail = marker(e.tail, color);
    out.push(`<path class="dg-edge" d="${edgePath(e.points, e.curved !== false)}" fill="none" stroke="${esc(color)}" stroke-width="${w}"${e.line === 'dotted' ? ' stroke-dasharray="3 4"' : ''}${st.dash ? ` stroke-dasharray="${esc(st.dash)}"` : ''}${head ? ` marker-end="url(#${head})"` : ''}${tail ? ` marker-start="url(#${tail})"` : ''}/>`);
  }
  for (const n of L.nodes || []) {
    const st = { ...styleOf(n.cls && [].concat(n.cls).map((c) => classes[c]).filter(Boolean).reduce((a, s) => ({ ...a, ...styleOf(s) }), {})), ...styleOf(n.style) };
    // Double modulo: a negative accent index still maps into the palette (JS % keeps the sign of the dividend).
    if (n.accent != null && !st.fill) st.fill = t.accents[((n.accent % t.accents.length) + t.accents.length) % t.accents.length];
    const draw = SHAPES[n.shape] || SHAPES.rect;
    const lines = labelLines(n.label == null ? n.id : n.label);
    const title = n.tooltip ? `<title>${esc(n.tooltip)}</title>` : '';
    // Empty label lines are dropped only when the label is a single line, so an intentionally blank middle line of a
    // multi-line label keeps its height. Cylinder text is nudged down by 4 to centre it below the top ellipse.
    out.push(`<g class="dg-node" data-id="${esc(n.id)}">${title}${draw(n, st, t)}${n.shape === 'point' ? '' : textBlock(lines.filter((l, i) => l || lines.length > 1), n.x, n.y + (n.shape === 'cylinder' ? 4 : 0), n.fontSize || fs, st.color || t.text, { bold: st.bold, italic: st.italic })}</g>`);
  }
  for (const e of L.edges || []) {
    if (!e.labelBox || e.line === 'invisible') continue;
    const b = e.labelBox;
    out.push(`<g class="dg-elabel"><rect x="${num(b.x - b.w / 2)}" y="${num(b.y - b.h / 2)}" width="${num(b.w)}" height="${num(b.h)}" rx="3" fill="${esc(t.label)}" opacity="0.92"/>${textBlock(labelLines(e.label), b.x, b.y, fs * 0.9, t.labelText)}</g>`);
  }
  if (opts.extra) out.push(opts.extra);
  const defs = [...used.values()].map((m) => MARKERS[m.name](m.id, esc(m.color), esc(t.hollow || '#fff'))).join('');
  const W = Math.ceil(L.width), H = Math.ceil(L.height);
  const font = esc(opts.fontFamily || 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Georgian", sans-serif');
  return `<svg xmlns="http://www.w3.org/2000/svg" class="dg${opts.className ? ' ' + esc(opts.className) : ''}" id="${id}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"${opts.title ? ` aria-label="${esc(opts.title)}"` : ''} font-family="${font}">` +
    (opts.title ? `<title>${esc(opts.title)}</title>` : '') + (defs ? `<defs>${defs}</defs>` : '') +
    (t.bg && t.bg !== 'transparent' ? `<rect width="${W}" height="${H}" fill="${esc(t.bg)}"/>` : '') + out.join('') + '</svg>';
}
