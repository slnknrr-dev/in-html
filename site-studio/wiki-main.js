// site-studio/wiki-main.js - the editor page: application shell (ui/app.js header with the base switcher, undo /
// redo, save state, 451 unlock, preview toggle and export), the three columns (pages / media / base settings, page
// editor, live preview; one column at a time on phones with a tab bar), keyboard shortcuts, the first start (a new
// base from the encyclopedia template) and, when a backend serves the page, server storage.
// Design rules:
// - This module is the composition root: it owns the DOM shell and wires panels to state events; panels never call
// each other directly, they commit() to state and react to 'change' / 'select' (see wiki-state.js).
// - Repaint granularity: 'structure' changes rebuild the left panel and the page editor; plain text edits do not
// (rebuilding a form while the user types would steal focus and caret). The one exception is a cheap in-place
// update of the page title in the tree.
// - UI preferences (pane, left tab, preview on/off) live in localStorage via lsGet/lsSet: per device, not per base.
// Side-effect import first: the editor's i18n keys must be registered before any t() call below.
import './wiki-strings.js';
import { $, h, isEditable, lsGet, lsSet } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { startApp } from '../ui/app.js';
import { t } from '../ui/i18n.js';
import { toast } from '../ui/overlays.js';
import { S, canRedo, canUndo, emit, hooks as stateHooks, on, redo, saveNow, select, undo } from './wiki-state.js';
import { getKB, isPersistent, lastOpened, listKBs, setLastOpened } from './wiki-store.js';
import { setKB } from './wiki-state.js';
import { renderPagesPanel, expandTo, hooks as pageHooks } from './wiki-ed-pages.js';
import { renderPageEditor } from './wiki-ed-page.js';
import { renderMediaPanel, loadSecretMedia, payloadMedia } from './wiki-ed-media.js';
import { renderBasePanel } from './wiki-ed-base.js';
import { createPreview } from './wiki-ed-preview.js';
import { buildExport, openExportDialog } from './wiki-ed-export.js';
import { newFromTemplate, openBasesDialog } from './wiki-ed-bases.js';
import { lockAll } from './wiki-ed-secret.js';
import { server } from './wiki-ed-sync.js';
import { probeBackend } from './wiki-remote.js';
import { updatePageList } from './wiki-ed-fields.js';
import { TEMPLATES } from './wiki-templates.js';

const LOGO = 'M4 5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM8 10h3v3H8zM14 11.5h3M8 16.5h9M11 11.5h3';
// Dependency injection to break the cycle state -> media -> state (see wiki-state.js hooks).
stateHooks.payloadMedia = payloadMedia;

// data-pane selects the visible column on phones (CSS shows one pane under 900px); on wide screens all three
// columns are visible and the attribute is inert.
const root = h('div', { id: 'kp-ed', class: 'kp-ed', 'data-pane': lsGet('kp-ed-pane', 'edit') });
const leftTabs = h('div', { class: 'kp-ed-ltabs', role: 'tablist' });
const leftPanel = h('div', { class: 'kp-ed-lpanel' });
const center = h('section', { class: 'kp-ed-center', 'aria-label': t('kp.pageEditor') });
const right = h('section', { class: 'kp-ed-right', 'aria-label': t('kp.preview') });
const paneTabs = h('nav', { class: 'kp-ed-tabs', 'aria-label': t('kp.panes') });
let leftTab = lsGet('kp-ed-ltab', 'pages');
let showPreview = lsGet('kp-ed-preview', true);
root.append(h('div', { class: 'kp-ed-main' }, h('aside', { class: 'kp-ed-left' }, leftTabs, leftPanel), center, right), paneTabs);
root.classList.toggle('kp-no-preview', !showPreview);

