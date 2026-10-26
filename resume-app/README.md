# Resume Builder

A visual editor for resumes that exports **one self-contained HTML page**: Word-like blocks (formatted text, tables
with merged cells, lists, callouts), attachments of any type (PDF, images, other files) with Download / Print / Open
buttons, in-page links to attachments and sections, multilingual content with automatic language detection for the
visitor, and a print button that never prints itself.

No dependencies, no CDN, no web fonts. Everything stays in the user's browser (IndexedDB) and in downloaded files.

The editor itself is a single file too: [html@5-singlefile/index.html](html@5-singlefile/index.html)
opens from disk or any static host.

## How it is built

The resume is a *paper document* product on the shared document engine:

| part | role |
| --- | --- |
| `doc/` | document model, normalization, rendering, CSS / runtime tree shaking, HTML export (clean / packed / source) |
| `paper/` | paper documents: generic blocks (heading, text, table, section, columns, callout, divider, spacer, page break, image, attachment, QR), themes, layouts, page and print CSS, runtime features, the paper editor configuration |
| `studio/` | the visual editor (canvas, palette, outline, inspector, settings, files, languages, projects, export) |
| this folder | the resume blocks and strings |

| file | contents |
| --- | --- |
| `viewer.js` | registers the resume product (`definePaperProduct`) and re-exports the API used by the editor and templates |
| `viewer-base.js` | version, UI languages, contact kinds, language levels |
| `viewer-blocks.js` | profile, contacts, timeline, skills, languages, key–value list |
| `viewer-css.js`, `viewer-dict.js` | CSS of those blocks; exported-page strings |
| `editor.js`, `editor-config.js` | editor start-up and configuration (file extension, palette categories, block icons) |
| `i18n-<lang>.js` | editor strings of the resume blocks (en, ru, uk, de, fr, es, ka) |
| `templates.js` | template gallery (developer, classic, creative, academic, minimal, blank) |
| `index.html`, `server.js` | editor page (sources) and development server |

## Using the editor

1. On first start the template gallery opens: Developer, Classic, Creative, Academic, Minimal and a blank resume
   (people and organisations in the templates are fictional). Later it is in More → Templates and New → From template.
2. Text is edited directly on the page. The formatting bar works like a word processor: paragraph style (normal,
   headings, quote, code), size, bold / italic / underline / strike, superscript / subscript, code, text and highlight
   colour, alignment, bulleted and numbered lists, indents, links (Ctrl+K: address, e-mail, phone, attachment,
   document section), clear formatting, special characters. Pasting from Word / Google Docs / LibreOffice keeps the
   formatting and drops the clutter.
3. Tables: select cells with the mouse or Shift+click, merge and split, insert and delete rows and columns, header
   cells, cell background and alignment, table styles, column widths by dragging, Tab / Shift+Tab between cells,
   context menu.
4. Left: the block palette (profile, contacts, timeline, skills, languages, key–value, heading, text, table, callout,
   section, columns, divider, spacer, page break, image, attachment, QR code), the document outline (drag, hide) and
   files. Blocks are dragged from the palette and within the page, into sections, columns and the sidebar.
5. Right: properties of the selected block (list items, dates with "present", icons, attachments, visibility per
   language, print / screen, page break, spacing and colours) and document settings: theme (presets, colours, fonts
   including uploaded ones, size, line height, density, heading style, radius, light / dark / auto scheme), layout
   (single column, sidebar left / right, two columns), page (A4 / Letter / Legal, margins, page numbers, running
   header / footer), languages, output (language switcher, print and theme buttons, appendix of attachments, printing
   of attachments, paper look) and metadata.
6. Language tabs above the page: add any language (BCP 47 code), translation progress, default language, fill empty
   texts from another language. An untranslated field is underlined and shows the text the visitor will see instead.
7. Preview shows the final page (desktop, phone or sheet width); Export HTML saves it.

The editor UI is available in English, Русский, Українська, Deutsch, Français, Español and ქართული (chosen from
`navigator.languages`, switchable in the top bar, remembered).

Shortcuts: Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) undo / redo, Ctrl+S save the project file (Ctrl+Shift+S save as),
Ctrl+C / X / V copy / cut / paste a block, Ctrl+D duplicate, Alt+↑/↓ move, Del delete, Enter edit, Esc deselect,
Ctrl+B / I / U / K formatting and link.

## Where the data lives (no server)

- Projects are saved automatically in the browser's IndexedDB (`rv-editor`); Projects lists them (open, rename,
  duplicate, delete, new from template). Attachment files are stored there too, separately from the document.
