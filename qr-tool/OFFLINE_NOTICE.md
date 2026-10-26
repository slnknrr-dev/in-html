# Offline multi-file build

`html@5_offline/` is the QR code generator and scanner as a small static site: `index.html` (create) and `scan.html`
(scan), linked to each other, the application modules and only the library modules they use (each tree-shaken and
minified), with no network code at all — the build fails if any appears. Serve the folder from any static host or open
it through a local server; browsers can cache the files separately. Codes are generated and scanned in the page
(images or the camera); the scan history stays in the browser’s local storage.
