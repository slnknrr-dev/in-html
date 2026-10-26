# Single-file offline build

`html@5_offline_singlefile/` holds Icon Creator as self-contained HTML (`index.html`): scripts, styles and icons are
inlined and nothing is fetched — the build fails on any network API or remote resource. Open a file from disk
(`file://`), put it on a USB stick, send it by e-mail or host it anywhere. Pictures are opened from the device; the
icon stays in the page and the browser’s local storage; `.ico`, `.png` and project files leave as downloads.
