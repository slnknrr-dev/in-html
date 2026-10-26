// landing-studio/viewer.js - the landing product: registers the landing blocks, themes, icons, dictionaries, CSS library, runtime
// features and document hooks with the document engine (doc/), and re-exports the API the editor uses.
import { addUI, defineProduct } from '../doc/product.js';
import { normTable } from '../doc/table.js';
import { num } from '../util/value.js';
import { REGIONS, UI_LANGS, VERSION } from './viewer-base.js';
import { UI_CORE } from './viewer-dict.js';
import { LANDING_ICONS } from './viewer-icons.js';
import { BLOCK_DEPS_A, BT_A, CSS_BLOCKS_A, CSS_VARIANTS_A, OWN_A, UI_A } from './viewer-blocks-a.js';
import { BLOCK_DEPS_B, BT_B, CSS_BLOCKS_B, CSS_VARIANTS_B, OWN_B, UI_B } from './viewer-blocks-b.js';
import { BLOCK_DEPS_C, BT_C, CSS_BLOCKS_C, CSS_VARIANTS_C, OWN_C, UI_C } from './viewer-blocks-c.js';
import { BLOCK_DEPS, CLASS_OWNER, CLASS_OWNER_BASE, CSS_BLOCKS, CSS_SHARED, CSS_VARIANTS, THEMES_BASE, buildCSS } from './viewer-design.js';
import { THEME_SUPRA } from './viewer-theme-supra.js';
import { THEME_KVEVRI } from './viewer-theme-kvevri.js';
import { THEME_FORGE } from './viewer-theme-forge.js';
import { THEME_HARVEST } from './viewer-theme-harvest.js';
import { THEME_COUNSEL } from './viewer-theme-counsel.js';
import { THEME_SHORE } from './viewer-theme-shore.js';
import { THEME_FOLIO } from './viewer-theme-folio.js';
import { THEME_QUIRE } from './viewer-theme-quire.js';
import { THEME_NOCTURNE } from './viewer-theme-nocturne.js';
import { FEATURE_ORDER, RT_DEPS, RT_FNS, RT_HELPERS, UI_RT } from './viewer-runtime.js';
import { COMMON_DEFAULTS, isNormalized, newDoc, normCommon, normFieldKeys, normSku, normalizeTop } from './viewer-model.js';
import { ATT_ANCHOR_TYPES, blockClasses, blockConditional, blockStyle, finishUsage, hrefTarget, planBlock, renderRoot,
  wrapInner } from './viewer-render.js';
import { exportHooks } from './viewer-export.js';
import { BLOCK_DEPS_CHAT, BT_CHAT, CSS_BLOCKS_CHAT, CSS_VARIANTS_CHAT, OWN_CHAT, UI_CHAT } from './viewer-blocks-chat.js';
import { backendCtx } from './viewer-backend.js';
import { BLOCK_DEPS_COL, BT_COL, COL_ICONS, CSS_BLOCKS_COL, CSS_VARIANTS_COL, OWN_COL, UI_COL } from './viewer-blocks-collection.js';
import { BT_PG, UI_PG, pagesCtx, placeHref, planPages, routeHref } from './viewer-pages.js';
import { BD_CAR_CSS, BLOCK_DEPS_D, BT_D, CSS_BLOCKS_D, CSS_VARIANTS_D, OWN_D, UI_D } from './viewer-blocks-d.js';
import { BT_PT, PT_BLOCK_DEPS, PT_SHARED_CSS, UI_PT } from './viewer-blocks-portal.js';
import { PT_FEATURES, PT_FEATURE_DEPS, PT_FEATURE_ORDER } from '../portal/runtime.js';

// Composition root: the only module that knows every part. Block parts export plain registries (BT_*, CSS_*, UI_*,
// OWN_*, rt*) and never import each other's registries; this file merges them into the engine's shared tables and
// calls defineProduct once. Order matters where tables are ordered: FEATURE_ORDER is the order runtime features run
// in the exported bundle, so the portal features are appended after the core ones they depend on. Mutating shared
// maps at import time is acceptable only because this module is imported once, before any render.

