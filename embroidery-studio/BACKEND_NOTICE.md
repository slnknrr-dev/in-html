# Backend artifact

`html@5_backend/`: `server.mjs` (hosting.js) + `backend.mjs` (the bundled `backend.js`) + `public/` (the site). Run
`node server.mjs [port] [--host 0.0.0.0] [--data <dir>]` (Node >= 18, no dependencies). The server keeps the
community catalogue: readers send their charts from the scheme page ("Send to the site"), uploads wait in a
moderation queue (`#/admin`, with the token printed at start or set by `ES_TOKEN`), approved schemes appear in
everyone's catalogue with view and download counts. Readers who set a reader key (Settings in the footer) keep their
stitching progress on the server and continue on another device with the same key.
