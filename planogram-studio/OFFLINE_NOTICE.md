# Offline multi-file build

`html@5_offline/` is the shelf planner as a small static site: `index.html` (planograms: fixtures, shelves, the
product library, the front view with the fit check, analytics, versions) and `store.html` (the floor plan of the shop
with the fixtures linked to their planograms), linked to each other, the application modules and only the library
modules they use (each tree-shaken and minified), with no network code at all — the build fails if any appears.
Serve the folder from any static host or open it through a local server. Product lists are imported from CSV / XLSX
files the user picks; the project, the saved versions and the settings stay in the browser's local storage and leave
only as downloads (JSON, CSV, SVG, PNG, print).
