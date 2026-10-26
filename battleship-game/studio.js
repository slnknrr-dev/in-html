// battleship-game/studio.js - the constructor: edit a ruleset (name and description; the board with its size and the
// islands painted cell by cell; own ship shapes drawn as polyominoes with their rotation and mirror rights; the fleet;
// the rules; the weapon modules), check it (validation, the number of fleets a sea can hide, where ships lie and where
// hunters look, a quick bot tournament), give it a look, build bots, test-play it, and export it as a file, a share
// code or a link (and import any of them back).
//
//   renderStudio(main, { onBack, onTestPlay(raw) }) -> { root, importRuleset(raw) }
//   SHARE_PREFIX, shareCode(raw), readShared(text) -> raw | null

import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { iconEl } from '../ui/icons.js';
import { openDialog, toast, confirmDialog } from '../ui/overlays.js';
import { copyText, download, seg } from '../ui/app.js';
import { pickFiles } from '../ui/files.js';
import { normalizeRuleset, orientations, normCells, connected, SHAPES, SHIP_NAMES, DEFAULT_RULES, DEFAULT_WEAPONS, MIN_SIDE, MAX_SIDE } from '../battleship/ruleset.js';
import { validateRuleset, occupancy, huntDensity } from '../battleship/placement.js';
import { PRESETS, presetById } from '../battleship/presets.js';
import { packRuleset, unpackRuleset, startEntropy } from '../battleship/notation.js';
import { playGame } from '../battleship/match.js';
import { seededRandom } from '../prng/prng.js';
import { createGrid } from './grid.js';
import { SKINS, applySkin, skinOf } from './skins.js';
import { store, save, putRuleset, removeRuleset } from './store.js';
import { rulesBody, shipName } from './names.js';
import { builder } from './setup.js';

// Share codes are versioned by prefix ("BSR1:" = Battleship Ruleset format 1): a future format gets a new prefix and
// old codes stay decodable. readShared also accepts raw JSON (an exported file pasted in). It returns null on any
// parse error; callers must still run validateRuleset, since a well-formed code can describe an impossible sea.
export const SHARE_PREFIX = 'BSR1:';
export const shareCode = (raw) => SHARE_PREFIX + packRuleset(normalizeRuleset(raw));
export function readShared(text) {
  const s = String(text || '').trim();
  try {
    if (s.startsWith(SHARE_PREFIX)) return unpackRuleset(s.slice(SHARE_PREFIX.length));
    if (s.startsWith('{')) return JSON.parse(s);
  } catch { return null; }
  return null;
}

// Deep copy via JSON: rulesets are plain JSON data by contract (they are exported and shared as JSON), so the
// JSON round trip is exact here and doubles as a check that nothing non-serialisable crept in.
const clone = (o) => JSON.parse(JSON.stringify(o));
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'my-sea';
const txt = (v) => (typeof v === 'string' ? v : v && (v.en || Object.values(v)[0])) || '';

// A full editable copy of a ruleset (defaults written out, so that every field has a control).
function editable(raw) {
  const n = normalizeRuleset(raw);
  return {
    id: n.id, name: txt(raw.name) || n.id, description: txt(raw.description), author: n.author || '', tags: (n.tags || []).filter((x) => x !== 'classic'), exclusive: false,
    board: clone(n.board), shapes: n.shapes.map((s) => ({ id: s.id, name: txt(s.name) || s.id, cells: s.cells, rotate: s.rotate, mirror: s.mirror })),
    fleet: clone(n.fleet).map((f) => ({ ...f, name: typeof f.name === 'string' ? f.name : txt(f.name) })),
    rules: { ...clone(DEFAULT_RULES), ...clone(n.rules) }, weapons: { ...clone(DEFAULT_WEAPONS), ...clone(n.weapons) }, skin: raw.skin || null,
  };
}

