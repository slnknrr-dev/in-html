// event-invite/net.js - the one door of the designer and guests pages to the network (an RSVP server the host
// configures: publish an invitation, pull replies). Offline builds take net.offline.js (bundle.js resolves ./net.js to
// it), which has the same exports and no network code.
export const ONLINE = true;

// JSON request with a timeout; throws Error(server `error` field, else "HTTP <status>").
// - AbortController + setTimeout: fetch has no timeout of its own; a dead server would hang the UI forever.
//   clearTimeout in finally, so a fast answer does not leave a pending abort that fires later.
// - Base URL trailing slashes stripped: users paste "https://host/" and "https://host"; both must give one '/'.
// - Content-Type only when a body exists: a GET with Content-Type: application/json is a non-simple CORS request
//   and costs a preflight for nothing.
// - r.json() failure becomes {} so an HTML error page (proxy 502) still yields a readable "HTTP 502".
export async function api(base, path, { method = 'GET', body, token, timeout = 15000 } = {}) {
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(String(base).replace(/\/+$/, '') + '/' + path, {
      method, signal: ctl.signal,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
    return data;
  } finally { clearTimeout(tm); }
}
