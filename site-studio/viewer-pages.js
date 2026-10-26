// site-studio/viewer-pages.js - multi-page sites (CONTRACT.md §18): the `page` container type, page
// normalization (old single-page documents become one home page), the route table, the URL of a page or an in-page
// target in each export mode, the navigation's page links, the main region of every render mode, page titles and
// descriptions, the runtime configuration of the router and the default "Not found" page.
//
// Document: regions.main = [page, page, …]; a page = { type: 'page', id, kind: 'page' | 'notfound', slug, title,
// navLabel, nav, metaTitle, metaDesc, noindex, hidden, blocks: [...] }. The first visible regular page is the home page
// (URL '' whatever its slug); a hidden page is a draft (not exported, links to it are dropped); at most one 'notfound'.
//
// Render modes (ctx.route.mode, from the export option `route` or the editor's `page`):
//   edit   the edited page only (data-list="<page id>:blocks")
//   hash   single file: every page in one document (<main data-lp-page> each, hash routes #/<slug>, feature pages)
//          — a site with one page renders exactly like before (no wrappers, no router)
//   spa    404.html of an archive: every page, path routes under a detected base path (feature pages + head script)
//   file   one page per HTML file (archives, backend): relative links between the files, no router
import { escapeAttr, escapeHTML } from '../html/escape.js';
import { htmlToText, pickText } from '../i18n/text.js';
import { eachChildList, newBlock } from '../doc/model.js';
import { BLOCK_TYPES } from '../doc/product.js';
import { uiText } from '../doc/dict.js';
import { has, renderList, txt, ui } from '../doc/render.js';
import { uid } from '../util/id.js';
import { isObj, oneOf, own, str } from '../util/value.js';
import { normPageAccess } from './viewer-access.js';

const PAGE_KINDS = ['page', 'notfound'];

