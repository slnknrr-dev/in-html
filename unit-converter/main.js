// unit-converter/main.js - the converter page: one smart input read in English, Russian and Georgian ("42,5 м²",
// "5'11\"", "3 sq ft", "1 ч 30 мин", "2.5 kg"), the value in every unit of its kind with the converter's rounding,
// the units of the chosen system (metric / US / imperial) highlighted, a main result with the formula, compound
// forms and copy / swap / pin, favourite pairs, history and a table of nearby values. Below: extras for shops and
// real estate - price per unit, the area of a flat from its rooms (with the Euro layout word) and number -> word
// scales (walking distance, Euro layouts).
//
// Design rules of this page:
// - One mutable state object S, persisted debounced (250 ms) to localStorage. Every UI handler mutates S then calls
//   changed() = save() + update(). No framework, no diffing: each paint*() clears its box and rebuilds it. Cheap
//   because the boxes are small (at most a few dozen units of a kind), and it removes a whole class of stale-DOM bugs.
// - render() builds the static skeleton once (and again on language switch); update() repaints only the dynamic
//   boxes. The input element itself is never rebuilt on keystrokes, otherwise focus and caret would be lost.
// - Parse, do not validate: the input is free text; parseQuantity() returns null for anything unreadable and the UI
//   shows a soft "not understood" line instead of an error state. Every paint*() accepts q === null.
// - Untrusted persisted data: loadState() whitelists every field (type, enum, unit existence, length caps) because
//   localStorage is user-editable and survives app upgrades that rename units.
import { COMPOUND, compound, fmt, formula, kindName, lab, niceStep, plainNumber, qty, series, startShell, tableEl, uiLang, uname, unitLang, unitSelect } from './common.js';
import { button, card, copyText, field, seg, t, textInput, toast, toggle } from '../ui/app.js';
import { $, $$, debounce, h, lsGet, lsSet } from '../ui/dom.js';
import { icon, iconEl } from '../ui/icons.js';
import { UNITS, baseUnit, convert, inSystem, unit as unitOf, unitPeer, unitsOfKind } from '../units/registry.js';
import { parseNumber, parseQuantity, unitByLabel } from '../units/parse.js';
import { formatNumber, humanize } from '../units/format.js';
import { DISTANCE_SCALE, scaleStepIndex } from '../units/scales.js';
import { EURO_SCALE, normalizeScale, scaleStepIndex as euroStepIndex, scalePick } from '../estate/scales.js';
import { ROOM_TYPES, roomTypeDef, roomsLayout, roomsSummary } from '../estate/rooms.js';

// ---------------------------------------------------------------------------------------------------------------
// State (persisted in localStorage 'uc-convert'; history in 'uc-history')

// Defaults double as the onboarding demo: every card shows a filled example on first visit (Russian "42,5 м²"
// proves the multilingual parser at a glance). DEF is also the schema loadState() validates against.
const DEF = {
  text: '42,5 м²',
  unit: 'm2',
  system: 'metric',
  prec: 'auto',
  onlySystem: false,
  targets: {},
  pins: [['m2', 'sqft'], ['c', 'f'], ['kg', 'lb'], ['cm', 'in']],
  price: { cur: '', rows: [{ name: '', price: '3,49', size: '250 g' }, { name: '', price: '11,90', size: '1 kg' }, { name: '', price: '5,20', size: '500 g' }] },
  rooms: [
    { type: 'kitchen-living', area: '24' }, { type: 'bedroom', area: '12,5' }, { type: 'bedroom', area: '3,2 × 3,6' },
    { type: 'bath', area: '4,2' }, { type: 'hallway', area: '6' }, { type: 'balcony', area: '3,1' },
  ],
  dist: '650 m',
  euro: 3,
};
// Two keys: history changes on its own cadence (Enter / idle) and is cleared independently of settings.
// PRECS: 'auto' = the converter's significant-digit rule (common.js), numbers = fixed decimals.
const SKEY = 'uc-convert', HKEY = 'uc-history';
const PRECS = ['auto', 0, 2, 4, 6];

// structuredClone(DEF) first, then copy over only validated fields: a corrupt or foreign value falls back to the
// default field by field instead of discarding the whole saved state. Caps (200 / 80 chars, 16 pins, 12 price rows,
// 20 rooms) bound the cost of a hostile or runaway localStorage entry on every render.
// ROOM_CHOICES is a const declared below this function; safe because loadState() is first *called* after it
// (the temporal dead zone applies to execution order, not to textual order).
function loadState() {
  const saved = lsGet(SKEY, null) || {};
  const s = structuredClone(DEF);
  if (typeof saved.text === 'string') s.text = saved.text.slice(0, 200);
  if (unitOf(saved.unit)) s.unit = saved.unit;
  if (['metric', 'us', 'imperial'].includes(saved.system)) s.system = saved.system;
  if (PRECS.includes(saved.prec)) s.prec = saved.prec;
  if (typeof saved.onlySystem === 'boolean') s.onlySystem = saved.onlySystem;
  if (saved.targets && typeof saved.targets === 'object') for (const [k, v] of Object.entries(saved.targets)) if (unitOf(v)?.kind === k) s.targets[k] = v;
  if (Array.isArray(saved.pins)) s.pins = saved.pins.filter((p) => Array.isArray(p) && unitOf(p[0]) && unitOf(p[1]) && unitOf(p[0]).kind === unitOf(p[1]).kind).slice(0, 16);
  const str = (v) => (typeof v === 'string' ? v.slice(0, 80) : '');
  if (saved.price && Array.isArray(saved.price.rows)) s.price = { cur: str(saved.price.cur).slice(0, 6), rows: saved.price.rows.slice(0, 12).map((r) => ({ name: str(r?.name), price: str(r?.price), size: str(r?.size) })) };
  if (Array.isArray(saved.rooms)) s.rooms = saved.rooms.slice(0, 20).map((r) => ({ type: ROOM_CHOICES.includes(r?.type) ? r.type : 'room', area: str(r?.area) }));
  if (typeof saved.dist === 'string') s.dist = str(saved.dist);
  if (Number.isInteger(saved.euro) && saved.euro >= 1 && saved.euro <= 12) s.euro = saved.euro;
  return s;
}
const ROOM_CHOICES = ['kitchen-living', ...Object.keys(ROOM_TYPES)];
const S = loadState();
const save = debounce(() => lsSet(SKEY, S), 250);

