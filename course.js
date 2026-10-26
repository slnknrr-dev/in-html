// course.js — builds the learning courses (LEARN_*_COURSE.md) into static pages with live previews.
//
//   node course.js --fix [FILE…]    rewrite preview links inside the .md sources (idempotent; FILE limits it by name)
//   node course.js --check          exit 1 when --fix would change a source or a course link is broken (CI)
//   node course.js --out <dir>      write the pages into <dir> (a checkout of the Pages repository)
//
// Sources and published paths (PAGES = https://slnknrr.codeberg.page/):
//   LEARN_CSS_CASCADE_COURSE.md            -> course/in-html/css-cascade.html
//   .t9n/<lang>/LEARN_CSS_CASCADE_COURSE.md -> <lang>/course/in-html/css-cascade.html
//   every example block                     -> …/css-cascade/example-<n>.html  (the snippet as its own document)
//   README.md next to the courses           -> …/course/in-html/index.html  (programme; its link order = prev/next)
//
// Why Markdown is the source: Codeberg/GitHub render .md but strip CSS and scripts, so a course must read well as
// plain GFM. The published page adds what GFM cannot: live rendering of each example.
//
// Example block contract (the only construct this build treats specially):
//   <details>
//   <summary>Title</summary>
//
//   <a href="PAGES…/css-cascade.html#example-2">see preview & continue study</a>   <- maintained by --fix
//
//   ```html
//   <!doctype html> …
//   ```
//
//   </details>
// A <details> whose body contains a ```html fence. On Codeberg it is a collapsible snippet with a link to the live
// page; on the page it becomes a section with an <object> preview of example-<n>.html plus the highlighted code.
// Numbering is positional (1-based per file), so --fix must run after inserting or reordering examples; --check in CI
// fails fast when someone forgets. Why <object> and not <iframe>: requested by the course design; both give the
// example its own document (own cascade, own <head>), which is the point: a snippet styled by the course page's CSS
// would teach the wrong cascade.
//
// Links between courses are written as file names (LEARN_X_COURSE.md) so they work on Codeberg; the build rewrites
// them to the page names. A link to a missing course fails --check.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderGFM, plainText } from './markdown/gfm.js';
import { highlight } from './highlight/highlight.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const PAGES = 'https://slnknrr.codeberg.page/';
const SECTION = 'course/in-html';
const FILE_RE = /^LEARN_([A-Z0-9_]+)_COURSE\.md$/;
// Lazy body: the first </details> closes the block, so example blocks must not nest <details>.
const EX_RE = /<details>([\s\S]*?)<\/details>/g;
const FENCE_RE = /```html[^\n]*\n([\s\S]*?)\n```/;
const LINK_RE = /\n*<a href="[^"]*#example-\d+">[^<]*<\/a>\n*/;
const LINK_TEXT = 'see preview & continue study';

// Course links to files that do not exist (yet); the page still links to the future name. --check fails on any.
export const MISSING = [];
export const slugOf = (file) => file.match(FILE_RE)[1].toLowerCase().replace(/_/g, '-');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// [{ lang, dir, file, slug, prefix }] — lang '' = top-level courses. Dot-directory .t9n is ignored by singlefile.js
// (apps are dirs without a leading dot), so courses never leak into the app build.
export function listCourses(root = ROOT) {
  const sets = [{ lang: '', dir: root }];
  const t9n = path.join(root, '.t9n');
  if (fs.existsSync(t9n)) for (const l of fs.readdirSync(t9n).sort()) sets.push({ lang: l, dir: path.join(t9n, l) });
  const out = [];
  for (const s of sets) {
    if (!fs.statSync(s.dir).isDirectory()) continue;
    for (const f of fs.readdirSync(s.dir).sort()) if (FILE_RE.test(f)) {
      out.push({ ...s, file: f, slug: slugOf(f), prefix: (s.lang ? s.lang + '/' : '') + SECTION + '/' });
    }
  }
  return out;
}

// Programme order: the order of LEARN_*_COURSE.md links in README.md of the set; unlisted courses follow by name.
function ordered(courses, dir) {
  const readme = path.join(dir, 'README.md');
  const order = fs.existsSync(readme) ? [...fs.readFileSync(readme, 'utf8').matchAll(/\((LEARN_[A-Z0-9_]+_COURSE\.md)\)/g)].map((m) => m[1]) : [];
  const rank = (c) => { const i = order.indexOf(c.file); return i < 0 ? 1e6 : i; };
  return [...courses].sort((a, b) => rank(a) - rank(b) || a.file.localeCompare(b.file));
}