// URL path of a page: 1..4 lowercase segments of [a-z0-9-] ('about', 'services/legal').
const SLUG_SEG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?(?:\/[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?){0,3}$/;

// First path segments a page cannot use: files and routes of the exported packages (assets, data snapshots, the
// server's API and admin console, the 404 page) and index names. Such slugs get a '-page' suffix.
const RESERVED_SLUGS = new Set(['assets', 'api', 'admin', 'data', 'lib', '404', 'index', 'public', 'server']);

const slugReserved = (s) => RESERVED_SLUGS.has(str(s).split('/')[0]);

// 'About Us/', '/Services/Legal.html' → 'about-us', 'services/legal'; '' when nothing usable is left. Letters other
// than ASCII are dropped (the editor transliterates titles itself).
function normSlug(v) {
  const segs = str(v).trim().toLowerCase().replace(/\\/g, '/').split('/')
    .map((s) => s.trim().replace(/\.html?$/, '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, ''))
    .filter((s) => s && SLUG_SEG_RE.test(s));
  return segs.slice(0, 4).join('/');
}

// Effective slugs of the regular pages in order: normalized, reserved ones suffixed, duplicates numbered, empty ones
// 'page-<n>' (the home page keeps '' when it has none). Map page id → slug.
function pageSlugs(pages) {
  const used = new Set();
  const out = new Map();
  let n = 0;
  for (const p of pages) {
    if (!isObj(p) || p.kind === 'notfound') continue;
    n++;
    let s = normSlug(p.slug);
    if (!s && n === 1) { out.set(p.id, ''); continue; }
    if (!s) s = 'page-' + n;
    if (slugReserved(s)) s = s.replace(/^[^/]+/, (x) => x + '-page');
    let c = s;
    for (let k = 2; used.has(c); k++) c = s + '-' + k;
    used.add(c);
    out.set(p.id, c);
  }
  return out;
}

/* ---------- the page container type ---------- */

function pgRender(b, ctx) {
  // A page outside regions.main (misplaced by hand): its blocks inline.
  return renderList(ctx, b.blocks, b.id + ':blocks', 'div', 'lp-page-in', '', !ctx.edit);
}

const BT_PG = {
  page: {
    category: 'structure', icon: 'file', container: true, lists: ['blocks'], transparent: true, topLevel: true,
    region: 'main', palette: false,
    i18nFields: ['title', 'navLabel', 'metaTitle', 'metaDesc'],
    defaults: () => ({ kind: 'page', slug: '', title: {}, navLabel: {}, nav: true, metaTitle: {}, metaDesc: {}, noindex: false, access: 'public', roles: '', blocks: [] }),
    schema: [
      { key: 'title', type: 'i18n', label: 'f.pageTitle' },
      { key: 'slug', type: 'text', label: 'f.slug', hint: 'fh.slug', placeholder: 'pl.slug', when: { kind: 'page' } },
      { key: 'nav', type: 'checkbox', label: 'f.inNav', when: { kind: 'page' } },
      { key: 'navLabel', type: 'i18n', label: 'f.navLabel', when: { kind: 'page', nav: true } },
      { key: 'metaTitle', type: 'i18n', label: 'f.metaTitle', hint: 'fh.metaTitle' },
      { key: 'metaDesc', type: 'i18n', label: 'f.metaDesc', multiline: true, rows: 3 },
      { key: 'noindex', type: 'checkbox', label: 'f.noindex' },
      // Closed sections (viewer-access.js): only on backend sites; other exports show a note instead of the content.
      { key: 'access', type: 'select', label: 'f.access', hint: 'fh.access', when: { kind: 'page' }, options: [{ v: 'public', l: 'o.acc.public' }, { v: 'members', l: 'o.acc.members' }, { v: 'roles', l: 'o.acc.roles' }] },
      { key: 'roles', type: 'text', label: 'f.pageRoles', hint: 'fh.pageRoles', placeholder: 'pl.roles', when: { access: 'roles' } },
    ],
    normalize(out) {
      out.kind = oneOf(out.kind, PAGE_KINDS, 'page');
      out.slug = normSlug(out.slug);
      out.anchor = '';
      out.device = 'all';
      out.langs = null;
      delete out.source;
      normPageAccess(out);
    },
    render: pgRender,
  },
};

/* ---------- normalization (viewer-model.js normalizeTop) ---------- */

// Raw main region → page blocks: blocks before the first page form the home page, later loose blocks join the page
// in front of them, pages nested one level inside a page's list move up next to it. Old single-page documents and
// templates that fill regions.main with blocks become one page this way.
function wrapPages(list) {
  const src = Array.isArray(list) ? list.filter(isObj) : [];
  const out = [];
  let cur = null;
  const addPage = (b) => {
    const kids = Array.isArray(b.blocks) ? b.blocks.filter(isObj) : [];
    const p = { ...b, anchor: '', blocks: kids.filter((x) => x.type !== 'page') };
    out.push(p);
    for (const x of kids) if (x.type === 'page') out.push({ ...x, anchor: '', blocks: Array.isArray(x.blocks) ? x.blocks.filter((y) => isObj(y) && y.type !== 'page') : [] });
    return p;
  };
  for (const b of src) {
    if (b.type === 'page') cur = addPage(b);
    else if (cur) cur.blocks.push(b);
    else { cur = { type: 'page', kind: 'page', blocks: [b] }; out.unshift(cur); }
  }
  return out;
}

// After the blocks are normalized: at most one "Not found" page, at least one regular page, effective slugs.
function finishPages(pages) {
  let nf = false;
  for (const p of pages) {
    if (p.kind !== 'notfound') continue;
    if (nf) p.kind = 'page'; else { nf = true; p.slug = ''; p.nav = false; }
  }
  if (!pages.some((p) => p.kind !== 'notfound') && own(BLOCK_TYPES, 'page')) pages.unshift(newBlock('page'));
  const slugs = pageSlugs(pages);
  for (const p of pages) if (slugs.has(p.id)) p.slug = slugs.get(p.id);
  return pages;
}

/* ---------- route table ---------- */

const isPage = (b) => isObj(b) && b.type === 'page';

// Routes of a document: { legacy (main holds loose blocks: rendered as one page), pages (page blocks), list (visible
// regular pages: { id, b, slug, home, nav }), home, nf (the visible "Not found" page block or null), byId, bySlug,
// navList }. Robust on documents the editor has not normalized yet (slugs computed like normalizeTop does).
function siteRoutes(doc) {
  const main = doc && doc.regions && Array.isArray(doc.regions.main) ? doc.regions.main : [];
  const legacy = main.some((b) => isObj(b) && b.type !== 'page');
  const pages = legacy ? [] : main.filter(isPage);
  const slugs = pageSlugs(pages);
  const list = [];
  for (const p of pages) {
    if (p.kind === 'notfound' || p.hidden) continue;
    list.push({ id: p.id, b: p, slug: list.length ? slugs.get(p.id) || 'page-' + (list.length + 1) : '', home: !list.length, nav: p.nav !== false });
  }
  // A slug equal to another page's path after the home page took '' stays unique: numbered like normalization does.
  const bySlug = new Map();
  for (const e of list) {
    let s = e.slug;
    for (let k = 2; bySlug.has(s); k++) s = e.slug + '-' + k;
    e.slug = s;
    bySlug.set(s, e);
  }
  const nf = pages.find((p) => p.kind === 'notfound' && !p.hidden) || null;
  return {
    legacy, pages, list, home: list[0] || null, nf, byId: new Map(list.map((e) => [e.id, e])), bySlug,
    navList: list.filter((e) => e.nav),
  };
}

// 'About.html', 'about/', 'Docs/Setup/index.html' → route key ('about', 'docs/setup'; '' = home).
function routeKey(p) {
  const a = str(p).split('/').filter(Boolean);
  if (a.length) {
    const last = a[a.length - 1].toLowerCase();
    if (/^index(\.html?)?$/.test(last)) a.pop(); else a[a.length - 1] = a[a.length - 1].replace(/\.html?$/i, '');
  }
  return a.join('/').toLowerCase();
}

/* ---------- default "Not found" page ---------- */

const nfL = (doc, langs, key) => Object.fromEntries(langs.map((l) => [l, uiText(key, l, doc)]));

// The "Not found" page in the given languages: a centered hero with the code, a title, a short text and a button
// home. idPrefix makes the ids fixed (the virtual page of exports) instead of random.
function notFoundPage(doc, langs, idPrefix = '') {
  const ls = Array.isArray(langs) && langs.length ? langs : ['en'];
  const id = (s) => (idPrefix ? { id: idPrefix + s } : {});
  const hero = newBlock('hero', {
    ...id('hero'), eyebrow: nfL(doc, ls, 'nfCode'), title: nfL(doc, ls, 'nfTitle'),
    text: Object.fromEntries(ls.map((l) => [l, '<p>' + escapeHTML(uiText('nfText', l, doc)) + '</p>'])),
    items: [{ id: idPrefix ? idPrefix + 'btn' : uid(), label: nfL(doc, ls, 'nfHome'), href: '#/', kind: 'primary', icon: 'home' }],
    layout: 'center', height: 'tall',
  });
  return newBlock('page', { ...id('page'), kind: 'notfound', title: nfL(doc, ls, 'nfTitle'), nav: false, noindex: true, blocks: [hero] });
}

// Fixed ids of the virtual "Not found" page of exports whose document has none.
const NF_VIRTUAL = 'lpnf';

/* ---------- render context (P.makeCtx) ---------- */

const BASE_RE = /^\/(?:[A-Za-z0-9._~-]+\/){0,8}$/;

// Normalized base path of a site ('/', '/repo/'); '' = detect at runtime.
function normBase(v) {
  let s = str(v).trim();
  if (!s) return '';
  if (s[0] !== '/') s = '/' + s;
  if (!s.endsWith('/')) s += '/';
  return BASE_RE.test(s) ? s : '';
}

const SHOP_TYPES = ['products', 'pricing', 'events', 'cart', 'collection'];

// Does a visible page sell something (the cart belongs to every page of such a site)?
function sellsAnywhere(doc) {
  let yes = false;
  const visit = (list) => {
    for (const b of Array.isArray(list) ? list : []) {
      if (yes || !isObj(b) || b.hidden) continue;
      if (SHOP_TYPES.includes(b.type) && (b.type === 'cart' || (Array.isArray(b.items) && b.items.some((it) => isObj(it) && typeof it.sku === 'string' && it.sku)))) { yes = true; return; }
      eachChildList(b, visit);
    }
  };
  for (const k of ['header', 'main', 'footer']) visit(doc.regions[k]);
  return yes;
}

// ctx.route = { mode, page (page block), entry (route entry or null), multi, depth, base, as404, index, R, nf (page
// block of the "Not found" page in DOM modes, virtual when the document has none) }.
// opts.route = { mode: 'file' | 'spa', page: page id, base: '/repo/' | '', index: bool (spa: also the index.html) };
// opts.page = the edited page;
// opts.extra.as404 (single file): the same file also serves as 404.html (path routes on http(s)).
function pagesCtx(ctx, opts) {
  const o = isObj(opts) ? opts : {};
  const rt = isObj(o.route) ? o.route : {};
  const R = siteRoutes(ctx.doc);
  let mode = ctx.edit ? 'edit' : rt.mode === 'file' || rt.mode === 'spa' ? rt.mode : 'hash';
  if (R.legacy) mode = ctx.edit ? 'edit' : 'hash';
  const as404 = mode === 'hash' && !R.legacy && !!((isObj(o.extra) && o.extra.as404) || rt.as404);
  let page = null;
  if (mode === 'edit') page = R.pages.find((p) => p.id === o.page) || (R.home && R.home.b) || R.pages[0] || null;
  else if (mode === 'file') page = R.pages.find((p) => p.id === rt.page && !p.hidden) || (R.home && R.home.b) || null;
  else page = R.home ? R.home.b : null;
  const entry = page ? R.byId.get(page.id) || null : null;
  const multi = !R.legacy && (mode === 'spa' || as404 || (mode === 'hash' && R.list.length > 1));
  let nf = R.nf;
  if (!nf && multi && own(BLOCK_TYPES, 'page') && own(BLOCK_TYPES, 'hero')) nf = notFoundPage(ctx.doc, ctx.doc.langs, NF_VIRTUAL);
  const depth = mode === 'file' && entry && entry.slug ? entry.slug.split('/').length : 0;
  // index: a path-routed document that is also the site's index.html (an empty path is its home page).
  const base = normBase(rt.base) || normBase(isObj(ctx.doc.output) ? ctx.doc.output.basePath : '');
  ctx.route = { mode, page, entry, multi, depth, base, as404, index: as404 || !!rt.index, R, nf };
  // A site that sells on any page shows its cart on every page (one cart per site, localStorage).
  ctx.siteShop = !ctx.edit && (mode === 'file' || multi) && sellsAnywhere(ctx.doc);
}

// P.planDoc: the page of every visible block (ctx.pageOf: block id → page block).
function planPages(ctx) {
  const m = new Map();
  const r = ctx.route;
  if (!r || r.R.legacy) { ctx.pageOf = m; return; }
  for (const p of r.R.pages) {
    if (!ctx.edit && p.hidden) continue;
    m.set(p.id, p);
    const visit = (list) => { for (const b of Array.isArray(list) ? list : []) { if (!isObj(b)) continue; m.set(b.id, p); eachChildList(b, visit); } };
    visit(p.blocks);
  }
  if (r.nf && !m.has(r.nf.id)) {
    m.set(r.nf.id, r.nf);
    for (const b of r.nf.blocks) m.set(b.id, r.nf);
  }
  ctx.pageOf = m;
}

/* ---------- URLs of pages and targets ---------- */

const up = (n) => '../'.repeat(Math.max(0, n));

// The URL of a page (+ an anchor on it) in the current export. Same page in file mode: '#anchor' | '#top'.
function pageHref(ctx, page, anchor = '') {
  const r = ctx.route;
  const e = r && page ? r.R.byId.get(page.id) : null;
  const hash = anchor ? '#' + anchor : '';
  if (!r || !e) {
    // The "Not found" page or a page outside the route table: anchors still work in DOM modes.
    return anchor ? hash : null;
  }
  if (r.mode === 'file') {
    if (r.page && r.page.id === e.id) return hash || '#top';
    return (up(r.depth) || (e.slug ? '' : './')) + (e.slug ? e.slug + '/' : '') + hash;
  }
  if (r.mode === 'spa') return (e.slug ? e.slug + '/' : './') + hash;
  // hash: a one-page site keeps plain fragments; else #/<slug>, and an anchor alone (it is unique in the document:
  // the router shows its page).
  if (!r.multi) return hash || '#top';
  return hash || '#/' + e.slug;
}

// P.placeHref: an in-page target (#anchor, #b-<id>, #att-<id>) of a block on another page; #b-<page id> = the page.
function placeHref(ctx, href, bid) {
  const r = ctx.route;
  if (!r || r.R.legacy || !ctx.pageOf) return href;
  const pg = ctx.pageOf.get(bid);
  if (!pg) return href; // header / footer: on every page
  if (bid === pg.id) return pageHref(ctx, pg) || null;
  const anchor = href.slice(1);
  if (r.mode === 'file') return r.page && r.page.id === pg.id ? href : pageHref(ctx, pg, anchor);
  if (r.mode === 'spa') return pageHref(ctx, pg, anchor) || href;
  return href;
}

// P.routeHref: '#/<path>[#<anchor>]' → the page's URL in this export (null: no such visible page).
function routeHref(ctx, path, anchor) {
  const r = ctx.route;
  if (!r) return null;
  const key = routeKey(path);
  const e = r.R.legacy ? null : r.R.bySlug.get(key);
  const a = anchor && ctx.anchors.has(anchor) ? anchor : '';
  if (r.R.legacy) return key ? null : a ? '#' + a : '#top';
  if (!e) return null;
  // An anchor names its own page (anchors are unique in the document).
  const ap = a && ctx.pageOf ? ctx.pageOf.get(ctx.anchors.get(a)) : null;
  return pageHref(ctx, ap || e.b, a);
}

/* ---------- navigation: page links ---------- */

// <li> page links of a nav block (visible regular pages shown in navigation, when there are at least two): label =
// nav label | title. View: data-lp-pg="<slug>" for the router, aria-current="page" on the current page. Edit:
// non-navigating labels; data-lp-edit-page="<id>" lets the editor switch pages.
function navPageLinks(ctx) {
  const r = ctx.route;
  if (!r || r.R.legacy || r.R.navList.length < 2) return '';
  let s = '';
  for (const e of r.R.navList) {
    const label = has(ctx, e.b.navLabel) ? txt(ctx, e.b.navLabel) : has(ctx, e.b.title) ? txt(ctx, e.b.title) : e.home ? ui(ctx, 'pgHome') : escapeHTML(e.slug);
    const cur = r.page && r.page.id === e.id;
    if (ctx.edit) {
      s += `<li class="lp-nav-li lp-nav-pgl"><span class="lp-nav-a${cur ? ' lp-nav-cur' : ''}" data-lp-edit-page="${escapeAttr(e.id)}"${cur ? ' aria-current="page"' : ''}>${label}</span></li>`;
      continue;
    }
    const href = pageHref(ctx, e.b);
    if (!href) continue;
    // DOM modes start on the home page (the router moves the mark); the 404 page of an archive knows it only at runtime.
    const mark = r.mode === 'spa' ? false : cur;
    s += `<li class="lp-nav-li"><a class="lp-nav-a" href="${escapeAttr(href)}" data-lp-pg="${escapeAttr(e.slug)}"${mark ? ' aria-current="page"' : ''}>${label}</a></li>`;
  }
  return s;
}

/* ---------- main region ---------- */

const mainAttrs = (slug, extra = '') => ` data-lp-page="${escapeAttr(slug)}"${extra}`;

// The <main> element(s) of a render (renderRoot): see the modes above. renderList keeps the region's list semantics
// (depth 0 = top-level blocks of the page).
function renderMain(ctx) {
  const d = ctx.doc;
  const r = ctx.route;
  const list = (blocks, path, attrs) => {
    ctx.region = 'main';
    ctx.depth = -1;
    const s = renderList(ctx, blocks, path, 'main', 'lp-main', '', false, attrs);
    ctx.region = '';
    // The page itself counts as rendered (two-pass renders plan only inside rendered containers).
    const i = path.indexOf(':');
    if (i > 0) ctx.rendered.add(path.slice(0, i));
    return s;
  };
  if (!r || r.R.legacy || !r.page) {
    return list(d.regions.main, 'regions.main', ctx.edit ? '' : ' id="lp-main" tabindex="-1"');
  }
  if (ctx.edit) return list(r.page.blocks, r.page.id + ':blocks', '');
  if (ctx.siteShop) ctx.use.shop = true;
  // The first pass of a file export renders every page: links and anchors to the other pages must exist there.
  const all = r.multi || (r.mode === 'file' && !ctx.prev);
  if (!all) return list(r.page.blocks, r.page.id + ':blocks', ' id="lp-main" tabindex="-1"');
  // Shown before (or without) the router: the home page; in a 404.html, the "Not found" page — the file answers
  // unknown addresses.
  const nfFirst = r.mode === 'spa' && !r.index && !!r.nf;
  let s = '';
  for (const e of r.R.list) {
    s += list(e.b.blocks, e.id + ':blocks', ` id="/${escapeAttr(e.slug)}" tabindex="-1"` + mainAttrs(e.slug, e.home && !nfFirst ? '' : ' hidden'));
  }
  if (r.nf) s += list(r.nf.blocks, r.nf.id + ':blocks', ' id="lp-404" tabindex="-1"' + mainAttrs('404', nfFirst ? '' : ' hidden'));
  return s;
}

// Page block lists that decide whether an overlay nav fits (every page shown in this render must open with a hero).
function leadLists(ctx) {
  const r = ctx.route;
  const d = ctx.doc;
  if (!r || r.R.legacy || !r.page) return [d.regions && Array.isArray(d.regions.main) ? d.regions.main : []];
  if (!r.multi && !(r.mode === 'file' && !ctx.prev)) return [r.page.blocks];
  return [...r.R.list.map((e) => e.b.blocks), ...(r.nf ? [r.nf.blocks] : [])];
}

/* ---------- titles, descriptions, router configuration ---------- */

const plain = (i18n, l, doc) => htmlToText(pickText(i18n, l, doc)).trim();

// Title of a page in a language: its own meta title, else "<page> — <site>" (home: the site title).
function pageTitle(doc, page, l, siteTitle, home) {
  const own0 = page ? plain(page.metaTitle, l, doc) : '';
  if (own0) return own0;
  if (!page || home) return siteTitle;
  const name = plain(page.title, l, doc) || plain(page.navLabel, l, doc);
  return name && name !== siteTitle ? `${name} — ${siteTitle}` : siteTitle;
}

function pageDesc(doc, page, l, siteDesc) {
  return (page ? plain(page.metaDesc, l, doc) : '') || siteDesc;
}

// cfg.pg of feature pages: { m: 'h' (hash) | 'p' (path, 404.html) | 'a' (single file also deployed as 404.html), b:
// configured base path, r: [{ s: slug, t: {lang: title}, d: {lang: description}, x: 1 (noindex) }] (the "Not found"
// page as s '404') }.
function pagesCfg(ctx, langs, siteTitle, siteDesc) {
  const r = ctx.route;
  const d = ctx.pd;
  const entries = r.R.list.map((e) => ({ s: e.slug, b: e.b, home: e.home }));
  if (r.nf) entries.push({ s: '404', b: r.nf, home: false });
  return {
    m: r.mode === 'spa' ? 'p' : r.as404 ? 'a' : 'h',
    b: r.base,
    r: entries.map((e) => {
      const t = {};
      const ds = {};
      for (const l of langs) { t[l] = pageTitle(d, e.b, l, siteTitle(l), e.home); ds[l] = pageDesc(d, e.b, l, siteDesc(l)); }
      const o = { s: e.s, t, d: ds };
      if (e.b.noindex || e.s === '404') o.x = 1;
      return o;
    }),
  };
}

// Viewer strings of the default "Not found" page (the editor copies them into a new page; exports of documents without
// one use them directly).
const UI_PG = {
  en: { pgHome: 'Home', nfCode: 'Error 404', nfTitle: 'Page not found', nfText: 'The page you are looking for does not exist or has moved. Check the address or start from the home page.', nfHome: 'Go to the home page' },
  ru: { pgHome: 'Главная', nfCode: 'Ошибка 404', nfTitle: 'Страница не найдена', nfText: 'Такой страницы нет или она переехала. Проверьте адрес или начните с главной страницы.', nfHome: 'На главную' },
  uk: { pgHome: 'Головна', nfCode: 'Помилка 404', nfTitle: 'Сторінку не знайдено', nfText: 'Такої сторінки немає або її перенесено. Перевірте адресу або почніть з головної сторінки.', nfHome: 'На головну' },
  de: { pgHome: 'Startseite', nfCode: 'Fehler 404', nfTitle: 'Seite nicht gefunden', nfText: 'Die gesuchte Seite gibt es nicht oder sie ist umgezogen. Prüfen Sie die Adresse oder beginnen Sie auf der Startseite.', nfHome: 'Zur Startseite' },
  fr: { pgHome: 'Accueil', nfCode: 'Erreur 404', nfTitle: 'Page introuvable', nfText: 'La page demandée n’existe pas ou a été déplacée. Vérifiez l’adresse ou repartez de la page d’accueil.', nfHome: 'Aller à l’accueil' },
  es: { pgHome: 'Inicio', nfCode: 'Error 404', nfTitle: 'Página no encontrada', nfText: 'La página que buscas no existe o se ha movido. Revisa la dirección o empieza desde la página de inicio.', nfHome: 'Ir a la página de inicio' },
  ka: { pgHome: 'მთავარი', nfCode: 'შეცდომა 404', nfTitle: 'გვერდი ვერ მოიძებნა', nfText: 'ასეთი გვერდი არ არსებობს ან გადატანილია. შეამოწმეთ მისამართი ან დაიწყეთ მთავარი გვერდიდან.', nfHome: 'მთავარ გვერდზე' },
};

export {
  BT_PG,
  NF_VIRTUAL,
  UI_PG,
  PAGE_KINDS,
  RESERVED_SLUGS,
  SLUG_RE,
  finishPages,
  isPage,
  leadLists,
  navPageLinks,
  normBase,
  normSlug,
  notFoundPage,
  pageDesc,
  pageHref,
  pageSlugs,
  pageTitle,
  pagesCfg,
  pagesCtx,
  placeHref,
  planPages,
  renderMain,
  routeHref,
  routeKey,
  sellsAnywhere,
  siteRoutes,
  slugReserved,
  wrapPages
};