// History: most recent first, deduplicated by text (re-entering moves an entry to the top), capped at 20. Read
// fresh from storage each time so another tab's additions are not overwritten by a stale in-memory copy.
const historyList = () => { const v = lsGet(HKEY, []); return Array.isArray(v) ? v.filter((e) => e && typeof e.text === 'string').slice(0, 20) : []; };
function historyAdd(text) {
  const s = text.trim();
  if (!s) return;
  lsSet(HKEY, [{ text: s, at: Date.now() }, ...historyList().filter((e) => e.text !== s)].slice(0, 20));
  paintHistory();
}

// ---------------------------------------------------------------------------------------------------------------
// Reading the input

// The quantity typed; a bare number takes the unit picker's unit. null when nothing convertible was read.
function parsed() {
  const q = parseQuantity(S.text, { unit: S.unit });
  return q && q.kind && Number.isFinite(q.value) ? q : null;
}

// The main target of a source unit: the user's last choice for the kind, else the counterpart in the chosen system
// (or, when the source is already at home there, in metric / US).
// Why remember per kind (S.targets[kind]), not per unit: users think "areas in sq ft", not "m² to sq ft"; one choice
// then holds for every area unit typed later. The `other` flip handles typing a unit that is already home in the
// chosen system (a metric user types m²): m² = m² would be useless, so pick the peer in the opposite system.
// Last resort: any other unit of the kind, or the unit itself for single-unit kinds.
function targetFor(from) {
  const kind = unitOf(from).kind;
  const keep = S.targets[kind];
  if (keep && keep !== from && unitOf(keep)?.kind === kind) return keep;
  const other = inSystem(from, S.system) && unitOf(from).system !== 'other' ? (S.system === 'metric' ? 'us' : 'metric') : S.system;
  const p = unitPeer(from, other);
  if (p && p !== from) return p;
  return unitsOfKind(kind).find((c) => c !== from) || from;
}

// A label that parseQuantity reads back as this unit (the UI language's, else English, else the code).
// Needed by swap/openPair, which write text back into the input: a label the parser cannot read back (e.g. a
// symbol shared by two units) would turn a valid swap into "not understood". Round-trip check, not a lookup table.
function typedLabel(code) {
  for (const l of [lab(code), UNITS[code].label.en, code]) if (unitByLabel(l) === code) return l;
  return code;
}

// Home units of the chosen system: own system or customary (not the units valid everywhere).
const atHome = (c) => UNITS[c].system !== 'other' && inSystem(c, S.system);

// ---------------------------------------------------------------------------------------------------------------
// Layout

const main = $('#main');
main.classList.add('uc-convert');
// els: references to the live boxes of the current render; replaced wholesale by render() so code paths never
// write into nodes detached by a previous (other-language) render.
let els = {};

// Examples cover each parser feature: comma decimal, feet-inches, multi-word unit, compound time, Georgian, sotka.
const EXAMPLES = ['42,5 м²', "5'11\"", '3 sq ft', '1 ч 30 мин', '2.5 kg', '20 °C', '100 km/h', '85 კვ. მ', '15 сот.', '1 gal', '2 GB'];

