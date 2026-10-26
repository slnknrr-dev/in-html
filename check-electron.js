// check-electron.js - Node-only checks of ELECTRON artifacts (targets.js, electron.js, electron-preload.cjs, hosting.js
// webHandler), run by `node check.js electron [app ...] [--build] [--singlefile]` and by `node check.js` for the
// built electron artifacts. Electron itself is not needed: every artifact is copied into a temporary folder next to a
// stub `electron` module (node_modules/electron) and its main.mjs runs in a child Node process, which then
//   - checks the privileged scheme, the window's webPreferences (contextIsolation, sandbox, no Node integration, the
//     preload) and the start URL,
//   - requests pages through the protocol handler (status, the IN_HTML_ARTIFACT mode, the CSP with script hashes,
//     404s, HEAD, a foreign host), and the probes of <app>/electron.json (`probes: [{ path, method, headers, body,
//     status, type, json }]`, e.g. the backend's /api),
//   - calls the IPC handlers as the application origin and as a foreign one (refused), the open-external allowlist,
//     the tray, shortcuts and the mini window, the navigation guards and the permission handler,
//   - loads preload.cjs in a vm with a fake require('electron') and checks the exposed API and its IPC channels.
// It also unit-tests webHandler (Range streaming through pipe(), HEAD, backpressure with a slow reader, a cancelled
// body destroying the response, CSP hashes). Apps without an ELECTRON notice can be checked with --build: the
// electron target is built in memory (that is how the single-file variant is checked too).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { noticeTargets, buildTarget } from './targets.js';
import { webHandler } from './hosting.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// Why a stub instead of real Electron: the checks must run in CI and offline without a 100+ MB binary or a display.
// The stub records every call (windows, IPC handlers, schemes, permissions) so the runner can assert on the exact
// security configuration main.mjs applied. Child process, not import: main.mjs patches process.argv and registers
// app-level handlers; isolating it keeps this process clean and lets a crash be reported as a failed step.
// The STUB/RUNNER sources are String.raw templates: no comments may be added inside them.
// --- the stub of the electron module (CommonJS, loaded by main.mjs through node_modules/electron) ---------------------
const STUB = String.raw`'use strict';
const path = require('node:path');
const listeners = {};
const base = process.env.IN_HTML_STUB_DIR;
const stub = {
  calls: [], windows: [], ipc: {}, protocols: {}, schemes: [], shortcuts: new Set(), trays: [], perm: {}, menus: 0,
  emit(ev, ...a) { for (const f of listeners[ev] || []) f(...a); },
};
class WebContents {
  constructor(win) { this.win = win; this.ev = {}; this.sent = []; }
  send(ch, msg) { this.sent.push([ch, msg]); }
  isLoading() { return false; }
  on(ev, fn) { (this.ev[ev] ||= []).push(fn); return this; }
  openDevTools() {}
}
class BrowserWindow {
  constructor(opts) { this.opts = opts; this.webContents = new WebContents(this); this.ev = {}; this.destroyed = false; stub.windows.push(this); }
  loadURL(u) { this.url = u; return Promise.resolve(); }
  once(ev, fn) { if (ev === 'ready-to-show') setTimeout(fn, 0); else this.on(ev, fn); return this; }
  on(ev, fn) { (this.ev[ev] ||= []).push(fn); return this; }
  show() { this.shown = true; } focus() {} restore() {} isMinimized() { return false; }
  isDestroyed() { return this.destroyed; }
  close() { this.destroyed = true; for (const f of this.ev.closed || []) f(); }
  maximize() { this.max = true; } unmaximize() { this.max = false; } isMaximized() { return !!this.max; } minimize() {}
  setFullScreen(v) { this.fs = v; } isFullScreen() { return !!this.fs; } setAlwaysOnTop(v) { this.top = v; } setProgressBar(p) { this.progress = p; }
  getBounds() { return { x: 0, y: 0, width: 800, height: 600 }; } getNormalBounds() { return this.getBounds(); }
  static fromWebContents(wc) { return (wc && wc.win) || stub.windows[0] || null; }
}
stub.BrowserWindow = BrowserWindow;
stub.app = {
  isPackaged: false,
  requestSingleInstanceLock: () => true,
  quit() { stub.calls.push(['quit']); },
  whenReady: () => Promise.resolve(),
  isReady: () => true,
  on(ev, fn) { (listeners[ev] ||= []).push(fn); return stub.app; },
  getPath: (k) => path.join(base, 'paths', k),
  getVersion: () => '1.0.0', getLocale: () => 'en-US', setName() {},
};
stub.protocol = { registerSchemesAsPrivileged(list) { stub.schemes.push(...list); }, handle(scheme, fn) { stub.protocols[scheme] = fn; } };
stub.session = { defaultSession: { setPermissionRequestHandler(fn) { stub.perm.request = fn; }, setPermissionCheckHandler(fn) { stub.perm.check = fn; } } };
stub.ipcMain = { handle(ch, fn) { stub.ipc[ch] = fn; } };
stub.dialog = { showOpenDialog: async (w, o) => { stub.calls.push(['dialog', o.properties]); return { canceled: false, filePaths: [base] }; } };
stub.shell = { openExternal: async (u) => { stub.calls.push(['openExternal', u]); }, showItemInFolder: (p) => stub.calls.push(['reveal', p]) };
stub.globalShortcut = { register(acc) { stub.shortcuts.add(acc); return true; }, unregister(acc) { stub.shortcuts.delete(acc); }, unregisterAll() { stub.shortcuts.clear(); } };
stub.Tray = class { constructor(img) { this.img = img; stub.trays.push(this); } on() {} setImage(i) { this.img = i; } setToolTip(t) { this.tip = t; } setContextMenu(m) { this.menu = m; } destroy() { this.destroyed = true; } };
stub.Menu = { buildFromTemplate: (t) => ({ items: t }), setApplicationMenu() { stub.menus++; } };
stub.nativeImage = { createFromDataURL: (u) => ({ isEmpty: () => false, url: u }), createFromBuffer: (b) => ({ isEmpty: () => !b || !b.length, png: b }) };
stub.powerSaveBlocker = { start: () => 7, stop() {} };
globalThis.__electronStub = stub;
module.exports = stub;
`;

