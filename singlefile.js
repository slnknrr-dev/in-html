// singlefile.js - the build of the repository: every application page becomes one self-contained HTML file, and every
// application also gets a multi-file deployment copy.
//
//   node singlefile.js [app ...] [--target singlefile|files] [--no-minify] [--check] [--quiet] [--publish <dir>]
//   (bun singlefile.js works too)
//
// An application is a top-level directory whose name contains '-'. Its top-level *.html pages are built into
//   <app>/html@5-singlefile/<page>.html  one self-contained file per page (opens from file://, e-mail, any host)
//   <app>/html@5/                        multi-file copy (multifile.js): the pages, the application modules and the
//                                        library modules they use as subfolders, each tree-shaken and minified
// Artifact directories (depth 2, name contains '@') are never read as sources; files in them that the build no longer
// produces are removed. --check builds in memory and exits 1 when an artifact is missing, stale or out of date.
// --publish <dir> also writes the single-file pages under publishing names (publishName: landing-studio ->
// LANDING.html, other pages LANDING.<page>.html) into <dir>, e.g. a checkout of a Pages repository; links between
// pages of one application follow those names.
//
// Single-file pages: module scripts (external and inline, any number) are bundled into one tree-shaken inline module
// (bundle.js); classic scripts, stylesheets (@import included), icons, images, media, fonts and CSS url()s are inlined
// as text or data: URLs; links between pages of the same app follow the target's page names (<a href> in the markup
// and string literals in scripts that are exactly a sibling page name, optionally with ./ and a ?query / #hash); HTML,
// CSS and JS are minified (minify/). Remote resources are reported, not fetched.
// Standalone applications (policy.js: -offline, -effect) must not contain any network API or remote resource: such a
// page fails the build (both targets are audited).
// NOTICE files: an application directory holding [SINGLEFILE_](OFFLINE|SERVERLESS|BACKEND|STANDALONE|ELECTRON)[_SINGLEFILE]_NOTICE.md
// gets exactly the artifacts they name instead of the two defaults (targets.js: html@5_offline/,
// html@5_offline_singlefile/, html@5_serverless/, html@5_serverless_singlefile/<app>.mjs, html@5_backend/,
// html@5_backend_singlefile/<app>.mjs, html@5_standalone/, html@5_electron/, html@5_electron_singlefile/: an Electron
// application folder with package.json, main.mjs, preload.cjs); offline ones must not use the network; artifact folders
// that no NOTICE asks for any more are removed. --target singlefile | files limits them to single-file / multi-file
// ones; --publish writes the offline single-file pages (or the standalone ones) under the publishing names.
// DEMO_NOTICE.md: --demo <dir> builds the application as an offline single-file page into <dir>/<slug>.html (other
// pages <slug>.<page>.html), the slug taken from the notice's first line: '# RESUME BUILDER' -> resume-builder.html.
// Demos are never written into the repository; without --demo the notice changes nothing. --target demo builds
// only the demos.
//
// PIPELINE (one page, single-file target):
//   1. tokenizeHTML (minify/html.js): a flat token stream, not a DOM. A DOM round trip would normalise markup the
//      author wrote on purpose (optional tags, attribute order, whitespace in <pre>); tokens re-serialise verbatim.
//   2. Scan tokens: module scripts become bundle entries (the first <script type=module> is the slot that receives the
//      bundle, the others are dropped); classic scripts, stylesheets, icons and media are inlined in place.
//   3. bundle.js: parse every reachable module (parse.js), resolve imports, tree-shake dead top-level units, rename
//      to avoid collisions (scope.js), concatenate into one module, inline new URL('./x', import.meta.url) assets.
//   4. finishJS: re-tokenise the bundle (also a syntax check of the bundler's own output), minify token-wise, escape
//      '</script' and '<!--' inside literals so the code is safe as raw text in a <script> element.
//   5. pageLiterals / pageLink: rename references to sibling pages to the target's output names.
//   6. minifyHTML, then withArtifact injects globalThis.IN_HTML_ARTIFACT, then policy.js audits the FINAL text.
// Why the audit is last: only the shipped bytes matter; anything earlier could be undone by a later inlining step.
// Why incremental sync (compare bytes, write only changes, prune stale): `--check` can prove artifacts are current
// (CI), and unchanged files keep their mtimes, so git and hosting caches see no spurious churn.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from './parse.js';
import { bundle } from './bundle.js';
import { dataURI } from './mime.js';
import { emitJS, minifyJS } from './minify/js.js';
import { minifyCSS } from './minify/css.js';
import { tokenizeHTML, minifyHTML, serializeTag, attr, setAttr } from './minify/html.js';
import { auditArtifact, networkUses } from './policy.js';
import { buildAppFiles } from './multifile.js';
import { buildTarget, isTargetDir, noticeTargets } from './targets.js';

