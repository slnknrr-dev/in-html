# Offline multi-file build

`html@5_offline/` is the barcode generator, batch maker and scanner as a small static site: `index.html` (create),
`batch.html` (many codes, label sheets) and `scan.html` (scan), linked to each other, the application modules and only
the library modules they use (each tree-shaken and minified), with no network code at all — the build fails if any
appears. Serve the folder from any static host or open it through a local server. Codes are generated, exported and
scanned in the page (images, the camera or a keyboard-wedge scanner); settings and the scan history stay in the
browser's local storage.
