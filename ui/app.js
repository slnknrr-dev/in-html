// ui/app.js - the shell of a single-page tool built on ui/base.css + ui/app.css: header (brand, the pages of the
// application, UI language, colour scheme), offline badge, file drop zones, downloads, clipboard and a few form
// controls. Applications register their strings with addDicts (ui/i18n.js) before calling startApp().
//
// Design rules of this module:
// - The shell is RE-RENDERABLE: renderTop / renderFoot clear and rebuild their element on every language switch
//   instead of patching labels. Simpler than tracking every translatable node; cost is negligible (a dozen nodes).
//   Consequence: nothing outside this module may keep references into #ap-top / #ap-foot.
// - Elements are found by id (#ap-top, #ap-foot, #ed-overlays) and created only if missing, so a page may ship them
//   in static HTML (no layout shift on boot) or let JS create them — both work.
// - Persistent state goes through lsGet / lsSet (JSON, try/catch): private mode or a disabled storage must degrade
//   to "not remembered", never to a crash at startup.
// - Single module-level APP record: one shell per document. startApp() twice re-configures, it does not stack.
// - Form controls below return plain DOM elements carrying an optional .set(v) method: external state changes repaint
//   the control WITHOUT firing onChange (no feedback loops between state and view).
//
// Side-effect import first: strings.js registers the shell's own i18n keys (ap.*, dlg.*) before any t() call.
import './strings.js';
import { $, $$, h, lsGet, lsSet } from './dom.js';
import { downloadBlob, pickFiles } from './files.js';
import { icon, iconEl } from './icons.js';
import { ED_I18N, UI_STATE, applyStaticI18n, detectUILang, t } from './i18n.js';
import { langLabel } from './lang.js';
import { bindLayerKeys, toast } from './overlays.js';

const APP = { key: 'app', onLang: null, opts: null };
const THEMES = ['auto', 'light', 'dark'];

