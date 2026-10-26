// embroidery-studio/remote.js - the network side (not in offline artifacts: remote.offline.js has the same exports
// without network code): the scheme site of a static host (catalog/index.json and catalog/<id>.json next to the
// page, written by "Publish as a static site") and the application's backend (backend.js: catalogue, uploads,
// moderation, readers' progress).
//
//   REMOTE                                        true here
//   probeBackend() -> { app, version, moderation } | null
//   siteIndex() -> { items } | null               siteScheme(id) -> scheme JSON
//   serverList() -> { items }                     serverScheme(id) -> scheme JSON      serverHit(id, kind)
//   upload({ scheme, meta, thumb, contact }) -> { id, status }
//   modList(token) -> { items }                   modAction(token, id, action, patch)   modScheme(token, id)
//   progressGet(reader, key) -> progress | null   progressPut(reader, key, progress)

// URLs are resolved against location.href, so the app works under any sub-path of a host (no absolute /api).
// cache:no-store for API calls (live data); the static catalogue index uses no-cache (revalidate, but let the
// browser keep an ETag copy). The build swaps this module for remote.offline.js, so offline files contain no fetch.
export const REMOTE = true;

const api = (p) => new URL('api/' + p, location.href).href;

async function call(url, opts = {}) {
  const r = await fetch(url, { cache: 'no-store', ...opts });
  let body = null;
  if ((r.headers.get('content-type') || '').includes('json')) { try { body = await r.json(); } catch { body = null; } }
  if (!r.ok) throw Object.assign(new Error((body && body.error) || 'HTTP ' + r.status), { status: r.status, body });
  return body;
}
const json = (method, body, token) => ({ method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
const auth = (token) => ({ headers: { Authorization: 'Bearer ' + token } });

// From file:// there is no server; skip the request instead of producing a console error.
export async function probeBackend() {
  if (!/^https?:$/.test(location.protocol)) return null;
  try {
    const info = await call(api('info'));
    return info && info.app === 'embroidery-studio' ? info : null;
  } catch { return null; }
}

export async function siteIndex() {
  if (!/^https?:$/.test(location.protocol)) return null;
  try {
    const r = await fetch(new URL('catalog/index.json', location.href).href, { cache: 'no-cache' });
    if (!r.ok) return null;
    const v = await r.json();
    return v && Array.isArray(v.items) ? v : null;
  } catch { return null; }
}
export const siteScheme = (id) => call(new URL('catalog/' + encodeURIComponent(id) + '.json', location.href).href);

export const serverList = () => call(api('schemes'));
export const serverScheme = (id) => call(api('schemes/' + encodeURIComponent(id)));
export const serverHit = (id, kind) => call(api('schemes/' + encodeURIComponent(id) + '/hit'), json('POST', { kind })).catch(() => null);
export const upload = (body) => call(api('uploads'), json('POST', body));
export const modList = (token) => call(api('moderation'), auth(token));
export const modScheme = (token, id) => call(api('moderation/' + encodeURIComponent(id)), auth(token));
export const modAction = (token, id, action, patch = {}) => call(api('moderation/' + encodeURIComponent(id)), json('POST', { action, ...patch }, token));
export async function progressGet(reader, key) {
  try { return await call(api('progress/' + encodeURIComponent(reader) + '/' + encodeURIComponent(key))); } catch (e) { if (e.status === 404) return null; throw e; }
}
export const progressPut = (reader, key, progress) => call(api('progress/' + encodeURIComponent(reader) + '/' + encodeURIComponent(key)), json('PUT', progress));
