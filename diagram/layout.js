// diagram/layout.js - layered (Sugiyama) layout of directed graphs with nested groups. A flat graph: cycles broken
// by a depth-first search, ranks by longest path with source tightening, long edges split by dummy nodes (an edge
// label rides on the middle dummy), crossings reduced by barycenter sweeps with adjacent transpositions, positions
// along a rank by weighted isotonic regression (pool adjacent violators: every node as close as possible to its
// neighbours under the separation constraints, long edges straightened), ranks spaced by their longest node.
// Groups are compound: each group is laid out on its own (inner groups first, in its own direction) and then takes
// part in its parent's layout as one box, so group frames never overlap other nodes; an edge that enters a group is
// laid out between the boxes and extended to the node inside. Directions TB, BT, LR, RL. Pure: sizes come from
// diagram/measure.js or a caller's measurer.
//
//   graph = { direction, nodes: [{ id, label, shape, group, w?, h? }], edges: [{ from, to, label, minLen }],
//             groups: [{ id, label, parent, direction }] }                   (see graph.js)
//   layoutGraph(graph, { fontSize = 14, nodeSep = 30, rankSep = 50, groupPad = 14, padding = 12, measure,
//                        sizeOf(node) -> { w, h } }) -> { width, height, direction, nodes: [{ ...node, x, y, w, h }],
//                        edges: [{ ...edge, points: [[x, y]], labelBox: { x, y, w, h } | null, loop? }],
//                        groups: [{ ...group, x, y, w, h, depth }] }        x / y of nodes are centres
//   shapeSize(shape, w, h) -> { w, h }      clipToShape(shape, cx, cy, w, h, towardX, towardY) -> [x, y]

//
// Why Sugiyama and not force-directed: flowcharts have a reading direction; layered layout guarantees that edges
// point one way (except reversed back edges), is deterministic (same input -> same picture, no random seed), and
// runs in one pass with no convergence threshold. Its classic weak spot, compound nodes, is solved here by recursion
// (each group laid out as a black box), simpler than the full compound-graph Sugiyama extensions.
// Internal coordinates: b = breadth (along a rank), l = length (across ranks). Every direction is laid out as TB in
// (b, l) and rotated/mirrored only at the end (tr), so the algorithm itself is written once.
import { labelBox } from './measure.js';

// Outer size of a shape that contains a text box of w × h.
// Diamond: a rhombus contains a w x h text box when its corner satisfies (w/2)/(W/2) + (h/2)/(H/2) <= 1 (exact fit
// W = 2w at H = 2h, wasteful for wide labels); w + 0.9h is a cheaper near-fit;
// the h*2 floor and 1.6h minimum height keep short or tall labels from producing needle-thin diamonds.
export function shapeSize(shape, w, h) {
  switch (shape) {
    case 'diamond': { const s = Math.max(w + h * 0.9, h * 2); return { w: s, h: Math.max(h * 1.6, s * 0.5) }; }
    case 'circle': case 'doublecircle': { const d = Math.max(w, h) + 8 + (shape === 'doublecircle' ? 8 : 0); return { w: d, h: d }; }
    case 'hexagon': return { w: w + h * 0.7, h };
    case 'parallelogram': case 'parallelogramAlt': case 'trapezoid': case 'trapezoidAlt': return { w: w + h * 0.8, h };
    case 'asymmetric': return { w: w + h * 0.5, h };
    case 'cylinder': return { w, h: h + 14 };
    case 'stadium': return { w: w + h * 0.4, h };
    case 'point': return { w: 10, h: 10 };
    default: return { w, h };
  }
}

