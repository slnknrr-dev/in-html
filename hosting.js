// hosting.js - the server inside generated artifacts (Node >= 18, no dependencies): static files served like GitHub /
// Codeberg Pages, plus the application's backend when there is one. singlefile.js copies this source verbatim into
// SERVERLESS / BACKEND / ELECTRON artifacts, so it imports node: modules only.
//
//   startHosting({ files, dir, backend, name, dataDir }) -> Promise<http.Server>
//     files    { '<path>': { type, body } } with base64 bodies (single-file artifacts carry their pages inline)
//     dir      folder of static files (multi-file artifacts: ./public next to server.mjs)
//     backend  the default export of the application's backend.js: (ctx) => ({ handle(req, res, url) -> boolean |
//              Promise, close?() })
//              ctx = { dataDir, storage: { read(key), write(key, value), list(prefix), remove(key) }, log(...), name,
//                      mode: 'backend' | 'electron' | 'dev',
//                      node: { http, https, dns, net, zlib, fs, path, os, child_process, stream, crypto, url, events },
//                      desktop?: { paths: { home, music, videos, downloads, documents, pictures, temp, userData } } }
//              Bundled backends cannot import node: modules, so they reach the system through ctx.node (outgoing
//              requests, files, child processes). `mode` says who serves them: 'backend' = this server on a port
//              (requests may come from anywhere: authenticate them), 'electron' = the main process of an ELECTRON
//              artifact (requests come only from the application's own windows through a custom protocol; `desktop`
//              is present there), 'dev' = the development server (server.js). ctx.node.fs … ctx.node.events and
//              ctx.mode were added after the first five modules; older backends ignore them.
//   createHosting({ files, dir, backend, name, dataDir, mode, ctx }) -> { handler(req, res), api, dataDir, close() }
//     the same static + backend request handler without a listening server (startHosting and the Electron main
//     process use it); `ctx` adds fields to the backend's ctx.
//   webHandler(handler, { csp }) -> (request: Request) => Promise<Response>
//     adapts a Node (req, res) handler to the Fetch API (Electron's protocol.handle): req is a Readable with method,
//     url, headers; res is a Writable with statusCode, setHeader / getHeader / removeHeader / hasHeader, writeHead,
//     headersSent (pipe() into it works); the Response streams with backpressure; a cancelled body (a media element
//     that seeks) destroys res ('close'). Accept-Encoding is dropped (no gzip through the adapter). csp: a
//     Content-Security-Policy for HTML responses; '{script-hashes}' in it becomes the SHA-256 sources of the page's
//     inline scripts.
//
// Static behaviour (GitHub Pages): GET / HEAD; / -> index.html; /a -> a.html or a/index.html; an unknown path answers
// 404.html with status 404 when the site has one (single-page applications route themselves from it), else a plain
// 404; ETag / If-None-Match -> 304; gzip for text when the client accepts it; dotfiles and .. are never served.
// Command line of a generated script: node <file> [port] [--host 0.0.0.0] [--data <dir>] (env PORT, HOST, DATA_DIR);
// the default port is 8080 (the next free one when taken), the default data folder ./data next to the script.
//
// Key decisions:
// - Verbatim copy, zero dependencies: the artifact must run with a bare `node` years later; no npm install step, no
//   lockfile, no supply chain. Hence a hand-written MIME table (TYPES) instead of importing ./mime.js.
// - Backends get Node through ctx.node, never through imports: the bundler (bundle.js) resolves only relative files,
//   so a node: import inside backend.js would not survive bundling; injection also documents the capability surface.
// - Default bind 127.0.0.1: a generated artifact must not expose a backend to the LAN until the user opts in with
//   --host 0.0.0.0.

import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import url from 'node:url';
import events from 'node:events';
import stream from 'node:stream';
import child_process from 'node:child_process';
import nodeCrypto from 'node:crypto';

// Node 18 has no global Web Crypto; backends use globalThis.crypto.
if (!globalThis.crypto) globalThis.crypto = nodeCrypto.webcrypto;

