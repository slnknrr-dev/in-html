// studio/fileio.js - open (project JSON, exported HTML with embedded source, product importers such as Markdown),
// save project files, and the product's extra export formats (ED.exporters).
import { extractSource } from '../doc/export.js';
import { normalizeDoc } from '../doc/model.js';
import { uid } from '../util/id.js';
import { isObj } from '../ui/dom.js';
import { downloadBlob, fmtBytes, pickFiles, safeFileName } from '../ui/files.js';
import { t } from '../ui/i18n.js';
import { openDialog, toast } from '../ui/overlays.js';
import { MAX_PROJECT_FILE, S } from './state.js';
import { fullDoc, sanitizeDocRich } from './doc.js';
import { flushRT } from './history.js';
import { DB, autosave, flushSave, lockedElsewhere, saving } from './db.js';
import { lostAttData, startProject } from './projects.js';
import { ED } from './config.js';
import { P } from '../doc/product.js';

//
// Trust model: every opened file is untrusted input. Size cap before reading, format marker check (P.format),
// normalizeDoc (schema repair) and sanitizeDocRich (rich-text HTML allowlist) before it reaches the editor. An exported
// HTML page is never executed: extractSource reads the embedded source as data.
// Saving: File System Access API when available (write back to the same file, Ctrl+S without a dialog), otherwise a
// download. Every path ends with flushSave so IndexedDB is not behind the file just written.

// Extensions the open dialogs accept: projects, exported pages and the product's importers (ED.importers).
const importExts = () => (ED.importers || []).flatMap((x) => String(x.accept || '').split(',').map((e) => e.trim()).filter(Boolean));
// A file the editor opens as a project (dropped files that are not are added to Files).
const importable = (name) => /\.(json|html?)$/i.test(name) || importExts().some((e) => e.startsWith('.') && name.toLowerCase().endsWith(e.toLowerCase()));

// AbortError = user cancelled the picker: silent. Any other picker failure (iframe, policy) falls back to <input>.
async function openFileDialog() {
  if ('showOpenFilePicker' in window) {
    try {
      const [hd] = await window.showOpenFilePicker({
        types: [{ description: t('io.typeOpen'), accept: { 'application/json': ['.json'], 'text/html': ['.html', '.htm'], ...(importExts().length ? { 'text/plain': importExts() } : {}) } }],
        excludeAcceptAllOption: false, multiple: false,
      });
      if (!hd) return;
      const file = await hd.getFile();
      await importFile(file, /\.json$/i.test(file.name) ? hd : null);
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      console.warn(e);
    }
  }
  const [f] = await pickFiles({ accept: ['.json', '.html', '.htm', 'application/json', 'text/html', ...importExts()].join(',') });
  if (f) await importFile(f);
}

