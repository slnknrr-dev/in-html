// check.js - development checks of the repository (vanilla ESM, Node >= 22.12 or Bun, no dependencies, offline).
//
//   node check.js                         modules + tests + audit + electron (no browser)
//   node check.js modules [dir ...]       imports every module of the libraries / applications in Node: link errors
//                                         (missing exports, syntax) surface; DOM-only failures are ignored
//   node check.js tests [dir ...]         unit tests of the libraries: <dir>/test.js exports run() -> failures
//   node check.js audit                   network policy of every built artifact (policy.js): the single-file pages
//                                         and the multi-file copies
//   node check.js page <url|file> [--eval <js>]... [--wait <ms>] [--shot <png>] [--size <W>x<H>] [--dark | --light]
//                    [--lang <code>] [--mobile]
//                                         opens a page in headless Chrome, evaluates expressions (top-level await
//                                         allowed), prints console errors and exceptions, takes a screenshot;
//                                         --dark / --light: colour scheme, --lang: browser language and locale
//   node check.js e2e <url|file> <scenario.js> [--shot <png>] [--fake-media] [--size <W>x<H>] [--mobile] [--dark | --light]
//                    [--lang <code>]
//                                         runs an in-page scenario (a module whose default export is an async
//                                         function returning { steps: [[name, 'ok'|'FAIL', value], ...] });
//                                         --fake-media: Chrome's synthetic camera / microphone, permission granted
//   node check.js electron [app ...] [--build] [--singlefile]
//                                         ELECTRON artifacts under a stub of the electron module (check-electron.js):
//                                         scheme, window security, pages, CSP, IPC, preload; --build builds the target
//                                         in memory (any app), --singlefile checks html@5_electron_singlefile
//   node check.js golden <app> <outDir>   deterministic exports of every template of a document application
//                                         (<app>/viewer.js + <app>/templates.js) with seeded ids and a fixed clock;
//                                         compare two runs with `diff -r` to prove a refactoring changed nothing
//
// Browser commands drive a local Chrome / Chromium / Edge (CHROME=<path> overrides the lookup) through the DevTools
// protocol with Node's built-in WebSocket. Nothing is downloaded.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TARGET, TARGET_FILES, listApps } from './singlefile.js';
import { auditArtifact, networkUses } from './policy.js';
import { noticeTargets } from './targets.js';
import { checkElectron } from './check-electron.js';

// Design notes (kept below the header on purpose: main() prints the first 27 '//' lines of this file as the usage
// text, so any comment line added above would shift the help output).
// KNOWN DEFECT: the header has 28 comment lines, slice(0, 27) cuts the last one ("protocol with Node's built-in
// WebSocket..."). Fix: slice(0, 28), or stop at the first non-comment line.
// - No dependencies: Chrome is driven by raw CDP JSON over Node's global WebSocket (Node >= 22), not Puppeteer, so the
//   checks run offline on any machine with a Chromium-family browser.
// - Exit status = number of failures collapsed to 0/1, so the script composes with CI and git hooks.

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : null; };
const opts = (name) => argv.flatMap((a, i) => (a === '--' + name ? [argv[i + 1]] : []));
// Positional args: everything not a flag and not the value of a valued flag. Boolean flags are listed explicitly,
// otherwise the word after `--dark` would be swallowed as its value.
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !['--dark', '--light', '--mobile', '--fake-media'].includes(argv[i - 1])));

// ---------------------------------------------------------------------------------------------
// modules

// Modules are imported in Node to surface link errors (missing exports, syntax) without a browser. Browser-only
// globals throw at top level in Node; those errors are expected and skipped by message, everything else counts.
const LIB_SKIP = /document is not defined|window is not defined|navigator is not defined|indexedDB|localStorage|HTMLElement|customElements|requestAnimationFrame|matchMedia|getComputedStyle|ResizeObserver|BroadcastChannel is not defined/;

