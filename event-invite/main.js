// event-invite/main.js - the designer page: the event type with its scenario, content languages and texts, the date
// and time with the "when" line in words for every language and the countdown, the place with map coordinates, the
// programme (one or several days), the dress code with colours, the reply options (contacts, deadline, maybe,
// companions, menu), the design (themes, ornaments, fonts, the envelope and its seal, motion), a live preview of the
// exported page (a sandboxed frame updated by messages) and the exports: the invitation HTML (interactive when an RSVP
// server is set), the .ics file with its text, the e-mail (.eml), PDF cards with a chosen font, printed A5 / A6 cards
// and the project file. Online builds also publish the invitation to an RSVP server (net.js; never in offline builds).
//
// Architecture (same as guests.js): module state S (shared event record), E (language being edited), V (preview
// view state, never saved). render() rebuilds every card (template, language, project changes); field edits mutate
// S in place and call changed() = debounced save + paintDerived() (cheap text outputs) + previewSoon() (debounced
// preview update). Rebuilding on every keystroke would destroy the focused input.
//
// Preview pipeline: the first view and the envelope replay load a full document into a sandboxed iframe (srcdoc);
// every later edit posts { D, css } to the running page, which re-renders in place and keeps its scroll position.
// The sandbox has no allow-same-origin: the preview runs with an opaque origin, so invitation code can never reach
// the designer's localStorage or DOM, exactly as an exported file opened by a guest cannot.
import { PDF_FONT, fontPicker, SCENARIO_KEYS, applyScenario, eventFile, eventICS, fillLanguage, group, inviteData, inviteHTML, loadEvent, normalizeEvent, onStorage, saveEvent, scenarioIcon, startShell, uid } from './common.js';
import { DRESS_CODES, FONT_KEYS, LANGS, LANG_NAMES, ORNAMENTS, THEMES, THEME_KEYS, cardHTML, countdown, dateWords, inviteCSS, localDay, mapLinks, ornamentHead, timeWords, txt } from './invite.js';
import { button, card, colorInput, copyText, download, field, range, seg, select, t, textInput, toast, toggle } from '../ui/app.js';
import { $, $$, debounce, h } from '../ui/dom.js';
import { icon, iconEl } from '../ui/icons.js';
import { confirmDialog } from '../ui/overlays.js';
import { pickFiles } from '../ui/files.js';
import { qrSVG } from '../qr/qr.js';
import { ONLINE, api } from './net.js';
import { buildEml } from './mailer.js';
import { cardsPDF } from './cards-pdf.js';

let S = loadEvent();
// BACKEND artifact served over http(s): the RSVP server is the page's own origin, so prefill it.
if (ONLINE && !S.server.url && globalThis.IN_HTML_ARTIFACT?.mode === 'backend' && /^https?:/.test(location.protocol)) S.server.url = location.origin;
let E = S.langs[0];                          // the language whose texts are edited
const V = { view: 'phone', lang: '', envelope: false, ready: false };
const save = debounce(() => saveEvent(S), 300);

const main = $('#main');
main.classList.add('ei-design');
let els = {};

// ---------------------------------------------------------------------------------------------------------------
// Layout

function render() {
  if (!S.langs.includes(E)) E = S.langs[0];
  main.textContent = '';
  els = {};
  const controls = h('div', { class: 'ei-col ei-ctl' },
    langCard(), textsCard(), whenCard(), placeCard(), programmeCard(), dressCard(), rsvpCard(), designCard(), ONLINE ? serverCard() : null);
  const tpl = card('ei.tpl', templatePicker());
  tpl.classList.add('ei-tpl-card');
  main.append(h('div', { class: 'ei-work' }, tpl, stageColumn(), controls));
  paintDerived();
  previewNow();
}

// --- template ----------------------------------------------------------------------------------------------------

function templatePicker() {
  const box = h('div', { class: 'ei-tpls', role: 'radiogroup', 'aria-label': t('ei.tpl') });
  for (const k of SCENARIO_KEYS) {
    box.append(h('button', {
      type: 'button', role: 'radio', class: 'ei-tpl' + (k === S.type ? ' ei-on' : ''), 'aria-checked': String(k === S.type), tabindex: k === S.type ? '0' : '-1', dataset: { k },
      onclick: () => useTemplate(k),
    }, h('span', { class: 'ei-tpl-i', 'aria-hidden': 'true' }, scenarioIcon(k)), h('span', {}, t('ei.type.' + k))));
  }
  // Roving tabindex radiogroup (WAI-ARIA pattern): only the checked option is tabbable, arrows move AND select.
  // Same logic as arrowKeys() below; kept inline because the template click also re-renders the page.
  box.addEventListener('keydown', (e) => {
    const btns = $$('.ei-tpl', box), i = btns.indexOf(document.activeElement);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (i < 0 || !step) return;
    e.preventDefault();
    const b = btns[(i + step + btns.length) % btns.length];
    b.focus(); b.click();
  });
  box.append(h('p', { class: 'ed-hint ei-tpl-hint' }, t('ei.tpl.hint')));
  return box;
}

