# Backend build

`html@5_backend/` is the game with its own server: `node server.mjs [port] [--host 0.0.0.0]` (Node >= 18, no
dependencies) serves the pages from `public/` and the rooms API at `/api` on the same origin: rooms with optional
passwords and invite links, seats for people and server-side bots, spectators, chat, the room's look synchronised for
every player. The fleets stay on the server; each seat and spectator receives only its own view. Pages on other origins
(the serverless build) may connect too (CORS).
