# markdown

**Markdown.** Two renderers and a writer: the CommonMark core used by the docs editor (a neutral block tree, raw HTML
shown as text), GitHub-flavoured Markdown as GitHub and Codeberg render README files (raw HTML through the
sanitizer, source ranges of every block for editors), and rich-text HTML back to Markdown.

| module | contents |
| --- | --- |
| `parse.js` | Markdown (CommonMark core + GitHub tables, task lists, strikethrough, autolinks) to a neutral block tree with inline content rendered as safe HTML. No raw HTML passes through (it is shown as text). |
| `gfm.js` | `renderGFM(src, opts)` → `{ html, blocks: [{ type, start, end, html }], headings, footnotes, refs }`: CommonMark blocks and inlines (containers, lazy continuation, tight / loose lists, reference definitions, the emphasis rule of three), raw HTML blocks and inline HTML (sanitized by `html/sanitize.js` `sanitizeDoc`, GitHub's allowlist, ids prefixed `user-content-`), tables with alignment, task lists, `~` / `~~`, extended autolinks, footnotes, heading slugs like GitHub (`githubSlug`, `createSlugger`), alerts, math (`$…$`, `$$…$$`, `` $`…`$ ``, ```` ```math ````) and ```` ```mermaid ```` through hooks, emoji shortcodes, highlighting hook; `positions: true` marks images, links, task boxes, formulas and diagrams with `data-md-pos="start-end"` source offsets (unforgeable by the document). |
| `emoji.js` | GitHub emoji shortcodes (about 370 of the most used) |
| `write.js` | Markdown from rich text: `htmlToMarkdown(html, opts)`, `inlineMarkdown`, `escapeMarkdown`, `tableMarkdown(head, rows, align, { pad, escaped })`; `opts.gfm` writes for README editors (`\` line breaks, kbd / ins / mark / sub / sup kept as HTML, `$` escaped, lighter escaping, task boxes, alignment from `align`), `data-md-raw` elements are copied verbatim. |
| `gfm.css` | README styles like GitHub's (and Codeberg's with `.md-codeberg`) for `.md-body`, light and dark, code colours for `highlight/` spans |
| `test.js` | unit tests: `node markdown/test.js` (also `node check.js tests markdown`) |

The header comment of each module documents its API.

## Limits of `gfm.js`

- Close to cmark-gfm, not byte for byte: link reference definitions spanning more than two lines, some tab-stop and
  HTML-block edge cases differ; GitHub's own autolinks (`#123`, `@user`, commit SHAs) are not linked.
- Alert titles are English like GitHub's (`alertTitles` changes them).
