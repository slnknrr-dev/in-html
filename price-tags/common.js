// price-tags/common.js - shared parts of the products and designer pages: the shell (pages resolved from the hidden
// anchors of the page HTML, so the build can rewrite them), app icons, the stored data (products, promotions, markdown
// rules, price history), the demo shop, the tag design settings, pricing (receipt/price.js bestPrice over the
// promotions, item promo prices and expiry markdowns of stock/batches.js), money formatting, unit prices from the pack
// size (units/parse.js) and the "last printed" snapshot that finds the tags to re-print.
//
// Design rules of this module:
// - Money is integer minor units (tetri, cents) everywhere in storage and arithmetic; floats appear only at the edges
//   (parseMinor on input, minorToInput for <input value>). Float prices drift (0.1 + 0.2) and a tag must show exactly
//   the price the till charges.
// - Every value read from localStorage or an import passes a clean*() normaliser: storage is user-editable and
//   survives app versions, so a missing or wrong-typed field is defaulted, never trusted. Upper bounds (20000 products,
//   500 promotions, 5000 history rows) keep one corrupt or hostile blob from freezing the page or filling the quota.
// - Pricing logic lives in shared modules (receipt/price.js, stock/batches.js); this file only adapts the app's data
//   shape to them. One definition of "best price" means the tag and the receipt can never disagree.
// - Dates are local calendar days as 'YYYY-MM-DD' strings: they compare lexicographically, survive JSON, and avoid
//   the UTC shift of Date#toISOString() (which would flip "today" near midnight east of Greenwich).
//
// Side-effect import first: registers this app's i18n keys before any t() below runs.
import './strings.js';
import { startApp, t } from '../ui/app.js';
import { h, lsGet, lsSet } from '../ui/dom.js';
import { addIcons } from '../ui/icons.js';
import { UI_STATE } from '../ui/i18n.js';
import { ancestorsOf, bestPrice, changedItems, priceTags, unitPrice } from '../receipt/price.js';
import { formatMoney as fmtMinor } from '../receipt/money.js';
import { MARKDOWN_DEFAULTS, markdownFor } from '../stock/batches.js';
import { addDays, isDay } from '../stock/calendar.js';
import { completeCheck } from '../barcode/gtin.js';
import { minorUnits, formatMoney as intlMoney } from '../payments/money.js';
import { parseQuantity } from '../units/parse.js';
import { unitLabel } from '../units/registry.js';

// SVG path data (24x24 viewBox, stroke icons) as strings: zero requests, inlined by the bundler.
// 'h.01' draws a near-zero segment that round line caps render as a dot (the tag's hole).
export const LOGO = 'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9zM7.5 7.5h.01';

addIcons({
  tag: LOGO,
  percent: 'M19 5L5 19M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  sheetGrid: 'M4 3h16v18H4zM4 9h16M4 15h16M10 3v18M14 3v18',
  barcode: 'M3 5v14M6 5v14M9.5 5v10M12 5v10M15 5v10M18 5v14M21 5v14',
});

// Tag (product-name) languages, independent of the UI language list: a Georgian shop prints ka + ru/en names.
// Order matters: ORIGIN_NAMES rows are indexed by LANGS.indexOf(lang).
export const LANGS = ['ka', 'ru', 'en'];
export const LANG_NAMES = { ka: 'ქართული', ru: 'Русский', en: 'English' };

// --- shell --------------------------------------------------------------------------------------------------------

// Resolved href of a page from its hidden anchor (the build rewrites anchors when it inlines pages).
// getAttribute, not a.href: .href is absolute (file:///...), which breaks relative links after publishing.
// '#' fallback: a missing anchor degrades to a dead link, not a startup crash.
export function pageHref(id) {
  const a = document.getElementById(id);
  return a ? a.getAttribute('href') : '#';
}

export function startShell(current, onLang) {
  startApp({
    key: 'pt', name: 'pt.name', logo: LOGO, offline: true, onLang,
    pages: [
      { href: pageHref('pg-products'), label: 'pt.page.products', current: current === 'products' },
      { href: pageHref('pg-design'), label: 'pt.page.design', current: current === 'design' },
    ],
  });
}

