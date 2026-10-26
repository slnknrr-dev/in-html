// diagram/state.js - the Mermaid state diagram (stateDiagram, stateDiagram-v2): states, descriptions
// (state "Text" as S, S : text), start and end ([*], one pair per composite state), transitions with labels,
// composite states (state S { … }, nested, with their own direction), <<choice>> (diamond), <<fork>> / <<join>> (bars),
// notes (note left of / right of S : text, and the multi-line form ending with "end note"), concurrency separators
// (-- : accepted, regions are not drawn apart), classDef / class / :::, direction. Laid out by layout.js.
//
//   parseState(src) -> { graph, errors }        stateSVG(src, opts) -> SVG text

import { registerDiagram } from './index.js';
import { layoutGraph } from './layout.js';
import { renderSVG, compartmentSize } from './svg.js';
import { sourceLines, fail, unquote } from './kit.js';

//
// Model mapping: simple states -> nodes, composite states -> groups (layout.js compound boxes), [*] -> a start dot or
// end bullseye. [*] is scoped: each composite state gets its own start/end pair (ids suffixed by the scope), which
// is UML semantics; a single global [*] would wire every composite into one start node.
// Side of the arrow decides start vs end: [*] --> X is a start, X --> [*] an end (ref(raw, start)).
const ID = '(?:\\[\\*\\]|[\\w.$-]+)';