function render() {
  // textContent = '' drops the previous render; its listeners are collected together with the detached nodes.
  main.textContent = '';
  els = {};
  els.input = textInput(S.text, (v) => { S.text = v; changed(); historySoon(); }, {
    class: 'ed-input uc-big', id: 'uc-in', autocomplete: 'off', inputmode: 'text', 'aria-describedby': 'uc-read', placeholder: t('uc.in.ph'),
  });
  // Enter commits to history immediately and cancels the idle timer, so the same entry is not added twice.
  // Escape clears only when there is something to clear; otherwise the key is left alone for outer handlers.
  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); historySoon.cancel(); if (parsed()) historyAdd(S.text); }
    if (e.key === 'Escape' && els.input.value) { e.preventDefault(); setText(''); }
  });
  // role=status + aria-live=polite: screen readers announce the parse result after typing pauses, without moving
  // focus. aria-describedby on the input ties this line to the field.
  els.read = h('div', { class: 'uc-read', id: 'uc-read', role: 'status', 'aria-live': 'polite' });
  els.unitSel = unitSelect(S.unit, (v) => { S.unit = v; changed(); }, { aria: t('uc.in.unit') });
  // Real <button>s (keyboard activation for free); role=list/listitem gives the chip set an item count for AT.
  const examples = h('div', { class: 'uc-chips', role: 'list', 'aria-label': t('uc.in.examples') }, EXAMPLES.map((x) => h('button', {
    type: 'button', class: 'uc-chip', role: 'listitem', onclick: () => { setText(x); els.input.focus(); },
  }, x)));
  const sys = seg([{ v: 'metric', l: 'uc.sys.metric' }, { v: 'us', l: 'uc.sys.us' }, { v: 'imperial', l: 'uc.sys.imperial' }], S.system, (v) => { S.system = v; changed(); }, 'uc.sys');
  const prec = seg(PRECS.map((p) => ({ v: p, l: p === 'auto' ? 'uc.prec.auto' : '=' + p })), S.prec, (v) => { S.prec = v === 'auto' ? 'auto' : +v; changed(); }, 'uc.prec');

  const inputCard = card('uc.in.title',
    h('div', { class: 'ed-fields' },
      h('div', { class: 'ed-field' }, h('label', { class: 'ed-label', for: 'uc-in' }, t('uc.in.label')), els.input, els.read),
      examples,
      field('uc.in.unit', els.unitSel, 'uc.in.unitHint'),
      group('uc.sys', sys),
      group('uc.prec', prec, t('uc.prec.hint')),
      field('uc.only', toggle(S.onlySystem, (v) => { S.onlySystem = v; changed(); }))));
  els.pins = h('div', { class: 'uc-pins' });
  els.hist = h('div', { class: 'uc-hist' });
  const pinCard = card('uc.pins', els.pins);
  const histCard = card('uc.hist', els.hist);

  // aria-live on the main result: the converted value is announced when it changes. The list below is deliberately
  // NOT live: announcing dozens of rows per keystroke would drown the user.
  els.main = h('div', { class: 'uc-main', 'aria-live': 'polite' });
  els.list = h('ul', { class: 'uc-list', 'aria-label': t('uc.all') });
  els.listHead = h('h2', { class: 'ap-card-h' });
  els.near = h('div', { class: 'uc-near' });
  els.nearHead = h('h2', { class: 'ap-card-h' });
  const left = h('div', { class: 'uc-col uc-left' }, inputCard, pinCard, histCard);
  const right = h('div', { class: 'uc-col uc-right' },
    h('section', { class: 'ap-card uc-main-card' }, els.main),
    h('section', { class: 'ap-card' }, els.listHead, els.list),
    h('section', { class: 'ap-card' }, els.nearHead, els.near));
  main.append(h('div', { class: 'uc-work' }, left, right));

  main.append(h('h2', { class: 'uc-extras-h' }, iconEl('sparkle'), h('span', {}, t('uc.extras'))),
    h('div', { class: 'uc-extras' }, priceCard(), roomsCard(), scalesCard()));
  update();
  paintHistory();
}

let gid = 0;
// Labelled group for non-input controls: the label names the group through aria-labelledby.
// A segmented control is not a labelable form element, so <label for> cannot name it; aria-labelledby is the
// equivalent. gid is a module counter: ids stay unique across re-renders.
function group(label, control, hint) {
  const id = 'uc-g' + (++gid);
  control.setAttribute('aria-labelledby', id);
  return h('div', { class: 'ed-field' }, h('span', { class: 'ed-label', id }, t(label)), control, hint ? h('div', { class: 'ed-hint' }, hint) : null);
}

// Programmatic text change: assigning .value fires no input event, so changed() is called explicitly.
function setText(v) {
  S.text = v;
  els.input.value = v;
  changed();
}

// ---------------------------------------------------------------------------------------------------------------
// Update: input -> reading, main result, every unit, nearby table

const changed = () => { save(); update(); };
// 1600 ms idle: long enough that half-typed values ("4", "42", "42,") are not recorded, short enough that a pause
// after a finished value is.
const historySoon = debounce(() => { if (parsed()) historyAdd(S.text); }, 1600);

function update() {
  const q = parsed();
  // The unit picker follows a typed label, so a later bare number keeps meaning the same unit.
  // Guarded by q.unit !== S.unit to avoid a save() on every keystroke when nothing changed.
  if (q && q.unit !== S.unit) { S.unit = q.unit; els.unitSel.value = q.unit; save(); }
  paintRead(q);
  paintMain(q);
  paintList(q);
  paintNear(q);
  paintPins(q);
}

// className reset first: state classes (.uc-bad) from the previous paint must not stick.
// Compound input ("1 ч 30 мин") is echoed as its parts and their sum, so the user sees how it was read.
function paintRead(q) {
  const box = els.read;
  box.textContent = '';
  box.className = 'uc-read';
  if (!S.text.trim()) { box.textContent = t('uc.read.empty'); return; }
  if (!q) { box.classList.add('uc-bad'); box.append(iconEl('warn'), h('span', {}, t('uc.read.bad'))); return; }
  const parts = q.parts.length > 1 ? q.parts.map((p) => qty(p.value, p.unit, 'auto')).join(' + ') + ' = ' : '';
  const bare = !q.parts[0].label;
  box.append(iconEl('check'), h('span', {}, t('uc.read.ok', { q: parts + qty(q.value, q.unit, 'auto'), kind: kindName(q.kind) }) + (bare ? ' ' + t('uc.read.bare') : '')));
}