// --- dates --------------------------------------------------------------------------------------------------------

const pad2 = (n) => String(n).padStart(2, '0');
// Local date from getFullYear/getMonth/getDate, not toISOString().slice(0,10): the latter is UTC and is "yesterday"
// for the first hours of the day in UTC+4 (Tbilisi), which would end promotions early.
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
export const validDay = (s) => typeof s === 'string' && isDay(s);
// '2026-10-24' -> '24.10.2026' (tags), short: '24.10'
export const dayText = (s, short = false) => (validDay(s) ? (short ? `${s.slice(8, 10)}.${s.slice(5, 7)}` : `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`) : '');

// --- data ---------------------------------------------------------------------------------------------------------

const DKEY = 'pt-data';
let seq = 0;
// Id = prefix + time (base36) + per-session counter + random 0..1295 (two base36 digits). The counter makes ids made in
// the same millisecond (bulk import) distinct; the random part separates two tabs started in the same millisecond.
// Not crypto: ids only need to be unique within one shop's data, and stay short in exported files.
export const newId = (p = 'p') => p + Date.now().toString(36) + (++seq).toString(36) + Math.floor(Math.random() * 1296).toString(36);

// Normalized category path: 'Dairy/Cheese' -> 'Dairy / Cheese'.
export const catPath = (s) => String(s ?? '').split('/').map((x) => x.trim()).filter(Boolean).join(' / ');

// Normalise one stored/imported product to the exact shape the app relies on. Rules: money must be a non-negative
// integer (minor units) or it is dropped (promoPrice -> null = no promo; price -> 0); dates must be valid days or '';
// the EAN loses whitespace (scanners and spreadsheets insert spaces in groups); unknown units fall back to 'pcs'
// (the only unit that needs no per-kg logic). Returns null for non-objects so the caller can filter(Boolean).
function cleanProduct(p) {
  if (!p || typeof p !== 'object') return null;
  const name = {};
  for (const l of LANGS) name[l] = typeof p.name?.[l] === 'string' ? p.name[l] : '';
  const money = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
  return {
    id: typeof p.id === 'string' && p.id ? p.id : newId(),
    name, ean: typeof p.ean === 'string' ? p.ean.replace(/\s/g, '') : '',
    code: typeof p.code === 'string' ? p.code : '',
    price: money(p.price) ?? 0,
    promoPrice: money(p.promoPrice), promoFrom: validDay(p.promoFrom) ? p.promoFrom : '', promoTo: validDay(p.promoTo) ? p.promoTo : '',
    unit: ['pcs', 'kg', 'l'].includes(p.unit) ? p.unit : 'pcs',
    size: typeof p.size === 'string' ? p.size : '',
    category: catPath(p.category), origin: typeof p.origin === 'string' ? p.origin : '',
    expires: validDay(p.expires) ? p.expires : '', qty: Number.isFinite(p.qty) && p.qty >= 0 ? p.qty : 0,
  };
}

// A promotion without a valid date range is dropped entirely (null): an open-ended discount is more dangerous than a
// missing one. value <= 0 or non-finite becomes 10 (a visible, obviously-default discount rather than a silent 0).
// kind: anything but 'fixed' is 'percent'. Category paths are re-normalised so they match catPath() of products.
function cleanPromo(p) {
  if (!p || typeof p !== 'object' || !validDay(p.from) || !validDay(p.to)) return null;
  return {
    id: typeof p.id === 'string' && p.id ? p.id : newId('pr'), name: String(p.name ?? ''),
    kind: p.kind === 'fixed' ? 'fixed' : 'percent', value: Number.isFinite(p.value) && p.value > 0 ? p.value : 10,
    items: Array.isArray(p.items) ? p.items.filter((x) => typeof x === 'string') : [],
    categories: Array.isArray(p.categories) ? p.categories.filter((x) => typeof x === 'string').map(catPath) : [],
    from: p.from, to: p.to,
  };
}

