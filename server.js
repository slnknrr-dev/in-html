// server.js - development server: static files like Codeberg/GitHub Pages, plus an optional in-memory
// mock JSON API for testing sync/requests. Vanilla Node or Bun, no dependencies, writes nothing to disk.
//
//   node server.js [port] [--api] [--host 0.0.0.0]     serves this repository (env PORT, HOST, API=1)
//
// Applications import shared libraries with ../ paths, so sources run from the repository root;
// each application has a tiny server.js instance: `import { serve } from '../server.js'; serve({ app: import.meta.url });`
//
// Static: GET/HEAD only (405 otherwise), no path traversal, dotfiles and dot-directories hidden,
// index.html for directories, /page -> /page.html, ETag / Last-Modified / 304, Cache-Control: no-cache,
// X-Content-Type-Options: nosniff. `x.js?bundle` answers the gzip-compressed module bundle of x.js (bundle.js
// assetBundle), exactly what `new URL('./x.js?bundle', import.meta.url)` inlines in a built page.
//
// Mock API (`api: true`), CORS * with preflight, JSON bodies up to 256 KB:
//   GET  /api/<key...>        stored document, or { updatedAt: 0 } when unknown
//   PUT  /api/<key...>        store the body (object) -> { ok, updatedAt }
//   POST /api/<key...>        store when the key holds a document, else append to the collection -> { ok, id, updatedAt }
//   POST /api/_down | _up     simulate an outage (every other /api call answers 503 while down)
//   GET  /api/_log            last 50 API requests
//
// Why serve the repository root (not the app folder): applications import shared libraries via ../ paths; serving only
// <app>/ would make every shared import 404. The dev server therefore mirrors the source tree 1:1 and runs unbundled
// ES modules, so a browser's devtools show real files and line numbers. The build (singlefile.js) is what removes
// the ../ dependency later. Differences from hosting.js are deliberate: Last-Modified + weak ETag (fs mtime is real
// here), streaming via createReadStream (repo files can be large), no gzip (localhost bandwidth is free, and gzip
// would hide Content-Length mismatches during debugging).

import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import url from 'node:url';
import events from 'node:events';
import stream from 'node:stream';
import child_process from 'node:child_process';
import nodeCrypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mimeOf } from './mime.js';

export const REPO = path.dirname(fileURLToPath(import.meta.url));
const BODY_LIMIT = 256 * 1024;

const statSafe = (p) => {
  try { return fs.statSync(p); } catch { return null; }
};

const baseHeaders = (extra) => ({ 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', ...extra });

function sendText(req, res, status, text, extra) {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(status, baseHeaders({ 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length, ...extra }));
  res.end(req.method === 'HEAD' ? undefined : body);
}

function sendJSON(req, res, status, value, extra) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  res.writeHead(status, baseHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, ...extra }));
  res.end(req.method === 'HEAD' ? undefined : body);
}

// ---------------------------------------------------------------------------------------------
// Static files

