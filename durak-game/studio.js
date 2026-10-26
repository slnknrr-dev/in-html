// durak-game/studio.js - the constructor ("creator-to-export"): edit a ruleset (metadata, deck: colours, suits, ranks,
// generated sets with copies, custom cards with designation, name, art and their own rules; the game rules; rank
// groups, beat rules and card rules), check it (validation, what beats what, a quick bot tournament), give it a look,
// build bots, test-play it, and export it: a ruleset file, a share code or link, and the standalone page with servers
// written into it.
//
//   renderStudio(main, { onBack, onTestPlay(raw), pageHTML, openSettings }) -> element
//   SHARE_PREFIX, shareCode(raw), readShared(text) -> raw | null
//
// Design: the editor works on a plain mutable `draft` (an editable, fully defaulted copy of a raw ruleset). Every
// control writes into the draft and calls touch(), which persists it and re-validates; validation and normalization
// live in durak/ruleset.js, so the editor never decides what is legal - it shows validateRuleset's errors/warnings.
// Saving requires a valid ruleset and an id that does not collide with a built-in preset (suffix '-mine').
// Formats: share code 'DKR1:' + packed ruleset (versioned prefix, compact, pictures dropped); JSON file (full, with
// pictures); link '#rs=<code>' handled by main.js openFromHash with user confirmation.
// Cost accepted: touch() saves the whole draft into the settings key on every keystroke; with embedded card pictures
// this is a large synchronous localStorage write per input event.

import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { iconEl } from '../ui/icons.js';
import { openDialog, toast, confirmDialog, promptDialog } from '../ui/overlays.js';
import { copyText, download, seg } from '../ui/app.js';
import { pickFiles } from '../ui/files.js';
import { normalizeRuleset, validateRuleset, playerRange, compile, cardText, STD_COLORS, STD_SUITS, STD_RANKS, DEFAULT_RULES } from '../durak/ruleset.js';
import { PRESETS, presetById, JOKER_RULES } from '../durak/presets.js';
import { packRuleset, unpackRuleset, rulesetSource } from '../durak/notation.js';
import { newGame, apply, turn, viewOf } from '../durak/engine.js';
import { decide, profileOf } from '../durak/bots.js';
import { seededRandom } from '../prng/prng.js';
import { faceSVG, FACES, BACKS, backSVG } from './cardart.js';
import { TABLES, fitImage, backColor, skinOf } from './skins.js';
import { store, save, putRuleset, removeRuleset } from './store.js';
import { rulesBody } from './names.js';
import { builder } from './setup.js';
import { artifactMode } from './online.js';

export const SHARE_PREFIX = 'DKR1:';
export const shareCode = (raw) => SHARE_PREFIX + packRuleset(normalizeRuleset(raw));
export function readShared(text) {
  const s = String(text || '').trim();
  try {
    if (s.startsWith(SHARE_PREFIX)) return unpackRuleset(s.slice(SHARE_PREFIX.length));
    if (s.startsWith('{')) return JSON.parse(s);
  } catch { return null; }
  return null;
}

// JSON round-trip clone: rulesets are pure JSON data (no Dates/Maps), and it doubles as a check that the draft is
// serialisable exactly as it will be stored and shared.
const clone = (o) => JSON.parse(JSON.stringify(o));
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'my-durak';

// The ruleset as JSON with its pictures (files and rooms; share codes and DGN drop the pictures: rulesetSource).
export function fullSource(n) {
  return { id: n.id, name: n.name, description: n.description, author: n.author, tags: n.tags, exclusive: n.exclusive, deck: n.deck, rules: n.rules, skin: n.skin || undefined };
}

// A full editable copy of a ruleset (defaults written out, so every field has a control).
function editable(raw) {
  const n = normalizeRuleset(raw);
  const src = fullSource(n);
  return {
    id: src.id, name: typeof src.name === 'string' ? src.name : (src.name && (src.name.en || Object.values(src.name)[0])) || '',
    description: typeof src.description === 'string' ? src.description : (src.description && (src.description.en || Object.values(src.description)[0])) || '',
    author: src.author || '', tags: (src.tags || []).filter((x) => x !== 'classic'), exclusive: false,
    deck: clone(src.deck), rules: { ...clone(DEFAULT_RULES), ...clone(src.rules) }, skin: raw.skin || null,
  };
}

// A card matcher (used by beat rules and card rules) is an object like { suit: 'H' }, { color: '=' } (same colour as
// the other card), { trump: true }. matchKind maps the common single-key shapes to a friendly editor; anything else
// is edited as raw JSON, so the UI never limits what the engine can express.
const MATCH_KINDS = ['any', 'ownColor', 'ownSuit', 'color', 'suit', 'rank', 'card', 'trump', 'plain', 'none', 'json'];
function matchKind(m) {
  if (!m || typeof m !== 'object') return 'none';
  const k = Object.keys(m);
  if (!k.length) return 'any';
  if (m.none) return 'none';
  if (k.length === 1) {
    if (m.color === '=') return 'ownColor';
    if (m.suit === '=') return 'ownSuit';
    if (typeof m.color === 'string') return 'color';
    if (typeof m.suit === 'string') return 'suit';
    if (typeof m.rank === 'string') return 'rank';
    if (typeof m.id === 'string') return 'card';
    if (m.trump === true) return 'trump';
    if (m.trump === false) return 'plain';
  }
  return 'json';
}

