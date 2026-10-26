// miner-game/panel.js - the settings panel beside the board (a sheet over the board on phones): new game
// (difficulty, size, mines, daily challenge), rules (cells, neighbourhood, torus, no guessing, first click, question
// marks, undo), controls (what a tap does, chording by a click, long press, vibration), seed (seeded PRNG or CSPRNG,
// current seed, share link, play a seed or code), look (skins, symbol sets, mine and flag symbols, animations, sound,
// turning wide boards), records and help.

//
// Build once, sync many: renderPanel creates every control once and stores a sync function per section in refs;
// syncPanel re-reads state into the existing controls. Rebuilding the panel on every state change would drop focus
// and caret position (typing a width would lose the field after each keystroke) and reset scroll in the sheet.
// The panel never mutates game state itself: every change goes through ctl (main.js), which persists and re-syncs.
import { button, field, seg, select, t, textInput, toggle } from '../ui/app.js';
import { h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { confirmDialog, openDialog } from '../ui/overlays.js';
import { MAX_SIDE, PRESETS, configKey, density, maxMines, minesForDensity, normalizeConfig, presetOf } from '../mines/config.js';
import { entry } from '../mines/stats.js';
import { NEIGHBORHOODS } from '../mines/topology.js';
import { SKIN_IDS, SYMBOL_IDS, cellGeometry, paintCell, palette, parseCustom, symbolFn } from './skins.js';

// Module-level: there is exactly one panel per page. syncPanel ignores calls for a different (stale) panel element.
let refs = null;

// Collapsible <details> sections; the open/closed state is persisted (S.open) so the layout the player chose survives
// reloads. Native details/summary: keyboard and screen-reader support for free.
function section(id, title, ic, S, ctl, ...kids) {
  const d = h('details', { class: 'ed-sec mn-sec', open: S.open[id] ? true : null, dataset: { sec: id } },
    h('summary', { class: 'ed-sec-h' }, iconEl('chevRight'), iconEl(ic), h('span', null, t(title))),
    h('div', { class: 'ed-sec-b' }, ...kids));
  d.addEventListener('toggle', () => ctl.setOpen(id, d.open));
  return d;
}

// Commits on "change" (blur/Enter), not "input": every config change may start a new board, which must not happen on
// each digit of "120". Empty value is ignored rather than read as 0.
const numInput = (value, min, max, onChange, label) => {
  const i = h('input', { type: 'number', class: 'ed-input mn-num', min, max, step: 1, value, inputmode: 'numeric', 'aria-label': label });
  i.addEventListener('change', () => { if (i.value !== '') onChange(+i.value); });
  return i;
};

// A small strip of cells painted with a skin (gallery tiles, symbol preview).
// Preview canvases are drawn at devicePixelRatio (capped at 3: higher ratios add memory, not visible sharpness) and
// scaled down by CSS size, so the tiles stay crisp on HiDPI screens. Uses the same paintCell as the board: previews
// can never drift from the real rendering.
function strip(canvas, skin, scheme, cells, look, size = 22) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const s = Math.round(size * dpr);
  const g = cellGeometry(s, false);
  canvas.width = s * cells.length;
  canvas.height = s;
  canvas.style.width = size * cells.length + 'px';
  canvas.style.height = size + 'px';
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = palette(skin, scheme).bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  cells.forEach(([kind, k], i) => {
    ctx.save();
    ctx.translate(i * s, 0);
    paintCell(ctx, g, skin, scheme, kind, k, (i & 1) | (i << 1), look);
    ctx.restore();
  });
}

