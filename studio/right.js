// studio/right.js - right panel: block inspector and document settings. The settings tabs come from the product
// (ED.docTabs = [[key, labelKey, render(body)], ...]); this module provides the panel, the tab bar and the building
// blocks the products' tabs use (field boxes bound to document paths, theme presets, fonts, metadata, languages).
//
// Inversion of control: studio owns layout, tab mechanics and the commit protocol; the product owns WHAT is in each
// settings tab, composed from the helpers exported here. Settings are bound to document paths ('theme', 'meta',
// 'page.margin') resolved at call time, so the bindings survive undo/redo replacing S.doc.
import { ED } from './config.js';
import { THEMES } from '../doc/product.js';
import { own } from '../util/value.js';
import { $, clone, h, lsSet } from '../ui/dom.js';
import { isFontMime, pickFiles } from '../ui/files.js';
import { fmtDate } from '../ui/lang.js';
import { iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { toast } from '../ui/overlays.js';
import { S, edKey } from './state.js';
import { pathGet, walk } from './doc.js';
import { commit } from './history.js';
import { addFiles } from './attach.js';
import { blockEl, rerenderBlock } from './canvas.js';
import { fieldRow, renderFields, section } from './fields.js';
import { renderInspector } from './inspector.js';
import { tabBar } from './left.js';
import { renderLangManager } from './langs.js';

// ===========================================================================
// 18. Right panel: inspector · document settings
// ===========================================================================

function renderRight() {
  const right = $('#ed-right');
  if (!right) return;
  right.textContent = '';
  right.append(tabBar('ed-rtabs', [['block', t('tab.block'), 'sliders', 'ed-inspector'], ['document', t('tab.document'), 'settings', 'ed-docset']], S.rightTab, setRightTab));
  right.append(
    h('div', { class: 'ed-panel-body', id: 'ed-inspector', role: 'tabpanel', 'aria-labelledby': 'ed-rtabs-block', hidden: S.rightTab !== 'block' }),
    h('div', { class: 'ed-panel-body ed-docset', id: 'ed-docset', role: 'tabpanel', 'aria-labelledby': 'ed-rtabs-document', hidden: S.rightTab !== 'document' }));
  renderInspector();
  renderDocSettings();
}
function setRightTab(k) {
  S.rightTab = k;
  lsSet(edKey('rtab'), k);
  renderRight();
}

const docTabs = () => ED.docTabs || [];
function setDocTab(k, focus = false) {
  S.docTab = docTabs().some(([x]) => x === k) ? k : (docTabs()[0] || [''])[0];
  lsSet(edKey('dtab'), S.docTab);
  renderDocSettings();
  if (focus) requestAnimationFrame(() => $(`#ed-dtab-${S.docTab}`)?.focus());
}
// Shows the document settings panel on tab `k` (from inspector links, request selects…).
function openDocTab(k) {
  S.docTab = k;
  lsSet(edKey('dtab'), k);
  if (S.rightTab !== 'document') setRightTab('document'); else renderDocSettings();
}

// A product tab renderer that throws shows an inline error instead of breaking the whole panel.
function renderDocSettings() {
  const box = $('#ed-docset');
  if (!box || box.hidden || !S.doc) return;
  const tabs = docTabs();
  if (!tabs.some(([k]) => k === S.docTab)) S.docTab = (tabs[0] || [''])[0];
  const st = box.scrollTop;
  box.textContent = '';
  const sub = h('div', { class: 'ed-subtabs', role: 'tablist', 'aria-label': t('tab.document') }, tabs.map(([k, l]) => h('button', {
    type: 'button', role: 'tab', id: 'ed-dtab-' + k, class: 'ed-subtab' + (S.docTab === k ? ' ed-on' : ''), 'aria-selected': String(S.docTab === k),
    'aria-controls': 'ed-docset-body', tabindex: S.docTab === k ? '0' : '-1', onclick: () => setDocTab(k),
  }, t(l))));
  sub.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const keys = tabs.map((x) => x[0]);
    const i = keys.indexOf(S.docTab);
    const rtl = getComputedStyle(sub).direction === 'rtl';
    const step = (e.key === 'ArrowRight') !== rtl ? 1 : -1;
    const n = e.key === 'Home' ? keys[0] : e.key === 'End' ? keys[keys.length - 1] : keys[(i + step + keys.length) % keys.length];
    setDocTab(n, true);
  });
  box.append(sub);
  const body = h('div', { class: 'ed-docset-body', id: 'ed-docset-body', role: 'tabpanel', 'aria-labelledby': 'ed-dtab-' + S.docTab });
  box.append(body);
  const tab = tabs.find(([k]) => k === S.docTab);
  try { if (tab) tab[2](body); } catch (e) { console.error(e); body.append(h('p', { class: 'ed-error' }, t('err.generic', { msg: e.message }))); }
  box.scrollTop = st;
}

// Doc-level setter: obj path ('theme', 'output', 'meta', 'page.margin', '' …); render: a commit render mode, or a
// function (key, typing) → mode ('css' for settings that only change the stylesheet).
// render 'css' is the performance lever: colour / spacing variables only rebuild the stylesheet, so dragging a
// colour picker repaints without re-rendering markup (and without reloading embedded previews).
function docSetter(path, render = 'all') {
  return (k, v, typing) => {
    const mode = typeof render === 'function' ? render(k, typing) : render;
    commit(`doc ${path}.${k}`, () => {
      const o = path ? pathGet(S.doc, path) : S.doc;
      if (o) o[k] = v;
    }, { render: mode, coalesce: typing ? `doc:${path}:${k}` : null });
    // QR codes are drawn in the theme text color (markup, not CSS).
    if (mode === 'css' && path === 'theme' && k === 'text') rerenderType('qr');
  };
}
function rerenderType(type) {
  const ids = [];
  walk((b) => { if (b.type === type) ids.push(b.id); });
  for (const bid of ids) if (blockEl(bid)) rerenderBlock(bid);
}
// Theme keys that are classes on the page root (markup) rather than CSS variables (ED.themeMarkupKeys).
const themeRender = (k) => ((ED.themeMarkupKeys || ['preset']).includes(k) ? 'all' : 'css');
const docGetter = (path) => () => (path ? pathGet(S.doc, path) : S.doc);

