# fileapi/

A reusable **file API server** and its client: folders and single files of the machine ("mounts") listed, streamed with
byte ranges, uploaded, thumbnailed and watched over HTTP. A media player's backend mounts it in a Node server artifact
(hosting.js) and in-process inside an Electron app; any application backend can mount it below a prefix of its choice.

Pure ES modules, no dependencies, importable in Node and in browsers: no module imports `node:` modules (except
`test.js`), Node's `fs` and `path` are passed in, because bundled backends cannot import them. Node ≥ 18 for the
server side, any browser or Node ≥ 18 for the client.

| file | contents |
| --- | --- |
| `paths.js` | `normRel`, `joinRel`, `parentRel`, `baseName`, `extOf`, `isHiddenName`, `compareNames` (natural order), `resolveSafe` (realpath containment), `isInside`, `mountId`, `normAbs`, `fnv64` |
| `glob.js` | `globToRegExp`, `matchGlob`, `matchAny`, `filterPaths` |
| `range.js` | `parseRange`, `contentRange` |
| `types.js` | `typeOf`, `kindOf`, `TYPES`, `SUBTITLE_EXT`, `PLAYLIST_EXT` |
| `auth.js` | `tokenAuth`, `openAuth`, `newToken`, `bearerToken`, `sameToken` |
| `handler.js` | `createFileApi(opts)` → `{ handle, mounts, addMount, removeMount, resolve, grant, close }`; `ApiError`, `API_NAME`, `API_VERSION`, `MOUNTS_KEY` |
| `client.js` | `createFileClient({ base, token, fetch })`, `FileApiError`, `encodePath` |
| `test.js` | `node fileapi/test.js`: the pure helpers, then a scratch folder served by a real HTTP server on 127.0.0.1 (traversal attempts, ranges, auth, CORS, uploads, grants, persistence, thumbnails, watching, the client) |

## Mounting it

```js
// <app>/backend.js (hosting.js contract: (ctx) => ({ handle(req, res, url) }))
import { createFileApi } from '../fileapi/handler.js';
import { tokenAuth, newToken } from '../fileapi/auth.js';

export default function backend(ctx) {
  const owner = ctx.storage.read('owner-token') || newToken();
  ctx.storage.write('owner-token', owner);
  const files = createFileApi({
    node: { fs: ctx.node.fs, path: ctx.node.path }, // hosting.js / electron.js / server.js pass them in ctx.node
    storage: ctx.storage,
    authorize: tokenAuth({ owner }),
    mounts: [{ path: process.env.MEDIA_DIR, name: 'Media' }],
    cors: { origins: [] },
    thumbs: { dir: ctx.dataDir + '/thumbs', make: async (abs, size, kind) => null },
    watch: true,
    log: ctx.log,
  });
  return {
    handle(req, res, url) {
      const m = /^(.*?\/)api\/fs\/(.*)$/.exec(url.pathname);   // still percent-encoded
      return m ? files.handle(req, res, url, m[2]) : false;
    },
  };
}
```

