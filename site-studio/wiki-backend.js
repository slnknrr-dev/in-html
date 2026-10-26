// site-studio/wiki-backend.js - the backend of the application's BACKEND artifact (hosting.js mounts it; the
// development server `node site-studio/server.js` too): the editor's knowledge bases stored on the server for a
// team, and every stored base published with real routes under kb/<id>/ (kb-server.js: pages rendered per request,
// 404 status for unknown pages, 451 content stays sealed). Contract: default export (ctx) => ({ handle(req, res, url) }),
// ctx = { dataDir, storage: { read, write, list }, log, name }.
//
// API below the application's base (<base>api/…; JSON; writes need `Authorization: Bearer <token>`: env KP_TOKEN, else a
// token generated on the first start, kept in the storage and printed to the log):
//   GET    api/info                     { app: 'site-studio', version, auth: true }
//   GET    api/kbs                      [{ id, title, updated, rev, pages }]
//   GET    api/kbs/<id>                 the knowledge base (media without bytes)
//   PUT    api/kbs/<id>                 { kb, baseRev? } -> { ok, rev } | 409 when the stored revision is newer
//   DELETE api/kbs/<id>
//   GET    api/kbs/<id>/media/<mid>     the bytes of a media file
//   PUT    api/kbs/<id>/media/<mid>?type=   raw bytes
// Storage keys: 'token', 'kb:<id>' (the base), 'media:<id>:<mid>' ({ type, data: base64 }).
import { normKB, ID_RE } from './wiki-model.js';
import { createKBHandler, bearer, readBody, sameToken } from './wiki-kb-server.js';
import { b64decode, b64encode } from '../codec/base64.js';
import { decompress } from '../codec/deflate.js';

// Design rules:
// - Storage is a synchronous key-value store owned by the host (hosting.js); this module never touches the file
// system itself, so the same code runs under any host that provides { read, write, list }.
// - Reads are cached in memory (kbCache) because every public page request needs the KB; writes go through this
// module only, so the cache stays coherent as long as one process owns the data directory.
// - Fail closed: every write requires the bearer token; ids are validated with ID_RE before they become storage keys
// (an unchecked id like '../x' or 'a:b' could collide with another key namespace).
const READER_URL = new URL('./wiki-reader-boot.js?bundle', import.meta.url);

// The reader bundle: inline gzip data: URL in built artifacts; in the sources (development server) the bundler makes it.
// Lazy: most requests are API calls; the bundle is decoded on the first public page view only.
async function loadReader() {
  const u = String(READER_URL);
  if (u.startsWith('data:')) return new TextDecoder().decode(await decompress(b64decode(u.slice(u.indexOf(',') + 1)), 'gzip'));
  // Computed specifiers: the build must not inline these (they only run from the sources).
  const rel = (p) => new URL([...p].join(''), import.meta.url);
  const { assetBundle } = await import(rel(['..', '/', 'bundle.js']).href);
  const { fileURLToPath } = await import(['node', 'url'].join(':'));
  const file = fileURLToPath(rel(['.', '/', 'wiki-reader-boot.js']));
  const root = fileURLToPath(rel(['..', '/']));
  return new TextDecoder().decode(await decompress(assetBundle(file, root).bytes, 'gzip'));
}

// Content-Length from the encoded bytes, not v.length: UTF-8 titles make the byte count larger than the string
// length. no-store: API answers are revisioned state. nosniff: a JSON body must never be sniffed as HTML.
const json = (res, status, v) => {
  const body = new TextEncoder().encode(JSON.stringify(v));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
};

