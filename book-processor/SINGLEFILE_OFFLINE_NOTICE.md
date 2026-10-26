# SINGLEFILE + OFFLINE

Build target marker: `node singlefile.js book-processor` writes one self-contained page to
`html@5_offline_singlefile/index.html` (every module, stylesheet and icon inlined).

Save the file anywhere and open it in a browser: it reads and writes FB2 / EPUB without any network access and keeps
its library in the browser's IndexedDB for that file's origin.
