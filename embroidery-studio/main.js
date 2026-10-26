// embroidery-studio/main.js - Embroidery Studio: the page. The shell (header with the site's sections, UI language,
// colour scheme), hash routes (works from file://, one HTML file, and on any static host), the screens (catalogue,
// scheme page, viewer, editor, converter, my schemes, moderation), files dropped anywhere, charts handed over by the
// carpet generator, and the artifact mode (offline builds have no network code; serverless builds read a published
// catalogue; backend builds talk to backend.js).
//
//   #/                      catalogue          #/s/<key>          scheme page
//   #/view/<key>            viewer             #/edit/<key>       editor        #/new    new blank chart
//   #/convert               picture -> chart   #/my               my schemes    #/admin  moderation (backend)
//   #/import                a chart handed over through localStorage ('stitch-handoff') by another app

//
// Why hash routing: the same build runs from file:// (no server to rewrite paths), as one offline HTML file and on
// any static host; only the fragment can change without a request. Each screen renderer returns an object with an
// optional destroy() (listeners, timers, chart views), called before the next screen replaces it.
// Side-effect import first: strings.js registers every dictionary before any t() call.
import './strings.js';
import { startApp } from '../ui/app.js';
import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { addIcons, iconEl } from '../ui/icons.js';
import { openDialog, toast } from '../ui/overlays.js';
import { createRouter } from '../spa/router.js';
import { fromJSON, newId } from '../stitch/model.js';
import { renderHome, renderScheme, renderMine, importFiles } from './site.js';
import { renderViewer } from './viewer.js';
import { renderEditor, newSchemeDialog } from './editor.js';
import { renderConverter } from './converter.js';
import { renderAdmin } from './admin.js';
import { artifactMode } from './common.js';
import { backendInfo, saveMine } from './catalog.js';
import { settings, setSettings, newReaderKey } from './store.js';

const LOGO = 'M4 4h16v16H4zM7 7l4 4m0-4l-4 4M13 13l4 4m0-4l-4 4';
addIcons({ stitchLogo: LOGO });
const main = document.getElementById('main');
const mode = artifactMode();
let current = null, currentRoute = null, renderSeq = 0;

startApp({
  key: 'es', name: 'app.name', logo: LOGO,
  pages: [{ href: '#/', label: 'nav.catalog' }, { href: '#/my', label: 'nav.mine' }, { href: '#/convert', label: 'nav.convert' }, { href: '#/new', label: 'nav.new' }],
  offline: mode === 'offline' ? true : mode === 'serverless' ? 'serverless' : false,
  footer: () => h('span', { class: 'es-foot' }, h('button', { type: 'button', class: 'ed-btn es-footbtn', onclick: () => syncDialog() }, iconEl('settings'), t('foot.settings')), h('span', { class: 'ed-muted' }, t('foot.note'))),
  onLang: () => { if (currentRoute) route(currentRoute, true); },
});

