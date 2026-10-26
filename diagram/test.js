// diagram/test.js - unit tests of the diagram library: node diagram/test.js (also node check.js tests diagram).
//
// Test style: a dependency-free ok(condition, name, info) harness, so the tests run in bare Node with no framework
// and the same run() can be called by the repo-wide check.js. Failures print and are counted; the process exit code
// is set only when executed directly (bottom line), so importing this file has no side effects.
// What is asserted: invariants rather than pixel snapshots (no overlaps, escaping, unique ids, well-formed SVG),
// because exact coordinates change with every layout tweak while these properties must always hold.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFlowchart } from './flowchart.js';
import { layoutGraph, clipToShape } from './layout.js';
import { renderSVG, edgePath, styleOf } from './svg.js';
import { renderDiagram, detectDiagram } from './index.js';
import { createGraph, graphSVG } from './graph.js';
import { textWidth, labelBox } from './measure.js';
import { DIAGRAM_KINDS } from './all.js';
import { parseSequence } from './sequence.js';
import { parseClass } from './class.js';
import { parseState } from './state.js';
import { parseER } from './er.js';
import { parsePie } from './pie.js';
import { parseGantt, parseDate, formatDate } from './gantt.js';
import { parseGitGraph } from './gitgraph.js';
import { parseMindmap } from './mindmap.js';
import { parseTimeline } from './timeline.js';
import { parseJourney } from './journey.js';
import { parseQuadrant } from './quadrant.js';

let failed = 0, passed = 0;
const ok = (c, name, info) => { if (c) passed++; else { failed++; console.log('x diagram: ' + name + (info !== undefined ? ' ' + JSON.stringify(info) : '')); } };
// Centre-based box overlap with 0.5px tolerance (touching boxes are not overlapping; rounding noise is ignored).
const overlap = (a, b) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 0.5 && Math.abs(a.y - b.y) < (a.h + b.h) / 2 - 0.5;

