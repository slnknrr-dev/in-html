# Single-file offline build

`html@5_offline_singlefile/` holds the route planner as self-contained HTML (`index.html` and `sheet.html`, linked to
each other): scripts, styles and icons are inlined and nothing is fetched — the build fails on any network API or
remote resource. Open a file from disk (`file://`). Stops and settings stay in the browser's local storage.
