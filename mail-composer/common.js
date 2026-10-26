// mail-composer/common.js - shared parts of the compose, inspect and tools pages: the shell (pages resolved from the
// hidden anchors of the page HTML, so the build can rewrite them), app icons, a small IndexedDB store (the draft's
// files and the hand-over between pages), tabs, finding lists, the sandboxed HTML preview (srcdoc without scripts,
// a CSP that allows only data: images, cid: parts inlined, links and refresh disarmed) and the message inspector
// shared by the inspect page and the composer's structure view.
//
// Security posture: every message shown here may be hostile (inspected .eml files come from anywhere). HTML bodies
// are rendered only inside an iframe with an empty sandbox attribute (no scripts, no forms, no popups, opaque
// origin) plus a meta CSP that forbids every network fetch; text goes through textContent; the source view is a
// <pre> with textContent. No mail HTML ever touches the app's own DOM.
//
// Side-effect import first: strings.js registers the app's i18n keys before any t() call.
import './strings.js';
import { startApp, t } from '../ui/app.js';
import { h } from '../ui/dom.js';
import { addIcons, icon, iconEl } from '../ui/icons.js';
import { fmtBytes } from '../ui/files.js';
import { download } from '../ui/app.js';
import { b64encode } from '../codec/base64.js';
import { messageChecks } from './message.js';

export const LOGO = 'M3 6h18v12H3zM3 7l9 6 9-6';

addIcons({
  envelope: LOGO,
  inspect: 'M4 4h10l6 6v10H4zM14 4v6h6M9 14a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M13.5 16l2.5 2.5',
  tools: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  tree: 'M5 4v16M5 8h6M5 16h6M13 6h6v4h-6zM13 14h6v4h-6z',
  bold: 'M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z',
  italic: 'M10 4h8M6 20h8M14 4l-4 16',
  listOl: 'M10 6h11M10 12h11M10 18h11M4 4v4M3 18h3l-3 3h3M3 12a1.5 1.5 0 1 1 3 0l-3 3h3',
  zip: 'M6 3h9l5 5v13H6zM10 3v2M10 7v2M10 11v2M9 15h2v3H9z',
  merge: 'M4 6h6l4 6-4 6H4M14 12h6',
  ok: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 12l3 3 5-6',
});

// Resolved hrefs of the pages (hidden anchors in the page HTML; the build rewrites their href).
// getAttribute, not a.href: .href is absolute (file:///...), breaking relative links once published.
export function pageHref(id) {
  const a = document.getElementById(id);
  return a ? a.getAttribute('href') : '#';
}

export function startShell(current, onLang) {
  startApp({
    key: 'mc', name: 'mc.name', logo: LOGO, offline: true, onLang,
    pages: [
      { href: pageHref('pg-compose'), label: 'mc.page.compose', current: current === 'compose' },
      { href: pageHref('pg-inspect'), label: 'mc.page.inspect', current: current === 'inspect' },
      { href: pageHref('pg-tools'), label: 'mc.page.tools', current: current === 'tools' },
    ],
  });
}

// --- IndexedDB key-value store (memory when the browser refuses storage) ---------------------------------------