export function renderStudio(main, { onBack, onTestPlay }) {
  const root = h('section', { class: 'bs-studio bs-screen' });
  applySkin(root, skinOf(store.settings));
  main.append(root);
  let draft = store.settings.studioDraft ? clone(store.settings.studioDraft) : editable(presetById('ex-tetromino'));
  let tab = 'overview';
  let shapeSel = 0;
  const touch = () => { store.settings.studioDraft = draft; save('settings'); refreshSummary(); };
  const summary = h('div', { class: 'bs-st-summary' });
  const body = h('div', { class: 'bs-st-body' });
  const grids = [];

  function safe() { try { return normalizeRuleset(draft); } catch { return null; } }
  function refreshSummary() {
    const v = validateRuleset(draft);
    summary.textContent = '';
    const n = v.ruleset;
    summary.append(...[
      n ? h('span', { class: 'bs-st-pill' }, t('st2.sea', { w: n.board.width, h: n.board.height })) : null,
      n ? h('span', { class: 'bs-st-pill' }, t('st2.ships', { n: n.ships.length, cells: n.cellCount })) : null,
      h('span', { class: 'bs-st-pill ' + (v.ok ? 'bs-okp' : 'bs-errp') }, v.ok ? t('st2.valid') : t('st2.errors', { n: v.errors.length })),
      v.warnings.length ? h('span', { class: 'bs-st-pill bs-warnp' }, t('st2.warnings', { n: v.warnings.length })) : null,
      n ? h('span', { class: 'bs-st-pill bs-hashp' }, '#' + n.hash) : null].filter(Boolean));
  }

  const tabs = ['overview', 'board', 'shapes', 'fleet', 'rules', 'weapons', 'check', 'look', 'bots', 'export'];
  function render() {
    for (const g of grids.splice(0)) g.destroy();
    root.textContent = '';
    root.append(
      h('div', { class: 'bs-screen-h' },
        h('button', { type: 'button', class: 'ed-iconbtn', 'aria-label': t('nav.back'), onclick: onBack }, iconEl('parent')),
        h('h2', {}, t('st2.title')), h('span', { class: 'ed-spacer' }),
        h('button', { type: 'button', class: 'ed-btn', onclick: saveDraft }, iconEl('save'), t('st2.save')),
        h('button', { type: 'button', class: 'ed-btn ed-primary', dataset: { a: 'test' }, onclick: testPlay }, iconEl('send'), t('st2.test'))),
      summary,
      h('nav', { class: 'bs-st-tabs', role: 'tablist' }, tabs.map((x) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === x), class: 'bs-st-tab' + (tab === x ? ' bs-on' : ''), dataset: { tab: x }, onclick: () => { tab = x; render(); } }, t('st2.tab.' + x)))),
      body);
    body.textContent = '';
    ({ overview, board, shapes, fleet, rules, weapons, check: checkTab, look, bots, export: exporter })[tab]();
    refreshSummary();
  }

  function saveDraft() {
    const v = validateRuleset(draft);
    if (!v.ok) { toast(t('st2.fixErrors'), 'warn'); tab = 'check'; render(); return false; }
    draft.id = slug(draft.id || draft.name);
    if (PRESETS.some((p) => p.id === draft.id)) draft.id += '-mine';
    putRuleset(clone(draft));
    toast(t('st2.saved', { name: draft.name || draft.id }), 'ok');
    return true;
  }
  function testPlay() {
    const v = validateRuleset(draft);
    if (!v.ok) { toast(t('st2.fixErrors'), 'warn'); tab = 'check'; render(); return; }
    if (!draft.id || PRESETS.some((p) => p.id === draft.id)) draft.id = slug(draft.name) + '-mine';
    onTestPlay(clone(draft));
  }

  // --- form helpers -------------------------------------------------------------------------------------------------
  const row = (label, ctl, hint) => h('label', { class: 'ed-field ed-field-col bs-st-f' }, h('span', { class: 'ed-label' }, t(label)), ctl, hint ? h('span', { class: 'ed-hint' }, t(hint)) : null);
  const text = (obj, key, attrs = {}) => { const i = h('input', { class: 'ed-input', value: obj[key] ?? '', ...attrs }); i.addEventListener('input', () => { obj[key] = i.value; touch(); }); return i; };
  const area = (obj, key) => { const i = h('textarea', { class: 'ed-input ed-textarea', rows: '3' }, obj[key] ?? ''); i.addEventListener('input', () => { obj[key] = i.value; touch(); }); return i; };
  const number = (obj, key, min, max, after) => { const i = h('input', { class: 'ed-input bs-num', type: 'number', min: String(min), max: String(max), value: String(obj[key] ?? '') }); i.addEventListener('change', () => { obj[key] = Math.max(min, Math.min(max, Math.round(+i.value) || 0)); i.value = String(obj[key]); touch(); after?.(); }); return i; };
  const flag = (obj, key, label, after) => h('label', { class: 'ed-field ed-field-check bs-st-f' }, h('input', { type: 'checkbox', class: 'ed-switch', checked: !!obj[key], onchange: (e) => { obj[key] = e.target.checked; touch(); after?.(); } }), h('span', { class: 'ed-label' }, t(label)));
  const choose = (obj, key, opts, after) => { const s = h('select', { class: 'ed-input ed-select' }, opts.map(([v, l]) => h('option', { value: String(v), selected: String(obj[key] ?? '') === String(v) }, l))); s.addEventListener('change', () => { const o = opts.find(([v]) => String(v) === s.value); obj[key] = o ? o[0] : s.value; touch(); after?.(); }); return s; };
  const section = (title, ...kids) => h('section', { class: 'ap-card' }, h('h2', { class: 'ap-card-h' }, t(title)), ...kids);
  const del = (fn) => h('button', { type: 'button', class: 'ed-iconbtn', 'aria-label': t('st2.remove'), title: t('st2.remove'), onclick: fn }, iconEl('trash'));

  // --- tabs -----------------------------------------------------------------------------------------------------------
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
    const own = h('div', { class: 'bs-ownlist' });
    for (const r of store.rulesets) {
      own.append(h('div', { class: 'bs-ownrow' }, h('b', {}, txt(r.name) || r.id), h('span', { class: 'ed-muted' }, r.id), h('span', { class: 'ed-spacer' }),
        h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => { draft = editable(r); draft.id = r.id; touch(); render(); } }, t('st2.edit')),
        del(async () => { if (await confirmDialog(t('st2.remove'), t('st2.removeQ', { name: txt(r.name) || r.id }), t('st2.remove'), true)) { removeRuleset(r.id); render(); } })));
    }
    if (!store.rulesets.length) own.append(h('p', { class: 'ed-muted' }, t('st2.noOwn')));
    const n = safe();
    body.append(
      section('st2.meta',
        h('div', { class: 'bs-st-grid' }, row('st2.name', text(draft, 'name', { maxlength: '60' })), row('st2.id', text(draft, 'id', { maxlength: '60', spellcheck: 'false' }), 'st2.idHint'), row('st2.author', text(draft, 'author', { maxlength: '60' }))),
        row('st2.description', area(draft, 'description')),
        row('st2.start', presetSel)),
      section('st2.mine', own, h('div', { class: 'ap-actions' }, h('button', { type: 'button', class: 'ed-btn', onclick: importDialog }, iconEl('upload'), t('st2.import')))),
      n ? section('st2.preview', rulesBody(n)) : '');
  }

  function board() {
    const B = draft.board;
    B.obstacles = B.obstacles || [];
    const n = safe();
    const sizes = h('div', { class: 'bs-st-grid' },
      row('st2.width', number(B, 'width', MIN_SIDE, MAX_SIDE, () => { B.obstacles = B.obstacles.filter(([x]) => x < B.width); render(); })),
      row('st2.height', number(B, 'height', MIN_SIDE, MAX_SIDE, () => { B.obstacles = B.obstacles.filter(([, y]) => y < B.height); render(); })));
    const sea = h('div', { class: 'bs-st-sea' });
    const has = (x, y) => B.obstacles.some((p) => p[0] === x && p[1] === y);
    const paint = () => g.render({ rs: normalizeRuleset(draft), marks: null });
    const g = createGrid(sea, {
      rs: n || normalizeRuleset(presetById('classic')), interactive: true, label: t('st2.islands'),
      onCell: (c) => {
        const x = c % B.width, y = Math.floor(c / B.width);
        if (has(x, y)) B.obstacles = B.obstacles.filter((p) => !(p[0] === x && p[1] === y)); else B.obstacles.push([x, y]);
        touch(); paint();
      },
    });
    grids.push(g);
    paint();
    const scatter = () => {
      const rng = seededRandom('islands/' + Date.now());
      const k = Math.round(B.width * B.height * 0.08);
      B.obstacles = [];
      for (let i = 0; i < k; i++) { const x = rng.int(B.width), y = rng.int(B.height); if (!has(x, y)) B.obstacles.push([x, y]); }
      touch(); render();
    };
    body.append(section('st2.board', sizes, h('p', { class: 'ed-hint' }, t('st2.islandsHint')), sea,
      h('div', { class: 'ap-actions' },
        h('button', { type: 'button', class: 'ed-btn', onclick: scatter }, '🏝️ ', t('st2.scatter')),
        h('button', { type: 'button', class: 'ed-btn', onclick: () => { B.obstacles = []; touch(); render(); } }, iconEl('trash'), t('st2.clearIslands')))));
  }

  function shapes() {
    const list = draft.shapes;
    const box = h('div', { class: 'bs-shapes' });
    list.forEach((s, i) => box.append(h('button', { type: 'button', class: 'bs-shapebtn' + (i === shapeSel ? ' bs-on' : ''), onclick: () => { shapeSel = i; render(); } }, h('span', { html: shapePic(s.cells) }), h('b', {}, s.name || s.id))));
    const add = (src) => {
      let id = slug(src.name || 'shape').slice(0, 10) || 'shape';
      while (list.some((x) => x.id === id) || SHAPES.some((x) => x.id === id)) id = id.slice(0, 9) + Math.floor(Math.random() * 10);
      list.push({ id, name: src.name || id, cells: clone(src.cells), rotate: true, mirror: true });
      shapeSel = list.length - 1;
      touch(); render();
    };
    const palette = h('div', { class: 'bs-shapes bs-palette' }, SHAPES.filter((s) => !/^I\d+$/.test(s.id)).map((s) => h('button', { type: 'button', class: 'bs-shapebtn', title: t('st2.copyShape'), onclick: () => add({ name: t('shape.' + s.id), cells: s.cells }) }, h('span', { html: shapePic(s.cells) }), h('b', {}, t('shape.' + s.id)))));
    body.append(section('st2.shapes', h('p', { class: 'ed-hint' }, t('st2.shapesHint')), box,
      h('div', { class: 'ap-actions' }, h('button', { type: 'button', class: 'ed-btn', onclick: () => add({ name: t('st2.newShape'), cells: [[0, 0], [1, 0], [1, 1]] }) }, iconEl('plus'), t('st2.addShape')))),
    section('st2.palette', palette));
    const s = list[shapeSel];
    if (!s) return;
    // the cell editor: 6 × 6 toggles
    const ed = h('div', { class: 'bs-shapeed', role: 'grid', 'aria-label': t('st2.cells') });
    const on = new Set(s.cells.map(([x, y]) => x + ',' + y));
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) {
      const k = x + ',' + y;
      ed.append(h('button', { type: 'button', class: 'bs-sc' + (on.has(k) ? ' bs-on' : ''), 'aria-pressed': String(on.has(k)), 'aria-label': `${x + 1}, ${y + 1}`, onclick: () => {
        if (on.has(k)) on.delete(k); else on.add(k);
        const cells = [...on].map((v) => v.split(',').map(Number));
        s.cells = normCells(cells).length ? normCells(cells) : [[0, 0]];
        touch(); render();
      } }));
    }
    const ok = connected(s.cells);
    const nO = orientations(s).length;
    body.append(section('st2.editShape',
      h('div', { class: 'bs-st-grid' }, row('st2.shapeName', text(s, 'name', { maxlength: '24' })), row('st2.shapeId', text(s, 'id', { maxlength: '12', spellcheck: 'false' }), 'st2.shapeIdHint')),
      h('div', { class: 'bs-shaperow' }, ed, h('div', {},
        flag(s, 'rotate', 'st2.rotate', render), flag(s, 'mirror', 'st2.mirror', render),
        h('p', { class: ok ? 'ed-hint' : 'ed-hint ed-error' }, ok ? t('st2.orients', { n: nO, cells: s.cells.length }) : t('st2.notConnected')),
        h('div', { class: 'bs-orients' }, orientations(s).map((cl) => h('span', { html: shapePic(cl) }))))),
      h('div', { class: 'ap-actions' }, h('button', { type: 'button', class: 'ed-btn ed-danger', onclick: () => { draft.fleet = draft.fleet.filter((f) => f.shape !== s.id); list.splice(shapeSel, 1); shapeSel = 0; touch(); render(); } }, iconEl('trash'), t('st2.removeShape')))));
  }

  function fleet() {
    const shapeOpts = [...SHAPES.map((s) => [s.id, /^I\d+$/.test(s.id) ? t('shape.I', { n: s.cells.length }) : t('shape.' + s.id)]), ...draft.shapes.map((s) => [s.id, '★ ' + (s.name || s.id)])];
    const nameOpts = [['', t('st2.byShape')], ...SHIP_NAMES.map((k) => [k, t('ship.' + k)])];
    const rows = h('div', { class: 'bs-fleetrows' });
    draft.fleet.forEach((f, i) => {
      const custom = f.name && !SHIP_NAMES.includes(f.name);
      rows.append(h('div', { class: 'bs-fleetrow' },
        h('span', { class: 'bs-fleetpic', html: shapePic(shapeCells(f.shape)) }),
        choose(f, 'shape', shapeOpts, render),
        number(f, 'count', 0, 20),
        nameSelect(f, custom, nameOpts),
        text(f, 'name', { maxlength: '24', placeholder: t('st2.shipName') }),
        del(() => { draft.fleet.splice(i, 1); touch(); render(); })));
    });
    const n = safe();
    body.append(section('st2.fleet', h('p', { class: 'ed-hint' }, t('st2.fleetHint')), rows,
      h('div', { class: 'ap-actions' }, h('button', { type: 'button', class: 'ed-btn', onclick: () => { draft.fleet.push({ shape: 'I2', count: 1, name: 'destroyer' }); touch(); render(); } }, iconEl('plus'), t('st2.addShip'))),
      n ? h('p', {}, t('st2.fleetTotal', { n: n.ships.length, cells: n.cellCount, p: Math.round((n.cellCount / (n.board.width * n.board.height - n.board.obstacles.length)) * 100) })) : null,
      n ? h('p', { class: 'ed-muted' }, n.types.map((tp) => `${tp.count} × ${shipName(n, tp.index)}`).join(', ')) : null));
  }

  // the ship's name: one of the named ships (translated), or the own text field next to it
  function nameSelect(f, custom, opts) {
    const s = h('select', { class: 'ed-input ed-select', 'aria-label': t('st2.shipName') }, opts.map(([v, l]) => h('option', { value: v, selected: !custom && (f.name || '') === v }, l)));
    s.addEventListener('change', () => { f.name = s.value || null; touch(); render(); });
    return s;
  }

  function shapeCells(id) {
    const own = draft.shapes.find((s) => s.id === id);
    if (own) return own.cells;
    const b = SHAPES.find((s) => s.id === id);
    return b ? b.cells : [[0, 0]];
  }

  function rules() {
    const R = draft.rules;
    body.append(section('st2.rules',
      h('div', { class: 'bs-st-grid' },
        row('st2.minPlayers', number(R, 'minPlayers', 2, 6)), row('st2.maxPlayers', number(R, 'maxPlayers', 2, 6)),
        row('st2.teams', choose(R, 'teams', [[0, t('st2.noTeams')], [2, '2'], [3, '3']])),
        row('st2.touch', choose(R, 'touch', ['none', 'corners', 'any'].map((x) => [x, t('st2.touch.' + x)]))),
        row('st2.shots', choose(R, 'shots', ['single', 'salvo', 'volley'].map((x) => [x, t('st2.shots.' + x)]), render)),
        R.shots === 'volley' ? row('st2.volley', number(R, 'volley', 1, 8)) : null,
        row('st2.afterHit', choose(R, 'afterHit', ['again', 'pass'].map((x) => [x, t('st2.afterHit.' + x)]))),
        row('st2.announce', choose(R, 'announce', ['ship', 'sunk', 'hit'].map((x) => [x, t('st2.announce.' + x)]))),
        row('st2.first', choose(R, 'first', ['random', 'seat0'].map((x) => [x, t('st2.first.' + x)])))),
      flag(R, 'halo', 'st2.halo')));
  }

  function weapons() {
    const Wp = draft.weapons;
    body.append(section('st2.weapons', h('p', { class: 'ed-hint' }, t('st2.weaponsHint')),
      h('div', { class: 'bs-st-grid' },
        row('wp.radar', number(Wp, 'radar', 0, 9), 'wp.radar.d'), row('st2.radarSize', number(Wp, 'radarSize', 2, 5)),
        row('wp.airstrike', number(Wp, 'airstrike', 0, 9), 'wp.airstrike.d'), row('st2.airstrikeLength', number(Wp, 'airstrikeLength', 2, 8)),
        row('wp.cluster', number(Wp, 'cluster', 0, 9), 'wp.cluster.d'),
        row('wp.mines', number(Wp, 'mines', 0, 12), 'wp.mines.d'))));
  }

  function checkTab() {
    const v = validateRuleset(draft);
    const list = h('ul', { class: 'bs-checks' });
    for (const e of v.errors) list.append(h('li', { class: 'ed-error' }, `${e.path ? e.path + ': ' : ''}${e.msg}`));
    for (const w of v.warnings) list.append(h('li', { class: 'ed-hint-warn' }, `${w.path ? w.path + ': ' : ''}${w.msg}`));
    if (!v.errors.length && !v.warnings.length) list.append(h('li', { class: 'bs-okline' }, t('st2.allGood')));
    body.append(section('st2.validation', list));
    if (!v.ok) return;
    const rs = v.ruleset;
    const bits = startEntropy(rs);
    const maps = h('div', { class: 'bs-st-maps' });
    const a = h('div', {}, h('b', {}, t('st2.occupancy'))), b = h('div', {}, h('b', {}, t('st2.huntDensity')));
    maps.append(a, b);
    const ga = createGrid(a, { rs, small: true, label: t('st2.occupancy') }), gb = createGrid(b, { rs, small: true, label: t('st2.huntDensity') });
    grids.push(ga, gb);
    ga.render({ rs, heat: occupancy(rs, 600) });
    gb.render({ rs, heat: huntDensity(rs) });
    const out = h('div', { class: 'bs-simout' });
    const btn = h('button', { type: 'button', class: 'ed-btn ed-primary', dataset: { a: 'simulate' }, onclick: () => simulate(rs, out, btn) }, iconEl('send'), t('st2.simulate'));
    body.append(section('st2.stats',
      h('p', {}, t('st2.layouts', { bits: bits.toFixed(1), approx: approxPow(bits) })),
      h('p', { class: 'ed-hint' }, t('st2.mapsHint')), maps),
      section('st2.tournament', h('p', { class: 'ed-hint' }, t('st2.simHint')), btn, out));
  }

  function simulate(rs, out, btnEl) {
    const total = 16;
    const stats = { games: 0, unfinished: 0, illegal: 0, first: 0, turns: 0, shots: 0 };
    btnEl.disabled = true;
    const prog = h('div', { class: 'ap-progress' }, h('i'));
    out.textContent = '';
    out.append(prog);
    const n = Math.max(rs.rules.minPlayers, rs.rules.teams ? rs.rules.teams * 2 : 2);
    let g = 0;
    const one = () => {
      const seats = Array.from({ length: n }, (_, i) => ({ kind: ['statistician', 'hunter', 'cartographer', 'corsair'][i % 4], level: 2 }));
      const r = playGame({ rs, seats, seed: 'studio-' + rs.hash + '-' + g });
      stats.games++;
      stats.illegal += r.illegal;
      if (!r.over) stats.unfinished++;
      else {
        stats.turns += r.result.turns;
        stats.shots += r.result.shots.reduce((x, y) => x + y, 0);
        if (r.result.winners.includes(r.first)) stats.first++;
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
        h('dt', {}, t('st2.simTurns')), h('dd', {}, (stats.turns / fin).toFixed(1)),
        h('dt', {}, t('st2.simShots')), h('dd', {}, (stats.shots / fin).toFixed(1)),
        h('dt', {}, t('st2.simFirst')), h('dd', {}, Math.round((stats.first / fin) * 100) + '% ' + t('st2.simFair', { p: Math.round(100 / n) })),
        h('dt', {}, t('st2.simIllegal')), h('dd', { class: stats.illegal ? 'ed-error' : '' }, String(stats.illegal)),
        h('dt', {}, t('st2.simUnfinished')), h('dd', { class: stats.unfinished ? 'ed-error' : '' }, String(stats.unfinished))));
    };
    setTimeout(step, 30);
  }

  function look() {
    const S = store.settings;
    const pick = h('div', { class: 'bs-swatches' }, SKINS.map((x) => h('button', { type: 'button', class: 'bs-swatch' + (S.skin === x.id ? ' bs-on' : ''), 'aria-pressed': String(S.skin === x.id), onclick: () => { S.skin = x.id; save('settings'); applySkin(root, skinOf(S)); render(); } }, skinPic(x), h('span', {}, t(x.name)))));
    body.append(section('lk.skin', pick),
      section('lk.ruleset', h('p', { class: 'ed-hint' }, t('lk.rulesetHint')),
        h('label', { class: 'ed-field ed-field-check' }, h('input', { type: 'checkbox', class: 'ed-switch', checked: !!draft.skin, onchange: (e) => { draft.skin = e.target.checked ? { theme: S.skin } : null; touch(); } }), h('span', { class: 'ed-label' }, t('lk.embed')))));
  }

  function bots() {
    body.append(section('st2.botBuilder', h('p', { class: 'ed-hint' }, t('st2.botHint')), builder(() => { toast(t('bp.saved'), 'ok'); render(); })));
  }

  function exporter() {
    const v = validateRuleset(draft);
    const code = v.ok ? shareCode(draft) : '';
    const link = v.ok ? location.href.split('#')[0] + '#rs=' + encodeURIComponent(code) : '';
    body.append(section('ex.ruleset', v.ok ? null : h('p', { class: 'ed-error' }, t('st2.fixErrors')),
      h('div', { class: 'ap-actions' },
        h('button', { type: 'button', class: 'ed-btn ed-primary', disabled: !v.ok, onclick: () => download(JSON.stringify(sourceOf(draft), null, 1), slug(draft.id || draft.name) + '.battleship.json', 'application/json') }, iconEl('download'), t('ex.file')),
        h('button', { type: 'button', class: 'ed-btn', disabled: !v.ok, dataset: { a: 'code' }, onclick: () => copyText(code, t('ex.codeCopied')) }, iconEl('copy'), t('ex.code')),
        h('button', { type: 'button', class: 'ed-btn', disabled: !v.ok, onclick: () => copyText(link, t('ex.linkCopied')) }, iconEl('link'), t('ex.link')),
        h('button', { type: 'button', class: 'ed-btn', onclick: importDialog }, iconEl('upload'), t('st2.import'))),
      v.ok ? h('textarea', { class: 'ed-input ap-mono bs-codeout', rows: '3', readonly: true, 'aria-label': t('ex.code') }, code) : null,
      h('p', { class: 'ed-hint' }, t('ex.publishHint'))));
  }

  const sourceOf = (d) => ({ id: d.id, name: d.name, description: d.description, author: d.author, tags: d.tags, board: d.board, shapes: d.shapes, fleet: d.fleet, rules: d.rules, weapons: d.weapons, skin: d.skin || undefined });

  async function importDialog() {
    const ta = h('textarea', { class: 'ed-input ap-mono', rows: '5', placeholder: 'BSR1:… / { "board": … }' });
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
    touch(); tab = 'overview'; render();
    toast(t('st2.imported'), 'ok');
  }

  render();
  return { root, importRuleset: (raw) => { draft = editable(raw); draft.id = slug(raw.id || raw.name); touch(); render(); } };
}

// A small picture of a shape.
export function shapePic(cells) {
  const cl = normCells(cells);
  const w = Math.max(1, ...cl.map((p) => p[0] + 1)), hh = Math.max(1, ...cl.map((p) => p[1] + 1));
  return `<svg viewBox="-0.1 -0.1 ${w + 0.2} ${hh + 0.2}" width="${Math.min(64, w * 13)}" height="${Math.min(64, hh * 13)}" aria-hidden="true">${cl.map(([x, y]) => `<rect class="bs-dockcell" x="${x + 0.08}" y="${y + 0.08}" width=".84" height=".84" rx=".16"/>`).join('')}</svg>`;
}

// A swatch of a look.
export function skinPic(s) {
  const v = s.vars;
  return h('i', { class: 'bs-skinsw', style: { background: `linear-gradient(135deg, ${v.water} 0 60%, ${v.bg} 60%)`, borderColor: v.grid } },
    h('b', { style: { color: v.hit } }, '✕'), h('b', { style: { color: v.miss } }, '•'));
}

function approxPow(bits) {
  const d = bits * Math.log10(2);
  const e = Math.floor(d);
  return `${(10 ** (d - e)).toFixed(1)} × 10^${e}`;
}