// Colour scheme: 'auto' follows the system; 'light' / 'dark' set <html data-theme>.
// ui/base.css defines the matching token blocks: no attribute → prefers-color-scheme decides; [data-theme] forces.
// 'auto' REMOVES the attribute rather than setting data-theme="auto": the CSS needs no third selector and the OS
// media query keeps working live (an OS switch at night repaints without JS). Unknown stored values fall back to
// 'auto' (fail soft on corrupted / old storage). The attribute lives on <html> so :root selectors match it.
// KNOWN DEFECT: the theme is applied in startApp(), i.e. after the module graph loaded; a page with a forced
// non-OS theme paints one frame in the OS theme (flash). Fix: an inline <head> script reading `<key>-theme` from
// localStorage before first paint.
function applyTheme(v) {
  const k = THEMES.includes(v) ? v : 'auto';
  if (k === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', k);
  lsSet(APP.key + '-theme', k);
  // Repaint the radio group in place (aria-checked for AT, .ed-on for CSS) — re-rendering the header here would
  // destroy the button that holds focus.
  for (const b of $$('#ap-theme [data-k]')) { b.setAttribute('aria-checked', String(b.dataset.k === k)); b.classList.toggle('ed-on', b.dataset.k === k); }
}
const currentTheme = () => lsGet(APP.key + '-theme', 'auto');

/**
 * Starts the application shell.
 *   key      storage prefix (UI language, theme)
 *   name     dictionary key of the application name ('app.name'); also the document title
 *   logo     24×24 stroke path of the brand icon
 *   pages    [{ href, label (key), current? }] links between the pages of a multi-page application
 *   offline  true: "works offline" badge (zero network); 'serverless': runs in the browser without our server
 *   onLang   called after the UI language changed (the application re-renders its own UI)
 */
// Order matters: storage keys first (detectUILang reads UI_STATE.storageKey), then language (renderTop needs it),
// theme before rendering (the header paints the current choice), overlay host before anything can toast,
// applyStaticI18n last so it also translates data-i18n nodes the header just created and sets document.title.
// Per-app key prefixes ('uc-ui', 'uc-theme') keep apps on one origin (file:// or one host) from sharing choices.
export function startApp(opts = {}) {
  APP.key = opts.key || 'app';
  APP.onLang = opts.onLang || null;
  APP.opts = opts;
  UI_STATE.storageKey = APP.key + '-ui';
  UI_STATE.titleKey = opts.name || 'app.name';
  UI_STATE.lang = detectUILang();
  document.documentElement.lang = UI_STATE.lang;
  applyTheme(currentTheme());
  bindLayerKeys();
  if (!$('#ed-overlays')) document.body.append(h('div', { id: 'ed-overlays' }));
  renderTop();
  renderFoot();
  applyStaticI18n();
}

// Language switch: persist, update <html lang> (screen readers, hyphenation, :lang() CSS), rebuild the shell, then
// hand over to the app (onLang) to re-render its own UI — the shell cannot know which app nodes hold text.
function setLang(code) {
  UI_STATE.lang = code;
  lsSet(UI_STATE.storageKey, code);
  document.documentElement.lang = code;
  renderTop();
  renderFoot();
  applyStaticI18n();
  if (APP.onLang) APP.onLang(code);
}

// Cycle order of the phone-sized single theme button.
const THEME_NEXT = { auto: 'light', light: 'dark', dark: 'auto' };

// Header. role=banner is explicit because a <header> inside other sectioning content loses its implicit landmark;
// here it is a body child, so it is redundant but harmless. The logo path is interpolated into innerHTML: it comes
// from app code (opts.logo), never from user input — do not pass untrusted strings. The page nav is rendered only
// for 2+ pages (a one-tab nav is noise). The language <select> is rendered only when 2+ dictionaries exist.
// The theme switch is a radiogroup of buttons (role=radio + aria-checked), not native radios: it reuses the
// .ed-seg look and the phone "step" behaviour, which native radios would fight.
function renderTop() {
  const o = APP.opts;
  let top = $('#ap-top');
  if (!top) { top = h('header', { id: 'ap-top', class: 'ap-top', role: 'banner' }); document.body.prepend(top); }
  top.textContent = '';
  const brand = h('div', { class: 'ap-brand' },
    h('span', { class: 'ap-logo', html: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${o.logo || 'M4 4h16v16H4z'}"/></svg>` }),
    h('h1', { class: 'ap-name' }, t(o.name || 'app.name')));
  const nav = (o.pages || []).length > 1 ? h('nav', { class: 'ap-pages', 'aria-label': t('ap.apps') },
    o.pages.map((p) => h('a', { href: p.href, class: 'ap-page' + (p.current ? ' ap-on' : ''), 'aria-current': p.current ? 'page' : null }, t(p.label)))) : null;
  const langs = Object.keys(ED_I18N);
  const lang = h('select', { class: 'ed-input ed-select ap-lang', title: t('ap.lang'), 'aria-label': t('ap.lang') },
    langs.map((l) => h('option', { value: l, selected: l === UI_STATE.lang }, langLabel(l))));
  lang.addEventListener('change', () => setLang(lang.value));
  const theme = h('div', { id: 'ap-theme', class: 'ed-seg ap-theme', role: 'radiogroup', 'aria-label': t('ap.theme') },
    [['auto', 'monitor'], ['light', 'sun'], ['dark', 'moon']].map(([k, ic]) => h('button', {
      type: 'button', role: 'radio', dataset: { k }, title: t('ap.theme.' + k), 'aria-label': t('ap.theme.' + k),
      'aria-checked': String(currentTheme() === k), class: 'ed-seg-btn' + (currentTheme() === k ? ' ed-on' : ''), html: icon(ic),
      // Phones show only the current choice (app.css): a tap on it steps to the next one.
      // The media query string MUST match the 560px breakpoint in ui/app.css; on wider screens a click on the
      // already-selected button is a no-op re-apply. After stepping, focus moves to the newly visible button,
      // otherwise keyboard focus would be lost on a display:none element.
      onclick: () => {
        const step = currentTheme() === k && matchMedia('(max-width: 560px)').matches;
        applyTheme(step ? THEME_NEXT[k] : k);
        if (step) $('#ap-theme .ed-on')?.focus(); // the pressed button is hidden now
      },
    })));
  top.append(...[brand, nav, h('span', { class: 'ed-spacer' }), langs.length > 1 ? lang : null, theme].filter(Boolean));
}

// Footer: the offline / serverless badge is a CLAIM (offline: the app makes no network requests; the build's policy
// audit enforces it for offline apps). opts.footer() lets an app add its own node; called on every re-render so
// it is translated too.
function renderFoot() {
  const o = APP.opts;
  let foot = $('#ap-foot');
  if (!foot) { foot = h('footer', { id: 'ap-foot', class: 'ap-foot' }); document.body.append(foot); }
  foot.textContent = '';
  if (o.offline) {
    foot.append(h('span', { class: 'ap-badge' }, iconEl(o.offline === 'serverless' ? 'globe' : 'shield'),
      t(o.offline === 'serverless' ? 'ap.serverless' : 'ap.offline')));
  }
  if (o.footer) foot.append(o.footer());
}

/**
 * File drop zone: click to choose, drag & drop, or paste (Ctrl+V anywhere on the page when `paste` is set).
 *   onFiles(File[])  accept: <input accept>  multiple: several files  label: dictionary key
 */
export function dropZone({ onFiles, accept = '', multiple = false, label, paste = true } = {}) {
  // The label follows UI language switches (data-i18n, applyStaticI18n).
  const key = label || (multiple ? 'ap.drop' : 'ap.dropOne');
  const zone = h('button', { type: 'button', class: 'ap-drop' }, iconEl('upload'), h('span', { 'data-i18n': key }, t(key)));
  const take = (list) => {
    const files = Array.from(list || []).filter(Boolean);
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  };
  zone.addEventListener('click', async () => take(await pickFiles({ accept, multiple })));
  // dragover must preventDefault to make the element a drop target; it is done only when the drag carries files
  // ('Files' in types), so dragging text or a link over the zone shows "not allowed" instead of a false invitation.
  // KNOWN DEFECT: dragleave also fires when the pointer moves onto a child (icon, label span), so .ap-over flickers
  // during a drag. Fix: ignore dragleave when e.relatedTarget is inside the zone, or count dragenter/dragleave.
  // drop: preventDefault stops the browser from navigating to / opening the dropped file.
  zone.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); zone.classList.add('ap-over'); } });
  zone.addEventListener('dragleave', () => zone.classList.remove('ap-over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('ap-over'); take(e.dataTransfer.files); });
  if (paste) {
    PASTE_ZONES.add({ zone, take });
    bindPaste();
  }
  return zone;
}

// One document paste listener for every drop zone: pasted files go to the most recently created zone on the page.
// Why one listener: N zones with N listeners would all receive the same paste. A Set keeps insertion order, so the
// last connected entry = the newest zone. Zones removed from the DOM are pruned lazily here (isConnected) — there is
// no unmount hook, and a WeakRef registry would be more machinery for the same result.
// Pastes into text fields are left alone: the user is pasting text, and file pastes there are the field's business.
// Only clipboard FILES are taken (screenshots, copied files); a text paste never reaches take().
const PASTE_ZONES = new Set();
let pasteBound = false;
function bindPaste() {
  if (pasteBound) return;
  pasteBound = true;
  document.addEventListener('paste', (e) => {
    if (e.target.closest?.('input, textarea, [contenteditable]')) return;
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) return;
    let last = null;
    for (const z of PASTE_ZONES) if (z.zone.isConnected) last = z; else PASTE_ZONES.delete(z);
    if (last) { e.preventDefault(); last.take(files); }
  });
}

