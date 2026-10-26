// site-studio/viewer-export.js - landing export hooks (doc/export.js): head meta (Open Graph, favicon, theme colour), page chrome
// at the end of <body> (floating toolbar, cart drawer, age gate, live region) and the runtime configuration (UI
// strings, catalog, cart sync, checkout, forms, motion, age gate) of exactly the features the page uses.
import { htmlToText, pickText } from '../i18n/text.js';
import { escapeAttr } from '../html/escape.js';
import { uiLookup, uiText } from '../doc/dict.js';
import { walkBlocks } from '../doc/model.js';
import { BLOCK_TYPES } from '../doc/product.js';
import { own } from '../util/value.js';
import { icon, ui } from '../doc/render.js';
import { attOf, isImage } from '../doc/attach.js';
import { reqById, renderToolbar } from './viewer-render.js';
import { collectProducts } from './viewer-blocks-c.js';
import { renderAgeGate, renderCartDrawer, rtFeatureSet, rtUiKeys } from './viewer-runtime.js';
import { apiCfg } from './viewer-backend.js';
import { renderChatPops } from './viewer-blocks-chat.js';
import { pageDesc, pageTitle, pagesCfg } from './viewer-pages.js';
import { rtPagesHead } from './viewer-runtime-pages.js';
import { jsonSafe, scriptSafe } from '../doc/export.js';
import { fnSource } from '../doc/runtime.js';
import { minifyJS } from '../minify/js.js';

// Design: hooks emit only what the page uses (features, UI strings, catalog entries, requests), because every byte of
// cfg is shipped in every exported file. Short keys in runtime configs for the same reason.
// Request configuration for the runtime: { m, u, h, c, t, r, p } (null when the request has no URL).
function reqCfg(doc, id) {
  const r = reqById(doc, id);
  if (!r || !r.url) return null;
  const h = {};
  for (const x of r.headers || []) h[x.k] = x.v;
  return { m: r.method, u: r.url, h, c: r.credentials, t: r.timeout, r: r.retries, p: r.itemsPath };
}

// Title per language: meta title, else the nav brand, else the first hero / heading title, else the project name.
function docTitle(doc, lang) {
  const t = htmlToText(pickText(doc.meta.title, lang, doc));
  if (t) return t;
  let found = '';
  walkBlocks(doc, (b) => {
    if (found || b.hidden) return;
    const src = b.type === 'nav' ? b.brand : b.type === 'hero' || b.type === 'heading' ? (b.title || b.text) : null;
    if (src) found = htmlToText(pickText(src, lang, doc));
  });
  return found || doc.name || 'Landing';
}

// Site description in a language (meta description).
const siteDesc = (doc, lang) => htmlToText(pickText(doc.meta.description, lang, doc));

// Title of the page a render shows first (CONTRACT.md §18): the page's meta title, else "<page> — <site>", the site
// title for the home page and single-page sites.
// The 404.html of an archive opens on the "Not found" page (the router switches when the address names a page).
const nfFirst = (r) => r.mode === 'spa' && !r.index && !!r.nf;

function pageDocTitle(doc, lang, ctx) {
  const site = docTitle(doc, lang);
  const r = ctx && ctx.route;
  if (!r || r.R.legacy || !r.page) return site;
  if (nfFirst(r)) return pageTitle(doc, r.nf, lang, site, false);
  return pageTitle(doc, r.page, lang, site, !!(r.entry && r.entry.home));
}

function pageDocDesc(doc, lang, ctx) {
  const site = siteDesc(doc, lang);
  const r = ctx && ctx.route;
  if (!r || r.R.legacy || !r.page) return site;
  return pageDesc(doc, nfFirst(r) ? r.nf : r.page, lang, site);
}

// Head script of path-routed renders (404.html, the single file as 404.html): base path + route before anything loads.
function routeHeadScript(ctx) {
  const r = ctx.route;
  const conf = { m: r.mode === 'spa' ? 'p' : 'a', b: r.base, r: r.R.list.map((e) => e.slug), i: r.index ? 1 : 0, a: r.mode === 'spa' ? 1 : 0 };
  let js = `(${fnSource(rtPagesHead)})(${jsonSafe(conf)});`;
  try { js = minifyJS(js); } catch (e) { /* keep readable */ }
  return `<script>${scriptSafe(js)}</script>`;
}

function head(ctx, use, { titles, descs }) {
  const d = ctx.doc;
  const l = ctx.defaultLang;
  const r = ctx.route;
  let s = '';
  if (r && !r.R.legacy && use.features.has('pages') && (r.mode === 'spa' || r.as404)) s += routeHeadScript(ctx);
  // A page that asks not to be indexed (and the 404.html of archives, which answers unknown addresses).
  if (r && !r.R.legacy && ((r.mode === 'file' && r.page && r.page.noindex) || r.mode === 'spa')) s += '<meta name="robots" content="noindex">';
  s += `<meta property="og:type" content="website"><meta property="og:title" content="${escapeAttr(titles[l])}">`;
  if (descs[l]) s += `<meta property="og:description" content="${escapeAttr(descs[l])}">`;
  const fav = attOf(ctx, d.meta.favicon);
  // Archive exports keep the icon as a file next to the page (ctx.assetURL).
  const favFile = fav && isImage(fav) && fav.data && ctx.assetURL ? String(ctx.assetURL(fav) || '') : '';
  if (favFile) { ctx.use.atts.add(fav.id); s += `<link rel="icon" href="${escapeAttr(favFile)}">`; }
  else if (fav && isImage(fav) && fav.data) s += `<link rel="icon" href="data:${escapeAttr(fav.mime)};base64,${fav.data}">`;
  if (d.theme && d.theme.bg) s += `<meta name="theme-color" content="${escapeAttr(d.theme.bg)}">`;
  return s;
}

