// spa/notfound.js - the 404.html of a static single-page site. Static hosts (GitHub / Codeberg / GitLab pages,
// Netlify, hosting.js) answer every unknown path with the site's 404.html, so that one page can render the virtual
// pages of the application (search results, generated lists, pages that only exist after a password) under their real
// URLs. The 404 page cannot know its base path (project sites live below '/<repo>/'), so a small inline script finds
// it: it loads a probe script (the site's data file) from every candidate base until one defines the expected site id,
// then remembers the base and loads the application's stylesheets and scripts from it.
//
//   notFoundPage({ lang, title, head, body, boot }) -> the HTML of 404.html
//     head  extra HTML for <head> (meta, inline styles); body  HTML shown until the application starts (and without
//     JavaScript); boot  options of spaNotFoundBoot (below)
//   spaNotFoundBoot(o)  the inline bootstrap (serialized with Function.prototype.toString; it uses only its argument
//                       and browser globals). o = {
//     probe:  path of the probe script relative to a base ('_kp/kb.js')
//     global: global variable the probe defines ('KP_DATA'), idPath: dotted path of the id in it ('site.id'), id
//     base:   a configured base ('' = detect), key: localStorage key of the remembered base
//     load:   [{ css: '_kp/kb.css' } | { js: '_kp/reader.js', module: true }] loaded from the base afterwards
//   }
//   On success globalThis.SPA_BASE is the base and <html> gets the class 'spa-ready'; when no candidate answers,
//   <html> gets 'spa-failed' (the body markup stays: a plain "page not found").

// Written in ES5 with `var` and no closures over module scope: the function is serialised with toString() into an
// inline <script>, so it must be self-contained and run in any browser that can reach the 404 page.
// Probe protocol: candidates are tried sequentially (not in parallel) so the first base that defines the expected
// id wins deterministically; the global is deleted between probes so a stale value cannot produce a false match.
// Candidates are prefixes of the current same-origin path, so the probe can only load scripts from this site.
export function spaNotFoundBoot(o) {
  var d = document, w = window, path = location.pathname, cands = [], i = 0;
  try { path = decodeURI(path); } catch (e) { /* keep */ }
  function add(b) {
    if (typeof b === 'string' && b.charAt(0) === '/' && b.charAt(b.length - 1) === '/' && path.indexOf(b) === 0 && cands.indexOf(b) < 0) cands.push(b);
  }
  // Order of preference: configured base, remembered base, then every path prefix from the longest. add() rejects
  // anything that is not a prefix of the current path, which also neutralises a tampered localStorage value.
  if (o.base) add(o.base);
  try { add(w.localStorage.getItem(o.key)); } catch (e) { /* storage blocked */ }
  var segs = path.split('/');
  for (var k = segs.length - 1; k >= 1; k--) add(segs.slice(0, k).join('/') + '/');
  function get(obj, p) {
    var parts = String(p || '').split('.');
    for (var j = 0; j < parts.length && obj != null; j++) obj = obj[parts[j]];
    return obj;
  }
  function done(b) {
    w.SPA_BASE = b;
    try { w.localStorage.setItem(o.key, b); } catch (e) { /* storage blocked */ }
    var list = o.load || [];
    for (var j = 0; j < list.length; j++) {
      var x = list[j], el;
      if (x.css) { el = d.createElement('link'); el.rel = 'stylesheet'; el.href = encodeURI(b) + x.css; }
      else { el = d.createElement('script'); if (x.module) el.type = 'module'; el.src = encodeURI(b) + x.js; }
      d.head.appendChild(el);
    }
    d.documentElement.className += ' spa-ready';
  }
  function next() {
    if (i >= cands.length) { d.documentElement.className += ' spa-failed'; return; }
    var b = cands[i++], s = d.createElement('script');
    try { delete w[o.global]; } catch (e) { w[o.global] = undefined; }
    s.src = encodeURI(b) + o.probe;
    s.onload = function () {
      if (get(w[o.global], o.idPath) === o.id) done(b);
      else { s.parentNode && s.parentNode.removeChild(s); next(); }
    };
    s.onerror = function () { s.parentNode && s.parentNode.removeChild(s); next(); };
    d.head.appendChild(s);
  }
  next();
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function notFoundPage({ lang = 'en', title = 'Not found', head = '', body = '', boot }) {
  // '<' escaped as <: a value containing '</script>' would otherwise end the inline script early (XSS vector).
  // head / body are trusted HTML from the site build, inserted verbatim.
  const opts = JSON.stringify(boot || {}).replace(/</g, '\\u003c');
  return '<!doctype html>\n<html lang="' + esc(lang) + '">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex">\n' +
    '<title>' + esc(title) + '</title>\n' + head + '\n<script>(' + spaNotFoundBoot.toString() + ')(' + opts + ');</script>\n</head>\n<body>\n' +
    body + '\n</body>\n</html>\n';
}
