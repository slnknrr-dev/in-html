# Backend artifact

`html@5_backend/`: `server.mjs` (hosting.js) + `backend.mjs` (the bundled `backend.js`) + `public/` (the editor).
Run `node server.mjs [port] [--host 0.0.0.0] [--data <dir>]`. The server keeps the team's knowledge bases (`api/kbs`,
writes need the editing token printed at start or `KP_TOKEN`) and publishes every stored base with real routes under
`kb/<id>/` (404 status for unknown pages; 451 content stays encrypted).
