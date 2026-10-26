# Offline multi-file build

`html@5_offline/` is the map and street gazetteer of Batumi as a small static site: `index.html` (map and search) and
`streets.html` (the street list), linked to each other, the application modules with the embedded map data and only
the library modules they use (each tree-shaken and minified), with no network code at all — the build fails if any
appears. There are no map tiles: the map is drawn in the page from the embedded vector data, so nothing is fetched.
Serve the folder from any static host or open it through a local server. The last view, the query and the settings
stay in the browser's local storage. The embedded data is © OpenStreetMap contributors, ODbL 1.0.
