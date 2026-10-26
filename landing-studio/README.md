# Landing Builder

A visual site builder for landing pages and small sites that exports **one self-contained HTML file** (or a static
archive, or a site with its own small server): several pages with a shared header and footer, navigation, hero,
sections and columns, features, stats, steps, timeline, team, testimonials, partner logos, FAQ, call-to-action,
carousels, tabs, comparison tables, before / after, announcement bars, countdowns, videos, contacts, tables, lead
forms, products with a cart and checkout, pricing, events, galleries, embedded files (`<object>`: PDF catalogues,
price lists, audio, video), collections and QR codes. Pages are responsive (container queries), multilingual,
light / dark, and contain only the CSS and script they use.

The editor is a single file too: [html@5-singlefile/index.html](html@5-singlefile/index.html).

## Serverless by design

A published page never needs a server of ours. Cart sync, checkout and forms send *configured requests*, and a
request URL can be:

- **`local:<collection>[/<key>]`** — a browser-local endpoint answered from the visitor's own storage: `GET` reads,
  `PUT` stores, `POST` appends with an id (e.g. `local:cart/{cartId}`, `local:orders`, `local:inbox`). Zero network:
  a page whose requests are all local contains no network API at all.
- an `https://` endpoint the owner runs or rents (any JSON API). Only then the page includes the HTTP transport
  (timeouts, retries with backoff, idempotency keys). Request headers are public in the exported file.

When a request fails, orders and messages fall back to e-mail, WhatsApp or Telegram, or wait in an outbox and are
retried. The cart always works locally first (localStorage, in-memory in private windows) and syncs when it can.

## Export packages: serverless, backend, or both

The export dialog offers four packages ([CONTRACT.md](CONTRACT.md) §16):

| package | for | data from forms, orders, the chat |
| --- | --- | --- |
| **Single file** | any host, e-mail, a USB stick; optionally also uploaded as `404.html` | `local:` endpoints keep it in the visitor's browser; https:// requests and fallback channels deliver it |
| **Static archive** | Codeberg Pages, GitHub Pages, any web host | as the single file; one folder per page plus `404.html`; attachments are real files in `assets/` (optionally the CSS and script too) |
| **Backend archive** | your server: `node server.mjs` (Node 20+, Bun or Deno, nothing to install) | stored by the server under `data/`; admin console at `/admin/` |
| **Backend + static** | your server *and* static hosting | the page asks `api/_ping`; with the server as above, without it the page runs static (fallback channels, outbox, "leave a message") |

