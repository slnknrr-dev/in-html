# README Editor (`readme-editor`)

A visual editor for `README.md` files: the Markdown source and the README as GitHub or Codeberg show it, side by side,
with the rendered README editable in place. Everything is computed in the page by the libraries of this repository —
[`markdown/`](../markdown/) (GitHub-flavoured Markdown with source ranges, write-back), [`math/`](../math/) (TeX to
MathML), [`diagram/`](../diagram/) (Mermaid-style diagrams), [`highlight/`](../highlight/), [`badge/`](../badge/)
(shields.io model and local badge pictures), [`html/`](../html/) (the sanitizer) and [`ui/`](../ui/). No third-party code.

## Artifacts

Built from the NOTICE files (`node singlefile.js readme-editor`):

| artifact | what it is |
| --- | --- |
| `html@5_offline_singlefile/index.html` | the editor in one file with no network code; remote images of the README load only on request |
| `html@5_serverless/` | the same editor as a static site; the README's remote images are shown by default |

Development: `node readme-editor/server.js [port]`.

## The page

- **Views**: split (source | preview, resizable), visual, source; GitHub or Codeberg rendering; an outline panel.
- **Markdown as GitHub renders it**: CommonMark with raw HTML (sanitized like GitHub: `details`, `picture`, `kbd`,
  `sub` / `sup`, `align`, image sizes …), tables with alignment, task lists, strikethrough, autolinks, footnotes,
  heading anchors like GitHub, alerts (`> [!NOTE]` …), math (`$…$`, `$$…$$`, `` $`…`$ ``, ```` ```math ````),
  Mermaid diagrams (flowchart, sequence, class, state, ER, Gantt, pie, git graph, mind map, timeline, journey,
  quadrant), emoji shortcodes, highlighted code.
- **Editing in the preview**: click text (paragraphs, headings, lists, quotes, alerts) to edit it in place with a
  formatting bar; it is written back as Markdown, while images, badges, formulas, footnote references and emoji keep
  their exact source. Tables: cells, rows and columns (add, delete, move), alignment, Markdown ⇄ HTML. Task boxes tick.
  Images and badges open their dialogs, formulas and diagrams their source with a live preview. Every block has a bar:
  edit, source, up, down, duplicate, delete, insert below.
- **Insert**: headings, lists, quotes, keys, footnotes, a table of contents from the headings, tables (size grid or
  pasted CSV / TSV), images, badges, a centred header, a badge row, the five alerts, details, code, formulas, every
  diagram kind.
- **Badges**: a shields.io builder (static badges and presets for GitHub, Codeberg / Gitea, npm, PyPI, crates.io,
  Docker Hub, Codecov, Discord, websites, dynamic JSON, own paths; colours, styles, logos, links; the URL editable
  both ways). Static badges are drawn locally in all five styles, so they show without the network.
- **Images**: URL or relative path; a picked, dropped or pasted file embedded as a data: URI, saved into the project
  folder or kept as a path; alt text, title, size, alignment, link, Markdown or HTML.
- **Files**: open, save, save as (File System Access API where available, downloads elsewhere), a project folder
  (read-write, or read-only through a folder input) with its Markdown files and relative images, drop a `.md` file to
  open it, copy the HTML, download an HTML page. Undo / redo, list and quote continuation, autosave in the browser.
- **Hints**: links to missing anchors, images missing from the folder, images without alt text, data: URI images
  (GitHub does not show them), skipped heading levels, formula and diagram errors; a status bar with position, words,
  characters, blocks and reading time.
- **Remote images**: the editor itself never fetches. Static shields.io badges are drawn locally; any other remote
  picture of the README waits behind a placeholder until "Show remote images" (remembered; on by default only in the
  serverless build).

## Files

| file | contents |
| --- | --- |
| `main.js` | the page: layout, toolbars, views, source pane, formatting, insertion, files, keyboard, status |
| `doc.js` | the document: text, undo / redo, autosave, rendering with caches of formulas and diagrams |
| `preview.js` | the rendered README: blocks mapped to the source, image policy, block bar, clicks |
| `edit.js` | editing in place: text with write-back, tables |
| `dialogs.js`, `badge-dialog.js` | link, block source, formula, table, image, help; the badge builder |
| `insert.js` | templates, table of contents, the insert menu, the sample README |
| `files.js` | open / save, the project folder, local images |
| `outline.js` | the outline and the hints |
| `strings*.js` | UI strings in seven languages |

## Checks

```
node check.js tests markdown math diagram highlight badge
node check.js modules readme-editor markdown math diagram highlight badge html
node check.js e2e http://127.0.0.1:8080/readme-editor/ readme-editor/e2e.js [--mobile --size 390x844] [--lang ru]
node check.js e2e readme-editor/html@5_offline_singlefile/index.html readme-editor/e2e.js
```

## Limits

- Rendering follows GitHub closely but not byte for byte (cmark-gfm edge cases, GitHub's own extensions such as
  issue references and `@mentions` are not linked).
- Badge logos (simple-icons) and live badge values come only from shields.io; locally a dynamic badge shows "…".
- Editing in place uses `contenteditable`: Markdown that has no HTML equivalent (reference-style links, `*` vs `_`
  emphasis, line wrapping) is normalized in the edited block only; other blocks keep their text untouched.
- Diagrams and formulas cover what README files commonly use (see the libraries' READMEs).
