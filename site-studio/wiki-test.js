// site-studio/wiki-test.js - tests of the knowledge base editor (wiki.html), run by test.js (`node site-studio/test.js`, also
// `node check.js tests site-studio`). Markup safety, model normalization, 451 envelopes (right / wrong
// password, tampering, no plaintext in any export), versions and layers, search, the three export modes with real
// HTTP: the static export served like GitHub Pages (unknown paths answer 404.html with status 404, a project-site
// base), the generated Node server (run as a child process: routes, 404 status, editing API with token and revision
// check) and the application backend (stored bases, hosting under kb/<id>/), and every template.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderBlocks, renderInline, plainText, scanLinks } from './wiki-markup.js';
import { normKB, normPage, cleanSlug, newBlock } from './wiki-model.js';
import { BLOCKS } from './wiki-blocks.js';
import { deriveKeys, open, openWith, seal, sealWith, unlockAll, kdfOf } from './wiki-secret.js';
import { applyPayloads, buildSite } from './wiki-site.js';
import { createRenderer } from './wiki-render.js';
import { readerT, READER_STRINGS } from './wiki-strings-reader.js';
import { buildIndex, fold } from './wiki-search.js';
import { buildKB } from './wiki-kit.js';
import { exportJSON, exportServer, exportSingle, exportStatic } from './wiki-export.js';
import { pageDocument, staticRoutes } from './wiki-pages.js';
import { TEMPLATES } from './wiki-templates.js';
import { READER_CSS, readerCSS } from './wiki-reader-css.js';
import backend from './wiki-backend.js';
import { routeFile } from '../spa/prerender.js';
import { routeHash } from '../spa/route.js';