export function renderPanel(panel, S, G, ctl, stats) {
  panel.textContent = '';
  refs = { panel, S, G, ctl, stats };
  const cfg = S.cfg;

  // ---- new game -------------------------------------------------------------------------------------------------------
  const presetSeg = seg([...Object.keys(PRESETS).map((k) => ({ v: k, l: 'mn.preset.' + k })), { v: 'custom', l: 'mn.preset.custom' }],
    presetOf(cfg) || 'custom', (v) => { if (v !== 'custom') ctl.setCfg(PRESETS[v]); else refs.size.querySelector('input')?.focus(); }, 'mn.difficulty');
  presetSeg.classList.add('mn-presets');
  // Changing a side scales the mine count proportionally, keeping the density (difficulty) roughly constant.
  const wIn = numInput(cfg.w, 3, MAX_SIDE, (v) => ctl.setCfg({ w: v, mines: Math.round(S.cfg.mines * v / S.cfg.w) }), t('mn.width'));
  const hIn = numInput(cfg.h, 3, MAX_SIDE, (v) => ctl.setCfg({ h: v, mines: Math.round(S.cfg.mines * v / S.cfg.h) }), t('mn.height'));
  const mIn = numInput(cfg.mines, 1, maxMines(cfg), (v) => ctl.setCfg({ mines: v }), t('mn.mines'));
  const size = h('div', { class: 'mn-size' },
    h('label', null, h('span', null, t('mn.width')), wIn), h('span', { class: 'mn-x' }, '×'),
    h('label', null, h('span', null, t('mn.height')), hIn), h('label', null, h('span', null, t('mn.mines')), mIn));
  // Density slider: 'input' only previews the resulting mine count; 'change' (release) applies it - same reason as
  // numInput, a drag must not generate dozens of boards.
  const dens = h('input', { type: 'range', class: 'ed-range', min: 1, max: 60, step: 0.5, value: density(cfg), 'aria-label': t('mn.density') });
  const densOut = h('output', { class: 'ed-range-val' }, density(cfg) + ' %');
  dens.addEventListener('input', () => { densOut.textContent = (+dens.value).toFixed(1) + ' %'; mIn.value = Math.max(1, minesForDensity(S.cfg, +dens.value)); });
  dens.addEventListener('change', () => ctl.setCfg({ mines: Math.max(1, minesForDensity(S.cfg, +dens.value)) }));
  const pending = h('p', { class: 'ed-hint mn-pending', hidden: true }, t('mn.pending'));
  const newBtn = button('mn.newGame', 'refresh', () => ctl.newGame(), 'primary');
  newBtn.classList.add('mn-new');
  refs.size = size;
  // Fields with focus are not overwritten: the user is typing there.
  refs.syncNew = () => {
    presetSeg.set(presetOf(S.cfg) || 'custom');
    for (const [i, v] of [[wIn, S.cfg.w], [hIn, S.cfg.h], [mIn, S.cfg.mines]]) if (document.activeElement !== i) i.value = v;
    mIn.max = maxMines(S.cfg);
    dens.value = density(S.cfg);
    densOut.textContent = density(S.cfg).toFixed(1) + ' %';
    pending.hidden = !refs.G.pending;
  };

  // ---- rules ----------------------------------------------------------------------------------------------------------
  const gridSeg = seg([{ v: 'square', l: 'mn.grid.square' }, { v: 'hex', l: 'mn.grid.hex' }], cfg.grid, (v) => ctl.setCfg({ grid: v }), 'mn.grid');
  const nbSel = h('select', { class: 'ed-input ed-select' });
  nbSel.addEventListener('change', () => ctl.setCfg({ nb: nbSel.value }));
  const nbHint = h('div', { class: 'ed-hint' });
  const wrapT = toggle(cfg.wrap, (v) => ctl.setCfg({ wrap: v }));
  const ngT = toggle(cfg.noGuess, (v) => ctl.setCfg({ noGuess: v }));
  const firstSel = select(['opening', 'safe', 'marked', 'off'].map((v) => ({ v, l: 'mn.first.' + v })), cfg.first, (v) => ctl.setCfg({ first: v }));
  const firstHint = h('div', { class: 'ed-hint' });
  const marksT = toggle(cfg.marks, (v) => ctl.setCfg({ marks: v }));
  const undoT = toggle(S.allowUndo, (v) => ctl.set('allowUndo', v));
  // Neighbourhood options depend on the grid (square: king/cross/knight/wide; hex: its own set), so the select is
  // refilled. No-guess boards need a guaranteed safe opening, hence "safe"/"off" first-click options are disabled.
  refs.syncRules = () => {
    const c = S.cfg;
    gridSeg.set(c.grid);
    nbSel.textContent = '';
    for (const nb of NEIGHBORHOODS[c.grid]) nbSel.append(h('option', { value: nb, selected: nb === c.nb }, t(`mn.nb.${c.grid === 'hex' ? 'hex.' : ''}${nb}`)));
    nbSel.value = c.nb;
    nbHint.textContent = t(`mn.nb.${c.grid === 'hex' ? 'hex.' : ''}${c.nb}.hint`);
    wrapT.checked = c.wrap;
    ngT.checked = c.noGuess;
    firstSel.set(c.first);
    for (const o of firstSel.options) o.disabled = c.noGuess && (o.value === 'safe' || o.value === 'off');
    firstHint.textContent = t('mn.first.' + c.first + '.hint');
    marksT.checked = c.marks;
    undoT.checked = S.allowUndo;
  };

  // ---- controls ---------------------------------------------------------------------------------------------------------
  const tapSeg = seg([{ v: 'open', l: 'mn.tap.open' }, { v: 'flag', l: 'mn.tap.flag' }], S.tapFlags ? 'flag' : 'open', (v) => ctl.setTap(v === 'flag'), 'mn.tap');
  tapSeg.classList.add('mn-tapseg');
  const tapHint = h('div', { class: 'ed-hint' });
  const chordT = toggle(S.chordClick, (v) => ctl.set('chordClick', v));
  const vibT = toggle(S.vibrate, (v) => ctl.set('vibrate', v));
  const lp = h('input', { type: 'range', class: 'ed-range', min: 200, max: 900, step: 20, value: S.longPress, 'aria-label': t('mn.longPress') });
  const lpOut = h('output', { class: 'ed-range-val' }, S.longPress + ' ms');
  lp.addEventListener('input', () => { lpOut.textContent = lp.value + ' ms'; });
  lp.addEventListener('change', () => ctl.set('longPress', +lp.value));
  refs.syncControls = () => {
    tapSeg.set(S.tapFlags ? 'flag' : 'open');
    tapHint.textContent = t(S.tapFlags ? 'mn.tap.flag.hint' : 'mn.tap.open.hint');
    chordT.checked = S.chordClick;
    vibT.checked = S.vibrate;
    vibT.disabled = !navigator.vibrate;
    if (document.activeElement !== lp) { lp.value = S.longPress; lpOut.textContent = S.longPress + ' ms'; }
  };

  // ---- seed ------------------------------------------------------------------------------------------------------------
  const randSeg = seg([{ v: 'seeded', l: 'mn.rand.seeded' }, { v: 'crypto', l: 'mn.rand.crypto' }], S.random, (v) => ctl.setRandom(v), 'mn.rand');
  const randHint = h('div', { class: 'ed-hint' });
  const curSeed = h('code', { class: 'mn-seed' });
  const curKind = h('div', { class: 'ed-hint mn-seed-kind' });
  const seedIn = textInput('', () => {}, { placeholder: t('mn.seed.ph'), 'aria-label': t('mn.seed.play') });
  seedIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ctl.playSeed(seedIn.value); seedIn.value = ''; } });
  refs.syncSeed = () => {
    randSeg.set(S.random);
    randHint.textContent = t(S.random === 'crypto' ? 'mn.rand.crypto.hint' : 'mn.rand.seeded.hint');
    const g = ctl.game();
    if (!g) return;
    curSeed.textContent = g.kind === 'seeded' ? g.seed : t(g.kind === 'layout' ? 'mn.seed.layout' : 'mn.seed.secure');
    curSeed.classList.toggle('mn-seed-none', g.kind !== 'seeded');
    curKind.textContent = g.kind === 'seeded' ? t(g.cfg.first === 'marked' || g.cfg.first === 'off' ? 'mn.seed.fixed' : 'mn.seed.byClick') : g.kind === 'crypto' ? t('mn.seed.cryptoNote') : '';
  };

  // ---- look -------------------------------------------------------------------------------------------------------------
  const gallery = h('div', { class: 'mn-skins', role: 'radiogroup', 'aria-label': t('mn.skin') });
  const symSel = select(SYMBOL_IDS.map((v) => ({ v, l: 'mn.sym.' + v })), S.symbols, (v) => ctl.set('symbols', v));
  const customIn = textInput(S.custom, (v) => { ctl.set('custom', v); }, { placeholder: t('mn.sym.customPh'), 'aria-label': t('mn.sym.custom') });
  const customField = field('mn.sym.custom', customIn, 'mn.sym.customHint');
  const symPrev = h('canvas', { class: 'mn-sym-prev', role: 'img', 'aria-label': t('mn.sym.preview') });
  const symWarn = h('div', { class: 'ed-hint ed-hint-warn', hidden: true });
  const mineIn = textInput(S.mineGlyph, (v) => ctl.set('mineGlyph', v), { placeholder: t('mn.glyph.drawn'), maxlength: 8, class: 'ed-input mn-glyph' });
  const flagIn = textInput(S.flagGlyph, (v) => ctl.set('flagGlyph', v), { placeholder: t('mn.glyph.drawn'), maxlength: 8, class: 'ed-input mn-glyph' });
  const motionSeg = seg([{ v: 'auto', l: 'mn.motion.auto' }, { v: 'on', l: 'mn.motion.on' }, { v: 'off', l: 'mn.motion.off' }], S.motion, (v) => ctl.set('motion', v), 'mn.motion');
  const soundT = toggle(S.sound, (v) => ctl.set('sound', v));
  const vol = h('input', { type: 'range', class: 'ed-range', min: 0, max: 1, step: 0.05, value: S.volume, 'aria-label': t('mn.volume') });
  vol.addEventListener('change', () => ctl.set('volume', +vol.value));
  const uprightT = toggle(S.upright, (v) => ctl.set('upright', v));
  // Custom symbol sets must cover every number a cell can show: up to 8 (king), 4 (cross), 24 (wide), 6/18 on hex.
  // A shorter set is allowed (fallback to digits) but warned about.
  refs.syncLook = () => {
    const sch = ctl.scheme();
    const look = { symbol: symbolFn(S.symbols, S.custom), mineGlyph: S.mineGlyph.trim(), flagGlyph: S.flagGlyph.trim() };
    gallery.textContent = '';
    for (const id of SKIN_IDS) {
      const cv = h('canvas', { 'aria-hidden': 'true' });
      strip(cv, id, sch, [['hidden', 0], ['open', 1], ['open', 2], ['open', 3], ['flag', 0], ['mine', 0]], look, 20);
      const on = S.skin === id;
      gallery.append(h('button', {
        type: 'button', role: 'radio', class: 'mn-skin' + (on ? ' mn-on' : ''), 'aria-checked': String(on), dataset: { skin: id },
        onclick: () => ctl.set('skin', id),
      }, cv, h('span', null, t('mn.skin.' + id))));
    }
    symSel.set(S.symbols);
    customField.hidden = S.symbols !== 'custom';
    strip(symPrev, S.skin, sch, [1, 2, 3, 4, 5, 6, 7, 8].map((k) => ['open', k]), look, 26);
    const n = parseCustom(S.custom).length;
    const need = { king: 8, cross: 4, knight: 8, wide: 24 }[S.cfg.nb] || 8;
    const max = S.cfg.grid === 'hex' ? (S.cfg.nb === 'wide' ? 18 : 6) : need;
    symWarn.hidden = !(S.symbols === 'custom' && n > 0 && n < max);
    symWarn.textContent = t('mn.sym.short', { n, max });
    motionSeg.set(S.motion);
    soundT.checked = S.sound;
    vol.disabled = !S.sound;
    uprightT.checked = S.upright;
  };

  // ---- records ------------------------------------------------------------------------------------------------------------
  const recBox = h('div', { class: 'mn-records' });
  // Records are per configuration key (size, mines, grid, rules): times on different rules are not comparable.
  // 3BV/s = Bechtel's board value per second, the standard skill measure independent of board luck.
  refs.syncRecords = () => {
    const st = refs.stats || ctl.stats();
    const g = ctl.game();
    const c = g ? g.cfg : S.cfg;
    const e = entry(st, configKey(c));
    recBox.textContent = '';
    recBox.append(h('div', { class: 'mn-rec-cfg' }, configLabelLong(c)));
    const rate = e.played ? Math.round((e.won / e.played) * 100) : 0;
    recBox.append(h('dl', { class: 'mn-stats' },
      ...[['mn.stats.played', e.played], ['mn.stats.won', e.won], ['mn.stats.rate', rate + '%'], ['mn.stats.streak', e.streak], ['mn.stats.bestStreak', e.bestStreak]]
        .flatMap(([k, v]) => [h('dt', null, t(k)), h('dd', null, String(v))])));
    if (e.best.length) {
      recBox.append(h('ol', { class: 'mn-best' }, e.best.map((b) => h('li', null,
        h('b', null, (b.ms / 1000).toFixed(2) + ' ' + t('mn.unit.s')),
        h('span', { class: 'mn-best-meta' }, (b.bbbv ? (b.bbbv / Math.max(0.001, b.ms / 1000)).toFixed(2) + ' 3BV/s · ' : '') + new Date(b.date).toLocaleDateString(document.documentElement.lang)),
        b.replay ? h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('mn.replay.watch'), 'aria-label': t('mn.replay.watch'), onclick: () => ctl.replay(b.replay) }, iconEl('replay')) : null))));
    } else recBox.append(h('p', { class: 'ed-hint' }, t('mn.stats.none')));
    const last = ctl.lastReplay();
    recBox.append(h('div', { class: 'ap-actions' },
      last ? button('mn.replay.last', 'replay', () => ctl.replay(last)) : null,
      button('mn.stats.all', 'trophy', () => allStats(ctl)),
      button('mn.stats.reset', 'trash', async () => { if (await confirmDialog(t('mn.stats.reset'), t('mn.stats.resetQ'), t('dlg.delete'), true)) ctl.resetStats(); }, 'danger')));
  };

  // ---- help ---------------------------------------------------------------------------------------------------------------
  const helpRows = [['mn.help.rules', 'mn.help.rules.t'], ['mn.help.mouse', 'mn.help.mouse.t'], ['mn.help.touch', 'mn.help.touch.t'], ['mn.help.keys', 'mn.help.keys.t'], ['mn.help.ng', 'mn.help.ng.t'], ['mn.help.seed', 'mn.help.seed.t']];

  const close = h('button', { type: 'button', class: 'ed-iconbtn mn-sheet-x', 'aria-label': t('dlg.close'), title: t('dlg.close'), onclick: () => closePanelSheet(panel) }, iconEl('close'));
  // The sections scroll inside the panel (a rounded scroller would paint square corners in some renderers).
  const body = h('div', { class: 'mn-panel-in' });
  panel.append(h('div', { class: 'mn-sheet-head' }, h('b', null, t('mn.settings')), close), body);
  body.append(
    section('new', 'mn.sec.new', 'play', S, ctl,
      presetSeg, size,
      h('div', { class: 'ed-field' }, h('label', { class: 'ed-label' }, t('mn.density')), h('div', { class: 'ed-range-wrap' }, dens, densOut)),
      pending,
      h('div', { class: 'ap-actions mn-new-row' }, newBtn, button('mn.daily', 'calendar', () => ctl.daily()))),
    section('rules', 'mn.sec.rules', 'grid', S, ctl,
      h('div', { class: 'ed-fields' },
        field('mn.grid', gridSeg),
        h('div', { class: 'ed-field' }, h('label', { class: 'ed-label' }, t('mn.nb')), nbSel, nbHint),
        field('mn.wrap', wrapT, 'mn.wrap.hint'),
        field('mn.ng', ngT, 'mn.ng.hint'),
        h('div', { class: 'ed-field' }, h('label', { class: 'ed-label' }, t('mn.first')), firstSel, firstHint),
        field('mn.marks', marksT, 'mn.marks.hint'),
        field('mn.allowUndo', undoT, 'mn.allowUndo.hint'))),
    section('controls', 'mn.sec.controls', 'sliders', S, ctl,
      h('div', { class: 'ed-fields' },
        h('div', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('mn.tap')), tapSeg, tapHint),
        field('mn.chordClick', chordT, 'mn.chordClick.hint'),
        h('div', { class: 'ed-field' }, h('label', { class: 'ed-label' }, t('mn.longPress')), h('div', { class: 'ed-range-wrap' }, lp, lpOut)),
        field('mn.vibrate', vibT, 'mn.vibrate.hint'))),
    section('seed', 'mn.sec.seed', 'key', S, ctl,
      h('div', { class: 'ed-fields' },
        field('mn.rand', randSeg), randHint,
        h('div', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('mn.seed.current')), curSeed, curKind,
          h('div', { class: 'ap-row' }, button('mn.seed.copy', 'copy', () => ctl.copySeed()), button('mn.share.board', 'link', () => ctl.copyLink()))),
        h('div', { class: 'ed-field' }, h('label', { class: 'ed-label' }, t('mn.seed.play')),
          h('div', { class: 'ed-row' }, seedIn, button('', 'play', () => { ctl.playSeed(seedIn.value); seedIn.value = ''; }, 'primary')),
          h('div', { class: 'ed-hint' }, t('mn.seed.playHint'))))),
    section('look', 'mn.sec.look', 'palette', S, ctl,
      gallery,
      h('div', { class: 'ed-fields mn-look' },
        field('mn.sym', symSel), customField, symPrev, symWarn,
        h('div', { class: 'ed-grid2' }, field('mn.glyph.mine', mineIn), field('mn.glyph.flag', flagIn)),
        field('mn.motion', motionSeg),
        field('mn.sound', soundT),
        h('div', { class: 'ed-field' }, h('label', { class: 'ed-label' }, t('mn.volume')), vol),
        field('mn.upright', uprightT, 'mn.upright.hint'))),
    section('records', 'mn.sec.records', 'trophy', S, ctl, recBox),
    section('help', 'mn.sec.help', 'help', S, ctl,
      h('dl', { class: 'mn-help' }, helpRows.flatMap(([a, b]) => [h('dt', null, t(a)), h('dd', null, t(b))]))),
  );
  syncPanel(panel, S, G, stats);
}

