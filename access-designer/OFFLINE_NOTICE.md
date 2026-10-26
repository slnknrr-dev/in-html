# Offline multi-file build

`html@5_offline/` is the access model designer as a small static site: `index.html` (roles and the permission
matrix), `policies.html` (data policy), `modules.html` (module catalogue and views), `sessions.html` (session scopes
and lifetime) and `config.html` (layered configuration), linked to each other, the application modules and only the
library modules they use (each tree-shaken and minified), with no network code at all — the build fails if any
appears. Serve the folder from any static host or open it through a local server. The project stays in the browser's
local storage and leaves only as JSON, CSV or a printed document.
