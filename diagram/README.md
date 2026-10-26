# diagram/

Diagrams from text and from programs: one neutral graph model, a layered layout with nested groups, SVG output, and
diagram languages in the manner of Mermaid parsed by this library (no third-party code). Pure ES modules, importable
in Node; SVG comes out as text, nothing touches the DOM.

| file | contents |
| --- | --- |
| `graph.js` | the graph model shared by every graph-shaped kind (nodes, edges, groups, classes) and `createGraph()`, a builder for programs (text analysis, dependency views); `graphSVG(graph, opts)` |
| `layout.js` | `layoutGraph(graph, opts)`: layered (Sugiyama) layout — cycle breaking, longest-path ranks, dummy nodes, edge labels on dummies, barycenter sweeps with transpositions, isotonic-regression placement; compound groups laid out inside out (own direction, header, padding) so frames never overlap; edges to groups; self loops; directions TB / BT / LR / RL; node sizes from the label or the node's own `w` / `h`; `shapeSize`, `clipToShape` |
| `svg.js` | `renderSVG(layout, opts)`: node shapes (also `compartments` for class / entity boxes, `dot`, `bullseye`, `bar` for state diagrams), B-spline edges, line styles, markers (arrow, open, circle, cross, hollow triangle, diamonds, crow's feet; hollow ones filled with the theme's background), labels on a backing, groups, `classDef` / `style` specs, themes (`light`, `dark`, `neutral`, `forest`), prefixed ids (`nextId`), `opts.className`, `compartmentSize`, `textSVG` |
| `measure.js` | text widths from character classes (Latin, Cyrillic, Georgian, Devanagari, CJK, emoji) so layouts match in Node and browsers; a page can pass a canvas measurer |
| `kit.js` | shared pieces of the kinds that draw their own pictures: source lines without comments / front matter, theme colours with a categorical palette, text, markers, the `<svg>` wrapper, readable ink on a fill |
| `index.js` | the registry of kinds (`registerDiagram`), `detectDiagram`, `renderDiagram(src, opts)` → `{ kind, svg, error }` (never throws: an error picture instead) |
| `all.js` | every kind below registered at once; re-exports `renderDiagram`, `detectDiagram`, `DIAGRAM_KINDS`, `errorSVG`, `registerDiagram` |
| `flowchart.js` | `flowchart` / `graph`: shapes (classic and `@{ shape }`), quoted / Markdown-string labels, entity codes, every link type and length, edge text, chains and `&`, subgraphs with titles / nesting / direction, `classDef`, `class`, `:::`, `style`, `linkStyle`, comments, front matter |
| `sequence.js` | `sequenceDiagram`: participants / actors with aliases, implicit participants, `box` groups, every arrow (`->` `-->` `->>` `-->>` `-x` `--x` `-)` `--)` `<<->>` `<<-->>`), activations (`+` / `-`, `activate` / `deactivate`), notes (left of / right of / over A,B), nested `loop` / `alt` / `else` / `opt` / `par` / `and` / `critical` / `option` / `break` / `rect`, `autonumber`, title, `<br>` |
| `class.js` | `classDiagram`: member blocks and member lines, generics `~T~`, labels, annotations, relations `<\|--` `*--` `o--` `-->` `--` `..>` `..\|>` `..` both ways with cardinalities and labels (parents placed above), namespaces, notes, `classDef` / `style` / `cssClass` / `:::`, direction |
| `state.js` | `stateDiagram` / `stateDiagram-v2`: states, descriptions, `[*]` per composite, transitions with labels, composite states (nested, own direction), `<<choice>>`, `<<fork>>` / `<<join>>`, notes (one line and `end note` blocks), `--` (accepted), `classDef` / `class` / `:::`, direction |
| `er.js` | `erDiagram`: entities with attribute tables (type, name, PK / FK / UK, comment), labels `p["Person"]`, all crow's-foot ends, identifying `--` and non-identifying `..` relations, direction |
| `pie.js` | `pie`: `showData`, title, slices in order with percentages, legend |
| `gantt.js` | `gantt`: title, `dateFormat`, `axisFormat`, `excludes` (weekends, weekdays, dates), `inclusiveEndDates`, sections, tasks with `done` / `active` / `crit` / `milestone`, ids, `after a b`, `until x`, durations, forward references; `opts.today` draws the today line (UTC dates) |
| `gitgraph.js` | `gitGraph` (LR / TB / BT): `commit` (`id`, `msg`, `tag`, `type`), `branch` (`order`), `checkout` / `switch`, `merge` (`id`, `tag`, `type`), `cherry-pick`; Mermaid's errors for unknown branches and self merges |
| `mindmap.js` | `mindmap`: indentation tree, shapes `[ ]` `( )` `(( ))` `)) ((` `) (` `{{ }}`, Markdown strings; `::icon()` / `:::class` ignored; a two-sided balanced tree, one colour per branch |
| `timeline.js` | `timeline`: title, sections, `period : event : event`, `: event` continuations |
| `journey.js` | `journey`: title, sections, `task: score: actors`, faces at the score, actor dots |
| `quadrant.js` | `quadrantChart`: title, axes, `quadrant-1…4`, points with radius / colour |
| `test.js` | unit tests: `node diagram/test.js` (also `node check.js tests diagram`) |

Every `render(src, opts)` takes `theme`, `fontSize`, `fontFamily`, `idPrefix` and returns SVG text with `width`,
`height`, `viewBox` and the classes `dg dg-<kind>`. Unrecoverable input throws `line N: …`, which `renderDiagram`
turns into an error picture; unknown lines are tolerated where Mermaid tolerates them.

## Limits

- Crossing counts are exact but quadratic per rank pair; graphs of a few hundred nodes stay interactive.
- Text widths are estimates unless a measurer is passed; labels may be a few pixels wider or narrower than drawn.
- Sequence diagrams: `create` / `destroy` are accepted but participants are not created or destroyed mid-diagram;
  `links`, `properties` and `critical` options beyond the label are not drawn.
- Class diagrams: lollipop interfaces (`()--`), `click` / `link` callbacks and per-member styling (static underline,
  abstract italics) are not drawn; notes are placed by the layout, not pinned beside their class.
- State diagrams: concurrent regions (`--`) are not drawn apart; notes are placed by the layout (left / right is a
  hint only).
- ER diagrams: word cardinalities (`one or more`, …) are not read.
- Gantt: months and years count as 30 / 365 days in durations; `tickInterval`, `weekday`, `topAxis`, `click` and
  `todayMarker` styling are accepted and ignored; the today line appears only when `opts.today` is given.
- Git graph: commit ids without `id:` get stable generated ids (not shown), parallel commits are not drawn.
- Mind maps: icons and classes are ignored; the layout is two-sided, not radial.
- Not implemented: block, sankey, xychart, requirement, C4, architecture, packet, kanban, radar diagrams.
