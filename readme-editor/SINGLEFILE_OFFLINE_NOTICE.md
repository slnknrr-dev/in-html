# Single-file offline artifact

`html@5_offline_singlefile/index.html` is the whole README editor in one self-contained HTML file with no network
code: the Markdown renderer, formulas (TeX to MathML), every diagram kind, code highlighting, the badge builder with
its local badge pictures, tables, images, the outline and hints. Open it from disk (`file://`), keep it on a USB stick.

The editor contacts no server. A README may point at remote images (shields.io badges, screenshots on other sites):
those are the document's content, so the page shows static badges drawn locally and holds every other remote picture
back behind a placeholder until you choose "Show remote images" (or More ▸ Load remote images) — only then does the
browser load them. Files are opened and saved through the browser's file dialogs (or downloaded); a project folder can
be opened for relative images; the text is kept in this browser between visits.
