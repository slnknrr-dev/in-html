// targets.js - artifact targets chosen by NOTICE files in an application directory (the user's convention): the mere
// presence of `[SINGLEFILE_](OFFLINE|SERVERLESS|BACKEND|STANDALONE|ELECTRON)[_SINGLEFILE]_NOTICE.md` (SINGLEFILE on either side)
// asks the build for that artifact. An application with NOTICE files gets exactly those artifacts (instead of the
// default html@5-singlefile/ + html@5/):
//
//   OFFLINE                html@5_offline/                    multi-file copy; module variant 'offline'; zero network
//   OFFLINE + SINGLEFILE   html@5_offline_singlefile/<page>   one self-contained HTML per page; variant 'offline'; zero network
//   SERVERLESS             html@5_serverless/                 multi-file static site for any static host (404.html routes)
//   SERVERLESS + SINGLEFILE html@5_serverless_singlefile/<app>.mjs   one script for Node >= 18 that serves the pages like
//                                                             GitHub Pages (hosting.js inside, pages inline)
//   BACKEND                html@5_backend/                    server.mjs (hosting.js), backend.mjs (the bundled <app>/backend.js),
//                                                             public/ (multi-file client)
//   BACKEND + SINGLEFILE   html@5_backend_singlefile/<app>.mjs  one script for Node >= 18: server, backend and the pages
//   STANDALONE             html@5_standalone/<page>           one HTML per page that opens from file:// and talks to
//                                                             servers over HTTPS + CORS (no server preset)
//   ELECTRON               html@5_electron/                   desktop application for Electron >= 29: package.json
//                                                             ("start": "electron ."), main.mjs (hosting.js + electron.js:
//                                                             pages from the in-html://<app>/ scheme, the backend
//                                                             in-process), backend.mjs (when <app>/backend.js exists),
//                                                             preload.cjs (electron-preload.cjs), public/ (multi-file client)
//   ELECTRON + SINGLEFILE  html@5_electron_singlefile/        package.json, preload.cjs and main.mjs with the backend and
//                                                             the single-file pages inline
//
// Every page gets globalThis.IN_HTML_ARTIFACT = { mode, singlefile, servers } (see singlefile.js withArtifact); the
// application decides from it which features to show. Module variant 'offline': an import of ./x.js resolves to
// ./x.offline.js when that file exists (bundle.js), so offline artifacts carry no network code at all.
// A BACKEND target needs <app>/backend.js whose default export is (ctx) => ({ handle(req, res, url) }) (hosting.js).
// ELECTRON targets mount the same backend.js when it exists (ctx.mode 'electron'); <app>/electron.json (optional)
// configures the window, the mini player, the external-link allowlist and the CSP (electron.js), and may name the
// package: { productName, version, description }.
//
// Why NOTICE files rather than a config file: the notice IS the documentation a reader of the artifact folder needs
// (what this artifact promises), and its presence is trivially checkable by `ls`. A JSON manifest would duplicate
// that and drift. Unknown names are ignored, never errors: a typo means a missing artifact, which check.js reports.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPage, listPages, finishJS } from './singlefile.js';
import { buildAppFiles } from './multifile.js';
import { bundle } from './bundle.js';
import { minifyJS } from './minify/js.js';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
export const NOTICE_RE = /^(?:(SINGLEFILE)_)?(OFFLINE|SERVERLESS|BACKEND|STANDALONE|ELECTRON)(?:_(SINGLEFILE))?_NOTICE\.md$/;

