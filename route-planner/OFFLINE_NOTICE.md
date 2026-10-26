# Offline multi-file build

`html@5_offline/` is the route planner as a small static site: `index.html` (stops, plan, map, exports) and
`sheet.html` (printable trip sheet), the application modules and only the library modules they use, with no network
code at all — the build fails if any appears. Stops and settings stay in the browser's local storage.
