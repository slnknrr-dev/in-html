// funding-studio/viewer.js - the funding product: registers its blocks, themes, icons, dictionaries, CSS, runtime
// features and document hooks with the document engine (doc/), and re-exports the API the editor, the templates and
// the backend use. Node-safe (no DOM at module evaluation): the backend renders published pages with it.
import { defineProduct } from '../doc/product.js';
import { rtBlob, rtI18n, rtTheme } from '../doc/runtime-features.js';
import { FORMAT, PREFIX, REGIONS, UI_LANGS, VERSION } from './base.js';
import { COMMON_DEFAULTS, isNormalized, newDoc, normCommon, normalizeTop } from './model.js';
import { BT_A, CLASS_OWNERS_A, CSS_A } from './blocks-a.js';
import { BT_B, CLASS_OWNERS_B, CSS_B } from './blocks-b.js';
import { BT_DONATE, CLASS_OWNERS_DONATE, CSS_DONATE } from './blocks-donate.js';
import { CLASS_OWNERS, CSS_BLOCKS, THEMES_FD, buildCSS } from './design.js';
import { FD_ICONS } from './icons.js';
import { UI_FD } from './dict.js';
import { blockClasses, blockStyle, finishUsage as finishBase, hrefTarget, makeCtx, placeHref, planDoc, renderRoot, routeHref, wrapInner } from './render.js';
import { exportHooks } from './exporthooks.js';
import { rtApi, rtCore, rtCountdown, rtFaq, rtFiles, rtNet, rtPages, rtProgress, rtShare, rtThanks, rtWall } from './runtime.js';
import { rtDonate, rtMBank, rtMBtc, rtMEth, rtMPaypal, rtMStripe, rtMTbc, rtPrice } from './runtime-pay.js';
import { rtQr } from './runtime-qr.js';

Object.assign(CSS_BLOCKS, CSS_A, CSS_B, CSS_DONATE);
CLASS_OWNERS.push(...CLASS_OWNERS_A, ...CLASS_OWNERS_B, ...CLASS_OWNERS_DONATE);

// Runtime features in injection order: core first (R and helpers), transports and shared services next (net, blob,
// i18n, theme, pages, api, qr, price), then method plugins (they register in R.M), then donate (reads R.M), then the
// display features. RT_DEPS pulls prerequisites in automatically, so render code only declares what it uses.
// Note the inversion m-* -> donate: a method without the donate form has nothing to plug into.
export const FEATURE_ORDER = ['core', 'net', 'blob', 'i18n', 'theme', 'pages', 'api', 'qr', 'price', 'm-stripe', 'm-paypal', 'm-tbc', 'm-bank',
  'm-btc', 'm-eth', 'donate', 'progress', 'wall', 'countdown', 'share', 'faq', 'files', 'thanks'];
const RT_FNS = {
  core: rtCore, net: rtNet, blob: rtBlob, i18n: rtI18n, theme: rtTheme, pages: rtPages, api: rtApi, qr: rtQr, price: rtPrice,
  'm-stripe': rtMStripe, 'm-paypal': rtMPaypal, 'm-tbc': rtMTbc, 'm-bank': rtMBank, 'm-btc': rtMBtc, 'm-eth': rtMEth,
  donate: rtDonate, progress: rtProgress, wall: rtWall, countdown: rtCountdown, share: rtShare, faq: rtFaq, files: rtFiles, thanks: rtThanks,
};
const RT_DEPS = {
  api: ['net'], 'm-bank': ['qr'], 'm-btc': ['qr', 'price'], 'm-eth': ['qr', 'price'], 'm-stripe': ['donate'], 'm-paypal': ['donate'], 'm-tbc': ['donate'],
  wall: ['progress'], files: ['blob'], thanks: [], donate: [],
};

// Product part of the usage: network transport when something fetches, every feature needs core.
function finishUsage(ctx, use) {
  const F = use.features;
  const d = ctx.doc;
  if ([...use.methods].some((m) => m === 'btc' || m === 'eth') && d.pay.rates.url) F.add('net');
  for (const id of use.camps) { const p = d.regions.main.find((x) => x.id === id); if (p && p.live && !ctx.api) F.add('net'); }
  if (F.has('share') && use.shareQR) F.add('qr');
  finishBase(ctx, use);
}

// The product definition consumed by the generic document engine (doc/): the engine owns rendering, export, editing
// and normalisation plumbing; this object supplies everything funding-specific. Same engine, different SPEC, for the
// repository's other document products.
const SPEC = {
  prefix: PREFIX, format: FORMAT, version: VERSION, name: 'Untitled campaign',
  regions: REGIONS, uiLangs: UI_LANGS,
  blocks: { ...BT_A, ...BT_B, ...BT_DONATE },
  themes: THEMES_FD,
  icons: FD_ICONS,
  ui: UI_FD,
  commonDefaults: COMMON_DEFAULTS, normCommon, newDoc, normalizeTop, isNormalized,
  anchors: true,
  renderRoot, blockStyle, blockClasses, wrapInner, hrefTarget, finishUsage,
  planDoc, placeHref, routeHref, makeCtx,
  attAnchorTypes: [],
  buildCSS,
  runtime: { fns: RT_FNS, order: FEATURE_ORDER, deps: RT_DEPS },
  exportHooks,
};
defineProduct(SPEC);

// The doc/ registry holds one product per JS realm. A process that loaded another document product after this one
// (the full check.js run imports every module) calls this before using the funding product again.
export function activateProduct() { defineProduct(SPEC); }

export { VERSION, FORMAT, UI_LANGS, REGIONS, DEVICES, METHODS, SERVER_METHODS, SHARE_NETS, normSlug, slugFromTitle, RESERVED_SLUGS } from './base.js';
export { FONT_STACKS, THEMES_FD, palette } from './design.js';
export { DEFAULT_PAY, campaignsOf, homePage, livePages, pageById, pagesOf, thanksPage, themeDefaults, normPay, normRates, paypalMeName } from './model.js';
export { methodReady, campaignMethods, payCfg, campCfg, normAmounts } from './blocks-donate.js';
export { campStats, endTime } from './render.js';
export { siteTitle, pageTitle } from './exporthooks.js';
export { BLOCK_TYPES, ICONS, THEMES, UI } from '../doc/product.js';
export { cloneBlock, newBlock, newDoc, normalizeDoc, walkBlocks } from '../doc/model.js';
export { collectUsage, renderBlock, renderDoc } from '../doc/render.js';
export { exportHTML, extractSource } from '../doc/export.js';
export { uiText } from '../doc/dict.js';
export { uid } from '../util/id.js';
export { own } from '../util/value.js';
