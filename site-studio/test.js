// site-studio/test.js - unit tests of Site Studio: `node site-studio/test.js` (also `node check.js tests site-studio`).
// The blocks on the repository's libraries (every one renders in view and edit mode, booking seasons, form-like
// blocks in cfg.forms), every template of the catalogue (groups, modes, modules; every block rendered), closed
// sections (never in public files, private files for backend packages), SEO files, the site map views, the README of
// the packages, the Markdown importer, and a backend package run for real: accounts by password and by e-mail link,
// pages by role, the admin API, content editing that keeps the closed sections, the constructor's project API.
// Then the tests of the knowledge base editor (wiki-test.js).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as V from './viewer.js';
import { TEMPLATES, TEMPLATE_GROUPS } from './templates.js';
import { BT_E, seasonList } from './viewer-blocks-e.js';
import { buildSite } from './backend-site.js';
import { archiveFiles } from './backend-archive.js';
import { closedPages, pageAllowed, publicView } from './viewer-access.js';
import { seoFiles } from './seo-site.js';
import { MAP_VIEWS, siteMapSource } from './site-map.js';
import { markdownSite, siteReadme } from './site-readme.js';
import { renderDiagram } from '../diagram/all.js';
import { run as runWiki } from './wiki-test.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
// Runnable alone and importable by check.js (which calls run()); isMain compares resolved paths so both invocation
// styles work on Windows and POSIX.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// `ok` counts and reports but never throws: the whole suite runs and prints every failure, the return value is the
// failure count (exit code 1 when non-zero).
export async function run() {
  V.activateProduct(); // other document products may have been loaded into this process (node check.js)
  let n = 0;
  let fail = 0;
  const ok = (name, cond, info) => { n++; if (!cond) { fail++; console.log('FAIL ' + name + (info !== undefined ? ' ' + JSON.stringify(info).slice(0, 300) : '')); } };

  // Every block of viewer-blocks-e renders in both modes; 'map' and 'estate' may render nothing in view mode without
  // data, so only their edit rendering is required.
  /* ---------- blocks ---------- */
  {
    const d = V.newDoc();
    d.regions.main[0].blocks = Object.keys(BT_E).map((t) => V.newBlock(t, t === 'event' ? { date: '2027-05-01', title: { en: 'Day' } } : {}));
    const doc = V.normalizeDoc(d);
    for (const b of doc.regions.main[0].blocks) {
      const view = V.renderBlock(b, doc, { mode: 'view' });
      const edit = V.renderBlock(b, doc, { mode: 'edit' });
      ok('block renders in edit mode: ' + b.type, edit.includes('lp-b-' + b.type));
      if (!['map', 'estate'].includes(b.type)) ok('block renders in view mode: ' + b.type, view.includes('lp-b-' + b.type), view.slice(0, 120));
    }
    const r = await V.exportHTML(doc, { mode: 'clean' });
    ok('form-like blocks get a cfg.forms entry', ['booking', 'event', 'contract'].every((t) => r.html.includes(doc.regions.main[0].blocks.find((b) => b.type === t).id)));
    ok('account block without a server shows a note', !r.report.features.includes('account'));
    const rb = await V.exportHTML(doc, { mode: 'clean', api: { mode: 'server' } });
    ok('account block on a backend uses the network feature', rb.report.features.includes('account') && rb.report.features.includes('net'));
    ok('booking seasons parse', JSON.stringify(seasonList('2026-06-01..2026-08-31 | 150 | 180 | Summer\nbad line')) === JSON.stringify([{ from: '2026-06-01', to: '2026-08-31', price: 150, weekend: 180, label: 'Summer' }]));
  }

  // The 451 section is tested as cryptography, not markup: the envelope is decrypted here with Web Crypto using the
  // format parameters it declares (PBKDF2-SHA-256 -> AES-256-GCM), proving the page does not merely hide the text, and a
  // wrong password must fail GCM authentication. Then every export path (page, llms-full.txt, static package) is
  // checked not to carry the plaintext.
  /* ---------- knowledge base blocks ---------- */
  {
    const d = V.newDoc();
    d.wiki = { layers: [{ id: 'tr', label: 'Translation', on: false }], alias: { 'old-name': '' } };
    const about = V.newBlock('page', { slug: 'about', title: { en: 'About us' } });
    d.regions.main.push(about);
    d.regions.main[0].blocks = [
      V.newBlock('wk-layers'),
      V.newBlock('wk-infobox', { title: 'Mars', items: [{ label: 'Moons', value: '2' }, { label: 'Name', value: '{{layer|tr|Марс}}' }] }),
      V.newBlock('wk-toc'),
      V.newBlock('wk-text', { text: "Mars{{ref|NASA.}} and [[About us]], [[about#team|the team]], [[Nowhere]].\n\n## Orbit\n''Text''{{ref|Second.}}." }),
      V.newBlock('wk-references'),
      V.newBlock('wk-versions', { labels: 'Full\nSimple', versions: [{ id: 'a', blocks: [V.newBlock('wk-text', { text: 'FULLVERSION' })] }, { id: 'b', blocks: [V.newBlock('wk-text', { text: 'SIMPLEVERSION' })] }] }),
      V.newBlock('wk-secret', { label: 'Notes', password: 'open sesame', blocks: [V.newBlock('wk-text', { text: 'TOPSECRET words' })] }),
      V.newBlock('wk-table', { rows: [['A', 'B'], ['1', '2']], sortable: true }),
    ];
    const doc = V.normalizeDoc(d);
    const types = doc.regions.main[0].blocks.map((b) => b.type).join();
    ok('wiki blocks normalize into the site format', types === 'wk-layers,wk-infobox,wk-toc,wk-text,wk-references,wk-versions,wk-secret,wk-table', types);
    ok('wiki list fields are the block items', doc.regions.main[0].blocks[1].items.length === 2 && !!doc.regions.main[0].blocks[1].items[0].id);
    ok('doc.wiki keeps layers', doc.wiki.layers.length === 1 && doc.wiki.layers[0].on === false);
    const r = await V.exportHTML(doc, { mode: 'clean' });
    const h = r.html;
    ok('wiki: infobox, references, version buttons', /kp-infobox/.test(h) && /id="cite-note-1"/.test(h) && /id="cite-note-2"/.test(h) && /data-wk-v="1"/.test(h) && /FULLVERSION/.test(h) && /SIMPLEVERSION/.test(h));
    ok('wiki: links to pages by title, address and section; missing ones marked', /href="#\/about"/.test(h) && /href="#\/about#team"/.test(h) && /kp-link kp-new[^>]*>Nowhere/.test(h));
    ok('wiki: inline layers and layer toggles', /data-layer="tr"/.test(h) && /data-wk-layers=/.test(h) && r.report.features.includes('wiki'));
    ok('wiki: the reader styles come with the blocks', /\.kp-infobox\{/.test(h) && /--kp-accent:var\(--lp-accent\)/.test(h));
    ok('451: the content is not in the page, the envelope is', !h.includes('TOPSECRET') && /data-wk-seal=/.test(h));
    const env = JSON.parse(/data-wk-seal="([^"]+)"/.exec(h)[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    const k = await crypto.webcrypto.subtle.importKey('raw', new TextEncoder().encode('open sesame'), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.webcrypto.subtle.deriveKey({ name: 'PBKDF2', salt: Buffer.from(env.s, 'base64'), iterations: env.i, hash: 'SHA-256' }, k, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const plain = new TextDecoder().decode(await crypto.webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(env.iv, 'base64') }, key, Buffer.from(env.ct, 'base64')));
    ok('451: Web Crypto opens the envelope with the password', plain.includes('TOPSECRET'));
    let wrong = false;
    try {
      const k2 = await crypto.webcrypto.subtle.importKey('raw', new TextEncoder().encode('wrong'), 'PBKDF2', false, ['deriveKey']);
      const key2 = await crypto.webcrypto.subtle.deriveKey({ name: 'PBKDF2', salt: Buffer.from(env.s, 'base64'), iterations: env.i, hash: 'SHA-256' }, k2, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      await crypto.webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(env.iv, 'base64') }, key2, Buffer.from(env.ct, 'base64'));
    } catch { wrong = true; }
    ok('451: a wrong password opens nothing', wrong);
    ok('451: llms-full.txt never carries the section', !seoFiles({ ...doc, meta: { ...doc.meta, siteUrl: 'https://kb.example' } }).some((f) => f.data.includes('TOPSECRET')));
    const st = await buildSite(doc, { target: 'static' });
    ok('451: no package file carries the content', st.files.every((f) => typeof f.data !== 'string' || !f.data.includes('TOPSECRET')));
    const edit = V.renderBlock(doc.regions.main[0].blocks[6], doc, { mode: 'edit' });
    ok('451: the editor shows the section in clear', edit.includes('TOPSECRET'));
  }
  for (const id of ['kb-wiki', 'kb-japanese', 'kb-portal']) {
    const doc = V.normalizeDoc(TEMPLATES.find((t) => t.id === id).build(V));
    const r = await V.exportHTML(doc, { mode: 'clean' });
    const red = [...r.html.matchAll(/class="kp-link kp-new"[^>]*>([^<]*)/g)].map((m) => m[1]);
    ok('knowledge base template: every wiki link leads to a page: ' + id, red.length === 0, red.slice(0, 5));
    ok('knowledge base template: no rendering errors: ' + id, !/class="kp-missing"/.test(r.html));
  }

  // "Renders every block": each visible, non-sealed block must leave its id (b-<id>) or its anchor in the HTML. This
  // catches renderers that silently return '' for template data they do not understand.
  /* ---------- templates ---------- */
  ok('three template groups', TEMPLATE_GROUPS.map((g) => g.id).join() === 'kb,landing,backend');
  for (const g of TEMPLATE_GROUPS) ok('group has templates: ' + g.id, TEMPLATES.filter((t) => t.group === g.id).length >= 5);
  for (const tpl of TEMPLATES) {
    ok('template metadata: ' + tpl.id, ['kb', 'landing', 'backend'].includes(tpl.group) && ['offline', 'serverless', 'backend'].includes(tpl.mode) && Array.isArray(tpl.modules && tpl.modules.req) && tpl.name && tpl.name.en && tpl.name.ru);
    if (tpl.href) { ok('wiki template link: ' + tpl.id, /^\.\/wiki\.html#template=[a-z]+$/.test(tpl.href)); continue; }
    const doc = V.normalizeDoc(tpl.build(V, ...(tpl.userLang ? ['en', {}] : [])));
    const r = await V.exportHTML(doc, { mode: 'clean' });
    let lost = 0;
    // Blocks of 451 sections exist only encrypted.
    const sealed = new Set();
    V.walkBlocks(doc, (b) => { if (b.type === 'wk-secret') V.walkBlocks({ regions: { main: b.blocks } }, (x) => sealed.add(x.id)); });
    V.walkBlocks(doc, (b) => { if (b.type !== 'page' && !b.hidden && !sealed.has(b.id) && !r.html.includes('b-' + b.id) && !(b.anchor && r.html.includes('id="' + b.anchor + '"'))) lost++; });
    // (The blank template's empty section and text render nothing on purpose.)
    if (tpl.id !== 'blank') ok('template renders every block: ' + tpl.id, lost === 0, lost);
    if (tpl.mode === 'backend') ok('backend template has closed sections: ' + tpl.id, closedPages(doc).length > 0);
  }

  // The secret sentence is content of a closed page of the 'region' template; grepping every produced file for it is
  // the leak test (cheap, total, independent of how the files are structured).
  /* ---------- closed sections, SEO, map, README ---------- */
  const region = V.normalizeDoc(TEMPLATES.find((t) => t.id === 'region').build(V));
  region.meta.siteUrl = 'https://imereti.example';
  const secret = 'Moderators check requests every morning';
  {
    const st = await buildSite(region, { target: 'static' });
    ok('static package: no closed content anywhere', st.files.every((f) => typeof f.data !== 'string' || !f.data.includes(secret)));
    ok('static package: no private files', !st.files.some((f) => f.private));
    const be = await buildSite(region, { target: 'backend' });
    ok('backend package: closed pages as private files', be.files.filter((f) => f.private).map((f) => f.path).sort().join() === 'private/account/index.html,private/editors/index.html,private/volunteers/index.html');
    ok('backend package: public files without the closed content', be.files.filter((f) => !f.private).every((f) => typeof f.data !== 'string' || !f.data.includes(secret)));
    ok('backend package keeps the whole document for its server', closedPages(be.doc).length === 3 && JSON.stringify(be.doc).includes(secret));
    const sm = be.files.find((f) => f.path === 'sitemap.xml');
    ok('sitemap without closed pages', sm && sm.data.includes('https://imereti.example/news/') && !sm.data.includes('/editors/'));
    ok('robots.txt keeps crawlers out of the server parts', /Disallow: \/admin\//.test(be.files.find((f) => f.path === 'robots.txt').data));
    ok('no SEO files without the address', seoFiles({ ...region, meta: { ...region.meta, siteUrl: '' } }).length === 0);
    ok('AI crawlers can be refused', /GPTBot/.test(seoFiles(region, { noAI: true }).find((f) => f.path === 'robots.txt').data));
    const pv = publicView(region, { signin: true });
    ok('public view: closed pages keep their address', closedPages(pv).every((p) => p.slug) && !JSON.stringify(pv).includes(secret));
    const editors = closedPages(region).find((p) => p.slug === 'editors');
    ok('roles: an editor opens the editors\' room', pageAllowed(region, editors, { role: 'editor' }) && pageAllowed(region, editors, { role: 'moderator' }));
    ok('roles: a member does not, a visitor does not', !pageAllowed(region, editors, { role: 'member' }) && !pageAllowed(region, editors, null));
    ok('roles: admin opens everything, blocked nothing', pageAllowed(region, editors, { role: 'admin' }) && !pageAllowed(region, editors, { role: 'admin', blocked: true }));
    for (const v of MAP_VIEWS) { const r = renderDiagram(siteMapSource(region, v, { target: 'backend' })); ok('site map view draws: ' + v, !r.error, r.error); }
    const rd = siteReadme(region, 'backend');
    ok('README: pages, site map, run instructions', /## Pages/.test(rd) && /```mermaid/.test(rd) && /node server\.mjs/.test(rd) && /img\.shields\.io/.test(rd));
    ok('README: own text wins', siteReadme({ ...region, meta: { ...region.meta, readme: '# Mine' } }) === '# Mine\n');
    const md = V.normalizeDoc(markdownSite(V, [{ name: 'README.md', text: '# Tool\n\nSee [guide](guide.md).' }, { name: 'guide.md', text: '# Guide\n\nSteps.' }]));
    ok('Markdown files become pages with page links', md.regions.main.filter((p) => p.kind === 'page').map((p) => p.slug).join() === ',guide' && JSON.stringify(md).includes('](#/guide)'));
  }

  // Black-box integration: build the archive, unpack it to a temp dir, import its lib/site.mjs and talk HTTP to it.
  // `origin: base` makes the requests same-origin (the server refuses cross-site writes); redirect: 'manual' lets the
  // test assert the 302 of the e-mail link. The finally block always stops the server and removes the temp dir.
  /* ---------- a backend package for real ---------- */
  {
    const { assetBundle } = await import(pathToFileURL(path.join(ROOT, 'bundle.js')).href);
    const engine = zlib.gunzipSync(Buffer.from(assetBundle(path.join(HERE, 'backend-engine.js'), ROOT).bytes)).toString('utf8');
    const files = await archiveFiles(region, { target: 'backend', engine, studio: '<!doctype html><html><head><title>studio</title></head><body class="ed-shell">editor</body></html>' });
    ok('archive: closed pages under data/private', files.some((f) => f.name === 'data/private/editors/index.html') && !files.some((f) => f.name.startsWith('public/') && typeof f.data === 'string' && f.data.includes(secret)));
    ok('archive: constructor page and README', files.some((f) => f.name === 'studio/index.html') && /\/_studio\//.test(files.find((f) => f.name === 'README.md').data));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-test-'));
    for (const f of files) { const p = path.join(dir, ...f.name.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f.data); }
    const site = (await import(pathToFileURL(path.join(dir, 'lib', 'site.mjs')).href)).default;
    const srv = await site.startServer({ http, fs, path, crypto, zlib, net, tls, Buffer, root: dir, argv: ['--port', '0'], env: {}, log: () => {}, signals: false });
    const base = `http://127.0.0.1:${srv.port}`;
    const req = async (m, p, body, cookie = '') => {
      const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', cookie, origin: base }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
      const sc = r.headers.get('set-cookie');
      return { status: r.status, text: await r.text(), cookie: sc ? sc.split(';')[0] : '', loc: r.headers.get('location') };
    };
    try {
      let r = await req('GET', '/editors/');
      ok('server: a visitor gets the sign-in page of a closed address', r.status === 200 && !r.text.includes(secret) && r.text.includes('data-ss-acc'));
      r = await req('POST', '/api/_auth/register', { email: 'Owner@Example.org', password: 'correct horse battery' });
      const admin = r.cookie;
      ok('server: the first account is the administrator', r.status === 201 && JSON.parse(r.text).user.role === 'admin');
      ok('server: weak passwords are refused', (await req('POST', '/api/_auth/register', { email: 'x@example.org', password: 'short' })).status === 400);
      r = await req('POST', '/api/_auth/register', { email: 'ed@example.org', password: 'long enough one' });
      const ed = r.cookie;
      ok('server: a member cannot open the editors\' room', !(await req('GET', '/editors/', null, ed)).text.includes(secret));
      const users = JSON.parse((await req('GET', '/api/_admin/users', null, admin)).text).users;
      await req('PATCH', '/api/_admin/users/' + users.find((u) => u.email === 'ed@example.org').id, { role: 'editor' }, admin);
      ok('server: the editor role opens it', (await req('GET', '/editors/', null, ed)).text.includes(secret));
      ok('server: a member page for members', (await req('GET', '/volunteers/', null, ed)).status === 200);
      await req('POST', '/api/_auth/link', { email: 'new@example.org', back: '/news/' });
      const mail = JSON.parse((await req('GET', '/api/_admin/outbox', null, admin)).text).outbox[0];
      const link = /\/_auth\/link\?t=[A-Za-z0-9_-]+/.exec(mail.text)[0];
      r = await req('GET', link);
      ok('server: an e-mail link signs in once and returns to its page', r.status === 302 && r.loc === '/news/' && !!r.cookie && (await req('GET', link)).status === 400);
      ok('server: the link created a member', JSON.parse((await req('GET', '/api/_auth/me', null, r.cookie)).text).user.role === 'member');
      ok('server: no console for members', (await req('GET', '/api/_admin/info', null, ed)).status === 401);
      const c = JSON.parse((await req('GET', '/api/_admin/content/news', null, admin)).text);
      r = await req('PUT', '/api/_admin/content/news', { items: c.items.slice(0, 2) }, admin);
      ok('server: content edited by the console', r.status === 200 && JSON.parse((await req('GET', '/data/news.json')).text).items.length === 2);
      ok('server: closed sections survive a rebuild', (await req('GET', '/editors/', null, ed)).text.includes(secret));
      const doc = JSON.parse((await req('GET', '/api/_admin/site.json', null, admin)).text);
      doc.meta.title = { en: 'Edited by the constructor', ru: 'Правка конструктора' };
      r = await req('PUT', '/api/_admin/site.json', { doc }, admin);
      ok('server: the constructor publishes a project', r.status === 200 && /Edited by the constructor/.test((await req('GET', '/')).text));
      ok('server: the constructor page has its host script', /SS_REMOTE/.test((await req('GET', '/_studio/')).text));
      ok('server: visitors cannot save a project', (await req('PUT', '/api/_admin/site.json', { doc })).status === 401);
      ok('server: cross-site writes are refused', (await fetch(base + '/api/_auth/register', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' })).status === 403);
    } finally {
      await srv.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log(`site-studio: ${n - fail}/${n} passed`);
  return fail + (await runWiki());
}

if (isMain) run().then((f) => process.exit(f ? 1 : 0));