- Save downloads the project as `<name>.resume.json` (Chrome / Edge: with a file picker and saving back to the same
  file). Open accepts such a JSON file or an exported HTML page with embedded source; files can be dropped on the
  window.
- Nothing leaves the computer and nothing is synchronised between browsers or devices: use the project file to move
  or back up a project. Private windows and clearing site data remove the projects stored in the browser. When the
  browser storage is full the editor warns and offers to save the project to a file.
- A project open in several tabs is writable in one of them; the others are read-only.

## The exported page

- **Clean**: readable HTML that works without JavaScript too (then in the default language).
- **Packed**: the content is compressed (deflate-raw + base64) and unpacked on opening (needs JavaScript); much
  smaller, and the markup is not directly readable — light obfuscation, not encryption.
- **Minify** CSS and script (on by default).
- **Embed editable source**: the compressed project goes into the page, so the HTML can be reopened in the editor.
  Hidden blocks can be left out; languages that are not exported are not included.
- Export a subset of the languages and choose the default one. The dialog reports the size by part (styles, script,
  attachments, source) and what went into the page.

**Tree shaking.** The page contains only the CSS of the blocks, theme and layout it uses, only the runtime features it
needs, only the icons it shows and only the UI strings of the exported languages:

| feature | included when | does |
| --- | --- | --- |
| `i18n` | more than one language | language detection and switching, title, description, print header / footer |
| `print` | print button enabled | the Print button |
| `attach` | attachment buttons or embedded previews | lazy previews, download / print / open, image viewer |
| `links` | `#att-…` / `#b-…` links | smooth scrolling and target highlight |
| `theme` | theme button enabled | light / dark switch on screen |

When no feature is needed the page contains no executable `<script>` at all.

**Languages.** `?lang=xx` or `#lang=xx` in the address → the visitor's saved choice → `navigator.languages` in order of
preference (exact match, then the primary subtag: `pt-BR` → `pt`) → the default language. The switcher shows buttons
or a list with native names or codes; the toolbar never prints. Right-to-left languages get `dir="rtl"`.

**Attachments.** Images are embedded as `data:` URIs (visible and printable without JavaScript, zoomable). PDF, text,
audio and video are previewed with `<object>`; HTML / SVG / XML only in an isolated `<iframe sandbox>`; other types
as a card. Each file is stored once. Download / Print / Open buttons can be turned off; HTML / SVG / XML are
downloaded instead of opened. The appendix lists the attachments; `#att-…` links lead to an attachment, `#b-…` to a
section. In print, attachments appear as cards, are hidden or printed as images.

**Print and pages.** A4 / Letter / Legal, margins, page numbers ("n", "n/N", "Page n of N"), running header and footer
per language, exact colours, page breaks and keep-together, a paper look on screen and page guides in the editor.

## Browser support

Chrome / Edge ≥ 120, Firefox ≥ 121, Safari ≥ 17 (editor and exported page). The editor is designed for screens from
1024 px (on tablets the side panels slide over the page); exported resumes are responsive and collapse to one column
on phones.

## Limitations

- Projects live in one browser; move them with the `.resume.json` file.
- Attachments over 100 MB are refused, project files over 300 MB are not opened; files over 8 MB trigger a warning
  (base64 adds ~33 % to the page).
- Embedded PDF previews depend on the browser: mobile Safari and Chrome often show a card or the first page instead;
  Open and Download always work. Embedded PDFs are not shown in the editor's Preview (isolated frame): open the
  exported page.
- A packed page without JavaScript shows only its `<noscript>` message; a clean page without JavaScript shows the
  default language.
- Packed obfuscation does not protect data: anyone with the file can unpack it.
- Timeline, Skills, Languages, Key–value and Table have no Spacing and colours panel: their `style` property is the
  variant name.
- Without Intl data for a language (Georgian in some stripped Chromium builds) month names come from built-in tables.

## Development

```bash
node server.js
```

serves the repository and opens this editor from its sources (they import `../` libraries). `viewer.js` also loads
in Node (rendering and export do not touch the DOM), which is handy for tests and batch exports:

```js
import * as V from './viewer.js';
const { html } = await V.exportHTML(V.newDoc(), { mode: 'clean' });
```

`node check.js golden resume-app <dir>` writes deterministic exports of every template (compare two runs to
prove a refactoring changed nothing); `node check.js e2e resume-app/html@5-singlefile/index.html
check-editor.js` runs the editor scenario. In the editor console, `window.__ed` gives debug access to the state.
