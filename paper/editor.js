// paper/editor.js - editor configuration shared by paper-document products (studio/config.js): paper stage, document
// settings tabs (theme, layout, page, languages, output, metadata), print-related block props, appendix attachments.
// A product spreads PAPER_EDITOR into defineEditor() and adds its file extension, categories, icons and link types.
//
// Contract: declarative field lists consumed by studio/right.js fieldsBox(). Each field list names a document path
// ('theme', 'page.margin', ...) and a render scope: 'css' re-renders only the stylesheet (cheap, no DOM rebuild, keeps
// the caret), 'all' re-renders the canvas. Picking the narrowest scope is the main perf lever of the editor.
// Ranges here are UI ranges; paper/model.js holds the hard limits and must be at least as wide.
// Side-effect imports: register every editor UI language before any t() call below runs.
import './i18n-en.js';
import './i18n-ru.js';
import './i18n-uk.js';
import './i18n-de.js';
import './i18n-fr.js';
import './i18n-es.js';
import './i18n-ka.js';
import { P } from '../doc/product.js';
import { h } from '../ui/dom.js';
import { isFontMime, isImageMime } from '../ui/files.js';
import { langLabel } from '../ui/lang.js';
import { t } from '../ui/i18n.js';
import { S } from '../studio/state.js';
import { commit } from '../studio/history.js';
import { section } from '../studio/fields.js';
import { toggleBlockProp } from '../studio/ops.js';
import { renderOutline } from '../studio/left.js';
import { paperStage } from '../studio/stage.js';
import { fieldsBox, fontOptions, langsTab, metaTab, presetCards, renderDocSettings, resetThemeButton, themeRender,
  uploadFontButton } from '../studio/right.js';
import { PAGE_SIZES } from './base.js';
import { FONT_STACKS, LAYOUTS } from './themes.js';

// --- document settings ---------------------------------------------------------

// presetCards gets a 4-colour swatch extractor per preset: the preview is computed from data, not maintained images.
function dsTheme(body) {
  body.append(presetCards((v) => [v.accent, v.text, v.sideBg || v.bg, v.bg]));
  const colors = fieldsBox([
    { key: 'accent', type: 'color', noClear: true },
    { key: 'text', type: 'color', noClear: true },
    { key: 'muted', type: 'color', noClear: true },
    { key: 'bg', type: 'color', noClear: true },
    { key: 'sideBg', type: 'color', clearValue: 'transparent' },
    { key: 'sideText', type: 'color' },
  ], 'theme', themeRender, 'ed-grid2');
  body.append(section('ds-colors', t('ds.colors'), h('div', {}, colors, resetThemeButton())));
  const fo = fontOptions();
  const typo = fieldsBox([
    { key: 'fontBody', type: 'select', options: fo, noSeg: true },
    { key: 'fontHead', type: 'select', options: fo, noSeg: true },
    { key: 'baseSize', type: 'range', min: 8, max: 14, step: 0.5, unit: ' pt' },
    { key: 'lineHeight', type: 'range', min: 1, max: 2, step: 0.05 },
  ], 'theme', themeRender);
  typo.append(uploadFontButton());
  body.append(section('ds-typo', t('ds.typography'), typo));
  body.append(section('ds-look', t('ds.look'), fieldsBox([
    { key: 'density', type: 'select', options: [{ v: 'compact' }, { v: 'normal' }, { v: 'airy' }] },
    // NOTE: this option list duplicates HEADING_STYLES (themes.js); keep them in sync or use HEADING_STYLES.map.
    { key: 'headingStyle', type: 'select', noSeg: true, options: ['line', 'band', 'plain', 'caps', 'underline', 'side'].map((v) => ({ v })) },
    { key: 'radius', type: 'range', min: 0, max: 16, step: 1, unit: ' px' },
    { key: 'scheme', type: 'select', noSeg: true, options: [{ v: 'light' }, { v: 'auto' }, { v: 'dark' }] },
  ], 'theme', themeRender)));
}

const LAYOUT_SVG = {
  single: '<rect x="4" y="3" width="32" height="6" rx="1"/><rect x="4" y="11" width="32" height="20" rx="1"/>',
  'sidebar-left': '<rect x="4" y="3" width="32" height="6" rx="1"/><rect x="4" y="11" width="10" height="20" rx="1"/><rect x="16" y="11" width="20" height="20" rx="1"/>',
  'sidebar-right': '<rect x="4" y="3" width="32" height="6" rx="1"/><rect x="4" y="11" width="20" height="20" rx="1"/><rect x="26" y="11" width="10" height="20" rx="1"/>',
  'two-col': '<rect x="4" y="3" width="32" height="6" rx="1"/><rect x="4" y="11" width="15" height="20" rx="1"/><rect x="21" y="11" width="15" height="20" rx="1"/>',
};
// Layout keys that only feed the stylesheet (column gap, sidebar width).
const layoutRender = (k) => (k === 'gap' || k === 'sideWidth' ? 'css' : 'all');

