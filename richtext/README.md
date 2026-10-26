# richtext

**Rich text and tables.** Inline editing of rich fields (contenteditable) and tables on the editor canvas: DOM sanitizer, editing operations, formatting toolbar, link dialog, clipboard, keyboard handling, table model operations and the table editing UI. Styles: `richtext.css`.

| module | contents |
| --- | --- |
| `clipboard.js` | copy and paste in rich fields and table cell selections (sanitized HTML, plain text). |
| `field.js` | the active rich field: lookup, selection save / restore with markers, debounced commit to the document. |
| `input.js` | keyboard, input and focus handling of rich fields; rtInit binds it, rtOnRender re-attaches after a canvas render. |
| `link.js` | the link dialog (URL, e-mail, phone, attachment, document section). |
| `ops.js` | editing operations on a field element and a Range (inline formats, block styles, lists, indents, alignment) and the command runner for single fields and multi-cell table selections. |
| `sanitize.js` | DOM-based sanitizer of the editor (typing, paste, import): sanitizeHTML(html, 'rich' \| 'inline', opts) keeps the rich-text allowlist and strips foreign document styling on paste; rtSafeHref is the link allowlist. Nothing touches the DOM at load time. |
| `table-model.js` | table model operations (pure: mutate the table block in place and keep the grid invariants of doc/table.js): rows, columns, merge / split, distribute, rescale. Grid invariant: rows is R×C (C = cols.length) … |
| `table-ui.js` | table editing UI: cell selection, table toolbar, context menu, column resizing. |
| `toolbar.js` | the formatting toolbar (#ed-format): buttons, groups, popovers, state updates. |
| `richtext.css` | rich text editing UI: formatting toolbar, popovers, link dialog, table tools and table selection on the editing canvas. |

The header comment of each module documents its API.