// Capability bag handed to backends; listing modules explicitly (not `require`) keeps the surface reviewable.
const NODE = { http, https, dns, net, zlib, fs, path, os, child_process, stream, crypto: nodeCrypto, url, events };

const TYPES = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8',
  xml: 'application/xml; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav', weba: 'audio/webm', mp4: 'video/mp4', webm: 'video/webm',
  pdf: 'application/pdf', wasm: 'application/wasm', zip: 'application/zip', epub: 'application/epub+zip', webmanifest: 'application/manifest+json',
};
const typeOf = (p) => TYPES[path.extname(p).slice(1).toLowerCase()] || 'application/octet-stream';
// Only text-like types: PNG/WOFF2/MP4 are already compressed, gzip would burn CPU for ~0% gain.
const compressible = (type) => /^(text\/|application\/(json|javascript|xml|manifest)|image\/svg)/.test(type);

function argOf(name) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
}

// A file source: get(rel) -> { body: Buffer, type, mtime } | null.
// One shared mtime (startup time) for all inline files: bodies never change while the process lives.
function memorySource(files) {
  const map = new Map();
  const t = new Date();
  for (const [p, f] of Object.entries(files)) map.set(p.replace(/^\/+/, ''), { body: Buffer.from(f.body, 'base64'), type: f.type || typeOf(p), mtime: t });
  return (rel) => map.get(rel) || null;
}

function dirSource(dir) {
  const root = path.resolve(dir);
  return (rel) => {
    const abs = path.resolve(root, rel);
    // Containment check on the resolved path (after `..` collapse); `root + sep` prevents /pub matching /public2.
    // Symlinks inside root are followed (statSync), which is acceptable for an artifact folder the owner controls.
    if (abs !== root && !abs.startsWith(root + path.sep)) return null;
    try {
      const st = fs.statSync(abs);
      if (!st.isFile()) return null;
      return { body: fs.readFileSync(abs), type: typeOf(abs), mtime: st.mtime };
    } catch { return null; }
  };
}

