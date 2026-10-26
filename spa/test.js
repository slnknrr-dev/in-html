// spa/test.js - unit tests of the routing library: `node spa/test.js` (importing the module runs nothing).
// Slugs, route strings, hash routes, URL styles, base detection, relative links of prerendered pages, sitemaps and the
// 404.html bootstrap (run in a VM context with a fake DOM whose "server" answers the probe scripts).

import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { formatQuery, formatRoute, hashRoute, normPath, parseQuery, routeHash, sameRoute, slugify, splitRoute, withoutQuery } from './route.js';
import { baseCandidates, baseFromRoute, guessBase, normBase, pathOf, routeOf } from './base.js';
import { relHref, relRoot, robotsTXT, routeFile, sitemapXML } from './prerender.js';
import { notFoundPage, spaNotFoundBoot } from './notfound.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// Runs the 404 bootstrap for a pathname against a fake site: files maps a script URL to the id it defines.
function runBoot(pathname, files, opts, stored = null) {
  const appended = [];
  const storage = new Map(stored ? [[opts.key, stored]] : []);
  const win = { localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) } };
  const head = {
    appendChild(el) {
      appended.push(el);
      el.parentNode = head;
      if (el.tag === 'script' && el.onload) {
        const id = files[el.src];
        if (id === undefined) el.onerror();
        else { win[opts.global] = { site: { id } }; el.onload(); }
      }
    },
    removeChild(el) { el.parentNode = null; },
  };
  const doc = { head, documentElement: { className: '' }, createElement: (tag) => ({ tag }) };
  const ctx = vm.createContext({ document: doc, window: win, location: { pathname }, decodeURI, encodeURI });
  vm.runInContext(`(${spaNotFoundBoot.toString()})(${JSON.stringify(opts)})`, ctx);
  return {
    base: win.SPA_BASE || null,
    probes: appended.filter((e) => e.tag === 'script' && e.onload).map((e) => e.src),
    loaded: appended.filter((e) => !e.onload).map((e) => e.href || e.src),
    cls: doc.documentElement.className.trim(),
    stored: storage.get(opts.key) || null,
  };
}

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };

  // route.js
  eq('normPath', normPath('/a//b/../c/./d/'), 'a/c/d');
  eq('normPath above root', normPath('../../x'), 'x');
  eq('slugify latin', slugify('Bhakti yoga (practice)'), 'bhakti-yoga-practice');
  eq('slugify cyrillic', slugify('Бхакти-йога: практика'), 'бхакти-йога-практика');
  eq('slugify japanese', slugify('日本語 の 文法'), '日本語-の-文法');
  eq('slugify georgian', slugify('ქართული ანბანი'), 'ქართული-ანბანი');
  eq('slugify apostrophe', slugify("Krishna's flute"), 'krishnas-flute');
  eq('slugify slash', slugify('Concepts / Rasa Theory', { slash: true }), 'concepts/rasa-theory');
  eq('slugify empty', slugify('!!!'), 'page');
  eq('slugify max', slugify('a'.repeat(200), { max: 10 }), 'aaaaaaaaaa');
  eq('splitRoute', splitRoute('/a/b?v=simple&451=p%C3%A4ss#Early%20life'), { path: 'a/b', query: { v: 'simple', 451: 'päss' }, frag: 'Early life' });
  eq('formatRoute', formatRoute({ path: 'a/b c', query: { v: 'x y' }, frag: 'h' }), 'a/b%20c?v=x+y#h');
  eq('route round trip', splitRoute(formatRoute({ path: 'конспект/урок', query: { q: 'ა&ბ' }, frag: 'სექცია' })), { path: 'конспект/урок', query: { q: 'ა&ბ' }, frag: 'სექცია' });
  eq('parseQuery', parseQuery('?a=1&b&c=%20x&__proto__=1'), { a: '1', b: '', c: ' x' });
  eq('formatQuery', formatQuery({ a: 1, b: '', c: null, d: false }), 'a=1&b');
  eq('hashRoute page', hashRoute('#/a/b?v=x#sec'), { path: 'a/b', query: { v: 'x' }, frag: 'sec' });
  eq('hashRoute 451 only', hashRoute('#?451=secret'), { path: '', query: { 451: 'secret' }, frag: '' });
  eq('hashRoute home', hashRoute(''), { path: '', query: {}, frag: '' });
  eq('hashRoute anchor', hashRoute('#section'), null);
  eq('routeHash', routeHash({ path: 'a', query: { v: '2' }, frag: '' }), '#/a?v=2');
  eq('sameRoute', [sameRoute('a/b?x=1', { path: 'a/b' }), sameRoute('a', 'b')], [true, false]);
  eq('withoutQuery', withoutQuery('a?451=x&v=1', '451'), { path: 'a', query: { v: '1' }, frag: '' });

  // base.js
  eq('normBase', [normBase(''), normBase('repo'), normBase('/repo/x/')], ['/', '/repo/', '/repo/x/']);
  eq('pathOf clean', [pathOf('', '/repo/'), pathOf('a/b', '/repo/'), pathOf('ü', '/')], ['/repo/', '/repo/a/b', '/%C3%BC']);
  eq('pathOf folders', [pathOf('', '/', 'folders'), pathOf('a/b', '/r/', 'folders')], ['/', '/r/a/b/']);
  eq('pathOf html', [pathOf('', '/', 'html'), pathOf('a/b', '/r/', 'html')], ['/index.html', '/r/a/b.html']);
  eq('routeOf', [routeOf('/repo/a/b', '/repo/'), routeOf('/repo/', '/repo/'), routeOf('/repo', '/repo/'), routeOf('/other/x', '/repo/')], ['a/b', '', '', null]);
  eq('routeOf html endings', [routeOf('/r/a/b.html', '/r/'), routeOf('/r/index.html', '/r/'), routeOf('/r/a/index.html', '/r/')], ['a/b', '', 'a']);
  eq('routeOf encoded', routeOf('/%D0%B1%D1%85%D0%B0%D0%BA%D1%82%D0%B8', '/'), 'бхакти');
  eq('baseFromRoute', [baseFromRoute('/repo/a/b', 'a/b'), baseFromRoute('/repo/a/b/', 'a/b'), baseFromRoute('/repo/a/b.html', 'a/b'), baseFromRoute('/repo/', ''), baseFromRoute('/repo/index.html', ''), baseFromRoute('/x/y', 'a')],
    ['/repo/', '/repo/', '/repo/', '/repo/', '/repo/', null]);
  eq('baseCandidates', [baseCandidates('/repo/a/b'), baseCandidates('/repo/'), baseCandidates('/')], [['/repo/a/', '/repo/', '/'], ['/repo/', '/'], ['/']]);
  eq('guessBase known route', guessBase('/repo/a/b', ['a/b', 'b']), '/repo/');
  eq('guessBase user site', guessBase('/a/b', ['a/b']), '/');
  eq('guessBase stored', guessBase('/repo/special/search', ['x'], '/repo/'), '/repo/');
  eq('guessBase fallback', guessBase('/nothing/here', ['x'], '/repo/'), '/');

  // prerender.js
  eq('routeFile', [routeFile(''), routeFile('a/b'), routeFile('a/b', 'folders'), routeFile('a', 'html')], ['index.html', 'a/b.html', 'a/b/index.html', 'a.html']);
  eq('relRoot', [relRoot(''), relRoot('a'), relRoot('a/b'), relRoot('a/b', 'folders'), relRoot('a', 'html')], ['', '', '../', '../../', '']);
  eq('relHref clean', [relHref('a/b', 'c'), relHref('a/b', ''), relHref('', 'c'), relHref('', ''), relHref('a/b', 'a/c'), relHref('c', 'a/b')], ['../c', '../', 'c', './', 'c', 'a/b']);
  eq('relHref folders', [relHref('a/b', 'c', 'folders'), relHref('a', 'a/b', 'folders'), relHref('a', '', 'folders')], ['../../c/', 'b/', '../']);
  eq('relHref html', [relHref('a/b', '', 'html'), relHref('', 'a/b', 'html')], ['../index.html', 'a/b.html']);
  eq('relHref query + frag', relHref('a', 'b?v=2#x y'), 'b?v=2#x%20y');
  eq('relHref same page frag', relHref('a/b', 'a/b#refs'), '#refs');
  // Every relative link resolves to the right absolute URL under any base.
  for (const style of ['clean', 'folders', 'html']) {
    const routes = ['', 'a', 'a/b', 'a/b/c', 'z', 'ü/ä'];
    let ok = true;
    for (const base of ['/', '/repo/', '/deep/er/']) {
      for (const from of routes) for (const to of routes) {
        const u = new URL(relHref(from, to, style), 'https://h.test' + pathOf(from, base, style));
        if (u.pathname !== pathOf(to, base, style)) { ok = false; console.log(`  ${style} ${base} ${from} -> ${to}: ${u.pathname}`); }
      }
    }
    eq(`relHref resolves (${style})`, ok, true);
  }
  eq('sitemap', sitemapXML('https://x.org/repo', [{ route: '', lastmod: '2026-01-02' }, { route: 'a&b' }]).split('\n').slice(2, 4),
    ['  <url><loc>https://x.org/repo/</loc><lastmod>2026-01-02</lastmod></url>', '  <url><loc>https://x.org/repo/a%26b</loc></url>']);
  eq('robots', robotsTXT('https://x.org/r/'), 'User-agent: *\nAllow: /\nSitemap: https://x.org/r/sitemap.xml\n');

  // notfound.js
  const opts = { probe: '_kp/kb.js', global: 'KP_DATA', idPath: 'site.id', id: 'site1', base: '', key: 'spa-base:site1', load: [{ css: '_kp/kb.css' }, { js: '_kp/reader.js', module: true }] };
  const project = { '/repo/_kp/kb.js': 'site1', '/_kp/kb.js': 'other-site' };
  let r = runBoot('/repo/special/search', project, opts);
  eq('404 project site', [r.base, r.probes, r.loaded, r.cls, r.stored],
    ['/repo/', ['/repo/special/_kp/kb.js', '/repo/_kp/kb.js'], ['/repo/_kp/kb.css', '/repo/_kp/reader.js'], 'spa-ready', '/repo/']);
  r = runBoot('/repo/special/search', project, opts, '/repo/');
  eq('404 remembered base first', r.probes, ['/repo/_kp/kb.js']);
  r = runBoot('/deep/page', { '/_kp/kb.js': 'site1' }, opts);
  eq('404 user site', [r.base, r.probes], ['/', ['/deep/_kp/kb.js', '/_kp/kb.js']]);
  r = runBoot('/x/y', project, opts);
  eq('404 nothing found', [r.base, r.cls], [null, 'spa-failed']);
  r = runBoot('/wiki/x', { '/wiki/_kp/kb.js': 'site1' }, { ...opts, base: '/wiki/' });
  eq('404 configured base', r.probes, ['/wiki/_kp/kb.js']);
  r = runBoot('/вики/x', { '/%D0%B2%D0%B8%D0%BA%D0%B8/_kp/kb.js': 'site1' }, opts);
  eq('404 non-ASCII base', r.base, '/вики/');
  const page = notFoundPage({ lang: 'ru', title: 'Не найдено <x>', body: '<p>404</p>', boot: { ...opts, id: '</script>' } });
  eq('404 page markup', [page.includes('<title>Не найдено &lt;x&gt;</title>'), page.includes('</script>"'), page.includes('\\u003c/script>')], [true, false, true]);

  console.log(`spa: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) run().then((f) => { process.exitCode = f ? 1 : 0; });
