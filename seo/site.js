// seo/site.js - a site model for SEO files and everything built from it, without DOM (SEO Kit and Site Studio): the demo site, URLs of
// language versions, sitemap entries with hreflang clusters (split into an index when large), robots.txt groups,
// feeds of the pages marked as posts, llms.txt / llms-full.txt, JSON-LD of ten kinds built from small forms, the
// head tags of every page, the file list of the ZIP, and the checker of a pasted page (meta tags + JSON-LD rules).
// Strings shown to people are dictionary keys; the files themselves are written in the site's own words.
import { buildSitemaps, hreflangAlternates, hreflangLinks, robotsAllows, robotsTxt, w3cDate } from './sitemap.js';
import { atomXml, jsonFeed, llmsFullTxt, llmsTxt, rssXml } from './feeds.js';
import { metaIssues, metaTags, pageTitle, readMeta, renderTags } from './meta.js';
import { apartmentComplexLd, articleLd, breadcrumbLd, eventLd, faqLd, ldJson, ldNodes, organizationLd, personLd, productLd, recipeLd, websiteLd } from './jsonld.js';
import { slugify } from '../lingua/translit.js';

// ---------------------------------------------------------------------------------------------------------------
// The demo site (also the shape of a saved site)

const page = (path, title, description, more = {}) => ({
  path, title, description, lastmod: '', priority: '', changefreq: '', langs: '', image: '', post: false, author: '', tags: '', text: '', noindex: false, ...more,
});

export const PAGE_KEYS = Object.keys(page('/', '', ''));

