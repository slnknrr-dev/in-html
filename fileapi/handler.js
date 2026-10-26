// fileapi/handler.js - the file API over HTTP: folders and single files of the machine ("mounts") listed, read with
// byte ranges, uploaded, thumbnailed and watched, for Node's http request / response objects. Backends mount it below
// a prefix of their choice (hosting.js backends, development servers, an Electron main process). Pure module: Node's
// fs and path come in through `opts.node` (bundled backends cannot import node: modules).
//
//   createFileApi(opts) -> {
//     handle(req, res, url, rest) -> Promise<boolean>   answers one request; `rest` is the path below the API prefix
//                                    (e.g. 'list/<m>/Music/A%20B'), still percent-encoded; true when answered
//                                    (always, unless rest is null / undefined)
//     mounts() -> [mount]            every mount with its absolute path
//     addMount(absPath, { name, writable, kind, persist = true }) -> mount   (throws an error with .status / .code)
//     removeMount(id) -> boolean     (throws for fixed mounts)
//     resolve(mountId, rel) -> absolute path | null
//     grant(paths, { writable, persist }) -> [{ mount, path, dir }]   (see POST grant)
//     close()                        stops the watchers and answers pending long polls
//   }
//   mount = { id, name, path, writable, kind: 'dir' | 'file', fixed, temporary, available }
//
// opts = {
//   node: { fs, path },                     required
//   authorize: (req, scope, url, { op }) -> boolean | 'unauthenticated' (or a Promise of it), required: auth.js
//   platform: 'win32' | 'linux' | 'darwin', default process.platform
//   storage: { read(key), write(key, value) } | null   added mounts persist under the key 'fileapi.mounts'
//   mounts: [{ path, name, writable = false, fixed = true }]   owner-configured roots (fixed ones cannot be removed)
//   cors: { origins: ['*'] | ['null', 'https://a.example'] | [] }
//   hosts: ['127.0.0.1', 'localhost']       optional Host header allowlist (DNS rebinding); [] = any host
//   thumbs: { dir, make: async (absPath, size, kind) -> { type, bytes } | null, concurrency = 2 } | null
//   watch: false, uploadLimit: 2 GB (0 = uploads off), listLimit: 50000, log: (...a) => {}
// }
//
// Endpoints (`<m>` mount id, `<path>` percent-encoded relative path, segments joined by '/'); JSON answers carry
// `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`; errors are { error, code } (README.md lists them):
//   GET    info                         { api, version, mounts, features: { upload, thumbs, watch }, scopes, limits }
//   GET    mounts                       [mount] (path only for the owner)      POST mounts { path, name?, writable? }
//   GET    mounts/<m>                   one mount                              DELETE mounts/<m> (owner, not fixed)
//   POST   grant { paths, writable?, persist? }   (owner) -> [{ mount, path, dir }] (an { error, code } item per failure)
//   GET    list/<m>/<path>?recursive=1&depth=N&glob=&exclude=&hidden=1&dirs=0&limit=N -> { mount, path, entries, truncated }
//   GET    stat/<m>/<path>              entry + ctime, birthtime, ino (string)
//   GET    raw/<m>/<path>[?download=1]  bytes: ranges, ETag, Last-Modified, 304, 206, 416      HEAD too
//   PUT    raw/<m>/<path>?overwrite=0|1 (write) the body becomes the file -> entry (201 new, 200 replaced)
//   GET    thumb/<m>/<path>?size=128..1024   cached thumbnail
//   GET    watch?since=<seq>&timeout=<s> long poll { seq, events: [{ seq, mount, path, type }] } | { reset: true, seq }
//   OPTIONS *                            CORS preflight

//
// Security model (each layer assumes the others may fail):
//   1. Host allowlist - defeats DNS rebinding against a localhost server (an attacker domain resolving to 127.0.0.1
//      sends its own Host header, which is refused).
//   2. Origin check on every non-GET even without CORS preflight - "simple" cross-site POSTs (text/plain forms)
//      never reach an endpoint that changes state.
//   3. authorize() per endpoint with an explicit scope; 401 vs 403 distinguish "no token" from "not enough".
//   4. Path safety (paths.js): string rejection, then realpath containment. Errors never echo machine paths.
//   5. Served files get nosniff + a sandboxing CSP, so a user's HTML/SVG opened through raw/ cannot run script in
//      the API's origin and steal the token.
// Uploads are written to a temp file in the target folder and moved into place, so a reader never sees a half file
// and a failed upload leaves nothing behind.

import { normRel, resolveSafe, isHiddenName, isInside, mountId, fnv64, compareNames, baseName } from './paths.js';
import { matchAny } from './glob.js';
import { parseRange, contentRange } from './range.js';
import { typeOf, kindOf } from './types.js';

export const API_NAME = 'in-html-fileapi';
export const API_VERSION = 1;
export const MOUNTS_KEY = 'fileapi.mounts';

const ALLOW_HEADERS = 'Authorization, Range, Content-Type, If-None-Match, If-Modified-Since, If-Range';
const ALLOW_METHODS = 'GET, HEAD, PUT, POST, DELETE, OPTIONS';
const EXPOSE_HEADERS = 'Content-Range, Accept-Ranges, Content-Length, ETag, Content-Type, Content-Disposition, Last-Modified';
// Files of the user opened directly as documents (HTML, SVG) run sandboxed, without scripts or requests.
const RAW_CSP = "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox";
const THUMB_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif', 'image/svg+xml': 'svg' };
const THUMB_EXT = Object.fromEntries(Object.entries(THUMB_TYPES).map(([t, e]) => [e, t]));

export class ApiError extends Error {
  constructor(status, code, message, headers) {
    super(message || code);
    this.status = status;
    this.code = code;
    if (headers) this.headers = headers;
  }
}

