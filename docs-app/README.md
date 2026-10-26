# Docs

An offline document editor that exports **one self-contained HTML page** and speaks Markdown: write articles,
reports, meeting notes, technical notes and letters with headings, rich text, tables, callouts, code with syntax
highlighting, an automatic table of contents, checklists, images and attached files; print them as paged documents
or publish the single file anywhere.

The editor is a single file: [html@5_offline_singlefile/index.html](html@5_offline_singlefile/index.html). It makes no network
requests at all (standalone class: the build fails on any network API).

## Markdown in and out

- **Open** a `.md` file (or drop it on the window): headings, paragraphs, lists, tables with alignment, code fences
  with their language, quotes, GitHub alerts (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` →
  callouts), task lists (→ checklist), `[TOC]` / `[[_TOC_]]` (→ table of contents), horizontal rules, front-matter
  title, images embedded as `data:` URIs. The document language is guessed from the text.
- **Open a `.zip`** of Markdown with its files (the editor's own export, or any zipped folder): relative image and file
  links become image and attachment blocks.
- **Export** Markdown (`.md`, images embedded), Markdown with files (`.zip`: the `.md` plus `files/…`), or plain text
  (`.txt`). The table of contents becomes a linked list with GitHub heading slugs, callouts become alerts.

## Blocks

Heading, text, checklist, code (language, line numbers, wrapping; highlighting for JavaScript / TypeScript, Python,
shell, JSON, HTML / XML, CSS, SQL, C / C++, Java / C# / Kotlin, Go, Rust, YAML / TOML, Markdown), table, callout,
table of contents (headings after it, levels, numbering), section, columns, divider, spacer, page break, image,
attachment, QR code.

Themes: **article** (serif reading), **report** (structured, accent rules), **technical** (monospace accents) plus
the paper themes (classic, modern, minimal, creative, elegant, mono). Pages: A4 / Letter / Legal, margins, page
numbers, running header and footer.

## Templates

Article, project report (numbered contents, figures table, PDF attachment, page numbers), meeting notes, technical
note (highlighted shell / JSON / JavaScript), letter, blank. Templates are written in Markdown (`templates.js`) — one
text per language with the same structure — and imported with the same converter as user files.

## Files

| file | contents |
| --- | --- |
| `viewer.js` | registers the docs product on the paper kit (`definePaperProduct`, prefix `dc`) |
| `viewer-base.js` | version, UI languages, the docs themes |
| `viewer-blocks.js` | code, table of contents, checklist |
| `viewer-css.js`, `viewer-dict.js` | their CSS (syntax colours mixed from the theme text colour, so they read in light and dark) and exported-page strings |
| `markdown-doc.js` | Markdown / ZIP ↔ document, plain text export (no DOM: works in Node) |
| `editor.js`, `editor-config.js` | editor start-up; importers and exporters |
| `i18n-<lang>.js` | editor strings (en, ru, uk, de, fr, es, ka) |
| `templates.js` | template gallery |
| `index.html`, `server.js` | editor page (sources) and development server |

Shared libraries: `paper/`, `doc/`, `studio/`, `markdown/` (parser and writer), `highlight/`, `zip/`, `codec/`.

## Development

```bash
node server.js
```

then open `/docs-app/`. `node check.js golden docs-app <dir>` exports every template
deterministically; `node check.js e2e docs-app/html@5_offline_singlefile/index.html check-editor.js` runs the editor
scenario.
