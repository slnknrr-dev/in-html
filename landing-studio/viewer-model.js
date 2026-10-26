// landing-studio/viewer-model.js - landing document shape: output, theme, shop and requests; common block props.
import { isImage } from '../doc/attach.js';
import { FONT_STACKS } from './viewer-design.js';
import { safeColor } from '../color/color.js';
import { normI18n } from '../i18n/text.js';
import { canonLang } from '../i18n/lang.js';
import { REGIONS, REQ_METHODS } from './viewer-base.js';
import { optList } from '../doc/schema.js';
import { ITEM_ID_RE, docLangs, freshId, newBlock, normAttachments, normItems, normList } from '../doc/model.js';
import { BLOCK_TYPES, THEMES } from '../doc/product.js';
import { bool, isObj, num, oneOf, own, round, str } from '../util/value.js';
import { uid } from '../util/id.js';
import { normSource } from './viewer-backend.js';
import { migrateRegions } from './viewer-migrate.js';
import { finishPages, normBase, notFoundPage, wrapPages } from './viewer-pages.js';

// Common block props (CONTRACT.md §2). style.mt/mb/pad are px (null = theme rhythm); style is never a variant prop.
const COMMON_DEFAULTS = () => ({
  hidden: false, langs: null, device: 'all', anchor: '',
  style: { mt: null, mb: null, pad: null, bg: '', color: '', align: '' },
});

const DEFAULT_OUTPUT = () => ({
  autodetect: true, switcher: 'buttons', langLabels: 'native', themeToggle: false,
  toolbarPos: 'nav', uiFallback: 'en', motion: 'none', backToTop: false,
  ageGate: { enabled: false, minAge: 18, title: {}, text: {}, yes: {}, no: {}, noUrl: '' },
  basePath: '', // site path on its host ('/repo/'); '' = detected by 404.html (multi-page archives)
});

const DEFAULT_CHECKOUT = () => ({
  method: 'request', req: null, fallback: 'mailto', email: '', phone: '', telegram: '', url: '',
  fields: [], note: {}, success: {}, minTotal: 0,
});

const DEFAULT_SHOP = () => ({
  currency: 'USD', mode: 'cart', cartButton: 'auto', sync: 'local', loadReq: null, saveReq: null,
  policy: 'newest', ttlDays: 30, checkout: DEFAULT_CHECKOUT(),
});

const DEFAULT_REQUEST = () => ({
  id: uid(), name: 'Request', method: 'POST', url: '', headers: [], credentials: 'omit', timeout: 8000, retries: 2,
  itemsPath: 'items',
});

// Enumerations of the document settings (prefixed: other parts own the CSS that keys off these values).
const OUT_SWITCHERS = ['buttons', 'select', 'none'];

const OUT_TOOLBAR_POS = ['nav', 'top-right', 'bottom-right', 'bottom-left'];

const OUT_MOTIONS = ['none', 'fade', 'rise'];

const TH_BUTTONS = ['solid', 'pill', 'square', 'outline'];

const TH_HEADINGS = ['normal', 'caps', 'italic', 'underline', 'eyebrow'];

const TH_SPACES = ['compact', 'normal', 'airy'];

const TH_SCHEMES = ['light', 'dark', 'auto'];

const SHOP_MODES = ['cart', 'quote'];

const SHOP_CART_BUTTONS = ['auto', 'nav', 'floating'];

const SHOP_SYNC = ['local', 'remote'];

const SHOP_POLICIES = ['newest', 'remote', 'local', 'merge'];

const CO_METHODS = ['request', 'mailto', 'whatsapp', 'telegram', 'link', 'none'];

const CO_FALLBACKS = ['mailto', 'whatsapp', 'telegram', 'none'];

const REQ_CREDENTIALS = ['omit', 'same-origin', 'include'];

const FIELD_TYPES = ['text', 'email', 'tel', 'textarea', 'select', 'checkbox', 'number', 'date'];

