# Backend build

`html@5_backend/` is the game with its own server: `node server.mjs [port] [--host 0.0.0.0]` (Node >= 18, no
dependencies) serves the pages from `public/` and the rooms API at `/api`: rooms with optional passwords and invite
links, seats for people and server-side bots, spectators, chat, and the room's look (skins and uploaded pictures)
synchronised for every player. Pages and standalone clients on other origins may connect too (CORS).
