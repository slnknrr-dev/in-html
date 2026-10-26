# SEO Kit

The machine-readable files of a static site, made in the browser without a network: sitemap.xml with hreflang
alternates, robots.txt with a rule tester, llms.txt / llms-full.txt, JSON Feed / RSS / Atom, JSON-LD of ten kinds,
Open Graph / Twitter head tags with a lint, a 1200 × 630 Open Graph card, and a checker of existing pages. Built on
`seo/`.

```bash
node seo-kit/server.js        # development server
node singlefile.js seo-kit    # builds html@5_offline/ and html@5_offline_singlefile/
node check.js e2e seo-kit/html@5_offline_singlefile/index.html seo-kit/e2e.js
```

## Pages

- **Site** (`index.html`):
  - Site: name, base URL, description (length counter), languages and the main one (at the root, the others under
    `/<lang>/`), the organization, local business or person behind it (address, geo, profiles).
  - Pages: pasted lists (`path | title | description`; URLs of the site become paths) or one by one: path, title,
    description, lastmod, priority, change frequency, language versions, image, post (author, tags), noindex and the
    text for llms-full.txt. Page forms open lazily, so long lists stay light.
  - Generated files in tabs, each with a live preview, copy and download:
    - **Sitemap**: every language version with its hreflang cluster and x-default, image entries, split into
      `sitemap-N.xml` with `sitemap.xml` as their index above a chosen size; warns about URLs robots.txt blocks.
    - **robots.txt**: groups of agents with Disallow / Allow / Crawl-delay, a one-click AI-crawler group, Host; the
      tester answers whether a crawler may fetch a path (longest match wins, Allow wins ties, `*` and `$`).
    - **llms.txt / llms-full.txt**: summary, intro, sections of pages and posts (posts optionally under `## Optional`).
    - **Feeds**: JSON Feed 1.1, RSS 2.0 and Atom of the pages marked as posts.
    - **JSON-LD**: Organization / Person, WebSite + SearchAction, BreadcrumbList (from the path and page titles),
      Article, Product + Offer, Event, FAQPage, LocalBusiness subtypes, ApartmentComplex, Recipe — built from forms
      and checked against required / recommended properties.
    - **Meta tags**: the head of any page and language version (canonical, hreflang, Open Graph, Twitter) with the
      `metaIssues` lint and the share card it would get.
  - **Download all as ZIP**: every file above, `head/<page>[.<lang>].html` for every page, `jsonld/<type>.html`, and
    the card as `og.svg` + `og.png`.
- **Card** (`og.html`): title, subtitle, badge, brand line (or filled from a page), seven themes or own gradient
  colours, an accent stripe, a logo from an image file (data: URI, top or bottom right, size). Live 1200 × 630
  preview, large and compact share-card previews, lint (title cut, low contrast), SVG / PNG (canvas) / copy SVG /
  copy meta tags.
- **Check** (`check.html`): paste or drop the HTML of a page: head tags read and linted (title, description,
  canonical, og:*, twitter:card, image size and alt, hreflang x-default / relative / codes, noindex, lang, viewport),
  JSON-LD nodes read (broken JSON reported) and checked, a table of every tag, the share preview. Remote images are
  named, never loaded.

## Files

| file | contents |
|---|---|
| `index.html`, `og.html`, `check.html` | the pages (hidden anchors `#pg-site`, `#pg-og`, `#pg-check` give the build the links between them) |
| `kit.js` | the site model without DOM (demo site, normalisation, URLs of language versions, sitemap entries, robots, feeds, llms, head tags, JSON-LD forms and rules, the page checker, the ZIP file list): a re-export of the library module `../seo/site.js`, which Site Studio uses too |
| `common.js` | the shell, icons, saved site and card, the card SVG with a logo and its PNG, widgets (file panes, issue lists, share preview, tabs, counters) |
| `main.js` | the site page |
| `card.js` | the card page |
| `checker.js` | the checker page |
| `strings.js` | UI strings in the 7 UI languages |
| `app.css` | layout of the three pages |
| `e2e.js` | in-page scenario: hreflang in the sitemap, robots tester, OG SVG, missing og:image found |
| `server.js` | development server |

## Limits

- `seo/og.js` has no logo slot: the logo is inserted into its SVG here. Text width is estimated, not measured.
- `hreflangAlternates` points x-default at the main-language URL; for pages without a main-language version the
  cluster is built here with x-default on the first version.
- The JSON-LD rules are the common required / recommended properties, not the full rich-result specifications.

## Targets

`OFFLINE_NOTICE.md` and `SINGLEFILE_OFFLINE_NOTICE.md` select `html@5_offline/` and `html@5_offline_singlefile/`.
Both are audited for zero network use: the pages work from `file://`. The site, the card and the last checked page
stay in the browser's local storage.
