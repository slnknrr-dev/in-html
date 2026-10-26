// seo/meta.js - the head of a page for search engines and link previews: title, description, canonical, robots,
// hreflang alternates, Open Graph (website / article / product / event / profile with their own properties) and
// Twitter card tags, built as data and printed as escaped HTML; plus text helpers (description from body text,
// title with the site name) and a reader of the tags already present in a page.
import { escapeAttr, escapeHTML } from '../html/escape.js';

//
// Build tags as data first ({ tag, attrs }), print second: tests and checks inspect the data, and printing is the
// single place where escaping happens (escapeAttr / escapeHTML), so no tag can skip it.
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

// Cuts text to `max` characters at a word boundary and adds an ellipsis when something was cut.
// Cut at the last space only when it keeps at least 60 % of the budget: otherwise one very long word would leave
// a stub. 160 characters is roughly what search snippets show before truncating.
export function excerpt(text, max = 160) {
  const s = clean(text);
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:!?—-]+$/, '') + '…';
}
// Plain text of HTML (tags removed, the common entities decoded) for descriptions.
export const htmlText = (html) => clean(String(html || '').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, '&'));
// 'Page — Site' (the site alone on the home page, the page alone when it already names the site).
export const pageTitle = (page, site, sep = ' — ') => (!clean(page) ? clean(site) : !site || clean(page).includes(clean(site)) ? clean(page) : clean(page) + sep + clean(site));

// Meta model: { title, description, url (canonical), image (url or { url, width, height, alt }), type ('website' |
// 'article' | 'product' | 'event' | 'profile'), siteName, locale ('en_US'), altLocales, alternates ([{ hreflang,
// href }]), noindex, nofollow, twitter ('summary_large_image' | 'summary'), twitterSite ('@name'), article: {
// published, modified, author, section, tags }, product: { price, currency, availability }, event: { start, end },
// themeColor } -> [{ tag: 'meta' | 'link' | 'title', attrs, text? }].
// Empty values are never emitted (meta() skips them): an empty og:description makes some previewers show nothing
// instead of falling back to the page text. og:type has no 'event' value, so events are 'website' with event:* props.
export function metaTags(m) {
  const out = [];
  const meta = (attrs) => { if (attrs.content != null && attrs.content !== '') out.push({ tag: 'meta', attrs: { ...attrs, content: String(attrs.content) } }); };
  const prop = (property, content) => meta({ property, content });
  const name = (n, content) => meta({ name: n, content });
  if (m.title) out.push({ tag: 'title', attrs: {}, text: clean(m.title) });
  name('description', m.description && excerpt(m.description, 300));
  if (m.noindex || m.nofollow) name('robots', [m.noindex ? 'noindex' : 'index', m.nofollow ? 'nofollow' : 'follow'].join(','));
  if (m.url) out.push({ tag: 'link', attrs: { rel: 'canonical', href: m.url } });
  for (const a of m.alternates || []) out.push({ tag: 'link', attrs: { rel: 'alternate', hreflang: a.hreflang, href: a.href } });
  if (m.themeColor) name('theme-color', m.themeColor);
  const type = m.type || 'website';
  prop('og:type', type === 'event' ? 'website' : type);
  prop('og:title', m.ogTitle || m.title);
  prop('og:description', m.description && excerpt(m.description, 300));
  prop('og:url', m.url);
  prop('og:site_name', m.siteName);
  prop('og:locale', m.locale);
  for (const l of m.altLocales || []) prop('og:locale:alternate', l);
  const img = typeof m.image === 'string' ? { url: m.image } : m.image;
  if (img && img.url) {
    prop('og:image', img.url);
    if (/^https:/i.test(img.url)) prop('og:image:secure_url', img.url);
    prop('og:image:width', img.width); prop('og:image:height', img.height); prop('og:image:alt', img.alt); prop('og:image:type', img.type);
  }
  if (type === 'article' && m.article) {
    const a = m.article;
    prop('article:published_time', a.published); prop('article:modified_time', a.modified); prop('article:section', a.section);
    for (const au of [].concat(a.author || [])) prop('article:author', au);
    for (const t of a.tags || []) prop('article:tag', t);
  }
  if (type === 'product' && m.product) {
    prop('product:price:amount', m.product.price); prop('product:price:currency', m.product.currency); prop('product:availability', m.product.availability);
  }
  if (type === 'event' && m.event) { prop('event:start_time', m.event.start); prop('event:end_time', m.event.end); }
  if (type === 'profile' && m.profile) { prop('profile:username', m.profile.username); prop('profile:first_name', m.profile.firstName); prop('profile:last_name', m.profile.lastName); }
  name('twitter:card', m.twitter || (img && img.url ? 'summary_large_image' : 'summary'));
  name('twitter:site', m.twitterSite);
  name('twitter:creator', m.twitterCreator);
  name('twitter:title', m.ogTitle || m.title);
  name('twitter:description', m.description && excerpt(m.description, 200));
  if (img && img.url) { name('twitter:image', img.url); name('twitter:image:alt', img.alt); }
  return out;
}

