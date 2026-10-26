# Single-file offline build

`html@5_offline_singlefile/` holds the shelf price-tag designer as self-contained HTML (`index.html` (products and
promotions) and `design.html` (tag designer and A4 printing), linked to each other): scripts, styles and icons are
inlined and nothing is fetched — the build fails on any network API or remote resource. Open a file from disk
(`file://`), put it on a USB stick, send it by e-mail or host it anywhere. Products, promotions, the design and the
last printed set stay in the browser's local storage.
