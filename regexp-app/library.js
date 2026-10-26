// regexp-app/library.js - dialogs of Regex Studio: the pattern library (strict validators of standard formats,
// generators, examples; search and categories) and the saved patterns with the history of recently tried ones.
// 
// Pattern data is in regexp/ (patterns.js, validators.js); this file renders it. Dialogs are rebuilt on every paint
// (lists are small: dozens of entries) — simpler than diffing, and the search input lives outside the repainted part.
import { h, lsGet, lsSet } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { seg, t } from '../ui/app.js';
import { confirmDialog, openDialog } from '../ui/overlays.js';
import { fmtDate } from '../ui/lang.js';
import { CATEGORIES, PATTERNS } from '../regexp/patterns.js';
import { VALIDATORS, VALIDATOR_CATEGORIES, sampleOf } from '../regexp/validators.js';
import { GENERATORS } from './generators.js';
import { clearHistory, historyList, removeSaved, savedList } from './state.js';
import { patternHTML } from './editor.js';

// Long sources are cut at 140 characters before highlighting: the card shows one ellipsised line anyway, and highlighting a 2 KB validator per card would be wasted work.
const preview = (source, flags) => h('code', { class: 'rx-lib-src', html: patternHTML(source.length > 140 ? source.slice(0, 140) : source, flags) + (source.length > 140 ? '…' : '') });

/** The pattern library: strict validators, generators and examples in tabs; onPick(entry) loads a pattern. */
// Last tab remembered in localStorage. close is captured from onMount, because openDialog returns a promise, not a handle.
export function openLibrary(onPick) {
  let tab = lsGet('regex-lib-tab', 'validators');
  let close = null;
  const body = h('div', { class: 'rx-lib' });
  const tabs = seg([{ v: 'validators', l: 'rx.lib.validators' }, { v: 'generators', l: 'rx.lib.generators' }, { v: 'examples', l: 'rx.lib.examples' }], tab,
    (v) => { tab = v; lsSet('regex-lib-tab', v); paint(); }, 'rx.lib.tabs');
  tabs.classList.add('rx-lib-tabs');
  const pick = (entry) => { onPick(entry); close && close(null); };
  const paint = () => {
    body.textContent = '';
    body.append(tabs, tab === 'validators' ? validatorsPane(pick) : tab === 'generators' ? generatorsPane(pick) : examplesPane(pick));
  };
  paint();
  openDialog({
    title: t('rx.lib.title'), wide: true, className: 'rx-dlg', body, buttons: [{ label: t('dlg.close'), value: null }],
    onMount: (d) => { close = d.close; },
  });
}

// A searchable list with category chips: items(cat, query) -> elements.
// Category chips are a radiogroup (role=radio + aria-checked): exactly one is active, which is the radio semantics, not
// a set of toggle buttons.
function listPane(categories, items, hint) {
  let cat = 'all', query = '';
  const listEl = h('div', { class: 'rx-lib-list', role: 'list' });
  const search = h('input', { type: 'search', class: 'ed-input', placeholder: t('rx.lib.search'), 'aria-label': t('rx.lib.search') });
  const chips = h('div', { class: 'ed-chips rx-lib-cats', role: 'radiogroup', 'aria-label': t('rx.lib.cats') });
  const paintChips = () => {
    chips.textContent = '';
    for (const c of ['all', ...categories]) {
      chips.append(h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(cat === c), class: 'ed-chip' + (cat === c ? ' ed-on' : ''),
        onclick: () => { cat = c; paintChips(); paint(); },
      }, t(c === 'all' ? 'rx.lib.all' : 'rx.cat.' + c)));
    }
  };
  const paint = () => {
    listEl.textContent = '';
    const els = items(cat, query.trim().toLowerCase());
    if (!els.length) listEl.append(h('p', { class: 'rx-empty' }, t('rx.lib.none')));
    else listEl.append(...els);
  };
  search.addEventListener('input', () => { query = search.value; paint(); });
  paintChips();
  paint();
  return h('div', { class: 'rx-lib-pane' }, hint ? h('p', { class: 'ed-hint rx-lib-hint' }, hint) : null, search, chips, listEl);
}

// Search over localized name and description plus the untranslated name, standard and source: users search in their language or by the RFC name.
const matches = (q, ...texts) => !q || texts.some((s) => String(s).toLowerCase().includes(q));

function validatorsPane(pick) {
  return listPane(VALIDATOR_CATEGORIES, (cat, q) => VALIDATORS
    .filter((v) => (cat === 'all' || v.cat === cat) && matches(q, t('rx.val.' + v.key), t('rx.val.' + v.key + '.d'), v.name, v.std, v.source))
    .map((v) => h('button', {
      type: 'button', class: 'rx-lib-item', role: 'listitem',
      onclick: () => pick({ source: v.source, flags: v.flags, sample: sampleOf(v), tab: 'matches', label: t('rx.val.' + v.key) }),
    },
    h('span', { class: 'rx-lib-top' }, h('b', { class: 'rx-lib-name' }, t('rx.val.' + v.key)), h('span', { class: 'rx-lib-std' }, v.std),
      h('span', { class: 'rx-lib-flags' }, '/' + v.flags)),
    h('span', { class: 'rx-lib-desc' }, t('rx.val.' + v.key + '.d')),
    preview(v.source, v.flags))), t('rx.lib.validatorsHint'));
}

