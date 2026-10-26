// paper/product.js - registers a paper-document product (resume, docs...) with the document engine (doc/): the generic
// paper blocks, themes, icons, exported-page strings, CSS library, runtime features and hooks, plus the product's own
// blocks, strings and CSS.
//
//   definePaperProduct({
//     prefix, format, version, name, uiLangs,          engine product identity
//     blocks, order?,                                  own blocks (merged with paper/blocks.js; `order` = palette order)
//     ui, css,                                         own exported-page strings; CSS of own blocks (paper/css.js ext())
//     themes?, icons?,                                 extra theme presets / icons
//     paperDefaults?: { layout, theme },               defaults of new documents
//     paperRegions?(): { header, main, side },         blocks of a new document
//     paperTitle?(doc, lang), labelKeys?(),            page title guess; extra editor label keys
//     identityTypes?: [type],                          side blocks hoisted above the main column on phones
//     hideEmptyHeader?: bool,                          editor canvas: no drop zone for an empty header region
//     ...                                              any other engine hook overrides
//   })
//
// Design: a thin composition layer, no logic of its own. The engine (doc/product.js) is format-agnostic; "paper" is one
// family of hooks (regions header/main/side, mm-based page box, appendix). Merge rules are deliberate:
// - Blocks: product entries override generic ones of the same key (spread order), so a product can replace e.g. the
//   generic heading without forking this module.
// - Strings: merged per language, product keys win; the language set is the union, so a product may add a UI language
//   the generic dictionary lacks (missing generic keys then fall back via doc/dict.js, not crash).
// - `...rest` is spread LAST: any engine hook can be overridden by the product. The price is that a typo in a hook name
//   silently adds an unused key instead of failing; the engine does not validate unknown keys.
import { defineProduct } from '../doc/product.js';
import { PAPER_BLOCKS } from './blocks.js';
import { PAPER_THEMES } from './themes.js';
import { PAPER_ICONS } from './icons.js';
import { PAPER_UI } from './dict.js';
import { COMMON_DEFAULTS, attachmentExtra, isNormalized, newDoc, normCommon, normalizeTop } from './model.js';
import { blockClasses, blockConditional, blockStyle, makeCtx, planDoc, renderRoot } from './render.js';
import { docTitle, finishPaperUsage, paperAria, renderToolbar } from './export.js';
import { buildCSS, pageBoxCSS } from './css.js';
import { FEATURE_ORDER, RUNTIME } from './runtime.js';

export function definePaperProduct(spec) {
  const { blocks = {}, order, ui = {}, css, themes = {}, icons = {}, ...rest } = spec;
  const all = { ...PAPER_BLOCKS, ...blocks };
  const reg = {};
  // Palette order: an explicit `order` both sorts and FILTERS (a generic block not listed is dropped from the
  // product). Object key order is insertion order for string keys, which is what makes this a stable ordering.
  for (const k of order || Object.keys(all)) if (all[k]) reg[k] = all[k];
  // Per-language shallow merge; a plain {...PAPER_UI, ...ui} would let a product's partial "en" replace all generic en keys.
  const dict = {};
  for (const l of new Set([...Object.keys(PAPER_UI), ...Object.keys(ui)])) dict[l] = { ...PAPER_UI[l], ...ui[l] };
  return defineProduct({
    regions: ['header', 'main', 'side'],
    blocks: reg, themes: { ...PAPER_THEMES, ...themes }, icons: { ...PAPER_ICONS, ...icons }, ui: dict,
    commonDefaults: COMMON_DEFAULTS, normCommon, newDoc, normalizeTop, isNormalized, attachmentExtra,
    renderRoot, blockStyle, blockClasses, blockConditional, makeCtx, planDoc, finishUsage: finishPaperUsage,
    attAnchorTypes: ['image', 'attachment'], previewTypes: ['attachment'],
    buildCSS, runtime: { fns: RUNTIME, order: FEATURE_ORDER },
    exportHooks: { title: docTitle, langCSS: pageBoxCSS, toolbar: renderToolbar, aria: paperAria },
    paperCSS: css,
    ...rest,
  });
}

// Re-exports: products and tests import the paper family from this one entry point instead of reaching into files.
export { PAPER_BLOCKS } from './blocks.js';
export { PAGE_SIZES } from './base.js';
export { DENSITY, FONT_STACKS, HEADING_STYLES, LAYOUTS } from './themes.js';
export { buildCSS } from './css.js';
export { RUNTIME } from './runtime.js';
export { labelKeys } from './export.js';
