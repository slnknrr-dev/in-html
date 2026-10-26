# Architecture

Single-file HTML applications. Sources are plain ES modules; `singlefile.js` turns every application page into one
self-contained, tree-shaken, minified HTML file in `<app>/html@5/`.

## Repository layout

```
<root>/                       flat top-level tool files (vanilla ESM, Node >= 22.12 or Bun, no dependencies)
  singlefile.js               build CLI + page inliner: apps -> <app>/html@5-singlefile/*.html (+ multifile.js, publishing)
  multifile.js                multi-file deployment copy: apps -> <app>/html@5/ (pages, app modules, used libraries)
  bundle.js                   ES module bundler: scope hoisting, side-effect-aware tree shaking; split mode (per module)
  parse.js                    ECMAScript 2024 parser (ESTree)
  scope.js                    scope analysis (bindings, references, writes)
  mime.js                     media types, data: URIs
  policy.js                   network classes of applications, zero-network audit of artifacts
  targets.js                  NOTICE-file artifact targets (offline / serverless / backend / standalone, single or multi-file)
  hosting.js                  server of generated artifacts (Node >= 18): GitHub-Pages-like static files + an app backend;
                              createHosting (the handler without a port) and webHandler (Node req/res -> Fetch Response)
  electron.js                 main process of ELECTRON artifacts: in-html://<app>/ scheme, window security, IPC, tray, mini window
  electron-preload.cjs        preload of ELECTRON artifacts: the window.inHtmlElectron bridge (dialogs, real paths, window, tray)
  server.js                   development server (static files + optional mock JSON API + the app's backend.js)
  check.js                    development checks: modules, library unit tests, artifact audit, headless browser page / e2e, goldens
  check-editor.js             e2e scenario of the document editors
  check-electron.js           Node-only checks of ELECTRON artifacts under a stub of the electron module
  ARCHITECTURE.md, README.md
  .forgejo/workflows/         Codeberg CI (builds and verifies artifacts, commits them back, publishes single-file pages)

<name-with-dash>/             an application: its pages (*.html), app-specific modules, a server.js instance,
                              README.md; html@5-singlefile/ and html@5/ hold the built artifacts (never edited by hand)
<name-without-dash>/          a library of reusable modules (flat, depth 1)
```

Rules: folders are at most one level deep, except artifact folders (`<app>/<target>@<version>/`). Applications import
libraries with relative `../lib/x.js` paths, so sources run from the repository root (`node <app>/server.js`).
Libraries never import applications. Everything (code, comments, docs) is in English.

## Application classes (policy.js)

| suffix | class | network |
|---|---|---|
| `-offline`, `-effect` | standalone | none: no `fetch`, XHR, WebSocket, EventSource, beacons, workers from URLs, remote resources. The build **fails** a page that has any. Works from `file://`. |
| `-serverless` | unhosted | runs in the browser and keeps data with the user; may call endpoints the *user* configures (reported by the build), never a server of ours |
| `-pwa`, `-isomorphic` | pwa / isomorphic | reported |
| anything else | client | may depend on a backend |

Folders without a suffix get their guarantees from NOTICE targets (`targets.js`): every `OFFLINE` target is built
with the `offline` module variant and audited strictly (any network use fails the build), so the formerly `-offline`
tools keep the zero-network rule through `OFFLINE_NOTICE.md` + `SINGLEFILE_OFFLINE_NOTICE.md`.
`node check.js audit` lists the class and network uses of every artifact.

## Libraries

