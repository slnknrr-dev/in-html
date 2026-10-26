# book-processor

**Books** — an offline reader and writer for FB2 and EPUB in one HTML file (standalone class: zero network, works from
`file://`). Books, drafts, bookmarks and highlights live in the browser's IndexedDB; files are opened from the device
and leave it only as downloads. Everything works on the format-neutral model of the [`book/`](../book/) library:
FB2 and EPUB are read when a file is opened and written only on export.

## Library

- Add books by the picker, drag and drop anywhere on the page or paste: EPUB 2 / 3, FB2 (any encoding — UTF-8,
  windows-1251, KOI8-R, UTF-16), FB2.ZIP / zipped books, Markdown, HTML, plain text and the model's JSON. Duplicates
  are recognised.
- Shelf as covers or a list (search by title, author, series; sort by recently read / added, title, author,
  progress), covers rendered as thumbnails or generated from the title when a book has none, progress, "continue
  reading", details (metadata, annotation, size, reading time), download as EPUB 3 / EPUB 2 / FB2 / FB2.ZIP /
  Markdown / HTML / text / JSON or the original file, mark as finished, remove; storage use and a "keep storage"
  (persistent storage) request.
- Context menu on a book: right click, a long press (touch / pen), the Menu key or Shift+F10.

## Reader

- Paged (CSS columns; one page, two pages side by side on wide screens, or automatic) and scrolling layouts; the book
  is cut into parts at chapters so large books stay fast.
- Themes light, sepia, sage, dark, night; style presets; font, size, line spacing, margins, line length,
  justification, hyphenation, paragraph spacing, page-turn animation. Settings are remembered.
- Contents panel with the current chapter, footnotes as pop-ups (and all notes at the end), internal links with a
  "back" chip, full-text search with match case / whole words and jumps that flash the hit, a position scrubber with
  chapter names, page numbers, percentage and time left in the chapter.
- Bookmarks and highlights in four colours with notes; a list of them with jumps, edit and delete, export as Markdown.
- Positions are reading units plus a character offset (`book/model.js` `readingUnits`), so the place survives font,
  size, layout and window changes; it is saved as you read and restored on open.
- Input: ← → / PageUp PageDown / Space, tap zones and swipes, the mouse wheel, Home / End, T contents, S or / or
  Ctrl+F search, B bookmark, A settings, F full screen, Esc bars.
- Context menu on the text (right click, long press, Menu key): bookmark here, highlight or annotate the paragraph,
  copy it, search for the word, open a footnote, follow a link, edit a highlight — or, with a selection, highlight /
  note / copy / search it. A long press replaces the system's selection gesture; **Select text** in the menu hands
  selection back to the system (the word under the finger is selected, the handles extend it, the selection bar
  offers highlights) until the selection is dismissed. With a mouse, dragging still selects text as usual. The
  contents panel has its own menu: read from here, bookmark the chapter start, edit the chapter in the writer, copy
  the title.

## Writer

- Drafts are saved in IndexedDB as you type. New book from a dialog (title, author, language, and a start: blank,
  novel with parts and chapters, short stories, poetry), from the sample, from any readable file, or "edit in the
  writer" from the library (the same draft is continued later).
- Chapter tree: add, rename, nest and un-nest, move up / down, drag and drop (before / after / inside), duplicate,
  split at the cursor, merge with the next, delete with undo; keyboard (↑ ↓ Home End, Enter, F2, Insert, Delete,
  Alt+arrows to move and nest) and the same menu on right click / long press.
- WYSIWYG chapter editor on a page that uses the book's own stylesheet: paragraph, subheading, epigraph, quotation,
  poem (Enter on an empty verse starts a new stanza, twice leaves the poem), code; bold, italic, strikethrough, code,
  sub / superscript, named paragraph and character styles, clear formatting; links (web, e-mail or a place in the
  book), footnotes and comments, images (pick, drop or paste), tables (rows, columns, header), scene breaks; undo /
  redo, clean paste. Read back with the same HTML parser that imports EPUB chapters, so what you see is what the
  formats get. Context menu on images (alt text, caption, use as the cover, remove), tables, footnote marks and
  links; plain text keeps the browser's menu (spelling suggestions).
- Title page (a body title, epigraphs or a picture before the first chapter), book details (title, subtitle, authors,
  translators, language, series, annotation, FB2 genres, subjects, keywords, publisher, city, year, ISBN, date,
  source language, rights, identifier), cover (upload, or generate from the title and author in 6 designs × 8 colour
  sets, rasterized to JPEG), images (sizes, unused ones, set as cover), footnotes (where each is referenced), named
  styles with a live preview.
- Check: the book's own issues (with "show" jumps) and a test of every file it would write — EPUB 3, EPUB 2 and FB2 are
  written in memory and validated (archive layout, package, navigation, well-formed XML, links).
- Preview in the reader, export (EPUB 3, EPUB 2, FB2, FB2.ZIP, Markdown, HTML, text, JSON), save to the library.

## Files

| file | contents |
| --- | --- |
| `index.html` | the page |
| `main.js` | shell (ui/app.js), view switcher, hash routing (`#library`, `#read/<id>`, `#write/<draft id>`), files dropped anywhere, the test hook `window.__bk` |
| `state.js` | shared state, icons, small helpers (`tLang`: a UI string in the book's language) |
| `db.js` | IndexedDB stores (shelf, content, marks, drafts), in-memory fallback |
| `io.js` | import into the library, exports, thumbnails, generated covers, image URLs |
| `library.js` | the shelf |
| `reader.js`, `reader-panels.js` | the reader; its panels, selection bar and popovers |
| `writer.js`, `writer-dialogs.js` | the writer workspace; link, footnote, table, styles and new-book dialogs |
| `editor.js` | the chapter editor |
| `lib.js` | the `book/` functions the page exposes for end-to-end checks |
| `e2e-reader.js`, `e2e-writer.js` | end-to-end scenarios (`node check.js e2e …`) |
| `strings.js`, `strings-<lang>.js` | UI strings in English, Russian, Ukrainian, German, French, Spanish and Georgian (same keys), also the headings written into exported books and the FB2 genre names |
| `app.css`, `reader.css`, `writer.css` | styles |
| `OFFLINE_NOTICE.md`, `SINGLEFILE_OFFLINE_NOTICE.md` | build targets: `html@5_offline/` and `html@5_offline_singlefile/index.html` |

## Build and check

```bash
node singlefile.js book-processor      # html@5_offline_singlefile/index.html and html@5_offline/
node check.js tests book                       # the library's round trips and validators
node server.js                                 # sources at http://localhost:…/book-processor/
```

End-to-end scenarios drive the built page through `window.__bk` (`lib`, `rd`, `wr`, `panels`) — formats, import,
the reader (pages, contents, search, notes, highlights, bookmarks, context menus, layouts, position memory) and the
writer (typing, formatting, footnotes, chapter operations, details, cover, styles, check, exports re-read and
validated, library, preview, autosave):

```bash
node check.js e2e book-processor/html@5_offline_singlefile/index.html book-processor/e2e-reader.js
node check.js e2e book-processor/html@5_offline_singlefile/index.html book-processor/e2e-writer.js
```