// Saves data (string, Blob, ArrayBuffer or typed array) as a file.
export function download(data, name, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  downloadBlob(blob, name);
}

// Copies text to the clipboard with a toast (msg: own success text); falls back to a hidden textarea where the async
// API is missing.
// navigator.clipboard is undefined in insecure contexts (http:// on a LAN, some file:// setups) and rejects without
// a user gesture or permission; both land in catch. execCommand('copy') is deprecated but still the only path there;
// it needs a selected, attached element — position:fixed avoids scrolling the page to the textarea, opacity 0
// hides it (display:none would make it unselectable). Failure is reported, never thrown: the user can copy manually.
export async function copyText(text, msg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg || t('ap.copied'), 'ok');
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text);
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    toast(ok ? msg || t('ap.copied') : t('ap.copyFail'), ok ? 'ok' : 'warn');
  }
}

// --- form controls (ed-* classes of ui/base.css) ----------------------------------

// Auto ids for label/for pairing. A module counter is unique within the document, which is all `for` needs.
let seq = 0;
const nid = () => 'ap-f' + (++seq);

// Labelled row: field(labelKeyOrText, control, hintKeyOrText?). Text starting with '=' is used literally.
// The '=' escape lets one parameter carry either a dictionary key (translated) or literal data (a file name, a
// number) without a second argument; keys never start with '='.
// <label for> (not wrapping) because the control may be a composite (range wrap) — the label then targets the
// first inner form element. Checkboxes put the control before the label (ed-field-check layout in base.css).
const tx = (s) => (s == null ? '' : String(s).startsWith('=') ? String(s).slice(1) : t(s));
export function field(label, control, hint) {
  const target = control.matches?.('input, select, textarea, button') ? control : control.querySelector?.('input, select, textarea');
  if (target && !target.id) target.id = nid();
  const check = target && target.type === 'checkbox';
  const lab = h('label', { class: 'ed-label', for: target ? target.id : null }, tx(label));
  return h('div', { class: 'ed-field' + (check ? ' ed-field-check' : '') }, check ? [control, lab] : [lab, control],
    hint ? h('div', { class: 'ed-hint' }, tx(hint)) : null);
}

