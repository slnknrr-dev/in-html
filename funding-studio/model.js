// funding-studio/model.js - the funding document: top level (meta, output, theme, organisation, public payment
// configuration, server), common block props, pages (campaigns and the thank-you page) and their order.
//
// Document (format 'fd-funding', version 1):
//   { format, version, id, name, meta: { title, description, author, keywords, ogImage, favicon, created, modified },
//     langs, defaultLang,
//     output: { autodetect, switcher: 'buttons' | 'select' | 'none', themeToggle, uiFallback },
//     theme: { preset, accent, accent2, bg, surface, text, muted, border, fontBody, fontHead, baseSize, radius, width,
//              buttons: 'solid' | 'pill' | 'square', scheme: 'light' | 'dark' | 'auto' },
//     org: { name{}, email, website, address{}, regNo, note{} }            (receipts, footer)
//     pay: { stripe, paypal, tbc, bank, btc, eth, rates }                   (public data only: links, addresses)
//     server: { url, live }                                                 (backend for static exports)
//     regions: { header: [nav], main: [page, page, …], footer: [footer] }, attachments }
// A page is a `campaign` block (blocks-a.js): kind 'campaign' (goal, currency, dates, methods) or 'thanks'.
// Secrets never live here: provider keys are entered in the backend's admin console only.
//
// Normalisation contract: every norm*() accepts anything (an old file, a hand-edited JSON, a hostile upload) and
// returns the exact shape above with safe values - unknown keys dropped, strings capped and single-lined, colours via
// safeColor, numbers clamped, enums via oneOf, URLs restricted to http(s) with no quote/angle/backslash characters
// (they end up in href attributes of exported pages), payment identifiers validated (IBAN checksum, BIC form,
// Bitcoin address network, EIP-55). Invalid entries are dropped silently: opening a file must never fail, and the
// editor's checks report what is missing. This is also the backend's defence: published documents go through it.
import { isImage } from '../doc/attach.js';
import { safeColor } from '../color/color.js';
import { canonLang } from '../i18n/lang.js';
import { normI18n } from '../i18n/text.js';
import { ITEM_ID_RE, docLangs, freshId, newBlock, normAttachments, normList } from '../doc/model.js';
import { BLOCK_TYPES, THEMES } from '../doc/product.js';
import { uid } from '../util/id.js';
import { bool, isObj, num, oneOf, own, round, str } from '../util/value.js';
import { normIBAN, validBIC, validIBAN } from '../payments/iban.js';
import { btcAddressInfo, ethChecksum, isEthAddress, EVM_CHAINS, TOKENS } from './chains.js';
import { FORMAT, ISO_RE, REGIONS, normSlug, RESERVED_SLUGS } from './base.js';

export const FONT_KEYS = ['sans', 'humanist', 'geometric', 'rounded', 'serif', 'slab', 'condensed', 'mono'];

export const COMMON_DEFAULTS = () => ({
  hidden: false, langs: null, device: 'all', anchor: '',
  style: { mt: null, mb: null, pad: null, bg: '', color: '', align: '' },
});

export const DEFAULT_OUTPUT = () => ({ autodetect: true, switcher: 'buttons', themeToggle: true, uiFallback: 'en' });

export const THEME_BASE = {
  accent: '#2563eb', accent2: '#0ea5e9', bg: '#ffffff', surface: '#f4f6f9', text: '#1f2937', muted: '#5b6472',
  border: '#dfe3ea', fontBody: 'sans', fontHead: 'sans', baseSize: 17, radius: 12, width: 1120, buttons: 'solid', scheme: 'auto',
};

export const DEFAULT_PAY = () => ({
  stripe: { links: [], any: '', buy: '', pk: '' },
  paypal: { mode: 'hosted', hosted: '', business: '', me: '', sandbox: false },
  tbc: { links: [], any: '', iban: '', holder: '', swift: 'TBCBGE22' },
  bank: { iban: '', bic: '', holder: '', bank: '', address: '', purpose: {}, epc: true },
  btc: { address: '', pool: [], network: 'main', label: '' },
  eth: { address: '', chains: [1, 8453], tokens: ['ETH', 'USDC'], custom: [] },
  rates: { fixed: {}, url: '', paths: { BTC: '', ETH: '', USD: '' } },
});