// Why IndexedDB and not localStorage: attachments are binary and can be megabytes; localStorage holds only strings
// (base64 inflates by 33%) within about 5 MB. MEM mirrors every write, so the app still works for the session when
// IndexedDB is unavailable (private mode in some browsers, blocked storage): db() then resolves to null.
const MEM = new Map();
let dbp = null;
// One connection promise, opened lazily; every failure path resolves (never rejects) so callers need no try/catch.
function db() {
  if (!dbp) {
    dbp = new Promise((resolve) => {
      try {
        const r = indexedDB.open('mail-composer', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(null);
        r.onblocked = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  return dbp;
}
// One request per transaction; errors resolve to undefined. If creating the transaction throws, the operation
// falls back to the memory map (fn(null)).
function tx(mode, fn) {
  return db().then((d) => new Promise((resolve) => {
    if (!d) { resolve(fn(null)); return; }
    try {
      const st = d.transaction('kv', mode).objectStore('kv');
      const req = fn(st);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch { resolve(fn(null)); }
  }));
}
export const idbGet = (k) => tx('readonly', (st) => (st ? st.get(k) : MEM.get(k)));
export const idbSet = (k, v) => tx('readwrite', (st) => { MEM.set(k, v); return st ? st.put(v, k) : undefined; });
export const idbDel = (k) => tx('readwrite', (st) => { MEM.delete(k); return st ? st.delete(k) : undefined; });

// --- small widgets ------------------------------------------------------------------------------------------------

let gid = 0;
// Session-unique ids for DOM / content ids (counter + random suffix); not used for anything security-relevant.
export const uid = (p = 'mc') => p + '-' + (++gid).toString(36) + Math.random().toString(36).slice(2, 6);

// Tab strip: items [{ k, l (key), icon? }]; arrow keys move between tabs; .set(k) repaints.
// WAI-ARIA tabs: roving tabindex (only the selected tab is tabbable), arrow keys move and activate.
export function tabs(items, current, onChange, label = '') {
  const bar = h('div', { class: 'mc-tabs', role: 'tablist', 'aria-label': label ? t(label) : null });
  const paint = (k) => { for (const b of bar.children) { const on = b.dataset.tab === k; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; b.classList.toggle('mc-on', on); } };
  for (const it of items) {
    bar.append(h('button', { type: 'button', role: 'tab', class: 'mc-tab', dataset: { tab: it.k }, onclick: () => { paint(it.k); onChange(it.k); } }, it.icon ? iconEl(it.icon) : null, h('span', {}, t(it.l))));
  }
  bar.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    const btns = [...bar.children];
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const b = btns[(i + step + btns.length) % btns.length];
    b.focus(); b.click();
  });
  paint(current);
  bar.set = paint;
  return bar;
}

// Findings [{ key, level, vars }] as a list; texts from `${prefix}${key}`.
export function findings(list, prefix) {
  const box = h('div', { class: 'mc-findings' });
  for (const f of list) {
    // role=alert only for errors, so warnings and infos do not interrupt screen-reader users.
    box.append(h('div', { class: 'mc-f mc-f-' + f.level, role: f.level === 'error' ? 'alert' : null }, iconEl(f.level === 'info' ? 'info' : 'warn'), h('span', {}, t(prefix + f.key, f.vars))));
  }
  return box;
}

export function kvRows(rows) {
  const dl = h('dl', { class: 'ap-kv mc-kv' });
  for (const [k, v] of rows) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    dl.append(h('dt', {}, t(k)), h('dd', {}, v));
  }
  return dl;
}

export const fmtSize = (n) => fmtBytes(n);
export const fmtDate = (ms) => (Number.isFinite(ms) ? new Date(ms).toLocaleString(document.documentElement.lang || 'en', { dateStyle: 'medium', timeStyle: 'short' }) : '');

// An address for display: name + address (or the masked address).
export function addrChip(a, cls = '') {
  return h('span', { class: 'mc-addr ' + cls }, a.name ? h('b', {}, a.name) : null, h('span', { class: 'mc-mono' }, a.address));
}

// --- sandboxed HTML preview -------------------------------------------------------------------------------------

// default-src 'none' blocks every fetch (tracking pixels, remote CSS, fonts, frames); only data: images and fonts and
// inline styles are allowed, which is what a self-contained e-mail needs. form-action 'none' disables forms.
const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; form-action 'none'";
/**
 * srcdoc of a message body: no scripts (sandbox), nothing loaded from the network (CSP: data: images only), cid:
 * images inlined as data: URLs from `parts` [{ cid, contentType, data }], link targets and meta refresh removed (a
 * sandbox without allow-popups cannot open new windows, so links stay inert). -> { doc, remote: count of blocked URLs }
 */
export function previewDoc(html, parts = []) {
  let remote = 0;
  let s = String(html || '')
    // Regex sanitising is NOT the security boundary here (the sandbox and CSP are); these replacements only improve the
    // preview: refresh redirects removed, link targets and ping trackers dropped, cid: images resolved.
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi, '')
    .replace(/(<a\b[^>]*?)\s(?:target|ping)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '$1')
    .replace(/(\b(?:src|background|poster)\s*=\s*["']?)cid:([^"'\s>]+)/gi, (m, pre, id) => {
      let cid = id; try { cid = decodeURIComponent(id); } catch { /* keep */ }
      const p = parts.find((x) => x.cid === cid || x.cid === id);
      // cid: references become data: URLs of the matching MIME part (images under 6 MB only); unresolved ones become an
      // empty data: URL, so the CSP never sees a cid: request it would report as blocked.
      return p && /^image\//.test(p.contentType || '') && p.data && p.data.length < 6e6 ? pre + 'data:' + p.contentType + ';base64,' + b64encode(p.data) : pre + 'data:,';
    });
  // Counting only (the replace result is discarded): how many remote resources the CSP will block, for the hint
  // "N remote images not loaded", a privacy signal (tracking pixels).
  s.replace(/\b(?:src|background|srcset)\s*=\s*["']?\s*(?:https?:)?\/\//gi, () => { remote++; return ''; });
  s.replace(/url\(\s*["']?\s*(?:https?:)?\/\//gi, () => { remote++; return ''; });
  return { doc: `<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="${CSP}"><base target="_blank">` + s, remote };
}

export function previewFrame(doc, title) {
  // sandbox="" = every restriction on. referrerpolicy no-referrer as extra insurance; loading=lazy for long pages.
  return h('iframe', { class: 'mc-frame', sandbox: '', srcdoc: doc, title: title || t('mc.i.htmlBody'), referrerpolicy: 'no-referrer', loading: 'lazy' });
}

// --- the inspector ------------------------------------------------------------------------------------------------

// Very large sources are cut for display (rendering a multi-MB <pre> freezes the page); "show all" on demand.
const RAW_MAX = 200000;

function partLabel(p) {
  const bits = [p.type];
  if (p.params && p.params.charset) bits.push(p.params.charset);
  const cte = (p.headers.find((x) => x.name.toLowerCase() === 'content-transfer-encoding') || {}).value;
  if (cte) bits.push(cte.toLowerCase());
  if (p.disposition) bits.push(p.disposition);
  return bits.join(' · ');
}

function partName(p, i) { return p.filename || (p.cid ? p.cid : '') || `part-${i}`; }

// Recursive MIME tree; a shared counter numbers parts in document order for default file names.
function treeView(p, depth = 0, counter = { n: 0 }) {
  const li = h('li', { class: 'mc-tnode' });
  const n = ++counter.n;
  const head = h('div', { class: 'mc-tnode-h' }, h('code', { class: 'mc-mono mc-ttype' }, partLabel(p)));
  if (p.filename) head.append(h('span', { class: 'mc-tname' }, p.filename));
  if (p.cid) head.append(h('span', { class: 'mc-chip' }, 'cid:' + p.cid));
  if (p.data) {
    head.append(h('span', { class: 'mc-tsize' }, fmtSize(p.data.length)));
    const b = h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('mc.i.savePart'), 'aria-label': t('mc.i.savePart') + ' ' + partName(p, n), html: icon('download'), onclick: () => download(p.data, partName(p, n), p.type || 'application/octet-stream') });
    head.append(b);
  }
  if (p.parts && p.params.boundary) head.append(h('span', { class: 'mc-tbound mc-mono' }, 'boundary=' + p.params.boundary));
  li.append(head);
  if (p.parts) li.append(h('ul', { class: 'mc-tree' }, p.parts.map((c) => treeView(c, depth + 1, counter))));
  return li;
}

// Raw source in a <pre>, cut at RAW_MAX characters with a button that shows everything.
function rawView(raw) {
  const pre = h('pre', { class: 'ap-pre mc-raw', tabindex: '0' });
  const paint = (all) => { pre.textContent = all || raw.length <= RAW_MAX ? raw : raw.slice(0, RAW_MAX); };
  paint(false);
  const box = h('div', { class: 'mc-rawbox' }, pre);
  if (raw.length > RAW_MAX) {
    const more = h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => { paint(true); more.remove(); } }, t('mc.i.showAll', { size: fmtSize(raw.length) }));
    box.append(more);
  }
  return box;
}

/**
 * Renders a parsed message into `box`. opts: { compact (summary, checks and structure only), onEditAsNew(msg),
 * name (file name), bytes (size) }.
 */
export function renderInspector(box, msg, raw, opts = {}) {
  box.textContent = '';
  const size = opts.bytes ?? raw.length;
  // Summary.
  // dir="auto" on user-supplied text: Arabic / Hebrew subjects and names render right-to-left correctly.
  const who = (list) => (list.length ? h('div', { class: 'mc-addrs' }, list.map((a) => addrChip(a))) : null);
  const summary = h('section', { class: 'ap-card mc-i-sum' },
    h('h2', { class: 'mc-i-subject', dir: 'auto' }, msg.subject || t('mc.i.noSubject')),
    kvRows([
      ['mc.f.from', who(msg.from)], ['mc.f.to', who(msg.to)], ['mc.f.cc', who(msg.cc)], ['mc.f.replyTo', who(msg.replyTo)],
      ['mc.i.date', Number.isFinite(msg.date) ? fmtDate(msg.date) : msg.header('date')], ['mc.i.msgId', msg.messageId ? h('code', { class: 'mc-mono mc-wrap' }, msg.messageId) : ''],
      ['mc.i.size', fmtSize(size)], ['mc.i.parts', String(countLeaves(msg.tree))],
    ]));
  if (opts.onEditAsNew) {
    const b = h('button', { type: 'button', class: 'ed-btn ed-primary mc-edit-new', onclick: () => opts.onEditAsNew(msg) }, iconEl('edit'), t('mc.i.editNew'));
    summary.append(h('div', { class: 'ap-actions' }, b));
  }
  box.append(summary);
  const checks = messageChecks(msg, raw);
  if (checks.length) box.append(h('section', { class: 'ap-card' }, h('h2', { class: 'ap-card-h' }, t('mc.i.checks')), findings(checks, 'mc.c.')));
  else box.append(h('div', { class: 'mc-f mc-f-ok' }, iconEl('ok'), h('span', {}, t('mc.i.allGood'))));

  if (!opts.compact) {
    // Bodies.
    const views = [];
    if (msg.html) views.push({ k: 'html', l: 'mc.i.htmlBody' });
    if (msg.text) views.push({ k: 'text', l: 'mc.i.textBody' });
    if (views.length) {
      const panel = h('div', { class: 'mc-body-panel' });
      const show = (k) => {
        panel.textContent = '';
        if (k === 'html') {
          const pv = previewDoc(msg.html, msg.attachments);
          panel.append(previewFrame(pv.doc));
          if (pv.remote) panel.append(h('div', { class: 'ed-hint' }, t('mc.i.remote', { n: pv.remote })));
        } else panel.append(h('pre', { class: 'ap-pre mc-textbody', dir: 'auto', tabindex: '0' }, msg.text));
      };
      const bar = tabs(views, views[0].k, show, 'mc.i.bodies');
      box.append(h('section', { class: 'ap-card' }, h('h2', { class: 'ap-card-h' }, t('mc.i.bodies')), bar, panel));
      show(views[0].k);
    }
    // Attachments.
    if (msg.attachments.length) {
      const list = h('ul', { class: 'mc-atts' });
      msg.attachments.forEach((a, i) => {
        const name = a.filename || `part-${i + 1}`;
        // Thumbnails only for raster image types under 4 MB (SVG is excluded: an <img> of SVG is safe, but large files
        // would bloat the DOM as base64).
        const thumb = /^image\/(png|jpe?g|gif|webp|bmp|avif)$/.test(a.contentType) && a.data.length < 4e6
          ? h('img', { class: 'mc-thumb', alt: '', src: 'data:' + a.contentType + ';base64,' + b64encode(a.data) }) : h('span', { class: 'mc-thumb mc-thumb-file', html: icon('file') });
        const dl = h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => download(a.data, name, a.contentType || 'application/octet-stream') }, iconEl('download'), t('ap.download'));
        list.append(h('li', { class: 'mc-att' }, thumb, h('div', { class: 'mc-att-main' }, h('div', { class: 'mc-att-name', dir: 'auto' }, name),
          h('div', { class: 'ed-hint' }, [a.contentType, fmtSize(a.data.length), a.inline ? t('mc.i.inline') + (a.cid ? ' · cid:' + a.cid : '') : ''].filter(Boolean).join(' · '))), dl));
      });
      box.append(h('section', { class: 'ap-card' }, h('h2', { class: 'ap-card-h' }, t('mc.i.attachments', { n: msg.attachments.length })), list));
    }
  }
  // Structure.
  box.append(h('section', { class: 'ap-card' }, h('h2', { class: 'ap-card-h' }, t('mc.i.structure')), h('ul', { class: 'mc-tree mc-tree-root' }, treeView(msg.tree))));
  if (opts.compact) return;
  // Headers.
  const raws = msg.tree.headers;
  const table = h('table', { class: 'ap-table mc-htable' }, h('thead', {}, h('tr', {}, h('th', {}, t('mc.i.hName')), h('th', {}, t('mc.i.hValue')))),
    h('tbody', {}, msg.headers.map((x, i) => {
      // Each header shows the decoded value; when the raw (encoded / folded) form differs, it is shown below, which makes
      // RFC 2047 encoding visible. Assumes msg.headers and msg.tree.headers are in the same order (the parser keeps it).
      const r = raws[i] ? raws[i].value : '';
      return h('tr', {}, h('th', { scope: 'row', class: 'mc-mono' }, x.name), h('td', {}, h('div', { class: 'mc-hval', dir: 'auto' }, x.value),
        r !== x.value ? h('div', { class: 'mc-hraw mc-mono' }, r) : null));
    })));
  box.append(h('section', { class: 'ap-card' }, h('h2', { class: 'ap-card-h' }, t('mc.i.headers', { n: msg.headers.length })), h('div', { class: 'ap-table-wrap' }, table)));
  // Source.
  box.append(h('section', { class: 'ap-card' }, h('h2', { class: 'ap-card-h' }, t('mc.i.source')), rawView(raw)));
}

const countLeaves = (p) => (p.parts ? p.parts.reduce((n, c) => n + countLeaves(c), 0) : 1);