// Targets declared in an application directory: [{ notice, mode, singlefile, dir }] (stable order).
export function noticeTargets(appDir) {
  const seen = new Map();
  let names = [];
  try { names = fs.readdirSync(appDir); } catch { return []; }
  for (const n of names.sort()) {
    const m = NOTICE_RE.exec(n);
    // SINGLEFILE on both sides (SINGLEFILE_X_SINGLEFILE) is rejected as ambiguous rather than silently accepted.
    if (!m || (m[1] && m[3])) continue;
    const mode = m[2].toLowerCase();
    const singlefile = mode === 'standalone' || !!(m[1] || m[3]);
    const dir = mode === 'standalone' ? 'html@5_standalone' : `html@5_${mode}${singlefile ? '_singlefile' : ''}`;
    // Two spellings of the same target (SINGLEFILE_OFFLINE and OFFLINE_SINGLEFILE) dedupe to one dir; the sorted
    // listing makes the recorded `notice` deterministic.
    if (!seen.has(dir)) seen.set(dir, { notice: n, mode, singlefile, dir });
  }
  const order = ['offline', 'serverless', 'backend', 'standalone', 'electron'];
  return [...seen.values()].sort((a, b) => order.indexOf(a.mode) - order.indexOf(b.mode) || Number(a.singlefile) - Number(b.singlefile));
}

export const isTargetDir = (name) => /^html@5_(offline|serverless|backend|electron)(_singlefile)?$|^html@5_standalone$/.test(name);

const artifactOf = (t) => ({ mode: t.mode, singlefile: t.singlefile, servers: [] });

// The bundled backend of an application: code that sets globalThis[Symbol.for(key)] to backend.js's default export.
// The backend is bundled behind a synthetic entry that publishes its default export on a Symbol.for() global key.
// Why not `export default`: in single-file targets the code is pasted inside an IIFE in one script, where ES exports
// are impossible; a registry symbol is unforgeable by string-keyed globals and collision-free per app. The '#1' file
// suffix gives the virtual entry a unique module id while its relative imports still resolve from <app>/.
function backendCode({ root, app, minify, optional = false }) {
  const file = path.join(root, app, 'backend.js');
  if (!fs.existsSync(file)) {
    if (optional) return null;
    throw new Error(`${app}: a BACKEND target needs ${app}/backend.js`);
  }
  const key = `in-html:backend:${app}`;
  const r = bundle({
    entries: [{ file: file + '#1', code: `import backend from './backend.js';\nglobalThis[Symbol.for(${JSON.stringify(key)})] = backend;\n` }],
    root,
  });
  return { code: finishJS(r.code, { minify }), key, inputs: r.files, warnings: r.warnings, stats: r.stats };
}

// Tool sources copied into artifacts. With minify they lose their comments like every other artifact (minifyJS
// never renames, so the concatenated hosting.js + electron.js still share their top-level names); the generated
// run-instruction heads above them are kept on purpose.
const shipped = (src, minify) => (minify ? minifyJS(src) + '\n' : src);
const hostingSource = (minify) => shipped(fs.readFileSync(path.join(TOOLS, 'hosting.js'), 'utf8'), minify);
// electron.js without its import of hosting.js (main.mjs carries hosting.js above it).
// The regex removes exactly one import line: main.mjs concatenates hosting.js above electron.js, so its exports are
// already in scope and a second import of './hosting.js' (absent next to main.mjs) would fail at load time.
const electronSource = (minify) => shipped(fs.readFileSync(path.join(TOOLS, 'electron.js'), 'utf8').replace(/^import [^\n]*from '\.\/hosting\.js';[^\n]*\n/m, ''), minify);
const preloadSource = (minify) => shipped(fs.readFileSync(path.join(TOOLS, 'electron-preload.cjs'), 'utf8'), minify);

