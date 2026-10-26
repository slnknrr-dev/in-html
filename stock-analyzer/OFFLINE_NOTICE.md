# Offline multi-file build

`html@5_offline/` is the stock analyzer as a small static site: `index.html` (ABC / XYZ analysis), `plan.html`
(reorder planner) and `expiry.html` (expiry, FEFO), linked to each other, the application modules and only the
library modules they use (each tree-shaken and minified), with no network code at all — the build fails if any
appears. Serve the folder from any static host or open it through a local server. Sales, stock and batch files are
read in the page and orders leave as CSV / XLSX downloads; the data, suppliers and settings stay in the browser's
local storage.
