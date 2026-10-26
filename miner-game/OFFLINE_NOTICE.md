# Offline multi-file build

`html@5_offline/` is the game as a small static site: `index.html`, the game modules and only the library modules
they use (each tree-shaken and minified), with no network access at all. Serve the folder from any static host (or
zip it for itch.io); browsers can cache the files separately.
