// bookmarks-editor/remote.js - the client of the hosted service's JSON API (service.js). Same-origin pages send the
// session cookie; other pages (the standalone file) send a bearer token and never cookies.
//
//   const api = createRemote({ base: 'https://bm.example', token })   base '' = this page's origin
//   api.info() session() setup(body) login(body) logout() register(body) sync(since, changes) meta(url)
//   api.password(old, next) tokens() createToken(label) revokeToken(id) users() deleteUser(name) invites()
//   api.createInvite(days) deleteInvite(id) config() saveConfig(cfg)
//   RemoteError: { status, code, message, data }   status 0 = the network failed (offline, CORS, refused)

// One error type for HTTP and network failures: callers branch on status (0 / 401 / other) and code, never on
// message text, which may be localised or come from a proxy.
export class RemoteError extends Error {
  constructor(status, code, message, data) { super(message || code); this.status = status; this.code = code; this.data = data; }
}

export function createRemote({ base = '', token = '' } = {}) {
  const root = String(base || '').replace(/\/+$/, '') + '/api';
  // cache:'no-store': API answers are live state; an HTTP cache would replay an old session or sync result.
  // credentials: a token page must not also send cookies (a stale cookie for the same host would mix identities);
  // a same-origin page has no token and relies on the HttpOnly session cookie.
  // Content-Type only when there is a body: a GET with application/json would turn a cross-origin call into a
  // preflighted request for no reason.
  async function call(method, path, body) {
    let res;
    try {
      res = await fetch(root + path, {
        method, cache: 'no-store', credentials: token ? 'omit' : 'same-origin', referrerPolicy: 'no-referrer',
        headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) { throw new RemoteError(0, 'network', String(e && e.message || e)); }
    let data = null;
    // Non-JSON bodies (proxy error pages, empty 204) become null instead of throwing a parse error over the real one.
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) throw new RemoteError(res.status, (data && data.error) || 'http_' + res.status, (data && data.message) || res.statusText, data);
    return data;
  }
  return {
    // base = root without the '/api' suffix (4 chars), i.e. the normalised server address for display and links.
    base: root.slice(0, -4), token,
    info: () => call('GET', '/info'),
    session: () => call('GET', '/session'),
    setup: (b) => call('POST', '/setup', b),
    login: (b) => call('POST', '/login', b),
    logout: () => call('POST', '/logout', {}),
    register: (b) => call('POST', '/register', b),
    sync: (since, changes) => call('POST', '/sync', { since, changes }),
    meta: (url) => call('GET', '/meta?url=' + encodeURIComponent(url)),
    password: (old, next) => call('POST', '/password', { old, new: next }),
    tokens: () => call('GET', '/tokens'),
    createToken: (label) => call('POST', '/tokens', { label }),
    revokeToken: (id) => call('DELETE', '/tokens/' + encodeURIComponent(id)),
    users: () => call('GET', '/users'),
    deleteUser: (name) => call('DELETE', '/users/' + encodeURIComponent(name)),
    invites: () => call('GET', '/invites'),
    createInvite: (days) => call('POST', '/invites', { days }),
    deleteInvite: (id) => call('DELETE', '/invites/' + encodeURIComponent(id)),
    config: () => call('GET', '/config'),
    saveConfig: (cfg) => call('PUT', '/config', cfg),
  };
}
