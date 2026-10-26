# Backend build

`html@5_backend/` is a self-hosted Language Studio with accounts: `node html@5_backend/server.mjs [port]` (Node 18 or
newer, no dependencies) serves the application from `public/` and the account API from `backend.mjs`
(`language-studio/backend.js` → `service.js`).

- Anyone can register while registration is open; the first account is the owner, who can close it in the page
  (Progress → Close registration). `STUDIO_REGISTRATION=open|closed` sets it from the environment and locks it.
- Each learner's progress is stored on the server and merged with the browser's copy (card by card, the newer review
  wins), so learning continues on another device. Signed out, the page works with the browser's copy only.
- Data: `accounts.json` (PBKDF2-SHA-256 password hashes), `sessions.json` (SHA-256 hashes of session tokens) and
  `progress.<user id>.json` in the data folder.
- Security: an HttpOnly SameSite=Lax session cookie that only counts on same-origin requests, JSON-only writes,
  rate-limited sign-in and registration (HTTP 429), `nosniff`, `no-referrer` and `frame-ancestors 'none'`. Behind a
  reverse proxy that terminates HTTPS set `STUDIO_TRUST_PROXY=1`.