// Segmented choice: options [{ v, l (key or '=text'), icon?, iconOnly? }]; arrow keys move the choice; .set(v) updates it.
// Values are compared as strings (dataset stores strings), so numeric and string values both work.
// KNOWN DEFECT: every button stays in the tab order; the ARIA radiogroup pattern expects a roving tabindex (only the
// checked radio tabbable). Fix: tabindex=-1 on unchecked buttons, updated in paint(). Also iconOnly buttons get a
// title but no aria-label, so their accessible name relies on title. Fix: set aria-label when iconOnly.
export function seg(options, value, onChange, aria = '') {
  const g = h('div', { class: 'ed-seg', role: 'radiogroup', 'aria-label': tx(aria) || null });
  const paint = (v) => { for (const b of g.children) { const on = b.dataset.v === String(v); b.setAttribute('aria-checked', String(on)); b.classList.toggle('ed-on', on); } };
  for (const o of options) {
    g.append(h('button', {
      type: 'button', class: 'ed-seg-btn', role: 'radio', dataset: { v: String(o.v) }, title: o.icon ? tx(o.l) : null,
      onclick: () => { paint(o.v); onChange(o.v); },
    }, o.icon ? iconEl(o.icon) : null, o.icon && o.iconOnly ? null : tx(o.l)));
  }
  paint(value);
  // Radio-group keys: arrows move the choice (and focus) to the previous / next option.
  g.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    const btns = [...g.children];
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    // RTL: visual left is "next", so horizontal arrows invert; vertical arrows do not. Wraps around at both ends.
    // b.click() reuses the button's own handler, so keyboard and mouse share one code path (paint + onChange).
    const dir = getComputedStyle(g).direction === 'rtl' && /Left|Right/.test(e.key) ? -step : step;
    const b = btns[(i + dir + btns.length) % btns.length];
    b.focus();
    b.click();
  });
  // External updates (state changed elsewhere): g.set(value) repaints without calling onChange.
  g.set = paint;
  return g;
}

// Native <select>: options [{ v, l }]; onChange receives the STRING value (DOM values are strings — callers convert).
export function select(options, value, onChange) {
  const s = h('select', { class: 'ed-input ed-select' }, options.map((o) => h('option', { value: String(o.v), selected: String(o.v) === String(value) }, tx(o.l))));
  s.addEventListener('change', () => onChange(s.value));
  s.set = (v) => { s.value = String(v); };
  return s;
}

// Slider + <output>. 'input' (not 'change') fires continuously while dragging: live preview. onInput gets a number
// (+r.value). .set() re-reads r.value after assigning so the label shows the CLAMPED / step-snapped value the
// browser actually kept, not the raw argument.
export function range({ min = 0, max = 100, step = 1, value = 0, unit = '', onInput }) {
  const out = h('output', { class: 'ed-range-val' }, value + unit);
  const r = h('input', { type: 'range', class: 'ed-range', min, max, step, value });
  r.addEventListener('input', () => { out.textContent = r.value + unit; onInput(+r.value); });
  const wrap = h('div', { class: 'ed-range-wrap' }, r, out);
  wrap.set = (v) => { r.value = v; out.textContent = r.value + unit; };
  return wrap;
}

// Switch = native checkbox with role=switch (announced as on/off), styled by .ed-switch in base.css.
export function toggle(checked, onChange) {
  const c = h('input', { type: 'checkbox', class: 'ed-switch', role: 'switch', checked: !!checked });
  c.addEventListener('change', () => onChange(c.checked));
  return c;
}

// Text field. attrs are spread as attributes; `multiline: null` afterwards removes the pseudo-option so h() does
// not emit a bogus multiline="" attribute (h skips null). spellcheck off by default: tools edit codes, hashes, URLs.
export function textInput(value, onInput, attrs = {}) {
  const i = h(attrs.multiline ? 'textarea' : 'input', { class: 'ed-input' + (attrs.multiline ? ' ed-textarea' : ''), value: value ?? '', spellcheck: 'false', ...attrs, multiline: null });
  i.addEventListener('input', () => onInput(i.value));
  return i;
}

export function colorInput(value, onInput) {
  const i = h('input', { type: 'color', class: 'ap-color', value });
  i.addEventListener('input', () => onInput(i.value));
  return i;
}

// Button: button(labelKey, iconName, onClick, 'primary' | 'danger' | '').
// type=button always: inside a <form> the default type=submit would submit / reload the page.
export function button(label, ic, onClick, kind = '') {
  return h('button', { type: 'button', class: 'ed-btn' + (kind ? ' ed-' + kind : ''), onclick: onClick }, ic ? iconEl(ic) : null, label ? tx(label) : null);
}

// Card with a heading: card(titleKey, ...children).
export function card(title, ...kids) {
  return h('section', { class: 'ap-card' }, title ? h('h2', { class: 'ap-card-h' }, tx(title)) : null, ...kids);
}

// Re-exports: an app can import its whole UI surface from ui/app.js.
export { t, toast };