// <output for="uc-in">: the semantic result element tied to the input; id uc-result is the e2e test hook.
// Both formula directions are shown because users often need the inverse for mental arithmetic.
function paintMain(q) {
  const box = els.main;
  box.textContent = '';
  if (!q) { box.append(h('div', { class: 'ap-empty' }, iconEl('ruler'), h('p', {}, t('uc.main.none')))); return; }
  const from = q.unit, to = targetFor(from);
  const r = convert(q.value, from, to);
  const text = qty(r, to, S.prec);
  const comp = compound(r, to);
  const fromComp = compound(q.value, from);
  const pinned = S.pins.some((p) => p[0] === from && p[1] === to);
  const kind = q.kind;
  box.append(
    h('div', { class: 'uc-kind' }, h('span', { class: 'uc-kind-tag' }, kindName(kind)), unitOf(from).approx || unitOf(to).approx ? h('span', { class: 'uc-approx' }, t('uc.main.approx')) : null),
    h('div', { class: 'uc-eq' },
      h('div', { class: 'uc-eq-from' }, qty(q.value, from, S.prec), fromComp ? h('span', { class: 'uc-sub' }, fromComp) : null),
      h('div', { class: 'uc-eq-sign', 'aria-hidden': 'true' }, '='),
      h('div', { class: 'uc-eq-to', id: 'uc-result' }, h('output', { for: 'uc-in' }, text), comp ? h('span', { class: 'uc-sub' }, comp) : null)),
    h('div', { class: 'uc-formula' }, h('code', {}, formula(from, to)), h('code', {}, formula(to, from))),
  );
  if (kind === 'length') {
    const i = scaleStepIndex(DISTANCE_SCALE, q.value, { unit: from });
    if (i >= 0) box.append(h('div', { class: 'uc-word' }, iconEl('words'), h('span', {}, t('uc.main.walk', { w: distWord(i) }))));
  }
  // aria-pressed exposes the pin as a toggle; the label text also flips, so sighted and AT users get the same state.
  const pin = button(pinned ? 'uc.main.unpin' : 'uc.main.pin', 'star', () => togglePin(from, to));
  pin.classList.toggle('uc-pinned', pinned);
  pin.setAttribute('aria-pressed', String(pinned));
  box.append(h('div', { class: 'ap-actions' },
    button('uc.main.copy', 'copy', () => copyText(text), 'primary'),
    button('uc.main.copyAll', 'copy', () => copyText(`${qty(q.value, from, S.prec)} = ${text}`)),
    button('uc.main.swap', 'swap', () => swap(q, to, r)),
    pin));
}

// Two controls per row (pick = make main target, copy = copy this value): sibling buttons rather than a clickable
// row with a nested copy icon, because interactive content nested in a <button> is invalid HTML.
// The from-unit row stays visible even with onlySystem, so the user always sees what was typed.
function paintList(q) {
  const box = els.list;
  box.textContent = '';
  els.listHead.textContent = q ? t('uc.allOf', { kind: kindName(q.kind) }) : t('uc.all');
  if (!q) return;
  const from = q.unit, to = targetFor(from);
  for (const c of unitsOfKind(q.kind)) {
    if (S.onlySystem && !inSystem(c, S.system) && c !== from) continue;
    const r = convert(q.value, from, c);
    const text = fmt(r, S.prec);
    const cls = 'uc-row' + (atHome(c) ? ' uc-home' : '') + (c === to ? ' uc-target' : '') + (c === from ? ' uc-from' : '');
    const copy = h('button', { type: 'button', class: 'ed-iconbtn uc-copy', title: t('uc.copyUnit', { u: lab(c) }), 'aria-label': t('uc.copyUnit', { u: lab(c) }), html: icon('copy'), onclick: () => copyText(`${text} ${lab(c)}`) });
    const pick = h('button', {
      type: 'button', class: 'uc-pick', 'aria-pressed': String(c === to), title: formula(from, c),
      onclick: () => { if (c === from) return; S.targets[q.kind] = c; changed(); },
    }, h('span', { class: 'uc-val' }, text), h('span', { class: 'uc-sym' }, lab(c)), h('span', { class: 'uc-uname' }, uname(c) + (UNITS[c].approx ? ' ≈' : '')));
    box.append(h('li', { class: cls, dataset: { u: c } }, pick, copy));
  }
}

// Nearby-values table: a "nice" step (1/2/5 x 10^n, common.js niceStep) about a quarter of the value, 11 rows
// centred on the value rounded to that step. The exact typed value is merged in if the grid missed it, and marked.
// 1e-12 absolute tolerance: values come from the same arithmetic, so only float noise needs absorbing.
function paintNear(q) {
  const box = els.near;
  box.textContent = '';
  if (!q) { els.nearHead.textContent = t('uc.near'); return; }
  const from = q.unit, to = targetFor(from);
  els.nearHead.textContent = t('uc.nearOf', { a: lab(from), b: lab(to) });
  const v = q.value;
  const step = niceStep(Math.abs(v) / 4 || 1);
  const center = Math.round(v / step) * step;
  // Negative lengths, masses or areas make no sense (the window then starts at one step); temperatures go below zero.
  const low = q.kind !== 'temperature' && center - 5 * step < step ? step : center - 5 * step;
  let values = series(low, low + 10 * step, step, 11);
  if (q.kind !== 'temperature') values = values.filter((x) => x > 0);
  if (!values.some((x) => Math.abs(x - v) < 1e-12)) values = [...values, v].sort((a, b) => a - b);
  const p = S.prec === 'auto' ? 2 : S.prec;
  // Compound column only for targets people read in compound form (5 ft 11 in, 1 h 30 min, 11 st 4 lb).
  box.append(tableEl(from, to, values, { digits: p, mark: v, useCompound: !!COMPOUND[to] && ['ft', 'h', 'lb', 'st'].includes(to) }));
}

