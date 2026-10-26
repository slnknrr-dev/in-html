// diagram/class.js - the Mermaid class diagram: classes with member blocks (class A { +field; +method() }) and member
// lines (A : +member), generics (List~T~ -> List<T>), labels (class A["Label"]), annotations (<<interface>> inside
// a body or as a line), relations <|-- *-- o-- --> -- ..> ..|> .. in both directions with cardinalities ("1" "*") and
// labels, namespaces (groups), notes (note for A "text", note "text"), classDef / style / cssClass / :::, direction.
// Classes are boxes with compartments (svg.js SHAPES.compartments); the layout is layout.js with parents placed above
// (a relation whose hollow triangle or diamond is on the right is turned around); cardinalities sit at the ends.
//
//   parseClass(src) -> { graph, errors }        classSVG(src, opts) -> SVG text

import { registerDiagram } from './index.js';
import { layoutGraph } from './layout.js';
import { renderSVG, compartmentSize, textSVG, THEMES } from './svg.js';
import { sourceLines, fail, unquote } from './kit.js';

//
// Reuses the flowchart pipeline: the parser emits the neutral graph (graph.js) with shape 'compartments', sizes are
// fixed before layout (compartmentSize), and layout.js/svg.js do the rest. Only cardinality labels are extra drawing.
// NAME allows one ~generic~ suffix; generics are rendered with <> but the node id is the base name (baseName), so
// "List~int~" and "List" refer to the same class, as in Mermaid.
const NAME = '[\\w.$-]+(?:~[^~\\s]+~)?';
// REL: A ["card"] [left end] (-- | ..) [right end] ["card"] B [: label]. One regex for all 9 relation kinds in both
// directions; end tokens map to svg.js markers through END.
const REL = new RegExp(`^(${NAME})\\s*(?:"([^"]*)"\\s*)?(<\\||\\*|o|<)?(--|\\.\\.)(\\|>|\\*|o|>)?\\s*(?:"([^"]*)"\\s*)?(${NAME})\\s*(?::\\s*(.*))?$`);
const END = { '<|': 'triangle', '|>': 'triangle', '*': 'diamond', o: 'diamondOpen', '<': 'open', '>': 'open' };
const generic = (s) => String(s).replace(/~([^~]*)~/g, '<$1>');
const baseName = (s) => String(s).replace(/~[^~]*~/, '');

