// site-studio/backend-site.js - what a landing needs from a backend and the files of an exported site
// (CONTRACT.md §16). Shared by the editor (export dialog: validation, archives) and the generated server (access
// rules, regenerating the static site with exactly the editor's engine):
//   planBackend(doc, target, opts) -> { items, needs, external, endpoints, collections, conflicts }
//   buildSite(doc, opts) -> { files: [{ path, data }], page, assets, collections }   (paths relative to the web root)
//   collectionJSON(doc, name, assets) -> the public snapshot data/<name>.json
//   readmeText(info) -> README.md of a backend archive
// target: 'html' (single file) | 'static' (serverless archive) | 'backend' (server) | 'hybrid' (server or static).
//
// Design rules of this module:
// - Single source of truth for "what the server must provide": the export dialog (editor-export.js), the archive
//   README and the running server (backend-server.js access rules) all call planBackend. If they derived their views
//   separately, the dialog could promise an endpoint the server refuses.
// - The plan is computed from a real render (renderInternal + finishUsage), not by scanning the document: only blocks
//   that actually render (not hidden, language / device permitting) count, and features (checkout, sync) are those
//   the page runtime will really include.
// - Pure: no I/O, no DOM. Runs in the browser and inside lib/site.mjs on the server.
import { isB64, b64decode } from '../codec/base64.js';
import { exportHTML } from '../doc/export.js';
import { normalizeDoc, walkBlocks } from '../doc/model.js';
import { BLOCK_TYPES } from '../doc/product.js';
import { finishUsage, renderInternal } from '../doc/render.js';
import { htmlToText, pickText } from '../i18n/text.js';
import { isObj, own, str } from '../util/value.js';
import { contentCollections, localParts, reqOf } from './viewer-backend.js';
import { normBase, siteRoutes } from './viewer-pages.js';
import { closedPages, publicView } from './viewer-access.js';
import { seoFiles } from './seo-site.js';

const TARGETS = ['html', 'static', 'backend', 'hybrid'];
const isBackend = (target) => target === 'backend' || target === 'hybrid';
const CHANNELS = ['mailto', 'whatsapp', 'telegram', 'link'];