function staticHandler(root) {
  root = path.resolve(root);
  const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;

  // Decoded, normalized path inside root, or null when invalid / outside root / hidden.
  const resolveRequest = (rawPath) => {
    let decoded;
    try { decoded = decodeURIComponent(rawPath); } catch { return null; }
    if (decoded.includes('\0')) return null;
    // Backslashes normalised first: on Windows path.resolve treats '\' as a separator, so '/..\x' would otherwise slip
    // past a '/'-only segment check.
    const segs = decoded.replace(/\\/g, '/').split('/');
    // Dot segments (.., dotfiles, dot-dirs) are hidden. ':' blocks NTFS streams and drive-relative names.
    for (const s of segs) {
      if (s === '' || s === '.') continue;
      if (s.startsWith('.') || s.includes(':')) return null;
    }
    const rel = path.posix.normalize('/' + segs.join('/'));
    const abs = path.resolve(root, '.' + rel);
    if (abs !== root && !abs.startsWith(rootPrefix)) return null;
    return { rel, abs };
  };

  const sendFile = (req, res, file, st, status) => {
    const etag = `W/"${st.size}-${Math.floor(st.mtimeMs)}"`;
    const headers = baseHeaders({ 'Content-Type': mimeOf(file), 'Last-Modified': new Date(st.mtimeMs).toUTCString(), ETag: etag });
    if (status === 200) {
      const inm = req.headers['if-none-match'];
      const ims = req.headers['if-modified-since'];
      let notModified = false;
      // RFC 9110: If-None-Match takes precedence over If-Modified-Since; comparison is weak (W/ prefix ignored), as
      // required for GET. Dates are compared at 1 s granularity because HTTP-date has no sub-second part.
      if (inm) {
        notModified = inm.split(',').some((t) => {
          t = t.trim();
          return t === '*' || t.replace(/^W\//, '') === etag.replace(/^W\//, '');
        });
      } else if (ims) {
        const since = Date.parse(ims);
        notModified = !Number.isNaN(since) && Math.floor(st.mtimeMs / 1000) <= Math.floor(since / 1000);
      }
      if (notModified) {
        res.writeHead(304, headers);
        res.end();
        return;
      }
    }
    headers['Content-Length'] = st.size;
    if (req.method === 'HEAD') {
      res.writeHead(status, headers);
      res.end();
      return;
    }
    const stream = fs.createReadStream(file);
    // Headers only once the file actually opened: if it vanished between stat and open, the error path can still
    // send a clean 500 instead of a 200 with a truncated body.
    stream.on('open', () => res.writeHead(status, headers));
    stream.on('error', (err) => {
      if (!res.headersSent) sendText(req, res, 500, '500 Internal Server Error\n');
      else res.destroy(err);
    });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  };

  // `x.js?bundle` (bundle.js): the gzip-compressed module bundle that a built page carries inline as a data: URL.
  // Lazy dynamic import: bundle.js (and parse.js behind it) is loaded only on the first ?bundle request, so plain
  // static serving starts instantly.
  const sendBundle = (req, res, file) => {
    import('./bundle.js').then(({ assetBundle }) => {
      const body = Buffer.from(assetBundle(file, root).bytes);
      res.writeHead(200, baseHeaders({ 'Content-Type': 'application/gzip', 'Content-Length': body.length }));
      res.end(req.method === 'HEAD' ? undefined : body);
    }).catch((e) => sendText(req, res, 500, `500 bundle failed: ${e.message}\n`));
  };

  const notFound = (req, res) => {
    const page = path.join(root, '404.html');
    const st = statSafe(page);
    if (st && st.isFile()) return sendFile(req, res, page, st, 404);
    sendText(req, res, 404, '404 Not Found\n');
  };

  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendText(req, res, 405, '405 Method Not Allowed\n', { Allow: 'GET, HEAD' });
    }
    const raw = req.url || '/';
    const q = raw.indexOf('?');
    const rawPath = q === -1 ? raw : raw.slice(0, q);
    const query = q === -1 ? '' : raw.slice(q);
    if (!rawPath.startsWith('/')) return notFound(req, res);
    const r = resolveRequest(rawPath);
    if (!r) return notFound(req, res);
    const st = statSafe(r.abs);
    // ?bundle must be a whole query parameter ('?bundle', '?a&bundle', '?bundle=1'), not a substring like '?nobundle'.
    if (st && st.isFile() && /\.m?js$/i.test(r.abs) && /^\?(?:[^#]*&)?bundle(?:[&=]|$)/.test(query)) return sendBundle(req, res, r.abs);
    if (st && st.isFile()) return sendFile(req, res, r.abs, st, 200);
    if (st && st.isDirectory()) {
      if (!rawPath.endsWith('/')) {
        // Canonical trailing-slash URL rebuilt from the normalized path, so '//evil.com' or '/\evil.com'
        // can never become a scheme-relative Location.
        const p = r.rel.split('/').filter(Boolean).map(encodeURIComponent).join('/');
        return sendText(req, res, 301, 'Moved Permanently\n', { Location: '/' + (p ? p + '/' : '') + query });
      }
      const idx = path.join(r.abs, 'index.html');
      const ist = statSafe(idx);
      if (ist && ist.isFile()) return sendFile(req, res, idx, ist, 200);
      return notFound(req, res);
    }
    if (!rawPath.endsWith('/') && r.abs !== root) {
      const html = r.abs + '.html';
      const hst = statSafe(html);
      if (hst && hst.isFile()) return sendFile(req, res, html, hst, 200);
    }
    notFound(req, res);
  };
}

// ---------------------------------------------------------------------------------------------
// Mock JSON API

// Deliberately dumb, in-memory, process-lifetime store: enough to exercise sync code paths (offline queue, retries,
// 503 handling via _down) without a database. CORS '*' because pages may be opened from file:// or another port.
// Not a security boundary: bind to 127.0.0.1 (the default) when --api is on.
function apiHandler() {
  const store = new Map();       // key -> document | { list: [...] }
  const log = [];
  let down = false;
  let seq = 0;
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '600',
  };

  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      // Reject early while streaming (not after buffering) so an oversized upload cannot exhaust memory.
      if (size > BODY_LIMIT) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) return resolve(null);
      // Non-JSON bodies are kept as text rather than rejected: the mock should record what a buggy client sent.
      try { resolve(JSON.parse(text)); } catch { resolve(text); }
    });
    req.on('error', reject);
  });

  return async (req, res) => {
    const url = new URL(req.url || '/', 'http://x');
    if (!url.pathname.startsWith('/api/')) return false;
    const key = url.pathname.slice(5).replace(/\/+$/, '');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, baseHeaders(cors));
      res.end();
      return true;
    }
    let body = null;
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') body = await readBody(req);
    } catch (e) {
      sendJSON(req, res, e.status || 400, { ok: false, error: e.message }, cors);
      return true;
    }
    log.push({ at: new Date().toISOString(), method: req.method, path: url.pathname, query: url.search, body });
    if (log.length > 50) log.shift();
    if (key === '_log') return sendJSON(req, res, 200, log, cors), true;
    if (key === '_down' || key === '_up') {
      down = key === '_down';
      return sendJSON(req, res, 200, { ok: true, down }, cors), true;
    }
    if (down) return sendJSON(req, res, 503, { ok: false, error: 'simulated outage' }, cors), true;
    const now = Date.now();
    const cur = store.get(key);
    switch (req.method) {
      case 'GET': case 'HEAD':
        if (cur && cur.list) sendJSON(req, res, 200, cur.list, cors);
        else sendJSON(req, res, 200, cur || { updatedAt: 0 }, cors);
        return true;
      case 'PUT': case 'PATCH': {
        const doc = { ...(req.method === 'PATCH' && cur && !cur.list ? cur : {}), ...(body && typeof body === 'object' ? body : { value: body }), updatedAt: now };
        store.set(key, doc);
        sendJSON(req, res, 200, { ok: true, updatedAt: now }, cors);
        return true;
      }
      case 'POST': {
        if (cur && !cur.list) {
          store.set(key, { ...(body && typeof body === 'object' ? body : { value: body }), updatedAt: now });
          sendJSON(req, res, 200, { ok: true, updatedAt: now }, cors);
          return true;
        }
        const id = `${key.replace(/\W+/g, '-')}-${++seq}`;
        const list = cur ? cur.list : [];
        list.push({ id, at: now, body });
        store.set(key, { list });
        sendJSON(req, res, 200, { ok: true, id, orderId: id, updatedAt: now }, cors);
        return true;
      }
      case 'DELETE':
        store.delete(key);
        sendJSON(req, res, 200, { ok: true }, cors);
        return true;
      default:
        sendJSON(req, res, 405, { ok: false, error: 'method not allowed' }, cors);
        return true;
    }
  };
}

