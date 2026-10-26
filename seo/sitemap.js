// seo/sitemap.js - crawler files of a static site: sitemap.xml (sitemaps.org 0.9) with hreflang alternates of every
// language version and image entries, sitemap indexes, splitting at the 50 000 URL / 50 MB limits, robots.txt with
// several groups and sitemap lines, and hreflang <link> tags for page heads. spa/prerender.js keeps its small
// route-based sitemap; this module is the full one for any list of URLs.
import { escapeXML, escapeXMLAttr } from '../xml/xml.js';

// Protocol limits per file (sitemaps.org): 50 000 URLs and 50 MB uncompressed.
export const SITEMAP_MAX_URLS = 50000;
export const SITEMAP_MAX_BYTES = 50 * 1024 * 1024;
const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';
const trimSlash = (s) => String(s == null ? '' : s).trim().replace(/\/+$/, '');
const absPath = (p) => { const s = String(p == null ? '' : p); return /^https?:\/\//i.test(s) ? s : s.startsWith('/') ? s : '/' + s; };
const join = (base, p) => (/^https?:\/\//i.test(p) ? p : trimSlash(base) + absPath(p));

// ISO string / Date / epoch ms -> 'YYYY-MM-DD' (or the full W3C datetime with `time`); '' when unreadable.
export function w3cDate(v, time = false) {
  if (v == null || v === '') return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = v instanceof Date ? v : new Date(typeof v === 'number' ? v : String(v));
  if (Number.isNaN(d.getTime())) return '';
  return time ? d.toISOString().replace(/\.\d{3}Z$/, '+00:00') : d.toISOString().slice(0, 10);
}

// Language versions of a path: each locale at base/<locale><path> (the `root` locale without a prefix, so no
// alternate points at a redirect), plus x-default. Fewer than two locales -> [].
// `href(locale, path)` overrides the URL scheme (subdomains, ?lang=).
// Every language version must list the whole cluster including itself (Google ignores one-way hreflang), hence one
// shared list for all versions. Tags are validated loosely (BCP 47 shape) because a bad hreflang invalidates the set.
export function hreflangAlternates(base, path, locales, { root = '', href = null, xDefault = true } = {}) {
  const locs = (locales || []).filter((l) => /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(l));
  if (locs.length < 2) return [];
  const b = trimSlash(base), p = absPath(path);
  const out = locs.map((l) => ({ hreflang: l, href: href ? href(l, p) : l === root ? b + p : `${b}/${l}${p}` }));
  if (xDefault) out.push({ hreflang: 'x-default', href: href ? href(root || '', p) : b + p });
  return out;
}

// <link rel="alternate" hreflang> tags for a page head (and the canonical link when given).
export function hreflangLinks(alternates, canonical = '') {
  const lines = (alternates || []).map((a) => `<link rel="alternate" hreflang="${escapeXMLAttr(a.hreflang)}" href="${escapeXMLAttr(a.href)}">`);
  if (canonical) lines.unshift(`<link rel="canonical" href="${escapeXMLAttr(canonical)}">`);
  return lines.join('\n');
}

// <urlset>: entries [{ path | url, lastmod, changefreq, priority, images: [url | { url, title, caption }],
// alternates? }]. Options: base, locales + root (hreflang of every entry), lang (the map of one language version:
// <loc> gets that language's prefix and lists the whole cluster), href (URL scheme of alternates).
export function urlsetXml(entries, { base = '', locales = [], root = '', lang = '', href = null } = {}) {
  const b = trimSlash(base);
  const pre = lang && lang !== root ? '/' + lang : '';
  const anyImages = (entries || []).some((e) => e.images && e.images.length);
  const hasAlt = locales.length > 1 || (entries || []).some((e) => e.alternates && e.alternates.length);
  const parts = [XML_DECL, '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"' + (hasAlt ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' : '') +
    (anyImages ? ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"' : '') + '>'];
  for (const e of entries || []) {
    const p = e.url || absPath(e.path);
    const loc = e.url ? e.url : lang && href ? href(lang, p) : b + pre + p;
    const lines = ['  <url>', `    <loc>${escapeXML(loc)}</loc>`];
    const lm = w3cDate(e.lastmod);
    if (lm) lines.push(`    <lastmod>${lm}</lastmod>`);
    if (e.changefreq) lines.push(`    <changefreq>${escapeXML(e.changefreq)}</changefreq>`);
    if (typeof e.priority === 'number') lines.push(`    <priority>${Math.max(0, Math.min(1, e.priority)).toFixed(1)}</priority>`);
    const alts = e.alternates || (e.url ? [] : hreflangAlternates(b, p, locales, { root, href }));
    for (const a of alts) lines.push(`    <xhtml:link rel="alternate" hreflang="${escapeXMLAttr(a.hreflang)}" href="${escapeXMLAttr(a.href)}"/>`);
    for (const img of e.images || []) {
      const im = typeof img === 'string' ? { url: img } : img;
      lines.push(`    <image:image><image:loc>${escapeXML(join(b, im.url))}</image:loc>${im.title ? `<image:title>${escapeXML(im.title)}</image:title>` : ''}${im.caption ? `<image:caption>${escapeXML(im.caption)}</image:caption>` : ''}</image:image>`);
    }
    lines.push('  </url>');
    parts.push(lines.join('\n'));
  }
  parts.push('</urlset>');
  return parts.join('\n') + '\n';
}

// <sitemapindex> of child maps [{ path | url, lastmod }].
export function sitemapIndexXml(children, { base = '' } = {}) {
  const parts = [XML_DECL, '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];
  for (const c of children || []) {
    const lm = w3cDate(c.lastmod);
    parts.push(`  <sitemap>\n    <loc>${escapeXML(c.url || join(base, c.path))}</loc>${lm ? `\n    <lastmod>${lm}</lastmod>` : ''}\n  </sitemap>`);
  }
  parts.push('</sitemapindex>');
  return parts.join('\n') + '\n';
}

// The newest lastmod of entries (for the index line of their map).
export const latestLastmod = (entries) => (entries || []).reduce((m, e) => { const d = w3cDate(e.lastmod); return d > m ? d : m; }, '');

// Splits entries into maps that respect the limits; returns { files: [{ path, xml, count }], index (xml or '' when
// one map is enough) }. `name(i)` names the parts ('/sitemap-1.xml' …).
// KNOWN DEFECT: only the URL count is enforced; SITEMAP_MAX_BYTES is exported but never checked, so maps with very
// long URLs or many alternates / images can exceed 50 MB. Fix: measure each part's xml (UTF-8 length) and split
// further when it is over the limit.
export function buildSitemaps(entries, opts = {}, { max = SITEMAP_MAX_URLS, name = (i) => `/sitemap-${i + 1}.xml` } = {}) {
  const chunks = [];
  for (let i = 0; i < (entries || []).length; i += max) chunks.push(entries.slice(i, i + max));
  if (!chunks.length) chunks.push([]);
  if (chunks.length === 1) return { files: [{ path: '/sitemap.xml', xml: urlsetXml(chunks[0], opts), count: chunks[0].length }], index: '' };
  const files = chunks.map((c, i) => ({ path: name(i), xml: urlsetXml(c, opts), count: c.length, lastmod: latestLastmod(c) }));
  return { files, index: sitemapIndexXml(files.map((f) => ({ path: f.path, lastmod: f.lastmod })), { base: opts.base }) };
}

// robots.txt: groups [{ agents: ['*'], allow: [], disallow: [], crawlDelay }] (or the shorthand { disallow, allow }
// for '*'), sitemaps (absolute URLs or paths under base), host (Yandex).
// A group with no rules gets an explicit empty "Disallow:" (= allow all): some parsers treat a bare User-agent line
// as malformed. CR/LF are stripped from every value so a path cannot inject directives.
export function robotsTxt({ base = '', groups = null, allow = [], disallow = [], sitemaps = ['/sitemap.xml'], host = '' } = {}) {
  const list = groups || [{ agents: ['*'], allow, disallow }];
  const out = [];
  for (const g of list) {
    if (out.length) out.push('');
    for (const a of [].concat(g.agents || g.agent || '*')) out.push('User-agent: ' + String(a).replace(/[\r\n]/g, ''));
    for (const p of g.allow || []) out.push('Allow: ' + String(p).replace(/[\r\n]/g, ''));
    const dis = (g.disallow || []).filter(Boolean);
    if (dis.length) for (const p of dis) out.push('Disallow: ' + String(p).replace(/[\r\n]/g, ''));
    else if (!(g.allow || []).length) out.push('Disallow:');
    if (g.crawlDelay) out.push('Crawl-delay: ' + (+g.crawlDelay || 0));
  }
  if (host) out.push('', 'Host: ' + String(host).replace(/[\r\n]/g, ''));
  const maps = (sitemaps || []).filter(Boolean);
  if (maps.length) { out.push(''); for (const s of maps) out.push('Sitemap: ' + join(base, s)); }
  return out.join('\n') + '\n';
}

// Is `path` allowed for `agent` by a robots.txt? Longest match wins, Allow wins ties; '*' and '$' wildcards.
// RFC 9309 semantics: consecutive User-agent lines share one group; the most specific matching group applies (any
// named agent before '*'); within it the longest matching path wins and Allow wins a tie. Rule paths become anchored
// regexes with '*' as .* and a trailing '$' as end anchor; everything else is escaped literally.
export function robotsAllows(text, path, agent = '*') {
  const groups = [];
  let cur = null, lastWasAgent = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') { if (!lastWasAgent) groups.push(cur = { agents: [], rules: [] }); cur.agents.push(v.toLowerCase()); lastWasAgent = true; continue; }
    lastWasAgent = false;
    if (cur && (k === 'allow' || k === 'disallow')) cur.rules.push({ allow: k === 'allow', path: v });
  }
  const a = agent.toLowerCase();
  const group = groups.find((g) => g.agents.some((x) => x !== '*' && a.includes(x))) || groups.find((g) => g.agents.includes('*'));
  if (!group) return true;
  let best = null;
  for (const r of group.rules) {
    if (!r.path) continue;
    const anchored = r.path.endsWith('$');
    const body = (anchored ? r.path.slice(0, -1) : r.path).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
    const re = new RegExp('^' + body + (anchored ? '$' : ''));
    if (re.test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}