// Fallback destination per channel (the form / chat / checkout rules): e-mail | phone digits | username | url | ''.
// Normalizes the fallback destination or returns '' (then the channel counts as missing). Deliberately strict: an
// address that would produce a broken mailto: / wa.me link is treated as absent, so the plan reports 'lost' instead
// of shipping a dead button. E.164 bounds (7-15 digits) for phone numbers.
function channelTo(kind, raw) {
  const v = str(raw).trim();
  if (kind === 'mailto') {
    const e = v.replace(/^mailto:/i, '').split('?')[0];
    return /^[^\s@<>"',;:?&#/]+@[^\s@<>"',;:?&#/]+\.[^\s@<>"',;:?&#/]{2,}$/.test(e) ? e : '';
  }
  if (kind === 'whatsapp') { const d = v.replace(/\D/g, ''); return d.length >= 7 && d.length <= 15 ? '+' + d : ''; }
  if (kind === 'telegram') { const m = /^(?:https?:\/\/)?(?:t\.me\/|telegram\.me\/)?@?([A-Za-z0-9_]{3,64})\/?$/.exec(v); return m ? '@' + m[1] : ''; }
  if (kind === 'link') return /^https?:\/\/[^\s]+$/i.test(v) ? v : '';
  return '';
}

// A configured request as the plan sees it: where it goes (browser storage or a server) and to which host.
// Placeholders are neutralized before URL parsing (same trick as the editor's validation) so templated hosts parse.
function reqInfo(doc, id) {
  const r = reqOf(doc, id);
  if (!r || !r.url) return null;
  const base = { id: r.id, name: r.name, method: r.method, url: r.url };
  const lp = localParts(r.url);
  if (lp) return { ...base, where: 'local', collection: lp.collection, key: lp.key };
  let host = '';
  if (/^https?:\/\//i.test(r.url)) { try { host = new URL(r.url.replace(/\{\w+\}/g, 'x')).host; } catch { host = ''; } }
  return { ...base, where: 'server', host: host || '' };
}

// A short human label of a block: its title / name / heading in the default language, else ''.
function blockTitle(doc, b) {
  for (const k of ['title', 'name', 'brand', 'text', 'caption']) {
    const v = isObj(b[k]) ? htmlToText(pickText(b[k], doc.defaultLang, doc)).trim() : '';
    if (v) return v.slice(0, 60);
  }
  return '';
}

/* ---------- plan ---------- */

// Everything of the page that sends data, how it gets there in the chosen export, what that needs.
// item = { key, kind: 'chat' | 'form' | 'checkout' | 'sync', block, type, label, reqs: [reqInfo], channel: {kind, to} | null,
//          status: 'external' | 'channel' | 'browser' | 'backend' | 'need' | 'lost' }
//   external: talks to a server of its own (http request); channel: e-mail / WhatsApp / Telegram / a link;
//   browser: only this visitor's browser keeps the data (local: endpoint in a serverless export); backend: the
//   generated server answers; need: a chat without an external API in a serverless export; lost: nobody receives it.
// needs: items to configure before a serverless export (+ 'lost' items in every export); external: items that talk to
// third parties; endpoints / collections: what the generated server provides (backend targets).
// Status decision order matters: an external request wins (data leaves to a third party regardless of target); then
// live blocks (chat) need a server; then local endpoints are served by our server or stay in the browser; last, a
// fallback channel or nothing. 'browser' is a need only without a backend: a visitor's localStorage reaches nobody.
function planBackend(doc, target = 'html', opts = {}) {
  const d = normalizeDoc(doc);
  const tg = TARGETS.includes(target) ? target : 'html';
  const backend = isBackend(tg);
  const api = backend ? { mode: tg === 'backend' ? 'server' : 'auto' } : null;
  const { ctx } = renderInternal(d, { mode: 'view', langs: opts.langs, defaultLang: opts.defaultLang, api });
  const use = finishUsage(ctx);
  const F = use.features;
  const items = [];
  const chats = use.chats instanceof Map ? use.chats : new Map();

  // Blocks with request fields (forms, chats, any future block that sends data): reqs, fallback channel.
  walkBlocks(d, (b) => {
    const t = own(BLOCK_TYPES, b.type);
    if (!t || !ctx.rendered.has(b.id)) return;
    const fields = (Array.isArray(t.schema) ? t.schema : []).filter((f) => isObj(f) && f.type === 'req');
    if (!fields.length) return;
    const reqs = fields.map((f) => reqInfo(d, b[f.key])).filter(Boolean);
    const fb = typeof b.fallback === 'string' ? b.fallback : '';
    const to = CHANNELS.includes(fb) ? channelTo(fb, b.to) : '';
    const live = !!t.live;
    const ext = reqs.some((r) => r.where === 'server');
    const local = reqs.some((r) => r.where === 'local');
    let status;
    if (ext) status = 'external';
    else if (live) status = backend ? 'backend' : 'need';
    else if (local) status = backend ? 'backend' : 'browser';
    else status = to ? 'channel' : 'lost';
    const it = { key: 'b:' + b.id, kind: b.type === 'chat' ? 'chat' : b.type === 'form' ? 'form' : 'block', block: b.id, type: b.type,
      label: blockTitle(d, b), reqs, channel: to ? { kind: fb, to } : null, status };
    if (live && chats.has(b.id)) it.chat = chats.get(b.id).m; // 'ext' | 'api' | 'msg'
    items.push(it);
  });

  // Checkout and cart sync (site settings) when the page sells something.
  const shop = d.shop;
  if (F.has('checkout')) {
    const co = shop.checkout;
    const fbTo = CHANNELS.includes(co.fallback) ? channelTo(co.fallback, co.fallback === 'mailto' ? co.email : co.fallback === 'whatsapp' ? co.phone : co.telegram) : '';
    if (co.method === 'request') {
      const r = reqInfo(d, co.req);
      const status = !r ? (fbTo ? 'channel' : 'lost') : r.where === 'server' ? 'external' : backend ? 'backend' : 'browser';
      items.push({ key: 'checkout', kind: 'checkout', block: null, type: '', label: '', reqs: r ? [r] : [], channel: fbTo ? { kind: co.fallback, to: fbTo } : null, status });
    } else {
      const to = channelTo(co.method, co.method === 'mailto' ? co.email : co.method === 'whatsapp' ? co.phone : co.method === 'telegram' ? co.telegram : co.url);
      items.push({ key: 'checkout', kind: 'checkout', block: null, type: '', label: '', reqs: [], channel: to ? { kind: co.method, to } : null, status: to ? 'channel' : 'lost' });
    }
  }
  if (F.has('sync')) {
    const reqs = [reqInfo(d, shop.loadReq), reqInfo(d, shop.saveReq)].filter(Boolean);
    const status = reqs.some((r) => r.where === 'server') ? 'external' : backend ? 'backend' : 'browser';
    items.push({ key: 'sync', kind: 'sync', block: null, type: '', label: '', reqs, channel: null, status });
  }

  const needs = items.filter((it) => it.status === 'lost' || (!backend && (it.status === 'need' || it.status === 'browser')));
  // External = anything that sends visitor data off this site (third-party servers or messaging channels), listed so
  // the user can review privacy implications before exporting.
  const external = items.filter((it) => it.status === 'external' || it.status === 'channel' || (it.channel && it.status !== 'lost'));

  // Collections and endpoints the generated server provides (it derives its access rules from the same plan).
  const collections = {};
  // One collection may be used by several items; access flags accumulate (keyed / get / post) and the server grants
  // exactly these. A GET without a key is recorded as 'denied': listing private data is never offered to visitors.
  const col = (name, kind) => (collections[name] || (collections[name] = { name, kind, post: false, keyed: false, get: false, uses: [] }));
  const endpoints = [];
  const conflicts = contentCollections(d).conflicts.map((c) => ({ ...c, reason: 'type' }));
  if (backend) {
    for (const it of items) {
      if (it.status !== 'backend') continue;
      for (const r of it.reqs) {
        if (r.where !== 'local') continue;
        const c = col(r.collection, it.kind === 'sync' ? 'carts' : it.kind === 'checkout' ? 'orders' : 'inbox');
        c.uses.push(it.key);
        if (r.key) c.keyed = true;
        else if (r.method === 'GET') c.get = true;
        else c.post = true;
      }
    }
    if (items.some((it) => it.kind === 'chat' && it.status === 'backend')) col('chat', 'chat').uses.push('chat');
    for (const [name, c] of contentCollections(d).collections) {
      // Every bound list that is not hidden, even while it has nothing to show (the admin console fills it).
      if (!c.shown) continue;
      // A content collection name already used by a private one is a conflict, not a merge: public snapshots of private
      // data would leak it.
      if (collections[name]) { conflicts.push({ name, block: c.blocks[0], type: c.type, reason: 'request' }); continue; }
      const x = col(name, 'content');
      x.type = c.type;
      x.blocks = c.blocks.slice();
      x.get = true;
    }
    endpoints.push({ method: 'GET', path: 'api/_ping', what: 'ping' });
    for (const c of Object.values(collections)) {
      if (c.kind === 'chat') {
        endpoints.push({ method: 'POST', path: 'api/chat', what: 'chat' }, { method: 'GET', path: 'api/chat/{conv}', what: 'chat-poll' });
      } else if (c.kind === 'content') {
        endpoints.push({ method: 'GET', path: `data/${c.name}.json`, what: 'content', collection: c.name }, { method: 'GET', path: `api/${c.name}`, what: 'content', collection: c.name });
      } else {
        if (c.post) endpoints.push({ method: 'POST', path: `api/${c.name}`, what: c.kind, collection: c.name });
        if (c.keyed) endpoints.push({ method: 'GET PUT', path: `api/${c.name}/{key}`, what: c.kind, collection: c.name });
        if (c.get) endpoints.push({ method: 'GET', path: `api/${c.name}`, what: 'denied', collection: c.name });
      }
    }
    endpoints.push({ method: 'GET', path: 'admin/', what: 'admin' });
  }
  return { target: tg, backend, items, needs, external, endpoints, collections, conflicts, features: [...F] };
}

/* ---------- site files ---------- */

const EXT_OF = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg',
  'image/x-icon': 'ico', 'application/pdf': 'pdf', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/webm': 'weba',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/ogg': 'ogv', 'text/plain': 'txt', 'font/woff2': 'woff2', 'font/woff': 'woff' };

// assets/<id>-<name>.<ext> for every attachment with data: lowercase ASCII, unique by id.
// The id prefix guarantees uniqueness; the readable stem is ASCII-folded (NFKD then strip) for hosts and file systems
// that mishandle non-ASCII names. The original extension wins over the MIME map, 'bin' if neither is known.
function assetNames(doc) {
  const out = new Map();
  for (const [id, a] of Object.entries(doc.attachments || {})) {
    if (!isObj(a) || !isB64(a.data)) continue;
    const name = str(a.name).toLowerCase();
    const m = /\.([a-z0-9]{1,6})$/.exec(name);
    const ext = m ? m[1] : own(EXT_OF, str(a.mime).split(';')[0]) || 'bin';
    const stem = (m ? name.slice(0, -m[0].length) : name).normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'file';
    out.set(id, `assets/${id}-${stem}.${ext}`);
  }
  return out;
}

// Attachment ids referenced by the items of a collection (att fields of the item schema).
function itemAtts(type, items) {
  const t = own(BLOCK_TYPES, type);
  const keys = (t && Array.isArray(t.itemSchema) ? t.itemSchema : []).filter((f) => isObj(f) && f.type === 'att').map((f) => f.key);
  const ids = new Set();
  for (const it of Array.isArray(items) ? items : []) for (const k of keys) if (isObj(it) && typeof it[k] === 'string' && it[k]) ids.add(it[k]);
  return ids;
}

// Public snapshot data/<name>.json of a content collection (static hosting reads it; so can other tools).
// `files` maps attachment ids to published asset paths, so a static page can resolve item files without the server.
function collectionJSON(doc, name, assets) {
  const c = contentCollections(doc).collections.get(name);
  if (!c) return null;
  const files = {};
  for (const id of itemAtts(c.type, c.items)) if (assets && assets.has(id)) files[id] = assets.get(id);
  return {
    collection: name, type: c.type, updatedAt: str(doc.meta && doc.meta.modified) || '',
    langs: doc.langs, defaultLang: doc.defaultLang, items: c.items, files,
  };
}

const bytesOf = (b64) => b64decode(b64);

// Relative prefix for a page at depth n: links between files stay relative, so the site works under any base path
// (project pages /<repo>/) and from file://.
const up = (n) => '../'.repeat(Math.max(0, n));

// The files of an exported site, relative to its web root (CONTRACT.md §16, §18): index.html (the home page), one
// <slug>/index.html per other page (prerendered: works without JavaScript, links between the files are relative),
// 404.html (every page with path routes: hosts serve it for unknown addresses, it shows the matching page — also pages
// without a file — or the "Not found" page), assets/… (attachments as files, optionally the stylesheet and script
// shared by every page), data/<collection>.json (backend targets). opts = { target, langs, defaultLang, minify,
// mode: 'clean' | 'packed', embedSource, source, split (CSS and script as files), virtual (no page files: index.html
// and 404.html both carry every page) }. Result: { files, page (export of index.html), pages (paths of the page
// files), assets, collections, doc }.
async function buildSite(doc, opts = {}) {
  const full = normalizeDoc(doc);
  const tg = TARGETS.includes(opts.target) ? opts.target : 'static';
  // Closed sections (viewer-access.js): the public files never carry their content; backend sites get them as
  // private files (private/<slug>/index.html) that the server hands out to accounts allowed to open them.
  // Public files are always built from the public view: closed content never reaches public/. Backend targets get a
  // sign-in prompt in its place, static targets a plain note.
  const d = closedPages(full).length ? normalizeDoc(publicView(full, { signin: isBackend(tg) })) : full;
  const names = assetNames(d);
  const R = siteRoutes(d);
  const virtual = !!opts.virtual && !R.legacy;
  const api = isBackend(tg) ? { mode: tg === 'backend' ? 'server' : 'auto', base: '' } : null;
  const base = normBase(d.output && d.output.basePath);
  const common = { mode: opts.mode === 'packed' ? 'packed' : 'clean', minify: opts.minify !== false, langs: opts.langs, defaultLang: opts.defaultLang };
  const assetsAt = (depth) => (a) => (a && names.has(a.id) ? up(depth) + names.get(a.id) : '');
  const split = opts.split ? { css: 'assets/site.css', js: 'assets/site.js' } : null;
  const files = [];
  const pages = [];
  const used = new Set();
  // 404.html: every page, path routes under the detected (or configured) base path; assets resolve against <base>.
  // The 404.html router is exported first: it contains every page, so its CSS / JS is a superset that can be shared.
  const spa = R.legacy ? null : await exportHTML(d, { ...common, assetURL: assetsAt(0), files: split, api: api && { ...api, base: '' }, route: { mode: 'spa', base } });
  // Split CSS / script: the 404.html's (a superset: it holds every page); a page needing more inlines its own.
  // A page may link the shared site.css / site.js only if every block type, feature and variant it needs is in the
  // router's bundle; otherwise it keeps its own inline copy (correctness over byte savings).
  const covers = (r) => !!spa && ['types', 'features', 'variants'].every((k) => (r[k] || []).every((x) => (spa.report[k] || []).includes(x)));
  const linkShared = async (res, depth, again) => {
    if (!split || !spa || !covers(res.report)) return res;
    return again({ css: up(depth) + 'assets/site.css', js: res.report.jsBytes ? up(depth) + 'assets/site.js' : '' });
  };
  // index.html: the home page as a file (virtual: the router document again; old single-page documents: the page).
  const indexOpts = { ...common, embedSource: !!opts.embedSource, source: opts.source || d, assetURL: assetsAt(0), api };
  let page;
  if (R.legacy) page = await exportHTML(d, { ...indexOpts, files: split });
  else if (virtual) page = await exportHTML(d, { ...indexOpts, files: split, route: { mode: 'spa', base, index: true } });
  else {
    const o = { ...indexOpts, route: { mode: 'file', page: R.home && R.home.id } };
    page = await linkShared(await exportHTML(d, o), 0, (f) => exportHTML(d, { ...o, files: f }));
  }
  files.push({ path: 'index.html', data: page.html });
  for (const id of page.report.atts || []) used.add(id);
  pages.push('index.html');
  if (!R.legacy && !virtual) {
    for (const e of R.list) {
      if (e.home) continue;
      const depth = e.slug.split('/').length;
      const o = { ...common, assetURL: assetsAt(depth), api: api && { ...api, base: up(depth) }, route: { mode: 'file', page: e.id } };
      let res = await exportHTML(d, o);
      if (split && spa) res = await linkShared(res, depth, (f) => exportHTML(d, { ...o, files: f }));
      const p = e.slug + '/index.html';
      files.push({ path: p, data: res.html });
      pages.push(p);
      for (const id of res.report.atts || []) used.add(id);
    }
  }
  // Closed pages rendered from the full document (with content), marked private, at the same depth as their public
  // address so relative asset links still resolve when the server serves them at that address.
  if (isBackend(tg) && !R.legacy) {
    const RF = siteRoutes(full);
    for (const p of closedPages(full)) {
      const e = RF.list.find((x) => x.id === p.id);
      if (!e) continue;
      const depth = e.home ? 0 : e.slug.split('/').length;
      const res = await exportHTML(full, { ...common, assetURL: assetsAt(depth), api: { ...api, base: up(depth) }, route: { mode: 'file', page: e.id } });
      files.push({ path: 'private/' + (e.home ? '' : e.slug + '/') + 'index.html', data: res.html, private: true });
      for (const id of res.report.atts || []) used.add(id);
    }
  }
  if (spa) {
    files.push({ path: '404.html', data: spa.html });
    pages.push('404.html');
    for (const id of spa.report.atts || []) used.add(id);
  }
  // sitemap.xml, robots.txt, llms.txt… (seo-site.js) when the site's address is known.
  // SEO files come from the full doc but seo-site.js itself decides what to list; files already produced win on path
  // collision.
  for (const f of seoFiles(full, { noAI: !!(full.meta && full.meta.seoNoAI) })) if (!files.some((x) => x.path === f.path)) files.push(f);
  const shared = spa || page;
  if (split && shared.css != null) files.push({ path: 'assets/site.css', data: shared.css });
  if (split && shared.js != null) files.push({ path: 'assets/site.js', data: shared.js });
  const collections = [];
  if (api) {
    for (const [name, c] of contentCollections(d).collections) {
      const json = collectionJSON(d, name, names);
      if (!json) continue;
      for (const id of itemAtts(c.type, c.items)) used.add(id);
      collections.push(name);
      files.push({ path: `data/${name}.json`, data: JSON.stringify(json, null, 1) + '\n' });
    }
  }
  // Only attachments actually referenced by some exported page or collection are written (`used`), sorted for a
  // deterministic archive; unused uploads do not bloat the package.
  const assets = new Map();
  for (const id of [...used].sort()) {
    const a = d.attachments[id];
    if (!a || !names.has(id)) continue;
    assets.set(id, names.get(id));
    files.push({ path: names.get(id), data: bytesOf(a.data) });
  }
  // doc: the whole document (closed sections included) — what a backend keeps in data/site.json.
  return { files, page, pages, assets, collections, doc: full };
}

/* ---------- README of a backend archive ---------- */

// info = { name, target, plan, created, editor (app name) }.
// Plain string assembly (no template engine): the README is part of the package contract, so its content is
// reviewed here line by line. Collection names are document data; they appear inside code spans only.
function readmeText(info) {
  const p = info.plan || { endpoints: [], collections: {} };
  const hybrid = info.target === 'hybrid';
  const cols = Object.values(p.collections || {});
  const priv = cols.filter((c) => c.kind !== 'content');
  const pub = cols.filter((c) => c.kind === 'content');
  const L = [];
  L.push(`# ${info.name || 'Landing'} — site with its backend`, '');
  L.push(`Exported by ${info.editor || 'Landing Builder'}${info.created ? ' on ' + info.created.slice(0, 10) : ''}. ` + (hybrid
    ? 'The page works **with this server** (forms, orders and the chat are stored here, content is edited in the admin console) **and without it** on any static host: then it shows the data of the last build, sends messages through the fallback channels of its blocks and the chat becomes "leave a message".'
    : 'The page talks to **this server**: forms, orders, cart sync and the chat are stored here, content is edited in the admin console.'), '');
  L.push('## Run', '', 'Node.js 20 or newer (or Bun / Deno); nothing to install:', '', '```sh', 'node server.mjs                # http://127.0.0.1:8080/',
    'node server.mjs --port 3000 --host 0.0.0.0', 'bun server.mjs', 'deno run --allow-net --allow-read --allow-write --allow-env server.mjs', '```', '');
  L.push('On the first start the server prints the **admin token** and keeps it in `data/.admin-token` (readable by the owner only). The admin console is at `/admin/`.', '');
  L.push('| environment variable | meaning |', '| --- | --- |',
    '| `PORT`, `HOST` | listen address (default 8080, 127.0.0.1; `--port`, `--host` win) |',
    '| `ADMIN_TOKEN` | admin token (at least 16 characters); otherwise the generated one in `data/.admin-token` |',
    '| `TRUST_PROXY=1` | behind a reverse proxy: take the client address from `X-Forwarded-For` (rate limits) |',
    '| `DATA_DIR` | where the data lives (default `./data`) |', '');
  L.push('## Files', '', '| path | contents |', '| --- | --- |',
    '| `server.mjs` | starts the server (`lib/site.mjs` holds the server, the admin console and the landing engine) |',
    '| `public/` | the static site the server serves (regenerated after content changes): `index.html`, one `<page>/index.html` per page, `404.html`, `assets/`, `data/<collection>.json` |',
    '| `data/site.json` | the page document — open it in the Landing Builder to edit the design, then export again |',
    '| `data/build.json` | export settings used when the server regenerates the site |',
    '| `data/collections/` | private data: form submissions, orders, carts, chat conversations (never under `public/`) |', '');
  if (priv.length || pub.length) {
    L.push('## Data', '');
    for (const c of priv) L.push(`- \`${c.name}\` — ${c.kind === 'chat' ? 'chat conversations' : c.kind === 'orders' ? 'orders (checkout)' : c.kind === 'carts' ? 'synced carts' : 'form submissions'} (private, \`data/collections/${c.name}.json\`)`);
    for (const c of pub) L.push(`- \`${c.name}\` — public content of the ${c.type} block, edited in the admin console (\`public/data/${c.name}.json\`)`);
    L.push('');
  }
  if ((p.endpoints || []).length) {
    L.push('## Endpoints', '', '| method | path | |', '| --- | --- | --- |');
    for (const e of p.endpoints) L.push(`| ${e.method} | \`/${e.path}\` | ${e.what}${e.collection ? ' `' + e.collection + '`' : ''} |`);
    L.push('', 'Admin API (`Authorization: Bearer <token>`): `/api/_admin/…` — inbox, export as CSV / JSON, delete, chat replies, content, uploads, rebuild, static snapshot, project file.', '');
  }
  L.push('## Pages', '', 'Every page of the site is a real file (`/about/` → `public/about/index.html`, rendered by the server from `data/site.json` with the editor\'s engine). Addresses that differ only in case, a `.html` ending or a missing trailing slash are redirected (301) to the page; any other unknown address gets the site\'s own "Not found" page (`public/404.html`) with status 404.', '');
  if (hybrid) {
    L.push('## Static hosting (Codeberg Pages, GitHub Pages, any web host)', '',
      'Upload the contents of `public/` — or download a fresh **static snapshot** from the admin console (Site → Static snapshot). Without the server the page detects that `api/` does not answer and switches to static mode: content comes from the files, forms use their fallback channel (e-mail, WhatsApp, Telegram) or the browser outbox, the chat becomes "leave a message". Run the server again at any time to collect data and edit content, then publish a new snapshot.', '',
      'Static hosts serve `404.html` for addresses they do not know (Codeberg Pages and GitHub Pages do this by themselves; elsewhere configure it as the error page). It finds the site\'s base path (`/<repository>/` on project sites), shows the page that matches the address — also variants in case or with `.html` — and otherwise the "Not found" page.', '');
  }
  L.push('## Security notes', '',
    '- Only the same origin may write (no CORS); per-address rate limits; JSON bodies up to 64 KB, uploads up to 10 MB; only the collections the page uses exist.',
    '- Private collections are stored in `data/collections/` and are never written under `public/`; back up `data/`.',
    '- Keep the admin token secret; serve the site over HTTPS (a reverse proxy such as Caddy or nginx) when it is public.',
    '- Request URLs and headers configured in the editor are public in the page; never put secrets there.', '');
  return L.join('\n');
}

export {
  TARGETS,
  assetNames,
  blockTitle,
  buildSite,
  channelTo,
  collectionJSON,
  isBackend,
  itemAtts,
  planBackend,
  readmeText,
  reqInfo
};