// The point where the ray from the centre towards (tx, ty) leaves the shape.
// Scale factor k makes (dx, dy)*k land on the boundary: diamond = L1 ellipse, round shapes = L2 ellipse, everything
// else is approximated by its bounding rectangle (L-infinity). Hexagons/parallelograms thus clip at the box, a few
// pixels off the slanted side; acceptable because the arrowhead covers the gap.
export function clipToShape(shape, cx, cy, w, h, tx, ty) {
  const dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return [cx, cy];
  const a = w / 2, b = h / 2;
  let k;
  if (shape === 'diamond') k = 1 / (Math.abs(dx) / a + Math.abs(dy) / b);
  else if (shape === 'circle' || shape === 'doublecircle' || shape === 'ellipse' || shape === 'point' || shape === 'dot' || shape === 'bullseye') k = 1 / Math.hypot(dx / a, dy / b);
  else k = Math.min(dx ? a / Math.abs(dx) : Infinity, dy ? b / Math.abs(dy) : Infinity);
  return [cx + dx * k, cy + dy * k];
}

const DEFAULTS = { fontSize: 14, nodeSep: 30, rankSep: 50, groupPad: 14, padding: 12, padX: 14, padY: 9, titleGap: 6 };
const normDir = (d) => (['TB', 'BT', 'LR', 'RL'].includes(d) ? d : 'TB');