// Theme values used when a preset does not define one (and before the design part's presets are merged).
const THEME_BASE_VARS = {
  accent: '#2563eb', accent2: '#0ea5e9', bg: '#ffffff', surface: '#f5f7fa', text: '#1f2937', muted: '#5f6672',
  border: '#e3e7ec', fontBody: 'sans', fontHead: 'sans', radius: 10, buttons: 'solid', headings: 'normal', scheme: 'light',
};

const THEME_LAYOUT_VARS = { baseSize: 17, lineHeight: 1.6, width: 1160, space: 'normal' };

function defaultPreset() {
  return own(THEMES, 'clean') ? 'clean' : Object.keys(THEMES)[0] || 'clean';
}

// Full theme object for a preset: built-in values, overridden by the preset's vars (CONTRACT.md §4).
function themeDefaults(preset) {
  const p = own(THEMES, preset);
  const v = p && isObj(p.vars) ? p.vars : {};
  const t = { preset, ...THEME_BASE_VARS, ...THEME_LAYOUT_VARS };
  for (const k of Object.keys(t)) {
    const x = own(v, k);
    if (k !== 'preset' && (typeof x === 'string' || typeof x === 'number')) t[k] = x;
  }
  return t;
}

// Anchors: lowercase slugs, unique per document (first wins). Reserved: the special targets and every id the page or
// runtime generates itself (b-<id>, att-<id>, lp-*, form field ids f-*), so a slug never duplicates a DOM id.
const ANCHOR_RE = /^[a-z][a-z0-9-]{0,40}$/;

const ANCHOR_RESERVED = new Set(['top', 'cart', 'lang']);

const ANCHOR_RESERVED_RE = /^(?:(?:b|att)-[a-z0-9]+|lp-.*|f-.*)$/;

function normAnchor(v, ctx) {
  const s = str(v).trim().toLowerCase();
  if (!s || !ANCHOR_RE.test(s) || ANCHOR_RESERVED.has(s) || ANCHOR_RESERVED_RE.test(s) || ctx.anchorSet.has(s)) return '';
  ctx.anchorSet.add(s);
  return s;
}

// Product codes: [A-Za-z0-9._-]{1,40}; other characters become '-'. Duplicates are kept (the editor warns; the
// catalog takes the first).
const SKU_RE = /^[A-Za-z0-9._-]{1,40}$/;

function normSku(v) {
  const s = str(v).trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return SKU_RE.test(s) ? s : '';
}

// Form / checkout field keys: ^[a-z][a-z0-9_]{0,30}$, unique within the list ('field', 'field_2', …).
const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,30}$/;

function normFieldKeys(items) {
  if (!Array.isArray(items)) return;
  const seen = new Set();
  for (const it of items) {
    if (!isObj(it)) continue;
    let k = str(it.key).trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^[^a-z]+/, '').slice(0, 31);
    if (!FIELD_KEY_RE.test(k)) k = 'field';
    const base = k;
    for (let n = 2; seen.has(k); n++) { const suf = '_' + n; k = base.slice(0, 31 - suf.length) + suf; }
    seen.add(k);
    it.key = k;
  }
}

// Blank landing: header [nav], main [home page: hero; "Not found" page], footer [footer] (types that are not registered
// are skipped).
function newDoc(opts = {}) {
  const [langs, defaultLang] = docLangs(opts.langs, opts.defaultLang);
  const preset = own(THEMES, opts.theme) ? opts.theme : defaultPreset();
  const now = new Date().toISOString();
  const one = (type) => (own(BLOCK_TYPES, type) ? [newBlock(type)] : []);
  const pages = own(BLOCK_TYPES, 'page')
    ? [newBlock('page', { blocks: one('hero') }), ...(own(BLOCK_TYPES, 'hero') ? [notFoundPage({ langs, defaultLang, output: DEFAULT_OUTPUT() }, langs)] : [])]
    : one('hero');
  return {
    format: 'lp-landing', version: 1, id: uid(),
    name: str(opts.name).trim().slice(0, 200) || 'Untitled landing',
    meta: { title: {}, description: {}, author: '', keywords: '', ogImage: null, favicon: null, created: now, modified: now },
    langs, defaultLang,
    output: DEFAULT_OUTPUT(),
    theme: themeDefaults(preset),
    shop: DEFAULT_SHOP(),
    requests: [],
    regions: { header: one('nav'), main: pages, footer: one('footer') },
    attachments: {},
  };
}

      // elements of a wildcard container list (columns: 4)