// Test philosophy: black-box over real artifacts. Exports are produced exactly as the editor produces them (real
// reader/server bundles via bundle.js), then served by real HTTP servers, so routing, status codes and file layout
// are tested as deployed, not mocked. No test framework: ok/eq counters keep the suite dependency-free and runnable
// both standalone (isMain) and from test.js.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// One kit spec (wiki-kit.js format) that touches every risky feature at once: layers (one off by default), ruby,
// categories, a nested slug, a redirect with fragment, versions, a secret page, secret variants, and a secret media
// file. PBKDF2 with 2000 iterations keeps key derivation fast in tests; production defaults are far higher.
const FIXTURE = {
  title: 'Fixture base', tagline: 'Testing', home: 'main', kdf: { a: 'pbkdf2-sha256', i: 2000 },
  layers: [{ id: 'tr', label: 'Translation', on: true }, { id: 'ipa', label: 'IPA', on: false }], ruby: 'furi',
  cats: [{ slug: 'things', name: 'Things', desc: 'All the things.' }],
  media: {
    pic: { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 30"><rect width="40" height="30" fill="#48d"/></svg>', name: 'pic.svg', alt: 'A box' },
    hush: { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>MEDIASECRETZEBRA</text></svg>', name: 'hush.svg', secret: true },
  },
  pages: [
    { slug: 'main', title: 'Main page', cats: ['things'], blocks: [
      { type: 'infobox', title: 'Main', image: 'pic', rows: [{ label: 'Kind', value: 'Test' }, { label: 'IPA', value: '{{ipa|/tɛst/}}', layer: 'ipa' }] },
      { type: 'text', text: 'Lead with [[other]] and [[Other page|another]]{{ref|First note.}} and {{layer|tr|translated text}} and {漢字|かんじ}.\n\n## Alpha\nText.\n## Beta\nMore.\n## Gamma\nEnd.' },
      { type: 'references' },
    ], variants: [{ password: 'pw-variant', label: 'Secret take', versions: [{ id: 'hard', label: 'Hard', blocks: [{ type: 'text', text: 'VARIANTHARDSECRET text' }] }, { id: 'easy', label: 'Easy', blocks: [{ type: 'text', text: 'VARIANTEASYSECRET text' }] }] }] },
    { slug: 'other', title: 'Other page', parent: 'main', cats: ['things'], versions: [{ id: 'full', label: 'Full', blocks: [{ type: 'text', text: 'Full text, back to [[main]].' }] }, { id: 'simple', label: 'Simple', blocks: [{ type: 'text', text: 'Simple text.' }] }] },
    { slug: 'deep/nested/page', title: 'Nested page', parent: 'other', blocks: [{ type: 'text', text: 'Deep. See [[main]] and [[other?v=simple|the simple version]].' }] },
    { slug: 'red', title: 'Red', kind: 'redirect', target: 'other#Full' },
    { slug: 'hidden/thing', title: 'Hidden THINGTITLESECRET', secret: { password: 'pw-page', note: 'note' }, blocks: [{ type: 'text', text: 'PAGEBODYSECRET words [[main]]' }, { type: 'media', media: 'hush' }] },
  ],
};
// Canary strings that exist only inside 451 content. Any export containing one has leaked plaintext. The last entry
// is a base64 fragment of the secret media's text: it catches leaked bytes (base64 media), not only leaked text.
const SECRET_WORDS = ['VARIANTHARDSECRET', 'VARIANTEASYSECRET', 'THINGTITLESECRET', 'PAGEBODYSECRET', 'hidden/thing', 'MEDIASECRETZEBRA', 'TUVESSUFUNFQ1JFVFpFQlJB'];

// Builds the same gzip bundle the build inlines (assetBundle), then gunzips it: tests run the shipped code, not the sources.
function bundleCode(file) {
  return import(pathToFileURL(path.join(ROOT, 'bundle.js')).href).then(({ assetBundle }) => zlib.gunzipSync(Buffer.from(assetBundle(path.join(HERE, file), ROOT).bytes)).toString('utf8'));
}

function request(port, p, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

// A static host like GitHub Pages below a project prefix: a, a.html, a/index.html; unknown -> 404.html (404).
// Emulates GitHub Pages: tries a, a.html, a/index.html, serves 404.html with status 404 for anything else, below a
// project prefix (/repo/). This is the hardest static-hosting case for base detection and relative links.
function pagesServer(files, prefix) {
  return http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!(p + '/').startsWith(prefix)) { res.writeHead(404); res.end(); return; }
    const rel = p.slice(prefix.length);
    for (const c of rel === '' || rel.endsWith('/') ? [rel + 'index.html'] : [rel, rel + '.html', rel + '/index.html']) {
      if (files.has(c)) { res.writeHead(200, { 'Content-Type': c.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); res.end(files.get(c)); return; }
    }
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end(files.get('404.html') || '404');
  });
}
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

export async function run() {
  let fail = 0, n = 0;
  const ok = (name, cond, extra = '') => { n++; if (!cond) { fail++; console.log(`  x ${name}${extra ? ': ' + extra : ''}`); } };
  const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} != ${JSON.stringify(b)}`);

  // ---- markup
  const c = { link: (tg) => ({ href: '#/' + tg, route: tg, cls: 'kp-link', title: tg }) };
  ok('markup escapes html', !/<script/i.test(renderBlocks('<script>alert(1)</script> <img src=x onerror=alert(1)>', c)));
  ok('markup blocks javascript: links', !/javascript:/i.test(renderInline('[x](javascript:alert(1))', c)));
  ok('markup external link', /<a class="kp-ext" href="https:\/\/example.org\/"/.test(renderInline('[x](https://example.org/)', c)));
  ok('markup wiki link', /href="#\/some-page"/.test(renderInline('[[some-page|label]]', c)));
  ok('markup ruby', /<ruby>漢字<rp>\(<\/rp><rt>かんじ<\/rt>/.test(renderInline('{漢字|かんじ}', c)));
  ok('markup layer span', /data-layer="tr"/.test(renderInline('{{layer|tr|text}}', c)));
  ok('markup bad layer id stays plain', !/data-layer/.test(renderInline('{{layer|"><x|text}}', c)));
  ok('markup heading + list', /<h2>A<\/h2><ul><li>x<\/li><li>y<\/li><\/ul>/.test(renderBlocks('## A\n- x\n- y', c)));
  eq('markup plain text', plainText('**Bold** [[a|link]] {{ref|note}}', c), 'Bold link');
  eq('scan links', scanLinks('[[a]] [[b|c]] [[d#e]] [x](f)'), ['a', 'b', 'd', 'f']);
  ok('markup placeholder', /class="kp-ph"/.test(renderInline('{{placeholder|fill me}}', c)));

  // ---- model
  eq('slug reserved prefix', cleanSlug('special/x'), 'page-special/x');
  eq('slug any script', cleanSlug('Бхакти йога'), 'бхакти-йога');
  const kb0 = normKB({ pages: [{ id: 'aaa', title: 'A', parent: 'aaa' }, { id: 'aaa', title: 'A' }, null, 7], media: { 'BAD': {} } });
  eq('normKB: duplicate ids, self parent', [kb0.pages.length, kb0.pages[0].parent, kb0.pages[0].id !== kb0.pages[1].id], [2, '', true]);
  eq('normKB: slugs unique', kb0.pages.map((p) => p.slug), ['a', 'a-2']);
  ok('normKB: bad media id dropped', !Object.keys(kb0.media).length);
  ok('normPage: secret keeps nothing in clear', normPage({ access: 'secret', title: 'X', slug: 'x', versions: [{ blocks: [{ type: 'text', text: 'y' }] }] }).title === '');
  ok('every block type has a renderer', Object.values(BLOCKS).every((b) => typeof b.render === 'function'));
  ok('newBlock defaults', newBlock('references').heading === true && newBlock('table').rows.length === 2);

  // Crypto properties checked: correct password opens, wrong one yields null (not an exception), a single flipped
  // ciphertext byte fails GCM authentication, same key -> same id but fresh IV per seal, unlockAll opens only matching
  // envelopes, and the Argon2id path works (tiny parameters for speed).
  // ---- 451 envelopes
  const kdf = { a: 'pbkdf2-sha256', s: 'c2FsdHNhbHRzYWx0c2FsdA==', i: 1000 };
  const env = await seal('correct horse', kdf, { kind: 'page', slug: 'x', title: 'Hello' });
  eq('open with the right password', (await open('correct horse', env)).title, 'Hello');
  eq('wrong password opens nothing', await open('wrong horse', env), null);
  const tampered = { ...env, ct: env.ct.slice(0, 10) + (env.ct[10] === 'A' ? 'B' : 'A') + env.ct.slice(11) };
  eq('tampered envelope fails', await open('correct horse', tampered), null);
  const k1 = await deriveKeys('pw', kdf);
  const e1 = sealWith(k1, { a: 1 }), e2 = sealWith(k1, { a: 2 });
  ok('same password, same id, different iv', e1.id === e2.id && e1.iv !== e2.iv);
  const ua = await unlockAll('pw', [e1, env, e2]);
  eq('unlockAll opens only its envelopes', ua.payloads.map((p) => p.a), [1, 2]);
  const argon = await seal('pw', kdfOf({ a: 'argon2id', t: 1, m: 64, p: 1 }, kdf.s), { z: 'argon' });
  eq('argon2id envelope', (await open('pw', argon)).z, 'argon');
  eq('openWith wrong key', openWith(await deriveKeys('nope', kdf), e1), null);

  // ---- site, render: versions, layers, variants
  const kb = await buildKB(FIXTURE);
  const site = buildSite(kb);
  const siteJSON = JSON.stringify(site);
  ok('site: no secret text in clear', SECRET_WORDS.every((w) => !siteJSON.includes(w)), SECRET_WORDS.filter((w) => siteJSON.includes(w)).join());
  eq('site: sealed envelopes', site.sealed.length, 2);
  ok('site: secret media absent', !site.media.hush && !!site.media.pic);
  const R = createRenderer(site, { t: readerT('en'), href: (r) => '#/' + r.path + (r.query && r.query.v ? '?v=' + r.query.v : '') });
  const other = site.pages.find((p) => p.slug === 'other');
  ok('version 1', /Full text/.test(R.article(other, {}).html));
  ok('version by id', /Simple text/.test(R.article(other, { version: 'simple' }).html));
  ok('versions bar', (R.article(other, {}).html.match(/data-kp-version=/g) || []).length === 2);
  const mainArt = R.article(site.pages.find((p) => p.slug === 'main'), {});
  ok('layers bar lists used layers', /data-kp-layer="tr"/.test(mainArt.html) && /data-kp-layer="ipa"/.test(mainArt.html));
  ok('layer off by default hidden', /\[data-layer="ipa"\]\{display:none/.test(mainArt.html));
  ok('ruby joins its layer', /<rt data-layer="furi">/.test(mainArt.html));
  ok('toc and references', /class="kp-toc/.test(mainArt.html) && /id="cite-note-1"/.test(mainArt.html));
  ok('version link query', /href="#\/other\?v=simple"/.test(R.article(site.pages.find((p) => p.slug === 'deep/nested/page'), {}).html));
  eq('redirect with anchor resolves', R.resolveRoute('red').kind, 'redirect');
  ok('secret route is missing without password', R.resolveRoute('hidden/thing').kind === 'missing');
  const unl = applyPayloads(site, (await unlockAll('pw-page', site.sealed)).payloads);
  ok('page password unlocks the page', unl.pages.has('hidden/thing') && unl.media.hush && unl.media.hush.d);
  const unv = applyPayloads(site, (await unlockAll('pw-variant', site.sealed)).payloads);
  const mainPage = site.pages.find((p) => p.slug === 'main');
  ok('variant password unlocks the variant with its versions', (unv.variants.get(mainPage.id) || [])[0].versions.length === 2);
  eq('wrong password unlocks nothing', (await unlockAll('nope', site.sealed)).payloads.length, 0);
  const R2 = createRenderer(site, { t: readerT('en'), unlocked: unl.pages });
  eq('unlocked secret page resolves', R2.resolveRoute('hidden/thing').kind, 'page');

  // ---- reader strings
  const enKeys = Object.keys(READER_STRINGS.en).sort().join();
  ok('reader strings: same keys in 7 languages', Object.values(READER_STRINGS).every((d) => Object.keys(d).sort().join() === enKeys));

  // ---- search
  const ix = buildIndex([{ slug: 'a', title: 'Ёжик в тумане' }, { slug: 'b', title: '東京の駅' }, { slug: 'c', title: 'თბილისი' }, { slug: 'd', title: 'Café' }], { text: (p) => p.title });
  eq('search: Cyrillic folding', ix.search('ежик').map((r) => r.page.slug), ['a']);
  eq('search: Japanese substring', ix.search('駅').map((r) => r.page.slug), ['b']);
  eq('search: Georgian prefix', ix.search('თბილ').map((r) => r.page.slug), ['c']);
  eq('search: diacritics', ix.search('cafe').map((r) => r.page.slug), ['d']);
  eq('fold', fold('Ёлка Ä'), 'елка a');

  // The reader bundle must not contain fetch(): published sites work offline / from file://; the negative lookbehind
  // skips method calls like x.fetch(. Every static style is checked for leaks and for broken relative links (each href
  // of each prerendered page must resolve to a file of the export).
  // ---- exports: no plaintext in any mode
  const mediaData = async (id) => kb.media[id] && kb.media[id].data;
  const readerCode = await bundleCode('wiki-reader-boot.js');
  const serverCode = await bundleCode('wiki-kb-server.js');
  ok('reader bundle', readerCode.length > 20000 && !/(?<![\w$.])fetch\s*\(/.test(readerCode));
  const single = await exportSingle(kb, { mediaData, readerCode });
  ok('single file: no secret text', SECRET_WORDS.every((w) => !single.includes(w)), SECRET_WORDS.filter((w) => single.includes(w)).join());
  ok('single file: data and reader inline', /<script id="kp-data" type="application\/json">/.test(single) && /data-kp-mode="single"/.test(single));
  const json = await exportJSON(kb, { mediaData });
  ok('JSON backup: 451 content sealed', ['VARIANTHARDSECRET', 'PAGEBODYSECRET', 'THINGTITLESECRET'].every((w) => !json.includes(w)));

  for (const style of ['clean', 'folders', 'html']) {
    const files = await exportStatic(kb, { mediaData, readerCode, style });
    const all = [...files.values()].map((v) => (typeof v === 'string' ? v : Buffer.from(v).toString('latin1'))).join('\n');
    ok(`static ${style}: no secret text`, SECRET_WORDS.every((w) => !all.includes(w)), SECRET_WORDS.filter((w) => all.includes(w)).join());
    ok(`static ${style}: every route has a file`, staticRoutes(buildSite(kb)).every((r) => files.has(routeFile(r, style))));
    // Every relative link of the prerendered pages points at a file of the export.
    let broken = [];
    for (const [file, html] of files) {
      if (!file.endsWith('.html') || file === '404.html') continue;
      for (const m of String(html).matchAll(/href="([^"#?:]+)(?:[?#][^"]*)?"/g)) {
        if (/^(data|https?|mailto)/.test(m[1]) || m[1].startsWith('/')) continue;
        let target = path.posix.normalize(path.posix.join(path.posix.dirname('/' + file), m[1])).slice(1);
        if (target === '' || target.endsWith('/')) target += 'index.html';
        const cands = style === 'clean' ? [target, target + '.html', target + '/index.html'] : [target, target + '/index.html'];
        if (!cands.some((x) => files.has(x))) broken.push(file + ' -> ' + m[1]);
      }
    }
    // The page that links to a page that does not exist is allowed one red link (none in the fixture).
    eq(`static ${style}: relative links resolve`, broken.slice(0, 5), []);
  }

  // static site behind a project prefix, like GitHub Pages
  {
    const files = await exportStatic(kb, { mediaData, readerCode, style: 'clean' });
    const map = new Map([...files].map(([k, v]) => [k, typeof v === 'string' ? v : Buffer.from(v)]));
    const srv = pagesServer(map, '/repo/');
    const port = await listen(srv);
    const r1 = await request(port, '/repo/');
    ok('static: home 200', r1.status === 200 && /<title>Fixture base<\/title>/.test(r1.text));
    const r2 = await request(port, '/repo/deep/nested/page');
    ok('static: nested page 200 with relative assets', r2.status === 200 && r2.text.includes('href="../../_kp/kb.css"') && /Nested page/.test(r2.text));
    const r3 = await request(port, '/repo/hidden/thing');
    ok('static: secret page is 404 with the bootstrap', r3.status === 404 && /spa-ready/.test(r3.text) && /_kp\/kb\.js/.test(r3.text) && !r3.text.includes('PAGEBODYSECRET'));
    const r4 = await request(port, '/repo/_kp/kb.js');
    ok('static: data script', r4.status === 200 && r4.text.startsWith('window.KP_DATA='));
    srv.close();
  }

  // ---- the generated Node server (child process)
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-server-'));
    try {
      const files = await exportServer(kb, { mediaData, readerCode, serverCode });
      for (const [p, d] of files) { const f = path.join(dir, ...p.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, d); }
      const allText = [...files.values()].map((v) => (typeof v === 'string' ? v : Buffer.from(v).toString('latin1'))).join('\n');
      ok('server export: no secret text', SECRET_WORDS.every((w) => !allText.includes(w)), SECRET_WORDS.filter((w) => allText.includes(w)).join());
      // A random port instead of 0, because the child process must be told the port on its command line. Rare flakiness
      // is possible on a collision (server.mjs fails fast on an explicit busy port).
      const port = 20000 + Math.floor(Math.random() * 20000);
      const child = spawn(process.execPath, [path.join(dir, 'server.mjs'), String(port), '--token', 'tok-123'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { out += d; });
      for (let i = 0; i < 100 && !/http:\/\//.test(out); i++) await new Promise((r) => setTimeout(r, 50));
      try {
        ok('server starts', /http:\/\//.test(out), out.slice(0, 300));
        const a = await request(port, '/other');
        ok('server: page 200', a.status === 200 && /Other page/.test(a.text) && /<meta name="kp-base" content="\/">/.test(a.text));
        const b = await request(port, '/no/such/page');
        ok('server: unknown page 404', b.status === 404 && /Page not found/.test(b.text));
        const s = await request(port, '/hidden/thing');
        ok('server: secret page 404', s.status === 404 && !s.text.includes('PAGEBODYSECRET'));
        eq('server: home slug redirects to the root', (await request(port, '/main')).status, 301);
        eq('server: media', (await request(port, '/_kp/media/pic.svg')).status, 200);
        eq('server: API without token', (await request(port, '/_kp/api/kb')).status, 401);
        const g = await request(port, '/_kp/api/kb', { headers: { Authorization: 'Bearer tok-123' } });
        ok('server: API read', g.status === 200 && JSON.parse(g.text).title === 'Fixture base');
        const kbj = JSON.parse(g.text);
        kbj.title = 'Renamed base';
        const put = await request(port, '/_kp/api/kb', { method: 'PUT', headers: { Authorization: 'Bearer tok-123', 'Content-Type': 'application/json' }, body: JSON.stringify({ kb: kbj, baseRev: kbj.rev }) });
        ok('server: API write', put.status === 200 && JSON.parse(put.text).rev === kbj.rev + 1);
        const stale = await request(port, '/_kp/api/kb', { method: 'PUT', headers: { Authorization: 'Bearer tok-123', 'Content-Type': 'application/json' }, body: JSON.stringify({ kb: kbj, baseRev: kbj.rev }) });
        eq('server: stale revision conflicts', stale.status, 409);
        ok('server: renders the new data', /Renamed base/.test((await request(port, '/')).text));
      } finally { child.kill(); }
    } finally { await new Promise((r) => setTimeout(r, 100)); fs.rmSync(dir, { recursive: true, force: true }); }
  }

  // ---- the application backend
  {
    const store = new Map();
    const storage = { read: (k) => (store.has(k) ? JSON.parse(store.get(k)) : null), write: (k, v) => store.set(k, JSON.stringify(v)), list: (p = '') => [...store.keys()].filter((k) => k.startsWith(p)) };
    const be = backend({ dataDir: '', storage, log: () => {}, name: 'site-studio' });
    const token = storage.read('token');
    const srv = http.createServer(async (req, res) => { if (!(await be.handle(req, res, new URL(req.url, 'http://x')))) { res.writeHead(404); res.end('static'); } });
    const port = await listen(srv);
    try {
      eq('backend: info', JSON.parse((await request(port, '/app/api/info')).text).app, 'site-studio');
      const body = JSON.stringify({ kb: JSON.parse(json) });
      eq('backend: write needs token', (await request(port, `/app/api/kbs/${kb.id}`, { method: 'PUT', body })).status, 401);
      const w = await request(port, `/app/api/kbs/${kb.id}`, { method: 'PUT', headers: { Authorization: 'Bearer ' + token }, body });
      eq('backend: write', JSON.parse(w.text).rev, 1);
      await request(port, `/app/api/kbs/${kb.id}/media/pic?type=image/svg%2Bxml`, { method: 'PUT', headers: { Authorization: 'Bearer ' + token }, body: Buffer.from(kb.media.pic.data, 'base64') });
      eq('backend: list', JSON.parse((await request(port, '/app/api/kbs')).text).map((x) => x.id), [kb.id]);
      const h1 = await request(port, `/app/kb/${kb.id}/other`);
      ok('backend: hosted page', h1.status === 200 && /Other page/.test(h1.text));
      eq('backend: hosted unknown page 404', (await request(port, `/app/kb/${kb.id}/nope`)).status, 404);
      eq('backend: hosted media', (await request(port, `/app/kb/${kb.id}/_kp/media/pic.svg`)).status, 200);
      const rj = await request(port, `/app/kb/${kb.id}/_kp/reader.js`);
      ok('backend: reader script', rj.status === 200 && rj.text.length > 20000);
      eq('backend: stale write conflicts', (await request(port, `/app/api/kbs/${kb.id}`, { method: 'PUT', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify({ kb: JSON.parse(json), baseRev: 0 }) })).status, 409);
    } finally { srv.close(); }
  }

  // ---- page documents
  const doc = pageDocument(site, 'nope', { mode: 'server', base: '/' });
  eq('page document: unknown route status', doc.status, 404);

  // ---- templates: build, render every page, passwords open something
  for (const tpl of TEMPLATES) {
    const spec = tpl.spec({ lang: 'en' });
    const tkb = await buildKB(spec);
    const ts = buildSite(tkb);
    const TR = createRenderer(ts, { t: readerT(ts.uiLang) });
    let bad = 0;
    // Links to 451 pages look like links to missing pages until they are unlocked: they are not broken.
    const secretRoutes = new Set(spec.pages.filter((p) => p.secret).map((p) => p.slug));
    for (const p of ts.pages) {
      if (p.kind === 'redirect') { if (!TR.findPage(String(p.target).split('#')[0])) bad++; continue; }
      for (const v of p.versions) {
        const h = TR.article(p, { version: v.id }).html;
        if (/class="kp-missing"/.test(h)) bad++;
        for (const m of h.matchAll(/class="kp-link kp-new"[^>]*data-kp-route="([^"]*)"/g)) if (!secretRoutes.has(m[1])) bad++;
      }
    }
    ok(`template ${tpl.id}: pages render without broken links`, bad === 0, String(bad));
    const pws = new Set();
    for (const p of spec.pages) { if (p.secret) pws.add(p.secret.password); for (const v of p.variants || []) pws.add(v.password); }
    for (const pw of pws) ok(`template ${tpl.id}: password ${pw} opens content`, (await unlockAll(pw, ts.sealed)).payloads.length > 0);
    ok(`template ${tpl.id}: 7 names`, ['en', 'ru', 'uk', 'de', 'fr', 'es', 'ka'].every((l) => tpl.name[l] && tpl.desc[l]));
  }

  // ---- portal blocks (../portal/ through blocks-portal.js): the "Legal knowledge base" template
  {
    const tpl = TEMPLATES.find((x) => x.id === 'portal');
    const ps = buildSite(await buildKB(tpl.spec({})));
    const PR = createRenderer(ps, { t: readerT('en'), href: (r) => routeHash(r) });
    const pg = (slug) => PR.article(ps.pages.find((p) => p.slug === slug), {}).html;
    const code = pg('tax-code');
    ok('portal: act with contents, articles and paragraph anchors', /data-pt-spy/.test(code) && /id="tax-a3-1"/.test(code) && /id="tax-a2-p1-a"/.test(code));
    ok('portal: references inside the act resolve to paragraphs', /href="#\/tax-code#tax-a2-p1-a"/.test(code));
    ok('portal: glossary terms linked with tooltip definitions', /data-pt-tip="t-turnover"/.test(code) && /data-pt-tipd="t-turnover"/.test(code));
    ok('portal: glossary sources link to the act on another page', /href="#\/tax-code#tax-a7"/.test(pg('glossary')));
    const explain = pg('how-small-business-taxation-works');
    ok('portal: an ordinary text page links articles and terms', /kp-pt-xref" href="#\/tax-code#tax-a5"/.test(explain) && /data-pt-tip=/.test(explain));
    ok('portal: requests matched with the directory', /class="kp-pt-match"/.test(pg('requests')) && /href="#\/specialists#pr-tamar-lomidze"/.test(pg('requests')));
    ok('portal: topic hub with the pages of the category', /kp-pt-hs-page/.test(pg('compliance')) && /kp-pt-stats/.test(pg('compliance')));
    const sr = PR.portalSearch().search('turnover');
    ok('portal: search entries in type tabs', sr.counts.term >= 1 && sr.counts.article >= 1);
    const page = PR.special('search', 'turnover', { results: [], portal: sr, type: 'term' }).html;
    ok('portal: search page tabs', /kp-pt-ftabs/.test(page) && /type=term/.test(page) && /data-pt-type="term"/.test(page) && !/data-pt-type="article"/.test(page));
    ok('portal: stylesheet carries the used chunks only', /\.kp-pt-toc/.test(readerCSS(ps)) && readerCSS(site) === READER_CSS && !/__P__/.test(readerCSS(null)));
    ok('portal: every portal type renders empty', ['act', 'terms', 'directory', 'board', 'hub', 'checklist', 'finder'].every((ty) => /class="kp-pt /.test(BLOCKS[ty].render(newBlock(ty), { ...PR, t: readerT('en'), inline: (s) => s, blocks: (s) => s, plainOf: (s) => s, resolve: () => null, media: () => null, lang: 'en' }))));
  }

  console.log(`site-studio wiki: ${n - fail}/${n} passed`);
  return fail;
}

// Exit code 1 on any failure so CI and check.js can gate on it.
if (isMain) run().then((f) => process.exit(f ? 1 : 0));