// --- the runner (ES module next to main.mjs): drives the stub and prints a JSON report ---------------------------------
const RUNNER = String.raw`import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(fs.readFileSync(path.join(here, 'check.json'), 'utf8'));
const steps = [];
const ok = (name, cond, v) => steps.push([name, cond ? 'ok' : 'FAIL', v === undefined ? null : v]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.argv.push('--data', path.join(process.env.IN_HTML_STUB_DIR, 'data'));
let failed = null;
try { await import('./main.mjs'); } catch (e) { failed = e; }
ok('main.mjs loads', !failed, failed && String(failed.stack || failed).slice(0, 600));
const S = globalThis.__electronStub;
if (S) {
  for (let i = 0; i < 100 && !S.windows.length; i++) await sleep(20);
  const origin = 'in-html://' + spec.host;
  const sch = S.schemes.find((x) => x.scheme === 'in-html');
  ok('privileged scheme', sch && sch.privileges.standard && sch.privileges.secure && sch.privileges.stream && sch.privileges.supportFetchAPI, sch);
  const win = S.windows[0];
  const wp = win && win.opts.webPreferences;
  ok('window webPreferences', wp && wp.contextIsolation === true && wp.sandbox === true && wp.nodeIntegration === false && wp.webviewTag === false && fs.existsSync(wp.preload), wp && { contextIsolation: wp.contextIsolation, sandbox: wp.sandbox, nodeIntegration: wp.nodeIntegration });
  ok('start URL', win && win.url === origin + '/' + (spec.page || 'index.html'), win && win.url);
  const handle = S.protocols['in-html'];
  ok('protocol handler', typeof handle === 'function');
  const get = async (p, init) => {
    const r = await handle(new Request(origin + '/' + p, init));
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, type: r.headers.get('content-type') || '', csp: r.headers.get('content-security-policy') || '', body: buf, headers: r.headers };
  };
  if (handle) {
    const page = await get(spec.page || 'index.html');
    const html = page.body.toString('utf8');
    ok('page served', page.status === 200 && /text\/html/.test(page.type), [page.status, page.type, page.body.length]);
    ok('artifact mode electron', /IN_HTML_ARTIFACT=\{"mode":"electron"/.test(html));
    ok('CSP with script hashes', /script-src 'self'( 'sha256-[A-Za-z0-9+\/=]+')+/.test(page.csp) && !/script-src[^;]*unsafe-inline/.test(page.csp), page.csp.slice(0, 160));
    const head = await get(spec.page || 'index.html', { method: 'HEAD' });
    ok('HEAD', head.status === 200 && head.body.length === 0, [head.status, head.body.length]);
    const nf = await get('no/such/file-' + Date.now() + '.txt');
    ok('unknown path 404', nf.status === 404, nf.status);
    const foreign = await handle(new Request('in-html://other-app/index.html'));
    ok('foreign host refused', foreign.status === 404, foreign.status);
    for (const p of spec.probes || []) {
      const init = { method: p.method || 'GET', headers: p.headers || {} };
      if (p.body !== undefined) { init.body = typeof p.body === 'string' ? p.body : JSON.stringify(p.body); init.duplex = 'half'; }
      const r = await get(p.path, init);
      let detail = [r.status, r.type, r.body.length];
      let good = r.status === (p.status || 200) && (!p.type || r.type.includes(p.type));
      if (good && p.json) {
        try { const j = JSON.parse(r.body.toString('utf8')); for (const [k, v] of Object.entries(p.json)) if (JSON.stringify(j[k]) !== JSON.stringify(v)) { good = false; detail = [k, j[k]]; } } catch (e) { good = false; detail = String(e); }
      }
      ok('probe ' + (p.method || 'GET') + ' ' + p.path, good, detail);
    }
  }
  const ev = (url) => ({ senderFrame: { url }, sender: win && win.webContents });
  const call = async (name, e, ...a) => { try { return { v: await S.ipc['in-html:' + name](e, ...a) }; } catch (err) { return { err: String(err.message || err) }; } };
  const mine = ev(origin + '/index.html');
  const info = await call('info', mine);
  ok('ipc info', info.v && info.v.name === spec.app && info.v.origin === origin, info.v ? { name: info.v.name, origin: info.v.origin } : info.err);
  const bad = await call('info', ev('https://evil.example/'));
  ok('ipc refuses foreign origins', !!bad.err, bad.err);
  const files = await call('openFiles', mine, { filters: [{ name: 'Audio', extensions: ['mp3', 'flac'] }] });
  ok('ipc openFiles', Array.isArray(files.v) && files.v.length === 1, files.v);
  const folder = await call('openFolder', mine, {});
  ok('ipc openFolder', Array.isArray(folder.v), folder.v);
  const ext1 = await call('openExternal', mine, 'https://example.org/x');
  const ext2 = await call('openExternal', mine, 'javascript:alert(1)');
  const ext3 = await call('openExternal', mine, 'file:///etc/passwd');
  ok('open-external allowlist', ext1.v === true && ext2.v === false && ext3.v === false, [ext1.v, ext2.v, ext3.v]);
  const tray = await call('tray', mine, { tooltip: 'Now playing', items: [{ id: 'play', label: 'Play' }, { type: 'separator' }] });
  ok('tray', tray.v === true && S.trays.length === 1 && S.trays[0].tip === 'Now playing' && S.trays[0].menu.items.length === 4, S.trays[0] && S.trays[0].menu && S.trays[0].menu.items.length);
  const sc = await call('shortcuts', mine, { media: true, global: { 'CommandOrControl+Alt+P': 'play-pause', 'bad key!': 'x' } });
  ok('shortcuts', sc.v && sc.v.registered.length === 5 && sc.v.failed.includes('bad key!'), sc.v);
  const mini = await call('mini', mine, 'open', {});
  const miniWin = S.windows[1];
  ok('mini window', mini.v === true && miniWin && /#mini$/.test(miniWin.url) && miniWin.opts.webPreferences.sandbox === true && miniWin.opts.alwaysOnTop === true, miniWin && miniWin.url);
  const awake = await call('keepAwake', mine, true);
  ok('keep awake', awake.v === true, awake.v);
  const fsw = await call('win', mine, 'setFullScreen', true);
  ok('window control', fsw.v === true && win.fs === true, fsw.v);
  // navigation guards and permissions
  const wc = { handlers: {}, setWindowOpenHandler(fn) { this.open = fn; }, on(e, fn) { this.handlers[e] = fn; } };
  S.emit('web-contents-created', {}, wc);
  const opened = wc.open && wc.open({ url: 'https://example.org/' });
  let prevented = false;
  wc.handlers['will-navigate'] && wc.handlers['will-navigate']({ preventDefault: () => { prevented = true; } }, 'https://evil.example/');
  let stayed = true;
  wc.handlers['will-navigate'] && wc.handlers['will-navigate']({ preventDefault: () => { stayed = false; } }, origin + '/other.html');
  ok('navigation guards', opened && opened.action === 'deny' && prevented && stayed, { opened, prevented, stayed });
  const perm = (p, u) => new Promise((r) => S.perm.request(null, p, r, { requestingUrl: u }));
  const p1 = await perm('fullscreen', origin + '/'), p2 = await perm('geolocation', origin + '/'), p3 = await perm('fullscreen', 'https://evil.example/');
  ok('permissions', p1 === true && p2 === false && p3 === false, [p1, p2, p3]);
  S.emit('will-quit');
  // preload in a vm with a fake electron
  const exposed = {};
  const invoked = [];
  const fake = {
    contextBridge: { exposeInMainWorld: (k, v) => { exposed[k] = v; } },
    ipcRenderer: { invoke: async (ch, ...a) => { invoked.push([ch, ...a]); return null; }, on: (ch, fn) => { exposed.__on = [ch, fn]; } },
    webUtils: { getPathForFile: (f) => '/real/' + f.name },
  };
  const ctx = vm.createContext({ require: (m) => { if (m !== 'electron') throw new Error('no ' + m); return fake; }, console });
  vm.runInContext(fs.readFileSync(path.join(here, 'preload.cjs'), 'utf8'), ctx, { filename: 'preload.cjs' });
  const api = exposed.inHtmlElectron;
  const keys = api ? Object.keys(api).sort() : [];
  ok('preload exposes inHtmlElectron', keys.join() === 'info,keepAwake,mini,onCommand,openExternal,openFiles,openFolder,pathForFile,shortcuts,showItemInFolder,takeOpenRequests,tray,version,window', keys);
  if (api) {
    await api.openFolder({ title: 'x', extra: 'dropped' });
    await api.window.setFullScreen(1);
    ok('preload channels', invoked[0][0] === 'in-html:openFolder' && invoked[0][1].extra === undefined && invoked[1][0] === 'in-html:win' && invoked[1][2] === true, invoked);
    ok('preload pathForFile', api.pathForFile({ name: 'a.mp3' }) === '/real/a.mp3');
    let got = null;
    const off = api.onCommand((c) => { got = c; });
    exposed.__on[1]({}, { type: 'media', action: 'next' });
    off();
    exposed.__on[1]({}, { type: 'media', action: 'stop' });
    ok('preload commands', got && got.action === 'next', got);
  }
}
process.stdout.write('\n@@REPORT@@' + JSON.stringify(steps) + '\n');
process.exit(0);
`;

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