const MAX_REQS = 50;

       // configured requests
const MAX_FIELDS = 50;

     // checkout fields
const MAX_HEADERS = 20;

// Built-in field model for checkout fields when the form block type is not registered (same shape as form items).
const FIELD_FALLBACK_TYPE = {
  itemI18nFields: ['label', 'ph', 'options'],
  itemSchema: [{ key: 'type', type: 'select', options: optList(...FIELD_TYPES) }],
  itemDefaults: () => ({ id: uid(), key: '', type: 'text', label: {}, ph: {}, options: {}, required: false, half: false }),
};

function normFields(list, ctx) {
  const ft = own(BLOCK_TYPES, 'form');
  const t = ft && typeof ft.itemDefaults === 'function' ? ft : FIELD_FALLBACK_TYPE;
  const items = normItems(Array.isArray(list) ? list.slice(0, MAX_FIELDS) : [], t, ctx);
  normFieldKeys(items);
  return items;
}

// Header names browsers refuse to send (fetch "forbidden request headers") plus the ones the contract bans.
const REQ_FORBIDDEN = new Set(['accept-charset', 'accept-encoding', 'access-control-request-headers',
  'access-control-request-method', 'connection', 'content-length', 'cookie', 'cookie2', 'date', 'dnt', 'expect', 'host',
  'keep-alive', 'origin', 'referer', 'set-cookie', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via']);

const REQ_HEADER_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;

// Request URL: absolute http(s) without credentials, a path starting with '/', './', '../', or a browser-local
// endpoint 'local:<collection>[/<key>]' (served by the runtime from the visitor's own storage: zero network,
// CONTRACT.md §8); anything else → '' (unusable). Placeholders {cartId} {orderId} {site} {lang} {currency} {form}
// are kept literally.
function reqURL(u) {
  u = str(u).trim();
  // eslint-disable-next-line no-control-regex
  if (!u || u.length > 2000 || /[\u0000- \u007f"'<>\\`]/.test(u)) return '';
  if (/^https?:\/\/[^/?#@]+(?:[/?#]|$)/i.test(u)) return u;
  if (/^\/(?!\/)/.test(u) || /^\.\.?\//.test(u)) return u;
  if (/^local:[a-z0-9][a-z0-9._-]{0,39}(?:\/[A-Za-z0-9._{}-]{1,80})?$/.test(u)) return u;
  return '';
}

function reqHeaders(h) {
  const list = Array.isArray(h) ? h : isObj(h) ? Object.keys(h).map((k) => ({ k, v: h[k] })) : [];
  const out = [];
  const seen = new Set();
  for (const x of list) {
    if (out.length >= MAX_HEADERS) break;
    if (!isObj(x)) continue;
    const k = str(x.k ?? x.name).trim();
    const v = str(x.v ?? x.value).trim();
    if (!REQ_HEADER_RE.test(k)) continue;
    const lk = k.toLowerCase();
    if (REQ_FORBIDDEN.has(lk) || lk.startsWith('proxy-') || lk.startsWith('sec-') || seen.has(lk)) continue;
    // Values: ≤ 2000 chars, no CR/LF/NUL, Latin-1 only (fetch rejects anything else).
    // eslint-disable-next-line no-control-regex
    if (v.length > 2000 || /[\r\n\u0000]|[^\u0000-ÿ]/.test(v)) continue;
    seen.add(lk);
    out.push({ k, v });
  }
  return out;
}

// Dot path of the item list in a load response ('' = the response itself is the list).
function reqPath(v) {
  if (typeof v !== 'string') return 'items';
  v = v.trim();
  if (!v) return '';
  if (v.length > 120 || !/^[A-Za-z0-9_$-]+(\.[A-Za-z0-9_$-]+){0,9}$/.test(v)) return 'items';
  return v.split('.').some((k) => k === '__proto__' || k === 'constructor' || k === 'prototype') ? 'items' : v;
}

// One configured request → normalized request (CONTRACT.md §2) or null. `seen` (Set of ids) keeps ids unique in a list.
function normalizeRequest(r, seen) {
  if (!isObj(r)) return null;
  const ids = seen instanceof Set ? seen : new Set();
  const d = DEFAULT_REQUEST();
  return {
    id: freshId(r.id, ITEM_ID_RE, ids),
    name: str(r.name).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80) || d.name,
    method: oneOf(str(r.method).trim().toUpperCase(), REQ_METHODS, d.method),
    url: reqURL(r.url),
    headers: reqHeaders(r.headers),
    credentials: oneOf(r.credentials, REQ_CREDENTIALS, d.credentials),
    timeout: Math.round(num(r.timeout, d.timeout, 1000, 60000)),
    retries: Math.round(num(r.retries, d.retries, 0, 5)),
    itemsPath: reqPath(r.itemsPath),
  };
}

const httpURL = (u) => {
  u = str(u).trim();
  return u.length <= 2000 && /^https?:\/\/[^\s"'<>\\`]+$/i.test(u) ? u : '';
};

const normEmail = (v) => {
  v = str(v).trim().replace(/^mailto:/i, '');
  return v.length <= 254 && /^[^\s@<>"',;]+@[^\s@<>"',;]+$/.test(v) ? v : '';
};

const normPhone = (v) => str(v).replace(/[^\d+()\s.-]/g, '').trim().slice(0, 40);

const normTelegram = (v) => {
  v = str(v).trim().replace(/^https?:\/\/(www\.)?t\.me\//i, '').replace(/^@/, '').replace(/\/.*$/, '');
  return /^[A-Za-z0-9_]{3,64}$/.test(v) ? v : '';
};

function normOutput(o, dl) {
  o = isObj(o) ? o : {};
  const od = DEFAULT_OUTPUT();
  const ag = isObj(o.ageGate) ? o.ageGate : {};
  return {
    autodetect: bool(o.autodetect, od.autodetect),
    switcher: oneOf(o.switcher, OUT_SWITCHERS, od.switcher),
    langLabels: oneOf(o.langLabels, ['native', 'code'], od.langLabels),
    themeToggle: bool(o.themeToggle, od.themeToggle),
    toolbarPos: oneOf(o.toolbarPos, OUT_TOOLBAR_POS, od.toolbarPos),
    uiFallback: canonLang(o.uiFallback) || 'en',
    motion: oneOf(o.motion, OUT_MOTIONS, od.motion),
    backToTop: bool(o.backToTop, od.backToTop),
    basePath: normBase(o.basePath),
    ageGate: {
      enabled: bool(ag.enabled, false),
      minAge: Math.round(num(ag.minAge, 18, 1, 99)),
      title: normI18n(ag.title, dl), text: normI18n(ag.text, dl), yes: normI18n(ag.yes, dl), no: normI18n(ag.no, dl),
      noUrl: httpURL(ag.noUrl),
    },
  };
}

function normTheme(th) {
  th = isObj(th) ? th : {};
  const preset = own(THEMES, th.preset) ? th.preset : defaultPreset();
  const td = themeDefaults(preset);
  const col = (k) => safeColor(th[k]) || safeColor(td[k]) || THEME_BASE_VARS[k];
  const fontOK = (f, d) => (typeof f === 'string' && (own(FONT_STACKS, f) != null || /^asset:[a-z0-9]{3,32}$/i.test(f)) ? f : d);
  const fd = (k) => fontOK(td[k], own(FONT_STACKS, 'sans') != null ? 'sans' : Object.keys(FONT_STACKS)[0] || 'sans');
  return {
    preset,
    accent: col('accent'), accent2: col('accent2'), bg: col('bg'), surface: col('surface'),
    text: col('text'), muted: col('muted'), border: col('border'),
    fontBody: fontOK(th.fontBody, fd('fontBody')), fontHead: fontOK(th.fontHead, fd('fontHead')),
    baseSize: round(num(th.baseSize, num(td.baseSize, 17, 14, 22), 14, 22), 1),
    lineHeight: round(num(th.lineHeight, num(td.lineHeight, 1.6, 1.2, 2), 1.2, 2), 2),
    radius: Math.round(num(th.radius, num(td.radius, 10, 0, 28), 0, 28)),
    buttons: oneOf(th.buttons, TH_BUTTONS, oneOf(td.buttons, TH_BUTTONS, 'solid')),
    headings: oneOf(th.headings, TH_HEADINGS, oneOf(td.headings, TH_HEADINGS, 'normal')),
    width: Math.round(num(th.width, num(td.width, 1160, 880, 1440), 880, 1440)),
    space: oneOf(th.space, TH_SPACES, oneOf(td.space, TH_SPACES, 'normal')),
    scheme: oneOf(th.scheme, TH_SCHEMES, oneOf(td.scheme, TH_SCHEMES, 'light')),
  };
}

function normShop(sh, ctx) {
  sh = isObj(sh) ? sh : {};
  const sd = DEFAULT_SHOP();
  const co = isObj(sh.checkout) ? sh.checkout : {};
  const cd = sd.checkout;
  const req = (v) => (typeof v === 'string' && ctx.reqIds.has(v) ? v : null);
  const cur = str(sh.currency).trim().toUpperCase();
  return {
    currency: /^[A-Z]{3}$/.test(cur) ? cur : sd.currency,
    mode: oneOf(sh.mode, SHOP_MODES, sd.mode),
    cartButton: oneOf(sh.cartButton, SHOP_CART_BUTTONS, sd.cartButton),
    sync: oneOf(sh.sync, SHOP_SYNC, sd.sync),
    loadReq: req(sh.loadReq), saveReq: req(sh.saveReq),
    policy: oneOf(sh.policy, SHOP_POLICIES, sd.policy),
    ttlDays: Math.round(num(sh.ttlDays, sd.ttlDays, 1, 365)),
    checkout: {
      method: oneOf(co.method, CO_METHODS, cd.method),
      req: req(co.req),
      fallback: oneOf(co.fallback, CO_FALLBACKS, cd.fallback),
      email: normEmail(co.email), phone: normPhone(co.phone), telegram: normTelegram(co.telegram), url: httpURL(co.url),
      fields: normFields(co.fields, ctx),
      note: normI18n(co.note, ctx.dl), success: normI18n(co.success, ctx.dl),
      minTotal: round(num(co.minTotal, 0, 0, 1e9), 2),
    },
  };
}

// Top level of a document (src: a safe deep copy of untrusted input; the engine normalizes blocks and attachments).
function normalizeTop(src) {
  const [langs, defaultLang] = docLangs(src.langs, src.defaultLang);
  const dl = defaultLang;
  const now = new Date().toISOString();
  const m = isObj(src.meta) ? src.meta : {};
  const attachments = normAttachments(src.attachments, dl);
  const reqSeen = new Set();
  const requests = [];
  if (Array.isArray(src.requests)) {
    for (let i = 0; i < src.requests.length && requests.length < MAX_REQS; i++) {
      const r = normalizeRequest(src.requests[i], reqSeen);
      if (r) requests.push(r);
    }
  }
  const ctx = { dl, seen: new Set(), atts: attachments, reqIds: new Set(requests.map((r) => r.id)), anchorSet: new Set() };
  const img = (v) => (typeof v === 'string' && isImage(own(attachments, v)) ? v : null);
  const regions = isObj(src.regions) ? src.regions : {};
  // Legacy block types become their generic successors first (works → collection, viewer-migrate.js).
  migrateRegions(regions, langs, dl);
  const shop = normShop(src.shop, ctx);
  return {
    format: 'lp-landing',
    version: 1,
    id: typeof src.id === 'string' && ITEM_ID_RE.test(src.id) ? src.id : uid(),
    name: str(src.name).trim().slice(0, 200) || 'Untitled landing',
    meta: {
      title: normI18n(m.title, dl), description: normI18n(m.description, dl),
      author: str(m.author).slice(0, 500), keywords: str(m.keywords).slice(0, 1000),
      ogImage: img(m.ogImage), favicon: img(m.favicon),
      created: str(m.created).slice(0, 40) || now,
      modified: str(m.modified).slice(0, 40) || now,
    },
    langs, defaultLang,
    output: normOutput(src.output, dl),
    theme: normTheme(src.theme),
    shop,
    requests,
    regions: {
      header: normList(regions.header, ctx),
      // Pages (viewer-pages.js): loose blocks of old single-page documents become the home page.
      main: own(BLOCK_TYPES, 'page') ? finishPages(normList(wrapPages(regions.main), ctx)) : normList(regions.main, ctx),
      footer: normList(regions.footer, ctx),
    },
    attachments,
  };
}

// Structural guard used by renderers: docs that do not have the normalized shape are normalized first
// (the renderer additionally escapes/validates every token it interpolates).
function isNormalized(doc) {
  return isObj(doc) && isObj(doc.output) && isObj(doc.output.ageGate) && isObj(doc.theme)
    && (!!own(THEMES, doc.theme.preset) || !Object.keys(THEMES).length) && isObj(doc.shop) && isObj(doc.shop.checkout)
    && Array.isArray(doc.requests) && isObj(doc.meta) && isObj(doc.regions)
    && REGIONS.every((k) => Array.isArray(doc.regions[k])) && isObj(doc.attachments)
    && Array.isArray(doc.langs) && doc.langs.length > 0 && typeof doc.defaultLang === 'string';
}

// Common block props: device visibility, anchor (unique slug), style (px spacing, colours, alignment).
function normCommon(out, b, ctx) {
  out.device = oneOf(b.device, ['all', 'desktop', 'mobile'], 'all');
  out.anchor = normAnchor(b.anchor, ctx);
  const s = isObj(b.style) ? b.style : {};
  const px = (v, min, max) => {
    if (v == null || v === '') return null;
    const n = num(v, null, min, max);
    return n == null ? null : round(n, 1);
  };
  out.style = {
    mt: px(s.mt, -200, 400), mb: px(s.mb, -200, 400), pad: px(s.pad, 0, 240),
    bg: safeColor(s.bg), color: safeColor(s.color),
    align: oneOf(s.align, ['', 'left', 'center', 'right', 'justify'], ''),
  };
  // Content collection of a list block (backend exports, CONTRACT.md §16): a slug, or no key at all.
  const src = normSource(b.source, b.type);
  if (src) out.source = src; else delete out.source;
}

export {
  ANCHOR_RE,
  ANCHOR_RESERVED,
  ANCHOR_RESERVED_RE,
  COMMON_DEFAULTS,
  CO_FALLBACKS,
  CO_METHODS,
  DEFAULT_CHECKOUT,
  DEFAULT_OUTPUT,
  DEFAULT_REQUEST,
  DEFAULT_SHOP,
  FIELD_FALLBACK_TYPE,
  FIELD_KEY_RE,
  FIELD_TYPES,
  MAX_FIELDS,
  MAX_HEADERS,
  MAX_REQS,
  OUT_MOTIONS,
  OUT_SWITCHERS,
  OUT_TOOLBAR_POS,
  REQ_CREDENTIALS,
  REQ_FORBIDDEN,
  REQ_HEADER_RE,
  SHOP_CART_BUTTONS,
  SHOP_MODES,
  SHOP_POLICIES,
  SHOP_SYNC,
  SKU_RE,
  THEME_BASE_VARS,
  THEME_LAYOUT_VARS,
  TH_BUTTONS,
  TH_HEADINGS,
  TH_SCHEMES,
  TH_SPACES,
  defaultPreset,
  httpURL,
  isNormalized,
  newDoc,
  normAnchor,
  normCommon,
  normEmail,
  normFieldKeys,
  normFields,
  normOutput,
  normPhone,
  normShop,
  normSku,
  normTelegram,
  normTheme,
  normalizeRequest,
  normalizeTop,
  reqHeaders,
  reqPath,
  reqURL,
  themeDefaults
};