export function parseState(src) {
  const { title, lines } = sourceLines(src);
  const graph = { kind: 'state', direction: 'TB', title, nodes: [], edges: [], groups: [], classes: {} };
  const errors = [];
  const byId = new Map();
  const composites = new Set();
  const scope = [];
  const cur = () => (scope.length ? scope[scope.length - 1] : null);
  const node = (id, props = {}) => {
    let n = byId.get(id);
    if (!n) { n = { id, label: id, shape: 'round', desc: [], cls: [] }; if (cur()) n.group = cur(); byId.set(id, n); graph.nodes.push(n); }
    Object.assign(n, props);
    return n;
  };
  const ref = (raw, start) => {
    const s = raw.replace(/:::([\w-]+)$/, '');
    const c = /:::([\w-]+)$/.exec(raw);
    if (s === '[*]') {
      const sc = cur() || 'root';
      const id = (start ? '__start_' : '__end_') + sc;
      return node(id, start ? { label: '', shape: 'dot', w: 14, h: 14 } : { label: '', shape: 'bullseye', w: 20, h: 20 }).id;
    }
    const n = node(s);
    if (c && !n.cls.includes(c[1])) n.cls.push(c[1]);
    return n.id;
  };
  let header = false, note = null, notes = 0;
  // Notes are ordinary nodes joined by an invisible-headed dotted edge, so the layout places them next to their state
  // without a separate annotation pass. "left of" makes the note the edge source, nudging it to the earlier side.
  const addNote = (pos, target, text) => {
    const nid = '__note' + notes++;
    const t = node(target);
    graph.nodes.push({ id: nid, label: text, shape: 'note', group: t.group });
    byId.set(nid, graph.nodes[graph.nodes.length - 1]);
    graph.edges.push(pos === 'left' ? { from: nid, to: t.id, line: 'dotted', head: 'none', label: '' } : { from: t.id, to: nid, line: 'dotted', head: 'none', label: '' });
  };
  for (const { text, line } of lines) {
    let m;
    if (!header) { if (/^stateDiagram(-v2)?\b/.test(text)) { header = true; continue; } fail(line, 'expected "stateDiagram"'); }
    if (note) {
      if (/^end\s*note$/i.test(text)) { addNote(note.pos, note.target, note.lines.join('\n')); note = null; } else note.lines.push(text);
      continue;
    }
    if ((m = /^direction\s+(TB|TD|BT|LR|RL)$/i.exec(text))) {
      const d = m[1].toUpperCase() === 'TD' ? 'TB' : m[1].toUpperCase();
      const g = graph.groups.find((x) => x.id === cur());
      if (g) g.direction = d; else graph.direction = d;
      continue;
    }
    if ((m = /^title\s+(.+)$/i.exec(text))) { graph.title = m[1].trim(); continue; }
    // Concurrency separator: accepted so valid sources parse, but regions are not laid out apart (documented limitation).
    if (/^--$/.test(text)) continue;
    if (/^\}$/.test(text)) { if (!scope.length) errors.push({ line, message: 'unexpected "}"' }); scope.pop(); continue; }
    if ((m = /^state\s+("[^"]*"|[\w.$-]+)(?:\s+as\s+([\w.$-]+))?\s*(<<(choice|fork|join)>>)?\s*(\{)?$/i.exec(text))) {
      let id = m[1], label = null;
      if (m[2]) { id = m[2]; label = unquote(m[1]); } else if (/^"/.test(m[1])) { label = unquote(m[1]); id = label.replace(/\s+/g, '_'); }
      if (m[5]) {
        composites.add(id);
        graph.groups.push({ id, label: label || id, parent: cur() });
        scope.push(id);
        continue;
      }
      const n = node(id);
      if (label != null) n.label = label;
      if (m[4]) {
        const k = m[4].toLowerCase();
        if (k === 'choice') Object.assign(n, { shape: 'diamond', label: '', w: 26, h: 26 });
        else Object.assign(n, { shape: 'bar', label: '', bar: true });
      }
      continue;
    }
    if ((m = /^note\s+(left|right)\s+of\s+([\w.$-]+)\s*(?::\s*(.*))?$/i.exec(text))) {
      if (m[3] != null) addNote(m[1].toLowerCase(), m[2], m[3].trim()); else note = { pos: m[1].toLowerCase(), target: m[2], lines: [] };
      continue;
    }
    if ((m = new RegExp(`^(${ID}(?::::[\\w-]+)?)\\s*-->\\s*(${ID}(?::::[\\w-]+)?)\\s*(?::\\s*(.*))?$`).exec(text))) {
      graph.edges.push({ from: ref(m[1], true), to: ref(m[2], false), label: (m[3] || '').trim(), line: 'solid', head: 'arrow' });
      continue;
    }
    if ((m = /^classDef\s+([\w,-]+)\s+(.+)$/.exec(text))) { for (const c of m[1].split(',')) graph.classes[c.trim()] = m[2].trim().replace(/;$/, ''); continue; }
    if ((m = /^class\s+([\w.$,\s-]+?)\s+([\w-]+)$/.exec(text))) { for (const id of m[1].split(',')) node(id.trim()).cls.push(m[2]); continue; }
    if ((m = /^style\s+([\w.$-]+)\s+(.+)$/.exec(text))) { node(m[1]).style = m[2]; continue; }
    if ((m = /^([\w.$-]+)\s*:\s*(.+)$/.exec(text))) { node(m[1]).desc.push(m[2].trim()); continue; }
    if ((m = /^([\w.$-]+)(?::::([\w-]+))?$/.exec(text))) { const n = node(m[1]); if (m[2]) n.cls.push(m[2]); continue; }
    if (/^(accTitle|accDescr|click)\b/.test(text)) continue;
    errors.push({ line, message: 'cannot read: ' + text.slice(0, 60) });
  }
  if (!header) fail(0, 'expected "stateDiagram"');
  if (note) fail(0, 'note without "end note"');
  if (scope.length) fail(0, 'composite state without "}"');
  // A composite id may have been created as a node by an earlier reference (A --> S before "state S {"); removing the
  // node lets edges to S end at the group frame (layout.js live groups).
  // Composite states are groups, not nodes.
  graph.nodes = graph.nodes.filter((n) => !composites.has(n.id));
  if (graph.classes.default) for (const n of graph.nodes) if (!n.cls.length && n.shape === 'round') n.cls.push('default');
  return { graph, errors };
}

export function stateSVG(src, opts = {}) {
  const { graph, errors } = parseState(src);
  if (!graph.nodes.length) fail(errors[0] && errors[0].line, errors.length ? errors[0].message : 'no states');
  const fs = opts.fontSize || 14;
  const horiz = graph.direction === 'LR' || graph.direction === 'RL';
  // Fork/join bars are oriented across the flow: horizontal for TB/BT, vertical for LR/RL.
  // A state with descriptions becomes a two-compartment box (name, then description lines).
  for (const n of graph.nodes) {
    if (n.bar) Object.assign(n, horiz ? { w: 8, h: 64 } : { w: 64, h: 8 });
    if (n.desc && n.desc.length) {
      n.sections = [{ lines: [n.label], bold: true }, { lines: n.desc, align: 'start' }];
      n.shape = 'compartments';
      n.fontSize = fs;
      Object.assign(n, compartmentSize(n.sections, fs));
      n.label = '';
    }
  }
  const L = layoutGraph(graph, { rankSep: 44, ...opts });
  return renderSVG(L, { ...opts, className: 'dg-state', classes: graph.classes, title: graph.title || opts.title });
}

registerDiagram('state', { detect: /^stateDiagram(-v2)?\b/, render: stateSVG });