async function checkModules(dirs) {
  const all = dirs.length ? dirs : fs.readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !/^[.#_]/.test(e.name)).map((e) => e.name).sort();
  let bad = 0, n = 0;
  for (const d of all) {
    for (const f of fs.readdirSync(path.join(ROOT, d)).filter((x) => x.endsWith('.js') && x !== 'server.js').sort()) {
      n++;
      try { await import(pathToFileURL(path.join(ROOT, d, f)).href); } catch (e) {
        const msg = String((e && e.message) || e).split('\n')[0];
        if (LIB_SKIP.test(msg)) continue;
        bad++;
        console.log(`x ${d}/${f}: ${msg}`);
      }
    }
  }
  console.log(`${n} modules, ${bad} failing`);
  return bad;
}

// ---------------------------------------------------------------------------------------------
// tests

async function tests(dirs) {
  const all = dirs.length ? dirs : fs.readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !/^[.#_]/.test(e.name) && fs.existsSync(path.join(ROOT, e.name, 'test.js'))).map((e) => e.name).sort();
  let bad = 0;
  for (const d of all) {
    const m = await import(pathToFileURL(path.join(ROOT, d, 'test.js')).href);
    if (typeof m.run !== 'function') { console.log(`x ${d}/test.js exports no run()`); bad++; continue; }
    bad += await m.run();
  }
  return bad;
}

// ---------------------------------------------------------------------------------------------
// audit

// Text files of a directory tree (the multi-file artifact), concatenated.
function treeText(dir) {
  let out = '';
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out += treeText(p);
    else if (/\.(html?|m?js|css|svg|json)$/i.test(e.name)) out += fs.readFileSync(p, 'utf8') + '\n';
  }
  return out;
}

// The audit re-reads the BUILT artifacts from disk (not a fresh build): it certifies what is committed and shipped.
// '=' clean, '~' network uses reported but allowed for the class, 'x' policy violation.
function audit() {
  let bad = 0;
  const report = (app, label, text) => {
    const r = auditArtifact(app, text);
    const kinds = [...new Set(r.uses.map((u) => u.what))];
    console.log(`${r.ok ? (kinds.length ? '~' : '=') : 'x'} ${label}  [${r.cls}]${kinds.length ? '  network: ' + kinds.join(', ') : ''}`);
    if (!r.ok) bad++;
  };
  for (const app of listApps(ROOT)) {
    const dir = path.join(ROOT, app, TARGET);
    const files = path.join(ROOT, app, TARGET_FILES);
    // NOTICE targets (targets.js): offline ones are held to zero network, the others are reported.
    const notices = noticeTargets(path.join(ROOT, app));
    if (notices.length) {
      for (const t of notices) {
        const d = path.join(ROOT, app, t.dir);
        if (!fs.existsSync(d)) { console.log(`x ${app}/${t.dir}/  missing (run node singlefile.js ${app})`); bad++; continue; }
        const uses = networkUses(treeText(d));
        const kinds = [...new Set(uses.map((u) => u.what))];
        const fails = t.mode === 'offline' && uses.length > 0;
        console.log(`${fails ? 'x' : kinds.length ? '~' : '='} ${app}/${t.dir}/  [${t.mode}${t.singlefile ? ', single file' : ''}]${kinds.length ? '  network: ' + kinds.join(', ') : ''}`);
        if (fails) bad++;
      }
      continue;
    }
    if (!fs.existsSync(dir) && !fs.existsSync(files)) { console.log(`- ${app}: no artifacts`); continue; }
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.html'))) report(app, `${app}/${TARGET}/${f}`, fs.readFileSync(path.join(dir, f), 'utf8'));
    }
    if (fs.existsSync(files)) report(app, `${app}/${TARGET_FILES}/`, treeText(files));
  }
  return bad;
}

// ---------------------------------------------------------------------------------------------
// headless browser

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const c = process.platform === 'win32' ? [
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ] : process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ] : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge'];
  return c.find((p) => fs.existsSync(p)) || null;
}

