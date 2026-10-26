// site-studio/editor-export.js - the export packages of a site (studio ED.exportModes, CONTRACT-site.md §16):
//   html     offline: one HTML file (every page, hash routes; optionally also uploaded as 404.html)
//   static   serverless: prerendered pages + 404.html (or only index.html + 404.html), any static host
//   backend  backend with the content editor: server.mjs + the admin console (inbox, chat, content collections,
//            accounts); option "fallback": the page also runs on plain static hosting (target 'hybrid')
//   studio   backend with the constructor: as backend + the site editor itself at /_studio/ (studio/index.html)
// Closed sections (viewer-access.js) reach only backend packages; the others export the public view of the site.
// the check before every export (ED.exportCheck): parts of the page that need configuration (a chat without an API,
// data that would stay in the visitor's browser or reach nobody) → Configure / Export without these blocks / Cancel
// (+ Export as is when every such part still works inside the visitor's browser; a chat without an API never does),
// then external services and the server's endpoints → Continue / Cancel; and the report section of each package.
//
// Design rules of this module:
// - The check is a pipeline of gates, each may stop the export: pages / links -> parts needing configuration ->
//   external services / server summary -> silent policy fixes (451 sources, closed pages). Cheapest and most likely
//   problems first, so the user fixes addresses before reading a server endpoint table.
// - exportCheck never mutates the project: "export without these blocks" and the public view work on copies
//   (withoutItems clones, publicView returns new data). The exported document may differ from the edited one; the
//   edited one is never silently changed by an export.
// - Return contract of exportCheck (studio ED.exportCheck): a document = proceed with it; false = stay in the export
//   dialog; null = the user went to fix something (the export dialog closes). Two "no" values because closing the
//   dialog under a user who pressed Cancel would be hostile, while keeping it open after "Configure" would hide the
//   canvas they were sent to.
// - Planning (what needs a server, which endpoints, which collections) lives in backend-site.js planBackend(), shared
//   with the backend build itself, so the dialog describes exactly what the archive will contain.
import { decompress } from '../codec/deflate.js';
import { writeZip } from '../zip/zip.js';
import { clone, h } from '../ui/dom.js';
import { fmtBytes } from '../ui/files.js';
import { iconEl } from '../ui/icons.js';
import { ED_I18N, t } from '../ui/i18n.js';
import { openDialog, toast } from '../ui/overlays.js';
import { S } from '../studio/state.js';
import { blockLabel, findBlock, walk } from '../studio/doc.js';
import { select } from '../studio/select.js';
import { openDocTab } from '../studio/right.js';
import { BLOCK_TYPES } from './viewer.js';
import { archiveFiles } from './backend-archive.js';
import { assetNames, buildSite, isBackend, planBackend } from './backend-site.js';
import { openRequestsTab } from './editor-requests.js';
import { pagesCheck } from './editor-pages.js';
import { siteRoutes } from './viewer-pages.js';
import { httpFetch } from './net.js';
import { closedPages, publicView } from './viewer-access.js';
import { normalizeDoc } from '../doc/model.js';
import { selfHTML } from './self.js';

// The server and engine of backend archives: bundle.js inlines this as a gzip-compressed module bundle (the
// development server answers the same URL); a copy without it (multi-file deployment) cannot build backend archives.
// `?bundle` is a build-time marker, not a runtime query: bundle.js replaces this URL with an inline data payload, the
// dev server serves the same bundle on request. The gzip magic check (1f 8b) catches the multi-file deployment case,
// where a static host answers 200 with an HTML 404 page or the raw source instead of the bundle.
// engineP memoizes the promise (one download for many exports); on failure it is reset so a retry can succeed.
const ENGINE_URL = new URL('./backend-engine.js?bundle', import.meta.url);
let engineP = null;
function engineText() {
  if (!engineP) {
    engineP = (async () => {
      const r = await httpFetch(ENGINE_URL);
      if (!r.ok) throw new Error(t('bx.noEngine'));
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new Error(t('bx.noEngine'));
      return new TextDecoder().decode(await decompress(bytes, 'gzip'));
    })();
    engineP.catch(() => { engineP = null; });
  }
  return engineP;
}

