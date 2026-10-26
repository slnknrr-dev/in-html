// studio/attach.js - attachments in the editor: binary data and blob URLs, upload, replace, delete, references
// (usage counts, remapping), download / open / print.
import { b64decode } from '../codec/base64.js';
import { previewKind } from '../doc/attach.js';
import { own } from '../util/value.js';
import { uid } from '../util/id.js';
import { newBlock } from '../doc/model.js';
import { clone, esc, h, nowISO } from '../ui/dom.js';
import { downloadBlob, fmtBytes, guessMime, isFontMime, isImageMime, pickFiles, readFileB64 } from '../ui/files.js';
import { t } from '../ui/i18n.js';
import { confirmDialog, toast } from '../ui/overlays.js';
import { BIG_FILE, MAX_ATT_FILE, S } from './state.js';
import { eachI18n, getList, typeDef } from './doc.js';
import { BLOCK_TYPES } from '../doc/product.js';
import { isObj } from '../util/value.js';
import { ED } from './config.js';
import { commit } from './history.js';
import { checkStorageRoom } from './db.js';
import { select } from './select.js';
import { saveFile } from './fileio.js';

// ===========================================================================
// 8. Attachments (binary data, blob URLs, upload, usage)
// ===========================================================================

// Storage format is base64 (JSON-friendly project files, one string per IndexedDB record); bytes are produced only
// when a Blob is needed. atob fallback in case the codec rejects input it considers malformed.
function b64ToBytes(b64) {
  try { return b64decode(b64); }
  catch {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
}
// Blob type of in-editor previews (<img>, <object>, sandboxed <iframe>, @font-face). Blob URLs share the editor's
// origin (IndexedDB with every project), so only passive types keep their real type; active formats (html, xml…)
// become inert text and unknown ones bytes. SVG keeps its type: the editor shows images only through <img>.
function previewMime(mime) {
  const m = String(mime || '').split(';')[0].trim().toLowerCase();
  const k = previewKind(m);
  if (k === 'object' || SAFE_OPEN_MIME.test(m) || m === 'image/svg+xml' || /^font\/[\w.+-]+$/.test(m)) return m;
  return k === 'frame' ? 'text/plain' : 'application/octet-stream';
}
// purpose 'preview' → previewMime(); anything else (download, open, print) → the file's real type.
function attBlob(id, purpose = 'file') {
  const a = own(S.doc?.attachments, id);
  const b64 = S.attData.get(id);
  if (!a || !b64) return null;
  const type = purpose === 'preview' ? previewMime(a.mime) : a.mime || 'application/octet-stream';
  return new Blob([b64ToBytes(b64)], { type });
}
// Cached blob URLs (revoked on replace / project switch): S.attURLs for previews, S.attFileURLs with the real type.
// One URL per attachment and purpose: creating a blob URL per render would leak memory (they live until revoked)
// and would defeat the preview-keeping logic of canvas.js, which matches previews by URL.
function cachedURL(map, id, purpose) {
  if (!id) return '';
  let u = map.get(id);
  if (u) return u;
  const blob = attBlob(id, purpose);
  if (!blob) return '';
  try { u = URL.createObjectURL(blob); } catch { return ''; }
  map.set(id, u);
  return u;
}
function attURL(id) { return cachedURL(S.attURLs, id, 'preview'); }
function attFileURL(id) { return cachedURL(S.attFileURLs, id, 'file'); }
function revokeAttURL(id) {
  for (const m of [S.attURLs, S.attFileURLs]) {
    const u = m.get(id);
    if (u) { try { URL.revokeObjectURL(u); } catch { /* ignore */ } m.delete(id); }
  }
}
function revokeAllAttURLs() { for (const id of new Set([...S.attURLs.keys(), ...S.attFileURLs.keys()])) revokeAttURL(id); }

// Attachment data is untrusted (imported projects): a blob URL shares the editor's origin, so a document that
// can run script (html, xhtml, xml, svg…) must never be navigated to directly — it would reach IndexedDB.
const mimeOf = (a) => String(a?.mime || '').split(';')[0].trim().toLowerCase();
// Passive types a browser shows (or downloads) without running script in the page origin.
const SAFE_OPEN_MIME = /^(application\/pdf|image\/(png|jpe?g|pjpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)|text\/(plain|csv|markdown)|(audio|video)\/[\w.+-]+)$/;

// Download / open / print buttons of attachment blocks inside the canvas (the export runtime is not loaded here).
function attButton(btn) {
  const id = btn.dataset.att;
  const a = own(S.doc?.attachments, id);
  if (!a || !S.attData.get(id)) { toast(t('err.generic', { msg: 'missing file' }), 'error'); return; }
  if (btn.hasAttribute('data-att-dl')) downloadAttachment(id);
  else if (btn.hasAttribute('data-att-op')) openAttachment(id);
  else printAttachment(id);
}

// Print through a hidden frame: only PDF, images (an <img> never runs script, SVG included) and plain text.
// Other types are downloaded instead.
function printAttachment(id) {
  const a = own(S.doc?.attachments, id);
  const u = attFileURL(id);
  if (!a || !u) { toast(t('err.generic', { msg: 'missing file' }), 'error'); return; }
  const m = mimeOf(a);
  const pdf = m === 'application/pdf';
  const img = /^image\/[\w.+-]+$/.test(m);
  if (!pdf && !img && m !== 'text/plain') {
    downloadAttachment(id);
    toast(t('files.printDl'), 'warn');
    return;
  }
  const fr = h('iframe', { tabindex: '-1', 'aria-hidden': 'true', style: { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' } });
  // allow-same-origin without allow-scripts is safe: nothing can run to exploit the shared origin; it is needed so
  // the parent can call contentWindow.print(). PDF viewers do not run in sandboxed frames; images (srcdoc + <img>) and text/plain get no script at all.
  if (!pdf) fr.setAttribute('sandbox', 'allow-modals allow-same-origin');
  fr.onload = () => {
    try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch { openAttachment(id); }
    setTimeout(() => fr.remove(), 60000);
  };
  if (img) {
    fr.srcdoc = `<!doctype html><title>${esc(a.name)}</title><style>@page{margin:10mm}html,body{margin:0;height:100%}`
      + `img{display:block;max-width:100%;max-height:100vh;margin:auto;object-fit:contain}</style><img src="${esc(u)}">`;
  } else fr.src = u;
  document.body.append(fr);
}

// Attachment references: block props and item fields declared with type 'att' in the registry (att, photo, logo,
// media…), document-level keys of the product (ED.metaAttKeys: meta.favicon…), uploaded fonts 'asset:<id>' in
// theme.fontBody / fontHead, and '#att-<id>' links inside texts.
// Reference detection is by key name (any field declared type 'att' anywhere in the registry), not by schema path:
// one Set lookup per string instead of resolving each block's schema. A string equal to an id under such a key is a
// reference; ids are random, so accidental matches are practically impossible.
let attKeyCache = null;
function attKeys() {
  if (attKeyCache) return attKeyCache;
  const keys = new Set(['att']);
  for (const def of Object.values(BLOCK_TYPES)) {
    for (const f of [...(def.schema || []), ...(def.itemSchema || [])]) if (f && f.type === 'att' && typeof f.key === 'string') keys.add(f.key);
  }
  attKeyCache = keys;
  return keys;
}
const metaAttKeys = () => ED.metaAttKeys || [];
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isAttRef = (s, k, id) => s === id && (attKeys().has(k) || metaAttKeys().includes(k));

// Visit every string of the document's content (regions, meta, theme fonts, the product's document-level texts) with
// fn(value, key, owner) → new value.
function mapDocStrings(doc, fn) {
  const rec = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 60) return;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === 'string') { const nv = fn(v, k, o); if (nv !== v) o[k] = nv; }
      else if (v && typeof v === 'object' && k !== 'data') rec(v, depth + 1);
    }
  };
  const keys = (o, list) => { if (isObj(o)) for (const k of list) { const v = o[k]; if (typeof v === 'string') { const nv = fn(v, k, o); if (nv !== v) o[k] = nv; } } };
  rec(doc.regions, 1);
  keys(doc.meta, metaAttKeys());
  if (isObj(doc.meta)) { rec(doc.meta.title, 1); rec(doc.meta.description, 1); }
  keys(doc.theme, ['fontBody', 'fontHead']);
  for (const o of ED.i18nRoots ? ED.i18nRoots(doc) : []) rec(o, 1);
}

