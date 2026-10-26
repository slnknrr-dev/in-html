// knowledge-processor/main.js - the editor page: application shell (ui/app.js header with the base switcher, undo /
// redo, save state, 451 unlock, preview toggle and export), the three columns (pages / media / base settings, page
// editor, live preview; one column at a time on phones with a tab bar), keyboard shortcuts, the first start (a new
// base from the encyclopedia template) and, when a backend serves the page, server storage.
//
// Design rules of this module:
// - Composition root only: it wires panels (ed-*.js) to the store (state.js) through events ('change', 'select',
//   'kb', 'saved', 'error'). Panels never call each other; they reach the shell through the hook objects
//   (stateHooks, pageHooks) filled here. Why: no import cycles, and each panel stays testable in isolation.
// - Repaint granularity: a 'change' with info.structure rebuilds the left panel and the editor; a plain text change
//   only patches the bar and the tree label. Full repaints on every keystroke would destroy focus and caret.
// - UI layout state (active pane, left tab, preview on/off) lives in localStorage, not in the knowledge base:
//   it is per-device preference, must not create undo steps or dirty the document.
// Side-effect import first: strings.js registers the i18n keys before any t() call below.
import './strings.js';
import { $, h, isEditable, lsGet, lsSet } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { startApp } from '../ui/app.js';
import { t } from '../ui/i18n.js';
import { toast } from '../ui/overlays.js';
import { S, canRedo, canUndo, emit, hooks as stateHooks, on, redo, saveNow, select, undo } from './state.js';
import { getKB, isPersistent, lastOpened, listKBs, setLastOpened } from './store.js';
import { setKB } from './state.js';
import { renderPagesPanel, expandTo, hooks as pageHooks } from './ed-pages.js';
import { renderPageEditor } from './ed-page.js';
import { renderMediaPanel, loadSecretMedia, payloadMedia } from './ed-media.js';
import { renderBasePanel } from './ed-base.js';
import { createPreview } from './ed-preview.js';
import { buildExport, openExportDialog } from './ed-export.js';
import { newFromTemplate, openBasesDialog } from './ed-bases.js';
import { lockAll } from './ed-secret.js';
import { server } from './ed-sync.js';
import { probeBackend } from './remote.js';
import { updatePageList } from './ed-fields.js';
import { TEMPLATES } from './templates.js';

const LOGO = 'M4 5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM8 10h3v3H8zM14 11.5h3M8 16.5h9M11 11.5h3';
// Dependency inversion: state.js needs media payloads when saving but must not import the media panel (cycle).
stateHooks.payloadMedia = payloadMedia;

// The DOM skeleton is built once at import; paint* functions only replace children. data-pane drives the phone
// layout purely in CSS (editor.css [data-pane=...]), so switching panes costs no re-render.
const root = h('div', { id: 'kp-ed', class: 'kp-ed', 'data-pane': lsGet('kp-ed-pane', 'edit') });
const leftTabs = h('div', { class: 'kp-ed-ltabs', role: 'tablist' });
const leftPanel = h('div', { class: 'kp-ed-lpanel' });
const center = h('section', { class: 'kp-ed-center', 'aria-label': t('kp.pageEditor') });
const right = h('section', { class: 'kp-ed-right', 'aria-label': t('kp.preview') });
const paneTabs = h('nav', { class: 'kp-ed-tabs', 'aria-label': t('kp.panes') });
let leftTab = lsGet('kp-ed-ltab', 'pages');
let showPreview = lsGet('kp-ed-preview', true);
root.append(h('div', { class: 'kp-ed-main' }, h('aside', { class: 'kp-ed-left' }, leftTabs, leftPanel), center, right), paneTabs);
// Applied before the first paint: avoids a frame with the preview column visible and then collapsing.
root.classList.toggle('kp-no-preview', !showPreview);

// ---- toolbar in the application header
// role=status + aria-live=polite: save state ("Saving", "Saved") is announced without stealing focus.
const status = h('span', { class: 'kp-status', role: 'status', 'aria-live': 'polite' });
const undoBtn = h('button', { type: 'button', class: 'ed-iconbtn', onclick: () => undo() }, iconEl('undo'));
const redoBtn = h('button', { type: 'button', class: 'ed-iconbtn', onclick: () => redo() }, iconEl('redo'));
const baseBtn = h('button', { type: 'button', class: 'ed-btn kp-base-btn', onclick: () => openBasesDialog() }, iconEl('folder'), h('span', { class: 'kp-base-t' }));
const lockBtn = h('button', { type: 'button', class: 'ed-iconbtn kp-lock-btn', onclick: () => lockAll() }, iconEl('lock'));
const pvBtn = h('button', { type: 'button', class: 'ed-iconbtn kp-pv-btn', onclick: () => { showPreview = !showPreview; lsSet('kp-ed-preview', showPreview); root.classList.toggle('kp-no-preview', !showPreview); paintBar(); } }, iconEl('panelRight'));
// backendURL only when the current base is stored on the serving backend: the export dialog can then offer a
// "connected to server" reader. new URL(..., location.href) resolves against the page, so a sub-path deploy works;
// encodeURIComponent because base ids are user-visible strings and may contain '/' or '#'.
const exportBtn = h('button', { type: 'button', class: 'ed-btn ed-primary kp-export-btn', onclick: () => openExportDialog({ backendURL: server.info && S.kb && S.kb.remote ? new URL('kb/' + encodeURIComponent(S.kb.id) + '/', location.href).href : '' }) }, iconEl('export'), h('span', {}));
const bar = h('div', { class: 'kp-tools' }, baseBtn, undoBtn, redoBtn, status, h('span', { class: 'ed-spacer' }), lockBtn, pvBtn, exportBtn);

