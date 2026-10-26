# html

**HTML helpers.** Escaping, link allowlists and the string-based rich-text sanitizer used by the renderers (Node and browsers).

| module | contents |
| --- | --- |
| `escape.js` | HTML escaping: escapeHTML (text), escapeAttr (attribute values), decodeEnt (the entities they produce). |
| `sanitize.js` | string-based rich-text sanitizer of the renderers: sanitizeRich(html, 'rich' \| 'inline', opts) rebuilds every tag from an allowlist (Node and browsers); sanitizeDoc(html, { idPrefix, dataImages, nonce, classes }) keeps what GitHub keeps in README files (headings, text semantics, lists, tables, details / summary, picture / source, kbd, sub / sup, ruby, images with width / height / align, align on blocks, task checkboxes) and drops style, script, iframes, forms, SVG and MathML, prefixes ids and allows only http(s), mailto / tel, relative URLs and optionally data:image rasters. |
| `url.js` | link allowlists. Always allowed: http(s):, mailto:, tel:, in-document references #att-<id> and #b-<id>. With `anchors`: also #<slug> anchors and #lang=<code> language links. |

The header comment of each module documents its API.