// Package id → build target ('studio' builds a backend site; the fallback switch makes it 'hybrid').
// 'studio' is not a build target of its own: it is a backend build plus the editor page; 'fallback' upgrades either
// backend kind to 'hybrid' (the static pages work without the server too).
const targetOf = (opts) => {
  const id = opts && opts.target;
  if (id === 'backend' || id === 'studio' || id === 'hybrid') return id === 'hybrid' || (opts.extra && opts.extra.fallback) ? 'hybrid' : 'backend';
  return id === 'static' ? 'static' : 'html';
};
const siteOpts = (opts) => ({
  langs: opts.langs, defaultLang: opts.defaultLang, minify: opts.minify, mode: opts.mode, embedSource: !!opts.embedSource,
  source: opts.source, split: !!(opts.extra && opts.extra.split), virtual: !!(opts.extra && opts.extra.virtual),
});

// Editor labels the admin console shows for the content collections' fields, options and block types.
// The admin console runs on the server without the editor's i18n tables, so the labels it needs are resolved now in
// the editor's UI language and shipped with the archive. hasOwnProperty, not `in`: keys like 'constructor' exist on
// Object.prototype.
function adminLabels(doc) {
  const out = {};
  const put = (k) => { if (k && !Object.prototype.hasOwnProperty.call(out, k)) out[k] = t(k); };
  walk((b) => {
    if (typeof b.source !== 'string' || !b.source) return;
    const tp = BLOCK_TYPES[b.type];
    if (!tp) return;
    put('b.' + b.type);
    for (const f of tp.itemSchema || []) {
      if (!f || !f.key) continue;
      put(f.label || 'f.' + f.key);
      if (f.hint) put(f.hint);
      for (const o of f.options || []) put(o.l || 'o.' + o.v);
    }
    for (const k of [...(tp.itemI18nFields || []), ...Object.keys(tp.itemRichFields || {})]) put('f.' + k);
  }, doc);
  return out;
}

/* ---------- labels of plan items ---------- */

// Block names are capped at 50 chars: a long rich-text label would blow up the dialog row.
function itemName(it) {
  if (it.kind === 'checkout') return t('bx.k.checkout');
  if (it.kind === 'sync') return t('bx.k.sync');
  const fb = it.block && findBlock(it.block);
  const name = (fb && blockLabel(fb.block)) || it.label;
  return t('b.' + it.type) + (name ? ` “${name.slice(0, 50)}”` : '');
}
function itemProblem(it) {
  const local = it.reqs.find((r) => r.where === 'local');
  if (it.kind === 'sync') return t('bx.need.sync', { url: local ? local.url : '' });
  if (it.status === 'need') return t('bx.need.need');
  if (it.status === 'browser') return t('bx.need.browser', { url: local ? local.url : 'local:' });
  return t('bx.need.lost');
}
function targetsOf(it) {
  const out = [];
  for (const r of it.reqs) if (r.where === 'server') out.push(`${r.method} ${r.host || t('bx.sameSite')}`);
  if (it.channel) out.push(t('bx.ch.' + it.channel.kind, { to: it.channel.to }));
  return out;
}

/* ---------- the check before an export ---------- */

// "Configure": the block on the canvas and Site → Requests (with its request), or Site → Shop.
// tab: false keeps the right panel on the Requests tab opened next, instead of switching to the block inspector.
function configure(it) {
  if (it.kind === 'checkout' || it.kind === 'sync') {
    openDocTab('shop');
    toast(t('bx.cfg.shop'), 'info');
    return;
  }
  if (it.block) select(it.block, null, { scroll: true, tab: false });
  openRequestsTab((it.reqs[0] && it.reqs[0].id) || null);
  toast(t(it.status === 'need' ? 'bx.cfg.chat' : 'bx.cfg.req'), 'info', null, { sticky: false });
}

// A copy of the document without the listed parts (the project itself keeps them).
// Two passes (collect, then splice) because removing from a list while walk() iterates it would skip siblings.
// Checkout / sync have no block: they are disabled by switching the shop mode to the browser-only variant.
function withoutItems(doc, items) {
  const d = clone(doc);
  const drop = new Set(items.filter((it) => it.block).map((it) => it.block));
  const gone = [];
  walk((b, list) => { if (drop.has(b.id)) gone.push([list, b]); }, d);
  for (const [list, b] of gone) { const i = list.indexOf(b); if (i >= 0) list.splice(i, 1); }
  if (items.some((it) => it.kind === 'checkout')) d.shop.checkout.method = 'none';
  if (items.some((it) => it.kind === 'sync')) d.shop.sync = 'local';
  return d;
}

// Parts that still work inside the visitor's browser (data kept there): the page may be exported as is.
// "Export as is" is offered only if every flagged part degrades to browser-local storage; a part with status 'need'
// (e.g. a chat with no API) would be dead on the site, so its presence removes the option.
const worksLocally = (it) => it.kind === 'sync' || it.status === 'browser';

