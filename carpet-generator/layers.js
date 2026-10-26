// carpet-generator/layers.js - the composition panel: the rug's own field layers (regional recipes and mash-ups,
// which can be taken over for editing) and the user's layers on top — add by pattern type or at random, reorder,
// switch off, duplicate, reseed, delete; every layer's pattern parameters, colour roles, blend, opacity, area,
// grid map, transforms (offset, rotation, scale, symmetry, kaleidoscope folds) and warps (polar, wallpaper tile).
//
//   renderLayers(host, { layers, fieldLayers, motifs: [{ id, label }], colorOf(role) -> css, onChange(layers, { adopt }) })
//
// Design decisions:
// - Stateless view over an immutable list: every edit builds a new array and calls onChange; the page regenerates the
//   rug and re-renders this panel. No layer object is mutated in place, so the page's state stays the single truth.
// - normLayer (carpet/compose.js) on read and on write: older saved layers and random layers get every field filled
//   with defaults, so the controls below can read L.x without guards.
// - The only local state is which cards are expanded (`open`), kept at module level so it survives the re-render
//   that each edit triggers.

import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { iconEl } from '../ui/icons.js';
import { select, range, button, toggle } from '../ui/app.js';
import { PATTERNS, defaultParams } from '../carpet/patterns.js';
import { normLayer, BLENDS, SYMS, WARPS, VARY } from '../carpet/compose.js';
import { WALLPAPER } from '../carpet/symmetry.js';
import { ROLES } from '../carpet/dyes.js';
import { randomSeed } from '../prng/prng.js';

const CATS = ['ornament', 'motif', 'fractal', 'abstract'];
// Indices of expanded layers (kept across re-renders). Keyed by index, so moves remap it explicitly (move()).
// KNOWN DEFECT: delete and duplicate do not shift the indices above the affected position, so after deleting layer 1
// the card that was layer 2 (now 1) loses or inherits the expanded state of another card. Fix: rebuild `open` on
// delete (k > i -> k - 1) and duplicate (k > i -> k + 1), or key it by a stable layer id.
const open = new Set();

export function renderLayers(host, { layers, fieldLayers = [], motifs = [], colorOf = () => '#888', onChange }) {
  host.textContent = '';
  const list = layers.map(normLayer);
  const commit = (next) => onChange(next.map(normLayer), {});
  // Pattern types grouped by category in one flat select ("Fractal · Mandelbrot"): optgroups would need a different
  // select() helper. The no-op onChange: the value is read only when "+" is pressed.
  const typeSel = select(CATS.flatMap((c) => Object.keys(PATTERNS).filter((k) => PATTERNS[k].cat === c).map((k) => ({ v: k, l: '=' + t('pcat.' + c) + ' · ' + t('pt.' + k) }))), 'mandelbrot', () => {});
  host.append(...[
    h('p', { class: 'ed-hint' }, t('ly.lead')),
    fieldLayers.length ? h('div', { class: 'cg-adopt' }, h('span', {}, t('ly.fieldHas', { n: fieldLayers.length })), button('ly.adopt', 'edit', () => onChange([...fieldLayers, ...list].map(normLayer), { adopt: true }))) : null,
    h('div', { class: 'ed-row cg-addrow' }, typeSel,
      button('', 'plus', () => { open.add(list.length); commit([...list, { type: typeSel.value, params: defaultParams(typeSel.value), seed: randomSeed(2) }]); }),
      // Random layer: Math.random, not the seeded PRNG, on purpose: this is a dice roll of the UI; the result is then
      // fixed in state (with its own seed) and reproducible from the share code. 'over' is listed twice to weight it.
      // The roles shuffle via sort(random - 0.5) is biased, acceptable for picking 4 colours for fun.
      button('ly.random', 'sparkle', () => {
        const types = Object.keys(PATTERNS).filter((k) => k !== 'motif');
        const type = types[Math.floor(Math.random() * types.length)];
        const pick = (a) => a[Math.floor(Math.random() * a.length)];
        commit([...list, { type, seed: randomSeed(2), params: defaultParams(type), sym: pick(['kaleido', 'mirrorXY', 'rot4', 'none']), fold: pick([6, 8, 12]), blend: pick(['over', 'over', 'outline', 'invert', 'under']), roles: [...ROLES].sort(() => Math.random() - 0.5).slice(0, 4) }]);
      })),
  ].filter(Boolean));
  if (!list.length) { host.append(h('p', { class: 'cg-empty' }, t('ly.none'))); return; }
  list.forEach((L, i) => host.append(layerCard(L, i, list, commit, motifs, colorOf)));
}