export function renderStudio(main, { onBack, onTestPlay, pageHTML, openSettings }) {
  const root = h('section', { class: 'dk-studio dk-screen' });
  main.append(root);
  let draft = store.settings.studioDraft ? clone(store.settings.studioDraft) : editable(presetById('jokers-54'));
  let tab = 'overview';
  let cardSel = 0;
  let dirty = false;
  const touch = () => { dirty = true; store.settings.studioDraft = draft; save('settings'); refreshSummary(); };
  const summary = h('div', { class: 'dk-st-summary' });
  const body = h('div', { class: 'dk-st-body' });

  function refreshSummary() {
    const v = validateRuleset(draft);
    summary.textContent = '';
    const n = v.ruleset;
    summary.append(...[
      h('span', { class: 'dk-st-pill' }, t('st2.cards', { n: n ? n.cardCount : 0 })),
      h('span', { class: 'dk-st-pill' }, v.players ? t('st2.players', { min: v.players.min, max: v.players.max }) : '—'),
      h('span', { class: 'dk-st-pill ' + (v.ok ? 'dk-okp' : 'dk-errp') }, v.ok ? t('st2.valid') : t('st2.errors', { n: v.errors.length })),
      v.warnings.length ? h('span', { class: 'dk-st-pill dk-warnp' }, t('st2.warnings', { n: v.warnings.length })) : null,
      n ? h('span', { class: 'dk-st-pill dk-hashp' }, '#' + n.hash) : null].filter(Boolean));
  }

  const tabs = ['overview', 'deck', 'cards', 'rules', 'check', 'look', 'bots', 'export'];
  function render() {
    root.textContent = '';
    root.append(
      h('div', { class: 'dk-screen-h' },
        h('button', { type: 'button', class: 'ed-iconbtn', 'aria-label': t('nav.back'), onclick: onBack }, iconEl('parent')),
        h('h2', {}, t('st2.title')), h('span', { class: 'ed-spacer' }),
        h('button', { type: 'button', class: 'ed-btn', onclick: saveDraft }, iconEl('save'), t('st2.save')),
        h('button', { type: 'button', class: 'ed-btn ed-primary', onclick: testPlay }, iconEl('send'), t('st2.test'))),
      summary,
      h('nav', { class: 'dk-st-tabs', role: 'tablist' }, tabs.map((x) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === x), class: 'dk-st-tab' + (tab === x ? ' dk-on' : ''), onclick: () => { tab = x; render(); } }, t('st2.tab.' + x)))),
      body);
    body.textContent = '';
    ({ overview, deck, cards, rules, check: checkTab, look, bots, export: exporter })[tab]();
    refreshSummary();
  }

  function saveDraft() {
    const v = validateRuleset(draft);
    if (!v.ok) { toast(t('st2.fixErrors'), 'warn'); tab = 'check'; render(); return false; }
    draft.id = slug(draft.id || draft.name);
    if (PRESETS.some((p) => p.id === draft.id)) draft.id = draft.id + '-mine';
    putRuleset(clone(draft));
    dirty = false;
    toast(t('st2.saved', { name: draft.name || draft.id }), 'ok');
    return true;
  }
  function testPlay() {
    const v = validateRuleset(draft);
    if (!v.ok) { toast(t('st2.fixErrors'), 'warn'); tab = 'check'; render(); return; }
    if (!draft.id || PRESETS.some((p) => p.id === draft.id)) draft.id = slug(draft.name) + '-mine';
    onTestPlay(clone(draft));
  }

  // --- small form helpers ----------------------------------------------------------------------------------------
  // Two-way bindings to (obj, key): text/area on 'input' (live), number/choose/check on 'change' (commit). number
  // clamps to [min, max] and writes the clamped value back into the field so the user sees what was stored.
  const row = (label, ctl, hint) => h('label', { class: 'ed-field ed-field-col dk-st-f' }, h('span', { class: 'ed-label' }, t(label)), ctl, hint ? h('span', { class: 'ed-hint' }, t(hint)) : null);
  const text = (obj, key, attrs = {}) => { const i = h('input', { class: 'ed-input', value: obj[key] ?? '', ...attrs }); i.addEventListener('input', () => { obj[key] = i.value; touch(); }); return i; };
  const area = (obj, key) => { const i = h('textarea', { class: 'ed-input ed-textarea', rows: '3' }, obj[key] ?? ''); i.addEventListener('input', () => { obj[key] = i.value; touch(); }); return i; };
  const number = (obj, key, min, max, after) => { const i = h('input', { class: 'ed-input dk-num', type: 'number', min: String(min), max: String(max), value: obj[key] == null ? '' : String(obj[key]) }); i.addEventListener('change', () => { if (i.value === '' && obj[key] == null) return; obj[key] = Math.max(min, Math.min(max, +i.value || 0)); i.value = String(obj[key]); touch(); after?.(); }); return i; };
  const check = (obj, key, after) => { const i = h('input', { type: 'checkbox', class: 'ed-switch', checked: !!obj[key] }); i.addEventListener('change', () => { obj[key] = i.checked; touch(); after?.(); }); return i; };
  const flag = (obj, key, label, after) => h('label', { class: 'ed-field ed-field-check dk-st-f' }, check(obj, key, after), h('span', { class: 'ed-label' }, t(label)));
  const choose = (obj, key, opts, after) => { const s = h('select', { class: 'ed-input ed-select' }, opts.map(([v, l]) => h('option', { value: String(v), selected: String(obj[key] ?? '') === String(v) }, l))); s.addEventListener('change', () => { const o = opts.find(([v]) => String(v) === s.value); obj[key] = o ? o[0] : s.value; touch(); after?.(); }); return s; };
  const chips = (all, selected, onChange) => h('div', { class: 'dk-chips dk-pick' }, all.map(([v, l]) => h('button', { type: 'button', class: 'dk-chip' + (selected.includes(v) ? ' dk-on' : ''), 'aria-pressed': String(selected.includes(v)), onclick: () => { const s = selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]; onChange(s); } }, l)));
  const del = (fn) => h('button', { type: 'button', class: 'ed-iconbtn', 'aria-label': t('st2.remove'), title: t('st2.remove'), onclick: fn }, iconEl('trash'));
  const addBtn = (label, fn) => h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: fn }, iconEl('plus'), t(label));
  const section = (title, ...kids) => h('section', { class: 'ap-card' }, h('h2', { class: 'ap-card-h' }, t(title)), ...kids);
  const rankOpts = () => draft.deck.ranks.map((r) => [r.id, r.label || r.id]);
  const suitOpts = () => draft.deck.suits.map((s) => [s.id, `${s.symbol} ${s.name || s.id}`]);
  const colorOpts = () => draft.deck.colors.map((c) => [c.id, c.name || c.id]);

  // A matcher: kind + value (or JSON). get/set close over the matcher's slot in its parent, so the widget can replace
  // itself (rebuild) when the kind changes without the parent re-rendering. Invalid JSON is flagged (dk-bad) and not
  // stored.
  function matcher(get, set) {
    const m = get();
    const kind = matchKind(m);
    const box = h('div', { class: 'dk-matcher' });
    const kindSel = h('select', { class: 'ed-input ed-select' }, MATCH_KINDS.map((k) => h('option', { value: k, selected: k === kind }, t('mt.' + k))));
    kindSel.addEventListener('change', () => {
      const k = kindSel.value;
      const def = { any: {}, ownColor: { color: '=' }, ownSuit: { suit: '=' }, color: { color: draft.deck.colors[0]?.id }, suit: { suit: draft.deck.suits[0]?.id }, rank: { rank: draft.deck.ranks[0]?.id }, card: { id: '' }, trump: { trump: true }, plain: { trump: false }, none: { none: true }, json: m || {} }[k];
      set(def); touch(); rebuild();
    });
    box.append(kindSel);
    const val = () => {
      if (kind === 'color') { const o = { v: m.color }; return choose(o, 'v', colorOpts(), () => set({ color: o.v })); }
      if (kind === 'suit') { const o = { v: m.suit }; return choose(o, 'v', suitOpts(), () => set({ suit: o.v })); }
      if (kind === 'rank') { const o = { v: m.rank }; return choose(o, 'v', rankOpts(), () => set({ rank: o.v })); }
      if (kind === 'card') { const i = h('input', { class: 'ed-input dk-code', value: m.id || '', placeholder: 'Ah, R*…' }); i.addEventListener('input', () => { set({ id: i.value.trim() }); touch(); }); return i; }
      if (kind === 'json') {
        const i = h('input', { class: 'ed-input ap-mono', value: JSON.stringify(m) });
        i.addEventListener('change', () => { try { set(JSON.parse(i.value)); i.classList.remove('dk-bad'); touch(); } catch { i.classList.add('dk-bad'); } });
        return i;
      }
      return null;
    };
    const v = val();
    if (v) box.append(v);
    function rebuild() { box.replaceWith(matcher(get, set)); }
    return box;
  }

  // The rules of a card (custom cards and global card rules): trump, tier, value, wildcard, extra ranks, relations, flags.
  function cardRulesEditor(rules, onChange = () => {}) {
    const r = rules;
    const list = (key, label) => {
      const arr = Array.isArray(r[key]) ? r[key] : (r[key] = []);
      const box = h('div', { class: 'dk-mlist' }, h('span', { class: 'ed-label' }, t(label)));
      arr.forEach((m, i) => box.append(h('div', { class: 'ap-row' }, matcher(() => arr[i], (x) => { arr[i] = x; }), del(() => { arr.splice(i, 1); touch(); onChange(); }))));
      box.append(addBtn('st2.add', () => { arr.push({ color: '=' }); touch(); onChange(); }));
      return box;
    };
    const only = (key, label) => {
      const box = h('div', { class: 'dk-mlist' }, h('span', { class: 'ed-label' }, t(label)));
      if (r[key]) box.append(h('div', { class: 'ap-row' }, matcher(() => r[key], (x) => { r[key] = x; }), del(() => { delete r[key]; touch(); onChange(); })));
      else box.append(addBtn('st2.restrict', () => { r[key] = { color: '=' }; touch(); onChange(); }));
      return box;
    };
    const obj = { trump: r.trump || 'suit', wild: r.wild || '' };
    return h('div', { class: 'dk-rulesed' },
      h('div', { class: 'dk-st-grid' },
        row('cr.trump', choose(obj, 'trump', [['suit', t('cr.trump.suit')], ['always', t('cr.trump.always')], ['never', t('cr.trump.never')]], () => { r.trump = obj.trump; onChange(); })),
        row('cr.tier', number(r, 'tier', 1, 9)),
        row('cr.value', (() => { const i = h('input', { class: 'ed-input dk-num', type: 'number', value: r.value ?? '', placeholder: t('cr.valueAuto') }); i.addEventListener('change', () => { if (i.value === '') delete r.value; else r.value = +i.value; touch(); }); return i; })()),
        row('cr.wild', choose(obj, 'wild', [['', t('cr.wild.none')], ['color', t('cr.wild.color')], ['suit', t('cr.wild.suit')], ['any', t('cr.wild.any')]], () => { if (obj.wild) r.wild = obj.wild; else delete r.wild; onChange(); }))),
      h('div', { class: 'dk-mlist' }, h('span', { class: 'ed-label' }, t('cr.rankAs')), chips(rankOpts(), r.rankAs || [], (s) => { r.rankAs = s; touch(); onChange(); })),
      list('beats', 'cr.beats'), list('beatenBy', 'cr.beatenBy'), only('beatsOnly', 'cr.beatsOnly'), only('beatenOnlyBy', 'cr.beatenOnlyBy'),
      h('div', { class: 'dk-flags' }, ['noLead', 'noThrow', 'noTransfer', 'noDefend', 'closesBout'].map((k) => flag(r, k, 'ci.' + k))));
  }

  // --- tabs -------------------------------------------------------------------------------------------------------------
  function overview() {
    const base = { v: '' };
    const presetSel = choose(base, 'v', [['', t('st2.pickPreset')], ...PRESETS.map((p) => [p.id, t(`preset.${p.id}.name`)])], async () => {
      if (!base.v) return;
      if (!(await confirmDialog(t('st2.fromPreset'), t('st2.replaceQ'), t('st2.replace')))) { render(); return; }
      draft = editable(presetById(base.v));
      draft.id = base.v + '-mine';
      draft.name = t(`preset.${base.v}.name`) + ' +';
      touch(); render();
    });
    const own = h('div', { class: 'dk-ownlist' });
    for (const r of store.rulesets) {
      own.append(h('div', { class: 'dk-ownrow' }, h('b', {}, r.name || r.id), h('span', { class: 'ed-muted' }, r.id), h('span', { class: 'ed-spacer' }),
        h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => { draft = editable(r); draft.id = r.id; touch(); render(); } }, t('st2.edit')),
        del(async () => { if (await confirmDialog(t('st2.remove'), t('st2.removeQ', { name: r.name || r.id }), t('st2.remove'), true)) { removeRuleset(r.id); render(); } })));
    }
    if (!store.rulesets.length) own.append(h('p', { class: 'ed-muted' }, t('st2.noOwn')));
    body.append(
      section('st2.meta',
        h('div', { class: 'dk-st-grid' }, row('st2.name', text(draft, 'name', { maxlength: '60' })), row('st2.id', text(draft, 'id', { maxlength: '60', spellcheck: 'false' }), 'st2.idHint'), row('st2.author', text(draft, 'author', { maxlength: '60' }))),
        row('st2.description', area(draft, 'description')),
        row('st2.start', presetSel)),
      section('st2.mine', own, h('div', { class: 'ap-actions' }, h('button', { type: 'button', class: 'ed-btn', onclick: importDialog }, iconEl('upload'), t('st2.import')))),
      section('st2.preview', rulesBody(normalizeRuleset(draft))));
  }

  function deck() {
    const D = draft.deck;
    const colors = h('div', { class: 'dk-tablelike' });
    D.colors.forEach((c, i) => colors.append(h('div', { class: 'dk-trow' }, text(c, 'id', { class: 'ed-input dk-code', maxlength: '12' }), text(c, 'name'), (() => { const x = h('input', { type: 'color', class: 'ap-color', value: /^#[0-9a-f]{6}$/i.test(c.css) ? c.css : '#000000' }); x.addEventListener('input', () => { c.css = x.value; touch(); }); return x; })(), del(() => { D.colors.splice(i, 1); touch(); render(); }))));
    const suits = h('div', { class: 'dk-tablelike' });
    D.suits.forEach((s, i) => suits.append(h('div', { class: 'dk-trow' }, text(s, 'id', { class: 'ed-input dk-code', maxlength: '4' }), text(s, 'name'), text(s, 'symbol', { class: 'ed-input dk-code', maxlength: '4' }), choose(s, 'color', colorOpts()), del(() => { D.suits.splice(i, 1); touch(); render(); }))));
    const ranks = h('div', { class: 'dk-tablelike' });
    D.ranks.forEach((r, i) => ranks.append(h('div', { class: 'dk-trow' }, text(r, 'id', { class: 'ed-input dk-code', maxlength: '4' }), text(r, 'name'), text(r, 'label', { class: 'ed-input dk-code', maxlength: '4' }), number(r, 'value', -99, 999), del(() => { D.ranks.splice(i, 1); touch(); render(); }))));
    const sets = h('div', { class: 'dk-sets' });
    D.sets.forEach((s, i) => {
      if (s.ranks === 'all') s.ranks = D.ranks.filter((r) => r.id !== 'X').map((r) => r.id);
      if (s.suits === 'all') s.suits = D.suits.map((x) => x.id);
      sets.append(h('div', { class: 'dk-set' },
        h('div', { class: 'ap-row' }, h('b', {}, t('st2.set', { n: i + 1 })), h('span', { class: 'ed-spacer' }), h('span', { class: 'ed-label' }, t('st2.copies')), number(s, 'copies', 0, 8), del(() => { D.sets.splice(i, 1); touch(); render(); })),
        chips(rankOpts().filter(([v]) => v !== 'X'), s.ranks, (x) => { s.ranks = x; touch(); render(); }),
        chips(suitOpts(), s.suits, (x) => { s.suits = x; touch(); render(); })));
    });
    body.append(
      section('st2.sets', h('p', { class: 'ed-hint' }, t('st2.setsHint')), sets, addBtn('st2.addSet', () => { D.sets.push({ ranks: ['6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'].filter((r) => D.ranks.some((x) => x.id === r)), suits: D.suits.map((x) => x.id), copies: 1 }); touch(); render(); })),
      section('st2.suits', h('div', { class: 'dk-thead' }, h('span', {}, 'id'), h('span', {}, t('st2.name')), h('span', {}, t('st2.symbol')), h('span', {}, t('st2.color'))), suits, addBtn('st2.addSuit', () => { D.suits.push({ id: 'N' + D.suits.length, name: t('st2.newSuit'), symbol: '✦', color: D.colors[0]?.id || 'black' }); touch(); render(); })),
      section('st2.ranks', h('div', { class: 'dk-thead' }, h('span', {}, 'id'), h('span', {}, t('st2.name')), h('span', {}, t('st2.label')), h('span', {}, t('st2.value'))), ranks, addBtn('st2.addRank', () => { D.ranks.push({ id: 'R' + D.ranks.length, name: t('st2.newRank'), label: '?', value: 16 + D.ranks.length }); touch(); render(); })),
      section('st2.colors', colors, addBtn('st2.addColor', () => { D.colors.push({ id: 'c' + D.colors.length, name: t('st2.newColor'), css: '#2e7d32' }); touch(); render(); })));
  }

  function cards() {
    const D = draft.deck;
    const rs = safeNormalize();
    const list = h('div', { class: 'dk-cardlist' });
    D.cards.forEach((c, i) => {
      const def = rs ? rs.defs.find((d) => d.code === c.id && d.custom) : null;
      list.append(h('button', { type: 'button', class: 'dk-cardthumb' + (i === cardSel ? ' dk-on' : ''), onclick: () => { cardSel = i; render(); }, title: c.name || c.id },
        h('div', { class: 'dk-card dk-small', html: rs && def ? faceSVG(rs, def, store.settings.face) : '' }), h('span', {}, (c.name && (typeof c.name === 'string' ? c.name : c.name.en)) || c.id, ' ×', String(c.copies ?? 1))));
    });
    list.append(h('button', { type: 'button', class: 'dk-cardthumb dk-add', onclick: () => { D.cards.push({ id: 'C' + (D.cards.length + 1), name: t('st2.newCard'), label: '✦', color: D.colors[0]?.id || 'red', copies: 1, art: { kind: 'glyph', glyph: '✦' }, rules: {} }); cardSel = D.cards.length - 1; touch(); render(); } }, iconEl('plus'), h('span', {}, t('st2.addCard'))));
    body.append(section('st2.customCards', h('p', { class: 'ed-hint' }, t('st2.cardsHint')), list));
    const c = D.cards[cardSel];
    if (!c) return;
    c.rules = c.rules || {};
    c.art = c.art || null;
    const artKind = { v: c.art ? c.art.kind : '' };
    const preview = h('div', { class: 'dk-card dk-big' });
    const paint = () => { const n = safeNormalize(); const d = n && n.defs.find((x) => x.code === c.id && x.custom); preview.innerHTML = n && d ? faceSVG(n, d, store.settings.face) : ''; };
    paint();
    const upd = () => { touch(); paint(); };
    const nameIn = h('input', { class: 'ed-input', value: typeof c.name === 'string' ? c.name : (c.name && c.name.en) || '' });
    nameIn.addEventListener('input', () => { c.name = nameIn.value; upd(); });
    const glyphIn = h('input', { class: 'ed-input dk-code', value: c.art && c.art.glyph || '', maxlength: '4' });
    glyphIn.addEventListener('input', () => { c.art = { kind: 'glyph', glyph: glyphIn.value }; upd(); });
    const artCtl = h('div', { class: 'ap-row' },
      choose(artKind, 'v', [['', t('art.none')], ['joker', t('art.joker')], ['glyph', t('art.glyph')], ['image', t('art.image')]], () => { c.art = artKind.v ? { kind: artKind.v, ...(artKind.v === 'glyph' ? { glyph: c.label || '✦' } : {}) } : null; upd(); render(); }),
      artKind.v === 'glyph' ? glyphIn : null,
      artKind.v === 'image' ? h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: async () => { const [f] = await pickFiles({ accept: 'image/*' }); if (!f) return; try { c.art = { kind: 'image', src: await fitImage(f, 420, 0.8) }; upd(); } catch { toast(t('st2.badImage'), 'error'); } } }, iconEl('image'), t('st2.upload')) : null);
    const cr = { rank: c.rank || '', suit: c.suit || '', color: c.color || '' };
    body.append(section('st2.cardEdit',
      h('div', { class: 'dk-cardedit' }, preview,
        h('div', { class: 'dk-st-grid' },
          row('st2.code', text(c, 'id', { class: 'ed-input dk-code', maxlength: '6', spellcheck: 'false' }), 'st2.codeHint'),
          row('st2.name', nameIn),
          row('st2.designation', (() => { const i = h('input', { class: 'ed-input dk-code', value: c.label || '', maxlength: '4' }); i.addEventListener('input', () => { c.label = i.value || null; upd(); }); return i; })(), 'st2.designationHint'),
          row('st2.rank', choose(cr, 'rank', [['', t('st2.noRank')], ...rankOpts()], () => { c.rank = cr.rank || null; upd(); })),
          row('st2.suit', choose(cr, 'suit', [['', t('st2.noSuit')], ...suitOpts()], () => { c.suit = cr.suit || null; upd(); })),
          row('st2.color', choose(cr, 'color', [['', t('st2.bySuit')], ...colorOpts()], () => { c.color = cr.color || null; upd(); })),
          row('st2.copies', number(c, 'copies', 0, 16, paint)),
          row('st2.art', artCtl),
          row('st2.note', area(c, 'note')))),
      h('div', { class: 'ap-actions' },
        h('button', { type: 'button', class: 'ed-btn', onclick: () => { c.rules = clone(JOKER_RULES); c.rank = c.rank || 'X'; touch(); render(); } }, '🃏 ', t('st2.makeJoker')),
        h('button', { type: 'button', class: 'ed-btn', onclick: () => { D.cards.splice(cardSel + 1, 0, { ...clone(c), id: (c.id + '2').slice(0, 6) }); cardSel++; touch(); render(); } }, iconEl('copy'), t('st2.duplicate')),
        h('button', { type: 'button', class: 'ed-btn ed-danger', onclick: () => { D.cards.splice(cardSel, 1); cardSel = Math.max(0, cardSel - 1); touch(); render(); } }, iconEl('trash'), t('st2.remove')))),
      section('st2.cardRules', h('p', { class: 'ed-hint' }, t('st2.cardRulesHint')), cardRulesEditor(c.rules, paint)));
  }

  function rules() {
    const R = draft.rules;
    const trumpMode = { v: ['bottom', 'random', 'none'].includes(R.trump) ? R.trump : 'fixed' };
    const fixed = { v: ['bottom', 'random', 'none'].includes(R.trump) ? (draft.deck.suits[0]?.id || '') : R.trump };
    const groups = h('div', { class: 'dk-groups' });
    R.rankGroups.forEach((g, i) => groups.append(h('div', { class: 'ap-row' }, chips(rankOpts(), g, (s) => { R.rankGroups[i] = s; touch(); render(); }), del(() => { R.rankGroups.splice(i, 1); touch(); render(); }))));
    const beat = h('div', { class: 'dk-beatrules' });
    R.beatRules.forEach((b, i) => beat.append(h('div', { class: 'dk-beatrule' },
      matcher(() => b.by, (x) => { b.by = x; }), h('span', { class: 'dk-arrow' }, b.deny ? t('br.never') : t('br.beats')), matcher(() => b.beats, (x) => { b.beats = x; }),
      choose(b, 'same', [['', t('br.same.none')], ['suit', t('br.same.suit')], ['color', t('br.same.color')], ['rank', t('br.same.rank')], ['card', t('br.same.card')]], () => { if (!b.same) b.same = null; }),
      h('label', { class: 'ed-check-inline' }, check(b, 'deny', render), t('br.deny')), del(() => { R.beatRules.splice(i, 1); touch(); render(); }))));
    const crs = h('div', { class: 'dk-cardrules' });
    R.cardRules.forEach((cr, i) => crs.append(h('details', { class: 'dk-cr', open: i === R.cardRules.length - 1 },
      h('summary', {}, t('st2.cardRule', { n: i + 1 }), ' ', h('code', {}, JSON.stringify(cr.match))),
      h('div', { class: 'ap-row' }, h('span', { class: 'ed-label' }, t('st2.appliesTo')), matcher(() => cr.match, (x) => { cr.match = x; }), del(() => { R.cardRules.splice(i, 1); touch(); render(); })),
      cardRulesEditor(cr.set = cr.set || {}))));
    body.append(
      section('st2.basics', h('div', { class: 'dk-st-grid' },
        row('ru.minPlayers', number(R, 'minPlayers', 2, 12)), row('ru.maxPlayers', number(R, 'maxPlayers', 2, 12)), row('ru.handSize', number(R, 'handSize', 1, 20)),
        row('ru.first', choose(R, 'first', [['lowestTrump', t('ru.first.lowestTrump')], ['random', t('ru.first.random')], ['seat0', t('ru.first.seat0')]])),
        row('ru.direction', choose(R, 'direction', [[1, t('ru.dir.cw')], [-1, t('ru.dir.ccw')]])),
        row('ru.teams', choose(R, 'teams', [[0, t('ru.teams.0')], [2, t('ru.teams.2')], [3, t('ru.teams.3')]])))),
      section('st2.trumps', h('div', { class: 'dk-st-grid' },
        row('ru.trump', choose(trumpMode, 'v', [['bottom', t('ru.trump.bottom')], ['random', t('ru.trump.random')], ['none', t('ru.trump.none')], ['fixed', t('ru.trump.fixed')]], () => { R.trump = trumpMode.v === 'fixed' ? fixed.v : trumpMode.v; render(); })),
        trumpMode.v === 'fixed' ? row('ru.trumpSuit', choose(fixed, 'v', suitOpts(), () => { R.trump = fixed.v; })) : null,
        row('ru.eternalTier', number(R, 'eternalTier', 1, 9))),
        h('div', { class: 'dk-mlist' }, h('span', { class: 'ed-label' }, t('ru.eternal')), chips(suitOpts(), R.eternal, (s) => { R.eternal = s; touch(); render(); })),
        flag(R, 'trumpCross', 'ru.trumpCross'), flag(R, 'trumpExchange', 'ru.trumpExchange'), flag(R, 'pogony', 'ru.pogony')),
      section('st2.bout', h('div', { class: 'dk-st-grid' },
        row('ru.throwIn', choose(R, 'throwIn', [['all', t('ru.throwIn.all')], ['neighbors', t('ru.throwIn.neighbors')], ['attacker', t('ru.throwIn.attacker')]])),
        row('ru.boutLimit', number(R, 'boutLimit', 0, 99), 'ru.zeroUnlimited'), row('ru.firstBoutLimit', number(R, 'firstBoutLimit', 0, 99), 'ru.zeroSame')),
        flag(R, 'limitByHand', 'ru.limitByHand'), flag(R, 'leadMulti', 'ru.leadMulti'), flag(R, 'throwAfterTake', 'ru.throwAfterTake'),
        flag(R, 'transfer', 'ru.transfer', render), R.transfer ? flag(R, 'transferShow', 'ru.transferShow') : null),
      section('st2.groups', h('p', { class: 'ed-hint' }, t('st2.groupsHint')), groups, addBtn('st2.addGroup', () => { R.rankGroups.push([]); touch(); render(); })),
      section('st2.beatRules', h('p', { class: 'ed-hint' }, t('st2.beatRulesHint')), beat, addBtn('st2.addBeatRule', () => { R.beatRules.push({ by: { rank: draft.deck.ranks[0]?.id }, beats: { rank: draft.deck.ranks[draft.deck.ranks.length - 1]?.id }, same: 'suit', deny: false }); touch(); render(); })),
      section('st2.cardRulesAll', h('p', { class: 'ed-hint' }, t('st2.cardRulesAllHint')), crs, addBtn('st2.addCardRule', () => { R.cardRules.push({ match: { rank: 'J' }, set: { wild: 'suit' } }); touch(); render(); })));
  }

  function safeNormalize() { try { return normalizeRuleset(draft); } catch { return null; } }

  function checkTab() {
    const v = validateRuleset(draft);
    const list = h('ul', { class: 'dk-issues' }, [...v.errors.map((e) => h('li', { class: 'dk-err' }, h('code', {}, e.path), ' ', e.msg)), ...v.warnings.map((e) => h('li', { class: 'dk-warn' }, h('code', {}, e.path), ' ', e.msg))]);
    if (!v.errors.length && !v.warnings.length) list.append(h('li', { class: 'dk-okl' }, t('st2.allGood')));
    body.append(section('st2.validation', list));
    const rs = v.ruleset;
    if (!rs) return;
    // What beats what: pick a card, see its relations under a trump suit.
    const C = compile(rs);
    const st = { trump: rs.deck.suits[0]?.id || '', card: rs.defs[0]?.code };
    const relBox = h('div', { class: 'dk-rel' });
    const paintRel = () => {
      relBox.textContent = '';
      const ti = C.trumpIndex(st.trump || null);
      const d = C.defByCode.get(st.card);
      if (d == null) return;
      const beats = [], beatenBy = [], matches = [];
      for (let j = 0; j < C.D; j++) {
        if (C.beat[ti][d * C.D + j]) beats.push(j);
        if (C.beat[ti][j * C.D + d]) beatenBy.push(j);
        if (j !== d && C.match[d * C.D + j]) matches.push(j);
      }
      const strip = (arr) => h('div', { class: 'dk-strip' }, arr.length ? arr.map((j) => h('div', { class: 'dk-card dk-tiny', title: cardText(rs, C.defs[j]), html: faceSVG(rs, C.defs[j], store.settings.face) })) : h('span', { class: 'ed-muted' }, '—'));
      relBox.append(h('div', { class: 'dk-relcard' }, h('div', { class: 'dk-card dk-small', html: faceSVG(rs, C.defs[d], store.settings.face) })),
        h('h3', {}, t('st2.beats', { n: beats.length })), strip(beats),
        h('h3', {}, t('st2.beatenBy', { n: beatenBy.length })), strip(beatenBy),
        h('h3', {}, t('st2.matches', { n: matches.length })), strip(matches));
    };
    const cardSelEl = choose(st, 'card', rs.defs.map((d) => [d.code, `${cardText(rs, d)} (${d.code})`]), paintRel);
    const trumpSel = choose(st, 'trump', [['', t('ru.trump.none')], ...rs.deck.suits.map((s) => [s.id, s.symbol + ' ' + (s.name || s.id)])], paintRel);
    paintRel();
    body.append(section('st2.relations', h('div', { class: 'ap-row' }, row('st2.card', cardSelEl), row('st2.trumpSuit', trumpSel)), relBox));
    // Quick tournament.
    const out = h('div', { class: 'dk-simout' });
    const runBtn = h('button', { type: 'button', class: 'ed-btn ed-primary', onclick: () => simulate(rs, out, runBtn) }, iconEl('chart'), t('st2.simulate'));
    body.append(section('st2.sim', h('p', { class: 'ed-hint' }, t('st2.simHint')), runBtn, out));
  }

  // Quick tournament: 30 seeded games of mixed-style level-2 bots, run in time slices of ~40ms with setTimeout(0)
  // between slices so the page stays responsive (no worker needed for this size). Seeds derive from the ruleset hash,
  // so the same ruleset always gives the same report. Safety cap of 3000 moves per game: a ruleset that cannot end
  // (e.g. nothing can ever be beaten) is reported as "unfinished" instead of hanging the tab. "First durak" compared
  // with 1/n hints whether the first attacker is disadvantaged.
  function simulate(rs, out, btnEl) {
    const pr = playerRange(rs);
    const n = Math.max(pr.min, Math.min(pr.max, 3));
    const total = 30;
    const stats = { games: 0, unfinished: 0, bouts: 0, draws: 0, firstDurak: 0, taken: 0, moves: 0 };
    btnEl.disabled = true;
    const prog = h('div', { class: 'ap-progress' }, h('i'));
    out.textContent = '';
    out.append(prog);
    const P = Array.from({ length: n }, (_, i) => profileOf(['accountant', 'hunter', 'miser', 'blitz', 'puppeteer', 'ally'][i % 6], { level: 2 }));
    let g = 0;
    const one = () => {
      const rng = seededRandom('studio-' + rs.hash + '-' + g);
      const brng = rng.fork('bots');
      let s = newGame(rs, { players: n, rng });
      const first = s.attacker;
      let k = 0;
      while (s.phase !== 'over' && k < 3000) {
        const seat = turn(s);
        if (seat < 0) break;
        const a = decide(viewOf(s, seat), seat, brng, P[seat]);
        const r = a ? apply(s, seat, a) : { error: 'none' };
        if (r.error) break;
        s = r.state; k++;
      }
      stats.games++;
      stats.moves += k;
      if (s.phase !== 'over') stats.unfinished++;
      else {
        stats.bouts += s.result.bouts;
        if (s.result.draw) stats.draws++;
        else if (s.result.durak === first) stats.firstDurak++;
        stats.taken += s.log.filter((e) => e[0] === '/' && e[1]).length;
      }
    };
    const step = () => {
      const t0 = performance.now();
      while (g < total && performance.now() - t0 < 40) { one(); g++; }
      prog.firstChild.style.width = Math.round((g / total) * 100) + '%';
      if (g < total) { setTimeout(step, 0); return; }
      btnEl.disabled = false;
      const fin = stats.games - stats.unfinished || 1;
      out.textContent = '';
      out.append(h('dl', { class: 'ap-kv' },
        h('dt', {}, t('st2.simGames')), h('dd', {}, `${stats.games} × ${n}`),
        h('dt', {}, t('st2.simBouts')), h('dd', {}, (stats.bouts / fin).toFixed(1)),
        h('dt', {}, t('st2.simMoves')), h('dd', {}, (stats.moves / stats.games).toFixed(0)),
        h('dt', {}, t('st2.simTakes')), h('dd', {}, Math.round((stats.taken / Math.max(1, stats.bouts)) * 100) + '%'),
        h('dt', {}, t('st2.simFirst')), h('dd', {}, Math.round((stats.firstDurak / fin) * 100) + '% ' + t('st2.simFair', { p: Math.round(100 / n) })),
        h('dt', {}, t('st2.simDraws')), h('dd', {}, String(stats.draws)),
        h('dt', {}, t('st2.simUnfinished')), h('dd', { class: stats.unfinished ? 'ed-error' : '' }, String(stats.unfinished))));
    };
    setTimeout(step, 30);
  }

  function look() {
    const S = store.settings;
    const pick = (list, key, preview) => h('div', { class: 'dk-swatches' }, list.map((x) => h('button', { type: 'button', class: 'dk-swatch' + (S[key] === x.id ? ' dk-on' : ''), 'aria-pressed': String(S[key] === x.id), onclick: () => { S[key] = x.id; save('settings'); render(); } }, preview(x), h('span', {}, t(x.name)))));
    const rs = normalizeRuleset(presetById('podkidnoy-36'));
    const sample = ['Qh', 'As', '7d'].map((c) => rs.defs.find((d) => d.code === c));
    const upload = (key, label) => h('div', { class: 'ap-row' },
      h('button', { type: 'button', class: 'ed-btn', onclick: async () => { const [f] = await pickFiles({ accept: 'image/*' }); if (!f) return; try { S[key] = await fitImage(f, key === 'tableImage' ? 1280 : 420, 0.8); if (key === 'tableImage') S.table = 'image'; else S.back = 'image'; save('settings'); render(); } catch { toast(t('st2.badImage'), 'error'); } } }, iconEl('image'), t(label)),
      S[key] ? h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => { S[key] = null; save('settings'); render(); } }, iconEl('close'), t('st2.clearImage')) : null);
    body.append(
      section('lk.table', pick(TABLES.filter((x) => x.id !== 'image' || S.tableImage), 'table', (x) => h('i', { class: 'dk-tablesw', style: { background: `radial-gradient(circle at 50% 40%, ${x.vars.felt}, ${x.vars.felt2})`, borderColor: x.vars.rim } })), upload('tableImage', 'lk.uploadTable')),
      section('lk.faces', pick(FACES, 'face', (x) => h('span', { class: 'dk-facesw' }, sample.map((d) => h('i', { class: 'dk-card dk-tiny', html: faceSVG(rs, d, x.id) }))))),
      section('lk.backs', pick(BACKS.filter((x) => x.id !== 'image' || S.backImage), 'back', (x) => h('i', { class: 'dk-card dk-tiny', html: backSVG(x.id, backColor(skinOf(S)), S.backImage) })), upload('backImage', 'lk.uploadBack')),
      section('lk.ruleset', h('p', { class: 'ed-hint' }, t('lk.rulesetHint')),
        h('label', { class: 'ed-field ed-field-check' }, h('input', { type: 'checkbox', class: 'ed-switch', checked: !!draft.skin, onchange: (e) => { draft.skin = e.target.checked ? { table: S.table, face: S.face, back: S.back } : null; touch(); } }), h('span', { class: 'ed-label' }, t('lk.embed')))));
  }

  function bots() {
    body.append(section('st2.botBuilder', h('p', { class: 'ed-hint' }, t('st2.botHint')), builder(() => { toast(t('bp.saved'), 'ok'); render(); })));
  }

  function exporter() {
    const v = validateRuleset(draft);
    const code = v.ok ? shareCode(draft) : '';
    const link = v.ok ? location.href.split('#')[0] + '#rs=' + encodeURIComponent(code) : '';
    const mode = artifactMode();
    const a = globalThis.IN_HTML_ARTIFACT;
    const canStandalone = !!(a && a.singlefile && mode !== 'offline' && pageHTML);
    const servers = h('textarea', { class: 'ed-input ap-mono', rows: '3', placeholder: 'https://durak.example.org' }, (store.settings.servers || []).join('\n') || (mode === 'backend' && /^https?:/.test(location.protocol) ? location.origin : ''));
    body.append(
      section('ex.ruleset', v.ok ? null : h('p', { class: 'ed-error' }, t('st2.fixErrors')),
        h('div', { class: 'ap-actions' },
          h('button', { type: 'button', class: 'ed-btn ed-primary', disabled: !v.ok, onclick: () => download(JSON.stringify(fullSource(normalizeRuleset(draft)), null, 1), slug(draft.id || draft.name) + '.durak.json', 'application/json') }, iconEl('download'), t('ex.file')),
          h('button', { type: 'button', class: 'ed-btn', disabled: !v.ok, onclick: () => copyText(code, t('ex.codeCopied')) }, iconEl('copy'), t('ex.code')),
          h('button', { type: 'button', class: 'ed-btn', disabled: !v.ok, onclick: () => copyText(link, t('ex.linkCopied')) }, iconEl('link'), t('ex.link')),
          h('button', { type: 'button', class: 'ed-btn', onclick: importDialog }, iconEl('upload'), t('st2.import'))),
        h('p', { class: 'ed-hint' }, t('ex.publishHint'))),
      section('ex.standalone', h('p', { class: 'ed-hint' }, t('ex.standaloneHint')),
        row('ex.servers', servers, 'ex.serversHint'),
        canStandalone ? h('button', { type: 'button', class: 'ed-btn ed-primary', onclick: () => exportStandalone(servers.value) }, iconEl('download'), t('ex.standaloneBtn'))
          : h('p', { class: 'ed-hint ed-hint-warn' }, t(mode === 'offline' ? 'ex.notInOffline' : 'ex.needSinglefile'))));
  }

  // Standalone page = the loaded page HTML with its IN_HTML_ARTIFACT config replaced (or inserted after <head>).
  // '<' in the JSON is escaped as < so a server string cannot close the <script> early. replace() gets a function
  // so '$' sequences in the tag are not interpreted as replacement patterns. Only http(s) URLs are accepted.
  function exportStandalone(text2) {
    const list = String(text2).split(/[\s,]+/).map((s) => s.trim().replace(/\/+$/, '')).filter((s) => /^https?:\/\/[^\s/]+/.test(s));
    const meta = { mode: 'standalone', singlefile: true, servers: list };
    const tag = `<script>globalThis.IN_HTML_ARTIFACT=${JSON.stringify(meta).replace(/</g, '\\u003c')}</script>`;
    let html = pageHTML;
    const re = /<script>globalThis\.IN_HTML_ARTIFACT=[^<]*<\/script>/;
    html = re.test(html) ? html.replace(re, () => tag) : html.replace(/<head[^>]*>/i, (m) => m + tag);
    download(html, 'durak-standalone.html', 'text/html');
    toast(t('ex.standaloneDone', { n: list.length }), 'ok');
  }

  async function importDialog() {
    const ta = h('textarea', { class: 'ed-input ap-mono', rows: '5', placeholder: 'DKR1:… / { "deck": … }' });
    const res = await openDialog({ title: t('st2.import'), body: h('div', {}, h('p', { class: 'ed-hint' }, t('st2.importHint')), ta,
      h('button', { type: 'button', class: 'ed-btn', onclick: async () => { const [f] = await pickFiles({ accept: '.json,application/json' }); if (f) ta.value = await f.text(); } }, iconEl('file'), t('st2.fromFile'))),
    buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('st2.import'), value: 'ok', primary: true }] });
    if (res !== 'ok') return;
    const raw = readShared(ta.value);
    if (!raw) { toast(t('st2.badImport'), 'error'); return; }
    const v = validateRuleset(raw);
    if (!v.ok) { toast(t('st2.badImport') + ': ' + v.errors[0].msg, 'error'); return; }
    draft = editable(raw);
    draft.id = slug(raw.id || raw.name);
    touch();
    tab = 'overview';
    render();
    toast(t('st2.imported'), 'ok');
  }

  render();
  return { root, importRuleset: (raw) => { draft = editable(raw); draft.id = slug(raw.id || raw.name); touch(); render(); }, get dirty() { return dirty; } };
}

export { promptDialog, STD_COLORS, STD_SUITS, STD_RANKS };
