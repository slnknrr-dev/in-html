// studio/shell.js - the editor shell: top bar, panels and drawers, status bar, full re-render.
//
// Render levels, cheapest first: renderStatus (status bar), refreshPanels (side panels, microtask-batched, skips the
// panel holding focus), renderShell (all chrome, used on language switch / project load), renderAll (+ canvas).
// Commits call refreshPanels, never renderShell: rebuilding the top bar would destroy the project-name input the
// user may be typing in.
import { P } from '../doc/product.js';
import { $, $$, h, lsGet, lsSet } from '../ui/dom.js';
import { fmtBytes } from '../ui/files.js';
import { langLabel } from '../ui/lang.js';
import { icon, iconEl } from '../ui/icons.js';
import { ED_I18N, t } from '../ui/i18n.js';
import { setUILang } from './i18n.js';
import { openMenu } from '../ui/overlays.js';
import { S, edKey } from './state.js';
import { completeness, walk } from './doc.js';
import { commit, redo, undo } from './history.js';
import { renderBanner } from './db.js';
import { applyCanvasSize, pageFits, renderCanvas, setDarkPreview, setZoom, setZoomFit } from './canvas.js';
import { scheduleChrome } from './select.js';
import { renderInspector } from './inspector.js';
import { renderFiles, renderLeft, renderOutline } from './left.js';
import { renderDocSettings, renderRight } from './right.js';
import { openLangManager, renderLangTabs } from './langs.js';
import { newProject, openProjects } from './projects.js';
import { openTemplates } from './gallery.js';
import { exportAs, openFileDialog, saveFile } from './fileio.js';
import { openExport } from './export.js';
import { openPreview } from './preview.js';
import { RT_S } from '../richtext/sanitize.js';
import { ED } from './config.js';

// ===========================================================================
// 20. Shell: top bar, stage bar, status bar, panels
// ===========================================================================

function topBtn(ic, label, fn, opts = {}) {
  return h('button', {
    type: 'button', class: 'ed-tbtn' + (opts.primary ? ' ed-primary' : '') + (opts.iconOnly ? ' ed-icon-only' : ''),
    title: opts.title || label, 'aria-label': opts.iconOnly ? label : null, id: opts.id || null, onclick: fn,
  }, iconEl(ic), opts.iconOnly ? null : h('span', { class: 'ed-tbtn-l' }, label));
}

function renderTop() {
  const top = $('#ed-top');
  if (!top) return;
  top.textContent = '';
  const name = h('input', {
    id: 'ed-name', class: 'ed-name', type: 'text', dir: 'auto', value: S.doc?.name || '', 'aria-label': t('top.name'), title: t('top.name'),
    spellcheck: 'false', placeholder: t('pj.untitled'),
  });
  // Same coalesce key on input and change: the whole rename, including the final trim, is one undo step.
  name.addEventListener('input', () => commit('rename', () => { S.doc.name = name.value; }, { render: 'none', coalesce: 'doc:name' }));
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
  // Done editing: no leading / trailing blanks, and never an empty name (files and the project list need one).
  name.addEventListener('change', () => {
    const v = name.value.trim() || t('pj.untitled');
    if (name.value !== v) name.value = v;
    if (S.doc && S.doc.name !== v) commit('rename', () => { S.doc.name = v; }, { render: 'none', coalesce: 'doc:name' });
  });
  const uiSel = h('select', { class: 'ed-input ed-select ed-ui-lang', 'aria-label': t('top.uiLang'), title: t('top.uiLang') },
    Object.keys(ED_I18N).map((c) => h('option', { value: c }, langLabel(c))));
  uiSel.value = S.uiLang;
  uiSel.addEventListener('change', () => setUILang(uiSel.value));
  top.append(
    h('div', { class: 'ed-brand' },
      topBtn('panelLeft', t('top.togLeft'), () => togglePanel('left'), { iconOnly: true, id: 'ed-tog-left' }),
      h('span', { class: 'ed-logo', html: icon('logo'), title: t('app.name') }),
      name),
    h('div', { class: 'ed-tgroup' },
      topBtn('filePlus', t('top.new'), (e) => openMenu(e.currentTarget, [
        { label: t('top.newBlank'), icon: 'file', action: () => newProject() },
        { label: t('top.newTemplate'), icon: 'template', action: () => openTemplates() },
      ])),
      topBtn('folder', t('top.open'), () => openFileDialog(), { title: t('top.openHint') }),
      topBtn('save', t('top.save'), (e) => saveFile(false), { title: t('top.saveHint') }),
      topBtn('chevDown', t('top.more'), (e) => openMenu(e.currentTarget, [
        { label: t('top.saveAs'), icon: 'save', kbd: 'Ctrl+Shift+S', action: () => saveFile(true) },
        { label: t('top.projects'), icon: 'stack', action: () => openProjects() },
        { label: t('top.templates'), icon: 'template', action: () => openTemplates() },
        ...((ED.exporters || []).length ? [{ sep: true }, ...ED.exporters.map((x) => ({ label: t(x.label), icon: x.icon || 'download', action: () => exportAs(x) }))] : []),
        { sep: true },
        { label: t('lm.manage'), icon: 'globe', action: () => openLangManager() },
      ]), { iconOnly: true }),
      topBtn('stack', t('top.projects'), () => openProjects())),
    h('div', { class: 'ed-tgroup' },
      topBtn('undo', t('top.undo'), () => undo(), { iconOnly: true, id: 'ed-undo' }),
      topBtn('redo', t('top.redo'), () => redo(), { iconOnly: true, id: 'ed-redo' })),
    h('div', { class: 'ed-spacer' }),
    h('div', { class: 'ed-tgroup' },
      uiSel,
      topBtn('eye', t('top.preview'), () => openPreview()),
      topBtn('export', t('top.export'), () => openExport(), { primary: true }),
      topBtn('panelRight', t('top.togRight'), () => togglePanel('right'), { iconOnly: true, id: 'ed-tog-right' })));
  updateUndoButtons();
}