// Flat layered layout of items { id, w, h } and edges { from, to, minLen, labelW, labelH }; coordinates are centres
// in a picture whose top-left corner is (0, 0). Returns { width, height, pos: Map(id -> [x, y]), routes: [points | null]
// per edge, labels: [[x, y] | null per edge], loops: [edge index] }.
// Phases (classic Sugiyama): 1 break cycles, 2 assign ranks, 3 insert dummies, 4 order within ranks, 5 coordinates.
function flat(items, edges, dir, o) {
  const horiz = dir === 'LR' || dir === 'RL';
  const V = items.map((it) => ({ id: it.id, b: horiz ? it.h : it.w, l: horiz ? it.w : it.h, out: [], in: [], rank: 0, ups: [], downs: [] }));
  const vById = new Map(V.map((v) => [v.id, v]));
  const E = [];
  const loops = [];
  edges.forEach((e, i) => {
    const a = vById.get(e.from), b = vById.get(e.to);
    if (!a || !b) return;
    if (a === b) { loops.push(i); return; }
    E.push({ i, e, u: a, v: b, rev: false, minLen: Math.max(1, e.minLen | 0 || 1) });
  });
  // With any edge label, every minLen is doubled: the middle rank of each edge becomes a free slot for its label dummy,
  // so labels get real space in the layout instead of being painted over nodes. rankSep is then divided by 1.6 below
  // so the picture does not grow to twice the height.
  const labeled = E.some((x) => x.e.labelW);
  const scale = labeled ? 2 : 1;

  // Iterative DFS with an explicit stack ([vertex, next-edge index]), not recursion: a long chain of a few thousand
  // nodes would overflow the JS call stack. state 1 = on stack (grey), 2 = done (black); an edge into a grey vertex is
  // a back edge. Reversed edges are drawn with their points reversed again at the end, so arrows keep their direction.
  // Cycles: reverse the back edges of a depth-first search.
  const state = new Map();
  const adj = new Map(V.map((v) => [v, []]));
  for (const x of E) adj.get(x.u).push(x);
  for (const root of V) {
    if (state.get(root)) continue;
    const stack = [[root, 0]];
    state.set(root, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const list = adj.get(top[0]);
      if (top[1] >= list.length) { state.set(top[0], 2); stack.pop(); continue; }
      const x = list[top[1]++];
      const s = state.get(x.v);
      if (s === 1) x.rev = true;
      else if (!s) { state.set(x.v, 1); stack.push([x.v, 0]); }
    }
  }
  for (const x of E) { [x.a, x.b] = x.rev ? [x.v, x.u] : [x.u, x.v]; x.a.out.push(x); x.b.in.push(x); }

  // Kahn topological order with longest-path ranking: simple and O(V+E), but produces wide bottom ranks; the source
  // tightening pass (sources moved down to just above their nearest successor) removes the most visible artefact,
  // long edges from sources placed at rank 0. Network simplex would minimise total edge length; not worth its cost here.
  // Ranks: longest path, then sources pulled down next to their successors.
  const indeg = new Map(V.map((v) => [v, v.in.length]));
  const queue = V.filter((v) => !v.in.length);
  const topo = [];
  while (queue.length) {
    const v = queue.shift();
    topo.push(v);
    for (const x of v.out) {
      x.b.rank = Math.max(x.b.rank, v.rank + x.minLen * scale);
      indeg.set(x.b, indeg.get(x.b) - 1);
      if (!indeg.get(x.b)) queue.push(x.b);
    }
  }
  for (const v of topo.slice().reverse()) if (!v.in.length && v.out.length) v.rank = Math.min(...v.out.map((x) => x.b.rank - x.minLen * scale));
  const minRank = Math.min(0, ...V.map((v) => v.rank));
  for (const v of V) v.rank -= minRank;

  // Dummy ids start with U+0000: cannot collide with any user node id (which come from text without NUL).
  // Edge weights for positioning: dummy-dummy 8, dummy-real 2, real-real 1. Heavy inner segments pull long edges
  // straight (vertical), the standard trick from Gansner et al. to avoid zig-zagging long edges.
  // Dummies along long edges; the label sits on the middle one.
  const all = V.slice();
  for (const x of E) {
    const mid = x.a.rank + Math.floor((x.b.rank - x.a.rank) / 2);
    x.path = [x.a];
    for (let r = x.a.rank + 1; r < x.b.rank; r++) {
      const lab = r === mid && x.e.labelW;
      const d = { id: '\u0000' + all.length, dummy: true, rank: r, label: !!lab, b: lab ? (horiz ? x.e.labelH : x.e.labelW) : 0, l: lab ? (horiz ? x.e.labelW : x.e.labelH) : 0, ups: [], downs: [] };
      all.push(d);
      x.path.push(d);
    }
    x.path.push(x.b);
    for (let k = 1; k < x.path.length; k++) {
      const p = x.path[k - 1], q = x.path[k];
      const w = p.dummy && q.dummy ? 8 : p.dummy || q.dummy ? 2 : 1;
      p.downs.push([q, w]); q.ups.push([p, w]);
    }
  }
  const maxRank = Math.max(0, ...all.map((v) => v.rank));
  const layers = Array.from({ length: maxRank + 1 }, () => []);
  {
    // Initial order: breadth first from the sources, in input order.
    const seen = new Set();
    const q = all.filter((v) => !v.ups.length);
    for (const v of q) seen.add(v);
    while (q.length) {
      const v = q.shift();
      layers[v.rank].push(v);
      for (const [w] of v.downs) if (!seen.has(w)) { seen.add(w); q.push(w); }
    }
    for (const v of all) if (!seen.has(v)) layers[v.rank].push(v);
  }
  const setOrder = () => { for (const L of layers) L.forEach((v, i) => { v.order = i; }); };
  setOrder();

  // crossings(): counts inversions pairwise, O(s^2) per rank pair. Fine for diagram-sized graphs (tens of edges per
  // rank); a Fenwick-tree count (O(s log s)) would be needed only for graphs far beyond what is readable anyway.
  // Up to 28 alternating down/up barycenter sweeps, each followed by one adjacent-transposition pass; the best order
  // ever seen is kept, because barycenter sweeps are not monotone and may oscillate.
  // Crossing reduction.
  const crossings = () => {
    let c = 0;
    for (let r = 0; r < maxRank; r++) {
      const segs = [];
      for (const v of layers[r]) for (const [q] of v.downs) segs.push([v.order, q.order]);
      segs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (segs[i][0] < segs[j][0] && segs[i][1] > segs[j][1]) c++;
    }
    return c;
  };
  let best = crossings(), bestOrder = layers.map((L) => L.slice());
  for (let it = 0; it < 28 && best > 0; it++) {
    const down = it % 2 === 0;
    for (let k = 0; k <= maxRank; k++) {
      const r = down ? k : maxRank - k;
      const val = new Map();
      for (const v of layers[r]) {
        const nb = down ? v.ups : v.downs;
        val.set(v, nb.length ? nb.reduce((a, [q]) => a + q.order, 0) / nb.length : v.order);
      }
      layers[r].sort((a, b) => val.get(a) - val.get(b));
      layers[r].forEach((v, i) => { v.order = i; });
    }
    for (const L of layers) {
      for (let i = 0; i + 1 < L.length; i++) {
        const p = L[i], q = L[i + 1];
        const cost = (a, b) => { let c = 0; for (const nb of ['ups', 'downs']) for (const [x] of a[nb]) for (const [y] of b[nb]) if (x.order > y.order) c++; return c; };
        if (cost(q, p) < cost(p, q)) { L[i] = q; L[i + 1] = p; p.order = i + 1; q.order = i; }
      }
    }
    const c = crossings();
    if (c < best) { best = c; bestOrder = layers.map((L) => L.slice()); }
  }
  for (let r = 0; r <= maxRank; r++) layers[r] = bestOrder[r];
  setOrder();

  // place(): substitute y_i = x_i - S_i where S_i are prefix sums of the minimum separations; the constraint
  // x_{i+1} - x_i >= sep becomes y non-decreasing, i.e. isotonic regression of desired - S under weights, solved
  // exactly in O(n) by pool-adjacent-violators (merge a block with its predecessor while it violates order).
  // This yields the optimal compact placement per rank, unlike simple left-to-right packing.
  // Positions along the ranks: weighted isotonic regression under the separations.
  const sep = (p, q) => (p.b + q.b) / 2 + (p.dummy && q.dummy ? 10 : p.dummy || q.dummy ? o.nodeSep * 0.5 : o.nodeSep);
  const place = (L, desired, weight) => {
    const S = [0];
    for (let i = 1; i < L.length; i++) S.push(S[i - 1] + sep(L[i - 1], L[i]));
    const blocks = [];
    for (let i = 0; i < L.length; i++) {
      let blk = { sum: weight[i] * (desired[i] - S[i]), w: weight[i], n: 1 };
      blk.v = blk.sum / blk.w;
      while (blocks.length && blocks[blocks.length - 1].v >= blk.v) {
        const p = blocks.pop();
        blk = { sum: p.sum + blk.sum, w: p.w + blk.w, n: p.n + blk.n };
        blk.v = blk.sum / blk.w;
      }
      blocks.push(blk);
    }
    let i = 0;
    for (const blk of blocks) for (let k = 0; k < blk.n; k++, i++) L[i].x = blk.v + S[i];
  };
  for (const L of layers) { let x = 0; L.forEach((v, i) => { if (i) x += sep(L[i - 1], v); v.x = x; }); }
  // A vertex without neighbours in the sweep direction keeps its x with a tiny weight (0.05) so it yields to real
  // constraints. 6 rounds of alternating one-sided sweeps then 4 two-sided ones: empirically enough to settle.
  const sweep = (up, down, reverse) => {
    const ranks = [...layers.keys()];
    if (reverse) ranks.reverse();
    for (const r of ranks) {
      const L = layers[r];
      if (!L.length) continue;
      const desired = [], weight = [];
      for (const v of L) {
        const nb = [...(up ? v.ups : []), ...(down ? v.downs : [])];
        if (!nb.length) { desired.push(v.x); weight.push(0.05); continue; }
        let sw = 0, s = 0;
        for (const [q, w] of nb) { s += q.x * w; sw += w; }
        desired.push(s / sw);
        weight.push(sw);
      }
      place(L, desired, weight);
    }
  };
  for (let it = 0; it < 6; it++) { sweep(true, false, false); sweep(false, true, true); }
  for (let it = 0; it < 4; it++) sweep(true, true, it % 2 === 1);

  // Each rank is as thick as its longest item (l), so a tall node never overlaps the next rank.
  // Rank positions.
  const rankLen = layers.map((L) => Math.max(0, ...L.map((v) => v.l)));
  const gap = o.rankSep / (labeled ? 1.6 : 1);
  const rankPos = [];
  let pos = 0;
  for (let r = 0; r <= maxRank; r++) { pos += (r ? rankLen[r - 1] / 2 + gap : 0) + rankLen[r] / 2; rankPos.push(pos); }
  for (const v of all) v.y = rankPos[v.rank];

  // tr(): rotate/mirror (b, l) into the requested direction. BT and RL mirror l against the total length spanL.
  // To picture coordinates.
  let minB = Infinity, maxB = -Infinity;
  for (const v of all) { minB = Math.min(minB, v.x - v.b / 2); maxB = Math.max(maxB, v.x + v.b / 2); }
  if (!isFinite(minB)) minB = maxB = 0;
  const spanB = maxB - minB, spanL = Math.max(0, (rankPos[maxRank] || 0) + rankLen[maxRank] / 2);
  const tr = (b, l) => {
    const bb = b - minB;
    switch (dir) {
      case 'BT': return [bb, spanL - l];
      case 'LR': return [l, bb];
      case 'RL': return [spanL - l, bb];
      default: return [bb, l];
    }
  };
  const pos2 = new Map(V.map((v) => [v.id, tr(v.x, v.y)]));
  const routes = edges.map(() => null), labels = edges.map(() => null);
  for (const x of E) {
    const pts = x.path.map((v) => tr(v.x, v.y));
    const lab = x.path.find((v) => v.label);
    if (lab) labels[x.i] = tr(lab.x, lab.y);
    routes[x.i] = x.rev ? pts.reverse() : pts;
  }
  return { width: horiz ? spanL : spanB, height: horiz ? spanB : spanL, pos: pos2, routes, labels, loops };
}

