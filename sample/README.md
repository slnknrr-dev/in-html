# sample

**Sample files.** Deterministic sample files for templates (PDF, PNG, SVG artwork) and the template building kit shared by the document products.

| module | contents |
| --- | --- |
| `bytes.js` | helpers of the sample generators: UTF-8 / latin1 bytes, base64 size, seeded randomness, HSL. |
| `kit.js` | template building kit shared by the products: localized values, blocks and sample attachments. |
| `pdf.js` | sample PDF generator (valid PDF 1.4, Helvetica, ASCII text). |
| `png.js` | sample PNG generator (uncompressed deflate, no canvas). |
| `svg.js` | sample SVG artwork: gradient avatars with initials, abstract illustrations. |

The header comment of each module documents its API.
