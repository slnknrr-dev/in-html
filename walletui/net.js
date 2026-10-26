// walletui/net.js - the wallet applications' own backend (BACKEND artifacts): detection and its JSON API next to the
// page. Offline builds use net.offline.js (same exports, no network code).
//
//   ONLINE = true
//   apiBase() -> 'api/' resolved against the page      probeBackend(app) -> Promise<info | null>
//   backendCall(path, { method, body, token }) -> JSON (throws Error with status)
// Two files with identical exports instead of a runtime flag: the offline build swaps the module, so no fetch code
// exists in the artifact at all (the build's network audit can then prove the "offline" claim).
export const ONLINE = true;

export const apiBase = () => new URL('api/', location.href).href;

// Relative 'api/' resolved against the page: works wherever the app is mounted. cache no-store: balances must
// never come from an HTTP cache. Errors carry the HTTP status for callers to branch on (401 vs 5xx).
export async function backendCall(path, { method = 'GET', body, token } = {}) {
  const r = await fetch(apiBase() + path.replace(/^\//, ''), {
    method, cache: 'no-store',
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch { data = null; }
  if (!r.ok) throw Object.assign(new Error((data && data.error) || 'HTTP ' + r.status), { status: r.status });
  return data;
}

// The backend of `app` serves the page when api/info answers with its name.
export async function probeBackend(app) {
  if (location.protocol === 'file:') return null;
  try { const info = await backendCall('info'); return info && info.app === app ? info : null; } catch { return null; }
}