function markNav(path) {
  const sec = path.startsWith('my') ? '#/my' : path.startsWith('convert') ? '#/convert' : path.startsWith('new') ? '#/new' : path === '' || path.startsWith('s/') ? '#/' : '';
  for (const a of document.querySelectorAll('.ap-page')) { const on = a.getAttribute('href') === sec; a.classList.toggle('ap-on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
}

// spa/router.js translates hashchange into { path, query } route objects.
const router = createRouter({ mode: 'hash', onRoute: (r) => route(r) });

// Race guard: screens load asynchronously (charts from IndexedDB or the network). renderSeq marks the latest
// navigation; a screen that finishes after the user already navigated away is destroyed instead of shown.
// again=true (language change) re-renders the current route but drops one-shot query state.
async function route(r, again = false) {
  const seq = ++renderSeq;
  currentRoute = r;
  if (current && current.destroy) { try { current.destroy(); } catch (e) { console.error(e); } }
  current = null;
  main.textContent = '';
  const path = r.path || '';
  const [head, ...rest] = path.split('/');
  const arg = rest.join('/');
  const go = (p, o) => router.go(p, o);
  document.title = t('app.name');
  markNav(path);
  let full = false;
  try {
    let res;
    if (head === '') res = renderHome(main, { go, query: again ? {} : r.query });
    else if (head === 's' && arg) res = await renderScheme(main, { key: arg, go });
    else if (head === 'view' && arg) { full = true; res = await renderViewer(main, { key: arg, go }); }
    else if (head === 'edit' && arg) { full = true; res = await renderEditor(main, { key: arg, go }); }
    else if (head === 'convert') res = renderConverter(main, { go });
    else if (head === 'my') res = await renderMine(main, { go });
    else if (head === 'admin') res = await renderAdmin(main, { go });
    // #/new shows the catalogue behind the "new chart" dialog; the URL is replaced afterwards so Back does not reopen
    // the dialog.
    else if (head === 'new') {
      res = renderHome(main, { go, query: {} });
      newSchemeDialog().then((s) => { if (s) go('edit/' + encodeURIComponent('my:' + s.id), { replace: true }); else go('', { replace: true }); });
    } else if (head === 'import') res = await importHandoff(go);
    else main.append(h('div', { class: 'es-empty' }, iconEl('warn'), h('h2', {}, t('err.notFoundT')), h('a', { class: 'ed-btn', href: '#/' }, t('nav.catalog'))));
    if (seq !== renderSeq) { if (res && res.destroy) res.destroy(); return; }
    current = res || null;
    full = full || !!(res && res.full);
  } catch (e) {
    console.error(e);
    main.append(h('div', { class: 'es-empty' }, iconEl('warn'), h('p', {}, t('err.generic', { msg: e.message }))));
  }
  document.body.classList.toggle('es-fullpage', full);
  main.classList.toggle('ap-wide', full || head === 'convert');
}

// A chart handed over by another application of this site (the carpet generator) through localStorage.
// Cross-app hand-off through localStorage (same origin, no server): the key is removed on read so a reload does not
// import twice. The chart gets a fresh id so it never overwrites an existing scheme.
async function importHandoff(go) {
  let raw = null;
  try { raw = localStorage.getItem('stitch-handoff'); localStorage.removeItem('stitch-handoff'); } catch { /* storage unavailable */ }
  if (!raw) { toast(t('imp.none'), 'warn'); go('my', { replace: true }); return {}; }
  try {
    const s = fromJSON(raw);
    s.id = newId('s');
    await saveMine(s, { origin: 'carpet' });
    toast(t('my.imported', { name: s.meta.title }), 'ok');
    go('edit/' + encodeURIComponent('my:' + s.id), { replace: true });
  } catch (e) { toast(t('err.generic', { msg: e.message }), 'error'); go('my', { replace: true }); }
  return {};
}

// Settings in the footer: the reader key that syncs progress through the site's server.
// The reader key is the only credential for progress sync; validated here with the same pattern the server enforces.
async function syncDialog() {
  const info = await backendInfo();
  const st = settings();
  const key = h('input', { type: 'text', class: 'ed-input', value: st.readerKey, placeholder: t('sync.keyPh'), spellcheck: 'false', autocomplete: 'off' });
  const body = h('div', { class: 'ed-fields' },
    h('p', {}, info ? t('sync.lead') : t('sync.noServer')),
    info ? h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('sync.key')), key) : null,
    info ? h('button', { type: 'button', class: 'ed-btn', onclick: () => { key.value = newReaderKey(); } }, iconEl('refresh'), t('sync.new')) : null,
    info ? h('p', { class: 'ed-hint' }, t('sync.hint')) : null,
    info ? h('a', { class: 'ed-btn', href: '#/admin' }, iconEl('shield'), t('adm.title')) : null);
  const r = await openDialog({ title: t('foot.settings'), body, buttons: info ? [{ label: t('dlg.cancel'), value: null }, { label: t('dlg.ok'), value: 'ok', primary: true }] : undefined });
  if (r === 'ok') {
    const v = key.value.trim().toLowerCase();
    if (v && !/^[a-z0-9]{12,40}$/.test(v)) { toast(t('sync.bad'), 'error'); return; }
    setSettings({ readerKey: v });
    toast(t('sync.saved'), 'ok');
  }
}

// Files dropped anywhere on the page (outside the converter's own zone).
// preventDefault on dragover for files makes the whole window a drop target (otherwise the browser would navigate
// to the dropped file and the app would be lost).
window.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
window.addEventListener('drop', (e) => {
  if (e.defaultPrevented || !e.dataTransfer || !e.dataTransfer.files.length) return;
  e.preventDefault();
  importFiles((p) => router.go(p), [...e.dataTransfer.files]);
});

router.start();

// A chart handed over by another application (the carpet generator) waits in localStorage: offer it.
// localStorage access can throw (disabled storage, sandboxed frames), hence the try around a mere read.
try {
  if (localStorage.getItem('stitch-handoff') && !location.hash.startsWith('#/import')) {
    toast(t('imp.offer'), 'info', { label: t('imp.open'), fn: () => router.go('import') }, { sticky: true });
  }
} catch { /* storage unavailable */ }
