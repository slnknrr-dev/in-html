// landing-studio/backend-archive.js - the files of an exported archive (CONTRACT.md §16), in the browser (export
// dialog) and in Node (tests):
//   archiveFiles(doc, opts) -> [{ name, data: string | Uint8Array }]   (writeZip input)
// opts = buildSite options + { target: 'static' | 'backend' | 'hybrid', engine: text of lib/site.mjs (backend targets),
// labels: editor labels for the admin console, editor: application name, created: ISO date }.
//   static   index.html, <page>/index.html, 404.html + assets/… (attachments as files; optionally the stylesheet and
//            script) — any static host (it serves 404.html for unknown addresses: virtual pages, the "Not found" page)
//   backend  public/ (the site, API on the same origin) + server.mjs + lib/site.mjs + data/site.json, data/build.json + README.md
//   hybrid   as backend; the page also runs on plain static hosting (probe of api/_ping, static fallback)
//
// Design rule: the archive is a pure function of (doc, opts) -> file list; zipping, downloading and writing to disk are
// the caller's business. That keeps it testable in Node and lets the editor and tests share one code path.
import { buildSite, planBackend, readmeText } from './backend-site.js';

// The launcher of a backend archive: Node built-ins in, the bundled server (lib/site.mjs) started.
// The only file with Node imports: the built-ins are imported here and injected into startServer, so lib/site.mjs
// stays runtime-agnostic (Node, Bun and Deno all resolve 'node:' specifiers). The site name lands inside a // comment
// of generated code, so CR / LF (would end the comment and inject code), '*' and '/' are replaced.
function launcher(name) {
  return `#!/usr/bin/env node
// server.mjs - the backend of "${String(name || 'Landing').replace(/[\r\n*/]/g, ' ')}" (exported by Landing Builder; see README.md).
//   node server.mjs [--port 8080] [--host 127.0.0.1] [--log]      Node >= 20
//   bun server.mjs        deno run --allow-net --allow-read --allow-write --allow-env server.mjs
// lib/site.mjs holds the server, the admin console and the landing engine (generated; do not edit).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import site from './lib/site.mjs';

await site.startServer({
  http, fs, path, crypto, zlib, Buffer,
  root: path.dirname(fileURLToPath(import.meta.url)),
  argv: process.argv.slice(2),
  env: process.env,
});
`;
}

// Anything but backend / hybrid falls back to 'static': an unknown target produces the safest package, not an error.
async function archiveFiles(doc, opts = {}) {
  const target = opts.target === 'backend' || opts.target === 'hybrid' ? opts.target : 'static';
  const site = await buildSite(doc, { ...opts, target });
  if (target === 'static') return site.files.map((f) => ({ name: f.path, data: f.data }));
  // Fail fast: without the engine the archive would contain a server.mjs that crashes on import. The regex is a cheap
  // sanity check that the text is the ES module bundle and not, say, an HTML error page.
  if (typeof opts.engine !== 'string' || !/export default/.test(opts.engine)) throw new Error('the backend engine is not available in this build');
  const d = site.doc;
  const created = opts.created || new Date().toISOString();
  const plan = planBackend(d, target, opts);
  // build.json freezes the export settings, so the server's rebuilds reproduce the editor's export byte for byte.
  const build = {
    v: 1, target, created, langs: site.page.report.langs, defaultLang: site.page.report.defaultLang,
    minify: opts.minify !== false, split: !!opts.split, virtual: !!opts.virtual, labels: opts.labels || {},
  };
  return [
    { name: 'README.md', data: readmeText({ name: d.name, target, plan, created, editor: opts.editor }) },
    { name: 'server.mjs', data: launcher(d.name) },
    { name: 'lib/site.mjs', data: opts.engine },
    { name: 'data/site.json', data: JSON.stringify(d) },
    { name: 'data/build.json', data: JSON.stringify(build, null, 1) + '\n' },
    ...site.files.map((f) => ({ name: 'public/' + f.path, data: f.data })),
    // The generated page files (the server removes the ones a later build no longer has).
    { name: 'public/.pages.json', data: JSON.stringify(site.pages || []) },
  ];
}

export {
  archiveFiles,
  launcher
};
