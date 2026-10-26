// site-studio/e2e-modes.mjs - end-to-end runs of the packages Site Studio exports (Node orchestrates, check.js drives the
// browser):
//   node site-studio/e2e-modes.mjs [spa|backend|shop|studio ...] [--size 375x812 --mobile] [--shot dir]
//   spa      serverless single-page site: index.html + 404.html only, served like Codeberg Pages (unknown paths answer
//            404.html with status 404); pages open at their clean addresses, navigation and history (e2e-spa.js)
//   backend  backend site with accounts: sign-up, closed pages by role, sign-in by an e-mail link, the admin console,
//            sign-out (e2e-backend.js)
//   shop     backend shop: cart, checkout stored on the server, the order in the admin console (e2e-shop.js)
//   studio   backend + constructor: the site editor at /_studio/ loads the live project and publishes a change
//            (e2e-studio.js; needs the built site-studio/html@5_offline_singlefile/index.html)
// The packages are built in memory with the same code as the export dialog (backend-site.js, backend-archive.js).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : null; };
// Positional arguments are the case names; the value after an option (--size 375x812, --shot dir) is skipped, except
// after the valueless --mobile.
const cases = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && argv[i - 1] !== '--mobile'));
const want = cases.length ? cases : ['spa', 'backend', 'shop', 'studio'];
const extra = [];
if (opt('size')) extra.push('--size', opt('size'));
if (argv.includes('--mobile')) extra.push('--mobile');

const V = await import(pathToFileURL(path.join(HERE, 'viewer.js')).href);
const { archiveFiles } = await import(pathToFileURL(path.join(HERE, 'backend-archive.js')).href);
const { buildSite } = await import(pathToFileURL(path.join(HERE, 'backend-site.js')).href);
const { TEMPLATES } = await import(pathToFileURL(path.join(HERE, 'templates.js')).href);
const { assetBundle } = await import(pathToFileURL(path.join(ROOT, 'bundle.js')).href);
// The same gzip bundle the editor fetches from backend-engine.js?bundle, produced by bundle.js directly: the test
// exercises the real shipping artefact, not the unbundled sources.
const engine = () => zlib.gunzipSync(Buffer.from(assetBundle(path.join(HERE, 'backend-engine.js'), ROOT).bytes)).toString('utf8');
const tpl = (id) => V.normalizeDoc(TEMPLATES.find((x) => x.id === id).build(V));

const MIME = { html: 'text/html; charset=utf-8', css: 'text/css', js: 'text/javascript', json: 'application/json', svg: 'image/svg+xml', xml: 'application/xml', txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8' };
function writeTree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-e2e-'));
  for (const f of files) { const p = path.join(dir, ...(f.name || f.path).split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f.data); }
  return dir;
}
// A static host like Codeberg Pages: files as they are, folders by index.html, anything else 404.html with status 404.
// Test-only server: decodeURIComponent may throw on malformed input and paths are not hardened; it only ever serves
// the browser driven by this script on 127.0.0.1.
function staticHost(dir) {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let f = path.join(dir, ...u.split('/').filter(Boolean));
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    let status = 200;
    if (!f.startsWith(dir) || !fs.existsSync(f)) { f = path.join(dir, '404.html'); status = 404; }
    res.writeHead(status, { 'Content-Type': MIME[(/\.([a-z]+)$/.exec(f) || [])[1]] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(f));
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}
// Imports lib/site.mjs from the unpacked archive, i.e. what a user would run; port 0 picks a free port, signals: false
// keeps the server from installing SIGINT handlers in the test process.
async function backendHost(dir) {
  const site = (await import(pathToFileURL(path.join(dir, 'lib', 'site.mjs')).href)).default;
  return site.startServer({ http, fs, path, crypto, zlib, net, tls, Buffer, root: dir, argv: ['--port', '0'], env: {}, log: () => {}, signals: false });
}
// Asynchronous: the servers of the run live in this process and must keep answering the browser.
// check.js runs in a child process because the servers live in this process: a synchronous child would block the
// event loop and the servers could not answer the browser. Pass = exit code 0 and no line starting with FAIL. A
// 400 s kill timer keeps a hung browser from stalling CI forever.
function runScenario(url, file, shot) {
  const args = [path.join(ROOT, 'check.js'), 'e2e', url, path.join(HERE, file), ...extra];
  if (shot) args.push('--shot', shot);
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (c) => { out += c; process.stdout.write(c); });
    p.stderr.on('data', (c) => { out += c; process.stdout.write(c); });
    const tm = setTimeout(() => p.kill(), 400000);
    p.on('close', (code) => { clearTimeout(tm); resolve(!/^FAIL/m.test(out) && code === 0); });
  });
}

let ok = true;
const shots = opt('shot');
const shotOf = (name) => (shots ? path.join(shots, name + (argv.includes('--mobile') ? '-375' : '') + '.png') : null);
for (const c of want) {
  console.log(`\n== ${c}`);
  // virtual: true builds only index.html + 404.html, so /programme/ exists as no file and must be resolved by the
  // 404.html router, as on Codeberg Pages.
  if (c === 'spa') {
    const site = await buildSite(tpl('event'), { target: 'static', virtual: true });
    const dir = writeTree(site.files);
    const srv = await staticHost(dir);
    ok = (await runScenario(`http://127.0.0.1:${srv.address().port}/programme/`, 'e2e-spa.js', shotOf('spa'))) && ok;
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  } else if (c === 'backend' || c === 'shop' || c === 'studio') {
    const id = c === 'shop' ? 'store' : 'members';
    let studio = null;
    if (c === 'studio') {
      const f = path.join(HERE, 'html@5_offline_singlefile', 'index.html');
      if (!fs.existsSync(f)) { console.log('FAIL build first: node singlefile.js site-studio'); ok = false; continue; }
      studio = fs.readFileSync(f, 'utf8');
    }
    const files = await archiveFiles(tpl(id), { target: 'backend', engine: engine(), studio });
    const dir = writeTree(files);
    const srv = await backendHost(dir);
    const start = c === 'shop' ? '/catalog/' : '/';
    ok = (await runScenario(`http://127.0.0.1:${srv.port}${start}`, `e2e-${c}.js`, shotOf(c))) && ok;
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  } else console.log('unknown case ' + c);
}
console.log(ok ? '\nall packages passed' : '\nSOME PACKAGES FAILED');
process.exit(ok ? 0 : 1);
