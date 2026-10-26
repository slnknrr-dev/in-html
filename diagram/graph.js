// diagram/graph.js - the neutral graph that every diagram kind produces and the layered layout consumes, and a
// small builder for programs that make graphs (text analysis, dependency views) instead of parsing a language.
//
//   graph = { kind, direction: 'TB' | 'BT' | 'LR' | 'RL', title,
//             nodes:  [{ id, label, shape, group, cls: [name], style, accent (theme colour index), tooltip, w?, h? }],
//             edges:  [{ from, to, label, line: 'solid' | 'dotted' | 'thick' | 'invisible', head, tail (marker
//                       names of svg.js, default head 'arrow'), minLen, style }],
//             groups: [{ id, label, parent, style, cls }],
//             classes: { name: 'fill:…,stroke:…' } }
//   createGraph({ direction, title }) -> builder { graph, node(id, label, props), edge(from, to, props),
//                                                  group(id, label, props), cls(name, spec) }
//   graphSVG(graph, opts) -> SVG text (layoutGraph + renderSVG)

import { layoutGraph } from './layout.js';
import { renderSVG } from './svg.js';

// The builder dedupes nodes by id (Map, O(1)), mirroring Mermaid semantics: "A --> B" then "A[Start]" refers to
// the same node, and the later declaration updates its props/label (Object.assign). Edges and groups are not
// deduped: two identical edges are two parallel arrows, as in the source language.
export function createGraph({ direction = 'TB', title = '', kind = 'graph' } = {}) {
  const graph = { kind, direction, title, nodes: [], edges: [], groups: [], classes: {} };
  const byId = new Map();
  return {
    graph,
    node(id, label = id, props = {}) {
      let n = byId.get(id);
      if (!n) { n = { id, label, shape: 'round', cls: [] }; byId.set(id, n); graph.nodes.push(n); }
      Object.assign(n, props, label != null ? { label } : {});
      return n;
    },
    has: (id) => byId.has(id),
    edge(from, to, props = {}) { const e = { from, to, label: '', line: 'solid', head: 'arrow', ...props }; graph.edges.push(e); return e; },
    group(id, label = id, props = {}) { const g = { id, label, parent: null, ...props }; graph.groups.push(g); return g; },
    cls(name, spec) { graph.classes[name] = spec; },
  };
}

export const graphSVG = (graph, opts = {}) => renderSVG(layoutGraph(graph, opts), { ...opts, classes: { ...(graph.classes || {}), ...(opts.classes || {}) }, title: opts.title || graph.title });
