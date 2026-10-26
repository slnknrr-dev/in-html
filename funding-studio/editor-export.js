// funding-studio/editor-export.js - export packages of the funding editor (studio ED.exportModes) and the check before
// every download (ED.exportCheck):
//   html       one self-contained HTML file with every page (hash routes): the methods that work without a server
//   static     a ZIP for static hosting: index.html (home campaign) and <slug>/index.html per page
//   connected  one HTML file whose page talks to the backend at Server → URL (live figures, Stripe / PayPal / TBC
//              checkouts, crypto detection) and falls back to the methods without a server when it is unreachable
// The check lists campaigns whose donate blocks have no usable payment method in the chosen package.
import { writeZip } from '../zip/zip.js';
import { h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { openDialog, toast } from '../ui/overlays.js';
import { openDocTab } from '../studio/right.js';
import { exportHTML, livePages, methodReady, normalizeDoc, SERVER_METHODS } from './viewer.js';
import { buildSite } from './site.js';

// Package design: one engine (exportHTML / buildSite), three targets differing only in options - route mode (hash vs
// file) and whether an api base is set. The static ZIP's preview page is the home file of the same build, so what
// is previewed is byte-identical to what is downloaded.
const serverOf = (doc) => (doc.server && doc.server.url) || '';

async function staticPage(doc, opts) {
  const site = await buildSite(doc, { ...opts });
  const home = site.files[0];
  return { html: home ? home.data : '', bytes: home ? new TextEncoder().encode(home.data).length : 0, report: site.report };
}

async function staticBuild(doc, opts) {
  const site = await buildSite(doc, opts);
  const zip = await writeZip(site.files.map((f) => ({ name: f.name, data: f.data })));
  return new Blob([zip], { type: 'application/zip' });
}

const connectedOpts = (doc, opts) => ({ ...opts, api: { base: serverOf(normalizeDoc(doc)), site: doc.id } });

function info(doc, opts) {
  const d = normalizeDoc(doc);
  const box = h('div', { class: 'ed-bx' }, h('h3', { class: 'ed-report-h' }, t('xp.pages')));
  const ul = h('ul', { class: 'ed-bx-list' });
  for (const p of livePages(d)) ul.append(h('li', {}, iconEl(p.kind === 'thanks' ? 'star' : 'file'), ' ', (opts.target === 'static' ? '/' + p.slug + '/' : '#/' + p.slug) + ' — ' + (Object.values(p.title || {})[0] || p.slug)));
  box.append(ul);
  if (opts.target === 'connected') box.append(h('p', { class: 'ed-hint' }, serverOf(d) ? t('xp.connectedTo', { url: serverOf(d) }) : t('xp.noServer')));
  return Promise.resolve(box);
}

export const EXPORT_MODES = [
  { id: 'html', icon: 'file', label: 'xp.html', desc: 'xp.htmlD', info },
  { id: 'static', icon: 'folder', label: 'xp.static', desc: 'xp.staticD', ext: 'zip', packed: false, info, page: staticPage, build: staticBuild },
  {
    id: 'connected', icon: 'plug', label: 'xp.connected', desc: 'xp.connectedD', info,
    page: (doc, opts) => exportHTML(doc, connectedOpts(doc, opts)),
    build: async (doc, opts) => { const r = await exportHTML(doc, connectedOpts(doc, opts)); return new Blob([r.html], { type: 'text/html;charset=utf-8' }); },
  },
];

// Campaigns whose methods cannot work in the package: [{ page, methods }].
// "Has a donate block" is detected by searching the serialised block tree for '"type":"donate"' - a cheap deep search
// that cannot be fooled by user text (inside JSON strings the quotes are escaped as \"). A campaign without a donate
// block is not a problem (it may link to another page's form).
// Note: the returned objects carry only { page }; the `methods` mentioned above are not included.
export function payProblems(doc, target) {
  const d = normalizeDoc(doc);
  const out = [];
  for (const p of livePages(d)) {
    if (p.kind !== 'campaign') continue;
    const hasDonate = JSON.stringify(p.blocks).includes('"type":"donate"');
    if (!hasDonate) continue;
    const ok = p.methods.filter((m) => methodReady(d, m) || (target === 'connected' && (SERVER_METHODS.includes(m) || m === 'btc' || m === 'eth')));
    if (!ok.length) out.push({ page: p });
  }
  return out;
}

// Pre-download gate. Returns the doc to export, null to stop (user sent to the relevant settings tab), or false
// (dialog dismissed). A connected export without a server URL is stopped outright: it would produce a page whose
// server features can never work. Payment gaps only warn - exporting "as is" stays the owner's decision.
export async function exportCheck(doc, opts) {
  const d = normalizeDoc(doc);
  if (opts.target === 'connected' && !serverOf(d)) {
    toast(t('xp.noServer'), 'warn');
    openDocTab('server');
    return null;
  }
  const probs = payProblems(doc, opts.target);
  if (!probs.length) return doc;
  const v = await openDialog({
    title: t('xp.checkT'),
    body: h('div', { class: 'ed-bx' }, h('p', {}, t('xp.checkIntro')),
      h('ul', { class: 'ed-bx-list' }, probs.map((x) => h('li', {}, iconEl('warn'), ' ', Object.values(x.page.title || {})[0] || x.page.slug)))),
    buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('xp.asIs'), value: 'asis' }, { label: t('xp.configure'), value: 'cfg', primary: true }],
  });
  if (v === 'asis') return doc;
  if (v === 'cfg') { openDocTab('payments'); return null; }
  return false;
}