function useTemplate(k) {
  // Undo snapshot as JSON: applyScenario mutates S deeply, so a structural copy is the simplest exact restore.
  // The snapshot goes through normalizeEvent like any other loaded state.
  const before = JSON.stringify(S);
  applyScenario(S, k);
  changed();
  render();
  // render() replaced the button; focus is restored to its new twin so keyboard users stay in place.
  $(`.ei-tpl[data-k="${k}"]`)?.focus();
  toast(t('ei.tpl.applied', { name: t('ei.type.' + k) }), 'ok', { label: t('dlg.undo'), fn: () => { S = normalizeEvent(JSON.parse(before)); changed(); render(); } });
}

// --- languages and texts -----------------------------------------------------------------------------------------

const multi = () => S.langs.length > 1;
// '=' prefix = literal text for field(), not an i18n key (ui/app.js convention). Labels name the edited language
// when several exist, so the user always knows which translation the inputs change.
const lab = (k) => (multi() ? `=${t(k)} · ${E.toUpperCase()}` : k);
// Per-language text input; an empty value shows the main language's text as the placeholder.
// The input's lang attribute selects the right spell-checker and IME behaviour for that language.
function ltext(map, attrs = {}) {
  const i = textInput(map[E] ?? '', (v) => { map[E] = v; changed(); }, { ...attrs, placeholder: E !== S.langs[0] ? txt(map, S.langs[0]) : attrs.placeholder || '' });
  i.setAttribute('lang', E);
  return i;
}

function langCard() {
  const chips = h('div', { class: 'ei-lchips', role: 'group', 'aria-label': t('ei.langs') }, LANGS.map((l) => {
    const on = S.langs.includes(l);
    return h('button', {
      type: 'button', class: 'ei-lchip' + (on ? ' ei-on' : ''), 'aria-pressed': String(on), lang: l, dataset: { l },
      onclick: () => {
        // The last language cannot be removed: an invitation needs at least one. A new language is filled from the scenario
        // (only untouched texts, see fillLanguage) and becomes the edited one, since it is the one that needs work.
        if (S.langs.includes(l)) { if (S.langs.length === 1) return; S.langs = S.langs.filter((x) => x !== l); }
        else { S.langs.push(l); fillLanguage(S, l); E = l; }
        changed(); render(); $(`.ei-lchip[data-l="${l}"]`)?.focus();
      },
    }, LANG_NAMES[l]);
  }));
  const kids = [group('ei.langs', chips, 'ei.langs.hint')];
  if (multi()) {
    // The main language is simply langs[0]; reordering the array is the whole operation.
    const mainSel = select(S.langs.map((l) => ({ v: l, l: '=' + LANG_NAMES[l] })), S.langs[0], (v) => { S.langs = [v, ...S.langs.filter((x) => x !== v)]; changed(); render(); });
    kids.push(field('ei.langs.main', mainSel, 'ei.langs.mainHint'));
    kids.push(group('ei.langs.edit', seg(S.langs.map((l) => ({ v: l, l: '=' + l.toUpperCase() })), E, (v) => { E = v; render(); $('.ei-texts input')?.focus(); }, 'ei.langs.edit')));
  }
  return card('ei.c.langs', ...kids);
}

function textsCard() {
  const c = card('ei.c.texts',
    h('div', { class: 'ed-fields ei-texts' },
      field(lab('ei.f.hosts'), ltext(S.hosts, { maxlength: 200 }), 'ei.f.hostsHint'),
      field(lab('ei.f.title'), ltext(S.title, { maxlength: 200 })),
      field(lab('ei.f.message'), ltext(S.message, { multiline: true, rows: 3, maxlength: 1500 }), 'ei.f.messageHint')));
  return c;
}

// --- when -------------------------------------------------------------------------------------------------------

// Suggestions only (datalist): any IANA zone may be typed. The list covers the content languages' main regions.
const ZONES = ['Asia/Tbilisi', 'Europe/Moscow', 'Europe/Kyiv', 'Europe/Berlin', 'Europe/Paris', 'Europe/Madrid', 'Europe/London', 'America/New_York', 'UTC'];

