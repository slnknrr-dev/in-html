# Site Studio

One editor for landings, multi-page sites, portals, knowledge bases, shops and sites with accounts. A site is made of
pages with a shared header and footer, menus and nested sections (`services/legal`), and exported in one of four
packages: **one offline file**, a **serverless site**, a **backend site with a content editor** or a **backend site
with this constructor** on the server. Knowledge bases are sites too: wiki blocks, versions, layers and
password-encrypted “451” sections are blocks of the main editor (see below). The former knowledge base editor
(`wiki.html`, format `ss-wiki`) is still shipped next to it.

Everything runs in the browser; projects stay in this browser (IndexedDB) and in project files.

## Artifacts

Built from the NOTICE files (`node singlefile.js site-studio`):

| artifact | what it is |
| --- | --- |
| `html@5_offline_singlefile/index.html`, `wiki.html` | the site editor and the knowledge base editor, each one file without network code |
| `html@5_serverless/` | the same editors as a static site |
| `html@5_backend/` | the editors behind `server.mjs`; the team's knowledge bases stored on the server |
| `html@5_electron/` | the editors as a desktop application |

Development: `node site-studio/server.js` (also serves the backend of the application and a mock `/api/`).

## Packages a site is exported as

| package | what you get | data of forms, orders, RSVP, bookings |
| --- | --- | --- |
| **Offline · one file** | every page in one HTML file, hash routes (`#/about`), opens from disk; optionally also uploaded as `404.html` | browser-local endpoints (`local:orders`…) keep it in the visitor's browser; fallback channels (e-mail, WhatsApp, Telegram) |
| **Serverless site** | `index.html`, a prerendered `page/index.html` per page and `404.html` that answers every other address (base path detection for `/repo/` sites) — or a single-page site of `index.html` + `404.html` only; `sitemap.xml`, `robots.txt`, `llms.txt`, `README.md` | the owner's endpoints (Site → Requests) or the browser; no network code when every request is local |
| **Backend · content editor** | `server.mjs` + `lib/site.mjs` (Node ≥ 20, Bun, Deno; nothing to install), `public/`, `data/`; the admin console at `/admin/` | stored by the server; the console shows inboxes, orders, chat, edits the content collections (news, products, units, rooms, courses…) and the accounts |
| **Backend · with the constructor** | as above + `studio/index.html`: this editor at `/_studio/`, loading the live project and publishing changes at once | as above |

The backend packages can also keep working on plain static hosting (switch “Also works on static hosting”): the page
probes `api/_ping` and falls back to its channels.

### Accounts, roles and closed sections (backend packages)

