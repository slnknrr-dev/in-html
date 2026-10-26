// diagram/gitgraph.js - the Mermaid git graph: gitGraph [LR: | TB: | BT:], commit [id: "…"] [msg: "…"] [tag: "…"]
// [type: NORMAL | REVERSE | HIGHLIGHT], branch <name> [order: n], checkout / switch <name>, merge <name> [id:] [tag:]
// [type:], cherry-pick id: "…" [parent: "…"]. One lane per branch (main first, then by order and creation), commits
// in the order written; merges as rings, cherry-picks with the source id, tags as labels. Errors (unknown branch,
// merging a branch into itself, a branch that exists) name the line, as Mermaid does.
//
//   parseGitGraph(src) -> { direction, branches: [{ name, order, lane }], commits: [{ id, msg, tag, type, branch,
//                           parents, seq, merge, cherry }] }
//   gitGraphSVG(src, opts) -> SVG text

import { registerDiagram } from './index.js';
import { nextId, esc } from './svg.js';
import { textWidth } from './measure.js';
import { sourceLines, themeOf, textAt, svgDoc, fail, num, ink } from './kit.js';

//
// Model: a tiny git simulator. Each branch tracks its head; commit() appends to the current branch with the head as
// parent, merge creates a two-parent commit, branch copies the current head. Commits keep source order (seq), which
// is the "along" coordinate: the picture is a timeline, not a topological layout, exactly like Mermaid's.
// Errors fail fast (Mermaid semantics): a git graph with an impossible operation has no meaningful picture.
//
// attr(): key: "quoted" | 'quoted' | bare. \b before the key keeps "id" from matching inside "myid:".
// The ?? chain returns the inner text of whichever quote form matched, else the bare token.
const attr = (s, k) => { const m = new RegExp(`\\b${k}\\s*:\\s*("([^"]*)"|'([^']*)'|[^\\s]+)`).exec(s); return m ? (m[2] ?? m[3] ?? m[1]) : null; };

