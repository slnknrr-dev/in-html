// site-studio/wiki-remote.js - the network side of the editor (not in offline artifacts: remote.offline.js has the
// same exports without network code): the application's own backend (backend.js: knowledge bases stored on the
// server, published under kb/<id>/) and the editing API of exported knowledge base servers (kb-server.js).
//
//   REMOTE                                   true here, false offline
//   appAPI()                                 base URL of the application's backend API ('api/' next to the page)
//   probeBackend() -> Promise<info | null>   { app, auth, version } when the page is served by backend.js
//   listServerKBs() / getServerKB(id) / putServerKB(kb, token, baseRev) / deleteServerKB(id, token)
//   getServerMedia(kbId, id) -> Blob | null   putServerMedia(kbId, id, blob, token)
//   publishToKBServer(url, token, kb, getBlob, onProgress)   PUT <url>/_kp/api/kb and every media file
// Design rules:
// - Every request goes through call(): one place for no-store caching, JSON parsing and error shaping. Errors carry
// .status and .body so callers can branch on 409 (revision conflict) or 401 (bad token) without reparsing text.
// - Ids are encodeURIComponent'ed into paths: an id with '/' or '?' must not re-route the request.
// - Tokens travel only in the Authorization header, never in the URL (URLs end up in logs and history).
export const REMOTE = true;

// Relative to the page, not the origin root: the app may be mounted under a sub-path (host/studio/).
export const appAPI = () => new URL('api/', location.href).href;

// cache:'no-store': KB documents are mutable and revisioned; a cached GET would return a stale baseRev and make the
// next PUT fail with a conflict. JSON is parsed only when the server declares it: an HTML error page from a proxy
// would throw in r.json() and mask the real status. The server's own {error} text wins over a generic 'HTTP n'.
async function call(url, opts = {}) {
  const r = await fetch(url, { cache: 'no-store', ...opts });
  let body = null;
  const type = r.headers.get('content-type') || '';
  if (type.includes('json')) { try { body = await r.json(); } catch { body = null; } }
  if (!r.ok) throw Object.assign(new Error((body && body.error) || 'HTTP ' + r.status), { status: r.status, body });
  return body;
}
const auth = (token) => (token ? { Authorization: 'Bearer ' + token } : {});

// Detection, not configuration: the same editor build runs from file://, a static host or backend.js. file: is
// short-circuited (a relative fetch there fails or reads the disk). The app id check rejects any other server that
// happens to answer api/info with JSON. Never throws: no backend is a normal state, not an error.
export async function probeBackend() {
  if (location.protocol === 'file:') return null;
  try {
    const info = await call(appAPI() + 'info');
    return info && info.app === 'site-studio' ? info : null;
  } catch { return null; }
}

export const listServerKBs = () => call(appAPI() + 'kbs');
export const getServerKB = (id) => call(appAPI() + 'kbs/' + encodeURIComponent(id));
// baseRev: optimistic concurrency. The server rejects the write when its revision differs instead of silently
// overwriting a concurrent editor (last-writer-wins would lose data).
export const putServerKB = (kb, token, baseRev) => call(appAPI() + 'kbs/' + encodeURIComponent(kb.id), {
  method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth(token) }, body: JSON.stringify({ kb, baseRev }),
});
export const deleteServerKB = (id, token) => call(appAPI() + 'kbs/' + encodeURIComponent(id), { method: 'DELETE', headers: auth(token) });
// Raw fetch, not call(): binary body, and a missing file is a normal outcome (null), not an error.
export async function getServerMedia(kbId, id) {
  const r = await fetch(appAPI() + 'kbs/' + encodeURIComponent(kbId) + '/media/' + encodeURIComponent(id), { cache: 'no-store' });
  return r.ok ? r.blob() : null;
}
// octet-stream body plus the real MIME in ?type=: the server stores the bytes verbatim and must not try to parse them;
// the declared type is metadata for serving the file back.
export const putServerMedia = (kbId, id, blob, token) => call(appAPI() + 'kbs/' + encodeURIComponent(kbId) + '/media/' + encodeURIComponent(id) + '?type=' + encodeURIComponent(blob.type), {
  method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', ...auth(token) }, body: blob,
});

// Order matters: media first, KB document last. The document references media ids; landing it first would show
// broken images to a reader arriving mid-upload. Progress has ids.length + 1 steps (the +1 is the document).
// Secret (password-encrypted) media and secret labels/routes are stripped: an exported server is public and those
// fields would reveal what the encrypted pages hold. `remote` (sync target) and inline media `data` are editor-local.
// The deep copy is a JSON round trip: safe because a KB is plain JSON (no Dates, Maps, Blobs).
// The media id is concatenated unencoded, unlike the routes above: safe only because ids match ID_RE (model.js,
// [a-z][a-z0-9]*); encodeURIComponent(id) would make the route robust if that invariant ever loosens.
export async function publishToKBServer(url, token, kb, getBlob, onProgress = () => {}) {
  // Exactly one trailing slash, so 'host/kb' and 'host/kb/' resolve the same API.
  const base = String(url).replace(/\/*$/, '/');
  const ids = Object.keys(kb.media).filter((id) => !kb.media[id].secret);
  let n = 0;
  for (const id of ids) {
    const b = await getBlob(id);
    if (b) await call(base + '_kp/api/media/' + id + '?type=' + encodeURIComponent(kb.media[id].type) + '&name=' + encodeURIComponent(kb.media[id].name), { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', ...auth(token) }, body: b });
    onProgress(++n / (ids.length + 1));
  }
  const plain = JSON.parse(JSON.stringify(kb));
  delete plain.remote;
  for (const [id, m] of Object.entries(plain.media)) { if (m.secret) delete plain.media[id]; else delete m.data; }
  for (const p of plain.pages) for (const s of p.secrets || []) { s.label = ''; s.route = ''; }
  const r = await call(base + '_kp/api/kb', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth(token) }, body: JSON.stringify({ kb: plain }) });
  onProgress(1);
  return r;
}
