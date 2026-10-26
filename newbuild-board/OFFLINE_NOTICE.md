# Offline multi-file build

`html@5_offline/` is the sales board of a new-build complex as a small static site: `index.html` (the unit board),
`import.html` (unit tables from CSV / XLSX), `mortgage.html` (loan schedules and affordability) and `complex.html`
(complex, buildings, price lists, backups), linked to each other, the application modules and only the library modules
they use (each tree-shaken and minified), with no network code at all — the build fails if any appears. Serve the
folder from any static host or open it through a local server. The project (complex, buildings, units and their
history) stays in the browser's local storage; files come in by drop or paste and leave as downloads.
