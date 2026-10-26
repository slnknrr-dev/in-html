# Single-file offline build

`html@5_offline_singlefile/` holds the e-mail composer, inspector and tools as self-contained HTML (`index.html`
(compose), `inspect.html` (read an .eml) and `tools.html` (header and SMTP tools), linked to each other): scripts,
styles and icons are inlined and nothing is fetched — the build fails on any network API or remote resource, and no
socket is ever opened. Open a file from disk (`file://`), put it on a USB stick or host it anywhere. Messages leave the
page only as downloads or a `mailto:` link; inspected HTML bodies are shown in a sandboxed frame that loads nothing.
The draft stays in the browser's local storage and IndexedDB.