export function run() {
  // Measures.
  ok(textWidth('iii') < textWidth('MMM'), 'narrow and wide letters');
  ok(Math.abs(textWidth('中文', 10) - 20) < 0.01, 'full-width CJK');
  ok(labelBox('a<br>b').lines.length === 2 && labelBox('').h === 0, 'label lines');

  // Parser: shapes, labels, edges, chains, groups, classes.
  const { graph, errors } = parseFlowchart(`---
title: Demo
---
flowchart LR
  %% a comment
  A[Start] --> B{Is it?}
  B -- Yes --> C([Do it]) & D[(Store)]
  B -->|No| E((End))
  C -.-> E
  D ==> E
  F[/In/] --- G[\\Out\\] ~~~ H{{Hex}}
  I["Quoted #quot;label#quot;"]:::hot
  J>flag] --o K(((done)))
  L --x M
  N <--> O
  P ----> Q
  subgraph S1 [Group one]
    direction TB
    X1 --> X2
    subgraph S2
      Y1
    end
  end
  classDef hot fill:#f96,stroke:#333,stroke-width:2px
  class A,B hot
  style C fill:#bbf
  linkStyle 0 stroke:#f00
`);
  ok(!errors.length, 'flowchart parses without errors', errors);
  ok(graph.direction === 'LR' && graph.title === 'Demo', 'direction and title');
  const N = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
  ok(N.A.shape === 'rect' && N.B.shape === 'diamond' && N.C.shape === 'stadium' && N.D.shape === 'cylinder' && N.E.shape === 'circle', 'shapes 1', graph.nodes.map((n) => n.shape));
  ok(N.F.shape === 'parallelogram' && N.G.shape === 'parallelogramAlt' && N.H.shape === 'hexagon' && N.J.shape === 'asymmetric' && N.K.shape === 'doublecircle', 'shapes 2');
  ok(N.I.label === 'Quoted "label"' && N.I.cls.includes('hot') && N.A.cls.includes('hot'), 'quoted labels, entities, classes');
  const ed = (a, b) => graph.edges.find((e) => e.from === a && e.to === b);
  ok(ed('B', 'C') && ed('B', 'C').label === 'Yes' && ed('B', 'D') && ed('B', 'D').label === 'Yes', 'text edge with & targets');
  ok(ed('B', 'E').label === 'No' && ed('C', 'E').line === 'dotted' && ed('D', 'E').line === 'thick', 'pipe labels, dotted, thick');
  ok(ed('F', 'G').head === 'none' && ed('G', 'H').line === 'invisible', 'open link and invisible link');
  ok(ed('J', 'K').head === 'circle' && ed('L', 'M').head === 'cross' && ed('N', 'O').tail === 'arrow' && ed('N', 'O').head === 'arrow', 'end markers');
  ok(ed('P', 'Q').minLen === 3, 'longer links span more ranks', ed('P', 'Q'));
  ok(graph.groups.length === 2 && graph.groups[0].label === 'Group one' && graph.groups[1].parent === 'S1' && N.Y1.group === 'S2' && N.X1.group === 'S1', 'nested subgraphs');
  ok(graph.classes.hot && N.C.style === 'fill:#bbf' && graph.edges[0].style === 'stroke:#f00', 'classDef, style, linkStyle');
  ok(styleOf('fill:#f96,stroke:#333,stroke-width:2px').strokeWidth === 2, 'style specs');
  ok(parseFlowchart('graph TD; a-->b; b-->c').graph.edges.length === 2, 'statements on one line');
  ok(parseFlowchart('graph TD\n a-b --> c').graph.nodes.some((n) => n.id === 'a-b'), 'ids with dashes');
  ok(parseFlowchart('flowchart TD\n A@{ shape: cyl, label: "Disk" }').graph.nodes[0].shape === 'cylinder', 'new shape syntax');
  ok(parseFlowchart('flowchart TD\n A --> \n').errors.length === 1, 'errors are reported, not thrown');

  // Layout: no overlaps, ranks in order, groups enclose their members, cycles survive.
  for (const dir of ['TB', 'BT', 'LR', 'RL']) {
    const g = { ...graph, direction: dir };
    const L = layoutGraph(g);
    const ns = L.nodes;
    let bad = 0;
    for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) if (overlap(ns[i], ns[j])) bad++;
    ok(!bad, 'no node overlaps ' + dir, bad);
    const byId = Object.fromEntries(ns.map((n) => [n.id, n]));
    const axis = dir === 'TB' ? (n) => n.y : dir === 'BT' ? (n) => -n.y : dir === 'LR' ? (n) => n.x : (n) => -n.x;
    ok(axis(byId.A) < axis(byId.B) && axis(byId.B) < axis(byId.E), 'ranks follow edges ' + dir);
    const s1 = L.groups.find((x) => x.id === 'S1');
    const inside = (n, b) => n.x - n.w / 2 >= b.x - 0.5 && n.x + n.w / 2 <= b.x + b.w + 0.5 && n.y - n.h / 2 >= b.y - 0.5 && n.y + n.h / 2 <= b.y + b.h + 0.5;
    ok(inside(byId.X1, s1) && inside(byId.X2, s1) && inside(byId.Y1, s1), 'group encloses members ' + dir, s1);
    ok(ns.every((n) => !(n.group === undefined || n.group === null) || !inside(n, s1)), 'outsiders stay outside the group ' + dir);
    ok(L.edges.every((e) => e.points.length >= 2 && e.points.every((p) => isFinite(p[0]) && isFinite(p[1]))), 'edge points ' + dir);
    ok(ns.every((n) => n.x - n.w / 2 >= 0 && n.y - n.h / 2 >= 0 && n.x + n.w / 2 <= L.width + 0.5 && n.y + n.h / 2 <= L.height + 0.5), 'inside the picture ' + dir);
  }
  const cyc = layoutGraph(parseFlowchart('graph TD\n a-->b-->c-->a\n c-->c').graph);
  ok(cyc.nodes.length === 3 && cyc.edges.length === 4 && cyc.edges.some((e) => e.loop), 'cycles and self loops');
  const [cx, cy] = clipToShape('diamond', 0, 0, 20, 10, 100, 0);
  ok(Math.abs(cx - 10) < 1e-9 && cy === 0, 'clip to a diamond');
  ok(edgePath([[0, 0], [10, 10], [20, 0]]).startsWith('M0 0L') && edgePath([[0, 0], [5, 5]]) === 'M0 0L5 5', 'edge paths');

  // Rendering.
  const svg = renderDiagram('flowchart TD\n A[<b>x</b> & "y"] --> B').svg;
  ok(svg.startsWith('<svg') && svg.includes('&lt;b&gt;') && !svg.includes('<b>'), 'labels are escaped');
  ok(detectDiagram('%%{init: {"theme":"dark"}}%%\ngraph LR\nA-->B') === 'flowchart', 'detect after directives');
  const bad = renderDiagram('nonsense here');
  ok(bad.error && bad.svg.includes('Unknown diagram'), 'unknown kinds give an error picture');
  const b = createGraph({ direction: 'LR' });
  b.node('s', 'Subject', { accent: 1 }); b.node('o', 'Object'); b.edge('s', 'o', { label: 'acts on' });
  const s2 = graphSVG(b.graph, { theme: 'dark' });
  ok(s2.includes('acts on') && s2.includes('marker-end'), 'builder graphs render');
  ok(renderSVG(layoutGraph({ nodes: [], edges: [] })).startsWith('<svg'), 'empty graphs');

  // Seeded LCG (glibc constants) instead of Math.random: the "random" graph is identical on every run, so a failure
  // is reproducible. Edges only go from lower to higher index, which guarantees a DAG.
  // A larger random DAG stays overlap free and reasonably uncrossed.
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const big = { direction: 'TB', nodes: [], edges: [] };
  for (let i = 0; i < 40; i++) big.nodes.push({ id: 'n' + i, label: 'node ' + i });
  for (let i = 1; i < 40; i++) { big.edges.push({ from: 'n' + Math.floor(rnd() * i), to: 'n' + i }); if (rnd() < 0.4) big.edges.push({ from: 'n' + Math.floor(rnd() * i), to: 'n' + i, label: rnd() < 0.3 ? 'lbl' : '' }); }
  const BL = layoutGraph(big);
  let bad2 = 0;
  for (let i = 0; i < BL.nodes.length; i++) for (let j = i + 1; j < BL.nodes.length; j++) if (overlap(BL.nodes[i], BL.nodes[j])) bad2++;
  ok(!bad2, 'random DAG without overlaps', bad2);

  testKinds();

  console.log(`diagram: ${passed} passed, ${failed} failed`);
  return failed;
}

