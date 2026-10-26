// knowledge-processor/ed-bases.js - the knowledge bases of the editor: the list in this browser (open, download,
// delete), new bases from templates, import of project archives / JSON backups, and - when the page is served by the
// application's backend - the bases stored on the server (open, upload, published address).
//
// Invariant: before another base becomes current, saveNow() flushes the pending debounced save of the old one;
// otherwise the last ~700 ms of typing would be written into nothing (S.kb already replaced).
import { h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { UI_STATE, pickUI, t } from '../ui/i18n.js';
import { confirmDialog, openDialog, toast } from '../ui/overlays.js';
import { pickFiles } from '../ui/files.js';
import { S, saveNow, setKB } from './state.js';
import { deleteKB, getKB, importKB, listKBs, putKB, putMedia, setLastOpened } from './store.js';
import { buildKB } from './kit.js';
import { TEMPLATES } from './templates.js';
import { normKB, uid } from './model.js';
import { b64decode } from '../codec/base64.js';
import { getServerKB, getServerMedia, listServerKBs } from './remote.js';
import { server, syncToServer } from './ed-sync.js';

// Flush first, then load: see the invariant above.
export async function openKB(id) {
  await saveNow();
  const kb = await getKB(id);
  if (!kb) { toast(t('kp.notFoundBase'), 'error'); return; }
  setKB(kb);
  await setLastOpened(kb.id);
}

// Stores a new base (media given as Map(id -> Blob) or inside kb.media[id].data) and opens it.
// Order: media blobs, then the base record, then make it current. A crash midway leaves orphan blobs (harmless)
// rather than a base pointing at missing media. Inline base64 media (JSON backups, templates) is moved out of the
// record into IndexedDB blobs: the record stays small and is cheap to clone for undo snapshots.
// The trailing saveNow() flushes the previous base (still S.kb at that moment) before setKB replaces it.
export async function adoptKB(kb, media = new Map()) {
  for (const [id, m] of Object.entries(kb.media)) {
    if (m.data) { media.set(id, new Blob([b64decode(m.data)], { type: m.type })); delete m.data; }
  }
  for (const [id, blob] of media) await putMedia(kb.id, id, blob);
  await putKB(kb);
  await saveNow();
  setKB(kb);
  await setLastOpened(kb.id);
}

// Template build can take seconds (generated pictures, many pages), hence a modal with progress and no buttons.
// A fresh uid() means the same template can be instantiated many times without id collisions.
export async function newFromTemplate(tpl) {
  let close = () => {};
  const bar = h('progress', { class: 'kp-progress', max: 1, value: 0 });
  openDialog({ title: t('kp.creating'), body: h('div', {}, h('p', { class: 'ed-dlg-text' }, pickUI(tpl.name)), bar), buttons: [], onMount: (o) => { close = o.close; } });
  try {
    const kb = await buildKB(tpl.spec({ lang: UI_STATE.lang }), { onProgress: (p) => { bar.value = p; } });
    kb.id = uid();
    await adoptKB(kb);
    toast(t('kp.created', { title: kb.title }), 'ok');
  } catch (e) {
    console.error(e);
    toast(String(e.message || e), 'error');
  // finally: the progress dialog closes on success and on failure alike.
  } finally { close(); }
}

// Same id already in this browser: replace only on explicit consent, else import as a copy under a new id.
export async function importFile() {
  const [f] = await pickFiles({ accept: '.json,.zip,application/json,application/zip' });
  if (!f) return;
  try {
    const { kb, media } = await importKB(new Uint8Array(await f.arrayBuffer()));
    if ((await listKBs()).some((k) => k.id === kb.id)) {
      const replace = await confirmDialog(t('kp.importExists'), t('kp.importExistsQ', { title: kb.title }), t('kp.replace'));
      if (!replace) kb.id = uid();
    }
    await adoptKB(kb, media);
    toast(t('kp.imported', { title: kb.title }), 'ok');
  } catch (e) {
    toast(t('kp.importFailed', { msg: e.message || e }), 'error');
  }
}

export function templateGrid(onPick) {
  return h('div', { class: 'kp-tpl-grid' }, TEMPLATES.map((tpl) => h('button', { type: 'button', class: 'kp-tpl', onclick: () => onPick(tpl) },
    h('span', { class: 'kp-tpl-i kp-tpl-' + tpl.id }, iconEl(tplIcon(tpl))), h('b', {}, pickUI(tpl.name)), h('small', {}, pickUI(tpl.desc)))));
}
// Icon per template id; unknown (future) templates fall back to a generic icon instead of an empty tile.
const tplIcon = (tpl) => ({ wiki: 'doc', fandom: 'star', news: 'megaphone', songs: 'music', gaudiya: 'sparkle', japanese: 'languages', georgian: 'languages', blank: 'file' }[tpl.id] || 'template');

// Server copy is normalised (normKB fills defaults of older schema versions) and tagged with the server revision;
// ed-sync.js sends that revision back so the server can refuse a stale overwrite (409).
// Media fetched sequentially: simple, and keeps a small server from being flooded by parallel requests.
async function openServerKB(id) {
  const kb = await getServerKB(id);
  const media = new Map();
  for (const mid of Object.keys(kb.media || {})) { const b = await getServerMedia(id, mid); if (b) media.set(mid, b); }
  const norm = normKB(kb);
  norm.remote = { server: true, rev: kb.rev || 0 };
  await adoptKB(norm, media);
}

// The dialog is rebuilt from scratch after a delete (it reopens itself) instead of patching the list in place.
export async function openBasesDialog() {
  let close = () => {};
  const done = (fn) => async () => { close(); await fn(); };
  const local = await listKBs();
  // toLocaleString throws RangeError on an unsupported locale tag; fall back to the raw ISO string.
  const fmt = (d) => { try { return new Date(d).toLocaleString(UI_STATE.lang); } catch { return d; } };
  const list = h('ul', { class: 'kp-bases' }, local.map((k) => h('li', { class: k.id === (S.kb && S.kb.id) ? 'kp-on' : '' },
    h('button', { type: 'button', class: 'kp-base-open', onclick: done(() => openKB(k.id)) }, h('b', {}, k.title), h('small', {}, t('kp.pagesCount', { n: k.pages }) + ' · ' + fmt(k.updated) + (k.remote ? ' · ' + t('kp.onServer') : ''))),
    h('button', { type: 'button', class: 'ed-iconbtn ed-sm ed-danger', title: t('kp.delete'), 'aria-label': t('kp.delete'), onclick: async () => {
      if (!(await confirmDialog(t('kp.deleteBase'), t('kp.deleteBaseQ', { title: k.title }), t('kp.delete'), true))) return;
      await deleteKB(k.id);
      close();
      // Deleting the open base: open another, or create a blank one. The editor never runs without a current base.
      if (S.kb && S.kb.id === k.id) { const rest = await listKBs(); if (rest.length) await openKB(rest[0].id); else await newFromTemplate(TEMPLATES.find((x) => x.id === 'blank')); }
      openBasesDialog();
    } }, iconEl('trash')))));
  const sections = [
    h('section', {}, h('h3', {}, t('kp.inBrowser')), list,
      h('div', { class: 'kp-row' }, h('button', { type: 'button', class: 'ed-btn', onclick: done(importFile) }, iconEl('upload'), t('kp.import')))),
    h('section', {}, h('h3', {}, t('kp.newBase')), templateGrid((tpl) => { close(); newFromTemplate(tpl); })),
  ];
  // Server section is inserted at once with a loading line and filled asynchronously: the local list is usable
  // without waiting for the network. Link 'kb/<id>/' is relative to the editor page, so sub-path deploys work.
  if (server.info) {
    const box = h('section', {}, h('h3', {}, t('kp.onServerTitle')), h('p', { class: 'ed-hint' }, t('kp.loading')));
    sections.splice(1, 0, box);
    listServerKBs().then((items) => {
      box.replaceChildren(h('h3', {}, t('kp.onServerTitle')), h('ul', { class: 'kp-bases' }, (items || []).map((k) => h('li', {},
        h('button', { type: 'button', class: 'kp-base-open', onclick: done(() => openServerKB(k.id)) }, h('b', {}, k.title), h('small', {}, t('kp.pagesCount', { n: k.pages }) + ' · ' + fmt(k.updated))),
        h('a', { class: 'ed-iconbtn ed-sm', href: 'kb/' + encodeURIComponent(k.id) + '/', target: '_blank', rel: 'noopener', title: t('kp.openSite'), 'aria-label': t('kp.openSite') }, iconEl('external'))))),
      S.kb ? h('button', { type: 'button', class: 'ed-btn', onclick: done(() => syncToServer(true)) }, iconEl('upload'), t('kp.uploadToServer')) : null);
    }).catch((e) => { box.replaceChildren(h('h3', {}, t('kp.onServerTitle')), h('p', { class: 'ed-error' }, String(e.message || e))); });
  }
  openDialog({ title: t('kp.bases'), body: h('div', { class: 'kp-bases-dlg' }, ...sections), wide: true, onMount: (o) => { close = o.close; } });
}
