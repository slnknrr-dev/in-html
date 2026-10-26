# Offline multi-file build

`html@5_offline/` is the SEO kit as a small static site: `index.html` (the site and its generated files),
`og.html` (the Open Graph card designer) and `check.html` (the page checker), linked to each other, the application
modules and only the library modules they use (each tree-shaken and minified), with no network code at all — the
build fails if any appears. Serve the folder from any static host or open it through a local server. Sitemaps,
robots.txt, llms.txt, feeds, JSON-LD, meta tags and cards are made in the page and leave as downloads; the site, the
card and the last checked page stay in the browser's local storage.
