# Site Studio — product contract of the site format (`ss-site`, inherited from the landing builder)

Specification of the site product (`site-studio/`, carried over from `landing-studio/`; additions of Site Studio — accounts, closed sections, the constructor, the blocks on the libraries — are described in README.md): document model, pages and routing (§18), blocks,
rendering, CSS tree shaking, runtime features, cart / checkout / forms behaviour and export. The code is the reference when this file is
silent; when they disagree, fix whichever is wrong and keep both in step. Repository-wide conventions (folders,
libraries, build, network policy) are in [../ARCHITECTURE.md](../ARCHITECTURE.md).

The landing builder is a document product on the shared engine: `doc/` (model, rendering, export), `studio/`
(editor), `richtext/`, `ui/`, `html/`, `i18n/`, `minify/`, `qr/`, `codec/`, `sample/`. This folder holds only the
landing-specific parts (§15).

## 0. Product requirements (from the user — non-negotiable)

1. Same thing as the resume builder, but for landing pages / small one-page sites: visual editor → one
   self-contained HTML file (opens from `file://`, Codeberg/GitHub Pages, any host).
2. **Shopping cart with sync fallback chain: configured HTTP requests → localStorage (→ in-memory)**.
3. **Tree shaking**: nothing unused is shipped (CSS per used block type and per used variant, runtime features,
   icons, UI strings per exported language and per used key, requests, theme rules, fonts). No commerce → zero cart
   CSS/JS/markup. No runtime needed → no executable `<script>` at all.
4. **`<object>` for embedded content** in the single file (PDF catalogs, price lists, spec sheets, audio, video,
   text): stored once in the HTML (base64 store scripts), shown through `<object>` lazily hydrated with blob URLs,
   fallback content inside `<object>`, download/open buttons — the resume attachment model.
5. Four scenario templates + blank, each a distinct visual design (theme preset + generated SVG artwork + generated
   PDF/WAV sample files), multilingual, all names FICTIONAL:
   - **dance** — Georgian folk dance ensemble & portfolio of choreographies set to music. ka, en, ru.
   - **industry** — heavy industry plant, equipment catalog with "price on request" → quote cart (RFQ). ru, en, de.
   - **winery** — winery with wine shop cart, tastings, kvevri process, age gate 18+. ka, en, ru.
   - **agro** — agricultural company, wholesale products (units, minimum order), seasonality, farmers program. ru, en, uk.
   - **blank** — nav + hero + one section + footer, in the user's language.
6. **Several pages** in every mode (§18): the single file pretends to have pages (hash routes), the single file can
   also be deployed as 404.html, static archives route unknown addresses through 404.html (base path detection, a
   designed "Not found" page), the backend serves every page at a clean path and a real 404; shared header / footer.
7. Generic blocks for partners (logo wall / marquee), testimonials (cards / quote slider, stars, source), carousels,
   stats with count-up, tabs, comparison tables, before / after, announcement bar, countdown, consent-gated video —
   accessible, keyboard / touch, reduced motion, light / dark, phones ≥ 380 px.

## 1. Naming

| thing | value |
|---|---|
| class prefix / CSS vars | `lp-` / `--lp-*` — never `rv-` anywhere in the landing code |
| doc format | `format: 'lp-landing'`, `version: 1` |
| project file | `<name>.landing.json` |
| IndexedDB / BroadcastChannel / locks | `lp-editor` / `lp-editor` / `lp-project:<id>` (studio/, from the product prefix) |
| editor localStorage keys | `lp-ed-*`; editor canvas style element id `lp-style` |
| export ids | `lp-cfg` (JSON config), `lp-att-<id>` (attachment store), `lp-source` (`application/x-lp-source`), `lp-pack` (`application/x-lp-pack`), `lp-nojs` |
| html attrs | `<html lang dir data-lp="VERSION">`, meta generator `lp <VERSION>` |
| runtime localStorage | `lp-lang:<docId>`, `lp-scheme:<docId>`, `lp-cart:<docId>`, `lp-outbox:<docId>`, `lp-age:<docId>`, `lp-local:<docId>:<collection>` (browser-local endpoints), `lp-pos:<docId>` (reader positions: `{<itemId>: {a: attId, t: s}, <itemId>/<attId>: {s: fraction | t: s}}`, newest 300), `lp-reader:<docId>` (reader prefs `{fs, th, rate}`), `lp-chat:<docId>:<blockId>` (chat history), `lp-chat-out:<docId>` (chat outbox), `lp-ann:<docId>:<blockId>` (dismissed announcement: text signature) |
| events | `lp:lang` (detail = lang), `lp:cart` (detail = state), `lp:local` (detail = {collection, id, method}), `lp:api` (detail = {online}), `lp:page` (detail = {page, from}: slugs, after the router showed a page) on `document` |
| data attributes | new behaviour `data-lp-*`; keep resume names `data-l`, `data-set-lang`, `data-att`, `data-att-img`, `data-alt`, `data-f`, `data-kind`, `data-item`, `data-add-item`, `data-bid`, `data-list`, `data-empty`, `data-att-dl`, `data-att-op` |
| rich-text indent classes | `lp-i1`..`lp-i4` (html/sanitize.js, richtext/ and CSS together) |
| private MIME | clipboard `application/x-lp-html`, drag `application/x-lp-drag` |
| app title | EN "Landing Builder", RU "Конструктор лендингов" |

## 2. Document model

```js
{
  format: 'lp-landing', version: 1, id, name,
  meta: { title:{}, description:{}, author:'', keywords:'', ogImage:null /*att id (image)*/, favicon:null /*att id (image)*/,
          created, modified },
  langs: ['en'], defaultLang: 'en',
  output: {
    autodetect: true, switcher: 'buttons' /*'buttons'|'select'|'none'*/, langLabels: 'native' /*'native'|'code'*/,
    themeToggle: false,
    toolbarPos: 'nav',        // 'nav' (tools inside the nav block when one exists) | 'top-right' | 'bottom-right' | 'bottom-left'
    uiFallback: 'en',
    motion: 'none',           // 'none' | 'fade' | 'rise'   (feature reveal)
    backToTop: false,         // CSS-only <a class="lp-totop" href="#top">
    ageGate: { enabled:false, minAge:18, title:{}, text:{}, yes:{}, no:{}, noUrl:'' },  // feature agegate
    basePath: '',             // site path on its host ('/repo/'); '' = detected at runtime (404.html, §18)
  },
  theme: {
    preset: 'clean',
    accent:'#…', accent2:'#…', bg:'#…', surface:'#…', text:'#…', muted:'#…', border:'#…',   // copied from preset vars
    fontBody:'sans', fontHead:'sans',  // FONT_STACKS key or 'asset:<attId>' (uploaded font, resume mechanism)
    baseSize: 17,             // px 14..22
    lineHeight: 1.6,          // 1.2..2
    radius: 10,               // px 0..28
    buttons: 'solid',         // 'solid' | 'pill' | 'square' | 'outline'
    headings: 'normal',       // 'normal' | 'caps' | 'italic' | 'underline' | 'eyebrow'
    width: 1160,              // container max px 880..1440
    space: 'normal',          // 'compact' | 'normal' | 'airy'  (section vertical padding scale)
    scheme: 'light',          // 'light' | 'dark' | 'auto'
  },
  shop: {
    currency: 'USD',          // ISO 4217 /^[A-Z]{3}$/ (CURRENCIES suggests common ones: GEL USD EUR RUB UAH GBP CHF PLN TRY KZT AMD AZN CNY JPY)
    mode: 'cart',             // 'cart' | 'quote' (request for quote: prices optional, "Add to request")
    cartButton: 'auto',       // 'auto' (in nav if a nav exists, else floating) | 'nav' | 'floating'
    sync: 'local',            // 'local' | 'remote' (configured requests with local fallback)
    loadReq: null, saveReq: null,   // request ids (sync === 'remote')
    policy: 'newest',         // 'newest' | 'remote' | 'local' | 'merge'
    ttlDays: 30,              // 1..365
    checkout: {
      method: 'request',      // 'request' | 'mailto' | 'whatsapp' | 'telegram' | 'link' | 'none'
      req: null,              // request id (method === 'request')
      fallback: 'mailto',     // when the order request fails: 'mailto' | 'whatsapp' | 'telegram' | 'none'
      email:'', phone:'', telegram:'', url:'',
      fields: [ /* same item shape as form block fields (§5 form) */ ],
      note:{}, success:{}, minTotal: 0,
    },
  },
  requests: [   // "configured requests", shared by cart sync, checkout and forms (max 50)
    { id, name:'Save cart', method:'PUT', url:'local:cart/{cartId}' /* or https://api.example.com/cart/{cartId} */,
      headers:[ {k:'X-Shop', v:'demo'} ], credentials:'omit' /*'omit'|'same-origin'|'include'*/,
      timeout: 8000 /*1000..60000*/, retries: 2 /*0..5*/, itemsPath:'items' /*dot path in a load response*/ },
  ],
  regions: { header: [ /* nav, announce */ ], main: [ /* page, page, … (§18) */ ], footer: [ /* footer */ ] },
  attachments: { [id]: { id, name, mime, size, title:{}, desc:{}, asset:bool, added, data?:base64 } },  // resume model minus `appendix`
}
```

Normalization rules (normalizeDoc must enforce, never throw, keep resume caps MAX_NEST/MAX_LIST/MAX_ITEMS/…):
- enums/ranges above; currency `^[A-Z]{3}$` else 'USD'; request `method` ∈ GET POST PUT PATCH DELETE; request `url`
  must be a browser-local endpoint `local:<collection>[/<key>]` (§8), `https://…`, `http://…`, or a path starting with
  `/`, `./`, `../` (anything else → '' = unusable);
  header names `^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$`, values ≤ 2000 chars without CR/LF, forbidden names dropped
  (`cookie`, `host`, `content-length`, `origin`, `referer`, `connection`, `transfer-encoding`, `proxy-*`, `sec-*`);
  every request id referenced by `shop.loadReq|saveReq|checkout.req` and form blocks' `req` must exist, else `null`.
- URL/header placeholders: `{cartId}` `{orderId}` `{site}` (doc id) `{lang}` `{currency}` `{form}` (form block id).
  Unknown placeholders stay literal; values are `encodeURIComponent`-ed in URLs, raw in headers.