// <app>/electron.json: optional configuration of ELECTRON targets (electron.js startElectron config).
export function electronConfig(root, app) {
  const file = path.join(root, app, 'electron.json');
  if (!fs.existsSync(file)) return {};
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${app}/electron.json: ${e.message}`); }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error(`${app}/electron.json: an object expected`);
  return cfg;
}

function electronPackage(app, cfg) {
  const pkg = {
    name: app,
    productName: typeof cfg.productName === 'string' ? cfg.productName : app,
    version: typeof cfg.version === 'string' && /^\d+\.\d+\.\d+/.test(cfg.version) ? cfg.version : '1.0.0',
    private: true,
    description: (typeof cfg.description === 'string' ? cfg.description + ' ' : '') +
      '(Electron application generated by in-html singlefile.js. Run: npx electron . (or: npm install --save-dev electron, then npm start). Electron >= 29.)',
    main: 'main.mjs',
    scripts: { start: 'electron .' },
  };
  return JSON.stringify(pkg, null, 2) + '\n';
}

function electronHead(app) {
  return `// ${app}: Electron main process (generated by in-html singlefile.js; Electron >= 29, no other dependencies).\n` +
    `// Run in this folder: npx electron .   (or: npm install --save-dev electron && npm start)\n` +
    `// Options: --data <dir> (backend data, default <userData>/data), --devtools. Sources: hosting.js + electron.js.\n\n`;
}

function scriptHead(app, what) {
  return `#!/usr/bin/env node\n// ${app}: ${what} (generated by in-html singlefile.js; Node >= 18, no dependencies).\n` +
    `// Run: node ${app}.mjs [port] [--host 0.0.0.0]${what.includes('backend') ? ' [--data <dir>]' : ''}\n\n`;
}

// Single-file pages of the application for an artifact: Map(name -> html).
function singlePages({ root, app, minify, artifact, variant, nameOf }) {
  const appDir = path.join(root, app);
  const pages = listPages(appDir);
  const out = new Map(), warnings = [], inputs = [];
  let stats = null;
  for (const page of pages) {
    const r = buildPage({ root, app, file: path.join(appDir, page), minify, pages, variant, artifact, ...(nameOf ? { nameOf } : {}) });
    out.set(nameOf ? nameOf(page) : page, r.html);
    warnings.push(...r.warnings);
    inputs.push(...r.inputs);
    stats = r.stats || stats;
  }
  return { pages: out, warnings, inputs, stats };
}

// Pages travel base64-encoded inside a JSON literal in the generated .mjs: byte-exact for any content (text or binary),
// no escaping edge cases, and hosting.js serves them by Buffer.from(body, 'base64'). Cost: +33% size of the script.
const embed = (map) => Object.fromEntries([...map].map(([p, d]) => [p, { body: Buffer.from(d).toString('base64') }]));