export const DEMO_SITE = {
  name: 'Tbilisi Tea House',
  base: 'https://teahouse.example',
  description: 'Georgian teas, a small café in Old Tbilisi and tea classes for beginners and connoisseurs.',
  langs: 'en, ru, ka',
  root: 'en',
  org: {
    kind: 'Organization', name: 'Tbilisi Tea House', url: '', logo: '/img/logo.png', email: 'hello@teahouse.example', phone: '+995 32 200 00 00',
    sameAs: 'https://www.instagram.com/teahouse.example\nhttps://www.facebook.com/teahouse.example', jobTitle: '',
    street: '12 Leselidze St', locality: 'Tbilisi', region: '', postalCode: '0105', country: 'GE', lat: '41.6913', lon: '44.8079',
  },
  pages: [
    page('/', 'Tbilisi Tea House', 'Georgian teas, a small café in Old Tbilisi and tea classes for beginners and connoisseurs.', { lastmod: '2026-10-01', priority: '1', changefreq: 'weekly', image: '/img/home.jpg', text: 'We brew teas from Guria, Imereti and Samegrelo in a small café near the Sulphur Baths.' }),
    page('/menu/', 'Menu', 'Teas, pastries and seasonal drinks served in the café, with prices and allergens for every item.', { lastmod: '2026-09-20', priority: '0.8', changefreq: 'monthly' }),
    page('/classes/', 'Tea classes', 'Weekend tastings and brewing classes in English, Russian and Georgian for groups of up to eight.', { lastmod: '2026-09-28', priority: '0.7' }),
    page('/about/', 'About us', 'A family tea house founded in 2019 by two tea growers from Ozurgeti and their friends.', { lastmod: '2026-03-11', priority: '0.5' }),
    page('/blog/', 'Blog', 'Notes about Georgian tea: gardens, harvests, brewing and the people who grow it.', { lastmod: '2026-10-12', priority: '0.6' }),
    page('/blog/autumn-teas/', 'Five autumn teas from Guria', 'Smoky, honeyed and malty: five teas from the autumn harvest in Guria and how to brew each one.', { lastmod: '2026-10-12', priority: '0.6', langs: 'en, ru', image: '/img/autumn.jpg', post: true, author: 'Nino Beridze', tags: 'tea, Guria, harvest', text: 'Autumn teas in Guria are picked after the summer rains. Brew them at 90 °C for three minutes.' }),
    page('/blog/brewing-black-tea/', 'How to brew Georgian black tea', 'Water, temperature, time and cups: a simple method for Georgian black tea at home.', { lastmod: '2026-09-02', priority: '0.6', langs: 'en', post: true, author: 'Giorgi Tsereteli', tags: 'tea, brewing', text: 'Use soft water just off the boil, one teaspoon per cup and steep for four minutes.' }),
    page('/contact/', 'Contact', 'Address and opening hours.', { lastmod: '2026-01-15', priority: '0.4' }),
    page('/drafts/winter-menu/', 'Winter menu (draft)', '', { noindex: true }),
  ],
  split: 50000,
  robots: {
    groups: [
      { agents: '*', allow: '', disallow: '/admin/\n/drafts/\n/*?session=', delay: '' },
      { agents: 'GPTBot\nCCBot', allow: '', disallow: '/', delay: '' },
    ],
    host: '',
  },
  feed: { title: '', description: '', author: 'Tbilisi Tea House' },
  llms: { summary: '', intro: 'The café is open every day from 10:00 to 21:00. Classes need booking.', pagesTitle: 'Pages', postsTitle: 'Blog', postsOptional: true },
  meta: { page: 0, image: '/og.png', twitter: '@teahouse', theme: '#0f766e' },
  ld: {
    type: 'website',
    website: { searchUrl: 'https://teahouse.example/search?q={q}' },
    breadcrumb: { page: 5 },
    article: { page: 5, articleType: 'BlogPosting', author: '', section: 'Tea' },
    product: { name: 'Gurian black tea, 100 g', url: '/shop/gurian-black-tea/', description: 'Hand-rolled black tea from the hills above Ozurgeti.', image: '/img/gurian-black.jpg', sku: 'GT-100', gtin: '4860001234561', brand: 'Tbilisi Tea House', price: '18', currency: 'GEL', availability: 'in-stock', condition: 'new' },
    event: { name: 'Autumn tea tasting', url: '/classes/autumn-tasting/', description: 'Six teas of the autumn harvest with a tea grower from Guria.', image: '/img/tasting.jpg', start: '2026-11-14T16:00', end: '2026-11-14T18:00', status: 'scheduled', attendance: 'offline', place: 'Tbilisi Tea House', street: '12 Leselidze St', locality: 'Tbilisi', country: 'GE', onlineUrl: '', organizer: 'Tbilisi Tea House', price: '45', currency: 'GEL' },
    faq: { faq: 'Do you sell tea to take away?\nYes, every tea on the menu is sold in 50 g and 100 g packs.\n\nCan I book a private class?\nYes, for groups of four to eight people; write to us a week ahead.' },
    localbusiness: { businessType: 'CafeOrCoffeeShop', openingHours: 'Mo-Su 10:00-21:00', priceRange: '₾₾' },
    apartment: { name: 'Leselidze Courtyard Residences', url: '/residences/', description: 'Twenty flats around a restored courtyard above the tea house.', image: '/img/courtyard.jpg', street: '12 Leselidze St', locality: 'Tbilisi', country: 'GE', lat: '41.6913', lon: '44.8079', developer: 'Old Town Builders', units: '6', ready: '2027-Q2' },
    recipe: { name: 'Black tea with thyme', url: '/blog/thyme-tea/', description: 'Georgian black tea brewed with a sprig of fresh thyme.', image: '/img/thyme-tea.jpg', author: 'Nino Beridze', prepMinutes: '2', cookMinutes: '5', servings: '2', ingredients: '2 tsp Georgian black tea\n1 sprig of thyme\n500 ml water', steps: 'Heat the water to 95 °C.\nAdd tea and thyme to the pot.\nSteep for four minutes and serve.', category: 'Drink', cuisine: 'Georgian', calories: '' },
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Normalising a saved site (keeps only known fields of the right types)

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
// Schema-by-example normalisation: the demo site is the schema. Only keys present in base survive, only with the
// same primitive type, recursively for objects; arrays in base are skipped here and restored by explicit, capped
// code in normalizeSite (pages, robots groups). A saved file from an older or tampered version cannot inject
// unknown fields or wrong types into the app state. structuredClone keeps DEMO_SITE itself untouched.
function pick(base, obj) {
  const out = structuredClone(base);
  if (!isObj(obj)) return out;
  for (const k of Object.keys(base)) {
    const b = base[k], v = obj[k];
    if (v == null) continue;
    if (isObj(b)) out[k] = pick(b, v);
    else if (Array.isArray(b)) continue;
    else if (typeof v === typeof b) out[k] = v;
  }
  return out;
}
export function normalizeSite(saved) {
  const s = pick(DEMO_SITE, saved);
  if (isObj(saved)) {
    if (Array.isArray(saved.pages)) s.pages = saved.pages.filter(isObj).slice(0, 2000).map((p) => pick(page('', '', ''), p));
    if (isObj(saved.robots) && Array.isArray(saved.robots.groups)) s.robots.groups = saved.robots.groups.filter(isObj).slice(0, 30).map((g) => pick({ agents: '*', allow: '', disallow: '', delay: '' }, g));
    if (isObj(saved.ld)) for (const k of LD_TYPES) if (isObj(saved.ld[k]) && DEMO_SITE.ld[k]) s.ld[k] = pick(DEMO_SITE.ld[k], saved.ld[k]);
  }
  if (!LD_TYPES.includes(s.ld.type)) s.ld.type = 'website';
  return s;
}
export const newPage = (path = '/') => page(path, '', '');

// ---------------------------------------------------------------------------------------------------------------
// URLs

export const lines = (s) => String(s || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
const words = (s) => String(s || '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
const num = (v) => (v === '' || v == null || !Number.isFinite(+v) ? undefined : +v);
export const LANG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export const baseUrl = (site) => String(site.base || '').trim().replace(/\/+$/, '');
export const baseOk = (site) => /^https?:\/\/[^/\s]+$/i.test(baseUrl(site));
export function siteLocales(site) {
  const list = [...new Set(words(site.langs).filter((l) => LANG_RE.test(l)))];
  const root = rootLang(site, list);
  return list.length ? list : [root];
}
export function rootLang(site, list = null) {
  const l = list || words(site.langs).filter((x) => LANG_RE.test(x));
  return LANG_RE.test(site.root) && (!l.length || l.includes(site.root)) ? site.root : l[0] || 'en';
}
// Language versions of a page: its own list (when set) inside the site languages, else every site language.
export function pageLocales(site, p) {
  const all = siteLocales(site);
  const own = words(p.langs).filter((l) => all.includes(l));
  return own.length ? own : all;
}
// '/x/', 'x', 'https://site/x' (same site) -> '/x/'; foreign absolute URLs stay as they are.
export function normPath(site, p) {
  let s = String(p || '').trim();
  const b = baseUrl(site);
  if (b && s.toLowerCase().startsWith(b.toLowerCase())) s = s.slice(b.length) || '/';
  if (/^https?:\/\//i.test(s)) return s;
  return s.startsWith('/') ? s : '/' + s;
}
// Absolute URL of a path or a file reference ('' stays '', data: URIs and absolute URLs stay).
export function abs(site, u) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^(https?:|data:)/i.test(s)) return s;
  return baseUrl(site) + (s.startsWith('/') ? s : '/' + s);
}
export function pageUrl(site, p, lang) {
  const path = normPath(site, p.path);
  if (/^https?:/i.test(path)) return path;
  const root = rootLang(site);
  return baseUrl(site) + (!lang || lang === root ? '' : '/' + lang) + path;
}
// hreflang cluster of a page (with x-default); [] for a page in one language.
export function alternates(site, p) {
  const locs = pageLocales(site, p), root = rootLang(site);
  if (locs.length < 2) return [];
  // seo/sitemap.js points x-default at the root version, which is right only when the page has one.
  if (locs.includes(root)) return hreflangAlternates(baseUrl(site), normPath(site, p.path), locs, { root });
  return [...locs.map((l) => ({ hreflang: l, href: pageUrl(site, p, l) })), { hreflang: 'x-default', href: pageUrl(site, p, locs[0]) }];
}
export const indexed = (site) => site.pages.filter((p) => !p.noindex && String(p.path || '').trim());

// ---------------------------------------------------------------------------------------------------------------
// Sitemap and robots.txt

// One entry per language version, all sharing the same alternates list: each URL of a hreflang cluster must list
// every member including itself.
export function sitemapEntries(site) {
  const out = [];
  for (const p of indexed(site)) {
    const alts = alternates(site, p);
    const images = p.image ? [{ url: abs(site, p.image), title: p.title }] : [];
    for (const l of pageLocales(site, p)) {
      out.push({ url: pageUrl(site, p, l), lastmod: p.lastmod, changefreq: p.changefreq, priority: num(p.priority), images, alternates: alts });
    }
  }
  return out;
}
// [{ name, text, mime }] — sitemap.xml alone, or sitemap.xml as the index of sitemap-N.xml parts.
export function sitemapFiles(site) {
  const max = Math.max(1, Math.min(50000, Math.round(+site.split) || 50000));
  const r = buildSitemaps(sitemapEntries(site), { base: baseUrl(site) }, { max });
  const files = r.files.map((f) => ({ name: f.path.replace(/^\//, ''), text: f.xml, mime: 'application/xml', count: f.count }));
  if (r.index) files.unshift({ name: 'sitemap.xml', text: r.index, mime: 'application/xml', index: true, count: r.files.length });
  return files;
}

export const AI_BOTS = ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'anthropic-ai', 'CCBot', 'Google-Extended', 'PerplexityBot', 'Bytespider', 'Applebot-Extended', 'meta-externalagent'];
export const COMMON_BOTS = ['*', 'Googlebot', 'Googlebot-Image', 'Bingbot', 'YandexBot', 'DuckDuckBot', 'Baiduspider', 'Applebot', ...AI_BOTS];

export function robotsText(site) {
  const groups = site.robots.groups.map((g) => ({ agents: lines(g.agents).length ? lines(g.agents) : ['*'], allow: lines(g.allow), disallow: lines(g.disallow), crawlDelay: num(g.delay) }));
  return robotsTxt({ base: baseUrl(site), groups: groups.length ? groups : null, sitemaps: ['/sitemap.xml'], host: String(site.robots.host || '').trim() });
}
// Path part of a URL for robots rules ('/x/?q=1').
export const urlPath = (u) => { const m = /^https?:\/\/[^/]+(\/[^#]*)?/i.exec(u); return m ? m[1] || '/' : u; };
export const robotsTest = (text, path, agent) => robotsAllows(text, urlPath(String(path || '/').trim() || '/'), String(agent || '*').trim() || '*');
// Sitemap URLs that robots.txt blocks for every crawler (a map that lists blocked pages confuses search engines).
export const blockedInSitemap = (site, text = robotsText(site)) => sitemapEntries(site).filter((e) => !robotsAllows(text, urlPath(e.url), 'Googlebot')).map((e) => e.url);

// ---------------------------------------------------------------------------------------------------------------
// Feeds and llms.txt

export const posts = (site) => indexed(site).filter((p) => p.post).sort((a, b) => String(b.lastmod).localeCompare(String(a.lastmod)));
function feedModel(site, feedUrl) {
  const f = site.feed, root = rootLang(site);
  return {
    title: f.title || site.name, home: baseUrl(site) + '/', feedUrl: baseUrl(site) + feedUrl, description: f.description || site.description, lang: root,
    authors: f.author ? [f.author] : [],
    items: posts(site).map((p) => {
      const lang = pageLocales(site, p).includes(root) ? root : pageLocales(site, p)[0];
      return {
        id: pageUrl(site, p, lang), url: pageUrl(site, p, lang), title: p.title, summary: p.description, text: p.text || p.description,
        published: p.lastmod || undefined, image: abs(site, p.image) || undefined, authors: p.author ? [p.author] : [], tags: words(String(p.tags).replace(/;/g, ',')).length ? String(p.tags).split(/[,;]/).map((x) => x.trim()).filter(Boolean) : [], lang,
      };
    }),
  };
}
export const feedFiles = (site) => [
  { name: 'feed.json', text: JSON.stringify(jsonFeed(feedModel(site, '/feed.json')), null, 2) + '\n', mime: 'application/feed+json' },
  { name: 'rss.xml', text: rssXml(feedModel(site, '/rss.xml')), mime: 'application/rss+xml' },
  { name: 'atom.xml', text: atomXml(feedModel(site, '/atom.xml')), mime: 'application/atom+xml' },
];

export function llmsFiles(site) {
  const L = site.llms, root = rootLang(site);
  const link = (p) => ({ title: p.title || p.path, url: pageUrl(site, p, pageLocales(site, p).includes(root) ? root : pageLocales(site, p)[0]), desc: p.description });
  const all = indexed(site);
  const sections = [{ title: L.pagesTitle || 'Pages', links: all.filter((p) => !p.post).map(link) }];
  const ps = all.filter((p) => p.post);
  if (ps.length) sections.push({ title: L.postsTitle || 'Posts', links: ps.map(link), optional: !!L.postsOptional });
  const llms = llmsTxt({ title: site.name, summary: L.summary || site.description, intro: lines(L.intro), sections });
  const full = llmsFullTxt({ title: site.name, summary: L.summary || site.description, docs: all.map((p) => ({ title: p.title || p.path, url: link(p).url, text: p.text || p.description })) });
  return [
    { name: 'llms.txt', text: llms, mime: 'text/markdown' },
    { name: 'llms-full.txt', text: full.text, mime: 'text/markdown', included: full.included, truncated: full.truncated },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Head tags (Open Graph, Twitter, canonical, hreflang)

const OG_LOCALE = { en: 'en_US', ru: 'ru_RU', uk: 'uk_UA', de: 'de_DE', fr: 'fr_FR', es: 'es_ES', ka: 'ka_GE', it: 'it_IT', pt: 'pt_PT', pl: 'pl_PL', tr: 'tr_TR', hy: 'hy_AM', az: 'az_AZ', kk: 'kk_KZ', be: 'be_BY', ja: 'ja_JP', zh: 'zh_CN', ko: 'ko_KR', ar: 'ar_AR', he: 'he_IL', nl: 'nl_NL', sv: 'sv_SE', fi: 'fi_FI', cs: 'cs_CZ' };
export const ogLocale = (l) => { const [a, b] = String(l).split('-'); return b && b.length === 2 ? `${a}_${b.toUpperCase()}` : OG_LOCALE[a] || `${a}_${a.toUpperCase()}`; };

export function metaModel(site, p, lang) {
  const locs = pageLocales(site, p);
  const l = lang && locs.includes(lang) ? lang : locs.includes(rootLang(site)) ? rootLang(site) : locs[0];
  const own = abs(site, p.image), card = abs(site, site.meta.image);
  const image = own ? { url: own, alt: p.title } : card ? { url: card, width: 1200, height: 630, alt: p.title || site.name } : null;
  return {
    title: pageTitle(p.title, site.name), ogTitle: p.title || site.name, description: p.description, url: pageUrl(site, p, l), image,
    type: p.post ? 'article' : 'website', siteName: site.name, locale: ogLocale(l), altLocales: locs.filter((x) => x !== l).map(ogLocale),
    alternates: alternates(site, p), noindex: !!p.noindex, twitterSite: String(site.meta.twitter || '').trim(), themeColor: site.meta.theme,
    article: p.post ? { published: w3cDate(p.lastmod), author: p.author || undefined, tags: String(p.tags || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean) } : undefined,
  };
}
export const headHtml = (site, p, lang) => renderTags(metaTags(metaModel(site, p, lang))) + '\n';
export const pageIssues = (site, p) => metaIssues(metaModel(site, p));
export const hreflangHead = (site, p) => hreflangLinks(alternates(site, p), pageUrl(site, p));

// ---------------------------------------------------------------------------------------------------------------
// JSON-LD forms

export const LD_TYPES = ['organization', 'website', 'breadcrumb', 'article', 'product', 'event', 'faq', 'localbusiness', 'apartment', 'recipe'];
const SEL = (k, opts) => ({ k, kind: 'select', opts });
export const LD_FIELDS = {
  organization: [],
  website: [{ k: 'searchUrl' }],
  breadcrumb: [{ k: 'page', kind: 'page' }],
  article: [{ k: 'page', kind: 'page' }, SEL('articleType', ['BlogPosting', 'Article', 'NewsArticle']), { k: 'author' }, { k: 'section' }],
  product: [{ k: 'name' }, { k: 'url' }, { k: 'description', kind: 'long' }, { k: 'image' }, { k: 'sku' }, { k: 'gtin' }, { k: 'brand' }, { k: 'price', kind: 'num' }, { k: 'currency' },
    SEL('availability', ['in-stock', 'out-of-stock', 'preorder', 'limited', 'discontinued']), SEL('condition', ['new', 'used', 'refurbished'])],
  event: [{ k: 'name' }, { k: 'url' }, { k: 'description', kind: 'long' }, { k: 'image' }, { k: 'start', kind: 'datetime' }, { k: 'end', kind: 'datetime' },
    SEL('status', ['scheduled', 'cancelled', 'postponed', 'rescheduled', 'moved-online']), SEL('attendance', ['offline', 'online', 'mixed']),
    { k: 'place' }, { k: 'street' }, { k: 'locality' }, { k: 'country' }, { k: 'onlineUrl' }, { k: 'organizer' }, { k: 'price', kind: 'num' }, { k: 'currency' }],
  faq: [{ k: 'faq', kind: 'long', rows: 9 }],
  localbusiness: [SEL('businessType', ['LocalBusiness', 'CafeOrCoffeeShop', 'Restaurant', 'Bakery', 'Store', 'Hotel', 'RealEstateAgent', 'Dentist', 'AutoRepair', 'BeautySalon']), { k: 'openingHours', kind: 'long', rows: 3 }, { k: 'priceRange' }],
  apartment: [{ k: 'name' }, { k: 'url' }, { k: 'description', kind: 'long' }, { k: 'image' }, { k: 'street' }, { k: 'locality' }, { k: 'country' }, { k: 'lat', kind: 'num' }, { k: 'lon', kind: 'num' }, { k: 'developer' }, { k: 'units', kind: 'num' }, { k: 'ready' }],
  recipe: [{ k: 'name' }, { k: 'url' }, { k: 'description', kind: 'long' }, { k: 'image' }, { k: 'author' }, { k: 'prepMinutes', kind: 'num' }, { k: 'cookMinutes', kind: 'num' }, { k: 'servings', kind: 'num' },
    { k: 'ingredients', kind: 'long', rows: 4 }, { k: 'steps', kind: 'long', rows: 4 }, { k: 'category' }, { k: 'cuisine' }, { k: 'calories', kind: 'num' }],
};
// FAQ text: blocks separated by an empty line; the first line is the question, the rest the answer.
export const parseFaq = (s) => String(s || '').split(/\r?\n\s*\r?\n/).map((b) => lines(b)).filter((b) => b.length >= 2).map((b) => ({ q: b[0], a: b.slice(1).join(' ') }));

const orgUrl = (site) => abs(site, site.org.url) || baseUrl(site) + '/';
export const orgId = (site) => (site.org.kind === 'Person' ? orgUrl(site) + '#person' : orgUrl(site).replace(/\/?$/, '/') + '#org');
const orgFields = (site) => {
  const o = site.org;
  return {
    url: orgUrl(site), name: o.name || site.name, logo: abs(site, o.logo) || undefined, email: o.email, phone: o.phone, sameAs: lines(o.sameAs), description: site.description,
    address: { street: o.street, locality: o.locality, region: o.region, postalCode: o.postalCode, country: o.country }, geo: { lat: o.lat, lon: o.lon },
  };
};
const humanize = (seg) => { const s = decodeURIComponent(seg).replace(/[-_]+/g, ' ').trim(); return s.charAt(0).toUpperCase() + s.slice(1); };

// The JSON-LD object of a form (null when the form points at a page that does not exist).
export function ldBuild(site, type) {
  const d = site.ld[type] || {}, u = (x) => abs(site, x) || undefined;
  switch (type) {
    case 'organization':
      if (site.org.kind === 'Person') { const o = site.org; return personLd({ url: orgUrl(site), name: o.name || site.name, image: u(o.logo), jobTitle: o.jobTitle, sameAs: lines(o.sameAs), description: site.description }); }
      return organizationLd({ type: site.org.kind === 'LocalBusiness' ? 'LocalBusiness' : 'Organization', ...orgFields(site) });
    case 'website':
      return websiteLd({ url: baseUrl(site) + '/', name: site.name, description: site.description, languages: siteLocales(site), publisher: orgId(site), searchUrl: String(d.searchUrl || '').trim() });
    case 'breadcrumb': {
      const p = site.pages[d.page];
      if (!p) return null;
      const path = normPath(site, p.path);
      const segs = path.split('/').filter(Boolean);
      const home = site.pages.find((x) => normPath(site, x.path) === '/');
      const crumbs = [{ name: (home && home.title) || site.name, url: baseUrl(site) + '/' }];
      let acc = '/';
      for (const s of segs) {
        acc += s + '/';
        const at = site.pages.find((x) => [acc, acc.slice(0, -1)].includes(normPath(site, x.path)));
        crumbs.push({ name: (at && at.title) || humanize(s), url: at ? pageUrl(site, at) : baseUrl(site) + acc });
      }
      return breadcrumbLd(crumbs);
    }
    case 'article': {
      const p = site.pages[d.page];
      if (!p) return null;
      return articleLd({ type: d.articleType, url: pageUrl(site, p), title: p.title, description: p.description, image: u(p.image), author: d.author || p.author || undefined,
        publisher: orgId(site), published: w3cDate(p.lastmod) || undefined, lang: pageLocales(site, p)[0], section: d.section });
    }
    case 'product':
      return productLd({ url: u(d.url), name: d.name, description: d.description, image: u(d.image), sku: d.sku, gtin: d.gtin, brand: d.brand || undefined,
        offers: num(d.price) != null ? [{ price: num(d.price), currency: String(d.currency).trim().toUpperCase(), availability: d.availability, condition: d.condition }] : [] });
    case 'event':
      return eventLd({ url: u(d.url), name: d.name, description: d.description, image: u(d.image), start: d.start, end: d.end, status: d.status,
        online: d.attendance === 'mixed' ? 'mixed' : d.attendance === 'online', place: d.place, address: { street: d.street, locality: d.locality, country: d.country },
        onlineUrl: d.onlineUrl, organizer: d.organizer || undefined, lang: rootLang(site),
        offers: num(d.price) != null ? [{ price: num(d.price), currency: String(d.currency).trim().toUpperCase(), url: u(d.url), availability: 'in-stock' }] : [] });
    case 'faq':
      return faqLd(parseFaq(d.faq));
    case 'localbusiness':
      return organizationLd({ ...orgFields(site), type: d.businessType || 'LocalBusiness', openingHours: lines(d.openingHours), priceRange: d.priceRange });
    case 'apartment':
      return apartmentComplexLd({ url: u(d.url), name: d.name, description: d.description, image: u(d.image), address: { street: d.street, locality: d.locality, country: d.country },
        geo: { lat: d.lat, lon: d.lon }, developer: d.developer || undefined, units: num(d.units), ready: d.ready });
    case 'recipe':
      return recipeLd({ url: u(d.url), name: d.name, description: d.description, image: u(d.image), author: d.author || undefined, prepMinutes: num(d.prepMinutes),
        cookMinutes: num(d.cookMinutes), servings: num(d.servings), ingredients: lines(d.ingredients), steps: lines(d.steps), category: d.category, cuisine: d.cuisine, calories: num(d.calories) });
    default: return null;
  }
}
// Readable <script> (indented, with the same escaping as seo/jsonld.js ldJson).
export const prettyLd = (x) => '<script type="application/ld+json">\n' + JSON.stringify(x, null, 2).replace(/</g, '\\u003C').replace(/>/g, '\\u003E').replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + '\n</script>\n';
export const compactLd = ldJson;

// ---------------------------------------------------------------------------------------------------------------
// JSON-LD rules (what search engines need to show a rich result), shared by the builders and the checker

const BUSINESS = ['LocalBusiness', 'CafeOrCoffeeShop', 'Restaurant', 'Bakery', 'Store', 'Hotel', 'RealEstateAgent', 'Dentist', 'AutoRepair', 'BeautySalon', 'FoodEstablishment', 'LodgingBusiness'];
const ARTICLE = ['Article', 'BlogPosting', 'NewsArticle', 'TechArticle'];
// [types, required, recommended] per rich-result family, a condensed form of Google's documentation: missing
// required properties make the rich result ineligible (error); recommended ones only reduce it (warn).
const RULES = [
  [['Organization'], ['name'], ['url', 'logo']],
  [BUSINESS, ['name', 'address'], ['telephone', 'openingHours', 'geo', 'image']],
  [['Person'], ['name'], ['url']],
  [['WebSite'], ['name', 'url'], []],
  [['BreadcrumbList'], ['itemListElement'], []],
  [ARTICLE, ['headline'], ['image', 'datePublished', 'author']],
  [['Product'], ['name'], ['image', 'offers']],
  [['Event'], ['name', 'startDate', 'location'], ['image', 'endDate', 'offers', 'description']],
  [['FAQPage'], ['mainEntity'], []],
  [['ApartmentComplex'], ['name'], ['address', 'image']],
  [['Recipe'], ['name', 'image'], ['recipeIngredient', 'recipeInstructions', 'author']],
];
// Issues of one node: [{ level: 'error' | 'warn', code, prop? }].
export function ldIssues(n) {
  const out = [];
  if (!n || typeof n !== 'object') return [{ level: 'error', code: 'notObject' }];
  const types = [].concat(n['@type'] || []);
  if (!types.length) out.push({ level: 'error', code: 'noType' });
  if (!/schema\.org/i.test(JSON.stringify(n['@context'] || ''))) out.push({ level: 'error', code: 'noContext' });
  const has = (k) => n[k] != null && n[k] !== '' && !(Array.isArray(n[k]) && !n[k].length);
  let known = false;
  for (const [ts, req, rec] of RULES) {
    if (!types.some((x) => ts.includes(x))) continue;
    known = true;
    for (const k of req) if (!has(k)) out.push({ level: 'error', code: 'required', prop: k });
    for (const k of rec) if (!has(k)) out.push({ level: 'warn', code: 'recommended', prop: k });
  }
  if (types.includes('Product') && !has('offers') && !has('review') && !has('aggregateRating')) out.push({ level: 'error', code: 'productOffer' });
  for (const o of [].concat(n.offers || [])) {
    if (o && typeof o === 'object' && (o['@type'] === 'Offer' || !o['@type'])) {
      if (o.price == null && !(o.priceSpecification && o.priceSpecification.price != null)) out.push({ level: 'warn', code: 'offerPrice' });
      if (!o.priceCurrency && !(o.priceSpecification && o.priceSpecification.priceCurrency)) out.push({ level: 'warn', code: 'offerCurrency' });
    }
  }
  for (const k of ['@id', 'url', 'image', 'logo']) {
    const v = n[k], s = typeof v === 'string' ? v : v && typeof v.url === 'string' ? v.url : '';
    if (s && !/^(https?:|data:)/i.test(s) && !(k === '@id' && s.startsWith('_:'))) out.push({ level: 'warn', code: 'relative', prop: k });
  }
  if (!known && types.length) out.push({ level: 'info', code: 'unknownType' });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Checker of a pasted page

// Severity policy: error = the page will not get a preview / rich result (no title, no image, invalid JSON-LD);
// warn = degraded; info = good practice. Broken JSON-LD is reported as ldError instead of throwing, so the rest of
// the report is still shown.
export function checkPage(html) {
  const src = String(html || '');
  const meta = readMeta(src);
  const og = meta.og, tw = meta.twitter;
  const img = og['og:image'] ? { url: og['og:image'], width: num(og['og:image:width']), height: num(og['og:image:height']) } : null;
  const model = { title: meta.title, description: meta.description || og['og:description'], url: meta.canonical || og['og:url'], image: img };
  const issues = metaIssues(model).map((x) => ({ ...x, level: x.issue === 'missing' && ['title', 'image'].includes(x.field) ? 'error' : 'warn' }));
  const add = (field, issue, level = 'warn') => issues.push({ field, issue, level });
  if (!og['og:title']) add('ogTitle', 'missing');
  if (!og['og:description']) add('ogDescription', 'missing');
  if (!og['og:type']) add('ogType', 'missing', 'info');
  if (!tw['twitter:card']) add('twitterCard', 'missing', 'info');
  if (img && !og['og:image:alt']) add('imageAlt', 'missing', 'info');
  if (!meta.canonical) add('canonical', 'missing');
  if (meta.alternates.length) {
    if (meta.alternates.length > 1 && !meta.alternates.some((a) => a.hreflang.toLowerCase() === 'x-default')) add('hreflang', 'xdefault');
    if (meta.alternates.some((a) => !/^https?:\/\//i.test(a.href))) add('hreflang', 'relative');
    if (meta.canonical && !meta.alternates.some((a) => a.href === meta.canonical)) add('hreflang', 'self', 'info');
    const bad = meta.alternates.filter((a) => a.hreflang.toLowerCase() !== 'x-default' && !LANG_RE.test(a.hreflang.replace(/_/g, '-')));
    if (bad.length) add('hreflang', 'code');
  }
  if (/noindex/i.test(meta.robots)) add('robots', 'noindex');
  const htmlTag = /<html\b[^>]*>/i.exec(src);
  if (htmlTag && !/\slang\s*=\s*["']?[a-z]/i.test(htmlTag[0])) add('lang', 'missing');
  if (/<html\b/i.test(src) && !/<meta\b[^>]*name\s*=\s*["']?viewport/i.test(src)) add('viewport', 'missing', 'info');
  let nodes = [], ldError = '';
  try { nodes = ldNodes(src); } catch (e) { ldError = String(e && e.message || e); }
  return { meta, model, issues, nodes: nodes.map((n) => ({ node: n, issues: ldIssues(n) })), ldError };
}

// Sample page for the checker: a blog post with a canonical, hreflang links and JSON-LD, but no og:image (and an
// Article without an image). URLs are built from a variable so that no literal remote resource appears in the code.
export function samplePage(base = 'https://teahouse.example') {
  const u = (p) => base + p;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Five autumn teas from Guria — Tbilisi Tea House</title>
<meta name="description" content="Smoky, honeyed and malty: five teas from the autumn harvest in Guria and how to brew each one.">
<link rel="canonical" href="${u('/blog/autumn-teas/')}">
<link rel="alternate" hreflang="en" href="${u('/blog/autumn-teas/')}">
<link rel="alternate" hreflang="ru" href="${u('/ru/blog/autumn-teas/')}">
<meta property="og:type" content="article">
<meta property="og:title" content="Five autumn teas from Guria">
<meta property="og:description" content="Smoky, honeyed and malty: five teas from the autumn harvest in Guria.">
<meta property="og:url" content="${u('/blog/autumn-teas/')}">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"BlogPosting","headline":"Five autumn teas from Guria","datePublished":"2026-10-12","author":{"@type":"Person","name":"Nino Beridze"},"url":"${u('/blog/autumn-teas/')}"}
</script>
</head>
<body><h1>Five autumn teas from Guria</h1></body>
</html>
`;
}

// ---------------------------------------------------------------------------------------------------------------
// Every file of the site kit (the ZIP)

export const pageSlug = (site, p) => slugify(normPath(site, p.path).replace(/^https?:\/\/[^/]+/i, ''), { max: 60 }) || 'home';
export function allFiles(site) {
  const files = [...sitemapFiles(site), { name: 'robots.txt', text: robotsText(site), mime: 'text/plain' }, ...llmsFiles(site)];
  if (posts(site).length) files.push(...feedFiles(site));
  for (const type of LD_TYPES) {
    const x = ldBuild(site, type);
    if (x) files.push({ name: `jsonld/${type}.html`, text: prettyLd(x), mime: 'text/html' });
  }
  const root = rootLang(site), seen = new Set();
  for (const p of site.pages.filter((x) => String(x.path || '').trim())) {
    for (const l of pageLocales(site, p)) {
      let name = `head/${pageSlug(site, p)}${l === root ? '' : '.' + l}.html`;
      while (seen.has(name)) name = name.replace(/\.html$/, '-2.html');
      seen.add(name);
      files.push({ name, text: headHtml(site, p, l), mime: 'text/html' });
    }
  }
  return files;
}