// Swap = exchange source and target. The old source becomes the remembered target of the kind, so swapping twice
// returns to the start. plainNumber() writes the value without grouping so the parser reads it back exactly.
function swap(q, to, r) {
  const kind = q.kind;
  S.targets[kind] = q.unit;
  S.unit = to;
  els.unitSel.value = to;
  setText(`${plainNumber(r)} ${typedLabel(to)}`);
  historyAdd(S.text);
}

// --- favourite pairs and history -----------------------------------------------------------------------------

// New pins go to the front (most recently added = most likely needed); capped at 16 like in loadState.
function togglePin(from, to) {
  const i = S.pins.findIndex((p) => p[0] === from && p[1] === to);
  if (i >= 0) S.pins.splice(i, 1); else { S.pins.unshift([from, to]); S.pins = S.pins.slice(0, 16); toast(t('uc.pinned', { a: lab(from), b: lab(to) }), 'ok'); }
  changed();
}

// Opens a pair: the current value carries over when its kind matches, else 1 of the source unit.
function openPair(from, to) {
  const q = parsed();
  const kind = UNITS[from].kind;
  S.targets[kind] = to;
  S.unit = from;
  els.unitSel.value = from;
  const v = q && q.kind === kind ? convert(q.value, q.unit, from) : 1;
  setText(`${plainNumber(v)} ${typedLabel(from)}`);
}

// Index i captured in the remove handler is safe: any change re-runs paintPins, rebuilding all handlers.
function paintPins(q) {
  const box = els.pins;
  box.textContent = '';
  if (!S.pins.length) { box.append(h('div', { class: 'ed-hint' }, t('uc.pins.empty'))); return; }
  const cur = q ? [q.unit, targetFor(q.unit)] : [];
  const list = h('ul', { class: 'uc-pinlist' });
  S.pins.forEach(([a, b], i) => {
    const on = cur[0] === a && cur[1] === b;
    list.append(h('li', { class: 'uc-pin' + (on ? ' uc-on' : '') },
      h('button', { type: 'button', class: 'uc-pin-go', 'aria-current': on ? 'true' : null, onclick: () => openPair(a, b), title: formula(a, b) }, `${lab(a)} → ${lab(b)}`),
      h('button', { type: 'button', class: 'uc-pin-x', 'aria-label': t('uc.pins.remove', { a: lab(a), b: lab(b) }), title: t('uc.pins.remove', { a: lab(a), b: lab(b) }), html: icon('close'), onclick: () => { S.pins.splice(i, 1); changed(); } })));
  });
  box.append(list);
}

function paintHistory() {
  const box = els.hist;
  if (!box) return;
  box.textContent = '';
  const list = historyList();
  if (!list.length) { box.append(h('div', { class: 'ed-hint' }, t('uc.hist.empty'))); return; }
  box.append(h('ul', { class: 'uc-histlist' }, list.map((e) => h('li', {}, h('button', { type: 'button', class: 'uc-hist-item', onclick: () => { setText(e.text); els.input.focus(); } }, e.text)))));
  const clear = button('uc.hist.clear', 'trash', () => { lsSet(HKEY, []); paintHistory(); toast(t('uc.hist.cleared'), 'ok'); });
  clear.classList.add('ed-sm');
  box.append(h('div', { class: 'ap-actions' }, clear));
}

// ---------------------------------------------------------------------------------------------------------------
// Extras: price per unit

// Per-unit prices of one offer: [{ key, label, value }] (the first is the comparison base), or null.
// Per-unit prices in shopper conventions: per kg and per 100 g (EU shelf-label style), per l and per 100 ml;
// US/imperial systems add lb/oz or gallons. lines[0] is the comparison base, so offers of one kind compare on the
// same unit regardless of the unit each pack size was written in.
function perUnit(price, size) {
  const p = parseNumber(price);
  if (!Number.isFinite(p) || p < 0) return null;
  // Pieces have no unit in the registry (they must never convert): "6 pcs" is read as the bare number 6.
  const q = parseQuantity(String(size || '').replace(/\s*(?:pcs|pc|pieces?|шт|штук[аи]?|штуки|ცალი|stk|stück|pièces?|uds?|unidades?)\.?\s*$/i, ''), { unit: '' });
  if (!q || !Number.isFinite(q.value) || q.value <= 0) return null;
  if (!q.kind) return { kind: 'pcs', base: p / q.value, lines: [[t('uc.price.pcs'), p / q.value]] };
  // per(unit, mult) = price / size-in-that-unit * mult. q.value > 0 is checked above, so the divisor is non-zero for
  // the linear kinds that occur as pack sizes.
  const us = S.system !== 'metric';
  const per = (unit, mult = 1) => p / convert(q.value, q.unit, unit) * mult;
  const k = q.kind;
  const L = (code, n) => (n ? `${n} ${lab(code)}` : lab(code));
  let lines;
  if (k === 'mass') lines = [[L('kg'), per('kg')], [L('g', 100), per('g', 100)], ...(us ? [[L('lb'), per('lb')], [L('oz'), per('oz')]] : [])];
  else if (k === 'volume') lines = [[L('l'), per('l')], [L('ml', 100), per('ml', 100)], ...(us ? [[L(S.system === 'us' ? 'gal' : 'galimp'), per(S.system === 'us' ? 'gal' : 'galimp')]] : [])];
  else if (k === 'area') lines = [[L('m2'), per('m2')], ...(us ? [[L('sqft'), per('sqft')]] : [])];
  else if (k === 'length') lines = [[L('m'), per('m')], ...(us ? [[L('ft'), per('ft')]] : [])];
  else { const b = baseUnit(k); lines = [[L(b), per(b)]]; }
  return { kind: k, base: lines[0][1], lines };
}