// Changing layout type re-renders all and rebuilds the settings pane, because the visible option set depends on the type.
function dsLayout(body) {
  const L = S.doc.layout;
  const cards = h('div', { class: 'ed-layout-grid' }, LAYOUTS.map((k) => h('button', {
    type: 'button', class: 'ed-layout-card' + (L.type === k ? ' ed-on' : ''), 'aria-pressed': String(L.type === k),
    onclick: () => { commit('layout', () => { S.doc.layout.type = k; }, { render: 'all' }); renderDocSettings(); renderOutline(); },
  }, h('span', { class: 'ed-layout-ic', html: `<svg viewBox="0 0 40 34" aria-hidden="true">${LAYOUT_SVG[k] || LAYOUT_SVG.single}</svg>` }), h('span', {}, t('l.' + k)))));
  body.append(section('ds-layouts', t('ds.layout'), cards));
  const sideish = L.type === 'sidebar-left' || L.type === 'sidebar-right';
  const flds = [];
  // Two equal columns ignore sideWidth (buildCSS); the range matches what normalizeDoc keeps (15–50 %).
  if (sideish) flds.push({ key: 'sideWidth', type: 'range', min: 15, max: 50, step: 1, unit: '%' });
  flds.push({ key: 'gap', type: 'number', min: 0, max: 30, step: 0.5, unit: 'mm' });
  flds.push({ key: 'headerFull', type: 'checkbox' });
  if (L.type === 'single') flds.push({ key: 'sideInSingle', type: 'select', options: [{ v: 'before' }, { v: 'after' }] });
  body.append(section('ds-layout-opts', t('ds.look'), fieldsBox(flds, 'layout', layoutRender)));
}

function dsPage(body) {
  body.append(section('ds-page', t('ds.page'), fieldsBox([
    { key: 'size', type: 'select', label: 'ds.pageSize', noSeg: true, options: Object.keys(PAGE_SIZES).map((v) => ({ v })) },
    { key: 'pageNumbers', type: 'checkbox' },
    { key: 'numberFormat', type: 'select', options: [{ v: 'n' }, { v: 'n/N' }, { v: 'page' }], when: { pageNumbers: true } },
    { key: 'header', type: 'i18n', label: 'ds.pgHeader' },
    { key: 'footer', type: 'i18n', label: 'ds.pgFooter' },
  ], 'page')));
  const m = fieldsBox(['top', 'right', 'bottom', 'left'].map((k) => ({
    key: k, type: 'number', min: 0, max: 50, step: 0.5, unit: 'mm', label: 'ds.m' + k[0].toUpperCase() + k.slice(1),
  })), 'page.margin', 'css', 'ed-grid2');
  body.append(section('ds-margins', t('ds.margins'), m));
  body.append(h('p', { class: 'ed-hint' }, t('ds.pgHint')));
}

function dsOutput(body) {
  const uiLangs = P.uiLangs || ['en'];
  body.append(section('ds-out-lang', t('ds.langs'), fieldsBox([
    { key: 'autodetect', type: 'checkbox' },
    { key: 'switcher', type: 'select', options: [{ v: 'buttons' }, { v: 'select' }, { v: 'none' }] },
    { key: 'langLabels', type: 'select', noSeg: true, options: [{ v: 'native', l: 'o.nativeNames' }, { v: 'code', l: 'o.code' }] },
    { key: 'uiFallback', type: 'select', noSeg: true, options: uiLangs.map((v) => ({ v, text: langLabel(v) })) },
  ], 'output')));
  body.append(section('ds-out-tb', t('ds.toolbar'), fieldsBox([
    { key: 'printButton', type: 'checkbox' },
    { key: 'themeToggle', type: 'checkbox' },
    { key: 'toolbarPos', type: 'select', noSeg: true, options: ['top-right', 'top-left', 'bottom-right', 'bottom-left'].map((v) => ({ v })) },
  ], 'output')));
  body.append(section('ds-out-screen', t('ds.screen'), fieldsBox([
    { key: 'paper', type: 'checkbox' },
    { key: 'printAttachments', type: 'select', noSeg: true, options: [{ v: 'card' }, { v: 'hide' }, { v: 'images' }] },
  ], 'output')));
  body.append(section('ds-out-app', t('ds.appendix'), fieldsBox([
    { key: 'enabled', type: 'checkbox' },
    { key: 'title', type: 'i18n', label: 'ds.apTitle', when: { enabled: true } },
    { key: 'embed', type: 'checkbox', when: { enabled: true } },
    { key: 'print', type: 'checkbox', label: 'ds.apPrint', when: { enabled: true } },
  ], 'output.appendix')));
}