| library | contents |
|---|---|
| `minify/` | `js.js` (token-based JS minifier, ASI-safe, no renaming), `css.js`, `html.js` (tokenizer + minifier) |
| `qr/` | ISO/IEC 18004 QR encoder: `qrMatrix`, `qrSVG` |
| `rooms/` | multiplayer rooms: one game definition for local play and an HTTP + SSE server (passwords, invites, bots, CORS); `client.offline.js` for offline builds |
| `prng/` | seeded (xoshiro128** from SHA-256 of the seed) and crypto random sources with one interface |
| `durak/` | Durak: data-driven rulesets (decks of any size with copies, custom cards, card and beat rules, colour jokers), the rules engine, presets with exclusive variants, strategist bots (traits, skills, Monte-Carlo lookahead, exact endgame), simulations, the DGN notation with public-information entropy, style analysis, the rooms game definition |
| `battleship/` | Sea Battle: data-driven rulesets (boards with islands, polyomino ships, fleets, touching, salvos, announcements, weapon modules), the engine with hidden fleets, placement strategies, a solver (Monte-Carlo fleets by Gibbs sampling, exact enumeration, Knuth estimates, endgame expectimax), bots with methods, personalities and levels, simulations, the SBN notation with the information of every shot, style analysis, the rooms game definition |
| `stitch/` | cross-stitch and embroidery charts: the scheme model (full / half / quarter / three-quarter / petite stitches, backstitch and straight lines, French knots, beads, blends, layers), thread catalogues (DMC, Anchor, Madeira, Gamma, PNK Kirova) with cross-references by ΔE2000, image → scheme conversion, vector symbols and letters, legends, skeins and fabric size, page splitting with overlap, editing operations and stitch fonts, a canvas chart view, JSON / OXS read and write, a PDF writer with Type 3 symbol fonts, SVG and PNG |
| `carpet/` | rug designs on a knot grid: traditions as rule sets (classic painters and regional layer recipes), field symmetries and the 12 rectangular / square wallpaper groups, border systems with guards and corners, a motif library, natural dye palettes, compositions of 37 pattern layers (ornaments, fractals, abstractions) with transforms, warps and blends, a gallery of designs, hand edits of knots, seeded generation and share codes, yarn estimates, knotting and cross-stitch charts through `stitch/`, flat, pile and room pictures with fringe and an antique wash |
| `contract/` | contract templates: typed fields (party, document reference, term, list, computed, payment schedule), modifiers, levels with clause variants, the clause language ({{field | filter}}, [[if]], [[each]], {{#clause}}) over a safe expression interpreter, fields extracted from the text, billing periods (day D to D−1, the last ending the day before move-out), numbers / money / dates in words (ru, uk, en), validators with check digits and a sandboxed worker for the template's JS validator, languages with a main one, A4 print rendering, compilation into one offline HTML fill-in page |
| `diagram/` | Mermaid-style diagrams: a graph model, layered layout with compound groups, SVG; flowchart, sequence, class, state, ER, pie, Gantt, git graph, mind map, timeline, journey, quadrant |
| `math/` | TeX / LaTeX → MathML Core: fractions, roots, scripts, big operators with limits, accents, delimiters, fonts, matrices and environments, errors without throwing |
| `badge/` | shields.io badge URLs as a model (static and preset endpoints) and badges drawn locally in five styles |
| `spa/` | multi-page single-page applications: slugs and route strings, hash routes, URL styles and base path detection, a router with history / scroll / focus, prerender helpers (relative links, sitemap), the 404.html bootstrap of static hosts that finds the base of project sites |
| `mines/` | Minesweeper engine: square / hex topologies with several neighbourhoods and a torus, layouts from `prng/`, no-guess generation with a logical solver and exact probabilities, game state with undo and replays, share codes, statistics |
| `sudoku/` | Sudoku engine: any size (4–64; above 31 two-word candidates, classic and rule variants) with boxes, jigsaw regions or multi-grid layouts, 40 variants (rules and clues as propagators shared by an exact solver and a graded logical solver with explained steps), a seeded generator of unique puzzles, alphabets, puzzle codes, SVG drawing, the `rooms/` game (shared and race) |
| `book/` | format-neutral book model (sections, poems, epigraphs, notes, tables, styles, images, metadata) with FB2 2.x and EPUB 2 / 3 read and write, Markdown / HTML / text in and out, tolerant markup and encoding detection, one HTML rendering shared by reader, editor and EPUB, structural validators for written EPUB / FB2, generated covers, search; FB2 / EPUB exist only at the edges |
| `bookmarks/` | bookmarks: replicated records (per-field last-writer-wins with hybrid logical clocks, tombstones), a library API (folder tree, tags, duplicates, undo snapshots), URL normal forms, imports (Netscape HTML of every browser, Chrome / Firefox JSON, Pinboard, Pocket, CSV, Markdown, link lists) and exports, the search language, the server revision log, Atom feeds, page metadata, IP address classes for SSRF checks |
| `cmdline/` | command lines as text for bash and cmd.exe (quoting checked against the real shells) |
| `codec/` | `base64.js` (chunked, strict check), `deflate.js` (deflate-raw / deflate / gzip via Compression Streams), `zlib.js` (synchronous deflate / inflate, streaming Deflate / Deflate64 `Inflater`), `crc32.js` (CRC-32, Adler-32); binary-to-text encodings: `radix.js` (Base2…Base62, Base58), `rfc4648.js` (Base16 / 32 / 64 and their alphabets), `base45.js`, `base85.js` (Base85, Ascii85, Z85), `base91.js`, `base92.js`, `base100.js`, `bech32.js`, `uu.js` (UU / XXencode), `yenc.js`, `quoted-printable.js`, `percent.js`, `punycode.js` |
| `zip/` | ZIP read / write (stored and deflated entries, UTF-8 names, Zip64), `listZip` (central directory of a random-access source), streaming `ZipWriter`, ZipCrypto / WinZip AES decryption |
| `archive/` | archive formats, read only: detection, ZIP (all common methods), 7z, RAR 1.5-5 (extraction only), tar, gzip / bzip2 / xz / zstd / lzma / .Z, ISO 9660 / UDF, ARC; LZMA / LZMA2, bzip2, PPMd H / I, branch filters, RAR decoders; synchronous decoders over random-access sources (`FileReaderSync` in workers) |
| `pack/` | archive writers: tar (ustar + pax), gzip, bzip2 (BWT, multi-table Huffman), LZMA / LZMA2 with xz and .lzma containers, Zstandard (Huffman literals, predefined FSE sequences), 7z (solid LZMA2), `packArchive(format, entries)` over them and the ZIP writer; checked against xz, bzip2, 7-Zip and zlib |
| `magic/` | file types by content: 100+ magic-number signatures, containers refined by content (OOXML / ODF / EPUB / JAR / APK in ZIP, RIFF forms, ISO BMFF brands, Ogg codecs, EBML doc types, compound files), a text sniffer; binary layouts of ZIP, PNG (CRCs checked), gzip, JPEG, GIF, BMP, RIFF, tar, 7z, xz, ELF, PE, SQLite for hex viewers |
| `xml/` | small XML parser / serializer and tree helpers (OOXML, ODF, SVG) |
| `markdown/` | CommonMark core + GFM tables, task lists, strikethrough, autolinks → block tree / safe HTML; `gfm.js`: GitHub-flavoured README rendering with source ranges, sanitized raw HTML, alerts, footnotes, emoji, math and diagram hooks; `gfm.css`; HTML → Markdown |
| `highlight/` | regex-driven syntax highlighter (34 language families) |
| `color/` | `color.js` (CSS colour allowlist, WCAG contrast, on-accent / dark-accent for document themes); colour science: spaces (sRGB, P3, Lab, LCh, OKLab, OKLCH, HSL, HWB) and gamut mapping, CSS Color 4 parsing / formatting, ΔE / WCAG / APCA, colour-vision simulation, palettes, swatch formats |
| `ico/` | Windows icon files: encoder (32-bit BMP entries with AND mask, PNG entries) and decoder (PNG, 32 / 24 / 16 bit and palette BMP entries), directory reader |
| `lingua/` | language primitives: spaced repetition (SM-2), Sanskrit IAST ↔ Devanagari with Vedic accents, sandhi, Vedic meters, kana, pinyin, Georgian morphology (cases, verb slots, splitter, numbers), a Georgian lexicon and full grammar (paradigms, series, case frames, analyser), Georgian transcription input, a sentence builder and analyser, text and dialogue analysis with graphs, Russian morphemes, handwriting comparison (strokes and distance fields), official romanisations (Georgian 2002 both ways, Russian ICAO 9303, Ukrainian KMU 2010) and ASCII slugs, script mixing and homoglyph checks of identifiers; across languages: word links (cognates, loans, calques, false friends), a dictionary over several lexicons, Latin typing of every script, decks between any two languages, a Georgian sentence's structure in Russian / English, parallel-text alignment with entity matching, sound counterparts across scripts |
| `prosody/` | rhyme and meter of English, Russian and Georgian verse: phonemes, syllables and stress (CMUdict and Russian MFA subsets, rules, the user's marks), meters (iamb … anapest, Georgian shairi and syllabic lines) fitted by dynamic programming, rhyme distance and kinds, scheme detection, the catch of a line, word modifiers and rhyme candidates, public-domain example stanzas |
| `i18n/` | language tags and names, text direction, Intl helpers with ICU probes, month fallbacks, i18n text picking |
| `html/` | escaping, URL allowlists, string-based rich-text sanitizer |
| `util/` | value coercion (`isObj`, `num`, `oneOf`, `getPath`…), ids, fuzzy matching (Damerau–Levenshtein with a cut-off, best matches), identifier normal forms (MAC, IPv4 / IPv6 RFC 5952, codes), a light ru / en stemmer for search keys |
| `doc/` | the document engine (see below) |
| `paper/` | paper documents on the engine: generic blocks, themes, layouts, page / print CSS, runtime, export hooks, the paper editor configuration (`definePaperProduct`, `PAPER_EDITOR`) |
| `studio/` | the visual document editor (see below) |
| `portal/` | portal primitives shared by two renderers (landing-studio's `doc/` product and knowledge-processor): neutral block models (legal act, glossary, directory, requests board, topic hub, checklist, unified search), the logic (folding, inflection-tolerant matching, alphabet indexes per script, legal numbering and references in seven languages, glossary linking, facets, request ↔ directory matching, unified search, the site catalog), markup builders behind a view adapter, CSS chunks (`__P__` + `--pt-*` tokens), serializable runtime features on `data-pt-*` attributes, viewer and editor strings; its README holds the decomposition of the studied portal pages (see "Shared presentation primitives" below) |
| `richtext/` | contenteditable rich text and table editing (DOM sanitizer, commands, toolbar, paste, tables) + `richtext.css` |
| `ui/` | DOM helpers, icons, UI i18n engine (`t`, `addDicts`, 7 languages), overlays (toasts, dialogs, menus, popovers), context menus (`contextmenu.js`: right click, long press, Menu key), files, `strings.js` (shared strings), `base.css` (tokens, controls, overlays), `app.js` + `app.css` (shell of single-page tools) |
| `payments/` | money amounts in minor units and provider formats, IBAN / BIC validation and EPC069-12 QR payloads, Stripe (form encoding, webhook signatures, Checkout Sessions, portal, Payment Links), PayPal (OAuth, Orders v2, webhook verification, subscriptions, donate links) and TBC Bank E-Commerce clients over an injected HTTP function, and `mock.js`: one local server mimicking the three providers for tests |
| `sample/` | sample file generators for templates: PDF, PNG, SVG artwork, WAV; `kit.js` template building kit |
| `hdkey/` | hierarchical deterministic keys: BIP-39 mnemonics (the ten official word lists, NFKD, checksums, seeds, word completion), BIP-32 extended keys with SLIP-132 versions (xpub / ypub / zpub / tpub …), paths, fingerprints |
| `bitcoin/` | Bitcoin: networks, script and a script interpreter (Core's script tests), addresses, transactions with legacy / BIP-143 / BIP-341 signature hashes, taproot trees, PSBT v0 / v2 (every role, Core's field order), output descriptors (BIP-380 … 389), BIP-44 / 49 / 84 / 86 accounts, coin selection (branch and bound, knapsack), fees, RBF / CPFP, BIP-137 / BIP-322 messages, BIP-21, BIP-329, blocks, wallet sync; Esplora (`esplora.offline.js` twin), Bitcoin Core RPC and Electrum clients |
| `walletui/` | the UI shared by the wallet applications: an encrypted vault (Argon2id + AES-256-GCM, auto-lock) with its lock screens, recovery phrase grid / backup check / input, QR show and scan, address book, endpoint picker (presets listed, nothing contacted before a choice), charts, section tabs and hash routes, the backend probe (`net.offline.js` twin), styles, strings |
| `ethereum/` | Ethereum: units, RLP, EIP-55 addresses, transactions (legacy / EIP-155, EIP-2930, EIP-1559 signed; 4844 / 7702 parsed), EIP-191 / EIP-712, the Solidity ABI (calls, events, errors), ERC-20 / 721 / 1155, keystore v3, EIP-681, ENS, chain presets, log decoding, HD accounts, fee suggestions, a JSON-RPC client (`rpc.offline.js` twin) |
| `body/` | parametric human body: sex, height, weight (BMI), age, twelve shape features, measurement overrides fitted exactly; a rig of generalized cylinders, mesh, 38 ISO 8559-1 style measurements, size charts (EU / US / UK / RU / INT), silhouettes, the cloth collider; children and teenagers from 2 years (growth references, sizes by height) |
| `garment/` | pattern drafting from measurements: pieces as named-edge polylines (split, join, unfold, darts), torso / sleeve / skirt / trouser blocks, 13 garment templates and outfits (tuxedo), layered details in an explicit stacking order (linings, canvas, interfacings, facings, lapels, collars, pockets, trims, buttons), seams with ease checks and notches, grading, nesting on a fabric width, technical flats, pattern SVG, tiled print-at-home PDF, AAMA DXF; national and outerwear templates (costume.js), layers over layers (layers.js), material usage (usage.js), pattern edits (edits.js), DXF reading |
| `fabric/` | weave structures (plain, twills, herringbone, satins, basket, rib, hopsack, diamond, own drawdowns), weaving drafts, jacquards, knits, colour orders and tartan setts, 24 presets with physical properties, simulation parameters, seamless procedural textures; dyes over the finished fabric (ombré, dip, tie-dye, spray) |
| `motif/` | print design: a pure rasterizer, 16 vector motifs, repeats (block, half-drop, brick, mirror, rotate), colourways, seamless tiles, colour separations, SVG, placement prints |
| `cloth/` | cloth simulation: boundary-conforming piece meshes, arrangement of pieces around the body, XPBD solver with seams, overlays, linings, closures, pins, body collisions and layering between garments; a headless stability check |
| `view3d/` | camera maths, one shading model, a WebGL renderer and a software renderer (Node, fallback) for the same scenes |
| `mockup/` | garment previews from a serialisable spec (body, outfit, fabrics, prints, view): piece textures, the drape, rendering in Node, baked drapes, and the embeddable browser viewer (`mountPreview`) for landing / shop blocks |

Format, media and algorithm libraries (one folder per topic, pure functions, importable in Node): `crypto/`, `kdbx/`,
`png/`, `jpg/`, `raster/`, `webm/`, `weba/`, `ogg/`, `mp4/`, `mp3/`, `wav/`, `csv/`, `xlsx/`, `formula/`, `ascii/`, `rain/`, `regexp/`, `archive/`, `pack/`, `magic/` —
see each folder's `README.md`.

| library | contents |
|---|---|
| `timeline/` | video projects: model and layout (magnetic main track with xfade-style transitions, overlay and audio rows), editing operations, undo history, colour adjustments shared by the browser renderer and ffmpeg, audio mixdown with WSOLA time stretch, slideshow builder, project files (JSON / ZIP), the project described as ffmpeg commands |
| `photo/` | photo editor core (layers with masks and 16 blend modes, selections, tools, adjustment layers, filters, history, project files) with the Transform · ImageMagick mode: the whole document as one ImageMagick command with pieces tied to layers and history steps (`magick.js`, pure), PNG files for painted layers, checked against the real `magick` and the shells |
| `fileapi/` | a reusable file API server (mounts, safe path resolution against traversal and escaping links, listing, stat, HTTP Range streaming, uploads, a thumbnail cache, watch by long poll, owner / reader tokens, CORS) and its client with a random-access source; Node modules come in through the caller (bundled backends) |
| `catalog/` | the media catalogue: works and media in three presence levels (file, source, nominal), an indexed store with a revision log and undo, virtual tags (namespaces, hierarchy, aliases, implications, inheritance), the query language, smart / mood playlists, collections, workspaces, tracking and statistics, the indexer with source rules, generated covers, export / import with merge, MyAnimeList / Shikimori / M3U8 / XSPF / NFO / CUE, demo content |
| `player/` | playback logic: queue and shuffle modes, timers and markers, ReplayGain / loudness / EQ, BS.1770 loudness and tempo analysis, keyboard map, D-pad navigation, the skin model with dynamic colour, the player-layout constructor model |
| `mediatags/` | tags and sidecars of media files over random-access sources (ID3, FLAC, Ogg, MP4 / M4B with chapters, Matroska, WAV), LRC, CUE, SRT / VTT / ASS, NFO, M3U8 / XSPF / PLS, scene / fansub / audiobook names, path templates, sidecar grouping |
| `mediajobs/` | yt-dlp / ffmpeg / ffprobe / ImageMagick jobs as data, tool detection, bash / cmd.exe rendering, a job queue and a runner with injected Node APIs |
| `ffcmd/` | ffmpeg command text: filter graphs with references, ffmpeg's two-level escaping, encoder options, rendering for bash / cmd.exe through `cmdline/` with pieces that know their element, a parser like ffmpeg's for checks |
| `barcode/` | GS1 numbers (check digits, GTIN-8 / 12 / 13 / 14, UPC-E ↔ UPC-A, GS1 prefixes, ISBN / ISSN, in-store scale codes with price check digits), the Application Identifier dictionary with parsing of HRI / raw / scanner / Digital Link forms and building, linear encoders (EAN-13 / 8, UPC-A / E with EAN-2 / 5 add-ons, Code 128 with an optimal set mix, GS1-128, Code 39 / 93 with full ASCII, ITF / ITF-14, Codabar), Data Matrix ECC 200 with GS1 DataMatrix, SVG / canvas drawing at true size, and a reader of linear codes in images (both directions, voted scan lines) |
| `booking/` | calendar days with DST-safe arithmetic, half-open stays, overlaps and conflicts, free gaps, occupancy calendars, availability ranking, departures with seats; nightly price cascade (base, weekday, season), minimum stays, length-of-stay discounts, fees and quotes with error codes in minor units; a lead funnel with viewing slots, handover to an agent with rights, blind mutual reviews, timed auctions with reserve and rounds, iCal export / import of stays |
| `stock/` | inventory maths: ABC (Pareto) and XYZ (weekly variation) classes with the 3 × 3 matrix and advice, safety stock and reorder points, replenishment plans (lead / cover / holiday days, in transit, MOQ and multiples, supplier order days and holidays, warehouse first), sell-through verdicts, FEFO / FIFO batches with markdowns and write-offs, average / FIFO valuation, a stock ledger of receipts, sales and transfers |
| `receipt/` | point-of-sale maths in exact minor units: VAT included by line or by rate, carts with line and check discounts spread exactly, payments with points / card / cash and change, returns linked to the sale, X / Z shift reports, best promotion prices and price-tag data, loyalty points and RFM segments, plain-text receipts for 58 / 80 mm |
| `planogram/` | shelf planograms in centimetres: fixtures, shelves and pegboards, products with squeeze, facings with rotation, fit checks with warning codes, auto depth and maximum facings, space by product / category / brand, capacity and days of supply, macro space versus sales, version diffs, front-view SVG |
| `plan/` | floor and hall plans in metres: polygon geometry, snapping, rotated hit tests and resizing, fit-to-view, stencils for flats, halls and shops, seat / sleep / area summaries, overlaps and narrow aisles, undo history, SVG with dimensions, ruler and scale bar |
| `ledger/` | money journals in exact minor units: parties and roles, split rules (percent, fixed, rest) distributed by largest remainder, append-only operations with reversals, balances, statements and owner reports, report periods with nights clipped to them, occupancy / ADR / RevPAR, payout plans, expense splitting, the calculation web (a graph of money flows: validation, order, evaluation, journal operations, a diagram), cross rates through a base currency, CSV exports |
| `estate/` | real-estate models: new-build complexes (slugs, ready-by quarters), the floor × unit chessboard with statuses, statistics and price per m², annuity and differentiated mortgage schedules with affordability, unit tables from CSV with column sniffing, room types and layout summaries, number-to-word scales ("Euro" layouts) |
| `calendar/` | iCalendar write / read (VEVENT, VTODO, VALARM, TZID / UTC / floating, all-day, folding, escaping), RRULE parse / format / expand / describe, day and ISO-week arithmetic with time zones, report periods and next runs, month / week grids with spans, shift rosters (overnight hours, conflicts, rest, weekly totals, timesheets), event "when" parsing and dates in words (en / ru / ka), guest lists with RSVP options, summaries and CSV |
| `seo/` | the site model of SEO Kit and Site Studio (`site.js`: pages → sitemap, robots, feeds, llms.txt, JSON-LD, head tags, checker), schema.org JSON-LD builders (Organization, WebSite, Breadcrumb, Person, Event, Product / Offer, ItemList, ApartmentComplex, Accommodation, Recipe, Article, FAQ, Order) and reading them back, sitemaps with hreflang and indexes, robots.txt with a rule tester, llms.txt, JSON Feed / RSS / Atom, OpenSearch, Open Graph / Twitter meta with a lint, 1200 × 630 OG card SVG with text wrapping, IndexNow request payloads |
| `mail/` | e-mail without sockets: address lists, canonical Gmail forms, reserved names, masking, mailto links; RFC 2047 encoded words safe against header injection, RFC 2231 parameters, base64 / quoted-printable; MIME messages (alternative, related, mixed with attachments) built and parsed, header folding; SMTP reply parsing, capabilities, AUTH strings, dot-stuffing and dialogue scripts |
| `units/` | a unit registry of 11 quantity kinds in metric, US and imperial systems with affine conversion, quantity parsing in en / ru / ka ("42,5 м²", feet and inches, "1 ч 30 мин"), formatting with sensible rounding, compound and humanized forms, data sizes and durations, conversion tables with formula texts, number-to-word scales (distance) |
| `geo/` | geodesy and maps: haversine / Vincenty, bearings, boxes, coordinate parsing (decimal with comma, DMS, hemispheres en / ru / ka, map links), Web Mercator tiles and views, Google polylines, clipping, Douglas–Peucker, way chaining and coastline water, OSM classification and a map style, SVG map / tile rendering with label placement, route ordering (nearest neighbour + 2-opt, pickup before delivery) with trip sheets, a place tree country → building with search, Georgian address parsing across scripts; OSM-derived data is ODbL |
| `pdf/` | a PDF 1.7 writer: pages in top-left points, text, lines, rectangles, ellipses, arcs and SVG paths, dashes, opacity, clipping, transforms, JPEG pass-through and PNG with soft masks, links, bookmarks, metadata; embedded TrueType fonts parsed and subset with ToUnicode maps (text copies and searches; Cyrillic and Georgian through font stacks) and the standard fonts; text layout (wrap, boxes, fit, flows with headings and tables over pages, footers); synthetic test fonts and an inspector of written files |
| `schema/` | typed form fields (text, number with unit, range, select, multiselect, date, bool, MAC / IP / serial; conditions, roles, groups, computed values) with validation, prototype inheritance down a category tree (inherit, override, hide; origin trail), building → unit value inheritance, rule-based titles (conditions with six operators, per-language templates, first match wins, traces) and templated tags with safe links and search tokens |
| `access/` | permissions: roles with inheritance and revocation, grant matrices with explanations, member grants with expiry, "view as"; a data policy cascade (open / medium / closed, own records) with explanations; session scopes narrowing user rights, read-only allowlists, TTL / idle; a module catalogue with dependencies and cascading views; layered configuration (default → site → host) with value sources and secret stripping |

## Writing a single-page tool (applications other than the document editors)

- **Page**: `index.html` (more pages = more `*.html`, linked with relative hrefs; the build rewrites them to artifact
  names — `<a href>` in the markup and string literals that are exactly a sibling page name, such as the `pages` of
  `startApp`). `<body class="ap">`, stylesheets `../ui/base.css` + `../ui/app.css` (+ an app `style` block or
  `app.css`), one `<script type="module" src="./main.js">`. Inline SVG favicon as a `data:` URL.
- **Shell**: `startApp({ key, name: 'app.name', logo, pages, offline: true, onLang })` from `ui/app.js` renders the
  header (brand, pages, UI language, colour scheme) and the footer badge. Content goes into
  `<main class="ap-main">`; the usual layout is `.ap-work` (controls in `.ap-side`, result in `.ap-stage`) with
  `.ap-card` sections. Controls: `field`, `seg`, `select`, `range`, `toggle`, `textInput`, `colorInput`, `button`,
  `card`, `dropZone`, `download`, `copyText` (ui/app.js) and `toast`, `openDialog`, `confirmDialog` (ui/overlays.js).
- **Strings**: every visible string through `t(key)`; the app registers its keys with
  `addDicts({ en, ru, uk, de, fr, es, ka })` in `strings.js` of the app (all 7 languages, same keys).
- **Logic**: format / algorithm code goes into a library (pure, Node-importable, no DOM at module evaluation);
  the app holds UI and glue only. Heavy work runs in chunks (or a `Worker` built from a `Blob` of a function's
  source) so the page stays responsive.
- **Network**: standalone apps never use the network (see above). Files come from the user (drop, paste, pick)
  and leave as downloads.
- **Checks**: `node check.js modules <lib> <app>`, `node check.js tests <lib>` (`<lib>/test.js` exports `run()`),
  `node singlefile.js <app>`,
  `node check.js page <app>/html@5/<app>.html --eval "…" --shot out.png`, `node check.js e2e … scenario.js`.
- **Docs**: `README.md` in the app and in each library: purpose, features, files, limits.

## Document engine (`doc/`)

One engine renders, styles, exports and normalizes the documents of every builder application (resume, landing,
docs). The application registers a *product* before anything else runs: `defineProduct(spec)` fills the engine
registries (`BLOCK_TYPES`, `THEMES`, `ICONS`, `UI` dictionaries, CSS library, runtime features) and the product hooks
(document shape, root layout, head extras). A page holds exactly one product.

- **Model** (`model.js`): registry-driven normalization. Block lists come from `type.lists` (`'blocks'`,
  `'cols.*.blocks'`), per-language keys from `i18nFields` + schema fields of type `i18n` + `richFields`, reference
  fields (`att`, `req`, `icon`, `day`, `time`, `date`, `color`, nullable numbers) are validated from the schema. The
  product supplies common block props, the document top level and type-specific `normalize` hooks.
  `normalizeDoc` never throws; hostile input is bounded (`safeClone`, size caps).
- **Rendering** (`render.js`, `attach.js`): one pass produces view or edit markup. `grp()` groups per-language values
  (`data-l`), `fld()` is the single field primitive (contenteditable in edit mode), renderers record usage
  (`ctx.use`) so that only used CSS, runtime features, icons and UI strings are exported.
- **CSS** (`css.js`): `buildCSS` assembles only what a document uses: base, shared chunks pulled by block
  dependencies, block and variant chunks, the active theme (rules of unused blocks shaken out), features, languages,
  dark scheme, print.
- **Runtime** (`runtime.js`): exported pages carry small feature functions serialized with
  `Function.prototype.toString`, ordered by a dependency graph. They reference only `R`, their locals and browser
  globals; `__P__` in their source is replaced by the product's class prefix.
- **Export** (`export.js`): clean (readable) or packed (deflate + base64, inflated on open) HTML, optional embedded
  editable source (`extractSource` reads it back), size and tree-shaking report.

## Document products

| product | built on | prefix | stage |
|---|---|---|---|
| resume (`resume-app/`) | `paper/` | `rv` | paper pages |
| docs (`docs-app/`) | `paper/` | `dc` | paper pages |
| landing (`landing-studio/`) | `doc/` directly (+ `portal/` blocks) | `lp` | device widths |
| site (`site-studio/`) | `doc/` directly (+ `portal/` blocks, blocks on `diagram/`, `markdown/`, `math/`, `booking/`, `calendar/`, `estate/`, `units/`, `barcode/`, `csv/`, `qr/`; accounts on `access/`) | `lp` | device widths |
| funding (`funding-studio/`) | `doc/` directly | `fd` | device widths |

A paper product calls `definePaperProduct({ prefix, format, blocks, ui, css, themes, order, paperDefaults,
paperRegions, … })` with only its own blocks, strings and CSS; the editor side is `{ ...PAPER_EDITOR, fileExt,
categories, typeIcons, importers, exporters }`. Shared CSS and runtime sources write class prefixes as `__P__`.

Network: document pages contain a network API only when they need one. The landing runtime answers requests to
`local:<collection>[/<key>]` URLs from the visitor's storage (zero network) and adds its HTTP transport (feature
`net`) only when a used request targets a server; resume and docs pages never use the network.

## Shared presentation primitives (`portal/`)

Blocks that two applications with different document models both need are written once in `portal/` and adapted,
not copied. A block is a neutral schema (`models.js`: field kinds `text long code link day num bool select image file`
and one item list) that each host converts to its registry (landing: `doc/` schema with `i18n` fields; knowledge:
`blocks.js` field kinds), a builder `PT_RENDER[type](block, V)` that writes HTML through a view adapter `V` (texts per
language or wiki markup, links, pictures, files, UI strings, anchors of other pages), a set of CSS chunks with the
`__P__` prefix and `--pt-*` tokens that the host maps onto its theme on the block root, and runtime features
`function ptX(R)` that use only `data-pt-*` attributes (landing serializes them like its own; the knowledge reader calls
them and re-scans after every render). A *catalog* of all portal blocks of a site (`buildCatalog`) gives site-wide
anchors and makes cross-block features possible: references to articles of any act, glossary terms linked with
tooltips in other blocks, requests matched with the directory, topic hubs, the unified search index.

## Editor (`studio/`)

The editor renders the document with the engine in edit mode, edits it through `commit()` (snapshot history), keeps
projects in IndexedDB with one writer per project across tabs, and offers palette, outline, files, schema-driven
inspector, document settings, content languages, templates, export and preview. The product configures it with
`defineEditor(spec)` (`studio/config.js` documents every hook): the canvas stage (`stage.js`: paper pages or device
widths), document-settings tabs (built from `right.js` helpers), common / style fields, extra field types, block
menu items, link targets, attachment fields, dictionaries, other file formats (`importers` open e.g. Markdown / ZIP as
a new project, `exporters` add download formats). `richtext/` provides inline editing of rich fields and tables. Page CSS: `ui/base.css` + `richtext/richtext.css` + `studio/editor.css`.

## Build (`singlefile.js`)

Two targets per application, both minified (HTML, CSS, JS) and both audited by the network policy:

- **`html@5-singlefile/<page>.html`**: module scripts are bundled into one inline module (scope hoisting; only live
  top-level declarations survive), classic scripts, stylesheets, icons, images, media and fonts are inlined.
- **`html@5/`** (`multifile.js`): a copy of the application's structure with only what its pages use — pages and app
  modules at the top, library modules under their folder names. The bundler's split mode keeps one file per module but
  applies the same liveness analysis: dead declarations and unused imports are dropped, imports point straight at the
  declaring module (re-export barrels disappear unless a namespace object is needed), `V.x` namespace accesses become
  named imports, `import()` and `new URL('./asset', import.meta.url)` keep working; stylesheets keep their @import /
  url() structure with rewritten paths and assets are copied.

Both targets inline `new URL('./x.js?bundle', import.meta.url)` as a data: URL of a gzip-compressed ES module bundle of
x.js whose default export is its namespace — code a page writes out for another host (the landing editor's backend
archives carry the engine and server built this way; `bundle.js` `assetBundle`, also answered by `server.js`).

**NOTICE targets** (`targets.js`): an application directory with `[SINGLEFILE_](OFFLINE|SERVERLESS|BACKEND|STANDALONE|ELECTRON)
[_SINGLEFILE]_NOTICE.md` files gets exactly those artifacts instead of the two defaults:

| NOTICE file in `<app>/` | artifact |
| --- | --- |
| `OFFLINE_NOTICE.md` | `html@5_offline/` — multi-file copy, no network code at all |
| `SINGLEFILE_OFFLINE_NOTICE.md` (or `OFFLINE_SINGLEFILE_…`) | `html@5_offline_singlefile/<page>.html` — one file per page, no network code |
| `SERVERLESS_NOTICE.md` | `html@5_serverless/` — static site for any static host (`404.html` routes) |
| `SINGLEFILE_SERVERLESS_NOTICE.md` | `html@5_serverless_singlefile/<app>.mjs` — one script for Node ≥ 18 that serves the site like GitHub Pages |
| `BACKEND_NOTICE.md` | `html@5_backend/` — `server.mjs` + `backend.mjs` (the bundled `<app>/backend.js`) + `public/` |
| `SINGLEFILE_BACKEND_NOTICE.md` | `html@5_backend_singlefile/<app>.mjs` — server, backend and pages in one script for Node ≥ 18 |
| `STANDALONE_NOTICE.md` | `html@5_standalone/<page>.html` — one file that opens from file:// and talks to servers over HTTPS + CORS (no server preset) |
| `ELECTRON_NOTICE.md` | `html@5_electron/` — a desktop application for Electron ≥ 29: `package.json` (`npm start` = `electron .`), `main.mjs` (the pages from a private `in-html://<app>/` scheme, the bundled `<app>/backend.js` in-process), `preload.cjs` (a small `window.inHtmlElectron` bridge), `public/` |
| `SINGLEFILE_ELECTRON_NOTICE.md` | `html@5_electron_singlefile/` — the same with the backend and the single-file pages inside `main.mjs` |

Each page gets `globalThis.IN_HTML_ARTIFACT = { mode, singlefile, servers }` (`withArtifact`, a classic script at the start
of `<head>`). Offline targets build with the bundler variant 'offline': `./x.js` resolves to `./x.offline.js` when it
exists (`rooms/client.offline.js` keeps the client's exports without network code) and must pass the zero-network audit.
Backend targets bundle `<app>/backend.js` (default export `(ctx) => ({ handle(req, res, url), close?() })`, ctx = `{ dataDir, storage:
{ read, write (atomic), list, remove }, log, name, mode: 'backend' | 'electron' | 'dev', node: { http, https, dns, net, zlib, fs, path,
os, child_process, stream, crypto, url, events }, desktop? }` — bundled backends cannot import node: modules, so files and child
processes go through `ctx.node`; `mode` and the last eight modules were added later, older backends ignore them) and serve it with `hosting.js` (copied verbatim: static files like GitHub Pages — clean URLs, `404.html` with
status 404, ETag, gzip — CLI `[port] [--host] [--data]`). Folders that no NOTICE asks for any more are removed.

**Electron artifacts** (`electron.js`, `electron-preload.cjs`, `<app>/electron.json`): `main.mjs` is `hosting.js` +
`electron.js` + the start call. The pages load from the privileged custom scheme `in-html://<app>/` (`protocol.handle`
through `webHandler`: standard, secure, fetch, streamed media with Range): no TCP port is opened and the origin is stable,
so IndexedDB persists between launches. The backend runs in-process through `createHosting` with `ctx.mode =
'electron'` (only the application's own windows can reach it) and `ctx.desktop.paths` (home, music, videos, downloads,
…). Windows use contextIsolation, sandbox, no Node integration, no webview; navigation away from the origin and new
windows are refused (allowlisted links open in the system browser); only fullscreen and clipboard-write permissions
are granted; HTML responses carry a CSP whose script-src lists the SHA-256 of the page's inline scripts. The preload
exposes `window.inHtmlElectron`: native open-file / open-folder dialogs returning real paths, `pathForFile(file)` for
dropped files, window controls, global shortcuts and media keys, the tray, a mini-player window (`#mini` of the page),
open-external with an allowlist, reveal in folder, keep-awake, file arguments of the launch; IPC handlers answer only
frames of the application origin. `<app>/electron.json` (optional) sets the page, window size and colour, the mini
window, the external-link allowlist, the CSP, the package name and `probes` (requests `node check.js electron` sends
through the protocol handler). `node check.js electron` runs each artifact under a stub of the `electron` module.

`--check` builds in memory and fails when an artifact is missing, stale or different (CI uses it to prove the build
is reproducible). `--publish <dir>` writes the single-file pages under publishing names (the application's first
word in capitals: `LANDING.html`, `CRYPTO.hashing.html`), with the links between pages following those names.
Remote resources are reported, never fetched; standalone pages that use the network fail.
