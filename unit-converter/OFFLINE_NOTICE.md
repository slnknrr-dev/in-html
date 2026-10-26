# Offline multi-file build

`html@5_offline/` is the unit converter as a small static site: `index.html` (the converter with the price per
unit, flat area and number-word helpers) and `tables.html` (printable conversion cheat sheets), linked to each other,
the application modules and only the library modules they use (each tree-shaken and minified), with no network code
at all — the build fails if any appears. Serve the folder from any static host or open it through a local server.
Settings, favourite pairs, the history and the cheat sheet stay in the browser's local storage.
