// studio/projects.js - projects: new / open / start, the Projects dialog, initial content language.
import { own } from '../util/value.js';
import { newDoc, normalizeDoc } from '../doc/model.js';
import { uid } from '../util/id.js';
import { P } from '../doc/product.js';
import { clone, h, isObj, nowISO } from '../ui/dom.js';
import { SUGGESTED_LANGS, canonLang, fmtDate } from '../ui/lang.js';
import { icon } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { confirmDialog, openDialog, promptDialog, toast } from '../ui/overlays.js';
import { S } from './state.js';
import { commit, flushRT } from './history.js';
import { DB, autosave, claimProject, enterProject, flushSave, guardUnsaved, lockedElsewhere, markDirty, peerPost, releaseProject, renderBanner, saveProject, saving, setReadOnly } from './db.js';
import { revokeAllAttURLs } from './attach.js';
import { renderAll, renderTop } from './shell.js';
import { openTemplates } from './gallery.js';

// ===========================================================================
// 21. Projects
// ===========================================================================

//
// Lifecycle: loadDoc (normalise, split bytes into S.attData, reset history and selection, render) -> enterProject
// (claim the write lock or go read-only) -> autosave. Every path that replaces the open document first runs
// guardUnsaved (never lose edits silently) and awaits the save queue (saving), so a pending save of the old project
// can never land after the switch.

// Attachments of raw (unnormalized) input whose data normalizeDoc dropped as invalid (kept metadata-only).
function lostAttData(raw, doc) {
  const ra = isObj(raw) && isObj(raw.attachments) ? raw.attachments : {};
  let n = 0;
  for (const id of Object.keys(ra)) {
    const a = own(ra, id);
    const d = own(doc?.attachments, id);
    if (isObj(a) && typeof a.data === 'string' && a.data.trim() && isObj(d) && typeof d.data !== 'string') n++;
  }
  return n;
}

// Load a doc into the editor. raw may carry attachment data; files: Map(attId → base64) from IDB.
// Returns false (with a toast) and keeps the current document when raw cannot be loaded; never loads raw itself.
// History is reset on load: undo across projects would restore another project's snapshot into this one.
// Blob URLs of the previous project are revoked here (they would otherwise leak for the whole session).
function loadDoc(raw, opts = {}) {
  let doc = null;
  try { doc = normalizeDoc(raw); } catch (e) { console.error(e); doc = null; }
  // normalizeDoc never throws (hopeless input becomes a blank doc): input that is not an object, or a result without
  // the document structure, is a failed load too.
  if (!isObj(raw) || !isObj(doc) || !isObj(doc.regions) || !Array.isArray(doc.langs) || !doc.langs.length) {
    toast(t('io.badFile'), 'error');
    return false;
  }
  const lost = lostAttData(raw, doc);
  if (lost) toast(t('io.attLost', { n: lost }), 'warn');
  if (!doc.id) doc.id = uid();
  revokeAllAttURLs();
  S.attData = new Map();
  for (const [id, a] of Object.entries(doc.attachments || {})) {
    if (a.data) S.attData.set(id, a.data);
    else if (opts.files && opts.files.has(id)) S.attData.set(id, opts.files.get(id));
    delete a.data;
  }
  S.doc = doc;
  S.hist = { undo: [], redo: [], key: null, time: 0 };
  S.sel = { bid: null, item: null };
  S.lang = doc.langs.includes(opts.lang) ? opts.lang : doc.defaultLang || doc.langs[0];
  S.fileHandle = opts.handle || null;
  S.saveState = S.idb ? 'saved' : 'memory';
  S.readOnly = null;
  // `modified` of the stored record this doc came from (undefined: new / replacing → first save overwrites).
  S.baseModified = typeof opts.baseModified === 'string' ? opts.baseModified : undefined;
  renderAll();
  return true;
}

