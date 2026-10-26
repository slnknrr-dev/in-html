# Serverless build

`html@5_serverless/` is Language Studio as a static site for any static host (Codeberg Pages, GitHub Pages, a CDN):
`index.html`, the application modules and only the library modules they use, each tree-shaken and minified.
Everything runs in the browser; progress is kept in the IndexedDB of each visitor's browser (export / import as JSON).