// ---- toolbar in the application header
// role=status + aria-live=polite: "Saving / Saved" is announced without interrupting the user.
const status = h('span', { class: 'kp-status', role: 'status', 'aria-live': 'polite' });
const undoBtn = h('button', { type: 'button', class: 'ed-iconbtn', onclick: () => undo() }, iconEl('undo'));
const redoBtn = h('button', { type: 'button', class: 'ed-iconbtn', onclick: () => redo() }, iconEl('redo'));
const baseBtn = h('button', { type: 'button', class: 'ed-btn kp-base-btn', onclick: () => openBasesDialog() }, iconEl('folder'), h('span', { class: 'kp-base-t' }));
const lockBtn = h('button', { type: 'button', class: 'ed-iconbtn kp-lock-btn', onclick: () => lockAll() }, iconEl('lock'));
const pvBtn = h('button', { type: 'button', class: 'ed-iconbtn kp-pv-btn', onclick: () => { showPreview = !showPreview; lsSet('kp-ed-preview', showPreview); root.classList.toggle('kp-no-preview', !showPreview); paintBar(); } }, iconEl('panelRight'));
const exportBtn = h('button', { type: 'button', class: 'ed-btn ed-primary kp-export-btn', onclick: () => openExportDialog({ backendURL: server.info && S.kb && S.kb.remote ? new URL('kb/' + encodeURIComponent(S.kb.id) + '/', location.href).href : '' }) }, iconEl('export'), h('span', {}));
const bar = h('div', { class: 'kp-tools' }, baseBtn, undoBtn, redoBtn, status, h('span', { class: 'ed-spacer' }), lockBtn, pvBtn, exportBtn);

function paintBar() {
  baseBtn.querySelector('.kp-base-t').textContent = S.kb ? S.kb.title : t('kp.bases');
  baseBtn.title = t('kp.bases');
  for (const [b, k] of [[undoBtn, 'kp.undo'], [redoBtn, 'kp.redo'], [pvBtn, 'kp.togglePreview'], [lockBtn, 'kp.lockAll']]) { b.title = t(k); b.setAttribute('aria-label', t(k)); }
  undoBtn.disabled = !canUndo();
  redoBtn.disabled = !canRedo();
  lockBtn.hidden = !S.unlocked.size;
  pvBtn.setAttribute('aria-pressed', String(showPreview));
  exportBtn.lastChild.textContent = t('kp.export');
  const st = S.saving ? t('kp.saving') : S.dirty ? t('kp.unsaved') : S.savedAt ? t('kp.saved') : '';
  status.textContent = st + (S.kb && S.kb.remote && server.info ? ' · ' + (server.failed ? t('kp.serverFailed') : t('kp.onServer')) : '');
}
// The toolbar is injected into the shared ui/app.js header (replacing its spacer) instead of a second header row: phones keep vertical space.
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
function paintLeft() {
  if (!S.kb) return;
  const keep = leftPanel.scrollTop;
  if (leftTab === 'media') renderMediaPanel(leftPanel);
  else if (leftTab === 'base') {
    // The base form keeps its own state while typing; it is rebuilt on structural changes only.
    const open = [...leftPanel.querySelectorAll('details')].map((d) => d.open);
    renderBasePanel(leftPanel);
    [...leftPanel.querySelectorAll('details')].forEach((d, i) => { if (open[i] != null) d.open = open[i]; });
  } else renderPagesPanel(leftPanel);
  leftPanel.scrollTop = keep;
}
// Re-render may destroy the focused control. Scroll position is restored, and if focus was lost it moves to the
// selected block's handle (preventScroll) so keyboard users keep their place instead of falling back to <body>.
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
function showPane(k) { root.dataset.pane = k; lsSet('kp-ed-pane', k); paintPaneTabs(); }
// Pane switching only matters at the phone breakpoint; the media query must match the 900px breakpoint in wiki-editor.css.
pageHooks.showPane = (k) => { if (matchMedia('(max-width: 900px)').matches) showPane(k); };

let preview = null;
pageHooks.preview = (route) => {
  if (!showPreview) { showPreview = true; lsSet('kp-ed-preview', true); root.classList.remove('kp-no-preview'); }
  if (matchMedia('(max-width: 900px)').matches) showPane('preview');
  if (preview) preview.go(route || '');
  paintBar();
};

