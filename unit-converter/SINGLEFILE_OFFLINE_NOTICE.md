# Single-file offline build

`html@5_offline_singlefile/` holds the unit converter as self-contained HTML (`index.html` (converter and helpers)
and `tables.html` (printable cheat sheets), linked to each other): scripts, styles and icons are inlined and nothing is
fetched — the build fails on any network API or remote resource. Open a file from disk (`file://`), put it on a USB
stick, send it by e-mail or host it anywhere. Settings, favourite pairs, the history and the cheat sheet stay in the
browser's local storage.
