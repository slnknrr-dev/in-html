# Single-file offline build

`html@5_offline_singlefile/` holds the catalogue schema and title-rule designer as self-contained HTML (`index.html`
(schema) and `rules.html` (rules and tracer), linked to each other): scripts, styles and icons are inlined and nothing
is fetched — the build fails on any network API or remote resource. Open a file from disk (`file://`), put it on a USB
stick or host it anywhere. The project stays in the browser's local storage; JSON and CSV come in by file pick and
leave as downloads.