// Whole dataset normaliser (storage, JSON import). Caps: products 20000, promotions 500, markdown rules 10, history
// keeps the newest 5000 (slice(-n)). Markdown rules: days rounded to whole days >= 0, pct clamped 0..95 (100% would
// give a free product; the cap leaves a non-zero price on the tag). A missing markdown array means "defaults", an
// empty one means "no markdown" - the distinction is kept by testing Array.isArray, not truthiness of length.
export function cleanData(v) {
  const d = v && typeof v === 'object' ? v : {};
  return {
    products: (Array.isArray(d.products) ? d.products : []).map(cleanProduct).filter(Boolean).slice(0, 20000),
    promotions: (Array.isArray(d.promotions) ? d.promotions : []).map(cleanPromo).filter(Boolean).slice(0, 500),
    markdown: (Array.isArray(d.markdown) ? d.markdown : MARKDOWN_DEFAULTS).filter((r) => r && Number.isFinite(r.days) && Number.isFinite(r.pct)).map((r) => ({ days: Math.max(0, Math.round(r.days)), pct: Math.min(95, Math.max(0, r.pct)) })).slice(0, 10),
    history: (Array.isArray(d.history) ? d.history : []).filter((x) => x && typeof x.item === 'string' && typeof x.at === 'string').slice(-5000),
  };
}

// First run (nothing stored) shows the demo shop so every feature is visible immediately; stored data is re-cleaned
// on every load because older versions or manual edits may have written other shapes.
export const loadData = () => { const v = lsGet(DKEY, null); return v ? cleanData(v) : demoData(); };
export const saveData = (d) => lsSet(DKEY, d);

// A price change for "only changed tags". History is a ring of the newest 5000 entries (same cap as cleanData), so
// an old price change can fall out; changedIds() also compares printed signatures, which covers that gap.
export const notePriceChange = (d, item) => { d.history.push({ item, at: new Date().toISOString() }); if (d.history.length > 5000) d.history.splice(0, d.history.length - 5000); };

// --- demo shop ----------------------------------------------------------------------------------------------------

