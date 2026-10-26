// markdown/test.js - unit tests of the Markdown library: node markdown/test.js (also node check.js tests markdown).
// Cases are small input -> expected HTML fragment checks (has(): substring of the output): Markdown edge cases are
// easiest to reason about as literal strings, and the printed output points straight at the rule that broke.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMarkdown, renderHTML } from './parse.js';
import { htmlToMarkdown, inlineMarkdown, tableMarkdown, escapeMarkdown } from './write.js';
import { renderGFM, githubSlug, createSlugger } from './gfm.js';
import { sanitizeDoc } from '../html/sanitize.js';

let failed = 0, passed = 0;
const ok = (c, name, info) => { if (c) passed++; else { failed++; console.log('x markdown: ' + name + (info !== undefined ? ' ' + JSON.stringify(info) : '')); } };
const H = (src, o) => renderGFM(src, o).html;
const has = (src, frag, name, o) => { const h = H(src, o); ok(h.includes(frag), name, h); };

export function run() {
  // The CommonMark core module (docs-app) keeps its behaviour.
  ok(renderHTML(parseMarkdown('# T\n\n*a* **b**')).includes('<h1>T</h1>'), 'parse.js headings and emphasis');
  ok(htmlToMarkdown('<p>a <b>b</b><br>c</p>') === 'a **b**  \nc', 'write.js default output unchanged', htmlToMarkdown('<p>a <b>b</b><br>c</p>'));
  ok(htmlToMarkdown('<p>a_b &amp;lt;</p>') === 'a\\_b \\<lt;' || htmlToMarkdown('<p>a_b &amp;lt;</p>') === 'a\\_b &lt;', 'write.js decodes entities once', htmlToMarkdown('<p>a_b &amp;lt;</p>'));
  ok(tableMarkdown(['a', 'b'], [['1', '2']], ['center']) === '| a | b |\n| :---: | --- |\n| 1 | 2 |', 'tableMarkdown default');
  ok(escapeMarkdown('a*b') === 'a\\*b', 'escapeMarkdown');

  // Blocks.
  has('# Title #', '<h1 id="user-content-title">Title</h1>', 'ATX heading with closing hashes');
  has('Title\n===', '<h1 id="user-content-title">Title</h1>', 'setext heading');
  has('a\n\n---\n\nb', '<hr>', 'thematic break');
  has('    code\n    more', '<pre><code>code\nmore</code></pre>', 'indented code');
  has('```js\nlet a = 1 < 2;\n```', '<code class="language-js">let a = 1 &lt; 2;</code>', 'fenced code escapes');
  has('~~~\n```\n~~~', '<pre><code>```</code></pre>', 'tilde fence holds backticks');
  has('> a\nlazy', '<blockquote>\n<p>a\nlazy</p>\n</blockquote>', 'block quote with lazy continuation');
  has('- a\n- b', '<ul>\n<li>a</li>\n<li>b</li>\n</ul>', 'tight list');
  has('- a\n\n- b', '<li><p>a</p></li>', 'loose list');
  has('3. x\n4. y', '<ol start="3">', 'ordered list start');
  has('- a\n  - b\n    - c', '<li>b<ul>\n<li>c</li>', 'nested lists');
  has('1. a\n\n   para\n2. b', '<li><p>a</p>\n<p>para</p></li>', 'item with two paragraphs');
  has('- [ ] todo\n- [x] done', '<input type="checkbox" class="md-task" disabled>', 'task list');
  has('- [x] done', 'checked', 'checked task');
  has('| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |', '<th align="left">a</th><th align="center">b</th><th align="right">c</th>', 'table alignment');
  has('| a |\n|---|\n| `x\\|y` |', '<code>x|y</code>', 'escaped pipe in a code cell');
  has('a | b\n--|--\n1 | 2', '<td>1</td><td>2</td>', 'table without outer pipes');
  ok(!H('a | b\n---').includes('<table'), 'cell count mismatch is no table');

  // Raw HTML passes through the sanitizer (not shown as text).
  has('<p align="center">\n  <img src="https://x.org/a.png" width="96" alt="L">\n</p>', '<p align="center">\n  <img src="https://x.org/a.png" width="96" alt="L">\n</p>', 'HTML block kept');
  has('<details>\n<summary>More</summary>\n\nHidden *md*.\n\n</details>', '<details>\n<summary>More</summary>\n<p>Hidden <em>md</em>.</p>\n</details>', 'details with Markdown inside');
  ok(renderGFM('<details>\n<summary>S</summary>\n\nx\n\n</details>\n\nafter').blocks.length === 2, 'an open element joins blocks up to its end');
  ok(renderGFM('<div>\n\nx\n\nno end').blocks.length === 3, 'an unclosed element does not swallow the document');
  const bad = H('<script>alert(1)</script>\n\n<img src="javascript:alert(1)" onerror="x()">\n\n<a href="javascript:x">j</a> <b style="color:red">b</b>\n\n<iframe src="https://e.vil"></iframe>\n\n<svg><script>1</script></svg>');
  ok(!/script|onerror|javascript|style=|iframe|<svg/i.test(bad), 'scripts, handlers, javascript: URLs, styles, iframes and SVG are dropped', bad);
  has('Press <kbd>Ctrl</kbd> + <kbd>S</kbd>, H<sub>2</sub>O, x<sup>2</sup>', '<kbd>Ctrl</kbd>', 'inline HTML (kbd, sub, sup)');
  has('<picture>\n<source media="(prefers-color-scheme: dark)" srcset="d.png">\n<img src="l.png" alt="x">\n</picture>', '<source media="(prefers-color-scheme: dark)" srcset="d.png">', 'picture / source');
  ok(H('<div id="top">x</div>').includes('id="user-content-top"'), 'ids of the user get the user-content- prefix');

  // Inlines.
  has('*a* **b** ***c*** _d_ __e__', '<em>a</em> <strong>b</strong> <em><strong>c</strong></em> <em>d</em> <strong>e</strong>', 'emphasis');
  has('snake_case_name', 'snake_case_name', 'intraword underscores');
  has('*a **b** c*', '<em>a <strong>b</strong> c</em>', 'nested emphasis');
  has('~~del~~ and ~one~', '<del>del</del> and <del>one</del>', 'strikethrough');
  has('`a  b` ``c`d``', '<code>a  b</code> <code>c`d</code>', 'code spans');
  has('\\*not\\* \\_em\\_', '*not* _em_', 'backslash escapes');
  has('[a](http://x.y "T") ![i](p.png)', '<a href="http://x.y" title="T">a</a> <img src="p.png" alt="i">', 'links and images');
  has('[a][r] [r] [R][]\n\n[r]: https://ref.example "Ref"', '<a href="https://ref.example" title="Ref">a</a> <a href="https://ref.example" title="Ref">r</a> <a href="https://ref.example" title="Ref">R</a>', 'reference links');
  has('[![b](https://img.shields.io/badge/a-b-blue)](https://x.y)', '<a href="https://x.y"><img src="https://img.shields.io/badge/a-b-blue" alt="b"></a>', 'linked badge');
  has('see https://example.com/a_b. and www.x.org and (http://y.z/p)', '<a href="https://example.com/a_b">https://example.com/a_b</a>. and <a href="http://www.x.org">www.x.org</a> and (<a href="http://y.z/p">http://y.z/p</a>)', 'extended autolinks');
  has('<https://a.b> and me@mail.org', '<a href="https://a.b">https://a.b</a> and <a href="mailto:me@mail.org">me@mail.org</a>', 'autolinks and e-mail');
  has('a  \nb\\\nc', 'a<br>\nb<br>\nc', 'hard breaks');
  has(':rocket: :tada: :nope:', '🚀', 'emoji shortcodes');
  has('&copy; &#x41; &amp;', '© A &amp;', 'entities');
  has('a <b>bold</b> c', 'a <b>bold</b> c', 'inline HTML tags');
  ok(!H('[x](javascript:alert(1))').includes('javascript'), 'javascript: link dropped');

  // Math.
  const mo = { math: (t, d) => `<math data-d="${d}">${t.replace(/</g, '&lt;')}</math>` };
  has('$a<b$ and $$c$$ and $`d`$', '<span class="md-math"><math data-d="false">a&lt;b</math></span>', 'inline math', mo);
  has('$`d`$', '<math data-d="false">d</math>', 'GitLab-style $`…`$', mo);
  has('x $$c$$ y', 'md-math-display', 'inline display math', mo);
  has('$$\n\\frac{a}{b}\n$$', '<div class="md-math md-math-block"><math data-d="true">\\frac{a}{b}</math></div>', 'math block', mo);
  has('```math\nx^2\n```', '<math data-d="true">x^2</math>', 'math fence', mo);
  has('costs $5 and $10', 'costs $5 and $10', 'dollars are not math', mo);
  ok(!H('$x$', mo).includes('data-md-x'), 'placeholders are replaced');
  has('```mermaid\ngraph TD; A-->B\n```', '<div class="md-diagram"><svg>A</svg></div>', 'mermaid hook', { diagram: () => '<svg>A</svg>' });

  // Alerts, footnotes, headings.
  has('> [!WARNING]\n> Careful', 'markdown-alert markdown-alert-warning', 'alert');
  ok(H('> [!TIP]\n> x').includes('>Tip</p>') && H('> [!TIP]\n> x').includes('<svg'), 'alert title and icon');
  ok(!H('> [!NOTE] inline\n> x').includes('markdown-alert'), 'alert marker must stand alone on its line');
  const fn = renderGFM('A[^1] B[^n].\n\n[^1]: One.\n[^n]: Two *em*.');
  ok(fn.footnotes.includes('<li id="user-content-fn-1">') && fn.footnotes.includes('Two <em>em</em>') && fn.html.includes('href="#fn-1"'), 'footnotes', fn.footnotes);
  ok(githubSlug('Hello, World! 2.0') === 'hello-world-20' && githubSlug('Привет мир') === 'привет-мир' && githubSlug('🚀 Features') === '-features', 'GitHub slugs');
  const sl = createSlugger();
  ok([sl('A'), sl('A'), sl('A'), sl('A-1')].join() === 'a,a-1,a-2,a-1-1', 'duplicate slugs');
  const hs = renderGFM('# One\n## Two\n## Two').headings;
  ok(hs.map((x) => x.slug).join() === 'one,two,two-1' && hs[1].level === 2, 'headings list', hs);

  // Source ranges.
  const src = 'Intro *x*\n\n- a\n- b\n\n![i](p.png) [l](u)\n\n> q\n\n```\nc\n```\n';
  const R = renderGFM(src, { positions: true });
  ok(R.blocks.map((b) => src.slice(b.start, b.end)).join('|') === 'Intro *x*|- a\n- b|![i](p.png) [l](u)|> q|```\nc\n```', 'block source ranges', R.blocks.map((b) => [b.start, b.end]));
  const img = /<img[^>]*data-md-pos="(\d+)-(\d+)"/.exec(R.html);
  ok(img && src.slice(+img[1], +img[2]) === '![i](p.png)', 'image source range', img && img.slice(1));
  const task = renderGFM('- [ ] t\n- [x] u', { positions: true }).html;
  const tp = [...task.matchAll(/data-md-pos="(\d+)-(\d+)"/g)].map((m) => +m[1]);
  ok(tp.join() === '3,11', 'task box positions', tp);
  const raw = '<p>\n<a href="https://x"><img src="b.svg"></a>\n</p>';
  const rp = /<a[^>]*data-md-pos="(\d+)-(\d+)"/.exec(renderGFM(raw, { positions: true }).html);
  ok(rp && raw.slice(+rp[1], +rp[2]) === '<a href="https://x"><img src="b.svg"></a>', 'linked image in raw HTML', rp && rp.slice(1));
  ok(!/data-md-pos/.test(H('<img src="a.png" data-md-pos="1-2">')), 'positions cannot be forged by the document');
  ok(renderGFM('> - a\n>   b').blocks.length === 1 && renderGFM('para\n# h').blocks.length === 2, 'containers and interrupts');

  // GFM write-back of the editors.
  const g = (h) => htmlToMarkdown(h, { gfm: true });
  ok(g('<p>C# 5$ a_b _x_ <kbd>K</kbd><br>n</p>') === 'C# 5\\$ a_b \\_x\\_ <kbd>K</kbd>\\\nn', 'GFM escaping and kbd / breaks', g('<p>C# 5$ a_b _x_ <kbd>K</kbd><br>n</p>'));
  ok(g('<p># x</p><p>1. y</p>') === '\\# x\n\n1\\. y', 'paragraph starts that would be blocks', g('<p># x</p><p>1. y</p>'));
  ok(g('<ul><li><input type="checkbox" checked> a</li><li>b<ul><li>c</li></ul></li></ul>') === '- [x] a\n- b\n  - c', 'task list write-back', g('<ul><li><input type="checkbox" checked> a</li><li>b<ul><li>c</li></ul></li></ul>'));
  ok(g('<p>a <span data-md-raw="![i](p.png)">x</span> b</p>') === 'a ![i](p.png) b', 'raw pieces kept verbatim');
  ok(g('<table><tr><th align="right">a</th><th>b</th></tr><tr><td>x|y</td><td>2</td></tr></table>') === '|    a | b   |\n| ---: | --- |\n| x\\|y | 2   |', 'padded table write-back', g('<table><tr><th align="right">a</th><th>b</th></tr><tr><td>x|y</td><td>2</td></tr></table>'));
  ok(inlineMarkdown('<b>a</b> <a href="#x" title="t">y</a>', { gfm: true }) === '**a** [y](#x "t")', 'inline GFM with titles');
  // Round trip: render, convert back, render again -> the same HTML.
  for (const s of ['Some **bold**, *em*, ~~del~~, `code` and [a link](https://x.y).', '- one\n- two\n  - three', '1. a\n2. b', '> quoted *text*', '## Heading **b**']) {
    const h1 = renderGFM(s).blocks[0].html;
    const back = g(h1);
    ok(renderGFM(back).blocks[0].html === h1, 'round trip: ' + s, back);
  }
  ok(sanitizeDoc('<img src="data:image/png;base64,AAAA">', { dataImages: false }) === '', 'data images can be dropped like GitHub');

  console.log(`markdown: ${passed} passed, ${failed} failed`);
  return failed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = run() ? 1 : 0;