function whenCard() {
  const set = (k) => (v) => { S[k] = v; changed(); };
  const day = textInput(S.day, set('day'), { type: 'date', id: 'ei-day', required: true });
  const time = textInput(S.time, set('time'), { type: 'time', id: 'ei-time' });
  const end = textInput(S.endTime, set('endTime'), { type: 'time', id: 'ei-end' });
  const endDay = textInput(S.endDay, (v) => { S.endDay = v; changed(); renderProgramme(); }, { type: 'date', id: 'ei-endday', min: S.day || null });
  // Date/time pickers in some browsers fire only `change` when a value is picked; re-dispatch as `input` so the
  // textInput handler (which listens to input) sees it.
  for (const i of [day, time, end, endDay]) i.addEventListener('change', () => i.dispatchEvent(new Event('input')));
  const tz = textInput(S.tz, set('tz'), { list: 'ei-zones', autocomplete: 'off', placeholder: 'Asia/Tbilisi' });
  els.words = h('ul', { class: 'ei-when-words', 'aria-live': 'polite' });
  return card('ei.c.when',
    h('div', { class: 'ed-fields' },
      h('div', { class: 'ed-grid2' }, field('ei.f.day', day), field('ei.f.time', time)),
      h('div', { class: 'ed-grid2' }, field('ei.f.endTime', end), field('ei.f.endDay', endDay, 'ei.f.endDayHint')),
      field('ei.f.tz', tz, 'ei.f.tzHint'),
      h('datalist', { id: 'ei-zones' }, ZONES.map((z) => h('option', { value: z }))),
      h('div', { class: 'ei-words-box' }, h('div', { class: 'ed-label' }, t('ei.f.words')), els.words)));
}

// --- place ------------------------------------------------------------------------------------------------------

// '41.69, 44.80', 'geo:41.69,44.80', OpenStreetMap (mlat / mlon or #map=z/lat/lon) and Google Maps (@lat,lon) links.
// Patterns ordered most specific first; the bare pair is anchored (^...$) so a random number pair inside a longer
// URL is not taken. Decimal commas accepted. Range check rejects swapped or garbage values (|lat| <= 90).
export function parseCoords(s) {
  const x = String(s || '');
  const num = '(-?\\d{1,3}(?:[.,]\\d+)?)';
  const pats = [new RegExp('mlat=' + num + '.*?mlon=' + num), new RegExp('#map=\\d+/' + num + '/' + num), new RegExp('@' + num + ',' + num), new RegExp('geo:' + num + ',' + num), new RegExp('^\\s*' + num + '\\s*[,; ]\\s*' + num + '\\s*$')];
  for (const re of pats) {
    const m = re.exec(x);
    if (m) {
      const lat = +m[1].replace(',', '.'), lon = +m[2].replace(',', '.');
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat: String(lat), lon: String(lon) };
    }
  }
  return null;
}

function placeCard() {
  const lat = textInput(S.geo.lat, (v) => { S.geo.lat = v.trim(); changed(); }, { inputmode: 'decimal', placeholder: '41.6941' });
  const lon = textInput(S.geo.lon, (v) => { S.geo.lon = v.trim(); changed(); }, { inputmode: 'decimal', placeholder: '44.8008' });
  const paste = textInput('', () => {}, { placeholder: t('ei.f.coordsPh'), 'aria-label': t('ei.f.coords') });
  const take = () => {
    const c = parseCoords(paste.value);
    if (!c) { toast(t('ei.f.coordsBad'), 'warn'); return; }
    S.geo = c; lat.value = c.lat; lon.value = c.lon; paste.value = ''; changed();
    toast(t('ei.f.coordsOk'), 'ok');
  };
  // Enter in a single-line input would submit nothing useful; here it means "read these coordinates".
  paste.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); take(); } });
  // setTimeout 0: the paste event fires before the value updates; reading on the next task sees the pasted text.
  paste.addEventListener('paste', () => setTimeout(() => { if (parseCoords(paste.value)) take(); }, 0));
  const read = button('ei.f.read', 'mapPin', take); read.classList.add('ed-sm');
  els.mapLink = h('a', { class: 'ed-btn ed-sm ei-maplink', target: '_blank', rel: 'noopener noreferrer' }, iconEl('external'), h('span', {}, t('ei.f.openMap')));
  return card('ei.c.place',
    h('div', { class: 'ed-fields' },
      field(lab('ei.f.venue'), ltext(S.venue.name, { maxlength: 200 })),
      field(lab('ei.f.address'), ltext(S.venue.address, { multiline: true, rows: 2, maxlength: 400 })),
      h('div', { class: 'ed-grid2' }, field('ei.f.lat', lat), field('ei.f.lon', lon)),
      field('ei.f.coords', h('div', { class: 'ed-row' }, paste, read), 'ei.f.coordsHint'),
      h('div', { class: 'ap-row' }, els.mapLink)));
}