// Runs one artifact folder (copied into tmp) under the stub: [[name, 'ok' | 'FAIL', value]].
function runArtifact(dir, { app, page, probes }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-check-'));
  try {
    const art = path.join(tmp, 'app');
    copyDir(dir, art);
    fs.mkdirSync(path.join(art, 'node_modules', 'electron'), { recursive: true });
    fs.writeFileSync(path.join(art, 'node_modules', 'electron', 'index.js'), STUB);
    fs.writeFileSync(path.join(art, 'node_modules', 'electron', 'package.json'), '{"name":"electron","main":"index.js"}');
    fs.writeFileSync(path.join(art, 'run-check.mjs'), RUNNER);
    fs.writeFileSync(path.join(art, 'check.json'), JSON.stringify({ app, host: app.toLowerCase(), page, probes }));
    const r = spawnSync(process.execPath, [path.join(art, 'run-check.mjs')], { cwd: art, encoding: 'utf8', timeout: 120000, env: { ...process.env, IN_HTML_STUB_DIR: tmp } });
    const m = /@@REPORT@@(.*)/.exec(r.stdout || '');
    if (!m) return [['runner', 'FAIL', ((r.stderr || '') + (r.stdout || '')).slice(-1500)]];
    return JSON.parse(m[1]);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* locked on Windows */ }
  }
}