// File system errors as API errors; the messages never contain paths of the machine.
const FS_ERRORS = {
  ENOENT: [404, 'not-found', 'not found'], ENOTDIR: [404, 'not-found', 'not found'], EACCES: [403, 'forbidden', 'permission denied'],
  EPERM: [403, 'forbidden', 'operation not permitted'], EISDIR: [400, 'is-directory', 'is a folder'], EEXIST: [409, 'exists', 'already exists'],
  ENOTEMPTY: [409, 'exists', 'folder not empty'], EBUSY: [409, 'busy', 'the file is in use'], ENOSPC: [507, 'no-space', 'no space left on the device'],
  EDQUOT: [507, 'no-space', 'disk quota exceeded'], EROFS: [403, 'not-writable', 'read-only file system'], ENAMETOOLONG: [400, 'bad-path', 'name too long'],
  EINVAL: [400, 'bad-path', 'invalid path'], ELOOP: [400, 'bad-path', 'too many symbolic links'], EMFILE: [503, 'busy', 'too many open files'],
  ECONNRESET: [400, 'aborted', 'request aborted'],
};

function toApiError(e) {
  if (e instanceof ApiError) return e;
  const f = e && FS_ERRORS[e.code];
  return f ? new ApiError(f[0], f[1], f[2]) : new ApiError(500, 'internal', 'internal error');
}

const utf8 = new TextEncoder();

