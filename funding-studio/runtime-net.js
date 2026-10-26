// funding-studio/runtime-net.js - R.json of exported funding pages (serialized with Function.prototype.toString like
// runtime.js): fetch with a timeout, JSON in and out, HTTP errors rejected with .status.

// credentials:'omit' - the backend uses no cookies, and sending none means a cross-origin request never carries the
// donor's cookies for that host. cache:'no-store' - live figures and donation status must not come from HTTP cache.
// Timeout through AbortController (15 s default); engines without it simply have no timeout. The body is read as
// text and parsed defensively, so an HTML error page from a proxy becomes an Error with .status, not a SyntaxError.
function rtNet(R) {
  R.json = function (url, o) {
    o = o || {};
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, o.timeout || 15000) : null;
    var init = { method: o.method || 'GET', credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/json' }, signal: ctl ? ctl.signal : undefined };
    if (o.body !== undefined) { init.method = o.method || 'POST'; init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(o.body); }
    return fetch(url, init).then(function (r) {
      if (timer) clearTimeout(timer);
      return r.text().then(function (t) {
        var j = null;
        try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
        if (!r.ok) { var err = new Error((j && j.error) || 'HTTP ' + r.status); err.status = r.status; err.body = j; throw err; }
        return j;
      });
    }, function (e) { if (timer) clearTimeout(timer); throw e; });
  };
}

export { rtNet };
