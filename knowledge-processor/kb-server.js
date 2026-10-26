// knowledge-processor/kb-server.js - serving a knowledge base with real routes (Node >= 18). Imports no node:
// modules (they are passed in), so it bundles both into the app's backend (backend.js) and into the server of the
// "backend" export (export.js writes server.mjs = node imports + this module's bundle + main()).
//
//   createKBHandler({ base, style, getKB, getMedia, readerJS, api, log }) -> { handle(req, res, url) -> Promise<bool>, invalidate() }
//     base      URL path prefix of the site ('/' or '/kb/<id>/'); requests outside it are not handled (false)
//     getKB()   the knowledge base (model.js normKB); the published site is rebuilt when its `rev` / `updated` changes
//     getMedia(id, meta) -> { body: Uint8Array, type } | null       readerJS: string (the reader bundle)
//     api       { token, save(kb), saveMedia(id, bytes, meta), deleteMedia(id) } | null: the editing API below
//   Routes below base: pages (any URL style: a/b, a/b/, a/b.html; 404 status with the reader page for unknown routes;
//   secret pages are always 404 here, the reader opens them in the browser), _kp/kb.css, _kp/kb.js (KP_DATA),
//   _kp/reader.js, _kp/media/<file>, sitemap.xml, robots.txt, and with `api`:
//     GET  _kp/api/kb               the knowledge base JSON (media without bytes)        Authorization: Bearer <token>
//     PUT  _kp/api/kb               replace it: body { kb, baseRev? } -> { ok, rev } | 409 { error, rev }   (token)
//     PUT  _kp/api/media/<id>?type=&name=   raw bytes of a media item                           (token)
//     DELETE _kp/api/media/<id>                                                                (token)
//     GET  _kp/api/info             { title, rev, updated, pages } (no token)
//   CORS is open for _kp/api/ (the token protects writes), so an editor on another origin can publish.
//
//   main({ http, fs, path, crypto, dir, argv, env }) the standalone server of a backend export: data in <dir>/data
//     (kb.json, media/<file>, token.txt), reader in <dir>/public/_kp/reader.js; command line
//     [port] [--host 0.0.0.0] [--data <dir>] [--base /sub/] [--style clean|folders|html] [--token <t>] [--read-only]
//
// Why server-rendered pages when the reader is a SPA: crawlers and link previews get real HTML and real status codes
// (404 for unknown routes instead of a soft 200), and the page is readable before JS loads. The reader then hydrates.
// Rendering is lazy per route and cached per revision (see current()), so a large base costs nothing until visited.
import { normBase, pathOf, routeOf } from '../spa/base.js';
import { robotsTXT, sitemapXML } from '../spa/prerender.js';
import { normKB } from './model.js';
import { buildSite, mediaFileName } from './site.js';
import { pageDocument, jsonScript } from './pages.js';
import { readerCSS } from './reader-css.js';

const TEXT = { 'Content-Type': 'text/plain; charset=utf-8' };
const enc = new TextEncoder();

// One response path: explicit Content-Length (no chunked encoding for known bodies), no-cache (revalidate; content
// changes on every save), nosniff. HEAD gets the same headers without the body, as HTTP requires.
function send(req, res, status, body, headers = {}) {
  const data = typeof body === 'string' ? enc.encode(body) : body || new Uint8Array(0);
  res.writeHead(status, { 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Length': data.length, ...headers });
  res.end(req.method === 'HEAD' ? undefined : data);
}
const sendJSON = (req, res, status, v, h) => send(req, res, status, JSON.stringify(v), { 'Content-Type': 'application/json; charset=utf-8', ...h });

// Streams the body with a hard cap: past `limit` the promise rejects with status 413 and the socket is destroyed, so a
// client cannot make the server buffer unbounded data. Chunks are joined once at the end (one allocation of `size`).
export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      const out = new Uint8Array(size);
      let o = 0;
      for (const c of chunks) { out.set(c, o); o += c.length; }
      resolve(out);
    });
    req.on('error', reject);
  });
}

// Constant-time comparison of tokens.
// Constant-time with respect to the content: XOR-accumulates every position instead of returning at the first
// mismatch, so response timing does not reveal how many leading characters were right. The loop runs over the
// server token's length (y) and folds the length difference into d, so a short guess cannot shorten the loop.
export function sameToken(a, b) {
  const x = String(a || ''), y = String(b || '');
  if (!x || !y) return false;
  let d = x.length ^ y.length;
  for (let i = 0; i < y.length; i++) d |= x.charCodeAt(i % x.length) ^ y.charCodeAt(i);
  return d === 0;
}
export const bearer = (req) => { const m = /^Bearer\s+(\S+)/i.exec(req.headers.authorization || ''); return m ? m[1] : ''; };

