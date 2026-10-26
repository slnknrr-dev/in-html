# paper

**Paper documents.** Everything paper-like documents share: generic blocks, themes and layouts, page sizes and print CSS, the appendix of attachments, runtime features, export hooks and the editor configuration (`PAPER_EDITOR`) with its strings. A product adds only its own blocks, strings and CSS:

```js
definePaperProduct({ prefix: 'dc', format: 'dc-doc', blocks, ui, css, themes, order, paperDefaults, paperRegions });
defineEditor({ api: V, templates, ...PAPER_EDITOR, fileExt: 'doc', categories, typeIcons });
```

Used by `resume-app/` and `docs-app/`.

| module | contents |
| --- | --- |
| `attach.js` | attachment cards of paper documents (blocks and the appendix): title, size, buttons, preview. |
| `base.js` | paper sizes of paper documents (mm). |
| `blocks.js` | generic blocks of paper documents: heading, text, table, section, columns, callout, divider, spacer, page break, image, attachment, QR code (registry entries: schema, defaults, renderers). |
| `css.js` | CSS library of paper documents (tree-shaken by buildCSS): base, shared chunks, generic block chunks, layouts, heading styles, theme rules of used blocks, features, toolbar, page, dark scheme, print, @page boxes … |
| `dict.js` | UI strings of exported paper documents (pre-rendered into exports; the runtime has no UI text): toolbar, attachments, appendix, page numbers, dates, editing placeholders of the generic blocks. |
| `editor.js` | editor configuration shared by paper-document products (studio/config.js): paper stage, document settings tabs (theme, layout, page, languages, output, metadata), print-related block props, appendix attachments … |
| `export.js` | export hooks of paper documents: title, runtime features and the floating toolbar (language switch, dark / light, print), accessible labels; the editor's label key list. |
| `i18n-<lang>.js` | editor UI strings of paper-document products: generic blocks, themes, layouts, page and output settings (de, en, es, fr, ka, ru, uk). |
| `icons.js` | icon set of paper documents (24×24 stroke paths): contact kinds, files, toolbar, heading icons. 24×24 stroke icons (path data). Rendered with fill:none; stroke:currentColor. Contact kinds use their kind name as key so ICONS[kind] always works. |
| `model.js` | shape of paper documents: defaults, common block props (print flags, block style in mm) and top-level normalization (the engine in doc/model.js normalizes blocks, items, lists and attachments) … |
| `product.js` | registers a paper-document product (resume, docs…) with the document engine (doc/): the generic paper blocks, themes, icons, exported-page strings, CSS library, runtime features and hooks, plus the product's own blocks, strings and CSS. |
| `render.js` | page skeleton of paper documents (regions in a layout, paper look, appendix of attachments) and the engine's block wrapper hooks (style, print classes, identity hoisting on phones). |
| `runtime.js` | runtime features of exported paper documents (serialized with Function.prototype.toString; __P__ is the class prefix). core: R.$/R.$$/R.cfg/R.store (i18n, theme, attach); blob, i18n and theme are the engine's shared features (doc/runtime-features.js) … |
| `themes.js` | fonts, theme presets (CSS with __P__ class prefixes), layouts, densities and heading styles of paper documents. System font stacks; each covers Latin, Cyrillic and Georgian via fallbacks. |

The header comment of each module documents its API.
