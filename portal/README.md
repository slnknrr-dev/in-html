# portal

**Portal primitives**: legal acts, glossaries, directories of people and firms, request boards, topic hubs,
checklists and a unified search, written once and rendered by two applications — the site builder
[landing-studio](../landing-studio/) (a `doc/` product) and the knowledge-base builder
[knowledge-processor](../knowledge-processor/). The library holds the data models, the logic, the markup builders, the
CSS and the runtime features; each application only adapts them to its own text model, editor and runtime (adapters,
not copies). Pure modules, importable in Node; the runtime features are serializable functions.

## Decomposition

The primitives below come from a study of a legal-information platform and a law firm's site (home, roles, service
categories, a specialists directory, a requests marketplace, search, a law library, codes with their articles,
news, topics, a topic hub, a glossary and a term page, regulatory compliance, a firms directory, in-browser document
tools, a firm's landing page). Patterns are described in our own words; no texts, names or images of those pages are
used anywhere.

### Content types

| primitive | what it holds | landing-studio | knowledge-processor |
| --- | --- | --- | --- |
| **Legal act** | type, number, issuer, adoption / effect / version dates, status (in force, amended, pending, repealed, draft), successor, official source, a file of the text, overview, planned changes (date + affected articles), topics; a flat list of units — parts, sections, chapters, articles (numbers with inserted articles 12¹, 37¹⁰), unnumbered passages — each with title, body, status, amendment note, topics | block `act` | block `act` |
| Article body | numbered paragraphs (`1.`), lettered subparagraphs in Latin, Cyrillic or Georgian letters (`a)`, `а)`, `ა)`, nested `ა.ა)`), repeal notes in place of a paragraph; every paragraph and subparagraph has an anchor | line syntax in the multi-line text of an article (`legal.js parseBody`) | the same syntax inside wiki markup lines |
| **Cross-reference** | "Article 12(3)(a)", "paragraph 2 of Article 7", "подпункт «а» пункта 3 статьи 12", "ч. 2 ст. 5¹", "частини 2 статті 7", "მე-12 მუხლის მე-3 პუნქტის „ა“ ქვეპუნქტი", "მე-5 და მე-6 მუხლები", "Artikel 12 Absatz 2", "l'alinéa 2 de l'article 12", "apartado 2 del artículo 12", lists and ranges; another act named after (or, Georgian style, before) the reference | auto-linked in acts, glossaries, boards, checklists across pages | the same, across pages of the base |
| **Defined term** | term, other names (synonyms, abbreviations), definition, source ("Tax Code, Article 8" — becomes a link), link, related terms, topics; several definitions of one term (from different acts) grouped under one entry with a count | block `terms` | block `terms` (next to the language-study `glossary`) |
| **Directory entry** | kind (specialist, firm, organisation), name, photo or logo, role, practice areas, languages, city, years of experience, rating and reviews, price (from / fixed / per hour / free / on request), verified, new, tier badge, badges, about, phone and e-mail (masked until "Show"), website, profile link, availability | block `directory` (a managed collection in backend archives) | block `directory` |
| **Request / task** | title, description, category, budget (fixed, from–to, per hour, not sure) in a currency, city or remote, languages, posted and closing dates (relative, recomputed by the visitor's browser), status (open, in progress, closed), responses ("2 of 5"), author, response link; the specialists of the directory who fit it | block `board` (managed collection; requests posted with the existing form block) | block `board` |
| **Topic** | a name shared by act topics, article topics, term topics, directory areas, request categories, checklist topics; a hub shows everything of a topic with counts, an index shows tiles of all topics | block `hub` | block `hub` (+ pages of the category of the same name) |
| **Obligation / checklist item** | label, details, deadline, legal basis (auto-linked), group headings; ticks remembered in the visitor's browser with progress | block `checklist` | block `checklist` |
| Search result | type (page, act, article, term, specialist, firm, organisation, request, obligation), title, snippet with marks, context (the act of an article), group counts ("12 matching articles in …") | block `finder` (an index embedded in the page) | the search page of the reader gains type tabs and portal results; block `finder` is a search form |
| News item | date, topic, title, excerpt, cover, author | existing `collection` (list variant, date, tags) | existing pages with date and category + `pagelist` |
| Service category | icon, name, counts, sub-categories | existing `features` / `collection`; topic hub index | categories + `pagelist`; topic hub index |
| Event | type, date, format, price | existing `events` | `timeline` |
| Document tool / file card | name, type, size, open / download | existing `embed`, `collection` files; the act's file card | `media` file; the act's file card |

### Presentation devices

| device | behaviour | where |
| --- | --- | --- |
| Sticky table of contents with scroll-spy | parts / chapters / articles; beside the text on wide blocks, folded above it on narrow ones; the entry of the section in view is marked (`aria-current`) and kept visible | `act` (feature `pttoc`) |
| Article anchors and copy-link | every article, paragraph, subparagraph, term and entry has a stable ASCII id (`tax-a12-p3-a`, `t-vat`, `pr-…`); a button copies the absolute link, announced politely | all blocks (`ptbase`) |
| Definition tooltips | the first occurrence of each glossary term in a text is a link to the term with its definition in a popover on hover / focus (Escape closes); inflected forms match | acts, terms, checklists (`pttips`) |
| Alphabet index | the whole primary alphabet of the main language (Georgian 33 letters, Russian, Ukrainian with Ґ Є І Ї, Latin with Ñ for Spanish; diacritics filed under their base letter), letters without entries disabled, letters of other scripts and digits after it; Georgian letters optionally as Mtavruli capitals; sticky; scroll-spy | `terms`, `directory` |
| Faceted filters, tabs, sort, paging | search box, select facets with counts (OR inside a facet), kind tabs with counts, sort select, live result count, clear, "Show more" pages; without JavaScript every entry is shown | `directory`, `board`, `terms`, act search (`ptlist`) |
| Unified search with type tabs | every word must match (prefix of a word), titles weigh more, tabs per type with counts, marked titles and snippets, acts with matches | `finder` (`ptfind`), knowledge search page |
| Cards and variants | specialist (photo header / list row / compact row), firm (logo), request card, term card, topic tile, document card | `directory`, `board`, `terms`, `hub`, `act` |
| Badges | status of an act, of an article, of a request; verified (with an explanation popover), new, tier, availability | everywhere |
| Stat strip | counts per type of a topic | `hub`; landing also has `stats` |
| CTA panels, role comparison, step flows | | existing landing `cta`, `compare`, `steps`; knowledge `banner`, `table`, `timeline` |
| Callout | planned changes of an act with dated links to the affected articles | `act` |
| Masked contacts | phone and e-mail partly hidden until "Show" (the real link without JavaScript) | `directory` |
| Print scope | "Print" prints only the act, contents and controls left out | `act` |
| Relative dates | "3 days ago", "closes in 2 days" computed again by the visitor's browser | `board` |
| Breadcrumbs, sticky header, back to top, dark scheme | | the hosts (landing nav / back-to-top / scheme; knowledge reader) |

### Logic

| function | module |
| --- | --- |
| folding (NFKD, no marks, ё→е, ß→ss) identical in Node and in the runtime; words; inflection-tolerant comparison of Georgian, Cyrillic and Latin words; snippets with marks; ASCII ids with transliteration | `text.js` |
| alphabets per language and script, index letter of a word (Mtavruli folded), A–Z groups with ids | `alphabet.js` |
| unit numbers (`12^1`, `12¹`, Roman), natural order, anchors, outline of a flat unit list, article bodies, references in seven languages, act named next to a reference, linking, planned changes | `legal.js` |
| term identity (inflections), grouping of definitions, matcher (longest name first, consecutive words), first-occurrence linking in safe HTML | `glossary.js` |
| rewriting the text of safe HTML outside links, headings and code | `segments.js` |
| facet options aligned across languages, money, price and budget texts, dates, recommended order, rating summary, request ↔ directory matching | `records.js` |
| unified search: type counts, groups, highlighted results | `search.js` |
| the site catalog: acts and their articles, terms, people, requests, checklist items, topics, search entries, anchors | `catalog.js` |

## Modules

| module | contents |
| --- | --- |
| `models.js` | `PT_TYPES`, `PT_BLOCKS` (neutral block schemas: field kinds `text long code link day num bool select image file`, one item list), `defaults`, `itemDefaults` |
| `markup.js` | `PT_RENDER[type](block, V)` builders and the runtime DOM contract (prefix-free `data-pt-*` attributes); the view adapter `V` is documented in its header |
| `css.js` | `PT_CSS` chunks written with `__P__` and the `--pt-*` tokens, `PT_TYPE_CHUNKS`, `portalCSS(prefix, types)` |
| `runtime.js` | `PT_FEATURES` (`ptbase`, `pttoc`, `pttips`, `ptlist`, `ptfind`, `ptcheck`), `PT_FEATURE_ORDER`, `PT_FEATURE_DEPS`, `startPortal(R)`; the `R` contract is in its header |
| `strings.js` | viewer strings `PT_UI` (7 languages, plurals), `ptT(lang)`, `PT_RUNTIME_KEYS` |
| `strings-editor.js` | editor labels `PT_EDITOR` (7 languages: blocks, fields, hints, options) for both editors, `ptFieldLabel`, `ptOptionLabel`, `ptFieldHint` |
| `text.js`, `alphabet.js`, `legal.js`, `glossary.js`, `segments.js`, `records.js`, `search.js`, `catalog.js` | the logic (above) |
| `test.js` | unit tests, including the runtime in a VM with a small fake DOM: `node portal/test.js` |

## How a host uses it

1. **Schema**: convert `PT_BLOCKS` to the host's registry (landing: `schema` / `itemSchema` / `i18nFields`; knowledge:
   `fields` kinds). Labels come from `PT_EDITOR`.
2. **Catalog**: once per render, `buildCatalog(sources, host)` with every portal block of the site, the page it is on and
   a function giving the URL of an anchor of that block from the page being rendered.
3. **Render**: `PT_RENDER[type](block, V)`; V maps the block's texts (per-language objects in landing, wiki markup in
   knowledge), links, pictures, files, icons, dates, UI strings and anchors.
4. **CSS**: `portalCSS(prefix, usedTypes)` plus a token rule on `.<prefix>-pt` mapping the host theme.
5. **Runtime**: the features the builders recorded (`V.feature`) — serialized into the page (landing) or called
   (knowledge, `startPortal`, then `R.pt.scan(root)` after each render).

## Limits

- Reference parsing is pattern-based: common forms of the seven languages, not every drafting style; a reference that
  does not resolve to an article of an act on the site stays plain text. Act names are matched by word stems.
- Term matching tolerates endings, not stem changes (Russian fleeting vowels, irregular plurals); synonyms help.
- The alphabet index and option identities follow the main language of a multilingual site.
- The unified search of landing pages runs in the browser over an index embedded in the page (texts of up to 1600
  characters per entry); fine for thousands of entries, not for a whole legal corpus.
- Masked contacts hide numbers from a glance, not from a determined scraper (the page contains them).
