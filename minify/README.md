# minify

**Minifiers.** Conservative minifiers used by the build and by the document exporters: JavaScript (whitespace and comments only, ASI-safe, never renames), CSS and HTML (with a tokenizer reused by `markdown/`).

| module | contents |
| --- | --- |
| `css.js` | CSS whitespace/comment minifier that never alters strings, url() or calc()-style operator spacing. minifyCSS returns the input unchanged if anything goes wrong (fail-safe). |
| `html.js` | HTML tokenizer and conservative minifier. |
| `js.js` | JavaScript whitespace/comment minifier. Never renames, never reorders, ASI-safe. |

The header comment of each module documents its API.