// --- programme -----------------------------------------------------------------------------------------------------

function programmeCard() {
  els.prog = h('div', { class: 'ei-pg-rows' });
  const add = button('ei.pg.add', 'plus', () => {
    const last = S.programme.at(-1);
    // A new item inherits the previous item's day, the likely choice when building a multi-day schedule.
    S.programme.push({ id: uid(6), day: last ? last.day : '', at: '', k: '', title: {} });
    changed(); renderProgramme();
    $$('.ei-pg-row input[type="time"]', els.prog).at(-1)?.focus();
  });
  add.classList.add('ed-sm');
  const c = card('ei.c.programme', els.prog, h('div', { class: 'ap-actions' }, add), h('p', { class: 'ed-hint' }, t('ei.pg.hint')));
  renderProgramme();
  return c;
}

function renderProgramme() {
  const box = els.prog;
  if (!box) return;
  box.textContent = '';
  const days = !!S.endDay;
  box.classList.toggle('ei-pg-days', days);
  if (!S.programme.length) box.append(h('p', { class: 'ap-empty' }, t('ei.pg.empty')));
  S.programme.forEach((p, i) => {
    const at = textInput(p.at, (v) => { p.at = v; changed(); }, { type: 'time', 'aria-label': t('ei.pg.time') });
    // Native time inputs may commit only on change (see whenCard); both paths write p.at.
    at.addEventListener('change', () => { p.at = at.value; changed(); });
    const title = textInput(p.title[E] ?? '', (v) => { p.title[E] = v; changed(); }, { 'aria-label': t('ei.pg.title') + (multi() ? ' · ' + E.toUpperCase() : ''), lang: E, placeholder: E !== S.langs[0] ? txt(p.title, S.langs[0]) : t('ei.pg.titlePh'), maxlength: 200 });
    const dayIn = days ? textInput(p.day, (v) => { p.day = v; changed(); }, { type: 'date', 'aria-label': t('ei.pg.day'), min: S.day, max: S.endDay }) : null;
    // Move up/down by swapping neighbours, re-render, then focus the same button on the moved row so repeated
    // presses keep moving the same item.
    const mv = (d) => () => { const j = i + d; if (j < 0 || j >= S.programme.length) return; [S.programme[i], S.programme[j]] = [S.programme[j], S.programme[i]]; changed(); renderProgramme(); $$('.ei-pg-row', box)[j]?.querySelector(d < 0 ? '.ei-up' : '.ei-down')?.focus(); };
    const ib = (ic, label, fn, cls) => h('button', { type: 'button', class: 'ed-iconbtn ed-sm ' + cls, title: t(label), 'aria-label': t(label), html: icon(ic), onclick: fn });
    box.append(h('div', { class: 'ei-pg-row' }, dayIn, at, title,
      h('div', { class: 'ei-pg-btns' }, ib('up', 'ei.pg.up', mv(-1), 'ei-up'), ib('down', 'ei.pg.down', mv(1), 'ei-down'),
        ib('trash', 'ei.pg.remove', () => { S.programme.splice(i, 1); changed(); renderProgramme(); }, 'ed-danger'))));
  });
}

// --- dress code -------------------------------------------------------------------------------------------------

function dressCard() {
  const d = S.dress;
  const code = select(DRESS_CODES.map((c) => ({ v: c, l: 'ei.inv.dress.' + c })), d.code, (v) => { d.code = v; changed(); });
  const sw = h('div', { class: 'ei-swatches' });
  const paint = () => {
    sw.textContent = '';
    d.colors.forEach((c, i) => {
      const inp = colorInput(c, (v) => { d.colors[i] = v; changed(); });
      inp.setAttribute('aria-label', t('ei.dress.color', { n: i + 1 }));
      sw.append(h('span', { class: 'ei-sw' }, inp, h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('ei.dress.remove'), 'aria-label': t('ei.dress.remove'), html: icon('close'), onclick: () => { d.colors.splice(i, 1); changed(); paint(); } })));
    });
    if (d.colors.length < 5) {
      // A new swatch starts with the theme accent: a colour that already fits the design.
      const add = button('ei.dress.add', 'plus', () => { d.colors.push(THEMES[S.design.theme].accent); changed(); paint(); });
      add.classList.add('ed-sm');
      sw.append(add);
    }
  };
  paint();
  return card('ei.c.dress', h('div', { class: 'ed-fields' },
    field('ei.f.dress', code),
    field(lab('ei.f.dressNote'), ltext(d.note, { multiline: true, rows: 2, maxlength: 400 })),
    group('ei.f.palette', sw, 'ei.f.paletteHint')));
}