// Demo shop: a small Georgian grocery chosen to exercise every pricing path - per-kg goods (unit price skipped),
// small packs (per-100 g unit price), near-expiry dairy (markdown), an item promo price (gozinaki), category promos
// (water, cheese), a fixed-price promo (wine) and a future promo (cheese festival, "planned").
const DEMO = [
  // [ka, ru, en, price (tetri), unit, size, category, origin, extra]
  // extra: { expires: days from today, qty: stock, promo: item promo price in tetri }
  ['ბორჯომი', 'Боржоми', 'Borjomi mineral water', 220, 'pcs', '0.5 l', 'Drinks / Water', 'GE'],
  ['ნაბეღლავი', 'Набеглави', 'Nabeghlavi mineral water', 160, 'pcs', '1 l', 'Drinks / Water', 'GE'],
  ['ლაღიძის ტარხუნა', 'Лимонад Лагидзе тархун', 'Lagidze tarragon lemonade', 210, 'pcs', '0.5 l', 'Drinks / Lemonade', 'GE'],
  ['საფერავი, მშრალი წითელი ღვინო', 'Саперави, красное сухое вино', 'Saperavi dry red wine', 2490, 'pcs', '0.75 l', 'Drinks / Wine', 'GE'],
  ['ქინძმარაული, ნახევრადტკბილი', 'Киндзмараули, полусладкое', 'Kindzmarauli semi-sweet red', 3200, 'pcs', '0.75 l', 'Drinks / Wine', 'GE'],
  ['ჭაჭა', 'Чача', 'Chacha grape brandy', 2800, 'pcs', '0.5 l', 'Drinks / Spirits', 'GE'],
  ['სულგუნი', 'Сулугуни', 'Sulguni cheese', 1890, 'kg', '', 'Dairy / Cheese', 'GE'],
  ['იმერული ყველი', 'Имеретинский сыр', 'Imeruli cheese', 950, 'pcs', '500 g', 'Dairy / Cheese', 'GE'],
  ['მაწონი', 'Мацони', 'Matsoni yoghurt', 240, 'pcs', '500 g', 'Dairy', 'GE', { expires: 2, qty: 14 }],
  ['კარაქი 82%', 'Масло сливочное 82%', 'Butter 82%', 640, 'pcs', '200 g', 'Dairy', 'GE', { expires: 1, qty: 6 }],
  ['კეფირი', 'Кефир', 'Kefir', 310, 'pcs', '1 l', 'Dairy', 'GE', { expires: 9, qty: 20 }],
  ['შოთის პური', 'Хлеб шоти', 'Shoti bread', 100, 'pcs', '350 g', 'Bakery', 'GE'],
  ['ჩურჩხელა', 'Чурчхела', 'Churchkhela', 450, 'pcs', '150 g', 'Sweets', 'GE'],
  ['გოზინაყი', 'Гозинаки', 'Gozinaki walnut brittle', 680, 'pcs', '200 g', 'Sweets', 'GE', { promo: 550 }],
  ['ტყლაპი', 'Тклапи', 'Tklapi fruit leather', 290, 'pcs', '100 g', 'Sweets', 'GE'],
  ['ტყემალი', 'Ткемали', 'Tkemali plum sauce', 380, 'pcs', '330 g', 'Grocery / Sauces', 'GE'],
  ['აჯიკა', 'Аджика', 'Adjika', 320, 'pcs', '200 g', 'Grocery / Sauces', 'GE'],
  ['სვანური მარილი', 'Сванская соль', 'Svanetian salt', 350, 'pcs', '100 g', 'Grocery / Spices', 'GE'],
  ['ხმელი სუნელი', 'Хмели-сунели', 'Khmeli suneli', 230, 'pcs', '50 g', 'Grocery / Spices', 'GE'],
  ['მზესუმზირის ზეთი', 'Масло подсолнечное', 'Sunflower oil', 590, 'pcs', '1 l', 'Grocery', 'UA'],
  ['ყავა, დაფქული', 'Кофе молотый', 'Ground coffee', 1250, 'pcs', '250 g', 'Grocery', 'IT'],
  ['თაფლი', 'Мёд', 'Mountain honey', 1500, 'pcs', '500 g', 'Grocery', 'GE'],
  ['ნიგოზი', 'Грецкий орех', 'Walnuts', 2200, 'kg', '', 'Produce', 'GE'],
  ['პომიდორი', 'Помидоры', 'Tomatoes', 420, 'kg', '', 'Produce', 'TR'],
];

// Dates are relative to today so the demo never goes stale (promotions stay active whenever it is opened). Stable
// ids 'd1'..'dN' let e2e tests address products. EAN: '4860' (Georgia GS1 prefix) + 8 digits, check digit computed
// by completeCheck, so the barcodes are valid and scannable. Passed through cleanData like any other input.
export function demoData() {
  const day = today();
  const products = DEMO.map(([ka, ru, en, price, unit, size, category, origin, x = {}], i) => ({
    id: 'd' + (i + 1), name: { ka, ru, en }, ean: completeCheck('4860' + String(1001 + i * 7).padStart(8, '0')), code: String(10 + i * 3).padStart(4, '0'),
    price, unit, size, category, origin,
    promoPrice: x.promo ?? null, promoFrom: x.promo ? addDays(day, -2) : '', promoTo: x.promo ? addDays(day, 12) : '',
    expires: x.expires != null ? addDays(day, x.expires) : '', qty: x.qty ?? 0,
  }));
  const promotions = [
    { id: 'pr-water', name: 'Water days', kind: 'percent', value: 15, items: [], categories: ['Drinks / Water'], from: addDays(day, -3), to: addDays(day, 10) },
    { id: 'pr-wine', name: 'Wine week', kind: 'fixed', value: 1990, items: ['d4'], categories: [], from: addDays(day, -1), to: addDays(day, 6) },
    { id: 'pr-cheese', name: 'Cheese festival', kind: 'percent', value: 10, items: [], categories: ['Dairy / Cheese'], from: addDays(day, 7), to: addDays(day, 14) },
  ];
  return cleanData({ products, promotions, markdown: MARKDOWN_DEFAULTS, history: [] });
}