- Common block props (replace the resume's COMMON_DEFAULTS): `hidden:false`, `langs:null`, `device:'all'`
  (`'all'|'desktop'|'mobile'`), `anchor:''` (slug `^[a-z][a-z0-9-]{0,40}$`, unique per doc; first wins; reserved:
  `top`, `cart`, `lang`), `style:{ mt:null, mb:null, pad:null (px), bg:'', color:'', align:'' }`.
  Variant props are NEVER called `style` (that key is always the common style object).
- Common prop `source` (content collection of a list block, backend exports §16): only on types with an item schema
  that are not flagged `noSource` (nav, hero, footer, buttons, cta, form are), a slug `^[a-z][a-z0-9-]{0,30}$` except
  `chat api admin assets data site build`; anything else → the key is absent (templates never carry it).
- Any field declared with type `att` (schema or itemSchema) must reference an existing attachment, else `null`.

## 3. Regions, page skeleton, responsive model

- REGIONS = `['header','main','footer']` (exported). `header` normally holds one `nav` (and an `announce` bar), `footer`
  one `footer`; header and footer are shared by every page. `main` holds the **pages** (§18); the blocks of a page are
  its top level — usually `section`, `hero`, `cta` (full-bleed types, registry `full:true`) but any block is allowed:
  a non-full top-level block gets its content wrapped in `<div class="lp-wrap lp-solo">`.
- View markup: `<div class="lp-root lp-t-<preset> lp-btn-<buttons> lp-hd-<headings> lp-sp-<space>" data-mode="view" id="top">`
  `<header class="lp-header">…</header><main class="lp-main">…</main><footer class="lp-footer">…</footer></div>`
  — one `<main>` per page when a render holds several pages (§18; all but one `hidden`)
  (edit mode: same with `data-mode="edit"` and the resume edit attributes; `data-list="regions.header"`, the edited
  page's `<main data-list="<page id>:blocks">` etc.).
- Block wrapper: `<div class="lp-b lp-b-<type>[ lp-rv][ lp-dev-desktop|mobile][ lp-cbg]" id="<anchor || 'b-'+id>" [data-bid] [style]>`.
  Keep the exact class order `class="lp-b ` (section-emptiness checks rely on the substring, like the resume).
- **Responsive via container queries only**: `.lp-root{container:lp/inline-size}`; tablet `@container lp (max-width:900px)`,
  phone `@container lp (max-width:600px)`. Never use viewport `@media (max-width…)` for layout (only for
  `prefers-*` and print). Font sizes that scale use `cqi` with `clamp()`. This makes the editor canvas at device
  widths (1280 / 1024 / 768 / 390 px) render exactly like the real page.
- `--lp-vh`: view `1vh` (use `100svh`-safe values via `min()`), edit `7.2px`; hero heights use `calc(var(--lp-vh)*N)`.
- Edit mode: nothing `position:fixed`; sticky nav becomes `position:relative`; no floating toolbar/cart button, no
  drawers/dialogs/age gate; reveal off; `<details>` menus/FAQ rendered open so they are editable.

## 4. Theme presets & fonts

THEMES entry shape = resume: `{ vars:{accent, accent2, bg, surface, text, muted, border, fontBody, fontHead, radius,
buttons, headings, scheme?}, css:'one rule per line, every selector prefixed .lp-root.lp-t-<key>' }` (one owner per
`@container`/`@media` line so shaking works). Presets:

| key | owner | intent |
|---|---|---|
| `clean` | design | neutral modern, white + blue accent; default and blank |
| `noir` | design | generic dark elegant (black, warm white, champagne accent) |
| `supra` | dance template | night black / deep burgundy / gold, display-serif headings, Georgian ornament motifs |
| `forge` | metallurgy template | graphite & steel + safety orange, condensed bold uppercase headings, blueprint grid |
| `kvevri` | winery template | ivory paper, wine red, olive & gold, refined serif, thin rules |
| `harvest` | agro template | fresh green + wheat yellow + earth brown, friendly rounded/humanist sans |
| `counsel` | legal template | warm paper, navy and brass, serif headings, square corners, greyscale portraits |
| `shore` | real estate template | white page, sand panels, deep teal, geometric headings, pill buttons |
| `folio` | library template | library paper and ink, bookish serif, shelf details |
| `quire` | books template | publisher's cream and print accents, editorial serif |
| `nocturne` | audio library template | dark (light toggle), night blues with a warm accent |

FONT_STACKS (system fonts only; each covers Latin, Cyrillic, Georgian through fallbacks — copy resume GEO_SANS /
GEO_SERIF approach): `sans`, `humanist`, `geometric`, `serif`, `slab`, `mono` (resume) + `condensed`
("Bahnschrift SemiCondensed", "Roboto Condensed", "Arial Narrow", "Liberation Sans Narrow", "Noto Sans", GEO_SANS,
sans-serif) + `display` ("Didot", "Bodoni 72", "Playfair Display", "Iowan Old Style", "Times New Roman", GEO_SERIF,
serif) + `rounded` (ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", "Segoe UI", GEO_SANS, sans-serif).

## 5. Block types

Registry entry = resume shape (`category, icon, container, lists?, i18nFields, itemI18nFields?, defaults(),
schema[], itemSchema?, itemDefaults?, render(b, ctx)`) plus:
`variants: ['variant']` (props whose value selects a CSS chunk `CSS_VARIANTS[type]['<prop>=<value>']`),
`full: true` (full-bleed top-level), `region: 'header'|'footer'` (preferred insert region),
`richFields: {path:'rich'|'inline'}` and `itemRichFields: {key:'rich'|'inline'}` (editor sanitizer paths; replaces
the editor's hard-coded RICH_PATHS), `itemLabel: 'key'` (item field shown in the inspector list), `palette: false` (registered
for old documents / templates but never offered in the palette or insert menu; studio/ops.js), `normalize(out, b, ctx)`
(type fix-up after the engine's coercion: nested item lists, key lists).
Field types (editor renders them): resume set `select number range checkbox color text textarea i18n att icon date
langs` (+ `nullable` numbers, `when`, `placeholder`, `unit`, `hint`) and NEW: `day` (YYYY-MM-DD, `<input type=date>`),
`time` (HH:MM), `req` (select of doc.requests ids, null = none), text option `suggest:'anchors'` (datalist of
`#anchor` values), and the collection controls `kvlist` (item attributes), `filelist` (item files), `clkeys` (block
filter / range / sort keys; `mode: 'filter'|'range'|'sort'`) from editor-collection.js. Option labels `o.<value>`, field
labels `f.<key>` (or explicit `label`).
Categories (palette order): `structure`, `content`, `commerce`, `media`, `layout`.
Notation: `i18n` = per-language plain text; `rich` = per-language sanitized rich HTML; `att` = attachment id|null.

### structure (viewer-blocks-a.js)
- **nav** — region header, full. brand i18n, logo att(image), logoH number 20..96 (36) px, pages checkbox (true: a link to
  every page shown in navigation, before the items, when the site has two such pages or more; `aria-current="page"` on
  the current one), items[{label i18n, href text suggest anchors}],
  ctaLabel i18n, ctaHref text, sticky checkbox (true), overlay checkbox (false; transparent over a following hero — in
  renders holding several pages only when every page opens with such a hero),
  variant `bar|center|split`. Mobile (≤900px container): CSS-only burger `<details class="lp-nav-m"><summary>` (no JS).
  Renders the tools slot `navTools(ctx)` (core helper: language switcher, theme toggle, cart button) at the end.
- **hero** — full. eyebrow i18n, title i18n, text rich, items = buttons [{label i18n, href, kind primary|secondary|ghost, icon}],
  layout `center|left|split|split-rev` (variants: ['layout']), media att(image, split layouts), bg att(image),
  bgVideo att(video; native `<video muted autoplay loop playsinline>` hydrated by feature media; poster = bg), overlay range 0..90 (45),
  height `auto|tall|screen`, tone `auto|dark|light`, badge i18n (small pill above title, optional).
- **footer** — region footer, full. brand i18n, logo att, text rich, items = columns [{title i18n, html rich}],
  copy i18n, variant `columns|simple|center`.

### layout (viewer-blocks-a.js)
- **section** — container `blocks`, full. eyebrow i18n, title i18n, lead rich, width `narrow|normal|wide|full`,
  pad `none|s|m|l|xl` (m), tone `auto|muted|dark|accent|light`, bgImage att, overlay 0..90 (50), align `left|center`,
  shape `none|wave|slant|zigzag|ornament` (decorative top edge as inline SVG; ornament = Georgian-style geometric band).
  Tones redefine the CSS vars inside `.lp-tone-<tone>`.
- **columns** — resume's (cols[{id,w,blocks}]); gap px 0..80 (24), valign; stacks under 600px.
- **divider** — variant `solid|dashed|dotted|double|accent|ornament`, thickness 1..6.
- **spacer** — h px 4..240 (32).

### content (viewer-blocks-a.js and viewer-blocks-b.js)
A: **heading** (text i18n, level 1..4, icon, align left|center|right, eyebrow i18n); **text** (html rich, cols 1|2,
size `s|m|l`); **quote** (resume callout: html rich, tone, icon + author i18n); **buttons** (items buttons, align);
**features** (items[{icon, title i18n, html rich, image att}], variant `cards|icons|list|split`, columns 2..4 (3));
**stats** (items[{value text, suffix i18n, label i18n}], variant `plain|cards|band`, columns 2..5 (4), count checkbox:
numbers count up once in view, feature counter — the final value is the markup text);
**steps** (items[{title i18n, html rich, icon}], variant `numbers|line|cards`).
B: **timeline** (items[{date text, title i18n, html rich, image att}], variant `line|alternate`);
**team** (items[{photo att, name i18n, role i18n, html rich, href}], variant `cards|round|list`, columns 2..4);
**testimonials** (items[{html rich, name i18n, role i18n, photo att, rating 0..5, source i18n, href}], variant
`cards|large|slider|quote` (quote = one large testimonial at a time in the shared carousel, autoplay 0..30 s), summary
checkbox: average rating and count of the reviews shown);
**logos** (items[{att, name i18n, href}], variant `grid|strip|marquee` (marquee: the list twice, the copy `aria-hidden`
without tab stops, CSS loop of `speed` seconds paused on hover / focus / reduced motion, pause button feature marquee),
mono checkbox = greyscale until hover / focus);
**faq** (items[{q i18n, html rich}], variant `details|cards`, openFirst checkbox, single checkbox = one answer open at a
time through `<details name>`; no JS);
**cta** (title i18n, html rich, items buttons, variant `banner|split|card|strip`, logo att (logo + call to action), bg
att, tone; full);
**contact** (items[{kind (resume CONTACT_KINDS + `address`, `hours`), value text, label i18n, href}], map att(image),
mapHref text, variant `cards|list|split`);
**table** (engine table model doc/table.js, richtext/ table editing; classes `lp-tbl*`, `lp-tbs-*`);
**form** (lead form; items = fields [{key text `^[a-z][a-z0-9_]{0,30}$`, type `text|email|tel|textarea|select|checkbox|number|date`,
label i18n, ph i18n, options i18n (one per line), required checkbox, half checkbox}], title i18n, submit i18n,
req (type req), fallback `mailto|whatsapp|telegram|outbox|none`, to text, success i18n, consent rich,
variant `card|plain`).

### commerce (viewer-blocks-c.js)
- **products** — items[{sku text `^[A-Za-z0-9._-]{1,40}$` (editor auto-fills `p-<n>`; unique per doc), name i18n,
  html rich, price nullable number (null = on request), old nullable number, unit i18n, image att, badge i18n,
  specs i18n (one "Key: value" per line → `<dl class="lp-kv">`), min number (1), step number (1),
  stock `in|low|out|pre`}], variant `cards|list|compact|table`, columns 2..4 (3), qty checkbox, buy i18n (button label override).
- **pricing** — items[{name i18n, price nullable number, period i18n, html rich, featured checkbox, label i18n, href, sku text
  (non-empty → the button adds this sku to the cart instead of following href)}], columns 2..4.
- **events** — items[{date day, time time, title i18n, city i18n, venue i18n, href, price nullable number, sku text,
  status `on|few|soldout|cancelled`}], variant `list|cards`, hidePast checkbox (feature events).
- **cart** — inline cart + checkout on the page: title i18n, text rich, form checkbox (inline checkout form).
- Products, pricing, events and collection items with a non-empty sku form ONE catalog: `collectProducts(doc)` → Map sku →
  `{price, old, name (i18n), unit (i18n), min, step, img (att id|null)}`; duplicate skus: first wins (editor warns).

### media (viewer-blocks-c.js)
- **image** — resume image (att, width %, align, shape `rect|rounded|circle`, caption, link) + ratio `auto|16/9|4/3|1/1|3/4`, fit `cover|contain`.
- **gallery** — items[{att, caption i18n}], variant `grid|masonry|slider|mosaic`, columns 2..5 (3), ratio, zoom checkbox (feature lightbox), gap px.
- **embed** — THE `<object>` block (generalized resume attachment block): att (any), display `embed|card`,
  player `object|native` (native = `<video>/<audio controls>` for media types; everything else stays object/iframe),
  height px 120..1200 (520), ratio `auto|16/9|4/3` (video), caption i18n, dl / op checkboxes.
  Preview policy exactly as resume `previewKind`: active types (html/xml/svg/js) → `<iframe sandbox="">` only;
  allowlist (pdf, text/plain, mp4/webm/ogg video, mpeg/ogg/wav/webm audio) → `<object data-att type>` hydrated lazily;
  others → card with download. `<object>` fallback content = card + download button.
- **qr** — resume QR (sizes px).
- **collection** (viewer-blocks-collection.js) — see below; legacy **works** blocks become collections (viewer-migrate.js).

### part D (viewer-blocks-d.js, runtime viewer-runtime-d.js)
- **carousel** (media) — items[{image att, title i18n, html rich, label i18n, href}], variant `cards|hero|images` (hero =
  full-width slides with the text over the picture), ratio, perView 1..6 / perViewT 1..4 / perViewP 1..2 (slides per
  view on desktop / tablet ≤900px / phone ≤560px container), gap, overlay (hero), autoplay 0..15 s, loop, arrows, dots,
  label i18n (accessible name). Markup (`carouselHTML`, shared with the testimonials' quote slider):
  `.lp-carw > .lp-car[data-lp-car][data-lp-car-auto=s][data-lp-car-loop][role=region]` with a CSS scroll-snap track
  `ul.lp-car-track[data-lp-car-track][tabindex=0]` (swipe, scroll and arrow keys work without JS), slides
  `li.lp-car-slide[role=group][aria-label="n / N"]` and JS-only controls `[data-lp-car-go=prev|next]`,
  `[data-lp-car-dot=i]` (aria-current), `[data-lp-car-pause]` (aria-pressed). Feature carousel: dots follow the
  scroll position, loop wraps, autoplay only while visible, not hovered / focused, the tab shown and not paused — off
  for prefers-reduced-motion until the visitor presses play; RTL aware.
- **tabs** (content) — items[{label i18n, icon, html rich, image att}], variant `line|pills|vertical`. View: JS-only
  `[role=tablist]` + `section[role=tabpanel]` panels with a heading shown only without JS (every panel visible then);
  feature tabs = WAI-ARIA tabs (roving tabindex, arrows, Home, End). Edit: every panel as a card.
- **compare** (content) — a comparison table: cols i18n (one column name per line), featured 0..8 (highlighted
  column), caption i18n, items = rows [{label i18n, values i18n (one value per line in column order: `+`/yes/✓ → check,
  `-`/no/— → dash, anything else as text; the words in the 7 languages), note i18n, group checkbox (group heading row)}].
  `<table>` with `th[scope]`, sticky first column, horizontal scroll region on phones.
- **beforeafter** (media) — before / after att(image), beforeLabel / afterLabel i18n, start 0..100 %, ratio, caption.
  Two stacked pictures, the upper one clipped at `--lp-ba`; a transparent full-size `<input type=range>` (keyboard and
  pointer) moves it (feature ba). Without JS: the two pictures side by side.
- **announce** (structure, region header, inserted at its start: registry `regionStart`) — html inline rich, label i18n
  + href (link), icon, tone (variant), dismiss checkbox: the close button hides the bar and remembers it per text
  signature (`lp-ann:<docId>:<blockId>`, feature announce). With a sticky nav the header becomes `display:contents` so
  the bar scrolls away and only the nav sticks.
- **countdown** (content) — title i18n, date day, time (optional), tz (UTC offset in hours, null = the visitor's time),
  units `dhms|dhm|dh|d`, variant `cards|plain`, done i18n. The target date and time are pre-rendered per language;
  the JS-only units (`role=timer`) count down with plural labels from cfg.ui (`cdD cdH cdM cdS`), then the done text.
- **video** (media) — from `file|url` (`source` is the content-collection key, so this one is `from`): a video att →
  native player (objectHTML, feature media); a link (https only; YouTube → youtube-nocookie.com embed, Vimeo → dnt
  player, PeerTube watch links → embed, any other https URL as is) → a consent placeholder: optional poster att, a play
  button and a note naming the host with a link to open the video there. The iframe is created only by the click
  (feature video): nothing external loads before, so offline exports stay network-free.

### collection (viewer-blocks-collection.js) — the generic catalog primitive
One explicit block for any list of things — books and audiobooks, property listings, documents, products with files, a
portfolio, repertoire — with no subject-domain fields: the domain lives in the item *attributes* chosen by the template
or the user. Category `media`, icon `book` (editor icon `layers`), `variants: ['variant']`, `itemLabel: 'title'`.

Block props: `variant` `grid|list|shelf|table|feature` (grid; shelf = covers first with a typographic cover when an item
has none; table = title + attribute columns + price + actions, stacked rows on phones; feature = first visible item
large), `columns` 2..6 (3; grid / shelf / feature), `ratio` cover proportions `2/3|3/4|1/1|4/3|16/9` (4/3),
`cardAttrs` 0..12 (3: attributes on cards = table columns), `details` `modal|expand|none` (modal), `media`
`reader|inline` (reader; inline = the first audio / video plays on the card in a native player, feature media),
`search` checkbox, `filters` / `ranges` / `sorts` key lists (below), `more` 0..200 (0 = all; else the first N + "Show
more"), `empty` i18n (no-match text), `linkLabel` i18n (item link button), `qty` checkbox + `buy` i18n (as products),
`items` (plain array — ready for a data-bound `source`).

Item: `{ id, title i18n, subtitle i18n, cover att(image), badge i18n, html rich, tags i18n (comma separated),
attrs: [{label i18n, value i18n}] (≤ 40), files: [{att, label i18n, kind auto|audio|video|text|pdf|image|file}] (≤ 60),
date day, href text, price nullable number, old nullable number, unit i18n, sku text }`. Normalization (type
`normalize`): attrs also accept `[label, value]` pairs and plain strings / numbers (default language); files also accept
bare attachment ids; unknown attachments are dropped; `kind` auto → audio/* audio, video/* video, PDF pdf, text/plain,
text/markdown or .txt/.md text, images image, else file; HTML / XML / scripts are always `file` (download only), SVG
only `image` (shown as `<img>`).

Keys: an attribute is identified by its label, case-, width- and space-insensitive, in ANY document language (`'Rooms'`,
`'rooms '`, `'Комнаты'` match the same attribute); built-ins `$tags`, `$kind` (file formats; filters), `$price`
(ranges, sorts), `$title`, `$date` (sorts). `filters` → facets with ≥ 2 options: attribute values (drop-down with
check boxes and counts; numbers sorted numerically), `$tags` / `$kind` as chips; OR inside a facet, AND across facets.
`ranges` → from–to number inputs on attribute values (`clNum`: first number, thousands separators, decimal comma,
h:mm:ss durations as seconds) or the price. `sorts` → `<select>` options (title A–Z/Z–A per current language, newest /
oldest, price / numeric attribute low–high, text attribute A–Z); missing values last, document order breaks ties.
Search: every word of the folded query (lower case, no diacritics) in the item's text in every output language
(title, subtitle, badge, tags, attribute values, file labels, the start of the description, SKU).

Cards show cover (+ badge, + a round play / read button for the first audio or video), date, title, subtitle, the first
`cardAttrs` attributes, a plain excerpt (grid / feature; full description in list or with `details: none`), tags,
price + buy (SKU), up to two reader buttons ("Listen", "Watch", "Read", "View"), the details button and the link button.
Details = every attribute + the description when the card does not show it + the file list (label, type · size, open,
download): `modal` → a `<details>` that pages without JavaScript expand in place and a dialog (feature collection)
otherwise; `expand` → `<details>` on the card; `none` → the file list on the card (hidden when its only file is
already the card's play / read button).

DOM contract (view): root `.lp-cl.lp-cl-v-<variant>[data-lp-cl][data-lp-cl-more=N][data-lp-cl-v=feature]` (attributes
only when the runtime is needed), toolbar `[data-lp-cl-tools].lp-js-only` with `[data-lp-cl-q]`, `[data-lp-cl-dd]`
(`<details>` drop-downs, badge `[data-lp-cl-n]`), `[data-lp-cl-fo="<facet>:<option>"]` (check box or aria-pressed chip),
`[data-lp-cl-min|max="r<i>"]`, `[data-lp-cl-sort]` (options `data-lp-l` = per-language labels), `[data-lp-cl-count]`,
`[data-lp-cl-reset]`; list `[data-lp-cl-list]` of items `[data-lp-ci=<index>][data-lp-iid=<item id>]` + `data-lp-q`
(search text), `data-lp-f` (facet tokens), `data-lp-v` (JSON sort / range values), `data-lp-product` (SKU);
`[data-lp-cl-empty]`, `[data-lp-cl-morebtn]`; details `[data-lp-det-open]` → `[data-lp-det]`; files
`[data-lp-file=<attId>][data-lp-rk=<kind>]` rows; reader buttons `[data-lp-read=<attId>][data-lp-rk=<kind>]`;
downloads `[data-att-dl][data-att]` (feature embed). Without JavaScript every item is visible and the tools are hidden.
CSS: base chunk per type; `variant=*` chunks; `tools=on` (toolbar, empty state, "Show more") recorded only when
rendered; shared chunks grid, media, chip, price, qty, kv; class prefix `lp-cl` (theme shaking owner `collection`).
Templates: `B('collection', { variant: 'shelf', filters: ['Author', '$kind'], items: [K.item({ title: L(…), attrs:
[{ label: L(…), value: L(…) }], files: [{ att: id, label: L(…) }] })] })`.

Legacy **works** (portfolio set to music) is migrated by `normalizeTop` (viewer-migrate.js `worksToCollection`): title →
title, genre → subtitle, music / year / duration → attributes "Music" / "Year" / "Duration" (labels in the document
languages; a leading "Music:" in the credit is dropped), cover → cover, media → files[0], html → html, tags → tags,
variant / columns kept, play inline → media inline, `details: 'none'`, `cardAttrs: 3`. `works` stays registered
(`palette: false`) so `newBlock('works')` / `B('works', …)` keep working; an unmigrated works block renders through the
collection renderer.

### chat (viewer-blocks-chat.js)
- **chat** (category content; registry flag `live: true` = without an external API it needs a backend export) —
  display `inline|bubble` (variant; bubble: a floating button in the corner `side` `right|left` that opens the panel),
  title i18n (default `chatTitle`), operator i18n, avatar att(image), welcome i18n (first message, pre-rendered),
  offline i18n (note of the "leave a message" mode; default `chatOffline`), nameField / contactField
  `off|optional|required` (visitor fields before the first message), sendReq / pollReq (type `req`: the external chat
  API, §17), fallback `outbox|mailto|whatsapp|telegram|none` + to (where a left message goes).
- Transport, chosen at export (`cfg.chat[id].m`): `ext` when sendReq is a server URL (https / path) — serverless chat
  through the configured requests; `api` in backend exports (ctx.api) — the built-in `api/chat`; else `msg` ("leave a
  message" through the fallback). A backend page running static (§16) degrades `api` to `msg` at runtime.
- View markup: `<section class="lp-chat lp-chat-inline|lp-chat-pop" data-lp-chat=ID data-lp-chat-mode=m
  aria-labelledby>` = head (avatar, `.lp-chat-t`, `.lp-chat-op`, status dot `[data-lp-chat-dot]`), message list
  `[data-lp-chat-log] role=log aria-live=polite` (welcome pre-rendered), offline note `[data-lp-chat-off]`, form
  `[data-lp-chat-form].lp-js-only` (visitor fields `[data-lp-chat-who]`, `textarea[data-lp-chat-in]` with a per-language
  placeholder, send button, status `[data-lp-chat-st]`, fallback buttons `[data-lp-chat-fb]`), no-JS note. The bubble
  widget `.lp-chatw.lp-ovl > button.lp-chat-fab[data-lp-chat-open][aria-expanded] (+ badge [data-lp-chat-badge]) +
  section.lp-chat-pop[role=dialog][aria-modal=false][hidden]` is written at the end of `<body>` (renderChatPops: a fixed
  element inside `.lp-root` would be positioned by its container query); the block keeps a hidden
  `.lp-chat-slot` (the wrapper hides itself with `:has()`). Edit mode: a static look-alike with editable title,
  operator, welcome and offline texts.

## 6. Rendering contract (viewer)

- Keep the resume rendering engine and its semantics: makeCtx, grp (`data-l` groups), fld/editField (edit contract
  `data-f` / `data-kind` / `contenteditable` / `data-ph` / `lp-f` / `lp-missing` / `lp-opt`), txt, ui, icon, attSrc,
  altAttr, links, resolveHref, plan / dropDeadXrefs, renderB, renderList, renderInternal / renderDoc / renderBlock
  (renderBlock output's firstElementChild is the block root), usage `ctx.use`.
- In-page link allowlist (html/sanitize.js, html/url.js safeURL and richtext/ link checks, identical): `https:`, `http:`,
  `mailto:`, `tel:`, `#att-<id>`, `#b-<id>`, `#<anchor-slug>`, `#top`, `#cart` (opens the cart drawer), `#lang=<code>`,
  `#/<page slug>[#<anchor>]` (a page, optionally an anchor on it, §18; mapped to the URL form of the render mode).
  Links to `#b-…`/`#anchor`/pages that do not exist after rendering are dropped (resume dead-xref logic; the targets
  are looked up site-wide, so an anchor on another page links to that page).
- ctx.use adds: `variants` Set(`type:prop=value`), `uiKeys` Set (runtime strings), `reqs` Set (request ids),
  `shop` bool, `tools` (nav tools rendered → no floating toolbar), and features recorded by renderers through
  `feature(ctx, name)`. Core's finishUsage derives: `core` (any feature), `req` (sync|checkout|form), `blob`
  (embed|player|media need store data), `i18n` (>1 lang), `theme` (themeToggle), `reveal` (motion≠none), `links`
  (any in-page link or nav present), `agegate`, `sync` (cart && shop.sync==='remote' && loadReq|saveReq valid),
  `checkout` (cart && method≠'none').
- Prices: `formatPrice(n, cur, lang)` = Intl.NumberFormat currency with a safe fallback (`'1 234 GEL'`), per language via grp.
- Event dates: `formatDay(ymd, lang, doc)` per language (Intl with built-in month tables fallback incl. Georgian).
- No-JS: JS-only controls carry `lp-js-only`; CSS `html:not(.lp-js) .lp-js-only{display:none!important}`; rtCore adds
  `lp-js` to `<html>` first. Forms without JS: `action="mailto:…" method="post" enctype="text/plain"` when the
  fallback is mailto, else `action=<request url>` if that request is POST, else the submit button is `lp-js-only`.
- `exportHTML(doc, {preview:true})` (template thumbnails, no scripts): `<html class="lp-js lp-pv">` so JS-only
  controls are visible; reveal hidden states apply only under `html.lp-reveal` (set by rtReveal), never `lp-js`.
- Custom block background (`style.bg`): wrapper gets `lp-cbg` + `--lp-cbg`; text colour is auto-contrasted (onAccent)
  unless `style.color` is set; dark scheme leaves explicit backgrounds alone.

## 7. CSS library & tree shaking

- viewer-design.js: `CSS_BASE` (always), `CSS_SHARED[chunk]` (shipped when a used type lists the chunk in BLOCK_DEPS or a
  feature needs it), `varsCSS`, `darkCSS`, tones, `CSS_TOOLS` (language switcher / theme toggle / floating toolbar —
  shipped only when rendered), `CSS_EDIT` (edit mode only), small `printCSS`, `langCSS`, Georgian no-caps CSS,
  `fontStack` (asset fonts via strict data:/blob: URLs), `shakeRules` + merged `CLASS_OWNER`, and **`buildCSS(doc, opts)`**.
- viewer-blocks-a/b/c.js: `CSS_BLOCKS_X[type]` (base rules of a type incl. its own `@container` rules),
  `CSS_VARIANTS_X[type]['prop=value']` (rules only for that variant), `BLOCK_DEPS_X[type] = [chunks]`,
  `OWN_X = [[/regex of class prefixes/, 'type'], …]` (theme rule shaking).
- viewer-runtime.js: `CSS_FEAT[feature]` (cart drawer & button, lightbox, player, reveal, agegate, slider buttons…).
- buildCSS order (view): @font-face, vars, CSS_BASE, shared chunks, block chunks, variant chunks, theme css
  (shaken), ka, tools, features, lang, dark, print. Edit: everything (all types, all variants, CSS_EDIT, dark preview
  scoped to `[data-scheme=dark]`), no features except what the editor needs to show static look-alikes.
- Icons: inline `<svg class="lp-ic" viewBox="0 0 24 24"><path d=…/></svg>` per use (resume ICONS style: stroke
  icons, `fill:none;stroke:currentColor`); only used icons appear.

## 8. Runtime features (viewer-runtime.js)

Each feature is `function rtX(R)` serialized with `Function.prototype.toString` (resume technique): may reference only
`R`, its locals and browser globals; must be strict-mode safe; feature-detect optional APIs. Write in the resume
runtime style (ES5-ish: `var`, function expressions, string concatenation). The minifier supports modern syntax, but
AVOID its known traps: no division right after `}`, no `<!--`/`-->`, no identifiers named of/await/yield before `/`.
No UI text in code: visible strings come from `R.cfg.ui[lang]` or pre-rendered markup.

`FEATURE_ORDER = ['core','req','net','api','blob','assets','i18n','theme','pages','reveal','links','media','embed','lightbox','collection','reader',
'slider','carousel','tabs','counter','ba','announce','countdown','video','marquee','agegate','events','cart','sync','checkout','form','chat']`
(emission order = dependency order).

| feature | included when | does |
|---|---|---|
| core | any other feature | `R.$`, `R.$$`, `R.cfg` (JSON `#lp-cfg`), `R.store` {get,set,del,ok} (localStorage with try/catch, in-memory Map fallback; `ok` false when blocked), `R.lang()`, `R.t(key, vars)` (plural objects via Intl.PluralRules, `{var}` interpolation), `R.fmt(n)` (currency, current lang), `R.on(ev, fn)` / `R.emit(ev, detail)` (document CustomEvents), `R.live(text)` (polite announcement into `[data-lp-live]`), adds `lp-js` to `<html>` |
| req | sync, checkout or form | `R.req(reqCfg, vars, body)` → Promise `{ok, status, data, error}`; never rejects; URL/header placeholder expansion, JSON body for non-GET. `local:<collection>[/<key>]` URLs are answered from the visitor's own storage (`lp-local:<docId>:<collection>`; zero network: GET reads, PUT stores, POST appends with an id, event `lp:local`); any other URL goes to `R.net` |
| net | a used request targets a server (a URL that is not `local:`) | HTTP transport: fetch + AbortController timeout, retries with backoff 500ms·2^n on network errors / 5xx / 429 / 408, Retry-After, `Idempotency-Key` from `vars.key` for POST/PUT/PATCH, credentials policy, JSON parse with text fallback; a relative URL on `file:` → `{ok:false, error:'unconfigured'}` without fetching. Pages without this feature contain no network API at all |
| blob | embed / player / media need store data | resume rtBlob (`#lp-att-<id>` → Blob → object URL; inline images fetched from `img[data-att-img]`) |
| i18n | >1 exported language | resume rtI18n (+ emits `lp:lang`; runtime-built UI re-labels on it) |
| theme | output.themeToggle | resume rtTheme with `[data-lp-scheme]` |
| reveal | output.motion ≠ 'none' | adds `lp-reveal` to `<html>`, IntersectionObserver adds `lp-in` to `.lp-rv`; no-op under `prefers-reduced-motion: reduce` |
| links | in-page links / nav | smooth scroll with sticky-header offset, closes the mobile `<details>` nav after a click, scroll-spy `aria-current="true"` on nav links, `a[href="#cart"]` opens the cart (when cart exists) |
| media | native players / hero bgVideo | hydrate `video[data-att]`, `audio[data-att]` sources lazily |
| embed | `<object|iframe data-att>` or dl/op buttons | resume rtAttach minus lightbox (lazy hydration, download/open buttons, popup-safe open) |
| lightbox | gallery zoom / zoomable images | accessible image dialog (prev/next, Esc, focus return), images from `img[data-lp-zoom]` |
| player | `[data-lp-play]` buttons (legacy: no current block renders them since works became collection) | modal (or inline) player: `<object>` or native audio/video by mime; title + music credit from data attributes |
| collection | a collection with search / filters / ranges / sorts, paging (`more`) or `details: 'modal'` (viewer-runtime-collection.js) | filters, sorts and pages `[data-lp-cl]` lists (DOM contract §5 collection), result count (`col.count` / `col.countOf`), empty state, reset, drop-downs (one open, outside click / Escape close), feature variant moves `lp-cl-hero` to the first visible item; item details dialog (copy of the card head + `[data-lp-det]`, R.modal) |
| reader | any `[data-lp-read]` button (needs blob, embed) | audio player dialog (chapters = the item's audio files in order, play / pause, previous / next, ±15 s, seek, speed 0.75–2×, auto-advance, Media Session), docked mini player while it plays after the dialog closes, position per item resumed by the card buttons; text / Markdown reader (DOM-built Markdown subset: headings, emphasis, code, links http(s) / mailto / tel only, images as alt text, lists, quotes, tables, rules — nothing is parsed as HTML; plain text: prose joined, short lines kept) with A− / A+, light / sepia / dark and the scroll position per file; PDF `<object>` with fallback + open / download; video with speed and position; image; downloads via `[data-att-dl]`. Prefs `lp-reader:<docId>`, positions `lp-pos:<docId>`. Archive exports (feature assets) show text files through `<object type=text/plain>` |
| slider | gallery/testimonials slider variant | prev/next buttons `[data-lp-slide="prev|next"]` for CSS scroll-snap tracks `[data-lp-track]` (works without JS by swiping) |
| pages | a render holding several pages: single file with two pages or more, the single file as 404.html, 404.html of archives (viewer-runtime-pages.js) | the router (§18) |
| carousel, tabs, counter, ba, announce, countdown, video, marquee | the part D blocks and the stats / logos options above (viewer-runtime-d.js) | see §5 part D |
| agegate | output.ageGate.enabled | shows pre-rendered `#lp-age` until confirmed (`lp-age:<id>`), "no" → noUrl or a pre-rendered refusal message |
| events | events block with hidePast | hides `[data-lp-date]` rows earlier than today (local date) |
| cart | any buy button (products/pricing/events sku) or a cart block | state, local adapter, drawer, badge, steppers, cross-tab sync, totals, `#cart` hash |
| sync | shop.sync==='remote' and a valid loadReq or saveReq | remote adapter (§9) |
| checkout | cart and checkout.method ≠ 'none' | checkout form submit (§9) |
| form | any form block | lead form submit (§9) |
| api | backend exports (export option `api`, §16) with requests or a chat (viewer-runtime-backend.js; needs net) | wraps `R.req`: `local:<collection>[/<key>]` → same-origin `api/<collection>[/<key>]` (`opt.query` appended); mode `auto` probes `api/_ping` (2.5 s) and, without a server, runs static: GET of a public collection → `data/<c>.json`, writes to `cfg.api.out` collections → `{ok:false, error:'static'}` (callers use their fallback / outbox), the rest stays browser-local; re-probes on `online`. `R.api = {state(), ready(fn(online))}`, `<html>` `lp-api-on|lp-api-off`, event `lp:api` |
| assets | attachments kept as files (export option `assetURL`, archives) and a feature needing store data | `R.url(id)` resolves `cfg.atts[id][2]` (`assets/…`) instead of a store script |
| chat | any chat block (viewer-runtime-chat.js; helper rtFormKit) | panels / bubbles, history in `lp-chat:<docId>:<blockId>` (last 100), send / receive per transport (§17), unread badge + `R.live` while closed, retry of failed messages, visitor fields, outbox `lp-chat-out:<docId>` flushed when the backend answers |

cfg JSON (`<script type="application/json" id="lp-cfg">`, jsonSafe) — only the keys used features need:
```js
{ v, id, langs, defaultLang, autodetect, scheme, titles, descs, dirs, aria,
  ui: { [lang]: { [key]: 'text' | {one, few, many, other} } },     // only use.uiKeys, only exported langs
  atts: { [id]: [name, mime] },
  shop: { cur, mode, ttl, open: true /*open drawer on first add*/,
          p: { [sku]: { p: price|null, n: {[lang]: name}, u: {[lang]: unit}, min, step, img: attId|null } },
          sync: { load: Req|null, save: Req|null, policy, debounce: 800 },                       // feature sync only
          co: { m, req: Req|null, fb, to: {email, phone, telegram, url}, fields: [{k, t, r}], min } },  // feature checkout only
  forms: { [blockId]: { req: Req|null, fb, to } },                   // feature form only
  api: { m: 'server'|'auto', b: basePath, pub: [collection], out: [collection] },   // feature api only (§16)
  chat: { [blockId]: { m: 'ext'|'api'|'msg', s: Req|null, p: Req|null, fb, to, n, c } },  // feature chat only (§17)
  motion, age: { min, no } }
// atts[id] = [name, mime, 'assets/<file>'] when the export keeps attachments as files (feature assets)
// Req = { m:'PUT', u:'https://…/{cartId}', h:{name:value}, c:'omit', t:8000, r:2, p:'items' }
```

## 9. Cart, sync, checkout, forms — runtime behaviour

**Cart state** `{v:1, id:cartId, items:[{s:sku, q:qty}], u:updatedAt(ms), d:dirty}`; cartId = 16 random chars,
created on first add. Key `lp-cart:<docId>`; state older than `ttl` days is discarded. Quantities clamped to
`[min, 9999]`, snapped up to `step`. Unknown skus (not in cfg.shop.p) dropped on load.

**Fallback chain (requirement #2)**
1. local (always): every mutation is written to localStorage immediately. Storage blocked (private mode, sandboxed
   preview iframe, file:// quirks) → in-memory for the session, status `memory`.
2. remote (feature sync; requests are `local:` endpoints or a server): on load render local state immediately, then if `sync.load` → GET; parse items at path
   `p` (default `items`), item `{sku|s, qty|q|quantity}`, optional `updatedAt|u` (ms or ISO). Merge by policy:
   `newest` (default: local dirty → keep local and push; else take remote when remote updatedAt ≥ local u or remote
   has no timestamp), `remote`, `local`, `merge` (union by sku, max qty). On mutation: mark dirty, debounce 800 ms,
   `sync.save` body `{cartId, site, lang, currency, updatedAt, items:[{sku, qty, price, name}], total}`; 2xx →
   dirty=false, status `synced`; failure → status `offline` (local copy kept, nothing lost), retry with backoff
   2s, 5s, 15s, 30s, 60s (cap), and immediately on `online` and on `visibilitychange`→visible. Load failure →
   stay local, retry load on `online`.
3. Cross-tab: `storage` events re-read and re-render.
4. Status element `[data-lp-cart-status]`: `data-state="local|memory|syncing|synced|offline"`, text from cfg.ui
   (`cartLocal`, `cartMemory`, `cartSyncing`, `cartSynced`, `cartOffline`).

**DOM contract** (renderers/exporter produce, runtime consumes)
- Product root `data-lp-product="SKU"` (runtime takes the cart thumbnail from its first `img`).
- Buy button `<button type="button" class="lp-btn lp-btn-primary lp-js-only" data-lp-add="SKU">`; qty stepper
  `<div class="lp-qty lp-js-only" data-lp-qty="SKU"><button type="button" data-lp-dec aria-label>−</button><input type="number" inputmode="numeric" min step value aria-label><button type="button" data-lp-inc aria-label>+</button></div>`.
- Cart button(s): `<button type="button" class="lp-cartbtn lp-js-only" data-lp-cart-open aria-haspopup="dialog" aria-controls="lp-cart">` icon + label + `<span class="lp-cartbtn-n" data-lp-cart-count hidden>0</span>`.
- Drawer (rendered once by `renderCartDrawer(ctx)` when feature cart): `<div class="lp-drawer lp-ovl" id="lp-cart" role="dialog" aria-modal="true" aria-labelledby="lp-cart-h" hidden>`
  = backdrop `.lp-drawer-bd` + panel `.lp-drawer-panel` (`.lp-drawer-head`, `.lp-drawer-body`),
  with `#lp-cart-h`, `[data-lp-cart-close]`, `[data-lp-cart-list]`, `[data-lp-cart-empty]`, `[data-lp-cart-total]`,
  `[data-lp-cart-status]`, `[data-lp-cart-clear]`, `[data-lp-checkout-area]` → `<form class="lp-form" data-lp-checkout novalidate>`
  (fields via `formFieldsHTML`) + `[data-lp-co-result]` + `[data-lp-co-ok]` (shop.checkout.success, shown after a sent
  order). Inline cart block: `<div class="lp-cartb" data-lp-cart-view>` with the same inner hooks.
- Rows built with DOM APIs, `textContent` only. Focus trap, Esc, backdrop click close, scroll lock, focus return.
- After add: badge bump, `R.live(...)`, open drawer on first add (cfg.shop.open).
- `[data-lp-live]` polite region rendered by the exporter when cart/form/checkout are used.

**Checkout** (feature checkout): validate required + email/tel patterns (cfg.ui `fieldRequired`, `fieldEmail`);
`orderId` = `YYYYMMDD-` + 6 random chars; method `request` → `R.req(co.req, {cartId, orderId, key: orderId, …},
{orderId, cartId, site, lang, currency, items, total, customer:{key:value}, page: location.href})` → 2xx: clear cart,
show `success` text (+ order number), follow `data.redirect` only when it is an http(s) URL. Failure → `orderFailed` +
fallback buttons (mailto / whatsapp `https://wa.me/<digits>?text=` / telegram `https://t.me/<user>` after copying the
text to the clipboard) + "copy order"; the cart is kept. Methods mailto/whatsapp/telegram/link build a plain-text
order summary (items × qty, unit, price, total, customer fields) from cfg.ui labels and open it, then offer "clear cart".
`quote` mode: prices optional, totals hidden when any item has no price, `quote*` UI keys ("Request a quote").

**Forms** (feature form): same validation; request → success | failure → fallback `mailto|whatsapp|telegram`
(prefilled) or `outbox` (store `{id, form, fields, t}` in `lp-outbox:<docId>`, max 20, status `formQueued`, retried on
next load and on `online` with `Idempotency-Key` = submission id). No request configured → straight to fallback.

## 10. Exporter

`exportHTML(doc, {mode:'clean'|'packed', minify, embedSource, source, langs, defaultLang, preview})` →
`{html, bytes, report}` like resume; report adds `variants`, `features` (FEATURE_ORDER order), `requests` (names of the form, checkout and sync requests),
`products` (count), `uiKeys` count. Head: per-language title/description (rtI18n switches them), `og:title`,
`og:description`, `og:type=website` (no og:image — data URIs are not allowed there), favicon `<link rel="icon">`
from meta.favicon (image data URI), `<meta name="theme-color">` from theme bg. Clean / packed / embedded source /
`extractSource` (`format === 'lp-landing'`) = resume semantics. Body end: tools/floating toolbar (when no nav tools),
cart drawer, age gate, floating chat widgets, live region, store scripts, cfg, runtime.

Export options for the packages of §16 (doc/export.js; inert when absent, so single-file exports are unchanged):
`api: { mode: 'server'|'auto', base }` (P.makeCtx → ctx.api: features api + net, cfg.api, chat transport `api`),
`assetURL(attachment) → 'assets/<file>'` (images and the favicon get the URL, no store scripts, cfg.atts carries the
URL), `files: { css, js }` (stylesheet and runtime as files; the result adds `css` / `js`). Report adds `api`.

## 11. Editor (editor.js, editor-config.js, editor-shop.js, editor-requests.js)

The editor is the shared document editor (`studio/`) configured by `LANDING_EDITOR` (editor-config.js) through the
hooks of `studio/config.js`:
- stage: `deviceStage(DEVICES)` — the canvas is the web page at device widths (desktop 1280 / laptop 1024 / tablet
  768 / phone 390, fit zoom); no page, print or appendix settings anywhere.
- palette categories §5 (`structure, content, commerce, media, layout`); REGIONS header / main / footer.
- common fields: hidden, languages, device, anchor; style fields mt, mb, pad (px), bg, color, align.
- pages (editor-pages.js, §18): page switcher in the stage bar (+ add page), Site → **Pages**, the page inspector, page
  link targets, the pages / links check before export.
- context menus (ui/contextmenu.js: right click, long press by touch / pen, Menu key, Shift+F10): blocks on the canvas
  (studio block menu + device visibility + page settings; a long press on editable text keeps the system selection),
  the page switcher (the edited page's operations, add page, all pages) and the rows of Site → Pages. The exported
  sites keep the browser's own menu.
- document tabs: **Pages**, **Theme**, **Shop** (editor-shop.js: shop settings, checkout field list), **Requests**
  (editor-requests.js: list editor, `local:` endpoints with their stored data, "Test request" — local endpoints run
  through the page runtime's own `rtReq`, server URLs are fetched from the editor; headers are public in the
  exported file), **Languages**, **Output**, **SEO** (meta incl. ogImage / favicon via `metaAttKeys`).
- field control `req` (select of doc.requests); item field `sku` (unique per document, fixed on insert / copy by
  `onNewBlock` / `onCopy` / `onNewItem`); block menu: device visibility; status items: sections / products; link
  targets: anchors, `#top`, `#cart`, `#lang=<code>`.
- `.landing.json` project files; template gallery (`templates.js`); export dialog with the tree-shaking report;
  preview overlay at device widths.
- export packages (`ED.exportModes`, editor-export.js, §16): single file (option: also as 404.html), static archive
  (options: separate CSS / JS files, virtual pages), backend archive, backend + static; `ED.exportCheck` before every download: parts that need configuration → Configure (selects the block, opens
  Site → Requests with its request / Site → Shop) / Export without these blocks (a pruned copy; the project keeps them)
  / Cancel, then external services and (backend packages) the server's endpoints and data → Continue / Cancel. Common
  field `source` ("Managed in backend as", list blocks only). Strings: i18n-backend.js. Editor UI languages en, ru, uk, de, fr, es, ka (studio strings + i18n-<lang>.js
  + i18n-blocks.js for block / field / option / preset labels).

## 12. server.js

`landing-studio/server.js` starts the repository's development server (`../server.js`) with the mock JSON
API, so configured requests with server URLs can be tried during development (`local:` endpoints need no server):
`GET /api/<key…>` → stored document (or `{updatedAt:0}`), `PUT` → store, `POST` → store or append,
`POST /api/_down` / `_up` → simulate an outage (503), `GET /api/_log` → last 50 requests; CORS `*`, JSON bodies up
to 256 KB. Published pages need no server at all.

## 13. Design tokens & shared classes (for every block author)

Vars set on `.lp-root` by varsCSS: `--lp-accent --lp-accent2 --lp-on-accent --lp-on-accent2 --lp-bg --lp-surface
--lp-text --lp-muted --lp-border --lp-tint --lp-tint2 --lp-radius --lp-radius-s --lp-font --lp-font-h --lp-fs
--lp-lh --lp-w --lp-gap (24px) --lp-sec (section padding block) --lp-shadow --lp-shadow-lg --lp-vh --lp-ease`.
Tones `.lp-tone-dark|muted|accent|light` redefine bg/surface/text/muted/border/tint/on-accent locally.

CSS_BASE (always): `.lp-root`, `.lp-wrap` (container, gutter 20px phone / 32px), `.lp-solo` (padding for loose
top-level blocks), `.lp-b` (vertical rhythm via `--lp-mt/--lp-mb`), `.lp-rich` (p, ul/ol, a, strong, blockquote,
code, h3/h4, hr, img, `.lp-i1..4`), `.lp-eyebrow`, `.lp-h` `.lp-h1..4` (type scale with `--lp-font-h`, clamp+cqi),
`.lp-lead`, `.lp-btn` `.lp-btn-primary|secondary|ghost` `.lp-btn-sm|lg` (shape via root `.lp-btn-solid|pill|square|outline`),
`.lp-btns` (+`-center|-right`), `.lp-ic`, `.lp-sr`, `.lp-js-only` rule, `.lp-muted`, `.lp-dev-desktop|mobile`,
`.lp-rv` (+`.lp-in`, only under `html.lp-reveal`), `.lp-a-left|center|right`, `.lp-totop`, `:focus-visible` ring.

CSS_SHARED chunks (via BLOCK_DEPS):
| chunk | classes |
|---|---|
| grid | `.lp-grid` (`--lp-cols` n → 2 under 900px → 1 under 600px; `--lp-ggap`) |
| card | `.lp-card` (surface, border, radius, 24px padding), `.lp-card-hover` |
| media | `.lp-media` ratio box (`--lp-ratio` default 4/3, img cover via `--lp-fit`), `.lp-media-round`, `.lp-ph` (edit-mode empty media: tinted box + icon) |
| chip | `.lp-chip`, `.lp-badge` |
| icbox | `.lp-icbox` (48px tinted rounded square with icon) |
| price | `.lp-price` (`.lp-price-now`, `.lp-price-old`, `.lp-price-unit`, `.lp-price-req`) |
| qty | `.lp-qty` stepper |
| kv | `.lp-kv` (`<dl>` rows) |
| form | `.lp-form`, `.lp-field` (+`-half`), `.lp-label`, `.lp-input`, `.lp-check`, `.lp-err`, `.lp-form-result[data-state=ok|err|queued]` |
| dlg | `.lp-dlg` modal shell (backdrop, panel, `.lp-dlg-x`) — lightbox / player (the cart drawer is runtime CSS: `CSS_FEAT.cart`) |
| att | resume attachment card / buttons / `<object>` box → `.lp-att*` |

Quality bar: contemporary landing design — generous whitespace, strong type scale, subtle shadows, hover/focus
states, AA contrast, `prefers-reduced-motion`; every block looks right in all 6 presets, light & dark, at 1280 /
768 / 390 px, with long Georgian/Russian/German words (`overflow-wrap:anywhere` where needed; reduce letter-spacing
and avoid uppercase transforms for `:lang(ka)` like the resume's kaNoCapsCSS).

## 14. Viewer helper API

Engine helpers (`doc/render.js`, `doc/attach.js`, `doc/model.js`, `doc/schema.js`, `doc/table.js`, `html/`,
`i18n/`, `util/`) keep the resume names and semantics: `fld txt ui icon grp di noItems addItemBox has plainIn plainOf
altAttr links resolveHref renderVal breakable renderList feature needUi hrefAttr`, `attOf isImage attSrc hasData
previewKind mimeBase kindIcon formatSize fileTypeLabel`, `optList numOpts ALIGN3 emptyCell`, `escapeHTML escapeAttr
pickText uiText num oneOf str bool own uid`.

Landing helpers (names fixed, called across modules):
- viewer-render.js: `mediaBox(ctx, attId, o)`, `buttonsHTML(ctx, b, key, o)`, `objectHTML(ctx, a, o)`,
  `attCardHTML(ctx, a, o)`, `navTools(ctx)`, `renderToolbar(ctx, use)`, `contactHref`, `renderRoot`, `finishUsage`.
- viewer-blocks-b.js: `formFieldsHTML(ctx, fields, o)` (form block + checkout form).
- viewer-blocks-c.js: `priceHTML`, `buyHTML`, `collectProducts(doc)`, `formatPrice(n, cur, lang)`,
  `formatDay(ymd, lang, doc)`.
- viewer-runtime.js: `renderCartDrawer(ctx)`, `renderAgeGate(ctx)`, `FEATURE_UI`, `FEATURE_UI_QUOTE`.

## 15. Modules of this folder

| module | contents |
|---|---|
| `viewer.js` | registers the product with the engine (`defineProduct`: blocks, themes, icons, dictionaries, CSS, runtime, hooks); re-exports the API of the editor and templates |
| `viewer-base.js` | constants: version, UI languages, REGIONS, DEVICES, CURRENCIES, REQ_METHODS, contact kinds |
| `viewer-model.js` | document shape and normalization (`newDoc`, `normalizeTop`, common props, requests, SKUs, form keys) |
| `viewer-render.js` | page skeleton, block wrapper hooks, landing helpers (§14), usage → runtime features |
| `viewer-blocks-a.js` / `-b.js` / `-c.js` | block types with their CSS chunks, variants, dependencies, theme rule owners and viewer strings |
| `viewer-design.js` | design tokens, shared CSS chunks, tools, edit CSS, dark scheme, print, base themes (`clean`, `noir`), `buildCSS` |
| `viewer-theme-<key>.js` | the template themes: supra, kvevri, forge, harvest, counsel, shore, folio, quire, nocturne |
| `viewer-runtime.js` | runtime features (`rt*`, serialized with `Function.prototype.toString`), feature CSS and strings, cart drawer and age gate markup |
| `viewer-blocks-collection.js` | the collection block (registry incl. the legacy `works` alias, CSS chunks, viewer strings `col.*` / `rd.*`, icons) |
| `viewer-runtime-collection.js` | features `collection` and `reader` (`rtCollection`, `rtReader`) and their CSS |
| `viewer-migrate.js` | document migrations run by `normalizeTop` (works → collection) |
| `viewer-pages.js`, `viewer-runtime-pages.js` | pages (§18): the page type, normalization of old documents, the route table, URLs per export mode, nav page links, the main region of every render mode, titles, router configuration, the default "Not found" page; the router (feature pages) and the head script of path-routed pages |
| `viewer-blocks-d.js`, `viewer-runtime-d.js` | part D blocks (carousel, tabs, compare, beforeafter, announce, countdown, video) and their features (+ counter, marquee) |
| `viewer-blocks-portal.js`, `i18n-portal.js`, `e2e-portal.js` | portal blocks (§19): registry from `../portal/models.js`, the view adapter, CSS and runtime registration; their editor labels; the e2e scenario |
| `editor-pages.js`, `i18n-pages.js`, `i18n-blocks-d.js` | the pages in the editor and their strings; editor labels of the part D blocks |
| `editor-collection.js`, `i18n-collection.js` | collection inspector controls (`kvlist`, `filelist`, `clkeys`) and their editor strings |
| `viewer-export.js` | export hooks: head, body end, cfg JSON, report |
| `viewer-blocks-chat.js`, `viewer-runtime-chat.js` | the chat block (registry, markup, CSS, viewer strings) and feature `chat` (§17) |
| `viewer-backend.js`, `viewer-runtime-backend.js` | backend exports on the view side (`api` option → ctx.api, cfg.api, `source` bindings) and features `api` / `assets` |
| `backend-site.js` | plan of a page's data paths per package (`planBackend`), site files (`buildSite`), collection snapshots, README (browser and Node) |
| `backend-archive.js` | the files of an archive (`archiveFiles`) and the server launcher |
| `backend-server.js`, `backend-admin.js`, `backend-engine.js` | the generated server, the admin console, the entry of `lib/site.mjs` (bundled with `?bundle`) |
| `editor-export.js`, `i18n-backend.js` | export packages and the check before export; their editor strings (+ chat block labels) |
| `viewer-dict.js`, `viewer-icons.js` | exported-page strings, icons |
| `editor.js`, `editor-config.js`, `editor-shop.js`, `editor-requests.js`, `editor.css` | the editor configuration (§11) |
| `i18n-<lang>.js`, `i18n-blocks.js` | editor strings |
| `templates.js`, `templates-kit.js`, `templates-art.js`, `templates-<id>.js` | gallery order, shared template kit, data-driven artwork kit (isometric scenes, figures, maps, wordmarks), the templates: dance, winery, industry (metallurgy), agro, legal, realty, library, books, audio, portal (legal portal), blank |
| `index.html`, `server.js`, `README.md` | editor page, development server, documentation |

## 16. Export packages and the generated backend

The export dialog (§11) offers four packages; the page inside each is rendered by the same engine call
(`buildSite` → `exportHTML`), so a package never looks different from the single file.

| package | contents | requests to `local:<c>[/<key>]` |
|---|---|---|
| single file (`html`) | one HTML file with every page (hash routes); option `as404`: the same file also serves as 404.html (§18) | answered from the visitor's browser storage; no network API unless a request targets a server |
| static archive (`static`) | `index.html`, `<slug>/index.html` per page, `404.html` (router), `assets/<id>-<name>.<ext>` (attachments as files, relative URLs, feature assets), optionally `assets/site.css` / `site.js` (shared by every page); option `virtual`: only index.html + 404.html | as the single file |
| backend archive (`backend`) | `server.mjs`, `lib/site.mjs`, `public/` (the site), `data/site.json`, `data/build.json`, `README.md` | `api/<c>[/<key>]` on the same origin (`cfg.api.m = 'server'`) |
| backend + static (`hybrid`) | as backend | as backend after a successful probe of `api/_ping`; static fallback otherwise (`cfg.api.m = 'auto'`, §8 api) |

**Check before export**: first the pages and links (editor-pages.js `pageProblems`: addresses that collide or are
reserved, pages without an address, pages neither in navigation nor linked, links to missing pages / anchors / blocks
/ files and to drafts → Show / Export anyway / Cancel), then the data plan (`planBackend(doc, target)`): every rendered block with a `req` field (forms, chat, future
blocks), the checkout and cart sync become plan items with a status — `external` (an http(s) / path request),
`channel` (mailto / WhatsApp / Telegram / link with a valid address), `browser` (only `local:` endpoints in a serverless
package: the data stays in the visitor's browser), `backend` (served by the generated server), `need` (a `live` block —
the chat — without an external API in a serverless package), `lost` (no request and no usable channel). `needs` =
browser + need (serverless packages) + lost (all packages) → the Configure / Export without / Cancel question;
`external` → listed with their hosts and channels; backend packages also list `endpoints` and `collections`.

**Collections of the generated server** (derived from the same plan at every start, so the rules always match the
page): a `local:` collection posted to without a key (forms → kind `inbox`, checkout → `orders`) accepts `POST`
(append, `Idempotency-Key` = record id, `orderId` echoed); one used with a key (cart sync → `carts`) accepts
`GET / PUT / PATCH / DELETE api/<c>/<key>` (key `^[A-Za-z0-9._~-]{6,120}$`, an unguessable cart id); listing a private
collection is refused (403); unknown collections are 404. `chat` (when a chat block uses the built-in transport) and
content collections (`source` of rendered list blocks; `GET api/<c>` and the static `data/<c>.json`) complete the set.
A name used both by a request and a list block, or by list blocks of different types, is reported and left unbound.

**Server** (`backend-server.js`, Node ≥ 20 / Bun / Deno, no dependencies; built-ins come from the launcher):
static files from `public/` (no dot segments, `index.html` for folders, ETag / 304, gzip for text over 1 KB when the launcher hands
in `zlib` — as the repository's hosting.js —, `nosniff`, SVG with a script-free
CSP); pages (§18) are files prerendered by the server's engine from `data/site.json` at every build (server-side
rendering without a request-time step): `/about/` → `public/about/index.html`, variants of a page address (case,
`.html`, `/index.html`, no trailing slash) → 301 to the canonical URL, any other unknown address → the site's
`public/404.html` with status 404; `public/.pages.json` lists the generated page files so a rebuild removes the files
of deleted or renamed pages; `GET api/_ping` → `{ok:true, app:'lp-backend', v:1, chat}`; JSON bodies ≤ 64 KB, bounded depth / size / strings;
writes only from the same origin (`Origin` host = `Host`, `Sec-Fetch-Site` same-origin; no CORS headers at all);
per-address token buckets (writes 30/min, reads 600/min, chat 40/min, failed admin sign-ins 12/10 min; 429 +
Retry-After; `TRUST_PROXY=1` reads `X-Forwarded-For`); caps (20 000 records per collection, 5 000 conversations,
2 000 messages each → 507). Data: `data/collections/<c>.json` `{v, collection, records: [{id, at, data}]}` (atomic
writes: temp file + rename, mode 600, debounced 150 ms, flushed on SIGINT / SIGTERM). Private data is never written
under `public/`. Flags `--port`, `--host`, `--log`; env `PORT`, `HOST`, `ADMIN_TOKEN` (≥ 16 chars, else generated into
`data/.admin-token` and printed once), `DATA_DIR`, `TRUST_PROXY`, `LOG`.

**Admin console** (`/admin/`, backend-admin.js; English; CSP with a per-response nonce, `X-Frame-Options: DENY`):
sign-in with the token (sessionStorage; `Authorization: Bearer`, compared with `timingSafeEqual` of SHA-256 digests);
inbox of every private collection (newest first, details, delete, CSV export with formula-safe cells, JSON export);
chat conversations (visitor, language, page, unread counts) with operator replies; content collections edited with
forms generated from the block type's item schema (`itemSchema`, `itemI18nFields`, `itemRichFields`: per-language
texts with a language switch, rich text sanitized on the server before it reaches the console and again on save,
selects with the editor's labels from `build.json.labels`, numbers, switches, days / times, icons, files uploaded to
the document) — saving normalizes the document, writes `data/site.json` and regenerates `public/` (index.html,
assets, `data/<c>.json`) with the engine; Publishing: rebuild, **static snapshot** (zip of the site built as `hybrid`,
ready for Codeberg Pages / GitHub Pages), project file (`.landing.json`, reopens in the editor). A long-poll
(`api/_admin/events?rev=&wait=25`) refreshes counts and the open inbox / chat.

Admin API (`/api/_admin/…`, bearer token): `info`, `events`, `c/<c>` (GET records, `…/<id>` DELETE), `c/<c>.csv`,
`c/<c>.json`, `chat` (GET list), `chat/<conv>` (GET marks read, POST `{text, name}` reply, DELETE), `content/<c>`
(GET schema + items + attachments + icons, PUT `{items}`), `files` (POST raw body, `Content-Type` image / pdf / audio /
video / text, `X-File-Name`; ≤ 10 MB), `file/<id>`, `site.json`, `snapshot.zip`, `rebuild` (POST).

**Engine in the archive**: `lib/site.mjs` is backend-engine.js bundled by bundle.js (`new URL('./backend-engine.js?bundle',
import.meta.url)` in editor-export.js: a gzip-compressed ES module whose default export is the module namespace; the
development server answers the same URL); the server renders `public/` with exactly the editor's export code.
`data/build.json` = `{v, target, created, langs, defaultLang, minify, split, labels}`.

Static fallback (hybrid on plain hosting): content is the last build (regenerated server-side; the page does not
re-render lists client-side), forms and checkout fail with `static` → their fallback channel / outbox, the cart stays
local, the chat shows the offline note and queues left messages in its outbox (or opens the fallback channel).

## 17. Chat transports

- **External API** (`m: 'ext'`, serverless): send = the block's `sendReq` (POST), body `{site, conv, lang, page,
  visitor: {name, contact}, message: {id, text, at}}`, `Idempotency-Key` = message id; a 2xx answer may carry
  `{conv, cursor, messages}`. Poll = `pollReq` (GET) every 4 s while the panel is open and visible, 20 s otherwise
  (backoff 2/5/15/30/60 s after failures; only once a conversation exists); its answer is `{messages, cursor}` or a bare
  array. Placeholders `{conv}` (the adopted conversation id) and `{since}` (the last cursor, else the time of the
  newest message) are filled in the URL (encoded) and headers (raw) by the chat runtime itself.
  Message = `{id, from: 'operator'|'visitor'|'system', name?, text, at (ms or ISO)}`; own messages echo back by id.
- **Built-in** (`m: 'api'`): `POST api/chat` (same body) → 201 `{ok, conv, cursor, messages: [stored]}` (new
  conversations get a random 20-character id); `GET api/chat/<conv>?since=<seq>&wait=25` long-polls up to 25 s →
  `{messages, cursor}` (404 for an unknown conversation: the runtime starts over). Operators answer in the admin console.
- **Leave a message** (`m: 'msg'`, and `api` on static hosting): the message goes to the block's fallback — `outbox`
  (backend pages: queued, sent through `api/chat` when the server answers on a later visit) or a channel opened from the
  visitor's click (mailto / WhatsApp / Telegram with the text, Telegram after copying it).

## 18. Pages and routing

**Model** (viewer-pages.js). `regions.main` is a list of `page` blocks: `{ type:'page', id, kind:'page'|'notfound',
slug, title i18n, navLabel i18n, nav (shown in navigation), metaTitle i18n, metaDesc i18n, noindex, hidden (a draft:
not exported, links to it are dropped), blocks: [...] }`. Registry flags: `container`, `transparent` (the page's
children are top-level blocks: depth, full-bleed wrapping and region rules as before), `topLevel` (only in
regions.main), `palette:false`. The header and footer regions are shared by every page.
- Slugs: 1..4 lowercase segments `[a-z0-9-]` (`about`, `services/legal`); normalization turns titles, `.html`
  endings, case and slashes into a slug; reserved first segments `assets api admin data lib 404 index public server`
  get `-page`; duplicates are numbered; the **home page** is the first visible regular page (URL `''` whatever its
  slug). At most one `notfound` page (no slug, never in navigation, always `noindex`).
- Old documents (`regions.main` with loose blocks) are migrated by `normalizeTop`: blocks before the first page form
  the home page, later loose blocks join the page in front of them. `siteRoutes(doc)` = { legacy, pages, list
  (visible regular pages: id, slug, home, nav), home, nf, byId, bySlug, navList }; a document that is still legacy
  (not normalized) renders exactly like before.
- `output.basePath`: the site's path on its host (`/repo/`, normalized by `normBase`; `''` = detect at runtime).

**Links.** Canonical forms in the document: `#/<slug>[#<anchor>]` (a page; `#/` = home), `#b-<page id>` (a page by
id), `#<anchor>` (anchors are unique site-wide, so an anchor alone also names its page). P.routeHref / P.placeHref
(doc/render.js resolveHref) map them per render mode; links to missing or draft pages are dropped like dead anchors.
Renaming a slug in the editor rewrites `#/old…` links of the document (`remapRoutes`).

**Render modes** (`ctx.route.mode`; one viewer and one runtime for all):

| mode | used by | markup | page URLs |
|---|---|---|---|
| `edit` | editor canvas | the edited page only (`<main data-list="<page id>:blocks">`) | nav page links switch the edited page |
| `hash` | single file (`html`), also on `file://` | one page: as before (no router); 2+ pages: every page as `<main class="lp-main" data-lp-page="<slug>" id="/<slug>">` (home shown, the rest `hidden`) + the "Not found" page `data-lp-page="404"` | `#/<slug>`, anchors `#<anchor>` |
| `file` | `index.html`, `<slug>/index.html` of the archives and the backend | the page of the file (prerendered: works without JS); the first planning pass sees every page so links and anchors of other pages resolve | relative: `../../about/`, `./`, `../#team`; same page `#anchor` |
| `spa` | `404.html` of the archives / backend, `index.html` of virtual archives (`index:true`) | every page + "Not found" (404.html opens on "Not found", the index on home) | path routes under the base path: `about/` against `<base href>` |

The single file with the `as404` option is `hash` mode plus the head script (`cfg.pg.m = 'a'`): on http(s) it routes
by path when the base path is certain, else by hash, so one file works as index.html, as 404.html and from disk.
Exports of documents without a "Not found" page use a default one (`notFoundPage`, viewer strings `nfCode nfTitle
nfText nfHome` in the 7 languages, fixed ids `lpnf…`). Page titles: the page's meta title, else `<page> — <site>`
(home: the site title); descriptions: the meta description, else the site's; `noindex` pages and every 404.html carry
`<meta name="robots" content="noindex">`. A site that sells on any page shows its cart on every page.

**Router** (feature `pages`, viewer-runtime-pages.js; `cfg.pg = { m:'h'|'p'|'a', b: base, r: [{s, t:{lang:title},
d:{lang:desc}, x:noindex}] }`).
- Head script (`spa` and `as404`, first in `<head>`): finds the base path and the route of `location.pathname` before
  the body is parsed and shows that page through `#lp-route-css` (no flash of another page). Base: the configured one
  when the path starts with it; else the shortest prefix whose rest names a page (case-insensitive; `.html`,
  `index.html` and trailing-slash variants); else the base of a same-site `document.referrer` page (a broken link
  inside the site) — these are certain (`data-lp-base-sure`); otherwise a guess: `/<first segment>/` on github.io /
  codeberg.page / gitlab.io for paths of two segments or more, else `/`. Writes `<html data-lp-base data-lp-route>`
  and (`spa`) inserts `<base href="<base>">` so relative assets and links resolve from the site root.
- Runtime: shows one page at a time; follows page links (`history.pushState`; a variant URL is replaced by the
  canonical one: `/repo/About.html` → `/repo/about/`), back / forward (popstate / hashchange); keeps the title,
  description and robots meta of the current page in the current language (also after a language switch);
  `aria-current="page"` on nav links (`data-lp-pg`); moves focus to the new `<main>` and announces its title; scrolls
  to the top or to the linked anchor (instant after a page change, smooth within a page unless prefers-reduced-motion);
  an anchor of another page opens that page first; unknown routes show "Not found".
- No JS: page links of the single file are `#/<slug>` fragments and CSS shows the `:target` page
  (`html:not(.lp-route) .lp-root>.lp-main[data-lp-page]:is(:target,:has(:target))`), so every page and anchor stays
  reachable; files of the archives are plain pages; 404.html shows "Not found" (the head script needs JS).

**Deployment per mode.**

| package | files | unknown address | page address variants |
|---|---|---|---|
| single file | `<name>.html` | — (hash routes; an unknown `#/x` → "Not found") | — |
| single file as 404.html | the same file uploaded as `index.html` and `404.html` | the host serves 404.html → the matching page or "Not found" | resolved by the head script |
| static archive | `index.html`, `<slug>/index.html`, `404.html`, `assets/…` | 404.html (Codeberg / GitHub Pages: automatic; elsewhere: configure the error page) | 404.html → the page, URL canonicalized |
| static, virtual pages | `index.html`, `404.html` | 404.html renders the page client-side (the HTTP status stays 404) | as above |
| backend / hybrid | `public/` = the static archive, rebuilt by the server (§16) | `public/404.html` with status 404 | 301 to the canonical URL |

**Editor** (editor-pages.js; strings i18n-pages.js): the page switcher in the stage bar (pages, the "Not found" page,
+ add page; nav page links on the canvas switch pages too), Site → **Pages** (add, duplicate, rename, address, move
up / down, make home, show in navigation, draft, delete, add "Not found" with the default content, site path), the
page inspector (title, address with validation — format, reserved, taken — navigation label, SEO title / description,
noindex), the outline and insert positions of the edited page, link fields with a picker (pages, then the sections /
anchors on each page), the check before export (`pageProblems`: colliding or reserved addresses, empty addresses,
pages not reachable from navigation or links, links to missing pages / anchors / blocks / files or to drafts), context
menus with the page operations on the page switcher and the page list. Every page operation is one commit (undo / redo).

## 19. Portal blocks

The blocks `act`, `terms`, `directory`, `board`, `hub`, `checklist`, `finder` (category `portal`) are the shared library
[../portal/](../portal/README.md) seen through `viewer-blocks-portal.js`; the knowledge-base builder uses the same
library. Nothing about them is landing-specific except the adapter:

- **Registry**: converted from `PT_BLOCKS` (portal/models.js): `text` → `i18n`, `long` → multi-line `i18n`, `code` /
  `link` → `text` (links with `suggest: 'anchors'`), `day`, `number` (nullable without a default), `checkbox`,
  `select` (labels `pt.o.<key>.<value>`), `image` / `file` → `att`. Labels `pt.f.*`, hints `pt.fh.*`, palette names
  `b.*` / `bd.*`, category `c.portal` come from `portal/strings-editor.js` (i18n-portal.js). Every list type has items
  (`itemSchema`, `itemI18nFields`) and can be a managed collection (`source`) except `hub` / `finder` (`noSource`).
  Edit mode: an empty list shows the add-item box; one-line fields are editable on the canvas, the rest in the
  inspector; no runtime.
- **Rendering**: `PT_RENDER[type](block, V)`; the adapter maps texts to per-language groups (`grp`; markup that
  contains blocks is grouped in `div`s), UI strings to `ui()` / `uiText`, attribute texts to `data-lp-i18n`, links
  through `resolveHref`, pictures to attachments (`attSrc`, `data-att-img`), the act's file to `attCardHTML`
  (download / open, feature embed), dates to `formatDay`. The **catalog** (`ptCatalog(ctx)`, cached on ctx) holds every
  rendered portal block of the site; an anchor of another page is placed with `P.placeHref`, so links work in every
  render mode (§18). Anchors are ASCII and site-wide unique: `<key>-a<n>[-p<n>[-<letter>]]` (articles, paragraphs,
  subparagraphs), `<key>-c<n>` (chapters), `t-<term>`, `pr-<name>`, `rq-<title>`, `ck-<label>`, `az-<block id>-<letter>`.
- **Language**: the alphabet index, facet option identities and sort keys follow the main (default) language; facet
  labels and sort option texts switch with the page language (`data-pt-l`, relabelled by the runtime).
- **CSS**: `CSS_SHARED['pt-<chunk>']` (portal/css.js with the prefix `lp`), `BLOCK_DEPS[type]` lists the chunks of the
  type (+ `att` for the act); the `pt-base` chunk starts with the token rule `.lp-pt{--pt-accent:var(--lp-accent);…;
  --pt-top:var(--lp-navh,0px)}` evaluated on each block, so section tones apply.
- **Runtime**: features `ptbase pttoc pttips ptlist ptfind ptcheck` after the landing ones (deps `core` + `ptbase`),
  recorded by the builders (`V.feature`); runtime strings through `needUi` (cfg.ui). They use only `data-pt-*`
  attributes. Storage: checklist ticks under `pt-ck:<block id>:<docId>` (R.store).
- **Template** `portal` (templates-portal.js): Kanoni Commons, en / ka / ru, all content fictional.
