// knowledge-processor/test.js - tests of the knowledge processor: `node knowledge-processor/test.js` (also
// `node check.js tests knowledge-processor`). Markup safety, model normalization, 451 envelopes (right / wrong
// password, tampering, no plaintext in any export), versions and layers, search, the three export modes with real
// HTTP: the static export served like GitHub Pages (unknown paths answer 404.html with status 404, a project-site
// base), the generated Node server (run as a child process: routes, 404 status, editing API with token and revision
// check) and the application backend (stored bases, hosting under kb/<id>/), and every template.
//
// Design of this harness:
// - No test framework: ok()/eq() count and print only failures; run() returns the failure count so check.js can
//   aggregate many apps and `node test.js` maps it to the exit code. Zero dependencies keeps the repo installable offline.
// - One shared FIXTURE exercises every risky feature at once (layers, ruby, versions, variants, redirect, nested slug,
//   secret page, secret media). Small enough to read, rich enough that a regression in any module trips a test.
// - Secrecy is asserted by NEGATIVE search: canary words that exist only inside 451 content are grepped in every
//   artefact (site JSON, single file, JSON backup, each static style, server export). A positive 'is encrypted' check
//   would pass even if a plaintext copy leaked elsewhere; absence of the canary is the property that matters.
// - Real sockets on 127.0.0.1 and a real child process instead of mocks: status codes, routing and relative URLs are
//   exactly the bugs mocks hide.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderBlocks, renderInline, plainText, scanLinks } from './markup.js';
import { normKB, normPage, cleanSlug, newBlock } from './model.js';
import { BLOCKS } from './blocks.js';
import { deriveKeys, open, openWith, seal, sealWith, unlockAll, kdfOf } from './secret.js';
import { applyPayloads, buildSite } from './site.js';
import { createRenderer } from './render.js';
import { readerT, READER_STRINGS } from './strings-reader.js';
import { buildIndex, fold } from './search.js';
import { buildKB } from './kit.js';
import { exportJSON, exportServer, exportSingle, exportStatic } from './export.js';
import { pageDocument, staticRoutes } from './pages.js';
import { TEMPLATES } from './templates.js';
import { READER_CSS, readerCSS } from './reader-css.js';
import backend from './backend.js';
import { routeFile } from '../spa/prerender.js';
import { routeHash } from '../spa/route.js';

// isMain: run only when executed directly; check.js imports run() without side effects.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// Fixture. kdf i:2000 is deliberately tiny: PBKDF2 at production cost would make the suite slow; strength is not under
// test here, correctness of seal/open is. Each SECRET text is a unique uppercase canary so a substring search cannot
// match ordinary prose.
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
// Canaries: body/title texts of secret page and variant, the secret slug itself (route names leak structure), the secret
// SVG text, and a base64 form of it (media is stored base64, so a raw-text search alone would miss a leaked file).
// KNOWN DEFECT: 'TUVESSUFUNFQ1JFVFpFQlJB' is not the base64 of 'MEDIASECRETZEBRA' at any byte alignment (it decodes to
// garbage), so the base64 leak check guards nothing. Fix: add the cores of Buffer.from(p + word).toString('base64') for
// prefix lengths 0, 1 and 2 (base64 output depends on the byte offset mod 3), trimmed of their first and last chars.
const SECRET_WORDS = ['VARIANTHARDSECRET', 'VARIANTEASYSECRET', 'THINGTITLESECRET', 'PAGEBODYSECRET', 'hidden/thing', 'MEDIASECRETZEBRA', 'TUVESSUFUNFQ1JFVFpFQlJB'];

// Reader/server code as the build ships it: bundle.js produces the gzip asset, gunzip gives the exact JS. Testing the
// bundle (not the sources) catches import-graph and bundling breakage.
function bundleCode(file) {
  return import(pathToFileURL(path.join(ROOT, 'bundle.js')).href).then(({ assetBundle }) => zlib.gunzipSync(Buffer.from(assetBundle(path.join(HERE, file), ROOT).bytes)).toString('utf8'));
}