// wellFormed: cheap structural checks, plus the classic leak detector: NaN/undefined/Infinity in the text means a
// computation went wrong somewhere and was interpolated into an attribute.
const ids = (svg) => [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const wellFormed = (svg) => svg.startsWith('<svg') && svg.endsWith('</svg>') && /viewBox="0 0 \d+ \d+"/.test(svg) && !/NaN|undefined|Infinity/.test(svg);

function testKinds() {
  ok(['sequence', 'class', 'state', 'er', 'pie', 'gantt', 'gitgraph', 'mindmap', 'timeline', 'journey', 'quadrant'].every((k) => DIAGRAM_KINDS.includes(k)), 'all kinds registered', DIAGRAM_KINDS);
  const R = (src, o) => renderDiagram(src, o);

  // Sequence.
  const seqSrc = `sequenceDiagram
    title Login
    autonumber
    actor U as User
    participant W as Web<br>app
    U->>+W: open <page>
    W-->>U: html
    W-xU: lost
    W-)U: async
    U<<->>W: both
    loop every minute
      W->>W: tick
      alt ok
        W->>-U: done
      else failed
        W--)U: retry
      end
    end
    Note over U,W: shared
    Note right of W: right
    rect rgb(200, 220, 255)
      U->W: plain
    end
    activate U
    deactivate U`;
  const sq = parseSequence(seqSrc);
  ok(sq.participants.length === 2 && sq.participants[0].kind === 'actor' && sq.participants[1].label === 'Web<br>app', 'sequence participants and aliases', sq.participants);
  const msgs = sq.events.filter((e) => e.type === 'msg');
  ok(msgs.length === 9 && msgs[0].act === '+' && msgs[1].line === 'dotted' && msgs[2].head === 'cross' && msgs[3].head === 'open' && msgs[4].tail === 'arrow', 'sequence arrows', msgs.map((m) => [m.line, m.head, m.tail]));
  ok(msgs[0].number === 1 && msgs[8].number === 9, 'autonumber');
  ok(sq.events.filter((e) => e.type === 'start').length === 3 && sq.events.filter((e) => e.type === 'else').length === 1 && sq.events.filter((e) => e.type === 'note').length === 2, 'blocks and notes');
  const s1 = R(seqSrc).svg;
  ok(wellFormed(s1) && s1.includes('dg-sequence') && s1.includes('open &lt;page&gt;') && s1.includes('dg-activation') && s1.includes('[every minute]') && s1.includes('>Login<'), 'sequence SVG', s1.slice(0, 200));
  ok(R('sequenceDiagram\n A->>B: hi\n B->>C: yo').svg.includes('>C<'), 'implicit participants');
  ok(R('sequenceDiagram\n loop x\n A->>B: hi').error, 'unclosed blocks are errors');
  ok(R('sequenceDiagram\n A->>B: hi', { theme: 'dark' }).svg.includes('#e8eaf3'), 'sequence dark theme');

  // Class.
  const clsSrc = `classDiagram
    direction LR
    class Animal {
      <<abstract>>
      +String name
      +speak()* void
    }
    class List~T~
    Animal : +int age
    Animal <|-- Duck
    Duck "1" *-- "many" Leg : has
    Duck ..> List~T~ : uses
    Duck --|> Bird
    namespace Zoo {
      class Keeper
    }
    note for Duck "quacks"`;
  const C = parseClass(clsSrc);
  const cn = Object.fromEntries(C.graph.nodes.map((n) => [n.id, n]));
  ok(!C.errors.length && C.graph.direction === 'LR', 'class parses', C.errors);
  ok(cn.Animal.fields.join() === '+String name,+int age' && cn.Animal.methods[0] === '+speak() void' && cn.Animal.annotations[0] === 'abstract', 'class members', cn.Animal);
  ok(cn.List.name === 'List<T>' && cn.Keeper.group === 'ns:Zoo', 'generics and namespaces');
  const ce = (a, b) => C.graph.edges.find((e) => e.from === a && e.to === b);
  ok(ce('Animal', 'Duck').tail === 'triangle' && ce('Duck', 'Leg').tail === 'diamond' && ce('Duck', 'Leg').c2 === 'many' && ce('Duck', 'List').line === 'dotted', 'class relations', C.graph.edges);
  ok(ce('Bird', 'Duck') && ce('Bird', 'Duck').tail === 'triangle', 'parents are placed above (turned relation)');
  const s2 = R(clsSrc).svg;
  ok(wellFormed(s2) && s2.includes('dg-class') && s2.includes('List&lt;T&gt;') && s2.includes('«abstract»') && s2.includes('>many<') && s2.includes('<marker'), 'class SVG');

  // State.
  const stSrc = `stateDiagram-v2
    [*] --> Idle
    Idle --> Running : start
    Running --> Idle : stop
    state Check <<choice>>
    Running --> Check
    Check --> Done
    state Done {
      [*] --> Saving
      Saving --> [*]
    }
    state "A long name" as L
    Done --> L
    L : described
    state f <<fork>>
    L --> f
    note right of Idle : waiting
    note left of L
      two
      lines
    end note
    L --> [*]`;
  const S = parseState(stSrc);
  const sn = Object.fromEntries(S.graph.nodes.map((n) => [n.id, n]));
  ok(!S.errors.length, 'state parses', S.errors);
  ok(sn.__start_root.shape === 'dot' && sn.__end_root.shape === 'bullseye' && sn.__start_Done.group === 'Done' && !sn.Done, 'state start / end per scope, composites are groups');
  ok(sn.Check.shape === 'diamond' && sn.f.shape === 'bar' && sn.L.label === 'A long name' && sn.L.desc[0] === 'described', 'choice, fork, descriptions');
  ok(S.graph.nodes.filter((n) => n.shape === 'note').length === 2 && S.graph.nodes.some((n) => n.label === 'two\nlines'), 'state notes');
  const s3 = R(stSrc, { theme: 'dark' }).svg;
  ok(wellFormed(s3) && s3.includes('dg-state') && s3.includes('>start<') && s3.includes('dg-group'), 'state SVG');
  const SL = layoutGraph(S.graph);
  let so = 0;
  for (let i = 0; i < SL.nodes.length; i++) for (let j = i + 1; j < SL.nodes.length; j++) if (overlap(SL.nodes[i], SL.nodes[j])) so++;
  ok(!so, 'state layout without overlaps', so);

  // ER.
  const erSrc = `erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE-ITEM : contains
    CUSTOMER }|..|{ ADDRESS : "uses"
    p["Person"] |o--o| CUSTOMER : is
    CUSTOMER {
      string name PK "the name"
      string email UK
    }`;
  const E = parseER(erSrc);
  ok(!E.errors.length && E.graph.nodes.length === 5, 'er parses', E.errors);
  const ee = E.graph.edges;
  ok(ee[0].tail === 'one' && ee[0].head === 'zeroOrMany' && ee[1].head === 'oneOrMany' && ee[2].tail === 'oneOrMany' && ee[2].line === 'dotted' && ee[3].tail === 'zeroOrOne' && ee[3].head === 'zeroOrOne', 'crow\'s feet', ee);
  ok(E.graph.nodes.find((n) => n.id === 'p').name === 'Person' && E.graph.nodes[0].attrs[0].join('|') === 'string|name|PK|the name', 'entity labels and attributes');
  const s4 = R(erSrc).svg;
  ok(wellFormed(s4) && s4.includes('dg-er') && s4.includes('>places<') && s4.includes('>the name<'), 'er SVG');

  // Pie.
  const pieSrc = 'pie showData title Pets\n "Dogs" : 386\n "Cats" : 85.5\n "Rats" : 15';
  const P = parsePie(pieSrc);
  ok(P.showData && P.title === 'Pets' && P.slices.length === 3 && P.slices[1].value === 85.5, 'pie parses');
  const s5 = R(pieSrc).svg;
  ok(wellFormed(s5) && (s5.match(/dg-slice/g) || []).length === 3 && s5.includes('Dogs [386]') && s5.includes('79%'), 'pie SVG');
  ok(wellFormed(R('pie\n "Only" : 1').svg), 'a single slice is a circle');
  ok(R('pie\n "Bad" : -1').error, 'negative slices are errors');

  // Gantt.
  ok(parseDate('2024-02-03', 'YYYY-MM-DD') === Date.UTC(2024, 1, 3) && parseDate('03.02.24 10:30', 'DD.MM.YY HH:mm') === Date.UTC(2024, 1, 3, 10, 30), 'gantt dates');
  ok(formatDate(Date.UTC(2024, 1, 3), '%d %b %Y') === '03 Feb 2024', 'gantt axis format');
  const gSrc = `gantt
    title Plan
    dateFormat YYYY-MM-DD
    excludes weekends
    section One
    A :a1, 2026-01-01, 7d
    B :after a1, 2d
    section Two
    C :crit, done, c1, 2026-01-02, 2026-01-05
    D :active, after b9 a1, 1w
    E :milestone, m1, after c1, 0d
    F :until m1
    G :b9, 2026-01-03, 1d`;
  const g = parseGantt(gSrc);
  const gt = Object.fromEntries(g.tasks.map((x) => [x.name, x]));
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  ok(day(gt.A.end) === '2026-01-10' && day(gt.B.start) === '2026-01-10' && day(gt.B.end) === '2026-01-14', 'gantt durations skip weekends', [day(gt.A.end), day(gt.B.end)]);
  ok(gt.C.crit && gt.C.done && day(gt.E.start) === '2026-01-05' && gt.E.milestone && day(gt.D.start) === '2026-01-10', 'gantt tags, ids and forward references', [day(gt.E.start), day(gt.D.start)]);
  const s6 = R(gSrc, { today: '2026-01-06' }).svg;
  ok(wellFormed(s6) && s6.includes('dg-gantt') && (s6.match(/dg-task/g) || []).length === 7 && s6.includes('dg-today') && s6.includes('>Two<'), 'gantt SVG');
  ok(!R(gSrc).svg.includes('dg-today'), 'no today marker unless asked');
  ok(R('gantt\n A :after nowhere, 1d').error, 'unknown references are errors');

  // Git graph.
  const gitSrc = `gitGraph
    commit id: "a"
    commit id: "b" tag: "v1"
    branch dev order: 1
    commit id: "c" type: HIGHLIGHT
    checkout main
    commit id: "d" type: REVERSE
    merge dev id: "m" tag: "v2"
    cherry-pick id: "c"`;
  const gg = parseGitGraph(gitSrc);
  ok(gg.branches.length === 2 && gg.commits.length === 6 && gg.commits[4].merge && gg.commits[4].parents.join() === 'd,c' && gg.commits[5].cherry === 'c', 'git graph model', gg.commits.map((c) => c.id));
  const s7 = R(gitSrc).svg;
  ok(wellFormed(s7) && s7.includes('dg-gitgraph') && s7.includes('>v2<') && (s7.match(/dg-commit/g) || []).length === 6, 'git graph SVG');
  ok(/line 2: branch "x" does not exist/.test(R('gitGraph\n checkout x').error || ''), 'git graph errors name the line', R('gitGraph\n checkout x').error);
  ok(wellFormed(R('gitGraph TB:\n commit\n branch b\n commit\n checkout main\n merge b').svg), 'vertical git graph');

  // Mind map.
  const mm = parseMindmap('mindmap\n  root((Root))\n    A[Square]\n      A1\n    B)Cloud(\n    C))Bang((\n      ::icon(fa fa-book)\n    D{{Hex}}:::urgent');
  ok(mm.label === 'Root' && mm.shape === 'circle' && mm.children.length === 4 && mm.children[0].children[0].label === 'A1' && mm.children[1].shape === 'cloud' && mm.children[2].shape === 'bang' && mm.children[3].shape === 'hexagon' && mm.children[3].label === 'Hex', 'mind map tree and shapes', mm);
  const s8 = R('mindmap\n  root((Root))\n    A[Square]\n      A1\n    B\n    C').svg;
  ok(wellFormed(s8) && s8.includes('dg-mindmap') && (s8.match(/dg-node/g) || []).length === 5, 'mind map SVG');
  ok(R('mindmap\n root\n other').error, 'two roots are an error');

  // Timeline, journey, quadrant.
  const tl = parseTimeline('timeline\n title T\n section S1\n 2002 : A\n 2004 : B : C\n      : D');
  ok(tl.title === 'T' && tl.sections[0].periods[1].events.join() === 'B,C,D', 'timeline parses', tl);
  ok(wellFormed(R('timeline\n 2002 : A\n 2004 : B').svg), 'timeline SVG');
  const jr = parseJourney('journey\n title Day\n section Work\n  Tea: 5: Me\n  Work: 1: Me, Cat');
  ok(jr.actors.join() === 'Me,Cat' && jr.sections[0].tasks[1].score === 1, 'journey parses');
  ok(wellFormed(R('journey\n section Work\n  Tea: 5: Me').svg), 'journey SVG');
  const qd = parseQuadrant('quadrantChart\n x-axis Low --> High\n y-axis Bottom --> Top\n quadrant-1 Q1\n A: [0.3, 0.6]\n B: [0.9, 0.1] radius: 9, color: #ff0000');
  ok(qd.x.join() === 'Low,High' && qd.quadrants[0] === 'Q1' && qd.points[1].r === 9 && qd.points[1].color === '#ff0000', 'quadrant parses', qd);
  ok(wellFormed(R('quadrantChart\n A: [0.3, 0.6]').svg), 'quadrant SVG');

  // Same idPrefix for every sample on purpose: ids must still differ (the per-call counter in nextId), otherwise two
  // inline SVGs on one page would share marker ids.
  // Every kind: unique ids per picture, themes, escaping.
  const samples = [seqSrc, clsSrc, stSrc, erSrc, 'pie\n "a" : 1', gSrc, gitSrc, 'mindmap\n r\n  c', 'timeline\n 1 : a', 'journey\n t: 3: me', 'quadrantChart\n p: [0.5, 0.5]'];
  const pics = samples.map((s) => R(s, { idPrefix: 'x' }));
  ok(pics.every((p) => !p.error), 'every sample renders', pics.map((p) => p.error));
  const roots = pics.map((p) => /<svg[^>]* id="([^"]+)"/.exec(p.svg)[1]);
  ok(new Set(roots).size === roots.length && pics.every((p, i) => ids(p.svg).every((x) => x.startsWith(roots[i]))), 'ids are unique per picture and prefixed', roots);
  ok(samples.every((s) => R(s, { theme: 'neutral' }).error === null && R(s, { theme: 'forest' }).error === null), 'every theme renders');
  ok(['sequenceDiagram\n A->>B: <script>', 'pie\n "<b>" : 1', 'mindmap\n <i>x</i>', 'timeline\n <x> : <y>', 'classDiagram\n class A\n A : <b>x</b>'].every((s) => !/<script|<b>|<i>|<x>/.test(R(s).svg)), 'text is escaped in every kind');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = run() ? 1 : 0;
