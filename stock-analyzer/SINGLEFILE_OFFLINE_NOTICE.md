# Single-file offline build

`html@5_offline_singlefile/` holds the stock analyzer as self-contained HTML (`index.html` (ABC / XYZ analysis),
`plan.html` (reorder planner) and `expiry.html` (expiry, FEFO), linked to each other): scripts, styles and icons are
inlined and nothing is fetched — the build fails on any network API or remote resource. Open a file from disk
(`file://`), put it on a USB stick, send it by e-mail or host it anywhere. Files are read in the page, exports are
downloads; the data, suppliers and settings stay in the browser's local storage.
