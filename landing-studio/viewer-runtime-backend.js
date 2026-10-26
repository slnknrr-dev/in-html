// landing-studio/viewer-runtime-backend.js - runtime features of pages exported with a backend or as an archive
// (serialized with Function.prototype.toString like viewer-runtime.js; CONTRACT.md §8, §16):
//   rtApi     'local:' endpoints go to the same-origin server (cfg.api), with a static fallback for plain hosting
//   rtAssets  attachments kept as files next to the page (cfg.atts[id][2] = 'assets/…')
// Same rules as every rt* function: only R, locals and browser globals; ES5-ish; no UI text; never throws.

/* ---------- api ---------- */

// cfg.api = { m: 'server' | 'auto', b: base path ('' = the page's folder), pub: [public collections],
// out: [collections whose writes reach the site owner: forms, orders, chat] }.
// R.req is wrapped: 'local:<collection>[/<key>]' requests go to `<b>api/<collection>[/<key>]` on the same origin
// (credentials same-origin; opt.query appends a query string); other URLs keep their way. 'auto' first probes
// `<b>api/_ping` (2.5 s, no retries): without a server the page runs static — GET of a public collection reads
// `<b>data/<collection>.json`, writes to `out` collections answer {ok:false, error:'static'} (callers fall back to
// their channel or outbox), and everything else (the cart) stays a browser-local endpoint. A static page probes
// again when the browser comes online.
// R.api = { state() → 1 server | -1 static | 0 probing, ready(fn(online)) }; <html> gets lp-api-on | lp-api-off;
// event 'lp:api' {online}.
// Why probe instead of trusting the export option: the same backend package may be uploaded to a static host (or
// opened from disk), and the page must keep working there. A failed probe is not an error state but a mode.
// Decorator pattern: R.req is wrapped, not replaced, so every feature keeps calling one function and stays unaware
// of where 'local:' requests actually go.
function rtApi(R) {
  var a = R.cfg.api;
  if (!a || typeof a !== 'object' || !R.net || !R.req || !R.reqExpand) return;
  var hop = Object.prototype.hasOwnProperty;
  var h = document.documentElement;
  // Relative-path allowlist for the base: cookies ride on same-origin requests, so a tampered config must not be able
  // to redirect them to another host.
  var base = typeof a.b === 'string' && /^(\.\.?\/)*([A-Za-z0-9._~-]+\/)*$/.test(a.b) ? a.b : '';
  var pub = Array.isArray(a.pub) ? a.pub : [];
  var out = Array.isArray(a.out) ? a.out : [];
  var st = a.m === 'server' ? 1 : 0;
  var wait = [];
  // Collection names and keys are constrained before they reach the URL path: no '..', '/', '?' or '#' injection.
  var LOC = /^local:([a-z0-9][a-z0-9._-]{0,39})(?:\/([^?#\/]{1,120}))?$/;
  function mark() {
    h.classList.remove('lp-api-on');
    h.classList.remove('lp-api-off');
    if (st) h.classList.add(st > 0 ? 'lp-api-on' : 'lp-api-off');
  }
  function settle(s) {
    st = s;
    mark();
    var w = wait;
    wait = [];
    w.forEach(function (fn) { try { fn(st > 0); } catch (e) { /* one listener never stops the others */ } });
    R.emit('lp:api', { online: st > 0 });
  }
  function probe() {
    st = 0;
    mark();
    // Strict check (body.ok === true), not just HTTP 200: static hosts often answer unknown paths with a 200 HTML page
    // (SPA fallback, 404.html served as 200), which must not be mistaken for a live server.
    R.net(base + 'api/_ping', { t: 2500, r: 0 }, {}, 'GET', undefined, {}, function (r) {
      settle(r.ok && r.data && typeof r.data === 'object' && r.data.ok === true ? 1 : -1);
    });
  }
  R.api = {
    state: function () { return st; },
    ready: function (fn) { if (st) fn(st > 0); else wait.push(fn); },
  };
  // R.req (rtReq) for every request: 'local:' URLs are routed here (the same placeholder values rtReq uses), the rest
  // and the static case of private collections go back to rtReq (local storage / R.net).
  var req0 = R.req;
  R.req = function (q, vars, body, opt) {
    q = q || {};
    if (!/^local:/.test(String(q.u || ''))) return req0(q, vars, body, opt);
    var c0 = R.cfg;
    var v = { site: c0.id || '', lang: R.lang(), currency: (c0.shop && c0.shop.cur) || '' };
    for (var k in vars || {}) if (hop.call(vars, k)) v[k] = vars[k];
    var m = String(q.m || 'GET').toUpperCase();
    if (!/^(GET|POST|PUT|PATCH|DELETE)$/.test(m)) m = 'GET';
    var mm = LOC.exec(R.reqExpand(q.u, v, true).trim());
    if (!mm) return req0(q, vars, body, opt);
    opt = opt || {};
    return new Promise(function (resolve) {
      R.api.ready(function (on) {
        var c = mm[1];
        if (on) {
          // Query string reduced to unreserved and already-percent-encoded characters: callers build it, but it is
          // appended raw, so anything else is dropped rather than trusted.
          var qy = typeof opt.query === 'string' && opt.query ? '?' + opt.query.replace(/[^A-Za-z0-9._~%=&+-]/g, '') : '';
          R.net(base + 'api/' + c + (mm[2] ? '/' + mm[2] : '') + qy, { h: q.h, c: 'same-origin', t: q.t, r: q.r }, v, m, body, opt, resolve);
        } else if (m === 'GET' && !mm[2] && pub.indexOf(c) >= 0) {
          R.net(base + 'data/' + c + '.json', { t: 8000, r: 1 }, v, 'GET', undefined, {}, resolve);
        } else if (m !== 'GET' && out.indexOf(c) >= 0) {
          resolve(R.reqRes(false, 0, null, 'static'));
        } else {
          req0(q, vars, body, opt).then(resolve);
        }
      });
    });
  };
  mark();
  if (!st) probe();
  // Re-probe only from the static state: a page that lost the network while on a server keeps its mode and lets
  // individual requests fail and retry.
  window.addEventListener('online', function () { if (st < 0) probe(); });
}

/* ---------- assets ---------- */

// Archive exports keep attachments as files: cfg.atts[id] = [name, mime, 'assets/<file>'] → R.url(id) resolves to that
// file (embedded viewers, players, download / open buttons) instead of reading a store script.
function rtAssets(R) {
  var atts = R.cfg.atts || {};
  var url0 = R.url;
  if (!url0) return;
  var hop = Object.prototype.hasOwnProperty;
  R.url = function (id) {
    var a = hop.call(atts, id) ? atts[id] : null;
    // Only paths inside an assets/ folder (optionally a few levels up for nested pages): a config value can never make
    // the page load an arbitrary URL as an attachment.
    var f = a && typeof a[2] === 'string' && /^(\.\.\/){0,8}(\.\/)?assets\/[A-Za-z0-9._-]+$/.test(a[2]) ? a[2] : '';
    if (!f) return url0(id);
    var u = f;
    try { u = new URL(f, document.baseURI).href; } catch (e) { u = f; }
    R.u[id] = u;
    return Promise.resolve(u);
  };
}

export {
  rtApi,
  rtAssets
};
