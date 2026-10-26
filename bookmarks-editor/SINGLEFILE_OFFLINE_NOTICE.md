# Bookmarks — one offline file

`html@5_offline_singlefile/index.html` is the whole bookmark manager in **one HTML file**: open it from disk, a USB
stick or any web page host. It never talks to a network: the build replaces the account and sync module with
`account.offline.js`, so the file contains no `fetch`, XHR, WebSocket or other network code at all (the artifact audit
of `node check.js audit` fails the build otherwise).

## Use

- Double-click the file (or open it with File → Open in the browser). Everything works without an internet connection.
- Bring your bookmarks in with **Import** (the file every browser exports, Chrome / Firefox JSON backups, Pinboard,
  Pocket, Raindrop, Instapaper, linkding, Shaarli, CSV, Markdown, lists of links) and take them out again with
  **Export** (browser bookmark file, JSON backup, CSV, Markdown).

## Where the data is

In the browser that opened the file, in its IndexedDB for the file's origin (with `file://` that is usually one origin
for all local files of that browser profile). If the browser does not give pages opened from disk any storage (some
private windows, some browsers' `file://` rules), the page falls back to `localStorage`, and if that is missing too it
works in memory and says so: then export a backup before closing the tab, or serve the file from a local web server
(`npx serve`, `python -m http.server`, or the backend version of this application).

Several tabs of the same file share the data (changes made in one tab appear in the others). A copy of the file in
another browser or on another computer has its own, separate data: move bookmarks between them with Export / Import
(the JSON backup keeps everything, including ids).

## Security notes

- Nothing leaves the device. Links open in a new tab with `rel="noopener noreferrer"`; addresses that are not web
  pages (for example `javascript:` bookmarklets from a browser export) are kept but never opened from the list.
- Favicons are only shown when they came inside an imported file (data URLs); the page never loads remote images.
- Anyone who can use this browser profile can open the file and read the bookmarks; there is no password.
