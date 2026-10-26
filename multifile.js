// multifile.js - multi-file deployment of an application (the html@5/ artifact): a copy of the application's structure
// with only what its pages use. Pages and application modules sit at the top, the library modules they import keep
// their folders as subfolders (ui/app.js, doc/render.js, …), so the copy runs from any static host as is.
//
//   buildAppFiles({ root, app, minify, variant, artifact }) -> { files: Map<relative path, string | Buffer>, warnings, inputs,
//   stats }   variant / artifact: see singlefile.js (module variants, globalThis.IN_HTML_ARTIFACT on every page)
//
// JavaScript goes through the bundler's split mode (bundle.js splitModules): every module is tree-shaken on its own
// (dead top-level declarations and unused imports dropped), imports point straight at the declaring module, and the
// result is minified like the single-file build. Stylesheets keep their @import / url() structure with rewritten
// paths; icons, images, media, fonts and `new URL('./x', import.meta.url)` assets are copied; pages are minified.
//
// Why a multi-file artifact at all, next to single-file pages: shared modules are cached once across pages, large
// assets are not base64-inflated, and the output is diffable and debuggable. Why per-module split instead of one
// bundle per page: pages of one app share most code; a per-page bundle would duplicate it N times.
// Layout rule: app files are hoisted to the top, library files keep their repo-relative folder. This keeps every
// relative import valid without a resolver at runtime, and makes the artifact folder self-contained (no ../).
// KNOWN DEFECT: an app file '<app>/ui/app.js' and the library 'ui/app.js' both map to output 'ui/app.js'; the second
// silently overwrites (or is skipped by the files.has() guards). Fix: detect collisions in outPath and fail.

import fs from 'node:fs';
import path from 'node:path';
import { splitModules } from './bundle.js';
import { minifyJS } from './minify/js.js';
import { minifyCSS } from './minify/css.js';
import { tokenizeHTML, minifyHTML, serializeTag, attr, setAttr } from './minify/html.js';
import { finishJS, listPages, withArtifact } from './singlefile.js';

