# Single-file offline build

`html@5_offline_singlefile/` holds the QR code generator and scanner as self-contained HTML (`index.html` (create) and
`scan.html` (scan), linked to each other): scripts, styles and icons are inlined and nothing is fetched — the build
fails on any network API or remote resource. Open a file from disk (`file://`), put it on a USB stick, send it by
e-mail or host it anywhere. Codes are generated and scanned in the page (images or the camera); the scan history stays
in the browser’s local storage.