// Compound layout: groups form a tree (parentOf/chain sanitise cycles and dangling parents so bad input cannot loop
// forever). Bottom-up, each group is laid out by flat() with its child groups as single boxes; top-down, boxes are
// placed and the recursion descends (place). An edge is routed at the deepest level that contains both of its ends,
// then extended from the box border into the group to the real node (end()).
export function layoutGraph(graph, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const dir = normDir(graph.direction === 'TD' ? 'TB' : graph.direction);
  const groups = (graph.groups || []).filter((g) => g && g.id != null);
  const gById = new Map(groups.map((g) => [g.id, g]));
  // Parents that exist and do not loop.
  const parentOf = (gid) => { const g = gById.get(gid); return g && g.parent != null && gById.has(g.parent) && g.parent !== gid ? g.parent : null; };
  const chain = (gid) => { const c = []; const seen = new Set(); for (let g = gid; g != null && gById.has(g) && !seen.has(g); g = parentOf(g)) { seen.add(g); c.unshift(g); } return c; };

  // Duplicate node ids are dropped after the first (seen): the layout keys everything by id.
  // Size precedence: explicit w/h -> caller's sizeOf -> measured label padded and grown to the shape.
  // Leaf sizes.
  const nodes = [];
  const seen = new Set();
  for (const n of graph.nodes || []) {
    if (n == null || n.id == null || seen.has(n.id)) continue;
    seen.add(n.id);
    let w = n.w, h = n.h;
    if (w == null || h == null) {
      const s = o.sizeOf ? o.sizeOf(n) : null;
      if (s) ({ w, h } = s);
      else {
        const lb = labelBox(n.label == null ? n.id : n.label, { fontSize: n.fontSize || o.fontSize, measure: o.measure });
        ({ w, h } = shapeSize(n.shape, Math.max(lb.w + 2 * o.padX, o.fontSize * 2), Math.max(lb.h, o.fontSize * 1.3) + 2 * o.padY));
      }
    }
    nodes.push({ n, w, h, chain: n.group != null && gById.has(n.group) ? chain(n.group) : [] });
  }
  const nById = new Map(nodes.map((x) => [x.n.id, x]));
  // Edge ends: nodes, or groups that hold nodes (an edge to a group ends at its frame).
  const live = new Set(groups.filter((g) => nodes.some((x) => x.chain.includes(g.id))).map((g) => g.id));
  const endOf = (id) => (nById.has(id) ? { id, chain: nById.get(id).chain, node: true } : live.has(id) ? { id, chain: chain(id) } : null);
  const edges = (graph.edges || []).filter((e) => e && endOf(e.from) && endOf(e.to));
  const edgeLabel = edges.map((e) => (e.label ? labelBox(e.label, { fontSize: o.fontSize * 0.9, measure: o.measure }) : null));

  // Compound layout, inner groups first. A level is the root (null) or a group id.
  const levelOf = new Map(); // group id -> { width, height, pos, items, … } relative layout
  const childGroups = (gid) => groups.filter((g) => parentOf(g.id) === gid && live.has(g.id));
  const titleOf = (g) => (g && g.label ? labelBox(g.label, { fontSize: o.fontSize * 0.92, measure: o.measure }) : { w: 0, h: 0 });
  // The item of a level that holds an edge end (endOf) or a node: the node itself or the child group on its chain.
  // Item ids at a level: a node id, or U+0001 + group id for a child-group box. The prefix keeps a group and a node
  // of the same name apart in one Map.
  const itemAt = (x, gid, depth) => {
    if (gid !== null && x.chain[depth - 1] !== gid) return null;
    if (x.chain.length === depth) return x.n ? x.n.id : x.node ? x.id : null;
    return x.chain.length > depth ? '\u0001' + x.chain[depth] : null;
  };
  const doLevel = (gid, depth) => {
    for (const c of childGroups(gid)) doLevel(c.id, depth + 1);
    const members = nodes.filter((x) => (gid === null ? true : x.chain[depth - 1] === gid));
    const items = new Map();
    for (const x of members) {
      const id = itemAt(x, gid, depth);
      if (id == null || items.has(id)) continue;
      if (id[0] === '\u0001') { const L = levelOf.get(id.slice(1)); items.set(id, { id, w: L.boxW, h: L.boxH, group: id.slice(1) }); }
      else items.set(id, { id, w: x.w, h: x.h, node: x });
    }
    const local = [];
    edges.forEach((e, i) => {
      const ia = itemAt(endOf(e.from), gid, depth), ib = itemAt(endOf(e.to), gid, depth);
      if (ia == null || ib == null) return;
      if (ia === ib && (ia[0] === '\u0001')) return; // inside one child group
      local.push({ from: ia, to: ib, minLen: e.minLen, labelW: edgeLabel[i] ? edgeLabel[i].w + 10 : 0, labelH: edgeLabel[i] ? edgeLabel[i].h + 4 : 0, i });
    });
    const g = gid === null ? null : gById.get(gid);
    const d = normDir(g && g.direction ? g.direction : dir);
    const F = flat([...items.values()], local, d, o);
    const t = titleOf(g);
    const head = g ? o.groupPad + (t.h ? t.h + o.titleGap : 0) : 0;
    const pad = g ? o.groupPad : 0;
    const innerW = Math.max(F.width, g ? t.w : 0);
    // dx centres the content when the group title is wider than the inner layout.
    const L = { gid, items, local, F, head, pad, boxW: innerW + 2 * pad, boxH: F.height + head + pad, dx: pad + (innerW - F.width) / 2, dy: head, depth };
    levelOf.set(gid === null ? '\u0000root' : gid, L);
    return L;
  };
  const root = doLevel(null, 0);

  // Absolute positions: walk down from the root.
  const P = o.padding;
  const outNodes = [];
  const outGroups = [];
  const abs = new Map(); // item id at a level -> absolute centre of nodes; groups by id
  const place = (L, ox, oy) => {
    for (const [id, it] of L.items) {
      const [x, y] = L.F.pos.get(id);
      const cx = ox + L.dx + x, cy = oy + L.dy + y;
      if (it.group) {
        const C = levelOf.get(it.group);
        const g = gById.get(it.group);
        outGroups.push({ ...g, x: cx - it.w / 2, y: cy - it.h / 2, w: it.w, h: it.h, depth: C.depth });
        abs.set('\u0001' + it.group, [cx, cy, it.w, it.h]);
        place(C, cx - it.w / 2, cy - it.h / 2);
      } else {
        outNodes.push({ ...it.node.n, x: cx, y: cy, w: it.w, h: it.h });
        abs.set(id, [cx, cy, it.w, it.h]);
      }
    }
  };
  place(root, P, P);
  const nodeAt = new Map(outNodes.map((n) => [n.id, n]));

  // Self-loops are not routed by flat(); they get a fixed little loop on the right (or below for LR/RL) of the node.
  // Edges: the route of the level where both ends meet, extended into groups down to the real nodes.
  const outEdges = [];
  for (const L of levelOf.values()) {
    const base = L.gid === null ? [P, P] : (() => { const g = outGroups.find((x) => x.id === L.gid); return [g.x, g.y]; })();
    L.local.forEach((le, k) => {
      const e = edges[le.i];
      const s = nodeAt.get(e.from);
      if (L.F.loops.includes(k)) {
        const n = s;
        const horizNow = dir === 'LR' || dir === 'RL';
        const r = n.x + n.w / 2, top = n.y - n.h * 0.3, bot = n.y + n.h * 0.3;
        const pts = horizNow
          ? [[n.x - n.w * 0.25, n.y + n.h / 2], [n.x - n.w * 0.3, n.y + n.h / 2 + 22], [n.x + n.w * 0.3, n.y + n.h / 2 + 22], [n.x + n.w * 0.25, n.y + n.h / 2]]
          : [[r, top], [r + 26, top - 4], [r + 26, bot + 4], [r, bot]];
        const lb = edgeLabel[le.i];
        outEdges.push({ ...e, _i: le.i, points: pts, loop: true, labelBox: lb ? (horizNow ? { x: n.x, y: n.y + n.h / 2 + 24 + lb.h / 2, w: lb.w + 8, h: lb.h + 2 } : { x: r + 30 + lb.w / 2, y: n.y, w: lb.w + 8, h: lb.h + 2 }) : null });
        return;
      }
      const route = L.F.routes[k];
      if (!route) return;
      const pts = route.map(([x, y]) => [base[0] + L.dx + x, base[1] + L.dy + y]);
      // Clip at the item boxes of this level; when the item is a group holding the end, continue to it inside.
      const end = (itemId, endId, near, atStart) => {
        const n = nodeAt.get(endId);
        if (itemId[0] !== '\u0001') return [clipToShape(n.shape, n.x, n.y, n.w, n.h, near[0], near[1])];
        const box = abs.get(itemId);
        const onBox = clipToShape('rect', box[0], box[1], box[2], box[3], near[0], near[1]);
        if (itemId === '\u0001' + endId) return [onBox];
        const ib = n ? null : abs.get('\u0001' + endId);
        const inner = n ? clipToShape(n.shape, n.x, n.y, n.w, n.h, onBox[0], onBox[1]) : clipToShape('rect', ib[0], ib[1], ib[2], ib[3], onBox[0], onBox[1]);
        return atStart ? [inner, onBox] : [onBox, inner];
      };
      const head = end(le.from, e.from, pts[1], true), tail = end(le.to, e.to, pts[pts.length - 2], false);
      const full = [...head, ...pts.slice(1, -1), ...tail];
      const lb = edgeLabel[le.i];
      let labelBoxOut = null;
      if (lb) {
        const at = L.F.labels[k];
        const c = at ? [base[0] + L.dx + at[0], base[1] + L.dy + at[1]] : [(full[0][0] + full[full.length - 1][0]) / 2, (full[0][1] + full[full.length - 1][1]) / 2];
        labelBoxOut = { x: c[0], y: c[1], w: lb.w + 8, h: lb.h + 2 };
      }
      outEdges.push({ ...e, _i: le.i, points: full, labelBox: labelBoxOut });
    });
  }
  // Groups sorted by depth: outer frames painted first, so inner frames are drawn over them, not hidden.
  // The picture is grown to cover edge points and labels, which may stick out of the root box (loops, labels).
  // Keep the input order of the edges (linkStyle indexes and readers rely on it).
  outEdges.sort((a, b) => a._i - b._i);
  for (const e of outEdges) delete e._i;
  outGroups.sort((a, b) => a.depth - b.depth);
  let W = root.boxW + 2 * P, H = root.boxH + 2 * P;
  for (const e of outEdges) {
    for (const [x, y] of e.points) { W = Math.max(W, x + P); H = Math.max(H, y + P); }
    if (e.labelBox) { W = Math.max(W, e.labelBox.x + e.labelBox.w / 2 + P); H = Math.max(H, e.labelBox.y + e.labelBox.h / 2 + P); }
  }
  return { width: W, height: H, direction: dir, nodes: outNodes, edges: outEdges, groups: outGroups };
}
