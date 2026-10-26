// knowledge-processor/ed-media.js - the media library of the editor: files (images, audio, video, documents) stored
// in IndexedDB beside the knowledge base, object URLs for the editor, uploads with image sizes, the media panel
// (grid, properties, usage, secret flag, replace, delete), the media picker of block fields, and the cache of secret
// media bytes that 451 payloads carry.
//
// Storage split: the base record holds only media metadata (kb.media[id]: name, type, size, w, h, alt, credit,
// secret); the bytes are separate IndexedDB blobs keyed by (base id, media id). Why: undo snapshots serialise the
// base record on every commit, and megabytes of base64 in it would make each keystroke slow.
// Three caches, all reset when another base opens ('kb' event): Blobs, object URLs, base64 of secret media.
import { h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { confirmDialog, openDialog, toast } from '../ui/overlays.js';
import { fmtBytes, guessMime, pickFiles } from '../ui/files.js';
import { contextMenu } from '../ui/contextmenu.js';
import { b64encode } from '../codec/base64.js';
import { S, commit, on } from './state.js';
import { deleteMedia, getMedia, putMedia } from './store.js';
import { mediaRefs, uid } from './model.js';
import { input, row, check } from './ed-fields.js';

// Object URLs must be revoked explicitly or the Blob stays in memory until the page unloads; resetMediaURLs and
// replace/delete revoke them.
const urls = new Map();       // id -> object URL
const secretBytes = new Map(); // id -> base64 (secret media for payloads)

const blobs = new Map(); // id -> Blob (the preview asks for every file on each update)
export async function mediaBlob(id) {
  if (!S.kb) return null;
  if (blobs.has(id)) return blobs.get(id);
  const b = await getMedia(S.kb.id, id);
  if (b) blobs.set(id, b);
  return b;
}

// Synchronous API for renderers that build DOM synchronously: returns '' the first time, loads in the background,
// then patches every <img data-kp-media=id> already in the document. The '' placeholder is cached at once so
// concurrent calls do not start duplicate loads. Limitation: only <img> is patched; audio/video elements created
// before the URL exists keep an empty src until the next render.
export function mediaURL(id) {
  if (urls.has(id)) return urls.get(id);
  const p = mediaBlob(id).then((b) => {
    const u = b ? URL.createObjectURL(b) : '';
    urls.set(id, u);
    // Images painted before the URL existed.
    for (const img of document.querySelectorAll(`img[data-kp-media="${id}"]`)) img.src = u;
    return u;
  });
  urls.set(id, '');
  void p;
  return '';
}
export function resetMediaURLs() { for (const u of urls.values()) if (u) URL.revokeObjectURL(u); urls.clear(); secretBytes.clear(); blobs.clear(); }

// Sequential awaits: IndexedDB reads are fast and cached after the first preview update.
export async function allMediaBlobs() {
  const out = {};
  for (const id of Object.keys(S.kb ? S.kb.media : {})) { const b = await mediaBlob(id); if (b) out[id] = b; }
  return out;
}

// Bytes of secret media for sealing (loaded ahead of time; sealing is synchronous).
// Sealing (state.js reseal) is synchronous, while reading a Blob is not; so the bytes of secret media are read
// ahead and kept as base64, ready to embed into an envelope at any commit.
export async function loadSecretMedia() {
  for (const [id, m] of Object.entries(S.kb ? S.kb.media : {})) {
    if (!m.secret || secretBytes.has(id)) continue;
    const b = await mediaBlob(id);
    if (b) secretBytes.set(id, b64encode(new Uint8Array(await b.arrayBuffer())));
  }
}
// Secret media travels inside the encrypted payload (field names shortened: t type, n name, s size, cr credit,
// d data) so a 451 page's pictures are as hidden as its text. Only media flagged secret and already loaded is
// embedded; public media stays a normal reference.
export function payloadMedia(payload) {
  const ids = mediaRefs([].concat(...(payload.versions || []).map((v) => v.blocks || [])));
  if (payload.image) ids.add(payload.image);
  const out = {};
  for (const id of ids) {
    const m = S.kb.media[id];
    if (m && m.secret && secretBytes.has(id)) out[id] = { t: m.type, n: m.name, s: m.size, w: m.w, h: m.h, alt: m.alt, cr: m.credit, d: secretBytes.get(id) };
  }
  return Object.keys(out).length ? out : null;
}

// Natural size of an image, read once at upload: the reader reserves layout space (width/height attributes) to
// avoid layout shift. Non-images and decode errors resolve [0, 0]; the temporary URL is revoked either way.
function imageSize(blob) {
  return new Promise((resolve) => {
    if (!/^image\//.test(blob.type)) { resolve([0, 0]); return; }
    const u = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { resolve([img.naturalWidth || 0, img.naturalHeight || 0]); URL.revokeObjectURL(u); };
    img.onerror = () => { resolve([0, 0]); URL.revokeObjectURL(u); };
    img.src = u;
  });
}

// MIME guessed from the extension when the browser gives none or a generic one; the Blob is re-wrapped only if
// the type differs. Bytes are stored before the metadata commit, so a record never points at missing bytes.
export async function addFiles(files, { secret = false } = {}) {
  const ids = [];
  for (const f of files) {
    const type = guessMime(f.name, f.type) || 'application/octet-stream';
    const blob = f.type === type ? f : new Blob([f], { type });
    const [w, hgt] = await imageSize(blob);
    const id = uid();
    await putMedia(S.kb.id, id, blob);
    blobs.set(id, blob);
    ids.push(id);
    const meta = { id, name: f.name || id, type, size: blob.size, w, h: hgt, alt: '', credit: '', ...(secret ? { secret: true } : {}) };
    commit((kb) => { kb.media[id] = meta; }, { structure: true });
  }
  if (secret) await loadSecretMedia();
  return ids;
}

// Usage scan over public pages and the logo. Content inside sealed 451 payloads cannot be scanned (encrypted),
// so "unused" may be wrong for secret media.
export function mediaUsage(id) {
  const out = [];
  if (S.kb.logo === id) out.push(t('kp.logo'));
  for (const p of S.kb.pages) {
    const refs = mediaRefs([].concat(...(p.versions || []).map((v) => v.blocks || [])));
    if (refs.has(id) || p.image === id) out.push(p.title || p.slug);
  }
  return out;
}

const kindIcon = (type) => (/^image\//.test(type) ? 'image' : /^audio\//.test(type) ? 'music' : /^video\//.test(type) ? 'film' : 'file');

function thumb(id, m, cls = 'kp-thumb') {
  if (m && /^image\//.test(m.type)) return h('img', { class: cls, src: mediaURL(id), alt: '', 'data-kp-media': id, loading: 'lazy' });
  return h('span', { class: cls + ' kp-thumb-i' }, iconEl(kindIcon(m ? m.type : '')));
}

// Properties dialog. Text fields commit with a per-field key (one undo step per field edit).
async function editMedia(id) {
  const m = S.kb.media[id];
  if (!m) return;
  const usage = mediaUsage(id);
  const body = h('div', { class: 'kp-media-edit' },
    h('div', { class: 'kp-media-big' }, /^image\//.test(m.type) ? h('img', { src: mediaURL(id), alt: '', 'data-kp-media': id }) : /^audio\//.test(m.type) ? h('audio', { controls: true, src: mediaURL(id) }) : /^video\//.test(m.type) ? h('video', { controls: true, src: mediaURL(id) }) : thumb(id, m)),
    h('div', { class: 'ed-hint' }, `${m.type} · ${fmtBytes(m.size)}${m.w ? ` · ${m.w}×${m.h}` : ''} · id: ${id}`),
    row(t('kp.name'), input(m.name, (v) => commit((kb) => { kb.media[id].name = v; }, { key: 'mn' + id }))),
    row(t('kp.alt'), input(m.alt, (v) => commit((kb) => { kb.media[id].alt = v; }, { key: 'ma' + id })), t('kp.altHint')),
    row(t('kp.credit'), input(m.credit, (v) => commit((kb) => { kb.media[id].credit = v; }, { key: 'mc' + id }))),
    row(t('kp.secretMedia'), check(!!m.secret, async (v) => {
      commit((kb) => { if (v) kb.media[id].secret = true; else delete kb.media[id].secret; });
      if (v) await loadSecretMedia();
    }), t('kp.secretMediaHint')),
    h('div', { class: 'ed-hint' }, usage.length ? t('kp.usedOn', { list: usage.join(', ') }) : t('kp.unused')),
    h('div', { class: 'kp-row' },
      h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: async () => {
        // Replace keeps the id, so every reference in pages stays valid; caches for the id are dropped and refilled.
        const [f] = await pickFiles({ accept: m.type.split('/')[0] + '/*' });
        if (!f) return;
        const blob = new Blob([f], { type: guessMime(f.name, f.type) || m.type });
        const [w, hgt] = await imageSize(blob);
        await putMedia(S.kb.id, id, blob);
        blobs.set(id, blob);
        const old = urls.get(id); if (old) URL.revokeObjectURL(old); urls.delete(id); secretBytes.delete(id);
        commit((kb) => Object.assign(kb.media[id], { type: blob.type, size: blob.size, w, h: hgt }), { structure: true });
        if (m.secret) await loadSecretMedia();
        toast(t('kp.replaced'), 'ok');
      } }, iconEl('refresh'), t('kp.replace')),
      h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => navigator.clipboard && navigator.clipboard.writeText(`[[media:${id}|${m.name}]]`).then(() => toast(t('kp.copied'), 'ok')) }, iconEl('copy'), t('kp.copyMarkup'))));
  const v = await openDialog({ title: t('kp.mediaItem'), body, wide: true, buttons: [{ label: t('kp.delete'), value: 'del', danger: true }, { label: t('dlg.close'), value: null, primary: true }] });
  if (v === 'del') removeMedia(id);
}

// KNOWN DEFECT: the metadata delete is an undoable commit, but the bytes are deleted from IndexedDB at once;
// undo brings back a record whose file is gone (broken image). Fix: delete the bytes lazily (e.g. on save, for ids
// no longer in kb.media and not in any undo snapshot), or keep them until the undo history drops the step.
export async function removeMedia(id) {
  const usage = mediaUsage(id);
  if (!(await confirmDialog(t('kp.deleteMedia'), usage.length ? t('kp.deleteMediaUsed', { list: usage.join(', ') }) : t('kp.deleteMediaQ'), t('kp.delete'), true))) return;
  commit((kb) => { delete kb.media[id]; if (kb.logo === id) kb.logo = ''; }, { structure: true });
  await deleteMedia(S.kb.id, id);
  blobs.delete(id);
  const u = urls.get(id); if (u) URL.revokeObjectURL(u); urls.delete(id);
}

// The media panel (left column tab).
// The drop zone is a real <button>: keyboard users can open the file picker; drag and drop is an extra path.
// dragover must preventDefault, otherwise the browser refuses the drop and opens the file instead.
export function renderMediaPanel(box) {
  const items = Object.entries(S.kb.media);
  const drop = h('button', { type: 'button', class: 'kp-drop' }, iconEl('upload'), h('span', {}, t('kp.addFiles')));
  drop.addEventListener('click', async () => { const fs = await pickFiles({ multiple: true }); if (fs.length) addFiles(fs); });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('kp-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('kp-over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('kp-over'); if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]); });
  const grid = h('div', { class: 'kp-media-grid' }, items.length ? items.map(([id, m]) => {
    const b = h('button', { type: 'button', class: 'kp-media-it', 'data-id': id, title: m.name },
      thumb(id, m), h('span', { class: 'kp-media-n' }, m.secret ? iconEl('lock') : null, m.name));
    b.addEventListener('click', () => editMedia(id));
    return b;
  }) : h('p', { class: 'ed-hint' }, t('kp.noMedia')));
  contextMenu(grid, (el) => {
    const id = el.dataset.id;
    return [
      { label: t('kp.properties'), icon: 'edit', action: () => editMedia(id) },
      { label: t('kp.copyMarkup'), icon: 'copy', action: () => navigator.clipboard && navigator.clipboard.writeText(`[[media:${id}]]`) },
      { sep: true },
      { label: t('kp.delete'), icon: 'trash', danger: true, action: () => removeMedia(id) },
    ];
  }, { selector: '.kp-media-it' });
  box.replaceChildren(h('div', { class: 'kp-panel-h' }, h('h2', {}, t('kp.media')), h('span', { class: 'ed-hint' }, t('kp.mediaCount', { n: items.length }))), drop, grid);
}