// --- design settings ------------------------------------------------------------------------------------------------

export const TEMPLATES = ['classic', 'promo', 'minimal', 'wobbler', 'strip'];
// Sizes in mm with default font sizes (pt): name, price, small text. 58x40 and 70x37 are common thermal label rolls,
// 90x60 a shelf-edge card, A6 a promo poster; 'custom' (null) keeps the user's w/h. Picking a size resets fonts.
export const SIZES = {
  '58x40': { w: 58, h: 40, f: { name: 9, price: 34, small: 5.5 } },
  '70x37': { w: 70, h: 37, f: { name: 9.5, price: 32, small: 5.5 } },
  '90x60': { w: 90, h: 60, f: { name: 13, price: 54, small: 7 } },
  'a6': { w: 105, h: 148, f: { name: 20, price: 110, small: 10 } },
  'strip': { w: 100, h: 30, f: { name: 9, price: 30, small: 5.5 } },
  'custom': null,
};
export const BARCODES = ['ean', 'code128', 'datamatrix', 'none'];
export const BASES = ['auto', 'kg', '100g'];

export const DESIGN_DEF = {
  template: 'classic', size: '58x40', w: 58, h: 40,
  fonts: { name: 9, price: 34, small: 5.5 }, font: 'sans', bold: true,
  lang: 'ka', lang2: 'ru',
  currency: 'GEL', symbol: '₾', symbolPos: 'after', decimal: ',', cents: 'small',
  unitPrice: true, basis: 'auto', barcode: 'ean', origin: true, date: true, printCode: 'T01', border: true,
  accent: '#d61f26',
  sheet: { margin: 8, gap: 0, marks: true, which: 'all', copies: 1 },
};
const SKEY = 'pt-design';

// Merge stored design over the defaults key by key, accepting a stored value only if its type equals the default's.
// Why not Object.assign: a stored string where a number is expected (old version, manual edit) would reach SVG
// arithmetic as NaN. Two nested objects (fonts, sheet) are merged one level deep the same way; keys unknown to
// DESIGN_DEF are dropped. Then enumerations are validated and size is clamped to what fits on A4 (210 x 297 mm minus
// a minimal margin: w <= 200, h <= 287).
export function loadDesign() {
  const v = lsGet(SKEY, null) || {};
  const d = structuredClone(DESIGN_DEF);
  for (const k of Object.keys(d)) {
    if (k === 'fonts' || k === 'sheet') { if (v[k] && typeof v[k] === 'object') for (const kk of Object.keys(d[k])) if (typeof v[k][kk] === typeof d[k][kk]) d[k][kk] = v[k][kk]; }
    else if (v[k] != null && typeof v[k] === typeof d[k]) d[k] = v[k];
  }
  if (!TEMPLATES.includes(d.template)) d.template = 'classic';
  if (!(d.size in SIZES)) d.size = '58x40';
  if (SIZES[d.size]) { d.w = SIZES[d.size].w; d.h = SIZES[d.size].h; }
  d.w = Math.min(200, Math.max(20, d.w)); d.h = Math.min(287, Math.max(15, d.h));
  if (!LANGS.includes(d.lang)) d.lang = 'ka';
  if (d.lang2 && !LANGS.includes(d.lang2)) d.lang2 = '';
  if (!BARCODES.includes(d.barcode)) d.barcode = 'ean';
  if (!BASES.includes(d.basis)) d.basis = 'auto';
  return d;
}
export const saveDesign = (d) => lsSet(SKEY, d);

// --- money --------------------------------------------------------------------------------------------------------

