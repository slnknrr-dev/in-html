// spa/route.js - routes of multi-page single-page applications: slugs, route strings, queries and fragments, hash
// routes. Pure functions (Node and browsers), no DOM.
//
// A route is a path without leading or trailing slashes: '' is the home page, 'concepts/bhakti' a nested page. A route
// object is { path, query: { key: value }, frag } and a route string is 'path?query#frag' (formatRoute / splitRoute).
//
//   normPath(s)                 '/a//b/../c/' -> 'a/c' (dot segments resolved, never above the root)
//   slugify(text, opts)         'Bhakti yoga (practice)' -> 'bhakti-yoga-practice'; any script, lower case by default;
//                               opts { lower = true, slash = false (keep '/' separators), max = 96, fallback = 'page' }
//   splitRoute(s)               '/a/b?v=x&451=pw#sec' -> { path: 'a/b', query: { v: 'x', 451: 'pw' }, frag: 'sec' }
//   formatRoute(r)              the inverse (query keys in insertion order, values percent-encoded)
//   parseQuery(q) / formatQuery(obj)
//   encodePath(path) / decodePath(path)   per-segment percent-encoding (non-ASCII slugs stay readable once decoded)
//   hashRoute(hash)             '#/a/b?v=x#sec' -> route object; '#?451=pw' -> { path: '', query: { 451: 'pw' } };
//                               '#sec' (a plain in-page anchor) -> null
//   routeHash(r)                route object -> '#/a/b?v=x#sec'
//   sameRoute(a, b)             equal paths (queries and fragments ignored)
//   withoutQuery(r, ...keys)    a copy without the given query keys
//
// Representation choice: routes are decoded text internally ('концепции/бхакти') and percent-encoded only at the URL
// boundary (encodePath / formatQuery). Comparing encoded forms would make 'a%2Db' and 'a-b' different routes.

const SEG_BAD = /[\u0000-\u001f\u007f]/g;

// Dot segments are resolved and '..' at the root is dropped (never escapes the site): the same rule browsers apply
// to URLs, which matters because routes become file paths in static exports. Backslashes count as separators, as
// browsers treat them in http URLs.
export function normPath(s) {
  const out = [];
  for (const seg of String(s == null ? '' : s).replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { out.pop(); continue; }
    out.push(seg.replace(SEG_BAD, ''));
  }
  return out.join('/');
}

// Unicode-aware: letters (\p{L}) with their combining marks (\p{M}, needed for Devanagari / Georgian) and digits are
// kept in any script; apostrophes vanish ("don't" -> dont) rather than becoming a dash. NFC first so composed and
// decomposed input give the same slug. Dots survive (file-like slugs) but never as '..' or at the edges.
export function slugify(text, { lower = true, slash = false, max = 96, fallback = 'page' } = {}) {
  let s = String(text == null ? '' : text).normalize('NFC');
  if (lower) s = s.toLowerCase();
  const parts = (slash ? s.split('/') : [s]).map((p) => p
    .replace(/['’ʼ`]/g, '')
    .replace(/[^\p{L}\p{M}\p{N}_.-]+/gu, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, ''))
    .filter(Boolean);
  let out = parts.join('/');
  if (out.length > max) out = out.slice(0, max).replace(/[-./]+$/, '');
  return out || fallback;
}

// application/x-www-form-urlencoded flavour: space <-> '+', matching what URLSearchParams and forms produce.
const enc = (s) => encodeURIComponent(s).replace(/%20/g, '+');
const dec = (s) => {
  try { return decodeURIComponent(String(s).replace(/\+/g, ' ')); } catch { return String(s); }
};

export function parseQuery(q) {
  const out = {};
  const s = String(q == null ? '' : q).replace(/^\?/, '');
  if (!s) return out;
  for (const part of s.split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    const k = dec(i < 0 ? part : part.slice(0, i));
    // '__proto__' as an assignment key would replace the result object's prototype (prototype pollution of this
    // object); other keys such as 'constructor' are harmless as own properties.
    if (!k || k === '__proto__') continue;
    out[k] = i < 0 ? '' : dec(part.slice(i + 1));
  }
  return out;
}

export function formatQuery(obj) {
  const parts = [];
  for (const [k, v] of Object.entries(obj || {})) {
    if (v == null || v === false) continue;
    parts.push(v === '' || v === true ? enc(k) : enc(k) + '=' + enc(String(v)));
  }
  return parts.join('&');
}

export function encodePath(path) {
  return normPath(path).split('/').map((seg) => encodeURIComponent(seg)).join('/');
}

export function decodePath(path) {
  return normPath(String(path == null ? '' : path).split('/').map((seg) => {
    try { return decodeURIComponent(seg); } catch { return seg; }
  }).join('/'));
}

export function splitRoute(s) {
  let str = String(s == null ? '' : s);
  let frag = '';
  const h = str.indexOf('#');
  if (h >= 0) { frag = str.slice(h + 1); str = str.slice(0, h); }
  let query = {};
  const q = str.indexOf('?');
  if (q >= 0) { query = parseQuery(str.slice(q + 1)); str = str.slice(0, q); }
  let f = frag;
  try { f = decodeURIComponent(frag); } catch { /* keep */ }
  return { path: decodePath(str), query, frag: f };
}

export function formatRoute(r) {
  const route = typeof r === 'string' ? splitRoute(r) : r || {};
  const q = formatQuery(route.query);
  return encodePath(route.path || '') + (q ? '?' + q : '') + (route.frag ? '#' + encodeURIComponent(route.frag) : '');
}

// Hash grammar: '#/' + route, or '#?' + query for the home page. Anything else is a plain in-page anchor (null), so
// ordinary '#section' links keep working in hash mode.
export function hashRoute(hash) {
  const s = String(hash == null ? '' : hash).replace(/^#/, '');
  if (s === '' || s === '/') return { path: '', query: {}, frag: '' };
  if (s[0] !== '/' && s[0] !== '?') return null;
  return splitRoute(s[0] === '?' ? s : s.slice(1));
}

export function routeHash(r) {
  return '#/' + formatRoute(r);
}

export function sameRoute(a, b) {
  const pa = typeof a === 'string' ? splitRoute(a).path : normPath(a && a.path);
  const pb = typeof b === 'string' ? splitRoute(b).path : normPath(b && b.path);
  return pa === pb;
}

export function withoutQuery(r, ...keys) {
  const route = typeof r === 'string' ? splitRoute(r) : { ...r, query: { ...(r && r.query) } };
  const query = {};
  for (const [k, v] of Object.entries(route.query || {})) if (!keys.includes(k)) query[k] = v;
  return { path: route.path || '', query, frag: route.frag || '' };
}
