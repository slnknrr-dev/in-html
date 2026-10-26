# Offline multi-file build

`html@5_offline/` is the shelf price-tag designer as a small static site: `index.html` (products and promotions) and
`design.html` (tag designer and A4 printing), linked to each other, the application modules and only the library
modules they use (each tree-shaken and minified), with no network code at all — the build fails if any appears. Serve
the folder from any static host or open it through a local server. Product lists are imported from files the user
picks, tags leave as prints, SVG and PNG downloads; products, promotions, the design and the last printed set stay in
the browser's local storage.