// The selector is built from p.id, which is ID_RE-safe (lowercase alphanumerics), so no CSS.escape is needed.
on('change', (info) => {
  updatePageList();
  if (info && info.structure) { paintLeft(); paintCenter(); }
  else if (leftTab === 'pages') {
    // Titles in the tree follow typing without a full repaint.
    const p = S.kb && S.kb.pages.find((x) => x.id === S.pageId);
    const el = p && leftPanel.querySelector(`.kp-tr[data-id="${p.id}"] .kp-tl-t`);
    if (el && p.access === 'public') el.textContent = p.title || p.slug;
  }
  paintBar();
});
on('select', (o) => {
  if (o.pageId !== undefined || o.sid !== undefined || o.versionId !== undefined || o.blockId !== undefined) paintCenter();
  if (o.pageId !== undefined) { expandTo(S.pageId); if (leftTab === 'pages') paintLeft(); }
});
on('saved', paintBar);
on('kb', () => { paintLeft(); paintCenter(); paintBar(); loadSecretMedia(); });
on('error', (e) => toast(t('kp.saveFailed', { msg: (e && e.message) || e }), 'error'));

// ---- keyboard
// Ctrl/Cmd+S always saves (also inside fields), overriding the browser's "save page". Undo/redo shortcuts are left
// to the browser inside editable fields: there the native text undo is what the user expects; document-level undo
// applies only when focus is outside inputs. Alt combinations are ignored (AltGr = Ctrl+Alt on Windows types characters).
window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 's') { e.preventDefault(); saveNow().then(() => toast(t('kp.saved'), 'ok')); return; }
  if (isEditable(document.activeElement)) return;
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
});
// Best effort: saveNow() is async and the page may unload before IndexedDB commits, so preventDefault asks the
// browser to show its "leave site?" prompt, which gives the write time to finish. visibilitychange 'hidden' is the
// reliable save point on mobile, where beforeunload often never fires.
window.addEventListener('beforeunload', (e) => { if (S.dirty) { saveNow(); e.preventDefault(); } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });

// ---- start
// Boot order: shell first (instant UI), then the backend probe (network, skipped in non-backend artifacts), then
// storage. A first visit with no stored base creates one from the encyclopedia template so the editor is never
// empty, unless a #template= link asked for a specific template.
// KNOWN DEFECT: a hash that matches /^#template=/ but names no existing template (or fails the stricter id regex)
// skips the default base AND creates none, leaving a first-time user with an empty editor. Fix: create the default
// base when no KB exists after handling the hash (i.e. test `!S.kb` at the end).
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
  if (!art || art.mode === 'backend') server.info = await probeBackend();
  if (!(await isPersistent())) toast(t('kp.noStorage'), 'warn');
  let id = await lastOpened();
  let kb = id ? await getKB(id) : null;
  if (!kb) { const list = await listKBs(); if (list.length) kb = await getKB(list[0].id); }
  if (kb) { setKB(kb); await setLastOpened(kb.id); }
  else if (!/^#template=/.test(location.hash || '')) await newFromTemplate(TEMPLATES.find((x) => x.id === 'wiki') || TEMPLATES[0]);
  // A template picked in the site editor's gallery (index.html → wiki.html#template=<id>): a new base from it.
  const want = /^#template=([a-z0-9-]{1,40})$/.exec(location.hash || '');
  if (want) {
    try { history.replaceState(null, '', location.pathname + location.search); } catch { /* file:// */ }
    const tpl = TEMPLATES.find((x) => x.id === want[1]);
    if (tpl) await newFromTemplate(tpl);
  }
  paintBar();
  emit('ready', {});
  // Hooks for the end-to-end scenario (e2e.js).
  // Test hooks (e2e.js) exposed only after boot completes; __kpReady is the flag the harness polls.
  window.__kp = { S, undo, redo, preview, select, buildExport, newFromTemplate, TEMPLATES };
  window.__kpReady = true;
}
start();
