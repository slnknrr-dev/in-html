// knowledge-processor/backend.js - the backend of the application's BACKEND artifact (hosting.js mounts it; the
// development server `node knowledge-processor/server.js` too): the editor's knowledge bases stored on the server for a
// team, and every stored base published with real routes under kb/<id>/ (kb-server.js: pages rendered per request,
// 404 status for unknown pages, 451 content stays sealed). Contract: default export (ctx) => ({ handle(req, res, url) }),
// ctx = { dataDir, storage: { read, write, list }, log, name }.
//
// API below the application's base (<base>api/…; JSON; writes need `Authorization: Bearer <token>`: env KP_TOKEN, else a
// token generated on the first start, kept in the storage and printed to the log):
//   GET    api/info                     { app: 'knowledge-processor', version, auth: true }
//   GET    api/kbs                      [{ id, title, updated, rev, pages }]
//   GET    api/kbs/<id>                 the knowledge base (media without bytes)
//   PUT    api/kbs/<id>                 { kb, baseRev? } -> { ok, rev } | 409 when the stored revision is newer
//   DELETE api/kbs/<id>
//   GET    api/kbs/<id>/media/<mid>     the bytes of a media file
//   PUT    api/kbs/<id>/media/<mid>?type=   raw bytes
// Storage keys: 'token', 'kb:<id>' (the base), 'media:<id>:<mid>' ({ type, data: base64 }).
//
// Design decisions:
// - Reads are public, writes need the token: the bases are published as sites anyway, so GET carries nothing secret
//   (451 pages stay encrypted inside the base; the server never sees their keys).
// - Optimistic concurrency by revision: a PUT with baseRev older than the stored rev gets 409 and the editor must merge.
//   A PUT without baseRev overwrites (last write wins): the explicit "force" path of the client.
// - Media bytes live under their own keys, never inside the base JSON: the base stays small enough to parse per
//   request on a cold cache, and a 100 MB video does not ride along with every text edit.
// - Every id from the URL is checked against ID_RE before it is used in a storage key: ids become key segments, so
//   an unchecked ':' or '/' could address another base's records.
import { normKB, ID_RE } from './model.js';
import { createKBHandler, bearer, readBody, sameToken } from './kb-server.js';
import { b64decode, b64encode } from '../codec/base64.js';
import { decompress } from '../codec/deflate.js';

// '?bundle' is a bundler directive: in built artifacts this URL is replaced by a gzip+base64 data: URL of the reader
// bundle; from the sources it stays a file URL. The reader is served to browsers at _kp/reader.js of every site.
const READER_URL = new URL('./reader-boot.js?bundle', import.meta.url);

// The reader bundle: inline gzip data: URL in built artifacts; in the sources (development server) the bundler makes it.
async function loadReader() {
  const u = String(READER_URL);
  if (u.startsWith('data:')) return new TextDecoder().decode(await decompress(b64decode(u.slice(u.indexOf(',') + 1)), 'gzip'));
  // Computed specifiers: the build must not inline these (they only run from the sources).
  // Specifiers assembled at run time from pieces (['..', '/', 'bundle.js'].join('')): the bundler resolves only literal
  // import() strings, so it cannot pull the build tooling (bundle.js, node:url) into the artifact.
  const rel = (p) => new URL([...p].join(''), import.meta.url);
  const { assetBundle } = await import(rel(['..', '/', 'bundle.js']).href);
  const { fileURLToPath } = await import(['node', 'url'].join(':'));
  const file = fileURLToPath(rel(['.', '/', 'reader-boot.js']));
  const root = fileURLToPath(rel(['..', '/']));
  return new TextDecoder().decode(await decompress(assetBundle(file, root).bytes, 'gzip'));
}

// no-store: API answers are per-revision state; a cached GET after a PUT would show stale data and cause 409 loops.
// nosniff: browsers must not reinterpret JSON as HTML or script.
const json = (res, status, v) => {
  const body = new TextEncoder().encode(JSON.stringify(v));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
};