export default function backend(ctx) {
  const { storage, log } = ctx;
  // Token resolution: env KP_TOKEN (operator's choice) > stored token > fresh random one. 24 random bytes -> base64 with
  // +/= removed -> 32 chars: URL- and header-safe, ~190 bits even after stripping. Persisted so restarts keep it.
  // It is printed to the log on purpose: the operator has no other channel to learn a generated token.
  let token = (globalThis.process && process.env && process.env.KP_TOKEN) || storage.read('token');
  if (!token) {
    const b = new Uint8Array(24);
    globalThis.crypto.getRandomValues(b);
    token = b64encode(b).replace(/[+/=]/g, '').slice(0, 32);
    storage.write('token', token);
  }
  log(`site-studio: editing token ${token} (set KP_TOKEN to choose one)`);
  let readerP = null;
  // Promise memo with reset on failure: concurrent first views share one decode; an error is retried.
  const reader = () => (readerP || (readerP = loadReader().catch((e) => { readerP = null; throw e; })));
  const handlers = new Map(); // kb id -> { base, handler }
  const kbCache = new Map();
  const getKB = (id) => {
    if (!kbCache.has(id)) { const v = storage.read('kb:' + id); kbCache.set(id, v ? normKB(v) : null); }
    return kbCache.get(id);
  };
  // sameToken (kb-server.js) compares in constant time; a plain === leaks the matching prefix length by timing.
  const authed = (req) => sameToken(bearer(req), token);

  // One kb-server handler per (prefix, id), created on demand and kept: the handler holds its render caches. getKB is
  // passed as a function, so a PUT that replaces the cached KB is seen on the next request without rebuilding it.
  function siteHandler(prefix, id) {
    const base = prefix + 'kb/' + encodeURIComponent(id) + '/';
    let h = handlers.get(base);
    if (!h) {
      h = createKBHandler({
        base, style: 'clean', log, readerJS: reader,
        getKB: () => getKB(id),
        getMedia: (mid) => { const m = storage.read('media:' + id + ':' + mid); return m ? { body: b64decode(m.data), type: m.type } : null; },
      });
      handlers.set(base, h);
    }
    return h;
  }

  async function api(req, res, rest) {
    // Segments decoded one by one (an encoded '/' stays inside its segment); a malformed escape is kept raw.
    const parts = rest.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
    if (parts[0] === 'info') { json(res, 200, { app: 'site-studio', version: 1, auth: true }); return true; }
    if (parts[0] !== 'kbs') { json(res, 404, { error: 'not found' }); return true; }
    // Reads are public (the published site is public anyway); any method that changes state needs the token.
    const write = req.method !== 'GET' && req.method !== 'HEAD';
    if (write && !authed(req)) { json(res, 401, { error: 'unauthorized' }); return true; }
    if (parts.length === 1 && req.method === 'GET') {
      // Newest first; String() guards against a KB without `updated` (localeCompare on undefined would throw).
      const list = storage.list('kb:').map((k) => getKB(k.slice(3))).filter(Boolean)
        .map((kb) => ({ id: kb.id, title: kb.title, updated: kb.updated, rev: kb.rev, pages: kb.pages.length }))
        .sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
      json(res, 200, list);
      return true;
    }
    const id = parts[1];
    if (!ID_RE.test(id || '')) { json(res, 400, { error: 'bad id' }); return true; }
    if (parts.length === 2) {
      if (req.method === 'GET') {
        const kb = getKB(id);
        if (!kb) { json(res, 404, { error: 'not found' }); return true; }
        // Media metadata without bytes: the client fetches each file separately, keeping the KB document small.
        const out = { ...kb, media: Object.fromEntries(Object.entries(kb.media).map(([k, m]) => [k, { ...m, data: undefined }])) };
        json(res, 200, out);
        return true;
      }
      if (req.method === 'PUT') {
        let body;
        try { body = JSON.parse(new TextDecoder().decode(await readBody(req, 64 * 1024 * 1024))); } catch (e) { json(res, e.status || 400, { error: 'bad JSON' }); return true; }
        // Optimistic concurrency: reject when the stored revision is newer than the client's base. An absent baseRev is an
        // explicit overwrite (the editor's "overwrite" action after a 409). The server, not the client, assigns rev and
        // updated, so clocks of editors never matter. normKB sanitises the untrusted body to the model's shape.
        const cur = getKB(id);
        if (cur && typeof body.baseRev === 'number' && cur.rev > body.baseRev) { json(res, 409, { error: 'conflict', rev: cur.rev }); return true; }
        const kb = normKB(body && body.kb ? body.kb : body);
        kb.id = id;
        kb.rev = (cur ? cur.rev : 0) + 1;
        kb.updated = new Date().toISOString();
        for (const m of Object.values(kb.media)) delete m.data;
        storage.write('kb:' + id, kb);
        kbCache.set(id, kb);
        log('saved knowledge base', id, kb.title, 'rev', kb.rev);
        json(res, 200, { ok: true, rev: kb.rev, updated: kb.updated });
        return true;
      }
      // KNOWN DEFECT: deleting a KB leaves its 'media:<id>:*' keys in storage (orphaned bytes, and a KB re-created with
      // the same id would inherit them). Fix: storage.list('media:' + id + ':') and write null for each key.
      if (req.method === 'DELETE') {
        storage.write('kb:' + id, null);
        kbCache.delete(id);
        json(res, 200, { ok: true });
        return true;
      }
    }
    if (parts.length === 4 && parts[2] === 'media' && ID_RE.test(parts[3])) {
      const key = 'media:' + id + ':' + parts[3];
      if (req.method === 'GET') {
        const m = storage.read(key);
        if (!m) { json(res, 404, { error: 'not found' }); return true; }
        const bytes = b64decode(m.data);
        res.writeHead(200, { 'Content-Type': m.type || 'application/octet-stream', 'Content-Length': bytes.length, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
        res.end(bytes);
        return true;
      }
      if (req.method === 'PUT') {
        let bytes;
        try { bytes = await readBody(req, 128 * 1024 * 1024); } catch (e) { json(res, e.status || 400, { error: e.message }); return true; }
        const type = new URL(req.url, 'http://x').searchParams.get('type') || 'application/octet-stream';
        // MIME whitelist by shape (type/subtype of token characters): the stored type is echoed back as Content-Type, so a
        // value with ';' or CR/LF could inject header parameters. Anything else degrades to octet-stream.
        storage.write(key, { type: /^[\w.+-]+\/[\w.+-]+$/.test(type) ? type : 'application/octet-stream', data: b64encode(bytes) });
        json(res, 200, { ok: true, size: bytes.length });
        return true;
      }
    }
    json(res, 405, { error: 'method not allowed' });
    return true;
  }

  return {
    async handle(req, res, url) {
      let p;
      try { p = decodeURIComponent(url.pathname); } catch { return false; }
      // The application may live below a prefix (the development server serves it at /site-studio/).
      // Lazy (.*?) prefix: the FIRST api/ or kb/ segment wins, so a page slug containing 'api/' below kb/<id>/ is not
      // mistaken for the API. Unknown KB ids return false (not 404) so the host can try its other handlers.
      const m = /^(.*?\/)(api|kb)\/(.*)$/.exec(p);
      if (!m) return false;
      const [, prefix, kind, rest] = m;
      if (kind === 'api') return api(req, res, rest);
      const id = rest.split('/')[0];
      if (!ID_RE.test(id) || !getKB(id)) return false;
      return siteHandler(prefix, id).handle(req, res, url);
    },
  };
}