function updateUndoButtons() {
  const u = $('#ed-undo'), r = $('#ed-redo');
  if (u) u.disabled = !S.hist.undo.length;
  if (r) r.disabled = !S.hist.redo.length;
}

function renderStageBar() {
  const bar = $('#ed-stagebar');
  if (!bar) return;
  bar.textContent = '';
  bar.append(
    h('div', { id: 'ed-langtabs', class: 'ed-langtabs-wrap' }),
    h('div', { class: 'ed-spacer' }),
    ...(ED.stage.bar ? [ED.stage.bar(() => { applyCanvasSize(); scheduleChrome(); renderStatus(); })] : []),
    h('div', { class: 'ed-zoom', role: 'group', 'aria-label': t('st.zoom') },
      h('button', {
        type: 'button', class: 'ed-iconbtn' + (S.guides ? ' ed-on' : ''), title: t('stg.guides'), 'aria-label': t('stg.guides'), 'aria-pressed': String(S.guides), html: icon('guides'),
        onclick: (e) => { S.guides = !S.guides; lsSet(edKey('guides'), S.guides); e.currentTarget.classList.toggle('ed-on', S.guides); e.currentTarget.setAttribute('aria-pressed', String(S.guides)); applyCanvasSize(); },
      }),
      h('button', {
        type: 'button', id: 'ed-dark-pv', class: 'ed-iconbtn' + (S.darkPreview ? ' ed-on' : ''), title: t('stg.dark'), 'aria-label': t('stg.dark'),
        'aria-pressed': String(!!S.darkPreview), html: icon('moon'), onclick: () => setDarkPreview(!S.darkPreview),
      }),
      h('button', { type: 'button', class: 'ed-iconbtn', title: t('zm.out'), 'aria-label': t('zm.out'), html: icon('zoomOut'), onclick: () => setZoom(S.zoom - 0.1) }),
      h('button', { type: 'button', class: 'ed-zoom-val', id: 'ed-zoom-val', title: t('zm.reset'), 'aria-label': t('zm.reset'), onclick: () => setZoom(1) }, Math.round(S.zoom * 100) + '%'),
      h('button', { type: 'button', class: 'ed-iconbtn', title: t('zm.in'), 'aria-label': t('zm.in'), html: icon('zoomIn'), onclick: () => setZoom(S.zoom + 0.1) }),
      h('button', {
        type: 'button', id: 'ed-zoom-fit', class: 'ed-iconbtn' + (S.zoomFit ? ' ed-on' : ''), title: t('zm.fit'), 'aria-label': t('zm.fit'),
        'aria-pressed': String(!!S.zoomFit), html: icon('fitWidth'), onclick: () => setZoomFit(!S.zoomFit),
      })));
  renderLangTabs();
}

