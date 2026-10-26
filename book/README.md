# book

A format-neutral book model and its converters. Readers, editors and exporters work on one plain-data model
(`model.js`); FB2 and EPUB exist only at the edges, where files are read and written. String based (no DOM), runs in
Node and in browsers, no dependencies beyond the repository's `zip/`, `xml/`, `codec/` and `png/`.

| file | contents |
| --- | --- |
| `model.js` | the model (`newBook`, `newSection`, `normalizeBook` — never throws), persons, inline helpers (`cleanInline`, `inlineText`, `mapInline`), traversal (`walkSections`, `walkBlocks`, `blockInlines`), `toc`, `readingUnits` (the unit of reader positions, highlights and search), `bookStats`, ids |
| `fb2.js` | FictionBook 2.x read (`readFB2`: description, bodies, notes / comments bodies, binaries, poems, epigraphs, cites, tables, styles, links) and write (`writeFB2`), the FB2 genre list |
| `epub.js` | EPUB 2 / 3 read (`readEpub`: container, OPF metadata incl. refines and calibre series, spine, nav / NCX, footnotes by epub:type / role / class, cover) and write (`writeEpub`: mimetype first and stored, OPF, nav.xhtml + toc.ncx, cover page, title page, one XHTML per top-level section, notes as EPUB 3 pop-up endnotes, CSS with the book's styles) |
| `html.js` | the one HTML form of the model (`renderBlock`, `renderSection`, `renderNote`, `bookToHTML`) used by the reader, the editor, EPUB and the HTML export, and the way back (`parseFlow`, `parseInline`, `blocksFromHTML` for the editor, `htmlToBook` for HTML files) |
| `text.js` | Markdown in / out (`markdownToBook`, `bookToMarkdown`: chapters by headings, footnotes `[^n]`, poems, tables), plain text in / out (`textToBook` with chapter detection, `bookToText`), `guessLang` |
| `markup.js` | tolerant XML / HTML parsing for books found in the wild (HTML entities, unclosed tags), `decodeText` (BOM, XML / HTML declarations, windows-1251 / KOI8-R / UTF-16 detection) |
| `css.js` | the stylesheet of book content (`bookCSS`, relative units, no fonts or colours of its own) and named styles (`stylesCSS`, `readStylesCSS` round-trips them through EPUB CSS) |
| `cover.js` | generated covers as SVG (`coverSVG`: six designs × eight palettes, deterministic) |
| `open.js` | `detectFormat`, `readBook` (EPUB, FB2, FB2.ZIP / zipped books, HTML, Markdown, text, the model as JSON), `writeBook` (epub, epub2, fb2, fb2.zip, markdown, html, text, json), `ACCEPT` |
| `validate.js` | `validateBook` (what a reader or a format will miss: title, language, empty sections, broken links, missing notes / images / styles…), `checkEpub` (archive layout, package, manifest / spine, navigation, well-formed XHTML, links, ids), `checkFB2` (required elements, binaries, links), `checkText` |
| `search.js` | full-text search over reading units (`searchUnits`, case / whole words), `countWords` |
| `sample.js` | an original sample book that uses every construct (parts, epigraph, poem, citation, table, list, code, footnotes, styles, an illustration and a cover drawn pixel by pixel) |
| `test.js` | `node book/test.js` (or `node check.js tests book`): round trips through every format, structural validation of written EPUB 2 / 3 and FB2, encodings, tolerant input, Markdown / HTML / text |

## The model

```text
book = { format: 'in-html-book', version: 1, meta, styles, images, title, front, sections, notes }
meta     title, subtitle, authors / translators / docAuthors [person], lang, srcLang, series [{ name, number }],
         annotation [block], keywords, genres (FB2 codes), subjects, date, year, publisher, city, isbn,
         ids [{ scheme, value }], rights, cover (image id), coverDesign, created, modified, docVersion, program
section  { id, title: [inline lines] | null, blocks: [block], sections: [section] }   (blocks, then subsections)
block    p (with an optional named style) · subtitle · empty · hr (scene break) · code · image · epigraph · cite ·
         poem (title, epigraphs, stanzas of lines, authors, date) · table (cells with header / span / align) · list
inline   strings and { t: em | strong | strike | sub | sup | code | a (href) | note (ref) | style (name) | img | br }
notes    [{ id, kind: 'note' | 'comment', label, blocks }]
images   { id: { type, data: Uint8Array, name } }
```

Everything is structured-clone safe (IndexedDB, workers). `normalizeBook` repairs any input: unknown block types are
dropped, ids are made unique, sizes are capped.

## Round trips

`export(import(x))` keeps the structure for FB2 and EPUB (sections and their nesting, titles, every block type,
inline styles, links, notes and their references, images, the cover, named styles, metadata); Markdown and text keep
what those formats can say. `test.js` compares the signatures of the model before and after each trip and validates
every written EPUB / FB2 with `validate.js`.