// Fields bound to a document path; `set` overrides the setter (custom commits).
function fieldsBox(fields, path, render = 'all', cls = '', set = null) {
  const c = h('div', { class: 'ed-fields' + (cls ? ' ' + cls : '') });
  renderFields(c, fields, docGetter(path), set || docSetter(path, render), { rerender: () => renderDocSettings() });
  return c;
}

// Font select options: the product's font stacks plus uploaded font files.
function fontOptions() {
  const opts = Object.keys(ED.fontStacks || {}).map((k) => ({ v: k, l: 'fs.' + k }));
  for (const a of Object.values(S.doc.attachments)) {
    if (isFontMime(a.mime, a.name)) opts.push({ v: 'asset:' + a.id, text: '⤓ ' + a.name });
  }
  return opts;
}

// Theme preset cards: applying one copies its variables (colours, fonts, shape…) into the document theme.
// swatches(vars) → [colour, ...] shown on the card; bg(vars) → card background.
// Applying a preset copies its variables into the document (clone: the THEMES constant must never be aliased
// into editable state, or the next edit would mutate the preset itself for the whole session).
function presetCards(swatches, bg = () => '') {
  const th = S.doc.theme;
  const cards = h('div', { class: 'ed-preset-grid' });
  for (const [k, p] of Object.entries(THEMES || {})) {
    const vars = p.vars || {};
    const on = th.preset === k;
    const stack = own(ED.fontStacks, vars.fontHead);
    cards.append(h('button', {
      type: 'button', class: 'ed-preset' + (on ? ' ed-on' : ''), 'aria-pressed': String(on), title: t('t.' + k),
      onclick: () => {
        commit('theme preset', () => { Object.assign(S.doc.theme, clone(vars), { preset: k }); }, { render: 'all' });
        renderDocSettings();
      },
    },
    h('span', { class: 'ed-swatches', style: { background: bg(vars) || 'transparent' } }, swatches(vars).map((c) => h('span', { style: { background: c || 'transparent' } }))),
    h('span', { class: 'ed-preset-l', style: { fontFamily: typeof stack === 'string' ? stack : '' } }, t('t.' + k))));
  }
  return section('ds-presets', t('ds.presets'), cards);
}

// "Reset colors to preset" button.
function resetThemeButton() {
  return h('button', {
    type: 'button', class: 'ed-btn ed-sm', onclick: () => {
      const p = own(THEMES, S.doc.theme.preset);
      if (!p) return;
      commit('theme reset', () => Object.assign(S.doc.theme, clone(p.vars || {})), { render: 'all' });
      renderDocSettings();
    },
  }, iconEl('replace'), t('ds.resetTheme'));
}

// "Upload font…": the font becomes the body font (it is offered in both font lists).
function uploadFontButton() {
  return h('button', {
    type: 'button', class: 'ed-btn ed-sm', onclick: async () => {
      const files = await pickFiles({ accept: '.woff2,.woff,.ttf,.otf,font/*' });
      if (!files.length) return;
      const ids = await addFiles(files.slice(0, 1), { asset: true, quiet: true });
      if (ids.length) { commit('font', () => { S.doc.theme.fontBody = 'asset:' + ids[0]; }, { render: 'all' }); renderDocSettings(); toast(t('ds.fontApplied'), 'ok'); }
    },
  }, iconEl('font'), t('ds.uploadFont'));
}

// Metadata tab: project name, the product's meta fields (path 'meta'), hint and dates.
function metaTab(fields) {
  return (body) => {
    const nameRow = fieldRow({ key: 'name', type: 'text', label: 'ds.projectName' }, () => S.doc.name, (v, typing) => {
      commit('rename', () => { S.doc.name = v; }, { render: 'none', coalesce: typing ? 'doc:name' : null });
      const top = $('#ed-name');
      if (top && document.activeElement !== top) top.value = v;
    });
    body.append(section('ds-meta', t('ds.meta'), h('div', { class: 'ed-fields' }, nameRow, fieldsBox(fields, 'meta', 'none'))));
    body.append(h('p', { class: 'ed-hint' }, t('ds.metaHint')));
    if (S.doc.meta?.created) body.append(h('p', { class: 'ed-muted' }, t('ds.created', { date: fmtDate(S.doc.meta.created) })));
    if (S.doc.meta?.modified) body.append(h('p', { class: 'ed-muted' }, t('ds.modified', { date: fmtDate(S.doc.meta.modified) })));
  };
}

// Content languages tab.
function langsTab(body) {
  const box = h('div', { class: 'ed-langman' });
  renderLangManager(box);
  body.append(section('ds-langs', t('lm.title'), box));
}

export {
  docGetter,
  docSetter,
  fieldsBox,
  fontOptions,
  langsTab,
  metaTab,
  openDocTab,
  presetCards,
  renderDocSettings,
  renderRight,
  rerenderType,
  resetThemeButton,
  setDocTab,
  setRightTab,
  themeRender,
  uploadFontButton
};
