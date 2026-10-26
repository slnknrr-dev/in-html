// landing-studio/viewer-runtime-net.js - R.net of exported landing pages (serialized with Function.prototype.toString
// like viewer-runtime.js): configured requests with timeouts, headers, bodies and JSON answers.
//
// Constraints inherited from serialization: the function body is inlined into the export via toString, so it may
// reference only its parameter R, its own locals and browser globals; no imports, no closures over module scope,
// ES5 syntax (var, function) so old embedded WebViews parse it. It must never throw: every failure ends in
// finish(res(ok=false, status, data, reason)) with a machine reason ('unconfigured', 'unsupported', 'offline',
// 'timeout', 'network', 'http', 'config') the caller maps to UI text.
// Retry policy: exponential backoff 500ms * 2^n capped at 8s, honouring Retry-After; only transient failures retry
// (timeout, network error, 5xx, 429, 408). Other 4xx are the caller's fault and repeating cannot help.

function rtNet(R) {
  var hop = Object.prototype.hasOwnProperty;
  // RFC 9110 token charset: a header name outside it makes fetch() throw synchronously (TypeError), so filter first.
  var HNAME = /^[A-Za-z0-9!#$%&'*+.\^_`|~-]{1,64}$/;
  var res = R.reqRes;
  var expand = R.reqExpand;
  R.net = function (raw, q, v, m, body, opt, finish) {
    var url = '';
    try { url = raw ? new URL(raw, document.baseURI).href : ''; } catch (e) { url = ''; }
    // A relative URL in a file:// page (or in an opaque preview) has no server: stay local, do not fetch.
    if (!/^https?:\/\//i.test(url)) { finish(res(false, 0, null, 'unconfigured')); return; }
    if (typeof fetch !== 'function') { finish(res(false, 0, null, 'unsupported')); return; }
    if (navigator.onLine === false) { finish(res(false, 0, null, 'offline')); return; }
    var hd = {};
    var hs = q.h && typeof q.h === 'object' ? q.h : {};
    for (var n in hs) if (hop.call(hs, n) && HNAME.test(n)) hd[n] = expand(hs[n], v, false).slice(0, 2000);
    // Body only for non-GET: fetch rejects a GET with a body. JSON is the only encoding offered, so the header is fixed.
    var payload;
    if (m !== 'GET' && body !== undefined) {
      payload = JSON.stringify(body);
      hd['Content-Type'] = 'application/json';
    }
    // Idempotency-Key makes retries of mutating requests safe on servers that support it (Stripe-style APIs): a
    // repeated POST after a timeout whose response was lost must not create a second order.
    if (v.key != null && v.key !== '' && (m === 'POST' || m === 'PUT' || m === 'PATCH')) hd['Idempotency-Key'] = String(v.key);
    // Clamp every configured number: the config is author data, a 0 timeout or 100 retries must not hang or flood.
    var tmo = Math.min(60000, Math.max(1000, Number(q.t) || 8000));
    var tries = q.r == null ? 2 : Math.min(5, Math.max(0, Math.floor(Number(q.r)) || 0));
    // Credentials default to 'omit': third-party endpoints must not receive the visitor's cookies unless asked.
    var cred = q.c === 'include' || q.c === 'same-origin' ? q.c : 'omit';
    var n0 = 0;
    function attempt() {
      var fin = false;
      var timedOut = false;
      var ac = null;
      try { ac = new AbortController(); } catch (e) { ac = null; }
      var init = { method: m, headers: hd, credentials: cred, cache: 'no-store', redirect: 'follow' };
      if (payload !== undefined) init.body = payload;
      if (ac) init.signal = ac.signal;
      // keepalive lets a request outlive page unload (form sent on navigation); browsers cap keepalive bodies at
      // 64 KiB in total, so larger bodies would be rejected outright instead of sent normally.
      if (opt.keepalive && payload !== undefined && payload.length < 60000) init.keepalive = true;
      // end() is idempotent (fin flag): the timeout and the fetch promise race, and only the first may report.
      function end(r, retryable, wait) {
        if (fin) return;
        fin = true;
        clearTimeout(tm);
        if (retryable && n0 < tries) {
          var ms = Math.min(8000, wait || 500 * Math.pow(2, n0));
          n0++;
          setTimeout(attempt, ms);
          return;
        }
        finish(r);
      }
      var tm = setTimeout(function () {
        timedOut = true;
        if (ac) { try { ac.abort(); } catch (e) { /* ignore */ } }
        end(res(false, 0, null, 'timeout'), true);
      }, tmo);
      var p;
      try { p = fetch(url, init); } catch (e) { end(res(false, 0, null, 'config'), false); return; }
      p.then(function (r) {
        return r.text().then(function (txt) {
          var data = null;
          // Read as text first: a non-JSON body (HTML error page) is kept as a string instead of failing the parse.
          if (txt) { try { data = JSON.parse(txt); } catch (e) { data = txt; } }
          if (r.ok) { end(res(true, r.status, data, ''), false); return; }
          var st = r.status;
          var ra = 0;
          try { ra = Number(r.headers.get('Retry-After')) * 1000 || 0; } catch (e) { ra = 0; }
          end(res(false, st, data, 'http'), st >= 500 || st === 429 || st === 408, ra);
        });
      }).catch(function () {
        end(res(false, 0, null, timedOut ? 'timeout' : 'network'), true);
      });
    }
    attempt();
  };
}

export { rtNet };