// opts.force: reload even when already open, without the unsaved-work guard; opts.steal: take the project
// over from another tab that is writing it.
async function openProject(id, opts = {}) {
  if (!opts.force && S.doc && S.doc.id === id) return true;
  flushRT();
  if (!opts.force && !(await guardUnsaved())) return false;
  await saving;
  try {
    // Taking over: become the writer first, so the record read below is the final one.
    if (opts.steal && S.idb) await claimProject(id, true);
    const rec = await DB.get('projects', id);
    if (!rec) throw new Error('not found');
    const files = await DB.getPrefix('files', id + ':');
    if (!loadDoc(rec.doc, { files, baseModified: rec.modified, lang: opts.force && S.doc && S.doc.id === id ? S.lang : undefined })) return false;
    if (!opts.steal) await enterProject(id);
    let handle = null;
    try { handle = await DB.get('kv', 'handle:' + id); } catch { /* ignore */ }
    if (S.doc && S.doc.id === id) S.fileHandle = handle || null;
    if (!S.readOnly) await DB.put('kv', id, 'lastProject');
    toast(t('io.opened', { name: S.doc.name || t('pj.untitled') }), 'ok');
    return true;
  } catch (e) {
    toast(t('io.loadErr', { msg: e.message }), 'error');
    return false;
  }
}

// Start a new project from a (full) doc. Resolves false when the user kept the current document.
// opts: loadDoc options + noGuard (skip the unsaved-work check), rewrite (re-write every stored file).
async function startProject(doc, opts = {}) {
  flushRT();
  if (!opts.noGuard && !(await guardUnsaved())) return false;
  await saving;
  if (!loadDoc(doc, opts)) return false;
  if (!S.idb) { markDirty(); return true; }
  await enterProject(S.doc.id);
  if (!S.readOnly) { S.saveState = 'unsaved'; await saveProject({ rewrite: !!opts.rewrite }); }
  return true;
}

// Content language for a new document: the editor UI language, else the visitor's first preferred language
// that has editor/viewer UI support (primary subtag), else English.
// Only the primary subtag ('pt' from 'pt-BR'): the starting language should be one the viewer UI supports.
function initialContentLang() {
  const ok = P.uiLangs || SUGGESTED_LANGS;
  const prefs = [S.uiLang, ...(navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language])];
  for (const p of prefs) {
    const pr = String(canonLang(p) || '').toLowerCase().split('-')[0];
    if (pr && ok.includes(pr)) return pr;
  }
  return 'en';
}
function blankDoc() {
  return newDoc({ langs: [initialContentLang()], name: t('pj.untitled') });
}

function newProject() {
  let d;
  try { d = blankDoc(); } catch (e) { toast(t('err.generic', { msg: e.message }), 'error'); return; }
  startProject(d);
}

async function openProjects() {
  const body = h('div', { class: 'ed-projects' });
  let api = null;
  const fill = async () => {
    body.textContent = '';
    if (!S.idb) { body.append(h('p', { class: 'ed-muted' }, t('st.memory'))); return; }
    await flushSave();
    let recs = [];
    try { recs = await DB.all('projects'); } catch (e) { body.append(h('p', {}, t('io.loadErr', { msg: e.message }))); return; }
    recs.sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
    if (!recs.length) body.append(h('p', { class: 'ed-muted' }, t('pj.empty')));
    const list = h('ul', { class: 'ed-proj-list' });
    for (const r of recs) {
      const cur = S.doc && r.id === S.doc.id;
      const langs = (r.doc?.langs || []).map((l) => l.toUpperCase()).join(' · ');
      const nFiles = Object.keys(r.doc?.attachments || {}).length;
      list.append(h('li', { class: 'ed-proj' + (cur ? ' ed-on' : '') },
        h('button', { type: 'button', class: 'ed-proj-main', onclick: async () => { api?.close(null); await openProject(r.id); } },
          h('span', { class: 'ed-proj-ic', html: icon('file') }),
          h('span', { class: 'ed-proj-info' },
            h('strong', {}, r.name || t('pj.untitled')),
            h('small', { class: 'ed-muted' }, [fmtDate(r.modified), langs, nFiles ? t('pj.files', { n: nFiles }) : ''].filter(Boolean).join(' · '))),
          cur ? h('span', { class: 'ed-badge' }, t('pj.current')) : null),
        h('button', { type: 'button', class: 'ed-iconbtn', title: t('pj.rename'), 'aria-label': t('pj.rename'), html: icon('edit'), onclick: async () => { await renameProject(r); fill(); } }),
        h('button', { type: 'button', class: 'ed-iconbtn', title: t('pj.dup'), 'aria-label': t('pj.dup'), html: icon('copy'), onclick: async () => { await duplicateProject(r); fill(); } }),
        h('button', { type: 'button', class: 'ed-iconbtn ed-danger', title: t('pj.del'), 'aria-label': t('pj.del'), html: icon('trash'), onclick: async () => { if (await deleteProject(r)) fill(); } })));
    }
    body.append(list, h('p', { class: 'ed-hint' }, t('pj.storage')));
  };
  openDialog({
    title: t('pj.title'), body, wide: true,
    buttons: [
      { label: t('top.newBlank'), icon: 'file', value: 'blank' },
      { label: t('top.newTemplate'), icon: 'template', value: 'tpl' },
      { label: t('dlg.close'), value: null, primary: true },
    ],
    onMount: (a) => { api = a; fill(); },
  }).then((v) => { if (v === 'blank') newProject(); else if (v === 'tpl') openTemplates(); });
}

