# Single-file offline build

`html@5_offline_singlefile/` holds the barcode generator, batch maker and scanner as self-contained HTML
(`index.html` (create), `batch.html` (many codes, label sheets) and `scan.html` (scan), linked to each other): scripts,
styles and icons are inlined and nothing is fetched — the build fails on any network API or remote resource. Open a
file from disk (`file://`), put it on a USB stick, send it by e-mail or host it anywhere. Codes are generated,
exported and scanned in the page; settings and the scan history stay in the browser's local storage.
