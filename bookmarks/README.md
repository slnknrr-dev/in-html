# bookmarks/

The logic of the bookmark manager (`bookmarks-service/`): pure ES modules without DOM access, used by the page and by
the server alike (Node ≥ 18 or any browser).

| file | contents |
| --- | --- |
| `clock.js` | hybrid logical clock stamps `t.c.client` whose string order is their order; `createClock`, `newId`, `parseStamp` |
| `record.js` | replicated records: per-field last-writer-wins registers, tombstones with a purge stamp, `mergeRecord`, `sanitizeRecord`, the field schema |
| `library.js` | `Library`: bookmarks and folders over records, change events, folder tree (cycles from concurrent moves broken the same way everywhere), tags with counts, duplicates and merges, undo snapshots, imports, backups |
| `url.js` | `parseUserURL`, `cleanURL` (tracking parameters), `urlKey` (duplicate key), `hostOf` / `displayURL` (Unicode hosts), `isLinkable`, `titleFromURL`, `findURLs` |
| `import.js` | `parseImport(text or bytes, { name, format, mapping })` for Netscape bookmark files, Chrome / Firefox JSON, Pinboard JSON, own backups, JSON lists, CSV with column mapping, Markdown, link lists; `detectFormat`, `decodeInput` |
| `export.js` | `toNetscape`, `toJSONBackup`, `toCSV`, `toMarkdown` (a library, a selection or a folder) |
| `search.js` | the search language: `parseQuery`, `compileQuery`, `searchItems` (ranked), `suggest`, `tagCloud` |
| `sync.js` | `syncLog`: the server's revision log of records (changes since a revision, future stamps refused) |
| `atom.js` | Atom 1.0 feeds, RFC 4151 tag URIs |
| `meta.js` | what a page says about itself (title, description, canonical URL, icons) read from HTML text |
| `address.js` | IPv4 / IPv6 address classes for SSRF checks (loopback, private, link-local, CGNAT, multicast, reserved, embedded IPv4) |
| `test.js` | `node bookmarks/test.js` (also `node check.js tests bookmarks`) |

## Records and synchronisation

A record is `{ id, type: 'bookmark' | 'folder', v: { field: value }, s: { field: stamp }, p? }`. Every edit stamps the
fields it sets with the writer's clock; merging two copies keeps, field by field, the value with the larger stamp.
Stamps carry the client id, so ties cannot happen and every replica orders every pair of edits the same way: merge is
commutative, associative and idempotent, and edits of different fields made at the same time on two devices both
survive. Deleting sets `del` and the purge stamp `p`; values older than `p` are dropped (and ignored when they arrive
later), so a tombstone keeps nothing of the bookmark. Undo after a deletion writes the values again with new stamps.
The property tests in `test.js` let three clients make random concurrent edits (adds, edits, deletes, restores,
folder moves that form cycles, tag renames) through a lossy network in random orders and check that every replica and
the server end with identical records.

The server keeps a `syncLog` per user: each merged change gets the next revision number. A client sends the records
it changed and the revision it saw last, and receives every record changed since then (including the merged versions
of its own), so sending something twice or in another order is harmless.

Clocks: `createClock(client, now)` makes stamps from milliseconds and a counter; `observe(stamp)` keeps later local
edits newer than anything merged; `skew` lets a client adopt the server's time when its own clock is off (the server
refuses stamps more than a day in the future).

## Fields

Bookmarks: `url`, `title`, `notes`, `tags` (no commas, case-insensitive), `folder` (folder id, '' = none),
`created`, `modified`, `visited` (ms), `unread` (read later), `fav`, `public`, `icon` (an image data URL up to
100 KB), `archived`. Folders: `name`, `parent`, `created`. A folder whose parent is missing or deleted shows at the top
level; bookmarks in a deleted folder show without a folder.

## URL normal form (duplicates)

`urlKey`: scheme and host in lower case, IDN as Punycode, default ports and repeated / trailing slashes dropped,
escaped unreserved characters decoded, query parameters sorted, tracking parameters (`utm_*`, `fbclid`, `gclid`,
`msclkid`, `mc_eid`, `_ga`, … ) removed, the fragment dropped unless it is a route (`#/…`, `#!/…`) or `keepFragment`;
options `ignoreScheme` (http = https) and `ignoreWww`.

## Search language

Words (all must occur; ranked: title, then tags, site, address, notes, folder), `"phrases"`, `-exclusions` (also of
any operator), `tag:x` / `#x` / `tag:x*`, `site:example.com` (and subdomains), `folder:Dev/JS` (a path of folder names
anywhere in the tree, with subfolders; `folder:/` = not in a folder), `is:unread | read | fav | public | private |
archived | untagged | tagged`, `has:notes | icon | tags`, `before:` / `after:` with `YYYY`, `YYYY-MM`, `YYYY-MM-DD`,
`today`, `yesterday`, `7d`, `2w`, `3m`, `1y`, and `title:` / `url:` / `notes:`. Matching ignores case and accents.

## Imports

Real exports are messy, so parsing is tolerant: missing `</DL>` or `</A>`, folders without lists, comments, HTML
entities, timestamps in seconds / milliseconds / microseconds, Chrome's microseconds since 1601, Firefox smart
folders (`place:` URLs, skipped and counted), Pocket's unread / archive sections, Pinboard's `PRIVATE` / `TOREAD` /
space-separated tags, Instapaper's state in its Folder column, Raindrop's folder paths, CSV dialects (`csv/` sniffing)
and encodings (BOM, UTF-8, the HTML meta charset, windows-1251 / 1252). The library then imports with duplicates
skipped, merged (missing titles and notes filled in, tags joined) or kept, into a folder of choice.
