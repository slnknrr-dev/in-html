// studio/config.js - what the active product contributes to the editor (set once by the application before boot).
// The engine side of the product (blocks, themes, dictionaries of exported pages) is in doc/product.js.
//
// Design: one mutable singleton with every hook declared and defaulted here, instead of a class or constructor.
// - Each default is the "product does not care" behaviour, so editor code reads ED.x directly (arrays iterate empty,
//   null hooks are tested with if (ED.x)) instead of scattering ED.x || fallback at every call site.
// - This file is the API reference of a product. An unknown key in defineEditor(spec) is silently accepted, so a
//   typo fails silently: keep this list in sync with the call sites.

export const ED = {
  api: null,                   // the product's viewer module (templates build with it)
  fileExt: 'doc',              // project files: <name>.<fileExt>.json
  templates: [],               // template gallery: [{ id, name, desc, langs, userLang?, build(V, ...) }] (+ group, mode,
                               //   modules, note, preview, href: studio/gallery.js)
  templateGroups: null,        // gallery sections: [{ id, label (key), desc (key) }] (templates by tpl.group)
  categories: [],              // palette category order
  typeIcons: {},               // block type -> editor icon name (default: the registry's viewer icon)
  fontStacks: {},              // theme font keys -> CSS stacks (font lists, preset previews)
  stage: null,                 // canvas stage mode (studio/stage.js: paperStage / deviceStage)

  // Settings and inspector
  docTabs: [],                 // document settings: [[key, labelKey, render(body)], ...]
  themeMarkupKeys: ['preset'], // theme keys rendered as markup classes (others only change the stylesheet)
  commonFields: [],            // inspector "common" fields of every block (hidden, languages, print / device…)
  styleFields: [],             // inspector block style fields (spacing, colours, alignment)
  fieldControls: {},           // extra field types: { type: (f, value, onChange, id, ctx) → element }
  itemFields: {},              // item field hooks by key: { key: { check(value, item) → message, clean(value) } }
  blockMenu: null,             // (block) → extra block context-menu items
  statusItems: null,           // (doc) → extra status bar elements

  // Document model hooks
  linkTypes: [],               // link targets without anchors: block types listed in the link dialog
  linkExtras: null,            // (doc) → [{ href, label }] extra in-page link targets (top, cart, languages…)
  linkTargets: null,           // (doc, blockTargets) → [{ href, label, group? }]: replaces the href suggestions entirely
                               //   (blockTargets = blockAnchors(); group = a heading in the link picker menu)

  // Registry flag `regionStart`: a type bound to the header / footer (`region`) is inserted at the start of it.
  // Multi-page documents (registry flags: `transparent` = a container whose children are the top level of a page, so
  // its list is treated like a region; `topLevel` = a block type that only lives directly in a region list)
  mainList: null,              // () → list path that receives blocks meant for the main region (the edited page)
  renderOpts: null,            // () → extra options of the canvas render (e.g. { page: id })
  outlineRegion: null,         // (region, doc) → { list, listPath, label } | null: what the outline shows for a region
  i18nRoots: null,             // (doc) → document-level objects holding texts (page header, age gate…)
  metaAttKeys: [],             // meta keys referencing attachments (favicon, sharing image…)
  regionShown: null,           // (region, doc) → show the region in the outline
  onNewBlock: null,            // (block, doc) → fix a freshly inserted block (unique keys…)
  onCopy: null,                // (block, doc) → fix a duplicated / pasted block
  onNewItem: null,             // (block, item) → item (fix a new / copied list item)

  // Files
  newAttachment: null,         // (attachment, addFiles opts) → set product fields of a new attachment
  fieldUploadOpts: null,       // (field, ctx) → addFiles options of a file picked for a field
  fileFields: [],              // extra fields of a file in the Files panel
  keepAttachment: null,        // (attachment) → keep it in a pruned export source although nothing references it

  // Other file formats
  importers: [],               // [{ accept: '.md,.zip', test(name, text) → bool, load(text, name, file) → raw doc }]
  exporters: [],               // [{ label (key), icon, ext, mime, build(doc, { lang }) → string | Blob }] (top bar "more" menu)

  // Export dialog
  exportModes: [],             // packages offered by the export dialog (a choice when there are two or more):
                               //   [{ id, label (key), desc (key), icon?, ext ('html' default, 'zip'…),
                               //      packed (offer clean / packed; default true), source (offer the embedded source;
                               //      default true), options: [{ key, label, desc? }] (switches, opts.extra[key]),
                               //      page(doc, opts) → { html, bytes, report } (the page of the live size report;
                               //      default: the single-file export), info(doc, opts) → Promise<Element|null> (extra
                               //      report section), build(doc, opts) → Promise<Blob> }]
                               //   The entry without build is the built-in single HTML file (it may only be relabelled).
  exportCheck: null,           // async (doc, opts) → doc | false | null, before every download (any package): may ask the
                               //   user (validation) and return the document to export (the original or a pruned copy);
                               //   false = cancelled (the dialog stays), null = cancelled and the export dialog closes.
                               //   opts = the export options + { target (package id), extra (package switches) }
};

// Shallow merge: a product replaces a whole hook or array, never deep-merges into the defaults (a partial array entry
// would otherwise half-inherit). Called before startEditor(); changing ED after boot is not re-read by rendered UI.
export function defineEditor(spec) {
  Object.assign(ED, spec);
  return ED;
}
