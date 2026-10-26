# Offline multi-file build

`html@5_offline/` is the catalogue schema and title-rule designer as a small static site: `index.html` (schema:
category tree, resolved schema, live form) and `rules.html` (title rules, scales, tags, samples, tracer), linked to
each other, the application modules and only the library modules they use (each tree-shaken and minified), with no
network code at all — the build fails if any appears. Serve the folder from any static host or open it through a local
server. The project stays in the browser's local storage and leaves only as JSON / CSV downloads.