// Tags -> HTML (one per line, attribute values escaped).
export function renderTags(tags) {
  return tags.map((t) => {
    const attrs = Object.entries(t.attrs).map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join('');
    return t.tag === 'title' ? `<title>${escapeHTML(t.text)}</title>` : `<${t.tag}${attrs}>`;
  }).join('\n');
}
export const metaHtml = (m) => renderTags(metaTags(m));

// Meta and link tags of an HTML head -> { title, description, canonical, robots, og: { 'og:title': …, … },
// twitter: {…}, alternates: [{ hreflang, href }] } (for checks and previews of existing pages).
// Regex-based on purpose: it reads the head of pages for checks (Node, workers), and attribute order / quoting vary.
// Not a security boundary: values are only displayed after escaping elsewhere.
export function readMeta(html) {
  const s = String(html || '');
  const attrs = (tag) => { const o = {}; for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) o[m[1].toLowerCase()] = (m[3] ?? m[4] ?? m[5] ?? '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); return o; };
  const out = { title: '', description: '', canonical: '', robots: '', og: {}, twitter: {}, alternates: [] };
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(s);
  if (t) out.title = htmlText(t[1]);
  for (const m of s.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const key = a.property || a.name || '';
    if (key === 'description') out.description = a.content || '';
    else if (key === 'robots') out.robots = a.content || '';
    else if (/^(og|article|product|event|profile):/.test(key)) out.og[key] = a.content || '';
    else if (key.startsWith('twitter:')) out.twitter[key] = a.content || '';
  }
  for (const m of s.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if (a.rel === 'canonical') out.canonical = a.href || '';
    else if (a.rel === 'alternate' && a.hreflang) out.alternates.push({ hreflang: a.hreflang, href: a.href || '' });
  }
  return out;
}

// Problems a link preview or a search snippet would show: [{ field, issue }].
// Thresholds follow common preview behaviour: titles over ~65 characters and descriptions over ~160 get truncated;
// og:image below 600 x 315 is shown as a small thumbnail instead of a large card; relative URLs are not resolved by
// most crawlers.
export function metaIssues(m) {
  const out = [];
  const title = clean(m.title), desc = clean(m.description);
  if (!title) out.push({ field: 'title', issue: 'missing' }); else if (title.length > 65) out.push({ field: 'title', issue: 'long' });
  if (!desc) out.push({ field: 'description', issue: 'missing' }); else if (desc.length < 50) out.push({ field: 'description', issue: 'short' }); else if (desc.length > 160) out.push({ field: 'description', issue: 'long' });
  if (!m.url) out.push({ field: 'url', issue: 'missing' }); else if (!/^https?:\/\//i.test(m.url)) out.push({ field: 'url', issue: 'relative' });
  const img = typeof m.image === 'string' ? { url: m.image } : m.image;
  if (!img || !img.url) out.push({ field: 'image', issue: 'missing' });
  else {
    if (!/^https?:\/\//i.test(img.url)) out.push({ field: 'image', issue: 'relative' });
    if (img.width && img.height && (img.width < 600 || img.height < 315)) out.push({ field: 'image', issue: 'small' });
  }
  return out;
}
