# Backend build

`html@5_backend/` is `server.mjs` (static hosting) + `backend.mjs` (the bundled `event-invite/backend.js`) + `public/`
(the pages). `node server.mjs [port] [--host h] [--data dir]` serves the designer and the RSVP API under `/api/`:
publishing an invitation returns an event id and an owner token; guests post replies (name, answer, companions, menu,
dietary needs, message); the host lists or exports them (`?format=csv`) with the token. Replies are JSON files in the
data folder. Limits: 8 KB per reply, 30 replies per 10 minutes per address, 3000 replies per event; `EI_ORIGINS`
(comma-separated, `null` for files opened from disk) restricts CORS. Guests only ever see counts, and only when the
host allows them.