// Open CORS on the API only: an editor running on another origin (file://, a static host) must reach it. Safe because
// writes need the bearer token, which browsers never attach automatically (unlike cookies), so CSRF has nothing to ride.
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' };

export function createKBHandler({ base = '/', style = 'clean', getKB, getMedia, readerJS = '', api = null, log = () => {}, siteURL = '' }) {
  base = normBase(base);
  let cache = null, cacheKey = '';
  // Cache key = id + rev + updated: any save bumps rev, so the derived site, CSS, KP_DATA script and rendered pages are
  // rebuilt exactly once per revision. invalidate() forces a rebuild for out-of-band changes (media).
  function current() {
    const kb = getKB();
    if (!kb) return null;
    const k = kb.id + ':' + kb.rev + ':' + kb.updated;
    if (k !== cacheKey) {
      const site = buildSite(kb);
      cache = { kb, site, css: readerCSS(site), data: 'window.KP_DATA=' + jsonScript({ site, style, base }) + ';\n', pages: new Map() };
      cacheKey = k;
    }
    return cache;
  }

  async function handleAPI(req, res, rest) {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return true; }
    const c = current();
    if (rest === 'info' && (req.method === 'GET' || req.method === 'HEAD')) {
      sendJSON(req, res, 200, c ? { title: c.kb.title, rev: c.kb.rev, updated: c.kb.updated, pages: c.kb.pages.length, id: c.kb.id } : { title: '', rev: 0 }, CORS);
      return true;
    }
    // info above is public (title, revision): used by editors to detect a newer server revision before saving.
    if (!sameToken(bearer(req), api.token)) { sendJSON(req, res, 401, { error: 'unauthorized' }, CORS); return true; }
    if (rest === 'kb' && req.method === 'GET') {
      const kb = c ? { ...c.kb, media: Object.fromEntries(Object.entries(c.kb.media).map(([id, m]) => [id, { ...m, data: undefined }])) } : null;
      sendJSON(req, res, kb ? 200 : 404, kb || { error: 'no knowledge base' }, CORS);
      return true;
    }
    if (rest === 'kb' && req.method === 'PUT') {
      let body;
      try { body = JSON.parse(new TextDecoder().decode(await readBody(req, 64 * 1024 * 1024))); } catch (e) { sendJSON(req, res, e.status || 400, { error: 'bad JSON' }, CORS); return true; }
      // Accepts both { kb, baseRev } and a bare base (a hand-made curl upload). Conflict check is optimistic, see backend.js.
      const src = body && body.kb ? body.kb : body;
      if (c && body && typeof body.baseRev === 'number' && c.kb.rev > body.baseRev) { sendJSON(req, res, 409, { error: 'conflict', rev: c.kb.rev }, CORS); return true; }
      const kb = normKB(src);
      if (c) kb.id = c.kb.id;
      kb.rev = (c ? c.kb.rev : 0) + 1;
      kb.updated = new Date().toISOString();
      // Media bytes travel separately; only metadata is kept here.
      for (const m of Object.values(kb.media)) delete m.data;
      await api.save(kb);
      log('saved', kb.title, 'rev', kb.rev);
      sendJSON(req, res, 200, { ok: true, rev: kb.rev, updated: kb.updated }, CORS);
      return true;
    }
    // Media ids follow the model's id shape (letter + 2..31 alphanumerics), so they are safe as file names.
    const mm = /^media\/([a-z][a-z0-9]{2,31})$/.exec(rest);
    if (mm && req.method === 'PUT') {
      let bytes;
      try { bytes = await readBody(req, 256 * 1024 * 1024); } catch (e) { sendJSON(req, res, e.status || 400, { error: e.message }, CORS); return true; }
      const u = new URL(req.url, 'http://x');
      // KNOWN DEFECT: `type` from the query string is stored unvalidated and later served as Content-Type on the site's own
      // origin; a token holder could upload text/html and get script running under the site. backend.js filters it with
      // /^[\w.+-]+\/[\w.+-]+$/. Fix: apply the same filter here.
      await api.saveMedia(mm[1], bytes, { type: u.searchParams.get('type') || 'application/octet-stream', name: u.searchParams.get('name') || mm[1] });
      sendJSON(req, res, 200, { ok: true, size: bytes.length }, CORS);
      return true;
    }
    if (mm && req.method === 'DELETE') { await api.deleteMedia(mm[1]); sendJSON(req, res, 200, { ok: true }, CORS); return true; }
    sendJSON(req, res, 404, { error: 'not found' }, CORS);
    return true;
  }

  // Base check appends '/' so the bare prefix without trailing slash (/kb/x) still matches base /kb/x/.
  async function handle(req, res, url) {
    let p;
    try { p = decodeURIComponent(url.pathname); } catch { return false; }
    if (!(p + (p.endsWith('/') ? '' : '/')).startsWith(base)) return false;
    const rest = p.slice(base.length);
    // Without an api object (read-only server) the API path is "not ours": no endpoint exists to probe.
    if (rest.startsWith('_kp/api/')) { if (!api) return false; return handleAPI(req, res, rest.slice(8)); }
    if (req.method !== 'GET' && req.method !== 'HEAD') { send(req, res, 405, '405 Method Not Allowed\n', { ...TEXT, Allow: 'GET, HEAD' }); return true; }
    const c = current();
    if (!c) { send(req, res, 404, '404 Not Found\n', TEXT); return true; }
    if (rest === '_kp/kb.css') { send(req, res, 200, c.css, { 'Content-Type': 'text/css; charset=utf-8' }); return true; }
    if (rest === '_kp/kb.js') { send(req, res, 200, c.data, { 'Content-Type': 'text/javascript; charset=utf-8' }); return true; }
    // readerJS may be a lazy async loader (backend.js builds the bundle on first use) or a ready string (standalone server).
    if (rest === '_kp/reader.js') { send(req, res, 200, typeof readerJS === 'function' ? await readerJS() : readerJS, { 'Content-Type': 'text/javascript; charset=utf-8' }); return true; }
    // Media is addressed by its published file name; a linear search over media is fine at knowledge-base scale. Media is
    // immutable per file name, so it gets an hour of public caching unlike the pages.
    if (rest.startsWith('_kp/media/')) {
      const file = rest.slice(10);
      const id = Object.keys(c.site.media).find((k) => c.site.media[k].f === file);
      const m = id ? await getMedia(id, c.kb.media[id]) : null;
      if (!m) { send(req, res, 404, '404 Not Found\n', TEXT); return true; }
      send(req, res, 200, m.body, { 'Content-Type': m.type || c.kb.media[id].type, 'Cache-Control': 'public, max-age=3600' });
      return true;
    }
    // sitemap.xml needs an absolute site URL (protocol requirement), so it exists only when SITE_URL is configured.
    if (rest === 'robots.txt') { send(req, res, 200, robotsTXT(siteURL), TEXT); return true; }
    if (rest === 'sitemap.xml' && siteURL) {
      send(req, res, 200, sitemapXML(siteURL, c.site.pages.filter((x) => !x.hidden).map((x) => ({ route: x.slug === c.site.home ? '' : x.slug, lastmod: (x.updated || '').slice(0, 10) })), style), { 'Content-Type': 'application/xml; charset=utf-8' });
      return true;
    }
    // Reserved namespace: unknown _kp/ paths are 404 and never fall through to page routing.
    if (rest.startsWith('_kp/')) { send(req, res, 404, '404 Not Found\n', TEXT); return true; }
    const route = routeOf(url.pathname, base);
    if (route == null) return false;
    // The canonical URL of the home page is the base itself.
    // /home-slug/ and / would be duplicate content; the slug form redirects to the base. 301 = permanent, which browsers
    // cache: if the home page is later changed, visitors who saw the redirect keep being sent to the base (harmless here,
    // since the base then shows the new home).
    if (route === c.site.home && route) { res.writeHead(301, { Location: pathOf('', base, style) }); res.end(); return true; }
    // Rendered documents cached per revision, capped at 2000 entries: unknown routes also render (as 404 pages) and
    // would otherwise let a crawler grow the cache without bound.
    let doc = c.pages.get(route);
    if (!doc) { doc = pageDocument(c.site, route, { mode: 'server', style, base }); if (c.pages.size < 2000) c.pages.set(route, doc); }
    send(req, res, doc.status, doc.html, { 'Content-Type': 'text/html; charset=utf-8' });
    return true;
  }

  return { handle, invalidate() { cacheKey = ''; } };
}