const dsMeta = metaTab([
  { key: 'title', type: 'i18n', label: 'ds.metaTitle' },
  { key: 'description', type: 'i18n', label: 'ds.metaDesc', multiline: true, rows: 3 },
  { key: 'author', type: 'text' },
  { key: 'keywords', type: 'text' },
]);

// --- editor configuration -------------------------------------------------------

// themeMarkupKeys: theme keys that change root classes (markup), so they need an 'all' render; other theme keys are
// pure custom properties and go through the CSS-only path.
export const PAPER_EDITOR = {
  fontStacks: FONT_STACKS,
  stage: paperStage(PAGE_SIZES),
  typeIcons: {
    heading: 'heading', text: 'type', table: 'table', section: 'section', columns: 'columns', quote: 'quote',
    divider: 'divider', spacer: 'spacer', pagebreak: 'pagebreak', image: 'image', attachment: 'clip', qr: 'qr',
  },
  docTabs: [['theme', 'ds.theme', dsTheme], ['layout', 'ds.layout', dsLayout], ['page', 'ds.page', dsPage],
    ['langs', 'ds.langs', langsTab], ['output', 'ds.output', dsOutput], ['meta', 'ds.meta', dsMeta]],
  themeMarkupKeys: ['preset', 'density', 'headingStyle'],
  commonFields: [
    { key: 'hidden', type: 'checkbox' },
    { key: 'langs', type: 'langs' },
    { key: 'print', type: 'select', noSeg: true, options: [{ v: 'both', l: 'o.screenPrint' }, { v: 'screen', l: 'o.screen' }, { v: 'print', l: 'o.print' }] },
    { key: 'keep', type: 'checkbox' },
    { key: 'breakBefore', type: 'checkbox' },
  ],
  styleFields: [
    { key: 'mt', type: 'number', min: 0, max: 80, step: 0.5, unit: 'mm', nullable: true },
    { key: 'mb', type: 'number', min: 0, max: 80, step: 0.5, unit: 'mm', nullable: true },
    { key: 'pad', type: 'number', min: 0, max: 40, step: 0.5, unit: 'mm', nullable: true },
    { key: 'bg', type: 'color' },
    { key: 'color', type: 'color' },
    { key: 'align', type: 'select', options: [{ v: '', l: 'fld.default' }, { v: 'left' }, { v: 'center' }, { v: 'right' }, { v: 'justify' }] },
  ],
  blockMenu: (b) => [
    { label: t('blk.keep'), checked: !!b.keep, action: () => toggleBlockProp(b.id, 'keep') },
    { label: t('blk.breakBefore'), checked: !!b.breakBefore, action: () => toggleBlockProp(b.id, 'breakBefore') },
  ],
  linkTypes: ['heading', 'section'],
  // Translatable strings outside the block tree, so the language tools (copy / missing translations) see them too.
  i18nRoots: (doc) => [doc.page && { h: doc.page.header, f: doc.page.footer }, doc.output?.appendix && { t: doc.output.appendix.title }],
  // The sidebar region is shown when the layout has a sidebar or it still holds blocks.
  regionShown: (r, doc) => r !== 'side' || doc.layout.type !== 'single' || !!(doc.regions.side || []).length,
  // Files that are neither pictures nor fonts are listed in the attachments appendix by default.
  newAttachment(a, opts) {
    a.appendix = opts.appendix ?? (!isImageMime(a.mime) && !isFontMime(a.mime, a.name));
  },
  // Pictures picked for a block field are assets of that field (not listed in the appendix).
  fieldUploadOpts: (f, ctx) => (String(f.accept || '').startsWith('image/') && ctx.assetImages ? { asset: true, appendix: false } : {}),
  fileFields: [
    { key: 'appendix', type: 'checkbox', label: 'files.appendix' },
    { key: 'asset', type: 'checkbox', label: 'files.asset' },
  ],
  keepAttachment: (a) => !!a.appendix,
};