// Recomputed from scratch (block count walk, completeness scan) on every call; cheap for document-sized trees and
// always consistent. It runs after commits and saves, not per frame.
function renderStatus() {
  const st = $('#ed-status');
  if (!st || !S.doc) return;
  updateUndoButtons();
  const stateKey = { saved: 'st.saved', saving: 'st.saving', unsaved: 'st.unsaved', memory: 'st.memoryShort', error: 'st.saveErr', readonly: 'st.readonly' }[S.saveState] || 'st.saved';
  let blocks = 0;
  walk(() => { blocks++; });
  const atts = Object.values(S.doc.attachments || {});
  const size = atts.reduce((s, a) => s + (+a.size || 0), 0);
  const pct = completeness(S.lang);
  st.textContent = '';
  st.append(
    h('span', { class: 'ed-st-item ed-st-save ed-st-' + S.saveState, title: S.saveState === 'memory' ? t('st.memory') : S.saveState === 'readonly' ? t({ locked: 'bn.locked', lost: 'bn.lost', deleted: 'bn.deleted' }[S.readOnly] || 'bn.changed') : '' }, h('span', { class: 'ed-dot' }), t(stateKey)),
    h('span', { class: 'ed-st-item', title: t('lm.complete', { pct }) }, iconEl('globe'), t('st.trans', { lang: S.lang.toUpperCase(), pct })),
    ...ED.stage.statusItems(),
    h('span', { class: 'ed-st-item' }, iconEl('layers'), t('st.blocks', { n: blocks })),
    ...(ED.statusItems ? ED.statusItems(S.doc) : []),
    h('span', { class: 'ed-st-item' }, iconEl('clip'), t('st.files', { n: atts.length, size: fmtBytes(size) })),
    h('span', { class: 'ed-spacer' }),
    h('span', { class: 'ed-st-item ed-muted' }, `${Math.round(S.zoom * 100)}%`),
    h('span', { class: 'ed-st-item ed-muted' }, P.prefix + ' ' + P.version));
}

// Docked panels (wide windows) remember their state; in small windows the panels are overlay drawers
// (index.html, max-width 1100px): one at a time, closed by default, on Esc and on a click outside.
function togglePanel(side) {
  if (side === 'left') S.noLeft = !S.noLeft; else S.noRight = !S.noRight;
  if (S.narrow) {
    if (side === 'left' && !S.noLeft) S.noRight = true;
    if (side === 'right' && !S.noRight) S.noLeft = true;
  } else lsSet(edKey('panels'), { noLeft: S.noLeft, noRight: S.noRight });
  applyPanels();
}
function closeDrawers(focusToggle = false) {
  if (!S.narrow || (S.noLeft && S.noRight)) return false;
  const side = !S.noLeft ? 'left' : 'right';
  const inside = $('#ed-' + side)?.contains(document.activeElement);
  S.noLeft = S.noRight = true;
  applyPanels();
  if (focusToggle || inside) $('#ed-tog-' + side)?.focus();
  return true;
}
function applyPanels() {
  const m = $('#ed-main');
  if (!m) return;
  m.classList.toggle('ed-noleft', S.noLeft);
  m.classList.toggle('ed-noright', S.noRight);
  m.classList.toggle('ed-narrow', S.narrow);
  $('#ed-tog-left')?.setAttribute('aria-expanded', String(!S.noLeft));
  $('#ed-tog-right')?.setAttribute('aria-expanded', String(!S.noRight));
  scheduleChrome();
}
// The breakpoint must equal the media query in index.html / editor.css that switches panels to drawers; JS needs
// the same answer to set S.narrow (drawer behaviour), CSS for layout. matchMedia instead of innerWidth comparisons:
// identical semantics to CSS (zoom, scrollbars) and a change event.
const NARROW_MQ = (() => { try { return window.matchMedia('(max-width: 1100px)'); } catch { return null; } })();
function setNarrow(on, initial = false) {
  S.narrow = !!on;
  if (S.narrow) { S.noLeft = true; S.noRight = true; }
  else {
    const p = lsGet(edKey('panels'), {}) || {};
    S.noLeft = !!p.noLeft;
    S.noRight = !!p.noRight;
  }
  if (initial) return;
  applyPanels();
  if (S.narrow && !S.zoomFit && S.doc && !pageFits()) setZoomFit(true, false);
}
function bindDrawers() {
  if (NARROW_MQ) {
    const on = () => { if (NARROW_MQ.matches !== S.narrow) setNarrow(NARROW_MQ.matches); };
    // addListener: Safari < 14 has no EventTarget on MediaQueryList. resize is a belt-and-braces fallback; on() is
    // idempotent (compares with S.narrow).
    if (NARROW_MQ.addEventListener) NARROW_MQ.addEventListener('change', on); else NARROW_MQ.addListener?.(on);
    window.addEventListener('resize', on);
  }
  // A press outside the open drawer (and outside menus/dialogs it opened) closes it.
  document.addEventListener('pointerdown', (e) => {
    if (!S.narrow || (S.noLeft && S.noRight)) return;
    const tg = e.target;
    if (!tg || !tg.closest || tg.closest('#ed-left, #ed-right, #ed-overlays, #ed-tog-left, #ed-tog-right, .rt-pop')) return;
    closeDrawers();
  }, true);
  // Capture phase: runs after the dialog/menu Esc handler (window, capture) and before block shortcuts.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || S.layers.length || RT_S.pop) return;
    if (closeDrawers(true)) { e.preventDefault(); e.stopPropagation(); }
  }, true);
}