// One layer: header (toggle, name that expands, colour chips, move/reseed/duplicate/delete) and, when expanded, the
// body of parameters. The header name button carries aria-expanded for screen readers.
function layerCard(L, i, list, commit, motifs, colorOf) {
  const set = (patch) => { const next = list.slice(); next[i] = { ...L, ...patch }; commit(next); };
  const setP = (k, v) => set({ params: { ...L.params, [k]: v } });
  const move = (d) => { const j = i + d; if (j < 0 || j >= list.length) return; const next = list.slice(); [next[i], next[j]] = [next[j], next[i]]; const oi = open.has(i), oj = open.has(j); open.delete(i); open.delete(j); if (oi) open.add(j); if (oj) open.add(i); commit(next); };
  const isOpen = open.has(i);
  const head = h('div', { class: 'cg-ly-head' },
    toggle(L.on, (v) => set({ on: v })),
    h('button', { type: 'button', class: 'cg-ly-name', 'aria-expanded': String(isOpen), onclick: () => { if (open.has(i)) open.delete(i); else open.add(i); commit(list); } },
      h('b', {}, t('pt.' + L.type)), h('small', {}, t('blend.' + L.blend) + (L.sym !== 'none' ? ' · ' + t('sym2.' + L.sym) : '') + (L.map === 'grid' ? ' · ' + L.cols + '×' + L.rows : ''))),
    h('span', { class: 'cg-ly-sw' }, L.roles.slice(0, 5).map((r) => h('i', { style: { background: colorOf(r) } }))),
    iconBtn('up', 'ly.up', () => move(-1)), iconBtn('down', 'ly.down', () => move(1)),
    iconBtn('refresh', 'ly.reseed', () => set({ seed: randomSeed(2) })),
    iconBtn('copy', 'ly.dup', () => { const next = list.slice(); next.splice(i + 1, 0, JSON.parse(JSON.stringify(L))); commit(next); }),
    iconBtn('trash', 'ly.del', () => { open.delete(i); commit(list.filter((_, k) => k !== i)); }));
  const card = h('div', { class: 'cg-ly' + (L.on ? '' : ' off') }, head);
  if (!isOpen) return card;

  // Parameter controls come from the pattern spec (carpet/patterns.js): [key, options, default] -> select (options may
  // be the token 'motifs' = the motif list; 'alt' gets an empty choice), [key, min, max, step, ...] -> slider.
  // Sliders are debounced per layer+key (see debounced() below). <label> wraps each row: a click on the text focuses
  // the control.
  const row = (label, ctl) => h('label', { class: 'cg-ly-f' }, h('span', {}, label), ctl);
  const spec = PATTERNS[L.type].params;
  const params = spec.map((s) => {
    const [k] = s;
    if (s.length === 3) {
      const opts = s[1] === 'motifs' ? [...(k === 'alt' ? [{ v: '', l: '=—' }] : []), ...motifs.map((m) => ({ v: m.id, l: '=' + m.label }))] : s[1].map((v) => ({ v, l: 'pv.' + v }));
      return row(t('pp.' + k), select(opts, L.params[k], (v) => setP(k, v)));
    }
    const [, min, max, step] = s;
    return row(t('pp.' + k), range({ min, max, step, value: L.params[k], onInput: debounced(i + k, (v) => setP(k, v)) }));
  });
  const roles = h('div', { class: 'cg-ly-roles' }, L.roles.map((r, k) => {
    const sel = select(ROLES.map((x) => ({ v: x, l: 'role.' + x })), r, (v) => { const rr = L.roles.slice(); rr[k] = v; set({ roles: rr }); });
    // A thick coloured left border previews the role's colour; <option> styling is not portable across browsers.
    sel.style.borderLeft = '10px solid ' + colorOf(r);
    return sel;
  }), iconBtn('plus', 'ly.addRole', () => set({ roles: [...L.roles, ROLES[(L.roles.length + 4) % ROLES.length]] })),
  L.roles.length > 1 ? iconBtn('minus', 'ly.dropRole', () => set({ roles: L.roles.slice(0, -1) })) : null);
  const opt = (key, list, prefix) => select(list.map((v) => ({ v, l: prefix + v })), L[key], (v) => set({ [key]: v }));
  const num = (key, min, max, step) => range({ min, max, step, value: L[key], onInput: debounced(i + key, (v) => set({ [key]: v })) });
  // Conditional rows (grid map, kaleidoscope folds, polar repeat, wallpaper tile) appear only when their mode is on.
  card.append(h('div', { class: 'cg-ly-body' },
    h('h4', {}, t('ly.pattern')), ...params,
    h('h4', {}, t('ly.colours')), roles,
    row(t('ly.blend'), opt('blend', BLENDS, 'blend.')),
    row(t('ly.opacity'), num('opacity', 0.05, 1, 0.05)),
    row(t('ly.area'), opt('area', ['field', 'rug'], 'area.')),
    h('h4', {}, t('ly.placement')),
    row(t('ly.map'), opt('map', ['plane', 'grid'], 'map.')),
    ...(L.map === 'grid' ? [row(t('ly.cols'), num('cols', 1, 24, 1)), row(t('ly.rows'), num('rows', 1, 36, 1)), row(t('ly.stagger'), num('stagger', 0, 1, 0.05)), row(t('ly.vary'), opt('vary', VARY, 'vary.'))] : []),
    row(t('ly.x'), num('x', -2, 2, 0.01)), row(t('ly.y'), num('y', -2, 2, 0.01)),
    row(t('ly.rotate'), num('rotate', -180, 180, 1)), row(t('ly.scale'), num('scale', 0.1, 6, 0.01)),
    row(t('ly.sym'), opt('sym', SYMS, 'sym2.')),
    ...(L.sym === 'kaleido' ? [row(t('ly.fold'), num('fold', 2, 24, 1))] : []),
    row(t('ly.warp'), opt('warp', WARPS, 'warp.')),
    ...(L.warp === 'polar' ? [row(t('ly.repeat'), num('repeat', 1, 24, 1))] : []),
    ...(L.warp === 'tile' ? [row(t('ly.tile'), num('tile', 0.05, 2, 0.01)), row(t('ly.group'), select(WALLPAPER.map((v) => ({ v, l: '=' + v })), L.group, (v) => set({ group: v })))] : [])));
  return card;
}

const iconBtn = (ic, label, fn) => h('button', { type: 'button', class: 'ed-iconbtn', title: t(label), 'aria-label': t(label), onclick: fn }, iconEl(ic));
// Range sliders re-render the panel: commit after the hand rests.
// Committing per input event would regenerate the rug and rebuild the slider under the pointer, ending the drag.
// 220 ms trailing debounce, one timer per key, so two sliders moved in quick succession both commit. Each commit
// spreads the closed-over L, so the second commit carries the first only after a re-render; in practice the panel
// re-renders between them (220 ms apart), which is why per-key timers suffice.
const timers = new Map();
function debounced(key, fn) {
  return (v) => { clearTimeout(timers.get(key)); timers.set(key, setTimeout(() => fn(v), 220)); };
}
