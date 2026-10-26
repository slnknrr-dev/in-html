# Bookmarks — self-hosted service in one file

`html@5_backend_singlefile/bookmarks-service.mjs` is the whole bookmark service — web server, bookmark service and
the page — in **one script for Node.js 18 or newer**. No packages, no database, no other files.

## Run

```bash
node bookmarks-service.mjs                         # http://127.0.0.1:8080/ (next free port if taken)
node bookmarks-service.mjs 3000 --host 0.0.0.0     # another port, every interface
node bookmarks-service.mjs --data ~/bookmarks-data # another data folder (default: ./data next to the script)
```

`PORT`, `HOST` and `DATA_DIR` work as environment variables too. The first visit creates the owner account; the owner
invites other people with invitation links. Behind an HTTPS reverse proxy set `BOOKMARKS_TRUST_PROXY=1`.

It behaves exactly like the multi-file version (`BACKEND_NOTICE.md`): the same data folder layout
(`accounts.json`, `sessions.json`, `config.json`, `lib.<user id>.json`, written atomically), the same environment
settings (`BOOKMARKS_FETCH_META`, `BOOKMARKS_CORS`, `BOOKMARKS_PUBLIC`, `BOOKMARKS_TRUST_PROXY`,
`BOOKMARKS_PBKDF2_ITERATIONS`), the same public pages (`/u/<name>`, `/u/<name>/feed`), bookmarklet (`/add`) and API —
so you can switch between the two at any time by pointing them at the same data folder.

## Updating

Replace the script with a newer build and start it again with the same data folder.

## Security notes

The same as for the multi-file version: PBKDF2 password hashes, hashed session and API tokens, `HttpOnly; SameSite`
cookies only for requests of the same origin, bearer tokens for everything else, CORS only for the configured
origins and never with credentials, rate-limited sign-in, security headers on every response, and page metadata
(off by default) fetched only from public addresses with every redirect checked. Run it behind HTTPS on the
internet.