// Any scheme ('https:', 'data:', 'mailto:') or protocol-relative '//host' counts as non-local; isInert is checked
// first by callers, so data:/blob:/fragment URLs pass through untouched while http(s) ones warn.
const isRemote = (u) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(u);
const isInert = (u) => !u || /^(?:data:|blob:|#|about:|javascript:|mailto:|tel:)/i.test(u);
const posix = (p) => p.split(path.sep).join('/');

class AppFiles {
  constructor({ root, app, minify, variant = null, artifact = null }) {
    this.variant = variant;
    this.artifact = artifact;
    this.root = root;
    this.app = app;
    this.appDir = path.join(root, app);
    this.minify = minify;
    this.files = new Map();
    this.warnings = [];
    this.inputs = new Set();
  }

  warn(msg) {
    this.warnings.push(msg);
  }

  read(file) {
    this.inputs.add(file);
    return fs.readFileSync(file);
  }

  // Output path of a source file: application files at the top, everything else under its repository folder.
  outPath(file) {
    const inApp = path.relative(this.appDir, file);
    if (!inApp.startsWith('..') && !path.isAbsolute(inApp)) return posix(inApp);
    const inRoot = path.relative(this.root, file);
    if (inRoot.startsWith('..') || path.isAbsolute(inRoot)) throw new Error(`${file}: outside the repository`);
    return posix(inRoot);
  }

  // Relative URL from one output file to another.
  // Empty relative path means the file references itself; the basename keeps the URL non-empty (an empty src would
  // re-request the page).
  rel(fromOut, toOut) {
    const r = path.posix.relative(path.posix.dirname(fromOut), toOut);
    return r || path.posix.basename(toOut);
  }

  // Query/fragment stripped before the disk lookup and re-appended by asset(); root-absolute '/x' is the repo root,
  // matching what the dev server (server.js) serves. Missing files throw: a broken reference must fail the build.
  localFile(url, base) {
    const clean = decodeURIComponent(url.replace(/[?#].*$/, ''));
    const file = clean.startsWith('/') ? path.join(this.root, clean) : path.resolve(base, clean);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`${posix(path.relative(this.root, base))}: missing file "${url}"`);
    return file;
  }

  // A local file referenced from `fromOut`: copied once; returns the URL to use there.
  asset(url, base, fromOut, what) {
    url = url.trim();
    if (isInert(url)) return url;
    if (isRemote(url)) {
      this.warn(`${what} "${url}" is remote and was left as is`);
      return url;
    }
    const file = this.localFile(url, base);
    const out = this.outPath(file);
    if (!this.files.has(out)) this.files.set(out, /\.css$/i.test(file) ? this.cssFile(file) : this.read(file));
    const suffix = /[?#].*$/.exec(url);
    return this.rel(fromOut, out) + (suffix ? suffix[0] : '');
  }

  // Regex-level CSS rewriting is sufficient here: only @import targets and url() tokens change, never structure.
  // Two passes, @import first, so an @import url(...) is not rewritten twice by the generic url() pass.
  // Rewritten URLs are always double-quoted and '"' percent-encoded: unquoted url() breaks on spaces and parens.
  css(text, base, fromOut) {
    text = text.replace(/@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)/gi, (m, q1, u1, q2, u2) => {
      const url = u1 || u2;
      if (isRemote(url)) { this.warn(`@import "${url}" is remote and was left as is`); return m; }
      return `@import "${this.asset(url, base, fromOut, '@import')}"`;
    });
    return text.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (m, q, url) => {
      if (isInert(url.trim())) return m;
      return `url("${this.asset(url, base, fromOut, 'url()').replace(/"/g, '%22')}")`;
    });
  }

  cssFile(file) {
    const out = this.outPath(file);
    const text = this.css(String(this.read(file)).replace(/^﻿/, ''), path.dirname(file), out);
    return this.minify ? minifyCSS(text) : text;
  }

  // One page: resources rewritten; module scripts collected for the split bundle.
  page(file, entries) {
    const out = this.outPath(file);
    const dir = path.dirname(file);
    const toks = tokenizeHTML(String(this.read(file)).replace(/^﻿/, ''));
    let inline = 0;
    for (let i = 0; i < toks.length; i++) {
      const tk = toks[i];
      if (tk.t !== 'open') continue;
      const name = tk.name;
      // Module scripts: external ones become split-bundle entries (src rewritten to the output path); inline ones get a
      // synthetic id '<page>#n' so their imports resolve relative to the page, and their code is swapped in at
      // serialize(). Classic scripts are minified standalone (no module graph). Remote module scripts are fatal:
      // the build cannot vouch for code it does not ship.
      if (name === 'script') {
        const type = (attr(tk, 'type') || '').trim().toLowerCase();
        const src = attr(tk, 'src');
        if (type === 'module') {
          if (src !== null) {
            if (isRemote(src)) throw new Error(`${this.app}/${path.basename(file)}: remote module script "${src}"`);
            const f = this.localFile(src, dir);
            entries.push({ file: f });
            setAttr(tk, 'src', this.rel(out, this.outPath(f)));
          } else {
            const id = `${file}#${++inline}`;
            entries.push({ file: id, code: toks[i + 1] && toks[i + 1].t === 'raw' ? toks[i + 1].v : '' });
            tk.moduleId = id;
          }
        } else if (src !== null && (!type || /javascript|ecmascript/.test(type)) && !isRemote(src)) {
          const f = this.localFile(src, dir);
          const o = this.outPath(f);
          if (!this.files.has(o)) {
            let code = String(this.read(f));
            if (this.minify) { try { code = finishJS(code, { sourceType: 'script' }); } catch { code = minifyJS(code); } }
            this.files.set(o, code);
          }
          setAttr(tk, 'src', this.rel(out, o));
        }
        continue;
      }
      for (const a of tk.attrs) {
        const an = a.name.toLowerCase();
        if (a.value === null) continue;
        const rel = name === 'link' ? (attr(tk, 'rel') || '').toLowerCase() : '';
        if ((name === 'link' && an === 'href' && /stylesheet|icon|manifest|preload|prefetch/.test(rel)) ||
          (an === 'src' && ['img', 'source', 'video', 'audio', 'track', 'embed', 'input', 'iframe'].includes(name)) ||
          (an === 'poster' && name === 'video') || (an === 'data' && name === 'object') ||
          ((an === 'href' || an === 'xlink:href') && (name === 'image' || name === 'use') && !/^#/.test(a.value))) {
          if (name === 'iframe' && /\.html?(?:[?#]|$)/i.test(a.value)) continue; // pages are copied as pages
          // modulepreload hints point at pre-split sources whose output paths and contents change; left as authored.
          if (rel.includes('modulepreload')) continue;
          setAttr(tk, a.name, this.asset(a.value, dir, out, `<${name} ${an}>`));
        } else if (an === 'srcset' && (name === 'img' || name === 'source')) {
          setAttr(tk, a.name, a.value.split(',').map((part) => {
            const m = /^\s*(\S+)(.*)$/.exec(part);
            return m ? this.asset(m[1], dir, out, 'srcset') + m[2] : part;
          }).join(','));
          // Attribute values arrive entity-encoded from the tokenizer; decode the two entities that matter in CSS first.
        } else if (an === 'style' && /url\(/i.test(a.value)) {
          setAttr(tk, a.name, this.css(a.value.replace(/&quot;/g, '"').replace(/&amp;/g, '&'), dir, out));
        }
      }
      if (name === 'style' && toks[i + 1] && toks[i + 1].t === 'raw') toks[i + 1].v = this.css(toks[i + 1].v, dir, out);
    }
    return { file, out, toks };
  }

  serialize(pg, inlineCode) {
    let html = '';
    const { toks } = pg;
    for (let i = 0; i < toks.length; i++) {
      const tk = toks[i];
      if (tk.t === 'open') {
        html += serializeTag(tk);
        if (tk.moduleId !== undefined) {
          html += inlineCode.get(tk.moduleId) || '';
          if (toks[i + 1] && toks[i + 1].t === 'raw') i++;
        }
      } else if (tk.t === 'close') html += `</${tk.name}>`;
      else html += tk.v;
    }
    if (!this.minify) return html;
    // Escaping inside raw-text elements: '</script' or '</style' anywhere in the content would close the element
    // early (HTML tokenizer rule). JS gets '<\/script' (same string at runtime); CSS gets the escape '\3c ' (= '<').
    // JSON blocks are re-serialised compactly and '</' escaped the same way.
    return minifyHTML(html, {
      js: (code, open) => {
        if (attr(open, 'type') === 'module') return code; // already final
        try { return finishJS(code, { sourceType: 'script' }); } catch { return minifyJS(code).replace(/<\/script/gi, '<\\/script'); }
      },
      css: (code, inAttr) => (inAttr ? minifyCSS(code) : minifyCSS(code).replace(/<\/style/gi, '\\3c /style')),
      json: (code) => { try { return JSON.stringify(JSON.parse(code)).replace(/<\//g, '<\\/'); } catch { return code; } },
    });
  }

  build() {
    const entries = [];
    const pages = listPages(this.appDir).map((p) => this.page(path.join(this.appDir, p), entries));
    const inlineCode = new Map();
    let stats = null;
    if (entries.length) {
      // One split pass over ALL pages' entries: modules shared by several pages are emitted once, and tree-shaking sees
      // the union of used exports (a per-page pass could drop an export another page needs).
      const r = splitModules({
        entries, root: this.root, readFile: (f) => this.read(f), warn: (m) => this.warn(m), outPath: (f) => this.outPath(f), variant: this.variant,
      });
      for (const f of r.files) this.inputs.add(f);
      for (const m of r.modules) {
        const code = finishJS(m.code, { minify: this.minify });
        if (m.inline) inlineCode.set(m.id, code);
        else this.files.set(m.out, code);
      }
      for (const a of r.assets) if (!this.files.has(a.out)) this.files.set(a.out, this.read(a.file));
      stats = r.stats;
    }
    for (const pg of pages) this.files.set(pg.out, withArtifact(this.serialize(pg, inlineCode), this.artifact));
    return { files: this.files, warnings: this.warnings, inputs: [...this.inputs], stats };
  }
}

export function buildAppFiles(options) {
  return new AppFiles(options).build();
}