- **Sign-in** by password (scrypt) or by a one-time link sent by e-mail (`SMTP_URL`, `MAIL_FROM`; without an SMTP
  server the link waits in the admin console's *Outbox*); registration open, by invitation or closed; sessions in an
  HttpOnly cookie. The first account (or `ADMIN_EMAIL`) is the administrator.
- **Public pages of the backend**: sign-in, registration and profile are pages of the site with the *Sign-in &
  profile* block; any page can carry it.
- **Roles** (Site → Accounts) with a parent each (`moderator` → `editor` → `member`), checked with `access/roles.js`;
  a page opens to everybody, to signed-in accounts or to chosen roles. Closed pages are rendered into
  `data/private/` and handed out by account; every other package exports a note in their place and keeps their
  address and menu entry.
- **Admin console**: accounts (role, block, delete, invite), the outbox, inboxes, chat, content collections, static
  snapshot, project file, and the constructor link.

## Templates

36 templates in three groups. Each says the least it needs — 🟢 **offline**, 🟡 **serverless** (static hosting,
browser storage or the owner's endpoints), 🔴 **backend** — which modules it uses or can use, and what changes in a
simpler package.

| group | templates |
| --- | --- |
| Knowledge base & wiki | encyclopedia, fandom wiki, news outlet, song analysis, spiritual tradition, Japanese and Georgian study bases, legal knowledge base, blank, product documentation, legal portal, team handbook 🔴 |
| Landing & serverless | specialist card 🟢, event site, holiday apartment, small shop, fund or NGO, project site from a README 🟢, dance studio, winery, metallurgy, agro, law firm, real estate, library 🟢, bookshop, audio 🟢, blank 🟢 |
| Backend site | regional portal, online store, real estate agency, site with accounts, boutique hotel, school, conference, retail chain |

## Knowledge bases

Every block of the knowledge base editor is a block of the site (`wk-<type>`, palette categories *Knowledge base* and
*Language study*), rendered by the same code (`wiki-blocks.js`) through an adapter: text in wiki markup
(`[[Page]]`, `[[page#section|text]]`, `{{ref|…}}` footnotes, `{{layer|id|…}}`, `{漢字|かんじ}` ruby), headings,
quotations, verse, callouts, details, code, infoboxes, hatnotes, contents, references, see also, navboxes,
disambiguation, sortable tables, timelines, page lists, media, galleries, annotated pictures, banners, interlinear
texts, glossaries and flash cards. Wiki links find pages by address, title or a former address (`doc.wiki.alias`).

- **Versions** (`wk-versions`): one block list per version, switched by buttons.
- **Layers** (Site → Knowledge base): toggles readers switch (translations, transcription, glosses), the ruby layer;
  blocks carry a layer, the *Layer toggles* block shows the switches; choices are kept per site.
- **451 sections** (`wk-secret`): the blocks inside are rendered and encrypted at export (PBKDF2-SHA256 600 000
  iterations + AES-256-GCM, pure JavaScript from `crypto/`); the page carries the envelope and a password form, the
  reader's browser opens it with Web Crypto (the key stays for the tab). Exports with such sections never embed the
  editable source (it holds the passwords); `llms-full.txt` and the other packages' files never carry their text.

The nine knowledge base templates (encyclopedia, fandom, news, songs, spiritual tradition, Japanese, Georgian, legal
base, blank) are built as sites by `templates-wiki.js`: ASCII addresses with the old ones as aliases, categories as
pages listing their articles, an automatic contents block, versions, layers and 451 sections.

## Blocks

All blocks of the landing builder (structure, content, shop, media, carousel, tabs, comparison, countdown, video,
collections, chat) and of the portal (legal act, glossary, directory, requests board, topic hub, checklist, search),
plus blocks on the libraries of the repository:

| block | library | what it does |
| --- | --- | --- |
| Diagram | `diagram/` | Mermaid-style text (flowchart, sequence, Gantt, class, state, ER, pie, mind map, timeline, journey, quadrant, git graph) or the map of this site (pages, navigation, access, collections) |
| Markdown | `markdown/`, `math/`, `highlight/` | GitHub-flavoured Markdown with tables, task lists, alerts, footnotes, code, math and diagrams |
| Formula | `math/` | TeX → MathML |
| Booking calendar | `booking/`-style rates | prices per night by season and weekday, booked dates, arrival / departure, nights and total sent with the request |
| Event & RSVP | `calendar/ics.js` | date, place, “Add to calendar” (.ics), a map link, guests' answers |
| Map | Web Mercator | points and a route on an offline plan, links to OpenStreetMap |
| Real estate units | `estate/` | cards, table or a floor chessboard with filters |
| Donations | `qr/` | goal and progress, tiers, payment link with a QR code, bank details |
| Data table | `csv/` | sorting, filter, CSV download |
| Unit converter | `units/` | any kind of the registry, affine conversion |
| Barcode | `barcode/`, `qr/` | EAN-13 / 8, UPC-A, Code 128 / 39, ITF-14, QR |
| Contract | — | a text whose `{{fields}}` the visitor fills, signs, sends and prints |
| Sign-in & profile | `access/` (server) | password / e-mail link, registration, profile, sign-out |

## Site → tabs

Pages, Theme, Shop, **Accounts** (sign-up, sign-in methods, roles), Requests, Languages, Output, SEO (page titles),
**SEO files** (site address, AI crawlers, sitemap / robots / llms.txt previews, title and description checks — the
model of `seo/site.js`, shared with SEO Kit), **Map** (the site drawn with `diagram/`: pages and sections,
navigation, who sees what, where data goes per package, content collections; copy as Mermaid, download .mmd / .svg,
insert as a block) and **README** (the README.md of the packages in split / preview / source, rendered like Codeberg
and GitHub with the libraries of the README editor; a text of one's own replaces the generated one). *File → Open*
also takes Markdown: a README becomes pages from its headings.

## Files

| file | contents |
| --- | --- |
| `index.html`, `editor.js`, `editor-config.js` | the site editor (`studio/` shell) |
| `viewer*.js` | the site product on `doc/`: model (`ss-site`), pages, blocks, runtimes, export hooks |
| `viewer-blocks-e.js`, `viewer-runtime-e.js`, `i18n-blocks-e.js` | blocks on the libraries, their runtimes and editor labels |
| `viewer-blocks-wiki.js`, `viewer-runtime-wiki.js`, `viewer-wiki-model.js`, `editor-wiki.js`, `i18n-wiki.js`, `templates-wiki.js` | knowledge base blocks in sites: the adapter, versions, layer toggles, 451 sections, their runtime, doc.wiki, Site → Knowledge base, labels, the templates |
| `viewer-access.js` | accounts, roles, closed pages, the public view of a site |
| `backend-site.js`, `backend-archive.js`, `backend-server.js`, `backend-auth.js`, `backend-admin.js`, `backend-engine.js` | packages, the generated server, accounts, the admin console |
| `editor-export.js` | the four packages and the check before export |
| `editor-auth.js`, `editor-sitemap.js`, `editor-readme.js`, `editor-remote.js`, `self.js` | Site → Accounts, Map, SEO files, README; the constructor mode; the editor's own page |
| `seo-site.js`, `site-map.js`, `site-readme.js` | SEO files, site diagrams, README and the Markdown importer |
| `templates*.js` | the catalogue (`templates.js`) and the templates |
| `wiki*.js`, `wiki.html` | the knowledge base editor |
| `i18n-*.js` | editor strings in 7 languages (en, ru, uk, de, fr, es, ka) |
| `test.js`, `wiki-test.js` | unit tests (`node check.js tests site-studio`) |
| `e2e.js`, `e2e-portal.js`, `wiki-e2e.js`, `wiki-e2e-portal.js` | in-page scenarios of the editors |
| `e2e-modes.mjs`, `e2e-spa.js`, `e2e-backend.js`, `e2e-shop.js`, `e2e-studio.js` | the packages run for real |
| `CONTRACT-site.md`, `PLAN.md` | the product contract of the site format, the plan of this application |

## Checks

```sh
node check.js modules site-studio
node check.js tests site-studio
node singlefile.js site-studio && node check.js audit
node check.js e2e site-studio/html@5_offline_singlefile/index.html site-studio/e2e.js
node check.js e2e site-studio/html@5_offline_singlefile/index.html site-studio/e2e.js --size 375x812 --mobile
node site-studio/e2e-modes.mjs            # spa, backend, shop, studio
```
