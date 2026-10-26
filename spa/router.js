// spa/router.js - client router of multi-page single-page applications: one page that behaves like a site of separate
// pages (titles, back / forward, scroll positions, focus, in-page anchors). Nothing runs at module evaluation.
//
//   const router = createRouter({ mode, base, style, onRoute, focus, scrollTop });
//   router.start()                 reads the current URL and calls onRoute(route, { initial: true })
//   router.go(target, { replace }) navigates: target is a route string ('a/b?v=x#sec') or a route object
//   router.href(target)            the href of a route in this mode (for rendered links)
//   router.current()               the current route object { path, query, frag }
//   router.replaceQuery(query)     changes the query of the current entry without a render (replaceState)
//   router.back(), router.forward(), router.stop()
//
// Modes:
//   'hash'    routes live in the fragment: page.html#/a/b?v=x#sec (works from file://, one HTML file)
//   'path'    real URL paths below `base` with pushState (static hosts with a 404.html fallback, servers); `style`
//             is the URL style of spa/base.js ('clean' | 'folders' | 'html')
//   'memory'  no URL changes at all (previews inside an editor); links use hash-style hrefs
//
// onRoute(route, info) renders the page (it may return a promise); info = { initial, pop, sameDoc }. The router then
// restores the scroll position of a history entry (back / forward), scrolls to the fragment or to the top, and moves
// the focus to `focus()` (default: the first [data-spa-focus] element or <main>) after a navigation by the user.
// Clicks on same-document links are intercepted (not with modifier keys, target, download or data-spa="off");
// a link whose route only differs in its fragment scrolls without calling onRoute.
import { pathOf, routeOf } from './base.js';
import { formatQuery, formatRoute, hashRoute, normPath, parseQuery, routeHash, splitRoute } from './route.js';

