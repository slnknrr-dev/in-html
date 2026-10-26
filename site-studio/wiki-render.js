// site-studio/wiki-render.js - rendering of a published knowledge base ("site", built by site.js) into HTML strings:
// articles (versions, layers, table of contents, references, categories, breadcrumbs), virtual pages (category,
// search results, all pages, recent changes, categories, what links here, unlock, not found) and the page shell.
// Node and browsers: the reader renders with it on every navigation, exports and the backend prerender with it.
//
//   const R = createRenderer(site, { href, mediaSrc, t, editor, unlocked })
//     href(route)      URL of a route object { path, query, frag } in the current mode
//     mediaSrc(id)     URL of a media item ('' when unknown)
//     t(key, vars)     reader strings (strings-reader.js)
//     editor           mark blocks with data-bid (editor preview)
//     unlocked         Map(route -> page) of decrypted 451 pages (pages carry `secret: true`)
//   R.resolveRoute(path)       { kind: 'page' | 'redirect' | 'category' | 'special' | 'missing', page?, … }
//   R.article(page, { version, variants, variant, redirectedFrom }) -> { html, title, layers, versions, version, headings }
//   R.special(kind, arg, data) -> { html, title }       R.shell(mainHTML, { route }) -> body HTML
//   R.preview(path) -> { title, text, img } | null        R.backlinks(slug) -> [page]
//   R.findPage(target) -> page | null (slug, title, slugified title)    R.pages (public, listed and unlisted)
import { escapeAttr as attr, escapeHTML as esc } from '../html/escape.js';
import { parseQuery, slugify } from '../spa/route.js';
import { BLOCKS, imgHTML } from './wiki-blocks.js';
import { htmlToText, plainText, renderBlocks, renderInline, scanLinks } from './wiki-markup.js';
import { eachMarkup } from './wiki-model.js';
import { PORTAL_TYPES, portalLinker } from './wiki-blocks-portal.js';
import { buildCatalog } from '../portal/catalog.js';
import { RESULT_TYPES, searchIndex } from '../portal/search.js';
import { termKey } from '../portal/glossary.js';

// Design rules:
// - One renderer for all outputs (reader, prerender, servers, editor preview): the mode differs only in href() and
// mediaSrc() injected by the caller, so a page looks identical however it is served.
// - Single pass over blocks with late-bound placeholders: the TOC and reference lists depend on headings and refs
// found DURING rendering, so the renderer emits MARK-delimited markers (U+0002, distinct from markup.js's U+0001)
// and replaces them after the body is complete. Two full passes would double the cost.
// - Lookup maps are built once per renderer (one per site build), not per call; preview text and backlinks are
// memoised lazily because most pages never need them.
const MARK = '\u0002';
// Blocks whose text gets glossary and article links (portalLinker).
const LINKED_TYPES = new Set(['text', 'quote', 'callout', 'details', 'timeline', 'banner']);