// Source with every example link set to its position. Inserts the link right after </summary> when missing.
export function fixSource(src, c) {
  let n = 0;
  return src.replace(EX_RE, (whole, body) => {
    if (!FENCE_RE.test(body)) return whole;
    const href = `${PAGES}${c.prefix}${c.slug}.html#example-${++n}`;
    const link = `\n\n<a href="${href}">${LINK_TEXT}</a>\n\n`;
    const next = LINK_RE.test(body) ? body.replace(LINK_RE, link) : body.replace(/(<\/summary>)\n*/, `$1${link}`);
    return `<details>${next}</details>`;
  });
}

const fullDoc = (code) => /^\s*<!doctype/i.test(code) ? code
  : `<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n</head>\n<body>\n${code}\n</body>\n</html>\n`;

// Renders one course: { html, examples: [code], title }.
function renderCourse(src, c, names) {
  const examples = [];
  const titles = [];
  // Placeholders survive GFM as a paragraph; the sanitizer never sees our <object> markup.
  const pre = src.replace(EX_RE, (whole, body) => {
    const m = body.match(FENCE_RE);
    if (!m) return whole;
    examples.push(m[1]);
    titles.push(plainText((body.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1] || ''));
    return `\n\nCOURSE-EXAMPLE-${examples.length}\n\n`;
  });
  const r = renderGFM(pre, { highlight, idPrefix: '' });
  let html = r.html.replace(/<p>COURSE-EXAMPLE-(\d+)<\/p>/g, (m, k) => {
    const i = +k, file = `${c.slug}/example-${i}.html`;
    return `<section class="ex" id="example-${i}"><h4 class="ex-h"><a href="#example-${i}">#${i}</a> ${esc(titles[i - 1])}</h4>`
      + `<object class="ex-view" type="text/html" data="${file}" aria-label="${esc(titles[i - 1])}"></object>`
      + `<p class="ex-tools"><a href="${file}" target="_blank" rel="noopener">открыть отдельно ↗</a></p>`
      + `<details class="ex-code" open><summary>код</summary><pre><code class="language-html">${highlight(examples[i - 1], 'html')}</code></pre></details></section>`;
  });
  // Course-to-course links: file name -> page name; anchors kept.
  html = html.replace(/href="(?:\.\/)?(LEARN_[A-Z0-9_]+_COURSE)\.md(#[^"]*)?"/g, (m, f, h) => {
    const file = f + '.md';
    if (!names.has(file)) MISSING.push(`${c.lang || 'top'}/${c.file} -> ${file}`);
    return `href="${slugOf(file)}.html${h || ''}"`;
  });
  const title = r.headings[0]?.text || c.slug;
  return { html, examples, title, headings: r.headings };
}

const CSS = fs.readFileSync(path.join(ROOT, 'markdown/gfm.css'), 'utf8') + `
html{color-scheme:light dark}body{margin:0;background:#fff;font:16px/1.6 system-ui,sans-serif}
@media (prefers-color-scheme:dark){body{background:#0d1117}}
.wrap{display:grid;grid-template-columns:minmax(0,1fr);max-width:980px;margin:0 auto;padding:24px 16px 64px}
.nav{display:flex;justify-content:space-between;gap:12px;margin:32px 0 0;font-size:14px}.nav a{text-decoration:none}
.top{font-size:14px;margin-bottom:16px}
.ex{margin:20px 0;border:1px solid var(--md-border,#d1d9e0);border-radius:10px;overflow:hidden}
.ex-h{margin:0!important;padding:8px 12px;font-size:14px;border-bottom:1px solid var(--md-border,#d1d9e0)}
.ex-h a{text-decoration:none;opacity:.6}
.ex-view{display:block;width:100%;height:280px;border:0;background:#fff;resize:vertical;overflow:auto}
.ex-tools{margin:0!important;padding:4px 12px;font-size:13px;text-align:end}
.ex-code{margin:0!important;border-top:1px solid var(--md-border,#d1d9e0)}.ex-code>summary{padding:6px 12px;cursor:pointer;font-size:13px}
.ex-code pre{margin:0!important;border-radius:0!important}
`;