// CSS maps of the block parts.
Object.assign(CSS_BLOCKS, CSS_BLOCKS_A, CSS_BLOCKS_B, CSS_BLOCKS_C);
Object.assign(CSS_VARIANTS, CSS_VARIANTS_A, CSS_VARIANTS_B, CSS_VARIANTS_C);
Object.assign(BLOCK_DEPS, BLOCK_DEPS_A, BLOCK_DEPS_B, BLOCK_DEPS_C);
CLASS_OWNER.push(...CLASS_OWNER_BASE, ...OWN_A, ...OWN_B, ...OWN_C);

// Fixups live here, not in the part modules, because they need engine helpers (normTable, normFieldKeys) that the
// registries should not depend on.
// Model fixups of particular types: columns (at most 4, width 5..100 %), tables (merge grid), forms (field keys).
BT_A.columns.listMax = 4;
BT_A.columns.normalize = (out) => { for (const c of out.cols) c.w = num(c.w, 50, 5, 100); };
BT_B.table.normalize = (out, b, ctx) => normTable(out, ctx.dl);
BT_B.form.normalize = (out) => normFieldKeys(out.items);
// Containers without visible children render nothing.
for (const t of [BT_A.section, BT_A.columns]) t.dropEmpty = true;
// Chat block (viewer-blocks-chat.js).
Object.assign(CSS_BLOCKS, CSS_BLOCKS_CHAT);
Object.assign(CSS_VARIANTS, CSS_VARIANTS_CHAT);
Object.assign(BLOCK_DEPS, BLOCK_DEPS_CHAT);
CLASS_OWNER.push(...OWN_CHAT);
addUI(UI_CHAT);
// Collection block (viewer-blocks-collection.js; runtime features in viewer-runtime-collection.js).
Object.assign(CSS_BLOCKS, CSS_BLOCKS_COL);
Object.assign(CSS_VARIANTS, CSS_VARIANTS_COL);
Object.assign(BLOCK_DEPS, BLOCK_DEPS_COL);
CLASS_OWNER.push(...OWN_COL);
addUI(UI_COL);
// List blocks whose items are page structure, not content: never bound to a content collection (`source`).
for (const t of [BT_A.nav, BT_A.hero, BT_A.footer, BT_A.buttons, BT_B.cta, BT_B.form]) if (t) t.noSource = true;

// Pages (viewer-pages.js): the page container and the strings of the default "Not found" page.
addUI(UI_PG);
// Part D blocks (viewer-blocks-d.js): carousel, tabs, comparison table, before / after, announcement, countdown,
// video; the testimonials' quote slider is the same carousel (its CSS joins that variant).
Object.assign(CSS_BLOCKS, CSS_BLOCKS_D);
Object.assign(CSS_VARIANTS, CSS_VARIANTS_D);
Object.assign(BLOCK_DEPS, BLOCK_DEPS_D);
CLASS_OWNER.push(...OWN_D);
addUI(UI_D);
CSS_VARIANTS.testimonials['variant=quote'] = BD_CAR_CSS + `
.lp-ts-quote .lp-ts-fig{align-items:center;gap:18px;max-width:880px;margin-inline:auto;padding:clamp(8px,2cqi,20px) clamp(4px,4cqi,48px);text-align:center}
.lp-ts-quote .lp-ts-q{font-family:var(--lp-font-h);font-size:clamp(1.15em,1em + 1.1cqi,1.62em);line-height:1.45;letter-spacing:-.01em;text-wrap:balance}
.lp-ts-quote .lp-ts-q::before{content:"“";display:block;height:.62em;font-family:Georgia,"Times New Roman",serif;font-size:2.6em;line-height:1;color:var(--lp-accent)}
.lp-ts-quote .lp-ts-by{justify-content:center;text-align:start}
.lp-ts-quote .lp-stars{justify-content:center}
.lp-ts-quote .lp-ts-photo{width:56px}
`;

