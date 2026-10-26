// book-processor/main.js - entry of the book application: the shell (ui/app.js), the view switcher in the
// header (library, reader, writer), hash routing (#library, #read/<id>, #write/<draft id>), files dropped anywhere,
// and the test hook window.__bk (S, db, go, lib, rd, wr, panels, rendering()).
import './strings.js';
import { $, h } from '../ui/dom.js';
import { startApp, t, toast } from '../ui/app.js';
import { iconEl } from '../ui/icons.js';
import { S, LOGO } from './state.js';
import { db } from './db.js';
import { renderLibrary, importAndReport } from './library.js';
import * as rd from './reader.js';
import * as wr from './writer.js';
import * as panels from './reader-panels.js';

const { openReader, closeReader } = rd;
const { openWriter, closeWriter } = wr;
import * as lib from './lib.js';

const main = typeof document !== 'undefined' ? document.getElementById('bk-main') : null;

const VIEWS = [['library', 'library', 'nav.library'], ['reader', 'read', 'nav.reader'], ['writer', 'feather', 'nav.writer']];

function navEl() {
  const nav = h('nav', { class: 'bk-nav', 'aria-label': t('nav.views') });
  for (const [v, ic, label] of VIEWS) {
    nav.append(h('button', {
      type: 'button', class: 'bk-nav-btn' + (S.view === v ? ' bk-on' : ''), 'aria-current': S.view === v ? 'page' : null, dataset: { v },
      onclick: () => {
        if (v === 'library') go('library');
        else if (v === 'reader') go('read', S.lastRead || '');
        else go('write', S.lastDraft || '');
      },
    }, iconEl(ic), h('span', {}, t(label))));
  }
  return nav;
}
function paintNav() {
  const top = $('#ap-top');
  if (!top) return;
  const old = top.querySelector('.bk-nav');
  const nav = navEl();
  if (old) old.replaceWith(nav);
  else top.querySelector('.ap-brand')?.after(nav);
}

// Routing: the hash names the view; views render into <main>.
export function go(view, arg = '') {
  const hash = '#' + view + (arg ? '/' + encodeURIComponent(arg) : '');
  if (location.hash === hash) render(); else location.hash = hash;
}

// Renders are serialised on a promise chain: closing the reader / writer is async (saving position, draft), and two
// quick hash changes must not run open and close interleaved. renderNow is used for both fulfil and reject so one
// failed render does not stop the chain. The chain is exposed to e2e tests (rendering()) to await a settled view.
let rendering = Promise.resolve();
function render() {
  rendering = rendering.then(renderNow, renderNow);
  return rendering;
}
async function renderNow() {
  const [view, rawArg] = location.hash.replace(/^#/, '').split('/');
  const arg = rawArg ? decodeURIComponent(rawArg) : '';
  const next = view === 'read' ? 'reader' : view === 'write' ? 'writer' : 'library';
  if (S.view === 'reader' && (next !== 'reader' || (S.reader && S.reader.id !== arg))) await closeReader();
  if (S.view === 'writer' && (next !== 'writer' || (S.writer && S.writer.id !== arg))) await closeWriter();
  S.view = next;
  document.body.classList.toggle('bk-v-library', next === 'library');
  document.body.classList.toggle('bk-v-reader', next === 'reader');
  document.body.classList.toggle('bk-v-writer', next === 'writer');
  paintNav();
  try {
    if (next === 'reader') {
      if (!arg) { go('library'); toast(t('rd.pickBook'), 'info'); return; }
      S.lastRead = arg;
      await openReader(main, arg);
    } else if (next === 'writer') {
      if (arg) S.lastDraft = arg;
      await openWriter(main, arg);
    } else await renderLibrary(main);
  } catch (e) {
    console.error(e);
    toast(t('err.generic', { msg: e.message }), 'error');
    if (next !== 'library') go('library');
  }
}

function boot() {
  S.hooks.go = go;
  startApp({
    key: 'bk', name: 'app.name', logo: LOGO, offline: true,
    onLang: () => { paintNav(); render(); },
  });
  paintNav();
  window.addEventListener('hashchange', render);
  // Book files dropped anywhere outside an editor go to the library.
  // dragenter / dragleave fire for every child element crossed; counting enter minus leave tells when the drag really
  // left the window. Drops inside the editor are left to the editor (images into a chapter), not imported as books.
  let depth = 0;
  const overlay = h('div', { class: 'bk-dropover', hidden: true }, h('div', { class: 'bk-dropover-box' }, iconEl('book'), h('span', { 'data-i18n': 'lib.dropHere' }, t('lib.dropHere'))));
  document.body.append(overlay);
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  const inEditor = (e) => !!(e.target && e.target.closest && e.target.closest('.wr-doc, .wr-title, .ed-dialog'));
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e) || inEditor(e) || S.view === 'reader') return; depth++; overlay.hidden = false; });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) overlay.hidden = true; });
  window.addEventListener('dragover', (e) => { if (hasFiles(e) && !inEditor(e)) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    depth = 0;
    overlay.hidden = true;
    if (!hasFiles(e) || inEditor(e)) return;
    e.preventDefault();
    const files = [...e.dataTransfer.files];
    if (files.length) await importAndReport(files);
  });
  db.open();
  render();
  // Test hook: end-to-end scenarios drive the views with the application's own functions.
  window.__bk = { S, db, go, lib, rd, wr, panels, rendering: () => rendering, ready: true };
}

if (typeof document !== 'undefined') boot();