export const DEFAULT_ORG = () => ({ name: {}, email: '', website: '', address: {}, regNo: '', note: {} });

// URL filters. Host part excludes '/?#@' and whitespace/quotes so userinfo tricks ('https://bank.com@evil') and
// attribute breakouts are impossible; control characters rejected. httpsURL is used for payment links (a donor
// must never be sent to a plain-http payment page); httpURL for informational links.
const httpsURL = (u) => {
  u = str(u).trim();
  // eslint-disable-next-line no-control-regex
  return u.length <= 2000 && /^https:\/\/[^\s"'<>\\`/?#@]+(?:[/?#][^\s"'<>\\`]*)?$/i.test(u) && !/[\u0000-\u001f]/.test(u) ? u : '';
};
export const httpURL = (u) => {
  u = str(u).trim();
  return u.length <= 2000 && /^https?:\/\/[^\s"'<>\\`/?#@]+(?:[/?#][^\s"'<>\\`]*)?$/i.test(u) ? u : '';
};
export const normEmail = (v) => {
  v = str(v).trim().replace(/^mailto:/i, '');
  return v.length <= 254 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(v) ? v : '';
};
const cur = (v, d = 'EUR') => { const c = str(v).trim().toUpperCase(); return ISO_RE.test(c) ? c : d; };
const amount = (v, d = 0) => round(num(v, d, 0, 1e9), 2);
const line = (v, n = 200) => str(v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, n);

// Theme of a preset: base values overridden by the preset's vars.
export function themeDefaults(preset) {
  const p = own(THEMES, preset);
  const v = p && isObj(p.vars) ? p.vars : {};
  const t = { preset, ...THEME_BASE };
  for (const k of Object.keys(THEME_BASE)) { const x = own(v, k); if (typeof x === 'string' || typeof x === 'number') t[k] = x; }
  return t;
}
export const defaultPreset = () => (own(THEMES, 'clean') ? 'clean' : Object.keys(THEMES)[0] || 'clean');

function normTheme(th) {
  th = isObj(th) ? th : {};
  const preset = own(THEMES, th.preset) ? th.preset : defaultPreset();
  const d = themeDefaults(preset);
  const col = (k) => safeColor(th[k]) || safeColor(d[k]) || THEME_BASE[k];
  const font = (k) => (FONT_KEYS.includes(th[k]) || /^asset:[a-z0-9]{3,32}$/i.test(str(th[k])) ? th[k] : FONT_KEYS.includes(d[k]) ? d[k] : 'sans');
  return {
    preset,
    accent: col('accent'), accent2: col('accent2'), bg: col('bg'), surface: col('surface'), text: col('text'), muted: col('muted'), border: col('border'),
    fontBody: font('fontBody'), fontHead: font('fontHead'),
    baseSize: round(num(th.baseSize, num(d.baseSize, 17, 14, 22), 14, 22), 1),
    radius: Math.round(num(th.radius, num(d.radius, 12, 0, 28), 0, 28)),
    width: Math.round(num(th.width, num(d.width, 1120, 880, 1440), 880, 1440)),
    buttons: oneOf(th.buttons, ['solid', 'pill', 'square'], oneOf(d.buttons, ['solid', 'pill', 'square'], 'solid')),
    scheme: oneOf(th.scheme, ['light', 'dark', 'auto'], oneOf(d.scheme, ['light', 'dark', 'auto'], 'auto')),
  };
}

function normOutput(o) {
  o = isObj(o) ? o : {};
  const d = DEFAULT_OUTPUT();
  return {
    autodetect: bool(o.autodetect, d.autodetect),
    switcher: oneOf(o.switcher, ['buttons', 'select', 'none'], d.switcher),
    themeToggle: bool(o.themeToggle, d.themeToggle),
    uiFallback: canonLang(o.uiFallback) || 'en',
  };
}

function normOrg(o, dl) {
  o = isObj(o) ? o : {};
  return {
    name: normI18n(o.name, dl), email: normEmail(o.email), website: httpURL(o.website), address: normI18n(o.address, dl),
    regNo: line(o.regNo, 80), note: normI18n(o.note, dl),
  };
}

// Payment links of one method: [{ id, amount, cur, int, url }] (https only, unique ids, at most 40).
function normLinks(list, seen, withCur = true) {
  const out = [];
  for (const l of Array.isArray(list) ? list : []) {
    if (!isObj(l) || out.length >= 40) continue;
    const u = httpsURL(l.url);
    const a = amount(l.amount);
    if (!u || !(a > 0)) continue;
    const x = { id: freshId(l.id, ITEM_ID_RE, seen), amount: a, url: u };
    if (withCur) { x.cur = cur(l.cur); x.int = oneOf(l.int, ['once', 'month'], 'once'); }
    out.push(x);
  }
  return out;
}

const btcList = (v, network) => {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\s,;]+/) : [];
  const out = [];
  for (const a of raw) {
    const s = str(a).trim();
    const i = s ? btcAddressInfo(s) : null;
    if (i && i.ok && (i.network === network || (network === 'test' && i.network === 'regtest')) && !out.includes(s) && out.length < 500) out.push(s);
  }
  return out;
};

