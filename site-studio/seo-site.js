// site-studio/seo-site.js - the SEO files of a site through the site model of seo/site.js (the one SEO Kit edits):
// sitemap.xml, robots.txt (optionally closed to AI crawlers), llms.txt / llms-full.txt and JSON-LD of the website and
// its owner, built from the pages of the document. Serverless and backend packages carry them when the site's address
// (doc.meta.siteUrl) is known; Site → SEO shows and checks them. Pure functions (Node and browsers).
import { AI_BOTS, allFiles, baseOk, ldBuild, normalizeSite, prettyLd } from '../seo/site.js';
import { metaIssues } from '../seo/meta.js';
import { htmlToText, pickText } from '../i18n/text.js';
import { isObj, str } from '../util/value.js';
import { siteRoutes } from './viewer-pages.js';
import { closedPages } from './viewer-access.js';
//
// Why adapt to seo/site.js instead of writing sitemap/robots here: one generator, one set of validators (SEO Kit uses
// the same model), so the studio cannot drift from the standalone tool. This module only maps the document onto that
// model; all formatting rules live there.
// Privacy invariant: closed (role-restricted) pages and 451 (encrypted) sections never leak into public SEO files.

// Plain one-line text of an i18n value in the default language: SEO files are single-language and carry no markup.
const text = (doc, v) => htmlToText(str(pickText(v, doc.defaultLang, doc))).replace(/\s+/g, ' ').trim();

// Text of a page for llms-full.txt: the plain text of its text-like blocks (first 4 000 characters).
function pageText(doc, page) {
  const out = [];
  const visit = (b) => {
    // 451 sections never reach llms-full.txt (their text exists only encrypted in the pages).
    if (!isObj(b) || b.hidden || b.type === 'wk-secret') return;
    // Wiki markup is stripped crudely ({{templates}}, [[ ]], '' bold/italic): good enough for an LLM summary file.
    if (typeof b.type === 'string' && b.type.startsWith('wk-') && typeof b.text === 'string') out.push(b.text.replace(/\{\{[^}]*\}\}|\[\[|\]\]|'{2,}/g, ' ').slice(0, 2000));
    for (const k of ['title', 'lead', 'html', 'text']) if (isObj(b[k])) { const s = text(doc, b[k]); if (s) out.push(s); }
    for (const k of ['blocks']) if (Array.isArray(b[k])) b[k].forEach(visit);
    if (Array.isArray(b.cols)) b.cols.forEach((c) => (c.blocks || []).forEach(visit));
    // Versioned blocks: only the first (current) version is public text.
    if (Array.isArray(b.versions)) (b.versions[0] && b.versions[0].blocks || []).forEach(visit);
  };
  (page.blocks || []).forEach(visit);
  return out.join('\n').slice(0, 4000);
}

/** The seo/site.js model of a document: one page per route (closed pages and pages marked noindex are kept out). */
function seoSiteOf(doc, o = {}) {
  const base = str(o.base != null ? o.base : doc.meta && doc.meta.siteUrl).trim().replace(/\/+$/, '');
  const R = siteRoutes(doc);
  const closed = new Set(closedPages(doc).map((p) => p.id));
  const pages = [];
  const byId = new Map((doc.regions.main || []).map((p) => [p.id, p]));
  // Legacy single-page documents have no route table: no page entries, the site-level fields still describe '/'.
  for (const e of R.legacy ? [] : R.list) {
    const p = byId.get(e.id);
    if (!p) continue;
    pages.push({
      path: e.home ? '/' : '/' + e.slug + '/',
      title: text(doc, p.metaTitle) || text(doc, p.title) || text(doc, doc.meta.title),
      description: text(doc, p.metaDesc) || (e.home ? text(doc, doc.meta.description) : ''),
      lastmod: str(doc.meta.modified).slice(0, 10), priority: e.home ? '1' : '', changefreq: '', langs: '', image: '', post: false, author: '', tags: '',
      // Closed pages stay in the model as noindex (seoIssues and the generator skip them) rather than vanishing.
      text: pageText(doc, p), noindex: !!p.noindex || closed.has(p.id),
    });
  }
  // Server-only paths of backend packages are disallowed even for static exports: harmless when absent, and the
  // same robots.txt stays valid if the site later moves to the backend package.
  const robots = { groups: [{ agents: '*', allow: '', disallow: '/admin/\n/api/\n/_studio/\n/_auth/', delay: '' }], host: '' };
  if (o.noAI) robots.groups.push({ agents: AI_BOTS.join('\n'), allow: '', disallow: '/', delay: '' });
  return normalizeSite({
    name: text(doc, doc.meta.title) || doc.name, base, description: text(doc, doc.meta.description),
    langs: doc.defaultLang, root: doc.defaultLang,
    org: { kind: 'Organization', name: doc.meta.author || text(doc, doc.meta.title) || doc.name, url: '', logo: '', email: '', phone: '', sameAs: '', jobTitle: '', street: '', locality: '', region: '', postalCode: '', country: '', lat: '', lon: '' },
    pages, split: 50000, robots,
    feed: { title: '', description: '', author: doc.meta.author || '' },
    llms: { summary: '', intro: '', pagesTitle: 'Pages', postsTitle: 'Posts', postsOptional: true },
    meta: { page: 0, image: '', twitter: '', theme: (doc.theme && doc.theme.accent) || '' },
    ld: { type: 'website' },
  });
}

/** Files for the root of a serverless or backend site; [] while the site's address is unknown. */
function seoFiles(doc, o = {}) {
  const site = seoSiteOf(doc, o);
  // Sitemaps require absolute URLs; without a known address the files would be invalid, so emit nothing.
  if (!baseOk(site)) return [];
  // head/ and jsonld/ are snippets for pasting into pages, not root files; the export injects JSON-LD itself.
  return allFiles(site).filter((f) => !/^(head|jsonld)\//.test(f.name)).map((f) => ({ path: f.name, data: f.text }));
}

/** JSON-LD of the website and its owner for the head of the home page ('' without an address). */
function seoHomeLd(doc) {
  const site = seoSiteOf(doc);
  if (!baseOk(site)) return '';
  const w = ldBuild(site, 'website');
  return w ? prettyLd(w) : '';
}

/** Problems of the pages' head tags (title / description length…): [{ path, issues: [{ level, key, … }] }]. */
function seoIssues(doc) {
  // Placeholder base: the title/description checks do not depend on the real domain, so they run before one is set.
  const site = seoSiteOf(doc, { base: str(doc.meta && doc.meta.siteUrl) || 'https://example.org' });
  return site.pages.filter((p) => !p.noindex).map((p) => ({ path: p.path, title: p.title, issues: metaIssues({ title: p.title, description: p.description, url: site.base + p.path, lang: site.root }) }));
}

export { seoFiles, seoHomeLd, seoIssues, seoSiteOf };
