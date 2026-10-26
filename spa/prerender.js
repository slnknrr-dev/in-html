// spa/prerender.js - static exports of single-page applications: one prerendered file per route (search engines and
// readers without JavaScript see real pages) whose links are relative, so the site works under any base path and,
// in the 'html' URL style, from a folder opened from disk. Pure functions (Node and browsers).
//
//   routeFile(route, style)                 file of a route in the export: 'index.html', 'a/b.html', 'a/b/index.html'
//   relRoot(route, style)                   relative prefix from the page of a route to the site root: '', '../', …
//   relHref(from, to, style)                relative URL from the page of route `from` to route `to` (a route string
//                                           'path?query#frag' or object); same-page fragments stay '#frag'
//   sitemapXML(siteURL, entries)            sitemap.xml: entries [{ route, lastmod? ('YYYY-MM-DD') }], siteURL is the
//                                           absolute URL of the base ('https://user.example.org/repo/'), style option
//   robotsTXT(siteURL)                      robots.txt pointing at the sitemap
import { pathOf } from './base.js';
import { formatQuery, normPath, splitRoute } from './route.js';

export function routeFile(route, style = 'clean') {
  const r = normPath(route);
  if (!r) return 'index.html';
  return style === 'folders' ? r + '/index.html' : r + '.html';
}

// Directory part of a URL path: '/a/b' -> '/a/', '/a/b/' -> '/a/b/'.
const dirOf = (p) => p.slice(0, p.lastIndexOf('/') + 1);

// Relative URL from the directory `fromDir` to the path `to` (both absolute, '/'-separated, encoded).
// Classic relative path computation over segments. `i < b.length - 1` keeps the target's last segment (the file or
// trailing empty segment) out of the common prefix, so './' is produced for the directory itself, never ''.
function relative(fromDir, to) {
  const a = fromDir.split('/').slice(1, -1);
  const b = to.split('/').slice(1);
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  const up = a.length - i;
  const rest = b.slice(i).join('/');
  const out = '../'.repeat(up) + rest;
  return out || './';
}

export function relRoot(route, style = 'clean') {
  const dir = dirOf(pathOf(route, '/', style));
  const depth = dir.split('/').length - 2;
  return '../'.repeat(depth);
}

// Relative links make an export base-agnostic and let the 'html' style work from file:// where absolute paths would
// resolve against the filesystem root. Same-page fragment links stay bare '#frag' so the browser scrolls without a
// navigation.
export function relHref(from, to, style = 'clean') {
  const target = typeof to === 'string' ? splitRoute(to) : { path: normPath(to && to.path), query: (to && to.query) || {}, frag: (to && to.frag) || '' };
  const q = formatQuery(target.query);
  const tail = (q ? '?' + q : '') + (target.frag ? '#' + encodeURIComponent(target.frag) : '');
  const fromPath = typeof from === 'string' ? splitRoute(from).path : normPath(from && from.path);
  if (target.path === fromPath && !q && target.frag) return '#' + encodeURIComponent(target.frag);
  const rel = relative(dirOf(pathOf(fromPath, '/', style)), pathOf(target.path, '/', style));
  return rel + tail;
}

const xmlEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

export function sitemapXML(siteURL, entries, style = 'clean') {
  const root = String(siteURL || '').replace(/\/*$/, '/');
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];
  for (const e of entries || []) {
    const loc = root + pathOf(e.route, '/', style).slice(1);
    lines.push(`  <url><loc>${xmlEsc(loc)}</loc>${e.lastmod ? `<lastmod>${xmlEsc(e.lastmod)}</lastmod>` : ''}</url>`);
  }
  lines.push('</urlset>', '');
  return lines.join('\n');
}

export function robotsTXT(siteURL) {
  const root = String(siteURL || '').replace(/\/*$/, '/');
  return `User-agent: *\nAllow: /\n${siteURL ? `Sitemap: ${root}sitemap.xml\n` : ''}`;
}