export const TARGET = 'html@5-singlefile';   // single-file pages
export const TARGET_FILES = 'html@5';       // multi-file deployment copy
export const ROOT = path.dirname(fileURLToPath(import.meta.url));

const isRemote = (u) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(u);
const isInert = (u) => !u || /^(?:data:|blob:|#|about:|javascript:|mailto:|tel:)/i.test(u);

// The '-' rule separates applications (unit-converter) from libraries (ui, codec, bundle); '@' dirs are outputs.
export function listApps(root = ROOT) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.includes('-') && !/^[._]/.test(e.name) && !e.name.includes('@'))
    .map((e) => e.name)
    .sort();
}

export function listPages(appDir) {
  return fs.readdirSync(appDir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.html?$/i.test(e.name))
    .map((e) => e.name)
    .sort();
}

// Artifact name of a page in html@5-singlefile/ and html@5/: the page's own name.
export const artifactName = (app, page) => page;

// Publishing name (one flat folder for every application): the application's first word in capitals.
// One flat folder for all apps (a Pages repo): names must be short and collision-free; main() falls back to the full
// app name when two apps share the first word.
export function publishName(app, page, base = app.split('-')[0].toUpperCase()) {
  const p = page.replace(/\.html?$/i, '');
  return p === 'index' ? `${base}.html` : `${base}.${p}.html`;
}

// Demo slug from DEMO_NOTICE.md's first line ('# RESUME BUILDER' -> 'resume-builder'), or null without the notice.
export function demoSlug(appDir) {
  let text;
  try { text = fs.readFileSync(path.join(appDir, 'DEMO_NOTICE.md'), 'utf8'); } catch { return null; }
  const first = text.replace(/^﻿/, '').split(/\r?\n/).find((l) => l.trim()) || '';
  const head = /^#\s+(.+)$/.exec(first.trim());
  // NFKD + strip combining marks (U+0300..U+036F): 'Résumé' -> 'resume', so slugs stay ASCII and URL-safe.
  const slug = head && head[1].trim().toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) throw new Error(`${path.basename(appDir)}/DEMO_NOTICE.md: the first line must be '# NAME'`);
  return slug;
}

export function demoName(slug, page) {
  const p = page.replace(/\.html?$/i, '');
  return p === 'index' ? `${slug}.html` : `${slug}.${p}.html`;
}

// ---------------------------------------------------------------------------------------------
// JavaScript output: exact tokens from parse.js -> minify/js.js, with HTML-safe literals.

// Inside a <script>, `</script` and `<!--` must not appear: rewrite their `<` as \x3C inside literals.
// A backslash run before '<' is handled by parity: an odd run means the '<' was itself escaped ('\<' == '<' in JS
// strings), so one backslash is dropped before writing '\x3C'; an even run is a literal backslash pair, kept whole.
// '\x3C' is valid in strings, templates and regexes alike and decodes to the same character, so semantics are
// unchanged while the HTML tokenizer never sees '</script' or '<!--' (the latter switches it into an escaped state
// in which a later '</script>' may not end the element).
function escapeLt(text) {
  return text.replace(/(\\*)<(?=\/script|!--)/gi, (m, bs) => (bs.length % 2 ? bs.slice(1) : bs) + '\\x3C');
}

// Tokens are re-derived from source slices (src.slice(start, end)), never re-printed from values: numbers, strings and
// regexes keep their exact spelling (0x10, '\u00e9'), so minification cannot change a literal's meaning.
// `prop` marks names after '.' / '?.': the minifier must never treat them as identifiers (no renaming, and no ASI
// assumptions). `nl` (newline before) is kept because ASI makes some line breaks semantic (return\nx, x\n++y).
function jsTokens(src, sourceType) {
  const ast = parse(src, { sourceType, tokens: true, file: '<bundle>' });
  const out = [];
  let prev = null;
  for (const t of ast.tokens) {
    const v = src.slice(t.start, t.end);
    let tk;
    switch (t.type) {
      case 'name': tk = { t: 'name', v, prop: !!prev && prev.t === 'p' && (prev.v === '.' || prev.v === '?.') }; break;
      case 'private': tk = { t: 'name', v, prop: true }; break;
      case 'num': tk = { t: 'num', v }; break;
      case 'string': tk = { t: 'str', v: escapeLt(v) }; break;
      case 'regexp': tk = { t: 're', v: escapeLt(v) }; break;
      case 'template': {
        const head = v[0] === '`';
        tk = { t: head ? (t.value.tail ? 'tpl' : 'tplh') : (t.value.tail ? 'tplt' : 'tplm'), v: escapeLt(v) };
        break;
      }
      default: tk = { t: 'p', v };
    }
    tk.nl = t.nl;
    out.push(tk);
    prev = tk;
  }
  return { tokens: out, comments: ast.comments };
}