// Closure-based instance rather than a class: no `this` binding pitfalls when methods are passed as callbacks.
// renderSeq implements "latest navigation wins": if the user navigates again while onRoute is still awaiting, the
// stale render's scroll and focus side effects are skipped.
export function createRouter({ mode = 'hash', base = '/', style = 'clean', onRoute = () => {}, focus = null, scrollTop = 0 } = {}) {
  const mem = { stack: [], i: -1 };
  let cur = null, started = false, renderSeq = 0;

  const toRoute = (target) => {
    if (target && typeof target === 'object') return { path: normPath(target.path), query: { ...(target.query || {}) }, frag: target.frag || '' };
    return splitRoute(target);
  };

  function read() {
    if (mode === 'memory') return mem.i >= 0 ? mem.stack[mem.i].route : { path: '', query: {}, frag: '' };
    if (mode === 'hash') {
      const r = hashRoute(location.hash);
      if (r) return r;
      // A plain '#anchor' keeps the current route.
      let frag = location.hash.slice(1);
      try { frag = decodeURIComponent(frag); } catch { /* keep */ }
      return { path: cur ? cur.path : '', query: cur ? { ...cur.query } : {}, frag };
    }
    const path = routeOf(location.pathname, base);
    let frag = location.hash.slice(1);
    try { frag = decodeURIComponent(frag); } catch { /* keep */ }
    return { path: path == null ? '' : path, query: parseQuery(location.search), frag, outside: path == null };
  }

  function href(target) {
    const r = toRoute(target);
    if (mode === 'path') {
      const q = formatQuery(r.query);
      return pathOf(r.path, base, style) + (q ? '?' + q : '') + (r.frag ? '#' + encodeURIComponent(r.frag) : '');
    }
    return routeHash(r);
  }

  const sameDoc = (a, b) => !!a && !!b && a.path === b.path && formatQuery(a.query) === formatQuery(b.query);

  // Scroll position is stored inside the history entry's state, so it survives reloads and follows back / forward
  // exactly; history.scrollRestoration = 'manual' (in start) stops the browser from restoring too early, before the
  // async render has produced the content.
  function saveScroll() {
    const y = window.scrollY || 0;
    if (mode === 'memory') { if (mem.i >= 0) mem.stack[mem.i].y = y; return; }
    try { history.replaceState({ ...(history.state || {}), spaY: y }, ''); } catch { /* sandboxed */ }
  }

  function scrollToFrag(frag) {
    if (!frag) return false;
    const el = document.getElementById(frag) || document.getElementsByName(frag)[0];
    if (!el) return false;
    el.scrollIntoView({ block: 'start' });
    return true;
  }

  // A11y: after a client-side navigation screen readers stay on the clicked link unless focus moves; focusing the
  // main region announces the new page, as a full page load would. tabindex -1 makes a non-interactive element
  // focusable without adding it to the tab order; preventScroll lets the router own the scroll position.
  function moveFocus() {
    const el = (focus && focus()) || document.querySelector('[data-spa-focus]') || document.querySelector('main');
    if (!el) return;
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    try { el.focus({ preventScroll: true }); } catch { /* ignore */ }
  }

  async function handle(info = {}) {
    const r = read();
    const seq = ++renderSeq;
    // Fragment-only change: no re-render, just scroll (or to the top when the fragment was cleared by a click).
    if (!info.initial && sameDoc(r, cur)) {
      cur = r;
      if (!scrollToFrag(r.frag) && !r.frag && !info.pop) window.scrollTo(0, scrollTop);
      return;
    }
    cur = r;
    await onRoute(r, { initial: !!info.initial, pop: !!info.pop, sameDoc: false });
    if (seq !== renderSeq) return;
    const y = info.pop ? (mode === 'memory' ? mem.stack[mem.i] && mem.stack[mem.i].y : history.state && history.state.spaY) : null;
    if (typeof y === 'number') window.scrollTo(0, y);
    else if (!scrollToFrag(r.frag) && !info.initial) window.scrollTo(0, scrollTop);
    if (!info.initial && !info.pop) moveFocus();
  }

  function go(target, { replace = false } = {}) {
    const r = toRoute(target);
    if (!started) return;
    saveScroll();
    if (mode === 'memory') {
      const entry = { route: r, y: 0 };
      if (replace && mem.i >= 0) mem.stack[mem.i] = entry;
      else { mem.stack.splice(mem.i + 1); mem.stack.push(entry); mem.i = mem.stack.length - 1; }
    } else {
      const url = href(r);
      // pushState throws in sandboxed iframes and on file:// with path URLs; assigning location.hash is the fallback,
      // and the hashchange listener renders.
      try { history[replace ? 'replaceState' : 'pushState']({ spa: 1 }, '', url); } catch { location.hash = url; return; }
    }
    return handle({});
  }

  function replaceQuery(query) {
    if (!cur) return;
    cur = { ...cur, query: { ...query } };
    if (mode === 'memory') { if (mem.i >= 0) mem.stack[mem.i].route = cur; return; }
    try { history.replaceState(history.state, '', href(cur)); } catch { /* ignore */ }
  }

  // Interception rules mirror what users expect from real links: modified clicks, middle clicks, target=_blank,
  // download links, cross-origin URLs and URLs outside the base all go to the browser untouched.
  // a.href.baseVal covers SVG <a> elements, whose href is an SVGAnimatedString.
  function onClick(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (!a || a.hasAttribute('download') || a.getAttribute('data-spa') === 'off') return;
    const tgt = a.getAttribute('target');
    if (tgt && tgt !== '_self') return;
    const raw = a.getAttribute('href') || (a.href && a.href.baseVal) || '';
    if (!raw) return;
    let route = null;
    if (raw[0] === '#') {
      route = hashRoute(raw);
      if (!route) {
        let frag = raw.slice(1);
        try { frag = decodeURIComponent(frag); } catch { /* keep */ }
        route = { path: cur ? cur.path : '', query: cur ? { ...cur.query } : {}, frag };
      }
    } else if (mode === 'path') {
      let u;
      try { u = new URL(raw, location.href); } catch { return; }
      if (u.origin !== location.origin) return;
      const p = routeOf(u.pathname, base);
      if (p == null) return;
      let frag = u.hash.slice(1);
      try { frag = decodeURIComponent(frag); } catch { /* keep */ }
      route = { path: p, query: parseQuery(u.search), frag };
    } else return;
    e.preventDefault();
    if (sameDoc(route, cur) && route.frag === (cur && cur.frag) && route.frag) { scrollToFrag(route.frag); return; }
    go(route);
  }

  const onPop = () => handle({ pop: true });
  // In hash mode a back navigation fires both popstate and hashchange; the comparison with `cur` (already updated by
  // the popstate handler) makes the second event a no-op instead of a double render.
  const onHash = () => { const r = read(); if (!cur || formatRoute(r) !== formatRoute(cur)) handle({ pop: true }); };

  return {
    start(initial) {
      if (started) return;
      started = true;
      if (mode === 'memory') {
        mem.stack = [{ route: toRoute(initial || ''), y: 0 }];
        mem.i = 0;
      } else {
        try { history.scrollRestoration = 'manual'; } catch { /* ignore */ }
        window.addEventListener('popstate', onPop);
        if (mode === 'hash') window.addEventListener('hashchange', onHash);
      }
      document.addEventListener('click', onClick);
      return handle({ initial: true });
    },
    stop() {
      started = false;
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onHash);
      document.removeEventListener('click', onClick);
    },
    go,
    href,
    replaceQuery,
    current: () => cur,
    back() { if (mode === 'memory') { if (mem.i > 0) { saveScroll(); mem.i--; return handle({ pop: true }); } } else history.back(); },
    forward() { if (mode === 'memory') { if (mem.i < mem.stack.length - 1) { saveScroll(); mem.i++; return handle({ pop: true }); } } else history.forward(); },
    canBack: () => (mode === 'memory' ? mem.i > 0 : true),
    canForward: () => (mode === 'memory' ? mem.i < mem.stack.length - 1 : true),
    mode,
    base,
    style,
  };
}
