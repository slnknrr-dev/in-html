// seo/test.js - unit tests of the seo library: `node seo/test.js` (importing the module runs nothing).
// JSON-LD builders (empty fields dropped, script embedding, graph, reading back), sitemaps with hreflang and
// splitting (parsed back with xml/), robots.txt write and match, JSON Feed / RSS / Atom / llms.txt / OpenSearch,
// Open Graph meta tags and their reader, the OG card layout, and IndexNow batches.
//
// Round trips are the main technique: build -> parse back (sitemaps through xml/, meta tags through readMeta,
// JSON-LD through ldNodes), so writer and reader validate each other and escaping bugs show up as mismatches.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { child, children, parseXML, root, textOf } from '../xml/xml.js';
import { accommodationLd, apartmentComplexLd, articleLd, breadcrumbLd, compact, eventLd, faqLd, graph, itemListLd, ldJson, ldNodes, ldOfType, ldScript, offerLd, orderLd, organizationLd, productLd, profilePageLd, recipeLd, websiteLd } from './jsonld.js';
import { buildSitemaps, hreflangAlternates, hreflangLinks, latestLastmod, robotsAllows, robotsTxt, sitemapIndexXml, urlsetXml, w3cDate } from './sitemap.js';
import { atomXml, jsonFeed, llmsFullTxt, llmsTxt, openSearchXml, rssXml } from './feeds.js';
import { excerpt, htmlText, metaHtml, metaIssues, metaTags, pageTitle, readMeta } from './meta.js';
import { OG_HEIGHT, OG_WIDTH, ogCacheName, ogCardSvg, textWidth, wrapText } from './og.js';
import { groupByHost, indexNowRequests, indexNowStatus, isIndexNowKey, keyFile, makeIndexNowKey, paceRequests } from './indexnow.js';