// Two states in one pane (card list / open generator) swapped in place, so the dialog keeps its size and scroll position logic.
function generatorsPane(pick) {
  const pane = h('div', { class: 'rx-lib-pane' });
  const showList = () => {
    pane.textContent = '';
    pane.append(h('p', { class: 'ed-hint rx-lib-hint' }, t('rx.lib.generatorsHint')), h('div', { class: 'rx-lib-list rx-gen-list', role: 'list' }, GENERATORS.map((g) => h('button', {
      type: 'button', class: 'rx-lib-item rx-gen-card', role: 'listitem', onclick: () => open(g),
    }, h('span', { class: 'rx-lib-top' }, iconEl(g.icon), h('b', { class: 'rx-lib-name' }, t('rx.gen.' + g.key))), h('span', { class: 'rx-lib-desc' }, t('rx.gen.' + g.key + '.d'))))));
  };
  const open = (g) => {
    pane.textContent = '';
    pane.append(h('div', { class: 'rx-gen-bar' },
      h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: showList }, iconEl('chevLeft'), t('rx.gen.back')),
      h('b', {}, t('rx.gen.' + g.key))),
    g.form((r) => pick({ ...r, tab: 'matches', label: t('rx.gen.' + g.key) })));
  };
  showList();
  return pane;
}

function examplesPane(pick) {
  return listPane(CATEGORIES, (cat, q) => PATTERNS
    .filter((p) => (cat === 'all' || p.cat === cat) && matches(q, t('rx.pat.' + p.key), t('rx.pat.' + p.key + '.d'), p.name, p.source))
    .map((p) => h('button', {
      type: 'button', class: 'rx-lib-item', role: 'listitem',
      onclick: () => pick({ ...p, label: t('rx.pat.' + p.key) }),
    },
    h('span', { class: 'rx-lib-top' }, h('b', { class: 'rx-lib-name' }, t('rx.pat.' + p.key)), h('span', { class: 'rx-lib-cat' }, t('rx.cat.' + p.cat)),
      p.flags ? h('span', { class: 'rx-lib-flags' }, '/' + p.flags) : null),
    h('span', { class: 'rx-lib-desc' }, t('rx.pat.' + p.key + '.d')),
    preview(p.source, p.flags))), t('rx.lib.examplesHint'));
}

/** Saved patterns and history; onOpen(entry) loads one. */
// Delete asks for confirmation (destructive, no undo); history items have no delete button, only "clear all".
export function openSaved(onOpen) {
  const body = h('div', { class: 'rx-saved' });
  let close = null;
  const item = (e, i, kind) => h('div', { class: 'rx-sv-item', role: 'listitem' },
    h('button', {
      type: 'button', class: 'rx-sv-open', title: t('rx.sv.open'),
      onclick: () => { onOpen(e); close && close(null); },
    },
    e.name ? h('b', { class: 'rx-sv-name' }, e.name) : null,
    preview(e.source || '∅', e.flags),
    h('span', { class: 'rx-sv-meta' }, (e.flags ? '/' + e.flags + ' · ' : '') + (e.at ? fmtDate(new Date(e.at).toISOString()) : ''))),
    kind === 'saved' ? h('button', {
      type: 'button', class: 'ed-iconbtn ed-danger', title: t('dlg.delete'), 'aria-label': t('dlg.delete') + ': ' + e.name,
      onclick: async () => { if (await confirmDialog(t('rx.sv.title'), t('rx.sv.deleteQ', { name: e.name }), t('dlg.delete'), true)) { removeSaved(i); paint(); } },
    }, iconEl('trash')) : null);
  const paint = () => {
    body.textContent = '';
    const saved = savedList(), hist = historyList();
    body.append(h('h3', { class: 'rx-sv-h' }, iconEl('star'), t('rx.sv.saved')),
      saved.length ? h('div', { class: 'rx-sv-list', role: 'list' }, saved.map((e, i) => item(e, i, 'saved'))) : h('p', { class: 'ed-hint' }, t('rx.sv.emptySaved')),
      h('div', { class: 'rx-sv-hrow' }, h('h3', { class: 'rx-sv-h' }, iconEl('clock'), t('rx.sv.history')),
        hist.length ? h('button', {
          type: 'button', class: 'ed-btn ed-sm', onclick: async () => {
            if (await confirmDialog(t('rx.sv.history'), t('rx.sv.clearQ'), t('ap.clear'), true)) { clearHistory(); paint(); }
          },
        }, iconEl('trash'), t('rx.sv.clear')) : null),
      hist.length ? h('div', { class: 'rx-sv-list', role: 'list' }, hist.map((e, i) => item(e, i, 'history'))) : h('p', { class: 'ed-hint' }, t('rx.sv.emptyHistory')));
  };
  paint();
  openDialog({ title: t('rx.sv.title'), wide: true, className: 'rx-dlg', body, buttons: [{ label: t('dlg.close'), value: null }], onMount: (d) => { close = d.close; } });
}