// Idempotent: reads S and rewrites every label, title and disabled flag. Called after any event and after a
// language switch; cheap enough that tracking which part changed is not worth the bugs.
function paintBar() {
  baseBtn.querySelector('.kp-base-t').textContent = S.kb ? S.kb.title : t('kp.bases');
  baseBtn.title = t('kp.bases');
  // Icon-only buttons: title for mouse users, aria-label for screen readers (title alone is not reliably announced).
  for (const [b, k] of [[undoBtn, 'kp.undo'], [redoBtn, 'kp.redo'], [pvBtn, 'kp.togglePreview'], [lockBtn, 'kp.lockAll']]) { b.title = t(k); b.setAttribute('aria-label', t(k)); }
  undoBtn.disabled = !canUndo();
  redoBtn.disabled = !canRedo();
  // The lock button exists only while some 451 page is decrypted in memory; nothing to lock otherwise.
  lockBtn.hidden = !S.unlocked.size;
  pvBtn.setAttribute('aria-pressed', String(showPreview));
  exportBtn.lastChild.textContent = t('kp.export');
  const st = S.saving ? t('kp.saving') : S.dirty ? t('kp.unsaved') : S.savedAt ? t('kp.saved') : '';
  status.textContent = st + (S.kb && S.kb.remote && server.info ? ' · ' + (server.failed ? t('kp.serverFailed') : t('kp.onServer')) : '');
}
// The toolbar lives inside the shell header (#ap-top), taking the place of its spacer. Re-run after a language
// switch because startApp re-renders the header and drops foreign children.
function mountBar() {
  const top = $('#ap-top');
  if (!top) return;
  const sp = top.querySelector('.ed-spacer');
  top.insertBefore(bar, sp || null);
  if (sp) sp.remove();
}

// ---- panels
function paintLeftTabs() {
  const tabs = [['pages', 'list', 'kp.pages'], ['media', 'image', 'kp.media'], ['base', 'settings', 'kp.base']];
  leftTabs.replaceChildren(...tabs.map(([k, ic, l]) => h('button', { type: 'button', role: 'tab', class: 'kp-ltab' + (k === leftTab ? ' kp-on' : ''), 'aria-selected': String(k === leftTab), onclick: () => { leftTab = k; lsSet('kp-ed-ltab', k); paintLeftTabs(); paintLeft(); } }, iconEl(ic), h('span', {}, t(l)))));
}
// Scroll position is saved and restored around the rebuild; otherwise every structural change would jump to top.
function paintLeft() {
  if (!S.kb) return;
  const keep = leftPanel.scrollTop;
  if (leftTab === 'media') renderMediaPanel(leftPanel);
  else if (leftTab === 'base') {
    // The base form keeps its own state while typing; it is rebuilt on structural changes only.
    // Restores <details> open state by index. Assumes the panel's section order is stable between rebuilds;
    // a section that appears conditionally would shift the indices (harmless: a wrong section opens).
    const open = [...leftPanel.querySelectorAll('details')].map((d) => d.open);
    renderBasePanel(leftPanel);
    [...leftPanel.querySelectorAll('details')].forEach((d, i) => { if (open[i] != null) d.open = open[i]; });
  } else renderPagesPanel(leftPanel);
  leftPanel.scrollTop = keep;
}
// After the rebuild the previously focused node is detached. Focus is moved to the selected block header so a
// keyboard user does not fall back to <body>; preventScroll keeps the restored scrollTop.
function paintCenter() {
  if (!S.kb) return;
  const keep = center.scrollTop;
  const focus = document.activeElement && center.contains(document.activeElement) ? document.activeElement : null;
  renderPageEditor(center);
  center.scrollTop = keep;
  if (focus && !focus.isConnected) { const sel = center.querySelector('.kp-bc.kp-sel'); if (sel) sel.querySelector('.kp-bh').focus({ preventScroll: true }); }
}
function paintPaneTabs() {
  const pane = root.dataset.pane;
  paneTabs.replaceChildren(...[['pages', 'list', 'kp.pages'], ['edit', 'edit', 'kp.page'], ['preview', 'eye', 'kp.preview']].map(([k, ic, l]) =>
    h('button', { type: 'button', class: 'kp-ptab' + (pane === k ? ' kp-on' : ''), 'aria-pressed': String(pane === k), onclick: () => showPane(k) }, iconEl(ic), h('span', {}, t(l)))));
}
// Phone layout only (CSS ignores data-pane above 900px), so the hook below checks the same breakpoint.
function showPane(k) { root.dataset.pane = k; lsSet('kp-ed-pane', k); paintPaneTabs(); }
pageHooks.showPane = (k) => { if (matchMedia('(max-width: 900px)').matches) showPane(k); };

