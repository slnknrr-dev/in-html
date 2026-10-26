// docs-app/viewer.js - the docs product: a paper document (paper/) with the docs blocks (code, table of contents, checklist)
// and reading-oriented themes; registers it with the document engine (doc/) and re-exports the API the editor and the
// templates use.
//
// definePaperProduct registers the docs product once at import time; the editor and templates then use the API
// re-exported below. Re-exporting through this module gives the editor one import surface per product, so the shared
// studio/ editor stays product-agnostic.
import { definePaperProduct } from '../paper/product.js';
import { newBlock, walkBlocks } from '../doc/model.js';
import { htmlToText, pickText } from '../i18n/text.js';
import { DOCS_THEMES, UI_LANGS, VERSION } from './viewer-base.js';
import { DOCS_BLOCKS } from './viewer-blocks.js';
import { DOCS_UI } from './viewer-dict.js';
import { DOCS_CSS } from './viewer-css.js';

definePaperProduct({
  prefix: 'dc', format: 'dc-doc', version: VERSION, name: 'Untitled document', uiLangs: UI_LANGS,
  blocks: DOCS_BLOCKS, ui: DOCS_UI, css: DOCS_CSS, themes: DOCS_THEMES,
  order: ['heading', 'text', 'checklist', 'code', 'table', 'quote', 'toc', 'section', 'columns', 'divider', 'spacer',
    'pagebreak', 'image', 'attachment', 'qr'],
  paperDefaults: { layout: 'single', theme: 'article' },
  // A new document: a title and a first paragraph.
  paperRegions: () => ({ main: [newBlock('heading', { level: 1 }), newBlock('text')] }),
  // Page title without a meta title: the first top-level heading.
  paperTitle: (doc, lang) => {
    let t = '';
    walkBlocks(doc, (b) => { if (!t && b.type === 'heading' && b.level === 1 && !b.hidden) t = htmlToText(pickText(b.text, lang, doc)); });
    return t;
  },
  identityTypes: [],
  hideEmptyHeader: true,
});

export { exportHTML, extractSource } from '../doc/export.js';
export { previewKind } from '../doc/attach.js';
export { collectUsage, renderBlock, renderDoc } from '../doc/render.js';
export { uid } from '../util/id.js';
export { own } from '../util/value.js';
export { b64decode, b64encode } from '../codec/base64.js';
export { LANG_NAMES, langDir, langName, primary } from '../i18n/lang.js';
export { isEmptyText, pickText } from '../i18n/text.js';
export { escapeAttr, escapeHTML } from '../html/escape.js';
export { UI_LANGS, VERSION } from './viewer-base.js';
export { FONT_STACKS, LAYOUTS, PAGE_SIZES, RUNTIME, buildCSS, labelKeys } from '../paper/product.js';
export { cloneBlock, newBlock, newDoc, normalizeDoc, walkBlocks } from '../doc/model.js';
export { uiText } from '../doc/dict.js';
export { BLOCK_TYPES, ICONS, THEMES, UI } from '../doc/product.js';
export { emptyCell } from '../doc/table.js';
export { markdownToDoc } from './markdown-doc.js';