// Same hidden-button technique as editor-pages.js pagesCheck: per-row buttons record the chosen item, then click the
// dialog's own "configure" button (onClick returning true lets it resolve) so openDialog stays the only resolver.
function needsDialog(plan) {
  let chosen = null;
  const asIs = plan.needs.every(worksLocally);
  const rows = plan.needs.map((it) => h('li', { class: 'ed-bx-row' },
    h('span', { class: 'ed-bx-ic' }, iconEl('warn')),
    h('span', { class: 'ed-bx-txt' }, h('strong', {}, itemName(it)), ' — ', itemProblem(it)),
    h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: (e) => { chosen = it; e.currentTarget.closest('.ed-dialog').querySelector('[data-bx-cfg]')?.click(); } }, t('bx.configure'))));
  const body = h('div', { class: 'ed-bx' },
    h('p', {}, t(plan.backend ? 'bx.needIntroB' : 'bx.needIntro')),
    h('ul', { class: 'ed-bx-list' }, rows),
    h('p', { class: 'ed-hint' }, t('bx.needHint')));
  return openDialog({
    title: t('bx.needT'), body, className: 'ed-dlg-bx ed-dlg-bx-need',
    buttons: [
      { label: t('dlg.cancel'), value: null },
      ...(asIs ? [{ label: t('bx.asIs'), value: 'asis' }] : []),
      { label: t('bx.without'), value: 'without' },
      { label: t('bx.configure'), value: 'configure', primary: true, className: 'ed-bx-cfg', onClick: () => true },
    ],
    onMount: ({ el }) => { const b = el.querySelector('.ed-bx-cfg'); if (b) b.setAttribute('data-bx-cfg', ''); },
  }).then((v) => (v === 'configure' ? { action: 'configure', item: chosen || plan.needs[0] } : v === 'without' ? { action: 'without' }
    : v === 'asis' ? { action: 'asis' } : null));
}

// External services (every package) and what the generated server provides (backend packages).
function summaryBody(plan) {
  const box = h('div', { class: 'ed-bx' });
  if (plan.external.length) {
    box.append(h('h3', { class: 'ed-bx-h' }, t('bx.extT')), h('p', { class: 'ed-muted' }, t('bx.extIntro')),
      h('ul', { class: 'ed-bx-list' }, plan.external.map((it) => h('li', { class: 'ed-bx-row' },
        h('span', { class: 'ed-bx-ic' }, iconEl('globe')),
        h('span', { class: 'ed-bx-txt' }, h('strong', {}, itemName(it)), ' → ', targetsOf(it).join(', '))))));
  }
  if (plan.backend) {
    // (The dialog's title names this section.)
    box.append(h('p', { class: 'ed-muted' }, t('bx.srvIntro')),
      h('table', { class: 'ed-bx-eps' }, h('tbody', {}, plan.endpoints.map((e) => h('tr', {},
        h('td', { class: 'ed-mono' }, e.method), h('td', { class: 'ed-mono' }, '/' + e.path),
        h('td', {}, t('bx.ep.' + e.what)))))));
    const cols = Object.values(plan.collections);
    if (cols.length) {
      box.append(h('h3', { class: 'ed-bx-h' }, t('bx.cols')), h('ul', { class: 'ed-bx-cols' }, cols.map((c) => h('li', {},
        c.kind === 'content' ? t('bx.colPublic', { name: c.name, type: t('b.' + c.type) }) : t('bx.colPrivate', { name: c.name })))));
    }
    if (plan.target === 'hybrid') box.append(h('p', { class: 'ed-hint' }, t('bx.srvHybrid')));
  }
  for (const c of plan.conflicts) box.append(h('p', { class: 'ed-hint ed-hint-warn' }, t(c.reason === 'request' ? 'bx.conflictReq' : 'bx.conflict', { name: c.name, type: t('b.' + c.type) })));
  return box;
}

