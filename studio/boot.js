// studio/boot.js - editor start-up: UI language, preferences, rich text, global bindings, last project (or a new one).
// The application registers its product (doc/product.js) and editor configuration (studio/config.js) first.
import { clamp, h, lsGet } from '../ui/dom.js';
import { UI_STATE, applyStaticI18n, detectUILang, t } from '../ui/i18n.js';
import { toast } from '../ui/overlays.js';
import { ED } from './config.js';
import { setUILang } from './i18n.js';
import { S, edKey } from './state.js';
import { findBlock, fullDoc } from './doc.js';
import { commit, redo, undo } from './history.js';
import { DB, enterProject, flushSave, markDirty, saveProject } from './db.js';
import { remapAttRefs } from './attach.js';
import { ZOOM_MAX, ZOOM_MIN, applyDarkPreview, pageFits, renderCanvas, setZoomFit } from './canvas.js';
import { select } from './select.js';
import { insertBlock } from './ops.js';
import { NARROW_MQ, setNarrow } from './shell.js';
import { blankDoc, loadDoc, openProject } from './projects.js';
import { openTemplates, templatesList } from './gallery.js';
import { openExport } from './export.js';
import { bindGlobal } from './global.js';
import { RT_S } from '../richtext/sanitize.js';
import { rtInit } from '../richtext/input.js';
import { TBL_S, tblInit } from '../richtext/table-ui.js';

// Every stored preference is validated against the allowed set: localStorage survives versions and products may
// change their tabs, so a stale value must fall back to a default instead of rendering an empty panel.
function loadPrefs() {
  S.zoom = clamp(+lsGet(edKey('zoom'), 1) || 1, ZOOM_MIN, ZOOM_MAX);
  S.zoomFit = lsGet(edKey('zoomfit'), false) === true;
  S.guides = lsGet(edKey('guides'), true) !== false;
  S.darkPreview = lsGet(edKey('dark'), false) === true;
  if (ED.stage.init) ED.stage.init();
  applyDarkPreview();
  const lt = lsGet(edKey('ltab'), 'blocks');
  S.leftTab = ['blocks', 'outline', 'files'].includes(lt) ? lt : 'blocks';
  const rt = lsGet(edKey('rtab'), 'block');
  S.rightTab = ['block', 'document'].includes(rt) ? rt : 'block';
  const dt = lsGet(edKey('dtab'), 'theme');
  S.docTab = (ED.docTabs || []).some(([k]) => k === dt) ? dt : ((ED.docTabs || [])[0] || [''])[0];
  const p = lsGet(edKey('panels'), {}) || {};
  S.noLeft = !!p.noLeft;
  S.noRight = !!p.noRight;
  if (NARROW_MQ && NARROW_MQ.matches) setNarrow(true, true);
  S.clip = lsGet(edKey('clip'), null);
}

// Boot failure replaces the loading box with the message: the editor shell may not exist yet, so no toast/dialog.
function bootFail(e) {
  console.error(e);
  const box = document.getElementById('ed-loading');
  if (box) {
    box.classList.add('ed-load-err');
    box.textContent = '';
    box.append(h('p', {}, t('err.generic', { msg: e && e.message ? e.message : String(e) })));
  }
}

async function boot() {
  UI_STATE.storageKey = edKey('ui');
  S.uiLang = detectUILang();
  document.documentElement.lang = S.uiLang;
  loadPrefs();
  applyStaticI18n();
  try { rtInit(); } catch (e) { console.error('rtInit failed', e); }
  try { tblInit(); } catch (e) { console.error('tblInit failed', e); }
  bindGlobal();

  // Project choice: the remembered last project, else the most recently modified one. Any IndexedDB failure
  // (private mode, disabled storage, blocked upgrade) degrades to an in-memory session, never a dead editor.
  // ISO timestamps compare correctly as strings, hence localeCompare on modified.
  let rec = null, files = new Map();
  try {
    await DB.open();
    S.idb = true;
    const last = await DB.get('kv', 'lastProject');
    if (last) rec = await DB.get('projects', last);
    if (!rec) {
      const all = await DB.all('projects');
      all.sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
      rec = all[0] || null;
    }
    if (rec) files = await DB.getPrefix('files', rec.id + ':');
  } catch (e) {
    console.warn('IndexedDB unavailable', e);
    S.idb = false;
    rec = null;
  }

  // loadDoc returns false on a corrupt stored record: fall back to a blank document instead of failing boot.
  let firstRun = false;
  if (rec && rec.doc && loadDoc(rec.doc, { files, baseModified: rec.modified })) {
    await enterProject(rec.id); // read-only when another tab is editing it
    try { const hd = await DB.get('kv', 'handle:' + rec.id); if (hd) S.fileHandle = hd; } catch { /* ignore */ }
  } else {
    firstRun = true;
    loadDoc(blankDoc());
    if (S.idb) { await enterProject(S.doc.id); S.saveState = 'unsaved'; await saveProject(); } else markDirty();
  }

  // First load: a page wider than the stage (small window) starts in fit-width zoom.
  if (!S.zoomFit && !pageFits()) setZoomFit(true, false);
  S.ready = true;
  window.__edReady = true;
  // Debug / automation handle (read-mostly; the app never relies on it).
  window.__ed = { S, V: ED.api, fullDoc, commit, findBlock, select, undo, redo, renderCanvas, insertBlock, RT_S, TBL_S, t, setUILang,
    openProject, saveProject, flushSave, remapAttRefs, openExport };
  document.documentElement.classList.remove('ed-is-loading');
  const ld = document.getElementById('ed-loading');
  if (ld) ld.remove();
  if (!S.idb) toast(t('st.memory'), 'warn');
  if (firstRun && templatesList().length > 1) openTemplates();
}

// Entry point. Fail fast on a missing stage: every layout path reads ED.stage, a later crash would be far less clear.
export function startEditor() {
  if (!ED.stage) { bootFail(new Error('defineEditor: no stage (studio/stage.js)')); return; }
  boot().catch(bootFail);
}
