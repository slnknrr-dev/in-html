# Single-file offline build

`html@5_offline_singlefile/` holds the access model designer as self-contained HTML (`index.html` (roles),
`policies.html`, `modules.html`, `sessions.html` and `config.html`, linked to each other): scripts, styles and icons
are inlined and nothing is fetched — the build fails on any network API or remote resource. Open a file from disk
(`file://`), put it on a USB stick, send it by e-mail or host it anywhere. The project stays in the browser's local
storage and leaves only as JSON, CSV or a printed document.
