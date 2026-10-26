# Bookmarks — standalone file that syncs with your server

`html@5_standalone/index.html` is the bookmark manager in **one HTML file** that you open from disk (`file://`), like
the offline version — but it can also **connect to a bookmark server you run** (the backend versions of this
application) and keep both in sync.

## Use

- Open the file. Without a server it works exactly like the offline file: bookmarks stay in this browser.
- Settings → Account and sync → enter the server address (for example `https://bookmarks.example.org`) → sign in
  (or create the owner account of a brand new server). Bookmarks you already had in the file are added to your
  account. From then on every change syncs in the background; the file keeps working offline and catches up later.
- Disconnect in the same place (optionally removing the copy in this browser).

No server address is built in: the file only ever talks to the server you enter.

## How it talks to the server

Over HTTPS with CORS: a page opened from disk has the origin `null`, so the server must allow it (the default of the
service: `BOOKMARKS_CORS=null`, or the owner's setting "Origins allowed to call the API"). Signing in returns an **API
token** that the file keeps in this browser's `localStorage` and sends as `Authorization: Bearer …`; the password is
never stored and no cookies are used. The token appears in the server's list of sessions and can be revoked there.

`http://` addresses work for `localhost` tests; anything else should be HTTPS, or the password and token travel
unencrypted (the page warns).

## Where the data is

In this browser's IndexedDB for the file's origin (with fallbacks to `localStorage` or memory, as described in the
offline notice), plus on the server once connected. Export a JSON backup any time.

## Security notes

- Anyone using this browser profile can open the file and, while it is connected, use the stored token. Disconnect
  (which revokes the token) on shared computers.
- Allowing the `null` origin on the server is safe because cross-origin calls never carry cookies: without a valid
  token they can only read the service's public description and try to sign in (which is rate limited).
- Links open with `rel="noopener noreferrer"`; non-web addresses such as `javascript:` bookmarklets are never opened
  from the list.