// The standalone server of a backend export.
// Dependencies are injected (http, fs, path, crypto) so this module imports nothing from node: and can be bundled.
// Precedence for every setting: command line > environment > data/server.json > default.
export async function main({ http, fs, path, crypto, dir, argv = [], env = {} }) {
  const arg = (n) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
  const log = (...a) => console.log(new Date().toISOString(), ...a);
  const data = path.resolve(arg('data') || env.DATA_DIR || path.join(dir, 'data'));
  const conf = (() => { try { return JSON.parse(fs.readFileSync(path.join(data, 'server.json'), 'utf8')); } catch { return {}; } })();
  const base = normBase(arg('base') || env.BASE || conf.base || '/');
  const style = ['clean', 'folders', 'html'].includes(arg('style') || conf.style) ? arg('style') || conf.style : 'clean';
  const readOnly = argv.includes('--read-only') || env.READ_ONLY === '1';
  // Atomic write: temp file + rename. rename replaces the target in one step, so a crash mid-write leaves the old kb.json
  // intact instead of a truncated one. Random suffix avoids two concurrent writes sharing a temp file.
  const write = (file, bytes) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, file);
  };
  let kb = null;
  try { kb = normKB(JSON.parse(fs.readFileSync(path.join(data, 'kb.json'), 'utf8'))); } catch (e) { log('no knowledge base in', path.join(data, 'kb.json'), e.message); }
  // A read-only server needs no token at all; otherwise it persists the generated one so restarts keep the same secret.
  let token = arg('token') || env.KP_TOKEN || '';
  if (!readOnly && !token) {
    try { token = fs.readFileSync(path.join(data, 'token.txt'), 'utf8').trim(); } catch { token = ''; }
    if (!token) { token = crypto.randomBytes(24).toString('base64url'); write(path.join(data, 'token.txt'), token + '\n'); }
  }
  let readerJS = '';
  try { readerJS = fs.readFileSync(path.join(dir, 'public', '_kp', 'reader.js'), 'utf8'); } catch { log('missing public/_kp/reader.js'); }
  const mediaDir = path.join(data, 'media');
  const handler = createKBHandler({
    base, style, log, readerJS, siteURL: env.SITE_URL || conf.siteURL || '',
    getKB: () => kb,
    getMedia: (id, meta) => {
      try { return meta ? { body: fs.readFileSync(path.join(mediaDir, mediaFileName(id, meta))), type: meta.type } : null; } catch { return null; }
    },
    api: readOnly ? null : {
      token,
      save(next) { write(path.join(data, 'kb.json'), JSON.stringify(next)); kb = next; },
      // Updates the in-memory metadata only; it is persisted with the next kb PUT, which the editor sends after uploads.
      saveMedia(id, bytes, meta) {
        const m = { id, name: meta.name, type: meta.type, size: bytes.length, w: 0, h: 0, alt: '', credit: '' };
        if (kb) kb.media[id] = { ...(kb.media[id] || {}), ...m };
        write(path.join(mediaDir, mediaFileName(id, m)), bytes);
      },
      // Deletes the file only; the metadata entry disappears with the editor's next kb PUT.
      deleteMedia(id) {
        if (!kb || !kb.media[id]) return;
        try { fs.unlinkSync(path.join(mediaDir, mediaFileName(id, kb.media[id]))); } catch { /* gone */ }
      },
    },
  });
  // Requests outside the base redirect to the site (302: temporary, the base may change). Errors become 500 when headers
  // are not sent yet; otherwise the only honest signal left is destroying the connection.
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    try {
      if (await handler.handle(req, res, url)) return;
      // Outside the base: send visitors to the site.
      res.writeHead(302, { Location: base });
      res.end();
    } catch (e) {
      log('error', req.method, req.url, (e && e.stack) || e);
      if (!res.headersSent) { res.writeHead(500, TEXT); res.end('500 Internal Server Error\n'); } else res.destroy();
    }
  });
  const numArg = argv.find((a) => /^\d+$/.test(a));
  const wanted = Number(numArg || env.PORT || 0) || 0;
  const host = arg('host') || env.HOST || '127.0.0.1';
  // Without an explicit port, try 8080..8180 on EADDRINUSE so several exports can run side by side.
  // KNOWN DEFECT: `throw err` inside the 'error' listener is not a rejection of this promise; it surfaces as an uncaught
  // exception and the awaiting caller never sees it. Fix: take `reject` and call reject(err).
  await new Promise((resolve) => {
    let port = wanted || 8080;
    server.on('error', (err) => { if (err.code === 'EADDRINUSE' && !wanted && port < 8180) server.listen(++port, host); else throw err; });
    server.on('listening', resolve);
    server.listen(port, host);
  });
  const p = server.address().port;
  console.log(`${kb ? kb.title : 'knowledge base'}: http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${p}${base}`);
  if (!readOnly) console.log(`editing API: ${base}_kp/api/ (token in ${arg('token') || env.KP_TOKEN ? 'the command line / KP_TOKEN' : path.join(data, 'token.txt')})`);
  // Graceful stop: close() waits for open connections; closeAllConnections (Node 18.2+) drops keep-alive sockets, and
  // the unref'ed 1.5s timer is the hard deadline without keeping the process alive by itself.
  const stop = () => { server.close(() => process.exit(0)); if (server.closeAllConnections) server.closeAllConnections(); setTimeout(() => process.exit(0), 1500).unref(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return server;
}