function page({ title, body, lang, nav }) {
  return `<!doctype html><html lang="${lang || 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<title>${esc(title)}</title><style>${CSS}</style></head><body><div class="wrap">`
    + `<p class="top"><a href="index.html">← программа</a></p><article class="md-body">${body}</article>${nav || ''}</div></body></html>\n`;
}

// Map of output path -> content for every course set.
export function buildAll(root = ROOT) {
  const files = new Map();
  const all = listCourses(root);
  const bySet = Map.groupBy(all, (c) => c.lang);
  for (const [lang, list] of bySet) {
    const dir = list[0].dir, prefix = list[0].prefix;
    const names = new Set(list.map((c) => c.file));
    const seq = ordered(list, dir);
    const rendered = seq.map((c) => ({ c, ...renderCourse(fs.readFileSync(path.join(dir, c.file), 'utf8'), c, names) }));
    rendered.forEach((x, i) => {
      const prev = rendered[i - 1], next = rendered[i + 1];
      const nav = `<nav class="nav">${prev ? `<a href="${prev.c.slug}.html">← ${esc(prev.title)}</a>` : '<span></span>'}`
        + `${next ? `<a href="${next.c.slug}.html">${esc(next.title)} →</a>` : '<span></span>'}</nav>`;
      files.set(prefix + x.c.slug + '.html', page({ title: x.title, body: x.html, lang, nav }));
      x.examples.forEach((code, k) => files.set(`${prefix}${x.c.slug}/example-${k + 1}.html`, fullDoc(code)));
    });
    const readme = path.join(dir, 'README.md');
    let idx;
    if (fs.existsSync(readme)) {
      idx = renderGFM(fs.readFileSync(readme, 'utf8'), { highlight, idPrefix: '' }).html
        .replace(/href="(?:\.\/)?(LEARN_[A-Z0-9_]+_COURSE)\.md"/g, (m, f) => `href="${slugOf(f + '.md')}.html"`);
    } else idx = '<ul>' + rendered.map((x) => `<li><a href="${x.c.slug}.html">${esc(x.title)}</a></li>`).join('') + '</ul>';
    files.set(prefix + 'index.html', page({ title: 'Курсы', body: idx, lang }).replace('<p class="top"><a href="index.html">← программа</a></p>', ''));
  }
  return files;
}

function main(argv) {
  const fix = argv.includes('--fix'), check = argv.includes('--check');
  const oi = argv.indexOf('--out');
  const only = argv.filter((a, i) => /^LEARN_.*.md$/.test(a) && argv[i - 1] !== '--out');
  let dirty = 0;
  for (const c of listCourses()) {
    if (only.length && !only.includes(c.file)) continue;
    const p = path.join(c.dir, c.file);
    const src = fs.readFileSync(p, 'utf8');
    const next = fixSource(src, c);
    if (next !== src) {
      if (fix) fs.writeFileSync(p, next);
      else { console.log(`stale preview links: ${path.relative(ROOT, p)} (run node course.js --fix)`); dirty++; }
    }
  }
  const files = buildAll();
  for (const m of MISSING) console.log(`missing course: ${m}`);
  if (oi >= 0) {
    const out = path.resolve(argv[oi + 1]);
    // Remove stale outputs only inside course sections: the Pages repo holds other content too.
    const sections = new Set([...files.keys()].map((f) => f.slice(0, f.indexOf(SECTION) + SECTION.length)));
    for (const s of sections) {
      const abs = path.join(out, s);
      if (!fs.existsSync(abs)) continue;
      for (const f of fs.readdirSync(abs, { recursive: true })) {
        const rel = (s + '/' + f).replace(/\\/g, '/');
        if (/\.html$/.test(rel) && !files.has(rel)) fs.rmSync(path.join(out, rel));
      }
    }
    for (const [rel, content] of files) {
      const abs = path.join(out, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (!fs.existsSync(abs) || fs.readFileSync(abs, 'utf8') !== content) fs.writeFileSync(abs, content);
    }
    console.log(`${files.size} course files -> ${out}`);
  }
  if (check && (dirty || MISSING.length)) process.exit(1);
  if (!fix && !check && oi < 0) console.log(`${files.size} course files OK`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
