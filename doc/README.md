# doc

**Document engine.** One engine renders, styles, normalizes and exports the documents of every builder application (resume, docs, landing). An application registers a *product* first (`defineProduct`, or `definePaperProduct` from `paper/`): block types, themes, icons, exported-page strings, CSS library, runtime features and hooks. Everything here runs in Node too (rendering and export never touch the DOM); runtime features are serialized into the exported page. See ARCHITECTURE.md for the overall design.

| module | contents |
| --- | --- |
| `attach.js` | attachments: preview policy, sources, file info. Attachment data lives in doc.attachments[id].data (standard base64) or, in the editor, behind ctx.attURL(id) (blob URLs); archive exports point at files (ctx.assetURL). |
| `css.js` | helpers for the products' CSS builders (tree-shaken theme rules, asset fonts, language groups). |
| `dates.js` | document date values: 'YYYY' \| 'YYYY-MM' \| 'present' (ranges of resume timelines and the like). |
| `dict.js` | viewer UI strings of the active product (pre-rendered into exports; the runtime carries none). |
| `export.js` | one self-contained HTML file from a document (options for archives: attachments as files via assetURL, stylesheet / runtime as files). |
| `model.js` | registry-driven document model: block factories, tree walking and normalization. |
| `product.js` | the active product: engine registries and hooks. |
| `render.js` | rendering core: view and edit markup, per-language groups, fields, links, block wrappers, usage. |
| `runtime-features.js` | runtime features shared by every document product (serialized with Function.prototype.toString like the products' own; _ … |
| `runtime.js` | runtime of exported pages, assembled from feature functions serialized with Function.prototype.toString. |
| `schema.js` | helpers for block registry schemas. |
| `table.js` | table block model: { rows: Cell[][], cols: [{ w }] } with merged cells (colspan / rowspan) kept in a strict grid (covered cells are flagged `m`). Shared by the products' table blocks and richtext/table-*. |

The header comment of each module documents its API.
