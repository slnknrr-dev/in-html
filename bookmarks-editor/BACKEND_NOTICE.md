# Bookmarks — self-hosted service (multi-file)

`html@5_backend/` is a small bookmark service for you and the people you invite, in the spirit of Shaarli, linkding
or Pinboard. It needs only Node.js 18 or newer — no packages, no database.

```
html@5_backend/
  server.mjs     the web server (static files + the service), generated from hosting.js
  backend.mjs    the bookmark service (accounts, sync API, public pages, bookmarklet, metadata), bundled
  public/        the web page and its modules
```

## Run

```bash
node server.mjs                       # http://127.0.0.1:8080/ (the next free port when 8080 is taken)
node server.mjs 3000 --host 0.0.0.0   # another port, every network interface
node server.mjs --data /srv/bookmarks # another data folder
```

The same settings come from the environment: `PORT`, `HOST`, `DATA_DIR`. Open the address in a browser: the first
visit creates the **owner** account. The owner invites more people with invitation links (Settings → Account and
sync → Invitations); each link creates one account and expires after a week.

For use on the internet put it behind a reverse proxy that terminates HTTPS (Caddy, nginx) and set
`BOOKMARKS_TRUST_PROXY=1` so the service reads the client address and scheme from `X-Forwarded-For` /
`X-Forwarded-Proto` (secure cookies, rate limits per address). Do not expose the plain HTTP port directly.

## Data

Everything is in the data folder (default `./data` next to `server.mjs`), as JSON files written atomically
(temporary file + rename):

| file | contents |
| --- | --- |
| `accounts.json` | users (password hashes), open invitations, the key that signs form tokens |
| `sessions.json` | sessions and API tokens (only their SHA-256 hashes) |
| `config.json` | server settings the owner changes in the page (page metadata, allowed origins, public pages) |
| `lib.<user id>.json` | each user's bookmarks: the revision log the browsers sync with |

Back up the folder (stop the server or copy the files as they are: every file is always complete). Users can also
export their own bookmarks from the page at any time.

## What it offers

- The bookmark manager page, offline-first: each browser keeps a copy in IndexedDB and syncs in the background
  (changes since the last revision; concurrent edits of different fields of the same bookmark both survive).
- Public bookmarks of each user at `/u/<name>` and as an Atom feed at `/u/<name>/feed` (also per tag: `?tag=x`).
- A **bookmarklet** (Settings) that opens `/add?url=…&title=…&selection=…` in a small window to save the page you are on.
- Optional page metadata (title, description, favicon, canonical address) when adding by URL — off by default.
- An API for scripts and the standalone page: `Authorization: Bearer <token>` (tokens in Settings).

## Settings (environment)

| variable | meaning |
| --- | --- |
| `BOOKMARKS_FETCH_META=1` | let the server fetch public pages for titles and favicons (also switchable by the owner) |
| `BOOKMARKS_CORS=null,https://a.example` | origins whose pages may call the API with a token (`null` = files opened from disk) |
| `BOOKMARKS_PUBLIC=0` | turn off public pages and feeds |
| `BOOKMARKS_TRUST_PROXY=1` | behind a reverse proxy: trust `X-Forwarded-*` |
| `BOOKMARKS_PBKDF2_ITERATIONS` | password hashing cost (default 310 000, at least 100 000) |

A variable set in the environment overrides the owner's setting and locks it in the page.

## Security notes

- Passwords: PBKDF2-SHA-256 with a random salt; sessions and tokens are random 256-bit values stored only as hashes.
- Browsers of the same origin use an `HttpOnly; SameSite=Lax` cookie, which only counts for requests from this origin
  (checked with `Origin` / `Sec-Fetch-Site`); state-changing API calls require JSON bodies, the bookmarklet form a
  signed token. Other origins never use cookies: CORS answers only the allowed origins, never with credentials, and
  they need a bearer token.
- Sign-in, set-up and invitation attempts are limited per address and per user name (HTTP 429 with `Retry-After`).
- Every response carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'`
  and a Content-Security-Policy (the server's own pages: no scripts but one hashed line, no remote resources).
- Page metadata is fetched only from public addresses: the host is resolved and loopback, private, link-local,
  CGNAT, multicast and reserved addresses (IPv4 and IPv6, IPv4-mapped forms too) are refused — at connection time and
  again after each of at most 5 redirects; 5 s, 1 MB of HTML, 100 KB per favicon, no cookies, only `text/html` and
  `image/*`.