// Output cells of the current rows, by index: paintPrices() writes into them without rebuilding the inputs, so
// typing in a price field keeps focus.
let priceEls = [];
function priceCard() {
  const P = S.price;
  const rowsBox = h('div', { class: 'uc-prows' });
  const paintRows = () => {
    rowsBox.textContent = '';
    priceEls = [];
    P.rows.forEach((r, i) => {
      const out = h('div', { class: 'uc-pout' });
      const del = h('button', { type: 'button', class: 'ed-iconbtn', title: t('uc.price.remove'), 'aria-label': t('uc.price.remove'), html: icon('trash'), onclick: () => { P.rows.splice(i, 1); save(); paintRows(); } });
      const inp = (key, ph, extra = {}) => textInput(r[key], (v) => { r[key] = v; save(); paintPrices(); }, { placeholder: ph, 'aria-label': t('uc.price.' + key) + ' ' + (i + 1), ...extra });
      rowsBox.append(h('div', { class: 'uc-prow' },
        inp('name', t('uc.price.namePh', { n: i + 1 })), inp('price', '0,00', { inputmode: 'decimal', class: 'ed-input uc-num' }), inp('size', '500 g'), del, out));
      priceEls.push(out);
    });
    paintPrices();
  };
  // at(-2) relies on the input order name, price, size: the new row's price field gets focus so the user can type
  // the number straight away.
  const add = button('uc.price.add', 'plus', () => { if (P.rows.length < 12) { P.rows.push({ name: '', price: '', size: '' }); save(); paintRows(); $$('.uc-prow input', rowsBox).at(-2)?.focus(); } });
  add.classList.add('ed-sm');
  const cur = textInput(P.cur, (v) => { P.cur = v.slice(0, 6); save(); paintPrices(); }, { class: 'ed-input uc-cur', placeholder: '€ $ ₾ ₽', maxlength: 6 });
  paintRows();
  // Visual column header only (aria-hidden): each input already carries its own aria-label with the row number.
  const head = h('div', { class: 'uc-phead', 'aria-hidden': 'true' }, h('span', {}, t('uc.price.name')), h('span', {}, t('uc.price.price')), h('span', {}, t('uc.price.size')), h('span', {}));
  const c = card('uc.price.title', h('p', { class: 'ed-hint uc-lead' }, t('uc.price.lead')), head, rowsBox,
    h('div', { class: 'ap-row uc-pfoot' }, add, h('span', { class: 'ed-spacer' }), field('uc.price.cur', cur)));
  c.classList.add('uc-price');
  return c;
}