// Portal blocks (../portal/ through viewer-blocks-portal.js): shared CSS chunks per type (the act's file card uses the
// attachment chunk), runtime features after the landing ones, viewer strings.
Object.assign(CSS_SHARED, PT_SHARED_CSS);
Object.assign(BLOCK_DEPS, PT_BLOCK_DEPS);
BLOCK_DEPS.act = [...BLOCK_DEPS.act, 'att'];
Object.assign(RT_FNS, PT_FEATURES);
FEATURE_ORDER.push(...PT_FEATURE_ORDER);
for (const f of PT_FEATURE_ORDER) RT_DEPS[f] = ['core', ...(PT_FEATURE_DEPS[f] || [])];
addUI(UI_PT);

addUI(UI_CORE);
addUI(UI_A);
addUI(UI_B);
addUI(UI_C);
addUI(UI_RT);

// twoPass (doc/render.js firstPass): exports render twice, because whether a block renders (and so which links
// have a live target) can depend on later content, e.g. a cart shown only when something is purchasable.
defineProduct({
  prefix: 'lp', format: 'lp-landing', version: VERSION, name: 'Untitled landing',
  regions: REGIONS, uiLangs: UI_LANGS,
  blocks: { ...BT_A, ...BT_B, ...BT_C, ...BT_D, ...BT_CHAT, ...BT_COL, ...BT_PT, ...BT_PG },
  themes: { ...THEMES_BASE, ...Object.fromEntries([THEME_SUPRA, THEME_KVEVRI, THEME_FORGE, THEME_HARVEST, THEME_COUNSEL, THEME_FOLIO, THEME_QUIRE, THEME_NOCTURNE, THEME_SHORE].map((t) => [t.key, t])) },
  icons: { ...LANDING_ICONS, ...COL_ICONS },
  commonDefaults: COMMON_DEFAULTS, normCommon, newDoc, normalizeTop, isNormalized, keyNorms: { sku: normSku },
  anchors: true, twoPass: true,
  renderRoot, blockStyle, blockClasses, blockConditional, wrapInner, planBlock, hrefTarget, finishUsage,
  planDoc: planPages, placeHref, routeHref, // pages: the page of every block, URLs per export mode
  attAnchorTypes: ATT_ANCHOR_TYPES, previewTypes: ['embed'],
  buildCSS, runtime: { fns: RT_FNS, order: FEATURE_ORDER, deps: RT_DEPS, helpers: RT_HELPERS },
  exportHooks,
  // Export options `api` (backend exports) → ctx.api; `route` / `page` / `extra.as404` → ctx.route (pages).
  makeCtx: (ctx, opts) => { backendCtx(ctx, opts); pagesCtx(ctx, opts); },
});

// Facade re-exports: the editor imports the engine only through this module, so the product can swap engine pieces
// without touching editor code.
export { DEVICES, CURRENCIES, REQ_METHODS, REGIONS, UI_LANGS, VERSION, CONTACT_KINDS, contactHref } from './viewer-base.js';
export { FONT_STACKS, THEMES_BASE } from './viewer-design.js';
export { collectProducts, formatPrice, formatDay } from './viewer-blocks-c.js';
export { normalizeRequest } from './viewer-model.js';
export { videoEmbed } from './viewer-blocks-d.js';
export { RESERVED_SLUGS, normBase, normSlug, notFoundPage, pageSlugs, routeKey, siteRoutes, slugReserved } from './viewer-pages.js';
export { BLOCK_TYPES, ICONS, THEMES, UI } from '../doc/product.js';
export { cloneBlock, newBlock, newDoc, normalizeDoc, walkBlocks } from '../doc/model.js';
export { collectUsage, renderBlock, renderDoc } from '../doc/render.js';
export { previewKind } from '../doc/attach.js';
export { exportHTML, extractSource } from '../doc/export.js';
export { uiText } from '../doc/dict.js';
export { uid } from '../util/id.js';
export { own } from '../util/value.js';
export { qrMatrix, qrSVG } from '../qr/qr.js';
export { safeColor } from '../color/color.js';
export { langDir, langName, primary } from '../i18n/lang.js';
export { isEmptyText, pickText } from '../i18n/text.js';