// ---------------------------------------------------------------------------------------------

export function createServer({ root = REPO, api = false, quiet = false, backend = null } = {}) {
  const handlers = [];
  // An application backend (backend.js, the contract of hosting.js) answers before the static files.
  if (backend) handlers.push((req, res) => backend.handle(req, res, new URL(req.url, 'http://local')));
  if (api) handlers.push(apiHandler());
  const files = staticHandler(root);
  const server = http.createServer(async (req, res) => {
    const t0 = process.hrtime.bigint();
    if (!quiet) {
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        console.log(`${req.method} ${req.url} ${res.statusCode} ${ms.toFixed(1)}ms`);
      });
    }
    try {
      for (const h of handlers) if (await h(req, res)) return;
      files(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) sendText(req, res, 500, '500 Internal Server Error\n');
      else res.destroy();
    }
  });
  // Malformed HTTP (bad request line, header overflow): answer 400 and close instead of Node's default silent reset.
  server.on('clientError', (err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    else socket.destroy();
  });
  return server;
}

// Starts a server. `app` (an application's import.meta.url or directory) serves the repository root and
// prints the application's URL. Port: argument, argv[2], env PORT, else the first free port from 8080.
export function serve({ app = null, root = REPO, port, host, api, quiet = false } = {}) {
  const argv = process.argv.slice(2);
  const flag = (n) => {
    const i = argv.indexOf('--' + n);
    return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : undefined;
  };
  const numArg = argv.find((a) => /^\d+$/.test(a));
  const wanted = Number(port ?? numArg ?? process.env.PORT ?? 0) || 0;
  host = host ?? flag('host') ?? process.env.HOST ?? '127.0.0.1';
  api = api ?? (!!flag('api') || process.env.API === '1');
  let appPath = '/';
  if (app) {
    const dir = String(app).startsWith('file:') ? path.dirname(fileURLToPath(app)) : path.resolve(String(app));
    appPath = '/' + path.relative(root, dir).split(path.sep).map(encodeURIComponent).join('/') + '/';
  }
  // <app>/backend.js (NOTICE BACKEND / ELECTRON targets): mounted like in the generated servers (the ctx of hosting.js
  // with mode 'dev'), data in <app>/.data/.
  let backend = null;
  const appDir = app ? (String(app).startsWith('file:') ? path.dirname(fileURLToPath(app)) : path.resolve(String(app))) : null;
  const backendFile = appDir && path.join(appDir, 'backend.js');
  return (backendFile && fs.existsSync(backendFile) ? import(pathToFileURL(backendFile).href).then((m) => {
    const dataDir = path.join(appDir, '.data');
    backend = m.default({
      dataDir, storage: devStorage(dataDir), log: (...a) => console.log(...a), name: path.basename(appDir), mode: 'dev',
      node: { http, https, dns, net, zlib, fs, path, os, child_process, stream, crypto: nodeCrypto, url, events },
    });
  }) : Promise.resolve()).then(() => listen());
  function listen() {
    const server = createServer({ root, api, quiet, backend });
    return new Promise((resolve) => {
      let tryPort = wanted || 8080;
      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && !wanted && tryPort < 8180) server.listen(++tryPort, host);
        else throw err;
      });
      server.on('listening', () => {
        const p = server.address().port;
        console.log(`Serving ${root}${api ? ' + mock API at /api/' : ''}`);
        console.log(`  http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${p}${appPath}`);
        resolve(server);
      });
      server.listen(tryPort, host);
      const shutdown = (sig) => {
        console.log(`\n${sig} received, shutting down`);
        server.close(() => process.exit(0));
        if (server.closeAllConnections) server.closeAllConnections();
        setTimeout(() => process.exit(0), 2000).unref();
      };
      process.once('SIGINT', () => shutdown('SIGINT'));
      process.once('SIGTERM', () => shutdown('SIGTERM'));
    });
  }
}