async function exportCheck(doc, opts) {
  const target = targetOf(opts);
  // Pages and links first (addresses, unreachable pages, links that lead nowhere; editor-pages.js).
  const pc = await pagesCheck(doc);
  if (pc !== true) return pc;
  let d = doc;
  let plan = planBackend(d, target, opts);
  if (plan.needs.length) {
    const v = await needsDialog(plan);
    if (!v) return false;
    if (v.action === 'configure') { configure(v.item); return null; }
    if (v.action === 'without') {
      d = withoutItems(doc, plan.needs);
      plan = planBackend(d, target, opts);
    }
  }
  if (plan.external.length || plan.backend || plan.conflicts.length) {
    const ok = await openDialog({
      title: t(plan.backend ? 'bx.srvT' : 'bx.extT'), body: summaryBody(plan), wide: plan.backend, className: 'ed-dlg-bx ed-dlg-bx-sum',
      buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('bx.continue'), value: 'go', primary: true }],
    });
    if (ok !== 'go') return false;
  }
  // 451 sections: the export carries their ciphertext only; the editable source (it holds the passwords) stays out.
  // Security policy, not a preference: the embedded editable source of a 451 section contains its password, so an export
  // that embedded it would publish the key next to the ciphertext. Forced off with a toast, never asked.
  let secret = false;
  walk((b) => { if (b.type === 'wk-secret' && b.password) secret = true; }, d);
  if (secret && opts && opts.embedSource) { opts.embedSource = false; toast(t('kb.secretOut'), 'info'); }
  // Closed sections stay out of packages without a server (their pages keep a note and the navigation entry).
  // Without a server there is nothing to enforce access, so closed pages must not be shipped at all (hiding them by CSS
  // or JS would still put the content in the file). publicView replaces their content with a note.
  if (!isBackend(target) && closedPages(normalizeDoc(d)).length) {
    toast(t('bx.closedOut', { n: closedPages(normalizeDoc(d)).length }), 'info');
    d = normalizeDoc(publicView(normalizeDoc(d), { signin: false, note: closedNote(d) }));
  }
  return d;
}

// The note a closed page shows outside backend sites, in the site's languages.
// Reads ED_I18N directly, not t(): t() answers in the editor's UI language, the note must be in each site language.
// The base subtag fallback (pt-BR -> pt) then English keeps the note non-empty for any language code.
function closedNote(d) {
  const out = {};
  for (const l of d.langs || ['en']) { const p = String(l).split('-')[0]; const x = (ED_I18N[p] && ED_I18N[p]['bx.closedNote']) || ED_I18N.en['bx.closedNote'] || ''; out[l] = '<p>' + x + '</p>'; }
  return out;
}

/* ---------- package report sections ---------- */

// Mirrors the file layout produced by backend-archive.js / backend-site.js; it is a description for the user, so a
// change there must be reflected here by hand (no shared table).
function layoutRows(target, doc, opts) {
  const names = assetNames(doc);
  const rows = [];
  const pre = isBackend(target) ? 'public/' : '';
  if (isBackend(target)) {
    rows.push(['server.mjs', t('bx.l.server')], ['lib/site.mjs', t('bx.l.lib')], [pre, t('bx.l.public')]);
    if (opts.target === 'studio') rows.push(['studio/index.html', t('bx.l.studio')]);
    if (closedPages(normalizeDoc(doc)).length) rows.push(['data/private/', t('bx.l.private', { n: closedPages(normalizeDoc(doc)).length })]);
  }
  rows.push([pre + 'index.html', t('bx.l.index')]);
  // Pages (CONTRACT.md §18): one folder per page (unless virtual) and the 404.html router.
  const R = siteRoutes(doc);
  if (!R.legacy) {
    const virtual = !isBackend(target) && opts.extra && opts.extra.virtual;
    const n = R.list.length - 1;
    if (n > 0 && !virtual) rows.push([pre + R.list.filter((e) => !e.home).slice(0, 3).map((e) => e.slug + '/index.html').join(', ') + (n > 3 ? ', …' : ''), t('bx.l.pages', { n })]);
    rows.push([pre + '404.html', t('bx.l.404')]);
  }
  if (opts.extra && opts.extra.split && !isBackend(target)) rows.push([pre + 'assets/site.css, site.js', t('bx.l.css')]);
  if (names.size) {
    let size = 0;
    for (const id of names.keys()) size += Number(doc.attachments[id].size) || 0;
    rows.push([pre + 'assets/', t('bx.l.assets', { n: names.size }) + ' · ' + fmtBytes(size)]);
  }
  if (isBackend(target)) rows.push(['data/site.json', t('bx.l.site')], ['data/build.json', t('bx.l.build')], ['README.md', t('bx.l.readme')]);
  return rows;
}