// How many times an attachment id is referenced (fields, fonts, links in texts).
function attUsage(id, doc = S.doc) {
  if (!doc || !id) return 0;
  const linkRe = new RegExp('#att-' + escRe(id) + '(?![A-Za-z0-9_-])', 'g');
  let n = 0;
  mapDocStrings(doc, (s, k) => {
    if (isAttRef(s, k, id)) n++;
    else if (s === 'asset:' + id) n++;
    else if (s.includes('#att-' + id)) n += (s.match(linkRe) || []).length;
    return s;
  });
  return n;
}

// A new block showing attachment `a`: pictures → image, everything else → the product's file block (embed /
// attachment; audio and video with the native player when the type offers one). null when no fitting type exists.
function blockForAttachment(a) {
  const mime = mimeOf(a);
  try {
    if (isImageMime(mime) && own(BLOCK_TYPES, 'image')) return newBlock('image', { att: a.id });
    const ty = ['embed', 'attachment'].find((x) => own(BLOCK_TYPES, x));
    if (!ty) return null;
    const props = { att: a.id };
    const playerField = (typeDef(ty).schema || []).find((f) => f && f.key === 'player');
    if (/^(audio|video)\//.test(mime) && playerField && (playerField.options || []).some((o) => o.v === 'native')) props.player = 'native';
    return newBlock(ty, props);
  } catch (e) { console.error(e); return null; }
}

// Read files into attachments; opts.insert = {listPath, index} inserts image/attachment blocks there.
// Reads everything first, then ONE commit: a multi-file drop is a single undo step and a single render.
// Fonts and assets are added to Files but never get a block. A failing file is reported and skipped, not fatal.
async function addFiles(files, opts = {}) {
  files = Array.from(files || []).filter((f) => f && f.size >= 0);
  // Over the cap: refused before anything is read.
  files = files.filter((f) => {
    if (f.size <= MAX_ATT_FILE) return true;
    toast(t('files.tooBig', { name: f.name || 'file', size: fmtBytes(f.size), max: fmtBytes(MAX_ATT_FILE) }), 'error');
    return false;
  });
  if (!files.length) return [];
  const total = files.reduce((n, f) => n + f.size, 0);
  if (!(await checkStorageRoom(total))) {
    toast(t('files.quota'), 'warn', { label: t('io.saveToFile'), fn: () => saveFile(false) }, { sticky: true });
  }
  const added = [];
  for (const f of files) {
    try {
      const b64 = await readFileB64(f);
      const mime = guessMime(f.name, f.type);
      const font = isFontMime(mime, f.name);
      const a = { id: uid(), name: f.name || 'file', mime, size: f.size, title: {}, desc: {}, asset: opts.asset ?? font, added: nowISO() };
      if (ED.newAttachment) ED.newAttachment(a, opts);
      S.attData.set(a.id, b64);
      if (f.size > BIG_FILE) toast(t('files.big', { name: a.name, size: fmtBytes(f.size) }), 'warn');
      added.push(a);
    } catch (e) {
      console.error(e);
      toast(t('files.readErr', { name: f.name }), 'error');
    }
  }
  if (!added.length) return [];
  // The data is written to IDB by the next autosave, in the same transaction as the record referencing it.
  let firstBlock = null;
  commit('upload', (d) => {
    for (const a of added) d.attachments[a.id] = a;
    if (opts.insert) {
      const list = getList(opts.insert.listPath);
      if (list) {
        let at = Math.min(opts.insert.index ?? list.length, list.length);
        for (const a of added) {
          if (a.asset || isFontMime(a.mime, a.name)) continue;
          const b = blockForAttachment(a);
          if (!b) continue;
          list.splice(at++, 0, b);
          if (!firstBlock) firstBlock = b.id;
        }
      }
    }
  }, { render: 'all' });
  if (firstBlock) select(firstBlock, null, { scroll: true });
  if (added.length > 1 || !opts.quiet) toast(t('files.added', { n: added.length }), 'ok');
  return added.map((a) => a.id);
}

// Point every reference to attachment `from` at `to` (att fields, font assets, #att- links in any text).
function remapAttRefs(doc, from, to) {
  const linkRe = new RegExp('#att-' + escRe(from) + '(?![A-Za-z0-9_-])', 'g');
  mapDocStrings(doc, (s, k) => {
    if (isAttRef(s, k, from)) return to;
    if (s === 'asset:' + from) return 'asset:' + to;
    return s.includes('#att-' + from) ? s.replace(linkRe, '#att-' + to) : s;
  });
}

// Replacing the content creates a new attachment id (and remaps references) in one undoable commit:
// undo brings back the old id, whose data is still in memory, so name/mime and bytes always match.
async function replaceAttachment(id) {
  const a = own(S.doc.attachments, id);
  if (!a) return;
  const m = mimeOf(a);
  const [f] = await pickFiles({ accept: isImageMime(m) ? 'image/*' : /^(audio|video)\//.test(m) ? m.split('/')[0] + '/*' : '' });
  if (!f) return;
  if (f.size > MAX_ATT_FILE) { toast(t('files.tooBig', { name: f.name || 'file', size: fmtBytes(f.size), max: fmtBytes(MAX_ATT_FILE) }), 'error'); return; }
  if (!(await checkStorageRoom(f.size))) toast(t('files.quota'), 'warn', { label: t('io.saveToFile'), fn: () => saveFile(false) }, { sticky: true });
  let b64;
  try { b64 = await readFileB64(f); } catch (e) { toast(t('files.readErr', { name: f.name }), 'error'); return; }
  if (!own(S.doc.attachments, id)) return; // deleted / project switched meanwhile
  const nid = uid();
  S.attData.set(nid, b64);
  if (f.size > BIG_FILE) toast(t('files.big', { name: f.name, size: fmtBytes(f.size) }), 'warn');
  commit('replace file', (d) => {
    const old = own(d.attachments, id);
    if (!old) return;
    const nu = { ...clone(old), id: nid, name: f.name || old.name || 'file', mime: guessMime(f.name, f.type), size: f.size, added: nowISO() };
    // Same position in the attachments map (Files panel order).
    d.attachments = Object.fromEntries(Object.entries(d.attachments).map(([k, v]) => (k === id ? [nid, nu] : [k, v])));
    remapAttRefs(d, id, nid);
  }, { render: 'all' });
  toast(t('files.replaced'), 'ok');
}

// References are cleared, not left dangling: att fields become null, font assets fall back to the 'sans' stack,
// links are unwrapped to plain text.
async function deleteAttachment(id) {
  const a = own(S.doc.attachments, id);
  if (!a) return;
  const n = attUsage(id);
  const ok = await confirmDialog(t('files.delete'), n ? t('files.confirmDelUsed', { name: a.name, n }) : t('files.confirmDel', { name: a.name }), t('dlg.delete'), true);
  if (!ok) return;
  // Binary data stays in memory (S.attData) so undo can restore the attachment; autosave drops it from IDB.
  commit('delete file', (d) => {
    delete d.attachments[id];
    mapDocStrings(d, (s, k) => {
      if (isAttRef(s, k, id)) return null;
      if (s === 'asset:' + id) return 'sans';
      return s;
    });
    unlinkAttRefs(d, id);
  }, { render: 'all' });
}

// Unwrap every <a href="#att-ID"> in the document's texts (rich, inline and table cells), keeping the link text.
// Parsed through an inert <template> (no script, no loads) instead of a regex: removing an element while keeping
// its children is a tree operation; a regex would break on nested or attribute-reordered markup.
function unlinkAttRefs(doc, id) {
  const href = '#att-' + id;
  const linkRe = new RegExp(escRe(href) + '(?![A-Za-z0-9_-])');
  eachI18n(doc, (o) => {
    for (const k of Object.keys(o)) {
      const s = o[k];
      if (typeof s !== 'string' || !linkRe.test(s)) continue;
      const tp = document.createElement('template');
      tp.innerHTML = s;
      let n = 0;
      for (const a of tp.content.querySelectorAll('a[href]')) {
        if (a.getAttribute('href') !== href) continue;
        a.replaceWith(...a.childNodes);
        n++;
      }
      if (n) o[k] = tp.innerHTML;
    }
  });
}

function downloadAttachment(id) {
  const a = own(S.doc.attachments, id);
  const blob = attBlob(id);
  if (a && blob) downloadBlob(blob, a.name || 'file');
}
// Open in a new tab. Passive types are opened directly; anything that could run script (html, svg, xml…)
// or is unknown is shown inside a sandboxed frame (opaque origin, no scripts) of an empty new window.
function openAttachment(id) {
  const a = own(S.doc?.attachments, id);
  const u = attFileURL(id);
  if (!a || !u) { toast(t('err.generic', { msg: 'missing file' }), 'error'); return; }
  if (SAFE_OPEN_MIME.test(mimeOf(a))) { window.open(u, '_blank', 'noopener'); return; }
  let w = null;
  try { w = window.open('', '_blank'); } catch { w = null; }
  if (!w) { downloadAttachment(id); return; }
  // Blank window built by DOM calls (no document.write of untrusted text); opener cut so the new page cannot
  // navigate the editor. The frame sandbox without allow-scripts gives the file an opaque origin and no script.
  try {
    w.opener = null;
    const d = w.document;
    d.title = a.name || 'file';
    const st = d.createElement('style');
    st.textContent = 'html,body{margin:0;height:100%;background:#fff}';
    const fr = d.createElement('iframe');
    fr.setAttribute('sandbox', 'allow-downloads');
    fr.setAttribute('title', a.name || 'file');
    fr.style.cssText = 'border:0;position:fixed;inset:0;width:100%;height:100%';
    fr.src = u;
    d.head.append(st);
    d.body.append(fr);
  } catch (e) {
    console.warn(e);
    try { w.close(); } catch { /* ignore */ }
    downloadAttachment(id);
  }
}

export {
  addFiles,
  attButton,
  attURL,
  attUsage,
  blockForAttachment,
  deleteAttachment,
  downloadAttachment,
  mimeOf,
  openAttachment,
  remapAttRefs,
  replaceAttachment,
  revokeAllAttURLs
};
