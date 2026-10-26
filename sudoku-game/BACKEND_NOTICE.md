# Backend build

`html@5_backend/` is a self-hosted game server: `node html@5_backend/server.mjs [port]` (Node 18 or newer, no
dependencies) serves the game from `public/` and the rooms API from `backend.mjs` (`sudoku-game/backend.js`: rooms
with invite links and passwords, shared and race games, spectators, chat, bots). Pages served by it use their own
origin as the game server, so invite links work at once. The server also accepts players from other pages (serverless
and standalone builds) through CORS.
