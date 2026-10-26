# seo/

What search engines, link previews and AI crawlers read from a site: schema.org JSON-LD, sitemaps with hreflang,
robots.txt, feeds (JSON Feed 1.1, RSS 2.0, Atom), llms.txt, OpenSearch, Open Graph / Twitter meta tags, a 1200×630
Open Graph card in SVG and IndexNow payloads. Pure ES modules that build strings and objects: no DOM, no network,
no clock. XML escaping comes from `xml/`, HTML escaping from `html/`.

## Files

| file | contents |
|---|---|
| `site.js` | the site model of SEO Kit and Site Studio: `DEMO_SITE`, `normalizeSite`, page URLs and hreflang clusters, `sitemapFiles`, `robotsText` / `robotsTest`, `feedFiles`, `llmsFiles`, `metaModel` / `headHtml`, `ldBuild` (ten kinds from small forms), `ldIssues`, `checkPage`, `allFiles` (moved here from seo-kit/kit.js, which re-exports it) |
| `jsonld.js` | `organizationLd`, `websiteLd` (SearchAction), `breadcrumbLd`, `personLd`, `profilePageLd`, `eventLd`, `offerLd`, `aggregateOfferLd`, `productLd`, `itemListLd`, `apartmentComplexLd`, `accommodationLd`, `recipeLd`, `articleLd`, `faqLd`, `orderLd`, `postalAddress`, `geoCoordinates`, `imageObject`, `compact`, `graph(...nodes)`, `ldJson`, `ldScript`, `ldNodes(html)`, `ldOfType`, `SCHEMA` |
| `sitemap.js` | `urlsetXml(entries, { base, locales, root, lang, href })`, `sitemapIndexXml`, `buildSitemaps(entries, opts, { max })` (split + index), `hreflangAlternates`, `hreflangLinks`, `w3cDate`, `latestLastmod`, `robotsTxt({ groups, allow, disallow, sitemaps, host })`, `robotsAllows(text, path, agent)`, `SITEMAP_MAX_URLS` |
| `feeds.js` | `jsonFeed(feed)`, `rssXml(feed)`, `atomXml(feed)`, `llmsTxt({ title, summary, intro, sections, notes })`, `llmsFullTxt({ title, docs, max })`, `openSearchXml`, `JSON_FEED_VERSION` |
| `meta.js` | `metaTags(model)` → tag list, `renderTags`, `metaHtml`, `readMeta(html)`, `metaIssues(model)`, `excerpt`, `htmlText`, `pageTitle` |
| `og.js` | `ogCardSvg({ title, subtitle, badge, brand, theme })`, `textWidth`, `wrapText(text, maxW, maxLines)`, `ogCacheName`, `fnv1a`, `svgDataUri`, `OG_THEMES`, `OG_WIDTH` / `OG_HEIGHT` |
| `indexnow.js` | `indexNowRequests(urls, key, { endpoint, batch, keyLocation, allowHosts })` → `{ requests, dropped }`, `groupByHost`, `paceRequests(requests, lastSent, now, gap)`, `indexNowStatus(code)`, `indexNowGetUrl`, `isIndexNowKey`, `makeIndexNowKey(bytes)`, `keyFile(key)`, `INDEXNOW_ENGINES` |
| `test.js` | unit tests: `node seo/test.js` (importing it runs nothing) |

## JSON-LD (jsonld.js)

- Builders take plain fields and drop every empty one (recursively; a node left with only `@type` disappears), so
  markup never says `"description": ""`. URLs should be absolute canonical addresses: the page URL is the `@id` of
  its entity, organisations get `<site>/#org`, sites `<site>/#website`, people `<page>#person`.
- Offers: a single price, a range (`min` / `max` → UnitPriceSpecification), a period (`per: 'day' | 'month' |
  'night'`), sale / rent as GoodRelations business functions, availability and condition by short names.
- `ldScript` escapes `<`, `>`, `&` and U+2028 / U+2029 so a value can never close the `<script>`; `ldNodes` reads
  every JSON-LD node of a page (with `@graph` expanded) and throws on broken JSON.

## Sitemaps and robots (sitemap.js)

- Each URL lists every language version (`xhtml:link rel="alternate" hreflang`) plus `x-default`; the `root`
  language has no prefix, so no alternate points at a redirect. `lang` builds the map of one language version
  (its `<loc>` carries that prefix). Image entries use the Google image extension.
- `buildSitemaps` splits at 50 000 URLs and writes the `<sitemapindex>` with the newest lastmod per part.
- `robotsTxt` writes groups (several agents, Allow / Disallow, Crawl-delay), Host and Sitemap lines;
  `robotsAllows` evaluates a file the way Google does (longest match, Allow wins ties, `*` and `$`).
- `spa/prerender.js` keeps its small route-based `sitemapXML`; this module serves any list of URLs.

## Feeds and llms.txt (feeds.js)

One item model feeds JSON Feed 1.1 (with `_ext` data on items and the feed), RSS 2.0 (content:encoded, enclosure,
atom:self) and Atom. `llmsTxt` follows llmstxt.org: `# title`, `> summary`, link sections, the `## Optional`
section, notes such as "how to cite"; `llmsFullTxt` concatenates whole documents up to a size cap.

## Meta tags and the OG card (meta.js, og.js)

`metaTags` returns data (`{ tag, attrs, text }`), so a page builder can also print it through its own templates;
types `website`, `article` (published / modified / tags), `product` (price), `event`, `profile`. `metaIssues`
lists what a preview would show badly (missing / long title, short description, relative URLs, small image).
The card is an SVG string; its text is measured per character class (capitals and Cyrillic / Mkhedruli are wider
than lower-case Latin), long words are cut and a cut tail ends with `…`. Rasterise it with a canvas or any SVG
renderer; `ogCacheName` fingerprints the content for file names.

## IndexNow (indexnow.js)

Builds the POST bodies (`{ host, key, keyLocation, urlList }`) grouped per host in batches (≤ 10 000, default
1 000), drops non-http(s) and foreign hosts, and paces hosts (once per 10 minutes by default). No request is sent:
the caller posts `request.body` to `request.endpoint`.
