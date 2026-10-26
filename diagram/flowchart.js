// diagram/flowchart.js - the Mermaid flowchart language ('flowchart' / 'graph' with TD / TB / BT / LR / RL) parsed
// into the neutral graph of graph.js: node shapes ([] () ([]) [[]] [()] (()) ((())) {} {{}} [//] [\\] [/\] [\/] >]
// and A@{ shape, label }), quoted and Markdown-string labels, entity codes (#quot; #35;), edges (--> --- -.-> -.- ==>
// === ~~~ --o --x <--> o--o x--x, longer links span more ranks), edge text in both forms (-->|text| and -- text -->),
// chains and & lists, subgraphs with titles, nesting and direction, classDef / class / ::: / style / linkStyle,
// comments, front matter titles and init directives (ignored). Unknown statements are reported, never thrown.
//
//   parseFlowchart(src) -> { graph, errors: [{ line, message }] }
//   flowchartSVG(src, opts) -> SVG text        (layout.js + svg.js)

import { layoutGraph } from './layout.js';
import { renderSVG } from './svg.js';

//
// Parser design: hand-written scanner over statements, not a grammar generator. Mermaid's flowchart grammar is
// ambiguous (A--oB: edge "--o" to B, or edge "--" to node "oB"?) and full of context rules; prefix regexes tried in a
// fixed priority order resolve each ambiguity explicitly and keep the module dependency-free. Errors are collected
// with line numbers instead of thrown, so a half-typed diagram still renders what is valid (live preview).
//
// SHAPES order is significant: longest opener first. '(((' must be tried before '((' before '(', otherwise
// "((x))" would match the round shape and leave a stray ')' in the label.
const SHAPES = [
  ['(((', ')))', 'doublecircle'], ['((', '))', 'circle'], ['([', '])', 'stadium'], ['[[', ']]', 'subroutine'], ['[(', ')]', 'cylinder'],
  ['{{', '}}', 'hexagon'], ['[/', '/]', 'parallelogram'], ['[/', '\\]', 'trapezoid'], ['[\\', '\\]', 'parallelogramAlt'], ['[\\', '/]', 'trapezoidAlt'],
  ['(', ')', 'round'], ['[', ']', 'rect'], ['{', '}', 'diamond'], ['>', ']', 'asymmetric'],
];
// Mermaid v11 A@{ shape: … } names mapped onto the shapes svg.js can draw; unknown names degrade to rect.
const NEW_SHAPES = { rect: 'rect', rounded: 'round', stadium: 'stadium', 'fr-rect': 'subroutine', subproc: 'subroutine', cyl: 'cylinder', db: 'cylinder', circle: 'circle', circ: 'circle', 'dbl-circ': 'doublecircle', diam: 'diamond', diamond: 'diamond', decision: 'diamond', hex: 'hexagon', hexagon: 'hexagon', 'lean-r': 'parallelogram', 'lean-l': 'parallelogramAlt', 'trap-b': 'trapezoid', 'trap-t': 'trapezoidAlt', 'notch-rect': 'asymmetric', doc: 'rect', text: 'text', 'sm-circ': 'point', 'f-circ': 'point', note: 'note' };
// Node id: letters/digits (any script, \p{L}\p{N} with the u flag), _ $ and dots; a hyphen only when followed by an id
// character and not part of an arrow, so "a-b-->c" reads id "a-b", edge "-->", id "c".
const ID = /^[\p{L}\p{N}_$](?:[\p{L}\p{N}_$.]|-(?![-.>=])(?=[\p{L}\p{N}_$]))*/u;

// Mermaid entity syntax is #name; / #123; (no leading &). Unknown names are left as written, not dropped.
export const decodeEntities = (s) => s.replace(/#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/#([a-z]+);/gi, (m, n) => ({ quot: '"', amp: '&', lt: '<', gt: '>', nbsp: ' ', apos: "'" }[n.toLowerCase()] || m));
// Labels: quotes off, Markdown strings ("`**bold**`") to plain text, entities decoded.
export function cleanLabel(s) {
  let t = String(s).trim();
  if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') t = t.slice(1, -1);
  if (t.length >= 2 && t[0] === '`' && t[t.length - 1] === '`') t = t.slice(1, -1).replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/\n\s*/g, '\n');
  return decodeEntities(t).replace(/\\n/g, '\n');
}