// A media field: preview, choose, clear.
// accept: '' any file, 'image', or 'media' (audio or video). The picker repaints itself locally after a choice.
export function mediaPicker(value, onChange, { accept = '' } = {}) {
  const box = h('div', { class: 'kp-mpick' });
  const paint = (v) => {
    const m = v ? S.kb.media[v] : null;
    box.replaceChildren(
      m ? thumb(v, m, 'kp-mpick-t') : h('span', { class: 'kp-mpick-t kp-thumb-i' }, iconEl('image')),
      h('span', { class: 'kp-mpick-n' }, m ? m.name : t('kp.noFile')),
      h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: async () => { const id = await chooseMedia(accept); if (id) { onChange(id); paint(id); } } }, t('kp.choose')),
      v ? h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('kp.clear'), 'aria-label': t('kp.clear'), onclick: () => { onChange(''); paint(''); } }, iconEl('close')) : null);
  };
  paint(value);
  return box;
}

// The media chooser dialog: pick an item or upload new files.
// Files uploaded while editing a 451 page or variant are flagged secret automatically: a picture added to hidden
// content should not appear in the public site's media.
export function chooseMedia(accept = '') {
  return new Promise((resolve) => {
    let done = false;
    const fits = (m) => !accept || m.type.startsWith(accept + '/') || (accept === 'media' && /^(audio|video)\//.test(m.type));
    const grid = h('div', { class: 'kp-media-grid kp-media-pick' });
    const paint = () => {
      const items = Object.entries(S.kb.media).filter(([, m]) => fits(m));
      grid.replaceChildren(...(items.length ? items.map(([id, m]) => {
        const b = h('button', { type: 'button', class: 'kp-media-it', title: m.name }, thumb(id, m), h('span', { class: 'kp-media-n' }, m.name));
        b.addEventListener('click', () => { done = true; resolve(id); close(); });
        return b;
      }) : [h('p', { class: 'ed-hint' }, t('kp.noMedia'))]));
    };
    let close = () => {};
    const up = h('button', { type: 'button', class: 'kp-drop' }, iconEl('upload'), h('span', {}, t('kp.upload')));
    up.addEventListener('click', async () => {
      const fs = await pickFiles({ accept: accept && accept !== 'media' ? accept + '/*' : accept === 'media' ? 'audio/*,video/*' : '', multiple: true });
      if (!fs.length) return;
      const page = S.kb.pages.find((p) => p.id === S.pageId);
      const ids = await addFiles(fs, { secret: !!(page && (page.access === 'secret' || S.sid)) });
      if (ids.length === 1) { done = true; resolve(ids[0]); close(); } else paint();
    });
    paint();
    openDialog({ title: t('kp.chooseMedia'), body: h('div', {}, up, grid), wide: true, onMount: (o) => { close = o.close; } }).then(() => { if (!done) resolve(null); });
  });
}

// Another base opened: all cached ids belong to the old base.
on('kb', () => resetMediaURLs());