export const ICONS = {
  search: '<path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  scheme: '<path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z"/>',
  random: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  clock: '<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01"/>',
  lock: '<path d="M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4"/>',
  links: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  home: '<path d="M3 11 12 3l9 8M5 9.5V21h14V9.5"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7zM2 17l10 5 10-5M2 12l10 5 10-5"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  top: '<path d="M12 19V5M5 12l7-7 7 7"/>',
};
// Inline SVG, aria-hidden + focusable=false (old IE/Edge made SVGs tabbable): icons are decoration; labels carry the meaning.
export const icon = (n, cls = 'kp-i') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[n] || ''}</svg>`;

// Partial dates (YYYY, YYYY-MM) are formatted at their precision; month/day default to 1 only to build a Date.
// UTC on both ends: a calendar date must not shift by the reader's time zone.
const dateOf = (d, lang) => {
  if (!d) return '';
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/.exec(d);
  if (!m) return d;
  try {
    const dt = new Date(Date.UTC(+m[1], m[2] ? +m[2] - 1 : 0, m[3] ? +m[3] : 1));
    const o = m[3] ? { year: 'numeric', month: 'long', day: 'numeric' } : m[2] ? { year: 'numeric', month: 'long' } : { year: 'numeric' };
    return new Intl.DateTimeFormat(lang, { ...o, timeZone: 'UTC' }).format(dt);
  } catch { return d; }
};

export function createRenderer(site, opts = {}) {
  const t = opts.t || ((k) => k);
  const href = opts.href || ((r) => '#/' + (typeof r === 'string' ? r : r.path));
  const unlocked = opts.unlocked || new Map();
  const pages = site.pages || [];
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  // findPage accepts slugs, titles (case-insensitive) and slugified titles, because authors write [[Bhakti yoga]] as
  // often as [[bhakti-yoga]]. Slugified-title keys are prefixed with U+0000 so they live in the same map without ever
  // colliding with a real lower-cased title. First page wins on duplicates (stable with source order).
  const byTitle = new Map();
  for (const p of pages) {
    const k = (p.title || '').toLowerCase();
    if (k && !byTitle.has(k)) byTitle.set(k, p);
    const s = slugify(p.title || '');
    if (!bySlug.has(s) && !byTitle.has('\u0000' + s)) byTitle.set('\u0000' + s, p);
  }
  const homeSlug = site.home || '';
  // The home page's canonical route is '' (the site root), never its slug: one URL per page.
  const routeOfPage = (p) => (p.slug === homeSlug && !p.secret ? '' : p.slug);
  const cats = new Map((site.cats || []).map((c) => [c.slug, c]));
  const layerMap = new Map((site.layers || []).map((l) => [l.id, l]));

  // Unlocked 451 pages are checked first by exact route and last by slug, so a secret page never shadows a public one on a fuzzy match.
  function findPage(target) {
    const s = String(target || '').trim();
    if (!s) return null;
    if (unlocked.has(s)) return unlocked.get(s);
    const clean = s.replace(/^\/+|\/+$/g, '');
    return bySlug.get(clean) || byTitle.get(s.toLowerCase()) || bySlug.get(slugify(clean, { slash: true })) || byTitle.get('\u0000' + slugify(clean)) ||
      unlocked.get(slugify(clean, { slash: true })) || null;
  }

  // Accepts both the compact site form (t, n, s, cr) and the editor's model form (type, name, size, credit): the editor preview renders from the model without building a site first.
  function mediaInfo(id) {
    const m = (site.media || {})[id] || (opts.extraMedia && opts.extraMedia(id));
    if (!m) return null;
    const src = opts.mediaSrc ? opts.mediaSrc(id) : '';
    return { src, type: m.t || m.type || 'application/octet-stream', name: m.n || m.name || id, size: m.s || m.size || 0, w: m.w || 0, h: m.h || 0, alt: m.alt || '', credit: m.cr || m.credit || '' };
  }

  // Internal / external link of a wiki target.
  // Returns a link descriptor, not HTML: markup.js and blocks.js build the tag, so escaping stays in one place.
  // Fragments are slugified like heading ids (so [[Page#Some Section]] hits id="some-section"), except cite- anchors
  // which are already ids. Missing pages still get a URL (the slugified name) and the class kp-new: like a red link
  // in MediaWiki, it shows the gap instead of hiding it, and the reader shows a "page does not exist" hint.
  function link(target, frag = '') {
    const tg = String(target || '').trim();
    const f = frag ? (/^cite-/.test(frag) ? frag : slugify(frag)) : '';
    if (!tg) return { href: f ? '#' + encodeURIComponent(f) : '#', cls: 'kp-link', title: frag || '' };
    const low = tg.toLowerCase();
    if (low.startsWith('category:')) {
      const slug = slugify(tg.slice(9), { slash: true });
      const c = cats.get(slug);
      return { href: href({ path: 'category/' + slug, query: {}, frag: f }), route: 'category/' + slug, cls: 'kp-link kp-catlink', title: c ? c.name : tg.slice(9) };
    }
    if (low.startsWith('special:')) {
      const name = slugify(tg.slice(8), { slash: true });
      return { href: href({ path: 'special/' + name, query: {}, frag: '' }), cls: 'kp-link kp-special', title: t('r.special.' + name.split('/')[0]) };
    }
    if (low.startsWith('media:')) {
      const m = mediaInfo(tg.slice(6).trim());
      return m ? { href: m.src, cls: 'kp-link kp-medialink', title: m.name, download: m.name } : { href: '#', cls: 'kp-link kp-new', title: tg.slice(6) };
    }
    // 'page?v=simple' links to a version (any query is kept).
    const qi = tg.indexOf('?');
    const query = qi >= 0 ? parseQuery(tg.slice(qi + 1)) : {};
    const name = qi >= 0 ? tg.slice(0, qi) : tg;
    const p = findPage(name);
    if (p) {
      const route = routeOfPage(p);
      return { href: href({ path: route, query, frag: f }), route, cls: 'kp-link' + (p.secret ? ' kp-secret-link' : ''), title: p.title || p.slug, exists: true };
    }
    const route = slugify(name, { slash: true });
    return { href: href({ path: route, query, frag: f }), route, cls: 'kp-link kp-new', title: name, hint: t('r.missingPage', { title: name }), exists: false };
  }

  // A link field value: '[[target#frag|label]]', 'target', or an external URL.
  // Link fields accept three spellings; external URLs pass the same allow-list as markup.js isSafeExt (scheme + no whitespace/quotes/brackets).
  function resolve(v) {
    const s = String(v || '').trim();
    if (!s) return null;
    if (/^(https?:\/\/|mailto:|tel:)/i.test(s)) return /[\s<>"]/.test(s) ? null : { href: s, ext: true, title: s.replace(/^https?:\/\//, ''), cls: 'kp-ext' };
    const m = /^\[\[([^\]|]*)(?:\|([^\]]*))?\]\]$/.exec(s);
    const inner = m ? m[1] : s;
    const h = inner.indexOf('#');
    const L = link(h >= 0 ? inner.slice(0, h) : inner, h >= 0 ? inner.slice(h + 1) : '');
    if (m && m[2]) L.title = m[2];
    return L;
  }

  // Hover-card data. Source order: the explicit summary, else the first real paragraph of the first visible text
  // block (headings, quotes and list items skipped: they make poor teasers), cut at 320 chars on a word boundary.
  // Image: the first image-bearing block, else the page image. Memoised on the page object (p.pv); safe because
  // a renderer lives for one immutable site build.
  function preview(path) {
    const p = path === '' ? bySlug.get(homeSlug) : bySlug.get(path) || unlocked.get(path);
    if (!p || p.kind === 'redirect') return null;
    let text = p.pv && p.pv.s;
    let img = p.pv && p.pv.i;
    if (text == null) {
      const pc = { link, media: mediaInfo, t };
      text = p.summary ? plainText(p.summary, pc) : '';
      const v = (p.versions || [])[0];
      if (!text && v) {
        for (const b of v.blocks || []) {
          if (b.off || b.layer) continue;
          if (b.type === 'text' && b.text) { text = plainText(b.text.split(/\n\s*\n/).find((x) => x.trim() && !/^(#|>|-|\*|\d+\.)\s/.test(x.trim())) || '', pc); if (text) break; }
        }
      }
      if (text.length > 320) text = text.slice(0, 320).replace(/\s+\S*$/, '') + '…';
      if (!img && v) {
        for (const b of v.blocks || []) {
          const id = b.type === 'infobox' ? b.image : b.type === 'media' || b.type === 'banner' || b.type === 'diagram' ? b.media : '';
          const m = id && mediaInfo(id);
          if (m && m.type.startsWith('image/')) { img = id; break; }
        }
      }
      if (!img && p.image) img = p.image;
      p.pv = { s: text, i: img || '' };
    }
    const m = img ? mediaInfo(img) : null;
    return { title: p.title || p.slug, text, img: m && m.type.startsWith('image/') ? m : null, secret: !!p.secret };
  }

  let blMap = null;
  // Built once for all pages on first use: O(total markup). Redirects count as linking to their target. Links to
  // secret pages are never recorded: a public "what links here" must not reveal that a hidden page exists.
  function backlinks(slug) {
    if (!blMap) {
      blMap = new Map();
      for (const p of pages) {
        if (p.kind === 'redirect') { const tp = findPage(String(p.target).split('#')[0]); if (tp) (blMap.get(tp.slug) || blMap.set(tp.slug, new Set()).get(tp.slug)).add(p.slug); continue; }
        for (const v of p.versions || []) {
          eachMarkup(v.blocks, (text) => {
            for (const tg of scanLinks(text)) {
              const q = findPage(tg);
              if (q && q.slug !== p.slug && !q.secret) (blMap.get(q.slug) || blMap.set(q.slug, new Set()).get(q.slug)).add(p.slug);
            }
          });
        }
      }
    }
    return [...(blMap.get(slug) || [])].map((s) => bySlug.get(s)).filter(Boolean).sort((a, b) => (a.title || '').localeCompare(b.title || '', site.lang));
  }

  const pageLink = (p, text) => {
    const route = routeOfPage(p);
    return `<a class="kp-link" href="${attr(href({ path: route, query: {}, frag: '' }))}" data-kp-route="${attr(route)}">${text != null ? text : esc(p.title || p.slug)}</a>`;
  };

  const listed = () => pages.filter((p) => !p.hidden && p.kind !== 'redirect');
  const byTitleSort = (a, b) => (a.title || '').localeCompare(b.title || '', site.lang);

  // 'links' keeps the author's order and 'recent' its own date order; other sources sort by the chosen key with title
  // as tie-breaker (deterministic output). The current page is excluded: a list of "related pages" containing itself
  // is noise. Card and list styles read summaries through preview(), so its memo pays off on index pages.
  function pageListHTML(b, cur) {
    let list = [];
    if (b.source === 'children') list = listed().filter((p) => p.parent === (cur && cur.slug));
    else if (b.source === 'category') list = listed().filter((p) => (p.cats || []).includes(slugify(b.category || '', { slash: true })));
    else if (b.source === 'recent') list = listed().slice().sort((x, y) => (y.date || y.updated || '').localeCompare(x.date || x.updated || ''));
    else if (b.source === 'all') list = listed();
    else list = (b.links || []).map((it) => { const L = resolve(it.link); return L && L.exists ? findPage(it.link.replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0]) : null; }).filter(Boolean);
    if (b.source !== 'links' && b.source !== 'recent') {
      if (b.sort === 'date') list.sort((x, y) => (y.date || '').localeCompare(x.date || '') || byTitleSort(x, y));
      else if (b.sort === 'order') list.sort((x, y) => (x.order || 0) - (y.order || 0) || byTitleSort(x, y));
      else list.sort(byTitleSort);
    }
    if (cur) list = list.filter((p) => p.slug !== cur.slug);
    list = list.slice(0, b.limit || 12);
    const title = b.title ? `<div class="kp-pl-title">${renderInline(b.title, ctxBase)}</div>` : '';
    if (!list.length) return title + `<p class="kp-empty">${esc(t('r.noPages'))}</p>`;
    if (b.style === 'compact') return `<div class="kp-pl kp-pl-compact">${title}${list.map((p) => pageLink(p)).join(' · ')}</div>`;
    if (b.style === 'list' || b.style === 'columns') {
      return `<div class="kp-pl kp-pl-${b.style}">${title}<ul>${list.map((p) => {
        const pv = b.summary ? preview(routeOfPage(p)) : null;
        return `<li>${pageLink(p)}${pv && pv.text && b.style === 'list' ? ` <span class="kp-pl-sum">— ${esc(pv.text)}</span>` : ''}</li>`;
      }).join('')}</ul></div>`;
    }
    const card = (p, big) => {
      const pv = preview(routeOfPage(p)) || {};
      const route = routeOfPage(p);
      return `<a class="kp-plc${big ? ' kp-plc-big' : ''}" href="${attr(href({ path: route, query: {}, frag: '' }))}" data-kp-route="${attr(route)}">${pv.img ? `<span class="kp-plc-img">${imgHTML(pv.img, { alt: '' })}</span>` : '<span class="kp-plc-img kp-plc-noimg" aria-hidden="true"></span>'}<span class="kp-plc-body">${p.cats && p.cats[0] && cats.get(p.cats[0]) ? `<span class="kp-plc-cat">${esc(cats.get(p.cats[0]).name)}</span>` : ''}<span class="kp-plc-t">${esc(p.title)}</span>${b.summary && pv.text ? `<span class="kp-plc-s">${esc(pv.text)}</span>` : ''}${p.date ? `<span class="kp-plc-d">${esc(dateOf(p.date, site.lang))}</span>` : ''}</span></a>`;
    };
    if (b.style === 'hero') return `<div class="kp-pl kp-pl-hero">${title}${card(list[0], true)}<div class="kp-pl-cards">${list.slice(1).map((p) => card(p)).join('')}</div></div>`;
    return `<div class="kp-pl">${title}<div class="kp-pl-cards">${list.map((p) => card(p)).join('')}</div></div>`;
  }

  // Minimal context for inline markup outside articles (titles, nav, footer).
  // Context for nav, footer, titles: no refs, layers or headings there (those need an article).
  const ctxBase = { link, media: mediaInfo, t, ext: (u) => u };

  // Portal blocks (blocks-portal.js): every act, glossary, directory, board and checklist of the public pages, once.
  let portalCat = null;
  // Cross-page catalog for portal blocks (terms, acts, people...), built once per renderer from the first version of
  // every non-redirect public page, nested columns included. Only public pages: unlocked 451 content must not leak
  // into a catalog that other pages render.
  function portalCatalog() {
    if (portalCat) return portalCat;
    const sources = [];
    const visit = (list, p) => {
      for (const b of list || []) {
        if (!b || b.off) continue;
        if (PORTAL_TYPES.includes(b.type)) sources.push({ block: b, page: p.slug, href: (a) => href({ path: routeOfPage(p), query: {}, frag: a }) });
        if (b.type === 'columns') for (const col of b.cols || []) visit(col.blocks, p);
      }
    };
    for (const p of pages) if (p.kind !== 'redirect') visit(((p.versions || [])[0] || {}).blocks, p);
    const pc = { link, media: mediaInfo, t, plain: true };
    portalCat = buildCatalog(sources, {
      langs: [site.lang || 'en'], lang: site.lang || 'en',
      plain: (v) => (typeof v === 'number' ? String(v) : plainText(String(v || ''), pc)),
      raw: (v) => String(v == null ? '' : v),
      unitLabel: (k, n) => t('pt.u.' + k, { n }),
    });
    return portalCat;
  }
  // Pages of a category named like a topic (topic hubs).
  function topicPages(name) {
    const k = termKey(name);
    const slugs = (site.cats || []).filter((c) => termKey(c.name) === k || termKey(c.slug.replace(/-/g, ' ')) === k).map((c) => c.slug);
    return listed().filter((p) => (p.cats || []).some((s) => slugs.includes(s))).map((p) => ({ title: p.title || p.slug, href: href({ path: routeOfPage(p), query: {}, frag: '' }), sub: p.summary || '' }));
  }
  // Search entries of the portal blocks (the search page shows them in type tabs).
  let portalIx = null;
  const portalSearch = () => (portalIx || (portalIx = searchIndex(portalCatalog().entries(site.lang || 'en'))));

  // ids starts with the shell's own ids (kp-main, kp-toc, kp-q) so a heading titled "Main" cannot produce a duplicate
  // id and break the skip link. Headings get unique slug ids; anchor overrides from the block win.
  // TOC placement: an explicit toc block marks its position; otherwise an automatic marker is placed before the first
  // heading (Wikipedia's convention: after the lead). Only the first TOC marker is filled, the rest are removed.
  function article(page, o = {}) {
    const versions = page.versions && page.versions.length ? page.versions : [{ id: 'main', label: '', blocks: [] }];
    const version = versions.find((v) => v.id === o.version) || versions[0];
    const headings = [], ids = new Set(['kp-main', 'kp-toc', 'kp-q']), used = new Set();
    const refGroups = new Map();
    const refBlocks = [];
    let tocWanted = null, autoToc = null, uidN = 0;
    const settings = site.settings || {};
    const tocMode = page.toc && page.toc !== 'auto' ? page.toc : settings.toc || 'auto';
    const uniq = (base) => { let id = base || 'section', n = 2; while (ids.has(id)) id = base + '-' + n++; ids.add(id); return id; };
    const c = {
      t, page, rubyLayer: site.ruby || '', lang: site.lang || 'en',
      portal: portalCatalog, topicPages, anchorHref: (a) => href({ path: routeOfPage(page), query: {}, frag: a }),
      searchHref: site.settings && site.settings.search === false ? null : (q) => href({ path: 'special/search', query: { q }, frag: '' }),
      link, resolve, media: mediaInfo, href,
      inline: (s) => renderInline(s, c),
      blocks: (s) => renderBlocks(s, c),
      plainOf: (s) => plainText(s, c),
      useLayer: (id) => used.add(id),
      layerLabel: (id) => { const l = layerMap.get(id) || (page.layers || []).find((x) => x.id === id); return l ? l.label : id; },
      uid: (p) => `${p}-${++uidN}`,
      heading(text, level, anchor) {
        const html = renderInline(text, c);
        const id = uniq(anchor ? slugify(anchor) : slugify(htmlToText(renderInline(text, { ...c, plain: true })), { fallback: 'section' }));
        const lv = Math.min(4, Math.max(2, level || 2));
        headings.push({ id, level: lv, html });
        let pre = '';
        if (!autoToc && tocWanted == null && tocMode !== 'off') { autoToc = MARK + 'TOC' + MARK; pre = autoToc; }
        return { id, html: `${pre}<h${lv} id="${id}" class="kp-h">${html}</h${lv}>` };
      },
      // Footnotes like MediaWiki <ref>: a named ref reused later shares its number and gets another back-link (uses).
      // Content may be supplied on any use (the first non-empty wins). Ids are per group, so "notes" and "references" can
      // both have a [1].
      ref(html, name, group) {
        const g = refGroups.get(group) || refGroups.set(group, { list: [], names: new Map() }).get(group);
        let e = name ? g.names.get(name) : null;
        if (e) { if (html && !e.html) e.html = html; e.uses++; }
        else { e = { n: g.list.length + 1, html, uses: 1 }; g.list.push(e); if (name) g.names.set(name, e); }
        const gk = group ? slugify(group) + '-' : '';
        return `<sup class="kp-ref" id="cite-ref-${gk}${e.n}-${e.uses}"><a href="#cite-note-${gk}${e.n}" data-kp-ref="cite-note-${gk}${e.n}">[${group ? esc(group) + ' ' : ''}${e.n}]</a></sup>`;
      },
      marker(kind, b) {
        if (kind === 'toc') { tocWanted = b; return MARK + 'TOC' + MARK; }
        const i = refBlocks.push(b) - 1;
        const head = b.heading !== false ? c.heading(b.title || t('r.references'), 2).html : '';
        return head + MARK + 'REFS' + i + MARK;
      },
      renderList: (blocks) => renderList(blocks),
      pageList: (b) => pageListHTML(b, page),
    };
    // A block that throws renders an inline error box instead of killing the page: one malformed block (from an old
    // format or a bug) must not make the whole article unreadable. Portal linking applies only to prose-like blocks
    // (LINKED_TYPES); linking inside tables or infoboxes would clutter structured data.
    function renderList(blocks) {
      let out = '';
      for (const b of blocks || []) {
        const T = BLOCKS[b.type];
        if (!T || b.off) continue;
        if (b.layer) used.add(b.layer);
        let inner;
        try { inner = T.render(b, c); } catch (e) { inner = `<div class="kp-missing">${esc(String(e && e.message || e))}</div>`; }
        if (linker && LINKED_TYPES.has(b.type)) inner = linker.link(inner);
        out += `<div class="kp-b kp-b-${b.type}"${opts.editor ? ` data-bid="${b.id}"` : ''}${b.layer ? ` data-layer="${b.layer}"` : ''}>${inner}</div>`;
      }
      return out;
    }
    // Glossary terms and article references of the portal blocks are linked in the page's own texts too.
    const linker = portalLinker(c);
    let body = renderList(version.blocks);
    if (linker) body += linker.tips();
    // References: every group goes to its block (or to an automatic section at the end).
    const refList = (group) => {
      const g = refGroups.get(group);
      if (!g) return '';
      const gk = group ? slugify(group) + '-' : '';
      return `<ol class="kp-refs">${g.list.map((e) => `<li id="cite-note-${gk}${e.n}"><span class="kp-ref-back">${e.uses > 1 ? '^ ' + Array.from({ length: e.uses }, (_, k) => `<a href="#cite-ref-${gk}${e.n}-${k + 1}" aria-label="${attr(t('r.backTo'))}">${String.fromCharCode(97 + (k % 26))}</a>`).join(' ') : `<a href="#cite-ref-${gk}${e.n}-1" aria-label="${attr(t('r.backTo'))}">^</a>`}</span> <span class="kp-ref-text">${e.html || ''}</span></li>`).join('')}</ol>`;
    };
    // Groups without a references block get an automatic section at the end, so a footnote is never orphaned.
    const done = new Set();
    body = body.replace(new RegExp(MARK + 'REFS(\\d+)' + MARK, 'g'), (m, i) => {
      const b = refBlocks[+i];
      const g = b.group || '';
      done.add(g);
      return `<div class="kp-refwrap kp-refcols-${b.cols || 1}">${refList(g)}</div>`;
    });
    for (const g of refGroups.keys()) {
      if (done.has(g)) continue;
      body += c.heading(g ? t('r.notes') : t('r.references'), 2).html + `<div class="kp-refwrap">${refList(g)}</div>`;
    }
    // Table of contents.
    const depth = tocWanted ? +tocWanted.depth || 3 : 3;
    const tocHeads = headings.filter((h) => h.level <= depth);
    // TOC shows when forced on, when a toc block exists, or automatically from tocMin headings (default 3): short pages do not need one.
    const showToc = tocMode !== 'off' && (tocWanted || tocMode === 'on' || tocHeads.length >= (settings.tocMin || 3));
    let tocHTML = '';
    // Builds properly nested <ol>s from a flat heading list: open a level per step down, close per step up; jumps (h2 -> h4) open intermediate lists rather than producing invalid nesting.
    if (showToc && tocHeads.length) {
      let html = '', level = 1;
      const stack = [];
      for (const h of tocHeads) {
        const lv = h.level - 1;
        if (lv > level) { for (; level < lv; level++) { html += '<ol>'; stack.push(level); } }
        else { if (html) html += '</li>'; for (; level > lv; level--) html += '</ol></li>'; }
        html += `<li class="kp-toc-${h.level}"><a href="#${h.id}">${htmlToText(h.html) ? esc(htmlToText(h.html)) : h.id}</a>`;
      }
      if (html) html += '</li>';
      for (; level > 1; level--) html += '</ol></li>';
      const title = tocWanted && tocWanted.title ? renderInline(tocWanted.title, c) : esc(t('r.contents'));
      tocHTML = `<nav class="kp-toc${tocWanted && tocWanted.float === 'right' ? ' kp-toc-right' : ''}${settings.numbered ? ' kp-numbered' : ''}" aria-label="${attr(htmlToText(title))}"><details open><summary class="kp-toc-t">${title}</summary><ol>${html}</ol></details></nav>`;
    }
    let first = true;
    body = body.replace(new RegExp(MARK + 'TOC' + MARK, 'g'), () => {
      if (!first) return '';
      first = false;
      return tocHTML;
    });

    // Header: breadcrumbs, title, meta, versions, layers, 451 variants.
    const crumbs = [];
    if (settings.crumbs !== false) {
      const seen = new Set();
      for (let p = bySlug.get(page.parent); p && !seen.has(p.slug); p = bySlug.get(p.parent)) { seen.add(p.slug); crumbs.unshift(p); }
    }
    const titleHTML = page.display ? renderInline(page.display, c) : esc(page.title || page.slug);
    const meta = [];
    if (page.date) meta.push(`<time datetime="${attr(page.date)}">${esc(dateOf(page.date, site.lang))}</time>`);
    if (page.author) meta.push(`<span class="kp-author">${renderInline(page.author, c)}</span>`);
    const layers = [];
    // Only layers actually used on this page get a toggle; the page's own layer definitions override the base's.
    const pageLayers = new Map([...layerMap, ...(page.layers || []).map((l) => [l.id, l])]);
    for (const id of used) { const l = pageLayers.get(id); layers.push(l || { id, label: id, on: true }); }
    let bar = '';
    const variants = o.variants || [];
    if (variants.length) {
      bar += `<div class="kp-451" role="group" aria-label="${attr(t('r.variants'))}">${variants.map((v, i) => `<button type="button" class="kp-vbtn${i === (o.variant || 0) ? ' kp-on' : ''}" data-kp-variant="${i}" aria-pressed="${i === (o.variant || 0)}">${v.secret ? icon('lock', 'kp-i kp-i-s') : ''}${esc(v.label || (v.secret ? t('r.secretVersion') : t('r.publicVersion')))}</button>`).join('')}</div>`;
    }
    if (versions.length > 1) {
      bar += `<div class="kp-vers" role="group" aria-label="${attr(t('r.versions'))}"><span class="kp-bar-l">${esc(t('r.version'))}</span>${versions.map((v, i) => `<a class="kp-vbtn${v === version ? ' kp-on' : ''}" href="${attr(href({ path: routeOfPage(page), query: i ? { v: v.id } : {}, frag: '' }))}" data-kp-version="${attr(v.id)}" aria-current="${v === version ? 'true' : 'false'}">${esc(v.label || t('r.versionN', { n: i + 1 }))}</a>`).join('')}</div>`;
    }
    if (layers.length) {
      bar += `<div class="kp-layers" role="group" aria-label="${attr(t('r.layers'))}"><span class="kp-bar-l">${icon('layers')}${esc(t('r.show'))}</span>${layers.map((l) => `<button type="button" class="kp-lbtn" data-kp-layer="${attr(l.id)}" data-on="${l.on ? 1 : 0}" aria-pressed="${l.on ? 'true' : 'false'}">${esc(l.label)}</button>`).join('')}</div>`;
    }
    const catLinks = (page.cats || []).map((s) => { const cc = cats.get(s); return `<li><a class="kp-link" href="${attr(href({ path: 'category/' + s, query: {}, frag: '' }))}" data-kp-route="category/${attr(s)}">${esc(cc ? cc.name : s)}</a></li>`; }).join('');
    const kids = settings.subpages !== false ? listed().filter((p) => p.parent === page.slug).sort((a, b) => (a.order || 0) - (b.order || 0) || byTitleSort(a, b)) : [];
    const foot = [];
    if (kids.length && !page.secret) foot.push(`<div class="kp-subpages"><span>${esc(t('r.subpages'))}:</span> ${kids.map((p) => pageLink(p)).join(' · ')}</div>`);
    if (catLinks) foot.push(`<div class="kp-catlinks"><a class="kp-link" href="${attr(href({ path: 'special/categories', query: {}, frag: '' }))}">${esc(t('r.categories'))}</a>: <ul>${catLinks}</ul></div>`);
    const info = [];
    if (settings.lastEdited !== false && page.updated) info.push(esc(t('r.lastEdited', { date: dateOf(page.updated.slice(0, 10), site.lang) })));
    if (settings.backlinks !== false && !page.secret) info.push(`<a class="kp-link" href="${attr(href({ path: 'special/links/' + page.slug, query: {}, frag: '' }))}">${esc(t('r.whatLinksHere'))}</a>`);
    if (info.length) foot.push(`<div class="kp-pageinfo">${info.join(' · ')}</div>`);
    // Layers that are off by default are hidden by an inline <style> in the article, so the prerendered page shows the
    // right state before (and without) JS; the reader then toggles per layer. Ids are LAYER_RE-validated upstream, so
    // interpolating them into a selector is safe.
    const hiddenStyle = layers.filter((l) => !l.on).map((l) => `[data-layer="${l.id}"]{display:none!important}`).join('');
    const html = `<article class="kp-article kp-lay-${page.layout || 'default'}${page.secret ? ' kp-is-secret' : ''}" data-route="${attr(routeOfPage(page))}">` +
      (hiddenStyle ? `<style class="kp-layer-defaults">${hiddenStyle}</style>` : '') +
      `<header class="kp-ah">` +
      (crumbs.length ? `<nav class="kp-crumbs" aria-label="${attr(t('r.breadcrumbs'))}">${crumbs.map((p) => pageLink(p)).join('<span aria-hidden="true"> › </span>')}</nav>` : '') +
      `<h1 class="kp-title" data-spa-focus tabindex="-1">${page.secret ? `<span class="kp-451-badge" title="${attr(t('r.secretVersion'))}">451</span>` : ''}${titleHTML}</h1>` +
      `<div class="kp-from">${esc(t('r.from', { site: site.title }))}</div>` +
      (o.redirectedFrom ? `<div class="kp-redirected">${esc(t('r.redirectedFrom', { title: o.redirectedFrom }))}</div>` : '') +
      (meta.length ? `<div class="kp-meta">${meta.join('<span aria-hidden="true"> · </span>')}</div>` : '') +
      (bar ? `<div class="kp-bar">${bar}</div>` : '') +
      `</header><div class="kp-content">${body}</div>` +
      (foot.length ? `<footer class="kp-af">${foot.join('')}</footer>` : '') + '</article>';
    return { html, title: page.title || page.slug, layers, versions, version, headings };
  }

  // Virtual pages.
  // Virtual pages. Search results are computed by the caller (reader / server) and passed in data: this module does
  // not own the index. azList groups by first letter with toLocaleUpperCase(site.lang) (Turkish i, Georgian, etc.).
  function special(kind, arg = '', data = {}) {
    const wrap = (title, inner, cls = '') => ({ title, html: `<article class="kp-article kp-special ${cls}"><header class="kp-ah"><h1 class="kp-title" data-spa-focus tabindex="-1">${title}</h1></header><div class="kp-content">${inner}</div></article>` });
    const azList = (list) => {
      const groups = new Map();
      for (const p of list.slice().sort(byTitleSort)) {
        const k = ((p.title || p.slug).trim()[0] || '#').toLocaleUpperCase(site.lang);
        (groups.get(k) || groups.set(k, []).get(k)).push(p);
      }
      return `<div class="kp-az">${[...groups].map(([k, ps]) => `<section><h2 class="kp-az-h">${esc(k)}</h2><ul>${ps.map((p) => `<li>${pageLink(p)}</li>`).join('')}</ul></section>`).join('')}</div>`;
    };
    switch (kind) {
      case 'category': {
        const c = cats.get(arg);
        const members = listed().filter((p) => (p.cats || []).includes(arg));
        if (!c && !members.length) return special('missing', 'category/' + arg);
        const name = c ? c.name : arg;
        return wrap(esc(t('r.categoryTitle', { name })), (c && c.desc ? `<div class="kp-catdesc">${renderBlocks(c.desc, { ...ctxBase, heading: null })}</div>` : '') +
          `<p class="kp-count">${esc(t('r.pagesInCategory', { n: members.length }))}</p>` + azList(members), 'kp-catpage');
      }
      case 'categories': {
        const counts = new Map();
        for (const p of listed()) for (const s of p.cats || []) counts.set(s, (counts.get(s) || 0) + 1);
        const all = [...new Set([...cats.keys(), ...counts.keys()])].sort((a, b) => (cats.get(a)?.name || a).localeCompare(cats.get(b)?.name || b, site.lang));
        return wrap(esc(t('r.categories')), `<ul class="kp-catlist">${all.map((s) => `<li><a class="kp-link" href="${attr(href({ path: 'category/' + s, query: {}, frag: '' }))}" data-kp-route="category/${attr(s)}">${esc(cats.get(s)?.name || s)}</a> <span class="kp-count">(${counts.get(s) || 0})</span></li>`).join('')}</ul>`);
      }
      case 'all': return wrap(esc(t('r.special.all')), azList(listed()));
      case 'recent': {
        const list = listed().filter((p) => p.updated || p.date).sort((a, b) => (b.updated || b.date || '').localeCompare(a.updated || a.date || '')).slice(0, 100);
        let day = '', html = '';
        for (const p of list) {
          const d = (p.updated || p.date || '').slice(0, 10);
          if (d !== day) { html += (day ? '</ul>' : '') + `<h2 class="kp-day">${esc(dateOf(d, site.lang))}</h2><ul class="kp-recent">`; day = d; }
          const pv = preview(routeOfPage(p));
          html += `<li>${pageLink(p)}${pv && pv.text ? ` <span class="kp-pl-sum">— ${esc(pv.text.slice(0, 140))}${pv.text.length > 140 ? '…' : ''}</span>` : ''}</li>`;
        }
        return wrap(esc(t('r.special.recent')), html ? html + '</ul>' : `<p>${esc(t('r.noPages'))}</p>`);
      }
      case 'links': {
        const p = bySlug.get(arg);
        if (!p) return special('missing', 'special/links/' + arg);
        const list = backlinks(arg);
        return wrap(esc(t('r.linksTo', { title: p.title })), list.length ? `<ul>${list.map((q) => `<li>${pageLink(q)}</li>`).join('')}</ul>` : `<p>${esc(t('r.noLinks'))}</p>`);
      }
      case 'search': {
        const q = String(arg || '');
        const results = data.results || [];
        const form = `<form class="kp-search-big" role="search" data-kp-search><input type="search" name="q" value="${attr(q)}" aria-label="${attr(t('r.search'))}" placeholder="${attr(t('r.searchPh'))}"><button type="submit" class="kp-btn">${esc(t('r.search'))}</button></form>`;
        if (!q.trim()) return wrap(esc(t('r.search')), form);
        const exact = data.exact ? `<p class="kp-exact">${esc(t('r.goTo'))} ${pageLink(data.exact)}</p>` : '';
        // Portal entries (articles of acts, terms, people, requests, obligations) join the pages in type tabs.
        const pr = data.portal || null;
        const type = pr && pr.counts[data.type] ? data.type : pr && data.type === 'page' ? 'page' : '';
        const showPages = !type || type === 'page';
        const items = showPages ? results.map((r) => `<li><div class="kp-sr-t">${pageLink(r.page, r.titleHTML || esc(r.page.title))}</div>${r.snippet ? `<div class="kp-sr-s">${r.snippet}</div>` : ''}</li>`).join('') : '';
        let tabs = '';
        let more = '';
        let total = results.length;
        if (pr && pr.total) {
          total += pr.total;
          const tab = (tp, label, n) => `<a class="kp-pt-tab" href="${attr(href({ path: 'special/search', query: tp ? { q, type: tp } : { q }, frag: '' }))}" aria-current="${tp === type ? 'page' : 'false'}" aria-pressed="${tp === type}">${esc(label)} <span>${n}</span></a>`;
          tabs = `<div class="kp-pt kp-pt-find"><div class="kp-pt-ftabs" role="group" aria-label="${attr(t('pt.filters'))}">${tab('', t('pt.all'), total)}${results.length ? tab('page', t('pt.hub.page'), results.length) : ''}`
            + RESULT_TYPES.filter((x) => x !== 'page' && pr.counts[x]).map((x) => tab(x, t('pt.hub.' + x), pr.counts[x])).join('') + '</div>';
          if (pr.groups.length && (!type || type === 'article')) tabs += `<div class="kp-pt-fgroups"><span>${esc(t('pt.find.groups'))}:</span> ${pr.groups.map((g) => `<a data-pt-chip href="${attr(g.href || '#')}">${esc(g.label)} · ${esc(t('pt.find.inArts', { n: g.n }))}</a>`).join(' ')}</div>`;
          tabs += '</div>';
          const list = pr.results.filter((r) => !type || r.entry.type === type);
          if (list.length && type !== 'page') {
            more = `<ol class="kp-results kp-pt-fres">${list.map((r) => `<li data-pt-type="${attr(r.entry.type)}"><span data-pt-kind>${esc(t('pt.hub.' + r.entry.type))}</span><div class="kp-sr-t"><a class="kp-link" href="${attr(r.entry.href)}">${r.titleHTML}</a></div>${r.entry.sub ? `<small>${esc(r.entry.sub)}</small>` : ''}${r.snippet ? `<div class="kp-sr-s">${r.snippet}</div>` : ''}</li>`).join('')}</ol>`;
          }
        }
        const shown = type ? (type === 'page' ? results.length : pr.counts[type]) : total;
        return wrap(esc(t('r.searchResults')), form + exact + tabs + `<p class="kp-count">${esc(t('r.resultsN', { n: shown, q }))}</p>` + (items ? `<ol class="kp-results">${items}</ol>` : '') + more, 'kp-searchpage');
      }
      // autocomplete=current-password: password managers may fill a stored 451 password. The password never leaves the
      // page: the reader derives keys locally (secret.js).
      case 'unlock':
        return wrap(esc(t('r.unlockTitle')), `<form class="kp-unlock" data-kp-unlock><p>${esc(t('r.unlockHelp'))}</p><label>${esc(t('r.password'))} <input type="password" name="pw" autocomplete="current-password" required></label> <button type="submit" class="kp-btn">${esc(t('r.unlock'))}</button><p class="kp-unlock-msg" role="status"></p></form>`);
      case 'busy':
        return wrap(esc(t('r.unlocking')), `<p class="kp-busy" role="status"><span class="kp-spin" aria-hidden="true"></span> ${esc(t('r.unlockingHelp'))}</p>`);
      default: {
        const shown = arg || '';
        return { title: t('r.notFound'), html: `<article class="kp-article kp-special kp-404"><header class="kp-ah"><h1 class="kp-title" data-spa-focus tabindex="-1">${esc(t('r.notFound'))}</h1></header><div class="kp-content"><p class="kp-404-code">404</p><p>${esc(t('r.notFoundText', { page: decodeURIComponentSafe(shown) }))}</p><p><a class="kp-btn" href="${attr(href({ path: '', query: {}, frag: '' }))}">${esc(t('r.goHome'))}</a> ${site.settings && site.settings.search !== false && shown ? `<a class="kp-btn kp-btn-2" href="${attr(href({ path: 'special/search', query: { q: shown.split('/').pop().replace(/-/g, ' ') }, frag: '' }))}">${esc(t('r.searchFor', { q: shown.split('/').pop().replace(/-/g, ' ') }))}</a>` : ''}</p></div></article>` };
      }
    }
  }

  // A redirect whose target does not exist renders the redirect page itself instead of a 404: the author sees what is
  // wrong. Redirect fragments are carried so the reader can scroll to the section.
  function resolveRoute(path) {
    const p = String(path || '');
    if (p === '') { const h = bySlug.get(homeSlug); return h ? { kind: 'page', page: h } : { kind: 'missing' }; }
    if (p.startsWith('category/')) return { kind: 'category', arg: p.slice(9) };
    if (p.startsWith('special/')) { const [, name, ...rest] = p.split('/'); return { kind: 'special', name, arg: rest.join('/') }; }
    const page = bySlug.get(p) || unlocked.get(p);
    if (!page) return { kind: 'missing' };
    if (page.kind === 'redirect') {
      const tp = findPage(String(page.target).split('#')[0]);
      return tp ? { kind: 'redirect', page: tp, from: page, frag: (page.target.split('#')[1] || '') } : { kind: 'page', page };
    }
    return { kind: 'page', page };
  }

  // The page chrome. Landmarks: header, aside/nav, main (tabindex=-1 so the skip link and SPA navigation can move focus
  // to it), footer. The search form has a real action URL (the hash part stripped), so it works without JS on servers
  // and static sites; the reader intercepts it. The popover container (#kp-pop) is reused by every hover preview.
  function shell(main, { route = '' } = {}) {
    const s = site.settings || {};
    const home = href({ path: '', query: {}, frag: '' });
    const logo = site.logo ? mediaInfo(site.logo) : null;
    const nav = (site.nav || []).map((n) => {
      const L = resolve(n.link);
      if (!L) return '';
      return `<li><a class="${L.ext ? 'kp-ext' : 'kp-link'}" href="${attr(L.href)}"${L.route != null ? ` data-kp-route="${attr(L.route)}"` : ''}${L.ext ? ' rel="noopener" target="_blank"' : ''}>${esc(n.label || L.title)}</a></li>`;
    }).join('');
    const tool = (path, ic, key, extra = '') => `<li><a class="kp-tool" href="${attr(href({ path, query: {}, frag: '' }))}"${extra}>${icon(ic)}<span>${esc(t(key))}</span></a></li>`;
    const tools = [
      s.random !== false ? tool('special/random', 'random', 'r.special.random', ' data-kp-random') : '',
      s.recent !== false ? tool('special/recent', 'clock', 'r.special.recent') : '',
      s.allPages !== false ? tool('special/all', 'list', 'r.special.all') : '',
      (site.cats || []).length ? tool('special/categories', 'tag', 'r.categories') : '',
      s.unlock !== false ? tool('special/unlock', 'lock', 'r.unlock', ' data-kp-unlock-link') : '',
    ].join('');
    const search = s.search !== false ? `<form class="kp-search" role="search" action="${attr(href({ path: 'special/search', query: {}, frag: '' }).replace(/#.*$/, ''))}" data-kp-search><label class="kp-vh" for="kp-q">${esc(t('r.search'))}</label><input id="kp-q" type="search" name="q" autocomplete="off" spellcheck="false" placeholder="${attr(t('r.searchPh', { site: site.title }))}" aria-autocomplete="list" aria-controls="kp-sugg" aria-expanded="false"><button type="submit" class="kp-search-go" aria-label="${attr(t('r.search'))}">${icon('search')}</button><ul class="kp-sugg" id="kp-sugg" role="listbox" hidden></ul></form>` : '';
    const footer = [site.footer ? `<div class="kp-foot-text">${renderBlocks(site.footer, ctxBase)}</div>` : '', site.license ? `<div class="kp-license">${renderInline(site.license, ctxBase)}</div>` : '',
      s.footerInfo !== false ? `<div class="kp-made">${esc(t('r.madeWith'))}</div>` : ''].join('');
    return `<div class="kp-app" id="kp-app" data-route="${attr(route)}"><a class="kp-skip" href="#kp-main">${esc(t('r.skip'))}</a>` +
      `<header class="kp-top"><div class="kp-top-in"><button type="button" class="kp-burger" aria-controls="kp-side" aria-expanded="false" aria-label="${attr(t('r.menu'))}">${icon('menu')}</button>` +
      `<a class="kp-brand" href="${attr(home)}" data-kp-route="">${logo && logo.type.startsWith('image/') ? `<img class="kp-logo" src="${attr(logo.src)}" alt="">` : `<span class="kp-logo kp-logo-t" aria-hidden="true">${esc((site.title || 'K').trim()[0] || 'K')}</span>`}<span class="kp-brand-x"><span class="kp-brand-t">${esc(site.title)}</span>${site.tagline ? `<span class="kp-brand-tag">${esc(site.tagline)}</span>` : ''}</span></a>` +
      search + (nav ? `<nav class="kp-topnav" aria-label="${attr(t('r.navigation'))}"><ul>${nav}</ul></nav>` : '') +
      (s.schemeToggle !== false ? `<button type="button" class="kp-scheme" aria-label="${attr(t('r.scheme'))}" title="${attr(t('r.scheme'))}">${icon('scheme')}</button>` : '') +
      `</div></header><div class="kp-wrap"><aside class="kp-side" id="kp-side"><nav class="kp-sidenav" aria-label="${attr(t('r.navigation'))}"><ul class="kp-side-main"><li><a class="kp-tool" href="${attr(home)}" data-kp-route="">${icon('home')}<span>${esc(t('r.home'))}</span></a></li>${nav}</ul>${tools ? `<div class="kp-side-h">${esc(t('r.tools'))}</div><ul class="kp-side-tools">${tools}</ul>` : ''}</nav></aside>` +
      `<main class="kp-main" id="kp-main" tabindex="-1">${main}</main></div>` +
      `<footer class="kp-foot"><div class="kp-foot-in">${footer}</div></footer><div class="kp-pop" id="kp-pop" role="tooltip" hidden></div></div>`;
  }

  return { resolveRoute, article, special, shell, preview, backlinks, findPage, link, resolve, mediaInfo, routeOfPage, pages, site, t, dateOf: (d) => dateOf(d, site.lang), portalCatalog, portalSearch };
}

// The 404 text shows the requested path decoded for humans; a malformed escape must not throw inside the renderer.
function decodeURIComponentSafe(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}
