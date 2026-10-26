# Serverless artifact

`html@5_serverless/` is the scheme site as a static site for any static host (GitHub Pages, Codeberg Pages, a
folder on a web server). It needs no server of ours: besides the built-in schemes it shows the schemes published
next to it — "My schemes → Publish my charts as a static site catalogue" writes a ZIP with `catalog/index.json`
(titles, categories, tags, sizes, thumbnails) and `catalog/<id>.json`; unpack it next to `index.html` and every
visitor sees those schemes in the catalogue with search, filters, scheme pages, downloads and printing. Visitors'
charts and progress stay in their browsers.