// Minimal HTTP client: resolves for every status (4xx is an expected outcome here, not an error); rejects only on
// socket failure. Body collected as Buffers and decoded once: decoding per chunk would split multi-byte UTF-8.
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

// Prefix check uses p + '/' so '/repo' (no slash) also counts as inside '/repo/'. Lookup order mirrors GitHub Pages
// (exact, .html, /index.html); that order is what the 'clean' export style relies on.
// A static host like GitHub Pages below a project prefix: a, a.html, a/index.html; unknown -> 404.html (404).
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
// Port 0: the OS picks a free port, no collisions between parallel runs.
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

export async function run() {
  let fail = 0, n = 0;
  // JSON.stringify equality: deep, order-sensitive. Object key order matters too, acceptable because every compared value
  // is built in a deterministic order.
  const ok = (name, cond, extra = '') => { n++; if (!cond) { fail++; console.log(`  x ${name}${extra ? ': ' + extra : ''}`); } };
  const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} != ${JSON.stringify(b)}`);

  // ---- markup
  // Link resolver stub: markup.js asks the context how to render [[target]]; a fixed shape isolates markup from routing.
  // The XSS cases below are the security contract of markup: raw HTML is escaped, javascript: URLs never become hrefs,
  // layer ids are validated (an id lands in an attribute, so a quote in it would break out).
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
  // Slugs: 'special/' is the reader's reserved namespace (special pages), so user slugs are pushed out of it. Non-Latin
  // scripts survive (lowercased, spaces to '-') instead of being transliterated or dropped.
  // normKB must repair hostile input: duplicate ids, self-parent (would loop the tree walk), null/number pages, bad keys.
  eq('slug reserved prefix', cleanSlug('special/x'), 'page-special/x');
  eq('slug any script', cleanSlug('Бхакти йога'), 'бхакти-йога');
  const kb0 = normKB({ pages: [{ id: 'aaa', title: 'A', parent: 'aaa' }, { id: 'aaa', title: 'A' }, null, 7], media: { 'BAD': {} } });
  eq('normKB: duplicate ids, self parent', [kb0.pages.length, kb0.pages[0].parent, kb0.pages[0].id !== kb0.pages[1].id], [2, '', true]);
  eq('normKB: slugs unique', kb0.pages.map((p) => p.slug), ['a', 'a-2']);
  ok('normKB: bad media id dropped', !Object.keys(kb0.media).length);
  // A secret page keeps no title in clear in the model: its content lives only in the sealed envelope.
  ok('normPage: secret keeps nothing in clear', normPage({ access: 'secret', title: 'X', slug: 'x', versions: [{ blocks: [{ type: 'text', text: 'y' }] }] }).title === '');
  ok('every block type has a renderer', Object.values(BLOCKS).every((b) => typeof b.render === 'function'));
  ok('newBlock defaults', newBlock('references').heading === true && newBlock('table').rows.length === 2);

  // ---- 451 envelopes
  // Fixed salt + low iterations: deterministic and fast. The tamper test flips one base64 char of the ciphertext: an
  // authenticated cipher must reject it and open() must return null, not throw and not return partial plaintext.
  const kdf = { a: 'pbkdf2-sha256', s: 'c2FsdHNhbHRzYWx0c2FsdA==', i: 1000 };
  const env = await seal('correct horse', kdf, { kind: 'page', slug: 'x', title: 'Hello' });
  eq('open with the right password', (await open('correct horse', env)).title, 'Hello');
  eq('wrong password opens nothing', await open('wrong horse', env), null);
  const tampered = { ...env, ct: env.ct.slice(0, 10) + (env.ct[10] === 'A' ? 'B' : 'A') + env.ct.slice(11) };
  eq('tampered envelope fails', await open('correct horse', tampered), null);
  const k1 = await deriveKeys('pw', kdf);
  const e1 = sealWith(k1, { a: 1 }), e2 = sealWith(k1, { a: 2 });
  // id derives from the key (lets the reader find which envelopes a password opens without trying to decrypt all);
  // the iv must be fresh per seal: reusing it with the same key breaks GCM-style confidentiality.
  ok('same password, same id, different iv', e1.id === e2.id && e1.iv !== e2.iv);
  const ua = await unlockAll('pw', [e1, env, e2]);
  eq('unlockAll opens only its envelopes', ua.payloads.map((p) => p.a), [1, 2]);
  // argon2id path: tiny cost parameters (t:1, m:64) only prove the alternative KDF is wired, not its strength.
  const argon = await seal('pw', kdfOf({ a: 'argon2id', t: 1, m: 64, p: 1 }, kdf.s), { z: 'argon' });
  eq('argon2id envelope', (await open('pw', argon)).z, 'argon');
  eq('openWith wrong key', openWith(await deriveKeys('nope', kdf), e1), null);

  // ---- site, render: versions, layers, variants
  // buildSite is the publish boundary: everything after it may reach the public, so secrecy is checked right here first.
  const kb = await buildKB(FIXTURE);
  const site = buildSite(kb);
  const siteJSON = JSON.stringify(site);
  ok('site: no secret text in clear', SECRET_WORDS.every((w) => !siteJSON.includes(w)), SECRET_WORDS.filter((w) => siteJSON.includes(w)).join());
  eq('site: sealed envelopes', site.sealed.length, 2);
  ok('site: secret media absent', !site.media.hush && !!site.media.pic);
  // href stub encodes ?v= so version links can be asserted textually.
  const R = createRenderer(site, { t: readerT('en'), href: (r) => '#/' + r.path + (r.query && r.query.v ? '?v=' + r.query.v : '') });
  const other = site.pages.find((p) => p.slug === 'other');
  ok('version 1', /Full text/.test(R.article(other, {}).html));
  ok('version by id', /Simple text/.test(R.article(other, { version: 'simple' }).html));
  ok('versions bar', (R.article(other, {}).html.match(/data-kp-version=/g) || []).length === 2);
  const mainArt = R.article(site.pages.find((p) => p.slug === 'main'), {});
  ok('layers bar lists used layers', /data-kp-layer="tr"/.test(mainArt.html) && /data-kp-layer="ipa"/.test(mainArt.html));
  // Layers off by default are hidden by an inline CSS rule, not removed from HTML: toggling needs no re-render.
  ok('layer off by default hidden', /\[data-layer="ipa"\]\{display:none/.test(mainArt.html));
  ok('ruby joins its layer', /<rt data-layer="furi">/.test(mainArt.html));
  ok('toc and references', /class="kp-toc/.test(mainArt.html) && /id="cite-note-1"/.test(mainArt.html));
  ok('version link query', /href="#\/other\?v=simple"/.test(R.article(site.pages.find((p) => p.slug === 'deep/nested/page'), {}).html));
  eq('redirect with anchor resolves', R.resolveRoute('red').kind, 'redirect');
  ok('secret route is missing without password', R.resolveRoute('hidden/thing').kind === 'missing');
  // A page password must also unlock the secret media the page uses (media.hush.d = decoded data).
  const unl = applyPayloads(site, (await unlockAll('pw-page', site.sealed)).payloads);
  ok('page password unlocks the page', unl.pages.has('hidden/thing') && unl.media.hush && unl.media.hush.d);
  const unv = applyPayloads(site, (await unlockAll('pw-variant', site.sealed)).payloads);
  const mainPage = site.pages.find((p) => p.slug === 'main');
  ok('variant password unlocks the variant with its versions', (unv.variants.get(mainPage.id) || [])[0].versions.length === 2);
  eq('wrong password unlocks nothing', (await unlockAll('nope', site.sealed)).payloads.length, 0);
  const R2 = createRenderer(site, { t: readerT('en'), unlocked: unl.pages });
  eq('unlocked secret page resolves', R2.resolveRoute('hidden/thing').kind, 'page');

  // ---- reader strings
  // Key parity across languages: a missing key silently falls back to English (readerT), so only a test notices.
  const enKeys = Object.keys(READER_STRINGS.en).sort().join();
  ok('reader strings: same keys in 7 languages', Object.values(READER_STRINGS).every((d) => Object.keys(d).sort().join() === enKeys));

  // ---- search
  // Folding contract of search: case folded, diacritics stripped (so also e for yo); CJK matched by substring (no word
  // spaces), Georgian by prefix. Each case is a script with a different segmentation problem.
  const ix = buildIndex([{ slug: 'a', title: 'Ёжик в тумане' }, { slug: 'b', title: '東京の駅' }, { slug: 'c', title: 'თბილისი' }, { slug: 'd', title: 'Café' }], { text: (p) => p.title });
  eq('search: Cyrillic folding', ix.search('ежик').map((r) => r.page.slug), ['a']);
  eq('search: Japanese substring', ix.search('駅').map((r) => r.page.slug), ['b']);
  eq('search: Georgian prefix', ix.search('თბილ').map((r) => r.page.slug), ['c']);
  eq('search: diacritics', ix.search('cafe').map((r) => r.page.slug), ['d']);
  eq('fold', fold('Ёлка Ä'), 'елка a');

  // ---- exports: no plaintext in any mode
  // Export checks: the reader bundle must not call fetch() (single-file and offline modes have no server); the lookbehind
  // excludes obj.fetch( and identifiers ending in fetch.
  const mediaData = async (id) => kb.media[id] && kb.media[id].data;
  const readerCode = await bundleCode('reader-boot.js');
  const serverCode = await bundleCode('kb-server.js');
  ok('reader bundle', readerCode.length > 20000 && !/(?<![\w$.])fetch\s*\(/.test(readerCode));
  const single = await exportSingle(kb, { mediaData, readerCode });
  ok('single file: no secret text', SECRET_WORDS.every((w) => !single.includes(w)), SECRET_WORDS.filter((w) => single.includes(w)).join());
  ok('single file: data and reader inline', /<script id="kp-data" type="application\/json">/.test(single) && /data-kp-mode="single"/.test(single));
  const json = await exportJSON(kb, { mediaData });
  ok('JSON backup: 451 content sealed', ['VARIANTHARDSECRET', 'PAGEBODYSECRET', 'THINGTITLESECRET'].every((w) => !json.includes(w)));

  // The three static URL styles: clean (a), folders (a/index.html), html (a.html). Each must have a file per route and
  // leak no canary. Binary files are decoded latin1: lossless byte-to-char, so a canary search works on any file.
  for (const style of ['clean', 'folders', 'html']) {
    const files = await exportStatic(kb, { mediaData, readerCode, style });
    const all = [...files.values()].map((v) => (typeof v === 'string' ? v : Buffer.from(v).toString('latin1'))).join('\n');
    ok(`static ${style}: no secret text`, SECRET_WORDS.every((w) => !all.includes(w)), SECRET_WORDS.filter((w) => all.includes(w)).join());
    ok(`static ${style}: every route has a file`, staticRoutes(buildSite(kb)).every((r) => files.has(routeFile(r, style))));
    // Every relative link of the prerendered pages points at a file of the export.
    let broken = [];
    for (const [file, html] of files) {
      if (!file.endsWith('.html') || file === '404.html') continue;
      // Skip external, data:, mailto: and root-absolute links: only document-relative links depend on folder depth, which
      // is the class of bug (wrong ../ count) this loop exists for.
      for (const m of String(html).matchAll(/href="([^"#?:]+)(?:[?#][^"]*)?"/g)) {
        if (/^(data|https?|mailto)/.test(m[1]) || m[1].startsWith('/')) continue;
        let target = path.posix.normalize(path.posix.join(path.posix.dirname('/' + file), m[1])).slice(1);
        if (target === '' || target.endsWith('/')) target += 'index.html';
        const cands = style === 'clean' ? [target, target + '.html', target + '/index.html'] : [target, target + '/index.html'];
        if (!cands.some((x) => files.has(x))) broken.push(file + ' -> ' + m[1]);
      }
    }
    // Zero tolerance: the fixture has no red links, so any unresolved relative href is a path bug. slice(0, 5) keeps
    // the failure message short while still showing the pattern.
    eq(`static ${style}: relative links resolve`, broken.slice(0, 5), []);
  }

  // static site behind a project prefix, like GitHub Pages
  // Served under /repo/ like a GitHub project site: absolute '/...' links would break there, hence the relative-asset
  // assertion. A secret page must answer 404 yet carry the SPA bootstrap, so the reader can unlock it client side.
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
    // Generated server in a temp dir, run with the current node binary (process.execPath: same version as the tests).
    // KNOWN DEFECT: the port is random in 20000..39999 with no retry; a busy port makes 'server starts' fail spuriously.
    // Fix: start the child on port 0 and parse the printed URL, or retry on EADDRINUSE.
    // Readiness is polled on stdout (up to 100 x 50 ms) rather than a fixed sleep: fast when fast, bounded when not.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-server-'));
    try {
      const files = await exportServer(kb, { mediaData, readerCode, serverCode });
      for (const [p, d] of files) { const f = path.join(dir, ...p.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, d); }
      const allText = [...files.values()].map((v) => (typeof v === 'string' ? v : Buffer.from(v).toString('latin1'))).join('\n');
      ok('server export: no secret text', SECRET_WORDS.every((w) => !allText.includes(w)), SECRET_WORDS.filter((w) => allText.includes(w)).join());
      const port = 20000 + Math.floor(Math.random() * 20000);
      const child = spawn(process.execPath, [path.join(dir, 'server.mjs'), String(port), '--token', 'tok-123'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { out += d; });
      for (let i = 0; i < 100 && !/http:\/\//.test(out); i++) await new Promise((r) => setTimeout(r, 50));
      try {
        ok('server starts', /http:\/\//.test(out), out.slice(0, 300));
        // Contract checked: pages 200, unknown 404 (real status, for crawlers), secret 404 without plaintext, home slug 301 to
        // root (one canonical URL), API behind a Bearer token, optimistic concurrency: PUT with baseRev bumps rev; the same
        // baseRev again is stale and must 409 instead of overwriting.
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
    // Short delay before rm: on Windows the killed child may still hold file handles, making rmSync fail.
    } finally { await new Promise((r) => setTimeout(r, 100)); fs.rmSync(dir, { recursive: true, force: true }); }
  }

  // ---- the application backend
  {
    // Backend over an in-memory storage adapter (same read/write/list interface as the file store): tests routing and
    // auth, not the disk. The token is created by backend() at startup and read back from storage.
    const store = new Map();
    const storage = { read: (k) => (store.has(k) ? JSON.parse(store.get(k)) : null), write: (k, v) => store.set(k, JSON.stringify(v)), list: (p = '') => [...store.keys()].filter((k) => k.startsWith(p)) };
    const be = backend({ dataDir: '', storage, log: () => {}, name: 'knowledge-processor' });
    const token = storage.read('token');
    const srv = http.createServer(async (req, res) => { if (!(await be.handle(req, res, new URL(req.url, 'http://x')))) { res.writeHead(404); res.end('static'); } });
    const port = await listen(srv);
    try {
      eq('backend: info', JSON.parse((await request(port, '/app/api/info')).text).app, 'knowledge-processor');
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
  // Every template must render all pages and versions with no missing blocks and no red links, and every password it
  // declares must open at least one envelope. This catches typos in hand-written slugs across thousands of lines.
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
  // Portal blocks: anchors and cross-references inside acts, glossary tooltips, matching and search tabs. The CSS check
  // proves readerCSS() adds portal chunks only when a site uses them (READER_CSS unchanged for a plain site).
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

  // Summary always printed; the return value (failure count) is the machine-readable result.
  console.log(`knowledge-processor: ${n - fail}/${n} passed`);
  return fail;
}

if (isMain) run().then((f) => process.exit(f ? 1 : 0));