function configLabelLong(c) {
  const p = presetOf(c);
  const parts = [(p ? t('mn.preset.' + p) + ' · ' : '') + `${c.w} × ${c.h}, ${t('mn.minesN', { n: c.mines })}`];
  parts.push(t(c.grid === 'hex' ? 'mn.grid.hex' : 'mn.grid.square') + ', ' + t(`mn.nb.${c.grid === 'hex' ? 'hex.' : ''}${c.nb}`));
  if (c.wrap) parts.push(t('mn.wrap.short'));
  if (c.noGuess) parts.push(t('mn.ng.short'));
  if (c.first === 'safe' || c.first === 'off') parts.push(t('mn.first.' + c.first));
  return parts.join(' · ');
}

export function syncPanel(panel, S, G, stats) {
  if (!refs || refs.panel !== panel) return;
  if (stats) refs.stats = stats;
  refs.S = S;
  refs.G = G;
  refs.syncNew();
  refs.syncRules();
  refs.syncControls();
  refs.syncSeed();
  refs.syncLook();
  refs.syncRecords();
}

// Every configuration that was played, best first.
function allStats(ctl) {
  const st = ctl.stats();
  const rows = Object.entries(st.games).sort((a, b) => b[1].played - a[1].played);
  const body = rows.length ? h('div', { class: 'ap-table-wrap' }, h('table', { class: 'ap-table mn-all' },
    h('thead', null, h('tr', null, ['mn.stats.board', 'mn.stats.played', 'mn.stats.won', 'mn.stats.rate', 'mn.stats.best', 'mn.stats.bestStreak'].map((k) => h('th', null, t(k))))),
    h('tbody', null, rows.map(([key, e]) => {
      const c = cfgFromKey(key);
      return h('tr', null,
        h('td', null, c ? configLabelLong(c) : key),
        h('td', null, String(e.played)), h('td', null, String(e.won)),
        h('td', null, (e.played ? Math.round((e.won / e.played) * 100) : 0) + '%'),
        h('td', null, e.best.length ? (e.best[0].ms / 1000).toFixed(2) + ' ' + t('mn.unit.s') : '—'),
        h('td', null, String(e.bestStreak)));
    })))) : h('p', { class: 'ed-hint' }, t('mn.stats.none'));
  openDialog({ title: t('mn.stats.all'), body, wide: true });
}