// --- replies ------------------------------------------------------------------------------------------------------

function rsvpCard() {
  const r = S.rsvp;
  const deadline = textInput(r.deadline, (v) => { r.deadline = v; changed(); }, { type: 'date' });
  deadline.addEventListener('change', () => { r.deadline = deadline.value; changed(); });
  return card('ei.c.rsvp', h('div', { class: 'ed-fields' },
    h('p', { class: 'ed-hint ei-lead' }, t('ei.r.lead')),
    field('ei.r.email', textInput(r.email, (v) => { r.email = v.trim(); changed(); }, { type: 'email', autocomplete: 'email', placeholder: 'host@example.com' })),
    field('ei.r.phone', textInput(r.phone, (v) => { r.phone = v; changed(); }, { type: 'tel', autocomplete: 'tel', placeholder: '+995 555 12 34 56' }), 'ei.r.phoneHint'),
    field('ei.r.deadline', deadline),
    field('ei.r.maybe', toggle(r.maybe, (v) => { r.maybe = v; changed(); })),
    field('ei.r.plus', range({ min: 0, max: 5, step: 1, value: r.plus, onInput: (v) => { r.plus = v; changed(); } }), 'ei.r.plusHint'),
    field(lab('ei.r.menu'), ltext(r.menu, { placeholder: t('ei.r.menuPh'), maxlength: 300 }), 'ei.r.menuHint'),
    field(lab('ei.r.note'), ltext(r.note, { multiline: true, rows: 2, maxlength: 400 }))));
}

// --- design -----------------------------------------------------------------------------------------------------

function designCard() {
  const d = S.design;
  // Theme chips carry their colours as custom properties; the CSS draws the miniature (see app.css).
  const themes = h('div', { class: 'ei-themes', role: 'radiogroup', 'aria-label': t('ei.d.theme') }, THEME_KEYS.map((k) => {
    const th = THEMES[k], on = d.theme === k;
    return h('button', {
      type: 'button', role: 'radio', class: 'ei-theme' + (on ? ' ei-on' : ''), 'aria-checked': String(on), tabindex: on ? '0' : '-1', dataset: { k },
      style: { '--a': th.bg, '--b': th.bg2, '--p': th.paper, '--c': th.accent, '--s': th.seal },
      // paintRadios instead of render(): only the selection state changes, the preview follows via changed().
      onclick: () => { d.theme = k; changed(); paintRadios(themes, k); },
    }, h('span', { class: 'ei-theme-art', 'aria-hidden': 'true' }, h('i')), h('span', { class: 'ei-theme-n' }, t('ei.theme.' + k)));
  }));
  arrowKeys(themes, '.ei-theme');
  const orns = h('div', { class: 'ei-orns', role: 'radiogroup', 'aria-label': t('ei.d.ornament') }, ORNAMENTS.map((k) => h('button', {
    type: 'button', role: 'radio', class: 'ei-orn' + (d.ornament === k ? ' ei-on' : ''), 'aria-checked': String(d.ornament === k), tabindex: d.ornament === k ? '0' : '-1', dataset: { k },
    title: t('ei.orn.' + k), onclick: () => { d.ornament = k; changed(); paintRadios(orns, k); },
  }, h('span', { class: 'ei-orn-art', html: ornamentHead(k) }), h('span', { class: 'ei-orn-n' }, t('ei.orn.' + k)))));
  arrowKeys(orns, '.ei-orn');
  return card('ei.c.design', h('div', { class: 'ed-fields' },
    group('ei.d.theme', themes),
    group('ei.d.ornament', orns),
    group('ei.d.font', seg(FONT_KEYS.map((k) => ({ v: k, l: 'ei.font.' + k })), d.font, (v) => { d.font = v; changed(); }, 'ei.d.font')),
    field('ei.d.envelope', toggle(d.envelope, (v) => { d.envelope = v; changed(); }), 'ei.d.envelopeHint'),
    field('ei.d.seal', textInput(d.seal, (v) => { d.seal = v; changed(); }, { maxlength: 4, placeholder: t('ei.d.sealPh') }), 'ei.d.sealHint'),
    field('ei.d.motion', toggle(d.motion, (v) => { d.motion = v; changed(); }), 'ei.d.motionHint')));
}
// Updates checked state, class and roving tabindex together so visual, ARIA and keyboard state never diverge.
function paintRadios(box, k) {
  for (const b of box.children) { const on = b.dataset.k === k; b.classList.toggle('ei-on', on); b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; }
}
function arrowKeys(box, sel) {
  box.addEventListener('keydown', (e) => {
    const btns = $$(sel, box), i = btns.indexOf(document.activeElement);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (i < 0 || !step) return;
    e.preventDefault();
    const b = btns[(i + step + btns.length) % btns.length];
    b.focus(); b.click();
  });
}

