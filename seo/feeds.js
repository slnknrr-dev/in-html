// seo/feeds.js - machine-readable surfaces of a site: JSON Feed 1.1, RSS 2.0 and Atom 1.0 from one item model,
// llms.txt (llmstxt.org: title, summary, sections of links, notes) and llms-full.txt with a size cap, and the
// OpenSearch description. Items: { id?, url, title, summary?, text?, html?, image?, published?, modified?, authors?:
// [name | { name, url }], tags?: [], lang?, attachments?: [{ url, type, size?, title? }], ext? (JSON Feed `_x` data) }.
import { escapeXML, escapeXMLAttr } from '../xml/xml.js';

//
// One item model, three formats: feed readers differ in what they support (JSON Feed, RSS, Atom), and generating
// all from one source keeps them consistent. Dates are normalised to ISO via iso() and re-formatted per format (RSS
// wants RFC 822). Every text goes through escapeXML / escapeXMLAttr or CDATA; nothing is concatenated raw.
export const JSON_FEED_VERSION = 'https://jsonfeed.org/version/1.1';
const iso = (v) => { if (v == null || v === '') return ''; const d = v instanceof Date ? v : new Date(typeof v === 'number' ? v : String(v)); return Number.isNaN(d.getTime()) ? '' : d.toISOString().replace(/\.\d{3}Z$/, 'Z'); };
const person = (a) => (typeof a === 'string' ? { name: a } : a || {});
const put = (o, k, v) => { if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) o[k] = v; return o; };
const byNewest = (a, b) => String(iso(b.modified || b.published)).localeCompare(String(iso(a.modified || a.published)));

// Feed: { title, home, feedUrl, description, lang, icon, favicon, authors, items, ext (top-level `_name` data) }.
export function jsonFeed(f) {
  const out = { version: JSON_FEED_VERSION, title: f.title || '' };
  put(out, 'home_page_url', f.home); put(out, 'feed_url', f.feedUrl); put(out, 'description', f.description);
  put(out, 'language', f.lang); put(out, 'icon', f.icon); put(out, 'favicon', f.favicon);
  put(out, 'authors', (f.authors || []).map(person));
  if (f.expired) out.expired = true;
  for (const [k, v] of Object.entries(f.ext || {})) out['_' + k.replace(/^_/, '')] = v;
  out.items = (f.items || []).map((it) => {
    const o = { id: String(it.id || it.url) };
    put(o, 'url', it.url); put(o, 'title', it.title);
    if (it.html) o.content_html = it.html;
    if (it.text || !it.html) o.content_text = it.text || it.summary || it.title || '';
    put(o, 'summary', it.summary); put(o, 'image', it.image);
    put(o, 'date_published', iso(it.published)); put(o, 'date_modified', iso(it.modified));
    put(o, 'authors', (it.authors || []).map(person)); put(o, 'tags', it.tags); put(o, 'language', it.lang);
    put(o, 'attachments', (it.attachments || []).map((a) => put(put(put({ url: a.url, mime_type: a.type || 'application/octet-stream' }, 'title', a.title), 'size_in_bytes', a.size), 'duration_in_seconds', a.duration)));
    for (const [k, v] of Object.entries(it.ext || {})) o['_' + k.replace(/^_/, '')] = v;
    return o;
  });
  return out;
}

// RFC 822 date of RSS ('Sat, 24 Oct 2026 10:00:00 GMT').
const rfc822 = (v) => { const s = iso(v); return s ? new Date(s).toUTCString() : ''; };
// A literal "]]>" would end the CDATA section early; it is split across two sections, the standard trick.
const cdata = (s) => '<![CDATA[' + String(s).split(']]>').join(']]]]><![CDATA[>') + ']]>';

// RSS 2.0 with atom:self and content:encoded for HTML bodies.
// guid isPermaLink="true" only when the id is the URL: readers then use it as a link; a non-URL id must say false.
// RSS allows one enclosure per item, so only the first attachment is written.
export function rssXml(f) {
  const items = (f.items || []).map((it) => {
    const l = ['    <item>', `      <title>${escapeXML(it.title || '')}</title>`];
    if (it.url) l.push(`      <link>${escapeXML(it.url)}</link>`);
    l.push(`      <guid isPermaLink="${it.id && it.id !== it.url ? 'false' : 'true'}">${escapeXML(it.id || it.url || '')}</guid>`);
    if (it.summary || it.text) l.push(`      <description>${escapeXML(it.summary || it.text)}</description>`);
    if (it.html) l.push(`      <content:encoded>${cdata(it.html)}</content:encoded>`);
    if (it.published || it.modified) l.push(`      <pubDate>${rfc822(it.published || it.modified)}</pubDate>`);
    for (const a of it.authors || []) l.push(`      <dc:creator>${escapeXML(person(a).name || '')}</dc:creator>`);
    for (const t of it.tags || []) l.push(`      <category>${escapeXML(t)}</category>`);
    for (const a of (it.attachments || []).slice(0, 1)) l.push(`      <enclosure url="${escapeXMLAttr(a.url)}" length="${a.size || 0}" type="${escapeXMLAttr(a.type || 'application/octet-stream')}"/>`);
    l.push('    </item>');
    return l.join('\n');
  });
  const newest = [...(f.items || [])].sort(byNewest)[0];
  return ['<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '  <channel>', `    <title>${escapeXML(f.title || '')}</title>`, `    <link>${escapeXML(f.home || '')}</link>`,
    `    <description>${escapeXML(f.description || f.title || '')}</description>`,
    ...(f.lang ? [`    <language>${escapeXML(f.lang)}</language>`] : []),
    ...(f.feedUrl ? [`    <atom:link href="${escapeXMLAttr(f.feedUrl)}" rel="self" type="application/rss+xml"/>`] : []),
    ...(newest ? [`    <lastBuildDate>${rfc822(newest.modified || newest.published)}</lastBuildDate>`] : []),
    ...items, '  </channel>', '</rss>', ''].join('\n');
}