Inside Electron, the main process runs an `http.createServer` on 127.0.0.1 with `authorize: openAuth()` (or a token
that only the app's own window knows), `hosts: ['127.0.0.1', 'localhost']` and calls `grant(paths)` with what the
user picked in a native dialog or dropped onto the window.

`handle(req, res, url, rest)`: `rest` is the path below the prefix, split from it but still percent-encoded (the
handler decodes each segment itself, so `%2F` inside a name cannot become a separator unnoticed). `url` is a `URL`
(for the query). It returns `true` when it answered, which is always unless `rest` is null / undefined. WHATWG URL
parsing (hosting.js uses `new URL(req.url)`) collapses `..` and `%2e%2e` segments before the handler sees them; that
is harmless, every path is checked again.

## Options

```js
createFileApi({
  node: { fs, path },                      // required
  authorize,                               // required: (req, scope, url, { op }) -> true | false | 'unauthenticated' (or a Promise)
  platform: process.platform,              // 'win32' | 'linux' | 'darwin' (path rules, case folding of ids)
  storage: null,                           // { read(key), write(key, value) }: added mounts persist under 'fileapi.mounts'
  mounts: [],                              // [{ path, name, writable = false, fixed = true }] owner-configured roots
  cors: { origins: [] },                   // ['*'] | ['null', 'https://a.example'] | []
  hosts: [],                               // Host header allowlist (DNS rebinding), [] = any
  thumbs: null,                            // { dir, make: async (absPath, size, kind) -> { type, bytes } | null, concurrency = 2 }
  watch: false,
  uploadLimit: 2 * 1024 ** 3,              // bytes; 0 turns uploads off
  listLimit: 50000,                        // entries per listing
  log: () => {},
});
```

A **mount** is `{ id, name, path, writable, kind: 'dir' | 'file', fixed, temporary, available }`. `id` =
`mountId(path, platform)`: 10 lower-case base32 characters of an FNV-1a 64 hash of the normalized absolute path
(case-insensitive and separator-insensitive on win32), so it stays the same across restarts.
Configured mounts are `fixed` (cannot be removed through the API) unless `fixed: false`; they are not written to
storage (they come back from the configuration). Mounts added through the API or `grant` persist unless
`persist: false` (`temporary: true`). `available` is false while the path is missing (an unplugged drive): such mounts
are kept and answer 404.

A **single-file mount** (`kind: 'file'`) is a virtual folder with exactly one entry, the file, at the relative path
of its base name: `list/<m>/` lists it, `raw/<m>/<name>` serves it, nothing else of its folder is reachable.

## HTTP API

`<m>` = mount id, `<path>` = relative path below the mount with every segment percent-encoded
(`encodePath` in client.js), segments joined by `/`. JSON answers carry `Content-Type: application/json;
charset=utf-8`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. HEAD is
accepted wherever GET is (except `watch`).

| request | scope | answer |
| --- | --- | --- |
| `GET info` | read | `{ api: 'in-html-fileapi', version: 1, mounts: n, features: { upload, thumbs, watch }, scopes: ['read', 'write'?, 'owner'?], limits: { upload, list } }`; without a token **401** `{ api, version, auth: true, error, code: 'unauthorized' }` (a wrong token: 403 with the same fields), so a client can show "token needed" |
| `GET mounts` | read | `[mount]`; `path` (absolute) only for the owner |
| `GET mounts/<m>` | read | one mount |
| `POST mounts` `{ path, name?, writable?, persist? }` | owner | the mount (200); the folder or file must exist (404), the path must be absolute (400). Adding an existing path updates `name` / `writable` of a non-fixed mount |
| `DELETE mounts/<m>` | owner | `{ ok: true }`; fixed mounts 403 `fixed`, unknown 404 |
| `POST grant` `{ paths: [abs, ...], writable?, persist? }` | owner | `[{ mount, path, dir }]`, one item per input in order: a folder mount or single-file mount that already contains the path is reused (the deepest folder mount wins), else a mount is added (folder → folder mount with `path: ''`, file → single-file mount with `path: '<name>'`). A failing item is `{ mount: null, path: null, dir: false, error, code }`. `writable` applies to added mounts only |
| `GET list/<m>/<path>` | read | `{ mount, path, entries: [entry], truncated }` (below) |
| `GET stat/<m>/<path>` | read | `{ mount, ...entry, ctime, birthtime?, ino? }` (`ino` as a decimal string: 64-bit file ids do not fit a double) |
| `GET` / `HEAD raw/<m>/<path>` | read | the bytes (below) |
| `PUT raw/<m>/<path>?overwrite=0\|1` | write | the body becomes the file: `{ mount, ...entry }`, 201 new / 200 replaced (below) |
| `GET thumb/<m>/<path>?size=` | read | a cached thumbnail (below) |
| `GET watch?since=<seq>&timeout=<s>` | read | long poll (below) |
| `OPTIONS <anything>` | — | CORS preflight: 204 when the Origin is allowed (or absent), 403 otherwise |

**Entries**: `{ name, path (relative to the mount), dir, size (0 for folders), mtime (ms), type, kind }`. `type` is the
MIME type from types.js (`''` for folders); `kind` is `'audio' | 'video' | 'image' | 'subtitle' | 'text' | 'other'`, or
`'dir'` for folders.

**Listing** parameters: `recursive=1` (whole tree), `depth=N` (implies recursive: 1 = the folder's children only, 2 =
their children too, …), `glob=<g>` (repeatable; filters **files** — folders stay listed so a filtered browser can still
navigate, `dirs=0` drops folder entries), `exclude=<g>` (repeatable; files and folders, an excluded folder is not
entered), `hidden=1` (show dotfiles and system clutter: `$RECYCLE.BIN`, `System Volume Information`, `Thumbs.db`,
`desktop.ini`, `@eaDir`, `.DS_Store`, …), `limit=N` (at most `listLimit`). Globs match the path relative to the mount
root (see glob.js; a glob without `/` matches the base name at any depth). Order: folders first, then natural name order
(`Track 2` < `track 10`, case-insensitive); a recursive listing is depth-first (a folder, then its contents). Symlinks
and junctions are listed and followed only when their real target is inside the mount; every folder is entered once
(no cycles); names the API could not address (e.g. containing `:` on Linux) and special files (FIFOs, sockets, devices)
are skipped. `truncated: true` when the limit cut the listing.

**raw GET / HEAD**: `Accept-Ranges: bytes`, `Content-Type` (types.js), `Content-Length`, weak `ETag` (`W/"<size>-<mtime>"`
in base 36), `Last-Modified`, `Cache-Control: private, no-cache`, `Content-Disposition: inline` (`attachment` with
`?download=1`; ASCII `filename` + RFC 5987 `filename*`), `Content-Security-Policy: … sandbox` (a user's HTML / SVG file
opened directly cannot run scripts on the app's origin). `If-None-Match` / `If-Modified-Since` → 304. `Range` → 206 +
`Content-Range`; unsatisfiable → 416 with `Content-Range: bytes */<size>`; an invalid header is ignored (200); several
ranges → the first satisfiable one only (no multipart). `If-Range` with a stale validator → 200 with everything (weak
ETags are compared leniently there, so resumed media requests keep working). The file is opened before the headers are
sent, streamed with a read stream over `{ start, end }` and the stream is destroyed when the client disconnects.
Folders → 400 `is-directory`, special files → 400 `not-a-file`.

**raw PUT**: needs uploads on (`uploadLimit > 0`, else 403 `uploads-off`), a writable **folder** mount (else 403
`not-writable`) and the write scope. The body streams into a temporary hidden file next to the target
(`.fileapi-<random>.upload`), then: `overwrite=1` renames it over the target; otherwise it is hard-linked into place
(atomic no-clobber; on file systems without hard links: check, then rename) and an existing file answers 409 `exists`.
A folder with the name → 409 `is-directory`. Missing parent folders inside the mount are created. `Content-Length`
over the limit → 413 `too-large` at once; bodies without a length are counted while streaming (413, the partial file is
removed). Hidden names (dotfiles, `desktop.ini`, …) are never written (403). Aborted uploads leave nothing behind.

**thumb**: 404 `no-thumb` when thumbnails are off or `make` returned null (remembered for the process lifetime) or
threw. `size` is clamped to 128..1024 and rounded up to a multiple of 64 (default 256), so few variants are cached. The
cache key is `fnv64(mount, path, size, mtime, file size)`: a changed file gets a new thumbnail. Cache files are
`<thumbs.dir>/<key>.<ext>` (written atomically, indexed at the first request); concurrent requests for one key share
one `make` promise; at most `thumbs.concurrency` (2) `make` calls run at once. `make(absPath, size, kind)` receives the
kind of types.js, `'dir'` for folders (folder covers). Answers carry `Cache-Control: private, max-age=86400` and a
strong `ETag` (`If-None-Match` → 304).

**watch**: `fs.watch(dir, { recursive: true })` per folder mount and `fs.watch(file)` per single-file mount, started at
the first watch request (and for mounts added later), stopped by `close()` or when a mount is removed. Where recursive
watching is unavailable (Linux before Node 20) only top-level changes are reported (logged once). Events
`{ seq, mount, path, type: 'change' | 'rename' }` are coalesced per path over 300 ms (a rename wins over a change),
hidden names are dropped, and the last 1000 are kept. `since` absent → `{ seq, events: [] }` (the starting point);
events newer than `since` → answered at once; none → the request waits up to `timeout` seconds (default 25, max 30,
0 = no wait) and answers `{ seq, events }`. A `since` older than the buffer, or newer than the current sequence (the
server restarted: sequences start at the clock time), → `{ reset: true, seq, events: [] }`: the client rescans.

### Auth

`authorize(req, scope, url, { op })` decides: `true` → go on, `'unauthenticated'` → 401 `unauthorized` with
`WWW-Authenticate: Bearer`, `false` → 403 `forbidden`. Scopes: `read` (info, mounts, list, stat, raw, thumb, watch),
`write` (PUT raw), `owner` (POST / DELETE mounts, grant; mount paths in `GET mounts`).

- `tokenAuth({ owner, readers = [], writers = [], queryToken = true })`: `Authorization: Bearer <token>`; for GET / HEAD
  of `raw/` and `thumb/` only, also `?t=<token>` (media elements and `<img>` cannot send headers). The owner token has
  every scope, writers read + write, readers read. Constant-time comparison against every configured token.
- `openAuth()`: everything allowed — when the caller authenticated the request already.
- `newToken(bytes = 24)`: base64url of `crypto.getRandomValues` bytes (32 characters by default).

### CORS

With `cors.origins` listing the request's `Origin` (or `['*']`), answers carry `Access-Control-Allow-Origin: <origin>`
(`*` for `['*']`), `Vary: Origin`, `Access-Control-Allow-Headers: Authorization, Range, Content-Type, If-None-Match,
If-Modified-Since, If-Range`, `Access-Control-Allow-Methods: GET, HEAD, PUT, POST, DELETE, OPTIONS`,
`Access-Control-Expose-Headers: Content-Range, Accept-Ranges, Content-Length, ETag, Content-Type, Content-Disposition,
Last-Modified`, `Access-Control-Max-Age: 600`; never `Allow-Credentials` (tokens are not cookies). `'null'` allows
pages opened from `file://`. Preflights of other origins get 403; a preflight with
`Access-Control-Request-Private-Network: true` from an allowed origin gets `Access-Control-Allow-Private-Network: true`
(Chrome's rule for public pages calling a local server). `Vary: Origin` is sent on every answer once a list is set.
Writes (POST, PUT, DELETE) carrying an `Origin` that is neither allowed nor the request's own host are refused (403)
even though some need no preflight (a `text/plain` POST), so a foreign page cannot add mounts on an open local server.

### Errors

`{ error: 'message', code }`; messages never contain paths of the machine.

| status | codes |
| --- | --- |
| 400 | `bad-path` (unsafe path, bad percent-encoding, relative mount path), `bad-request` (invalid JSON or parameters), `is-directory` (raw of a folder), `not-a-directory` (list of a file), `not-a-file`, `aborted` |
| 401 | `unauthorized` |
| 403 | `forbidden` (scope, a path leading out of the mount, a foreign origin or host, hidden names on upload, permission denied), `not-writable`, `uploads-off`, `fixed` |
| 404 | `not-found` (unknown endpoint, mount, file; unavailable mount), `no-thumb`, `no-watch` |
| 405 | `method` (with `Allow`) |
| 409 | `exists`, `is-directory` (upload onto a folder), `busy` (file in use) |
| 413 | `too-large` (upload limit, JSON bodies over 1 MB, more than 10 000 grant paths) |
| 416 | `bad-range` (with `Content-Range: bytes */<size>`) |
| 500, 503, 507 | `internal` (logged), `busy` (too many open files), `no-space` |

## Client

```js
import { createFileClient } from '../fileapi/client.js';
const fsc = createFileClient({ base: 'api/fs/', token });
const { entries } = await fsc.list(mount, 'Music', { recursive: true, glob: ['*.mp3', '*.flac'], dirs: false });
audio.src = fsc.rawURL(mount, entries[0].path);            // ?t=<token> when a token is set
const src = await fsc.source(mount, entries[0].path);       // { size, read(offset, length) } for a tag reader
const head = await src.read(0, 10);
```

`info`, `mounts`, `addMount(path, { name, writable, persist })`, `removeMount(id)`, `grant(paths, { writable,
persist })`, `list(mount, rel, { recursive, depth, glob, exclude, hidden, dirs, limit })`, `stat(mount, rel)`,
`rawURL(mount, rel, { download })`, `thumbURL(mount, rel, size)`, `read(mount, rel, start, end)` (end exclusive like
`slice`; past the end → shorter or empty), `source(mount, rel, size?, { blockSize = 65536, blocks = 32 })` (aligned
blocks through a small LRU cache, one Range request each, reads over 4 blocks go straight through; without `size` it
stats first and returns a Promise — always safe to await), `upload(mount, rel, body, { overwrite })` (Blob, Uint8Array,
ArrayBuffer or string), `watch(since, { timeout, signal })`. Non-2xx answers throw `FileApiError` with `.status`,
`.code` and `.body`.

## Security notes

- **Containment**: every path is decoded per segment, normalized by `normRel` (refuses `..`, NUL and control characters,
  `:` anywhere — drive letters and NTFS alternate data streams —, absolute paths, Windows device names, trailing dots and
  spaces, `< > " | ? *` on Windows) and resolved by `resolveSafe`: the real path (`fs.realpathSync`) of the target, or of
  its deepest existing ancestor for uploads, must be inside the real path of the mount root. Symlinks and junctions
  that leave the mount are refused (403) and not listed; ones inside are followed.
- Single-file mounts expose their file only, never siblings.
- **Hidden names are not a protection**: they are hidden from listings by default, but `hidden=1` shows them and raw
  serves them by path. Do not mount folders that contain secrets (`.git`, `.ssh`, key files): mount the media folders
  themselves. Uploads never write hidden names.
- Mount management (`POST mounts`, `grant`, absolute paths in `GET mounts`) needs the owner scope; give readers and
  writers their own tokens. `?t=` query tokens work only for GET / HEAD of raw and thumb; they can appear in logs and
  browser history, so prefer reader tokens there. Answers send `Referrer-Policy: no-referrer`.
- An open (`openAuth`) server must be reachable only by the app: bind it to 127.0.0.1, set `hosts` to the loopback
  names (DNS rebinding), keep `cors.origins` to the app's own origin. Foreign-origin writes are refused regardless.
- Raw files are served with a sandboxing CSP and `nosniff`, so an HTML or SVG file of the user opened directly cannot
  script the app's origin.
- Remaining races: the containment check runs before the file is opened, so a local user who can swap a folder for a
  link between the two could redirect one request; anyone with that access can read the files anyway. On Windows,
  8.3 short names (`PROGRA~1`) are not normalized; they still resolve inside the mount.

## Limits

- Listings stop at `listLimit` (50 000) entries (`truncated: true`); the entries of one folder are stat()ed with 32 in
  flight. No pagination beyond `limit`.
- Multiple ranges are answered with the first satisfiable range, never as `multipart/byteranges`.
- Uploads: one request per file, at most `uploadLimit` (2 GB) bytes, no resumable uploads; only folder mounts are
  writable.
- The thumbnail cache is never pruned (keys change with the file, old files stay); failures are remembered until the
  process restarts.
- Watching depends on `fs.watch`: network shares and some file systems report nothing, Linux before Node 20 has no
  recursive watching, events may be duplicated or coarse ('rename' for creations and deletions alike). The buffer holds
  1000 events; clients older than that get `reset`.
- Unicode normalization (NFC / NFD, macOS) is not unified: names are used as the file system returns them.