// --- stage: preview and exports -------------------------------------------------------------------------------------

function stageColumn() {
  // Sandbox: scripts (the runtime), popups that escape the sandbox (map links open normally), downloads (.ics),
  // modals; deliberately NOT allow-same-origin (see the module header).
  els.frame = h('iframe', { id: 'ei-preview', class: 'ei-frame', title: t('ei.p.frame'), sandbox: 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals' });
  els.frame.addEventListener('load', () => { V.ready = true; });
  const view = seg([{ v: 'phone', l: 'ei.p.phone', icon: 'phone' }, { v: 'wide', l: 'ei.p.wide', icon: 'monitor' }], V.view, (v) => { V.view = v; els.device.className = 'ei-device ei-' + v; }, 'ei.p.view');
  const langs = S.langs.length > 1 ? select(S.langs.map((l) => ({ v: l, l: '=' + LANG_NAMES[l] })), V.lang || S.langs[0], (v) => { V.lang = v; previewNow(); }) : null;
  if (langs) langs.setAttribute('aria-label', t('ei.p.lang'));
  // The options object for inviteHTML is built synchronously inside previewNow before its first await, so resetting
  // V.envelope right after the call is safe: only this one preview shows the closed envelope.
  const play = button('ei.p.play', 'play', () => { V.envelope = true; previewNow(); V.envelope = false; });
  play.classList.add('ed-sm');
  const tab = button('ei.p.tab', 'external', openTab);
  tab.classList.add('ed-sm');
  els.device = h('div', { class: 'ei-device ei-' + V.view }, els.frame);
  const stage = h('section', { class: 'ap-card ei-stage', 'aria-label': t('ei.p.title') },
    h('div', { class: 'ei-stage-bar' }, view, langs, h('span', { class: 'ed-spacer' }), play, tab),
    h('div', { class: 'ei-stage-in' }, els.device));
  return h('div', { class: 'ei-col ei-stage-col' }, stage, exportCard());
}

function exportCard() {
  els.ics = h('pre', { class: 'ap-pre ei-ics-text', tabindex: '0' });
  // data-x = the label key: a stable hook for e2e.js that does not depend on the UI language.
  const b = (label, ic, fn, kind) => { const x = button(label, ic, fn, kind); x.dataset.x = label; return x; };
  const copyIcs = button('ei.x.copyIcs', 'copy', () => copyText(eventICS(S, E), t('ei.x.copiedIcs')));
  copyIcs.classList.add('ed-sm');
  return card('ei.c.export',
    h('p', { class: 'ed-hint ei-lead' }, t('ei.x.lead')),
    h('div', { class: 'ap-actions ei-x' }, b('ei.x.html', 'download', exportHTML, 'primary'), b('ei.x.ics', 'calendar', exportICS)),
    h('div', { class: 'ap-actions ei-x' }, b('ei.x.eml', 'mail', exportEml), b('ei.x.pdfA5', 'paper', () => exportPDF('a5')), b('ei.x.pdfA6', 'paper', () => exportPDF('a6'))),
    fontPicker(),
    h('div', { class: 'ap-actions ei-x' }, b('ei.x.a5', 'print', () => printCards('a5')), b('ei.x.a6', 'print', () => printCards('a6'))),
    h('details', { class: 'ei-details' }, h('summary', {}, iconEl('chevRight'), h('span', {}, t('ei.x.icsText'))), els.ics, h('div', { class: 'ap-actions' }, copyIcs)),
    h('div', { class: 'ap-actions ei-x ei-proj' }, b('ei.x.save', 'json', saveProject), b('ei.x.open', 'folder', openProject), b('ei.x.new', 'filePlus', newEvent)));
}

async function exportHTML() {
  try { download(await inviteHTML(S), eventFile(S, '.html'), 'text/html'); toast(t('ei.x.htmlDone'), 'ok'); }
  catch (e) { toast(t('err.generic', { msg: e.message }), 'error'); }
}
function exportICS() {
  const text = eventICS(S, E);
  if (!text) { toast(t('ei.x.noDate'), 'warn'); return; }
  download(text, eventFile(S, '.ics'), 'text/calendar');
}
// Blob URL instead of a data: URL: browsers block top-level navigation to data: URLs. Revoked after a minute,
// long enough for the new tab to load it.
async function openTab() {
  try {
    const url = URL.createObjectURL(new Blob([await inviteHTML(S)], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { toast(t('err.generic', { msg: e.message }), 'error'); }
}
function exportEml() {
  const m = buildEml(inviteData(S), { lang: E, link: S.link || '' });
  download(m.text, m.name, 'message/rfc822');
}
function exportPDF(size) {
  try { download(cardsPDF(inviteData(S), { size, fonts: PDF_FONT.bytes ? [PDF_FONT.bytes] : [], qr: S.link }), eventFile(S, '-' + size + '.pdf'), 'application/pdf'); }
  catch (e) { toast(t('err.generic', { msg: e.message }), 'error'); }
}
// --- RSVP server (online builds) ----------------------------------------------------------------------------------

function serverCard() {
  const sv = S.server;
  const status = h('p', { class: 'ed-hint ei-sv-status' }, sv.event ? t('ei.sv.event', { id: sv.event }) : t('ei.sv.none'));
  const url = textInput(sv.url, (v) => { sv.url = v.trim().replace(/\/+$/, ''); changed(); }, { type: 'url', class: 'ed-input ei-sv-url', placeholder: 'https://rsvp.example.com', spellcheck: 'false' });
  const token = textInput(sv.token, (v) => { sv.token = v.trim(); changed(); }, { type: 'password', autocomplete: 'off', class: 'ed-input ei-sv-token', spellcheck: 'false' });
  const ev = textInput(sv.event, (v) => { sv.event = v.replace(/[^\w-]/g, ''); changed(); }, { class: 'ed-input ei-sv-event', spellcheck: 'false' });
  // First publish (no id/token): POST creates the event and returns the token once; it is stored in S right away,
  // since losing it means losing owner access. Later publishes PUT with the token. Only public fields are sent.
  const publish = button('ei.sv.publish', 'upload', async () => {
    if (!/^https?:\/\//.test(sv.url)) { toast(t('ei.sv.urlHint'), 'warn'); return; }
    const D = inviteData(S);
    const body = { invite: { title: D.title, hosts: D.hosts, day: D.day, time: D.time, endDay: D.endDay, endTime: D.endTime, tz: D.tz, type: D.type, langs: D.langs }, live: sv.live };
    try {
      if (sv.event && sv.token) { await api(sv.url, 'api/events/' + encodeURIComponent(sv.event), { method: 'PUT', body, token: sv.token }); toast(t('ei.sv.updated'), 'ok'); }
      else { const r = await api(sv.url, 'api/events', { method: 'POST', body }); sv.event = r.id; sv.token = r.token; ev.value = r.id; token.value = r.token; toast(t('ei.sv.published', { id: r.id }), 'ok'); }
      status.textContent = t('ei.sv.event', { id: sv.event });
      changed();
    } catch (e) { toast(t('ei.sv.fail', { msg: e.message }), 'error'); }
  }, 'primary');
  return card('ei.c.server', h('div', { class: 'ed-fields' },
    h('p', { class: 'ed-hint ei-lead' }, t('ei.sv.lead')),
    field('ei.sv.url', url, 'ei.sv.urlHint'),
    h('div', { class: 'ed-grid2' }, field('ei.sv.eventId', ev), field('ei.sv.token', token)),
    h('p', { class: 'ed-hint' }, t('ei.sv.tokenHint')),
    field('ei.sv.live', toggle(sv.live, (v) => { sv.live = v; changed(); }), 'ei.sv.liveHint'),
    h('div', { class: 'ap-actions' }, publish), status));
}

// `app` marker lets openProject reject JSON files of other apps instead of silently normalising them into nonsense.
function saveProject() { download(JSON.stringify({ app: 'event-invite', ...S }, null, 1), eventFile(S, '.event.json'), 'application/json'); }
async function openProject() {
  const [f] = await pickFiles({ accept: '.json,application/json' });
  if (!f) return;
  try {
    const o = JSON.parse(await f.text());
    // A file without `app` is still accepted (older exports); normalizeEvent makes any object safe.
    if (!o || typeof o !== 'object' || (o.app && o.app !== 'event-invite')) throw new Error(t('ei.x.notProject'));
    S = normalizeEvent(o); E = S.langs[0]; changed(); render();
    toast(t('ei.x.opened'), 'ok');
  } catch (e) { toast(t('err.generic', { msg: e.message }), 'error'); }
}
async function newEvent() {
  if (!(await confirmDialog(t('ei.x.new'), t('ei.x.newText'), t('ei.x.newGo'), true))) return;
  // "New event" keeps the content languages: a host who works in Georgian + English wants the same next time.
  const keep = S.langs;
  S = normalizeEvent({ langs: keep });
  applyScenario(S, 'wedding');
  E = S.langs[0]; changed(); render();
}

// Printed cards: one page per content language, A5 or A6, with a QR code of the invitation link when it is known.
// The invitation CSS is injected inside the print sheet; @page sets the paper size with zero margin because the card
// itself is the full sheet. Cleanup is identical to guests.js printNameCards.
function printCards(size) {
  const D = inviteData(S);
  let qr = '';
  if (S.link) { try { qr = qrSVG(S.link, { ec: 'M', margin: 1 }); } catch { qr = ''; } }
  $('#ei-print')?.remove();
  const page = size === 'a6' ? '105mm 148mm' : '148mm 210mm';
  const sheet = h('div', { id: 'ei-print', class: `iv-root ei-print ei-${size}` });
  sheet.innerHTML = `<style>${inviteCSS(D)}@page{size:${page};margin:0}</style>` + S.langs.map((l) => cardHTML(D, l, { print: true, qr })).join('');
  document.body.append(sheet);
  document.body.classList.add('ei-printing');
  const done = () => { document.body.classList.remove('ei-printing'); sheet.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(done, 1000); }, 60);
}

// ---------------------------------------------------------------------------------------------------------------
// Updates

function changed() { save(); paintDerived(); previewSoon(); }

// The "when" lines of every content language, the map link and the calendar text.
// Cheap enough to recompute on every edit (a few strings), so no dirty tracking.
function paintDerived() {
  const D = inviteData(S), today = localDay();
  if (els.words) {
    els.words.textContent = '';
    for (const l of S.langs) {
      const w = dateWords(D, l);
      els.words.append(h('li', { lang: l }, multi() ? h('b', {}, l.toUpperCase()) : null,
        h('span', {}, w ? [w, timeWords(D)].filter(Boolean).join(' · ') : t('ei.f.noDate')),
        w ? h('span', { class: 'ei-count' }, countdown(D, l, today)) : null));
    }
  }
  if (els.mapLink) {
    const m = mapLinks(D, E);
    if (m) { els.mapLink.href = m.osm; els.mapLink.hidden = false; } else els.mapLink.hidden = true;
  }
  if (els.ics) els.ics.textContent = eventICS(S, E) || t('ei.x.noDate');
}

// The preview frame: a full reload for the envelope and the first view, messages for every edit (keeps the scroll).
// token: a generation counter; inviteHTML is async (runtime bundle fetch), so an older call finishing late must not
// overwrite a newer preview. V.ready drops while the new document loads, so edits meanwhile trigger a full reload
// instead of posting to a page that is not listening yet.
let token = 0;
async function previewNow() {
  const my = ++token;
  try {
    const html = await inviteHTML(S, { preview: { open: !V.envelope, lang: V.lang && S.langs.includes(V.lang) ? V.lang : S.langs[0] } });
    if (my !== token || !els.frame) return;
    V.ready = false;
    els.frame.srcdoc = html;
  } catch (e) { toast(t('err.generic', { msg: e.message }), 'error'); }
}
const previewSoon = debounce(() => {
  if (!V.ready || !els.frame?.contentWindow) { previewNow(); return; }
  const D = inviteData(S, { preview: { open: true, lang: V.lang && S.langs.includes(V.lang) ? V.lang : S.langs[0] } });
  // targetOrigin '*': the sandboxed frame's origin is opaque ("null") and cannot be named. The payload is the same
  // public invitation data the frame already shows, so no secret is exposed.
  els.frame.contentWindow.postMessage({ iv: 'update', D, css: inviteCSS(D) }, '*');
}, 200);

// The guests page saved the same record in another tab.
// Full reload of S: the other tab may have changed anything (guest list, capacity), and S is one object.
onStorage(() => { S = loadEvent(); render(); });

startShell('design', () => render());
render();
