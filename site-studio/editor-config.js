// site-studio/editor-config.js - the landing editor configuration: device-width stage, site settings tabs (theme, shop, requests,
// languages, output, SEO), anchors and device visibility of blocks, SKU bookkeeping, in-page link targets.
//
// Role: the generic studio (../studio/) knows nothing about landing pages; this object is the whole difference between
// it and a site editor. Every hook here is optional on the studio side, so the composition is declarative: products
// plug behaviour in by data, not by forking studio code. Hooks that need pages (mainList, outlineRegion...) are
// forwarded from editor-pages.js so that module remains the single owner of page logic.
import { h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { langLabel } from '../ui/lang.js';
import { t } from '../ui/i18n.js';
import { P } from '../doc/product.js';
import { walk } from '../studio/doc.js';
import { section } from '../studio/fields.js';
import { renderInspector, setBlockProp } from '../studio/inspector.js';
import { deviceStage } from '../studio/stage.js';
import { fieldsBox, fontOptions, langsTab, metaTab, presetCards, resetThemeButton, themeRender, uploadFontButton } from '../studio/right.js';
import { DEVICES, FONT_STACKS } from './viewer.js';
import { cleanSku, docSells, dsShop, fixSkus, itemWithSku, productCount, skuProblem } from './editor-shop.js';
import { dsAuth } from './editor-auth.js';
import { dsMap, dsSeo } from './editor-sitemap.js';
import { MARKDOWN_IMPORTER, dsReadme } from './editor-readme.js';
import { WIKI_CONTROLS, WIKI_ICONS, dsWiki } from './editor-wiki.js';
import { dsRequests, reqControl } from './editor-requests.js';
import { EXPORT_MODES, exportCheck } from './editor-export.js';
import { normSource, sourceType } from './viewer-backend.js';
import { COLLECTION_CONTROLS } from './editor-collection.js';
import { PAGES_EDITOR, dsPages, pageBlockMenu, pageStage, pagesOf, syncBar } from './editor-pages.js';

// The "no" exit of the age gate leaves the site; an http target would be a downgrade, so only https is accepted.
const httpsOK = (u) => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };

// --- site settings ---------------------------------------------------------------

// themeRender (studio) decides per key whether a theme change needs a canvas re-render or only CSS variables.
function dsTheme(body) {
  body.append(presetCards((v) => [v.accent, v.accent2, v.surface, v.text], (v) => v.bg));
  const colors = fieldsBox(['accent', 'accent2', 'bg', 'surface', 'text', 'muted', 'border']
    .map((key) => ({ key, type: 'color', noClear: true, label: 'th.' + key })), 'theme', themeRender, 'ed-grid2');
  body.append(section('ds-colors', t('ds.colors'), h('div', {}, colors, resetThemeButton())));
  const fo = fontOptions();
  const typo = fieldsBox([
    { key: 'fontBody', type: 'select', options: fo, noSeg: true, label: 'th.fontBody' },
    { key: 'fontHead', type: 'select', options: fo, noSeg: true, label: 'th.fontHead' },
    { key: 'baseSize', type: 'range', min: 14, max: 22, step: 0.5, unit: ' px', label: 'th.baseSize' },
    { key: 'lineHeight', type: 'range', min: 1.2, max: 2, step: 0.05, label: 'th.lineHeight' },
  ], 'theme', themeRender);
  typo.append(uploadFontButton());
  body.append(section('ds-typo', t('ds.typography'), typo));
  body.append(section('ds-look', t('ds.look'), fieldsBox([
    { key: 'radius', type: 'range', min: 0, max: 28, step: 1, unit: ' px', label: 'th.radius' },
    { key: 'buttons', type: 'select', label: 'th.buttons', options: ['solid', 'pill', 'square', 'outline'].map((v) => ({ v, l: 'th.btn.' + v })) },
    { key: 'headings', type: 'select', noSeg: true, label: 'th.headings', options: ['normal', 'caps', 'italic', 'underline', 'eyebrow'].map((v) => ({ v, l: 'th.hd.' + v })) },
    { key: 'width', type: 'range', min: 880, max: 1440, step: 10, unit: ' px', label: 'th.width' },
    { key: 'space', type: 'select', label: 'th.space', options: ['compact', 'normal', 'airy'].map((v) => ({ v, l: 'th.sp.' + v })) },
    { key: 'scheme', type: 'select', label: 'th.scheme', options: ['light', 'auto', 'dark'].map((v) => ({ v, l: 'th.sc.' + v })) },
  ], 'theme', themeRender)));
}