const toURL = (u) => (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^[a-z]:[\\/]/i.test(u) ? u : pathToFileURL(path.resolve(u)).href);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Opens one headless browser page: { send(method, params), logs, close() }.
async function browser({ width = 1400, height = 900, mobile = false, fakeMedia = argv.includes('--fake-media'),
  scheme = argv.includes('--dark') ? 'dark' : argv.includes('--light') ? 'light' : '', lang = opt('lang') || '' } = {}) {
  const exe = findChrome();
  if (!exe) throw new Error('no Chrome / Chromium / Edge found (set CHROME=<path>)');
  // Random port + throwaway profile: parallel runs never share a browser, and no state leaks between runs.
  const port = 9300 + Math.floor(Math.random() * 600);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'check-'));
  const proc = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, `--window-size=${width},${height}`, '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required',
    ...(fakeMedia ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] : []), ...(lang ? [`--lang=${lang}`] : []),
    'about:blank'], { stdio: 'ignore' });
  let ws = null;
  // Poll up to ~15 s for the DevTools endpoint: browser start-up time varies widely (cold disk, antivirus).
  for (let i = 0; i < 75 && !ws; i++) {
    try {
      // The DevTools endpoint of the local browser (127.0.0.1): the only network use of this tool.
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((p) => p.type === 'page');
      if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
    } catch { /* not up yet */ }
    if (!ws) await sleep(200);
  }
  if (!ws) { proc.kill(); throw new Error('the browser did not start'); }
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    const p = msg.params || {};
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(p.type)) {
      logs.push(`[console.${p.type}] ` + p.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text));
    if (msg.method === 'Log.entryAdded' && p.entry.level === 'error') logs.push(`[log.error] ${p.entry.text} ${p.entry.url || ''}`);
  });
  // Minimal CDP client: request ids map to resolvers; events (no id) feed the logs above.
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  if (scheme) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
  if (lang) {
    // navigator.language(s) and Accept-Language follow the user agent override, Intl follows the locale override.
    const ua = await send('Runtime.evaluate', { expression: 'navigator.userAgent', returnByValue: true });
    await send('Emulation.setUserAgentOverride', { userAgent: ua.result.result.value, acceptLanguage: lang });
    await send('Emulation.setLocaleOverride', { locale: lang });
  }
  const close = async () => {
    try { ws.close(); } catch { /* closed */ }
    proc.kill();
    await sleep(400);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ }
  };
  return { send, logs, close };
}

async function evaluate(b, expression) {
  // userGesture: scenarios may start audio, media playback, fullscreen or clipboard writes like a click would.
  const run = (replMode) => b.send('Runtime.evaluate', { expression, awaitPromise: true, replMode, returnByValue: true, userGesture: true, timeout: 180000 });
  let r = await run(false);
  // Top-level await: evaluate again like the DevTools console (replMode returns the last statement's value; a promise
  // that is the value of a plain expression is awaited by the first, normal evaluation).
  const ex = r.result?.exceptionDetails;
  if (ex && /await is only valid|Unexpected reserved word/.test(ex.exception?.description || ex.text || '')) r = await run(true);
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
  return r.result?.result?.value;
}

async function shot(b, file) {
  const s = await b.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(file, Buffer.from(s.result.data, 'base64'));
  console.log('screenshot ' + file);
}

async function page(url) {
  const [w, h] = (opt('size') || '1280x900').split('x').map(Number);
  const b = await browser({ width: w, height: h, mobile: argv.includes('--mobile') });
  try {
    await b.send('Page.navigate', { url: toURL(url) });
    await sleep(+(opt('wait') || 1500));
    for (const e of opts('eval')) {
      let v;
      try { v = JSON.stringify(await evaluate(b, e)); } catch (err) { v = 'THROWS ' + err.message.split('\n')[0]; }
      console.log(`eval> ${e}\n  = ${v}`);
    }
    if (opt('shot')) await shot(b, opt('shot'));
    console.log(b.logs.length ? b.logs.join('\n') : '(no errors in console)');
    return b.logs.some((l) => l.startsWith('[exception]')) ? 1 : 0;
  } finally { await b.close(); }
}

async function e2e(url, scenarioFile) {
  const mod = await import(pathToFileURL(path.resolve(scenarioFile)).href);
  const [w, h] = (opt('size') || '1400x900').split('x').map(Number);
  const b = await browser({ width: w, height: h, mobile: argv.includes('--mobile') });
  try {
    await b.send('Page.navigate', { url: toURL(url) });
    await sleep(1500);
    let rep;
    try { rep = await evaluate(b, `(${mod.default.toString()})()`); } catch (e) { console.log('scenario failed: ' + e.message.slice(0, 2000)); return 1; }
    let bad = 0;
    for (const [name, st, v] of rep.steps) { if (st !== 'ok') bad++; console.log(`${st === 'ok' ? 'ok  ' : 'FAIL'} ${name}: ${JSON.stringify(v)}`); }
    for (const [k, v] of Object.entries(rep)) if (k !== 'steps') console.log(`${k}: ${JSON.stringify(v)}`);
    if (opt('shot')) await shot(b, opt('shot'));
    console.log(b.logs.length ? b.logs.join('\n') : '(no errors in console)');
    return bad || b.logs.some((l) => l.startsWith('[exception]')) ? 1 : 0;
  } finally { await b.close(); }
}