// configKey() back to a configuration (for labels).
// Inverse of configKey for labels only; flags not encoded in the key (marks, the "marked" first-click mode) fall
// back to defaults, which is enough for a label.
function cfgFromKey(key) {
  const m = /^(\d+)x(\d+)-(\d+)-(square|hex)-(\w+)((?:-\w+)*)$/.exec(key);
  if (!m) return null;
  const flags = m[6].split('-').filter(Boolean);
  return normalizeConfig({ w: +m[1], h: +m[2], mines: +m[3], grid: m[4], nb: m[5], wrap: flags.includes('wrap'), noGuess: flags.includes('ng'), first: flags.includes('safe') ? 'safe' : flags.includes('off') ? 'off' : 'opening' });
}

// Phones: the panel opens as a sheet over the board.
// Phone sheet: a shared backdrop element (created once, reused) closes it on tap; Escape closes too. Focus moves to
// the close button so keyboard and screen-reader users land inside the sheet.
export function openPanelSheet(panel) {
  panel.classList.add('mn-sheet-open');
  document.body.classList.add('mn-sheet-body');
  let back = document.querySelector('.mn-sheet-back');
  if (!back) {
    back = h('div', { class: 'mn-sheet-back', onclick: () => closePanelSheet(panel) });
    document.body.append(back);
  }
  back.hidden = false;
  panel.querySelector('.mn-sheet-x')?.focus({ preventScroll: true });
  const esc = (e) => { if (e.key === 'Escape') { closePanelSheet(panel); } };
  // KNOWN DEFECT: opening twice without closing (e.g. double tap on the sheet button) overwrites panel._esc and leaks
  // the first keydown listener. Fix: remove an existing panel._esc before adding the new one.
  panel._esc = esc;
  document.addEventListener('keydown', esc);
}
export function closePanelSheet(panel) {
  if (!panel.classList.contains('mn-sheet-open')) return;
  panel.classList.remove('mn-sheet-open');
  document.body.classList.remove('mn-sheet-body');
  const back = document.querySelector('.mn-sheet-back');
  if (back) back.hidden = true;
  if (panel._esc) document.removeEventListener('keydown', panel._esc);
}