function bodyEnd(ctx, use) {
  const F = use.features;
  let s = '';
  if (F.has('cart')) s += renderCartDrawer(ctx);
  if (F.has('agegate')) s += renderAgeGate(ctx);
  if (F.has('chat')) s += renderChatPops(ctx); // floating chat widgets (outside .lp-root)
  // CSS-only back-to-top link (output.backToTop; viewer-design.js fades it in after scrolling).
  if (ctx.doc.output.backToTop) s += `<a class="lp-totop" href="#top">${icon(ctx, 'arrowUp')}<span class="lp-sr">${ui(ctx, 'backToTop')}</span></a>
`;
  if (F.has('cart') || F.has('form') || F.has('checkout') || F.has('chat')) s += '<div class="lp-sr" data-lp-live aria-live="polite"></div>\n';
  return s;
}

// Labels the runtime sets when the language changes (it carries no UI text of its own).
function aria(ctx, use, langs, put) {
  if (langs.length < 2 || !use.toolbar) return;
  for (const k of use.toolbar.switcher === 'select' ? ['toolbar', 'language'] : ['toolbar']) {
    const vals = langs.map((l) => uiText(k, l, ctx.doc));
    if (new Set(vals).size > 1) langs.forEach((l, i) => put(l, k, vals[i]));
  }
}

function cfg(c, ctx, use, langs) {
  const d = ctx.doc;
  const F = rtFeatureSet(use.features);
  // UI strings the runtime reads (raw dictionary values: plural objects stay objects, R.t picks the form).
  const keys = new Set([...use.uiKeys, ...rtUiKeys(d, F)]);
  if (keys.size) {
    c.ui = {};
    for (const l of langs) {
      const o = {};
      for (const k of keys) o[k] = uiLookup(k, l, d)[0];
      c.ui[l] = o;
    }
  }
  if (F.has('cart')) {
    const s = d.shop;
    const p = {};
    for (const [sku, e] of collectProducts(d)) p[sku] = { p: e.price, n: e.name, u: e.unit, min: e.min, step: e.step, img: e.img };
    c.shop = { cur: s.currency, mode: s.mode, ttl: s.ttlDays, open: true, p };
    if (F.has('sync')) c.shop.sync = { load: reqCfg(d, s.loadReq), save: reqCfg(d, s.saveReq), policy: s.policy, debounce: 800 };
    if (F.has('checkout')) {
      const co = s.checkout;
      c.shop.co = {
        m: co.method, req: reqCfg(d, co.req), fb: co.fallback,
        to: { email: co.email, phone: co.phone, telegram: co.telegram, url: co.url },
        fields: (co.fields || []).map((f) => ({ k: f.key, t: f.type, r: !!f.required })), min: co.minTotal,
      };
    }
  }
  if (F.has('form')) {
    c.forms = {};
    walkBlocks(d, (b) => {
      if (!(b.type === 'form' || (own(BLOCK_TYPES, b.type) || {}).formLike) || !ctx.rendered.has(b.id)) return;
      c.forms[b.id] = { req: reqCfg(d, b.req), fb: b.fallback, to: b.to };
    });
  }
  if (F.has('api')) c.api = apiCfg(ctx, use);
  if (F.has('chat') && use.chats instanceof Map) c.chat = Object.fromEntries(use.chats);
  if (F.has('reveal')) c.motion = d.output.motion;
  if (F.has('agegate')) c.age = { min: d.output.ageGate.minAge, no: d.output.ageGate.noUrl };
  if (F.has('pages')) c.pg = pagesCfg(ctx, langs, (l) => docTitle(ctx.pd, l), (l) => siteDesc(ctx.pd, l));
}

function report(r, ctx, use) {
  const d = ctx.doc;
  r.variants = [...use.variants].sort();
  // Requests the page can send: forms (use.reqs), checkout and cart sync.
  const F = rtFeatureSet(use.features);
  const ids = new Set(use.reqs);
  if (F.has('checkout') && d.shop.checkout.method === 'request') ids.add(d.shop.checkout.req);
  if (F.has('sync')) { ids.add(d.shop.loadReq); ids.add(d.shop.saveReq); }
  r.requests = [...new Set([...ids].map((id) => (reqById(d, id) || {}).name).filter(Boolean))];
  r.products = use.features.has('cart') ? collectProducts(d).size : 0;
  r.uiKeys = use.uiKeys.size;
  if (ctx.api) r.api = ctx.api.mode; // backend export: 'server' | 'auto'
  // Pages: routable pages of the site and how this render routes them ('hash' | 'file' | 'spa'; as404: the single
  // file also serves as 404.html).
  const rt = ctx.route;
  if (rt && !rt.R.legacy) {
    r.pages = rt.R.list.length;
    r.route = rt.mode;
    if (rt.as404) r.as404 = true;
  }
}

export const exportHooks = {
  previewNoScript: true,
  htmlAttrs: (ctx) => (ctx.preview ? ' class="lp-js lp-pv"' : ''),
  title: pageDocTitle, desc: pageDocDesc, head, bodyEnd, aria, cfg, report,
  toolbar: renderToolbar,
};

export { docTitle };