// Run only when executed directly; importing run() has no side effects.
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const ok = (name, cond) => eq(name, !!cond, true);
  const throws = (name, fn) => { try { fn(); fail++; console.log(`FAIL ${name}: no throw`); } catch { pass++; } };

  // --- jsonld -----------------------------------------------------------------------------------------------------
  eq('compact', compact({ a: '', b: [], c: null, d: 0, e: { '@type': 'X' }, f: { '@type': 'Y', n: 1 }, g: [{}, 'x'] }), { d: 0, f: { '@type': 'Y', n: 1 }, g: ['x'] });
  const ev = eventLd({ url: 'https://x.ge/e/1', name: 'Concert', lang: 'en', start: '2026-10-24T19:00', place: 'Opera', address: { locality: 'Batumi', country: 'GE' }, organizer: { name: 'KH', url: 'https://x.ge' }, status: 'cancelled', description: '' });
  eq('event', [ev['@type'], ev.eventStatus, ev.eventAttendanceMode, ev.location.address.addressLocality, ev.organizer.name, 'description' in ev, 'image' in ev],
    ['Event', 'https://schema.org/EventCancelled', 'https://schema.org/OfflineEventAttendanceMode', 'Batumi', 'KH', false, false]);
  eq('event online mixed', eventLd({ url: 'u', name: 'n', online: 'mixed', place: 'Hall', onlineUrl: 'https://meet' }).location.map((l) => l['@type']), ['Place', 'VirtualLocation']);
  const off = offerLd({ min: 700, max: 1200, currency: 'GEL', per: 'day', kind: 'rent', availability: 'in-stock' }, 'https://x.ge/l/1');
  eq('offer range', [off.price, off.businessFunction, off.priceSpecification.minPrice, off.priceSpecification.maxPrice, off.priceSpecification.unitCode, off.url],
    [700, 'http://purl.org/goodrelations/v1#LeaseOut', 700, 1200, 'DAY', 'https://x.ge/l/1']);
  eq('offer zero price', offerLd({ price: 0, currency: 'USD' }).price, 0);
  const prod = productLd({ url: 'https://s/p/1', name: 'Tea', gtin: '4860001234561', brand: 'Kolkheti', offers: [{ price: 9.5, currency: 'GEL', availability: 'sold-out' }], rating: { value: 4.5, count: 10 } });
  eq('product', [prod.gtin13, prod.brand, prod.offers.availability, prod.aggregateRating.reviewCount], ['4860001234561', { '@type': 'Brand', name: 'Kolkheti' }, 'https://schema.org/SoldOut', 10]);
  eq('product aggregate', productLd({ name: 'x', aggregate: true, offers: [{ price: 5, currency: 'GEL' }, { price: 3 }] }).offers, { '@type': 'AggregateOffer', priceCurrency: 'GEL', lowPrice: 3, highPrice: 5, offerCount: 2 });
  const org = organizationLd({ url: 'https://x.ge', name: 'KH', logo: '/logo.png', sameAs: ['https://t.me/kh', 'javascript:x'] });
  eq('org', [org['@id'], org.logo.url, org.sameAs], ['https://x.ge/#org', '/logo.png', ['https://t.me/kh']]);
  const site = websiteLd({ url: 'https://x.ge/', name: 'KH', languages: ['ka', 'ru'], publisher: 'https://x.ge/#org', searchUrl: 'https://x.ge/search?q={q}' });
  eq('website search', [site.potentialAction.target.urlTemplate, site.inLanguage, site.publisher], ['https://x.ge/search?q={search_term_string}', ['ka', 'ru'], { '@id': 'https://x.ge/#org' }]);
  eq('breadcrumbs', breadcrumbLd([{ name: 'Home', url: 'https://x/' }, { name: 'Board', url: 'https://x/b' }, { name: 'Lot' }]).itemListElement.map((x) => [x.position, x.item || '']), [[1, 'https://x/'], [2, 'https://x/b'], [3, '']]);
  const prof = profilePageLd({ url: 'https://x/~ana', name: 'Ana', alternateName: '~ana', sameAs: ['https://github.com/ana'] });
  eq('profile', [prof['@type'], prof.mainEntity['@type'], prof.mainEntity['@id']], ['ProfilePage', 'Person', 'https://x/~ana#person']);
  const list = itemListLd([{ url: 'https://x/1' }, { url: 'https://x/2' }], { total: 40, refs: true, id: 'https://x/#list' });
  eq('itemlist', [list.numberOfItems, list.itemListElement[1]], [40, { '@type': 'ListItem', position: 2, url: 'https://x/2', item: { '@id': 'https://x/2' } }]);
  eq('itemlist full', itemListLd([{ item: productLd({ name: 'A' }) }]).itemListElement[0].item, { '@type': 'Product', name: 'A' });
  eq('complex', apartmentComplexLd({ url: 'u', name: 'Sea', units: 12, developer: { name: 'Dev' } }).numberOfAvailableAccommodationUnits.value, 12);
  eq('accommodation', accommodationLd({ type: 'Apartment', url: 'u', rooms: 3, floorSize: 84, amenities: ['balcony'], offers: [{ price: 90000, currency: 'USD', kind: 'sale' }] })['@type'], ['Apartment', 'Product']);
  const rec = recipeLd({ name: 'Khachapuri', prepMinutes: 30, cookMinutes: 95, servings: 4, ingredients: ['flour'], steps: ['Knead', 'Bake'] });
  eq('recipe', [rec.prepTime, rec.cookTime, rec.totalTime, rec.recipeInstructions[1].text], ['PT30M', 'PT1H35M', 'PT2H5M', 'Bake']);
  eq('article', articleLd({ url: 'u', title: 'T'.repeat(200), publisher: 'https://x/#org', published: '2026-10-01' }).headline.length, 110);
  eq('faq', faqLd([{ q: 'Q?', a: 'A.' }, { q: 'no answer' }]).mainEntity.length, 1);
  eq('order', orderLd({ number: 'S-1', status: 'delivered', currency: 'GEL', items: [{ name: 'Tea', qty: 2, price: 9.5 }], total: 19 }).orderStatus, 'https://schema.org/OrderDelivered');
  const evil = { '@type': 'Thing', name: '</script><script>alert(1)</script> &  ' };
  ok('ld script safe', !ldScript(evil).slice(8, -9).includes('<') && !ldJson(evil).includes(' '));
  eq('ld round trip', JSON.parse(ldJson(evil)), evil);
  const page = ldScript(graph(org, site)) + '\n<p>x</p>\n' + ldScript(ev);
  const nodes = ldNodes(page);
  eq('ld nodes', [nodes.length, nodes[0]['@context'], ldOfType(nodes, 'Event').length], [3, 'https://schema.org', 1]);
  throws('ld broken', () => ldNodes('<script type="application/ld+json">{oops</script>'));

  // --- sitemap ----------------------------------------------------------------------------------------------------
  eq('alternates', hreflangAlternates('https://x.ge/', '/blog/a', ['ka', 'ru', 'en'], { root: 'ka' }), [
    { hreflang: 'ka', href: 'https://x.ge/blog/a' }, { hreflang: 'ru', href: 'https://x.ge/ru/blog/a' }, { hreflang: 'en', href: 'https://x.ge/en/blog/a' }, { hreflang: 'x-default', href: 'https://x.ge/blog/a' }]);
  eq('alternates one locale', hreflangAlternates('https://x', '/', ['ru']), []);
  eq('w3c', [w3cDate('2026-10-24T10:00:00Z'), w3cDate('bad'), w3cDate(Date.UTC(2026, 0, 2)), w3cDate('2026-10-24T10:00:00.123Z', true)], ['2026-10-24', '', '2026-01-02', '2026-10-24T10:00:00+00:00']);
  const um = urlsetXml([{ path: '/', lastmod: '2026-10-01T05:00:00Z', priority: 1 }, { path: 'a&b', changefreq: 'weekly', images: ['/i/1.jpg', { url: 'https://cdn/2.jpg', title: 'Two' }] }], { base: 'https://x.ge', locales: ['ka', 'ru'], root: 'ka', lang: 'ru' });
  const ux = root(parseXML(um));
  const urls = children(ux, 'url');
  eq('urlset parse', [urls.length, textOf(child(urls[0], 'loc')), textOf(child(urls[0], 'lastmod')), textOf(child(urls[1], 'loc'))], [2, 'https://x.ge/ru/', '2026-10-01', 'https://x.ge/ru/a&b']);
  eq('urlset alternates', children(urls[0], 'xhtml:link').map((l) => l.attrs.hreflang), ['ka', 'ru', 'x-default']);
  eq('urlset images', children(urls[1], 'image:image').map((i) => textOf(child(i, 'image:loc'))), ['https://x.ge/i/1.jpg', 'https://cdn/2.jpg']);
  ok('urlset empty valid', root(parseXML(urlsetXml([], { base: 'https://x' }))).name === 'urlset');
  const many = Array.from({ length: 5 }, (_, i) => ({ path: '/p' + i, lastmod: `2026-10-0${i + 1}` }));
  const split = buildSitemaps(many, { base: 'https://x' }, { max: 2 });
  eq('split', [split.files.length, split.files.map((f) => f.count), children(root(parseXML(split.index)), 'sitemap').length], [3, [2, 2, 1], 3]);
  eq('split one', buildSitemaps(many, { base: 'https://x' }).index, '');
  eq('latest', latestLastmod(many), '2026-10-05');
  ok('index', sitemapIndexXml([{ path: '/s1.xml', lastmod: '2026-10-01' }], { base: 'https://x/' }).includes('<loc>https://x/s1.xml</loc>'));
  eq('hreflang links', hreflangLinks([{ hreflang: 'ru', href: 'https://x/ru/' }], 'https://x/'), '<link rel="canonical" href="https://x/">\n<link rel="alternate" hreflang="ru" href="https://x/ru/">');
  const rb = robotsTxt({ base: 'https://x.ge', disallow: ['/admin', '/e/*/edit'], sitemaps: ['/sitemap.xml', 'https://x.ge/news.xml'] });
  eq('robots', rb, 'User-agent: *\nDisallow: /admin\nDisallow: /e/*/edit\n\nSitemap: https://x.ge/sitemap.xml\nSitemap: https://x.ge/news.xml\n');
  eq('robots open', robotsTxt({ sitemaps: [] }), 'User-agent: *\nDisallow:\n');
  const rb2 = robotsTxt({ groups: [{ agents: ['GPTBot', 'CCBot'], disallow: ['/'] }, { agents: ['*'], allow: ['/admin/public$'], disallow: ['/admin'], crawlDelay: 2 }], sitemaps: [] });
  eq('robots match', [robotsAllows(rb, '/admin/x'), robotsAllows(rb, '/e/5/edit'), robotsAllows(rb, '/e/5'), robotsAllows(rb2, '/', 'Mozilla GPTBot/1.0'), robotsAllows(rb2, '/admin/public'), robotsAllows(rb2, '/admin/public/x'), robotsAllows(rb2, '/blog')],
    [false, false, true, false, true, false, true]);

  // --- feeds ------------------------------------------------------------------------------------------------------
  const items = [
    { url: 'https://x/a', title: 'A & B', summary: 'Sum', html: '<p>Hi ]]> there</p>', published: '2026-10-01T10:00:00Z', authors: ['Ana'], tags: ['news'] },
    { id: 'urn:x:2', url: 'https://x/b', title: 'B', text: 'Plain', modified: '2026-10-05T10:00:00Z', attachments: [{ url: 'https://x/b.mp3', type: 'audio/mpeg', size: 123 }], ext: { kh: { kind: 'lot' } } },
  ];
  const jf = jsonFeed({ title: 'KH', home: 'https://x/', feedUrl: 'https://x/feed.json', lang: 'en', items, ext: { kh: { site: 'x' } } });
  eq('json feed', [jf.version, jf.items[0].id, jf.items[0].content_html, 'content_text' in jf.items[0], jf.items[0].date_published, jf.items[1].attachments[0].mime_type, jf.items[1]._kh, jf._kh],
    ['https://jsonfeed.org/version/1.1', 'https://x/a', '<p>Hi ]]> there</p>', false, '2026-10-01T10:00:00Z', 'audio/mpeg', { kind: 'lot' }, { site: 'x' }]);
  const rss = rssXml({ title: 'KH', home: 'https://x/', feedUrl: 'https://x/rss.xml', items });
  const rx = child(root(parseXML(rss)), 'channel');
  const ri = children(rx, 'item');
  eq('rss', [textOf(child(ri[0], 'title')), textOf(child(ri[0], 'content:encoded')), child(ri[1], 'guid').attrs.isPermaLink, textOf(child(rx, 'lastBuildDate'))],
    ['A & B', '<p>Hi ]]> there</p>', 'false', 'Mon, 05 Oct 2026 10:00:00 GMT']);
  const atom = root(parseXML(atomXml({ title: 'KH', home: 'https://x/', feedUrl: 'https://x/atom.xml', items })));
  eq('atom', [textOf(child(atom, 'updated')), children(atom, 'entry').length, textOf(child(children(atom, 'entry')[0], 'content'))], ['2026-10-05T10:00:00Z', 2, '<p>Hi ]]> there</p>']);
  const llms = llmsTxt({ title: 'KristinaHouse', summary: 'A regional portal\nof Georgia.', sections: [{ title: 'Board', links: [{ title: 'Real [estate]', url: 'https://x/board/estate (new)', desc: 'flats' }] }, { title: 'Archive', optional: true, links: [{ title: 'Old', url: 'https://x/old' }] }], notes: [{ title: 'How to cite', lines: ['- Cite the canonical URL.'] }] });
  eq('llms', llms, '# KristinaHouse\n\n> A regional portal of Georgia.\n\n## Board\n\n- [Real \\[estate\\]](https://x/board/estate%20%28new%29): flats\n\n## Optional\n\n- [Old](https://x/old)\n\n## How to cite\n\n- Cite the canonical URL.\n');
  const full = llmsFullTxt({ title: 'T', docs: [{ title: 'a', text: 'x'.repeat(50) }, { title: 'b', text: 'y'.repeat(50) }], max: 100 });
  eq('llms full cap', [full.included, full.truncated], [1, true]);
  ok('opensearch', root(parseXML(openSearchXml({ name: 'KristinaHouse Search', template: 'https://x/search?q={searchTerms}&a=1' }))).name === 'OpenSearchDescription');

  // --- meta -------------------------------------------------------------------------------------------------------
  eq('excerpt', [excerpt('one two three four five six', 15), excerpt('short', 15)], ['one two three…', 'short']);
  eq('html text', htmlText('<p>A &amp; <b>B</b></p><script>x()</script>'), 'A & B');
  eq('page title', [pageTitle('Lot 5', 'KH'), pageTitle('', 'KH'), pageTitle('KH board', 'KH')], ['Lot 5 — KH', 'KH', 'KH board']);
  const mt = { title: 'Concert "Live" <tonight>', description: 'Music in the old town of Batumi, free entry for everyone who comes early.', url: 'https://x/e/1', image: { url: 'https://x/og/1.png', width: 1200, height: 630, alt: 'Poster' },
    type: 'article', siteName: 'KH', locale: 'en_US', altLocales: ['ru_RU'], alternates: [{ hreflang: 'ru', href: 'https://x/ru/e/1' }], article: { published: '2026-10-01', tags: ['music', 'batumi'] }, twitterSite: '@kh' };
  const tags = metaTags(mt);
  const html = metaHtml(mt);
  ok('meta escaped', html.includes('<title>Concert &quot;Live&quot; &lt;tonight&gt;</title>') && html.includes('content="Concert &quot;Live&quot; &lt;tonight&gt;"'));
  eq('meta og', tags.filter((t) => t.attrs.property === 'article:tag').map((t) => t.attrs.content), ['music', 'batumi']);
  const rm = readMeta('<head>' + html + '</head>');
  eq('meta read', [rm.title, rm.canonical, rm.og['og:image:width'], rm.twitter['twitter:card'], rm.alternates.length, rm.og['og:title']], ['Concert "Live" <tonight>', 'https://x/e/1', '1200', 'summary_large_image', 1, mt.title]);
  eq('meta noindex', metaTags({ title: 't', noindex: true }).find((t) => t.attrs.name === 'robots').attrs.content, 'noindex,follow');
  eq('meta issues', metaIssues({ title: 'x'.repeat(70), description: 'short', url: '/rel', image: { url: 'https://x/i.png', width: 300, height: 200 } }).map((i) => i.field + ':' + i.issue), ['title:long', 'description:short', 'url:relative', 'image:small']);
  eq('meta ok', metaIssues(mt), []);

  // --- og card ----------------------------------------------------------------------------------------------------
  ok('width classes', textWidth('KRISTINAHOUSE') > textWidth('kristinahouse') && textWidth('ილი') > textWidth('ili') && textWidth('Ш') > textWidth('ш'));
  const lines = wrapText('Батуми-Приморский-бульвар-и-набережная-у-моря, квартиры с видом на море и горы, новый комплекс у парка', 26, 3);
  ok('wrap lines', lines.length === 3 && lines.every((l) => textWidth(l) <= 26) && lines[2].endsWith('…'));
  eq('wrap short', wrapText('Hello world', 26, 3), ['Hello world']);
  eq('wrap exact', wrapText('a b', 26, 1), ['a b']);
  const svg = ogCardSvg({ title: 'Sea view <flats> & more', subtitle: 'Batumi', badge: '12 objects', brand: 'KRISTINAHOUSE', theme: 'teal' });
  const sx = root(parseXML(svg));
  eq('og svg', [sx.attrs.width, sx.attrs.height, children(sx, 'text').map((t) => textOf(t))], [String(OG_WIDTH), String(OG_HEIGHT), ['12 objects', 'Sea view <flats> & more', 'Batumi', 'KRISTINAHOUSE']]);
  ok('og control chars', !/[\u0001-\u0008]/.test(ogCardSvg({ title: 'a\u0001b' })) && root(parseXML(ogCardSvg({ title: 'a\u0001b' }))).name === 'svg');
  ok('og cache', ogCacheName({ title: 'A', subtitle: '' }) !== ogCacheName({ title: '', subtitle: 'A' }) && /^site-v1-[0-9a-z]+\.png$/.test(ogCacheName({ title: 'A' })));

  // --- indexnow ---------------------------------------------------------------------------------------------------
  const key = makeIndexNowKey(new Uint8Array(32).map((_, i) => i * 7));
  eq('key', [isIndexNowKey(key), isIndexNowKey('short'), isIndexNowKey('bad key!!'), keyFile(key).path], [true, false, false, '/' + key + '.txt']);
  const g = groupByHost(['https://X.ge/a#top', 'https://x.ge/a', 'https://y.ge/b', 'ftp://x/c', 'not a url', 'https://evil.com/'], { allowHosts: ['x.ge', 'y.ge'] });
  eq('group', [g.hosts, g.dropped.length], [[{ host: 'x.ge', urls: ['https://x.ge/a'] }, { host: 'y.ge', urls: ['https://y.ge/b'] }], 3]);
  const reqs = indexNowRequests(Array.from({ length: 5 }, (_, i) => `https://x.ge/l/${i}`), key, { batch: 2 }).requests;
  eq('batches', [reqs.length, JSON.parse(reqs[0].body)], [3, { host: 'x.ge', key, keyLocation: `https://x.ge/${key}.txt`, urlList: ['https://x.ge/l/0', 'https://x.ge/l/1'] }]);
  throws('bad key', () => indexNowRequests(['https://x/'], 'no'));
  const pace = paceRequests(reqs, { 'x.ge': 0 }, 20 * 60000);
  eq('pace', [pace.due.length, pace.wait.length, pace.lastSent['x.ge']], [1, 2, 20 * 60000]);
  eq('pace gap', paceRequests(reqs, pace.lastSent, 21 * 60000).due.length, 0);
  eq('status', [indexNowStatus(202).ok, indexNowStatus(429).retry, indexNowStatus(403).ok], [true, true, false]);

  console.log(`seo: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
