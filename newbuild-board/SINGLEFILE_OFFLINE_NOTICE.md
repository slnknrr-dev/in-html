# Single-file offline build

`html@5_offline_singlefile/` holds the sales board of a new-build complex as self-contained HTML (`index.html` (the
unit board), `import.html` (unit tables), `mortgage.html` (loan schedules) and `complex.html` (complex, price lists),
linked to each other): scripts, styles and icons are inlined and nothing is fetched — the build fails on any network
API or remote resource. Open a file from disk (`file://`), put it on a USB stick, send it by e-mail or host it
anywhere. The project stays in the browser's local storage; backups and exports leave as downloads.