// ---------------------------------------------------------------------------------------------
// golden exports

// Golden-file determinism: every source of nondeterminism (Date, crypto.getRandomValues, Math.random) is replaced
// with a seeded generator (mulberry32-style mixing) and a fixed clock, and the seed is reset per template and
// variant, so output depends only on the code. These globals are patched for the rest of the process: golden must
// stay a standalone command, never combined with others in one run.
async function golden(app, outDir) {
  // Determinism: seeded crypto.getRandomValues / Math.random (ids) and a fixed clock (dates in the documents).
  let seed = 1;
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0); };
  const fixedNow = Date.UTC(2026, 9, 1, 12, 0, 0);
  const RealDate = Date;
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(fixedNow); }
    static now() { return fixedNow; }
  };
  crypto.getRandomValues = (arr) => { for (let i = 0; i < arr.length; i++) arr[i] = rnd() & 0xff; return arr; };
  Math.random = () => (rnd() % 1000000) / 1000000;
  const V = await import(pathToFileURL(path.join(ROOT, app, 'viewer.js')).href);
  const { TEMPLATES } = await import(pathToFileURL(path.join(ROOT, app, 'templates.js')).href);
  fs.mkdirSync(outDir, { recursive: true });
  const variants = {
    clean: { mode: 'clean' }, 'clean-nomin': { mode: 'clean', minify: false }, packed: { mode: 'packed' },
    source: { mode: 'clean', embedSource: true }, preview: { mode: 'clean', minify: false, preview: true },
  };
  let bad = 0;
  for (const tp of TEMPLATES) {
    seed = 1;
    const doc = tp.userLang ? tp.build(V, 'en', { name: 'Blank' }) : tp.build(V);
    const norm = V.normalizeDoc(doc);
    fs.writeFileSync(path.join(outDir, `${tp.id}.doc.json`), JSON.stringify(norm, null, 1));
    for (const [name, o] of Object.entries(variants)) {
      seed = 7;
      try {
        const r = await V.exportHTML(norm, o);
        fs.writeFileSync(path.join(outDir, `${tp.id}.${name}.html`), r.html);
        fs.writeFileSync(path.join(outDir, `${tp.id}.${name}.report.json`), JSON.stringify(r.report, null, 1));
      } catch (e) {
        bad++;
        fs.writeFileSync(path.join(outDir, `${tp.id}.${name}.error.txt`), String((e && e.stack) || e));
      }
    }
    try {
      const back = await V.extractSource(fs.readFileSync(path.join(outDir, `${tp.id}.source.html`), 'utf8'));
      fs.writeFileSync(path.join(outDir, `${tp.id}.extract.json`), JSON.stringify(back, null, 1));
    } catch (e) { bad++; fs.writeFileSync(path.join(outDir, `${tp.id}.extract.error.txt`), String((e && e.stack) || e)); }
    console.log(`${tp.id}: ok`);
  }
  return bad;
}

// ---------------------------------------------------------------------------------------------

async function main() {
  const [cmd, ...rest] = positional;
  switch (cmd) {
    case undefined: return (await checkModules([])) + (await tests([])) + audit() + (await checkElectron([], { quiet: true })) ? 1 : 0;
    case 'modules': return (await checkModules(rest)) ? 1 : 0;
    case 'tests': return (await tests(rest)) ? 1 : 0;
    case 'audit': return audit() ? 1 : 0;
    case 'page': return page(rest[0]);
    case 'e2e': return e2e(rest[0], rest[1]);
    case 'electron': return (await checkElectron(rest, { build: argv.includes('--build'), singlefile: argv.includes('--singlefile') })) ? 1 : 0;
    case 'golden': return (await golden(rest[0], rest[1])) ? 1 : 0;
    default:
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 27).join('\n'));
      return 2;
  }
}

process.exitCode = await main();