// Panels request a preview of a route; the preview column is forced visible (and saved as preference) first.
let preview = null;
pageHooks.preview = (route) => {
  if (!showPreview) { showPreview = true; lsSet('kp-ed-preview', true); root.classList.remove('kp-no-preview'); }
  if (matchMedia('(max-width: 900px)').matches) showPane('preview');
  if (preview) preview.go(route || '');
  paintBar();
};

on('change', (info) => {
  updatePageList();
  if (info && info.structure) { paintLeft(); paintCenter(); }
  else if (leftTab === 'pages') {
    // Titles in the tree follow typing without a full repaint.
    const p = S.kb && S.kb.pages.find((x) => x.id === S.pageId);
    // The id goes into an attribute selector unescaped: safe only because page ids are generated by model.js, never
    // typed by the user. Only public pages show their title in the tree; 451 titles stay hidden.
    const el = p && leftPanel.querySelector(`.kp-tr[data-id="${p.id}"] .kp-tl-t`);
    if (el && p.access === 'public') el.textContent = p.title || p.slug;
  }
  paintBar();
});
// undefined (not falsy) tests: selecting "no block" (null) is still a change that needs a repaint.
on('select', (o) => {
  if (o.pageId !== undefined || o.sid !== undefined || o.versionId !== undefined || o.blockId !== undefined) paintCenter();
  if (o.pageId !== undefined) { expandTo(S.pageId); if (leftTab === 'pages') paintLeft(); }
});
on('saved', paintBar);
on('kb', () => { paintLeft(); paintCenter(); paintBar(); loadSecretMedia(); });
on('error', (e) => toast(t('kp.saveFailed', { msg: (e && e.message) || e }), 'error'));

// ---- keyboard
// Global shortcuts. Ctrl/Cmd+S works everywhere (it overrides the browser's "save page", which would save the
// empty shell). Undo/redo only outside editable fields: inside an input the native per-field undo is expected.
// altKey excluded: AltGr on European layouts reports Ctrl+Alt, and AltGr+Z/Y types characters.
window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 's') { e.preventDefault(); saveNow().then(() => toast(t('kp.saved'), 'ok')); return; }
  if (isEditable(document.activeElement)) return;
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
});
// beforeunload cannot await; saveNow() starts the write and preventDefault() asks the browser to show the leave
// dialog, which buys time for IndexedDB to commit. visibilitychange 'hidden' is the reliable hook on mobile,
// where beforeunload often never fires (tab killed in background).
window.addEventListener('beforeunload', (e) => { if (S.dirty) { saveNow(); e.preventDefault(); } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });

// ---- start
// Startup order matters: shell first (header exists for mountBar), then backend probe (decides whether bases
// may live on the server), then storage check, then the base to open: last opened, else the first stored,
// else a new one from the wiki template so a first visit is never an empty screen.
async function start() {
  startApp({ key: 'kp', name: 'app.name', logo: LOGO, onLang: () => { mountBar(); paintLeftTabs(); paintLeft(); paintCenter(); paintPaneTabs(); paintBar(); } });
  const foot = $('#ap-foot');
  if (foot) foot.remove();
  document.body.append(root);
  mountBar();
  paintLeftTabs();
  paintPaneTabs();
  preview = createPreview(right);
  const art = globalThis.IN_HTML_ARTIFACT;
  // Probe only in development or a backend build; a static/single-file artifact has no server to ask, and the
  // request would just fail (or break the offline-build audit).
  if (!art || art.mode === 'backend') server.info = await probeBackend();
  // Warn when the browser may evict storage (no persistent grant): the user's bases are only local.
  if (!(await isPersistent())) toast(t('kp.noStorage'), 'warn');
  let id = await lastOpened();
  let kb = id ? await getKB(id) : null;
  if (!kb) { const list = await listKBs(); if (list.length) kb = await getKB(list[0].id); }
  if (kb) { setKB(kb); await setLastOpened(kb.id); }
  else await newFromTemplate(TEMPLATES.find((x) => x.id === 'wiki') || TEMPLATES[0]);
  paintBar();
  emit('ready', {});
  // Hooks for the end-to-end scenario (e2e.js).
  window.__kp = { S, undo, redo, preview, select, buildExport, newFromTemplate, TEMPLATES };
  window.__kpReady = true;
}
start();