async function info(doc, opts) {
  const target = targetOf(opts);
  const plan = planBackend(doc, target, opts);
  const box = h('div', { class: 'ed-bx-info' });
  if (plan.needs.length) box.append(h('div', { class: 'ed-note ed-note-warn', role: 'note' }, iconEl('warn'), h('span', {}, t('bx.needCount', { n: plan.needs.length }))));
  if (target === 'html') {
    // The single file also deployed as 404.html: how to upload it.
    if (opts.extra && opts.extra.as404 && !siteRoutes(doc).legacy) box.append(h('div', { class: 'ed-note', role: 'note' }, iconEl('info'), h('span', {}, t('pg.info404'))));
    return box.childElementCount ? box : null;
  }
  box.append(h('h3', { class: 'ed-report-h' }, t('bx.layout')),
    h('dl', { class: 'ed-bx-files' }, layoutRows(target, doc, opts).flatMap(([k, v]) => [h('dt', { class: 'ed-mono' }, k), h('dd', {}, v)])));
  if (plan.backend) {
    box.append(h('h3', { class: 'ed-report-h' }, t('bx.srvT')),
      h('ul', { class: 'ed-bx-eps-s' }, plan.endpoints.map((e) => h('li', {}, h('code', {}, `${e.method} /${e.path}`), ' ', h('span', { class: 'ed-muted' }, t('bx.ep.' + e.what))))));
  }
  return box;
}

/* ---------- packages ---------- */

// The page of an archive for the live size report (index.html as the archive carries it).
// Builds the whole site to measure it: accurate archive size at the price of a full build per report refresh.
async function page(id, doc, opts) {
  const site = await buildSite(doc, { ...siteOpts(opts), target: targetOf({ ...opts, target: id }) });
  const bytes = site.files.reduce((n, f) => n + (typeof f.data === 'string' ? new TextEncoder().encode(f.data).length : f.data.length), 0);
  return { ...site.page, archiveBytes: bytes };
}

// The editor page for a constructor package: this very page in a single-file build, else a file the user picks (the
// single-file Site Studio, e.g. html@5_offline_singlefile/index.html).
// selfHTML() is non-null only in the single-file build (the page can serialize itself). Otherwise the user must supply
// that file; the regex test is a sanity check against picking an unrelated HTML file, not a security boundary.
// KNOWN DEFECT: if the user cancels the file picker no 'change' event fires, so the promise never settles and the
// export hangs in its busy state. Fix: also listen for the 'cancel' event (or a focus-return timeout) and reject.
function editorPage() {
  const own = selfHTML();
  if (own) return Promise.resolve(own);
  return new Promise((resolve, reject) => {
    const inp = h('input', { type: 'file', accept: '.html,text/html', hidden: true });
    inp.addEventListener('change', async () => {
      const file = inp.files && inp.files[0];
      inp.remove();
      if (!file) { reject(new Error(t('bx.noStudio'))); return; }
      const text = await file.text();
      if (!/<html/i.test(text) || !/defineEditor|ed-shell/.test(text)) { reject(new Error(t('bx.badStudio'))); return; }
      resolve(text);
    });
    document.body.append(inp);
    toast(t('bx.pickStudio'), 'info');
    inp.click();
  });
}

async function build(id, doc, opts) {
  const target = targetOf({ ...opts, target: id });
  const engine = isBackend(target) ? await engineText() : null;
  const studio = id === 'studio' ? await editorPage() : null;
  const files = await archiveFiles(doc, {
    ...siteOpts(opts), target, engine, labels: adminLabels(doc), editor: t('app.name'), created: new Date().toISOString(), studio,
  });
  const zip = await writeZip(files.map((f) => ({ name: f.name, data: f.data })));
  return new Blob([zip], { type: 'application/zip' });
}

// packed: false / source: false on backend packages: the server edits content online, so embedding the editor source
// or a packed single file would ship a second, divergent copy of the data.
const archive = (id, icon, extra = {}) => ({
  id, icon, ext: 'zip', label: 'bx.m.' + id, desc: 'bx.m.' + id + 'D',
  page: (doc, opts) => page(id, doc, opts), info, build: (doc, opts) => build(id, doc, opts), ...extra,
});

const FALLBACK = { key: 'fallback', label: 'bx.fallback', desc: 'bx.fallbackD' };
const EXPORT_MODES = [
  { id: 'html', icon: 'file', label: 'bx.m.html', desc: 'bx.m.htmlD', info, options: [{ key: 'as404', label: 'pg.as404', desc: 'pg.as404D' }] },
  archive('static', 'folder', { options: [{ key: 'split', label: 'bx.split', desc: 'bx.splitD' }, { key: 'virtual', label: 'pg.virtual', desc: 'pg.virtualD' }] }),
  archive('backend', 'store', { packed: false, source: false, options: [FALLBACK] }),
  archive('studio', 'layout', { packed: false, source: false, options: [FALLBACK] }),
];

export {
  EXPORT_MODES,
  adminLabels,
  engineText,
  exportCheck,
  withoutItems
};