async function importFile(file, handle = null) {
  let doc = null;
  if (file.size > MAX_PROJECT_FILE) {
    toast(t('io.tooBig', { name: file.name || 'file', size: fmtBytes(file.size), max: fmtBytes(MAX_PROJECT_FILE) }), 'error');
    return;
  }
  try {
    const text = await file.text();
    const trimmed = text.trimStart();
    const imp = (ED.importers || []).find((x) => x.test(file.name || '', text));
    if (imp) {
      // A foreign format becomes a new project (never replaces an existing one).
      doc = await imp.load(text, file.name || '', file);
      if (!doc) { toast(t('io.badFile'), 'error'); return; }
      doc.id = uid();
      handle = null;
    } else if (/\.json$/i.test(file.name) || trimmed.startsWith('{')) {
      try { const j = JSON.parse(text); if (j && j.format === P.format) doc = j; } catch { doc = null; }
      if (!doc) { toast(t('io.badFile'), 'error'); return; }
    } else {
      doc = await extractSource(text);
      if (!doc) { toast(t('io.noSource'), 'error'); return; }
      handle = null;
    }
    const raw = doc;
    doc = normalizeDoc(raw);
    if (!isObj(doc) || !isObj(doc.regions)) { toast(t('io.badFile'), 'error'); return; }
    sanitizeDocRich(doc);
    // Reported here: loadDoc only sees the normalized copy.
    const lost = lostAttData(raw, doc);
    if (lost) toast(t('io.attLost', { n: lost }), 'warn');
  } catch (e) {
    toast(t('io.loadErr', { msg: e.message }), 'error');
    return;
  }
  // Same id as a stored or the open project: ask. Replace is refused (silently turned into a copy) when another tab
  // holds that project's write lock, otherwise two writers would overwrite each other.
  let existing = null;
  if (S.idb && doc.id) { try { existing = await DB.get('projects', doc.id); } catch { existing = null; } }
  let replace = false;
  const asCopy = () => { doc.id = uid(); doc.name = (doc.name || t('pj.untitled')) + t('pj.copySuffix'); handle = null; };
  if (existing || (S.doc && S.doc.id === doc.id)) {
    const v = await openDialog({
      title: t('io.exists'), body: t('io.existsQ', { name: existing?.name || S.doc?.name || doc.id }),
      buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('io.asCopy'), value: 'copy' }, { label: t('io.replace'), value: 'replace', primary: true, danger: true }],
    });
    if (!v) return;
    if (v === 'copy') asCopy();
    else if (S.idb && (S.doc && S.doc.id === doc.id ? !!S.readOnly : await lockedElsewhere(doc.id))) {
      // Another tab is writing that project: never replace it underneath; import a copy instead.
      asCopy();
      toast(t('pj.openElsewhere'), 'warn');
    } else replace = true;
  }
  let ok;
  if (replace && S.doc && S.doc.id === doc.id) {
    // Replacing the open project: the user confirmed, so its current state is not flushed. The first save
    // overwrites the record and re-writes every file in one transaction.
    autosave.cancel();
    await saving;
    S.doc = null;
    ok = await startProject(doc, { handle, noGuard: true, rewrite: true });
  } else ok = await startProject(doc, { handle, rewrite: replace });
  if (!ok || !S.doc) return;
  if (handle && S.idb) { try { await DB.put('kv', handle, 'handle:' + S.doc.id); } catch { /* handles not storable in this browser */ } }
  toast(t('io.opened', { name: S.doc.name || file.name }), 'ok');
}

// Resolves true when the project file was written / downloaded.
// Stored handles lose permission across sessions: queryPermission, then requestPermission (needs the user gesture
// of Ctrl+S / click). Indent 1: readable diffs of project files at almost minimal size.
async function saveFile(as = false) {
  flushRT();
  if (!S.doc) return false;
  const json = JSON.stringify(fullDoc(), null, 1);
  const name = safeFileName(S.doc.name) + '.' + ED.fileExt + '.json';
  if ('showSaveFilePicker' in window) {
    try {
      let hd = as ? null : S.fileHandle;
      if (hd && hd.queryPermission) {
        let p = await hd.queryPermission({ mode: 'readwrite' });
        if (p !== 'granted' && hd.requestPermission) p = await hd.requestPermission({ mode: 'readwrite' });
        if (p !== 'granted') hd = null;
      }
      if (!hd) {
        hd = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: t('io.typeProject'), accept: { 'application/json': ['.json'] } }] });
      }
      const w = await hd.createWritable();
      await w.write(json);
      await w.close();
      S.fileHandle = hd;
      if (S.idb) { try { await DB.put('kv', hd, 'handle:' + S.doc.id); } catch { /* not cloneable: keep in memory */ } }
      toast(t('io.saved', { name: hd.name || name }), 'ok');
      await flushSave();
      return true;
    } catch (e) {
      if (e && e.name === 'AbortError') return false;
      console.warn('File System Access save failed, falling back to download', e);
    }
  }
  downloadBlob(new Blob([json], { type: 'application/json' }), name);
  toast(t('io.downloaded', { name }), 'ok');
  await flushSave();
  return true;
}

// Extra export formats of the product (Markdown, plain text…): ED.exporters = [{ label, icon, ext, mime, build(doc, { lang }) }].
async function exportAs(x) {
  flushRT();
  if (!S.doc) return;
  try {
    const out = await x.build(fullDoc(), { lang: S.lang });
    const name = safeFileName(S.doc.name) + '.' + x.ext;
    downloadBlob(out instanceof Blob ? out : new Blob([out], { type: x.mime || 'text/plain;charset=utf-8' }), name);
    toast(t('io.downloaded', { name }), 'ok');
  } catch (e) {
    toast(t('ex.err', { msg: e.message }), 'error');
  }
}

export {
  exportAs,
  importFile,
  importable,
  openFileDialog,
  saveFile
};