// The one JS exit of the build. Even with minify off it parses (syntax guard on generated code) and escapes.
// Preserved comments: /*! ... */ and @license / @preserve, the common convention for licence notices that must survive
// minification; '*/' inside them is defused so a crafted comment cannot terminate early.
export function finishJS(code, { minify = true, sourceType = 'module' } = {}) {
  const { tokens, comments } = jsTokens(code, sourceType); // also validates the syntax
  if (!minify) return escapeLt(code).replace(/<\/script/gi, '<\\/script');
  const keep = comments.filter((c) => c.type === 'Block' && (c.value.startsWith('!') || /@(license|preserve)\b/.test(c.value)))
    .map((c) => `/*${c.value.replace(/\*\//g, '* /')}*/\n`);
  return keep.join('') + emitJS(tokens);
}

// '\3c ' is the CSS escape for '<' (the trailing space ends the hex escape): '</style' cannot appear in the output.
function finishCSS(code, minify) {
  const out = minify ? minifyCSS(code) : code;
  return out.replace(/<\/style/gi, '\\3c /style');
}

// ---------------------------------------------------------------------------------------------
// Page builder

class Page {
  constructor({ root, app, file, minify, pages, nameOf = (p) => artifactName(app, p), variant = null, artifact = null }) {
    this.variant = variant;      // module variant ('offline': x.offline.js replaces x.js when it exists)
    this.artifact = artifact;    // runtime description put on the page as globalThis.IN_HTML_ARTIFACT
    this.root = root;
    this.app = app;
    this.file = file;
    this.dir = path.dirname(file);
    this.minify = minify;
    this.pages = pages;          // sibling page names of the app
    this.nameOf = nameOf;        // page name -> output name (links between pages)
    this.warnings = [];
    this.inputs = new Set([file]);
    this.stats = null;
  }

  warn(msg) {
    this.warnings.push(msg);
  }

  read(file) {
    this.inputs.add(file);
    return fs.readFileSync(file);
  }

  localFile(url, base) {
    const clean = decodeURIComponent(url.replace(/[?#].*$/, ''));
    const file = clean.startsWith('/') ? path.join(this.root, clean) : path.resolve(base, clean);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`${path.relative(this.root, this.file)}: missing file "${url}"`);
    return file;
  }

  // KNOWN DEFECT: the condition tests the FRAGMENT (which always starts with '#') against /^data:image\/svg/, so it is
  // always true and the fragment is appended to every data: URL. Intended (probably): keep '#id' for SVG sprites and
  // drop it otherwise. Fix: test the dataURI result instead of hash[0].
  // URL attribute value -> data: URL (local files) or unchanged (inert / remote, with a warning).
  inlineURL(url, base, what) {
    url = url.trim();
    if (isInert(url)) return url;
    if (isRemote(url)) {
      this.warn(`${what} "${url}" is remote and was not inlined`);
      return url;
    }
    const file = this.localFile(url, base);
    const hash = /#.*$/.exec(url);
    return dataURI(file, this.read(file)) + (hash && !/^data:image\/svg/.test(hash[0]) ? hash[0] : '');
  }

  // CSS text: @import inlined recursively, url()s inlined relative to `base`.
  // @import is inlined recursively with a `seen` set: cycles terminate and diamond imports are emitted once (CSS
  // cascade order: first occurrence wins here, which matches browser behaviour for an already-loaded sheet only
  // approximately). A media list becomes an @media wrapper. KNOWN DEFECT: layer(...) / supports(...) import
  // conditions are wrapped as if they were media queries, producing invalid @media. Fix: parse them separately.
  // url()s are resolved against the file that contains them (base), not the page: that is how browsers resolve them.
  css(text, base, seen = new Set()) {
    text = text.replace(/@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)\s*([^;]*);/gi, (m, q1, u1, q2, u2, media) => {
      const url = u1 || u2;
      if (isRemote(url)) {
        this.warn(`@import "${url}" is remote and was not inlined`);
        return m;
      }
      const file = this.localFile(url, base);
      if (seen.has(file)) return '';
      seen.add(file);
      const inner = this.css(String(this.read(file)), path.dirname(file), seen);
      return media.trim() ? `@media ${media.trim()}{${inner}}` : inner;
    });
    return text.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (m, q, url) => {
      if (isInert(url.trim())) return m;
      const v = this.inlineURL(url, base, 'url()');
      return `url("${v.replace(/"/g, '%22')}")`;
    });
  }

