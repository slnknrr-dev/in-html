# Single-file offline build

`html@5_offline_singlefile/` holds the map and street gazetteer of Batumi as self-contained HTML (`index.html` (map
and search) and `streets.html` (the street list), linked to each other): scripts, styles, icons and the vector map
data are inlined and nothing is fetched — no tiles, no `fetch`; the build fails on any network API or remote
resource. Open a file from disk (`file://`), put it on a USB stick, send it by e-mail or host it anywhere. The last
view, the query and the settings stay in the browser's local storage. The embedded data is © OpenStreetMap
contributors, ODbL 1.0.