export default function backend(ctx) {
  const { storage, log } = ctx;
  // Token precedence: KP_TOKEN env (operator's choice) > stored token > freshly generated. 24 random bytes from the CSPRNG,
  // base64 with +/= removed so it fits in headers and shell commands unquoted; 32 chars still carry about 190 bits.
  // KNOWN DEFECT: the token is printed to the log on every start, so anyone with log access can write. Fix: print it only
  // when generated, or print a fingerprint.
  let token = (globalThis.process && process.env && process.env.KP_TOKEN) || storage.read('token');
  if (!token) {
    const b = new Uint8Array(24);
    globalThis.crypto.getRandomValues(b);
    token = b64encode(b).replace(/[+/=]/g, '').slice(0, 32);
    storage.write('token', token);
  }
  log(`knowledge-processor: editing token ${token} (set KP_TOKEN to choose one)`);
  let readerP = null;
  // Memoised promise: concurrent first requests share one bundle build; on failure the memo is cleared so a later request
  // retries instead of caching the error forever.
  const reader = () => (readerP || (readerP = loadReader().catch((e) => { readerP = null; throw e; })));
  // One kb-server handler per base path (it caches the rendered site); one parsed base per id. Bases are read from storage
  // once and replaced in the cache on PUT, so a GET never re-parses JSON.
  const handlers = new Map(); // kb id -> { base, handler }
  const kbCache = new Map();
  const getKB = (id) => {
    if (!kbCache.has(id)) { const v = storage.read('kb:' + id); kbCache.set(id, v ? normKB(v) : null); }
    return kbCache.get(id);
  };
  const authed = (req) => sameToken(bearer(req), token);

  // prefix keeps the app's mount point (e.g. /knowledge-processor/) in generated links; style 'clean' = /kb/<id>/a/b/.
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

  // decodeURIComponent per segment after splitting, so an encoded %2F stays inside one segment (and then fails ID_RE).
  async function api(req, res, rest) {
    const parts = rest.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
    if (parts[0] === 'info') { json(res, 200, { app: 'knowledge-processor', version: 1, auth: true }); return true; }
    if (parts[0] !== 'kbs') { json(res, 404, { error: 'not found' }); return true; }
    // HEAD counts as a read. Only writes are authenticated, see the design notes.
    const write = req.method !== 'GET' && req.method !== 'HEAD';
    if (write && !authed(req)) { json(res, 401, { error: 'unauthorized' }); return true; }
    if (parts.length === 1 && req.method === 'GET') {
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
        // Media metadata without bytes (data: undefined drops the key in JSON.stringify).
        const out = { ...kb, media: Object.fromEntries(Object.entries(kb.media).map(([k, m]) => [k, { ...m, data: undefined }])) };
        json(res, 200, out);
        return true;
      }
      // 64 MB body cap protects memory: readBody rejects with status 413 and destroys the socket past the limit.
      if (req.method === 'PUT') {
        let body;
        try { body = JSON.parse(new TextDecoder().decode(await readBody(req, 64 * 1024 * 1024))); } catch (e) { json(res, e.status || 400, { error: 'bad JSON' }); return true; }
        const cur = getKB(id);
        if (cur && typeof body.baseRev === 'number' && cur.rev > body.baseRev) { json(res, 409, { error: 'conflict', rev: cur.rev }); return true; }
        const kb = normKB(body && body.kb ? body.kb : body);
        // Server-owned fields are overwritten whatever the client sent: id from the URL, rev incremented, updated = server clock
        // (client clocks disagree; ordering by them would be meaningless).
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
      // storage.write(key, null) = delete in the ctx storage contract.
      // KNOWN DEFECT: the media records 'media:<id>:*' of the deleted base are left behind and keep occupying storage.
      // Fix: storage.list('media:' + id + ':') and write null to each.
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
        // The MIME type is a client-supplied query value and is later echoed as Content-Type: restricted to type/subtype
        // characters, so it cannot inject header text or smuggle parameters. Bytes stored base64 because the ctx storage holds JSON.
        const type = new URL(req.url, 'http://x').searchParams.get('type') || 'application/octet-stream';
        storage.write(key, { type: /^[\w.+-]+\/[\w.+-]+$/.test(type) ? type : 'application/octet-stream', data: b64encode(bytes) });
        json(res, 200, { ok: true, size: bytes.length });
        return true;
      }
    }
    json(res, 405, { error: 'method not allowed' });
    return true;
  }

  return {
    // Returns false for anything not ours so the host (hosting.js / dev server) can serve static files. A malformed
    // percent-encoding is also "not ours" rather than a 500.
    async handle(req, res, url) {
      let p;
      try { p = decodeURIComponent(url.pathname); } catch { return false; }
      // The application may live below a prefix (the development server serves it at /knowledge-processor/).
      const m = /^(.*?\/)(api|kb)\/(.*)$/.exec(p);
      if (!m) return false;
      const [, prefix, kind, rest] = m;
      if (kind === 'api') return api(req, res, rest);
      const id = rest.split('/')[0];
      // Unknown base ids fall through to the host (its own 404), so this backend never shadows other routes under kb/.
      if (!ID_RE.test(id) || !getKB(id)) return false;
      return siteHandler(prefix, id).handle(req, res, url);
    },
  };
}
