# OFFLINE

Build target marker: `node singlefile.js book-processor` writes the multi-file offline copy to
`html@5_offline/` (pages, application modules and the used libraries, tree-shaken and minified).

The application makes no network requests at all: books, drafts, bookmarks and highlights live in the browser's
IndexedDB, files are opened from the device and downloads are generated in the page. It works from `file://`.
