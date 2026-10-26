// resume-app/viewer.js - the resume product: a paper document (paper/) with the resume blocks (profile, contacts, timeline,
// skills, languages, key-value list); registers it with the document engine (doc/) and re-exports the API the editor
// uses.
//
// The product is declarative: definePaperProduct receives blocks, dictionaries and CSS, and the shared paper /
// document engine does layout, rendering, export and the editor. The resume adds only what is resume-specific.
// The re-export list below is the editor's API surface (studio/ calls V.*); it is a facade, so the studio never
// imports doc/ or paper/ paths directly and another product can supply a different implementation.
import { definePaperProduct } from '../paper/product.js';
import { newBlock, walkBlocks } from '../doc/model.js';
import { BLOCK_TYPES } from '../doc/product.js';
import { htmlToText, pickText } from '../i18n/text.js';
import { CONTACT_KINDS, UI_LANGS, VERSION } from './viewer-base.js';
import { RESUME_BLOCKS } from './viewer-blocks.js';
import { RESUME_UI } from './viewer-dict.js';
import { RESUME_CSS } from './viewer-css.js';

definePaperProduct({
  prefix: 'rv', format: 'rv-resume', version: VERSION, name: 'My resume', uiLangs: UI_LANGS,
  blocks: RESUME_BLOCKS, ui: RESUME_UI, css: RESUME_CSS,
  // Palette order in the editor: resume blocks right after the basic text blocks, generic layout and media after.
  order: ['heading', 'text', 'profile', 'contacts', 'timeline', 'skills', 'languages', 'keyvalue', 'table', 'section',
    'columns', 'quote', 'divider', 'spacer', 'pagebreak', 'image', 'attachment', 'qr'],
  paperDefaults: { layout: 'sidebar-left', theme: 'modern' },
  // A new resume: the profile and the contacts (e-mail, phone, location) in the header.
  paperRegions: () => {
    const contacts = newBlock('contacts', { layout: 'inline' });
    contacts.items = ['email', 'phone', 'location'].map((kind) => ({ ...BLOCK_TYPES.contacts.itemDefaults(), kind }));
    return { header: [newBlock('profile'), contacts] };
  },
  // Page title without a meta title: "Name — Job title" of the first profile.
  paperTitle: (doc, lang) => {
    let prof = null;
    walkBlocks(doc, (b) => { if (!prof && b.type === 'profile' && !b.hidden) prof = b; });
    if (!prof) return '';
    const n = htmlToText(pickText(prof.name, lang, doc));
    const ti = htmlToText(pickText(prof.title, lang, doc));
    return n ? (ti ? n + ' — ' + ti : n) : '';
  },
  // Contact kind labels are translated per resume language (not UI language) in the exported page.
  labelKeys: () => CONTACT_KINDS.map((k) => 'ck.' + k),
  // Blocks that identify the person: the engine uses them for the page title and metadata.
  identityTypes: ['profile', 'contacts'],
});

export { formatDate } from '../doc/dates.js';
export { exportHTML, extractSource } from '../doc/export.js';
export { previewKind } from '../doc/attach.js';
export { collectUsage, renderBlock, renderDoc } from '../doc/render.js';
export { uid } from '../util/id.js';
export { own } from '../util/value.js';
export { b64decode, b64encode } from '../codec/base64.js';
export { deflate, inflate } from '../codec/deflate.js';
export { DARK_BG, contrastRatio, darkAccent, onAccent, parseColor, safeColor } from '../color/color.js';
export { LANG_NAMES, langDir, langName, primary } from '../i18n/lang.js';
export { isEmptyText, pickText } from '../i18n/text.js';
export { escapeAttr, escapeHTML } from '../html/escape.js';
export { sanitizeRich } from '../html/sanitize.js';
export { qrMatrix, qrSVG } from '../qr/qr.js';
export { CONTACT_KINDS, LANG_LEVELS, UI_LANGS, VERSION } from './viewer-base.js';
export { FONT_STACKS, LAYOUTS, PAGE_SIZES, RUNTIME, buildCSS, labelKeys } from '../paper/product.js';
export { contactHref } from './viewer-blocks.js';
export { minifyCSS } from '../minify/css.js';
export { minifyJS } from '../minify/js.js';
export { cloneBlock, newBlock, newDoc, normalizeDoc, walkBlocks } from '../doc/model.js';
export { uiText } from '../doc/dict.js';
export { BLOCK_TYPES, ICONS, THEMES, UI } from '../doc/product.js';
