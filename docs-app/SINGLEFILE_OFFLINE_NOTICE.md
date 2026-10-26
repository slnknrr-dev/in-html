# Single-file offline build

`html@5_offline_singlefile/` holds the document editor as self-contained HTML (`index.html`): scripts, styles and
icons are inlined and nothing is fetched — the build fails on any network API or remote resource. Open the file from
disk (`file://`), put it on a USB stick, send it by e-mail or host it anywhere. Projects stay in the browser’s
IndexedDB; documents, Markdown / ZIP files and exported pages leave as downloads.