// Key-value storage for backends: one JSON file per key under dataDir (keys are sanitized into file names).
// Keys become file names by %-escaping everything outside [A-Za-z0-9._-]: no path traversal ('/' and '..' segments
// cannot survive), case-sensitive keys stay distinct on case-insensitive disks only if the caller avoids case-only
// differences. write = temp file + rename: rename is atomic on one filesystem, so a crash never leaves half a JSON.
// KNOWN DEFECT: escaping uses charCodeAt(0).toString(16).padStart(2), so a char above U+00FF becomes %xxxx (4 hex
// digits) and any non-ASCII char is a UTF-16 unit, not UTF-8; list() then decodeURIComponent()s it to a different key
// (or throws, caught, returning []). Fix: escape with encodeURIComponent plus the remaining unsafe chars ('.' kept).
function fileStorage(dataDir) {
  const fileOf = (key) => path.join(dataDir, String(key).replace(/[^A-Za-z0-9._-]/g, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')) + '.json');
  return {
    read(key) { try { return JSON.parse(fs.readFileSync(fileOf(key), 'utf8')); } catch { return null; } },
    write(key, value) {
      fs.mkdirSync(dataDir, { recursive: true });
      const f = fileOf(key);
      fs.writeFileSync(f + '.tmp', JSON.stringify(value));
      fs.renameSync(f + '.tmp', f);
    },
    list(prefix = '') {
      try { return fs.readdirSync(dataDir).filter((n) => n.endsWith('.json')).map((n) => decodeURIComponent(n.slice(0, -5))).filter((k) => k.startsWith(prefix)); } catch { return []; }
    },
    remove(key) { try { fs.rmSync(fileOf(key)); return true; } catch { return false; } },
  };
}

// The request handler of an artifact: the backend first, then the static files.
export function createHosting({ files = null, dir = null, backend = null, name = 'site', dataDir, mode = 'backend', ctx = {}, log } = {}) {
  const source = files ? memorySource(files) : dirSource(dir || '.');
  log = log || ((...a) => console.log(new Date().toISOString(), ...a));
  const api = backend ? backend({ dataDir, storage: fileStorage(dataDir), log, name, mode, node: NODE, ...ctx }) : null;
  // KNOWN DEFECT: the cache is keyed by Buffer identity. memorySource returns the same Buffer each time (hits), but
  // dirSource reads a fresh Buffer per request, so in multi-file artifacts every request misses AND adds an entry:
  // unbounded memory growth. Fix: key by path + etag (or skip caching for dirSource).
  const gzCache = new Map();

  const send = (req, res, status, file) => {
    // Weak-ish validator from size + mtime (seconds), like many static servers: cheap (no hashing). Collides only if
    // a file is rewritten with the same length within one second. no-cache = always revalidate, so edits show up.
    const etag = `"${file.body.length.toString(36)}-${Math.floor(+file.mtime / 1000).toString(36)}"`;
    const headers = { 'Content-Type': file.type, ETag: etag, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', Vary: 'Accept-Encoding' };
    if (status === 200 && req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return; }
    let body = file.body;
    if (compressible(file.type) && body.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      let gz = gzCache.get(file.body);
      if (!gz) { gz = zlib.gzipSync(body, { level: 9 }); gzCache.set(file.body, gz); }
      body = gz;
      headers['Content-Encoding'] = 'gzip';
    }
    headers['Content-Length'] = body.length;
    res.writeHead(status, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  };

  const serveStatic = (req, res, url) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { rel = null; }
    // Rejects malformed %-escapes, NUL (truncates paths in some fs APIs) and any segment starting with '.', which
    // covers both dotfiles (.env, .git) and '..' traversal in one rule, before the path ever reaches the source.
    if (rel === null || rel.includes('\0') || rel.split('/').some((s) => s.startsWith('.') && s !== '')) { res.writeHead(400); res.end(); return; }
    rel = rel.replace(/^\/+/, '');
    const candidates = rel === '' || rel.endsWith('/') ? [rel + 'index.html'] : [rel, rel + '.html', rel + '/index.html'];
    for (const c of candidates) {
      const f = source(c);
      if (f) {
        // A folder without its trailing slash: redirect like GitHub Pages, so relative links resolve.
        if (c === rel + '/index.html') { res.writeHead(301, { Location: url.pathname + '/' + url.search }); res.end(); return; }
        send(req, res, 200, f);
        return;
      }
    }
    const nf = source('404.html');
    if (nf) send(req, res, 404, nf);
    else { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 Not Found\n'); }
  };

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://local');
    try {
      // Backend first: it may own any path (including ones that also exist as static files). handle() returns truthy
      // when it answered; falsy falls through to static serving.
      if (api && await api.handle(req, res, url)) return;
      serveStatic(req, res, url);
    } catch (e) {
      log('error', req.method, req.url, e && e.stack || e);
      if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('500 Internal Server Error\n'); } else res.destroy();
    }
  };
  const close = async () => { if (api && typeof api.close === 'function') await api.close(); };
  return { handler, api, dataDir, close };
}

export function startHosting({ files = null, dir = null, backend = null, name = 'site', dataDir } = {}) {
  const here = process.argv[1] ? path.dirname(path.resolve(process.argv[1])) : process.cwd();
  dataDir = path.resolve(argOf('data') || process.env.DATA_DIR || dataDir || path.join(here, 'data'));
  const log = (...a) => console.log(new Date().toISOString(), ...a);
  const hosting = createHosting({ files, dir, backend, name, dataDir, mode: 'backend', log });
  const api = hosting.api;
  const server = http.createServer(hosting.handler);

  const numArg = process.argv.slice(2).find((a) => /^\d+$/.test(a));
  const wanted = Number(numArg ?? process.env.PORT ?? 0) || 0;
  const host = argOf('host') || process.env.HOST || '127.0.0.1';
  return new Promise((resolve) => {
    // No explicit port: try 8080..8180 on EADDRINUSE. An explicit port that is taken is an error (the user asked for it).
    let port = wanted || 8080;
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && !wanted && port < 8180) server.listen(++port, host);
      else throw err;
    });
    server.on('listening', () => {
      const p = server.address().port;
      console.log(`${name}: http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${p}/${api ? `  (backend data: ${dataDir})` : ''}`);
      resolve(server);
    });
    server.listen(port, host);
    const stop = () => {
      Promise.resolve(hosting.close()).catch(() => {});
      // close() waits for keep-alive sockets; closeAllConnections (Node >= 18.2) drops them; the unref'd timer is the
      // last resort so Ctrl+C never hangs, without itself keeping the loop alive.
      server.close(() => process.exit(0)); if (server.closeAllConnections) server.closeAllConnections(); setTimeout(() => process.exit(0), 1500).unref();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

// --- Fetch API adapter (Electron protocol.handle) ---------------------------------------------------------------------

const NO_BODY = new Set([101, 103, 204, 205, 304]);

// SHA-256 sources of the inline <script> elements of an HTML page (for a CSP without 'unsafe-inline').
// Regex over HTML is acceptable here: the input is our own generated pages, not arbitrary markup. External scripts
// need no hash (the CSP source list covers them), except data: srcs which add the 'data:' source. JSON/importmap/
// template blocks are not executed, so hashing them would only widen the policy.
function scriptHashes(html) {
  const out = new Set();
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (/\ssrc\s*=/i.test(m[1])) { if (/\ssrc\s*=\s*["']?data:/i.test(m[1])) out.add('data:'); continue; }
    if (/\stype\s*=\s*["']?(application\/(ld\+)?json|importmap|text\/template)/i.test(m[1])) continue;
    out.add(m[2] === '' ? '' : `'sha256-${nodeCrypto.createHash('sha256').update(m[2], 'utf8').digest('base64')}'`);
  }
  out.delete('');
  return [...out];
}

// Why an adapter instead of a second server: Electron's protocol.handle serves a custom scheme from a Fetch-style
// handler, and a real loopback port would be reachable by every local process. The adapter lets the exact same
// createHosting handler (and backends written for Node's req/res) run with no socket at all.
// Mechanics: res is a Writable whose chunks feed a ReadableStream; the Response is resolved lazily on the first write,
// end or explicit flush, so headers set before the first byte are honoured. Backpressure: a write callback is held in
// `pending` until the stream's pull() asks for more (highWaterMark 8 chunks).
// HTML with a CSP is buffered whole: hashes need the final bytes before the header can be sent.
export function webHandler(handler, { csp = null } = {}) {
  return (request) => new Promise((resolve, reject) => {
    const u = new URL(request.url);
    const headers = {};
    request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    // Dropped so createHosting never gzips: Response bodies here are consumed raw by Chromium without decoding.
    delete headers['accept-encoding'];
    headers.host = u.host;
    const req = request.body && request.method !== 'GET' && request.method !== 'HEAD' ? stream.Readable.fromWeb(request.body) : stream.Readable.from([]);
    Object.assign(req, { method: request.method, url: u.pathname + u.search, headers, httpVersion: '1.1', httpVersionMajor: 1, httpVersionMinor: 1,
      socket: { remoteAddress: '127.0.0.1', encrypted: true }, connection: { remoteAddress: '127.0.0.1', encrypted: true } });

    let settled = false;
    let noBody = false;               // the Response has no body (HEAD, 204, 304, …): written bytes are dropped
    let ended = false;                // res.end() reached final()
    let cancelled = false;            // the consumer cancelled the body
    let controller = null;
    let pending = null;               // write callback waiting for the consumer (backpressure)
    let html = null;                  // buffered HTML body (CSP hashes need the whole page)
    const outHeaders = new Map();     // lower-case name -> [name, value]
    const body = new ReadableStream({
      start(c) { controller = c; },
      pull() { if (pending) { const cb = pending; pending = null; cb(); } },
      cancel() { cancelled = true; if (!res.destroyed) res.destroy(); },
    }, { highWaterMark: 8, size: () => 1 });

    const respond = (withBody) => {
      if (settled) return;
      settled = true;
      res.headersSent = true;
      const h = new Headers();
      for (const [, [k, v]] of outHeaders) for (const x of Array.isArray(v) ? v : [v]) h.append(k, String(x));
      const status = res.statusCode || 200;
      noBody = !withBody || NO_BODY.has(status) || request.method === 'HEAD';
      try { resolve(new Response(noBody ? null : body, { status, statusText: res.statusMessage || '', headers: h })); } catch (e) { reject(e); }
    };
    const isHTML = () => /^text\/html\b/i.test(String((outHeaders.get('content-type') || [, ''])[1]));
    const finishHTML = () => {
      const text = Buffer.concat(html).toString('utf8');
      if (csp) outHeaders.set('content-security-policy', ['Content-Security-Policy', csp.replace('{script-hashes}', scriptHashes(text).join(' '))]);
      const bytes = Buffer.from(text, 'utf8');
      outHeaders.set('content-length', ['Content-Length', String(bytes.length)]);
      respond(true);
      if (bytes.length && !noBody) controller.enqueue(new Uint8Array(bytes));
      try { controller.close(); } catch { /* cancelled */ }
    };

    const res = new stream.Writable({
      write(chunk, enc, cb) {
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk, enc) : chunk;
        if (!settled && html === null && csp && isHTML()) html = [];
        if (html) { html.push(Buffer.from(bytes)); cb(); return; }
        respond(true);
        if (noBody) { cb(); return; }
        try { controller.enqueue(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)); } catch { cb(); return; }
        if (controller.desiredSize > 0) cb(); else pending = cb;
      },
      final(cb) {
        ended = true;
        if (html) finishHTML();
        else if (!settled && csp && isHTML()) { html = []; finishHTML(); }
        else { respond(true); try { controller.close(); } catch { /* cancelled */ } }
        cb();
      },
      // Also called after 'finish' (autoDestroy): only an unfinished response errors the body.
      destroy(err, cb) {
        if (!settled) respond(false);
        if (!ended && !cancelled) { try { controller.error(err || new Error('aborted')); } catch { /* closed */ } }
        if (pending) { const p = pending; pending = null; p(); }
        cb(err);
      },
    });
    Object.assign(res, {
      statusCode: 200, statusMessage: '', headersSent: false, socket: null, sendDate: false,
      setHeader(k, v) { outHeaders.set(String(k).toLowerCase(), [k, v]); return res; },
      getHeader(k) { const e = outHeaders.get(String(k).toLowerCase()); return e ? e[1] : undefined; },
      getHeaders() { return Object.fromEntries([...outHeaders].map(([k, [, v]]) => [k, v])); },
      getHeaderNames() { return [...outHeaders.keys()]; },
      hasHeader(k) { return outHeaders.has(String(k).toLowerCase()); },
      removeHeader(k) { outHeaders.delete(String(k).toLowerCase()); },
      writeHead(status, msg, hdrs) {
        if (typeof msg !== 'string') { hdrs = msg; msg = ''; }
        res.statusCode = status;
        res.statusMessage = msg || '';
        if (Array.isArray(hdrs)) for (let i = 0; i + 1 < hdrs.length; i += 2) res.setHeader(hdrs[i], hdrs[i + 1]);
        else if (hdrs) for (const [k, v] of Object.entries(hdrs)) if (v !== undefined) res.setHeader(k, v);
        return res;
      },
      flushHeaders() { if (!(csp && isHTML())) respond(true); },
      writeContinue() {},
    });
    res.on('error', () => { /* reported through the stream */ });
    Promise.resolve(handler(req, res)).catch((e) => {
      if (!settled) { res.statusCode = 500; outHeaders.clear(); respond(false); }
      console.error(e);
    });
  });
}