// Statements: lines, split on ';' outside quotes and brackets; comments removed.
// Quote and bracket depth tracking: ';' inside a label (A["x;y"] or A[x;y]) is text, not a separator.
// A %% comment is cut before scanning, but not %%{ (init directives are stripped by the caller beforehand).
function statements(src) {
  const out = [];
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((raw, i) => {
    const line = raw.replace(/%%(?!\{).*$/, '');
    let cur = '', q = false, depth = 0;
    for (const ch of line) {
      if (ch === '"') q = !q;
      if (!q && '[({'.includes(ch)) depth++;
      if (!q && '])}'.includes(ch)) depth = Math.max(0, depth - 1);
      if (ch === ';' && !q && !depth) { if (cur.trim()) out.push({ text: cur.trim(), line: i + 1 }); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push({ text: cur.trim(), line: i + 1 });
  });
  return out;
}

// One edge token at the start of s: { len, line, head, tail, minLen, label } or null.
// Two edge forms. Form 1, inline text "A -- text --> B": open token, lazy text, close token. Accepted only when the
// close token makes it a real edge (arrow head, >= 3 dashes, or dotted) and the text does not itself contain a whole
// arrow; otherwise "A --- B --> C" would read "- B -" as a label. Form 2: a plain token with an optional |text|.
// minLen grows with extra dashes/dots/equals: Mermaid's "longer link spans more ranks".
function readEdge(s) {
  let m = /^\s*([<ox]?)(--|==|-\.)(?![->=.ox]|\s*[>|])\s*([^]*?)\s*(-{2,}|={2,}|\.+-)([>ox]?)(?=\s|[\p{L}\p{N}_"$(\[{]|$)/u.exec(s);
  if (m && m[3] && !/^[|]/.test(m[3])) {
    const endTok = m[4];
    const kind = m[2] === '==' ? '=' : m[2] === '-.' ? '.' : '-';
    if ((m[5] || endTok.length >= 3 || kind === '.') && !/-->|==>|-\.->/.test(m[3])) {
      return { len: m[0].length, line: kind === '=' ? 'thick' : kind === '.' ? 'dotted' : 'solid', head: mark(m[5]), tail: mark(m[1]), minLen: 1 + Math.max(0, endTok.length - (kind === '.' ? 2 : 3)), label: cleanLabel(m[3]) };
    }
  }
  m = /^\s*([<ox]?)(-{2,}|={2,}|-\.+-|~{3,})([>ox]?)(?![-=.~])/.exec(s);
  if (!m) return null;
  const tok = m[2];
  const kind = tok[0] === '~' ? '~' : tok[0] === '=' ? '=' : tok.includes('.') ? '.' : '-';
  // '--o' / '--x' end in a circle / cross, also before a node without a space (A--oB), as in Mermaid.
  const head = m[3], len = m[0].length;
  const extra = kind === '.' ? tok.length - 3 : kind === '~' ? 0 : tok.length - (head ? 2 : 3);
  const e = { len, line: kind === '=' ? 'thick' : kind === '.' ? 'dotted' : kind === '~' ? 'invisible' : 'solid', head: kind === '~' ? 'none' : mark(head), tail: mark(m[1]), minLen: 1 + Math.max(0, extra), label: '' };
  const lm = /^\s*\|([^|]*)\|/.exec(s.slice(len));
  if (lm) { e.label = cleanLabel(lm[1]); e.len += lm[0].length; }
  return e;
}
const mark = (c) => (c === '>' || c === '<' ? 'arrow' : c === 'o' ? 'circle' : c === 'x' ? 'cross' : 'none');

// Single pass over statements; subgraphs are a stack, so nesting needs no recursion. node() lazily creates nodes on
// first reference (Mermaid has no declarations) and attaches them to the innermost open subgraph.
export function parseFlowchart(src) {
  const errors = [];
  const graph = { kind: 'flowchart', direction: 'TB', nodes: [], edges: [], groups: [], classes: {}, title: '' };
  const nodes = new Map();
  const stack = [];
  let text = String(src || '');
  const fm = /^\s*---\n([\s\S]*?)\n---\s*\n/.exec(text.replace(/\r\n?/g, '\n'));
  if (fm) { const tm = /^title:\s*(.+)$/m.exec(fm[1]); if (tm) graph.title = cleanLabel(tm[1]); text = text.replace(/\r\n?/g, '\n').slice(fm[0].length); }
  const st = statements(text.replace(/%%\{[\s\S]*?\}%%/g, ''));
  let headerSeen = false;
  const node = (id) => {
    let n = nodes.get(id);
    if (!n) { n = { id, label: id, shape: 'rect', cls: [] }; nodes.set(id, n); graph.nodes.push(n); }
    if (stack.length && !n.group) n.group = stack[stack.length - 1].id;
    return n;
  };
  // A node reference with an optional shape and class at the start of s: { ids, len } or null.
  const readNode = (s) => {
    const m = /^\s*/.exec(s);
    let i = m[0].length;
    const im = ID.exec(s.slice(i));
    if (!im) return null;
    const id = im[0];
    i += id.length;
    const n = node(id);
    let rest = s.slice(i);
    const nm = /^@\{([^}]*)\}/.exec(rest);
    if (nm) {
      const props = Object.fromEntries([...nm[1].matchAll(/(\w+)\s*:\s*("[^"]*"|[^,]+)/g)].map((x) => [x[1], x[2].trim().replace(/^"|"$/g, '')]));
      if (props.shape) n.shape = NEW_SHAPES[props.shape] || 'rect';
      if (props.label) n.label = cleanLabel(props.label);
      i += nm[0].length; rest = s.slice(i);
    } else {
      for (const [open, close, shape] of SHAPES) {
        if (!rest.startsWith(open)) continue;
        let j = open.length;
        let body;
        const qm = /^\s*("(?:[^"\\]|\\.)*")\s*/.exec(rest.slice(j));
        if (qm && rest.slice(j + qm[0].length).startsWith(close)) { body = qm[1]; j += qm[0].length; }
        else {
          const k = rest.indexOf(close, j);
          if (k < 0) continue;
          // Both openers share a prefix with two different closers; without this check "[/a\] --> b[/c/]" would take the far
          // "/]" and swallow the edge into the label.
          // [/ … /] against [/ … \]: the nearest closer wins.
          if (open === '[/' || open === '[\\') {
            const alt = open === '[/' ? ['\\]', open === '[/' ? 'trapezoid' : 'trapezoidAlt'] : ['/]', 'trapezoidAlt'];
            const k2 = rest.indexOf(alt[0], j);
            if (k2 >= 0 && k2 < k) continue;
          }
          body = rest.slice(j, k);
          j = k;
        }
        n.shape = shape;
        n.label = cleanLabel(body);
        i += j + close.length;
        rest = s.slice(i);
        break;
      }
    }
    const cm = /^:::([\w-]+)/.exec(rest);
    if (cm) { if (!n.cls.includes(cm[1])) n.cls.push(cm[1]); i += cm[0].length; }
    return { ids: [id], len: i };
  };
  const readGroup = (s) => {
    const first = readNode(s);
    if (!first) return null;
    let len = first.len;
    const ids = first.ids.slice();
    for (;;) {
      const am = /^\s*&\s*/.exec(s.slice(len));
      if (!am) break;
      const nx = readNode(s.slice(len + am[0].length));
      if (!nx) break;
      ids.push(...nx.ids);
      len += am[0].length + nx.len;
    }
    return { ids, len };
  };
  // The header is optional in practice (detection already happened in index.js); a first line that is not a header
  // is processed as a normal statement rather than rejected.
  for (const { text: s, line } of st) {
    let m;
    if (!headerSeen) {
      if ((m = /^(flowchart|graph|flowchart-elk)\b\s*(TD|TB|BT|LR|RL|>|<|\^|v)?/i.exec(s))) {
        headerSeen = true;
        const d = (m[2] || 'TB').toUpperCase();
        graph.direction = { TD: 'TB', '>': 'LR', '<': 'RL', '^': 'BT', V: 'TB' }[d] || d;
        const rest = s.slice(m[0].length).trim();
        if (!rest) continue;
        // 'graph LR; A-->B' on one line: the statement continues.
        handle(rest, line);
        continue;
      }
      headerSeen = true;
    }
    handle(s, line);
  }
  function handle(s, line) {
    let m;
    if ((m = /^subgraph\s+(.+)$/i.exec(s))) {
      const spec = m[1].trim();
      let id, label;
      const bm = /^([^\s[\]"]+)\s*\[(.*)\]\s*$/.exec(spec);
      if (bm) { id = bm[1]; label = cleanLabel(bm[2]); }
      else if (/^"/.test(spec)) { label = cleanLabel(spec); id = 'sg' + graph.groups.length; }
      else if (/\s/.test(spec)) { label = cleanLabel(spec); id = spec.replace(/\s+/g, '_'); }
      else { id = spec; label = spec; }
      const g = { id, label, parent: stack.length ? stack[stack.length - 1].id : null };
      graph.groups.push(g);
      stack.push(g);
      return;
    }
    if (/^end$/i.test(s)) { if (!stack.length) errors.push({ line, message: '"end" without "subgraph"' }); stack.pop(); return; }
    if ((m = /^direction\s+(TB|TD|BT|LR|RL)$/i.exec(s))) { const d = m[1].toUpperCase(); if (stack.length) stack[stack.length - 1].direction = d === 'TD' ? 'TB' : d; else graph.direction = d === 'TD' ? 'TB' : d; return; }
    if ((m = /^classDef\s+([\w,-]+)\s+(.+)$/i.exec(s))) { for (const c of m[1].split(',')) graph.classes[c.trim()] = m[2].trim(); return; }
    if ((m = /^class\s+([^\s]+)\s+([\w-]+)\s*$/i.exec(s))) { for (const id of m[1].split(',')) { const n = node(id.trim()); if (!n.cls.includes(m[2])) n.cls.push(m[2]); } return; }
    if ((m = /^style\s+([^\s]+)\s+(.+)$/i.exec(s))) {
      const g = graph.groups.find((x) => x.id === m[1]);
      if (g) g.style = m[2]; else node(m[1]).style = m[2];
      return;
    }
    if ((m = /^linkStyle\s+([\d,\s]+|default)\s+(.+)$/i.exec(s))) { (graph.linkStyles = graph.linkStyles || []).push({ which: m[1].trim(), style: m[2].trim() }); return; }
    if (/^(click|accTitle|accDescr|title)\b/i.test(s)) { const tm = /^title\s+(.+)$/i.exec(s); if (tm) graph.title = cleanLabel(tm[1]); return; }
    // "A & B --> C & D" is a cross product: 4 edges. prev carries the right-hand group to the next link of the chain.
    // A chain: group (edge group)*.
    let pos = 0;
    const g0 = readGroup(s);
    if (!g0) { errors.push({ line, message: 'cannot read: ' + s.slice(0, 60) }); return; }
    pos = g0.len;
    let prev = g0.ids;
    for (;;) {
      const e = readEdge(s.slice(pos));
      if (!e) break;
      pos += e.len;
      const nx = readGroup(s.slice(pos));
      if (!nx) { errors.push({ line, message: 'edge without a target: ' + s.slice(0, 60) }); break; }
      pos += nx.len;
      for (const a of prev) for (const b of nx.ids) graph.edges.push({ from: a, to: b, label: e.label, line: e.line, head: e.head, tail: e.tail, minLen: e.minLen });
      prev = nx.ids;
    }
    if (s.slice(pos).trim()) errors.push({ line, message: 'unexpected: ' + s.slice(pos).trim().slice(0, 40) });
  }
  if (stack.length) errors.push({ line: 0, message: 'subgraph without "end"' });
  // Only bare references are removed (label === id, default rect shape): a node explicitly given a label or shape
  // keeps existing even if a subgraph has the same id.
  // Ids that only name a subgraph are not nodes: edges to them end at the subgraph's frame (layout.js).
  const gIds = new Set(graph.groups.map((g) => g.id));
  graph.nodes = graph.nodes.filter((n) => !(gIds.has(n.id) && n.label === n.id && n.shape === 'rect'));
  // classDef default and linkStyle.
  // linkStyle indexes count edges in source order, which is why layout.js preserves edge order on output.
  if (graph.classes.default) for (const n of graph.nodes) if (!n.cls.length) n.cls.push('default');
  for (const ls of graph.linkStyles || []) {
    const idx = ls.which === 'default' ? graph.edges.map((_, i) => i) : ls.which.split(',').map((x) => +x.trim());
    for (const i of idx) if (graph.edges[i]) graph.edges[i].style = ls.style;
  }
  delete graph.linkStyles;
  return { graph, errors };
}

// Throw only when nothing renderable came out; partial errors are tolerated (lenient like Mermaid's own renderer).
export function flowchartSVG(src, opts = {}) {
  const { graph, errors } = parseFlowchart(src);
  if (!graph.nodes.length && errors.length) throw new Error(errors.map((e) => (e.line ? 'line ' + e.line + ': ' : '') + e.message).join('\n'));
  const L = layoutGraph(graph, opts);
  return renderSVG(L, { className: 'dg-flowchart', ...opts, classes: graph.classes, title: graph.title || opts.title });
}