// JSON-file storage for development backends (the same interface as hosting.js; writes are atomic: temp file + rename).
// Note: unlike hosting.js fileStorage this uses encodeURIComponent, which leaves * ! ' ( ) ~ unescaped. '*' is
// invalid in Windows file names, so such keys fail to write in dev but work in artifacts. Data dir is <app>/.data/
// (a dot-dir: the static handler never serves it).
function devStorage(dataDir) {
  const fileOf = (key) => path.join(dataDir, encodeURIComponent(String(key)) + '.json');
  return {
    read(key) { try { return JSON.parse(fs.readFileSync(fileOf(key), 'utf8')); } catch { return null; } },
    write(key, value) {
      fs.mkdirSync(dataDir, { recursive: true });
      const f = fileOf(key);
      fs.writeFileSync(f + '.tmp', JSON.stringify(value));
      fs.renameSync(f + '.tmp', f);
    },
    list(prefix = '') { try { return fs.readdirSync(dataDir).filter((n) => n.endsWith('.json')).map((n) => decodeURIComponent(n.slice(0, -5))).filter((k) => k.startsWith(prefix)); } catch { return []; } },
    remove(key) { try { fs.rmSync(fileOf(key)); return true; } catch { return false; } },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  serve().then((server) => {
    const port = server.address().port;
    for (const e of fs.readdirSync(REPO, { withFileTypes: true })) {
      if (e.isDirectory() && e.name.includes('-') && !e.name.startsWith('.')) console.log(`  http://127.0.0.1:${port}/${e.name}/`);
    }
  });
}
