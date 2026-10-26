// diagram/mindmap.js - the Mermaid mind map: a tree by indentation with one root, node shapes id[square],
// id(rounded), id((circle)), id))bang((, id)cloud(, id{{hexagon}} and plain text, Markdown strings ("`**text**`"),
// <br> line breaks; ::icon(…) lines and :::classes are accepted and ignored. Drawn as a two-sided tree: the root in
// the middle, its branches balanced left and right, each branch in its own colour.
//
//   parseMindmap(src) -> root { label, shape, children: [node] }        mindmapSVG(src, opts) -> SVG text

import { registerDiagram } from './index.js';
import { nextId, esc, SHAPES } from './svg.js';
import { labelBox } from './measure.js';
import { sourceLines, themeOf, textAt, svgDoc, fail, num, ink } from './kit.js';

//
// Tree by indentation: a stack of (indent, node); a line's parent is the nearest previous line with smaller indent.
// Comparing raw widths (tabs already expanded to 4 spaces by kit.sourceLines) means inconsistent indentation still
// nests sensibly instead of erroring, as Mermaid does.
// Layout: classic tidy tree per side. span(n) = max(own height, sum of children spans + gaps); a node is centred on
// its children's block. Root branches are assigned greedily to the shorter side (by accumulated span) so the two
// halves balance; this is the LPT heuristic for 2-partition, not optimal but good and order-preserving.
//
// FORMS order matters: '((' circle before '(' rounded, '))…((' bang before ')…(' cloud, or the shorter form would
// match first and leave brackets in the label.
const FORMS = [
  [/^([^\s([{)]*)\(\((.*)\)\)$/, 'circle'], [/^([^\s([{)]*)\)\)(.*)\(\($/, 'bang'], [/^([^\s([{)]*)\)(.*)\($/, 'cloud'],
  [/^([^\s([{)]*)\{\{(.*)\}\}$/, 'hexagon'], [/^([^\s([{)]*)\[(.*)\]$/, 'square'], [/^([^\s([{)]*)\((.*)\)$/, 'rounded'],
];
const clean = (s) => {
  let t = String(s).trim();
  if (/^".*"$/.test(t)) t = t.slice(1, -1);
  if (/^`.*`$/s.test(t)) t = t.slice(1, -1).replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1');
  return t.replace(/\\n/g, '\n');
};

export function parseMindmap(src) {
  const { lines } = sourceLines(src);
  let root = null;
  const stack = [];
  let header = false;
  for (const { text, raw, line } of lines) {
    if (!header) { if (/^mindmap\b/.test(text)) { header = true; continue; } fail(line, 'expected "mindmap"'); }
    if (/^::icon\(/.test(text)) continue;
    const indent = raw.length - raw.trimStart().length;
    const body = text.replace(/:::[\w\s-]+$/, '').trim();
    if (!body) continue;
    let node = { label: clean(body), shape: 'default', children: [] };
    for (const [re, shape] of FORMS) { const m = re.exec(body); if (m) { node = { id: m[1], label: clean(m[2]), shape, children: [] }; break; } }
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (!stack.length) {
      if (root) fail(line, 'a mind map has one root: "' + body.slice(0, 40) + '" is indented like the root');
      root = node;
    } else stack[stack.length - 1].node.children.push(node);
    stack.push({ indent, node });
  }
  if (!header) fail(0, 'expected "mindmap"');
  if (!root) fail(0, 'the mind map is empty');
  return root;
}

// Visual hierarchy: depth 0 bold and larger, depth 1 filled with its branch colour, deeper "default" nodes are just
// underlined text (Mermaid's look), so deep maps stay light. Edge width tapers with depth.
export function mindmapSVG(src, opts = {}) {
  const root = parseMindmap(src);
  const t = themeOf(opts);
  const fs = opts.fontSize || 14;
  const id = nextId(opts.idPrefix);
  const gapX = 44, gapY = 14;
  // Sizes.
  const size = (n, depth) => {
    n.depth = depth;
    n.fs = depth === 0 ? fs * 1.15 : depth === 1 ? fs : fs * 0.92;
    const b = labelBox(n.label, { fontSize: n.fs, bold: depth === 0 });
    let w = b.w + (n.shape === 'default' && depth > 1 ? 12 : 28), h = b.h + (n.shape === 'default' && depth > 1 ? 10 : 18);
    if (n.shape === 'circle') { const d = Math.max(w, h) + 4; w = h = d; }
    if (n.shape === 'cloud' || n.shape === 'bang') { w += 24; h += 16; }
    if (n.shape === 'hexagon') w += h * 0.6;
    n.w = w; n.h = h;
    n.children.forEach((c) => size(c, depth + 1));
  };
  size(root, 0);
  const span = (n) => (n.span = Math.max(n.h, n.children.reduce((a, c) => a + span(c), 0) + gapY * Math.max(0, n.children.length - 1)));
  // Branches split between the sides by height.
  const right = [], left = [];
  let hr = 0, hl = 0;
  root.children.forEach((c, i) => { span(c); c.branch = i; if (hr <= hl) { right.push(c); hr += c.span + gapY; } else { left.push(c); hl += c.span + gapY; } });
  const place = (n, x, y, dir) => {
    n.x = x; n.y = y; n.dir = dir;
    let cy = y - (n.children.reduce((a, c) => a + c.span, 0) + gapY * Math.max(0, n.children.length - 1)) / 2;
    // Edges end at the underline of underlined children (y + h/2), at the centre for boxed ones; horizontal-tangent
    // cubic curves (control points at the x midpoint) give the organic mind-map look.
    for (const c of n.children) {
      c.branch = n.branch;
      place(c, x + dir * (n.w / 2 + gapX + c.w / 2), cy + c.span / 2, dir);
      cy += c.span + gapY;
    }
  };
  root.x = 0; root.y = 0;
  const side = (list, dir) => {
    let y = -(list.reduce((a, c) => a + c.span, 0) + gapY * Math.max(0, list.length - 1)) / 2;
    for (const c of list) { place(c, dir * (root.w / 2 + gapX * 1.3 + c.w / 2), y + c.span / 2, dir); y += c.span + gapY; }
  };
  side(right, 1);
  side(left, -1);
  const all = [];
  const walk = (n) => { all.push(n); n.children.forEach(walk); };
  walk(root);
  const minX = Math.min(...all.map((n) => n.x - n.w / 2)) - 14, minY = Math.min(...all.map((n) => n.y - n.h / 2)) - 14;
  const maxX = Math.max(...all.map((n) => n.x + n.w / 2)) + 14, maxY = Math.max(...all.map((n) => n.y + n.h / 2)) + 14;
  for (const n of all) { n.x -= minX; n.y -= minY; }
  const col = (n) => t.palette[(n.branch || 0) % t.palette.length];
  const body = [];
  for (const n of all) {
    for (const c of n.children) {
      const x1 = n.x + c.dir * (n.w / 2) * (n.shape === 'circle' ? 0.9 : 1), y1 = n.y;
      const x2 = c.x - c.dir * c.w / 2, y2 = c.y + (c.shape === 'default' && c.depth > 1 ? c.h / 2 : 0);
      const mx = (x1 + x2) / 2;
      body.push(`<path class="dg-edge" d="M${num(x1)} ${num(y1)}C${num(mx)} ${num(y1)} ${num(mx)} ${num(y2)} ${num(x2)} ${num(y2)}" fill="none" stroke="${esc(col(c))}" stroke-width="${Math.max(1.5, 4.5 - c.depth)}" stroke-linecap="round"/>`);
    }
  }
  for (const n of all) {
    const c = n.depth === 0 ? t.stroke : col(n);
    const fill = n.depth === 0 ? t.fill : n.depth === 1 ? c : t.hollow || '#ffffff';
    const textColor = n.depth === 1 ? ink(c) : t.text;
    const st = { fill, stroke: c, strokeWidth: n.depth === 0 ? 2 : 1.4 };
    let shape;
    const x0 = n.x - n.w / 2, y0 = n.y - n.h / 2;
    switch (n.shape) {
      case 'square': shape = SHAPES.rect(n, st, t); break;
      case 'rounded': shape = SHAPES.round(n, st, t); break;
      case 'circle': shape = SHAPES.circle(n, st, t); break;
      case 'hexagon': shape = SHAPES.hexagon(n, st, t); break;
      case 'cloud': {
        // Bumps along the box, clockwise: arcs bulge outwards.
        const k = Math.max(2, Math.round(n.w / 40)), x1 = x0 + n.w, y1 = y0 + n.h;
        const pts = [];
        for (let i = 0; i <= k; i++) pts.push([x0 + (n.w * i) / k, y0]);
        pts.push([x1, y1]);
        for (let i = k - 1; i >= 0; i--) pts.push([x0 + (n.w * i) / k, y1]);
        pts.push([x0, y0]);
        let d = 'M' + num(pts[0][0]) + ' ' + num(pts[0][1]);
        for (let i = 1; i < pts.length; i++) { const r = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) * 0.56; d += 'A' + num(r) + ' ' + num(r) + ' 0 0 1 ' + num(pts[i][0]) + ' ' + num(pts[i][1]); }
        shape = '<path d="' + d + 'Z" fill="' + esc(fill) + '" stroke="' + esc(c) + '" stroke-width="1.4"/>';
        break;
      }
      case 'bang': {
        const pts = [];
        for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2, k = i % 2 ? 0.78 : 1; pts.push(num(n.x + Math.cos(a) * n.w / 2 * k) + ',' + num(n.y + Math.sin(a) * n.h / 2 * k)); }
        shape = `<polygon points="${pts.join(' ')}" fill="${esc(fill)}" stroke="${esc(c)}" stroke-width="1.4"/>`;
        break;
      }
      default:
        shape = n.depth <= 1 ? SHAPES.round(n, st, t) : `<path d="M${num(x0)} ${num(y0 + n.h)}H${num(x0 + n.w)}" stroke="${esc(c)}" stroke-width="2"/>`;
    }
    body.push(`<g class="dg-node">${shape}${textAt(n.label, n.x, n.y, { size: n.fs, fill: textColor, bold: n.depth === 0 })}</g>`);
  }
  return svgDoc({ kind: 'mindmap', id, width: maxX - minX, height: maxY - minY, body: body.join(''), opts });
}

registerDiagram('mindmap', { detect: /^mindmap\b/, render: mindmapSVG });