export const digitsOf = (D) => minorUnits(D.currency);
// Symbol of a currency (narrow: ₾, €, $); the code when Intl has none. Formats 1 unit and strips digits, spaces and
// separators - whatever remains is the symbol. Locale-independent parsing of Intl output, which has no API for it.
export function currencySymbol(code) {
  const s = String(intlMoney(1, code, 'en', { whole: true })).replace(/[\d\s., ]/g, '');
  return s || code;
}
// Minor units -> '18,90' (the design's decimal mark, thin-space groups).
export const money = (v, D) => fmtMinor(v, { digits: digitsOf(D), decimal: D.decimal, group: ' ' });
export const moneyCur = (v, D) => (D.symbolPos === 'before' ? D.symbol + money(v, D) : money(v, D) + ' ' + D.symbol);
// Typed amount -> minor units or null. Accepts both decimal marks: every '.' or ',' that is followed by another
// separator later is a group separator and removed (lookahead), the last one is the decimal mark. So '1.234,56',
// '1,234.56' and '18,9' all parse. Ambiguity accepted: '1,234' reads as 1.234, not 1234 - on a price input a
// decimal is far more likely than a thousands group. Negative -> null (no negative prices). Math.round absorbs
// float error of n * 100 (18.9 * 100 = 1889.9999...).
export function parseMinor(text, D) {
  const s = String(text ?? '').trim().replace(/[^\d.,-]/g, '');
  if (!s) return null;
  const n = Number(s.replace(/[.,](?=\d*[.,])/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10 ** digitsOf(D)) : null;
}
export const minorToInput = (v, D) => (v == null ? '' : (v / 10 ** digitsOf(D)).toFixed(digitsOf(D)));

// --- pricing ------------------------------------------------------------------------------------------------------

// Category tree from the products' paths: 'Drinks / Water' has the parent 'Drinks'. Derived, never stored: the tree
// is whatever the products say, so it cannot go out of sync. Every prefix becomes a node, so a promotion on 'Drinks'
// reaches 'Drinks / Water' through ancestorsOf().
export function categoryNodes(products) {
  const nodes = new Map();
  for (const p of products) {
    const parts = p.category ? p.category.split(' / ') : [];
    for (let i = 0; i < parts.length; i++) {
      const id = parts.slice(0, i + 1).join(' / ');
      if (!nodes.has(id)) nodes.set(id, { id, parent: i ? parts.slice(0, i).join(' / ') : null });
    }
  }
  return nodes;
}

/**
 * Price in effect today for every product: the shop promotions, the product's own promo price (an imported "old
 * price" column or the edit form) and the expiry markdown (stock/batches.js markdownFor) compete in bestPrice; the
 * lowest wins. -> Map id -> { base, price, promo, kind: 'promo' | 'markdown' | null, pct, markdown }
 *
 * Approach: express every discount source as a synthetic promotion and let one function choose. The alternative
 * (separate code paths with precedence rules) needs a policy for "promo AND markdown" and is where tag/till mismatches
 * come from. The item promo gets id 'item:<id>' and the markdown id 'markdown' so the winner's origin is recoverable.
 * The markdown promo is valid only for `at` (from = to = at): it is recomputed daily as expiry approaches.
 * Cost: promotions are copied per product, O(products x promotions); fine at the 20000 x 500 caps of cleanData.
 * pct for a fixed promo is derived from the price drop, for the "-15 %" badge. No division by zero: bestPrice only
 * accepts a promo with price < base, which is impossible at base 0 (prices are non-negative).
 */
export function pricesFor(data, at = today()) {
  const nodes = categoryNodes(data.products);
  const out = new Map();
  for (const p of data.products) {
    const promos = [...data.promotions];
    if (p.promoPrice != null && p.promoFrom && p.promoTo) promos.push({ id: 'item:' + p.id, name: '', kind: 'fixed', value: p.promoPrice, items: [p.id], from: p.promoFrom, to: p.promoTo });
    const md = p.expires ? markdownFor([{ batch: p.id, expires: p.expires, qty: p.qty || 1 }], data.markdown, at) : null;
    if (md && md.pct > 0) promos.push({ id: 'markdown', name: '', kind: 'percent', value: md.pct, items: [p.id], from: at, to: at });
    const ancestors = p.category ? [p.category, ...ancestorsOf(nodes, p.category)] : [];
    const r = bestPrice({ item: p.id, itemPrice: p.price, ancestors, promotions: promos, at });
    const pct = r.promo ? (r.promo.kind === 'percent' ? r.promo.value : Math.round((1 - r.price / r.base) * 100)) : 0;
    out.set(p.id, { ...r, kind: r.promo ? (r.promo.id === 'markdown' ? 'markdown' : 'promo') : null, pct, markdown: md });
  }
  return out;
}

// Grams / millilitres of a pack ('500 g', '0,75 л', '330 მლ') -> { qty, kind: 'mass' | 'volume' } | null.
// parseQuantity returns SI base units (kg, l... per units/parse.js); x1000 and rounding give integer g/ml, which keeps
// unitPrice() in integer arithmetic. Counts, lengths etc. return null: no comparable unit price exists for them.
export function packOf(size) {
  const q = parseQuantity(size);
  if (!q || !['mass', 'volume'].includes(q.kind) || !(q.base > 0)) return null;
  return { qty: Math.round(q.base * 1000), kind: q.kind };
}

/**
 * Unit price for comparison: { per: 'kg' | 'l' | 'g' | 'ml', amount (1 or 100), price } | null. Products sold by
 * weight or volume already have a price per kg / l. basis: 'kg' (per kg / l), '100g' (per 100 g / ml), 'auto'
 * (per 100 g / ml for packs of 100 g / ml or less).
 */
export function unitPriceOf(p, price, basis = 'auto') {
  if (p.unit !== 'pcs' || price == null) return null;
  const pack = packOf(p.size);
  if (!pack) return null;
  const small = basis === '100g' || (basis === 'auto' && pack.qty <= 100);
  const per = small ? 100 : 1000;
  return { per: pack.kind === 'mass' ? (small ? 'g' : 'kg') : (small ? 'ml' : 'l'), amount: small ? 100 : 1, price: unitPrice(price, pack.qty, per) };
}
export const unitText = (code, lang) => unitLabel(code, lang) || code;

// Name fallback chain: requested language, then en, ka, ru - a tag must never print blank if any translation exists.
export const pickName = (p, lang) => p.name[lang] || p.name.en || p.name.ka || p.name.ru || '';
export const uiName = (p) => pickName(p, LANGS.includes(UI_STATE.lang) ? UI_STATE.lang : 'en');

// Country names of the usual origins in the tag languages (Intl.DisplayNames often has no Georgian region names).
const ORIGIN_NAMES = {
  GE: ['საქართველო', 'Грузия', 'Georgia'], AM: ['სომხეთი', 'Армения', 'Armenia'], AZ: ['აზერბაიჯანი', 'Азербайджан', 'Azerbaijan'],
  TR: ['თურქეთი', 'Турция', 'Turkey'], UA: ['უკრაინა', 'Украина', 'Ukraine'], RU: ['რუსეთი', 'Россия', 'Russia'], DE: ['გერმანია', 'Германия', 'Germany'],
  IT: ['იტალია', 'Италия', 'Italy'], FR: ['საფრანგეთი', 'Франция', 'France'], ES: ['ესპანეთი', 'Испания', 'Spain'], NL: ['ნიდერლანდები', 'Нидерланды', 'Netherlands'],
  PL: ['პოლონეთი', 'Польша', 'Poland'], CN: ['ჩინეთი', 'Китай', 'China'], US: ['აშშ', 'США', 'USA'], IR: ['ირანი', 'Иран', 'Iran'], BY: ['ბელარუსი', 'Беларусь', 'Belarus'],
};

// Country of origin in a language: ISO codes by the table above or Intl.DisplayNames, other text as typed.
// try/catch: Intl.DisplayNames throws RangeError for an unsupported locale on some engines and is missing on old ones.
export function originText(o, lang) {
  if (!/^[A-Z]{2}$/.test(o || '')) return o || '';
  const own = ORIGIN_NAMES[o]?.[LANGS.indexOf(lang)];
  if (own) return own;
  try { return new Intl.DisplayNames([lang], { type: 'region' }).of(o) || o; } catch { return o; }
}

/**
 * Tag data of products (priceTags of receipt/price.js plus the designer's fields).
 * -> [{ id, product, name, name2, price, old, pct, badge, kind, text: { price, old }, unit, size, origin, ean, code, expires }]
 */
// priceTags() returns tags in input order, so base[i] pairs with products[i] (index join, no lookup). name2 is empty
// when the second language equals the first (no duplicate line). expires / until are filled only when relevant to
// the winning discount: an expiry date on a tag that is not marked down would only confuse shoppers.
export function tagData(products, prices, D, at = today()) {
  const digits = digitsOf(D);
  const base = priceTags(products.map((p) => ({ item: p.id, name: pickName(p, D.lang), code: p.ean, price: prices.get(p.id) })), { digits, decimal: D.decimal, currency: D.symbol, day: at });
  return base.map((tg, i) => {
    const p = products[i], pr = prices.get(p.id);
    return {
      id: p.id, product: p, name: tg.name, name2: D.lang2 && D.lang2 !== D.lang ? (p.name[D.lang2] || '') : '',
      price: tg.price, old: tg.old, pct: pr.pct, kind: pr.kind, promoName: tg.badge, text: tg.text,
      unit: unitPriceOf(p, tg.price, D.basis), sold: p.unit, size: p.size, origin: originText(p.origin, D.lang),
      ean: p.ean, code: p.code, expires: pr.kind === 'markdown' ? p.expires : '', until: pr.kind === 'promo' ? pr.promo.to : '', day: at,
    };
  });
}

// --- printed snapshot ---------------------------------------------------------------------------------------------

const PKEY = 'pt-printed';
// Signature = the visible content of a tag joined by '|'. Comparing signatures, not timestamps, catches changes that
// leave no history entry (a promotion starting by date, a renamed product). Design changes are deliberately not part
// of it: re-styling should not mark the whole shop as "to re-print".
export const tagSig = (tg) => [tg.price, tg.old ?? '', tg.pct, tg.name, tg.name2, tg.expires].join('|');
export const loadPrinted = () => { const v = lsGet(PKEY, null); return v && typeof v.at === 'string' && v.sig && typeof v.sig === 'object' ? v : null; };
// Merge, not replace: printing only the dairy shelf must not forget what was printed for drinks.
export function markPrinted(tags) {
  const prev = loadPrinted();
  const sig = { ...(prev?.sig || {}) };
  for (const tg of tags) sig[tg.id] = tagSig(tg);
  lsSet(PKEY, { at: new Date().toISOString(), sig });
}
export const forgetPrinted = () => lsSet(PKEY, null);

/**
 * Tags to re-print since the last printed set: changedItems of receipt/price.js over the price history after the
 * snapshot, plus every tag whose printed content differs (a promotion started or ended, a name changed). Without a
 * snapshot everything is changed.
 */
export function changedIds(tags, data) {
  const snap = loadPrinted();
  if (!snap) return new Set(tags.map((x) => x.id));
  const differs = tags.filter((x) => snap.sig[x.id] !== tagSig(x)).map((x) => x.id);
  const known = new Set(tags.map((x) => x.id));
  return new Set(changedItems(data.history, snap.at, { promoted: differs }).filter((id) => known.has(id)));
}

// --- small widgets ------------------------------------------------------------------------------------------------

let gid = 0;
// Labelled group for non-input controls (segmented choices): the label names the group. A <label for> only works for
// labelable elements (input, select...), so a button group gets aria-labelledby pointing at a span with a unique id
// (module counter; ids only need to be unique per document).
export function group(label, control, hint) {
  const id = 'pt-g' + (++gid);
  control.setAttribute('aria-labelledby', id);
  return h('div', { class: 'ed-field' }, h('span', { class: 'ed-label', id }, t(label)), control, hint ? h('div', { class: 'ed-hint' }, t(hint)) : null);
}