// Atom 1.0.
// Atom requires <updated> on the feed and every entry; when nothing has a date the epoch is used rather than "now"
// so output stays deterministic between builds.
export function atomXml(f) {
  const newest = [...(f.items || [])].sort(byNewest)[0];
  const updated = iso(f.updated || (newest && (newest.modified || newest.published))) || '1970-01-01T00:00:00Z';
  const auth = (list, pad) => (list || []).map((a) => { const p = person(a); return `${pad}<author><name>${escapeXML(p.name || '')}</name>${p.url ? `<uri>${escapeXML(p.url)}</uri>` : ''}</author>`; });
  const entries = (f.items || []).map((it) => ['  <entry>', `    <title>${escapeXML(it.title || '')}</title>`,
    ...(it.url ? [`    <link rel="alternate" href="${escapeXMLAttr(it.url)}"/>`] : []), `    <id>${escapeXML(it.id || it.url || '')}</id>`,
    `    <updated>${iso(it.modified || it.published) || updated}</updated>`, ...(it.published ? [`    <published>${iso(it.published)}</published>`] : []),
    ...auth(it.authors, '    '), ...(it.tags || []).map((t) => `    <category term="${escapeXMLAttr(t)}"/>`),
    ...(it.summary ? [`    <summary>${escapeXML(it.summary)}</summary>`] : []),
    ...(it.html ? [`    <content type="html">${escapeXML(it.html)}</content>`] : it.text ? [`    <content type="text">${escapeXML(it.text)}</content>`] : []),
    '  </entry>'].join('\n'));
  return ['<?xml version="1.0" encoding="UTF-8"?>', `<feed xmlns="http://www.w3.org/2005/Atom"${f.lang ? ` xml:lang="${escapeXMLAttr(f.lang)}"` : ''}>`,
    `  <title>${escapeXML(f.title || '')}</title>`, ...(f.description ? [`  <subtitle>${escapeXML(f.description)}</subtitle>`] : []),
    ...(f.home ? [`  <link rel="alternate" href="${escapeXMLAttr(f.home)}"/>`] : []), ...(f.feedUrl ? [`  <link rel="self" href="${escapeXMLAttr(f.feedUrl)}"/>`] : []),
    `  <id>${escapeXML(f.id || f.feedUrl || f.home || '')}</id>`, `  <updated>${updated}</updated>`, ...auth(f.authors, '  '), ...entries, '</feed>', ''].join('\n');
}

// --- llms.txt ------------------------------------------------------------------------------------------------------

const oneLine = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const mdLinkText = (s) => oneLine(s).replace(/[[\]]/g, (c) => '\\' + c);
// { title, summary, intro: [paragraph lines], sections: [{ title, links: [{ title, url, desc }], optional? }],
// notes: [{ title, lines: [] }] } -> llms.txt. Sections marked `optional` go under '## Optional' (the spec's name
// for links a reader may skip when the context is short).
export function llmsTxt({ title, summary = '', intro = [], sections = [], notes = [] }) {
  const out = ['# ' + oneLine(title), ''];
  if (summary) out.push('> ' + oneLine(summary), '');
  if (intro.length) out.push(...intro.map((l) => String(l)), '');
  const link = (l) => `- [${mdLinkText(l.title || l.url)}](${String(l.url).replace(/[\s()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))})${l.desc ? ': ' + oneLine(l.desc) : ''}`;
  for (const s of sections.filter((x) => !x.optional)) out.push('## ' + oneLine(s.title), '', ...(s.links || []).map(link), '');
  const opt = sections.filter((x) => x.optional);
  if (opt.length) out.push('## Optional', '', ...opt.flatMap((s) => (s.links || []).map(link)), '');
  for (const n of notes) out.push('## ' + oneLine(n.title), '', ...(n.lines || []).map((l) => String(l)), '');
  return out.join('\n');
}

// llms-full.txt: whole documents [{ title, url, text }] as plain text after a header, stopping before `max`
// characters (a file larger than a model's context helps no one). Returns { text, included, truncated }.
export function llmsFullTxt({ title, summary = '', docs = [], max = 1500000 }) {
  let text = '# ' + oneLine(title) + '\n\n' + (summary ? '> ' + oneLine(summary) + '\n\n' : '');
  let included = 0;
  for (const d of docs) {
    const part = `## ${oneLine(d.title)}\n\n${d.url ? 'Source: ' + d.url + '\n\n' : ''}${String(d.text || '').trim()}\n\n`;
    if (text.length + part.length > max) return { text, included, truncated: true };
    text += part; included++;
  }
  return { text, included, truncated: false };
}

// OpenSearch description: { name, description, template ('https://x/search?q={searchTerms}'), icon, lang }.
export function openSearchXml({ name, description = '', template, icon = '', lang = '' }) {
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">',
    `  <ShortName>${escapeXML(oneLine(name).slice(0, 16))}</ShortName>`, `  <Description>${escapeXML(oneLine(description || name).slice(0, 1024))}</Description>`,
    '  <InputEncoding>UTF-8</InputEncoding>', ...(lang ? [`  <Language>${escapeXML(lang)}</Language>`] : []),
    ...(icon ? [`  <Image height="16" width="16">${escapeXML(icon)}</Image>`] : []),
    `  <Url type="text/html" method="get" template="${escapeXMLAttr(template)}"/>`, '</OpenSearchDescription>', ''].join('\n');
}