// 'https://paypal.me/Name/10' or 'Name' -> 'Name' ('' when not a paypal.me name).
export function paypalMeName(v) {
  const s = str(v).trim().replace(/^(https?:\/\/)?(www\.)?paypal\.me\//i, '').replace(/[/?#].*$/, '');
  return /^[A-Za-z0-9]{1,20}$/.test(s) ? s : '';
}

// Fixed rates 'SYM:CUR' -> price (max 40 pairs); the price URL must be https (it is fetched by visitors' browsers);
// JSON paths allow only [A-Za-z0-9_${}.-] - they are walked as property names, never evaluated.
export function normRates(r) {
  r = isObj(r) ? r : {};
  const fixed = {};
  const src = isObj(r.fixed) ? r.fixed : {};
  for (const k of Object.keys(src)) {
    const m = /^([A-Z]{3,5}):([A-Z]{3})$/.exec(k.toUpperCase());
    const v = num(src[k], 0, 0, 1e12);
    if (m && v > 0 && Object.keys(fixed).length < 40) fixed[m[1] + ':' + m[2]] = v;
  }
  const p = isObj(r.paths) ? r.paths : {};
  const path = (x) => { const s = str(x).trim(); return /^[A-Za-z0-9_${}.-]{1,120}$/.test(s) ? s : ''; };
  return { fixed, url: httpsURL(r.url), paths: { BTC: path(p.BTC), ETH: path(p.ETH), USD: path(p.USD) } };
}

// Public payment configuration. Shape checks per provider double as a guard against pasting secrets into a public
// page: Stripe accepts only 'pk_' publishable keys and 'buy_btn_' ids (an 'sk_' secret key fails the pattern and is
// dropped), PayPal a hosted button id / email / merchant id, paypal.me a bare name. All link lists share one id set so
// item ids stay unique across methods. Bitcoin addresses must match the chosen network (regtest allowed for 'test').
export function normPay(p, dl) {
  p = isObj(p) ? p : {};
  const d = DEFAULT_PAY();
  const seen = new Set();
  const s = isObj(p.stripe) ? p.stripe : {};
  const pp = isObj(p.paypal) ? p.paypal : {};
  const tb = isObj(p.tbc) ? p.tbc : {};
  const bk = isObj(p.bank) ? p.bank : {};
  const bt = isObj(p.btc) ? p.btc : {};
  const et = isObj(p.eth) ? p.eth : {};
  const network = oneOf(bt.network, ['main', 'test'], 'main');
  const chains = Array.isArray(et.chains) ? [...new Set(et.chains.map(Number).filter((c) => own(EVM_CHAINS, String(c))))].slice(0, 8) : d.eth.chains;
  const custom = [];
  for (const t of Array.isArray(et.custom) ? et.custom : []) {
    if (!isObj(t) || custom.length >= 20) continue;
    const sym = str(t.symbol).trim().toUpperCase();
    const ch = Number(t.chain);
    if (!/^[A-Z0-9]{2,10}$/.test(sym) || !own(EVM_CHAINS, String(ch)) || !isEthAddress(t.address)) continue;
    custom.push({ id: freshId(t.id, ITEM_ID_RE, seen), chain: ch, symbol: sym, address: ethChecksum(t.address), decimals: Math.round(num(t.decimals, 18, 0, 36)), usd: bool(t.usd, false) });
  }
  const tokenNames = new Set(['ETH', 'POL', ...Object.keys(TOKENS), ...custom.map((t) => t.symbol)]);
  const tokens = Array.isArray(et.tokens) ? [...new Set(et.tokens.map((x) => str(x).toUpperCase()).filter((x) => tokenNames.has(x)))] : d.eth.tokens;
  const iban = (v) => (validIBAN(v) ? normIBAN(v) : '');
  const bic = (v) => (validBIC(v) ? str(v).trim().toUpperCase() : '');
  return {
    stripe: {
      links: normLinks(s.links, seen), any: httpsURL(s.any),
      buy: /^buy_btn_[A-Za-z0-9]{6,60}$/.test(str(s.buy).trim()) ? str(s.buy).trim() : '',
      pk: /^pk_(test|live)_[A-Za-z0-9]{6,200}$/.test(str(s.pk).trim()) ? str(s.pk).trim() : '',
    },
    paypal: {
      mode: oneOf(pp.mode, ['hosted', 'business', 'me'], d.paypal.mode),
      hosted: /^[A-Z0-9]{5,20}$/.test(str(pp.hosted).trim()) ? str(pp.hosted).trim() : '',
      business: normEmail(pp.business) || (/^[A-Z0-9]{10,20}$/.test(str(pp.business).trim()) ? str(pp.business).trim() : ''),
      me: paypalMeName(pp.me),
      sandbox: bool(pp.sandbox, false),
    },
    tbc: { links: normLinks(tb.links, seen, false), any: httpsURL(tb.any), iban: iban(tb.iban), holder: line(tb.holder, 140), swift: bic(tb.swift) || 'TBCBGE22' },
    bank: {
      iban: iban(bk.iban), bic: bic(bk.bic), holder: line(bk.holder, 70), bank: line(bk.bank, 140), address: line(bk.address, 200),
      purpose: normI18n(bk.purpose, dl), epc: bool(bk.epc, true),
    },
    btc: { address: btcList([bt.address], network)[0] || '', pool: btcList(bt.pool, network), network, label: line(bt.label, 60) },
    eth: { address: isEthAddress(et.address) ? ethChecksum(et.address) : '', chains: chains.length ? chains : [1], tokens: tokens.length ? tokens : ['ETH'], custom },
    rates: normRates(p.rates),
  };
}

function normServer(s) {
  s = isObj(s) ? s : {};
  let url = httpURL(s.url);
  if (url) url = url.replace(/[?#].*$/, '').replace(/\/*$/, '/');
  return { url, live: bool(s.live, true) };
}

/* ---------- pages ---------- */

// Raw main region -> page blocks: loose blocks before the first page form the first campaign, later loose blocks join
// the page in front of them, pages nested in a page move up next to it.
function wrapPages(list) {
  const out = [];
  let curPage = null;
  for (const b of Array.isArray(list) ? list.filter(isObj) : []) {
    if (b.type === 'campaign') {
      const kids = Array.isArray(b.blocks) ? b.blocks.filter(isObj) : [];
      curPage = { ...b, blocks: kids.filter((x) => x.type !== 'campaign') };
      out.push(curPage);
      for (const x of kids) if (x.type === 'campaign') out.push({ ...x, blocks: (Array.isArray(x.blocks) ? x.blocks : []).filter((y) => isObj(y) && y.type !== 'campaign') });
    } else if (curPage) curPage.blocks.push(b);
    else { curPage = { type: 'campaign', kind: 'campaign', blocks: [b] }; out.unshift(curPage); }
  }
  return out;
}

// Unique page slugs: normalized, reserved ones suffixed, duplicates numbered, empty ones from the kind.
// Also: at most one thank-you page (extra ones become campaigns - payment returns need one unambiguous target) and at
// least one campaign. Slugs become directory names and '#/<slug>' routes, hence uniqueness and reserved names
// (e.g. 'api', 's' that the backend owns).
export function finishPages(pages, dl) {
  const used = new Set();
  let thanks = false;
  for (const p of pages) {
    if (p.kind === 'thanks') { if (thanks) p.kind = 'campaign'; else thanks = true; }
  }
  if (!pages.some((p) => p.kind === 'campaign') && own(BLOCK_TYPES, 'campaign')) pages.unshift(newBlock('campaign', { title: { [dl]: 'Campaign' } }));
  let n = 0;
  for (const p of pages) {
    n++;
    let s = normSlug(p.slug) || (p.kind === 'thanks' ? 'thanks' : n === 1 ? 'campaign' : 'campaign-' + n);
    if (RESERVED_SLUGS.has(s)) s += '-page';
    let c = s;
    for (let k = 2; used.has(c); k++) c = s + '-' + k;
    used.add(c);
    p.slug = c;
  }
  return pages;
}

/* ---------- common block props ---------- */

// Block anchors become element ids: lowercase, start with a letter, unique per document, and never in the generated
// id spaces (b-*, att-*, p-*, fd-*) or the router's words, so a user anchor cannot collide with engine ids or routes.
const ANCHOR_RE = /^[a-z][a-z0-9-]{0,40}$/;
const ANCHOR_RESERVED = new Set(['top', 'lang', 'thanks']);
export function normAnchor(v, ctx) {
  const s = str(v).trim().toLowerCase();
  if (!s || !ANCHOR_RE.test(s) || ANCHOR_RESERVED.has(s) || /^(?:(?:b|att|p)-[a-z0-9]+|fd-.*)$/.test(s) || ctx.anchorSet.has(s)) return '';
  ctx.anchorSet.add(s);
  return s;
}

export function normCommon(out, b, ctx) {
  out.device = oneOf(b.device, ['all', 'desktop', 'mobile'], 'all');
  out.anchor = normAnchor(b.anchor, ctx);
  const s = isObj(b.style) ? b.style : {};
  const px = (v, min, max) => (v == null || v === '' ? null : (() => { const n = num(v, null, min, max); return n == null ? null : round(n, 1); })());
  out.style = { mt: px(s.mt, -200, 400), mb: px(s.mb, -200, 400), pad: px(s.pad, 0, 240), bg: safeColor(s.bg), color: safeColor(s.color), align: oneOf(s.align, ['', 'left', 'center', 'right'], '') };
}

/* ---------- document ---------- */

export function newDoc(opts = {}) {
  const [langs, defaultLang] = docLangs(opts.langs, opts.defaultLang);
  const preset = own(THEMES, opts.theme) ? opts.theme : defaultPreset();
  const now = new Date().toISOString();
  const has = (t) => !!own(BLOCK_TYPES, t);
  const pages = has('campaign') ? [
    newBlock('campaign', { kind: 'campaign', slug: 'campaign', blocks: ['hero', 'progress', 'donate'].filter(has).map((t) => newBlock(t, t === 'donate' ? { anchor: 'donate' } : {})) }),
    newBlock('campaign', { kind: 'thanks', slug: 'thanks', blocks: has('thanks') ? [newBlock('thanks')] : [] }),
  ] : [];
  return {
    format: FORMAT, version: 1, id: uid(), name: str(opts.name).trim().slice(0, 200) || 'Untitled campaign',
    meta: { title: {}, description: {}, author: '', keywords: '', ogImage: null, favicon: null, created: now, modified: now },
    langs, defaultLang,
    output: DEFAULT_OUTPUT(),
    theme: themeDefaults(preset),
    org: DEFAULT_ORG(),
    pay: DEFAULT_PAY(),
    server: { url: '', live: true },
    regions: { header: has('nav') ? [newBlock('nav')] : [], main: pages, footer: has('footer') ? [newBlock('footer')] : [] },
    attachments: {},
  };
}

export function normalizeTop(src) {
  const [langs, defaultLang] = docLangs(src.langs, src.defaultLang);
  const dl = defaultLang;
  const now = new Date().toISOString();
  const m = isObj(src.meta) ? src.meta : {};
  const attachments = normAttachments(src.attachments, dl);
  const ctx = { dl, seen: new Set(), atts: attachments, reqIds: new Set(), anchorSet: new Set() };
  const img = (v) => (typeof v === 'string' && isImage(own(attachments, v)) ? v : null);
  const regions = isObj(src.regions) ? src.regions : {};
  return {
    format: FORMAT, version: 1,
    id: typeof src.id === 'string' && ITEM_ID_RE.test(src.id) ? src.id : uid(),
    name: str(src.name).trim().slice(0, 200) || 'Untitled campaign',
    meta: {
      title: normI18n(m.title, dl), description: normI18n(m.description, dl),
      author: str(m.author).slice(0, 500), keywords: str(m.keywords).slice(0, 1000),
      ogImage: img(m.ogImage), favicon: img(m.favicon),
      created: str(m.created).slice(0, 40) || now, modified: str(m.modified).slice(0, 40) || now,
    },
    langs, defaultLang,
    output: normOutput(src.output),
    theme: normTheme(src.theme),
    org: normOrg(src.org, dl),
    pay: normPay(src.pay, dl),
    server: normServer(src.server),
    regions: {
      header: normList(regions.header, ctx),
      main: own(BLOCK_TYPES, 'campaign') ? finishPages(normList(wrapPages(regions.main), ctx), dl) : normList(regions.main, ctx),
      footer: normList(regions.footer, ctx),
    },
    attachments,
  };
}

export function isNormalized(doc) {
  return isObj(doc) && doc.format === FORMAT && isObj(doc.output) && isObj(doc.theme) && isObj(doc.org) && isObj(doc.pay)
    && isObj(doc.pay.stripe) && isObj(doc.pay.rates) && isObj(doc.server) && isObj(doc.meta) && isObj(doc.regions)
    && REGIONS.every((k) => Array.isArray(doc.regions[k])) && isObj(doc.attachments)
    && Array.isArray(doc.langs) && doc.langs.length > 0 && typeof doc.defaultLang === 'string';
}

// The pages of a document in order (campaign blocks of the main region).
export const pagesOf = (doc) => (doc && doc.regions && Array.isArray(doc.regions.main) ? doc.regions.main.filter((b) => isObj(b) && b.type === 'campaign') : []);
export const campaignsOf = (doc) => pagesOf(doc).filter((p) => p.kind === 'campaign');
// Published pages: not drafts. The first published campaign is the home page.
export const livePages = (doc) => pagesOf(doc).filter((p) => !p.hidden);
export const homePage = (doc) => livePages(doc).find((p) => p.kind === 'campaign') || livePages(doc)[0] || null;
export const thanksPage = (doc) => livePages(doc).find((p) => p.kind === 'thanks') || null;
export const pageById = (doc, id) => pagesOf(doc).find((p) => p.id === id) || null;