  srcset(value, base) {
    return value.split(',').map((part) => {
      const m = /^\s*(\S+)(.*)$/.exec(part);
      return m ? this.inlineURL(m[1], base, 'srcset') + m[2] : part;
    }).join(',');
  }

  // String literals in script code that name a sibling page ('scan.html', "./scan.html#x") → output names.
  // Only exact literals are rewritten ('scan.html', './scan.html?x'), never substrings: a heuristic broad enough to
  // catch concatenations would also rewrite unrelated text. Skipped entirely when names do not change (the default).
  pageLiterals(code) {
    if (!this.pages.some((p) => this.nameOf(p) !== p)) return code;
    const names = this.pages.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const re = new RegExp(`(["'])(?:\\./)?(${names})((?:[?#][^"'\\\\\\n]*)?)\\1`, 'g');
    return code.replace(re, (m, q, name, rest) => q + this.nameOf(name) + rest + q);
  }

  pageLink(href) {
    const m = /^(?:\.\/)?([^/?#]+\.html?)([?#].*)?$/i.exec(href);
    if (!m || !this.pages.includes(m[1])) return null;
    return this.nameOf(m[1]) + (m[2] || '');
  }

  build() {
    const src = String(this.read(this.file)).replace(/^\ufeff/, '');
    const toks = tokenizeHTML(src);
    const entries = [];
    let firstModule = -1;
    let inlineCount = 0;
    const drop = new Set();
    for (let i = 0; i < toks.length; i++) {
      const tk = toks[i];
      if (tk.t !== 'open') continue;
      const name = tk.name;
      if (name === 'script') {
        const raw = toks[i + 1] && toks[i + 1].t === 'raw' ? toks[i + 1] : null;
        const type = (attr(tk, 'type') || '').trim().toLowerCase();
        const srcUrl = attr(tk, 'src');
        if (type === 'module') {
          if (srcUrl !== null) {
            if (isRemote(srcUrl)) throw new Error(`${path.relative(this.root, this.file)}: remote module script "${srcUrl}"`);
            entries.push({ file: this.localFile(srcUrl, this.dir) });
          } else {
            entries.push({ file: `${this.file}#${++inlineCount}`, code: raw ? raw.v : '' });
          }
          if (firstModule < 0) firstModule = i;
          else drop.add(i);
          continue;
        }
        if (type === 'importmap') {
          this.warn('<script type="importmap"> is ignored (bare specifiers are not bundled)');
          drop.add(i);
          continue;
        }
        if (srcUrl !== null && (!type || /javascript|ecmascript/.test(type))) {
          if (isRemote(srcUrl)) {
            this.warn(`script "${srcUrl}" is remote and was not inlined`);
            continue;
          }
          const file = this.localFile(srcUrl, this.dir);
          let code = String(this.read(file));
          if (this.minify) {
            try { code = finishJS(code, { sourceType: 'script' }); } catch { code = minifyJS(code); }
          }
          // Inline scripts ignore defer/async (HTML spec), so inlining as text would run them too early; a data: src
          // keeps the attribute effective and the original execution order.
          if (attr(tk, 'defer') !== null || attr(tk, 'async') !== null) {
            // Deferred / async execution order is kept by a data: URL source.
            setAttr(tk, 'src', 'data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
          } else {
            setAttr(tk, 'src', null);
            tk.inlineCode = code.replace(/<\/script/gi, '<\\/script');
          }
          // SRI hashes refer to the original file; the minified inline code would fail them.
          for (const a of ['integrity', 'crossorigin']) setAttr(tk, a, null);
        }
        continue;
      }
      if (name === 'link') {
        const rel = (attr(tk, 'rel') || '').toLowerCase().split(/\s+/);
        const href = attr(tk, 'href');
        if (href === null) continue;
        if (rel.includes('stylesheet')) {
          if (isRemote(href)) { this.warn(`stylesheet "${href}" is remote and was not inlined`); continue; }
          const file = this.localFile(href, this.dir);
          tk.inlineStyle = this.css(String(this.read(file)), path.dirname(file));
          // Preload hints point at files that no longer exist as separate resources.
        } else if (rel.includes('modulepreload') || rel.includes('preload') || rel.includes('prefetch')) {
          drop.add(i);
        } else if (rel.includes('manifest')) {
          this.warn('web app manifest links are dropped in single-file output');
          drop.add(i);
        } else if (rel.some((r) => /icon/.test(r))) {
          setAttr(tk, 'href', this.inlineURL(href, this.dir, 'icon'));
        }
        continue;
      }
      for (const a of tk.attrs) {
        const an = a.name.toLowerCase();
        if (a.value === null) continue;
        if ((an === 'src' && ['img', 'source', 'video', 'audio', 'track', 'embed', 'input', 'iframe'].includes(name)) ||
          (an === 'poster' && name === 'video') || (an === 'data' && name === 'object') ||
          ((an === 'href' || an === 'xlink:href') && (name === 'image' || name === 'use'))) {
          if (name === 'iframe' && /\.html?(?:[?#]|$)/i.test(a.value) && !isRemote(a.value)) {
            this.warn(`iframe "${a.value}" is inlined as a data: URL (scripts in it get an opaque origin)`);
          }
          if (name === 'use' && /^#/.test(a.value)) continue;
          setAttr(tk, a.name, this.inlineURL(a.value, this.dir, `<${name} ${an}>`));
        } else if (an === 'srcset' && (name === 'img' || name === 'source')) {
          setAttr(tk, a.name, this.srcset(a.value, this.dir));
        } else if (an === 'style' && /url\(/i.test(a.value)) {
          setAttr(tk, a.name, this.css(a.value.replace(/&quot;/g, '"').replace(/&amp;/g, '&'), this.dir));
        } else if (an === 'href' && name === 'a') {
          const link = this.pageLink(a.value);
          if (link) setAttr(tk, a.name, link);
        }
      }
      if (name === 'style' && toks[i + 1] && toks[i + 1].t === 'raw') {
        toks[i + 1].v = this.css(toks[i + 1].v, this.dir);
      }
      if (name === 'base') this.warn('<base> changes how the inlined page resolves URLs');
    }

    // One bundle for all module scripts of the page: module scripts share one module map in a browser (a module
    // imported by two scripts is evaluated once), and one bundle reproduces that; separate bundles would duplicate
    // shared state. Placed at the first module's position: module scripts are deferred and run in document order.
    // Bundle every module script of the page into one.
    let moduleCode = null;
    if (entries.length) {
      const r = bundle({ entries, root: this.root, readFile: (f) => this.read(f), warn: (m) => this.warn(m), variant: this.variant });
      for (const f of r.files) this.inputs.add(f);
      moduleCode = this.pageLiterals(finishJS(r.code, { minify: this.minify }));
      this.stats = r.stats;
    }

    // Re-serialize.
    let html = '';
    for (let i = 0; i < toks.length; i++) {
      const tk = toks[i];
      if (drop.has(i)) {
        if (toks[i + 1] && toks[i + 1].t === 'raw') i++;
        if (toks[i + 1] && toks[i + 1].t === 'close' && toks[i + 1].name === tk.name) i++;
        continue;
      }
      switch (tk.t) {
        case 'open':
          if (i === firstModule) {
            for (const a of ['src', 'defer', 'integrity', 'crossorigin']) setAttr(tk, a, null);
            html += serializeTag(tk) + moduleCode;
            if (toks[i + 1] && toks[i + 1].t === 'raw') i++;
          } else if (tk.inlineStyle !== undefined) {
            const media = attr(tk, 'media');
            html += `<style${media ? ` media="${media}"` : ''}>${tk.inlineStyle}</style>`;
          } else if (tk.inlineCode !== undefined) {
            html += serializeTag(tk) + tk.inlineCode;
            if (toks[i + 1] && toks[i + 1].t === 'raw') i++;
          } else html += serializeTag(tk);
          break;
        case 'close': html += `</${tk.name}>`; break;
        default: html += tk.v;
      }
    }

    if (this.minify) {
      html = minifyHTML(html, {
        js: (code, open) => {
          if (attr(open, 'type') === 'module') return code; // already final
          try { return finishJS(code, { sourceType: 'script' }); } catch { return minifyJS(code).replace(/<\/script/gi, '<\\/script'); }
        },
        css: (code, inAttr) => inAttr ? minifyCSS(code) : finishCSS(code, true),
        json: (code) => { try { return JSON.stringify(JSON.parse(code)).replace(/<\//g, '<\\/'); } catch { return code; } },
      });
    }
    return html;
  }
}

// The runtime description of an artifact (notice targets): a classic script at the start of <head>, so it exists
// before any module runs: globalThis.IN_HTML_ARTIFACT = { mode, singlefile, servers }.
// A classic script, not a module: classic inline scripts run synchronously during parsing, so the global exists
// before any (deferred) module evaluates. '<' is JSON-escaped as \u003c, so no value can close the script element.
export function withArtifact(html, artifact) {
  if (!artifact) return html;
  const tag = `<script>globalThis.IN_HTML_ARTIFACT=${JSON.stringify(artifact).replace(/</g, '\\u003c')}</script>`;
  const m = /<head(?:\s[^>]*)?>/i.exec(html);
  return m ? html.slice(0, m.index + m[0].length) + tag + html.slice(m.index + m[0].length) : tag + html;
}

export function buildPage(options) {
  const page = new Page(options);
  const html = withArtifact(page.build(), options.artifact);
  return { html, warnings: page.warnings, inputs: [...page.inputs], stats: page.stats };
}

// ---------------------------------------------------------------------------------------------
// CLI

function fmtSize(n) {
  return n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(2) + ' MB' : (n / 1024).toFixed(1) + ' KB';
}

// Files of a directory, recursively, as posix paths relative to it.
function listFiles(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out.sort();
}

function removeEmptyDirs(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) removeEmptyDirs(path.join(dir, e.name));
  if (!fs.readdirSync(dir).length) fs.rmdirSync(dir);
}

// Writes (or, with check, compares) a set of produced files under outDir: { changed, written } plus stale handling.
// Byte comparison before writing (not mtime): deterministic builds then produce zero writes, and --check reduces
// to the same code path with writes disabled. prune limits which unproduced files count as stale (e.g. only .html
// in html@5-singlefile/, so a hand-placed README survives).
function sync(outDir, produced, { check, quiet, label, prune }) {
  let changed = 0;
  for (const [rel, data] of produced) {
    const file = path.join(outDir, rel);
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const same = fs.existsSync(file) && fs.readFileSync(file).equals(buf);
    if (same) continue;
    changed++;
    if (!check) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buf);
    }
  }
  if (prune) {
    for (const rel of listFiles(outDir)) {
      if (produced.has(rel) || !prune(rel)) continue;
      changed++;
      if (!check) fs.rmSync(path.join(outDir, rel));
      if (!quiet) console.log(`${check ? '!' : '-'} ${label}/${rel}  (stale)`);
    }
    if (!check) removeEmptyDirs(outDir);
  }
  return changed;
}

export function main(argv = process.argv.slice(2), root = ROOT) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const valueOf = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  // Values of valued flags are excluded from the positional app list (otherwise `--target files` would build an
  // app named 'files').
  const values = new Set([valueOf('--target'), valueOf('--publish'), valueOf('--demo')].filter(Boolean));
  const only = argv.filter((a) => !a.startsWith('--') && !values.has(a)).map((a) => a.replace(/[\\/]+$/, ''));
  const minify = !flags.has('--no-minify');
  const check = flags.has('--check');
  const quiet = flags.has('--quiet');
  const target = valueOf('--target') || 'all';
  const publishDir = valueOf('--publish');
  const demoDir = valueOf('--demo');
  const demos = new Map();   // published demo file / slug -> application
  const doSingle = target !== 'files';
  const doFiles = target !== 'singlefile';
  const apps = only.length ? only : listApps(root);
  // Publishing names must not collide: applications sharing a first word keep their full name.
  const bases = new Map();
  for (const app of listApps(root)) {
    const b = app.split('-')[0].toUpperCase();
    bases.set(b, (bases.get(b) || 0) + 1);
  }
  const publishBase = (app) => (bases.get(app.split('-')[0].toUpperCase()) > 1 ? app.toUpperCase() : app.split('-')[0].toUpperCase());
  let failed = 0, changed = 0, built = 0;
  for (const app of apps) {
    const appDir = path.join(root, app);
    if (!fs.existsSync(appDir)) {
      console.error(`x ${app}: no such application directory`);
      failed++;
      continue;
    }
    const pages = listPages(appDir);
    if (!pages.length) {
      if (!quiet) console.log(`- ${app}: no pages`);
      continue;
    }
    if (demoDir) {
      try {
        const slug = demoSlug(appDir);
        if (slug) {
          if (demos.has(slug)) throw new Error(`demo name '${slug}' is already used by ${demos.get(slug)}`);
          demos.set(slug, app);
          const r = buildTarget({ root, app, target: { mode: 'offline', singlefile: true }, minify, nameOf: (p) => demoName(slug, p) });
          const uses = networkUses(r.audit.text);
          if (uses.length) throw new Error(`a demo must not use the network: ${[...new Set(uses.map((u) => u.what))].join(', ')}`);
          built++;
          changed += sync(path.resolve(demoDir), r.files, { check, quiet, label: demoDir });
          for (const name of r.files.keys()) {
            demos.set(name, app);
            if (!quiet) console.log(`  demo ${name}`);
          }
        }
      } catch (e) {
        failed++;
        console.error(`x ${app} (demo): ${e.message}`);
      }
    }
    if (target === 'demo') continue;
    const notices = noticeTargets(appDir);
    // Artifact folders nothing asks for: the defaults once NOTICE files exist, targets whose NOTICE file is gone.
    if (target === 'all') {
      for (const d of fs.readdirSync(appDir)) {
        const wanted = notices.length ? notices.some((t) => t.dir === d) : d === TARGET || d === TARGET_FILES;
        if (wanted || !(d === TARGET || d === TARGET_FILES || isTargetDir(d)) || !fs.statSync(path.join(appDir, d)).isDirectory()) continue;
        changed++;
        if (!check) fs.rmSync(path.join(appDir, d), { recursive: true, force: true });
        if (!quiet) console.log(`${check ? '!' : '-'} ${app}/${d}/  (no longer produced)`);
      }
    }
    if (notices.length) {
      for (const t of notices) {
        if ((target === 'singlefile' && !t.singlefile) || (target === 'files' && t.singlefile)) continue;
        const t0 = Date.now();
        let r;
        try {
          r = buildTarget({ root, app, target: t, minify });
        } catch (e) {
          failed++;
          console.error(`x ${app}/${t.dir}: ${e.message}`);
          continue;
        }
        const uses = networkUses(r.audit.text);
        if (r.audit.strict && uses.length) {
          failed++;
          console.error(`x ${app}/${t.dir}: an offline artifact must not use the network:`);
          for (const u of uses.slice(0, 8)) console.error(`    ${u.what}: …${u.snippet}…`);
          continue;
        }
        built++;
        const n = sync(path.join(appDir, t.dir), r.files, { check, quiet, label: `${app}/${t.dir}`, prune: () => true });
        changed += n;
        if (!quiet) {
          let bytes = 0;
          for (const d of r.files.values()) bytes += Buffer.byteLength(d);
          const st = r.stats ? `, ${r.stats.modules} modules` : '';
          console.log(`${n ? (check ? '!' : '+') : '='} ${app}/${t.dir}/  ${r.files.size} file${r.files.size === 1 ? '' : 's'}, ${fmtSize(bytes)}${st}  (${Date.now() - t0} ms)  [${t.notice}]`);
          for (const w of new Set(r.warnings)) if (!/import\.meta/.test(w)) console.log(`    warning: ${w}`);
          if (uses.length) console.log(`    network: ${[...new Set(uses.map((u) => u.what))].join(', ')}`);
        }
      }
      const pub = publishDir && (notices.find((t) => t.mode === 'offline' && t.singlefile) || notices.find((t) => t.mode === 'standalone'));
      if (pub) {
        const r = buildTarget({ root, app, target: pub, minify, nameOf: (p) => publishName(app, p, publishBase(app)) });
        const n = sync(path.resolve(publishDir), r.files, { check, quiet, label: publishDir });
        if (!quiet) for (const name of r.files.keys()) console.log(`  published ${name}`);
        changed += n;
      }
      continue;
    }
    if (doSingle) {
      const produced = new Map();
      const published = new Map();
      for (const page of pages) {
        const name = artifactName(app, page);
        const t0 = Date.now();
        let r;
        try {
          r = buildPage({ root, app, file: path.join(appDir, page), minify, pages });
        } catch (e) {
          failed++;
          console.error(`x ${app}/${page}: ${e.message}`);
          continue;
        }
        const audit = auditArtifact(app, r.html);
        if (!audit.ok) {
          failed++;
          console.error(`x ${app}/${page}: a standalone application must not use the network:`);
          for (const u of audit.uses.slice(0, 8)) console.error(`    ${u.what}: …${u.snippet}…`);
          continue;
        }
        built++;
        produced.set(name, r.html);
        if (publishDir) {
          const pub = buildPage({ root, app, file: path.join(appDir, page), minify, pages, nameOf: (p) => publishName(app, p, publishBase(app)) });
          published.set(publishName(app, page, publishBase(app)), pub.html);
        }
        if (!quiet) {
          const outFile = path.join(appDir, TARGET, name);
          const same = fs.existsSync(outFile) && fs.readFileSync(outFile, 'utf8') === r.html;
          const st = r.stats ? `, ${r.stats.modules} modules, ${r.stats.live}/${r.stats.units} top-level units kept` : '';
          console.log(`${same ? '=' : check ? '!' : '+'} ${app}/${TARGET}/${name}  ${fmtSize(Buffer.byteLength(r.html))}${st}  (${Date.now() - t0} ms)`);
          for (const w of r.warnings) console.log(`    warning: ${w}`);
          if (audit.uses.length) console.log(`    network (${audit.cls}): ${[...new Set(audit.uses.map((u) => u.what))].join(', ')}`);
        }
      }
      changed += sync(path.join(appDir, TARGET), produced, { check, quiet, label: `${app}/${TARGET}`, prune: (rel) => /\.html?$/i.test(rel) });
      if (publishDir) {
        const n = sync(path.resolve(publishDir), published, { check, quiet, label: publishDir });
        if (!quiet) for (const name of published.keys()) console.log(`  published ${name}`);
        changed += n;
      }
    }
    if (doFiles) {
      const t0 = Date.now();
      let r;
      try {
        r = buildAppFiles({ root, app, minify });
      } catch (e) {
        failed++;
        console.error(`x ${app}/${TARGET_FILES}: ${e.message}`);
        continue;
      }
      // The whole copy is audited: a standalone application must not reach the network from any of its files.
      const text = [...r.files].filter(([rel]) => /\.(html?|m?js|css|svg|json)$/i.test(rel)).map(([, d]) => String(d)).join('\n');
      const audit = auditArtifact(app, text);
      if (!audit.ok) {
        failed++;
        console.error(`x ${app}/${TARGET_FILES}: a standalone application must not use the network:`);
        for (const u of audit.uses.slice(0, 8)) console.error(`    ${u.what}: …${u.snippet}…`);
        continue;
      }
      built++;
      const n = sync(path.join(appDir, TARGET_FILES), r.files, { check, quiet, label: `${app}/${TARGET_FILES}`, prune: () => true });
      changed += n;
      if (!quiet) {
        let bytes = 0;
        for (const d of r.files.values()) bytes += Buffer.byteLength(d);
        const st = r.stats ? `, ${r.stats.modules} modules, ${r.stats.live}/${r.stats.units} top-level units kept` : '';
        console.log(`${n ? (check ? '!' : '+') : '='} ${app}/${TARGET_FILES}/  ${r.files.size} files, ${fmtSize(bytes)}${st}  (${Date.now() - t0} ms)`);
        for (const w of new Set(r.warnings)) if (!/import\.meta/.test(w)) console.log(`    warning: ${w}`);
      }
    }
  }
  // Demos whose application or DEMO_NOTICE.md is gone (only after a complete, successful run over every application).
  // Pruning demos only after a complete successful run: a partial or failed run has an incomplete `demos` map and
  // would delete live demos.
  if (demoDir && !only.length && !failed) {
    const dir = path.resolve(demoDir);
    for (const rel of listFiles(dir)) {
      if (rel.includes('/') || !/\.html?$/i.test(rel) || demos.has(rel)) continue;
      changed++;
      if (!check) fs.rmSync(path.join(dir, rel));
      if (!quiet) console.log(`${check ? '!' : '-'} ${demoDir}/${rel}  (no DEMO_NOTICE.md any more)`);
    }
  }
  if (!quiet) console.log(`${built} built, ${changed} ${check ? 'out of date' : 'changed'}, ${failed} failed`);
  return failed ? 1 : check && changed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