function renderShell() {
  renderTop();
  renderBanner();
  renderStageBar();
  renderLeft();
  renderRight();
  renderStatus();
  applyPanels();
}

// Refresh side panels after a change (batched per task via a microtask; rAF would stall in
// background tabs). Panels holding focus are left alone unless forced.
let panelsQueued = false, panelsForce = false;
function refreshPanels(force = false) {
  panelsForce = panelsForce || force;
  if (panelsQueued) return;
  panelsQueued = true;
  queueMicrotask(() => {
    panelsQueued = false;
    const f = panelsForce;
    panelsForce = false;
    if (!S.doc) return;
    const act = document.activeElement;
    const inRight = act && $('#ed-right')?.contains(act);
    const inLeft = act && $('#ed-left')?.contains(act);
    const inTop = act && $('#ed-top')?.contains(act);
    const loc = f && (inRight || inLeft) ? fieldLocator(act) : null;
    if (!inLeft || f) { renderOutline(); renderFiles(); }
    if (!inRight || f) { renderInspector(); renderDocSettings(); }
    if (!inTop || f) { const n = $('#ed-name'); if (n && n.value !== S.doc.name) n.value = S.doc.name || ''; }
    renderLangTabs();
    renderStatus();
    if (loc && !document.contains(act)) refocusField(loc);
  });
}

// Identity of the focused panel control (panel, selected block, field key, n-th field with that key, n-th
// control inside it), so a forced re-render (undo/redo, language switch) can put the focus back.
// Positional identity (not element identity) because the forced re-render replaces every element.
const FOCUSABLE = 'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
function fieldLocator(el) {
  const root = el && el.closest && el.closest('#ed-right, #ed-left');
  const field = root && el.closest('.ed-field[data-key]');
  if (!field || !root.contains(field)) return null;
  const key = field.dataset.key;
  const same = $$('.ed-field[data-key]', root).filter((x) => x.dataset.key === key);
  return { root: root.id, bid: S.sel.bid, key, nth: same.indexOf(field), ctrl: $$(FOCUSABLE, field).indexOf(el) };
}
function refocusField(loc) {
  if (loc.bid !== S.sel.bid) return; // another block's inspector now: nothing matching to return to
  const cur = document.activeElement;
  if (cur && cur !== document.body && cur !== document.documentElement) return; // focus already went somewhere on purpose
  const root = document.getElementById(loc.root);
  if (!root) return;
  const field = $$('.ed-field[data-key]', root).filter((x) => x.dataset.key === loc.key)[loc.nth];
  if (!field) return;
  const ctrls = $$(FOCUSABLE, field);
  const el = ctrls[loc.ctrl] || ctrls[0];
  if (el) { try { el.focus({ preventScroll: true }); } catch { /* ignore */ } }
}

function renderAll() {
  renderShell();
  renderCanvas();
}

export {
  NARROW_MQ,
  bindDrawers,
  closeDrawers,
  refreshPanels,
  renderAll,
  renderShell,
  renderStatus,
  renderTop,
  setNarrow,
  togglePanel,
  updateUndoButtons
};
