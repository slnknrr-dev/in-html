# Knowledge Processor

A builder of knowledge bases, wikis and blogs: many pages with Wikipedia-like building blocks, annotated pictures
whose regions are links, hover previews, versions of a page, toggleable layers for translations and transcription,
and password-encrypted "451" pages. A base is published as **one HTML file**, a **static site** or a **Node server**;
in every mode the reader behaves like a site of separate pages (titles, addresses, back / forward, scroll, focus).

The application itself has three artifacts (NOTICE files, see the root README):
`html@5_offline_singlefile/index.html` (one file, no network code at all), `html@5_serverless/` (static hosting) and
`html@5_backend/` (a Node server that keeps a team's bases and publishes them). Development: `node knowledge-processor/server.js`.

## The editor

- **Pages**: a page tree (parent / order), filter, right click / long press / Menu key for the page menu (open,
  preview, rename, new child page, new secret page, move, order, make home, duplicate, make secret / public, delete).
  Addresses (slugs) in any script, nested with `/`; categories; unlisted pages; redirects (also to `page#section`).
- **Blocks** (schema-driven forms, `blocks.js`): text (wiki markup), heading, quotation (block, pull, epigraph), verse /
  lines (numbers, parallel translation on a layer), callout (note, tip, warning, stub, spoiler…), collapsible, code,
  divider; infobox, hatnote, table of contents, references, see also, navbox, disambiguation, table (sortable),
  timeline, page list (children, category, recent, chosen pages as list, columns, cards, lead story); picture / media
  (image, audio, video, file; left, right, centre, full width; text flowing beside it or side by side; a link makes
  the picture a "drill down"), gallery (grid, packed, slider), **annotated picture / diagram**, banner; interlinear text,
  glossary / vocabulary, flash cards; columns. Each block can belong to a layer or be hidden.
- **Portal blocks** (palette category "Portal & law"; shared with the landing builder through [../portal/](../portal/)):
  **legal act** (parts / sections / chapters / articles with inserted numbers 12¹, numbered paragraphs and lettered
  subparagraphs in Latin / Cyrillic / Georgian letters, status and dates, planned changes, a sticky table of contents
  with scroll-spy, search in the act, copy link and print), **glossary of terms** (several definitions per term,
  sources, related terms, an alphabetical index of the script, search), **directory** (specialists, firms,
  organisations: tabs, facets, sorting, paging, verified badges, masked contacts), **requests board** (budget, dates
  that the reader recomputes, responses, the specialists of the base who fit), **topic hub** (everything of a topic
  with counts, including the pages of the category of that name; or topic tiles), **checklist** (ticks kept in the
  reader's browser) and **unified search** (a form for the search page). References such as "Article 5(2)",
  "статья 5", "მე-5 მუხლი" become links to the article anywhere in the base, and glossary terms are linked in
  ordinary text blocks too, with their definition on hover. The search page shows pages and portal entries (acts,
  articles, terms, people, requests, obligations) in type tabs.
- **Annotated pictures** (`ed-diagram.js`): points, rectangles, circles, polygons or plain boxes on a picture or a
  background; labels are dragged anywhere and joined to their region by a leader line; regions link to pages (hover
  previews in the reader) or show a note; arrows between regions make concept maps; on phones the labels fold into
  numbers with a legend.
- **Versions**: any number of versions of a page ("detailed", "simpler", …) with free names; readers switch with
  buttons, a link can point to one (`[[page?v=simple]]`).
- **Layers**: toggles that readers switch on and off (remembered per base): whole blocks, inline text
  `{{layer|id|…}}`, interlinear tiers, glossary columns, verse translations, infobox rows, furigana / ruby
  `{漢字|かんじ}` — for parallel translations, language study and transcription.
- **451 content**: a secret page (without the password its address is a plain 404) or secret variants of a public page
  (without the password readers see the public version). A secret variant may have its own versions. Readers open
  them with `#?451=<password>` at the end of any address (the fragment never reaches a server) or on the Unlock page.
  In the editor an envelope is unlocked with its password for the tab's session and sealed again on every edit.
- **Media library** in IndexedDB (images with their sizes, audio, video, files), embedded in exports; files marked
  "only inside 451 content" travel encrypted inside the envelopes that use them.
- **Base settings**: title, languages (content and reader interface), home page, five themes (encyclopedia,
  fandom-dark, magazine, minimal, scholarly) and an accent colour, logo, navigation, footer, license, layers and the
  ruby layer, categories, reader features, key derivation of 451 content.
- **Live preview**: the real reader in a frame with the current data and unlocked 451 content; desktop / tablet /
  phone widths; the address of the page in each publishing mode; links followed in the preview select their page in
  the editor, a click on a block selects it; right click on a link: open, edit, create, copy link.
- Undo / redo (Ctrl+Z, Ctrl+Shift+Z), autosave, several bases, project files (`.kp.zip`: `kb.json` + `media/`) and
  JSON backups, UI in 7 languages (en, ru, uk, de, fr, es, ka), phones and tablets (one column at a time).

### Templates

| template | content |
| --- | --- |
| Encyclopedia (`templates-wiki.js`) | the Solar System, Wikipedia-style: infoboxes, references, navbox, diagrams, "Simple English" versions |
| Fandom wiki (`templates-fandom.js`) | an invented crafting game in the fandom-dark theme: sprites, recipes, world map, spoilers, lore variant |
| News outlet (`templates-news.js`) | a fictional harbour city's newspaper: sections, dated stories, explainer versions, city map, embargoed story |
| Song analysis (`templates-songs.js`) | analysis of eleven songs by Alexander Nepomnyashchy (Russian): themes, imagery, metre, intertext, motifs map |
| Gaudiya Vaishnava (`templates-gaudiya.js`) | concepts, scriptures, persons, iconography (annotated picture), concept maps (Russian, Sanskrit layers) |
| Japanese (`templates-japanese.js`) | scripts, pronunciation, grammar, vocabulary, parallel texts with furigana / rōmaji / kana / glosses / translations |
| Georgian (`templates-georgian.js`) | alphabet, pronunciation, cases, verbs, numbers, parallel texts with transliteration / IPA / glosses / translations |
| Legal knowledge base (`templates-portal.js`) | a fictional open-law base: a model tax code (chapters, an inserted and a repealed article, planned changes), a glossary linked from every page, specialists and firms, a requests board, a compliance checklist, topic hubs and search with type tabs |
| Blank (`templates-blank.js`) | one main page |

The song-analysis template never reproduces lyrics: it analyses the songs in its own words, cites its sources
(Wikipedia, the author's official site, published reviews and research) and leaves empty quote slots and marked
placeholders where facts could not be verified.

## Publishing (one reader, three URL mappings)

| mode | what you get | routes |
| --- | --- | --- |
| one HTML file | every page, picture and the reader in one file; works offline, from disk, by e-mail | `file.html#/page` |
| static site (.zip) | a prerendered file per page (search engines, no-JS readers), `404.html` that renders virtual pages (search results, unlocked 451 pages, what links here) under their real addresses; base path detection for project sites (`/repo/`); URL styles `clean` (`/page`), `folders` (`/page/`), `html` (`/page.html`, also from a folder on disk); sitemap.xml / robots.txt | `/base/page` (pushState) |
| server (.zip) | `server.mjs` for Node ≥ 18 without dependencies: pages rendered per request, 404 status for unknown pages, editing API with a token (`GET / PUT _kp/api/kb`, `PUT / DELETE _kp/api/media/<id>`, revision check), `--read-only` | `/page` |

The application's backend artifact additionally keeps bases for a team (`api/kbs`, token printed at start or
`KP_TOKEN`) and serves each stored base under `kb/<id>/` with real routes; "Publish to a server" (serverless and
backend builds) sends a base to the editing API of an exported server.

## 451 envelope format

```
{ v: 1,
  kdf: { a: 'argon2id', s, t, m, p } | { a: 'pbkdf2-sha256', s, i },   s = base64 salt (one per base)
  id:  base64url(HKDF-SHA256(master, info 'kp451/id', 16 bytes))
  iv:  base64(12 random bytes)
  ct:  base64(AES-256-GCM(key, iv, payload, aad 'kp451:' + id) ciphertext + 16-byte tag)
  z:   1 when the payload was raw-deflated }
master = KDF(UTF-8 NFC password, salt, 32 bytes) (Argon2id t=2, m=19 MiB by default; PBKDF2-SHA256 600 000)
key    = HKDF-SHA256(master, info 'kp451/key', 32 bytes)
payload = JSON { kind: 'page' | 'variant', page (id), slug, parent, label, title, display, summary, image, cats,
                 date, author, toc, layout, layers, versions, media?: { id: { t, n, s, w, h, alt, cr, d (base64) } } }
```

Every envelope of a base is in `site.sealed` (sorted by id); nothing tells which page a variant belongs to without the
key. A reader derives the key once per password and opens the envelopes whose id matches; GCM authenticates the
rest. Keys (not passwords) are kept in `sessionStorage` so that a reload in the same tab stays unlocked. Exports never
contain 451 content in clear (tested in `test.js` for every mode); the editor's project files keep only envelopes and
omit the bytes of secret media. Crypto is the repository's pure-JavaScript `crypto/` library (argon2, kdf, aes).

## Files

| file | contents |
| --- | --- |
| `model.js` | the knowledge base model (format `kp-kb` v1), normalization of untrusted input, lookups |
| `markup.js` | the wiki markup (links, footnotes, citations, layers, ruby, tooltips, placeholders, audio buttons) → safe HTML |
| `blocks.js` | block types: schema and renderers |
| `render.js` | articles (versions, layers, contents, references, categories, breadcrumbs), virtual pages, the page shell, previews |
| `site.js` | the published form of a base (no secrets in clear), 451 payloads |
| `secret.js` | 451 envelopes |
| `search.js` | client-side search with folding, prefix and CJK substring matching, snippets |
| `reader.js`, `reader-boot.js`, `reader-css.js`, `strings-reader.js` | the reader runtime, its entry and modes, themes, strings (7 languages) |
| `pages.js`, `export.js`, `kb-server.js` | full documents, the three exports, the server of a base (also used by `backend.js`) |
| `bundles.js` (+ `.offline.js`) | the reader and server code that exports carry (`new URL('./x.js?bundle', import.meta.url)`) |
| `kit.js`, `templates*.js` | template building kit and the templates |
| `main.js`, `state.js`, `store.js`, `ed-*.js`, `editor.css`, `strings*.js` | the editor |
| `remote.js` (+ `.offline.js`), `ed-sync.js`, `backend.js` | server storage and publishing (none in the offline artifact) |
| `blocks-portal.js` | the portal blocks: fields converted from `portal/models.js`, the view adapter of `portal/markup.js`, `portalLinker` (terms and references in ordinary blocks); the catalog of the base is built in `render.js`, the runtime started in `reader.js`, the CSS added by `reader-css.js readerCSS(site)` (only the chunks a base uses) |
| `test.js` | tests: `node knowledge-processor/test.js` |
| `e2e.js`, `e2e-portal.js` | editor scenarios (`node check.js e2e knowledge-processor/html@5_offline_singlefile/index.html knowledge-processor/e2e-portal.js`, also with `--size 390x844 --mobile`) |

Routing is the shared `spa/` library (route strings, hash / path routers, base detection, prerender helpers, the
404.html bootstrap).

## Limits

- Search runs in the browser over the published text (fine for hundreds of pages, not for tens of thousands).
- Pure-JavaScript Argon2 takes about a second with the default 19 MiB on a phone; PBKDF2 can be chosen instead.
- The preview and the exports need the reader bundle: the multi-file and single-file builds carry it; a copy of the
  sources served without the development server cannot build exports.
- Editing a base by several people at once is "last writer wins" with a revision check that refuses to overwrite a
  newer version silently; there is no merge.
