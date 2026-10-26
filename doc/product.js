// doc/product.js - the active product: engine registries and hooks.
//
// A builder application (resume, landing) calls defineProduct() once, before any engine function runs. The engine
// reads everything product-specific from here at call time; the registries are stable objects, so modules may import
// them directly (`import { BLOCK_TYPES } from '../doc/product.js'`).
//
// Why a mutable singleton instead of passing a product object everywhere: the engine is shared by several builders but
// exactly one runs per page, and threading a parameter through every render helper would touch hundreds of call
// sites. Invariant that makes it safe: never reassign the exported objects, only mutate them (Object.assign), or
// importers would keep a stale reference. Consequence: two products cannot coexist in one realm (tests run one).

export const BLOCK_TYPES = {};   // type -> { category, icon, container, lists, i18nFields, schema, defaults(), render(b, ctx), ... }
export const THEMES = {};        // preset -> { vars, css }
export const ICONS = {};         // name -> 24x24 stroke path data
export const UI = {};            // viewer dictionaries: lang -> { key: 'text' | { one, few, many, other } }

// Product spec with defaults. Hooks receive plain arguments; see the product's viewer.js for implementations.
export const P = {
  prefix: 'x',                   // class / id / storage prefix ('rv', 'lp'); `__P__` in shared CSS and runtime sources
  format: '',                    // document format id ('rv-resume')
  version: '1.0.0',
  name: 'Document',              // fallback document name
  regions: [],                   // region keys in document order
  uiLangs: ['en'],               // languages the viewer dictionaries cover
  // model
  commonDefaults: () => ({}),    // common props of every block (hidden, langs, ... style)
  normCommon: null,              // (out, src, ctx, def) -> void: product common props of a normalized block
  newDoc: null,                  // (opts) -> doc
  normalizeTop: null,            // (src, h) -> doc  (h = engine helpers; see model.js)
  isNormalized: () => false,     // (doc) -> bool: structural guard of renderers
  attachmentExtra: null,         // (out, src) -> void: product fields of a normalized attachment
  // rendering
  renderRoot: null,              // (ctx) -> html
  planExtra: null,               // (ctx) -> void: product part of the xref pre-pass
  attAnchorTypes: [],            // block types that carry their attachment's #att-<id> anchor
  blockClasses: null,            // (ctx, b, cls) -> cls: product wrapper classes
  blockStyle: null,              // (b) -> 'css;decls'
  // multi-page products (registry flag `transparent` on the page container: its children are the page's top level)
  placeHref: null,               // (ctx, '#target', blockId) -> href: URL of an in-page target in the current export
  routeHref: null,               // (ctx, path, anchor) -> href | null: '#/<path>[#<anchor>]' page links
  // css / runtime / export
  buildCSS: null,                // (doc, opts) -> css
  finishUsage: null,             // (ctx, use) -> void: features and extras of a view render
  runtime: { fns: {}, order: [] },
  exportHooks: {},               // { docTitle, head, body, cfg, report, toolbar }
};

// Shallow merge: a later call overrides top-level keys of P wholesale (e.g. runtime), while UI dictionaries are merged
// per language so parts can add keys without erasing the product's.
export function defineProduct(spec) {
  const { blocks, themes, icons, ui, ...rest } = spec;
  if (blocks) Object.assign(BLOCK_TYPES, blocks);
  if (themes) Object.assign(THEMES, themes);
  if (icons) Object.assign(ICONS, icons);
  if (ui) {
    for (const [lang, dict] of Object.entries(ui)) UI[lang] = Object.assign(UI[lang] || {}, dict);
  }
  Object.assign(P, rest);
  return P;
}

// Adds viewer UI strings (per language) - for parts that contribute their own keys.
export function addUI(dicts) {
  for (const [lang, dict] of Object.entries(dicts)) UI[lang] = Object.assign(UI[lang] || {}, dict);
}