export function parseGitGraph(src) {
  const { title, lines } = sourceLines(src);
  const G = { title, direction: 'LR', branches: [], commits: [] };
  const branch = new Map();
  const add = (name, order) => { const b = { name, order: order == null ? null : +order, head: null, idx: G.branches.length }; branch.set(name, b); G.branches.push(b); return b; };
  let cur = add('main', null);
  let header = false, auto = 0;
  const ids = new Map();
  // Auto ids: seq + a hex counter, unique and stable for the same source (Mermaid uses random ids; deterministic ids
  // keep output reproducible). auto:true hides them from labels since they mean nothing to the reader.
  const commit = (props, line) => {
    const c = { id: props.id || `${G.commits.length}-${(++auto).toString(16).padStart(4, '0')}`, auto: !props.id, msg: props.msg || '', tag: props.tag || '', type: (props.type || 'NORMAL').toUpperCase(), branch: cur.name, parents: cur.head ? [cur.head] : [], seq: G.commits.length, merge: !!props.merge, cherry: props.cherry || null };
    if (props.parents) c.parents = props.parents;
    if (ids.has(c.id)) fail(line, `commit id "${c.id}" already exists`);
    ids.set(c.id, c);
    G.commits.push(c);
    cur.head = c.id;
    return c;
  };
  for (const { text, line } of lines) {
    let m;
    if (!header) {
      m = /^gitGraph\b\s*(LR|TB|BT)?\s*:?\s*$/.exec(text);
      if (!m) fail(line, 'expected "gitGraph"');
      header = true;
      if (m[1]) G.direction = m[1];
      continue;
    }
    if ((m = /^commit\b(.*)$/i.exec(text))) { commit({ id: attr(m[1], 'id'), msg: attr(m[1], 'msg'), tag: attr(m[1], 'tag'), type: attr(m[1], 'type') }, line); continue; }
    if ((m = /^branch\s+("[^"]+"|[^\s]+)(.*)$/i.exec(text))) {
      const name = m[1].replace(/^"|"$/g, '');
      if (branch.has(name)) fail(line, `branch "${name}" already exists`);
      const b = add(name, attr(m[2], 'order'));
      b.head = cur.head;
      b.from = cur.head;
      cur = b;
      continue;
    }
    if ((m = /^(?:checkout|switch)\s+("[^"]+"|[^\s]+)\s*$/i.exec(text))) {
      const name = m[1].replace(/^"|"$/g, '');
      if (!branch.has(name)) fail(line, `branch "${name}" does not exist`);
      cur = branch.get(name);
      continue;
    }
    if ((m = /^merge\s+("[^"]+"|[^\s]+)(.*)$/i.exec(text))) {
      const name = m[1].replace(/^"|"$/g, '');
      const b = branch.get(name);
      if (!b) fail(line, `branch "${name}" does not exist`);
      if (b === cur) fail(line, 'cannot merge a branch into itself');
      if (!b.head || b.head === cur.head) fail(line, `nothing to merge from "${name}"`);
      commit({ id: attr(m[2], 'id'), tag: attr(m[2], 'tag'), type: attr(m[2], 'type'), merge: true, parents: [cur.head, b.head].filter(Boolean) }, line);
      continue;
    }
    if ((m = /^cherry-pick\b(.*)$/i.exec(text))) {
      const src0 = attr(m[1], 'id');
      if (!src0 || !ids.has(src0)) fail(line, `cherry-pick needs the id of an existing commit`);
      if (ids.get(src0).branch === cur.name) fail(line, 'cannot cherry-pick a commit of the same branch');
      commit({ tag: attr(m[1], 'tag'), cherry: src0 }, line);
      continue;
    }
    if (/^(accTitle|accDescr|title)\b/i.test(text)) { const tm = /^title\s+(.+)$/i.exec(text); if (tm) G.title = tm[1].trim(); continue; }
    fail(line, 'cannot read: ' + text.slice(0, 60));
  }
  if (!header) fail(0, 'expected "gitGraph"');
  // Lane order: main always first, then explicit order:, then creation order. `a.order ?? 1e6 + a.idx` parses as
  // a.order ?? (1e6 + a.idx) (?? binds looser than +): unordered branches sort after every ordered one.
  const sorted = G.branches.slice().sort((a, b) => (a.idx === 0 ? -1 : b.idx === 0 ? 1 : (a.order ?? 1e6 + a.idx) - (b.order ?? 1e6 + b.idx)));
  sorted.forEach((b, i) => { b.lane = i; });
  G.branches = sorted.map(({ name, order, lane }) => ({ name, order, lane }));
  return G;
}

// One coordinate system in (along, across) for all directions; pos() and P() swap axes for TB/BT, BT reverses along.
export function gitGraphSVG(src, opts = {}) {
  const G = parseGitGraph(src);
  const t = themeOf(opts);
  const fs = opts.fontSize || 14, lh = fs * 1.3;
  const id = nextId(opts.idPrefix);
  const vert = G.direction !== 'LR';
  const lane = new Map(G.branches.map((b) => [b.name, b.lane]));
  const color = (name) => t.palette[lane.get(name) % t.palette.length];
  const labelW = Math.max(...G.branches.map((b) => textWidth(b.name, fs * 0.9, { bold: true }) + 20));
  const step = 56, laneGap = vert ? Math.max(54, labelW + 8) : 54;
  const titleH = G.title ? lh + 16 : 0;
  const tagRoom = G.commits.some((c) => c.tag) ? 30 : 8;
  const n = G.commits.length;
  const byId = new Map(G.commits.map((c) => [c.id, c]));
  const bt = G.direction === 'BT';
  // Positions: LR lanes are rows (labels on the left); TB / BT lanes are columns (labels on top).
  const pos = (c) => {
    const along = (vert ? 40 : labelW + 40) + (bt ? n - 1 - c.seq : c.seq) * step;
    const across = (vert ? 20 + labelW / 2 : titleH + tagRoom + 16) + lane.get(c.branch) * laneGap;
    return vert ? [across, titleH + 50 + along - 40 + 20] : [along, across];
  };
  const body = [];
  const end = n ? Math.max(...G.commits.map((c) => (vert ? pos(c)[1] : pos(c)[0]))) : 100;
  // Lanes.
  for (const b of G.branches) {
    const k = b.lane, col = color(b.name);
    const across = (vert ? 20 + labelW / 2 : titleH + tagRoom + 16) + k * laneGap;
    if (vert) {
      body.push(`<path d="M${num(across)} ${num(titleH + 46)}V${num(end + 20)}" stroke="${esc(col)}" stroke-width="1" stroke-dasharray="2 4" opacity="0.6"/>`);
      body.push(`<rect x="${num(across - labelW / 2 + 4)}" y="${num(titleH + 10)}" width="${num(labelW - 8)}" height="${num(lh + 6)}" rx="5" fill="${esc(col)}"/>` + textAt(b.name, across, titleH + 13 + lh / 2, { size: fs * 0.9, fill: ink(col), bold: true }));
    } else {
      body.push(`<path d="M${num(labelW + 20)} ${num(across)}H${num(end + 24)}" stroke="${esc(col)}" stroke-width="1" stroke-dasharray="2 4" opacity="0.6"/>`);
      body.push(`<rect x="8" y="${num(across - lh / 2 - 3)}" width="${num(labelW - 4)}" height="${num(lh + 6)}" rx="5" fill="${esc(col)}"/>` + textAt(b.name, 6 + labelW / 2, across, { size: fs * 0.9, fill: ink(col), bold: true }));
    }
  }
  // Links parent -> child: straight along a lane, curved between lanes (near the parent for branch-offs, near the child
  // for merges).
  for (const c of G.commits) {
    // k === 0 is the first parent (same lane line); k === 1 is the merged branch. The lane change is a cubic S-curve
    // placed near the parent for branch-offs and near the child for merges, which is how readers expect git graphs.
    // The merge link takes the merged branch's colour so the reader can follow where it came from.
    c.parents.forEach((pid, k) => {
      const p = byId.get(pid);
      if (!p) return;
      const [x1, y1] = pos(p), [x2, y2] = pos(c);
      const col = color(k === 0 ? c.branch : p.branch);
      // Along / across the lanes, then back to x / y.
      const [a1, b1, a2, b2] = vert ? [y1, x1, y2, x2] : [x1, y1, x2, y2];
      const P = (u, v) => (vert ? num(v) + ' ' + num(u) : num(u) + ' ' + num(v));
      let d;
      if (b1 === b2) d = 'M' + P(a1, b1) + 'L' + P(a2, b2);
      else {
        const dir = Math.sign(a2 - a1) || 1;
        const u0 = k === 0 ? a1 : a2 - dir * step * 0.75, u1 = k === 0 ? a1 + dir * step * 0.75 : a2;
        d = 'M' + P(a1, b1) + 'L' + P(u0, b1) + 'C' + P((u0 + u1) / 2, b1) + ' ' + P((u0 + u1) / 2, b2) + ' ' + P(u1, b2) + 'L' + P(a2, b2);
      }
      body.push(`<path class="dg-link" d="${d}" fill="none" stroke="${esc(col)}" stroke-width="2.4"/>`);
    });
  }
  // Commits, their labels and tags.
  const r = 9;
  for (const c of G.commits) {
    const [x, y] = pos(c), col = color(c.branch);
    let g;
    if (c.type === 'HIGHLIGHT') g = `<rect x="${num(x - r)}" y="${num(y - r)}" width="${2 * r}" height="${2 * r}" rx="2" fill="${esc(col)}" stroke="${esc(t.text)}" stroke-width="1.5"/>`;
    else if (c.merge) g = `<circle cx="${num(x)}" cy="${num(y)}" r="${r}" fill="${esc(t.hollow || '#fff')}" stroke="${esc(col)}" stroke-width="3"/><circle cx="${num(x)}" cy="${num(y)}" r="${r - 5}" fill="${esc(col)}"/>`;
    else g = `<circle cx="${num(x)}" cy="${num(y)}" r="${r}" fill="${esc(col)}" stroke="${esc(t.hollow || '#fff')}" stroke-width="1.5"/>`;
    if (c.type === 'REVERSE') g += `<path d="M${num(x - 4)} ${num(y - 4)}l8 8m0 -8l-8 8" stroke="${esc(ink(col))}" stroke-width="2"/>`;
    if (c.cherry) g += `<circle cx="${num(x - 3)}" cy="${num(y - 2)}" r="2.2" fill="${esc(ink(col))}"/><circle cx="${num(x + 3)}" cy="${num(y - 2)}" r="2.2" fill="${esc(ink(col))}"/>`;
    const text = c.msg || (c.auto ? '' : c.id) || (c.cherry ? 'cherry-pick: ' + c.cherry : '');
    let lab = '';
    if (text) {
      lab = vert ? textAt(text, x + r + 6, y, { size: fs * 0.78, fill: t.text, anchor: 'start' })
        : textAt(text, x, y + r + 6, { size: fs * 0.78, fill: t.text, anchor: 'end', extra: ` transform="rotate(-38 ${num(x)} ${num(y + r + 6)})"` });
    }
    if (c.tag) {
      const w = textWidth(c.tag, fs * 0.78) + 14;
      const [tx, ty] = vert ? [x - r - 8 - w, y] : [x - w / 2, y - r - 8 - (lh - 4)];
      const box = vert ? `<rect x="${num(tx)}" y="${num(ty - (lh - 4) / 2)}" width="${num(w)}" height="${num(lh - 4)}" rx="3"` : `<rect x="${num(tx)}" y="${num(ty)}" width="${num(w)}" height="${num(lh - 4)}" rx="3"`;
      lab += `${box} fill="${esc(t.note)}" stroke="${esc(t.noteStroke)}"/>` + textAt(c.tag, tx + w / 2, vert ? ty : ty + (lh - 4) / 2, { size: fs * 0.78, fill: t.text });
    }
    body.push(`<g class="dg-commit" data-id="${esc(c.id)}"><title>${esc(c.id + (c.msg ? ': ' + c.msg : ''))}</title>${g}</g>${lab}`);
  }
  // Note: the `(G.commits.some(...) ? 0 : 0)` term in W below is dead (always 0): harmless leftover.
  const lanes = G.branches.length;
  const labelRoom = G.commits.some((c) => c.msg || !c.auto) ? Math.min(140, Math.max(...G.commits.map((c) => textWidth(c.msg || (c.auto ? '' : c.id), fs * 0.78))) * 0.8 + 10) : 10;
  const W = vert ? 20 + labelW / 2 + (lanes - 1) * laneGap + labelW / 2 + 20 + labelRoom + (G.commits.some((c) => c.tag) ? 0 : 0) : end + 40;
  const H = vert ? end + 40 : titleH + tagRoom + 16 + (lanes - 1) * laneGap + 20 + labelRoom;
  const W2 = Math.max(W, G.title ? textWidth(G.title, fs * 1.1, { bold: true }) + 30 : 0);
  if (G.title) body.unshift(textAt(G.title, W2 / 2, 10 + lh / 2, { size: fs * 1.1, fill: t.text, bold: true }));
  // Tags to the left of vertical lanes need room: shift everything right.
  // Tags on vertical layouts sit left of the commit and may cross x = 0; the whole body is translated right by the
  // largest overshoot instead of recomputing every coordinate.
  let shift = 0;
  if (vert && G.commits.some((c) => c.tag)) shift = Math.max(...G.commits.filter((c) => c.tag).map((c) => textWidth(c.tag, fs * 0.78) + 30 - (pos(c)[0] - 0)), 0);
  const content = shift > 0 ? `<g transform="translate(${num(shift)} 0)">${body.join('')}</g>` : body.join('');
  return svgDoc({ kind: 'gitgraph', id, width: W2 + shift, height: H, body: content, title: G.title, opts });
}

registerDiagram('gitgraph', { detect: /^gitGraph\b/, render: gitGraphSVG });