function dsOutput(body) {
  const uiLangs = P.uiLangs || ['en'];
  body.append(section('ds-out-lang', t('ds.outLangs'), fieldsBox([
    { key: 'autodetect', type: 'checkbox', label: 'op.autodetect' },
    { key: 'switcher', type: 'select', label: 'op.switcher', options: ['buttons', 'select', 'none'].map((v) => ({ v, l: 'op.sw.' + v })) },
    { key: 'langLabels', type: 'select', label: 'op.langLabels', noSeg: true, options: ['native', 'code'].map((v) => ({ v, l: 'op.ll.' + v })) },
    { key: 'uiFallback', type: 'select', label: 'op.uiFallback', noSeg: true, options: uiLangs.map((v) => ({ v, text: langLabel(v) })) },
  ], 'output')));
  body.append(section('ds-out-tools', t('ds.outTools'), fieldsBox([
    { key: 'themeToggle', type: 'checkbox', label: 'op.themeToggle' },
    { key: 'toolbarPos', type: 'select', label: 'op.toolbarPos', noSeg: true, hint: 'op.toolbarHint', options: ['nav', 'top-right', 'bottom-right', 'bottom-left'].map((v) => ({ v, l: 'op.tb.' + v })) },
  ], 'output')));
  body.append(section('ds-out-page', t('ds.outPage'), fieldsBox([
    { key: 'motion', type: 'select', label: 'op.motion', options: ['none', 'fade', 'rise'].map((v) => ({ v, l: 'op.mo.' + v })) },
    { key: 'backToTop', type: 'checkbox', label: 'op.backToTop' },
  ], 'output')));
  // The age gate is not part of the edit canvas: texts never re-render it.
  body.append(section('ds-age', t('ds.ageGate'), fieldsBox([
    { key: 'enabled', type: 'checkbox', label: 'op.ageEnabled', hint: 'op.ageHint' },
    { key: 'minAge', type: 'number', label: 'op.minAge', min: 12, max: 25, step: 1, when: { enabled: true } },
    { key: 'title', type: 'i18n', label: 'op.ageTitle', when: { enabled: true } },
    { key: 'text', type: 'i18n', label: 'op.ageText', multiline: true, rows: 2, when: { enabled: true } },
    { key: 'yes', type: 'i18n', label: 'op.ageYes', when: { enabled: true } },
    { key: 'no', type: 'i18n', label: 'op.ageNo', when: { enabled: true } },
    { key: 'noUrl', type: 'text', inputType: 'url', label: 'op.noUrl', placeholderText: 'https://', hint: 'op.noUrlHint', when: { enabled: true }, check: (v) => (!v || httpsOK(v) ? '' : t('sh.urlBad')) },
  ], 'output.ageGate', 'none')));
}

// Attachment-typed meta (favicon, ogImage) is listed again in metaAttKeys below, so attachment GC keeps them alive.
const dsMeta = metaTab([
  { key: 'title', type: 'i18n', label: 'seo.title' },
  { key: 'description', type: 'i18n', label: 'seo.description', multiline: true, rows: 3 },
  { key: 'author', type: 'text', label: 'seo.author' },
  { key: 'keywords', type: 'text', label: 'seo.keywords' },
  { key: 'favicon', type: 'att', label: 'seo.favicon', accept: 'image/', hint: 'ds.faviconHint' },
  { key: 'ogImage', type: 'att', label: 'seo.ogImage', accept: 'image/', hint: 'ds.ogHint' },
]);

