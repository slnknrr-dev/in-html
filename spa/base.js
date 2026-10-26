// spa/base.js - URLs of routes on a static or server host: URL styles, base path detection (sites served from a
// sub-path such as GitHub / Codeberg project pages), route <-> URL path. Pure functions (Node and browsers).
//
// URL styles (how a route maps to a URL path and to a file of a static export):
//   'clean'    route 'a/b' -> <base>a/b      file a/b.html        (GitHub / Codeberg / Netlify / Cloudflare pages)
//   'folders'  route 'a/b' -> <base>a/b/     file a/b/index.html  (any static host with directory indexes)
//   'html'     route 'a/b' -> <base>a/b.html file a/b.html        (any host, also a folder opened from disk)
// The home route '' is <base> ('html': <base>index.html); its file is index.html.
// A base always starts and ends with '/'.
//
//   normBase(b)                         '' / 'repo' / '/repo' -> '/' / '/repo/' / '/repo/'
//   pathOf(route, base, style)          URL path (percent-encoded) of a route
//   routeOf(pathname, base)             route of a URL path below base (null when outside); '.html' and
//                                       '/index.html' endings are accepted in every style
//   baseFromRoute(pathname, route)      the base of a page whose route is known (a prerendered page), or null
//   baseCandidates(pathname)            every possible base of a URL path, longest first (404 pages probe them)
//   guessBase(pathname, routes, stored) the most likely base of a URL path given the known routes and a remembered
//                                       base: the shortest candidate whose remainder is a known route, else the stored
//                                       one when it applies, else '/'
//
// Why base detection exists at all: the same build must work at https://user.host/ and https://user.host/repo/
// without configuration, and a 404 page served for /repo/a/b cannot know which prefix is the site. All functions work
// on decoded paths (so non-ASCII slugs compare as text) and re-encode only when producing URLs.
import { decodePath, encodePath, normPath } from './route.js';

export const URL_STYLES = ['clean', 'folders', 'html'];

export function normBase(b) {
  const p = normPath(b);
  return p ? '/' + p + '/' : '/';
}

export function pathOf(route, base = '/', style = 'clean') {
  const b = encodePath(normBase(base).slice(1, -1));
  const prefix = b ? '/' + b + '/' : '/';
  const r = encodePath(route);
  if (!r) return style === 'html' ? prefix + 'index.html' : prefix;
  if (style === 'folders') return prefix + r + '/';
  if (style === 'html') return prefix + r + '.html';
  return prefix + r;
}

// Decoded path with its leading slash and a trailing slash when it had one.
function decodedPathname(pathname) {
  const raw = String(pathname || '/');
  const trail = raw.endsWith('/');
  const p = decodePath(raw);
  return '/' + p + (p && trail ? '/' : '');
}

// The '/'-appended comparison makes '/repo' (no trailing slash) belong to base '/repo/' while '/repository' does not:
// a plain startsWith on the base without the boundary would accept the latter.
export function routeOf(pathname, base = '/') {
  const b = normBase(base);
  let p = decodedPathname(pathname);
  if (!(p + (p.endsWith('/') ? '' : '/')).startsWith(b)) return null;
  let rest = p.slice(b.length - 1).replace(/^\/+/, '');
  rest = rest.replace(/(^|\/)index\.html?$/i, '').replace(/\.html?$/i, '');
  return normPath(rest);
}

export function baseFromRoute(pathname, route) {
  let p = decodedPathname(pathname).replace(/\/index\.html?$/i, '/').replace(/\.html?$/i, '').replace(/\/+$/, '');
  const r = normPath(route);
  if (!r) return normBase(p);
  const suffix = '/' + r;
  if (p.toLowerCase().endsWith(suffix.toLowerCase())) return normBase(p.slice(0, p.length - suffix.length));
  return null;
}

export function baseCandidates(pathname) {
  const p = decodedPathname(pathname);
  const segs = p.split('/');
  const out = [];
  // '/repo/a/b' -> '/repo/a/', '/repo/', '/'; a trailing slash makes the path itself a candidate.
  for (let i = segs.length - 1; i >= 1; i--) {
    const b = segs.slice(0, i).join('/') + '/';
    if (!out.includes(b)) out.push(b);
  }
  return out;
}

// Criterion: the interpretation that explains the URL with a known route. Without a match, a remembered base (from a
// previous successful load) beats the root guess, but only if the current path actually lies below it.
export function guessBase(pathname, routes = [], stored = '') {
  const known = routes instanceof Set ? routes : new Set(routes);
  // Shortest base first: the longest remainder that is a known route wins ('/repo/a/b' with routes 'a/b' and 'b'
  // is the page 'a/b' of '/repo/', not the page 'b' of '/repo/a/').
  for (const b of baseCandidates(pathname).reverse()) {
    const r = routeOf(pathname, b);
    if (r !== null && known.has(r)) return b;
  }
  if (stored) {
    const s = normBase(stored);
    if (routeOf(pathname, s) !== null) return s;
  }
  return '/';
}
