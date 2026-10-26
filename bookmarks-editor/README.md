# Bookmarks (`bookmarks-service`)

A bookmark manager in the spirit of Shaarli, linkding or Pinboard that ships in four forms, chosen by the NOTICE
files in this folder (`targets.js`):

| artifact | what it is | notice |
| --- | --- | --- |
| `html@5_offline_singlefile/index.html` | one HTML file, bookmarks in this browser only, no network code at all | [SINGLEFILE_OFFLINE_NOTICE.md](SINGLEFILE_OFFLINE_NOTICE.md) |
| `html@5_backend/` | self-hosted service: `server.mjs` + `backend.mjs` + `public/` for Node ≥ 18 | [BACKEND_NOTICE.md](BACKEND_NOTICE.md) |
| `html@5_backend_singlefile/bookmarks-service.mjs` | the same service in one script | [SINGLEFILE_BACKEND_NOTICE.md](SINGLEFILE_BACKEND_NOTICE.md) |
| `html@5_standalone/index.html` | one HTML file that also syncs with a server the user enters (HTTPS + CORS + token) | [STANDALONE_NOTICE.md](STANDALONE_NOTICE.md) |

The page reads `globalThis.IN_HTML_ARTIFACT.mode` to decide what to show: `offline` (no accounts: the build swaps
`account.js` for `account.offline.js`), `backend` (this origin is the server: set-up / sign-in / invitation screens,
sync, public pages, bookmarklet), `standalone` (local until connected in Settings). Without an artifact (sources
served by `node bookmarks-service/server.js`, which mounts `backend.js` with data in `bookmarks-service/.data/`) it
behaves like the backend version and falls back to local storage when no backend answers.

## Features

- **Library**: All bookmarks, Read later, Favourites, Untagged, Archive; a folder tree (subfolders, rename, move,
  delete with undo, drag folders onto folders); tags with counts (filter, rename, merge, delete in the tag manager).
- **List**: list, cards and compact layouts; letter avatars coloured by host when there is no favicon; host, folder,
  relative date, notes and tags on each row; unread dot; star; links open in a new tab with
  `rel="noopener noreferrer"` (non-web addresses such as `javascript:` bookmarklets are kept but never opened);
  sorting by date, title, site, last opened, last changed; rendering in pages of 150 rows.
- **Search** with the language of `bookmarks/search.js` (`words "phrases" -x tag:x #x site: folder: is: has: before:
  after: title: url: notes:`), ranked results and suggestions for tags, sites, folders and operators.
- **Add / edit**: paste anywhere on the page or into the address field — "Some title https://…" splits into title and
  address; without a title the page uses the pasted text or a title made from the address (offline), or the page's
  own title, description and favicon fetched by the server (hosted, when the owner turns it on); duplicate warning
  with a link to the saved copy; chip input for tags with suggestions; folder picker with "new folder".
- **Selection**: Ctrl / Shift click, Ctrl+A, Shift+arrows, Space; on touch a long press opens the menu with
  **Select**, which turns on selection mode with checkboxes. Bulk bar: tags, move, read later / read, favourite,
  delete, and the full menu (copy links, Markdown, open all, archive, public / private).
- **Context menus** (`ui/contextmenu.js`): right click, long press by touch or pen (instead of the text selection and
  the system callout), the Menu key and Shift+F10 — open, copy link / title / Markdown link, edit, tags, move, read
  state, favourite, public, archive, select, delete; folders and tags in the sidebar have their own menus.
- **Drag and drop**: bookmarks onto folders (or onto Read later, Favourites, Archive, a tag), to other applications as
  links; links and bookmark files dropped onto the page are added or imported.
- **Import / export** with a preview, detected format (overridable), CSV / JSON column mapping, a duplicates report
  and options (target folder, duplicates skip / merge / keep, tracking parameters); export as a browser bookmark file,
  JSON backup (lossless, restorable), CSV or Markdown — everything, the current view, the selection or a folder.
- **Duplicate finder** (http = https and www optional) with merging per group or all at once.
- **Undo** of every change (deletions, moves, tags, imports, merges): the toast's Undo button or Ctrl+Z.
- **Keys**: `/` or Ctrl+K search, N add, ↑ ↓ / J K move, Enter / O open, E edit, T tags, V move, F favourite,
  R read state, C copy link, Del delete, Esc clear the selection, ? help.
- **Storage**: IndexedDB (records merged in place, so tabs and the sync never overwrite each other; other tabs see
  changes at once), else localStorage, else memory with a warning (some `file://` contexts, private windows).
- **Hosted**: accounts (owner set-up on the first visit, invitation links), sync in the background (offline-first;
  status chip in the header), public page and Atom feed per user, bookmarklet, API tokens, password change, user
  management and server settings for the owner. See BACKEND_NOTICE.md for the server.
- 7 UI languages (en, ru, uk, de, fr, es, ka; the server's own pages too), light / dark, from 360 px wide (the sidebar
  becomes a drawer and the bulk bar moves to the bottom), keyboard and screen reader friendly (listbox with
  multi-selection, labelled controls, focus kept across re-renders).

## Files

| file | purpose |
| --- | --- |
| `index.html`, `app.css` | page and styles |
| `main.js` | shell, storage and persistence, search box, toolbar, bulk bar, keys, paste and drops, the UI hooks |
| `list.js` | sidebar and list rendering, selection, item / folder / tag menus, drag and drop |
| `dialogs.js` | editor, tag input, tags of several bookmarks, folder picker, tag manager, duplicates, settings, help |
| `transfer.js` | import / export dialog |
| `common.js` | shared state, undo, actions, avatars, dates, icons |
| `db.js` | IndexedDB / localStorage / memory storage with dirty flags and tab notifications |
| `account.js`, `account.offline.js` | accounts, sign-in screens, sync loop, account settings; the offline twin without network code |
| `remote.js` | client of the JSON API |
| `service.js` | the hosted service (accounts, sessions, API, public pages, bookmarklet window, CORS, rate limits, headers) |
| `fetcher.js` | page metadata and favicons with SSRF protection |
| `pages.js`, `server-strings.js` | HTML the server renders (public page, bookmarklet window) and its strings |
| `backend.js` | the artifact backend (`targets.js` / `hosting.js` contract) |
| `strings.js`, `strings-i18n.js` | UI strings (en; ru, uk, de, fr, es, ka) |
| `test.js` | `node bookmarks-service/test.js`: the service in-process and the generated servers (setup, login, invitations, sync of two clients, public page and Atom, CORS, bookmarklet with CSRF, SSRF refusals, tokens, rate limit) |
| `e2e.js`, `e2e-hosted.js` | browser scenarios: `node check.js e2e bookmarks-service/html@5_offline_singlefile/index.html bookmarks-service/e2e.js`; the hosted one against a running generated server (see its header) |
| `server.js` | development server |

## Limits

- Concurrent edits of the *same* field (for example tags of one bookmark on two offline devices) keep the newer one.
- Tombstones of deleted bookmarks stay in the server's log (they are small) so that devices offline for a long time
  cannot bring deleted bookmarks back.
- Favicons are shown only when they came with an import (data URLs) or from the server's metadata fetch; the page
  never loads remote images.
- The hosted page's Content-Security-Policy allows inline scripts and styles because single-file pages carry them
  inline; the server's own pages (public page, bookmarklet window) use hashes instead.
- There is no full-text archive of page contents.
