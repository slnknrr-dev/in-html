# spa

**Multi-page single-page applications.** One page that behaves like a site of separate pages — in one HTML file
(hash routes, works from `file://`), on any static host (real URL paths, prerendered files, a `404.html` that renders
virtual pages under their real URLs, base path detection for project sites) and behind a server. Pure route
functions run in Node too (prerendering, servers); the router and the 404 bootstrap need a browser.

| module | contents |
| --- | --- |
| `route.js` | slugs in any script (`slugify`), route strings `path?query#frag` (`splitRoute`, `formatRoute`), queries, per-segment percent-encoding, hash routes (`#/a/b?v=x#sec`, `#?451=…`) |
| `base.js` | URL styles (`clean` → `a/b`, `folders` → `a/b/`, `html` → `a/b.html`), route ⇄ URL path below a base (`pathOf`, `routeOf`), base of a prerendered page (`baseFromRoute`), candidate bases of a 404 path and a best guess from the known routes (`baseCandidates`, `guessBase`) |
| `router.js` | `createRouter({ mode: 'hash' \| 'path' \| 'memory', base, style, onRoute })`: link interception, pushState / hash history, back / forward, scroll restoration per history entry, fragment scrolling, focus after navigation, `href()` for rendered links |
| `prerender.js` | static exports: the file of a route (`routeFile`), relative links between prerendered pages that work under any base and from disk (`relHref`, `relRoot`), `sitemap.xml`, `robots.txt` |
| `notfound.js` | `404.html` for static hosts: an inline bootstrap (`spaNotFoundBoot`, serialized with `Function.prototype.toString`) probes the candidate bases with the site's data script, remembers the base and loads the application from it; `notFoundPage()` builds the page |
| `test.js` | unit tests: `node spa/test.js` (also `node check.js tests spa`) |

## How a static export routes

1. Every known page is a prerendered file (`routeFile`) with relative links (`relHref`) and its route in a
   `<meta>`; the application computes the base with `baseFromRoute(location.pathname, route)` and continues with
   `createRouter({ mode: 'path', base })`.
2. Unknown paths get `404.html` from the host. Its bootstrap tries the remembered base, a configured one and every
   prefix of the path (longest first) until the probe script defines the expected site id, then loads the
   application, which reads `globalThis.SPA_BASE` and renders the route (or a real "not found").
3. Without JavaScript the prerendered files are a complete static site; in the `html` style even from a folder on
   disk.

Used by `knowledge-processor`; written so that other builders (landing pages) can adopt it.