// --- editor configuration -------------------------------------------------------

const DEVICE_ICONS = { desktop: 'monitor', laptop: 'laptop', tablet: 'tablet', phone: 'phone' };

export const LANDING_EDITOR = {
  fileExt: 'site',
  // Palette order: what the user needs first (structure, content) before specialised groups.
  categories: ['structure', 'content', 'commerce', 'services', 'data', 'media', 'wiki', 'language', 'portal', 'account', 'layout'],
  fontStacks: FONT_STACKS,
  // Device widths, with the page switcher in front of them (editor-pages.js).
  stage: pageStage(deviceStage(Object.entries(DEVICES).map(([k, w]) => [k, w, DEVICE_ICONS[k] || 'monitor']))),
  typeIcons: {
    nav: 'menu', hero: 'hero', footer: 'footer', section: 'section', columns: 'columns', divider: 'divider', spacer: 'spacer',
    heading: 'heading', text: 'type', quote: 'quote', buttons: 'button', features: 'grid', stats: 'chart', steps: 'steps',
    timeline: 'timeline', team: 'users', testimonials: 'chat', logos: 'award', faq: 'help', cta: 'megaphone',
    contact: 'mail', table: 'table', form: 'send', products: 'bag', pricing: 'tag', events: 'calendar', cart: 'cart',
    image: 'image', gallery: 'gallery', embed: 'embed', works: 'music', collection: 'layers', qr: 'qr', chat: 'chat',
    carousel: 'film', tabs: 'layout', compare: 'sheet', beforeafter: 'flip', announce: 'pin', countdown: 'refresh', video: 'play', page: 'file',
    act: 'doc', terms: 'keyvalue', directory: 'users', board: 'megaphone', hub: 'stack', checklist: 'check', finder: 'search',
    diagram: 'chart', markdown: 'hash', formula: 'sigma', booking: 'calendar', event: 'star', map: 'pin', estate: 'store', donate: 'sparkle',
    datatable: 'sheet', units: 'sliders', barcode: 'scan', contract: 'doc', account: 'user',
    ...WIKI_ICONS,
  },
  // [id, label key, renderer]; the order is the tab order of Site settings. Ids are referenced by openDocTab(id).
  docTabs: [['pages', 'ds.pages', dsPages], ['theme', 'ds.theme', dsTheme], ['shop', 'ds.shop', dsShop], ['auth', 'ds.auth', dsAuth], ['wiki', 'ds.wiki', dsWiki], ['requests', 'ds.requests', dsRequests],
    ['langs', 'ds.langs', langsTab], ['output', 'ds.output', dsOutput], ['meta', 'ds.seo', dsMeta], ['seofiles', 'seo.title', dsSeo], ['map', 'sm.title', dsMap], ['readme', 'rd.title', dsReadme]],
  importers: [MARKDOWN_IMPORTER],
  // Theme keys that change classes in the markup, not just CSS variables: changing them requires a canvas re-render.
  themeMarkupKeys: ['preset', 'buttons', 'headings', 'space'],
  // Two 'hidden' entries with complementary `show`: the same flag reads "hidden" on a block but "draft" on a page.
  commonFields: [
    { key: 'hidden', type: 'checkbox', label: 'f.hidden', show: (b) => b.type !== 'page' },
    { key: 'hidden', type: 'checkbox', label: 'pg.toggleDraft', show: (b) => b.type === 'page' },
    { key: 'langs', type: 'langs', show: (b) => b.type !== 'page' },
    { key: 'device', type: 'select', options: [{ v: 'all' }, { v: 'desktop' }, { v: 'mobile' }], show: (b) => b.type !== 'page' },
    // Content collection of a list block (backend exports: edited in the admin console, published as data/<name>.json).
    { key: 'source', type: 'text', label: 'f.source', hint: 'fh.source', placeholderText: 'products', wide: true,
      show: (b) => sourceType(b.type), check: (v, b) => (!v || normSource(v, b.type) ? '' : t('ins.sourceBad')) },
  ],
  styleFields: [
    { key: 'mt', type: 'number', min: 0, max: 240, step: 4, unit: 'px', nullable: true },
    { key: 'mb', type: 'number', min: 0, max: 240, step: 4, unit: 'px', nullable: true },
    { key: 'pad', type: 'number', min: 0, max: 160, step: 4, unit: 'px', nullable: true, wide: true },
    { key: 'bg', type: 'color' },
    { key: 'color', type: 'color' },
    { key: 'align', type: 'select', options: [{ v: '', l: 'fld.default' }, { v: 'left' }, { v: 'center' }, { v: 'right' }], wide: true },
  ],
  fieldControls: { req: reqControl, ...WIKI_CONTROLS, ...COLLECTION_CONTROLS, ...PAGES_EDITOR.fieldControls },
  // Per-item field hooks by key: sku gets validation and normalization wherever an item schema declares it.
  itemFields: { sku: { check: skuProblem, clean: cleanSku } },
  blockMenu: (b) => {
    const dev = b.device || 'all';
    return [
      { label: t('blk.devAll'), checked: dev === 'all', action: () => { setBlockProp(b.id, 'device', 'all'); renderInspector(); } },
      { label: t('blk.devDesktop'), checked: dev === 'desktop', action: () => { setBlockProp(b.id, 'device', 'desktop'); renderInspector(); } },
      { label: t('blk.devMobile'), checked: dev === 'mobile', action: () => { setBlockProp(b.id, 'device', 'mobile'); renderInspector(); } },
      ...pageBlockMenu(b),
    ];
  },
  // Counts top-level sections only (directly in a region or a page); nested sections are layout detail.
  statusItems: (doc) => {
    let sections = 0;
    walk((b, list, i, parent) => { if ((!parent || parent.type === 'page') && b.type === 'section') sections++; }, doc);
    const n = productCount(doc);
    const pages = pagesOf(doc).filter((p) => p.kind !== 'notfound').length;
    queueMicrotask(syncBar); // the page switcher follows renames, new and deleted pages
    return [
      pages > 1 ? h('span', { class: 'ed-st-item' }, iconEl('file'), t('pg.countN', { n: pages })) : null,
      h('span', { class: 'ed-st-item' }, iconEl('section'), t('st.sections', { n: sections })),
      n ? h('span', { class: 'ed-st-item' }, iconEl('bag'), t('st.products', { n })) : null,
    ].filter(Boolean);
  },
  linkExtras: (doc) => [
    { href: '#top', label: t('rt.link.top') },
    ...(docSells(doc) ? [{ href: '#cart', label: t('rt.link.cart') }] : []),
    ...(doc && doc.langs.length > 1 ? doc.langs.map((l) => ({ href: '#lang=' + l, label: t('rt.link.lang', { lang: langLabel(l) }) })) : []),
  ],
  // Pages, sections on them and the special targets, grouped by page (editor-pages.js).
  linkTargets: PAGES_EDITOR.linkTargets,
  mainList: PAGES_EDITOR.mainList,
  renderOpts: PAGES_EDITOR.renderOpts,
  outlineRegion: PAGES_EDITOR.outlineRegion,
  // Translatable objects outside the block tree, so language tools (copy / missing-translation checks) reach them too.
  i18nRoots: (doc) => [doc.output && doc.output.ageGate, doc.shop && doc.shop.checkout],
  metaAttKeys: ['ogImage', 'favicon'],
  // SKU hooks: new blocks fill empty product SKUs; copies only resolve collisions (an empty SKU on a copy stays empty).
  onNewBlock: (b, doc) => fixSkus(b, doc, true),
  onCopy: (b, doc) => fixSkus(b, doc),
  onNewItem: (b, it) => itemWithSku(b, it),
  // Export packages (single file, static archive, backend archives) and the check before every export.
  exportModes: EXPORT_MODES,
  exportCheck,
};