export function parseClass(src) {
  const { title, lines } = sourceLines(src);
  const graph = { kind: 'class', direction: 'TB', title, nodes: [], edges: [], groups: [], classes: {} };
  const errors = [];
  const byId = new Map();
  const ns = [];
  const cls = (raw) => {
    const id = baseName(raw);
    let c = byId.get(id);
    if (!c) {
      c = { id, label: '', name: generic(raw), annotations: [], fields: [], methods: [], cls: [], shape: 'compartments' };
      if (ns.length) c.group = ns[ns.length - 1];
      byId.set(id, c);
      graph.nodes.push(c);
    } else if (/~/.test(raw)) c.name = generic(raw);
    return c;
  };
  // Methods vs fields by the presence of (...), the UML/Mermaid rule. Trailing $ (static) and * (abstract) markers are
  // stripped from the text (they are styling hints Mermaid renders as underline/italic, not drawn here).
  const member = (c, m) => {
    const s = m.trim();
    if (!s) return;
    const am = /^<<(.+)>>$/.exec(s);
    if (am) { c.annotations.push(am[1].trim()); return; }
    const text = generic(s.replace(/[$*]$/, '').replace(/\)\s*[$*]\s*/, ') '));
    (/\(.*\)/.test(s) ? c.methods : c.fields).push(text.trim());
  };
  let header = false, body = null, notes = 0;
  for (const { text, line } of lines) {
    let m;
    if (!header) { if (/^classDiagram(-v2)?\b/.test(text)) { header = true; continue; } fail(line, 'expected "classDiagram"'); }
    // Inside "class A {" every line is a member until a lone "}". Checked first so member text that looks like a
    // statement (e.g. a field named "direction") is not misparsed.
    if (body) {
      if (/^\}\s*$/.test(text)) { body = null; continue; }
      member(body, text);
      continue;
    }
    if ((m = /^direction\s+(TB|TD|BT|LR|RL)$/i.exec(text))) { graph.direction = m[1].toUpperCase() === 'TD' ? 'TB' : m[1].toUpperCase(); continue; }
    if ((m = /^title\s+(.+)$/i.exec(text))) { graph.title = m[1].trim(); continue; }
    if ((m = /^namespace\s+([\w.$-]+)\s*\{\s*$/.exec(text))) {
      graph.groups.push({ id: 'ns:' + m[1], label: m[1], parent: ns.length ? ns[ns.length - 1] : null });
      ns.push('ns:' + m[1]);
      continue;
    }
    if (/^\}\s*$/.test(text)) { if (!ns.length) errors.push({ line, message: 'unexpected "}"' }); ns.pop(); continue; }
    if ((m = new RegExp(`^class\\s+(${NAME})(?:\\s*\\["([^"]*)"\\])?(?::::([\\w-]+))?\\s*(\\{)?\\s*(.*?)\\s*(\\})?$`).exec(text))) {
      const c = cls(m[1]);
      if (m[2]) c.name = m[2];
      if (m[3]) c.cls.push(m[3]);
      if (m[4]) { if (m[6]) { for (const x of m[5].split(';')) member(c, x); } else { body = c; if (m[5]) member(c, m[5]); } }
      continue;
    }
    if ((m = new RegExp(`^<<(.+)>>\\s*(${NAME})$`).exec(text))) { cls(m[2]).annotations.push(m[1].trim()); continue; }
    if ((m = /^note\s+(?:for\s+([\w.$-]+)\s+)?"([^"]*)"$/i.exec(text))) {
      const nid = '__note' + notes++;
      graph.nodes.push({ id: nid, label: m[2].replace(/\\n/g, '\n'), shape: 'note', group: m[1] && byId.get(m[1]) ? byId.get(m[1]).group : undefined });
      if (m[1]) graph.edges.push({ from: nid, to: cls(m[1]).id, line: 'dotted', head: 'none', label: '' });
      continue;
    }
    if ((m = /^classDef\s+([\w,-]+)\s+(.+)$/.exec(text))) { for (const c of m[1].split(',')) graph.classes[c.trim()] = m[2].trim().replace(/;$/, ''); continue; }
    if ((m = /^cssClass\s+"([^"]+)"\s+([\w-]+)$/.exec(text))) { for (const id of m[1].split(',')) cls(id.trim()).cls.push(m[2]); continue; }
    if ((m = /^style\s+([\w.$-]+)\s+(.+)$/.exec(text))) { cls(m[1]).style = m[2].replace(/;$/, ''); continue; }
    if (/^(click|callback|link|accTitle|accDescr)\b/.test(text)) continue;
    if ((m = REL.exec(text))) {
      const [, a, ca, la, kind, ra, cb, b, label] = m;
      let e = { from: cls(a).id, to: cls(b).id, tail: END[la] || 'none', head: END[ra] || 'none', line: kind === '..' ? 'dotted' : 'solid', label: label ? unquote(label) : '', c1: ca || '', c2: cb || '' };
      // Layered layout puts edge sources above targets, so an inheritance/composition written child-first is flipped
      // (ends and cardinalities swapped with it): the picture stays semantically identical, but superclasses rank higher.
      // Parents (hollow triangles, diamonds) above their children.
      const strong = (x) => x === 'triangle' || x === 'diamond' || x === 'diamondOpen';
      if (strong(e.head) && !strong(e.tail)) e = { ...e, from: e.to, to: e.from, head: e.tail, tail: e.head, c1: e.c2, c2: e.c1 };
      graph.edges.push(e);
      continue;
    }
    if ((m = new RegExp(`^(${NAME})\\s*:\\s*(.+)$`).exec(text))) { member(cls(m[1]), m[2]); continue; }
    if ((m = new RegExp(`^(${NAME})(?::::([\\w-]+))?$`).exec(text))) { const c = cls(m[1]); if (m[2]) c.cls.push(m[2]); continue; }
    errors.push({ line, message: 'cannot read: ' + text.slice(0, 60) });
  }
  if (!header) fail(0, 'expected "classDiagram"');
  if (body) fail(0, 'class body without "}"');
  return { graph, errors };
}

export function classSVG(src, opts = {}) {
  const { graph, errors } = parseClass(src);
  if (!graph.nodes.length) fail(errors[0] && errors[0].line, errors.length ? errors[0].message : 'no classes');
  const fs = opts.fontSize || 14;
  for (const n of graph.nodes) {
    if (n.shape !== 'compartments') continue;
    n.sections = [
      { lines: [...n.annotations.map((a) => '«' + a + '»'), n.name], bold: true },
      { lines: n.fields, align: 'start' },
      { lines: n.methods, align: 'start' },
    ];
    n.fontSize = fs;
    Object.assign(n, compartmentSize(n.sections, fs));
  }
  const L = layoutGraph(graph, { rankSep: 60, nodeSep: 40, ...opts });
  const t = { ...(THEMES[opts.theme] || THEMES.light), ...(opts.colors || {}) };
  // Placed 22px along the first/last segment and 12px to its left normal (-uy, ux): beside the line, clear of the
  // marker, on a consistent side whatever the edge direction.
  // Cardinalities next to the ends of the relations.
  let extra = '';
  for (const e of L.edges) {
    for (const [txt, p, q] of [[e.c1, e.points[0], e.points[1]], [e.c2, e.points[e.points.length - 1], e.points[e.points.length - 2]]]) {
      if (!txt || !p || !q) continue;
      const dx = q[0] - p[0], dy = q[1] - p[1], d = Math.hypot(dx, dy) || 1;
      const ux = dx / d, uy = dy / d;
      extra += textSVG(txt, p[0] + ux * 22 - uy * 12, p[1] + uy * 22 + ux * 12, fs * 0.86, t.text);
    }
  }
  return renderSVG(L, { ...opts, extra, className: 'dg-class', classes: graph.classes, title: graph.title || opts.title });
}

registerDiagram('class', { detect: /^classDiagram(-v2)?\b/, render: classSVG });