// Renaming a non-open project writes the record directly (no load). The new modified + 'saved' broadcast make
// another tab that has it open go stale instead of overwriting the rename on its next autosave.
async function renameProject(r) {
  let nv = await promptDialog(t('pj.rename'), t('pj.newName'), r.name || '');
  if (nv == null) return;
  nv = nv.trim() || t('pj.untitled');
  if (S.doc && S.doc.id === r.id) { commit('rename', () => { S.doc.name = nv; }, { render: 'none' }); await saveProject(); renderTop(); return; }
  r.name = nv;
  if (r.doc) r.doc.name = nv;
  // A new `modified` makes a tab that has this project open notice the change (no silent overwrite).
  r.modified = nowISO();
  if (r.doc?.meta) r.doc.meta.modified = r.modified;
  await DB.put('projects', r);
  peerPost({ t: 'saved', id: r.id, modified: r.modified });
}

async function duplicateProject(r) {
  const isCur = S.doc && S.doc.id === r.id;
  if (isCur) { flushRT(); await flushSave(); }
  const src = isCur ? { ...r, doc: clone(S.doc) } : r;
  const nid = uid();
  const doc = clone(src.doc);
  doc.id = nid;
  doc.name = (src.name || t('pj.untitled')) + t('pj.copySuffix');
  if (doc.meta) { doc.meta.created = nowISO(); doc.meta.modified = nowISO(); }
  const data = await DB.getPrefix('files', r.id + ':');
  if (isCur) for (const [aid, b64] of S.attData) data.set(aid, b64); // this tab's data (may not be stored yet)
  const ids = new Set(Object.keys(doc.attachments || {}));
  await DB.saveDoc({ id: nid, name: doc.name, modified: doc.meta?.modified || nowISO(), doc }, ids, data, { rewrite: true });
}

// Order matters: stop autosave and drop the lock BEFORE deleting, otherwise a queued save would re-create the
// record. Record and files are deleted in two transactions; a crash in between leaves orphan file records that
// nothing references (invisible, only wasted space).
// KNOWN DEFECT: DB.del / DB.delPrefix / DB.all are not wrapped in try/catch; a storage error rejects the promise,
// and the Projects dialog caller (if (await deleteProject(r)) fill()) leaves it unhandled, so the user gets no
// message. Fix: wrap the DB section in try/catch and toast t('io.saveErr', { msg }).
async function deleteProject(r) {
  const isCur = S.doc && S.doc.id === r.id;
  const elsewhere = !isCur && (await lockedElsewhere(r.id));
  const ok = await confirmDialog(t('pj.del'), t(elsewhere ? 'pj.delOpenQ' : 'pj.delQ', { name: r.name || t('pj.untitled') }), t('dlg.delete'), true);
  if (!ok) return false;
  if (isCur) {
    // No save may run (or re-create the record) after the delete.
    autosave.cancel();
    if (S.doc && S.doc.id === r.id) setReadOnly('deleted');
    releaseProject();
  }
  await saving;
  await DB.del('projects', r.id);
  await DB.delPrefix('files', r.id + ':');
  try { await DB.del('kv', 'handle:' + r.id); } catch { /* ignore */ }
  peerPost({ t: 'deleted', id: r.id });
  toast(t('pj.deleted'), 'ok');
  if (isCur && S.doc && S.doc.id === r.id) {
    const recs = (await DB.all('projects')).sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
    S.doc = null;
    renderBanner();
    if (recs[0]) await openProject(recs[0].id);
    else { let d; try { d = blankDoc(); } catch { d = null; } if (d) await startProject(d); }
  }
  return true;
}

export {
  blankDoc,
  initialContentLang,
  loadDoc,
  lostAttData,
  newProject,
  openProject,
  openProjects,
  startProject
};