function writeFiles(files, dir) {
  for (const [rel, d] of files) {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, d);
  }
}

// Unit tests of hosting.js webHandler (the Fetch adapter of protocol.handle).
async function adapterTests() {
  const steps = [];
  const ok = (name, cond, v) => steps.push([name, cond ? 'ok' : 'FAIL', v === undefined ? null : v]);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-adapter-'));
  try {
    const file = path.join(tmp, 'data.bin');
    const data = Buffer.alloc(3 * 1024 * 1024);
    for (let i = 0; i < data.length; i++) data[i] = (i * 31 + 7) & 255;
    fs.writeFileSync(file, data);
    let closed = 0;
    const handler = (req, res) => {
      if (req.url.startsWith('/page')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><script>var a=1</script><script src="x.js"></script><p>x</p>');
        return;
      }
      if (req.url.startsWith('/echo')) {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(Buffer.concat(chunks)); });
        return;
      }
      const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
      const start = m ? +m[1] : 0, end = m && m[2] ? +m[2] : data.length - 1;
      res.writeHead(m ? 206 : 200, { 'Content-Type': 'application/octet-stream', 'Content-Length': end - start + 1, ...(m ? { 'Content-Range': `bytes ${start}-${end}/${data.length}` } : {}), 'Accept-Ranges': 'bytes' });
      if (req.method === 'HEAD') { res.end(); return; }
      const s = fs.createReadStream(file, { start, end, highWaterMark: 16384 });
      res.on('close', () => { closed++; s.destroy(); });
      s.pipe(res);
    };
    const h = webHandler(handler, { csp: "script-src 'self' {script-hashes}" });
    let r = await h(new Request('in-html://t/all'));
    let b = Buffer.from(await r.arrayBuffer());
    ok('adapter: whole body through pipe()', r.status === 200 && b.equals(data), [r.status, b.length]);
    r = await h(new Request('in-html://t/r', { headers: { Range: 'bytes=1000-1999' } }));
    b = Buffer.from(await r.arrayBuffer());
    ok('adapter: Range 206', r.status === 206 && r.headers.get('content-range') === `bytes 1000-1999/${data.length}` && b.equals(data.subarray(1000, 2000)), [r.status, b.length]);
    r = await h(new Request('in-html://t/h', { method: 'HEAD' }));
    ok('adapter: HEAD has no body', r.status === 200 && r.body === null && r.headers.get('content-length') === String(data.length));
    // Backpressure: a slow reader receives everything, in order.
    r = await h(new Request('in-html://t/slow'));
    const reader = r.body.getReader();
    const parts = [];
    for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(Buffer.from(value)); if (parts.length % 20 === 0) await new Promise((q) => setTimeout(q, 5)); }
    ok('adapter: slow reader', Buffer.concat(parts).equals(data), parts.length);
    // A cancelled body (a seeking media element) closes the response and the file stream.
    const before = closed;
    r = await h(new Request('in-html://t/cancel'));
    const rd = r.body.getReader();
    await rd.read();
    await rd.cancel();
    await new Promise((q) => setTimeout(q, 50));
    ok('adapter: cancel destroys the response', closed > before, closed - before);
    r = await h(new Request('in-html://t/page'));
    const csp = r.headers.get('content-security-policy');
    const text = await r.text();
    ok('adapter: CSP hashes of inline scripts', /^script-src 'self' 'sha256-[^']+'$/.test(csp) && text.includes('var a=1'), csp);
    r = await h(new Request('in-html://t/echo', { method: 'POST', body: 'hello body', duplex: 'half' }));
    ok('adapter: request body', (await r.text()) === 'hello body');
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* locked */ }
  }
  return steps;
}