function randomHex(n = 8) {
  const b = new Uint8Array(n);
  if (globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(b);
  else for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

// Bounded parallelism without a library: n workers pull the next index from a shared counter. Safe without locks
// because `i++` runs synchronously between awaits (single-threaded event loop).
async function eachLimit(items, n, fn) {
  let i = 0;
  const worker = async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

function concat(chunks, n) {
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

function readJSON(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0, failed = false;
    req.on('data', (c) => {
      if (failed) return;
      n += c.length;
      if (n > limit) { failed = true; req.resume(); reject(new ApiError(413, 'too-large', 'request body too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (failed) return;
      try {
        const text = new TextDecoder().decode(concat(chunks, n));
        resolve(text.trim() ? JSON.parse(text) : {});
      } catch { reject(new ApiError(400, 'bad-request', 'invalid JSON')); }
    });
    req.on('error', (e) => { if (!failed) { failed = true; reject(e); } });
  });
}

async function writeAll(fh, buf) {
  let off = 0;
  while (off < buf.length) {
    const { bytesWritten } = await fh.write(buf, off, buf.length - off);
    if (!bytesWritten) throw new Error('write failed');
    off += bytesWritten;
  }
}

// Streams a request body into an open file, at most `limit` bytes (413 beyond, the rest is discarded).
// Backpressure by hand: pause the request on every chunk and resume only after the write finished, so a fast client
// on a slow disk cannot buffer gigabytes in memory. Writes are chained on one promise to keep them in order.
// 'close' without `complete` = the client disconnected mid-upload -> ECONNRESET so the caller deletes the temp file.
function receive(req, fh, limit) {
  return new Promise((resolve, reject) => {
    let n = 0, failed = false, chain = Promise.resolve();
    const stop = (e) => { if (failed) return; failed = true; req.resume(); reject(e); };
    if (req.destroyed) { stop(Object.assign(new Error('upload aborted'), { code: 'ECONNRESET' })); return; }
    req.on('data', (chunk) => {
      if (failed) return;
      n += chunk.length;
      if (n > limit) { stop(new ApiError(413, 'too-large', 'the upload is larger than the limit', { Connection: 'close' })); return; }
      req.pause();
      chain = chain.then(() => writeAll(fh, chunk)).then(() => { if (!failed) req.resume(); }, stop);
    });
    req.on('end', () => { chain.then(() => { if (!failed) resolve(n); }); });
    req.on('error', stop);
    req.on('close', () => { if (!req.complete) stop(Object.assign(new Error('upload aborted'), { code: 'ECONNRESET' })); });
  });
}

const opaqueTag = (t) => t.trim().replace(/^W\//, '');
const sameTag = (a, b) => opaqueTag(a) === opaqueTag(b);

// RFC 9110 precedence: If-None-Match, when present, decides alone (If-Modified-Since is ignored). Weak comparison
// for If-None-Match is what the RFC prescribes. HTTP dates have 1-second resolution, hence mtime floored to seconds.
function notModified(req, etag, mtime) {
  const inm = req.headers['if-none-match'];
  if (inm) return inm.trim() === '*' || inm.split(',').some((t) => sameTag(t, etag));
  const ims = req.headers['if-modified-since'];
  if (ims) { const t = Date.parse(ims); return Number.isFinite(t) && Math.floor(mtime / 1000) * 1000 <= t; }
  return false;
}

// If-Range: the range applies only when the validator still matches (weak tags compared leniently, see README).
function ifRangeOk(req, etag, mtime) {
  const ir = String(req.headers['if-range'] || '').trim();
  if (!ir) return true;
  if (ir.startsWith('"') || ir.startsWith('W/')) return sameTag(ir, etag);
  const t = Date.parse(ir);
  return Number.isFinite(t) && t === Math.floor(mtime / 1000) * 1000;
}

// RFC 6266: an ASCII fallback in filename="..." (quotes, backslash and '%' replaced so the quoted string cannot be
// broken or misread as encoded) plus the exact name in filename*=UTF-8''... (RFC 8187 percent-encoding, where
// encodeURIComponent leaves ' ( ) * unescaped and they must be encoded by hand). Header injection is impossible
// because control characters never survive either form.
function disposition(kind, name) {
  const ascii = name.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  const ext = encodeURIComponent(name).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${ext}`;
}

const hostName = (host) => String(host || '').trim().toLowerCase().replace(/:\d+$/, '').replace(/^\[(.*)\]$/, '$1');

export function createFileApi(opts = {}) {
  const { node, storage = null, authorize, cors = null, thumbs = null, watch = false, log = () => {} } = opts;
  if (!node || !node.fs || !node.path) throw new TypeError('fileapi: opts.node = { fs, path } is required');
  if (typeof authorize !== 'function') throw new TypeError('fileapi: opts.authorize is required (tokenAuth(...) or openAuth() from auth.js)');
  const { fs, path } = node;
  const fsp = fs.promises;
  const platform = opts.platform || (globalThis.process && globalThis.process.platform) || 'linux';
  const uploadLimit = opts.uploadLimit === undefined || opts.uploadLimit === null ? 2 * 1024 ** 3 : Math.max(0, Number(opts.uploadLimit) || 0);
  const listLimit = Math.max(1, Number(opts.listLimit) || 50000);
  const origins = cors && Array.isArray(cors.origins) ? cors.origins.map(String) : [];
  const anyOrigin = origins.includes('*');
  const hosts = Array.isArray(opts.hosts) ? opts.hosts.map((h) => hostName(h)) : [];
  const thumbsOn = !!(thumbs && typeof thumbs.make === 'function' && thumbs.dir);
  const thumbConcurrency = Math.max(1, (thumbs && thumbs.concurrency) | 0 || 2);
  const fold = platform === 'win32' ? (s) => s.toLowerCase() : (s) => s;
  const nodeMods = { fs, path };

  // --- mounts -------------------------------------------------------------------------------------------------

  const table = new Map(); // id -> { id, name, path, writable, kind, fixed, persist }

  const statKind = (abs) => {
    try { const st = fs.statSync(abs); return st.isDirectory() ? 'dir' : st.isFile() ? 'file' : null; } catch { return undefined; }
  };
  const defaultName = (abs) => path.basename(abs) || abs.replace(/[\\/]+$/, '') || abs;
  const cleanName = (name, abs) => String(name || defaultName(abs)).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200) || defaultName(abs);

  function view(m, withPath) {
    const v = { id: m.id, name: m.name, writable: m.writable, kind: m.kind, fixed: m.fixed, temporary: !m.fixed && !m.persist, available: statKind(m.path) === m.kind };
    if (withPath) v.path = m.path;
    return v;
  }

  for (const c of opts.mounts || []) {
    if (!c || typeof c.path !== 'string' || !c.path) continue;
    const p = path.resolve(c.path);
    const m = { id: mountId(p, platform), name: cleanName(c.name, p), path: p, writable: !!c.writable, kind: statKind(p) || c.kind || 'dir', fixed: c.fixed !== false, persist: false };
    table.set(m.id, m);
  }
  if (storage) {
    let saved = null;
    try { saved = storage.read(MOUNTS_KEY); } catch (e) { log('fileapi: cannot read the mounts', e && e.message); }
    for (const s of Array.isArray(saved) ? saved : []) {
      if (!s || typeof s.path !== 'string' || !path.isAbsolute(s.path)) continue;
      const p = path.resolve(s.path);
      const id = mountId(p, platform);
      if (table.has(id)) continue;
      table.set(id, { id, name: cleanName(s.name, p), path: p, writable: !!s.writable, kind: statKind(p) || (s.kind === 'file' ? 'file' : 'dir'), fixed: false, persist: true });
    }
  }

  function save() {
    if (!storage) return;
    const list = [...table.values()].filter((m) => !m.fixed && m.persist).map((m) => ({ path: m.path, name: m.name, writable: m.writable, kind: m.kind }));
    try { storage.write(MOUNTS_KEY, list); } catch (e) { log('fileapi: cannot save the mounts', e && e.message); }
  }

  function checkAbs(p) {
    if (typeof p !== 'string' || !p || /[\x00-\x1f]/.test(p) || !path.isAbsolute(p)) throw new ApiError(400, 'bad-path', 'an absolute path is required');
    return path.resolve(p);
  }

  function addMount(absPath, { name, writable, kind, persist = true } = {}) {
    const p = checkAbs(absPath);
    const k = statKind(p);
    if (k === undefined) throw new ApiError(404, 'not-found', 'no such file or folder');
    if (k === null) throw new ApiError(400, 'bad-path', 'not a regular file or folder');
    if (kind && kind !== k) throw new ApiError(400, 'bad-path', kind === 'dir' ? 'not a folder' : 'not a file');
    const id = mountId(p, platform);
    const cur = table.get(id);
    if (cur) {
      if (!cur.fixed) {
        if (name) cur.name = cleanName(name, p);
        if (writable !== undefined) cur.writable = !!writable;
        if (persist) cur.persist = true;
        cur.kind = k;
        if (cur.persist) save();
      }
      return view(cur, true);
    }
    const m = { id, name: cleanName(name, p), path: p, writable: !!writable, kind: k, fixed: false, persist: !!persist };
    table.set(id, m);
    if (m.persist) save();
    if (W.started) watchMount(m);
    log(`fileapi: mount ${id} added (${k}${m.writable ? ', writable' : ''})`);
    return view(m, true);
  }

  function removeMount(id) {
    const m = table.get(id);
    if (!m) return false;
    if (m.fixed) throw new ApiError(403, 'fixed', 'this mount is configured by the owner and cannot be removed');
    table.delete(id);
    unwatchMount(id);
    save();
    return true;
  }

  // A mount that contains the absolute path (the deepest folder mount, else a single-file mount of exactly it).
  // Reusing an existing mount keeps grant() idempotent: dropping the same file twice must not create two mounts.
  // The relative path must survive normRel unchanged and pass resolveSafe - otherwise the file would be "inside"
  // a mount yet unreachable through the API, and a fresh mount is created instead.
  function findContaining(abs, k) {
    let best = null, bestRel = '';
    for (const m of table.values()) {
      if (m.kind !== 'dir') continue;
      const r = path.relative(m.path, abs);
      if (r === '..' || r.startsWith('..' + path.sep) || path.isAbsolute(r)) continue;
      const rel = r.split(path.sep).join('/');
      if (normRel(rel, { platform }) !== rel) continue;
      if (!resolveSafe(nodeMods, m.path, rel, { allowHidden: true, platform })) continue;
      if (!best || m.path.length > best.path.length) { best = m; bestRel = rel; }
    }
    if (best) return { mount: best, rel: bestRel };
    if (k === 'file') {
      for (const m of table.values()) if (m.kind === 'file' && fold(m.path) === fold(abs)) return { mount: m, rel: path.basename(m.path) };
    }
    return null;
  }

  function grant(paths, { writable = false, persist = true } = {}) {
    if (!Array.isArray(paths)) throw new ApiError(400, 'bad-request', 'paths must be an array of absolute paths');
    if (paths.length > 10000) throw new ApiError(413, 'too-large', 'too many paths');
    return paths.map((input) => {
      try {
        const abs = checkAbs(input);
        const k = statKind(abs);
        if (k === undefined) throw new ApiError(404, 'not-found', 'no such file or folder');
        if (k === null) throw new ApiError(400, 'bad-path', 'not a regular file or folder');
        const found = findContaining(abs, k);
        if (found) return { mount: found.mount.id, path: found.rel, dir: k === 'dir' };
        const m = addMount(abs, { writable: !!writable, persist });
        return { mount: m.id, path: k === 'file' ? path.basename(abs) : '', dir: k === 'dir' };
      } catch (e) {
        const err = toApiError(e);
        return { mount: null, path: null, dir: false, error: err.message, code: err.code };
      }
    });
  }

  // Mount + relative path -> { mount, rel, abs, root } (abs is null for the root of a single-file mount).
  function locate(id, rel) {
    const m = table.get(id);
    if (!m) throw new ApiError(404, 'not-found', 'unknown mount');
    const n = normRel(rel, { platform });
    if (n === null) throw new ApiError(400, 'bad-path', 'unsafe path');
    if (m.kind === 'file') {
      const name = path.basename(m.path);
      if (n === '') return { mount: m, rel: '', abs: null, root: true };
      if (fold(n) !== fold(name)) throw new ApiError(404, 'not-found', 'not found');
      return { mount: m, rel: name, abs: m.path, root: false };
    }
    const abs = resolveSafe(nodeMods, m.path, n, { allowHidden: true, platform });
    if (!abs) {
      if (statKind(m.path) !== 'dir') throw new ApiError(404, 'not-found', 'the mount is not available');
      throw new ApiError(403, 'forbidden', 'the path leads outside the mount');
    }
    return { mount: m, rel: n, abs, root: n === '' };
  }

  function resolve(id, rel = '') {
    try { return locate(id, rel).abs; } catch { return null; }
  }

  const entryOf = (name, rel, st) => {
    const dir = st.isDirectory();
    return { name, path: rel, dir, size: dir ? 0 : Number(st.size), mtime: Math.floor(Number(st.mtimeMs)), type: dir ? '' : typeOf(name), kind: dir ? 'dir' : kindOf(name) };
  };

  // --- responses ----------------------------------------------------------------------------------------------

  // Vary: Origin is sent whenever CORS is configured, even on refusals, so a shared cache never serves one origin's
  // answer (with its Allow-Origin) to another. The allowed origin is echoed, never reflected unchecked.
  function corsHeaders(req) {
    if (!origins.length) return {};
    const origin = req.headers.origin;
    const h = { Vary: 'Origin' };
    if (!origin || !(anyOrigin || origins.includes(origin))) return h;
    return {
      ...h, 'Access-Control-Allow-Origin': anyOrigin ? '*' : origin, 'Access-Control-Allow-Headers': ALLOW_HEADERS,
      'Access-Control-Allow-Methods': ALLOW_METHODS, 'Access-Control-Expose-Headers': EXPOSE_HEADERS, 'Access-Control-Max-Age': '600',
    };
  }

  function sendJSON(ctx, status, value, extra) {
    const body = utf8.encode(JSON.stringify(value));
    ctx.res.writeHead(status, {
      ...ctx.cors, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...extra,
    });
    ctx.res.end(ctx.head ? undefined : body);
  }

  async function auth(ctx, scope, op) {
    const a = await authorize(ctx.req, scope, ctx.url, { op });
    if (a === true) return;
    if (a === 'unauthenticated') throw new ApiError(401, 'unauthorized', 'a token is required', { 'WWW-Authenticate': 'Bearer' });
    throw new ApiError(403, 'forbidden', scope === 'read' ? 'access denied' : `the ${scope} scope is required`);
  }

  const allowed = (ctx, list) => {
    if (!list.includes(ctx.req.method)) throw new ApiError(405, 'method', 'method not allowed', { Allow: list.join(', ') });
  };

  function decodeSeg(s) {
    try { return decodeURIComponent(s); } catch { throw new ApiError(400, 'bad-path', 'invalid percent-encoding'); }
  }

  // --- endpoints ----------------------------------------------------------------------------------------------

  async function info(ctx) {
    const base = { api: API_NAME, version: API_VERSION };
    const a = await authorize(ctx.req, 'read', ctx.url, { op: 'info' });
    if (a !== true) {
      const s = a === 'unauthenticated' ? 401 : 403;
      sendJSON(ctx, s, { ...base, auth: true, error: s === 401 ? 'a token is required' : 'access denied', code: s === 401 ? 'unauthorized' : 'forbidden' },
        s === 401 ? { 'WWW-Authenticate': 'Bearer' } : undefined);
      return;
    }
    const scopes = ['read'];
    if ((await authorize(ctx.req, 'write', ctx.url, { op: 'info' })) === true) scopes.push('write');
    if ((await authorize(ctx.req, 'owner', ctx.url, { op: 'info' })) === true) scopes.push('owner');
    sendJSON(ctx, 200, { ...base, mounts: table.size, features: { upload: uploadLimit > 0, thumbs: thumbsOn, watch: !!watch }, scopes, limits: { upload: uploadLimit, list: listLimit } });
  }

  async function isOwner(ctx, op) { return (await authorize(ctx.req, 'owner', ctx.url, { op })) === true; }

  // Depth-first walk with: per-folder parallel stat (32 at a time - readdir gives names, stat is the slow part),
  // deterministic order (folders first, natural sort), symlinks followed only inside the mount, a `seen` set of real
  // paths so link loops terminate, and a hard entry limit reported as `truncated` instead of an unbounded response.
  // Unreadable subfolders are skipped silently; only the requested folder itself raises an error.
  async function list(ctx, id, rel) {
    const q = ctx.url.searchParams;
    const loc = locate(id, rel);
    let maxDepth = 1;
    const dq = q.get('depth');
    if (dq !== null && dq !== '') {
      const d = Number(dq);
      if (!Number.isInteger(d) || d < 1) throw new ApiError(400, 'bad-request', 'depth must be a positive integer');
      maxDepth = d;
    } else if (q.get('recursive') === '1' || q.get('recursive') === 'true') maxDepth = Infinity;
    const lq = Number(q.get('limit'));
    const o = {
      hidden: q.get('hidden') === '1', dirs: q.get('dirs') !== '0', maxDepth,
      include: q.getAll('glob').filter(Boolean), exclude: q.getAll('exclude').filter(Boolean),
      limit: Number.isInteger(lq) && lq > 0 ? Math.min(lq, listLimit) : listLimit,
    };
    if (loc.mount.kind === 'file') {
      if (!loc.root) throw new ApiError(400, 'not-a-directory', 'not a folder');
      const st = await fsp.stat(loc.mount.path);
      const name = path.basename(loc.mount.path);
      const keep = (!o.include.length || matchAny(name, o.include)) && !matchAny(name, o.exclude);
      sendJSON(ctx, 200, { mount: id, path: '', entries: keep ? [entryOf(name, name, st)] : [], truncated: false });
      return;
    }
    const st = await fsp.stat(loc.abs);
    if (!st.isDirectory()) throw new ApiError(400, 'not-a-directory', 'not a folder');
    const rootReal = fs.realpathSync(loc.mount.path);
    const startReal = fs.realpathSync(loc.abs);
    const out = [];
    let truncated = false;
    const seen = new Set([fold(startReal)]);
    const push = (e) => { if (out.length >= o.limit) { truncated = true; return false; } out.push(e); return true; };

    const visit = async (abs, relDir, real, level) => {
      let names;
      try { names = await fsp.readdir(abs, { withFileTypes: true }); } catch (e) { if (level === 1) throw e; return; }
      const items = [];
      await eachLimit(names, 32, async (d) => {
        const name = d.name;
        if (!o.hidden && isHiddenName(name)) return;
        const r = relDir ? relDir + '/' + name : name;
        if (normRel(r, { platform }) !== r) return; // names the API could not address
        if (o.exclude.length && matchAny(r, o.exclude)) return;
        const a = path.join(abs, name);
        let st2, childReal = path.join(real, name);
        try {
          if (d.isSymbolicLink()) {
            // Links are followed only when their target stays inside the mount.
            childReal = fs.realpathSync(a);
            if (!isInside(rootReal, childReal, platform, path.sep)) return;
          }
          st2 = await fsp.stat(a);
        } catch { return; }
        const isDir = st2.isDirectory();
        if (!isDir && !st2.isFile()) return;
        items.push({ name, rel: r, abs: a, real: childReal, st: st2, isDir });
      });
      items.sort((x, y) => (x.isDir === y.isDir ? compareNames(x.name, y.name) : x.isDir ? -1 : 1));
      for (const it of items) {
        if (truncated) return;
        if (it.isDir) {
          if (o.dirs && !push(entryOf(it.name, it.rel, it.st))) return;
          if (level < o.maxDepth) {
            const key = fold(it.real);
            if (seen.has(key)) continue;
            seen.add(key);
            await visit(it.abs, it.rel, it.real, level + 1);
          }
        } else if (!o.include.length || matchAny(it.rel, o.include)) {
          if (!push(entryOf(it.name, it.rel, it.st))) return;
        }
      }
    };
    await visit(loc.abs, loc.rel, startReal, 1);
    sendJSON(ctx, 200, { mount: id, path: loc.rel, entries: out, truncated });
  }

  async function stat(ctx, id, rel) {
    const loc = locate(id, rel);
    const target = loc.abs || loc.mount.path;
    const st = await fsp.stat(target, { bigint: true });
    const virtualRoot = !loc.abs; // the root of a single-file mount: a folder with one entry
    const name = loc.root ? loc.mount.name : baseName(loc.rel);
    const e = virtualRoot
      ? { name, path: '', dir: true, size: 0, mtime: Number(st.mtimeMs), type: '', kind: 'dir' }
      : entryOf(name, loc.rel, st);
    if (!virtualRoot) {
      e.ctime = Number(st.ctimeMs);
      if (st.birthtimeMs > 0n) e.birthtime = Number(st.birthtimeMs);
      if (st.ino > 0n) e.ino = st.ino.toString();
    }
    sendJSON(ctx, 200, { mount: id, ...e });
  }

  // Weak ETag from size + mtime (no hashing of possibly huge media). 'private, no-cache' = the browser may store the
  // bytes but must revalidate (cheap 304), and shared caches must not keep a user's private files.
  // The stream is opened from the same file handle when possible, and destroyed if the client goes away, so an
  // aborted video seek does not keep reading gigabytes into a closed socket.
  async function rawGet(ctx, id, rel) {
    const { req, res } = ctx;
    const loc = locate(id, rel);
    if (!loc.abs) throw new ApiError(400, 'is-directory', 'is a folder');
    const st = await fsp.stat(loc.abs);
    if (st.isDirectory()) throw new ApiError(400, 'is-directory', 'is a folder');
    if (!st.isFile()) throw new ApiError(400, 'not-a-file', 'not a regular file');
    const size = st.size, mtime = Math.floor(st.mtimeMs);
    const etag = `W/"${size.toString(36)}-${mtime.toString(36)}"`;
    const base = {
      ...ctx.cors, 'Accept-Ranges': 'bytes', ETag: etag, 'Last-Modified': new Date(mtime).toUTCString(), 'Cache-Control': 'private, no-cache',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': RAW_CSP,
    };
    if (notModified(req, etag, mtime)) { res.writeHead(304, base); res.end(); return; }
    const name = path.basename(loc.abs);
    const headers = { ...base, 'Content-Type': typeOf(name), 'Content-Disposition': disposition(ctx.url.searchParams.get('download') === '1' ? 'attachment' : 'inline', name) };
    let start = 0, end = size - 1, status = 200;
    if (req.headers.range && ifRangeOk(req, etag, mtime)) {
      const r = parseRange(req.headers.range, size);
      if (r === 'unsatisfiable') throw new ApiError(416, 'bad-range', 'range not satisfiable', { 'Content-Range': contentRange(null, null, size), 'Accept-Ranges': 'bytes' });
      if (r) { start = r.start; end = r.end; status = 206; headers['Content-Range'] = contentRange(start, end, size); }
    }
    const length = size === 0 ? 0 : end - start + 1;
    headers['Content-Length'] = length;
    if (ctx.head || length === 0) { res.writeHead(status, headers); res.end(); return; }
    const fh = await fsp.open(loc.abs, 'r');
    let stream;
    if (typeof fh.createReadStream === 'function') stream = fh.createReadStream({ start, end });
    else { await fh.close(); stream = fs.createReadStream(loc.abs, { start, end }); }
    res.writeHead(status, headers);
    await new Promise((resolveDone) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolveDone(); } };
      stream.on('error', (e) => { log('fileapi: read error', e && e.code); res.destroy(); finish(); });
      res.on('close', () => { stream.destroy(); finish(); });
      res.on('finish', finish);
      stream.pipe(res);
    });
  }

  async function statOrNull(abs) {
    try { return await fsp.stat(abs); } catch (e) { if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return null; throw e; }
  }

  // Atomic "create if absent": link() fails with EEXIST if the name exists, which rename() would silently replace.
  // On file systems without hard links the fallback is check-then-rename, which has a small race window - documented
  // rather than hidden.
  async function commitNoClobber(tmp, abs) {
    try { await fsp.link(tmp, abs); } catch (e) {
      if (e && e.code === 'EEXIST') throw new ApiError(409, 'exists', 'the file exists (overwrite=1 replaces it)');
      // File systems without hard links (FAT, exFAT, some shares): check, then rename.
      if (await statOrNull(abs)) throw new ApiError(409, 'exists', 'the file exists (overwrite=1 replaces it)');
      await fsp.rename(tmp, abs);
      return;
    }
    await fsp.rm(tmp, { force: true });
  }

  async function rawPut(ctx, id, rel) {
    const { req, url } = ctx;
    if (!uploadLimit) throw new ApiError(403, 'uploads-off', 'uploads are turned off');
    const m = table.get(id);
    if (!m) throw new ApiError(404, 'not-found', 'unknown mount');
    if (!m.writable || m.kind !== 'dir') throw new ApiError(403, 'not-writable', 'the mount is read-only');
    const n = normRel(rel, { platform });
    if (n === null || n === '') throw new ApiError(400, 'bad-path', 'unsafe path');
    if (n.split('/').some(isHiddenName)) throw new ApiError(403, 'forbidden', 'hidden names cannot be written');
    const declared = req.headers['content-length'];
    if (declared !== undefined && Number(declared) > uploadLimit) {
      req.resume();
      throw new ApiError(413, 'too-large', 'the upload is larger than the limit', { Connection: 'close' });
    }
    const abs = resolveSafe(nodeMods, m.path, n, { platform });
    if (!abs) throw new ApiError(statKind(m.path) === 'dir' ? 403 : 404, statKind(m.path) === 'dir' ? 'forbidden' : 'not-found', 'the path leads outside the mount');
    const overwrite = url.searchParams.get('overwrite') === '1';
    const existing = await statOrNull(abs);
    if (existing && existing.isDirectory()) throw new ApiError(409, 'is-directory', 'a folder has this name');
    if (existing && (!overwrite || !existing.isFile())) throw new ApiError(409, 'exists', 'the file exists (overwrite=1 replaces it)');
    // resolveSafe runs again AFTER mkdir: the folders just created could not be checked before they existed, and a
    // concurrent symlink planted in between would otherwise redirect the write. The temp name is random and opened
    // with 'wx' (fail if it exists), so it can never clobber or follow an existing file.
    const dir = path.dirname(abs);
    await fsp.mkdir(dir, { recursive: true });
    if (!resolveSafe(nodeMods, m.path, n, { platform })) throw new ApiError(403, 'forbidden', 'the path leads outside the mount');
    const tmp = path.join(dir, `.fileapi-${randomHex()}.upload`);
    const fh = await fsp.open(tmp, 'wx');
    let closed = false;
    try {
      await receive(req, fh, uploadLimit);
      await fh.close();
      closed = true;
      if (overwrite) await fsp.rename(tmp, abs);
      else await commitNoClobber(tmp, abs);
    } catch (e) {
      if (!closed) await fh.close().catch(() => {});
      await fsp.rm(tmp, { force: true }).catch(() => {});
      throw e;
    }
    const st = await fsp.stat(abs);
    log(`fileapi: uploaded ${st.size} bytes to mount ${id}`);
    sendJSON(ctx, existing ? 200 : 201, { mount: id, ...entryOf(path.basename(abs), n, st) });
  }

  // --- thumbnails ---------------------------------------------------------------------------------------------

  // Thumbnail cache: content-addressed files named by fnv64(mount, path, size, mtime, file size) - a changed file gets
  // a new key, so there is no invalidation logic at all. `pending` coalesces concurrent requests for one key into one
  // make() call; `none` remembers failures (bounded) so a broken file is not re-decoded on every scroll; `limited`
  // is a tiny semaphore because thumbnail makers (ffmpeg, image decoders) are CPU/memory heavy. Writes go through a
  // temp name + rename so a crash never leaves a truncated thumbnail under the final name.
  const TH = { index: null, pending: new Map(), none: new Set(), active: 0, queue: [] };

  function thumbIndex() {
    if (!TH.index) {
      TH.index = (async () => {
        const map = new Map();
        try {
          for (const f of await fsp.readdir(thumbs.dir)) { const mm = /^([0-9a-f]{16})\.([a-z0-9]+)$/.exec(f); if (mm) map.set(mm[1], f); }
        } catch { /* no cache folder yet */ }
        return map;
      })();
    }
    return TH.index;
  }

  function limited(fn) {
    return new Promise((resolveRun, rejectRun) => {
      const run = () => {
        TH.active++;
        Promise.resolve().then(fn).then(resolveRun, rejectRun).finally(() => { TH.active--; const next = TH.queue.shift(); if (next) next(); });
      };
      if (TH.active < thumbConcurrency) run(); else TH.queue.push(run);
    });
  }

  async function thumbFile(key, abs, size, kind) {
    const index = await thumbIndex();
    const hit = index.get(key);
    if (hit) return path.join(thumbs.dir, hit);
    if (TH.none.has(key)) return null;
    let p = TH.pending.get(key);
    if (!p) {
      p = (async () => {
        let r = null;
        try { r = await limited(() => thumbs.make(abs, size, kind)); } catch (e) { log('fileapi: thumbnail failed', e && e.message); }
        if (!r || !r.bytes || !r.bytes.length) {
          if (TH.none.size > 20000) TH.none.clear();
          TH.none.add(key);
          return null;
        }
        const file = `${key}.${THUMB_TYPES[String(r.type || '').toLowerCase()] || 'bin'}`;
        await fsp.mkdir(thumbs.dir, { recursive: true });
        const tmp = path.join(thumbs.dir, `${file}.${randomHex()}.tmp`);
        await fsp.writeFile(tmp, r.bytes);
        await fsp.rename(tmp, path.join(thumbs.dir, file));
        index.set(key, file);
        return path.join(thumbs.dir, file);
      })().finally(() => TH.pending.delete(key));
      TH.pending.set(key, p);
    }
    return p;
  }

  async function thumb(ctx, id, rel) {
    if (!thumbsOn) throw new ApiError(404, 'no-thumb', 'thumbnails are turned off');
    const loc = locate(id, rel);
    if (!loc.abs) throw new ApiError(404, 'no-thumb', 'no thumbnail');
    const st = await fsp.stat(loc.abs);
    const dir = st.isDirectory();
    if (!dir && !st.isFile()) throw new ApiError(404, 'no-thumb', 'no thumbnail');
    let size = Number(ctx.url.searchParams.get('size') || 256);
    if (!Number.isFinite(size)) size = 256;
    size = Math.min(1024, Math.max(128, Math.ceil(size / 64) * 64));
    const key = fnv64([id, loc.rel, size, Math.floor(st.mtimeMs), dir ? 0 : st.size].join('\n'));
    const etag = `"${key}"`;
    const base = {
      ...ctx.cors, ETag: etag, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': RAW_CSP,
    };
    if (notModified(ctx.req, etag, Math.floor(st.mtimeMs)) && ctx.req.headers['if-none-match']) { ctx.res.writeHead(304, base); ctx.res.end(); return; }
    let bytes = null, file = null;
    for (let attempt = 0; attempt < 2 && !bytes; attempt++) {
      file = await thumbFile(key, loc.abs, size, dir ? 'dir' : kindOf(loc.abs));
      if (!file) break;
      try { bytes = await fsp.readFile(file); } catch { (await thumbIndex()).delete(key); }
    }
    if (!bytes) throw new ApiError(404, 'no-thumb', 'no thumbnail');
    ctx.res.writeHead(200, { ...base, 'Content-Type': THUMB_EXT[file.slice(file.lastIndexOf('.') + 1)] || 'application/octet-stream', 'Content-Length': bytes.length });
    ctx.res.end(ctx.head ? undefined : bytes);
  }

  // --- watching -----------------------------------------------------------------------------------------------

  // seq starts at the clock: a client that saw an earlier process gets { reset: true } instead of a silent gap.
  const W = { started: false, closed: false, watchers: new Map(), seq: Date.now(), buf: [], pending: new Map(), timer: null, waiters: new Set(), noted: false };

  // fs.watch fires bursts (an editor save = several events). Events are coalesced per (mount, path) for 300 ms,
  // 'rename' winning over 'change', then numbered. The ring buffer keeps the last 1000; a client further behind gets
  // { reset: true } and re-lists - correctness over completeness.
  function queueEvent(m, type, filename) {
    let rel = m.kind === 'file' ? path.basename(m.path) : filename === null || filename === undefined ? '' : String(filename).replace(/\\/g, '/');
    rel = rel.replace(/^\/+|\/+$/g, '');
    if (rel && (normRel(rel, { platform }) !== rel || rel.split('/').some(isHiddenName))) return;
    const key = m.id + '\0' + rel;
    const t = type === 'rename' ? 'rename' : 'change';
    W.pending.set(key, W.pending.get(key) === 'rename' ? 'rename' : t);
    if (!W.timer) W.timer = setTimeout(flush, 300);
  }

  function flush() {
    W.timer = null;
    for (const [key, type] of W.pending) {
      const i = key.indexOf('\0');
      W.buf.push({ seq: ++W.seq, mount: key.slice(0, i), path: key.slice(i + 1), type });
    }
    W.pending.clear();
    if (W.buf.length > 1000) W.buf.splice(0, W.buf.length - 1000);
    for (const wake of [...W.waiters]) wake();
  }

  function watchMount(m) {
    if (!W.started || W.closed || W.watchers.has(m.id)) return;
    const onEvent = (type, filename) => queueEvent(m, type, filename);
    let w;
    try {
      if (m.kind === 'file') w = fs.watch(m.path, { persistent: false }, onEvent);
      else {
        try { w = fs.watch(m.path, { recursive: true, persistent: false }, onEvent); } catch (e) {
          if (!e || (e.code !== 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM' && e.code !== 'ERR_INVALID_ARG_VALUE')) throw e;
          if (!W.noted) { W.noted = true; log('fileapi: recursive fs.watch is not available on this platform / Node version; only top-level changes of folder mounts are reported'); }
          w = fs.watch(m.path, { persistent: false }, onEvent);
        }
      }
    } catch (e) { log(`fileapi: cannot watch mount ${m.id}`, e && e.code); return; }
    w.on('error', (e) => {
      log(`fileapi: watcher of mount ${m.id} failed`, e && e.code);
      try { w.close(); } catch { /* closed */ }
      if (W.watchers.get(m.id) === w) W.watchers.delete(m.id);
    });
    W.watchers.set(m.id, w);
  }

  function unwatchMount(id) {
    const w = W.watchers.get(id);
    if (w) { try { w.close(); } catch { /* closed */ } W.watchers.delete(id); }
  }

  function startWatch() {
    if (W.closed) return;
    W.started = true;
    for (const m of table.values()) watchMount(m);
  }

  // Long poll instead of WebSocket/SSE: works through every proxy and with the same auth as other GETs. The timeout
  // is capped at 30 s, under common proxy idle limits. The waiter is removed both on wake-up and on client close so
  // abandoned polls do not accumulate.
  async function watchOp(ctx) {
    if (!watch) throw new ApiError(404, 'no-watch', 'watching is turned off');
    startWatch();
    const q = ctx.url.searchParams;
    let timeout = q.get('timeout') === null || q.get('timeout') === '' ? 25 : Number(q.get('timeout'));
    if (!Number.isFinite(timeout)) timeout = 25;
    timeout = Math.min(30, Math.max(0, timeout));
    const sq = q.get('since');
    if (sq === null || sq === '') { sendJSON(ctx, 200, { seq: W.seq, events: [] }); return; }
    const since = Number(sq);
    if (!Number.isFinite(since)) throw new ApiError(400, 'bad-request', 'since must be a number');
    const stale = () => since > W.seq || since < (W.buf.length ? W.buf[0].seq : W.seq + 1) - 1;
    const pick = () => W.buf.filter((e) => e.seq > since);
    if (stale()) { sendJSON(ctx, 200, { reset: true, seq: W.seq, events: [] }); return; }
    let events = pick();
    if (!events.length && timeout > 0 && !W.closed) {
      await new Promise((resolveWait) => {
        let timer = null;
        const wake = () => { clearTimeout(timer); W.waiters.delete(wake); resolveWait(); };
        timer = setTimeout(wake, timeout * 1000);
        W.waiters.add(wake);
        ctx.res.on('close', wake);
      });
      if (ctx.res.destroyed || ctx.res.writableEnded) return;
      if (stale()) { sendJSON(ctx, 200, { reset: true, seq: W.seq, events: [] }); return; }
      events = pick();
    }
    sendJSON(ctx, 200, { seq: W.seq, events });
  }

  function close() {
    W.closed = true;
    for (const w of W.watchers.values()) { try { w.close(); } catch { /* closed */ } }
    W.watchers.clear();
    if (W.timer) { clearTimeout(W.timer); W.timer = null; }
    for (const wake of [...W.waiters]) wake();
  }

  // --- routing ------------------------------------------------------------------------------------------------

  function preflight(ctx) {
    const origin = ctx.req.headers.origin;
    if (origin && !ctx.cors['Access-Control-Allow-Origin']) throw new ApiError(403, 'forbidden', 'origin not allowed');
    const h = { ...ctx.cors, Allow: ALLOW_METHODS };
    if (ctx.cors['Access-Control-Allow-Origin'] && ctx.req.headers['access-control-request-private-network'] === 'true') h['Access-Control-Allow-Private-Network'] = 'true';
    ctx.res.writeHead(204, h);
    ctx.res.end();
  }

  function sameOrigin(origin, host) {
    try { return new URL(origin).host === String(host || '').toLowerCase(); } catch { return false; }
  }

  async function route(ctx, rest) {
    const { req } = ctx;
    if (hosts.length && !hosts.includes(hostName(req.headers.host))) throw new ApiError(403, 'forbidden', 'host not allowed');
    if (req.method === 'OPTIONS') { preflight(ctx); return; }
    // Writes from foreign pages are refused even when they need no preflight (text/plain POST, DNS rebinding).
    const origin = req.headers.origin;
    if (origin && req.method !== 'GET' && req.method !== 'HEAD' && !ctx.cors['Access-Control-Allow-Origin'] && !sameOrigin(origin, req.headers.host)) {
      throw new ApiError(403, 'forbidden', 'origin not allowed');
    }
    // Split on the RAW '/' first, then percent-decode each segment: a '%2F' inside a name decodes to '/' only after the
    // split and is then re-validated by normRel; decoding first would let encoded separators change the route.
    const segs = rest.split('/');
    const op = segs[0];
    const tail = () => segs.slice(2).map(decodeSeg).join('/');
    const mid = () => decodeSeg(segs[1] || '');
    switch (op) {
      case 'info':
        allowed(ctx, ['GET', 'HEAD']);
        return info(ctx);
      case 'mounts': {
        if (segs.length === 1 || (segs.length === 2 && segs[1] === '')) {
          allowed(ctx, ['GET', 'HEAD', 'POST']);
          if (req.method === 'POST') {
            await auth(ctx, 'owner', op);
            const body = await readJSON(req);
            if (!body || typeof body !== 'object') throw new ApiError(400, 'bad-request', 'expected { path, name?, writable? }');
            const m = addMount(body.path, { name: body.name, writable: body.writable === undefined ? undefined : !!body.writable, persist: body.persist !== false });
            sendJSON(ctx, 200, m);
            return;
          }
          await auth(ctx, 'read', op);
          const owner = await isOwner(ctx, op);
          sendJSON(ctx, 200, [...table.values()].map((m) => view(m, owner)));
          return;
        }
        if (segs.length > 2 && segs.slice(2).some(Boolean)) throw new ApiError(404, 'not-found', 'unknown endpoint');
        allowed(ctx, ['GET', 'HEAD', 'DELETE']);
        const id = mid();
        if (req.method === 'DELETE') {
          await auth(ctx, 'owner', op);
          if (!removeMount(id)) throw new ApiError(404, 'not-found', 'unknown mount');
          sendJSON(ctx, 200, { ok: true });
          return;
        }
        await auth(ctx, 'read', op);
        const m = table.get(id);
        if (!m) throw new ApiError(404, 'not-found', 'unknown mount');
        sendJSON(ctx, 200, view(m, await isOwner(ctx, op)));
        return;
      }
      case 'grant': {
        allowed(ctx, ['POST']);
        await auth(ctx, 'owner', op);
        const body = await readJSON(req);
        sendJSON(ctx, 200, grant(body && body.paths, { writable: !!(body && body.writable), persist: !(body && body.persist === false) }));
        return;
      }
      case 'list':
      case 'stat':
      case 'thumb':
        allowed(ctx, ['GET', 'HEAD']);
        await auth(ctx, 'read', op);
        return (op === 'list' ? list : op === 'stat' ? stat : thumb)(ctx, mid(), tail());
      case 'raw':
        allowed(ctx, ['GET', 'HEAD', 'PUT']);
        if (req.method === 'PUT') { await auth(ctx, 'write', op); return rawPut(ctx, mid(), tail()); }
        await auth(ctx, 'read', op);
        return rawGet(ctx, mid(), tail());
      case 'watch':
        allowed(ctx, ['GET']);
        await auth(ctx, 'read', op);
        return watchOp(ctx);
      default:
        throw new ApiError(404, 'not-found', 'unknown endpoint');
    }
  }

  async function handle(req, res, url, rest) {
    if (rest === undefined || rest === null) return false;
    if (!(url instanceof URL)) url = new URL(String(url || req.url || '/'), 'http://localhost');
    const ctx = { req, res, url, cors: corsHeaders(req), head: req.method === 'HEAD' };
    try {
      await route(ctx, String(rest).replace(/^\/+/, ''));
    } catch (e) {
      const err = toApiError(e);
      if (err.status >= 500) log('fileapi: error', req.method, err.code, e && (e.stack || e.message || e));
      if (!res.headersSent && !res.destroyed) {
        // A request body that was not read is discarded, so the connection can carry the answer.
        if (!req.complete && req.readableFlowing !== true) req.resume();
        sendJSON(ctx, err.status, { error: err.message, code: err.code }, err.headers);
      } else if (!res.writableEnded) res.destroy();
    }
    return true;
  }

  return {
    handle,
    mounts: () => [...table.values()].map((m) => view(m, true)),
    addMount,
    removeMount,
    resolve,
    grant,
    close,
  };
}
