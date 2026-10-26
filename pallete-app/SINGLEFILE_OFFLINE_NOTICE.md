# Single-file offline build

`html@5_offline_singlefile/` holds Palette Studio as self-contained HTML (`index.html`): scripts, styles and icons are
inlined and nothing is fetched — the build fails on any network API or remote resource. Open a file from disk
(`file://`), put it on a USB stick, send it by e-mail or host it anywhere. Colours, palettes and pictures stay in the
page and the browser’s local storage; swatch files leave as downloads.