Before every export the editor checks the site: page addresses that collide or are reserved, pages nobody can reach,
links to missing pages, sections or files (Show / Export anyway); then blocks that cannot deliver data in the chosen package (a chat without
a chat API, forms or orders that would stay in the visitor's browser, blocks nobody receives) can be configured or
left out of that export; external services and, for backend packages, the endpoints the server provides are listed
before the download.

The **admin console** of a backend archive shows form submissions, orders, synced carts and chat conversations (reply
to visitors, CSV / JSON export, delete) and edits the *content collections*: any list block (products, pricing, events,
testimonials, team, FAQ, gallery…) whose "Managed in backend as" field names a collection. Saving regenerates the
static site with the same engine as the editor, so the server can be switched off at any time: download the **static
snapshot**, publish it on static hosting, and run the server again when data has to be collected or content edited.
The project file downloaded from the console reopens in this editor for design changes.

## Pages and routing

A site can have any number of pages (**Site → Pages**, or the page switcher above the canvas): add, duplicate,
rename, give an address (`about`, `services/legal`), reorder, choose the home page, hide from the navigation, keep as
a draft, delete. Each page has its own title, SEO title and description and its own blocks; the header (navigation,
announcement bar) and the footer are shared, and the navigation lists the pages by itself (the "Show pages" option of
the nav block; a page can stay out of it). A **"Not found" page** (404) is created with sensible content and can be
edited like any page. Link fields have a picker with the pages and the sections on each page; renaming an address
updates the links. Old one-page projects open as a site with one home page and export exactly as before.

The same project works in every mode ([CONTRACT.md](CONTRACT.md) §18):

| mode | how pages work |
| --- | --- |
| **Single file** (offline, `file://`, any host) | every page is inside the one file; addresses are `page.html#/about`; back / forward, titles and focus follow; an unknown `#/…` shows the "Not found" page. Works without JavaScript too (the `:target` page is shown). |
| **Single file as 404.html** (serverless) | upload the same file as `index.html` and `404.html`: the host serves it for every unknown address, it reads the address and shows the matching page at a clean URL (`/about/`), or "Not found"; from disk it falls back to `#/` addresses. |
| **Static archive** (serverless) | `index.html` plus a real `about/index.html` per page (prerendered, works without JavaScript and for search engines) and a `404.html` that answers every other address: it finds the site's base path (`/<repository>/` on Codeberg / GitHub Pages), opens pages whose address differs only in case, `.html` or a trailing slash and corrects the URL, or shows "Not found". The *virtual pages* option ships only `index.html` + `404.html`. |
| **Backend** | the server renders every page into `public/` with the editor's engine and serves `/about/`; address variants are redirected (301), anything else gets the "Not found" page with HTTP status 404; renamed or deleted pages are removed on rebuild. Forms and the API work from every page. |
| **Backend + static** | as the backend; the static snapshot behaves like the static archive. |

Hosts serve `404.html` for unknown addresses by themselves on Codeberg Pages, GitHub Pages and GitLab Pages; elsewhere
set it as the error document (Netlify / Cloudflare Pages do it automatically; nginx `error_page 404 /404.html;`,
Apache `ErrorDocument 404 /404.html`). When the site lives under a path the detection cannot be sure of (a custom
domain with a sub-folder), set **Site → Pages → Site path** (e.g. `/repo/`).

## Blocks for partners, reviews and more

- **Logos** (partners, clients): grid, strip or an endless **marquee** (pauses on hover, focus and for reduced motion,
  with a pause button), greyscale until hover.
- **Testimonials**: cards, large, slider or a **quote slider** (one large quote at a time, optional autoplay), star
  ratings with a summary (average and count), photo, role and a source ("Google", "Trustpilot") with a link.
- **Carousel**: cards, full-width hero slides with text over the picture, or pictures only; slides per view on
  desktop / tablet / phone, arrows, dots, swipe and keyboard, loop, autoplay that stops on hover / focus / when hidden
  and is off for reduced motion until the visitor presses play. Without JavaScript it is a swipeable row.
- **Stats** count up once they scroll into view (option); **Tabs** (line, pills, vertical; WAI-ARIA keyboard; every
  panel shown without JavaScript); **Comparison table** (plans or products: ✓ / — / text, a highlighted column, group
  rows, sticky first column on phones); **Before / after** slider (keyboard and touch); **Announcement bar** at the
  top of every page (link, tone, dismissible and remembered); **Countdown** to a date and time (in a chosen UTC offset
  or the visitor's time, then a "done" text); **Video** from a file (offline) or a link — YouTube, Vimeo, PeerTube are
  loaded only after the visitor clicks play (a privacy-friendly placeholder with the host's name; nothing external
  loads before); **CTA** gets a slim strip variant and a logo; **FAQ** can keep one answer open at a time.

## Portal blocks: law, glossary, directory, requests

Palette category **Portal & law** — the blocks of the shared library [../portal/](../portal/) (the same blocks exist in
the knowledge-base builder; its README has the decomposition they come from):

- **Legal act**: a law or code with parts, sections, chapters and articles (inserted articles `12^1` → 12¹), numbered
  paragraphs and lettered subparagraphs (`a)`, `а)`, `ა)`), status, dates, number, issuer, official source, the text as
  a PDF card, an overview and planned changes; a table of contents beside the text (sticky, follows the reading
  position) or above it, search in the act, a copy-link button on every article, print of the act alone. References
  such as "Article 4(2)", "подпункт «а» пункта 1 статьи 2" or "მე-5 მუხლი" become links — to another act too when its
  name follows (or, Georgian style, precedes) the reference.
- **Glossary of terms**: several definitions per term, sources linked to their articles, related terms, an
  alphabetical index of the main language's script (Georgian optionally as Mtavruli capitals), search; the terms are
  linked in acts, checklists and other glossaries of the site with their definition on hover / focus.
- **Directory**: specialists, firms and organisations with practice areas, cities, languages, ratings, prices,
  verified / new / tier badges and phone numbers hidden until "Show"; kind tabs, facets, sorting, "Show more".
- **Requests board**: requests with budget, closing date ("closes in 2 days", recomputed by the visitor's browser),
  responses and the directory entries of the site that fit each request; filters and sorting. Visitors post requests
  with an ordinary form block.
- **Topic hub** (all acts, articles, terms, people, requests and obligations of a topic with a counts strip, or tiles
  of topics), **Checklist** (ticks and progress kept in the visitor's browser) and **Unified search** (one box over the
  whole site with type tabs and marked snippets; the index is in the page).

Directories, boards, glossaries and checklists can be **managed collections** of a backend archive like any list block.
Everything works without a server and, except the controls, without JavaScript.

## Chat

The **chat** block is a panel on the page or a floating button. It talks to your chat API through two configured
requests (send and poll), to the built-in chat of a backend archive (long-poll; operators answer in the admin
console), or — without either — becomes "leave a message" through its fallback channel or outbox. Visitor name and
contact fields are optional; the conversation is kept in the visitor's browser; an unread badge and announcements
for screen readers report replies while the panel is closed.

## Templates

| template | design | languages |
| --- | --- | --- |
| Dance ensemble (Napertskali) | `supra`: night black, burgundy and gold; repertoire as a collection with audio sketches, tours with tickets, studio classes, press kit | ka, en, ru |
| Winery (Tsitelvazi) | `kvevri`: ivory, wine red, olive and gold; wine shop with a synced cart, tastings, kvevri process, PDF price list, age gate | ka, en, ru |
| Metallurgy (KRAMOR) | `forge`: steel and safety orange, blueprint bands; rolled products, pipes and castings on request → RFQ cart, grades and standards tables, certificates, capacities, logistics, sales chat | ru, en, de |
| Agro (Shiroky Lan) | `harvest`: cream, wheat and deep green; wholesale products with units and minimum lots, synced cart and checkout, crop calendar, farmer programme | ru, en, uk |
| Legal services (Aldermoor & Venn) | `counsel`: warm paper, navy and brass; practice areas, fees and packages, results, lawyers, consultation booking, case intake, PDF guides, consultation chat | en, ru, de |
| Real estate (Avelin Estates) | `shore`: white, sand and deep teal; listings as a collection with search, filters, price / area ranges, plans and brochures, developments, neighbourhood guide, mortgage table, viewings, agent chat | en, ru, de |
| Library (Lindgrove City Library) | `folio`: books with text and audio editions — shelf with search and filters, Markdown reader, audiobook chapters, reading rooms, membership, ask-a-librarian chat | en, ru, uk |
| Books (Paper Lantern Press) | `quire`: book shelf with excerpts and PDF samples sold by SKU, reading lists, club subscriptions, events, authors | en, ru, uk |
| Audio library (Long Wave) | `nocturne`: audiobook / podcast series with chapters, the docked player with resume, listening path, narrators, plans | en, ru, uk |
| Legal portal (Kanoni Commons) | `counsel` with a green accent: a model tax code with chapters, inserted and repealed articles and planned changes, a glossary linked across the site, specialists and firms, a requests board with a "post a request" form, a compliance checklist, topic hubs, one search box | en, ka, ru |
| Blank | `clean`: navigation, hero, one section and footer in the user's language | — |

Legal services (practice areas, fees, booking, contact + "Not found") and Books (books, reading lists, club, authors,
contact + "Not found") are multi-page sites; Blank has a home page and a "Not found" page. The new blocks appear in
the templates too: an announcement bar, comparison tables and countdowns (legal, books), quote sliders (legal, books),
a carousel and a day / dusk before-after (real estate), a logo marquee (agro) and a CTA strip (legal, industry).

Templates are built only from the generic blocks (the domain lives in the data: collection attributes, files, texts);
all names, people, places and contacts are fictional; artwork (the data-driven kit `templates-art.js`), sample
documents and audio sketches are generated, identically on every build.

## Collections

The **collection** block is the generic catalogue: books and audiobooks, property listings, documents, a portfolio or
a repertoire are the same block with different *attributes* (label–value pairs such as Author, Rooms, Area, Year).
Items have a title, subtitle, cover, description, tags, attributes, an optional price with a SKU (cart / quote like
products), a date, a link and files. Variants: grid, list, shelf (covers), table and feature. Visitors can search, filter
by attributes, tags or file formats, use from–to ranges (price, area, year…), sort and page through the list; without
JavaScript every item is simply shown. Files open in the page itself and work offline from the single file: an audio
player with chapters, speed, a mini player and remembered position, a text / Markdown reader with font size, light /
sepia / dark pages and remembered position, a PDF viewer, video and pictures, plus downloads. Old documents with the
former “works” block open as collections. Details: [CONTRACT.md](CONTRACT.md) §5 (collection) and §8 (collection,
reader).

## Using the editor

The editor is the shared document editor (`studio/`) with a device-width canvas (desktop / laptop / tablet / phone):
blocks are inserted from the palette or dragged into the page, texts are edited in place, the inspector shows the
block's properties, device visibility and anchor; the page switcher above the canvas chooses the edited page. Blocks on
the canvas, the page switcher and the page list have context menus (right click, a long press on touch screens, the
Menu key or Shift+F10): properties, insert, duplicate, copy / paste, move, hide, delete; for pages also rename, home
page, navigation, draft and settings. Site
settings: **Pages** (the pages, the "Not found" page, the site path), **Theme** (presets, colours, fonts, sizes, buttons,
headings, width, spacing, scheme), **Shop** (currency, cart or quote mode, cart button, sync, checkout method and
fields), **Requests** (the configured requests; local endpoints show their stored data; Test request), **Languages**,
**Output** (language switcher, toolbar, theme toggle, motion, back to top, age gate) and **SEO**. Projects are saved
in the browser (IndexedDB `lp-editor`) and as `<name>.landing.json` files; exported pages can embed their source and
be reopened. Editor UI in en, ru, uk, de, fr, es, ka.

## Files

The product specification (model, blocks, rendering, runtime, cart / checkout / forms, export) is
[CONTRACT.md](CONTRACT.md); its §15 lists the modules of this folder. Shared parts: `doc/` (engine), `studio/`
(editor), `richtext/`, `ui/`, `html/`, `i18n/`, `minify/`, `qr/`, `codec/`, `sample/`.

## Development

```bash
node landing-studio/server.js
```

serves the repository with a mock JSON API at `/api/` (store, append, simulated outage, request log) for trying
server URLs; `local:` endpoints need nothing. `node check.js e2e landing-studio/html@5-singlefile/index.html
check-editor.js` runs the editor scenario; `landing-studio/e2e-portal.js` (also with `--size 390x844 --mobile`) the
portal template and its exported site. The development server also answers `backend-engine.js?bundle` (the
engine of backend archives), so backend packages can be exported from the sources too.