function paintPrices() {
  // Two passes: find the cheapest base per kind, then count offers per kind. Badges appear only when at least two
  // offers of the same kind exist; comparing kg against litres is meaningless and never attempted.
  const P = S.price;
  const res = P.rows.map((r) => perUnit(r.price, r.size));
  // The best offer per kind (two or more offers of a kind compare).
  const best = {};
  res.forEach((x) => { if (x && (best[x.kind] == null || x.base < best[x.kind].base)) best[x.kind] = { base: x.base, n: 0 }; });
  res.forEach((x) => { if (x) best[x.kind].n++; });
  const money = (v) => { const n = formatNumber(v, { lang: uiLang(), digits: 2, minDigits: 2 }); return P.cur ? `${n} ${P.cur}` : n; };
  res.forEach((x, i) => {
    const out = priceEls[i];
    if (!out) return;
    out.textContent = '';
    out.className = 'uc-pout';
    const r = P.rows[i];
    if (!x) { if (r.price || r.size) { out.classList.add('uc-bad'); out.textContent = t('uc.price.bad'); } return; }
    out.append(h('span', {}, x.lines.map(([u, v]) => `${money(v)} / ${u}`).join(' · ')));
    const b = best[x.kind];
    if (b.n > 1) {
      if (Math.abs(x.base - b.base) < 1e-12) { out.classList.add('uc-best'); out.append(h('span', { class: 'uc-badge uc-badge-ok' }, t('uc.price.best'))); }
      else out.append(h('span', { class: 'uc-badge' }, t('uc.price.more', { p: fmt((x.base / b.base - 1) * 100, 0) })));
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Extras: flat area from rooms

// m² of a room's area text: "12,5", "12 m²", "130 sq ft", "3,2 × 3,6", "12 ft x 10 ft"; NaN when unreadable.
// Splits on x, ×, Cyrillic х and * (people type whichever is at hand). Exactly two parts = a rectangle in lengths;
// anything else is read as an area quantity, m² by default.
function areaOf(text) {
  const s = String(text || '').trim();
  if (!s) return NaN;
  const parts = s.split(/\s*[x×х*]\s*/i);
  if (parts.length === 2) {
    const a = parseQuantity(parts[0], { unit: 'm', kind: 'length' });
    const b = a && parseQuantity(parts[1], { unit: a.unit, kind: 'length' });
    // "3,2 × 3,6 m": the unit written after the second number applies to the first one too.
    if (a && b && !a.parts[0].label && b.parts[0].label) return convert(a.value, b.unit, 'm') * convert(b.value, b.unit, 'm');
    return a && b ? convert(a.value, a.unit, 'm') * convert(b.value, b.unit, 'm') : NaN;
  }
  const q = parseQuantity(s, { unit: 'm2', kind: 'area' });
  return q ? q.base : NaN;
}

const roomName = (type) => t('uc.room.' + type);
let roomEls = { outs: [], sum: null };

function roomsCard() {
  const rowsBox = h('div', { class: 'uc-rrows' });
  roomEls.sum = h('div', { class: 'uc-rsum' });
  const paintRows = () => {
    rowsBox.textContent = '';
    roomEls.outs = [];
    S.rooms.forEach((r, i) => {
      const sel = h('select', { class: 'ed-input ed-select', 'aria-label': t('uc.rooms.type') + ' ' + (i + 1) }, ROOM_CHOICES.map((k) => h('option', { value: k, selected: k === r.type }, roomName(k))));
      sel.addEventListener('change', () => { r.type = sel.value; save(); paintRooms(); });
      const area = textInput(r.area, (v) => { r.area = v; save(); paintRooms(); }, { placeholder: '12,5 · 3,2 × 3,6 · 130 sq ft', 'aria-label': t('uc.rooms.area') + ' ' + (i + 1) });
      const out = h('span', { class: 'uc-rout' });
      const del = h('button', { type: 'button', class: 'ed-iconbtn', title: t('uc.rooms.remove'), 'aria-label': t('uc.rooms.remove'), html: icon('trash'), onclick: () => { S.rooms.splice(i, 1); save(); paintRows(); } });
      rowsBox.append(h('div', { class: 'uc-rrow' }, sel, area, out, del));
      roomEls.outs.push(out);
    });
    paintRooms();
  };
  const add = button('uc.rooms.add', 'plus', () => { if (S.rooms.length < 20) { S.rooms.push({ type: 'room', area: '' }); save(); paintRows(); $$('.uc-rrow input', rowsBox).at(-1)?.focus(); } });
  add.classList.add('ed-sm');
  paintRows();
  const c = card('uc.rooms.title', h('p', { class: 'ed-hint uc-lead' }, t('uc.rooms.lead')), rowsBox, h('div', { class: 'ap-actions' }, add), roomEls.sum);
  c.classList.add('uc-rooms');
  return c;
}

function paintRooms() {
  // Reduced area follows the Russian housing convention: balcony counted at 0.3, loggia at 0.5, everything else at 1.
  // "Inside" = rooms with factor 1. Unreadable areas count as 0 so a typo in one row does not blank the totals;
  // the row itself shows '?' in danger colour.
  const areas = S.rooms.map((r) => areaOf(r.area));
  areas.forEach((a, i) => {
    const out = roomEls.outs[i];
    if (!out) return;
    out.className = 'uc-rout' + (S.rooms[i].area && !Number.isFinite(a) ? ' uc-bad' : '');
    out.textContent = Number.isFinite(a) ? qty(a, 'm2', 2) : S.rooms[i].area ? '?' : '';
  });
  // kitchen-living is a UI-only type: split into its two functional types for the estate/rooms.js layout logic.
  const rooms = S.rooms.map((r, i) => ({ key: 'r' + (i + 1), types: r.type === 'kitchen-living' ? ['kitchen', 'living'] : [r.type], area: Number.isFinite(areas[i]) ? areas[i] : 0 }));
  let total = 0, inside = 0, reduced = 0;
  rooms.forEach((r) => {
    total += r.area;
    const out = r.types.includes('balcony') ? 0.3 : r.types.includes('loggia') ? 0.5 : 1;
    if (out === 1) inside += r.area;
    reduced += r.area * out;
  });
  const sum = roomsSummary(rooms), lay = roomsLayout(rooms);
  const box = roomEls.sum;
  box.textContent = '';
  const big = (v) => h('span', { class: 'uc-strong' }, qty(v, 'm2', 2), h('span', { class: 'uc-sub' }, qty(convert(v, 'm2', 'sqft'), 'sqft', 0)));
  const dl = h('dl', { class: 'ap-kv uc-kv' });
  const row = (k, v) => dl.append(h('dt', {}, t(k)), h('dd', {}, v));
  row('uc.rooms.total', big(total));
  row('uc.rooms.inside', big(inside));
  row('uc.rooms.reduced', big(reduced));
  row('uc.rooms.count', t('uc.rooms.counts', { r: sum.rooms, b: sum.bedrooms, w: sum.bath }));
  if (lay.layout) row('uc.rooms.layout', t('uc.layout.' + lay.layout));
  if (lay.layout === 'apartments') {
    const word = euroWord(lay.size);
    row('uc.rooms.euro', h('span', { class: 'uc-strong' }, word));
  }
  box.append(dl);
}

// ---------------------------------------------------------------------------------------------------------------
// Extras: number -> word scales

// Normalised once at import: the scale data is static, normalising per render would be wasted work.
const EURO = normalizeScale(EURO_SCALE);
// Distance words: the library's word in its languages (en / ru / ka), the app's strings in the others.
const distWord = (i) => DISTANCE_SCALE.steps[i].name[uiLang()] || t('uc.dist.' + i);
// The Euro words are Russian real-estate vocabulary with English n+1 counterparts.
function euroWord(n) {
  const i = euroStepIndex(EURO, n);
  if (i < 0) return '';
  const st = EURO.steps[i];
  const word = (l) => scalePick(st.name, l).replace(/\{n\}/g, String(n));
  return uiLang() === 'ru' || uiLang() === 'uk' ? `${word('ru')} (${word('en')})` : `${word('en')} (${word('ru')})`;
}

function scalesCard() {
  // The ladder renders every step with its range; the step the typed distance falls into is highlighted and gets
  // aria-current, so AT users learn which bucket applies without relying on colour.
  const distOut = h('div', { class: 'uc-ladder', role: 'list' });
  const distRead = h('div', { class: 'uc-read' });
  const paintDist = () => {
    distOut.textContent = '';
    distRead.textContent = '';
    distRead.className = 'uc-read';
    const q = parseQuantity(S.dist, { unit: 'm', kind: 'length' });
    const i = q ? scaleStepIndex(DISTANCE_SCALE, q.value, { unit: q.unit }) : -1;
    if (q) {
      // The cross-system reading shows the value in the other system (metric / US) via humanize(), which picks a
      // sensible unit (650 m to 0.4 mi) rather than a fixed one.
      const other = S.system === 'metric' ? humanize(q.value, q.unit, { system: 'us', lang: unitLang() }) : humanize(q.value, q.unit, { system: 'metric', lang: unitLang() });
      distRead.append(h('b', { class: 'uc-strong' }, i >= 0 ? distWord(i) : '—'), h('span', { class: 'uc-sub' }, other ? `${qty(q.value, q.unit, 'auto')} = ${qty(other.value, other.unit, 'auto')}` : ''));
    } else if (S.dist.trim()) { distRead.classList.add('uc-bad'); distRead.textContent = t('uc.read.bad'); }
    let prev = 0;
    DISTANCE_SCALE.steps.forEach((st, k) => {
      const range = st.at == null ? `> ${humanize(prev, 'm', { lang: unitLang() }).text}` : `≤ ${humanize(st.at, 'm', { lang: unitLang() }).text}`;
      if (st.at != null) prev = st.at;
      distOut.append(h('div', { class: 'uc-step' + (k === i ? ' uc-on' : ''), role: 'listitem', 'aria-current': k === i ? 'true' : null }, h('span', { class: 'uc-step-w' }, distWord(k)), h('span', { class: 'uc-step-r' }, range)));
    });
  };
  const dist = textInput(S.dist, (v) => { S.dist = v; save(); paintDist(); }, { placeholder: '650 m · 0.4 mi · 1,2 км' });
  paintDist();

  const euroOut = h('table', { class: 'uc-table uc-euro' });
  const paintEuro = () => {
    euroOut.textContent = '';
    euroOut.append(h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'n'), h('th', { scope: 'col' }, t('uc.euro.bedrooms')), h('th', { scope: 'col' }, 'en'), h('th', { scope: 'col' }, 'ru'))));
    const body = h('tbody', {});
    // 1..6 always plus the chosen size if larger; the Set removes the duplicate when S.euro is 7 or less.
    const sizes = [1, 2, 3, 4, 5, 6, Math.max(7, S.euro)];
    for (const n of [...new Set(sizes)]) {
      const i = euroStepIndex(EURO, n);
      const st = EURO.steps[i];
      body.append(h('tr', { class: n === S.euro ? 'uc-cur' : null }, h('td', {}, String(n)), h('td', {}, String(n - 1)),
        h('td', {}, scalePick(st.name, 'en').replace(/\{n\}/g, n)), h('td', {}, scalePick(st.name, 'ru').replace(/\{n\}/g, n))));
    }
    euroOut.append(body);
  };
  // type=number with min/max for the stepper and mobile keypad; the handler still range-checks because typed text
  // bypasses min/max (they constrain the stepper and form validation, not the value property).
  const euroIn = h('input', { type: 'number', class: 'ed-input uc-num', min: 1, max: 12, step: 1, value: S.euro });
  euroIn.addEventListener('input', () => { const n = Math.round(+euroIn.value); if (n >= 1 && n <= 12) { S.euro = n; save(); paintEuro(); } });
  paintEuro();
  const c = card('uc.scales.title',
    h('p', { class: 'ed-hint uc-lead' }, t('uc.scales.lead')),
    field('uc.scales.dist', dist), distRead, distOut,
    field('uc.euro.size', euroIn, 'uc.euro.hint'), h('div', { class: 'uc-tablewrap' }, euroOut));
  c.classList.add('uc-scales');
  return c;
}

// ---------------------------------------------------------------------------------------------------------------

// The shell calls the language callback after switching strings: a full render() rebuilds every label.
startShell('convert', () => render());
render();