// apps: names (empty = every app with an ELECTRON notice); build: build in memory instead of using html@5_electron*;
// singlefile: check the single-file variant (built in memory unless its notice exists and it is built).
export async function checkElectron(apps = [], { build = false, singlefile = false, quiet = false } = {}) {
  const { listApps } = await import('./singlefile.js');
  let bad = 0;
  const print = (label, steps) => {
    for (const [name, st, v] of steps) {
      if (st !== 'ok') bad++;
      if (!quiet || st !== 'ok') console.log(`${st === 'ok' ? 'ok  ' : 'FAIL'} ${label}: ${name}${st === 'ok' ? '' : ' ' + JSON.stringify(v).slice(0, 600)}`);
    }
  };
  print('webHandler', await adapterTests());
  const all = apps.length ? apps : listApps(ROOT).filter((a) => noticeTargets(path.join(ROOT, a)).some((t) => t.mode === 'electron'));
  for (const app of all) {
    const variants = singlefile ? [true] : [false];
    for (const sf of variants) {
      const dirName = sf ? 'html@5_electron_singlefile' : 'html@5_electron';
      const declared = noticeTargets(path.join(ROOT, app)).some((t) => t.dir === dirName);
      let dir = path.join(ROOT, app, dirName);
      let tmp = null;
      let cfg = {};
      try { cfg = JSON.parse(fs.readFileSync(path.join(ROOT, app, 'electron.json'), 'utf8')); } catch { cfg = {}; }
      if (build || !declared || !fs.existsSync(dir)) {
        if (declared && !build && !fs.existsSync(dir)) { console.log(`x ${app}/${dirName}/ missing (run node singlefile.js ${app})`); bad++; continue; }
        const t0 = Date.now();
        const r = buildTarget({ root: ROOT, app, target: { mode: 'electron', singlefile: sf, dir: dirName, notice: '(check)' } });
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-build-'));
        writeFiles(r.files, tmp);
        dir = tmp;
        if (!quiet) console.log(`  built ${app}/${dirName}/ in memory (${r.files.size} files, ${Date.now() - t0} ms)`);
      }
      try {
        print(`${app}/${dirName}`, runArtifact(dir, { app, page: cfg.page || 'index.html', probes: Array.isArray(cfg.probes) ? cfg.probes : [] }));
      } finally {
        if (tmp) try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* locked */ }
      }
    }
  }
  console.log(`electron: ${bad ? bad + ' failing' : 'all checks passed'}`);
  return bad;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  checkElectron(argv.filter((a) => !a.startsWith('--')), { build: argv.includes('--build'), singlefile: argv.includes('--singlefile') })
    .then((b) => { process.exitCode = b ? 1 : 0; });
}
