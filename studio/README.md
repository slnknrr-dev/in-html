# studio

**Document editor.** The visual editor of the document products: canvas (paper pages or device widths), block palette, outline, files, schema-driven inspector, document settings, content languages, projects in IndexedDB (one writer per project across tabs), templates, export dialog and preview, import / export of other formats. A product configures it once with `defineEditor(spec)` — every hook is documented in `config.js` — and calls `startEditor()`. Page CSS: `../ui/base.css`, `../richtext/richtext.css`, `editor.css`.

| module | contents |
| --- | --- |
| `anchors.js` | the anchor field of the block inspector (products with P.anchors): a slug validated as you type, applied when the field is left; links to the old target are rewritten so menus and buttons keep working. |
| `attach.js` | attachments in the editor: binary data and blob URLs, upload, replace, delete, references (usage counts, remapping), download / open / print. |
| `boot.js` | editor start-up: UI language, preferences, rich text, global bindings, last project (or a new one). The application registers its product (doc/product.js) and editor configuration (studio/config.js) first. |
| `canvas.js` | the editing canvas: edit-mode rendering (whole document / one block), stylesheet, kept embedded previews and media players, blob URL hydration, focus restore, zoom and the stage size (ED.stage). |
| `config.js` | what the active product contributes to the editor (set once by the application before boot). The engine side of the product (blocks, themes, dictionaries of exported pages) is in doc/product.js. |
| `db.js` | project storage: IndexedDB (documents, attachment files), autosave, one writer per project across tabs (locks, BroadcastChannel), read-only banner, storage quota checks. |
| `dnd.js` | drag and drop on the canvas: palette blocks, moving blocks, dropped files (attachments, or a project / importable file to open). |
| `doc.js` | document helpers of the editor: block registry lookups, tree walking and list paths, field access, block / item labels, link targets and anchors, rich-text paths, translation traversal and completeness. |
| `events.js` | canvas events (selection, links, attachment buttons, double-click file picking, the block context menu by right click, long press, Menu key or Shift+F10 through ui/contextmenu.js, stage resize) and the editor keyboard shortcuts. |
| `export.js` | the export dialog: options (clean / packed, minify, source, languages), size and tree-shaking report, download and preview; the product's packages (`ED.exportModes`, e.g. archives) and its check before a download (`ED.exportCheck`). |
| `fields.js` | schema-driven field controls of the inspector and the settings panels: select, number, range, checkbox, color, text, i18n, rich preview, file, icon, date / day / time, languages, plus product field types. |
| `fileio.js` | open (project JSON, exported HTML with embedded source, product importers such as Markdown), save project files, and the product's extra export formats (ED.exporters). |
| `gallery.js` | the template gallery (live thumbnails of the product's templates). |
| `global.js` | global keyboard shortcuts and window events of the editor. |
| `history.js` | document changes: commit (snapshot history with coalescing), undo / redo. |
| `i18n-<lang>.js` | editor UI strings shared by every product (de, en, es, fr, ka, ru, uk). |
| `i18n.js` | the shared editor dictionaries (7 UI languages) and switching the editor's UI language (relabels and re-renders the whole editor). Products add their own keys with addDicts (ui/i18n.js). |
| `inspector.js` | the block inspector: schema fields, items manager, columns and table tools, the product's common props (visibility, print / device…), anchor and block style. |
| `langs.js` | content languages: tabs above the canvas with translation progress, the language manager. |
| `left.js` | left panel: block palette, document outline (tree with keyboard model and drag & drop) and the Files panel. |
| `ops.js` | block operations: insert (with region routing), delete, duplicate, move, copy / paste, the insert and block context menus (`blockMenuItems` for other menus). |
| `preview.js` | the preview overlay: the clean export in a sandboxed frame at the stage's preview widths. |
| `projects.js` | projects: new / open / start, the Projects dialog, initial content language. |
| `right.js` | right panel: block inspector and document settings. The settings tabs come from the product (ED.docTabs = [[key, labelKey, render(body)], ...]) … |
| `select.js` | block selection and hover, the floating block chrome. |
| `shell.js` | the editor shell: top bar, panels and drawers, status bar, full re-render. |
| `stage.js` | canvas stage modes chosen by the product (ED.stage): a paper page (print documents: page size from document settings, pa … |
| `state.js` | editor state (S), the canvas / stage elements, size caps and product-scoped storage keys. |
| `editor.css` | the document editor layout: top bar, side panels and drawers, tabs, stage and canvas chrome, status bar, inspector, palette, outline, files, document settings, languages, projects, templates, export and preview. Needs ui/base.css and richtext/richtext.css. |

The header comment of each module documents its API.