// Builds one target: { files: Map(rel -> string | Buffer), audit: { text, strict }, warnings, stats }.
// Dispatch by (mode, singlefile). `audit.strict` is true only for offline: those artifacts must carry zero network
// code (policy.js), while serverless/backend/electron are expected to talk to something and are only reported.
// The audit text is collected from every text-like output file, i.e. what actually ships, never the sources.
export function buildTarget({ root, app, target, minify = true, nameOf = null }) {
  const artifact = artifactOf(target);
  const variant = target.mode === 'offline' ? 'offline' : null;
  const files = new Map();
  let warnings = [], stats = null;
  const auditText = [];
  if (target.mode === 'electron') {
    const cfg = electronConfig(root, app);
    const b = backendCode({ root, app, minify, optional: true });
    let main = electronHead(app) + hostingSource(minify) + '\n// --- electron.js ---\n' + electronSource(minify);
    // ESM has no __dirname; deriving it from import.meta.url keeps main.mjs relocatable (the app folder can move).
    const start = (src, backendExpr) => `import { fileURLToPath as __path } from 'node:url';\nconst __here = __path(new URL('.', import.meta.url));\n` +
      `startElectron({ ${src}, backend: ${backendExpr}, name: ${JSON.stringify(app)}, config: ${JSON.stringify(cfg)}, preload: epath.join(__here, 'preload.cjs'), here: __here });\n`;
    if (b) warnings.push(...b.warnings);
    if (target.singlefile) {
      const r = singlePages({ root, app, minify, artifact, variant });
      warnings.push(...r.warnings); stats = r.stats;
      if (b) main += `\n// --- application backend (${app}/backend.js, bundled) ---\n(() => {\n${b.code}\n})();\n`;
      main += `\nconst FILES = ${JSON.stringify(embed(r.pages))};\n` + start('files: FILES', b ? `globalThis[Symbol.for(${JSON.stringify(b.key)})]` : 'null');
      for (const html of r.pages.values()) auditText.push(html);
    } else {
      const r = buildAppFiles({ root, app, minify, variant, artifact });
      warnings.push(...r.warnings);
      stats = r.stats;
      for (const [rel, d] of r.files) {
        files.set('public/' + rel, d);
        if (/\.(html?|m?js|css|svg|json)$/i.test(rel)) auditText.push(String(d));
      }
      if (b) {
        files.set('backend.mjs', `// ${app}/backend.js, bundled for Node >= 18 (generated by in-html singlefile.js).\n(() => {\n${b.code}\n})();\nexport default globalThis[Symbol.for(${JSON.stringify(b.key)})];\n`);
        main += `\nimport backend from './backend.mjs';\n`;
      }
      main += '\n' + start("dir: epath.join(__here, 'public')", b ? 'backend' : 'null');
    }
    files.set('main.mjs', main);
    files.set('preload.cjs', preloadSource(minify));
    files.set('package.json', electronPackage(app, cfg));
  } else if (target.singlefile && (target.mode === 'offline' || target.mode === 'standalone')) {
    const r = singlePages({ root, app, minify, artifact, variant, nameOf });
    for (const [n, html] of r.pages) { files.set(n, html); auditText.push(html); }
    warnings = r.warnings; stats = r.stats;
  } else if (target.singlefile) {
    // One Node script carrying the pages (and the backend).
    const r = singlePages({ root, app, minify, artifact, variant });
    warnings = r.warnings; stats = r.stats;
    let src = scriptHead(app, target.mode === 'backend' ? 'backend and pages in one file' : 'static site in one file (GitHub Pages-like server)') + hostingSource(minify);
    let backend = 'null';
    if (target.mode === 'backend') {
      const b = backendCode({ root, app, minify });
      warnings.push(...b.warnings);
      src += `\n// --- application backend (${app}/backend.js, bundled) ---\n(() => {\n${b.code}\n})();\n`;
      backend = `globalThis[Symbol.for(${JSON.stringify(b.key)})]`;
    }
    src += `\nconst FILES = ${JSON.stringify(embed(r.pages))};\nstartHosting({ files: FILES, backend: ${backend}, name: ${JSON.stringify(app)} });\n`;
    files.set(`${app}.mjs`, src);
    for (const html of r.pages.values()) auditText.push(html);
  } else {
    const r = buildAppFiles({ root, app, minify, variant, artifact });
    warnings = [...r.warnings];
    stats = r.stats;
    const prefix = target.mode === 'backend' ? 'public/' : '';
    for (const [rel, d] of r.files) {
      files.set(prefix + rel, d);
      if (/\.(html?|m?js|css|svg|json)$/i.test(rel)) auditText.push(String(d));
    }
    if (target.mode === 'backend') {
      const b = backendCode({ root, app, minify });
      warnings.push(...b.warnings);
      files.set('backend.mjs', `// ${app}/backend.js, bundled for Node >= 18 (generated by in-html singlefile.js).\n(() => {\n${b.code}\n})();\nexport default globalThis[Symbol.for(${JSON.stringify(b.key)})];\n`);
      files.set('server.mjs', scriptHead(app, 'backend server; the client is in ./public').replace(`node ${app}.mjs`, 'node server.mjs') + hostingSource(minify) +
        `\nimport backend from './backend.mjs';\nimport { fileURLToPath as __path } from 'node:url';\n` +
        `startHosting({ dir: __path(new URL('./public', import.meta.url)), backend, name: ${JSON.stringify(app)} });\n`);
    }
  }
  return { files, audit: { text: auditText.join('\n'), strict: target.mode === 'offline' }, warnings, stats };
}
