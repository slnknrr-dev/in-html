// embroidery-studio/pickers.js - dialogs that pick threads (a brand's catalogue with search by number or name, nearest
// threads to a colour, blends of two threads in one needle) and symbols (vector symbols and letters).
//
//   pickThread({ title, brand, hex, blend }) -> palette entry | null
//   pickSymbol(current, used) -> symbol | null

//
// Thread search: a code matches by prefix ("31" finds 310, 3110...), a name by substring, and `eq` lists DMC
// equivalents so a DMC number also finds the matching thread of another brand. The grid renders at most 600 swatches:
// some catalogues have ~500+ threads and a full re-render per keystroke must stay fast.
import { h, debounce } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { iconEl } from '../ui/icons.js';
import { seg, select } from '../ui/app.js';
import { openDialog } from '../ui/overlays.js';
import { BRANDS, catalog, nearestThreads, hexToRgb } from '../stitch/threads.js';
import { threadEntry, blendEntry } from '../stitch/model.js';
import { SYMBOLS, SYMBOL_ORDER, LETTERS } from '../stitch/symbols.js';
import { settings, setSettings } from './store.js';

const fold = (s) => String(s || '').toLowerCase();

export function pickThread({ title = t('pick.thread'), brand = settings().brand, hex = '', blend = false } = {}) {
  let cur = brand, chosen = [], mode = blend ? 'blend' : 'one', query = '';
  const grid = h('div', { class: 'es-tgrid', role: 'listbox', 'aria-label': t('pick.threads') });
  const near = h('div', { class: 'es-tnear' });
  const picked = h('div', { class: 'es-tpicked' });
  const search = h('input', { type: 'search', class: 'ed-input', placeholder: t('pick.searchPh'), 'aria-label': t('pick.search') });
  const color = h('input', { type: 'color', class: 'ap-color', value: hex || '#c72b3b', title: t('pick.nearest') });
  let okBtn = null;
  function swatch(th) {
    const on = chosen.some((c) => c.key === th.key);
    // listbox / option roles with aria-selected; in blend mode a third pick drops the oldest (slice(-2)).
    return h('button', {
      type: 'button', class: 'es-tsw' + (on ? ' on' : ''), role: 'option', 'aria-selected': String(on), title: `${th.brand} ${th.code} — ${th.name}`,
      onclick: () => { if (mode === 'one') chosen = [th]; else { chosen = on ? chosen.filter((c) => c.key !== th.key) : [...chosen, th].slice(-2); } render(); },
    }, h('span', { class: 'es-tsw-c', style: { background: th.hex } }), h('b', {}, th.code), h('small', {}, th.name));
  }
  function render() {
    const cat = catalog(cur);
    const q = fold(query).trim();
    const list = cat.threads.filter((th) => !q || fold(th.code).startsWith(q) || fold(th.name).includes(q) || (th.eq && th.eq.some((d) => d === q)));
    grid.textContent = '';
    grid.append(...list.slice(0, 600).map(swatch));
    if (!list.length) grid.append(h('p', { class: 'ed-muted' }, t('pick.none')));
    // Nearest threads by colour difference (delta E) to the chosen colour, shown with their distance so the user can
    // judge the match.
    const nearList = nearestThreads(color.value, cur, { n: 8 });
    near.textContent = '';
    near.append(h('span', { class: 'ed-label' }, t('pick.nearestTo')), color, ...nearList.map((r) => { const b = swatch(r.thread); b.append(h('small', { class: 'es-de' }, 'ΔE ' + r.dE.toFixed(1))); return b; }));
    picked.textContent = '';
    picked.append(...chosen.map((c) => h('span', { class: 'ed-chip es-chip' }, h('i', { class: 'es-dot', style: { background: c.hex } }), `${c.brand} ${c.code}`)));
    if (mode === 'blend' && chosen.length === 2) {
      const e = blendEntry(chosen);
      picked.append(h('span', { class: 'ed-chip es-chip' }, h('i', { class: 'es-dot', style: { background: e.hex } }), t('pick.blendResult')));
    }
    if (okBtn) okBtn.disabled = mode === 'blend' ? chosen.length !== 2 : chosen.length !== 1;
  }
  search.addEventListener('input', debounce(() => { query = search.value; render(); }, 120));
  color.addEventListener('input', debounce(render, 80));
  const body = h('div', { class: 'es-picker' },
    h('div', { class: 'es-picker-head' },
      select(BRANDS.map((b) => ({ v: b.id, l: '=' + b.brand })), cur, (v) => { cur = v; chosen = []; setSettings({ brand: v }); render(); }),
      seg([{ v: 'one', l: 'pick.one' }, { v: 'blend', l: 'pick.blend' }], mode, (v) => { mode = v; chosen = chosen.slice(0, v === 'one' ? 1 : 2); render(); }, 'pick.mode'),
      h('label', { class: 'es-psearch' }, iconEl('search'), search)),
    near, picked, grid);
  render();
  return openDialog({
    title, body, wide: true, className: 'es-pickdlg',
    // OK stays disabled until the selection is complete (one thread, or exactly two for a blend).
    onMount: ({ el }) => { okBtn = el.querySelector('.ed-primary'); render(); },
    buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('pick.use'), value: 'ok', primary: true }],
  }).then((v) => {
    if (v !== 'ok') return null;
    if (mode === 'blend') return chosen.length === 2 ? blendEntry(chosen, { strands: 2 }) : null;
    return chosen[0] ? threadEntry(chosen[0], { strands: settings().strands }) : null;
  });
}

// Symbols already used by other colours are dimmed, not disabled: a deliberate duplicate is allowed, but the user
// sees it. A typed letter (max 2 chars) replaces the vector symbol.
export function pickSymbol(current, used = new Set()) {
  let chosen = current;
  const grid = h('div', { class: 'es-sgrid', role: 'listbox', 'aria-label': t('pick.symbols') });
  const letter = h('input', { type: 'text', class: 'ed-input es-letter', maxlength: 2, value: current && !SYMBOLS[current] ? current : '', placeholder: 'Ab', 'aria-label': t('pick.letter') });
  const render = () => {
    grid.textContent = '';
    for (const id of SYMBOL_ORDER) {
      const on = chosen === id;
      grid.append(h('button', {
        type: 'button', class: 'es-ssw' + (on ? ' on' : '') + (used.has(id) && !on ? ' used' : ''), role: 'option', 'aria-selected': String(on), title: id,
        onclick: () => { chosen = id; letter.value = ''; render(); },
        html: `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="${SYMBOLS[id].d}"/></svg>`,
      }));
    }
  };
  letter.addEventListener('input', () => { chosen = letter.value.trim(); render(); });
  render();
  const body = h('div', { class: 'es-picker' }, h('p', { class: 'ed-hint' }, t('pick.symbolHint')), grid,
    h('label', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('pick.letter')), letter),
    h('p', { class: 'ed-hint' }, t('pick.letters', { list: LETTERS.slice(0, 40).join(' ') })));
  return openDialog({ title: t('pick.symbol'), body, wide: true, buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('pick.use'), value: 'ok', primary: true }] })
    .then((v) => (v === 'ok' && chosen ? chosen : null));
}

export const rgbOf = hexToRgb;
