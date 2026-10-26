// knowledge-processor/remote.js - the network side of the editor (not in offline artifacts: remote.offline.js has the
// same exports without network code): the application's own backend (backend.js: knowledge bases stored on the
// server, published under kb/<id>/) and the editing API of exported knowledge base servers (kb-server.js).
//
//   REMOTE                                   true here, false offline
//   appAPI()                                 base URL of the application's backend API ('api/' next to the page)
//   probeBackend() -> Promise<info | null>   { app, auth, version } when the page is served by backend.js
//   listServerKBs() / getServerKB(id) / putServerKB(kb, token, baseRev) / deleteServerKB(id, token)
//   getServerMedia(kbId, id) -> Blob | null   putServerMedia(kbId, id, blob, token)
//   publishToKBServer(url, token, kb, getBlob, onProgress)   PUT <url>/_kp/api/kb and every media file
export const REMOTE = true;

// Resolved against location.href, not '/api/': the app may be published under a sub-path (kb/<id>/, a user
// folder); a root-absolute URL would hit another site's API.
export const appAPI = () => new URL('api/', location.href).href;

// Single fetch wrapper: cache 'no-store' because these are live editing endpoints (a cached GET after a PUT
// would show stale revisions). JSON is parsed only when the server says so; a non-JSON error body (proxy HTML)
// must not mask the HTTP status. Errors carry status and body so callers can tell 409 (conflict) from 401.
async function call(url, opts = {}) {
  const r = await fetch(url, { cache: 'no-store', ...opts });
  let body = null;
  const type = r.headers.get('content-type') || '';
  if (type.includes('json')) { try { body = await r.json(); } catch { body = null; } }
  if (!r.ok) throw Object.assign(new Error((body && body.error) || 'HTTP ' + r.status), { status: r.status, body });
  return body;
}
// Bearer header only when a token exists: an empty "Bearer " would be rejected rather than treated as anonymous.
const auth = (token) => (token ? { Authorization: 'Bearer ' + token } : {});

// file: pages cannot have a backend; skipping the fetch avoids a console CORS/scheme error. The `app` field
// check rejects a different server that happens to answer api/info (shared host, other app).
export async function probeBackend() {
  if (location.protocol === 'file:') return null;
  try {
    const info = await call(appAPI() + 'info');
    return info && info.app === 'knowledge-processor' ? info : null;
  } catch { return null; }
}

export const listServerKBs = () => call(appAPI() + 'kbs');
export const getServerKB = (id) => call(appAPI() + 'kbs/' + encodeURIComponent(id));
// baseRev = revision the edit started from: the server rejects the PUT if another writer advanced it
// (optimistic concurrency, no locks).
export const putServerKB = (kb, token, baseRev) => call(appAPI() + 'kbs/' + encodeURIComponent(kb.id), {
  method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth(token) }, body: JSON.stringify({ kb, baseRev }),
});
export const deleteServerKB = (id, token) => call(appAPI() + 'kbs/' + encodeURIComponent(id), { method: 'DELETE', headers: auth(token) });
// Plain fetch (not call()): a missing file is a normal null, and the body is binary, not JSON.
export async function getServerMedia(kbId, id) {
  const r = await fetch(appAPI() + 'kbs/' + encodeURIComponent(kbId) + '/media/' + encodeURIComponent(id), { cache: 'no-store' });
  return r.ok ? r.blob() : null;
}
// Raw bytes as the body (no multipart, no base64: smaller and streamable); the real MIME type travels in the
// query because Content-Type is fixed to octet-stream so no proxy rewrites or sniffs the payload.
export const putServerMedia = (kbId, id, blob, token) => call(appAPI() + 'kbs/' + encodeURIComponent(kbId) + '/media/' + encodeURIComponent(id) + '?type=' + encodeURIComponent(blob.type), {
  method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', ...auth(token) }, body: blob,
});

// Order matters: media first, KB JSON last. A reader of the exported server never sees pages referencing files
// that are not uploaded yet; if publishing dies halfway the old KB stays live. Progress denominator ids+1
// counts the final KB PUT as one step.
export async function publishToKBServer(url, token, kb, getBlob, onProgress = () => {}) {
  const base = String(url).replace(/\/*$/, '/');
  // Secret media are excluded: their bytes live only inside the sealed envelopes; uploading them would leak them.
  const ids = Object.keys(kb.media).filter((id) => !kb.media[id].secret);
  let n = 0;
  for (const id of ids) {
    const b = await getBlob(id);
    if (b) await call(base + '_kp/api/media/' + id + '?type=' + encodeURIComponent(kb.media[id].type) + '&name=' + encodeURIComponent(kb.media[id].name), { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', ...auth(token) }, body: b });
    onProgress(++n / (ids.length + 1));
  }
  // Deep clone via JSON: the live kb must not be mutated (the editor keeps using it). Stripped before upload:
  // `remote` (this editor's server binding), secret media records, inline `data` (bytes already uploaded), and
  // the editor-only labels/routes of secrets, which would reveal what hides behind a 451 envelope.
  const plain = JSON.parse(JSON.stringify(kb));
  delete plain.remote;
  for (const [id, m] of Object.entries(plain.media)) { if (m.secret) delete plain.media[id]; else delete m.data; }
  for (const p of plain.pages) for (const s of p.secrets || []) { s.label = ''; s.route = ''; }
  const r = await call(base + '_kp/api/kb', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth(token) }, body: JSON.stringify({ kb: plain }) });
  onProgress(1);
  return r;
}
