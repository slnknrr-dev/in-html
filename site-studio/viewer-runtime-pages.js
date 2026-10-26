// site-studio/viewer-runtime-pages.js - the router of multi-page exports (feature `pages`, CONTRACT.md §18)
// and the head script of path-routed pages, serialized with Function.prototype.toString like viewer-runtime.js (only
// R, locals and browser globals; ES5-ish; no UI text; never throws).
//
// DOM: every page is a <main class="lp-main" data-lp-page="<slug>"> under .lp-root (home: '', "Not found": '404'),
// all but the shown one `hidden`; nav page links carry data-lp-pg="<slug>". cfg.pg (viewer-pages.js pagesCfg):
//   m  'h' hash routes (#/<slug>; single file, file://)
//      'p' path routes under a base path (404.html of an archive; the head script detected base and route)
//      'a' the single file deployed as index.html and 404.html: path routes on http(s) when the URL is not a hash
//          route, else hash routes
//   b  configured base path ('' = detected), r [{ s slug, t {lang: title}, d {lang: description}, x noindex }]

/* ---------- head script (path routes) ---------- */

// Runs first in <head> of path-routed pages (404.html, the single file as 404.html) with c = { m, b, r: [slugs], i
// (1: an index document — an empty rest is the home page), a (1: insert <base href> so relative URLs of assets,
// styles and links resolve against the site root) }. Finds the base path and the route of location.pathname, writes
// them to <html data-lp-base data-lp-route> and shows the right page before the body is parsed (no flash of another
// page). Base: the configured one when the path starts with it; else the shortest prefix whose rest names a page
// (case-insensitive, '.html' / 'index.html' / trailing slash variants); else the base of the same-site page in
// document.referrer (a broken link inside the site); these are certain (data-lp-base-sure). Otherwise a guess:
// '/<first segment>/' on project-site hosts (github.io, codeberg.page, gitlab.io) for paths with two segments or more,
// else '/'.
function rtPagesHead(c) {
  var d = document;
  var h = d.documentElement;
  var L = location;
  if (!/^https?:$/.test(L.protocol)) return;
  if (c.m === 'a' && /^#\//.test(L.hash)) return;
  var routes = {};
  (c.r || []).forEach(function (s) { routes[s] = 1; });
  function parts(p) {
    return p.split('/').filter(function (x) { return x; }).map(function (x) { try { return decodeURIComponent(x); } catch (e) { return x; } });
  }
  var segs = parts(L.pathname);
  // Route key of a path rest: lowercase, '.html' and 'index.html' dropped. home: the empty rest counts as the home
  // page (an index document, or a page the visitor came from).
  function key(a, home, dir) {
    a = a.slice();
    var idx = false;
    if (a.length) {
      var last = a[a.length - 1].toLowerCase();
      if (/^index(\.html?)?$/.test(last)) { a.pop(); idx = true; } else a[a.length - 1] = a[a.length - 1].replace(/\.html?$/i, '');
    }
    var k = a.join('/').toLowerCase();
    return { k: k, ok: k ? Object.prototype.hasOwnProperty.call(routes, k) && k !== '404' : home && (dir || idx) };
  }
  // The shortest base whose rest names a page: { b: base, k: route }.
  function match(list, home, dir) {
    for (var n = 0; n <= list.length; n++) {
      var r1 = key(list.slice(n), home, dir);
      if (r1.ok) return { b: '/' + list.slice(0, n).map(encodeURIComponent).join('/') + (n ? '/' : ''), k: r1.k };
    }
    return null;
  }
  var trail = /\/$/.test(L.pathname);
  var base = null;
  var slug = null;
  if (c.b) {
    var bs = parts(c.b);
    var pre = true;
    for (var j = 0; j < bs.length; j++) if (!segs[j] || segs[j].toLowerCase() !== bs[j].toLowerCase()) pre = false;
    if (pre) {
      base = c.b;
      var r0 = key(segs.slice(bs.length), !!c.i, trail);
      if (r0.ok) slug = r0.k;
    }
  }
  if (base === null) {
    var m0 = match(segs, !!c.i, trail);
    if (m0) { base = m0.b; slug = m0.k; }
  }
  var sure = base !== null;
  // Unknown address: the base of the page the visitor came from (a broken link inside the site), else the first
  // segment on project-site hosts, else the root.
  if (base === null) {
    try {
      var ref = d.referrer ? new URL(d.referrer) : null;
      if (ref && ref.origin === L.origin) {
        var m1 = match(parts(ref.pathname), true, /\/$/.test(ref.pathname));
        if (m1 && L.pathname.toLowerCase().indexOf(m1.b.toLowerCase()) === 0) { base = m1.b; sure = true; }
      }
    } catch (e) { /* no referrer */ }
  }
  if (base === null) {
    base = segs.length > 1 && /(^|\.)(github\.io|codeberg\.page|gitlab\.io)$/i.test(L.hostname) ? '/' + encodeURIComponent(segs[0]) + '/' : '/';
  }
  var route = slug === null ? '404' : slug;
  h.setAttribute('data-lp-base', base);
  h.setAttribute('data-lp-route', route);
  if (sure) h.setAttribute('data-lp-base-sure', '');
  if (c.a) {
    var b = d.createElement('base');
    b.setAttribute('href', base);
    d.head.appendChild(b);
  }
  var st = d.createElement('style');
  st.id = 'lp-route-css';
  st.textContent = '.lp-root>main[data-lp-page]{display:none!important}.lp-root>main[data-lp-page="' + route.replace(/["\\]/g, '') + '"]{display:block!important}';
  d.head.appendChild(st);
}

/* ---------- router ---------- */

// Shows one page at a time, follows page links (pushState) and back / forward (popstate), keeps the title,
// description and robots meta of the current page in the current language, marks the nav link (aria-current="page"),
// moves focus to the new page (and announces its title), scrolls to the top or to the linked anchor (instantly after a
// page change, smoothly within a page unless prefers-reduced-motion). Unknown routes show the "Not found" page.
// An anchor of another page (#team) opens that page first. With <base> (mode 'p'), fragment-only links that no other
// feature handled are kept on the current page.
function rtPages(R) {
  var c = R.cfg.pg;
  if (!c || typeof c !== 'object' || !Array.isArray(c.r)) return;
  var d = document;
  var h = d.documentElement;
  var L = location;
  var hop = Object.prototype.hasOwnProperty;
  var NF = '404';
  var mains = R.$$('.lp-root>main[data-lp-page]');
  if (!mains.length) return;
  var bySlug = {};
  mains.forEach(function (m) { bySlug[m.getAttribute('data-lp-page')] = m; });
  var info = {};
  c.r.forEach(function (x) { if (x && typeof x.s === 'string') info[x.s] = x; });
  // Path routes: always in 404.html of archives; for the single file deployed as 404.html only when the base path is
  // certain (configured, matched by a page address or by the page the visitor came from) — else hash routes, which
  // work under any path.
  var pathStyle = h.hasAttribute('data-lp-base') && (c.m === 'p' || (c.m === 'a' && h.hasAttribute('data-lp-base-sure')));
  var base = pathStyle ? h.getAttribute('data-lp-base') || '/' : '';
  h.classList.add('lp-route');
  var cur = null;

  function norm(p) {
    var a = String(p || '').split('/').filter(function (x) { return x; });
    if (a.length) {
      var last = a[a.length - 1].toLowerCase();
      if (/^index(\.html?)?$/.test(last)) a.pop(); else a[a.length - 1] = a[a.length - 1].replace(/\.html?$/i, '');
    }
    return a.join('/').toLowerCase();
  }
  function known(k) { return k !== NF && hop.call(bySlug, k); }
  function target(id) {
    if (!id) return null;
    var t = d.getElementById(id);
    if (!t) { try { t = d.getElementById(decodeURIComponent(id)); } catch (e) { t = null; } }
    return t;
  }
  function pageOf(el) {
    var m = el && el.closest ? el.closest('main[data-lp-page]') : null;
    return m && m.parentNode && m.parentNode.classList && m.parentNode.classList.contains('lp-root') ? m.getAttribute('data-lp-page') : null;
  }
  function special(hs) { return /^#(lang=|cart$|top$|$)/.test(hs); }
  // { s: slug, a: anchor } of the current URL.
  function fromURL() {
    var hs = L.hash || '';
    var m = /^#\/([^#]*)(?:#(.*))?$/.exec(hs);
    if (m) { var k = norm(m[1]); return { s: known(k) ? k : NF, a: m[2] || '' }; }
    var an = hs.length > 1 && !special(hs) ? hs.slice(1) : '';
    // Hash routes: no fragment = the home page; #lang=…, #cart, #top keep the page that is shown.
    var s = hs.length > 1 && special(hs) && cur !== null ? cur : '';
    if (pathStyle) {
      var p = L.pathname;
      try { p = decodeURIComponent(p); } catch (e) { /* keep */ }
      var kk = p.toLowerCase().indexOf(base.toLowerCase()) === 0 ? norm(p.slice(base.length)) : null;
      s = kk !== null && known(kk) ? kk : NF;
    }
    // First load of a path-routed document: the route the head script found.
    if (cur === null && h.getAttribute('data-lp-route') !== null) {
      var hr = h.getAttribute('data-lp-route');
      s = known(hr) ? hr : NF;
    }
    if (an) {
      var t = target(an);
      var pg = t ? pageOf(t) : null;
      if (pg !== null && !(pathStyle && s === NF)) s = pg;
    }
    return { s: s, a: an };
  }
  function pick(o) {
    if (!o) return '';
    var l = R.lang();
    if (o[l] != null) return o[l];
    if (o[R.cfg.defaultLang] != null) return o[R.cfg.defaultLang];
    for (var k in o) if (hop.call(o, k)) return o[k];
    return '';
  }
  function setMeta(sel, attr, name, value) {
    var el = d.querySelector(sel);
    if (!el && value) {
      el = d.createElement('meta');
      el.setAttribute(attr, name);
      d.head.appendChild(el);
    }
    if (el) {
      if (value) el.setAttribute('content', value);
      else if (name === 'robots') el.parentNode.removeChild(el);
    }
  }
  function meta() {
    var x = info[cur] || {};
    var t = pick(x.t);
    if (t) {
      d.title = t;
      setMeta('meta[property="og:title"]', 'property', 'og:title', t);
    }
    var ds = pick(x.d);
    if (x.d) {
      setMeta('meta[name="description"]', 'name', 'description', ds);
      setMeta('meta[property="og:description"]', 'property', 'og:description', ds);
    }
    setMeta('meta[name="robots"]', 'name', 'robots', x.x ? 'noindex' : '');
  }
  function show(s) {
    var m = bySlug[s] || bySlug[NF] || bySlug[''] || mains[0];
    mains.forEach(function (x) {
      if (x === m) x.removeAttribute('hidden'); else x.setAttribute('hidden', '');
    });
    var css = d.getElementById('lp-route-css');
    if (css && css.parentNode) css.parentNode.removeChild(css);
    var prev = cur;
    cur = m.getAttribute('data-lp-page');
    R.$$('[data-lp-pg]').forEach(function (a) {
      if (a.getAttribute('data-lp-pg') === cur) a.setAttribute('aria-current', 'page');
      else if (a.getAttribute('aria-current') === 'page') a.removeAttribute('aria-current');
    });
    meta();
    if (prev !== cur) {
      R.emit('lp:page', { page: cur, from: prev });
      // Sliders, carousels and other measured layouts of the newly shown page.
      try { window.dispatchEvent(new Event('resize')); } catch (e) { /* old engines */ }
    }
  }
  function url(s, an) {
    var hs = an ? '#' + an : '';
    if (pathStyle) return base + (s && s !== NF ? s + '/' : '') + hs;
    return L.pathname + L.search + (an ? hs : '#/' + (s === NF ? '' : s));
  }
  function save() {
    try { history.replaceState({ lp: 1, s: cur, y: window.pageYOffset || 0 }, '', L.href); } catch (e) { /* file:// quirks */ }
  }
  // Pictures that load after an instant jump (lazy images of a page that was hidden until now) push the target down:
  // follow it for two seconds unless the visitor scrolls, clicks or types meanwhile.
  function follow(t) {
    var top = t.getBoundingClientRect().top;
    var n = 0;
    var stop = false;
    var evs = ['wheel', 'touchstart', 'keydown', 'mousedown'];
    function halt() { stop = true; }
    evs.forEach(function (x) { window.addEventListener(x, halt, { capture: true, passive: true }); });
    function tick() {
      if (stop || ++n > 25 || !d.documentElement.contains(t)) {
        evs.forEach(function (x) { window.removeEventListener(x, halt, true); });
        return;
      }
      if (Math.abs(t.getBoundingClientRect().top - top) > 1) {
        t.scrollIntoView({ block: 'start' });
        top = t.getBoundingClientRect().top;
      }
      setTimeout(tick, 80);
    }
    setTimeout(tick, 80);
  }
  function scrollTo(t, smooth) {
    var soft = smooth && !R.reduce();
    try { t.scrollIntoView({ behavior: soft ? 'smooth' : 'auto', block: 'start' }); } catch (e) { t.scrollIntoView(); }
    if (!soft) follow(t);
    if (!/^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(t.tagName) && !t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1');
    try { t.focus({ preventScroll: true }); } catch (e) { /* not focusable */ }
  }
  function go(s, an, push) {
    var changed = s !== cur;
    if (push && (changed || an)) {
      save();
      try { history.pushState({ lp: 1, s: s, y: 0 }, '', url(s, an)); } catch (e) { /* sandboxed previews */ }
    }
    show(s);
    var t = an ? target(an) : null;
    if (t && pageOf(t) === cur) scrollTo(t, !changed);
    else if (changed) {
      window.scrollTo(0, 0);
      var m = bySlug[cur];
      try { if (m) m.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      R.live(d.title);
    }
  }
  function closeMenu(a) {
    var m = a && a.closest ? a.closest('details[open]') : null;
    if (m) m.removeAttribute('open');
  }

  // Page links: '#/<slug>' everywhere, paths under the base in path mode, anchors of another page.
  d.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button > 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
    var raw = a.getAttribute('href') || '';
    var s = null;
    var an = '';
    var m = /^#\/([^#]*)(?:#(.*))?$/.exec(raw);
    if (m) {
      s = norm(m[1]);
      if (!known(s)) return; // the browser changes the fragment; popstate shows the "Not found" page
      an = m[2] || '';
    } else if (raw.charAt(0) === '#') {
      if (special(raw)) return;
      var t = target(raw.slice(1));
      var pg = t ? pageOf(t) : null;
      if (pg === null || pg === cur) return; // this page or outside the pages: the links feature scrolls
      s = pg;
      an = raw.slice(1);
    } else if (pathStyle) {
      var u = null;
      try { u = new URL(a.href, L.href); } catch (x) { u = null; }
      if (!u || u.origin !== L.origin) return;
      var p = u.pathname;
      try { p = decodeURIComponent(p); } catch (x2) { /* keep */ }
      if (p.toLowerCase().indexOf(base.toLowerCase()) !== 0) return;
      var rest = p.slice(base.length);
      if (/\.[a-z0-9]{1,5}$/i.test(rest) && !/\.html?$/i.test(rest)) return; // files (assets, data) load normally
      var k = norm(rest);
      if (!known(k)) return;
      s = k;
      an = u.hash ? u.hash.slice(1) : '';
    } else return;
    e.preventDefault();
    closeMenu(a);
    go(s, an, true);
  }, true);

  // <base href> (mode 'p'): a fragment-only link nothing else handled stays on this page instead of the base URL.
  if (c.m === 'p') {
    window.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button > 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      var a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
      if (!a) return;
      e.preventDefault();
      var raw = a.getAttribute('href') || '';
      if (raw.length > 1) { try { L.hash = raw.slice(1); } catch (x) { /* ignore */ } }
    });
  }

  window.addEventListener('popstate', function (e) {
    var r = fromURL();
    var before = cur;
    show(r.s);
    var st = e.state;
    var t = r.a ? target(r.a) : null;
    if (t && pageOf(t) === cur) scrollTo(t, false);
    else if (st && st.lp && typeof st.y === 'number') window.scrollTo(0, st.y);
    // A typed or unhandled '#/<slug>': the browser jumps to <main id="/<slug>"> once it is shown (after this event);
    // a new page starts at its top.
    else if (cur !== before) setTimeout(function () { window.scrollTo(0, 0); }, 0);
  });
  R.on('lp:lang', meta);

  // Initial route: canonical URL in path mode (case, '.html', 'index.html' and slash variants), then the page.
  var r0 = fromURL();
  if (pathStyle && r0.s !== NF) {
    var want = base + (r0.s ? r0.s + '/' : '') + L.search + L.hash;
    if (want !== L.pathname + L.search + L.hash) { try { history.replaceState({ lp: 1, s: r0.s, y: 0 }, '', want); } catch (e) { /* ignore */ } }
  }
  show(r0.s);
  var t0 = r0.a ? target(r0.a) : null;
  if (t0 && pageOf(t0) === cur) setTimeout(function () { scrollTo(t0, false); }, 60);
  else if (/^#\//.test(L.hash)) setTimeout(function () { window.scrollTo(0, 0); }, 0); // the browser jumped to <main id="/…">
}

// Without JavaScript (and before the router runs) a hash route #/<slug> shows its page through :target, and an anchor
// shows the page that holds it; the home page otherwise. With the router (html.lp-route) only `hidden` counts.
// (!important: the base CSS hides [hidden] with !important.)
const CSS_FEAT_PG = {
  pages: `
.lp-root>.lp-main[data-lp-page][hidden]{display:none}
html:not(.lp-route) .lp-root>.lp-main[data-lp-page]:is(:target,:has(:target)){display:block!important}
html:not(.lp-route) .lp-root:has(>.lp-main[data-lp-page]:target,>.lp-main[data-lp-page] :target)>.lp-main[data-lp-page]:not(:target):not(:has(:target)){display:none!important}
.lp-root>.lp-main[data-lp-page]:focus{outline:none}
`,
};

export {
  CSS_FEAT_PG,
  rtPages,
  rtPagesHead
};
