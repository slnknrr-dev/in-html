// bookmarks/meta.js - what a web page says about itself, read from its HTML text without a DOM: title, description,
// site name, canonical URL, icons, language. Tolerant of broken markup; only the head (or the first 512 KB) is read.
//
//   extractMeta(html, pageURL) -> { title, description, siteName, canonical, icons: [{ href, rel, sizes, type }], lang }
//                                 URLs are absolute (resolved against <base href> and the page URL), http(s) only
//   pickIcon(icons, pageURL) -> href     a small raster / SVG icon, else /favicon.ico of the site
//   charsetOf(contentType, headBytes) -> label | ''    from the Content-Type header, else <meta charset>

import { decodeEntities } from './import.js';

// Regex scan instead of a DOM parser: it runs server-side on arbitrary pages and only needs a handful of head tags.
// The attribute part allows quoted values containing '>' ("[^"]*"), the usual breakage of naive tag regexes.
const TAG = /<(meta|link|base|title|html)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
const ATTR = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function attrs(s) {
  const o = {};
  for (const m of String(s || '').matchAll(ATTR)) o[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  return o;
}

function absolute(href, base) {
  try {
    const u = new URL(String(href).trim(), base);
    return /^https?:$/.test(u.protocol) ? u.href : '';
  } catch { return ''; }
}

const clean = (s, max) => decodeEntities(String(s || '')).replace(/\s+/g, ' ').trim().slice(0, max);

// Bounded work: at most 512 KB, cut at </head> or <body>; comments, scripts and styles removed first so tags
// inside them are not read. First occurrence wins for each meta key (sites repeat og: tags). Resulting URLs are
// resolved against <base href> and limited to http(s): a javascript: canonical or icon URL never reaches the UI.
export function extractMeta(html, pageURL) {
  let text = String(html || '').slice(0, 512 * 1024);
  const headEnd = text.search(/<\/head\s*>|<body[\s>]/i);
  if (headEnd > 0) text = text.slice(0, headEnd);
  text = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/<style\b[\s\S]*?<\/style\s*>/gi, '');
  const out = { title: '', description: '', siteName: '', canonical: '', icons: [], lang: '' };
  let base = pageURL;
  const metas = {};
  let m;
  TAG.lastIndex = 0;
  while ((m = TAG.exec(text))) {
    const tag = m[1].toLowerCase();
    const a = attrs(m[2]);
    if (tag === 'html') { if (a.lang) out.lang = a.lang.slice(0, 35); continue; }
    if (tag === 'base') { if (a.href) base = absolute(a.href, pageURL) || base; continue; }
    if (tag === 'title') {
      if (!out.title) {
        const end = text.slice(TAG.lastIndex).search(/<\/title\s*>/i);
        out.title = clean(end >= 0 ? text.slice(TAG.lastIndex, TAG.lastIndex + end) : '', 500);
      }
      continue;
    }
    if (tag === 'meta') {
      const key = (a.property || a.name || a.itemprop || '').toLowerCase();
      if (key && a.content !== undefined && !(key in metas)) metas[key] = a.content;
      continue;
    }
    if (tag === 'link' && a.href) {
      const rel = (a.rel || '').toLowerCase().split(/\s+/);
      if (rel.includes('canonical') && !out.canonical) out.canonical = absolute(a.href, base);
      if (rel.includes('icon') || rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed') || rel.includes('mask-icon')) {
        const href = /^data:image\//i.test(a.href) ? a.href.replace(/\s+/g, '') : absolute(a.href, base);
        if (href) out.icons.push({ href, rel: rel.join(' '), sizes: (a.sizes || '').toLowerCase(), type: (a.type || '').toLowerCase() });
      }
    }
  }
  out.title = out.title || clean(metas['og:title'] || metas['twitter:title'], 500);
  out.description = clean(metas.description || metas['og:description'] || metas['twitter:description'], 2000);
  out.siteName = clean(metas['og:site_name'] || metas['application-name'], 200);
  if (!out.canonical && metas['og:url']) out.canonical = absolute(metas['og:url'], base);
  return out;
}

// Prefers 32 px (16 to 64), PNG / ICO / SVG over others, favicons over touch icons.
// Heuristic score rather than strict rules: real sites declare icons inconsistently. Favours ~32 px raster or SVG
// favicons, penalizes Safari mask icons (monochrome silhouettes), falls back to /favicon.ico.
export function pickIcon(icons, pageURL) {
  const scored = (icons || []).map((ic) => {
    let s = 0;
    const size = Math.max(0, ...(ic.sizes.match(/\d+/g) || []).map(Number));
    if (ic.rel.includes('mask-icon')) s -= 50;
    if (/\bicon\b/.test(ic.rel) && !ic.rel.includes('apple')) s += 10;
    if (size) s += size >= 16 && size <= 64 ? 20 - Math.abs(32 - size) / 4 : size > 64 ? 5 - size / 100 : 0;
    if (ic.sizes === 'any' || /svg/.test(ic.type) || /\.svg(\?|$)/i.test(ic.href)) s += 12;
    if (/png|icon|ico/.test(ic.type) || /\.(png|ico)(\?|$)/i.test(ic.href)) s += 4;
    return { ic, s };
  }).sort((a, b) => b.s - a.s);
  if (scored.length) return scored[0].ic.href;
  try { return new URL('/favicon.ico', pageURL).href; } catch { return ''; }
}

// HTTP header first (it is authoritative per the HTML spec), then a <meta charset> sniffed from the first 4 KB
// decoded as latin1 (every byte maps to a char, so ASCII markup is readable whatever the real encoding).
export function charsetOf(contentType, headBytes) {
  const m = /charset\s*=\s*["']?([\w.:-]+)/i.exec(String(contentType || ''));
  if (m) return m[1].toLowerCase();
  if (headBytes) {
    const head = new TextDecoder('latin1').decode(headBytes.subarray ? headBytes.subarray(0, 4096) : headBytes);
    const h = /<meta\b[^>]*?charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head);
    if (h) return h[1].toLowerCase();
  }
  return '';
}
